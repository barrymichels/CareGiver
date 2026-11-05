const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { normalizeEmail } = require('../utils/email');

// Single definition of the local strategy and the (de)serialisation the whole app depends on.
// app.js used to register its own inline copy as well; whichever registers last wins for
// passport.authenticate('local'), and app.js's looser copy won - so this file was exercised only
// by tests while a different strategy shipped. Keep exactly one registration here.
//
// An inactive account is rejected with a thrown Error rather than done(null, false, {...})
// because routes/auth.js authenticates with failWithError: true, and passport turns a plain
// fail() into AuthenticationError('Unauthorized') - which would hide the reason the route needs.
module.exports = function(passport, db) {
    passport.use(new LocalStrategy(
        { usernameField: 'email' },
        async (email, password, done) => {
            try {
                const user = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)], (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    });
                });

                if (!user) {
                    return done(null, false, { message: 'Invalid email or password' });
                }

                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    return done(null, false, { message: 'Invalid email or password' });
                }

                if (!user.is_active) {
                    return done(new Error('Account not activated'));
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    ));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser((id, done) => {
        db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
            if (err) return done(err);
            // A session can outlive its row - an admin deletes the account while the user is
            // signed in - so state the absence explicitly instead of handing back undefined.
            if (!user) return done(null, false);
            done(null, user);
        });
    });
}; 