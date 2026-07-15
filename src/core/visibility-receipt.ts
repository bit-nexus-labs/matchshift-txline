import { createHash } from "node:crypto";
import type { VisibleMatchState } from "./types.js";

export const VISIBILITY_RECEIPT_VERSION = "matchshift-receipt-v1" as const;

export interface VisibilityReceipt {
  version: typeof VISIBILITY_RECEIPT_VERSION;
  fixtureId: string;
  sessionId: string;
  provenance: VisibleMatchState["source"]["provenance"];
  mode: VisibleMatchState["session"]["mode"];
  visibilityCursor: number;
  viewerMinute: number;
  visibleEventCount: number;
  score: VisibleMatchState["score"];
  safetyActive: boolean;
  stateHash: string;
}

function canonicalStatePayload(state: VisibleMatchState): string {
  return JSON.stringify({
    version: VISIBILITY_RECEIPT_VERSION,
    fixtureId: state.fixtureId,
    source: {
      label: state.source.label,
      provenance: state.source.provenance
    },
    session: {
      sessionId: state.session.sessionId,
      mode: state.session.mode,
      statusBadge: state.session.statusBadge,
      visibilityCursor: state.session.visibilityCursor,
      viewerMinute: state.session.viewerMinute
    },
    score: state.score,
    events: state.events.map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      sourceTimestamp: event.sourceTimestamp,
      eventType: event.eventType,
      minute: event.minute,
      team: event.team ?? null
    })),
    impliedProbabilities: state.impliedProbabilities ?? null,
    latestExplanation: state.latestExplanation ?? null,
    safety: {
      active: state.safety.active,
      reason: state.safety.reason ?? null,
      blockedFromSequence: state.safety.blockedFromSequence ?? null,
      recoveredAtSequence: state.safety.recoveredAtSequence ?? null
    }
  });
}

export function createVisibilityReceipt(
  state: VisibleMatchState
): VisibilityReceipt {
  const digest = createHash("sha256")
    .update(canonicalStatePayload(state), "utf8")
    .digest("hex");

  return {
    version: VISIBILITY_RECEIPT_VERSION,
    fixtureId: state.fixtureId,
    sessionId: state.session.sessionId,
    provenance: state.source.provenance,
    mode: state.session.mode,
    visibilityCursor: state.session.visibilityCursor,
    viewerMinute: state.session.viewerMinute,
    visibleEventCount: state.events.length,
    score: { ...state.score },
    safetyActive: state.safety.active,
    stateHash: `sha256:${digest}`
  };
}
