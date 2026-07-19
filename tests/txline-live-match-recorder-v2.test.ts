import { describe, expect, it } from "vitest";
import { payloadTargetsFixture } from "../src/txline/live-match-recorder-v2.js";

describe("fixture-scoped TxLINE live recorder", () => {
  it("accepts only the configured fixture before normalization", () => {
    expect(
      payloadTargetsFixture(
        { FixtureId: "target", SuperOddsType: "1X2" },
        "target"
      )
    ).toBe(true);
    expect(
      payloadTargetsFixture(
        { FixtureId: "other", SuperOddsType: "1X2" },
        "target"
      )
    ).toBe(false);
  });

  it("does not let fixtureless or malformed data poison the target stream", () => {
    expect(payloadTargetsFixture({ SuperOddsType: "1X2" }, "target")).toBe(false);
    expect(payloadTargetsFixture("not-an-object", "target")).toBe(false);
  });

  it("allows provider disconnect control frames so the recorder can reconnect", () => {
    expect(payloadTargetsFixture({ action: "disconnected" }, "target")).toBe(true);
  });
});
