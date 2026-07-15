import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

describe("data-source status API", () => {
  it("reports the default synthetic source without external credentials", async () => {
    app = buildApp({ env: {} });

    const response = await app.inject({
      method: "GET",
      url: "/api/data-source/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: "synthetic",
      state: "SYNTHETIC_READY",
      message: "Deterministic synthetic replay is ready."
    });
  });

  it("returns sanitized CONFIG_ERROR when TxLINE credentials are absent", async () => {
    app = buildApp({ env: { TXLINE_MODE: "devnet" } });

    const response = await app.inject({
      method: "GET",
      url: "/api/data-source/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "devnet",
      network: "devnet",
      state: "CONFIG_ERROR"
    });
    expect(response.body).not.toContain("Authorization");
    expect(response.body).not.toContain("Bearer");
  });

  it("never exposes configured credential values", async () => {
    const apiToken = "configured-api-token-secret";
    app = buildApp({
      env: {
        TXLINE_MODE: "mainnet",
        TXLINE_API_TOKEN: apiToken
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/data-source/status"
    });

    expect(response.json()).toMatchObject({
      mode: "mainnet",
      network: "mainnet",
      state: "CONNECTING"
    });
    expect(response.body).not.toContain(apiToken);
  });
});
