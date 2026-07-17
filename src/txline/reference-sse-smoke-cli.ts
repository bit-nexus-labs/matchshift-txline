import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import {
  createReferenceHistoricalClient,
  TXLINE_PUBLIC_REFERENCE_FIXTURE_ID
} from "./reference-smoke.js";
import { sanitizedErrorMessage } from "./redaction.js";
import { TxlineReplayHttpSource } from "./replay-http-source.js";
import {
  runHistoricalSmoke,
  TxlineSmokeError,
  writeHistoricalSmokeReceipt,
  type HistoricalSmokeResult
} from "./smoke.js";

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

export async function runReferenceSseHistoricalSmokeFromEnvironment(
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
  const source = new TxlineReplayHttpSource({
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

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await runReferenceSseHistoricalSmokeFromEnvironment(env);
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

await main();
