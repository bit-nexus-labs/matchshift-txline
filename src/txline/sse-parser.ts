export interface SseMessageFrame {
  kind: "message";
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export interface SseHeartbeatFrame {
  kind: "heartbeat";
  comments: string[];
}

export type SseFrame = SseMessageFrame | SseHeartbeatFrame;

export function parseSseBlock(block: string): SseFrame | null {
  const dataLines: string[] = [];
  const comments: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  let recognizedField = false;

  for (const rawLine of block.split(/\r\n|\n|\r/)) {
    if (rawLine === "") {
      continue;
    }
    if (rawLine.startsWith(":")) {
      comments.push(rawLine.slice(1).replace(/^ /, ""));
      continue;
    }

    const separatorIndex = rawLine.indexOf(":");
    const field =
      separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value =
      separatorIndex === -1
        ? ""
        : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (field === "data") {
      dataLines.push(value);
      recognizedField = true;
    } else if (field === "event") {
      event = value;
      recognizedField = true;
    } else if (field === "id" && !value.includes("\0")) {
      id = value;
      recognizedField = true;
    } else if (field === "retry" && /^\d+$/.test(value)) {
      retry = Number(value);
      recognizedField = true;
    }
  }

  if (!recognizedField) {
    return comments.length === 0 ? null : { kind: "heartbeat", comments };
  }

  return {
    kind: "message",
    data: dataLines.join("\n"),
    ...(event === undefined ? {} : { event }),
    ...(id === undefined ? {} : { id }),
    ...(retry === undefined ? {} : { retry })
  };
}

function findSeparator(buffer: string): {
  index: number;
  length: number;
} | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match?.index === undefined
    ? null
    : { index: match.index, length: match[0].length };
}

export async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abortReader = (): void => {
    void reader.cancel(signal?.reason);
  };
  signal?.addEventListener("abort", abortReader, { once: true });

  try {
    while (true) {
      if (signal?.aborted === true) {
        return;
      }
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separator = findSeparator(buffer);
      while (separator !== null) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const frame = parseSseBlock(block);
        if (frame !== null) {
          yield frame;
        }
        separator = findSeparator(buffer);
      }
    }

    buffer += decoder.decode();
    const trailingFrame = parseSseBlock(buffer);
    if (trailingFrame !== null) {
      yield trailingFrame;
    }
  } finally {
    signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
}
