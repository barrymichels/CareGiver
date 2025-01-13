const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const testDb = new sqlite3.Database(':memory:');

// Create tables for testing
function initializeTestDb() {
    return new Promise((resolve, reject) => {
        testDb.serialize(() => {
            // Users table
            testDb.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    email TEXT UNIQUE,
                    password TEXT,
                    is_admin BOOLEAN NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT 0,
                    reset_token TEXT,
                    reset_token_expires DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Availability table
            testDb.run(`
                CREATE TABLE IF NOT EXISTS availability (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    day_date DATE NOT NULL,
                    time_slot TEXT NOT NULL,
                    is_available BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    UNIQUE(user_id, day_date, time_slot)
                )
            `);

            // Assignments table
            testDb.run(`
                CREATE TABLE IF NOT EXISTS assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    day_date DATE NOT NULL,
                    time_slot TEXT NOT NULL,
                    assigned_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (assigned_by) REFERENCES users(id),
                    UNIQUE(day_date, time_slot)
                )
            `);

            // User preferences table
            testDb.run(`
                CREATE TABLE IF NOT EXISTS user_preferences (
                    user_id INTEGER PRIMARY KEY,
                    preferences TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `, [], (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    });
}

module.exports = {
    testDb,
    initializeTestDb
}; 