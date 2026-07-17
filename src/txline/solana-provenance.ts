import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TxlineNetwork } from "./config.js";
import { sanitizedErrorMessage } from "./redaction.js";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SUBSCRIBE_DISCRIMINATOR = Uint8Array.from([
  254, 28, 191, 138, 156, 179, 183, 53
]);

const SOLANA_NETWORKS = {
  mainnet: {
    rpcOrigin: "https://api.mainnet-beta.solana.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"
  },
  devnet: {
    rpcOrigin: "https://api.devnet.solana.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
  }
} as const;

export interface SolanaProvenanceOptions {
  network: TxlineNetwork;
  walletPublicKey: string;
  transactionSignature: string;
  expectedServiceLevelId?: number;
  expectedDurationWeeks?: number;
  requestTimeoutMs?: number;
  rpcClient: SolanaProvenanceRpcClient;
  commitSha?: string;
  verifiedAt?: number;
}

export interface SolanaProvenanceResult {
  receipt: string;
  serviceLevelId: number;
  durationWeeks: number;
  confirmationStatus: "confirmed" | "finalized";
}

export interface SolanaProvenanceRpcClient {
  getSignatureStatus(signature: string): Promise<unknown>;
  getTransaction(signature: string): Promise<unknown>;
}

export class SolanaProvenanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SolanaProvenanceError";
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readInteger(
  value: string | undefined,
  name: string,
  required = false
): number | undefined {
  if (value === undefined || value.trim() === "") {
    if (required) {
      throw new SolanaProvenanceError(
        "INVALID_CONFIGURATION",
        `${name} is required.`
      );
    }
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SolanaProvenanceError(
      "INVALID_CONFIGURATION",
      `${name} must be a non-negative safe integer.`
    );
  }
  return parsed;
}

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new SolanaProvenanceError(
    "INVALID_CONFIGURATION",
    "TXLINE_NETWORK must be mainnet or devnet."
  );
}

export function decodeBase58(value: string): Uint8Array {
  if (value === "") {
    return new Uint8Array();
  }
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) {
      throw new SolanaProvenanceError(
        "INVALID_BASE58",
        "A Solana public value was not valid base58."
      );
    }
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index]! * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; index < value.length - 1 && value[index] === "1"; index += 1) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validatePublicInputs(walletPublicKey: string, signature: string): void {
  if (decodeBase58(walletPublicKey).length !== 32) {
    throw new SolanaProvenanceError(
      "INVALID_WALLET_PUBLIC_KEY",
      "The configured wallet public key did not decode to 32 bytes."
    );
  }
  if (decodeBase58(signature).length !== 64) {
    throw new SolanaProvenanceError(
      "INVALID_TRANSACTION_SIGNATURE",
      "The configured transaction signature did not decode to 64 bytes."
    );
  }
}

function extractRpcResult(payload: unknown): unknown {
  const envelope = asRecord(payload);
  if (envelope === undefined) {
    throw new SolanaProvenanceError(
      "INVALID_RPC_RESPONSE",
      "Solana RPC returned an invalid response envelope."
    );
  }
  if (envelope.error !== undefined && envelope.error !== null) {
    throw new SolanaProvenanceError(
      "RPC_ERROR",
      "Solana RPC rejected the provenance request."
    );
  }
  if (!("result" in envelope)) {
    throw new SolanaProvenanceError(
      "INVALID_RPC_RESPONSE",
      "Solana RPC response had no result field."
    );
  }
  return envelope.result;
}

export class SolanaJsonRpcClient implements SolanaProvenanceRpcClient {
  readonly #rpcOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  #requestId = 0;

  constructor(options: {
    rpcOrigin: string;
    requestTimeoutMs?: number;
    fetchFn?: FetchLike;
  }) {
    this.#rpcOrigin = options.rpcOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async getSignatureStatus(signature: string): Promise<unknown> {
    return this.request("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true }
    ]);
  }

  async getTransaction(signature: string): Promise<unknown> {
    return this.request("getTransaction", [
      signature,
      {
        commitment: "confirmed",
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0
      }
    ]);
  }

  private async request(method: string, params: unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort("SOLANA_RPC_TIMEOUT"),
      this.#requestTimeoutMs
    );
    try {
      this.#requestId += 1;
      const response = await this.#fetchFn(this.#rpcOrigin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.#requestId,
          method,
          params
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new SolanaProvenanceError(
          "RPC_HTTP_ERROR",
          "Solana RPC request failed."
        );
      }
      return extractRpcResult(await response.json());
    } catch (error) {
      if (error instanceof SolanaProvenanceError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new SolanaProvenanceError(
          "RPC_TIMEOUT",
          "Solana RPC provenance request timed out."
        );
      }
      throw new SolanaProvenanceError(
        "RPC_NETWORK_ERROR",
        "Solana RPC provenance request failed."
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseConfirmationStatus(payload: unknown): "confirmed" | "finalized" {
  const value = asArray(asRecord(payload)?.value)[0];
  const status = asRecord(value);
  if (status === undefined) {
    throw new SolanaProvenanceError(
      "TRANSACTION_NOT_FOUND",
      "The subscription transaction was not found on the selected network."
    );
  }
  if (status.err !== null) {
    throw new SolanaProvenanceError(
      "TRANSACTION_FAILED",
      "The subscription transaction did not execute successfully."
    );
  }
  const confirmationStatus = readString(status, "confirmationStatus");
  if (confirmationStatus !== "confirmed" && confirmationStatus !== "finalized") {
    throw new SolanaProvenanceError(
      "TRANSACTION_UNCONFIRMED",
      "The subscription transaction is not confirmed."
    );
  }
  return confirmationStatus;
}

interface ParsedSubscribeInstruction {
  serviceLevelId: number;
  durationWeeks: number;
}

function parseSubscribeInstruction(
  instruction: unknown,
  expectedProgramId: string,
  walletPublicKey: string
): ParsedSubscribeInstruction | undefined {
  const record = asRecord(instruction);
  if (readString(record, "programId") !== expectedProgramId) {
    return undefined;
  }
  const accounts = asArray(record?.accounts).filter(
    (account): account is string => typeof account === "string"
  );
  if (!accounts.includes(walletPublicKey)) {
    return undefined;
  }
  const data = readString(record, "data");
  if (data === undefined) {
    return undefined;
  }
  const decoded = decodeBase58(data);
  if (
    decoded.length < SUBSCRIBE_DISCRIMINATOR.length + 3 ||
    !equalBytes(
      decoded.slice(0, SUBSCRIBE_DISCRIMINATOR.length),
      SUBSCRIBE_DISCRIMINATOR
    )
  ) {
    return undefined;
  }
  const serviceLevelId = decoded[8]! | (decoded[9]! << 8);
  const durationWeeks = decoded[10]!;
  return { serviceLevelId, durationWeeks };
}

function findSubscribeInstruction(
  transactionResult: UnknownRecord,
  expectedProgramId: string,
  walletPublicKey: string
): ParsedSubscribeInstruction {
  const transaction = asRecord(transactionResult.transaction);
  const message = asRecord(transaction?.message);
  const topLevelInstructions = asArray(message?.instructions);
  const meta = asRecord(transactionResult.meta);
  const innerInstructions = asArray(meta?.innerInstructions).flatMap((entry) =>
    asArray(asRecord(entry)?.instructions)
  );

  for (const instruction of [...topLevelInstructions, ...innerInstructions]) {
    const parsed = parseSubscribeInstruction(
      instruction,
      expectedProgramId,
      walletPublicKey
    );
    if (parsed !== undefined) {
      return parsed;
    }
  }
  throw new SolanaProvenanceError(
    "SUBSCRIBE_INSTRUCTION_NOT_FOUND",
    "The transaction did not contain the expected TxLINE subscribe instruction for the configured wallet."
  );
}

function verifyTransactionEnvelope(
  payload: unknown,
  transactionSignature: string,
  walletPublicKey: string
): UnknownRecord {
  const result = asRecord(payload);
  if (result === undefined) {
    throw new SolanaProvenanceError(
      "TRANSACTION_NOT_FOUND",
      "The subscription transaction was not found on the selected network."
    );
  }
  const meta = asRecord(result.meta);
  if (meta === undefined || meta.err !== null) {
    throw new SolanaProvenanceError(
      "TRANSACTION_FAILED",
      "The subscription transaction did not execute successfully."
    );
  }
  const transaction = asRecord(result.transaction);
  const signatures = asArray(transaction?.signatures);
  if (signatures[0] !== transactionSignature) {
    throw new SolanaProvenanceError(
      "SIGNATURE_MISMATCH",
      "The RPC transaction did not match the configured transaction signature."
    );
  }
  const message = asRecord(transaction?.message);
  const walletSigner = asArray(message?.accountKeys).some((item) => {
    const account = asRecord(item);
    return (
      readString(account, "pubkey") === walletPublicKey &&
      account?.signer === true
    );
  });
  if (!walletSigner) {
    throw new SolanaProvenanceError(
      "WALLET_NOT_SIGNER",
      "The configured wallet was not a signer of the subscription transaction."
    );
  }
  return result;
}

function resolveCommitSha(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== "") {
    return explicit.trim();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNKNOWN";
  }
}

export function renderSolanaProvenanceReceipt(input: {
  network: TxlineNetwork;
  commitSha: string;
  verifiedAt: string;
}): string {
  return [
    "TXLINE SOLANA PROVENANCE: PASS",
    "",
    `Network: ${input.network}`,
    "Transaction located: PASS",
    "Transaction execution: PASS",
    "Confirmation status: PASS",
    "Expected TxLINE program: PASS",
    "Subscribe instruction: PASS",
    "Configured wallet signer: PASS",
    "Subscribe wallet account: PASS",
    "Service level decoded: PASS",
    "Duration decoded: PASS",
    "API token linkage: NOT CLAIMED",
    "",
    `Commit: ${input.commitSha}`,
    `Verified at UTC: ${input.verifiedAt}`,
    "",
    "Raw RPC response logged: NO",
    "Raw RPC response persisted: NO",
    "Wallet secret required: NO",
    "Receipt allowlist validation: PASS",
    ""
  ].join("\n");
}

export function validateSolanaProvenanceReceipt(receipt: string): void {
  const forbidden = [
    /TXLINE_WALLET_PUBKEY/i,
    /TXLINE_SUBSCRIPTION_TX_SIG/i,
    /private key/i,
    /secret key/i,
    /https?:\/\//i,
    /\{[\s\S]*\}/,
    /\[[\s\S]*\]/
  ];
  if (forbidden.some((pattern) => pattern.test(receipt))) {
    throw new SolanaProvenanceError(
      "RECEIPT_ALLOWLIST_FAILED",
      "The Solana provenance receipt contained a forbidden value."
    );
  }
}

export async function verifySolanaProvenance(
  options: SolanaProvenanceOptions
): Promise<SolanaProvenanceResult> {
  validatePublicInputs(
    options.walletPublicKey,
    options.transactionSignature
  );
  const network = SOLANA_NETWORKS[options.network];
  const [statusPayload, transactionPayload] = await Promise.all([
    options.rpcClient.getSignatureStatus(options.transactionSignature),
    options.rpcClient.getTransaction(options.transactionSignature)
  ]);
  const confirmationStatus = parseConfirmationStatus(statusPayload);
  const transactionResult = verifyTransactionEnvelope(
    transactionPayload,
    options.transactionSignature,
    options.walletPublicKey
  );
  const subscribe = findSubscribeInstruction(
    transactionResult,
    network.programId,
    options.walletPublicKey
  );

  if (
    options.expectedServiceLevelId !== undefined &&
    subscribe.serviceLevelId !== options.expectedServiceLevelId
  ) {
    throw new SolanaProvenanceError(
      "SERVICE_LEVEL_MISMATCH",
      "The subscribe instruction used a different service level."
    );
  }
  if (
    options.expectedDurationWeeks !== undefined &&
    subscribe.durationWeeks !== options.expectedDurationWeeks
  ) {
    throw new SolanaProvenanceError(
      "DURATION_MISMATCH",
      "The subscribe instruction used a different duration."
    );
  }

  const verifiedAt = new Date(options.verifiedAt ?? Date.now()).toISOString();
  const receipt = renderSolanaProvenanceReceipt({
    network: options.network,
    commitSha: resolveCommitSha(options.commitSha),
    verifiedAt
  });
  validateSolanaProvenanceReceipt(receipt);

  return {
    receipt,
    serviceLevelId: subscribe.serviceLevelId,
    durationWeeks: subscribe.durationWeeks,
    confirmationStatus
  };
}

export async function verifySolanaProvenanceFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchFn?: FetchLike
): Promise<SolanaProvenanceResult> {
  const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
  const walletPublicKey = env.TXLINE_WALLET_PUBKEY?.trim();
  const transactionSignature = env.TXLINE_SUBSCRIPTION_TX_SIG?.trim();
  if (walletPublicKey === undefined || walletPublicKey === "") {
    throw new SolanaProvenanceError(
      "INVALID_CONFIGURATION",
      "TXLINE_WALLET_PUBKEY is required."
    );
  }
  if (transactionSignature === undefined || transactionSignature === "") {
    throw new SolanaProvenanceError(
      "INVALID_CONFIGURATION",
      "TXLINE_SUBSCRIPTION_TX_SIG is required."
    );
  }
  const expectedServiceLevelId = readInteger(
    env.TXLINE_EXPECTED_SERVICE_LEVEL_ID,
    "TXLINE_EXPECTED_SERVICE_LEVEL_ID"
  );
  const expectedDurationWeeks = readInteger(
    env.TXLINE_EXPECTED_DURATION_WEEKS,
    "TXLINE_EXPECTED_DURATION_WEEKS"
  );
  const requestTimeoutMs =
    readInteger(
      env.TXLINE_REQUEST_TIMEOUT_MS,
      "TXLINE_REQUEST_TIMEOUT_MS"
    ) ?? 30_000;
  if (requestTimeoutMs <= 0) {
    throw new SolanaProvenanceError(
      "INVALID_CONFIGURATION",
      "TXLINE_REQUEST_TIMEOUT_MS must be positive."
    );
  }

  const rpcClient = new SolanaJsonRpcClient({
    rpcOrigin: SOLANA_NETWORKS[network].rpcOrigin,
    requestTimeoutMs,
    ...(fetchFn === undefined ? {} : { fetchFn })
  });
  return verifySolanaProvenance({
    network,
    walletPublicKey,
    transactionSignature,
    rpcClient,
    ...(expectedServiceLevelId === undefined
      ? {}
      : { expectedServiceLevelId }),
    ...(expectedDurationWeeks === undefined
      ? {}
      : { expectedDurationWeeks })
  });
}

export async function writeSolanaProvenanceReceipt(
  result: SolanaProvenanceResult,
  path: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, result.receipt, { encoding: "utf8", mode: 0o600 });
}

export async function solanaProvenanceCli(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  try {
    const result = await verifySolanaProvenanceFromEnvironment(env);
    const receiptPath =
      env.TXLINE_PROVENANCE_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-solana-provenance.md";
    await writeSolanaProvenanceReceipt(result, receiptPath);
    process.stdout.write("TXLINE SOLANA PROVENANCE: PASS\n");
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
  } catch (error) {
    const message = sanitizedErrorMessage(error, [
      env.TXLINE_WALLET_PUBKEY ?? "",
      env.TXLINE_SUBSCRIPTION_TX_SIG ?? ""
    ]);
    process.stderr.write(`TXLINE SOLANA PROVENANCE: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}
