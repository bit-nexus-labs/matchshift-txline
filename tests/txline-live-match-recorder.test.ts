import { describe, expect, it } from "vitest";
import type { MatchRecord } from "../src/core/types.js";
import {
  sanitizeLiveCaptureRecord,
  selectLiveMatchFixture
} from "../src/txline/live-match-recorder.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";

const kickoff = Date.parse("2026-07-19T19:00:00.000Z");

function fixture(
  fixtureId: string,
  participant1: string,
  participant2: string,
  startTimestamp = kickoff
): NormalizedFixture {
  return {
    fixtureId,
    startTime: new Date(startTimestamp).toISOString(),
    startTimestamp,
    participant1,
    participant2,
    participant1IsHome: true,
    homeParticipant: participant1,
    awayParticipant: participant2,
    selectionState: "SELECTABLE"
  };
}

describe("continuous TxLINE live match recorder", () => {
  it("selects the exact participant pair without relying on a provider id", () => {
    const selected = selectLiveMatchFixture({
      fixtures: [
        fixture("private-other", "France", "England"),
        fixture("private-target", "Spain", "Argentina")
      ],
      sideA: "argentina",
      sideB: "SPAIN",
      now: kickoff + 5 * 60_000,
      fixtureWindowHours: 3
    });

    expect(selected.fixtureId).toBe("private-target");
  });

  it("fails closed when the configured match cannot be found", () => {
    expect(() =>
      selectLiveMatchFixture({
        fixtures: [fixture("private-other", "France", "England")],
        sideA: "Spain",
        sideB: "Argentina",
        now: kickoff,
        fixtureWindowHours: 3
      })
    ).toThrow(/No selectable TxLINE fixture matched/);
  });

  it("removes provider fixture, message, event and ordering identifiers", () => {
    const source: MatchRecord = {
      fixtureId: "private-fixture",
      recordId: "private-message",
      sourceTimestamp: kickoff + 10_000,
      receivedTimestamp: kickoff + 10_100,
      provenance: "TXLINE",
      sourceOrder: {
        domain: "TXLINE_ODDS",
        tieBreaker: "private-order",
        payloadIdentity: "private-payload",
        sourceMessageId: "private-message-id",
        sseEventId: "private-sse-id"
      },
      kind: "odds",
      impliedProbabilities: {
        homeWin: 0.4,
        draw: 0.3,
        awayWin: 0.3
      }
    };

    const sanitized = sanitizeLiveCaptureRecord(source, 1, "stream");
    const text = JSON.stringify(sanitized);

    expect(sanitized).toEqual({
      type: "record",
      captureSequence: 1,
      captureOrigin: "stream",
      domain: "odds",
      kind: "odds",
      sourceTimestamp: kickoff + 10_000,
      impliedProbabilities: {
        homeWin: 0.4,
        draw: 0.3,
        awayWin: 0.3
      }
    });
    expect(text).not.toContain("private-fixture");
    expect(text).not.toContain("private-message");
    expect(text).not.toContain("private-order");
    expect(text).not.toContain("private-payload");
    expect(text).not.toContain("private-sse-id");
  });

  it("preserves allowlisted score and event semantics", () => {
    const recovery: MatchRecord = {
      fixtureId: "private-fixture",
      recordId: "private-score",
      sourceTimestamp: kickoff + 60_000,
      receivedTimestamp: kickoff + 60_100,
      provenance: "TXLINE",
      kind: "recovery",
      recoveryReason: "private reason",
      snapshot: { score: { home: 1, away: 0 } }
    };
    const goal: MatchRecord = {
      fixtureId: "private-fixture",
      recordId: "private-goal",
      sourceTimestamp: kickoff + 61_000,
      receivedTimestamp: kickoff + 61_100,
      provenance: "TXLINE",
      kind: "event",
      eventType: "GOAL",
      team: "HOME",
      minute: 1
    };

    expect(sanitizeLiveCaptureRecord(recovery, 1, "baseline")).toMatchObject({
      domain: "scores",
      kind: "recovery",
      score: { home: 1, away: 0 }
    });
    expect(sanitizeLiveCaptureRecord(goal, 2, "stream")).toMatchObject({
      domain: "scores",
      kind: "event",
      eventType: "GOAL",
      team: "HOME",
      minute: 1
    });
  });
});
