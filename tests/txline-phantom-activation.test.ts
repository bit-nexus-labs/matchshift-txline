import { describe, expect, it } from "vitest";
import {
  createActivationMessage,
  encodeSubscribeInstruction,
  SUBSCRIBE_DISCRIMINATOR,
  TXLINE_FREE_REALTIME_SERVICE_LEVEL_ID
} from "../src/txline/phantom-activation-protocol.js";

describe("TxLINE Phantom activation protocol", () => {
  it("encodes the official subscribe discriminator and u16/u8 arguments", () => {
    const encoded = encodeSubscribeInstruction(
      TXLINE_FREE_REALTIME_SERVICE_LEVEL_ID,
      4
    );

    expect(Array.from(encoded.slice(0, 8))).toEqual(
      Array.from(SUBSCRIBE_DISCRIMINATOR)
    );
    expect(Array.from(encoded.slice(8))).toEqual([12, 0, 4]);
  });

  it("builds the standard free-bundle activation message with two colons", () => {
    expect(createActivationMessage("tx-signature", "guest-jwt")).toBe(
      "tx-signature::guest-jwt"
    );
  });

  it("rejects invalid subscription arguments", () => {
    expect(() => encodeSubscribeInstruction(-1, 4)).toThrow();
    expect(() => encodeSubscribeInstruction(12, 0)).toThrow();
    expect(() => encodeSubscribeInstruction(0x1_0000, 4)).toThrow();
    expect(() => encodeSubscribeInstruction(12, 0x100)).toThrow();
  });
});
