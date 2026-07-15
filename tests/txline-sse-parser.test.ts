import { describe, expect, it } from "vitest";
import {
  parseSseBlock,
  readSseFrames,
  type SseFrame
} from "../src/txline/sse-parser.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

describe("TxLINE SSE parser", () => {
  it("handles fragmented chunks, CRLF/LF, heartbeats, ids, retry, and data lines", async () => {
    const stream = streamFromChunks([
      ": keep",
      "alive\r\n\r",
      "\nid: event-7\r\nevent: score\r\n",
      "data: first\r\ndata: second\r\nretry: 2500\r\n\r\n",
      "data: final\n\n"
    ]);
    const frames: SseFrame[] = [];

    for await (const frame of readSseFrames(stream)) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      { kind: "heartbeat", comments: ["keepalive"] },
      {
        kind: "message",
        id: "event-7",
        event: "score",
        data: "first\nsecond",
        retry: 2500
      },
      { kind: "message", data: "final" }
    ]);
  });

  it("ignores invalid retry fields and unknown fields", () => {
    expect(parseSseBlock("retry: later\nunknown: value")).toBeNull();
  });

  it("aborts a pending stream cleanly", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      }
    });
    const reading = (async () => {
      for await (const _frame of readSseFrames(stream, controller.signal)) {
        // No frames are expected.
      }
    })();

    controller.abort();
    await reading;

    expect(cancelled).toBe(true);
  });
});
