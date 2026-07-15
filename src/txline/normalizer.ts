import type {
  ImpliedProbabilities,
  MatchRecord,
  TeamSide
} from "../core/types.js";

type UnknownRecord = Record<string, unknown>;

export interface NormalizedFixture {
  fixtureId: string;
  startTime: string | number;
  startTimestamp: number;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  homeParticipant: string;
  awayParticipant: string;
  gameState?: number;
  selectionState: "SELECTABLE" | "AMBIGUOUS";
}

export type NormalizationIssueCode =
  | "INVALID_FIXTURE"
  | "MISSING_SEQUENCE"
  | "INVALID_TIMESTAMP"
  | "INVALID_ORDERING"
  | "UNSUPPORTED_PAYLOAD"
  | "UNKNOWN_TEAM";

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  message: string;
  fixtureId?: string;
  sequence?: number;
}

export interface NormalizationResult {
  records: MatchRecord[];
  issues: NormalizationIssue[];
  disconnected: boolean;
  safeHold: boolean;
}

export interface NormalizeRecordOptions {
  fixture?: NormalizedFixture;
  receivedTimestamp?: number;
  eventId?: string;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function readValue(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
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

export function parseSourceTimestamp(value: unknown): number | undefined {
  const numeric = readFiniteNumber(value);
  if (numeric !== undefined) {
    if (numeric <= 0) {
      return undefined;
    }
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    return Number.isSafeInteger(milliseconds) &&
      Number.isFinite(milliseconds) &&
      milliseconds <= 8_640_000_000_000_000
      ? milliseconds
      : undefined;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record === undefined) {
    return [];
  }
  for (const key of ["data", "fixtures", "odds", "scores"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [record];
}

export function normalizeFixtures(value: unknown): NormalizedFixture[] {
  const candidates: NormalizedFixture[] = [];

  for (const item of extractItems(value)) {
    const record = asRecord(item);
    if (record === undefined) {
      continue;
    }
    const fixtureId = readStringLike(
      readValue(record, ["FixtureId", "fixtureId"])
    );
    const startTime = readValue(record, ["StartTime", "startTime"]);
    const startTimestamp = parseSourceTimestamp(startTime);
    const participant1 = readStringLike(
      readValue(record, ["Participant1", "participant1"])
    );
    const participant2 = readStringLike(
      readValue(record, ["Participant2", "participant2"])
    );
    const participant1IsHome = readValue(record, [
      "Participant1IsHome",
      "participant1IsHome"
    ]);
    const gameState = readInteger(
      readValue(record, ["GameState", "gameState"])
    );

    if (
      fixtureId === undefined ||
      startTimestamp === undefined ||
      (typeof startTime !== "string" && typeof startTime !== "number") ||
      participant1 === undefined ||
      participant2 === undefined ||
      typeof participant1IsHome !== "boolean" ||
      gameState === 6
    ) {
      continue;
    }

    candidates.push({
      fixtureId,
      startTime,
      startTimestamp,
      participant1,
      participant2,
      participant1IsHome,
      homeParticipant: participant1IsHome ? participant1 : participant2,
      awayParticipant: participant1IsHome ? participant2 : participant1,
      ...(gameState === undefined ? {} : { gameState }),
      selectionState: "SELECTABLE"
    });
  }

  const signatureCounts = new Map<string, number>();
  for (const fixture of candidates) {
    const signature = [
      fixture.homeParticipant,
      fixture.awayParticipant,
      fixture.startTimestamp
    ].join("|");
    signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
  }

  return candidates.map((fixture) => {
    const signature = [
      fixture.homeParticipant,
      fixture.awayParticipant,
      fixture.startTimestamp
    ].join("|");
    return fixture.gameState === undefined &&
      (signatureCounts.get(signature) ?? 0) > 1
      ? { ...fixture, selectionState: "AMBIGUOUS" }
      : fixture;
  });
}

interface ParsedBase {
  fixtureId: string;
  sequence: number;
  sourceTimestamp: number;
  receivedTimestamp: number;
  recordId: string;
  action: string;
}

function issue(
  code: NormalizationIssueCode,
  message: string,
  fixtureId?: string,
  sequence?: number
): NormalizationResult {
  return {
    records: [],
    issues: [
      {
        code,
        message,
        ...(fixtureId === undefined ? {} : { fixtureId }),
        ...(sequence === undefined ? {} : { sequence })
      }
    ],
    disconnected: false,
    safeHold: true
  };
}

function parseBase(
  value: unknown,
  options: NormalizeRecordOptions
): ParsedBase | NormalizationResult {
  const record = asRecord(value);
  if (record === undefined) {
    return issue("UNSUPPORTED_PAYLOAD", "TxLINE payload was not an object.");
  }

  const fixtureId = readStringLike(
    readValue(record, ["FixtureId", "fixtureId"])
  );
  if (fixtureId === undefined) {
    return issue("INVALID_FIXTURE", "TxLINE payload had no fixture identity.");
  }

  const sequence = readInteger(readValue(record, ["Seq", "seq"]));
  if (sequence === undefined || sequence <= 0) {
    return issue(
      "MISSING_SEQUENCE",
      "TxLINE payload had no usable observed Seq or seq.",
      fixtureId
    );
  }

  const sourceTimestamp = parseSourceTimestamp(
    readValue(record, ["Ts", "ts"])
  );
  if (sourceTimestamp === undefined) {
    return issue(
      "INVALID_TIMESTAMP",
      "TxLINE payload had no usable observed Ts or ts.",
      fixtureId,
      sequence
    );
  }

  const sourceRecordId = readStringLike(
    readValue(record, ["MessageId", "messageId", "EventId", "eventId"])
  );
  const action =
    readStringLike(readValue(record, ["action", "Action"]))?.toLowerCase() ??
    "";

  return {
    fixtureId,
    sequence,
    sourceTimestamp,
    receivedTimestamp: options.receivedTimestamp ?? Date.now(),
    recordId:
      sourceRecordId ??
      options.eventId ??
      `txline:${fixtureId}:${sequence}:${sourceTimestamp}`,
    action
  };
}

function normalizeTeamSide(
  value: unknown,
  fixture?: NormalizedFixture
): TeamSide | undefined {
  const team = readStringLike(value)?.toLowerCase();
  if (team === "home") {
    return "HOME";
  }
  if (team === "away") {
    return "AWAY";
  }
  if (team === "participant1" || team === "1") {
    return fixture?.participant1IsHome === false ? "AWAY" : "HOME";
  }
  if (team === "participant2" || team === "2") {
    return fixture?.participant1IsHome === false ? "HOME" : "AWAY";
  }
  return undefined;
}

function result(record: MatchRecord): NormalizationResult {
  return {
    records: [record],
    issues: [],
    disconnected: false,
    safeHold: false
  };
}

export function normalizeScorePayload(
  value: unknown,
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  const base = parseBase(value, options);
  if ("records" in base) {
    return base;
  }
  const source = asRecord(value);
  if (source === undefined) {
    return issue("UNSUPPORTED_PAYLOAD", "TxLINE score payload was invalid.");
  }

  if (base.action === "disconnected") {
    return {
      records: [],
      issues: [],
      disconnected: true,
      safeHold: false
    };
  }

  const shared = {
    fixtureId: base.fixtureId,
    recordId: base.recordId,
    sequence: base.sequence,
    sourceTimestamp: base.sourceTimestamp,
    receivedTimestamp: base.receivedTimestamp,
    provenance: "TXLINE" as const
  };

  if (
    base.action === "kickoff" ||
    base.action === "match_started" ||
    base.action === "matchstarted"
  ) {
    return result({
      ...shared,
      kind: "event",
      eventType: "KICKOFF",
      minute: 0
    });
  }

  if (base.action === "goal" || base.action.endsWith("_goal")) {
    const team = normalizeTeamSide(
      readValue(source, ["team", "Team", "side", "Side", "participant"]),
      options.fixture
    );
    if (team === undefined) {
      return issue(
        "UNKNOWN_TEAM",
        "TxLINE goal payload did not identify a feed-side team.",
        base.fixtureId,
        base.sequence
      );
    }
    const explicitMinute = readFiniteNumber(
      readValue(source, ["minute", "Minute"])
    );
    const minute =
      explicitMinute !== undefined && explicitMinute >= 0
        ? Math.floor(explicitMinute)
        : Math.max(
            0,
            Math.floor(
              (base.sourceTimestamp -
                (options.fixture?.startTimestamp ?? base.sourceTimestamp)) /
                60_000
            )
          );
    return result({
      ...shared,
      kind: "event",
      eventType: "GOAL",
      team,
      minute
    });
  }

  const homeScore = readInteger(
    readValue(source, ["HomeScore", "homeScore", "scoreHome"])
  );
  const awayScore = readInteger(
    readValue(source, ["AwayScore", "awayScore", "scoreAway"])
  );
  if (
    homeScore !== undefined &&
    awayScore !== undefined &&
    homeScore >= 0 &&
    awayScore >= 0
  ) {
    return result({
      ...shared,
      kind: "recovery",
      recoveryReason: "TxLINE score snapshot hydration",
      snapshot: {
        score: { home: homeScore, away: awayScore }
      }
    });
  }

  return issue(
    "UNSUPPORTED_PAYLOAD",
    "TxLINE score payload was outside the MatchShift milestone scope.",
    base.fixtureId,
    base.sequence
  );
}

function readProbability(
  source: UnknownRecord,
  keys: readonly string[]
): number | undefined {
  const value = readFiniteNumber(readValue(source, keys));
  return value !== undefined && value >= 0 && value <= 1 ? value : undefined;
}

function readProbabilities(
  source: UnknownRecord,
  fixture?: NormalizedFixture
): ImpliedProbabilities | undefined {
  const nested = asRecord(
    readValue(source, ["impliedProbabilities", "ImpliedProbabilities"])
  );
  const probabilitySource = nested ?? source;
  let homeWin = readProbability(probabilitySource, [
    "homeWin",
    "HomeWin",
    "homeProbability",
    "HomeProbability"
  ]);
  let awayWin = readProbability(probabilitySource, [
    "awayWin",
    "AwayWin",
    "awayProbability",
    "AwayProbability"
  ]);
  const draw = readProbability(probabilitySource, [
    "draw",
    "Draw",
    "drawProbability",
    "DrawProbability"
  ]);
  const participant1 = readProbability(probabilitySource, [
    "participant1Probability",
    "Participant1Probability"
  ]);
  const participant2 = readProbability(probabilitySource, [
    "participant2Probability",
    "Participant2Probability"
  ]);

  if (homeWin === undefined && awayWin === undefined) {
    if (fixture?.participant1IsHome === false) {
      homeWin = participant2;
      awayWin = participant1;
    } else {
      homeWin = participant1;
      awayWin = participant2;
    }
  }

  return homeWin === undefined || awayWin === undefined || draw === undefined
    ? undefined
    : { homeWin, draw, awayWin };
}

export function normalizeOddsPayload(
  value: unknown,
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  const base = parseBase(value, options);
  if ("records" in base) {
    return base;
  }
  const source = asRecord(value);
  if (source === undefined) {
    return issue("UNSUPPORTED_PAYLOAD", "TxLINE odds payload was invalid.");
  }

  if (base.action === "disconnected") {
    return {
      records: [],
      issues: [],
      disconnected: true,
      safeHold: false
    };
  }
  const impliedProbabilities = readProbabilities(source, options.fixture);
  if (impliedProbabilities === undefined) {
    return issue(
      "UNSUPPORTED_PAYLOAD",
      "TxLINE odds payload had no explicit usable probabilities.",
      base.fixtureId,
      base.sequence
    );
  }

  return result({
    fixtureId: base.fixtureId,
    recordId: base.recordId,
    sequence: base.sequence,
    sourceTimestamp: base.sourceTimestamp,
    receivedTimestamp: base.receivedTimestamp,
    provenance: "TXLINE",
    kind: "odds",
    impliedProbabilities
  });
}

export function normalizePayloads(
  value: unknown,
  kind: "odds" | "scores",
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  const combined: NormalizationResult = {
    records: [],
    issues: [],
    disconnected: false,
    safeHold: false
  };

  for (const item of extractItems(value)) {
    const normalized =
      kind === "odds"
        ? normalizeOddsPayload(item, options)
        : normalizeScorePayload(item, options);
    combined.records.push(...normalized.records);
    combined.issues.push(...normalized.issues);
    combined.disconnected ||= normalized.disconnected;
    combined.safeHold ||= normalized.safeHold;
  }
  combined.records.sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.sourceTimestamp - right.sourceTimestamp
  );
  for (let index = 1; index < combined.records.length; index += 1) {
    const previous = combined.records[index - 1];
    const current = combined.records[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (
      current.sequence <= previous.sequence ||
      current.sourceTimestamp < previous.sourceTimestamp
    ) {
      combined.records = [];
      combined.issues.push({
        code: "INVALID_ORDERING",
        message:
          "TxLINE snapshot ordering or source timestamps were not monotonic.",
        fixtureId: current.fixtureId,
        sequence: current.sequence
      });
      combined.safeHold = true;
      break;
    }
  }

  return combined;
}
