const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const handler = require("../api/scores.js");
const {
  sortTopScores,
  extractUniqueNames,
  validateScoreEntry,
  isTopScore,
  _resetMemoryStore,
} = handler;

// Helper to create mock HTTP request
function createMockReq({
  method = "GET",
  body = null,
  streamBody = null,
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { "content-type": "application/json" };
  if (streamBody !== null) {
    req.body = undefined;
    process.nextTick(() => {
      req.emit("data", Buffer.from(streamBody));
      req.emit("end");
    });
  } else {
    req.body = body;
  }
  return req;
}

// Helper to create mock HTTP response
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    getHeader(key) {
      return this.headers[key.toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    end(data) {
      if (data && typeof data === "string" && !this.body) {
        try {
          this.body = JSON.parse(data);
        } catch {
          this.body = data;
        }
      }
      return this;
    },
  };
  return res;
}

test("sortTopScores sorts by score descending", () => {
  const entries = [
    { name: "Bob", score: 20, date: "2026-01-01T00:00:00Z" },
    { name: "Alice", score: 50, date: "2026-01-01T00:00:00Z" },
    { name: "Charlie", score: 35, date: "2026-01-01T00:00:00Z" },
  ];

  const sorted = sortTopScores(entries);
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].name, "Alice");
  assert.equal(sorted[1].name, "Charlie");
  assert.equal(sorted[2].name, "Bob");
});

test("sortTopScores breaks ties by date ascending (earlier date first)", () => {
  const entries = [
    { name: "Late", score: 50, date: "2026-01-02T12:00:00Z" },
    { name: "Early", score: 50, date: "2026-01-01T08:00:00Z" },
    { name: "Middle", score: 50, date: "2026-01-01T15:00:00Z" },
  ];

  const sorted = sortTopScores(entries);
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].name, "Early");
  assert.equal(sorted[1].name, "Middle");
  assert.equal(sorted[2].name, "Late");
});

test("sortTopScores caps output at max and does not mutate input", () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({
    name: `Player ${i}`,
    score: i * 5,
    date: new Date(2026, 0, i + 1).toISOString(),
  }));
  const originalCopy = JSON.parse(JSON.stringify(entries));

  const top10 = sortTopScores(entries);
  assert.equal(top10.length, 10);
  assert.equal(top10[0].score, 70);
  assert.equal(top10[9].score, 25);

  const top5 = sortTopScores(entries, 5);
  assert.equal(top5.length, 5);
  assert.equal(top5[0].score, 70);
  assert.equal(top5[4].score, 50);

  assert.deepEqual(entries, originalCopy, "Input array must not be mutated");
});

test("sortTopScores handles empty and invalid inputs gracefully", () => {
  assert.deepEqual(sortTopScores([]), []);
  assert.deepEqual(sortTopScores(null), []);
  assert.deepEqual(sortTopScores(undefined), []);
  assert.deepEqual(sortTopScores("not-an-array"), []);
  assert.deepEqual(sortTopScores([{ score: 10 }], 0), []);
  assert.deepEqual(sortTopScores([{ score: 10 }], -1), []);
});

test("extractUniqueNames trims names and dedupes case-insensitively", () => {
  const entries = [
    { name: "  Alice  " },
    { name: "bob" },
    { name: "ALICE" },
    { name: "Charlie" },
    { name: "Bob" },
    { name: "  " },
    { invalid: true },
  ];

  const names = extractUniqueNames(entries);
  assert.equal(names.length, 3);
  assert.deepEqual(names, ["Alice", "bob", "Charlie"]);
});

test("extractUniqueNames supports string arrays and sorts alphabetically", () => {
  const input = ["Zara", "alex", "Bob", "ALEX", " Charlie "];
  const names = extractUniqueNames(input);
  assert.deepEqual(names, ["alex", "Bob", "Charlie", "Zara"]);
});

test("extractUniqueNames handles empty and invalid inputs", () => {
  assert.deepEqual(extractUniqueNames([]), []);
  assert.deepEqual(extractUniqueNames(null), []);
  assert.deepEqual(extractUniqueNames(undefined), []);
});

test("validateScoreEntry accepts valid entries and sanitizes name", () => {
  const result = validateScoreEntry({
    name: "  <b>Champion</b>  ",
    score: 48,
    accuracy: 96,
    streak: 15,
  });

  assert.ok(result);
  assert.equal(result.name, "Champion");
  assert.equal(result.score, 48);
  assert.equal(result.accuracy, 96);
  assert.equal(result.streak, 15);
});

test("validateScoreEntry supports percentage string for accuracy", () => {
  const result = validateScoreEntry({
    name: "Runner",
    score: 40,
    accuracy: "92%",
    streak: 10,
  });

  assert.ok(result);
  assert.equal(result.accuracy, "92%");
});

test("validateScoreEntry strips HTML tags completely", () => {
  const result = validateScoreEntry({
    name: "<script>alert(1)</script>SafeName",
    score: 10,
    accuracy: 50,
    streak: 2,
  });

  assert.ok(result);
  assert.equal(result.name, "alert(1)SafeName");
});

test("validateScoreEntry rejects names outside 1-25 chars", () => {
  assert.equal(
    validateScoreEntry({
      name: "",
      score: 10,
      accuracy: 50,
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "   ",
      score: 10,
      accuracy: 50,
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "<div></div>",
      score: 10,
      accuracy: 50,
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "A".repeat(26),
      score: 10,
      accuracy: 50,
      streak: 2,
    }),
    null,
  );

  // Exactly 25 chars is valid
  const valid25 = validateScoreEntry({
    name: "A".repeat(25),
    score: 10,
    accuracy: 50,
    streak: 2,
  });
  assert.ok(valid25);
  assert.equal(valid25.name.length, 25);
});

test("validateScoreEntry rejects invalid score, accuracy, or streak", () => {
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: -5,
      accuracy: 50,
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: 10,
      accuracy: -1,
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: 10,
      accuracy: 105,
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: 10,
      accuracy: "invalid%",
      streak: 2,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: 10,
      accuracy: 50,
      streak: -1,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: 51,
      accuracy: 100,
      streak: 50,
    }),
    null,
  );
  assert.equal(
    validateScoreEntry({
      name: "Bob",
      score: 10,
      accuracy: 50,
      streak: 15,
    }),
    null,
  );
  assert.equal(validateScoreEntry(null), null);
  assert.equal(validateScoreEntry("not-an-object"), null);
});

test("isTopScore correctly identifies qualifying scores", () => {
  // Empty leaderboard
  assert.equal(isTopScore([], 10), true);

  // Fewer than 10 scores
  const partial = [
    { score: 50, date: "2026-01-01T00:00:00Z" },
    { score: 40, date: "2026-01-01T00:00:00Z" },
  ];
  assert.equal(isTopScore(partial, 0), true);
  assert.equal(isTopScore(partial, 30), true);

  // Full 10 scores
  const full = Array.from({ length: 10 }, (_, i) => ({
    name: `P${i}`,
    score: (10 - i) * 5, // 50, 45, 40, ..., 10, 5
    date: `2026-01-0${i + 1}T00:00:00Z`,
  }));

  // Higher than lowest (5)
  assert.equal(isTopScore(full, 6), true);
  assert.equal(isTopScore(full, 55), true);

  // Less than or equal to lowest (5)
  assert.equal(isTopScore(full, 5), false);
  assert.equal(isTopScore(full, 4), false);

  // Invalid score
  assert.equal(isTopScore(full, -1), false);
  assert.equal(isTopScore(full, "50"), false);
});

test("handler OPTIONS returns 204 with Allow header", async () => {
  const req = createMockReq({ method: "OPTIONS" });
  const res = createMockRes();

  await handler(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.getHeader("allow"), "GET, POST, OPTIONS");
});

test("handler unsupported method returns 405", async () => {
  const req = createMockReq({ method: "DELETE" });
  const res = createMockRes();

  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, "Method not allowed");
});

test("handler GET without token returns 200 with empty lists initially", async () => {
  _resetMemoryStore();
  const req = createMockReq({ method: "GET" });
  const res = createMockRes();

  // Ensure no token in env for fallback test
  const oldScoresToken = process.env.SCORES_READ_WRITE_TOKEN;
  const oldBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.SCORES_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  try {
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.getHeader("content-type"), "application/json");
    assert.equal(res.getHeader("x-content-type-options"), "nosniff");
    assert.deepEqual(res.body, { topScores: [], names: [] });
  } finally {
    if (oldScoresToken) process.env.SCORES_READ_WRITE_TOKEN = oldScoresToken;
    if (oldBlobToken) process.env.BLOB_READ_WRITE_TOKEN = oldBlobToken;
  }
});

test("handler POST without token validates, records, and returns updated lists", async () => {
  _resetMemoryStore();
  const oldScoresToken = process.env.SCORES_READ_WRITE_TOKEN;
  const oldBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.SCORES_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  try {
    // 1. Invalid payload returns 400
    const invalidReq = createMockReq({
      method: "POST",
      body: { name: "", score: 10 },
    });
    const invalidRes = createMockRes();
    await handler(invalidReq, invalidRes);
    assert.equal(invalidRes.statusCode, 400);

    // 2. Valid payload returns 200 and updates store
    const validReq = createMockReq({
      method: "POST",
      body: { name: "Alice", score: 45, accuracy: 90, streak: 8 },
    });
    const validRes = createMockRes();
    await handler(validReq, validRes);
    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.body.success, true);
    assert.equal(validRes.body.topScores.length, 1);
    assert.equal(validRes.body.topScores[0].name, "Alice");
    assert.equal(validRes.body.topScores[0].score, 45);
    assert.ok(validRes.body.topScores[0].id);
    assert.ok(validRes.body.topScores[0].date);
    assert.deepEqual(validRes.body.names, ["Alice"]);

    // 3. Subsequent GET returns the recorded score
    const getReq = createMockReq({ method: "GET" });
    const getRes = createMockRes();
    await handler(getReq, getRes);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.topScores.length, 1);
    assert.deepEqual(getRes.body.names, ["Alice"]);
  } finally {
    if (oldScoresToken) process.env.SCORES_READ_WRITE_TOKEN = oldScoresToken;
    if (oldBlobToken) process.env.BLOB_READ_WRITE_TOKEN = oldBlobToken;
  }
});

test("handler parses stream body if req.body is undefined", async () => {
  _resetMemoryStore();
  const oldScoresToken = process.env.SCORES_READ_WRITE_TOKEN;
  const oldBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.SCORES_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const streamReq = createMockReq({
      method: "POST",
      streamBody: JSON.stringify({
        name: "StreamUser",
        score: 30,
        accuracy: 80,
        streak: 5,
      }),
    });
    const res = createMockRes();
    await handler(streamReq, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.topScores[0].name, "StreamUser");
  } finally {
    if (oldScoresToken) process.env.SCORES_READ_WRITE_TOKEN = oldScoresToken;
    if (oldBlobToken) process.env.BLOB_READ_WRITE_TOKEN = oldBlobToken;
  }
});
