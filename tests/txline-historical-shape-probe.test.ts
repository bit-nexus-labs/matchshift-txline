import { describe, expect, it } from "vitest";
import {
  formatHistoricalShapeReport,
  summarizeHistoricalPayloadShape
} from "../src/txline/historical-shape-probe.js";

describe("TxLINE historical shape probe", () => {
  it("reports nested schema paths without provider values", () => {
    const payload = [
      {
        envelope: {
          data: JSON.stringify({
            eventPayload: {
              fixtureReference: "private-fixture-value",
              participantName: "private-team-name",
              nestedScore: { home: 7, away: 4 }
            }
          })
        }
      }
    ];
    const report = summarizeHistoricalPayloadShape(payload, {
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      byteLength: 1234
    });
    const formatted = formatHistoricalShapeReport(report);

    expect(formatted).toContain("$.[]".replace(".", ""));
    expect(formatted).toContain("eventPayload");
    expect(formatted).toContain("nestedScore");
    expect(formatted).toContain("string(json-object)");
    expect(formatted).not.toContain("private-fixture-value");
    expect(formatted).not.toContain("private-team-name");
  });

  it("redacts sensitive field names and never prints their values", () => {
    const payload = {
      apiToken: "token-value-must-not-appear",
      Authorization: "bearer-value-must-not-appear",
      normalWrapper: { payloadType: "score-update" }
    };
    const formatted = formatHistoricalShapeReport(
      summarizeHistoricalPayloadShape(payload, {
        status: 200,
        contentType: "application/json",
        byteLength: 100
      })
    );

    expect(formatted).toContain("<sensitive-key>");
    expect(formatted).toContain("normalWrapper");
    expect(formatted).not.toContain("apiToken");
    expect(formatted).not.toContain("Authorization");
    expect(formatted).not.toContain("token-value-must-not-appear");
    expect(formatted).not.toContain("bearer-value-must-not-appear");
    expect(formatted).not.toContain("score-update");
  });

  it("collapses arrays to schema paths rather than indexes", () => {
    const formatted = formatHistoricalShapeReport(
      summarizeHistoricalPayloadShape(
        [{ wrapper: { value: 1 } }, { wrapper: { value: 2 } }],
        {
          status: 200,
          contentType: "application/json",
          byteLength: 80
        }
      )
    );

    expect(formatted).toContain("$[] | types=object | count=2");
    expect(formatted).toContain("$[].wrapper.value | types=number | count=2");
    expect(formatted).not.toContain("$[0]");
    expect(formatted).not.toContain("$[1]");
  });
});
