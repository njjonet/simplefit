const $ = selector => document.querySelector(selector);
const DB_NAME = 'simplefit-db';
const STORE = 'logs';
const PERSISTENCE_LOCK_NAME = 'simplefit-history-persistence';

let data;
let current;
let timerId = null;
let timerState = null;
let lastPhaseIndex = null;
let workoutSaved = false;
let persistenceInProgress = false;
let lockedControlStates = null;

const PERSISTENCE_LOCK_SELECTORS = [
  '#program', '#level', '#day', '#loadWorkout', '#startPause', '#finish', '#reset',
  '#rounds', '#score', '#notes', '#exportData', '#importData'
];

function setActiveAppView(viewName, root = document) {
  for (const button of root.querySelectorAll('[data-app-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.appView === viewName));
  }
  for (const panel of root.querySelectorAll('[data-view-panel]')) {
    panel.classList.toggle('is-active', panel.dataset.viewPanel === viewName);
  }
}

function setupAppViewNavigation(root = document) {
  for (const button of root.querySelectorAll('[data-app-view]')) {
    button.addEventListener('click', () => setActiveAppView(button.dataset.appView, root));
  }
  setActiveAppView('workout', root);
}

function acquirePersistenceLock() {
  if (persistenceInProgress) return false;
  persistenceInProgress = true;
  lockedControlStates = PERSISTENCE_LOCK_SELECTORS.map(selector => {
    const element = $(selector);
    const state = { element, disabled: element.disabled };
    element.disabled = true;
    return state;
  });
  return true;
}

function releasePersistenceLock() {
  if (!persistenceInProgress) return;
  for (const { element, disabled } of lockedControlStates) element.disabled = disabled;
  lockedControlStates = null;
  persistenceInProgress = false;
  if (timerState?.status === 'completed' || workoutSaved) $('#startPause').disabled = true;
  if (workoutSaved) $('#finish').disabled = true;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workout history is open in another tab. Close it and try again.'));
  });
}

async function addLog(log) {
  const db = await openDb();
  try {
    await SimpleFitCore.addStoreRecord(
      db,
      STORE,
      log,
      SimpleFitBackup.validateExportableLogs
    );
  } finally {
    db.close();
  }
}

async function getLogs() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(SimpleFitCore.sortLogsNewestFirst(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function replaceLogs(logs, expectedLogs) {
  SimpleFitBackup.validateExportableLogs(logs);
  const db = await openDb();
  try {
    await SimpleFitCore.replaceStoreRecordsIfUnchanged(db, STORE, expectedLogs, logs);
  } finally {
    db.close();
  }
}

function formatMilliseconds(milliseconds, roundUp = false) {
  const seconds = Math.max(0, roundUp
    ? Math.ceil(milliseconds / 1000)
    : Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderLevels() {
  const select = $('#level');
  const options = data.programs.beginner.levels.map(level => {
    const option = document.createElement('option');
    option.value = String(level.level);
    option.textContent = `Level ${level.level}`;
    return option;
  });
  select.replaceChildren(...options);
}

function renderExerciseList(items) {
  const nodes = items.map(item => {
    const row = document.createElement('div');
    row.className = 'exercise-item';
    const exercise = document.createElement('strong');
    exercise.textContent = item.exercise;
    const detail = document.createElement('span');
    detail.textContent = Number.isFinite(item.reps) ? `${item.reps} reps` : String(item.reps);
    row.append(exercise, detail);
    return row;
  });
  $('#exerciseList').replaceChildren(...nodes);
}

function tabataStatus(view) {
  if (!view.phase) return 'Tabata complete';
  if (view.phase.kind === 'work') {
    return `Work · ${view.phase.exercise} · round ${view.phase.round} of ${view.phase.rounds}`;
  }
  if (view.phase.kind === 'rest') {
    if (view.nextPhase?.kind === 'work') {
      return `Rest · next: ${view.nextPhase.exercise} round ${view.nextPhase.round}`;
    }
    if (view.nextPhase?.kind === 'rotation-rest') return 'Rest · rotation break next';
    return 'Final rest';
  }
  return `Rotation rest · next: ${view.phase.exercise}`;
}

function updateTimerDisplay(now = Date.now()) {
  if (!timerState) return;
  const previousStatus = timerState.status;
  timerState = SimpleFitTimer.updateTimer(timerState, now);
  const view = SimpleFitTimer.timerView(timerState, now);

  if (timerState.phases.length) {
    $('#timer').textContent = formatMilliseconds(view.phaseRemainingMs, true);
    SimpleFitCore.setTextIfChanged($('#timerStatus'), tabataStatus(view));
    if (view.phaseIndex !== lastPhaseIndex) {
      if (lastPhaseIndex !== null && previousStatus === 'running' && navigator.vibrate) navigator.vibrate(80);
      lastPhaseIndex = view.phaseIndex;
    }
  } else if (timerState.durationMs !== null) {
    $('#timer').textContent = formatMilliseconds(view.remainingMs, true);
    SimpleFitCore.setTextIfChanged($('#timerStatus'), timerState.status === 'completed' ? 'Workout complete' : 'Countdown');
  } else {
    $('#timer').textContent = formatMilliseconds(view.elapsedMs);
    SimpleFitCore.setTextIfChanged($('#timerStatus'), timerState.status === 'running' ? 'Workout in progress' : 'Stopwatch');
  }

  if (timerState.status === 'completed') {
    clearInterval(timerId);
    timerId = null;
    $('#startPause').textContent = 'Done';
    $('#startPause').disabled = true;
    if (previousStatus !== 'completed' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

function renderWorkout() {
  if (persistenceInProgress) return;
  clearInterval(timerId);
  timerId = null;
  lastPhaseIndex = null;
  workoutSaved = false;

  const program = $('#program').value;
  const isTabata = program === 'tabata';
  $('#level-wrap').style.display = isTabata ? 'none' : '';
  $('#day-wrap').style.display = isTabata ? 'none' : '';

  if (isTabata) {
    const phases = SimpleFitTimer.buildTabataPhases(data.tabata);
    current = {
      program: 'tabata',
      level: null,
      day: null,
      type: 'tabata',
      title: 'Tabata · 4 movements',
      label: '20 seconds work · 10 seconds rest',
      work: data.tabata.intervals.map(interval => ({
        exercise: interval.exercise,
        reps: `${interval.rounds} rounds · ${interval.workSeconds}s work / ${interval.restSeconds}s rest`
      }))
    };
    timerState = SimpleFitTimer.createTimer({ phases });
  } else {
    const levelNumber = Number($('#level').value);
    const dayNumber = Number($('#day').value);
    const level = data.programs.beginner.levels.find(item => item.level === levelNumber)
      || data.programs.beginner.levels[0];
    const workout = level.days[dayNumber - 1] || level.days[0];
    current = {
      ...workout,
      program: 'beginner',
      level: level.level,
      day: dayNumber,
      title: `Beginner level ${level.level} · Day ${dayNumber}`
    };
    timerState = SimpleFitTimer.createTimer({
      durationMs: current.type === 'amrap' ? current.durationSeconds * 1000 : null
    });
  }

  $('#startPause').textContent = 'Start';
  $('#startPause').disabled = false;
  $('#finish').disabled = false;
  $('#workoutTitle').textContent = current.title;
  $('#workoutType').textContent = current.label || current.type;
  renderExerciseList(current.work);
  updateTimerDisplay();

  SimpleFitCore.saveSelection(SimpleFitCore.getOptionalStorage(globalThis), {
    program,
    level: $('#level').value,
    day: $('#day').value
  });
}

function startPause() {
  if (persistenceInProgress || !current || workoutSaved || timerState.status === 'completed') return;
  const now = Date.now();
  if (timerState.status === 'running') {
    timerState = SimpleFitTimer.pauseTimer(timerState, now);
    clearInterval(timerId);
    timerId = null;
    $('#startPause').textContent = 'Resume';
    SimpleFitCore.setTextIfChanged($('#timerStatus'), 'Workout paused');
  } else {
    timerState = SimpleFitTimer.startTimer(timerState, now);
    timerId = setInterval(updateTimerDisplay, 250);
    $('#startPause').textContent = 'Pause';
    updateTimerDisplay(now);
  }
}

function applyFinishControlState(saveFailed = false) {
  const controls = SimpleFitCore.finishControlState(timerState.status, saveFailed);
  $('#startPause').textContent = controls.startLabel;
  $('#startPause').disabled = controls.startDisabled;
  SimpleFitCore.setTextIfChanged($('#timerStatus'), controls.statusText);
}

async function finish() {
  if (persistenceInProgress || !current || workoutSaved) return;
  const now = Date.now();
  if (timerState.status === 'running') timerState = SimpleFitTimer.pauseTimer(timerState, now);
  clearInterval(timerId);
  timerId = null;

  applyFinishControlState();

  const view = SimpleFitTimer.timerView(timerState, now);
  const createdAt = new Date().toISOString();
  const id = globalThis.crypto?.randomUUID?.() || `${createdAt}-${Math.random().toString(36).slice(2)}`;
  const log = {
    id,
    createdAt,
    program: current.program,
    level: current.level,
    day: current.day,
    type: current.type,
    title: current.title,
    durationSeconds: Math.round(view.elapsedMs / 1000),
    roundsCompleted: Number($('#rounds').value) || 0,
    score: $('#score').value.trim(),
    notes: $('#notes').value.trim()
  };

  if (!acquirePersistenceLock()) return;
  let result;
  try {
    result = await SimpleFitCore.withCrossContextLock(
      globalThis,
      PERSISTENCE_LOCK_NAME,
      () => SimpleFitCore.persistThenRefresh(() => addLog(log), renderHistory)
    );
  } catch (error) {
    releasePersistenceLock();
    applyFinishControlState(true);
    $('#finish').disabled = false;
    alert(`Save failed: ${error.message}`);
    return;
  }

  workoutSaved = true;
  releasePersistenceLock();
  $('#startPause').disabled = true;
  $('#finish').disabled = true;
  SimpleFitCore.setTextIfChanged($('#timerStatus'), 'Workout saved');
  $('#rounds').value = 0;
  $('#score').value = '';
  $('#notes').value = '';
  if (result.refreshError) {
    alert(`Workout saved, but history could not refresh: ${result.refreshError.message}. Reload the page to update the list.`);
  }
}

async function renderHistory() {
  const logs = await getLogs();
  SimpleFitCore.renderHistory($('#history'), logs);
}

function restoreSelection() {
  const last = SimpleFitCore.loadSelection(SimpleFitCore.getOptionalStorage(globalThis));
  if ([...$('#program').options].some(option => option.value === last.program)) $('#program').value = last.program;
  if ([...$('#level').options].some(option => option.value === String(last.level))) $('#level').value = String(last.level);
  if ([...$('#day').options].some(option => option.value === String(last.day))) $('#day').value = String(last.day);
}

async function performExport() {
  const logs = await getLogs();
  if (!logs.length) {
    alert('There is no workout history to export yet.');
    return;
  }
  const bytes = SimpleFitBackup.createBackupZip(logs);
  const blob = new Blob([bytes], { type: 'application/zip' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `simplefit-history-${new Date().toISOString().slice(0, 10)}.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

async function exportHistory() {
  if (persistenceInProgress || !acquirePersistenceLock()) return;
  try {
    await SimpleFitCore.withCrossContextLock(globalThis, PERSISTENCE_LOCK_NAME, performExport);
  } catch (error) {
    alert(`Export failed: ${error.message}`);
  } finally {
    releasePersistenceLock();
  }
}

async function prepareImport(file) {
  let backup;
  let existing;
  try {
    if (file.size > SimpleFitBackup.MAX_BACKUP_FILE_BYTES) {
      throw new Error('The selected SimpleFit backup file is too large.');
    }
    backup = SimpleFitBackup.parseBackupBytes(await file.arrayBuffer());
    existing = await getLogs();
  } catch (error) {
    alert(`Import failed: ${error.message}`);
    return null;
  }

  const message = existing.length
    ? `Replace ${existing.length} existing workout${existing.length === 1 ? '' : 's'} with ${backup.logs.length} imported workout${backup.logs.length === 1 ? '' : 's'}? Export your current history first if you may need it.`
    : `Import ${backup.logs.length} workout${backup.logs.length === 1 ? '' : 's'}?`;
  return confirm(message) ? { backup, existing } : null;
}

async function commitImport({ backup, existing }) {
  await replaceLogs(backup.logs, existing);
  return backup.logs.length;
}

async function importHistory(event) {
  if (persistenceInProgress) {
    event.target.value = '';
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  if (!acquirePersistenceLock()) {
    event.target.value = '';
    return;
  }
  try {
    const prepared = await prepareImport(file);
    if (!prepared) return;
    let importedCount;
    try {
      importedCount = await SimpleFitCore.withCrossContextLock(
        globalThis,
        PERSISTENCE_LOCK_NAME,
        () => commitImport(prepared)
      );
    } catch (error) {
      alert(`Import failed: ${error.message}`);
      return;
    }

    let refreshError = null;
    try { await renderHistory(); } catch (error) { refreshError = error; }
    const imported = `${importedCount} workout${importedCount === 1 ? '' : 's'}`;
    if (refreshError) {
      alert(`Imported ${imported}, but history could not refresh: ${refreshError.message}. Reload the page to update the list.`);
    } else {
      alert(`Imported ${imported}.`);
    }
  } finally {
    releasePersistenceLock();
    event.target.value = '';
  }
}

function showLoadError(error) {
  console.error(error);
  const notice = document.createElement('p');
  notice.className = 'notice danger';
  notice.textContent = `App failed to load: ${error.message}`;
  document.body.prepend(notice);
}

async function init() {
  const response = await fetch('data/workouts.json');
  if (!response.ok) throw new Error(`Workout data request failed (${response.status}).`);
  data = await response.json();
  renderLevels();
  restoreSelection();
  renderWorkout();
  await renderHistory();
}

if (typeof document !== 'undefined') {
  $('#loadWorkout').addEventListener('click', renderWorkout);
  $('#program').addEventListener('change', renderWorkout);
  $('#level').addEventListener('change', renderWorkout);
  $('#day').addEventListener('change', renderWorkout);
  $('#startPause').addEventListener('click', startPause);
  $('#reset').addEventListener('click', renderWorkout);
  $('#finish').addEventListener('click', finish);
  $('#exportData').addEventListener('click', exportHistory);
  $('#importData').addEventListener('change', importHistory);
  setupAppViewNavigation();
  init().catch(showLoadError);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { setActiveAppView };
