import { describe, expect, it } from "vitest";
import {
  observeLiveInputForWindow,
  type LiveObserverWindowDependencies
} from "../src/txline/live-observer-window-cli.js";
import type { LiveObserverResult } from "../src/txline/live-observer.js";

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
});
