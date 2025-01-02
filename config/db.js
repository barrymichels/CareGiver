const configureDatabase = require('./database');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'scheduler.db');
const db = configureDatabase(dbPath);

module.exports = db; 