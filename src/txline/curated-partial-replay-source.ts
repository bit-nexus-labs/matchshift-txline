import type { CuratedReplayExportClient } from "./curated-replay-exporter.js";
import {
  buildScoreHistoryBuckets,
  createCuratedReplaySource,
  mergeDirectScoreRecords,
  type CuratedReplaySourceOptions
} from "./curated-replay-source.js";
import { TxlineHttpError } from "./http-client.js";
import {
  normalizeFixtures,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";
import {
  buildDisclosedPartialOpeningHistory,
  readPartialOpeningCoverage,
  type PartialOpeningCoverageMarker
} from "./score-partial-opening.js";
import { TxlineScoreHistoryWindowSource } from "./score-history-window-source.js";

function directTimestamp(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return parseSourceTimestamp(record.ts ?? record.Ts);
}

export interface CuratedPartialReplaySource extends CuratedReplayExportClient {
  getScoreCoverage(): PartialOpeningCoverageMarker | undefined;
}

export function createCuratedPartialReplaySource(
  options: CuratedReplaySourceOptions
): CuratedPartialReplaySource {
  const strictSource = createCuratedReplaySource(options);
  const replaySource = new TxlineReplayHttpSource(options);
  const scoreWindowSource = new TxlineScoreHistoryWindowSource(options);
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
      const payload = await strictSource.fetchFixturesSnapshot(competitionId, signal);
      rememberFixtures(payload);
      return payload;
    },
    fetchFixturesSnapshotForDay: async (
      startEpochDay,
      competitionId,
      signal
    ) => {
      const payload = await strictSource.fetchFixturesSnapshotForDay(
        startEpochDay,
        competitionId,
        signal
      );
      rememberFixtures(payload);
      return payload;
    },
    fetchScoresHistorical: async (fixtureId, signal) => {
      scoreCoverage = undefined;
      try {
        const payload = await strictSource.fetchScoresHistorical(fixtureId, signal);
        const items = Array.isArray(payload) ? payload : [payload];
        const earliest = items.reduce<number | undefined>((current, item) => {
          const timestamp = directTimestamp(item);
          return timestamp === undefined || (current !== undefined && current <= timestamp)
            ? current
            : timestamp;
        }, undefined);
        if (earliest !== undefined) {
          oddsAnchorByFixture.set(String(fixtureId), earliest);
        }
        anchoredOddsFixtures.delete(String(fixtureId));
        return payload;
      } catch (error) {
        if (!(error instanceof TxlineHttpError) || error.code !== "SCORE_HISTORY_INCOMPLETE") {
          throw error;
        }
      }

      const fixtureKey = String(fixtureId);
      const fixture = fixturesById.get(fixtureKey);
      if (fixture === undefined) {
        throw new TxlineHttpError(
          "SCORE_PARTIAL_OPENING_UNAVAILABLE",
          "Partial opening fallback had no normalized fixture context."
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
      const merged = mergeDirectScoreRecords([...bucketRecords, ...tailItems]);
      const partial = buildDisclosedPartialOpeningHistory(merged, fixture);
      const coverage = readPartialOpeningCoverage(partial);
      if (coverage === undefined) {
        throw new TxlineHttpError(
          "SCORE_PARTIAL_OPENING_UNAVAILABLE",
          "Partial opening fallback did not produce its required disclosure marker."
        );
      }
      scoreCoverage = coverage;
      oddsAnchorByFixture.set(
        fixtureKey,
        coverage.providerScoreStartTimestamp
      );
      anchoredOddsFixtures.delete(fixtureKey);
      return partial;
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
