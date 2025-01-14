const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
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
    isAuthenticatedApi: (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(403).json({ error: 'Authentication required' });
        }
        next();
    },
    isActive: (req, res, next) => {
        if (!req.user?.is_active) {
            if (req.path === '/export-calendar') {
                return res.status(403).json({ error: 'Account not activated' });
            }
            return res.redirect('/inactive');
        }
        next();
    }
}));

describe('Index Routes', () => {
    let app;
    let server;
    let testUser;
    let db;

    beforeAll(async () => {
        await initializeTestDb();
        db = testDb;
    });

    beforeEach(async () => {
        await clearTestDb();
        
        // Create a fresh Express app for each test
        app = express();
        
        // Configure middleware
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false
        }));

        // Set up view engine
        app.set('view engine', 'ejs');
        app.engine('ejs', (path, data, cb) => {
            cb(null, 'rendered');
        });

        // Create test user
        testUser = await createTestUser();

        // Set up authentication mocking
        app.use((req, res, next) => {
            // Allow tests to override isAuthenticated
            if (!req.isAuthenticated) {
                req.isAuthenticated = () => true;
            }
            // Allow tests to override user
            if (!req.user) {
                req.user = testUser;
            }
            next();
        });

        // Add routes
        const indexRoutes = require('../../routes/index')(db);
        app.use('/', indexRoutes);
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
        if (db) {
            await new Promise((resolve) => {
                db.close(() => resolve());
            });
        }
    });

    describe('GET /', () => {
        it('should redirect to setup if no users exist', async () => {
            await clearTestDb(); // Ensure no users exist
            const response = await request(app).get('/');
            expect(response.status).toBe(302);
            expect(response.header.location).toBe('/setup');
        });

        it('should redirect to login if not authenticated', async () => {
            const testApp = express();
            testApp.use(express.json());
            
            // Mock unauthenticated user
            testApp.use((req, res, next) => {
                req.isAuthenticated = () => false;
                next();
            });

            const indexRoutes = require('../../routes/index')(db);
            testApp.use('/', indexRoutes);

            const response = await request(testApp)
                .get('/')
                .expect(302);

            expect(response.header.location).toBe('/login');
        });

        it('should render dashboard for authenticated and active user', async () => {
            const testApp = express();
            testApp.use(express.json());
            testApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));

            // Set up view engine
            testApp.set('view engine', 'ejs');
            testApp.engine('ejs', (path, data, cb) => {
                cb(null, 'rendered');
            });

            // Set user as active
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

            // Mock authenticated and active user
            testApp.use((req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = { ...testUser, is_active: true };
                next();
            });

            const indexRoutes = require('../../routes/index')(db);
            testApp.use('/', indexRoutes);

            const response = await request(testApp)
                .get('/')
                .expect(200);

            expect(response.text).toBe('rendered');
        });

        it('should redirect inactive user to /inactive', async () => {
            const testApp = express();
            testApp.use(express.json());
            testApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));

            // Mock authenticated but inactive user
            testApp.use((req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = { ...testUser, is_active: false };
                next();
            });

            const indexRoutes = require('../../routes/index')(db);
            testApp.use('/', indexRoutes);

            const response = await request(testApp)
                .get('/')
                .expect(302);

            expect(response.header.location).toBe('/inactive');
        });

        it('should include assignments and availability in dashboard render', async () => {
            const testApp = express();
            testApp.use(express.json());
            testApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));

            // Set up view engine to capture render data
            let renderData;
            testApp.set('view engine', 'ejs');
            testApp.engine('ejs', (path, data, cb) => {
                renderData = data;
                cb(null, 'rendered');
            });

            // Mock authenticated and active user
            testApp.use((req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = { ...testUser, is_active: true };
                next();
            });

            const indexRoutes = require('../../routes/index')(db);
            testApp.use('/', indexRoutes);

            await request(testApp)
                .get('/')
                .expect(200);

            expect(renderData).toBeDefined();
            expect(renderData).toHaveProperty('assignments');
            expect(renderData).toHaveProperty('userAvailability');
            expect(renderData).toHaveProperty('weekStart');
        });

        it('should handle database error during setup check', async () => {
            // Create a new database connection that we can close
            const errorDb = new sqlite3.Database(':memory:');
            
            // Mock the database query to simulate an error
            errorDb.get = jest.fn((query, callback) => {
                if (query.includes('COUNT(*) as count FROM users')) {
                    callback(new Error('Database error'));
                } else {
                    db.get(query, callback); // Use main db for other queries
                }
            });

            // Create a new Express app for error testing
            const errorApp = express();
            errorApp.use(express.json());
            errorApp.use(express.urlencoded({ extended: true }));

            // Add error routes with error handling middleware
            const errorRoutes = require('../../routes/index')(errorDb);
            errorApp.use('/', errorRoutes);
            errorApp.use((err, req, res, next) => {
                res.status(500).json({ error: err.message });
            });

            const response = await request(errorApp).get('/');
            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error');

            // Clean up
            await new Promise(resolve => errorDb.close(resolve));
        });

        it('should handle database error during assignments query', async () => {
            // Create a new database connection for error testing
            const errorDb = new sqlite3.Database(':memory:');
            
            // Mock the assignments query to simulate an error
            errorDb.all = jest.fn((query, params, callback) => {
                if (query.includes('assignments')) {
                    callback(new Error('Database error'));
                } else {
                    db.all(query, params, callback); // Use main db for other queries
                }
            });

            // Copy auth functions from main db
            errorDb.get = db.get.bind(db);

            // Create a new Express app for error testing
            const errorApp = express();
            errorApp.use(express.json());
            errorApp.use(express.urlencoded({ extended: true }));

            // Copy session and auth configuration
            errorApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
                cookie: { secure: false }
            }));

            // Create a new passport instance for error app
            const errorPassport = new passport.Passport();
            errorApp.use(errorPassport.initialize());
            errorApp.use(errorPassport.session());

            // Configure passport for error app
            errorPassport.use(new LocalStrategy(
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

            errorPassport.serializeUser((user, done) => {
                done(null, user.id);
            });

            errorPassport.deserializeUser((id, done) => {
                db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
                    if (err) return done(err);
                    if (!user) return done(null, false);
                    done(null, user);
                });
            });

            // Add login route to error app
            errorApp.post('/login', (req, res, next) => {
                errorPassport.authenticate('local', (err, user, info) => {
                    if (err) return next(err);
                    if (!user) return res.status(401).json(info);
                    
                    req.logIn(user, (err) => {
                        if (err) return next(err);
                        res.status(200).json({ success: true });
                    });
                })(req, res, next);
            });

            // Add error routes with error handling middleware
            const errorRoutes = require('../../routes/index')(errorDb);
            errorApp.use('/', errorRoutes);
            errorApp.use((err, req, res, next) => {
                res.status(500).json({ error: err.message });
            });

            // Create a new agent and login
            const errorAgent = request.agent(errorApp);
            const loginResponse = await errorAgent
                .post('/login')
                .send({ email: testUser.email, password: 'password123' });
            expect(loginResponse.status).toBe(200);

            // Set user as active
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

            const response = await errorAgent.get('/');
            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error');

            // Clean up
            await new Promise(resolve => errorDb.close(resolve));
        });

        it('should handle database error during availability query', async () => {
            // Create a new database connection for error testing
            const errorDb = new sqlite3.Database(':memory:');
            
            // Mock the database queries to simulate an error in availability query
            errorDb.all = jest.fn((query, params, callback) => {
                if (query.includes('availability')) {
                    callback(new Error('Database error'));
                } else {
                    db.all(query, params, callback); // Use main db for other queries
                }
            });

            // Copy auth functions from main db
            errorDb.get = db.get.bind(db);

            // Create a new Express app for error testing
            const errorApp = express();
            errorApp.use(express.json());
            errorApp.use(express.urlencoded({ extended: true }));

            // Copy session and auth configuration
            errorApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
                cookie: { secure: false }
            }));

            // Create a new passport instance for error app
            const errorPassport = new passport.Passport();
            errorApp.use(errorPassport.initialize());
            errorApp.use(errorPassport.session());

            // Configure passport for error app
            errorPassport.use(new LocalStrategy(
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

            errorPassport.serializeUser((user, done) => {
                done(null, user.id);
            });

            errorPassport.deserializeUser((id, done) => {
                db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
                    if (err) return done(err);
                    if (!user) return done(null, false);
                    done(null, user);
                });
            });

            // Add login route to error app
            errorApp.post('/login', (req, res, next) => {
                errorPassport.authenticate('local', (err, user, info) => {
                    if (err) return next(err);
                    if (!user) return res.status(401).json(info);
                    
                    req.logIn(user, (err) => {
                        if (err) return next(err);
                        res.status(200).json({ success: true });
                    });
                })(req, res, next);
            });

            // Add error routes with error handling middleware
            const errorRoutes = require('../../routes/index')(errorDb);
            errorApp.use('/', errorRoutes);
            errorApp.use((err, req, res, next) => {
                res.status(500).json({ error: err.message });
            });

            // Create a new agent and login
            const errorAgent = request.agent(errorApp);
            const loginResponse = await errorAgent
                .post('/login')
                .send({ email: testUser.email, password: 'password123' });
            expect(loginResponse.status).toBe(200);

            // Set user as active
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

            const response = await errorAgent.get('/');
            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error');

            // Clean up
            await new Promise(resolve => errorDb.close(resolve));
        });
    });

    describe('GET /export-calendar', () => {
        let testUser;
        let weekStart;

        beforeEach(async () => {
            // Create test user
            testUser = await createTestUser({
                is_active: true
            });

            // Calculate current week's Monday in UTC
            const today = new Date();
            weekStart = new Date(Date.UTC(
                today.getUTCFullYear(),
                today.getUTCMonth(),
                today.getUTCDate() - ((today.getUTCDay() + 6) % 7) // Get Monday
            ));

            // Format date for SQLite (YYYY-MM-DD)
            const dateStr = weekStart.toISOString().split('T')[0];

            // Create some test assignments for current week
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO assignments (user_id, day_date, time_slot, assigned_by)
                    VALUES 
                        (?, ?, '9:00am', ?),
                        (?, ?, '2:00pm', ?)
                `, [testUser.id, dateStr, testUser.id, testUser.id, dateStr, testUser.id], (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Create fresh Express app instance for each test
            const testApp = express();
            testApp.use(express.json());
            testApp.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));
            testApp.use(passport.initialize());
            testApp.use(passport.session());

            // Mock authenticated user first
            testApp.use((req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = testUser; // Use the full test user object
                next();
            });

            // Add routes
            const indexRoutes = require('../../routes/index')(db);
            testApp.use('/', indexRoutes);

            // Update app reference
            app = testApp;
        });

        it('should export calendar in ICS format', async () => {
            const agent = request.agent(app);
            
            const response = await agent
                .get('/export-calendar')
                .expect(200);

            expect(response.headers['content-type']).toMatch(/text\/calendar/i);
            expect(response.headers['content-disposition']).toMatch(/^attachment; filename=schedule-.*\.ics$/i);

            const icsContent = response.text;
            expect(icsContent).toContain('BEGIN:VCALENDAR');
            expect(icsContent).toContain('VERSION:2.0');
            expect(icsContent).toContain('PRODID:-//CareGiver//EN');
            expect(icsContent).toContain('BEGIN:VEVENT');

            // Get the date from the actual ICS content
            const match = icsContent.match(/DTSTART:(\d{8})T/);
            expect(match).toBeTruthy();
            const actualDate = match[1];

            // Verify time portions
            expect(icsContent).toContain(`DTSTART:${actualDate}T090000`);
            expect(icsContent).toContain(`DTEND:${actualDate}T091500`);
            expect(icsContent).toContain('END:VEVENT');
            expect(icsContent).toContain('END:VCALENDAR');
        });

        it('should require authentication', async () => {
            const testApp = express();
            testApp.use(express.json());
            
            // Mock unauthenticated user
            testApp.use((req, res, next) => {
                req.isAuthenticated = () => false;
                next();
            });

            const indexRoutes = require('../../routes/index')(db);
            testApp.use('/', indexRoutes);

            const response = await request(testApp)
                .get('/export-calendar')
                .expect(403);

            expect(response.body).toHaveProperty('error', 'Authentication required');
        });

        it('should format dates correctly in ICS file', async () => {
            const agent = request.agent(app);

            // Use current week's date
            const dateStr = weekStart.toISOString().split('T')[0];

            // Create assignment with specific time
            await new Promise((resolve, reject) => {
                db.run(`
                    DELETE FROM assignments WHERE user_id = ?;
                `, [testUser.id], (err) => {
                    if (err) reject(err);
                    db.run(`
                        INSERT INTO assignments (user_id, day_date, time_slot, assigned_by)
                        VALUES (?, ?, '2:30pm', ?)
                    `, [testUser.id, dateStr, testUser.id], (err) => {
                        if (err) reject(err);
                        resolve();
                    });
                });
            });

            const response = await agent
                .get('/export-calendar')
                .expect(200);

            expect(response.headers['content-type']).toMatch(/text\/calendar/i);
            const icsContent = response.text;
            
            // Get the date from the actual ICS content
            const match = icsContent.match(/DTSTART:(\d{8})T/);
            expect(match).toBeTruthy();
            const actualDate = match[1];

            // Verify time portion only
            expect(icsContent).toContain(`DTSTART:${actualDate}T143000`);
            expect(icsContent).toContain(`DTEND:${actualDate}T144500`);
        });
    });
}); 