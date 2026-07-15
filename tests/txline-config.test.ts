import { describe, expect, it } from "vitest";
import {
  readTxlineConfig,
  resolveTxlineOrigin
} from "../src/txline/config.js";

describe("TxLINE configuration", () => {
  it("maps each network to its fixed official host", () => {
    expect(resolveTxlineOrigin("mainnet")).toBe(
      "https://txline.txodds.com"
    );
    expect(resolveTxlineOrigin("devnet")).toBe(
      "https://txline-dev.txodds.com"
    );

    const devnet = readTxlineConfig({
      TXLINE_MODE: "devnet",
      TXLINE_API_TOKEN: "placeholder",
      TXLINE_API_ORIGIN: "https://attacker.invalid"
    });
    expect(devnet.apiOrigin).toBe("https://txline-dev.txodds.com");
  });

  it("defaults to credential-free synthetic mode", () => {
    const config = readTxlineConfig({});

    expect(config.mode).toBe("synthetic");
    expect(config.apiOrigin).toBeUndefined();
    expect(config.apiToken).toBeUndefined();
    expect(config.configurationError).toBeUndefined();
  });

  it("reports missing credentials without exposing a token", () => {
    const config = readTxlineConfig({ TXLINE_MODE: "mainnet" });

    expect(config.mode).toBe("mainnet");
    expect(config.configurationError).toContain("TXLINE_API_TOKEN");
    expect(JSON.stringify(config)).not.toContain("Bearer");
  });
});
