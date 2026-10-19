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
    entry.score < 0 ||
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

/**
 * Determines whether a score qualifies for the top scores list.
 *
 * @param {Array<Object>} scores - Existing scores
 * @param {number} score - Player's score
 * @param {number} [max=10] - Leaderboard capacity
 * @returns {boolean} True if score qualifies for top max
 */
function isTopScore(scores, score, max = 10) {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
    return false;
  }
  if (max <= 0) return false;
  if (!Array.isArray(scores)) return true;

  const top = sortTopScores(scores, max);
  if (top.length < max) return true;

  const lowest = top[top.length - 1]?.score ?? 0;
  return score > lowest;
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
      raw += chunk;
      if (raw.length > 16384) {
        tooLarge = true;
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

/**
 * Fetches existing scores and names from Vercel Blob storage.
 *
 * @param {string} token - Vercel Blob read/write token
 * @returns {Promise<{ topScores: Array, names: Array }>}
 */
async function fetchBlobScores(token) {
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
      return { topScores: [], names: [] };
    }
    const listData = await listRes.json();
    const blobs = Array.isArray(listData.blobs) ? listData.blobs : [];
    const matching = blobs
      .filter((b) => b.pathname.startsWith("scores"))
      .sort(
        (a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0),
      );

    const scoreBlob = matching[0];
    if (!scoreBlob || !scoreBlob.url) {
      return { topScores: [], names: [] };
    }

    const contentRes = await fetch(scoreBlob.url, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (!contentRes.ok) {
      return { topScores: [], names: [] };
    }
    const data = await contentRes.json();
    const rawScores = data.topScores || data.scores || [];
    const topScores = sortTopScores(rawScores, 10);
    const names = Array.isArray(data.names)
      ? extractUniqueNames(data.names)
      : extractUniqueNames(topScores);
    return { topScores, names };
  } catch {
    return { topScores: [], names: [] };
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
      "content-type": "application/json",
    },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`Blob upload failed: status ${res.status}`);
  }

  // Safe cleanup: always retain at least the 2 freshest snapshots,
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
      const snapshots = blobs
        .filter((b) => /^scores-\d+\.json$/.test(b.pathname))
        .sort(
          (a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0),
        );

      const oldBlobs = snapshots
        .slice(2)
        .filter((b) => {
          const m = b.pathname.match(/^scores-(\d+)\.json$/);
          return m && Number(m[1]) < now;
        })
        .map((b) => b.url);

      if (oldBlobs.length > 0) {
        await fetch("https://blob.vercel-storage.com/delete", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-api-version": "7",
            "content-type": "application/json",
          },
          body: JSON.stringify({ urls: oldBlobs }),
        });
      }
    }
  } catch {
    // Ignore cleanup errors
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
      return sendJson(res, 200, {
        topScores: memoryStore.topScores,
        names: memoryStore.names,
      });
    }

    const { topScores, names } = await fetchBlobScores(token);
    return sendJson(res, 200, { topScores, names });
  }

  if (req.method === "POST") {
    const body = await parseBody(req);
    const validated = validateScoreEntry(body);
    if (!validated) {
      return sendJson(res, 400, { error: "Invalid score entry" });
    }

    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `score_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newEntry = {
      ...validated,
      id,
      date: new Date().toISOString(),
    };

    if (!token) {
      const topScores = sortTopScores([...memoryStore.topScores, newEntry], 10);
      const names = extractUniqueNames([
        ...memoryStore.names,
        ...topScores,
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
module.exports.sortTopScores = sortTopScores;
module.exports.extractUniqueNames = extractUniqueNames;
module.exports.validateScoreEntry = validateScoreEntry;
module.exports.isTopScore = isTopScore;
module.exports._resetMemoryStore = _resetMemoryStore;
