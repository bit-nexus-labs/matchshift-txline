import { describe, expect, it } from "vitest";
import type { MatchEventRecord } from "../src/core/types.js";
import { normalizeCuratedHistoricalScores } from "../src/txline/curated-replay-exporter.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { buildRichCuratedMatchDefinition } from "../src/txline/rich-curated-replay.js";
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
      Data: { GoalType: "Shot" },
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

function richZeroZeroLifecycle(): Array<Record<string, unknown>> {
  return [
    action(10, "kickoff", {
      Id: 100,
      Confirmed: true,
      Clock: { Running: true, Seconds: 0 }
    }),
    action(12, "yellow_card", {
      Id: 700,
      Confirmed: false,
      Participant: 2,
      Clock: { Running: true, Seconds: 600 }
    }),
    action(13, "yellow_card", {
      Id: 700,
      Confirmed: true,
      Participant: 2,
      Clock: { Running: true, Seconds: 600 }
    }),
    action(14, "corner", {
      Id: 800,
      Confirmed: true,
      Participant: 1,
      Clock: { Running: true, Seconds: 900 }
    }),
    action(15, "action_discarded", {
      Id: 800,
      Clock: { Running: true, Seconds: 900 }
    }),
    action(16, "corner", {
      Id: 801,
      Confirmed: true,
      Participant: 1,
      Clock: { Running: true, Seconds: 1_000 }
    }),
    action(17, "halftime_finalised", {
      Id: 900,
      Clock: { Running: false, Seconds: 2_700 }
    }),
    action(18, "second_half", {
      Id: 901,
      Clock: { Running: true, Seconds: 2_701 }
    }),
    action(19, "extra_time_start", {
      Id: 902,
      Clock: { Running: true, Seconds: 5_400 }
    }),
    action(20, "match_clock", {
      Id: 903,
      Clock: { Running: true, Seconds: 7_200 }
    }),
    action(21, "game_finalised", {
      Id: 904,
      Confirmed: true,
      Clock: { Running: false, Seconds: 0 },
      Score: {
        Participant1: { Total: {} },
        Participant2: { Total: {} }
      }
    })
  ];
}

function normalizedEvents(
  records: readonly Record<string, unknown>[]
): MatchEventRecord[] {
  return normalizeCuratedHistoricalScores(
    records,
    fixture,
    KICKOFF + 24 * 60 * 60_000
  ).filter((record): record is MatchEventRecord => record.kind === "event");
}

describe("confirmed completed TxLINE score lifecycle recovery", () => {
  it("reduces repeated and discarded actions to a score-safe rich timeline", () => {
    const recovered = recoverOpeningScorePrefixFromGoalActions(
      completedLifecycle(),
      fixture
    ) as Array<Record<string, any>>;

    expect(recovered).toHaveLength(8);
    expect(recovered.map((record) => record.Seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8
    ]);
    expect(recovered.map((record) => record.Action)).toEqual([
      "matchshift_baseline",
      "matchshift_event",
      "matchshift_event",
      "goal",
      "matchshift_event",
      "matchshift_event",
      "matchshift_event",
      "game_finalised"
    ]);
    expect(
      recovered.some((record) =>
        ["action_discarded", "action_amend", "match_clock"].includes(
          String(record.Action)
        )
      )
    ).toBe(false);

    expect(recovered[0]).toMatchObject({
      Ts: KICKOFF,
      ScoreSoccer: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    });
    expect(recovered[3]).toMatchObject({
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
    expect(recovered.at(-1)).toMatchObject({
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
    const events = normalized.filter(
      (record): record is MatchEventRecord => record.kind === "event"
    );
    const recoveries = normalized.filter(
      (record) => record.kind === "recovery"
    );

    expect(events.map((event) => event.eventType)).toEqual([
      "KICKOFF",
      "GOAL_DISALLOWED",
      "GOAL",
      "VAR_OVERTURNED",
      "GOAL_DISALLOWED",
      "MATCH_FINAL"
    ]);
    expect(events[1]).toMatchObject({
      eventType: "GOAL_DISALLOWED",
      team: "AWAY",
      matchSecond: 5_739,
      importance: "KEY"
    });
    expect(events[2]).toMatchObject({
      team: "HOME",
      minute: 106,
      matchSecond: 6_339,
      label: "Goal",
      importance: "KEY",
      phase: "EXTRA_TIME_SECOND_HALF",
      sourceTimestamp: KICKOFF + 6_339_000
    });
    expect(events[3]).toMatchObject({
      eventType: "VAR_OVERTURNED",
      matchSecond: 6_780,
      label: "VAR: decision overturned"
    });
    expect(events[4]).toMatchObject({
      eventType: "GOAL_DISALLOWED",
      team: "HOME",
      matchSecond: 6_780
    });
    expect(recoveries[0]).toMatchObject({
      snapshot: { score: { home: 0, away: 0 } }
    });
    expect(recoveries.at(-1)).toMatchObject({
      snapshot: { score: { home: 1, away: 0 } }
    });
  });

  it("deduplicates confirmed rich actions and omits discarded or technical records", () => {
    const recovered = recoverOpeningScorePrefixFromGoalActions(
      richZeroZeroLifecycle(),
      fixture
    ) as Array<Record<string, unknown>>;
    const events = normalizedEvents(recovered);

    expect(events.map((event) => event.eventType)).toEqual([
      "KICKOFF",
      "YELLOW_CARD",
      "CORNER",
      "HALF_TIME",
      "PERIOD_START",
      "EXTRA_TIME_START",
      "MATCH_FINAL"
    ]);
    expect(events.filter((event) => event.eventType === "YELLOW_CARD")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "CORNER")).toHaveLength(1);
    expect(events.find((event) => event.eventType === "YELLOW_CARD")).toMatchObject({
      team: "AWAY",
      minute: 11,
      matchSecond: 600,
      importance: "KEY",
      phase: "FIRST_HALF"
    });
    expect(events.find((event) => event.eventType === "CORNER")).toMatchObject({
      team: "HOME",
      minute: 17,
      matchSecond: 1_000,
      importance: "FULL"
    });
    expect(events.find((event) => event.eventType === "HALF_TIME")).toMatchObject({
      phase: "HALF_TIME"
    });
    expect(events.find((event) => event.eventType === "PERIOD_START")).toMatchObject({
      phase: "SECOND_HALF"
    });
    expect(events.find((event) => event.eventType === "EXTRA_TIME_START")).toMatchObject({
      phase: "EXTRA_TIME_FIRST_HALF"
    });

    const match = buildRichCuratedMatchDefinition({
      fixture,
      scoreRecords: normalizeCuratedHistoricalScores(
        recovered,
        fixture,
        KICKOFF + 24 * 60 * 60_000
      ),
      oddsRecords: [],
      publicFixtureId: "curated-rich-test",
      publicLabel: "Curated rich test",
      durationMinutes: 130
    });
    const curatedYellow = match.records.find(
      (record) => record.kind === "event" && record.eventType === "YELLOW_CARD"
    );
    expect(curatedYellow).toMatchObject({
      matchSecond: 600,
      label: "Yellow card",
      importance: "KEY",
      phase: "FIRST_HALF"
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
