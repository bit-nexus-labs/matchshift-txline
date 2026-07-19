# TxLINE curated completed-match replay

This workflow converts one completed TxLINE fixture into a reviewable MatchShift replay module. It is intentionally a single curated product demonstration, not a general historical-data mirror, downloadable feed, or public fixture browser.

## Intended hackathon use

The first target is the completed France versus England fixture from July 18, 2026 UTC. The exporter can also accept an explicit fixture identifier, but the generated public module always replaces provider identifiers with one local MatchShift fixture identifier.

The resulting replay can demonstrate the product's core behavior on authenticated historical input:

- a viewer begins at the fixture kickoff cursor;
- the visible score and events advance only when the personal cursor reaches them;
- sampled full-match winner probabilities, when supported, are revealed on the same cursor boundary;
- future score and odds context remain unavailable to the delayed viewer.

## Data boundary

The authenticated runner processes TxLINE payloads only in memory. It writes exactly two files:

1. `src/replay/curated-real-match.ts` — an allowlisted MatchShift `MatchDefinition` containing the public label, local fixture identifier, normalized score/event records, supported normalized probabilities, and local deterministic ordering metadata;
2. `artifacts/private/txline-curated-replay-export-receipt.md` — a status-only private receipt.

The generated module does not contain:

- the provider fixture identifier;
- provider message or SSE event identifiers;
- provider payload identities;
- raw JSON or raw SSE bodies;
- API tokens or guest JWTs;
- a generic export/download endpoint.

Real team names, rendered match state, goal events, and normalized probabilities are included only because this is a single curated product demonstration. Do not turn the generated artifact into a reusable TxODDS archive or public data API.

## Windows runner

From the repository root:

```powershell
.\scripts\run-txline-curated-replay-export.ps1
```

Defaults:

- network: `mainnet`;
- participants: `France` and `England`;
- fixture UTC date: `2026-07-18`;
- public fixture identifier: `curated-france-england-2026-07-18`;
- replay duration: 120 minutes;
- odds snapshot sampling: every 10 minutes plus score-record boundaries;
- generated module: `src/replay/curated-real-match.ts`.

If participant matching is unavailable or ambiguous, rerun with the exact private fixture identifier:

```powershell
.\scripts\run-txline-curated-replay-export.ps1 -FixtureId "<private fixture id>"
```

The fixture identifier is used only for authenticated retrieval and is not copied into the generated module.

## Validation before publication

After a successful export:

```powershell
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Review the diff of `src/replay/curated-real-match.ts`. It should contain only the documented MatchShift model. Never commit the private receipt.

## Evidence semantics

A successful export can support this claim only after the generated replay also passes the normal CI and browser flow:

> One completed fixture was reconstructed from authenticated TxLINE historical input into a curated MatchShift replay. Future score, event, and supported odds context remained gated by each viewer's personal playback cursor.

It does not claim continuous live ingestion, automatic coverage of every fixture, or redistribution of the TxLINE feed.
