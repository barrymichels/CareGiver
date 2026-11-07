const express = require('express');
const { isAuthenticated, isAuthenticatedApi, isActive } = require('../middleware/auth');
const TimeslotManager = require('../utils/timeslotManager');
const { weekTitleFor, weekWindowFor, weekDatesFor } = require('../utils/weekView');

function checkSetupRequired(db) {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM users', (err, result) => {
            if (err) reject(err);
            resolve(result.count === 0);
        });
    });
}

function formatDateToICS(date) {
    // Pad a number with leading zeros
    const pad = (num) => (num < 10 ? '0' : '') + num;

    // Format in local time
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    return `${year}${month}${day}T${hours}${minutes}00`;
}

/**
 * UID of one shift, as RFC 5545 requires every VEVENT to have.
 *
 * Calendar clients dedupe a recurring subscription on this string alone: get it
 * wrong and every refresh adds another copy of the shift instead of updating the
 * one it already has. `(day_date, time_slot)` is UNIQUE in `assignments`, so
 * those two parts identify the row for as long as it exists, and the same shift
 * produces the same UID however often it is fetched.
 *
 * The host part is a literal, not `req.hostname` or BASE_URL, on purpose: the
 * same subscription is reached through the container IP, the LAN name and the
 * proxy domain, and a host-dependent UID would make each of them a different
 * event and put the duplicates straight back.
 */
function eventUid(assignment) {
    const slot = String(assignment.time_slot).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `waynescheduler-${assignment.day_date}-${slot}@waynescheduler`;
}

/** DTSTAMP - RFC 5545's second mandatory VEVENT property, always UTC. */
function formatUtcToICS(date) {
    const pad = (num) => (num < 10 ? '0' : '') + num;

    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
        + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Escape a value for an ICS TEXT field (RFC 5545 3.3.11). */
function escapeICSText(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

module.exports = (db) => {
    // Must stay inside the factory: a module-level router is shared by every require() call,
    // so a second caller would silently receive the first caller's routes and database.
    const router = express.Router();
    const timeslotManager = new TimeslotManager(db);
    // Export calendar endpoint
    router.get('/export-calendar', isAuthenticatedApi, isActive, async (req, res) => {
        try {
            // Monday..Sunday of the current week, as New York calendar dates
            const { sqlStart, sqlEnd } = weekWindowFor(0);

            // Get user's assignments for the week
            const assignments = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT a.*, u.first_name || ' ' || u.last_name as user_name
                    FROM assignments a
                    LEFT JOIN users u ON a.user_id = u.id
                    WHERE a.user_id = ? AND day_date BETWEEN ? AND ?
                `,
                    [
                        req.user.id,
                        sqlStart,
                        sqlEnd
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    });
            });

            // An empty week is a valid answer, not an error: a subscription whose
            // fetch fails gets marked broken by the client and stops refreshing,
            // so the caregiver whose week happens to be empty loses the feed for
            // every later week too. Always emit a well-formed VCALENDAR.
            const generatedAt = formatUtcToICS(new Date());

            // Generate ICS content
            let icsContent = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//CareGiver//EN',
                'CALSCALE:GREGORIAN'
            ];

            assignments.forEach(assignment => {
                // Parse the time
                const timeMatch = assignment.time_slot.match(/(\d+):(\d+)([ap]m)/i);
                if (!timeMatch) return;

                const [hours, minutes, period] = timeMatch.slice(1);
                let hour = parseInt(hours);

                // Convert to 24-hour format
                if (period.toLowerCase() === 'pm' && hour !== 12) {
                    hour += 12;
                } else if (period.toLowerCase() === 'am' && hour === 12) {
                    hour = 0;
                }

                // Create start date - parse as local timezone to avoid UTC offset issues
                const dateComponents = assignment.day_date.split('-');
                const startDate = new Date(
                    parseInt(dateComponents[0]), // year
                    parseInt(dateComponents[1]) - 1, // month (0-based)
                    parseInt(dateComponents[2]) // day
                );
                startDate.setHours(hour, parseInt(minutes), 0, 0);

                // Create end date (15 minutes later)
                const endDate = new Date(startDate);
                endDate.setMinutes(endDate.getMinutes() + 15);

                icsContent = icsContent.concat([
                    'BEGIN:VEVENT',
                    `UID:${eventUid(assignment)}`,
                    `DTSTAMP:${generatedAt}`,
                    `DTSTART:${formatDateToICS(startDate)}`,
                    `DTEND:${formatDateToICS(endDate)}`,
                    `SUMMARY:${escapeICSText(process.env.ICS_EVENT_SUMMARY || 'CareGiver Shift')}`,
                    'BEGIN:VALARM',
                    'ACTION:DISPLAY',
                    'DESCRIPTION:Reminder',
                    'TRIGGER:-PT15M',  // 15 minutes before
                    'END:VALARM',
                    'END:VEVENT'
                ]);
            });

            icsContent.push('END:VCALENDAR');

            // Send the file. The charset matters: an ICS body with no charset is
            // read as ISO-8859-1 by several clients, which mangles any shift name
            // with a non-ASCII character in it.
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=schedule-${sqlStart}.ics`);
            res.send(icsContent.join('\r\n'));

        } catch (error) {
            console.error('Error exporting calendar:', error);
            res.status(500).json({ error: 'Failed to export calendar' });
        }
    });

    router.get('/', async (req, res, next) => {
        try {
            const needsSetup = await checkSetupRequired(db);
            if (needsSetup) {
                return res.redirect('/setup');
            }
            next();
        } catch (error) {
            console.error('Error in setup check:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }, isAuthenticated, isActive, async (req, res) => {
        try {
            if (req.isAuthenticated()) {
                const weekOffset = parseInt(req.query.weekOffset) || 0; // Default to 0 (current week)

                // Limit week offset between -4 and 1
                const limitedOffset = Math.max(-4, Math.min(1, weekOffset));

                const { start: weekStart, sqlStart, sqlEnd } = weekWindowFor(limitedOffset);

                // Get assignments for the week
                const assignments = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT a.*, u.first_name || ' ' || u.last_name as user_name, u.id as user_id
                        FROM assignments a
                        JOIN users u ON a.user_id = u.id
                        WHERE day_date BETWEEN ? AND ?
                    `,
                        [
                            sqlStart,
                            sqlEnd
                        ],
                        (err, rows) => {
                            if (err) reject(err);
                            resolve(rows || []);
                        });
                });

                // Generate week title based on offset
                const weekTitle = weekTitleFor(limitedOffset);

                // Get dynamic timeslots for the week
                const weekData = await timeslotManager.getTimeslotsForWeek(weekStart);

                res.render('dashboard', {
                    user: req.user,
                    weekTitle,
                    weekOffset: limitedOffset,
                    assignments,
                    weekDates: weekDatesFor(weekStart),
                    weekStart, // Date-only Monday
                    weekData // Pass the dynamic timeslots
                });
            } else {
                res.redirect('/login');
            }
        } catch (error) {
            console.error('Dashboard error:', error);
            res.status(500).render('error', { 
                message: 'Server error loading dashboard', 
                user: req.user || {} 
            });
        }
    });

    return router;
};