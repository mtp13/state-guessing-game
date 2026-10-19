const test = require("node:test");
const assert = require("node:assert/strict");
const { STATES } = require("../states-data.js");
const {
  shuffleStates,
  createGameState,
  evaluateGuess,
  skipCurrentState,
  calculateAccuracy,
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
