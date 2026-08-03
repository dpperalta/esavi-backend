import './env';
import { setupTestDatabase, closeTestDatabase } from './database';

/**
 * Runs once before the whole suite: recreates the test database from
 * `esaviapp.sql` and seeds the four roles. Jest runs `globalSetup` in its own
 * module registry, so it loads `.env.test` itself and closes the connection it
 * opened — every test file opens its own afterwards.
 */
const globalSetup = async (): Promise<void> => {
    await setupTestDatabase();
    await closeTestDatabase();
}

export default globalSetup;
