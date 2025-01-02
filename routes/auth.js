const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = function(db) {
    // Check if setup is required
    function checkSetupRequired() {
        return new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM users', (err, result) => {
                if (err) reject(err);
                resolve(result.count === 0);
            });
        });
    }

    // Login page
    router.get('/login', async (req, res) => {
        try {
            const needsSetup = await checkSetupRequired();
            if (needsSetup) {
                return res.redirect('/setup');
            }
            res.render('login');
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Login submission
    router.post('/login',
        passport.authenticate('local'),
        (req, res) => {
            res.json({ redirect: '/' });
        }
    );

    // Register submission
    router.post('/register', async (req, res) => {
        try {
            const { firstName, lastName, email, password, confirmPassword } = req.body;

            // Basic validation
            if (!firstName || !lastName || !email || !password || !confirmPassword) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            if (password !== confirmPassword) {
                return res.status(400).json({ error: 'Passwords do not match' });
            }

            if (password.length < 8) {
                return res.status(400).json({ error: 'Password must be at least 8 characters long' });
            }

            // Email format validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            
            // First check if email exists
            const existingUser = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Email already registered' });
            }

            // If email doesn't exist, proceed with insert
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
                    [firstName.trim(), lastName.trim(), email.toLowerCase(), hashedPassword],
                    function(err) {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            return res.json({ message: 'Registration successful! You can now log in.' });
        } catch (error) {
            console.error('Registration error:', error);
            return res.status(500).json({ error: 'Server error' });
        }
    });

    // Logout
    router.get('/logout', (req, res) => {
        req.logout(() => {
            res.redirect('/login');
        });
    });

    // Initial setup routes
    router.get('/setup', async (req, res) => {
        try {
            const needsSetup = await checkSetupRequired();
            if (!needsSetup) {
                return res.redirect('/login');
            }
            res.render('setup');
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/setup', async (req, res) => {
        try {
            const needsSetup = await checkSetupRequired();
            if (!needsSetup) {
                return res.status(400).json({ error: 'Setup already completed' });
            }

            const { firstName, lastName, email, password, confirmPassword } = req.body;

            // Basic validation
            if (!firstName || !lastName || !email || !password || !confirmPassword) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            if (password !== confirmPassword) {
                return res.status(400).json({ error: 'Passwords do not match' });
            }

            if (password.length < 8) {
                return res.status(400).json({ error: 'Password must be at least 8 characters long' });
            }

            // Email format validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            
            db.run(
                'INSERT INTO users (first_name, last_name, email, password, is_admin) VALUES (?, ?, ?, ?, 1)',
                [firstName.trim(), lastName.trim(), email.toLowerCase(), hashedPassword],
                (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Error creating admin user' });
                    }
                    res.json({ message: 'Admin account created successfully! You can now log in.' });
                }
            );
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
}; 