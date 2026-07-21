# MatchShift product update — Spain vs Argentina rich replay

**Update date:** July 21, 2026  
**Track:** Consumer & Fan Experiences by TxODDS  
**Live app:** https://matchshift-txline.onrender.com

## Transparency note

The original hackathon submission already contained the working spoiler-safe timeline core, public deployment, TxLINE integration, synthetic judge path, and narrated demo video.

This document describes **post-submission product refinements** made to the same public repository and deployment. The refinements improve the completed-match experience; they do not replace or conceal the original submission history.

## 1. Start with the guaranteed judge path

Open the live app and select **Start synthetic judge demo**.

The server creates two isolated sessions for one match:

- **Live edge** receives the score, events, odds context, statistics, and explanation visible at the live cursor.
- **Personal timeline** starts earlier and receives no future goal, future odds state, or future event identifiers.

Move the personal cursor toward minute 49. The goal becomes visible only when its timestamp is reached; the updated probabilities unlock ten seconds later.

## 2. Open the real completed-match replay

Select **Start curated real-match replay** to load Spain vs Argentina.

The public product model contains:

- 206 lifecycle-clean football events;
- 15 normalized historical 1X2 probability states;
- kickoff, periods, extra time, VAR outcomes, cards, shots, corners, substitutions, injuries, one confirmed Spain goal, and match finalisation;
- two trusted score recoveries, beginning at 0-0 and ending at 1-0.

The public replay contains only sanitized product fields. Raw TxLINE payloads, API tokens, JWTs, provider fixture/message/SSE/action identifiers, player identifiers, and private receipt material are excluded.

## 3. Follow the replay without losing the score

After a scenario starts, a sticky replay controller stays in view while the page scrolls.

It keeps these values together:

- personal replay cursor;
- score visible to that viewer;
- final or live-edge score;
- latest visible event;
- rewind, advance, pause, resume, catch-up, and restart controls.

This makes cursor movement immediately understandable: the viewer can see when the score changes without scrolling back to the scorecard.

## 4. Choose the right event density

The default view is **Key events**, which keeps the main replay compact.

- **Key events** — decisive periods, goals, VAR outcomes, discipline, and finalisation.
- **Highlights** — key events plus shots on target, substitutions, and injuries.
- **Full timeline** — all 206 sanitized events for technical review and deeper exploration.

The complete dataset remains available, but routine match flow no longer dominates the default experience.

## 5. Read historical probabilities honestly

Each probability state is still gated by the viewer's cursor.

A score-only recovery no longer clears the most recent visible odds snapshot. After match finalisation, the interface changes the label from **Visible probabilities** to **Last available market snapshot** and shows its timestamp.

The final panel explicitly states that the value is a historical market snapshot, not a final prediction. MatchShift does not invent a post-goal or post-final probability state when the source timeline does not contain one.

## 6. Server-side spoiler boundary

MatchShift does not download the full match and hide future information in the browser.

The server pipeline is:

1. **Ingest** — TxLINE or deterministic replay.
2. **Normalize** — sanitized score, event, and odds records.
3. **Buffer** — append-only source timeline.
4. **Gate** — per-session visibility cursor.
5. **Explain** — visible state only.

Every response is rebuilt from records at or before that session's effective cursor. Future records are absent from the API response itself.

## Evidence

- Rich completed-match replay: [PR #67](https://github.com/bit-nexus-labs/matchshift-txline/pull/67)
- Sticky controls and final odds context: [PR #68](https://github.com/bit-nexus-labs/matchshift-txline/pull/68)
- Public repository: https://github.com/bit-nexus-labs/matchshift-txline
- Live deployment: https://matchshift-txline.onrender.com

## Suggested two-minute review path

1. Start the curated Spain vs Argentina replay.
2. Confirm that **Key events** is selected.
3. Move the cursor toward the 106th minute and watch the sticky score update.
4. Switch briefly to **Highlights**, then **Full timeline**.
5. Catch up to the final state and review **Last available market snapshot**.
6. Scroll below the replay to inspect the server-side boundary and five-stage architecture.
