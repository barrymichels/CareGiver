const { testDb, initializeTestDb } = require('../../config/test.db');
const DatabaseHelper = require('../../utils/dbHelper');

describe('DatabaseHelper', () => {
    let dbHelper;

    beforeAll(async () => {
        await initializeTestDb();
        dbHelper = new DatabaseHelper(testDb);
    });

    beforeEach(async () => {
        // Clear any existing test tables
        await new Promise((resolve) => {
            testDb.run('DROP TABLE IF EXISTS test_table', resolve);
            testDb.run('DROP TABLE IF EXISTS retry_test', resolve);
            testDb.run('DROP TABLE IF EXISTS transaction_test', resolve);
        });
    });

    describe('runWithRetry', () => {
        it('should execute SQL successfully', async () => {
            const result = await dbHelper.runWithRetry(
                'CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT)'
            );
            expect(result).toBeDefined();
        });

        it('should handle SQL errors', async () => {
            await expect(dbHelper.runWithRetry('INVALID SQL'))
                .rejects
                .toThrow();
        });

        it('should retry on SQLITE_BUSY error', async () => {
            // Mock the db.run to simulate SQLITE_BUSY error once
            const originalRun = testDb.run;
            let attempts = 0;
            testDb.run = function(sql, params, callback) {
                if (typeof params === 'function') {
                    callback = params;
                    params = [];
                }
                attempts++;
                if (attempts === 1) {
                    callback({ code: 'SQLITE_BUSY' });
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            const result = await dbHelper.runWithRetry(
                'CREATE TABLE IF NOT EXISTS retry_test (id INTEGER PRIMARY KEY)'
            );
            expect(result).toBeDefined();
            expect(attempts).toBe(2);

            // Restore original run function
            testDb.run = originalRun;
        });

        it('should give up after max retries', async () => {
            // Mock the db.run to always return SQLITE_BUSY
            const originalRun = testDb.run;
            testDb.run = function(sql, params, callback) {
                if (typeof params === 'function') {
                    callback = params;
                    params = [];
                }
                callback({ code: 'SQLITE_BUSY' });
            };

            await expect(dbHelper.runWithRetry(
                'SELECT 1',
                [],
                2 // Set max retries to 2 for faster test
            )).rejects.toHaveProperty('code', 'SQLITE_BUSY');

            // Restore original run function
            testDb.run = originalRun;
        });
    });

    describe('Transaction Management', () => {
        beforeEach(async () => {
            // Create a test table for transaction tests
            await dbHelper.runWithRetry(`
                CREATE TABLE IF NOT EXISTS transaction_test (
                    id INTEGER PRIMARY KEY,
                    value TEXT
                )
            `);
        });

        it('should execute transaction successfully', async () => {
            await dbHelper.withTransaction(async () => {
                await dbHelper.runWithRetry(
                    'INSERT INTO transaction_test (value) VALUES (?)',
                    ['test1']
                );
                await dbHelper.runWithRetry(
                    'INSERT INTO transaction_test (value) VALUES (?)',
                    ['test2']
                );
            });

            // Verify both inserts were successful
            const result = await new Promise((resolve) => {
                testDb.all('SELECT * FROM transaction_test', (err, rows) => {
                    resolve(rows);
                });
            });
            expect(result).toHaveLength(2);
        });

        it('should rollback transaction on error', async () => {
            // Start a transaction and insert data
            try {
                await dbHelper.withTransaction(async () => {
                    await dbHelper.runWithRetry(
                        'INSERT INTO transaction_test (value) VALUES (?)',
                        ['test1']
                    );
                    // Throw an error to trigger rollback
                    throw new Error('Test error');
                });
            } catch (error) {
                expect(error.message).toBe('Test error');
            }

            // Verify no data was inserted (rollback successful)
            const result = await new Promise((resolve) => {
                testDb.all('SELECT * FROM transaction_test', (err, rows) => {
                    resolve(rows);
                });
            });
            expect(result).toHaveLength(0);
        });

        // Remove nested transactions test since SQLite doesn't support them
    });

    describe('Error Handling', () => {
        it('should handle rollback errors', async () => {
            // Mock console.error to verify it's called
            const originalConsoleError = console.error;
            const mockConsoleError = jest.fn();
            console.error = mockConsoleError;

            // Mock db.run to simulate rollback error
            const originalRun = testDb.run;
            testDb.run = function(sql, params, callback) {
                if (typeof params === 'function') {
                    callback = params;
                    params = [];
                }
                if (sql === 'ROLLBACK') {
                    callback(new Error('Rollback failed'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            await dbHelper.rollback();

            expect(mockConsoleError).toHaveBeenCalled();

            // Restore mocks
            console.error = originalConsoleError;
            testDb.run = originalRun;
        });

        it('should handle begin transaction errors', async () => {
            // Mock db.run to simulate begin transaction error
            const originalRun = testDb.run;
            testDb.run = function(sql, params, callback) {
                if (typeof params === 'function') {
                    callback = params;
                    params = [];
                }
                if (sql === 'BEGIN IMMEDIATE TRANSACTION') {
                    callback(new Error('Begin failed'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            await expect(dbHelper.beginTransaction())
                .rejects
                .toThrow('Begin failed');

            // Restore mock
            testDb.run = originalRun;
        });

        it('should handle commit errors', async () => {
            // Mock db.run to simulate commit error
            const originalRun = testDb.run;
            testDb.run = function(sql, params, callback) {
                if (typeof params === 'function') {
                    callback = params;
                    params = [];
                }
                if (sql === 'COMMIT') {
                    callback(new Error('Commit failed'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            await expect(dbHelper.commit())
                .rejects
                .toThrow('Commit failed');

            // Restore mock
            testDb.run = originalRun;
        });
    });
}); 