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
 * @param {Array|null} customQueue - Optional pre-ordered queue (for deterministic tests)
 * @returns {Object} Fresh game state object
 */
function createGameState(states, customQueue = null) {
  const queue = customQueue ? [...customQueue] : shuffleStates(states);
  return {
    states: [...states],
    queue,
    currentIndex: 0,
    score: 0,
    attempts: 0,
    streak: 0,
    maxStreak: 0,
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
    }
    return {
      isCorrect: true,
      targetState,
      selectedState,
      gameState,
    };
  } else {
    gameState.attempts += 1;
    gameState.streak = 0;
    // A wrong guess does not answer the target, so no history entry is written.
    // The target retains its neutral appearance; transient incorrect feedback is presentational.
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
   DOM Binding & Rendering
   ========================================================================== */

function bindDomElements() {
  return {
    soundToggleBtn: document.getElementById("sound-toggle"),
    restartBtn: document.getElementById("restart-btn"),
    promptCard: document.getElementById("prompt-card"),
    targetStateName: document.getElementById("target-state-name"),
    skipBtn: document.getElementById("skip-btn"),
    currentRound: document.getElementById("current-round"),
    totalRounds: document.getElementById("total-rounds"),
    scoreCount: document.getElementById("score-count"),
    streakCount: document.getElementById("streak-count"),
    accuracyRate: document.getElementById("accuracy-rate"),
    progressBar: document.getElementById("progress-bar"),
    statusLive: document.getElementById("status-live"),
    gameOverModal: document.getElementById("game-over-modal"),
    gameOverSummary: document.getElementById("game-over-summary"),
    playAgainBtn: document.getElementById("play-again-btn"),
    finalScore: document.getElementById("final-score"),
    finalAccuracy: document.getElementById("final-accuracy"),
    finalStreak: document.getElementById("final-streak"),
    confettiCanvas: document.getElementById("confetti-canvas"),
    statePaths: Array.from(document.querySelectorAll(".state")),
    stateChips: Array.from(document.querySelectorAll(".state-chip")),
  };
}

function render(dom, gameState) {
  if (!dom || !gameState) return;

  const total = gameState.queue ? gameState.queue.length : 0;
  if (dom.totalRounds) dom.totalRounds.textContent = String(total);

  if (dom.progressBar) {
    dom.progressBar.max = total;
    dom.progressBar.value = gameState.completed
      ? total
      : gameState.currentIndex;
  }

  if (gameState.completed) {
    if (dom.currentRound) dom.currentRound.textContent = String(total);
    if (dom.targetStateName) dom.targetStateName.textContent = "All Done!";
    if (dom.skipBtn) dom.skipBtn.disabled = true;

    if (dom.finalScore)
      dom.finalScore.textContent = `${gameState.score} / ${total}`;
    if (dom.finalAccuracy) {
      dom.finalAccuracy.textContent = calculateAccuracy(
        gameState.score,
        gameState.attempts,
      );
    }
    if (dom.finalStreak)
      dom.finalStreak.textContent = String(gameState.maxStreak);

    if (dom.gameOverSummary) {
      const skipped = total - gameState.score;
      dom.gameOverSummary.textContent =
        skipped === 0
          ? `Perfect! You identified all ${total} states.`
          : `You identified ${gameState.score} of ${total} states.`;
    }

    if (dom.gameOverModal) {
      if (typeof dom.gameOverModal.showModal === "function") {
        if (!dom.gameOverModal.open) dom.gameOverModal.showModal();
      } else {
        dom.gameOverModal.removeAttribute("hidden");
      }
    }
  } else {
    if (dom.currentRound) {
      dom.currentRound.textContent = String(gameState.currentIndex + 1);
    }
    const target = gameState.queue
      ? gameState.queue[gameState.currentIndex]
      : null;
    if (dom.targetStateName)
      dom.targetStateName.textContent = target ? target.name : "";
    if (dom.skipBtn) dom.skipBtn.disabled = false;

    if (dom.gameOverModal) {
      if (typeof dom.gameOverModal.close === "function") {
        if (dom.gameOverModal.open) dom.gameOverModal.close();
      } else {
        dom.gameOverModal.setAttribute("hidden", "");
      }
    }
  }

  if (dom.scoreCount) dom.scoreCount.textContent = String(gameState.score);
  if (dom.streakCount) dom.streakCount.textContent = String(gameState.streak);
  if (dom.accuracyRate) {
    dom.accuracyRate.textContent = calculateAccuracy(
      gameState.score,
      gameState.attempts,
    );
  }

  // Sync state map paths
  if (dom.statePaths) {
    for (const path of dom.statePaths) {
      const id = path.id;
      const historyItem = gameState.history[id];
      if (historyItem) {
        path.setAttribute("data-status", historyItem.status);
        path.setAttribute(
          "aria-label",
          `${path.dataset.name || id}, already found`,
        );
        if (
          historyItem.status === "correct" ||
          historyItem.status === "skipped"
        ) {
          path.setAttribute("aria-disabled", "true");
        }
      } else {
        path.removeAttribute("data-status");
        path.removeAttribute("aria-disabled");
        path.setAttribute("aria-label", path.dataset.name || id);
      }
    }
  }

  // Sync Northeast quick-select chips
  if (dom.stateChips) {
    for (const chip of dom.stateChips) {
      const id = chip.dataset.state;
      const historyItem = gameState.history[id];
      if (historyItem) {
        chip.setAttribute("data-status", historyItem.status);
        if (
          historyItem.status === "correct" ||
          historyItem.status === "skipped"
        ) {
          chip.disabled = true;
        }
      } else {
        chip.removeAttribute("data-status");
        chip.disabled = false;
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

  // Use global STATES from states-data.js
  const statesList = typeof STATES !== "undefined" ? STATES : [];
  let gameState = createGameState(statesList);

  function announceStatus(message) {
    if (dom.statusLive) {
      dom.statusLive.textContent = message;
    }
  }

  function handleStateSelection(stateId) {
    if (gameState.completed) return;

    // Ignore clicks on already completed or skipped states
    const existing = gameState.history[stateId];
    if (
      existing &&
      (existing.status === "correct" || existing.status === "skipped")
    ) {
      return;
    }

    const currentTarget = gameState.queue[gameState.currentIndex];
    const result = evaluateGuess(gameState, stateId);

    if (result.isCorrect) {
      playSound("correct");
      render(dom, gameState);

      if (gameState.completed) {
        playSound("victory");
        startConfetti(dom.confettiCanvas);
        announceStatus(
          `Correct! That was ${currentTarget.name}. Congratulations, you finished the map!`,
        );
        if (dom.playAgainBtn) dom.playAgainBtn.focus();
      } else {
        const nextTarget = gameState.queue[gameState.currentIndex];
        announceStatus(
          `Correct! That was ${currentTarget.name}. Next, find ${nextTarget.name}.`,
        );
      }
    } else {
      playSound("incorrect");
      render(dom, gameState);

      // Flash clicked state red temporarily after render
      const clickedPath = dom.statePaths.find((p) => p.id === stateId);
      const clickedChip = dom.stateChips.find(
        (c) => c.dataset.state === stateId,
      );

      if (clickedPath) clickedPath.setAttribute("data-status", "incorrect");
      if (clickedChip) clickedChip.setAttribute("data-status", "incorrect");

      setTimeout(() => {
        const curr = gameState.history[stateId];
        if (!curr || (curr.status !== "correct" && curr.status !== "skipped")) {
          if (clickedPath) clickedPath.removeAttribute("data-status");
          if (clickedChip) clickedChip.removeAttribute("data-status");
        }
      }, 700);

      const clickedName = result.selectedState
        ? result.selectedState.name
        : stateId;
      announceStatus(
        `Incorrect. That was ${clickedName}. Find ${currentTarget.name}.`,
      );
    }
  }

  function handleSkip() {
    if (gameState.completed) return;
    playSound("click");
    const skipped = skipCurrentState(gameState);
    if (!skipped || !skipped.targetState) return;
    render(dom, gameState);

    if (gameState.completed) {
      playSound("victory");
      announceStatus(
        `Skipped ${skipped.targetState.name}. Quiz completed! Final score: ${gameState.score} out of ${gameState.queue.length}.`,
      );
      if (dom.playAgainBtn) dom.playAgainBtn.focus();
    } else {
      const nextTarget = gameState.queue[gameState.currentIndex];
      const nextName = nextTarget ? nextTarget.name : "";
      announceStatus(
        `Skipped ${skipped.targetState.name}. Next, find ${nextName}.`,
      );
    }
  }

  function handleRestart() {
    playSound("click");
    stopConfetti(dom.confettiCanvas);
    gameState = createGameState(statesList);
    render(dom, gameState);
    const firstTarget = gameState.queue ? gameState.queue[0] : null;
    const firstName = firstTarget ? firstTarget.name : "";
    announceStatus(`Game restarted. Find ${firstName}.`);
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

  // Event Listeners
  if (dom.soundToggleBtn) {
    dom.soundToggleBtn.addEventListener("click", toggleSound);
  }

  if (dom.restartBtn) {
    dom.restartBtn.addEventListener("click", handleRestart);
  }

  if (dom.skipBtn) {
    dom.skipBtn.addEventListener("click", handleSkip);
  }

  if (dom.playAgainBtn) {
    dom.playAgainBtn.addEventListener("click", handleRestart);
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

  // Northeast chips
  dom.stateChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      handleStateSelection(chip.dataset.state);
    });
  });

  // Initial render
  render(dom, gameState);
  const first = gameState.queue[0];
  if (first) {
    announceStatus(`Game started. Find ${first.name}.`);
  }

  return {
    getGameState: () => gameState,
    handleStateSelection,
    handleSkip,
    handleRestart,
    toggleSound,
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
    initializeApp,
    bindDomElements,
    render,
    playSound,
  };
}
