const express = require('express');
const request = require('supertest');
const {
    buildAuthLimiters,
    limitsEnabledByDefault,
    LOGIN_MAX,
    FORGOT_MAX,
    RESET_MAX
} = require('../../middleware/rateLimit');
const { testDb, initializeTestDb } = require('../../config/test.db');
const configurePassport = require('../../config/passport');

const RESET_ROUTE = '/reset-password/some-token';

function makeApp(options) {
    const app = express();
    app.use(express.json());
    app.set('trust proxy', 1);

    const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = buildAuthLimiters(options);

    // A refused credential check answers 401, which is what a password guesser
    // provokes. Only refused attempts consume the login budget, so the fixture
    // has to be refused for the budget to be observable here.
    app.post('/login', loginLimiter, (req, res) => res.status(401).json({ message: 'Invalid email or password' }));
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
            expect(response.status).toBe(401);
        }

        const blocked = await request(app).post('/login').send({});
        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({ error: expect.stringMatching(/too many/i) });
        expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('does not charge a successful login against the guessing budget', async () => {
        const app = express();
        app.use(express.json());
        app.set('trust proxy', 1);
        app.post('/login', buildAuthLimiters({ enabled: true }).loginLimiter, (req, res) => {
            // A real sign-in answers 200; a wrong password answers the app's 401.
            res.status(req.headers['x-creds'] === 'good' ? 200 : 401).json({ ok: true });
        });

        const attempt = (creds) => request(app).post('/login').set('X-Creds', creds).send({});

        for (let attemptNumber = 0; attemptNumber < LOGIN_MAX - 1; attemptNumber++) {
            expect((await attempt('bad')).status).toBe(401);
        }
        // Signing in must not spend the budget. Without skipSuccessfulRequests the
        // first of these is the 10th counted request and the next is refused.
        for (let attemptNumber = 0; attemptNumber < 3; attemptNumber++) {
            expect((await attempt('good')).status).toBe(200);
        }
        expect((await attempt('bad')).status).toBe(401);
        expect((await attempt('bad')).status).toBe(429);
    });

    it('keeps separate budgets per endpoint', async () => {
        const app = makeApp({ enabled: true });

        await Promise.all(hit(app, '/login', LOGIN_MAX));
        expect((await request(app).post('/forgot-password').send({})).status).toBe(200);
        expect((await request(app).post('/login').send({})).status).toBe(429);

        // The mailer route counts its *successful* responses on purpose: sending
        // the reset mail is the abuse, so a 200 there must consume the budget.
        const forgot = await Promise.all(hit(app, '/forgot-password', FORGOT_MAX));
        expect(forgot[forgot.length - 1].status).toBe(429);
    });

    it('answers within budget on each endpoint', async () => {
        const app = makeApp({ enabled: true });

        expect((await request(app).post('/login').send({})).status).toBe(401);
        expect((await request(app).post('/forgot-password').send({})).status).toBe(200);
        expect((await request(app).post(RESET_ROUTE).send({})).status).toBe(200);
    });

    it('is inert under NODE_ENV=test by default', async () => {
        expect(process.env.NODE_ENV).toBe('test');
        const app = makeApp();

        const responses = await Promise.all(hit(app, '/login', 30));
        expect(responses.every(response => response.status === 401)).toBe(true);
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
        expect((await request(app).post('/login').set('X-Forwarded-For', '203.0.113.8').send({})).status).toBe(401);
    });
});

describe('mounted on the real auth routes', () => {
    beforeAll(async () => {
        await initializeTestDb();
    });

    // Each call builds its own router, so each limiter instance starts with an
    // empty bucket and the three routes cannot interfere with each other's tests.
    function limitedApp() {
        let app;
        jest.isolateModules(() => {
            process.env.RATE_LIMITS = 'on';
            const session = require('express-session');
            const passport = require('passport');
            const configurePassport = require('../../config/passport');

            app = express();
            app.set('trust proxy', 1); // mirrors app.js:73, so the per-IP key is real here
            app.use(express.json());
            app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
            app.use(passport.initialize());
            app.use(passport.session());
            configurePassport(passport, testDb);
            app.engine('ejs', (file, data, cb) => cb(null, 'rendered'));
            app.set('view engine', 'ejs');

            app.use('/', require('../../routes/auth')(testDb));
        });
        delete process.env.RATE_LIMITS;
        return app;
    }

    const post = (app, path, from) => request(app).post(path).set('X-Forwarded-For', from).send({});

    it('limits the real auth routes when RATE_LIMITS=on', async () => {
        const limited = limitedApp();

        // The limiter runs before the strategy, so the flood never reaches bcrypt.
        await Promise.all(hit(limited, '/login', LOGIN_MAX, '203.0.113.9'));

        // The refusal names the wait, because "a few minutes" is not 15.
        const blocked = await post(limited, '/login', '203.0.113.9');
        expect(blocked.status).toBe(429);
        expect(blocked.body.error).toMatch(/Try again in about 1[45] minutes\./);

        // A different IP on the same route is untouched...
        expect((await post(limited, '/login', '203.0.113.10')).status).not.toBe(429);

        // ...and an unarmed path on the same router is unaffected, proving the
        // limiter is mounted per endpoint rather than on the router as a whole.
        expect((await request(limited).get('/logout').set('X-Forwarded-For', '203.0.113.9')).status).not.toBe(429);
    });

    // Without this, deleting the limiter from the mailer route - the endpoint this
    // whole feature exists to protect - leaves the suite green.
    it('limits the mailer route, which is the one that costs money', async () => {
        const limited = limitedApp();
        const from = '203.0.113.11';

        // An unknown address: the handler answers without sending, so the suite
        // never reaches Gmail. Every one of these still spends the budget.
        for (let i = 0; i < FORGOT_MAX; i++) {
            expect((await post(limited, '/forgot-password', from)).status).not.toBe(429);
        }
        expect((await post(limited, '/forgot-password', from)).status).toBe(429);
    });

    it('limits the reset-password route', async () => {
        const limited = limitedApp();
        const from = '203.0.113.12';
        const path = '/reset-password/a-token-that-does-not-exist';

        for (let i = 0; i < RESET_MAX; i++) {
            expect((await post(limited, path, from)).status).not.toBe(429);
        }
        expect((await post(limited, path, from)).status).toBe(429);
    });
});
