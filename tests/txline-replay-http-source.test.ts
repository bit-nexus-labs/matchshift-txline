import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import {
  extractTxlineReplayRecords,
  parseTxlineReplayResponse,
  TxlineReplayHttpSource
} from "../src/txline/replay-http-source.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" }
  });
}

function soccerScore(home = 0, away = 0) {
  return {
    Participant1: { Total: { Goals: home } },
    Participant2: { Total: { Goals: away } }
  };
}

describe("TxLINE replay HTTP source", () => {
  it("parses heartbeat-safe SSE frames and flattens array payloads", () => {
    const body = [
      ": heartbeat",
      "",
      "event: score",
      'data: {"seq":1,"action":"kickoff"}',
      "",
      'data: [{"seq":2,"action":"goal"},{"seq":3,"action":"score_update"}]',
      "",
      "data: [DONE]",
      ""
    ].join("\n");

    expect(
      parseTxlineReplayResponse(body, {
        status: 200,
        contentType: "text/event-stream; charset=utf-8"
      })
    ).toEqual([
      { seq: 1, action: "kickoff" },
      { seq: 2, action: "goal" },
      { seq: 3, action: "score_update" }
    ]);
  });

  it("supports multi-line SSE data fields", () => {
    const body = [
      "event: score",
      'data: {"seq":1,',
      'data: "action":"kickoff"}',
      ""
    ].join("\n");

    expect(
      parseTxlineReplayResponse(body, {
        status: 200,
        contentType: "text/event-stream"
      })
    ).toEqual([{ seq: 1, action: "kickoff" }]);
  });

  it("unwraps object envelopes and nested JSON strings without collecting child totals", () => {
    const scoreRecord = {
      fixtureId: 18_213_979,
      seq: 9,
      ts: 1_783_767_600_000,
      action: "score_update",
      scoreSoccer: soccerScore(1, 0)
    };
    const payload = {
      event: "historical_scores",
      message: JSON.stringify({ payload: { records: [scoreRecord] } })
    };

    expect(extractTxlineReplayRecords(payload, "scores")).toEqual([scoreRecord]);
  });

  it("extracts only direct TxLINE odds records from nested replay envelopes", () => {
    const oddsRecord = {
      FixtureId: 18_213_979,
      Ts: 1_783_767_600_000,
      SuperOddsType: "1X2",
      PriceNames: ["1", "X", "2"],
      Prices: [2, 3, 4]
    };
    const payload = [{ wrapper: { data: JSON.stringify([oddsRecord]) } }];

    expect(extractTxlineReplayRecords(payload, "odds")).toEqual([oddsRecord]);
  });

  it("keeps malformed SSE bodies out of diagnostics", () => {
    const privateBody = "data: {private-provider-payload}\n\n";
    const error = (() => {
      try {
        parseTxlineReplayResponse(privateBody, {
          status: 200,
          contentType: "text/event-stream"
        });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe("INVALID_SSE_JSON");
    expect((error as Error).message).toContain("status 200");
    expect((error as Error).message).toContain(
      "content-type text/event-stream"
    );
    expect((error as Error).message).not.toContain(privateBody);
    expect((error as Error).message).not.toContain("private-provider-payload");
  });

  it("authenticates once and accepts nested SSE scores plus JSON odds", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const firstScore = {
      fixtureId: 18_213_979,
      seq: 1,
      ts: 1_783_767_600_000,
      action: "kickoff",
      scoreSoccer: soccerScore()
    };
    const secondScore = {
      fixtureId: 18_213_979,
      seq: 2,
      ts: 1_783_767_660_000,
      action: "score_update",
      scoreSoccer: soccerScore(1, 0)
    };
    const oddsRecord = {
      FixtureId: 18_213_979,
      Ts: 1_783_767_600_000,
      SuperOddsType: "1X2",
      PriceNames: ["1", "X", "2"],
      Prices: [2, 3, 4]
    };
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      sseResponse(
        [
          `data: ${JSON.stringify({ payload: JSON.stringify(firstScore) })}`,
          "",
          `data: ${JSON.stringify({ data: { records: [secondScore] } })}`,
          ""
        ].join("\n")
      ),
      jsonResponse({ data: [oddsRecord] })
    ];
    const fetchFn: FetchLike = async (input, init) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        headers: new Headers(init?.headers)
      });
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

    const scores = await source.fetchScoresHistorical(18_213_979);
    const odds = await source.fetchOddsSnapshotAt(
      18_213_979,
      1_783_767_600_000
    );

    expect(scores).toEqual([firstScore, secondScore]);
    expect(odds).toEqual([oddsRecord]);
    expect(calls[0]?.url).toBe(
      "https://txline.txodds.com/auth/guest/start"
    );
    expect(calls[1]?.url).toBe(
      "https://txline.txodds.com/api/scores/historical/18213979"
    );
    expect(calls[2]?.url).toBe(
      "https://txline.txodds.com/api/odds/snapshot/18213979?asOf=1783767600000"
    );
    expect(calls[1]?.headers.get("Authorization")).toBe("Bearer guest-jwt");
    expect(calls[1]?.headers.get("X-Api-Token")).toBe("api-token");
    expect(calls[2]?.headers.get("Authorization")).toBe("Bearer guest-jwt");
  });

  it("reports a redacted structural error when no score records can be unwrapped", async () => {
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      sseResponse('data: {"private":"provider-value"}\n\n')
    ];
    const fetchFn: FetchLike = async () => {
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

    const error = await source.fetchScoresHistorical(18_213_979).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe("SCORE_RECORDS_MISSING");
    expect((error as Error).message).not.toContain("provider-value");
  });
});
