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
const configureDatabase = require('./config/database');
const initializeDatabase = require('./config/database.init');

const app = express();

// Database connection and initialization first
const db = configureDatabase(process.env.DB_PATH);

// Now we can configure OAuth2 after db is initialized
require('./config/oauth2')(passport, db);

// Initialize database tables
(async () => {
  try {
    await initializeDatabase(db);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
})();

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
    sameSite: 'lax' // Changed from strict to allow OAuth redirects
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

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
    if (err) return done(err);
    if (!user) return done(null, false);
    done(null, user);
  });
});

// Add the routes
const authRoutes = require('./routes/auth')(db);
app.use('/', authRoutes);

const availabilityRoutes = require('./routes/availability')(db);
app.use('/availability', availabilityRoutes);

const adminRoutes = require('./routes/admin')(db);
app.use('/admin', adminRoutes);

const profileRoutes = require('./routes/profile')(db);
app.use('/profile', profileRoutes);

const userRoutes = require('./routes/users')(db);
app.use('/users', userRoutes);

const indexRoutes = require('./routes/index')(db);
app.use('/', indexRoutes);

// Add inactive account route
app.get('/inactive', isAuthenticated, (req, res) => {
  if (req.user.is_active) {
    return res.redirect('/');
  }
  res.render('inactive');
});

// Test route that throws an error
app.get('/error', (req, res, next) => {
  const error = new Error('Test error');
  error.status = 500;
  next(error);
});

// Error handling middleware - MUST be after all routes
app.use((err, req, res, next) => {
  console.error('Unhandled error caught by middleware:', err);
  console.error('Error stack trace:', err.stack);

  // Set content type to application/json and other headers
  res.set({
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  });

  // Send JSON response for errors
  res.status(500).json({ error: 'Server error' });
});

// Move server creation to a separate function
function startServer() {
  const PORT = process.env.PORT || 3000;
  return app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Only start the server if this file is run directly (not imported as a module)
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };