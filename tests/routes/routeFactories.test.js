const path = require('path');

// Eight of the nine route modules kept `const router = express.Router()` at module scope while
// exporting a factory. Every require() therefore mutated and returned the SAME router, so a
// second caller silently received the first caller's routes - and, in tests, the first caller's
// database. Production is correct only because app.js requires each module exactly once.
//
// This test is the durable version of that lesson: it does not care how a module is written,
// only that two calls hand back two independent routers.

const ROUTE_MODULES = [
    'admin',
    'availability',
    'index',
    'notifications',
    'profile',
    'users',
    'admin/templates',
    'admin/timeslots',
];

function buildFakeDb(label) {
    const noop = () => {};
    return { label, get: noop, all: noop, run: noop, close: noop };
}

function buildFakeNotificationService() {
    return { sendNotification: () => {}, scheduleMorningSummaries: () => {} };
}

describe('route factory isolation', () => {
    it.each(ROUTE_MODULES)('%s: two calls should receive independent routers', (modulePath) => {
        // GIVEN a route module loaded fresh,
        const factory = require(path.join(process.cwd(), 'routes', `${modulePath}.js`));
        expect(typeof factory).toBe('function');

        // WHEN it is built twice, each time against its own database,
        const first = factory(buildFakeDb('first'), buildFakeNotificationService());
        const second = factory(buildFakeDb('second'), buildFakeNotificationService());

        // THEN the callers cannot interfere with each other, and each router really did get the
        //      module's routes rather than arriving empty.
        expect(first).not.toBe(second);
        expect(first.stack.length).toBeGreaterThan(0);
        expect(second.stack.length).toBeGreaterThan(0);
    });

    it('auth: two calls should receive independent routers', () => {
        // GIVEN the auth module, which shares its router instance with nodemailer and passport
        //      state and was the first module found carrying this defect,
        const factory = require(path.join(process.cwd(), 'routes', 'auth.js'));

        // WHEN it is built twice,
        const first = factory(buildFakeDb('first'));
        const second = factory(buildFakeDb('second'));

        // THEN neither caller can register onto the other's router.
        expect(first).not.toBe(second);
        expect(first.stack.length).toBeGreaterThan(0);
    });
});
