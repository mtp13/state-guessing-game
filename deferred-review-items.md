# Deferred Review Items

Open follow-ups from PR reviews and user feedback. Completed items are removed; check git history for what was resolved.

## Open

### Bugs

- **GitHub issue #6 — Score can be saved twice; leaderboard dates not in local time.** After saving, dismissing the dialog and pressing "View Results" re-enables the save form. Dates should use the local time zone (`app.js` `renderLeaderboardTable()`, currently `String(item.date).slice(0, 10)`; use `Intl.DateTimeFormat`).

### API (`api/scores.js`)

- **D-4 — `parseBody()` size limit:** check the 16 KB limit before accumulating and destroy the stream on overflow.
- **D-5 — Rate limiting / origin check:** the public POST endpoint has neither.
- **D-6 — Unused `isTopScore()`:** the handler always writes; skip the write when the score can't qualify.
- **D-13 — Snapshot concurrency:** two near-simultaneous submissions can overwrite each other; consider ETag / `ifMatch` or per-submission blobs.
- **D-14 — Blob API version:** pinned to `x-api-version: 7`; modernize and verify against live credentials.

### Client (`app.js`, `style.css`)

- **D-8 — Merge local-only scores on startup:** a locally saved score that failed to upload is replaced by the server list on next load.
- **D-17 — Backdrop `pointerdown` guard:** a drag starting inside a dialog and releasing on the backdrop closes it; compare `pointerdown` and `click` targets.
- **D-16 — Component media queries:** `@media (max-width: 640px)` component rules sit in `@layer utilities`; move into `@layer components`.
- **D-18 — Dead/duplicate CSS:** remove `.mode-btn[aria-pressed]` selectors (buttons use `aria-checked`) and the duplicated `[hidden]` rule in `style.css` (already in `reset.css`).
- **D-19 — `createGameState` overloads:** accepts three call shapes (queue / options object / mode string); the app uses only one. Simplify.
- **D-20 — Mode-specific labels:** the HUD "Best" label and `.final-stat-label` text are rewritten from JS; prefer `data-mode`-driven labels. Practice mode also renders `strikes-count` as `0 / 3` while hidden.
- **D-21 — Startup fetch in Practice mode:** `fetchScores()` still runs on load in Practice mode (intentional for instant switching); revisit if request volume matters.
- **D-22 — Modal `hidden` handling in `render()`:** `render()` calls `showModal()`/`close()` without toggling `hidden`, unlike the open/close helpers; consolidate into shared helpers.
- **D-23 — Duplicate leaderboard close controls:** the leaderboard modal has both a top `×` and a bottom "Close"; decide whether to keep both.
