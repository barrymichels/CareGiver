const sqlite3 = require('sqlite3');
const configureDatabase = require('../../config/database');
const path = require('path');

// Mock process.exit before any tests run
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

describe('Database Configuration', () => {
    let db;
    const testDbPath = ':memory:';

    beforeEach(() => {
        // Save original console methods
        console._error = console.error;
        console._log = console.log;
    });

    afterEach(() => {
        // Restore original console methods
        console.error = console._error;
        console.log = console._log;
        
        if (db) {
            db.close();
            db = null;
        }

        // Clear mock data
        mockExit.mockClear();
    });

    afterAll(() => {
        // Restore process.exit
        mockExit.mockRestore();
    });

    it('should configure WAL mode for file-based database', async () => {
        // Create a temporary database file
        const tmpDbPath = path.join(__dirname, 'temp.db');
        const fileDb = configureDatabase(tmpDbPath);

        try {
            // Wait for database to be ready and configured
            await new Promise(resolve => {
                fileDb.serialize(() => {
                    fileDb.run('SELECT 1', () => {
                        resolve();
                    });
                });
            });

            const journalMode = await new Promise((resolve, reject) => {
                fileDb.get('PRAGMA journal_mode', (err, result) => {
                    if (err) reject(err);
                    resolve(result.journal_mode);
                });
            });

            expect(journalMode).toBe('wal');
        } finally {
            fileDb.close();
            // Clean up the temporary file
            require('fs').unlinkSync(tmpDbPath);
            if (require('fs').existsSync(tmpDbPath + '-wal')) {
                require('fs').unlinkSync(tmpDbPath + '-wal');
            }
            if (require('fs').existsSync(tmpDbPath + '-shm')) {
                require('fs').unlinkSync(tmpDbPath + '-shm');
            }
        }
    });

    it('should handle database open errors', async () => {
        // Mock console.error
        const mockConsoleError = jest.fn();
        console.error = mockConsoleError;

        // Try to open database with invalid path
        const invalidPath = path.join('nonexistent', 'dir', 'db.sqlite');
        
        expect(() => {
            db = configureDatabase(invalidPath);
        }).not.toThrow(); // Should handle error gracefully

        // Wait for the error handler to be called
        await new Promise(resolve => setTimeout(resolve, 0));

        // Verify error was logged and process.exit was called
        expect(mockConsoleError).toHaveBeenCalledWith(
            'Error opening database:',
            expect.objectContaining({
                code: 'SQLITE_CANTOPEN',
                errno: 14
            })
        );
        expect(mockExit).toHaveBeenCalledWith(1);
    });

    describe('Development Environment', () => {
        const OLD_ENV = process.env;

        beforeEach(() => {
            jest.resetModules();
            process.env = { ...OLD_ENV, NODE_ENV: 'development' };
        });

        afterEach(() => {
            process.env = OLD_ENV;
        });

        it('should log SQL queries in development', () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);

            // Trigger a trace event
            db.emit('trace', 'SELECT * FROM test');

            expect(mockConsoleLog).toHaveBeenCalledWith(
                'SQL:',
                'SELECT * FROM test'
            );
        });

        it('should log slow queries in development', () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);

            // Trigger a profile event with a slow query (>100ms)
            db.emit('profile', 'SELECT * FROM test', 150);

            expect(mockConsoleLog).toHaveBeenCalledWith(
                'Slow query (150ms):',
                'SELECT * FROM test'
            );
        });

        it('should not log fast queries', () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);

            // Trigger a profile event with a fast query (<100ms)
            db.emit('profile', 'SELECT * FROM test', 50);

            expect(mockConsoleLog).not.toHaveBeenCalled();
        });
    });

    describe('Production Environment', () => {
        const OLD_ENV = process.env;

        beforeEach(() => {
            jest.resetModules();
            process.env = { ...OLD_ENV, NODE_ENV: 'production' };
        });

        afterEach(() => {
            process.env = OLD_ENV;
        });

        it('should not log SQL queries in production', () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);

            // Trigger a trace event
            db.emit('trace', 'SELECT * FROM test');

            expect(mockConsoleLog).not.toHaveBeenCalled();
        });

        it('should not log slow queries in production', () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);

            // Trigger a profile event with a slow query
            db.emit('profile', 'SELECT * FROM test', 150);

            expect(mockConsoleLog).not.toHaveBeenCalled();
        });
    });
}); 