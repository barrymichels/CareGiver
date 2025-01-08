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

module.exports = (db) => {
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
                weekStart.setDate(today.getDate() - (weekStart.getDay() - 1) + (limitedOffset * 7));
                // Reset time to midnight UTC
                weekStart.setHours(0, 0, 0, 0);

                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                // Set weekEnd to end of day UTC
                weekEnd.setHours(23, 59, 59, 999);

                // Get assignments for the week
                const assignments = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT a.*, u.first_name || ' ' || u.last_name as user_name
                        FROM assignments a
                        LEFT JOIN users u ON a.user_id = u.id
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

                // Get user availability
                const userAvailability = await new Promise((resolve, reject) => {
                    db.all(
                        'SELECT * FROM availability WHERE user_id = ?',
                        [req.user.id],
                        (err, rows) => {
                            if (err) reject(err);
                            resolve(rows || []);
                        }
                    );
                });

                // Get user availability for next week (always)
                const nextWeekStart = new Date(today);
                nextWeekStart.setDate(today.getDate() + (8 - today.getDay())); // Move to next Monday
                const nextWeekEnd = new Date(nextWeekStart);
                nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

                const nextWeekAvailability = await new Promise((resolve, reject) => {
                    db.all(
                        'SELECT * FROM availability WHERE user_id = ? AND day_date BETWEEN ? AND ?',
                        [
                            req.user.id,
                            nextWeekStart.toISOString().split('T')[0],
                            nextWeekEnd.toISOString().split('T')[0]
                        ],
                        (err, rows) => {
                            if (err) reject(err);
                            resolve(rows || []);
                        }
                    );
                });

                // Generate week title based on offset
                const weekTitleDate = new Date(weekStart);
                weekTitleDate.setHours(0, 0, 0, 0);
                const formattedDate = weekTitleDate.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
                let weekTitle = `Week of ${formattedDate}`;

                res.render('dashboard', {
                    user: req.user,
                    weekTitle,
                    weekOffset: limitedOffset,
                    assignments,
                    userAvailability,
                    nextWeekAvailability
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