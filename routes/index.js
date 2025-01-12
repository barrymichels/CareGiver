const express = require('express');
const router = express.Router();
const { isAuthenticated, isActive } = require('../middleware/auth');

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

module.exports = (db) => {
    // Export calendar endpoint
    router.get('/export-calendar', isAuthenticated, isActive, async (req, res) => {
        try {
            // Calculate week dates
            const today = new Date();
            const weekStart = new Date(today);
            const currentDay = today.getDay();
            weekStart.setDate(today.getDate() - currentDay + (currentDay === 0 ? -6 : 1));
            weekStart.setHours(0, 0, 0, 0);

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

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
                        weekStart.toISOString().split('T')[0],
                        weekEnd.toISOString().split('T')[0]
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    });
            });

            if (assignments.length === 0) {
                return res.status(404).json({ error: 'No shifts found for this week' });
            }

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

                // Create start date
                const startDate = new Date(assignment.day_date);
                startDate.setHours(hour, parseInt(minutes), 0, 0);

                // Create end date (15 minutes later)
                const endDate = new Date(startDate);
                endDate.setMinutes(endDate.getMinutes() + 15);

                icsContent = icsContent.concat([
                    'BEGIN:VEVENT',
                    `DTSTART:${formatDateToICS(startDate)}`,
                    `DTEND:${formatDateToICS(endDate)}`,
                    `SUMMARY:Your Shift`,
                    'END:VEVENT'
                ]);
            });

            icsContent.push('END:VCALENDAR');

            // Send the file
            res.setHeader('Content-Type', 'text/calendar');
            res.setHeader('Content-Disposition', `attachment; filename=schedule-${weekStart.toISOString().split('T')[0]}.ics`);
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

                const today = new Date();
                const weekStart = new Date(today);
                
                // Adjust to start of current week (Monday)
                const currentDay = weekStart.getDay();
                weekStart.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
                
                // Then, adjust by the week offset
                weekStart.setDate(weekStart.getDate() + (limitedOffset * 7));
                
                // Reset time to midnight UTC
                weekStart.setHours(0, 0, 0, 0);

                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                // Set weekEnd to end of day UTC
                weekEnd.setHours(23, 59, 59, 999);

                // Get assignments for the week
                const assignments = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT a.*, u.first_name || ' ' || u.last_name as user_name, u.id as user_id
                        FROM assignments a
                        JOIN users u ON a.user_id = u.id
                        WHERE day_date BETWEEN ? AND ?
                    `,
                        [
                            weekStart.toISOString().split('T')[0],
                            weekEnd.toISOString().split('T')[0]
                        ],
                        (err, rows) => {
                            if (err) reject(err);
                            resolve(rows || []);
                        });
                });

                // Get user availability for next week
                const nextWeekStart = new Date(today);
                nextWeekStart.setDate(today.getDate() + (8 - today.getDay())); // Next Monday
                const nextWeekEnd = new Date(nextWeekStart);
                nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

                const userAvailability = await new Promise((resolve, reject) => {
                    db.all(
                        'SELECT * FROM availability WHERE user_id = ? AND day_date BETWEEN ? AND ?',
                        [
                            req.user.id,
                            nextWeekStart.toISOString().split('T')[0],
                            nextWeekEnd.toISOString().split('T')[0]
                        ],
                        (err, rows) => {
                            if (err) reject(err);
                            // Convert SQLite integer to boolean
                            const converted = (rows || []).map(row => ({
                                ...row,
                                is_available: row.is_available === 1
                            }));
                            resolve(converted);
                        }
                    );
                });

                // Generate week title based on offset
                let weekTitle;
                switch (limitedOffset) {
                    case -4: weekTitle = '4 Weeks Ago'; break;
                    case -3: weekTitle = '3 Weeks Ago'; break;
                    case -2: weekTitle = '2 Weeks Ago'; break;
                    case -1: weekTitle = 'Last Week'; break;
                    case 0: weekTitle = 'This Week'; break;
                    case 1: weekTitle = 'Next Week'; break;
                    default: weekTitle = 'This Week';
                }

                res.render('dashboard', {
                    user: req.user,
                    weekTitle,
                    weekOffset: limitedOffset,
                    assignments,
                    userAvailability,
                    nextWeekAvailability: [],  // No longer needed since we're showing availability for the current view
                    weekStart // Pass the weekStart date to the template
                });
            } else {
                res.redirect('/login');
            }
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};