const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = function (db) {
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
        passport.authenticate('local', {
            failWithError: true
        }),
        (req, res) => {
            // Check if user is active
            if (!req.user.is_active) {
                req.logout(() => {
                    res.status(403).json({ error: 'Account not activated' });
                });
                return;
            }
            res.json({ redirect: '/' });
        },
        (err, req, res, next) => {
            console.error('Login error:', err);
            res.status(401).json({ message: 'Invalid email or password' });
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
                    function (err) {
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
                'INSERT INTO users (first_name, last_name, email, password, is_admin, is_active) VALUES (?, ?, ?, ?, 1, 1)',
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

    // OAuth2 login route
    router.get('/auth/login', (req, res, next) => {
        passport.authenticate('oauth2', {
            successRedirect: '/',
            failureRedirect: '/login',
            failureFlash: true
        })(req, res, next);
    });

    // OAuth2 callback route
    router.get('/auth/callback',
        passport.authenticate('oauth2', {
            successRedirect: '/',
            failureRedirect: '/login',
            failureFlash: true
        })
    );

    return router;
};

const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    try {
        const response = await fetch(form.action, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        const responseData = await response.json();

        if (response.ok) {
            if (responseData.redirect) {
                window.location.href = responseData.redirect;
            } else if (form.id === 'register-form') {
                showMessage(form, responseData.message, 'success');
                document.querySelector('[data-form="login"]').click();
                form.reset();
            }
        } else if (response.status === 403) {
            window.location.href = '/inactive';
        } else {
            showMessage(form, responseData.error || responseData.message, 'error');
        }
    } catch (error) {
        showMessage(form, 'An error occurred. Please try again.', 'error');
    }
};