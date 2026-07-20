import type {
  ImpliedProbabilities,
  MatchDefinition,
  MatchRecord,
  Score,
  TeamSide
} from "../core/types.js";
import { compareMatchRecords } from "../core/visibility.js";
import type { NormalizedFixture } from "./normalizer.js";

const MINUTE_MS = 60_000;
const MAX_CURATED_DURATION_MINUTES = 240;

export class CuratedReplayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CuratedReplayError";
    this.code = code;
  }
}

export interface CuratedFixtureSelector {
  fixtureId?: string;
  sideA?: string;
  sideB?: string;
  matchDateUtc?: string;
}

export interface BuildCuratedMatchOptions {
  fixture: NormalizedFixture;
  scoreRecords: readonly MatchRecord[];
  oddsRecords: readonly MatchRecord[];
  publicFixtureId: string;
  publicLabel: string;
  durationMinutes: number;
}

type CuratedScoreEntry =
  | {
      kind: "event";
      sourceTimestamp: number;
      eventType: Extract<MatchRecord, { kind: "event" }>["eventType"];
      minute: number;
      team?: TeamSide;
    }
  | {
      kind: "recovery";
      sourceTimestamp: number;
      score: Score;
      impliedProbabilities?: ImpliedProbabilities;
    };

interface CuratedOddsEntry {
  sourceTimestamp: number;
  impliedProbabilities: ImpliedProbabilities;
}

function canonicalParticipant(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function validProbabilityTriple(value: ImpliedProbabilities): boolean {
  const values = [value.homeWin, value.draw, value.awayWin];
  const total = values.reduce((sum, item) => sum + item, 0);
  return (
    values.every((item) => Number.isFinite(item) && item >= 0 && item <= 1) &&
    Math.abs(total - 1) <= 0.000_001
  );
}

function probabilitySignature(value: ImpliedProbabilities): string {
  return [value.homeWin, value.draw, value.awayWin]
    .map((item) => item.toFixed(8))
    .join("|");
}

function validScore(value: Score): boolean {
  return (
    Number.isSafeInteger(value.home) &&
    value.home >= 0 &&
    Number.isSafeInteger(value.away) &&
    value.away >= 0
  );
}

function sanitizedTimestamp(timestamp: number, kickoffTimestamp: number): number {
  return Math.max(kickoffTimestamp, timestamp);
}

function localSourceOrder(
  domain: "TXLINE_SCORES" | "TXLINE_ODDS",
  recordId: string,
  sourceTimestamp: number,
  sourceSequence?: number
) {
  return {
    domain,
    tieBreaker: [
      "curated",
      domain,
      String(sourceTimestamp).padStart(16, "0"),
      sourceSequence === undefined
        ? "0000000000000000"
        : String(sourceSequence).padStart(16, "0"),
      recordId
    ].join(":"),
    payloadIdentity: recordId,
    ...(sourceSequence === undefined ? {} : { sourceSequence })
  };
}

export function selectCuratedFixture(
  fixtures: readonly NormalizedFixture[],
  selector: CuratedFixtureSelector
): NormalizedFixture {
  const selectable = fixtures.filter(
    (fixture) => fixture.selectionState === "SELECTABLE"
  );
  const requestedFixtureId = selector.fixtureId?.trim();
  if (requestedFixtureId !== undefined && requestedFixtureId !== "") {
    const match = selectable.find(
      (fixture) => fixture.fixtureId === requestedFixtureId
    );
    if (match === undefined) {
      throw new CuratedReplayError(
        "CURATED_FIXTURE_NOT_FOUND",
        "The configured completed fixture was not found in the selectable fixture snapshot."
      );
    }
    return match;
  }

  const sideA = selector.sideA?.trim();
  const sideB = selector.sideB?.trim();
  if (
    sideA === undefined ||
    sideA === "" ||
    sideB === undefined ||
    sideB === ""
  ) {
    throw new CuratedReplayError(
      "CURATED_SIDES_REQUIRED",
      "Two participant names or an explicit fixture identifier are required."
    );
  }

  const matchDateUtc = selector.matchDateUtc?.trim();
  if (
    matchDateUtc !== undefined &&
    matchDateUtc !== "" &&
    !isIsoDate(matchDateUtc)
  ) {
    throw new CuratedReplayError(
      "CURATED_DATE_INVALID",
      "The optional curated match date must use YYYY-MM-DD in UTC."
    );
  }

  const requested = new Set([
    canonicalParticipant(sideA),
    canonicalParticipant(sideB)
  ]);
  const candidates = selectable
    .filter((fixture) => {
      const actual = new Set([
        canonicalParticipant(fixture.participant1),
        canonicalParticipant(fixture.participant2)
      ]);
      const participantsMatch =
        actual.size === 2 &&
        requested.size === 2 &&
        [...requested].every((participant) => actual.has(participant));
      const dateMatches =
        matchDateUtc === undefined ||
        matchDateUtc === "" ||
        new Date(fixture.startTimestamp).toISOString().slice(0, 10) ===
          matchDateUtc;
      return participantsMatch && dateMatches;
    })
    .sort((left, right) => right.startTimestamp - left.startTimestamp);

  if (candidates.length === 0) {
    throw new CuratedReplayError(
      "CURATED_FIXTURE_NOT_FOUND",
      "No selectable fixture matched the configured participants and UTC date."
    );
  }
  if (candidates.length > 1) {
    throw new CuratedReplayError(
      "CURATED_FIXTURE_AMBIGUOUS",
      "More than one selectable fixture matched; provide the exact UTC date or fixture identifier."
    );
  }
  return candidates[0]!;
}

function scoreEntries(
  records: readonly MatchRecord[],
  kickoffTimestamp: number
): CuratedScoreEntry[] {
  const entries: CuratedScoreEntry[] = [];
  for (const record of records) {
    if (record.kind === "odds") {
      continue;
    }
    const sourceTimestamp = sanitizedTimestamp(
      record.sourceTimestamp,
      kickoffTimestamp
    );
    if (record.kind === "recovery") {
      if (!validScore(record.snapshot.score)) {
        throw new CuratedReplayError(
          "CURATED_SCORE_INVALID",
          "A normalized recovery score was invalid."
        );
      }
      const impliedProbabilities = record.snapshot.impliedProbabilities;
      if (
        impliedProbabilities !== undefined &&
        !validProbabilityTriple(impliedProbabilities)
      ) {
        throw new CuratedReplayError(
          "CURATED_ODDS_INVALID",
          "A normalized recovery probability triple was invalid."
        );
      }
      entries.push({
        kind: "recovery",
        sourceTimestamp,
        score: { ...record.snapshot.score },
        ...(impliedProbabilities === undefined
          ? {}
          : { impliedProbabilities: { ...impliedProbabilities } })
      });
      continue;
    }
    if (
      record.eventType === "GOAL" &&
      record.team !== "HOME" &&
      record.team !== "AWAY"
    ) {
      throw new CuratedReplayError(
        "CURATED_GOAL_TEAM_MISSING",
        "A normalized goal record had no trusted home or away side."
      );
    }
    entries.push({
      kind: "event",
      sourceTimestamp,
      eventType: record.eventType,
      minute: Math.max(0, Math.floor(record.minute)),
      ...(record.team === undefined ? {} : { team: record.team })
    });
  }

  entries.sort((left, right) => {
    const timestampOrder = left.sourceTimestamp - right.sourceTimestamp;
    if (timestampOrder !== 0) {
      return timestampOrder;
    }
    if (left.kind === right.kind) {
      return 0;
    }
    return left.kind === "recovery" ? -1 : 1;
  });

  const firstRecoveryIndex = entries.findIndex(
    (entry) => entry.kind === "recovery"
  );
  if (firstRecoveryIndex < 0) {
    throw new CuratedReplayError(
      "CURATED_BASELINE_MISSING",
      "Historical scores did not produce a trusted recovery baseline."
    );
  }
  const trusted = entries.slice(firstRecoveryIndex);
  if (!trusted.some((entry) => entry.kind === "event" && entry.eventType === "KICKOFF")) {
    trusted.splice(1, 0, {
      kind: "event",
      sourceTimestamp: trusted[0]!.sourceTimestamp,
      eventType: "KICKOFF",
      minute: 0
    });
    trusted.sort((left, right) => {
      const timestampOrder = left.sourceTimestamp - right.sourceTimestamp;
      if (timestampOrder !== 0) {
        return timestampOrder;
      }
      if (left.kind === "recovery" && right.kind !== "recovery") {
        return -1;
      }
      if (right.kind === "recovery" && left.kind !== "recovery") {
        return 1;
      }
      if (
        left.kind === "event" &&
        right.kind === "event" &&
        left.eventType !== right.eventType
      ) {
        return left.eventType === "KICKOFF" ? -1 : 1;
      }
      return 0;
    });
  }
  return trusted;
}

function oddsEntries(
  records: readonly MatchRecord[],
  kickoffTimestamp: number
): CuratedOddsEntry[] {
  const candidates = records
    .filter((record): record is Extract<MatchRecord, { kind: "odds" }> =>
      record.kind === "odds"
    )
    .map((record) => {
      if (!validProbabilityTriple(record.impliedProbabilities)) {
        throw new CuratedReplayError(
          "CURATED_ODDS_INVALID",
          "A normalized odds probability triple was invalid."
        );
      }
      return {
        sourceTimestamp: sanitizedTimestamp(
          record.sourceTimestamp,
          kickoffTimestamp
        ),
        impliedProbabilities: { ...record.impliedProbabilities }
      };
    })
    .sort((left, right) => left.sourceTimestamp - right.sourceTimestamp);

  const result: CuratedOddsEntry[] = [];
  let latestSignature: string | undefined;
  for (const candidate of candidates) {
    const signature = probabilitySignature(candidate.impliedProbabilities);
    if (signature === latestSignature) {
      continue;
    }
    result.push(candidate);
    latestSignature = signature;
  }
  return result;
}

export function buildCuratedMatchDefinition(
  options: BuildCuratedMatchOptions
): MatchDefinition {
  const publicFixtureId = options.publicFixtureId.trim();
  const publicLabel = options.publicLabel.trim();
  if (publicFixtureId === "" || publicLabel === "") {
    throw new CuratedReplayError(
      "CURATED_PUBLIC_IDENTITY_INVALID",
      "The public fixture identifier and label must be non-empty."
    );
  }
  if (
    !Number.isSafeInteger(options.durationMinutes) ||
    options.durationMinutes <= 0 ||
    options.durationMinutes > MAX_CURATED_DURATION_MINUTES
  ) {
    throw new CuratedReplayError(
      "CURATED_DURATION_INVALID",
      `The curated replay duration must be between 1 and ${MAX_CURATED_DURATION_MINUTES} minutes.`
    );
  }

  const scores = scoreEntries(
    options.scoreRecords,
    options.fixture.startTimestamp
  );
  const odds = oddsEntries(options.oddsRecords, options.fixture.startTimestamp);
  const records: MatchRecord[] = [];
  let scoreSequence = 0;
  let scoreIndex = 0;
  for (const entry of scores) {
    scoreSequence += 1;
    scoreIndex += 1;
    const recordId = `curated-score-${String(scoreIndex).padStart(4, "0")}`;
    const shared = {
      fixtureId: publicFixtureId,
      recordId,
      sourceTimestamp: entry.sourceTimestamp,
      receivedTimestamp: entry.sourceTimestamp,
      provenance: "TXLINE" as const,
      sourceOrder: localSourceOrder(
        "TXLINE_SCORES",
        recordId,
        entry.sourceTimestamp,
        scoreSequence
      )
    };
    if (entry.kind === "recovery") {
      records.push({
        ...shared,
        kind: "recovery",
        recoveryReason: "Curated TxLINE historical score baseline",
        snapshot: {
          score: { ...entry.score },
          ...(entry.impliedProbabilities === undefined
            ? {}
            : { impliedProbabilities: { ...entry.impliedProbabilities } })
        }
      });
    } else {
      records.push({
        ...shared,
        kind: "event",
        eventType: entry.eventType,
        minute: entry.minute,
        ...(entry.team === undefined ? {} : { team: entry.team })
      });
    }
  }

  let oddsIndex = 0;
  for (const entry of odds) {
    oddsIndex += 1;
    const recordId = `curated-odds-${String(oddsIndex).padStart(4, "0")}`;
    records.push({
      fixtureId: publicFixtureId,
      recordId,
      sourceTimestamp: entry.sourceTimestamp,
      receivedTimestamp: entry.sourceTimestamp,
      provenance: "TXLINE",
      sourceOrder: localSourceOrder(
        "TXLINE_ODDS",
        recordId,
        entry.sourceTimestamp
      ),
      kind: "odds",
      impliedProbabilities: { ...entry.impliedProbabilities }
    });
  }

  records.sort(compareMatchRecords);
  const configuredLiveEdge =
    options.fixture.startTimestamp + options.durationMinutes * MINUTE_MS;
  const observedLiveEdge = Math.max(
    options.fixture.startTimestamp,
    ...records.map((record) => record.sourceTimestamp)
  );
  const match: MatchDefinition = {
    fixtureId: publicFixtureId,
    label: publicLabel,
    provenance: "TXLINE",
    kickoffTimestamp: options.fixture.startTimestamp,
    liveEdgeTimestamp: Math.max(configuredLiveEdge, observedLiveEdge),
    records
  };
  validateCuratedReplayMatch(match);
  return match;
}

export function validateCuratedReplayMatch(match: MatchDefinition): void {
  if (
    match.provenance !== "TXLINE" ||
    match.fixtureId.trim() === "" ||
    match.label.trim() === "" ||
    !Number.isSafeInteger(match.kickoffTimestamp) ||
    !Number.isSafeInteger(match.liveEdgeTimestamp) ||
    match.liveEdgeTimestamp < match.kickoffTimestamp ||
    match.records.length === 0
  ) {
    throw new CuratedReplayError(
      "CURATED_ARTIFACT_INVALID",
      "The curated match definition failed its top-level allowlist validation."
    );
  }

  const ids = new Set<string>();
  let expectedScoreSequence = 1;
  let scoreBaselineObserved = false;
  for (const record of match.records) {
    if (
      record.fixtureId !== match.fixtureId ||
      record.provenance !== "TXLINE" ||
      record.sourceTimestamp < match.kickoffTimestamp ||
      record.sourceTimestamp > match.liveEdgeTimestamp ||
      record.receivedTimestamp !== record.sourceTimestamp ||
      ids.has(record.recordId) ||
      record.sourceOrder === undefined ||
      !record.sourceOrder.tieBreaker.startsWith("curated:") ||
      !record.sourceOrder.payloadIdentity.startsWith("curated-") ||
      record.sourceOrder.sourceMessageId !== undefined ||
      record.sourceOrder.sseEventId !== undefined
    ) {
      throw new CuratedReplayError(
        "CURATED_ARTIFACT_INVALID",
        "A curated record failed provider-identifier or timestamp validation."
      );
    }
    ids.add(record.recordId);

    if (record.sourceOrder.domain === "TXLINE_SCORES") {
      if (record.sourceOrder.sourceSequence !== expectedScoreSequence) {
        throw new CuratedReplayError(
          "CURATED_SCORE_SEQUENCE_INVALID",
          "Curated score records were not renumbered into one contiguous local sequence."
        );
      }
      expectedScoreSequence += 1;
      if (!scoreBaselineObserved) {
        if (record.kind !== "recovery") {
          throw new CuratedReplayError(
            "CURATED_BASELINE_MISSING",
            "The first curated score-domain record must be a recovery baseline."
          );
        }
        scoreBaselineObserved = true;
      }
    }

    if (record.kind === "recovery") {
      if (!validScore(record.snapshot.score)) {
        throw new CuratedReplayError(
          "CURATED_SCORE_INVALID",
          "A curated recovery score was invalid."
        );
      }
      const probabilities = record.snapshot.impliedProbabilities;
      if (probabilities !== undefined && !validProbabilityTriple(probabilities)) {
        throw new CuratedReplayError(
          "CURATED_ODDS_INVALID",
          "A curated recovery probability triple was invalid."
        );
      }
    } else if (record.kind === "odds") {
      if (!validProbabilityTriple(record.impliedProbabilities)) {
        throw new CuratedReplayError(
          "CURATED_ODDS_INVALID",
          "A curated odds probability triple was invalid."
        );
      }
    } else if (
      record.eventType === "GOAL" &&
      record.team !== "HOME" &&
      record.team !== "AWAY"
    ) {
      throw new CuratedReplayError(
        "CURATED_GOAL_TEAM_MISSING",
        "A curated goal had no trusted home or away side."
      );
    }
  }

  if (!scoreBaselineObserved) {
    throw new CuratedReplayError(
      "CURATED_BASELINE_MISSING",
      "The curated match did not contain a score-domain recovery baseline."
    );
  }
}

export function renderCuratedReplayModule(match: MatchDefinition): string {
  validateCuratedReplayMatch(match);
  return [
    'import type { MatchDefinition } from "../core/types.js";',
    "",
    "/**",
    " * Generated by the authenticated curated completed-match exporter.",
    " * Contains only the allowlisted MatchShift product model: no raw payload,",
    " * provider fixture/message identifiers, credentials, or downloadable feed.",
    " */",
    `export const CURATED_REAL_MATCH: MatchDefinition = ${JSON.stringify(match, null, 2)};`,
    ""
  ].join("\n");
}
