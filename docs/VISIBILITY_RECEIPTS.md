# MatchShift visibility receipts

A visibility receipt is a deterministic SHA-256 fingerprint of one already-derived spoiler-safe session state.

It answers:

> Did this exact session state change when the viewer cursor, visible score, visible events, visible probabilities, explanation, or safety status changed?

It does **not** claim to be:

- a TxLINE provider signature;
- an on-chain proof;
- a settlement proof;
- proof that the underlying provider data was objectively correct;
- proof of wall-clock delivery latency.

## Endpoint

```http
GET /api/sessions/:sessionId/receipt
```

Example response:

```json
{
  "receipt": {
    "version": "matchshift-receipt-v1",
    "fixtureId": "synthetic-matchshift-001",
    "sessionId": "<session id>",
    "provenance": "SYNTHETIC",
    "mode": "DELAYED",
    "visibilityCursor": 1784140980000,
    "viewerMinute": 43,
    "visibleEventCount": 1,
    "score": {
      "home": 0,
      "away": 0
    },
    "safetyActive": false,
    "stateHash": "sha256:<64 hex characters>"
  },
  "note": "Deterministic state receipt; not a provider signature or on-chain proof."
}
```

The receipt intentionally excludes the raw match record collection. A delayed receipt therefore cannot reveal future event identifiers or future odds values.

## Canonical payload

The hash covers a fixed JSON structure containing only the already-visible state:

- receipt version;
- fixture and source metadata;
- session ID, mode, status badge, cursor, and viewer minute;
- visible score;
- visible events;
- visible implied probabilities;
- visible explanation;
- safety status.

There is no generation timestamp in the canonical payload, so repeating the request for an unchanged session produces the same receipt.

## Demo use

1. Start the judge demo.
2. Request Viewer B's receipt at minute 43.
3. Request it again without moving the cursor: the hash remains unchanged.
4. Advance Viewer B to minute 49: the score/event state changes and so does the hash.
5. Advance to minute 49:10: the probability state changes and the hash changes again.

This gives reviewers a compact audit artifact without exposing data beyond the viewer's personal spoiler boundary.
