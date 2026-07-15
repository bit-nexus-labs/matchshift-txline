import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../src/txline/redaction.js";

describe("TxLINE redaction", () => {
  it("removes JWT, API token, and authorization values", () => {
    const apiToken = "api-token-secret";
    const jwt = "eyJheader.eyJpayload.signature";
    const redacted = redactSensitiveText(
      `Authorization: Bearer ${jwt}; X-Api-Token: ${apiToken}`,
      [apiToken, jwt]
    );

    expect(redacted).not.toContain(apiToken);
    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain("[REDACTED]");
  });
});
