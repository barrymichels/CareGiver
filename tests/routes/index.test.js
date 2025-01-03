const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');
const { isAuthenticated, isActive } = require('../../middleware/auth');

// Mock external dependencies
jest.mock('connect-sqlite3', () => {
    return () => function() {
        return {
            on: jest.fn()
        };
    };
});

// Mock isActive middleware for testing
const mockIsActive = (req, res, next) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }
    if (!req.user.is_active) {
        return res.redirect('/inactive');
    }
    next();
};

jest.mock('../../middleware/auth', () => ({
    isAuthenticated: (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.redirect('/login');
        }
        next();
    },
    isActive: (req, res, next) => mockIsActive(req, res, next)
}));

describe('Index Routes', () => {
    let app;
    let server;
    let testUser;
    let db;

    beforeAll(async () => {
        await initializeTestDb();
        db = testDb; // Use the same database connection throughout
    });

    beforeEach(async () => {
        await clearTestDb();
        
        // Create a fresh Express app for each test
        app = express();
        
        // Configure middleware
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        // Session configuration
        const sessionMiddleware = session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { secure: false }
        });
        app.use(sessionMiddleware);

        // Create a new instance of Passport for each test
        const passportInstance = new passport.Passport();
        app.use(passportInstance.initialize());
        app.use(passportInstance.session());

        // View engine setup
        app.set('view engine', 'ejs');
        app.set('views', require('path').join(__dirname, '../../views'));

        // Configure passport
        passportInstance.use(new LocalStrategy(
            { usernameField: 'email' },
            async (email, password, done) => {
                try {
                    const user = await new Promise((resolve, reject) => {
                        db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], (err, row) => {
                            if (err) reject(err);
                            resolve(row);
                        });
                    });

                    if (!user) {
                        return done(null, false, { message: 'Invalid email or password' });
                    }

                    const isMatch = await bcrypt.compare(password, user.password);
                    if (!isMatch) {
                        return done(null, false, { message: 'Invalid email or password' });
                    }

                    return done(null, user);
                } catch (err) {
                    return done(err);
                }
            }
        ));

        passportInstance.serializeUser((user, done) => {
            done(null, user.id);
        });

        passportInstance.deserializeUser((id, done) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
                if (err) return done(err);
                if (!user) return done(null, false);
                done(null, user);
            });
        });

        // Create test user
        testUser = await createTestUser();

        // Add auth routes for login
        app.post('/login', (req, res, next) => {
            passportInstance.authenticate('local', (err, user, info) => {
                if (err) return next(err);
                if (!user) return res.status(401).json(info);
                
                req.logIn(user, (err) => {
                    if (err) return next(err);
                    res.status(200).json({ success: true });
                });
            })(req, res, next);
        });

        // Add inactive route
        app.get('/inactive', isAuthenticated, (req, res) => {
            if (req.user.is_active) {
                return res.redirect('/');
            }
            res.status(200).send('Inactive page');
        });

        // Add the index routes
        const indexRoutes = require('../../routes/index')(db);
        app.use('/', indexRoutes);

        // Error handling middleware
        app.use((err, req, res, next) => {
            console.error('Test error:', err);
            res.status(500).json({ error: err.message });
        });

        // Create test server
        server = app.listen(0);
    });

    afterEach(async () => {
        // Close server and wait for connections to close
        if (server) {
            await new Promise((resolve) => {
                server.close(() => {
                    // Ensure all connections are closed
                    server.unref();
                    resolve();
                });
            });
        }

        // Clear require cache for routes
        jest.resetModules();
    });

    afterAll(async () => {
        // Close database connection
        await new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) reject(err);
                resolve();
            });
        });
    });

    describe('GET /', () => {
        it('should redirect to setup if no users exist', async () => {
            await clearTestDb(); // Ensure no users exist
            const response = await request(app).get('/');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/setup');
        });

        it('should redirect to login if not authenticated', async () => {
            const response = await request(app).get('/');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/login');
        });

        it('should render dashboard for authenticated and active user', async () => {
            const agent = request.agent(app);
            
            // Set user as active before login
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET is_active = 1 WHERE id = ?',
                    [testUser.id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // Login
            const loginResponse = await agent
                .post('/login')
                .send({ email: testUser.email, password: 'password123' });
            expect(loginResponse.status).toBe(200);

            // Mock render to avoid template issues in tests
            app.set('view engine', 'ejs');
            app.engine('ejs', (path, data, cb) => {
                cb(null, 'rendered');
            });

            const response = await agent.get('/');
            expect(response.status).toBe(200);
        });

        it('should redirect inactive user to /inactive', async () => {
            const agent = request.agent(app);
            
            // Ensure user is inactive
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET is_active = 0 WHERE id = ?',
                    [testUser.id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // Login
            const loginResponse = await agent
                .post('/login')
                .send({ email: testUser.email, password: 'password123' });
            expect(loginResponse.status).toBe(200);

            const response = await agent.get('/');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/inactive');
        });

        it('should include assignments and availability in dashboard render', async () => {
            const agent = request.agent(app);
            
            // Set user as active before login
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET is_active = 1 WHERE id = ?',
                    [testUser.id],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            // Login
            const loginResponse = await agent
                .post('/login')
                .send({ email: testUser.email, password: 'password123' });
            expect(loginResponse.status).toBe(200);

            let renderData;
            app.set('view engine', 'ejs');
            app.engine('ejs', (path, data, cb) => {
                renderData = data;
                cb(null, 'rendered');
            });

            const response = await agent.get('/');
            expect(response.status).toBe(200);
            expect(renderData).toHaveProperty('user');
            expect(renderData).toHaveProperty('weekStart');
            expect(renderData).toHaveProperty('assignments');
            expect(renderData).toHaveProperty('userAvailability');
        });
    });
}); 