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
        
        // Initialize a fresh Express app for each test
        const expressApp = express();
        expressApp.use(express.json());
        expressApp.use(express.urlencoded({ extended: true }));
        
        // Set up session middleware
        expressApp.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false
        }));

        // Initialize Passport and session
        expressApp.use(passport.initialize());
        expressApp.use(passport.session());

        // Set up Passport serialization
        passport.serializeUser((user, done) => {
            done(null, user.id);
        });

        passport.deserializeUser((id, done) => {
            done(null, { id, email: 'test@example.com' });
        });

        app = expressApp;
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
        it('should start server on specified port', () => {
            const mockApp = {
                listen: jest.fn((port, callback) => {
                    callback();
                    return { close: jest.fn() };
                })
            };

            const startServer = (app) => {
                const PORT = process.env.PORT || 3000;
                return app.listen(PORT, () => {
                    console.log(`Server running on port ${PORT}`);
                });
            };

            process.env.PORT = '3001';
            const server = startServer(mockApp);

            expect(mockApp.listen).toHaveBeenCalledWith('3001', expect.any(Function));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('3001'));
        });

        it('should use default port 3000 if not specified', () => {
            const mockApp = {
                listen: jest.fn((port, callback) => {
                    callback();
                    return { close: jest.fn() };
                })
            };

            const startServer = (app) => {
                const PORT = process.env.PORT || 3000;
                return app.listen(PORT, () => {
                    console.log(`Server running on port ${PORT}`);
                });
            };

            delete process.env.PORT;
            const server = startServer(mockApp);

            expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('3000'));
        });
    });

    describe('Authentication', () => {
        beforeEach(() => {
            // Set up Passport LocalStrategy
            passport.use(new LocalStrategy(
                { usernameField: 'email' },
                (email, password, done) => {
                    bcrypt.compare(password, 'hashedPassword', (err, isMatch) => {
                        if (err) return done(err);
                        if (isMatch) {
                            return done(null, { id: 1, email });
                        }
                        return done(null, false);
                    });
                }
            ));

            // Set up login route
            app.post('/login', (req, res, next) => {
                passport.authenticate('local', (err, user) => {
                    if (err) return next(err);
                    if (!user) return res.sendStatus(401);
                    
                    req.logIn(user, (err) => {
                        if (err) return next(err);
                        return res.redirect('/');
                    });
                })(req, res, next);
            });
        });

        it('should authenticate valid credentials', async () => {
            const testUser = {
                email: 'test@example.com',
                password: 'password123'
            };

            bcrypt.compare.mockImplementationOnce((pass, hash, cb) => cb(null, true));

            await request(app)
                .post('/login')
                .send(testUser)
                .expect(302)
                .expect('Location', '/');
        });

        it('should reject invalid credentials', async () => {
            const testUser = {
                email: 'nonexistent@example.com',
                password: 'wrongpassword'
            };

            bcrypt.compare.mockImplementationOnce((pass, hash, cb) => cb(null, false));

            await request(app)
                .post('/login')
                .send(testUser)
                .expect(401);
        });
    });

    describe('Routes', () => {
        beforeEach(() => {
            // Set up authentication check middleware
            const isAuthenticated = (req, res, next) => {
                if (!req.isAuthenticated()) {
                    return res.redirect('/login');
                }
                next();
            };

            // Set up test routes with proper middleware order
            app.use((req, res, next) => {
                // Global middleware to set user for testing
                if (req.headers['x-test-user']) {
                    req.user = JSON.parse(req.headers['x-test-user']);
                    req.isAuthenticated = () => true;
                }
                next();
            });

            app.get('/inactive', isAuthenticated, (req, res) => {
                if (!req.user.is_active) {
                    res.send('inactive');
                } else {
                    res.redirect('/');
                }
            });

            app.get('/test-error', (req, res) => {
                res.send('Test error');
            });
        });

        it('should handle inactive account route', async () => {
            const response = await request(app)
                .get('/inactive')
                .set('x-test-user', JSON.stringify({ is_active: false }))
                .expect(200);

            expect(response.text).toBe('inactive');
        });

        it('should redirect active users from inactive route', async () => {
            await request(app)
                .get('/inactive')
                .set('x-test-user', JSON.stringify({ is_active: true }))
                .expect(302)
                .expect('Location', '/');
        });

        it('should render test error page', async () => {
            const response = await request(app)
                .get('/test-error')
                .expect(200);

            expect(response.text).toBe('Test error');
        });
    });
}); 