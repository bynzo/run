// service-worker.js
const CACHE_NAME = 'runtracker-cache-v6';  // bumped on each release
const urlsToCache = [
  'index.html',
  'history.html',
  'stats.html',
  'settings.html',      // new settings page
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
  // immediately activate this version
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // remove any old caches
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
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
        // update cache in background
        const clone = networkRes.clone();
        event.waitUntil(
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        );
        return networkRes;
      })
      .catch(() => {
        // on failure, serve from cache if available
        return caches.match(event.request);
      })
  );
});
