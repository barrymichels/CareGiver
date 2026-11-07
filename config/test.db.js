const sqlite3 = require('sqlite3').verbose();
const initializeDatabase = require('./database.init');

const testDb = new sqlite3.Database(':memory:');

// Match production foreign-key enforcement. clearTestDb deletes child rows first.
testDb.run('PRAGMA foreign_keys = ON');

// Initialize test database using shared schema
function initializeTestDb() {
    return initializeDatabase(testDb);
}

module.exports = {
    testDb,
    initializeTestDb
}; 