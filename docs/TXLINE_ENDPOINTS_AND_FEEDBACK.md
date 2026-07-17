# TxLINE endpoints and developer experience feedback

This document records the exact TxLINE HTTP surfaces used by MatchShift and the practical integration feedback requested by the hackathon submission brief. It contains no API token, guest JWT, wallet secret, raw provider payload, team name, score, odds, probability value, or private receipt content.

## Specific TxLINE endpoints used

All data calls use the fixed devnet or mainnet TxLINE origin selected by server configuration. The API token and guest JWT remain server-side.

- `POST /auth/guest/start` — acquire the guest JWT used for authenticated data requests.
- `GET /api/fixtures/snapshot?competitionId=<id>` — discover fixture metadata, with the competition filter optional.
- `GET /api/odds/snapshot/:fixtureId` — fetch the current odds snapshot for one fixture.
- `GET /api/odds/snapshot/:fixtureId?asOf=<timestamp>` — fetch a historical odds snapshot at a requested source-time boundary.
- `GET /api/scores/snapshot/:fixtureId` — fetch the current score snapshot for one fixture.
- `GET /api/scores/historical/:fixtureId` — fetch historical score records used by the authenticated integration smoke.
- `GET /api/odds/stream` — consume the odds SSE stream.
- `GET /api/scores/stream` — consume the score SSE stream.

Every snapshot and SSE request sends both `Authorization: Bearer <guest JWT>` and `X-Api-Token`. A data-request `401` refreshes the guest JWT and retries exactly once. A `403` is treated as a subscription or configuration stop rather than a reconnectable transport failure.

## What worked well

- The guest-JWT bootstrap and the shared authentication model across snapshots and SSE made one server-only credential boundary possible.
- Separate snapshot and streaming examples encouraged a reliable hydrate-before-stream design.
- A normalized cross-competition schema is a strong foundation for a reusable visibility engine rather than a one-match integration.
- Source timestamps and score sequence values provided enough information to build conservative, fail-closed ordering rules.

## Friction encountered

- A real historical mainnet winner market used a valid named-side three-way shape that was not recognized by the initial narrow classifier. More documented historical odds variants, plus an explicit mapping between `SuperOddsType`, `PriceNames`, `MarketParameters`, and `MarketPeriod`, would reduce trial-and-error.
- Historical evidence required careful reasoning about the fixture kickoff timestamp versus the first trusted score timestamp. A precise definition of `asOf` boundary semantics, with one complete historical example, would make this easier to implement correctly.
- An SSE connection can be healthy while only heartbeats arrive during a short observation window. The docs would benefit from explicitly distinguishing transport connected, heartbeat observed, and normalized data record observed, together with recommended observation windows and recovery guidance.
- Sanitized schema fixtures for historical odds and nested football scores would make automated conformance testing easier without encouraging redistribution of live provider data.

## Evidence boundary

MatchShift's deterministic public judge path remains synthetic so judging is coverage-independent, free, walletless, and loginless. Separately, the authenticated historical integration smoke and public Solana subscription provenance verification passed privately on mainnet on July 17, 2026. A literal normalized live SSE data record was not observed during the short private window and is not claimed as a pass.
