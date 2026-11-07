const request = require('supertest');

// App wiring tests isolate background jobs, local .env settings, and disk storage.
// Database, authentication, and notification behavior have their own real integration tests.
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../config/database', () => jest.fn(() => ({})));
jest.mock('../config/database.init', () => jest.fn().mockResolvedValue());
jest.mock('../config/oauth2', () => jest.fn());
jest.mock('../services/notificationService', () => jest.fn().mockImplementation(() => ({
    initialized: true,
    init: jest.fn().mockResolvedValue({ ok: true })
})));
jest.mock('connect-sqlite3', () => session => session.MemoryStore);
jest.mock('express-session', () => {
    const session = jest.requireActual('express-session');
    return Object.assign(jest.fn(session), session);
});

const signals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'uncaughtException', 'unhandledRejection'];

describe('App wiring', () => {
    let originalEnv;
    let originalListeners;

    beforeEach(() => {
        jest.resetModules();
        originalEnv = process.env;
        process.env = {
            ...originalEnv, NODE_ENV: 'test', SESSION_SECRET: 'test-secret', DB_PATH: ':memory:'
        };
        originalListeners = new Map(signals.map(signal => [signal, process.listeners(signal)]));
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const signal of signals) {
            for (const listener of process.listeners(signal)) {
                if (!originalListeners.get(signal).includes(listener)) process.removeListener(signal, listener);
            }
        }
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    it.each([['production', true], ['development', false]])(
        'configures secure cookies for %s', async (environment, secure) => {
            process.env.NODE_ENV = environment;
            require('../app');
            expect(require('express-session')).toHaveBeenCalledWith(expect.objectContaining({
                cookie: expect.objectContaining({ secure, httpOnly: true, sameSite: 'lax' })
            }));
        }
    );

    it('reports database initialization failures', async () => {
        const error = new Error('Database initialization error');
        require('../config/database.init').mockRejectedValueOnce(error);
        require('../app');
        await new Promise(setImmediate);
        expect(console.error).toHaveBeenCalledWith('Failed to initialize database:', error);
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('uses the real error middleware and security headers', async () => {
        const { app } = require('../app');
        // The parser runs before the error handler; routes appended after it cannot test it.
        const response = await request(app).post('/login')
            .set('Content-Type', 'application/json').send('{invalid');
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Server error' });
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['x-frame-options']).toBe('DENY');
        expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it.each([['3001', '3001'], [undefined, 3000]])(
        'starts the exported server with PORT=%s', async (configured, expected) => {
            if (configured === undefined) delete process.env.PORT;
            else process.env.PORT = configured;
            const { app, startServer } = require('../app');
            const server = {};
            jest.spyOn(app, 'listen').mockImplementation((port, callback) => {
                callback();
                return server;
            });
            expect(startServer()).toBe(server);
            expect(app.listen).toHaveBeenCalledWith(expected, expect.any(Function));
            expect(console.log).toHaveBeenCalledWith(`Server running on port ${expected}`);
        }
    );

    it.each([null, false, true])('serves the real inactive route for account state %s', async active => {
        const passport = require('passport');
        jest.spyOn(passport, 'initialize').mockReturnValue((req, res, next) => {
            req.isAuthenticated = () => active !== null;
            req.user = active === null ? undefined : { is_active: active };
            next();
        });
        jest.spyOn(passport, 'session').mockReturnValue((req, res, next) => next());
        const { app } = require('../app');
        const response = await request(app).get('/inactive');
        if (active === false) {
            expect(response.status).toBe(200);
            expect(response.text).toContain('<h1>Account Inactive</h1>');
        } else {
            expect(response.status).toBe(302);
            expect(response.headers.location).toBe(active === null ? '/login' : '/');
        }
    });

    it.each([true, false])('reports notification readiness (%s) without exposing configuration', async enabled => {
        require('../services/notificationService').mockImplementationOnce(() => ({
            initialized: enabled,
            init: jest.fn().mockResolvedValue({ ok: enabled, reason: 'private configuration detail' })
        }));
        const { app } = require('../app');
        await new Promise(setImmediate);
        const response = await request(app).get('/health').expect(200);
        expect(response.body).toEqual({
            status: enabled ? 'ok' : 'degraded', notifications: { enabled }
        });
    });
});
