const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const router = express.Router();

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

// Generate reset token
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

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

    // Forgot password routes
    router.get('/forgot-password', (req, res) => {
        res.render('forgot-password');
    });

    router.post('/forgot-password', async (req, res) => {
        const { email } = req.body;

        try {
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id, email, first_name FROM users WHERE email = ? AND is_active = 1',
                    [email.toLowerCase()],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            // Send response before attempting email
            res.json({
                message: 'If this email is registered, you will receive password reset instructions shortly.'
            });

            // Only attempt to send email if user exists
            if (user) {
                const resetToken = crypto.randomBytes(32).toString('hex');
                const resetTokenExpiry = Date.now() + 3600000; // 1 hour

                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
                        [resetToken, resetTokenExpiry, user.id],
                        err => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });

                try {
                    const transporter = createTransporter();
                    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;

                    await transporter.sendMail({
                        from: process.env.SMTP_FROM,
                        to: user.email,
                        subject: "Password Reset Request",
                        html: `
                            <p>Hello ${user.first_name},</p>
                            <p>You requested to reset your password. Click the link below to reset it:</p>
                            <p><a href="${resetUrl}">${resetUrl}</a></p>
                            <p>This link will expire in 1 hour.</p>
                            <p>If you didn't request this, please ignore this email.</p>
                        `
                    });
                } catch (emailError) {
                    console.error('Email sending failed:', emailError);
                    // Don't throw - we already sent success response to user
                }
            }
        } catch (error) {
            // Only send error if headers haven't been sent
            if (!res.headersSent) {
                console.error('Forgot password error:', error);
                res.status(500).json({
                    message: 'If this email is registered, you will receive password reset instructions shortly.'
                });
            }
        }
    });

    // Reset password routes
    router.get('/reset-password/:token', async (req, res) => {
        try {
            const { token } = req.params;
            
            // Check if token exists and is not expired
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > ?',
                    [token, Date.now()],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            if (!user) {
                // Render error page without header for invalid token
                return res.render('reset-password-error', {
                    message: 'Password reset link is invalid or has expired.',
                    action: {
                        text: 'Back to Login',
                        url: '/login'
                    }
                });
            }

            // Token valid, show reset password form
            res.render('reset-password', { token });

        } catch (error) {
            console.error('Reset password error:', error);
            res.render('reset-password-error', {
                message: 'An error occurred while processing your request.',
                action: {
                    text: 'Back to Login',
                    url: '/login'
                }
            });
        }
    });

    router.post('/reset-password/:token', async (req, res) => {
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
                    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > ?',
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
                    'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
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