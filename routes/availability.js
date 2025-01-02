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
        
        if (!availability || !Array.isArray(availability) || !availability.length) {
            return res.status(400).json({ error: 'Invalid availability data' });
        }

        // Validate availability data
        for (const slot of availability) {
            if (!slot.date || !slot.time || typeof slot.isAvailable !== 'boolean') {
                return res.status(400).json({ error: 'Invalid slot data' });
            }
            
            // Validate date format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
                return res.status(400).json({ error: 'Invalid date format' });
            }
            
            // Validate time format
            if (!/^([1-9]|1[0-2]):[0-5][0-9](am|pm)$/i.test(slot.time)) {
                return res.status(400).json({ error: 'Invalid time format' });
            }
        }
        
        try {
            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    let hasError = false;

                    db.run('BEGIN TRANSACTION', err => {
                        if (err) {
                            hasError = true;
                            reject(err);
                        }
                    });

                    if (!hasError) {
                        // Delete existing availability for these dates
                        const dates = [...new Set(availability.map(slot => slot.date))];
                        dates.forEach(date => {
                            db.run(
                                'DELETE FROM availability WHERE user_id = ? AND day_date = ?',
                                [req.user.id, date],
                                err => {
                                    if (err) {
                                        hasError = true;
                                        reject(err);
                                    }
                                }
                            );
                        });
                    }

                    if (!hasError) {
                        // Insert new availability
                        availability.forEach(slot => {
                            db.run(
                                `INSERT INTO availability (user_id, day_date, time_slot, is_available)
                                 VALUES (?, ?, ?, ?)`,
                                [req.user.id, slot.date, slot.time, slot.isAvailable ? 1 : 0],
                                err => {
                                    if (err) {
                                        hasError = true;
                                        reject(err);
                                    }
                                }
                            );
                        });
                    }

                    if (!hasError) {
                        // Store user's default preferences
                        const defaultPrefs = availability.map(slot => {
                            const date = new Date(slot.date + 'T00:00:00Z'); // Force UTC
                            return {
                                dayOfWeek: (date.getUTCDay() + 6) % 7 + 1, // Convert to 1-7 (Mon-Sun)
                                time: slot.time,
                                isAvailable: slot.isAvailable
                            };
                        });

                        db.run(
                            `INSERT OR REPLACE INTO user_preferences (user_id, preferences)
                             VALUES (?, ?)`,
                            [req.user.id, JSON.stringify(defaultPrefs)],
                            err => {
                                if (err) {
                                    hasError = true;
                                    reject(err);
                                }
                            }
                        );
                    }

                    if (hasError) {
                        db.run('ROLLBACK', () => {
                            reject(new Error('Transaction failed'));
                        });
                    } else {
                        db.run('COMMIT', err => {
                            if (err) {
                                db.run('ROLLBACK', () => {
                                    reject(err);
                                });
                            } else {
                                resolve();
                            }
                        });
                    }
                });
            });

            // Wait for transaction to complete
            await new Promise(resolve => setTimeout(resolve, 100));

            res.json({ message: 'Availability updated successfully' });
        } catch (error) {
            console.error('Availability update error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 