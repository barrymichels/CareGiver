const configureDatabase = require('./config/database');
const { migrate } = require('./migrations/001_flexible_timeslots');

async function runMigration() {
    console.log('Starting migration to flexible timeslots...');
    
    const db = configureDatabase(process.env.DB_PATH || './data/database.db');
    
    try {
        await migrate(db);
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    runMigration();
}

module.exports = { runMigration };