# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Responde **siempre en español** en este repositorio. Esto aplica a explicaciones, resúmenes, planes y mensajes de commit. El código, los nombres de identificadores y los comentarios en el código siguen la convención existente del repositorio (inglés).

## Project

REST API for ESAVI (Eventos Supuestamente Atribuibles a la Vacunación e Inmunización) surveillance — Express 5 + TypeScript + Sequelize over PostgreSQL. All routes are mounted under `/api`.

## Commands

```bash
npm run dev      # ts-node-dev with NODE_ENV=development, loads .env.development
npm run build    # tsc -> dist/
npm start        # NODE_ENV=production node dist/index.js, loads .env.production
```

No test suite is configured (`npm test` exits 1). No linter is configured.

Generate a crypto key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Environment

`src/index.ts` and `src/database/connection.ts` both load `.env.${NODE_ENV}` (`.env.development` / `.env.production`) from `process.cwd()`, not plain `.env`. See `.env.example` for the full variable list. `connectDatabase()` throws at startup if any `DB_*` variable is missing.

## Database schema

The schema is **not** created by Sequelize — there is no `sequelize.sync()`. `esaviapp.sql` at the repo root is the authoritative DDL (~40 tables: auth, catalogs, geography, health facilities, patients, ESAVI cases, notifications). Only a subset of those tables currently has models in `src/models/`; adding an entity means writing a model that matches the existing SQL table.

Model conventions: `timestamps: false` + `freezeTableName: true`, camelCase table names quoted in SQL (`"catalogItem"`), UUID PKs defaulting to `sequelize.literal('gen_random_uuid()')`, and every table carries `isActive`, `deletedAt`, `sysDetails` (JSONB) and `appDetails` (JSONB array).

Associations live outside the model files, in `src/models/associations/*.ts`, all wired by `initModels()` (called before `connectDatabase()` in `src/index.ts`). Add new associations there, not in the model definition.

## Request pipeline

`routes → middlewares → controller → service → model`

- **Routes** (`src/routes/*.routes.ts`, registered in `src/routes/index.ts`) compose the middleware chain per endpoint:
  `tokenValidation, validateUserRole(ROLE), ...validators, validateFields, handler`
- **Controllers** never touch models. They unwrap `req.params`/`req.query`/`req.body`, call a service, and shape the response.
- **Services** hold all business rules and Sequelize access; they throw `AppError` rather than returning error payloads.

### Response shape

Success: `{ ok: true, message, data }` where `message` always comes from `getMessage(key, req.lang)`. Errors are produced by `errorHandler` (last middleware in `src/index.ts`): `{ ok: false, message, code, errors }` — `errors` is only the real error text when `NODE_ENV=development`, otherwise `'Internal server error'`.

### Operation codes

Every endpoint has a code of the form `ESAVI-<ENTITY>-<NNN><A|B>` (e.g. `ESAVI-CATITEM-002A`). The code appears as a comment on the route, as a comment on the controller and service function, in `esaviLog(...)` messages, in the `AppError` code (`CATITEM_002A_FETCH_FAILED`), and in the `appDetails.method` audit entry. Keep all five in sync when adding or changing an endpoint.

### Controller error idiom

Every controller catch block follows the same pattern — log with the operation code, re-`next()` an existing `AppError` untouched, otherwise wrap in a new `AppError(getMessage(...), status, CODE, error)`.

## Cross-cutting concerns

**Auth** — `tokenValidation` verifies the JWT (payload holds only `userId`) and re-fetches the user with roles from the DB on every request, attaching it to `req.user` (typed in `src/types/express/index.d.ts`).

**Authorization** — two mechanisms. `validateUserRole(...roles)` compares numeric `ROLE_LEVELS` (SUPERADMIN 100 > ADMIN 50 > USER 25 > ANALYTICS 10) from `src/constants/roles.constants.ts`, so passing `USER` admits any higher role. Inside controllers/services, the predicates in `src/helpers/permissions.helper.ts` (`canViewInactive`, `isAdmin`, …) gate behaviour — typically whether inactive rows are visible.

**PII encryption** — `email`, `username`, `firstName`, `lastName`, `displayName` on `appUser` are stored encrypted via `esaviCrypt` (deterministic AES from `crypto.helper.ts`, fixed IV so equality lookups work). Always look users up with `where: { email: esaviCrypt(email) }` and decrypt with `esaviDecrypt` before returning. Passwords use bcrypt separately.

**i18n** — `languageMiddleware` resolves `req.lang` from `?lang=`, then `Accept-Language`, then `DEFAULT_LANGUAGE`, filtered against `SUPPORTED_LANGUAGES`. Messages live in `src/data/i18n/{es,en,nd}.json` and are read by dot-path with `{{param}}` interpolation. Add every new user-facing string to all three files.

**Soft delete / activation** — `DELETE` sets `isActive: false` + `deletedAt` (typically ADMIN), `PATCH /activate/:id` reverses it (typically SUPERADMIN). Both go through the generic `setEntityActiveStatusService` in `src/services/common/entityActivation.service.ts`; use it rather than hand-rolling activation logic.

**Audit trail** — every create/update/activation appends an entry to the row's `appDetails` JSONB array: `{ createdAt, user: authUser.userId, method: <operation code>, detail }`. Services must spread the existing array (`[...currentAppDetails, newEntry]`) so history is preserved.

**Normalization** — helpers in `stringHandling.helper.ts` are applied on write: `toConstantCase` for `code` fields, `toTitleCase` for `name`. Uniqueness checks must compare against the normalized value.

**Logging** — `esaviLog(message, level)` (log4js) writes to `src/logs/esaviLog.log`; morgan writes `access.log` in production and console output in development. The `src/logs` directory is gitignored.

## Barrel files

`helpers/`, `middlewares/`, `validators/`, `models/`, and `types/` each export through an `index.ts`. Import from the barrel (`from '../helpers'`) and register new files there.

## Known state

- `/api/seed/admin` is currently unauthenticated (its auth middleware is commented out in `src/routes/seed.route.ts`); it is gated only by `?enable=` matching `SEED_ACTION`.
- `cors()` is wide open — flagged with a TODO in `src/index.ts` for production hardening.
