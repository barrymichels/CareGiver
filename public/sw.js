const CACHE_NAME = 'caregiver-v2';
const STATIC_ASSETS = [
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/css/style.css',
    '/css/header.css',
    '/css/dashboard.css',
    '/js/dashboard.js',
    '/js/header.js',
    '/js/availability.js'
];

// Install service worker and cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // Cache assets one by one to handle missing files
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err => {
                            console.warn(`Failed to cache ${url}:`, err);
                        })
                    )
                );
            })
    );
    self.skipWaiting();
});

// Fetch event handler with different strategies for different routes
self.addEventListener('fetch', event => {
    // Skip non-GET requests and unsupported schemes
    if (event.request.method !== 'GET' ||
        !event.request.url.startsWith('http')) return;

    const url = new URL(event.request.url);

    // Network-first strategy for dynamic routes (API calls and HTML pages)
    if (url.pathname === '/' || url.pathname.startsWith('/api/') || !STATIC_ASSETS.includes(url.pathname)) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Only cache successful responses with supported schemes
                    if (response.ok && url.protocol.startsWith('http')) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
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

// Push notification event handler
self.addEventListener('push', event => {
    console.log('Push event received:', event);

    let notificationData = {};
    
    if (event.data) {
        try {
            notificationData = event.data.json();
        } catch (error) {
            console.error('Error parsing push notification data:', error);
            notificationData = {
                title: 'WayneScheduler',
                body: 'You have a new notification',
                icon: '/icons/icon-192x192.png'
            };
        }
    } else {
        notificationData = {
            title: 'WayneScheduler',
            body: 'You have a new notification',
            icon: '/icons/icon-192x192.png'
        };
    }

    const options = {
        body: notificationData.body,
        icon: notificationData.icon || '/icons/icon-192x192.png',
        badge: notificationData.badge || '/icons/icon-192x192.png',
        data: notificationData.data || {},
        actions: notificationData.actions || [],
        requireInteraction: true, // Keep notification visible until user interacts
        silent: false,
        tag: notificationData.data?.type || 'general'
    };

    event.waitUntil(
        self.registration.showNotification(notificationData.title, options)
    );
});

// Notification click event handler
self.addEventListener('notificationclick', event => {
    console.log('Notification clicked:', event);

    const notification = event.notification;
    const action = event.action;
    const data = notification.data || {};

    // Close the notification
    notification.close();

    let targetUrl = '/dashboard'; // Default URL

    // Handle different notification types
    if (data.url) {
        targetUrl = data.url;
    } else if (data.type === 'shift_reminder') {
        targetUrl = '/dashboard';
    } else if (data.type === 'morning_summary') {
        targetUrl = '/dashboard';
    }

    // Handle notification actions
    if (action === 'view') {
        targetUrl = data.url || '/dashboard';
    }

    // Focus on existing window or open new one
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(clientList => {
            // Check if there's already a window open to the target URL
            for (const client of clientList) {
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }

            // Check if there's any window open to the app
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    return client.navigate(targetUrl).then(() => client.focus());
                }
            }

            // No suitable window found, open a new one
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// Background sync for offline notification handling (optional enhancement)
self.addEventListener('sync', event => {
    if (event.tag === 'notification-sync') {
        event.waitUntil(
            // Handle any queued notifications when back online
            handleOfflineNotifications()
        );
    }
});

async function handleOfflineNotifications() {
    // This could be enhanced to handle notifications that were queued while offline
    console.log('Handling offline notifications...');
}