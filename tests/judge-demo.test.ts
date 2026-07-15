import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { T0 } from "../src/replay/synthetic-scenario.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

describe("judge-facing demo", () => {
  it("serves a self-contained no-auth page with security headers", async () => {
    app = buildApp();

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toContain(
      "connect-src 'self'"
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body).toContain("Watch on your time");
    expect(response.body).toContain("Start spoiler-safe demo");
    expect(response.body).not.toContain("synthetic-home-goal-49");
    expect(response.body).not.toContain("TXLINE_API_TOKEN");
  });

  it("lists sanitized fixture metadata without raw records", async () => {
    app = buildApp();

    const response = await app.inject({ method: "GET", url: "/api/fixtures" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      fixtures: Array<Record<string, unknown>>;
    }>();
    expect(body.fixtures.length).toBeGreaterThan(0);
    expect(body.fixtures[0]).toMatchObject({
      fixtureId: "synthetic-matchshift-001",
      provenance: "SYNTHETIC"
    });
    expect(response.body).not.toContain("records");
    expect(response.body).not.toContain("synthetic-home-goal-49");
  });

  it("creates live and delayed sessions with independently derived states", async () => {
    app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/demo/start",
      payload: {}
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      fixture: {
        kickoffTimestamp: number;
        liveEdgeTimestamp: number;
        maxMinute: number;
      };
      live: {
        session: { sessionId: string; mode: string };
        state: {
          score: { home: number; away: number };
          events: Array<{ eventType: string }>;
          impliedProbabilities: { homeWin: number };
        };
      };
      personal: {
        session: {
          sessionId: string;
          mode: string;
          visibilityCursor: number;
        };
        state: {
          score: { home: number; away: number };
          events: Array<{ eventType: string }>;
          impliedProbabilities: { homeWin: number };
        };
      };
    }>();

    expect(body.fixture).toEqual({
      fixtureId: "synthetic-matchshift-001",
      label: "Synthetic MatchShift acceptance scenario (not live TxLINE data)",
      provenance: "SYNTHETIC",
      kickoffTimestamp: T0,
      liveEdgeTimestamp: T0 + 52 * 60_000,
      maxMinute: 52
    });
    expect(body.live.session.mode).toBe("LIVE");
    expect(body.live.state.score).toEqual({ home: 1, away: 0 });
    expect(body.live.state.impliedProbabilities.homeWin).toBe(0.68);

    expect(body.personal.session.mode).toBe("DELAYED");
    expect(body.personal.session.visibilityCursor).toBe(T0 + 43 * 60_000);
    expect(body.personal.state.score).toEqual({ home: 0, away: 0 });
    expect(
      body.personal.state.events.some((event) => event.eventType === "GOAL")
    ).toBe(false);
    expect(body.personal.state.impliedProbabilities.homeWin).toBe(0.44);

    const personalSerialized = JSON.stringify(body.personal);
    expect(personalSerialized).not.toContain("synthetic-home-goal-49");
    expect(personalSerialized).not.toContain("synthetic-odds-postgoal");
    expect(personalSerialized).not.toContain("0.68");
  });

  it("reveals the goal and post-goal odds only at their own timestamps", async () => {
    app = buildApp();
    const start = await app.inject({
      method: "POST",
      url: "/api/demo/start",
      payload: {}
    });
    const started = start.json<{
      personal: { session: { sessionId: string } };
    }>();
    const sessionId = started.personal.session.sessionId;

    const atGoal = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      payload: { type: "ADVANCE_TO", cursorMs: T0 + 49 * 60_000 }
    });
    const goalState = atGoal.json<{
      state: {
        score: { home: number; away: number };
        impliedProbabilities: { homeWin: number };
      };
    }>().state;

    const afterOdds = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      payload: {
        type: "ADVANCE_TO",
        cursorMs: T0 + 49 * 60_000 + 10_000
      }
    });
    const oddsState = afterOdds.json<{
      state: {
        score: { home: number; away: number };
        impliedProbabilities: { homeWin: number };
      };
    }>().state;

    expect(goalState.score).toEqual({ home: 1, away: 0 });
    expect(goalState.impliedProbabilities.homeWin).toBe(0.44);
    expect(oddsState.score).toEqual({ home: 1, away: 0 });
    expect(oddsState.impliedProbabilities.homeWin).toBe(0.68);
  });
});
