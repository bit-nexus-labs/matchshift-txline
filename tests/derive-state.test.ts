import { describe, expect, it } from "vitest";
import { deriveVisibleMatchState } from "../src/core/derive-state.js";
import { createViewerSession } from "../src/core/session-machine.js";
import {
  SYNTHETIC_MATCH,
  T0
} from "../src/replay/synthetic-scenario.js";

function sessionAt(minute: number, extraMs = 0) {
  return createViewerSession({
    sessionId: `viewer-${minute}-${extraMs}`,
    fixtureId: SYNTHETIC_MATCH.fixtureId,
    mode: "DELAYED",
    liveEdgeTimestamp: SYNTHETIC_MATCH.liveEdgeTimestamp,
    visibilityCursor: T0 + minute * 60_000 + extraMs
  });
}

describe("visible state derivation", () => {
  it("shows the goal, 1-0, and post-goal odds to the minute-52 viewer", () => {
    const state = deriveVisibleMatchState(SYNTHETIC_MATCH, sessionAt(52));

    expect(state.score).toEqual({ home: 1, away: 0 });
    expect(state.events.map((event) => event.eventType)).toContain("GOAL");
    expect(state.impliedProbabilities).toEqual({
      homeWin: 0.68,
      draw: 0.21,
      awayWin: 0.11
    });
  });

  it("withholds every downstream goal effect from the minute-43 viewer", () => {
    const state = deriveVisibleMatchState(SYNTHETIC_MATCH, sessionAt(43));

    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(state.events.map((event) => event.eventType)).not.toContain("GOAL");
    expect(state.impliedProbabilities).toEqual({
      homeWin: 0.44,
      draw: 0.31,
      awayWin: 0.25
    });
    expect(state.latestExplanation).not.toContain("scored");
  });

  it("unlocks the goal and post-goal odds in timestamp order", () => {
    const atGoal = deriveVisibleMatchState(SYNTHETIC_MATCH, sessionAt(49));
    const afterOdds = deriveVisibleMatchState(
      SYNTHETIC_MATCH,
      sessionAt(49, 10_000)
    );

    expect(atGoal.score).toEqual({ home: 1, away: 0 });
    expect(atGoal.impliedProbabilities?.homeWin).toBe(0.44);
    expect(afterOdds.score).toEqual({ home: 1, away: 0 });
    expect(afterOdds.impliedProbabilities?.homeWin).toBe(0.68);
  });
});
