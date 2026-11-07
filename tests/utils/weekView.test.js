const { execFileSync } = require('child_process');
const { weekWindowFor, parseWeekStart, weekDatesFor } = require('../../utils/weekView');

describe('Schedule week calendar', () => {
    // Fresh processes are intentional: changing TZ inside Jest does not reliably
    // change the runtime clock. All expectations below are independent fixtures.
    it.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('keeps Eastern calendar dates under server TZ=%s', tz => {
        const output = execFileSync(process.execPath, ['-e', `
            const { scheduleDate, weekWindowFor } = require('./utils/weekView');
            const instants = ${JSON.stringify([
                '2025-01-13T03:00:00Z', // Sunday 10pm EST
                '2025-01-13T04:59:59Z',
                '2025-01-13T05:00:00Z', // Monday midnight EST
                '2026-07-06T03:59:59Z', // Sunday EDT
                '2026-07-06T04:00:00Z',
                '2026-03-08T06:59:59Z', // spring transition
                '2026-03-08T07:00:00Z',
                '2026-11-01T05:59:59Z', // fall transition
                '2026-11-01T06:00:00Z'
            ])};
            console.log(JSON.stringify(instants.map(value => {
                const now = new Date(value);
                const week = weekWindowFor(0, now);
                return [scheduleDate(now), week.start, week.end];
            })));
        `], { cwd: require('path').resolve(__dirname, '../..'), env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        expect(JSON.parse(output)).toEqual([
            ['2025-01-12', '2025-01-06', '2025-01-12'],
            ['2025-01-12', '2025-01-06', '2025-01-12'],
            ['2025-01-13', '2025-01-13', '2025-01-19'],
            ['2026-07-05', '2026-06-29', '2026-07-05'],
            ['2026-07-06', '2026-07-06', '2026-07-12'],
            ['2026-03-08', '2026-03-02', '2026-03-08'],
            ['2026-03-08', '2026-03-02', '2026-03-08'],
            ['2026-11-01', '2026-10-26', '2026-11-01'],
            ['2026-11-01', '2026-10-26', '2026-11-01']
        ]);
    });

    it('keeps date-only inputs unchanged by timezone conversion and normalizes to Monday', () => {
        expect(parseWeekStart('2026-11-01')).toBe('2026-10-26');
        expect(parseWeekStart('2026-11-02')).toBe('2026-11-02');
        expect(parseWeekStart('2024-02-29')).toBe('2024-02-26');
        for (const invalid of ['2026-02-30', '2026-13-01', '2026-1-01', '', null, new Date()]) {
            expect(() => parseWeekStart(invalid)).toThrow('Invalid week start date');
        }
    });

    it('shifts whole calendar weeks and renders seven dates across a year change', () => {
        const window = weekWindowFor(1, new Date('2026-12-27T23:00:00-05:00'));
        expect(window).toEqual({ start: '2026-12-28', end: '2027-01-03', sqlStart: '2026-12-28', sqlEnd: '2027-01-03' });
        const days = weekDatesFor(window.start);
        expect(days.map(day => day.date)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
        expect(days[0]).toEqual({ name: 'Monday', date: '2026-12-28', formatted: 'Dec 28' });
        expect(days[6]).toEqual({ name: 'Sunday', date: '2027-01-03', formatted: 'Jan 3' });
        expect(weekWindowFor(-1, new Date('2026-11-02T05:00:00Z')).start).toBe('2026-10-26');
    });
});
