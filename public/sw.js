// Bumped from caregiver-v2 because that cache had already been used to store signed-in
// HTML and /api/ responses for every household on the device. The activate handler below
// deletes any cache not named exactly like this one, so the rename is what actually
// evicts the leaked data from tablets that ran the old version.
const CACHE_NAME = 'caregiver-v3';
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

// Everything we are willing to keep on the device. CacheStorage is shared by every
// person who opens this app in the same browser profile - the whole point is the
// shared family tablet - so anything beyond the unauthenticated precache below must
// go to the network or nowhere. A cached dashboard is another household member's
// schedule, names, and assignments.
const isPrecachedAsset = (pathname) => STATIC_ASSETS.includes(pathname);

// Telling the truth about being offline is not a failure state worth hiding: the
// page that used to land here was someone else's.
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title></head>
<body>
<h1>You are offline</h1>
<p>This page shows your family's schedule, so it is only ever served by the server -
never from this device. Reconnect and try again.</p>
</body>
</html>`;

const offlineResponse = (isNavigation) => new Response(
    isNavigation ? OFFLINE_HTML : 'Network unavailable. This page needs a connection.',
    {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
            'Content-Type': isNavigation ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    }
);

// Fetch event handler with different strategies for different routes
self.addEventListener('fetch', event => {
    // Skip non-GET requests and unsupported schemes
    if (event.request.method !== 'GET' ||
        !event.request.url.startsWith('http')) return;

    const url = new URL(event.request.url);

    // Cache-first strategy for the precached, unauthenticated static assets
    if (isPrecachedAsset(url.pathname)) {
        event.respondWith(
            caches.match(event.request)
                .then(response => response || fetch(event.request))
        );
        return;
    }

    // Network-only for everything else: HTML pages, /api/, ICS exports. These
    // responses are per-user, so they are never read from and never written to
    // CacheStorage - not even as a best-effort offline convenience.
    event.respondWith(
        fetch(event.request).catch(() =>
            offlineResponse(event.request.mode === 'navigate')
        )
    );
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