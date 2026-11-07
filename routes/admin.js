const express = require('express');
const { isAuthenticated, isAuthenticatedApi, isAdmin } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');
const TimeslotManager = require('../utils/timeslotManager');
const { WEEK_DAYS, weekTitleFor, weekWindowFor, weekDatesFor } = require('../utils/weekView');
const { normalizeEmail, isWellFormedEmail } = require('../utils/email');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

module.exports = function (db) {
    // Must stay inside the factory: a module-level router is shared by every require() call,
    // so a second caller would silently receive the first caller's routes and database.
    const router = express.Router();
    const dbHelper = new DatabaseHelper(db);
    const timeslotManager = new TimeslotManager(db);

    // Admin dashboard
    router.get('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const weekOffset = parseInt(req.query.weekOffset) || 0;
            // Limit week offset between -4 and 8
            const limitedOffset = Math.max(-4, Math.min(8, weekOffset));

            // Monday..Sunday of the target week, as New York calendar dates
            const { start: targetWeekStart, sqlStart, sqlEnd } = weekWindowFor(limitedOffset);

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
                        sqlStart,
                        sqlEnd
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
                        sqlStart,
                        sqlEnd
                    ],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            // Generate week title based on offset
            const weekTitle = weekTitleFor(limitedOffset);

            const weekData = await timeslotManager.getTimeslotsForWeek(targetWeekStart);
            res.render('admin', {
                templates: await timeslotManager.getAllTemplates(),
                canModifyWeek: timeslotManager.canModifyWeek(targetWeekStart),
                weekStartKey: sqlStart,
                weekData,
                user: req.user,
                users,
                availability,
                assignments,
                weekDates: weekDatesFor(targetWeekStart),
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
    router.post('/assign', isAuthenticated, isAdmin, async (req, res) => {
        const { assignments } = req.body;

        try {
            // withTransaction owns BEGIN/COMMIT/ROLLBACK: the driver is a single shared
            // connection, so a hand-rolled transaction that rolls back unconditionally on error
            // would throw away whichever other request happened to be mid-transaction.
            await dbHelper.withTransaction(async () => {
                await timeslotManager.validateScheduledSlots(assignments.filter(assignment => !assignment.unassign));
                for (const assignment of assignments) {
                    if (assignment.unassign) {
                        // Delete the assignment if unassign flag is true
                        await dbHelper.runWithRetry(
                            `DELETE FROM assignments 
                             WHERE day_date = ? AND time_slot = ?`,
                            [
                                assignment.date,
                                assignment.time
                            ]
                        );
                    } else {
                        // Insert or update assignment as before
                        await dbHelper.runWithRetry(
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
                            ]
                        );
                    }
                }
            });

            res.json({ message: 'Assignments updated successfully' });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.status ? error.message : 'Server error' });
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

            // Refuse any write to your own activation state, in either direction. Deactivating
            // yourself locks you out, and the reverse is a way back in: a deactivated admin whose
            // session is still alive could otherwise send {"is_active": true} on their own id and
            // restore themselves.
            if (typeof is_active === 'boolean' && parseInt(id) === req.user.id) {
                const error = is_active
                    ? 'Cannot change the active status of your own account'
                    : 'Cannot deactivate your own account';
                return res.status(400).json({ error });
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

    // Delete inactive users, preserving schedules they created for other caregivers.
    router.delete('/users/:id', isAuthenticatedApi, isAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        try {
            await dbHelper.withTransaction(async () => {
                const user = await dbHelper.getWithRetry('SELECT is_active FROM users WHERE id = ?', [id]);
                if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
                if (user.is_active) {
                    throw Object.assign(new Error('Only inactive users can be deleted. Deactivate this user first.'), { status: 409 });
                }

                for (const table of ['availability', 'assignments', 'user_preferences', 'notification_settings', 'morning_summary_log']) {
                    await dbHelper.runWithRetry(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
                }
                // Older installations only create this table when converting a virtual user.
                const resetTokens = await dbHelper.getWithRetry("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'");
                if (resetTokens) {
                    await dbHelper.runWithRetry('DELETE FROM password_reset_tokens WHERE user_id = ?', [id]);
                }

                // Transfer shared records to the deleting admin rather than deleting other users' schedules.
                await dbHelper.runWithRetry('UPDATE assignments SET assigned_by = ? WHERE assigned_by = ?', [req.user.id, id]);
                await dbHelper.runWithRetry('UPDATE timeslot_configurations SET created_by = ? WHERE created_by = ?', [req.user.id, id]);
                await dbHelper.runWithRetry('UPDATE timeslot_templates SET created_by = ? WHERE created_by = ?', [req.user.id, id]);
                const deleted = await dbHelper.runWithRetry('DELETE FROM users WHERE id = ? AND is_active = 0', [id]);
                if (!deleted.changes) {
                    throw Object.assign(new Error('User status changed. Reload the page before deleting.'), { status: 409 });
                }
            });
            res.json({ message: 'User deleted successfully' });
        } catch (error) {
            if (!error.status) console.error('Error deleting user:', error);
            res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to delete user' });
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

            // Normalise once so the address tested for collisions is the address written.
            const normalizedEmail = normalizeEmail(email);
            if (!isWellFormedEmail(normalizedEmail)) {
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
                    [normalizedEmail],
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
                    [normalizedEmail, hashedPassword, id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // A converted virtual user has no usable credential: the random password hashed
            // above is never shown to anybody, so this link is the only way in. It therefore has
            // to land in the store the reset consumer reads (users.reset_token) and the expiry
            // has to be epoch milliseconds, because GET /reset-password/:token compares that
            // column against Date.now(). The dedicated password_reset_tokens table used here
            // previously is written by this handler and deleted when a user is removed, but read
            // by nothing - a token placed in it could never validate.
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
                    [token, expiresAt, id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // The auth router is mounted at '/', so the served path carries no /auth prefix.
            const resetLink = `${process.env.BASE_URL}/reset-password/${token}`;
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
        const weekOffset = parseInt(req.query.weekOffset) || 0;
        // Limit week offset to range (-4 to 1)
        const limitedOffset = Math.max(-4, Math.min(8, weekOffset));

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
                return res.status(404).render('error', {
                    message: 'User not found',
                    user: req.user
                });
            }

            // Calculate target week start with consistent approach
            // Monday..Sunday of the target week, as New York calendar dates
            const { start: targetWeekStart, sqlStart, sqlEnd } = weekWindowFor(limitedOffset);

            const availability = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT * FROM availability 
                     WHERE user_id = ? 
                     AND day_date BETWEEN ? AND ?`,
                    [
                        id,
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

            const weekData = await timeslotManager.getTimeslotsForWeek(targetWeekStart);
            const days = WEEK_DAYS;

            // Set week title based on offset
            const weekTitle = weekTitleFor(limitedOffset);

            res.render('admin/manage-availability', {
                user: req.user,
                targetUser: user,
                userAvailability: availability,
                weekData,
                days,
                weekDates: weekDatesFor(targetWeekStart),
                weekStart: targetWeekStart,
                weekTitle,
                weekOffset: limitedOffset
            });
        } catch (error) {
            console.error('Error loading availability page:', error);
            res.status(500).render('error', {
                message: 'Server error',
                user: req.user
            });
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
                await timeslotManager.validateScheduledSlots(availability);
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
            res.status(error.status || 500).json({ error: error.status ? error.message : 'Server error' });
        }
    });

    // Create new user
    router.post('/users/add', isAuthenticated, isAdmin, async (req, res) => {
        const { firstName, lastName, email } = req.body;

        try {
            // Basic validation
            if (!firstName || !lastName || !email) {
                return res.status(400).json({ error: 'First name, last name, and email are required' });
            }

            // Normalise once so the address tested for collisions is the address written.
            const normalizedEmail = normalizeEmail(email);
            if (!isWellFormedEmail(normalizedEmail)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            // Check for existing email
            const existingUser = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Email already exists' });
            }

            // Generate random password
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);

            // Insert new user
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO users (first_name, last_name, email, password, is_active) VALUES (?, ?, ?, ?, 1)',
                    [firstName.trim(), lastName.trim(), normalizedEmail, hashedPassword],
                    function (err) {
                        if (err) reject(err);
                        resolve(this.lastID);
                    }
                );
            });

            res.json({ message: 'User created successfully' });
        } catch (error) {
            console.error('Error creating user:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};
