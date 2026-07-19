import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/txline/credentials.js";
import { exportCuratedCompletedMatch } from "../src/txline/curated-replay-exporter.js";
import { createCuratedReplaySource } from "../src/txline/curated-replay-source.js";

const T0 = Date.parse("2026-07-18T21:00:00.000Z");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" }
  });
}

function nestedHistoricalScores(): string {
  const records = [
    {
      FixtureId: "private-fixture",
      MessageId: "private-score-baseline",
      Seq: 1,
      Ts: T0,
      Action: "kickoff",
      Score: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    },
    {
      FixtureId: "private-fixture",
      MessageId: "private-score-goal",
      Seq: 2,
      Ts: T0 + 60_000,
      Action: "goal",
      Data: { Participant: "Participant1", Minutes: 1 },
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }
  ];
  const envelope = {
    event: "historical_scores",
    message: JSON.stringify({ payload: { records } })
  };
  return `: heartbeat\n\ndata: ${JSON.stringify(envelope)}\n\n`;
}

describe("curated replay authenticated source", () => {
  it("unwraps and merges fixture-tail plus bucketed historical score SSE", async () => {
    let authCount = 0;
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push(url.toString());
      if (url.pathname === "/auth/guest/start") {
        authCount += 1;
        return jsonResponse({ token: `guest-jwt-${authCount}` });
      }
      if (url.pathname === "/api/fixtures/snapshot") {
        return sseResponse(
          `data: ${JSON.stringify([
            {
              FixtureId: "private-fixture",
              StartTime: T0,
              Participant1: "France",
              Participant2: "England",
              Participant1IsHome: true,
              GameState: 5
            }
          ])}\n\n`
        );
      }
      if (url.pathname === "/api/scores/historical/private-fixture") {
        return sseResponse(nestedHistoricalScores());
      }
      if (url.pathname === "/api/scores/updates/20652/21/0") {
        expect(url.searchParams.get("fixtureId")).toBe("private-fixture");
        return sseResponse(nestedHistoricalScores());
      }
      if (url.pathname === "/api/odds/snapshot/private-fixture") {
        const asOf = Number(url.searchParams.get("asOf"));
        return jsonResponse({
          data: [
            {
              FixtureId: "private-fixture",
              MessageId: `private-odds-${asOf}`,
              Ts: asOf,
              SuperOddsType: "1X2",
              MarketParameters: null,
              MarketPeriod: "Full Time",
              PriceNames: ["Home", "Draw", "Away"],
              Pct: [50, 30, 20]
            }
          ]
        });
      }
      throw new Error(`Unexpected mocked request: ${url.pathname}`);
    };

    const directory = await mkdtemp(join(tmpdir(), "matchshift-curated-source-"));
    const outputPath = join(directory, "curated-real-match.ts");
    const receiptPath = join(directory, "receipt.md");
    const client = createCuratedReplaySource({
      apiOrigin: "https://txline.txodds.com",
      apiToken: "private-api-token",
      requestTimeoutMs: 5_000,
      fetchFn
    });

    const result = await exportCuratedCompletedMatch({
      network: "mainnet",
      client,
      selector: {
        sideA: "France",
        sideB: "England",
        matchDateUtc: "2026-07-18"
      },
      publicFixtureId: "curated-france-england-2026-07-18",
      publicLabel: "France vs England - curated TxLINE replay",
      durationMinutes: 1,
      oddsSampleMinutes: 1,
      requireOdds: true,
      outputPath,
      receiptPath,
      now: T0 + 24 * 60 * 60_000,
      commitSha: "test-commit"
    });

    expect(authCount).toBe(3);
    expect(result.scoreRecordCount).toBe(2);
    expect(result.oddsRecordCount).toBeGreaterThan(0);
    expect(result.match.records.some((record) => record.kind === "recovery")).toBe(
      true
    );
    expect(result.match.records.some((record) => record.kind === "event")).toBe(
      true
    );
    expect(calls.some((url) => url.includes("/api/scores/historical/"))).toBe(
      true
    );
    expect(calls.some((url) => url.includes("/api/scores/updates/20652/21/0"))).toBe(
      true
    );
    const generated = await readFile(outputPath, "utf8");
    expect(generated).not.toContain("private-fixture");
    expect(generated).not.toContain("private-score");
    expect(generated).not.toContain("private-odds");
    expect(generated).not.toContain("private-api-token");
  });
});
