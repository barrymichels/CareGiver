/**
 * Shared validation for a submitted week of timeslots.
 *
 * Both /admin/timeslots (a week's own configuration) and /admin/timeslot-templates
 * (a reusable template) accept the same slot shape, so the rules live here rather
 * than in a copy of themselves in each route file.
 *
 * @param {Array} slots - Array of slot objects
 * @returns {string|null} - Error message or null if valid
 */
function validateSlots(slots) {
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

module.exports = { validateSlots };
