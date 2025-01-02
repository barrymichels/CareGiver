const sqlite3 = require('sqlite3');

function configureDatabase(dbPath) {
    // Create database with robust settings
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('Error opening database:', err);
            process.exit(1);
        }
    });

    // Configure database settings
    db.configure('busyTimeout', 5000); // Increased from 3000 to 5000ms
    
    // Run PRAGMA statements to optimize SQLite
    db.serialize(() => {
        // Enable WAL mode for better concurrency
        db.run('PRAGMA journal_mode = WAL');
        
        // Use NORMAL synchronous setting for better performance while maintaining safety
        db.run('PRAGMA synchronous = NORMAL');
        
        // Enable foreign key constraints
        db.run('PRAGMA foreign_keys = ON');
        
        // Set busy timeout
        db.run('PRAGMA busy_timeout = 5000');
        
        // Optimize for better concurrency
        db.run('PRAGMA locking_mode = NORMAL');
        
        // Increase cache size for better performance
        db.run('PRAGMA cache_size = -4000'); // Use about 16MB of cache
        
        // Set temp store to memory for better performance
        db.run('PRAGMA temp_store = MEMORY');
        
        // Set page size
        db.run('PRAGMA page_size = 4096');
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