import { TxlineHttpError } from "./http-client.js";
import {
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

type UnknownRecord = Record<string, unknown>;

const KICKOFF_ACTIONS = new Set([
  "kickoff",
  "match_started",
  "matchstarted",
  "game_started"
]);
const MAX_KICKOFF_OFFSET_MS = 15 * 60_000;

export interface SparseScoreHydrationResult {
  records: unknown[];
  kickoffObserved: boolean;
  hydratedRecords: number;
  scoreChanges: number;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

function directOrder(left: unknown, right: unknown): number {
  const leftRecord = asRecord(left) ?? {};
  const rightRecord = asRecord(right) ?? {};
  const leftSequence =
    readInteger(leftRecord.seq ?? leftRecord.Seq) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence =
    readInteger(rightRecord.seq ?? rightRecord.Seq) ?? Number.MAX_SAFE_INTEGER;
  const leftTimestamp =
    parseSourceTimestamp(leftRecord.ts ?? leftRecord.Ts) ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp =
    parseSourceTimestamp(rightRecord.ts ?? rightRecord.Ts) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence || leftTimestamp - rightTimestamp;
}

function scoreContainer(record: UnknownRecord): UnknownRecord | undefined {
  return asRecord(
    record.scoreSoccer ?? record.ScoreSoccer ?? record.score ?? record.Score
  );
}

function participantGoals(
  score: UnknownRecord | undefined,
  participant: "Participant1" | "Participant2"
): number | undefined {
  if (score === undefined) {
    return undefined;
  }
  const participantRecord = asRecord(
    score[participant] ?? score[participant.toLowerCase()]
  );
  const total = asRecord(participantRecord?.Total ?? participantRecord?.total);
  const goals = readInteger(total?.Goals ?? total?.goals);
  return goals !== undefined && goals >= 0 ? goals : undefined;
}

function withGoals(
  score: UnknownRecord | undefined,
  participant: "Participant1" | "Participant2",
  goals: number
): UnknownRecord {
  const participantRecord = asRecord(
    score?.[participant] ?? score?.[participant.toLowerCase()]
  ) ?? {};
  const total = asRecord(participantRecord.Total ?? participantRecord.total) ?? {};
  return {
    ...participantRecord,
    Total: {
      ...total,
      Goals: goals
    }
  };
}

function hydratedScore(
  score: UnknownRecord | undefined,
  participant1Goals: number,
  participant2Goals: number
): UnknownRecord {
  return {
    ...(score ?? {}),
    Participant1: withGoals(score, "Participant1", participant1Goals),
    Participant2: withGoals(score, "Participant2", participant2Goals)
  };
}

function isTrustedKickoff(
  value: unknown,
  fixture: NormalizedFixture
): boolean {
  const record = asRecord(value);
  if (record === undefined) {
    return false;
  }
  const fixtureId = readStringLike(record.fixtureId ?? record.FixtureId);
  if (fixtureId !== String(fixture.fixtureId)) {
    return false;
  }
  const action = readStringLike(record.action ?? record.Action)?.toLowerCase();
  if (action === undefined || !KICKOFF_ACTIONS.has(action)) {
    return false;
  }
  const sequence = readInteger(record.seq ?? record.Seq);
  const timestamp = parseSourceTimestamp(record.ts ?? record.Ts);
  return (
    sequence !== undefined &&
    sequence > 0 &&
    timestamp !== undefined &&
    Math.abs(timestamp - fixture.startTimestamp) <= MAX_KICKOFF_OFFSET_MS
  );
}

function validateNextGoals(
  participant: "Participant1" | "Participant2",
  current: number,
  next: number
): void {
  if (next < current) {
    throw new TxlineHttpError(
      "SCORE_SPARSE_HYDRATION_NON_MONOTONIC",
      `${participant} sparse score decreased from ${current} to ${next}.`
    );
  }
  if (next - current > 1) {
    throw new TxlineHttpError(
      "SCORE_SPARSE_HYDRATION_GAP",
      `${participant} sparse score jumped from ${current} to ${next}.`
    );
  }
}

export function hydrateSparseScoreHistory(
  records: readonly unknown[],
  fixture: NormalizedFixture
): SparseScoreHydrationResult {
  const ordered = [...records].sort(directOrder);
  const kickoffIndex = ordered.findIndex((record) =>
    isTrustedKickoff(record, fixture)
  );
  if (kickoffIndex < 0) {
    throw new TxlineHttpError(
      "SCORE_SPARSE_HYDRATION_NO_KICKOFF",
      "Sparse score history had no trusted kickoff anchor."
    );
  }

  let participant1Goals = 0;
  let participant2Goals = 0;
  let hydratedRecords = 0;
  let scoreChanges = 0;

  const hydrated = ordered.map((value, index) => {
    if (index < kickoffIndex) {
      return value;
    }
    const record = asRecord(value);
    if (record === undefined) {
      return value;
    }
    const score = scoreContainer(record);
    const nextParticipant1 = participantGoals(score, "Participant1");
    const nextParticipant2 = participantGoals(score, "Participant2");

    if (
      index === kickoffIndex &&
      ((nextParticipant1 ?? 0) !== 0 || (nextParticipant2 ?? 0) !== 0)
    ) {
      throw new TxlineHttpError(
        "SCORE_SPARSE_HYDRATION_KICKOFF_NONZERO",
        "Trusted kickoff sparse score was not 0-0."
      );
    }

    const previousParticipant1 = participant1Goals;
    const previousParticipant2 = participant2Goals;
    if (nextParticipant1 !== undefined) {
      validateNextGoals("Participant1", participant1Goals, nextParticipant1);
      participant1Goals = nextParticipant1;
    }
    if (nextParticipant2 !== undefined) {
      validateNextGoals("Participant2", participant2Goals, nextParticipant2);
      participant2Goals = nextParticipant2;
    }
    if (
      participant1Goals !== previousParticipant1 ||
      participant2Goals !== previousParticipant2
    ) {
      scoreChanges += 1;
    }
    if (nextParticipant1 === undefined || nextParticipant2 === undefined) {
      hydratedRecords += 1;
    }

    const existingDerived = asRecord(record.MatchShiftDerived) ?? {};
    return {
      ...record,
      scoreSoccer: hydratedScore(
        score,
        participant1Goals,
        participant2Goals
      ),
      MatchShiftDerived: {
        ...existingDerived,
        scoreHydration: "KICKOFF_ANCHORED_SPARSE_CARRY_FORWARD"
      }
    };
  });

  return {
    records: hydrated,
    kickoffObserved: true,
    hydratedRecords,
    scoreChanges
  };
}
