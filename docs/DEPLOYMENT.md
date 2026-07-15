# MatchShift deployment runbook

This runbook prepares the judge-facing synthetic demo for a public HTTPS host. It does not activate TxLINE, connect a wallet, or require secrets.

## Deployment target

The deployed service must support:

- a Node.js 22 runtime or the included Dockerfile;
- an externally supplied `PORT` value;
- inbound HTTP traffic;
- automatic HTTPS at the platform edge;
- health checks against `GET /health`;
- at least one continuously running process during judging.

The default judge configuration is:

```text
TXLINE_MODE=synthetic
HOST=0.0.0.0
```

Do not configure `TXLINE_API_TOKEN` for the public judge demo. The synthetic replay requires no external credentials or network calls.

## Local container verification

Build:

```bash
docker build -t matchshift:local .
```

Run:

```bash
docker run --rm -p 3000:3000 \
  -e TXLINE_MODE=synthetic \
  matchshift:local
```

Verify:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/api/data-source/status
```

Open:

```text
http://127.0.0.1:3000
```

## Generic container-platform settings

Use these values when a host asks for deployment configuration:

| Setting | Value |
| --- | --- |
| Build source | Repository Dockerfile |
| Container port | `3000` |
| Health path | `/health` |
| Minimum instances | `1` during judging |
| Environment | `TXLINE_MODE=synthetic` |
| Public access | Enabled |
| HTTPS | Required |

Do not expose a custom TxLINE origin, wallet path, keypair, JWT, API token, or RPC secret.

## Pre-deployment checks

Run on the exact commit to be deployed:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
docker build -t matchshift:release .
```

Then confirm:

1. `/` loads the MatchShift comparison console.
2. **Start spoiler-safe demo** creates both viewers.
3. Viewer B begins at minute 43 with `0-0` and pre-goal probabilities.
4. Minute 49 reveals the goal but not the later probability update.
5. Minute 49:10 reveals the post-goal probabilities.
6. `/api/fixtures` contains no raw record collection.
7. A direct delayed-session state response contains no future record identifiers.
8. No browser console error appears during slider, pause, resume, or catch-up actions.

## Public URL smoke test

After deployment, test from a private/incognito browser window with no existing login:

```text
https://<public-host>/
https://<public-host>/health
https://<public-host>/api/data-source/status
```

The demo must work without:

- creating an account;
- connecting a wallet;
- signing a message or transaction;
- buying a token or subscription;
- entering an email address;
- enabling third-party cookies.

## Rollback

Keep the last known-good container image or commit SHA. If a release fails:

1. route traffic back to the last known-good image;
2. verify `/health` and the synthetic demo;
3. investigate on a separate branch;
4. never patch the production branch directly.

## Optional TxLINE backend

Devnet/mainnet are not required for judge access. Activate them only in a separate private environment after a human has provisioned the official API token.

Required server-side values:

```text
TXLINE_MODE=devnet
TXLINE_API_TOKEN=<server-only value>
```

Never add these values to GitHub, public deployment logs, screenshots, or the judge demo environment.
