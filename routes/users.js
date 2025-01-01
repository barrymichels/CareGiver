const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');

module.exports = function(db) {
    // Get users management page
    router.get('/manage', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const users = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT 
                        id, 
                        first_name, 
                        last_name, 
                        email, 
                        is_admin, 
                        is_active,
                        created_at
                    FROM users 
                    WHERE id != ?
                    ORDER BY is_active DESC, created_at DESC
                `, [req.user.id], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                });
            });

            res.render('users/manage', { user: req.user, users });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Update user status
    router.post('/update/:id', isAuthenticated, isAdmin, async (req, res) => {
        const { id } = req.params;
        const { is_active, is_admin } = req.body;

        try {
            // Don't allow modifying your own account
            if (parseInt(id) === req.user.id) {
                return res.status(400).json({ error: 'Cannot modify your own account' });
            }

            // Convert values to integers for SQLite
            const activeValue = is_active ? 1 : 0;
            const adminValue = is_admin ? 1 : 0;

            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET is_active = ?, is_admin = ? WHERE id = ?',
                    [activeValue, adminValue, id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            res.json({ message: 'User updated successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 