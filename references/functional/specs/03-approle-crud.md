# SPEC F03 — CRUD de appRole

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Relacionado con:** SPEC F02 (`appUserRole`), que difiere aquí el CRUD de roles y cuya guarda de escalada se apoya en la columna `level` que este spec pasa a gobernar
> **Fecha:** 2026-08-05
> **Objetivo:** Dar superficie HTTP a `appRole` — crear, consultar, editar y retirar roles — y hacer que un rol creado por la API autorice de verdad, sustituyendo la constante `ROLE_LEVELS` por la columna `level` en el cálculo del nivel del solicitante.

---

## 1. Por qué existe este spec

`appRole` define qué niveles de autoridad existen en el sistema. La tabla está en `esaviapp.sql:265-280`, tiene modelo en `src/models/appRole.model.ts` y sus cuatro asociaciones están declaradas en `src/models/associations/auth.associations.ts:10-11,16-17`. Le faltan **cinco de los siete artefactos**: tipos, servicio, controlador y ruta no existen, y el validador que sí existe (`src/validators/appRole.validator.ts`) no está enganchado a ninguna ruta.

Hoy un rol solo nace en un sitio: `src/controllers/seed.controller.ts:27` y `:85`, con dos `findOrCreate` que crean SUPERADMIN y USER al arrancar. **No hay forma de crear, editar, listar ni retirar un rol por la API.** Corregir la descripción de un rol, dar de alta un perfil nuevo o retirar uno obsoleto exigen SQL directo contra producción.

Tres desajustes verificados que este spec resuelve:

**A — La columna `level` no la lee nadie.** `src/middlewares/roleValidation.middleware.ts:11-17` calcula el nivel del solicitante como `ROLE_LEVELS[role.name.toUpperCase()]`, la constante fija de cuatro claves de `src/constants/roles.constants.ts`. `src/middlewares/tokenValidation.middleware.ts:58-61` ya trae `level` desde la base de datos y lo deja en `req.user.roles[].level`, donde **nadie lo consulta**. La consecuencia es que un rol creado por la API con `level: 60` resuelve a `0` y no autoriza nada: sería una fila decorativa. Un CRUD de roles sin este arreglo entrega un endpoint que promete lo que no cumple, y por eso el arreglo **entra en este spec**.

**B — `code` y `name` apuntan a sitios distintos.** El seed guarda `code: 'SAD'` con `name: 'SUPERADMIN'` (`:30-31`) y `code: 'USR'` con `name: 'USER'` (`:88-89`). Mientras tanto, `roleValidation.middleware.ts:14` compara por `name`, `src/helpers/permissions.helper.ts:10` compara por `name`, y la guarda del último SUPERADMIN de SPEC F02 §3.5 compara `appRole.code` contra `ROLES.SUPERADMIN` — es decir, contra `'SUPERADMIN'`, que **no es el `code` de ninguna fila**. Esa guarda, tal como está especificada, no dispararía nunca con los datos actuales. `UQ_appRole_code` protege el `code`; `name`, que es lo que el código realmente usa, no tiene ninguna restricción de unicidad.

**C — Residuos en los artefactos que sí existen.** `appRole.model.ts:37-40` declara `description` con `allowNull: false` donde `esaviapp.sql:269` lo permite nulo. El validador existente exige `isSystemRole` en el cuerpo —un campo que este spec decide no aceptar—, no valida `level` en absoluto, no impone límites de longitud sobre `code` (100) ni `name` (200), y no tiene hermanos de `id`, de listado ni de update, que §4 declara obligatorios. Y `isSystemRole`, la única marca que distingue un rol del sistema de uno creado a mano, hoy no la lee ninguna línea de código.

---

## 2. Alcance

**Dentro:**

- Los **cinco artefactos que faltan** de `appRole`: tipos, validadores, servicio, controlador y ruta. El modelo y las asociaciones ya existen y solo reciben un ajuste menor.
- Las **siete operaciones canónicas**, todas dentro del rango `001`–`005B`: `001` crear, `002A` listar, `002B` listar para administración, `003` obtener por ID, `004` actualizar, `005A` retirar y `005B` reactivar. Esta entidad **no** necesita operaciones no canónicas: no se extiende más allá de `005B`.
- **Arreglo de `src/middlewares/roleValidation.middleware.ts`:** el nivel del solicitante pasa a leerse de `role.level` —que `tokenValidation` ya puebla desde la base— con `ROLE_LEVELS[name]` como respaldo si viniera nulo. El nivel **requerido** por la ruta se sigue leyendo de `ROLE_LEVELS`: es un literal de la ruta, no un dato.
- **Alineación de `code` con `name` en `src/controllers/seed.controller.ts`:** `'SAD'` → `'SUPERADMIN'` y `'USR'` → `'USER'`. El seed usa `findOrCreate` con `where: { name }`, así que el cambio solo afecta a instalaciones nuevas; para las ya desplegadas el spec deja escrita la sentencia `UPDATE` a ejecutar a mano.
- **Normalización con `toConstantCase` en `code` y en `name`.** `name` no es una etiqueta de presentación en esta tabla: es la clave contra la que comparan `roleValidation.middleware.ts:14` y los siete predicados de `permissions.helper.ts`.
- **Unicidad global de `code`**, la que impone `UQ_appRole_code`, comparada contra el valor normalizado y excluyendo el propio registro en update con `[Op.ne]`. **Y unicidad de `name` a nivel de aplicación**, que el DDL no impone: dos roles activos con el mismo `name` harían indeterminado qué nivel autoriza.
- **Guarda de escalada, 403:** `001` y `004` rechazan un `level` mayor que el nivel máximo del solicitante.
- **Guarda de rol de sistema, 403:** `004`, `005A` y `005B` sobre un rol con `isSystemRole: true` exigen SUPERADMIN. La comprobación va en el **servicio**, no en la ruta, porque depende del registro y no del umbral de la ruta.
- **`isSystemRole` no se acepta en el cuerpo** de `001` ni de `004`: llega como 400. Todo rol creado por la API nace `false`; marcar uno como de sistema se hace por seed o por SQL.
- **Guardas de `005A`:** 409 si el rol tiene asignaciones activas en `appUserRole`, y 409 si el rol es SUPERADMIN, siempre.
- `appDetails` recibe `defaultValue: []` en el modelo, como `geoLocation.model.ts:114`. El DDL trae `'{}'`, que no es un array.
- Alta de la abreviatura `APPROLE` en la tabla de `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `src/data/i18n/es.json`, `en.json` y `nl.json`.
- Siete filas nuevas en `ROUTE_RULES` (43 → 50) y suite `tests/contract/appRole.test.ts`.

**Fuera de alcance (otros specs):**

- **`appPermission`, `appRolePermission` y `getUserPermissions`.** El esquema modela permisos finos y el DDL los resuelve en una función almacenada; nada de eso está expuesto ni lo expone este spec. Un rol aquí es un `level` y un nombre, no un conjunto de permisos.
- **Eliminar `ROLE_LEVELS`.** Sigue siendo la fuente del nivel requerido en cada ruta y el respaldo del nivel del usuario. Sustituirlo del todo obligaría a que cada ruta declarase un número, o a consultar la base de datos por cada petición para traducir un nombre de rol a un nivel.
- **Unificar el criterio `code` frente a `name` en `permissions.helper.ts`.** Los siete predicados siguen comparando por `name`; la alineación `code = name` hace que la incoherencia deje de tener efecto práctico, pero el helper no se toca.
- **CRUD de `appUserRole`.** Es SPEC F02. Este spec no asigna roles a usuarios: los define.
- **Migrar la asignación de roles de `createUserService`.** Sigue escribiendo en `appUserRole` dentro de su propia transacción.
- **Cambiar el DDL.** No se añade `UNIQUE ("name")` ni se toca el `DEFAULT 1` de `level`. La unicidad de `name` se impone en la aplicación y el riesgo residual queda anotado en §7.
- **Migración de datos de despliegues existentes** más allá de la sentencia documentada para los dos roles del seed.
- **Hacer `isSystemRole` editable por API**, en cualquier operación y para cualquier rol.
- **Jerarquía o herencia entre roles.** El modelo es plano: un `level` entero y nada más.
- **Vigencia temporal de un rol.** La tabla no tiene `validFrom`/`validTo` y no se añaden.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`appRole` — `esaviapp.sql:265-280`. La tabla ya existe y **no se altera**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `roleId` | `uuid` | no | PK, `gen_random_uuid()` |
| `code` | `varchar(100)` | no | `UQ_appRole_code` — unicidad global |
| `name` | `varchar(200)` | no | **sin** restricción de unicidad en el DDL |
| `description` | `text` | sí | el modelo lo exige; ver §3.2 |
| `level` | `integer` | no | default `1`, `CHECK ("level" >= 0)` |
| `isSystemRole` | `bool` | no | default `false` — nunca escrito por la API |
| `isActive` | `bool` | no | default `true` |
| `createdAt` | `timestamptz` | no | default `current_timestamp` |
| `updatedAt` | `timestamptz` | sí | |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | default `'{}'` — lo escribe el trigger |
| `appDetails` | `jsonb` | no | default `'{}'` — el servicio escribe **array** |

**Restricciones:** `UQ_appRole_code` sobre `("code")`, y el `CHECK ("level" >= 0)` inline. No hay `CHECK` sobre `name` ni sobre `isSystemRole`.

**Índices:** `IX_appRole_active` sobre `("isActive") WHERE "deletedAt" IS NULL`.

**Triggers:** `TRG_appRole_setSysDetails`, del bloque genérico de `esaviapp.sql:1276-1294` sobre toda tabla con columna `sysDetails`; y `TRG_appRole_preventPhysicalDelete`, del bloque de `esaviapp.sql:1360-1375`. El servicio **nunca** escribe `sysDetails` y **nunca** borra físicamente.

**Tabla relacionada que se consulta pero no se modifica:** `appUserRole` — `esaviapp.sql:300-322`, con FK `roleId` → `appRole("roleId")` `ON DELETE RESTRICT`. Se consulta en `003` para contar portadores y en `005A` para bloquear la retirada.

### 3.2 Modelo Sequelize

`src/models/appRole.model.ts` **ya existe**, clase `AppRole`, dada de alta en `src/models/index.ts`. Cumple §12: `timestamps: false`, `freezeTableName: true`, `tableName: 'appRole'`, PK UUID con `sequelize.literal('gen_random_uuid()')`.

Un solo ajuste:

| Antes | Después |
|---|---|
| `appDetails: { type: JSONB, allowNull: true }` | `defaultValue: []`, como `geoLocation.model.ts:114` |

Y dos cosas que **no** cambian, deliberadamente:

- **`description` se queda en `allowNull: false`**, más estricto que el `text` nulable del DDL. Es la decisión tomada: un rol sin descripción no se distingue de otro cuando alguien tiene que elegir uno en una pantalla de alta de usuario. La aplicación puede ser más estricta que el esquema; al revés no.
- **`level` no recibe `defaultValue`.** El validador lo exige en `001`, así que el `DEFAULT 1` del DDL solo se aplica a escrituras por SQL directo. Poner el default también en el modelo escondería un `level` olvidado detrás de un `1` silencioso.

**Asociaciones — no se añade ninguna.** Las cuatro que hacen falta ya están en `src/models/associations/auth.associations.ts`:

| Asociación | Alias | Línea |
|---|---|---|
| `AppRole.hasMany(AppUserRole)` | `roleUsers` | `:10` |
| `AppUserRole.belongsTo(AppRole)` | `role` | `:11` |
| `AppUser.belongsToMany(AppRole, through: AppUserRole)` | `roles` | `:16` |
| `AppRole.belongsToMany(AppUser, through: AppUserRole)` | `users` | `:17` |

La de `:16` es la que consume `tokenValidation` para poblar `req.user.roles[].level`, que este spec pasa a usar de verdad.

### 3.3 Tipos

Archivo nuevo `src/types/user/appRole.types.ts`, exportado desde el barrel existente `src/types/user/index.ts` — que hoy reexporta `./user.types` y `./appUserGeoLocation.types`. No hace falta tocar `src/types/index.ts`.

```ts
export interface CreateAppRoleInput {
    code: string;
    name: string;
    description: string;
    level: number;
}
```

Tres ausencias deliberadas:

- **`isSystemRole` no aparece.** No se acepta en el cuerpo de ninguna operación; el validador lo rechaza con 400.
- **`isActive` no aparece.** Es territorio de `005A`/`005B`.
- **`roleId` no aparece.** Lo genera la base de datos.

**No se declara `UpdateAppRoleInput`** — está prohibido por §4. El update usa `Partial<CreateAppRoleInput>`.

### 3.4 Superficie HTTP

```
POST   /api/roles                 ESAVI-APPROLE-001   ADMIN       (nuevo)
GET    /api/roles                 ESAVI-APPROLE-002A  USER        (nuevo)
GET    /api/roles/admin           ESAVI-APPROLE-002B  ADMIN       (nuevo)
GET    /api/roles/:id             ESAVI-APPROLE-003   USER        (nuevo)
PUT    /api/roles/:id             ESAVI-APPROLE-004   ADMIN       (nuevo)
DELETE /api/roles/:id             ESAVI-APPROLE-005A  ADMIN       (nuevo)
PATCH  /api/roles/activate/:id    ESAVI-APPROLE-005B  SUPERADMIN  (nuevo)
```

Alta del router en `src/routes/index.ts` bajo el prefijo `/roles`.

Las siete operaciones caben en el rango canónico: **esta entidad no registra ninguna operación a partir de `006`**. El listado es dual **con dos rutas** (`/` y `/admin`), como `catalogItem`, así que cada ruta lleva su propia letra según §6 — no es el caso de bifurcación en el controlador.

**Orden de declaración en `appRole.routes.ts`:** las rutas literales `/admin` y `/activate/:id` van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

### 3.5 Reglas de negocio por operación

**Nivel del solicitante.** `Math.max(0, ...authUser.roles.map(r => r.level ?? 0))`, tomado de `req.user`. Es el mismo valor que calcula `validateUserRole` tras el arreglo, y el mismo que usa la guarda de escalada de SPEC F02 §3.5.

**Guarda de escalada — `001` y `004`.** Si el `level` pedido es **mayor** que el nivel del solicitante → **403** `APPROLE_001_LEVEL_EXCEEDED` / `APPROLE_004_LEVEL_EXCEEDED`, clave `appRole.levelExceeded`. Un ADMIN (50) puede crear roles de nivel ≤ 50; nunca de 100. Igual que en F02, es un fallo de autorización y responde 403 aunque §10 atribuya ese status a `validateUserRole`: la regla depende del cuerpo de la petición, no del umbral de la ruta, y §9 manda resolverla en el servicio.

**Guarda de rol de sistema — `004` y `005A`.** Si el rol tiene `isSystemRole: true` y `isSuperAdmin(authUser)` es falso → **403** `APPROLE_004_SYSTEM_ROLE` / `APPROLE_005A_SYSTEM_ROLE`, clave `appRole.systemRole`. **En `005B` la guarda no se escribe**: la ruta ya exige SUPERADMIN, así que sería código muerto. Es el único predicado de `permissions.helper.ts` que este spec invoca, y modula comportamiento dentro de un endpoint ya autorizado, que es exactamente su cometido según §9.

**`ESAVI-APPROLE-001` — crear.** En este orden:

1. Normaliza: `code` y `name` con `toConstantCase`, `description` con `.trim()`.
2. Guarda de escalada sobre `level` → 403.
3. `code` libre → si no, **409** `APPROLE_001_CODE_EXISTS`, clave `appRole.codeExists` con `{{code}}`. La comprobación **no filtra por `isActive`**: es lo que garantiza `UQ_appRole_code`, y filtrar dejaría pasar valores que Postgres rechaza con `23505` (§11).
4. `name` libre → si no, **409** `APPROLE_001_NAME_EXISTS`, clave `appRole.nameExists` con `{{name}}`. Tampoco filtra por `isActive`, por simetría con `code`.
5. Inserta con `isSystemRole: false` **explícito** e `isActive: true`, y una entrada en `appDetails` con `method: 'ESAVI-APPROLE-001'`. Responde **201**.

Enviar `isSystemRole`, `isActive` o `roleId` en el cuerpo devuelve **400**, lo emite el validador.

**`ESAVI-APPROLE-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, orden `[['level', 'DESC'], ['name', 'ASC']]` y paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Sin filtros por query más allá de `limit` y `offset`. Rol mínimo USER: cualquier usuario autenticado necesita poder leer la lista de roles para una pantalla de alta.

**`ESAVI-APPROLE-002B` — listar, administración.** Idéntico, **sin `isActive` en el `where`**: devuelve también los retirados. Mismo orden, misma paginación. Rol mínimo ADMIN.

**`ESAVI-APPROLE-003` — obtener por ID.** Existencia → **404** `APPROLE_003_NOT_FOUND`. Un rol retirado devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — hoy **SUPERADMIN**, según `permissions.helper.ts:24-26`. Añade `activeUserCount`, el recuento de `appUserRole` con `{ roleId: id, isActive: true }`: es el dato que dice si el rol se puede retirar antes de intentarlo.

**`ESAVI-APPROLE-004` — actualizar.** En este orden:

1. Existencia → **404** `APPROLE_004_NOT_FOUND`.
2. Guarda de rol de sistema → **403**.
3. Si viene `level`, guarda de escalada → **403**.
4. Si viene `code`, normalizado y distinto del actual: unicidad excluyendo el propio id con `{ [Op.ne]: id }` → **409** `APPROLE_004_CODE_EXISTS`.
5. Si viene `name`, normalizado y distinto del actual: misma comprobación → **409** `APPROLE_004_NAME_EXISTS`.
6. Actualiza con el patrón `objectToUpdate` del repositorio y preserva el historial con `[...currentAppDetails, newEntry]`.

`isSystemRole` e `isActive` en el cuerpo devuelven **400**.

**Bajar el `level` de un rol con portadores les quita autoridad en su siguiente petición**, sin que ninguna guarda lo impida. Es la consecuencia buscada de la decisión de que el `level` de la base es la fuente de la verdad, y queda anotada en §7, no bloqueada: un `level` mal tecleado tiene que poder corregirse.

**`ESAVI-APPROLE-005A` — retirar.** Antes de delegar, tres guardas en este orden:

1. Guarda de rol de sistema → **403** `APPROLE_005A_SYSTEM_ROLE`.
2. Si el `code` del rol es igual a `ROLES.SUPERADMIN` → **409** `APPROLE_005A_SUPERADMIN_ROLE`, clave `appRole.superAdminRole`. Retirar el rol SUPERADMIN dejaría el sistema sin nadie capaz de ejecutar `005B`, que exige precisamente ese rol. La comparación es por `code` y funciona porque este spec alinea `code` con `name` en el seed.
3. Recuento de `appUserRole` con `{ roleId: id, isActive: true }`; si es mayor que cero → **409** `APPROLE_005A_HAS_ACTIVE_ASSIGNMENTS`, clave `appRole.hasActiveAssignments` con `{{count}}`. Es el equivalente al `hasActiveChildren` de HFAC: obliga a revocar las asignaciones antes de retirar el rol, en vez de dejar usuarios apuntando a un rol inactivo.

Después delega en `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`) con transacción, igual que `setCatalogItemActivationService`. Escribe `isActive: false` y `deletedAt: now()`. Doble retirada → **409** `APPROLE_005A_ALREADY_INACTIVE`.

**`ESAVI-APPROLE-005B` — reactivar.** Revierte los dos campos: `isActive: true`, `deletedAt: null`. Antes comprueba que ni el `code` ni el `name` del rol estén ocupados por **otro rol activo** → **409** `APPROLE_005B_CODE_EXISTS` / `APPROLE_005B_NAME_EXISTS`. Doble reactivación → **409** `APPROLE_005B_ALREADY_ACTIVE`. `appDetails.method` guarda `'ESAVI-APPROLE-005B'`, nunca con sufijo `_ACTIVATION` (§6).

**Arreglo de `roleValidation.middleware.ts`.** El cálculo del nivel del usuario (`:11-17`) pasa de leer la constante a leer la columna, con la constante como respaldo:

| Antes | Después |
|---|---|
| `ROLE_LEVELS[role.name.toUpperCase()] \|\| 0` | `role.level ?? ROLE_LEVELS[role.name.toUpperCase()] ?? 0` |

El nivel **requerido** (`:8-10`) **no cambia**: se sigue leyendo de `ROLE_LEVELS` a partir del literal de la ruta. El respaldo por `name` cubre el caso de un `level` nulo en base de datos y hace que el cambio no rompa ningún despliegue existente. Ninguna ruta se toca.

**Alineación de `code` en el seed.** `seed.controller.ts:30` pasa de `'SAD'` a `'SUPERADMIN'` y `:88` de `'USR'` a `'USER'`. Como el `findOrCreate` busca por `where: { name }`, las filas ya existentes no se actualizan solas; para los despliegues en curso el spec deja la sentencia:

```sql
UPDATE "appRole" SET "code" = 'SUPERADMIN' WHERE "code" = 'SAD';
UPDATE "appRole" SET "code" = 'USER'       WHERE "code" = 'USR';
```

Se ejecuta a mano, con respaldo previo, y **no** la ejecuta ningún código de la aplicación.

### 3.6 Claves i18n nuevas

Bloque `appRole` nuevo en `src/data/i18n/es.json`, `en.json` y `nl.json`. El bloque `role` existente (`es.json:42-44`, con `role.notFound`) **no se toca**: lo consumen `user.service.ts` y SPEC F02.

| Clave | Uso |
|---|---|
| `appRole.createdSuccess` / `createdFailed` | `001` |
| `appRole.getSuccess` / `getFailed` | `003` |
| `appRole.getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `appRole.updatedSuccess` / `updatedFailed` | `004` |
| `appRole.deletedSuccess` / `deletedFailed` | `005A` |
| `appRole.activatedSuccess` / `activatedFailed` | `005B` |
| `appRole.notFound` | 404 de rol inexistente |
| `appRole.idRequired` | parámetro ausente |
| `appRole.codeExists` | 409 de `code` duplicado, con `{{code}}` |
| `appRole.nameExists` | 409 de `name` duplicado, con `{{name}}` |
| `appRole.levelExceeded` | 403 al crear o editar un rol de nivel superior al propio |
| `appRole.systemRole` | 403 al editar o retirar un rol de sistema sin ser SUPERADMIN |
| `appRole.superAdminRole` | 409 al retirar el rol SUPERADMIN |
| `appRole.hasActiveAssignments` | 409 al retirar un rol con portadores, con `{{count}}` |
| `appRole.alreadyActive` | 409 al reactivar un rol ya activo |
| `appRole.alreadyInactive` | 409 al retirar un rol ya retirado |

Veintidós claves. `tests/i18n/messages.test.ts` exige paridad exacta: las veintidós van en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`sysDetails` **nunca se devuelve**: los servicios de lectura lo excluyen con `attributes: { exclude: ['sysDetails'] }`. Es metadato del trigger, no del dominio.

**`003` — getById:**

```
{ ok, message, data: {
    roleId, code, name, description, level, isSystemRole, isActive,
    createdAt, updatedAt, deletedAt, appDetails,
    activeUserCount
} }
```

**`002A` / `002B` — listados:** `data` es `{ count, rows }` tal cual lo devuelve `findAndCountAll` (§11). Cada fila lleva las mismas claves **menos `activeUserCount`**: un recuento por fila sería una consulta por fila.

```
{ ok, message, data: {
    count,
    rows: [ { roleId, code, name, description, level, isSystemRole,
              isActive, createdAt, updatedAt, deletedAt, appDetails } ]
} }
```

**`001` y `004`:** la fila creada o actualizada, con la misma forma que una fila de listado. Sin `activeUserCount`.

**`005A`, `005B`:** `{ ok, message }` **sin `data`**, según §10.

Ningún campo se cifra ni se descifra: la tabla no contiene PII, y los roles que aparecen dentro de las respuestas de `appUser` los gobierna SPEC F02, no éste.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo. Los pasos 1 a 5 construyen la base sin exponer nada; del 6 al 11 cada paso añade una operación. Los dos cambios que tocan código ya en producción —la alineación del seed y el arreglo de `roleValidation`— van **aislados en sus propios pasos**, el segundo al final, cuando ya existe un CRUD con el que verificarlo de verdad.

1. **Registrar la abreviatura.** Añadir la fila `appRole` → `APPROLE` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6. No se añade ninguna fila a la tabla de operaciones no canónicas: esta entidad no pasa de `005B`.
   *Verificación:* `APPROLE` aparece una sola vez en la tabla y no colisiona con `USER`, `USERGEO` ni `USERROLE`.

2. **Ajustar el modelo.** En `src/models/appRole.model.ts`, `appDetails` con `defaultValue: []`. `description` se queda en `allowNull: false` y `level` sigue sin `defaultValue`, por las razones de §3.2. No se toca ninguna asociación.
   *Verificación:* `npm run build` en 0; un `AppRole.create({ code, name, description, level })` deja `appDetails` como array vacío, no como `{}`.

3. **Tipos.** `src/types/user/appRole.types.ts` con `CreateAppRoleInput`, exportado desde `src/types/user/index.ts`.
   *Verificación:* `import { CreateAppRoleInput } from '../types'` compila; `grep -rn "UpdateAppRoleInput" src/` no devuelve nada.

4. **Las 22 claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`. El bloque `role` existente no se toca.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

5. **Validadores.** Reescribir `src/validators/appRole.validator.ts` con los cuatro que exige §4: `appRoleIdValidator` (UUID en `param('id')`), `appRoleListValidator` (`limit` 1–100, `offset` ≥ 0), `createAppRoleValidator` (`code` obligatorio ≤ 100, `name` obligatorio ≤ 200, `description` obligatoria, `level` entero ≥ 0 obligatorio, y **rechazo explícito** de `isSystemRole`, `isActive` y `roleId`) y `updateAppRoleValidator` (los cuatro campos en `.optional()`, con los mismos rechazos). Alta en `src/validators/index.ts`.
   *Verificación:* enviar `isSystemRole: true` en el cuerpo devuelve 400; `level: -1` devuelve 400; `level` ausente en `001` devuelve 400; un `code` de 101 caracteres devuelve 400.

6. **`ESAVI-APPROLE-001` — crear.** `createAppRoleService` con los cinco pasos de §3.5, incluida la guarda de escalada y las dos comprobaciones de unicidad sin filtrar por `isActive`. Controlador y ruta `POST /` con `validateUserRole(ADMIN)`. Alta del router en `src/routes/index.ts` bajo `/roles`.
   *Verificación:* crear con `code: "  supervisor  "` y `name: "supervisor"` guarda `SUPERVISOR` en ambos; repetir el `code` devuelve 409, no 500 por `UQ_appRole_code`; repetir solo el `name` devuelve 409; un ADMIN creando `level: 100` recibe 403 y `level: 50` recibe 201; el rol nace con `isSystemRole: false`.

7. **`ESAVI-APPROLE-002A` y `002B` — listados.** Dos servicios y dos rutas (`GET /` USER, `GET /admin` ADMIN), con `findAndCountAll`, orden `[['level','DESC'],['name','ASC']]` y paginación.
   *Verificación:* un rol retirado no aparece en `/` y sí en `/admin`; un USER recibe 403 en `/admin`; con cuatro roles el primero de la lista es el de mayor `level`; `?limit=abc` devuelve 400.

8. **`ESAVI-APPROLE-003` — obtener por ID.** `getAppRoleByIdService(id, lang, canViewInactive)` con el `activeUserCount` de §3.7 y `sysDetails` excluido. Ruta `GET /:id` declarada **después** de `/admin`.
   *Verificación:* un ID inexistente devuelve 404; un rol retirado devuelve 404 para ADMIN y 200 para SUPERADMIN; `activeUserCount` refleja el número de asignaciones activas; la respuesta no contiene `sysDetails`.

9. **`ESAVI-APPROLE-004` — actualizar.** `updateAppRoleService` con los seis pasos de §3.5, el patrón `objectToUpdate` y el historial preservado con `[...currentAppDetails, newEntry]`.
   *Verificación:* editar el rol SUPERADMIN siendo ADMIN devuelve 403 y siendo SUPERADMIN devuelve 200; subir el `level` por encima del propio devuelve 403; poner un `code` de otro rol devuelve 409; un PUT sin cambios devuelve 200 con la entidad intacta y una entrada más en `appDetails`.

10. **Alineación de `code` en el seed.** `seed.controller.ts:30` a `'SUPERADMIN'` y `:88` a `'USER'`. Paso aislado por ser el único que cambia datos; incluye ejecutar a mano las dos sentencias `UPDATE` de §3.5 en los entornos ya desplegados, con respaldo previo.
    *Verificación:* en una base limpia, `POST /api/seed/admin` crea los dos roles con `code` igual a `name`; `SELECT "code","name" FROM "appRole"` no devuelve ninguna fila donde difieran; `npm test` sigue pasando.

11. **`ESAVI-APPROLE-005A` y `005B` — retirar y reactivar.** `setAppRoleActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. La retirada aplica antes las tres guardas de §3.5; la reactivación comprueba que `code` y `name` sigan libres. Dos controladores y dos rutas (`DELETE /:id` ADMIN, `PATCH /activate/:id` SUPERADMIN). Depende del paso 10: la guarda del rol SUPERADMIN compara por `code`.
    *Verificación:* retirar un rol con un portador activo devuelve 409 con el `count` en el mensaje; retirar el rol SUPERADMIN devuelve 409; retirar un rol de sistema siendo ADMIN devuelve 403; retirar dos veces devuelve 409 `ALREADY_INACTIVE`; `PATCH /activate/:id` deja `deletedAt` en `null`; las dos responden sin `data`.

12. **Arreglo de `roleValidation.middleware.ts`.** Una línea: el nivel del usuario pasa a `role.level ?? ROLE_LEVELS[role.name.toUpperCase()] ?? 0`. El nivel requerido no cambia. Es el paso que convierte un rol creado por la API en un rol que autoriza, y el más sensible del plan: va solo, en su propio commit.
    *Verificación:* crear un rol `SUPERVISOR` con `level: 60` por `POST /api/roles`, dar de alta un usuario con ese `roleId` por `POST /api/users`, y comprobar que su token **pasa** una ruta `validateUserRole(ADMIN)` y **recibe 403** en una `validateUserRole(SUPERADMIN)`. Antes del arreglo, ese mismo usuario recibía 403 en las dos. Un usuario SUPERADMIN existente sigue autorizándose igual; `npm test -- roles` sigue pasando.

13. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **43 a 50** en `tests/auth/roles.test.ts:137`.
    *Verificación:* `npm test -- roles` pasa.

14. **Suite de contrato `tests/contract/appRole.test.ts`.** Recorrido con `supertest`: crear → obtener por ID → listar (público y admin) → actualizar → retirar → reactivar. Más los caminos de error: `code` duplicado, `name` duplicado, escalada de nivel en create y en update, edición de rol de sistema por un ADMIN, retirada del rol SUPERADMIN, retirada con portadores activos, y la autorización efectiva de un rol creado por la API.
    *Verificación:* `npm test` en verde y `npm run check` en 0.

Dos apuntes sobre el orden:

- **El paso 12 va al final a propósito.** Podría ir el segundo —es una línea y no depende de nada—, pero entonces se verificaría con roles inventados a mano por SQL. Colocado después del CRUD, la verificación es el recorrido real que un usuario haría, y si falla se sabe que falla el middleware y no el alta.
- **El paso 13 asume que `ROUTE_RULES` tiene 43 entradas hoy**, que es el valor actual de `tests/auth/roles.test.ts:137`. Si SPEC F02 se implementa antes que éste, el total base será 51 y el objetivo 58. Conviene comprobar el número al llegar al paso, en vez de confiar en el escrito aquí.

---

## 5. Criterios de aceptación

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones.
- [ ] `grep -rn "ESAVI-APPROLE-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-APPROLE-00[6-9]" src/` no devuelve resultados: la entidad no pasa de `005B`.
- [ ] `grep -rn "APPROLE" references/CONVENTIONS.md` devuelve la fila de la tabla de abreviaturas y ninguna fila en la tabla de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/validators/appRole.validator.ts` exporta los cuatro validadores de §4.

**Creación y unicidad**

- [ ] Crear con `code: "  supervisor  "` guarda `SUPERVISOR`; `name: "supervisor"` guarda `SUPERVISOR`.
- [ ] Crear con un `code` ya existente devuelve **409**, no 500 por `UQ_appRole_code`.
- [ ] Crear con un `code` que solo existe en un rol **retirado** devuelve **409**: la unicidad no filtra por `isActive`.
- [ ] Crear con un `name` ya existente devuelve **409**, aunque el `code` sea distinto.
- [ ] Crear sin `level`, con `level: -1` o con `level: "alto"` devuelve **400**.
- [ ] Enviar `isSystemRole`, `isActive` o `roleId` en el cuerpo de `001` o `004` devuelve **400**.
- [ ] Todo rol creado por la API tiene `isSystemRole: false`.
- [ ] `SELECT count(*) FROM "appRole" GROUP BY "name" HAVING count(*) > 1` no devuelve filas tras la suite de contrato.

**Escalada de nivel**

- [ ] Un ADMIN creando un rol con `level: 100` recibe **403**; con `level: 50` recibe **201**.
- [ ] Un ADMIN subiendo el `level` de un rol existente por encima de 50 recibe **403**.
- [ ] Un SUPERADMIN puede crear y editar roles de cualquier nivel.

**Roles de sistema**

- [ ] `PUT /:id` sobre un rol con `isSystemRole: true` devuelve **403** para un ADMIN y **200** para un SUPERADMIN.
- [ ] `DELETE /:id` sobre un rol de sistema devuelve **403** para un ADMIN.
- [ ] Ninguna operación de la API deja `isSystemRole` en `true` en un rol nuevo.

**Lectura**

- [ ] `GET /` no devuelve roles retirados; `GET /admin` sí, y responde **403** a un USER.
- [ ] Los dos listados devuelven `data` como `{ count, rows }` y ordenan por `level DESC`, `name ASC`.
- [ ] `GET /:id` devuelve `activeUserCount` con el número de asignaciones activas en `appUserRole`.
- [ ] `GET /:id` de un rol retirado: 404 para USER y ADMIN, 200 para SUPERADMIN.
- [ ] Ninguna respuesta de lectura contiene `sysDetails`.
- [ ] `GET /:id` no captura `admin` ni `activate` como UUID.

**Retirada y reactivación**

- [ ] `DELETE /:id` de un rol con al menos un portador activo devuelve **409** e interpola el `count` en el mensaje.
- [ ] `DELETE /:id` del rol cuyo `code` es `SUPERADMIN` devuelve **409**, tenga o no portadores.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` revierte los dos.
- [ ] Retirar dos veces devuelve **409** `ALREADY_INACTIVE`; reactivar dos veces devuelve **409** `ALREADY_ACTIVE`.
- [ ] Reactivar un rol cuyo `code` o `name` ocupa ya otro rol activo devuelve **409**.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` **sin `data`**.
- [ ] `appDetails.method` guarda `'ESAVI-APPROLE-005A'` y `'ESAVI-APPROLE-005B'`, sin sufijos `_ACTIVATION` ni `_DEACTIVATION`.

**Autorización efectiva — lo que da sentido al spec**

- [ ] Un rol creado por la API con `level: 60` y asignado a un usuario le permite pasar una ruta `validateUserRole(ADMIN)` y le devuelve **403** en una `validateUserRole(SUPERADMIN)`.
- [ ] Un usuario cuyo rol tiene `level` nulo en base de datos sigue autorizándose por el respaldo `ROLE_LEVELS[name]`.
- [ ] El nivel **requerido** por cada ruta se sigue leyendo de `ROLE_LEVELS`: `grep -rn "ROLE_LEVELS" src/middlewares/roleValidation.middleware.ts` devuelve las dos apariciones, no una.
- [ ] Ninguna ruta del repositorio cambia su `validateUserRole(...)` como consecuencia de este spec.

**Estado del dato**

- [ ] `SELECT "code","name" FROM "appRole"` no devuelve ninguna fila donde `code` y `name` difieran tras el paso 10.
- [ ] `POST /api/seed/admin` sobre una base limpia crea SUPERADMIN y USER con `code` igual a `name`.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] Ningún servicio escribe `sysDetails`: lo pone el trigger.

**Cierre**

- [ ] `src/helpers/permissions.helper.ts` no cambia; sigue exportando los mismos siete predicados y comparando por `name`.
- [ ] El tipo `AuthUser` no cambia y `req.user` conserva la misma forma.
- [ ] `src/services/user.service.ts` no cambia.
- [ ] Las 22 claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 50 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el nivel y la autorización**

- **Sí:** el nivel del solicitante pasa a leerse de `appRole.level`. Sin este cambio, el CRUD entrega un endpoint que crea filas incapaces de autorizar nada, y el spec habría sido cosmético. Es el mismo criterio con el que SPEC F02 metió el arreglo de `tokenValidation` en su alcance.
- **No:** eliminar `ROLE_LEVELS`. Sigue siendo la fuente del nivel **requerido** por cada ruta, que es un literal (`validateUserRole(ADMIN)`) y no un dato. Sustituirlo obligaría a poner números en las rutas —`validateUserRole(50)`, ilegible— o a consultar la base de datos en cada petición solo para traducir un nombre a un nivel.
- **Sí:** `ROLE_LEVELS[name]` como respaldo cuando `level` viene nulo. Hace que el cambio no pueda dejar sin acceso a nadie en un despliegue existente, que es el único riesgo serio del paso 12.
- **No:** entregar el CRUD tal cual y documentar que los roles nuevos no autorizan hasta añadirlos a la constante. Sería honesto y también inútil: crear un rol por API para después editar un archivo TypeScript y redesplegar no es un CRUD.
- **No:** restringir `001` a los cuatro nombres presentes en `ROLE_LEVELS`. Convierte el spec en un editor de metadatos de cuatro filas fijas y deja la tabla sin razón de ser.
- **Sí:** la guarda de escalada responde **403** desde el servicio. Es un fallo de autorización, no un conflicto de datos; devolver 409 haría que el cliente lo confundiera con un duplicado. Sigue el precedente que abrió SPEC F02 §6.
- **Sí:** el límite es **menor o igual** al nivel propio, no estrictamente menor. Un ADMIN debe poder crear roles de nivel ADMIN; exigir estrictamente menor dejaría el nivel 50 en manos exclusivas del SUPERADMIN sin ninguna ganancia.

**Sobre `code` y `name`**

- **Sí:** `name` se normaliza con `toConstantCase`, no con `toTitleCase`. En esta tabla `name` no es una etiqueta de presentación: es la clave contra la que comparan `roleValidation.middleware.ts:14` y los siete predicados de `permissions.helper.ts`. Normalizar a Title Case dejaría a `canViewInactive`, `isSuperAdmin` e `isAdmin` devolviendo falso para todo el mundo — `permissions.helper.ts:10` compara con `includes` exacto y no aplica `.toUpperCase()` como sí hace el middleware.
- **No:** normalizar `name` a Title Case y arreglar los siete predicados. Es un cambio transversal sobre el punto donde se decide qué ve cada usuario, a cambio de que un nombre de rol se lea más bonito.
- **Sí:** alinear `code` con `name` en el seed. Hoy conviven `code: 'SAD'` con `name: 'SUPERADMIN'`, y el código real compara unas veces por uno y otras por el otro. Mientras difieran, la guarda del último SUPERADMIN de SPEC F02 —que compara `code` contra `ROLES.SUPERADMIN`— no dispara nunca.
- **No:** unificar `permissions.helper.ts` para que compare por `code`. Sería lo correcto en abstracto —`code` tiene `UQ_appRole_code` y `name` no tiene nada—, pero con `code = name` la incoherencia deja de tener efecto, y tocar los siete predicados es un cambio transversal que merece su propio spec.
- **Sí:** unicidad de `name` a nivel de aplicación, aunque el DDL no la imponga. Con el nivel saliendo de la base, dos roles activos llamados igual con niveles distintos dejarían el `Math.max` de `validateUserRole` decidiendo por orden de llegada de las filas.
- **No:** añadir `UNIQUE ("name")` al DDL. Es cambio de esquema, afecta a la carga de `esaviapp.sql` en los tests y a datos ya cargados que podrían violarlo. El riesgo residual —que por SQL directo se creen dos `name` iguales— queda en §7.
- **No:** ejecutar las dos sentencias `UPDATE` desde código de la aplicación. Un arranque que reescribe datos es exactamente lo que nadie quiere depurar a las tres de la mañana. Van a mano, con respaldo previo.

**Sobre los roles de sistema**

- **Sí:** `isSystemRole` pasa a significar algo, y lo que significa es que solo un SUPERADMIN edita o retira ese rol. Hoy la columna existe, el seed la puebla y ninguna línea de código la lee.
- **Sí:** la guarda vive en el **servicio**. §9 lo manda: la regla depende del registro que se está tocando, no del umbral de la ruta, así que `validateUserRole` no puede expresarla y el controlador tiene prohibido comprobarla.
- **No:** hacer `isSystemRole` editable por API, ni siquiera por SUPERADMIN. Es la marca que protege al resto de guardas; que se pueda apagar por HTTP la convierte en un trámite en vez de en una barrera. Se pone por seed o por SQL.
- **Sí:** `001` escribe `isSystemRole: false` de forma explícita en vez de confiar en el `DEFAULT false` del DDL. Un default es una promesa del esquema; aquí es una invariante del spec y conviene que se lea en el código.
- **Sí:** la guarda **no** se escribe en `005B`. La ruta ya exige SUPERADMIN y la comprobación sería código muerto, que §7 prohíbe dejar. La dependencia queda anotada en §7 como riesgo.

**Sobre la retirada**

- **Sí:** bloquear la retirada de un rol con portadores activos. Un rol inactivo con usuarios asignados deja a esos usuarios en un estado que ningún listado sabe representar, y con el arreglo del paso 12 ni siquiera está claro si sigue autorizando. Es el mismo criterio del `hasActiveChildren` de SPEC 09.
- **No:** retirar el rol y revocar en cascada sus asignaciones. Sería una escritura masiva escondida detrás de un `DELETE` de una sola fila. Revocar es competencia de SPEC F02 y se hace de forma explícita.
- **Sí:** bloquear siempre la retirada del rol SUPERADMIN, incluso sin portadores. `005B` exige SUPERADMIN, así que retirarlo deja el sistema sin nadie capaz de deshacerlo y la única salida es SQL contra producción. Es el mismo razonamiento de la guarda del último SUPERADMIN de F02, un nivel más arriba.
- **No:** extender el bloqueo a los otros tres roles de `ROLE_LEVELS`. Retirar ANALYTICS o USER es una decisión legítima de configuración y no deja el sistema sin gobierno.

**Sobre la forma**

- **Sí:** las siete operaciones canónicas y ninguna más. Al contrario que `appUserGeoLocation` y `appUserRole`, esta entidad no tiene reasignación, ni asignación masiva, ni cobertura: es un catálogo. El rango `001`–`005B` le sobra.
- **Sí:** listado dual con **dos rutas**, `/` y `/admin`, y por tanto `002A` y `002B` en la ruta. Es el patrón de `catalogItem` y el de la plantilla de §14.5, no el de bifurcación en el controlador de `geoLevelType`.
- **Sí:** orden `level DESC, name ASC`. Un listado de roles se lee de mayor a menor autoridad; alfabético dejaría ANALYTICS primero y SUPERADMIN al final.
- **Sí:** `activeUserCount` en `003`. `005A` rechaza retirar un rol con portadores; sin este dato el cliente solo se entera al recibir el 409, y no tiene ninguna otra forma de averiguarlo hasta que exista `USERROLE-006`.
- **No:** `activeUserCount` en los listados. Una consulta por fila para un dato que solo importa antes de retirar.
- **Sí:** `description` obligatoria en la aplicación aunque el DDL la permita nula. La aplicación puede ser más estricta que el esquema; al revés, no.
- **No:** cifrar ningún campo con `esaviCrypt`. La tabla no contiene PII: un nombre de rol y un entero no identifican a nadie.
- **No:** exponer `appPermission` ni `appRolePermission`. Un rol aquí es un `level` y un nombre. El modelo de permisos finos está en el esquema, resuelto por `getUserPermissions`, y no lo consume nada; darle superficie HTTP es otro spec y otra conversación.
- **No:** jerarquía o herencia entre roles. El entero ordena; añadir un `parentRoleId` duplicaría el orden con dos mecanismos que hay que mantener coherentes.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El paso 12 cambia el nivel efectivo de usuarios existentes si el `level` guardado en `appRole` no coincide con el que `ROLE_LEVELS` asigna a ese `name` — por ejemplo un rol `ADMIN` cargado por SQL con `level: 1`, que pasaría de 50 a 1 | Antes del paso 12, ejecutar `SELECT "name","level" FROM "appRole"` y contrastar las cuatro filas con `ROLE_LEVELS`. El seed ya escribe 100 y 25 correctamente, así que en un despliegue no manipulado no hay diferencia. Es el paso más sensible del plan y por eso va aislado en su propio commit |
| Las dos sentencias `UPDATE` del paso 10 se olvidan, y en ese entorno la guarda del rol SUPERADMIN de `005A` no dispara porque el `code` sigue siendo `'SAD'` | Hay un criterio de aceptación explícito con la consulta `SELECT "code","name" FROM "appRole"`. El `findOrCreate` del seed busca por `name`, así que el cambio de código por sí solo no arregla las filas existentes: es un paso manual y está marcado como tal |
| La unicidad de `name` solo la impone la aplicación. Por SQL directo pueden convivir dos roles activos con el mismo `name` y distinto `level`, y entonces `Math.max` decide por orden de llegada de las filas | La suite de contrato verifica `GROUP BY "name" HAVING count(*) > 1`. Un `UNIQUE` en el DDL lo cerraría de verdad, pero es cambio de esquema y va en otro spec |
| Entre la comprobación de unicidad de `name` y el `INSERT` puede colarse otro create concurrente | Ventana estrecha con dos administradores creando roles a la vez. El `code` lo cierra `UQ_appRole_code` a nivel de base; el `name` no tiene índice que lo respalde. No se añade bloqueo explícito |
| La guarda de rol de sistema no se escribe en `005B` porque la ruta ya exige SUPERADMIN. Si algún día esa ruta baja a ADMIN, la protección desaparece sin que nadie lo note | `ROUTE_RULES` fija el rol mínimo de las siete rutas y `npm test -- roles` falla si cambia. La dependencia queda escrita aquí y en §3.5 |
| Bajar el `level` de un rol retira autoridad a todos sus portadores en su siguiente petición, sin aviso previo | Es la consecuencia buscada de que la columna sea la fuente de la verdad, no un efecto colateral. `activeUserCount` en `003` permite ver a cuánta gente afecta antes de editar. Un `level` mal tecleado tiene que poder corregirse, así que no se bloquea |
| Nada limita cuántos roles puede crear un ADMIN ni impide que proliferen roles de nivel 50 casi idénticos | La unicidad de `code` y de `name` evita los duplicados exactos; el resto es política de uso, no de esquema. Cada creación deja su entrada en `appDetails` con el usuario responsable |
| `level` es un entero libre, así que caben valores intermedios (75) que ninguna ruta usa como umbral | Es el comportamiento correcto de un sistema por umbrales: un rol de 75 pasa todo lo que exige ≤ 75. No se restringe a los cuatro valores canónicos porque eso devolvería el problema que este spec resuelve |
| El paso 13 parte de 43 entradas en `ROUTE_RULES`; si SPEC F02 se implementa antes, el número base es otro | El plan lo advierte y la verificación es que la suite pase, no que el número sea 50 |

---

## 8. Impacto en el contrato HTTP

El spec añade siete endpoints nuevos, que por sí solos no cambian nada de lo que reciben los clientes existentes. El arreglo de `roleValidation.middleware.ts` **sí**:

| Situación | Antes | Después |
|---|---|---|
| Usuario con un rol cuyo `name` está en `ROLE_LEVELS` y cuyo `level` en base de datos coincide | Autoriza según la constante | **Sin cambio**: la columna dice lo mismo |
| Usuario con un rol cuyo `name` **no** está en `ROLE_LEVELS` — hoy solo posible por SQL directo | Nivel `0`: **403** en toda ruta con `validateUserRole` | Autoriza según su `level` |
| Usuario con un rol cuyo `name` está en `ROLE_LEVELS` pero cuyo `level` en base difiere | Manda la constante | **Manda la columna** |
| Usuario con un rol cuyo `level` es nulo en base de datos | Autoriza por la constante | **Sin cambio**: el respaldo `ROLE_LEVELS[name]` lo cubre |
| Usuario sin ningún rol | Nivel `0` | Nivel `0` |

No cambia la forma de `req.user`, ni el tipo `AuthUser`, ni la emisión de tokens, ni el `validateUserRole(...)` de ninguna ruta: el nivel **requerido** se sigue leyendo de `ROLE_LEVELS`. El cambio surte efecto en la petición siguiente sin invalidar nada, porque `tokenValidation` ya recarga los roles desde la base de datos en cada llamada.

La tercera fila es la única que puede quitar acceso a alguien, y solo si los datos ya estaban desalineados. Es lo que el paso 12 verifica antes de tocar nada.

---

## Lo que **no** está en este spec

- `appPermission`, `appRolePermission` y la función `getUserPermissions`: los permisos finos siguen sin superficie HTTP.
- Asignar, revocar o listar roles de usuario: es SPEC F02 (`appUserRole`).
- Eliminar `ROLE_LEVELS`: sigue siendo la fuente del nivel requerido en cada ruta y el respaldo del nivel del usuario.
- Unificar el criterio `code` frente a `name` en los siete predicados de `permissions.helper.ts`.
- Añadir `UNIQUE ("name")` al DDL, o cualquier otro cambio de esquema sobre `appRole`.
- Migrar datos de despliegues existentes más allá de las dos sentencias documentadas para los roles del seed.
- Hacer `isSystemRole` editable por API, para cualquier rol y cualquier solicitante.
- Jerarquía, herencia o agrupación entre roles: el modelo es plano.
- Vigencia temporal de un rol.
- Revocación en cascada de las asignaciones al retirar un rol.
- Migrar la asignación de roles de `createUserService` al servicio de F02.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
