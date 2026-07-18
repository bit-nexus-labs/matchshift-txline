import { describe, expect, it } from "vitest";
import type { MatchDefinition } from "../src/core/types.js";
import { matchSnapshotSignatures } from "../src/txline/live-snapshot-observer.js";

const base = {
  fixtureId: "private-fixture",
  sourceTimestamp: 1_000,
  receivedTimestamp: 1_001,
  provenance: "TXLINE" as const
};

describe("TxLINE live snapshot observer", () => {
  it("separates score-domain and odds-domain signatures", () => {
    const match: MatchDefinition = {
      fixtureId: "private-fixture",
      label: "Private",
      provenance: "TXLINE",
      kickoffTimestamp: 500,
      liveEdgeTimestamp: 1_000,
      records: [
        {
          ...base,
          recordId: "goal-record",
          kind: "event",
          eventType: "GOAL",
          minute: 10,
          team: "HOME",
          sourceOrder: {
            domain: "TXLINE_SCORES",
            tieBreaker: "a",
            payloadIdentity: "score-payload",
            sourceSequence: 2,
            sourceMessageId: "score-message"
          }
        },
        {
          ...base,
          recordId: "odds-record",
          kind: "odds",
          impliedProbabilities: {
            homeWin: 0.5,
            draw: 0.3,
            awayWin: 0.2
          },
          sourceOrder: {
            domain: "TXLINE_ODDS",
            tieBreaker: "b",
            payloadIdentity: "odds-payload",
            sourceMessageId: "odds-message"
          }
        }
      ]
    };

    const signatures = matchSnapshotSignatures(match);
    expect(signatures.scores).toContain("event|1000|2|score-message");
    expect(signatures.odds).toContain("odds|1000||odds-message");
    expect(signatures.scores).not.toContain("odds-message");
    expect(signatures.odds).not.toContain("score-message");
  });
});
