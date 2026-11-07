const sqlite3 = require('sqlite3');
const DatabaseHelper = require('../../utils/dbHelper');
const initializeDatabase = require('../../config/database.init');
const flexible = require('../../migrations/001_flexible_timeslots');
const weekly = require('../../migrations/002_weekly_templates');

describe('Timeslot migrations on persisted schedules', () => {
    let db, helper;

    beforeEach(async () => {
        db = new sqlite3.Database(':memory:');
        helper = new DatabaseHelper(db);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await helper.runWithRetry('PRAGMA foreign_keys = ON');
        // Pre-flexible legacy tables: the migration must add the slot references itself.
        for (const table of ['availability', 'assignments']) {
            await helper.runWithRetry(`CREATE TABLE ${table} (
                id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
                day_date TEXT NOT NULL, time_slot TEXT NOT NULL
            )`);
        }
        await initializeDatabase(db);
        await helper.runWithRetry("INSERT INTO users (id, first_name, last_name) VALUES (1, 'Ada', 'L')");
        await helper.runWithRetry("INSERT INTO availability VALUES (1, 1, '2026-11-02', '8:00am')");
        await helper.runWithRetry("INSERT INTO availability VALUES (2, 1, '2026-11-08', '9:30pm')");
        await helper.runWithRetry("INSERT INTO assignments VALUES (1, 1, '2026-11-09', '12:30pm')");
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
    });

    it('links legacy records to the correct Monday/Sunday slots across weeks', async () => {
        await flexible.migrate(db);
        expect(await helper.allWithRetry('SELECT week_start FROM timeslot_configurations ORDER BY week_start'))
            .toEqual([{ week_start: '2026-11-02' }, { week_start: '2026-11-09' }]);
        expect(await helper.getWithRetry('SELECT count(*) AS n FROM template_slots')).toEqual({ n: 28 });
        expect(await helper.getWithRetry('SELECT count(*) AS n FROM timeslots')).toEqual({ n: 56 });
        expect(await helper.allWithRetry(`SELECT a.day_date, t.day_of_week, t.time
            FROM availability a JOIN timeslots t ON t.id = a.timeslot_id ORDER BY a.id`)).toEqual([
            { day_date: '2026-11-02', day_of_week: 0, time: '8:00am' },
            { day_date: '2026-11-08', day_of_week: 6, time: '9:30pm' }
        ]);
        expect(await helper.getWithRetry(`SELECT tc.week_start, t.day_of_week, t.time
            FROM assignments a JOIN timeslots t ON t.id = a.timeslot_id
            JOIN timeslot_configurations tc ON tc.id = t.config_id`))
            .toEqual({ week_start: '2026-11-09', day_of_week: 0, time: '12:30pm' });
        expect(await helper.allWithRetry('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('rolls back generated slots while retaining original availability and assignments', async () => {
        await flexible.migrate(db);
        await flexible.rollback(db);
        expect(await helper.allWithRetry('SELECT * FROM availability ORDER BY id')).toEqual([
            { id: 1, user_id: 1, day_date: '2026-11-02', time_slot: '8:00am', timeslot_id: null },
            { id: 2, user_id: 1, day_date: '2026-11-08', time_slot: '9:30pm', timeslot_id: null }
        ]);
        expect(await helper.getWithRetry('SELECT * FROM assignments')).toEqual({
            id: 1, user_id: 1, day_date: '2026-11-09', time_slot: '12:30pm', timeslot_id: null
        });
        for (const table of ['timeslots', 'timeslot_configurations', 'template_slots', 'timeslot_templates']) {
            expect(await helper.getWithRetry(`SELECT count(*) AS n FROM ${table}`)).toEqual({ n: 0 });
        }
        expect(await helper.allWithRetry('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('undoes schema and data changes when a migration write fails', async () => {
        await helper.runWithRetry(`CREATE TRIGGER fail_slots BEFORE INSERT ON timeslots
            BEGIN SELECT RAISE(ABORT, 'injected slot failure'); END`);
        await expect(flexible.migrate(db)).rejects.toThrow('injected slot failure');
        for (const table of ['availability', 'assignments']) {
            const columns = await helper.allWithRetry(`PRAGMA table_info(${table})`);
            expect(columns.map(column => column.name)).not.toContain('timeslot_id');
        }
        expect(await helper.getWithRetry('SELECT count(*) AS n FROM timeslot_templates')).toEqual({ n: 0 });
        expect(await helper.getWithRetry('SELECT count(*) AS n FROM timeslot_configurations')).toEqual({ n: 0 });
        await helper.runWithRetry('DROP TRIGGER fail_slots');
        await expect(flexible.migrate(db)).resolves.toBeUndefined();
    });

    it('adds weekly provenance idempotently without changing saved times', async () => {
        await flexible.migrate(db);
        // Reconstruct the pre-provenance schema using SQLite's native column removal.
        for (const column of ['template_id', 'template_name', 'uses_default']) {
            await helper.runWithRetry(`ALTER TABLE timeslot_configurations DROP COLUMN ${column}`);
        }
        const savedSlots = await helper.allWithRetry('SELECT * FROM timeslots ORDER BY id');
        await weekly.migrate(db);
        await weekly.migrate(db);
        expect(await helper.allWithRetry('SELECT * FROM timeslots ORDER BY id')).toEqual(savedSlots);
        expect(await helper.allWithRetry('SELECT template_id, template_name, uses_default FROM timeslot_configurations'))
            .toEqual(Array(2).fill({ template_id: null, template_name: null, uses_default: 0 }));
        const template = await helper.getWithRetry('SELECT id FROM timeslot_templates');
        await helper.runWithRetry(`UPDATE timeslot_configurations
            SET template_id = ?, template_name = 'Original', uses_default = 1`, [template.id]);
        await weekly.migrate(db);
        await helper.runWithRetry('DELETE FROM timeslot_templates WHERE id = ?', [template.id]);
        expect(await helper.allWithRetry('SELECT template_id, template_name, uses_default FROM timeslot_configurations'))
            .toEqual(Array(2).fill({ template_id: null, template_name: 'Original', uses_default: 1 }));
        expect(await helper.allWithRetry('SELECT * FROM timeslots ORDER BY id')).toEqual(savedSlots);
    });
});
