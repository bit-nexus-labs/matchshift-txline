import { describe, expect, it } from "vitest";
import { deriveVisibleMatchState } from "../src/core/derive-state.js";
import type { ViewerSession } from "../src/core/types.js";
import { CURATED_REAL_MATCH } from "../src/replay/curated-real-match.js";
import { DEMO_PAGE_HTML } from "../src/ui/demo-page.js";

function replaySession(visibilityCursor: number): ViewerSession {
  return {
    sessionId: "curated-clock-test",
    fixtureId: CURATED_REAL_MATCH.fixtureId,
    mode: "REPLAY",
    visibilityCursor,
    delayMs: 0
  };
}

describe("curated replay clock display", () => {
  it("keeps the football clock separate from source-timeline elapsed time", () => {
    const goal = CURATED_REAL_MATCH.records.find(
      (record) => record.kind === "event" && record.eventType === "GOAL"
    );

    expect(goal?.sourceTimestamp).toBeDefined();
    expect(goal?.sourceTimestamp - CURATED_REAL_MATCH.kickoffTimestamp).toBe(
      7_256_000
    );

    const state = deriveVisibleMatchState(
      CURATED_REAL_MATCH,
      replaySession(goal?.sourceTimestamp ?? 0)
    );

    expect(state.events.at(-1)).toMatchObject({
      eventType: "GOAL",
      minute: 106,
      clockLabel: "106′"
    });
  });

  it("ends the curated football clock at FT", () => {
    const state = deriveVisibleMatchState(
      CURATED_REAL_MATCH,
      replaySession(CURATED_REAL_MATCH.liveEdgeTimestamp)
    );

    expect(state.events.at(-1)).toMatchObject({
      eventType: "MATCH_FINAL",
      clockLabel: "FT"
    });
  });

  it("renders match clock and replay elapsed as two explicit UI values", () => {
    expect(DEMO_PAGE_HTML).toContain('id="cursor-match-clock"');
    expect(DEMO_PAGE_HTML).toContain("function latestVisibleMatchClock");
    expect(DEMO_PAGE_HTML).toContain(
      'if(last.eventType==="MATCH_FINAL")return "FT"'
    );
    expect(DEMO_PAGE_HTML).toContain(
      '"Match clock "+latestVisibleMatchClock'
    );
    expect(DEMO_PAGE_HTML).toContain('"Replay elapsed "');
  });
});
