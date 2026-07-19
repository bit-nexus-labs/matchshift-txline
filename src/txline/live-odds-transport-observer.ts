import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleepFor } from "node:timers/promises";
import {
  resolveTxlineOrigin,
  type TxlineNetwork
} from "./config.js";
import {
  TxlineConfigurationError,
  TxlineHttpClient,
  TxlineHttpError
} from "./http-client.js";
import { readSseFrames } from "./sse-parser.js";

const DEFAULT_OBSERVE_MS = 5 * 60_000;
const DEFAULT_RECONNECT_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type UnknownRecord = Record<string, unknown>;

export interface LiveOddsTransportResult {
  status: "PASS" | "NOT_OBSERVED";
  receipt: string;
  connectionsEstablished: number;
  heartbeatFramesObserved: number;
  dataFramesObserved: number;
}

export interface LiveOddsTransportClient {
  openStream(kind: "odds", signal?: AbortSignal): Promise<Response>;
}

export interface LiveOddsTransportDependencies {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  createClient(input: {
    apiOrigin: string;
    apiToken: string;
    requestTimeoutMs: number;
  }): LiveOddsTransportClient;
  resolveCommitSha(): string;
}

const defaultDependencies: LiveOddsTransportDependencies = {
  now: Date.now,
  sleep: async (milliseconds) => {
    await sleepFor(milliseconds);
  },
  createClient: (input) => new TxlineHttpClient(input),
  resolveCommitSha: () => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      return "UNKNOWN";
    }
  }
};

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readValue(
  source: UnknownRecord,
  names: readonly string[]
): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      return source[name];
    }
  }
  return undefined;
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new Error("TXLINE_NETWORK must be mainnet or devnet.");
}

export function isStructurallyValidOddsTransportPayload(
  value: unknown
): boolean {
  const source = asRecord(value);
  if (source === undefined) {
    return false;
  }

  const action =
    readStringLike(readValue(source, ["action", "Action"]))?.toLowerCase() ??
    "";
  if (action === "disconnected") {
    return false;
  }

  const fixtureId = readStringLike(
    readValue(source, ["FixtureId", "fixtureId"])
  );
  const superOddsType = readStringLike(
    readValue(source, ["SuperOddsType", "superOddsType"])
  );
  const sourceTimestamp = readStringLike(readValue(source, ["Ts", "ts"]));
  const rawPriceNames = readValue(source, ["PriceNames", "priceNames"]);
  const rawValues =
    readValue(source, ["Pct", "pct"]) ??
    readValue(source, ["Prices", "prices"]);

  if (
    fixtureId === undefined ||
    superOddsType === undefined ||
    sourceTimestamp === undefined ||
    !Array.isArray(rawPriceNames) ||
    !Array.isArray(rawValues) ||
    rawPriceNames.length < 2 ||
    rawPriceNames.length !== rawValues.length
  ) {
    return false;
  }

  const labelsValid = rawPriceNames.every(
    (item) => typeof item === "string" && item.trim() !== ""
  );
  const valuesValid = rawValues.every(
    (item) => readFiniteNumber(item) !== undefined
  );
  return labelsValid && valuesValid;
}

function renderReceipt(input: {
  network: TxlineNetwork;
  status: "PASS" | "NOT_OBSERVED";
  connectionsEstablished: number;
  heartbeatFramesObserved: number;
  dataFramesObserved: number;
  verifiedAt: string;
  commitSha: string;
}): string {
  const pass = input.status === "PASS";
  return [
    `TXLINE LIVE ODDS TRANSPORT OBSERVER: ${
      pass ? "PASS" : "NOT OBSERVED"
    }`,
    "",
    `Network: ${input.network}`,
    `SSE connections established: ${input.connectionsEstablished}`,
    `Heartbeat frames observed: ${input.heartbeatFramesObserved}`,
    `Non-heartbeat data frames observed: ${input.dataFramesObserved}`,
    `Structurally valid odds data event received: ${pass ? "PASS" : "NO"}`,
    "Product semantic normalization claimed: NO",
    "Raw provider payload logged: NO",
    "Raw provider payload persisted: NO",
    "TxLINE data published: NO",
    "",
    `Commit: ${input.commitSha}`,
    `Verified at UTC: ${input.verifiedAt}`,
    ""
  ].join("\n");
}

export async function observeLiveOddsTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: LiveOddsTransportDependencies = defaultDependencies
): Promise<LiveOddsTransportResult> {
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    throw new Error("TXLINE_API_TOKEN is required for live transport observation.");
  }

  const observeMs = readPositiveInteger(
    env.TXLINE_LIVE_TRANSPORT_OBSERVE_MS ?? env.TXLINE_LIVE_OBSERVE_MS,
    DEFAULT_OBSERVE_MS,
    "TXLINE_LIVE_TRANSPORT_OBSERVE_MS"
  );
  const reconnectMs = readPositiveInteger(
    env.TXLINE_LIVE_TRANSPORT_RECONNECT_MS,
    DEFAULT_RECONNECT_MS,
    "TXLINE_LIVE_TRANSPORT_RECONNECT_MS"
  );
  const requestTimeoutMs = readPositiveInteger(
    env.TXLINE_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    "TXLINE_REQUEST_TIMEOUT_MS"
  );
  const client = dependencies.createClient({
    apiOrigin: resolveTxlineOrigin(network),
    apiToken,
    requestTimeoutMs
  });
  const deadline = dependencies.now() + observeMs;
  let connectionsEstablished = 0;
  let heartbeatFramesObserved = 0;
  let dataFramesObserved = 0;

  while (dependencies.now() < deadline) {
    const controller = new AbortController();
    const remaining = Math.max(1, deadline - dependencies.now());
    const timer = setTimeout(
      () => controller.abort("TXLINE_LIVE_TRANSPORT_WINDOW_END"),
      remaining
    );

    try {
      const response = await client.openStream("odds", controller.signal);
      connectionsEstablished += 1;
      if (response.body === null) {
        throw new TxlineHttpError(
          "EMPTY_STREAM",
          "TxLINE odds stream response had no body."
        );
      }

      for await (const frame of readSseFrames(response.body, controller.signal)) {
        if (frame.kind === "heartbeat") {
          heartbeatFramesObserved += 1;
          continue;
        }
        if (frame.event?.trim().toLowerCase() === "heartbeat") {
          heartbeatFramesObserved += 1;
          continue;
        }
        if (frame.data.trim() === "") {
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(frame.data) as unknown;
        } catch {
          continue;
        }
        dataFramesObserved += 1;
        const payloads = Array.isArray(payload) ? payload : [payload];
        if (payloads.some(isStructurallyValidOddsTransportPayload)) {
          const receipt = renderReceipt({
            network,
            status: "PASS",
            connectionsEstablished,
            heartbeatFramesObserved,
            dataFramesObserved,
            commitSha: dependencies.resolveCommitSha(),
            verifiedAt: new Date(dependencies.now()).toISOString()
          });
          return {
            status: "PASS",
            receipt,
            connectionsEstablished,
            heartbeatFramesObserved,
            dataFramesObserved
          };
        }
      }
    } catch (error) {
      if (
        controller.signal.aborted &&
        dependencies.now() >= deadline
      ) {
        break;
      }
      if (
        error instanceof TxlineConfigurationError ||
        (error instanceof TxlineHttpError &&
          [
            "CONFIG_ERROR",
            "UNAUTHORIZED",
            "INVALID_CONTENT_TYPE",
            "EMPTY_STREAM"
          ].includes(error.code))
      ) {
        throw error;
      }
      if (
        error instanceof TxlineHttpError &&
        error.code === "ABORTED" &&
        dependencies.now() >= deadline
      ) {
        break;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const waitMs = Math.min(reconnectMs, Math.max(0, deadline - dependencies.now()));
    if (waitMs > 0) {
      await dependencies.sleep(waitMs);
    }
  }

  const receipt = renderReceipt({
    network,
    status: "NOT_OBSERVED",
    connectionsEstablished,
    heartbeatFramesObserved,
    dataFramesObserved,
    commitSha: dependencies.resolveCommitSha(),
    verifiedAt: new Date(dependencies.now()).toISOString()
  });
  return {
    status: "NOT_OBSERVED",
    receipt,
    connectionsEstablished,
    heartbeatFramesObserved,
    dataFramesObserved
  };
}

export async function writeLiveOddsTransportReceipt(
  result: LiveOddsTransportResult,
  receiptPath: string
): Promise<void> {
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, result.receipt, { encoding: "utf8" });
}
