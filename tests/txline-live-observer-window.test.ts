import { describe, expect, it } from "vitest";
import {
  observeLiveInputForWindow,
  selectLiveCandidateFixtureIds,
  type LiveObserverWindowDependencies
} from "../src/txline/live-observer-window.js";
import type { LiveObserverResult } from "../src/txline/live-observer.js";
import { normalizeFixtures } from "../src/txline/normalizer.js";

function result(status: LiveObserverResult["status"]): LiveObserverResult {
  return {
    status,
    receipt: `TXLINE LIVE INPUT OBSERVER: ${status}`
  };
}

describe("TxLINE full-window live observer runner", () => {
  it("retries early NOT_OBSERVED results until the configured window ends", async () => {
    let now = 0;
    const attempts: number[] = [];
    const dependencies: LiveObserverWindowDependencies = {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      observe: async (env) => {
        attempts.push(Number(env.TXLINE_LIVE_OBSERVE_MS));
        return result("NOT_OBSERVED");
      }
    };

    const final = await observeLiveInputForWindow(
      { TXLINE_LIVE_OBSERVE_MS: "2500" },
      dependencies
    );

    expect(final.status).toBe("NOT_OBSERVED");
    expect(now).toBe(2500);
    expect(attempts).toEqual([2500, 1500, 500]);
  });

  it("returns immediately when a later retry observes a live record", async () => {
    let now = 0;
    let calls = 0;
    const dependencies: LiveObserverWindowDependencies = {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      observe: async () => {
        calls += 1;
        return result(calls === 2 ? "PASS" : "NOT_OBSERVED");
      }
    };

    const final = await observeLiveInputForWindow(
      { TXLINE_LIVE_OBSERVE_MS: "10000" },
      dependencies
    );

    expect(final.status).toBe("PASS");
    expect(calls).toBe(2);
    expect(now).toBe(1000);
  });

  it("orders nearby live candidates before future candidates", () => {
    const now = Date.UTC(2026, 6, 18, 21, 0, 0);
    const fixtures = normalizeFixtures([
      {
        FixtureId: "future",
        StartTime: now + 10 * 60_000,
        Participant1: "Alpha",
        Participant2: "Beta",
        Participant1IsHome: true
      },
      {
        FixtureId: "started-near",
        StartTime: now - 5 * 60_000,
        Participant1: "Gamma",
        Participant2: "Delta",
        Participant1IsHome: true
      },
      {
        FixtureId: "started-far",
        StartTime: now - 30 * 60_000,
        Participant1: "Epsilon",
        Participant2: "Zeta",
        Participant1IsHome: true
      }
    ]);

    expect(selectLiveCandidateFixtureIds(fixtures, now, 6)).toEqual([
      "started-near",
      "started-far",
      "future"
    ]);
  });

  it("rotates nearby fixtures across early retries", async () => {
    let now = 0;
    const selected: Array<string | undefined> = [];
    const dependencies: LiveObserverWindowDependencies = {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      discover: async () => ["fixture-a", "fixture-b"],
      observe: async (env) => {
        selected.push(env.TXLINE_LIVE_FIXTURE_ID);
        return result(selected.length === 2 ? "PASS" : "NOT_OBSERVED");
      }
    };

    const final = await observeLiveInputForWindow(
      { TXLINE_LIVE_OBSERVE_MS: "10000" },
      dependencies
    );

    expect(final.status).toBe("PASS");
    expect(selected).toEqual(["fixture-a", "fixture-b"]);
  });
});
