const express = require('express');
const router = express.Router();
const { isAuthenticated, isActive } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');

module.exports = function(db) {
    const dbHelper = new DatabaseHelper(db);
    
    // Get user's availability
    router.get('/', isAuthenticated, isActive, async (req, res) => {
        try {
            const weekOffset = parseInt(req.query.weekOffset) || 0;
            console.log('Week offset:', weekOffset);
            
            // Limit week offset between -1 (this week) and 0 (next week)
            const limitedOffset = Math.max(-1, Math.min(0, weekOffset));
            console.log('Limited offset:', limitedOffset);

            // Calculate the start of the target week
            const today = new Date();
            const targetWeekStart = new Date(today);
            targetWeekStart.setDate(today.getDate() + (8 - today.getDay()) + (limitedOffset * 7));
            console.log('Target week start:', targetWeekStart);

            // Format week title
            const weekTitle = limitedOffset === 0 ? 'Next Week' : 'This Week';
            console.log('Week title:', weekTitle);

            const availability = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT user_id, day_date, time_slot, is_available 
                     FROM availability 
                     WHERE user_id = ? 
                     AND day_date BETWEEN ? AND ?`,
                    [
                        req.user.id,
                        targetWeekStart.toISOString().split('T')[0],
                        new Date(targetWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
            console.log('User availability:', availability);

            // Get time slots
            const timeSlots = [
                { time: '8:00am', label: 'Morning' },
                { time: '12:30pm', label: 'Afternoon' },
                { time: '5:00pm', label: 'Evening' },
                { time: '9:30pm', label: 'Night' }
            ];
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

            console.log('Rendering availability view');
            res.render('availability', {
                user: req.user,
                userAvailability: availability,
                timeSlots,
                days,
                weekOffset: limitedOffset,
                weekTitle,
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
                    dayOfWeek: new Date(slot.date + 'T00:00:00Z').getUTCDay(),
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
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 