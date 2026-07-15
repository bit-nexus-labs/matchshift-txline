# MatchShift — spoiler-safe personal match timelines

MatchShift lets football viewers follow live match data at their own viewing pace. The server exposes only the score, events, odds context, and explanation that existed at each session's personal cursor.

The deterministic synthetic replay is the guaranteed judge path. An optional backend-only TxLINE adapter supports documented fixture, odds, score, and SSE data without coupling credentials or raw provider payloads to the timeline engine.

## Milestone status

| Area | Status |
| --- | --- |
| Spoiler-safe personal timeline core | Implemented and tested |
| One-click judge comparison console | Implemented; no login, wallet, payment, or external account |
| Deterministic synthetic data source | Implemented; default judge mode |
| Mocked TxLINE snapshots and SSE | Implemented and tested without network access |
| TxLINE devnet/mainnet transport | Implemented; requires external token/subscription and is not live-smoke-tested here |
| Official odds and nested score normalization | Implemented with independent feed-ordering domains |
| Data-source status endpoint | Implemented with sanitized metadata |
| Deployment, wallet proof, rewards, betting | Not implemented yet |

The server does not make a TxLINE request merely because it starts. Synthetic mode requires no credentials. Tests and CI use mocks only and never contact TxLINE.

## Run the judge demo

Requirements:

- Node.js 22 or newer
- pnpm 11.7.0

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Open `http://127.0.0.1:3000` and press **Start spoiler-safe demo**.

The page creates two independent server-side sessions for the same synthetic match:

- **Live edge** sees the 49th-minute goal, `1-0`, and post-goal probabilities.
- **Personal timeline** starts at minute 43 and receives `0-0`, no goal, and only pre-goal probabilities.

Move the personal cursor to minute 49 to reveal the goal. Move ten seconds further to reveal the updated probabilities. The UI also exposes pause, resume, one-minute advance, and catch-up controls.

The page is a comparison console: both panels are visible to the judge, but each panel is rendered from its own session-derived state. The raw record collection is never returned. The delayed session response itself contains no future goal identifiers, future odds identifiers, or future probability values.

The demo page is self-contained, uses no external assets, and is served with a restrictive Content Security Policy.

## Judge/demo API

Start two isolated demo sessions:

```http
POST /api/demo/start
Content-Type: application/json

{}
```

List sanitized fixture metadata:

```http
GET /api/fixtures
```

Read only one viewer's safe state:

```http
GET /api/sessions/:sessionId/state
```

Advance one viewer's cursor:

```http
PATCH /api/sessions/:sessionId
Content-Type: application/json

{
  "type": "ADVANCE_TO",
  "cursorMs": 1784141350000
}
```

The API never returns the complete raw match record collection. Every viewer state is rebuilt from records at or before that viewer's effective cursor and then passed through the appropriate safety gate.

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

Synthetic records retain their deterministic contiguous `sequence` domain.

TxLINE uses separate source-ordering domains:

- `TXLINE_SCORES` preserves the provider's observed score `seq` and detects real score gaps;
- `TXLINE_ODDS` preserves message identifiers, SSE identifiers, source timestamps, and deterministic payload identity without inventing a provider sequence.

Odds and scores are never passed through one mixed global sequence gate. Combined presentation order uses source timestamp plus a stable deterministic tie-breaker. A score gap holds score-derived changes until a trusted recovery snapshot is installed, while odds records do not require fabricated sequence values.

The adapter hydrates snapshots before streaming. After a disconnect, stream end, or score gap, it rehydrates snapshots before trusting subsequent score events. Prior timestamped records are retained so delayed viewers remain spoiler-safe.

## Data-source health

```http
GET /health
```

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

## Synthetic proof timeline

The included `SYNTHETIC` scenario contains kickoff, pre-goal odds, a home goal at minute 49, and post-goal odds ten seconds later. A viewer at minute 52 sees the goal, `1-0`, and post-goal odds. A viewer at minute 43 sees `0-0`, no goal, and only pre-goal odds.

## Verification

GitHub Actions runs the same frozen install, typecheck, test, and build flow on Node.js 22. Tests cover:

- the original Task 01 no-future-data boundaries;
- official TxLINE odds and nested score shapes;
- independent score and odds ordering domains;
- JWT refresh, `403` stop, SSE parsing, reconnect, heartbeat, and redaction;
- judge page security headers and embedded script syntax;
- demo bootstrap isolation and timestamp-by-timestamp reveal.

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
- There is no persistence, user authentication, rate limiting, wallet flow, blockchain validation, rewards logic, betting flow, or deployment configuration yet.
- Judge-facing live fixture activation and stream lifecycle orchestration remain future integration work; synthetic replay remains the guaranteed no-auth demo path.
