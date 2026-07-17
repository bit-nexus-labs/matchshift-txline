import { describe, expect, it } from "vitest";
import type { MatchDefinition, MatchRecord } from "../src/core/types.js";
import {
  LiveObserverError,
  observeLiveInput,
  validateLiveObserverReceipt,
  type LiveObserverAdapter,
  type LiveObserverDiscoveryClient
} from "../src/txline/live-observer.js";

const NOW = Date.UTC(2026, 6, 17, 18, 0, 0);
const FIXTURE_ID = "live-private-fixture";

function fixturePayload(startTimestamp = NOW - 30 * 60_000) {
  return [
    {
      Ts: startTimestamp - 1_000,
      StartTime: startTimestamp,
      Competition: "Private live competition",
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

function discoveryClient(
  payload: unknown = fixturePayload()
): LiveObserverDiscoveryClient {
  return {
    async fetchFixturesSnapshot() {
      return payload;
    }
  };
}

function baseline(): MatchDefinition {
  return {
    fixtureId: FIXTURE_ID,
    label: "Private baseline",
    provenance: "TXLINE",
    kickoffTimestamp: NOW - 30 * 60_000,
    liveEdgeTimestamp: NOW - 1_000,
    records: []
  };
}

function liveOddsRecord(): MatchRecord {
  return {
    fixtureId: FIXTURE_ID,
    recordId: "private-live-record",
    kind: "odds",
    sourceTimestamp: NOW,
    receivedTimestamp: NOW + 5,
    provenance: "TXLINE",
    sourceOrder: {
      domain: "TXLINE_ODDS",
      tieBreaker: "private",
      payloadIdentity: "private-payload",
      sourceMessageId: "private-message"
    },
    impliedProbabilities: {
      homeWin: 0.5,
      draw: 0.3,
      awayWin: 0.2
    }
  };
}

function adapterWithRecord(record?: MatchRecord): LiveObserverAdapter {
  return {
    async hydrateSelectedFixture() {
      return baseline();
    },
    async runStream(kind, options) {
      if (kind === "odds" && record !== undefined) {
        await options.onRecord?.(record);
      }
    }
  };
}

describe("TxLINE literal live observer", () => {
  it("passes only after a normalized SSE data record is delivered", async () => {
    const result = await observeLiveInput({
      network: "mainnet",
      discoveryClient: discoveryClient(),
      adapter: adapterWithRecord(liveOddsRecord()),
      now: NOW,
      observeMs: 1_000,
      commitSha: "abc123"
    });

    expect(result.status).toBe("PASS");
    expect(result.observedKind).toBe("odds");
    expect(result.observedSourceTimestamp).toBe(NOW);
    expect(result.receipt).toContain("SSE data record observed: PASS");
    expect(result.receipt).toContain("Heartbeat-only accepted as proof: NO");
    expect(result.receipt).not.toContain(FIXTURE_ID);
    expect(result.receipt).not.toContain("Private Alpha");
    expect(result.receipt).not.toContain("private-live-record");
  });

  it("returns NOT_OBSERVED when streams produce no normalized data record", async () => {
    const result = await observeLiveInput({
      network: "mainnet",
      discoveryClient: discoveryClient(),
      adapter: adapterWithRecord(),
      now: NOW,
      observeMs: 1_000,
      commitSha: "abc123"
    });

    expect(result.status).toBe("NOT_OBSERVED");
    expect(result.receipt).toContain(
      "TXLINE LIVE INPUT OBSERVER: NOT OBSERVED"
    );
    expect(result.receipt).toContain("SSE data record observed: NO");
    expect(result.receipt).not.toContain("PASS\n\nNetwork");
  });

  it("rejects an auto-discovery window with no nearby fixture", async () => {
    await expect(
      observeLiveInput({
        network: "mainnet",
        discoveryClient: discoveryClient(fixturePayload(NOW + 24 * 60 * 60_000)),
        adapter: adapterWithRecord(),
        now: NOW,
        fixtureWindowHours: 6,
        observeMs: 1_000
      })
    ).rejects.toMatchObject({ code: "NO_LIVE_CANDIDATE" });
  });

  it("rejects normalized records for a different fixture", async () => {
    const invalidRecord: MatchRecord = {
      ...liveOddsRecord(),
      fixtureId: "different-fixture"
    };
    await expect(
      observeLiveInput({
        network: "mainnet",
        discoveryClient: discoveryClient(),
        adapter: adapterWithRecord(invalidRecord),
        now: NOW,
        observeMs: 1_000
      })
    ).rejects.toMatchObject({ code: "NORMALIZED_RECORD_INVALID" });
  });

  it("rejects data-shaped values in the public-safe receipt", () => {
    expect(() =>
      validateLiveObserverReceipt(
        "fixtureId: private\nAuthorization: Bearer private"
      )
    ).toThrowError(LiveObserverError);
  });
});
