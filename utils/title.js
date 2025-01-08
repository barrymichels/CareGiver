/**
 * Get the full page title with optional suffix
 * @param {string} [suffix] - Optional suffix to append to the title
 * @returns {string} The complete page title
 */
function getPageTitle(suffix) {
    const baseTitle = process.env.APP_TITLE || "CareGiver"; // Fallback for safety
    return suffix ? `${suffix} - ${baseTitle}` : baseTitle;
}

module.exports = { getPageTitle }; 