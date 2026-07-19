import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import {
  assertCompleteScoreProgression,
  recoverCompleteScoreHistoryFromSnapshots
} from "../src/txline/score-snapshot-recovery.js";
import { TxlineScoreSnapshotSource } from "../src/txline/score-snapshot-source.js";

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
  away: number
) {
  return {
    FixtureId: FIXTURE_ID,
    MessageId: `private-score-${seq}`,
    Seq: seq,
    Ts: timestamp,
    Action: seq === 1 ? "kickoff" : "goal",
    Score: {
      Participant1: { Total: { Goals: home } },
      Participant2: { Total: { Goals: away } }
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("historical score snapshot recovery", () => {
  it("uses the official score snapshot asOf endpoint and bounded decoder", async () => {
    const urls: string[] = [];
    const responses = [
      jsonResponse({ token: "guest-jwt" }),
      jsonResponse({ data: [scoreRecord(1, KICKOFF, 0, 0)] })
    ];
    const source = new TxlineScoreSnapshotSource({
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

    const records = await source.fetchSnapshotAt(
      FIXTURE_ID,
      KICKOFF + 30_000
    );

    expect(records).toHaveLength(1);
    expect(urls[1]).toBe(
      `https://txline.txodds.com/api/scores/snapshot/${FIXTURE_ID}?asOf=${KICKOFF + 30_000}`
    );
  });

  it("adaptively resolves two score changes inside one coarse interval", async () => {
    const timeline = [
      scoreRecord(1, KICKOFF, 0, 0),
      scoreRecord(2, KICKOFF + 3 * 60_000, 0, 1),
      scoreRecord(3, KICKOFF + 4 * 60_000, 0, 2),
      scoreRecord(4, KICKOFF + 7 * 60_000, 1, 2)
    ];
    const requested: number[] = [];

    const records = await recoverCompleteScoreHistoryFromSnapshots({
      fixtureId: FIXTURE_ID,
      fixture,
      startTimestamp: KICKOFF,
      endTimestamp: KICKOFF + 10 * 60_000,
      baseRecords: [timeline.at(-1)!],
      fetchSnapshotAt: async (_fixtureId, asOf) => {
        requested.push(asOf);
        const latest = timeline.filter((record) => record.Ts <= asOf).at(-1);
        if (latest === undefined) {
          throw new TxlineHttpError(
            "SCORE_SNAPSHOT_RECORDS_MISSING",
            "No score snapshot yet."
          );
        }
        return [latest];
      }
    });

    expect(() => assertCompleteScoreProgression(records, fixture)).not.toThrow();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Seq: 1 }),
        expect.objectContaining({ Seq: 2 }),
        expect.objectContaining({ Seq: 3 }),
        expect.objectContaining({ Seq: 4 })
      ])
    );
    expect(requested.some((timestamp) => timestamp > KICKOFF + 2 * 60_000 && timestamp < KICKOFF + 5 * 60_000)).toBe(true);
  });

  it("fails closed when adaptive snapshots still skip a score state", async () => {
    const opening = scoreRecord(1, KICKOFF, 0, 0);
    const jumped = scoreRecord(3, KICKOFF + 60_000, 0, 2);

    const error = await recoverCompleteScoreHistoryFromSnapshots({
      fixtureId: FIXTURE_ID,
      fixture,
      startTimestamp: KICKOFF,
      endTimestamp: KICKOFF + 2 * 60_000,
      baseRecords: [jumped],
      fetchSnapshotAt: async (_fixtureId, asOf) => [
        asOf < KICKOFF + 60_000 ? opening : jumped
      ]
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe("SCORE_HISTORY_INCOMPLETE");
  });
});
