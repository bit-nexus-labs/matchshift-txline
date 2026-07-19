import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { createCuratedReplaySource } from "../src/txline/curated-replay-source.js";
import { TxlineHttpError } from "../src/txline/http-client.js";

const FIXTURE_ID = 18_213_979;
const FIXTURE_START = Date.parse("2026-07-18T21:00:00.000Z");
const FIRST_SCORE_TS = FIXTURE_START + 15_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function scoreRecords(): unknown[] {
  return [
    {
      FixtureId: FIXTURE_ID,
      Seq: 1,
      Ts: FIRST_SCORE_TS,
      Action: "kickoff",
      Score: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    },
    {
      FixtureId: FIXTURE_ID,
      Seq: 2,
      Ts: FIRST_SCORE_TS + 60_000,
      Action: "score_update",
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }
  ];
}

function oddsRecord(): unknown {
  return {
    MessageId: "private-odds-message",
    Ts: FIRST_SCORE_TS,
    SuperOddsType: "1X2",
    MarketParameters: null,
    MarketPeriod: "Full Time",
    PriceNames: ["Home", "Draw", "Away"],
    Pct: [45, 30, 25]
  };
}

function makeFetchQueue(responses: Response[]): {
  fetchFn: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchFn: FetchLike = async (input) => {
    urls.push(input instanceof Request ? input.url : input.toString());
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected mocked fetch call.");
    }
    return response;
  };
  return { fetchFn, urls };
}

describe("curated replay odds sampling anchor", () => {
  it("reuses the proven earliest-score timestamp and skips an empty later sample", async () => {
    const mock = makeFetchQueue([
      jsonResponse({ token: "guest-jwt" }),
      jsonResponse({ data: scoreRecords() }),
      jsonResponse({ data: [oddsRecord()] }),
      jsonResponse({ data: [] })
    ]);
    const source = createCuratedReplaySource({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    await source.fetchScoresHistorical(FIXTURE_ID);
    const anchored = await source.fetchOddsSnapshotAt(
      FIXTURE_ID,
      FIXTURE_START
    );
    const emptyLaterSample = await source.fetchOddsSnapshotAt(
      FIXTURE_ID,
      FIXTURE_START + 10 * 60_000
    );

    expect(anchored).toEqual([
      expect.objectContaining({
        FixtureId: FIXTURE_ID,
        Ts: FIRST_SCORE_TS,
        SuperOddsType: "1X2"
      })
    ]);
    expect(emptyLaterSample).toEqual([]);
    expect(mock.urls[2]).toBe(
      `https://txline.txodds.com/api/odds/snapshot/${FIXTURE_ID}?asOf=${FIRST_SCORE_TS}`
    );
    expect(mock.urls[3]).toBe(
      `https://txline.txodds.com/api/odds/snapshot/${FIXTURE_ID}?asOf=${FIXTURE_START + 10 * 60_000}`
    );
  });

  it("does not hide malformed historical odds responses", async () => {
    const mock = makeFetchQueue([
      jsonResponse({ token: "guest-jwt" }),
      jsonResponse({ data: scoreRecords() }),
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]);
    const source = createCuratedReplaySource({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    await source.fetchScoresHistorical(FIXTURE_ID);
    const error = await source
      .fetchOddsSnapshotAt(FIXTURE_ID, FIXTURE_START)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe("INVALID_JSON");
  });
});
