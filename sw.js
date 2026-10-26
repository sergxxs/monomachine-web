// Monomachine Web one-file rescue worker.
//
// This file is intentionally different from the multi-file project's sw.js.
// The one-file index.html does not register a service worker. This script only
// exists at the old /sw.js URL so an already-installed V5.1/V5.2 worker can
// update to it, delete its stale Monomachine caches and stop controlling the
// site. It never caches the app itself.
const VERSION = 'mono-web-v5.5.1-onefile-rescue';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('mono-web-')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister ? self.registration.unregister() : false)
      .catch(() => {})
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // While this rescue worker is still the active worker, always use network.
  // In particular, never substitute index.html for a failed JS/CSS request.
  e.respondWith(fetch(e.request).catch(() => Response.error()));
});
