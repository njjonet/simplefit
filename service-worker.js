const CACHE_PREFIX = 'simplefit-';
const CACHE = 'simplefit-v11';
const OFFLINE_PAGE = './';
const ASSETS = [
  './',
  'index.html',
  'exercises.html',
  'app.html',
  'nutrition.html',
  'community.html',
  'faq.html',
  'styles.css?v=hamburger-1',
  'styles.css?v=workout-tables-1',
  'app.css?v=app-shell-1',
  'site.js?v=hamburger-1',
  'analytics.js?v=goatcounter-1',
  'app-core.js?v=app-shell-1',
  'timer-core.js?v=repair-1',
  'app.js?v=app-shell-1',
  'backup.js?v=repair-1',
  'vendor/fflate.min.js?v=repair-1',
  'data/workouts.json',
  'manifest.webmanifest?v=app-shell-1',
  'icons/icon.svg'
];
const PRECACHE_URLS = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function navigationResponse(request) {
  try {
    return await fetch(request);
  } catch (_) {
    const cache = await caches.open(CACHE);
    return (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match(OFFLINE_PAGE));
  }
}

async function assetResponse(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.warn('SimpleFit cache update failed; using the network response.', error);
    }
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (PRECACHE_URLS.has(url.href)) {
    event.respondWith(assetResponse(request));
    return;
  }

  event.respondWith(fetch(request));
});
