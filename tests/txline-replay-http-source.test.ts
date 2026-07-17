import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import {
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

  it("authenticates once and accepts SSE scores plus JSON odds", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      sseResponse(
        [
          'data: {"fixtureId":18213979,"seq":1,"ts":1783767600000}',
          "",
          'data: {"fixtureId":18213979,"seq":2,"ts":1783767660000}',
          ""
        ].join("\n")
      ),
      jsonResponse([{ FixtureId: 18213979, Ts: 1783767600000 }])
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

    expect(scores).toHaveLength(2);
    expect(odds).toEqual([{ FixtureId: 18213979, Ts: 1783767600000 }]);
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
});
