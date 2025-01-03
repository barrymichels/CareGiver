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
                const today = new Date();
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay() + 1); // Start from Monday
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);

                // Get assignments for the week
                const assignments = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT a.*, u.first_name || ' ' || u.last_name as user_name
                        FROM assignments a
                        JOIN users u ON a.user_id = u.id
                        WHERE a.day_date BETWEEN ? AND ?
                    `, [
                        weekStart.toISOString().split('T')[0],
                        weekEnd.toISOString().split('T')[0]
                    ], (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    });
                });

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

                res.render('dashboard', {
                    user: req.user,
                    weekStart,
                    weekTitle: 'This Week',
                    assignments,
                    userAvailability
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