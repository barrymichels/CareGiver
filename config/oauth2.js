const OAuth2Strategy = require('passport-oauth2').Strategy;
const axios = require('axios');

module.exports = function (passport, db) {
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
                const userInfoResponse = await axios.get('https://authentik.barrymichels.com/application/o/userinfo/', {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    }
                });

                const userInfo = userInfoResponse.data;
                if (!userInfo.email) {
                    return done(new Error('No email provided by authentication provider'));
                }

                const user = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM users WHERE email = ?', [userInfo.email], (err, user) => {
                        if (err) reject(err);
                        resolve(user);
                    });
                });

                if (!user) {
                    let firstName = userInfo.given_name || userInfo.preferred_username?.split(' ')[0] || userInfo.email.split('@')[0];
                    let lastName = userInfo.family_name || userInfo.preferred_username?.split(' ').slice(1).join(' ') || 'User';

                    const result = await new Promise((resolve, reject) => {
                        db.run(
                            'INSERT INTO users (first_name, last_name, email, is_active) VALUES (?, ?, ?, 1)',
                            [firstName, lastName, userInfo.email],
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
                        email: userInfo.email,
                        is_active: 1
                    });
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }));
};