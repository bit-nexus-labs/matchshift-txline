import type { FetchLike } from "./credentials.js";
import type { CuratedReplayExportClient } from "./curated-replay-exporter.js";
import { TxlineHttpClient } from "./http-client.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";

export interface CuratedReplaySourceOptions {
  apiOrigin: string;
  apiToken: string;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

export function createCuratedReplaySource(
  options: CuratedReplaySourceOptions
): CuratedReplayExportClient {
  const fixtureClient = new TxlineHttpClient(options);
  const replaySource = new TxlineReplayHttpSource(options);

  return {
    fetchFixturesSnapshot: (competitionId, signal) =>
      fixtureClient.fetchFixturesSnapshot(competitionId, signal),
    fetchFixturesSnapshotForDay: (startEpochDay, competitionId, signal) =>
      fixtureClient.fetchFixturesSnapshotForDay(
        startEpochDay,
        competitionId,
        signal
      ),
    fetchScoresHistorical: (fixtureId, signal) =>
      replaySource.fetchScoresHistorical(fixtureId, signal),
    fetchOddsSnapshotAt: (fixtureId, asOf, signal) =>
      replaySource.fetchOddsSnapshotAt(fixtureId, asOf, signal)
  };
}
