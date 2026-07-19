# MatchShift test and review evidence

This document records the reviewed milestone chain. GitHub remains the source of truth for exact commits, pull requests, and workflow logs.

## Milestone chain

| Milestone | Pull request | Merge commit | Verification |
| --- | --- | --- | --- |
| Task 01 — spoiler-safe core | `#1` | `83156ed208fe9165b3f5c85a359770b0b120b0e0` | Core sequence, session, derive-state, and API boundary tests |
| Task 02 — TxLINE adapter and official-schema fixes | `#2` | `1620529a77e59a1c01314447acc22b320117f7c4` | Frozen install, typecheck, tests, build |
| Task 03 — judge comparison UI | `#3` | `dd16a128f9aa06c175c0f8a300480826e65465f9` | Frozen install, typecheck, tests, build; embedded page script syntax test |
| Task 04 — deployment readiness | `#4` | `8885d2b99da6995b2e3b639ae5c6455e1e045f63` | Code pipeline plus Docker build and live `/health` smoke test |
| Task 05 — visibility receipts | `#5` | `b56ff5f6076713ca6e45c0829fa6b1722d0ec06c` | Code pipeline, receipt isolation tests, Docker build, live health smoke |
| TxLINE live evidence hardening | `#32` | `5dc070df77609fc4dfa58474bb9e460aae3eede4` | Full-window retries, transport observer, privacy tests, full CI and container health smoke |

## Core spoiler-boundary evidence

Tests verify that:

- a `LIVE` session moved to a past cursor becomes delayed;
- minute-43 state does not contain the minute-49 goal;
- minute-43 state does not contain post-goal probabilities;
- the goal becomes visible at minute 49;
- post-goal probabilities become visible only ten seconds later;
- a missing synthetic prefix or sequence gap enters `SAFE_HOLD`;
- a trusted recovery snapshot restores state without leaking stale explanation text.

## TxLINE adapter evidence

Mocked official-shape tests verify:

- fixed devnet/mainnet host mapping;
- guest JWT acquisition on the selected host;
- both required data-request headers;
- exactly one JWT refresh after `401`;
- hard stop after `403`;
- fragmented SSE parsing, comments, heartbeats, retry hints, event IDs, and multi-line data;
- heartbeat-only state is `IDLE_NO_COVERAGE`, not `LIVE`;
- official odds records normalize without invented `Seq`;
- nested football score totals and event metadata normalize correctly;
- `Participant1IsHome` maps participant-side data to home/away;
- score and odds ordering domains remain independent;
- real score gaps require snapshot recovery;
- exact duplicates are removed while amendments remain;
- configured authorization values do not appear in tested status errors;
- the transport-only observer accepts structurally valid odds events without broadening the product semantic normalizer;
- private transport receipts do not expose fixture IDs, event IDs, credentials, or provider payloads.

## Authenticated private evidence

Explicit local evidence runners completed against TxLINE mainnet:

- historical fixture, score, and supported full-match winner odds integration smoke on July 17, 2026: `PASS`;
- Solana subscription provenance verification using public transaction data on July 17, 2026: `PASS`;
- authenticated `/api/odds/stream` transport on July 19, 2026: `PASS` after a structurally valid non-heartbeat odds event arrived;
- literal normalized live SSE data record: `NOT OBSERVED`;
- normalized live snapshot change: `NOT OBSERVED`.

The transport result is a distinct transport-level proof. It does not claim that the received event passed MatchShift's narrower full-match winner semantic normalizer. `NOT OBSERVED` remains a distinct non-pass outcome rather than a failure or a claimed semantic live proof. The runners wrote private allowlisted receipts. No API token, guest JWT, wallet secret, raw provider payload, fixture identifier, team name, score, odds, or probability value was committed or published.

## Judge UI evidence

Tests verify that:

- `/` serves a self-contained page with security headers;
- the embedded JavaScript is syntactically valid;
- `/api/fixtures` exposes sanitized metadata only;
- `/api/demo/start` creates live and delayed sessions;
- the delayed session starts at minute 43 with `0-0` and pre-goal probabilities;
- the delayed object does not serialize future record identifiers or later probabilities;
- cursor advancement reveals the goal and later odds at separate timestamps.

## Visibility receipt evidence

Tests verify that:

- unchanged visible state produces the same SHA-256 receipt;
- cursor-visible state changes produce a different receipt;
- the delayed receipt contains only summary metadata and a hash;
- delayed receipts do not expose future record identifiers;
- advancing to the goal updates score, visible-event count, and receipt hash.

## Container evidence

The CI container job:

1. builds the production Docker image from the reviewed commit;
2. starts it with `TXLINE_MODE=synthetic`;
3. publishes only the local runner port;
4. polls `GET /health` until success or timeout;
5. stops the container regardless of job outcome.

## Final evidence still required

Before submission, record:

- deployed commit SHA or immutable image reference;
- final demo video URL;
- final submission timestamp and human submitter confirmation.
