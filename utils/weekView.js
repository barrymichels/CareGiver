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

/**
 * Format a date as the `YYYY-MM-DD` text stored in `day_date`, using the
 * machine's local calendar day.
 *
 * `toISOString().split('T')[0]` looks like the equivalent one-liner and is not:
 * it converts to UTC first. A bound held at local 23:59 therefore formats as the
 * *next* day west of UTC, and a bound held at local midnight formats as the
 * *previous* day east of UTC. Both shapes were live (finding 6).
 *
 * CAUTION: this assumes the Date is anchored to the *local* calendar, which is what
 * `weekWindowFor` and `TimeslotManager.getWeekStart` produce. It is the wrong tool
 * for the other convention in this repo - `TimeslotManager.parseWeekStart` builds
 * UTC-midnight Dates from `YYYY-MM-DD` request params and keys them with
 * `toISOString()`. Mixing the two shifts a week by a day. Unifying the conventions
 * is finding 26, deliberately out of scope here.
 *
 * @param {Date} date
 * @returns {string} Local calendar date as YYYY-MM-DD
 */
function formatLocalDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The Monday..Sunday window containing `from`, shifted by `weekOffset` weeks.
 *
 * Every week view queries `day_date BETWEEN ? AND ?`, and each one re-derived the
 * window by hand, which is how the bounds drifted apart. `start`/`end` remain
 * Dates for the templates and TimeslotManager; `sqlStart`/`sqlEnd` are the strings
 * for SQLite, formatted from local components so the window is seven days in every
 * timezone and across daylight-saving transitions.
 *
 * @param {number} weekOffset - Weeks from the current week (clamping stays with the caller)
 * @param {Date} [from=new Date()] - Moment whose local week anchors the window
 * @returns {{start: Date, end: Date, sqlStart: string, sqlEnd: string}}
 */
function weekWindowFor(weekOffset = 0, from = new Date()) {
    const start = new Date(from);
    const dayOfWeek = start.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    start.setHours(0, 0, 0, 0);
    // Sunday belongs to the week that began six days earlier.
    start.setDate(start.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end, sqlStart: formatLocalDate(start), sqlEnd: formatLocalDate(end) };
}

module.exports = { WEEK_DAYS, weekTitleFor, formatLocalDate, weekWindowFor };
