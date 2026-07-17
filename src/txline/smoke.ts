import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deriveVisibleMatchState } from "../core/derive-state.js";
import { createViewerSession } from "../core/session-machine.js";
import type { MatchDefinition, MatchRecord } from "../core/types.js";
import {
  compareMatchRecords,
  recordsVisibleAtCursor
} from "../core/visibility.js";
import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import { TxlineHttpClient } from "./http-client.js";
import {
  normalizeFixtures,
  normalizeOddsPayload,
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";
import { sanitizedErrorMessage } from "./redaction.js";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const HISTORICAL_MIN_AGE_MS = 6 * HOUR_MS;
const HISTORICAL_MAX_AGE_MS = 14 * DAY_MS;

export interface HistoricalSmokeClient {
  fetchFixturesSnapshotForDay(
    startEpochDay: number,
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<unknown>;
  fetchScoresHistorical(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown>;
  fetchOddsSnapshotAt(
    fixtureId: string | number,
    asOf: number,
    signal?: AbortSignal
  ): Promise<unknown>;
}

export interface HistoricalSmokeOptions {
  network: TxlineNetwork;
  fixtureId?: string;
  competitionId?: string | number;
  now?: number;
  client: HistoricalSmokeClient;
  commitSha?: string;
}

export interface HistoricalSmokeResult {
  receipt: string;
  selectedFixtureStartTimestamp: number;
  earlyCursor: number;
  liveEdgeTimestamp: number;
  recordCount: number;
}

export class TxlineSmokeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TxlineSmokeError";
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record === undefined) {
    return [];
  }
  for (const key of ["data", "fixtures", "scores", "odds"]) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [record];
}

function readInteger(record: UnknownRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function rawScoreOrder(left: unknown, right: unknown): number {
  const leftRecord = asRecord(left) ?? {};
  const rightRecord = asRecord(right) ?? {};
  const leftSequence = readInteger(leftRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = readInteger(rightRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const leftTimestamp = parseSourceTimestamp(leftRecord.ts ?? leftRecord.Ts) ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = parseSourceTimestamp(rightRecord.ts ?? rightRecord.Ts) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

function selectHistoricalFixture(
  fixtures: readonly NormalizedFixture[],
  now: number,
  requestedFixtureId?: string
): NormalizedFixture {
  const oldestAllowed = now - HISTORICAL_MAX_AGE_MS;
  const newestAllowed = now - HISTORICAL_MIN_AGE_MS;
  const eligible = fixtures
    .filter(
      (fixture) =>
        fixture.selectionState === "SELECTABLE" &&
        fixture.startTimestamp >= oldestAllowed &&
        fixture.startTimestamp <= newestAllowed
    )
    .sort((left, right) => right.startTimestamp - left.startTimestamp);

  if (requestedFixtureId !== undefined) {
    const selected = eligible.find(
      (fixture) => fixture.fixtureId === requestedFixtureId
    );
    if (selected === undefined) {
      throw new TxlineSmokeError(
        "FIXTURE_NOT_ELIGIBLE",
        "The configured fixture is unavailable or outside the historical replay window."
      );
    }
    return selected;
  }

  const selected = eligible[0];
  if (selected === undefined) {
    throw new TxlineSmokeError(
      "NO_HISTORICAL_FIXTURE",
      "No selectable fixture was found between six hours and two weeks in the past."
    );
  }
  return selected;
}

function normalizeHistoricalScores(
  payload: unknown,
  fixture: NormalizedFixture,
  receivedTimestamp: number
): MatchRecord[] {
  const items = extractItems(payload).sort(rawScoreOrder);
  if (items.length === 0) {
    throw new TxlineSmokeError(
      "EMPTY_SCORE_HISTORY",
      "TxLINE historical scores returned no records."
    );
  }

  const records: MatchRecord[] = [];
  let baselineFound = false;
  let latestScoreSequence: number | undefined;

  for (const item of items) {
    if (!baselineFound) {
      const baseline = normalizeScorePayload(item, {
        fixture,
        receivedTimestamp,
        snapshot: true
      });
      const recovery = baseline.records.find(
        (record) => record.kind === "recovery"
      );
      if (recovery !== undefined) {
        records.push(recovery);
        latestScoreSequence = recovery.sourceOrder?.sourceSequence;
        baselineFound = true;
      }
      continue;
    }

    const normalized = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp
    });
    if (normalized.disconnected) {
      continue;
    }
    if (normalized.safeHold || normalized.issues.length > 0) {
      const recovery = normalizeScorePayload(item, {
        fixture,
        receivedTimestamp,
        snapshot: true
      });
      if (recovery.safeHold || recovery.records.length === 0) {
        throw new TxlineSmokeError(
          "SCORE_SCHEMA_INVALID",
          "A relevant historical score record could not be normalized safely."
        );
      }
      const recovered = recovery.records[0]!;
      records.push(recovered);
      latestScoreSequence = recovered.sourceOrder?.sourceSequence;
      continue;
    }

    for (const record of normalized.records) {
      const sequence = record.sourceOrder?.sourceSequence;
      const contiguous =
        sequence !== undefined &&
        latestScoreSequence !== undefined &&
        sequence === latestScoreSequence + 1;
      if (!contiguous) {
        const recovery = normalizeScorePayload(item, {
          fixture,
          receivedTimestamp,
          snapshot: true
        });
        const recovered = recovery.records.find(
          (candidate) => candidate.kind === "recovery"
        );
        if (recovered === undefined) {
          throw new TxlineSmokeError(
            "SCORE_SEQUENCE_UNTRUSTED",
            "Historical score ordering could not establish a trusted recovery baseline."
          );
        }
        records.push(recovered);
        latestScoreSequence = recovered.sourceOrder?.sourceSequence;
        continue;
      }
      records.push(record);
      latestScoreSequence = sequence;
    }
  }

  if (!baselineFound || records.length === 0) {
    throw new TxlineSmokeError(
      "SCORE_BASELINE_MISSING",
      "Historical scores did not contain a trusted nested-score baseline."
    );
  }
  return records;
}

function normalizeHistoricalOdds(
  payloads: readonly unknown[],
  fixture: NormalizedFixture,
  receivedTimestamp: number
): MatchRecord[] {
  const records: MatchRecord[] = [];
  for (const payload of payloads) {
    for (const item of extractItems(payload)) {
      const normalized = normalizeOddsPayload(item, {
        fixture,
        receivedTimestamp
      });
      if (normalized.safeHold || normalized.issues.length > 0) {
        throw new TxlineSmokeError(
          "ODDS_SCHEMA_INVALID",
          "A claimed supported historical odds market could not be normalized safely."
        );
      }
      records.push(...normalized.records);
    }
  }
  if (records.length === 0) {
    throw new TxlineSmokeError(
      "SUPPORTED_ODDS_MISSING",
      "No supported full-match winner odds were found for the historical fixture."
    );
  }
  return records;
}

function resolveCommitSha(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== "") {
    return explicit.trim();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNKNOWN";
  }
}

export function renderHistoricalSmokeReceipt(input: {
  network: TxlineNetwork;
  commitSha: string;
  verifiedAt: string;
}): string {
  return [
    "TXLINE INTEGRATION SMOKE: PASS",
    "",
    `Network: ${input.network}`,
    "Historical input: PASS",
    "Live input record: NOT RUN",
    "Solana provenance: NOT RUN",
    "",
    "Authenticated API access: PASS",
    "Fixture schema: PASS",
    "Score schema: PASS",
    "Odds schema: PASS",
    "TxLINE normalizer: PASS",
    "Session cursor gate: PASS",
    "Future-event isolation: PASS",
    "",
    `Commit: ${input.commitSha}`,
    `Verified at UTC: ${input.verifiedAt}`,
    "",
    "Raw payload logged: NO",
    "Raw payload persisted: NO",
    "TxLINE data published: NO",
    "Receipt allowlist validation: PASS",
    ""
  ].join("\n");
}

export function validateReceiptAllowlist(receipt: string): void {
  const forbidden = [
    /fixtureId/i,
    /participant\d/i,
    /Bearer\s+/i,
    /X-Api-Token/i,
    /https?:\/\//i,
    /\{[\s\S]*\}/,
    /\[[\s\S]*\]/
  ];
  if (forbidden.some((pattern) => pattern.test(receipt))) {
    throw new TxlineSmokeError(
      "RECEIPT_ALLOWLIST_FAILED",
      "The generated receipt contained a forbidden data-shaped value."
    );
  }
}

export async function runHistoricalSmoke(
  options: HistoricalSmokeOptions
): Promise<HistoricalSmokeResult> {
  const now = options.now ?? Date.now();
  const startEpochDay = Math.floor((now - HISTORICAL_MAX_AGE_MS) / DAY_MS);

  const fixturePayload = await options.client.fetchFixturesSnapshotForDay(
    startEpochDay,
    options.competitionId
  );
  const fixtures = normalizeFixtures(fixturePayload);
  if (fixtures.length === 0) {
    throw new TxlineSmokeError(
      "FIXTURE_SCHEMA_INVALID",
      "TxLINE fixture snapshot contained no valid documented fixture records."
    );
  }
  const fixture = selectHistoricalFixture(fixtures, now, options.fixtureId);

  const scoresPayload = await options.client.fetchScoresHistorical(
    fixture.fixtureId
  );
  const scoreRecords = normalizeHistoricalScores(scoresPayload, fixture, now);
  const scoreTimestamps = scoreRecords.map((record) => record.sourceTimestamp);
  const earlyOddsAsOf = Math.max(
    fixture.startTimestamp,
    Math.min(...scoreTimestamps)
  );
  const lateOddsAsOf = Math.max(...scoreTimestamps);
  const [earlyOddsPayload, lateOddsPayload] = await Promise.all([
    options.client.fetchOddsSnapshotAt(fixture.fixtureId, earlyOddsAsOf),
    options.client.fetchOddsSnapshotAt(fixture.fixtureId, lateOddsAsOf)
  ]);
  const oddsRecords = normalizeHistoricalOdds(
    [earlyOddsPayload, lateOddsPayload],
    fixture,
    now
  );

  const records = [...scoreRecords, ...oddsRecords].sort(compareMatchRecords);
  const liveEdgeTimestamp = Math.max(
    ...records.map((record) => record.sourceTimestamp)
  );
  const earlyCursor = records.find(
    (record) => record.sourceTimestamp < liveEdgeTimestamp
  )?.sourceTimestamp;
  if (earlyCursor === undefined) {
    throw new TxlineSmokeError(
      "NO_CURSOR_BOUNDARY",
      "The historical fixture did not contain two distinct visibility timestamps."
    );
  }

  const match: MatchDefinition = {
    fixtureId: fixture.fixtureId,
    label: "TxLINE historical smoke fixture",
    provenance: "TXLINE",
    kickoffTimestamp: fixture.startTimestamp,
    liveEdgeTimestamp,
    records
  };
  const earlySession = createViewerSession({
    sessionId: "txline-smoke-early",
    fixtureId: fixture.fixtureId,
    mode: "DELAYED",
    liveEdgeTimestamp,
    visibilityCursor: earlyCursor
  });
  const liveSession = createViewerSession({
    sessionId: "txline-smoke-live",
    fixtureId: fixture.fixtureId,
    mode: "LIVE",
    liveEdgeTimestamp
  });
  const earlyState = deriveVisibleMatchState(match, earlySession);
  const liveState = deriveVisibleMatchState(match, liveSession);
  const earlyRecords = recordsVisibleAtCursor(records, earlyCursor);
  const futureRecords = records.filter(
    (record) => record.sourceTimestamp > earlyCursor
  );
  const futureEventIds = futureRecords
    .filter((record) => record.kind === "event")
    .map((record) => record.recordId);
  const serializedEarlyState = JSON.stringify(earlyState);

  if (
    earlyRecords.some((record) => record.sourceTimestamp > earlyCursor) ||
    futureRecords.length === 0 ||
    futureEventIds.some((eventId) => serializedEarlyState.includes(eventId)) ||
    earlyState.session.visibilityCursor >= liveState.session.visibilityCursor
  ) {
    throw new TxlineSmokeError(
      "FUTURE_ISOLATION_FAILED",
      "The early viewer session received information beyond its visibility cursor."
    );
  }

  const verifiedAt = new Date(now).toISOString();
  const receipt = renderHistoricalSmokeReceipt({
    network: options.network,
    commitSha: resolveCommitSha(options.commitSha),
    verifiedAt
  });
  validateReceiptAllowlist(receipt);

  return {
    receipt,
    selectedFixtureStartTimestamp: fixture.startTimestamp,
    earlyCursor,
    liveEdgeTimestamp,
    recordCount: records.length
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TxlineSmokeError(
      "INVALID_CONFIGURATION",
      "A numeric smoke-test environment variable was invalid."
    );
  }
  return parsed;
}

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "devnet" || normalized === "mainnet") {
    return normalized;
  }
  throw new TxlineSmokeError(
    "INVALID_CONFIGURATION",
    "TXLINE_NETWORK must be devnet or mainnet."
  );
}

export async function runHistoricalSmokeFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<HistoricalSmokeResult> {
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    throw new TxlineSmokeError(
      "INVALID_CONFIGURATION",
      "TXLINE_API_TOKEN is required for the historical smoke test."
    );
  }
  const requestTimeoutMs = readPositiveInteger(
    env.TXLINE_REQUEST_TIMEOUT_MS,
    30_000
  );
  const fixtureId = env.TXLINE_FIXTURE_ID?.trim();
  const competitionId = env.TXLINE_COMPETITION_ID?.trim();
  const client = new TxlineHttpClient({
    apiOrigin: resolveTxlineOrigin(network),
    apiToken,
    requestTimeoutMs
  });

  return runHistoricalSmoke({
    network,
    client,
    ...(fixtureId === undefined || fixtureId === "" ? {} : { fixtureId }),
    ...(competitionId === undefined || competitionId === ""
      ? {}
      : { competitionId })
  });
}

export async function writeHistoricalSmokeReceipt(
  result: HistoricalSmokeResult,
  path: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, result.receipt, { encoding: "utf8", mode: 0o600 });
}

export async function historicalSmokeCli(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await runHistoricalSmokeFromEnvironment(env);
    const receiptPath =
      env.TXLINE_SMOKE_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-smoke-receipt.md";
    await writeHistoricalSmokeReceipt(result, receiptPath);
    process.stdout.write("TXLINE HISTORICAL SMOKE: PASS\n");
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE HISTORICAL SMOKE: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}
