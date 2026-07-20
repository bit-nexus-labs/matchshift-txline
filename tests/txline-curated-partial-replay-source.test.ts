import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { createCuratedPartialReplaySource } from "../src/txline/curated-partial-replay-source.js";

const FIXTURE_ID = "private-fixture";
const KICKOFF = Date.parse("2026-07-18T21:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(body = ""): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" }
  });
}

function scoreRecord(
  sequence: number,
  timestamp: number,
  home: number,
  away: number,
  action: string
) {
  return {
    FixtureId: FIXTURE_ID,
    MessageId: `private-score-${sequence}`,
    Seq: sequence,
    Ts: timestamp,
    Action: action,
    ScoreSoccer: {
      Participant1: { Total: { Goals: home } },
      Participant2: { Total: { Goals: away } }
    }
  };
}

describe("TxLINE curated partial replay source", () => {
  it("recovers from an empty historical SSE tail through bounded score buckets", async () => {
    const opening = scoreRecord(1, KICKOFF, 0, 0, "kickoff");
    const firstGoal = scoreRecord(
      2,
      KICKOFF + 6 * 60_000,
      1,
      0,
      "score_update"
    );
    const calls: string[] = [];
    let updateCalls = 0;

    const fetchFn: FetchLike = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push(url.toString());

      if (url.pathname === "/auth/guest/start") {
        return jsonResponse({ token: "guest-jwt" });
      }
      if (url.pathname === "/api/fixtures/snapshot") {
        return jsonResponse({
          fixtures: [
            {
              FixtureId: FIXTURE_ID,
              StartTime: KICKOFF,
              Participant1: "France",
              Participant2: "England",
              Participant1IsHome: true,
              GameState: 5
            }
          ]
        });
      }
      if (url.pathname === `/api/scores/historical/${FIXTURE_ID}`) {
        return sseResponse();
      }
      if (url.pathname.startsWith("/api/scores/updates/")) {
        updateCalls += 1;
        return updateCalls === 1
          ? jsonResponse({ scores: [opening, firstGoal] })
          : sseResponse();
      }

      throw new Error(`Unexpected mocked request path: ${url.pathname}`);
    };

    const source = createCuratedPartialReplaySource({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fallbackHistoryDurationMinutes: 10,
      fetchFn
    });

    await source.fetchFixturesSnapshot();
    const records = await source.fetchScoresHistorical(FIXTURE_ID);

    expect(records).toEqual([opening, firstGoal]);
    expect(updateCalls).toBe(3);
    expect(
      calls.filter((url) =>
        url.includes(`/api/scores/historical/${FIXTURE_ID}`)
      )
    ).toHaveLength(1);
    expect(source.getScoreCoverage()).toBeUndefined();
  });
});
