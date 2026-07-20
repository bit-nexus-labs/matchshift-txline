import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import {
  buildScoreHistoryBuckets,
  mergeDirectScoreRecords
} from "./curated-replay-source.js";
import { TxlineHttpClient, TxlineHttpError } from "./http-client.js";
import {
  historicalFixtureStartEpochDay,
  selectLatestHistoricalEligibleFixture
} from "./latest-historical-fixture.js";
import { normalizeFixtures, normalizeScorePayload } from "./normalizer.js";
import { sanitizedErrorMessage } from "./redaction.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";
import {
  diagnoseScoreRecordShape,
  formatScoreRecordShapeDiagnostics
} from "./score-record-shape-diagnostics.js";
import { TxlineScoreHistoryWindowSource } from "./score-history-window-source.js";
import { TxlineScoreSnapshotSource } from "./score-snapshot-source.js";

const MINUTE_MS = 60_000;
const DEFAULT_WINDOW_MINUTES = 180;
const MAX_WINDOW_MINUTES = 350;

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new Error("TXLINE_NETWORK must be mainnet or devnet.");
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum?: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new Error(
      maximum === undefined
        ? `${name} must be a positive integer.`
        : `${name} must be a positive integer no greater than ${maximum}.`
    );
  }
  return parsed;
}

function readOptionalPositiveInteger(
  value: string | undefined,
  name: string
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return readPositiveInteger(value, 1, name);
}

function isEmptyProviderResult(error: unknown): error is TxlineHttpError {
  return (
    error instanceof TxlineHttpError &&
    [
      "EMPTY_SSE_DATA",
      "SCORE_RECORDS_MISSING",
      "SCORE_SNAPSHOT_RECORDS_MISSING",
      "ODDS_RECORDS_MISSING"
    ].includes(error.code)
  );
}

async function optionalRecords(fetchRecords: () => Promise<unknown>): Promise<unknown[]> {
  try {
    const payload = await fetchRecords();
    return Array.isArray(payload) ? payload : [payload];
  } catch (error) {
    if (isEmptyProviderResult(error)) {
      return [];
    }
    throw error;
  }
}

function trustedScoreStates(
  records: readonly unknown[],
  fixture: ReturnType<typeof selectLatestHistoricalEligibleFixture>,
  receivedTimestamp: number
): string[] {
  const states: string[] = [];
  for (const record of records) {
    const normalized = normalizeScorePayload(record, {
      fixture,
      receivedTimestamp,
      snapshot: true
    });
    const recovery = normalized.records.find((item) => item.kind === "recovery");
    if (recovery === undefined) {
      continue;
    }
    const state = `${recovery.snapshot.score.home}-${recovery.snapshot.score.away}`;
    if (states.at(-1) !== state) {
      states.push(state);
    }
  }
  return states;
}

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    if (apiToken === "") {
      throw new Error("TXLINE_API_TOKEN is required.");
    }

    const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
    const requestTimeoutMs = readPositiveInteger(
      env.TXLINE_REQUEST_TIMEOUT_MS,
      30_000,
      "TXLINE_REQUEST_TIMEOUT_MS"
    );
    const windowMinutes = readPositiveInteger(
      env.TXLINE_LATEST_MATCH_WINDOW_MINUTES,
      DEFAULT_WINDOW_MINUTES,
      "TXLINE_LATEST_MATCH_WINDOW_MINUTES",
      MAX_WINDOW_MINUTES
    );
    const competitionId = readOptionalPositiveInteger(
      env.TXLINE_COMPETITION_ID,
      "TXLINE_COMPETITION_ID"
    );
    const nowTimestamp = Date.now();
    const apiOrigin = resolveTxlineOrigin(network);
    const sourceOptions = { apiOrigin, apiToken, requestTimeoutMs };

    const fixtureClient = new TxlineHttpClient(sourceOptions);
    const fixturePayload = await fixtureClient.fetchFixturesSnapshotForDay(
      historicalFixtureStartEpochDay(nowTimestamp),
      competitionId
    );
    const fixtures = normalizeFixtures(fixturePayload);
    const fixture = selectLatestHistoricalEligibleFixture(fixtures, nowTimestamp);

    const replaySource = new TxlineReplayHttpSource(sourceOptions);
    const scoreWindowSource = new TxlineScoreHistoryWindowSource(sourceOptions);
    const scoreSnapshotSource = new TxlineScoreSnapshotSource(sourceOptions);
    const probeEndTimestamp = Math.min(
      nowTimestamp,
      fixture.startTimestamp + windowMinutes * MINUTE_MS
    );

    const historicalRecords = await optionalRecords(() =>
      replaySource.fetchScoresHistorical(fixture.fixtureId)
    );

    const buckets = buildScoreHistoryBuckets(
      fixture.startTimestamp,
      probeEndTimestamp
    );
    const bucketRecords: unknown[] = [];
    let nonEmptyBuckets = 0;
    for (const bucket of buckets) {
      const records = await optionalRecords(() =>
        scoreWindowSource.fetchBucket(
          bucket.epochDay,
          bucket.hourOfDay,
          bucket.interval,
          fixture.fixtureId
        )
      );
      if (records.length > 0) {
        nonEmptyBuckets += 1;
        bucketRecords.push(...records);
      }
    }

    const snapshotRecords = await optionalRecords(() =>
      scoreSnapshotSource.fetchSnapshotAt(
        fixture.fixtureId,
        probeEndTimestamp
      )
    );
    const oddsRecords = await optionalRecords(() =>
      replaySource.fetchOddsSnapshotAt(
        fixture.fixtureId,
        probeEndTimestamp
      )
    );

    const mergedScoreRecords = mergeDirectScoreRecords([
      ...historicalRecords,
      ...bucketRecords,
      ...snapshotRecords
    ]);
    const states = trustedScoreStates(
      mergedScoreRecords,
      fixture,
      probeEndTimestamp
    );
    const diagnostics = diagnoseScoreRecordShape(
      mergedScoreRecords,
      fixture,
      probeEndTimestamp
    );
    const ageHours = (nowTimestamp - fixture.startTimestamp) / (60 * MINUTE_MS);

    process.stdout.write("TXLINE LATEST HISTORICAL FIXTURE PROBE: PASS\n");
    process.stdout.write(
      `Match: ${fixture.homeParticipant} vs ${fixture.awayParticipant}\n`
    );
    process.stdout.write(
      `Start UTC: ${new Date(fixture.startTimestamp).toISOString()}\n`
    );
    process.stdout.write(`Age: ${ageHours.toFixed(1)} hours\n`);
    process.stdout.write(
      `Fixture snapshot: normalized=${fixtures.length}; historical-window=ELIGIBLE\n`
    );
    process.stdout.write(
      `Scores historical: records=${historicalRecords.length}\n`
    );
    process.stdout.write(
      `Scores buckets: scanned=${buckets.length}; non-empty=${nonEmptyBuckets}; records=${bucketRecords.length}\n`
    );
    process.stdout.write(
      `Scores snapshot: records=${snapshotRecords.length}\n`
    );
    process.stdout.write(`Odds snapshot: records=${oddsRecords.length}\n`);
    process.stdout.write(
      `Trusted score states: ${states.length === 0 ? "NONE" : states.join(" -> ")}\n`
    );
    if (states.length === 0) {
      process.stdout.write(formatScoreRecordShapeDiagnostics(diagnostics));
    }
    process.stdout.write(
      `Result: ${states.length === 0 ? "NO_TRUSTED_SCORE_DATA" : "TRUSTED_SCORE_DATA_AVAILABLE"}\n`
    );
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(
      `TXLINE LATEST HISTORICAL FIXTURE PROBE: FAIL (${message})\n`
    );
    process.exitCode = 1;
  }
}

await main();
