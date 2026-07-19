import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import {
  TxlineConfigurationError,
  TxlineHttpError
} from "./http-client.js";
import {
  extractTxlineReplayRecords,
  parseTxlineReplayResponse
} from "./replay-http-source.js";

export interface TxlineScoreSnapshotSourceOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

export class TxlineScoreSnapshotSource {
  readonly #apiOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #credentials: TxlineCredentials;

  constructor(options: TxlineScoreSnapshotSourceOptions) {
    this.#apiOrigin = options.apiOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#credentials = new TxlineCredentials({
      apiOrigin: options.apiOrigin,
      apiToken: options.apiToken,
      fetchFn: this.#fetchFn
    });
  }

  async fetchSnapshotAt(
    fixtureId: string | number,
    asOf: number,
    externalSignal?: AbortSignal
  ): Promise<unknown[]> {
    if (!Number.isSafeInteger(asOf) || asOf <= 0) {
      throw new TxlineHttpError(
        "SCORE_SNAPSHOT_TIMESTAMP_INVALID",
        "Historical score snapshot timestamp must be a positive integer."
      );
    }

    const query = new URLSearchParams({ asOf: String(asOf) });
    const payload = await this.#requestReplay(
      `/api/scores/snapshot/${encodeURIComponent(String(fixtureId))}?${query.toString()}`,
      externalSignal
    );
    const records = extractTxlineReplayRecords(payload, "scores", { fixtureId });
    if (records.length === 0) {
      throw new TxlineHttpError(
        "SCORE_SNAPSHOT_RECORDS_MISSING",
        "TxLINE score snapshot contained no direct score records after bounded envelope decoding."
      );
    }
    return records;
  }

  async #requestReplay(
    path: string,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMs);
    const signal =
      externalSignal === undefined
        ? timeoutSignal
        : AbortSignal.any([externalSignal, timeoutSignal]);

    try {
      let response = await this.#requestOnce(path, false, signal);
      if (response.status === 401) {
        await response.body?.cancel();
        response = await this.#requestOnce(path, true, signal);
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

      const text = await response.text();
      const contentType = response.headers.get("content-type");
      return parseTxlineReplayResponse(text, {
        status: response.status,
        ...(contentType === null ? {} : { contentType })
      });
    } catch (error) {
      if (error instanceof TxlineHttpError || error instanceof TxlineCredentialError) {
        throw error;
      }
      if (externalSignal?.aborted === true) {
        throw new TxlineHttpError("ABORTED", "TxLINE request was aborted.");
      }
      if (signal.aborted) {
        throw new TxlineHttpError("TIMEOUT", "TxLINE request timed out.");
      }
      throw new TxlineHttpError(
        "NETWORK_ERROR",
        "TxLINE network request failed."
      );
    }
  }

  async #requestOnce(
    path: string,
    refreshGuestJwt: boolean,
    signal: AbortSignal
  ): Promise<Response> {
    const headers = await this.#credentials.buildDataHeaders(
      "application/json",
      refreshGuestJwt,
      signal
    );
    return this.#fetchFn(new URL(path, this.#apiOrigin), {
      method: "GET",
      headers,
      signal
    });
  }
}
