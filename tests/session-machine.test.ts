import { describe, expect, it } from "vitest";
import {
  createViewerSession,
  transitionSession
} from "../src/core/session-machine.js";
import { SYNTHETIC_MATCH, T0 } from "../src/replay/synthetic-scenario.js";

describe("viewer session state machine", () => {
  it("moves a LIVE session rewound before the live edge into DELAYED mode", () => {
    const live = createViewerSession({
      sessionId: "live-rewind",
      fixtureId: SYNTHETIC_MATCH.fixtureId,
      mode: "LIVE",
      liveEdgeTimestamp: SYNTHETIC_MATCH.liveEdgeTimestamp
    });

    const rewound = transitionSession(
      live,
      { type: "ADVANCE_TO", cursorMs: T0 + 43 * 60_000 },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );

    expect(rewound.mode).toBe("DELAYED");
    expect(rewound.visibilityCursor).toBe(T0 + 43 * 60_000);
    expect(rewound.delayMs).toBe(9 * 60_000);
  });

  it("keeps a PAUSED session paused when advancing before the live edge", () => {
    const paused = createViewerSession({
      sessionId: "paused-advance",
      fixtureId: SYNTHETIC_MATCH.fixtureId,
      mode: "PAUSED",
      liveEdgeTimestamp: SYNTHETIC_MATCH.liveEdgeTimestamp,
      visibilityCursor: T0 + 10 * 60_000
    });

    const advanced = transitionSession(
      paused,
      { type: "ADVANCE_TO", cursorMs: T0 + 43 * 60_000 },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );

    expect(advanced.mode).toBe("PAUSED");
    expect(advanced.visibilityCursor).toBe(T0 + 43 * 60_000);
    expect(advanced.delayMs).toBe(9 * 60_000);
  });

  it("supports pause, resume, replay, delay, and catch-up transitions", () => {
    const delayed = createViewerSession({
      sessionId: "session-machine",
      fixtureId: SYNTHETIC_MATCH.fixtureId,
      mode: "DELAYED",
      liveEdgeTimestamp: SYNTHETIC_MATCH.liveEdgeTimestamp,
      visibilityCursor: T0 + 43 * 60_000
    });

    const paused = transitionSession(
      delayed,
      { type: "PAUSE" },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );
    const resumed = transitionSession(
      paused,
      { type: "RESUME" },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );
    const replay = transitionSession(
      resumed,
      { type: "START_REPLAY", cursorMs: T0 + 10 * 60_000 },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );
    const delayedAgain = transitionSession(
      replay,
      { type: "SET_DELAY", delayMs: 5 * 60_000 },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );
    const live = transitionSession(
      delayedAgain,
      { type: "CATCH_UP" },
      SYNTHETIC_MATCH.liveEdgeTimestamp
    );

    expect(paused.mode).toBe("PAUSED");
    expect(resumed.mode).toBe("DELAYED");
    expect(replay.mode).toBe("REPLAY");
    expect(delayedAgain.mode).toBe("DELAYED");
    expect(delayedAgain.delayMs).toBe(5 * 60_000);
    expect(live.mode).toBe("LIVE");
    expect(live.visibilityCursor).toBe(SYNTHETIC_MATCH.liveEdgeTimestamp);
  });
});
