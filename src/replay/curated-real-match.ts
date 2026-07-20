import type {
  ImpliedProbabilities,
  MatchDefinition,
  MatchRecord,
  SourceOrderDomain
} from "../core/types.js";

const FIXTURE_ID = "spain-argentina-2026-07-19";
const KICKOFF_TIMESTAMP = 1_784_487_900_000;
const LIVE_EDGE_TIMESTAMP = KICKOFF_TIMESTAMP + 130 * 60_000;

function sourceOrder(
  domain: SourceOrderDomain,
  recordId: string,
  sourceTimestamp: number,
  sourceSequence?: number
) {
  const sequence = sourceSequence ?? 0;
  return {
    domain,
    tieBreaker: [
      "curated",
      domain,
      String(sourceTimestamp).padStart(16, "0"),
      String(sequence).padStart(16, "0"),
      recordId
    ].join(":"),
    payloadIdentity: recordId,
    ...(sourceSequence === undefined ? {} : { sourceSequence })
  };
}

const scoreRecords: MatchRecord[] = [
  {
    fixtureId: FIXTURE_ID,
    recordId: "curated-score-0001",
    sourceTimestamp: KICKOFF_TIMESTAMP,
    receivedTimestamp: KICKOFF_TIMESTAMP,
    provenance: "TXLINE",
    sourceOrder: sourceOrder(
      "TXLINE_SCORES",
      "curated-score-0001",
      KICKOFF_TIMESTAMP,
      1
    ),
    kind: "recovery",
    recoveryReason: "Curated TxLINE historical score baseline",
    snapshot: { score: { home: 0, away: 0 } }
  },
  {
    fixtureId: FIXTURE_ID,
    recordId: "curated-score-0002",
    sourceTimestamp: KICKOFF_TIMESTAMP,
    receivedTimestamp: KICKOFF_TIMESTAMP,
    provenance: "TXLINE",
    sourceOrder: sourceOrder(
      "TXLINE_SCORES",
      "curated-score-0002",
      KICKOFF_TIMESTAMP,
      2
    ),
    kind: "event",
    eventType: "KICKOFF",
    minute: 0
  },
  {
    fixtureId: FIXTURE_ID,
    recordId: "curated-score-0003",
    sourceTimestamp: KICKOFF_TIMESTAMP + 6_339_000,
    receivedTimestamp: KICKOFF_TIMESTAMP + 6_339_000,
    provenance: "TXLINE",
    sourceOrder: sourceOrder(
      "TXLINE_SCORES",
      "curated-score-0003",
      KICKOFF_TIMESTAMP + 6_339_000,
      3
    ),
    kind: "event",
    eventType: "GOAL",
    team: "HOME",
    minute: 106
  },
  {
    fixtureId: FIXTURE_ID,
    recordId: "curated-score-0004",
    sourceTimestamp: KICKOFF_TIMESTAMP + 7_502_000,
    receivedTimestamp: KICKOFF_TIMESTAMP + 7_502_000,
    provenance: "TXLINE",
    sourceOrder: sourceOrder(
      "TXLINE_SCORES",
      "curated-score-0004",
      KICKOFF_TIMESTAMP + 7_502_000,
      4
    ),
    kind: "recovery",
    recoveryReason: "Curated TxLINE historical score baseline",
    snapshot: { score: { home: 1, away: 0 } }
  }
];

const oddsSamples: ReadonlyArray<
  readonly [number, number, number, number]
> = [
  [1_784_488_495_414, 0.44702299028452314, 0.31259469498795817, 0.2403823147275188],
  [1_784_489_098_534, 0.4462508669279199, 0.3252189244830792, 0.22853020858900103],
  [1_784_489_699_544, 0.4217394118284922, 0.34034858592421885, 0.23791200224728887],
  [1_784_490_299_217, 0.40884861929719574, 0.36194126775278346, 0.2292101129500208],
  [1_784_490_898_992, 0.39636587272340446, 0.3897237322218041, 0.2139103950547913],
  [1_784_491_465_905, 0.39619822632987317, 0.3906266887721093, 0.21317508489801743],
  [1_784_492_072_307, 0.39495915839085766, 0.3888167142479205, 0.21622412736122196],
  [1_784_492_697_690, 0.3795127750555616, 0.39904874791356937, 0.22143847703086908],
  [1_784_493_298_723, 0.3590152969839423, 0.4546874043202725, 0.1862972986957852],
  [1_784_493_895_069, 0.3429417901105779, 0.5096933027331526, 0.14736490715626957],
  [1_784_494_237_637, 0.33027274881242824, 0.5230470101485526, 0.14668024103901917],
  [1_784_494_496_151, 0.31365676018727334, 0.5662161673142851, 0.12012707249844155],
  [1_784_495_097_087, 0.21149900961911722, 0.7078925775212096, 0.08060841285967323],
  [1_784_495_390_409, 0.06495340299350466, 0.9060529040760613, 0.02899369293043396],
  [1_784_495_692_736, 0.057457822529820714, 0.9369879212922966, 0.005554256177882669]
];

const oddsRecords: MatchRecord[] = oddsSamples.map(
  ([sourceTimestamp, homeWin, draw, awayWin], index) => {
    const recordId = `curated-odds-${String(index + 1).padStart(4, "0")}`;
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
      sourceOrder: sourceOrder("TXLINE_ODDS", recordId, sourceTimestamp),
      kind: "odds",
      impliedProbabilities
    };
  }
);

const records = [...scoreRecords, ...oddsRecords].sort(
  (left, right) =>
    left.sourceTimestamp - right.sourceTimestamp ||
    left.recordId.localeCompare(right.recordId)
);

/**
 * Allowlisted MatchShift product model generated from an authenticated TxLINE
 * completed-match export. It contains no raw provider payload, provider fixture
 * or message identifiers, credentials, private receipt, or downloadable feed.
 */
export const CURATED_REAL_MATCH: MatchDefinition = {
  fixtureId: FIXTURE_ID,
  label: "Spain vs Argentina — TxLINE completed-match replay",
  provenance: "TXLINE",
  kickoffTimestamp: KICKOFF_TIMESTAMP,
  liveEdgeTimestamp: LIVE_EDGE_TIMESTAMP,
  display: {
    homeLabel: "Spain",
    awayLabel: "Argentina"
  },
  records
};
