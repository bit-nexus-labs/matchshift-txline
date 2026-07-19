import { TxlineHttpError } from "./http-client.js";
import {
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const COARSE_SAMPLE_MS = 5 * MINUTE_MS;
const MIN_REFINEMENT_MS = SECOND_MS;
const MAX_SNAPSHOT_REQUESTS = 192;

type UnknownRecord = Record<string, unknown>;

interface ScoreState {
  home: number;
  away: number;
}

interface TrustedSnapshot {
  asOf: number;
  records: unknown[];
  score: ScoreState;
  sourceTimestamp: number;
}

export interface ScoreSnapshotRecoveryOptions {
  fixtureId: string | number;
  fixture: NormalizedFixture;
  startTimestamp: number;
  endTimestamp: number;
  baseRecords: readonly unknown[];
  fetchSnapshotAt(
    fixtureId: string | number,
    asOf: number,
    signal?: AbortSignal
  ): Promise<unknown[]>;
  signal?: AbortSignal;
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

function directTimestamp(value: unknown): number | undefined {
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
  const leftTimestamp = directTimestamp(left) ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = directTimestamp(right) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

function directIdentity(value: unknown): string {
  const record = asRecord(value) ?? {};
  const messageId = record.messageId ?? record.MessageId;
  if (typeof messageId === "string" && messageId !== "") {
    return `message:${messageId}`;
  }
  return JSON.stringify([
    record.fixtureId ?? record.FixtureId ?? null,
    record.seq ?? record.Seq ?? null,
    record.ts ?? record.Ts ?? null,
    record.scoreSoccer ?? record.ScoreSoccer ?? record.score ?? record.Score ?? null,
    record.dataSoccer ?? record.DataSoccer ?? record.data ?? record.Data ?? null
  ]);
}

export function mergeSnapshotScoreRecords(values: readonly unknown[]): unknown[] {
  const unique = new Map<string, unknown>();
  for (const value of values) {
    unique.set(directIdentity(value), value);
  }
  return [...unique.values()].sort(directOrder);
}

function latestTrustedSnapshot(
  asOf: number,
  records: readonly unknown[],
  fixture: NormalizedFixture
): TrustedSnapshot | undefined {
  let latest: TrustedSnapshot | undefined;
  for (const item of [...records].sort(directOrder)) {
    const normalized = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: asOf,
      snapshot: true
    });
    const recovery = normalized.records.find((record) => record.kind === "recovery");
    if (recovery === undefined) {
      continue;
    }
    latest = {
      asOf,
      records: [...records],
      score: { ...recovery.snapshot.score },
      sourceTimestamp: recovery.sourceTimestamp
    };
  }
  return latest;
}

function sameScore(left: ScoreState, right: ScoreState): boolean {
  return left.home === right.home && left.away === right.away;
}

function transitionIsComplete(left: ScoreState, right: ScoreState): boolean {
  const homeDelta = right.home - left.home;
  const awayDelta = right.away - left.away;
  return (
    (homeDelta === 0 && awayDelta === 0) ||
    (homeDelta >= 0 && awayDelta >= 0 && homeDelta + awayDelta === 1)
  );
}

function progressionStates(
  records: readonly unknown[],
  fixture: NormalizedFixture
): ScoreState[] {
  const states: ScoreState[] = [];
  for (const item of [...records].sort(directOrder)) {
    const normalized = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp,
      snapshot: true
    });
    const recovery = normalized.records.find((record) => record.kind === "recovery");
    if (recovery === undefined) {
      continue;
    }
    const score = recovery.snapshot.score;
    const previous = states.at(-1);
    if (previous === undefined || !sameScore(previous, score)) {
      states.push({ ...score });
    }
  }
  return states;
}

export function assertCompleteScoreProgression(
  records: readonly unknown[],
  fixture: NormalizedFixture
): void {
  const states = progressionStates(records, fixture);
  const first = states[0];
  if (first === undefined || first.home !== 0 || first.away !== 0) {
    throw new TxlineHttpError(
      "SCORE_HISTORY_INCOMPLETE",
      "Historical score progression did not contain a trusted 0-0 opening state."
    );
  }

  for (let index = 1; index < states.length; index += 1) {
    const previous = states[index - 1]!;
    const current = states[index]!;
    if (!transitionIsComplete(previous, current)) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_INCOMPLETE",
        `Historical score progression jumped from ${previous.home}-${previous.away} to ${current.home}-${current.away}; one or more score states were missing.`
      );
    }
  }
}

function seedTimestamps(startTimestamp: number, endTimestamp: number): number[] {
  const values = new Set<number>([startTimestamp, endTimestamp]);
  for (const offset of [
    SECOND_MS,
    5 * SECOND_MS,
    15 * SECOND_MS,
    30 * SECOND_MS,
    MINUTE_MS,
    2 * MINUTE_MS
  ]) {
    const timestamp = startTimestamp + offset;
    if (timestamp <= endTimestamp) {
      values.add(timestamp);
    }
  }
  for (
    let timestamp = startTimestamp + COARSE_SAMPLE_MS;
    timestamp < endTimestamp;
    timestamp += COARSE_SAMPLE_MS
  ) {
    values.add(timestamp);
  }
  return [...values].sort((left, right) => left - right);
}

export async function recoverCompleteScoreHistoryFromSnapshots(
  options: ScoreSnapshotRecoveryOptions
): Promise<unknown[]> {
  if (
    !Number.isSafeInteger(options.startTimestamp) ||
    !Number.isSafeInteger(options.endTimestamp) ||
    options.endTimestamp < options.startTimestamp
  ) {
    throw new TxlineHttpError(
      "SCORE_SNAPSHOT_WINDOW_INVALID",
      "Historical score snapshot recovery window was invalid."
    );
  }

  const cache = new Map<number, TrustedSnapshot | undefined>();
  const rawByTimestamp = new Map<number, unknown[]>();
  let requests = 0;

  const fetchPoint = async (asOf: number): Promise<TrustedSnapshot | undefined> => {
    if (cache.has(asOf)) {
      return cache.get(asOf);
    }
    if (requests >= MAX_SNAPSHOT_REQUESTS) {
      throw new TxlineHttpError(
        "SCORE_SNAPSHOT_REQUEST_LIMIT",
        "Historical score snapshot recovery exceeded its bounded request limit."
      );
    }
    requests += 1;

    let records: unknown[];
    try {
      records = await options.fetchSnapshotAt(
        options.fixtureId,
        asOf,
        options.signal
      );
    } catch (error) {
      if (
        error instanceof TxlineHttpError &&
        error.code === "SCORE_SNAPSHOT_RECORDS_MISSING"
      ) {
        records = [];
      } else {
        throw error;
      }
    }

    rawByTimestamp.set(asOf, records);
    const trusted = latestTrustedSnapshot(asOf, records, options.fixture);
    cache.set(asOf, trusted);
    return trusted;
  };

  for (const timestamp of seedTimestamps(
    options.startTimestamp,
    options.endTimestamp
  )) {
    await fetchPoint(timestamp);
  }

  const refine = async (
    left: TrustedSnapshot,
    right: TrustedSnapshot
  ): Promise<void> => {
    if (transitionIsComplete(left.score, right.score)) {
      return;
    }
    if (right.asOf - left.asOf <= MIN_REFINEMENT_MS) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_INCOMPLETE",
        `Historical score snapshots could not resolve the transition from ${left.score.home}-${left.score.away} to ${right.score.home}-${right.score.away}.`
      );
    }

    const midpoint = Math.floor((left.asOf + right.asOf) / 2);
    if (midpoint <= left.asOf || midpoint >= right.asOf) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_INCOMPLETE",
        "Historical score snapshot refinement reached an invalid midpoint."
      );
    }
    const middle = await fetchPoint(midpoint);
    if (middle === undefined) {
      throw new TxlineHttpError(
        "SCORE_HISTORY_INCOMPLETE",
        "Historical score snapshot refinement returned no trusted score state."
      );
    }
    await refine(left, middle);
    await refine(middle, right);
  };

  let trustedPoints = [...cache.values()]
    .filter((value): value is TrustedSnapshot => value !== undefined)
    .sort((left, right) => left.asOf - right.asOf);
  if (trustedPoints.length === 0) {
    throw new TxlineHttpError(
      "SCORE_HISTORY_INCOMPLETE",
      "Historical score snapshots contained no trusted score states."
    );
  }

  for (let index = 1; index < trustedPoints.length; index += 1) {
    await refine(trustedPoints[index - 1]!, trustedPoints[index]!);
  }

  trustedPoints = [...cache.values()]
    .filter((value): value is TrustedSnapshot => value !== undefined)
    .sort((left, right) => left.asOf - right.asOf);
  const allSnapshotRecords = [...rawByTimestamp.values()].flat();
  const merged = mergeSnapshotScoreRecords([
    ...options.baseRecords,
    ...allSnapshotRecords
  ]);
  assertCompleteScoreProgression(merged, options.fixture);
  return merged;
}
