const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, createAvailability } = require('../helpers/testHelpers');

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

// Set views directory
app.set('views', path.join(__dirname, '../../views'));

app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Import admin routes
const adminRoutes = require('../../routes/admin')(testDb);

describe('Admin Routes', () => {
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
        app._router.stack = app._router.stack.filter(layer => !layer.route || !layer.route.path.startsWith('/admin'));
        app.use('/admin', mockAuth, adminRoutes);
    });

    describe('GET /admin', () => {
        it('should render admin dashboard with data', async () => {
            // Create some availability data
            await createAvailability(regularUser.id, [
                {
                    date: new Date().toISOString().split('T')[0],
                    time: '9:00am',
                    isAvailable: true
                }
            ]);

            const response = await request(app)
                .get('/admin')
                .expect('Content-Type', /html/)
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toContain('admin');
            expect(rendered.data).toHaveProperty('users');
            expect(rendered.data).toHaveProperty('availability');
            expect(rendered.data).toHaveProperty('assignments');
            expect(rendered.data).toHaveProperty('nextWeekStart');
        });

        it('should only show active users', async () => {
            // Create an inactive user
            await createTestUser({
                email: 'inactive@example.com',
                is_active: 0
            });

            const response = await request(app)
                .get('/admin')
                .expect(200);

            const rendered = JSON.parse(response.text);
            const users = rendered.data.users;
            
            // Should only include active users (admin and regular user)
            expect(users.length).toBe(2);
            expect(users.some(u => u.id === adminUser.id)).toBe(true);
            expect(users.some(u => u.id === regularUser.id)).toBe(true);
        });
    });

    describe('GET /admin/users', () => {
        it('should render user management page with all users', async () => {
            const response = await request(app)
                .get('/admin/users')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.view).toContain('admin/users');
            expect(rendered.data).toHaveProperty('users');
            expect(rendered.data.users).toHaveLength(2); // admin and regular user
            
            const users = rendered.data.users;
            expect(users[0]).toHaveProperty('email');
            expect(users[0]).toHaveProperty('is_admin');
            expect(users[0]).toHaveProperty('is_active');
        });
    });

    describe('POST /admin/assign', () => {
        it('should update assignments successfully', async () => {
            const assignments = [
                {
                    userId: regularUser.id,
                    date: '2024-01-01',
                    time: '9:00am'
                }
            ];

            const response = await request(app)
                .post('/admin/assign')
                .send({ assignments })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Assignments updated successfully');

            // Verify assignment in database
            const result = await new Promise((resolve) => {
                testDb.get(
                    'SELECT * FROM assignments WHERE user_id = ? AND day_date = ? AND time_slot = ?',
                    [regularUser.id, '2024-01-01', '9:00am'],
                    (err, row) => resolve(row)
                );
            });

            expect(result).toBeTruthy();
            expect(result.user_id).toBe(regularUser.id);
            expect(result.assigned_by).toBe(adminUser.id);
        });

        it('should handle invalid assignment data', async () => {
            const assignments = [
                {
                    userId: null, // Invalid user ID
                    date: '2024-01-01',
                    time: '9:00am'
                }
            ];

            const response = await request(app)
                .post('/admin/assign')
                .send({ assignments })
                .expect(500);

            expect(response.body).toHaveProperty('error', 'Server error');

            // Verify no assignments were created
            const result = await new Promise((resolve) => {
                testDb.get(
                    'SELECT COUNT(*) as count FROM assignments',
                    [],
                    (err, row) => resolve(row)
                );
            });

            expect(result.count).toBe(0);
        });

        it('should update existing assignment', async () => {
            // Create initial assignment
            await new Promise((resolve) => {
                testDb.run(
                    'INSERT INTO assignments (user_id, day_date, time_slot, assigned_by) VALUES (?, ?, ?, ?)',
                    [regularUser.id, '2024-01-01', '9:00am', adminUser.id],
                    resolve
                );
            });

            // Update the assignment
            const assignments = [
                {
                    userId: adminUser.id, // Change assignment to admin user
                    date: '2024-01-01',
                    time: '9:00am'
                }
            ];

            await request(app)
                .post('/admin/assign')
                .send({ assignments })
                .expect(200);

            // Verify assignment was updated
            const result = await new Promise((resolve) => {
                testDb.get(
                    'SELECT * FROM assignments WHERE day_date = ? AND time_slot = ?',
                    ['2024-01-01', '9:00am'],
                    (err, row) => resolve(row)
                );
            });

            expect(result.user_id).toBe(adminUser.id);
        });
    });
}); 