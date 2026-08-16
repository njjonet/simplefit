(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimpleFitCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function setTextIfChanged(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function sortLogsNewestFirst(logs) {
    return [...logs].sort((a, b) => {
      const aTime = Date.parse(a.createdAt);
      const bTime = Date.parse(b.createdAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }

  function normalizeSelection(selection = {}) {
    return {
      program: selection.program,
      level: selection.level ?? selection.$level,
      day: selection.day
    };
  }

  function finishControlState(timerStatus, saveFailed = false) {
    if (timerStatus === 'completed') {
      return {
        startLabel: 'Done',
        startDisabled: true,
        statusText: saveFailed ? 'Save failed · workout complete' : 'Workout complete'
      };
    }
    return {
      startLabel: timerStatus === 'idle' ? 'Start' : 'Resume',
      startDisabled: false,
      statusText: saveFailed ? 'Save failed · workout paused' : 'Workout paused'
    };
  }

  function getOptionalStorage(root = globalThis) {
    try {
      return root.localStorage;
    } catch (_) {
      return null;
    }
  }

  function loadSelection(storage) {
    try {
      return normalizeSelection(JSON.parse(storage.getItem('simplefit.lastSelection') || '{}'));
    } catch (_) {
      try { storage.removeItem('simplefit.lastSelection'); } catch (_) { /* optional storage */ }
      return {};
    }
  }

  function saveSelection(storage, selection) {
    try {
      storage.setItem('simplefit.lastSelection', JSON.stringify(selection));
      return true;
    } catch (_) {
      return false;
    }
  }

  function historySummary(log) {
    const result = log.score || (log.roundsCompleted ? `${log.roundsCompleted} rounds` : 'completed');
    return log.notes ? `${result} · ${log.notes}` : result;
  }

  function renderHistory(container, logs, documentRef = document, formatDate) {
    const displayDate = formatDate || (value => new Date(value).toLocaleString());
    if (!logs.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No workouts saved yet.';
      container.replaceChildren(empty);
      return;
    }

    const visibleLogs = logs.slice(0, 500);
    const items = visibleLogs.map(log => {
      const item = documentRef.createElement('div');
      item.className = 'history-item';

      const date = documentRef.createElement('strong');
      date.textContent = displayDate(log.createdAt);

      const title = documentRef.createElement('div');
      title.textContent = log.title;

      const summary = documentRef.createElement('span');
      summary.className = 'muted';
      summary.textContent = historySummary(log);

      item.append(date, title, summary);
      return item;
    });
    if (logs.length > visibleLogs.length) {
      const notice = documentRef.createElement('p');
      notice.className = 'muted';
      notice.textContent = `Showing the latest ${visibleLogs.length} of ${logs.length} workouts. Export includes complete history.`;
      container.replaceChildren(notice, ...items);
    } else {
      container.replaceChildren(...items);
    }
  }

  async function persistThenRefresh(persist, refresh) {
    await persist();
    try {
      await refresh();
      return { refreshError: null };
    } catch (refreshError) {
      return { refreshError };
    }
  }

  function addStoreRecord(db, storeName, record, validateRecords) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      let validationError = null;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Workout save failed.'));
      transaction.onabort = () => reject(validationError || transaction.error || new Error('Workout save was aborted.'));

      const request = store.getAll();
      request.onerror = () => reject(request.error || new Error('Unable to inspect workout history.'));
      request.onsuccess = () => {
        try {
          const records = request.result.filter(existing => existing.id !== record.id);
          records.push(record);
          validateRecords(records);
          store.put(record);
        } catch (error) {
          validationError = error;
          try { transaction.abort(); } catch (_) { /* Transaction may already be inactive. */ }
          reject(error);
        }
      };
    });
  }

  function recordSetSignature(records) {
    return JSON.stringify([...records].sort((a, b) => {
      const left = String(a.id);
      const right = String(b.id);
      return left < right ? -1 : left > right ? 1 : 0;
    }));
  }

  function replaceStoreRecordsIfUnchanged(db, storeName, expectedRecords, records) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      let operationError = null;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('History replacement failed.'));
      transaction.onabort = () => reject(operationError || transaction.error || new Error('History replacement was aborted.'));

      const request = store.getAll();
      request.onerror = () => reject(request.error || new Error('Unable to inspect workout history.'));
      request.onsuccess = () => {
        try {
          if (recordSetSignature(request.result) !== recordSetSignature(expectedRecords)) {
            throw new Error('Workout history changed in another window; import was canceled.');
          }
          store.clear();
          for (const record of records) store.put(record);
        } catch (error) {
          operationError = error;
          try { transaction.abort(); } catch (_) { /* Transaction may already be inactive. */ }
          reject(error);
        }
      };
    });
  }

  function withCrossContextLock(root, name, operation) {
    let locks = null;
    try { locks = root.navigator?.locks; } catch (_) { /* Web Locks unavailable. */ }
    if (locks?.request) return locks.request(name, { mode: 'exclusive' }, operation);
    return operation();
  }

  function replaceStoreRecords(db, storeName, records) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      let synchronousError = null;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('History replacement failed.'));
      transaction.onabort = () => reject(synchronousError || transaction.error || new Error('History replacement was aborted.'));

      try {
        const store = transaction.objectStore(storeName);
        store.clear();
        for (const record of records) store.put(record);
      } catch (error) {
        synchronousError = error;
        try { transaction.abort(); } catch (_) { /* Transaction may already be inactive. */ }
        reject(error);
      }
    });
  }

  return { addStoreRecord, finishControlState, getOptionalStorage, loadSelection, normalizeSelection, historySummary, persistThenRefresh, renderHistory, replaceStoreRecords, replaceStoreRecordsIfUnchanged, saveSelection, setTextIfChanged, sortLogsNewestFirst, withCrossContextLock };
});
