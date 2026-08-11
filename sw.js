/* 小账本 V0.1 - Service Worker */
/* 版本: 20260811-3 - Step 6 数据备份/导入 */

const CACHE_NAME = 'xiaozhangben-v04';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './db.js',
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
            console.log('删除旧缓存:', name);
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

// 拦截请求
self.addEventListener('fetch', function(event) {
  if (!event.request.url.startsWith(APP_SCOPE)) {
    return;
  }

  // 对 HTML 页面使用 Network First 策略（在线时优先用最新版）
  if (event.request.mode === 'navigate' ||
      event.request.url.endsWith('/') ||
      event.request.url.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 对静态资源（JS/CSS/图片）使用 Cache First 策略
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // 后台更新缓存
        fetch(event.request).then(function(networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            var clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
        }).catch(function() {});
        return cachedResponse;
      }

      return fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      }).catch(function() {
        return caches.match('./index.html');
      });
    })
  );
});