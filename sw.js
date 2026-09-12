/* =============================================================
   sw.js — 离线缓存
   策略：HTML / CSS / JS 走「网络优先，失败回落缓存」——
         这样发新版后老访客立刻拿到新代码，断网时仍能打开；
         图片 / 图标走「缓存优先」——这些几乎不变，省流量。

   注意：不要用「缓存优先」服务 HTML/JS。那样每次发版都必须手动 +1 版本号，
         一旦忘记，老访客会一直拿到旧文件，且现象极难定位（改了代码没生效）。
         网络优先把这个人为步骤彻底去掉。
   ============================================================= */
var CACHE = 'eu26-v3';
var ASSETS = [
  './',
  './index.html',
  './app.js',
  './ledger.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

/* 二进制与图标：内容基本不变，适合缓存优先 */
var CACHE_FIRST = /\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/i;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .catch(function () { /* 单个资源失败不应阻断安装 */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function put(url, res) {
  var copy = res.clone();
  caches.open(CACHE).then(function (c) { c.put(url, copy); }).catch(function () { /* 忽略 */ });
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* 缓存优先：图标等静态二进制 */
  if (CACHE_FIRST.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.status === 200) put(req, res);
          return res;
        }).catch(function () { return caches.match('./icon.svg'); });
      })
    );
    return;
  }

  /* 网络优先：HTML / CSS / JS，保证新版立刻生效 */
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200) put(req, res);
        return res;
      })
      .catch(function () {
        /* 断网：页面请求回落 index.html，资源请求回落同名缓存 */
        if (req.mode === 'navigate') {
          return caches.match('./index.html').then(function (hit) {
            return hit || caches.match('./');
          });
        }
        return caches.match(req).then(function (hit) {
          return hit || new Response('', { status: 504, statusText: 'offline' });
        });
      })
  );
});
