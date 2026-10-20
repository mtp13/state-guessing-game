const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

function readPngHeader(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.equal(buf.toString("ascii", 12, 16), "IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
  };
}

test("index.html contains required semantic structure, controls, and IDs", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html\s+lang="en">/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /id="sound-toggle"/);
  assert.match(html, /id="restart-btn"/);
  assert.match(html, /id="prompt-card"/);
  assert.match(html, /id="target-state-name"/);
  assert.match(html, /id="strikes-card"/);
  assert.match(html, /id="strikes-count"/);
  assert.match(html, /class="[^"]*strike-pips[^"]*"/);
  assert.match(html, /id="leaderboard-btn"/);
  assert.match(html, /id="leaderboard-modal"/);
  assert.match(html, /id="player-name"/);
  assert.match(html, /id="player-names-list"/);
  assert.match(html, /id="save-score-form"/);
  assert.match(html, /id="current-round"/);
  assert.match(html, /id="total-rounds"/);
  assert.match(html, /id="score-count"/);
  assert.match(html, /id="streak-count"/);
  assert.match(html, /id="accuracy-rate"/);
  assert.match(html, /id="progress-bar"/);
  assert.match(html, /<progress\s+id="progress-bar"/);
  assert.match(html, /id="status-live"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="game-over-modal"/);
  assert.match(html, /id="close-game-over-btn"/);
  assert.match(html, /id="review-map-btn"/);
  assert.match(html, /id="play-again-btn"/);
  assert.match(html, /id="view-results-btn"/);
  assert.match(html, /id="new-game-btn"/);
  assert.match(html, /id="close-leaderboard-top-btn"/);
  assert.match(html, /id="confetti-canvas"/);
});

test("index.html inline SVG contains all 50 state paths matching states-data.js", () => {
  const { STATES } = require("../states-data.js");
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  for (const state of STATES) {
    assert.match(
      html,
      new RegExp(
        `id="${state.id}"[\\s\\S]*?data-name="${state.name}"|data-name="${state.name}"[\\s\\S]*?id="${state.id}"`,
      ),
      `Expected state ${state.id} (${state.name}) in index.html`,
    );
  }
});

test("keeps every in-page href and src relative (no root-anchored paths)", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);

  assert.ok(refs.length > 0, "Must have href/src references");
  for (const ref of refs) {
    assert.ok(!ref.startsWith("/"), `Root-anchored path found: ${ref}`);
  }
});

test("referenced static assets exist on disk", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);

  for (const ref of refs) {
    if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
    const cleanPath = ref.split("?")[0].split("#")[0];
    const assetPath = path.join(rootDir, cleanPath);
    assert.ok(
      fs.existsSync(assetPath),
      `Referenced file missing: ${cleanPath}`,
    );
  }
});

test("no inline scripts, styles, or on* handlers in HTML", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");

  // No inline style attributes
  assert.doesNotMatch(html, /\sstyle="/i, "No inline style attributes allowed");

  // No <style> tags
  assert.doesNotMatch(
    html,
    /<style\b[^>]*>/i,
    "No inline <style> tags allowed",
  );

  // No inline event handlers like onclick=, onkeydown=
  assert.doesNotMatch(
    html,
    /\son[a-z]+="/i,
    "No inline on* event handlers allowed",
  );

  // No inline scripts: every <script> must have src="..."
  const scriptTags = [
    ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi),
  ];
  for (const [, attrs, content] of scriptTags) {
    assert.match(attrs, /\bsrc="/, "Every <script> must have a src attribute");
    assert.equal(content.trim(), "", "No inline script content allowed");
  }
});

test("manifest.webmanifest is valid and icons exist with correct dimensions", () => {
  const raw = fs.readFileSync(
    path.join(rootDir, "manifest.webmanifest"),
    "utf8",
  );
  const manifest = JSON.parse(raw);

  assert.equal(manifest.name, "US State Guessing Game");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === "maskable"),
    "Expected at least one maskable icon entry",
  );

  for (const icon of manifest.icons) {
    const iconPath = path.join(rootDir, icon.src);
    assert.ok(fs.existsSync(iconPath), `Missing icon file: ${icon.src}`);
    const { width, height } = readPngHeader(iconPath);
    assert.equal(
      `${width}x${height}`,
      icon.sizes,
      `Size mismatch for ${icon.src}`,
    );
  }

  // iOS apple-touch-icon must be 180x180
  const touchIcon = readPngHeader(path.join(rootDir, "icon-180.png"));
  assert.equal(touchIcon.width, 180);
  assert.equal(touchIcon.height, 180);
});

function extractLayerBlock(css, name) {
  const start = css.search(new RegExp(`@layer\\s+${name}\\s*\\{`));
  if (start === -1) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return null;
}

test("style.css declares and organizes CSS layers with reduced-motion inside utilities", () => {
  const css = fs.readFileSync(path.join(rootDir, "style.css"), "utf8");

  assert.match(
    css,
    /@layer\s+reset,\s*base,\s*theme,\s*components,\s*utilities;/,
    "Expected standard CSS layer declaration",
  );

  const utilitiesLayer = extractLayerBlock(css, "utilities");
  assert.ok(utilitiesLayer, "@layer utilities must be defined");
  assert.match(
    utilitiesLayer,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    "Reduced-motion overrides must be defined inside @layer utilities per AGENTS.md",
  );
});

test("index.html does not contain unused prompt-label id but retains prompt-label class", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  assert.doesNotMatch(
    html,
    /id="prompt-label"/,
    'Unused id="prompt-label" must be removed per R4',
  );
  assert.match(
    html,
    /class="[^"]*prompt-label[^"]*"/,
    "Visual class .prompt-label must be preserved for label styling",
  );
});

test("index.html contains accessible game mode selector controls", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  assert.match(
    html,
    /(?:role="radiogroup"|class="[^"]*mode-selector[^"]*")/i,
    "Expected accessible mode selector radiogroup or container",
  );
  assert.match(
    html,
    /id="mode-challenge|data-mode="challenge"/i,
    "Expected Challenge mode option",
  );
  assert.match(
    html,
    /id="mode-practice|data-mode="practice"/i,
    "Expected Practice mode option",
  );
});

test("index.html contains HUD stat cards for both strikes and guesses", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  assert.match(html, /id="strikes-card"/, "Strikes card must exist");
  assert.match(html, /id="strikes-count"/, "Strikes count must exist");
  assert.match(html, /id="guesses-card"/, "Guesses card must exist");
  assert.match(html, /id="guesses-count"/, "Guesses count must exist");
  assert.match(html, /id="best-score"/, "Best score element must exist");
});

test("vercel.json deploys only master (branch names with / need **, not *)", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"),
  );
  assert.deepEqual(config.git?.deploymentEnabled, {
    master: true,
    "**": false,
  });
});
