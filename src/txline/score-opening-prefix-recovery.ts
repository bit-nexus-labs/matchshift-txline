import type { MatchEventRecord } from "../core/types.js";
import { TxlineHttpError } from "./http-client.js";
import {
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

const MAX_DERIVED_OPENING_GOALS = 20;

type UnknownRecord = Record<string, unknown>;

type Side = "HOME" | "AWAY";

interface OpeningGoal {
  side: Side;
  minute: number;
  sourceTimestamp: number;
}

interface TrustedOpeningSnapshot {
  index: number;
  home: number;
  away: number;
  sourceSequence: number;
  baselineIsGoal: boolean;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readInteger(record: UnknownRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function directTimestamp(value: unknown): number | undefined {
  const record = asRecord(value);
  return record === undefined
    ? undefined
    : parseSourceTimestamp(record.ts ?? record.Ts);
}

function directOrder(left: unknown, right: unknown): number {
  const leftRecord = asRecord(left) ?? {};
  const rightRecord = asRecord(right) ?? {};
  const leftSequence =
    readInteger(leftRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence =
    readInteger(rightRecord, ["seq", "Seq"]) ?? Number.MAX_SAFE_INTEGER;
  const leftTimestamp = directTimestamp(left) ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = directTimestamp(right) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

function isGoalEvent(record: MatchEventRecord): boolean {
  return record.eventType === "GOAL";
}

function trustedOpeningSnapshot(
  ordered: readonly unknown[],
  fixture: NormalizedFixture
): TrustedOpeningSnapshot | undefined {
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index]!;
    const snapshot = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp,
      snapshot: true
    });
    const recovery = snapshot.records.find((record) => record.kind === "recovery");
    if (recovery === undefined) {
      continue;
    }
    const sourceSequence = recovery.sourceOrder?.sourceSequence;
    if (sourceSequence === undefined) {
      throw new TxlineHttpError(
        "SCORE_OPENING_PREFIX_INCOMPLETE",
        "The first trusted score snapshot had no usable provider sequence."
      );
    }
    const event = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp
    });
    return {
      index,
      home: recovery.snapshot.score.home,
      away: recovery.snapshot.score.away,
      sourceSequence,
      baselineIsGoal: event.records.some(
        (record) => record.kind === "event" && isGoalEvent(record)
      )
    };
  }
  return undefined;
}

function openingGoals(
  ordered: readonly unknown[],
  throughIndex: number,
  fixture: NormalizedFixture
): OpeningGoal[] {
  const goals: OpeningGoal[] = [];
  for (let index = 0; index <= throughIndex; index += 1) {
    const item = ordered[index]!;
    const normalized = normalizeScorePayload(item, {
      fixture,
      receivedTimestamp: fixture.startTimestamp
    });
    const goal = normalized.records.find(
      (record): record is MatchEventRecord =>
        record.kind === "event" && isGoalEvent(record)
    );
    if (goal === undefined || goal.team === undefined) {
      continue;
    }
    goals.push({
      side: goal.team,
      minute: goal.minute,
      sourceTimestamp: Math.max(fixture.startTimestamp, goal.sourceTimestamp)
    });
  }
  return goals;
}

function participantForSide(
  side: Side,
  fixture: NormalizedFixture
): "Participant1" | "Participant2" {
  if (fixture.participant1IsHome) {
    return side === "HOME" ? "Participant1" : "Participant2";
  }
  return side === "HOME" ? "Participant2" : "Participant1";
}

function scoreSoccerFromHomeAway(
  home: number,
  away: number,
  fixture: NormalizedFixture
): UnknownRecord {
  const participant1 = fixture.participant1IsHome ? home : away;
  const participant2 = fixture.participant1IsHome ? away : home;
  return {
    Participant1: { Total: { Goals: participant1 } },
    Participant2: { Total: { Goals: participant2 } }
  };
}

function derivedBaselineRecord(
  fixture: NormalizedFixture,
  sequence: number
): UnknownRecord {
  return {
    FixtureId: fixture.fixtureId,
    MessageId: `curated-derived-opening-baseline-${fixture.startTimestamp}`,
    Seq: sequence,
    Ts: fixture.startTimestamp,
    Action: "curated_derived_opening_baseline",
    ScoreSoccer: scoreSoccerFromHomeAway(0, 0, fixture)
  };
}

function derivedGoalRecord(input: {
  fixture: NormalizedFixture;
  goal: OpeningGoal;
  sequence: number;
  index: number;
  home: number;
  away: number;
}): UnknownRecord {
  return {
    FixtureId: input.fixture.fixtureId,
    MessageId: `curated-derived-opening-goal-${String(input.index).padStart(2, "0")}`,
    Seq: input.sequence,
    Ts: input.goal.sourceTimestamp,
    Action: "goal",
    DataSoccer: {
      Participant: participantForSide(input.goal.side, input.fixture),
      Minutes: input.goal.minute
    },
    ScoreSoccer: scoreSoccerFromHomeAway(input.home, input.away, input.fixture)
  };
}

export function recoverOpeningScorePrefixFromGoalActions(
  records: readonly unknown[],
  fixture: NormalizedFixture
): unknown[] {
  const ordered = [...records].sort(directOrder);
  const opening = trustedOpeningSnapshot(ordered, fixture);
  if (opening === undefined) {
    throw new TxlineHttpError(
      "SCORE_OPENING_PREFIX_INCOMPLETE",
      "TxLINE score records contained no trusted opening snapshot to validate goal actions against."
    );
  }
  if (opening.home === 0 && opening.away === 0) {
    return ordered;
  }

  const expectedGoals = opening.home + opening.away;
  if (expectedGoals <= 0 || expectedGoals > MAX_DERIVED_OPENING_GOALS) {
    throw new TxlineHttpError(
      "SCORE_OPENING_PREFIX_INCOMPLETE",
      `The first trusted score ${opening.home}-${opening.away} exceeded the bounded opening-goal recovery policy.`
    );
  }

  const goals = openingGoals(ordered, opening.index, fixture);
  const recoveredHome = goals.filter((goal) => goal.side === "HOME").length;
  const recoveredAway = goals.filter((goal) => goal.side === "AWAY").length;
  if (
    goals.length !== expectedGoals ||
    recoveredHome !== opening.home ||
    recoveredAway !== opening.away
  ) {
    throw new TxlineHttpError(
      "SCORE_OPENING_PREFIX_INCOMPLETE",
      `TxLINE opening goal actions reconstructed ${recoveredHome}-${recoveredAway} from ${goals.length} goals, but the first trusted score was ${opening.home}-${opening.away}.`
    );
  }

  for (let index = 1; index < goals.length; index += 1) {
    if (goals[index]!.sourceTimestamp < goals[index - 1]!.sourceTimestamp) {
      throw new TxlineHttpError(
        "SCORE_OPENING_PREFIX_INCOMPLETE",
        "TxLINE opening goal timestamps were not monotonic."
      );
    }
  }

  const derivedRecordCount = goals.length + 1;
  const suffixStartsAfterOpening = opening.baselineIsGoal;
  const baselineSequence = suffixStartsAfterOpening
    ? opening.sourceSequence - goals.length
    : opening.sourceSequence - derivedRecordCount;
  if (baselineSequence <= 0) {
    throw new TxlineHttpError(
      "SCORE_OPENING_PREFIX_INCOMPLETE",
      "The provider sequence did not leave enough ordered space for a validated opening prefix."
    );
  }

  const derived: unknown[] = [derivedBaselineRecord(fixture, baselineSequence)];
  let home = 0;
  let away = 0;
  for (let index = 0; index < goals.length; index += 1) {
    const goal = goals[index]!;
    if (goal.side === "HOME") {
      home += 1;
    } else {
      away += 1;
    }
    derived.push(
      derivedGoalRecord({
        fixture,
        goal,
        sequence: baselineSequence + index + 1,
        index: index + 1,
        home,
        away
      })
    );
  }

  const suffixIndex = suffixStartsAfterOpening ? opening.index + 1 : opening.index;
  return [...derived, ...ordered.slice(suffixIndex)].sort(directOrder);
}
