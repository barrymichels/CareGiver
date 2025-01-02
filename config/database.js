const sqlite3 = require('sqlite3');

function configureDatabase(dbPath) {
    // Create database with robust settings
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error opening database:', err);
            process.exit(1);
        }
    });

    // Configure database settings
    db.configure('busyTimeout', 3000); // Wait up to 3 seconds when database is locked
    
    // Run PRAGMA statements to optimize SQLite
    db.serialize(() => {
        // Enable WAL mode for better concurrency
        db.run('PRAGMA journal_mode = WAL');
        
        // Ensure data is immediately written to disk
        db.run('PRAGMA synchronous = FULL');
        
        // Enable foreign key constraints
        db.run('PRAGMA foreign_keys = ON');
        
        // Set busy timeout
        db.run('PRAGMA busy_timeout = 3000');
        
        // Optimize for better concurrency
        db.run('PRAGMA locking_mode = NORMAL');
        
        // Set cache size (in pages, default page size is 4KB)
        db.run('PRAGMA cache_size = -2000'); // Use about 8MB of cache
    });

    // Add event handlers for better error tracking
    db.on('trace', (sql) => {
        if (process.env.NODE_ENV === 'development') {
            console.log('SQL:', sql);
        }
    });

    db.on('profile', (sql, time) => {
        if (process.env.NODE_ENV === 'development' && time > 100) {
            console.log(`Slow query (${time}ms):`, sql);
        }
    });

    return db;
}

module.exports = configureDatabase; 