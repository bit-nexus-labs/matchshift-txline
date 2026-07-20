import { applySequenceSafetyGate } from "./safety-gate.js";
import type {
  ImpliedProbabilities,
  MatchDefinition,
  MatchEventRecord,
  MatchEventType,
  Score,
  TeamVisibleStatistics,
  ViewerSession,
  VisibleEvent,
  VisibleMatchState,
  VisibleMatchStatistics
} from "./types.js";
import { effectiveVisibilityCursor, recordsVisibleAtCursor } from "./visibility.js";

function effectiveEventType(record: MatchEventRecord): MatchEventType {
  return record.activityType ?? record.eventType;
}

function toVisibleEvent(record: MatchEventRecord): VisibleEvent | undefined {
  const sequence = record.sequence ?? record.sourceOrder?.sourceSequence;
  if (sequence === undefined) {
    return undefined;
  }

  return {
    eventId: record.recordId,
    sequence,
    sourceTimestamp: record.sourceTimestamp,
    eventType: effectiveEventType(record),
    minute: record.minute,
    importance: record.importance ?? "STANDARD",
    category: record.category ?? "MATCH",
    ...(record.team === undefined ? {} : { team: record.team }),
    ...(record.clockLabel === undefined ? {} : { clockLabel: record.clockLabel }),
    ...(record.label === undefined ? {} : { label: record.label }),
    ...(record.detail === undefined ? {} : { detail: record.detail }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome })
  };
}

function emptyTeamStatistics(): TeamVisibleStatistics {
  return {
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    yellowCards: 0,
    redCards: 0,
    substitutions: 0,
    freeKicks: 0,
    throwIns: 0,
    goalKicks: 0,
    injuries: 0
  };
}

function applyEventStatistics(
  statistics: VisibleMatchStatistics,
  record: MatchEventRecord
): void {
  if (record.team !== "HOME" && record.team !== "AWAY") {
    return;
  }
  const target = record.team === "HOME" ? statistics.home : statistics.away;
  switch (effectiveEventType(record)) {
    case "SHOT":
      target.shots += 1;
      if (record.outcome === "OnTarget") {
        target.shotsOnTarget += 1;
      }
      break;
    case "CORNER":
      target.corners += 1;
      break;
    case "YELLOW_CARD":
      target.yellowCards += 1;
      break;
    case "RED_CARD":
      target.redCards += 1;
      break;
    case "SUBSTITUTION":
      target.substitutions += 1;
      break;
    case "FREE_KICK":
      target.freeKicks += 1;
      break;
    case "THROW_IN":
      target.throwIns += 1;
      break;
    case "GOAL_KICK":
      target.goalKicks += 1;
      break;
    case "INJURY":
      target.injuries += 1;
      break;
    default:
      break;
  }
}

function explainLatestEvent(event: VisibleEvent, score: Score): string {
  if (event.eventType === "KICKOFF") {
    return "Kickoff is now visible to this viewer.";
  }
  if (event.eventType === "GOAL") {
    const team = event.team === "HOME" ? "Home" : "Away";
    return `${event.label ?? `${team} goal`} at ${event.clockLabel ?? `minute ${event.minute}`}. The visible score is ${score.home}-${score.away}.`;
  }

  const title = event.label ?? event.eventType.replaceAll("_", " ").toLowerCase();
  const timing = event.clockLabel ?? `minute ${event.minute}`;
  return event.detail === undefined
    ? `${title} at ${timing}.`
    : `${title} at ${timing}. ${event.detail}`;
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
  const statistics: VisibleMatchStatistics = {
    home: emptyTeamStatistics(),
    away: emptyTeamStatistics()
  };

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
    applyEventStatistics(statistics, record);

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
    statistics,
    ...(impliedProbabilities === undefined ? {} : { impliedProbabilities }),
    ...(latestEvent === undefined || latestTrustedRecord?.kind === "recovery"
      ? {}
      : { latestExplanation: explainLatestEvent(latestEvent, score) }),
    safety: safety.status
  };
}
