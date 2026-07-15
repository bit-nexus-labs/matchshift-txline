# Security policy

## Supported version

The current `main` branch is the supported hackathon version.

## Private reporting

Do not post sensitive values or exploit details in a public issue. Report a suspected vulnerability privately to the repository owner and include the affected commit, component, minimal synthetic reproduction, and expected versus actual behavior.

## Core invariants

### Spoiler isolation

A session response must not include trusted match information later than its effective visibility cursor.

High-priority reports include any delayed-session exposure of a future score, event, probability update, explanation, record identifier, or receipt derived from a future state.

### Server-only configuration

Provider authorization values remain on the server and must not appear in browser code, public API responses, logs, screenshots, commits, or CI artifacts.

### Provider payload boundary

The public API does not expose the complete provider record collection. Tests use synthetic schema-compatible values.

## Existing controls

- fixed official TxLINE hosts selected by network;
- server-only authorization handling and redaction;
- bounded retry behavior for authorization failures;
- snapshot-before-stream requirement;
- independent score and odds ordering domains;
- fail-closed score-gap recovery;
- restrictive Content Security Policy on the judge page;
- no external page assets;
- non-root production container;
- CI typecheck, tests, build, container build, and health smoke test.

## MVP limitations

The hackathon MVP does not yet provide multi-user authentication, rate limiting, persistent encrypted storage, distributed session coordination, provider signature validation, or production incident alerting.

The public demo is a synthetic comparison console and should not be represented as a production multi-tenant security boundary.

## Response procedure

When sensitive configuration may have been exposed:

1. invalidate and replace it immediately;
2. remove it from current files;
3. review history, CI logs, artifacts, forks, and caches;
4. rerun repository scans and CI;
5. record the incident privately.

Removing a value only from the latest commit is not sufficient.
