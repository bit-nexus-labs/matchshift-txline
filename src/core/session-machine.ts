import type { SessionMode, ViewerSession } from "./types.js";

export interface CreateSessionInput {
  sessionId: string;
  fixtureId: string;
  mode: SessionMode;
  liveEdgeTimestamp: number;
  visibilityCursor?: number;
  delayMs?: number;
}

export type SessionCommand =
  | { type: "ADVANCE_TO"; cursorMs: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "CATCH_UP" }
  | { type: "SET_DELAY"; delayMs: number }
  | { type: "START_REPLAY"; cursorMs: number };

function clampCursor(cursorMs: number, liveEdgeTimestamp: number): number {
  return Math.min(Math.max(0, cursorMs), liveEdgeTimestamp);
}

export function createViewerSession(input: CreateSessionInput): ViewerSession {
  const delayMs = Math.max(0, input.delayMs ?? 0);
  const fallbackCursor = input.liveEdgeTimestamp - delayMs;
  const requestedCursor =
    input.mode === "LIVE"
      ? input.liveEdgeTimestamp
      : input.visibilityCursor ?? fallbackCursor;

  return {
    sessionId: input.sessionId,
    fixtureId: input.fixtureId,
    mode: input.mode,
    visibilityCursor: clampCursor(requestedCursor, input.liveEdgeTimestamp),
    delayMs
  };
}

export function transitionSession(
  session: ViewerSession,
  command: SessionCommand,
  liveEdgeTimestamp: number
): ViewerSession {
  switch (command.type) {
    case "ADVANCE_TO": {
      const visibilityCursor = clampCursor(command.cursorMs, liveEdgeTimestamp);
      const mode =
        visibilityCursor === liveEdgeTimestamp
          ? "LIVE"
          : session.mode === "PAUSED" || session.mode === "REPLAY"
            ? session.mode
            : "DELAYED";
      return {
        ...session,
        mode,
        visibilityCursor,
        delayMs: liveEdgeTimestamp - visibilityCursor
      };
    }
    case "PAUSE":
      return { ...session, mode: "PAUSED" };
    case "RESUME":
      return {
        ...session,
        mode:
          session.visibilityCursor >= liveEdgeTimestamp ? "LIVE" : "DELAYED"
      };
    case "CATCH_UP":
      return {
        ...session,
        mode: "LIVE",
        visibilityCursor: liveEdgeTimestamp,
        delayMs: 0
      };
    case "SET_DELAY": {
      const delayMs = Math.max(0, command.delayMs);
      return {
        ...session,
        mode: delayMs === 0 ? "LIVE" : "DELAYED",
        delayMs,
        visibilityCursor: clampCursor(
          liveEdgeTimestamp - delayMs,
          liveEdgeTimestamp
        )
      };
    }
    case "START_REPLAY":
      return {
        ...session,
        mode: "REPLAY",
        visibilityCursor: clampCursor(command.cursorMs, liveEdgeTimestamp),
        delayMs: 0
      };
  }
}
