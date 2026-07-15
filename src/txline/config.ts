import type { DataSourceMode } from "../data-source/types.js";

const TXLINE_ORIGINS = {
  mainnet: "https://txline.txodds.com",
  devnet: "https://txline-dev.txodds.com"
} as const;

export type TxlineNetwork = keyof typeof TXLINE_ORIGINS;

export interface TxlineRuntimeConfig {
  mode: DataSourceMode;
  requestTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  network?: TxlineNetwork;
  apiOrigin?: string;
  apiToken?: string;
  configurationError?: string;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

export function resolveTxlineOrigin(network: TxlineNetwork): string {
  return TXLINE_ORIGINS[network];
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): { value: number; error?: string } {
  if (value === undefined || value.trim() === "") {
    return { value: fallback };
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return {
      value: fallback,
      error: `${name} must be a positive integer.`
    };
  }

  return { value: parsed };
}

export function readTxlineConfig(
  env: Readonly<Record<string, string | undefined>>
): TxlineRuntimeConfig {
  const rawMode = env.TXLINE_MODE?.trim().toLowerCase() ?? "synthetic";
  const mode: DataSourceMode =
    rawMode === "devnet" || rawMode === "mainnet" || rawMode === "synthetic"
      ? rawMode
      : "synthetic";
  const timeout = readPositiveInteger(
    env.TXLINE_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    "TXLINE_REQUEST_TIMEOUT_MS"
  );
  const reconnectBase = readPositiveInteger(
    env.TXLINE_RECONNECT_BASE_MS,
    DEFAULT_RECONNECT_BASE_MS,
    "TXLINE_RECONNECT_BASE_MS"
  );
  const reconnectMax = readPositiveInteger(
    env.TXLINE_RECONNECT_MAX_MS,
    DEFAULT_RECONNECT_MAX_MS,
    "TXLINE_RECONNECT_MAX_MS"
  );

  const errors = [timeout.error, reconnectBase.error, reconnectMax.error].filter(
    (error): error is string => error !== undefined
  );
  if (rawMode !== mode) {
    errors.unshift("TXLINE_MODE must be synthetic, devnet, or mainnet.");
  }
  if (reconnectMax.value < reconnectBase.value) {
    errors.push(
      "TXLINE_RECONNECT_MAX_MS must be greater than or equal to TXLINE_RECONNECT_BASE_MS."
    );
  }

  if (mode === "synthetic") {
    return {
      mode,
      requestTimeoutMs: timeout.value,
      reconnectBaseMs: reconnectBase.value,
      reconnectMaxMs: reconnectMax.value,
      ...(errors.length === 0 ? {} : { configurationError: errors.join(" ") })
    };
  }

  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    errors.push("TXLINE_API_TOKEN is required for TxLINE mode.");
  }

  return {
    mode,
    network: mode,
    apiOrigin: resolveTxlineOrigin(mode),
    requestTimeoutMs: timeout.value,
    reconnectBaseMs: reconnectBase.value,
    reconnectMaxMs: reconnectMax.value,
    ...(apiToken === undefined || apiToken === "" ? {} : { apiToken }),
    ...(errors.length === 0 ? {} : { configurationError: errors.join(" ") })
  };
}
