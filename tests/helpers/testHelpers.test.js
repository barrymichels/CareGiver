const bcrypt = require('bcrypt');
const { testDb, initializeTestDb } = require('../../config/test.db');
const { createTestUser, clearTestDb, getUserById } = require('./testHelpers');

describe('Test user fixtures', () => {
    beforeAll(initializeTestDb);
    beforeEach(clearTestDb);
    afterAll(done => { testDb.close(done); });

    it('creates a stored user with defaults and a usable password', async () => {
        const user = await createTestUser();
        expect(await getUserById(user.id)).toMatchObject({
            first_name: 'Test', last_name: 'User', email: user.email,
            is_admin: 0, is_active: 1, password: user.password
        });
        expect(await bcrypt.compare('password123', user.password)).toBe(true);
    });

    it('preserves custom values and hashes the supplied password', async () => {
        const user = await createTestUser({
            first_name: 'Custom', last_name: 'Name', email: 'custom@example.com',
            password: 'custompass', is_admin: 1, is_active: 0
        });
        expect(await getUserById(user.id)).toEqual(user);
        expect(await bcrypt.compare('custompass', user.password)).toBe(true);
    });

    it('creates independent users concurrently', async () => {
        const users = await Promise.all([createTestUser(), createTestUser()]);
        expect(new Set(users.map(user => user.id)).size).toBe(2);
        expect(new Set(users.map(user => user.email)).size).toBe(2);
        for (const user of users) {
            expect(await getUserById(user.id)).toMatchObject(user);
        }
    });

    it('preserves null credentials for virtual users', async () => {
        const user = await createTestUser({ email: null, password: null });
        expect(await getUserById(user.id)).toMatchObject({ email: null, password: null });
    });

    it('rejects a failed insert without preventing subsequent fixtures', async () => {
        await createTestUser({ email: 'duplicate@example.com' });
        await expect(createTestUser({ email: 'duplicate@example.com' })).rejects.toThrow(/UNIQUE/);
        const user = await createTestUser();
        expect(await getUserById(user.id)).toMatchObject(user);
    });
});
