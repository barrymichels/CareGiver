/**
 * Per-endpoint rate limiters for the unauthenticated auth routes.
 *
 * The threat this exists for is low-volume password guessing and abuse of the
 * password-reset mailer (Gmail send quota), so the limits are deliberately
 * generous: a whole family behind one NAT address should never notice them.
 *
 * Counting is by client IP, never by submitted email — keying on the email
 * would let an attacker confirm which addresses exist by watching who is
 * currently throttled. `app.set('trust proxy', 1)` in app.js must stay at
 * exactly one hop for req.ip to be the real client; widening it to `true`
 * would let a spoofed X-Forwarded-For pick its own bucket.
 */
const { rateLimit } = require('express-rate-limit');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

const FORGOT_WINDOW_MS = 60 * 60 * 1000;
const FORGOT_MAX = 5;

const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX = 10;

const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a few minutes and try again.';
const TOO_MANY_RESETS = 'Too many password reset requests. Please try again later.';

/**
 * Rollback lever: set RATE_LIMITS=off in the environment to stop the limiters
 * without deploying different code. They are off by default only under test,
 * where the suite drives many logins from one address on purpose.
 *
 * @returns {boolean} whether limiters should be active
 */
function limitsEnabledByDefault() {
    if (process.env.RATE_LIMITS === 'on') {
        return true;
    }
    if (process.env.RATE_LIMITS === 'off') {
        return false;
    }
    return process.env.NODE_ENV !== 'test';
}

function makeLimiter(windowMs, limit, message, { skipSuccessfulRequests = false } = {}) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        skipSuccessfulRequests,
        handler: (req, res) => res.status(429).json({ error: message })
    });
}

const passthrough = (req, res, next) => next();

/**
 * @param {Object} [options]
 * @param {boolean} [options.enabled] - override limitsEnabledByDefault(), for tests
 * @returns {{loginLimiter: Function, forgotPasswordLimiter: Function, resetPasswordLimiter: Function}}
 */
function buildAuthLimiters({ enabled = limitsEnabledByDefault() } = {}) {
    if (!enabled) {
        return {
            loginLimiter: passthrough,
            forgotPasswordLimiter: passthrough,
            resetPasswordLimiter: passthrough
        };
    }

    return {
        // A caregiver signing in normally should not spend the guessing budget, so
        // only refused attempts (401) are counted here.
        loginLimiter: makeLimiter(LOGIN_WINDOW_MS, LOGIN_MAX, TOO_MANY_ATTEMPTS, {
            skipSuccessfulRequests: true
        }),
        // Deliberately NOT skipping successes on the mailer route: a successful
        // forgot-password response is the abusive outcome (it sends mail), so
        // skipping it would let an attacker enumerate addresses and burn the
        // Gmail send quota without ever being limited.
        forgotPasswordLimiter: makeLimiter(FORGOT_WINDOW_MS, FORGOT_MAX, TOO_MANY_RESETS),
        resetPasswordLimiter: makeLimiter(RESET_WINDOW_MS, RESET_MAX, TOO_MANY_ATTEMPTS)
    };
}

module.exports = {
    buildAuthLimiters,
    limitsEnabledByDefault,
    LOGIN_WINDOW_MS,
    LOGIN_MAX,
    FORGOT_WINDOW_MS,
    FORGOT_MAX,
    RESET_WINDOW_MS,
    RESET_MAX
};
