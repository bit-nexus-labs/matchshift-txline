import { describe, expect, it } from "vitest";
import type { MatchRecord } from "../src/core/types.js";
import {
  isRecordVisible,
  recordsVisibleAtCursor
} from "../src/core/visibility.js";
import {
  SYNTHETIC_RECORDS,
  T0
} from "../src/replay/synthetic-scenario.js";

describe("visibility filtering", () => {
  it("returns only records at or before the personal cursor", () => {
    const visible = recordsVisibleAtCursor(SYNTHETIC_RECORDS, T0 + 43 * 60_000);

    expect(visible.map((record) => record.sequence)).toEqual([1, 2]);
    expect(
      visible.some(
        (record) => record.kind === "event" && record.eventType === "GOAL"
      )
    ).toBe(false);
  });

  it("withholds records with invalid source time", () => {
    const invalid = {
      ...SYNTHETIC_RECORDS[0],
      recordId: "invalid-time",
      sourceTimestamp: Number.NaN
    } as MatchRecord;

    expect(isRecordVisible(invalid, T0 + 60_000)).toBe(false);
  });
});
