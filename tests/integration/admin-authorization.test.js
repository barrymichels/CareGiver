const { weekStartFor, addDays } = require('../../utils/weekView');
const path = require('path');
const express = require('express');
const request = require('supertest');
const sqlite3 = require('sqlite3');
const initializeDatabase = require('../../config/database.init');
const DatabaseHelper = require('../../utils/dbHelper');
const TimeslotManager = require('../../utils/timeslotManager');

/**
 * Every admin endpoint, driven by a caregiver who is signed in but is not an admin.
 *
 * The existing admin suites set `req.user = { is_admin: true }` in a middleware
 * placed *above* the router, so the routes' own `isAdmin` never decides anything:
 * delete that middleware from a route and those suites stay green while any
 * household member can flip accounts, rewrite the week's schedule or delete
 * templates. Here the identity comes from a database row, so the only thing that
 * can answer 403 is the route's own guard.
 *
 * Each endpoint is driven twice. As a non-admin it must answer 403 with the
 * middleware's body and leave every table byte-identical. As an admin it must
 * answer with something *other* than 403: without that second half a route could
 * 403 for its own unrelated reason and the non-admin expectation would pass while
 * guarding nothing.
 *
 * Session note: the repository's integration suites stand in for the session
 * layer by assigning `req.user` and `req.isAuthenticated` above the router (see
 * tests/integration/delete-users.test.js), which is what lets the real
 * isAuthenticated/isAdmin middleware run. This follows that pattern and takes the
 * user row from the database rather than writing one by hand, so `is_admin` is
 * data, not a test fixture's assertion.
 */
describe('Admin authorization', () => {
    let db, helper, manager, app, currentUser;
    let adminId, caregiverId, inactiveId, virtualId, configId, templateId, defaultTemplateId;
    let currentWeek, nextWeek, currentKey, nextKey;

    const usersTable = ['availability', 'assignments', 'user_preferences', 'notification_settings',
        'morning_summary_log', 'timeslots', 'timeslot_configurations', 'template_slots',
        'timeslot_templates', 'users'];

    const slot = (time, order = 0, day = 0) => ({ day_of_week: day, time, label: time, slot_order: order });

    // Row counts rather than contents: the point is that a refused request wrote
    // nothing, and contents would make this suite depend on incidental timestamps.
    const snapshot = async () => Object.fromEntries(await Promise.all(
        usersTable.map(async table => [table, (await helper.getWithRetry(`SELECT COUNT(*) AS n FROM ${table}`)).n])
    ));

    const asNonAdmin = async () => { currentUser = await helper.getWithRetry('SELECT * FROM users WHERE id = ?', [caregiverId]); };
    const asAdmin = async () => { currentUser = await helper.getWithRetry('SELECT * FROM users WHERE id = ?', [adminId]); };

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
            req.user = currentUser;
            req.isAuthenticated = () => Boolean(currentUser);
            next();
        });
        // Mounted in the same order as app.js: the more specific admin routers
        // first, so /admin/timeslots is not swallowed by /admin.
        app.use('/admin/timeslots', require('../../routes/admin/timeslots')(db));
        app.use('/admin/timeslot-templates', require('../../routes/admin/templates')(db));
        app.use('/admin', require('../../routes/admin')(db));
    });

    beforeEach(async () => {
        for (const table of usersTable) await helper.runWithRetry(`DELETE FROM ${table}`);

        await helper.runWithRetry(`INSERT INTO users (id, first_name, last_name, email, is_admin, is_active) VALUES
            (1, 'Ada', 'Admin', 'admin@example.com', 1, 1),
            (2, 'Cass', 'Caregiver', 'cass@example.com', 0, 1),
            (3, 'Ivan', 'Inactive', 'ivan@example.com', 0, 0)`);
        await helper.runWithRetry(
            "INSERT INTO users (id, first_name, last_name, is_admin, is_active) VALUES (4, 'Vera', 'Virtual', 0, 1)");
        [adminId, caregiverId, inactiveId, virtualId] = [1, 2, 3, 4];

        // The week's own schedule, so the payloads below are the ones the real
        // screens send rather than shapes that would be rejected anyway.
        currentWeek = weekStartFor(new Date());
        nextWeek = addDays(currentWeek, 7);
        currentKey = currentWeek;
        nextKey = nextWeek;
        const week = await manager.createTimeslotConfiguration(
            currentWeek,
            [slot('8:00am'), slot('12:30pm', 1), slot('5:00pm', 2), slot('9:30pm', 3)],
            adminId
        );
        configId = week.config.id;
        templateId = (await manager.createTemplate('Alternate routine', '', [slot('9:00am')], adminId)).id;
        defaultTemplateId = (await manager.createTemplate('Standard', '', Object.values(manager.getFallbackTimeslots()).flat(), adminId, true)).id;

        await asNonAdmin();
    });

    afterAll(() => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())));

    /** State-changing endpoints, read off routes/admin.js, routes/admin/timeslots.js and routes/admin/templates.js. */
    const stateChanging = [
        { name: 'POST /admin/assign', method: 'post', url: () => '/admin/assign', body: () => ({ assignments: [] }) },
        { name: 'PUT /admin/users/:id', method: 'put', url: () => `/admin/users/${inactiveId}`, body: () => ({ is_active: true }) },
        { name: 'DELETE /admin/users/:id', method: 'delete', url: () => `/admin/users/${inactiveId}`, body: () => ({}) },
        { name: 'POST /admin/users/virtual', method: 'post', url: () => '/admin/users/virtual', body: () => ({ firstName: 'Vic', lastName: 'Virtual' }) },
        { name: 'POST /admin/users/:id/convert', method: 'post', url: () => `/admin/users/${virtualId}/convert`, body: () => ({ email: 'vera@example.com' }) },
        { name: 'POST /admin/users/:id/availability', method: 'post', url: () => `/admin/users/${caregiverId}/availability`, body: () => ({ availability: [{ date: currentKey, time: '8:00am', isAvailable: true }] }) },
        { name: 'POST /admin/users/add', method: 'post', url: () => '/admin/users/add', body: () => ({ firstName: 'New', lastName: 'Caregiver', email: 'new@example.com' }) },
        { name: 'POST /admin/timeslots', method: 'post', url: () => '/admin/timeslots', body: () => ({ weekStart: nextKey, slots: [slot('9:00am')] }) },
        { name: 'PUT /admin/timeslots/:id', method: 'put', url: () => `/admin/timeslots/${configId}`, body: () => ({ slots: [slot('8:00am')] }) },
        { name: 'POST /admin/timeslots/copy', method: 'post', url: () => '/admin/timeslots/copy', body: () => ({ targetWeekStart: nextKey, sourceWeekStart: currentKey }) },
        { name: 'POST /admin/timeslots/apply-template', method: 'post', url: () => '/admin/timeslots/apply-template', body: () => ({ weekStart: nextKey, templateId }) },
        { name: 'POST /admin/timeslots/:id/reset-default', method: 'post', url: () => `/admin/timeslots/${configId}/reset-default`, body: () => ({}) },
        { name: 'POST /admin/timeslot-templates', method: 'post', url: () => '/admin/timeslot-templates', body: () => ({ name: 'Extra routine', slots: [slot('9:00am')] }) },
        { name: 'PUT /admin/timeslot-templates/:id', method: 'put', url: () => `/admin/timeslot-templates/${templateId}`, body: () => ({ name: 'Edited routine', slots: [slot('9:30am')] }) },
        { name: 'DELETE /admin/timeslot-templates/:id', method: 'delete', url: () => `/admin/timeslot-templates/${templateId}`, body: () => ({}) },
        { name: 'POST /admin/timeslot-templates/:id/set-default', method: 'post', url: () => `/admin/timeslot-templates/${templateId}/set-default`, body: () => ({}) },
        { name: 'POST /admin/timeslot-templates/:id/apply', method: 'post', url: () => `/admin/timeslot-templates/${templateId}/apply`, body: () => ({ weekStart: nextKey }) },
        { name: 'POST /admin/timeslot-templates/from-week', method: 'post', url: () => '/admin/timeslot-templates/from-week', body: () => ({ name: 'Saved week', weekStart: currentKey }) }
    ];

    /** Admin-guarded reads. Not state-changing, but a missing guard leaks the whole household's data. */
    const adminReads = [
        { name: 'GET /admin', method: 'get', url: () => '/admin' },
        { name: 'GET /admin/users', method: 'get', url: () => '/admin/users' },
        { name: 'GET /admin/users/:id/availability', method: 'get', url: () => `/admin/users/${caregiverId}/availability` },
        { name: 'GET /admin/timeslots', method: 'get', url: () => '/admin/timeslots' },
        { name: 'GET /admin/timeslots/:weekStart', method: 'get', url: () => `/admin/timeslots/${currentKey}` },
        { name: 'GET /admin/timeslots/check-conflicts/:weekStart', method: 'get', url: () => `/admin/timeslots/check-conflicts/${currentKey}` },
        { name: 'GET /admin/timeslot-templates', method: 'get', url: () => '/admin/timeslot-templates' },
        { name: 'GET /admin/timeslot-templates/:id', method: 'get', url: () => `/admin/timeslot-templates/${templateId}` }
    ];

    it.each(stateChanging)('refuses a signed-in non-admin and changes nothing: $name', async ({ method, url, body }) => {
        const before = await snapshot();

        const response = await request(app)[method](url()).send(body());

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Admin access required' });
        expect(await snapshot()).toEqual(before);
    });

    it.each(stateChanging)('answers an admin with something other than the guard: $name', async ({ method, url, body }) => {
        await asAdmin();

        const response = await request(app)[method](url()).send(body());

        // The point is only that a valid caller gets past isAdmin, so the 403
        // above can only have come from the guard and not from this same request
        // shape being rejected by the handler for an unrelated reason.
        expect(response.status).not.toBe(403);
    });

    it.each(adminReads)('refuses a signed-in non-admin: $name', async ({ method, url }) => {
        const response = await request(app)[method](url());

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Admin access required' });
    });

    it.each(adminReads)('answers an admin with something other than the guard: $name', async ({ method, url }) => {
        await asAdmin();

        const response = await request(app)[method](url());

        expect(response.status).not.toBe(403);
    });

    it('refuses an unauthenticated caller on every state-changing endpoint too', async () => {
        currentUser = null;
        const before = await snapshot();

        for (const { method, url, body } of stateChanging) {
            const response = await request(app)[method](url()).send(body());

            // Either answer is a refusal, and the difference is deliberate:
            // isAuthenticated sends a browser to the login page, isAuthenticatedApi
            // answers the JSON 403 that public/js talks to.
            expect([302, 403]).toContain(response.status);
            if (response.status === 302) expect(response.headers.location).toBe('/login');
        }
        expect(await snapshot()).toEqual(before);
    });

    it('derives the decision from the database row, not from the caller', async () => {
        // GIVEN a caregiver the admin has just promoted in the database,
        await helper.runWithRetry('UPDATE users SET is_admin = 1 WHERE id = ?', [caregiverId]);
        await asNonAdmin(); // re-reads the row, exactly as a fresh session would

        // WHEN they repeat a request that was refused a moment ago,
        const response = await request(app).post('/admin/users/virtual').send({ firstName: 'Vic', lastName: 'Virtual' });

        // THEN it is allowed. The guard reads the user it was handed, so a role
        // change takes effect on the next request rather than being frozen into a
        // fixture the way `req.user = { is_admin: true }` freezes it.
        expect(response.status).toBe(200);
    });
});
