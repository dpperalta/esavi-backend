import dotenv from 'dotenv';
import path from 'path';

/**
 * Loads `.env.test` before any test module is imported, mirroring the
 * `.env.${NODE_ENV}` pattern used by `src/app.ts` and `src/database/connection.ts`.
 * Runs as a Jest `setupFiles` entry, so it executes before the test framework.
 */
process.env.NODE_ENV = 'test';

// `src/app.ts` and `src/database/connection.ts` call dotenv themselves; without
// this the suite output is buried under one banner per imported module.
process.env.DOTENV_CONFIG_QUIET = 'true';

dotenv.config({
    path: path.resolve(process.cwd(), '.env.test'),
    quiet: true
});
