// Schedule dates are YYYY-MM-DD calendar values, never instants. Only the clock
// enters as a Date; convert it to the family's calendar before doing arithmetic.
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const calendar = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
});
const dayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric'
});

function scheduleDate(instant = new Date()) {
    const parts = Object.fromEntries(calendar.formatToParts(instant).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

// UTC is used privately for Gregorian arithmetic, not as the schedule timezone.
function dateForArithmetic(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw Object.assign(new Error('Invalid week start date'), { status: 400 });
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw Object.assign(new Error('Invalid week start date'), { status: 400 });
    }
    return date;
}

function addDays(value, days) {
    const date = dateForArithmetic(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

// Monday = 0, Sunday = 6, matching schedule timeslots.
function weekday(value) {
    return (dateForArithmetic(value).getUTCDay() + 6) % 7;
}

function parseWeekStart(value) {
    return addDays(value, -weekday(value));
}

function weekStartFor(instant = new Date()) {
    return parseWeekStart(scheduleDate(instant));
}

function weekDatesFor(start) {
    return WEEK_DAYS.map((name, index) => {
        const date = addDays(start, index);
        return { name, date, formatted: dayLabel.format(dateForArithmetic(date)) };
    });
}

function weekWindowFor(weekOffset = 0, from = new Date()) {
    const start = addDays(weekStartFor(from), weekOffset * 7);
    const end = addDays(start, 6);
    return { start, end, sqlStart: start, sqlEnd: end };
}

function weekTitleFor(offset) {
    if (offset === 0) return 'This Week';
    if (offset === 1) return 'Next Week';
    if (offset === -1) return 'Last Week';
    return `${Math.abs(offset)} Weeks ${offset > 0 ? 'Ahead' : 'Ago'}`;
}

module.exports = { WEEK_DAYS, scheduleDate, addDays, weekday, parseWeekStart,
    weekStartFor, weekDatesFor, weekWindowFor, weekTitleFor };
