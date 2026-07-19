import { describe, expect, it } from "vitest";
import { deriveVisibleMatchState } from "../src/core/derive-state.js";
import { createViewerSession } from "../src/core/session-machine.js";
import type { MatchRecord } from "../src/core/types.js";
import {
  buildCuratedMatchDefinition,
  renderCuratedReplayModule,
  selectCuratedFixture
} from "../src/txline/curated-replay.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";

const T0 = Date.parse("2026-07-18T21:00:00.000Z");

function fixture(overrides: Partial<NormalizedFixture> = {}): NormalizedFixture {
  return {
    fixtureId: "private-provider-fixture",
    startTime: T0,
    startTimestamp: T0,
    participant1: "France",
    participant2: "England",
    participant1IsHome: true,
    homeParticipant: "France",
    awayParticipant: "England",
    gameState: 5,
    selectionState: "SELECTABLE",
    ...overrides
  };
}

function privateSourceOrder(
  domain: "TXLINE_SCORES" | "TXLINE_ODDS",
  sequence?: number
) {
  return {
    domain,
    tieBreaker: "private-provider-tie-breaker",
    payloadIdentity: "private-provider-payload",
    sourceMessageId: "private-provider-message",
    sseEventId: "private-provider-event",
    ...(sequence === undefined ? {} : { sourceSequence: sequence })
  };
}

describe("TxLINE curated completed-match replay", () => {
  it("selects one fixture by unordered participants and UTC date", () => {
    const selected = selectCuratedFixture(
      [
        fixture(),
        fixture({
          fixtureId: "other-date",
          startTime: T0 - 86_400_000,
          startTimestamp: T0 - 86_400_000
        })
      ],
      {
        sideA: "England",
        sideB: "France",
        matchDateUtc: "2026-07-18"
      }
    );

    expect(selected.fixtureId).toBe("private-provider-fixture");
  });

  it("removes provider identifiers and preserves spoiler-safe cursor behavior", () => {
    const scoreRecords: MatchRecord[] = [
      {
        fixtureId: "private-provider-fixture",
        recordId: "private-baseline",
        sourceTimestamp: T0,
        receivedTimestamp: T0 + 1,
        provenance: "TXLINE",
        sourceOrder: privateSourceOrder("TXLINE_SCORES", 10),
        kind: "recovery",
        recoveryReason: "private recovery reason",
        snapshot: { score: { home: 0, away: 0 } }
      },
      {
        fixtureId: "private-provider-fixture",
        recordId: "private-goal",
        sourceTimestamp: T0 + 10 * 60_000,
        receivedTimestamp: T0 + 10 * 60_000 + 1,
        provenance: "TXLINE",
        sourceOrder: privateSourceOrder("TXLINE_SCORES", 11),
        kind: "event",
        eventType: "GOAL",
        team: "HOME",
        minute: 10
      }
    ];
    const oddsRecords: MatchRecord[] = [
      {
        fixtureId: "private-provider-fixture",
        recordId: "private-odds-a",
        sourceTimestamp: T0,
        receivedTimestamp: T0 + 2,
        provenance: "TXLINE",
        sourceOrder: privateSourceOrder("TXLINE_ODDS"),
        kind: "odds",
        impliedProbabilities: { homeWin: 0.5, draw: 0.3, awayWin: 0.2 }
      },
      {
        fixtureId: "private-provider-fixture",
        recordId: "private-odds-b",
        sourceTimestamp: T0 + 10 * 60_000 + 10_000,
        receivedTimestamp: T0 + 10 * 60_000 + 10_010,
        provenance: "TXLINE",
        sourceOrder: privateSourceOrder("TXLINE_ODDS"),
        kind: "odds",
        impliedProbabilities: { homeWin: 0.7, draw: 0.2, awayWin: 0.1 }
      }
    ];

    const match = buildCuratedMatchDefinition({
      fixture: fixture(),
      scoreRecords,
      oddsRecords,
      publicFixtureId: "curated-france-england-2026-07-18",
      publicLabel: "France vs England - curated TxLINE replay",
      durationMinutes: 120
    });
    const serialized = JSON.stringify(match);
    expect(serialized).not.toContain("private-provider-fixture");
    expect(serialized).not.toContain("private-provider-message");
    expect(serialized).not.toContain("private-provider-payload");
    expect(serialized).not.toContain("private-provider-event");
    expect(match.records[0]?.kind).toBe("recovery");

    const beforeGoal = createViewerSession({
      sessionId: "before-goal",
      fixtureId: match.fixtureId,
      mode: "REPLAY",
      liveEdgeTimestamp: match.liveEdgeTimestamp,
      visibilityCursor: T0 + 9 * 60_000
    });
    const afterGoal = createViewerSession({
      sessionId: "after-goal",
      fixtureId: match.fixtureId,
      mode: "REPLAY",
      liveEdgeTimestamp: match.liveEdgeTimestamp,
      visibilityCursor: T0 + 11 * 60_000
    });

    const before = deriveVisibleMatchState(match, beforeGoal);
    const after = deriveVisibleMatchState(match, afterGoal);
    expect(before.score).toEqual({ home: 0, away: 0 });
    expect(before.events.some((event) => event.eventType === "GOAL")).toBe(false);
    expect(after.score).toEqual({ home: 1, away: 0 });
    expect(after.events.some((event) => event.eventType === "GOAL")).toBe(true);
    expect(before.safety.active).toBe(false);
    expect(after.safety.active).toBe(false);

    const moduleText = renderCuratedReplayModule(match);
    expect(moduleText).toContain("CURATED_REAL_MATCH");
    expect(moduleText).not.toContain("private-provider");
  });
});
