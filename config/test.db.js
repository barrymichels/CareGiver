const sqlite3 = require('sqlite3').verbose();
const initializeDatabase = require('./database.init');

const testDb = new sqlite3.Database(':memory:');

// Initialize test database using shared schema
function initializeTestDb() {
    return initializeDatabase(testDb);
}

module.exports = {
    testDb,
    initializeTestDb
}; 