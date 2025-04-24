// service‑worker.js
const CACHE_NAME = 'runtracker-cache-v4';  // ← bump this on each release
const urlsToCache = [
  'index.html',
  'history.html',
  'stats.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'https://unpkg.com/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
  // immediately activate new SW
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // claim clients right away
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // only handle GETs from our origin
  if (event.request.method !== 'GET' ||
      new URL(event.request.url).origin !== location.origin) {
    return;
  }

  event.respondWith(
    // try network first...
    fetch(event.request)
      .then(networkRes => {
        // update cache in background
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkRes.clone());
        });
        return networkRes;
      })
      .catch(() => {
        // fallback to cache
        return caches.match(event.request);
      })
  );
});
