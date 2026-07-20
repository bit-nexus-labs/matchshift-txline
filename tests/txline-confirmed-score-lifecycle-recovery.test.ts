import { describe, expect, it } from "vitest";
import type { MatchEventRecord } from "../src/core/types.js";
import { normalizeCuratedHistoricalScores } from "../src/txline/curated-replay-exporter.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { recoverOpeningScorePrefixFromGoalActions } from "../src/txline/score-opening-prefix-recovery.js";

const KICKOFF = Date.parse("2026-07-19T19:05:00.000Z");
const FIXTURE_ID = "fixture-under-test";

const fixture: NormalizedFixture = {
  fixtureId: FIXTURE_ID,
  startTime: KICKOFF,
  startTimestamp: KICKOFF,
  participant1: "Home Side",
  participant2: "Away Side",
  participant1IsHome: true,
  homeParticipant: "Home Side",
  awayParticipant: "Away Side",
  gameState: 1,
  selectionState: "SELECTABLE"
};

function action(
  seq: number,
  name: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    FixtureId: FIXTURE_ID,
    Seq: seq,
    Ts: KICKOFF + seq * 1_000,
    Action: name,
    ...overrides
  };
}

function completedLifecycle(): Array<Record<string, unknown>> {
  return [
    action(10, "kickoff", {
      Id: 100,
      Confirmed: false,
      Clock: { Running: true, Seconds: 0 }
    }),
    action(11, "kickoff", {
      Id: 100,
      Confirmed: true,
      Clock: { Running: true, Seconds: 0 }
    }),
    action(20, "goal", {
      Id: 200,
      Confirmed: false,
      Participant: 2,
      Clock: { Running: true, Seconds: 5_739 },
      Score: {
        Participant2: { Total: { Goals: 1 } }
      }
    }),
    action(21, "action_discarded", {
      Id: 200,
      Clock: { Running: true, Seconds: 5_739 }
    }),
    action(30, "goal", {
      Id: 300,
      Confirmed: false,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_339 },
      Score: {
        Participant1: { Total: { Goals: 1 } }
      }
    }),
    action(31, "goal", {
      Id: 300,
      Confirmed: true,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_339 },
      Score: {
        Participant1: { Total: { Goals: 1 } }
      }
    }),
    action(32, "goal", {
      Id: 300,
      Confirmed: true,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_339 },
      Data: { GoalType: "Shot", PlayerId: 999 },
      Score: {
        Participant1: { Total: { Goals: 1 } }
      }
    }),
    action(40, "goal", {
      Id: 400,
      Confirmed: false,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_780 },
      Score: {
        Participant1: { Total: { Goals: 2 } }
      }
    }),
    action(41, "var_end", {
      Id: 401,
      Clock: { Running: true, Seconds: 6_780 },
      Data: { Outcome: "Overturned" }
    }),
    action(42, "action_discarded", {
      Id: 400,
      Clock: { Running: true, Seconds: 6_780 }
    }),
    action(50, "safe_possession", {
      Id: 500,
      Participant: 1,
      Clock: { Running: true, Seconds: 7_502 }
    }),
    action(51, "game_finalised", {
      Id: 600,
      Confirmed: true,
      Clock: { Running: false, Seconds: 0 },
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: {} }
      }
    })
  ];
}

describe("confirmed completed TxLINE score lifecycle recovery", () => {
  it("reduces repeated and discarded provider actions to one trusted 0-0 to 1-0 progression", () => {
    const recovered = recoverOpeningScorePrefixFromGoalActions(
      completedLifecycle(),
      fixture
    ) as Array<Record<string, any>>;

    expect(recovered).toHaveLength(3);
    expect(recovered.map((record) => record.Seq)).toEqual([1, 2, 3]);
    expect(recovered.map((record) => record.Action)).toEqual([
      "kickoff",
      "goal",
      "game_finalised"
    ]);

    expect(recovered[0]).toMatchObject({
      Ts: KICKOFF,
      ScoreSoccer: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    });
    expect(recovered[1]).toMatchObject({
      Ts: KICKOFF + 6_339_000,
      Participant: 1,
      DataSoccer: {
        Participant: "Participant1",
        Minutes: 106
      },
      ScoreSoccer: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    });
    expect(recovered[2]).toMatchObject({
      Ts: KICKOFF + 7_502_000,
      ScoreSoccer: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    });

    const normalized = normalizeCuratedHistoricalScores(
      recovered,
      fixture,
      KICKOFF + 24 * 60 * 60_000
    );
    const goals = normalized.filter(
      (record): record is MatchEventRecord =>
        record.kind === "event" && record.eventType === "GOAL"
    );
    const recoveries = normalized.filter(
      (record) => record.kind === "recovery"
    );

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      team: "HOME",
      minute: 106,
      sourceTimestamp: KICKOFF + 6_339_000
    });
    expect(recoveries[0]).toMatchObject({
      snapshot: { score: { home: 0, away: 0 } }
    });
    expect(recoveries.at(-1)).toMatchObject({
      snapshot: { score: { home: 1, away: 0 } }
    });
  });

  it("fails closed when surviving confirmed goals disagree with game_finalised", () => {
    const records = completedLifecycle();
    const final = records.at(-1)!;
    final.Score = {
      Participant1: { Total: { Goals: 2 } },
      Participant2: { Total: {} }
    };

    const error = (() => {
      try {
        recoverOpeningScorePrefixFromGoalActions(records, fixture);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe(
      "SCORE_LIFECYCLE_FINAL_SCORE_MISMATCH"
    );
    expect((error as Error).message).not.toContain(FIXTURE_ID);
    expect((error as Error).message).not.toContain("300");
  });

  it("fails closed for a non-discarded goal lifecycle that never becomes confirmed", () => {
    const records = completedLifecycle().filter(
      (record) =>
        !(
          record.Action === "goal" &&
          record.Id === 300 &&
          record.Confirmed === true
        )
    );

    const error = (() => {
      try {
        recoverOpeningScorePrefixFromGoalActions(records, fixture);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe(
      "SCORE_LIFECYCLE_GOAL_UNRESOLVED"
    );
  });
});
