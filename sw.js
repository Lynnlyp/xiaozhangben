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
      // 跳过等待，立即激活
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
      // 立即接管所有客户端
      return self.clients.claim();
    })
  );
});

// 动态计算当前 Service Worker 所在目录作为应用范围
const APP_SCOPE = (function() {
  const url = new URL('./', self.location.href);
  return url.href;
})();

// 拦截请求：优先从缓存返回，同时后台��新
self.addEventListener('fetch', function(event) {
  // 只处理属于本应用范围的请求
  if (event.request.url.startsWith(APP_SCOPE)) {
    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        if (cachedResponse) {
          // 有缓存：先返回缓存，同时后台更新
          const fetchPromise = fetch(event.request).then(function(networkResponse) {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          }).catch(function() {
            // 网络失败，返回缓存
            return cachedResponse;
          });
          return cachedResponse;
        }

        // 无缓存：从网络获取并缓存
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
          // 离线且无缓存，返回离线页面
          return caches.match('./index.html');
        });
      })
    );
  }
});