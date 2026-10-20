# Deferred Review Items

Open follow-ups from PR reviews and user feedback. Completed items are removed; check git history for what was resolved.

Last full code review: against `master` after the D-5 / API hardening / CSS / client cleanup PRs. Item IDs (D-n) are kept stable so older PR discussion still maps.

## Accepted risks and decisions

### D-13 — Snapshot read-modify-write race

- **Where:** `handler()` POST → `fetchBlobScores()` then `uploadBlobScores()`.
- **Status:** accepted at current traffic. Two overlapping submissions both read snapshot S(n) and each writes its own S(n+1); the later timestamp wins and the other entry is lost.
- **If volume grows:** per-submission blobs merged on read, or conditional writes (ETag / `ifMatch`) with retry.

### D-14 — Blob API version pinned to 7

- **Where:** `x-api-version: "7"` in four places in `api/scores.js`.
- **Status:** needs verification against live credentials, so it can't be done safely from CI alone. Do it deliberately with the production token.

### D-19 — `createGameState()` accepts three call shapes

- **Status:** left as is. The app only uses `(states, null, { mode })`, but unit tests deliberately exercise the other shapes; simplifying means rewriting those tests for no user-visible gain.

### D-21 — Startup fetch in Practice mode

- **Status:** intentional (makes switching back to Challenge instant). Revisit only if request volume matters.

### D-23 — Duplicate leaderboard close controls

- **Where:** `index.html` (`#close-leaderboard-top-btn` and `#close-leaderboard-btn`).
- **Status:** kept. The top button is the sticky one that stays reachable on mobile; the bottom one matches the other dialog. Drop one only if you want a single control.

### D-27 (remaining) — Leaderboard day vs. displayed date

- The leaderboard day resets at midnight US Central, while dates display in the viewer's local time, so a player in another time zone can see an unexpected date. The duplicated day-key logic is now covered by a parity test.
- **Optional:** label the leaderboard "resets midnight CT".
