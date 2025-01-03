const sqlite3 = require('sqlite3');
const configureDatabase = require('../../config/database');
const path = require('path');
const fs = require('fs');

// Mock process.exit before any tests run
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Keep track of all database connections
const openConnections = new Set();

// Helper function to log open connections
// function logOpenConnections() {
//     console.log(`Open connections: ${openConnections.size}`);
// }

// Helper function to log active timers
// function logActiveTimers() {
//     const activeTimers = process._getActiveHandles().filter(handle => handle._onTimeout);
//     console.log(`Active timers: ${activeTimers.length}`);
// }

describe('Database Configuration', () => {
    let db;
    const testDbPath = ':memory:';
    const tmpDbPath = path.join(__dirname, 'temp.db');

    beforeEach(() => {
        // Save original console methods
        console._error = console.error;
        console._log = console.log;
    });

    afterEach(async () => {
        // Log open connections and active timers
        // logOpenConnections();
        // logActiveTimers();

        // Restore original console methods
        console.error = console._error;
        console.log = console._log;
        
        // Close all database connections with a timeout
        try {
            const closePromises = Array.from(openConnections).map(conn => 
                new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        resolve(); // Don't reject, just resolve to prevent hanging
                    }, 1000);

                    conn.close((err) => {
                        clearTimeout(timeout);
                        if (err) {
                            console.error('Error closing connection:', err);
                            resolve(); // Don't reject, just resolve to prevent hanging
                        } else {
                            resolve();
                        }
                    });
                })
            );
            
            await Promise.all(closePromises);
        } catch (err) {
            console.error('Error in afterEach cleanup:', err);
        } finally {
            openConnections.clear();
        }

        // Clean up temp files
        [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`].forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            } catch (err) {
                console.error(`Error cleaning up file ${file}:`, err);
            }
        });

        // Clear mock data
        mockExit.mockClear();
    }, 10000); // Increase timeout for cleanup

    afterAll(() => {
        // Restore process.exit
        mockExit.mockRestore();
    });

    it('should configure WAL mode for file-based database', async () => {
        // Clean up any existing temp db file
        if (fs.existsSync(tmpDbPath)) {
            fs.unlinkSync(tmpDbPath);
        }
        
        const fileDb = configureDatabase(tmpDbPath);
        openConnections.add(fileDb);

        try {
            // Wait for database to be ready and configured
            await new Promise((resolve, reject) => {
                fileDb.serialize(() => {
                    fileDb.run('SELECT 1', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });

            const journalMode = await new Promise((resolve, reject) => {
                fileDb.get('PRAGMA journal_mode', (err, result) => {
                    if (err) reject(err);
                    else resolve(result.journal_mode);
                });
            });

            expect(journalMode).toBe('wal');
        } finally {
            await new Promise(resolve => fileDb.close(resolve));
            openConnections.delete(fileDb);
        }
    });

    it('should handle database open errors', async () => {
        // Mock console.error
        const mockConsoleError = jest.fn();
        console.error = mockConsoleError;

        // Try to open database with invalid path
        const invalidPath = path.join('nonexistent', 'dir', 'db.sqlite');
        
        db = null;
        expect(() => {
            db = configureDatabase(invalidPath);
            if (db) openConnections.add(db);
        }).not.toThrow(); // Should handle error gracefully

        // Wait for the error handler to be called
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify error was logged and process.exit was called
        expect(mockConsoleError).toHaveBeenCalledWith(
            'Error opening database:',
            expect.objectContaining({
                code: 'SQLITE_CANTOPEN',
                errno: 14
            })
        );
        expect(mockExit).toHaveBeenCalledWith(1);
    }, 2000); // Add timeout

    describe('Development Environment', () => {
        const OLD_ENV = process.env;

        beforeEach(() => {
            jest.resetModules();
            process.env = { ...OLD_ENV, NODE_ENV: 'development' };
        });

        afterEach(() => {
            process.env = OLD_ENV;
        });

        it('should log SQL queries in development', async () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a trace event
            db.emit('trace', 'SELECT * FROM test');

            expect(mockConsoleLog).toHaveBeenCalledWith(
                'SQL:',
                'SELECT * FROM test'
            );
        }, 2000);

        it('should log slow queries in development', async () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a profile event with a slow query (>100ms)
            db.emit('profile', 'SELECT * FROM test', 150);

            expect(mockConsoleLog).toHaveBeenCalledWith(
                'Slow query (150ms):',
                'SELECT * FROM test'
            );
        }, 2000);

        it('should not log fast queries', async () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a profile event with a fast query (<100ms)
            db.emit('profile', 'SELECT * FROM test', 50);

            expect(mockConsoleLog).not.toHaveBeenCalled();
        }, 2000);
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

        it('should not log SQL queries in production', async () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a trace event
            db.emit('trace', 'SELECT * FROM test');

            expect(mockConsoleLog).not.toHaveBeenCalled();
        }, 2000);

        it('should not log slow queries in production', async () => {
            const mockConsoleLog = jest.fn();
            console.log = mockConsoleLog;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a profile event with a slow query
            db.emit('profile', 'SELECT * FROM test', 150);

            expect(mockConsoleLog).not.toHaveBeenCalled();
        }, 2000);
    });
}); 