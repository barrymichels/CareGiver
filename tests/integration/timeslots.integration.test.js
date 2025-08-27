const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');
const TimeslotManager = require('../../utils/timeslotManager');

describe('Timeslots Integration Tests', () => {
    let app;
    let adminUser;
    let regularUser;
    let timeslotManager;

    beforeAll(async () => {
        await initializeTestDb();
        
        // Create test users
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

        timeslotManager = new TimeslotManager(testDb);
    });

    afterAll(async () => {
        await clearTestDb();
    });

    beforeEach(async () => {
        // Clear all timeslot data
        await Promise.all([
            new Promise(resolve => testDb.run('DELETE FROM template_slots', () => resolve())),
            new Promise(resolve => testDb.run('DELETE FROM timeslot_templates', () => resolve())),
            new Promise(resolve => testDb.run('DELETE FROM timeslots', () => resolve())),
            new Promise(resolve => testDb.run('DELETE FROM timeslot_configurations', () => resolve())),
            new Promise(resolve => testDb.run('DELETE FROM availability', () => resolve())),
            new Promise(resolve => testDb.run('DELETE FROM assignments', () => resolve()))
        ]);
    });

    describe('Complete Workflow: Template Creation to Schedule Assignment', () => {
        it('should handle complete timeslot workflow', async () => {
            // Step 1: Create a template
            const template = await timeslotManager.createTemplate(
                'Standard Care Schedule',
                'Standard 4-slot daily schedule',
                [
                    { day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 },
                    { day_of_week: 0, time: '12:30pm', label: 'Afternoon', slot_order: 1 },
                    { day_of_week: 0, time: '5:00pm', label: 'Evening', slot_order: 2 },
                    { day_of_week: 0, time: '9:30pm', label: 'Night', slot_order: 3 },
                    { day_of_week: 1, time: '8:00am', label: 'Morning', slot_order: 0 },
                    { day_of_week: 1, time: '12:30pm', label: 'Afternoon', slot_order: 1 },
                    { day_of_week: 1, time: '5:00pm', label: 'Evening', slot_order: 2 },
                    { day_of_week: 1, time: '9:30pm', label: 'Night', slot_order: 3 }
                ],
                adminUser.id,
                true // Set as default
            );

            expect(template).toHaveProperty('id');
            expect(template.is_default).toBe(true);

            // Step 2: Apply template to future week
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const weekStart = timeslotManager.getWeekStart(futureDate);

            const appliedConfig = await timeslotManager.applyTemplate(
                weekStart,
                template.id,
                adminUser.id
            );

            expect(appliedConfig).toHaveProperty('config');
            expect(appliedConfig).toHaveProperty('timeslots');
            expect(appliedConfig.timeslots[0]).toHaveLength(4); // Monday slots
            expect(appliedConfig.timeslots[1]).toHaveLength(4); // Tuesday slots

            // Step 3: Verify timeslots can be retrieved
            const retrievedConfig = await timeslotManager.getTimeslotsForWeek(weekStart);
            expect(retrievedConfig.config).toBeTruthy();
            expect(retrievedConfig.timeslots[0]).toHaveLength(4);

            // Step 4: Create user availability based on dynamic timeslots
            const mondayDate = new Date(weekStart);
            const tuesdayDate = new Date(weekStart);
            tuesdayDate.setDate(tuesdayDate.getDate() + 1);

            // User indicates availability for specific timeslots
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO availability (user_id, day_date, time_slot, is_available) VALUES (?, ?, ?, ?)',
                    [regularUser.id, mondayDate.toISOString().split('T')[0], '8:00am', 1],
                    (err) => err ? reject(err) : resolve()
                );
            });

            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO availability (user_id, day_date, time_slot, is_available) VALUES (?, ?, ?, ?)',
                    [regularUser.id, mondayDate.toISOString().split('T')[0], '5:00pm', 1],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // Step 5: Check for conflicts before making changes
            const conflicts = await timeslotManager.checkForConflicts(weekStart);
            expect(conflicts.hasConflicts).toBe(true);
            expect(conflicts.availability).toHaveLength(2);

            // Step 6: Modify timeslots (add a new slot)
            const modifiedSlots = [
                { day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 },
                { day_of_week: 0, time: '10:30am', label: 'Mid-Morning', slot_order: 1 },
                { day_of_week: 0, time: '12:30pm', label: 'Afternoon', slot_order: 2 },
                { day_of_week: 0, time: '5:00pm', label: 'Evening', slot_order: 3 },
                { day_of_week: 0, time: '9:30pm', label: 'Night', slot_order: 4 }
            ];

            const updatedConfig = await timeslotManager.updateTimeslotConfiguration(
                appliedConfig.config.id,
                modifiedSlots
            );

            expect(updatedConfig.timeslots[0]).toHaveLength(5); // Now 5 slots on Monday

            // Step 7: Copy configuration to another week
            const nextWeekDate = new Date(weekStart);
            nextWeekDate.setDate(nextWeekDate.getDate() + 7);

            const copiedConfig = await timeslotManager.copyFromPreviousWeek(
                nextWeekDate,
                weekStart,
                adminUser.id
            );

            expect(copiedConfig.timeslots[0]).toHaveLength(5);

            // Step 8: Verify fallback behavior for unconfigured weeks
            const distantFutureDate = new Date();
            distantFutureDate.setDate(distantFutureDate.getDate() + 60);
            const distantWeekStart = timeslotManager.getWeekStart(distantFutureDate);

            const fallbackConfig = await timeslotManager.getTimeslotsForWeek(distantWeekStart);
            // Should get default template applied automatically
            expect(fallbackConfig.config).toBeTruthy();
            expect(fallbackConfig.timeslots[0]).toHaveLength(4); // Default template has 4 slots
        });
    });

    describe('Past Week Protection', () => {
        it('should prevent modifications to past weeks', async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 14);
            const pastWeekStart = timeslotManager.getWeekStart(pastDate);

            // Should not be able to create configuration for past week
            await expect(
                timeslotManager.createTimeslotConfiguration(
                    pastWeekStart,
                    [{ day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 }],
                    adminUser.id
                )
            ).rejects.toThrow('Cannot modify past weeks');

            // Should not be able to apply template to past week
            const template = await timeslotManager.createTemplate(
                'Test Template',
                'Test',
                [{ day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 }],
                adminUser.id
            );

            await expect(
                timeslotManager.applyTemplate(pastWeekStart, template.id, adminUser.id)
            ).rejects.toThrow('Cannot modify past weeks');

            // Should not be able to copy to past week
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const futureWeekStart = timeslotManager.getWeekStart(futureDate);

            await expect(
                timeslotManager.copyFromPreviousWeek(pastWeekStart, futureWeekStart, adminUser.id)
            ).rejects.toThrow('Cannot modify past weeks');
        });

        it('should allow modifications to current and future weeks', async () => {
            const currentWeekStart = timeslotManager.getWeekStart(new Date());
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14);
            const futureWeekStart = timeslotManager.getWeekStart(futureDate);

            // Should be able to modify current week
            expect(timeslotManager.canModifyWeek(currentWeekStart)).toBe(true);

            // Should be able to modify future week
            expect(timeslotManager.canModifyWeek(futureWeekStart)).toBe(true);

            // Create configuration for current week should succeed
            await expect(
                timeslotManager.createTimeslotConfiguration(
                    currentWeekStart,
                    [{ day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 }],
                    adminUser.id
                )
            ).resolves.toBeTruthy();
        });
    });

    describe('Template Management', () => {
        it('should handle default template management correctly', async () => {
            // Create first template as default
            const template1 = await timeslotManager.createTemplate(
                'Template 1',
                'First template',
                [{ day_of_week: 0, time: '8:00am', label: 'Morning', slot_order: 0 }],
                adminUser.id,
                true
            );

            expect(template1.is_default).toBe(true);

            // Create second template as default (should replace first)
            const template2 = await timeslotManager.createTemplate(
                'Template 2',
                'Second template',
                [{ day_of_week: 0, time: '9:00am', label: 'Morning', slot_order: 0 }],
                adminUser.id,
                true
            );

            expect(template2.is_default).toBe(true);

            // Verify first template is no longer default
            const defaultTemplate = await timeslotManager.getDefaultTemplate();
            expect(defaultTemplate.id).toBe(template2.id);

            // Should not be able to delete default template
            await expect(
                timeslotManager.deleteTemplate(template2.id)
            ).rejects.toThrow('Cannot delete the default template');

            // Should be able to delete non-default template
            await expect(
                timeslotManager.deleteTemplate(template1.id)
            ).resolves.toBeUndefined();
        });

        it('should apply default template automatically for future weeks', async () => {
            // Create default template
            await timeslotManager.createTemplate(
                'Auto Apply Template',
                'Automatically applied template',
                [
                    { day_of_week: 0, time: '10:00am', label: 'Morning', slot_order: 0 },
                    { day_of_week: 0, time: '2:00pm', label: 'Afternoon', slot_order: 1 }
                ],
                adminUser.id,
                true
            );

            // Request timeslots for future week that doesn't have configuration
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 21);
            const futureWeekStart = timeslotManager.getWeekStart(futureDate);

            const weekData = await timeslotManager.getTimeslotsForWeek(futureWeekStart);

            // Should have automatically created configuration from default template
            expect(weekData.config).toBeTruthy();
            expect(weekData.timeslots[0]).toHaveLength(2);
            expect(weekData.timeslots[0][0].time).toBe('10:00am');
            expect(weekData.timeslots[0][1].time).toBe('2:00pm');
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle missing timeslot configurations gracefully', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);
            const futureWeekStart = timeslotManager.getWeekStart(futureDate);

            // No default template exists, should return fallback
            const weekData = await timeslotManager.getTimeslotsForWeek(futureWeekStart);
            
            expect(weekData.config).toBeNull();
            expect(weekData.timeslots).toBeTruthy();
            // Should get fallback timeslots (original 4 slots)
            expect(weekData.timeslots[0]).toHaveLength(4);
        });

        it('should handle week start date calculations correctly', async () => {
            // Generate a Monday dynamically
            const today = new Date();
            const daysFromMonday = (today.getDay() + 6) % 7; // Calculate days since Monday
            const baseMonday = new Date(today);
            baseMonday.setDate(today.getDate() - daysFromMonday);
            
            // Create test dates for the entire week starting from that Monday
            const testDates = [];
            for (let i = 0; i < 7; i++) {
                const testDate = new Date(baseMonday);
                testDate.setDate(baseMonday.getDate() + i);
                testDates.push(testDate);
            }

            const expectedMonday = timeslotManager.getWeekStart(testDates[0]);
            
            testDates.forEach((date, index) => {
                const weekStart = timeslotManager.getWeekStart(date);
                expect(weekStart.getDay()).toBe(1); // Should always be Monday (day 1)
                // All dates in the same week should return the same Monday
                expect(weekStart.getDate()).toBe(expectedMonday.getDate());
            });
        });

        it('should handle duplicate slots detection', async () => {
            // Test duplicate slots - this should be caught by route validation
            // TimeslotManager itself accepts the data as provided
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 14); // 2 weeks in future
            const config = await timeslotManager.createTimeslotConfiguration(
                timeslotManager.getWeekStart(futureDate),
                [
                    { day_of_week: 0, time: '8:00am', label: 'Morning 1', slot_order: 0 },
                    { day_of_week: 0, time: '8:00am', label: 'Morning 2', slot_order: 1 }
                ],
                adminUser.id
            );
            
            // Should create configuration (validation is at route level)
            expect(config).toHaveProperty('config');
            expect(config.timeslots[0]).toHaveLength(2);
        });
    });

    describe('Performance and Scalability', () => {
        it('should handle multiple templates efficiently', async () => {
            const templateCount = 10;
            const templates = [];

            // Create multiple templates
            for (let i = 0; i < templateCount; i++) {
                const template = await timeslotManager.createTemplate(
                    `Template ${i}`,
                    `Description ${i}`,
                    [
                        { day_of_week: 0, time: `${8 + i}:00am`, label: 'Morning', slot_order: 0 }
                    ],
                    adminUser.id,
                    i === templateCount - 1 // Make last one default
                );
                templates.push(template);
            }

            // Retrieve all templates
            const allTemplates = await timeslotManager.getAllTemplates();
            expect(allTemplates).toHaveLength(templateCount);

            // Verify default template is correct
            const defaultTemplate = await timeslotManager.getDefaultTemplate();
            expect(defaultTemplate.name).toBe(`Template ${templateCount - 1}`);
        });

        it('should handle multiple week configurations efficiently', async () => {
            const weekCount = 8;
            const baseDate = new Date();

            // Create configurations for multiple weeks
            for (let i = 0; i < weekCount; i++) {
                const weekDate = new Date(baseDate);
                weekDate.setDate(baseDate.getDate() + (i * 7));
                const weekStart = timeslotManager.getWeekStart(weekDate);

                await timeslotManager.createTimeslotConfiguration(
                    weekStart,
                    [
                        { day_of_week: 0, time: `${8 + i}:00am`, label: `Week ${i} Morning`, slot_order: 0 }
                    ],
                    adminUser.id
                );
            }

            // Verify all configurations exist and are unique
            for (let i = 0; i < weekCount; i++) {
                const weekDate = new Date(baseDate);
                weekDate.setDate(baseDate.getDate() + (i * 7));
                const weekStart = timeslotManager.getWeekStart(weekDate);

                const weekData = await timeslotManager.getTimeslotsForWeek(weekStart);
                expect(weekData.config).toBeTruthy();
                expect(weekData.timeslots[0][0].label).toBe(`Week ${i} Morning`);
            }
        });
    });
});