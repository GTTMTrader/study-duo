// 오프라인에서도 앱이 열리게 하는 서비스워커.
// 앱 파일은 '인터넷 먼저 → 안 되면 저장본', 글꼴·Firebase 라이브러리는 '저장본 먼저'.
// 앱을 고쳐서 다시 올릴 때 VERSION 숫자를 올리면 됨.
const VERSION = 'v1.0.8';
const CACHE = `studyduo-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './styles.css?v=1.0.8',
  './js/app.js?v=1.0.8',
  './js/config.js',
  './js/dates.js',
  './js/defaults.js',
  './js/device.js',
  './js/store-firebase.js',
  './js/store-demo.js',
  './manifest.webmanifest?v=3',
  './icons/app-icon-192.png',
  './icons/app-icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firestore/로그인 통신은 건드리지 않음
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('firebaseio.com')) return;

  const cacheFirst = url.hostname === 'www.gstatic.com' || url.hostname === 'cdn.jsdelivr.net';
  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
  }
});
