const sqlite3 = require('sqlite3');
const initializeDatabase = require('../../config/database.init');

describe('Database Initialization', () => {
    let db;

    beforeEach(() => {
        // Use in-memory database for testing
        db = new sqlite3.Database(':memory:');
    });

    afterEach((done) => {
        db.close(done);
    });

    it('should create all required tables', async () => {
        await initializeDatabase(db);

        const tables = await new Promise((resolve, reject) => {
            db.all(
                "SELECT name FROM sqlite_master WHERE type='table'",
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows.map(row => row.name));
                }
            );
        });

        expect(tables).toContain('users');
        expect(tables).toContain('availability');
        expect(tables).toContain('assignments');
        expect(tables).toContain('user_preferences');
    });

    it('should create users table with correct schema', async () => {
        await initializeDatabase(db);

        const schema = await new Promise((resolve, reject) => {
            db.get(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
                (err, row) => {
                    if (err) reject(err);
                    resolve(row.sql.toLowerCase());
                }
            );
        });

        expect(schema).toContain('id integer primary key autoincrement');
        expect(schema).toContain('first_name text not null');
        expect(schema).toContain('last_name text not null');
        expect(schema).toContain('email text unique');
        expect(schema).toContain('password text');
        expect(schema).toContain('is_admin boolean not null default 0');
        expect(schema).toContain('is_active boolean not null default 0');
        expect(schema).toContain('created_at datetime default current_timestamp');
    });

    it('should create availability table with correct schema and constraints', async () => {
        await initializeDatabase(db);

        const schema = await new Promise((resolve, reject) => {
            db.get(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='availability'",
                (err, row) => {
                    if (err) reject(err);
                    resolve(row.sql.toLowerCase());
                }
            );
        });

        expect(schema).toContain('id integer primary key autoincrement');
        expect(schema).toContain('user_id integer not null');
        expect(schema).toContain('day_date date not null');
        expect(schema).toContain('time_slot text not null');
        expect(schema).toContain('is_available boolean default 1');
        expect(schema).toContain('created_at datetime default current_timestamp');
        expect(schema).toContain('foreign key (user_id) references users(id)');
        expect(schema).toContain('unique(user_id, day_date, time_slot)');
    });

    it('should create assignments table with correct schema and constraints', async () => {
        await initializeDatabase(db);

        const schema = await new Promise((resolve, reject) => {
            db.get(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='assignments'",
                (err, row) => {
                    if (err) reject(err);
                    resolve(row.sql.toLowerCase());
                }
            );
        });

        expect(schema).toContain('id integer primary key autoincrement');
        expect(schema).toContain('user_id integer not null');
        expect(schema).toContain('day_date date not null');
        expect(schema).toContain('time_slot text not null');
        expect(schema).toContain('assigned_by integer not null');
        expect(schema).toContain('created_at datetime default current_timestamp');
        expect(schema).toContain('foreign key (user_id) references users(id)');
        expect(schema).toContain('foreign key (assigned_by) references users(id)');
        expect(schema).toContain('unique(day_date, time_slot)');
    });

    it('should create user_preferences table with correct schema and constraints', async () => {
        await initializeDatabase(db);

        const schema = await new Promise((resolve, reject) => {
            db.get(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_preferences'",
                (err, row) => {
                    if (err) reject(err);
                    resolve(row.sql.toLowerCase());
                }
            );
        });

        expect(schema).toContain('user_id integer primary key');
        expect(schema).toContain('preferences text not null');
        expect(schema).toContain('foreign key (user_id) references users(id)');
    });

    it('should handle errors gracefully', async () => {
        // Create a broken database connection
        const brokenDb = {
            serialize: (callback) => callback(),
            run: (sql, callback) => callback(new Error('Database error'))
        };

        await expect(initializeDatabase(brokenDb)).rejects.toThrow('Database error');
    });
}); 