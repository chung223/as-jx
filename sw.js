const CACHE = 'miles-toolbox-v3';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// network-first：確保更新即時，離線時退回快取。
// 只攔同源請求——外部 API 與瀏覽器擴充功能（chrome-extension: 等）交給瀏覽器原生處理。
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let u;
  try { u = new URL(e.request.url); } catch { return; }
  if (u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return r;
    }).catch(() =>
      caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
