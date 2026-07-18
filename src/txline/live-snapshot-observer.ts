import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { MatchDefinition, MatchRecord } from "../core/types.js";
import { TxlineAdapter } from "./adapter.js";
import {
  resolveTxlineOrigin,
  type TxlineNetwork,
  type TxlineRuntimeConfig
} from "./config.js";
import { TxlineHttpClient } from "./http-client.js";
import { selectLiveCandidateFixtureIds } from "./live-observer-window.js";
import { normalizeFixtures } from "./normalizer.js";

const DEFAULT_OBSERVE_MS = 30 * 60_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_MAX_FIXTURES = 8;

export interface LiveSnapshotObserverResult {
  status: "PASS" | "NOT_OBSERVED";
  receipt: string;
  observedKind?: "scores" | "odds";
}

export interface LiveSnapshotObserverDependencies {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

const defaultDependencies: LiveSnapshotObserverDependencies = {
  now: Date.now,
  sleep: async (milliseconds) => {
    await sleep(milliseconds);
  }
};

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

function resolveCommitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function recordSignature(record: MatchRecord): string {
  const order = record.sourceOrder;
  return [
    record.kind,
    record.sourceTimestamp,
    order?.sourceSequence ?? "",
    order?.sourceMessageId ?? "",
    order?.sseEventId ?? "",
    order?.payloadIdentity ?? ""
  ].join("|");
}

export function matchSnapshotSignatures(match: MatchDefinition): {
  scores: string;
  odds: string;
} {
  const scores = match.records
    .filter((record) => record.kind === "event" || record.kind === "recovery")
    .map(recordSignature)
    .sort()
    .join("\n");
  const odds = match.records
    .filter((record) => record.kind === "odds")
    .map(recordSignature)
    .sort()
    .join("\n");
  return { scores, odds };
}

function renderReceipt(input: {
  network: TxlineNetwork;
  status: "PASS" | "NOT_OBSERVED";
  candidateCount: number;
  baselineCount: number;
  observedKind?: "scores" | "odds";
  verifiedAt: string;
}): string {
  const pass = input.status === "PASS";
  return [
    `TXLINE LIVE SNAPSHOT CHANGE OBSERVER: ${pass ? "PASS" : "NOT OBSERVED"}`,
    "",
    `Network: ${input.network}`,
    `Candidate fixtures checked: ${input.candidateCount}`,
    `Normalized baselines ready: ${input.baselineCount}`,
    `Normalized snapshot change observed: ${pass ? "PASS" : "NO"}`,
    `Observed domain: ${input.observedKind ?? "NONE"}`,
    "Raw provider payload logged: NO",
    "Raw provider payload persisted: NO",
    "TxLINE data published: NO",
    "",
    `Commit: ${resolveCommitSha()}`,
    `Verified at UTC: ${input.verifiedAt}`,
    ""
  ].join("\n");
}

export async function observeLiveSnapshotChanges(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: LiveSnapshotObserverDependencies = defaultDependencies
): Promise<LiveSnapshotObserverResult> {
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const apiToken = env.TXLINE_API_TOKEN?.trim();
  if (apiToken === undefined || apiToken === "") {
    throw new Error("TXLINE_API_TOKEN is required for live snapshot observation.");
  }
  const observeMs = readPositiveInteger(
    env.TXLINE_LIVE_OBSERVE_MS,
    DEFAULT_OBSERVE_MS,
    "TXLINE_LIVE_OBSERVE_MS"
  );
  const pollMs = readPositiveInteger(
    env.TXLINE_LIVE_SNAPSHOT_POLL_MS,
    DEFAULT_POLL_MS,
    "TXLINE_LIVE_SNAPSHOT_POLL_MS"
  );
  const maxFixtures = readPositiveInteger(
    env.TXLINE_LIVE_SNAPSHOT_MAX_FIXTURES,
    DEFAULT_MAX_FIXTURES,
    "TXLINE_LIVE_SNAPSHOT_MAX_FIXTURES"
  );
  const fixtureWindowHours = readPositiveInteger(
    env.TXLINE_LIVE_WINDOW_HOURS,
    6,
    "TXLINE_LIVE_WINDOW_HOURS"
  );
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
  const competitionId = env.TXLINE_COMPETITION_ID?.trim();
  const manualFixtureId = env.TXLINE_LIVE_FIXTURE_ID?.trim();
  const apiOrigin = resolveTxlineOrigin(network);
  const client = new TxlineHttpClient({
    apiOrigin,
    apiToken,
    requestTimeoutMs
  });
  const now = dependencies.now();
  const fixturePayload = await client.fetchFixturesSnapshot(
    competitionId === undefined || competitionId === ""
      ? undefined
      : competitionId
  );
  const fixtures = normalizeFixtures(fixturePayload);
  const fixtureIds =
    manualFixtureId === undefined || manualFixtureId === ""
      ? selectLiveCandidateFixtureIds(fixtures, now, fixtureWindowHours).slice(
          0,
          maxFixtures
        )
      : [manualFixtureId];
  if (fixtureIds.length === 0) {
    const receipt = renderReceipt({
      network,
      status: "NOT_OBSERVED",
      candidateCount: 0,
      baselineCount: 0,
      verifiedAt: new Date(dependencies.now()).toISOString()
    });
    return { status: "NOT_OBSERVED", receipt };
  }

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
  const adapters = new Map(
    fixtureIds.map(
      (fixtureId) =>
        [fixtureId, new TxlineAdapter({ config, client })] as const
    )
  );
  const baselines = new Map<string, { scores: string; odds: string }>();
  const deadline = dependencies.now() + observeMs;

  while (dependencies.now() < deadline) {
    const polls = await Promise.allSettled(
      fixtureIds.map(async (fixtureId) => {
        const adapter = adapters.get(fixtureId);
        if (adapter === undefined) {
          return undefined;
        }
        const match = await adapter.hydrateSelectedFixture(
          fixtureId,
          competitionId === undefined || competitionId === ""
            ? undefined
            : competitionId
        );
        return { fixtureId, signatures: matchSnapshotSignatures(match) };
      })
    );

    for (const poll of polls) {
      if (poll.status !== "fulfilled" || poll.value === undefined) {
        continue;
      }
      const { fixtureId, signatures } = poll.value;
      const previous = baselines.get(fixtureId);
      if (previous === undefined) {
        if (signatures.scores !== "" || signatures.odds !== "") {
          baselines.set(fixtureId, signatures);
        }
        continue;
      }
      if (signatures.scores !== "" && signatures.scores !== previous.scores) {
        const receipt = renderReceipt({
          network,
          status: "PASS",
          candidateCount: fixtureIds.length,
          baselineCount: baselines.size,
          observedKind: "scores",
          verifiedAt: new Date(dependencies.now()).toISOString()
        });
        return { status: "PASS", receipt, observedKind: "scores" };
      }
      if (signatures.odds !== "" && signatures.odds !== previous.odds) {
        const receipt = renderReceipt({
          network,
          status: "PASS",
          candidateCount: fixtureIds.length,
          baselineCount: baselines.size,
          observedKind: "odds",
          verifiedAt: new Date(dependencies.now()).toISOString()
        });
        return { status: "PASS", receipt, observedKind: "odds" };
      }
      baselines.set(fixtureId, signatures);
    }

    const remaining = deadline - dependencies.now();
    if (remaining <= 0) {
      break;
    }
    await dependencies.sleep(Math.min(pollMs, remaining));
  }

  const receipt = renderReceipt({
    network,
    status: "NOT_OBSERVED",
    candidateCount: fixtureIds.length,
    baselineCount: baselines.size,
    verifiedAt: new Date(dependencies.now()).toISOString()
  });
  return { status: "NOT_OBSERVED", receipt };
}

export async function writeLiveSnapshotObserverReceipt(
  result: LiveSnapshotObserverResult,
  path: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, result.receipt, { encoding: "utf8", mode: 0o600 });
}
