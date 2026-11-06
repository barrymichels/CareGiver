/**
 * PUT /api/notifications/preferences.
 *
 * Two defects are pinned here, both found by reading the route against the SQL it
 * reaches:
 *
 *   1. The route validates every field with `!== undefined`, so partial updates are
 *      clearly intended - but it then always built an object with all three keys, and
 *      the service filled the missing ones with defaults. A client that changed only
 *      the summary time silently got its 45-minute reminder reset to 15 and its
 *      switched-off summaries switched back on.
 *
 *   2. The scheduler only ever wakes during 06:00-10:59 (`* 6-10 * * *`), yet the API
 *      accepted any HH:MM. A preference of 05:30 or 15:00 was stored, confirmed with
 *      "updated successfully", and never fired - no error, nothing in the log.
 *
 * The real NotificationService is wired in on purpose. The reset only becomes visible
 * once the route's partial payload reaches the UPDATE, and a stubbed service would
 * let the route stay green while the row was still being overwritten.
 */
const request = require('supertest');
const express = require('express');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb } = require('../helpers/testHelpers');
const NotificationService = require('../../services/notificationService');

const SUBSCRIPTION = JSON.stringify({
    endpoint: 'https://push.example.com/known-endpoint',
    keys: { p256dh: 'fake-public-key', auth: 'fake-auth-secret' }
});

// The user's real, deliberately non-default settings. Anything that comes back
// different from these after a partial PUT is the bug.
const SEEDED = {
    notification_advance_minutes: 45,
    morning_summary_enabled: 0,
    morning_summary_time: '07:00',
    push_enabled: 1
};

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

let currentUserId = null;

const mockAuth = (req, res, next) => {
    if (!currentUserId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    req.isAuthenticated = () => true;
    req.user = { id: currentUserId, is_active: true };
    next();
};

const app = express();
app.use(express.json());
app.use(
    '/api/notifications',
    mockAuth,
    require('../../routes/notifications')(testDb, new NotificationService(testDb))
);

async function seedPreferences(userId) {
    // A fixed updated_at lets the "nothing was written" assertions compare a value
    // the database could only have changed by performing a write.
    await run(
        `INSERT OR REPLACE INTO notification_settings
             (user_id, notification_advance_minutes, morning_summary_enabled,
              morning_summary_time, push_subscription, push_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '2000-01-01 00:00:00')`,
        [
            userId,
            SEEDED.notification_advance_minutes,
            SEEDED.morning_summary_enabled,
            SEEDED.morning_summary_time,
            SUBSCRIPTION,
            SEEDED.push_enabled
        ]
    );
}

const getPreferences = (userId) =>
    getRow('SELECT * FROM notification_settings WHERE user_id = ?', [userId]);

describe('PUT /api/notifications/preferences', () => {
    let testUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        await run('DELETE FROM notification_settings');
        await run('DELETE FROM morning_summary_log');
        testUser = await createTestUser();
        currentUserId = testUser.id;
        await seedPreferences(testUser.id);
    });

    it('putPreferences_withOnlyTheSummaryTime_shouldNotResetTheOtherFields', async () => {
        // GIVEN a user who set a 45-minute reminder and switched summaries off,
        // WHEN they save just the summary time, the way a client patching one
        // control does,
        const response = await request(app)
            .put('/api/notifications/preferences')
            .send({ morningSummaryTime: '08:00' })
            .expect(200);

        // THEN only that one column moves. Previously the row came back at 15
        // minutes with summaries switched back on: the user started receiving a
        // daily push they had explicitly turned off.
        expect(response.body).toHaveProperty('message');
        await expect(getPreferences(testUser.id)).resolves.toMatchObject({
            notification_advance_minutes: 45,
            morning_summary_enabled: 0,
            morning_summary_time: '08:00'
        });
    });

    it('putPreferences_withOnlyTheAdvanceMinutes_shouldNotResetTheOtherFields', async () => {
        // GIVEN the same saved settings,
        // WHEN the client patches only the reminder lead time,
        await request(app)
            .put('/api/notifications/preferences')
            .send({ notificationAdvanceMinutes: 60 })
            .expect(200);

        // THEN the summary settings the user never touched stay off and at 07:00.
        await expect(getPreferences(testUser.id)).resolves.toMatchObject({
            notification_advance_minutes: 60,
            morning_summary_enabled: 0,
            morning_summary_time: '07:00'
        });
    });

    it('putPreferences_shouldNotDiscardThePushSubscription', async () => {
        // GIVEN a user with a live browser push subscription on the same row,
        // WHEN they change a preference,
        await request(app)
            .put('/api/notifications/preferences')
            .send({ morningSummaryTime: '08:00' })
            .expect(200);

        // THEN they are still subscribed. The row carries both kinds of state and a
        // preference write has no business clearing the subscription.
        await expect(getPreferences(testUser.id)).resolves.toMatchObject({
            push_subscription: SUBSCRIPTION,
            push_enabled: 1
        });
    });

    it('putPreferences_withAllFields_shouldStillSaveAllThree', async () => {
        // GIVEN the profile form, which sends every field on each submit,
        // WHEN it saves,
        await request(app)
            .put('/api/notifications/preferences')
            .send({
                notificationAdvanceMinutes: 30,
                morningSummaryEnabled: true,
                morningSummaryTime: '09:15'
            })
            .expect(200);

        // THEN the whole form is written. Partial updates must not cost the main
        //      path its behaviour.
        await expect(getPreferences(testUser.id)).resolves.toMatchObject({
            notification_advance_minutes: 30,
            morning_summary_enabled: 1,
            morning_summary_time: '09:15'
        });
    });

    it('putPreferences_withAnEmptyBody_shouldSucceedWithoutWriting', async () => {
        // GIVEN a request that changes nothing,
        // WHEN it is sent,
        const response = await request(app)
            .put('/api/notifications/preferences')
            .send({})
            .expect(200);

        // THEN nothing is written. Defaults must not arrive as a side effect of an
        //      empty request: updated_at is only ever touched by a real UPDATE.
        expect(response.body).toHaveProperty('message');
        await expect(getPreferences(testUser.id)).resolves.toMatchObject({
            ...SEEDED,
            push_subscription: SUBSCRIPTION,
            updated_at: '2000-01-01 00:00:00'
        });
    });

    it.each(['05:30', '05:59', '11:00', '15:00', '23:59', '00:00'])(
        'putPreferences_withSummaryTimeOutsideTheSchedulableWindow_%s_shouldBeRejected',
        async (morningSummaryTime) => {
            // GIVEN a summary time the 6-10 AM cron can never wake up for,
            // WHEN the user tries to save it,
            const response = await request(app)
                .put('/api/notifications/preferences')
                .send({ morningSummaryTime });

            // THEN it is refused with an explanation, instead of being accepted and
            //      silently never sent. The stored row is left alone.
            expect(response.status).toBe(400);
            expect(response.body.error).toMatch(/06:00/);
            expect(response.body.error).toMatch(/10:59/);
            await expect(getPreferences(testUser.id)).resolves.toMatchObject({
                morning_summary_time: '07:00'
            });
        }
    );

    it.each(['06:00', '07:30', '10:59'])(
        'putPreferences_withSummaryTimeInsideTheSchedulableWindow_%s_shouldBeAccepted',
        async (morningSummaryTime) => {
            // GIVEN a time the scheduler really does run for,
            // WHEN the user saves it,
            await request(app)
                .put('/api/notifications/preferences')
                .send({ morningSummaryTime })
                .expect(200);

            // THEN it is stored.
            await expect(getPreferences(testUser.id)).resolves.toMatchObject({
                morning_summary_time: morningSummaryTime
            });
        }
    );

    it('putPreferences_withMalformedSummaryTime_shouldStillBeRejected', async () => {
        // GIVEN a value that is not a time at all,
        // WHEN it is sent,
        const response = await request(app)
            .put('/api/notifications/preferences')
            .send({ morningSummaryTime: '7am' });

        // THEN the existing shape error still answers, unchanged by the window check.
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Invalid time format. Use HH:MM format');
    });

    it('putPreferences_withAdvanceMinutesOutOfRange_shouldStillBeRejected', async () => {
        // GIVEN a lead time outside the supported 5-120 minute range,
        // WHEN it is sent,
        const response = await request(app)
            .put('/api/notifications/preferences')
            .send({ notificationAdvanceMinutes: 240 });

        // THEN the existing validation still answers, unchanged.
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty(
            'error',
            'Notification advance time must be between 5 and 120 minutes'
        );
    });
});

describe('GET /api/notifications/preferences', () => {
    let testUser;

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await clearTestDb();
        await run('DELETE FROM notification_settings');
        testUser = await createTestUser();
        currentUserId = testUser.id;
        await seedPreferences(testUser.id);
    });

    it('getPreferences_shouldReturnTheSavedRow', async () => {
        // GIVEN a user with saved settings,
        // WHEN the client reads them,
        const response = await request(app)
            .get('/api/notifications/preferences')
            .expect(200);

        // THEN it sees what is stored, which is what makes a silent reset visible.
        expect(response.body).toMatchObject({
            notification_advance_minutes: 45,
            morning_summary_enabled: 0,
            morning_summary_time: '07:00',
            push_enabled: 1
        });
    });
});
