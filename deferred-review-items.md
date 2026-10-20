# Deferred Review Items

Open follow-ups from PR reviews and user feedback. Completed items are removed; check git history for what was resolved.

Last full code review: against `master` at `956e639` (after PR #8 issue #6 fix and PR #9 daily reset). Each item below was checked against the current code; priority reflects user impact and risk, highest first. Item IDs (D-n) are kept stable so older PR discussion still maps.

## P2 — Data integrity and abuse (`api/scores.js`)

### D-5 — No rate limiting or origin check on POST

- **Where:** `handler()` POST branch.
- **Confirmed:** no `Origin`/`Referer` check and no throttling. `validateScoreEntry()` bounds the fields but cannot verify a game was played, so anyone can POST `score: 50` repeatedly and fill the daily Top 10.
- **Do:** reject cross-origin POSTs (compare `Origin` to the deployment host). Prefer a Vercel Firewall rate-limit rule over an in-memory token bucket, since serverless instances don't share memory.

### D-13 — Snapshot read-modify-write race

- **Where:** `handler()` POST → `fetchBlobScores()` then `uploadBlobScores()`.
- **Confirmed:** two overlapping submissions both read snapshot S(n) and each writes its own S(n+1); the later timestamp wins and the other entry is lost. The client still shows "Saved!" for the lost one.
- **Do:** accept at low traffic, or move to per-submission blobs merged on read, or conditional writes (ETag / `ifMatch`) with retry.

### D-24 (new) — Blob listing is a single page of 50

- **Where:** `fetchBlobScores()` and the prune step in `uploadBlobScores()` both call `list?limit=50&prefix=scores` with no cursor.
- **Risk:** pruning only warns on failure, so snapshots can accumulate. If more than 50 exist and the first page isn't the newest, reads silently serve a stale leaderboard. I could not confirm the list ordering from the code alone.
- **Do:** verify list ordering against the live API; follow `cursor`/`hasMore` or fail with 502 when `hasMore` is true.

### D-25 (new) — Retry after a lost response can duplicate a score

- **Where:** `handleSaveScore()` / `handler()`.
- **Confirmed:** the client reuses `activePendingScore.id` on Retry, but the server ignores it and mints its own `id`, so if the POST succeeded but the response was lost, Retry adds a second entry.
- **Do:** accept a client-supplied idempotency id (validated format) and skip the insert if it already exists.

### D-8 — Locally saved scores are dropped on next load

- **Where:** `fetchScores()`.
- **Confirmed:** when the server response has an explicit `topScores`, it fully replaces local scores, so a score that failed to upload is overwritten. Today's filter makes this slightly less likely but not gone.
- **Do:** merge local and server scores by `id` (today only), then re-sort and cap at 10. Consider retrying the upload of unsynced local entries.

## P3 — Robustness and low-risk hardening

### D-4 — `parseBody()` size limit (low impact)

- **Where:** `parseBody()`.
- **Confirmed:** the stream branch keeps accumulating after 16 KB.
- **Context:** Vercel pre-parses JSON into `req.body`, so the object branch (no size check) is the normal path, and the stream branch rarely runs. Real-world impact is low because `validateScoreEntry()` returns only whitelisted fields.
- **Do:** destroy the stream on overflow, and check `content-length` up front.

### D-14 — Blob API version pinned to 7

- **Where:** `x-api-version: "7"` in four places in `api/scores.js`.
- **Do:** modernize and verify against live credentials. Requires production verification, so do it deliberately.

### D-6 — `isTopScore()` is never called

- **Where:** `api/scores.js`.
- **Confirmed:** exported and tested but unused; the handler always rewrites a snapshot. Daily reset makes it simpler to apply (check against today's scores only).
- **Do:** call it in POST to skip the blob write for non-qualifying scores, or delete it.

### D-17 — Backdrop dismissal ignores where the press started

- **Where:** `click` listeners on `#game-over-modal` and `#leaderboard-modal`.
- **Confirmed:** only `e.target === dialog` is checked, so a drag from inside the card released on the backdrop closes the dialog.
- **Do:** record `pointerdown` target and require both to be the dialog.

### D-22 — `render()` shows the game-over dialog without clearing `hidden`

- **Where:** `render()` completed branch (`showModal()` / `close()`).
- **Confirmed:** `startNewGame()` sets `hidden` on both dialogs, and `render()` calls `showModal()` without removing it. It works today only because `openGameOverModalUI()` removes `hidden` right afterwards; any future caller of `render()` on a completed game would show an invisible dialog.
- **Do:** route all open/close through shared helpers.

### D-26 (new) — Score of 0 can be saved to the leaderboard

- **Where:** `qualifiesForTop10()` in `app.js`; `validateScoreEntry()` allows `score >= 0`.
- **Confirmed:** while fewer than 10 scores exist for the day, a 0-point 3-strike loss is offered the save form.
- **Do:** require `score > 0` on both client and server (decide intended behavior first).

## P4 — Cleanup and polish

### D-18 — Dead and duplicate CSS

- **Where:** `style.css`.
- **Confirmed:** `.mode-btn[aria-pressed="true"]` selectors (lines ~204-211) are dead since mode buttons use `aria-checked`. The `[hidden]` rule in `@layer base` duplicates `reset.css`.
- **Note:** keep `.icon-btn[aria-pressed]`; the sound toggle uses it.

### D-16 — Component rules in `@layer utilities`

- **Where:** `@media (max-width: 640px)` block in `style.css` (~line 929).
- **Confirmed:** component overrides sit in `utilities`. Only `.sr-only` and reduced-motion belong there.
- **Do:** move into `@layer components`. Check cascade order carefully with e2e layout tests.

### D-19 — `createGameState()` accepts three call shapes

- **Where:** `createGameState()`.
- **Confirmed:** the app uses only `(states, null, { mode })`. Unit tests deliberately exercise the string and options-in-second-argument forms (`tests/app.test.js` ~265-283), so simplifying means updating those tests.

### D-20 — Mode-specific labels set from JS

- **Where:** `render()`.
- **Confirmed:** `bestLabel.textContent = "Best"` is a no-op in both modes; the `.final-stat-label` texts are rewritten each render; `strikes-count` shows `0 / 3` in Practice while its card is hidden (harmless).
- **Do:** drive labels from `data-mode` markup/CSS, or delete the no-op.

### D-27 (new) — Duplicated day-key logic

- **Where:** `LEADERBOARD_TIMEZONE`, `getDayKey()`, `filterTodayScores()`, `mergeUniqueNames()` exist in both `app.js` and `api/scores.js` (no shared module is possible without a build step or ES modules).
- **Risk:** the two copies can drift. Also, the leaderboard day is US Central while dates display in the viewer's local time, so a player in another time zone can see an unexpected date.
- **Do:** keep a unit test asserting parity; optionally label the leaderboard "resets midnight CT".

### D-23 — Duplicate leaderboard close controls

- **Where:** `index.html` (`#close-leaderboard-top-btn` and `#close-leaderboard-btn`).
- **Decision needed:** keep both (mobile reach vs. consistency) or drop one.

### D-21 — Startup fetch in Practice mode

- **Confirmed intentional** (instant switch back to Challenge). Revisit only if request volume matters.

## Verified fixed (remove on next cleanup)

- **Issue #6 / D-10:** `formatLocalDate()` replaced the `slice(0, 10)` date; `gameState.scoreSaved` hides the save form after a successful save.
