import type { FetchLike } from "./credentials.js";
import type { CuratedReplayExportClient } from "./curated-replay-exporter.js";
import { TxlineHttpClient, TxlineHttpError } from "./http-client.js";
import {
  normalizeFixtures,
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";
import { recoverOpeningScorePrefixFromGoalActions } from "./score-opening-prefix-recovery.js";
import {
  assertCompleteScoreProgression,
  recoverCompleteScoreHistoryFromSnapshots
} from "./score-snapshot-recovery.js";
import { TxlineScoreSnapshotSource } from "./score-snapshot-source.js";
import { TxlineScoreHistoryWindowSource } from "./score-history-window-source.js";

export interface CuratedReplaySourceOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

const FIVE_MINUTES_MS = 5 * 60_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_SCORE_HISTORY_BUCKETS = 72;

type UnknownRecord = Record<string, unknown>;

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

function directScoreTimestamp(value: unknown): number | undefined {
  const record = asRecord(value);
  return record === undefined
    ? undefined
    : parseSourceTimestamp(record.ts ?? record.Ts);
}

function directScoreOrder(left: unknown, right: unknown): number {
  const leftRecord = asRecord(left) ?? {};
  const rightRecord = asRecord(right) ?? {};
  const leftSequence =
    readInteger(leftRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence =
    readInteger(rightRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const leftTimestamp = directScoreTimestamp(left) ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = directScoreTimestamp(right) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

function directScoreIdentity(value: unknown): string {
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

export interface ScoreHistoryBucket {
  epochDay: number;
  hourOfDay: number;
  interval: number;
}

export function buildScoreHistoryBuckets(
  startTimestamp: number,
  endTimestamp: number
): ScoreHistoryBucket[] {
  if (
    !Number.isSafeInteger(startTimestamp) ||
    !Number.isSafeInteger(endTimestamp) ||
    endTimestamp < startTimestamp
  ) {
    throw new TxlineHttpError(
      "SCORE_HISTORY_WINDOW_INVALID",
      "Historical score window timestamps were invalid."
    );
  }

  const firstBucket = Math.floor(startTimestamp / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const lastBucket = Math.floor(endTimestamp / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const bucketCount = Math.floor((lastBucket - firstBucket) / FIVE_MINUTES_MS) + 1;
  if (bucketCount > MAX_SCORE_HISTORY_BUCKETS) {
    throw new TxlineHttpError(
      "SCORE_HISTORY_WINDOW_TOO_LARGE",
      "Historical score window exceeded the curated replay safety limit."
    );
  }

  const buckets: ScoreHistoryBucket[] = [];
  for (
    let timestamp = firstBucket;
    timestamp <= lastBucket;
    timestamp += FIVE_MINUTES_MS
  ) {
    const date = new Date(timestamp);
    buckets.push({
      epochDay: Math.floor(timestamp / DAY_MS),
      hourOfDay: date.getUTCHours(),
      interval: Math.floor(date.getUTCMinutes() / 5)
    });
  }
  return buckets;
}

export function mergeDirectScoreRecords(
  values: readonly unknown[]
): unknown[] {
  const unique = new Map<string, unknown>();
  for (const value of values) {
    unique.set(directScoreIdentity(value), value);
  }
  return [...unique.values()].sort(directScoreOrder);
}

function relativeMinuteLabel(timestamp: number, kickoffTimestamp: number): string {
  const minutes = (timestamp - kickoffTimestamp) / MINUTE_MS;
  const sign = minutes >= 0 ? "+" : "";
  return `${sign}${minutes.toFixed(1)}m`;
}

export function assertCompleteScoreBaseline(
  records: readonly unknown[],
  fixture: NormalizedFixture
): void {
  const ordered = [...records].sort(directScoreOrder);
  if (ordered.length === 0) {
    throw new TxlineHttpError(
      "SCORE_HISTORY_INCOMPLETE",
      "Historical score window contained no direct score records."
    );
  }

  let directKickoffObserved = false;
  for (const item of ordered) {
    const eventResult = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp
    });
    if (
      eventResult.records.some(
        (record) => record.kind === "event" && record.eventType === "KICKOFF"
      )
    ) {
      directKickoffObserved = true;
    }

    const snapshotResult = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp,
      snapshot: true
    });
    const recovery = snapshotResult.records.find(
      (record) => record.kind === "recovery"
    );
    if (recovery === undefined) {
      continue;
    }
    if (
      recovery.snapshot.score.home === 0 &&
      recovery.snapshot.score.away === 0
    ) {
      return;
    }

    throw new TxlineHttpError(
      "SCORE_HISTORY_INCOMPLETE",
      `Historical score window first trusted score was ${recovery.snapshot.score.home}-${recovery.snapshot.score.away} at ${relativeMinuteLabel(recovery.sourceTimestamp, fixture.startTimestamp)}; direct kickoff observed: ${directKickoffObserved ? "YES" : "NO"}; direct records: ${ordered.length}.`
    );
  }

  throw new TxlineHttpError(
    "SCORE_HISTORY_INCOMPLETE",
    `Historical score window contained no trusted nested-score baseline; direct kickoff observed: ${directKickoffObserved ? "YES" : "NO"}; direct records: ${ordered.length}.`
  );
}

function earliestDirectScoreTimestamp(payload: unknown): number | undefined {
  const items = Array.isArray(payload) ? payload : [payload];
  let earliest: number | undefined;

  for (const item of items) {
    const timestamp = directScoreTimestamp(item);
    if (timestamp !== undefined && (earliest === undefined || timestamp < earliest)) {
      earliest = timestamp;
    }
  }

  return earliest;
}

function isHistoryIncomplete(error: unknown): error is TxlineHttpError {
  return (
    error instanceof TxlineHttpError &&
    ["SCORE_HISTORY_INCOMPLETE", "SCORE_OPENING_PREFIX_INCOMPLETE"].includes(
      error.code
    )
  );
}

function assertCompleteHistory(
  records: readonly unknown[],
  fixture: NormalizedFixture
): void {
  assertCompleteScoreBaseline(records, fixture);
  assertCompleteScoreProgression(records, fixture);
}

export function createCuratedReplaySource(
  options: CuratedReplaySourceOptions
): CuratedReplayExportClient {
  const fixtureClient = new TxlineHttpClient(options);
  const replaySource = new TxlineReplayHttpSource(options);
  const scoreWindowSource = new TxlineScoreHistoryWindowSource(options);
  const scoreSnapshotSource = new TxlineScoreSnapshotSource(options);
  const fixturesById = new Map<string, NormalizedFixture>();
  const earliestScoreTimestampByFixture = new Map<string, number>();
  const anchoredOddsFixtures = new Set<string>();

  const rememberFixtures = (payload: unknown): void => {
    for (const fixture of normalizeFixtures(payload)) {
      fixturesById.set(String(fixture.fixtureId), fixture);
    }
  };

  return {
    fetchFixturesSnapshot: async (competitionId, signal) => {
      const payload = await fixtureClient.fetchFixturesSnapshot(competitionId, signal);
      rememberFixtures(payload);
      return payload;
    },
    fetchFixturesSnapshotForDay: async (
      startEpochDay,
      competitionId,
      signal
    ) => {
      const payload = await fixtureClient.fetchFixturesSnapshotForDay(
        startEpochDay,
        competitionId,
        signal
      );
      rememberFixtures(payload);
      return payload;
    },
    fetchScoresHistorical: async (fixtureId, signal) => {
      const tail = await replaySource.fetchScoresHistorical(fixtureId, signal);
      const tailItems = Array.isArray(tail) ? tail : [tail];
      const fixtureKey = String(fixtureId);
      const fixture = fixturesById.get(fixtureKey);
      let records = tailItems;

      if (fixture !== undefined) {
        const latestTimestamp = tailItems.reduce<number>(
          (latest, record) => Math.max(latest, directScoreTimestamp(record) ?? latest),
          fixture.startTimestamp
        );
        const bucketRecords: unknown[] = [];
        for (const bucket of buildScoreHistoryBuckets(
          fixture.startTimestamp,
          latestTimestamp
        )) {
          bucketRecords.push(
            ...(await scoreWindowSource.fetchBucket(
              bucket.epochDay,
              bucket.hourOfDay,
              bucket.interval,
              fixtureId,
              signal
            ))
          );
        }
        records = mergeDirectScoreRecords([...bucketRecords, ...tailItems]);

        try {
          assertCompleteHistory(records, fixture);
        } catch (historyError) {
          if (!isHistoryIncomplete(historyError)) {
            throw historyError;
          }

          let openingError: TxlineHttpError | undefined;
          try {
            records = recoverOpeningScorePrefixFromGoalActions(records, fixture);
            assertCompleteHistory(records, fixture);
          } catch (error) {
            if (!isHistoryIncomplete(error)) {
              throw error;
            }
            openingError = error;
          }

          if (openingError !== undefined) {
            try {
              records = await recoverCompleteScoreHistoryFromSnapshots({
                fixtureId,
                fixture,
                startTimestamp: fixture.startTimestamp,
                endTimestamp: latestTimestamp,
                baseRecords: records,
                fetchSnapshotAt: (snapshotFixtureId, asOf, snapshotSignal) =>
                  scoreSnapshotSource.fetchSnapshotAt(
                    snapshotFixtureId,
                    asOf,
                    snapshotSignal
                  ),
                ...(signal === undefined ? {} : { signal })
              });
              assertCompleteHistory(records, fixture);
            } catch (snapshotError) {
              if (!isHistoryIncomplete(snapshotError)) {
                throw snapshotError;
              }
              throw new TxlineHttpError(
                "SCORE_HISTORY_INCOMPLETE",
                `TxLINE opening history remained incomplete. Goal-action recovery: ${openingError.message} Snapshot recovery: ${snapshotError.message}`
              );
            }
          }
        }
      }

      const earliestTimestamp = earliestDirectScoreTimestamp(records);
      anchoredOddsFixtures.delete(fixtureKey);
      if (earliestTimestamp === undefined) {
        earliestScoreTimestampByFixture.delete(fixtureKey);
      } else {
        earliestScoreTimestampByFixture.set(fixtureKey, earliestTimestamp);
      }
      return records;
    },
    fetchOddsSnapshotAt: async (fixtureId, asOf, signal) => {
      const fixtureKey = String(fixtureId);
      const earliestTimestamp = earliestScoreTimestampByFixture.get(fixtureKey);
      const effectiveAsOf =
        !anchoredOddsFixtures.has(fixtureKey) && earliestTimestamp !== undefined
          ? earliestTimestamp
          : asOf;
      anchoredOddsFixtures.add(fixtureKey);

      try {
        return await replaySource.fetchOddsSnapshotAt(
          fixtureId,
          effectiveAsOf,
          signal
        );
      } catch (error) {
        if (
          error instanceof TxlineHttpError &&
          error.code === "ODDS_RECORDS_MISSING"
        ) {
          return [];
        }
        throw error;
      }
    }
  };
}
