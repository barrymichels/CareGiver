const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, normalizeViewPath } = require('../helpers/testHelpers');

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

// Import users routes
const userRoutes = require('../../routes/users')(testDb);

describe('User Routes', () => {
    let adminUser;
    let regularUser;
    let mockAuth;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();

        // Create an admin user
        adminUser = await createTestUser({
            email: 'admin@example.com',
            is_admin: 1
        });

        // Create a regular user
        regularUser = await createTestUser({
            email: 'user@example.com',
            is_admin: 0
        });

        // Create fresh instances for each test
        mockAuth = (req, res, next) => {
            req.isAuthenticated = () => true;
            req.user = {
                id: adminUser.id,
                is_active: true,
                is_admin: true
            };
            next();
        };

        // Reset the app routes
        app._router.stack = app._router.stack.filter(layer => !layer.route || !layer.route.path.startsWith('/users'));
        app.use('/users', mockAuth, userRoutes);
    });

    describe('GET /users/manage', () => {
        it('should render user management page with all users except current user', async () => {
            const response = await request(app)
                .get('/users/manage')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(normalizeViewPath(rendered.view)).toContain('users/manage');
            expect(rendered.data).toHaveProperty('users');

            // Should only show the regular user (not the admin user)
            expect(rendered.data.users).toHaveLength(1);
            expect(rendered.data.users[0].id).toBe(regularUser.id);

            const user = rendered.data.users[0];
            expect(user).toHaveProperty('email');
            expect(user).toHaveProperty('is_admin');
            expect(user).toHaveProperty('is_active');
            expect(user).toHaveProperty('created_at');
        });

        it('should sort users by active status and creation date', async () => {
            // Create additional users with different statuses
            const inactiveUser = await createTestUser({
                email: 'inactive@example.com',
                is_active: 0
            });

            const newActiveUser = await createTestUser({
                email: 'newactive@example.com',
                is_active: 1
            });

            const response = await request(app)
                .get('/users/manage')
                .expect(200);

            const rendered = JSON.parse(response.text);
            const users = rendered.data.users;

            // Should be sorted by is_active DESC, created_at DESC
            expect(users[0].is_active).toBe(1); // Active users first
            expect(users[users.length - 1].is_active).toBe(0); // Inactive users last
        });
    });

    describe('POST /users/update/:id', () => {
        it('should update user status successfully', async () => {
            const response = await request(app)
                .post(`/users/update/${regularUser.id}`)
                .send({
                    is_active: false,
                    is_admin: true
                })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'User updated successfully');

            // Verify changes in database
            const updatedUser = await new Promise((resolve) => {
                testDb.get('SELECT * FROM users WHERE id = ?', [regularUser.id], (err, row) => resolve(row));
            });

            expect(updatedUser.is_active).toBe(0);
            expect(updatedUser.is_admin).toBe(1);
        });

        it('should prevent modifying own account', async () => {
            const response = await request(app)
                .post(`/users/update/${adminUser.id}`)
                .send({
                    is_active: false,
                    is_admin: false
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Cannot modify your own account');

            // Verify no changes were made
            const unchangedUser = await new Promise((resolve) => {
                testDb.get('SELECT * FROM users WHERE id = ?', [adminUser.id], (err, row) => resolve(row));
            });

            expect(unchangedUser.is_active).toBe(1);
            expect(unchangedUser.is_admin).toBe(1);
        });

        it('should handle non-existent user', async () => {
            const response = await request(app)
                .post('/users/update/99999')
                .send({
                    is_active: true,
                    is_admin: false
                })
                .expect(200); // SQLite doesn't error on non-existent IDs for updates

            // The update should succeed but affect 0 rows
            const result = await new Promise((resolve) => {
                testDb.get('SELECT * FROM users WHERE id = ?', [99999], (err, row) => resolve(row));
            });

            expect(result).toBeUndefined();
        });
    });
});