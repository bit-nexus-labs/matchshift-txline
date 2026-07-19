import type { CuratedReplayExportClient } from "./curated-replay-exporter.js";
import {
  assertCompleteScoreBaseline,
  buildScoreHistoryBuckets,
  mergeDirectScoreRecords,
  type CuratedReplaySourceOptions
} from "./curated-replay-source.js";
import { TxlineHttpClient, TxlineHttpError } from "./http-client.js";
import {
  normalizeFixtures,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";
import { recoverOpeningScorePrefixFromGoalActions } from "./score-opening-prefix-recovery.js";
import {
  buildDisclosedPartialOpeningHistory,
  readPartialOpeningCoverage,
  type PartialOpeningCoverageMarker
} from "./score-partial-opening.js";
import {
  assertCompleteScoreProgression,
  recoverCompleteScoreHistoryFromSnapshots
} from "./score-snapshot-recovery.js";
import { TxlineScoreSnapshotSource } from "./score-snapshot-source.js";
import { TxlineScoreHistoryWindowSource } from "./score-history-window-source.js";

function directTimestamp(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return parseSourceTimestamp(record.ts ?? record.Ts);
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

function earliestTimestamp(records: readonly unknown[]): number | undefined {
  return records.reduce<number | undefined>((current, item) => {
    const timestamp = directTimestamp(item);
    return timestamp === undefined || (current !== undefined && current <= timestamp)
      ? current
      : timestamp;
  }, undefined);
}

export interface CuratedPartialReplaySource extends CuratedReplayExportClient {
  getScoreCoverage(): PartialOpeningCoverageMarker | undefined;
}

export function createCuratedPartialReplaySource(
  options: CuratedReplaySourceOptions
): CuratedPartialReplaySource {
  const fixtureClient = new TxlineHttpClient(options);
  const replaySource = new TxlineReplayHttpSource(options);
  const scoreWindowSource = new TxlineScoreHistoryWindowSource(options);
  const scoreSnapshotSource = new TxlineScoreSnapshotSource(options);
  const fixturesById = new Map<string, NormalizedFixture>();
  const oddsAnchorByFixture = new Map<string, number>();
  const anchoredOddsFixtures = new Set<string>();
  let scoreCoverage: PartialOpeningCoverageMarker | undefined;

  const rememberFixtures = (payload: unknown): void => {
    for (const fixture of normalizeFixtures(payload)) {
      fixturesById.set(String(fixture.fixtureId), fixture);
    }
  };

  return {
    getScoreCoverage: () => scoreCoverage,
    fetchFixturesSnapshot: async (competitionId, signal) => {
      const payload = await fixtureClient.fetchFixturesSnapshot(
        competitionId,
        signal
      );
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
      scoreCoverage = undefined;
      const fixtureKey = String(fixtureId);
      const fixture = fixturesById.get(fixtureKey);
      if (fixture === undefined) {
        throw new TxlineHttpError(
          "SCORE_PARTIAL_OPENING_UNAVAILABLE",
          "Partial opening replay source had no normalized fixture context."
        );
      }

      const tail = await replaySource.fetchScoresHistorical(fixtureId, signal);
      const tailItems = Array.isArray(tail) ? tail : [tail];
      const latestTimestamp = tailItems.reduce<number>(
        (latest, record) => Math.max(latest, directTimestamp(record) ?? latest),
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
      let records = mergeDirectScoreRecords([...bucketRecords, ...tailItems]);

      try {
        assertCompleteHistory(records, fixture);
      } catch (historyError) {
        if (!isHistoryIncomplete(historyError)) {
          throw historyError;
        }
        try {
          records = recoverOpeningScorePrefixFromGoalActions(records, fixture);
          assertCompleteHistory(records, fixture);
        } catch (openingError) {
          if (!isHistoryIncomplete(openingError)) {
            throw openingError;
          }
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
            records = buildDisclosedPartialOpeningHistory(records, fixture);
            scoreCoverage = readPartialOpeningCoverage(records);
            if (scoreCoverage === undefined) {
              throw new TxlineHttpError(
                "SCORE_PARTIAL_OPENING_UNAVAILABLE",
                "Partial opening fallback did not produce its required disclosure marker."
              );
            }
          }
        }
      }

      const anchor =
        scoreCoverage?.providerScoreStartTimestamp ?? earliestTimestamp(records);
      if (anchor !== undefined) {
        oddsAnchorByFixture.set(fixtureKey, anchor);
      }
      anchoredOddsFixtures.delete(fixtureKey);
      return records;
    },
    fetchOddsSnapshotAt: async (fixtureId, asOf, signal) => {
      const fixtureKey = String(fixtureId);
      const anchor = oddsAnchorByFixture.get(fixtureKey);
      const effectiveAsOf =
        !anchoredOddsFixtures.has(fixtureKey) && anchor !== undefined
          ? anchor
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
