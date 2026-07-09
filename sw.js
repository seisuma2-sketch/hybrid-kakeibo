// ⚡ Service Worker (常にオンラインから最新を取得する設定)
self.addEventListener('install', (e) => {
  console.log('[Service Worker] インストール完了 (PWA Ready)');
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] アクティベート完了');
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // キャッシュせずに常にネットワークから最新のファイルを取得する
  e.respondWith(fetch(e.request));
});