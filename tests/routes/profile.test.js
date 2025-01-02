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

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
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
    });
}); 