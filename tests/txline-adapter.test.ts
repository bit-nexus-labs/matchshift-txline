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

function fixtureSnapshot() {
  return [
    {
      FixtureId: 101,
      StartTime: "2026-07-15T18:00:00.000Z",
      Participant1: "Alpha",
      Participant2: "Beta",
      Participant1IsHome: true,
      GameState: 1
    }
  ];
}

function scoreSnapshot(seq: number, ts: number, home: number, away: number) {
  return [
    {
      fixtureId: 101,
      action: "period_update",
      seq,
      ts,
      scoreSoccer: {
        Participant1: { Total: { Goals: home } },
        Participant2: { Total: { Goals: away } }
      }
    }
  ];
}

function oddsPayload(overrides: Record<string, unknown> = {}) {
  return {
    FixtureId: 101,
    MessageId: "odds-message-1",
    Ts: 1_784_140_100,
    Bookmaker: "ExampleBook",
    BookmakerId: 7,
    SuperOddsType: "1X2",
    InRunning: true,
    MarketParameters: "",
    MarketPeriod: "FullTime",
    PriceNames: ["1", "X", "2"],
    Prices: [2100, 3200, 3600],
    Pct: [47.6, 31.2, 27.8],
    ...overrides
  };
}

function baseClient(overrides: Partial<TxlineClient> = {}): TxlineClient {
  return {
    fetchFixturesSnapshot: async () => fixtureSnapshot(),
    fetchScoresSnapshot: async () => scoreSnapshot(10, 1_784_140_000, 0, 0),
    fetchOddsSnapshot: async () => [oddsPayload()],
    openStream: async () => sseResponse(": heartbeat\n\n"),
    ...overrides
  };
}

describe("TxLINE adapter", () => {
  it("hydrates independent official score and odds snapshots", async () => {
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient(),
      now: () => 1_784_140_200_000
    });

    const match = await adapter.hydrateSelectedFixture("101");

    expect(match.expectedFirstSequence).toBeUndefined();
    expect(match.records.map((record) => record.sourceOrder?.domain)).toEqual([
      "TXLINE_SCORES",
      "TXLINE_ODDS"
    ]);
    expect(match.records[0]?.sourceOrder?.sourceSequence).toBe(10);
    expect(match.records[1]?.sequence).toBeUndefined();
    expect(adapter.getStatus().state).toBe("SNAPSHOT_READY");
  });

  it("requires snapshots before streaming and treats heartbeats as no coverage", async () => {
    const adapter = new TxlineAdapter({ config: CONFIG, client: baseClient() });

    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 0
    });
    expect(adapter.getStatus().state).toBe("SAFE_HOLD");

    await adapter.hydrateSelectedFixture("101");
    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 0
    });
    expect(adapter.getStatus().state).toBe("IDLE_NO_COVERAGE");
  });

  it("accepts official odds SSE records without Seq", async () => {
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        openStream: async () =>
          sseResponse(
            `id: odds-sse-1\ndata: ${JSON.stringify(
              oddsPayload({ MessageId: "odds-stream-1", Ts: 1_784_140_200 })
            )}\n\n`
          )
      })
    });
    await adapter.hydrateSelectedFixture("101");
    const received: string[] = [];

    await adapter.runStream("odds", {
      fixtureId: "101",
      maxReconnectAttempts: 0,
      onRecord: (record) => {
        received.push(
          `${record.recordId}:${record.sourceOrder?.domain}:${String(
            record.sequence
          )}`
        );
      }
    });

    expect(received).toEqual(["odds-stream-1:TXLINE_ODDS:undefined"]);
  });

  it("stops on 403 and uses bounded reconnect backoff", async () => {
    let forbiddenAttempts = 0;
    const forbiddenAdapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        openStream: async () => {
          forbiddenAttempts += 1;
          throw new TxlineConfigurationError();
        }
      })
    });
    await forbiddenAdapter.hydrateSelectedFixture("101");
    await forbiddenAdapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 10
    });
    expect(forbiddenAttempts).toBe(1);
    expect(forbiddenAdapter.getStatus().state).toBe("CONFIG_ERROR");

    let attempts = 0;
    const delays: number[] = [];
    const retryAdapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        openStream: async () => {
          attempts += 1;
          throw new TxlineHttpError("NETWORK_ERROR", "network unavailable");
        }
      }),
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });
    await retryAdapter.hydrateSelectedFixture("101");
    await retryAdapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 2
    });

    expect(attempts).toBe(3);
    expect(delays).toEqual([750, 1_500]);
    expect(computeReconnectDelay(10, 1_000, 2_000, () => 1)).toBe(2_000);
  });

  it("rehydrates after a real score gap before resuming", async () => {
    let snapshotCalls = 0;
    let streamCalls = 0;
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        fetchScoresSnapshot: async () => {
          snapshotCalls += 1;
          return snapshotCalls === 1
            ? scoreSnapshot(10, 1_784_140_000, 0, 0)
            : scoreSnapshot(12, 1_784_140_200, 1, 0);
        },
        openStream: async () => {
          streamCalls += 1;
          const score =
            streamCalls === 1
              ? {
                  fixtureId: 101,
                  action: "goal",
                  seq: 12,
                  ts: 1_784_140_200,
                  dataSoccer: { Participant: "Participant1", Minutes: 49 }
                }
              : {
                  fixtureId: 101,
                  action: "goal",
                  seq: 13,
                  ts: 1_784_140_240,
                  dataSoccer: { Participant: "Participant2", Minutes: 53 }
                };
          return sseResponse(`data: ${JSON.stringify(score)}\n\n`);
        }
      }),
      sleep: async () => undefined
    });
    await adapter.hydrateSelectedFixture("101");
    const received: number[] = [];

    await adapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 1,
      onRecord: (record) => {
        const sequence = record.sourceOrder?.sourceSequence;
        if (sequence !== undefined) {
          received.push(sequence);
        }
      }
    });

    expect(snapshotCalls).toBe(2);
    expect(streamCalls).toBe(2);
    expect(received).toEqual([13]);
    expect(
      adapter
        .getMatches()[0]
        ?.records.map((record) => record.sourceOrder?.sourceSequence)
        .filter((value): value is number => value !== undefined)
    ).toEqual([10, 12, 13]);
  });

  it("keeps amendments but drops exact duplicate odds frames", async () => {
    const original = oddsPayload({
      MessageId: "odds-stream-2",
      Ts: 1_784_140_300
    });
    const amended = oddsPayload({
      MessageId: "odds-stream-2",
      Ts: 1_784_140_300,
      Pct: [40, 35, 25]
    });
    const adapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        openStream: async () =>
          sseResponse(
            `id: odds-frame-1\ndata: ${JSON.stringify(original)}\n\n` +
              `id: odds-frame-1\ndata: ${JSON.stringify(original)}\n\n` +
              `id: odds-frame-2\ndata: ${JSON.stringify(amended)}\n\n`
          )
      })
    });
    await adapter.hydrateSelectedFixture("101");
    const received: string[] = [];

    await adapter.runStream("odds", {
      fixtureId: "101",
      maxReconnectAttempts: 0,
      onRecord: (record) => {
        received.push(record.sourceOrder?.sseEventId ?? "");
      }
    });

    expect(received).toEqual(["odds-frame-1", "odds-frame-2"]);
  });

  it("reports snapshot 403 and redacts configured credentials", async () => {
    const snapshotAdapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        fetchFixturesSnapshot: async () => {
          throw new TxlineConfigurationError();
        }
      })
    });
    await expect(
      snapshotAdapter.hydrateSelectedFixture("101")
    ).rejects.toBeInstanceOf(TxlineConfigurationError);
    expect(snapshotAdapter.getStatus().state).toBe("CONFIG_ERROR");

    const redactionAdapter = new TxlineAdapter({
      config: CONFIG,
      client: baseClient({
        openStream: async () => {
          throw new Error(`transport failed for ${CONFIG.apiToken}`);
        }
      })
    });
    await redactionAdapter.hydrateSelectedFixture("101");
    await redactionAdapter.runStream("scores", {
      fixtureId: "101",
      maxReconnectAttempts: 0
    });
    expect(redactionAdapter.getStatus().message).not.toContain(CONFIG.apiToken);
  });
});
