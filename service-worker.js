const CACHE = 'simplefit-v3';
const ASSETS = ['./', 'index.html', 'exercises.html', 'app.html', 'nutrition.html', 'community.html', 'faq.html', 'styles.css', 'site.js', 'app.js', 'data/workouts.json', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return resp; }).catch(() => caches.match('./')))); });
