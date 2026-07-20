import { describe, expect, it } from "vitest";
import { TxlineHttpError } from "../src/txline/http-client.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { hydrateSparseScoreHistory } from "../src/txline/sparse-score-history-hydration.js";

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

function scoreOf(value: unknown): Record<string, unknown> {
  return (value as { scoreSoccer: Record<string, unknown> }).scoreSoccer;
}

function goalsOf(
  value: unknown,
  participant: "Participant1" | "Participant2"
): number {
  const score = scoreOf(value);
  return (score[participant] as { Total: { Goals: number } }).Total.Goals;
}

function expectTxlineError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe(code);
    return;
  }
  throw new Error(`Expected TxlineHttpError with code ${code}.`);
}

describe("hydrateSparseScoreHistory", () => {
  it("anchors at kickoff and carries sparse participant goals forward", () => {
    const result = hydrateSparseScoreHistory(
      [
        {
          FixtureId: fixture.fixtureId,
          Seq: 1,
          Ts: START,
          Action: "KICKOFF",
          Score: {
            Participant1: { Total: { Corners: 0 } }
          }
        },
        {
          FixtureId: fixture.fixtureId,
          Seq: 2,
          Ts: START + 10 * 60_000,
          Action: "GOAL",
          Score: {
            Participant1: { Total: { Goals: 1 } }
          }
        },
        {
          FixtureId: fixture.fixtureId,
          Seq: 3,
          Ts: START + 12 * 60_000,
          Action: "CLOCK",
          Score: {
            Participant2: { Total: { YellowCards: 1 } }
          }
        },
        {
          FixtureId: fixture.fixtureId,
          Seq: 4,
          Ts: START + 40 * 60_000,
          Action: "GOAL",
          Score: {
            Participant2: { Total: { Goals: 1 } }
          }
        }
      ],
      fixture
    );

    expect(result.kickoffObserved).toBe(true);
    expect(result.hydratedRecords).toBe(4);
    expect(result.scoreChanges).toBe(2);
    expect(goalsOf(result.records[0], "Participant1")).toBe(0);
    expect(goalsOf(result.records[0], "Participant2")).toBe(0);
    expect(goalsOf(result.records[1], "Participant1")).toBe(1);
    expect(goalsOf(result.records[1], "Participant2")).toBe(0);
    expect(goalsOf(result.records[2], "Participant1")).toBe(1);
    expect(goalsOf(result.records[2], "Participant2")).toBe(0);
    expect(goalsOf(result.records[3], "Participant1")).toBe(1);
    expect(goalsOf(result.records[3], "Participant2")).toBe(1);
  });

  it("fails closed without a trusted kickoff anchor", () => {
    expectTxlineError(
      () =>
        hydrateSparseScoreHistory(
          [
            {
              FixtureId: fixture.fixtureId,
              Seq: 2,
              Ts: START + 60_000,
              Action: "GOAL",
              Score: {
                Participant1: { Total: { Goals: 1 } }
              }
            }
          ],
          fixture
        ),
      "SCORE_SPARSE_HYDRATION_NO_KICKOFF"
    );
  });

  it("fails closed on a score gap larger than one goal", () => {
    expectTxlineError(
      () =>
        hydrateSparseScoreHistory(
          [
            {
              FixtureId: fixture.fixtureId,
              Seq: 1,
              Ts: START,
              Action: "KICKOFF",
              Score: {}
            },
            {
              FixtureId: fixture.fixtureId,
              Seq: 2,
              Ts: START + 60_000,
              Action: "GOAL",
              Score: {
                Participant1: { Total: { Goals: 2 } }
              }
            }
          ],
          fixture
        ),
      "SCORE_SPARSE_HYDRATION_GAP"
    );
  });
});
