const test = require("node:test");
const assert = require("node:assert/strict");
const { STATES } = require("../states-data.js");
const {
  shuffleStates,
  createGameState,
  evaluateGuess,
  skipCurrentState,
  calculateAccuracy,
  checkNewPracticeBest,
} = require("../app.js");

test("shuffleStates produces a new shuffled array without mutating input", () => {
  const original = [...STATES];
  const originalCopy = [...STATES];

  // Deterministic mock RNG that reverses order
  let step = 0;
  const mockRng = () => 0; // always picks index 0
  const shuffled = shuffleStates(original, mockRng);

  assert.notEqual(
    shuffled,
    original,
    "shuffleStates must return a new array instance",
  );
  assert.equal(
    shuffled.length,
    original.length,
    "shuffled length must match original",
  );
  assert.deepEqual(
    original,
    originalCopy,
    "Original array must not be mutated",
  );

  // Default Math.random shuffle produces all elements
  const randomShuffled = shuffleStates(original);
  assert.equal(randomShuffled.length, 50);
  const ids = new Set(randomShuffled.map((s) => s.id));
  assert.equal(ids.size, 50, "All 50 unique states must be present");
});

test("createGameState initializes fresh state with proper defaults", () => {
  const game = createGameState(STATES);
  assert.equal(game.states.length, 50);
  assert.equal(game.queue.length, 50);
  assert.equal(game.currentIndex, 0);
  assert.equal(game.score, 0);
  assert.equal(game.attempts, 0);
  assert.equal(game.streak, 0);
  assert.equal(game.maxStreak, 0);
  assert.equal(game.strikes, 0);
  assert.equal(game.wrongGuesses, 0);
  assert.equal(game.maxWrongGuesses, 3);
  assert.equal(game.revealedStateId, null);
  assert.equal(game.gameOverReason, null);
  assert.deepEqual(game.history, {});
  assert.equal(game.completed, false);
});

test("createGameState supports custom pre-ordered queue", () => {
  const custom = [STATES[0], STATES[1]];
  const game = createGameState(STATES, custom);
  assert.equal(game.queue.length, 2);
  assert.equal(game.queue[0].id, STATES[0].id);
  assert.equal(game.queue[1].id, STATES[1].id);
});

test("evaluateGuess correctly handles correct guess", () => {
  const mockQueue = [
    { id: "TX", name: "Texas" },
    { id: "CA", name: "California" },
  ];
  const game = createGameState(STATES, mockQueue);

  const result = evaluateGuess(game, "TX");
  assert.equal(result.isCorrect, true);
  assert.equal(result.targetState.id, "TX");
  assert.equal(result.selectedState.id, "TX");
  assert.equal(game.score, 1);
  assert.equal(game.attempts, 1);
  assert.equal(game.streak, 1);
  assert.equal(game.maxStreak, 1);
  assert.equal(game.currentIndex, 1);
  assert.equal(game.completed, false);
  assert.deepEqual(game.history["TX"], {
    status: "correct",
    attempts: 1,
    skipped: false,
  });

  // Next correct guess finishes game
  const result2 = evaluateGuess(game, "CA");
  assert.equal(result2.isCorrect, true);
  assert.equal(game.score, 2);
  assert.equal(game.attempts, 2);
  assert.equal(game.streak, 2);
  assert.equal(game.maxStreak, 2);
  assert.equal(game.currentIndex, 2);
  assert.equal(game.completed, true);
});

test("evaluateGuess correctly handles incorrect guess without advancing queue", () => {
  const mockQueue = [
    { id: "FL", name: "Florida" },
    { id: "NY", name: "New York" },
  ];
  const game = createGameState(STATES, mockQueue);

  // Wrong guess: guess GA when target is FL
  const result = evaluateGuess(game, "GA");
  assert.equal(result.isCorrect, false);
  assert.equal(result.targetState.id, "FL");
  assert.equal(result.selectedState.id, "GA");
  assert.equal(game.score, 0);
  assert.equal(game.attempts, 1);
  assert.equal(game.streak, 0);
  assert.equal(game.maxStreak, 0);
  assert.equal(game.currentIndex, 0, "Queue must not advance on wrong guess");
  assert.equal(game.completed, false);
  assert.equal(
    game.history["FL"],
    undefined,
    "Target must remain unanswered after wrong guess",
  );
  assert.equal(
    game.history["GA"],
    undefined,
    "Wrong guess must not write history entry",
  );

  // Now guess correctly on second attempt
  const result2 = evaluateGuess(game, "FL");
  assert.equal(result2.isCorrect, true);
  assert.equal(game.score, 1);
  assert.equal(game.attempts, 2);
  assert.equal(game.streak, 1);
  assert.equal(game.maxStreak, 1);
  assert.equal(game.currentIndex, 1);
  assert.deepEqual(game.history["FL"], {
    status: "correct",
    attempts: 1,
    skipped: false,
  });
});

test("a wrong guess does not mark the target as incorrect in history", () => {
  const game = createGameState(STATES, [{ id: "FL", name: "Florida" }]);
  evaluateGuess(game, "GA");
  assert.equal(game.history["FL"], undefined, "target must stay unanswered");
  assert.equal(
    game.history["GA"],
    undefined,
    "wrong guess must not persist a status",
  );
  assert.equal(game.attempts, 1);
});

test("three strikes rule: 1st, 2nd, and 3rd wrong guesses behave correctly", () => {
  const mockQueue = [
    { id: "TX", name: "Texas" },
    { id: "CA", name: "California" },
  ];
  const game = createGameState(STATES, mockQueue);

  // 1st wrong guess: strikes = 1, game continues, target remains unrevealed
  const res1 = evaluateGuess(game, "FL");
  assert.equal(res1.isCorrect, false);
  assert.equal(game.strikes, 1);
  assert.equal(game.wrongGuesses, 1);
  assert.equal(game.completed, false);
  assert.equal(game.gameOverReason, null);
  assert.equal(game.revealedStateId, null);
  assert.equal(game.history["TX"], undefined);
  assert.equal(game.currentIndex, 0);

  // 2nd wrong guess: strikes = 2, game continues
  const res2 = evaluateGuess(game, "NY");
  assert.equal(res2.isCorrect, false);
  assert.equal(game.strikes, 2);
  assert.equal(game.wrongGuesses, 2);
  assert.equal(game.completed, false);
  assert.equal(game.gameOverReason, null);
  assert.equal(game.revealedStateId, null);
  assert.equal(game.history["TX"], undefined);
  assert.equal(game.currentIndex, 0);

  // 3rd wrong guess: strikes = 3, game completes with gameOverReason = "three_strikes",
  // target state marked status: "revealed", and revealedStateId = targetState.id
  const res3 = evaluateGuess(game, "WA");
  assert.equal(res3.isCorrect, false);
  assert.equal(game.strikes, 3);
  assert.equal(game.wrongGuesses, 3);
  assert.equal(game.completed, true);
  assert.equal(game.gameOverReason, "three_strikes");
  assert.equal(game.revealedStateId, "TX");
  assert.equal(game.history["TX"]?.status, "revealed");
});

test("skipCurrentState marks state skipped and advances queue", () => {
  const mockQueue = [
    { id: "RI", name: "Rhode Island" },
    { id: "DE", name: "Delaware" },
  ];
  const game = createGameState(STATES, mockQueue);

  // Make 1 correct guess streak
  game.streak = 5;
  game.maxStreak = 5;

  const skipResult = skipCurrentState(game);
  assert.equal(skipResult.targetState.id, "RI");
  assert.equal(game.score, 0);
  assert.equal(game.attempts, 1);
  assert.equal(game.streak, 0, "Streak resets to 0 on skip");
  assert.equal(game.maxStreak, 5, "Max streak preserved");
  assert.equal(game.currentIndex, 1);
  assert.deepEqual(game.history["RI"], {
    status: "skipped",
    attempts: 1,
    skipped: true,
  });
  assert.equal(game.completed, false);

  // Skip second state to complete game
  const skipResult2 = skipCurrentState(game);
  assert.equal(skipResult2.targetState.id, "DE");
  assert.equal(game.completed, true);
  assert.equal(game.currentIndex, 2);
});

test("calculateAccuracy handles edge cases and precision correctly", () => {
  assert.equal(calculateAccuracy(0, 0), "100%");
  assert.equal(calculateAccuracy(50, 50), "100%");
  assert.equal(calculateAccuracy(25, 50), "50%");
  assert.equal(calculateAccuracy(1, 3), "33%");
  assert.equal(calculateAccuracy(2, 3), "67%");
  assert.equal(calculateAccuracy(0, 5), "0%");
});

test("createGameState initializes practice mode state with proper defaults", () => {
  const game = createGameState(STATES, null, { mode: "practice" });
  assert.equal(game.mode, "practice");
  assert.equal(game.states.length, 50);
  assert.equal(game.queue.length, 50);
  assert.equal(game.currentIndex, 0);
  assert.equal(game.score, 0);
  assert.equal(game.attempts, 0);
  assert.equal(game.guesses, 0);
  assert.equal(game.streak, 0);
  assert.equal(game.maxStreak, 0);
  assert.equal(game.strikes, 0);
  assert.equal(game.wrongGuesses, 0);
  assert.equal(game.maxWrongGuesses, null);
  assert.equal(game.revealedStateId, null);
  assert.equal(game.gameOverReason, null);
  assert.equal(game.completed, false);
  assert.deepEqual(game.history, {});
});

test("createGameState supports flexible arguments for options and modes", () => {
  // 1. Default invocation
  const defaultGame = createGameState(STATES);
  assert.equal(defaultGame.mode, "challenge");
  assert.equal(defaultGame.maxWrongGuesses, 3);
  assert.equal(defaultGame.guesses, 0);

  // 2. Options passed as 2nd parameter object
  const practiceDirect = createGameState(STATES, { mode: "practice" });
  assert.equal(practiceDirect.mode, "practice");
  assert.equal(practiceDirect.queue.length, 50);
  assert.equal(practiceDirect.maxWrongGuesses, null);

  // 3. String mode passed as 2nd parameter
  const practiceString = createGameState(STATES, "practice");
  assert.equal(practiceString.mode, "practice");
  assert.equal(practiceString.maxWrongGuesses, null);

  // 4. Custom queue with string mode
  const custom = [STATES[0]];
  const customPractice = createGameState(STATES, custom, "practice");
  assert.equal(customPractice.mode, "practice");
  assert.equal(customPractice.queue.length, 1);

  // 5. Invalid mode string or object defaults to challenge
  const invalidModeGame = createGameState(STATES, null, { mode: "unknown" });
  assert.equal(invalidModeGame.mode, "challenge");
  assert.equal(invalidModeGame.maxWrongGuesses, 3);
});

test("practice mode: multiple wrong guesses increment attempts and guesses without strikes or elimination", () => {
  const mockQueue = [
    { id: "FL", name: "Florida" },
    { id: "NY", name: "New York" },
  ];
  const game = createGameState(STATES, mockQueue, { mode: "practice" });

  // 1st wrong guess
  const res1 = evaluateGuess(game, "GA");
  assert.equal(res1.isCorrect, false);
  assert.equal(game.attempts, 1);
  assert.equal(game.guesses, 1);
  assert.equal(game.strikes, 0, "Strikes must remain 0 in practice mode");
  assert.equal(game.currentIndex, 0, "Queue must not advance on wrong guess");
  assert.equal(game.completed, false);
  assert.equal(game.history["FL"], undefined);

  // 2nd wrong guess
  const res2 = evaluateGuess(game, "AL");
  assert.equal(res2.isCorrect, false);
  assert.equal(game.attempts, 2);
  assert.equal(game.guesses, 2);
  assert.equal(game.strikes, 0);
  assert.equal(game.currentIndex, 0);
  assert.equal(game.completed, false);

  // 3rd wrong guess - MUST NOT trigger 3-strikes game over or reveal state
  const res3 = evaluateGuess(game, "NC");
  assert.equal(res3.isCorrect, false);
  assert.equal(game.attempts, 3);
  assert.equal(game.guesses, 3);
  assert.equal(
    game.strikes,
    0,
    "3rd miss in practice mode must never give a strike",
  );
  assert.equal(
    game.completed,
    false,
    "3rd miss in practice mode must not end game",
  );
  assert.equal(game.gameOverReason, null);
  assert.equal(game.revealedStateId, null);
  assert.equal(game.history["FL"], undefined);

  // 4th wrong guess - proves unlimited attempts
  const res4 = evaluateGuess(game, "SC");
  assert.equal(res4.isCorrect, false);
  assert.equal(game.attempts, 4);
  assert.equal(game.guesses, 4);
  assert.equal(game.strikes, 0);
  assert.equal(game.completed, false);

  // 5th attempt is correct
  const res5 = evaluateGuess(game, "FL");
  assert.equal(res5.isCorrect, true);
  assert.equal(game.score, 1);
  assert.equal(game.attempts, 5);
  assert.equal(game.guesses, 5);
  assert.equal(game.streak, 1);
  assert.equal(game.currentIndex, 1);
  assert.equal(game.completed, false);
  assert.deepEqual(game.history["FL"], {
    status: "correct",
    attempts: 1,
    skipped: false,
  });
});

test("practice mode: finding all queue states marks game completed without strikes", () => {
  const mockQueue = [
    { id: "TX", name: "Texas" },
    { id: "CA", name: "California" },
  ];
  const game = createGameState(STATES, mockQueue, { mode: "practice" });

  evaluateGuess(game, "FL"); // 1 wrong
  evaluateGuess(game, "TX"); // 1 correct
  assert.equal(game.completed, false);
  assert.equal(game.currentIndex, 1);

  evaluateGuess(game, "NV"); // 1 wrong on CA
  evaluateGuess(game, "CA"); // 2 correct
  assert.equal(game.completed, true);
  assert.equal(game.score, 2);
  assert.equal(game.attempts, 4);
  assert.equal(game.guesses, 4);
  assert.equal(game.gameOverReason, "completed");
  assert.equal(game.revealedStateId, null);
  assert.equal(game.strikes, 0);
});

test("calculateAccuracy accurately handles practice mode repeat attempt ratios", () => {
  // 50 states found on first try (50/50)
  assert.equal(calculateAccuracy(50, 50), "100%");
  // 50 states found with 15 misses (50/65 = 76.9% -> 77%)
  assert.equal(calculateAccuracy(50, 65), "77%");
  // 50 states found with 50 misses (50/100 = 50%)
  assert.equal(calculateAccuracy(50, 100), "50%");
  // 50 states found with 100 misses (50/150 = 33.3% -> 33%)
  assert.equal(calculateAccuracy(50, 150), "33%");
});

test("checkNewPracticeBest correctly compares personal best fewest guesses", () => {
  // Initial runs without prior best
  assert.deepEqual(checkNewPracticeBest(null, 58), {
    isNewBest: true,
    bestGuesses: 58,
  });
  assert.deepEqual(checkNewPracticeBest(undefined, 52), {
    isNewBest: true,
    bestGuesses: 52,
  });
  assert.deepEqual(checkNewPracticeBest("", 50), {
    isNewBest: true,
    bestGuesses: 50,
  });
  assert.deepEqual(checkNewPracticeBest("not_a_number", 50), {
    isNewBest: true,
    bestGuesses: 50,
  });

  // Prior numeric best of 60
  assert.deepEqual(checkNewPracticeBest(60, 55), {
    isNewBest: true,
    bestGuesses: 55,
  });
  assert.deepEqual(checkNewPracticeBest(60, 65), {
    isNewBest: false,
    bestGuesses: 60,
  });
  assert.deepEqual(checkNewPracticeBest(60, 60), {
    isNewBest: false,
    bestGuesses: 60,
  });

  // Prior string best from localStorage (e.g. "60")
  assert.deepEqual(checkNewPracticeBest("60", 55), {
    isNewBest: true,
    bestGuesses: 55,
  });
  assert.deepEqual(checkNewPracticeBest("60", 65), {
    isNewBest: false,
    bestGuesses: 60,
  });
  assert.deepEqual(checkNewPracticeBest("60", 60), {
    isNewBest: false,
    bestGuesses: 60,
  });
});

test("skipCurrentState correctly tracks guesses and sets gameOverReason on completion", () => {
  const mockQueue = [
    { id: "RI", name: "Rhode Island" },
    { id: "DE", name: "Delaware" },
  ];
  const game = createGameState(STATES, mockQueue, { mode: "practice" });

  const res1 = skipCurrentState(game);
  assert.equal(res1.targetState.id, "RI");
  assert.equal(game.attempts, 1);
  assert.equal(game.guesses, 1);
  assert.equal(game.completed, false);

  const res2 = skipCurrentState(game);
  assert.equal(res2.targetState.id, "DE");
  assert.equal(game.attempts, 2);
  assert.equal(game.guesses, 2);
  assert.equal(game.completed, true);
  assert.equal(game.gameOverReason, "completed");

  // Skip after completed returns null
  assert.equal(skipCurrentState(game), null);
});

test("evaluateGuess returns safe result when game is already completed", () => {
  const game = createGameState(STATES, [{ id: "TX", name: "Texas" }]);
  evaluateGuess(game, "TX");
  assert.equal(game.completed, true);

  const result = evaluateGuess(game, "CA");
  assert.equal(result.isCorrect, false);
  assert.equal(result.targetState, null);
  assert.equal(result.selectedState, null);
  assert.equal(result.gameState, game);
});

test("challenge mode explicitly requested preserves 3 strikes elimination", () => {
  const mockQueue = [
    { id: "TX", name: "Texas" },
    { id: "CA", name: "California" },
  ];
  const game = createGameState(STATES, mockQueue, { mode: "challenge" });
  assert.equal(game.mode, "challenge");
  assert.equal(game.maxWrongGuesses, 3);

  evaluateGuess(game, "FL");
  assert.equal(game.strikes, 1);
  evaluateGuess(game, "NY");
  assert.equal(game.strikes, 2);
  evaluateGuess(game, "WA");
  assert.equal(game.strikes, 3);
  assert.equal(game.completed, true);
  assert.equal(game.gameOverReason, "three_strikes");
  assert.equal(game.revealedStateId, "TX");
});

test("formatLocalDate renders a local date string and tolerates bad input", () => {
  const { formatLocalDate } = require("../app.js");
  const iso = "2026-10-20T01:30:00.000Z";
  assert.equal(formatLocalDate(iso), new Date(iso).toLocaleDateString());
  assert.equal(typeof formatLocalDate("not-a-date"), "string");
  assert.equal(typeof formatLocalDate(undefined), "string");
});

test("client filterTodayScores filters scores by America/Chicago calendar day", () => {
  const { getDayKey, filterTodayScores } = require("../app.js");
  const prevDay = "2026-10-20T04:00:00.000Z"; // 23:00 CDT on Oct 19
  const sameDay = "2026-10-20T06:00:00.000Z"; // 01:00 CDT on Oct 20
  assert.equal(getDayKey(prevDay), "2026-10-19");
  assert.equal(getDayKey(sameDay), "2026-10-20");

  const filtered = filterTodayScores(
    [
      { name: "Old", score: 45, date: prevDay },
      { name: "Today", score: 40, date: sameDay },
    ],
    new Date("2026-10-20T15:00:00.000Z"),
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "Today");
});
