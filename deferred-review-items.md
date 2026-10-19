# Deferred Review Items

Findings raised by the automated PR review (MiniMax via OpenCode) that were **not**
fixed in the PR that raised them. Each item lists the PR it came from, why it was
deferred, and what to do about it.

Items are ordered by severity. "Blocker" means the PR should not merge until the
item is resolved or explicitly accepted.

---

## PR #2 — `feat/three-strikes-and-map-only`

Review: follow-up review of commit `8fce9aa` ("fix: address code review findings and
remove state hover tooltips").

### Blockers

#### D-1 — `submitScore()`'s `success` flag is computed but never used; the UI claims a

successful save when the write failed

- **Where:** `app.js` — `submitScore()` returns `{ scores, savedId, success }`, but
  `handleSaveScore()` only reads `result.scores` and `result.savedId`.
- **Impact:** On a network failure or a `502` from `/api/scores`, `submitScore()` falls
  back to `sortScores([...savedScores, scoreEntry])`. The local copy is therefore present
  in the list, `newIdx !== -1`, and the UI shows "Saved!" and announces _"Score saved
  successfully to top 10 leaderboard!"_ — even though nothing reached the server.
  Reproduced: aborting the POST leaves the button on "Saved!" and the live region
  saying "Score saved successfully to top 10 leaderboard!".
- **Why deferred:** Behaviour/UX wording change; needs the author's sign-off on copy.
- **Do:** Use `result.success` to drive the button text and the announcement, and
  re-enable `submitScoreBtn` on failure so the player can retry (it is currently
  disabled permanently after the first submit). Also avoid matching the new row by
  `name` + `score` when `savedId` is missing — that can highlight an unrelated row.

#### D-2 — `x-allow-overwrite` requires a newer Blob API version than the one pinned

- **Where:** `api/scores.js` — `uploadBlobScores()` sends `x-api-version: 7` together
  with `x-add-random-suffix: 0` and `x-allow-overwrite: 1`, and uploads to
  `PUT https://blob.vercel-storage.com/scores.json`.
- **Impact:** Verified against the official `@vercel/blob` SDK:
  - SDK 0.23–0.26 → `BLOB_API_VERSION = 7`, upload is `PUT /<pathname>`, and
    `createPutHeaders()` emits only `contentType`, `addRandomSuffix`,
    `cacheControlMaxAge` — **no `allowOverwrite`**.
  - SDK 1.0.x → `BLOB_API_VERSION = 10`, `x-allow-overwrite` is emitted, and the
    upload became `PUT /?pathname=<path>`.
    The request therefore mixes a v7 request shape with a v10 header. If the pinned v7
    code path ignores the header, the upload still fails with "blob already exists"
    (now correctly surfaced as a `502`) and the leaderboard never persists.
    The SDK also always sends `x-vercel-blob-access: public` and `x-content-type`,
    neither of which this repo sends.
- **Why deferred:** Needs a live store token to confirm the server's behaviour; the
  credential is not available in review.
- **Do:** Verify against the real store, then pin one consistent combination — e.g.
  `x-api-version: 10`+ , `PUT https://vercel.com/api/blob/?pathname=scores.json`,
  `x-vercel-blob-access: public`, `x-content-type: application/json`.

#### D-3 — Read-after-write hits the CDN cache, so scores can be silently lost

- **Where:** `api/scores.js` — `fetchBlobScores()` reads `scoreBlob.url` (the public CDN
  URL), and the POST handler is a read-modify-write (read → merge → `PUT`).
- **Impact:** Vercel's docs ("Important considerations when updating blobs") state that
  after an overwrite _"the changes may take up to 60 seconds to propagate through our
  cache."_ If two players submit inside that window, the second read returns the
  pre-first-write content and the first player's score is erased by the overwrite.
  This was latent while writes were failing; D-2's fix makes it live.
- **Why deferred:** Architectural change (blob layout or read strategy), needs the
  author's decision.
- **Do:** Cache-bust the read (e.g. `?t=${Date.now()}` on the blob URL), or use a
  consistent read, or switch to immutable per-entry blobs plus a listing-based
  leaderboard (the pattern Vercel's own docs recommend).

### Moderate / minor

#### D-4 — The 16 KB body limit is bypassed on Vercel and does not bound memory

- **Where:** `api/scores.js` — `parseBody()`.
- **Impact:** `parseBody()` returns `req.body` first when it is already an object, which
  is what the Vercel Node runtime provides for `application/json`; the limit therefore
  only applies to the string and stream branches. The stream branch also keeps appending
  to `raw` after the limit trips (it only sets a flag), so memory is not bounded.
- **Do:** Apply the size check to the raw body before parsing, and stop accumulating
  (or `req.destroy()`) once the limit is exceeded.

#### D-5 — `POST /api/scores` has no rate limiting and no origin check

- **Where:** `api/scores.js` — `handler()`.
- **Impact:** The endpoint is unauthenticated and publicly writable. The `OPTIONS`
  response omits `Access-Control-Allow-Origin`/`Allow-Headers`, so browser preflights
  fail, but a non-browser client can still post with `Content-Type: text/plain`.
  `validateScoreEntry()` bounds each entry but not the rate, so the leaderboard can be
  spammed.
- **Do:** Add a per-IP token bucket, or at minimum reject requests whose `Origin` does
  not match the deployment.

#### D-6 — `isTopScore()` is exported and unit-tested but never used by the handler

- **Where:** `api/scores.js` — `isTopScore()`.
- **Impact:** Dead code. The POST handler always merges and re-uploads, even when the
  score cannot make the cut.
- **Do:** Use it to skip the write when the score will not qualify, or remove it and
  its tests.

#### D-7 — The game-over dialog is opened from two places with different `hidden` handling

- **Where:** `app.js` — `render()` (the `showModal()` branch) vs `openGameOverModalUI()`.
- **Impact:** `render()` calls `showModal()` without first clearing `hidden`;
  `openGameOverModalUI()` clears it. It works today only because the two run back to
  back. Verified: restarting mid-game sets `hidden` on `#game-over-modal`, and the
  modal is still shown at the end because `openGameOverModalUI()` clears it first.
  The `else` branch in `render()` (setting `hidden`) has the mirror-image asymmetry.
- **Do:** Unify the open/close helpers so the `hidden`/`<dialog>` interaction cannot
  regress.

#### D-8 — `fetchScores()` discards local-only scores

- **Where:** `app.js` — `fetchScores()`.
- **Impact:** `serverScores.length > 0 ? serverScores : localScores` followed by
  `setStoredScores(sorted)` means any locally recorded score that is not on the server
  is deleted from `localStorage` on the next page load. The new fallback only helps
  when the server list is completely empty.
- **Do:** Merge the two lists by `id` rather than choosing one side.

#### D-9 — E2E coverage gaps

- **Where:** `e2e/game.spec.js`.
- **Impact:** The `page.route` mock always returns one score, so
  `qualifiesForTop10()` is always true. The "does not qualify" branch (where
  `#save-score-form` must be hidden) and the network-failure branch (where D-1 lives)
  have no automated regression test. Both were verified manually during review.
- **Do:** Add a test with ten existing scores asserting the form is hidden, and one
  that aborts the POST asserting the correct message and a re-enabled button.

#### D-10 — `renderLeaderboardTable()` slices the date rather than formatting it

- **Where:** `app.js` — `renderLeaderboardTable()`.
- **Impact:** `String(item.date).slice(0, 10)` yields `"1758249600"` for a numeric
  timestamp. The server always writes ISO strings, so this is theoretical.
- **Do:** Use a `formatDate()` helper that handles both.

#### D-11 — `sortScores()` throws on a malformed entry in `localStorage`

- **Where:** `app.js` — `sortScores()` / `initializeApp()`.
- **Impact:** `sortScores()` dereferences `a.score` / `b.score` without a null guard.
  A corrupted `localStorage` value such as `[null]` throws inside `initializeApp()`
  (which is not wrapped in a try/catch) and stops the game from starting at all.
- **Do:** Guard the comparator, or wrap the startup read in a try/catch.

#### D-12 — `deferred-review-items.md` must stay out of the deployed output

- **Where:** `.vercelignore`.
- **Impact:** This file is a repo-root document; without an ignore rule Vercel would
  serve it publicly.
- **Do:** Keep the `.vercelignore` entry added alongside this file.
