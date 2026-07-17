# TxLINE literal live-input observer

The live observer is a manual backend-only evidence command:

```bash
pnpm txline:live-observe
```

It does not replace the stable synthetic judge demo.

## What counts as PASS

The observer first authenticates through the existing TxLINE client and hydrates a fixture baseline from snapshots. It then opens both odds and score SSE streams and waits for the production adapter to deliver a new normalized record for the selected fixture.

Only an actual SSE data record counts. Opening the stream, receiving HTTP 200, or receiving heartbeat frames does not count as live-input evidence.

## Configuration

```text
TXLINE_NETWORK=mainnet
TXLINE_API_TOKEN=<server-only token>
TXLINE_LIVE_FIXTURE_ID=<optional manual fixture override>
TXLINE_COMPETITION_ID=<optional competition filter>
TXLINE_LIVE_OBSERVE_MS=45000
TXLINE_LIVE_WINDOW_HOURS=6
TXLINE_LIVE_RECEIPT_PATH=artifacts/private/txline-live-observer.md
```

Without a manual fixture override, the observer selects a non-ambiguous fixture whose start time is inside the configured window, preferring a recently started fixture over a future one.

## Outcomes

A real normalized stream record produces:

```text
TXLINE LIVE INPUT OBSERVER: PASS
```

If no normalized record arrives before both streams end or the observation timeout expires, the command reports:

```text
TXLINE LIVE INPUT OBSERVER: NOT OBSERVED
```

`NOT OBSERVED` is not converted into PASS merely because heartbeats were received. The command uses exit code `2` so scripts cannot accidentally treat missing evidence as success.

Configuration, authorization, schema, or baseline failures report `FAIL` and use exit code `1`.

## Data handling

Raw SSE frames are parsed and normalized only through the existing production adapter. The observer does not print or persist fixture metadata, score events, odds, identifiers, API credentials, or raw payloads. The allowlist receipt contains only high-level evidence status, network, commit SHA, and UTC verification time.

CI uses mocks and never opens TxLINE streams. A public badge remains blocked until a human obtains a real `PASS` and reviews the private receipt.
