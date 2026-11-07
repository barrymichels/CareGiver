const path = require('path');
const express = require('express');
const request = require('supertest');
const sqlite3 = require('sqlite3');
const initializeDatabase = require('../config/database.init');
const DatabaseHelper = require('../utils/dbHelper');
const TimeslotManager = require('../utils/timeslotManager');

// Test the complete handoff: clock -> rendered date -> submitted date -> saved
// schedule. This must also run with TZ=UTC, not only the deployment's TZ.
describe('Schedule calendar through rendered pages and writes', () => {
    let db, helper, manager, app, instant;
    const RealDate = Date;
    const user = { id: 1, first_name: 'Family', last_name: 'Caregiver', is_active: 1, is_admin: 1 };
    const slots = [0, 6].map(day => ({ day_of_week: day, time: '9:00am', label: 'Visit', slot_order: 0 }));

    beforeAll(async () => {
        db = new sqlite3.Database(':memory:');
        helper = new DatabaseHelper(db);
        await helper.runWithRetry('PRAGMA foreign_keys = ON');
        await initializeDatabase(db);
        manager = new TimeslotManager(db);
        app = express();
        app.use(express.json());
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, '../views'));
        app.locals.getPageTitle = title => title;
        app.use((req, res, next) => {
            req.user = user;
            req.isAuthenticated = () => true;
            next();
        });
        app.use('/admin/timeslots', require('../routes/admin/timeslots')(db));
        app.use('/admin/timeslot-templates', require('../routes/admin/templates')(db));
        app.use('/admin', require('../routes/admin')(db));
        app.use('/availability', require('../routes/availability')(db));
        app.use('/', require('../routes/index')(db));
    });

    beforeEach(async () => {
        for (const table of ['user_preferences', 'assignments', 'availability', 'timeslots',
            'timeslot_configurations', 'template_slots', 'timeslot_templates', 'users']) {
            await helper.runWithRetry(`DELETE FROM ${table}`);
        }
        await helper.runWithRetry("INSERT INTO users (id, first_name, last_name, is_admin, is_active) VALUES (1, 'Family', 'Caregiver', 1, 1)");
        global.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : [instant])); }
            static now() { return new RealDate(instant).getTime(); }
        };
    });
    afterEach(() => { global.Date = RealDate; });
    afterAll(() => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())));

    it.each([
        ['2025-01-13T04:59:59Z', '2025-01-06', '2025-01-12', '2025-01-13', '2025-01-13T05:00:00Z'],
        ['2026-07-06T03:59:59Z', '2026-06-29', '2026-07-05', '2026-07-06', '2026-07-06T04:00:00Z'],
        ['2026-03-09T03:59:59Z', '2026-03-02', '2026-03-08', '2026-03-09', '2026-03-09T04:00:00Z'],
        ['2026-11-02T04:59:59Z', '2026-10-26', '2026-11-01', '2026-11-02', '2026-11-02T05:00:00Z']
    ])('keeps the old week until Eastern midnight at %s', async (beforeMidnight, monday, sunday, nextMonday, midnight) => {
        instant = beforeMidnight;
        const template = await manager.createTemplate('Family visits', '', slots, user.id, true);
        const page = await request(app).get('/availability').expect(200);
        const dates = [...page.text.matchAll(/data-date="([\d-]+)"/g)].map(match => match[1]);
        expect(dates).toEqual([monday, sunday]);
        // The displayed week has been saved under the exact Monday sent in forms.
        expect((await helper.allWithRetry('SELECT week_start FROM timeslot_configurations')).map(row => row.week_start)).toEqual([monday]);

        await request(app).post('/availability/update').send({ availability: [
            { date: dates[1], time: '9:00am', isAvailable: true }
        ] }).expect(200);
        await request(app).post('/admin/assign').send({ assignments: [
            { date: dates[1], time: '9:00am', userId: user.id }
        ] }).expect(200);
        const admin = await request(app).get('/admin').expect(200);
        expect(admin.text).toContain(`data-week-start="${monday}"`);
        expect(admin.text).toContain(`data-date="${sunday}"`);
        const managed = await request(app).get('/admin/users/1/availability').expect(200);
        expect(managed.text).toMatch(new RegExp(`data-date="${sunday}"\\s+data-time="9:00am" checked`));
        const dashboard = await request(app).get('/').expect(200);
        expect(dashboard.text).toContain('Family Caregiver');
        const exported = await request(app).get('/export-calendar').expect(200);
        expect(exported.text).toContain(`DTSTART:${sunday.replace(/-/g, '')}T090000`);

        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: monday, templateId: template.id }).expect(200);
        expect(manager.canModifyWeek(monday)).toBe(true);
        expect((await helper.allWithRetry('SELECT day_date FROM assignments')).map(row => row.day_date)).toEqual([sunday]);
        const unchanged = await manager.getTimeslotsForWeek(monday);

        instant = midnight;
        expect(manager.canModifyWeek(monday)).toBe(false);
        expect(manager.canModifyWeek(nextMonday)).toBe(true);
        const nextPage = await request(app).get('/admin').expect(200);
        expect(nextPage.text).toContain(`data-week-start="${nextMonday}"`);
        await request(app).post('/admin/timeslots/apply-template')
            .send({ weekStart: monday, templateId: template.id }).expect(400);
        expect(await manager.getTimeslotsForWeek(monday)).toEqual(unchanged);
    });
});
