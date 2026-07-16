# MatchShift public deployment receipt — 2026-07-16

## Public deployment

- App: https://matchshift-txline.onrender.com
- Health: https://matchshift-txline.onrender.com/health
- Platform: Render Web Service
- Runtime: repository Dockerfile with Node.js 22
- Mode: `TXLINE_MODE=synthetic`
- Health path: `/health`
- Deployed source commit: `55ffa7cf6a398f50b466dd5be9fa8d9db59bac22`

Render completed the Docker build and reported the service live. The public health endpoint returned `{"status":"ok"}`.

## Human browser smoke observed

1. A fresh page load showed the waiting state.
2. **Start spoiler-safe demo** created two isolated server-side sessions.
3. Viewer A showed minute 52, score `1-0`, the minute-49 goal, and post-goal probabilities.
4. Viewer B started at minute 43, score `0-0`, no future goal, and pre-goal probabilities.
5. Moving the personal cursor changed only Viewer B.
6. Reloading and starting again restored the deterministic minute-43 initial state.

## Remaining checks before submission

- Repeat the flow in a private/incognito window.
- Check a mobile-width viewport.
- Verify a cold start after the free service sleeps.
- Activate the external keep-awake HTTP check on submission day.
- Add the final demo-video URL.
- Record the final submission commit after documentation polish is merged.
