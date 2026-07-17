# MatchShift submission draft

## Project name

MatchShift

## Track

Consumer & Fan Experiences

## Tagline

Live data without future knowledge.

## One-line description

A spoiler-safe football companion that gives every delayed viewer a server-enforced personal match timeline for score, events, odds context, and explanations.

## Problem

Millions of fans watch football behind the live edge because of streaming delay, travel, work, pause/rewind, or time-zone differences. Conventional sports apps expose the latest score immediately. Muting notifications is not enough: opening a score page, timeline, odds widget, or chat can reveal the future.

## Solution

MatchShift creates an independent visibility cursor for every viewing session. The backend ingests and normalizes match data, stores timestamped records, and derives each response only from records at or before that viewer's cursor.

A viewer at minute 43 receives the minute-43 score, events, probabilities, and explanation even when the real match has already reached minute 52. Advancing the cursor unlocks later information in source-time order.

## Why it is different

Most anti-spoiler features hide the current score in the interface. MatchShift enforces the boundary on the server:

- future records are omitted from the delayed session response;
- score and odds use their own source timestamps;
- explanations receive visible state only;
- uncertain score ordering fails closed;
- reconnect recovery hydrates trusted snapshots before new score events are accepted.

## TxLINE integration

The optional TxLINE adapter supports:

- guest JWT acquisition and server-only API token headers;
- fixture, odds, and score snapshots;
- odds and score SSE streams;
- one-time guest JWT refresh after a data-request `401`;
- hard configuration stop after `403`;
- official odds records without invented sequence values;
- nested football score payloads;
- independent score and odds ordering domains;
- heartbeat, reconnect, jitter, abort, deduplication, and fail-closed recovery.

The public judge path uses deterministic synthetic replay, so evaluation never depends on a subscription, account, wallet, token purchase, or live fixture coverage.

## Specific TxLINE endpoints used

- `POST /auth/guest/start`
- `GET /api/fixtures/snapshot?competitionId=<id>`
- `GET /api/odds/snapshot/:fixtureId`
- `GET /api/odds/snapshot/:fixtureId?asOf=<timestamp>`
- `GET /api/scores/snapshot/:fixtureId`
- `GET /api/scores/historical/:fixtureId`
- `GET /api/odds/stream`
- `GET /api/scores/stream`

The full endpoint purpose, authentication behavior, and developer feedback are documented in [`TXLINE_ENDPOINTS_AND_FEEDBACK.md`](TXLINE_ENDPOINTS_AND_FEEDBACK.md).

## Authenticated private evidence

On July 17, 2026, an explicit local evidence runner completed against TxLINE mainnet without publishing provider data:

- historical TxLINE integration smoke: `PASS`;
- Solana subscription provenance verification: `PASS`;
- literal normalized live SSE record: `NOT OBSERVED` during the short observation window and therefore not claimed as `PASS`.

The generated receipts remain private. They contain no API token, guest JWT, wallet secret, raw provider payload, team name, score, odds, or probability value. The public repository and judge deployment remain deterministic and credential-free.

## TxLINE developer experience feedback

The guest-JWT bootstrap, shared authentication model, snapshot examples, and normalized cross-competition schema made a clean server-only adapter possible. Snapshot-first hydration also mapped well to a reliable reconnect design.

The main friction was around historical schema and timing boundaries. A valid historical three-way winner shape was not covered by the first narrow classifier, so additional historical odds examples and a clearer mapping between `SuperOddsType`, `PriceNames`, `MarketParameters`, and `MarketPeriod` would help. Precise `asOf` semantics and explicit guidance distinguishing heartbeat-only SSE connections from observed data records would also reduce integration uncertainty.

## Judge demo

The landing page is a side-by-side comparison console:

- Viewer A is at the live edge.
- Viewer B starts at minute 43.
- Viewer A sees the minute-49 goal and post-goal probabilities.
- Viewer B sees `0-0`, no goal, and only the earlier probabilities.

At minute 49, Viewer B receives the goal but not the later odds update. At minute 49:10, the updated probabilities appear.

Controls include personal cursor, one-minute advance, pause, resume, catch-up, and reset.

## Commercial and monetization path

MatchShift is designed first as a white-label B2B API/SDK for OTT streaming platforms, sports broadcasters, sports-media apps, and fan-community products. These customers can connect the server-side visibility gate to their player, match centre, statistics, chat, or odds-context overlays so delayed viewers receive synchronized information instead of live-edge spoilers.

The planned revenue model is a recurring platform licence plus usage-based pricing by active synchronized session or covered event. The initial go-to-market path is a single-tournament integration pilot, followed by expansion across leagues through TxLINE's normalized schema. A later direct-to-consumer premium tier could add private delayed watch rooms and cross-device playback synchronization, while the public judge path remains free and credential-free.

## Architecture

```text
TxLINE / deterministic replay
          ↓
      normalizer
          ↓
 append-only match records
          ↓
 per-session visibility gate
          ↓
 spoiler-safe state API
          ↓
 comparison UI / explanation layer
```

## Safety model

- The browser never receives the complete raw record collection.
- Session state is rebuilt on the server.
- Synthetic records preserve a deterministic sequence baseline.
- TxLINE scores preserve provider `seq` and detect gaps.
- TxLINE odds do not fabricate a provider sequence.
- Malformed supported records fail closed.
- Unsupported markets/actions do not poison otherwise valid state.
- API tokens and guest JWTs are server-only and redacted from status/errors.

## Judge access

- No login
- No wallet
- No gas
- No token purchase
- No TxLINE account
- No third-party account
- No external data dependency

## Public deployment

- Public demo: https://matchshift-txline.onrender.com
- Health check: https://matchshift-txline.onrender.com/health
- Deployment source: Render auto-deploys the reviewed `main` branch; Render Events showed `6ee0a0e737dbe05e1920b0a74d7ba862a49ec9db` live on July 17 before final documentation polish.
- Deployment mode: `TXLINE_MODE=synthetic`
- Deployment receipt: [`PUBLIC_DEPLOYMENT_RECEIPT_2026-07-16.md`](PUBLIC_DEPLOYMENT_RECEIPT_2026-07-16.md)

## Built during the hackathon

The public repository contains the MatchShift-specific core, TxLINE adapter, tests, judge UI, container configuration, and documentation developed for this hackathon.

No private trading bot source, exchange secrets, raw TxLINE exports, or copied competitor code is included.

## Current limitations

- The public demo uses deterministic synthetic data.
- Authenticated historical TxLINE integration was privately verified, but a literal normalized live SSE record has not yet been observed and is not claimed as complete live-input proof.
- Sessions are in memory.
- Only an unambiguous full-match `1X2` market is normalized for the demo.
- Production user authentication, persistence, shared watch rooms, and streaming-platform integrations are roadmap items.

## Roadmap

1. OTT/player synchronization for automatic playback cursor updates.
2. Private delayed watch rooms where all participants share a safe cursor.
3. Additional safely validated football markets and event types.
4. Signed visibility receipts proving which source records were eligible for a response.
5. White-label SDK for streaming and sports-media platforms.

## Suggested submission links

- Repository: `https://github.com/bit-nexus-labs/matchshift-txline`
- Public demo: `https://matchshift-txline.onrender.com`
- Demo video: `<ADD AFTER RECORDING>`

## Suggested short pitch

> MatchShift is a personal match timeline for delayed viewers. Instead of merely hiding the live score in the interface, it enforces a visibility cursor on the server. Two people can follow the same match at different playback minutes without the delayed viewer receiving future goals, odds changes, or explanations. The judge demo is one click, walletless, loginless, and deterministic, while the optional TxLINE adapter handles official snapshots and streams with fail-closed ordering safety. Authenticated historical integration and subscription provenance were privately verified without publishing provider data; literal live SSE remains honestly recorded as not yet observed. Commercially, MatchShift can be licensed as a white-label B2B API/SDK to streaming and sports-media platforms through recurring platform and usage-based fees.
