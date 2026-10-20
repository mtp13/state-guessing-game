const { defineConfig, devices } = require("@playwright/test");

// Playwright doesn't officially support this local OS, so skip its host check outside CI.
if (!process.env.CI) {
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
}

// Trailing slashes matter: tests navigate with page.goto("./").
const ROOT_URL = "http://localhost:4381/";
const SUBFOLDER_URL = "http://localhost:4382/state-guessing-game/";

module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    reducedMotion: "reduce",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "Desktop Chromium",
      use: { ...devices["Desktop Chrome"], baseURL: ROOT_URL },
    },
    {
      name: "Desktop Chromium (subfolder)",
      use: { ...devices["Desktop Chrome"], baseURL: SUBFOLDER_URL },
    },
  ],
  webServer: [
    {
      command: "python3 -m http.server 4381",
      url: ROOT_URL,
      reuseExistingServer: false,
    },
    {
      // Serves the repo under /state-guessing-game/, like the production subfolder.
      command:
        "mkdir -p .e2e-root && ln -sfn .. .e2e-root/state-guessing-game && python3 -m http.server 4382 --directory .e2e-root",
      url: SUBFOLDER_URL,
      reuseExistingServer: false,
    },
  ],
});
