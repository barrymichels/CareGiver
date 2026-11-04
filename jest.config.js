module.exports = {
    testEnvironment: 'node',
    verbose: true,
    coverageDirectory: 'coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/test/',
        '/coverage/'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/coverage/'
    ]
}; 