const DatabaseHelper = require('../utils/dbHelper');

/**
 * Migration to add flexible timeslots functionality
 * This migration:
 * 1. Adds new columns to existing tables
 * 2. Creates a default template with the current 4 fixed timeslots
 * 3. Migrates existing data to use the new flexible system
 * 4. Maintains backward compatibility during transition
 */
async function migrate(db) {
    const dbHelper = new DatabaseHelper(db);
    
    console.log('Starting flexible timeslots migration...');
    
    try {
        await dbHelper.withTransaction(async () => {
            // Step 1: Add timeslot_id columns to existing tables (nullable initially)
            console.log('Adding timeslot_id columns...');
            
            await dbHelper.runWithRetry(`
                ALTER TABLE availability ADD COLUMN timeslot_id INTEGER
                REFERENCES timeslots(id)
            `);
            
            await dbHelper.runWithRetry(`
                ALTER TABLE assignments ADD COLUMN timeslot_id INTEGER
                REFERENCES timeslots(id)
            `);
            
            // Step 2: Create default template with current fixed timeslots
            console.log('Creating default template...');
            
            const defaultTemplate = await dbHelper.runWithRetry(`
                INSERT INTO timeslot_templates (name, description, created_by, is_default)
                VALUES (?, ?, ?, ?)
            `, ['Default Schedule', 'Standard 4-slot daily schedule', 1, 1]);
            
            const templateId = defaultTemplate.lastID;
            
            // Define the fixed timeslots that were previously hardcoded
            const fixedTimeslots = [
                { time: '8:00am', label: 'Morning' },
                { time: '12:30pm', label: 'Afternoon' },
                { time: '5:00pm', label: 'Evening' },
                { time: '9:30pm', label: 'Night' }
            ];
            
            // Insert template slots for all days of the week
            for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
                for (let slotIndex = 0; slotIndex < fixedTimeslots.length; slotIndex++) {
                    const slot = fixedTimeslots[slotIndex];
                    await dbHelper.runWithRetry(`
                        INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order)
                        VALUES (?, ?, ?, ?, ?)
                    `, [templateId, dayOfWeek, slot.time, slot.label, slotIndex]);
                }
            }
            
            // Step 3: Find all weeks that have existing availability or assignments
            console.log('Finding existing weeks with data...');
            
            const existingWeeks = await dbHelper.allWithRetry(`
                SELECT DISTINCT week_start FROM (
                    SELECT DATE(day_date, 'weekday 0', '-6 days') as week_start
                    FROM availability
                    UNION
                    SELECT DATE(day_date, 'weekday 0', '-6 days') as week_start
                    FROM assignments
                ) ORDER BY week_start
            `);
            
            console.log(`Found ${existingWeeks.length} weeks with existing data`);
            
            // Step 4: Create timeslot configurations for all existing weeks
            for (const week of existingWeeks) {
                console.log(`Creating configuration for week starting ${week.week_start}...`);
                
                const config = await dbHelper.runWithRetry(`
                    INSERT INTO timeslot_configurations (week_start, created_by)
                    VALUES (?, ?)
                `, [week.week_start, 1]);
                
                const configId = config.lastID;
                
                // Create timeslots for this week using the default template
                for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
                    for (let slotIndex = 0; slotIndex < fixedTimeslots.length; slotIndex++) {
                        const slot = fixedTimeslots[slotIndex];
                        await dbHelper.runWithRetry(`
                            INSERT INTO timeslots (config_id, day_of_week, time, label, slot_order)
                            VALUES (?, ?, ?, ?, ?)
                        `, [configId, dayOfWeek, slot.time, slot.label, slotIndex]);
                    }
                }
                
                // Step 5: Update availability records to reference the new timeslots
                console.log(`Updating availability records for week ${week.week_start}...`);
                
                for (const slot of fixedTimeslots) {
                    await dbHelper.runWithRetry(`
                        UPDATE availability
                        SET timeslot_id = (
                            SELECT t.id FROM timeslots t
                            JOIN timeslot_configurations tc ON t.config_id = tc.id
                            WHERE tc.week_start = ?
                            AND t.time = ?
                            AND t.day_of_week = (
                                CASE CAST(strftime('%w', availability.day_date) AS INTEGER)
                                    WHEN 0 THEN 6  -- Sunday -> 6
                                    ELSE CAST(strftime('%w', availability.day_date) AS INTEGER) - 1  -- Mon-Sat -> 0-5
                                END
                            )
                        )
                        WHERE time_slot = ?
                        AND DATE(day_date, 'weekday 0', '-6 days') = ?
                    `, [week.week_start, slot.time, slot.time, week.week_start]);
                }
                
                // Step 6: Update assignment records to reference the new timeslots
                console.log(`Updating assignment records for week ${week.week_start}...`);
                
                for (const slot of fixedTimeslots) {
                    await dbHelper.runWithRetry(`
                        UPDATE assignments
                        SET timeslot_id = (
                            SELECT t.id FROM timeslots t
                            JOIN timeslot_configurations tc ON t.config_id = tc.id
                            WHERE tc.week_start = ?
                            AND t.time = ?
                            AND t.day_of_week = (
                                CASE CAST(strftime('%w', assignments.day_date) AS INTEGER)
                                    WHEN 0 THEN 6  -- Sunday -> 6
                                    ELSE CAST(strftime('%w', assignments.day_date) AS INTEGER) - 1  -- Mon-Sat -> 0-5
                                END
                            )
                        )
                        WHERE time_slot = ?
                        AND DATE(day_date, 'weekday 0', '-6 days') = ?
                    `, [week.week_start, slot.time, slot.time, week.week_start]);
                }
            }
            
            console.log('Migration completed successfully!');
        });
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
}

/**
 * Rollback the migration (if needed for testing or emergency rollback)
 */
async function rollback(db) {
    const dbHelper = new DatabaseHelper(db);
    
    console.log('Rolling back flexible timeslots migration...');
    
    try {
        await dbHelper.withTransaction(async () => {
            // Remove added columns
            // Note: SQLite doesn't support DROP COLUMN, so we'd need to recreate tables
            // For now, we'll just clear the new data
            
            await dbHelper.runWithRetry('DELETE FROM template_slots');
            await dbHelper.runWithRetry('DELETE FROM timeslot_templates');
            await dbHelper.runWithRetry('DELETE FROM timeslots');
            await dbHelper.runWithRetry('DELETE FROM timeslot_configurations');
            
            // Reset timeslot_id columns to NULL
            await dbHelper.runWithRetry('UPDATE availability SET timeslot_id = NULL');
            await dbHelper.runWithRetry('UPDATE assignments SET timeslot_id = NULL');
            
            console.log('Rollback completed successfully!');
        });
    } catch (error) {
        console.error('Rollback failed:', error);
        throw error;
    }
}

module.exports = {
    migrate,
    rollback
};