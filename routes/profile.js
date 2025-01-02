const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { isAuthenticated, isActive } = require('../middleware/auth');
const DatabaseHelper = require('../utils/dbHelper');

module.exports = function(db) {
    const dbHelper = new DatabaseHelper(db);

    // Get profile
    router.get('/', isAuthenticated, isActive, async (req, res) => {
        try {
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT first_name, last_name, email FROM users WHERE id = ?',
                    [req.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json({
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email
            });
        } catch (error) {
            console.error('Error getting profile:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Update profile
    router.put('/', isAuthenticated, isActive, async (req, res) => {
        const { firstName, lastName, email } = req.body;

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
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

            // Check for duplicate email
            const existingUser = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM users WHERE email = ? AND id != ?',
                    [email, req.user.id],
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
                [firstName, lastName, email, req.user.id]
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