import { setTimeout as sleep } from "node:timers/promises";
import {
  observeLiveInputFromEnvironment,
  type LiveObserverResult
} from "./live-observer.js";

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
