const DatabaseHelper = require('./dbHelper');

/**
 * TimeslotManager - Handles all timeslot configuration operations
 * Manages dynamic timeslots for weeks, templates, and data migration
 */
class TimeslotManager {
    constructor(db) {
        this.db = db;
        this.dbHelper = new DatabaseHelper(db);
    }

    /**
     * Get the start of the week (Monday) for a given date
     * @param {Date} date - The date to get the week start for
     * @returns {Date} - The Monday of that week
     */
    getWeekStart(date) {
        const weekStart = new Date(date);
        const currentDay = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        // For Sunday (day 0), go back 6 days to previous Monday
        // For Monday through Saturday (days 1-6), go back (day-1) days
        weekStart.setDate(date.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
        weekStart.setHours(0, 0, 0, 0);
        return weekStart;
    }

    /**
     * Check if a week can be modified (current week or future only)
     * @param {Date} weekStart - The start date of the week
     * @returns {boolean} - True if the week can be modified
     */
    canModifyWeek(weekStart) {
        const currentWeekStart = this.getWeekStart(new Date());
        
        // Compare date strings to avoid timezone/time precision issues
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
        
        
        return weekStartStr >= currentWeekStartStr;
    }

    /**
     * Get timeslots for a specific week
     * @param {Date} weekStart - The start date of the week (Monday)
     * @returns {Promise<Object>} - Configuration and timeslots data
     */
    async getTimeslotsForWeek(weekStart) {
        const weekStartStr = weekStart.toISOString().split('T')[0];
        
        // First, try to get existing configuration
        const config = await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_configurations 
            WHERE week_start = ?
        `, [weekStartStr]);
        
        if (config) {
            // Get timeslots for this configuration
            const timeslots = await this.dbHelper.allWithRetry(`
                SELECT * FROM timeslots 
                WHERE config_id = ? 
                ORDER BY day_of_week, slot_order
            `, [config.id]);
            
            return {
                config,
                timeslots: this.groupTimeslotsByDay(timeslots)
            };
        }
        
        // No configuration exists, check if this is a future week and auto-create from default template
        if (this.canModifyWeek(weekStart)) {
            const defaultTemplate = await this.getDefaultTemplate();
            if (defaultTemplate) {
                return await this.applyTemplate(weekStart, defaultTemplate.id, 1); // 1 = system user
            }
        }
        
        // Return fallback with fixed timeslots for past weeks or if no default template
        return {
            config: null,
            timeslots: this.getFallbackTimeslots()
        };
    }

    /**
     * Group timeslots by day of week for easier frontend consumption
     * @param {Array} timeslots - Array of timeslot records
     * @returns {Object} - Timeslots grouped by day (0-6)
     */
    groupTimeslotsByDay(timeslots) {
        const grouped = {};
        for (let day = 0; day < 7; day++) {
            grouped[day] = timeslots
                .filter(slot => slot.day_of_week === day)
                .sort((a, b) => a.slot_order - b.slot_order);
        }
        return grouped;
    }

    /**
     * Get fallback timeslots (the original fixed 4 slots)
     * @returns {Object} - Fallback timeslots for all days
     */
    getFallbackTimeslots() {
        const fallbackSlots = [
            { time: '8:00am', label: 'Morning', slot_order: 0 },
            { time: '12:30pm', label: 'Afternoon', slot_order: 1 },
            { time: '5:00pm', label: 'Evening', slot_order: 2 },
            { time: '9:30pm', label: 'Night', slot_order: 3 }
        ];
        
        const grouped = {};
        for (let day = 0; day < 7; day++) {
            grouped[day] = fallbackSlots.map(slot => ({
                ...slot,
                day_of_week: day,
                id: null, // No ID for fallback slots
                config_id: null
            }));
        }
        return grouped;
    }

    /**
     * Create a new timeslot configuration for a week
     * @param {Date} weekStart - The start date of the week (Monday)
     * @param {Array} slots - Array of timeslot definitions
     * @param {number} createdBy - User ID who created the configuration
     * @returns {Promise<Object>} - The created configuration and timeslots
     */
    async createTimeslotConfiguration(weekStart, slots, createdBy) {
        if (!this.canModifyWeek(weekStart)) {
            throw new Error('Cannot modify past weeks');
        }

        const weekStartStr = weekStart.toISOString().split('T')[0];
        
        return await this.dbHelper.withTransaction(async () => {
            // Create configuration
            const configResult = await this.dbHelper.runWithRetry(`
                INSERT INTO timeslot_configurations (week_start, created_by, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `, [weekStartStr, createdBy]);
            
            const configId = configResult.lastID;
            
            // Create timeslots
            const timeslots = [];
            for (const slot of slots) {
                const slotResult = await this.dbHelper.runWithRetry(`
                    INSERT INTO timeslots (config_id, day_of_week, time, label, slot_order)
                    VALUES (?, ?, ?, ?, ?)
                `, [configId, slot.day_of_week, slot.time, slot.label, slot.slot_order]);
                
                timeslots.push({
                    id: slotResult.lastID,
                    config_id: configId,
                    ...slot
                });
            }
            
            return {
                config: {
                    id: configId,
                    week_start: weekStartStr,
                    created_by: createdBy,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                timeslots: this.groupTimeslotsByDay(timeslots)
            };
        });
    }

    /**
     * Update an existing timeslot configuration
     * @param {number} configId - The configuration ID to update
     * @param {Array} slots - Array of new timeslot definitions
     * @returns {Promise<Object>} - The updated configuration and timeslots
     */
    async updateTimeslotConfiguration(configId, slots) {
        // Check if week can be modified
        const config = await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_configurations WHERE id = ?
        `, [configId]);
        
        if (!config) {
            throw new Error('Configuration not found');
        }
        
        const weekStart = new Date(config.week_start);
        if (!this.canModifyWeek(weekStart)) {
            throw new Error('Cannot modify past weeks');
        }

        return await this.dbHelper.withTransaction(async () => {
            // Delete existing timeslots
            await this.dbHelper.runWithRetry(`
                DELETE FROM timeslots WHERE config_id = ?
            `, [configId]);
            
            // Update configuration timestamp
            await this.dbHelper.runWithRetry(`
                UPDATE timeslot_configurations 
                SET updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [configId]);
            
            // Create new timeslots
            const timeslots = [];
            for (const slot of slots) {
                const slotResult = await this.dbHelper.runWithRetry(`
                    INSERT INTO timeslots (config_id, day_of_week, time, label, slot_order)
                    VALUES (?, ?, ?, ?, ?)
                `, [configId, slot.day_of_week, slot.time, slot.label, slot.slot_order]);
                
                timeslots.push({
                    id: slotResult.lastID,
                    config_id: configId,
                    ...slot
                });
            }
            
            return {
                config: {
                    ...config,
                    updated_at: new Date().toISOString()
                },
                timeslots: this.groupTimeslotsByDay(timeslots)
            };
        });
    }

    /**
     * Copy timeslots from another week
     * @param {Date} targetWeekStart - The week to create configuration for
     * @param {Date} sourceWeekStart - The week to copy from
     * @param {number} createdBy - User ID who created the configuration
     * @returns {Promise<Object>} - The created configuration and timeslots
     */
    async copyFromPreviousWeek(targetWeekStart, sourceWeekStart, createdBy) {
        if (!this.canModifyWeek(targetWeekStart)) {
            throw new Error('Cannot modify past weeks');
        }

        const sourceData = await this.getTimeslotsForWeek(sourceWeekStart);
        if (!sourceData.config) {
            throw new Error('Source week has no configuration to copy');
        }
        
        // Convert grouped timeslots back to array format
        const slots = [];
        for (let day = 0; day < 7; day++) {
            const daySlots = sourceData.timeslots[day] || [];
            for (const slot of daySlots) {
                slots.push({
                    day_of_week: day,
                    time: slot.time,
                    label: slot.label,
                    slot_order: slot.slot_order
                });
            }
        }
        
        // Check if configuration already exists
        const weekStartStr = targetWeekStart.toISOString().split('T')[0];
        const existingConfig = await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_configurations 
            WHERE week_start = ?
        `, [weekStartStr]);
        
        if (existingConfig) {
            // Update existing configuration
            return await this.updateTimeslotConfiguration(existingConfig.id, slots);
        } else {
            // Create new configuration
            return await this.createTimeslotConfiguration(targetWeekStart, slots, createdBy);
        }
    }

    /**
     * Apply a template to a week
     * @param {Date} weekStart - The week to apply template to
     * @param {number} templateId - The template ID to apply
     * @param {number} createdBy - User ID who created the configuration
     * @returns {Promise<Object>} - The created configuration and timeslots
     */
    async applyTemplate(weekStart, templateId, createdBy) {
        if (!this.canModifyWeek(weekStart)) {
            throw new Error('Cannot modify past weeks');
        }

        const templateSlots = await this.dbHelper.allWithRetry(`
            SELECT * FROM template_slots 
            WHERE template_id = ? 
            ORDER BY day_of_week, slot_order
        `, [templateId]);
        
        if (templateSlots.length === 0) {
            throw new Error('Template has no slots defined');
        }
        
        const slots = templateSlots.map(slot => ({
            day_of_week: slot.day_of_week,
            time: slot.time,
            label: slot.label,
            slot_order: slot.slot_order
        }));
        
        // Check if configuration already exists
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const existingConfig = await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_configurations 
            WHERE week_start = ?
        `, [weekStartStr]);
        
        if (existingConfig) {
            // Update existing configuration
            return await this.updateTimeslotConfiguration(existingConfig.id, slots);
        } else {
            // Create new configuration
            return await this.createTimeslotConfiguration(weekStart, slots, createdBy);
        }
    }

    /**
     * Check for conflicts when changing timeslots
     * @param {Date} weekStart - The week to check conflicts for
     * @returns {Promise<Object>} - Conflict information
     */
    async checkForConflicts(weekStart) {
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEndStr = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        // Check for existing availability
        const availabilityConflicts = await this.dbHelper.allWithRetry(`
            SELECT a.*, u.first_name, u.last_name, u.email
            FROM availability a
            JOIN users u ON a.user_id = u.id
            WHERE a.day_date BETWEEN ? AND ?
            AND a.is_available = 1
        `, [weekStartStr, weekEndStr]);
        
        // Check for existing assignments
        const assignmentConflicts = await this.dbHelper.allWithRetry(`
            SELECT a.*, u.first_name, u.last_name, u.email
            FROM assignments a
            JOIN users u ON a.user_id = u.id
            WHERE a.day_date BETWEEN ? AND ?
        `, [weekStartStr, weekEndStr]);
        
        return {
            hasConflicts: availabilityConflicts.length > 0 || assignmentConflicts.length > 0,
            availability: availabilityConflicts,
            assignments: assignmentConflicts
        };
    }

    /**
     * Get the default template
     * @returns {Promise<Object|null>} - The default template or null
     */
    async getDefaultTemplate() {
        return await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_templates 
            WHERE is_default = 1 
            LIMIT 1
        `);
    }

    /**
     * Set a template as the default
     * @param {number} templateId - The template ID to set as default
     * @returns {Promise<void>}
     */
    async setDefaultTemplate(templateId) {
        return await this.dbHelper.withTransaction(async () => {
            // Remove default flag from all templates
            await this.dbHelper.runWithRetry(`
                UPDATE timeslot_templates SET is_default = 0
            `);
            
            // Set the new default
            await this.dbHelper.runWithRetry(`
                UPDATE timeslot_templates SET is_default = 1 WHERE id = ?
            `, [templateId]);
        });
    }

    /**
     * Create a new template
     * @param {string} name - Template name
     * @param {string} description - Template description
     * @param {Array} slots - Array of template slot definitions
     * @param {number} createdBy - User ID who created the template
     * @param {boolean} isDefault - Whether to set as default
     * @returns {Promise<Object>} - The created template
     */
    async createTemplate(name, description, slots, createdBy, isDefault = false) {
        return await this.dbHelper.withTransaction(async () => {
            // If setting as default, clear existing defaults first
            if (isDefault) {
                await this.dbHelper.runWithRetry(`
                    UPDATE timeslot_templates SET is_default = 0
                `);
            }
            
            // Create template
            const templateResult = await this.dbHelper.runWithRetry(`
                INSERT INTO timeslot_templates (name, description, created_by, is_default)
                VALUES (?, ?, ?, ?)
            `, [name, description, createdBy, isDefault ? 1 : 0]);
            
            const templateId = templateResult.lastID;
            
            // Create template slots
            for (const slot of slots) {
                await this.dbHelper.runWithRetry(`
                    INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order)
                    VALUES (?, ?, ?, ?, ?)
                `, [templateId, slot.day_of_week, slot.time, slot.label, slot.slot_order]);
            }
            
            return {
                id: templateId,
                name,
                description,
                created_by: createdBy,
                is_default: isDefault,
                created_at: new Date().toISOString()
            };
        });
    }

    /**
     * Get all templates
     * @returns {Promise<Array>} - Array of all templates
     */
    async getAllTemplates() {
        return await this.dbHelper.allWithRetry(`
            SELECT t.*, u.first_name, u.last_name
            FROM timeslot_templates t
            LEFT JOIN users u ON t.created_by = u.id
            ORDER BY t.is_default DESC, t.name ASC
        `);
    }

    /**
     * Get template with slots
     * @param {number} templateId - The template ID
     * @returns {Promise<Object>} - Template with slots
     */
    async getTemplateWithSlots(templateId) {
        const template = await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_templates WHERE id = ?
        `, [templateId]);
        
        if (!template) {
            throw new Error('Template not found');
        }
        
        const slots = await this.dbHelper.allWithRetry(`
            SELECT * FROM template_slots 
            WHERE template_id = ? 
            ORDER BY day_of_week, slot_order
        `, [templateId]);
        
        return {
            template,
            slots: this.groupTimeslotsByDay(slots)
        };
    }

    /**
     * Delete a template
     * @param {number} templateId - The template ID to delete
     * @returns {Promise<void>}
     */
    async deleteTemplate(templateId) {
        const template = await this.dbHelper.getWithRetry(`
            SELECT * FROM timeslot_templates WHERE id = ?
        `, [templateId]);
        
        if (!template) {
            throw new Error('Template not found');
        }
        
        if (template.is_default) {
            throw new Error('Cannot delete the default template');
        }
        
        // Template slots will be deleted automatically due to CASCADE
        await this.dbHelper.runWithRetry(`
            DELETE FROM timeslot_templates WHERE id = ?
        `, [templateId]);
    }
}

module.exports = TimeslotManager;