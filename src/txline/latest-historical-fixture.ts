import { TxlineHttpError } from "./http-client.js";
import type { NormalizedFixture } from "./normalizer.js";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const HISTORICAL_MIN_AGE_MS = 6 * HOUR_MS;
export const HISTORICAL_MAX_AGE_MS = 14 * DAY_MS;

export function historicalFixtureStartEpochDay(nowTimestamp: number): number {
  if (!Number.isSafeInteger(nowTimestamp) || nowTimestamp <= 0) {
    throw new TxlineHttpError(
      "LATEST_FIXTURE_TIME_INVALID",
      "Latest historical fixture probe received an invalid current timestamp."
    );
  }
  return Math.floor((nowTimestamp - HISTORICAL_MAX_AGE_MS) / DAY_MS);
}

export function selectLatestHistoricalEligibleFixture(
  fixtures: readonly NormalizedFixture[],
  nowTimestamp: number
): NormalizedFixture {
  if (!Number.isSafeInteger(nowTimestamp) || nowTimestamp <= 0) {
    throw new TxlineHttpError(
      "LATEST_FIXTURE_TIME_INVALID",
      "Latest historical fixture probe received an invalid current timestamp."
    );
  }

  const newestAllowed = nowTimestamp - HISTORICAL_MIN_AGE_MS;
  const oldestAllowed = nowTimestamp - HISTORICAL_MAX_AGE_MS;
  const eligible = fixtures
    .filter(
      (fixture) =>
        fixture.selectionState === "SELECTABLE" &&
        fixture.startTimestamp >= oldestAllowed &&
        fixture.startTimestamp <= newestAllowed
    )
    .sort(
      (left, right) =>
        right.startTimestamp - left.startTimestamp ||
        left.fixtureId.localeCompare(right.fixtureId)
    );

  const selected = eligible[0];
  if (selected === undefined) {
    throw new TxlineHttpError(
      "LATEST_HISTORICAL_FIXTURE_NOT_FOUND",
      "TxLINE fixture snapshot contained no selectable fixture in the documented historical window of six hours through two weeks ago."
    );
  }
  return selected;
}
