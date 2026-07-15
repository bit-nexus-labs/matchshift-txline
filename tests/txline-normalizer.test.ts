import { describe, expect, it } from "vitest";
import {
  normalizeFixtures,
  normalizeOddsPayload,
  normalizePayloads,
  normalizeScorePayload
} from "../src/txline/normalizer.js";

function fixture(participant1IsHome = true) {
  const normalized = normalizeFixtures([
    {
      FixtureId: 101,
      StartTime: "2026-07-15T18:00:00.000Z",
      Participant1: "Alpha",
      Participant2: "Beta",
      Participant1IsHome: participant1IsHome,
      GameState: 1
    }
  ])[0];
  if (normalized === undefined) {
    throw new Error("Expected fixture normalization.");
  }
  return normalized;
}

function officialOdds(overrides: Record<string, unknown> = {}) {
  return {
    FixtureId: 101,
    MessageId: "odds-message-1",
    Ts: 1_784_140_000,
    Bookmaker: "ExampleBook",
    BookmakerId: 7,
    SuperOddsType: "1X2",
    GameState: "InPlay",
    InRunning: true,
    MarketParameters: "",
    MarketPeriod: "FullTime",
    PriceNames: ["1", "X", "2"],
    Prices: [2100, 3200, 3600],
    Pct: [47.6, 31.2, 27.8],
    ...overrides
  };
}

function officialScore(overrides: Record<string, unknown> = {}) {
  return {
    fixtureId: 101,
    action: "goal",
    ts: 1_784_140_100,
    seq: 41,
    scoreSoccer: {
      Participant1: { Total: { Goals: 1 } },
      Participant2: { Total: { Goals: 0 } }
    },
    dataSoccer: {
      Participant: "Participant1",
      Minutes: 49
    },
    ...overrides
  };
}

describe("TxLINE official-schema normalizer", () => {
  it("normalizes official 1X2 odds without inventing a source sequence", () => {
    const normalized = normalizeOddsPayload(officialOdds(), {
      fixture: fixture(false),
      receivedTimestamp: 1_784_140_001_000
    });

    expect(normalized.safeHold).toBe(false);
    expect(normalized.records).toHaveLength(1);
    expect(normalized.records[0]).toMatchObject({
      fixtureId: "101",
      recordId: "odds-message-1",
      sourceTimestamp: 1_784_140_000_000,
      provenance: "TXLINE",
      kind: "odds",
      sourceOrder: {
        domain: "TXLINE_ODDS",
        sourceMessageId: "odds-message-1"
      }
    });
    expect(normalized.records[0]?.sequence).toBeUndefined();
    expect(normalized.records[0]?.kind).toBe("odds");
    if (normalized.records[0]?.kind === "odds") {
      expect(normalized.records[0].impliedProbabilities.homeWin).toBeCloseTo(
        27.8 / 106.6
      );
      expect(normalized.records[0].impliedProbabilities.awayWin).toBeCloseTo(
        47.6 / 106.6
      );
    }
  });

  it("uses SSE id when MessageId is absent and derives probabilities from Prices", () => {
    const normalized = normalizeOddsPayload(
      officialOdds({ MessageId: undefined, Pct: undefined }),
      { fixture: fixture(), eventId: "sse-odds-9" }
    );

    expect(normalized.safeHold).toBe(false);
    expect(normalized.records[0]).toMatchObject({
      recordId: "sse-odds-9",
      sourceOrder: {
        domain: "TXLINE_ODDS",
        sseEventId: "sse-odds-9"
      }
    });
  });

  it("ignores unsupported odds markets without poisoning score state", () => {
    const normalized = normalizeOddsPayload(
      officialOdds({ SuperOddsType: "Total", MarketParameters: "2.5" }),
      { fixture: fixture() }
    );

    expect(normalized.safeHold).toBe(false);
    expect(normalized.records).toEqual([]);
    expect(normalized.diagnostics[0]?.code).toBe(
      "IGNORED_UNSUPPORTED_ODDS_MARKET"
    );
  });

  it("fails closed for malformed fields in a claimed supported market", () => {
    const normalized = normalizeOddsPayload(
      officialOdds({ PriceNames: ["1", "X"], Pct: [50, 50] }),
      { fixture: fixture() }
    );

    expect(normalized.safeHold).toBe(true);
    expect(normalized.records).toEqual([]);
    expect(normalized.issues[0]?.code).toBe("MALFORMED_SUPPORTED_MARKET");
  });

  it("parses nested scoreSoccer and dataSoccer while preserving score seq and ts", () => {
    const normalized = normalizeScorePayload(officialScore(), {
      fixture: fixture(false),
      receivedTimestamp: 1_784_140_101_000
    });

    expect(normalized.safeHold).toBe(false);
    expect(normalized.records[0]).toMatchObject({
      fixtureId: "101",
      sourceTimestamp: 1_784_140_100_000,
      provenance: "TXLINE",
      kind: "event",
      eventType: "GOAL",
      team: "AWAY",
      minute: 49,
      sourceOrder: {
        domain: "TXLINE_SCORES",
        sourceSequence: 41
      }
    });
    expect(normalized.records[0]?.sequence).toBeUndefined();
  });

  it("hydrates only the latest valid nested score baseline without requiring contiguous history", () => {
    const normalized = normalizePayloads(
      [
        {
          fixtureId: 101,
          action: "lineups"
        },
        officialScore({
          action: "period_update",
          seq: 38,
          ts: 1_784_140_050,
          scoreSoccer: {
            Participant1: { Total: { Goals: 0 } },
            Participant2: { Total: { Goals: 0 } }
          }
        }),
        officialScore({
          action: "game_finalised",
          seq: 44,
          ts: 1_784_140_300,
          scoreSoccer: {
            Participant1: { Total: { Goals: 2 } },
            Participant2: { Total: { Goals: 1 } }
          }
        })
      ],
      "scores",
      { fixture: fixture(false) }
    );

    expect(normalized.safeHold).toBe(false);
    expect(normalized.diagnostics[0]?.code).toBe(
      "IGNORED_UNSUPPORTED_SCORE_ACTION"
    );
    expect(normalized.records).toHaveLength(1);
    expect(normalized.records[0]).toMatchObject({
      kind: "recovery",
      sourceOrder: { sourceSequence: 44 },
      snapshot: { score: { home: 1, away: 2 } }
    });
  });

  it("fails closed when a relevant score record lacks seq or has invalid ts", () => {
    const missingSequence = normalizeScorePayload(
      officialScore({ seq: undefined }),
      { fixture: fixture() }
    );
    const badTimestamp = normalizeScorePayload(
      officialScore({ ts: "not-a-time" }),
      { fixture: fixture() }
    );

    expect(missingSequence.safeHold).toBe(true);
    expect(missingSequence.issues[0]?.code).toBe("MISSING_SEQUENCE");
    expect(badTimestamp.safeHold).toBe(true);
    expect(badTimestamp.issues[0]?.code).toBe("INVALID_TIMESTAMP");
  });

  it("handles action=disconnected without statusId", () => {
    const score = normalizeScorePayload({ action: "disconnected" });
    const odds = normalizeOddsPayload({ action: "disconnected" });

    expect(score).toMatchObject({ disconnected: true, safeHold: false });
    expect(odds).toMatchObject({ disconnected: true, safeHold: false });
  });

  it("excludes cancelled fixtures and marks duplicate legacy fixtures ambiguous", () => {
    const fixtures = normalizeFixtures([
      {
        FixtureId: 1,
        StartTime: "2026-07-15T18:00:00.000Z",
        Participant1: "Alpha",
        Participant2: "Beta",
        Participant1IsHome: true
      },
      {
        FixtureId: 2,
        StartTime: "2026-07-15T18:00:00.000Z",
        Participant1: "Alpha",
        Participant2: "Beta",
        Participant1IsHome: true
      },
      {
        FixtureId: 3,
        StartTime: "2026-07-15T20:00:00.000Z",
        Participant1: "Gamma",
        Participant2: "Delta",
        Participant1IsHome: true,
        GameState: 6
      }
    ]);

    expect(fixtures).toHaveLength(2);
    expect(fixtures.every((item) => item.selectionState === "AMBIGUOUS")).toBe(
      true
    );
    expect(fixtures.some((item) => item.fixtureId === "3")).toBe(false);
  });
});
