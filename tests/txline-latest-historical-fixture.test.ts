import { describe, expect, it } from "vitest";
import { TxlineHttpError } from "../src/txline/http-client.js";
import {
  HISTORICAL_MAX_AGE_MS,
  HISTORICAL_MIN_AGE_MS,
  historicalFixtureStartEpochDay,
  selectLatestHistoricalEligibleFixture
} from "../src/txline/latest-historical-fixture.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function fixture(
  fixtureId: string,
  startTimestamp: number,
  selectionState: NormalizedFixture["selectionState"] = "SELECTABLE"
): NormalizedFixture {
  return {
    fixtureId,
    startTime: startTimestamp,
    startTimestamp,
    participant1: "Home",
    participant2: "Away",
    participant1IsHome: true,
    homeParticipant: "Home",
    awayParticipant: "Away",
    selectionState
  };
}

describe("latest TxLINE historical fixture selection", () => {
  it("selects the newest selectable fixture inside the documented age window", () => {
    const selected = selectLatestHistoricalEligibleFixture(
      [
        fixture("too-new", NOW - HISTORICAL_MIN_AGE_MS + 1),
        fixture("older", NOW - 10 * 60 * 60_000),
        fixture("newest-eligible", NOW - HISTORICAL_MIN_AGE_MS),
        fixture("ambiguous", NOW - 7 * 60 * 60_000, "AMBIGUOUS"),
        fixture("too-old", NOW - HISTORICAL_MAX_AGE_MS - 1)
      ],
      NOW
    );

    expect(selected.fixtureId).toBe("newest-eligible");
  });

  it("fails closed when the fixture snapshot has no eligible candidate", () => {
    const error = (() => {
      try {
        selectLatestHistoricalEligibleFixture(
          [fixture("too-new", NOW - HISTORICAL_MIN_AGE_MS + 1)],
          NOW
        );
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe(
      "LATEST_HISTORICAL_FIXTURE_NOT_FOUND"
    );
  });

  it("queries fixtures from the oldest documented historical day", () => {
    expect(historicalFixtureStartEpochDay(NOW)).toBe(
      Math.floor((NOW - HISTORICAL_MAX_AGE_MS) / (24 * 60 * 60_000))
    );
  });
});
