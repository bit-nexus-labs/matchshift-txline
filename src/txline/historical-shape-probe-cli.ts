import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import {
  formatHistoricalShapeReport,
  probeHistoricalScoresShape
} from "./historical-shape-probe.js";
import { sanitizedErrorMessage } from "./redaction.js";

const DEFAULT_REFERENCE_FIXTURE_ID = "18213979";

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new Error("TXLINE_NETWORK must be mainnet or devnet.");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("TXLINE_REQUEST_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
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
    const fixtureId =
      env.TXLINE_FIXTURE_ID?.trim() || DEFAULT_REFERENCE_FIXTURE_ID;
    const requestTimeoutMs = readPositiveInteger(
      env.TXLINE_REQUEST_TIMEOUT_MS,
      30_000
    );
    const report = await probeHistoricalScoresShape({
      apiOrigin: resolveTxlineOrigin(network),
      apiToken,
      fixtureId,
      requestTimeoutMs
    });
    process.stdout.write(formatHistoricalShapeReport(report));
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE HISTORICAL SHAPE: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}

await main();
