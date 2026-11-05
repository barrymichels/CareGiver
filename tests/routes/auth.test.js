const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const nodemailer = require('nodemailer');
const path = require('path');
const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');
const configurePassport = require('../../config/passport');

// Mock nodemailer
jest.mock('nodemailer');

describe('Auth Routes', () => {
    let app;
    let testUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        
        app = express();
        app.use(express.json());
        
        // Set up session
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false
        }));

        // Set up passport with the actual configuration
        app.use(passport.initialize());
        app.use(passport.session());
        configurePassport(passport, testDb);

        // Set up view engine
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, '../../views'));
        app.engine('ejs', (path, data, cb) => {
            cb(null, 'rendered');
        });

        // Create test routes with real passport strategy
        const authRoutes = require('../../routes/auth')(testDb);
        app.use('/', authRoutes);

        // Create test user
        testUser = await createTestUser();

        // Reset nodemailer mocks
        jest.clearAllMocks();
    });

    describe('GET /login', () => {
        it('should render login page when users exist', async () => {
            const response = await request(app)
                .get('/login')
                .expect(200);

            expect(response.text).toContain('rendered');
        });

        it('should redirect to setup when no users exist', async () => {
            await clearTestDb();
            const response = await request(app)
                .get('/login')
                .expect(302);

            expect(response.header.location).toBe('/setup');
        });
    });

    describe('POST /login', () => {
        it('should login active user successfully', async () => {
            await new Promise((resolve, reject) => {
                testDb.run(
                    'UPDATE users SET is_active = 1 WHERE id = ?',
                    [testUser.id],
                    (err) => err ? reject(err) : resolve()
                );
            });

            const response = await request(app)
                .post('/login')
                .send({
                    email: testUser.email,
                    password: 'password123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('redirect', '/');
        });

        it('should redirect inactive users to /inactive page', async () => {
            // Ensure user is inactive
            await new Promise((resolve, reject) => {
                testDb.run(
                    'UPDATE users SET is_active = 0 WHERE id = ?',
                    [testUser.id],
                    (err) => err ? reject(err) : resolve()
                );
            });
            
            const response = await request(app)
                .post('/login')
                .send({
                    email: testUser.email,
                    password: 'password123'
                })
                .expect(302);

            expect(response.header.location).toBe('/inactive');
        });

        it('should reject invalid credentials', async () => {
            const response = await request(app)
                .post('/login')
                .send({
                    email: testUser.email,
                    password: 'wrongpassword'
                })
                .expect(401);

            expect(response.body).toHaveProperty('message', 'Invalid email or password');
        });
    });

    describe('POST /register', () => {
        it('should register new user successfully', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    lastName: 'User',
                    email: 'newuser@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Registration successful! You can now log in.');
        });

        it('should reject duplicate email', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'Another',
                    lastName: 'User',
                    email: testUser.email,
                    password: 'password123',
                    confirmPassword: 'password123'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Email already registered');
        });

        it('should validate required fields', async () => {
            const response = await request(app)
                .post('/register')
                .send({})
                .expect(400);

            expect(response.body).toHaveProperty('error', 'All fields are required');
        });

        it('should validate password match', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'Test',
                    lastName: 'User',
                    email: 'test@example.com',
                    password: 'password123',
                    confirmPassword: 'different'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Passwords do not match');
        });
    });

    describe('GET /setup', () => {
        it('should render setup page when no users exist', async () => {
            await clearTestDb();
            const response = await request(app)
                .get('/setup')
                .expect(200);

            expect(response.text).toContain('rendered');
        });

        it('should redirect to login when users exist', async () => {
            const response = await request(app)
                .get('/setup')
                .expect(302);

            expect(response.header.location).toBe('/login');
        });
    });

    describe('POST /setup', () => {
        it('should create admin user when no users exist', async () => {
            await clearTestDb();
            const response = await request(app)
                .post('/setup')
                .send({
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Admin account created successfully! You can now log in.');
        });

        it('should reject setup when users exist', async () => {
            const response = await request(app)
                .post('/setup')
                .send({
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Setup already completed');
        });
    });

    describe('GET /logout', () => {
        it('should redirect to login page', async () => {
            const response = await request(app)
                .get('/logout')
                .expect(302);

            expect(response.header.location).toBe('/login');
        });
    });

    describe('route factory isolation', () => {
        it('authRoutes_whenRequiredTwiceWithDifferentDatabases_shouldReturnIndependentRouters', () => {
            // GIVEN two different databases,
            const firstDb = { get: jest.fn(), run: jest.fn() };
            const secondDb = { get: jest.fn(), run: jest.fn() };

            // WHEN this module's factory is called with each of them,
            const firstRouter = require('../../routes/auth')(firstDb);
            const secondRouter = require('../../routes/auth')(secondDb);

            // THEN they are separate routers. They used to be one module-level
            // instance, so every caller after app.js received app.js's database
            // regardless of what it passed - mocks included, silently:
            expect(secondRouter).not.toBe(firstRouter);
        });
    });

    describe('POST /forgot-password', () => {
        const MASKED_ACKNOWLEDGEMENT = 'If an account exists for that address, a password reset link has been sent.';

        const buildForgotPasswordApp = (mockDb) => {
            const mockApp = express();
            mockApp.use(express.json());
            mockApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            mockApp.use('/', require('../../routes/auth')(mockDb));
            return mockApp;
        };

        const dbReturning = (row) => ({
            get: (query, params, callback) => callback(null, row),
            run: (query, params, callback) => callback(null)
        });

        it('forgotPassword_withAnUnregisteredEmail_shouldAnswer200WithTheMaskedAcknowledgement', async () => {
            // GIVEN a lookup that finds nobody,
            const app = buildForgotPasswordApp(dbReturning(null));

            // WHEN a well-formed but unregistered address is submitted,
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: 'nonexistent@example.com' });

            // THEN the answer is indistinguishable from a real user's, so the route
            // cannot be used to list registered addresses (finding 15):
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ message: MASKED_ACKNOWLEDGEMENT });
        });

        it('forgotPassword_withARegisteredEmail_shouldAnswerTheSameBodyAsAnUnregisteredOne', async () => {
            // GIVEN an address that does exist, with a transport that accepts the mail:
            const sendMail = jest.fn().mockResolvedValue({ messageId: 'test' });
            nodemailer.createTransport.mockReturnValue({ sendMail });
            const app = buildForgotPasswordApp(dbReturning({ ...testUser, email: 'registered@example.com' }));

            // WHEN reset is requested,
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: 'registered@example.com' });

            // THEN the mail really was attempted, yet the caller still sees the
            // unregistered answer - the two outcomes are byte-identical:
            expect(sendMail).toHaveBeenCalledTimes(1);
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ message: MASKED_ACKNOWLEDGEMENT });
        });

        it('forgotPassword_withNoEmailField_shouldRefuse400WithoutThrowingOrReadingTheDatabase', async () => {
            // GIVEN a body with no email field - the payload that used to reach
            // email.toLowerCase() and surface as a 500 (finding 14),
            const db = { get: jest.fn(), run: jest.fn() };
            const app = buildForgotPasswordApp(db);

            // WHEN it is posted,
            const response = await request(app).post('/forgot-password').send({});

            // THEN it is refused on shape, before a single database read:
            expect(response.status).toBe(400);
            expect(response.body).toEqual({ error: 'Please enter a valid email address' });
            expect(db.get).not.toHaveBeenCalled();
        });

        it.each([
            ['empty string', ''],
            ['whitespace only', '   '],
            ['no at sign', 'not-an-email'],
            ['no domain dot', 'user@example'],
            ['two at signs', 'a@b@c.com'],
            ['embedded space', 'me @example.com'],
            ['non-string value', 42]
        ])('forgotPassword_withAMalformedAddress (%s)_shouldRefuse400WithoutTouchingTheDatabase', async (label, email) => {
            // GIVEN a value that is not an address,
            const db = { get: jest.fn(), run: jest.fn() };
            const app = buildForgotPasswordApp(db);

            // WHEN it is submitted,
            const response = await request(app).post('/forgot-password').send({ email });

            // THEN it is refused as syntax. That leaks nothing about who is
            // registered, and no lookup or SMTP attempt is spent on nonsense:
            expect(response.status).toBe(400);
            expect(response.body).toEqual({ error: 'Please enter a valid email address' });
            expect(db.get).not.toHaveBeenCalled();
        });

        it('forgotPassword_withWhitespaceAndMixedCase_shouldLookUpTheNormalisedAddress', async () => {
            // GIVEN an address typed as "  Alice@Example.COM ",
            const capturedParams = [];
            const sendMail = jest.fn().mockResolvedValue({});
            nodemailer.createTransport.mockReturnValue({ sendMail });
            const app = buildForgotPasswordApp({
                get: (query, params, callback) => {
                    capturedParams.push(params[0]);
                    callback(null, { ...testUser, email: 'alice@example.com' });
                },
                run: (query, params, callback) => callback(null)
            });

            // WHEN it is submitted,
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: '  Alice@Example.COM  ' });

            // THEN the lookup used the trimmed lower-case form, so an address
            // copied out of an email still finds its account:
            expect(capturedParams).toEqual(['alice@example.com']);
            expect(sendMail).toHaveBeenCalledTimes(1);
            expect(response.status).toBe(200);
        });

        it('forgotPassword_whenTheMailServerRejectsTheSend_shouldStillAnswerTheMaskedAcknowledgement', async () => {
            // GIVEN an existing account whose reset mail cannot be sent:
            const sendMail = jest.fn().mockRejectedValue(new Error('SMTP error'));
            nodemailer.createTransport.mockReturnValue({ sendMail });
            const app = buildForgotPasswordApp(dbReturning({ ...testUser, email: 'registered@example.com' }));

            // WHEN reset is requested,
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: 'registered@example.com' });

            // THEN the send was attempted but the failure stays hidden. Only an
            // existing account can reach this branch, so a 500 here would hand
            // back the exact leak this route exists to close.
            expect(sendMail).toHaveBeenCalledTimes(1);
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ message: MASKED_ACKNOWLEDGEMENT });
        });

        it('forgotPassword_whenTheDatabaseFailsTheLookup_shouldReport500BecauseItLeaksNothing', async () => {
            // GIVEN a lookup that errors instead of returning nobody:
            const app = buildForgotPasswordApp({
                get: (query, params, callback) => callback(new Error('SQLITE_BUSY'), null),
                run: (query, params, callback) => callback(null)
            });

            // WHEN reset is requested,
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: 'someone@example.com' });

            // THEN the operator sees a 500. This is safe to expose because the same
            // fault happens for registered and unregistered addresses alike, so it
            // cannot be used to tell them apart.
            expect(response.status).toBe(500);
            expect(response.body).toEqual({ error: 'Server error' });
        });
    });

    describe('GET /reset-password/:token', () => {
        it('should handle database error', async () => {
            const mockDb = {
                get: (query, params, callback) => {
                    if (query.includes('reset_token')) {
                        callback(null, null); // Return null to simulate no user found
                    } else {
                        callback(null, {});
                    }
                }
            };

            const mockApp = express();
            mockApp.use(express.json());
            mockApp.set('view engine', 'ejs');
            mockApp.set('views', path.join(__dirname, '../../views'));
            mockApp.engine('ejs', (path, data, cb) => {
                cb(null, JSON.stringify({ view: path.split('/').pop(), ...data }));
            });

            const authRoutes = require('../../routes/auth')(mockDb);
            mockApp.use('/', authRoutes);

            const response = await request(mockApp)
                .get('/reset-password/any-token');

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toBe('reset-password-error.ejs');
            expect(rendered.message).toBe('Password reset link is invalid or has expired.');
            expect(rendered.action).toEqual({
                text: 'Back to Login',
                url: '/login'
            });
        });

        it('resetPassword_whenTheTokenLookupErrors_shouldRenderTheProcessingErrorNotTheExpiredLinkMessage', async () => {
            // GIVEN a lookup that fails outright, rather than finding no token:
            const mockDb = {
                get: (query, params, callback) => {
                    if (query.includes('reset_token')) {
                        callback(new Error('Database error')); // Simulate actual DB error
                    } else {
                        callback(null, {});
                    }
                }
            };

            const mockApp = express();
            mockApp.use(express.json());
            mockApp.set('view engine', 'ejs');
            mockApp.set('views', path.join(__dirname, '../../views'));
            mockApp.engine('ejs', (path, data, cb) => {
                cb(null, JSON.stringify({ view: path.split('/').pop(), ...data }));
            });

            const authRoutes = require('../../routes/auth')(mockDb);
            mockApp.use('/', authRoutes);

            // WHEN the reset link is opened,
            const response = await request(mockApp)
                .get('/reset-password/any-token');

            // THEN the caller is told processing failed, not that the link expired.
            // This branch never ran while the shared router swallowed mockDb and the
            // real fixture answered instead, which is why the assertion below used to
            // demand the expired-link wording and still pass.
            const rendered = JSON.parse(response.text);
            expect(rendered.view).toBe('reset-password-error.ejs');
            expect(rendered.message).toBe('An error occurred while processing your request.');
            expect(rendered.action).toEqual({
                text: 'Back to Login',
                url: '/login'
            });
        });
    });

    describe('POST /reset-password/:token', () => {
        it('should handle expired token', async () => {
            const expiredDate = new Date(Date.now() - 3600000);
            await new Promise((resolve, reject) => {
                testDb.run(
                    'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
                    ['valid-token', expiredDate.getTime(), testUser.id],
                    (err) => err ? reject(err) : resolve()
                );
            });

            const response = await request(app)
                .post('/reset-password/valid-token')
                .send({
                    password: 'newpassword123',
                    confirmPassword: 'newpassword123'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Password reset link is invalid or has expired');
        });
    });
});