const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');

// Create express app for testing
const app = express();

// Mock view engine for testing
app.set('view engine', 'ejs');
app.engine('ejs', (path, data, cb) => {
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
app.use(passport.initialize());
app.use(passport.session());

// Configure Passport local strategy
const LocalStrategy = require('passport-local').Strategy;
passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
        try {
            const user = await new Promise((resolve, reject) => {
                testDb.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (!user) {
                return done(null, false);
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return done(null, false);
            }

            if (!user.is_active) {
                return done(new Error('Account not activated'));
            }

            return done(null, user);
        } catch (error) {
            return done(error);
        }
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

// Mock nodemailer
jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' })
    })
}));

// Import auth routes
const authRoutes = require('../../routes/auth')(testDb);
app.use('/', authRoutes);

describe('Auth Routes', () => {
    let activeUser;
    let inactiveUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        
        // Create test users
        activeUser = await createTestUser({
            email: 'active@example.com',
            is_active: 1
        });

        inactiveUser = await createTestUser({
            email: 'inactive@example.com',
            is_active: 0
        });
    });

    describe('GET /login', () => {
        it('should render login page when users exist', async () => {
            const response = await request(app)
                .get('/login')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toContain('login');
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
            const response = await request(app)
                .post('/login')
                .send({
                    email: 'active@example.com',
                    password: 'password123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('redirect', '/');
        });

        it('should reject inactive user', async () => {
            const response = await request(app)
                .post('/login')
                .send({
                    email: 'inactive@example.com',
                    password: 'password123'
                })
                .expect(403);

            expect(response.body).toHaveProperty('error', 'Account not activated');
        });

        it('should reject invalid credentials', async () => {
            const response = await request(app)
                .post('/login')
                .send({
                    email: 'active@example.com',
                    password: 'wrongpassword'
                })
                .expect(401);

            expect(response.body).toHaveProperty('message', 'Invalid email or password');
        });
    });

    describe('POST /register', () => {
        const validUser = {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            password: 'password123',
            confirmPassword: 'password123'
        };

        it('should register new user successfully', async () => {
            const response = await request(app)
                .post('/register')
                .send(validUser)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Registration successful! You can now log in.');
        });

        it('should reject duplicate email', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    ...validUser,
                    email: 'active@example.com'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Email already registered');
        });

        it('should validate required fields', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    firstName: 'John'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'All fields are required');
        });

        it('should validate password match', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    ...validUser,
                    confirmPassword: 'different'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Passwords do not match');
        });

        it('should validate password length', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    ...validUser,
                    password: 'short',
                    confirmPassword: 'short'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Password must be at least 8 characters long');
        });

        it('should validate email format', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    ...validUser,
                    email: 'invalid-email'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Invalid email format');
        });
    });

    describe('GET /setup', () => {
        it('should render setup page when no users exist', async () => {
            await clearTestDb();
            
            const response = await request(app)
                .get('/setup')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toContain('setup');
        });

        it('should redirect to login when users exist', async () => {
            const response = await request(app)
                .get('/setup')
                .expect(302);

            expect(response.header.location).toBe('/login');
        });
    });

    describe('POST /setup', () => {
        const setupData = {
            firstName: 'Admin',
            lastName: 'User',
            email: 'admin@example.com',
            password: 'adminpass123',
            confirmPassword: 'adminpass123'
        };

        it('should create admin user when no users exist', async () => {
            await clearTestDb();
            
            const response = await request(app)
                .post('/setup')
                .send(setupData)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Admin account created successfully! You can now log in.');
        });

        it('should reject setup when users exist', async () => {
            const response = await request(app)
                .post('/setup')
                .send(setupData)
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Setup already completed');
        });
    });

    describe('POST /forgot-password', () => {
        it('should handle forgot password request for existing user', async () => {
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: 'active@example.com' })
                .expect(200);

            expect(response.body).toHaveProperty('message');
        });

        it('should handle forgot password request for non-existent user', async () => {
            const response = await request(app)
                .post('/forgot-password')
                .send({ email: 'nonexistent@example.com' })
                .expect(200);

            expect(response.body).toHaveProperty('message');
        });
    });

    describe('GET /reset-password/:token', () => {
        it('should render reset password page for valid token', async () => {
            // First create a reset token
            const token = 'valid-token';
            const expiry = Date.now() + 3600000;

            await new Promise((resolve) => {
                testDb.run(
                    'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
                    [token, expiry, activeUser.id],
                    resolve
                );
            });

            const response = await request(app)
                .get(`/reset-password/${token}`)
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toContain('reset-password');
        });

        it('should render error page for invalid token', async () => {
            const response = await request(app)
                .get('/reset-password/invalid-token')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toContain('reset-password-error');
        });
    });

    describe('POST /reset-password/:token', () => {
        let validToken;
        let validUser;

        beforeEach(async () => {
            validToken = 'valid-reset-token';
            const tokenExpiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
            validUser = await createTestUser({
                email: 'reset@example.com',
                reset_token: validToken,
                reset_token_expires: tokenExpiry
            });
        });

        it('should reset password with valid token', async () => {
            const response = await request(app)
                .post(`/reset-password/${validToken}`)
                .send({
                    password: 'newpassword123',
                    confirmPassword: 'newpassword123'
                })
                .expect(200);

            expect(response.body).toHaveProperty('message');
        });

        it('should reject invalid token', async () => {
            const response = await request(app)
                .post('/reset-password/invalid-token')
                .send({
                    password: 'newpassword123',
                    confirmPassword: 'newpassword123'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should validate password length', async () => {
            const response = await request(app)
                .post(`/reset-password/${validToken}`)
                .send({
                    password: 'short',
                    confirmPassword: 'short'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Password must be at least 8 characters long');
        });

        it('should validate password match', async () => {
            const response = await request(app)
                .post(`/reset-password/${validToken}`)
                .send({
                    password: 'newpassword123',
                    confirmPassword: 'different'
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Passwords do not match');
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
});