import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCuratedOddsSampleTimestamps,
  exportCuratedCompletedMatch,
  type CuratedReplayExportClient
} from "../src/txline/curated-replay-exporter.js";

const T0 = Date.parse("2026-07-18T21:00:00.000Z");

function scorePayload() {
  return [
    {
      FixtureId: "private-fixture",
      MessageId: "private-score-baseline",
      action: "kickoff",
      seq: 1,
      ts: T0,
      scoreSoccer: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    },
    {
      FixtureId: "private-fixture",
      MessageId: "private-score-goal",
      action: "goal",
      seq: 2,
      ts: T0 + 10 * 60_000,
      dataSoccer: { Participant: "Participant1", Minutes: 10 },
      scoreSoccer: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }
  ];
}

function oddsPayload(asOf: number) {
  return [
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
  ];
}

describe("TxLINE curated replay exporter", () => {
  it("builds deterministic sample timestamps around score boundaries", () => {
    const samples = buildCuratedOddsSampleTimestamps({
      kickoffTimestamp: T0,
      durationMinutes: 30,
      sampleMinutes: 10,
      scoreRecords: [
        {
          fixtureId: "private-fixture",
          recordId: "goal",
          sourceTimestamp: T0 + 15 * 60_000,
          receivedTimestamp: T0,
          provenance: "TXLINE",
          sourceOrder: {
            domain: "TXLINE_SCORES",
            tieBreaker: "private",
            payloadIdentity: "private",
            sourceSequence: 2
          },
          kind: "event",
          eventType: "GOAL",
          team: "HOME",
          minute: 15
        }
      ]
    });

    expect(samples).toEqual([
      T0,
      T0 + 10 * 60_000,
      T0 + 15 * 60_000,
      T0 + 20 * 60_000,
      T0 + 30 * 60_000
    ]);
  });

  it("writes only an allowlisted generated MatchShift module", async () => {
    const oddsCalls: number[] = [];
    const client: CuratedReplayExportClient = {
      fetchFixturesSnapshot: async () => [
        {
          FixtureId: "private-fixture",
          StartTime: T0,
          Participant1: "France",
          Participant2: "England",
          Participant1IsHome: true,
          GameState: 5
        }
      ],
      fetchScoresHistorical: async () => scorePayload(),
      fetchOddsSnapshotAt: async (_fixtureId, asOf) => {
        oddsCalls.push(asOf);
        return oddsPayload(asOf);
      }
    };
    const directory = await mkdtemp(join(tmpdir(), "matchshift-curated-"));
    const outputPath = join(directory, "curated-real-match.ts");
    const receiptPath = join(directory, "receipt.md");

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
      durationMinutes: 30,
      oddsSampleMinutes: 10,
      outputPath,
      receiptPath,
      now: T0 + 24 * 60 * 60_000,
      commitSha: "test-commit"
    });

    expect(oddsCalls.length).toBeGreaterThan(0);
    expect(result.scoreRecordCount).toBe(2);
    expect(result.oddsRecordCount).toBeGreaterThan(0);
    expect(result.match.records.some((record) => record.kind === "odds")).toBe(
      true
    );
    const generated = await readFile(outputPath, "utf8");
    const receipt = await readFile(receiptPath, "utf8");
    expect(generated).toContain("France vs England");
    expect(generated).not.toContain("private-fixture");
    expect(generated).not.toContain("private-score");
    expect(generated).not.toContain("private-odds");
    expect(receipt).toContain("TXLINE CURATED COMPLETED-MATCH EXPORT: PASS");
    expect(receipt).not.toContain("private-fixture");
  });
});
