import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MatchRecord } from "../core/types.js";
import { TxlineAdapter } from "./adapter.js";
import { resolveTxlineOrigin, type TxlineNetwork, type TxlineRuntimeConfig } from "./config.js";
import { TxlineHttpClient } from "./http-client.js";
import { normalizeFixtures, type NormalizedFixture } from "./normalizer.js";

const HOUR_MS = 60 * 60 * 1_000;
const DEFAULT_OBSERVE_MS = 3 * HOUR_MS;
const DEFAULT_WINDOW_HOURS = 3;
const DEFAULT_OUTPUT_PATH = "artifacts/private/txline-live-match-capture.jsonl";

type CaptureOrigin = "baseline" | "stream";

export interface SanitizedLiveCaptureRecord {
  type: "record";
  captureSequence: number;
  captureOrigin: CaptureOrigin;
  domain: "scores" | "odds";
  kind: MatchRecord["kind"];
  sourceTimestamp: number;
  eventType?: "KICKOFF" | "GOAL";
  team?: "HOME" | "AWAY";
  minute?: number;
  score?: { home: number; away: number };
  impliedProbabilities?: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
}

export interface LiveMatchRecorderResult {
  outputPath: string;
  matchLabel: string;
  baselineRecords: number;
  streamRecords: number;
  scoreRecords: number;
  oddsRecords: number;
  startedAt: number;
  endedAt: number;
  stopReason: "WINDOW_END" | "SIGNAL" | "STREAMS_ENDED";
}

export interface LiveMatchRecorderOptions {
  network: TxlineNetwork;
  apiToken: string;
  sideA: string;
  sideB: string;
  observeMs?: number;
  fixtureWindowHours?: number;
  outputPath?: string;
  competitionId?: string | number;
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  onCapture?: (record: SanitizedLiveCaptureRecord) => void;
}

function canonicalParticipant(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function selectLiveMatchFixture(input: {
  fixtures: readonly NormalizedFixture[];
  sideA: string;
  sideB: string;
  now: number;
  fixtureWindowHours: number;
}): NormalizedFixture {
  const requested = new Set([
    canonicalParticipant(input.sideA),
    canonicalParticipant(input.sideB)
  ]);
  const windowMs = input.fixtureWindowHours * HOUR_MS;
  const candidates = input.fixtures
    .filter((fixture) => {
      if (fixture.selectionState !== "SELECTABLE") {
        return false;
      }
      const actual = new Set([
        canonicalParticipant(fixture.participant1),
        canonicalParticipant(fixture.participant2)
      ]);
      return (
        actual.size === 2 &&
        requested.size === 2 &&
        [...requested].every((participant) => actual.has(participant)) &&
        Math.abs(fixture.startTimestamp - input.now) <= windowMs
      );
    })
    .sort(
      (left, right) =>
        Math.abs(left.startTimestamp - input.now) -
          Math.abs(right.startTimestamp - input.now) ||
        right.startTimestamp - left.startTimestamp
    );

  if (candidates.length === 0) {
    throw new Error(
      "No selectable TxLINE fixture matched the configured participants near the current time."
    );
  }
  if (
    candidates.length > 1 &&
    candidates[0]!.startTimestamp === candidates[1]!.startTimestamp
  ) {
    throw new Error(
      "More than one TxLINE fixture matched the configured participants and kickoff time."
    );
  }
  return candidates[0]!;
}

export function sanitizeLiveCaptureRecord(
  record: MatchRecord,
  captureSequence: number,
  captureOrigin: CaptureOrigin
): SanitizedLiveCaptureRecord {
  const shared = {
    type: "record" as const,
    captureSequence,
    captureOrigin,
    domain: record.kind === "odds" ? ("odds" as const) : ("scores" as const),
    kind: record.kind,
    sourceTimestamp: record.sourceTimestamp
  };

  if (record.kind === "event") {
    return {
      ...shared,
      eventType: record.eventType,
      minute: record.minute,
      ...(record.team === undefined ? {} : { team: record.team })
    };
  }
  if (record.kind === "recovery") {
    return {
      ...shared,
      score: { ...record.snapshot.score },
      ...(record.snapshot.impliedProbabilities === undefined
        ? {}
        : {
            impliedProbabilities: {
              ...record.snapshot.impliedProbabilities
            }
          })
    };
  }
  return {
    ...shared,
    impliedProbabilities: { ...record.impliedProbabilities }
  };
}

function captureSignature(record: SanitizedLiveCaptureRecord): string {
  return JSON.stringify({
    captureOrigin: record.captureOrigin,
    domain: record.domain,
    kind: record.kind,
    sourceTimestamp: record.sourceTimestamp,
    eventType: record.eventType,
    team: record.team,
    minute: record.minute,
    score: record.score,
    impliedProbabilities: record.impliedProbabilities
  });
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

export async function recordLiveMatch(
  options: LiveMatchRecorderOptions
): Promise<LiveMatchRecorderResult> {
  const observeMs = options.observeMs ?? DEFAULT_OBSERVE_MS;
  const fixtureWindowHours =
    options.fixtureWindowHours ?? DEFAULT_WINDOW_HOURS;
  const outputPath = options.outputPath?.trim() || DEFAULT_OUTPUT_PATH;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
  const reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
  const now = options.now ?? Date.now;

  assertPositiveInteger(observeMs, "observeMs");
  assertPositiveInteger(fixtureWindowHours, "fixtureWindowHours");
  assertPositiveInteger(requestTimeoutMs, "requestTimeoutMs");
  assertPositiveInteger(reconnectBaseMs, "reconnectBaseMs");
  assertPositiveInteger(reconnectMaxMs, "reconnectMaxMs");
  if (reconnectMaxMs < reconnectBaseMs) {
    throw new Error("reconnectMaxMs must be at least reconnectBaseMs.");
  }
  if (options.apiToken.trim() === "") {
    throw new Error("TxLINE API token is required for live recording.");
  }

  const apiOrigin = resolveTxlineOrigin(options.network);
  const client = new TxlineHttpClient({
    apiOrigin,
    apiToken: options.apiToken,
    requestTimeoutMs
  });
  const fixturePayload = await client.fetchFixturesSnapshot(options.competitionId);
  const fixture = selectLiveMatchFixture({
    fixtures: normalizeFixtures(fixturePayload),
    sideA: options.sideA,
    sideB: options.sideB,
    now: now(),
    fixtureWindowHours
  });
  const matchLabel = `${fixture.homeParticipant} vs ${fixture.awayParticipant}`;

  const config: TxlineRuntimeConfig & {
    mode: TxlineNetwork;
    network: TxlineNetwork;
  } = {
    mode: options.network,
    network: options.network,
    apiOrigin,
    apiToken: options.apiToken,
    requestTimeoutMs,
    reconnectBaseMs,
    reconnectMaxMs
  };
  const oddsAdapter = new TxlineAdapter({ config, client });
  const scoresAdapter = new TxlineAdapter({ config, client });
  const baseline = await oddsAdapter.hydrateSelectedFixture(
    fixture.fixtureId,
    options.competitionId
  );
  await scoresAdapter.hydrateSelectedFixture(
    fixture.fixtureId,
    options.competitionId
  );

  await mkdir(dirname(outputPath), { recursive: true });
  const startedAt = now();
  await writeFile(
    outputPath,
    `${JSON.stringify({
      type: "capture-start",
      schemaVersion: 1,
      network: options.network,
      matchLabel,
      kickoffTimestamp: fixture.startTimestamp,
      startedAt,
      rawProviderPayloadPersisted: false,
      providerIdentifiersPersisted: false
    })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  let writeChain = Promise.resolve();
  let captureSequence = 0;
  let baselineRecords = 0;
  let streamRecords = 0;
  let scoreRecords = 0;
  let oddsRecords = 0;
  const identities = new Set<string>();

  const capture = async (
    record: MatchRecord,
    captureOrigin: CaptureOrigin
  ): Promise<void> => {
    const candidate = sanitizeLiveCaptureRecord(
      record,
      captureSequence + 1,
      captureOrigin
    );
    const signature = captureSignature(candidate);
    if (identities.has(signature)) {
      return;
    }
    identities.add(signature);
    captureSequence += 1;
    const sanitized = { ...candidate, captureSequence };
    if (captureOrigin === "baseline") {
      baselineRecords += 1;
    } else {
      streamRecords += 1;
    }
    if (sanitized.domain === "scores") {
      scoreRecords += 1;
    } else {
      oddsRecords += 1;
    }
    writeChain = writeChain.then(() =>
      appendFile(outputPath, `${JSON.stringify(sanitized)}\n`, "utf8")
    );
    await writeChain;
    options.onCapture?.(sanitized);
  };

  for (const record of baseline.records) {
    await capture(record, "baseline");
  }

  const controller = new AbortController();
  let stopReason: LiveMatchRecorderResult["stopReason"] = "STREAMS_ENDED";
  const abortFromExternal = (): void => {
    stopReason = "SIGNAL";
    controller.abort("LIVE_MATCH_RECORDER_SIGNAL");
  };
  options.signal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    stopReason = "WINDOW_END";
    controller.abort("LIVE_MATCH_RECORDER_WINDOW_END");
  }, observeMs);

  try {
    await Promise.allSettled([
      oddsAdapter.runStream("odds", {
        fixtureId: fixture.fixtureId,
        signal: controller.signal,
        onRecord: (record) => capture(record, "stream")
      }),
      scoresAdapter.runStream("scores", {
        fixtureId: fixture.fixtureId,
        signal: controller.signal,
        onRecord: (record) => capture(record, "stream")
      })
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromExternal);
    await writeChain;
  }

  const endedAt = now();
  await appendFile(
    outputPath,
    `${JSON.stringify({
      type: "capture-end",
      endedAt,
      stopReason,
      baselineRecords,
      streamRecords,
      scoreRecords,
      oddsRecords
    })}\n`,
    "utf8"
  );

  return {
    outputPath,
    matchLabel,
    baselineRecords,
    streamRecords,
    scoreRecords,
    oddsRecords,
    startedAt,
    endedAt,
    stopReason
  };
}
