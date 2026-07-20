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
import {
  diagnoseOpeningScoreAnchors,
  formatOpeningScoreAnchorDiagnostics,
  OPENING_SNAPSHOT_OFFSETS_MS
} from "./opening-score-anchor-diagnostics.js";
import { sanitizedErrorMessage } from "./redaction.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";
import { TxlineScoreHistoryWindowSource } from "./score-history-window-source.js";
import { TxlineScoreSnapshotSource } from "./score-snapshot-source.js";
import { hydrateSparseScoreHistory } from "./sparse-score-history-hydration.js";

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

function isEmptyProviderResult(error: unknown): error is TxlineHttpError {
  return (
    error instanceof TxlineHttpError &&
    [
      "EMPTY_SSE_DATA",
      "SCORE_RECORDS_MISSING",
      "SCORE_SNAPSHOT_RECORDS_MISSING"
    ].includes(error.code)
  );
}

async function optionalRecords(
  fetchRecords: () => Promise<unknown>
): Promise<unknown[]> {
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
    const nowTimestamp = Date.now();
    const sourceOptions = {
      apiOrigin: resolveTxlineOrigin(network),
      apiToken,
      requestTimeoutMs
    };

    const fixtureClient = new TxlineHttpClient(sourceOptions);
    const fixturePayload = await fixtureClient.fetchFixturesSnapshotForDay(
      historicalFixtureStartEpochDay(nowTimestamp)
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

    const bucketRecords: unknown[] = [];
    const buckets = buildScoreHistoryBuckets(
      fixture.startTimestamp,
      probeEndTimestamp
    );
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

    const openingSnapshotRecords: unknown[] = [];
    let nonEmptyOpeningPoints = 0;
    for (const offset of OPENING_SNAPSHOT_OFFSETS_MS) {
      const records = await optionalRecords(() =>
        scoreSnapshotSource.fetchSnapshotAt(
          fixture.fixtureId,
          fixture.startTimestamp + offset
        )
      );
      if (records.length > 0) {
        nonEmptyOpeningPoints += 1;
        openingSnapshotRecords.push(...records);
      }
    }

    const merged = mergeDirectScoreRecords([
      ...historicalRecords,
      ...bucketRecords,
      ...openingSnapshotRecords
    ]);
    const anchorDiagnostics = diagnoseOpeningScoreAnchors(merged, fixture);

    let hydrationStatus = "NOT_ATTEMPTED";
    let states: string[] = [];
    try {
      const hydration = hydrateSparseScoreHistory(merged, fixture);
      states = trustedScoreStates(
        hydration.records,
        fixture,
        probeEndTimestamp
      );
      hydrationStatus =
        `PASS; kickoff=${hydration.kickoffObserved ? "YES" : "NO"}; ` +
        `hydrated-records=${hydration.hydratedRecords}; ` +
        `score-changes=${hydration.scoreChanges}`;
    } catch (error) {
      hydrationStatus =
        error instanceof TxlineHttpError
          ? `FAIL; code=${error.code}`
          : "FAIL; code=UNKNOWN";
    }

    process.stdout.write("TXLINE OPENING SCORE ANCHOR PROBE: PASS\n");
    process.stdout.write(
      `Match: ${fixture.homeParticipant} vs ${fixture.awayParticipant}\n`
    );
    process.stdout.write(
      `Start UTC: ${new Date(fixture.startTimestamp).toISOString()}\n`
    );
    process.stdout.write(
      `Scores historical: records=${historicalRecords.length}\n`
    );
    process.stdout.write(
      `Scores buckets: scanned=${buckets.length}; non-empty=${nonEmptyBuckets}; records=${bucketRecords.length}\n`
    );
    process.stdout.write(
      `Opening snapshots: points=${OPENING_SNAPSHOT_OFFSETS_MS.length}; non-empty=${nonEmptyOpeningPoints}; records=${openingSnapshotRecords.length}\n`
    );
    process.stdout.write(formatOpeningScoreAnchorDiagnostics(anchorDiagnostics));
    process.stdout.write(`Sparse score hydration: ${hydrationStatus}\n`);
    process.stdout.write(
      `Trusted score states: ${states.length === 0 ? "NONE" : states.join(" -> ")}\n`
    );
    process.stdout.write(
      `Result: ${states.length === 0 ? "NO_TRUSTED_OPENING_ANCHOR" : "TRUSTED_SCORE_DATA_AVAILABLE"}\n`
    );
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(
      `TXLINE OPENING SCORE ANCHOR PROBE: FAIL (${message})\n`
    );
    process.exitCode = 1;
  }
}

await main();
