# TxLINE Phantom activation helper

`pnpm txline:activate` starts a temporary localhost-only browser helper for the free TxLINE mainnet World Cup tier.

The helper is intentionally separate from the public judge demo. It binds to `127.0.0.1`, opens a random local port, and stops after completion, Ctrl+C, or twenty minutes.

## Scope

The helper:

1. connects to the Phantom browser extension;
2. derives the official pricing-matrix, treasury, and Token-2022 associated-token accounts;
3. checks whether the user's Token-2022 associated-token account already exists;
4. creates that account in a separate Phantom-approved transaction when it is missing, matching the official TxLINE mainnet example;
5. constructs the official mainnet `subscribe(serviceLevelId, durationWeeks)` instruction;
6. fixes the service level to `12`, the documented free real-time World Cup and International Friendlies tier;
7. uses a four-week duration;
8. simulates each signed transaction through a localhost proxy before broadcasting it;
9. requests a guest JWT from the matching mainnet host;
10. asks the same Phantom wallet to sign the exact standard-bundle activation message `${txSig}::${jwt}`;
11. activates and displays the API token once without writing it to disk or browser storage.

A brand-new wallet normally receives two Phantom transaction prompts: first the Token-2022 account creation, then the free TxLINE subscription. A wallet whose Token-2022 account already exists normally receives only the subscription prompt.

## Run

```powershell
pnpm txline:activate
```

The existing Windows evidence runner also offers to start the helper when the hidden API-token prompt is left empty:

```powershell
.\scripts\run-txline-evidence.ps1
```

## Security boundaries

- The helper never asks for a recovery phrase, private key, wallet JSON, or signing key.
- It supports mainnet only and uses fixed official TxLINE program, mint, API, and Solana RPC values.
- It does not purchase TxL or request a credit card.
- SOL may be spent only on the on-chain transaction fee and possible account rent shown before signing.
- A transaction that fails the helper's post-signature simulation is not broadcast.
- The API token stays in browser memory until the helper is stopped.
- Guest JWTs are held only in the localhost server memory and expire after ten minutes.
- POST requests require the exact localhost origin and a random per-process CSRF token.
- The Solana JSON-RPC proxy accepts only a narrow allowlist of methods required by this flow.
- TxLINE and Solana error payloads are not logged or persisted.

## Browser dependency

The local page imports a pinned browser bundle of `@solana/web3.js@1.91.9`, matching the version used by the official TxLINE repository. Browser Solana calls go only to the localhost helper; the Node process forwards the allowlisted JSON-RPC methods to the official Solana mainnet endpoint. This avoids browser-origin 403 failures while keeping the wallet secret entirely inside Phantom.

## Evidence boundary

Creating an API token does not by itself publish or claim integration evidence. After activation, run the historical smoke, Solana provenance check, and live observer. Public badges remain blocked until those real local runs produce reviewed PASS receipts.
