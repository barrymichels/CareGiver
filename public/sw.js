const CACHE_NAME = 'caregiver-v1';
const STATIC_ASSETS = [
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/screenshots/mobile-dashboard.png',
    '/screenshots/mobile-schedule.png',
    '/screenshots/desktop-dashboard.png',
    '/css/style.css',
    '/css/header.css',
    '/css/dashboard.css',
    '/css/admin.css',
    '/css/profile.css',
    '/js/dashboard.js',
    '/js/header.js',
    '/js/availability.js',
    '/js/admin.js',
    '/js/profile.js',
    '/js/pwa.js'
];

// Install service worker and cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Fetch event handler with different strategies for different routes
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    
    // Network-first strategy for dynamic routes (API calls and HTML pages)
    if (url.pathname === '/' || url.pathname.startsWith('/api/') || !STATIC_ASSETS.includes(url.pathname)) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache the response for offline support
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // If network fails, try to serve from cache
                    return caches.match(event.request)
                        .then(cachedResponse => {
                            if (cachedResponse) {
                                return cachedResponse;
                            }
                            // If no cache, serve the root page for navigation requests
                            if (event.request.mode === 'navigate') {
                                return caches.match('/');
                            }
                            return new Response('Network error', { status: 408 });
                        });
                })
        );
    } 
    // Cache-first strategy for static assets
    else {
        event.respondWith(
            caches.match(event.request)
                .then(response => response || fetch(event.request))
        );
    }
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            })
        ))
    );
    self.clients.claim();
});