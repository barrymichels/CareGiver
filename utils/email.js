/**
 * Email addresses are stored lower-cased and matched by exact string comparison, so every write
 * and every read must normalise them identically. The two halves of this app used to disagree:
 * registration stored `email.toLowerCase()` without trimming, while password reset trimmed first.
 * An address typed with a trailing space could therefore register, could log in, and could then
 * never reset - the lookup trimmed, found no row, and the masked response hid the reason why.
 */
function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Shape guard for user input, not an RFC 5322 validator. It rejects missing values, the empty
 * string and obvious typos before they cost a database lookup, and deliberately accepts anything
 * merely shaped like an address - whether it exists is the mail server's problem, not ours.
 */
function isWellFormedEmail(value) {
    if (typeof value !== 'string') {
        return false;
    }
    return /^[^\s@]+@[^\s@]+(\.[^\s@]+)+$/.test(value.trim());
}

module.exports = { normalizeEmail, isWellFormedEmail };
