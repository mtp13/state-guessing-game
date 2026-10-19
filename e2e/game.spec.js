const { test, expect } = require("./csp-fixture");
const AxeBuilder = require("@axe-core/playwright").default;

test.describe("US State Guessing Game E2E & Accessibility", () => {
  let consoleErrors = [];
  let pageErrors = [];
  let cspViolations = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    cspViolations = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations.push(
          `${e.violatedDirective}: ${e.blockedURI || "inline"}`,
        );
      });
    });
  });

  test.afterEach(async ({ page }) => {
    const violations = await page
      .evaluate(() => window.__cspViolations || [])
      .catch(() => []);
    cspViolations.push(...violations);

    expect(consoleErrors, "Expected zero console.error messages").toEqual([]);
    expect(pageErrors, "Expected zero uncaught page errors").toEqual([]);
    expect(cspViolations, "Expected zero CSP violations").toEqual([]);
  });

  test("initial load & UI elements rendering", async ({ page }) => {
    await page.goto("./");

    // Title and branding
    await expect(page).toHaveTitle("US State Guessing Game");
    await expect(page.locator(".app-title")).toHaveText(
      "US State Guessing Game",
    );

    // Header actions
    const soundToggle = page.locator("#sound-toggle");
    await expect(soundToggle).toBeVisible();
    await expect(soundToggle).toHaveAttribute("aria-pressed", "false");
    await expect(soundToggle).toHaveAttribute("aria-label", "Mute sound");

    const restartBtn = page.locator("#restart-btn");
    await expect(restartBtn).toBeVisible();
    await expect(restartBtn).toHaveAttribute("aria-label", "Restart game");

    // Prompt section
    await expect(page.locator(".prompt-label")).toHaveText("Find:");
    const targetState = page.locator("#target-state-name");
    await expect(targetState).toBeVisible();
    const initialTargetName = await targetState.textContent();
    expect(initialTargetName.trim().length).toBeGreaterThan(0);

    const skipBtn = page.locator("#skip-btn");
    await expect(skipBtn).toBeVisible();
    await expect(skipBtn).toBeEnabled();

    // Stats bar
    await expect(page.locator("#current-round")).toHaveText("1");
    await expect(page.locator("#total-rounds")).toHaveText("50");
    await expect(page.locator("#score-count")).toHaveText("0");
    await expect(page.locator("#streak-count")).toHaveText("0");
    await expect(page.locator("#accuracy-rate")).toHaveText("100%");

    // Progress bar
    const progressBar = page.locator("#progress-bar");
    await expect(progressBar).toHaveAttribute("max", "50");
    await expect(progressBar).toHaveAttribute("value", "0");

    // SVG Map
    const states = page.locator(".state");
    await expect(states).toHaveCount(50);
    const firstState = states.first();
    await expect(firstState).toHaveAttribute("role", "button");
    await expect(firstState).toHaveAttribute("tabindex", "0");

    // Northeast quick select chips
    const chips = page.locator(".state-chip");
    await expect(chips).toHaveCount(8);
    for (let i = 0; i < 8; i++) {
      await expect(chips.nth(i)).toBeEnabled();
    }

    // Live status announcement
    const liveStatus = page.locator("#status-live");
    await expect(liveStatus).toContainText("Game started. Find");

    // Game over modal closed initially
    const modal = page.locator("#game-over-modal");
    await expect(modal).not.toHaveAttribute("open", "");
  });

  test("accessibility: zero axe violations across initial, in-game, and game-over states (light and dark)", async ({
    page,
  }) => {
    await page.goto("./");

    // 1. Initial State audit (Light)
    const initialScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(initialScan.violations).toEqual([]);

    // 2. Initial State audit (Dark)
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("./");
    const darkScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(darkScan.violations).toEqual([]);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("./");

    // 3. In-game state: click correct target state, then click an incorrect state
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const targetState = page.locator(`.state[data-name="${targetName}"]`);
    await targetState.dispatchEvent("click");
    await expect(page.locator("#score-count")).toHaveText("1");

    // Click an incorrect state
    const nextTargetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const wrongState = page
      .locator(`.state:not([data-name="${nextTargetName}"])`)
      .first();
    await wrongState.dispatchEvent("click");

    const inGameScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(inGameScan.violations).toEqual([]);

    // 4. Game-over state: complete the game by skipping remaining states
    await page.evaluate(() => {
      const skipBtn = document.getElementById("skip-btn");
      while (!document.getElementById("game-over-modal").open) {
        skipBtn.click();
      }
    });

    const modal = page.locator("#game-over-modal");
    await expect(modal).toBeVisible();

    const gameOverScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(gameOverScan.violations).toEqual([]);
  });

  test("gameplay: clicking correct state increments score & streak and updates target", async ({
    page,
  }) => {
    await page.goto("./");

    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const statePath = page.locator(`.state[data-name="${targetName}"]`);

    await statePath.dispatchEvent("click");

    await expect(page.locator("#score-count")).toHaveText("1");
    await expect(page.locator("#streak-count")).toHaveText("1");
    await expect(page.locator("#current-round")).toHaveText("2");
    await expect(statePath).toHaveAttribute("data-status", "correct");
    await expect(statePath).toHaveAttribute("aria-disabled", "true");

    await expect(page.locator("#status-live")).toContainText(
      `Correct! That was ${targetName}`,
    );

    const nextTargetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    expect(nextTargetName).not.toBe(targetName);
  });

  test("gameplay: clicking incorrect state resets streak and announces error", async ({
    page,
  }) => {
    await page.goto("./");

    // First make one correct guess to get streak = 1
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    await page
      .locator(`.state[data-name="${targetName}"]`)
      .dispatchEvent("click");
    await expect(page.locator("#streak-count")).toHaveText("1");

    // Now click an incorrect state
    const nextTargetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const wrongState = page
      .locator(
        `.state:not([data-name="${nextTargetName}"]):not([data-status="correct"])`,
      )
      .first();
    const wrongStateName = await wrongState.getAttribute("data-name");

    await wrongState.dispatchEvent("click");

    await expect(page.locator("#score-count")).toHaveText("1");
    await expect(page.locator("#streak-count")).toHaveText("0");
    await expect(page.locator("#status-live")).toContainText(
      `Incorrect. That was ${wrongStateName}`,
    );
    // Target state remains unchanged
    await expect(page.locator("#target-state-name")).toHaveText(nextTargetName);
  });

  test("gameplay: skip button marks state as skipped and advances queue", async ({
    page,
  }) => {
    await page.goto("./");

    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const statePath = page.locator(`.state[data-name="${targetName}"]`);

    await page.locator("#skip-btn").click();

    await expect(page.locator("#score-count")).toHaveText("0");
    await expect(page.locator("#streak-count")).toHaveText("0");
    await expect(page.locator("#current-round")).toHaveText("2");
    await expect(statePath).toHaveAttribute("data-status", "skipped");
    await expect(statePath).toHaveAttribute("aria-disabled", "true");

    await expect(page.locator("#status-live")).toContainText(
      `Skipped ${targetName}`,
    );
  });

  test("gameplay: Northeast quick-select chips allow guessing small states", async ({
    page,
  }) => {
    await page.goto("./");

    const neCodes = ["RI", "DE", "CT", "NJ", "MD", "MA", "VT", "NH"];

    // Skip until the target state is one of the NE states
    for (let i = 0; i < 50; i++) {
      const currentTargetName = (
        await page.locator("#target-state-name").textContent()
      ).trim();
      const currentTargetState = page.locator(
        `.state[data-name="${currentTargetName}"]`,
      );
      const currentId = await currentTargetState.getAttribute("id");

      if (neCodes.includes(currentId)) {
        // Found a NE target! Click its corresponding chip
        const chip = page.locator(`.state-chip[data-state="${currentId}"]`);
        await chip.click();

        await expect(page.locator("#score-count")).toHaveText("1");
        await expect(chip).toHaveAttribute("data-status", "correct");
        await expect(chip).toBeDisabled();
        await expect(currentTargetState).toHaveAttribute(
          "data-status",
          "correct",
        );
        break;
      }

      await page.locator("#skip-btn").click();
    }
  });

  test("keyboard navigation: state paths and controls can be activated via Enter and Space", async ({
    page,
  }) => {
    await page.goto("./");

    // 1. Activate skip button via Space key
    const skipBtn = page.locator("#skip-btn");
    await skipBtn.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("#current-round")).toHaveText("2");

    // 2. Select target state path using Enter key
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const targetPath = page.locator(`.state[data-name="${targetName}"]`);
    await targetPath.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("#score-count")).toHaveText("1");
    await expect(targetPath).toHaveAttribute("data-status", "correct");
  });

  test("sound toggle: toggles mute state and updates accessibility attributes", async ({
    page,
  }) => {
    await page.goto("./");

    const toggle = page.locator("#sound-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Mute sound");

    // Mute sound
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Unmute sound");

    // Unmute sound
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Mute sound");
  });

  test("restart button: resets game progress, scores, and state statuses", async ({
    page,
  }) => {
    await page.goto("./");

    // Make one correct guess and one skip
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    await page
      .locator(`.state[data-name="${targetName}"]`)
      .dispatchEvent("click");
    await expect(page.locator("#score-count")).toHaveText("1");

    await page.locator("#skip-btn").click();
    await expect(page.locator("#current-round")).toHaveText("3");

    // Restart game
    await page.locator("#restart-btn").click();

    await expect(page.locator("#current-round")).toHaveText("1");
    await expect(page.locator("#score-count")).toHaveText("0");
    await expect(page.locator("#streak-count")).toHaveText("0");
    await expect(page.locator("#accuracy-rate")).toHaveText("100%");

    // Verify all states have no data-status
    const statesWithStatus = page.locator(".state[data-status]");
    await expect(statesWithStatus).toHaveCount(0);

    // Verify all chips enabled
    const chips = page.locator(".state-chip");
    for (let i = 0; i < 8; i++) {
      await expect(chips.nth(i)).toBeEnabled();
      await expect(chips.nth(i)).not.toHaveAttribute("data-status", /.*/);
    }

    await expect(page.locator("#status-live")).toContainText("Game restarted");
  });

  test("game completion: reaches game over modal, displays final score, and restarts game", async ({
    page,
  }) => {
    await page.goto("./");

    // Guess first state correctly
    const firstTargetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    await page
      .locator(`.state[data-name="${firstTargetName}"]`)
      .dispatchEvent("click");

    // Skip the remaining states to trigger game over
    await page.evaluate(() => {
      const skipBtn = document.getElementById("skip-btn");
      while (!document.getElementById("game-over-modal").open) {
        skipBtn.click();
      }
    });

    const modal = page.locator("#game-over-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#final-score")).toHaveText("1 / 50");
    await expect(page.locator("#final-streak")).toHaveText("1");
    await expect(page.locator("#target-state-name")).toHaveText("All Done!");
    await expect(page.locator("#skip-btn")).toBeDisabled();

    // Play again restarts the game
    const playAgainBtn = page.locator("#play-again-btn");
    await expect(playAgainBtn).toBeFocused();
    await playAgainBtn.click();

    await expect(modal).not.toHaveAttribute("open", "");
    await expect(page.locator("#current-round")).toHaveText("1");
    await expect(page.locator("#score-count")).toHaveText("0");
    await expect(page.locator("#skip-btn")).toBeEnabled();
  });

  test("focus trap: Tab navigation cannot escape the open modal dialog to background controls", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "Tab navigation is desktop-specific");
    await page.goto("./");

    await page.evaluate(() => {
      const skipBtn = document.getElementById("skip-btn");
      while (!document.getElementById("game-over-modal").open) {
        skipBtn.click();
      }
    });

    const modal = page.locator("#game-over-modal");
    await expect(modal).toBeVisible();

    const playAgainBtn = page.locator("#play-again-btn");
    await expect(playAgainBtn).toBeFocused();

    // Press Tab repeatedly: background controls must remain inert and unreachable
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const activeEl = await page.evaluate(() =>
        document.activeElement
          ? document.activeElement.id || document.activeElement.tagName
          : "",
      );
      expect(["sound-toggle", "restart-btn", "skip-btn"]).not.toContain(
        activeEl,
      );
    }
  });
});
