# MatchShift — spoiler-safe personal match timelines

MatchShift lets football viewers follow live match data at their own viewing pace. The server exposes only the score, events, odds context, and explanation that existed at each session's personal cursor.

The deterministic synthetic replay is the guaranteed judge path. An optional backend-only TxLINE adapter supports documented fixture, odds, score, and SSE data without coupling credentials or raw provider payloads to the timeline engine.

## Live judge demo

- App: https://matchshift-txline.onrender.com
- Health: https://matchshift-txline.onrender.com/health
- No login, wallet, payment, subscription, or external account is required.

## Milestone status

| Area | Status |
| --- | --- |
| Spoiler-safe personal timeline core | Implemented and tested |
| One-click judge comparison console | Implemented; no login, wallet, payment, or external account |
| Deterministic synthetic data source | Implemented; default judge mode |
| Mocked TxLINE snapshots and SSE | Implemented and tested without network access |
| TxLINE devnet/mainnet transport | Implemented; authenticated historical integration smoke passed privately on mainnet |
| Official odds and nested score normalization | Implemented with independent feed-ordering domains |
| Deterministic visibility receipts | Implemented; explicitly not a provider signature or on-chain proof |
| Private subscription provenance verifier | Implemented and privately verified; not required by the judge path |
| Literal TxLINE live SSE observation | Not yet observed during the short private observation window; not claimed as PASS |
| Production container and CI health smoke | Implemented; public HTTPS deployment live on Render |
| Rewards, betting, settlement | Not implemented |

The server does not make a TxLINE request merely because it starts. Synthetic mode requires no credentials. Tests and CI use mocks only and never contact TxLINE.

Authenticated evidence is generated only by an explicit local runner. Its receipts remain private and contain no API token, guest JWT, wallet secret, raw provider payload, team name, score, odds, or probability value. On July 17, 2026, the historical TxLINE integration smoke and Solana subscription provenance verification passed on mainnet. A literal normalized SSE record did not arrive during the short live observation window, so live input remains honestly recorded as `NOT OBSERVED`, not `PASS`.

## Commercial path

MatchShift is designed first as a white-label B2B API/SDK for OTT streaming platforms, sports broadcasters, sports-media apps, and fan-community products. A customer can connect the server-side visibility gate to its video player, match centre, statistics, chat, or odds-context overlay so delayed viewers receive synchronized information instead of live-edge spoilers.

The planned revenue model is a recurring platform licence plus usage-based pricing by active synchronized session or covered event. A later direct-to-consumer premium tier could add private delayed watch rooms and cross-device playback synchronization. The public judge demo remains free and credential-free.

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

Request a deterministic receipt for that already-derived visible state:

```http
GET /api/sessions/:sessionId/receipt
```

The receipt is a SHA-256 state fingerprint. It is not a provider signature, settlement proof, source-data proof, or on-chain proof.

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

GitHub Actions runs frozen install, typecheck, tests, and build on Node.js 22. A second job builds the production Docker image, starts it in synthetic mode, and smoke-tests `/health`.

Tests cover:

- the original Task 01 no-future-data boundaries;
- official TxLINE odds and nested score shapes;
- independent score and odds ordering domains;
- JWT refresh, `403` stop, SSE parsing, reconnect, heartbeat, and redaction;
- judge page security headers and embedded script syntax;
- demo bootstrap isolation and timestamp-by-timestamp reveal;
- deterministic visibility receipts and delayed-session isolation.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment runbook](docs/DEPLOYMENT.md)
- [Public deployment receipt](docs/PUBLIC_DEPLOYMENT_RECEIPT_2026-07-16.md)
- [Judge demo runbook](docs/JUDGE_DEMO_RUNBOOK.md)
- [Visibility receipts](docs/VISIBILITY_RECEIPTS.md)
- [Submission draft](docs/SUBMISSION_DRAFT.md)
- [Compliance checklist](docs/COMPLIANCE_CHECKLIST.md)
- [Human authorship](docs/HUMAN_AUTHORSHIP.md)
- [Test evidence](docs/TEST_EVIDENCE.md)
- [Security policy](SECURITY.md)

## Official references

- [TxLINE Quickstart](https://txline.txodds.com/documentation/quickstart)
- [TxLINE World Cup documentation](https://txline.txodds.com/documentation/worldcup)
- [TxLINE snapshot examples](https://txline.txodds.com/documentation/examples/fetching-snapshots)
- [TxLINE streaming examples](https://txline.txodds.com/documentation/examples/streaming-data)
- [Official txodds/tx-on-chain examples](https://github.com/txodds/tx-on-chain/tree/main/examples)
- [Hackathon terms](https://txline.txodds.com/documentation/legal/hackathon-terms)
