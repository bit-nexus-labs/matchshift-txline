import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";

const PRODUCT_UPDATE_IMAGE_URLS = [
  "/product-update/images/1.webp",
  "/product-update/images/2.webp",
  "/product-update/images/3.webp",
  "/product-update/images/4.webp"
] as const;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function readVp8xDimensions(payload: Buffer): {
  width: number;
  height: number;
} {
  expect(payload.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(payload.subarray(8, 12).toString("ascii")).toBe("WEBP");
  expect(payload.subarray(12, 16).toString("ascii")).toBe("VP8X");
  return {
    width: payload.readUIntLE(24, 3) + 1,
    height: payload.readUIntLE(27, 3) + 1
  };
}

describe("published product update", () => {
  it("serves the visual walkthrough with four distinct image URLs", async () => {
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
    expect(response.body).not.toContain("data:image/");

    const imageUrls = Array.from(
      response.body.matchAll(/<img src="([^"]+)"/g),
      (match) => match[1]
    );
    expect(imageUrls).toEqual(PRODUCT_UPDATE_IMAGE_URLS);
    expect(new Set(imageUrls).size).toBe(4);

    const fullSizeUrls = Array.from(
      response.body.matchAll(
        /<a class="shot" href="([^"]+)" target="_blank"/g
      ),
      (match) => match[1]
    );
    expect(fullSizeUrls).toEqual(PRODUCT_UPDATE_IMAGE_URLS);
    expect(response.body).toContain("Open screenshot at full size");
    expect(response.body).toContain("max-width:960px");
  });

  it("serves every screenshot as a full-size WebP asset", async () => {
    app = buildApp({ env: { TXLINE_MODE: "synthetic" } });
    await app.ready();

    for (const url of PRODUCT_UPDATE_IMAGE_URLS) {
      const response = await app.inject({ method: "GET", url });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("image/webp");
      expect(response.rawPayload.byteLength).toBeGreaterThan(40_000);

      const dimensions = readVp8xDimensions(response.rawPayload);
      expect(dimensions.width).toBeGreaterThanOrEqual(1_200);
      expect(dimensions.height).toBeGreaterThanOrEqual(600);
    }
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
