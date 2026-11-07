const globals = ['self', 'clients', 'caches', 'fetch'];
let originals, handlers, cache;

beforeEach(() => {
    originals = globals.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]);
    handlers = {};
    cache = { add: jest.fn().mockResolvedValue(), put: jest.fn() };
    global.caches = {
        open: jest.fn().mockResolvedValue(cache), match: jest.fn().mockResolvedValue(undefined),
        keys: jest.fn().mockResolvedValue(['caregiver-v2', 'caregiver-v3']),
        delete: jest.fn().mockResolvedValue(true)
    };
    global.clients = {
        claim: jest.fn(), matchAll: jest.fn().mockResolvedValue([]), openWindow: jest.fn().mockResolvedValue({})
    };
    global.self = {
        addEventListener: (name, handler) => { handlers[name] = handler; },
        skipWaiting: jest.fn(), clients, location: { origin: 'https://care.example' },
        registration: { showNotification: jest.fn().mockResolvedValue() }
    };
    global.fetch = jest.fn().mockResolvedValue(new Response('current user data'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => require('../../public/sw'));
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
    }
});

function dispatch(name, fields = {}) {
    const event = { waitUntil: jest.fn(), respondWith: jest.fn(), ...fields };
    handlers[name](event);
    return event;
}

const request = (path, extra = {}) => ({ url: `https://care.example${path}`, method: 'GET', ...extra });

test('installation precaches static assets and tolerates a missing asset', async () => {
    cache.add.mockRejectedValueOnce(new Error('missing file'));
    const event = dispatch('install');
    await event.waitUntil.mock.calls[0][0];
    expect(self.skipWaiting).toHaveBeenCalled();
    expect(cache.add).toHaveBeenCalledWith('/css/style.css');
    expect(cache.add.mock.calls.every(([url]) => /^\/(css|js|icons)\/|^\/manifest.json$/.test(url))).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
});

test('activation deletes old caches containing private responses', async () => {
    const event = dispatch('activate');
    await event.waitUntil.mock.calls[0][0];
    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith('caregiver-v2');
    expect(clients.claim).toHaveBeenCalled();
});

test.each(['/dashboard', '/api/notifications/preferences', '/export-calendar', '/js/profile.js'])(
    '%s uses the network without reading or populating shared caches', async path => {
        caches.match.mockResolvedValue(new Response('another user’s data'));
        const req = request(path);
        const event = dispatch('fetch', { request: req });
        const response = await event.respondWith.mock.calls[0][0];
        expect(await response.text()).toBe('current user data');
        expect(fetch).toHaveBeenCalledWith(req);
        expect(caches.match).not.toHaveBeenCalled();
        expect(caches.open).not.toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
    }
);

test.each(['navigate', 'cors'])('offline %s requests return an uncached 503, never stale private data', async mode => {
    fetch.mockRejectedValue(new Error('offline'));
    caches.match.mockResolvedValue(new Response('another user’s data'));
    const event = dispatch('fetch', { request: request('/dashboard', { mode }) });
    const response = await event.respondWith.mock.calls[0][0];
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain(mode === 'navigate' ? 'text/html' : 'text/plain');
    expect(await response.text()).not.toContain('another user');
    expect(caches.match).not.toHaveBeenCalled();
});

test.each([true, false])('precached assets use cache first (hit=%s)', async hit => {
    if (hit) caches.match.mockResolvedValue(new Response('static cached asset'));
    const event = dispatch('fetch', { request: request('/css/style.css') });
    const response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe(hit ? 'static cached asset' : 'current user data');
    expect(fetch).toHaveBeenCalledTimes(hit ? 0 : 1);
});

test.each([{ method: 'POST' }, { url: 'chrome-extension://extension/file' }])(
    'leaves unsupported requests to the browser (%j)', extra => {
        const event = dispatch('fetch', { request: request('/dashboard', extra) });
        expect(event.respondWith).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    }
);

test.each(['valid', 'missing', 'malformed'])('displays %s push data safely', async kind => {
    const payload = { title: 'Visit reminder', body: 'Time to visit', data: { type: 'shift_reminder' } };
    const data = kind === 'missing' ? undefined : { json: () => {
        if (kind === 'malformed') throw new Error('invalid JSON');
        return payload;
    } };
    const event = dispatch('push', { data });
    await event.waitUntil.mock.calls[0][0];
    expect(self.registration.showNotification).toHaveBeenCalledWith(
        kind === 'valid' ? payload.title : 'WayneScheduler', expect.objectContaining({
            body: kind === 'valid' ? payload.body : 'You have a new notification',
            tag: kind === 'valid' ? 'shift_reminder' : 'general', requireInteraction: true
        })
    );
});

test.each([true, false])('notification click reuses an app window when available (%s)', async existing => {
    const client = {
        url: 'https://care.example/profile', navigate: jest.fn().mockResolvedValue(), focus: jest.fn()
    };
    clients.matchAll.mockResolvedValue(existing ? [client] : []);
    const notification = { close: jest.fn(), data: { url: '/dashboard' } };
    const event = dispatch('notificationclick', { notification });
    await event.waitUntil.mock.calls[0][0];
    expect(notification.close).toHaveBeenCalled();
    if (existing) {
        expect(client.navigate).toHaveBeenCalledWith('/dashboard');
        expect(client.focus).toHaveBeenCalled();
        expect(clients.openWindow).not.toHaveBeenCalled();
    } else {
        expect(clients.openWindow).toHaveBeenCalledWith('/dashboard');
    }
});
