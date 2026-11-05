const express = require('express');
const request = require('supertest');
const {
    buildAuthLimiters,
    limitsEnabledByDefault,
    LOGIN_MAX,
    FORGOT_MAX
} = require('../../middleware/rateLimit');

const RESET_ROUTE = '/reset-password/some-token';

function makeApp(options) {
    const app = express();
    app.use(express.json());
    app.set('trust proxy', 1);

    const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = buildAuthLimiters(options);

    app.post('/login', loginLimiter, (req, res) => res.json({ ok: true }));
    app.post('/forgot-password', forgotPasswordLimiter, (req, res) => res.json({ ok: true }));
    app.post(RESET_ROUTE, resetPasswordLimiter, (req, res) => res.json({ ok: true }));

    return app;
}

const hit = (app, path, times, from) => Array.from({ length: times }, () => {
    const call = request(app).post(path);
    return from ? call.set('X-Forwarded-For', from).send({}) : call.send({});
});

afterEach(() => {
    delete process.env.RATE_LIMITS;
});

describe('auth rate limiters', () => {
    it('blocks the request one past the login budget from one address', async () => {
        const app = makeApp({ enabled: true });

        for (const response of await Promise.all(hit(app, '/login', LOGIN_MAX))) {
            expect(response.status).toBe(200);
        }

        const blocked = await request(app).post('/login').send({});
        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({ error: expect.stringMatching(/too many/i) });
        expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('keeps separate budgets per endpoint', async () => {
        const app = makeApp({ enabled: true });

        await Promise.all(hit(app, '/login', LOGIN_MAX));
        expect((await request(app).post('/forgot-password').send({})).status).toBe(200);
        expect((await request(app).post('/login').send({})).status).toBe(429);

        const forgot = await Promise.all(hit(app, '/forgot-password', FORGOT_MAX));
        expect(forgot[forgot.length - 1].status).toBe(429);
    });

    it('answers 200 while inside budget', async () => {
        const app = makeApp({ enabled: true });

        expect((await request(app).post('/login').send({})).status).toBe(200);
        expect((await request(app).post('/forgot-password').send({})).status).toBe(200);
        expect((await request(app).post(RESET_ROUTE).send({})).status).toBe(200);
    });

    it('is inert under NODE_ENV=test by default', async () => {
        expect(process.env.NODE_ENV).toBe('test');
        const app = makeApp();

        const responses = await Promise.all(hit(app, '/login', 30));
        expect(responses.every(response => response.status === 200)).toBe(true);
    });

    it('is enabled outside the test environment', async () => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const app = makeApp();
            await Promise.all(hit(app, '/login', LOGIN_MAX));
            expect((await request(app).post('/login').send({})).status).toBe(429);
        } finally {
            process.env.NODE_ENV = original;
        }
    });

    it('honours the explicit RATE_LIMITS=off escape hatch', () => {
        process.env.NODE_ENV = 'production';
        try {
            process.env.RATE_LIMITS = 'off';
            expect(limitsEnabledByDefault()).toBe(false);
            process.env.RATE_LIMITS = 'on';
            expect(limitsEnabledByDefault()).toBe(true);
        } finally {
            process.env.NODE_ENV = 'test';
        }
    });

    it('counts each client address separately', async () => {
        const app = makeApp({ enabled: true });

        await Promise.all(hit(app, '/login', LOGIN_MAX, '203.0.113.7'));

        expect((await request(app).post('/login').set('X-Forwarded-For', '203.0.113.7').send({})).status).toBe(429);
        expect((await request(app).post('/login').set('X-Forwarded-For', '203.0.113.8').send({})).status).toBe(200);
    });
});
