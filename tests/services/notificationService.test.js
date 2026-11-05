/**
 * Finding 10. A missing VAPID key used to fail inside the constructor, where no
 * caller could see it: the schedulers never started for the life of the process,
 * while app.js printed "✅ Notification service initialized" regardless and the
 * container reported itself healthy.
 *
 * web-push is deliberately NOT mocked. The failure we care about is the real
 * library rejecting an undefined key, and a mock would let this suite stay green
 * through exactly the mistake that caused the bug.
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
