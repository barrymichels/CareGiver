const path = require('path');
const express = require('express');
const request = require('supertest');
const sqlite3 = require('sqlite3');
const initializeDatabase = require('../../config/database.init');
const DatabaseHelper = require('../../utils/dbHelper');
const { weekWindowFor, formatLocalDate } = require('../../utils/weekView');

/**
 * GET /export-calendar, the calendar-client contract.
 *
 * Two RFC 5545 defects made this feed unusable in real clients, neither of them
 * anything to do with which week is exported:
 *
 *  - A VEVENT without UID and DTSTAMP is not a valid event. Clients dedupe a
 *    subscription on the UID alone, so with none, every refresh can add another
 *    copy of the same shift instead of updating it.
 *  - An empty week answered as an error, so the client marks the subscription
 *    broken and stops refreshing - the caregiver loses every later week too.
 *
 * These tests pin both, plus the two properties that keep them fixed: the UID is
 * identical across fetches of an unchanged shift, and the exported window is
 * still this Monday to this Sunday.
 */
describe('GET /export-calendar', () => {
    let db, helper, app;
    let userId;
    // Read once per test rather than at module load: the route works out the week
    // when the request arrives, and a suite that runs across midnight would
    // otherwise disagree with it about which Monday is "this" one.
    let sqlStart, sqlEnd, nextMondayKey;

    const shiftedWeekStart = (days) => {
        const date = new Date(weekWindowFor(0).start);
        date.setDate(date.getDate() + days);
        return date;
    };

    const insertAssignment = (dayDate, timeSlot, assignedUserId = userId) => helper.runWithRetry(
        'INSERT INTO assignments (user_id, day_date, time_slot, assigned_by) VALUES (?, ?, ?, ?)',
        [assignedUserId, dayDate, timeSlot, userId]
    );

    const exportCalendar = async () => {
        const response = await request(app).get('/export-calendar');
        expect(response.status).toBe(200);
        return response;
    };

    /** The VEVENT blocks of a response, as line arrays. */
    const events = text => (text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []).map(block => block.split('\r\n'));

    beforeAll(async () => {
        db = new sqlite3.Database(':memory:');
        helper = new DatabaseHelper(db);
        await helper.runWithRetry('PRAGMA foreign_keys = ON');
        await initializeDatabase(db);

        app = express();
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, '../../views'));
        app.locals.getPageTitle = title => title || 'CareGiver';
        // The repository's session stand-in: real isAuthenticated/isActive
        // middleware runs, against a req.user that came out of the database.
        app.use(async (req, res, next) => {
            const user = await helper.getWithRetry('SELECT * FROM users WHERE id = ?', [userId]);
            req.user = user;
            req.isAuthenticated = () => Boolean(user);
            next();
        });
        app.use('/', require('../../routes/index')(db));
    });

    beforeEach(async () => {
        const window = weekWindowFor(0);
        sqlStart = window.sqlStart;
        sqlEnd = window.sqlEnd;
        nextMondayKey = formatLocalDate(shiftedWeekStart(7));

        for (const table of ['assignments', 'availability', 'timeslots', 'timeslot_configurations',
            'template_slots', 'timeslot_templates', 'users']) {
            await helper.runWithRetry(`DELETE FROM ${table}`);
        }
        await helper.runWithRetry(
            "INSERT INTO users (id, first_name, last_name, email, is_admin, is_active) VALUES (1, 'Cass', 'Caregiver', 'cass@example.com', 0, 1)");
        userId = 1;
    });

    afterAll(() => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())));

    describe('a week with no shifts', () => {
        it('exportCalendar_whenTheWeekIsEmpty_shouldAnswerAValidEmptyVCalendar', async () => {
            // WHEN the calendar is fetched by a caregiver who has nothing this week,
            const response = await exportCalendar();

            // THEN it is a readable calendar with no events, not an error. A client
            // that gets a failure here marks the subscription broken and stops
            // refreshing, which would hide every week after this one as well.
            expect(response.text.split('\r\n')).toEqual([
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//CareGiver//EN',
                'CALSCALE:GREGORIAN',
                'END:VCALENDAR'
            ]);
            expect(events(response.text)).toEqual([]);
        });
    });

    describe('a week with shifts', () => {
        beforeEach(async () => {
            await insertAssignment(sqlStart, '9:00am');
            await insertAssignment(sqlEnd, '2:00pm');
        });

        it('exportCalendar_shouldGiveEveryEventTheTwoMandatoryProperties', async () => {
            const response = await exportCalendar();
            const blocks = events(response.text);

            // UID and DTSTAMP are the two properties RFC 5545 requires in a VEVENT,
            // and a client that cannot dedupe on the UID duplicates the shift on
            // every refresh.
            expect(blocks).toHaveLength(2);
            for (const block of blocks) {
                expect(block.some(line => /^UID:waynescheduler-\d{4}-\d{2}-\d{2}-[a-z0-9-]+@waynescheduler$/.test(line))).toBe(true);
                expect(block.some(line => /^DTSTAMP:\d{8}T\d{6}Z$/.test(line))).toBe(true);
            }
        });

        it('exportCalendar_shouldGiveEachShiftItsOwnUidAndReuseItOnTheNextFetch', async () => {
            // GIVEN two shifts in the same week,
            const first = events((await exportCalendar()).text);

            // THEN each one has a distinct identity...
            const uids = first.map(block => block.find(line => line.startsWith('UID:')));
            expect(new Set(uids).size).toBe(2);
            expect(new Set(uids).size).toBe(first.length);

            // ...and the same identity on the next fetch, which is what turns a
            // refresh into an update of the existing event instead of a second one.
            const second = events((await exportCalendar()).text);
            expect(second.map(block => block.find(line => line.startsWith('UID:')))).toEqual(uids);
        });

        it('exportCalendar_shouldStampTheGenerationTimeInUtc', async () => {
            const [block] = events((await exportCalendar()).text);
            const stamp = block.find(line => line.startsWith('DTSTAMP:'));

            // The trailing Z is a claim, so the instant behind it has to match:
            // this is when the file was built, nowhere near the shift itself.
            expect(stamp).toMatch(/^DTSTAMP:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
            const [, year, month, day, hour, minute, second] = stamp.match(/DTSTAMP:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
            const generated = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
            expect(Math.abs(Date.now() - generated)).toBeLessThan(60 * 1000);
        });

        it('exportCalendar_shouldDeclareTheCharset', async () => {
            const response = await exportCalendar();

            // Without a charset, clients that read the body as ISO-8859-1 turn a
            // shift label with an accented character into mojibake.
            expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
            expect(response.headers['content-disposition']).toMatch(/^attachment; filename=schedule-\d{4}-\d{2}-\d{2}\.ics$/);
        });

        it('exportCalendar_keepsExportingThisMondayToThisSundayAndNothingElse', async () => {
            // GIVEN a shift seven days out,
            await insertAssignment(nextMondayKey, '9:00am');

            // THEN the window is unchanged: the two shifts inside this week, and the
            // one beyond it stays out. Nothing in the RFC fixes is allowed to move
            // which week a subscriber gets.
            const response = await exportCalendar();

            expect(events(response.text)).toHaveLength(2);
            expect(response.text).not.toContain(`waynescheduler-${nextMondayKey}-9-00am`);
            expect(response.text).toContain(`waynescheduler-${sqlStart}-9-00am@waynescheduler`);
            expect(response.text).toContain(`waynescheduler-${sqlEnd}-2-00pm@waynescheduler`);
        });

        it('exportCalendar_escapesSeparatorsInTheConfiguredSummary', async () => {
            // GIVEN a summary an operator wrote with the punctuation TEXT cannot hold,
            const previous = process.env.ICS_EVENT_SUMMARY;
            process.env.ICS_EVENT_SUMMARY = 'Dinner, then meds; night';
            try {
                // THEN the exported line is still one property, not three.
                const [block] = events((await exportCalendar()).text);

                expect(block).toContain('SUMMARY:Dinner\\, then meds\\; night');
            } finally {
                if (previous === undefined) delete process.env.ICS_EVENT_SUMMARY;
                else process.env.ICS_EVENT_SUMMARY = previous;
            }
        });
    });
});
