import { describe, expect, it } from "vitest";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import { buildSanitizedResolvedLifecycleEvents } from "../src/txline/resolved-rich-lifecycle-events.js";

const kickoffTimestamp = Date.parse("2026-07-19T19:00:00.000Z");

const fixture: NormalizedFixture = {
  fixtureId: "fixture-private",
  startTime: kickoffTimestamp,
  startTimestamp: kickoffTimestamp,
  participant1: "Spain",
  participant2: "Argentina",
  participant1IsHome: true,
  homeParticipant: "Spain",
  awayParticipant: "Argentina",
  selectionState: "SELECTABLE"
};

describe("resolved rich lifecycle event builder", () => {
  it("orders and deduplicates only already-resolved actions", () => {
    const events = buildSanitizedResolvedLifecycleEvents(
      [
        {
          sourceSequence: 8,
          action: "game_finalised",
          clockSeconds: 120 * 60
        },
        {
          sourceSequence: 4,
          action: "corner",
          clockSeconds: 50 * 60,
          participant: "Participant1"
        },
        {
          sourceSequence: 3,
          action: "yellow_card",
          clockSeconds: 12 * 60 + 23,
          participant: "Participant2"
        },
        {
          sourceSequence: 5,
          action: "corner",
          clockSeconds: 50 * 60,
          participant: "Participant1"
        },
        {
          sourceSequence: 6,
          action: "action_amend",
          clockSeconds: 50 * 60
        }
      ],
      fixture
    );

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.eventType)).toEqual([
      "YELLOW_CARD",
      "CORNER",
      "MATCH_FINAL"
    ]);
    expect(events[0]).toMatchObject({
      sourceSequence: 3,
      sourceTimestamp: kickoffTimestamp + 743_000,
      team: "AWAY",
      importance: "KEY"
    });
    expect(events[1]).toMatchObject({
      sourceSequence: 5,
      sourceTimestamp: kickoffTimestamp + 3_000_000,
      team: "HOME",
      importance: "FULL"
    });
  });

  it("drops invalid local lifecycle sequences fail-closed", () => {
    expect(
      buildSanitizedResolvedLifecycleEvents(
        [
          {
            sourceSequence: 0,
            action: "red_card",
            clockSeconds: 30 * 60,
            participant: 2
          },
          {
            sourceSequence: 2.5,
            action: "goal",
            clockSeconds: 31 * 60,
            participant: 1
          }
        ],
        fixture
      )
    ).toEqual([]);
  });
});
