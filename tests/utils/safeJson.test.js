const { escapeJsonForEmbed } = require('../../utils/safeJson');

describe('escapeJsonForEmbed', () => {
    it('prevents a script-element breakout from stored text', () => {
        const hostile = '</script><script>alert(document.cookie)</script>';
        const out = escapeJsonForEmbed({ label: hostile });

        expect(out).not.toContain('</script>');
        expect(out).not.toContain('<script>');
    });

    it('escapes angle brackets and ampersands as unicode escapes', () => {
        // The result is a JSON string, so it keeps its surrounding quotes.
        expect(escapeJsonForEmbed('<a>&b')).toBe('"\\u003ca\\u003e\\u0026b"');
    });

    it('escapes the Unicode line separators that break JS string literals', () => {
        const LS = String.fromCharCode(0x2028);
        const PS = String.fromCharCode(0x2029);
        const out = escapeJsonForEmbed({ a: `x${LS}y${PS}z` });

        expect(out).not.toContain(LS);
        expect(out).not.toContain(PS);
    });

    it('still produces JSON that round-trips to the original value', () => {
        const value = {
            timeslots: [
                [{ time: '8:00am', label: '</script><script>alert(1)</script>' }],
                [{ time: '9:00am', label: 'Normal & fine' }]
            ],
            count: 2,
            flag: true,
            nothing: null
        };
        const out = escapeJsonForEmbed(value);

        expect(() => JSON.parse(out)).not.toThrow();
        expect(JSON.parse(out)).toEqual(value);
    });

    it('renders undefined as null so the surrounding statement stays valid', () => {
        expect(escapeJsonForEmbed(undefined)).toBe('null');
        expect(escapeJsonForEmbed(() => {})).toBe('null');
    });
});
