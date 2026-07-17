import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderPhantomActivationBrowserScript,
  renderPhantomActivationHtml
} from "../src/txline/phantom-activation-helper.js";

describe("TxLINE Phantom activation helper runtime", () => {
  it("serves an external browser module instead of a nested inline script", () => {
    const html = renderPhantomActivationHtml();

    expect(html).toContain('<script type="module" src="/app.js"></script>');
    expect(html).not.toContain("<script type=\"module\">\n");
  });

  it("keeps Solana RPC behind the localhost proxy and creates the required ATA", () => {
    const script = renderPhantomActivationBrowserScript("csrf-test-value");

    expect(script).toContain('location.origin + "/api/rpc"');
    expect(script).not.toContain("api.mainnet-beta.solana.com");
    expect(script).toContain("createAtaInstruction");
    expect(script).toContain("Token-2022 account creation");
    expect(script).toContain("TxLINE service-level 12 subscription");
    expect(script).toContain('"\\nBalance: "');
  });

  it("emits syntactically valid browser JavaScript", () => {
    const directory = mkdtempSync(join(tmpdir(), "matchshift-phantom-"));
    const path = join(directory, "app.mjs");
    try {
      writeFileSync(
        path,
        renderPhantomActivationBrowserScript("csrf-test-value"),
        "utf8"
      );
      const result = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8"
      });

      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
