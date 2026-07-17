import { describe, expect, it } from "vitest";
import {
  runHistoricalSmoke,
  TxlineSmokeError,
  validateReceiptAllowlist,
  type HistoricalSmokeClient
} from "../src/txline/smoke.js";

const NOW = Date.UTC(2026, 6, 17, 12, 0, 0);
const START = NOW - 24 * 60 * 60 * 1_000;
const FIXTURE_ID = 991_001;

function scoreTotals(home: number, away: number) {
  return {
    Participant1: { Total: { Goals: home } },
    Participant2: { Total: { Goals: away } }
  };
}

function fixturePayload() {
  return [
    {
      Ts: START - 60_000,
      StartTime: START,
      Competition: "Private test competition",
      CompetitionId: 72,
      FixtureGroupId: 7,
      Participant1Id: 10,
      Participant1: "Private Alpha",
      Participant2Id: 11,
      Participant2: "Private Beta",
      FixtureId: FIXTURE_ID,
      Participant1IsHome: true
    }
  ];
}

function scoreHistory() {
  return [
    {
      fixtureId: FIXTURE_ID,
      action: "score_update",
      id: 1,
      ts: START,
      seq: 1,
      scoreSoccer: scoreTotals(0, 0)
    },
    {
      fixtureId: FIXTURE_ID,
      action: "kickoff",
      id: 2,
      ts: START + 1_000,
      seq: 2,
      scoreSoccer: scoreTotals(0, 0)
    },
    {
      fixtureId: FIXTURE_ID,
      action: "goal",
      id: 3,
      ts: START + 49 * 60_000,
      seq: 3,
      scoreSoccer: scoreTotals(1, 0),
      dataSoccer: { Participant: 1, Minutes: 49 }
    },
    {
      fixtureId: FIXTURE_ID,
      action: "score_update",
      id: 4,
      ts: START + 52 * 60_000,
      seq: 4,
      scoreSoccer: scoreTotals(1, 0)
    }
  ];
}

function oddsSnapshot(messageId: string, timestamp: number, pct: string[]) {
  return [
    {
      FixtureId: FIXTURE_ID,
      MessageId: messageId,
      Ts: timestamp,
      Bookmaker: "Private bookmaker",
      BookmakerId: 1,
      SuperOddsType: "1X2",
      InRunning: true,
      GameState: "InPlay",
      MarketParameters: "",
      MarketPeriod: "Full Time",
      PriceNames: ["1", "X", "2"],
      Prices: [2.1, 3.2, 3.5],
      Pct: pct
    }
  ];
}

function makeClient(): HistoricalSmokeClient {
  let oddsCall = 0;
  return {
    async fetchFixturesSnapshotForDay() {
      return fixturePayload();
    },
    async fetchScoresHistorical() {
      return scoreHistory();
    },
    async fetchOddsSnapshotAt(_fixtureId, asOf) {
      oddsCall += 1;
      return oddsSnapshot(
        `private-message-${oddsCall}`,
        asOf,
        oddsCall === 1
          ? ["0.440", "0.310", "0.250"]
          : ["0.680", "0.210", "0.110"]
      );
    }
  };
}

describe("TxLINE historical integration smoke", () => {
  it("runs real-shape payloads through normalizers and the cursor gate", async () => {
    const result = await runHistoricalSmoke({
      network: "mainnet",
      now: NOW,
      client: makeClient(),
      commitSha: "abc123"
    });

    expect(result.recordCount).toBeGreaterThanOrEqual(6);
    expect(result.earlyCursor).toBeLessThan(result.liveEdgeTimestamp);
    expect(result.receipt).toContain("TXLINE INTEGRATION SMOKE: PASS");
    expect(result.receipt).toContain("Future-event isolation: PASS");
    expect(result.receipt).toContain("Commit: abc123");
    expect(result.receipt).not.toContain(String(FIXTURE_ID));
    expect(result.receipt).not.toContain("Private Alpha");
    expect(result.receipt).not.toContain("0.680");
  });

  it("rejects fixtures outside the documented historical window", async () => {
    const client: HistoricalSmokeClient = {
      async fetchFixturesSnapshotForDay() {
        return [
          {
            ...fixturePayload()[0],
            StartTime: NOW - 2 * 60 * 60 * 1_000
          }
        ];
      },
      async fetchScoresHistorical() {
        throw new Error("must not be called");
      },
      async fetchOddsSnapshotAt() {
        throw new Error("must not be called");
      }
    };

    await expect(
      runHistoricalSmoke({ network: "mainnet", now: NOW, client })
    ).rejects.toMatchObject({
      code: "NO_HISTORICAL_FIXTURE"
    });
  });

  it("fails receipt validation for provider-shaped or credential-shaped data", () => {
    expect(() =>
      validateReceiptAllowlist("fixtureId: 123\nBearer secret")
    ).toThrowError(TxlineSmokeError);
  });
});
