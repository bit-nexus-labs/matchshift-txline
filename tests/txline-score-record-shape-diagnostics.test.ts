import { describe, expect, it } from "vitest";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import {
  diagnoseScoreRecordShape,
  formatScoreRecordShapeDiagnostics
} from "../src/txline/score-record-shape-diagnostics.js";

const START = Date.parse("2026-07-19T19:05:00.000Z");

const fixture: NormalizedFixture = {
  fixtureId: "private-fixture",
  startTime: START,
  startTimestamp: START,
  participant1: "Spain",
  participant2: "Argentina",
  participant1IsHome: true,
  homeParticipant: "Spain",
  awayParticipant: "Argentina",
  gameState: 5,
  selectionState: "SELECTABLE"
};

function score(home: number, away: number) {
  return {
    Participant1: { Total: { Goals: home } },
    Participant2: { Total: { Goals: away } }
  };
}

describe("sanitized score record shape diagnostics", () => {
  it("distinguishes trusted nested score objects from stringified score JSON", () => {
    const diagnostics = diagnoseScoreRecordShape(
      [
        {
          FixtureId: fixture.fixtureId,
          Seq: 1,
          Ts: START,
          Action: "kickoff",
          ScoreSoccer: score(0, 0)
        },
        {
          FixtureId: fixture.fixtureId,
          Seq: 2,
          Ts: START + 60_000,
          Action: "goal",
          scoreSoccer: JSON.stringify(score(1, 0))
        }
      ],
      fixture,
      START + 120_000
    );

    expect(diagnostics.recordCount).toBe(2);
    expect(diagnostics.recoveryCount).toBe(1);
    expect(diagnostics.issueCounts.MALFORMED_SCORE).toBe(1);
    expect(
      diagnostics.schemaPaths.some(
        (item) =>
          item.path.endsWith(".ScoreSoccer.Participant1.Total.Goals") &&
          item.types.includes("number")
      )
    ).toBe(true);
    expect(
      diagnostics.schemaPaths.some(
        (item) =>
          item.path.endsWith(".scoreSoccer") &&
          item.types.includes("string(json-object)")
      )
    ).toBe(true);
    expect(
      diagnostics.schemaPaths.some((item) =>
        item.path.endsWith(".scoreSoccer<json>.Participant2.Total.Goals")
      )
    ).toBe(true);

    const formatted = formatScoreRecordShapeDiagnostics(diagnostics);
    expect(formatted).not.toContain(fixture.fixtureId);
    expect(formatted).not.toContain("Spain");
    expect(formatted).not.toContain("Argentina");
  });
});
