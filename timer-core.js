(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimpleFitTimer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function buildTabataPhases(tabata) {
    const phases = [];
    tabata.intervals.forEach((interval, intervalIndex) => {
      for (let round = 1; round <= interval.rounds; round += 1) {
        phases.push({
          kind: 'work',
          exercise: interval.exercise,
          round,
          rounds: interval.rounds,
          durationMs: interval.workSeconds * 1000
        });
        phases.push({
          kind: 'rest',
          exercise: interval.exercise,
          round,
          rounds: interval.rounds,
          durationMs: interval.restSeconds * 1000
        });
      }
      if (intervalIndex < tabata.intervals.length - 1) {
        phases.push({
          kind: 'rotation-rest',
          exercise: tabata.intervals[intervalIndex + 1].exercise,
          round: 0,
          rounds: 0,
          durationMs: tabata.rotationRestSeconds * 1000
        });
      }
    });
    return phases;
  }

  function createTimer({ durationMs = null, phases = [] } = {}) {
    const calculatedDuration = phases.length
      ? phases.reduce((total, phase) => total + phase.durationMs, 0)
      : durationMs;
    return {
      status: 'idle',
      elapsedMs: 0,
      startedAt: null,
      durationMs: calculatedDuration,
      phases
    };
  }

  function effectiveElapsed(timer, now) {
    const active = timer.status === 'running' ? Math.max(0, now - timer.startedAt) : 0;
    const elapsed = timer.elapsedMs + active;
    return timer.durationMs === null ? elapsed : Math.min(elapsed, timer.durationMs);
  }

  function startTimer(timer, now) {
    if (timer.status !== 'idle' && timer.status !== 'paused') return timer;
    return { ...timer, status: 'running', startedAt: now };
  }

  function updateTimer(timer, now) {
    if (timer.status !== 'running' || timer.durationMs === null) return timer;
    const elapsedMs = effectiveElapsed(timer, now);
    if (elapsedMs < timer.durationMs) return timer;
    return { ...timer, status: 'completed', elapsedMs, startedAt: null };
  }

  function pauseTimer(timer, now) {
    const updated = updateTimer(timer, now);
    if (updated.status !== 'running') return updated;
    return {
      ...updated,
      status: 'paused',
      elapsedMs: effectiveElapsed(updated, now),
      startedAt: null
    };
  }

  function phaseAt(phases, elapsedMs) {
    let phaseStart = 0;
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      const phaseEnd = phaseStart + phase.durationMs;
      if (elapsedMs < phaseEnd) {
        return {
          phase,
          nextPhase: phases[index + 1] || null,
          phaseIndex: index,
          phaseElapsedMs: elapsedMs - phaseStart,
          phaseRemainingMs: phaseEnd - elapsedMs
        };
      }
      phaseStart = phaseEnd;
    }
    return { phase: null, nextPhase: null, phaseIndex: -1, phaseElapsedMs: 0, phaseRemainingMs: 0 };
  }

  function timerView(timer, now) {
    const elapsedMs = effectiveElapsed(timer, now);
    const remainingMs = timer.durationMs === null ? null : Math.max(0, timer.durationMs - elapsedMs);
    return {
      status: timer.status,
      elapsedMs,
      remainingMs,
      ...(timer.phases.length ? phaseAt(timer.phases, elapsedMs) : {})
    };
  }

  return { buildTabataPhases, createTimer, startTimer, pauseTimer, updateTimer, timerView };
});
