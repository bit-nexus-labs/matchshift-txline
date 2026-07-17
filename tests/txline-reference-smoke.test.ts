import { describe, expect, it } from "vitest";
import {
  buildReferenceFixturePayload,
  createReferenceHistoricalClient
} from "../src/txline/reference-smoke.js";

const FIXTURE_ID = "18213979";
const EARLY = Date.UTC(2026, 6, 11, 19, 0, 0);

function scoreHistory() {
  return [
    {
      fixtureId: Number(FIXTURE_ID),
      action: "kickoff",
      id: 1,
      ts: EARLY + 1_000,
      seq: 1,
      scoreSoccer: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    },
    {
      fixtureId: Number(FIXTURE_ID),
      action: "goal",
      id: 2,
      ts: EARLY + 49 * 60_000,
      seq: 2,
      scoreSoccer: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }
  ];
}

describe("TxLINE reference historical smoke adapter", () => {
  it("derives a schema-compatible fixture from historical score timestamps", () => {
    expect(buildReferenceFixturePayload(scoreHistory(), FIXTURE_ID)).toEqual([
      {
        FixtureId: FIXTURE_ID,
        StartTime: EARLY + 1_000,
        Participant1: "Reference side A",
        Participant2: "Reference side B",
        Participant1IsHome: true,
        GameState: 1
      }
    ]);
  });

  it("loads historical scores once and delegates odds requests", async () => {
    let scoreCalls = 0;
    const oddsCalls: Array<{ fixtureId: string; asOf: number }> = [];
    const source = {
      async fetchScoresHistorical() {
        scoreCalls += 1;
        return scoreHistory();
      },
      async fetchOddsSnapshotAt(fixtureId: string | number, asOf: number) {
        oddsCalls.push({ fixtureId: String(fixtureId), asOf });
        return [];
      }
    };
    const client = createReferenceHistoricalClient(source, FIXTURE_ID);

    await client.fetchFixturesSnapshotForDay(0);
    await client.fetchScoresHistorical(FIXTURE_ID);
    await client.fetchOddsSnapshotAt(FIXTURE_ID, EARLY);

    expect(scoreCalls).toBe(1);
    expect(oddsCalls).toEqual([{ fixtureId: FIXTURE_ID, asOf: EARLY }]);
  });
});
