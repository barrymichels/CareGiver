const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { testDb, initializeTestDb } = require('../../../config/test.db');
const { createTestUser, clearTestDb } = require('../../helpers/testHelpers');
const timeslotRoutes = require('../../../routes/admin/timeslots');
const { isAuthenticated, isAdmin } = require('../../../middleware/auth');

describe('Admin Timeslot Routes', () => {
    let app;
    let adminUser;
    let regularUser;
    let agent;

    beforeAll(async () => {
        await initializeTestDb();
        
        // Create test users FIRST
        adminUser = await createTestUser({
            email: 'admin@test.com',
            is_admin: 1,
            is_active: 1
        });
        
        regularUser = await createTestUser({
            email: 'user@test.com',
            is_admin: 0,
            is_active: 1
        });
        
        // Create Express app
        app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        
        // Session middleware
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { secure: false }
        }));

        // Mock authentication middleware
        app.use((req, res, next) => {
            req.user = adminUser;
            req.isAuthenticated = () => true;
            next();
        });

        // Mount timeslot routes
        app.use('/admin/timeslots', timeslotRoutes(testDb));

        agent = request.agent(app);
    });

    afterAll(async () => {
        await clearTestDb();
    });

    beforeEach(async () => {
        // Clear timeslot data before each test
        await new Promise((resolve, reject) => {
            testDb.run('DELETE FROM timeslots', (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
            testDb.run('DELETE FROM timeslot_configurations', (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
            testDb.run('DELETE FROM template_slots', (err) => {
                if (err) reject(err);
                resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
            testDb.run('DELETE FROM timeslot_templates', (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    });

    describe('GET /admin/timeslots', () => {
        it('should render timeslot configuration page', async () => {
            // Set up view engine
            app.set('view engine', 'ejs');
            app.engine('ejs', (path, data, cb) => {
                cb(null, 'rendered');
            });

            const response = await agent
                .get('/admin/timeslots')
                .expect(200);

            expect(response.text).toBe('rendered');
        });

        it('should handle week offset parameter', async () => {
            // Set up view engine
            app.set('view engine', 'ejs');
            app.engine('ejs', (path, data, cb) => {
                cb(null, 'rendered');
            });

            const response = await agent
                .get('/admin/timeslots')
                .query({ weekOffset: 2 })
                .expect(200);

            expect(response.text).toBe('rendered');
        });

        it('should limit week offset to reasonable range', async () => {
            // Set up view engine to capture render data
            let renderData;
            app.set('view engine', 'ejs');
            app.engine('ejs', (path, data, cb) => {
                renderData = data;
                cb(null, 'rendered');
            });

            // Test with extreme offset that should be limited
            const response = await agent
                .get('/admin/timeslots')
                .query({ weekOffset: 50 }) // Should be limited to 8
                .expect(200);

            expect(response.text).toBe('rendered');
            expect(renderData.weekOffset).toBe(8); // Should be limited
        });
    });

    describe('POST /admin/timeslots', () => {
        it('should create new timeslot configuration', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14); // 2 weeks in future
            const weekStart = futureDate.toISOString().split('T')[0];

            const slots = [
                {
                    day_of_week: 0,
                    time: '8:00am',
                    label: 'Morning',
                    slot_order: 0
                },
                {
                    day_of_week: 0,
                    time: '2:00pm',
                    label: 'Afternoon',
                    slot_order: 1
                }
            ];

            const response = await agent
                .post('/admin/timeslots')
                .send({ weekStart, slots });

            if (response.status !== 200) {
                console.error('Response status:', response.status);
                console.error('Response body:', response.body);
                console.error('Response text:', response.text);
            }
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Timeslot configuration created successfully');
            expect(response.body.data).toHaveProperty('config');
            expect(response.body.data).toHaveProperty('timeslots');
        });

        it('should reject invalid week start date', async () => {
            const response = await agent
                .post('/admin/timeslots')
                .send({ 
                    weekStart: 'invalid-date',
                    slots: []
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Invalid week start date');
        });

        it('should reject creation for past weeks', async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 14); // 2 weeks ago
            const weekStart = pastDate.toISOString().split('T')[0];

            const response = await agent
                .post('/admin/timeslots')
                .send({ 
                    weekStart,
                    slots: [{ day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 }]
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Cannot modify past weeks');
        });

        it('should validate slot data format', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = futureDate.toISOString().split('T')[0];

            const response = await agent
                .post('/admin/timeslots')
                .send({ 
                    weekStart,
                    slots: [{ 
                        day_of_week: 'invalid',
                        time: 'invalid-time',
                        label: '',
                        slot_order: -1
                    }]
                })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should detect duplicate time slots', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = futureDate.toISOString().split('T')[0];

            const slots = [
                {
                    day_of_week: 0,
                    time: '8:00am',
                    label: 'Morning 1',
                    slot_order: 0
                },
                {
                    day_of_week: 0,
                    time: '8:00am',
                    label: 'Morning 2',
                    slot_order: 1
                }
            ];

            const response = await agent
                .post('/admin/timeslots')
                .send({ weekStart, slots })
                .expect(400);

            expect(response.body.error).toContain('Duplicate time slot');
        });
    });

    describe('PUT /admin/timeslots/:id', () => {
        let configId;

        beforeEach(async () => {
            // Create a test configuration
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = futureDate.toISOString().split('T')[0];

            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_configurations (week_start, created_by) VALUES (?, ?)',
                    [weekStart, adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            configId = result.lastID;
        });

        it('should update existing timeslot configuration', async () => {
            const slots = [
                {
                    day_of_week: 1,
                    time: '9:00am',
                    label: 'Updated Morning',
                    slot_order: 0
                }
            ];

            const response = await agent
                .put(`/admin/timeslots/${configId}`)
                .send({ slots })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Timeslot configuration updated successfully');
        });

        it('should reject update for non-existent configuration', async () => {
            const response = await agent
                .put('/admin/timeslots/99999')
                .send({ 
                    slots: [{ day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 }]
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Configuration not found');
        });
    });

    describe('POST /admin/timeslots/copy', () => {
        beforeEach(async () => {
            // Create a source configuration
            const sourceDate = new Date();
            sourceDate.setDate(sourceDate.getDate() + 7); // 1 week in future
            const sourceWeekStart = sourceDate.toISOString().split('T')[0];

            const configResult = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_configurations (week_start, created_by) VALUES (?, ?)',
                    [sourceWeekStart, adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });

            // Add timeslots to source
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslots (config_id, day_of_week, time, label, slot_order) VALUES (?, ?, ?, ?, ?)',
                    [configResult.lastID, 0, '8:00am', 'Morning', 0],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });
        });

        it('should copy timeslots from previous week', async () => {
            const sourceDate = new Date();
            sourceDate.setDate(sourceDate.getDate() + 7);
            const sourceWeekStart = sourceDate.toISOString().split('T')[0];

            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + 14);
            const targetWeekStart = targetDate.toISOString().split('T')[0];

            const response = await agent
                .post('/admin/timeslots/copy')
                .send({ 
                    targetWeekStart,
                    sourceWeekStart
                })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Timeslots copied successfully');
        });

        it('should reject copying to past weeks', async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 7);
            const targetWeekStart = pastDate.toISOString().split('T')[0];

            const sourceDate = new Date();
            sourceDate.setDate(sourceDate.getDate() + 7);
            const sourceWeekStart = sourceDate.toISOString().split('T')[0];

            const response = await agent
                .post('/admin/timeslots/copy')
                .send({ 
                    targetWeekStart,
                    sourceWeekStart
                })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Cannot modify past weeks');
        });
    });

    describe('GET /admin/timeslots/check-conflicts/:weekStart', () => {
        it('should check for conflicts in given week', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = futureDate.toISOString().split('T')[0];

            const response = await agent
                .get(`/admin/timeslots/check-conflicts/${weekStart}`)
                .expect(200);

            expect(response.body).toHaveProperty('hasConflicts');
            expect(response.body).toHaveProperty('availability');
            expect(response.body).toHaveProperty('assignments');
        });

        it('should reject invalid week start date', async () => {
            const response = await agent
                .get('/admin/timeslots/check-conflicts/invalid-date')
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Invalid week start date');
        });
    });

    describe('DELETE /admin/timeslots/:id', () => {
        let configId;

        beforeEach(async () => {
            // Create a test configuration in the future
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = futureDate.toISOString().split('T')[0];

            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_configurations (week_start, created_by) VALUES (?, ?)',
                    [weekStart, adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            configId = result.lastID;
        });

        it('should delete timeslot configuration', async () => {
            const response = await agent
                .delete(`/admin/timeslots/${configId}`)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Timeslot configuration deleted successfully');
        });

        it('should reject deletion of non-existent configuration', async () => {
            const response = await agent
                .delete('/admin/timeslots/99999')
                .expect(404);

            expect(response.body).toHaveProperty('error', 'Configuration not found');
        });

        it('should reject deletion of past week configurations', async () => {
            // Create a past week configuration
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 14);
            const weekStart = pastDate.toISOString().split('T')[0];

            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_configurations (week_start, created_by) VALUES (?, ?)',
                    [weekStart, adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });

            const response = await agent
                .delete(`/admin/timeslots/${result.lastID}`)
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Cannot delete past week configurations');
        });
    });
});