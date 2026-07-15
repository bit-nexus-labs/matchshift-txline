# MatchShift TxLINE adapter

MatchShift is a server-side, spoiler-safe personal sports timeline core. The deterministic synthetic proof remains the default data source. An optional backend-only TxLINE adapter adds documented fixture, odds, score, and SSE support without coupling credentials or raw provider payloads to the timeline engine.

## Milestone status

| Area | Status |
| --- | --- |
| Spoiler-safe personal timeline core | Implemented and tested |
| Deterministic synthetic data source | Implemented; default mode |
| Mocked TxLINE snapshots and SSE | Implemented and tested without network access |
| TxLINE devnet/mainnet transport | Implemented; requires an external API token/subscription and has not been live-smoke-tested in this repository |
| Official odds and nested score normalization | Implemented with independent feed-ordering domains |
| Data-source status endpoint | Implemented with sanitized metadata |
| UI, wallet, blockchain proof, rewards, betting, deployment | Not implemented in Task 02 |

The server does not make a TxLINE request merely because it starts. Synthetic mode requires no credentials. Tests and CI use mocks only and never contact TxLINE.

## Requirements

- Node.js 22 or newer
- pnpm 11.7.0

## Install and verify

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

CI runs the same install, typecheck, test, and build flow on Node.js 22.

## Data-source configuration

Copy `.env.example` and set only the variables needed by the selected mode:

| Variable | Meaning | Default |
| --- | --- | --- |
| `TXLINE_MODE` | `synthetic`, `devnet`, or `mainnet` | `synthetic` |
| `TXLINE_API_TOKEN` | Server-only TxLINE API token; required only for devnet/mainnet | empty |
| `TXLINE_REQUEST_TIMEOUT_MS` | Positive request timeout in milliseconds | `30000` |
| `TXLINE_RECONNECT_BASE_MS` | Positive reconnect base delay | `1000` |
| `TXLINE_RECONNECT_MAX_MS` | Positive reconnect cap, at least the base delay | `30000` |

Network origins are fixed in code:

- devnet: `https://txline-dev.txodds.com`
- mainnet: `https://txline.txodds.com`

There is no environment variable for a custom TxLINE host. The adapter obtains a guest JWT from `POST /auth/guest/start` on the selected host. Every snapshot or SSE request carries both `Authorization: Bearer <guest JWT>` and `X-Api-Token`. A data-request `401` refreshes the same-host guest JWT and retries exactly once. A `403` stops as `CONFIG_ERROR`.

Keep the API token server-side. Do not put it in browser code, logs, screenshots, commits, or issue reports. Account subscription and token activation are external human steps and are not automated by this repository.

## TxLINE schema boundary

The spoiler-safe core consumes normalized `MatchRecord` values only. It never consumes raw TxLINE payloads.

### Odds

Documented odds records use fields such as:

- `FixtureId`, `MessageId`, and `Ts`;
- `Bookmaker`, `BookmakerId`, and `SuperOddsType`;
- `InRunning`, `GameState`, `MarketParameters`, and `MarketPeriod`;
- `PriceNames`, `Prices`, and, when present, `Pct`.

Odds records are not required to contain `Seq` or `seq`. MatchShift currently normalizes only an unambiguous full-match `1X2` or match-winner market. `PriceNames` must map safely to home, draw, and away. Probability values are normalized from positive `Pct` values or inverse positive `Prices`.

Unsupported odds markets are ignored with sanitized diagnostics. A record that claims to be a supported market but contains malformed or ambiguous fields fails closed.

### Scores

Documented score records preserve observed `seq` and `ts`. Current score is read from nested totals:

```text
scoreSoccer.Participant1.Total.Goals
scoreSoccer.Participant2.Total.Goals
```

Goal side and minute are read from documented `dataSoccer` participant/minute fields and mapped through `Participant1IsHome`.

`action=disconnected` is handled by `action` even when `statusId` is absent. Unsupported semantic actions such as lineups do not poison an otherwise valid score snapshot. Malformed relevant goal or score records fail closed.

## Independent ordering domains

Synthetic Task 01 records retain their deterministic contiguous `sequence` domain.

TxLINE uses separate source-ordering domains:

- `TXLINE_SCORES` preserves the provider's observed score `seq` and detects real score gaps;
- `TXLINE_ODDS` preserves message identifiers, SSE identifiers, source timestamps, and deterministic payload identity without inventing a provider sequence.

Odds and scores are never passed through one mixed global sequence gate. Combined presentation order uses source timestamp plus a stable deterministic tie-breaker. A score gap holds score-derived changes until a trusted recovery snapshot is installed, while odds records do not require fabricated sequence values.

The adapter hydrates snapshots before streaming. After a disconnect, stream end, or score gap, it rehydrates snapshots before trusting subsequent score events. Prior timestamped records are retained so delayed viewers remain spoiler-safe.

## Adapter behavior

The adapter supports:

- fixture snapshots and one selected fixture;
- cancellation exclusion for `GameState=6`;
- ambiguous legacy duplicate detection when `GameState` is missing;
- official nested score recovery snapshots;
- official `1X2` odds snapshots and SSE records without `Seq`;
- fragmented SSE chunks, CRLF/LF, comments, `event`, `id`, `retry`, and multi-line `data`;
- heartbeat-only `IDLE_NO_COVERAGE`, never a false `LIVE`;
- bounded exponential reconnect delay with jitter and abort support;
- exact duplicate detection based on fixture, source identifiers, timestamp, and payload identity;
- sanitized `SAFE_HOLD`, `STALE`, and `CONFIG_ERROR` states.

## API

Health:

```http
GET /health
```

Sanitized data-source status:

```http
GET /api/data-source/status
```

Typical synthetic response:

```json
{
  "mode": "synthetic",
  "state": "SYNTHETIC_READY",
  "message": "Deterministic synthetic replay is ready."
}
```

The status route never returns the API token, guest JWT, authorization headers, or raw provider payloads.

Create a delayed synthetic viewer:

```http
POST /api/sessions
Content-Type: application/json

{
  "fixtureId": "synthetic-matchshift-001",
  "mode": "DELAYED",
  "visibilityCursor": 1784140980000
}
```

Read only that viewer's safe state:

```http
GET /api/sessions/:sessionId/state
```

Advance the cursor:

```http
PATCH /api/sessions/:sessionId
Content-Type: application/json

{
  "type": "ADVANCE_TO",
  "cursorMs": 1784141350000
}
```

The API never returns the raw match record collection. Every viewer state is rebuilt from records at or before that viewer's effective cursor and passed through the appropriate safety gate. Judges can run the synthetic proof with no login, wallet, TxLINE account, or external credential.

## Synthetic proof timeline

The included `SYNTHETIC` scenario contains kickoff, pre-goal odds, a home goal at minute 49, and post-goal odds ten seconds later. A viewer at minute 52 sees the goal, `1-0`, and post-goal odds. A viewer at minute 43 sees `0-0`, no goal, and only pre-goal odds.

## Official references

- [TxLINE Quickstart](https://txline.txodds.com/documentation/quickstart)
- [TxLINE World Cup documentation](https://txline.txodds.com/documentation/worldcup)
- [TxLINE snapshot examples](https://txline.txodds.com/documentation/examples/fetching-snapshots)
- [TxLINE streaming examples](https://txline.txodds.com/documentation/examples/streaming-data)
- [Official txodds/tx-on-chain examples](https://github.com/txodds/tx-on-chain/tree/main/examples)
- [Hackathon terms](https://txline.txodds.com/documentation/legal/hackathon-terms)

## Known limitations

- Sessions and hydrated matches are in memory and disappear on restart.
- The repository contains no live TxLINE credential and makes no real TxLINE call in tests or CI.
- Devnet/mainnet behavior is verified with deterministic HTTP/SSE mocks, not a live subscription.
- Only an unambiguous full-match `1X2` market is normalized for the MatchShift demo.
- There is no persistence, user authentication, rate limiting, UI, wallet flow, blockchain validation, rewards logic, betting flow, or deployment configuration in Task 02.
- Judge-facing live fixture activation and stream lifecycle orchestration remain future integration work; synthetic replay remains the guaranteed no-auth demo path.
