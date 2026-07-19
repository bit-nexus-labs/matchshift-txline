import type { FetchLike } from "./credentials.js";
import type { CuratedReplayExportClient } from "./curated-replay-exporter.js";
import { TxlineHttpClient, TxlineHttpError } from "./http-client.js";
import { parseSourceTimestamp } from "./normalizer.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";

export interface CuratedReplaySourceOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

type UnknownRecord = Record<string, unknown>;

function earliestDirectScoreTimestamp(payload: unknown): number | undefined {
  const items = Array.isArray(payload) ? payload : [payload];
  let earliest: number | undefined;

  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const record = item as UnknownRecord;
    const timestamp = parseSourceTimestamp(record.ts ?? record.Ts);
    if (timestamp !== undefined && (earliest === undefined || timestamp < earliest)) {
      earliest = timestamp;
    }
  }

  return earliest;
}

export function createCuratedReplaySource(
  options: CuratedReplaySourceOptions
): CuratedReplayExportClient {
  const fixtureClient = new TxlineHttpClient(options);
  const replaySource = new TxlineReplayHttpSource(options);
  const earliestScoreTimestampByFixture = new Map<string, number>();
  const anchoredOddsFixtures = new Set<string>();

  return {
    fetchFixturesSnapshot: (competitionId, signal) =>
      fixtureClient.fetchFixturesSnapshot(competitionId, signal),
    fetchFixturesSnapshotForDay: (startEpochDay, competitionId, signal) =>
      fixtureClient.fetchFixturesSnapshotForDay(
        startEpochDay,
        competitionId,
        signal
      ),
    fetchScoresHistorical: async (fixtureId, signal) => {
      const payload = await replaySource.fetchScoresHistorical(fixtureId, signal);
      const fixtureKey = String(fixtureId);
      const earliestTimestamp = earliestDirectScoreTimestamp(payload);
      anchoredOddsFixtures.delete(fixtureKey);
      if (earliestTimestamp === undefined) {
        earliestScoreTimestampByFixture.delete(fixtureKey);
      } else {
        earliestScoreTimestampByFixture.set(fixtureKey, earliestTimestamp);
      }
      return payload;
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
