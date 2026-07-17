import { describe, expect, it } from "vitest";
import {
  adaptHistoricalOddsPayload,
  classifyHistoricalOddsStructure
} from "../src/txline/historical-odds-adapter.js";
import { normalizeFixtures, normalizeOddsPayload } from "../src/txline/normalizer.js";

function fixture() {
  const normalized = normalizeFixtures([
    {
      FixtureId: 101,
      StartTime: "2026-07-15T18:00:00.000Z",
      Participant1: "Alpha",
      Participant2: "Beta",
      Participant1IsHome: true,
      GameState: 1
    }
  ])[0];
  if (normalized === undefined) {
    throw new Error("Expected fixture normalization.");
  }
  return normalized;
}

function historicalOdds(overrides: Record<string, unknown> = {}) {
  return {
    FixtureId: 101,
    MessageId: "historical-odds-1",
    Ts: 1_784_140_000,
    SuperOddsType: "Historical full result",
    MarketParameters: null,
    MarketPeriod: null,
    PriceNames: ["1", "X", "2"],
    Prices: [2.1, 3.2, 3.6],
    Pct: [47.6, 31.2, 27.8],
    ...overrides
  };
}

describe("TxLINE historical odds structural adapter", () => {
  it("aliases an explicit full-match 1/X/2 market before normalization", () => {
    const adapted = adaptHistoricalOddsPayload(historicalOdds());
    const normalized = normalizeOddsPayload(adapted, { fixture: fixture() });

    expect(adapted).toMatchObject({
      HistoricalSourceSuperOddsType: "Historical full result",
      SuperOddsType: "1X2"
    });
    expect(normalized.safeHold).toBe(false);
    expect(normalized.records).toHaveLength(1);
    expect(normalized.records[0]).toMatchObject({
      kind: "odds",
      fixtureId: "101",
      recordId: "historical-odds-1"
    });
  });

  it("canonicalizes named sides with a middle draw without retaining team labels", () => {
    const source = historicalOdds({
      PriceNames: ["Private side A", "Draw", "Private side B"]
    });
    const classification = classifyHistoricalOddsStructure(source);
    const adapted = adaptHistoricalOddsPayload(source);
    const normalized = normalizeOddsPayload(adapted, { fixture: fixture() });

    expect(classification).toMatchObject({
      explicitWinnerLabels: false,
      namedWinnerLabels: true,
      adapterEligible: true
    });
    expect(adapted).toMatchObject({
      HistoricalSourceSuperOddsType: "Historical full result",
      SuperOddsType: "1X2",
      PriceNames: ["Home", "Draw", "Away"]
    });
    expect(JSON.stringify(adapted)).not.toContain("Private side A");
    expect(JSON.stringify(adapted)).not.toContain("Private side B");
    expect(normalized.safeHold).toBe(false);
    expect(normalized.records).toHaveLength(1);
  });

  it("does not rewrite two-outcome totals or handicaps", () => {
    const source = historicalOdds({
      SuperOddsType: "Historical total",
      MarketParameters: "2.5",
      PriceNames: ["Over", "Under"],
      Prices: [1.9, 1.9],
      Pct: [50, 50]
    });

    expect(adaptHistoricalOddsPayload(source)).toBe(source);
  });

  it("does not rewrite a three-way market outside the full-match context", () => {
    const source = historicalOdds({ MarketPeriod: "FirstHalf" });

    expect(adaptHistoricalOddsPayload(source)).toBe(source);
  });

  it("does not treat double-chance labels as a named winner market", () => {
    const source = historicalOdds({
      SuperOddsType: "Historical double chance",
      PriceNames: ["1X", "12", "X2"]
    });

    expect(classifyHistoricalOddsStructure(source)).toMatchObject({
      explicitWinnerLabels: false,
      namedWinnerLabels: false,
      adapterEligible: false
    });
    expect(adaptHistoricalOddsPayload(source)).toBe(source);
  });

  it("does not infer named sides when the draw marker is not in the middle", () => {
    const source = historicalOdds({
      PriceNames: ["Draw", "Private side A", "Private side B"]
    });

    expect(classifyHistoricalOddsStructure(source)).toMatchObject({
      explicitWinnerLabels: false,
      namedWinnerLabels: false,
      adapterEligible: false
    });
    expect(adaptHistoricalOddsPayload(source)).toBe(source);
  });

  it("leaves already supported winner markets unchanged", () => {
    const source = historicalOdds({ SuperOddsType: "1X2" });

    expect(adaptHistoricalOddsPayload(source)).toBe(source);
  });

  it("adapts arrays without changing unrelated records", () => {
    const winner = historicalOdds();
    const unrelated = historicalOdds({
      SuperOddsType: "Historical double chance",
      PriceNames: ["1X", "12", "X2"]
    });
    const adapted = adaptHistoricalOddsPayload([winner, unrelated]);

    expect(adapted).toEqual([
      expect.objectContaining({ SuperOddsType: "1X2" }),
      unrelated
    ]);
  });
});
