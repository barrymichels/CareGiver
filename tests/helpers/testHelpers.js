const bcrypt = require('bcrypt');
const { testDb } = require('../../config/test.db');

let userCounter = 0;

async function createTestUser(userData = {}) {
    userCounter++;
    const defaultUser = {
        first_name: 'Test',
        last_name: 'User',
        email: `test${userCounter}@example.com`,
        password: await bcrypt.hash('password123', 10),
        is_admin: 0,
        is_active: 1
    };

    const user = { ...defaultUser, ...userData };

    return new Promise((resolve, reject) => {
        testDb.run(
            `INSERT INTO users (first_name, last_name, email, password, is_admin, is_active)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [user.first_name, user.last_name, user.email, user.password, user.is_admin, user.is_active],
            function(err) {
                if (err) reject(err);
                resolve({ ...user, id: this.lastID });
            }
        );
    });
}

async function getUserByEmail(email) {
    return new Promise((resolve, reject) => {
        testDb.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}

async function clearTestDb() {
    const tables = ['users', 'availability', 'assignments', 'user_preferences'];
    
    for (const table of tables) {
        await new Promise((resolve, reject) => {
            testDb.run(`DELETE FROM ${table}`, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
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

async function getAvailability(userId) {
    return new Promise((resolve, reject) => {
        testDb.all(
            'SELECT * FROM availability WHERE user_id = ?',
            [userId],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows || []);
            }
        );
    });
}

module.exports = {
    createTestUser,
    getUserByEmail,
    clearTestDb,
    createAvailability,
    getAvailability
}; 