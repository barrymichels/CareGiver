const DatabaseHelper = require('../../utils/dbHelper');
const { testDb, initializeTestDb } = require('../../config/test.db');

// Increase timeout for all tests in this file
jest.setTimeout(30000);

describe('DatabaseHelper', () => {
    let dbHelper;
    let originalConsoleError;
    let isErrorExpected = false;

    beforeAll(async () => {
        await initializeTestDb();
        originalConsoleError = console.error;
    });

    beforeEach(async () => {
        isErrorExpected = false;
        console.error = jest.fn();
        
        // Create test table for transaction tests
        await new Promise((resolve, reject) => {
            testDb.run(`
                CREATE TABLE IF NOT EXISTS transaction_test (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    value TEXT NOT NULL
                )
            `, (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        // Clear test table before each test
        await new Promise((resolve, reject) => {
            testDb.run('DELETE FROM transaction_test', (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        // Ensure no transaction is in progress
        await new Promise((resolve, reject) => {
            testDb.run('ROLLBACK', (err) => {
                // Ignore any error since there might not be a transaction
                resolve();
            });
        });

        dbHelper = new DatabaseHelper(testDb);
    });

    afterEach(async () => {
        // Only verify no unexpected errors if we're not expecting errors
        if (!isErrorExpected) {
            expect(console.error).not.toHaveBeenCalled();
        }
        
        // Ensure no transaction is left hanging
        await new Promise((resolve) => {
            testDb.run('ROLLBACK', () => resolve());
        });

        // Reset console.error to original after each test
        console.error = originalConsoleError;
    });

    afterAll(async () => {
        try {
            // Ensure no transaction is in progress
            await new Promise((resolve) => {
                testDb.run('ROLLBACK', () => resolve());
            });

            // Drop test table
            await new Promise((resolve, reject) => {
                testDb.run('DROP TABLE IF EXISTS transaction_test', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        } finally {
            // Restore original console.error
            console.error = originalConsoleError;
        }
    });

    describe('runWithRetry', () => {
        it('should execute SQL successfully', async () => {
            const result = await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test']
            );
            expect(result).toBeDefined();
        });

        it('should handle SQL errors', async () => {
            await expect(
                dbHelper.runWithRetry('INVALID SQL')
            ).rejects.toThrow();
        });

        it('should retry on SQLITE_BUSY error', async () => {
            // Mock db.run to simulate SQLITE_BUSY error once
            const originalRun = testDb.run;
            let attempts = 0;
            testDb.run = (sql, params, callback) => {
                if (attempts === 0) {
                    attempts++;
                    const error = new Error('SQLITE_BUSY');
                    error.code = 'SQLITE_BUSY';
                    callback(error);
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            const result = await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test']
            );
            expect(result).toBeDefined();

            // Restore original function
            testDb.run = originalRun;
        });

        it('should give up after max retries', async () => {
            // Mock db.run to always return SQLITE_BUSY
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                const error = new Error('SQLITE_BUSY');
                error.code = 'SQLITE_BUSY';
                callback(error);
            };

            await expect(
                dbHelper.runWithRetry(
                    'INSERT INTO transaction_test (value) VALUES (?)',
                    ['test']
                )
            ).rejects.toThrow('SQLITE_BUSY');

            // Restore original function
            testDb.run = originalRun;
        });
    });

    describe('Transaction Management', () => {
        it('should execute transaction successfully', async () => {
            await dbHelper.beginTransaction();
            
            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test1']
            );
            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test2']
            );
            
            await dbHelper.commit();

            // Verify both inserts were successful
            const rows = await new Promise((resolve, reject) => {
                testDb.all('SELECT * FROM transaction_test', (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                });
            });

            expect(rows).toHaveLength(2);
            expect(rows[0].value).toBe('test1');
            expect(rows[1].value).toBe('test2');
        });

        it('should rollback transaction on error', async () => {
            await dbHelper.beginTransaction();

            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test1']
            );

            // Simulate error
            await expect(
                dbHelper.runWithRetry('INVALID SQL')
            ).rejects.toThrow();

            await dbHelper.rollback();

            // Verify no data was inserted
            const rows = await new Promise((resolve, reject) => {
                testDb.all('SELECT * FROM transaction_test', (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                });
            });

            expect(rows).toHaveLength(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle rollback errors', async () => {
            isErrorExpected = true;
            
            // Mock db.run to simulate rollback error
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                if (sql.includes('ROLLBACK')) {
                    callback(new Error('Rollback error'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            try {
                await dbHelper.beginTransaction();
                await dbHelper.rollback();
                fail('Expected rollback to throw an error');
            } catch (error) {
                expect(error.message).toBe('Rollback error');
                expect(console.error).toHaveBeenCalled();
            }

            // Restore original function
            testDb.run = originalRun;
        });

        it('should handle begin transaction errors', async () => {
            // Mock db.run to simulate begin error
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                if (sql.includes('BEGIN')) {
                    callback(new Error('Begin error'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            await expect(dbHelper.beginTransaction()).rejects.toThrow('Begin error');

            // Restore original function
            testDb.run = originalRun;
        });

        it('should handle commit errors', async () => {
            isErrorExpected = true;
            
            // Mock db.run to simulate commit error
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                if (sql.includes('COMMIT')) {
                    callback(new Error('Commit error'));
                } else {
                    originalRun.call(testDb, sql, params, callback);
                }
            };

            try {
                await dbHelper.beginTransaction();
                await dbHelper.commit();
                fail('Expected commit to throw an error');
            } catch (error) {
                expect(error.message).toBe('Commit error');
            } finally {
                // Restore original function
                testDb.run = originalRun;
            }
        });
    });
}); 