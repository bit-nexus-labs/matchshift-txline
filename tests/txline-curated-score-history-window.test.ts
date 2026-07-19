import { describe, expect, it } from "vitest";
import {
  assertCompleteScoreBaseline,
  buildScoreHistoryBuckets,
  mergeDirectScoreRecords
} from "../src/txline/curated-replay-source.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { TxlineScoreHistoryWindowSource } from "../src/txline/score-history-window-source.js";

const KICKOFF = Date.parse("2026-07-18T21:00:00.000Z");
const FIXTURE_ID = "private-fixture";

const fixture: NormalizedFixture = {
  fixtureId: FIXTURE_ID,
  startTime: KICKOFF,
  startTimestamp: KICKOFF,
  participant1: "France",
  participant2: "England",
  participant1IsHome: true,
  homeParticipant: "France",
  awayParticipant: "England",
  gameState: 5,
  selectionState: "SELECTABLE"
};

function scoreRecord(
  seq: number,
  timestamp: number,
  home: number,
  away: number,
  messageId = `score-${seq}`
) {
  return {
    FixtureId: FIXTURE_ID,
    MessageId: messageId,
    action: seq === 1 ? "kickoff" : "goal",
    seq,
    ts: timestamp,
    scoreSoccer: {
      Participant1: { Total: { Goals: home } },
      Participant2: { Total: { Goals: away } }
    }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("curated full historical score recovery", () => {
  it("enumerates the public SDK five-minute score buckets in UTC", () => {
    expect(
      buildScoreHistoryBuckets(
        Date.parse("2026-07-18T21:03:00.000Z"),
        Date.parse("2026-07-18T22:06:00.000Z")
      )
    ).toEqual([
      { epochDay: 20652, hourOfDay: 21, interval: 0 },
      { epochDay: 20652, hourOfDay: 21, interval: 1 },
      { epochDay: 20652, hourOfDay: 21, interval: 2 },
      { epochDay: 20652, hourOfDay: 21, interval: 3 },
      { epochDay: 20652, hourOfDay: 21, interval: 4 },
      { epochDay: 20652, hourOfDay: 21, interval: 5 },
      { epochDay: 20652, hourOfDay: 21, interval: 6 },
      { epochDay: 20652, hourOfDay: 21, interval: 7 },
      { epochDay: 20652, hourOfDay: 21, interval: 8 },
      { epochDay: 20652, hourOfDay: 21, interval: 9 },
      { epochDay: 20652, hourOfDay: 21, interval: 10 },
      { epochDay: 20652, hourOfDay: 21, interval: 11 },
      { epochDay: 20652, hourOfDay: 22, interval: 0 },
      { epochDay: 20652, hourOfDay: 22, interval: 1 }
    ]);
  });

  it("deduplicates the fixture tail against bucket history and preserves 0-0", () => {
    const kickoff = scoreRecord(1, KICKOFF, 0, 0);
    const firstGoal = scoreRecord(2, KICKOFF + 3 * 60_000, 0, 1);
    const tail = scoreRecord(3, KICKOFF + 70 * 60_000, 1, 4);
    const records = mergeDirectScoreRecords([
      tail,
      kickoff,
      firstGoal,
      { ...tail }
    ]);

    expect(records).toHaveLength(3);
    expect(records[0]).toEqual(kickoff);
    expect(() => assertCompleteScoreBaseline(records, fixture)).not.toThrow();
  });

  it("rejects the observed last-30 tail when it starts at 1-4", () => {
    const incomplete = [scoreRecord(31, KICKOFF + 70 * 60_000, 1, 4)];
    const error = (() => {
      try {
        assertCompleteScoreBaseline(incomplete, fixture);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe("SCORE_HISTORY_INCOMPLETE");
  });

  it("uses the SDK score-update bucket endpoint with a fixture filter", async () => {
    const urls: string[] = [];
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      jsonResponse({ data: [scoreRecord(1, KICKOFF, 0, 0)] })
    ];
    const source = new TxlineScoreHistoryWindowSource({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: async (input) => {
        urls.push(String(input));
        const response = responses.shift();
        if (response === undefined) {
          throw new Error("Unexpected fetch");
        }
        return response;
      }
    });

    const records = await source.fetchBucket(20652, 21, 0, FIXTURE_ID);

    expect(records).toHaveLength(1);
    expect(urls[1]).toBe(
      "https://txline.txodds.com/api/scores/updates/20652/21/0?fixtureId=private-fixture"
    );
  });
});
