const express = require('express');
const router = express.Router();
const { isAuthenticated, isActive } = require('../middleware/auth');

module.exports = function(db) {
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
        
        try {
            await new Promise((resolve, reject) => {
                db.run('BEGIN TRANSACTION', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            for (const slot of availability) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO availability (user_id, day_date, time_slot, is_available)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(user_id, day_date, time_slot)
                         DO UPDATE SET is_available = ?`,
                        [req.user.id, slot.date, slot.time, slot.isAvailable, slot.isAvailable],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });
            }

            // Store user's default preferences
            const defaultPrefs = availability.map(slot => ({
                dayOfWeek: new Date(slot.date).getDay(),
                time: slot.time,
                isAvailable: slot.isAvailable
            }));

            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO user_preferences (user_id, preferences)
                     VALUES (?, ?)`,
                    [req.user.id, JSON.stringify(defaultPrefs)],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            await new Promise((resolve, reject) => {
                db.run('COMMIT', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            res.json({ message: 'Availability updated successfully' });
        } catch (error) {
            await new Promise((resolve) => {
                db.run('ROLLBACK', () => resolve());
            });
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 