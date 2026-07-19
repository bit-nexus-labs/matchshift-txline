import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { TxlineHttpClient } from "../src/txline/http-client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("TxLINE historical HTTP helpers", () => {
  it("uses documented fixture, score-history, and odds asOf paths", async () => {
    const calls: string[] = [];
    const responses = [
      jsonResponse({ token: "jwt" }),
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse([])
    ];
    const fetchFn: FetchLike = async (input) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Unexpected mocked fetch call.");
      }
      return response;
    };
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn
    });

    await client.fetchFixturesSnapshotForDay(20_280, 72);
    await client.fetchScoresHistorical(991_001);
    await client.fetchOddsSnapshotAt(991_001, 1_784_000_000_000);

    expect(calls[1]).toBe(
      "https://txline.txodds.com/api/fixtures/snapshot?startEpochDay=20280&competitionId=72"
    );
    expect(calls[2]).toBe(
      "https://txline.txodds.com/api/scores/historical/991001"
    );
    expect(calls[3]).toBe(
      "https://txline.txodds.com/api/odds/snapshot/991001?asOf=1784000000000"
    );
  });
});
