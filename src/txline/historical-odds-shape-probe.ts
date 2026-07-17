import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import {
  TxlineConfigurationError,
  TxlineHttpError
} from "./http-client.js";
import {
  formatHistoricalShapeReport,
  summarizeHistoricalPayloadShape,
  type HistoricalShapeReport
} from "./historical-shape-probe.js";
import { parseSourceTimestamp } from "./normalizer.js";
import { parseTxlineReplayResponse } from "./replay-http-source.js";

const MAX_TIMESTAMP_SCAN_NODES = 250_000;

export interface HistoricalOddsShapeProbeOptions {
  apiOrigin: string;
  apiToken: string;
  fixtureId: string | number;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

export interface HistoricalOddsShapeProbeReport {
  snapshots: readonly {
    label: "early" | "late";
    report: HistoricalShapeReport;
  }[];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function parseNestedJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    trimmed.length < 2 ||
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function collectReplayTimestamps(payload: unknown): number[] {
  const timestamps = new Set<number>();
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  const visit = (value: unknown): void => {
    visitedNodes += 1;
    if (visitedNodes > MAX_TIMESTAMP_SCAN_NODES) {
      return;
    }

    if (typeof value === "string") {
      const nested = parseNestedJson(value);
      if (nested !== undefined) {
        visit(nested);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = asRecord(value);
    if (record === undefined || seen.has(record)) {
      return;
    }
    seen.add(record);

    const timestamp = parseSourceTimestamp(record.ts ?? record.Ts);
    if (timestamp !== undefined) {
      timestamps.add(timestamp);
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(payload);
  return [...timestamps].sort((left, right) => left - right);
}

async function requestReplayPayload(input: {
  credentials: TxlineCredentials;
  fetchFn: FetchLike;
  apiOrigin: string;
  path: string;
  requestTimeoutMs: number;
}): Promise<{
  payload: unknown;
  status: number;
  contentType: string | null;
  byteLength: number;
}> {
  const signal = AbortSignal.timeout(input.requestTimeoutMs);

  const requestOnce = async (refreshGuestJwt: boolean): Promise<Response> => {
    const headers = await input.credentials.buildDataHeaders(
      "application/json",
      refreshGuestJwt,
      signal
    );
    return input.fetchFn(new URL(input.path, input.apiOrigin), {
      method: "GET",
      headers,
      signal
    });
  };

  try {
    let response = await requestOnce(false);
    if (response.status === 401) {
      await response.body?.cancel();
      response = await requestOnce(true);
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new TxlineConfigurationError();
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      throw new TxlineHttpError(
        "HTTP_ERROR",
        `TxLINE request failed with status ${status}.`,
        status
      );
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type");
    const payload = parseTxlineReplayResponse(text, {
      status: response.status,
      ...(contentType === null ? {} : { contentType })
    });
    return {
      payload,
      status: response.status,
      contentType,
      byteLength: Buffer.byteLength(text, "utf8")
    };
  } catch (error) {
    if (error instanceof TxlineHttpError || error instanceof TxlineCredentialError) {
      throw error;
    }
    if (signal.aborted) {
      throw new TxlineHttpError("TIMEOUT", "TxLINE odds shape probe timed out.");
    }
    throw new TxlineHttpError(
      "NETWORK_ERROR",
      "TxLINE odds shape probe network request failed."
    );
  }
}

export async function probeHistoricalOddsShape(
  options: HistoricalOddsShapeProbeOptions
): Promise<HistoricalOddsShapeProbeReport> {
  const fetchFn = options.fetchFn ?? fetch;
  const credentials = new TxlineCredentials({
    apiOrigin: options.apiOrigin,
    apiToken: options.apiToken,
    fetchFn
  });

  const scores = await requestReplayPayload({
    credentials,
    fetchFn,
    apiOrigin: options.apiOrigin,
    path: `/api/scores/historical/${encodeURIComponent(String(options.fixtureId))}`,
    requestTimeoutMs: options.requestTimeoutMs
  });
  const timestamps = collectReplayTimestamps(scores.payload);
  const early = timestamps[0];
  const late = timestamps.at(-1);
  if (early === undefined || late === undefined) {
    throw new TxlineHttpError(
      "HISTORICAL_TIMESTAMPS_MISSING",
      "TxLINE historical score replay did not expose timestamps for the odds shape probe."
    );
  }

  const requests: Array<{ label: "early" | "late"; asOf: number }> = [
    { label: "early", asOf: early }
  ];
  if (late !== early) {
    requests.push({ label: "late", asOf: late });
  }

  const snapshots = [] as Array<{
    label: "early" | "late";
    report: HistoricalShapeReport;
  }>;
  for (const request of requests) {
    const query = new URLSearchParams({ asOf: String(request.asOf) });
    const response = await requestReplayPayload({
      credentials,
      fetchFn,
      apiOrigin: options.apiOrigin,
      path: `/api/odds/snapshot/${encodeURIComponent(String(options.fixtureId))}?${query.toString()}`,
      requestTimeoutMs: options.requestTimeoutMs
    });
    snapshots.push({
      label: request.label,
      report: summarizeHistoricalPayloadShape(response.payload, {
        status: response.status,
        contentType: response.contentType,
        byteLength: response.byteLength
      })
    });
  }

  return { snapshots };
}

export function formatHistoricalOddsShapeReport(
  report: HistoricalOddsShapeProbeReport
): string {
  const lines = [
    "TXLINE HISTORICAL ODDS SHAPE: PASS",
    `snapshots=${report.snapshots.length}`,
    "Schema paths only; no provider values, teams, prices, probabilities, tokens, or raw payloads:"
  ];

  for (const snapshot of report.snapshots) {
    const formatted = formatHistoricalShapeReport(snapshot.report)
      .trimEnd()
      .split("\n")
      .slice(1);
    lines.push(`[${snapshot.label}]`);
    lines.push(...formatted.map((line) => `[${snapshot.label}] ${line}`));
  }

  return `${lines.join("\n")}\n`;
}
