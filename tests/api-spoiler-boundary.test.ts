import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import {
  SYNTHETIC_FIXTURE_ID,
  T0
} from "../src/replay/synthetic-scenario.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

describe("API spoiler boundary", () => {
  it("keeps a rewound LIVE session behind the spoiler boundary", async () => {
    app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        fixtureId: SYNTHETIC_FIXTURE_ID,
        mode: "LIVE"
      }
    });
    const created = createResponse.json<{
      session: { sessionId: string };
    }>();

    const rewindResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${created.session.sessionId}`,
      payload: {
        type: "ADVANCE_TO",
        cursorMs: T0 + 43 * 60_000
      }
    });
    const rewound = rewindResponse.json<{
      session: { mode: string; visibilityCursor: number };
      state: {
        score: { home: number; away: number };
        events: Array<{ eventType: string }>;
        impliedProbabilities: { homeWin: number };
      };
    }>();

    expect(rewindResponse.statusCode).toBe(200);
    expect(rewound.session.mode).toBe("DELAYED");
    expect(rewound.session.visibilityCursor).toBe(T0 + 43 * 60_000);
    expect(rewound.state.score).toEqual({ home: 0, away: 0 });
    expect(
      rewound.state.events.some((event) => event.eventType === "GOAL")
    ).toBe(false);
    expect(rewound.state.impliedProbabilities.homeWin).toBe(0.44);
    expect(rewindResponse.body).not.toContain("synthetic-home-goal-49");
    expect(rewindResponse.body).not.toContain("synthetic-odds-postgoal");
    expect(rewindResponse.body).not.toContain("0.68");
  });

  it("does not return future goal data to the delayed viewer", async () => {
    app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        fixtureId: SYNTHETIC_FIXTURE_ID,
        mode: "DELAYED",
        visibilityCursor: T0 + 43 * 60_000
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      session: { sessionId: string };
    }>();
    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${created.session.sessionId}/state`
    });
    const state = stateResponse.json<{
      score: { home: number; away: number };
      events: Array<{ eventType: string; eventId: string }>;
      impliedProbabilities: { homeWin: number };
      latestExplanation?: string;
    }>();
    const serialized = stateResponse.body;

    expect(stateResponse.statusCode).toBe(200);
    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(state.events.some((event) => event.eventType === "GOAL")).toBe(false);
    expect(state.impliedProbabilities.homeWin).toBe(0.44);
    expect(state.latestExplanation).not.toContain("scored");
    expect(serialized).not.toContain("synthetic-home-goal-49");
    expect(serialized).not.toContain("synthetic-odds-postgoal");
    expect(serialized).not.toContain("0.68");
  });

  it("reveals goal and odds only after advancing through both timestamps", async () => {
    app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        fixtureId: SYNTHETIC_FIXTURE_ID,
        mode: "DELAYED",
        visibilityCursor: T0 + 43 * 60_000
      }
    });
    const created = createResponse.json<{
      session: { sessionId: string };
    }>();

    const atGoalResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${created.session.sessionId}`,
      payload: {
        type: "ADVANCE_TO",
        cursorMs: T0 + 49 * 60_000
      }
    });
    const atGoal = atGoalResponse.json<{
      state: {
        score: { home: number; away: number };
        impliedProbabilities: { homeWin: number };
      };
    }>();

    const afterOddsResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${created.session.sessionId}`,
      payload: {
        type: "ADVANCE_TO",
        cursorMs: T0 + 49 * 60_000 + 10_000
      }
    });
    const afterOdds = afterOddsResponse.json<{
      state: {
        score: { home: number; away: number };
        impliedProbabilities: { homeWin: number };
      };
    }>();

    expect(atGoal.state.score).toEqual({ home: 1, away: 0 });
    expect(atGoal.state.impliedProbabilities.homeWin).toBe(0.44);
    expect(afterOdds.state.score).toEqual({ home: 1, away: 0 });
    expect(afterOdds.state.impliedProbabilities.homeWin).toBe(0.68);
  });
});
