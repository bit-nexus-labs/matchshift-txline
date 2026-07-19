import { describe, expect, it } from "vitest";
import type { MatchEventRecord } from "../src/core/types.js";
import { normalizeCuratedHistoricalScores } from "../src/txline/curated-replay-exporter.js";
import { TxlineHttpError } from "../src/txline/http-client.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { recoverOpeningScorePrefixFromGoalActions } from "../src/txline/score-opening-prefix-recovery.js";
import { assertCompleteScoreProgression } from "../src/txline/score-snapshot-recovery.js";

const KICKOFF = Date.parse("2026-07-18T21:00:00.000Z");
const FIXTURE_ID = "private-fixture";

const fixture: NormalizedFixture = {
  fixtureId: FIXTURE_ID,
  startTime: KICKOFF,
  startTimestamp: KICKOFF,
  participant1: "France",
  participant2: "England",
  participant1IsHome: true,
  homeParticipant: "France",
  awayParticipant: "England",
  gameState: 5,
  selectionState: "SELECTABLE"
};

function partialGoal(
  seq: number,
  minute: number,
  participant: "Participant1" | "Participant2"
) {
  return {
    FixtureId: FIXTURE_ID,
    MessageId: `private-opening-goal-${seq}`,
    Seq: seq,
    Ts: KICKOFF + minute * 60_000,
    Action: "goal",
    DataSoccer: { Participant: participant, Minutes: minute },
    ScoreSoccer: {}
  };
}

function trustedSnapshot(seq = 31) {
  return {
    FixtureId: FIXTURE_ID,
    MessageId: "private-first-trusted-score",
    Seq: seq,
    Ts: KICKOFF + 70.6 * 60_000,
    Action: "period_update",
    ScoreSoccer: {
      Participant1: { Total: { Goals: 1 } },
      Participant2: { Total: { Goals: 4 } }
    }
  };
}

function completeOpeningRecords() {
  return [
    partialGoal(26, 8, "Participant2"),
    partialGoal(27, 19, "Participant2"),
    partialGoal(28, 31, "Participant2"),
    partialGoal(29, 43, "Participant2"),
    partialGoal(30, 55, "Participant1"),
    trustedSnapshot()
  ];
}

describe("curated opening score prefix recovery", () => {
  it("derives a contiguous 0-0 to 1-4 prefix only from matching TxLINE goal actions", () => {
    const recovered = recoverOpeningScorePrefixFromGoalActions(
      completeOpeningRecords(),
      fixture
    );

    expect(() => assertCompleteScoreProgression(recovered, fixture)).not.toThrow();
    const normalized = normalizeCuratedHistoricalScores(
      recovered,
      fixture,
      KICKOFF + 24 * 60 * 60_000
    );
    const opening = normalized.find((record) => record.kind === "recovery");
    const goals = normalized.filter(
      (record): record is MatchEventRecord =>
        record.kind === "event" && record.eventType === "GOAL"
    );

    expect(opening).toMatchObject({
      kind: "recovery",
      snapshot: { score: { home: 0, away: 0 } }
    });
    expect(goals).toHaveLength(5);
    expect(goals.filter((goal) => goal.team === "HOME")).toHaveLength(1);
    expect(goals.filter((goal) => goal.team === "AWAY")).toHaveLength(4);
  });

  it("fails closed when the goal-action side counts do not equal the first trusted score", () => {
    const incomplete = completeOpeningRecords().filter(
      (record) => record.MessageId !== "private-opening-goal-28"
    );
    const error = (() => {
      try {
        recoverOpeningScorePrefixFromGoalActions(incomplete, fixture);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe(
      "SCORE_OPENING_PREFIX_INCOMPLETE"
    );
    expect((error as Error).message).toContain(
      "reconstructed 1-3 from 4 goals, but the first trusted score was 1-4"
    );
    expect((error as Error).message).not.toContain(FIXTURE_ID);
    expect((error as Error).message).not.toContain("private-opening-goal");
  });
});
