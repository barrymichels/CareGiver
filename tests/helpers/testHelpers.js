const bcrypt = require('bcrypt');
const { testDb } = require('../../config/test.db');

let userCounter = 0;

async function createTestUser(userData = {}) {
    userCounter++;
    const defaultUser = {
        first_name: 'Test',
        last_name: 'User',
        email: `test${userCounter}@example.com`,
        password: 'password123',
        is_admin: 0,
        is_active: 1
    };

    const user = { ...defaultUser, ...userData };

    // Keep real password verification without paying the production work factor per fixture.
    if (user.password != null) {
        user.password = await bcrypt.hash(user.password, 4);
    }

    // A single INSERT is already atomic; an explicit transaction prevents concurrent fixtures.
    return new Promise((resolve, reject) => {
        testDb.run(
            `INSERT INTO users (first_name, last_name, email, password, is_admin, is_active, reset_token, reset_token_expires)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.first_name, user.last_name, user.email, user.password, user.is_admin, user.is_active, user.reset_token || null, user.reset_token_expires || null],
            function (err) {
                if (err) return reject(err);
                resolve({ ...user, id: this.lastID });
            }
        );
    });
}

async function clearTestDb() {
    // Child-first order. config/test.db.js enables `PRAGMA foreign_keys = ON` to mirror
    // production, so deleting a parent (users) before its children makes SQLite reject the
    // teardown with SQLITE_FOREIGNKEY and every suite below it reports a bogus failure.
    // New tables must be inserted before whatever they reference.
    const tables = [
        'availability',
        'assignments',
        'user_preferences',
        'notification_settings',
        'morning_summary_log',
        'template_slots',
        'timeslots',
        'timeslot_configurations',
        'timeslot_templates',
        'users',
    ];

    // Use a single transaction for faster cleanup
    await new Promise((resolve, reject) => {
        testDb.run('BEGIN TRANSACTION', (err) => {
            if (err) reject(err);
            resolve();
        });
    });

    try {
        for (const table of tables) {
            await new Promise((resolve, reject) => {
                testDb.run(`DELETE FROM ${table}`, (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        }

        await new Promise((resolve, reject) => {
            testDb.run('COMMIT', (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    } catch (error) {
        await new Promise((resolve) => {
            testDb.run('ROLLBACK', () => resolve());
        });
        throw error;
    }
}

async function createAvailability(userId, slots) {
    for (const slot of slots) {
        await new Promise((resolve, reject) => {
            testDb.run(
                `INSERT INTO availability (user_id, day_date, time_slot, is_available)
                 VALUES (?, ?, ?, ?)`,
                [userId, slot.date, slot.time, slot.isAvailable ? 1 : 0],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });
    }
}

// Add a helper to verify user updates
async function getUserById(userId) {
    return new Promise((resolve, reject) => {
        testDb.get(
            'SELECT id, first_name, last_name, email, password, is_active, is_admin FROM users WHERE id = ?',
            [userId],
            (err, row) => {
                if (err) {
                    console.error('Error getting user:', err);
                    reject(err);
                    return;
                }
                if (!row) {
                    const error = new Error('User not found');
                    console.error('Error getting user:', error);
                    reject(error);
                    return;
                }
                resolve(row);
            }
        );
    });
}

function normalizeViewPath(viewPath) {
    // Remove file extension and convert Windows paths to forward slashes
    return viewPath
        .replace(/\.ejs$/, '')
        .replace(/\\/g, '/')
        .split('/views/')[1] || viewPath;
}

module.exports = {
    createTestUser,
    clearTestDb,
    createAvailability,
    getUserById,
    normalizeViewPath
};