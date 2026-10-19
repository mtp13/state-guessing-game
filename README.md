# US State Guessing Game

A fast, modern, and accessible US State Guessing Game for mobile and desktop, written in plain HTML, CSS, and JavaScript with no build step. Players identify states on an interactive SVG map with instant audio feedback, streak tracking, a quick-select tray for compact northeastern states, and canvas confetti on completion.

**[Play it live → mike.pullen.dev/state-guessing-game](https://mike.pullen.dev/state-guessing-game/)**

## Features

- **Interactive SVG Map:** Clickable and keyboard-navigable map of all 50 states.
- **Northeast Quick-Select:** Dedicated chip tray for easily targeting small northeastern states on touchscreens.
- **Audio Feedback:** Synthesized sound effects using the Web Audio API with a persistent mute toggle.
- **Score & Streak Tracking:** Real-time accuracy, streak counter, and final statistics modal dialog.
- **Accessibility:** Zero axe violations, visible `:focus-visible` styles, and screen reader announcements via `aria-live`.
- **Works on Desktop & Mobile:** Responsive layout supporting safe-area insets, `dvh` units, and touch interactions.

## Development

There is no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 4381
```

Then open <http://localhost:4381/>.

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

Plain HTML, CSS, and JavaScript with no framework, no runtime dependencies, and no build step. Deployed to [Vercel](https://vercel.com) as a static site, with CI running on GitHub Actions (Node 22).

## Contributing

Work on a feature branch, open a pull request against `master`, and make sure CI passes. Run `npm run format`, `npm run lint`, `npm test`, and `npm run test:e2e` before you push.
