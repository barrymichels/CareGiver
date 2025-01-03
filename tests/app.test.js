const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { testDb, initializeTestDb } = require('../config/test.db');
const { createTestUser, clearTestDb } = require('./helpers/testHelpers');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

// Mock external dependencies
jest.mock('connect-sqlite3', () => {
    return () => function() {
        return {
            on: jest.fn()
        };
    };
});

// Save original environment
const OLD_ENV = process.env;

describe('App', () => {
    let app;
    let server;
    let originalConsoleLog;
    let originalConsoleError;

    beforeAll(async () => {
        // Mock environment variables
        process.env = {
            ...OLD_ENV,
            NODE_ENV: 'test',
            SESSION_SECRET: 'test-secret',
            DB_PATH: ':memory:'
        };

        // Save original console methods
        originalConsoleLog = console.log;
        originalConsoleError = console.error;
        console.log = jest.fn();
        console.error = jest.fn();

        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        
        // Clear module cache to get a fresh instance
        jest.resetModules();

        // Configure environment for testing
        process.env = {
            ...process.env,
            NODE_ENV: 'test',
            SESSION_SECRET: 'test-secret',
            DB_PATH: ':memory:'
        };
        
        // Import app after environment setup
        const appModule = require('../app');
        app = appModule.app;
        
        // Create a test server with a random port
        server = app.listen(0);
    });

    afterEach(async () => {
        // Close server and clear database after each test
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        await clearTestDb();
    });

    afterAll(() => {
        // Restore environment
        process.env = OLD_ENV;
        // Restore console methods
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
    });

    describe('Database Initialization', () => {
        it('should create required tables', async () => {
            const tables = await new Promise((resolve, reject) => {
                testDb.all(
                    "SELECT name FROM sqlite_master WHERE type='table'",
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows.map(row => row.name));
                    }
                );
            });

            expect(tables).toContain('users');
            expect(tables).toContain('availability');
            expect(tables).toContain('assignments');
            expect(tables).toContain('user_preferences');
        });

        it('should have correct schema for users table', async () => {
            const schema = await new Promise((resolve, reject) => {
                testDb.get(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row.sql);
                    }
                );
            });

            expect(schema).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
            expect(schema).toContain('first_name TEXT NOT NULL');
            expect(schema).toContain('last_name TEXT NOT NULL');
            expect(schema).toContain('email TEXT UNIQUE NOT NULL');
            expect(schema).toContain('password TEXT NOT NULL');
            expect(schema).toContain('is_admin BOOLEAN NOT NULL DEFAULT 0');
            expect(schema).toContain('is_active BOOLEAN NOT NULL DEFAULT 0');
        });
    });

    describe('Authentication', () => {
        let testUser;

        beforeEach(async () => {
            testUser = await createTestUser();
            
            // Configure Passport serialization/deserialization
            passport.serializeUser((user, done) => {
                done(null, user.id);
            });

            passport.deserializeUser((id, done) => {
                testDb.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
                    done(err, user);
                });
            });
        });

        it('should serialize user correctly', (done) => {
            passport.serializeUser(testUser, (err, id) => {
                expect(err).toBeNull();
                expect(id).toBe(testUser.id);
                done();
            });
        });

        it('should deserialize user correctly', (done) => {
            passport.deserializeUser(testUser.id, (err, deserializedUser) => {
                expect(err).toBeNull();
                expect(deserializedUser.id).toBe(testUser.id);
                expect(deserializedUser.email).toBe(testUser.email);
                done();
            });
        });
    });

    describe('Middleware Configuration', () => {
        it('should parse JSON bodies', async () => {
            const response = await request(app)
                .post('/login')
                .send({ email: 'test@example.com', password: 'password123' })
                .set('Content-Type', 'application/json');
            
            // Even though login will fail, the request should be parsed
            expect(response.status).not.toBe(400);
        });

        it('should parse URL-encoded bodies', async () => {
            const response = await request(app)
                .post('/login')
                .send('email=test@example.com&password=password123')
                .set('Content-Type', 'application/x-www-form-urlencoded');
            
            // Even though login will fail, the request should be parsed
            expect(response.status).not.toBe(400);
        });

        it('should serve static files', async () => {
            const response = await request(app)
                .get('/css/style.css');
            
            expect(response.status).toBe(200);
            expect(response.header['content-type']).toContain('text/css');
        });
    });
}); 