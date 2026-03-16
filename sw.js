// J.AI.N Brain PWA — Service Worker
// Version is auto-bumped by push_github.py on every deploy
var CACHE_VERSION = 'jain-brain-v__BUILDTIME__';
var CACHE_NAME = CACHE_VERSION;

var PRECACHE_URLS = [
  '/jains-mind/brain.html',
  '/jains-mind/openclaw-icon.png',
  '/jains-mind/manifest.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Network-first for HTML (always fresh); cache-first for assets
  var url = event.request.url;
  var isHtml = url.includes('brain.html');
  
  if (isHtml) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request);
      })
    );
  }
});
