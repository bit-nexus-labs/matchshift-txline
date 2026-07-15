import type { MatchDefinition } from "../core/types.js";

export const DATA_SOURCE_STATES = [
  "SYNTHETIC_READY",
  "CONNECTING",
  "SNAPSHOT_READY",
  "LIVE",
  "IDLE_NO_COVERAGE",
  "DELAYED",
  "STALE",
  "SAFE_HOLD",
  "CONFIG_ERROR"
] as const;

export type DataSourceState = (typeof DATA_SOURCE_STATES)[number];
export type DataSourceMode = "synthetic" | "devnet" | "mainnet";

export interface DataSourceStatus {
  mode: DataSourceMode;
  state: DataSourceState;
  network?: "devnet" | "mainnet";
  message?: string;
  lastDataAt?: number;
  lastHeartbeatAt?: number;
  reconnectAttempt?: number;
}

export interface MatchDataSource {
  readonly mode: DataSourceMode;
  getStatus(): DataSourceStatus;
  getMatches(): readonly MatchDefinition[];
}
