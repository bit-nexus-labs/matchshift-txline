import { setTimeout as sleep } from "node:timers/promises";
import {
  observeLiveInputFromEnvironment,
  type LiveObserverResult
} from "./live-observer.js";
import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import { TxlineHttpClient } from "./http-client.js";
import {
  normalizeFixtures,
  type NormalizedFixture
} from "./normalizer.js";

const HOUR_MS = 60 * 60 * 1_000;
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

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new Error("TXLINE_NETWORK must be mainnet or devnet.");
}

export function selectLiveCandidateFixtureIds(
  fixtures: readonly NormalizedFixture[],
  now: number,
  fixtureWindowHours: number
): string[] {
  const windowMs = fixtureWindowHours * HOUR_MS;
  return fixtures
    .filter(
      (fixture) =>
        fixture.selectionState === "SELECTABLE" &&
        Math.abs(fixture.startTimestamp - now) <= windowMs
    )
    .sort((left, right) => {
      const leftStarted = left.startTimestamp <= now ? 0 : 1;
      const rightStarted = right.startTimestamp <= now ? 0 : 1;
      return (
        leftStarted - rightStarted ||
        Math.abs(left.startTimestamp - now) -
          Math.abs(right.startTimestamp - now)
      );
    })
    .map((fixture) => fixture.fixtureId);
}

async function discoverCandidateFixtureIds(
  env: Readonly<Record<string, string | undefined>>,
  now: number
): Promise<readonly string[]> {
  const manualFixtureId = env.TXLINE_LIVE_FIXTURE_ID?.trim();
  if (manualFixtureId !== undefined && manualFixtureId !== "") {
    return [manualFixtureId];
  }

  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    throw new Error("TXLINE_API_TOKEN is required for live observation.");
  }
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const requestTimeoutMs = readPositiveInteger(
    env.TXLINE_REQUEST_TIMEOUT_MS,
    30_000,
    "TXLINE_REQUEST_TIMEOUT_MS"
  );
  const fixtureWindowHours = readPositiveInteger(
    env.TXLINE_LIVE_WINDOW_HOURS,
    6,
    "TXLINE_LIVE_WINDOW_HOURS"
  );
  const competitionId = env.TXLINE_COMPETITION_ID?.trim();
  const client = new TxlineHttpClient({
    apiOrigin: resolveTxlineOrigin(network),
    apiToken,
    requestTimeoutMs
  });
  const payload = await client.fetchFixturesSnapshot(
    competitionId === undefined || competitionId === ""
      ? undefined
      : competitionId
  );
  return selectLiveCandidateFixtureIds(
    normalizeFixtures(payload),
    now,
    fixtureWindowHours
  );
}

export interface LiveObserverWindowDependencies {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  observe(
    env: Readonly<Record<string, string | undefined>>
  ): Promise<LiveObserverResult>;
  discover?(
    env: Readonly<Record<string, string | undefined>>,
    now: number
  ): Promise<readonly string[]>;
}

const defaultDependencies: LiveObserverWindowDependencies = {
  now: Date.now,
  sleep: async (milliseconds) => {
    await sleep(milliseconds);
  },
  observe: observeLiveInputFromEnvironment,
  discover: discoverCandidateFixtureIds
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
  const startedAt = dependencies.now();
  const deadline = startedAt + totalMs;
  const candidateFixtureIds =
    (await dependencies.discover?.(env, startedAt)) ?? [];
  let candidateIndex = 0;
  let latest: LiveObserverResult | undefined;

  while (dependencies.now() < deadline) {
    const remainingMs = Math.max(1, deadline - dependencies.now());
    const attemptMs = Math.min(MAX_SINGLE_ATTEMPT_MS, remainingMs);
    const candidateFixtureId =
      candidateFixtureIds.length === 0
        ? undefined
        : candidateFixtureIds[candidateIndex % candidateFixtureIds.length];
    candidateIndex += 1;

    latest = await dependencies.observe({
      ...env,
      TXLINE_LIVE_OBSERVE_MS: String(attemptMs),
      ...(candidateFixtureId === undefined
        ? {}
        : { TXLINE_LIVE_FIXTURE_ID: candidateFixtureId })
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
