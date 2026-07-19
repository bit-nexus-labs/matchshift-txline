# TxLINE live odds transport evidence

This document records a privacy-safe authenticated transport check completed against TxLINE mainnet. It does not publish provider data and does not claim that every received market passes MatchShift's narrower product semantic normalizer.

## Result

On July 19, 2026, the transport-only observer completed with `PASS` against commit `5dc070df77609fc4dfa58474bb9e460aae3eede4`.

The private receipt recorded:

- network: mainnet;
- one SSE connection established;
- one non-heartbeat data frame observed;
- a structurally valid odds event received;
- raw provider payload logged: `NO`;
- raw provider payload persisted: `NO`;
- TxLINE data published: `NO`.

The receipt remains private. No API token, guest JWT, fixture identifier, team name, score, odds, probability value, provider timestamp, raw SSE body, or provider-derived replay data is included here.

## Evidence boundary

This `PASS` proves that authenticated TxLINE mainnet `/api/odds/stream` transport delivered a structurally valid non-heartbeat odds event.

It does **not** claim that:

- the event belonged to a specific fixture;
- the event represented a goal or score change;
- the event passed MatchShift's full-match winner semantic normalizer;
- literal normalized score SSE was observed;
- a normalized live snapshot change was observed;
- the private provider payload may be redistributed.

Historical authenticated TxLINE integration and Solana subscription provenance were already verified separately. The public judge demo remains deterministic, synthetic, credential-free, and independent of live coverage.
