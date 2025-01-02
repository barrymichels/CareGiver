const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, getUserById } = require('../helpers/testHelpers');
const bcrypt = require('bcrypt');

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
        it('should render profile page with user data', async () => {
            const response = await request(app)
                .get('/profile')
                .expect('Content-Type', /html/)
                .expect(200);

            // Check that response contains user data
            expect(response.text).toContain(testUser.first_name);
            expect(response.text).toContain(testUser.last_name);
            expect(response.text).toContain(testUser.email);
        });

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
    });
}); 