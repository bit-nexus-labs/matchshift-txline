# MatchShift documentation

## Product and architecture

- [Architecture](ARCHITECTURE.md) — data flow, ordering domains, session state machine, trust boundaries, and deployment model.
- [Product update](PRODUCT_UPDATE_2026-07-21.md) — post-submission Spain vs Argentina rich replay, visual walkthrough, public route, and refinement evidence.
- [Visibility receipts](VISIBILITY_RECEIPTS.md) — deterministic spoiler-safe state fingerprints and explicit non-proof claims.
- [TxLINE Phantom activation](TXLINE_PHANTOM_ACTIVATION.md) — localhost-only free-tier subscription and API-token activation with Phantom.
- [TxLINE integration smoke](TXLINE_INTEGRATION_SMOKE.md) — local authenticated historical evidence path, redacted receipt rules, and proof boundaries.
- [TxLINE Solana provenance](TXLINE_SOLANA_PROVENANCE.md) — public subscription-transaction verification without a private key or API-token linkage claim.
- [TxLINE live observer](TXLINE_LIVE_OBSERVER.md) — literal SSE data-record evidence that rejects heartbeat-only connections.
- [TxLINE live transport evidence](TXLINE_LIVE_TRANSPORT_EVIDENCE.md) — privacy-safe authenticated mainnet odds SSE transport `PASS` and its explicit non-semantic boundary.
- [TxLINE curated real replay](TXLINE_CURATED_REAL_REPLAY.md) — one completed authenticated fixture converted into an allowlisted MatchShift replay module without provider identifiers or raw payloads.
- [TxLINE endpoints and feedback](TXLINE_ENDPOINTS_AND_FEEDBACK.md) — exact HTTP surfaces used and specific developer-experience feedback from the integration.
- [Windows evidence runner](TXLINE_EVIDENCE_WINDOWS.md) — one safe PowerShell workflow for the three manual evidence commands.

## Judge and deployment

- [Judge demo runbook](JUDGE_DEMO_RUNBOOK.md) — 60–90 second walkthrough and self-service evaluation path.
- [Deployment runbook](DEPLOYMENT.md) — container verification, generic hosting settings, smoke tests, and rollback.
- [Submission draft](SUBMISSION_DRAFT.md) — project description, differentiation, TxLINE integration, limitations, and pitch copy.

## Governance and compliance

- [Human authorship](HUMAN_AUTHORSHIP.md) — participant control, AI-assisted implementation boundaries, and final human gate.
- [Compliance checklist](COMPLIANCE_CHECKLIST.md) — judge access, branding, data handling, secrets, originality, video, and final submission checks.
- [Test evidence](TEST_EVIDENCE.md) — reviewed milestone chain and automated verification coverage.
- [Security policy](../SECURITY.md) — spoiler isolation, server-only configuration, reporting, controls, and MVP limitations.

## Source of truth

The repository `main` branch, pull-request history, and GitHub Actions logs are the technical source of truth. Documentation must distinguish transport evidence, semantic normalization, public demo behavior, provider signatures, and on-chain proofs rather than combining them into one claim.
