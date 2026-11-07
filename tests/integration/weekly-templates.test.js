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

        await assign(nextKey, '9:00am');
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
            .send({ weekStart: nextKey, templateId: null, ignoreConflicts: true }).expect(200);
        expect((await manager.getTimeslotsForWeek(nextWeek)).config.uses_default).toBe(1);
        expect((await manager.getTimeslotsForWeek(nextWeek)).timeslots[0].map(s => s.time))
            .toEqual(['8:00am', '12:30pm', '5:00pm', '9:30pm']);
    });

    it('refreshes empty current and future weeks, protecting availability, assignments and past weeks', async () => {
        const original = await makeTemplate('Standard', Object.values(manager.getFallbackTimeslots()).flat(), true);
        const replacement = await makeTemplate('New default', [slot('9:00am'), slot('3:00pm', 1)]);
        await manager.getTimeslotsForWeek(currentWeek);
        // Even an explicit selection is replaceable when nobody has entered availability or assignments.
        await manager.applyTemplate(nextWeek, original.id, user.id);
        const availabilityWeek = shifted(nextWeek, 7);
        const assignmentWeek = shifted(nextWeek, 14);
        const pastKey = key(shifted(currentWeek, -7));
        const available = await manager.getTimeslotsForWeek(availabilityWeek);
        const assigned = await manager.getTimeslotsForWeek(assignmentWeek);
        await helper.runWithRetry('INSERT INTO availability (user_id, day_date, time_slot, is_available) VALUES (?, ?, ?, ?)',
            [user.id, key(availabilityWeek), '8:00am', 0]);
        await helper.runWithRetry('INSERT INTO assignments (user_id, day_date, time_slot, assigned_by) VALUES (?, ?, ?, ?)',
            [user.id, key(assignmentWeek), '8:00am', user.id]);
        await helper.runWithRetry('INSERT INTO timeslot_configurations (week_start, created_by, template_id, template_name, uses_default) VALUES (?, ?, ?, ?, 1)',
            [pastKey, user.id, original.id, original.name]);
        const past = await manager.getTimeslotsForWeek(shifted(currentWeek, -7));
        const savedAvailability = await helper.allWithRetry('SELECT * FROM availability');
        const savedAssignments = await helper.allWithRetry('SELECT * FROM assignments');

        const response = await request(app).post(`/admin/timeslot-templates/${replacement.id}/set-default`).expect(200);
        expect(response.body.refreshedWeeks).toEqual([currentKey, nextKey]);
        expect(response.body.protectedWeeks).toEqual([key(availabilityWeek), key(assignmentWeek)]);
        for (const week of [currentWeek, nextWeek, shifted(nextWeek, 21)]) {
            const saved = await manager.getTimeslotsForWeek(week);
            expect(saved.config).toMatchObject({ template_id: replacement.id, uses_default: 1 });
            expect(saved.timeslots[0].map(s => s.time)).toEqual(['9:00am', '3:00pm']);
        }
        expect(await manager.getTimeslotsForWeek(availabilityWeek)).toEqual(available);
        expect(await manager.getTimeslotsForWeek(assignmentWeek)).toEqual(assigned);
        expect(await manager.getTimeslotsForWeek(shifted(currentWeek, -7))).toEqual(past);
        expect(await helper.allWithRetry('SELECT * FROM availability')).toEqual(savedAvailability);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toEqual(savedAssignments);

        // Every calendar reads the refreshed copies, including the current week.
        for (const weekOffset of [0, 1]) {
            for (const url of ['/admin', '/availability', '/']) {
                const page = await request(app).get(url).query({ weekOffset }).expect(200);
                const times = [...page.text.matchAll(url === '/' ? /class="time">([^<]+)</g : /data-time="([^"]+)"/g)].map(match => match[1]);
                expect(times).toEqual(['9:00am', '3:00pm']);
            }
        }
        // Protected weeks still need explicit confirmation for removed entries.
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: key(assignmentWeek), templateId: replacement.id }).expect(409);
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: key(assignmentWeek), templateId: replacement.id, ignoreConflicts: true }).expect(200);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toEqual([]);
        expect(await helper.allWithRetry('SELECT * FROM availability')).toEqual(savedAvailability);
    });

    it.each(['create', 'update', 'delete'])('refreshes empty weeks when a default changes through %s', async action => {
        const original = await makeTemplate('Old', [slot('8:00am')], true);
        const replacement = await makeTemplate('New', [slot('9:00am')]);
        await manager.getTimeslotsForWeek(currentWeek);
        if (action === 'create') {
            await request(app).post('/admin/timeslot-templates')
                .send({ name: 'Created default', slots: [slot('9:00am')], isDefault: true }).expect(200);
        } else if (action === 'update') {
            await request(app).put(`/admin/timeslot-templates/${replacement.id}`)
                .send({ name: 'Updated default', slots: [slot('9:00am')], isDefault: true }).expect(200);
        } else {
            await request(app).delete(`/admin/timeslot-templates/${original.id}`)
                .send({ replacementDefaultId: replacement.id }).expect(200);
        }
        const week = await manager.getTimeslotsForWeek(currentWeek);
        expect(week.config.template_id).toBe((await manager.getDefaultTemplate()).id);
        expect(week.timeslots[0].map(s => s.time)).toEqual(['9:00am']);
    });

    it('rolls back the default and every empty week if refreshing a week fails', async () => {
        const original = await makeTemplate('Old', [slot('8:00am')], true);
        const replacement = await makeTemplate('New', [slot('9:00am')]);
        const before = await manager.getTimeslotsForWeek(currentWeek);
        const next = await manager.getTimeslotsForWeek(nextWeek);
        await helper.runWithRetry(`CREATE TRIGGER fail_default_refresh BEFORE INSERT ON timeslots
            WHEN NEW.config_id = ${next.config.id} AND NEW.time = '9:00am'
            BEGIN SELECT RAISE(ABORT, 'injected refresh failure'); END`);
        try {
            await request(app).post(`/admin/timeslot-templates/${replacement.id}/set-default`).expect(500);
            expect((await manager.getDefaultTemplate()).id).toBe(original.id);
            expect(await manager.getTimeslotsForWeek(currentWeek)).toEqual(before);
            expect(await manager.getTimeslotsForWeek(nextWeek)).toEqual(next);
        } finally {
            await helper.runWithRetry('DROP TRIGGER fail_default_refresh');
        }
    });

    it('rolls back template edits, promotion and every week when refreshing a later week fails', async () => {
        await makeTemplate('Old default', [slot('8:00am')], true);
        const replacement = await makeTemplate('Original name', [slot('10:00am')]);
        const originalTemplate = await manager.getTemplateWithSlots(replacement.id);
        const originalDefault = await manager.getDefaultTemplate();
        const current = await manager.getTimeslotsForWeek(currentWeek);
        const next = await manager.getTimeslotsForWeek(nextWeek);
        await helper.runWithRetry(`CREATE TRIGGER fail_edit_refresh BEFORE INSERT ON timeslots
            WHEN NEW.config_id = ${next.config.id} AND NEW.time = '9:00am'
            BEGIN SELECT RAISE(ABORT, 'injected edit refresh failure'); END`);
        try {
            await expect(manager.updateTemplate(replacement.id, {
                name: 'Edited name', description: 'Edited description',
                slots: [slot('9:00am')], isDefault: true
            })).rejects.toThrow('injected edit refresh failure');
            expect(await manager.getTemplateWithSlots(replacement.id)).toEqual(originalTemplate);
            expect(await manager.getDefaultTemplate()).toEqual(originalDefault);
            expect(await manager.getTimeslotsForWeek(currentWeek)).toEqual(current);
            expect(await manager.getTimeslotsForWeek(nextWeek)).toEqual(next);
        } finally {
            await helper.runWithRetry('DROP TRIGGER fail_edit_refresh');
        }
    });

    it('opens the template library without creating or changing any week', async () => {
        await makeTemplate('Library routine', [slot('9:00am')], true);
        const page = await request(app).get('/admin/timeslots?weekOffset=8').expect(200);
        expect(page.text).toContain('Schedule Templates');
        expect(page.text).not.toContain('weekTemplateForm');
        expect(await helper.allWithRetry('SELECT * FROM timeslot_configurations')).toEqual([]);
    });

    it('replaces a deleted default atomically and preserves configured times and availability', async () => {
        const original = await makeTemplate('Original', [slot('8:00am')], true);
        const replacement = await makeTemplate('Replacement', [slot('10:00am')]);
        const week = await manager.getTimeslotsForWeek(nextWeek);
        await assign(nextKey, '8:00am', week.timeslots[0][0].id);
        await request(app).delete(`/admin/timeslot-templates/${original.id}`)
            .send({ replacementDefaultId: 999999 }).expect(400);
        expect((await manager.getDefaultTemplate()).id).toBe(original.id);
        await request(app).delete(`/admin/timeslot-templates/${original.id}`)
            .send({ replacementDefaultId: replacement.id }).expect(200);
        expect((await manager.getDefaultTemplate()).id).toBe(replacement.id);
        expect((await manager.getTimeslotsForWeek(nextWeek)).timeslots).toEqual(week.timeslots);
        expect(await helper.allWithRetry('SELECT * FROM assignments')).toHaveLength(1);
        expect(await helper.allWithRetry('SELECT * FROM availability')).toHaveLength(1);
        expect(await helper.allWithRetry('SELECT * FROM template_slots WHERE template_id = ?', [original.id])).toEqual([]);
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
        const controls = await request(app).get('/admin').query({ weekOffset: 1 }).expect(200);
        expect(controls.text).toContain('Apply to this week');
        expect(controls.text).toContain('Use current default');
        expect(controls.text).toContain(`value="${template.id}" selected`);
        expect(controls.text).toContain(`data-week-start="${nextKey}"`);
    });

    it('promotes a template to the default when an update asks for it', async () => {
        await makeTemplate('Standard', Object.values(manager.getFallbackTimeslots()).flat(), true);
        const alternate = await makeTemplate('Promote me', [slot('9:00am')]);
        expect((await manager.getDefaultTemplate()).name).toBe('Standard');

        await request(app).put(`/admin/timeslot-templates/${alternate.id}`)
            .send({ name: 'Promote me', slots: [slot('9:00am')], isDefault: true }).expect(200);

        expect((await manager.getDefaultTemplate()).name).toBe('Promote me');
    });

    it('serves a template with its slots for the dropdown preview', async () => {
        const alternate = await makeTemplate('Previewable', [slot('9:00am'), slot('3:00pm', 1)]);
        const response = await request(app).get(`/admin/timeslot-templates/${alternate.id}`).expect(200);

        expect(response.body.template.name).toBe('Previewable');
        expect(response.body.slots[0].map(s => s.time)).toEqual(['9:00am', '3:00pm']);
    });

    it('escapes a hostile slot label instead of letting it break out of the inline script', async () => {
        const hostile = '</script><script>alert(document.cookie)</script>';
        const template = await makeTemplate('Hostile label', [{ ...slot('8:00am'), label: hostile }]);
        await manager.applyTemplate(nextWeek, template.id, user.id);

        const page = await request(app).get('/admin/timeslots').query({ weekOffset: 1 }).expect(200);

        // The payload must never appear as executable markup in the document...
        expect(page.text).not.toContain('</script><script>alert(document.cookie)');

        // ...but it must survive as data on the embedding line, escaped.
        const embedLine = page.text.match(/<script id="template-data" type="application\/json">(.*)<\/script>/)[1];
        expect(embedLine).toContain('\\u003cscript\\u003e');
        expect(embedLine).not.toContain('</script>');
        expect(JSON.parse(embedLine)[0].slots[0][0].label).toBe(hostile);
    });

    it.each([false, true])('applies a new template without blending times across days (Tuesday keeps original times: %s)', async keepTuesday => {
        await request(app).get('/availability').query({ weekOffset: 1 }).expect(200);
        const slots = Array.from({ length: 7 }, (_, day) => keepTuesday && day === 1
            ? manager.getFallbackTimeslots()[day]
            : [slot('9:00am', 0, day), slot('6:30pm', 1, day)]).flat();
        const template = await request(app).post('/admin/timeslot-templates')
            .send({ name: 'Two daily visits', slots }).expect(200);
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: nextKey, templateId: template.body.data.id }).expect(200);
        const availability = await request(app).get('/availability').query({ weekOffset: 1 }).expect(200);
        const times = [...availability.text.matchAll(/data-time="([^"]+)"/g)].map(match => match[1]);
        expect(times).toEqual(slots.map(slot => slot.time));
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
            reset: ['post', `/admin/timeslots/${saved.config.id}/reset-default`, {}]
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
