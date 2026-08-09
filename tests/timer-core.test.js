const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildTabataPhases,
  createTimer,
  startTimer,
  pauseTimer,
  updateTimer,
  timerView
} = require('../timer-core.js');

const workouts = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/workouts.json'), 'utf8'));

test('countdown pause and resume preserves prior elapsed time', () => {
  let timer = createTimer({ durationMs: 20 * 60 * 1000 });
  timer = startTimer(timer, 0);
  timer = pauseTimer(timer, 10_000);
  timer = startTimer(timer, 20_000);

  const view = timerView(timer, 25_000);
  assert.equal(view.elapsedMs, 15_000);
  assert.equal(view.remainingMs, 20 * 60 * 1000 - 15_000);
});

test('completed countdown cannot restart without creating a new timer', () => {
  let timer = startTimer(createTimer({ durationMs: 1_000 }), 0);
  timer = updateTimer(timer, 1_000);
  assert.equal(timer.status, 'completed');
  assert.equal(timerView(timer, 2_000).remainingMs, 0);
  assert.equal(startTimer(timer, 2_000).status, 'completed');
});

test('stopwatch retains fractional milliseconds across pauses', () => {
  let timer = startTimer(createTimer({ durationMs: null }), 0);
  timer = pauseTimer(timer, 750);
  timer = startTimer(timer, 1_000);
  timer = pauseTimer(timer, 1_750);
  assert.equal(timerView(timer, 2_000).elapsedMs, 1_500);
});

test('Tabata phases are derived from workout data and expose transitions', () => {
  const phases = buildTabataPhases(workouts.tabata);
  assert.equal(phases.length, 67);
  assert.equal(phases.reduce((sum, phase) => sum + phase.durationMs, 0), 19 * 60 * 1000);

  const timer = startTimer(createTimer({ phases }), 0);
  assert.deepEqual(timerView(timer, 0).phase, {
    kind: 'work', exercise: 'push-up', round: 1, rounds: 8, durationMs: 20_000
  });
  assert.equal(timerView(timer, 20_000).phase.kind, 'rest');
  assert.equal(timerView(timer, 30_000).phase.round, 2);
  assert.equal(timerView(timer, 240_000).phase.kind, 'rotation-rest');
  assert.equal(timerView(timer, 300_000).phase.exercise, 'squat');
});


test('Tabata view identifies the phase after the final rest in a movement block', () => {
  const phases = buildTabataPhases(workouts.tabata);
  const timer = startTimer(createTimer({ phases }), 0);
  const view = timerView(timer, 230_000);
  assert.equal(view.phase.kind, 'rest');
  assert.equal(view.phase.round, 8);
  assert.equal(view.nextPhase.kind, 'rotation-rest');
  assert.equal(view.nextPhase.exercise, 'squat');
});
