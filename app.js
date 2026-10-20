/**
 * US State Guessing Game
 * Modern, accessible client-side quiz application.
 */

/* ==========================================================================
   Pure Game Logic Functions (Exported for Node testing)
   ========================================================================== */

/**
 * Shuffles an array of states using the Fisher-Yates algorithm.
 * Returns a new array without mutating the original.
 *
 * @param {Array} states - List of state objects
 * @param {Function} rng - Random number generator (defaults to Math.random)
 * @returns {Array} Shuffled copy of states
 */
function shuffleStates(states, rng = Math.random) {
  const arr = [...states];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

/**
 * Initializes a new game state.
 *
 * @param {Array} states - List of 50 state objects
 * @param {Array|Object|string|null} customQueue - Optional pre-ordered queue or options object
 * @param {Object|string} options - Optional configuration { mode: "challenge" | "practice" }
 * @returns {Object} Fresh game state object
 */
function createGameState(
  states,
  customQueue = null,
  options = { mode: "challenge" },
) {
  let queueArray = customQueue;
  let opts = options;
  if (
    customQueue &&
    !Array.isArray(customQueue) &&
    typeof customQueue === "object"
  ) {
    opts = customQueue;
    queueArray = null;
  } else if (typeof customQueue === "string") {
    opts = { mode: customQueue };
    queueArray = null;
  }
  const mode =
    (typeof opts === "string" ? opts : opts?.mode) === "practice"
      ? "practice"
      : "challenge";
  const queue = queueArray ? [...queueArray] : shuffleStates(states);
  return {
    mode,
    states: [...states],
    queue,
    currentIndex: 0,
    score: 0,
    attempts: 0,
    guesses: 0,
    streak: 0,
    maxStreak: 0,
    wrongGuesses: 0,
    maxWrongGuesses: mode === "practice" ? null : 3,
    strikes: 0,
    revealedStateId: null,
    gameOverReason: null,
    history: {},
    completed: false,
  };
}

/**
 * Evaluates a player's guess against the current target state.
 *
 * @param {Object} gameState - Current game state
 * @param {string} selectedStateId - 2-letter state postal abbreviation guessed
 * @returns {Object} Result object { isCorrect, targetState, selectedState, gameState }
 */
function evaluateGuess(gameState, selectedStateId) {
  if (gameState.completed || gameState.currentIndex >= gameState.queue.length) {
    return {
      isCorrect: false,
      targetState: null,
      selectedState: null,
      gameState,
    };
  }

  const targetState = gameState.queue[gameState.currentIndex];
  const selectedState =
    gameState.states.find((s) => s.id === selectedStateId) || null;

  if (selectedStateId === targetState.id) {
    gameState.score += 1;
    gameState.attempts += 1;
    gameState.guesses = (gameState.guesses || 0) + 1;
    gameState.streak += 1;
    if (gameState.streak > gameState.maxStreak) {
      gameState.maxStreak = gameState.streak;
    }
    const prevAttempts = gameState.history[targetState.id]?.attempts || 0;
    gameState.history[targetState.id] = {
      status: "correct",
      attempts: prevAttempts + 1,
      skipped: false,
    };
    gameState.currentIndex += 1;
    if (gameState.currentIndex >= gameState.queue.length) {
      gameState.completed = true;
      gameState.gameOverReason = "completed";
    }
    return {
      isCorrect: true,
      targetState,
      selectedState,
      gameState,
    };
  } else {
    gameState.attempts += 1;
    gameState.guesses = (gameState.guesses || 0) + 1;
    gameState.streak = 0;
    gameState.wrongGuesses += 1;

    if (gameState.mode === "practice") {
      // In Practice mode: no strikes, no elimination, target remains active
      return {
        isCorrect: false,
        targetState,
        selectedState,
        gameState,
      };
    }

    // In Challenge mode: 3 strikes elimination
    gameState.strikes = gameState.wrongGuesses;

    if (gameState.wrongGuesses >= gameState.maxWrongGuesses) {
      gameState.completed = true;
      gameState.gameOverReason = "three_strikes";
      gameState.revealedStateId = targetState.id;
      const prevAttempts = gameState.history[targetState.id]?.attempts || 0;
      gameState.history[targetState.id] = {
        status: "revealed",
        attempts: prevAttempts + 1,
        skipped: false,
      };
    }

    return {
      isCorrect: false,
      targetState,
      selectedState,
      gameState,
    };
  }
}

/**
 * Skips the current state, recording it as missed/skipped and advancing the queue.
 *
 * @param {Object} gameState - Current game state
 * @returns {Object|null} { targetState, gameState } or null if already completed
 */
function skipCurrentState(gameState) {
  if (
    !gameState ||
    !gameState.queue ||
    gameState.completed ||
    gameState.currentIndex >= gameState.queue.length
  ) {
    return null;
  }
  const targetState = gameState.queue[gameState.currentIndex];
  if (!targetState) return null;
  gameState.attempts += 1;
  gameState.guesses = (gameState.guesses || 0) + 1;
  gameState.streak = 0;
  const prevAttempts = gameState.history[targetState.id]?.attempts || 0;
  gameState.history[targetState.id] = {
    status: "skipped",
    attempts: prevAttempts + 1,
    skipped: true,
  };
  gameState.currentIndex += 1;
  if (gameState.currentIndex >= gameState.queue.length) {
    gameState.completed = true;
    gameState.gameOverReason = gameState.gameOverReason || "completed";
  }
  return {
    targetState,
    gameState,
  };
}

/**
 * Calculates current accuracy percentage.
 *
 * @param {number} correctCount - Number of correct guesses
 * @param {number} totalAttempts - Total number of attempts (including wrong and skips)
 * @returns {string} Formatted accuracy percentage (e.g. "95%")
 */
function calculateAccuracy(correctCount, totalAttempts) {
  if (!totalAttempts || totalAttempts <= 0) {
    return "100%";
  }
  const percentage = Math.round((correctCount / totalAttempts) * 100);
  return `${percentage}%`;
}

/**
 * Compares current run guesses against the previous personal best.
 *
 * @param {number|string|null|undefined} previousBest - Previous best fewest guesses
 * @param {number} currentGuesses - Total guesses in current run
 * @returns {Object} { isNewBest: boolean, bestGuesses: number }
 */
function checkNewPracticeBest(previousBest, currentGuesses) {
  const parsedPrev =
    previousBest !== null && previousBest !== undefined && previousBest !== ""
      ? parseInt(previousBest, 10)
      : NaN;

  if (Number.isNaN(parsedPrev) || parsedPrev <= 0) {
    return {
      isNewBest: true,
      bestGuesses: currentGuesses,
    };
  }

  if (currentGuesses < parsedPrev) {
    return {
      isNewBest: true,
      bestGuesses: currentGuesses,
    };
  }

  return {
    isNewBest: false,
    bestGuesses: parsedPrev,
  };
}

/* ==========================================================================
   Sound Synthesizer (Web Audio API)
   ========================================================================== */

let audioCtx = null;
let isMuted = false;

function initAudioSettings() {
  if (typeof window === "undefined") return;
  try {
    const saved = localStorage.getItem("state_game_muted");
    if (saved !== null) {
      isMuted = saved === "true";
    }
  } catch {
    // Graceful fallback if localStorage is blocked
  }
}

function getAudioContext() {
  if (isMuted || typeof window === "undefined") return null;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function playSound(type) {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (type === "click") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.04);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } else if (type === "correct") {
    // Bright two-tone chime
    [
      { freq: 587.33, start: 0, duration: 0.12 },
      { freq: 880.0, start: 0.08, duration: 0.25 },
    ].forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.12, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } else if (type === "incorrect") {
    // Subtle low buzz
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.16);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  } else if (type === "victory") {
    // Cheerful rising fanfare
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      const start = idx * 0.1;
      const duration = 0.35;
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.12, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } else if (type === "game-over") {
    // Low dull chord / buzz
    [160, 130, 95].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      const start = idx * 0.12;
      const duration = 0.35;
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.12, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  }
}

/* ==========================================================================
   Confetti Animation
   ========================================================================== */

let confettiAnimationId = null;

function stopConfetti(canvas) {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function startConfetti(canvas) {
  if (!canvas || typeof window === "undefined") return;
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  stopConfetti(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const count = 90;
  const colors = [
    "#10b981",
    "#3b82f6",
    "#f59e0b",
    "#ec4899",
    "#8b5cf6",
    "#06b6d4",
  ];
  const particles = [];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 300,
      y: canvas.height * 0.4 + (Math.random() - 0.5) * 150,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -12 - 3,
      size: Math.random() * 7 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 6,
      gravity: 0.3,
      opacity: 1,
    });
  }

  const startTime = Date.now();

  function tick() {
    const elapsed = Date.now() - startTime;
    if (elapsed > 4500) {
      stopConfetti(canvas);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rotation += p.rotSpeed;
      if (elapsed > 2500) {
        p.opacity = Math.max(0, p.opacity - 0.015);
      }

      if (p.opacity > 0 && p.y < canvas.height + 40) {
        active = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4);
        ctx.restore();
      }
    }

    if (active) {
      confettiAnimationId = requestAnimationFrame(tick);
    } else {
      stopConfetti(canvas);
    }
  }

  confettiAnimationId = requestAnimationFrame(tick);
}

/* ==========================================================================
   High Scores & Leaderboard API / LocalStorage
   ========================================================================== */

const STORAGE_KEY = "state_game_high_scores";

function parseAccuracyNumber(acc) {
  if (typeof acc === "number") return acc;
  if (!acc) return 0;
  return parseFloat(String(acc).replace("%", "")) || 0;
}

function sortScores(scores) {
  if (!Array.isArray(scores)) return [];
  return scores
    .filter((s) => s && typeof s === "object")
    .sort((a, b) => {
      const scoreA = Number(a.score) || 0;
      const scoreB = Number(b.score) || 0;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      const accB = parseAccuracyNumber(b.accuracy);
      const accA = parseAccuracyNumber(a.accuracy);
      if (accB !== accA) return accB - accA;
      return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
    });
}

function addScoreEntry(list, entry) {
  const filtered = (Array.isArray(list) ? list : []).filter(
    (item) =>
      item &&
      !(
        (entry.id && item.id === entry.id) ||
        (item.name === entry.name &&
          item.score === entry.score &&
          item.date === entry.date)
      ),
  );
  return sortScores([...filtered, entry]);
}

function getStoredScores() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredScores(scores) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // Ignore storage quota/block
  }
}

function getBestScore(scores) {
  if (!scores || scores.length === 0) return 0;
  return scores.reduce((max, s) => Math.max(max, s.score || 0), 0);
}

async function fetchScores() {
  try {
    const res = await fetch("./api/scores");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const serverScores = Array.isArray(data)
      ? data
      : data.topScores || data.scores || [];
    const localScores = getStoredScores();
    const merged = serverScores.length > 0 ? serverScores : localScores;
    const sorted = sortScores(merged);
    setStoredScores(sorted);
    return sorted;
  } catch {
    return sortScores(getStoredScores());
  }
}

async function submitScore(scoreEntry) {
  let savedScores = getStoredScores();
  let savedId = null;
  let success = false;
  try {
    const res = await fetch("./api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scoreEntry),
    });
    if (res.ok) {
      const data = await res.json();
      savedId = data.savedId || null;
      success = data.success === true;
      const rawList =
        data.topScores || data.scores || (Array.isArray(data) ? data : null);
      if (rawList) {
        savedScores = sortScores(rawList);
      } else {
        savedScores = addScoreEntry(savedScores, scoreEntry);
      }
    } else {
      savedScores = addScoreEntry(savedScores, scoreEntry);
      success = false;
    }
  } catch {
    savedScores = addScoreEntry(savedScores, scoreEntry);
    success = false;
  }
  setStoredScores(savedScores);
  return { scores: savedScores, savedId, success };
}

function qualifiesForTop10(scores, currentScore) {
  if (typeof currentScore !== "number" || currentScore < 0) return false;
  if (!scores || scores.length < 10) return true;
  const lowest = scores[scores.length - 1]?.score ?? 0;
  return currentScore > lowest;
}

function updatePlayerNamesDatalist(datalistEl, scores) {
  if (!datalistEl) return;
  const names = Array.from(new Set(scores.map((s) => s.name).filter(Boolean)));
  datalistEl.textContent = "";
  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    datalistEl.appendChild(opt);
  });
}

function renderLeaderboardTable(tableBody, scores, highlightIndex = -1) {
  if (!tableBody) return;
  tableBody.textContent = "";
  const top10 = scores.slice(0, 10);
  if (top10.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "leaderboard-empty";
    td.textContent = "No scores yet. Be the first!";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  top10.forEach((item, idx) => {
    const tr = document.createElement("tr");
    if (idx === highlightIndex) {
      tr.className = "highlight-row";
    }

    const rankTd = document.createElement("td");
    rankTd.className = "rank-cell";
    rankTd.textContent = String(idx + 1);

    const nameTd = document.createElement("td");
    nameTd.textContent = item.name;

    const scoreTd = document.createElement("td");
    scoreTd.textContent = String(item.score);

    const accTd = document.createElement("td");
    accTd.textContent =
      typeof item.accuracy === "string" ? item.accuracy : `${item.accuracy}%`;

    const dateTd = document.createElement("td");
    const rawDate = item.date
      ? String(item.date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    dateTd.textContent = rawDate;

    tr.appendChild(rankTd);
    tr.appendChild(nameTd);
    tr.appendChild(scoreTd);
    tr.appendChild(accTd);
    tr.appendChild(dateTd);
    tableBody.appendChild(tr);
  });
}

/* ==========================================================================
   DOM Binding & Rendering
   ========================================================================== */

function bindDomElements() {
  return {
    modeToggle: document.querySelector(".mode-toggle"),
    modeChallengeBtn: document.getElementById("mode-challenge-btn"),
    modePracticeBtn: document.getElementById("mode-practice-btn"),
    soundToggleBtn: document.getElementById("sound-toggle"),
    leaderboardBtn: document.getElementById("leaderboard-btn"),
    restartBtn: document.getElementById("restart-btn"),
    promptCard: document.getElementById("prompt-card"),
    promptCompletedActions: document.getElementById("prompt-completed-actions"),
    viewResultsBtn: document.getElementById("view-results-btn"),
    newGameBtn: document.getElementById("new-game-btn"),
    targetStateName: document.getElementById("target-state-name"),
    currentRound: document.getElementById("current-round"),
    totalRounds: document.getElementById("total-rounds"),
    strikesCard: document.getElementById("strikes-card"),
    strikesCount: document.getElementById("strikes-count"),
    strikePips: Array.from(document.querySelectorAll(".strike-pips .pip")),
    guessesCard: document.getElementById("guesses-card"),
    guessesCount: document.getElementById("guesses-count"),
    bestCard: document.getElementById("best-card"),
    bestLabel: document.getElementById("best-label"),
    bestScore: document.getElementById("best-score"),
    scoreCount: document.getElementById("score-count"),
    streakCount: document.getElementById("streak-count"),
    accuracyRate: document.getElementById("accuracy-rate"),
    progressBar: document.getElementById("progress-bar"),
    statusLive: document.getElementById("status-live"),
    gameOverModal: document.getElementById("game-over-modal"),
    closeGameOverBtn: document.getElementById("close-game-over-btn"),
    reviewMapBtn: document.getElementById("review-map-btn"),
    gameOverTitle: document.getElementById("game-over-title"),
    gameOverSummary: document.getElementById("game-over-summary"),
    practiceBestBanner: document.getElementById("practice-best-banner"),
    saveScoreForm: document.getElementById("save-score-form"),
    playerNameInput: document.getElementById("player-name"),
    playerNamesList: document.getElementById("player-names-list"),
    submitScoreBtn: document.getElementById("submit-score-btn"),
    gameOverLeaderboardSection: document.getElementById(
      "game-over-leaderboard-section",
    ),
    gameOverLeaderboardBody: document.getElementById(
      "game-over-leaderboard-body",
    ),
    leaderboardModal: document.getElementById("leaderboard-modal"),
    closeLeaderboardTopBtn: document.getElementById(
      "close-leaderboard-top-btn",
    ),
    leaderboardTableBody: document.getElementById("leaderboard-table-body"),
    closeLeaderboardBtn: document.getElementById("close-leaderboard-btn"),
    playAgainBtn: document.getElementById("play-again-btn"),
    finalScore: document.getElementById("final-score"),
    finalAccuracy: document.getElementById("final-accuracy"),
    finalStreak: document.getElementById("final-streak"),
    confettiCanvas: document.getElementById("confetti-canvas"),
    statePaths: Array.from(document.querySelectorAll(".state")),
  };
}

/**
 * Retrieves the local practice mode fewest guesses personal best.
 *
 * @returns {string} Personal best count as string or "--" if not recorded
 */
function getPracticeBestScore() {
  if (typeof localStorage === "undefined") return "--";
  try {
    const raw = localStorage.getItem("state_game_practice_best_guesses");
    if (raw !== null && raw !== undefined && raw !== "") {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return String(parsed);
      }
    }
  } catch {
    // Storage unavailable
  }
  return "--";
}

function render(dom, gameState, options = {}) {
  if (!dom || !gameState) return;

  const total = gameState.queue ? gameState.queue.length : 0;
  const isPractice = gameState.mode === "practice";

  if (dom.totalRounds) dom.totalRounds.textContent = String(total);

  // Dynamic HUD: Strikes vs Guesses
  if (dom.strikesCard && dom.guessesCard) {
    if (isPractice) {
      dom.strikesCard.setAttribute("hidden", "");
      dom.guessesCard.removeAttribute("hidden");
      if (dom.guessesCount) {
        dom.guessesCount.textContent = String(gameState.guesses || 0);
      }
    } else {
      dom.guessesCard.setAttribute("hidden", "");
      dom.strikesCard.removeAttribute("hidden");
    }
  }

  // Dynamic HUD: Best score/guesses
  if (dom.bestLabel) {
    dom.bestLabel.textContent = "Best";
  }
  if (dom.bestScore) {
    if (isPractice) {
      dom.bestScore.textContent = getPracticeBestScore();
    } else if (options.bestScore !== undefined) {
      dom.bestScore.textContent = String(options.bestScore);
    } else {
      dom.bestScore.textContent = String(getBestScore(getStoredScores()));
    }
  }

  if (dom.progressBar) {
    dom.progressBar.max = total;
    if (gameState.completed && gameState.gameOverReason === "three_strikes") {
      dom.progressBar.value = gameState.score;
    } else if (gameState.completed) {
      dom.progressBar.value = total;
    } else {
      dom.progressBar.value = isPractice
        ? gameState.score
        : gameState.currentIndex;
    }
  }

  // Update strikes count and pips
  const strikes = gameState.strikes || 0;
  const maxStrikes = gameState.maxWrongGuesses || 3;
  if (dom.strikesCount) {
    dom.strikesCount.textContent = `${strikes} / ${maxStrikes}`;
  }
  if (dom.strikePips) {
    dom.strikePips.forEach((pip, idx) => {
      if (!isPractice && idx < strikes) {
        pip.classList.add("active");
        pip.setAttribute("data-active", "true");
      } else {
        pip.classList.remove("active");
        pip.removeAttribute("data-active");
      }
    });
  }

  if (dom.scoreCount) dom.scoreCount.textContent = String(gameState.score);
  if (dom.streakCount) dom.streakCount.textContent = String(gameState.streak);
  if (dom.accuracyRate) {
    dom.accuracyRate.textContent = calculateAccuracy(
      gameState.score,
      gameState.attempts,
    );
  }

  if (gameState.completed) {
    if (dom.currentRound) {
      dom.currentRound.textContent =
        gameState.gameOverReason === "three_strikes"
          ? String(Math.min(gameState.currentIndex + 1, total))
          : String(total);
    }
    if (dom.targetStateName) {
      dom.targetStateName.textContent =
        gameState.gameOverReason === "three_strikes"
          ? "Game Over"
          : "All Done!";
    }

    const statLabels = dom.gameOverModal
      ? dom.gameOverModal.querySelectorAll(".final-stat-label")
      : [];

    if (isPractice) {
      if (statLabels[0]) statLabels[0].textContent = "Total Guesses";
      if (statLabels[1]) statLabels[1].textContent = "Accuracy";
      if (statLabels[2]) statLabels[2].textContent = "States Found";

      if (dom.finalScore) {
        dom.finalScore.textContent = String(gameState.guesses || 0);
      }
      if (dom.finalAccuracy) {
        dom.finalAccuracy.textContent = calculateAccuracy(
          gameState.score,
          gameState.attempts,
        );
      }
      if (dom.finalStreak) {
        dom.finalStreak.textContent = `${gameState.score} / ${total}`;
      }

      if (dom.gameOverTitle) {
        dom.gameOverTitle.textContent = "Map Completed!";
      }
      if (dom.gameOverSummary) {
        dom.gameOverSummary.textContent =
          "Great job! You found all 50 states at your own pace.";
      }
      if (dom.saveScoreForm) {
        dom.saveScoreForm.setAttribute("hidden", "");
      }
      if (dom.gameOverLeaderboardSection) {
        dom.gameOverLeaderboardSection.setAttribute("hidden", "");
      }
    } else {
      if (statLabels[0]) statLabels[0].textContent = "Final Score";
      if (statLabels[1]) statLabels[1].textContent = "Accuracy";
      if (statLabels[2]) statLabels[2].textContent = "Best Streak";

      if (dom.finalScore) {
        dom.finalScore.textContent = `${gameState.score} / ${total}`;
      }
      if (dom.finalAccuracy) {
        dom.finalAccuracy.textContent = calculateAccuracy(
          gameState.score,
          gameState.attempts,
        );
      }
      if (dom.finalStreak) {
        dom.finalStreak.textContent = String(gameState.maxStreak);
      }

      if (dom.gameOverTitle) {
        dom.gameOverTitle.textContent =
          gameState.gameOverReason === "three_strikes"
            ? "Game Over (3 Strikes)"
            : "Map Completed!";
      }

      if (dom.gameOverSummary) {
        if (gameState.gameOverReason === "three_strikes") {
          dom.gameOverSummary.textContent = `You found ${gameState.score} of ${total} states before getting 3 strikes.`;
        } else {
          dom.gameOverSummary.textContent =
            gameState.score === total
              ? `Perfect! You identified all ${total} states.`
              : `You identified ${gameState.score} of ${total} states.`;
        }
      }
      if (dom.gameOverLeaderboardSection) {
        dom.gameOverLeaderboardSection.removeAttribute("hidden");
      }
    }

    if (dom.promptCard) {
      dom.promptCard.setAttribute("data-completed", "true");
    }
    if (dom.promptCompletedActions) {
      dom.promptCompletedActions.removeAttribute("hidden");
    }

    if (!options.deferModal && dom.gameOverModal) {
      if (typeof dom.gameOverModal.showModal === "function") {
        if (!dom.gameOverModal.open) dom.gameOverModal.showModal();
      } else {
        dom.gameOverModal.removeAttribute("hidden");
      }
    }
  } else {
    if (dom.promptCard) {
      dom.promptCard.removeAttribute("data-completed");
    }
    if (dom.promptCompletedActions) {
      dom.promptCompletedActions.setAttribute("hidden", "");
    }

    if (dom.currentRound) {
      dom.currentRound.textContent = String(gameState.currentIndex + 1);
    }
    const target = gameState.queue
      ? gameState.queue[gameState.currentIndex]
      : null;
    if (dom.targetStateName)
      dom.targetStateName.textContent = target ? target.name : "";

    if (dom.gameOverModal) {
      if (typeof dom.gameOverModal.close === "function") {
        if (dom.gameOverModal.open) dom.gameOverModal.close();
      } else {
        dom.gameOverModal.setAttribute("hidden", "");
      }
    }
  }

  // Sync state map paths
  if (dom.statePaths) {
    for (const path of dom.statePaths) {
      const id = path.id;
      const historyItem = gameState.history[id];
      if (historyItem) {
        path.setAttribute("data-status", historyItem.status);
        if (historyItem.status === "correct") {
          path.setAttribute(
            "aria-label",
            `${path.dataset.name || id}, already found`,
          );
          path.setAttribute("aria-disabled", "true");
        } else if (historyItem.status === "revealed") {
          path.setAttribute(
            "aria-label",
            `${path.dataset.name || id}, revealed`,
          );
          path.setAttribute("aria-disabled", "true");
        } else if (historyItem.status === "skipped") {
          path.setAttribute(
            "aria-label",
            `${path.dataset.name || id}, skipped`,
          );
          path.setAttribute("aria-disabled", "true");
        }
      } else {
        path.removeAttribute("data-status");
        path.removeAttribute("aria-disabled");
        path.setAttribute("aria-label", path.dataset.name || id);
      }
    }
  }
}

/* ==========================================================================
   Application Initialization
   ========================================================================== */

function initializeApp() {
  if (typeof document === "undefined") return;

  const dom = bindDomElements();
  initAudioSettings();

  // Sync sound toggle UI
  if (dom.soundToggleBtn) {
    dom.soundToggleBtn.setAttribute("aria-pressed", String(isMuted));
    dom.soundToggleBtn.setAttribute(
      "aria-label",
      isMuted ? "Unmute sound" : "Mute sound",
    );
  }

  // Leaderboard state
  let currentLeaderboard = sortScores(getStoredScores());
  let cachedBestScore = getBestScore(currentLeaderboard);
  updatePlayerNamesDatalist(dom.playerNamesList, currentLeaderboard);

  // Active mode state and initialization
  let activeMode = "challenge";
  try {
    const savedMode = localStorage.getItem("state_game_mode");
    if (savedMode === "practice") {
      activeMode = "practice";
    }
  } catch {
    // Storage unavailable
  }

  function updateModeButtonsUI(mode) {
    const isChallenge = mode === "challenge";
    if (dom.modeChallengeBtn) {
      dom.modeChallengeBtn.setAttribute("aria-checked", String(isChallenge));
      dom.modeChallengeBtn.setAttribute("tabindex", isChallenge ? "0" : "-1");
    }
    if (dom.modePracticeBtn) {
      dom.modePracticeBtn.setAttribute("aria-checked", String(!isChallenge));
      dom.modePracticeBtn.setAttribute("tabindex", !isChallenge ? "0" : "-1");
    }
  }

  updateModeButtonsUI(activeMode);

  // Asynchronously fetch leaderboard from server
  fetchScores().then((fetched) => {
    currentLeaderboard = fetched;
    cachedBestScore = getBestScore(currentLeaderboard);
    if (activeMode === "challenge" && dom.bestScore) {
      dom.bestScore.textContent = String(cachedBestScore);
    }
    updatePlayerNamesDatalist(dom.playerNamesList, currentLeaderboard);
  });

  // Use global STATES from states-data.js
  const statesList = typeof STATES !== "undefined" ? STATES : [];
  let gameState = createGameState(statesList, null, { mode: activeMode });
  let strikeTimeoutId = null;
  let activePendingScore = null;

  function announceStatus(message) {
    if (dom.statusLive) {
      dom.statusLive.textContent = message;
    }
  }

  function startNewGame(mode = activeMode) {
    if (strikeTimeoutId) {
      clearTimeout(strikeTimeoutId);
      strikeTimeoutId = null;
    }
    stopConfetti(dom.confettiCanvas);

    if (dom.gameOverModal) {
      if (
        typeof dom.gameOverModal.close === "function" &&
        dom.gameOverModal.open
      ) {
        dom.gameOverModal.close();
      }
      dom.gameOverModal.setAttribute("hidden", "");
    }
    if (dom.leaderboardModal) {
      if (
        typeof dom.leaderboardModal.close === "function" &&
        dom.leaderboardModal.open
      ) {
        dom.leaderboardModal.close();
      }
      dom.leaderboardModal.setAttribute("hidden", "");
    }

    gameState = createGameState(statesList, null, { mode });
    activePendingScore = null;
    render(dom, gameState, { bestScore: cachedBestScore });
  }

  function handleRestart() {
    playSound("click");
    startNewGame(activeMode);
    const firstTarget = gameState.queue ? gameState.queue[0] : null;
    const firstName = firstTarget ? firstTarget.name : "";
    announceStatus(`Game restarted. Find ${firstName}.`);
  }

  function requestModeSwitch(targetMode) {
    if (targetMode === activeMode) {
      return false;
    }
    const inProgress = !gameState.completed && gameState.attempts > 0;
    if (inProgress) {
      const confirmed = window.confirm(
        "Switching modes will restart your current game. Continue?",
      );
      if (!confirmed) {
        return false;
      }
    }
    switchMode(targetMode);
    return true;
  }

  function switchMode(newMode) {
    activeMode = newMode;
    try {
      localStorage.setItem("state_game_mode", newMode);
    } catch {
      // Storage unavailable
    }
    updateModeButtonsUI(newMode);
    startNewGame(newMode);
    const firstTarget = gameState.queue ? gameState.queue[0] : null;
    const firstName = firstTarget ? firstTarget.name : "";
    announceStatus(
      `Switched to ${newMode === "practice" ? "Practice" : "Challenge"} mode. Find ${firstName}.`,
    );
  }

  function openGameOverModalUI() {
    if (!dom.gameOverModal) return;

    if (gameState.mode === "practice") {
      if (dom.saveScoreForm) dom.saveScoreForm.setAttribute("hidden", "");
      if (dom.gameOverLeaderboardSection) {
        dom.gameOverLeaderboardSection.setAttribute("hidden", "");
      }

      let prevBest = null;
      try {
        prevBest = localStorage.getItem("state_game_practice_best_guesses");
      } catch {}
      const currentGuesses = gameState.guesses || gameState.attempts;

      if (gameState.isNewPracticeBest === undefined) {
        const bestResult = checkNewPracticeBest(prevBest, currentGuesses);
        gameState.isNewPracticeBest = bestResult.isNewBest;
        gameState.practiceBestGuesses = bestResult.bestGuesses;
        if (bestResult.isNewBest) {
          try {
            localStorage.setItem(
              "state_game_practice_best_guesses",
              String(currentGuesses),
            );
          } catch {}
        }
      }

      if (dom.practiceBestBanner) {
        if (gameState.isNewPracticeBest) {
          dom.practiceBestBanner.textContent = `🎉 New Personal Best: ${currentGuesses} guesses!`;
        } else {
          dom.practiceBestBanner.textContent = `Personal Best: ${gameState.practiceBestGuesses} guesses (This run: ${currentGuesses})`;
        }
        dom.practiceBestBanner.removeAttribute("hidden");
      }

      if (dom.bestScore) {
        dom.bestScore.textContent = String(gameState.practiceBestGuesses);
      }
    } else {
      if (dom.practiceBestBanner) {
        dom.practiceBestBanner.setAttribute("hidden", "");
        dom.practiceBestBanner.textContent = "";
      }
      if (dom.gameOverLeaderboardSection) {
        dom.gameOverLeaderboardSection.removeAttribute("hidden");
      }
      const qualifies = qualifiesForTop10(currentLeaderboard, gameState.score);
      if (dom.saveScoreForm) {
        if (qualifies) {
          dom.saveScoreForm.removeAttribute("hidden");
          if (dom.submitScoreBtn) {
            dom.submitScoreBtn.disabled = false;
            dom.submitScoreBtn.textContent = "Save Score";
          }
          let savedName = "";
          try {
            savedName = localStorage.getItem("state_game_player_name") || "";
          } catch {}
          if (dom.playerNameInput && !dom.playerNameInput.value) {
            dom.playerNameInput.value = savedName;
          }
        } else {
          dom.saveScoreForm.setAttribute("hidden", "");
        }
      }
      renderLeaderboardTable(dom.gameOverLeaderboardBody, currentLeaderboard);
    }

    dom.gameOverModal.removeAttribute("hidden");
    if (typeof dom.gameOverModal.showModal === "function") {
      if (!dom.gameOverModal.open) dom.gameOverModal.showModal();
    }
    const modalCard = dom.gameOverModal.querySelector(".modal-card");
    if (modalCard) {
      modalCard.scrollTop = 0;
    }

    if (gameState.mode === "practice") {
      if (dom.closeGameOverBtn) {
        dom.closeGameOverBtn.focus();
      } else if (dom.reviewMapBtn) {
        dom.reviewMapBtn.focus();
      } else if (dom.playAgainBtn) {
        dom.playAgainBtn.focus();
      }
    } else {
      const qualifies = qualifiesForTop10(currentLeaderboard, gameState.score);
      if (qualifies && dom.playerNameInput && !dom.playerNameInput.disabled) {
        dom.playerNameInput.focus();
      } else if (dom.closeGameOverBtn) {
        dom.closeGameOverBtn.focus();
      } else if (dom.reviewMapBtn) {
        dom.reviewMapBtn.focus();
      } else if (dom.playAgainBtn) {
        dom.playAgainBtn.focus();
      }
    }
  }

  function closeGameOverModal() {
    playSound("click");
    stopConfetti(dom.confettiCanvas);
    if (dom.gameOverModal) {
      if (
        typeof dom.gameOverModal.close === "function" &&
        dom.gameOverModal.open
      ) {
        dom.gameOverModal.close();
      }
      dom.gameOverModal.setAttribute("hidden", "");
    }
    announceStatus("Game over dialog dismissed. Reviewing completed map.");
    if (
      dom.viewResultsBtn &&
      dom.promptCompletedActions &&
      !dom.promptCompletedActions.hasAttribute("hidden")
    ) {
      dom.viewResultsBtn.focus();
    } else if (dom.restartBtn) {
      dom.restartBtn.focus();
    }
  }

  function handleStateSelection(stateId) {
    if (gameState.completed) return;

    // Ignore clicks on already completed, revealed, or skipped states
    const existing = gameState.history[stateId];
    if (
      existing &&
      (existing.status === "correct" ||
        existing.status === "revealed" ||
        existing.status === "skipped")
    ) {
      return;
    }

    const currentTarget = gameState.queue[gameState.currentIndex];
    const result = evaluateGuess(gameState, stateId);

    if (result.isCorrect) {
      playSound("correct");
      render(dom, gameState, { bestScore: cachedBestScore });

      if (gameState.completed) {
        playSound("victory");
        startConfetti(dom.confettiCanvas);
        if (gameState.mode === "practice") {
          announceStatus(
            `Correct! That was ${currentTarget.name}. Congratulations, you completed the map in ${gameState.guesses} guesses!`,
          );
        } else {
          announceStatus(
            `Correct! That was ${currentTarget.name}. Congratulations, you finished the map!`,
          );
        }
        openGameOverModalUI();
      } else {
        const nextTarget = gameState.queue[gameState.currentIndex];
        announceStatus(
          `Correct! That was ${currentTarget.name}. Next, find ${nextTarget.name}.`,
        );
      }
    } else {
      const clickedName = result.selectedState
        ? result.selectedState.name
        : stateId;

      if (gameState.gameOverReason === "three_strikes") {
        playSound("game-over");
        announceStatus(
          `Incorrect. That was ${clickedName}. Three strikes! The correct location of ${currentTarget.name} is highlighted on the map.`,
        );

        render(dom, gameState, {
          deferModal: true,
          bestScore: cachedBestScore,
        });

        const clickedPath = dom.statePaths.find((p) => p.id === stateId);
        if (clickedPath && stateId !== currentTarget.id) {
          clickedPath.setAttribute("data-status", "incorrect");
        }

        if (strikeTimeoutId) clearTimeout(strikeTimeoutId);
        strikeTimeoutId = setTimeout(() => {
          if (clickedPath && stateId !== currentTarget.id) {
            const curr = gameState.history[stateId];
            if (
              !curr ||
              (curr.status !== "correct" && curr.status !== "revealed")
            ) {
              clickedPath.removeAttribute("data-status");
            }
          }
          openGameOverModalUI();
        }, 1200);
      } else {
        playSound("incorrect");
        render(dom, gameState, { bestScore: cachedBestScore });

        const clickedPath = dom.statePaths.find((p) => p.id === stateId);
        if (clickedPath) clickedPath.setAttribute("data-status", "incorrect");

        setTimeout(() => {
          const curr = gameState.history[stateId];
          if (
            !curr ||
            (curr.status !== "correct" && curr.status !== "revealed")
          ) {
            if (clickedPath) clickedPath.removeAttribute("data-status");
          }
        }, 700);

        announceStatus(
          `Incorrect. That was ${clickedName}. Find ${currentTarget.name}.`,
        );
      }
    }
  }

  function toggleSound() {
    isMuted = !isMuted;
    try {
      localStorage.setItem("state_game_muted", String(isMuted));
    } catch {
      // Storage unavailable
    }
    if (dom.soundToggleBtn) {
      dom.soundToggleBtn.setAttribute("aria-pressed", String(isMuted));
      dom.soundToggleBtn.setAttribute(
        "aria-label",
        isMuted ? "Unmute sound" : "Mute sound",
      );
    }
    if (!isMuted) {
      playSound("click");
    }
  }

  function openLeaderboardModal() {
    playSound("click");
    renderLeaderboardTable(dom.leaderboardTableBody, currentLeaderboard);
    if (dom.leaderboardModal) {
      dom.leaderboardModal.removeAttribute("hidden");
      if (typeof dom.leaderboardModal.showModal === "function") {
        if (!dom.leaderboardModal.open) dom.leaderboardModal.showModal();
      }
      const modalCard = dom.leaderboardModal.querySelector(".modal-card");
      if (modalCard) {
        modalCard.scrollTop = 0;
      }
      if (dom.closeLeaderboardTopBtn) {
        dom.closeLeaderboardTopBtn.focus();
      } else if (dom.closeLeaderboardBtn) {
        dom.closeLeaderboardBtn.focus();
      }
    }
  }

  function closeLeaderboardModal() {
    playSound("click");
    if (dom.leaderboardModal) {
      if (
        typeof dom.leaderboardModal.close === "function" &&
        dom.leaderboardModal.open
      ) {
        dom.leaderboardModal.close();
      }
      dom.leaderboardModal.setAttribute("hidden", "");
    }
    if (dom.leaderboardBtn) {
      dom.leaderboardBtn.focus();
    }
  }

  async function handleSaveScore(e) {
    e.preventDefault();
    if (gameState.mode === "practice") return;
    if (!dom.playerNameInput) return;
    const name = dom.playerNameInput.value.trim();
    if (!name) return;

    try {
      localStorage.setItem("state_game_player_name", name);
    } catch {
      // Storage unavailable
    }

    if (dom.submitScoreBtn) {
      dom.submitScoreBtn.disabled = true;
      dom.submitScoreBtn.textContent = "Saving...";
    }

    const total = gameState.queue ? gameState.queue.length : 50;
    if (!activePendingScore || activePendingScore.score !== gameState.score) {
      activePendingScore = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        score: gameState.score,
        total,
        accuracy: calculateAccuracy(gameState.score, gameState.attempts),
        streak: gameState.maxStreak || 0,
        date: new Date().toISOString(),
      };
    } else {
      activePendingScore.name = name;
    }

    const scoreEntry = activePendingScore;
    const result = await submitScore(scoreEntry);
    if (result.success) {
      activePendingScore = null;
    }

    currentLeaderboard = result.scores;
    cachedBestScore = getBestScore(currentLeaderboard);
    if (activeMode === "challenge" && dom.bestScore) {
      dom.bestScore.textContent = String(cachedBestScore);
    }
    updatePlayerNamesDatalist(dom.playerNamesList, currentLeaderboard);

    // Find rank of newly added score (matching savedId or entry id or name+score)
    const newIdx = currentLeaderboard.findIndex((s) => {
      if (result.savedId && s.id) {
        return s.id === result.savedId;
      }
      if (scoreEntry.id && s.id === scoreEntry.id) {
        return true;
      }
      return (
        result.success &&
        s.name === scoreEntry.name &&
        s.score === scoreEntry.score
      );
    });

    renderLeaderboardTable(
      dom.gameOverLeaderboardBody,
      currentLeaderboard,
      newIdx,
    );
    renderLeaderboardTable(
      dom.leaderboardTableBody,
      currentLeaderboard,
      newIdx,
    );

    if (result.success) {
      if (newIdx !== -1) {
        if (dom.submitScoreBtn) {
          dom.submitScoreBtn.textContent = "Saved!";
        }
        announceStatus("Score saved successfully to top 10 leaderboard!");
      } else {
        if (dom.submitScoreBtn) {
          dom.submitScoreBtn.textContent = "Recorded";
        }
        announceStatus("Score recorded, but did not qualify for the top 10.");
      }
    } else {
      if (dom.submitScoreBtn) {
        dom.submitScoreBtn.disabled = false;
        dom.submitScoreBtn.textContent = "Retry";
      }
      announceStatus(
        "Could not save score to online leaderboard. Saved locally.",
      );
    }
  }

  // Event Listeners
  if (dom.soundToggleBtn) {
    dom.soundToggleBtn.addEventListener("click", toggleSound);
  }

  if (dom.leaderboardBtn) {
    dom.leaderboardBtn.addEventListener("click", openLeaderboardModal);
  }

  if (dom.closeLeaderboardBtn) {
    dom.closeLeaderboardBtn.addEventListener("click", closeLeaderboardModal);
  }

  if (dom.closeLeaderboardTopBtn) {
    dom.closeLeaderboardTopBtn.addEventListener("click", closeLeaderboardModal);
  }

  if (dom.closeGameOverBtn) {
    dom.closeGameOverBtn.addEventListener("click", closeGameOverModal);
  }

  if (dom.reviewMapBtn) {
    dom.reviewMapBtn.addEventListener("click", closeGameOverModal);
  }

  if (dom.viewResultsBtn) {
    dom.viewResultsBtn.addEventListener("click", () => {
      playSound("click");
      if (gameState.completed && gameState.gameOverReason !== "three_strikes") {
        startConfetti(dom.confettiCanvas);
      }
      openGameOverModalUI();
    });
  }

  if (dom.newGameBtn) {
    dom.newGameBtn.addEventListener("click", handleRestart);
  }

  if (dom.restartBtn) {
    dom.restartBtn.addEventListener("click", handleRestart);
  }

  if (dom.playAgainBtn) {
    dom.playAgainBtn.addEventListener("click", handleRestart);
  }

  // Mode radio group event listeners & roving tabindex
  const modeButtons = [dom.modeChallengeBtn, dom.modePracticeBtn].filter(
    Boolean,
  );

  function handleModeKeyDown(e) {
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const currentBtn = document.activeElement;
      const currentIndex = modeButtons.indexOf(currentBtn);
      if (currentIndex === -1) return;
      let nextIndex;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        nextIndex =
          (currentIndex - 1 + modeButtons.length) % modeButtons.length;
      } else {
        nextIndex = (currentIndex + 1) % modeButtons.length;
      }
      const nextBtn = modeButtons[nextIndex];
      const targetMode = nextBtn.dataset.mode;
      if (targetMode === activeMode) {
        nextBtn.focus();
        return;
      }
      const switched = requestModeSwitch(targetMode);
      if (switched) {
        nextBtn.focus();
      } else {
        currentBtn.focus();
      }
    }
  }

  if (dom.modeChallengeBtn) {
    dom.modeChallengeBtn.addEventListener("click", () => {
      requestModeSwitch("challenge");
    });
  }

  if (dom.modePracticeBtn) {
    dom.modePracticeBtn.addEventListener("click", () => {
      requestModeSwitch("practice");
    });
  }

  if (dom.modeToggle) {
    dom.modeToggle.addEventListener("keydown", handleModeKeyDown);
  }

  if (dom.gameOverModal) {
    dom.gameOverModal.addEventListener("click", (e) => {
      if (e.target === dom.gameOverModal) {
        closeGameOverModal();
      }
    });
    dom.gameOverModal.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeGameOverModal();
    });
  }

  if (dom.leaderboardModal) {
    dom.leaderboardModal.addEventListener("click", (e) => {
      if (e.target === dom.leaderboardModal) {
        closeLeaderboardModal();
      }
    });
    dom.leaderboardModal.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeLeaderboardModal();
    });
  }

  if (dom.saveScoreForm) {
    dom.saveScoreForm.addEventListener("submit", handleSaveScore);
  }

  // State SVG paths
  dom.statePaths.forEach((path) => {
    path.addEventListener("click", () => {
      handleStateSelection(path.id);
    });

    path.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleStateSelection(path.id);
      }
    });
  });

  // Initial render
  render(dom, gameState, { bestScore: cachedBestScore });
  const first = gameState.queue[0];
  if (first) {
    announceStatus(`Game started. Find ${first.name}.`);
  }

  return {
    getGameState: () => gameState,
    getActiveMode: () => activeMode,
    requestModeSwitch,
    startNewGame,
    handleStateSelection,
    handleRestart,
    toggleSound,
    openLeaderboardModal,
    closeLeaderboardModal,
    handleSaveScore,
  };
}

/* ==========================================================================
   Node / Module Export Guard
   ========================================================================== */

if (typeof document !== "undefined") {
  initializeApp();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    shuffleStates,
    createGameState,
    evaluateGuess,
    skipCurrentState,
    calculateAccuracy,
    checkNewPracticeBest,
    getPracticeBestScore,
    initializeApp,
    bindDomElements,
    render,
    playSound,
    fetchScores,
    submitScore,
    sortScores,
    getStoredScores,
    setStoredScores,
    getBestScore,
    qualifiesForTop10,
  };
}
