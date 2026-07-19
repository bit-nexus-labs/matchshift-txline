import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MatchDefinition, MatchRecord } from "../core/types.js";
import { compareMatchRecords } from "../core/visibility.js";
import type { TxlineNetwork } from "./config.js";
import {
  buildCuratedMatchDefinition,
  CuratedReplayError,
  renderCuratedReplayModule,
  selectCuratedFixture,
  type CuratedFixtureSelector
} from "./curated-replay.js";
import { adaptHistoricalOddsPayload } from "./historical-odds-adapter.js";
import {
  TxlineConfigurationError,
  TxlineHttpClient,
  TxlineHttpError
} from "./http-client.js";
import {
  normalizeFixtures,
  normalizeOddsPayload,
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

const MINUTE_MS = 60_000;
const DEFAULT_DURATION_MINUTES = 120;
const DEFAULT_ODDS_SAMPLE_MINUTES = 10;
const DEFAULT_OUTPUT_PATH = "src/replay/curated-real-match.ts";
const DEFAULT_RECEIPT_PATH =
  "artifacts/private/txline-curated-replay-export-receipt.md";

type UnknownRecord = Record<string, unknown>;

export interface CuratedReplayExportClient {
  fetchFixturesSnapshot(
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

export interface CuratedReplayExportOptions {
  network: TxlineNetwork;
  client: CuratedReplayExportClient;
  selector: CuratedFixtureSelector;
  publicFixtureId: string;
  publicLabel: string;
  outputPath?: string;
  receiptPath?: string;
  competitionId?: string | number;
  durationMinutes?: number;
  oddsSampleMinutes?: number;
  requireOdds?: boolean;
  now?: number;
  commitSha?: string;
}

export interface CuratedReplayExportResult {
  match: MatchDefinition;
  receipt: string;
  outputPath: string;
  receiptPath: string;
  scoreRecordCount: number;
  oddsRecordCount: number;
  oddsSamplesAttempted: number;
  oddsSamplesSucceeded: number;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
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
  const leftSequence =
    readInteger(leftRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence =
    readInteger(rightRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const leftTimestamp =
    parseSourceTimestamp(leftRecord.ts ?? leftRecord.Ts) ??
    Number.MAX_SAFE_INTEGER;
  const rightTimestamp =
    parseSourceTimestamp(rightRecord.ts ?? rightRecord.Ts) ??
    Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

export function normalizeCuratedHistoricalScores(
  payload: unknown,
  fixture: NormalizedFixture,
  receivedTimestamp: number
): MatchRecord[] {
  const items = extractItems(payload).sort(rawScoreOrder);
  if (items.length === 0) {
    throw new CuratedReplayError(
      "CURATED_SCORE_HISTORY_EMPTY",
      "TxLINE historical scores returned no records for the curated fixture."
    );
  }

  const records: MatchRecord[] = [];
  let baselineFound = false;
  let latestSequence: number | undefined;

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
        latestSequence = recovery.sourceOrder?.sourceSequence;
        baselineFound = true;
      }
      continue;
    }

    const normalized = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp
    });
    if (normalized.disconnected || normalized.diagnostics.length > 0) {
      continue;
    }

    if (normalized.safeHold || normalized.issues.length > 0) {
      const recovery = normalizeScorePayload(item, {
        fixture,
        receivedTimestamp,
        snapshot: true
      });
      const recovered = recovery.records.find(
        (record) => record.kind === "recovery"
      );
      if (recovered === undefined) {
        throw new CuratedReplayError(
          "CURATED_SCORE_SCHEMA_INVALID",
          "A relevant historical score record could not be normalized safely."
        );
      }
      records.push(recovered);
      latestSequence = recovered.sourceOrder?.sourceSequence;
      continue;
    }

    for (const record of normalized.records) {
      const sequence = record.sourceOrder?.sourceSequence;
      const contiguous =
        sequence !== undefined &&
        latestSequence !== undefined &&
        sequence === latestSequence + 1;
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
          throw new CuratedReplayError(
            "CURATED_SCORE_SEQUENCE_UNTRUSTED",
            "Historical score ordering could not establish a trusted recovery baseline."
          );
        }
        records.push(recovered);
        latestSequence = recovered.sourceOrder?.sourceSequence;
        continue;
      }
      records.push(record);
      latestSequence = sequence;
    }
  }

  if (!baselineFound || records.length === 0) {
    throw new CuratedReplayError(
      "CURATED_SCORE_BASELINE_MISSING",
      "Historical scores did not contain a trusted nested-score baseline."
    );
  }
  return records.sort(compareMatchRecords);
}

export function buildCuratedOddsSampleTimestamps(input: {
  kickoffTimestamp: number;
  durationMinutes: number;
  sampleMinutes: number;
  scoreRecords: readonly MatchRecord[];
}): number[] {
  if (
    !Number.isSafeInteger(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    !Number.isSafeInteger(input.sampleMinutes) ||
    input.sampleMinutes <= 0
  ) {
    throw new CuratedReplayError(
      "CURATED_SAMPLE_INTERVAL_INVALID",
      "Curated replay duration and odds sample interval must be positive integers."
    );
  }

  const endTimestamp =
    input.kickoffTimestamp + input.durationMinutes * MINUTE_MS;
  const samples = new Set<number>([input.kickoffTimestamp, endTimestamp]);
  for (
    let timestamp = input.kickoffTimestamp + input.sampleMinutes * MINUTE_MS;
    timestamp < endTimestamp;
    timestamp += input.sampleMinutes * MINUTE_MS
  ) {
    samples.add(timestamp);
  }
  for (const record of input.scoreRecords) {
    samples.add(
      Math.min(
        endTimestamp,
        Math.max(input.kickoffTimestamp, record.sourceTimestamp)
      )
    );
  }
  return [...samples].sort((left, right) => left - right);
}

function normalizeCuratedOddsPayload(
  payload: unknown,
  fixture: NormalizedFixture,
  receivedTimestamp: number
): MatchRecord[] {
  const adapted = adaptHistoricalOddsPayload(payload);
  const records: MatchRecord[] = [];
  for (const item of extractItems(adapted)) {
    const normalized = normalizeOddsPayload(item, {
      fixture,
      receivedTimestamp
    });
    if (normalized.safeHold || normalized.issues.length > 0) {
      throw new CuratedReplayError(
        "CURATED_ODDS_SCHEMA_INVALID",
        "A claimed supported historical odds record could not be normalized safely."
      );
    }
    records.push(...normalized.records);
  }
  return records;
}

function shouldSkipOddsSampleError(error: unknown): boolean {
  if (error instanceof TxlineConfigurationError) {
    return false;
  }
  if (error instanceof TxlineHttpError) {
    return ["HTTP_ERROR", "INVALID_JSON", "TIMEOUT", "NETWORK_ERROR"].includes(
      error.code
    );
  }
  return false;
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

function renderReceipt(input: {
  network: TxlineNetwork;
  scoreRecordCount: number;
  oddsRecordCount: number;
  oddsSamplesAttempted: number;
  oddsSamplesSucceeded: number;
  curatedRecordCount: number;
  outputPath: string;
  commitSha: string;
  verifiedAt: string;
}): string {
  return [
    "TXLINE CURATED COMPLETED-MATCH EXPORT: PASS",
    "",
    `Network: ${input.network}`,
    "Completed fixture selected: PASS",
    "Historical score normalization: PASS",
    `Normalized score records: ${input.scoreRecordCount}`,
    `Odds samples attempted: ${input.oddsSamplesAttempted}`,
    `Odds samples with supported records: ${input.oddsSamplesSucceeded}`,
    `Normalized odds records before curation: ${input.oddsRecordCount}`,
    `Curated product records: ${input.curatedRecordCount}`,
    "Spoiler-safe MatchShift model validation: PASS",
    "Provider identifiers removed: PASS",
    "Raw provider payload logged: NO",
    "Raw provider payload persisted: NO",
    "Downloadable provider feed created: NO",
    "",
    `Generated module: ${input.outputPath}`,
    `Commit: ${input.commitSha}`,
    `Verified at UTC: ${input.verifiedAt}`,
    ""
  ].join("\n");
}

export async function exportCuratedCompletedMatch(
  options: CuratedReplayExportOptions
): Promise<CuratedReplayExportResult> {
  const now = options.now ?? Date.now();
  const durationMinutes = options.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const oddsSampleMinutes =
    options.oddsSampleMinutes ?? DEFAULT_ODDS_SAMPLE_MINUTES;
  const outputPath = options.outputPath?.trim() || DEFAULT_OUTPUT_PATH;
  const receiptPath = options.receiptPath?.trim() || DEFAULT_RECEIPT_PATH;

  const fixturePayload = await options.client.fetchFixturesSnapshot(
    options.competitionId
  );
  const fixture = selectCuratedFixture(
    normalizeFixtures(fixturePayload),
    options.selector
  );
  if (fixture.startTimestamp >= now) {
    throw new CuratedReplayError(
      "CURATED_FIXTURE_NOT_COMPLETED",
      "The selected fixture has not started yet and cannot be exported as a completed replay."
    );
  }

  const scorePayload = await options.client.fetchScoresHistorical(
    fixture.fixtureId
  );
  const scoreRecords = normalizeCuratedHistoricalScores(
    scorePayload,
    fixture,
    now
  );
  const sampleTimestamps = buildCuratedOddsSampleTimestamps({
    kickoffTimestamp: fixture.startTimestamp,
    durationMinutes,
    sampleMinutes: oddsSampleMinutes,
    scoreRecords
  });

  const oddsRecords: MatchRecord[] = [];
  let oddsSamplesSucceeded = 0;
  for (const asOf of sampleTimestamps) {
    try {
      const payload = await options.client.fetchOddsSnapshotAt(
        fixture.fixtureId,
        asOf
      );
      const normalized = normalizeCuratedOddsPayload(payload, fixture, now);
      if (normalized.length > 0) {
        oddsSamplesSucceeded += 1;
        oddsRecords.push(...normalized);
      }
    } catch (error) {
      if (!shouldSkipOddsSampleError(error)) {
        throw error;
      }
    }
  }

  if (options.requireOdds === true && oddsRecords.length === 0) {
    throw new CuratedReplayError(
      "CURATED_SUPPORTED_ODDS_MISSING",
      "No supported full-match winner odds were found in the sampled completed-match window."
    );
  }

  const match = buildCuratedMatchDefinition({
    fixture,
    scoreRecords,
    oddsRecords,
    publicFixtureId: options.publicFixtureId,
    publicLabel: options.publicLabel,
    durationMinutes
  });
  const moduleText = renderCuratedReplayModule(match);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, moduleText, { encoding: "utf8" });

  const verifiedAt = new Date(now).toISOString();
  const receipt = renderReceipt({
    network: options.network,
    scoreRecordCount: scoreRecords.length,
    oddsRecordCount: oddsRecords.length,
    oddsSamplesAttempted: sampleTimestamps.length,
    oddsSamplesSucceeded,
    curatedRecordCount: match.records.length,
    outputPath,
    commitSha: resolveCommitSha(options.commitSha),
    verifiedAt
  });
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, receipt, { encoding: "utf8", mode: 0o600 });

  return {
    match,
    receipt,
    outputPath,
    receiptPath,
    scoreRecordCount: scoreRecords.length,
    oddsRecordCount: oddsRecords.length,
    oddsSamplesAttempted: sampleTimestamps.length,
    oddsSamplesSucceeded
  };
}

export function createCuratedReplayHttpClient(input: {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
}): CuratedReplayExportClient {
  return new TxlineHttpClient(input);
}
