// Service worker: makes the app shell load instantly and work offline.
// Bump VERSION whenever shell files change so clients pick up the new build.
const VERSION = 'tm-v1.3.2';
const SHELL = [
  './',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/config.js',
  'js/speech.js',
  'js/store.js',
  'js/tureng.js',
  'js/wiktionary.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only the app's own static files are handled; dictionary/audio requests go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/proxy')) return;

  if (req.mode === 'navigate') {
    // Network first for the page so updates arrive quickly; cached shell when offline.
    // The shell is cached under './' (hosts may redirect /index.html -> /, and redirected responses can't serve navigations).
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
