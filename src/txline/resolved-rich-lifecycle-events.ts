import type { MatchEventType, TeamSide } from "../core/types.js";
import type { NormalizedFixture } from "./normalizer.js";
import {
  mapResolvedScoreActionToRichEvent,
  type ResolvedScoreAction,
  type SanitizedRichScoreEvent
} from "./rich-score-event-mapping.js";

export interface ResolvedLifecycleAction extends ResolvedScoreAction {
  sourceSequence: number;
}

export interface SanitizedResolvedLifecycleEvent
  extends SanitizedRichScoreEvent {
  sourceSequence: number;
  sourceTimestamp: number;
}

function eventIdentity(event: {
  eventType: MatchEventType;
  team?: TeamSide;
  matchSecond: number;
  label: string;
}): string {
  return [
    event.eventType,
    event.team ?? "NONE",
    String(event.matchSecond),
    event.label
  ].join(":");
}

function compareEvents(
  left: SanitizedResolvedLifecycleEvent,
  right: SanitizedResolvedLifecycleEvent
): number {
  return (
    left.matchSecond - right.matchSecond ||
    left.sourceSequence - right.sourceSequence ||
    left.eventType.localeCompare(right.eventType)
  );
}

/**
 * Converts actions that have already passed the existing TxLINE lifecycle
 * resolution into sanitized MatchShift events. Raw payload traversal,
 * amendment handling, discard handling, and provider-ID deduplication must
 * happen before this boundary.
 */
export function buildSanitizedResolvedLifecycleEvents(
  actions: readonly ResolvedLifecycleAction[],
  fixture: NormalizedFixture
): SanitizedResolvedLifecycleEvent[] {
  const unique = new Map<string, SanitizedResolvedLifecycleEvent>();

  for (const action of actions) {
    if (!Number.isSafeInteger(action.sourceSequence) || action.sourceSequence <= 0) {
      continue;
    }
    const event = mapResolvedScoreActionToRichEvent(action, fixture);
    if (event === undefined) {
      continue;
    }
    const sanitized: SanitizedResolvedLifecycleEvent = {
      ...event,
      sourceSequence: action.sourceSequence,
      sourceTimestamp: fixture.startTimestamp + event.matchSecond * 1_000
    };
    unique.set(eventIdentity(sanitized), sanitized);
  }

  return [...unique.values()].sort(compareEvents);
}
