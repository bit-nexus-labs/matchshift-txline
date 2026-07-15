import type { MatchDefinition } from "../core/types.js";
import type { FetchLike } from "../txline/credentials.js";
import { readTxlineConfig } from "../txline/config.js";
import { TxlineAdapter } from "../txline/adapter.js";
import type { DataSourceStatus, MatchDataSource } from "./types.js";
import { SyntheticMatchDataSource } from "./synthetic-source.js";

class ConfigurationErrorDataSource implements MatchDataSource {
  readonly mode: MatchDataSource["mode"];
  readonly #message: string;

  constructor(
    mode: MatchDataSource["mode"],
    message: string
  ) {
    this.mode = mode;
    this.#message = message;
  }

  getStatus(): DataSourceStatus {
    return {
      mode: this.mode,
      ...(this.mode === "synthetic" ? {} : { network: this.mode }),
      state: "CONFIG_ERROR",
      message: this.#message
    };
  }

  getMatches(): readonly MatchDefinition[] {
    return [];
  }
}

export function createMatchDataSource(
  env: Readonly<Record<string, string | undefined>>,
  fetchFn?: FetchLike
): MatchDataSource {
  const config = readTxlineConfig(env);
  if (config.mode === "synthetic") {
    return config.configurationError === undefined
      ? new SyntheticMatchDataSource()
      : new ConfigurationErrorDataSource(
          config.mode,
          config.configurationError
        );
  }

  if (
    config.network === undefined ||
    config.apiOrigin === undefined ||
    config.apiToken === undefined ||
    config.configurationError !== undefined
  ) {
    return new ConfigurationErrorDataSource(
      config.mode,
      config.configurationError ?? "TxLINE configuration is incomplete."
    );
  }

  return new TxlineAdapter({
    config: {
      ...config,
      mode: config.mode,
      network: config.network,
      apiOrigin: config.apiOrigin,
      apiToken: config.apiToken
    },
    ...(fetchFn === undefined ? {} : { fetchFn })
  });
}
