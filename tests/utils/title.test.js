const { getPageTitle } = require('../../utils/title');

describe('Title Utility', () => {
    let originalAppTitle;

    beforeEach(() => {
        // Store original APP_TITLE
        originalAppTitle = process.env.APP_TITLE;
    });

    afterEach(() => {
        // Restore original APP_TITLE
        if (originalAppTitle) {
            process.env.APP_TITLE = originalAppTitle;
        } else {
            delete process.env.APP_TITLE;
        }
    });

    it('should return default title when no suffix provided', () => {
        delete process.env.APP_TITLE;
        expect(getPageTitle()).toBe('CareGiver');
    });

    it('should return title with suffix when provided', () => {
        delete process.env.APP_TITLE;
        expect(getPageTitle('Dashboard')).toBe('Dashboard - CareGiver');
    });

    it('should use custom APP_TITLE from environment variable', () => {
        process.env.APP_TITLE = 'CustomApp';
        expect(getPageTitle()).toBe('CustomApp');
    });

    it('should use custom APP_TITLE with suffix', () => {
        process.env.APP_TITLE = 'CustomApp';
        expect(getPageTitle('Profile')).toBe('Profile - CustomApp');
    });
}); 