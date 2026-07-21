import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("published product update", () => {
  it("serves the visual walkthrough from the live application", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/product-update"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Post-submission update · July 21, 2026");
    expect(response.body).toContain("Goal revealed at 106′");
    expect(response.body).toContain("No client-side hiding");
    expect(response.body).toContain("data:image/jpeg;base64,");
  });

  it("points the main-page product update button to the live route", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('href="/product-update"');
    expect(response.body).not.toContain(
      "github.com/bit-nexus-labs/matchshift-txline/blob/main/docs/PRODUCT_UPDATE_2026-07-21.md"
    );
  });
});
