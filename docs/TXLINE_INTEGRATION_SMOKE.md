# TxLINE integration smoke

MatchShift keeps the public judge demo deterministic and synthetic. The manual integration smoke is a separate backend-only evidence path that exercises authenticated TxLINE data without exposing provider payloads or credentials.

## Current scope

The command below performs the historical integration slice:

```bash
pnpm txline:smoke
```

It:

1. obtains the guest JWT through the existing TxLINE credential flow;
2. finds an eligible completed fixture between six hours and two weeks in the past, or uses `TXLINE_FIXTURE_ID` when supplied;
3. fetches full historical score updates;
4. fetches odds snapshots with `asOf` at two historical timestamps;
5. validates and normalizes the official fixture, score, and odds shapes with the production MatchShift normalizers;
6. creates early and live viewer sessions;
7. asserts that the early session contains no future event identifiers and no records beyond its visibility cursor;
8. writes an allowlist-only local receipt.

The command is intentionally excluded from GitHub Actions because CI has no TxLINE credentials and must never contact the provider.

## Local configuration

Set values only in the current terminal session or an ignored local `.env` workflow. Never commit them.

```text
TXLINE_NETWORK=mainnet
TXLINE_API_TOKEN=<server-only token>
TXLINE_FIXTURE_ID=<optional manual fixture override>
TXLINE_COMPETITION_ID=<optional competition filter>
TXLINE_SMOKE_RECEIPT_PATH=artifacts/private/txline-smoke-receipt.md
```

`TXLINE_NETWORK` must be `devnet` or `mainnet`. The network selects a fixed host in code; custom hosts are not accepted.

## Output and data handling

Successful console output is limited to:

```text
TXLINE HISTORICAL SMOKE: PASS
Receipt written: artifacts/private/txline-smoke-receipt.md
```

The receipt may contain only high-level PASS/NOT RUN statuses, network, commit SHA, and UTC verification time. It must not contain fixture identifiers, participant names, scores, odds values, bookmaker information, API tokens, guest JWTs, wallet secrets, URLs, or raw JSON.

Raw TxLINE responses are processed in memory and are not logged or persisted. `artifacts/private/` is ignored by Git.

## Evidence boundaries

A historical PASS proves authenticated API access, official-shape normalization, and spoiler-safe session isolation on real TxLINE input. It does not by itself prove that a live stream emitted a data record, and it does not prove Solana subscription provenance. Those remain separate evidence tasks and therefore appear as `NOT RUN` until independently verified.

Do not publish a `TxLINE adapter verified` badge or public receipt until a human has completed the real local run and reviewed the generated receipt.
