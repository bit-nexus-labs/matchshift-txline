import { describe, expect, it } from "vitest";
import {
  applyDisclosedPartialCoverage,
  renderDisclosedCuratedReplayModule
} from "../src/txline/curated-partial-artifact.js";
import { normalizeCuratedHistoricalScores } from "../src/txline/curated-replay-exporter.js";
import { buildCuratedMatchDefinition } from "../src/txline/curated-replay.js";
import type { NormalizedFixture } from "../src/txline/normalizer.js";
import {
  buildDisclosedPartialOpeningHistory,
  readPartialOpeningCoverage
} from "../src/txline/score-partial-opening.js";

const KICKOFF = Date.parse("2026-07-18T21:00:00.000Z");
const PROVIDER_START = KICKOFF + 70.6 * 60_000;
const FIXTURE_ID = "private-fixture";

const fixture: NormalizedFixture = {
  fixtureId: FIXTURE_ID,
  startTime: KICKOFF,
  startTimestamp: KICKOFF,
  participant1: "France",
  participant2: "England",
  participant1IsHome: true,
  homeParticipant: "France",
  awayParticipant: "England",
  gameState: 5,
  selectionState: "SELECTABLE"
};

function trustedScore(
  seq: number,
  timestamp: number,
  home: number,
  away: number,
  action = "period_update"
) {
  return {
    FixtureId: FIXTURE_ID,
    MessageId: `private-score-${seq}`,
    Seq: seq,
    Ts: timestamp,
    Action: action,
    ScoreSoccer: {
      Participant1: { Total: { Goals: home } },
      Participant2: { Total: { Goals: away } }
    }
  };
}

describe("disclosed curated partial opening coverage", () => {
  it("trims unknown opening noise and creates one local 0-0 boundary before the first trusted score", () => {
    const partial = buildDisclosedPartialOpeningHistory(
      [
        {
          FixtureId: FIXTURE_ID,
          MessageId: "private-noise",
          Seq: 8,
          Ts: KICKOFF + 5_000,
          Action: "period_update",
          ScoreSoccer: {}
        },
        trustedScore(31, PROVIDER_START, 1, 4),
        trustedScore(32, KICKOFF + 75 * 60_000, 2, 4)
      ],
      fixture
    );

    expect(partial).toHaveLength(3);
    expect(partial[0]).toMatchObject({
      Seq: 30,
      Ts: KICKOFF,
      Action: "curated_partial_opening_baseline",
      ScoreSoccer: {
        Participant1: { Total: { Goals: 0 } },
        Participant2: { Total: { Goals: 0 } }
      }
    });
    expect(JSON.stringify(partial)).not.toContain("private-noise");
    expect(readPartialOpeningCoverage(partial)).toEqual({
      scoreHistory: "PARTIAL_OPENING",
      providerScoreStartTimestamp: PROVIDER_START
    });
  });

  it("renders local baseline provenance and explicit provider coverage metadata", () => {
    const payload = buildDisclosedPartialOpeningHistory(
      [
        trustedScore(31, PROVIDER_START, 1, 4),
        trustedScore(32, KICKOFF + 75 * 60_000, 2, 4),
        trustedScore(33, KICKOFF + 90 * 60_000, 4, 6)
      ],
      fixture
    );
    const scoreRecords = normalizeCuratedHistoricalScores(
      payload,
      fixture,
      KICKOFF + 24 * 60 * 60_000
    );
    const base = buildCuratedMatchDefinition({
      fixture,
      scoreRecords,
      oddsRecords: [],
      publicFixtureId: "curated-france-england-2026-07-18",
      publicLabel: "France vs England - curated TxLINE completed-match replay",
      durationMinutes: 120
    });
    const match = applyDisclosedPartialCoverage(base, {
      scoreHistory: "PARTIAL_OPENING",
      providerScoreStartTimestamp: PROVIDER_START,
      openingBaseline: "LOCAL_STRUCTURAL_0_0"
    });

    const scoreDomain = match.records.filter(
      (record) => record.sourceOrder?.domain === "TXLINE_SCORES"
    );
    expect(scoreDomain[0]).toMatchObject({
      kind: "recovery",
      provenance: "SYNTHETIC",
      sourceTimestamp: KICKOFF,
      snapshot: { score: { home: 0, away: 0 } }
    });
    expect(
      scoreDomain.find(
        (record) => record.sourceTimestamp === PROVIDER_START
      )
    ).toMatchObject({
      kind: "recovery",
      provenance: "TXLINE",
      snapshot: { score: { home: 1, away: 4 } }
    });
    expect(match.coverage).toEqual({
      scoreHistory: "PARTIAL_OPENING",
      providerScoreStartTimestamp: PROVIDER_START,
      openingBaseline: "LOCAL_STRUCTURAL_0_0"
    });
    expect(match.label).toContain("partial score coverage");

    const moduleText = renderDisclosedCuratedReplayModule(match);
    expect(moduleText).toContain('"scoreHistory": "PARTIAL_OPENING"');
    expect(moduleText).toContain("Local structural 0-0 kickoff baseline");
    expect(moduleText).not.toContain(FIXTURE_ID);
    expect(moduleText).not.toContain("private-score");
  });
});
