import {
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
  topLevelActions: BoundedEnumCount[];
  nestedSoccerActions: BoundedEnumCount[];
  gameStates: BoundedEnumCount[];
}

const MAX_ENUM_VALUES = 16;
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

function participantGoalsPresent(
  score: UnknownRecord | undefined,
  participant: "Participant1" | "Participant2"
): boolean {
  const participantRecord = asRecord(
    score?.[participant] ?? score?.[participant.toLowerCase()]
  );
  const total = asRecord(participantRecord?.Total ?? participantRecord?.total);
  const goals = readInteger(total?.Goals ?? total?.goals);
  return goals !== undefined && goals >= 0;
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

    increment(
      topLevelActions,
      safeEnumValue(record.action ?? record.Action)
    );
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
    if (timestamp !== undefined) {
      const offsetSeconds = Math.round(
        (timestamp - fixture.startTimestamp) / 1_000
      );
      if (
        earliestOffsetSeconds === undefined ||
        offsetSeconds < earliestOffsetSeconds
      ) {
        earliestOffsetSeconds = offsetSeconds;
      }
    }

    const recordStart = parseSourceTimestamp(record.startTime ?? record.StartTime);
    if (recordStart === fixture.startTimestamp) {
      startTimeMatches += 1;
    }

    if (asRecord(record.kickoff ?? record.Kickoff) !== undefined) {
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
    if (participantGoalsPresent(score, "Participant1")) {
      participant1GoalRecords += 1;
    }
    if (participantGoalsPresent(score, "Participant2")) {
      participant2GoalRecords += 1;
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

export function formatOpeningScoreAnchorDiagnostics(
  diagnostics: OpeningScoreAnchorDiagnostics
): string {
  const earliest =
    diagnostics.earliestOffsetSeconds === undefined
      ? "NONE"
      : `${diagnostics.earliestOffsetSeconds}s`;
  return [
    `Opening anchor diagnostics: records=${diagnostics.records}; fixture-scoped=${diagnostics.fixtureScopedRecords}; earliest-offset=${earliest}; startTime-match=${diagnostics.startTimeMatches}; root-kickoff=${diagnostics.rootKickoffObjects}; clock=${diagnostics.clockRecords}; near-zero-clock=${diagnostics.nearZeroClockRecords}; running-clock=${diagnostics.runningClockRecords}`,
    `Opening anchor goal fields: participant1=${diagnostics.participant1GoalRecords}; participant2=${diagnostics.participant2GoalRecords}`,
    `Top-level action enums: ${formatCounts(diagnostics.topLevelActions)}`,
    `Soccer action enums: ${formatCounts(diagnostics.nestedSoccerActions)}`,
    `Game-state enums: ${formatCounts(diagnostics.gameStates)}`
  ].join("\n") + "\n";
}
