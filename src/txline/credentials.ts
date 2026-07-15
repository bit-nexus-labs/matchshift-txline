import { redactSensitiveText } from "./redaction.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export class TxlineCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxlineCredentialError";
  }
}

export interface TxlineCredentialsOptions {
  apiOrigin: string;
  apiToken: string;
  fetchFn?: FetchLike;
}

export class TxlineCredentials {
  readonly #apiOrigin: string;
  readonly #apiToken: string;
  readonly #fetchFn: FetchLike;
  #guestJwt: string | undefined;

  constructor(options: TxlineCredentialsOptions) {
    this.#apiOrigin = options.apiOrigin;
    this.#apiToken = options.apiToken;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async buildDataHeaders(
    accept: "application/json" | "text/event-stream",
    refreshGuestJwt: boolean,
    signal?: AbortSignal
  ): Promise<Headers> {
    const guestJwt = await this.getGuestJwt(refreshGuestJwt, signal);
    const headers = new Headers({
      Accept: accept,
      Authorization: `Bearer ${guestJwt}`,
      "X-Api-Token": this.#apiToken
    });
    if (accept === "text/event-stream") {
      headers.set("Cache-Control", "no-cache");
    }
    return headers;
  }

  sanitize(value: string): string {
    return redactSensitiveText(value, [
      this.#apiToken,
      ...(this.#guestJwt === undefined ? [] : [this.#guestJwt])
    ]);
  }

  private async getGuestJwt(
    refresh: boolean,
    signal?: AbortSignal
  ): Promise<string> {
    if (!refresh && this.#guestJwt !== undefined) {
      return this.#guestJwt;
    }

    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#apiOrigin}/auth/guest/start`, {
        method: "POST",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal })
      });
    } catch {
      throw new TxlineCredentialError("Guest JWT acquisition failed.");
    }

    if (!response.ok) {
      throw new TxlineCredentialError(
        `Guest JWT acquisition failed with status ${response.status}.`
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TxlineCredentialError("Guest JWT response was not valid JSON.");
    }

    const token =
      typeof body === "object" &&
      body !== null &&
      "token" in body &&
      typeof body.token === "string"
        ? body.token
        : undefined;
    if (token === undefined || token === "") {
      throw new TxlineCredentialError(
        "Guest JWT response did not contain a token."
      );
    }

    this.#guestJwt = token;
    return token;
  }
}
