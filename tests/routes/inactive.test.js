const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');
const { isAuthenticated } = require('../../middleware/auth');

// Create express app for testing
const app = express();

// Mock view engine for testing
app.set('view engine', 'ejs');
app.engine('ejs', (path, data, cb) => {
    const output = {
        view: path,
        data: data
    };
    cb(null, JSON.stringify(output));
});

// Set views directory
app.set('views', path.join(__dirname, '../../views'));

app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Add the inactive route
app.get('/inactive', isAuthenticated, (req, res) => {
    if (req.user.is_active) {
        return res.redirect('/');
    }
    res.render('inactive');
});

describe('Inactive Account Route', () => {
    let inactiveUser;
    let activeUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        
        // Create an inactive user
        inactiveUser = await createTestUser({
            email: 'inactive@example.com',
            is_active: 0
        });

        // Create an active user
        activeUser = await createTestUser({
            email: 'active@example.com',
            is_active: 1
        });
    });

    describe('GET /inactive', () => {
        it('should render inactive page for inactive user', async () => {
            const mockAuth = (req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = {
                    id: inactiveUser.id,
                    is_active: false
                };
                next();
            };

            // Reset the app routes and add mock auth
            app._router.stack = app._router.stack.filter(layer => !layer.route || layer.route.path !== '/inactive');
            app.get('/inactive', mockAuth, (req, res) => {
                if (req.user.is_active) {
                    return res.redirect('/');
                }
                res.render('inactive');
            });

            const response = await request(app)
                .get('/inactive')
                .expect(200);

            const rendered = JSON.parse(response.text);
            // Use path.basename to get just the view name without the full path
            expect(path.basename(rendered.view, '.ejs')).toBe('inactive');
        });

        it('should redirect active user to home', async () => {
            const mockAuth = (req, res, next) => {
                req.isAuthenticated = () => true;
                req.user = {
                    id: activeUser.id,
                    is_active: true
                };
                next();
            };

            // Reset the app routes and add mock auth
            app._router.stack = app._router.stack.filter(layer => !layer.route || layer.route.path !== '/inactive');
            app.get('/inactive', mockAuth, (req, res) => {
                if (req.user.is_active) {
                    return res.redirect('/');
                }
                res.render('inactive');
            });

            const response = await request(app)
                .get('/inactive')
                .expect(302);

            expect(response.header.location).toBe('/');
        });

        it('should redirect unauthenticated user to login', async () => {
            const mockAuth = (req, res, next) => {
                req.isAuthenticated = () => false;
                next();
            };

            // Reset the app routes and add mock auth
            app._router.stack = app._router.stack.filter(layer => !layer.route || layer.route.path !== '/inactive');
            app.get('/inactive', isAuthenticated, (req, res) => {
                if (req.user.is_active) {
                    return res.redirect('/');
                }
                res.render('inactive');
            });

            const response = await request(app)
                .get('/inactive')
                .expect(302);

            expect(response.header.location).toBe('/login');
        });
    });
}); 