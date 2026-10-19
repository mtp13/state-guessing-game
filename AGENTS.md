# AGENTS.md

Guidance for AI coding agents (Claude Code, Gemini CLI, Codex, etc.) working in this repo.
`CLAUDE.md` and `GEMINI.md` just import this file, so edit this one.

## Project

A modern, accessible US State Guessing Game for desktop and mobile, written in plain HTML, CSS and JavaScript. Players are prompted to locate states on an interactive SVG map, featuring synthesized audio feedback, streak tracking, a three-strikes game over rule with revealed target state on the third strike, all-time top 10 leaderboard with player name autocomplete, and canvas confetti upon completion.

- **Dev dependencies for tooling are allowed, runtime dependencies are not, and there must never be a build step.** Don't add frameworks, runtime npm packages, a bundler or a build pipeline unless asked.
- The browser loads `states-data.js` and `app.js` directly as classic `<script>` tags, not ES modules.
- Serverless scoring endpoint in `api/scores.js` uses standard Node.js without runtime dependencies, integrating with Vercel Blob via its REST API.

## Commands

```sh
npm test                                     # node --test tests/*.test.js (Node built-in test runner)
npm run test:e2e                             # playwright test (Desktop Chromium + Mobile WebKit E2E & axe a11y)
npm run format                               # prettier --write .
npm run lint                                 # prettier --check . && html-validate index.html
npm run lint:html                            # html-validate index.html
node --check app.js                          # syntax check (CI runs this too)
node --check states-data.js                  # syntax check
node --check api/scores.js                   # syntax check
python3 -m http.server 4381                  # serve locally
```

Serve the app over HTTP rather than opening it as `file://`.
CI (`.github/workflows/ci.yml`) runs two jobs on Node 22 for pull requests and pushes to `master`: unit/lint checks (`npm ci`, `npm run lint`, syntax checks, `npm test`) and Playwright E2E/accessibility checks (`npm run test:e2e`).

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
| `tests/app.test.js`                                 | Unit tests for pure game logic functions (including 3-strikes rule)                      |
| `tests/scores.test.js`                              | Unit tests for scoring, sorting, name deduplication, and input validation                |
| `tests/states-data.test.js`                         | Unit tests validating dataset integrity and completeness                                 |
| `tests/markup.test.js`                              | Static assets, markup structure, relative paths, and CSP compliance tests                |
| `e2e/game.spec.js`, `playwright.config.js`          | Real-browser Playwright E2E, gameplay, layout, strikes, leaderboard, and axe a11y tests  |
| `e2e/csp-fixture.js`                                | Playwright fixture that applies the `vercel.json` CSP to every HTML document             |

## How `app.js` works

- **It runs in both the browser and Node.** At the bottom, `initializeApp()` runs only if `document` exists, and `module.exports` is set only if `module` exists. Keep both guards. Don't use top-level `import`/`export`, and don't touch the DOM at the top level of the file.
- **Pure logic functions are exported for testing:** `shuffleStates`, `createGameState`, `evaluateGuess`, `skipCurrentState`, and `calculateAccuracy` operate on explicit state objects without side effects or DOM access.
- **Three-strikes game rule:** Players get up to 3 strikes (wrong guesses). On the 3rd wrong guess, the quiz ends immediately and the correct target state is highlighted with `data-status="revealed"` on the map with audio and live screen-reader announcements before transitioning to the Game Over dialog.
- **Top 10 leaderboard & autocomplete:** Persists top 10 scores and unique player names via `./api/scores` with fallback to `localStorage`. Player names are suggested via a `<datalist>` to prevent duplicate spellings.
- **DOM lookups belong in `bindDomElements()`.** Element references and collections (SVG paths, modals, buttons) are queried there, which `initializeApp()` calls on startup. If you add an element, look it up in `bindDomElements()`, never at the top level.
- **Sound effects:** Web Audio API synthesizer generates synthetic beeps, chords, and clicks on demand (`playSound()`) without external audio files, respecting mute preferences saved in `localStorage`.
- **Celebration:** Canvas confetti runs dynamically via `startConfetti()` and `stopConfetti()` when the quiz is finished, respecting `prefers-reduced-motion`.

## Conventions

- Prettier (`.prettierrc` + `.prettierignore`) is the source of truth for formatting (2 spaces, semicolons, double quotes). Run `npm run format` before committing. `.editorconfig` sets LF line endings and a final newline.
- Style the UI from state using `data-*` attributes and CSS `:has()`, for example `data-status="correct"`, `data-status="incorrect"`, and `data-status="skipped"` on map paths and chips. Don't toggle inline styles from JS.
- **No inline scripts, inline styles or third-party resources,** because they would break the Content Security Policy (`Content-Security-Policy` in `vercel.json`). If one is truly needed, update the CSP in `vercel.json` and document why.
- Keep CSS in the correct `@layer reset, base, theme, components, utilities`. Reduced-motion overrides go in `utilities`, under `@media (prefers-reduced-motion: reduce)`.
- **Accessibility is required.** Zero axe violations. Every interactive element (map state paths, chip buttons, controls) has accessible labels and visible `:focus-visible` outlines. Live announcements are dispatched to an `aria-live="polite"` region (`#status-live`) on state guesses, skips, and restarts.
- Mobile: account for safe-area insets (`env(safe-area-inset-*)`), `dvh` units, and responsive layouts for phones in `style.css`.

## Testing

- Unit tests (`npm test`) cover pure game logic, data integrity, and static markup/asset structure using only `node:test` and `node:assert/strict`. Playwright (`npm run test:e2e`) covers real-browser behaviour, responsive layout, and accessibility (`@axe-core/playwright`) in Desktop Chromium and Mobile WebKit. Run both before committing.
- **E2E specs must import `test` and `expect` from `./csp-fixture`, not from `@playwright/test`.** The local `python3 -m http.server` sends no headers, so the fixture reads the CSP from `vercel.json` and adds it to every same-origin HTML document. Without it the CSP-violation assertion can never fail. Keep it identical to the reference apps.
- **Ports:** E2E uses 4381 (root) and 4382 (`/state-guessing-game/` subfolder); other apps use their own ports. 4321 is deliberately avoided because it is commonly used for manual phone testing. `reuseExistingServer` is `false`, so a leftover server on either port makes `npm run test:e2e` fail instead of testing the wrong app. Stop your dev server before running E2E.
- Add or update tests for any change to game logic, state data, or UI. Run `npm run lint`, `npm test` and `npm run test:e2e` before you finish.

## Deployment

- The site is hosted on **Vercel** with static frontend assets plus a serverless scoring endpoint (`api/scores.js`).
- Production is `https://mike.pullen.dev/state-guessing-game/`, proxied from this Vercel project by the hub site (`mtp13/mike.pullen.dev`). Previews serve the app from `/`.
- All paths must stay relative (`./`, `style.css`). Never use root-anchored paths (`/…`) or a `<base>` tag so the app works both at a domain root and in a subfolder.
- Playwright runs every test both at the root and in a `/state-guessing-game/` subfolder.
- Vercel previews are behind login protection, so headers and `.vercelignore` can only be checked with `curl` against production after merging.
- `.vercelignore` excludes `package.json`, `package-lock.json`, tests, docs and tooling configs so Vercel deploys only the app's runtime files and skips `npm install`. `package.json` also has no `build` script, and no build script should be added. Note: `api/` must **never** be added to `.vercelignore`.
- Serverless storage uses Vercel Blob with static read-write token (`SCORES_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN`). In local dev without `vercel dev` (e.g. `python3 -m http.server`), client falls back smoothly to `localStorage`.
- If you add a new tooling or config file, add it to `.vercelignore` so it isn't served. Never commit secrets.
- Security headers (strict CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) and cache rules (`max-age=0, must-revalidate` on `index.html` and `manifest.webmanifest`) live in `vercel.json`. Don't put workarounds in `app.js`.

## Git & GitHub

- The repo is on GitHub at `mtp13/state-guessing-game` (remote `origin`), and `master` is the default branch.
- Before making changes, check the current branch. If you're on `master`, create a feature
  branch first (`feat/…`, `fix/…`, `chore/…`, `docs/…`). If you're already on a feature
  branch for related work, keep using it. Once a PR is merged, start new work on a fresh
  branch from an up-to-date `master`, and never push to a merged branch.
- When the work is finished, run `npm run format`, then `npm run lint`, `npm test` and `npm run test:e2e`. Commit only once all of them pass, then push the branch and open a pull request against `master` with `gh pr create`. Every commit must be formatted, not just the last one before a PR. Give the PR a summary and test notes. You don't need to ask first. If a PR is already open for the branch, push to update it.
- Use the `gh` CLI for PRs, issues and checking CI runs. Each PR runs CI through GitHub
  Actions; check it with `gh pr checks` and fix any failures.
- Never commit to, push to or force-push `master` directly.
