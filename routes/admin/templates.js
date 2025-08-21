const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../../middleware/auth');
const TimeslotManager = require('../../utils/timeslotManager');

module.exports = function (db) {
    const timeslotManager = new TimeslotManager(db);

    /**
     * GET /admin/timeslot-templates - List all templates
     */
    router.get('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const templates = await timeslotManager.getAllTemplates();
            res.json(templates);
        } catch (error) {
            console.error('Error getting templates:', error);
            res.status(500).json({ error: 'Failed to get templates' });
        }
    });

    /**
     * GET /admin/timeslot-templates/:id - Get specific template with slots
     */
    router.get('/:id', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const templateId = parseInt(req.params.id);
            const templateData = await timeslotManager.getTemplateWithSlots(templateId);
            res.json(templateData);
        } catch (error) {
            console.error('Error getting template:', error);
            if (error.message === 'Template not found') {
                res.status(404).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Failed to get template' });
            }
        }
    });

    /**
     * POST /admin/timeslot-templates - Create new template
     */
    router.post('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const { name, description, slots, isDefault } = req.body;
            
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Template name is required' });
            }

            if (!slots || !Array.isArray(slots) || slots.length === 0) {
                return res.status(400).json({ error: 'Template slots are required' });
            }

            // Validate slots
            const validationError = validateTemplateSlots(slots);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            const template = await timeslotManager.createTemplate(
                name.trim(),
                description ? description.trim() : '',
                slots,
                req.user.id,
                Boolean(isDefault)
            );

            res.json({
                message: 'Template created successfully',
                data: template
            });
        } catch (error) {
            console.error('Error creating template:', error);
            res.status(500).json({ error: 'Failed to create template' });
        }
    });

    /**
     * PUT /admin/timeslot-templates/:id - Update template
     */
    router.put('/:id', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const templateId = parseInt(req.params.id);
            const { name, description, slots } = req.body;
            
            // Check if template exists FIRST
            const existingTemplate = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM timeslot_templates WHERE id = ?', 
                    [templateId],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });
            
            if (!existingTemplate) {
                return res.status(404).json({ error: 'Template not found' });
            }
            
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Template name is required' });
            }

            if (!slots || !Array.isArray(slots) || slots.length === 0) {
                return res.status(400).json({ error: 'Template slots are required' });
            }

            // Validate slots
            const validationError = validateTemplateSlots(slots);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            // Update template
            await new Promise((resolve, reject) => {
                db.run(`
                    UPDATE timeslot_templates 
                    SET name = ?, description = ?
                    WHERE id = ?
                `, [name.trim(), description ? description.trim() : '', templateId], (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Delete existing slots
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM template_slots WHERE template_id = ?', [templateId], (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Insert new slots
            for (const slot of slots) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO template_slots (template_id, day_of_week, time, label, slot_order)
                        VALUES (?, ?, ?, ?, ?)
                    `, [templateId, slot.day_of_week, slot.time, slot.label, slot.slot_order], (err) => {
                        if (err) reject(err);
                        resolve();
                    });
                });
            }

            res.json({ message: 'Template updated successfully' });
        } catch (error) {
            console.error('Error updating template:', error);
            res.status(500).json({ error: 'Failed to update template' });
        }
    });

    /**
     * DELETE /admin/timeslot-templates/:id - Delete template
     */
    router.delete('/:id', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const templateId = parseInt(req.params.id);
            await timeslotManager.deleteTemplate(templateId);
            res.json({ message: 'Template deleted successfully' });
        } catch (error) {
            console.error('Error deleting template:', error);
            if (error.message === 'Template not found') {
                res.status(404).json({ error: error.message });
            } else if (error.message.includes('Cannot delete')) {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Failed to delete template' });
            }
        }
    });

    /**
     * POST /admin/timeslot-templates/:id/set-default - Set template as default
     */
    router.post('/:id/set-default', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const templateId = parseInt(req.params.id);
            
            // Check if template exists
            const template = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM timeslot_templates WHERE id = ?', 
                    [templateId],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });
            
            if (!template) {
                return res.status(404).json({ error: 'Template not found' });
            }

            await timeslotManager.setDefaultTemplate(templateId);
            res.json({ message: 'Default template updated successfully' });
        } catch (error) {
            console.error('Error setting default template:', error);
            res.status(500).json({ error: 'Failed to set default template' });
        }
    });

    /**
     * POST /admin/timeslot-templates/:id/apply - Apply template to week
     */
    router.post('/:id/apply', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const templateId = parseInt(req.params.id);
            const { weekStart } = req.body;
            
            if (!weekStart) {
                return res.status(400).json({ error: 'Week start date is required' });
            }

            const weekStartDate = new Date(weekStart);
            if (isNaN(weekStartDate.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date' });
            }

            if (!timeslotManager.canModifyWeek(weekStartDate)) {
                return res.status(400).json({ error: 'Cannot modify past weeks' });
            }

            const result = await timeslotManager.applyTemplate(
                weekStartDate, 
                templateId, 
                req.user.id
            );

            res.json({
                message: 'Template applied successfully',
                data: result
            });
        } catch (error) {
            console.error('Error applying template:', error);
            if (error.message.includes('Cannot modify') || error.message.includes('Template')) {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Failed to apply template' });
            }
        }
    });

    /**
     * POST /admin/timeslot-templates/from-week - Create template from week configuration
     */
    router.post('/from-week', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const { name, description, weekStart, isDefault } = req.body;
            
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Template name is required' });
            }

            if (!weekStart) {
                return res.status(400).json({ error: 'Week start date is required' });
            }

            const weekStartDate = new Date(weekStart);
            if (isNaN(weekStartDate.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date' });
            }

            // Get week configuration
            const weekData = await timeslotManager.getTimeslotsForWeek(weekStartDate);
            if (!weekData.config) {
                return res.status(400).json({ error: 'No timeslot configuration found for the specified week' });
            }

            // Convert week timeslots to template format
            const slots = [];
            for (let day = 0; day < 7; day++) {
                const daySlots = weekData.timeslots[day] || [];
                for (const slot of daySlots) {
                    slots.push({
                        day_of_week: day,
                        time: slot.time,
                        label: slot.label,
                        slot_order: slot.slot_order
                    });
                }
            }

            if (slots.length === 0) {
                return res.status(400).json({ error: 'No timeslots found in the specified week' });
            }

            const template = await timeslotManager.createTemplate(
                name.trim(),
                description ? description.trim() : '',
                slots,
                req.user.id,
                Boolean(isDefault)
            );

            res.json({
                message: 'Template created from week successfully',
                data: template
            });
        } catch (error) {
            console.error('Error creating template from week:', error);
            res.status(500).json({ error: 'Failed to create template from week' });
        }
    });

    return router;
};

/**
 * Validate template slot data
 * @param {Array} slots - Array of slot objects
 * @returns {string|null} - Error message or null if valid
 */
function validateTemplateSlots(slots) {
    if (!Array.isArray(slots) || slots.length === 0) {
        return 'At least one timeslot is required';
    }

    const timeRegex = /^(1[0-2]|0?[1-9]):([0-5]\d)([ap]m)$/i;
    const seenSlots = new Set();

    for (const slot of slots) {
        if (typeof slot.day_of_week !== 'number' || slot.day_of_week < 0 || slot.day_of_week > 6) {
            return 'Invalid day of week';
        }

        if (typeof slot.time !== 'string' || !timeRegex.test(slot.time)) {
            return 'Invalid time format (use format like "8:00am" or "12:30pm")';
        }

        if (typeof slot.label !== 'string' || slot.label.trim().length === 0) {
            return 'Slot label is required';
        }

        if (typeof slot.slot_order !== 'number' || slot.slot_order < 0) {
            return 'Invalid slot order';
        }

        // Check for duplicate slots on same day
        const slotKey = `${slot.day_of_week}-${slot.time}`;
        if (seenSlots.has(slotKey)) {
            return `Duplicate time slot: ${slot.time} on day ${slot.day_of_week}`;
        }
        seenSlots.add(slotKey);
    }

    return null;
}