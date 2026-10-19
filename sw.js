// Monomachine Web — offline shell cache (bump VERSION on each release)
const VERSION = 'mono-web-v5.3.1';
const ASSETS = [
  './', 'index.html', 'update-v53.html', 'style.css',
  'js/state.js', 'js/sysex.js', 'js/audio.js', 'js/ui.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', e => {
  // Do not let one missing optional asset keep the old cache-first worker
  // alive: cache what is actually deployed, then activate immediately.
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('mono-web-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const dest = e.request.destination || '';
  const isCode = e.request.mode === 'navigate' || dest === 'document' || dest === 'script' || dest === 'style' || dest === 'manifest';

  if (isCode) {
    // Network-first for HTML/CSS/JS. Crucially, a failed script request must
    // fall back only to that same script — never to index.html (HTML parsed as
    // JS is one way to get a static, dead panel).
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: false }).then(hit => {
        if (hit) return hit;
        if (e.request.mode === 'navigate' || dest === 'document') return caches.match('index.html');
        return Response.error();
      }))
    );
    return;
  }

  // Images/icons: cache-first, refresh in the background.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const refresh = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || Response.error());
      return hit || refresh;
    })
  );
});
