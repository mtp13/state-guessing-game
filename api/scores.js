/**
 * US State Guessing Game - Leaderboard Scores Serverless API
 * Runs on Vercel Serverless Functions (Node.js).
 */

const crypto = require("node:crypto");

// In-memory fallback for local development or environments without blob storage credentials
let memoryStore = {
  topScores: [],
  names: [],
};

// Daily leaderboard reset boundary timezone (US Central Time)
const LEADERBOARD_TIMEZONE = "America/Chicago";

/**
 * Formats a date or timestamp into a YYYY-MM-DD calendar day string in the specified timezone.
 *
 * @param {Date|string|number} [dateInput=new Date()]
 * @param {string} [timeZone=LEADERBOARD_TIMEZONE]
 * @returns {string} YYYY-MM-DD key or empty string if invalid
 */
function getDayKey(dateInput = new Date(), timeZone = LEADERBOARD_TIMEZONE) {
  if (dateInput === null || dateInput === undefined || dateInput === "") {
    return "";
  }
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Filters a list of score entries to retain only those recorded on the same
 * calendar day as `now` in the specified timezone.
 *
 * @param {Array<Object>} scores - Score entries
 * @param {Date|string|number} [now=new Date()] - Current reference time
 * @param {string} [timeZone=LEADERBOARD_TIMEZONE] - Timezone for day boundary
 * @returns {Array<Object>} Filtered scores from today
 */
function filterTodayScores(
  scores,
  now = new Date(),
  timeZone = LEADERBOARD_TIMEZONE,
) {
  if (!Array.isArray(scores)) return [];
  const todayKey = getDayKey(now, timeZone);
  if (!todayKey) return [];
  return scores.filter(
    (s) =>
      s && typeof s === "object" && getDayKey(s.date, timeZone) === todayKey,
  );
}

/**
 * Resets the in-memory fallback store (useful for testing).
 * @param {Object} [initial]
 */
function _resetMemoryStore(initial = { topScores: [], names: [] }) {
  memoryStore = {
    topScores: [...(initial.topScores || [])],
    names: [...(initial.names || [])],
  };
}

/**
 * Sorts scores by score descending, then date ascending, capped at max.
 * Does not mutate the input array.
 *
 * @param {Array<Object>} scores - Array of score entries
 * @param {number} [max=10] - Maximum number of scores to return
 * @returns {Array<Object>} Sorted and capped top scores
 */
function sortTopScores(scores, max = 10) {
  if (!Array.isArray(scores) || max <= 0) return [];
  const copy = [...scores];
  copy.sort((a, b) => {
    const scoreA = Number(a?.score) || 0;
    const scoreB = Number(b?.score) || 0;
    const diff = scoreB - scoreA;
    if (diff !== 0) return diff;

    const dateA = a?.date ? new Date(a.date).getTime() : 0;
    const dateB = b?.date ? new Date(b.date).getTime() : 0;
    return dateA - dateB;
  });
  return copy.slice(0, max);
}

/**
 * Extracts unique, trimmed names sorted alphabetically with case-insensitive deduplication.
 *
 * @param {Array<Object|string>} scores - Array of entries or strings
 * @returns {Array<string>} Unique, trimmed names sorted alphabetically
 */
function extractUniqueNames(scores) {
  if (!Array.isArray(scores)) return [];
  const seen = new Map();
  for (const item of scores) {
    const rawName = typeof item === "string" ? item : item?.name;
    if (typeof rawName !== "string") continue;
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, trimmed);
    }
  }
  const names = Array.from(seen.values());
  names.sort(
    (a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b),
  );
  return names;
}

/**
 * Validates and sanitizes a score entry { name, score, accuracy, streak }.
 * Sanitizes name (1-25 chars, trimmed, stripped of HTML tags).
 *
 * @param {Object} entry - Raw entry to validate
 * @returns {Object|null} Sanitized entry or null if invalid
 */
function validateScoreEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  if (typeof entry.name !== "string") return null;
  const sanitizedName = entry.name.replace(/<[^>]*>/g, "").trim();
  if (sanitizedName.length < 1 || sanitizedName.length > 25) return null;

  const MAX_SCORE = 50;
  if (
    typeof entry.score !== "number" ||
    !Number.isFinite(entry.score) ||
    entry.score <= 0 ||
    entry.score > MAX_SCORE
  ) {
    return null;
  }

  if (
    typeof entry.streak !== "number" ||
    !Number.isFinite(entry.streak) ||
    entry.streak < 0 ||
    entry.streak > entry.score
  ) {
    return null;
  }

  let accuracy = entry.accuracy;
  if (typeof accuracy === "number") {
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
      return null;
    }
  } else if (typeof accuracy === "string") {
    const trimmed = accuracy.trim();
    const num = Number(trimmed.replace(/%$/, ""));
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return null;
    }
    accuracy = trimmed;
  } else {
    return null;
  }

  return {
    name: sanitizedName,
    score: Math.round(entry.score),
    accuracy,
    streak: Math.round(entry.streak),
  };
}

// Origins allowed to POST besides the host serving the request (the hub site
// proxies production from a different host). Extend via ALLOWED_ORIGINS
// (comma-separated origins).
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DEFAULT_ALLOWED_ORIGINS = ["https://mike.pullen.dev"];

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_TRACKED = 1000;

// Best-effort per-instance limiter: serverless instances don't share memory,
// so this blunts bursts but is not a global guarantee.
const rateLimitHits = new Map();

/**
 * Clears rate limiter state (useful for testing).
 */
function _resetRateLimits() {
  rateLimitHits.clear();
}

function headerValue(req, name) {
  const value = req?.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.split(",")[0].trim() : "";
}

/**
 * Checks that a POST comes from a browser page on an allowed origin.
 * Browsers always send `Origin` on POST, so a missing header is rejected.
 *
 * @param {Object} req - HTTP request
 * @returns {boolean}
 */
function isAllowedOrigin(req) {
  const origin = headerValue(req, "origin");
  if (!origin) return false;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "https:" && originUrl.protocol !== "http:") {
    return false;
  }

  const hosts = [
    headerValue(req, "host"),
    headerValue(req, "x-forwarded-host"),
  ];
  if (hosts.includes(originUrl.host)) return true;

  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra].includes(originUrl.origin);
}

function getClientKey(req) {
  return (
    headerValue(req, "x-forwarded-for") ||
    headerValue(req, "x-real-ip") ||
    req?.socket?.remoteAddress ||
    "unknown"
  );
}

/**
 * Fixed-window rate limit per client address.
 *
 * @param {Object} req - HTTP request
 * @param {number} [now=Date.now()]
 * @returns {{ limited: boolean, retryAfter: number }}
 */
function checkRateLimit(req, now = Date.now()) {
  if (rateLimitHits.size >= RATE_LIMIT_MAX_TRACKED) {
    for (const [key, entry] of rateLimitHits) {
      if (now - entry.start >= RATE_LIMIT_WINDOW_MS) rateLimitHits.delete(key);
    }
    if (rateLimitHits.size >= RATE_LIMIT_MAX_TRACKED) rateLimitHits.clear();
  }

  const key = getClientKey(req);
  let entry = rateLimitHits.get(key);
  if (!entry || now - entry.start >= RATE_LIMIT_WINDOW_MS) {
    entry = { start: now, count: 0 };
    rateLimitHits.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return {
      limited: true,
      retryAfter: Math.max(
        1,
        Math.ceil((entry.start + RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    };
  }
  return { limited: false, retryAfter: 0 };
}

/**
 * Sends a JSON HTTP response with security headers.
 *
 * @param {Object} res - HTTP response object
 * @param {number} statusCode - HTTP status code
 * @param {Object} data - Payload to serialize
 */
function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const body = JSON.stringify(data);
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(statusCode).json(data);
  }
  return res.end(body);
}

/**
 * Parses request body from object, JSON string, or stream.
 *
 * @param {Object} req - HTTP request object
 * @returns {Promise<Object|null>}
 */
async function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.length > 0) {
    if (req.body.length > 16384) return null;
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (typeof req.on !== "function") {
    return null;
  }
  return new Promise((resolve) => {
    let raw = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > 16384) {
        tooLarge = true;
        raw = "";
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        return resolve(null);
      }
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

const SNAPSHOT_RE = /^scores-(\d+)(?:-[A-Za-z0-9_-]+)?\.json$/;

/**
 * Extracts numeric timestamp from a blob pathname or uploadedAt field.
 *
 * @param {Object} blob - Blob object with pathname and optional uploadedAt
 * @returns {number}
 */
function extractSnapshotTimestamp(blob) {
  if (!blob) return 0;
  const match = (blob.pathname || "").match(SNAPSHOT_RE);
  if (match && match[1]) {
    return Number(match[1]);
  }
  return new Date(blob.uploadedAt || 0).getTime() || 0;
}

/**
 * Selects URLs of prunable snapshots, retaining at least `keep` most recent
 * snapshots and only selecting snapshots strictly older than `now`.
 *
 * @param {Array} blobs - List of blob objects
 * @param {number} now - Timestamp threshold
 * @param {number} [keep=2] - Minimum number of recent snapshots to retain
 * @returns {string[]} Array of URLs to prune
 */
function selectPrunableSnapshots(blobs, now, keep = 2) {
  if (!Array.isArray(blobs)) return [];

  const snapshots = blobs
    .filter((b) => SNAPSHOT_RE.test(b.pathname || ""))
    .sort((a, b) => extractSnapshotTimestamp(b) - extractSnapshotTimestamp(a));

  return snapshots
    .slice(keep)
    .filter((b) => extractSnapshotTimestamp(b) < now)
    .map((b) => b.url)
    .filter(Boolean);
}

/**
 * Fetches existing scores and names from Vercel Blob storage.
 *
 * @param {string} token - Vercel Blob read/write token
 * @param {Date|string|number} [now=new Date()] - Reference time for daily reset filtering
 * @returns {Promise<{ ok: boolean, topScores: Array, names: Array, error?: string }>}
 */
async function fetchBlobScores(token, now = new Date()) {
  try {
    const listRes = await fetch(
      "https://blob.vercel-storage.com/?limit=50&prefix=scores",
      {
        headers: {
          authorization: `Bearer ${token}`,
          "x-api-version": "7",
        },
      },
    );
    if (!listRes.ok) {
      return {
        ok: false,
        topScores: [],
        names: [],
        error: `Blob list failed: status ${listRes.status}`,
      };
    }
    const listData = await listRes.json();
    if (listData.hasMore) {
      return {
        ok: false,
        topScores: [],
        names: [],
        error: "Blob list has more than one page of snapshots",
      };
    }
    const blobs = Array.isArray(listData.blobs) ? listData.blobs : [];
    const matching = blobs
      .filter((b) => SNAPSHOT_RE.test(b.pathname || ""))
      .sort(
        (a, b) => extractSnapshotTimestamp(b) - extractSnapshotTimestamp(a),
      );

    const scoreBlob = matching[0];
    if (!scoreBlob || !scoreBlob.url) {
      // Clean empty store
      return { ok: true, topScores: [], names: [] };
    }

    const contentRes = await fetch(scoreBlob.url, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (!contentRes.ok) {
      return {
        ok: false,
        topScores: [],
        names: [],
        error: `Blob fetch failed: status ${contentRes.status}`,
      };
    }
    const data = await contentRes.json();
    const rawScores = data.topScores || data.scores || [];
    const names = extractUniqueNames([
      ...(Array.isArray(data.names) ? data.names : []),
      ...rawScores,
    ]);
    const todayScores = filterTodayScores(rawScores, now);
    const topScores = sortTopScores(todayScores, 10);
    return { ok: true, topScores, names };
  } catch (err) {
    return {
      ok: false,
      topScores: [],
      names: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Uploads updated scores and names to Vercel Blob storage.
 *
 * @param {string} token - Vercel Blob read/write token
 * @param {Array} topScores - Top 10 scores
 * @param {Array} names - Unique player names
 * @returns {Promise<boolean>}
 */
async function uploadBlobScores(token, topScores, names) {
  const payload = JSON.stringify({
    topScores,
    names,
    scores: topScores,
  });

  const now = Date.now();
  const newPath = `scores-${now}.json`;
  const res = await fetch(`https://blob.vercel-storage.com/${newPath}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "7",
      "x-add-random-suffix": "0",
      "x-content-type": "application/json",
      "content-type": "application/json",
    },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`Blob upload failed: status ${res.status}`);
  }

  // Safe cleanup: retain at least the 2 freshest snapshots,
  // and only delete older snapshots strictly prior to this write.
  try {
    const listRes = await fetch(
      "https://blob.vercel-storage.com/?limit=50&prefix=scores",
      {
        headers: {
          authorization: `Bearer ${token}`,
          "x-api-version": "7",
        },
      },
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      const blobs = Array.isArray(listData.blobs) ? listData.blobs : [];
      const oldBlobs = selectPrunableSnapshots(blobs, now, 2);

      if (oldBlobs.length > 0) {
        const delRes = await fetch("https://blob.vercel-storage.com/delete", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-api-version": "7",
            "content-type": "application/json",
          },
          body: JSON.stringify({ urls: oldBlobs }),
        });
        if (!delRes.ok) {
          console.warn(`scores: prune failed with status ${delRes.status}`);
        }
      }
    }
  } catch (err) {
    console.warn("scores: cleanup error", err);
  }

  return true;
}

/**
 * Main serverless HTTP handler.
 *
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }

  const token =
    process.env.SCORES_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

  if (req.method === "GET") {
    if (!token) {
      const topScores = sortTopScores(
        filterTodayScores(memoryStore.topScores),
        10,
      );
      const names = extractUniqueNames([
        ...memoryStore.names,
        ...memoryStore.topScores,
      ]);
      memoryStore.topScores = topScores;
      memoryStore.names = names;
      return sendJson(res, 200, {
        topScores,
        names,
      });
    }

    const result = await fetchBlobScores(token);
    if (!result.ok) {
      console.error("scores: fetchBlobScores failed on GET", result.error);
      return sendJson(res, 502, { error: "Could not read leaderboard" });
    }
    return sendJson(res, 200, {
      topScores: result.topScores,
      names: result.names,
    });
  }

  if (req.method === "POST") {
    if (!isAllowedOrigin(req)) {
      return sendJson(res, 403, { error: "Forbidden origin" });
    }
    const limit = checkRateLimit(req);
    if (limit.limited) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return sendJson(res, 429, { error: "Too many requests" });
    }

    const body = await parseBody(req);
    const validated = validateScoreEntry(body);
    if (!validated) {
      return sendJson(res, 400, { error: "Invalid score entry" });
    }

    // A client-supplied id makes a Retry after a lost response idempotent.
    const id =
      typeof body.id === "string" && CLIENT_ID_RE.test(body.id)
        ? body.id
        : typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `score_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newEntry = {
      ...validated,
      id,
      date: new Date().toISOString(),
    };

    if (!token) {
      const todayScores = filterTodayScores(memoryStore.topScores);
      const topScores = sortTopScores(
        todayScores.some((s) => s.id === id)
          ? todayScores
          : [...todayScores, newEntry],
        10,
      );
      const names = extractUniqueNames([
        ...memoryStore.names,
        ...memoryStore.topScores,
        validated.name,
      ]);
      memoryStore.topScores = topScores;
      memoryStore.names = names;
      return sendJson(res, 200, {
        success: true,
        topScores,
        names,
        savedId: id,
      });
    }

    const current = await fetchBlobScores(token);
    if (!current.ok) {
      console.error("scores: fetchBlobScores failed on POST", current.error);
      return sendJson(res, 502, { error: "Could not read leaderboard" });
    }

    if (current.topScores.some((s) => s.id === id)) {
      return sendJson(res, 200, {
        success: true,
        topScores: current.topScores,
        names: current.names,
        savedId: id,
      });
    }

    const topScores = sortTopScores([...current.topScores, newEntry], 10);
    const names = extractUniqueNames([
      ...current.names,
      ...topScores,
      validated.name,
    ]);

    try {
      await uploadBlobScores(token, topScores, names);
    } catch (err) {
      console.error("scores: blob write failed", err);
      return sendJson(res, 502, { error: "Could not save score" });
    }

    return sendJson(res, 200, { success: true, topScores, names, savedId: id });
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return sendJson(res, 405, { error: "Method not allowed" });
}

module.exports = handler;
module.exports.handler = handler;
module.exports.LEADERBOARD_TIMEZONE = LEADERBOARD_TIMEZONE;
module.exports.getDayKey = getDayKey;
module.exports.filterTodayScores = filterTodayScores;
module.exports.sortTopScores = sortTopScores;
module.exports.extractUniqueNames = extractUniqueNames;
module.exports.validateScoreEntry = validateScoreEntry;
module.exports.isAllowedOrigin = isAllowedOrigin;
module.exports.checkRateLimit = checkRateLimit;
module.exports._resetRateLimits = _resetRateLimits;
module.exports.selectPrunableSnapshots = selectPrunableSnapshots;
module.exports.fetchBlobScores = fetchBlobScores;
module.exports.uploadBlobScores = uploadBlobScores;
module.exports._resetMemoryStore = _resetMemoryStore;
