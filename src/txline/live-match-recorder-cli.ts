import { recordLiveMatch } from "./live-match-recorder.js";
import { sanitizedErrorMessage } from "./redaction.js";
import type { TxlineNetwork } from "./config.js";

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
  name: string
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort("USER_INTERRUPT");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  try {
    const sideA = env.TXLINE_LIVE_SIDE_A?.trim() ?? "";
    const sideB = env.TXLINE_LIVE_SIDE_B?.trim() ?? "";
    if (apiToken === "") {
      throw new Error("TXLINE_API_TOKEN is required for live recording.");
    }
    if (sideA === "" || sideB === "") {
      throw new Error(
        "TXLINE_LIVE_SIDE_A and TXLINE_LIVE_SIDE_B are required for live recording."
      );
    }

    process.stdout.write("TXLINE LIVE MATCH RECORDER: STARTING\n");
    process.stdout.write(`Target: ${sideA} vs ${sideB}\n`);
    process.stdout.write(
      "Only normalized allowlisted records are written; raw payloads and provider identifiers are not persisted.\n"
    );

    const result = await recordLiveMatch({
      network: readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE),
      apiToken,
      sideA,
      sideB,
      observeMs: readPositiveInteger(
        env.TXLINE_LIVE_RECORD_MS,
        3 * 60 * 60_000,
        "TXLINE_LIVE_RECORD_MS"
      ),
      fixtureWindowHours: readPositiveInteger(
        env.TXLINE_LIVE_WINDOW_HOURS,
        3,
        "TXLINE_LIVE_WINDOW_HOURS"
      ),
      requestTimeoutMs: readPositiveInteger(
        env.TXLINE_REQUEST_TIMEOUT_MS,
        30_000,
        "TXLINE_REQUEST_TIMEOUT_MS"
      ),
      reconnectBaseMs: readPositiveInteger(
        env.TXLINE_RECONNECT_BASE_MS,
        1_000,
        "TXLINE_RECONNECT_BASE_MS"
      ),
      reconnectMaxMs: readPositiveInteger(
        env.TXLINE_RECONNECT_MAX_MS,
        30_000,
        "TXLINE_RECONNECT_MAX_MS"
      ),
      outputPath:
        env.TXLINE_LIVE_CAPTURE_PATH?.trim() ||
        "artifacts/private/txline-live-match-capture.jsonl",
      competitionId: env.TXLINE_COMPETITION_ID?.trim(),
      signal: controller.signal,
      onCapture: (record) => {
        process.stdout.write(
          `Captured #${record.captureSequence}: ${record.domain}/${record.kind} @ ${new Date(record.sourceTimestamp).toISOString()}\n`
        );
      }
    });

    process.stdout.write("TXLINE LIVE MATCH RECORDER: COMPLETE\n");
    process.stdout.write(`Match: ${result.matchLabel}\n`);
    process.stdout.write(`Stop reason: ${result.stopReason}\n`);
    process.stdout.write(
      `Captured records: ${result.baselineRecords + result.streamRecords} (baseline ${result.baselineRecords}; live ${result.streamRecords}; scores ${result.scoreRecords}; odds ${result.oddsRecords})\n`
    );
    process.stdout.write(`Private capture: ${result.outputPath}\n`);
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE LIVE MATCH RECORDER: FAIL (${message})\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}

await main();
