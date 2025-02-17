const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

module.exports = function (db) {
    const dbHelper = new DatabaseHelper(db);

    // Admin dashboard
    router.get('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const weekOffset = parseInt(req.query.weekOffset) || 0;
            // Limit week offset between -4 and 4
            const limitedOffset = Math.max(-4, Math.min(4, weekOffset));

            const today = new Date();
            const targetWeekStart = new Date(today);
            // Calculate target week start based on offset
            targetWeekStart.setDate(today.getDate() + 7 - today.getDay() + 1 + (limitedOffset * 7));
            const targetWeekEnd = new Date(targetWeekStart);
            targetWeekEnd.setDate(targetWeekStart.getDate() + 6);

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

            // Get availability for target week
            const availability = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT a.*, u.first_name, u.last_name 
                     FROM availability a
                     JOIN users u ON a.user_id = u.id
                     WHERE a.day_date BETWEEN ? AND ?
                     AND a.is_available = 1
                     AND u.is_active = 1`,
                    [
                        targetWeekStart.toISOString().split('T')[0],
                        targetWeekEnd.toISOString().split('T')[0]
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            // Get assignments for target week
            const assignments = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT a.*, u.first_name, u.last_name 
                     FROM assignments a
                     JOIN users u ON a.user_id = u.id
                     WHERE a.day_date BETWEEN ? AND ?
                     AND u.is_active = 1`,
                    [
                        targetWeekStart.toISOString().split('T')[0],
                        targetWeekEnd.toISOString().split('T')[0]
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            // Generate week title based on offset
            let weekTitle;
            switch (limitedOffset) {
                case -4: weekTitle = '4 Weeks Ago'; break;
                case -3: weekTitle = '3 Weeks Ago'; break;
                case -2: weekTitle = '2 Weeks Ago'; break;
                case -1: weekTitle = 'This Week'; break;  // Changed from 'Last Week'
                case 0: weekTitle = 'Next Week'; break;
                case 1: weekTitle = 'Week After Next'; break;
                default: weekTitle = `${Math.abs(limitedOffset)} Weeks ${limitedOffset > 0 ? 'Ahead' : 'Ago'}`;
            }

            res.render('admin', {
                user: req.user,
                users,
                availability,
                assignments,
                nextWeekStart: targetWeekStart,
                weekTitle,
                weekOffset: limitedOffset
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
                if (assignment.unassign) {
                    // Delete the assignment if unassign flag is true
                    await new Promise((resolve, reject) => {
                        db.run(
                            `DELETE FROM assignments 
                             WHERE day_date = ? AND time_slot = ?`,
                            [
                                assignment.date,
                                assignment.time
                            ],
                            (err) => {
                                if (err) reject(err);
                                resolve();
                            }
                        );
                    });
                } else {
                    // Insert or update assignment as before
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

    // Update user status (active/admin)
    router.put('/users/:id', isAuthenticated, isAdmin, async (req, res) => {
        const { id } = req.params;
        const { is_active, is_admin } = req.body;

        try {
            // Validate that we're only updating one field at a time
            if (typeof is_active !== 'boolean' && typeof is_admin !== 'boolean') {
                return res.status(400).json({ error: 'Invalid update parameters' });
            }

            // Don't allow deactivating yourself
            if (typeof is_active === 'boolean' && !is_active && parseInt(id) === req.user.id) {
                return res.status(400).json({ error: 'Cannot deactivate your own account' });
            }

            // Don't allow removing your own admin status
            if (typeof is_admin === 'boolean' && !is_admin && parseInt(id) === req.user.id) {
                return res.status(400).json({ error: 'Cannot remove your own admin status' });
            }

            const field = typeof is_active === 'boolean' ? 'is_active' : 'is_admin';
            const value = typeof is_active === 'boolean' ? is_active : is_admin;

            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE users SET ${field} = ? WHERE id = ?`,
                    [value, id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            res.json({ message: 'User updated successfully' });
        } catch (error) {
            console.error('Error updating user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Create virtual user
    router.post('/users/virtual', isAuthenticated, isAdmin, async (req, res) => {
        const { firstName, lastName } = req.body;

        try {
            // Basic validation
            if (!firstName || !lastName) {
                return res.status(400).json({ error: 'First and last name are required' });
            }

            // Create virtual user (no email/password)
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO users (first_name, last_name, is_active) VALUES (?, ?, 1)',
                    [firstName.trim(), lastName.trim()],
                    function (err) {
                        if (err) reject(err);
                        resolve(this.lastID);
                    }
                );
            });

            res.json({ message: 'Virtual user created successfully' });
        } catch (error) {
            console.error('Error creating virtual user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Convert virtual user to real user
    router.post('/users/:id/convert', isAuthenticated, isAdmin, async (req, res) => {
        const { id } = req.params;
        const { email } = req.body;

        try {
            // Basic validation
            if (!email) {
                return res.status(400).json({ error: 'Email is required' });
            }

            // Email format validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            // Check if user exists and is virtual
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM users WHERE id = ?',
                    [id],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (user.email) {
                return res.status(400).json({ error: 'User is already a real user' });
            }

            // Check if email is already in use
            const existingUser = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM users WHERE email = ?',
                    [email.toLowerCase()],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Email is already registered' });
            }

            // Generate a random password
            const tempPassword = crypto.randomBytes(16).toString('hex');
            const hashedPassword = await bcrypt.hash(tempPassword, 10);

            // Update user with email and password
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET email = ?, password = ? WHERE id = ?',
                    [email.toLowerCase(), hashedPassword, id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // Create password reset token
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            // Store reset token
            await new Promise((resolve, reject) => {
                db.run(
                    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
                        token TEXT PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        expires_at DATETIME NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )`,
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)',
                    [token, id, expiresAt.toISOString()],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // Return success with reset link
            const resetLink = `${process.env.BASE_URL}/auth/reset-password/${token}`;
            res.json({
                message: 'User converted successfully',
                resetLink
            });
        } catch (error) {
            console.error('Error converting user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Get virtual user availability page
    router.get('/users/:id/availability', isAuthenticated, isAdmin, async (req, res) => {
        const { id } = req.params;

        try {
            // Get user info
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM users WHERE id = ?',
                    [id],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Get user's availability for next week
            const today = new Date();
            const nextWeekStart = new Date(today);
            nextWeekStart.setDate(today.getDate() + (8 - today.getDay())); // Next Monday
            const nextWeekEnd = new Date(nextWeekStart);
            nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

            const availability = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT * FROM availability 
                     WHERE user_id = ? 
                     AND day_date BETWEEN ? AND ?`,
                    [
                        id,
                        nextWeekStart.toISOString().split('T')[0],
                        nextWeekEnd.toISOString().split('T')[0]
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            // Get time slots configuration
            const timeSlots = [
                { time: '8:00am', label: 'Morning' },
                { time: '12:30pm', label: 'Afternoon' },
                { time: '5:00pm', label: 'Evening' },
                { time: '9:30pm', label: 'Night' }
            ];
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

            return res.render('admin/manage-availability', {
                user: req.user,
                targetUser: user,
                userAvailability: availability.map(row => ({
                    ...row,
                    is_available: row.is_available === 1
                })),
                timeSlots,
                days,
                weekStart: nextWeekStart
            });
        } catch (error) {
            console.error('Error loading availability page:', error);
            return res.status(500).json({ error: 'Server error' });
        }
    });

    // Update virtual user availability
    router.post('/users/:id/availability', isAuthenticated, isAdmin, async (req, res) => {
        const { id } = req.params;
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
                // Delete existing availability for the dates
                const dates = [...new Set(availability.map(slot => slot.date))];
                for (const date of dates) {
                    await dbHelper.runWithRetry(
                        'DELETE FROM availability WHERE user_id = ? AND day_date = ?',
                        [id, date]
                    );
                }

                // Insert new availability
                for (const slot of availability) {
                    await dbHelper.runWithRetry(
                        `INSERT OR REPLACE INTO availability (user_id, day_date, time_slot, is_available)
                         VALUES (?, ?, ?, ?)`,
                        [id, slot.date, slot.time, slot.isAvailable ? 1 : 0]
                    );
                }
            });

            res.json({ message: 'Availability updated successfully' });
        } catch (error) {
            console.error('Error updating availability:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};