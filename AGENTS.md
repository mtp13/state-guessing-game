# AGENTS.md

Guidance for AI coding agents (Claude Code, Gemini CLI, Codex, etc.) working in this repo.
`CLAUDE.md` and `GEMINI.md` just import this file, so edit this one.

## Project

A modern, accessible US State Guessing Game for desktop and mobile, written in plain HTML, CSS and JavaScript. Players are prompted to locate states on an interactive SVG map across two distinct modes: a 3-strikes elimination Challenge mode with target reveals and an online leaderboard, and a low-pressure, self-paced Practice mode with total guess tracking and local personal best records. Includes synthesized audio feedback, streak tracking, all-time top 10 leaderboard with player name autocomplete, and canvas confetti upon completion.

- **Dev dependencies for tooling are allowed, runtime dependencies are not, and there must never be a build step.** Don't add frameworks, runtime npm packages, a bundler or a build pipeline unless asked.
- The browser loads `states-data.js` and `app.js` directly as classic `<script>` tags, not ES modules.
- Serverless scoring endpoint in `api/scores.js` uses standard Node.js without runtime dependencies, integrating with Vercel Blob via its REST API.

## Commands

```sh
npm test                                     # node --test tests/*.test.js (Node built-in test runner)
npm run test:e2e                             # playwright test (Desktop Chromium E2E & axe a11y)
npm run format                               # prettier --write .
npm run lint                                 # prettier --check . && html-validate index.html
npm run lint:html                            # html-validate index.html
node --check app.js                          # syntax check (CI runs this too)
node --check states-data.js                  # syntax check
node --check api/scores.js                   # syntax check
python3 -m http.server 4381                  # serve locally
```

Serve the app over HTTP rather than opening it as `file://`.
CI (`.github/workflows/ci.yml`) runs two jobs on Node 22 for pull requests and pushes to `master` (skipped for markdown/`docs/`-only changes, and superseded runs on the same ref are cancelled): unit/lint checks (`npm ci`, `npm run lint`, syntax checks, `npm test`) and Playwright E2E/accessibility checks (`npm run test:e2e`).

## Layout

| File                                                | Purpose                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `index.html`                                        | All markup: interactive SVG map, prompt banner, score HUD, strikes counter, modals       |
| `app.js`                                            | All game logic: pure quiz engine, 3-strikes rule, DOM binding, leaderboard, Web Audio    |
| `api/scores.js`                                     | Serverless endpoint: Vercel Blob REST integration, Top 10 high scores, unique names list |
| `states-data.js`                                    | Master dataset of 50 US states (postal IDs, names, capitals, regions, coordinates)       |
| `style.css`                                         | Styles, organised in `@layer reset, base, theme, components, utilities`                  |
| `reset.css`                                         | The `reset` layer                                                                        |
| `map.svg`                                           | Vector source for the US map paths                                                       |
| `manifest.webmanifest`                              | Web app manifest                                                                         |
| `favicon.png`, `icon-{180,192,512}.png`, `icon.svg` | Favicon, iOS touch icon (180×180), and app icons                                         |
| `vercel.json`, `.vercelignore`                      | Security/CSP and cache headers, plus deploy exclusion list                               |
| `deferred-review-items.md`                          | Persistent tracking of automated and manual review items across PRs                      |
| `tests/app.test.js`                                 | Unit tests for pure game logic functions (including 3-strikes rule)                      |
| `tests/scores.test.js`                              | Unit tests for scoring, sorting, name deduplication, and input validation                |
| `tests/states-data.test.js`                         | Unit tests validating dataset integrity and completeness                                 |
| `tests/markup.test.js`                              | Static assets, markup structure, relative paths, and CSP compliance tests                |
| `e2e/game.spec.js`, `playwright.config.js`          | Real-browser Playwright E2E, gameplay, layout, strikes, leaderboard, and axe a11y tests  |
| `e2e/csp-fixture.js`                                | Playwright fixture that applies the `vercel.json` CSP to every HTML document             |

## How `app.js` works

- **It runs in both the browser and Node.** At the bottom, `initializeApp()` runs only if `document` exists, and `module.exports` is set only if `module` exists. Keep both guards. Don't use top-level `import`/`export`, and don't touch the DOM at the top level of the file.
- **Pure logic functions are exported for testing:** `shuffleStates`, `createGameState`, `evaluateGuess`, `skipCurrentState`, `calculateAccuracy`, `getPracticeBestScore`, and `checkNewPracticeBest` operate on explicit state objects without side effects or DOM access.
- **Game Modes & Persistence:**
  - Active game mode is saved in `localStorage` under `state_game_mode` (`"challenge"` | `"practice"`, defaulting to `"challenge"`).
  - Mode toggle is rendered as an accessible segmented radio group (`role="radiogroup"` with `role="radio"`, `aria-checked`, and roving `tabindex`).
  - Switching modes when a game is in progress (`!gameState.completed && gameState.attempts > 0`) prompts a native confirmation dialog (`window.confirm("Switching modes will restart your current game. Continue?")`). If accepted, the mode switches, preference is persisted, and the board resets cleanly; if dismissed, the active run continues uninterrupted. Fresh or finished games switch immediately without prompting.
- **Three-strikes Challenge mode:** Players get up to 3 strikes (wrong guesses). On the 3rd wrong guess, the quiz ends immediately and the correct target state is highlighted with `data-status="revealed"` on the map with audio and live screen-reader announcements before transitioning to the Game Over dialog. High scores qualify for the online Top 10 leaderboard.
- **Self-paced Practice mode:** Players locate all 50 states at their own pace without strikes or elimination. Incorrect clicks provide gentle feedback (flash red, play sound, voice polite announcement), but keep the current target state active. Total guesses are tracked dynamically. Finding all 50 states triggers victory chimes, confetti, and a completion modal displaying total guesses, accuracy, and personal best tracking (`state_game_practice_best_guesses`). Online leaderboard and score submission forms are strictly hidden in Practice mode, and no scores are ever submitted (the startup leaderboard fetch still happens so switching back to Challenge is instant).
- **Dynamic HUD Adaptation:** The HUD dynamically toggles `#strikes-card` (Challenge mode) and `#guesses-card` (Practice mode) using the `hidden` attribute. `#best-card` displays the player's Top 10 Challenge high score or Practice fewest guesses personal best (`"--"` if no completed run yet).
- **Dismissible results and map review:** The Game Over dialog can be dismissed at any time via "Review Map" (`#review-map-btn`), sticky top close button (`&times;`), Escape key, or backdrop tap. On dismissal, the completed map remains visible and interactive, the prompt card presents "View Results" and "New Game" actions (`#prompt-completed-actions`), and focus returns to `#view-results-btn` (or `#leaderboard-btn` when closing the leaderboard).
- **Daily Top 10 leaderboard & autocomplete:** Persists today's top 10 scores (resetting daily at midnight US Central Time, `America/Chicago`) and retains unique player names across days via `./api/scores` with fallback to `localStorage`. Player names are suggested via a `<datalist>` to prevent duplicate spellings.
- **DOM lookups belong in `bindDomElements()`.** Element references and collections (SVG paths, modals, buttons, mode toggles) are queried there, which `initializeApp()` calls on startup. If you add an element, look it up in `bindDomElements()`, never at the top level.
- **Sound effects:** Web Audio API synthesizer generates synthetic beeps, chords, and clicks on demand (`playSound()`) without external audio files, respecting mute preferences saved in `localStorage`.
- **Celebration:** Canvas confetti runs dynamically via `startConfetti()` and `stopConfetti()` when the quiz is finished, respecting `prefers-reduced-motion`.

## How `api/scores.js` works

- **Serverless REST integration with Vercel Blob:** Standard Node.js handler communicates with Vercel Blob via its REST API (using `SCORES_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN`) without runtime dependencies, falling back to an in-memory store in local dev or test environments.
- **Immutable timestamped snapshots:** Avoids CDN cache propagation delays on writes by storing scores in timestamped snapshots (`scores-<ts>.json` where `<ts>` is epoch milliseconds, uploaded with `x-add-random-suffix: "0"`).
- **Snapshot pruning:** `selectPrunableSnapshots()` retains at least the 2 freshest snapshots while safely identifying older snapshots strictly prior to the current write for background deletion.
- **Daily reset (US Central Time):** `filterTodayScores()` filters leaderboard scores by calendar day in `America/Chicago` (`getDayKey()`), resetting the Top 10 each day at midnight Central Time while preserving cumulative player names in `names` for autocomplete.
- **POST abuse controls:** `isAllowedOrigin()` returns HTTP 403 unless the `Origin` header matches the request host / `x-forwarded-host`, `https://mike.pullen.dev` (the hub proxy), or an origin in the comma-separated `ALLOWED_ORIGINS` env var. `checkRateLimit()` is a best-effort in-memory limiter (5 POSTs per minute per client IP, HTTP 429 with `Retry-After`); serverless instances don't share memory, so add a Vercel Firewall rate-limit rule for a global limit.
- **Fail-safe HTTP 502 contract:** If Blob storage read or listing fails, `fetchBlobScores()` returns `{ ok: false, error }` and the handler responds with HTTP 502 (`Could not read leaderboard`), preventing transient read failures from wiping existing scores.

## Conventions

- Prettier (`.prettierrc` + `.prettierignore`) is the source of truth for formatting (2 spaces, semicolons, double quotes). Run `npm run format` before committing. `.editorconfig` sets LF line endings and a final newline.
- Style the UI from state using `data-*` attributes and CSS `:has()`, for example `data-status="correct"`, `data-status="incorrect"`, and `data-status="skipped"` on map paths and chips. Don't toggle inline styles from JS.
- **No inline scripts, inline styles or third-party resources,** because they would break the Content Security Policy (`Content-Security-Policy` in `vercel.json`). If one is truly needed, update the CSP in `vercel.json` and document why.
- Keep CSS in the correct `@layer reset, base, theme, components, utilities`. Reduced-motion overrides go in `utilities`, under `@media (prefers-reduced-motion: reduce)`.
- **Accessibility is required.** Zero axe violations. Every interactive element (map state paths, chip buttons, controls) has accessible labels and visible `:focus-visible` outlines. Live announcements are dispatched to an `aria-live="polite"` region (`#status-live`) on state guesses, skips, and restarts.
- Mobile: account for safe-area insets (`env(safe-area-inset-*)`), `dvh` units, and responsive layouts for phones in `style.css`.

## Testing

- Unit tests (`npm test`) cover pure game logic, data integrity, and static markup/asset structure using only `node:test` and `node:assert/strict`. Playwright (`npm run test:e2e`) covers a slim set of real-browser smoke tests (CSP, core gameplay, leaderboard save/retry) and accessibility (`@axe-core/playwright`) in Desktop Chromium. Run both before committing.
- **E2E specs must import `test` and `expect` from `./csp-fixture`, not from `@playwright/test`.** The local `python3 -m http.server` sends no headers, so the fixture reads the CSP from `vercel.json` and adds it to every same-origin HTML document. Without it the CSP-violation assertion can never fail. Keep it identical to the reference apps.
- **Ports:** E2E uses 4381 (root) and 4382 (`/state-guessing-game/` subfolder); other apps use their own ports. 4321 is deliberately avoided because it is commonly used for manual phone testing. `reuseExistingServer` is `false`, so a leftover server on either port makes `npm run test:e2e` fail instead of testing the wrong app. Stop your dev server before running E2E.
- Add or update tests for any change to game logic, state data, or UI. Run `npm run lint`, `npm test` and `npm run test:e2e` before you finish.

## Deployment

- The site is hosted on **Vercel** with static frontend assets plus a serverless scoring endpoint (`api/scores.js`).
- Production is `https://mike.pullen.dev/state-guessing-game/`, proxied from this Vercel project by the hub site (`mtp13/mike.pullen.dev`). Only `master` is deployed (`git.deploymentEnabled` in `vercel.json`); feature branches and PRs get no Vercel preview, because the Hobby plan caps deployments at 100/day. Test on localhost instead.
- All paths must stay relative (`./`, `style.css`). Never use root-anchored paths (`/…`) or a `<base>` tag so the app works both at a domain root and in a subfolder.
- Playwright runs every test both at the root and in a `/state-guessing-game/` subfolder.
- Headers and `.vercelignore` can only be checked with `curl` against production after merging, since branches are not deployed.
- `.vercelignore` excludes `package.json`, `package-lock.json`, tests, docs and tooling configs so Vercel deploys only the app's runtime files and skips `npm install`. `package.json` also has no `build` script, and no build script should be added. Note: `api/` must **never** be added to `.vercelignore`.
- Serverless storage uses Vercel Blob with static read-write token (`SCORES_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN`), storing scores in immutable timestamped snapshots (`scores-<ts>.json`) pruned via `selectPrunableSnapshots()` and returning HTTP 502 on read failures to protect leaderboard data. In local dev without `vercel dev` (e.g. `python3 -m http.server`), client falls back smoothly to `localStorage`.
- If you add a new tooling or config file, add it to `.vercelignore` so it isn't served. Never commit secrets.
- Security headers (strict CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) and cache rules (`max-age=0, must-revalidate` on `index.html` and `manifest.webmanifest`) live in `vercel.json`. Don't put workarounds in `app.js`.

## Git & GitHub

- The repo is on GitHub at `mtp13/state-guessing-game` (remote `origin`), and `master` is the default branch.
- Before making changes, check the current branch. If you're on `master`, create a feature
  branch first (`feat/…`, `fix/…`, `chore/…`, `docs/…`). If you're already on a feature
  branch for related work, keep using it. Once a PR is merged, start new work on a fresh
  branch from an up-to-date `master`, and never push to a merged branch.
- Commit locally as often as you like, but push once per unit of work: every push to `master` is a Vercel deployment and every PR push is a CI run. Don't push WIP commits, and batch review fixes into one push.
- When the work is finished, run `npm run format`, then `npm run lint`, `npm test` and `npm run test:e2e`. Commit only once all of them pass, then push the branch and open a pull request against `master` with `gh pr create`. Every commit must be formatted, not just the last one before a PR. Give the PR a summary and test notes. You don't need to ask first. If a PR is already open for the branch, push to update it.
- **Mandatory PR review before merge:** Every PR must be reviewed by the review agent (MiniMax via OpenCode) after being submitted (`gh pr create`) and before merging. Run `opencode run -m opencode/minimax-m3.1-flash-free "Review PR #<n>..."`. Address any blockers, and keep a persistent list in `deferred-review-items.md` for items not implemented immediately that need future consideration. If further commits are pushed to the PR, re-run the review on the updated PR. Never merge a PR without completed review approval and green CI checks.
- Use the `gh` CLI for PRs, issues and checking CI runs. Each PR runs CI through GitHub
  Actions; check it with `gh pr checks` and fix any failures.
- Never commit to, push to or force-push `master` directly.
