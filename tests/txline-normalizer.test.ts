import { describe, expect, it } from "vitest";
import {
  normalizeFixtures,
  normalizeOddsPayload,
  normalizePayloads,
  normalizeScorePayload
} from "../src/txline/normalizer.js";

describe("TxLINE normalizer", () => {
  it("preserves observed sequence, timestamp, fixture, and source message id", () => {
    const normalized = normalizeScorePayload(
      {
        FixtureId: 17271370,
        Seq: 41,
        Ts: 1_784_140_000,
        MessageId: "score-message-41",
        action: "goal",
        team: "home",
        minute: 49
      },
      { receivedTimestamp: 1_784_140_001_000 }
    );

    expect(normalized.safeHold).toBe(false);
    expect(normalized.records).toHaveLength(1);
    expect(normalized.records[0]).toMatchObject({
      fixtureId: "17271370",
      sequence: 41,
      sourceTimestamp: 1_784_140_000_000,
      recordId: "score-message-41",
      provenance: "TXLINE",
      kind: "event",
      eventType: "GOAL"
    });
  });

  it("fails closed for missing ordering or invalid timestamps", () => {
    const noSequence = normalizeScorePayload({
      FixtureId: 1,
      Ts: 1_784_140_000,
      action: "kickoff"
    });
    const badTimestamp = normalizeOddsPayload({
      FixtureId: 1,
      seq: 7,
      ts: "not-a-time",
      homeProbability: 0.5,
      drawProbability: 0.25,
      awayProbability: 0.25
    });

    expect(noSequence.safeHold).toBe(true);
    expect(noSequence.issues[0]?.code).toBe("MISSING_SEQUENCE");
    expect(noSequence.records).toEqual([]);
    expect(badTimestamp.safeHold).toBe(true);
    expect(badTimestamp.issues[0]?.code).toBe("INVALID_TIMESTAMP");
    expect(badTimestamp.records).toEqual([]);
  });

  it("handles action=disconnected without statusId", () => {
    const score = normalizeScorePayload({
      fixtureId: "fixture-1",
      seq: 9,
      ts: 1_784_140_000,
      action: "disconnected"
    });
    const odds = normalizeOddsPayload({
      fixtureId: "fixture-1",
      seq: 10,
      ts: 1_784_140_001,
      action: "disconnected"
    });

    expect(score.disconnected).toBe(true);
    expect(score.safeHold).toBe(false);
    expect(score.records).toEqual([]);
    expect(odds.disconnected).toBe(true);
    expect(odds.safeHold).toBe(false);
    expect(odds.records).toEqual([]);
  });

  it("fails closed when snapshot source time regresses across sequence", () => {
    const normalized = normalizePayloads(
      [
        {
          FixtureId: 1,
          Seq: 11,
          Ts: 1_784_140_200,
          homeProbability: 0.5,
          drawProbability: 0.3,
          awayProbability: 0.2
        },
        {
          FixtureId: 1,
          Seq: 12,
          Ts: 1_784_140_100,
          homeProbability: 0.4,
          drawProbability: 0.3,
          awayProbability: 0.3
        }
      ],
      "odds"
    );

    expect(normalized.safeHold).toBe(true);
    expect(normalized.records).toEqual([]);
    expect(normalized.issues[0]?.code).toBe("INVALID_ORDERING");
  });

  it("excludes cancelled fixtures and marks legacy duplicates ambiguous", () => {
    const fixtures = normalizeFixtures([
      {
        FixtureId: 1,
        StartTime: "2026-07-15T18:00:00.000Z",
        Participant1: "Alpha",
        Participant2: "Beta",
        Participant1IsHome: false,
        GameState: 1
      },
      {
        FixtureId: 2,
        StartTime: "2026-07-15T18:00:00.000Z",
        Participant1: "Alpha",
        Participant2: "Beta",
        Participant1IsHome: false
      },
      {
        FixtureId: 3,
        StartTime: "2026-07-15T20:00:00.000Z",
        Participant1: "Gamma",
        Participant2: "Delta",
        Participant1IsHome: true,
        GameState: 6
      }
    ]);

    expect(fixtures).toHaveLength(2);
    expect(fixtures[0]).toMatchObject({
      fixtureId: "1",
      homeParticipant: "Beta",
      awayParticipant: "Alpha",
      selectionState: "SELECTABLE"
    });
    expect(fixtures[1]?.selectionState).toBe("AMBIGUOUS");
    expect(fixtures.some((fixture) => fixture.fixtureId === "3")).toBe(false);
  });

  it("maps participant probabilities using Participant1IsHome", () => {
    const fixture = normalizeFixtures([
      {
        FixtureId: 1,
        StartTime: "2026-07-15T18:00:00.000Z",
        Participant1: "Alpha",
        Participant2: "Beta",
        Participant1IsHome: false,
        GameState: 1
      }
    ])[0];
    expect(fixture).toBeDefined();
    if (fixture === undefined) {
      throw new Error("Expected normalized fixture.");
    }

    const normalized = normalizeOddsPayload(
      {
        FixtureId: 1,
        seq: 5,
        ts: 1_784_140_000,
        Participant1Probability: 0.2,
        DrawProbability: 0.3,
        Participant2Probability: 0.5
      },
      { fixture }
    );

    expect(normalized.records[0]).toMatchObject({
      kind: "odds",
      impliedProbabilities: {
        homeWin: 0.5,
        draw: 0.3,
        awayWin: 0.2
      }
    });
  });
});
