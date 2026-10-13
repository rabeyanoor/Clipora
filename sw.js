// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = 'clipora-v5';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/state.js', './js/engine.js', './js/commands.js', './js/time.js',
  './js/analysis.js', './js/storage.js', './js/i18n.js', './js/transcribe.js', './js/scenes.js', './js/storyboard.js', './js/gfx.js', './js/sfx.js', './js/ai.js', './js/fastexport.js', './js/cloud.js', './js/movie.js', './js/studio.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network first (so updates arrive), cache as offline fallback.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
