import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import {
  TxlineConfigurationError,
  TxlineHttpError
} from "./http-client.js";
import { parseTxlineReplayResponse } from "./replay-http-source.js";
import { extractTxlineScoreActionRecords } from "./score-action-records.js";

export interface TxlineScoreHistoryWindowSourceOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

export class TxlineScoreHistoryWindowSource {
  readonly #apiOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #credentials: TxlineCredentials;

  constructor(options: TxlineScoreHistoryWindowSourceOptions) {
    this.#apiOrigin = options.apiOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#credentials = new TxlineCredentials({
      apiOrigin: options.apiOrigin,
      apiToken: options.apiToken,
      fetchFn: this.#fetchFn
    });
  }

  async fetchBucket(
    epochDay: number,
    hourOfDay: number,
    interval: number,
    fixtureId: string | number,
    externalSignal?: AbortSignal
  ): Promise<unknown[]> {
    if (!Number.isSafeInteger(epochDay) || epochDay < 0) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_BUCKET_INVALID",
        "Historical score epoch day must be a non-negative integer."
      );
    }
    if (!Number.isSafeInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_BUCKET_INVALID",
        "Historical score hour must be an integer from 0 through 23."
      );
    }
    if (!Number.isSafeInteger(interval) || interval < 0 || interval > 11) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_BUCKET_INVALID",
        "Historical score interval must be the 0-indexed five-minute bucket 0 through 11."
      );
    }

    const query = new URLSearchParams({ fixtureId: String(fixtureId) });
    const payload = await this.#requestReplay(
      `/api/scores/updates/${epochDay}/${hourOfDay}/${interval}?${query.toString()}`,
      externalSignal
    );
    return extractTxlineScoreActionRecords(payload);
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
