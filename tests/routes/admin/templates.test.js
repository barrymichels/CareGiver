const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { testDb, initializeTestDb } = require('../../../config/test.db');
const { createTestUser, clearTestDb } = require('../../helpers/testHelpers');
const templateRoutes = require('../../../routes/admin/templates');

describe('Admin Template Routes', () => {
    let app;
    let adminUser;
    let agent;

    beforeAll(async () => {
        await initializeTestDb();
        
        // Create test user FIRST
        adminUser = await createTestUser({
            email: 'admin@test.com',
            is_admin: 1,
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

        // Mount template routes
        app.use('/admin/timeslot-templates', templateRoutes(testDb));

        agent = request.agent(app);
    });

    afterAll(async () => {
        await clearTestDb();
    });

    beforeEach(async () => {
        // Clear template data before each test
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

    describe('GET /admin/timeslot-templates', () => {
        beforeEach(async () => {
            // Create test templates
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['Standard Schedule', 'Basic 4-slot schedule', adminUser.id, 1],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['Extended Schedule', 'Extended 6-slot schedule', adminUser.id, 0],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });
        });

        it('should return all templates', async () => {
            const response = await agent
                .get('/admin/timeslot-templates')
                .expect(200);

            expect(response.body).toHaveLength(2);
            expect(response.body[0]).toHaveProperty('name', 'Standard Schedule');
            expect(response.body[0]).toHaveProperty('is_default', 1);
            expect(response.body[1]).toHaveProperty('name', 'Extended Schedule');
        });

        it('should order templates with default first', async () => {
            const response = await agent
                .get('/admin/timeslot-templates')
                .expect(200);

            expect(response.body[0].is_default).toBe(1);
            expect(response.body[1].is_default).toBe(0);
        });
    });

    describe('GET /admin/timeslot-templates/:id', () => {
        let templateId;

        beforeEach(async () => {
            // Create a test template
            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by) VALUES (?, ?, ?)',
                    ['Test Template', 'Test description', adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            templateId = result.lastID;

            // Add template slots
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order) VALUES (?, ?, ?, ?, ?)',
                    [templateId, 0, '8:00am', 'Morning', 0],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order) VALUES (?, ?, ?, ?, ?)',
                    [templateId, 0, '2:00pm', 'Afternoon', 1],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });
        });

        it('should return template with slots', async () => {
            const response = await agent
                .get(`/admin/timeslot-templates/${templateId}`)
                .expect(200);

            expect(response.body).toHaveProperty('template');
            expect(response.body).toHaveProperty('slots');
            expect(response.body.template).toHaveProperty('name', 'Test Template');
            expect(response.body.slots).toHaveProperty('0');
            expect(response.body.slots[0]).toHaveLength(2);
        });

        it('should return 404 for non-existent template', async () => {
            const response = await agent
                .get('/admin/timeslot-templates/99999')
                .expect(404);

            expect(response.body).toHaveProperty('error', 'Template not found');
        });
    });

    describe('POST /admin/timeslot-templates', () => {
        it('should create new template with slots', async () => {
            const templateData = {
                name: 'New Template',
                description: 'A new template',
                slots: [
                    {
                        day_of_week: 0,
                        time: '9:00am',
                        label: 'Morning',
                        slot_order: 0
                    },
                    {
                        day_of_week: 0,
                        time: '1:00pm',
                        label: 'Afternoon',
                        slot_order: 1
                    }
                ],
                isDefault: false
            };

            const response = await agent
                .post('/admin/timeslot-templates')
                .send(templateData)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Template created successfully');
            expect(response.body.data).toHaveProperty('name', 'New Template');
        });

        it('should set template as default when requested', async () => {
            // Create existing default template
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['Old Default', 'Old default template', adminUser.id, 1],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            const templateData = {
                name: 'New Default',
                description: 'New default template',
                slots: [
                    {
                        day_of_week: 0,
                        time: '10:00am',
                        label: 'Morning',
                        slot_order: 0
                    }
                ],
                isDefault: true
            };

            const response = await agent
                .post('/admin/timeslot-templates')
                .send(templateData)
                .expect(200);

            expect(response.body.data).toHaveProperty('is_default', true);

            // Verify old default is no longer default
            const oldDefault = await new Promise((resolve, reject) => {
                testDb.get(
                    'SELECT is_default FROM timeslot_templates WHERE name = ?',
                    ['Old Default'],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });
            expect(oldDefault.is_default).toBeFalsy();
        });

        it('should validate required fields', async () => {
            const response = await agent
                .post('/admin/timeslot-templates')
                .send({ name: '' })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should validate slot data', async () => {
            const templateData = {
                name: 'Invalid Template',
                description: 'Template with invalid slots',
                slots: [
                    {
                        day_of_week: 'invalid',
                        time: 'invalid-time',
                        label: '',
                        slot_order: -1
                    }
                ]
            };

            const response = await agent
                .post('/admin/timeslot-templates')
                .send(templateData)
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });
    });

    describe('PUT /admin/timeslot-templates/:id', () => {
        let templateId;

        beforeEach(async () => {
            // Create a test template
            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by) VALUES (?, ?, ?)',
                    ['Update Template', 'Template to update', adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            templateId = result.lastID;
        });

        it('should update template with new slots', async () => {
            const updateData = {
                name: 'Updated Template',
                description: 'Updated description',
                slots: [
                    {
                        day_of_week: 1,
                        time: '11:00am',
                        label: 'Updated Morning',
                        slot_order: 0
                    }
                ]
            };

            const response = await agent
                .put(`/admin/timeslot-templates/${templateId}`)
                .send(updateData)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Template updated successfully');
        });

        it('should return 404 for non-existent template', async () => {
            const response = await agent
                .put('/admin/timeslot-templates/99999')
                .send({ 
                    name: 'Test',
                    slots: [
                        {
                            day_of_week: 0,
                            time: '9:00am',
                            label: 'Morning',
                            slot_order: 0
                        }
                    ]
                })
                .expect(404);

            expect(response.body).toHaveProperty('error', 'Template not found');
        });
    });

    describe('POST /admin/timeslot-templates/:id/apply', () => {
        let templateId;

        beforeEach(async () => {
            // Create a test template
            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by) VALUES (?, ?, ?)',
                    ['Apply Template', 'Template to apply', adminUser.id],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            templateId = result.lastID;

            // Add template slots
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order) VALUES (?, ?, ?, ?, ?)',
                    [templateId, 0, '8:00am', 'Morning', 0],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });
        });

        it('should apply template to specified week', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = futureDate.toISOString().split('T')[0];

            const response = await agent
                .post(`/admin/timeslot-templates/${templateId}/apply`)
                .send({ weekStart })
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Template applied successfully');
        });

        it('should reject application to past weeks', async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 14);
            const weekStart = pastDate.toISOString().split('T')[0];

            const response = await agent
                .post(`/admin/timeslot-templates/${templateId}/apply`)
                .send({ weekStart })
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Cannot modify past weeks');
        });
    });

    describe('POST /admin/timeslot-templates/:id/set-default', () => {
        let templateId;

        beforeEach(async () => {
            // Create test templates
            const result1 = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['Current Default', 'Currently default template', adminUser.id, 1],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            const result2 = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['New Default', 'Template to make default', adminUser.id, 0],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            templateId = result2.lastID;
        });

        it('should set template as default', async () => {
            const response = await agent
                .post(`/admin/timeslot-templates/${templateId}/set-default`)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Default template updated successfully');

            // Verify new template is default
            const newDefault = await new Promise((resolve, reject) => {
                testDb.get(
                    'SELECT is_default FROM timeslot_templates WHERE id = ?',
                    [templateId],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });
            expect(newDefault.is_default).toBe(1);

            // Verify old default is no longer default
            const oldDefault = await new Promise((resolve, reject) => {
                testDb.get(
                    'SELECT is_default FROM timeslot_templates WHERE name = ?',
                    ['Current Default'],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });
            expect(oldDefault.is_default).toBeFalsy();
        });
    });

    describe('DELETE /admin/timeslot-templates/:id', () => {
        let templateId;

        beforeEach(async () => {
            // Create a non-default template
            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['Delete Template', 'Template to delete', adminUser.id, 0],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });
            templateId = result.lastID;
        });

        it('should delete non-default template', async () => {
            const response = await agent
                .delete(`/admin/timeslot-templates/${templateId}`)
                .expect(200);

            expect(response.body).toHaveProperty('message', 'Template deleted successfully');
        });

        it('should prevent deletion of default template', async () => {
            // Create default template
            const result = await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO timeslot_templates (name, description, created_by, is_default) VALUES (?, ?, ?, ?)',
                    ['Default Template', 'Default template', adminUser.id, 1],
                    function(err) {
                        if (err) reject(err);
                        resolve({ lastID: this.lastID });
                    }
                );
            });

            const response = await agent
                .delete(`/admin/timeslot-templates/${result.lastID}`)
                .expect(400);

            expect(response.body).toHaveProperty('error', 'Cannot delete the default template');
        });

        it('should return 404 for non-existent template', async () => {
            const response = await agent
                .delete('/admin/timeslot-templates/99999')
                .expect(404);

            expect(response.body).toHaveProperty('error', 'Template not found');
        });
    });
});