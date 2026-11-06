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

// A store shaped like connect-sqlite3 (a `db` handle plus a table name - see the session
// setup in app.js) so the reset route's session cleanup has something to delete from.
class FakeSqliteSessionStore extends session.Store {
    constructor() {
        super();
        this.rows = [];
        this.table = 'sessions';
        this.db = {
            all: jest.fn((sql, callback) => callback(null, this.rows)),
            run: jest.fn((sql, params, callback) => callback(null))
        };
    }
    seed(sid, userId) {
        const sess = userId === undefined ? { cookie: {} } : { cookie: {}, passport: { user: userId } };
        this.rows.push({ sid, sess: JSON.stringify(sess) });
    }
    get(sid, cb) { cb(null, null); }
    set(sid, sess, cb) { if (cb) cb(); }
    destroy(sid, cb) { if (cb) cb(); }
}

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

        it('register_withAPaddedAndCasedAddress_shouldStoreTheNormalisedAddress', async () => {
            // GIVEN a registration typed with stray spaces and capitals, as a pasted address
            //      often arrives,
            await request(app)
                .post('/register')
                .send({
                    firstName: 'Padded',
                    lastName: 'User',
                    email: '  Padded@Example.COM ',
                    password: 'password123',
                    confirmPassword: 'password123'
                })
                .expect(200);

            // THEN the stored address is the normalised one. It matters that this is asserted
            //      here rather than at the lookup: password reset normalises before searching, so
            //      a padded row would be findable at login and permanently invisible at reset -
            //      and the masked reset response would hide the reason every single time.
            const stored = await new Promise((resolve, reject) => {
                testDb.get('SELECT email FROM users WHERE email = ?', ['padded@example.com'], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            expect(stored).toBeDefined();
            expect(stored.email).toBe('padded@example.com');
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

        it('register_whenNoUsersExistYet_shouldRefuse428SoASpambotCannotPoisonSetup', async () => {
            // GIVEN a fresh database with no accounts,
            await clearTestDb();

            // WHEN a caller tries to register before setup has run,
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'First',
                    lastName: 'Bot',
                    email: 'firstbot@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            // THEN registration is refused: whichever row lands first would flip
            //      checkSetupRequired() to false and lock POST /setup out with
            //      "Setup already completed" forever - leaving the instance with no
            //      admin at all.
            expect(response.status).toBe(428);
            expect(response.body).toHaveProperty('error');

            const remaining = await new Promise((resolve, reject) => {
                testDb.get('SELECT COUNT(*) as count FROM users', (err, row) =>
                    err ? reject(err) : resolve(row.count)
                );
            });
            expect(remaining).toBe(0);
        });

        it('register_repeatedlyWithDuplicateEmails_shouldThrottleTheOracleAfterFiveProbes', async () => {
            // GIVEN the limiter kill-switch flipped on (the suite runs it off by default)
            //      and an address that already belongs to someone,
            process.env.RATE_LIMITS = 'on';
            try {
                const throttledApp = express();
                throttledApp.use(express.json());
                throttledApp.use('/', require('../../routes/auth')(testDb));

                // WHEN a probe hammers the endpoint with duplicate-email guesses,
                const probe = () => request(throttledApp)
                    .post('/register')
                    .send({
                        firstName: 'Probe',
                        lastName: 'Bot',
                        email: testUser.email,
                        password: 'password123',
                        confirmPassword: 'password123'
                    });

                const statuses = [];
                for (let attempt = 0; attempt < 6; attempt++) {
                    statuses.push((await probe()).status);
                }

                // THEN "Email already registered" stays answerable for a human - masking it
                //      would make real signups fail silently - but the oracle is priced at
                //      five probes an hour per address before 429 closes the door.
                expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
            } finally {
                delete process.env.RATE_LIMITS;
            }
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
        // The mock engine reports which view was rendered and echoes the two locals the
        // error page actually consumes (message and action) - see views/reset-password-error.ejs.
        const buildResetErrorApp = (mockDb) => {
            const mockApp = express();
            mockApp.use(express.json());
            mockApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            mockApp.set('view engine', 'ejs');
            mockApp.set('views', path.join(__dirname, '../../views'));
            mockApp.engine('ejs', (viewPath, data, cb) => {
                cb(null, JSON.stringify({
                    view: viewPath.split('/').pop(),
                    message: data.message,
                    action: data.action
                }));
            });
            mockApp.use('/', require('../../routes/auth')(mockDb));
            return mockApp;
        };

        it('should render the error page for an invalid or expired token', async () => {
            // GIVEN a token lookup that finds nobody (no row, or a row past its expiry),
            const mockDb = {
                get: (query, params, callback) => {
                    if (query.includes('reset_token')) {
                        callback(null, null);
                    } else {
                        callback(null, {});
                    }
                }
            };
            const mockApp = buildResetErrorApp(mockDb);

            // WHEN an expired link is opened by a real browser,
            const response = await request(mockApp)
                .get('/reset-password/any-token');

            // THEN the user is refused 400 and given the human error page - not raw JSON
            //      naming an internal template, which is what the "For test purposes"
            //      shortcut used to hand back to every clicking human.
            expect(response.status).toBe(400);
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
            const mockApp = buildResetErrorApp(mockDb);

            // WHEN the reset link is opened,
            const response = await request(mockApp)
                .get('/reset-password/any-token');

            // THEN the caller is told processing failed, not that the link expired. The
            // fault gets a 500 so server-side monitoring can see it.
            // This branch never ran while the shared router swallowed mockDb and the
            // real fixture answered instead, which is why the assertion below used to
            // demand the expired-link wording and still pass.
            expect(response.status).toBe(500);
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

        it('resetPassword_withAValidToken_shouldDeleteTheUsersStoredSessions', async () => {
            // GIVEN a live reset token and a session store holding two sessions that
            //      belong to this user - one of them the cookie the thief is still
            //      riding on - plus another account's session and an anonymous one,
            await new Promise((resolve, reject) => {
                testDb.run(
                    'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
                    ['fresh-token', Date.now() + 3600000, testUser.id],
                    (err) => err ? reject(err) : resolve()
                );
            });

            const store = new FakeSqliteSessionStore();
            store.seed('victim-session-a', testUser.id);
            store.seed('victim-session-b', testUser.id);
            store.seed('foreign-session', 999);
            store.seed('anonymous-session');

            const resetApp = express();
            resetApp.use(express.json());
            resetApp.use(session({
                store,
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            resetApp.use('/', require('../../routes/auth')(testDb));

            // WHEN the password is reset through the emailed link,
            const response = await request(resetApp)
                .post('/reset-password/fresh-token')
                .send({
                    password: 'newpassword123',
                    confirmPassword: 'newpassword123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('message');

            // THEN every session belonging to the account is destroyed. Changing the
            //      password must evict whoever is already logged in with the old one;
            //      before this, the stolen cookie survived the reset untouched.
            expect(store.db.run).toHaveBeenCalledTimes(1);
            const [, deletedSids] = store.db.run.mock.calls[0];
            expect(deletedSids.sort()).toEqual(['victim-session-a', 'victim-session-b']);
        });
    });
});