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
  it("summarizes bounded provider anchor evidence without identifiers", () => {
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
          Action: "ScoreUpdate",
          GameState: "Live",
          DataSoccer: {
            Action: "Goal",
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
    expect(diagnostics.topLevelActions).toEqual([
      { value: "scoreupdate", count: 2 }
    ]);
    expect(diagnostics.nestedSoccerActions).toEqual([
      { value: "clockupdate", count: 1 },
      { value: "goal", count: 1 }
    ]);
    expect(diagnostics.gameStates).toEqual([
      { value: "live", count: 2 }
    ]);
  });

  it("formats only aggregate enum and count evidence", () => {
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
      topLevelActions: [{ value: "scoreupdate", count: 2 }],
      nestedSoccerActions: [],
      gameStates: [{ value: "live", count: 2 }]
    });

    expect(output).toContain("earliest-offset=1s");
    expect(output).toContain("root-kickoff=1");
    expect(output).toContain("Top-level action enums: scoreupdate=2");
    expect(output).toContain("Soccer action enums: NONE");
    expect(output).not.toContain(fixture.fixtureId);
  });
});
