const OAuth2Strategy = require('passport-oauth2').Strategy;
const axios = require('axios');
const { normalizeEmail } = require('../utils/email');

// Where to exchange the fresh bearer token for the user's email address. Every other
// endpoint is already derived from environment configuration, so this one must not be
// frozen to a single machine's installation - otherwise the token gets handed to that
// host no matter what AUTHENTIK_* says. Default to the userinfo path Authentik always
// serves on the same issuer as the token endpoint; a non-standard deployment overrides
// it with AUTHENTIK_USERINFO_URL.
function resolveUserinfoUrl() {
    if (process.env.AUTHENTIK_USERINFO_URL) {
        return process.env.AUTHENTIK_USERINFO_URL;
    }
    return `${new URL(process.env.AUTHENTIK_TOKEN_URL).origin}/application/o/userinfo/`;
}

module.exports = function (passport, db) {
    // Skip OAuth2 setup in test environment or if Authentik login is disabled
    if (process.env.NODE_ENV === 'test' || process.env.ENABLE_AUTHENTIK_LOGIN !== 'true') {
        return;
    }

    // Verify required environment variables
    const requiredEnvVars = [
        'AUTHENTIK_AUTH_URL',
        'AUTHENTIK_TOKEN_URL',
        'AUTHENTIK_CLIENT_ID',
        'AUTHENTIK_CLIENT_SECRET',
        'AUTHENTIK_CALLBACK_URL'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
        console.warn(`OAuth2 configuration skipped. Missing environment variables: ${missingVars.join(', ')}`);
        return;
    }

    const userinfoUrl = resolveUserinfoUrl();

    passport.use('oauth2', new OAuth2Strategy({
        authorizationURL: process.env.AUTHENTIK_AUTH_URL,
        tokenURL: process.env.AUTHENTIK_TOKEN_URL,
        clientID: process.env.AUTHENTIK_CLIENT_ID,
        clientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
        callbackURL: process.env.AUTHENTIK_CALLBACK_URL,
        scope: ['openid', 'email', 'profile'],
        state: true,
        pkce: true,
        passReqToCallback: true
    },
        async function (req, accessToken, refreshToken, params, profile, done) {
            try {
                // The timeout is the difference between a misbehaving IdP failing one
                // login and wedging the callback handler indefinitely.
                const userInfoResponse = await axios.get(userinfoUrl, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                });

                const userInfo = userInfoResponse.data;
                if (!userInfo.email) {
                    return done(new Error('No email provided by authentication provider'));
                }

                // Normalise exactly like the local strategy, registration, and password
                // reset already do - SQLite "=" is case-sensitive, so a raw IdP address
                // would both miss the existing row below and mint a second account.
                const email = normalizeEmail(userInfo.email);

                const user = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
                        if (err) reject(err);
                        resolve(user);
                    });
                });

                if (!user) {
                    let firstName = userInfo.given_name || userInfo.preferred_username?.split(' ')[0] || email.split('@')[0];
                    let lastName = userInfo.family_name || userInfo.preferred_username?.split(' ').slice(1).join(' ') || 'User';

                    const result = await new Promise((resolve, reject) => {
                        db.run(
                            'INSERT INTO users (first_name, last_name, email, is_active) VALUES (?, ?, ?, 1)',
                            [firstName, lastName, email],
                            function (err) {
                                if (err) return reject(err);
                                resolve(this.lastID);
                            }
                        );
                    });

                    return done(null, {
                        id: result,
                        first_name: firstName,
                        last_name: lastName,
                        email: email,
                        is_active: 1
                    });
                }

                // The local strategy refuses deactivated accounts; this path has to
                // refuse them identically. It used to answer done(null, user) for every
                // existing row, so a deactivated admin - denied everywhere isActive
                // guards - could sign back in through /auth/login and mint a fresh,
                // fully privileged session. Same Error as the local strategy, for the
                // same reason: passport must not flatten the cause away.
                if (!user.is_active) {
                    return done(new Error('Account not activated'));
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }));
};