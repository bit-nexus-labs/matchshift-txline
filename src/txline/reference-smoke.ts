import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import { adaptHistoricalOddsPayload } from "./historical-odds-adapter.js";
import { TxlineHttpClient } from "./http-client.js";
import { parseSourceTimestamp } from "./normalizer.js";
import { sanitizedErrorMessage } from "./redaction.js";
import {
  runHistoricalSmoke,
  TxlineSmokeError,
  writeHistoricalSmokeReceipt,
  type HistoricalSmokeClient,
  type HistoricalSmokeResult
} from "./smoke.js";

export const TXLINE_PUBLIC_REFERENCE_FIXTURE_ID = "18213979";

type UnknownRecord = Record<string, unknown>;

export interface ReferenceHistoricalSource {
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

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
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
  for (const key of ["data", "scores"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [record];
}

export function buildReferenceFixturePayload(
  historicalScores: unknown,
  fixtureId: string
): unknown[] {
  const timestamps = extractItems(historicalScores)
    .map((item) => {
      const record = asRecord(item);
      return record === undefined
        ? undefined
        : parseSourceTimestamp(record.ts ?? record.Ts);
    })
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);

  const startTimestamp = timestamps[0];
  if (startTimestamp === undefined) {
    throw new TxlineSmokeError(
      "REFERENCE_FIXTURE_TIMESTAMP_MISSING",
      "The historical score log did not contain a usable source timestamp."
    );
  }

  return [
    {
      FixtureId: fixtureId,
      StartTime: startTimestamp,
      Participant1: "Reference side A",
      Participant2: "Reference side B",
      Participant1IsHome: true,
      GameState: 1
    }
  ];
}

export function createReferenceHistoricalClient(
  source: ReferenceHistoricalSource,
  fixtureId: string
): HistoricalSmokeClient {
  let scorePayloadPromise: Promise<unknown> | undefined;

  const loadScores = (): Promise<unknown> => {
    scorePayloadPromise ??= source.fetchScoresHistorical(fixtureId);
    return scorePayloadPromise;
  };

  return {
    async fetchFixturesSnapshotForDay() {
      const scores = await loadScores();
      return buildReferenceFixturePayload(scores, fixtureId);
    },
    async fetchScoresHistorical(requestedFixtureId) {
      if (String(requestedFixtureId) !== fixtureId) {
        throw new TxlineSmokeError(
          "REFERENCE_FIXTURE_MISMATCH",
          "The historical smoke requested an unexpected fixture."
        );
      }
      return loadScores();
    },
    async fetchOddsSnapshotAt(requestedFixtureId, asOf, signal) {
      if (String(requestedFixtureId) !== fixtureId) {
        throw new TxlineSmokeError(
          "REFERENCE_FIXTURE_MISMATCH",
          "The historical smoke requested an unexpected fixture."
        );
      }
      const payload = await source.fetchOddsSnapshotAt(
        requestedFixtureId,
        asOf,
        signal
      );
      return adaptHistoricalOddsPayload(payload);
    }
  };
}

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "devnet" || normalized === "mainnet") {
    return normalized;
  }
  throw new TxlineSmokeError(
    "INVALID_CONFIGURATION",
    "TXLINE_NETWORK must be devnet or mainnet."
  );
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TxlineSmokeError(
      "INVALID_CONFIGURATION",
      "A numeric reference-smoke environment variable was invalid."
    );
  }
  return parsed;
}

export async function runReferenceHistoricalSmokeFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<HistoricalSmokeResult> {
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    throw new TxlineSmokeError(
      "INVALID_CONFIGURATION",
      "TXLINE_API_TOKEN is required for the historical smoke test."
    );
  }

  const fixtureId =
    env.TXLINE_FIXTURE_ID?.trim() || TXLINE_PUBLIC_REFERENCE_FIXTURE_ID;
  const requestTimeoutMs = readPositiveInteger(
    env.TXLINE_REQUEST_TIMEOUT_MS,
    30_000
  );
  const source = new TxlineHttpClient({
    apiOrigin: resolveTxlineOrigin(network),
    apiToken,
    requestTimeoutMs
  });
  const client = createReferenceHistoricalClient(source, fixtureId);

  return runHistoricalSmoke({
    network,
    fixtureId,
    client
  });
}

export async function referenceHistoricalSmokeCli(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await runReferenceHistoricalSmokeFromEnvironment(env);
    const receiptPath =
      env.TXLINE_SMOKE_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-smoke-receipt.md";
    await writeHistoricalSmokeReceipt(result, receiptPath);
    process.stdout.write("TXLINE HISTORICAL SMOKE: PASS\n");
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE HISTORICAL SMOKE: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}
