import dotenv from 'dotenv';
import path from 'path';

/**
 * Loads `.env.${NODE_ENV}` BEFORE any other module of the application is evaluated.
 *
 * `src/app.ts` used to be the one calling `dotenv.config()`, but it does so in its own module
 * body — which runs after every `import` it declares. Anything a constants file reads from
 * `process.env` at module level therefore saw an empty environment and silently kept its default:
 * `pagination.constants.ts` and `rateLimit.constants.ts` are read exactly like that. Importing
 * this module first, before `./routes`, is what makes those reads see the file.
 *
 * `src/database/connection.ts` keeps its own call: it is imported on its own by scripts that never
 * go through `app.ts`.
 */
export const env = process.env.NODE_ENV || 'development';

dotenv.config({
    path: path.resolve(process.cwd(), `.env.${ env }`)
});
