import type { MatchDefinition } from "../core/types.js";
import { SYNTHETIC_MATCH } from "../replay/synthetic-scenario.js";
import type { DataSourceStatus, MatchDataSource } from "./types.js";

export class SyntheticMatchDataSource implements MatchDataSource {
  readonly mode = "synthetic" as const;

  getStatus(): DataSourceStatus {
    return {
      mode: this.mode,
      state: "SYNTHETIC_READY",
      message: "Deterministic synthetic replay is ready."
    };
  }

  getMatches(): readonly MatchDefinition[] {
    return [SYNTHETIC_MATCH];
  }
}
