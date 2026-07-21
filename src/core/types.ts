export const SESSION_MODES = ["LIVE", "DELAYED", "PAUSED", "REPLAY"] as const;

export type SessionMode = (typeof SESSION_MODES)[number];
export type StatusBadge = SessionMode | "SAFE_HOLD";
export type TeamSide = "HOME" | "AWAY";
export type Provenance = "SYNTHETIC" | "TXLINE";
export type SourceOrderDomain = "TXLINE_SCORES" | "TXLINE_ODDS";

export const MATCH_EVENT_TYPES = [
  "KICKOFF",
  "SECOND_HALF_START",
  "HALF_TIME",
  "REGULATION_END",
  "EXTRA_TIME_START",
  "EXTRA_TIME_HALF_TIME",
  "EXTRA_TIME_SECOND_HALF_START",
  "MATCH_FINAL",
  "RESTART",
  "GOAL",
  "VAR_REVIEW",
  "VAR_DECISION",
  "YELLOW_CARD",
  "RED_CARD",
  "CORNER",
  "SHOT",
  "FREE_KICK",
  "THROW_IN",
  "GOAL_KICK",
  "SUBSTITUTION",
  "INJURY",
  "ADDITIONAL_TIME",
  "MOMENTUM"
] as const;

export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];
export type EventImportance = "KEY" | "STANDARD" | "FLOW";
export type EventCategory =
  | "PERIOD"
  | "SCORE"
  | "VAR"
  | "DISCIPLINE"
  | "ATTACK"
  | "RESTART"
  | "PERSONNEL"
  | "FLOW"
  | "MATCH";

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
  /** Backward-compatible score event used by the exporter and score reducer. */
  eventType: "KICKOFF" | "GOAL";
  /** Rich activity type for curated match chronology. */
  activityType?: MatchEventType;
  team?: TeamSide;
  minute: number;
  clockLabel?: string;
  label?: string;
  detail?: string;
  importance?: EventImportance;
  category?: EventCategory;
  outcome?: string;
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
  eventType: MatchEventType;
  minute: number;
  team?: TeamSide;
  clockLabel?: string;
  label?: string;
  detail?: string;
  importance: EventImportance;
  category: EventCategory;
  outcome?: string;
}

export interface TeamVisibleStatistics {
  shots: number;
  shotsOnTarget: number;
  corners: number;
  yellowCards: number;
  redCards: number;
  substitutions: number;
  freeKicks: number;
  throwIns: number;
  goalKicks: number;
  injuries: number;
}

export interface VisibleMatchStatistics {
  home: TeamVisibleStatistics;
  away: TeamVisibleStatistics;
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
  statistics: VisibleMatchStatistics;
  impliedProbabilities?: ImpliedProbabilities;
  impliedProbabilitiesTimestamp?: number;
  latestExplanation?: string;
  safety: SafetyStatus;
}
