import type { MatchRecord } from "../core/types.js";
import { RICH_EVENT_CHUNK_1 } from "./curated-rich-events-1.js";
import { RICH_EVENT_CHUNK_2 } from "./curated-rich-events-2.js";
import { RICH_EVENT_CHUNK_3 } from "./curated-rich-events-3.js";
import { RICH_EVENT_CHUNK_4 } from "./curated-rich-events-4.js";
import { RICH_EVENT_CHUNK_5 } from "./curated-rich-events-5.js";
import { RICH_EVENT_CHUNK_6 } from "./curated-rich-events-6.js";
import { RICH_EVENT_CHUNK_7 } from "./curated-rich-events-7.js";
import type { RichEventTuple } from "./curated-rich-event-types.js";

const FIXTURE_ID = "spain-argentina-2026-07-19";
const KICKOFF_TIMESTAMP = 1_784_487_900_000;

const EVENT_SPECS: readonly RichEventTuple[] = [
  ...RICH_EVENT_CHUNK_1,
  ...RICH_EVENT_CHUNK_2,
  ...RICH_EVENT_CHUNK_3,
  ...RICH_EVENT_CHUNK_4,
  ...RICH_EVENT_CHUNK_5,
  ...RICH_EVENT_CHUNK_6,
  ...RICH_EVENT_CHUNK_7
];

function sourceOrder(
  recordId: string,
  sourceTimestamp: number,
  sourceSequence: number
) {
  return {
    domain: "TXLINE_SCORES" as const,
    tieBreaker: [
      "curated",
      "TXLINE_SCORES",
      String(sourceTimestamp).padStart(16, "0"),
      String(sourceSequence).padStart(16, "0"),
      recordId
    ].join(":"),
    payloadIdentity: recordId,
    sourceSequence
  };
}

const records: MatchRecord[] = [];
let sequence = 0;

function nextRecordId(): string {
  return `curated-rich-score-${String(sequence).padStart(4, "0")}`;
}

function pushBaseline(
  score: { home: number; away: number },
  reason: string,
  timelineSeconds: number
): void {
  sequence += 1;
  const recordId = nextRecordId();
  const sourceTimestamp = KICKOFF_TIMESTAMP + timelineSeconds * 1_000;
  records.push({
    fixtureId: FIXTURE_ID,
    recordId,
    sourceTimestamp,
    receivedTimestamp: sourceTimestamp,
    provenance: "TXLINE",
    sourceOrder: sourceOrder(recordId, sourceTimestamp, sequence),
    kind: "recovery",
    recoveryReason: reason,
    snapshot: { score }
  });
}

function pushEvent(spec: RichEventTuple): void {
  const [
    activityType,
    timelineSeconds,
    minute,
    clockLabel,
    label,
    importance,
    category,
    team,
    detail,
    outcome
  ] = spec;
  sequence += 1;
  const recordId = nextRecordId();
  const sourceTimestamp = KICKOFF_TIMESTAMP + timelineSeconds * 1_000;
  records.push({
    fixtureId: FIXTURE_ID,
    recordId,
    sourceTimestamp,
    receivedTimestamp: sourceTimestamp,
    provenance: "TXLINE",
    sourceOrder: sourceOrder(recordId, sourceTimestamp, sequence),
    kind: "event",
    eventType: activityType === "GOAL" ? "GOAL" : "KICKOFF",
    activityType,
    minute,
    clockLabel,
    label,
    importance,
    category,
    ...(team === null ? {} : { team }),
    ...(detail === null ? {} : { detail }),
    ...(outcome === null ? {} : { outcome })
  });
}

pushBaseline(
  { home: 0, away: 0 },
  "Curated TxLINE historical score baseline",
  0
);
for (const spec of EVENT_SPECS) {
  if (spec[0] === "MATCH_FINAL") {
    pushBaseline(
      { home: 1, away: 0 },
      "Curated TxLINE completed-match final score",
      spec[1]
    );
  }
  pushEvent(spec);
}

/**
 * Rich allowlisted timeline derived from the private authenticated TxLINE capture.
 * Provider identifiers, raw payloads, dates of birth and connection metadata are
 * deliberately absent. Repeated, unconfirmed and discarded actions are collapsed.
 */
export const RICH_CURATED_SCORE_RECORDS: readonly MatchRecord[] = records;
