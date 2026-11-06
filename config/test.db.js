const sqlite3 = require('sqlite3').verbose();
const initializeDatabase = require('./database.init');

const testDb = new sqlite3.Database(':memory:');

// config/database.js runs this on every production connection and SQLite's
// default is OFF, so without it the test database accepts rows pointing at users
// who no longer exist and the suite grades a database nobody actually runs. The
// pragma is per-connection, and this module owns the one connection every test
// file shares.
//
// Note for whoever next opens tests/helpers/testHelpers.js: clearTestDb deletes
// `users` first and never touches notification_settings, morning_summary_log,
// timeslot_configurations or timeslot_templates, so under foreign keys its
// `DELETE FROM users` fails for every suite that seeds those tables. Clear the
// child tables, in that order, before `users` and the suite is green again.
testDb.run('PRAGMA foreign_keys = ON');

// Initialize test database using shared schema
function initializeTestDb() {
    return initializeDatabase(testDb);
}

module.exports = {
    testDb,
    initializeTestDb
}; 