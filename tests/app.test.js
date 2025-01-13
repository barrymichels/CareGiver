const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { testDb, initializeTestDb } = require('../config/test.db');
const { createTestUser, clearTestDb } = require('./helpers/testHelpers');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

// Mock process.exit before any imports
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Mock external dependencies
jest.mock('connect-sqlite3', () => {
    return () => function() {
        return {
            on: jest.fn()
        };
    };
});

jest.mock('../config/oauth2', () => {
    return jest.fn().mockImplementation((passport, db) => {});
});

jest.mock('bcrypt', () => ({
    compare: jest.fn().mockImplementation(() => Promise.resolve(true)),
    hash: jest.fn().mockImplementation(() => Promise.resolve('hashedPassword')),
    genSalt: jest.fn().mockImplementation(() => Promise.resolve('salt'))
}));

// Save original environment
const OLD_ENV = process.env;

describe('App', () => {
    let app;
    let server;
    let originalConsoleLog;
    let originalConsoleError;

    beforeAll(async () => {
        process.env = {
            ...OLD_ENV,
            NODE_ENV: 'test',
            SESSION_SECRET: 'test-secret',
            DB_PATH: ':memory:'
        };

        originalConsoleLog = console.log;
        originalConsoleError = console.error;
        console.log = jest.fn();
        console.error = jest.fn();

        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        jest.resetModules();
        jest.clearAllMocks();
        console.error = jest.fn();
    });

    afterEach(async () => {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        await clearTestDb();
    });

    afterAll(() => {
        process.env = OLD_ENV;
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        mockExit.mockRestore();
    });

    describe('Environment Configuration', () => {
        it('should configure secure cookies in production', () => {
            process.env.NODE_ENV = 'production';
            let sessionConfig;

            jest.mock('express-session', () => {
                return jest.fn((config) => {
                    sessionConfig = config;
                    return (req, res, next) => next();
                });
            });

            require('../app');
            expect(sessionConfig.cookie.secure).toBe(true);
        });

        it('should not require secure cookies in development', () => {
            process.env.NODE_ENV = 'development';
            let sessionConfig;

            jest.mock('express-session', () => {
                return jest.fn((config) => {
                    sessionConfig = config;
                    return (req, res, next) => next();
                });
            });

            require('../app');
            expect(sessionConfig.cookie.secure).toBe(false);
        });
    });

    describe('Database Initialization', () => {
        it('should handle database initialization errors', () => {
            // Mock database initialization to throw error
            jest.mock('../config/database.init', () => {
                return jest.fn().mockImplementation(() => {
                    throw new Error('Database initialization error');
                });
            });

            // Import app to trigger initialization
            require('../app');

            // Verify error handling
            expect(console.error).toHaveBeenCalledWith(
                'Failed to initialize database:',
                expect.any(Error)
            );
            expect(mockExit).toHaveBeenCalledWith(1);
        });
    });

    describe('Error Handling', () => {
        beforeEach(() => {
            // Mock successful database initialization for these tests
            jest.mock('../config/database.init', () => {
                return jest.fn().mockImplementation(() => Promise.resolve());
            });
        });

        it('should handle unhandled errors with JSON response', async () => {
            const { app } = require('../app');
            const error = new Error('Test error');
            app.get('/throw-error', (req, res, next) => next(error));

            const response = await request(app)
                .get('/throw-error')
                .set('Accept', 'application/json');

            expect(response.status).toBe(500);
            expect(response.body).toEqual({ error: 'Server error' });
            expect(response.header['content-type']).toContain('application/json');
            expect(response.header['x-content-type-options']).toBe('nosniff');
        });

        it('should handle errors in async routes', async () => {
            const { app } = require('../app');
            const error = new Error('Async error');
            app.get('/async-error', (req, res, next) => next(error));

            const response = await request(app)
                .get('/async-error')
                .set('Accept', 'application/json');

            expect(response.status).toBe(500);
            expect(response.body).toEqual({ error: 'Server error' });
        });
    });

    describe('Server Startup', () => {
        let mockListen;

        beforeEach(() => {
            // Set up mockListen
            mockListen = jest.fn((port, callback) => {
                callback();
                return { close: jest.fn() };
            });

            // Mock successful database initialization for these tests
            jest.mock('../config/database.init', () => {
                return jest.fn().mockImplementation(() => Promise.resolve());
            });

            // Mock getPageTitle
            jest.mock('../utils/title', () => ({
                getPageTitle: jest.fn()
            }));

            // Create a complete Express mock
            const mockRouter = () => ({
                use: jest.fn(),
                get: jest.fn(),
                post: jest.fn(),
                put: jest.fn(),
                delete: jest.fn(),
                route: jest.fn()
            });

            jest.mock('express', () => {
                const mockApp = function() {
                    return {
                        locals: {},
                        listen: mockListen,
                        use: jest.fn(),
                        set: jest.fn(),
                        get: jest.fn(),
                        post: jest.fn(),
                        put: jest.fn(),
                        delete: jest.fn(),
                        _router: { stack: [] }
                    };
                };
                mockApp.json = jest.fn(() => jest.fn());
                mockApp.urlencoded = jest.fn(() => jest.fn());
                mockApp.static = jest.fn(() => jest.fn());
                mockApp.Router = mockRouter;
                return mockApp;
            });
        });

        it('should start server on specified port', () => {
            process.env.PORT = '3001';
            const { startServer } = require('../app');
            const server = startServer();

            expect(mockListen).toHaveBeenCalledWith('3001', expect.any(Function));
            server.close();
        });

        it('should use default port 3000 if not specified', () => {
            delete process.env.PORT;
            const { startServer } = require('../app');
            const server = startServer();

            expect(mockListen).toHaveBeenCalledWith('3000', expect.any(Function));
            server.close();
        });
    });
}); 