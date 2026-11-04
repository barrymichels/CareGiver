/**
 * Serialise a value to JSON that is safe to embed inside an inline <script> tag.
 *
 * JSON.stringify does not escape `<`, `>` or `&`, so a string containing `</script>`
 * would close the script element early and let the remainder be parsed as markup.
 * This escapes the characters that enable that breakout, plus the two Unicode line
 * separators (U+2028, U+2029) that are valid inside JSON strings but break JavaScript
 * string literals. The output is still valid JSON and JSON.parse round-trips it to
 * the original value.
 *
 * @param {*} value - The value to serialise
 * @returns {string} JSON string safe for embedding in a <script> tag
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

function escapeJsonForEmbed(value) {
    const json = JSON.stringify(value);
    if (json === undefined) {
        return 'null';
    }
    return json
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .split(LINE_SEPARATOR).join('\\u2028')
        .split(PARAGRAPH_SEPARATOR).join('\\u2029');
}

module.exports = { escapeJsonForEmbed };
