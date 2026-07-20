'use strict';
/* Le Vieillard service worker — offline last-read pages.
   Network-first for pages (fresh news when online), falling back to the last
   cached copy when the connection drops (metered/patchy Malian networks). */

const CACHE = 'lv-v1';
const OFFLINE_PATHS = ['/', '/a/', '/brief', '/subscribe', '/worldcup'];

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // never cache the API

  const cacheable = OFFLINE_PATHS.some(p => url.pathname === p || url.pathname.startsWith('/a/'));
  if (!cacheable) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('/')))
  );
});
