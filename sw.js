// Service worker: app werkt offline met de laatst geladen gegevens.
const VERSIE = 'eo-v3';
const SCHIL = ['./', 'index.html', 'app.js', 'calc.js', 'standaard.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(SCHIL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSIE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Netwerk eerst (altijd de nieuwste app en gegevens), cache als terugval zonder internet.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const kopie = r.clone(); caches.open(VERSIE).then((c) => c.put(e.request.url.split('?')[0], kopie)); }
    return r;
  }).catch(() => caches.match(e.request.url.split('?')[0]).then((r) => r || caches.match('index.html'))));
});
