/* 小账本 V0.1 - Service Worker */

const CACHE_NAME = 'xiaozhangben-v01';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 安装：预缓存核心文件
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// 动态计算当前 SW 所在目录作为应用范围
const APP_SCOPE = (function() {
  const url = new URL('./', self.location.href);
  return url.href;
})();

// 拦截请求：优先从缓存返回，同时后台更新
self.addEventListener('fetch', function(event) {
  if (event.request.url.startsWith(APP_SCOPE)) {
    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        if (cachedResponse) {
          const fetchPromise = fetch(event.request).then(function(networkResponse) {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          }).catch(function() {
            return cachedResponse;
          });
          return cachedResponse;
        }

        return fetch(event.request).then(function(networkResponse) {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        }).catch(function() {
          return caches.match('./index.html');
        });
      })
    );
  }
});