const { parseWeekStart } = require('../../utils/weekView');
const express = require('express');
const { isAuthenticated, isAdmin } = require('../../middleware/auth');
const TimeslotManager = require('../../utils/timeslotManager');
const { validateSlots } = require('../../utils/slotValidation');

module.exports = function (db) {
    // Must stay inside the factory: a module-level router is shared by every require() call,
    // so a second caller would silently receive the first caller's routes and database.
    const router = express.Router();
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
            const validationError = validateSlots(slots);
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
            const impact = await timeslotManager.updateTemplate(templateId, req.body);

            res.json({ message: 'Template updated successfully', ...impact });
        } catch (error) {
            if (error.status === 400 || error.status === 404) {
                return res.status(error.status).json({ error: error.message });
            }
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
            const impact = await timeslotManager.deleteTemplate(templateId, req.body.replacementDefaultId);
            res.json({ message: 'Template deleted successfully', ...impact });
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

            const impact = await timeslotManager.setDefaultTemplate(templateId);
            res.json({ message: 'Default template updated successfully', ...impact });
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

            const weekStartDate = parseWeekStart(weekStart);

            if (!timeslotManager.canModifyWeek(weekStartDate)) {
                return res.status(400).json({ error: 'Cannot modify past weeks' });
            }

            const result = await timeslotManager.applyTemplate(
                weekStartDate, 
                templateId,
                req.user.id,
                { ignoreConflicts: req.body.ignoreConflicts === true }
            );

            res.json({
                message: 'Template applied successfully',
                data: result
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
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

            const weekStartDate = parseWeekStart(weekStart);

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
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error creating template from week:', error);
            res.status(500).json({ error: 'Failed to create template from week' });
        }
    });

    return router;
};
