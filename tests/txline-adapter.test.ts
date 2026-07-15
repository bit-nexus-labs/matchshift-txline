import { describe, expect, it } from "vitest";
import {
  TxlineAdapter,
  computeReconnectDelay,
  type TxlineAdapterConfig,
  type TxlineClient
} from "../src/txline/adapter.js";
import {
  TxlineConfigurationError,
  TxlineHttpError
} from "../src/txline/http-client.js";

const CONFIG: TxlineAdapterConfig = {
  mode: "devnet",
  network: "devnet",
  apiOrigin: "https://txline-dev.txodds.com",
  apiToken: "mock-api-token",
  requestTimeoutMs: 5_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 2_000
};

function sseResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" }
  });
}

describe("TxLINE adapter", () => {
  it("hydrates fixture, score, and odds snapshots before stream use", async () => {
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [
        {
          FixtureId: 101,
          StartTime: "2026-07-15T18:00:00.000Z",
          Participant1: "Alpha",
          Participant2: "Beta",
          Participant1IsHome: true,
          GameState: 1
        }
      ],
      fetchScoresSnapshot: async () => [
        {
          FixtureId: 101,
          Seq: 1,
          Ts: 1_784_140_000,
          MessageId: "score-1",
          HomeScore: 0,
          AwayScore: 0
        }
      ],
      fetchOddsSnapshot: async () => [
        {
          FixtureId: 101,
          seq: 2,
          ts: 1_784_140_100,
          MessageId: "odds-2",
          homeProbability: 0.45,
          drawProbability: 0.3,
          awayProbability: 0.25
        }
      ],
      openStream: async () => sseResponse(": heartbeat\n\n")
    };
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client,
      now: () => 1_784_140_200_000
    });

    const match = await adapter.hydrateSelectedFixture("101");

    expect(match.expectedFirstSequence).toBe(1);
    expect(match.records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(match.provenance).toBe("TXLINE");
    expect(adapter.getStatus().state).toBe("SNAPSHOT_READY");
  });

  it("reports heartbeat-only streams as IDLE_NO_COVERAGE", async () => {
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [],
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () =>
        sseResponse(": heartbeat one\r\n\r\n: heartbeat two\n\n")
    };
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client,
      now: () => 1_784_140_000_000
    });

    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 0
    });

    expect(adapter.getStatus()).toMatchObject({
      state: "IDLE_NO_COVERAGE"
    });
    expect(adapter.getStatus().state).not.toBe("LIVE");
  });

  it("normalizes mocked SSE data into MatchRecord values", async () => {
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [],
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () =>
        sseResponse(
          'id: odds-event\ndata: {"FixtureId":101,"Seq":7,"Ts":1784140000,"homeProbability":0.5,"drawProbability":0.3,"awayProbability":0.2}\n\n'
        )
    };
    const adapter = new TxlineAdapter({ config: CONFIG, client });
    const received: number[] = [];

    await adapter.runStream("odds", {
      fixtureId: "101",
      maxReconnectAttempts: 0,
      onRecord: (record) => {
        received.push(record.sequence);
      }
    });

    expect(received).toEqual([7]);
  });

  it("stops immediately on 403 configuration errors", async () => {
    let attempts = 0;
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [],
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () => {
        attempts += 1;
        throw new TxlineConfigurationError();
      }
    };
    const adapter = new TxlineAdapter({ config: CONFIG, client });

    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 10
    });

    expect(attempts).toBe(1);
    expect(adapter.getStatus().state).toBe("CONFIG_ERROR");
  });

  it("uses bounded exponential reconnect backoff with jitter", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [],
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () => {
        attempts += 1;
        throw new TxlineHttpError("NETWORK_ERROR", "network unavailable");
      }
    };
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client,
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });

    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 2
    });

    expect(attempts).toBe(3);
    expect(delays).toEqual([750, 1_500]);
    expect(computeReconnectDelay(10, 1_000, 2_000, () => 1)).toBe(2_000);
  });

  it("reports snapshot 403 responses as CONFIG_ERROR", async () => {
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => {
        throw new TxlineConfigurationError();
      },
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () => sseResponse(": heartbeat\n\n")
    };
    const adapter = new TxlineAdapter({ config: CONFIG, client });

    await expect(adapter.hydrateSelectedFixture("101")).rejects.toBeInstanceOf(
      TxlineConfigurationError
    );
    expect(adapter.getStatus().state).toBe("CONFIG_ERROR");
  });

  it("fails closed when stream source time regresses", async () => {
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [],
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () =>
        sseResponse(
          'data: {"FixtureId":101,"Seq":7,"Ts":1784140200,"homeProbability":0.5,"drawProbability":0.3,"awayProbability":0.2}\n\ndata: {"FixtureId":101,"Seq":8,"Ts":1784140100,"homeProbability":0.4,"drawProbability":0.3,"awayProbability":0.3}\n\n'
        )
    };
    const adapter = new TxlineAdapter({ config: CONFIG, client });
    const received: number[] = [];

    await adapter.runStream("odds", {
      fixtureId: "101",
      maxReconnectAttempts: 0,
      onRecord: (record) => {
        received.push(record.sequence);
      }
    });

    expect(received).toEqual([7]);
    expect(adapter.getStatus().state).toBe("SAFE_HOLD");
  });

  it("redacts configured credentials from adapter status errors", async () => {
    const client: TxlineClient = {
      fetchFixturesSnapshot: async () => [],
      fetchScoresSnapshot: async () => [],
      fetchOddsSnapshot: async () => [],
      openStream: async () => {
        throw new Error(`transport failed for ${CONFIG.apiToken}`);
      }
    };
    const adapter = new TxlineAdapter({ config: CONFIG, client });

    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 0
    });

    expect(adapter.getStatus().message).not.toContain(CONFIG.apiToken);
  });
});
