# MatchShift architecture

## Product invariant

For a session with effective visibility cursor `C`, no response derived for that session may contain match information whose trusted source timestamp is greater than `C`.

This invariant applies to:

- score;
- visible events;
- implied probabilities;
- timeline-aware explanation;
- visibility receipt.

## System overview

```text
Synthetic replay                 Optional TxLINE backend
       │                                  │
       │                      guest JWT + server API token
       │                                  │
       └──────────────┬───────────────────┘
                      ▼
                data-source boundary
                      ▼
                 normalizers
                      ▼
        timestamped normalized MatchRecord values
                      ▼
            independent ordering safety
                      ▼
              in-memory match timeline
                      ▼
          per-session effective cursor gate
                      ▼
              VisibleMatchState only
                ├──────────────┐
                ▼              ▼
          judge/API UI   visibility receipt
```

## Data-source boundary

The core does not depend on HTTP, SSE, JWTs, wallets, or TxLINE payload shapes.

`MatchDataSource` implementations provide normalized match definitions:

- `SyntheticMatchDataSource` supplies the deterministic judge replay.
- `TxlineAdapter` hydrates one selected fixture from documented snapshots and optionally follows score/odds SSE streams.

The public judge path always has access to the synthetic scenario, even when an optional TxLINE mode is configured incorrectly or unavailable.

## TxLINE transport

Server-only transport responsibilities:

1. Resolve a fixed official host from `devnet` or `mainnet`.
2. Acquire a guest JWT from the matching host.
3. Add both required authorization headers to data requests.
4. Refresh the guest JWT once after a data-request `401`.
5. Stop as `CONFIG_ERROR` after `403`.
6. Parse snapshots as JSON and streams as standards-compliant SSE.
7. Redact credentials from returned errors and status messages.

The transport layer never exposes tokens to the browser.

## Normalization

### Synthetic records

Synthetic records use one deterministic contiguous `sequence` domain. This makes missing-prefix, gap, duplicate, recovery, and no-future tests reproducible.

### TxLINE score records

Score records preserve observed provider `seq` and `ts`. MatchShift parses nested football score totals and event metadata, then stores score-order metadata in the `TXLINE_SCORES` domain.

A trusted score snapshot is the baseline. A subsequent non-contiguous score sequence causes fail-closed hold and snapshot rehydration before later score changes are accepted.

### TxLINE odds records

Documented odds records may not have `Seq`. MatchShift does not invent one.

The `TXLINE_ODDS` domain preserves:

- fixture identity;
- provider message ID when present;
- SSE event ID when present;
- source timestamp;
- deterministic payload identity.

Only an unambiguous full-match `1X2` market is normalized. Unsupported markets are ignored. Malformed records claiming to be supported fail closed.

## Combined ordering

Scores and odds are not forced through one global sequence.

Presentation order is:

1. source timestamp;
2. stable domain-specific tie-breaker.

Score-gap safety remains score-specific. Odds never require a fabricated score sequence.

## Session state machine

Supported modes:

- `LIVE` — effective cursor follows the match live edge;
- `DELAYED` — cursor is behind the live edge;
- `PAUSED` — cursor remains fixed;
- `REPLAY` — explicit replay cursor;
- `SAFE_HOLD` — presentation badge when ordering is not trusted.

Important transition:

A `LIVE` session advanced to a past cursor becomes `DELAYED`; it does not retain live access.

## Visibility derivation

For each request:

1. compute the session's effective cursor;
2. select records with `sourceTimestamp <= cursor`;
3. sort them deterministically;
4. run the appropriate sequence safety gates;
5. apply trusted recovery, odds, and event records in order;
6. derive score, visible events, probabilities, explanation, and safety status;
7. return only the derived state.

The raw record collection is not returned by the public API.

## Judge comparison console

`POST /api/demo/start` creates two sessions for the same synthetic fixture:

- Viewer A at the live edge;
- Viewer B at minute 43.

The page renders the two derived states side by side. It is deliberately a judge comparison console; each panel still comes from its own session calculation.

The delayed session can also be queried independently through:

```text
GET /api/sessions/:sessionId/state
```

Its response contains no future record identifiers or future probability values.

## Visibility receipts

A receipt hashes a fixed canonical representation of one already-derived visible state.

It is deterministic and spoiler-safe, but it is not a provider signature, source-data proof, settlement proof, or on-chain proof.

## Deployment

The production Docker image:

- builds on Node.js 22;
- uses a separate build stage;
- prunes development dependencies;
- runs as the non-root `node` user;
- exposes port `3000`;
- includes a `/health` container health check;
- defaults to `HOST=0.0.0.0` and synthetic mode supplied by the deployment environment.

GitHub Actions verifies both the code pipeline and a live container health smoke test.

## Current trust boundaries

Trusted:

- the reviewed repository commit;
- deterministic synthetic fixtures in the repository;
- validated normalized records;
- session state stored by the server process.

External/optional:

- TxLINE availability and subscription status;
- provider payload correctness;
- public hosting platform;
- browser/network delivery after a safe response has been generated.

Not implemented:

- user authentication;
- persistent session storage;
- signed provider proofs;
- on-chain validation;
- shared delayed watch rooms;
- automatic video-player synchronization.
