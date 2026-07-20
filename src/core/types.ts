export const SESSION_MODES = ["LIVE", "DELAYED", "PAUSED", "REPLAY"] as const;

export type SessionMode = (typeof SESSION_MODES)[number];
export type StatusBadge = SessionMode | "SAFE_HOLD";
export type TeamSide = "HOME" | "AWAY";
export type Provenance = "SYNTHETIC" | "TXLINE";
export type SourceOrderDomain = "TXLINE_SCORES" | "TXLINE_ODDS";

export interface Score {
  home: number;
  away: number;
}

export interface ImpliedProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface SourceOrderMetadata {
  domain: SourceOrderDomain;
  tieBreaker: string;
  payloadIdentity: string;
  sourceSequence?: number;
  sourceMessageId?: string;
  sseEventId?: string;
}

interface BaseMatchRecord {
  fixtureId: string;
  recordId: string;
  /** Task 01 deterministic ordering. TxLINE records use sourceOrder instead. */
  sequence?: number;
  sourceTimestamp: number;
  receivedTimestamp: number;
  provenance: Provenance;
  sourceOrder?: SourceOrderMetadata;
}

export interface MatchEventRecord extends BaseMatchRecord {
  kind: "event";
  eventType: "KICKOFF" | "GOAL";
  team?: TeamSide;
  minute: number;
}

export interface OddsRecord extends BaseMatchRecord {
  kind: "odds";
  impliedProbabilities: ImpliedProbabilities;
}

export interface RecoveryRecord extends BaseMatchRecord {
  kind: "recovery";
  recoveryReason: string;
  snapshot: {
    score: Score;
    impliedProbabilities?: ImpliedProbabilities;
  };
}

export type MatchRecord = MatchEventRecord | OddsRecord | RecoveryRecord;

export interface MatchDisplay {
  homeLabel: string;
  awayLabel: string;
}

export interface MatchScoreCoverage {
  scoreHistory: "PARTIAL_OPENING";
  providerScoreStartTimestamp: number;
  openingBaseline: "LOCAL_STRUCTURAL_0_0";
}

export interface MatchDefinition {
  fixtureId: string;
  label: string;
  provenance: Provenance;
  kickoffTimestamp: number;
  liveEdgeTimestamp: number;
  display?: MatchDisplay;
  coverage?: MatchScoreCoverage;
  /** Synthetic Task 01 prefix baseline only. TxLINE uses per-feed metadata. */
  expectedFirstSequence?: number;
  records: readonly MatchRecord[];
}

export interface ViewerSession {
  sessionId: string;
  fixtureId: string;
  mode: SessionMode;
  visibilityCursor: number;
  delayMs: number;
}

export interface VisibleEvent {
  eventId: string;
  sequence: number;
  sourceTimestamp: number;
  eventType: MatchEventRecord["eventType"];
  minute: number;
  team?: TeamSide;
}

export interface SafetyStatus {
  active: boolean;
  reason?: string;
  blockedFromSequence?: number;
  recoveredAtSequence?: number;
}

export interface VisibleMatchState {
  fixtureId: string;
  source: {
    label: string;
    provenance: Provenance;
  };
  session: {
    sessionId: string;
    mode: SessionMode;
    statusBadge: StatusBadge;
    visibilityCursor: number;
    viewerMinute: number;
  };
  score: Score;
  events: VisibleEvent[];
  impliedProbabilities?: ImpliedProbabilities;
  latestExplanation?: string;
  safety: SafetyStatus;
}
