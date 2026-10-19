# Deferred Review Items

Findings raised by the automated PR review (MiniMax via OpenCode) and user feedback that are tracked across PRs. Each item lists where it came from, its status, why it was deferred, and what to do about it.

---

## Resolved in PR #3

- **D-15 — Mobile button text sizing on iPhone**: RESOLVED. Refined `.icon-btn` typography (`font-size: 0.8125rem`, `padding: 0.4375rem 0.625rem`, `gap: 0.3125rem`, with 20x20px SVG icons and `white-space: nowrap`), ensuring Sound, Restart, and Scores action buttons fit cleanly without clipping or overflow on iPhone 14 (390px) down to 320px screens with $\ge 44 \times 44\text{px}$ touch targets maintained. Stacked header layout at $\le 640\text{px}$ centers buttons and title cleanly.

---

## Resolved in PR #2

The following items raised during PR #2 reviews were resolved prior to merge:

- **D-1 — Error-handling honesty on save score**: RESOLVED. `submitScore()` returns explicit `success` flag (`data.success === true`). On failure or HTTP 502, button is re-enabled with "Retry", and status announces "Could not save score to online leaderboard. Saved locally."
- **D-2 / D-3 / Blocker 1 — Vercel Blob overwrite, CDN caching, and snapshot pruning**: RESOLVED. Overwrite caching was replaced with immutable timestamped snapshots (`scores-${Date.now()}.json`), eliminating CDN cache delays. Explicit `x-add-random-suffix: "0"` header added to ensure deterministic filenames. `selectPrunableSnapshots()` was extracted and unit-tested to retain at least 2 freshest snapshots and only prune older snapshots strictly prior to the current write.
- **Blocker 2 — Transient read failure wiping leaderboard**: RESOLVED. `fetchBlobScores()` returns `{ ok: false, error: "..." }` on API errors versus `{ ok: true, topScores: [], names: [] }` on an empty store. Handler aborts with HTTP 502 instead of overwriting the leaderboard on read failure.
- **D-9 — E2E coverage gaps**: RESOLVED. Added automated tests covering the real HTTP 502 server failure response and verifying that `#save-score-form` is hidden when the score does not qualify for the top 10.
- **D-11 — `sortScores()` robustness against malformed/null local entries**: RESOLVED. Filtered non-object and null entries in `sortScores()` with numeric fallback guards on score comparisons, preventing corrupted `localStorage` items from throwing during startup initialization.
- **D-12 — Exclude review tracking document from production**: RESOLVED. `deferred-review-items.md` added to `.vercelignore`.
- **State hover cheat bug**: RESOLVED. Removed SVG child `<title>` tags from all 50 state paths while retaining accessible `aria-label` attributes (0 axe violations).

---

## Deferred Items (Future Consideration)

### Moderate / Minor

#### D-4 — Body limit bounds in `parseBody()`

- **Where:** `api/scores.js` — `parseBody()`.
- **Impact:** `parseBody()` checks `req.body` first when pre-parsed by the runtime. The stream branch continues accumulating after the 16 KB limit trips before returning null.
- **Do:** Apply the size check before accumulating and destroy stream on limit overflow.

#### D-5 — Rate limiting and origin check on POST

- **Where:** `api/scores.js` — `handler()`.
- **Impact:** Public endpoint allows POST requests without per-IP rate limits or origin verification.
- **Do:** Add Origin verification header check and token bucket rate limiting.

#### D-6 — Unused `isTopScore()` in handler

- **Where:** `api/scores.js` — `isTopScore()`.
- **Impact:** Exported and tested, but POST handler always merges and writes even if the score cannot qualify.
- **Do:** Use `isTopScore()` to skip writing when the score cannot qualify for the top 10.

#### D-7 — Dialog `hidden` attribute symmetry

- **Where:** `app.js` — `render()` vs `openGameOverModalUI()`.
- **Impact:** `render()` and `openGameOverModalUI()` handle the `hidden` attribute on `<dialog>` elements slightly differently.
- **Do:** Consolidate modal opening/closing into unified helper functions.

#### D-8 — Merge local-only scores on startup fetch

- **Where:** `app.js` — `fetchScores()`.
- **Impact:** If a player has a locally saved score that failed to upload to the server, a subsequent page load replaces the local list with the server list.
- **Do:** Merge local and server scores by unique ID on startup.

#### D-10 — Date formatting in leaderboard table

- **Where:** `app.js` — `renderLeaderboardTable()`.
- **Impact:** Uses `String(item.date).slice(0, 10)` rather than localized date parsing.
- **Do:** Use `Intl.DateTimeFormat` or unified `formatDate()` helper.

#### D-13 — Snapshot concurrency / optimistic locking

- **Where:** `api/scores.js` — `uploadBlobScores()`.
- **Impact:** If two players submit scores within milliseconds of each other, both read snapshot $S_n$ and write $S_{n+1}$. The latter snapshot would overwrite the earlier one's entry.
- **Do:** For higher volume, introduce optimistic locking (`ifMatch`/ETag on modern Blob API) or per-submission blobs.

#### D-14 — Modernize Blob API version

- **Where:** `api/scores.js`.
- **Impact:** Currently pinned to API version 7 (`x-api-version: 7`).
- **Do:** Modernize to API version 10+ with `PUT /?pathname=...` and verify against live credentials.

#### D-16 — Component media queries in `@layer components`

- **Where:** `style.css` — `@media (max-width: 640px)`.
- **Impact:** Component responsive overrides are currently in `@layer utilities`.
- **Do:** Nest `@media (max-width: 640px)` component rules directly inside `@layer components` and keep only utilities/reduced-motion in `@layer utilities`.
