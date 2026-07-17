# MatchShift public deployment receipt — initial 2026-07-16, verified 2026-07-17

## Public deployment

- App: https://matchshift-txline.onrender.com
- Health: https://matchshift-txline.onrender.com/health
- Platform: Render Web Service
- Runtime: repository Dockerfile with Node.js 22
- Mode: `TXLINE_MODE=synthetic`
- Health path: `/health`
- Initial deployed source commit: `55ffa7cf6a398f50b466dd5be9fa8d9db59bac22`
- Verified live deployment before final documentation polish: `6ee0a0e737dbe05e1920b0a74d7ba862a49ec9db`

Render Events showed **Deploy live** for `6ee0a0e` on July 17, 2026. Render auto-deploys the reviewed `main` branch, so later documentation-only successors may receive a new deployment SHA without changing the demonstrated runtime behavior. The Render Events page is the operational source of truth for the latest deployed commit.

The public health endpoint returned `{"status":"ok"}`.

## Human browser smoke observed

1. A fresh page load showed the waiting state.
2. **Start spoiler-safe demo** created two isolated server-side sessions.
3. Viewer A showed minute 52, score `1-0`, the minute-49 goal, and post-goal probabilities.
4. Viewer B started at minute 43, score `0-0`, no future goal, and pre-goal probabilities.
5. Moving Viewer B to `49:00` revealed the goal while retaining the earlier probabilities.
6. Moving Viewer B to `49:10` revealed the updated probabilities.
7. The complete flow passed in a private/incognito browser window.
8. A free-instance cold start was observed at approximately 20 seconds in practice.

## Remaining checks before submission

- Check a mobile-width viewport.
- Activate or confirm an external keep-awake HTTP check on submission day.
- Add the final demo-video URL.
- Confirm the final Render Events deployment after the last submission commit.
