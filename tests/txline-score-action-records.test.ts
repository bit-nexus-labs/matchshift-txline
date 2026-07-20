import { describe, expect, it } from "vitest";
import { extractTxlineScoreActionRecords } from "../src/txline/score-action-records.js";

describe("TxLINE complete score action extraction", () => {
  it("keeps direct kickoff actions even when no Score object is present", () => {
    const kickoff = {
      FixtureId: 101,
      Seq: 18,
      Ts: 1_784_000_000_000,
      Action: "kickoff",
      Confirmed: true,
      Clock: { Running: true, Seconds: 0 }
    };
    const payload = {
      event: "historical_scores",
      message: JSON.stringify({ payload: { records: [kickoff] } })
    };

    expect(extractTxlineScoreActionRecords(payload)).toEqual([kickoff]);
  });

  it("adds normalizer aliases while preserving the complete direct action", () => {
    const score = {
      Participant1: { Total: { Goals: 1 } }
    };
    const data = { GoalType: "Shot" };
    const goal = {
      FixtureId: 101,
      Seq: 19,
      Ts: 1_784_000_001_000,
      Action: "goal",
      Confirmed: true,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_339 },
      Score: score,
      Data: data
    };

    expect(extractTxlineScoreActionRecords([goal])).toEqual([
      {
        ...goal,
        scoreSoccer: score,
        dataSoccer: data
      }
    ]);
  });

  it("does not collect nested player or statistics objects as score actions", () => {
    const payload = {
      FixtureId: 101,
      Seq: 1,
      Ts: 1_784_000_000_000,
      Action: "lineups",
      Lineups: [
        {
          player: {
            id: "not-a-score-action",
            action: "metadata-only"
          }
        }
      ]
    };

    expect(extractTxlineScoreActionRecords(payload)).toHaveLength(1);
  });
});
