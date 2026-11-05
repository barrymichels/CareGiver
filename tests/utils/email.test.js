const { normalizeEmail, isWellFormedEmail } = require('../../utils/email');

describe('normalizeEmail', () => {
    it.each([
        ['  Member@Example.COM ', 'member@example.com'],
        ['Member@Example.COM', 'member@example.com'],
        ['member@example.com\t', 'member@example.com'],
        ['', ''],
        ['   ', ''],
    ])('normalizeEmail_withInput %p shouldReturn %p', (input, expected) => {
        // GIVEN an address as a human typed it, WHEN it is normalised, THEN only the decoration
        //      that cannot change identity is removed.
        expect(normalizeEmail(input)).toBe(expected);
    });

    it('normalizeEmail_withANonStringShouldReturnAnEmptyStringRatherThanThrow', () => {
        // GIVEN values that arrive when a form field is missing or has been tampered with,
        for (const value of [undefined, null, 42, {}, ['a@b.com']]) {
            // THEN normalising is safe and yields something no row can match, rather than a
            //      TypeError on .trim() - which is exactly how review finding 14 was born.
            expect(normalizeEmail(value)).toBe('');
        }
    });

    it('normalizeEmail_shouldLeaveInternalWhitespaceAloneRatherThanInventADifferentAddress', () => {
        // GIVEN an address with a space in the middle, which is a typo for a different address,
        // WHEN it is normalised,
        const result = normalizeEmail('a b@example.com');

        // THEN the space survives: silently deleting it would turn one address into another.
        expect(result).toBe('a b@example.com');
    });

    it('normalizeEmail_shouldBeIdempotentSoNormalisingTwiceCannotDrift', () => {
        // GIVEN an address normalised once,
        const once = normalizeEmail('  Alice@Example.COM ');

        // THEN a second pass changes nothing, so call sites need no ordering agreement.
        expect(normalizeEmail(once)).toBe(once);
    });
});

describe('isWellFormedEmail', () => {
    it.each([
        'member@example.com',
        'a.b+c@sub.example.co.uk',
        '  member@example.com  ',
    ])('isWellFormedEmail_with %p shouldAcceptIt', (value) => {
        // GIVEN addresses that are awkward but deliverable,
        // THEN the guard lets them through - deliverability is the mail server's judgement.
        expect(isWellFormedEmail(value)).toBe(true);
    });

    it.each([
        '',
        '   ',
        'not-an-email',
        'user@example',
        'user@.com',
        'a@b@c.com',
        'me @example.com',
    ])('isWellFormedEmail_with %p shouldRejectIt', (value) => {
        // GIVEN input that cannot be an address,
        // THEN it is refused before a database lookup is spent on it.
        expect(isWellFormedEmail(value)).toBe(false);
    });

    it.each([undefined, null, 42, {}, ['a@b.com']])(
        'isWellFormedEmail_with %p shouldRejectItWithoutThrowing',
        (value) => {
            // GIVEN a missing or non-string field,
            // THEN the guard answers false instead of throwing.
            expect(isWellFormedEmail(value)).toBe(false);
        }
    );
});
