const DatabaseHelper = require('../../utils/dbHelper');
const { testDb, initializeTestDb } = require('../../config/test.db');

// Test-specific configuration
const TEST_CONFIG = {
    maxRetries: 2,
    delay: 10
};

// Reduce timeout for all tests in this file
jest.setTimeout(5000);

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
                ['test'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            expect(result).toBeDefined();
        });

        it('should handle SQL errors', async () => {
            await expect(
                dbHelper.runWithRetry('INVALID SQL', [], TEST_CONFIG.maxRetries, TEST_CONFIG.delay)
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
                ['test'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
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
                    ['test'],
                    TEST_CONFIG.maxRetries,
                    TEST_CONFIG.delay
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
                ['test1'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test2'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
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
                ['test1'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );

            // Simulate error
            await expect(
                dbHelper.runWithRetry('INVALID SQL', [], TEST_CONFIG.maxRetries, TEST_CONFIG.delay)
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

    describe('getWithRetry', () => {
        it('should fetch single row successfully', async () => {
            // Insert test data
            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['test_get'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );

            const result = await dbHelper.getWithRetry(
                'SELECT * FROM transaction_test WHERE value = ?',
                ['test_get'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            
            expect(result).toBeDefined();
            expect(result.value).toBe('test_get');
        });

        it('should return undefined for non-existent row', async () => {
            const result = await dbHelper.getWithRetry(
                'SELECT * FROM transaction_test WHERE value = ?',
                ['nonexistent'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            
            expect(result).toBeUndefined();
        });

        it('should retry on SQLITE_BUSY with exponential backoff', async () => {
            // Mock db.get to simulate SQLITE_BUSY error once
            const originalGet = testDb.get;
            let attempts = 0;
            testDb.get = (sql, params, callback) => {
                if (attempts === 0) {
                    attempts++;
                    const error = new Error('SQLITE_BUSY');
                    error.code = 'SQLITE_BUSY';
                    callback(error);
                } else {
                    originalGet.call(testDb, sql, params, callback);
                }
            };

            const result = await dbHelper.getWithRetry(
                'SELECT 1',
                [],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            expect(result).toBeDefined();

            // Restore original function
            testDb.get = originalGet;
        });

        it('should handle non-SQLITE_BUSY errors immediately', async () => {
            const originalGet = testDb.get;
            testDb.get = (sql, params, callback) => {
                callback(new Error('Other error'));
            };

            await expect(
                dbHelper.getWithRetry('SELECT * FROM transaction_test', [], TEST_CONFIG.maxRetries, TEST_CONFIG.delay)
            ).rejects.toThrow('Other error');

            testDb.get = originalGet;
        });
    });

    describe('allWithRetry', () => {
        it('should fetch multiple rows successfully', async () => {
            // Insert test data
            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?), (?)',
                ['test1', 'test2'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );

            const results = await dbHelper.allWithRetry(
                'SELECT * FROM transaction_test ORDER BY value',
                [],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            
            expect(results).toHaveLength(2);
            expect(results[0].value).toBe('test1');
            expect(results[1].value).toBe('test2');
        });

        it('should return empty array for no results', async () => {
            const results = await dbHelper.allWithRetry(
                'SELECT * FROM transaction_test WHERE value = ?',
                ['nonexistent'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            
            expect(results).toEqual([]);
        });

        it('should retry on SQLITE_LOCKED with exponential backoff', async () => {
            // Mock db.all to simulate SQLITE_LOCKED error once
            const originalAll = testDb.all;
            let attempts = 0;
            testDb.all = (sql, params, callback) => {
                if (attempts === 0) {
                    attempts++;
                    const error = new Error('SQLITE_LOCKED');
                    error.code = 'SQLITE_LOCKED';
                    callback(error);
                } else {
                    originalAll.call(testDb, sql, params, callback);
                }
            };

            const result = await dbHelper.allWithRetry(
                'SELECT 1',
                [],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            expect(result).toBeDefined();

            // Restore original function
            testDb.all = originalAll;
        });

        it('should handle concurrent transactions', async () => {
            // Create fresh table for this test
            await new Promise((resolve, reject) => {
                testDb.run('DROP TABLE IF EXISTS transaction_test', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
            
            await new Promise((resolve, reject) => {
                testDb.run(`
                    CREATE TABLE transaction_test (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        value TEXT NOT NULL
                    )
                `, (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Start a transaction that will hold a lock
            await dbHelper.beginTransaction();
            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                ['locked'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );

            // Try to read while transaction is in progress
            const promise = dbHelper.allWithRetry(
                'SELECT * FROM transaction_test WHERE value = ?',
                ['locked'],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );

            // Complete transaction after a delay
            await new Promise(resolve => setTimeout(resolve, 50)); // Small delay to ensure transaction is active
            
            await dbHelper.commit();
            const results = await promise;
            
            expect(results).toHaveLength(1);
            expect(results[0].value).toBe('locked');
        });
    });

    describe('Edge Cases', () => {
        it('should handle maximum retry attempts correctly', async () => {
            const maxRetries = 2;
            const startTime = Date.now();
            
            // Mock db.run to always return SQLITE_BUSY
            const originalRun = testDb.run;
            testDb.run = (sql, params, callback) => {
                const error = new Error('SQLITE_BUSY');
                error.code = 'SQLITE_BUSY';
                callback(error);
            };

            await expect(
                dbHelper.runWithRetry(
                    'SELECT 1',
                    [],
                    maxRetries,
                    TEST_CONFIG.delay
                )
            ).rejects.toThrow('SQLITE_BUSY');

            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(1000); // Should complete quickly

            // Restore original function
            testDb.run = originalRun;
        });

        it('should handle null parameters correctly', async () => {
            // First modify the table to allow NULL values
            await new Promise((resolve, reject) => {
                testDb.run('DROP TABLE IF EXISTS transaction_test', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
            
            await new Promise((resolve, reject) => {
                testDb.run(`
                    CREATE TABLE transaction_test (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        value TEXT
                    )
                `, (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Verify table exists and has correct schema
            const tableInfo = await new Promise((resolve, reject) => {
                testDb.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='transaction_test'", (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });
            expect(tableInfo).toBeDefined();

            await dbHelper.runWithRetry(
                'INSERT INTO transaction_test (value) VALUES (?)',
                [null],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );

            const result = await dbHelper.getWithRetry(
                'SELECT * FROM transaction_test WHERE value IS NULL',
                [],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            
            expect(result).toBeDefined();
            expect(result.value).toBeNull();
        });

        it('should handle empty parameter arrays', async () => {
            const result = await dbHelper.getWithRetry(
                'SELECT COUNT(*) as count FROM transaction_test',
                [],
                TEST_CONFIG.maxRetries,
                TEST_CONFIG.delay
            );
            
            expect(result).toBeDefined();
            expect(typeof result.count).toBe('number');
        });
    });
}); 