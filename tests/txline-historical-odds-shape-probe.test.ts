import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import {
  classifyHistoricalOddsPayload,
  collectReplayTimestamps,
  formatHistoricalOddsShapeReport,
  probeHistoricalOddsShape
} from "../src/txline/historical-odds-shape-probe.js";
import { normalizeFixtures } from "../src/txline/normalizer.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" }
  });
}

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
    MessageId: "private-message",
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

describe("TxLINE historical odds shape probe", () => {
  it("collects ordered unique replay timestamps", () => {
    expect(
      collectReplayTimestamps([
        { Ts: 3000 },
        { wrapper: { ts: 1000 } },
        JSON.stringify({ Ts: 2000 }),
        { Ts: 3000 }
      ])
    ).toEqual([1_000_000, 2_000_000, 3_000_000]);
  });

  it("classifies the exact historical adapter and normalizer predicates", () => {
    const classification = classifyHistoricalOddsPayload(
      [
        historicalOdds({
          SuperOddsType: "private-total-market",
          MarketParameters: "2.5",
          PriceNames: ["Over", "Under"],
          Prices: [1.9, 1.9],
          Pct: [50, 50]
        }),
        historicalOdds(),
        historicalOdds({
          MessageId: "private-known-winner",
          SuperOddsType: "1X2",
          MarketPeriod: "Full Time"
        }),
        historicalOdds({
          MessageId: "private-first-half",
          MarketPeriod: "FirstHalf"
        })
      ],
      fixture()
    );

    expect(classification).toEqual({
      directRecords: 4,
      priceNamesArity2: 1,
      priceNamesArity3: 3,
      priceNamesArityOther: 0,
      marketTypePresent: 4,
      alreadySupportedWinnerMarket: 1,
      marketParametersEmpty: 3,
      marketPeriodAccepted: 3,
      explicitWinnerLabels: 3,
      adapterEligible: 1,
      adapterRewritten: 1,
      sourceNormalizedSupported: 1,
      adaptedNormalizedSupported: 2,
      adaptedIgnoredUnsupported: 2,
      adaptedMalformedSupported: 0
    });

    const text = formatHistoricalOddsShapeReport({
      snapshots: [
        {
          label: "early",
          report: {
            status: 200,
            contentType: "application/json",
            byteLength: 100,
            visitedNodes: 1,
            truncated: false,
            paths: []
          },
          classification
        }
      ]
    });
    expect(text).toContain("classification-adapter-eligible=1");
    expect(text).toContain("classification-adapted-normalized-supported=2");
    expect(text).not.toContain("private-total-market");
    expect(text).not.toContain("private-message");
  });

  it("probes early and late odds snapshots without exposing provider values", async () => {
    const calls: string[] = [];
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      sseResponse(
        [
          'data: {"FixtureId":18213979,"Seq":1,"Ts":1783767600000}',
          "",
          'data: {"FixtureId":18213979,"Seq":2,"Ts":1783767660000}',
          ""
        ].join("\n")
      ),
      jsonResponse({
        Markets: [
          {
            MarketName: "private-winner-market",
            Outcomes: [
              { Name: "private-team-a", Price: 2.1 },
              { Name: "private-draw", Price: 3.2 },
              { Name: "private-team-b", Price: 4.3 }
            ]
          }
        ]
      }),
      jsonResponse({
        Markets: [
          {
            MarketName: "private-winner-market",
            Outcomes: [
              { Name: "private-team-a", Price: 1.8 },
              { Name: "private-draw", Price: 3.5 },
              { Name: "private-team-b", Price: 5.1 }
            ]
          }
        ]
      })
    ];
    const fetchFn: FetchLike = async (input) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Unexpected mocked request.");
      }
      return response;
    };

    const report = await probeHistoricalOddsShape({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      fixtureId: 18_213_979,
      requestTimeoutMs: 5_000,
      fetchFn
    });
    const text = formatHistoricalOddsShapeReport(report);

    expect(report.snapshots).toHaveLength(2);
    expect(text).toContain("TXLINE HISTORICAL ODDS SHAPE: PASS");
    expect(text).toContain("$.Markets[].Outcomes[].Price");
    expect(text).toContain("classification-direct-records=0");
    expect(text).not.toContain("private-team-a");
    expect(text).not.toContain("private-winner-market");
    expect(text).not.toContain("api-token");
    expect(text).not.toContain("guest-jwt");
    expect(calls[2]).toContain("asOf=1783767600000");
    expect(calls[3]).toContain("asOf=1783767660000");
  });
});
