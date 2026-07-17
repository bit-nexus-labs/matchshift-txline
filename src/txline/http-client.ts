import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";

export type TxlineStreamKind = "odds" | "scores";

export class TxlineHttpError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "TxlineHttpError";
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export class TxlineConfigurationError extends TxlineHttpError {
  constructor(
    message = "TxLINE credentials or subscription are not configured."
  ) {
    super("CONFIG_ERROR", message, 403);
    this.name = "TxlineConfigurationError";
  }
}

export interface TxlineHttpClientOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

interface RequestContext {
  signal: AbortSignal;
  dispose(): void;
}

function createRequestContext(
  timeoutMs: number,
  externalSignal?: AbortSignal
): RequestContext {
  const timeoutController = new AbortController();
  const signal =
    externalSignal === undefined
      ? timeoutController.signal
      : AbortSignal.any([externalSignal, timeoutController.signal]);
  const timer = setTimeout(
    () => timeoutController.abort("TXLINE_REQUEST_TIMEOUT"),
    timeoutMs
  );

  return {
    signal,
    dispose: () => {
      clearTimeout(timer);
    }
  };
}

function addOptionalQuery(
  path: string,
  values: Readonly<Record<string, string | number | undefined>>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized === "" ? path : `${path}?${serialized}`;
}

export class TxlineHttpClient {
  readonly #apiOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #credentials: TxlineCredentials;

  constructor(options: TxlineHttpClientOptions) {
    this.#apiOrigin = options.apiOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#credentials = new TxlineCredentials({
      apiOrigin: options.apiOrigin,
      apiToken: options.apiToken,
      fetchFn: this.#fetchFn
    });
  }

  async fetchFixturesSnapshot(
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.request(
      addOptionalQuery("/api/fixtures/snapshot", { competitionId }),
      "application/json",
      signal
    );
    return this.readJson(response);
  }

  async fetchFixturesSnapshotForDay(
    startEpochDay: number,
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.request(
      addOptionalQuery("/api/fixtures/snapshot", {
        startEpochDay,
        competitionId
      }),
      "application/json",
      signal
    );
    return this.readJson(response);
  }

  async fetchOddsSnapshot(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.request(
      `/api/odds/snapshot/${encodeURIComponent(String(fixtureId))}`,
      "application/json",
      signal
    );
    return this.readJson(response);
  }

  async fetchOddsSnapshotAt(
    fixtureId: string | number,
    asOf: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const path = addOptionalQuery(
      `/api/odds/snapshot/${encodeURIComponent(String(fixtureId))}`,
      { asOf }
    );
    const response = await this.request(path, "application/json", signal);
    return this.readJson(response);
  }

  async fetchScoresSnapshot(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.request(
      `/api/scores/snapshot/${encodeURIComponent(String(fixtureId))}`,
      "application/json",
      signal
    );
    return this.readJson(response);
  }

  async fetchScoresHistorical(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.request(
      `/api/scores/historical/${encodeURIComponent(String(fixtureId))}`,
      "application/json",
      signal
    );
    return this.readJson(response);
  }

  async openStream(
    kind: TxlineStreamKind,
    signal?: AbortSignal
  ): Promise<Response> {
    const response = await this.request(
      `/api/${kind}/stream`,
      "text/event-stream",
      signal
    );
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType?.includes("text/event-stream") !== true) {
      await response.body?.cancel();
      throw new TxlineHttpError(
        "INVALID_CONTENT_TYPE",
        "TxLINE stream did not return text/event-stream."
      );
    }
    return response;
  }

  private async request(
    path: string,
    accept: "application/json" | "text/event-stream",
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const context = createRequestContext(
      this.#requestTimeoutMs,
      externalSignal
    );
    try {
      let response = await this.requestOnce(
        path,
        accept,
        false,
        context.signal
      );
      if (response.status === 401) {
        await response.body?.cancel();
        response = await this.requestOnce(
          path,
          accept,
          true,
          context.signal
        );
      }

      if (response.status === 403) {
        await response.body?.cancel();
        throw new TxlineConfigurationError();
      }
      if (response.status === 401) {
        await response.body?.cancel();
        throw new TxlineHttpError(
          "UNAUTHORIZED",
          "TxLINE rejected the renewed guest JWT.",
          401
        );
      }
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();
        throw new TxlineHttpError(
          "HTTP_ERROR",
          `TxLINE request failed with status ${status}.`,
          status
        );
      }
      return response;
    } catch (error) {
      if (error instanceof TxlineHttpError) {
        throw error;
      }
      if (context.signal.aborted) {
        throw new TxlineHttpError(
          externalSignal?.aborted === true ? "ABORTED" : "TIMEOUT",
          externalSignal?.aborted === true
            ? "TxLINE request was aborted."
            : "TxLINE request timed out."
        );
      }
      if (error instanceof TxlineCredentialError) {
        throw error;
      }
      throw new TxlineHttpError(
        "NETWORK_ERROR",
        "TxLINE network request failed."
      );
    } finally {
      context.dispose();
    }
  }

  private async requestOnce(
    path: string,
    accept: "application/json" | "text/event-stream",
    refreshGuestJwt: boolean,
    signal: AbortSignal
  ): Promise<Response> {
    const headers = await this.#credentials.buildDataHeaders(
      accept,
      refreshGuestJwt,
      signal
    );
    return this.#fetchFn(new URL(path, this.#apiOrigin), {
      method: "GET",
      headers,
      signal
    });
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new TxlineHttpError(
        "INVALID_JSON",
        "TxLINE returned an invalid JSON response."
      );
    }
  }
}
