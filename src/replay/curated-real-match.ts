import type {
  ImpliedProbabilities,
  MatchDefinition,
  MatchRecord
} from "../core/types.js";
import { RICH_CURATED_SCORE_RECORDS } from "./curated-spain-argentina-rich-score-records.js";

const FIXTURE_ID = "spain-argentina-2026-07-19";
const KICKOFF_TIMESTAMP = 1_784_487_900_000;
const LIVE_EDGE_TIMESTAMP = KICKOFF_TIMESTAMP + 141 * 60_000;

function oddsSourceOrder(recordId: string, sourceTimestamp: number) {
  return {
    domain: "TXLINE_ODDS" as const,
    tieBreaker: [
      "curated",
      "TXLINE_ODDS",
      String(sourceTimestamp).padStart(16, "0"),
      "0000000000000000",
      recordId
    ].join(":"),
    payloadIdentity: recordId
  };
}

const oddsSamples: ReadonlyArray<
  readonly [number, number, number, number]
> = [
  [531, 0.44702299028452314, 0.31259469498795817, 0.2403823147275188],
  [1134, 0.4462508669279199, 0.3252189244830792, 0.22853020858900103],
  [1731, 0.4217394118284922, 0.34034858592421885, 0.23791200224728887],
  [2332, 0.40884861929719574, 0.36194126775278346, 0.2292101129500208],
  [2930, 0.39636587272340446, 0.3897237322218041, 0.2139103950547913],
  [2931, 0.39619822632987317, 0.3906266887721093, 0.21317508489801743],
  [2932, 0.39495915839085766, 0.3888167142479205, 0.21622412736122196],
  [3066, 0.3795127750555616, 0.39904874791356937, 0.22143847703086908],
  [3682, 0.3590152969839423, 0.4546874043202725, 0.1862972986957852],
  [4261, 0.3429417901105779, 0.5096933027331526, 0.14736490715626957],
  [4626, 0.33027274881242824, 0.5230470101485526, 0.14668024103901917],
  [4864, 0.31365676018727334, 0.5662161673142851, 0.12012707249844155],
  [5493, 0.21149900961911722, 0.7078925775212096, 0.08060841285967323],
  [5784, 0.06495340299350466, 0.9060529040760613, 0.02899369293043396],
  [5985, 0.057457822529820714, 0.9369879212922966, 0.005554256177882669]
];

const oddsRecords: MatchRecord[] = oddsSamples.map(
  ([timelineSeconds, homeWin, draw, awayWin], index) => {
    const recordId = `curated-odds-${String(index + 1).padStart(4, "0")}`;
    const sourceTimestamp = KICKOFF_TIMESTAMP + timelineSeconds * 1_000;
    const impliedProbabilities: ImpliedProbabilities = {
      homeWin,
      draw,
      awayWin
    };
    return {
      fixtureId: FIXTURE_ID,
      recordId,
      sourceTimestamp,
      receivedTimestamp: sourceTimestamp,
      provenance: "TXLINE",
      sourceOrder: oddsSourceOrder(recordId, sourceTimestamp),
      kind: "odds",
      impliedProbabilities
    };
  }
);

const records = [...RICH_CURATED_SCORE_RECORDS, ...oddsRecords].sort(
  (left, right) =>
    left.sourceTimestamp - right.sourceTimestamp ||
    left.recordId.localeCompare(right.recordId)
);

/**
 * Allowlisted MatchShift product model generated from an authenticated TxLINE
 * completed-match export. It contains a rich sanitized event chronology and
 * sampled historical 1X2 probabilities, but no raw payload or provider IDs.
 */
export const CURATED_REAL_MATCH: MatchDefinition = {
  fixtureId: FIXTURE_ID,
  label: "Spain vs Argentina — rich TxLINE completed-match replay",
  provenance: "TXLINE",
  kickoffTimestamp: KICKOFF_TIMESTAMP,
  liveEdgeTimestamp: LIVE_EDGE_TIMESTAMP,
  display: {
    homeLabel: "Spain",
    awayLabel: "Argentina"
  },
  records
};
