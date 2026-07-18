import { setTimeout as sleep } from "node:timers/promises";
import {
  observeLiveInputFromEnvironment,
  writeLiveObserverReceipt,
  type LiveObserverResult
} from "./live-observer.js";
import { sanitizedErrorMessage } from "./redaction.js";

const RETRY_DELAY_MS = 1_000;
const MAX_SINGLE_ATTEMPT_MS = 60_000;

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

export interface LiveObserverWindowDependencies {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  observe(
    env: Readonly<Record<string, string | undefined>>
  ): Promise<LiveObserverResult>;
}

const defaultDependencies: LiveObserverWindowDependencies = {
  now: Date.now,
  sleep: async (milliseconds) => {
    await sleep(milliseconds);
  },
  observe: observeLiveInputFromEnvironment
};

export async function observeLiveInputForWindow(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: LiveObserverWindowDependencies = defaultDependencies
): Promise<LiveObserverResult> {
  const totalMs = readPositiveInteger(
    env.TXLINE_LIVE_OBSERVE_MS,
    45_000,
    "TXLINE_LIVE_OBSERVE_MS"
  );
  const deadline = dependencies.now() + totalMs;
  let latest: LiveObserverResult | undefined;

  while (dependencies.now() < deadline) {
    const remainingMs = Math.max(1, deadline - dependencies.now());
    const attemptMs = Math.min(MAX_SINGLE_ATTEMPT_MS, remainingMs);
    latest = await dependencies.observe({
      ...env,
      TXLINE_LIVE_OBSERVE_MS: String(attemptMs)
    });
    if (latest.status === "PASS") {
      return latest;
    }

    const afterAttemptRemainingMs = deadline - dependencies.now();
    if (afterAttemptRemainingMs <= 0) {
      break;
    }
    await dependencies.sleep(
      Math.min(RETRY_DELAY_MS, afterAttemptRemainingMs)
    );
  }

  if (latest === undefined) {
    throw new Error("The live observation window ended before an attempt started.");
  }
  return latest;
}

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await observeLiveInputForWindow(env);
    const receiptPath =
      env.TXLINE_LIVE_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-live-observer.md";
    await writeLiveObserverReceipt(result, receiptPath);
    if (result.status === "PASS") {
      process.stdout.write("TXLINE LIVE INPUT OBSERVER: PASS\n");
      process.stdout.write(`Receipt written: ${receiptPath}\n`);
      return;
    }
    process.stdout.write("TXLINE LIVE INPUT OBSERVER: NOT OBSERVED\n");
    process.stdout.write(
      "No normalized SSE data record arrived before the full observation window ended.\n"
    );
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
    process.exitCode = 2;
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE LIVE INPUT OBSERVER: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}

await main();
