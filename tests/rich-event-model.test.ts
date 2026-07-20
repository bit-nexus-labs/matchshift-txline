import { describe, expect, it } from "vitest";
import { deriveVisibleMatchState } from "../src/core/derive-state.js";
import type { MatchDefinition, ViewerSession } from "../src/core/types.js";

const kickoffTimestamp = 1_700_000_000_000;

const match: MatchDefinition = {
  fixtureId: "rich-event-foundation-test",
  label: "Rich event foundation test",
  provenance: "SYNTHETIC",
  kickoffTimestamp,
  liveEdgeTimestamp: kickoffTimestamp + 20 * 60_000,
  expectedFirstSequence: 1,
  records: [
    {
      fixtureId: "rich-event-foundation-test",
      recordId: "baseline",
      sequence: 1,
      sourceTimestamp: kickoffTimestamp,
      receivedTimestamp: kickoffTimestamp,
      provenance: "SYNTHETIC",
      kind: "recovery",
      recoveryReason: "Test baseline",
      snapshot: { score: { home: 0, away: 0 } }
    },
    {
      fixtureId: "rich-event-foundation-test",
      recordId: "yellow-card",
      sequence: 2,
      sourceTimestamp: kickoffTimestamp + 12 * 60_000 + 23_000,
      receivedTimestamp: kickoffTimestamp + 12 * 60_000 + 23_000,
      provenance: "SYNTHETIC",
      kind: "event",
      eventType: "YELLOW_CARD",
      team: "AWAY",
      minute: 13,
      matchSecond: 743,
      label: "Yellow card",
      importance: "KEY",
      phase: "FIRST_HALF"
    }
  ]
};

const session: ViewerSession = {
  sessionId: "rich-event-session",
  fixtureId: match.fixtureId,
  mode: "LIVE",
  visibilityCursor: match.liveEdgeTimestamp,
  delayMs: 0
};

describe("rich match event model foundation", () => {
  it("preserves sanitized rich metadata without changing the score", () => {
    const state = deriveVisibleMatchState(match, session);

    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(state.events).toEqual([
      {
        eventId: "yellow-card",
        sequence: 2,
        sourceTimestamp: kickoffTimestamp + 12 * 60_000 + 23_000,
        eventType: "YELLOW_CARD",
        minute: 13,
        team: "AWAY",
        matchSecond: 743,
        label: "Yellow card",
        importance: "KEY",
        phase: "FIRST_HALF"
      }
    ]);
    expect(state.latestExplanation).toBe(
      "Yellow card became visible at minute 13."
    );
    expect(state.safety.active).toBe(false);
  });
});
