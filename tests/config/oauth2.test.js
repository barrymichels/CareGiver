const configureOAuth2 = require('../../config/oauth2');

jest.mock('axios');
const axios = require('axios');

// These tests exercise the OAuth2 verify callback - the code that decides who gets a
// session when Authentik answers the token exchange. config/oauth2.js registers nothing
// while NODE_ENV=test, so each test impersonates production for the duration of the
// factory call and restores the environment afterwards. The strategy object keeps the
// verify function alive after the environment is put back.

const PRODUCTION_ENV = {
    NODE_ENV: 'production',
    ENABLE_AUTHENTIK_LOGIN: 'true',
    AUTHENTIK_AUTH_URL: 'https://idp.example.org/application/o/authorize/',
    AUTHENTIK_TOKEN_URL: 'https://idp.example.org/application/o/token/',
    AUTHENTIK_CLIENT_ID: 'test-client-id',
    AUTHENTIK_CLIENT_SECRET: 'test-client-secret',
    AUTHENTIK_CALLBACK_URL: 'https://scheduler.example.org/auth/callback'
};

function loadVerify(db, extraEnv = {}) {
    const savedEnv = { ...process.env };
    Object.assign(process.env, PRODUCTION_ENV, extraEnv);
    try {
        const passport = { use: jest.fn() };
        configureOAuth2(passport, db);
        expect(passport.use).toHaveBeenCalledTimes(1);
        // passReqToCallback: true, so the verifier is (req, accessToken, refreshToken, params, profile, done).
        return passport.use.mock.calls[0][1]._verify;
    } finally {
        process.env = savedEnv;
    }
}

function buildDb({ row, error } = {}) {
    return {
        get: jest.fn((sql, params, callback) => (error ? callback(error) : callback(null, row))),
        run: jest.fn((sql, params, callback) => callback.call({ lastID: 42 }, null))
    };
}

function runVerify(verify, userInfo, done = jest.fn()) {
    return verify({}, 'access-token', 'refresh-token', {}, {}, done).then(() => done);
}

beforeEach(() => {
    axios.get.mockReset();
});

describe('config/oauth2 verify callback', () => {
    it('oauthVerify_withAnActiveExistingUser_shouldSignInThatUser', async () => {
        // GIVEN an active account the IdP address matches,
        const account = { id: 5, email: 'alice@example.com', is_active: 1 };
        const verify = loadVerify(buildDb({ row: account }));
        axios.get.mockResolvedValue({ data: { email: 'alice@example.com' } });

        // WHEN the IdP finishes the exchange,
        const done = await runVerify(verify, { email: 'alice@example.com' });

        // THEN the account signs in.
        expect(done).toHaveBeenCalledWith(null, account);
    });

    it('oauthVerify_withADeactivatedExistingUser_shouldFailWithTheAccountNotActivatedError', async () => {
        // GIVEN an account an admin has deactivated - the local strategy refuses this
        //      state, and the OAuth path used to answer done(null, user) instead, letting
        //      a deactivated admin walk back in through /auth/login for a fresh session.
        const account = { id: 5, email: 'alice@example.com', is_active: 0 };
        const verify = loadVerify(buildDb({ row: account }));
        axios.get.mockResolvedValue({ data: { email: 'alice@example.com' } });

        // WHEN the IdP finishes the exchange,
        const done = await runVerify(verify, { email: 'alice@example.com' });

        // THEN it fails the same way the local strategy does, with a real Error so
        //      passport cannot flatten the reason into a generic authentication failure.
        expect(done).toHaveBeenCalledTimes(1);
        const [error, user] = done.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Account not activated');
        expect(user).toBeUndefined();
    });

    it('oauthVerify_withAMixedCaseOrPaddedAddress_shouldLookUpAndStoreTheNormalisedAddress', async () => {
        // GIVEN a fresh database and an IdP that reports "  Alice@Example.COM ",
        const db = buildDb({ row: undefined });
        const verify = loadVerify(db);
        axios.get.mockResolvedValue({
            data: { email: '  Alice@Example.COM ', given_name: 'Alice', family_name: 'Anderson' }
        });

        // WHEN the IdP finishes the exchange,
        const done = await runVerify(verify, { email: '  Alice@Example.COM ' });

        // THEN the lookup used the normalised address. SQLite "=" is case-sensitive, so
        //      the raw form could miss the existing row below and mint a second, active
        //      account for the same person - one the admin deactivated in name only.
        expect(db.get.mock.calls[0][1]).toEqual(['alice@example.com']);

        // AND the INSERT stored the normalised address, matching every other write path,
        //      so the account can log in and reset its password afterwards.
        const insertParams = db.run.mock.calls[0][1];
        expect(insertParams).toEqual(['Alice', 'Anderson', 'alice@example.com']);
        expect(done.mock.calls[0][1].email).toBe('alice@example.com');
    });

    it('oauthVerify_shouldSendTheBearerTokenToTheDerivedUserinfoEndpointWithATimeout', async () => {
        // GIVEN a deployment whose IdP is idp.example.org,
        const db = buildDb({ row: undefined });
        const verify = loadVerify(db);
        axios.get.mockResolvedValue({ data: { email: 'alice@example.com' } });

        // WHEN userinfo is fetched,
        await runVerify(verify, { email: 'alice@example.com' });

        // THEN the bearer token goes to that deployment's own issuer - never to a
        //      hardcoded host from somebody else's installation - and a hung IdP cannot
        //      wedge the callback forever.
        expect(axios.get).toHaveBeenCalledTimes(1);
        const [url, options] = axios.get.mock.calls[0];
        expect(url).toBe('https://idp.example.org/application/o/userinfo/');
        expect(options.timeout).toBe(10000);
    });

    it('oauthVerify_withAnExplicitUserinfoUrl_shouldUseItVerbatim', async () => {
        // GIVEN a deployment that set the override,
        const db = buildDb({ row: undefined });
        const verify = loadVerify(db, { AUTHENTIK_USERINFO_URL: 'https://custom-idp.example.net/me' });
        axios.get.mockResolvedValue({ data: { email: 'alice@example.com' } });

        // WHEN userinfo is fetched,
        await runVerify(verify, { email: 'alice@example.com' });

        // THEN the configured URL wins over the derivation.
        expect(axios.get.mock.calls[0][0]).toBe('https://custom-idp.example.net/me');
    });

    it('oauthVerify_withNoEmailFromTheProvider_shouldFailWithoutTouchingTheDatabase', async () => {
        // GIVEN an IdP response with no email address,
        const db = buildDb();
        const verify = loadVerify(db);
        axios.get.mockResolvedValue({ data: {} });

        // WHEN the callback runs,
        const done = await runVerify(verify, {});

        // THEN it says so, and no account lookup or insert is attempted.
        expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(done.mock.calls[0][0].message).toBe('No email provided by authentication provider');
        expect(db.get).not.toHaveBeenCalled();
        expect(db.run).not.toHaveBeenCalled();
    });
});
