import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import {
  TxlineConfigurationError,
  TxlineHttpError
} from "./http-client.js";

const MAX_REPLAY_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_UNWRAP_DEPTH = 12;
const MAX_REPLAY_UNWRAP_NODES = 250_000;

export interface TxlineReplayHttpSourceOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

interface ReplayResponseMetadata {
  status: number;
  contentType?: string;
}

interface ReplayRecordContext {
  fixtureId?: string | number;
}

type ReplayRecordKind = "scores" | "odds";
type UnknownRecord = Record<string, unknown>;

function normalizedContentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || "missing";
}

function invalidReplayResponse(
  code: string,
  message: string,
  metadata: ReplayResponseMetadata,
  byteLength: number
): TxlineHttpError {
  return new TxlineHttpError(
    code,
    `${message} (status ${metadata.status}, content-type ${normalizedContentType(metadata.contentType)}, bytes ${byteLength}).`,
    metadata.status
  );
}

function flattenParsedValue(target: unknown[], value: unknown): void {
  if (Array.isArray(value)) {
    target.push(...value);
    return;
  }
  target.push(value);
}

function parseSseFrames(
  text: string,
  metadata: ReplayResponseMetadata,
  byteLength: number
): unknown[] {
  const values: unknown[] = [];
  const frames = text.split(/\r?\n\r?\n/);

  for (const frame of frames) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => {
        const value = line.slice(5);
        return value.startsWith(" ") ? value.slice(1) : value;
      });

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines.join("\n").trim();
    if (payload === "" || payload === "[DONE]") {
      continue;
    }

    try {
      flattenParsedValue(values, JSON.parse(payload) as unknown);
    } catch {
      throw invalidReplayResponse(
        "INVALID_SSE_JSON",
        "TxLINE historical SSE contained a malformed JSON data frame",
        metadata,
        byteLength
      );
    }
  }

  if (values.length === 0) {
    throw invalidReplayResponse(
      "EMPTY_SSE_DATA",
      "TxLINE historical SSE contained no JSON data frames",
      metadata,
      byteLength
    );
  }

  return values;
}

export function parseTxlineReplayResponse(
  text: string,
  metadata: ReplayResponseMetadata
): unknown {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const byteLength = Buffer.byteLength(text, "utf8");

  if (byteLength > MAX_REPLAY_RESPONSE_BYTES) {
    throw invalidReplayResponse(
      "REPLAY_RESPONSE_TOO_LARGE",
      "TxLINE historical response exceeded the local safety limit",
      metadata,
      byteLength
    );
  }

  if (normalizedContentType(metadata.contentType) === "text/event-stream") {
    return parseSseFrames(normalized, metadata, byteLength);
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    throw invalidReplayResponse(
      "INVALID_JSON",
      "TxLINE returned an invalid JSON response",
      metadata,
      byteLength
    );
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function hasAnyKey(record: UnknownRecord, keys: readonly string[]): boolean {
  return keys.some((key) => Object.hasOwn(record, key));
}

function isScoreUpdateRecord(record: UnknownRecord): boolean {
  return (
    hasAnyKey(record, ["fixtureId", "FixtureId"]) &&
    hasAnyKey(record, ["seq", "Seq"]) &&
    hasAnyKey(record, ["ts", "Ts"]) &&
    hasAnyKey(record, ["scoreSoccer", "ScoreSoccer", "score", "Score"])
  );
}

function isOddsUpdateRecord(record: UnknownRecord): boolean {
  return (
    hasAnyKey(record, ["ts", "Ts"]) &&
    hasAnyKey(record, ["SuperOddsType", "superOddsType"]) &&
    hasAnyKey(record, ["PriceNames", "priceNames"]) &&
    hasAnyKey(record, ["Prices", "prices", "Pct", "pct"])
  );
}

function canonicalizeHistoricalScoreRecord(record: UnknownRecord): UnknownRecord {
  const scoreSoccer =
    record.scoreSoccer ?? record.ScoreSoccer ?? record.score ?? record.Score;
  const dataSoccer =
    record.dataSoccer ?? record.DataSoccer ?? record.data ?? record.Data;
  const alreadyHasScoreAlias = hasAnyKey(record, ["scoreSoccer", "ScoreSoccer"]);
  const alreadyHasDataAlias = hasAnyKey(record, ["dataSoccer", "DataSoccer"]);

  return {
    ...record,
    ...(alreadyHasScoreAlias || scoreSoccer === undefined ? {} : { scoreSoccer }),
    ...(alreadyHasDataAlias || dataSoccer === undefined ? {} : { dataSoccer })
  };
}

function canonicalizeHistoricalOddsRecord(
  record: UnknownRecord,
  context: ReplayRecordContext
): UnknownRecord {
  const hasFixtureId =
    record.fixtureId !== undefined || record.FixtureId !== undefined;
  return {
    ...record,
    ...(hasFixtureId || context.fixtureId === undefined
      ? {}
      : { FixtureId: context.fixtureId })
  };
}

function tryParseNestedJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    trimmed.length < 2 ||
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function extractTxlineReplayRecords(
  payload: unknown,
  kind: ReplayRecordKind,
  context: ReplayRecordContext = {}
): unknown[] {
  const records: unknown[] = [];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  const visit = (value: unknown, depth: number): void => {
    visitedNodes += 1;
    if (
      visitedNodes > MAX_REPLAY_UNWRAP_NODES ||
      depth > MAX_REPLAY_UNWRAP_DEPTH
    ) {
      return;
    }

    if (typeof value === "string") {
      const nested = tryParseNestedJson(value);
      if (nested !== undefined) {
        visit(nested, depth + 1);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    const record = asRecord(value);
    if (record === undefined || seen.has(record)) {
      return;
    }
    seen.add(record);

    const matches =
      kind === "scores"
        ? isScoreUpdateRecord(record)
        : isOddsUpdateRecord(record);
    if (matches) {
      records.push(
        kind === "scores"
          ? canonicalizeHistoricalScoreRecord(record)
          : canonicalizeHistoricalOddsRecord(record, context)
      );
      return;
    }

    for (const nested of Object.values(record)) {
      visit(nested, depth + 1);
    }
  };

  visit(payload, 0);
  return records;
}

function missingReplayRecords(kind: ReplayRecordKind): TxlineHttpError {
  const label = kind === "scores" ? "score update" : "odds update";
  return new TxlineHttpError(
    kind === "scores" ? "SCORE_RECORDS_MISSING" : "ODDS_RECORDS_MISSING",
    `TxLINE historical replay contained no direct ${label} records after bounded envelope decoding.`
  );
}

export class TxlineReplayHttpSource {
  readonly #apiOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #credentials: TxlineCredentials;

  constructor(options: TxlineReplayHttpSourceOptions) {
    this.#apiOrigin = options.apiOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#credentials = new TxlineCredentials({
      apiOrigin: options.apiOrigin,
      apiToken: options.apiToken,
      fetchFn: this.#fetchFn
    });
  }

  async fetchScoresHistorical(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const payload = await this.#requestReplay(
      `/api/scores/historical/${encodeURIComponent(String(fixtureId))}`,
      signal
    );
    const records = extractTxlineReplayRecords(payload, "scores");
    if (records.length === 0) {
      throw missingReplayRecords("scores");
    }
    return records;
  }

  async fetchOddsSnapshotAt(
    fixtureId: string | number,
    asOf: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const query = new URLSearchParams({ asOf: String(asOf) });
    const payload = await this.#requestReplay(
      `/api/odds/snapshot/${encodeURIComponent(String(fixtureId))}?${query.toString()}`,
      signal
    );
    const records = extractTxlineReplayRecords(payload, "odds", { fixtureId });
    if (records.length === 0) {
      throw missingReplayRecords("odds");
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
