// ⚡ Service Worker (安全版：通信の邪魔をしない)
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // 💡 Firebaseや外部APIの通信をサービスワーカーが邪魔しないようにする！
  // ここは空っぽでOK（普通にブラウザに通信を任せる）
});