import { applySequenceSafetyGate } from "./safety-gate.js";
import type {
  ImpliedProbabilities,
  MatchDefinition,
  MatchEventRecord,
  Score,
  ViewerSession,
  VisibleEvent,
  VisibleMatchState
} from "./types.js";
import { effectiveVisibilityCursor, recordsVisibleAtCursor } from "./visibility.js";

function toVisibleEvent(record: MatchEventRecord): VisibleEvent | undefined {
  const sequence = record.sequence ?? record.sourceOrder?.sourceSequence;
  if (sequence === undefined) {
    return undefined;
  }

  return {
    eventId: record.recordId,
    sequence,
    sourceTimestamp: record.sourceTimestamp,
    eventType: record.eventType,
    minute: record.minute,
    ...(record.team === undefined ? {} : { team: record.team }),
    ...(record.matchSecond === undefined ? {} : { matchSecond: record.matchSecond }),
    ...(record.label === undefined ? {} : { label: record.label }),
    ...(record.importance === undefined ? {} : { importance: record.importance }),
    ...(record.phase === undefined ? {} : { phase: record.phase })
  };
}

function explainLatestEvent(event: VisibleEvent, score: Score): string {
  if (event.eventType === "KICKOFF") {
    return "Kickoff is now visible to this viewer.";
  }

  if (event.eventType === "GOAL") {
    const team = event.team === "HOME" ? "Home" : "Away";
    return `${team} scored at minute ${event.minute}. The visible score is ${score.home}-${score.away}.`;
  }

  return `${event.label ?? event.eventType} became visible at minute ${event.minute}.`;
}

export function deriveVisibleMatchState(
  match: MatchDefinition,
  session: ViewerSession
): VisibleMatchState {
  const cursorMs = effectiveVisibilityCursor(session, match.liveEdgeTimestamp);
  const visibleRecords = recordsVisibleAtCursor(match.records, cursorMs);
  const safety = applySequenceSafetyGate(
    visibleRecords,
    match.expectedFirstSequence
  );

  let score: Score = { home: 0, away: 0 };
  let impliedProbabilities: ImpliedProbabilities | undefined;
  const events: VisibleEvent[] = [];

  for (const record of safety.trustedRecords) {
    if (record.kind === "recovery") {
      score = { ...record.snapshot.score };
      impliedProbabilities = record.snapshot.impliedProbabilities;
      continue;
    }

    if (record.kind === "odds") {
      impliedProbabilities = { ...record.impliedProbabilities };
      continue;
    }

    if (record.eventType === "GOAL") {
      if (record.team === "HOME") {
        score = { ...score, home: score.home + 1 };
      } else if (record.team === "AWAY") {
        score = { ...score, away: score.away + 1 };
      }
    }

    const visibleEvent = toVisibleEvent(record);
    if (visibleEvent !== undefined) {
      events.push(visibleEvent);
    }
  }

  const latestEvent = events.at(-1);
  const latestTrustedRecord = safety.trustedRecords.at(-1);
  const viewerMinute = Math.max(
    0,
    Math.floor((cursorMs - match.kickoffTimestamp) / 60_000)
  );

  return {
    fixtureId: match.fixtureId,
    source: {
      label: match.label,
      provenance: match.provenance
    },
    session: {
      sessionId: session.sessionId,
      mode: session.mode,
      statusBadge: safety.status.active ? "SAFE_HOLD" : session.mode,
      visibilityCursor: cursorMs,
      viewerMinute
    },
    score,
    events,
    ...(impliedProbabilities === undefined ? {} : { impliedProbabilities }),
    ...(latestEvent === undefined || latestTrustedRecord?.kind === "recovery"
      ? {}
      : { latestExplanation: explainLatestEvent(latestEvent, score) }),
    safety: safety.status
  };
}
