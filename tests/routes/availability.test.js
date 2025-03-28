const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');
const configurePassport = require('../../config/passport');

describe('Availability Routes', () => {
    let app;
    let testUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();

        app = express();
        app.use(express.json());

        // Set up session and auth
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false
        }));
        app.use(passport.initialize());
        app.use(passport.session());
        configurePassport(passport, testDb);

        // Set up view engine
        app.set('view engine', 'ejs');
        app.set('views', 'views');
        app.engine('ejs', (path, data, cb) => {
            cb(null, JSON.stringify(data));
        });

        // Create test user and make them active
        testUser = await createTestUser();
        await new Promise((resolve, reject) => {
            testDb.run(
                'UPDATE users SET is_active = 1 WHERE id = ?',
                [testUser.id],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Set up auth for test routes
        app.use((req, res, next) => {
            req.isAuthenticated = () => true;
            req.user = testUser;
            next();
        });

        // Add routes
        const availabilityRoutes = require('../../routes/availability')(testDb);
        app.use('/availability', availabilityRoutes);
    });

    describe('GET /availability', () => {
        it('should return availability for this week when no offset specified', async () => {
            const response = await request(app)
                .get('/availability')
                .expect(200);

            const data = JSON.parse(response.text);
            expect(data.weekTitle).toBe('This Week');
            expect(data.weekOffset).toBe(0);
            expect(data.timeSlots).toHaveLength(4);
            expect(data.days).toHaveLength(7);
        });

        it('should return last week\'s availability with offset -1', async () => {
            const response = await request(app)
                .get('/availability?weekOffset=-1')
                .expect(200);

            const data = JSON.parse(response.text);
            expect(data.weekTitle).toBe('Last Week');
            expect(data.weekOffset).toBe(-1);
        });

        it('should limit week offset to valid range', async () => {
            const response = await request(app)
                .get('/availability?weekOffset=-2')
                .expect(200);

            const data = JSON.parse(response.text);
            expect(data.weekOffset).toBe(-1);
        });
    });

    describe('POST /availability/update', () => {
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
                .send({ availability })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Availability updated successfully');

            // Verify the data was saved
            const saved = await new Promise((resolve, reject) => {
                testDb.all(
                    'SELECT * FROM availability WHERE user_id = ? AND day_date = ? ORDER BY time_slot',
                    [testUser.id, '2024-01-01'],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows.map(row => ({
                            ...row,
                            is_available: row.is_available === 1
                        })));
                    }
                );
            });

            expect(saved).toHaveLength(2);
            expect(saved.find(s => s.time_slot === '8:00am').is_available).toBe(true);
            expect(saved.find(s => s.time_slot === '12:30pm').is_available).toBe(false);
        });

        it('should reject invalid availability data', async () => {
            const response = await request(app)
                .post('/availability/update')
                .send({ availability: [{ invalid: 'data' }] })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Invalid slot data');
        });

        it('should handle missing availability data', async () => {
            const response = await request(app)
                .post('/availability/update')
                .send({})
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Invalid availability data');
        });

        it('should store preferences along with availability', async () => {
            const availability = [
                {
                    date: '2024-01-01', // This is a Monday
                    time: '8:00am',
                    isAvailable: true
                }
            ];

            await request(app)
                .post('/availability/update')
                .send({ availability })
                .expect(200);

            // Verify preferences were saved
            const prefs = await new Promise((resolve, reject) => {
                testDb.get(
                    'SELECT preferences FROM user_preferences WHERE user_id = ?',
                    [testUser.id],
                    (err, row) => err ? reject(err) : resolve(row)
                );
            });

            const savedPrefs = JSON.parse(prefs.preferences);
            expect(savedPrefs[0]).toEqual({
                dayOfWeek: 1, // Monday
                time: '8:00am',
                isAvailable: true
            });
        });
    });

    describe('Authentication', () => {
        it('should redirect unauthenticated users to login', async () => {
            // Create new app without auth
            const noAuthApp = express();
            noAuthApp.use(express.json());

            // Mock isAuthenticated to return false
            noAuthApp.use((req, res, next) => {
                req.isAuthenticated = () => false;
                next();
            });

            const availabilityRoutes = require('../../routes/availability')(testDb);
            noAuthApp.use('/availability', availabilityRoutes);

            const response = await request(noAuthApp)
                .get('/availability')
                .expect(302);  // Expect redirect

            expect(response.header.location).toBe('/login');
        });

        it('should redirect inactive users to /inactive', async () => {
            // Create new app with inactive user
            const inactiveApp = express();
            inactiveApp.use(express.json());

            // Mock authenticated but inactive user
            inactiveApp.use((req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = { ...testUser, is_active: false };
                next();
            });

            const availabilityRoutes = require('../../routes/availability')(testDb);
            inactiveApp.use('/availability', availabilityRoutes);

            const response = await request(inactiveApp)
                .get('/availability')
                .expect(302);  // Expect redirect

            expect(response.header.location).toBe('/inactive');
        });
    });
});