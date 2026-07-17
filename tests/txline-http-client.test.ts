import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import {
  TxlineConfigurationError,
  TxlineHttpClient,
  TxlineHttpError
} from "../src/txline/http-client.js";

type QueuedResponse = Response | Error;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFetchQueue(responses: QueuedResponse[]): {
  fetchFn: FetchLike;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("Unexpected mocked fetch call.");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetchFn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function headersFor(call: FetchCall): Headers {
  return new Headers(call.init?.headers);
}

describe("TxLINE HTTP client", () => {
  it("acquires guest JWT from the matching host and sends both headers", async () => {
    const mock = makeFetchQueue([
      jsonResponse({ token: "jwt-devnet" }),
      jsonResponse([]),
      new Response(": heartbeat\n\n", {
        headers: { "Content-Type": "text/event-stream" }
      })
    ]);
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline-dev.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    await client.fetchFixturesSnapshot(72);
    await client.openStream("scores");

    expect(mock.calls[0]?.url).toBe(
      "https://txline-dev.txodds.com/auth/guest/start"
    );
    expect(mock.calls[1]?.url).toBe(
      "https://txline-dev.txodds.com/api/fixtures/snapshot?competitionId=72"
    );
    expect(headersFor(mock.calls[1]!).get("Authorization")).toBe(
      "Bearer jwt-devnet"
    );
    expect(headersFor(mock.calls[1]!).get("X-Api-Token")).toBe("api-token");
    expect(headersFor(mock.calls[2]!).get("Authorization")).toBe(
      "Bearer jwt-devnet"
    );
    expect(headersFor(mock.calls[2]!).get("X-Api-Token")).toBe("api-token");
    expect(headersFor(mock.calls[2]!).get("Accept")).toBe("text/event-stream");
  });

  it("uses the documented fixture snapshot query and filters dates locally", async () => {
    const mock = makeFetchQueue([
      jsonResponse({ token: "jwt-mainnet" }),
      jsonResponse([])
    ]);
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    await client.fetchFixturesSnapshotForDay(20_000, 72);

    expect(mock.calls[1]?.url).toBe(
      "https://txline.txodds.com/api/fixtures/snapshot?competitionId=72"
    );
    expect(mock.calls[1]?.url).not.toContain("startEpochDay");
  });

  it("reports invalid JSON metadata without exposing the response body", async () => {
    const body = "<html>upstream gateway page</html>";
    const mock = makeFetchQueue([
      jsonResponse({ token: "jwt" }),
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    ]);
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    const error = await client.fetchFixturesSnapshot().catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(TxlineHttpError);
    expect((error as TxlineHttpError).code).toBe("INVALID_JSON");
    expect((error as Error).message).toContain("status 200");
    expect((error as Error).message).toContain("content-type text/html");
    expect((error as Error).message).toContain("bytes ");
    expect((error as Error).message).not.toContain(body);
  });

  it("renews a guest JWT and retries a 401 exactly once", async () => {
    const mock = makeFetchQueue([
      jsonResponse({ token: "jwt-old" }),
      new Response(null, { status: 401 }),
      jsonResponse({ token: "jwt-new" }),
      jsonResponse([{ FixtureId: 1 }])
    ]);
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "same-api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    await client.fetchFixturesSnapshot();

    expect(mock.calls).toHaveLength(4);
    expect(
      mock.calls.filter((call) => call.url.endsWith("/auth/guest/start"))
    ).toHaveLength(2);
    expect(headersFor(mock.calls[1]!).get("Authorization")).toBe(
      "Bearer jwt-old"
    );
    expect(headersFor(mock.calls[3]!).get("Authorization")).toBe(
      "Bearer jwt-new"
    );
    expect(headersFor(mock.calls[3]!).get("X-Api-Token")).toBe(
      "same-api-token"
    );
  });

  it("treats 403 as a hard configuration error without retrying", async () => {
    const mock = makeFetchQueue([
      jsonResponse({ token: "jwt" }),
      new Response(null, { status: 403 })
    ]);
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    await expect(client.fetchOddsSnapshot("fixture-1")).rejects.toBeInstanceOf(
      TxlineConfigurationError
    );
    expect(mock.calls).toHaveLength(2);
  });

  it("does not serialize credential values from transport errors", async () => {
    const apiToken = "api-token-must-not-leak";
    const jwt = "jwt-must-not-leak";
    const mock = makeFetchQueue([
      jsonResponse({ token: jwt }),
      new Error(`network Bearer ${jwt} X-Api-Token: ${apiToken}`)
    ]);
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline.txodds.com",
      apiToken,
      requestTimeoutMs: 5_000,
      fetchFn: mock.fetchFn
    });

    const error = await client.fetchScoresSnapshot("fixture-1").catch(
      (caught: unknown) => caught
    );
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));

    expect(serialized).not.toContain(apiToken);
    expect(serialized).not.toContain(jwt);
  });

  it("keeps external abort control active after an SSE response opens", async () => {
    let call = 0;
    const fetchFn: FetchLike = async (_input, init) => {
      call += 1;
      if (call === 1) {
        return jsonResponse({ token: "jwt" });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new Error("mock stream aborted")),
            { once: true }
          );
        }
      });
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream" }
      });
    };
    const client = new TxlineHttpClient({
      apiOrigin: "https://txline-dev.txodds.com",
      apiToken: "api-token",
      requestTimeoutMs: 5_000,
      fetchFn
    });
    const controller = new AbortController();

    const response = await client.openStream("scores", controller.signal);
    const pendingRead = response.body?.getReader().read();
    controller.abort();

    await expect(pendingRead).rejects.toThrow("mock stream aborted");
  });
});
