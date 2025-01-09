const express = require('express');
const router = express.Router();
const { isAuthenticated, isActive } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');

module.exports = function(db) {
    const dbHelper = new DatabaseHelper(db);
    
    // Get user's availability
    router.get('/', isAuthenticated, isActive, async (req, res) => {
        try {
            const availability = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT user_id, day_date, time_slot, is_available FROM availability WHERE user_id = ?',
                    [req.user.id],
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
            res.json(availability);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
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