import { describe, expect, it } from "vitest";
import {
  SolanaJsonRpcClient,
  SolanaProvenanceError,
  validateSolanaProvenanceReceipt,
  verifySolanaProvenance,
  type SolanaProvenanceRpcClient
} from "../src/txline/solana-provenance.js";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAINNET_PROGRAM_ID = "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA";
const SUBSCRIBE_DISCRIMINATOR = [254, 28, 191, 138, 156, 179, 183, 53];

function encodeBase58(input: Uint8Array): string {
  if (input.length === 0) return "";
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index]! << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let index = 0; index < input.length - 1 && input[index] === 0; index += 1) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join("");
}

const WALLET = encodeBase58(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const TX_SIGNATURE = encodeBase58(
  Uint8Array.from({ length: 64 }, (_, index) => (index + 3) % 256)
);

function subscribeData(serviceLevelId = 1, weeks = 4): string {
  return encodeBase58(
    Uint8Array.from([
      ...SUBSCRIBE_DISCRIMINATOR,
      serviceLevelId & 0xff,
      (serviceLevelId >> 8) & 0xff,
      weeks
    ])
  );
}

function validRpcClient(overrides?: {
  walletSigner?: boolean;
  programId?: string;
  serviceLevelId?: number;
  weeks?: number;
}): SolanaProvenanceRpcClient {
  return {
    async getSignatureStatus() {
      return {
        value: [
          {
            err: null,
            confirmationStatus: "finalized"
          }
        ]
      };
    },
    async getTransaction() {
      return {
        meta: { err: null, innerInstructions: [] },
        transaction: {
          signatures: [TX_SIGNATURE],
          message: {
            accountKeys: [
              {
                pubkey: WALLET,
                signer: overrides?.walletSigner ?? true,
                writable: true,
                source: "transaction"
              },
              {
                pubkey: MAINNET_PROGRAM_ID,
                signer: false,
                writable: false,
                source: "transaction"
              }
            ],
            instructions: [
              {
                programId: overrides?.programId ?? MAINNET_PROGRAM_ID,
                accounts: [WALLET],
                data: subscribeData(
                  overrides?.serviceLevelId ?? 1,
                  overrides?.weeks ?? 4
                )
              }
            ]
          }
        }
      };
    }
  };
}

describe("TxLINE Solana provenance", () => {
  it("verifies the confirmed subscribe transaction without a private key", async () => {
    const result = await verifySolanaProvenance({
      network: "mainnet",
      walletPublicKey: WALLET,
      transactionSignature: TX_SIGNATURE,
      expectedServiceLevelId: 1,
      expectedDurationWeeks: 4,
      rpcClient: validRpcClient(),
      commitSha: "abc123",
      verifiedAt: Date.UTC(2026, 6, 17, 12, 0, 0)
    });

    expect(result.serviceLevelId).toBe(1);
    expect(result.durationWeeks).toBe(4);
    expect(result.confirmationStatus).toBe("finalized");
    expect(result.receipt).toContain("TXLINE SOLANA PROVENANCE: PASS");
    expect(result.receipt).toContain("API token linkage: NOT CLAIMED");
    expect(result.receipt).not.toContain(WALLET);
    expect(result.receipt).not.toContain(TX_SIGNATURE);
    expect(result.receipt).not.toContain(MAINNET_PROGRAM_ID);
  });

  it("rejects a transaction where the configured wallet is not a signer", async () => {
    await expect(
      verifySolanaProvenance({
        network: "mainnet",
        walletPublicKey: WALLET,
        transactionSignature: TX_SIGNATURE,
        rpcClient: validRpcClient({ walletSigner: false })
      })
    ).rejects.toMatchObject({ code: "WALLET_NOT_SIGNER" });
  });

  it("rejects a different program or service level", async () => {
    await expect(
      verifySolanaProvenance({
        network: "mainnet",
        walletPublicKey: WALLET,
        transactionSignature: TX_SIGNATURE,
        expectedServiceLevelId: 12,
        rpcClient: validRpcClient({ serviceLevelId: 1 })
      })
    ).rejects.toMatchObject({ code: "SERVICE_LEVEL_MISMATCH" });

    await expect(
      verifySolanaProvenance({
        network: "mainnet",
        walletPublicKey: WALLET,
        transactionSignature: TX_SIGNATURE,
        rpcClient: validRpcClient({ programId: WALLET })
      })
    ).rejects.toMatchObject({ code: "SUBSCRIBE_INSTRUCTION_NOT_FOUND" });
  });

  it("constructs the two public Solana RPC requests without leaking inputs", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const responses = [
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { value: [{ err: null, confirmationStatus: "confirmed" }] }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: { meta: { err: null } } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ];
    const client = new SolanaJsonRpcClient({
      rpcOrigin: "https://api.mainnet-beta.solana.com",
      requestTimeoutMs: 5_000,
      fetchFn: async (input, init) => {
        requests.push({
          url: input instanceof Request ? input.url : input.toString(),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        const response = responses.shift();
        if (response === undefined) throw new Error("Unexpected request");
        return response;
      }
    });

    await client.getSignatureStatus(TX_SIGNATURE);
    await client.getTransaction(TX_SIGNATURE);

    expect(requests.map((request) => request.body.method)).toEqual([
      "getSignatureStatuses",
      "getTransaction"
    ]);
    expect(requests[0]?.url).toBe("https://api.mainnet-beta.solana.com");
    expect(
      JSON.stringify(requests[1]?.body).includes("jsonParsed")
    ).toBe(true);
  });

  it("rejects provider-shaped or secret-shaped receipt content", () => {
    expect(() =>
      validateSolanaProvenanceReceipt(
        "TXLINE_WALLET_PUBKEY=abc\nhttps://rpc.example"
      )
    ).toThrowError(SolanaProvenanceError);
  });
});
