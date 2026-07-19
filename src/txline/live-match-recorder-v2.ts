import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { MatchRecord } from "../core/types.js";
import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import { TxlineConfigurationError, TxlineHttpClient } from "./http-client.js";
import {
  normalizeFixtures,
  normalizeOddsPayload,
  normalizePayloads,
  normalizeScorePayload,
  type NormalizedFixture
} from "./normalizer.js";
import { readSseFrames } from "./sse-parser.js";
import {
  sanitizeLiveCaptureRecord,
  selectLiveMatchFixture,
  type LiveMatchRecorderResult,
  type SanitizedLiveCaptureRecord
} from "./live-match-recorder.js";

const HOUR_MS = 60 * 60 * 1_000;
const DEFAULT_OBSERVE_MS = 3 * HOUR_MS;
const DEFAULT_OUTPUT_PATH = "artifacts/private/txline-live-match-capture.jsonl";

type UnknownRecord = Record<string, unknown>;
type StreamKind = "odds" | "scores";

export interface FixtureScopedRecorderOptions {
  network: TxlineNetwork;
  apiToken: string;
  sideA: string;
  sideB: string;
  observeMs?: number;
  fixtureWindowHours?: number;
  outputPath?: string;
  competitionId?: string | number;
  requestTimeoutMs?: number;
  reconnectMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  onCapture?: (record: SanitizedLiveCaptureRecord) => void;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

function readValue(source: UnknownRecord, names: readonly string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      return source[name];
    }
  }
  return undefined;
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const source = asRecord(value);
  if (source === undefined) {
    return [];
  }
  for (const key of ["data", "odds", "scores"]) {
    const candidate = source[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [source];
}

export function payloadTargetsFixture(value: unknown, fixtureId: string): boolean {
  const source = asRecord(value);
  if (source === undefined) {
    return false;
  }
  const action =
    readStringLike(readValue(source, ["action", "Action"]))?.toLowerCase() ?? "";
  if (action === "disconnected") {
    return true;
  }
  const observedFixtureId = readStringLike(
    readValue(source, ["FixtureId", "fixtureId"])
  );
  return observedFixtureId === fixtureId;
}

function validPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function signature(record: SanitizedLiveCaptureRecord): string {
  return JSON.stringify({
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

function safeSnapshotRecords(
  payload: unknown,
  kind: StreamKind,
  fixture: NormalizedFixture,
  receivedTimestamp: number
): MatchRecord[] {
  const scopedItems = extractItems(payload).filter((item) =>
    payloadTargetsFixture(item, fixture.fixtureId)
  );
  if (scopedItems.length === 0) {
    return [];
  }
  const normalized = normalizePayloads(scopedItems, kind, {
    fixture,
    receivedTimestamp
  });
  return normalized.safeHold || normalized.issues.length > 0
    ? []
    : normalized.records.filter((record) => record.fixtureId === fixture.fixtureId);
}

export async function recordFixtureScopedLiveMatch(
  options: FixtureScopedRecorderOptions
): Promise<LiveMatchRecorderResult> {
  const observeMs = options.observeMs ?? DEFAULT_OBSERVE_MS;
  const fixtureWindowHours = options.fixtureWindowHours ?? 3;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const reconnectMs = options.reconnectMs ?? 1_000;
  const outputPath = options.outputPath?.trim() || DEFAULT_OUTPUT_PATH;
  const now = options.now ?? Date.now;

  validPositiveInteger(observeMs, "observeMs");
  validPositiveInteger(fixtureWindowHours, "fixtureWindowHours");
  validPositiveInteger(requestTimeoutMs, "requestTimeoutMs");
  validPositiveInteger(reconnectMs, "reconnectMs");
  if (options.apiToken.trim() === "") {
    throw new Error("TxLINE API token is required for live recording.");
  }

  const client = new TxlineHttpClient({
    apiOrigin: resolveTxlineOrigin(options.network),
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

  const [oddsSnapshot, scoresSnapshot] = await Promise.all([
    client.fetchOddsSnapshot(fixture.fixtureId),
    client.fetchScoresSnapshot(fixture.fixtureId)
  ]);
  const baselineRecords = [
    ...safeSnapshotRecords(oddsSnapshot, "odds", fixture, now()),
    ...safeSnapshotRecords(scoresSnapshot, "scores", fixture, now())
  ].sort((left, right) => left.sourceTimestamp - right.sourceTimestamp);

  await mkdir(dirname(outputPath), { recursive: true });
  const startedAt = now();
  await writeFile(
    outputPath,
    `${JSON.stringify({
      type: "capture-start",
      schemaVersion: 2,
      network: options.network,
      matchLabel,
      kickoffTimestamp: fixture.startTimestamp,
      startedAt,
      fixtureScopedBeforeNormalization: true,
      rawProviderPayloadPersisted: false,
      providerIdentifiersPersisted: false
    })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  let writeChain = Promise.resolve();
  let captureSequence = 0;
  let baselineCount = 0;
  let streamCount = 0;
  let scoreRecords = 0;
  let oddsRecords = 0;
  const identities = new Set<string>();

  const capture = async (
    record: MatchRecord,
    origin: "baseline" | "stream"
  ): Promise<void> => {
    const candidate = sanitizeLiveCaptureRecord(record, captureSequence + 1, origin);
    const identity = signature(candidate);
    if (identities.has(identity)) {
      return;
    }
    identities.add(identity);
    captureSequence += 1;
    const sanitized = { ...candidate, captureSequence };
    if (origin === "baseline") {
      baselineCount += 1;
    } else {
      streamCount += 1;
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

  for (const record of baselineRecords) {
    await capture(record, "baseline");
  }

  const controller = new AbortController();
  let stopReason: LiveMatchRecorderResult["stopReason"] = "WINDOW_END";
  const abortFromExternal = (): void => {
    stopReason = "SIGNAL";
    controller.abort("LIVE_MATCH_RECORDER_SIGNAL");
  };
  options.signal?.addEventListener("abort", abortFromExternal, { once: true });
  const timer = setTimeout(
    () => controller.abort("LIVE_MATCH_RECORDER_WINDOW_END"),
    observeMs
  );

  const runStream = async (kind: StreamKind): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        const response = await client.openStream(kind, controller.signal);
        if (response.body === null) {
          throw new Error("TxLINE stream response had no body.");
        }
        for await (const frame of readSseFrames(response.body, controller.signal)) {
          if (frame.kind === "heartbeat" || frame.data === "") {
            continue;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            continue;
          }
          for (const item of extractItems(payload)) {
            if (!payloadTargetsFixture(item, fixture.fixtureId)) {
              continue;
            }
            const normalized =
              kind === "odds"
                ? normalizeOddsPayload(item, {
                    fixture,
                    receivedTimestamp: now(),
                    ...(frame.id === undefined ? {} : { eventId: frame.id })
                  })
                : normalizeScorePayload(item, {
                    fixture,
                    receivedTimestamp: now(),
                    ...(frame.id === undefined ? {} : { eventId: frame.id })
                  });
            if (normalized.disconnected) {
              break;
            }
            if (normalized.safeHold || normalized.issues.length > 0) {
              continue;
            }
            for (const record of normalized.records) {
              if (record.fixtureId === fixture.fixtureId) {
                await capture(record, "stream");
              }
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof TxlineConfigurationError) {
          throw error;
        }
      }
      if (!controller.signal.aborted) {
        await sleep(reconnectMs, undefined, { signal: controller.signal }).catch(
          () => undefined
        );
      }
    }
  };

  try {
    await Promise.all([runStream("odds"), runStream("scores")]);
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
      baselineRecords: baselineCount,
      streamRecords: streamCount,
      scoreRecords,
      oddsRecords
    })}\n`,
    "utf8"
  );

  return {
    outputPath,
    matchLabel,
    baselineRecords: baselineCount,
    streamRecords: streamCount,
    scoreRecords,
    oddsRecords,
    startedAt,
    endedAt,
    stopReason
  };
}
