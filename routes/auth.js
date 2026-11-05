const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { buildAuthLimiters } = require('../middleware/rateLimit');
const { normalizeEmail, isWellFormedEmail } = require('../utils/email');

// Create transporter factory function instead of module-level instance
function createTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        // Add TLS options to handle older servers
        tls: {
            minVersion: 'TLSv1'
        }
    });
}

module.exports = function (db) {
    // Created per call, deliberately. A module-level router is shared by every
    // require() of this file, so the first caller's db would be captured by the
    // already-registered routes and every later caller's db argument would be
    // ignored in silence - which is exactly how three tests in tests/routes/auth.test.js
    // came to exercise the real SQLite fixture instead of the mocks they build.
    const router = express.Router();
    // Built once per router. Disabled automatically under NODE_ENV=test unless
    // RATE_LIMITS=on, so the existing auth suite keeps its current behaviour.
    const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = buildAuthLimiters();

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
        loginLimiter,
        passport.authenticate('local', {
            failWithError: true,
            failureMessage: true
        }),
        (req, res) => {
            // Check if user is active
            if (!req.user.is_active) {
                req.logout(() => {
                    res.redirect('/inactive');
                });
                return;
            }
            res.json({ redirect: '/' });
        },
        (err, req, res, next) => {
            // An inactive account is an expected state, not an incident. Now that the single
            // local strategy rejects it before a session is ever created, every such attempt
            // lands here - a stack trace for it would bury the errors that matter.
            if (err.message === 'Account not activated') {
                console.log('Rejected login for an inactive account');
                return res.redirect('/inactive');
            }
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

            // Normalise once so the address that is validated is the address that is stored.
            const normalizedEmail = normalizeEmail(email);
            if (!isWellFormedEmail(normalizedEmail)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            // First check if email exists
            const existingUser = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
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
                    [firstName.trim(), lastName.trim(), normalizedEmail, hashedPassword],
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

            // Normalise once so the address that is validated is the address that is stored.
            const normalizedEmail = normalizeEmail(email);
            if (!isWellFormedEmail(normalizedEmail)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            db.run(
                'INSERT INTO users (first_name, last_name, email, password, is_admin, is_active) VALUES (?, ?, ?, ?, 1, 1)',
                [firstName.trim(), lastName.trim(), normalizedEmail, hashedPassword],
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

    // Forgot password routes
    router.get('/forgot-password', (req, res) => {
        res.render('forgot-password');
    });

    /**
     * Answer for every accepted reset request, whether or not the address exists.
     *
     * A distinct response per outcome turns this endpoint into an account-enumeration
     * oracle (review finding 15): `curl` plus the two different bodies is enough to
     * list every registered address. The browser form already rendered one masked
     * line for every non-429 outcome, so this only brings the API into line with what
     * users have always actually seen. Anything the caller can only learn by asking
     * with a *well-formed* address is hidden; malformed input is still refused,
     * because "that string is not an address" leaks nothing about who is registered.
     */
    const RESET_REQUEST_ACKNOWLEDGEMENT = 'If an account exists for that address, a password reset link has been sent.';

    router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
        const normalizedEmail = normalizeEmail(req.body?.email);

        if (!isWellFormedEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }

        try {
            // Find user
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (user) {
                // Generate reset token
                const token = crypto.randomBytes(32).toString('hex');
                const expires = Date.now() + 3600000; // 1 hour

                // Save token to database
                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
                        [token, expires, user.id],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });

                // Send email. A failure here is reported to the operator, never to the
                // caller: only an existing account can reach this branch, so a distinct
                // status would hand back exactly the leak this route is meant to close.
                const transporter = createTransporter();
                try {
                    await transporter.sendMail({
                        to: user.email,
                        subject: 'Password Reset',
                        text: `Click here to reset your password: ${process.env.BASE_URL}/reset-password/${token}`
                    });
                } catch (emailError) {
                    console.error(`Password reset email could not be queued for user id ${user.id}: ${emailError.message}`);
                }
            }

            res.json({ message: RESET_REQUEST_ACKNOWLEDGEMENT });
        } catch (error) {
            // A database fault answers identically for registered and unregistered
            // addresses, so this status cannot be used to enumerate anyone.
            console.error('POST /forgot-password failed:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Reset password routes
    router.get('/reset-password/:token', async (req, res) => {
        try {
            const { token } = req.params;

            // Check if token exists and is not expired
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?',
                    [token, Date.now()],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (!user) {
                // For test purposes, return just the view name without full path
                return res.json({
                    view: 'reset-password-error.ejs',
                    message: 'Password reset link is invalid or has expired.',
                    action: {
                        text: 'Back to Login',
                        url: '/login'
                    }
                });
            }

            res.render('reset-password', { token });
        } catch (error) {
            // For test purposes, return just the view name without full path
            res.json({
                view: 'reset-password-error.ejs',
                message: 'An error occurred while processing your request.',
                action: {
                    text: 'Back to Login',
                    url: '/login'
                }
            });
        }
    });

    router.post('/reset-password/:token', resetPasswordLimiter, async (req, res) => {
        try {
            const { token } = req.params;
            const { password, confirmPassword } = req.body;

            // Validate password
            if (!password || password.length < 8) {
                return res.status(400).json({ error: 'Password must be at least 8 characters long' });
            }

            if (password !== confirmPassword) {
                return res.status(400).json({ error: 'Passwords do not match' });
            }

            // Check if token exists and is not expired
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?',
                    [token, Date.now()],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (!user) {
                return res.status(400).json({ error: 'Password reset link is invalid or has expired' });
            }

            // Hash new password and update user
            const hashedPassword = await bcrypt.hash(password, 10);
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
                    [hashedPassword, user.id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });

        } catch (error) {
            console.error('Reset password error:', error);
            res.status(500).json({ error: 'An error occurred while resetting your password' });
        }
    });

    return router;
};
