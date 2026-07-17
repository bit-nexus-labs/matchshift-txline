# Hackathon compliance checklist

This checklist is a project-control aid, not legal advice. Reconfirm it against the current official hackathon terms before final submission.

## Participant and submission

- [ ] The final submitter is an eligible natural person aged 18 or older.
- [ ] The human participant remains the project leader and final decision-maker.
- [ ] The project is submitted from the participant's official hackathon account.
- [ ] The public description accurately identifies AI-assisted work without presenting an AI system as the participant.
- [ ] Team size, if applicable, remains within the official limit.

## Judge access

- [x] The guaranteed judge path requires no purchase.
- [x] The guaranteed judge path requires no subscription.
- [x] The guaranteed judge path requires no token or cryptocurrency.
- [x] The guaranteed judge path requires no wallet connection.
- [x] The guaranteed judge path requires no message or transaction signature.
- [x] The guaranteed judge path requires no external account or login.
- [x] The synthetic judge path is deterministic and does not depend on live fixture coverage.
- [x] A public HTTPS demo URL is added before submission.
- [x] The public URL is tested end to end in an incognito/private browser.

## Branding and claims

- [x] No FIFA name, logo, trophy, marks, or implied affiliation is used.
- [x] Synthetic teams are fictional and clearly presented as replay/demo data.
- [x] The README distinguishes synthetic, mocked, optional transport, authenticated private evidence, and not-yet-observed literal live SSE behavior.
- [x] Visibility receipts are described as deterministic state hashes, not provider signatures or on-chain proofs.
- [ ] The final video repeats the synthetic/mock/private-evidence/live distinctions accurately.
- [ ] Submission screenshots contain no restricted branding.

## Commercial path

- [x] The submission identifies the initial paying customers: streaming, broadcasting, sports-media, and fan-platform operators.
- [x] The product is stated as a white-label B2B API/SDK rather than an unsupported traction claim.
- [x] The planned revenue model states recurring platform licensing plus usage-based pricing.
- [x] A later optional direct-to-consumer premium path is distinguished from the free judge experience.
- [ ] The final video repeats the customer, product, and revenue model in one concise statement.

## TxLINE data handling

- [x] No raw TxLINE payload export is committed.
- [x] No raw Discord or Telegram export is committed.
- [x] No public replay dataset derived from provider data is committed.
- [x] Tests use synthetic values in documented schema-compatible shapes.
- [x] The public judge demo uses deterministic synthetic records.
- [x] Optional TxLINE credentials remain server-side.
- [x] API tokens and guest JWTs are redacted from errors and status responses.
- [x] Authenticated historical integration and subscription provenance evidence were collected privately without publishing raw provider payloads.
- [x] Literal live SSE is recorded as `NOT OBSERVED`, not misrepresented as `PASS`.
- [ ] Data-license obligations are reviewed again before and after the hackathon concludes.

## Secrets and private code

- [x] No wallet seed, keypair, private key, API token, JWT, RPC secret, or exchange credential is committed.
- [x] No private trading-bot source is copied into this repository.
- [x] `.env` files are excluded; `.env.example` contains placeholders only.
- [x] CI requires no secrets and makes no real TxLINE calls.
- [x] Container smoke tests run in synthetic mode.
- [ ] Run one final high-confidence secret scan on the submission commit.

## Originality and attribution

- [x] MatchShift-specific code was developed in the hackathon repository.
- [x] Official TxLINE documentation and the official `txodds/tx-on-chain` examples are the integration references.
- [x] No competitor repository code is copied.
- [x] No unsupported community CLI is included.
- [ ] Any future third-party asset, library, or code sample is listed with its license and attribution.

## Repository and build

- [x] Work is developed on feature branches and merged through pull requests.
- [x] GitHub Actions runs frozen install, typecheck, tests, and build.
- [x] GitHub Actions builds the production Docker image and smoke-tests `/health`.
- [x] The public server defaults to `TXLINE_MODE=synthetic`.
- [x] The runtime uses a non-root container user.
- [ ] The deployed commit SHA is recorded in the submission notes.
- [ ] The final public URL points to the same reviewed commit or container image.

## Demo and video

- [x] A judge demo runbook exists.
- [x] A 60–90 second narration sequence exists.
- [x] The UI demonstrates live versus delayed sessions side by side.
- [x] The 49:00 goal and 49:10 probability update reveal separately.
- [x] Pause, resume, advance, catch-up, and reset are available.
- [ ] Record a video no longer than the official maximum duration.
- [ ] Verify voiceover and cursor movement match the visible UI.
- [ ] Add the video URL to the repository and submission.

## Final human gate

The human participant must personally approve these items before submission:

- [ ] project title and track;
- [ ] public demo URL;
- [ ] final video;
- [ ] repository URL and submission text;
- [ ] declarations about originality, eligibility, and rules;
- [ ] final submission action.
