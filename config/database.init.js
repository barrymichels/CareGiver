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
                    reset_token TEXT,
                    reset_token_expires DATETIME,
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
                    timeslot_id INTEGER,
                    is_available BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (timeslot_id) REFERENCES timeslots(id),
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
                    timeslot_id INTEGER,
                    assigned_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (assigned_by) REFERENCES users(id),
                    FOREIGN KEY (timeslot_id) REFERENCES timeslots(id),
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

            // Create timeslot_configurations table
            db.run(`
                CREATE TABLE IF NOT EXISTS timeslot_configurations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start DATE NOT NULL,
                    created_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (created_by) REFERENCES users(id),
                    UNIQUE(week_start)
                )
            `, (err) => {
                if (err) reject(err);
            });

            // Create timeslots table
            db.run(`
                CREATE TABLE IF NOT EXISTS timeslots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    config_id INTEGER NOT NULL,
                    day_of_week INTEGER NOT NULL,
                    time TEXT NOT NULL,
                    label TEXT NOT NULL,
                    slot_order INTEGER NOT NULL,
                    FOREIGN KEY (config_id) REFERENCES timeslot_configurations(id) ON DELETE CASCADE,
                    UNIQUE(config_id, day_of_week, slot_order)
                )
            `, (err) => {
                if (err) reject(err);
            });

            // Create timeslot_templates table
            db.run(`
                CREATE TABLE IF NOT EXISTS timeslot_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_by INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_default BOOLEAN DEFAULT 0,
                    FOREIGN KEY (created_by) REFERENCES users(id)
                )
            `, (err) => {
                if (err) reject(err);
            });

            // Create template_slots table
            db.run(`
                CREATE TABLE IF NOT EXISTS template_slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_id INTEGER NOT NULL,
                    day_of_week INTEGER NOT NULL,
                    time TEXT NOT NULL,
                    label TEXT NOT NULL,
                    slot_order INTEGER NOT NULL,
                    FOREIGN KEY (template_id) REFERENCES timeslot_templates(id) ON DELETE CASCADE,
                    UNIQUE(template_id, day_of_week, slot_order)
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