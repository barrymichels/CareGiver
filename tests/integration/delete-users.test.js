const path = require('path');
const express = require('express');
const request = require('supertest');
const sqlite3 = require('sqlite3');
const initializeDatabase = require('../../config/database.init');
const DatabaseHelper = require('../../utils/dbHelper');

describe('Delete inactive users', () => {
    let db, helper, app, currentUser;
    const tables = ['password_reset_tokens', 'morning_summary_log', 'notification_settings', 'user_preferences',
        'assignments', 'availability', 'timeslots', 'timeslot_configurations', 'template_slots', 'timeslot_templates', 'users'];
    const snapshot = async () => Promise.all(tables.map(table => helper.allWithRetry(`SELECT * FROM ${table}`)));

    beforeAll(async () => {
        db = new sqlite3.Database(':memory:');
        helper = new DatabaseHelper(db);
        await helper.runWithRetry('PRAGMA foreign_keys = ON');
        await initializeDatabase(db);
        await helper.runWithRetry(`CREATE TABLE password_reset_tokens (
            token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at DATETIME NOT NULL
        )`);
        app = express();
        app.use(express.json());
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, '../../views'));
        app.locals.getPageTitle = title => title || 'CareGiver';
        app.use((req, res, next) => {
            req.user = currentUser;
            req.isAuthenticated = () => Boolean(currentUser);
            next();
        });
        app.use('/admin', require('../../routes/admin')(db));
        app.use('/users', require('../../routes/users')(db));
    });

    beforeEach(async () => {
        for (const table of tables) await helper.runWithRetry(`DELETE FROM ${table}`);
        await helper.runWithRetry(`INSERT INTO users (id, first_name, last_name, email, is_admin, is_active) VALUES
            (1, 'Current', 'Admin', 'admin@example.com', 1, 1),
            (2, 'Inactive', 'Caregiver', 'inactive@example.com', 0, 0),
            (3, 'Active', 'Caregiver', 'active@example.com', 0, 1)`);
        currentUser = await helper.getWithRetry('SELECT * FROM users WHERE id = 1');
        await helper.runWithRetry("INSERT INTO timeslot_templates (id, name, created_by, is_default) VALUES (1, 'Shared routine', 2, 1)");
        await helper.runWithRetry("INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order) VALUES (1, 0, '9:00am', 'Morning', 0)");
        await helper.runWithRetry("INSERT INTO timeslot_configurations (id, week_start, created_by, template_id, template_name) VALUES (1, '2026-10-26', 2, 1, 'Shared routine')");
        await helper.runWithRetry("INSERT INTO timeslots (id, config_id, day_of_week, time, label, slot_order) VALUES (1, 1, 0, '9:00am', 'Morning', 0)");
        for (const id of [2, 3]) {
            await helper.runWithRetry("INSERT INTO availability (user_id, day_date, time_slot, timeslot_id) VALUES (?, '2026-10-26', '9:00am', 1)", [id]);
            await helper.runWithRetry("INSERT INTO user_preferences (user_id, preferences) VALUES (?, '{}')", [id]);
            await helper.runWithRetry("INSERT INTO notification_settings (user_id, push_subscription, push_enabled) VALUES (?, '{}', 1)", [id]);
            await helper.runWithRetry("INSERT INTO morning_summary_log (user_id, date) VALUES (?, '2026-10-26')", [id]);
            await helper.runWithRetry("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, '2026-10-27')", [`token-${id}`, id]);
            await helper.runWithRetry("INSERT INTO assignments (user_id, day_date, time_slot, timeslot_id, assigned_by) VALUES (?, ?, '9:00am', 1, 2)", [id, `2026-10-${24 + id}`]);
        }
    });

    afterAll(() => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())));

    it.each(['regular', 'virtual', 'admin'])('deletes an inactive %s account and its data while preserving shared schedules and other users', async type => {
        if (type === 'virtual') await helper.runWithRetry('UPDATE users SET email = NULL WHERE id = 2');
        if (type === 'admin') await helper.runWithRetry('UPDATE users SET is_admin = 1 WHERE id = 2');
        const before = await snapshot();
        await request(app).delete('/admin/users/2').expect(200);
        const after = await snapshot();
        for (let i = 0; i < tables.length; i++) {
            const table = tables[i];
            const expected = before[i]
                .filter(row => table === 'users' ? row.id !== 2 : row.user_id !== 2)
                .map(row => {
                    const saved = { ...row };
                    if (saved.assigned_by === 2) saved.assigned_by = 1;
                    if (saved.created_by === 2) saved.created_by = 1;
                    return saved;
                });
            expect(after[i]).toEqual(expected);
        }
        expect(await helper.allWithRetry('PRAGMA foreign_key_check')).toEqual([]);
        await request(app).delete('/admin/users/2').expect(404);
    });

    it('rechecks active status on deletion, even when the page originally showed an inactive user', async () => {
        await request(app).put('/admin/users/2').send({ is_active: true }).expect(200);
        const before = await snapshot();
        const response = await request(app).delete('/admin/users/2').expect(409);
        expect(response.body.error).toContain('Only inactive users');
        expect(await snapshot()).toEqual(before);
    });

    it.each([['unauthenticated', 403], ['non-admin', 403], ['self', 400], ['missing', 404], ['invalid', 400]])(
        'rejects %s deletion without modifying data', async (scenario, status) => {
            let id = 2;
            if (scenario === 'unauthenticated') currentUser = null;
            if (scenario === 'non-admin') currentUser = await helper.getWithRetry('SELECT * FROM users WHERE id = 3');
            if (scenario === 'self') id = 1;
            if (scenario === 'missing') id = 999;
            if (scenario === 'invalid') id = '2oops';
            const before = await snapshot();
            await request(app).delete(`/admin/users/${id}`).expect(status);
            expect(await snapshot()).toEqual(before);
        }
    );

    it('rolls back all cleanup and ownership transfers if the user cannot be deleted', async () => {
        const before = await snapshot();
        await helper.runWithRetry("CREATE TRIGGER prevent_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await request(app).delete('/admin/users/2').expect(500);
            expect(await snapshot()).toEqual(before);
        } finally {
            log.mockRestore();
            await helper.runWithRetry('DROP TRIGGER prevent_user_delete');
        }
    });

    it('supports installations without the optional password reset tokens table', async () => {
        await helper.runWithRetry('ALTER TABLE password_reset_tokens RENAME TO unused_reset_tokens');
        await helper.runWithRetry('DELETE FROM unused_reset_tokens');
        try {
            await request(app).delete('/admin/users/2').expect(200);
            expect(await helper.getWithRetry('SELECT id FROM users WHERE id = 2')).toBeUndefined();
        } finally {
            await helper.runWithRetry('ALTER TABLE unused_reset_tokens RENAME TO password_reset_tokens');
        }
    });

    it.each(['/admin/users', '/users/manage'])('only shows delete controls for inactive users on %s', async url => {
        const { text } = await request(app).get(url).expect(200);
        const visibleButtons = [...text.matchAll(/<button\b[^>]*class="delete-user"[^>]*>/g)]
            .filter(([tag]) => !/\bhidden\b/.test(tag));
        expect(visibleButtons).toHaveLength(1);
        expect(visibleButtons[0][0]).toContain('data-user-id="2"');
        expect(text).toContain('/js/delete-user.js');
    });
});
