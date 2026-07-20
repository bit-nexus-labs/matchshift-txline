import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportCuratedCompletedMatch } from "../src/txline/curated-replay-exporter.js";
import {
  createPrivateCaptureCuratedReplaySourceFromDocument,
  validatePrivateCaptureCuratedReplayDocument
} from "../src/txline/private-capture-curated-replay-source.js";
import { TxlineHttpError } from "../src/txline/http-client.js";

const T0 = Date.parse("2026-07-19T19:05:00.000Z");
const PRIVATE_FIXTURE_ID = "private-fixture-id";

function captureEntry(label: string, parsedBody: unknown) {
  return {
    label,
    method: "GET",
    path: `/private/${label}`,
    accept: "application/json",
    requestedAtUtc: "2026-07-20T00:00:00.000Z",
    attempts: 1,
    status: 200,
    ok: true,
    contentType: "application/json",
    byteLength: 1,
    bodyText: "PRIVATE_CAPTURE_BODY_NOT_FOR_PUBLIC_OUTPUT",
    parse: {
      kind: "json",
      parsedBody
    }
  };
}

function scoreAction(
  seq: number,
  action: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    FixtureId: PRIVATE_FIXTURE_ID,
    MessageId: `private-score-message-${seq}`,
    Seq: seq,
    Ts: T0 + seq * 1_000,
    Action: action,
    Confirmed: true,
    Clock: { Running: true, Seconds: 0 },
    Score: {
      Participant1: { Total: { Goals: 0 } },
      Participant2: { Total: { Goals: 0 } }
    },
    ...overrides
  };
}

function privateCaptureDocument(): unknown {
  const scores = [
    scoreAction(10, "kickoff"),
    scoreAction(20, "yellow_card", {
      Participant: 2,
      Clock: { Running: true, Seconds: 600 }
    }),
    scoreAction(30, "corner", {
      MessageId: "private-discarded-corner",
      Participant: 1,
      Clock: { Running: true, Seconds: 900 }
    }),
    scoreAction(31, "action_discarded", {
      MessageId: "private-discarded-corner",
      Clock: { Running: true, Seconds: 900 }
    }),
    scoreAction(40, "corner", {
      Participant: 1,
      Clock: { Running: true, Seconds: 1_000 }
    }),
    scoreAction(50, "goal", {
      MessageId: "private-confirmed-goal",
      Confirmed: false,
      Participant: 1,
      Clock: { Running: true, Seconds: 6_339 },
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }),
    scoreAction(51, "goal", {
      MessageId: "private-confirmed-goal",
      Participant: 1,
      Clock: { Running: true, Seconds: 6_339 },
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }),
    scoreAction(60, "match_clock", {
      Clock: { Running: true, Seconds: 7_502 },
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    }),
    scoreAction(70, "game_finalised", {
      Clock: { Running: false, Seconds: 0 },
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } }
      }
    })
  ];
  const odds = [
    {
      FixtureId: PRIVATE_FIXTURE_ID,
      MessageId: "private-odds-opening",
      Ts: T0,
      SuperOddsType: "1X2",
      MarketParameters: null,
      MarketPeriod: "Full Time",
      PriceNames: ["Home", "Draw", "Away"],
      Pct: [45, 30, 25]
    },
    {
      FixtureId: PRIVATE_FIXTURE_ID,
      MessageId: "private-odds-late",
      Ts: T0 + 6_000_000,
      SuperOddsType: "1X2",
      MarketParameters: null,
      MarketPeriod: "Full Time",
      PriceNames: ["Home", "Draw", "Away"],
      Pct: [55, 25, 20]
    }
  ];

  return {
    warning: "PRIVATE_PROVIDER_DATA_DO_NOT_PUBLISH_OR_COMMIT",
    formatVersion: 1,
    capturedAtUtc: "2026-07-20T00:00:00.000Z",
    network: "mainnet",
    target: {
      fixtureId: PRIVATE_FIXTURE_ID,
      participant1: "Spain",
      participant2: "Argentina",
      homeParticipant: "Spain",
      awayParticipant: "Argentina",
      participant1IsHome: true,
      startUtc: new Date(T0).toISOString(),
      historicalWindowClassification: "ELIGIBLE",
      captureEndUtc: new Date(T0 + 130 * 60_000).toISOString(),
      windowMinutes: 130
    },
    entries: [
      captureEntry("scores-full-historical", { data: scores }),
      captureEntry("scores-bucket-test", { data: scores }),
      captureEntry("odds-bucket-test", { data: odds })
    ]
  };
}

describe("private capture curated replay source", () => {
  it("routes private capture records through the existing rich lifecycle exporter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "matchshift-private-capture-"));
    const outputPath = join(directory, "curated-real-match.ts");
    const receiptPath = join(directory, "receipt.md");
    const client = createPrivateCaptureCuratedReplaySourceFromDocument(
      privateCaptureDocument(),
      "mainnet"
    );

    const result = await exportCuratedCompletedMatch({
      network: "mainnet",
      client,
      selector: {
        sideA: "Spain",
        sideB: "Argentina",
        matchDateUtc: "2026-07-19"
      },
      publicFixtureId: "spain-argentina-2026-07-19",
      publicLabel: "Spain vs Argentina - curated TxLINE replay",
      durationMinutes: 130,
      oddsSampleMinutes: 10,
      requireOdds: true,
      outputPath,
      receiptPath,
      now: T0 + 24 * 60 * 60_000,
      commitSha: "test-commit"
    });

    const events = result.match.records.filter((record) => record.kind === "event");
    expect(events.map((event) => event.eventType)).toEqual([
      "KICKOFF",
      "YELLOW_CARD",
      "CORNER",
      "GOAL",
      "MATCH_FINAL"
    ]);
    expect(events.find((event) => event.eventType === "YELLOW_CARD")).toMatchObject({
      team: "AWAY",
      matchSecond: 600,
      importance: "KEY"
    });
    expect(events.find((event) => event.eventType === "CORNER")).toMatchObject({
      team: "HOME",
      matchSecond: 1_000,
      importance: "FULL"
    });
    expect(events.find((event) => event.eventType === "GOAL")).toMatchObject({
      team: "HOME",
      minute: 106,
      matchSecond: 6_339
    });
    expect(
      result.match.records.filter(
        (record) => record.kind === "event" && record.eventType === "CORNER"
      )
    ).toHaveLength(1);
    expect(result.oddsRecordCount).toBeGreaterThan(0);

    const generated = await readFile(outputPath, "utf8");
    expect(generated).not.toContain(PRIVATE_FIXTURE_ID);
    expect(generated).not.toContain("private-score-message");
    expect(generated).not.toContain("private-confirmed-goal");
    expect(generated).not.toContain("private-odds");
    expect(generated).not.toContain("PRIVATE_PROVIDER_DATA_DO_NOT_PUBLISH_OR_COMMIT");
    expect(generated).not.toContain("PRIVATE_CAPTURE_BODY_NOT_FOR_PUBLIC_OUTPUT");
  });

  it("fails closed when the configured network does not match the capture", () => {
    expect(() =>
      validatePrivateCaptureCuratedReplayDocument(
        privateCaptureDocument(),
        "devnet"
      )
    ).toThrowError(TxlineHttpError);
  });
});
