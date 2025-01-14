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

    describe('POST /forgot-password', () => {
        it('should handle non-existent email', async () => {
            const mockDb = {
                get: (query, params, callback) => {
                    if (query.includes('SELECT * FROM users WHERE email = ?')) {
                        callback(null, null);
                    } else {
                        callback(null, {});
                    }
                }
            };

            const mockApp = express();
            mockApp.use(express.json());
            mockApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            
            const authRoutes = require('../../routes/auth')(mockDb);
            mockApp.use('/', authRoutes);

            const response = await request(mockApp)
                .post('/forgot-password')
                .send({
                    email: 'nonexistent@example.com'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'No account found with that email address');
        });

        it('should handle email sending error', async () => {
            // Mock nodemailer to throw error
            const mockSendMail = jest.fn().mockRejectedValue(new Error('SMTP error'));
            nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });

            // Mock database to return a user and handle token update
            const mockDb = {
                get: (query, params, callback) => {
                    if (query.includes('SELECT * FROM users WHERE email = ?')) {
                        callback(null, { ...testUser, email: params[0] });
                    }
                },
                run: (query, params, callback) => callback(null)
            };

            const mockApp = express();
            mockApp.use(express.json());
            mockApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            
            const authRoutes = require('../../routes/auth')(mockDb);
            mockApp.use('/', authRoutes);

            const response = await request(mockApp)
                .post('/forgot-password')
                .send({
                    email: testUser.email
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Error sending password reset email');
            expect(mockSendMail).toHaveBeenCalled();
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

        it('should handle actual database error', async () => {
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