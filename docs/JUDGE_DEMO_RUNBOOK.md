# MatchShift judge demo runbook

Target duration: 60–90 seconds.

## Public judge URL

- App: https://matchshift-txline.onrender.com
- Health: https://matchshift-txline.onrender.com/health

## Before recording or judging

1. Open the public HTTPS URL in a private/incognito window.
2. Confirm no login, wallet prompt, cookie wall, or setup wizard appears.
3. Confirm the top-right source label says the synthetic judge replay is ready.
4. Keep browser zoom at 100% and use a viewport at least 1280 pixels wide when possible.
5. Start from a fresh page load.
6. Confirm `/health` returns `{"status":"ok"}` before recording.

The narration may be recorded in Ukrainian with accurate English subtitles. Keep all visible labels, title cards, and submission text in English.

## Demo sequence

### 0–10 seconds — problem and promise

Show the landing statement:

> Watch on your time. Not the internet's.

Say:

> MatchShift gives every delayed viewer a personal match timeline. The server reveals only what existed at that viewer's own playback minute.

### 10–25 seconds — create isolated viewers

Press **Start spoiler-safe demo**.

Point out:

- Viewer A is at the live edge.
- Viewer B starts at minute 43.
- Viewer A sees `1-0` and the post-goal probabilities.
- Viewer B still sees `0-0`, no goal, and the earlier probabilities.

Say:

> These are two independent server sessions. The delayed response does not contain the future goal or the later odds update.

### 25–45 seconds — reveal in exact order

Move the personal cursor to minute `49:00`.

Point out:

- the goal appears;
- the score changes to `1-0`;
- probabilities remain at their pre-goal values.

Move the cursor to `49:10`.

Point out:

- only now do the post-goal probabilities appear.

Say:

> Score and market context unlock at their own source timestamps. Nothing is guessed or hidden with CSS.

### 45–60 seconds — controls and architecture

Briefly press **Pause**, **Resume**, or **Catch up to live**.

Scroll just enough to show the architecture row:

```text
Ingest → Normalize → Buffer → Per-session gate → Explain
```

Say:

> The explanation layer receives only the already-visible state. Unknown ordering or a score gap fails closed until snapshot recovery.

### 60–75 seconds — commercial path and closing

Say:

> MatchShift can be licensed as a white-label B2B API and SDK for streaming and sports-media platforms, through recurring platform licensing plus usage-based pricing. The judge path remains deterministic and free.

## Judge self-service flow

A judge should be able to complete the proof without narration:

1. Press **Start spoiler-safe demo**.
2. Compare Viewer A and Viewer B.
3. Drag Viewer B from minute 43 to minute 49.
4. Move ten seconds further.
5. Press **Reset demo** and repeat.

## Recording checklist

- Keep the cursor visible while moving between `43:00`, `49:00`, and `49:10`.
- Avoid showing browser bookmarks, personal tabs, accounts, tokens, or Render configuration.
- Capture the public URL at least once.
- Include English subtitles when narration is not in English.
- Include the concise B2B customer, product, and revenue-model sentence.
- Export a readable 1080p video when possible.
- Verify the uploaded video from a logged-out or private browser window.

## Failure recovery

If the page is stale or a control fails:

1. reload the page;
2. press **Start spoiler-safe demo** again;
3. verify `/health` separately;
4. use the last known-good deployment if the health endpoint fails.

Do not enter credentials, connect a wallet, or switch the public judge deployment to TxLINE devnet/mainnet during evaluation.
