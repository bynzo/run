// service-worker.js
const CACHE_NAME = 'runtracker-cache-v5';  // ← bump this on each release
const urlsToCache = [
  'index.html',
  'login.html',           // new
  'history.html',
  'stats.html',
  'manifest.json',
  'app.js',               // new
  'styles.css',           // new
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
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' ||
      new URL(event.request.url).origin !== location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkRes => {
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkRes.clone());
        });
        return networkRes;
      })
      .catch(() => caches.match(event.request))
  );
});
