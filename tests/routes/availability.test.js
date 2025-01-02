const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, createAvailability, getAvailability, getPreferences } = require('../helpers/testHelpers');

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
    let availabilityRouter;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        testUser = await createTestUser();
        
        // Create fresh instances for each test
        mockAuth = (req, res, next) => {
            req.isAuthenticated = () => true;
            req.user = { id: testUser.id, is_active: true };
            next();
        };

        // Create a fresh router instance
        availabilityRouter = require('../../routes/availability')(testDb);
        
        // Reset the app routes
        app._router.stack = app._router.stack.filter(layer => !layer.route || layer.route.path !== '/availability');
        app.use('/availability', mockAuth, availabilityRouter);
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
        it('should handle invalid input data', async () => {
            const availability = [
                {
                    date: null,
                    time: '8:00am',
                    isAvailable: true
                }
            ];

            const response = await request(app)
                .post('/availability/update')
                .send({ availability });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Invalid slot data');

            // Verify no records were created
            const updated = await getAvailability(testUser.id);
            expect(updated).toHaveLength(0);
        });

        it('should update availability successfully', async () => {
            const availability = [
                {
                    date: '2024-01-01',
                    time: '8:00am',
                    isAvailable: true
                },
                {
                    date: '2024-01-01',
                    time: '12:30pm',
                    isAvailable: false
                }
            ];

            const response = await request(app)
                .post('/availability/update')
                .send({ availability });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Availability updated successfully');

            // Wait for SQLite to finish writing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify the updates in the database
            const updated = await getAvailability(testUser.id);
            expect(updated).toHaveLength(2);
            expect(updated[0]).toMatchObject({
                user_id: testUser.id,
                day_date: '2024-01-01',
                time_slot: '8:00am',
                is_available: true
            });
            expect(updated[1]).toMatchObject({
                user_id: testUser.id,
                day_date: '2024-01-01',
                time_slot: '12:30pm',
                is_available: false
            });

            // Verify preferences were stored
            const prefs = await getPreferences(testUser.id);
            expect(prefs).toBeTruthy();
            const parsedPrefs = JSON.parse(prefs.preferences);
            expect(parsedPrefs).toHaveLength(2);
            expect(parsedPrefs[0]).toMatchObject({
                dayOfWeek: 1, // Monday
                time: '8:00am',
                isAvailable: true
            });
        });

        it('should update existing availability', async () => {
            // First create some availability
            await createAvailability(testUser.id, [
                {
                    date: '2024-01-01',
                    time: '8:00am',
                    isAvailable: true
                }
            ]);

            // Then update it
            const availability = [
                {
                    date: '2024-01-01',
                    time: '8:00am',
                    isAvailable: false
                }
            ];

            const response = await request(app)
                .post('/availability/update')
                .send({ availability });

            expect(response.status).toBe(200);

            // Wait for SQLite to finish writing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify the update
            const updated = await getAvailability(testUser.id);
            expect(updated).toHaveLength(1);
            expect(updated[0].is_available).toBe(false);
        });

        it('should store user preferences', async () => {
            const availability = [
                {
                    date: '2024-01-01',
                    time: '8:00am',
                    isAvailable: true
                }
            ];

            await request(app)
                .post('/availability/update')
                .send({ availability });

            // Wait for SQLite to finish writing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify preferences were stored
            const prefs = await getPreferences(testUser.id);
            expect(prefs).toBeTruthy();
            const parsedPrefs = JSON.parse(prefs.preferences);
            expect(parsedPrefs[0]).toMatchObject({
                dayOfWeek: 1, // Monday (1-7 for Mon-Sun)
                time: '8:00am',
                isAvailable: true
            });
        });
    });
}); 