/**
 * Finding 10. A missing VAPID key used to fail inside the constructor, where no
 * caller could see it: the schedulers never started for the life of the process,
 * while app.js printed "✅ Notification service initialized" regardless and the
 * container reported itself healthy.
 *
 * web-push is deliberately NOT mocked. The failure we care about is the real
 * library rejecting an undefined key, and a mock would let this suite stay green
 * through exactly the mistake that caused the bug.
 *
 * The suites below the VAPID ones cover the three remaining defects in this file:
 * a partial preference write resetting the fields it omitted, a morning summary
 * recorded as sent on a push that failed, and dead push subscriptions never being
 * pruned. They run against the real database, and webpush is only ever spied on to
 * inject a status code - the pruning decision is made from that code, not from the
 * library's internals.
 */
jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ start: jest.fn() }))
}));

const cron = require('node-cron');
const webpush = require('web-push');
const NotificationService = require('../../services/notificationService');

const VAPID_ENV_KEYS = ['VAPID_EMAIL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
const fakeDb = { get: jest.fn(), all: jest.fn(), run: jest.fn() };

let savedEnv;

beforeEach(() => {
    // Every test starts with no VAPID configuration unless it asks for it.
    savedEnv = {};
    VAPID_ENV_KEYS.forEach((key) => {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    });
    cron.schedule.mockReset().mockImplementation(() => ({ start: jest.fn() }));
});

afterEach(() => {
    VAPID_ENV_KEYS.forEach((key) => {
        if (savedEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = savedEnv[key];
        }
    });
});

describe('NotificationService construction', () => {
    it('constructor_shouldNotInitialiseOrStartSchedulers_whenInitHasNotBeenCalled', () => {
        // GIVEN a service that nobody has initialised yet,
        const service = new NotificationService(fakeDb);

        // WHEN we look at it,
        // THEN it must be honestly uninitialised with no cron jobs running.
        // The old constructor called init() itself, so this was never true.
        expect(service.initialized).toBe(false);
        expect(service.degradationReason).toBeNull();
        expect(cron.schedule).not.toHaveBeenCalled();
        expect(service.scheduledJobs.size).toBe(0);
    });
});

describe('NotificationService.init with a missing VAPID key', () => {
    it('init_withNoVapidKeys_shouldReportFailureToTheCallerWithoutThrowing', async () => {
        // GIVEN a deployment with no VAPID keys configured,
        const service = new NotificationService(fakeDb);

        // WHEN we initialise it,
        const result = await service.init();

        // THEN the caller is told it failed, instead of a log line nobody reads
        // and a constructor that cannot propagate the problem.
        expect(result.ok).toBe(false);
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
        expect(service.initialized).toBe(false);
        expect(service.degradationReason).toBe(result.reason);
    });

    it('init_withNoVapidKeys_shouldNameTheActualCause', async () => {
        // GIVEN a deployment with no VAPID keys configured,
        const service = new NotificationService(fakeDb);

        // WHEN we initialise it,
        const result = await service.init();

        // THEN the reason is the real web-push complaint, not a generic fallback,
        // so the boot log is a usable diagnosis rather than a shrug.
        expect(result.reason.toLowerCase()).toContain('key');
    });

    it('init_withNoVapidKeys_shouldNotStartAnySchedulers', async () => {
        // GIVEN a deployment with no VAPID keys configured,
        const service = new NotificationService(fakeDb);

        // WHEN we initialise it,
        await service.init();

        // THEN no schedulers start. This is the regression itself: previously the
        // schedulers were unreachable yet the app still reported itself working.
        expect(cron.schedule).not.toHaveBeenCalled();
        expect(service.scheduledJobs.size).toBe(0);
    });
});

describe('NotificationService.init with usable VAPID keys', () => {
    it('init_withValidVapidKeys_shouldReportSuccessAndStartBothSchedulers', async () => {
        // GIVEN a correctly configured deployment,
        const keys = await webpush.generateVAPIDKeys();
        process.env.VAPID_PUBLIC_KEY = keys.publicKey;
        process.env.VAPID_PRIVATE_KEY = keys.privateKey;
        const service = new NotificationService(fakeDb);

        // WHEN we initialise it,
        const result = await service.init();

        // THEN it reports success and the two reminder jobs are scheduled and started.
        expect(result).toEqual({ ok: true });
        expect(service.initialized).toBe(true);
        expect(service.degradationReason).toBeNull();
        expect(cron.schedule).toHaveBeenCalledTimes(2);
        service.scheduledJobs.forEach((job) => expect(job.start).toHaveBeenCalled());
    });

    it('init_afterAFailedAttempt_shouldRecoverOnceTheKeysArePresent', async () => {
        // GIVEN a first attempt that failed because the keys were missing,
        const service = new NotificationService(fakeDb);
        const failed = await service.init();
        expect(failed.ok).toBe(false);

        // WHEN the keys turn up and init is called again,
        const keys = await webpush.generateVAPIDKeys();
        process.env.VAPID_PUBLIC_KEY = keys.publicKey;
        process.env.VAPID_PRIVATE_KEY = keys.privateKey;
        const recovered = await service.init();

        // THEN the service comes up cleanly rather than staying degraded forever.
        expect(recovered).toEqual({ ok: true });
        expect(service.initialized).toBe(true);
        expect(service.degradationReason).toBeNull();
    });
});

/**
 * Preference writes, morning-summary accounting, and dead-subscription pruning all
 * run against the real in-memory database. Each of these three defects is a claim
 * about what ends up in a row, and a mocked db would just echo back whatever the
 * test asserted.
 */
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');

const SUBSCRIPTION = JSON.stringify({
    endpoint: 'https://push.example.com/known-endpoint',
    keys: { p256dh: 'fake-public-key', auth: 'fake-auth-secret' }
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
    testDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    testDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const getSettings = (userId) =>
    getRow('SELECT * FROM notification_settings WHERE user_id = ?', [userId]);

const countSummaryLog = async (userId, date) =>
    (await getRow('SELECT COUNT(*) AS n FROM morning_summary_log WHERE user_id = ? AND date = ?', [userId, date])).n;

async function seedSettings(userId, overrides = {}) {
    await run(
        `INSERT OR REPLACE INTO notification_settings
             (user_id, notification_advance_minutes, morning_summary_enabled,
              morning_summary_time, push_subscription, push_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '2000-01-01 00:00:00')`,
        [
            userId,
            overrides.notification_advance_minutes ?? 45,
            overrides.morning_summary_enabled ?? 0,
            overrides.morning_summary_time ?? '07:00',
            overrides.push_subscription === undefined ? SUBSCRIPTION : overrides.push_subscription,
            overrides.push_enabled ?? 1
        ]
    );
}

describe('NotificationService.updateNotificationPreferences with a partial payload', () => {
    let service;
    let userId;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        await run('DELETE FROM notification_settings');
        userId = (await createTestUser()).id;
        await seedSettings(userId);
        service = new NotificationService(testDb);
    });

    it('updateNotificationPreferences_withOnlyTheTime_shouldNotResetTheOtherColumns', async () => {
        // GIVEN a user who chose a 45-minute reminder and turned summaries off,
        await seedSettings(userId, {
            notification_advance_minutes: 45,
            morning_summary_enabled: 0,
            morning_summary_time: '07:00'
        });

        // WHEN a client updates just the summary time,
        await expect(
            service.updateNotificationPreferences(userId, { morningSummaryTime: '08:00' })
        ).resolves.toBe(true);

        // THEN the untouched preferences survive. They used to fall back to the
        // destructuring defaults of 15 / true, which re-enables a summary the user
        // had switched off.
        await expect(getSettings(userId)).resolves.toMatchObject({
            notification_advance_minutes: 45,
            morning_summary_enabled: 0,
            morning_summary_time: '08:00'
        });
    });

    it('updateNotificationPreferences_shouldPreserveThePushSubscriptionColumns', async () => {
        // GIVEN a user who is subscribed to push,
        await seedSettings(userId, { push_enabled: 1 });

        // WHEN a preference is written,
        await service.updateNotificationPreferences(userId, { notificationAdvanceMinutes: 60 });

        // THEN the subscription survives - it lives on the same row and is the only
        //      reason this UPDATE exists at all.
        await expect(getSettings(userId)).resolves.toMatchObject({
            notification_advance_minutes: 60,
            push_subscription: SUBSCRIPTION,
            push_enabled: 1
        });
    });

    it('updateNotificationPreferences_withNoFields_shouldNotWriteAtAll', async () => {
        // GIVEN an empty update,
        // WHEN it is applied,
        await expect(service.updateNotificationPreferences(userId, {})).resolves.toBe(true);

        // THEN the row is byte-for-byte untouched. updated_at is written by every
        //      real UPDATE, so a stale value is proof nothing was written.
        await expect(getSettings(userId)).resolves.toMatchObject({
            notification_advance_minutes: 45,
            morning_summary_enabled: 0,
            morning_summary_time: '07:00',
            updated_at: '2000-01-01 00:00:00'
        });
    });

    it('updateNotificationPreferences_forAUserWithoutARow_shouldCreateIt', async () => {
        // GIVEN a user who has never opened the notification settings,
        const newcomer = (await createTestUser()).id;

        // WHEN their first preference is saved,
        await expect(
            service.updateNotificationPreferences(newcomer, { notificationAdvanceMinutes: 30 })
        ).resolves.toBe(true);

        // THEN a row exists holding the new value plus the schema defaults for the
        //      rest - the create path the UI depends on still works.
        await expect(getSettings(newcomer)).resolves.toMatchObject({
            notification_advance_minutes: 30,
            morning_summary_enabled: 1,
            morning_summary_time: '07:00'
        });
    });
});

describe('NotificationService.sendMorningSummaries sent-log accounting', () => {
    // Fixed clock: the summary job compares the wall clock to the user's preferred
    // minute, and a run that straddles a minute boundary would make these flaky.
    const NOW = new Date(2026, 0, 15, 7, 30, 0);
    const TODAY = '2026-01-15';

    let service;
    let userId;

    beforeAll(async () => {
        await initializeTestDb();
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    beforeEach(async () => {
        await clearTestDb();
        await run('DELETE FROM notification_settings');
        await run('DELETE FROM morning_summary_log');
        userId = (await createTestUser({ first_name: 'Ada' })).id;
        await seedSettings(userId, { morning_summary_enabled: 1, morning_summary_time: '07:30' });
        service = new NotificationService(testDb);
        service.initialized = true;
        jest.spyOn(service, 'sendPushNotification').mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('sendMorningSummaries_whenThePushSucceeds_shouldRecordTheDayAsSent', async () => {
        // GIVEN a user whose summary is due now,
        // WHEN the job runs,
        await service.sendMorningSummaries();

        // THEN the dedupe row is written, so the remaining minutes of the window do
        //      not push a second summary.
        expect(service.sendPushNotification).toHaveBeenCalledTimes(1);
        expect(await countSummaryLog(userId, TODAY)).toBe(1);
    });

    it('sendMorningSummaries_whenThePushFails_shouldNotRecordTheDayAsSent', async () => {
        // GIVEN the push service rejecting the send - a flaky push, not a bad user,
        service.sendPushNotification.mockResolvedValue(false);

        // WHEN the job runs,
        await service.sendMorningSummaries();

        // THEN nothing is recorded. One failed attempt used to write the UNIQUE
        //      (user_id, date) row anyway, which both lost the summary for the whole
        //      day and blocked the retry that was supposed to follow.
        expect(await countSummaryLog(userId, TODAY)).toBe(0);
    });

    it('sendMorningSummaries_afterAFailure_shouldRetryOnTheNextRunAndThenRecordIt', async () => {
        // GIVEN a first attempt that failed,
        service.sendPushNotification.mockResolvedValueOnce(false);
        await service.sendMorningSummaries();

        // WHEN the next minute's run succeeds,
        await service.sendMorningSummaries();

        // THEN the user still gets their summary exactly once.
        expect(service.sendPushNotification).toHaveBeenCalledTimes(2);
        expect(await countSummaryLog(userId, TODAY)).toBe(1);
    });

    it('sendMorningSummaries_afterASuccess_shouldNotSendAgainTheSameDay', async () => {
        // GIVEN a summary already delivered today,
        await service.sendMorningSummaries();

        // WHEN the window runs again,
        await service.sendMorningSummaries();

        // THEN the dedupe row suppresses it - fixing the accounting must not turn
        //      every minute of the window into a duplicate push.
        expect(service.sendPushNotification).toHaveBeenCalledTimes(1);
        expect(await countSummaryLog(userId, TODAY)).toBe(1);
    });

    it('sendMorningSummary_shouldReportTheFailedPushToItsCaller', async () => {
        // GIVEN a send the push service rejects,
        service.sendPushNotification.mockResolvedValue(false);

        // WHEN the summary is composed and sent,
        const sent = await service.sendMorningSummary(
            { user_id: userId, first_name: 'Ada', last_name: 'L', push_subscription: SUBSCRIPTION },
            TODAY
        );

        // THEN the caller is told it failed, instead of the error being logged and
        //      dropped on the floor as if the notification had gone out.
        expect(sent).toBe(false);
    });
});

describe('NotificationService.sendPushNotification with a dead subscription', () => {
    let service;
    let userId;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        await run('DELETE FROM notification_settings');
        userId = (await createTestUser()).id;
        await seedSettings(userId, { push_enabled: 1 });
        service = new NotificationService(testDb);
        service.initialized = true;
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const pushError = (statusCode) => {
        const error = new Error(`Push service said ${statusCode}`);
        error.statusCode = statusCode;
        return error;
    };

    const rejectWith = (statusCode) =>
        jest.spyOn(webpush, 'sendNotification').mockRejectedValue(pushError(statusCode));

    it.each([410, 404])(
        'sendPushNotification_onASubscriptionGone_%i_shouldPruneItFromTheDatabase',
        async (statusCode) => {
            // GIVEN a browser that uninstalled the app, so the push service answers
            //      "%i" for this endpoint forever,
            rejectWith(statusCode);

            // WHEN the reminder job tries to use it,
            await expect(
                service.sendPushNotification(SUBSCRIPTION, { title: 't', body: 'b' })
            ).resolves.toBe(false);

            // THEN the subscription is gone. The old handler only logged "disabling"
            //      next to a TODO, so push_enabled stayed 1 and the every-minute job
            //      re-POSTed to a dead endpoint while the user received nothing.
            await expect(getSettings(userId)).resolves.toMatchObject({
                push_enabled: 0,
                push_subscription: null
            });
        }
    );

    it('sendPushNotification_onATemporaryPushServiceFailure_shouldKeepTheSubscription', async () => {
        // GIVEN a push service that is merely unhappy right now,
        rejectWith(500);

        // WHEN a send fails,
        await expect(
            service.sendPushNotification(SUBSCRIPTION, { title: 't', body: 'b' })
        ).resolves.toBe(false);

        // THEN the subscription is kept - pruning it here would silently unsubscribe
        //      a family member for a blip on someone else's server.
        await expect(getSettings(userId)).resolves.toMatchObject({
            push_enabled: 1,
            push_subscription: SUBSCRIPTION
        });
    });

    it('sendPushNotification_whenNothingIsStoredForTheEndpoint_shouldNotTouchOtherSubscriptions', async () => {
        // GIVEN a different user whose subscription is the only one in the table,
        const other = (await createTestUser()).id;
        await run('DELETE FROM notification_settings');
        await seedSettings(other, { push_enabled: 1 });

        // WHEN a send fails for an endpoint nobody has stored,
        await service.sendPushNotification(
            JSON.stringify({ endpoint: 'https://push.example.com/stranger', keys: {} }),
            { title: 't', body: 'b' }
        );

        // THEN the unrelated user is still subscribed.
        await expect(getSettings(other)).resolves.toMatchObject({ push_enabled: 1 });
    });

    it('sendPushNotification_shouldStillPruneWhenTheCallerPassedAParsedObject', async () => {
        // GIVEN the same dead endpoint handed over as an object, the way a caller
        //      that already parsed the JSON would pass it,
        rejectWith(410);

        // WHEN the send fails,
        await service.sendPushNotification(JSON.parse(SUBSCRIPTION), { title: 't', body: 'b' });

        // THEN it is still pruned - the lookup cannot assume one input shape.
        await expect(getSettings(userId)).resolves.toMatchObject({ push_enabled: 0 });
    });
});


describe('Notification delivery through saved assignments', () => {
    let service, userId, send, originalEnv;
    const assignment = (id, date, time) => run(
        'INSERT INTO assignments (user_id, day_date, time_slot, assigned_by) VALUES (?, ?, ?, ?)',
        [id, date, time, id]
    );

    beforeAll(initializeTestDb);
    beforeEach(async () => {
        originalEnv = process.env;
        process.env = { ...originalEnv, ICS_EVENT_SUMMARY: 'Visit Dad', NOTIFICATION_DEBUG: 'false' };
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        jest.setSystemTime(new Date(2026, 0, 15, 7, 30));
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        send = jest.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
        await clearTestDb();
        userId = (await createTestUser({ first_name: 'Ada' })).id;
        await seedSettings(userId, { notification_advance_minutes: 15 });
        service = new NotificationService(testDb);
        service.initialized = true;
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        process.env = originalEnv;
    });

    it.each([
        [7, 30, '2026-01-15', '7:45am'],
        [11, 45, '2026-01-15', '12:00pm'],
        [16, 45, '2026-01-15', '17:00'],
        [23, 45, '2026-01-16', '12:00am']
    ])('delivers a reminder at %i:%i for %s %s', async (hour, minute, date, time) => {
        jest.setSystemTime(new Date(2026, 0, 15, hour, minute));
        await assignment(userId, date, time);
        await assignment(userId, '2026-01-14', time);
        await assignment(userId, date, '3:13am');
        await service.checkUpcomingShifts();
        expect(send).toHaveBeenCalledTimes(1);
        const [subscription, body, options] = send.mock.calls[0];
        expect(subscription).toEqual(JSON.parse(SUBSCRIPTION));
        expect(JSON.parse(body)).toMatchObject({
            body: `Reminder to Visit Dad at ${time}`,
            data: { type: 'shift_reminder', date, time, url: '/dashboard' }
        });
        expect(options).toMatchObject({ TTL: 3600, urgency: 'high' });
    });

    it.each([
        { push_enabled: 0 }, { push_subscription: null }
    ])('does not send to a user whose settings are %j', async overrides => {
        await seedSettings(userId, { notification_advance_minutes: 15, ...overrides });
        await assignment(userId, '2026-01-15', '7:45am');
        await service.checkUpcomingShifts();
        expect(send).not.toHaveBeenCalled();
    });

    it('does not deliver another user’s assignment or send before initialization', async () => {
        const other = (await createTestUser()).id;
        await assignment(other, '2026-01-15', '7:45am');
        await service.checkUpcomingShifts();
        expect(send).not.toHaveBeenCalled();
        await assignment(userId, '2026-01-15', '07:45');
        service.initialized = false;
        await service.checkUpcomingShifts();
        await service.sendMorningSummaries();
        expect(send).not.toHaveBeenCalled();
    });

    it('subscribes and unsubscribes without resetting reminder preferences', async () => {
        await service.updateNotificationPreferences(userId, { notificationAdvanceMinutes: 60, morningSummaryEnabled: false });
        const subscription = { endpoint: 'https://push.example.com/replacement', keys: {} };
        await expect(service.subscribeUser(userId, subscription)).resolves.toBe(true);
        expect(await getSettings(userId)).toMatchObject({
            push_subscription: JSON.stringify(subscription), push_enabled: 1,
            notification_advance_minutes: 60, morning_summary_enabled: 0
        });
        await expect(service.unsubscribeUser(userId)).resolves.toBe(true);
        expect(await getSettings(userId)).toMatchObject({
            push_subscription: null, push_enabled: 0,
            notification_advance_minutes: 60, morning_summary_enabled: 0
        });
    });

    it('creates subscription settings on first use', async () => {
        const other = (await createTestUser()).id;
        await expect(service.subscribeUser(other, JSON.parse(SUBSCRIPTION))).resolves.toBe(true);
        expect(await service.getNotificationPreferences(other)).toMatchObject({
            notification_advance_minutes: 15, morning_summary_enabled: 1, push_enabled: 1
        });
    });

    it.each([
        [[], 'No shifts scheduled for today. Enjoy your day!'],
        [['8:00am'], 'You have 1 shift today at 8:00am'],
        [['8:00am', '9:30pm'], 'You have 2 shifts today at 8:00am, 9:30pm']
    ])('composes the summary from today’s assignments (%j)', async (times, body) => {
        for (const time of times) await assignment(userId, '2026-01-15', time);
        await assignment(userId, '2026-01-16', '5:00pm');
        await seedSettings(userId, { morning_summary_enabled: 1, morning_summary_time: '07:30' });
        await service.sendMorningSummaries();
        expect(send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({
            title: '🌅 Good morning, Ada!', body, data: { type: 'morning_summary', date: '2026-01-15' }
        });
        expect(await countSummaryLog(userId, '2026-01-15')).toBe(1);
    });

    it.each(['07:25', '07:31', '08:30'])('does not deliver outside the summary window for %s', async time => {
        await seedSettings(userId, { morning_summary_enabled: 1, morning_summary_time: time });
        await service.sendMorningSummaries();
        expect(send).not.toHaveBeenCalled();
        expect(await countSummaryLog(userId, '2026-01-15')).toBe(0);
    });

    it('reports subscription persistence failure instead of claiming success', async () => {
        await expect(service.subscribeUser(-1, JSON.parse(SUBSCRIPTION))).resolves.toBe(false);
        expect(await getSettings(-1)).toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(
            'Error subscribing user to push notifications:', expect.objectContaining({ code: 'SQLITE_CONSTRAINT' })
        );
    });

    it.each([null, '{invalid json'])('rejects unusable subscriptions (%j) without a network call', async subscription => {
        await expect(service.sendPushNotification(subscription, { title: 'Reminder' })).resolves.toBe(false);
        expect(send).not.toHaveBeenCalled();
        expect(await getSettings(userId)).toMatchObject({ push_enabled: 1 });
    });
});
