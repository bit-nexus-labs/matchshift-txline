# MatchShift core engine

This milestone proves server-side spoiler isolation for two viewers watching the same match at different personal viewing cursors.

The repository intentionally contains only:

- a strict TypeScript core timeline engine;
- deterministic score and odds derivation from visible records;
- `LIVE`, `DELAYED`, `PAUSED`, and `REPLAY` session transitions;
- a fail-closed sequence safety gate with explicit recovery snapshots;
- a clearly labelled synthetic match scenario;
- a minimal Fastify API and acceptance tests.

It does **not** connect to TxLINE, Solana, wallets, databases, AI services, or a frontend yet.

## Requirements

- Node.js 22 or newer

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm start
```

## API

Create a delayed viewer at match minute 43:

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

The API never returns the raw match record collection. Every state response is rebuilt from records at or before the session's effective cursor, then passed through the sequence safety gate.

## Synthetic proof timeline

The included scenario is labelled `SYNTHETIC` and contains:

1. kickoff at `T0`;
2. pre-goal odds at `T0 + 10m`;
3. a home goal at `T0 + 49m`;
4. post-goal odds at `T0 + 49m 10s`.

A viewer at minute 52 sees the goal, `1-0`, and the post-goal odds. A viewer at minute 43 sees `0-0`, no goal, and only the pre-goal odds. At minute 49 the goal unlocks; ten seconds later the updated odds unlock.

## Known limitations

- Sessions are stored in memory and disappear on restart.
- The data source is synthetic; TxLINE integration is deliberately deferred.
- Explicit recovery snapshots are a core primitive but are not exposed as a public mutation endpoint in this milestone.
- Authentication, persistence, rate limiting, deployment configuration, and UI are out of scope.
