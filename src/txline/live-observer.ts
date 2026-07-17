import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MatchDefinition, MatchRecord } from "../core/types.js";
import { TxlineAdapter, type RunStreamOptions } from "./adapter.js";
import {
  resolveTxlineOrigin,
  type TxlineNetwork,
  type TxlineRuntimeConfig
} from "./config.js";
import { TxlineHttpClient, type TxlineStreamKind } from "./http-client.js";
import {
  normalizeFixtures,
  type NormalizedFixture
} from "./normalizer.js";
import { sanitizedErrorMessage } from "./redaction.js";

const HOUR_MS = 60 * 60 * 1_000;

export interface LiveObserverDiscoveryClient {
  fetchFixturesSnapshot(
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<unknown>;
}

export interface LiveObserverAdapter {
  hydrateSelectedFixture(
    fixtureId: string,
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<MatchDefinition>;
  runStream(kind: TxlineStreamKind, options: RunStreamOptions): Promise<void>;
}

export interface LiveObserverOptions {
  network: TxlineNetwork;
  discoveryClient: LiveObserverDiscoveryClient;
  adapter: LiveObserverAdapter;
  fixtureId?: string;
  competitionId?: string | number;
  observeMs?: number;
  fixtureWindowHours?: number;
  now?: number;
  commitSha?: string;
}

export interface LiveObserverResult {
  status: "PASS" | "NOT_OBSERVED";
  receipt: string;
  observedKind?: MatchRecord["kind"];
  observedSourceTimestamp?: number;
}

export class LiveObserverError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LiveObserverError";
    this.code = code;
  }
}

function selectFixture(
  fixtures: readonly NormalizedFixture[],
  now: number,
  fixtureWindowHours: number,
  requestedFixtureId?: string
): NormalizedFixture | undefined {
  const selectable = fixtures.filter(
    (fixture) => fixture.selectionState === "SELECTABLE"
  );
  if (requestedFixtureId !== undefined) {
    const exact = selectable.find(
      (fixture) => fixture.fixtureId === requestedFixtureId
    );
    if (exact === undefined) {
      throw new LiveObserverError(
        "FIXTURE_NOT_AVAILABLE",
        "The configured live fixture is unavailable or ambiguous."
      );
    }
    return exact;
  }

  const windowMs = fixtureWindowHours * HOUR_MS;
  const candidate = selectable
    .filter(
      (fixture) => Math.abs(fixture.startTimestamp - now) <= windowMs
    )
    .sort((left, right) => {
      const leftStarted = left.startTimestamp <= now ? 0 : 1;
      const rightStarted = right.startTimestamp <= now ? 0 : 1;
      return (
        leftStarted - rightStarted ||
        Math.abs(left.startTimestamp - now) -
          Math.abs(right.startTimestamp - now)
      );
    })[0];

  return candidate;
}

function resolveCommitSha(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== "") {
    return explicit.trim();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNKNOWN";
  }
}

export function renderLiveObserverReceipt(input: {
  network: TxlineNetwork;
  status: "PASS" | "NOT_OBSERVED";
  baselineReady: boolean;
  commitSha: string;
  verifiedAt: string;
}): string {
  const pass = input.status === "PASS";
  return [
    `TXLINE LIVE INPUT OBSERVER: ${pass ? "PASS" : "NOT OBSERVED"}`,
    "",
    `Network: ${input.network}`,
    `Fixture baseline: ${input.baselineReady ? "PASS" : "NOT RUN"}`,
    `SSE data record observed: ${pass ? "PASS" : "NO"}`,
    `Heartbeat-only accepted as proof: NO`,
    `Production normalizer: ${pass ? "PASS" : "NOT VERIFIED"}`,
    `Literal live input evidence: ${pass ? "PASS" : "NOT OBSERVED"}`,
    "",
    `Commit: ${input.commitSha}`,
    `Verified at UTC: ${input.verifiedAt}`,
    "",
    "Raw SSE payload logged: NO",
    "Raw SSE payload persisted: NO",
    "TxLINE data published: NO",
    "Receipt allowlist validation: PASS",
    ""
  ].join("\n");
}

export function validateLiveObserverReceipt(receipt: string): void {
  const forbidden = [
    /fixtureId/i,
    /participant\d/i,
    /Bearer\s+/i,
    /X-Api-Token/i,
    /https?:\/\//i,
    /\{[\s\S]*\}/,
    /\[[\s\S]*\]/
  ];
  if (forbidden.some((pattern) => pattern.test(receipt))) {
    throw new LiveObserverError(
      "RECEIPT_ALLOWLIST_FAILED",
      "The live observer receipt contained a forbidden data-shaped value."
    );
  }
}

export async function observeLiveInput(
  options: LiveObserverOptions
): Promise<LiveObserverResult> {
  const now = options.now ?? Date.now();
  const observeMs = options.observeMs ?? 45_000;
  const fixtureWindowHours = options.fixtureWindowHours ?? 6;
  if (!Number.isSafeInteger(observeMs) || observeMs <= 0) {
    throw new LiveObserverError(
      "INVALID_CONFIGURATION",
      "The live observation duration must be a positive integer."
    );
  }
  if (!Number.isFinite(fixtureWindowHours) || fixtureWindowHours <= 0) {
    throw new LiveObserverError(
      "INVALID_CONFIGURATION",
      "The fixture observation window must be positive."
    );
  }

  const fixturePayload = await options.discoveryClient.fetchFixturesSnapshot(
    options.competitionId
  );
  const fixtures = normalizeFixtures(fixturePayload);
  if (fixtures.length === 0) {
    throw new LiveObserverError(
      "FIXTURE_SCHEMA_INVALID",
      "The TxLINE fixture snapshot contained no valid documented fixture records."
    );
  }
  const fixture = selectFixture(
    fixtures,
    now,
    fixtureWindowHours,
    options.fixtureId
  );
if (fixture === undefined) {
  const receipt = renderLiveObserverReceipt({
    network: options.network,
    status: "NOT_OBSERVED",
    baselineReady: false,
    commitSha: resolveCommitSha(options.commitSha),
    verifiedAt: new Date(now).toISOString()
  });
  validateLiveObserverReceipt(receipt);
  return { status: "NOT_OBSERVED", receipt };
}

  const controller = new AbortController();
  let observed: MatchRecord | undefined;
  let observerFailure: LiveObserverError | undefined;
  const timer = setTimeout(
    () => controller.abort("LIVE_OBSERVE_TIMEOUT"),
    observeMs
  );
  try {
    const baseline = await options.adapter.hydrateSelectedFixture(
      fixture.fixtureId,
      options.competitionId,
      controller.signal
    );
    if (baseline.fixtureId !== fixture.fixtureId) {
      throw new LiveObserverError(
        "BASELINE_MISMATCH",
        "The hydrated fixture baseline did not match the selected fixture."
      );
    }

    const onRecord = async (record: MatchRecord): Promise<void> => {
      if (observed !== undefined || observerFailure !== undefined) {
        return;
      }
      if (
        record.fixtureId !== fixture.fixtureId ||
        !Number.isSafeInteger(record.sourceTimestamp)
      ) {
        observerFailure = new LiveObserverError(
          "NORMALIZED_RECORD_INVALID",
          "The live stream produced an invalid normalized record."
        );
        controller.abort("LIVE_DATA_RECORD_INVALID");
        return;
      }
      observed = record;
      controller.abort("LIVE_DATA_RECORD_OBSERVED");
    };

    const streamResults = await Promise.allSettled([
      options.adapter.runStream("odds", {
        fixtureId: fixture.fixtureId,
        signal: controller.signal,
        maxReconnectAttempts: 0,
        onRecord
      }),
      options.adapter.runStream("scores", {
        fixtureId: fixture.fixtureId,
        signal: controller.signal,
        maxReconnectAttempts: 0,
        onRecord
      })
    ]);
    if (observerFailure !== undefined) {
      throw observerFailure;
    }
    const rejected = streamResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (rejected !== undefined && !controller.signal.aborted) {
      throw new LiveObserverError(
        "STREAM_OBSERVER_FAILED",
        "A TxLINE live stream failed before observation completed."
      );
    }
  } finally {
    clearTimeout(timer);
  }

  const status = observed === undefined ? "NOT_OBSERVED" : "PASS";
  const receipt = renderLiveObserverReceipt({
    network: options.network,
    status,
    baselineReady: true,
    commitSha: resolveCommitSha(options.commitSha),
    verifiedAt: new Date(now).toISOString()
  });
  validateLiveObserverReceipt(receipt);

  if (observed === undefined) {
    return { status, receipt };
  }
  return {
    status,
    receipt,
    observedKind: observed.kind,
    observedSourceTimestamp: observed.sourceTimestamp
  };
}

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new LiveObserverError(
    "INVALID_CONFIGURATION",
    "TXLINE_NETWORK must be mainnet or devnet."
  );
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
    throw new LiveObserverError(
      "INVALID_CONFIGURATION",
      `${name} must be a positive integer.`
    );
  }
  return parsed;
}

export async function observeLiveInputFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<LiveObserverResult> {
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    throw new LiveObserverError(
      "INVALID_CONFIGURATION",
      "TXLINE_API_TOKEN is required for live observation."
    );
  }
  const requestTimeoutMs = readPositiveInteger(
    env.TXLINE_REQUEST_TIMEOUT_MS,
    30_000,
    "TXLINE_REQUEST_TIMEOUT_MS"
  );
  const reconnectBaseMs = readPositiveInteger(
    env.TXLINE_RECONNECT_BASE_MS,
    1_000,
    "TXLINE_RECONNECT_BASE_MS"
  );
  const reconnectMaxMs = readPositiveInteger(
    env.TXLINE_RECONNECT_MAX_MS,
    30_000,
    "TXLINE_RECONNECT_MAX_MS"
  );
  if (reconnectMaxMs < reconnectBaseMs) {
    throw new LiveObserverError(
      "INVALID_CONFIGURATION",
      "TXLINE_RECONNECT_MAX_MS must be at least TXLINE_RECONNECT_BASE_MS."
    );
  }
  const observeMs = readPositiveInteger(
    env.TXLINE_LIVE_OBSERVE_MS,
    45_000,
    "TXLINE_LIVE_OBSERVE_MS"
  );
  const fixtureWindowHours = readPositiveInteger(
    env.TXLINE_LIVE_WINDOW_HOURS,
    6,
    "TXLINE_LIVE_WINDOW_HOURS"
  );
  const fixtureId = env.TXLINE_LIVE_FIXTURE_ID?.trim();
  const competitionId = env.TXLINE_COMPETITION_ID?.trim();
  const apiOrigin = resolveTxlineOrigin(network);
  const client = new TxlineHttpClient({
    apiOrigin,
    apiToken,
    requestTimeoutMs
  });
  const config: TxlineRuntimeConfig & {
    mode: TxlineNetwork;
    network: TxlineNetwork;
  } = {
    mode: network,
    network,
    apiOrigin,
    apiToken,
    requestTimeoutMs,
    reconnectBaseMs,
    reconnectMaxMs
  };
  const adapter = new TxlineAdapter({ config, client });

  return observeLiveInput({
    network,
    discoveryClient: client,
    adapter,
    observeMs,
    fixtureWindowHours,
    ...(fixtureId === undefined || fixtureId === "" ? {} : { fixtureId }),
    ...(competitionId === undefined || competitionId === ""
      ? {}
      : { competitionId })
  });
}

export async function writeLiveObserverReceipt(
  result: LiveObserverResult,
  path: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, result.receipt, { encoding: "utf8", mode: 0o600 });
}

export async function liveObserverCli(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await observeLiveInputFromEnvironment(env);
    const receiptPath =
      env.TXLINE_LIVE_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-live-observer.md";
    await writeLiveObserverReceipt(result, receiptPath);
    if (result.status === "PASS") {
      process.stdout.write("TXLINE LIVE INPUT OBSERVER: PASS\n");
      process.stdout.write(`Receipt written: ${receiptPath}\n`);
      return;
    }
    process.stdout.write("TXLINE LIVE INPUT OBSERVER: NOT OBSERVED\n");
    process.stdout.write("No normalized SSE data record arrived before the observation ended.\n");
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
    process.exitCode = 2;
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE LIVE INPUT OBSERVER: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}
