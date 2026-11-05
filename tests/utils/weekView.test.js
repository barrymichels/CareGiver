const { formatLocalDate, weekWindowFor } = require('../../utils/weekView');

/**
 * Inputs are built from local date components, and the expectations are the local
 * calendar Monday/Sunday for those inputs. That makes every assertion here hold
 * whatever TZ the suite runs in - which is the point, since the bug this guards
 * against was a timezone-dependent wrong window.
 */
describe('utils/weekView - local week windows', () => {
    describe('formatLocalDate', () => {
        it('formatLocalDate_withLateEveningLocalTime_shouldReturnThatSameCalendarDay', () => {
            // GIVEN a bound at the last instant of Sunday 8 Nov 2026, local time
            const lateSunday = new Date(2026, 10, 8, 23, 59, 59, 999);

            // WHEN it is formatted for SQL
            const formatted = formatLocalDate(lateSunday);

            // THEN it stays on its own calendar day
            // (toISOString() here yields 2026-11-09 west of UTC - the old defect)
            expect(formatted).toBe('2026-11-08');
        });

        it('formatLocalDate_withLocalMidnight_shouldReturnThatSameCalendarDay', () => {
            // GIVEN a bound at local midnight on Monday 2 Nov 2026
            const mondayMidnight = new Date(2026, 10, 2, 0, 0, 0, 0);

            // THEN it stays on its own calendar day
            // (toISOString() here yields 2026-11-01 east of UTC)
            expect(formatLocalDate(mondayMidnight)).toBe('2026-11-02');
        });

        it('formatLocalDate_withSingleDigitMonthAndDay_shouldPadBothToTwoDigits', () => {
            expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
        });
    });

    describe('weekWindowFor', () => {
        it('weekWindowFor_withMidweekAnchor_shouldSpanMondayToSundayOfThatWeek', () => {
            // GIVEN Thu 5 Nov 2026, 12:00 local
            const window = weekWindowFor(0, new Date(2026, 10, 5, 12, 0, 0));

            // THEN the window is Mon 2 Nov .. Sun 8 Nov 2026
            expect(window.sqlStart).toBe('2026-11-02');
            expect(window.sqlEnd).toBe('2026-11-08');
        });

        it('weekWindowFor_withSundayAnchor_shouldBelongToTheWeekStartedSixDaysEarlier', () => {
            // GIVEN Sun 1 Nov 2026, 12:00 local
            const window = weekWindowFor(0, new Date(2026, 10, 1, 12, 0, 0));

            // THEN the window is Mon 26 Oct .. Sun 1 Nov 2026
            expect(window.sqlStart).toBe('2026-10-26');
            expect(window.sqlEnd).toBe('2026-11-01');
        });

        it('weekWindowFor_withForwardOffset_shouldShiftTheWindowByWholeWeeks', () => {
            const anchor = new Date(2026, 10, 5, 12, 0, 0);

            expect(weekWindowFor(1, anchor)).toMatchObject({
                sqlStart: '2026-11-09',
                sqlEnd: '2026-11-15'
            });
            expect(weekWindowFor(-1, anchor)).toMatchObject({
                sqlStart: '2026-10-26',
                sqlEnd: '2026-11-01'
            });
            expect(weekWindowFor(-4, anchor)).toMatchObject({
                sqlStart: '2026-10-05',
                sqlEnd: '2026-10-11'
            });
        });

        it('weekWindowFor_acrossAFallDaylightSavingTransition_shouldStillSpanSevenLocalDays', () => {
            // GIVEN the US week Mon 26 Oct .. Sun 1 Nov 2026, which contains the
            // fall-back transition on its final day
            const window = weekWindowFor(0, new Date(2026, 9, 29, 12, 0, 0));

            // THEN neither bound is displaced by the changed-length day
            expect(window.sqlStart).toBe('2026-10-26');
            expect(window.sqlEnd).toBe('2026-11-01');
        });

        it('weekWindowFor_acrossASpringDaylightSavingTransition_shouldStillSpanSevenLocalDays', () => {
            // GIVEN the US week Mon 2 Mar .. Sun 8 Mar 2026, spring-forward on its final day
            const window = weekWindowFor(0, new Date(2026, 2, 4, 12, 0, 0));

            expect(window.sqlStart).toBe('2026-03-02');
            expect(window.sqlEnd).toBe('2026-03-08');
        });

        it('weekWindowFor_shouldAnchorStartAtLocalMidnightOnAMondayAndEndOnTheFollowingSunday', () => {
            // GIVEN any anchor in the week
            const window = weekWindowFor(0, new Date(2026, 10, 5, 17, 45, 0));

            // THEN the Dates carry the same contract the templates already rely on
            expect(window.start.getDay()).toBe(1);
            expect(window.start.getHours()).toBe(0);
            expect(window.start.getMinutes()).toBe(0);
            expect(window.end.getDay()).toBe(0);
            expect(window.end.getDate()).toBe(8);

            // AND the strings describe exactly those two Days
            expect(window.sqlStart).toBe(formatLocalDate(window.start));
            expect(window.sqlEnd).toBe(formatLocalDate(window.end));
        });

        it('weekWindowFor_withAnchorsOnEveryDayOfAWeek_shouldReturnTheIdenticalWindow', () => {
            // GIVEN all seven anchors of the week Mon 2 Nov .. Sun 8 Nov 2026
            const windows = [];
            for (let day = 2; day <= 8; day += 1) {
                windows.push(weekWindowFor(0, new Date(2026, 10, day, 9, 30, 0)));
            }

            // THEN every anchor resolves to that one window
            windows.forEach((window) => {
                expect(window.sqlStart).toBe('2026-11-02');
                expect(window.sqlEnd).toBe('2026-11-08');
            });
        });
    });
});
