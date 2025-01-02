const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, createAvailability, getAvailability } = require('../helpers/testHelpers');

// Create express app for testing
const app = express();

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

// Import availability routes
const availabilityRoutes = require('../../routes/availability')(testDb);

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
});

describe('Availability Routes', () => {
    let testUser;
    let mockAuth;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        testUser = await createTestUser();
        mockAuth = createMockAuth(testUser.id);
        // Update the route with the new mock auth
        app._router.stack = app._router.stack.filter(layer => !layer.route || layer.route.path !== '/availability');
        app.use('/availability', mockAuth, availabilityRoutes);
    });

    describe('GET /availability', () => {
        it('should return user availability', async () => {
            await createAvailability(testUser.id, [
                {
                    date: '2024-01-01',
                    time: '8:00am',
                    isAvailable: true
                }
            ]);

            const response = await request(app)
                .get('/availability');

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body[0]).toMatchObject({
                user_id: testUser.id,
                day_date: '2024-01-01',
                time_slot: '8:00am',
                is_available: true
            });
        });

        it('should return empty array when no availability exists', async () => {
            const response = await request(app)
                .get('/availability');

            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });
    });

    describe('POST /availability/update', () => {
        it('should handle transaction rollback on error', async () => {
            const availability = [
                {
                    date: null, // This should cause an error
                    time: '8:00am',
                    isAvailable: true
                }
            ];

            const response = await request(app)
                .post('/availability/update')
                .send({ availability });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error', 'Server error');

            // Verify no records were created
            const updated = await getAvailability(testUser.id);
            expect(updated).toHaveLength(0);
        });
    });
}); 