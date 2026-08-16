const test = require('node:test');
const assert = require('node:assert/strict');
const { addStoreRecord, finishControlState, getOptionalStorage, loadSelection, normalizeSelection, persistThenRefresh, renderHistory, replaceStoreRecords, replaceStoreRecordsIfUnchanged, saveSelection, setTextIfChanged, sortLogsNewestFirst, withCrossContextLock } = require('../app-core.js');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.textContent = '';
    this.className = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

const fakeDocument = { createElement: tagName => new FakeElement(tagName) };


test('text updates mutate an element only when the value changes', () => {
  let value = 'Workout in progress';
  let setterCalls = 0;
  const element = {
    get textContent() { return value; },
    set textContent(nextValue) { setterCalls += 1; value = nextValue; }
  };

  setTextIfChanged(element, 'Workout in progress');
  setTextIfChanged(element, 'Workout paused');
  setTextIfChanged(element, 'Workout paused');

  assert.equal(value, 'Workout paused');
  assert.equal(setterCalls, 1);
});

function allElements(element) {
  return [element, ...element.children.flatMap(child => child instanceof FakeElement ? allElements(child) : [])];
}

function allText(element) {
  return allElements(element).map(node => node.textContent).join(' ');
}

test('history rendering treats imported fields as text, not markup', () => {
  const container = new FakeElement('div');
  const payload = '<img src=x onerror="globalThis.pwned=1">';
  renderHistory(container, [{
    id: 'one',
    createdAt: '2026-08-09T00:00:00.000Z',
    title: payload,
    score: '',
    roundsCompleted: 0,
    notes: payload
  }], fakeDocument, () => '9 Aug 2026');

  assert.match(allText(container), /<img src=x onerror=/);
  assert.equal(allElements(container).some(node => node.tagName === 'IMG'), false);
});

test('empty history renders a text-only empty state', () => {
  const container = new FakeElement('div');
  renderHistory(container, [], fakeDocument);
  assert.match(allText(container), /No workouts saved yet/);
});

test('record replacement aborts the transaction on a synchronous write failure', async () => {
  let aborted = false;
  const store = {
    clear() {},
    put() { throw new Error('bad key'); }
  };
  const transaction = {
    objectStore: () => store,
    abort() { aborted = true; queueMicrotask(() => this.onabort?.()); }
  };
  const db = { transaction: () => transaction };

  await assert.rejects(replaceStoreRecords(db, 'logs', [{ createdAt: 'bad' }]), /bad key/);
  assert.equal(aborted, true);
});


test('browser routes every timer status update through change-aware text writes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

  assert.doesNotMatch(app, /\$\('#timerStatus'\)\.textContent\s*=/);
  assert.match(app, /SimpleFitCore\.setTextIfChanged\(\$\('#timerStatus'\),/);
});


test('browser app integrates safe history and timer cores without HTML injection sinks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(html, /app-core\.js/);
  assert.match(html, /timer-core\.js/);
  assert.match(app, /SimpleFitCore\.renderHistory/);
  assert.match(app, /SimpleFitCore\.persistThenRefresh/);
  assert.match(app, /SimpleFitTimer\.pauseTimer/);
  assert.match(html, /id="score"[^>]*maxlength="10000"/);
  assert.match(html, /id="notes"[^>]*maxlength="10000"/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML/);
});


test('selection normalization preserves the legacy $level preference key', () => {
  assert.deepEqual(normalizeSelection({ program: 'beginner', $level: '4', day: '2' }), {
    program: 'beginner', level: '4', day: '2'
  });
});


test('persistence failure rejects before refresh runs', async () => {
  let refreshed = false;
  await assert.rejects(
    persistThenRefresh(async () => { throw new Error('database failed'); }, async () => { refreshed = true; }),
    /database failed/
  );
  assert.equal(refreshed, false);
});

test('refresh failure is reported separately after persistence commits', async () => {
  let committed = false;
  const result = await persistThenRefresh(
    async () => { committed = true; },
    async () => { throw new Error('render failed'); }
  );
  assert.equal(committed, true);
  assert.match(result.refreshError.message, /render failed/);
});


test('save failure after countdown expiry keeps completed timer controls inert', () => {
  assert.deepEqual(finishControlState('completed', true), {
    startLabel: 'Done',
    startDisabled: true,
    statusText: 'Save failed · workout complete'
  });
});


test('history sorting uses timestamp chronology rather than lexical order', () => {
  const earlier = { id: 'earlier', createdAt: '2026-01-01T00:30:00+01:00' };
  const later = { id: 'later', createdAt: '2025-12-31T23:45:00Z' };
  assert.deepEqual(sortLogsNewestFirst([earlier, later]).map(log => log.id), ['later', 'earlier']);
});

test('browser import rejects oversized files before reading arrayBuffer', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const sizeCheck = app.indexOf('file.size > SimpleFitBackup.MAX_BACKUP_FILE_BYTES');
  const read = app.indexOf('file.arrayBuffer()');
  assert.ok(sizeCheck >= 0 && sizeCheck < read);
});


test('selection persistence failures are non-fatal', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.deepEqual(loadSelection(blocked), {});
  assert.equal(saveSelection(blocked, { program: 'tabata' }), false);
});


test('browser app locks workout mutation controls while a save is pending', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(app, /let persistenceInProgress = false/);
  assert.match(app, /function acquirePersistenceLock/);
  for (const id of ['program', 'level', 'day', 'loadWorkout', 'startPause', 'finish', 'reset', 'rounds', 'score', 'notes', 'importData']) {
    assert.match(app, new RegExp(`['"]#${id}['"]`));
  }
  assert.match(app, /if \(persistenceInProgress\) return;/);
  assert.ok(app.indexOf('acquirePersistenceLock()') < app.indexOf('SimpleFitCore.persistThenRefresh'));
});


test('optional storage property access failures are non-fatal', () => {
  const root = {};
  Object.defineProperty(root, 'localStorage', { get() { throw new Error('denied'); } });
  assert.equal(getOptionalStorage(root), null);
});


test('browser import acquires the shared persistence lock before reading data', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const importStart = app.indexOf('async function importHistory');
  const importBody = app.slice(importStart);
  assert.match(app, /let persistenceInProgress = false/);
  assert.match(app, /function acquirePersistenceLock/);
  assert.match(app, /function releasePersistenceLock/);
  assert.ok(importBody.indexOf('acquirePersistenceLock()') < importBody.indexOf('withCrossContextLock'));
  assert.match(importBody, /finally \{[\s\S]*releasePersistenceLock\(\)/);
});


test('history rendering is bounded while retaining a total-count notice', () => {
  const container = new FakeElement('div');
  const logs = Array.from({ length: 501 }, (_, index) => ({
    id: String(index),
    createdAt: '2026-08-09T00:00:00.000Z',
    title: `Workout ${index}`,
    score: '',
    roundsCompleted: 0,
    notes: ''
  }));
  renderHistory(container, logs, fakeDocument, () => '9 Aug 2026');
  assert.equal(container.children.filter(child => child.className === 'history-item').length, 500);
  assert.match(allText(container), /latest 500 of 501/i);
});

test('browser save validates the complete future history before insertion', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(app, /SimpleFitCore\.addStoreRecord/);
});


test('record insertion validates the complete store atomically before put', async () => {
  let putCalled = false;
  let aborted = false;
  const request = { result: [{ id: 'existing' }] };
  const store = {
    getAll() { queueMicrotask(() => request.onsuccess?.()); return request; },
    put() { putCalled = true; }
  };
  const transaction = {
    objectStore: () => store,
    abort() { aborted = true; queueMicrotask(() => this.onabort?.()); }
  };
  const db = { transaction: () => transaction };
  await assert.rejects(
    addStoreRecord(db, 'logs', { id: 'new' }, () => { throw new Error('history limit'); }),
    /history limit/
  );
  assert.equal(putCalled, false);
  assert.equal(aborted, true);
});


test('conditional replacement aborts if another context changed history', async () => {
  let clearCalled = false;
  let aborted = false;
  const request = { result: [{ id: 'concurrent', createdAt: '2026-01-01T00:00:00.000Z' }] };
  const store = {
    getAll() { queueMicrotask(() => request.onsuccess?.()); return request; },
    clear() { clearCalled = true; },
    put() {}
  };
  const transaction = {
    objectStore: () => store,
    abort() { aborted = true; queueMicrotask(() => this.onabort?.()); }
  };
  const db = { transaction: () => transaction };
  await assert.rejects(
    replaceStoreRecordsIfUnchanged(db, 'logs', [{ id: 'old' }], [{ id: 'imported' }]),
    /changed in another/i
  );
  assert.equal(clearCalled, false);
  assert.equal(aborted, true);
});

test('cross-context persistence helper uses Web Locks when available', async () => {
  let requested;
  const root = { navigator: { locks: { request(name, options, operation) {
    requested = { name, options };
    return operation();
  } } } };
  const value = await withCrossContextLock(root, 'simplefit-history', async () => 42);
  assert.equal(value, 42);
  assert.deepEqual(requested, { name: 'simplefit-history', options: { mode: 'exclusive' } });
});

test('lock release reconciles completed and saved timer controls', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(app, /timerState\?\.status === 'completed'.*workoutSaved/s);
  assert.match(app, /withCrossContextLock/);
});


test('import replacement validates exact future exportability before mutation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = app.indexOf('async function replaceLogs');
  const body = app.slice(start, app.indexOf('function formatMilliseconds', start));
  assert.match(body, /validateExportableLogs\(logs\)/);
});


test('import confirmation occurs before requesting the cross-context lock', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = app.indexOf('async function importHistory');
  const body = app.slice(start, app.indexOf('function showLoadError', start));
  const prepare = body.indexOf('const prepared = await prepareImport(file)');
  const lock = body.indexOf('withCrossContextLock');
  assert.ok(prepare >= 0 && lock >= 0 && prepare < lock);
});


test('import Web Lock callback excludes UI refresh and modal dialogs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = app.indexOf('async function commitImport');
  const body = app.slice(start, app.indexOf('async function importHistory', start));
  assert.doesNotMatch(body, /alert\(|renderHistory/);
});

test('conditional replacement uses locale-independent total ID ordering', async () => {
  const composed = { id: '\u00e9', value: 1 };
  const decomposed = { id: 'e\u0301', value: 2 };
  let request;
  const transaction = {
    error: null,
    abort() { queueMicrotask(() => this.onabort?.()); },
    objectStore() {
      return {
        getAll() {
          request = { result: [decomposed, composed], error: null };
          queueMicrotask(() => {
            request.onsuccess?.();
            queueMicrotask(() => transaction.oncomplete?.());
          });
          return request;
        },
        clear() {},
        put() {}
      };
    }
  };
  const db = { transaction() { return transaction; } };
  await replaceStoreRecordsIfUnchanged(db, 'logs', [composed, decomposed], [composed]);
});
