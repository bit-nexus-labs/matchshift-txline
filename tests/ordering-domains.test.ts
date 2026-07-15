import { describe, expect, it } from "vitest";
import { deriveVisibleMatchState } from "../src/core/derive-state.js";
import { applySequenceSafetyGate } from "../src/core/safety-gate.js";
import type {
  MatchDefinition,
  MatchRecord,
  ViewerSession
} from "../src/core/types.js";
import { compareMatchRecords } from "../src/core/visibility.js";

const T0 = Date.parse("2026-07-15T18:00:00.000Z");

function scoreOrder(sequence: number, id: string) {
  return {
    domain: "TXLINE_SCORES" as const,
    sourceSequence: sequence,
    payloadIdentity: `payload-${id}`,
    tieBreaker: `TXLINE_SCORES:${String(sequence).padStart(8, "0")}:${id}`
  };
}

function oddsOrder(id: string) {
  return {
    domain: "TXLINE_ODDS" as const,
    sourceMessageId: id,
    payloadIdentity: `payload-${id}`,
    tieBreaker: `TXLINE_ODDS:${id}`
  };
}

function liveSession(cursor: number): ViewerSession {
  return {
    sessionId: "viewer-1",
    fixtureId: "fixture-1",
    mode: "LIVE",
    visibilityCursor: cursor,
    delayMs: 0
  };
}

function match(records: readonly MatchRecord[]): MatchDefinition {
  return {
    fixtureId: "fixture-1",
    label: "Alpha vs Beta (TxLINE devnet)",
    provenance: "TXLINE",
    kickoffTimestamp: T0,
    liveEdgeTimestamp: Math.max(...records.map((record) => record.sourceTimestamp)),
    records: [...records].sort(compareMatchRecords)
  };
}

describe("independent ordering domains", () => {
  it("does not create a false gap when odds has no sequence", () => {
    const records: MatchRecord[] = [
      {
        fixtureId: "fixture-1",
        recordId: "score-baseline-40",
        sourceTimestamp: T0 + 10_000,
        receivedTimestamp: T0 + 10_100,
        provenance: "TXLINE",
        sourceOrder: scoreOrder(40, "baseline"),
        kind: "recovery",
        recoveryReason: "score snapshot",
        snapshot: { score: { home: 0, away: 0 } }
      },
      {
        fixtureId: "fixture-1",
        recordId: "odds-1",
        sourceTimestamp: T0 + 20_000,
        receivedTimestamp: T0 + 20_100,
        provenance: "TXLINE",
        sourceOrder: oddsOrder("odds-1"),
        kind: "odds",
        impliedProbabilities: { homeWin: 0.5, draw: 0.3, awayWin: 0.2 }
      },
      {
        fixtureId: "fixture-1",
        recordId: "goal-41",
        sourceTimestamp: T0 + 30_000,
        receivedTimestamp: T0 + 30_100,
        provenance: "TXLINE",
        sourceOrder: scoreOrder(41, "goal"),
        kind: "event",
        eventType: "GOAL",
        team: "HOME",
        minute: 1
      }
    ];

    const state = deriveVisibleMatchState(match(records), liveSession(T0 + 30_000));

    expect(state.safety.active).toBe(false);
    expect(state.score).toEqual({ home: 1, away: 0 });
    expect(state.impliedProbabilities).toEqual({
      homeWin: 0.5,
      draw: 0.3,
      awayWin: 0.2
    });
  });

  it("holds score changes across a real score gap while retaining odds records", () => {
    const baseline: MatchRecord = {
      fixtureId: "fixture-1",
      recordId: "score-baseline-50",
      sourceTimestamp: T0 + 10_000,
      receivedTimestamp: T0 + 10_100,
      provenance: "TXLINE",
      sourceOrder: scoreOrder(50, "baseline"),
      kind: "recovery",
      recoveryReason: "score snapshot",
      snapshot: { score: { home: 0, away: 0 } }
    };
    const odds: MatchRecord = {
      fixtureId: "fixture-1",
      recordId: "odds-2",
      sourceTimestamp: T0 + 20_000,
      receivedTimestamp: T0 + 20_100,
      provenance: "TXLINE",
      sourceOrder: oddsOrder("odds-2"),
      kind: "odds",
      impliedProbabilities: { homeWin: 0.4, draw: 0.35, awayWin: 0.25 }
    };
    const skippedGoal: MatchRecord = {
      fixtureId: "fixture-1",
      recordId: "goal-52",
      sourceTimestamp: T0 + 30_000,
      receivedTimestamp: T0 + 30_100,
      provenance: "TXLINE",
      sourceOrder: scoreOrder(52, "gap"),
      kind: "event",
      eventType: "GOAL",
      team: "HOME",
      minute: 1
    };

    const gate = applySequenceSafetyGate(
      [baseline, odds, skippedGoal].sort(compareMatchRecords)
    );

    expect(gate.status.active).toBe(true);
    expect(gate.status.reason).toContain("expected 51, received 52");
    expect(gate.trustedRecords).toContain(odds);
    expect(gate.trustedRecords).not.toContain(skippedGoal);
  });

  it("clears a score hold with a trusted recovery snapshot", () => {
    const records: MatchRecord[] = [
      {
        fixtureId: "fixture-1",
        recordId: "score-baseline-60",
        sourceTimestamp: T0 + 10_000,
        receivedTimestamp: T0 + 10_100,
        provenance: "TXLINE",
        sourceOrder: scoreOrder(60, "baseline"),
        kind: "recovery",
        recoveryReason: "score snapshot",
        snapshot: { score: { home: 0, away: 0 } }
      },
      {
        fixtureId: "fixture-1",
        recordId: "goal-62",
        sourceTimestamp: T0 + 20_000,
        receivedTimestamp: T0 + 20_100,
        provenance: "TXLINE",
        sourceOrder: scoreOrder(62, "gap"),
        kind: "event",
        eventType: "GOAL",
        team: "HOME",
        minute: 1
      },
      {
        fixtureId: "fixture-1",
        recordId: "score-recovery-70",
        sourceTimestamp: T0 + 30_000,
        receivedTimestamp: T0 + 30_100,
        provenance: "TXLINE",
        sourceOrder: scoreOrder(70, "recovery"),
        kind: "recovery",
        recoveryReason: "reconnect snapshot",
        snapshot: { score: { home: 2, away: 1 } }
      }
    ];

    const state = deriveVisibleMatchState(match(records), liveSession(T0 + 30_000));

    expect(state.safety.active).toBe(false);
    expect(state.safety.recoveredAtSequence).toBe(70);
    expect(state.score).toEqual({ home: 2, away: 1 });
    expect(state.latestExplanation).toBeUndefined();
  });
});
