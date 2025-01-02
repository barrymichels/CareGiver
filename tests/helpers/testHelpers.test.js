const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { 
    createTestUser, 
    getUserByEmail, 
    clearTestDb, 
    createAvailability,
    getAvailability,
    getPreferences,
    getUserById
} = require('./testHelpers');

describe('Test Helpers', () => {
    let originalConsoleError;
    let isErrorExpected = false;

    beforeAll(async () => {
        await initializeTestDb();
        // Save original console.error
        originalConsoleError = console.error;
    });

    beforeEach(async () => {
        await clearTestDb();
        isErrorExpected = false;
        // Mock console.error for each test
        console.error = jest.fn();
    });

    afterEach(() => {
        // Only verify no unexpected errors if we're not expecting errors
        if (!isErrorExpected) {
            expect(console.error).not.toHaveBeenCalled();
        }
        // Reset console.error to original after each test
        console.error = originalConsoleError;
    });

    afterAll(() => {
        // Restore original console.error
        console.error = originalConsoleError;
    });

    describe('createTestUser', () => {
        it('should create a test user with default values', async () => {
            const user = await createTestUser();
            expect(user).toHaveProperty('id');
            expect(user.first_name).toBe('Test');
            expect(user.last_name).toBe('User');
            expect(user.is_admin).toBe(0);
            expect(user.is_active).toBe(1);
        });

        it('should create a test user with custom values', async () => {
            const userData = {
                first_name: 'Custom',
                last_name: 'Name',
                email: 'custom@example.com',
                password: 'custompass',
                is_admin: 1,
                is_active: 0
            };

            const user = await createTestUser(userData);
            expect(user.first_name).toBe('Custom');
            expect(user.last_name).toBe('Name');
            expect(user.email).toBe('custom@example.com');
            expect(user.is_admin).toBe(1);
            expect(user.is_active).toBe(0);

            // Verify password was hashed
            const isMatch = await bcrypt.compare('custompass', user.password);
            expect(isMatch).toBe(true);
        });

        it('should handle database errors', async () => {
            // Mock db.run to simulate error
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            await expect(createTestUser()).rejects.toThrow('Database error');

            // Restore original function
            testDb.run = originalRun;
        });
    });

    describe('getUserByEmail', () => {
        it('should return user when found', async () => {
            const testUser = await createTestUser();
            const user = await getUserByEmail(testUser.email);
            expect(user).toBeTruthy();
            expect(user.email).toBe(testUser.email);
        });

        it('should return null when user not found', async () => {
            const user = await getUserByEmail('nonexistent@example.com');
            expect(user).toBeNull();
        });

        it('should handle database errors', async () => {
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            await expect(getUserByEmail('test@example.com')).rejects.toThrow('Database error');

            // Restore original function
            testDb.get = originalGet;
        });
    });

    describe('getAvailability', () => {
        it('should return sorted availability', async () => {
            const testUser = await createTestUser();
            const slots = [
                {
                    date: '2024-01-01',
                    time: '2:00pm',
                    isAvailable: true
                },
                {
                    date: '2024-01-01',
                    time: '9:00am',
                    isAvailable: true
                }
            ];

            await createAvailability(testUser.id, slots);
            const availability = await getAvailability(testUser.id);

            expect(availability).toHaveLength(2);
            // Should be sorted by time
            expect(availability[0].time_slot).toBe('9:00am');
            expect(availability[1].time_slot).toBe('2:00pm');
        });

        it('should handle database errors', async () => {
            isErrorExpected = true;
            
            // Mock db.all to simulate error
            const originalAll = testDb.all;
            testDb.all = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            await expect(getAvailability(1)).rejects.toThrow('Database error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.all = originalAll;
        });

        it('should return empty array when no availability exists', async () => {
            const testUser = await createTestUser();
            const availability = await getAvailability(testUser.id);
            expect(availability).toEqual([]);
        });
    });

    describe('getPreferences', () => {
        it('should return user preferences', async () => {
            const testUser = await createTestUser();
            
            // Insert test preferences
            await new Promise((resolve, reject) => {
                testDb.run(
                    'INSERT INTO user_preferences (user_id, preferences) VALUES (?, ?)',
                    [testUser.id, JSON.stringify([{ dayOfWeek: 1, time: '9:00am', isAvailable: true }])],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            const prefs = await getPreferences(testUser.id);
            expect(prefs).toBeTruthy();
            expect(JSON.parse(prefs.preferences)).toHaveLength(1);
        });

        it('should handle database errors', async () => {
            isErrorExpected = true;
            
            // Mock db.get to simulate error
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Database error'));
            };

            await expect(getPreferences(1)).rejects.toThrow('Database error');
            expect(console.error).toHaveBeenCalled();

            // Restore original function
            testDb.get = originalGet;
        });

        it('should return null when no preferences exist', async () => {
            const testUser = await createTestUser();
            const prefs = await getPreferences(testUser.id);
            expect(prefs).toBeNull();
        });
    });
}); 