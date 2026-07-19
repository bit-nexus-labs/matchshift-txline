import { describe, expect, it } from "vitest";
import {
  isStructurallyValidOddsTransportPayload,
  observeLiveOddsTransport,
  type LiveOddsTransportClient
} from "../src/txline/live-odds-transport-observer.js";

function responseFromSse(block: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(block));
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

describe("TxLINE live odds transport observer", () => {
  it("accepts a structurally valid non-match-winner odds payload", () => {
    expect(
      isStructurallyValidOddsTransportPayload({
        FixtureId: "private-fixture",
        SuperOddsType: "Total Goals",
        PriceNames: ["Over", "Under"],
        Prices: [1.8, 2.1],
        Ts: 1_000
      })
    ).toBe(true);
  });

  it("rejects heartbeat-only and malformed messages", () => {
    expect(isStructurallyValidOddsTransportPayload({ Ts: 1_000 })).toBe(false);
    expect(
      isStructurallyValidOddsTransportPayload({
        FixtureId: "private-fixture",
        SuperOddsType: "Total Goals",
        PriceNames: ["Over", "Under"],
        Prices: [1.8],
        Ts: 1_000
      })
    ).toBe(false);
  });

  it("returns PASS without exposing the provider payload", async () => {
    const client: LiveOddsTransportClient = {
      openStream: async () =>
        responseFromSse(
          [
            "event: odds",
            "id: private-event",
            'data: {"FixtureId":"private-fixture","SuperOddsType":"Total Goals","PriceNames":["Over","Under"],"Prices":[1.8,2.1],"Ts":1000}',
            "",
            ""
          ].join("\n")
        )
    };

    const result = await observeLiveOddsTransport(
      {
        TXLINE_NETWORK: "mainnet",
        TXLINE_API_TOKEN: "private-token",
        TXLINE_LIVE_TRANSPORT_OBSERVE_MS: "1000"
      },
      {
        now: () => 1_000,
        sleep: async () => undefined,
        createClient: () => client,
        resolveCommitSha: () => "test-commit"
      }
    );

    expect(result.status).toBe("PASS");
    expect(result.receipt).toContain(
      "Structurally valid odds data event received: PASS"
    );
    expect(result.receipt).toContain("Product semantic normalization claimed: NO");
    expect(result.receipt).not.toContain("private-fixture");
    expect(result.receipt).not.toContain("private-event");
    expect(result.receipt).not.toContain("private-token");
  });
});
