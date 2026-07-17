import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import {
  TxlineConfigurationError,
  TxlineHttpError
} from "./http-client.js";
import { parseTxlineReplayResponse } from "./replay-http-source.js";

const MAX_SHAPE_DEPTH = 12;
const MAX_SHAPE_NODES = 200_000;
const MAX_SHAPE_PATHS = 220;
const SENSITIVE_KEY_PATTERN =
  /(authorization|api[-_]?token|jwt|secret|private|signature|wallet|pubkey|address)/i;

interface ShapeAccumulator {
  count: number;
  types: Set<string>;
}

export interface HistoricalShapePath {
  path: string;
  count: number;
  types: readonly string[];
}

export interface HistoricalShapeReport {
  status: number;
  contentType: string;
  byteLength: number;
  visitedNodes: number;
  truncated: boolean;
  paths: readonly HistoricalShapePath[];
}

export interface HistoricalShapeProbeOptions {
  apiOrigin: string;
  apiToken: string;
  fixtureId: string | number;
  requestTimeoutMs: number;
  fetchFn?: FetchLike;
}

type UnknownRecord = Record<string, unknown>;

function normalizedContentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || "missing";
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function safeKey(key: string): string {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "<sensitive-key>";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/.test(key)) {
    return "<dynamic-key>";
  }
  return key;
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

function primitiveType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return typeof value;
}

export function summarizeHistoricalPayloadShape(
  payload: unknown,
  metadata: {
    status: number;
    contentType: string | null;
    byteLength: number;
  }
): HistoricalShapeReport {
  const paths = new Map<string, ShapeAccumulator>();
  let visitedNodes = 0;
  let truncated = false;

  const add = (path: string, type: string): void => {
    const existing = paths.get(path);
    if (existing !== undefined) {
      existing.count += 1;
      existing.types.add(type);
      return;
    }
    if (paths.size >= MAX_SHAPE_PATHS) {
      truncated = true;
      return;
    }
    paths.set(path, { count: 1, types: new Set([type]) });
  };

  const visit = (value: unknown, path: string, depth: number): void => {
    visitedNodes += 1;
    if (visitedNodes > MAX_SHAPE_NODES || depth > MAX_SHAPE_DEPTH) {
      truncated = true;
      return;
    }

    if (Array.isArray(value)) {
      add(path, "array");
      for (const item of value) {
        visit(item, `${path}[]`, depth + 1);
      }
      return;
    }

    const record = asRecord(value);
    if (record !== undefined) {
      add(path, "object");
      for (const [key, child] of Object.entries(record).sort(([left], [right]) =>
        left.localeCompare(right)
      )) {
        visit(child, `${path}.${safeKey(key)}`, depth + 1);
      }
      return;
    }

    if (typeof value === "string") {
      const nested = parseNestedJson(value);
      if (nested === undefined) {
        add(path, "string");
      } else {
        add(path, Array.isArray(nested) ? "string(json-array)" : "string(json-object)");
        visit(nested, `${path}<json>`, depth + 1);
      }
      return;
    }

    add(path, primitiveType(value));
  };

  visit(payload, "$", 0);

  return {
    status: metadata.status,
    contentType: normalizedContentType(metadata.contentType),
    byteLength: metadata.byteLength,
    visitedNodes,
    truncated,
    paths: [...paths.entries()]
      .map(([path, value]) => ({
        path,
        count: value.count,
        types: [...value.types].sort()
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function formatHistoricalShapeReport(
  report: HistoricalShapeReport
): string {
  const lines = [
    "TXLINE HISTORICAL SHAPE: PASS",
    `status=${report.status} content-type=${report.contentType} bytes=${report.byteLength}`,
    `visited-nodes=${report.visitedNodes} paths=${report.paths.length} truncated=${report.truncated}`,
    "Schema paths (names and types only; no provider values):"
  ];
  for (const item of report.paths) {
    lines.push(
      `${item.path} | types=${item.types.join(",")} | count=${item.count}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function probeHistoricalScoresShape(
  options: HistoricalShapeProbeOptions
): Promise<HistoricalShapeReport> {
  const credentials = new TxlineCredentials({
    apiOrigin: options.apiOrigin,
    apiToken: options.apiToken,
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn })
  });
  const fetchFn = options.fetchFn ?? fetch;
  const signal = AbortSignal.timeout(options.requestTimeoutMs);
  const path = `/api/scores/historical/${encodeURIComponent(String(options.fixtureId))}`;

  const requestOnce = async (refreshGuestJwt: boolean): Promise<Response> => {
    const headers = await credentials.buildDataHeaders(
      "application/json",
      refreshGuestJwt,
      signal
    );
    return fetchFn(new URL(path, options.apiOrigin), {
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
    return summarizeHistoricalPayloadShape(payload, {
      status: response.status,
      contentType,
      byteLength: Buffer.byteLength(text, "utf8")
    });
  } catch (error) {
    if (error instanceof TxlineHttpError || error instanceof TxlineCredentialError) {
      throw error;
    }
    if (signal.aborted) {
      throw new TxlineHttpError("TIMEOUT", "TxLINE shape probe timed out.");
    }
    throw new TxlineHttpError(
      "NETWORK_ERROR",
      "TxLINE shape probe network request failed."
    );
  }
}
