const { testDb, initializeTestDb } = require('../../config/test.db');
const { clearTestDb, createTestUser } = require('../helpers/testHelpers');
const TimeslotManager = require('../../utils/timeslotManager');

describe('TimeslotManager', () => {
    let timeslotManager;
    let testUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        timeslotManager = new TimeslotManager(testDb);
        testUser = await createTestUser();
    });

    describe('getWeekStart', () => {
        it('should return Monday for any day of the week', () => {
            // Test different days of the week
            const tuesday = new Date('2024-01-02T10:00:00'); // Tuesday
            const saturday = new Date('2024-01-06T10:00:00'); // Saturday
            const sunday = new Date('2024-01-07T10:00:00'); // Sunday
            const monday = new Date('2024-01-01T10:00:00'); // Monday

            const mondayStart = timeslotManager.getWeekStart(monday);
            const tuesdayStart = timeslotManager.getWeekStart(tuesday);
            const saturdayStart = timeslotManager.getWeekStart(saturday);
            const sundayStart = timeslotManager.getWeekStart(sunday);

            // All should return Monday Jan 1, 2024
            expect(mondayStart.toISOString().split('T')[0]).toBe('2024-01-01');
            expect(tuesdayStart.toISOString().split('T')[0]).toBe('2024-01-01');
            expect(saturdayStart.toISOString().split('T')[0]).toBe('2024-01-01');
            expect(sundayStart.toISOString().split('T')[0]).toBe('2024-01-01');

            // All should be at midnight
            expect(mondayStart.getHours()).toBe(0);
            expect(tuesdayStart.getHours()).toBe(0);
            expect(saturdayStart.getHours()).toBe(0);
            expect(sundayStart.getHours()).toBe(0);
        });
    });

    describe('canModifyWeek', () => {
        it('should allow modification of current and future weeks', () => {
            const today = new Date();
            const currentWeek = timeslotManager.getWeekStart(today);
            const nextWeek = new Date(currentWeek);
            nextWeek.setDate(currentWeek.getDate() + 7);
            const lastWeek = new Date(currentWeek);
            lastWeek.setDate(currentWeek.getDate() - 7);

            expect(timeslotManager.canModifyWeek(currentWeek)).toBe(true);
            expect(timeslotManager.canModifyWeek(nextWeek)).toBe(true);
            expect(timeslotManager.canModifyWeek(lastWeek)).toBe(false);
        });
    });

    describe('getFallbackTimeslots', () => {
        it('should return default 4 timeslots for all days', () => {
            const fallback = timeslotManager.getFallbackTimeslots();

            expect(Object.keys(fallback)).toHaveLength(7); // 7 days

            for (let day = 0; day < 7; day++) {
                expect(fallback[day]).toHaveLength(4); // 4 timeslots per day
                expect(fallback[day][0].time).toBe('8:00am');
                expect(fallback[day][1].time).toBe('12:30pm');
                expect(fallback[day][2].time).toBe('5:00pm');
                expect(fallback[day][3].time).toBe('9:30pm');
            }
        });
    });

    describe('getTimeslotsForWeek', () => {
        it('should return fallback timeslots for weeks without configuration', async () => {
            const weekStart = new Date('2024-01-01'); // Monday
            const result = await timeslotManager.getTimeslotsForWeek(weekStart);

            expect(result.config).toBeNull();
            expect(result.timeslots).toBeDefined();
            expect(result.timeslots[0]).toHaveLength(4); // Monday should have 4 slots
            expect(result.timeslots[0][0].time).toBe('8:00am');
        });
    });

    describe('createTemplate', () => {
        it('should create a new template with slots', async () => {
            const slots = [
                { day_of_week: 0, time: '9:00am', label: 'Morning', slot_order: 0 },
                { day_of_week: 0, time: '2:00pm', label: 'Afternoon', slot_order: 1 },
                { day_of_week: 1, time: '9:00am', label: 'Morning', slot_order: 0 }
            ];

            const template = await timeslotManager.createTemplate(
                'Test Template',
                'A test template',
                slots,
                testUser.id,
                false
            );

            expect(template.id).toBeDefined();
            expect(template.name).toBe('Test Template');
            expect(template.description).toBe('A test template');
            expect(template.is_default).toBe(false);

            // Verify template slots were created
            const templateData = await timeslotManager.getTemplateWithSlots(template.id);
            expect(templateData.slots[0]).toHaveLength(2); // Monday has 2 slots
            expect(templateData.slots[1]).toHaveLength(1); // Tuesday has 1 slot
        });

        it('should set template as default when specified', async () => {
            const slots = [
                { day_of_week: 0, time: '9:00am', label: 'Morning', slot_order: 0 }
            ];

            const template = await timeslotManager.createTemplate(
                'Default Template',
                'Default template',
                slots,
                testUser.id,
                true
            );

            expect(template.is_default).toBe(true);

            const defaultTemplate = await timeslotManager.getDefaultTemplate();
            expect(defaultTemplate.id).toBe(template.id);
        });
    });

    describe('createTimeslotConfiguration', () => {
        it('should create configuration for future weeks', async () => {
            const futureWeek = new Date();
            futureWeek.setDate(futureWeek.getDate() + 14); // 2 weeks from now
            const weekStart = timeslotManager.getWeekStart(futureWeek);

            const slots = [
                { day_of_week: 0, time: '10:00am', label: 'Morning', slot_order: 0 },
                { day_of_week: 0, time: '3:00pm', label: 'Afternoon', slot_order: 1 }
            ];

            const result = await timeslotManager.createTimeslotConfiguration(
                weekStart,
                slots,
                testUser.id
            );

            expect(result.config.id).toBeDefined();
            expect(result.config.week_start).toBe(weekStart.toISOString().split('T')[0]);
            expect(result.timeslots[0]).toHaveLength(2); // Monday has 2 slots
        });

        it('should reject creation for past weeks', async () => {
            const pastWeek = new Date();
            pastWeek.setDate(pastWeek.getDate() - 7); // Last week
            const weekStart = timeslotManager.getWeekStart(pastWeek);

            const slots = [
                { day_of_week: 0, time: '10:00am', label: 'Morning', slot_order: 0 }
            ];

            await expect(
                timeslotManager.createTimeslotConfiguration(weekStart, slots, testUser.id)
            ).rejects.toThrow('Cannot modify past weeks');
        });
    });

    describe('setDefaultTemplate', () => {
        it('should update default template', async () => {
            // Create two templates
            const slots = [
                { day_of_week: 0, time: '9:00am', label: 'Morning', slot_order: 0 }
            ];

            const template1 = await timeslotManager.createTemplate(
                'Template 1',
                'First template',
                slots,
                testUser.id,
                true
            );

            const template2 = await timeslotManager.createTemplate(
                'Template 2',
                'Second template',
                slots,
                testUser.id,
                false
            );

            // Initially template1 should be default
            let defaultTemplate = await timeslotManager.getDefaultTemplate();
            expect(defaultTemplate.id).toBe(template1.id);

            // Set template2 as default
            await timeslotManager.setDefaultTemplate(template2.id);

            // Now template2 should be default
            defaultTemplate = await timeslotManager.getDefaultTemplate();
            expect(defaultTemplate.id).toBe(template2.id);

            // Verify template1 is no longer default
            const template1Data = await testDb.get(
                'SELECT is_default FROM timeslot_templates WHERE id = ?',
                [template1.id]
            );
            expect(template1Data.is_default).toBeFalsy();
        });
    });

    describe('deleteTemplate', () => {
        it('should delete non-default templates', async () => {
            const slots = [
                { day_of_week: 0, time: '9:00am', label: 'Morning', slot_order: 0 }
            ];

            const template = await timeslotManager.createTemplate(
                'Deletable Template',
                'Can be deleted',
                slots,
                testUser.id,
                false
            );

            await timeslotManager.deleteTemplate(template.id);

            // Verify template is deleted
            const deletedTemplate = await new Promise((resolve, reject) => {
                testDb.get(
                    'SELECT * FROM timeslot_templates WHERE id = ?',
                    [template.id],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });
            expect(deletedTemplate).toBeUndefined();
        });

        it('should prevent deletion of default template', async () => {
            const slots = [
                { day_of_week: 0, time: '9:00am', label: 'Morning', slot_order: 0 }
            ];

            const template = await timeslotManager.createTemplate(
                'Default Template',
                'Default template',
                slots,
                testUser.id,
                true
            );

            await expect(
                timeslotManager.deleteTemplate(template.id)
            ).rejects.toThrow('Cannot delete the default template');
        });
    });

    describe('groupTimeslotsByDay', () => {
        it('should group timeslots correctly by day', () => {
            const timeslots = [
                { day_of_week: 0, time: '9:00am', slot_order: 0 },
                { day_of_week: 0, time: '2:00pm', slot_order: 1 },
                { day_of_week: 1, time: '10:00am', slot_order: 0 },
                { day_of_week: 2, time: '11:00am', slot_order: 0 }
            ];

            const grouped = timeslotManager.groupTimeslotsByDay(timeslots);

            expect(grouped[0]).toHaveLength(2); // Monday has 2 slots
            expect(grouped[1]).toHaveLength(1); // Tuesday has 1 slot
            expect(grouped[2]).toHaveLength(1); // Wednesday has 1 slot
            expect(grouped[3]).toHaveLength(0); // Thursday has 0 slots

            // Check ordering
            expect(grouped[0][0].time).toBe('9:00am');
            expect(grouped[0][1].time).toBe('2:00pm');
        });
    });
});