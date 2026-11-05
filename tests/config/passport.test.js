const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const configurePassport = require('../../config/passport');

// These tests describe the strategy the application actually registers. They used to describe a
// second, unused copy while app.js registered a looser one of its own, which is how an inactive
// account could authenticate in production while the suite reported the guard as green.

const HASH_ROUNDS = 4; // low for test speed; these hashes never leave this file

function buildPassport() {
    return {
        use: jest.fn(),
        serializeUser: jest.fn(),
        deserializeUser: jest.fn()
    };
}

function buildDb(row, error) {
    return {
        get: jest.fn((sql, params, callback) => {
            if (error) return callback(error);
            callback(null, row);
        })
    };
}

// The verifier is the third argument passport-local hands to the strategy. Reaching for the
// private field is the only way to exercise the policy without booting Express.
function buildVerifier(db) {
    const passport = buildPassport();
    configurePassport(passport, db);
    const strategy = passport.use.mock.calls[0][0];
    return { strategy, verify: strategy._verify };
}

describe('config/passport local strategy', () => {
    let account;

    beforeAll(async () => {
        account = {
            id: 7,
            email: 'member@example.com',
            password: await bcrypt.hash('correct horse battery staple', HASH_ROUNDS),
            is_active: 1
        };
    });

    it('configurePassport_shouldRegisterExactlyOneLocalStrategyKeyedOnEmailAddress', () => {
        // GIVEN the configuration module wired to a throwaway database,
        const passport = buildPassport();

        // WHEN it runs,
        configurePassport(passport, buildDb(account));

        // THEN it is the only local registration and it authenticates on the email field.
        expect(passport.use).toHaveBeenCalledTimes(1);
        expect(passport.use.mock.calls[0][0].name).toBe('local');
        expect(passport.use.mock.calls[0][0]._usernameField).toBe('email');
    });

    it('localStrategy_withACorrectPassword_shouldResolveTheFoundAccount', async () => {
        // GIVEN an active account whose password matches,
        const db = buildDb(account);
        const { verify } = buildVerifier(db);
        const done = jest.fn();

        // WHEN the verifier runs,
        await verify('member@example.com', 'correct horse battery staple', done);

        // THEN authentication succeeds with that account and no error.
        expect(done).toHaveBeenCalledWith(null, account);
    });

    it('localStrategy_withAMixedCaseOrPaddedAddress_shouldLookTheAccountUpInLowerCase', async () => {
        // GIVEN a login typed with stray capitals and spaces,
        const db = buildDb(account);
        const { verify } = buildVerifier(db);

        // WHEN the verifier runs,
        await verify('  Member@Example.COM ', 'correct horse battery staple', jest.fn());

        // THEN the lookup cannot miss the row over presentation noise.
        expect(db.get.mock.calls[0][1]).toEqual(['member@example.com']);
    });

    it('localStrategy_withAnUnknownEmailAndWithAWrongPassword_shouldFailIdentically', async () => {
        // GIVEN two attempts that differ only in whether the address exists,
        const unknownResults = [];
        for (const [row, password] of [[undefined, 'correct horse battery staple'], [account, 'wrong']]) {
            const { verify } = buildVerifier(buildDb(row));
            const done = jest.fn();
            await verify('member@example.com', password, done);
            unknownResults.push(done.mock.calls[0]);
        }

        // THEN neither response reveals which factor failed - otherwise the endpoint can be
        //      probed for who has an account.
        expect(unknownResults[0]).toEqual(unknownResults[1]);
        expect(unknownResults[0]).toEqual([null, false, { message: 'Invalid email or password' }]);
    });

    it('localStrategy_withAnInactiveAccount_shouldFailWithTheAccountNotActivatedError', async () => {
        // GIVEN an account with the right password but not activated - the state this guard
        //      exists for, which the copy in app.js allowed through,
        const { verify } = buildVerifier(buildDb({ ...account, is_active: 0 }));
        const done = jest.fn();

        // WHEN the verifier runs,
        await verify('member@example.com', 'correct horse battery staple', done);

        // THEN it fails with a real Error carrying that message, because routes/auth.js
        //      authenticates with failWithError and turns a plain fail() into a generic
        //      AuthenticationError, which would hide the reason it redirects to /inactive.
        expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(done.mock.calls[0][0].message).toBe('Account not activated');
    });

    it('localStrategy_whenTheDatabaseFails_shouldPassTheErrorThroughUntouched', async () => {
        // GIVEN a lookup that blows up,
        const failure = new Error('database is down');
        const { verify } = buildVerifier(buildDb(undefined, failure));
        const done = jest.fn();

        // WHEN the verifier runs,
        await verify('member@example.com', 'anything', done);

        // THEN the caller sees the original error, not an authentication failure.
        expect(done).toHaveBeenCalledWith(failure);
    });
});

describe('config/passport serialisation', () => {
    it('serializeUser_shouldStoreOnlyTheUserIdInTheSession', () => {
        // GIVEN the configured passport,
        const passport = buildPassport();
        configurePassport(passport, buildDb(undefined));
        const done = jest.fn();

        // WHEN a user is serialised,
        passport.serializeUser.mock.calls[0][0]({ id: 42, password: 'never store this' }, done);

        // THEN the session holds the id alone.
        expect(done).toHaveBeenCalledWith(null, 42);
    });

    it('deserializeUser_withAnUnknownId_shouldReportNoUserRatherThanUndefined', () => {
        // GIVEN a session whose account row has since been deleted,
        const db = buildDb(undefined);
        const passport = buildPassport();
        configurePassport(passport, db);
        const done = jest.fn();

        // WHEN the session is deserialised,
        passport.deserializeUser.mock.calls[0][0](99, done);

        // THEN absence is stated explicitly so nothing downstream treats it as a user object.
        expect(done).toHaveBeenCalledWith(null, false);
    });

    it('deserializeUser_whenTheDatabaseFails_shouldPassTheErrorThroughUntouched', () => {
        // GIVEN a lookup that blows up,
        const failure = new Error('database is down');
        const passport = buildPassport();
        configurePassport(passport, buildDb(undefined, failure));
        const done = jest.fn();

        // WHEN the session is deserialised,
        passport.deserializeUser.mock.calls[0][0](99, done);

        // THEN the error reaches the caller unchanged.
        expect(done).toHaveBeenCalledWith(failure);
    });
});

describe('single-strategy guard', () => {
    it('appJs_shouldDelegatePassportSetupInsteadOfRegisteringASecondLocalStrategy', () => {
        // Reading the source is deliberate. Two registrations of the same strategy name cannot be
        // detected from the outside - whichever registers last wins - so the only reliable
        // tripwire against app.js growing its own copy again is to forbid the pattern.
        const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

        expect(appSource).not.toMatch(/passport\.use\(\s*new LocalStrategy/);
        expect(appSource).toMatch(/require\(['"]\.\/config\/passport['"]\)\(passport, db\)/);
    });
});
