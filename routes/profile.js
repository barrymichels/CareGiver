const express = require('express');
const bcrypt = require('bcrypt');
const { isAuthenticated, isActive } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');
const { normalizeEmail, isWellFormedEmail } = require('../utils/email');

/**
 * Best-effort removal of every stored session belonging to one user, so a password
 * change evicts sessions that were started with the old credentials - a stolen cookie
 * must not outlive the reset. The session store (connect-sqlite3, see the session setup
 * in app.js) is a separate SQLite database whose `sessions` rows hold the serialised
 * session JSON; the only link from a row to an account is the `passport.user` id that
 * passport's serialise step writes there. A store we cannot reach that way (e.g. an
 * in-memory store) is skipped rather than failed open: the password change itself must
 * still succeed.
 */
function destroyUserSessions(req, userId) {
    return new Promise((resolve) => {
        const store = req.sessionStore;
        const sessionDb = store && store.db;
        if (!sessionDb || typeof sessionDb.all !== 'function' || typeof sessionDb.run !== 'function') {
            return resolve();
        }
        const table = store.table || 'sessions';
        sessionDb.all(`SELECT sid, sess FROM ${table}`, (err, rows) => {
            const sids = err || !rows ? [] : rows
                .filter((row) => {
                    try {
                        return Number(JSON.parse(row.sess).passport.user) === Number(userId);
                    } catch (parseError) {
                        return false;
                    }
                })
                .map((row) => row.sid);
            if (sids.length === 0) {
                return resolve();
            }
            sessionDb.run(
                `DELETE FROM ${table} WHERE sid IN (${sids.map(() => '?').join(', ')})`,
                sids,
                () => resolve()
            );
        });
    });
}

module.exports = function(db, notificationService) {
    // Must stay inside the factory: a module-level router is shared by every require() call,
    // so a second caller would silently receive the first caller's routes and database.
    const router = express.Router();
    const dbHelper = new DatabaseHelper(db);

    // Get profile
    router.get('/', isAuthenticated, isActive, async (req, res) => {
        try {
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT first_name, last_name, email FROM users WHERE id = ?',
                    [req.user.id],
                    (err, row) => {
                        if (err) {
                            console.error('Database error:', err);
                            reject(err);
                            return;
                        }
                        if (!row) {
                            reject(new Error('User not found'));
                            return;
                        }
                        resolve(row);
                    }
                );
            });

            // Get notification preferences
            let notificationPreferences = null;
            if (notificationService) {
                notificationPreferences = await notificationService.getNotificationPreferences(req.user.id);
            }

            return res.render('profile', { 
                user: {
                    ...req.user,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    email: user.email
                },
                notificationPreferences
            });
        } catch (error) {
            console.error('Error getting profile:', error);
            res.status(500);
            
            // Send error response
            if (req.accepts('html')) {
                res.send('<div class="error">Server error</div>');
            } else {
                res.json({ error: 'Server error' });
            }
            return;
        }
    });

    // Update profile
    router.put('/', isAuthenticated, isActive, async (req, res) => {
        const { firstName, lastName, email } = req.body;

        // Validate names before anything reaches the UPDATE: an absent field used to
        // sail past every check and surface there as a bare 500.
        if (!firstName || !lastName ||
            typeof firstName !== 'string' || typeof lastName !== 'string' ||
            !firstName.trim() || !lastName.trim()) {
            return res.status(400).json({ error: 'First and last name are required' });
        }

        // Normalise once - the same helper every other email read and write uses - so
        // the address that is validated, checked for duplicates, and stored is one and
        // the same. Storing a raw-cased copy here used to lock the user out: login and
        // password reset both normalise before their lookups, so a saved
        // "Bob@Example.com" matched no row for its owner, and the masked reset response
        // hid the reason forever.
        const normalizedEmail = normalizeEmail(email);
        if (!isWellFormedEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        try {
            // First verify user exists
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM users WHERE id = ?',
                    [req.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        if (!row) reject(new Error('User not found'));
                        resolve(row);
                    }
                );
            });

            // Check for duplicate email against the normalised value. Comparing raw to
            // normalised would miss a case-variant twin and let the UPDATE hit the
            // UNIQUE constraint instead - a bare 500 for a normal user mistake.
            const existingUser = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM users WHERE email = ? AND id != ?',
                    [normalizedEmail, req.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Email already in use' });
            }

            await dbHelper.runWithRetry(
                `UPDATE users 
                 SET first_name = ?, last_name = ?, email = ?
                 WHERE id = ?`,
                [firstName.trim(), lastName.trim(), normalizedEmail, req.user.id]
            );

            res.json({ message: 'Profile updated successfully' });
        } catch (error) {
            console.error('Error updating profile:', error);
            if (error.message === 'User not found') {
                res.status(404).json({ error: 'User not found' });
            } else {
                res.status(500).json({ error: 'Server error' });
            }
        }
    });

    // Update password
    router.put('/password', isAuthenticated, isActive, async (req, res) => {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate password length
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Validate password confirmation
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        try {
            // Get current user's password
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT password FROM users WHERE id = ?',
                    [req.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        if (!row) reject(new Error('User not found'));
                        resolve(row);
                    }
                );
            });

            // Verify current password
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(400).json({ error: 'Current password is incorrect' });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update password
            await dbHelper.runWithRetry(
                'UPDATE users SET password = ? WHERE id = ?',
                [hashedPassword, req.user.id]
            );

            // Every session started with the old password is now suspect - evict them,
            // including any the current, legitimate user is holding. They re-login; a
            // thief does not get to keep riding a stolen cookie.
            await destroyUserSessions(req, req.user.id);

            res.json({ message: 'Password updated successfully' });
        } catch (error) {
            console.error('Error updating password:', error);
            if (error.message === 'User not found') {
                res.status(404).json({ error: 'User not found' });
            } else {
                res.status(500).json({ error: 'Server error' });
            }
        }
    });

    return router;
}; 