import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import { TxlineHttpError } from "./http-client.js";
import {
  parsePrivateRawCaptureBody,
  type PrivateRawCaptureResponse
} from "./private-raw-capture.js";

export type PrivateCaptureAccept = "application/json" | "text/event-stream";

export class PrivateRawRequester {
  readonly #apiOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #credentials: TxlineCredentials;

  constructor(options: {
    apiOrigin: string;
    apiToken: string;
    requestTimeoutMs: number;
    fetchFn?: FetchLike;
  }) {
    this.#apiOrigin = options.apiOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#credentials = new TxlineCredentials(options);
  }

  sanitize(value: string): string {
    return this.#credentials.sanitize(value);
  }

  async capture(
    label: string,
    requestPath: string,
    accept: PrivateCaptureAccept = "application/json"
  ): Promise<PrivateRawCaptureResponse> {
    const requestedAtUtc = new Date().toISOString();
    const signal = AbortSignal.timeout(this.#requestTimeoutMs);
    let attempts = 1;

    try {
      let response = await this.#requestOnce(requestPath, accept, false, signal);
      if (response.status === 401) {
        await response.body?.cancel();
        attempts = 2;
        response = await this.#requestOnce(requestPath, accept, true, signal);
      }

      const bodyText = await response.text();
      const contentType = response.headers.get("content-type") ?? undefined;
      const contentLengthHeader =
        response.headers.get("content-length") ?? undefined;

      return {
        label,
        method: "GET",
        path: requestPath,
        accept,
        requestedAtUtc,
        attempts,
        status: response.status,
        ok: response.ok,
        ...(contentType === undefined ? {} : { contentType }),
        ...(contentLengthHeader === undefined ? {} : { contentLengthHeader }),
        byteLength: Buffer.byteLength(bodyText, "utf8"),
        bodyText,
        parse: parsePrivateRawCaptureBody(bodyText, contentType)
      };
    } catch (error) {
      if (error instanceof TxlineCredentialError || error instanceof TxlineHttpError) {
        throw error;
      }
      if (signal.aborted) {
        throw new TxlineHttpError(
          "TIMEOUT",
          "TxLINE private capture request timed out."
        );
      }
      throw new TxlineHttpError(
        "NETWORK_ERROR",
        "TxLINE private capture request failed."
      );
    }
  }

  async #requestOnce(
    requestPath: string,
    accept: PrivateCaptureAccept,
    refreshGuestJwt: boolean,
    signal: AbortSignal
  ): Promise<Response> {
    const headers = await this.#credentials.buildDataHeaders(
      accept,
      refreshGuestJwt,
      signal
    );
    return this.#fetchFn(new URL(requestPath, this.#apiOrigin), {
      method: "GET",
      headers,
      signal
    });
  }
}
