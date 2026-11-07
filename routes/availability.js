const express = require('express');
const { isAuthenticated, isActive } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');
const TimeslotManager = require('../utils/timeslotManager');
const { WEEK_DAYS, weekTitleFor, weekWindowFor, weekDatesFor, weekday } = require('../utils/weekView');

module.exports = function (db) {
    // Must stay inside the factory: a module-level router is shared by every require() call,
    // so a second caller would silently receive the first caller's routes and database.
    const router = express.Router();
    const dbHelper = new DatabaseHelper(db);
    const timeslotManager = new TimeslotManager(db);

    // Get user's availability
    router.get('/', isAuthenticated, isActive, async (req, res) => {
        try {
            const weekOffset = parseInt(req.query.weekOffset) || 0;

            // Limit week offset between -1 and 1
            const limitedOffset = Math.max(-1, Math.min(1, weekOffset));

            // Monday..Sunday of the target week, as New York calendar dates
            const { start: targetWeekStart, sqlStart, sqlEnd } = weekWindowFor(limitedOffset);

            // Format week title
            const weekTitle = weekTitleFor(limitedOffset);

            const availability = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT user_id, day_date, time_slot, is_available 
                     FROM availability 
                     WHERE user_id = ? 
                     AND day_date BETWEEN ? AND ?`,
                    [
                        req.user.id,
                        sqlStart,
                        sqlEnd
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

            // Get dynamic timeslots for the week
            const weekData = await timeslotManager.getTimeslotsForWeek(targetWeekStart);
            
            const days = WEEK_DAYS;

            res.render('availability', {
                user: req.user,
                userAvailability: availability,
                weekData,
                days,
                weekOffset: limitedOffset,
                weekTitle,
                weekDates: weekDatesFor(targetWeekStart),
                weekStart: targetWeekStart
            });
        } catch (error) {
            console.error('Error loading availability:', error);
            res.status(500).render('error', {
                message: 'Server error',
                user: req.user || {}
            });
        }
    });

    // Update availability
    router.post('/update', isAuthenticated, isActive, async (req, res) => {
        const { availability } = req.body;

        if (!availability || !Array.isArray(availability) || !availability.length) {
            return res.status(400).json({ error: 'Invalid availability data' });
        }

        // Validate availability data
        for (const slot of availability) {
            if (!slot.date || !slot.time || typeof slot.isAvailable !== 'boolean') {
                return res.status(400).json({ error: 'Invalid slot data' });
            }
        }

        try {
            await dbHelper.withTransaction(async () => {
                await timeslotManager.validateScheduledSlots(availability);
                // Insert new availability, using REPLACE to handle any duplicates
                for (const slot of availability) {
                    await dbHelper.runWithRetry(
                        `INSERT OR REPLACE INTO availability (user_id, day_date, time_slot, is_available)
                         VALUES (?, ?, ?, ?)`,
                        [req.user.id, slot.date, slot.time, slot.isAvailable ? 1 : 0]
                    );
                }

                // Store preferences
                const defaultPrefs = availability.map(slot => ({
                    dayOfWeek: (weekday(slot.date) + 1) % 7,
                    time: slot.time,
                    isAvailable: slot.isAvailable
                }));

                await dbHelper.runWithRetry(
                    `INSERT OR REPLACE INTO user_preferences (user_id, preferences)
                     VALUES (?, ?)`,
                    [req.user.id, JSON.stringify(defaultPrefs)]
                );
            });

            res.json({ message: 'Availability updated successfully' });
        } catch (error) {
            console.error('Availability update error:', error);
            res.status(error.status || 500).json({ error: error.status ? error.message : 'Server error' });
        }
    });

    return router;
};