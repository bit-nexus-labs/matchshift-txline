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

export function recordsVisibleAtCursor(
  records: readonly MatchRecord[],
  cursorMs: number
): MatchRecord[] {
  return records.filter((record) => isRecordVisible(record, cursorMs));
}
