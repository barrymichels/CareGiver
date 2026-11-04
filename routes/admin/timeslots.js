const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../../middleware/auth');
const TimeslotManager = require('../../utils/timeslotManager');
const { escapeJsonForEmbed } = require('../../utils/safeJson');
const { validateSlots } = require('../../utils/slotValidation');
const { WEEK_DAYS, weekTitleFor } = require('../../utils/weekView');

module.exports = function (db) {
    const timeslotManager = new TimeslotManager(db);

    /**
     * GET /admin/timeslots - View timeslot configurations page
     */
    router.get('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const weekOffset = parseInt(req.query.weekOffset) || 0;
            // Limit week offset to reasonable range
            const limitedOffset = Math.max(-4, Math.min(8, weekOffset));

            // Calculate target week
            const today = new Date();
            const targetWeekStart = timeslotManager.getWeekStart(today);
            targetWeekStart.setDate(targetWeekStart.getDate() + (limitedOffset * 7));

            // Get timeslots for the week
            const weekData = await timeslotManager.getTimeslotsForWeek(targetWeekStart);
            
            // Get all templates for the dropdown
            const templates = await timeslotManager.getAllTemplates();

            // Generate week title
            const weekTitle = weekTitleFor(limitedOffset);

            res.render('admin/timeslots', {
                user: req.user,
                weekData,
                templates,
                weekOffset: limitedOffset,
                weekTitle,
                weekStart: targetWeekStart,
                canModify: timeslotManager.canModifyWeek(targetWeekStart),
                // Rendered into an inline <script> below; must not be plain JSON.stringify.
                escapeJsonForEmbed,
                days: WEEK_DAYS
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error loading timeslots page:', error);
            res.status(500).render('error', {
                message: 'Failed to load timeslots configuration',
                user: req.user
            });
        }
    });

    /**
     * GET /admin/timeslots/:weekStart - Get specific week's configuration (API)
     */
    router.get('/:weekStart', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const weekStart = timeslotManager.parseWeekStart(req.params.weekStart);
            if (isNaN(weekStart.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date' });
            }

            const weekData = await timeslotManager.getTimeslotsForWeek(weekStart);
            
            res.json({
                ...weekData,
                canModify: timeslotManager.canModifyWeek(weekStart)
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error getting week configuration:', error);
            res.status(500).json({ error: 'Failed to get week configuration' });
        }
    });

    /**
     * POST /admin/timeslots - Create new timeslot configuration
     */
    router.post('/', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const { weekStart, slots } = req.body;
            
            if (!weekStart || !slots || !Array.isArray(slots)) {
                return res.status(400).json({ error: 'Invalid request data' });
            }

            const weekStartDate = timeslotManager.parseWeekStart(weekStart);
            if (isNaN(weekStartDate.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date' });
            }

            if (!timeslotManager.canModifyWeek(weekStartDate)) {
                return res.status(400).json({ error: 'Cannot modify past weeks' });
            }

            // Validate slots
            const validationError = validateSlots(slots);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            const result = await timeslotManager.createTimeslotConfiguration(
                weekStartDate, 
                slots, 
                req.user.id,
                { ignoreConflicts: req.body.ignoreConflicts === true }
            );

            res.json({
                message: 'Timeslot configuration created successfully',
                data: result
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error creating timeslot configuration:', error);
            if (error.message === 'Cannot modify past weeks') {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Failed to create timeslot configuration' });
            }
        }
    });

    /**
     * PUT /admin/timeslots/:id - Update existing timeslot configuration
     */
    router.put('/:id', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const configId = parseInt(req.params.id);
            const { slots } = req.body;
            
            if (!slots || !Array.isArray(slots)) {
                return res.status(400).json({ error: 'Invalid slots data' });
            }

            // Validate slots
            const validationError = validateSlots(slots);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            const result = await timeslotManager.updateTimeslotConfiguration(configId, slots, { ignoreConflicts: req.body.ignoreConflicts === true });

            res.json({
                message: 'Timeslot configuration updated successfully',
                data: result
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error updating timeslot configuration:', error);
            if (error.message === 'Cannot modify past weeks' || error.message === 'Configuration not found') {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Failed to update timeslot configuration' });
            }
        }
    });

    /**
     * POST /admin/timeslots/copy - Copy timeslots from another week
     */
    router.post('/copy', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const { targetWeekStart, sourceWeekStart } = req.body;
            
            if (!targetWeekStart || !sourceWeekStart) {
                return res.status(400).json({ error: 'Target and source week dates are required' });
            }

            const targetDate = timeslotManager.parseWeekStart(targetWeekStart);
            const sourceDate = timeslotManager.parseWeekStart(sourceWeekStart);
            
            if (isNaN(targetDate.getTime()) || isNaN(sourceDate.getTime())) {
                return res.status(400).json({ error: 'Invalid date format' });
            }

            if (!timeslotManager.canModifyWeek(targetDate)) {
                return res.status(400).json({ error: 'Cannot modify past weeks' });
            }

            const result = await timeslotManager.copyFromPreviousWeek(
                targetDate, 
                sourceDate, 
                req.user.id,
                { ignoreConflicts: req.body.ignoreConflicts === true }
            );

            res.json({
                message: 'Timeslots copied successfully',
                data: result
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error copying timeslots:', error);
            if (error.message.includes('Cannot modify') || error.message.includes('no configuration')) {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Failed to copy timeslots' });
            }
        }
    });

    /**
     * GET /admin/timeslots/check-conflicts/:weekStart - Check for conflicts
     */
    router.get('/check-conflicts/:weekStart', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const weekStart = timeslotManager.parseWeekStart(req.params.weekStart);
            if (isNaN(weekStart.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date' });
            }

            const conflicts = await timeslotManager.checkForConflicts(weekStart);
            res.json(conflicts);
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error checking conflicts:', error);
            res.status(500).json({ error: 'Failed to check conflicts' });
        }
    });

    /**
     * POST /admin/timeslots/apply-template - Apply template to a week
     */
    router.post('/apply-template', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const { weekStart, templateId } = req.body;
            
            if (!weekStart || (templateId !== null && (!Number.isInteger(templateId) || templateId < 1))) {
                return res.status(400).json({ error: 'Week start and template ID are required' });
            }

            const weekStartDate = timeslotManager.parseWeekStart(weekStart);
            if (isNaN(weekStartDate.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date' });
            }

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
     * DELETE /admin/timeslots/:id - Delete timeslot configuration
     */
    router.delete('/:id', isAuthenticated, isAdmin, async (req, res) => {
        try {
            const configId = parseInt(req.params.id);
            
            // Get configuration to check if it can be deleted
            const config = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT * FROM timeslot_configurations WHERE id = ?
                `, [configId], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });
            
            if (!config) {
                return res.status(404).json({ error: 'Configuration not found' });
            }
            
            const weekStart = new Date(config.week_start);
            if (isNaN(weekStart.getTime())) {
                return res.status(400).json({ error: 'Invalid week start date in configuration' });
            }
            
            if (!timeslotManager.canModifyWeek(weekStart)) {
                return res.status(400).json({ error: 'Cannot delete past week configurations' });
            }

            const result = await timeslotManager.applyTemplate(weekStart, null, req.user.id, {
                ignoreConflicts: req.body.ignoreConflicts === true
            });
            res.json({ message: 'Timeslot configuration reset to default', data: result });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, conflicts: error.conflicts });
            console.error('Error deleting timeslot configuration:', error);
            res.status(500).json({ error: 'Failed to delete timeslot configuration' });
        }
    });

    return router;
};
