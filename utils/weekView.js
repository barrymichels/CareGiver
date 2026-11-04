/**
 * The single label mapping and day list used by every week view.
 *
 * Each screen clamps the requested offset to its own range (see the callers), but
 * the words shown for a given offset must not differ between screens, so they are
 * defined once here. Offsets outside -4..1 fall back to a computed label.
 */
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const RELATIVE_TITLES = {
    '-4': '4 Weeks Ago',
    '-3': '3 Weeks Ago',
    '-2': '2 Weeks Ago',
    '-1': 'Last Week',
    0: 'This Week',
    1: 'Next Week'
};

/**
 * @param {number} offset - Week offset from the current week
 * @returns {string} Heading label for that week
 */
function weekTitleFor(offset) {
    if (Object.prototype.hasOwnProperty.call(RELATIVE_TITLES, offset)) {
        return RELATIVE_TITLES[offset];
    }
    return `${Math.abs(offset)} Weeks ${offset > 0 ? 'Ahead' : 'Ago'}`;
}

module.exports = { WEEK_DAYS, weekTitleFor };
