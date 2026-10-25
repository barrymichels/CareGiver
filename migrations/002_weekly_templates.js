const DatabaseHelper = require('../utils/dbHelper');

// Add provenance without changing any existing week's saved times.
async function migrate(db) {
    const helper = new DatabaseHelper(db);
    await helper.withTransaction(async () => {
        const columns = await helper.allWithRetry('PRAGMA table_info(timeslot_configurations)');
        const additions = {
            template_id: 'INTEGER REFERENCES timeslot_templates(id) ON DELETE SET NULL',
            template_name: 'TEXT',
            uses_default: 'INTEGER NOT NULL DEFAULT 0'
        };
        for (const [name, definition] of Object.entries(additions)) {
            if (!columns.some(column => column.name === name)) {
                await helper.runWithRetry(`ALTER TABLE timeslot_configurations ADD COLUMN ${name} ${definition}`);
            }
        }
    });
}

module.exports = { migrate };
