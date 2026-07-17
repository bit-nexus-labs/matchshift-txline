# MatchShift documentation

## Product and architecture

- [Architecture](ARCHITECTURE.md) — data flow, ordering domains, session state machine, trust boundaries, and deployment model.
- [Visibility receipts](VISIBILITY_RECEIPTS.md) — deterministic spoiler-safe state fingerprints and explicit non-proof claims.
- [TxLINE integration smoke](TXLINE_INTEGRATION_SMOKE.md) — local authenticated historical evidence path, redacted receipt rules, and proof boundaries.
- [TxLINE Solana provenance](TXLINE_SOLANA_PROVENANCE.md) — public subscription-transaction verification without a private key or API-token linkage claim.

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

The repository `main` branch, pull-request history, and GitHub Actions logs are the technical source of truth. Documentation must not claim a public deployment, live TxLINE smoke test, provider signature, or on-chain proof until that evidence actually exists.
