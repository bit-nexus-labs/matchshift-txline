import {
  normalizeScorePayload,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";

type UnknownRecord = Record<string, unknown>;

export const OPENING_SNAPSHOT_OFFSETS_MS = [
  0,
  1_000,
  5_000,
  15_000,
  30_000,
  60_000,
  120_000
] as const;

export interface BoundedEnumCount {
  value: string;
  count: number;
}

export interface GoalTransitionEvidence {
  offsetSeconds?: number;
  team: "HOME" | "AWAY" | "UNKNOWN";
  minute?: number;
  participant1Goals?: number;
  participant2Goals?: number;
  rootKickoff: boolean;
}

export interface OpeningScoreAnchorDiagnostics {
  records: number;
  fixtureScopedRecords: number;
  earliestOffsetSeconds?: number;
  startTimeMatches: number;
  rootKickoffObjects: number;
  clockRecords: number;
  nearZeroClockRecords: number;
  runningClockRecords: number;
  participant1GoalRecords: number;
  participant2GoalRecords: number;
  goalActionRecords: number;
  normalizedGoalEvents: number;
  homeGoalEvents: number;
  awayGoalEvents: number;
  unknownGoalEvents: number;
  firstGoalOffsetSeconds?: number;
  maxParticipant1Goals?: number;
  maxParticipant2Goals?: number;
  goalTransitions: GoalTransitionEvidence[];
  topLevelActions: BoundedEnumCount[];
  nestedSoccerActions: BoundedEnumCount[];
  gameStates: BoundedEnumCount[];
}

const MAX_ENUM_VALUES = 16;
const MAX_GOAL_TRANSITIONS = 12;
const SAFE_ENUM_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
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

function readInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}

function safeEnumValue(value: unknown): string | undefined {
  const stringValue = readStringLike(value);
  if (stringValue === undefined) {
    return undefined;
  }
  return SAFE_ENUM_PATTERN.test(stringValue)
    ? stringValue.toLowerCase()
    : "<non-enum>";
}

function increment(map: Map<string, number>, value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  map.set(value, (map.get(value) ?? 0) + 1);
}

function boundedCounts(map: ReadonlyMap<string, number>): BoundedEnumCount[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_ENUM_VALUES)
    .map(([value, count]) => ({ value, count }));
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
  const participantRecord = asRecord(
    score?.[participant] ?? score?.[participant.toLowerCase()]
  );
  const total = asRecord(participantRecord?.Total ?? participantRecord?.total);
  const goals = readInteger(total?.Goals ?? total?.goals);
  return goals !== undefined && goals >= 0 ? goals : undefined;
}

function nestedSoccerData(record: UnknownRecord): UnknownRecord | undefined {
  return asRecord(
    record.dataSoccer ?? record.DataSoccer ?? record.data ?? record.Data
  );
}

function clockContainer(record: UnknownRecord): UnknownRecord | undefined {
  const direct = asRecord(record.clock ?? record.Clock);
  if (direct !== undefined) {
    return direct;
  }
  const data = nestedSoccerData(record);
  const dataClock = asRecord(data?.Clock ?? data?.clock);
  if (dataClock !== undefined) {
    return dataClock;
  }
  const next = asRecord(data?.New ?? data?.new);
  return asRecord(next?.Clock ?? next?.clock);
}

function isGoalAction(action: string | undefined): boolean {
  return action === "goal" || action?.endsWith("_goal") === true;
}

export function diagnoseOpeningScoreAnchors(
  records: readonly unknown[],
  fixture: NormalizedFixture
): OpeningScoreAnchorDiagnostics {
  const topLevelActions = new Map<string, number>();
  const nestedSoccerActions = new Map<string, number>();
  const gameStates = new Map<string, number>();

  let fixtureScopedRecords = 0;
  let earliestOffsetSeconds: number | undefined;
  let startTimeMatches = 0;
  let rootKickoffObjects = 0;
  let clockRecords = 0;
  let nearZeroClockRecords = 0;
  let runningClockRecords = 0;
  let participant1GoalRecords = 0;
  let participant2GoalRecords = 0;
  let goalActionRecords = 0;
  let normalizedGoalEvents = 0;
  let homeGoalEvents = 0;
  let awayGoalEvents = 0;
  let unknownGoalEvents = 0;
  let firstGoalOffsetSeconds: number | undefined;
  let maxParticipant1Goals: number | undefined;
  let maxParticipant2Goals: number | undefined;
  const goalTransitions: GoalTransitionEvidence[] = [];

  for (const value of records) {
    const record = asRecord(value);
    if (record === undefined) {
      continue;
    }

    const fixtureId = readStringLike(record.fixtureId ?? record.FixtureId);
    if (fixtureId !== String(fixture.fixtureId)) {
      continue;
    }
    fixtureScopedRecords += 1;

    const action = safeEnumValue(record.action ?? record.Action);
    increment(topLevelActions, action);
    increment(
      gameStates,
      safeEnumValue(record.gameState ?? record.GameState)
    );

    const data = nestedSoccerData(record);
    increment(
      nestedSoccerActions,
      safeEnumValue(data?.Action ?? data?.action)
    );

    const timestamp = parseSourceTimestamp(record.ts ?? record.Ts);
    const offsetSeconds =
      timestamp === undefined
        ? undefined
        : Math.round((timestamp - fixture.startTimestamp) / 1_000);
    if (
      offsetSeconds !== undefined &&
      (earliestOffsetSeconds === undefined || offsetSeconds < earliestOffsetSeconds)
    ) {
      earliestOffsetSeconds = offsetSeconds;
    }

    const recordStart = parseSourceTimestamp(record.startTime ?? record.StartTime);
    if (recordStart === fixture.startTimestamp) {
      startTimeMatches += 1;
    }

    const rootKickoff = asRecord(record.kickoff ?? record.Kickoff) !== undefined;
    if (rootKickoff) {
      rootKickoffObjects += 1;
    }

    const clock = clockContainer(record);
    if (clock !== undefined) {
      clockRecords += 1;
      const seconds = readInteger(clock.seconds ?? clock.Seconds);
      if (seconds !== undefined && seconds >= 0 && seconds <= 120) {
        nearZeroClockRecords += 1;
      }
      if ((clock.running ?? clock.Running) === true) {
        runningClockRecords += 1;
      }
    }

    const score = scoreContainer(record);
    const participant1 = participantGoals(score, "Participant1");
    const participant2 = participantGoals(score, "Participant2");
    if (participant1 !== undefined) {
      participant1GoalRecords += 1;
      maxParticipant1Goals = Math.max(maxParticipant1Goals ?? 0, participant1);
    }
    if (participant2 !== undefined) {
      participant2GoalRecords += 1;
      maxParticipant2Goals = Math.max(maxParticipant2Goals ?? 0, participant2);
    }

    if (!isGoalAction(action)) {
      continue;
    }

    goalActionRecords += 1;
    if (firstGoalOffsetSeconds === undefined && offsetSeconds !== undefined) {
      firstGoalOffsetSeconds = offsetSeconds;
    }

    const normalized = normalizeScorePayload(record, {
      fixture,
      receivedTimestamp: timestamp ?? fixture.startTimestamp
    });
    const goalEvent = normalized.records.find(
      (item) => item.kind === "event" && item.eventType === "GOAL"
    );
    let team: GoalTransitionEvidence["team"] = "UNKNOWN";
    let minute: number | undefined;
    if (goalEvent !== undefined && goalEvent.kind === "event") {
      normalizedGoalEvents += 1;
      minute = goalEvent.minute;
      if (goalEvent.team === "HOME") {
        team = "HOME";
        homeGoalEvents += 1;
      } else if (goalEvent.team === "AWAY") {
        team = "AWAY";
        awayGoalEvents += 1;
      } else {
        unknownGoalEvents += 1;
      }
    } else {
      unknownGoalEvents += 1;
    }

    if (goalTransitions.length < MAX_GOAL_TRANSITIONS) {
      goalTransitions.push({
        ...(offsetSeconds === undefined ? {} : { offsetSeconds }),
        team,
        ...(minute === undefined ? {} : { minute }),
        ...(participant1 === undefined ? {} : { participant1Goals: participant1 }),
        ...(participant2 === undefined ? {} : { participant2Goals: participant2 }),
        rootKickoff
      });
    }
  }

  return {
    records: records.length,
    fixtureScopedRecords,
    ...(earliestOffsetSeconds === undefined ? {} : { earliestOffsetSeconds }),
    startTimeMatches,
    rootKickoffObjects,
    clockRecords,
    nearZeroClockRecords,
    runningClockRecords,
    participant1GoalRecords,
    participant2GoalRecords,
    goalActionRecords,
    normalizedGoalEvents,
    homeGoalEvents,
    awayGoalEvents,
    unknownGoalEvents,
    ...(firstGoalOffsetSeconds === undefined ? {} : { firstGoalOffsetSeconds }),
    ...(maxParticipant1Goals === undefined ? {} : { maxParticipant1Goals }),
    ...(maxParticipant2Goals === undefined ? {} : { maxParticipant2Goals }),
    goalTransitions,
    topLevelActions: boundedCounts(topLevelActions),
    nestedSoccerActions: boundedCounts(nestedSoccerActions),
    gameStates: boundedCounts(gameStates)
  };
}

function formatCounts(values: readonly BoundedEnumCount[]): string {
  return values.length === 0
    ? "NONE"
    : values.map((item) => `${item.value}=${item.count}`).join(", ");
}

function formatOptionalNumber(value: number | undefined, suffix = ""): string {
  return value === undefined ? "NONE" : `${value}${suffix}`;
}

function formatGoalTransition(value: GoalTransitionEvidence): string {
  return [
    `offset=${formatOptionalNumber(value.offsetSeconds, "s")}`,
    `team=${value.team}`,
    `minute=${formatOptionalNumber(value.minute)}`,
    `p1=${formatOptionalNumber(value.participant1Goals)}`,
    `p2=${formatOptionalNumber(value.participant2Goals)}`,
    `kickoff=${value.rootKickoff ? "YES" : "NO"}`
  ].join("/");
}

export function formatOpeningScoreAnchorDiagnostics(
  diagnostics: OpeningScoreAnchorDiagnostics
): string {
  const earliest = formatOptionalNumber(diagnostics.earliestOffsetSeconds, "s");
  const firstGoal = formatOptionalNumber(diagnostics.firstGoalOffsetSeconds, "s");
  const transitions =
    diagnostics.goalTransitions.length === 0
      ? "NONE"
      : diagnostics.goalTransitions.map(formatGoalTransition).join(" | ");
  return [
    `Opening anchor diagnostics: records=${diagnostics.records}; fixture-scoped=${diagnostics.fixtureScopedRecords}; earliest-offset=${earliest}; startTime-match=${diagnostics.startTimeMatches}; root-kickoff=${diagnostics.rootKickoffObjects}; clock=${diagnostics.clockRecords}; near-zero-clock=${diagnostics.nearZeroClockRecords}; running-clock=${diagnostics.runningClockRecords}`,
    `Opening anchor goal fields: participant1=${diagnostics.participant1GoalRecords}; participant2=${diagnostics.participant2GoalRecords}; max-p1=${formatOptionalNumber(diagnostics.maxParticipant1Goals)}; max-p2=${formatOptionalNumber(diagnostics.maxParticipant2Goals)}`,
    `Goal action evidence: actions=${diagnostics.goalActionRecords}; normalized=${diagnostics.normalizedGoalEvents}; home=${diagnostics.homeGoalEvents}; away=${diagnostics.awayGoalEvents}; unknown=${diagnostics.unknownGoalEvents}; first-goal-offset=${firstGoal}`,
    `Goal transition samples: ${transitions}`,
    `Top-level action enums: ${formatCounts(diagnostics.topLevelActions)}`,
    `Soccer action enums: ${formatCounts(diagnostics.nestedSoccerActions)}`,
    `Game-state enums: ${formatCounts(diagnostics.gameStates)}`
  ].join("\n") + "\n";
}
