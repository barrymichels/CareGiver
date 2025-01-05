const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, normalizeViewPath } = require('../helpers/testHelpers');

// Create express app for testing
const app = express();

// Mock view engine for testing
app.set('view engine', 'ejs');
app.engine('ejs', (path, data, cb) => {
    // Mock render function that just returns the view name and data
    const output = {
        view: path,
        data: data
    };
    cb(null, JSON.stringify(output));
});

app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));

// Configure Passport
passport.use(new LocalStrategy(
    { usernameField: 'email' },
    (email, password, done) => {
        testDb.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], (err, user) => {
            if (err) return done(err);
            if (!user) return done(null, false, { message: 'Invalid email or password' });

            bcrypt.compare(password, user.password, (err, isMatch) => {
                if (err) return done(err);
                if (!isMatch) return done(null, false, { message: 'Invalid email or password' });
                return done(null, user);
            });
        });
    }
));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    testDb.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        done(err, user);
    });
});

app.use(passport.initialize());
app.use(passport.session());

// Import and use auth routes
const authRoutes = require('../../routes/auth')(testDb);
app.use('/', authRoutes);

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
});

describe('Auth Routes', () => {
    // Helper function to get view name from full path
    function getViewName(fullPath) {
        return normalizeViewPath(fullPath);
    }

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
    });

    describe('GET /login', () => {
        it('should render login page when not logged in', async () => {
            // Create a user first so it doesn't redirect to setup
            await createTestUser();

            const response = await request(app)
                .get('/login');
            expect(response.status).toBe(200);

            // Parse the response to verify the correct view was rendered
            const rendered = JSON.parse(response.text);
            expect(getViewName(rendered.view)).toBe('login');
        });

        it('should redirect to setup if no users exist', async () => {
            const response = await request(app)
                .get('/login');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/setup');
        });

        it('should handle database errors', async () => {
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            const response = await request(app)
                .get('/login');
            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Server error');

            // Restore original function
            testDb.get = originalGet;
        });
    });

    describe('GET /setup', () => {
        it('should render setup page when no users exist', async () => {
            const response = await request(app)
                .get('/setup');
            expect(response.status).toBe(200);

            // Parse the response to verify the correct view was rendered
            const rendered = JSON.parse(response.text);
            expect(getViewName(rendered.view)).toBe('setup');
        });

        it('should redirect to login if users exist', async () => {
            await createTestUser();
            const response = await request(app)
                .get('/setup');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/login');
        });

        it('should handle database errors', async () => {
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            const response = await request(app)
                .get('/setup');
            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Server error');

            // Restore original function
            testDb.get = originalGet;
        });
    });

    describe('POST /setup', () => {
        it('should create admin user successfully', async () => {
            const response = await request(app)
                .post('/setup')
                .send({
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Admin account created successfully! You can now log in.');

            // Verify user was created as admin
            const user = await new Promise((resolve) => {
                testDb.get('SELECT * FROM users WHERE email = ?', ['admin@example.com'], (err, row) => {
                    resolve(row);
                });
            });
            expect(user.is_admin).toBe(1);
        });

        it('should fail if setup already completed', async () => {
            await createTestUser();
            const response = await request(app)
                .post('/setup')
                .send({
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Setup already completed');
        });

        it('should handle database errors during setup check', async () => {
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                if (sql.includes('COUNT')) {
                    callback(new Error('Database error'));
                } else {
                    originalGet.call(testDb, sql, params, callback);
                }
            };

            const response = await request(app)
                .post('/setup')
                .send({
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Server error');

            // Restore original function
            testDb.get = originalGet;
        });

        it('should handle database errors during user creation', async () => {
            // Mock db.run to simulate error during insert
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                if (sql.includes('INSERT')) {
                    callback(new Error('Database error'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            const response = await request(app)
                .post('/setup')
                .send({
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Error creating admin user');

            // Restore original function
            testDb.run = originalRun;
        });
    });

    describe('POST /register', () => {
        // Add beforeEach and afterEach to handle console mocking
        let originalConsoleError;
        beforeEach(() => {
            originalConsoleError = console.error;
            console.error = jest.fn();
        });

        afterEach(() => {
            console.error = originalConsoleError;
        });

        it('should register a new user successfully', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    lastName: 'User',
                    email: 'new@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Registration successful! You can now log in.');
        });

        it('should fail with mismatched passwords', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    lastName: 'User',
                    email: 'new@example.com',
                    password: 'password123',
                    confirmPassword: 'different'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Passwords do not match');
        });

        it('should fail with short password', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    lastName: 'User',
                    email: 'new@example.com',
                    password: 'short',
                    confirmPassword: 'short'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Password must be at least 8 characters long');
        });

        it('should fail with invalid email format', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    lastName: 'User',
                    email: 'invalid-email',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Invalid email format');
        });

        it('should fail with missing fields', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    // missing lastName
                    email: 'new@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'All fields are required');
        });

        it('should handle database errors during registration', async () => {
            // Mock db.run to simulate error during insert
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                if (sql.includes('INSERT')) {
                    callback(new Error('Database error'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'New',
                    lastName: 'User',
                    email: 'new@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Server error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.run = originalRun;
        });
    });

    describe('GET /logout', () => {
        it('should logout successfully', async () => {
            // First login
            const user = await createTestUser();
            const agent = request.agent(app);

            await agent
                .post('/login')
                .send({
                    email: user.email,
                    password: 'password123'
                });

            // Then logout
            const response = await agent.get('/logout');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/login');
        });

        it('should handle logout errors', async () => {
            // First login
            const user = await createTestUser();
            const agent = request.agent(app);

            await agent
                .post('/login')
                .send({
                    email: user.email,
                    password: 'password123'
                });

            // Save original stack
            const oldStack = app._router.stack;

            // Create a new router with error-throwing logout
            const express = require('express');
            const router = express.Router();

            // Add error-throwing logout route
            router.get('/logout', (req, res, next) => {
                next(new Error('Logout error'));
            });

            // Add error handling middleware
            router.use((err, req, res, next) => {
                res.status(500).json({ error: 'Server error' });
            });

            // Replace the existing routes
            app._router.stack = oldStack.filter(layer => !layer.handle || layer.handle.name !== 'router');
            app.use('/', router);

            const response = await agent.get('/logout');
            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Server error');

            // Restore original routes
            app._router.stack = oldStack;
        });
    });
});