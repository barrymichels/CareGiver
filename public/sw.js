const CACHE_NAME = 'caregiver-v1';
const ASSETS = [
    '/',
    '/css/style.css',
    '/css/header.css',
    '/css/dashboard.css',
    '/css/admin.css',
    '/css/profile.css',
    '/js/dashboard.js',
    '/js/header.js',
    '/js/availability.js',
    '/js/admin.js',
    '/js/profile.js'
];

// Install service worker and cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

// Serve cached content when offline
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});