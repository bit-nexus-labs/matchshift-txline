# TxLINE API Reference Audit — 2026-07-20

Scope: all 19 pages currently listed in the TxLINE API Reference navigation. This document records the documented request contract, the MatchShift integration status, and the retrieval relevance for a latest completed or historical-eligible fixture.

## Shared authentication contract

Data endpoints require both headers:

- `Authorization: Bearer <guest JWT>`
- `X-Api-Token: <long-lived API token>`

The guest JWT is obtained from `POST /auth/guest/start` and is documented as valid for 30 days. MatchShift already follows this two-token flow and refreshes the guest JWT once after a `401`.

## Endpoint matrix

| Area | Method and path | Key parameters / documented semantics | MatchShift status | Latest-match relevance |
|---|---|---|---|---|
| Authentication | `POST /auth/guest/start` | No body. Returns JSON `{ token }`; guest JWT expires after 30 days. | Implemented in `TxlineCredentials`. | Required. |
| Authentication | `POST /api/token/activate` | Bearer guest JWT; JSON body `txSig`, `walletSignature`, optional `leagues`; returns long-lived API token as `text/plain`. | Activation CLI exists; not part of normal reads. | Setup only. |
| Purchase | `POST /api/guest/purchase/quote` | Bearer guest JWT; body `buyerPubkey`, whole-unit `txlineAmount`; returns partially signed Solana transaction and USDT pricing. | Not integrated. | Not required for reading an active subscription. |
| Fixtures | `GET /api/fixtures/snapshot` | Optional `startEpochDay`; optional `competitionId`. The documented result contains fixtures starting at or within 30 days after the selected UTC epoch day. | Implemented. | Primary discovery route. |
| Fixtures | `GET /api/fixtures/updates/{epochDay}/{hourOfDay}` | UTC epoch day and hour. Documentation title says single fixture, but the route exposes no documented fixture query/path parameter. | Not integrated. | Secondary fixture-change diagnostics only. |
| Fixtures proof | `GET /api/fixtures/validation` | Required `fixtureId`; optional `timestamp` in Unix milliseconds, default now. | Not integrated. | Proof layer only after selecting a fixture/update. |
| Fixtures proof | `GET /api/fixtures/batch-validation` | Required UTC `epochDay` and `hourOfDay`. | Not integrated. | Hourly proof layer only. |
| Odds | `GET /api/odds/snapshot/{fixtureId}` | Optional `asOf` Unix timestamp in milliseconds; omitted means live snapshot. | Implemented for point-in-time odds sampling. | Primary odds recovery route. |
| Odds | `GET /api/odds/updates/{fixtureId}` | Current live odds updates for one fixture. | Not integrated as a product path. | Useful only while the fixture is live. |
| Odds | `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}` | Historical UTC five-minute bucket; `interval` 0–11; optional `fixtureId`. | Not integrated. | Important fallback candidate if snapshots are sparse. |
| Odds | `GET /api/odds/stream` | Real-time SSE, response `text/event-stream`. | Implemented and transport-tested. | Live mode only. |
| Odds proof | `GET /api/odds/validation` | Required `messageId` and message `ts`. | Not integrated. | Proof layer after obtaining an odds update. |
| Scores | `GET /api/scores/snapshot/{fixtureId}` | Optional `asOf` Unix timestamp in milliseconds; omitted means live snapshot. Returns action snapshots. | Implemented. | Primary score snapshot recovery route. |
| Scores | `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}` | Historical UTC five-minute bucket; `interval` 0–11; optional `fixtureId`; explicitly excludes live data. | Implemented. | Primary historical fallback. |
| Scores | `GET /api/scores/updates/{fixtureId}` | Current five-minute interval for one fixture, including live data if present. | Not integrated. | Live or immediately recent fixture only. |
| Scores | `GET /api/scores/historical/{fixtureId}` | Full sequence only when fixture start time is between six hours and two weeks in the past. Documented response is `application/json`. | Implemented with JSON/SSE defensive decoding. | Preferred historical route when eligible. |
| Scores | `GET /api/scores/stream` | Real-time SSE; optional `fixtureId`; optional `Last-Event-ID` header for resume. | Implemented and transport-tested. | Live mode only. |
| Scores proof | `GET /api/scores/stat-validation` | Required `fixtureId` and `seq`; legacy `statKey`/`statKey2` or stat-key selection. | Not integrated. | Single-event statistic proof only. |
| Scores proof | `GET /api/scores/stat-validation-v3` | Required `fixtureId`, `seq`, and comma-separated 1–5 `statKeys`. | Not integrated. | Multiproof layer only. |

## Contract findings that affect MatchShift

### 1. Historical eligibility must drive fixture selection

`/api/scores/historical/{fixtureId}` is not a general archive endpoint. The fixture start must be at least six hours old and no more than two weeks old. A latest-match probe must therefore select the newest fixture inside that exact window instead of selecting by a hard-coded team/date pair.

### 2. Fixture snapshot does not document completion state

The documented fixture snapshot shape includes timestamp, start time, competition, participants, fixture ID, and home-side mapping, but not a completion status. MatchShift must label the selected target as `historical-eligible`, not conclusively `completed`, until score data confirms a terminal or final state.

### 3. Historical full-score behavior has diverged from the published contract

The API Reference documents `200 application/json` for `/api/scores/historical/{fixtureId}`. A real mainnet call for Spain–Argentina returned `200 text/event-stream` with an empty body. MatchShift therefore keeps defensive SSE decoding and treats a structurally empty response as absent data only in diagnostic or disclosed partial-recovery flows.

### 4. Time units are mixed and must remain explicit

- `startEpochDay`: whole UTC days since Unix epoch.
- `hourOfDay`: UTC hour 0–23.
- `interval`: zero-indexed five-minute slot 0–11.
- `asOf`, proof timestamps, score/odds message timestamps: Unix milliseconds unless a provider payload proves otherwise.

No conversion may silently truncate milliseconds to seconds.

### 5. Fixture identifier widths are inconsistent in the published schemas

Fixture IDs are documented as `int64` on fixture snapshots and several fixture-specific routes, while some score bucket filters and proof routes show `int32`. MatchShift preserves fixture identifiers as strings internally and never narrows them to a JavaScript 32-bit integer.

### 6. Empty data and invalid data are different outcomes

A diagnostic probe may classify these as `EMPTY`:

- empty SSE body;
- no direct score records after bounded envelope decoding;
- no score snapshot records;
- no odds records.

Authentication failures, `403`, malformed JSON/SSE, timeouts, oversized responses, invalid parameters, and network failures remain fatal.

## Latest historical fixture probe design

The command `pnpm txline:probe-latest-match`:

1. requests fixtures beginning at the UTC epoch day exactly two weeks before now;
2. normalizes fixture identifiers and participant orientation;
3. selects the newest unambiguous fixture whose start is six hours through two weeks old;
4. probes full score history;
5. scans a bounded post-kickoff window through historical five-minute score buckets;
6. probes a point-in-time score snapshot and odds snapshot;
7. prints only team labels, UTC start time, counts, trusted score-state progression, and a final availability classification;
8. never prints fixture ID, message ID, SSE ID, API token, guest JWT, raw provider payload, or proof material.

Default bounded window: 180 minutes. Override with `TXLINE_LATEST_MATCH_WINDOW_MINUTES`, maximum 350 minutes to remain under the existing 72-bucket safety bound.

## Current integration priorities

1. Run the latest historical fixture probe against mainnet.
2. If trusted score states are available, feed that fixture into a private curated export without exposing its provider identifier.
3. If full history is empty but buckets or snapshots contain trusted states, retain the documented partial-coverage disclosure.
4. If all documented score routes are empty, record the provider availability boundary rather than fabricating events.
5. Add historical five-minute odds buckets only if point-in-time odds snapshots are insufficient for the selected fixture.
