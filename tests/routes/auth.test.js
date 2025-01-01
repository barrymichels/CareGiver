const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');

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
        return fullPath.split('/').pop().replace('.ejs', '');
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
    });

    describe('POST /register', () => {
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

        it('should fail with duplicate email', async () => {
            // Create initial user
            await createTestUser();

            // Try to register with same email
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'Another',
                    lastName: 'User',
                    email: 'test@example.com',
                    password: 'password123',
                    confirmPassword: 'password123'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Email already registered');
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
    });
}); 