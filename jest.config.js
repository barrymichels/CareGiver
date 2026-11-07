// Legacy fixtures outside the schedule module use the process-local clock.
// Allow explicit UTC runs; calendar regression tests also launch isolated TZ processes.
process.env.TZ = process.env.TZ || 'America/New_York';

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
        'public/sw.js',
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
