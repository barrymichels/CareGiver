const express = require('express');
const session = require('express-session');
const passport = require('passport');
const helmet = require('helmet');
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

// Express adds `X-Powered-By: Express`, which tells anyone probing the container
// which stack and roughly which versions to attack for free.
app.disable('x-powered-by');

// Security headers, mounted before express.static and before every router so no
// response escapes without them - a static miss and an error page included.
//
// The frame guard is the load-bearing one here: public/js/admin.js sends
// PUT /admin/users/:id with nothing but the session cookie, so an iframe with an
// overlay on any page in the household could flip a user's active/admin flags
// with a borrowed click. frame-ancestors 'deny' is what modern browsers honour
// and X-Frame-Options: DENY is the same message to the older ones.
//
// CSP keeps 'unsafe-inline' for scripts and styles on purpose, because the views
// genuinely need it: dashboard.ejs, admin/timeslots.ejs and
// admin/manage-availability.ejs run inline <script> blocks (the service-worker
// registration among them), admin/timeslots.ejs and admin/users.ejs wire buttons
// through inline onclick= attributes (so script-src-attr needs it too), and
// inactive.ejs and admin/timeslots.ejs carry <style> blocks that timeslot-manager.js
// then extends at runtime. Tightening this to nonces requires moving that code out
// of the templates first, which is a separate change. What the policy does enforce
// today is the origin: an injected script still cannot fetch or connect anywhere
// but this app.
//
// upgrade-insecure-requests is deliberately absent. docker-compose.yml publishes
// plain HTTP on :3000 and LAN installs commonly have no TLS at all; upgrading
// same-origin asset requests to https would take those screens down.
app.use(helmet({
  // helmet 8 defaults this to SAMEORIGIN; 'deny' is the stronger guard and is
  // what matches the frame-ancestors directive below (SAMEORIGIN would still let
  // any page on this origin frame the admin screen).
  xFrameOptions: { action: 'deny' },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'deny'"],
      imgSrc: ["'self'", 'data:'], // admin/timeslots.ejs inlines an svg as a data uri
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));

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
    const notifications = await notificationService.init();
    if (notifications.ok) {
      console.log('✅ Notification service initialized');
    } else {
      // Degraded, not broken: login, dashboard and calendar export all work
      // without push. /health reports only "degraded" (no config detail in a
      // public payload), so the reason has to be spelled out here.
      console.error(`⚠️  Notifications DEGRADED - push reminders are OFF: ${notifications.reason}`);
      console.error('   Everything except browser push is working normally.');
    }
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
})();

// Week and day keys come from the *local* calendar (utils/weekView.js builds
// `day_date` strings from local date components), and that has only ever been run
// and reviewed west of UTC - docker-compose.yml sets TZ=America/New_York. East of
// UTC the local day and the UTC day disagree around midnight, which can put a
// shift on the neighbouring day. This is a guard, not a fix: the date arithmetic
// stays as it is, so the warning is what tells an operator to set TZ.
const localUtcOffsetMinutes = -new Date().getTimezoneOffset();
if (localUtcOffsetMinutes > 0) {
  console.error([
    '',
    '=============================================================================',
    '  UNSUPPORTED TIMEZONE - the schedule may be a day off',
    `  Resolved timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} ` +
      `(UTC+${String(Math.floor(localUtcOffsetMinutes / 60)).padStart(2, '0')}:${String(localUtcOffsetMinutes % 60).padStart(2, '0')})`,
    '  Week and day keys are derived from the local calendar and are only',
    '  validated for zones west of UTC. Users may see shifts on the wrong day.',
    '  Fix: set TZ to a zone west of UTC (e.g. TZ=America/New_York) and restart.',
    '=============================================================================',
    ''
  ].join('\n'));
}

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

// Passport configuration - the one local strategy, defined in config/passport.js.
require('./config/passport')(passport, db);

// Liveness probe. Answers 200 even when notifications are degraded on purpose:
// the household can still log in and read their schedule, and marking the whole
// container unhealthy over a missing VAPID key would be the worse failure.
// Deliberately before the routers, and deliberately free of config detail.
app.get('/health', (req, res) => {
  const notificationsEnabled = Boolean(notificationService && notificationService.initialized);
  res.json({
    status: notificationsEnabled ? 'ok' : 'degraded',
    notifications: { enabled: notificationsEnabled }
  });
});

// Add the routes
const authRoutes = require('./routes/auth')(db);
app.use('/', authRoutes);

const availabilityRoutes = require('./routes/availability')(db);
app.use('/availability', availabilityRoutes);

const adminRoutes = require('./routes/admin')(db);
app.use('/admin', adminRoutes);

// Admin timeslot management routes (from flexible-timeslots branch)
const adminTimeslotRoutes = require('./routes/admin/timeslots')(db);
app.use('/admin/timeslots', adminTimeslotRoutes);

const adminTemplateRoutes = require('./routes/admin/templates')(db);
app.use('/admin/timeslot-templates', adminTemplateRoutes);

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