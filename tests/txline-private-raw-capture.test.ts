import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPrivateCaptureOutputPath,
  defaultPrivateCapturePath,
  parsePrivateRawCaptureBody
} from "../src/txline/private-raw-capture.js";

describe("private raw TxLINE capture helpers", () => {
  it("keeps output inside the ignored private artifact directory", () => {
    const resolved = assertPrivateCaptureOutputPath(
      "artifacts/private/provider-capture.json"
    );
    expect(resolved).toBe(
      path.resolve("artifacts/private/provider-capture.json")
    );
    expect(() =>
      assertPrivateCaptureOutputPath("artifacts/public/provider-capture.json")
    ).toThrow(/artifacts\/private/);
    expect(() =>
      assertPrivateCaptureOutputPath("artifacts/private/provider-capture.txt")
    ).toThrow(/\.json/);
  });

  it("creates a unique timestamped private filename", () => {
    expect(
      defaultPrivateCapturePath(new Date("2026-07-20T07:30:45.123Z"))
    ).toBe(
      "artifacts/private/txline-full-provider-capture-20260720T073045Z.json"
    );
  });

  it("retains complete JSON bodies as parsed data", () => {
    const body = JSON.stringify({
      Action: "goal",
      Score: { Participant1: { Total: { Goals: 1 } } }
    });
    expect(parsePrivateRawCaptureBody(body, "application/json")).toEqual({
      kind: "json",
      parsedBody: {
        Action: "goal",
        Score: { Participant1: { Total: { Goals: 1 } } }
      }
    });
  });

  it("retains SSE ids, events, raw data text, and parsed JSON", () => {
    const body = [
      "id: provider-event-private",
      "event: score",
      'data: {"Action":"goal","Data":{"Minutes":106}}',
      "",
      "id: provider-event-second",
      "data: not-json",
      ""
    ].join("\n");

    const parsed = parsePrivateRawCaptureBody(body, "text/event-stream");
    expect(parsed.kind).toBe("sse");
    expect(parsed.sseFrames).toEqual([
      {
        id: "provider-event-private",
        event: "score",
        dataText: '{"Action":"goal","Data":{"Minutes":106}}',
        dataJson: { Action: "goal", Data: { Minutes: 106 } },
        dataJsonValid: true
      },
      {
        id: "provider-event-second",
        dataText: "not-json",
        dataJsonValid: false
      }
    ]);
    expect(parsed.parseError).toBe(
      "ONE_OR_MORE_SSE_DATA_FRAMES_WERE_NOT_JSON"
    );
  });

  it("classifies empty and non-JSON text without dropping the body", () => {
    expect(parsePrivateRawCaptureBody("", "text/event-stream")).toEqual({
      kind: "empty"
    });
    expect(parsePrivateRawCaptureBody("plain provider text", "text/plain")).toEqual({
      kind: "text",
      parseError: "BODY_RETAINED_AS_TEXT"
    });
  });
});
