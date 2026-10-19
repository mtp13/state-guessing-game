const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { STATES } = require("../states-data.js");

test("states-data contains all 50 US states with required properties", () => {
  assert.equal(STATES.length, 50, "STATES must have exactly 50 states");

  const ids = new Set();
  const names = new Set();
  const capitals = new Set();
  const validRegions = new Set(["Northeast", "Midwest", "South", "West"]);

  for (const state of STATES) {
    assert.ok(state.id, "state.id must exist");
    assert.equal(state.id.length, 2, "state.id must be 2 characters");
    assert.equal(
      state.id,
      state.id.toUpperCase(),
      "state.id must be uppercase",
    );
    assert.ok(!ids.has(state.id), `Duplicate state id: ${state.id}`);
    ids.add(state.id);

    assert.ok(state.name, `state.name must exist for ${state.id}`);
    assert.ok(!names.has(state.name), `Duplicate state name: ${state.name}`);
    names.add(state.name);

    assert.ok(state.capital, `state.capital must exist for ${state.id}`);
    assert.ok(
      !capitals.has(state.capital),
      `Duplicate state capital: ${state.capital}`,
    );
    capitals.add(state.capital);

    assert.ok(
      validRegions.has(state.region),
      `Invalid region "${state.region}" for ${state.id}`,
    );
  }
});

test("map.svg contains all 50 states matching states-data", () => {
  const mapPath = path.join(__dirname, "..", "map.svg");
  assert.ok(fs.existsSync(mapPath), "map.svg must exist");

  const svg = fs.readFileSync(mapPath, "utf8");
  assert.match(
    svg,
    /viewBox="0 0 959 593"/,
    "map.svg must have responsive viewBox",
  );

  const stateRegex =
    /<path\s+id="([A-Z]{2})"\s+data-name="([^"]+)"\s+class="state"\s+role="button"\s+tabindex="0"\s+aria-label="([^"]+)"\s+d="([^"]+)"><\/path>/g;

  const matches = [...svg.matchAll(stateRegex)];
  assert.equal(
    matches.length,
    50,
    `Expected 50 state path elements in map.svg, found ${matches.length}`,
  );

  const stateMap = new Map(STATES.map((s) => [s.id, s]));

  for (const m of matches) {
    const [, id, dataName, ariaLabel, d] = m;
    assert.ok(stateMap.has(id), `Unknown state id ${id} in SVG`);
    const expected = stateMap.get(id);
    assert.equal(dataName, expected.name, `data-name mismatch for ${id}`);
    assert.equal(ariaLabel, expected.name, `aria-label mismatch for ${id}`);
    assert.ok(d.length > 10, `Path d looks invalid for ${id}`);
  }

  // Ensure no <title> tags inside state paths (prevents hover tooltip cheating)
  assert.equal(
    svg.includes("<title>Alabama</title>"),
    false,
    "map.svg state paths must not contain <title> tags to prevent hover tooltip cheating",
  );
});
