import type {
  MatchEventImportance,
  MatchEventType,
  MatchPhase,
  TeamSide
} from "../core/types.js";
import { TxlineHttpError } from "./http-client.js";
import {
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

type UnknownRecord = Record<string, unknown>;
type Participant = "Participant1" | "Participant2";

interface DirectAction {
  record: UnknownRecord;
  fixtureId: string;
  sequence: number;
  timestamp: number;
  action: string;
  actionId?: string;
  referencedActionId?: string;
}

interface ConfirmedGoal {
  participant: Participant;
  clockSeconds: number;
  sequence: number;
  record: UnknownRecord;
}

interface RichEventMapping {
  eventType: MatchEventType;
  importance: MatchEventImportance;
  label: string;
}

interface RichLifecycleEvent extends RichEventMapping {
  clockSeconds: number;
  sequence: number;
  phase: MatchPhase;
  team?: TeamSide;
  goal?: ConfirmedGoal;
}

interface GoalLifecycleResult {
  confirmed: ConfirmedGoal[];
  disallowed: RichLifecycleEvent[];
}

const MAX_MATCH_CLOCK_SECONDS = 5 * 60 * 60;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}

function readInteger(value: unknown): number | undefined {
  const parsed = readFiniteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed)
    ? parsed
    : undefined;
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

function nestedLifecycleReference(record: UnknownRecord): string | undefined {
  const data = asRecord(record.Data ?? record.data);
  if (data === undefined) {
    return undefined;
  }
  const candidates = [
    data.ActionId,
    data.actionId,
    data.TargetId,
    data.targetId,
    data.DiscardedId,
    data.discardedId,
    asRecord(data.Previous)?.Id,
    asRecord(data.previous)?.id,
    asRecord(data.New)?.Id,
    asRecord(data.new)?.id
  ];
  for (const candidate of candidates) {
    const value = readStringLike(candidate);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function directAction(value: unknown): DirectAction | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const fixtureId = readStringLike(record.fixtureId ?? record.FixtureId);
  const sequence = readInteger(record.seq ?? record.Seq);
  const timestamp = parseSourceTimestamp(record.ts ?? record.Ts);
  const action = readStringLike(record.action ?? record.Action)?.toLowerCase();
  if (
    fixtureId === undefined ||
    sequence === undefined ||
    sequence < 0 ||
    timestamp === undefined ||
    action === undefined
  ) {
    return undefined;
  }
  const actionId = readStringLike(
    record.MessageId ??
      record.messageId ??
      record.EventId ??
      record.eventId ??
      record.Id ??
      record.id
  );
  const referencedActionId = nestedLifecycleReference(record);
  return {
    record,
    fixtureId,
    sequence,
    timestamp,
    action,
    ...(actionId === undefined ? {} : { actionId }),
    ...(referencedActionId === undefined ? {} : { referencedActionId })
  };
}

function orderActions(left: DirectAction, right: DirectAction): number {
  return left.sequence - right.sequence || left.timestamp - right.timestamp;
}

function clockSeconds(record: UnknownRecord): number | undefined {
  const clock = asRecord(record.Clock ?? record.clock);
  const seconds = readInteger(clock?.Seconds ?? clock?.seconds);
  return seconds !== undefined && seconds >= 0 && seconds <= MAX_MATCH_CLOCK_SECONDS
    ? seconds
    : undefined;
}

function participantValue(value: unknown): Participant | undefined {
  const participant = readStringLike(value)?.trim().toLowerCase();
  if (participant === "1" || participant === "participant1") {
    return "Participant1";
  }
  if (participant === "2" || participant === "participant2") {
    return "Participant2";
  }
  return undefined;
}

function participant(record: UnknownRecord): Participant | undefined {
  const direct = participantValue(record.Participant ?? record.participant);
  if (direct !== undefined) {
    return direct;
  }
  const dataSoccer = asRecord(
    record.DataSoccer ?? record.dataSoccer ?? record.Data ?? record.data
  );
  return participantValue(dataSoccer?.Participant ?? dataSoccer?.participant);
}

function sideForParticipant(
  value: Participant,
  fixture: NormalizedFixture
): TeamSide {
  if (fixture.participant1IsHome) {
    return value === "Participant1" ? "HOME" : "AWAY";
  }
  return value === "Participant1" ? "AWAY" : "HOME";
}

function scoreContainer(record: UnknownRecord): UnknownRecord | undefined {
  return asRecord(
    record.scoreSoccer ?? record.ScoreSoccer ?? record.score ?? record.Score
  );
}

function participantGoals(
  score: UnknownRecord | undefined,
  side: Participant
): number | undefined {
  if (score === undefined) {
    return undefined;
  }
  const participantScore = asRecord(
    score[side] ?? score[side.toLowerCase()]
  );
  const total = asRecord(participantScore?.Total ?? participantScore?.total);
  const goals = readInteger(total?.Goals ?? total?.goals);
  return goals !== undefined && goals >= 0 ? goals : undefined;
}

function completeScore(participant1: number, participant2: number): UnknownRecord {
  return {
    Participant1: { Total: { Goals: participant1 } },
    Participant2: { Total: { Goals: participant2 } }
  };
}

function phaseForEvent(
  eventType: MatchEventType,
  second: number
): MatchPhase {
  if (eventType === "MATCH_FINAL") {
    return "FINISHED";
  }
  if (eventType === "HALF_TIME") {
    return second >= 90 * 60 ? "EXTRA_TIME_BREAK" : "HALF_TIME";
  }
  if (eventType === "EXTRA_TIME_START") {
    return "EXTRA_TIME_FIRST_HALF";
  }
  if (eventType === "PERIOD_START") {
    if (second >= 105 * 60) {
      return "EXTRA_TIME_SECOND_HALF";
    }
    if (second >= 90 * 60) {
      return "EXTRA_TIME_FIRST_HALF";
    }
    if (second >= 45 * 60) {
      return "SECOND_HALF";
    }
    return "FIRST_HALF";
  }
  if (second < 45 * 60) {
    return "FIRST_HALF";
  }
  if (second < 90 * 60) {
    return "SECOND_HALF";
  }
  if (second < 105 * 60) {
    return "EXTRA_TIME_FIRST_HALF";
  }
  if (second < 120 * 60) {
    return "EXTRA_TIME_SECOND_HALF";
  }
  return "FINISHED";
}

function eventMapping(item: DirectAction): RichEventMapping | undefined {
  const action = item.action;
  const data = asRecord(item.record.Data ?? item.record.data);
  const nestedAction = readStringLike(data?.Action ?? data?.action)?.toLowerCase();
  const outcome = readStringLike(data?.Outcome ?? data?.outcome)?.toLowerCase();

  if (["period_start", "second_half", "second_half_start"].includes(action)) {
    return {
      eventType: "PERIOD_START",
      importance: "KEY",
      label: action.startsWith("second_half") ? "Second half begins" : "Period begins"
    };
  }
  if (action === "extra_time_start") {
    return {
      eventType: "EXTRA_TIME_START",
      importance: "KEY",
      label: "Extra time begins"
    };
  }
  if (
    ["extra_time_second_half", "extra_time_second_half_start"].includes(action)
  ) {
    return {
      eventType: "PERIOD_START",
      importance: "KEY",
      label: "Second extra-time period begins"
    };
  }
  if (["halftime_finalised", "half_time", "halftime"].includes(action)) {
    return {
      eventType: "HALF_TIME",
      importance: "KEY",
      label: "Half-time"
    };
  }
  if (["var_start", "var"].includes(action)) {
    return {
      eventType: "VAR_REVIEW",
      importance: "KEY",
      label: "VAR review"
    };
  }
  if (action === "var_end") {
    return outcome === "overturned"
      ? {
          eventType: "VAR_OVERTURNED",
          importance: "KEY",
          label: "VAR: decision overturned"
        }
      : {
          eventType: "VAR_REVIEW",
          importance: "KEY",
          label: "VAR review completed"
        };
  }
  if (action === "goal_disallowed") {
    return {
      eventType: "GOAL_DISALLOWED",
      importance: "KEY",
      label: "Goal disallowed"
    };
  }
  if (action === "yellow_card") {
    return {
      eventType: "YELLOW_CARD",
      importance: "KEY",
      label: "Yellow card"
    };
  }
  if (action === "red_card") {
    return {
      eventType: "RED_CARD",
      importance: "KEY",
      label: "Red card"
    };
  }
  if (action === "corner") {
    return { eventType: "CORNER", importance: "FULL", label: "Corner" };
  }
  if (
    ["shot", "shot_on_target", "shot_off_target"].includes(action) ||
    nestedAction === "shot"
  ) {
    return { eventType: "SHOT", importance: "FULL", label: "Shot" };
  }
  if (action === "free_kick" || nestedAction === "free_kick") {
    return {
      eventType: "FREE_KICK",
      importance: "FULL",
      label: "Free kick"
    };
  }
  if (
    ["substitution", "substitution_in", "substitution_out"].includes(action) ||
    nestedAction === "substitution"
  ) {
    return {
      eventType: "SUBSTITUTION",
      importance: "FULL",
      label: "Substitution"
    };
  }
  if (action === "injury" || nestedAction === "injury") {
    return {
      eventType: "INJURY",
      importance: "FULL",
      label: "Injury stoppage"
    };
  }
  if (["penalty", "penalty_awarded"].includes(action)) {
    return { eventType: "PENALTY", importance: "KEY", label: "Penalty" };
  }
  if (action === "offside") {
    return { eventType: "OFFSIDE", importance: "FULL", label: "Offside" };
  }
  if (action === "throw_in") {
    return { eventType: "THROW_IN", importance: "FULL", label: "Throw-in" };
  }
  if (action === "goal_kick") {
    return { eventType: "GOAL_KICK", importance: "FULL", label: "Goal kick" };
  }
  if (["added_time", "injury_time"].includes(action)) {
    return {
      eventType: "ADDED_TIME",
      importance: "KEY",
      label: "Added time"
    };
  }
  return undefined;
}

function canonicalRecord(input: {
  fixture: NormalizedFixture;
  sequence: number;
  timestamp: number;
  action: string;
  clockSeconds: number;
  participant1Goals: number;
  participant2Goals: number;
  participant?: Participant;
  richEvent?: {
    eventType: MatchEventType;
    team?: TeamSide;
    label: string;
    importance: MatchEventImportance;
    phase: MatchPhase;
  };
}): UnknownRecord {
  return {
    FixtureId: input.fixture.fixtureId,
    MessageId: `matchshift-confirmed-score-${String(input.sequence).padStart(4, "0")}`,
    Seq: input.sequence,
    Ts: input.timestamp,
    Action: input.action,
    Confirmed: true,
    Clock: {
      Running: input.action !== "game_finalised",
      Seconds: input.clockSeconds
    },
    ...(input.participant === undefined
      ? {}
      : {
          Participant: input.participant === "Participant1" ? 1 : 2,
          DataSoccer: {
            Participant: input.participant,
            Minutes:
              input.clockSeconds === 0
                ? 0
                : Math.floor(input.clockSeconds / 60) + 1
          }
        }),
    ScoreSoccer: completeScore(
      input.participant1Goals,
      input.participant2Goals
    ),
    MatchShiftDerived: {
      scoreLifecycle: "CONFIRMED_ACTIONS_WITH_MATCH_CLOCK",
      providerIdentifiersRemoved: true,
      ...(input.richEvent === undefined
        ? {}
        : {
            RichEvent: {
              eventType: input.richEvent.eventType,
              ...(input.richEvent.team === undefined
                ? {}
                : { team: input.richEvent.team }),
              matchSecond: input.clockSeconds,
              label: input.richEvent.label,
              importance: input.richEvent.importance,
              phase: input.richEvent.phase
            }
          })
    }
  };
}

function completedFixtureActions(
  records: readonly unknown[],
  fixture: NormalizedFixture
): DirectAction[] {
  return records
    .map(directAction)
    .filter((value): value is DirectAction => value !== undefined)
    .filter((value) => value.fixtureId === String(fixture.fixtureId))
    .sort(orderActions);
}

function confirmedOpeningKickoff(
  actions: readonly DirectAction[]
): DirectAction | undefined {
  return actions.find(
    (item) =>
      item.action === "kickoff" &&
      item.record.Confirmed === true &&
      clockSeconds(item.record) === 0
  );
}

function finalAction(actions: readonly DirectAction[]): DirectAction | undefined {
  return [...actions].reverse().find((item) => item.action === "game_finalised");
}

export function hasConfirmedCompletedScoreLifecycle(
  records: readonly unknown[],
  fixture: NormalizedFixture
): boolean {
  const actions = completedFixtureActions(records, fixture);
  return confirmedOpeningKickoff(actions) !== undefined && finalAction(actions) !== undefined;
}

function discardedActions(
  actions: readonly DirectAction[],
  kickoff: DirectAction,
  final: DirectAction
): Map<string, DirectAction> {
  const discarded = new Map<string, DirectAction>();
  for (const item of actions) {
    if (
      item.sequence < kickoff.sequence ||
      item.sequence > final.sequence ||
      item.action !== "action_discarded"
    ) {
      continue;
    }
    const identity = item.referencedActionId ?? item.actionId;
    if (identity !== undefined) {
      discarded.set(identity, item);
    }
  }
  return discarded;
}

function goalLifecycles(
  actions: readonly DirectAction[],
  kickoff: DirectAction,
  final: DirectAction,
  fixture: NormalizedFixture,
  discarded: ReadonlyMap<string, DirectAction>
): GoalLifecycleResult {
  const goalGroups = new Map<string, DirectAction[]>();

  for (const item of actions) {
    if (item.sequence < kickoff.sequence || item.sequence > final.sequence) {
      continue;
    }
    if (item.action !== "goal") {
      continue;
    }
    if (item.actionId === undefined) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_GOAL_ID_MISSING",
        "A TxLINE goal action had no stable lifecycle identifier."
      );
    }
    const group = goalGroups.get(item.actionId) ?? [];
    group.push(item);
    goalGroups.set(item.actionId, group);
  }

  const confirmed: ConfirmedGoal[] = [];
  const disallowed: RichLifecycleEvent[] = [];
  for (const [actionId, group] of goalGroups) {
    group.sort(orderActions);
    const discardedBy = discarded.get(actionId);
    if (discardedBy !== undefined) {
      const representative = [...group]
        .reverse()
        .find(
          (item) =>
            participant(item.record) !== undefined &&
            clockSeconds(item.record) !== undefined
        );
      if (representative !== undefined) {
        const goalParticipant = participant(representative.record)!;
        const second = clockSeconds(representative.record)!;
        disallowed.push({
          eventType: "GOAL_DISALLOWED",
          importance: "KEY",
          label: "Goal disallowed",
          clockSeconds: second,
          sequence: discardedBy.sequence,
          phase: phaseForEvent("GOAL_DISALLOWED", second),
          team: sideForParticipant(goalParticipant, fixture)
        });
      }
      continue;
    }

    const confirmedVersions = group.filter(
      (item) => item.record.Confirmed === true
    );
    if (confirmedVersions.length === 0) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_GOAL_UNRESOLVED",
        "A non-discarded TxLINE goal lifecycle never reached confirmed state."
      );
    }
    confirmedVersions.sort(orderActions);
    const first = confirmedVersions[0]!;
    const expectedParticipant = participant(first.record);
    const expectedClock = clockSeconds(first.record);
    if (expectedParticipant === undefined || expectedClock === undefined) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_GOAL_MALFORMED",
        "A confirmed TxLINE goal lacked a valid top-level participant or match clock."
      );
    }
    for (const version of confirmedVersions) {
      if (
        participant(version.record) !== expectedParticipant ||
        clockSeconds(version.record) !== expectedClock
      ) {
        throw new TxlineHttpError(
          "SCORE_LIFECYCLE_GOAL_INCONSISTENT",
          "Confirmed versions of one TxLINE goal disagreed on participant or match clock."
        );
      }
    }
    confirmed.push({
      participant: expectedParticipant,
      clockSeconds: expectedClock,
      sequence: first.sequence,
      record: confirmedVersions.at(-1)!.record
    });
  }

  confirmed.sort((left, right) => left.sequence - right.sequence);
  disallowed.sort(
    (left, right) =>
      left.clockSeconds - right.clockSeconds || left.sequence - right.sequence
  );
  return { confirmed, disallowed };
}

function meaningfulLifecycleEvents(
  actions: readonly DirectAction[],
  kickoff: DirectAction,
  final: DirectAction,
  fixture: NormalizedFixture,
  discarded: ReadonlyMap<string, DirectAction>
): RichLifecycleEvent[] {
  const latest = new Map<string, RichLifecycleEvent>();

  for (const item of actions) {
    if (item.sequence < kickoff.sequence || item.sequence > final.sequence) {
      continue;
    }
    if (
      [
        "kickoff",
        "goal",
        "game_finalised",
        "action_discarded",
        "action_amend",
        "match_clock",
        "clock"
      ].includes(item.action)
    ) {
      continue;
    }
    if (item.actionId !== undefined && discarded.has(item.actionId)) {
      continue;
    }
    if (item.record.Confirmed === false) {
      continue;
    }

    const mapping = eventMapping(item);
    const second = clockSeconds(item.record);
    if (mapping === undefined || second === undefined) {
      continue;
    }
    const eventParticipant = participant(item.record);
    const team =
      eventParticipant === undefined
        ? undefined
        : sideForParticipant(eventParticipant, fixture);
    const candidate: RichLifecycleEvent = {
      ...mapping,
      clockSeconds: second,
      sequence: item.sequence,
      phase: phaseForEvent(mapping.eventType, second),
      ...(team === undefined ? {} : { team })
    };
    const key =
      item.actionId === undefined
        ? [mapping.eventType, team ?? "NONE", second, mapping.label].join(":")
        : `${mapping.eventType}:${item.actionId}`;
    latest.set(key, candidate);
  }

  return [...latest.values()].sort(
    (left, right) =>
      left.clockSeconds - right.clockSeconds ||
      left.sequence - right.sequence ||
      left.eventType.localeCompare(right.eventType)
  );
}

export function recoverConfirmedCompletedScoreLifecycle(
  records: readonly unknown[],
  fixture: NormalizedFixture
): unknown[] {
  const actions = completedFixtureActions(records, fixture);
  const kickoff = confirmedOpeningKickoff(actions);
  const final = finalAction(actions);
  if (kickoff === undefined || final === undefined || final.sequence <= kickoff.sequence) {
    throw new TxlineHttpError(
      "SCORE_LIFECYCLE_ANCHOR_MISSING",
      "Completed TxLINE score history lacked a confirmed opening kickoff or final action."
    );
  }

  const discarded = discardedActions(actions, kickoff, final);
  const goals = goalLifecycles(actions, kickoff, final, fixture, discarded);
  let participant1Goals = 0;
  let participant2Goals = 0;
  let previousClock = 0;

  for (const goal of goals.confirmed) {
    if (goal.clockSeconds < previousClock) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_CLOCK_NON_MONOTONIC",
        "Confirmed TxLINE goal clocks were not monotonic."
      );
    }
    previousClock = goal.clockSeconds;
    if (goal.participant === "Participant1") {
      participant1Goals += 1;
    } else {
      participant2Goals += 1;
    }

    const providerScore = scoreContainer(goal.record);
    const providerParticipant1 = participantGoals(providerScore, "Participant1");
    const providerParticipant2 = participantGoals(providerScore, "Participant2");
    const scoringParticipantTotal =
      goal.participant === "Participant1"
        ? providerParticipant1
        : providerParticipant2;
    if (
      scoringParticipantTotal === undefined ||
      scoringParticipantTotal !==
        (goal.participant === "Participant1"
          ? participant1Goals
          : participant2Goals) ||
      (providerParticipant1 !== undefined &&
        providerParticipant1 !== participant1Goals) ||
      (providerParticipant2 !== undefined &&
        providerParticipant2 !== participant2Goals)
    ) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_GOAL_SCORE_MISMATCH",
        "A confirmed TxLINE goal did not agree with the accumulated sparse score."
      );
    }
  }

  const finalScore = scoreContainer(final.record);
  if (finalScore === undefined) {
    throw new TxlineHttpError(
      "SCORE_LIFECYCLE_FINAL_SCORE_MISSING",
      "TxLINE game_finalised had no score object."
    );
  }
  const finalParticipant1 = participantGoals(finalScore, "Participant1") ?? 0;
  const finalParticipant2 = participantGoals(finalScore, "Participant2") ?? 0;
  if (
    finalParticipant1 !== participant1Goals ||
    finalParticipant2 !== participant2Goals
  ) {
    throw new TxlineHttpError(
      "SCORE_LIFECYCLE_FINAL_SCORE_MISMATCH",
      "Confirmed goal lifecycles did not equal the TxLINE game_finalised score."
    );
  }

  const finalClock = actions
    .filter(
      (item) =>
        item.sequence >= kickoff.sequence && item.sequence <= final.sequence
    )
    .reduce(
      (maximum, item) => Math.max(maximum, clockSeconds(item.record) ?? 0),
      previousClock
    );
  if (finalClock < previousClock) {
    throw new TxlineHttpError(
      "SCORE_LIFECYCLE_FINAL_CLOCK_INVALID",
      "TxLINE final match clock preceded a confirmed goal."
    );
  }

  const timeline: RichLifecycleEvent[] = [
    ...goals.confirmed.map(
      (goal): RichLifecycleEvent => {
        const team = sideForParticipant(goal.participant, fixture);
        return {
          eventType: "GOAL",
          importance: "KEY",
          label: "Goal",
          clockSeconds: goal.clockSeconds,
          sequence: goal.sequence,
          phase: phaseForEvent("GOAL", goal.clockSeconds),
          team,
          goal
        };
      }
    ),
    ...goals.disallowed,
    ...meaningfulLifecycleEvents(actions, kickoff, final, fixture, discarded),
    {
      eventType: "MATCH_FINAL",
      importance: "KEY",
      label: "Match finalised",
      clockSeconds: finalClock,
      sequence: final.sequence,
      phase: "FINISHED"
    }
  ];
  timeline.sort(
    (left, right) =>
      left.clockSeconds - right.clockSeconds ||
      left.sequence - right.sequence ||
      left.eventType.localeCompare(right.eventType)
  );

  participant1Goals = 0;
  participant2Goals = 0;
  let localSequence = 1;
  const canonical: unknown[] = [
    canonicalRecord({
      fixture,
      sequence: localSequence,
      timestamp: fixture.startTimestamp,
      action: "matchshift_baseline",
      clockSeconds: 0,
      participant1Goals,
      participant2Goals
    })
  ];

  localSequence += 1;
  canonical.push(
    canonicalRecord({
      fixture,
      sequence: localSequence,
      timestamp: fixture.startTimestamp,
      action: "matchshift_event",
      clockSeconds: 0,
      participant1Goals,
      participant2Goals,
      richEvent: {
        eventType: "KICKOFF",
        label: "Kickoff",
        importance: "KEY",
        phase: "FIRST_HALF"
      }
    })
  );

  for (const event of timeline) {
    if (event.goal !== undefined) {
      if (event.goal.participant === "Participant1") {
        participant1Goals += 1;
      } else {
        participant2Goals += 1;
      }
    }
    localSequence += 1;
    canonical.push(
      canonicalRecord({
        fixture,
        sequence: localSequence,
        timestamp: fixture.startTimestamp + event.clockSeconds * 1_000,
        action: event.goal === undefined ? "matchshift_event" : "goal",
        clockSeconds: event.clockSeconds,
        participant1Goals,
        participant2Goals,
        ...(event.goal === undefined
          ? {}
          : { participant: event.goal.participant }),
        richEvent: {
          eventType: event.eventType,
          ...(event.team === undefined ? {} : { team: event.team }),
          label: event.label,
          importance: event.importance,
          phase: event.phase
        }
      })
    );
  }

  localSequence += 1;
  canonical.push(
    canonicalRecord({
      fixture,
      sequence: localSequence,
      timestamp: fixture.startTimestamp + finalClock * 1_000,
      action: "game_finalised",
      clockSeconds: finalClock,
      participant1Goals,
      participant2Goals
    })
  );
  return canonical;
}
