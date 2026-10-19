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

    await page.route("**/api/scores*", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() || {};
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            topScores: [body],
            names: [body.name],
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            topScores: [
              {
                name: "Alex",
                score: 25,
                total: 50,
                accuracy: "75%",
                streak: 8,
                date: "2026-10-18",
              },
            ],
            names: ["Alex"],
          }),
        });
      }
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

    const leaderboardBtn = page.locator("#leaderboard-btn");
    await expect(leaderboardBtn).toBeVisible();
    await expect(leaderboardBtn).toHaveAttribute(
      "aria-label",
      "View top scores",
    );

    const restartBtn = page.locator("#restart-btn");
    await expect(restartBtn).toBeVisible();
    await expect(restartBtn).toHaveAttribute("aria-label", "Restart game");

    // Prompt card section
    await expect(page.locator("#prompt-card")).toBeVisible();
    await expect(page.locator(".prompt-label")).toHaveText("Find:");
    const targetState = page.locator("#target-state-name");
    await expect(targetState).toBeVisible();
    const initialTargetName = await targetState.textContent();
    expect(initialTargetName.trim().length).toBeGreaterThan(0);

    // Strikes counter with 3 pips
    const strikesCard = page.locator("#strikes-card");
    await expect(strikesCard).toBeVisible();
    const strikesCount = page.locator("#strikes-count");
    await expect(strikesCount).toHaveText("0 / 3");
    await expect(strikesCount).toHaveAttribute("aria-label", "0 of 3 strikes");
    const pips = page.locator(".strike-pips .pip");
    await expect(pips).toHaveCount(3);
    await expect(page.locator(".strike-pips .pip.active")).toHaveCount(0);

    // Stats bar: progress, score, streak, accuracy
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

    // Live status announcement
    const liveStatus = page.locator("#status-live");
    await expect(liveStatus).toContainText("Game started. Find");

    // Modals closed initially
    await expect(page.locator("#game-over-modal")).not.toHaveAttribute(
      "open",
      "",
    );
    await expect(page.locator("#leaderboard-modal")).not.toHaveAttribute(
      "open",
      "",
    );
  });

  test("accessibility: zero axe violations across initial, mid-game (1 strike), game-over (3 strikes), and leaderboard modal", async ({
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

    // 3. Mid-game audit with 1 strike
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const wrongState = page
      .locator(`.state:not([data-name="${targetName}"])`)
      .first();
    await wrongState.dispatchEvent("click");
    await expect(page.locator("#strikes-count")).toHaveText("1 / 3");

    const midGameScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(midGameScan.violations).toEqual([]);

    // 4. 3 strikes game-over audit (target revealed and save-score form visible)
    await wrongState.dispatchEvent("click");
    await wrongState.dispatchEvent("click");

    const modal = page.locator("#game-over-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#save-score-form")).toBeVisible();

    const gameOverScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(gameOverScan.violations).toEqual([]);

    // 5. Leaderboard modal open audit
    await page.locator("#play-again-btn").click();
    await expect(modal).not.toHaveAttribute("open", "");

    await page.locator("#leaderboard-btn").click();
    const leaderboardModal = page.locator("#leaderboard-modal");
    await expect(leaderboardModal).toBeVisible();

    const leaderboardScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(leaderboardScan.violations).toEqual([]);
  });

  test("gameplay: clicking correct target state increments score & streak and marks state correct", async ({
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

  test("gameplay: clicking wrong state increments strikes and activates pip", async ({
    page,
  }) => {
    await page.goto("./");

    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const wrongState = page
      .locator(`.state:not([data-name="${targetName}"])`)
      .first();
    const wrongStateName = await wrongState.getAttribute("data-name");

    await wrongState.dispatchEvent("click");

    await expect(page.locator("#strikes-count")).toHaveText("1 / 3");
    await expect(page.locator(".strike-pips .pip.active")).toHaveCount(1);
    await expect(page.locator("#streak-count")).toHaveText("0");
    await expect(page.locator("#status-live")).toContainText(
      `Incorrect. That was ${wrongStateName}`,
    );
    // Target state remains unchanged
    await expect(page.locator("#target-state-name")).toHaveText(targetName);
  });

  test("gameplay: 3 wrong guesses triggers 3rd strike, reveals target state, and displays game over modal", async ({
    page,
  }) => {
    await page.goto("./");

    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const targetState = page.locator(`.state[data-name="${targetName}"]`);
    const wrongState = page
      .locator(`.state:not([data-name="${targetName}"])`)
      .first();

    // 1st wrong guess
    await wrongState.dispatchEvent("click");
    await expect(page.locator("#strikes-count")).toHaveText("1 / 3");
    await expect(page.locator(".strike-pips .pip.active")).toHaveCount(1);

    // 2nd wrong guess
    await wrongState.dispatchEvent("click");
    await expect(page.locator("#strikes-count")).toHaveText("2 / 3");
    await expect(page.locator(".strike-pips .pip.active")).toHaveCount(2);

    // 3rd wrong guess
    await wrongState.dispatchEvent("click");
    await expect(page.locator("#strikes-count")).toHaveText("3 / 3");
    await expect(page.locator(".strike-pips .pip.active")).toHaveCount(3);

    // Target state gets data-status="revealed"
    await expect(targetState).toHaveAttribute("data-status", "revealed");

    // Modal opens after strike timeout and displays "Game Over (3 Strikes)"
    const modal = page.locator("#game-over-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#game-over-title")).toHaveText(
      "Game Over (3 Strikes)",
    );
    await expect(page.locator("#game-over-summary")).toContainText("3 strikes");

    // Play again restarts the game
    const playAgainBtn = page.locator("#play-again-btn");
    await playAgainBtn.click();
    await expect(modal).not.toHaveAttribute("open", "");
    await expect(page.locator("#strikes-count")).toHaveText("0 / 3");
    await expect(page.locator("#score-count")).toHaveText("0");
    await expect(page.locator(".strike-pips .pip.active")).toHaveCount(0);
    await expect(targetState).not.toHaveAttribute("data-status", /.*/);
  });

  test("leaderboard: name input autocomplete has datalist and saves score", async ({
    page,
  }) => {
    await page.goto("./");

    // Datalist is populated from existing scores
    const datalist = page.locator("#player-names-list");
    await expect(datalist).toBeAttached();
    await expect(datalist.locator("option")).toHaveCount(1);
    await expect(datalist.locator("option").first()).toHaveAttribute(
      "value",
      "Alex",
    );

    // Trigger 3 strikes to open game over modal
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const wrongState = page
      .locator(`.state:not([data-name="${targetName}"])`)
      .first();
    await wrongState.dispatchEvent("click");
    await wrongState.dispatchEvent("click");
    await wrongState.dispatchEvent("click");

    const modal = page.locator("#game-over-modal");
    await expect(modal).toBeVisible();

    const nameInput = page.locator("#player-name");
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveAttribute("list", "player-names-list");

    // Enter player name and submit
    await nameInput.fill("Taylor");
    await page.locator("#submit-score-btn").click();

    await expect(page.locator("#submit-score-btn")).toHaveText("Saved!");
    await expect(page.locator("#game-over-leaderboard")).toContainText(
      "Taylor",
    );
    await expect(page.locator("#status-live")).toContainText(
      "Score saved successfully",
    );
  });

  test("leaderboard modal: opening via leaderboard button displays table and closing dismisses it", async ({
    page,
  }) => {
    await page.goto("./");

    const leaderboardBtn = page.locator("#leaderboard-btn");
    await leaderboardBtn.click();

    const modal = page.locator("#leaderboard-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#leaderboard-title")).toHaveText(
      "Top 10 Scores",
    );
    await expect(page.locator("#leaderboard-table")).toBeVisible();
    await expect(page.locator("#leaderboard-table")).toContainText("Alex");

    const closeBtn = page.locator("#close-leaderboard-btn");
    await closeBtn.click();
    await expect(modal).not.toHaveAttribute("open", "");
  });

  test("keyboard navigation: state paths and controls can be activated via Enter and Space", async ({
    page,
  }) => {
    await page.goto("./");

    // 1. Activate sound toggle via Space key
    const soundToggle = page.locator("#sound-toggle");
    await soundToggle.focus();
    await page.keyboard.press("Space");
    await expect(soundToggle).toHaveAttribute("aria-pressed", "true");

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

  test("restart button: resets game progress, scores, strikes, and state statuses", async ({
    page,
  }) => {
    await page.goto("./");

    // Make one correct guess
    const targetName = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    await page
      .locator(`.state[data-name="${targetName}"]`)
      .dispatchEvent("click");
    await expect(page.locator("#score-count")).toHaveText("1");

    // Make one wrong guess
    const nextTarget = (
      await page.locator("#target-state-name").textContent()
    ).trim();
    const wrongState = page
      .locator(
        `.state:not([data-name="${nextTarget}"]):not([data-status="correct"])`,
      )
      .first();
    await wrongState.dispatchEvent("click");
    await expect(page.locator("#strikes-count")).toHaveText("1 / 3");

    // Restart game
    await page.locator("#restart-btn").click();

    await expect(page.locator("#current-round")).toHaveText("1");
    await expect(page.locator("#score-count")).toHaveText("0");
    await expect(page.locator("#streak-count")).toHaveText("0");
    await expect(page.locator("#strikes-count")).toHaveText("0 / 3");
    await expect(page.locator("#accuracy-rate")).toHaveText("100%");

    // Verify all states have no data-status
    const statesWithStatus = page.locator(".state[data-status]");
    await expect(statesWithStatus).toHaveCount(0);

    // Verify strike pips are inactive
    const activePips = page.locator(".strike-pips .pip.active");
    await expect(activePips).toHaveCount(0);

    await expect(page.locator("#status-live")).toContainText("Game restarted");
  });

  test("focus trap: Tab navigation cannot escape the open modal dialog to background controls", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "Tab navigation is desktop-specific");
    await page.goto("./");

    await page.locator("#leaderboard-btn").click();
    const modal = page.locator("#leaderboard-modal");
    await expect(modal).toBeVisible();

    const closeBtn = page.locator("#close-leaderboard-btn");
    await expect(closeBtn).toBeFocused();

    // Press Tab repeatedly: background controls must remain inert and unreachable
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const activeEl = await page.evaluate(() =>
        document.activeElement
          ? document.activeElement.id || document.activeElement.tagName
          : "",
      );
      expect(["sound-toggle", "restart-btn", "leaderboard-btn"]).not.toContain(
        activeEl,
      );
    }
  });
});
