// service-worker.js
const CACHE_NAME = 'runtracker-cache-v5';  // ← bump this on each release
const urlsToCache = [
  'index.html',
  'login.html',
  'history.html',
  'stats.html',
  'manifest.json',
  'app.js',
  'styles.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'https://unpkg.com/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // only handle GET requests for same-origin resources
  if (event.request.method !== 'GET' ||
      new URL(event.request.url).origin !== location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkRes => {
        // clone the response before it's consumed
        const responseClone = networkRes.clone();
        // update cache in the background and keep the SW alive
        event.waitUntil(
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, responseClone))
        );
        // return the original network response to the page
        return networkRes;
      })
      .catch(() => {
        // on failure, try to serve from cache
        return caches.match(event.request);
      })
  );
});
