const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser } = require('../helpers/testHelpers');

/**
 * The success path of POST /reset-password/:token.
 *
 * tests/routes/auth.test.js covers only the expired-token branch, so the body of
 * the handler - the password write and, more importantly, `reset_token = NULL` -
 * had never run under test. Drop that column-clear and a stolen reset link stays
 * replayable for its whole hour, and the suite stays green. These tests execute
 * the write and then re-open the same link.
 *
 * The suite is pinned to the app's supported zone (see jest.config.js), so these
 * tests exercise the expiry comparison the way the deployed container makes it.
 */
describe('POST /reset-password/:token', () => {
    let app;
    let user;

    const run = (sql, params = []) => new Promise((resolve, reject) => {
        testDb.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    const get = (sql, params = []) => new Promise((resolve, reject) => {
        testDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });

    const issueToken = (token, expiresIn = 60 * 60 * 1000) => run(
        'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
        [token, Date.now() + expiresIn, user.id]
    );

    const submit = (token, password = 'brandnewpassword') => request(app)
        .post(`/reset-password/${token}`)
        .send({ password, confirmPassword: password });

    beforeAll(async () => {
        await initializeTestDb();
    });

    beforeEach(async () => {
        await run('DELETE FROM availability');
        await run('DELETE FROM assignments');
        await run('DELETE FROM user_preferences');
        await run('DELETE FROM users');

        app = express();
        app.use(express.json());
        app.use('/', require('../../routes/auth')(testDb));

        user = await createTestUser({ email: `reset-${crypto.randomBytes(4).toString('hex')}@example.com` });
    });

    it('resetPassword_withAValidToken_shouldAcceptTheNewPassword', async () => {
        // GIVEN a live reset token for an existing account,
        const token = crypto.randomBytes(32).toString('hex');
        await issueToken(token);

        // WHEN the form on the link is submitted,
        const response = await submit(token, 'brandnewpassword');

        // THEN the reset succeeded, and it succeeded by writing to the database -
        // not by answering a plausible body, which is the failure mode this file
        // exists to catch.
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message',
            'Password has been reset successfully. You can now log in with your new password.');

        const stored = await get('SELECT password FROM users WHERE id = ?', [user.id]);
        expect(await bcrypt.compare('brandnewpassword', stored.password)).toBe(true);
        expect(await bcrypt.compare('password123', stored.password)).toBe(false);
    });

    it('resetPassword_withAValidToken_shouldClearTheTokenAndItsExpiry', async () => {
        // GIVEN a live reset token,
        const token = crypto.randomBytes(32).toString('hex');
        await issueToken(token);

        // WHEN it is used once,
        await submit(token).expect(200);

        // THEN the account carries no usable token any more. This is the assertion
        // that makes `reset_token = NULL` load-bearing: without it the row would
        // keep a credential that works until its expiry, so anyone who saw the
        // link - a mail log, a forwarded mail, an old phone notification - could
        // take the account over repeatedly.
        const stored = await get('SELECT reset_token, reset_token_expires FROM users WHERE id = ?', [user.id]);
        expect(stored.reset_token).toBeNull();
        expect(stored.reset_token_expires).toBeNull();
    });

    it('resetPassword_withTheSameTokenTwice_shouldRefuseTheSecondUse', async () => {
        // GIVEN a live reset token, used once successfully,
        const token = crypto.randomBytes(32).toString('hex');
        await issueToken(token);
        await submit(token, 'brandnewpassword').expect(200);

        // WHEN the very same link is submitted again with a different password,
        const replay = await submit(token, 'attackerpassword');

        // THEN it is refused, and the account still belongs to whoever used it first.
        expect(replay.status).toBe(400);
        expect(replay.body).toEqual({ error: 'Password reset link is invalid or has expired' });

        const stored = await get('SELECT password FROM users WHERE id = ?', [user.id]);
        expect(await bcrypt.compare('attackerpassword', stored.password)).toBe(false);
        expect(await bcrypt.compare('brandnewpassword', stored.password)).toBe(true);
    });

    it('resetPassword_withAnUnknownToken_shouldRefuseWithoutTouchingTheAccount', async () => {
        // GIVEN an account with no token issued,
        const response = await submit(crypto.randomBytes(32).toString('hex'));

        // THEN the attempt is refused and the password hash is untouched, which is
        // what stops this route from being a password-change oracle for anyone who
        // can guess a user id.
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Password reset link is invalid or has expired' });

        const stored = await get('SELECT password, reset_token FROM users WHERE id = ?', [user.id]);
        expect(await bcrypt.compare('password123', stored.password)).toBe(true);
        expect(stored.reset_token).toBeNull();
    });

    it('resetPassword_withAWeakOrMismatchedPassword_shouldRefuseBeforeLookingUpTheToken', async () => {
        // GIVEN a live token nobody has spent,
        const token = crypto.randomBytes(32).toString('hex');
        await issueToken(token);

        // WHEN the form is filled in wrong,
        const tooShort = await request(app).post(`/reset-password/${token}`).send({ password: 'short', confirmPassword: 'short' });
        const mismatched = await request(app).post(`/reset-password/${token}`).send({ password: 'longenoughpassword', confirmPassword: 'differentpassword' });

        // THEN both are refused on shape, and the token survives for the real
        // attempt - a validation typo should not spend somebody's reset link.
        expect(tooShort.status).toBe(400);
        expect(tooShort.body).toEqual({ error: 'Password must be at least 8 characters long' });
        expect(mismatched.status).toBe(400);
        expect(mismatched.body).toEqual({ error: 'Passwords do not match' });

        expect((await get('SELECT reset_token FROM users WHERE id = ?', [user.id])).reset_token).toBe(token);
        await submit(token).expect(200);
    });
});
