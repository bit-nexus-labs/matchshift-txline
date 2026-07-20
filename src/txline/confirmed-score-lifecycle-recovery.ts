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
}

interface ConfirmedGoal {
  participant: Participant;
  clockSeconds: number;
  sequence: number;
  record: UnknownRecord;
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
  return {
    record,
    fixtureId,
    sequence,
    timestamp,
    action,
    ...(actionId === undefined ? {} : { actionId })
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

function participant(record: UnknownRecord): Participant | undefined {
  const value = readStringLike(record.Participant ?? record.participant)
    ?.trim()
    .toLowerCase();
  if (value === "1" || value === "participant1") {
    return "Participant1";
  }
  if (value === "2" || value === "participant2") {
    return "Participant2";
  }
  return undefined;
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

function canonicalRecord(input: {
  fixture: NormalizedFixture;
  sequence: number;
  timestamp: number;
  action: "kickoff" | "goal" | "game_finalised";
  clockSeconds: number;
  participant1Goals: number;
  participant2Goals: number;
  participant?: Participant;
  minute?: number;
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
            Minutes: input.minute
          }
        }),
    ScoreSoccer: completeScore(
      input.participant1Goals,
      input.participant2Goals
    ),
    MatchShiftDerived: {
      scoreLifecycle: "CONFIRMED_ACTIONS_WITH_MATCH_CLOCK",
      providerIdentifiersRemoved: true
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

function confirmedGoals(
  actions: readonly DirectAction[],
  kickoff: DirectAction,
  final: DirectAction
): ConfirmedGoal[] {
  const goalGroups = new Map<string, DirectAction[]>();
  const discarded = new Set<string>();

  for (const item of actions) {
    if (item.sequence < kickoff.sequence || item.sequence > final.sequence) {
      continue;
    }
    if (item.action === "action_discarded" && item.actionId !== undefined) {
      discarded.add(item.actionId);
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

  const goals: ConfirmedGoal[] = [];
  for (const [actionId, group] of goalGroups) {
    if (discarded.has(actionId)) {
      continue;
    }
    const confirmed = group.filter((item) => item.record.Confirmed === true);
    if (confirmed.length === 0) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_GOAL_UNRESOLVED",
        "A non-discarded TxLINE goal lifecycle never reached confirmed state."
      );
    }
    confirmed.sort(orderActions);
    const first = confirmed[0]!;
    const expectedParticipant = participant(first.record);
    const expectedClock = clockSeconds(first.record);
    if (expectedParticipant === undefined || expectedClock === undefined) {
      throw new TxlineHttpError(
        "SCORE_LIFECYCLE_GOAL_MALFORMED",
        "A confirmed TxLINE goal lacked a valid top-level participant or match clock."
      );
    }
    for (const version of confirmed) {
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
    goals.push({
      participant: expectedParticipant,
      clockSeconds: expectedClock,
      sequence: first.sequence,
      record: confirmed.at(-1)!.record
    });
  }

  goals.sort((left, right) => left.sequence - right.sequence);
  return goals;
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

  const goals = confirmedGoals(actions, kickoff, final);
  let participant1Goals = 0;
  let participant2Goals = 0;
  let previousClock = 0;
  const canonical: unknown[] = [
    canonicalRecord({
      fixture,
      sequence: 1,
      timestamp: fixture.startTimestamp,
      action: "kickoff",
      clockSeconds: 0,
      participant1Goals,
      participant2Goals
    })
  ];

  for (let index = 0; index < goals.length; index += 1) {
    const goal = goals[index]!;
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

    canonical.push(
      canonicalRecord({
        fixture,
        sequence: index + 2,
        timestamp: fixture.startTimestamp + goal.clockSeconds * 1_000,
        action: "goal",
        clockSeconds: goal.clockSeconds,
        participant1Goals,
        participant2Goals,
        participant: goal.participant,
        minute: Math.floor(goal.clockSeconds / 60) + 1
      })
    );
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

  canonical.push(
    canonicalRecord({
      fixture,
      sequence: goals.length + 2,
      timestamp: fixture.startTimestamp + finalClock * 1_000,
      action: "game_finalised",
      clockSeconds: finalClock,
      participant1Goals,
      participant2Goals
    })
  );
  return canonical;
}
