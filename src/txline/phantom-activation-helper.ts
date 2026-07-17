import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TXLINE_DEFAULT_DURATION_WEEKS,
  TXLINE_FREE_REALTIME_SERVICE_LEVEL_ID,
  TXLINE_MAINNET_API_ORIGIN,
  TXLINE_MAINNET_PROGRAM_ID,
  TXLINE_MAINNET_RPC_ORIGIN,
  TXLINE_MAINNET_TOKEN_MINT,
  encodeSubscribeInstruction
} from "./phantom-activation-protocol.js";

const MAX_BODY_BYTES = 32 * 1024;
const SESSION_TTL_MS = 10 * 60 * 1_000;
const SERVER_TTL_MS = 20 * 60 * 1_000;
const RPC_TIMEOUT_MS = 30_000;

const ALLOWED_RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getFeeForMessage",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getSignatureStatuses",
  "sendTransaction",
  "simulateTransaction"
]);

type UnknownRecord = Record<string, unknown>;

interface GuestSession {
  jwt: string;
  expiresAt: number;
}

interface ActivationRequest {
  activationId: string;
  txSig: string;
  walletSignature: string;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function writeNoStoreHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  writeNoStoreHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string
): void {
  writeNoStoreHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function readActivationRequest(value: unknown): ActivationRequest {
  const record = asRecord(value);
  const activationId = record?.activationId;
  const txSig = record?.txSig;
  const walletSignature = record?.walletSignature;
  if (
    typeof activationId !== "string" ||
    typeof txSig !== "string" ||
    typeof walletSignature !== "string" ||
    activationId.length < 16 ||
    activationId.length > 128 ||
    txSig.length < 32 ||
    txSig.length > 128 ||
    walletSignature.length < 32 ||
    walletSignature.length > 256
  ) {
    throw new Error("INVALID_ACTIVATION_REQUEST");
  }
  return {
    activationId: activationId.trim(),
    txSig: txSig.trim(),
    walletSignature: walletSignature.trim()
  };
}

function parseTokenResponse(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string" && parsed.trim() !== "") {
      return parsed.trim();
    }
    const token = asRecord(parsed)?.token;
    return typeof token === "string" && token.trim() !== ""
      ? token.trim()
      : undefined;
  } catch {
    return trimmed.length <= 4096 ? trimmed : undefined;
  }
}

function requireLocalRequest(
  request: IncomingMessage,
  expectedOrigin: string,
  csrfToken: string
): boolean {
  if (request.headers.host !== expectedOrigin.replace("http://", "")) {
    return false;
  }
  if (request.method === "POST") {
    return (
      request.headers.origin === expectedOrigin &&
      request.headers["x-matchshift-csrf"] === csrfToken
    );
  }
  return true;
}

function readAllowedRpcRequest(value: unknown): UnknownRecord {
  const record = asRecord(value);
  const method = record?.method;
  if (
    record === undefined ||
    record.jsonrpc !== "2.0" ||
    typeof method !== "string" ||
    !ALLOWED_RPC_METHODS.has(method)
  ) {
    throw new Error("INVALID_RPC_REQUEST");
  }
  return record;
}

async function proxySolanaRpc(
  payload: UnknownRecord,
  response: ServerResponse
): Promise<void> {
  const upstream = await fetch(TXLINE_MAINNET_RPC_ORIGIN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
  });

  if (!upstream.ok) {
    writeJson(response, 502, {
      error: "Solana RPC is temporarily unavailable."
    });
    return;
  }

  const body = await upstream.text();
  writeNoStoreHeaders(response);
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(body);
}

function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? { executable: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { executable: "open", args: [url] }
        : { executable: "xdg-open", args: [url] };
  try {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
    // The helper URL is always printed, so browser-launch failure is non-fatal.
  }
}

export function renderPhantomActivationHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MatchShift TxLINE activation</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #edf2ff; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { margin-bottom: 8px; }
    .muted { color: #aeb9d6; }
    .card { background: #131a2f; border: 1px solid #2b3659; border-radius: 16px; padding: 20px; margin-top: 18px; }
    .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; font-weight: 700; cursor: pointer; background: #7c6cff; color: white; }
    button.secondary { background: #263252; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    code, input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    input { width: 100%; box-sizing: border-box; background: #0d1428; color: #f4f6ff; border: 1px solid #354265; border-radius: 9px; padding: 11px; }
    .status { white-space: pre-wrap; overflow-wrap: anywhere; background: #0d1428; border-radius: 10px; padding: 14px; min-height: 52px; }
    .ok { color: #79e6ad; }
    .warn { color: #ffd479; }
    .error { color: #ff8e9b; }
    ol { padding-left: 22px; }
  </style>
</head>
<body>
<main>
  <h1>MatchShift TxLINE activation</h1>
  <p class="muted">Local-only helper for the free mainnet real-time World Cup tier. It never asks for a seed phrase or private key.</p>

  <section class="card">
    <strong>Safety boundary</strong>
    <ul>
      <li>Network: Solana mainnet</li>
      <li>TxLINE service level: 12 (free real-time bundle)</li>
      <li>Duration: 4 weeks</li>
      <li>No TxL purchase</li>
      <li>Only Solana fees and possible account rent are paid</li>
    </ul>
  </section>

  <section class="card">
    <ol>
      <li>Connect the new Phantom wallet.</li>
      <li>Review the estimated SOL requirement.</li>
      <li>Create the required Token-2022 account if it does not exist.</li>
      <li>Approve the TxLINE subscribe transaction.</li>
      <li>Sign the activation message and copy the API token.</li>
    </ol>
    <p class="muted">A new wallet normally shows two Phantom transaction approvals: Token-2022 account creation, then the free TxLINE subscription.</p>
    <div class="row">
      <button id="connect">1. Connect Phantom</button>
      <button id="subscribe" disabled>2. Subscribe</button>
      <button id="activate" disabled>3. Activate token</button>
    </div>
  </section>

  <section class="card">
    <strong>Wallet</strong>
    <div id="wallet" class="status muted">Not connected.</div>
  </section>

  <section class="card">
    <strong>Status</strong>
    <div id="status" class="status muted">Ready.</div>
  </section>

  <section class="card" id="tokenCard" hidden>
    <strong>TxLINE API token</strong>
    <p class="warn">Copy it now. The helper does not save it to disk or browser storage.</p>
    <input id="token" type="password" readonly autocomplete="off" spellcheck="false">
    <div class="row" style="margin-top:12px">
      <button id="copyToken">Copy token</button>
      <button id="revealToken" class="secondary">Reveal</button>
      <button id="closeHelper" class="secondary">Stop helper</button>
    </div>
  </section>
</main>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

export function renderPhantomActivationBrowserScript(csrfToken: string): string {
  const browserConfig = {
    programId: TXLINE_MAINNET_PROGRAM_ID,
    tokenMint: TXLINE_MAINNET_TOKEN_MINT,
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID,
    serviceLevelId: TXLINE_FREE_REALTIME_SERVICE_LEVEL_ID,
    durationWeeks: TXLINE_DEFAULT_DURATION_WEEKS,
    subscribeData: Array.from(
      encodeSubscribeInstruction(
        TXLINE_FREE_REALTIME_SERVICE_LEVEL_ID,
        TXLINE_DEFAULT_DURATION_WEEKS
      )
    )
  };

  return String.raw`import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from "https://esm.sh/@solana/web3.js@1.91.9?bundle&target=es2022";

const csrf = ${JSON.stringify(csrfToken)};
const config = ${JSON.stringify(browserConfig)};
const state = {
  provider: undefined,
  wallet: undefined,
  txSig: undefined,
  activationId: undefined,
  jwt: undefined
};

const elements = {
  connect: document.getElementById("connect"),
  subscribe: document.getElementById("subscribe"),
  activate: document.getElementById("activate"),
  wallet: document.getElementById("wallet"),
  status: document.getElementById("status"),
  tokenCard: document.getElementById("tokenCard"),
  token: document.getElementById("token"),
  copyToken: document.getElementById("copyToken"),
  revealToken: document.getElementById("revealToken"),
  closeHelper: document.getElementById("closeHelper")
};

const rpcEndpoint = location.origin + "/api/rpc";
const connection = new Connection(rpcEndpoint, {
  commitment: "confirmed",
  httpHeaders: { "X-MatchShift-CSRF": csrf }
});

function setStatus(message, tone) {
  elements.status.textContent = message;
  elements.status.className = "status " + (tone || "muted");
}

function providerOrThrow() {
  const provider = window.phantom && window.phantom.solana;
  if (!provider || !provider.isPhantom) {
    throw new Error("Phantom extension was not detected in this browser profile.");
  }
  return provider;
}

function publicKeyFromProvider(provider) {
  if (!provider.publicKey) {
    throw new Error("Phantom is not connected.");
  }
  return new PublicKey(provider.publicKey.toString());
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function deriveAta(owner, mint, tokenProgram, associatedTokenProgram) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram
  )[0];
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MatchShift-CSRF": csrf
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Local helper request failed.");
  }
  return body;
}

async function rpcCall(method, params) {
  const response = await postJson("/api/rpc", {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1_000_000_000),
    method,
    params
  });
  if (response.error) {
    throw new Error("Solana RPC rejected " + method + ".");
  }
  return response.result;
}

async function waitForSignature(signature) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true
    });
    const status = result.value[0];
    if (status && status.err) {
      throw new Error("The Solana transaction failed after submission.");
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  throw new Error("Timed out while waiting for Solana confirmation.");
}

async function signSimulateSend(transaction, provider, label) {
  const user = publicKeyFromProvider(provider);
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = user;
  transaction.recentBlockhash = latest.blockhash;

  setStatus("Review " + label + " in Phantom.", "warn");
  const signed = await provider.signTransaction(transaction);
  const serialized = signed.serialize();
  const simulation = await rpcCall("simulateTransaction", [
    bytesToBase64(serialized),
    {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: true
    }
  ]);

  if (!simulation || !simulation.value || simulation.value.err) {
    throw new Error(label + " failed simulation. No transaction was sent.");
  }

  const signature = await connection.sendRawTransaction(serialized, {
    skipPreflight: false,
    preflightCommitment: "confirmed"
  });
  await waitForSignature(signature);
  return signature;
}

function createAtaInstruction(
  payer,
  associatedToken,
  owner,
  mint,
  tokenProgram,
  associatedTokenProgram
) {
  return new TransactionInstruction({
    programId: associatedTokenProgram,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false }
    ],
    data: new Uint8Array()
  });
}

function createSubscribeInstruction(
  user,
  pricingMatrix,
  tokenMint,
  userTokenAccount,
  tokenTreasuryVault,
  tokenTreasuryPda,
  tokenProgram,
  associatedTokenProgram,
  programId
) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: pricingMatrix, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryVault, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryPda, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: associatedTokenProgram, isSigner: false, isWritable: false }
    ],
    data: Uint8Array.from(config.subscribeData)
  });
}

async function refreshWalletDisplay(user, userTokenAccount, needsAta) {
  const balance = await connection.getBalance(user, "confirmed");
  const rent = needsAta
    ? await connection.getMinimumBalanceForRentExemption(165, "confirmed")
    : 0;
  elements.wallet.textContent =
    user.toBase58() +
    "\nBalance: " +
    (balance / 1e9).toFixed(6) +
    " SOL\nToken-2022 account: " +
    (needsAta ? "not created" : userTokenAccount.toBase58()) +
    "\nPossible account rent: " +
    (rent / 1e9).toFixed(6) +
    " SOL";
  elements.wallet.className = "status ok";
  return { balance, rent };
}

async function connectWallet() {
  setStatus("Waiting for Phantom connection...", "warn");
  const provider = providerOrThrow();
  const result = await provider.connect();
  const wallet = new PublicKey(result.publicKey.toString());
  const tokenMint = new PublicKey(config.tokenMint);
  const tokenProgram = new PublicKey(config.tokenProgramId);
  const associatedTokenProgram = new PublicKey(config.associatedTokenProgramId);
  const userTokenAccount = deriveAta(
    wallet,
    tokenMint,
    tokenProgram,
    associatedTokenProgram
  );
  const tokenAccountInfo = await connection.getAccountInfo(
    userTokenAccount,
    "confirmed"
  );

  state.provider = provider;
  state.wallet = wallet;
  await refreshWalletDisplay(wallet, userTokenAccount, !tokenAccountInfo);
  elements.subscribe.disabled = false;
  setStatus("Wallet connected. Continue to the subscription flow.", "ok");
}

async function subscribe() {
  const provider = state.provider || providerOrThrow();
  const user = publicKeyFromProvider(provider);
  if (!state.wallet || user.toBase58() !== state.wallet.toBase58()) {
    throw new Error("The connected Phantom account changed. Reconnect before continuing.");
  }

  elements.subscribe.disabled = true;
  setStatus("Preparing the official TxLINE mainnet subscription flow...", "warn");

  const programId = new PublicKey(config.programId);
  const tokenMint = new PublicKey(config.tokenMint);
  const tokenProgram = new PublicKey(config.tokenProgramId);
  const associatedTokenProgram = new PublicKey(config.associatedTokenProgramId);
  const pricingMatrix = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("pricing_matrix")],
    programId
  )[0];
  const tokenTreasuryPda = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("token_treasury_v2")],
    programId
  )[0];
  const userTokenAccount = deriveAta(
    user,
    tokenMint,
    tokenProgram,
    associatedTokenProgram
  );
  const tokenTreasuryVault = deriveAta(
    tokenTreasuryPda,
    tokenMint,
    tokenProgram,
    associatedTokenProgram
  );

  let tokenAccountInfo = await connection.getAccountInfo(
    userTokenAccount,
    "confirmed"
  );
  const walletState = await refreshWalletDisplay(
    user,
    userTokenAccount,
    !tokenAccountInfo
  );
  const estimatedFees = tokenAccountInfo ? 10_000 : 15_000;
  const estimatedMinimum = walletState.rent + estimatedFees;
  if (walletState.balance < estimatedMinimum) {
    elements.subscribe.disabled = false;
    throw new Error(
      "Insufficient SOL. Fund the displayed public address, then press Subscribe again. Phantom shows the final transaction preview."
    );
  }

  const approvalCount = tokenAccountInfo ? "one" : "two";
  const approved = window.confirm(
    "This free TxLINE subscription requires " +
      approvalCount +
      " Phantom transaction approval(s). A new wallet first creates its Token-2022 account, then subscribes to service level 12 for 4 weeks. Continue?"
  );
  if (!approved) {
    elements.subscribe.disabled = false;
    setStatus("Subscription cancelled before signing.", "muted");
    return;
  }

  if (!tokenAccountInfo) {
    const createAta = new Transaction().add(
      createAtaInstruction(
        user,
        userTokenAccount,
        user,
        tokenMint,
        tokenProgram,
        associatedTokenProgram
      )
    );
    await signSimulateSend(
      createAta,
      provider,
      "Token-2022 account creation"
    );

    const accountDeadline = Date.now() + 20_000;
    while (Date.now() < accountDeadline) {
      tokenAccountInfo = await connection.getAccountInfo(
        userTokenAccount,
        "confirmed"
      );
      if (tokenAccountInfo) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (!tokenAccountInfo) {
      throw new Error("Token-2022 account creation was confirmed but the RPC has not indexed it yet. Reconnect and try again.");
    }
    await refreshWalletDisplay(user, userTokenAccount, false);
    setStatus("Token-2022 account created. Phantom will now show the free TxLINE subscription.", "ok");
  }

  const subscribeTransaction = new Transaction().add(
    createSubscribeInstruction(
      user,
      pricingMatrix,
      tokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram,
      associatedTokenProgram,
      programId
    )
  );
  const txSig = await signSimulateSend(
    subscribeTransaction,
    provider,
    "TxLINE service-level 12 subscription"
  );

  const guest = await postJson("/api/guest", {});
  if (
    typeof guest.activationId !== "string" ||
    typeof guest.jwt !== "string"
  ) {
    throw new Error("The local helper did not receive a valid guest session.");
  }

  state.txSig = txSig;
  state.activationId = guest.activationId;
  state.jwt = guest.jwt;
  elements.activate.disabled = false;
  setStatus(
    "Subscription confirmed. Public transaction signature:\n" +
      txSig +
      "\nContinue to token activation.",
    "ok"
  );
}

async function activateToken() {
  const provider = state.provider || providerOrThrow();
  const user = publicKeyFromProvider(provider);
  if (!state.wallet || user.toBase58() !== state.wallet.toBase58()) {
    throw new Error("The connected Phantom account changed. Reconnect before activation.");
  }
  if (!state.txSig || !state.activationId || !state.jwt) {
    throw new Error("The subscribe transaction must be confirmed first.");
  }

  elements.activate.disabled = true;
  setStatus("Phantom will request a message signature. This is not a transaction and spends no SOL.", "warn");
  const message = new TextEncoder().encode(
    state.txSig + "::" + state.jwt
  );
  const signed = await provider.signMessage(message, "utf8");
  const signatureBytes = signed.signature || signed;
  const activation = await postJson("/api/activate", {
    activationId: state.activationId,
    txSig: state.txSig,
    walletSignature: bytesToBase64(signatureBytes)
  });
  if (typeof activation.token !== "string" || activation.token === "") {
    throw new Error("TxLINE did not return an API token.");
  }

  elements.token.value = activation.token;
  elements.tokenCard.hidden = false;
  setStatus("TxLINE API token activated. Copy it now and keep it local.", "ok");
}

elements.connect.addEventListener("click", () => {
  connectWallet().catch((error) =>
    setStatus(error.message || "Wallet connection failed.", "error")
  );
});
elements.subscribe.addEventListener("click", () => {
  subscribe().catch((error) => {
    elements.subscribe.disabled = false;
    setStatus(error.message || "Subscription failed.", "error");
  });
});
elements.activate.addEventListener("click", () => {
  activateToken().catch((error) => {
    elements.activate.disabled = false;
    setStatus(error.message || "Activation failed.", "error");
  });
});
elements.copyToken.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.token.value);
  setStatus("API token copied. Return to PowerShell and paste it only into the hidden prompt.", "ok");
});
elements.revealToken.addEventListener("click", () => {
  elements.token.type = elements.token.type === "password" ? "text" : "password";
  elements.revealToken.textContent = elements.token.type === "password" ? "Reveal" : "Hide";
});
elements.closeHelper.addEventListener("click", async () => {
  await postJson("/api/close", {});
  setStatus("Local activation helper stopped. You may close this tab.", "muted");
});
`;
}

export async function runPhantomActivationHelper(): Promise<void> {
  const csrfToken = randomBytes(32).toString("base64url");
  const sessions = new Map<string, GuestSession>();
  let expectedOrigin = "";
  let closing = false;

  const server = createServer(async (request, response) => {
    try {
      if (!requireLocalRequest(request, expectedOrigin, csrfToken)) {
        writeJson(response, 403, { error: "Local request validation failed." });
        return;
      }

      const url = new URL(request.url ?? "/", expectedOrigin);
      if (request.method === "GET" && url.pathname === "/") {
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'self' https://esm.sh; style-src 'unsafe-inline'; connect-src 'self' https://esm.sh; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        );
        writeText(
          response,
          200,
          "text/html; charset=utf-8",
          renderPhantomActivationHtml()
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/app.js") {
        writeText(
          response,
          200,
          "text/javascript; charset=utf-8",
          renderPhantomActivationBrowserScript(csrfToken)
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rpc") {
        const payload = readAllowedRpcRequest(await readJsonBody(request));
        await proxySolanaRpc(payload, response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/guest") {
        await readJsonBody(request);
        const authResponse = await fetch(
          `${TXLINE_MAINNET_API_ORIGIN}/auth/guest/start`,
          {
            method: "POST",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
          }
        );
        if (!authResponse.ok) {
          writeJson(response, 502, {
            error: "TxLINE guest authentication failed. Try again later."
          });
          return;
        }
        const token = asRecord(await authResponse.json())?.token;
        if (typeof token !== "string" || token.trim() === "") {
          writeJson(response, 502, {
            error: "TxLINE guest authentication returned an invalid response."
          });
          return;
        }
        const activationId = randomUUID();
        sessions.set(activationId, {
          jwt: token.trim(),
          expiresAt: Date.now() + SESSION_TTL_MS
        });
        writeJson(response, 200, { activationId, jwt: token.trim() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/activate") {
        const input = readActivationRequest(await readJsonBody(request));
        const session = sessions.get(input.activationId);
        if (session === undefined || session.expiresAt < Date.now()) {
          sessions.delete(input.activationId);
          writeJson(response, 400, {
            error: "The guest activation session expired. Repeat the subscribe step."
          });
          return;
        }

        const activationResponse = await fetch(
          `${TXLINE_MAINNET_API_ORIGIN}/api/token/activate`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${session.jwt}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              txSig: input.txSig,
              walletSignature: input.walletSignature,
              leagues: []
            }),
            signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
          }
        );
        const body = await activationResponse.text();
        if (!activationResponse.ok) {
          writeJson(response, activationResponse.status === 403 ? 403 : 502, {
            error:
              activationResponse.status === 403
                ? "TxLINE rejected activation. Confirm the same wallet signed the mainnet subscription and activation message."
                : "TxLINE activation request failed. Try again later."
          });
          return;
        }
        const apiToken = parseTokenResponse(body);
        if (apiToken === undefined) {
          writeJson(response, 502, {
            error: "TxLINE activation succeeded without a usable token response."
          });
          return;
        }
        sessions.delete(input.activationId);
        writeJson(response, 200, { token: apiToken });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/close") {
        await readJsonBody(request);
        writeJson(response, 200, { status: "closing" });
        if (!closing) {
          closing = true;
          setTimeout(() => server.close(), 100).unref();
        }
        return;
      }

      writeJson(response, 404, { error: "Not found." });
    } catch (error) {
      const statusCode =
        error instanceof SyntaxError ||
        (error instanceof Error &&
          [
            "REQUEST_TOO_LARGE",
            "INVALID_ACTIVATION_REQUEST",
            "INVALID_RPC_REQUEST"
          ].includes(error.message))
          ? 400
          : 500;
      writeJson(response, statusCode, {
        error:
          statusCode === 400
            ? "The local helper received an invalid request."
            : "The local activation helper failed safely."
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  expectedOrigin = `http://127.0.0.1:${address.port}`;

  const shutdownTimer = setTimeout(() => server.close(), SERVER_TTL_MS);
  shutdownTimer.unref();
  const stop = (): void => {
    if (!closing) {
      closing = true;
      server.close();
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write("MatchShift TxLINE Phantom activation helper\n");
  process.stdout.write(`Open: ${expectedOrigin}\n`);
  process.stdout.write(
    "This localhost helper never requests a seed phrase or private key.\n"
  );
  process.stdout.write("Press Ctrl+C to stop it.\n");
  openBrowser(expectedOrigin);

  await new Promise<void>((resolve) => server.once("close", resolve));
  clearTimeout(shutdownTimer);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  sessions.clear();
  process.stdout.write("Activation helper stopped.\n");
}
