/**
 * Smoke test: proves the runner, the TypeScript transform and the `.env.test`
 * setup file are wired correctly. Delete once the real suite is in place.
 */
describe('jest runner', () => {

    it('runs TypeScript tests', () => {
        expect(1 + 1).toBe(2);
    });

    it('loads the test environment', () => {
        expect(process.env.NODE_ENV).toBe('test');
    });

});
