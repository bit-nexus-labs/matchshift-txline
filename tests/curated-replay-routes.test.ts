import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("curated replay judge routes", () => {
  it("keeps the curated entrypoint unavailable while the tracked module is empty", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    const status = await app.inject({
      method: "GET",
      url: "/api/demo/curated/status"
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ available: false });

    const start = await app.inject({
      method: "POST",
      url: "/api/demo/curated/start",
      payload: {}
    });
    expect(start.statusCode).toBe(404);
    expect(start.json()).toEqual({ error: "CURATED_REPLAY_NOT_AVAILABLE" });
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
    expect(response.body).toContain("disclosed partial TxLINE replay ready");
    const script = response.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? "")).not.toThrow();
  });
});
