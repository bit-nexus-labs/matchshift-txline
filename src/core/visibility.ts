import type { MatchRecord, ViewerSession } from "./types.js";

export function effectiveVisibilityCursor(
  session: ViewerSession,
  liveEdgeTimestamp: number
): number {
  return session.mode === "LIVE"
    ? liveEdgeTimestamp
    : Math.min(session.visibilityCursor, liveEdgeTimestamp);
}

export function isRecordVisible(record: MatchRecord, cursorMs: number): boolean {
  return (
    Number.isFinite(record.sourceTimestamp) &&
    record.sourceTimestamp >= 0 &&
    record.sourceTimestamp <= cursorMs
  );
}

function fallbackTieBreaker(record: MatchRecord): string {
  const sequence = record.sequence;
  return [
    "SYNTHETIC",
    sequence === undefined ? "MISSING" : String(sequence).padStart(16, "0"),
    record.recordId
  ].join(":");
}

export function compareMatchRecords(
  left: MatchRecord,
  right: MatchRecord
): number {
  const timestampOrder = left.sourceTimestamp - right.sourceTimestamp;
  if (timestampOrder !== 0) {
    return timestampOrder;
  }

  const leftTieBreaker = left.sourceOrder?.tieBreaker ?? fallbackTieBreaker(left);
  const rightTieBreaker =
    right.sourceOrder?.tieBreaker ?? fallbackTieBreaker(right);
  return leftTieBreaker.localeCompare(rightTieBreaker);
}

export function recordsVisibleAtCursor(
  records: readonly MatchRecord[],
  cursorMs: number
): MatchRecord[] {
  return records
    .filter((record) => isRecordVisible(record, cursorMs))
    .sort(compareMatchRecords);
}
