import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { extractTxlineReplayRecords, TxlineReplayHttpSource } from "../src/txline/replay-http-source.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("TxLINE path-scoped historical odds", () => {
  it("recognizes the observed historical odds shape without an embedded fixture identifier", () => {
    const oddsRecord = {
      Ts: 1_783_767_600_000,
      MessageId: "provider-message",
      SuperOddsType: "1X2",
      MarketPeriod: "Full Time",
      MarketParameters: null,
      PriceNames: ["1", "X", "2"],
      Prices: [2, 3, 4],
      Pct: [50, 30, 20]
    };

    expect(extractTxlineReplayRecords({ data: [oddsRecord] }, "odds")).toEqual([
      oddsRecord
    ]);
  });

  it("injects the requested fixture identifier before returning an odds snapshot", async () => {
    const calls: string[] = [];
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      jsonResponse({
        payload: {
          records: [
            {
              Ts: 1_783_767_600_000,
              MessageId: "provider-message",
              SuperOddsType: "1X2",
              MarketPeriod: "Full Time",
              MarketParameters: null,
              PriceNames: ["1", "X", "2"],
              Pct: [50, 30, 20]
            }
          ]
        }
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
    const source = new TxlineReplayHttpSource({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn
    });

    const odds = await source.fetchOddsSnapshotAt(
      18_213_979,
      1_783_767_600_000
    );

    expect(odds).toEqual([
      {
        FixtureId: 18_213_979,
        Ts: 1_783_767_600_000,
        MessageId: "provider-message",
        SuperOddsType: "1X2",
        MarketPeriod: "Full Time",
        MarketParameters: null,
        PriceNames: ["1", "X", "2"],
        Pct: [50, 30, 20]
      }
    ]);
    expect(calls[1]).toBe(
      "https://txline.txodds.com/api/odds/snapshot/18213979?asOf=1783767600000"
    );
  });

  it("does not mistake nested price vectors for complete odds records", () => {
    const payload = {
      Ts: 1_783_767_600_000,
      data: {
        PriceNames: ["1", "X", "2"],
        Pct: [50, 30, 20]
      }
    };

    expect(extractTxlineReplayRecords(payload, "odds")).toEqual([]);
  });
});
