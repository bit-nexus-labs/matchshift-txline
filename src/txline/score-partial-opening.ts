import { TxlineHttpError } from "./http-client.js";
import {
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

export const PARTIAL_OPENING_COVERAGE = "PARTIAL_OPENING" as const;
export const PARTIAL_OPENING_ACTION = "curated_partial_opening_baseline";

const COVERAGE_KEY = "MatchShiftCoverage";

type UnknownRecord = Record<string, unknown>;

export interface PartialOpeningCoverageMarker {
  scoreHistory: typeof PARTIAL_OPENING_COVERAGE;
  providerScoreStartTimestamp: number;
}

interface TrustedOpening {
  index: number;
  sourceSequence: number;
  sourceTimestamp: number;
  home: number;
  away: number;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
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

function timestampOf(value: unknown): number | undefined {
  const record = asRecord(value);
  return record === undefined
    ? undefined
    : parseSourceTimestamp(record.ts ?? record.Ts);
}

function directOrder(left: unknown, right: unknown): number {
  const leftRecord = asRecord(left) ?? {};
  const rightRecord = asRecord(right) ?? {};
  const leftSequence =
    readInteger(leftRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence =
    readInteger(rightRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const leftTimestamp = timestampOf(left) ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = timestampOf(right) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

function firstTrustedOpening(
  ordered: readonly unknown[],
  fixture: NormalizedFixture
): TrustedOpening | undefined {
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index]!;
    const normalized = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp,
      snapshot: true
    });
    const recovery = normalized.records.find((record) => record.kind === "recovery");
    const sourceSequence = recovery?.sourceOrder?.sourceSequence;
    if (recovery === undefined || sourceSequence === undefined) {
      continue;
    }
    return {
      index,
      sourceSequence,
      sourceTimestamp: recovery.sourceTimestamp,
      home: recovery.snapshot.score.home,
      away: recovery.snapshot.score.away
    };
  }
  return undefined;
}

function baselineScore(fixture: NormalizedFixture): UnknownRecord {
  const participant1 = fixture.participant1IsHome ? 0 : 0;
  const participant2 = fixture.participant1IsHome ? 0 : 0;
  return {
    Participant1: { Total: { Goals: participant1 } },
    Participant2: { Total: { Goals: participant2 } }
  };
}

export function buildDisclosedPartialOpeningHistory(
  records: readonly unknown[],
  fixture: NormalizedFixture
): unknown[] {
  const ordered = [...records].sort(directOrder);
  const opening = firstTrustedOpening(ordered, fixture);
  if (opening === undefined) {
    throw new TxlineHttpError(
      "SCORE_PARTIAL_OPENING_UNAVAILABLE",
      "Partial opening fallback found no trusted provider score snapshot."
    );
  }
  if (opening.home === 0 && opening.away === 0) {
    throw new TxlineHttpError(
      "SCORE_PARTIAL_OPENING_NOT_NEEDED",
      "Partial opening fallback was requested for an already complete 0-0 history."
    );
  }
  if (
    opening.sourceSequence <= 1 ||
    opening.sourceTimestamp <= fixture.startTimestamp
  ) {
    throw new TxlineHttpError(
      "SCORE_PARTIAL_OPENING_UNAVAILABLE",
      "The first trusted provider score did not leave a safe ordered opening boundary."
    );
  }

  const coverage: PartialOpeningCoverageMarker = {
    scoreHistory: PARTIAL_OPENING_COVERAGE,
    providerScoreStartTimestamp: opening.sourceTimestamp
  };
  const baseline: UnknownRecord = {
    FixtureId: fixture.fixtureId,
    MessageId: `curated-partial-opening-baseline-${fixture.startTimestamp}`,
    Seq: opening.sourceSequence - 1,
    Ts: fixture.startTimestamp,
    Action: PARTIAL_OPENING_ACTION,
    ScoreSoccer: baselineScore(fixture),
    [COVERAGE_KEY]: coverage
  };

  return [baseline, ...ordered.slice(opening.index)].sort(directOrder);
}

export function readPartialOpeningCoverage(
  payload: unknown
): PartialOpeningCoverageMarker | undefined {
  const values = Array.isArray(payload) ? payload : [payload];
  for (const value of values) {
    const marker = asRecord(asRecord(value)?.[COVERAGE_KEY]);
    if (
      marker?.scoreHistory === PARTIAL_OPENING_COVERAGE &&
      Number.isSafeInteger(marker.providerScoreStartTimestamp)
    ) {
      return {
        scoreHistory: PARTIAL_OPENING_COVERAGE,
        providerScoreStartTimestamp: marker.providerScoreStartTimestamp as number
      };
    }
  }
  return undefined;
}
