const initializeDatabase = (db) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Create users table
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    email TEXT UNIQUE,
                    password TEXT,
                    is_admin BOOLEAN NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
            });

            // Create availability table
            db.run(`
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
            `, (err) => {
                if (err) reject(err);
            });

            // Create assignments table
            db.run(`
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
            `, (err) => {
                if (err) reject(err);
            });

            // Create user_preferences table
            db.run(`
                CREATE TABLE IF NOT EXISTS user_preferences (
                    user_id INTEGER PRIMARY KEY,
                    preferences TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `, (err) => {
                if (err) reject(err);
            });

            // Create notification_settings table
            db.run(`
                CREATE TABLE IF NOT EXISTS notification_settings (
                    user_id INTEGER PRIMARY KEY,
                    notification_advance_minutes INTEGER DEFAULT 15,
                    morning_summary_enabled BOOLEAN DEFAULT 1,
                    morning_summary_time TEXT DEFAULT '07:00',
                    push_subscription TEXT,
                    push_enabled BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `, (err) => {
                if (err) reject(err);
            });

            // Create morning_summary_log table to prevent duplicate notifications
            db.run(`
                CREATE TABLE IF NOT EXISTS morning_summary_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    date DATE NOT NULL,
                    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    UNIQUE(user_id, date)
                )
            `, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
};

module.exports = initializeDatabase; 