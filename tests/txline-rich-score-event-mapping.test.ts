import { describe, expect, it } from "vitest";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { mapResolvedScoreActionToRichEvent } from "../src/txline/rich-score-event-mapping.js";

const fixture: NormalizedFixture = {
  fixtureId: "private-provider-id-not-exported",
  startTime: "2026-07-19T19:00:00.000Z",
  startTimestamp: Date.parse("2026-07-19T19:00:00.000Z"),
  participant1: "Spain",
  participant2: "Argentina",
  participant1IsHome: true,
  homeParticipant: "Spain",
  awayParticipant: "Argentina",
  selectionState: "SELECTABLE"
};

describe("rich score event mapping", () => {
  it("maps a resolved card without retaining provider identity", () => {
    expect(
      mapResolvedScoreActionToRichEvent(
        {
          action: "yellow_card",
          clockSeconds: 12 * 60 + 23,
          participant: "Participant2"
        },
        fixture
      )
    ).toEqual({
      eventType: "YELLOW_CARD",
      team: "AWAY",
      minute: 13,
      matchSecond: 743,
      label: "Yellow card",
      importance: "KEY",
      phase: "FIRST_HALF"
    });
  });

  it("maps full-timeline actions and fixture-relative team sides", () => {
    expect(
      mapResolvedScoreActionToRichEvent(
        {
          action: "corner",
          clockSeconds: 50 * 60,
          participant: 1
        },
        fixture
      )
    ).toEqual({
      eventType: "CORNER",
      team: "HOME",
      minute: 51,
      matchSecond: 3_000,
      label: "Corner",
      importance: "FULL",
      phase: "SECOND_HALF"
    });
  });

  it("maps overturned VAR and final lifecycle milestones", () => {
    expect(
      mapResolvedScoreActionToRichEvent(
        {
          action: "var_end",
          outcome: "overturned",
          clockSeconds: 106 * 60
        },
        fixture
      )
    ).toMatchObject({
      eventType: "VAR_OVERTURNED",
      importance: "KEY",
      phase: "EXTRA_TIME_SECOND_HALF"
    });

    expect(
      mapResolvedScoreActionToRichEvent(
        { action: "game_finalised", clockSeconds: 120 * 60 },
        fixture
      )
    ).toEqual({
      eventType: "MATCH_FINAL",
      minute: 121,
      matchSecond: 7_200,
      label: "Match finalised",
      importance: "KEY",
      phase: "FINISHED"
    });
  });

  it("ignores technical, unsupported, and invalid-clock records", () => {
    expect(
      mapResolvedScoreActionToRichEvent(
        { action: "action_amend", clockSeconds: 600 },
        fixture
      )
    ).toBeUndefined();
    expect(
      mapResolvedScoreActionToRichEvent(
        { action: "clock_update", clockSeconds: 600 },
        fixture
      )
    ).toBeUndefined();
    expect(
      mapResolvedScoreActionToRichEvent(
        { action: "corner", clockSeconds: -1, participant: 1 },
        fixture
      )
    ).toBeUndefined();
  });
});
