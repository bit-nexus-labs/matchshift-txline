import { describe, expect, it } from "vitest";
import { CURATED_REAL_MATCH } from "../src/replay/curated-real-match.js";
import { validateCuratedReplayMatch } from "../src/txline/curated-replay.js";

describe("curated Spain vs Argentina replay", () => {
  it("publishes only the validated 19-record MatchShift product model", () => {
    expect(() => validateCuratedReplayMatch(CURATED_REAL_MATCH)).not.toThrow();
    expect(CURATED_REAL_MATCH).toMatchObject({
      fixtureId: "spain-argentina-2026-07-19",
      provenance: "TXLINE",
      display: { homeLabel: "Spain", awayLabel: "Argentina" }
    });
    expect(CURATED_REAL_MATCH.records).toHaveLength(19);
    expect(
      CURATED_REAL_MATCH.records.filter((record) => record.kind === "odds")
    ).toHaveLength(15);
  });

  it("exposes one confirmed home goal at minute 106 and a final 1-0 recovery", () => {
    const goals = CURATED_REAL_MATCH.records.filter(
      (record) => record.kind === "event" && record.eventType === "GOAL"
    );
    const recoveries = CURATED_REAL_MATCH.records.filter(
      (record) => record.kind === "recovery"
    );

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ team: "HOME", minute: 106 });
    expect(recoveries[0]).toMatchObject({
      snapshot: { score: { home: 0, away: 0 } }
    });
    expect(recoveries.at(-1)).toMatchObject({
      snapshot: { score: { home: 1, away: 0 } }
    });
  });

  it("contains no provider identifiers or private receipt material", () => {
    const serialized = JSON.stringify(CURATED_REAL_MATCH);
    for (const forbidden of [
      "FixtureId",
      "MessageId",
      "ConnectionId",
      "PlayerId",
      "apiToken",
      "guestJwt",
      "private receipt"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      CURATED_REAL_MATCH.records.every(
        (record) =>
          record.sourceOrder?.sourceMessageId === undefined &&
          record.sourceOrder?.sseEventId === undefined
      )
    ).toBe(true);
  });
});
