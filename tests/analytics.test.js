const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pagePaths = {
  'index.html': '/',
  'exercises.html': '/exercises.html',
  'app.html': '/app.html',
  'nutrition.html': '/nutrition.html',
  'community.html': '/community.html',
  'faq.html': '/faq.html',
  '404.html': '/404.html'
};
const analyticsPath = path.join(root, 'analytics.js');
const analyticsSource = fs.existsSync(analyticsPath) ? fs.readFileSync(analyticsPath, 'utf8') : '';

test('every public page loads one repository-controlled analytics script with a fixed path', () => {
  for (const [page, analyticsPath] of Object.entries(pagePaths)) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const tags = html.match(/<script[^>]+data-analytics-path=[^>]+><\/script>/g) || [];
    assert.deepEqual(tags, [
      `<script defer src="analytics.js?v=goatcounter-1" data-analytics-path="${analyticsPath}"></script>`
    ], page);
    assert.doesNotMatch(html, /<script[^>]+(?:data-goatcounter|src="https?:\/\/[^"]*(?:goatcounter|gc\.zgo\.at))/i, page);
  }
});

test('analytics beacon sends only the fixed page label with privacy-restricting request options', async () => {
  let request;
  const context = {
    document: {
      currentScript: { dataset: { analyticsPath: '/app.html' } }
    },
    fetch(url, options) { request = { url, options }; return Promise.resolve(); },
    URLSearchParams,
    Math,
    Promise
  };
  vm.runInNewContext(analyticsSource, context);
  await Promise.resolve();
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://simplefit.goatcounter.com/count');
  assert.equal(url.searchParams.get('p'), '/app.html');
  assert.equal(url.searchParams.get('ns'), '1');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['ns', 'p', 'rnd']);
  assert.equal(request.options.mode, 'no-cors');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.keepalive, true);
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.deepEqual(Object.keys(request.options).sort(), ['cache', 'credentials', 'keepalive', 'mode', 'referrerPolicy']);
  assert.equal('body' in request.options, false);
  assert.equal('headers' in request.options, false);
});

test('failed or unavailable fetch does not fall back to a credentialed request channel', async () => {
  let calls = 0;
  const rejected = {
    document: { currentScript: { dataset: { analyticsPath: '/app.html' } } },
    fetch() { calls += 1; return Promise.reject(new Error('blocked')); },
    URLSearchParams,
    Math,
    Promise
  };
  vm.runInNewContext(analyticsSource, rejected);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);

  const unavailable = {
    document: { currentScript: { dataset: { analyticsPath: '/app.html' } } },
    URLSearchParams,
    Math,
    Promise
  };
  assert.doesNotThrow(() => vm.runInNewContext(analyticsSource, unavailable));
});

test('analytics source cannot inspect app state or derive sensitive page metadata', () => {
  assert.doesNotMatch(analyticsSource, /indexedDB|localStorage|sessionStorage|document\.cookie|location\.|document\.title|document\.referrer|document\.createElement|screen\.|querySelector|getElementById/i);
  assert.doesNotMatch(analyticsSource, /history|notes|score|timer|workout|backup/i);
  assert.doesNotMatch(analyticsSource, /\bImage\b|XMLHttpRequest|sendBeacon|document\.createElement|WebSocket/i);
});

test('service worker precaches the versioned local analytics script', () => {
  const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /'analytics\.js\?v=goatcounter-1'/);
});

test('FAQ accurately discloses limited GoatCounter processing and local workout-data boundaries', () => {
  const html = fs.readFileSync(path.join(root, 'faq.html'), 'utf8');
  assert.match(html, /GoatCounter/);
  assert.match(html, /fixed page label/i);
  assert.match(html, /standard connection data/i);
  assert.match(html, /does not use analytics cookies/i);
  assert.match(html, /does not send URL query parameters or referrers/i);
  assert.match(html, /no third-party analytics JavaScript/i);
  for (const privateData of ['workout history', 'notes', 'scores', 'timer', 'backup']) {
    assert.match(html, new RegExp(privateData, 'i'));
  }
  assert.match(html, /remain on your device/i);
});
