# MatchShift TxLINE adapter

MatchShift is a server-side, spoiler-safe personal sports timeline core. Task 02 keeps the deterministic synthetic proof as the default and adds an optional TxLINE snapshot/SSE adapter without coupling transport or credentials to the timeline engine.

## Milestone status

| Area | Status |
| --- | --- |
| Spoiler-safe personal timeline core | Implemented and tested |
| Deterministic synthetic data source | Implemented; default mode |
| Mocked TxLINE snapshots and SSE | Implemented and tested without network access |
| TxLINE devnet/mainnet transport | Implemented; requires an external API token/subscription and has not been live-smoke-tested in this repository |
| Data-source status endpoint | Implemented with sanitized metadata |
| UI, wallet, blockchain proof, rewards, betting, deployment | Not implemented; outside Task 02 |

The server does not make a TxLINE request merely because it starts. Synthetic mode requires no credentials. Tests and CI use mocks only and never contact TxLINE.

## Requirements

- Node.js 22 or newer
- pnpm 11.7.0 (the version declared by the lockfile)

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

There is no environment variable for a custom TxLINE host. The adapter obtains a guest JWT from `POST /auth/guest/start` on the selected host. Each snapshot or SSE data request carries both `Authorization: Bearer <guest JWT>` and `X-Api-Token`. A data-request 401 refreshes the same-host guest JWT and retries exactly once; 403 stops as `CONFIG_ERROR`.

Keep the API token server-side. Do not put it in browser code, logs, screenshots, commits, or issue reports. Account subscription and data activation are external human steps handled with Tx Odds; the repository does not automate them.

## TxLINE adapter behavior

The adapter supports:

- fixture snapshots and per-fixture odds/score snapshots;
- cancellation exclusion for `GameState=6`;
- legacy duplicate detection when `GameState` is missing;
- feed-side home/away mapping via `Participant1IsHome`;
- SSE odds and score streams with fragmented chunks, CRLF/LF, comments, `event`, `id`, `retry`, and multi-line `data`;
- heartbeat-only `IDLE_NO_COVERAGE` status, never a false `LIVE`;
- bounded exponential reconnect delay with jitter and abort support;
- feed-native `Seq`/`seq`, timestamps, and source message identifiers;
- fail-closed `SAFE_HOLD` for invalid ordering, timestamps, or unsupported records;
- minimal kickoff, goal, score-recovery, odds, and disconnect normalization.

Exact duplicate source records may be ignored only when fixture stream, sequence, timestamp, and record identifier all match. Action text alone is never used as a deduplication key.

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

The status route may report `CONNECTING`, `SNAPSHOT_READY`, `LIVE`, `IDLE_NO_COVERAGE`, `DELAYED`, `STALE`, `SAFE_HOLD`, or `CONFIG_ERROR`, but never returns the API token, guest JWT, authorization headers, or raw provider payloads.

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

The API never returns the raw match record collection. Every viewer state is rebuilt from records at or before that viewer's effective cursor and passed through the sequence safety gate. Judges can run the synthetic proof with no login, wallet, TxLINE account, or external credential.

## Synthetic proof timeline

The included `SYNTHETIC` scenario contains kickoff, pre-goal odds, a home goal at minute 49, and post-goal odds ten seconds later. A viewer at minute 52 sees the goal, `1-0`, and post-goal odds. A viewer at minute 43 sees `0-0`, no goal, and only pre-goal odds.

## Official TxLINE references

- [Quickstart](https://txline.txodds.com/documentation/quickstart)
- [Hackathon terms](https://txline.txodds.com/documentation/legal/hackathon-terms)
- [World Cup documentation](https://txline.txodds.com/documentation/worldcup)

## Known limitations

- Sessions and hydrated matches are in memory and disappear on restart.
- The repository contains no live TxLINE credential and makes no real TxLINE call in tests or CI.
- Devnet/mainnet behavior is verified with deterministic HTTP/SSE mocks, not a live subscription.
- There is no persistence, user authentication, rate limiting, UI, wallet flow, blockchain validation, rewards logic, betting flow, or deployment configuration.
- Fixture selection and stream lifecycle orchestration remain server-side integration responsibilities; Task 02 exposes the adapter and sanitized status, not a judge-facing live activation workflow.
