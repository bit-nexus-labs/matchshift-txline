import type {
  MatchEventImportance,
  MatchEventType,
  MatchPhase,
  TeamSide
} from "../core/types.js";
import type { NormalizedFixture } from "./normalizer.js";

const MAX_MATCH_CLOCK_SECONDS = 5 * 60 * 60;

type Participant = "Participant1" | "Participant2" | 1 | 2;

export interface ResolvedScoreAction {
  action: string;
  clockSeconds: number;
  participant?: Participant;
  nestedAction?: string;
  outcome?: string;
}

export interface SanitizedRichScoreEvent {
  eventType: MatchEventType;
  team?: TeamSide;
  minute: number;
  matchSecond: number;
  label: string;
  importance: MatchEventImportance;
  phase: MatchPhase;
}

interface EventMapping {
  eventType: MatchEventType;
  label: string;
  importance: MatchEventImportance;
}

function canonical(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

function participantSide(
  participant: Participant | undefined,
  fixture: NormalizedFixture
): TeamSide | undefined {
  const participant1 = participant === 1 || participant === "Participant1";
  const participant2 = participant === 2 || participant === "Participant2";
  if (!participant1 && !participant2) {
    return undefined;
  }
  if (participant1) {
    return fixture.participant1IsHome ? "HOME" : "AWAY";
  }
  return fixture.participant1IsHome ? "AWAY" : "HOME";
}

function phaseForEvent(
  matchSecond: number,
  eventType: MatchEventType
): MatchPhase {
  if (eventType === "MATCH_FINAL") {
    return "FINISHED";
  }
  if (eventType === "HALF_TIME") {
    return "HALF_TIME";
  }
  if (matchSecond < 45 * 60) {
    return "FIRST_HALF";
  }
  if (matchSecond < 90 * 60) {
    return "SECOND_HALF";
  }
  if (matchSecond < 105 * 60) {
    return "EXTRA_TIME_FIRST_HALF";
  }
  if (matchSecond < 120 * 60) {
    return "EXTRA_TIME_SECOND_HALF";
  }
  return "FINISHED";
}

function mapAction(input: ResolvedScoreAction): EventMapping | undefined {
  const action = canonical(input.action);
  const nestedAction = canonical(input.nestedAction);
  const outcome = canonical(input.outcome);

  if (action === "kickoff") {
    return { eventType: "KICKOFF", label: "Kickoff", importance: "KEY" };
  }
  if (["period_start", "second_half"].includes(action)) {
    return {
      eventType: "PERIOD_START",
      label: "Period begins",
      importance: "KEY"
    };
  }
  if (action === "extra_time_start") {
    return {
      eventType: "EXTRA_TIME_START",
      label: "Extra time begins",
      importance: "KEY"
    };
  }
  if (["halftime_finalised", "half_time", "halftime"].includes(action)) {
    return {
      eventType: "HALF_TIME",
      label: "Half-time",
      importance: "KEY"
    };
  }
  if (action === "game_finalised") {
    return {
      eventType: "MATCH_FINAL",
      label: "Match finalised",
      importance: "KEY"
    };
  }
  if (action === "goal") {
    return { eventType: "GOAL", label: "Goal", importance: "KEY" };
  }
  if (["goal_disallowed", "disallowed_goal"].includes(action)) {
    return {
      eventType: "GOAL_DISALLOWED",
      label: "Goal disallowed",
      importance: "KEY"
    };
  }
  if (["var_start", "var"].includes(action)) {
    return {
      eventType: "VAR_REVIEW",
      label: "VAR review",
      importance: "KEY"
    };
  }
  if (action === "var_end") {
    return outcome === "overturned"
      ? {
          eventType: "VAR_OVERTURNED",
          label: "VAR: decision overturned",
          importance: "KEY"
        }
      : {
          eventType: "VAR_REVIEW",
          label: "VAR review completed",
          importance: "KEY"
        };
  }
  if (action === "yellow_card") {
    return {
      eventType: "YELLOW_CARD",
      label: "Yellow card",
      importance: "KEY"
    };
  }
  if (action === "red_card") {
    return {
      eventType: "RED_CARD",
      label: "Red card",
      importance: "KEY"
    };
  }
  if (action === "corner") {
    return { eventType: "CORNER", label: "Corner", importance: "FULL" };
  }
  if (["shot", "shot_on_target", "shot_off_target"].includes(action) || nestedAction === "shot") {
    return { eventType: "SHOT", label: "Shot", importance: "FULL" };
  }
  if (action === "free_kick" || nestedAction === "free_kick") {
    return {
      eventType: "FREE_KICK",
      label: "Free kick",
      importance: "FULL"
    };
  }
  if (["substitution", "substitution_in", "substitution_out"].includes(action) || nestedAction === "substitution") {
    return {
      eventType: "SUBSTITUTION",
      label: "Substitution",
      importance: "FULL"
    };
  }
  if (action === "injury" || nestedAction === "injury") {
    return {
      eventType: "INJURY",
      label: "Injury stoppage",
      importance: "FULL"
    };
  }
  if (action === "penalty") {
    return { eventType: "PENALTY", label: "Penalty", importance: "KEY" };
  }
  if (action === "offside") {
    return { eventType: "OFFSIDE", label: "Offside", importance: "FULL" };
  }
  if (action === "throw_in") {
    return { eventType: "THROW_IN", label: "Throw-in", importance: "FULL" };
  }
  if (action === "goal_kick") {
    return { eventType: "GOAL_KICK", label: "Goal kick", importance: "FULL" };
  }
  if (["added_time", "injury_time"].includes(action)) {
    return {
      eventType: "ADDED_TIME",
      label: "Added time",
      importance: "KEY"
    };
  }
  return undefined;
}

/**
 * Maps one already lifecycle-resolved score action into the public MatchShift
 * product taxonomy. This function intentionally does not unwrap provider
 * payloads, resolve amendments, or perform discard/dedup handling.
 */
export function mapResolvedScoreActionToRichEvent(
  input: ResolvedScoreAction,
  fixture: NormalizedFixture
): SanitizedRichScoreEvent | undefined {
  if (
    !Number.isSafeInteger(input.clockSeconds) ||
    input.clockSeconds < 0 ||
    input.clockSeconds > MAX_MATCH_CLOCK_SECONDS
  ) {
    return undefined;
  }

  const mapping = mapAction(input);
  if (mapping === undefined) {
    return undefined;
  }

  const team = participantSide(input.participant, fixture);
  return {
    eventType: mapping.eventType,
    ...(team === undefined ? {} : { team }),
    minute:
      mapping.eventType === "KICKOFF"
        ? 0
        : Math.floor(input.clockSeconds / 60) + 1,
    matchSecond: input.clockSeconds,
    label: mapping.label,
    importance: mapping.importance,
    phase: phaseForEvent(input.clockSeconds, mapping.eventType)
  };
}
