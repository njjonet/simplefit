const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8');

function loadWorker(fetchImpl = async () => new Response('ok'), putImpl = async () => {}) {
  const listeners = {};
  const deleted = [];
  const puts = [];
  const added = [];
  const cache = {
    async addAll(assets) { added.push(...assets); },
    async match(request) {
      const url = typeof request === 'string' ? request : request.url;
      if (url === './' || url.endsWith('/simplefit/')) return new Response('<html>offline</html>', { headers: { 'content-type': 'text/html' } });
      return undefined;
    },
    async put(request, response) { puts.push({ request, response }); await putImpl(request, response); }
  };
  const caches = {
    async open() { return cache; },
    async keys() { return ['simplefit-v5', 'simplefit-v7', 'simplefit-v8', 'simplefit-v9', 'simplefit-v10', 'unrelated-project-cache']; },
    async delete(key) { deleted.push(key); return true; },
    async match(request) { return cache.match(request); }
  };
  const self = {
    location: { origin: 'https://njjonet.github.io', href: 'https://njjonet.github.io/simplefit/service-worker.js' },
    registration: { scope: 'https://njjonet.github.io/simplefit/' },
    clients: { async claim() {} },
    skipWaiting() {},
    addEventListener(type, handler) { listeners[type] = handler; }
  };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Response, Promise, Set, console });
  return { listeners, deleted, puts, added };
}

async function dispatch(handler, event = {}) {
  let work;
  let response;
  handler({
    ...event,
    waitUntil(promise) { work = promise; },
    respondWith(promise) { response = promise; }
  });
  if (work) await work;
  return response;
}

test('service-worker activation deletes only old SimpleFit caches', async () => {
  const worker = loadWorker();
  await dispatch(worker.listeners.activate);
  assert.deepEqual(worker.deleted, ['simplefit-v5', 'simplefit-v7', 'simplefit-v8', 'simplefit-v9']);
});

test('latest site assets ship in the v10 cache', () => {
  assert.match(source, /const CACHE = 'simplefit-v10'/);
});

test('precache uses the exact versioned assets referenced by HTML', async () => {
  const worker = loadWorker();
  await dispatch(worker.listeners.install);
  assert.ok(worker.added.includes('styles.css?v=hamburger-1'));
  assert.ok(worker.added.includes('styles.css?v=workout-tables-1'));
  assert.ok(worker.added.includes('app.css?v=app-shell-1'));
  assert.ok(worker.added.includes('site.js?v=hamburger-1'));
  assert.ok(worker.added.includes('timer-core.js?v=repair-1'));
});

test('app shell and current precache request the app-core version required by app.js', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');
  const worker = loadWorker();
  await dispatch(worker.listeners.install);

  assert.match(html, /src="app-core\.js\?v=app-shell-1"/);
  assert.ok(worker.added.includes('app-core.js?v=app-shell-1'));
  assert.doesNotMatch(html, /app-core\.js\?v=repair-1/);
  assert.ok(!worker.added.includes('app-core.js?v=repair-1'));
});

test('app shell and current precache request matching versioned manifest metadata', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');
  const worker = loadWorker();
  await dispatch(worker.listeners.install);

  assert.match(html, /rel="manifest" href="manifest\.webmanifest\?v=app-shell-1"/);
  assert.ok(worker.added.includes('manifest.webmanifest?v=app-shell-1'));
  assert.doesNotMatch(html, /href="manifest\.webmanifest"/);
  assert.ok(!worker.added.includes('manifest.webmanifest'));
});

test('404 asset responses are not written to Cache Storage', async () => {
  const worker = loadWorker(async () => new Response('missing', {
    status: 404,
    headers: { 'content-type': 'text/html' }
  }));
  const responsePromise = await dispatch(worker.listeners.fetch, {
    request: { method: 'GET', mode: 'same-origin', url: 'https://njjonet.github.io/simplefit/app.js' }
  });
  const response = await responsePromise;
  assert.equal(response.status, 404);
  assert.equal(worker.puts.length, 0);
});

test('failed script requests do not receive the HTML navigation fallback', async () => {
  const worker = loadWorker(async () => { throw new Error('offline'); });
  const responsePromise = dispatch(worker.listeners.fetch, {
    request: { method: 'GET', mode: 'same-origin', url: 'https://njjonet.github.io/simplefit/unknown.js' }
  });
  await assert.rejects(responsePromise, /offline/);
});


test('cache write failure does not fail a successful asset response', async () => {
  const worker = loadWorker(
    async () => new Response('fresh asset', { status: 200 }),
    async () => { throw new Error('quota exceeded'); }
  );
  const responsePromise = await dispatch(worker.listeners.fetch, {
    request: { method: 'GET', mode: 'same-origin', url: 'https://njjonet.github.io/simplefit/app.js' }
  });
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'fresh asset');
});


test('stateful application scripts use matching content-versioned URLs', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');
  const worker = loadWorker();
  await dispatch(worker.listeners.install);
  for (const asset of ['app-core.js?v=app-shell-1', 'timer-core.js?v=repair-1', 'backup.js?v=repair-1', 'app.js?v=app-shell-1']) {
    assert.match(html, new RegExp(asset.replace(/[.]/g, '\\.').replace('?', '\\?')));
    assert.ok(worker.added.includes(asset));
  }
});
