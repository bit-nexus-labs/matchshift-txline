import { describe, expect, it } from "vitest";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import {
  diagnoseOpeningScoreAnchors,
  formatOpeningScoreAnchorDiagnostics
} from "../src/txline/opening-score-anchor-diagnostics.js";

const START = Date.parse("2026-07-19T19:05:00.000Z");

const fixture: NormalizedFixture = {
  fixtureId: "fixture-safe-test",
  startTime: START,
  startTimestamp: START,
  participant1: "Spain",
  participant2: "Argentina",
  participant1IsHome: true,
  homeParticipant: "Spain",
  awayParticipant: "Argentina",
  selectionState: "SELECTABLE"
};

describe("opening score anchor diagnostics", () => {
  it("summarizes bounded provider anchor and goal-transition evidence", () => {
    const diagnostics = diagnoseOpeningScoreAnchors(
      [
        {
          FixtureId: fixture.fixtureId,
          StartTime: START,
          Ts: START + 1_000,
          Seq: 1,
          Action: "ScoreUpdate",
          GameState: "Live",
          Kickoff: { Team: "Participant1" },
          Clock: { Seconds: 0, Running: true },
          Score: {
            Participant1: { Total: { Goals: 0 } }
          },
          Data: { Action: "ClockUpdate" }
        },
        {
          FixtureId: fixture.fixtureId,
          StartTime: START,
          Ts: START + 60_000,
          Seq: 2,
          Action: "Goal",
          GameState: "Live",
          DataSoccer: {
            Action: "Goal",
            Participant: "Participant2",
            Minutes: 1,
            New: { Clock: { Seconds: 60, Running: true } }
          },
          ScoreSoccer: {
            Participant2: { Total: { Goals: 1 } }
          }
        },
        {
          FixtureId: "other-fixture",
          Ts: START,
          Action: "Ignored"
        }
      ],
      fixture
    );

    expect(diagnostics.records).toBe(3);
    expect(diagnostics.fixtureScopedRecords).toBe(2);
    expect(diagnostics.earliestOffsetSeconds).toBe(1);
    expect(diagnostics.startTimeMatches).toBe(2);
    expect(diagnostics.rootKickoffObjects).toBe(1);
    expect(diagnostics.clockRecords).toBe(2);
    expect(diagnostics.nearZeroClockRecords).toBe(2);
    expect(diagnostics.runningClockRecords).toBe(2);
    expect(diagnostics.participant1GoalRecords).toBe(1);
    expect(diagnostics.participant2GoalRecords).toBe(1);
    expect(diagnostics.maxParticipant1Goals).toBe(0);
    expect(diagnostics.maxParticipant2Goals).toBe(1);
    expect(diagnostics.goalActionRecords).toBe(1);
    expect(diagnostics.uniqueGoalTransitions).toBe(1);
    expect(diagnostics.duplicateGoalActionRecords).toBe(0);
    expect(diagnostics.normalizedGoalEvents).toBe(1);
    expect(diagnostics.homeGoalEvents).toBe(0);
    expect(diagnostics.awayGoalEvents).toBe(1);
    expect(diagnostics.unknownGoalEvents).toBe(0);
    expect(diagnostics.firstGoalOffsetSeconds).toBe(60);
    expect(diagnostics.goalTransitions).toEqual([
      {
        offsetSeconds: 60,
        team: "AWAY",
        minute: 1,
        participant2Goals: 1,
        rootKickoff: false
      }
    ]);
    expect(diagnostics.topLevelActions).toEqual([
      { value: "goal", count: 1 },
      { value: "scoreupdate", count: 1 }
    ]);
    expect(diagnostics.nestedSoccerActions).toEqual([
      { value: "clockupdate", count: 1 },
      { value: "goal", count: 1 }
    ]);
    expect(diagnostics.gameStates).toEqual([
      { value: "live", count: 2 }
    ]);
  });

  it("deduplicates repeated provider records for one score transition", () => {
    const repeatedGoal = {
      FixtureId: fixture.fixtureId,
      StartTime: START,
      Action: "Goal",
      GameState: "Live",
      DataSoccer: {
        Participant: "Participant1",
        Minutes: 106
      },
      Score: {
        Participant1: { Total: { Goals: 1 } }
      }
    };
    const diagnostics = diagnoseOpeningScoreAnchors(
      [
        { ...repeatedGoal, Seq: 10, Ts: START + 106 * 60_000 },
        { ...repeatedGoal, Seq: 11, Ts: START + 106 * 60_000 + 2_000 },
        { ...repeatedGoal, Seq: 12, Ts: START + 106 * 60_000 + 4_000 }
      ],
      fixture
    );

    expect(diagnostics.goalActionRecords).toBe(3);
    expect(diagnostics.uniqueGoalTransitions).toBe(1);
    expect(diagnostics.duplicateGoalActionRecords).toBe(2);
    expect(diagnostics.normalizedGoalEvents).toBe(3);
    expect(diagnostics.maxParticipant1Goals).toBe(1);
  });

  it("formats only aggregate and bounded transition evidence", () => {
    const output = formatOpeningScoreAnchorDiagnostics({
      records: 2,
      fixtureScopedRecords: 2,
      earliestOffsetSeconds: 1,
      startTimeMatches: 2,
      rootKickoffObjects: 1,
      clockRecords: 2,
      nearZeroClockRecords: 2,
      runningClockRecords: 1,
      participant1GoalRecords: 1,
      participant2GoalRecords: 0,
      goalActionRecords: 3,
      uniqueGoalTransitions: 1,
      duplicateGoalActionRecords: 2,
      normalizedGoalEvents: 3,
      homeGoalEvents: 3,
      awayGoalEvents: 0,
      unknownGoalEvents: 0,
      firstGoalOffsetSeconds: 60,
      maxParticipant1Goals: 1,
      goalTransitions: [
        {
          offsetSeconds: 60,
          team: "HOME",
          minute: 1,
          participant1Goals: 1,
          rootKickoff: true
        }
      ],
      topLevelActions: [{ value: "goal", count: 3 }],
      nestedSoccerActions: [],
      gameStates: [{ value: "live", count: 2 }]
    });

    expect(output).toContain("earliest-offset=1s");
    expect(output).toContain("root-kickoff=1");
    expect(output).toContain(
      "Goal action evidence: records=3; unique-transitions=1; duplicates=2"
    );
    expect(output).toContain("team=HOME");
    expect(output).toContain("p1=1");
    expect(output).toContain("Top-level action enums: goal=3");
    expect(output).toContain("Soccer action enums: NONE");
    expect(output).not.toContain(fixture.fixtureId);
  });
});
