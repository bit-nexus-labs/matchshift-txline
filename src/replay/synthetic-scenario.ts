import type { MatchDefinition, MatchRecord, RecoveryRecord } from "../core/types.js";

export const SYNTHETIC_FIXTURE_ID = "synthetic-matchshift-001";
export const T0 = Date.parse("2026-07-15T18:00:00.000Z");

const minute = (value: number): number => value * 60_000;

export const SYNTHETIC_RECORDS: readonly MatchRecord[] = [
  {
    fixtureId: SYNTHETIC_FIXTURE_ID,
    recordId: "synthetic-kickoff",
    sequence: 1,
    sourceTimestamp: T0,
    receivedTimestamp: T0 + 100,
    provenance: "SYNTHETIC",
    kind: "event",
    eventType: "KICKOFF",
    minute: 0
  },
  {
    fixtureId: SYNTHETIC_FIXTURE_ID,
    recordId: "synthetic-odds-pregoal",
    sequence: 2,
    sourceTimestamp: T0 + minute(10),
    receivedTimestamp: T0 + minute(10) + 120,
    provenance: "SYNTHETIC",
    kind: "odds",
    impliedProbabilities: {
      homeWin: 0.44,
      draw: 0.31,
      awayWin: 0.25
    }
  },
  {
    fixtureId: SYNTHETIC_FIXTURE_ID,
    recordId: "synthetic-home-goal-49",
    sequence: 3,
    sourceTimestamp: T0 + minute(49),
    receivedTimestamp: T0 + minute(49) + 300,
    provenance: "SYNTHETIC",
    kind: "event",
    eventType: "GOAL",
    team: "HOME",
    minute: 49
  },
  {
    fixtureId: SYNTHETIC_FIXTURE_ID,
    recordId: "synthetic-odds-postgoal",
    sequence: 4,
    sourceTimestamp: T0 + minute(49) + 10_000,
    receivedTimestamp: T0 + minute(49) + 10_250,
    provenance: "SYNTHETIC",
    kind: "odds",
    impliedProbabilities: {
      homeWin: 0.68,
      draw: 0.21,
      awayWin: 0.11
    }
  }
];

export const SYNTHETIC_MATCH: MatchDefinition = {
  fixtureId: SYNTHETIC_FIXTURE_ID,
  label: "Synthetic MatchShift acceptance scenario (not live TxLINE data)",
  provenance: "SYNTHETIC",
  kickoffTimestamp: T0,
  liveEdgeTimestamp: T0 + minute(52),
  display: {
    homeLabel: "Northbridge",
    awayLabel: "Southport"
  },
  expectedFirstSequence: 1,
  records: SYNTHETIC_RECORDS
};

export const SYNTHETIC_RECOVERY: RecoveryRecord = {
  fixtureId: SYNTHETIC_FIXTURE_ID,
  recordId: "synthetic-explicit-recovery-50",
  sequence: 5,
  sourceTimestamp: T0 + minute(50),
  receivedTimestamp: T0 + minute(50) + 500,
  provenance: "SYNTHETIC",
  kind: "recovery",
  recoveryReason: "Explicit trusted snapshot after a detected sequence gap",
  snapshot: {
    score: { home: 1, away: 0 },
    impliedProbabilities: {
      homeWin: 0.68,
      draw: 0.21,
      awayWin: 0.11
    }
  }
};
