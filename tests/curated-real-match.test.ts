import { describe, expect, it } from "vitest";
import { CURATED_REAL_MATCH } from "../src/replay/curated-real-match.js";
import { validateCuratedReplayMatch } from "../src/txline/curated-replay.js";

describe("curated Spain vs Argentina replay", () => {
  it("publishes a validated 223-record rich MatchShift product model", () => {
    expect(() => validateCuratedReplayMatch(CURATED_REAL_MATCH)).not.toThrow();
    expect(CURATED_REAL_MATCH).toMatchObject({
      fixtureId: "spain-argentina-2026-07-19",
      provenance: "TXLINE",
      display: { homeLabel: "Spain", awayLabel: "Argentina" }
    });
    expect(CURATED_REAL_MATCH.records).toHaveLength(223);
    expect(
      CURATED_REAL_MATCH.records.filter((record) => record.kind === "event")
    ).toHaveLength(206);
    expect(
      CURATED_REAL_MATCH.records.filter((record) => record.kind === "odds")
    ).toHaveLength(15);
    expect(
      CURATED_REAL_MATCH.records.filter((record) => record.kind === "recovery")
    ).toHaveLength(2);
  });

  it("contains key, standard and flow events with one valid home goal", () => {
    const events = CURATED_REAL_MATCH.records.filter(
      (record) => record.kind === "event"
    );
    const goals = events.filter((record) => record.eventType === "GOAL");
    const richCounts = events.reduce<Record<string, number>>((counts, record) => {
      const importance = record.importance ?? "STANDARD";
      counts[importance] = (counts[importance] ?? 0) + 1;
      return counts;
    }, {});

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      activityType: "GOAL",
      team: "HOME",
      minute: 106,
      clockLabel: "106′",
      label: "GOAL — Spain",
      detail: "Ferran Torres Garcia"
    });
    expect(richCounts).toEqual({ KEY: 22, STANDARD: 68, FLOW: 116 });
    expect(events.some((record) => record.activityType === "VAR_DECISION")).toBe(
      true
    );
    expect(events.some((record) => record.activityType === "RED_CARD")).toBe(
      true
    );
    expect(events.some((record) => record.activityType === "MATCH_FINAL")).toBe(
      true
    );
  });

  it("starts at 0-0 and ends with a trusted 1-0 recovery", () => {
    const recoveries = CURATED_REAL_MATCH.records.filter(
      (record) => record.kind === "recovery"
    );
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
      "participant1Id",
      "participant2Id",
      "dateOfBirth",
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
