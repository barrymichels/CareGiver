const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();
const path = require('path');
const { isAuthenticated, isActive } = require('./middleware/auth');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: process.env.DB_PATH,
    // Time to live in milliseconds (14 days)
    ttl: 14 * 24 * 60 * 60 * 1000,
    // Cleanup expired sessions
    cleanupInterval: 24 * 60 * 60 * 1000 // 1 day
  }),
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const db = new sqlite3.Database(process.env.DB_PATH);

// Create users table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// After the users table creation
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
`);

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
`);

// Add after other table creations
db.run(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Add this function after database initialization
function checkSetupRequired() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, result) => {
      if (err) reject(err);
      resolve(result.count === 0);
    });
  });
}

// Passport configuration
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  (email, password, done) => {
    db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], (err, user) => {
      if (err) return done(err);
      if (!user) return done(null, false, { message: 'Invalid email or password' });
      
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) return done(err);
        if (!isMatch) return done(null, false, { message: 'Invalid email or password' });
        return done(null, user);
      });
    });
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
    done(err, user);
  });
});

// Add the auth routes
const authRoutes = require('./routes/auth')(db);
app.use('/', authRoutes);

// Add the availability routes
const availabilityRoutes = require('./routes/availability')(db);
app.use('/availability', availabilityRoutes);

// Add the admin routes
const adminRoutes = require('./routes/admin')(db);
app.use('/admin', adminRoutes);

// Add the profile routes
const profileRoutes = require('./routes/profile')(db);
app.use('/profile', profileRoutes);

// Add the users routes
const userRoutes = require('./routes/users')(db);
app.use('/users', userRoutes);

// Add inactive account route
app.get('/inactive', isAuthenticated, (req, res) => {
    if (req.user.is_active) {
        return res.redirect('/');
    }
    res.render('inactive');
});

// Keep only this route in app.js for the root path
app.get('/', isAuthenticated, isActive, async (req, res) => {
    try {
        const needsSetup = await checkSetupRequired();
        if (needsSetup) {
            return res.redirect('/setup');
        }
        
        if (req.isAuthenticated()) {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay() + 1); // Start from Monday
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);

            // Get assignments for the week
            const assignments = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT a.*, u.first_name || ' ' || u.last_name as user_name
                    FROM assignments a
                    JOIN users u ON a.user_id = u.id
                    WHERE a.day_date BETWEEN ? AND ?
                `, [
                    weekStart.toISOString().split('T')[0],
                    weekEnd.toISOString().split('T')[0]
                ], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                });
            });

            const userAvailability = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM availability WHERE user_id = ?',
                    [req.user.id],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows || []);
                    }
                );
            });

            res.render('dashboard', {
                user: req.user,
                weekStart,
                weekTitle: 'This Week',
                assignments,
                userAvailability
            });
        } else {
            res.redirect('/login');
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 