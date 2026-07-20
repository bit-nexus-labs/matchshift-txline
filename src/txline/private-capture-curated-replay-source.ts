import { readFile } from "node:fs/promises";
import type { TxlineNetwork } from "./config.js";
import type { CuratedReplayExportClient } from "./curated-replay-exporter.js";
import {
  assertCompleteScoreBaseline,
  mergeDirectScoreRecords
} from "./curated-replay-source.js";
import { TxlineHttpError } from "./http-client.js";
import {
  normalizeFixtures,
  parseSourceTimestamp,
  type NormalizedFixture
} from "./normalizer.js";
import { assertPrivateCaptureOutputPath } from "./private-raw-capture.js";
import { extractTxlineReplayRecords } from "./replay-http-source.js";
import { recoverOpeningScorePrefixFromGoalActions } from "./score-opening-prefix-recovery.js";
import { assertCompleteScoreProgression } from "./score-snapshot-recovery.js";

const MAX_PRIVATE_CAPTURE_BYTES = 128 * 1024 * 1024;
const PRIVATE_CAPTURE_WARNING = "PRIVATE_PROVIDER_DATA_DO_NOT_PUBLISH_OR_COMMIT";

type UnknownRecord = Record<string, unknown>;

interface PrivateCaptureTarget {
  fixtureId: string;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  startUtc: string;
}

interface PrivateCaptureEntry {
  label: string;
  ok: boolean;
  status: number;
  parse: {
    parsedBody?: unknown;
    parseError?: string;
  };
}

export interface PrivateCaptureCuratedReplaySourceOptions {
  inputPath: string;
  expectedNetwork?: TxlineNetwork;
}

export interface PrivateCaptureCuratedReplayDocument {
  warning: typeof PRIVATE_CAPTURE_WARNING;
  formatVersion: 1;
  network: TxlineNetwork;
  target: PrivateCaptureTarget;
  entries: unknown[];
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function invalidCapture(message: string): TxlineHttpError {
  return new TxlineHttpError("PRIVATE_CAPTURE_INVALID", message);
}

function parseTarget(value: unknown): PrivateCaptureTarget {
  const target = asRecord(value);
  const fixtureId = readNonEmptyString(target?.fixtureId);
  const participant1 = readNonEmptyString(target?.participant1);
  const participant2 = readNonEmptyString(target?.participant2);
  const startUtc = readNonEmptyString(target?.startUtc);
  const participant1IsHome = target?.participant1IsHome;
  if (
    fixtureId === undefined ||
    participant1 === undefined ||
    participant2 === undefined ||
    startUtc === undefined ||
    parseSourceTimestamp(startUtc) === undefined ||
    typeof participant1IsHome !== "boolean"
  ) {
    throw invalidCapture("Private capture target metadata was incomplete.");
  }
  return {
    fixtureId,
    participant1,
    participant2,
    participant1IsHome,
    startUtc
  };
}

function parseEntry(value: unknown): PrivateCaptureEntry | undefined {
  const entry = asRecord(value);
  const parse = asRecord(entry?.parse);
  const label = readNonEmptyString(entry?.label);
  const status = entry?.status;
  if (
    label === undefined ||
    entry?.ok !== true ||
    typeof status !== "number" ||
    !Number.isSafeInteger(status) ||
    status < 200 ||
    status >= 300 ||
    parse === undefined ||
    !("parsedBody" in parse)
  ) {
    return undefined;
  }
  const parseError = readNonEmptyString(parse.parseError);
  return {
    label,
    ok: true,
    status,
    parse: {
      parsedBody: parse.parsedBody,
      ...(parseError === undefined ? {} : { parseError })
    }
  };
}

export function validatePrivateCaptureCuratedReplayDocument(
  value: unknown,
  expectedNetwork?: TxlineNetwork
): PrivateCaptureCuratedReplayDocument {
  const document = asRecord(value);
  const network = document?.network;
  if (
    document?.warning !== PRIVATE_CAPTURE_WARNING ||
    document.formatVersion !== 1 ||
    (network !== "mainnet" && network !== "devnet") ||
    !Array.isArray(document.entries)
  ) {
    throw invalidCapture("Private capture document header was invalid.");
  }
  if (expectedNetwork !== undefined && network !== expectedNetwork) {
    throw invalidCapture("Private capture network did not match TXLINE_NETWORK.");
  }
  return {
    warning: PRIVATE_CAPTURE_WARNING,
    formatVersion: 1,
    network,
    target: parseTarget(document.target),
    entries: document.entries
  };
}

function syntheticFixturePayload(target: PrivateCaptureTarget): unknown[] {
  return [
    {
      FixtureId: target.fixtureId,
      StartTime: target.startUtc,
      Participant1: target.participant1,
      Participant2: target.participant2,
      Participant1IsHome: target.participant1IsHome,
      GameState: 5
    }
  ];
}

function targetFixture(target: PrivateCaptureTarget): NormalizedFixture {
  const fixture = normalizeFixtures(syntheticFixturePayload(target))[0];
  if (fixture === undefined) {
    throw invalidCapture("Private capture target could not be normalized.");
  }
  return fixture;
}

function relevantPayloads(
  entries: readonly unknown[],
  prefixes: readonly string[]
): unknown[] {
  const payloads: unknown[] = [];
  for (const value of entries) {
    const entry = parseEntry(value);
    if (
      entry === undefined ||
      !prefixes.some((prefix) => entry.label.startsWith(prefix))
    ) {
      continue;
    }
    if (entry.parse.parseError !== undefined) {
      throw invalidCapture("A required private capture response failed JSON decoding.");
    }
    payloads.push(entry.parse.parsedBody);
  }
  return payloads;
}

function scoreRecords(
  document: PrivateCaptureCuratedReplayDocument,
  fixture: NormalizedFixture
): unknown[] {
  const payloads = relevantPayloads(document.entries, [
    "scores-full-historical",
    "scores-bucket-"
  ]);
  const direct = mergeDirectScoreRecords(
    payloads.flatMap((payload) => extractTxlineReplayRecords(payload, "scores"))
  );
  if (direct.length === 0) {
    throw invalidCapture("Private capture contained no direct historical score records.");
  }
  const recovered = recoverOpeningScorePrefixFromGoalActions(direct, fixture);
  assertCompleteScoreBaseline(recovered, fixture);
  assertCompleteScoreProgression(recovered, fixture);
  return recovered;
}

interface OddsGroup {
  timestamp: number;
  records: unknown[];
}

function oddsGroups(
  document: PrivateCaptureCuratedReplayDocument,
  fixtureId: string
): OddsGroup[] {
  const payloads = relevantPayloads(document.entries, ["odds-"]);
  const unique = new Map<string, unknown>();
  for (const payload of payloads) {
    for (const record of extractTxlineReplayRecords(payload, "odds", {
      fixtureId
    })) {
      unique.set(JSON.stringify(record), record);
    }
  }

  const grouped = new Map<number, unknown[]>();
  for (const value of unique.values()) {
    const record = asRecord(value);
    const timestamp = parseSourceTimestamp(record?.Ts ?? record?.ts);
    if (timestamp === undefined) {
      continue;
    }
    const group = grouped.get(timestamp) ?? [];
    group.push(value);
    grouped.set(timestamp, group);
  }
  return [...grouped.entries()]
    .map(([timestamp, records]) => ({ timestamp, records }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function nearestOddsGroup(groups: readonly OddsGroup[], asOf: number): unknown[] {
  if (groups.length === 0) {
    return [];
  }
  let selected = groups[0]!;
  for (const group of groups) {
    if (group.timestamp > asOf) {
      break;
    }
    selected = group;
  }
  return selected.records;
}

export function createPrivateCaptureCuratedReplaySourceFromDocument(
  value: unknown,
  expectedNetwork?: TxlineNetwork
): CuratedReplayExportClient {
  const document = validatePrivateCaptureCuratedReplayDocument(
    value,
    expectedNetwork
  );
  const fixturePayload = syntheticFixturePayload(document.target);
  const fixture = targetFixture(document.target);
  const fixtureId = String(fixture.fixtureId);
  const recoveredScores = scoreRecords(document, fixture);
  const capturedOdds = oddsGroups(document, fixtureId);

  const assertFixture = (requested: string | number): void => {
    if (String(requested) !== fixtureId) {
      throw invalidCapture("Requested fixture did not match the private capture target.");
    }
  };

  return {
    fetchFixturesSnapshot: async () => fixturePayload,
    fetchFixturesSnapshotForDay: async () => fixturePayload,
    fetchScoresHistorical: async (requestedFixtureId) => {
      assertFixture(requestedFixtureId);
      return recoveredScores;
    },
    fetchOddsSnapshotAt: async (requestedFixtureId, asOf) => {
      assertFixture(requestedFixtureId);
      return nearestOddsGroup(capturedOdds, asOf);
    }
  };
}

export async function createPrivateCaptureCuratedReplaySource(
  options: PrivateCaptureCuratedReplaySourceOptions
): Promise<CuratedReplayExportClient> {
  const inputPath = assertPrivateCaptureOutputPath(options.inputPath);
  const text = await readFile(inputPath, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_PRIVATE_CAPTURE_BYTES) {
    throw invalidCapture("Private capture file exceeded the local safety limit.");
  }
  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch {
    throw invalidCapture("Private capture file was not valid JSON.");
  }
  return createPrivateCaptureCuratedReplaySourceFromDocument(
    document,
    options.expectedNetwork
  );
}
