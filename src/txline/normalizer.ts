import type {
  ImpliedProbabilities,
  MatchRecord,
  SourceOrderMetadata,
  TeamSide
} from "../core/types.js";
import { compareMatchRecords } from "../core/visibility.js";

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
  | "MALFORMED_SUPPORTED_MARKET"
  | "MALFORMED_SCORE"
  | "UNKNOWN_TEAM";

export type NormalizationDiagnosticCode =
  | "IGNORED_UNSUPPORTED_ODDS_MARKET"
  | "IGNORED_UNSUPPORTED_SCORE_ACTION";

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  message: string;
  fixtureId?: string;
  sequence?: number;
}

export interface NormalizationDiagnostic {
  code: NormalizationDiagnosticCode;
  message: string;
  fixtureId?: string;
}

export interface NormalizationResult {
  records: MatchRecord[];
  issues: NormalizationIssue[];
  diagnostics: NormalizationDiagnostic[];
  disconnected: boolean;
  safeHold: boolean;
}

export interface NormalizeRecordOptions {
  fixture?: NormalizedFixture;
  receivedTimestamp?: number;
  eventId?: string;
  snapshot?: boolean;
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readStringLike(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct !== undefined) {
    return direct;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
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

export function parseSourceTimestamp(value: unknown): number | undefined {
  const numeric = readFiniteNumber(value);
  if (numeric !== undefined) {
    if (numeric <= 0) {
      return undefined;
    }
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    return Number.isSafeInteger(milliseconds) &&
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
    const gameState = readInteger(readValue(record, ["GameState", "gameState"]));

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

function emptyResult(): NormalizationResult {
  return {
    records: [],
    issues: [],
    diagnostics: [],
    disconnected: false,
    safeHold: false
  };
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
    diagnostics: [],
    disconnected: false,
    safeHold: true
  };
}

function ignored(
  code: NormalizationDiagnosticCode,
  message: string,
  fixtureId?: string
): NormalizationResult {
  return {
    records: [],
    issues: [],
    diagnostics: [
      {
        code,
        message,
        ...(fixtureId === undefined ? {} : { fixtureId })
      }
    ],
    disconnected: false,
    safeHold: false
  };
}

function result(record: MatchRecord): NormalizationResult {
  return {
    records: [record],
    issues: [],
    diagnostics: [],
    disconnected: false,
    safeHold: false
  };
}

function stableSerialize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as UnknownRecord;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadIdentity(value: unknown): string {
  const input = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function scoreSourceOrder(
  fixtureId: string,
  sourceSequence: number,
  sourceTimestamp: number,
  recordId: string,
  identity: string,
  eventId?: string
): SourceOrderMetadata {
  return {
    domain: "TXLINE_SCORES",
    sourceSequence,
    payloadIdentity: identity,
    tieBreaker: [
      "TXLINE_SCORES",
      String(sourceTimestamp).padStart(16, "0"),
      String(sourceSequence).padStart(16, "0"),
      fixtureId,
      recordId,
      eventId ?? "",
      identity
    ].join(":"),
    ...(eventId === undefined ? {} : { sseEventId: eventId })
  };
}

function oddsSourceOrder(
  fixtureId: string,
  sourceTimestamp: number,
  messageId: string,
  identity: string,
  eventId?: string
): SourceOrderMetadata {
  return {
    domain: "TXLINE_ODDS",
    payloadIdentity: identity,
    sourceMessageId: messageId,
    tieBreaker: [
      "TXLINE_ODDS",
      String(sourceTimestamp).padStart(16, "0"),
      fixtureId,
      messageId,
      eventId ?? "",
      identity
    ].join(":"),
    ...(eventId === undefined ? {} : { sseEventId: eventId })
  };
}

function normalizeParticipantSide(
  value: unknown,
  fixture?: NormalizedFixture
): TeamSide | undefined {
  if (fixture === undefined) {
    return undefined;
  }
  const participant = readStringLike(value)?.trim().toLowerCase();
  if (participant === "participant1" || participant === "1") {
    return fixture.participant1IsHome ? "HOME" : "AWAY";
  }
  if (participant === "participant2" || participant === "2") {
    return fixture.participant1IsHome ? "AWAY" : "HOME";
  }
  return undefined;
}

function readGoals(
  scoreSoccer: UnknownRecord,
  participant: "Participant1" | "Participant2"
): number | undefined {
  const participantScore = asRecord(scoreSoccer[participant]);
  const total = participantScore === undefined
    ? undefined
    : asRecord(readValue(participantScore, ["Total", "total"]));
  const goals = total === undefined
    ? undefined
    : readInteger(readValue(total, ["Goals", "goals"]));
  return goals !== undefined && goals >= 0 ? goals : undefined;
}

function readScoreSnapshot(
  source: UnknownRecord,
  fixture?: NormalizedFixture
): { home: number; away: number } | undefined {
  if (fixture === undefined) {
    return undefined;
  }
  const scoreSoccer = asRecord(readValue(source, ["scoreSoccer", "ScoreSoccer"]));
  if (scoreSoccer === undefined) {
    return undefined;
  }
  const participant1Goals = readGoals(scoreSoccer, "Participant1");
  const participant2Goals = readGoals(scoreSoccer, "Participant2");
  if (participant1Goals === undefined || participant2Goals === undefined) {
    return undefined;
  }
  return fixture.participant1IsHome
    ? { home: participant1Goals, away: participant2Goals }
    : { home: participant2Goals, away: participant1Goals };
}

function isGoalAction(action: string): boolean {
  return action === "goal" || action.endsWith("_goal");
}

function isKickoffAction(action: string): boolean {
  return ["kickoff", "match_started", "matchstarted", "game_started"].includes(
    action
  );
}

const IGNORED_SCORE_ACTIONS = new Set([
  "lineup",
  "lineups",
  "pitch_condition",
  "player_update"
]);

export function normalizeScorePayload(
  value: unknown,
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  const source = asRecord(value);
  if (source === undefined) {
    return issue("MALFORMED_SCORE", "TxLINE score payload was not an object.");
  }

  const action =
    readStringLike(readValue(source, ["action", "Action"]))?.toLowerCase() ?? "";
  if (action === "disconnected") {
    return { ...emptyResult(), disconnected: true };
  }

  const fixtureId = readStringLike(
    readValue(source, ["fixtureId", "FixtureId"])
  );
  if (fixtureId === undefined) {
    return issue("INVALID_FIXTURE", "TxLINE score payload had no fixtureId.");
  }

  const hasScoreSoccer =
    asRecord(readValue(source, ["scoreSoccer", "ScoreSoccer"])) !== undefined;
  const relevant = isGoalAction(action) || isKickoffAction(action) || hasScoreSoccer;
  if (!relevant || IGNORED_SCORE_ACTIONS.has(action)) {
    return ignored(
      "IGNORED_UNSUPPORTED_SCORE_ACTION",
      "Unsupported TxLINE score action was ignored.",
      fixtureId
    );
  }

  const sourceSequence = readInteger(readValue(source, ["seq", "Seq"]));
  if (sourceSequence === undefined || sourceSequence <= 0) {
    return issue(
      "MISSING_SEQUENCE",
      "Relevant TxLINE score payload had no usable seq.",
      fixtureId
    );
  }

  const sourceTimestamp = parseSourceTimestamp(readValue(source, ["ts", "Ts"]));
  if (sourceTimestamp === undefined) {
    return issue(
      "INVALID_TIMESTAMP",
      "Relevant TxLINE score payload had no usable ts.",
      fixtureId,
      sourceSequence
    );
  }

  const sourceId = readStringLike(
    readValue(source, ["MessageId", "messageId", "EventId", "eventId", "id", "Id"])
  );
  const identity = payloadIdentity(source);
  const recordId =
    sourceId ??
    options.eventId ??
    `txline-score:${fixtureId}:${sourceSequence}:${sourceTimestamp}:${identity}`;
  const sourceOrder = scoreSourceOrder(
    fixtureId,
    sourceSequence,
    sourceTimestamp,
    recordId,
    identity,
    options.eventId
  );
  const shared = {
    fixtureId,
    recordId,
    sourceTimestamp,
    receivedTimestamp: options.receivedTimestamp ?? Date.now(),
    provenance: "TXLINE" as const,
    sourceOrder
  };
  const score = readScoreSnapshot(source, options.fixture);

  if (options.snapshot === true) {
    if (score === undefined) {
      return issue(
        "MALFORMED_SCORE",
        "Relevant TxLINE score snapshot lacked valid nested scoreSoccer totals.",
        fixtureId,
        sourceSequence
      );
    }
    return result({
      ...shared,
      kind: "recovery",
      recoveryReason: "TxLINE latest score-action snapshot hydration",
      snapshot: { score }
    });
  }

  if (isGoalAction(action)) {
    const dataSoccer = asRecord(readValue(source, ["dataSoccer", "DataSoccer"]));
    const team = normalizeParticipantSide(
      dataSoccer === undefined
        ? undefined
        : readValue(dataSoccer, ["Participant", "participant"]),
      options.fixture
    );
    const minutes =
      dataSoccer === undefined
        ? undefined
        : readFiniteNumber(readValue(dataSoccer, ["Minutes", "minutes"]));
    if (team === undefined || minutes === undefined || minutes < 0) {
      return issue(
        team === undefined ? "UNKNOWN_TEAM" : "MALFORMED_SCORE",
        "TxLINE goal payload lacked valid dataSoccer participant or minutes.",
        fixtureId,
        sourceSequence
      );
    }
    return result({
      ...shared,
      kind: "event",
      eventType: "GOAL",
      team,
      minute: Math.floor(minutes)
    });
  }

  if (isKickoffAction(action)) {
    return result({
      ...shared,
      kind: "event",
      eventType: "KICKOFF",
      minute: 0
    });
  }

  if (score !== undefined) {
    return result({
      ...shared,
      kind: "recovery",
      recoveryReason: "TxLINE nested score recovery",
      snapshot: { score }
    });
  }

  return issue(
    "MALFORMED_SCORE",
    "Relevant TxLINE score payload lacked valid nested scoreSoccer totals.",
    fixtureId,
    sourceSequence
  );
}

function canonicalLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isSupportedWinnerMarket(
  superOddsType: string,
  marketParameters: unknown,
  marketPeriod: unknown
): boolean {
  const market = canonicalLabel(superOddsType);
  const parameters = readString(marketParameters) ?? "";
  const period = canonicalLabel(readString(marketPeriod) ?? "");
  const acceptedMarket = new Set([
    "1x2",
    "matchwinner",
    "fulltimematchwinner",
    "soccer1x2"
  ]).has(market);
  const acceptedPeriod = new Set([
    "",
    "match",
    "fullmatch",
    "fulltime",
    "regulartime",
    "ft"
  ]).has(period);
  return acceptedMarket && parameters === "" && acceptedPeriod;
}

interface OutcomeIndexes {
  first: number;
  draw: number;
  second: number;
  directHomeAway: boolean;
}

function indexOfAny(labels: readonly string[], candidates: readonly string[]): number {
  return labels.findIndex((label) => candidates.includes(label));
}

function outcomeIndexes(
  priceNames: readonly string[],
  fixture?: NormalizedFixture
): OutcomeIndexes | undefined {
  const labels = priceNames.map(canonicalLabel);
  if (new Set(labels).size !== labels.length) {
    return undefined;
  }

  const home = indexOfAny(labels, ["home"]);
  const draw = indexOfAny(labels, ["draw", "x"]);
  const away = indexOfAny(labels, ["away"]);
  if (home >= 0 && draw >= 0 && away >= 0) {
    return { first: home, draw, second: away, directHomeAway: true };
  }

  if (fixture === undefined) {
    return undefined;
  }
  const participant1 = indexOfAny(labels, [
    "1",
    "participant1",
    canonicalLabel(fixture.participant1)
  ]);
  const participant2 = indexOfAny(labels, [
    "2",
    "participant2",
    canonicalLabel(fixture.participant2)
  ]);
  return participant1 >= 0 && draw >= 0 && participant2 >= 0
    ? { first: participant1, draw, second: participant2, directHomeAway: false }
    : undefined;
}

function normalizePositiveTriple(
  values: readonly number[]
): readonly [number, number, number] | undefined {
  if (
    values.length !== 3 ||
    values.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return undefined;
  }
  const total = values[0]! + values[1]! + values[2]!;
  return total > 0
    ? [values[0]! / total, values[1]! / total, values[2]! / total]
    : undefined;
}

function probabilitiesFromPct(value: unknown): readonly [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  const numeric = value.map(readFiniteNumber);
  if (numeric.some((item) => item === undefined)) {
    return undefined;
  }
  return normalizePositiveTriple(numeric as number[]);
}

function probabilitiesFromPrices(
  value: unknown
): readonly [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  const prices = value.map(readFiniteNumber);
  if (prices.some((item) => item === undefined || item <= 0)) {
    return undefined;
  }
  return normalizePositiveTriple((prices as number[]).map((price) => 1 / price));
}

function mapProbabilities(
  values: readonly [number, number, number],
  indexes: OutcomeIndexes,
  fixture?: NormalizedFixture
): ImpliedProbabilities | undefined {
  const first = values[indexes.first];
  const draw = values[indexes.draw];
  const second = values[indexes.second];
  if (first === undefined || draw === undefined || second === undefined) {
    return undefined;
  }
  if (indexes.directHomeAway) {
    return { homeWin: first, draw, awayWin: second };
  }
  if (fixture === undefined) {
    return undefined;
  }
  return fixture.participant1IsHome
    ? { homeWin: first, draw, awayWin: second }
    : { homeWin: second, draw, awayWin: first };
}

export function normalizeOddsPayload(
  value: unknown,
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  const source = asRecord(value);
  if (source === undefined) {
    return issue(
      "MALFORMED_SUPPORTED_MARKET",
      "TxLINE odds payload was not an object."
    );
  }

  const action =
    readStringLike(readValue(source, ["action", "Action"]))?.toLowerCase() ?? "";
  if (action === "disconnected") {
    return { ...emptyResult(), disconnected: true };
  }

  const fixtureId = readStringLike(readValue(source, ["FixtureId", "fixtureId"]));
  if (fixtureId === undefined) {
    return issue("INVALID_FIXTURE", "TxLINE odds payload had no FixtureId.");
  }

  const superOddsType = readString(readValue(source, ["SuperOddsType", "superOddsType"]));
  if (
    superOddsType === undefined ||
    !isSupportedWinnerMarket(
      superOddsType,
      readValue(source, ["MarketParameters", "marketParameters"]),
      readValue(source, ["MarketPeriod", "marketPeriod"])
    )
  ) {
    return ignored(
      "IGNORED_UNSUPPORTED_ODDS_MARKET",
      "Unsupported TxLINE odds market was ignored.",
      fixtureId
    );
  }

  const sourceTimestamp = parseSourceTimestamp(readValue(source, ["Ts", "ts"]));
  const sourceMessageId = readStringLike(
    readValue(source, ["MessageId", "messageId"])
  );
  const recordId = sourceMessageId ?? options.eventId;
  const rawPriceNames = readValue(source, ["PriceNames", "priceNames"]);
  const priceNames = Array.isArray(rawPriceNames)
    ? rawPriceNames.filter((item): item is string => typeof item === "string")
    : undefined;

  if (
    sourceTimestamp === undefined ||
    recordId === undefined ||
    priceNames === undefined ||
    priceNames.length !== 3 ||
    (Array.isArray(rawPriceNames) && priceNames.length !== rawPriceNames.length)
  ) {
    return issue(
      sourceTimestamp === undefined
        ? "INVALID_TIMESTAMP"
        : "MALFORMED_SUPPORTED_MARKET",
      "Claimed TxLINE match-winner market lacked valid official identifiers or PriceNames.",
      fixtureId
    );
  }

  const indexes = outcomeIndexes(priceNames, options.fixture);
  const rawProbabilities =
    probabilitiesFromPct(readValue(source, ["Pct", "pct"])) ??
    probabilitiesFromPrices(readValue(source, ["Prices", "prices"]));
  const impliedProbabilities =
    indexes === undefined || rawProbabilities === undefined
      ? undefined
      : mapProbabilities(rawProbabilities, indexes, options.fixture);
  if (impliedProbabilities === undefined) {
    return issue(
      "MALFORMED_SUPPORTED_MARKET",
      "Claimed TxLINE match-winner market had ambiguous labels or invalid aligned prices.",
      fixtureId
    );
  }

  const identity = payloadIdentity(source);
  return result({
    fixtureId,
    recordId,
    sourceTimestamp,
    receivedTimestamp: options.receivedTimestamp ?? Date.now(),
    provenance: "TXLINE",
    sourceOrder: oddsSourceOrder(
      fixtureId,
      sourceTimestamp,
      sourceMessageId ?? recordId,
      identity,
      options.eventId
    ),
    kind: "odds",
    impliedProbabilities
  });
}

function scoreSnapshotOrder(left: MatchRecord, right: MatchRecord): number {
  const leftSequence = left.sourceOrder?.sourceSequence ?? -1;
  const rightSequence = right.sourceOrder?.sourceSequence ?? -1;
  return (
    leftSequence - rightSequence ||
    left.sourceTimestamp - right.sourceTimestamp ||
    compareMatchRecords(left, right)
  );
}

export function normalizePayloads(
  value: unknown,
  kind: "odds" | "scores",
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  const combined = emptyResult();

  for (const item of extractItems(value)) {
    const normalized =
      kind === "odds"
        ? normalizeOddsPayload(item, options)
        : normalizeScorePayload(item, { ...options, snapshot: true });
    combined.records.push(...normalized.records);
    combined.issues.push(...normalized.issues);
    combined.diagnostics.push(...normalized.diagnostics);
    combined.disconnected ||= normalized.disconnected;
    combined.safeHold ||= normalized.safeHold;
  }

  if (combined.safeHold) {
    combined.records = [];
    return combined;
  }

  if (kind === "scores" && combined.records.length > 1) {
    combined.records.sort(scoreSnapshotOrder);
    const latest = combined.records.at(-1);
    combined.records = latest === undefined ? [] : [latest];
  } else {
    combined.records.sort(compareMatchRecords);
  }

  return combined;
}
