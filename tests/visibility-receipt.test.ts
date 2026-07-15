import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createVisibilityReceipt } from "../src/core/visibility-receipt.js";
import type { VisibleMatchState } from "../src/core/types.js";
import { buildApp } from "../src/server.js";
import { T0 } from "../src/replay/synthetic-scenario.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

function state(cursor = T0): VisibleMatchState {
  return {
    fixtureId: "fixture-1",
    source: {
      label: "Alpha vs Beta",
      provenance: "SYNTHETIC"
    },
    session: {
      sessionId: "session-1",
      mode: "DELAYED",
      statusBadge: "DELAYED",
      visibilityCursor: cursor,
      viewerMinute: Math.floor((cursor - T0) / 60_000)
    },
    score: { home: 0, away: 0 },
    events: [
      {
        eventId: "kickoff",
        sequence: 1,
        sourceTimestamp: T0,
        eventType: "KICKOFF",
        minute: 0
      }
    ],
    impliedProbabilities: {
      homeWin: 0.44,
      draw: 0.31,
      awayWin: 0.25
    },
    safety: { active: false }
  };
}

describe("visibility receipt", () => {
  it("produces the same SHA-256 receipt for the same visible state", () => {
    const first = createVisibilityReceipt(state(T0 + 10 * 60_000));
    const second = createVisibilityReceipt(state(T0 + 10 * 60_000));

    expect(first).toEqual(second);
    expect(first.version).toBe("matchshift-receipt-v1");
    expect(first.stateHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes when the effective visible cursor changes", () => {
    const earlier = createVisibilityReceipt(state(T0 + 10 * 60_000));
    const later = createVisibilityReceipt(state(T0 + 11 * 60_000));

    expect(earlier.stateHash).not.toBe(later.stateHash);
  });

  it("returns a delayed-session receipt without raw or future identifiers", async () => {
    app = buildApp();
    const started = await app.inject({
      method: "POST",
      url: "/api/demo/start",
      payload: {}
    });
    const demo = started.json<{
      personal: { session: { sessionId: string } };
    }>();

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${demo.personal.session.sessionId}/receipt`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<{
      receipt: {
        version: string;
        mode: string;
        viewerMinute: number;
        visibleEventCount: number;
        score: { home: number; away: number };
        stateHash: string;
      };
      note: string;
    }>();

    expect(body.receipt).toMatchObject({
      version: "matchshift-receipt-v1",
      mode: "DELAYED",
      viewerMinute: 43,
      visibleEventCount: 1,
      score: { home: 0, away: 0 }
    });
    expect(body.receipt.stateHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.note).toContain("not a provider signature");
    expect(response.body).not.toContain("synthetic-home-goal-49");
    expect(response.body).not.toContain("synthetic-odds-postgoal");
    expect(response.body).not.toContain("records");
    expect(response.body).not.toContain("0.68");
  });

  it("updates the receipt only after the session cursor advances", async () => {
    app = buildApp();
    const started = await app.inject({
      method: "POST",
      url: "/api/demo/start",
      payload: {}
    });
    const demo = started.json<{
      personal: { session: { sessionId: string } };
    }>();
    const sessionId = demo.personal.session.sessionId;

    const before = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/receipt`
    });
    await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      payload: {
        type: "ADVANCE_TO",
        cursorMs: T0 + 49 * 60_000
      }
    });
    const after = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/receipt`
    });

    const beforeReceipt = before.json<{ receipt: { stateHash: string } }>().receipt;
    const afterReceipt = after.json<{
      receipt: {
        stateHash: string;
        score: { home: number; away: number };
        visibleEventCount: number;
      };
    }>().receipt;

    expect(afterReceipt.stateHash).not.toBe(beforeReceipt.stateHash);
    expect(afterReceipt.score).toEqual({ home: 1, away: 0 });
    expect(afterReceipt.visibleEventCount).toBe(2);
  });
});
