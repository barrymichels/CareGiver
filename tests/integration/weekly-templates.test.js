const path = require('path');
const express = require('express');
const request = require('supertest');
const sqlite3 = require('sqlite3');
const initializeDatabase = require('../../config/database.init');
const DatabaseHelper = require('../../utils/dbHelper');
const TimeslotManager = require('../../utils/timeslotManager');

describe('Weekly schedule templates', () => {
    let db, helper, manager, app, user, currentWeek, nextWeek, currentKey, nextKey;
    const slot = (time, order = 0, day = 0) => ({ day_of_week: day, time, label: time, slot_order: order });
    const key = date => date.toISOString().slice(0, 10);
    const shifted = (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    beforeAll(async () => {
        db = new sqlite3.Database(':memory:');
        helper = new DatabaseHelper(db);
        await helper.runWithRetry('PRAGMA foreign_keys = ON');
        await initializeDatabase(db);
        manager = new TimeslotManager(db);
        app = express();
        app.use(express.json());
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, '../../views'));
        app.locals.getPageTitle = title => title || 'CareGiver';
        app.use((req, res, next) => {
            req.user = user;
            req.isAuthenticated = () => true;
            next();
        });
        app.use('/admin/timeslots', require('../../routes/admin/timeslots')(db));
        app.use('/admin/timeslot-templates', require('../../routes/admin/templates')(db));
        app.use('/admin', require('../../routes/admin')(db));
        app.use('/availability', require('../../routes/availability')(db));
        app.use('/', require('../../routes/index')(db));
    });

    beforeEach(async () => {
        for (const table of ['user_preferences', 'assignments', 'availability', 'timeslots', 'timeslot_configurations', 'template_slots', 'timeslot_templates', 'users']) {
            await helper.runWithRetry(`DELETE FROM ${table}`);
        }
        user = { id: 7, first_name: 'Test', last_name: 'Caregiver', is_admin: 1, is_active: 1 };
        await helper.runWithRetry("INSERT INTO users (id, first_name, last_name, is_admin, is_active) VALUES (7, 'Test', 'Caregiver', 1, 1)");
        currentWeek = manager.getWeekStart(new Date());
        nextWeek = shifted(currentWeek, 7);
        currentKey = key(currentWeek);
        nextKey = key(nextWeek);
    });

    afterAll(() => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())));

    async function makeTemplate(name, slots, isDefault = false) {
        return manager.createTemplate(name, '', slots, user.id, isDefault);
    }

    async function assign(date, time, timeslotId = null) {
        await helper.runWithRetry(
            'INSERT INTO assignments (user_id, day_date, time_slot, timeslot_id, assigned_by) VALUES (?, ?, ?, ?, ?)',
            [user.id, date, time, timeslotId, user.id]
        );
        await helper.runWithRetry(
            'INSERT INTO availability (user_id, day_date, time_slot, timeslot_id) VALUES (?, ?, ?, ?)',
            [user.id, date, time, timeslotId]
        );
    }

    it('changes only the selected week and keeps snapshots after template edits, deletion and default changes', async () => {
        const defaultTemplate = await makeTemplate('Standard', Object.values(manager.getFallbackTimeslots()).flat(), true);
        const current = await manager.getTimeslotsForWeek(currentWeek);
        await assign(currentKey, '8:00am', current.timeslots[0][0].id);
        const originalAssignments = await helper.allWithRetry('SELECT * FROM assignments');
        const originalAvailability = await helper.allWithRetry('SELECT * FROM availability');
        const alternate = await makeTemplate('New routine', [slot('9:00am'), slot('3:00pm', 1)]);

        const response = await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: nextKey, templateId: alternate.id }).expect(200);
        expect(response.body.data.config).toMatchObject({ template_id: alternate.id, template_name: 'New routine', uses_default: 0 });
        expect(await manager.getTimeslotsForWeek(currentWeek)).toEqual(current);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toEqual(originalAssignments);
        expect(await helper.allWithRetry('SELECT * FROM availability')).toEqual(originalAvailability);

        await request(app).put(`/admin/timeslot-templates/${alternate.id}`)
            .send({ name: 'Edited routine', slots: [slot('10:00am')] }).expect(200);
        expect((await manager.getTimeslotsForWeek(nextWeek)).timeslots[0].map(s => s.time)).toEqual(['9:00am', '3:00pm']);
        await manager.setDefaultTemplate(alternate.id);
        expect((await manager.getTimeslotsForWeek(shifted(nextWeek, 7))).timeslots[0][0].time).toBe('10:00am');
        expect(await manager.getTimeslotsForWeek(currentWeek)).toEqual(current);
        await manager.setDefaultTemplate(defaultTemplate.id);
        await manager.deleteTemplate(alternate.id);
        const saved = await manager.getTimeslotsForWeek(nextWeek);
        expect(saved.config).toMatchObject({ template_id: null, template_name: 'New routine' });
        expect(saved.timeslots[0].map(s => s.time)).toEqual(['9:00am', '3:00pm']);
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: nextKey, templateId: null }).expect(200);
        expect((await manager.getTimeslotsForWeek(nextWeek)).config.uses_default).toBe(1);
        expect((await manager.getTimeslotsForWeek(nextWeek)).timeslots[0].map(s => s.time))
            .toEqual(['8:00am', '12:30pm', '5:00pm', '9:30pm']);
    });

    it('renders the same per-day times on all four calendar screens, including days with no slots', async () => {
        const template = await makeTemplate('Different days', [slot('9:00am'), slot('3:00pm', 1), slot('11:00am', 0, 1)]);
        await manager.applyTemplate(nextWeek, template.id, user.id);
        for (const url of ['/admin', '/availability', `/admin/users/${user.id}/availability`, '/']) {
            const response = await request(app).get(url).query({ weekOffset: 1 }).expect(200);
            const times = [...response.text.matchAll(url === '/' ? /class="time">([^<]+)</g : /data-time="([^"]+)"/g)]
                .map(match => match[1]);
            expect(times).toEqual(['9:00am', '3:00pm', '11:00am']);
        }
        const controls = await request(app).get('/admin/timeslots').query({ weekOffset: 1 }).expect(200);
        expect(controls.text).toContain('Schedule template for this week:');
        expect(controls.text).toContain('Use default');
        expect(controls.text).toContain('Saved schedule: Different days');
        expect(controls.text).toContain(`value="${template.id}" selected`);
        expect(controls.text).toContain(`window.weekStart = '${nextKey}'`);
    });

    it.each(['apply', 'legacy-apply', 'update', 'create', 'copy', 'reset'])('%s requires confirmation before removing occupied slots', async action => {
        const saved = await manager.createTimeslotConfiguration(nextWeek, [slot('8:00am'), slot('9:00am', 1)], user.id);
        await assign(nextKey, '9:00am', saved.timeslots[0][1].id);
        const replacement = await makeTemplate('Replacement', [slot('8:00am')]);
        await manager.getTimeslotsForWeek(currentWeek);
        const actions = {
            apply: ['post', '/admin/timeslots/apply-template', { weekStart: nextKey, templateId: replacement.id }],
            'legacy-apply': ['post', `/admin/timeslot-templates/${replacement.id}/apply`, { weekStart: nextKey }],
            update: ['put', `/admin/timeslots/${saved.config.id}`, { slots: [slot('8:00am')] }],
            create: ['post', '/admin/timeslots', { weekStart: nextKey, slots: [slot('8:00am')] }],
            copy: ['post', '/admin/timeslots/copy', { targetWeekStart: nextKey, sourceWeekStart: currentKey }],
            reset: ['delete', `/admin/timeslots/${saved.config.id}`, {}]
        };
        const [method, url, body] = actions[action];
        const response = await request(app)[method](url).send({ ...body, ignoreConflicts: 'true' }).expect(409);
        expect(response.body.conflicts.assignments.map(a => a.time_slot)).toEqual(['9:00am']);
        expect(await manager.getTimeslotsForWeek(nextWeek)).toEqual(saved);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toHaveLength(1);
        await request(app)[method](url).send({ ...body, ignoreConflicts: true }).expect(200);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toHaveLength(0);
        expect(await helper.allWithRetry('SELECT * FROM availability')).toHaveLength(0);
    });

    it('preserves unchanged slot IDs and entries, clears only removed entries, and rejects stale forms', async () => {
        const saved = await manager.createTimeslotConfiguration(nextWeek, [slot('8:00am'), slot('9:00am', 1)], user.id);
        const keptId = saved.timeslots[0][0].id;
        await assign(nextKey, '8:00am', keptId);
        await assign(nextKey, '9:00am', saved.timeslots[0][1].id);
        await assign(currentKey, '9:00am');
        const replacement = [slot('7:00am'), { ...slot('8:00am', 1), label: 'Breakfast' }];
        const response = await request(app).put(`/admin/timeslots/${saved.config.id}`)
            .send({ slots: replacement, ignoreConflicts: true }).expect(200);
        expect(response.body.data.timeslots[0][1]).toMatchObject({ id: keptId, label: 'Breakfast', slot_order: 1 });
        for (const table of ['assignments', 'availability']) {
            expect((await helper.allWithRetry(`SELECT day_date, time_slot FROM ${table} ORDER BY day_date`)))
                .toEqual([{ day_date: currentKey, time_slot: '9:00am' }, { day_date: nextKey, time_slot: '8:00am' }]);
        }
        await request(app).post('/availability/update').send({ availability: [{ date: nextKey, time: '9:00am', isAvailable: true }] }).expect(409);
        await request(app).post(`/admin/users/${user.id}/availability`).send({ availability: [{ date: nextKey, time: '9:00am', isAvailable: true }] }).expect(409);
        await request(app).post('/admin/assign').send({ assignments: [{ date: nextKey, time: '9:00am', userId: user.id }] }).expect(409);
        await request(app).post('/availability/update').send({ availability: [{ date: nextKey, time: '7:00am', isAvailable: true }] }).expect(200);
        await request(app).post('/admin/assign').send({ assignments: [{ date: nextKey, time: '7:00am', userId: user.id }] }).expect(200);
    });

    it('rolls back data removal if saving the replacement fails', async () => {
        const saved = await manager.createTimeslotConfiguration(nextWeek, [slot('9:00am')], user.id);
        await assign(nextKey, '9:00am', saved.timeslots[0][0].id);
        await expect(manager.updateTimeslotConfiguration(saved.config.id, [slot('8:00am'), slot('10:00am')], { ignoreConflicts: true }))
            .rejects.toThrow('UNIQUE constraint failed');
        expect(await manager.getTimeslotsForWeek(nextWeek)).toEqual(saved);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toHaveLength(1);
        expect(await helper.allWithRetry('SELECT * FROM availability')).toHaveLength(1);
    });

    it('also asks before clearing saved unavailability', async () => {
        const saved = await manager.createTimeslotConfiguration(nextWeek, [slot('9:00am')], user.id);
        await helper.runWithRetry(
            'INSERT INTO availability (user_id, day_date, time_slot, is_available) VALUES (?, ?, ?, 0)',
            [user.id, nextKey, '9:00am']
        );
        await request(app).put(`/admin/timeslots/${saved.config.id}`)
            .send({ slots: [slot('8:00am')] }).expect(409);
        expect(await helper.getWithRetry('SELECT * FROM availability')).toMatchObject({ is_available: 0 });
    });

    it('normalizes date-only weeks across Sunday and DST, rejects invalid dates and protects past weeks', async () => {
        expect(key(manager.parseWeekStart('2026-11-01'))).toBe('2026-10-26');
        expect(key(manager.parseWeekStart('2026-11-02'))).toBe('2026-11-02');
        expect(() => manager.parseWeekStart('2026-02-30')).toThrow('Invalid week start date');
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: key(shifted(currentWeek, -7)), templateId: null }).expect(400);
        user.is_admin = 0;
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: nextKey, templateId: null }).expect(403);
    });
});

it('upgrades an existing database twice without changing its schedules or assignments', async () => {
    const db = new sqlite3.Database(':memory:');
    const helper = new DatabaseHelper(db);
    try {
        await helper.runWithRetry('PRAGMA foreign_keys = ON');
        await helper.runWithRetry(`CREATE TABLE timeslot_configurations (
            id INTEGER PRIMARY KEY, week_start DATE UNIQUE NOT NULL, created_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await initializeDatabase(db);
        for (const column of ['template_id', 'template_name', 'uses_default']) {
            await helper.runWithRetry(`ALTER TABLE timeslot_configurations DROP COLUMN ${column}`);
        }
        await helper.runWithRetry("INSERT INTO users (id, first_name, last_name) VALUES (1, 'Test', 'Caregiver')");
        await helper.runWithRetry("INSERT INTO timeslot_configurations (id, week_start, created_by) VALUES (1, '2024-01-01', 1)");
        await helper.runWithRetry("INSERT INTO timeslots (id, config_id, day_of_week, time, label, slot_order) VALUES (1, 1, 0, '8:00am', 'Morning', 0)");
        await helper.runWithRetry("INSERT INTO assignments (user_id, day_date, time_slot, timeslot_id, assigned_by) VALUES (1, '2024-01-01', '8:00am', 1, 1)");
        const before = await helper.getWithRetry('SELECT * FROM timeslot_configurations');
        await initializeDatabase(db);
        const upgraded = await helper.getWithRetry('SELECT * FROM timeslot_configurations');
        expect(upgraded).toMatchObject({ ...before, template_id: null, template_name: null, uses_default: 0 });
        await initializeDatabase(db);
        expect(await helper.getWithRetry('SELECT * FROM timeslot_configurations')).toEqual(upgraded);
        expect(await helper.getWithRetry('SELECT * FROM assignments')).toMatchObject({ time_slot: '8:00am', timeslot_id: 1 });
        expect((await helper.allWithRetry('PRAGMA table_info(timeslot_configurations)')).filter(c => c.name === 'template_id')).toHaveLength(1);
    } finally {
        await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    }
});
