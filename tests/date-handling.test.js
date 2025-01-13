const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { testDb, initializeTestDb } = require('../config/test.db');
const { createTestUser, clearTestDb } = require('./helpers/testHelpers');

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

app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

describe('Date Handling', () => {
    let testUser;
    let mockAuth;
    let realDate;

    beforeAll(async () => {
        await initializeTestDb();
        // Store the real Date object
        realDate = global.Date;
    });

    beforeEach(async () => {
        await clearTestDb();
        
        // Create a test user
        testUser = await createTestUser({
            is_active: true
        });

        // Create fresh auth middleware for each test
        mockAuth = (req, res, next) => {
            req.isAuthenticated = () => true;
            req.user = {
                id: testUser.id,
                is_active: true
            };
            next();
        };

        // Reset the app routes
        app._router.stack = app._router.stack.filter(layer => !layer.route || !layer.route.path !== '/');
        
        // Import routes with fresh db connection
        const indexRoutes = require('../routes/index')(testDb);
        app.use('/', mockAuth, indexRoutes);

        // Reset Date to real implementation before each test
        global.Date = realDate;
    });

    afterEach(() => {
        // Restore the real Date object after each test
        global.Date = realDate;
    });

    describe('Week Display', () => {
        it('should start week display on Monday of current week', async () => {
            // Get current date
            const now = new Date();
            // Get Monday of current week (0 = Sunday, 1 = Monday, etc)
            const monday = new Date(now);
            monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
            monday.setUTCHours(0, 0, 0, 0);

            const response = await request(app)
                .get('/')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.data).toHaveProperty('weekStart');
            
            // Convert weekStart to Date object for comparison
            const weekStart = new Date(rendered.data.weekStart);
            weekStart.setUTCHours(0, 0, 0, 0);

            expect(weekStart.getTime()).toBe(monday.getTime());
            expect(weekStart.getUTCDay()).toBe(1); // Monday
        });

        it('should start week display on Monday when current time is Sunday 9am UTC', async () => {
            // Mock a specific Sunday at 9am UTC (4am EST)
            const mockSunday = new Date('2025-01-12T09:00:00Z');  // This is a Sunday
            const mockMonday = new Date('2025-01-06T00:00:00Z');  // Previous Monday

            // Mock the Date object
            const MockDate = class extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super(mockSunday);
                    } else {
                        super(...args);
                    }
                }
                
                static now() {
                    return mockSunday.getTime();
                }
            };
            global.Date = MockDate;

            const response = await request(app)
                .get('/')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.data).toHaveProperty('weekStart');
            
            // Convert weekStart to Date object for comparison
            const weekStart = new realDate(rendered.data.weekStart);
            weekStart.setUTCHours(0, 0, 0, 0);

            expect(weekStart.getTime()).toBe(mockMonday.getTime());
            expect(weekStart.getUTCDay()).toBe(1); // Monday
        });

        it('should start week display on Monday when current time is Sunday 9pm UTC', async () => {
            // Mock a specific Sunday at 9pm UTC (4pm EST)
            const mockSunday = new Date('2025-01-12T21:00:00Z');  // This is a Sunday at 9pm UTC
            const mockMonday = new Date('2025-01-06T00:00:00Z');  // Previous Monday

            // Mock the Date object
            const MockDate = class extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super(mockSunday);
                    } else {
                        super(...args);
                    }
                }
                
                static now() {
                    return mockSunday.getTime();
                }
            };
            global.Date = MockDate;

            const response = await request(app)
                .get('/')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.data).toHaveProperty('weekStart');
            
            // Convert weekStart to Date object for comparison
            const weekStart = new realDate(rendered.data.weekStart);
            weekStart.setUTCHours(0, 0, 0, 0);

            expect(weekStart.getTime()).toBe(mockMonday.getTime());
            expect(weekStart.getUTCDay()).toBe(1); // Monday
        });

        it('should advance to next week when current time is Monday 3am UTC (Sunday 10pm EST)', async () => {
            // Mock Monday 3am UTC (previous day 10pm EST)
            const mockTime = new Date('2025-01-13T03:00:00Z');  // Monday 3am UTC = Sunday 10pm EST
            const nextMonday = new Date('2025-01-13T00:00:00Z');  // Next Monday

            // Mock the Date object
            const MockDate = class extends Date {
                constructor(...args) {
                    if (args.length === 0) {
                        super(mockTime);
                    } else {
                        super(...args);
                    }
                }
                
                static now() {
                    return mockTime.getTime();
                }
            };
            global.Date = MockDate;

            const response = await request(app)
                .get('/')
                .expect(200);

            const rendered = JSON.parse(response.text);
            expect(rendered.data).toHaveProperty('weekStart');
            
            // Convert weekStart to Date object for comparison
            const weekStart = new realDate(rendered.data.weekStart);
            weekStart.setUTCHours(0, 0, 0, 0);

            expect(weekStart.getTime()).toBe(nextMonday.getTime());
            expect(weekStart.getUTCDay()).toBe(1); // Monday
            
            // Additional verification that we're looking at the next week
            const weekStartDate = weekStart.getUTCDate();
            expect(weekStartDate).toBe(13); // Should be January 13th
        });
    });
}); 