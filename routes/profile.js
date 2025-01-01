const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { isAuthenticated } = require('../middleware/auth');

module.exports = function(db) {
    // Get profile page
    router.get('/', isAuthenticated, (req, res) => {
        res.render('profile', { user: req.user });
    });

    // Update profile info
    router.post('/update', isAuthenticated, async (req, res) => {
        const { firstName, lastName, email } = req.body;
        
        try {
            // Check if email is taken by another user
            const existingUser = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM users WHERE email = ? AND id != ?',
                    [email.toLowerCase(), req.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Email already in use' });
            }

            // Update user info
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE id = ?',
                    [firstName.trim(), lastName.trim(), email.toLowerCase(), req.user.id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            res.json({ message: 'Profile updated successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Update password
    router.post('/password', isAuthenticated, async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        
        try {
            // Verify current password
            const isMatch = await bcrypt.compare(currentPassword, req.user.password);
            if (!isMatch) {
                return res.status(400).json({ error: 'Current password is incorrect' });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update password
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET password = ? WHERE id = ?',
                    [hashedPassword, req.user.id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            res.json({ message: 'Password updated successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 