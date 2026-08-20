# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Convenciones de código (norma vinculante)

Antes de escribir o modificar código bajo `src/`, lee **`references/CONVENTIONS.md`**. Define la nomenclatura, los siete artefactos obligatorios por endpoint, el esquema de códigos `ESAVI-*`, la matriz de roles y el contrato de respuesta. Manda sobre cualquier archivo existente que lo contradiga.

Las desviaciones actuales están catalogadas en `references/TECHNICAL_DEBT.md` y no son precedente.

## Specs

Las implementaciones se planifican antes de escribirse. Hay dos series de specs, con numeración independiente:

- **Técnicos** — `references/specs/NN-slug.md`, citados como `SPEC 01`…`SPEC 09`. Reglas transversales del repositorio. Cerrados; no se añaden nuevos aquí.
- **Funcionales** — `references/functional/specs/NN-slug.md`, citados como `SPEC F01` en adelante. Alcance, modelo de datos y requerimientos por endpoint de cada entidad. Empiezan en `01`.

`references/specs/09-healthfacility-crud.md` es el ejemplo canónico de un spec de CRUD completo. Cada spec declara su estado — `Borrador`, `En revisión`, `Aprobado`, `Implementado`, `Obsoleto` — y solo se implementa cuando está `Aprobado`.

Usa `/esavi-spec <tabla>` para redactar el spec de una entidad nueva; el skill vive en `.claude/skills/esavi-spec/`.

**Todo spec que escriba sobre una fila existente declara su contrato de update diferencial.** La escritura la dispara el **cambio real del valor**, nunca la presencia de la clave en el body: sin diferencias no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`. La norma es `references/CONVENTIONS.md` §11 y el helper obligatorio es `buildDifferentialUpdate`. En el spec eso son dos piezas concretas: la tabla de `candidates` campo por campo en §3.5 y el bloque de criterios de aceptación de §5, ambas descritas en `.claude/skills/esavi-spec/template.md`. Las escrituras que **no** son diferenciales —activaciones, traslados, asignaciones masivas— se declaran una a una con su razón.

## Idioma

Responde **siempre en español** en este repositorio. Esto aplica a explicaciones, resúmenes, planes y mensajes de commit. El código, los nombres de identificadores y los comentarios en el código siguen la convención existente del repositorio (inglés).

## Project

REST API for ESAVI (Eventos Supuestamente Atribuibles a la Vacunación e Inmunización) surveillance — Express 5 + TypeScript + Sequelize over PostgreSQL. All routes are mounted under `/api`.

## Commands

```bash
npm run dev         # ts-node-dev with NODE_ENV=development, loads .env.development
npm run build       # tsc -> dist/
npm start           # NODE_ENV=production node dist/index.js, loads .env.production
npm test            # NODE_ENV=test jest --runInBand
npm run lint        # eslint src/ tests/   (--fix via npm run lint:fix)
npm run i18n:check  # node scripts/i18n-check.js — key parity across es/en/nl + spec guards
npm run format      # prettier --write .   (--check via npm run format:check)
npm run check       # build && lint && i18n:check && test — the gate before closing a PR
```

Generate a crypto key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Tests

Jest + ts-jest + supertest, configured in `jest.config.ts`, run serially (`--runInBand`) against `.env.test`. `tests/setup/` holds the shared fixtures: `globalSetup.ts`, `env.ts`, `database.ts` and `auth.ts` (token helpers per role).

Four suites, each enforcing a convention rather than a feature:

- `tests/auth/roles.test.ts` — `ROUTE_RULES` lists every route with its minimum role and operation code; a new endpoint must be added here.
- `tests/contract/response.test.ts` — the `{ ok, message, data }` / `{ ok, message, code, errors }` envelope.
- `tests/contract/<entity>.test.ts` — full CRUD walkthrough per entity (`healthFacility.test.ts` is the reference).
- `tests/i18n/messages.test.ts` — exact key parity across `es`, `en` and `nl`.

## Environment

`src/app.ts` and `src/database/connection.ts` both load `.env.${NODE_ENV}` (`.env.development` / `.env.production` / `.env.test`) from `process.cwd()`, not plain `.env`. See `.env.example` for the full variable list. `connectDatabase()` throws at startup if any `DB_*` variable is missing.

## Database schema

The schema is **not** created by Sequelize — there is no `sequelize.sync()`. `esaviapp.sql` at the repo root is the authoritative DDL: **45 tables** covering auth and system config, catalogs, geography, health facilities, clinical catalogs, patients, ESAVI cases, notifications and investigations. Only **8** of them currently have models in `src/models/` (`catalogType`, `catalogItem`, `appUser`, `appRole`, `appUserRole`, `geoLevelType`, `geoLocation`, `healthFacility`); adding an entity means writing a model that matches the existing SQL table.

Model conventions: `timestamps: false` + `freezeTableName: true`, camelCase table names quoted in SQL (`"catalogItem"`), UUID PKs defaulting to `sequelize.literal('gen_random_uuid()')`, and every table carries `isActive`, `deletedAt`, `sysDetails` (JSONB) and `appDetails` (JSONB array).

Associations live outside the model files, in `src/models/associations/*.ts`, all wired by `initModels()` (called before `connectDatabase()` in `src/index.ts`). Add new associations there, not in the model definition.

## Request pipeline

`routes → middlewares → controller → service → model`

- **Routes** (`src/routes/*.routes.ts`, registered in `src/routes/index.ts`) compose the middleware chain per endpoint:
  `tokenValidation, validateUserRole(ROLE), ...validators, validateFields, handler`
- **Controllers** never touch models. They unwrap `req.params`/`req.query`/`req.body`, call a service, and shape the response.
- **Services** hold all business rules and Sequelize access; they throw `AppError` rather than returning error payloads.

### Response shape

Success: `{ ok: true, message, data }` where `message` always comes from `getMessage(key, req.lang)`. Errors are produced by `errorHandler` (last middleware in `src/app.ts`): `{ ok: false, message, code, errors }` — `errors` is only the real error text when `NODE_ENV=development`, otherwise `'Internal server error'`.

### Operation codes

Every endpoint has a code of the form `ESAVI-<ENTITY>-<NNN><A|B>` (e.g. `ESAVI-CATITEM-002A`). The code appears as a comment on the route, as a comment on the controller and service function, in `esaviLog(...)` messages, in the `AppError` code (`CATITEM_002A_FETCH_FAILED`), and in the `appDetails.method` audit entry. Keep all five in sync when adding or changing an endpoint.

### Controller error idiom

Every controller catch block follows the same pattern — log with the operation code, re-`next()` an existing `AppError` untouched, otherwise wrap in a new `AppError(getMessage(...), status, CODE, error)`.

## Cross-cutting concerns

**Auth** — `tokenValidation` verifies the JWT (payload holds only `userId`) and re-fetches the user with roles from the DB on every request, attaching it to `req.user` (typed in `src/types/express/index.d.ts`).

**Authorization** — two mechanisms. `validateUserRole(...roles)` compares numeric `ROLE_LEVELS` (SUPERADMIN 100 > ADMIN 50 > USER 25 > ANALYTICS 10) from `src/constants/roles.constants.ts`, so passing `USER` admits any higher role. Inside controllers/services, the predicates in `src/helpers/permissions.helper.ts` (`canViewInactive`, `isAdmin`, …) gate behaviour — typically whether inactive rows are visible.

**PII encryption** — `email`, `username`, `firstName`, `lastName`, `displayName` on `appUser` are stored encrypted via `esaviCrypt` (deterministic AES from `crypto.helper.ts`, fixed IV so equality lookups work). Always look users up with `where: { email: esaviCrypt(email) }` and decrypt with `esaviDecrypt` before returning. Passwords use bcrypt separately.

**i18n** — `languageMiddleware` resolves `req.lang` from `?lang=`, then `Accept-Language`, then `DEFAULT_LANGUAGE`, filtered against `SUPPORTED_LANGUAGES`. Messages live in `src/data/i18n/{es,en,nl}.json` and are read by dot-path with `{{param}}` interpolation. Add every new user-facing string to all three files.

**Soft delete / activation** — `DELETE` sets `isActive: false` + `deletedAt` (typically ADMIN), `PATCH /activate/:id` reverses it (typically SUPERADMIN). Both go through the generic `setEntityActiveStatusService` in `src/services/common/entityActivation.service.ts`; use it rather than hand-rolling activation logic.

**Audit trail** — every create/update/activation appends an entry to the row's `appDetails` JSONB array: `{ createdAt, user: authUser.userId, method: <operation code>, detail }`. Services must spread the existing array (`[...currentAppDetails, newEntry]`) so history is preserved.

**Normalization** — helpers in `stringHandling.helper.ts` are applied on write: `toConstantCase` for `code` fields, `toTitleCase` for `name`. Uniqueness checks must compare against the normalized value. Two entities carry their code in camelCase instead of `CONSTANT_CASE`, and are the declared exception (`references/CONVENTIONS.md` §Normalización): `catalogType` and `catalogItem`. In both, `code` is **optional in the body**: when it travels it is normalized with `toCodeFromInput` (idempotent over an already camelCase code), and only when it is absent does the create mint it from the `name` with `toCodeFromName`. On update the code is written exactly when it travels and is **never re-minted from a renamed `name`**. The `catalogItem` import (006) has no `code` column, so there it is always minted from the `name`.

**Logging** — `esaviLog(message, level)` (log4js) writes to `src/logs/esaviLog.log`; morgan writes `access.log` in production and console output in development. The `src/logs` directory is gitignored.

## Barrel files

`helpers/`, `middlewares/`, `validators/`, `models/`, and `types/` each export through an `index.ts`. Import from the barrel (`from '../helpers'`) and register new files there.

## Known state

- `/api/seed/admin` is currently unauthenticated (its auth middleware is commented out in `src/routes/seed.route.ts`); it is gated only by `?enable=` matching `SEED_ACTION`.
- CORS is driven by `CORS_ORIGINS`, resolved in `src/app.ts`; the variable is mandatory when `NODE_ENV=production`.
