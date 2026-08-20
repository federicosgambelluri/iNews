/* Service worker minimo: guscio dell'app offline, feed sempre dalla rete. */
const CACHE = 'inews-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/icons/icon.svg',
  './assets/js/app.js',
  './assets/js/config.js',
  './assets/js/feeds.js',
  './assets/js/filter.js',
  './assets/js/reader.js',
  './assets/js/settings.js',
  './assets/js/storage.js',
  './assets/js/ui.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  /*
   * Prima la rete, la cache come rete di salvataggio.
   * Per un lettore di notizie è la scelta giusta due volte: le notizie sono
   * sempre fresche, e una versione aggiornata dell'app arriva subito invece
   * che al secondo ricaricamento. Offline, tutto viene dalla cache.
   */
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && new URL(request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
