const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');

module.exports = function(db) {
    const dbHelper = new DatabaseHelper(db);

    // Admin dashboard
    router.get('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const nextWeekStart = new Date();
            nextWeekStart.setDate(nextWeekStart.getDate() + 7 - nextWeekStart.getDay() + 1);
            const nextWeekEnd = new Date(nextWeekStart);
            nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

            // Get only active users
            const users = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT id, first_name, last_name FROM users WHERE is_active = 1', 
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            // Get all availability for next week (only for active users)
            const availability = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT a.*, u.first_name, u.last_name 
                     FROM availability a
                     JOIN users u ON a.user_id = u.id
                     WHERE a.day_date BETWEEN ? AND ?
                     AND a.is_available = 1
                     AND u.is_active = 1`,
                    [
                        nextWeekStart.toISOString().split('T')[0],
                        nextWeekEnd.toISOString().split('T')[0]
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            // Get existing assignments (only for active users)
            const assignments = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT a.*, u.first_name, u.last_name 
                     FROM assignments a
                     JOIN users u ON a.user_id = u.id
                     WHERE a.day_date BETWEEN ? AND ?
                     AND u.is_active = 1`,
                    [
                        nextWeekStart.toISOString().split('T')[0],
                        nextWeekEnd.toISOString().split('T')[0]
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            res.render('admin', {
                user: req.user,
                users,
                availability,
                assignments,
                nextWeekStart
            });
        } catch (error) {
            console.error('Error loading admin dashboard:', error);
            res.status(500).render('error', { message: 'Server error', user: req.user });
        }
    });

    // User management page
    router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const users = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT id, first_name, last_name, email, is_admin, is_active FROM users ORDER BY last_name, first_name',
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows);
                    }
                );
            });

            res.render('admin/users', { 
                user: req.user,
                users: users
            });
        } catch (error) {
            console.error('Error loading user management:', error);
            res.status(500).render('error', { message: 'Server error', user: req.user });
        }
    });

    // Update assignments
    router.post('/assign', isAdmin, async (req, res) => {
        const { assignments } = req.body;
        
        try {
            await new Promise((resolve, reject) => {
                db.run('BEGIN TRANSACTION', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            for (const assignment of assignments) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO assignments (user_id, day_date, time_slot, assigned_by)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(day_date, time_slot)
                         DO UPDATE SET user_id = ?, assigned_by = ?`,
                        [
                            assignment.userId,
                            assignment.date,
                            assignment.time,
                            req.user.id,
                            assignment.userId,
                            req.user.id
                        ],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });
            }

            await new Promise((resolve, reject) => {
                db.run('COMMIT', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            res.json({ message: 'Assignments updated successfully' });
        } catch (error) {
            await new Promise((resolve) => {
                db.run('ROLLBACK', () => resolve());
            });
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 