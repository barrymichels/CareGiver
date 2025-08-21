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
const { getPageTitle } = require('./utils/title');
const NotificationService = require('./services/notificationService');

const app = express();
let notificationService = null;

// Database connection and initialization first
const db = configureDatabase(process.env.DB_PATH);

// Now we can configure OAuth2 after db is initialized
require('./config/oauth2')(passport, db);

// Make getPageTitle available to all views
app.locals.getPageTitle = getPageTitle;

// Initialize database tables and notification service
(async () => {
  try {
    await initializeDatabase(db);
    console.log('✅ Database initialized successfully');
    
    // Initialize notification service after database is ready
    notificationService = new NotificationService(db);
    console.log('✅ Notification service initialized');
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
    db: 'sessions.sqlite',  // Separate sessions database
    dir: './data',         // Store in data directory
    // Time to live in milliseconds (14 days)
    ttl: 14 * 24 * 60 * 60 * 1000,
    // Cleanup expired sessions
    cleanupInterval: 24 * 60 * 60 * 1000 // 1 day
  }),
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Only require HTTPS in production
    sameSite: 'lax',  // Keep lax for OAuth
    path: '/',
    proxy: true  // Trust the reverse proxy
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// Add trust proxy setting for Express
app.set('trust proxy', 1);  // Trust first proxy

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

// Profile routes with notification service
app.use('/profile', (req, res, next) => {
  const profileRoutes = require('./routes/profile')(db, notificationService);
  profileRoutes(req, res, next);
});

// Notification API routes
app.use('/api/notifications', (req, res, next) => {
  if (!notificationService) {
    return res.status(503).json({ error: 'Notification service not ready' });
  }
  const notificationRoutes = require('./routes/notifications')(db, notificationService);
  notificationRoutes(req, res, next);
});

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

// Add test route for rendering error view
app.get('/test-error', (req, res) => {
  res.render('error', { message: 'Test error' });
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

// Graceful shutdown handling
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  if (notificationService) {
    try {
      notificationService.stop();
      console.log('✅ Notification service stopped');
    } catch (error) {
      console.error('❌ Error stopping notification service:', error);
    }
  }
  
  if (db) {
    try {
      db.close((err) => {
        if (err) {
          console.error('❌ Error closing database:', err);
        } else {
          console.log('✅ Database connection closed');
        }
        process.exit(0);
      });
    } catch (error) {
      console.error('❌ Error during database shutdown:', error);
      process.exit(1);
    }
  } else {
    process.exit(0);
  }
}

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
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