const configureDatabase = require('../../config/database');
const path = require('path');
const fs = require('fs');

const os = require('os');

describe('Database Configuration', () => {
    let db;
    let tmpDir;
    let tmpDbPath;
    let mockExit;
    const testDbPath = ':memory:';
    const openConnections = new Set();

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayne-db-test-'));
        tmpDbPath = path.join(tmpDir, 'test.db');
        mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(async () => {
        try {
            await Promise.all(Array.from(openConnections, conn => new Promise((resolve, reject) => {
                conn.close(err => err ? reject(err) : resolve());
            })));
        } finally {
            openConnections.clear();
            jest.restoreAllMocks();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should configure WAL mode for file-based database', async () => {
        const fileDb = configureDatabase(tmpDbPath);
        openConnections.add(fileDb);

        // The configuration queues its PRAGMAs before this read.
        const settings = await new Promise((resolve, reject) => {
            fileDb.get('PRAGMA journal_mode', (err, row) => err ? reject(err) : resolve(row));
        });
        expect(settings.journal_mode).toBe('wal');
    });

    it('should refuse an unconfigured database path and name the variable', () => {
        // The whole point is the message: an operator must not need to read this file
        // to learn which environment variable is missing.
        for (const missing of [undefined, null, '', '   ']) {
            expect(() => configureDatabase(missing)).toThrow(/DB_PATH/);
        }
    });

    it('should handle database open errors', async () => {
        const exited = new Promise(resolve => mockExit.mockImplementation(resolve));
        // This path cannot be a directory because __filename is a file.
        configureDatabase(path.join(__filename, 'db.sqlite'));
        // A failed open never owns a connection to close. Wait for its callback.
        await expect(exited).resolves.toBe(1);
        expect(console.error).toHaveBeenCalledWith(
            'Error opening database:',
            expect.objectContaining({ code: 'SQLITE_CANTOPEN', errno: 14 })
        );
    });

    describe('Development Environment', () => {
        const OLD_ENV = process.env;

        beforeEach(() => {
            process.env = { ...OLD_ENV, NODE_ENV: 'development' };
        });

        afterEach(() => {
            process.env = OLD_ENV;
        });

        it('should log SQL queries in development', async () => {
            const mockConsoleLog = console.log;

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
            const mockConsoleLog = console.log;

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
            const mockConsoleLog = console.log;

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
            process.env = { ...OLD_ENV, NODE_ENV: 'production' };
        });

        afterEach(() => {
            process.env = OLD_ENV;
        });

        it('should not log SQL queries in production', async () => {
            const mockConsoleLog = console.log;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a trace event
            db.emit('trace', 'SELECT * FROM test');

            expect(mockConsoleLog).not.toHaveBeenCalled();
        }, 2000);

        it('should not log slow queries in production', async () => {
            const mockConsoleLog = console.log;

            db = configureDatabase(testDbPath);
            openConnections.add(db);

            // Trigger a profile event with a slow query
            db.emit('profile', 'SELECT * FROM test', 150);

            expect(mockConsoleLog).not.toHaveBeenCalled();
        }, 2000);
    });
}); 