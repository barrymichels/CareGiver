// The app derives week keys and `day_date` strings from the machine's *local*
// calendar (see utils/weekView.js) and is supported only west of UTC - the
// container runs with TZ=America/New_York, and app.js warns at startup when the
// resolved zone lies east of it. The suite is pinned to that supported zone so a
// result stops depending on which hemisphere the contributor happens to sit in:
// unpinned, a reviewer in Tokyo sees failures on a change that breaks nothing,
// while a green run on an unsupported zone proves nothing about what anyone
// deploys. Pinning makes any future drift in either direction visible here.
process.env.TZ = 'America/New_York';

module.exports = {
    testEnvironment: 'node',
    verbose: true,
    coverageDirectory: 'coverage',
    // Name the real sources instead of relying on whatever a test happened to
    // load. Without this, a file no test imports is simply absent from the report,
    // which reads as "clean" and is really "never exercised" - all of public/js,
    // config/oauth2.js and the migrations were invisible that way. Tests are not
    // listed, which is what keeps them out; the negations cover nested installs.
    collectCoverageFrom: [
        'app.js',
        'config/**/*.js',
        '!config/test.db.js',
        'middleware/**/*.js',
        'migrations/**/*.js',
        'public/js/**/*.js',
        'routes/**/*.js',
        'scripts/**/*.js',
        'services/**/*.js',
        'utils/**/*.js',
        '!**/node_modules/**',
        '!**/coverage/**'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/',
        '/coverage/'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/coverage/'
    ]
};
