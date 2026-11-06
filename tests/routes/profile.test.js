const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, getUserById } = require('../helpers/testHelpers');
const configurePassport = require('../../config/passport');
const bcrypt = require('bcrypt');

// A store shaped like connect-sqlite3 (a `db` handle plus a table name - see the session
// setup in app.js) so the route's session cleanup has something to delete from. Reads and
// writes are recorded on jest.fn(), so no real sessions database is involved.
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

// Create express app for testing
const app = express();

// Set up view engine for testing
app.set('views', path.join(__dirname, '../../views'));
app.set('view engine', 'ejs');

// Create a modifiable mock auth middleware
const createMockAuth = (userId) => (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: userId, is_active: true };
    next();
};

app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Import profile routes
const profileRoutes = require('../../routes/profile')(testDb);

describe('Profile Routes', () => {
    let testUser;
    let mockAuth;
    let originalConsoleError;
    let isErrorExpected = false;

    beforeAll(async () => {
        await initializeTestDb();
        // Save original console.error
        originalConsoleError = console.error;
    });

    beforeEach(async () => {
        await clearTestDb();
        isErrorExpected = false;
        // Mock console.error for each test
        console.error = jest.fn();
        
        testUser = await createTestUser();
        mockAuth = (req, res, next) => {
            req.isAuthenticated = () => true;
            req.user = {
                id: testUser.id,
                is_active: true,
                first_name: testUser.first_name,
                last_name: testUser.last_name,
                email: testUser.email
            };
            next();
        };
        app._router.stack = app._router.stack.filter(layer => !layer.route || layer.route.path !== '/profile');
        app.use('/profile', mockAuth, profileRoutes);
    });

    afterEach(() => {
        // Only verify no unexpected errors if we're not expecting errors
        if (!isErrorExpected) {
            expect(console.error).not.toHaveBeenCalled();
        }
        // Reset console.error to original after each test
        console.error = originalConsoleError;
    });

    afterAll(() => {
        // Restore original console.error
        console.error = originalConsoleError;
    });

    describe('GET /profile', () => {
        it('should handle database errors', async () => {
            isErrorExpected = true;
            
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            const response = await request(app)
                .get('/profile')
                .set('Accept', 'application/json')
                .expect(500);

            expect(response.body).toHaveProperty('error', 'Server error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.get = originalGet;
        });

        it('should handle user not found', async () => {
            isErrorExpected = true;
            
            // Mock db.get to simulate user not found
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(null, null);
            };

            const response = await request(app)
                .get('/profile')
                .set('Accept', 'application/json')
                .expect(500);

            expect(response.body).toHaveProperty('error', 'Server error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.get = originalGet;
        });

        it('should return HTML error for HTML requests', async () => {
            isErrorExpected = true;
            
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            const response = await request(app)
                .get('/profile')
                .set('Accept', 'text/html')
                .expect(500);

            expect(response.text).toContain('<div class="error">Server error</div>');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.get = originalGet;
        });
    });

    describe('PUT /profile', () => {
        it('should update user profile', async () => {
            const updates = {
                firstName: 'Updated',
                lastName: 'Name',
                email: 'updated@example.com'
            };

            const response = await request(app)
                .put('/profile')
                .send(updates)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Profile updated successfully');

            // Verify the updates in the database
            const updatedUser = await getUserById(testUser.id);
            expect(updatedUser).toMatchObject({
                first_name: updates.firstName,
                last_name: updates.lastName,
                email: updates.email
            });
        });

        it('should validate email format', async () => {
            const updates = {
                firstName: 'Updated',
                lastName: 'Name',
                email: 'invalid-email'
            };

            const response = await request(app)
                .put('/profile')
                .send(updates);

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Invalid email format');
        });

        it('should prevent duplicate email', async () => {
            // Create another user with a different email
            const otherUser = await createTestUser({ 
                email: 'other@example.com' 
            });

            const updates = {
                firstName: 'Updated',
                lastName: 'Name',
                email: otherUser.email // Try to use the other user's email
            };

            const response = await request(app)
                .put('/profile')
                .send(updates);

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Email already in use');
        });

        it('putProfile_withAPaddedAndCasedAddress_shouldStoreTheNormalisedAddressAndKeepLoginWorking', async () => {
            // GIVEN a profile save typed as "  Bob@Example.COM ",
            await request(app)
                .put('/profile')
                .send({ firstName: 'Bob', lastName: 'Smith', email: '  Bob@Example.COM ' })
                .expect(200);

            // THEN the stored address is the normalised one, exactly as registration
            //      and password reset already store it,
            const updatedUser = await getUserById(testUser.id);
            expect(updatedUser.email).toBe('bob@example.com');

            // AND the account can still log in. This is the whole point: the login
            //      strategy normalises before its lookup, so a raw-cased stored row is
            //      unreachable by its owner - a silent permanent lockout, since the
            //      masked reset route cannot deliver mail to an address it never finds.
            configurePassport(passport, testDb);
            const loginApp = express();
            loginApp.use(express.json());
            loginApp.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
            loginApp.use(passport.initialize());
            loginApp.use(passport.session());
            loginApp.post('/login', passport.authenticate('local'), (req, res) => {
                res.json({ redirect: '/' });
            });

            const login = await request(loginApp)
                .post('/login')
                .send({ email: 'bob@example.com', password: 'password123' })
                .expect(200);

            expect(login.body).toEqual({ redirect: '/' });
        });

        it('putProfile_withACaseVariantOfAnotherUsersAddress_shouldReject400NotSurfaceAUniqueViolation', async () => {
            // GIVEN another account already owns "other@example.com",
            await createTestUser({ email: 'other@example.com' });

            // WHEN this profile tries to save the same address with capitals,
            const response = await request(app)
                .put('/profile')
                .send({ firstName: 'Updated', lastName: 'Name', email: 'Other@Example.COM' });

            // THEN the duplicate check compares normalised to normalised and answers 400.
            //      Before the fix the raw form dodged the check and the UPDATE hit the
            //      UNIQUE constraint instead - a bare 500.
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Email already in use');
        });

        it.each([
            ['missing names', { email: 'names@example.com' }],
            ['blank names', { firstName: '   ', lastName: '', email: 'names@example.com' }]
        ])('putProfile_with%s_shouldReject400InsteadOfFailingInTheUpdate', async (label, updates) => {
            // GIVEN a profile save whose name fields are absent or blank - the payload
            //      that used to sail past validation and 500 on the UPDATE,
            const response = await request(app)
                .put('/profile')
                .send(updates);

            // THEN it is refused up front.
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'First and last name are required');
        });
    });

    describe('PUT /profile/password', () => {
        it('should update password', async () => {
            const passwords = {
                currentPassword: 'password123',
                newPassword: 'newpassword123',
                confirmPassword: 'newpassword123'
            };

            const response = await request(app)
                .put('/profile/password')
                .send(passwords);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Password updated successfully');

            // Verify the password was updated
            const updatedUser = await getUserById(testUser.id);
            const isNewPasswordValid = await bcrypt.compare(passwords.newPassword, updatedUser.password);
            expect(isNewPasswordValid).toBe(true);
        });

        it('should validate current password', async () => {
            const passwords = {
                currentPassword: 'wrongpassword',
                newPassword: 'newpassword123',
                confirmPassword: 'newpassword123'
            };

            const response = await request(app)
                .put('/profile/password')
                .send(passwords);

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Current password is incorrect');
        });

        it('should validate password confirmation', async () => {
            const passwords = {
                currentPassword: 'password123',
                newPassword: 'newpassword123',
                confirmPassword: 'different'
            };

            const response = await request(app)
                .put('/profile/password')
                .send(passwords);

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Passwords do not match');
        });

        it('should require minimum password length', async () => {
            const passwords = {
                currentPassword: 'password123',
                newPassword: 'short',
                confirmPassword: 'short'
            };

            const response = await request(app)
                .put('/profile/password')
                .send(passwords);

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Password must be at least 8 characters');
        });

        it('should handle database error when getting user', async () => {
            isErrorExpected = true;
            
            // Mock db.get to simulate database error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            const response = await request(app)
                .put('/profile/password')
                .send({
                    currentPassword: 'password123',
                    newPassword: 'newpassword123',
                    confirmPassword: 'newpassword123'
                })
                .expect(500);

            expect(response.body).toHaveProperty('error', 'Server error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.get = originalGet;
        });

        it('should handle user not found error', async () => {
            isErrorExpected = true;
            
            // Mock db.get to simulate user not found
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(null, null);
            };

            const response = await request(app)
                .put('/profile/password')
                .send({
                    currentPassword: 'password123',
                    newPassword: 'newpassword123',
                    confirmPassword: 'newpassword123'
                })
                .expect(404);

            expect(response.body).toHaveProperty('error', 'User not found');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.get = originalGet;
        });

        it('should handle database error during password update', async () => {
            isErrorExpected = true;
            
            const passwords = {
                currentPassword: 'password123',
                newPassword: 'newpassword123',
                confirmPassword: 'newpassword123'
            };

            // Mock runWithRetry to simulate database error
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                if (sql.includes('UPDATE')) {
                    callback(new Error('Database error'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            const response = await request(app)
                .put('/profile/password')
                .send(passwords)
                .expect(500);

            expect(response.body).toHaveProperty('error', 'Server error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.run = originalRun;
        });

        it('putPassword_shouldDeleteTheUsersStoredSessions', async () => {
            // GIVEN a session store holding two of this user's live sessions plus
            //      someone else's and one belonging to an anonymous visitor,
            const store = new FakeSqliteSessionStore();
            store.seed('session-a', testUser.id);
            store.seed('session-b', testUser.id);
            store.seed('foreign-session', 999);
            store.seed('anonymous-session');

            const passwordApp = express();
            passwordApp.use(express.json());
            passwordApp.use(session({
                store,
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            passwordApp.use((req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = { id: testUser.id, is_active: true };
                next();
            });
            passwordApp.use('/profile', profileRoutes);

            // WHEN the user changes their password,
            const response = await request(passwordApp)
                .put('/profile/password')
                .send({
                    currentPassword: 'password123',
                    newPassword: 'newpassword123',
                    confirmPassword: 'newpassword123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Password updated successfully');

            // THEN every session that belongs to this user is destroyed. A stolen cookie
            //      must stop working the moment its owner rotates the password; before
            //      this, it outlived the reset untouched.
            expect(store.db.run).toHaveBeenCalledTimes(1);
            const [, deletedSids] = store.db.run.mock.calls[0];
            expect(deletedSids.sort()).toEqual(['session-a', 'session-b']);
        });
    });
}); 