import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("curated replay judge routes", () => {
  it("publishes the validated Spain vs Argentina completed-match replay", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    const status = await app.inject({
      method: "GET",
      url: "/api/demo/curated/status"
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      available: true,
      fixture: {
        fixtureId: "spain-argentina-2026-07-19",
        provenance: "TXLINE",
        homeLabel: "Spain",
        awayLabel: "Argentina",
        demoKind: "CURATED"
      },
      note: "Single curated completed-match replay; not a provider feed or archive."
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/demo/curated/start",
      payload: {}
    });
    expect(start.statusCode).toBe(201);
    const payload = start.json<{
      fixture: {
        fixtureId: string;
        homeLabel: string;
        awayLabel: string;
        demoKind: string;
        maxMinute: number;
      };
      live: {
        session: { mode: string };
        state: {
          score: { home: number; away: number };
          events: Array<{ eventType: string; minute: number }>;
        };
      };
      personal: {
        session: { mode: string };
        state: {
          score: { home: number; away: number };
          events: Array<{ eventType: string; minute: number }>;
        };
      };
    }>();

    expect(payload.fixture).toMatchObject({
      fixtureId: "spain-argentina-2026-07-19",
      homeLabel: "Spain",
      awayLabel: "Argentina",
      demoKind: "CURATED",
      maxMinute: 130
    });
    expect(payload.live.session.mode).toBe("LIVE");
    expect(payload.live.state.score).toEqual({ home: 1, away: 0 });
    expect(payload.live.state.events).toContainEqual(
      expect.objectContaining({ eventType: "GOAL", minute: 106 })
    );
    expect(payload.personal.session.mode).toBe("REPLAY");
    expect(payload.personal.state.score).toEqual({ home: 0, away: 0 });
    expect(
      payload.personal.state.events.some((event) => event.eventType === "GOAL")
    ).toBe(false);
  });

  it("publishes dynamic display labels in the synthetic judge payload", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/demo/start",
      payload: {}
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().fixture).toMatchObject({
      homeLabel: "Northbridge",
      awayLabel: "Southport",
      demoKind: "SYNTHETIC"
    });
  });

  it("renders a syntactically valid hidden curated entrypoint and dynamic team script", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('id="start-curated"');
    expect(response.body).toContain('style="display:none');
    expect(response.body).toContain('api("/api/demo/curated/status")');
    expect(response.body).toContain('model.fixture.homeLabel + " goal"');
    expect(response.body).toContain('scoreHistory === "PARTIAL_OPENING"');
    expect(response.body).toContain("local 0-0 kickoff baseline");
    expect(response.body).toContain("curated TxLINE replay ready");
    const script = response.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? "")).not.toThrow();
  });
});
