import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import {
  collectReplayTimestamps,
  formatHistoricalOddsShapeReport,
  probeHistoricalOddsShape
} from "../src/txline/historical-odds-shape-probe.js";

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
    expect(text).not.toContain("private-team-a");
    expect(text).not.toContain("private-winner-market");
    expect(text).not.toContain("api-token");
    expect(text).not.toContain("guest-jwt");
    expect(calls[2]).toContain("asOf=1783767600000");
    expect(calls[3]).toContain("asOf=1783767660000");
  });
});
