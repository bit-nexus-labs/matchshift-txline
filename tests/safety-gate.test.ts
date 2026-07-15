import { describe, expect, it } from "vitest";
import { deriveVisibleMatchState } from "../src/core/derive-state.js";
import { createViewerSession } from "../src/core/session-machine.js";
import type { MatchDefinition } from "../src/core/types.js";
import {
  SYNTHETIC_MATCH,
  SYNTHETIC_RECORDS,
  SYNTHETIC_RECOVERY
} from "../src/replay/synthetic-scenario.js";

function viewerFor(match: MatchDefinition) {
  return createViewerSession({
    sessionId: "safety-viewer",
    fixtureId: match.fixtureId,
    mode: "LIVE",
    liveEdgeTimestamp: match.liveEdgeTimestamp
  });
}

describe("sequence safety gate", () => {
  it("fails closed when the first visible record misses the expected baseline", () => {
    const missingBaselineMatch: MatchDefinition = {
      ...SYNTHETIC_MATCH,
      records: SYNTHETIC_RECORDS.filter((record) => record.sequence !== 1)
    };
    const state = deriveVisibleMatchState(
      missingBaselineMatch,
      viewerFor(missingBaselineMatch)
    );

    expect(state.session.statusBadge).toBe("SAFE_HOLD");
    expect(state.safety.active).toBe(true);
    expect(state.safety.blockedFromSequence).toBe(1);
    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(state.events).toEqual([]);
    expect(state.impliedProbabilities).toBeUndefined();
  });

  it("fails closed and blocks uncertain records after a gap", () => {
    const gapMatch: MatchDefinition = {
      ...SYNTHETIC_MATCH,
      records: SYNTHETIC_RECORDS.filter((record) => record.sequence !== 3)
    };
    const state = deriveVisibleMatchState(gapMatch, viewerFor(gapMatch));

    expect(state.session.statusBadge).toBe("SAFE_HOLD");
    expect(state.safety.active).toBe(true);
    expect(state.safety.blockedFromSequence).toBe(3);
    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(state.impliedProbabilities?.homeWin).toBe(0.44);
  });

  it("resumes from an explicit trusted recovery snapshot", () => {
    const recoveredMatch: MatchDefinition = {
      ...SYNTHETIC_MATCH,
      records: [
        ...SYNTHETIC_RECORDS.filter((record) => record.sequence !== 3),
        SYNTHETIC_RECOVERY
      ]
    };
    const state = deriveVisibleMatchState(
      recoveredMatch,
      viewerFor(recoveredMatch)
    );

    expect(state.safety.active).toBe(false);
    expect(state.safety.recoveredAtSequence).toBe(5);
    expect(state.score).toEqual({ home: 1, away: 0 });
    expect(state.impliedProbabilities?.homeWin).toBe(0.68);
    expect(state.latestExplanation).toBeUndefined();
  });
});
