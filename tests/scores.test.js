const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const handler = require("../api/scores.js");
const {
  getDayKey,
  filterTodayScores,
  sortTopScores,
  extractUniqueNames,
  validateScoreEntry,
  isTopScore,
  selectPrunableSnapshots,
  fetchBlobScores,
  uploadBlobScores,
  _resetMemoryStore,
  _resetRateLimits,
  isAllowedOrigin,
  checkRateLimit,
} = handler;

// Helper to create mock HTTP request
function createMockReq({
  method = "GET",
  body = null,
  streamBody = null,
  headers = {},
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {
    "content-type": "application/json",
    host: "game.example.com",
    origin: "https://game.example.com",
    "x-forwarded-for": "203.0.113.7",
    ...headers,
  };
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

test("selectPrunableSnapshots retains keep newest snapshots and prunes older ones", () => {
  const now = 2000;
  const blobs = [
    { pathname: "scores-2000.json", url: "https://blob/scores-2000.json" },
    { pathname: "scores-1900.json", url: "https://blob/scores-1900.json" },
    { pathname: "scores-1800.json", url: "https://blob/scores-1800.json" },
    { pathname: "scores-1500.json", url: "https://blob/scores-1500.json" },
  ];

  // With keep=2: 2000 and 1900 retained. 1800 and 1500 are older than now (2000) -> pruned
  const prunable = selectPrunableSnapshots(blobs, now, 2);
  assert.deepEqual(prunable, [
    "https://blob/scores-1800.json",
    "https://blob/scores-1500.json",
  ]);
});

test("selectPrunableSnapshots handles random suffix in pathname", () => {
  const now = 3000;
  const blobs = [
    {
      pathname: "scores-3000-abc123_.json",
      url: "https://blob/scores-3000-abc123_.json",
    },
    {
      pathname: "scores-2500-def456.json",
      url: "https://blob/scores-2500-def456.json",
    },
    {
      pathname: "scores-1000-xyz.json",
      url: "https://blob/scores-1000-xyz.json",
    },
  ];

  const prunable = selectPrunableSnapshots(blobs, now, 2);
  assert.deepEqual(prunable, ["https://blob/scores-1000-xyz.json"]);
});

test("selectPrunableSnapshots ignores non-snapshot files and future timestamps", () => {
  const now = 2000;
  const blobs = [
    { pathname: "scores.json", url: "https://blob/scores.json" },
    { pathname: "scores-2500.json", url: "https://blob/scores-2500.json" }, // Future write from concurrent node
    { pathname: "scores-2000.json", url: "https://blob/scores-2000.json" },
    { pathname: "scores-1900.json", url: "https://blob/scores-1900.json" },
    { pathname: "scores-1000.json", url: "https://blob/scores-1000.json" },
  ];

  // 2500 and 2000 are the 2 freshest.
  // 1900 and 1000 are candidate older snapshots (< 2000)
  const prunable = selectPrunableSnapshots(blobs, now, 2);
  assert.deepEqual(prunable, [
    "https://blob/scores-1900.json",
    "https://blob/scores-1000.json",
  ]);
});

test("selectPrunableSnapshots returns empty on empty or invalid inputs", () => {
  assert.deepEqual(selectPrunableSnapshots([], 1000), []);
  assert.deepEqual(selectPrunableSnapshots(null, 1000), []);
  assert.deepEqual(selectPrunableSnapshots(undefined, 1000), []);
});

test("fetchBlobScores returns ok:false and error message when list API fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
  });

  try {
    const res = await fetchBlobScores("mock-token");
    assert.equal(res.ok, false);
    assert.deepEqual(res.topScores, []);
    assert.ok(res.error.includes("500"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchBlobScores returns ok:true with empty array when no blobs exist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ blobs: [] }),
  });

  try {
    const res = await fetchBlobScores("mock-token");
    assert.equal(res.ok, true);
    assert.deepEqual(res.topScores, []);
    assert.deepEqual(res.names, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handler returns 502 on GET/POST when Blob storage read fails", async () => {
  const oldScoresToken = process.env.SCORES_READ_WRITE_TOKEN;
  process.env.SCORES_READ_WRITE_TOKEN = "mock-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
  });

  try {
    // 1. GET returns 502
    const getReq = createMockReq({ method: "GET" });
    const getRes = createMockRes();
    await handler(getReq, getRes);
    assert.equal(getRes.statusCode, 502);
    assert.equal(getRes.body.error, "Could not read leaderboard");

    // 2. POST returns 502 without modifying or writing
    const postReq = createMockReq({
      method: "POST",
      body: { name: "Sam", score: 20, accuracy: 80, streak: 3 },
    });
    const postRes = createMockRes();
    await handler(postReq, postRes);
    assert.equal(postRes.statusCode, 502);
    assert.equal(postRes.body.error, "Could not read leaderboard");
  } finally {
    globalThis.fetch = originalFetch;
    if (oldScoresToken) process.env.SCORES_READ_WRITE_TOKEN = oldScoresToken;
    else delete process.env.SCORES_READ_WRITE_TOKEN;
  }
});

test("getDayKey and filterTodayScores reset scores at midnight America/Chicago", () => {
  // 2026-10-20T04:30:00.000Z is 2026-10-19 23:30:00 CDT (America/Chicago, UTC-5)
  // 2026-10-20T05:30:00.000Z is 2026-10-20 00:30:00 CDT (America/Chicago, UTC-5)
  const beforeMidnightCDT = "2026-10-20T04:30:00.000Z";
  const afterMidnightCDT = "2026-10-20T05:30:00.000Z";

  assert.equal(getDayKey(beforeMidnightCDT, "America/Chicago"), "2026-10-19");
  assert.equal(getDayKey(afterMidnightCDT, "America/Chicago"), "2026-10-20");

  const entries = [
    { name: "YesterdayPlayer", score: 49, date: beforeMidnightCDT },
    { name: "TodayPlayer", score: 35, date: afterMidnightCDT },
  ];

  const filtered = filterTodayScores(
    entries,
    new Date("2026-10-20T12:00:00.000Z"),
    "America/Chicago",
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "TodayPlayer");
});

test("daily reset preserves player name suggestions across days while resetting topScores", async () => {
  const yesterdayScore = {
    id: "yesterday-1",
    name: "VeteranPlayer",
    score: 50,
    accuracy: 100,
    streak: 50,
    date: "2020-01-01T12:00:00.000Z",
  };
  _resetMemoryStore({
    topScores: [yesterdayScore],
    names: ["EarlierPlayer"],
  });

  const oldScoresToken = process.env.SCORES_READ_WRITE_TOKEN;
  const oldBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.SCORES_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  try {
    // GET on a new day returns empty topScores but retains names from previous days
    const getReq = createMockReq({ method: "GET" });
    const getRes = createMockRes();
    await handler(getReq, getRes);
    assert.equal(getRes.statusCode, 200);
    assert.deepEqual(getRes.body.topScores, []);
    assert.deepEqual(getRes.body.names, ["EarlierPlayer", "VeteranPlayer"]);

    // POST on the new day starts fresh topScores while keeping cumulative names
    const postReq = createMockReq({
      method: "POST",
      body: { name: "NewDayPlayer", score: 25, accuracy: 80, streak: 5 },
    });
    const postRes = createMockRes();
    await handler(postReq, postRes);
    assert.equal(postRes.statusCode, 200);
    assert.equal(postRes.body.topScores.length, 1);
    assert.equal(postRes.body.topScores[0].name, "NewDayPlayer");
    assert.deepEqual(postRes.body.names, [
      "EarlierPlayer",
      "NewDayPlayer",
      "VeteranPlayer",
    ]);
  } finally {
    if (oldScoresToken) process.env.SCORES_READ_WRITE_TOKEN = oldScoresToken;
    if (oldBlobToken) process.env.BLOB_READ_WRITE_TOKEN = oldBlobToken;
  }
});

test("isAllowedOrigin accepts same-host and configured origins only", () => {
  const mk = (headers) => ({ headers });
  assert.equal(
    isAllowedOrigin(
      mk({ origin: "https://game.example.com", host: "game.example.com" }),
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      mk({
        origin: "https://mike.pullen.dev",
        host: "state-guessing-game.vercel.app",
      }),
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      mk({
        origin: "https://proxy.example.org",
        host: "internal.vercel.app",
        "x-forwarded-host": "proxy.example.org",
      }),
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      mk({ origin: "https://evil.example", host: "game.example.com" }),
    ),
    false,
  );
  assert.equal(isAllowedOrigin(mk({ host: "game.example.com" })), false);
  assert.equal(
    isAllowedOrigin(mk({ origin: "null", host: "game.example.com" })),
    false,
  );
  assert.equal(
    isAllowedOrigin(
      mk({ origin: "ftp://game.example.com", host: "game.example.com" }),
    ),
    false,
  );

  const old = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://extra.example, https://other.example";
  try {
    assert.equal(
      isAllowedOrigin(
        mk({ origin: "https://extra.example", host: "game.example.com" }),
      ),
      true,
    );
  } finally {
    if (old === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = old;
  }
});

test("checkRateLimit allows 5 per window per client, then resets", () => {
  _resetRateLimits();
  const reqA = { headers: { "x-forwarded-for": "198.51.100.1" } };
  const reqB = { headers: { "x-forwarded-for": "198.51.100.2" } };
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit(reqA, t0 + i).limited, false);
  }
  const blocked = checkRateLimit(reqA, t0 + 10_000);
  assert.equal(blocked.limited, true);
  assert.equal(blocked.retryAfter, 50);
  assert.equal(checkRateLimit(reqB, t0 + 10_000).limited, false);
  assert.equal(checkRateLimit(reqA, t0 + 60_000).limited, false);
  _resetRateLimits();
});

test("handler POST rejects bad or missing Origin with 403 and does not record", async () => {
  _resetMemoryStore();
  _resetRateLimits();
  const body = { name: "Mallory", score: 50, accuracy: 100, streak: 50 };
  for (const origin of ["https://evil.example", undefined]) {
    const req = createMockReq({ method: "POST", body });
    if (origin === undefined) delete req.headers.origin;
    else req.headers.origin = origin;
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  }
  const getRes = createMockRes();
  await handler(createMockReq({ method: "GET" }), getRes);
  assert.equal(getRes.body.topScores.length, 0);
});

test("handler POST returns 429 with Retry-After after too many requests", async () => {
  _resetMemoryStore();
  _resetRateLimits();
  const body = { name: "Bob", score: 10, accuracy: 50, streak: 2 };
  for (let i = 0; i < 5; i++) {
    const res = createMockRes();
    await handler(createMockReq({ method: "POST", body }), res);
    assert.equal(res.statusCode, 200);
  }
  const limited = createMockRes();
  await handler(createMockReq({ method: "POST", body }), limited);
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.getHeader("Retry-After")) >= 1);

  const other = createMockRes();
  await handler(
    createMockReq({
      method: "POST",
      body,
      headers: { "x-forwarded-for": "203.0.113.99" },
    }),
    other,
  );
  assert.equal(other.statusCode, 200);

  const getRes = createMockRes();
  await handler(createMockReq({ method: "GET" }), getRes);
  assert.equal(getRes.statusCode, 200);
  _resetRateLimits();
});

test("app.js and api/scores.js agree on the leaderboard day key", () => {
  const app = require("../app.js");
  const samples = [
    "2026-01-01T05:59:59Z", // still Dec 31 in Chicago
    "2026-01-01T06:00:00Z", // midnight Chicago
    "2026-07-04T04:59:59Z", // CDT: still Jul 3
    "2026-07-04T05:00:00Z",
    "not-a-date",
    null,
  ];
  for (const sample of samples) {
    assert.equal(app.getDayKey(sample), getDayKey(sample), String(sample));
  }
  const now = new Date("2026-07-04T12:00:00Z");
  const scores = [
    { id: "a", date: "2026-07-04T05:00:00Z" },
    { id: "b", date: "2026-07-04T04:59:59Z" },
  ];
  assert.deepEqual(
    app.filterTodayScores(scores, now).map((s) => s.id),
    filterTodayScores(scores, now).map((s) => s.id),
  );
});
