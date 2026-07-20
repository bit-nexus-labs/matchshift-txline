import { describe, expect, it } from "vitest";
import { recoverSanitizedCompletedRichEvents } from "../src/txline/confirmed-score-lifecycle-recovery.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";

const KICKOFF = Date.parse("2026-07-19T19:05:00.000Z");
const FIXTURE_ID = "fixture-rich-lifecycle-test";

const fixture: NormalizedFixture = {
  fixtureId: FIXTURE_ID,
  startTime: KICKOFF,
  startTimestamp: KICKOFF,
  participant1: "Spain",
  participant2: "Argentina",
  participant1IsHome: true,
  homeParticipant: "Spain",
  awayParticipant: "Argentina",
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

function richCompletedLifecycle(): Array<Record<string, unknown>> {
  return [
    action(10, "kickoff", {
      Id: 100,
      Confirmed: true,
      Clock: { Running: true, Seconds: 0 }
    }),
    action(20, "yellow_card", {
      Id: 200,
      Confirmed: true,
      Participant: 2,
      PlayerId: 9_001,
      Clock: { Running: true, Seconds: 743 }
    }),
    action(30, "corner", {
      Id: 300,
      Confirmed: false,
      Participant: 1,
      Clock: { Running: true, Seconds: 3_000 }
    }),
    action(31, "corner", {
      Id: 300,
      Confirmed: true,
      Participant: 1,
      Clock: { Running: true, Seconds: 3_000 }
    }),
    action(35, "red_card", {
      Id: 350,
      Confirmed: true,
      Participant: 2,
      Clock: { Running: true, Seconds: 3_300 }
    }),
    action(36, "action_discarded", {
      Id: 350,
      Clock: { Running: true, Seconds: 3_300 }
    }),
    action(40, "goal", {
      Id: 400,
      Confirmed: true,
      Participant: 1,
      PlayerId: 9_999,
      Clock: { Running: true, Seconds: 6_339 },
      Score: {
        Participant1: { Total: { Goals: 1 } }
      }
    }),
    action(45, "var_end", {
      Id: 450,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_780 },
      Data: { Outcome: "Overturned", PlayerId: 9_999 }
    }),
    action(50, "injury", {
      Id: 500,
      Confirmed: false,
      Participant: 2,
      Clock: { Running: true, Seconds: 7_000 }
    }),
    action(51, "safe_possession", {
      Id: 510,
      Participant: 1,
      Clock: { Running: true, Seconds: 7_502 }
    }),
    action(60, "game_finalised", {
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

describe("confirmed rich TxLINE lifecycle recovery", () => {
  it("uses the existing lifecycle to resolve meaningful sanitized events", () => {
    const events = recoverSanitizedCompletedRichEvents(
      richCompletedLifecycle(),
      fixture
    );

    expect(events.map((event) => event.eventType)).toEqual([
      "KICKOFF",
      "YELLOW_CARD",
      "CORNER",
      "GOAL",
      "VAR_OVERTURNED",
      "MATCH_FINAL"
    ]);
    expect(events[1]).toMatchObject({
      team: "AWAY",
      matchSecond: 743,
      minute: 13,
      importance: "KEY"
    });
    expect(events[2]).toMatchObject({
      team: "HOME",
      matchSecond: 3_000,
      importance: "FULL",
      sourceSequence: 31
    });
    expect(events.at(-1)).toMatchObject({
      eventType: "MATCH_FINAL",
      matchSecond: 7_502,
      phase: "FINISHED"
    });

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(FIXTURE_ID);
    expect(serialized).not.toContain("9001");
    expect(serialized).not.toContain("9999");
    expect(serialized).not.toContain("PlayerId");
  });

  it("drops discarded and never-confirmed non-goal actions fail-closed", () => {
    const events = recoverSanitizedCompletedRichEvents(
      richCompletedLifecycle(),
      fixture
    );

    expect(events.some((event) => event.eventType === "RED_CARD")).toBe(false);
    expect(events.some((event) => event.eventType === "INJURY")).toBe(false);
  });
});
