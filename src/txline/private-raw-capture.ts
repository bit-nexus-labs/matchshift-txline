import path from "node:path";

export type RawCaptureParseKind = "empty" | "json" | "sse" | "text";

export interface RawCaptureSseFrame {
  event?: string;
  id?: string;
  retry?: string;
  dataText: string;
  dataJson?: unknown;
  dataJsonValid: boolean;
}

export interface RawCaptureBodyParse {
  kind: RawCaptureParseKind;
  parsedBody?: unknown;
  sseFrames?: RawCaptureSseFrame[];
  parseError?: string;
}

export interface PrivateRawCaptureResponse {
  label: string;
  method: "GET";
  path: string;
  accept: "application/json" | "text/event-stream";
  requestedAtUtc: string;
  attempts: number;
  status: number;
  ok: boolean;
  contentType?: string;
  contentLengthHeader?: string;
  byteLength: number;
  bodyText: string;
  parse: RawCaptureBodyParse;
}

const PRIVATE_CAPTURE_ROOT = path.resolve("artifacts/private");

function normalizeContentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function parseSse(text: string): RawCaptureBodyParse {
  const frames: RawCaptureSseFrame[] = [];

  for (const rawFrame of text.split(/\r?\n\r?\n/)) {
    if (rawFrame.trim() === "") {
      continue;
    }

    let event: string | undefined;
    let id: string | undefined;
    let retry: string | undefined;
    const dataLines: string[] = [];

    for (const line of rawFrame.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trimStart();
      } else if (line.startsWith("id:")) {
        id = line.slice(3).trimStart();
      } else if (line.startsWith("retry:")) {
        retry = line.slice(6).trimStart();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const dataText = dataLines.join("\n");
    let dataJson: unknown;
    let dataJsonValid = false;
    if (dataText !== "" && dataText !== "[DONE]") {
      try {
        dataJson = JSON.parse(dataText) as unknown;
        dataJsonValid = true;
      } catch {
        dataJsonValid = false;
      }
    }

    frames.push({
      ...(event === undefined ? {} : { event }),
      ...(id === undefined ? {} : { id }),
      ...(retry === undefined ? {} : { retry }),
      dataText,
      ...(dataJsonValid ? { dataJson } : {}),
      dataJsonValid
    });
  }

  return {
    kind: "sse",
    sseFrames: frames,
    parsedBody: frames
      .filter((frame) => frame.dataJsonValid)
      .map((frame) => frame.dataJson),
    ...(frames.some((frame) => !frame.dataJsonValid && frame.dataText !== "[DONE]")
      ? { parseError: "ONE_OR_MORE_SSE_DATA_FRAMES_WERE_NOT_JSON" }
      : {})
  };
}

export function parsePrivateRawCaptureBody(
  text: string,
  contentType?: string
): RawCaptureBodyParse {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (normalized.length === 0) {
    return { kind: "empty" };
  }

  if (normalizeContentType(contentType) === "text/event-stream") {
    return parseSse(normalized);
  }

  try {
    return {
      kind: "json",
      parsedBody: JSON.parse(normalized) as unknown
    };
  } catch {
    return {
      kind: "text",
      parseError:
        normalizeContentType(contentType) === "application/json"
          ? "RESPONSE_DECLARED_JSON_BUT_BODY_WAS_NOT_JSON"
          : "BODY_RETAINED_AS_TEXT"
    };
  }
}

export function assertPrivateCaptureOutputPath(value: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(PRIVATE_CAPTURE_ROOT, resolved);
  const insidePrivateRoot =
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative);

  if (!insidePrivateRoot || path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error(
      "Private capture output must be a .json file inside artifacts/private/."
    );
  }

  return resolved;
}

export function defaultPrivateCapturePath(timestamp = new Date()): string {
  const stamp = timestamp
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `artifacts/private/txline-full-provider-capture-${stamp}.json`;
}
