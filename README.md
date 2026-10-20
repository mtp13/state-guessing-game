# US State Guessing Game

A fast, modern, and accessible US State Guessing Game for mobile and desktop, written in plain HTML, CSS, and JavaScript with zero runtime dependencies. Players locate states on an interactive SVG map with instant audio feedback, streak tracking, a three-strikes Challenge mode with target state reveal, a self-paced Practice mode with guess tracking, all-time top 10 leaderboard with name autocomplete, and canvas confetti on completion.

**[Play it live → mike.pullen.dev/state-guessing-game](https://mike.pullen.dev/state-guessing-game/)**

## Features

- **Interactive SVG Map:** Clickable and keyboard-navigable map of all 50 states.
- **Two Game Modes:**
  - **Challenge Mode:** Players have up to 3 wrong guesses; on the 3rd strike the quiz ends immediately and the correct target state is highlighted on the map. Qualified scores can be submitted to the all-time Top 10 leaderboard.
  - **Practice Mode:** Low-pressure, self-paced exploration to find all 50 states with zero strikes, zero elimination, and continuous retries on the active target state. Tracks total guesses and records personal best fewest guesses locally (`state_game_practice_best_guesses`).
- **Mode Selector & Persistence:** Accessible segmented control (`role="radiogroup"`) persisting preference in `localStorage` (`state_game_mode`), protected by a confirmation dialog guard if switching mid-game.
- **Dynamic HUD:** Adapts stat cards seamlessly between modes—showing Strikes and Pips in Challenge mode, and Guesses counter in Practice mode. The Best card displays the Challenge high score or Practice fewest guesses personal best.
- **Completed Map Review:** Players can dismiss the Game Over or Map Completed screen at any time to inspect their finished map, re-open results via "View Results", or start a fresh round with "New Game".
- **Top 10 Leaderboard & Autocomplete:** Persistent high scores across devices for Challenge mode backed by a lightweight serverless endpoint, with player name suggestions to avoid duplicate spellings (score submission is suppressed during Practice mode).
- **Audio Feedback:** Synthesized sound effects using the Web Audio API with a persistent mute toggle.
- **Score & Streak Tracking:** Real-time accuracy, streak counter, strikes or guesses indicators, and modal statistics dialog.
- **Accessibility:** Zero axe violations, visible `:focus-visible` styles, and screen reader announcements via `aria-live`.
- **Works on Desktop & Mobile:** Responsive layout supporting safe-area insets, `dvh` units, and touch interactions.

## Development

There is no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 4381
```

Then open <http://localhost:4381/>. (Note: `/api/scores` requires `vercel dev` or falls back gracefully to `localStorage` when run under python3 http.server).

| Command            | What it does                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `npm ci`           | Install the dev tooling dependencies (once)                                                 |
| `npm test`         | Run unit and static markup tests (Node built-in test runner)                                |
| `npm run test:e2e` | Run Playwright browser tests (Desktop Chromium + Mobile WebKit, root & subfolder, axe a11y) |
| `npm run lint`     | Check formatting (Prettier) and HTML validity (`html-validate`)                             |
| `npm run format`   | Format all code with Prettier                                                               |

To run the Playwright tests for the first time, install the required browsers:

```sh
npx playwright install chromium webkit
```

## Tech

Plain HTML, CSS, and JavaScript with no framework, no runtime dependencies, and no build step. Deployed to [Vercel](https://vercel.com) with a Node.js serverless scoring function (`api/scores.js`) integrating with Vercel Blob REST storage. CI runs on GitHub Actions (Node 22).

## Contributing

Work on a feature branch, open a pull request against `master`, and make sure CI passes. Run `npm run format`, `npm run lint`, `npm test`, and `npm run test:e2e` before you push.
