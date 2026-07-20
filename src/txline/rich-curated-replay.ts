import {
  MATCH_EVENT_TYPES,
  type MatchDefinition,
  type MatchEventImportance,
  type MatchEventRecord,
  type MatchPhase,
  type MatchRecord,
  type TeamSide
} from "../core/types.js";
import {
  buildCuratedMatchDefinition,
  validateCuratedReplayMatch,
  type BuildCuratedMatchOptions
} from "./curated-replay.js";
import {
  normalizeScorePayload,
  type NormalizationResult,
  type NormalizeRecordOptions
} from "./normalizer.js";

type UnknownRecord = Record<string, unknown>;

const MATCH_PHASES = new Set<MatchPhase>([
  "PRE_MATCH",
  "FIRST_HALF",
  "HALF_TIME",
  "SECOND_HALF",
  "EXTRA_TIME_FIRST_HALF",
  "EXTRA_TIME_BREAK",
  "EXTRA_TIME_SECOND_HALF",
  "FINISHED"
]);

interface SanitizedDerivedEvent {
  eventType: MatchEventRecord["eventType"];
  team?: TeamSide;
  matchSecond: number;
  label: string;
  importance: MatchEventImportance;
  phase: MatchPhase;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function malformedDerivedEvent(
  fixtureId?: string,
  sequence?: number
): NormalizationResult {
  return {
    records: [],
    issues: [
      {
        code: "MALFORMED_SCORE",
        message: "A MatchShift-derived rich event failed allowlist validation.",
        ...(fixtureId === undefined ? {} : { fixtureId }),
        ...(sequence === undefined ? {} : { sequence })
      }
    ],
    diagnostics: [],
    disconnected: false,
    safeHold: true
  };
}

function derivedEvent(
  value: unknown
): { present: false } | { present: true; event?: SanitizedDerivedEvent } {
  const source = asRecord(value);
  const derived = asRecord(source?.MatchShiftDerived);
  if (derived === undefined || !("RichEvent" in derived)) {
    return { present: false };
  }
  const rich = asRecord(derived.RichEvent);
  if (rich === undefined) {
    return { present: true };
  }

  const eventType =
    typeof rich.eventType === "string" &&
    MATCH_EVENT_TYPES.includes(
      rich.eventType as (typeof MATCH_EVENT_TYPES)[number]
    )
      ? (rich.eventType as MatchEventRecord["eventType"])
      : undefined;
  const team =
    rich.team === "HOME" || rich.team === "AWAY"
      ? (rich.team as TeamSide)
      : rich.team === undefined
        ? undefined
        : null;
  const matchSecond = rich.matchSecond;
  const label =
    typeof rich.label === "string" &&
    rich.label.trim() !== "" &&
    rich.label.trim().length <= 120
      ? rich.label.trim()
      : undefined;
  const importance =
    rich.importance === "KEY" || rich.importance === "FULL"
      ? (rich.importance as MatchEventImportance)
      : undefined;
  const phase =
    typeof rich.phase === "string" && MATCH_PHASES.has(rich.phase as MatchPhase)
      ? (rich.phase as MatchPhase)
      : undefined;

  if (
    eventType === undefined ||
    team === null ||
    !Number.isSafeInteger(matchSecond) ||
    (matchSecond as number) < 0 ||
    (matchSecond as number) > 5 * 60 * 60 ||
    label === undefined ||
    importance === undefined ||
    phase === undefined
  ) {
    return { present: true };
  }

  return {
    present: true,
    event: {
      eventType,
      ...(team === undefined ? {} : { team }),
      matchSecond: matchSecond as number,
      label,
      importance,
      phase
    }
  };
}

export function normalizeCuratedScorePayload(
  value: unknown,
  options: NormalizeRecordOptions = {}
): NormalizationResult {
  if (options.snapshot === true) {
    return normalizeScorePayload(value, options);
  }

  const parsed = derivedEvent(value);
  if (!parsed.present) {
    return normalizeScorePayload(value, options);
  }

  const source = asRecord(value) ?? {};
  const fixtureId =
    typeof (source.FixtureId ?? source.fixtureId) === "string"
      ? String(source.FixtureId ?? source.fixtureId)
      : undefined;
  const sequenceValue = source.Seq ?? source.seq;
  const sequence =
    typeof sequenceValue === "number" && Number.isSafeInteger(sequenceValue)
      ? sequenceValue
      : undefined;
  if (parsed.event === undefined) {
    return malformedDerivedEvent(fixtureId, sequence);
  }

  const hydrated = normalizeScorePayload(value, {
    ...options,
    snapshot: true
  });
  if (hydrated.safeHold || hydrated.issues.length > 0) {
    return hydrated;
  }
  const recovery = hydrated.records.find(
    (record) => record.kind === "recovery"
  );
  if (recovery === undefined) {
    return malformedDerivedEvent(fixtureId, sequence);
  }

  const event: MatchEventRecord = {
    fixtureId: recovery.fixtureId,
    recordId: recovery.recordId,
    sourceTimestamp: recovery.sourceTimestamp,
    receivedTimestamp: recovery.receivedTimestamp,
    provenance: recovery.provenance,
    ...(recovery.sequence === undefined ? {} : { sequence: recovery.sequence }),
    ...(recovery.sourceOrder === undefined
      ? {}
      : { sourceOrder: recovery.sourceOrder }),
    kind: "event",
    eventType: parsed.event.eventType,
    ...(parsed.event.team === undefined ? {} : { team: parsed.event.team }),
    minute:
      parsed.event.eventType === "KICKOFF"
        ? 0
        : Math.floor(parsed.event.matchSecond / 60) + 1,
    matchSecond: parsed.event.matchSecond,
    label: parsed.event.label,
    importance: parsed.event.importance,
    phase: parsed.event.phase
  };

  return {
    records: [event],
    issues: [],
    diagnostics: [],
    disconnected: false,
    safeHold: false
  };
}

function eventSignature(record: MatchEventRecord): string {
  return [
    record.eventType,
    record.sourceTimestamp,
    record.minute,
    record.team ?? "NONE"
  ].join(":");
}

export function buildRichCuratedMatchDefinition(
  options: BuildCuratedMatchOptions
): MatchDefinition {
  const match = buildCuratedMatchDefinition(options);
  const metadata = new Map<string, MatchEventRecord[]>();
  for (const record of options.scoreRecords) {
    if (record.kind !== "event") {
      continue;
    }
    const key = eventSignature(record);
    const queue = metadata.get(key) ?? [];
    queue.push(record);
    metadata.set(key, queue);
  }

  const records: MatchRecord[] = match.records.map((record) => {
    if (record.kind !== "event") {
      return record;
    }
    const queue = metadata.get(eventSignature(record));
    const source = queue?.shift();
    if (source === undefined) {
      return record;
    }
    return {
      ...record,
      ...(source.matchSecond === undefined
        ? {}
        : { matchSecond: source.matchSecond }),
      ...(source.label === undefined ? {} : { label: source.label }),
      ...(source.importance === undefined
        ? {}
        : { importance: source.importance }),
      ...(source.phase === undefined ? {} : { phase: source.phase })
    };
  });

  const enriched: MatchDefinition = { ...match, records };
  validateCuratedReplayMatch(enriched);
  return enriched;
}
