// J.AI.N Brain PWA — Service Worker
// Version is auto-bumped by push_github.py on every deploy
var CACHE_VERSION = 'jain-brain-v20260320011753';
var CACHE_NAME = CACHE_VERSION;

var PRECACHE_URLS = [
  '/jains-mind/brain.html',
  '/jains-mind/openclaw-icon.png',
  '/jains-mind/manifest.json'
];

// Paths that should always be fetched fresh from network (never cached)
var NETWORK_FIRST_PATTERNS = [
  'index.html',
  'widget.html',
  '/',
  '/jains-mind/',
  '/jains-mind/index.html',
  'brain.html',
  'state.json',
  '/cron-status',
  '/task-queue'
];

function isNetworkFirst(url) {
  for (var i = 0; i < NETWORK_FIRST_PATTERNS.length; i++) {
    if (url.includes(NETWORK_FIRST_PATTERNS[i])) return true;
  }
  return false;
}

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
  var url = event.request.url;

  // Network-first for HTML, API endpoints, and state files (always fresh)
  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        // Only cache successful HTML responses for brain.html offline fallback
        if (url.includes('brain.html') && response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback: serve cached brain.html if available
        if (url.includes('brain.html')) {
          return caches.match(event.request);
        }
        return new Response('Offline', { status: 503 });
      })
    );
  } else {
    // Cache-first for static assets (icons, fonts, images)
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request);
      })
    );
  }
});
