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
        
        // A saved week is a snapshot, including weeks initialized from the default.
        if (this.canModifyWeek(weekStart)) {
            const defaultTemplate = await this.getDefaultTemplate();
            const creator = defaultTemplate || await this.dbHelper.getWithRetry('SELECT id AS created_by FROM users ORDER BY id LIMIT 1');
            if (creator) {
                return this.applyTemplate(weekStart, null, creator.created_by, { onlyIfMissing: true });
            }
        }

        return { config: null, timeslots: this.getFallbackTimeslots() };
    }

    // Date-only API values represent calendar days, not local instants.
    parseWeekStart(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw Object.assign(new Error('Invalid week start date'), { status: 400 });
        }
        const date = new Date(`${value}T00:00:00Z`);
        if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
            throw Object.assign(new Error('Invalid week start date'), { status: 400 });
        }
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        return date;
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
    async createTimeslotConfiguration(weekStart, slots, createdBy, options = {}) {
        return this.saveWeek(weekStart, slots, createdBy, options);
    }

    async updateTimeslotConfiguration(configId, slots, options = {}) {
        const config = await this.dbHelper.getWithRetry(
            'SELECT * FROM timeslot_configurations WHERE id = ?', [configId]
        );
        if (!config) throw new Error('Configuration not found');
        return this.saveWeek(new Date(config.week_start), slots, config.created_by, options);
    }

    async saveWeek(weekStart, slots, createdBy, options = {}) {
        if (!this.canModifyWeek(weekStart)) throw new Error('Cannot modify past weeks');
        const weekStartStr = weekStart.toISOString().slice(0, 10);
        const { templateId = null, templateName = null, usesDefault = false,
            ignoreConflicts = false, onlyIfMissing = false } = options;

        return this.dbHelper.withTransaction(async () => {
            let config = await this.dbHelper.getWithRetry(
                'SELECT * FROM timeslot_configurations WHERE week_start = ?', [weekStartStr]
            );
            if (config && onlyIfMissing) {
                const saved = await this.dbHelper.allWithRetry(
                    'SELECT * FROM timeslots WHERE config_id = ? ORDER BY day_of_week, slot_order', [config.id]
                );
                return { config, timeslots: this.groupTimeslotsByDay(saved) };
            }

            const conflicts = await this.checkForConflicts(weekStart, slots);
            if (conflicts.hasConflicts && ignoreConflicts !== true) {
                throw Object.assign(new Error('Changing these times affects saved availability or assignments'), {
                    status: 409, conflicts
                });
            }
            // Only remove entries whose date/time is absent from the replacement schedule.
            for (const table of ['availability', 'assignments']) {
                for (const entry of conflicts[table]) {
                    await this.dbHelper.runWithRetry(`DELETE FROM ${table} WHERE id = ?`, [entry.id]);
                }
            }

            if (!config) {
                const result = await this.dbHelper.runWithRetry(
                    'INSERT INTO timeslot_configurations (week_start, created_by) VALUES (?, ?)',
                    [weekStartStr, createdBy]
                );
                config = { id: result.lastID };
            }
            await this.dbHelper.runWithRetry(`
                UPDATE timeslot_configurations
                SET template_id = ?, template_name = ?, uses_default = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [templateId, templateName, usesDefault ? 1 : 0, config.id]);

            const existingSlots = await this.dbHelper.allWithRetry(
                'SELECT * FROM timeslots WHERE config_id = ?', [config.id]
            );
            // Free the ordering positions while retaining IDs referenced by assignments.
            await this.dbHelper.runWithRetry(
                'UPDATE timeslots SET slot_order = -id WHERE config_id = ?', [config.id]
            );
            for (const existing of existingSlots) {
                if (!slots.some(slot => slot.day_of_week === existing.day_of_week && slot.time === existing.time)) {
                    await this.dbHelper.runWithRetry('DELETE FROM timeslots WHERE id = ?', [existing.id]);
                }
            }
            for (const slot of slots) {
                const existing = existingSlots.find(old => old.day_of_week === slot.day_of_week && old.time === slot.time);
                if (existing) {
                    await this.dbHelper.runWithRetry(
                        'UPDATE timeslots SET label = ?, slot_order = ? WHERE id = ?',
                        [slot.label, slot.slot_order, existing.id]
                    );
                } else {
                    await this.dbHelper.runWithRetry(`
                        INSERT INTO timeslots (config_id, day_of_week, time, label, slot_order)
                        VALUES (?, ?, ?, ?, ?)
                    `, [config.id, slot.day_of_week, slot.time, slot.label, slot.slot_order]);
                }
            }
            config = await this.dbHelper.getWithRetry('SELECT * FROM timeslot_configurations WHERE id = ?', [config.id]);
            const saved = await this.dbHelper.allWithRetry(
                'SELECT * FROM timeslots WHERE config_id = ? ORDER BY day_of_week, slot_order', [config.id]
            );
            return { config, timeslots: this.groupTimeslotsByDay(saved) };
        });
    }

    /**
     * Copy timeslots from another week
     * @param {Date} targetWeekStart - The week to create configuration for
     * @param {Date} sourceWeekStart - The week to copy from
     * @param {number} createdBy - User ID who created the configuration
     * @returns {Promise<Object>} - The created configuration and timeslots
     */
    async copyFromPreviousWeek(targetWeekStart, sourceWeekStart, createdBy, options = {}) {
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
        
        return this.saveWeek(targetWeekStart, slots, createdBy, options);
    }

    /**
     * Apply a template to a week
     * @param {Date} weekStart - The week to apply template to
     * @param {number} templateId - The template ID to apply
     * @param {number} createdBy - User ID who created the configuration
     * @returns {Promise<Object>} - The created configuration and timeslots
     */
    async applyTemplate(weekStart, templateId, createdBy, options = {}) {
        const usesDefault = templateId === null;
        const template = usesDefault ? await this.getDefaultTemplate() :
            await this.dbHelper.getWithRetry('SELECT * FROM timeslot_templates WHERE id = ?', [templateId]);
        if (!usesDefault && !template) throw new Error('Template not found');
        const slots = template ? await this.dbHelper.allWithRetry(
            'SELECT * FROM template_slots WHERE template_id = ? ORDER BY day_of_week, slot_order', [template.id]
        ) : Object.values(this.getFallbackTimeslots()).flat();
        if (!slots.length) throw new Error('Template has no slots defined');
        return this.saveWeek(weekStart, slots, createdBy, {
            ...options, templateId: template?.id || null,
            templateName: template?.name || 'Default Schedule', usesDefault
        });
    }

    /**
     * Check for conflicts when changing timeslots
     * @param {Date} weekStart - The week to check conflicts for
     * @returns {Promise<Object>} - Conflict information
     */
    async checkForConflicts(weekStart, slots = null) {
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEndStr = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        // Check for existing availability
        let availabilityConflicts = await this.dbHelper.allWithRetry(`
            SELECT a.*, u.first_name, u.last_name, u.email
            FROM availability a
            JOIN users u ON a.user_id = u.id
            WHERE a.day_date BETWEEN ? AND ?
        `, [weekStartStr, weekEndStr]);
        
        // Check for existing assignments
        let assignmentConflicts = await this.dbHelper.allWithRetry(`
            SELECT a.*, u.first_name, u.last_name, u.email
            FROM assignments a
            JOIN users u ON a.user_id = u.id
            WHERE a.day_date BETWEEN ? AND ?
        `, [weekStartStr, weekEndStr]);
        
        if (slots) {
            const remaining = new Set(slots.map(slot => `${slot.day_of_week}/${slot.time}`));
            const removed = entry => {
                const day = (new Date(`${entry.day_date}T00:00:00Z`).getUTCDay() + 6) % 7;
                return !remaining.has(`${day}/${entry.time_slot}`);
            };
            availabilityConflicts = availabilityConflicts.filter(removed);
            assignmentConflicts = assignmentConflicts.filter(removed);
        }
        return {
            hasConflicts: availabilityConflicts.length > 0 || assignmentConflicts.length > 0,
            availability: availabilityConflicts,
            assignments: assignmentConflicts
        };
    }

    async validateScheduledSlots(entries) {
        const weeks = new Map();
        for (const entry of entries) {
            const week = this.parseWeekStart(entry.date);
            const key = week.toISOString().slice(0, 10);
            if (!weeks.has(key)) {
                const config = await this.dbHelper.getWithRetry(
                    'SELECT id FROM timeslot_configurations WHERE week_start = ?', [key]
                );
                if (config) {
                    weeks.set(key, this.groupTimeslotsByDay(await this.dbHelper.allWithRetry(
                        'SELECT * FROM timeslots WHERE config_id = ?', [config.id]
                    )));
                } else {
                    const template = await this.getDefaultTemplate();
                    weeks.set(key, template && this.canModifyWeek(week) ?
                        (await this.getTemplateWithSlots(template.id)).slots : this.getFallbackTimeslots());
                }
            }
            const day = (new Date(`${entry.date}T00:00:00Z`).getUTCDay() + 6) % 7;
            if (!weeks.get(key)[day].some(slot => slot.time === entry.time)) {
                throw Object.assign(new Error('The schedule has changed. Reload this week before saving.'), { status: 409 });
            }
        }
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

    /** Change the default and refresh empty current/future weeks atomically. */
    async setDefaultTemplate(templateId) {
        return this.dbHelper.withTransaction(() => this.setDefaultWithinTransaction(templateId));
    }

    // Call only within a transaction. Creation and deletion of a default share this policy.
    async setDefaultWithinTransaction(templateId) {
        const { template, slots: grouped } = await this.getTemplateWithSlots(templateId);
        const slots = Object.values(grouped).flat();
        if (!slots.length) throw new Error('Template has no slots defined');
        const currentWeek = this.getWeekStart(new Date()).toISOString().slice(0, 10);
        const weeks = await this.dbHelper.allWithRetry(`
            SELECT c.id, c.week_start,
                (EXISTS (SELECT 1 FROM availability a
                    WHERE a.day_date BETWEEN c.week_start AND date(c.week_start, '+6 days'))
                 OR EXISTS (SELECT 1 FROM assignments a
                    WHERE a.day_date BETWEEN c.week_start AND date(c.week_start, '+6 days'))) AS has_entries
            FROM timeslot_configurations c WHERE c.week_start >= ? ORDER BY c.week_start
        `, [currentWeek]);
        await this.dbHelper.runWithRetry('UPDATE timeslot_templates SET is_default = 0');
        await this.dbHelper.runWithRetry('UPDATE timeslot_templates SET is_default = 1 WHERE id = ?', [templateId]);
        const refreshedWeeks = [], protectedWeeks = [];
        for (const week of weeks) {
            if (week.has_entries) {
                protectedWeeks.push(week.week_start);
                continue;
            }
            // These weeks have no availability (including unavailable responses) or assignments.
            // Replacing their slots cannot discard anyone's saved input.
            await this.dbHelper.runWithRetry('DELETE FROM timeslots WHERE config_id = ?', [week.id]);
            for (const slot of slots) {
                await this.dbHelper.runWithRetry(`
                    INSERT INTO timeslots (config_id, day_of_week, time, label, slot_order)
                    VALUES (?, ?, ?, ?, ?)
                `, [week.id, slot.day_of_week, slot.time, slot.label, slot.slot_order]);
            }
            await this.dbHelper.runWithRetry(`
                UPDATE timeslot_configurations SET template_id = ?, template_name = ?,
                    uses_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `, [template.id, template.name, week.id]);
            refreshedWeeks.push(week.week_start);
        }
        return { refreshedWeeks, protectedWeeks };
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
            // Create template
            const templateResult = await this.dbHelper.runWithRetry(`
                INSERT INTO timeslot_templates (name, description, created_by, is_default)
                VALUES (?, ?, ?, ?)
            `, [name, description, createdBy, 0]);
            
            const templateId = templateResult.lastID;
            
            // Create template slots
            for (const slot of slots) {
                await this.dbHelper.runWithRetry(`
                    INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order)
                    VALUES (?, ?, ?, ?, ?)
                `, [templateId, slot.day_of_week, slot.time, slot.label, slot.slot_order]);
            }
            
            const impact = isDefault ? await this.setDefaultWithinTransaction(templateId) : {};
            return {
                ...impact,
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
    async deleteTemplate(templateId, replacementDefaultId = null) {
        return this.dbHelper.withTransaction(async () => {
            let impact;
            const template = await this.dbHelper.getWithRetry(
                'SELECT * FROM timeslot_templates WHERE id = ?', [templateId]);
            if (!template) throw new Error('Template not found');
            if (template.is_default) {
                if (!Number.isInteger(replacementDefaultId) || replacementDefaultId === templateId) {
                    throw new Error('Cannot delete the default template without a replacement');
                }
                const replacement = await this.dbHelper.getWithRetry(
                    'SELECT id FROM timeslot_templates WHERE id = ?', [replacementDefaultId]);
                if (!replacement) throw new Error('Cannot delete: replacement template not found');
                impact = await this.setDefaultWithinTransaction(replacementDefaultId);
            }
            // Foreign keys remove template slots and detach week metadata, preserving saved times.
            await this.dbHelper.runWithRetry('DELETE FROM timeslot_templates WHERE id = ?', [templateId]);
            return impact;
        });
    }
}

module.exports = TimeslotManager;
