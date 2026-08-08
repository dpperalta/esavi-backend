# SPEC F02 — CRUD de appUserRole

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F01 (molde de entidad de asignación)
> **Fecha:** 2026-08-05
> **Objetivo:** Dar superficie HTTP a `appUserRole` — asignar, consultar y revocar roles de usuario — y hacer que revocar un rol deje efectivamente de autorizar.

---

## 1. Por qué existe este spec

`appUserRole` es la tabla que decide qué puede hacer cada usuario en todo el sistema. Existe en `esaviapp.sql:300-322`, tiene modelo en `src/models/appUserRole.model.ts` y sus seis asociaciones están declaradas en `src/models/associations/auth.associations.ts`. Lo que no tiene es **ninguna superficie HTTP**: no hay servicio, controlador, ruta, tipos ni validador.

Hoy un rol solo se asigna en dos sitios, y ninguno de los dos es un endpoint de gestión:

- `src/services/user.service.ts:60-75`, al **crear** el usuario, a partir del `roleId` del alta.
- `src/controllers/seed.controller.ts:68`, con `findOrCreate`, para el SUPERADMIN inicial.

La consecuencia es concreta: **un rol asignado en el alta no se puede quitar ni cambiar por la API**. Corregir una asignación equivocada, retirar privilegios a alguien que cambia de puesto o promover a un usuario existente exigen SQL directo contra producción.

Dos desajustes verificados que este spec resuelve:

**A — Revocar no revocaría nada.** `src/middlewares/tokenValidation.middleware.ts:37-49` recupera los roles con el `include` de `belongsToMany` y `through: { attributes: [] }`, **sin filtrar `isActive` ni `deletedAt`** ni en la fila de `appUserRole` ni en `appRole`. La función `getUserPermissions` del propio DDL (`esaviapp.sql:1540-1562`) sí lo hace: exige `ur."isActive" = true`, `ur."deletedAt" IS NULL` y el rol activo. Con el middleware tal como está, poner `isActive: false` en una asignación no le quita el privilegio a nadie: el usuario sigue autorizándose con el rol revocado en la siguiente petición. Un endpoint `005A` sin este arreglo sería puramente cosmético, y por eso el arreglo **entra en este spec**.

**B — No hay ninguna guarda de escalada de privilegio.** La matriz canónica de `references/CONVENTIONS.md` §9 asigna `ADMIN` a la operación `001`. Aplicada tal cual a esta entidad, cualquier ADMIN podría asignarse a sí mismo el rol SUPERADMIN y quedarse con el nivel 100. `validateUserRole` no puede expresar esta regla: compara el nivel del solicitante contra un umbral fijo de la ruta, no contra el nivel del rol que viene en el cuerpo. Es exactamente el caso que §9 manda resolver en el **servicio**.

Esta entidad hereda además las dos particularidades que SPEC F01 tuvo que decidir para `appUserGeoLocation`, porque el DDL es el mismo molde: el índice único **parcial** `UQ_appUserRole_active_user_role` y la convivencia de `isActive` con `validTo`. Aquí se resuelven de forma distinta, y se explica por qué en §6.

---

## 2. Alcance

**Dentro:**

- Los cinco artefactos que faltan de `appUserRole`: tipos, validadores, servicio, controlador y ruta. El modelo y las asociaciones ya existen.
- Ocho operaciones: `001` asignar, `002A` listar por usuario, `002B` listar por usuario para administración, `003` obtener por ID, `005A` revocar, `005B` reinstaurar, `006` listar por rol y `007` asignación masiva.
- **`validFrom` y `validTo` quedan fuera del alcance funcional.** `isActive` gobierna el estado de la asignación, y nada más. `validFrom` toma el default del DDL; `validTo` se queda siempre en `null`. Ninguna operación los lee, los escribe ni los acepta en el cuerpo.
- La invariante **una sola fila por `(userId, roleId)`**, más estricta que el índice parcial del DDL.
- `001` con dos caminos: inserta si el par no existe (`201`), reactiva la fila revocada si existe inactiva (`200`), y rechaza con `409` si ya está activa.
- **Guarda de escalada:** solo se asigna un rol cuyo `appRole.level` sea **menor o igual** al nivel máximo del solicitante. Aplica a `001` y a `007`.
- **Guarda del último SUPERADMIN:** `005A` rechaza revocar la última asignación activa del rol SUPERADMIN del sistema.
- **Arreglo de `src/middlewares/tokenValidation.middleware.ts`:** el `include` de roles filtra `isActive: true` y `deletedAt: null` en la fila de `appUserRole`, y `isActive: true` en `appRole`.
- `assignedByUserId` tomado siempre de `req.user.userId`; lo que venga en el cuerpo se ignora.
- Alta de la abreviatura `USERROLE` en la tabla de `references/CONVENTIONS.md` §6, y de las operaciones `006` y `007` en la tabla de operaciones no canónicas.
- Claves i18n nuevas en `src/data/i18n/es.json`, `en.json` y `nl.json`.
- Filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/appUserRole.test.ts`.

**Fuera de alcance (otros specs):**

- **Vigencia temporal.** `validFrom` y `validTo` existen en el DDL y se quedan como están. Que una asignación caduque sola es un requerimiento que hoy no se ha pedido; si aterriza, va en su propio spec y tendrá que decidir cómo convive con `isActive`.
- **`ESAVI-USERROLE-004` — no existe.** Sin vigencia editable, una asignación no tiene ningún campo mutable: `userId` y `roleId` la definen, `isActive` es territorio de `005A`/`005B`. El número `004` queda **reservado y sin usar** en esta entidad.
- **Reasignar (`006` de USERGEO).** Cambiar un rol por otro se hace revocando y asignando: dos actos deliberados, con dos entradas de auditoría distintas. En roles no hay ninguna ventaja en atomizarlos.
- **CRUD de `appRole`.** No hay endpoint para crear, editar ni listar roles. Este spec asume que los roles ya existen. `src/validators/appRole.validator.ts` existe y no se usa; se queda como está.
- **`appPermission` y `appRolePermission`.** El esquema modela permisos finos y `getUserPermissions` los resuelve, pero nada de eso está expuesto. Es otro spec.
- **Sustituir `ROLE_LEVELS` por `appRole.level`.** El middleware `validateUserRole` seguirá comparando contra la constante de `src/constants/roles.constants.ts`. Este spec usa `appRole.level` **solo** dentro del servicio, para la guarda de escalada.
- **Cambiar `permissions.helper.ts`.** Los siete predicados se quedan puros y síncronos.
- **Migrar la asignación de roles de `user.service.ts`** al servicio nuevo. `createUserService` sigue escribiendo en `appUserRole` directamente dentro de su transacción.
- **Baja masiva.** `007` solo asigna; revocar varios roles se hace uno a uno con `005A`.
- **Histórico de varias filas por par.** El índice parcial lo permitiría; la invariante lo descarta.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`appUserRole` — `esaviapp.sql:300-322`. La tabla ya existe y **no se altera**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `userRoleId` | `uuid` | no | PK, `gen_random_uuid()` |
| `userId` | `uuid` | no | FK → `appUser("userId")`, `ON DELETE RESTRICT ON UPDATE CASCADE` |
| `roleId` | `uuid` | no | FK → `appRole("roleId")`, `ON DELETE RESTRICT ON UPDATE CASCADE` |
| `validFrom` | `timestamptz` | no | default `current_timestamp` — **fuera del alcance funcional** |
| `validTo` | `timestamptz` | sí | **fuera del alcance funcional**, siempre `null` |
| `assignedByUserId` | `uuid` | sí | FK → `appUser("userId")`, `ON DELETE SET NULL ON UPDATE CASCADE` |
| `isActive` | `bool` | no | default `true` — **único gobernador del estado** |
| `createdAt` | `timestamptz` | no | default `current_timestamp` |
| `updatedAt` | `timestamptz` | sí | |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | default `'{}'` |
| `appDetails` | `jsonb` | no | default `'{}'` — el servicio escribe **array** |

Las cuatro columnas transversales están presentes. No hay anomalía que resolver antes de implementar.

**Restricciones:**

- `CK_appUserRole_dates` — `CHECK ("validTo" IS NULL OR "validTo" > "validFrom")`. Con `validTo` siempre `null`, **nunca se puede violar**. Es la razón por la que este spec no necesita el 409 `INVALID_DATE_RANGE` que sí tiene USERGEO.
- `UQ_appUserRole_active_user_role` — índice único **parcial** sobre `("userId", "roleId")` con predicado `WHERE "deletedAt" IS NULL AND "isActive" = true AND "validTo" IS NULL` (`esaviapp.sql:318-320`).

**Índices:** `IX_appUserRole_userId`, `IX_appUserRole_roleId`.

**Triggers:** `TRG_appUserRole_setSysDetails`, instalado por el bloque genérico de `esaviapp.sql:1276-1294` sobre toda tabla con columna `sysDetails`; y `TRG_appUserRole_preventPhysicalDelete`, del bloque de `esaviapp.sql:1360-1375`. El servicio **nunca** escribe `sysDetails` y **nunca** borra físicamente.

Tabla relacionada que se consulta pero no se modifica: `appRole` — `esaviapp.sql:265-279`, con `code` (`UQ_appRole_code`), `name`, `level` (`integer NOT NULL DEFAULT 1 CHECK ("level" >= 0)`) e `isSystemRole`.

### 3.2 Modelo Sequelize

`src/models/appUserRole.model.ts` **ya existe**, clase `AppUserRole`, dada de alta en `src/models/index.ts:4,21`. Cumple §12: `timestamps: false`, `freezeTableName: true`, `tableName: 'appUserRole'`, PK UUID con `sequelize.literal('gen_random_uuid()')`.

Dos ajustes menores, y ninguno más:

- `appDetails` recibe `defaultValue: []`, como `geoLocation.model.ts:114`. Hoy no lo tiene y el DDL trae `'{}'`, que no es un array.
- `validFrom` cambia `defaultValue: DataTypes.NOW` por `defaultValue: sequelize.literal('current_timestamp')`, para que el valor lo ponga la base y no Sequelize. Es coherente con dejar la vigencia fuera del alcance.

**Asociaciones — no se añade ninguna.** Las seis que hacen falta ya están en `src/models/associations/auth.associations.ts:5-18`:

| Asociación | Alias | Línea |
|---|---|---|
| `AppUser.hasMany(AppUserRole)` | `userRoles` | `:7` |
| `AppUserRole.belongsTo(AppUser)` | `user` | `:8` |
| `AppRole.hasMany(AppUserRole)` | `roleUsers` | `:10` |
| `AppUserRole.belongsTo(AppRole)` | `role` | `:11` |
| `AppUserRole.belongsTo(AppUser, assignedByUserId)` | `assignedUser` | `:13` |
| `AppUser.belongsToMany(AppRole, through: AppUserRole)` | `roles` | `:16` |

La `belongsToMany` de `:16` es la que consume `tokenValidation`, y es la que §3.5 filtra.

### 3.3 Tipos

Archivo nuevo `src/types/user/appUserRole.types.ts`, exportado desde el barrel existente `src/types/user/index.ts` — que ya reexporta `./user.types` y `./appUserGeoLocation.types`. No hace falta tocar `src/types/index.ts`.

```ts
export interface CreateAppUserRoleInput {
    userId: string;
    roleId: string;
}

export interface BulkAssignRolesInput {
    userId: string;
    roleIds: string[];
}
```

Dos ausencias deliberadas:

- **`validFrom` y `validTo` no aparecen.** Están fuera del alcance funcional; el validador rechaza con 400 si llegan en el cuerpo.
- **`assignedByUserId` no aparece.** Sale de `req.user.userId` y viaja al servicio como `authUser`, no como dato.

**No se declara `UpdateAppUserRoleInput`** — está prohibido por §4, y además no hay operación `004`.

`UserRole` (`src/types/user/user.types.ts:10-15`) ya expone `level`, y `tokenValidation.middleware.ts:57-60` lo puebla. La guarda de escalada se apoya en ese campo sin tocar el tipo.

### 3.4 Superficie HTTP

```
POST   /api/user-roles                       ESAVI-USERROLE-001   ADMIN       (nuevo)
POST   /api/user-roles/bulk                  ESAVI-USERROLE-007   ADMIN       (nuevo)
GET    /api/user-roles/user/:userId          ESAVI-USERROLE-002A  USER        (nuevo)
GET    /api/user-roles/admin/user/:userId    ESAVI-USERROLE-002B  ADMIN       (nuevo)
GET    /api/user-roles/role/:roleId          ESAVI-USERROLE-006   ADMIN       (nuevo)
GET    /api/user-roles/:id                   ESAVI-USERROLE-003   USER        (nuevo)
DELETE /api/user-roles/:id                   ESAVI-USERROLE-005A  ADMIN       (nuevo)
PATCH  /api/user-roles/activate/:id          ESAVI-USERROLE-005B  SUPERADMIN  (nuevo)
```

Alta del router en `src/routes/index.ts` bajo el prefijo `/user-roles`.

**`004` no existe en esta entidad.** El número queda reservado y sin usar; §2 explica por qué.

**Orden de declaración en `appUserRole.routes.ts`.** Las cinco rutas literales (`/bulk`, `/user/:userId`, `/admin/user/:userId`, `/role/:roleId`, `/activate/:id`) van **antes** de `/:id`. En caso contrario Express captura `bulk`, `user`, `admin` o `role` como un `:id` y el validador de UUID responde 400.

`006` y `007` extienden el rango `001`–`005B` de §6, siguiendo el precedente que abrió `appUserGeoLocation`. Se registran en la tabla de operaciones no canónicas.

### 3.5 Reglas de negocio por operación

**Invariante global.** Existe **como máximo una fila por `(userId, roleId)`**, sin importar su estado. Es más estricta que el índice parcial del DDL, que solo cubre las filas activas. La comprobación de existencia se hace **siempre sin filtrar por `isActive` ni `deletedAt`**.

**Guarda de escalada — aplica a `001` y `007`.** El nivel del solicitante es `Math.max(...authUser.roles.map(r => r.level))`, tomado de `req.user`. Si `appRole.level` del rol pedido es **mayor** que ese nivel → **403** `USERROLE_001_ROLE_LEVEL_EXCEEDED` (o `USERROLE_007_ROLE_LEVEL_EXCEEDED`). Un ADMIN puede crear ADMINs; nunca SUPERADMINs. Auto-asignarse un rol de nivel igual o inferior está **permitido**: la guarda cierra el único caso peligroso, y prohibir la auto-asignación lateral bloquearía al único SUPERADMIN de un despliegue recién instalado.

**`ESAVI-USERROLE-001` — asignar.** En este orden:

1. `userId` existe y está activo → 404 `USERROLE_001_USER_NOT_FOUND`, clave `user.notFound`.
2. `roleId` existe y está activo → 404 `USERROLE_001_ROLE_NOT_FOUND`, clave `role.notFound`.
3. Guarda de escalada → 403 `USERROLE_001_ROLE_LEVEL_EXCEEDED`.
4. Busca la fila del par `(userId, roleId)`:
   - **No existe** → inserta con `assignedByUserId = authUser.userId`. Responde **201**.
   - **Existe e `isActive: false`** → reactiva: `isActive: true`, `deletedAt: null`, `assignedByUserId = authUser.userId`. Responde **200**.
   - **Existe e `isActive: true`** → 409 `USERROLE_001_ASSIGNMENT_EXISTS`.

No escribe `validFrom` ni `validTo`. En los dos primeros casos añade entrada a `appDetails` con `method: 'ESAVI-USERROLE-001'`; el detalle distingue `'Role assigned by service'` de `'Role reactivated by assign'`. En la reactivación el historial se preserva con `[...currentAppDetails, newEntry]`.

**`ESAVI-USERROLE-002A` — listar por usuario, público.** `findAndCountAll` con `where: { userId, isActive: true }`, `include` del `role`. Orden `createdAt DESC`. Paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Valida antes que el `userId` exista → 404 `USERROLE_002A_USER_NOT_FOUND`.

**`ESAVI-USERROLE-002B` — listar por usuario, administración.** Igual, **sin `isActive` en el `where`**: devuelve también las revocadas. 404 `USERROLE_002B_USER_NOT_FOUND`.

**`ESAVI-USERROLE-003` — obtener por ID.** Existencia → 404 `USERROLE_003_NOT_FOUND`. Una fila revocada devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — hoy **SUPERADMIN**, según `permissions.helper.ts:24-26`. Incluye `user` y `role` (§3.7).

**`ESAVI-USERROLE-005A` — revocar.** Sobre `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`), con transacción, igual que `setCatalogItemActivationService`. Escribe `isActive: false` y `deletedAt: now()`. **No toca `validTo`.** Doble revocación → 409 `USERROLE_005A_ALREADY_INACTIVE`.

Antes de delegar, **la guarda del último SUPERADMIN**: si el rol de la asignación tiene `appRole.code` igual a `ROLES.SUPERADMIN` (`src/constants/roles.constants.ts`), cuenta las asignaciones activas de ese rol cuyo usuario esté también activo. Si el resultado es **1** —la que se está revocando— → 409 `USERROLE_005A_LAST_SUPERADMIN`. Sin esta guarda el sistema puede quedarse sin nadie capaz de reinstaurar el rol, porque `005B` exige SUPERADMIN.

**`ESAVI-USERROLE-005B` — reinstaurar.** Revierte los dos campos: `isActive: true`, `deletedAt: null`. Doble reinstauración → 409 `USERROLE_005B_ALREADY_ACTIVE`. Antes de reinstaurar comprueba que el par siga siendo único; si otra fila del mismo par está activa, 409 `USERROLE_005B_ASSIGNMENT_EXISTS`. La guarda de escalada **no aplica**: la ruta ya exige SUPERADMIN, el nivel máximo. `appDetails.method` guarda `'ESAVI-USERROLE-005B'`, nunca con sufijo `_ACTIVATION`.

**`ESAVI-USERROLE-006` — listar por rol.** `findAndCountAll` con `where: { roleId, isActive: true }`, `include` del `user` con su PII descifrada. Orden `createdAt DESC`, con paginación. Valida antes que el `roleId` exista → 404 `USERROLE_006_ROLE_NOT_FOUND`. Es la respuesta a "quién es SUPERADMIN hoy". Rol mínimo ADMIN: la nómina de administradores no es información pública dentro del sistema.

**`ESAVI-USERROLE-007` — asignación masiva.** **Todo o nada** dentro de una transacción. Orden:

1. `userId` existe y está activo → 404 `USERROLE_007_USER_NOT_FOUND`.
2. `roleIds` no está vacío y no tiene repetidos → 400, lo emite el validador.
3. Todos los roles existen y están activos, comprobados en **una sola consulta** con `[Op.in]`; si falta alguno → 404 `USERROLE_007_ROLES_NOT_FOUND`, con el mensaje interpolando cuántos faltan.
4. Guarda de escalada sobre **todos** los roles pedidos; si alguno excede → 403 `USERROLE_007_ROLE_LEVEL_EXCEEDED`, sin escribir nada.
5. Ninguno de los pares está ya **activo**; si alguno lo está → 409 `USERROLE_007_ASSIGNMENT_EXISTS`, transacción abortada.
6. Inserta los pares nuevos y reactiva los inactivos, con la semántica de `001`.

Responde **201** con `{ count, rows }`. `appDetails.method` es `'ESAVI-USERROLE-007'` en todas las filas tocadas.

**Arreglo de `tokenValidation`.** El `include` de `src/middlewares/tokenValidation.middleware.ts:41-48` pasa de `through: { attributes: [] }` a filtrar también:

- en la fila de `appUserRole`: `isActive: true` y `deletedAt: null`;
- en `appRole`: `isActive: true`.

`validTo` **no se filtra**, por coherencia con la decisión de que `isActive` gobierna. Es el único punto donde este spec se aparta de `getUserPermissions`, y el riesgo queda anotado en §7. El resto del middleware —el mapeo a `{ name, level }` de `:57-60` y la forma de `req.user`— **no cambia**.

### 3.6 Claves i18n nuevas

Bloque `appUserRole` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `appUserRole.assignSuccess` | 201 al asignar un rol |
| `appUserRole.reactivateSuccess` | 200 cuando `001` reactiva un par revocado |
| `appUserRole.assignFailed` | 500 genérico de asignación |
| `appUserRole.getSuccess` | 200 en los tres listados y en getById |
| `appUserRole.fetchFailed` | 500 genérico de lectura |
| `appUserRole.notFound` | 404 de asignación inexistente |
| `appUserRole.assignmentExists` | 409 de par ya activo, en `001`, `005B` y `007` |
| `appUserRole.roleLevelExceeded` | 403 al asignar un rol de nivel superior al propio |
| `appUserRole.lastSuperAdmin` | 409 al revocar la última asignación SUPERADMIN activa |
| `appUserRole.alreadyActive` | 409 al reinstaurar una asignación ya activa |
| `appUserRole.alreadyInactive` | 409 al revocar una asignación ya revocada |
| `appUserRole.revokeSuccess` | 200 de `005A` |
| `appUserRole.reinstateSuccess` | 200 de `005B` |
| `appUserRole.bulkSuccess` | 201 de `007` |
| `appUserRole.bulkFailed` | 500 genérico de asignación masiva |
| `appUserRole.rolesNotFound` | 404 de `007` con `{{count}}` roles inexistentes |

Las FK reutilizan las claves ya existentes `user.notFound` y `role.notFound`. `tests/i18n/messages.test.ts` exige paridad exacta: las 16 van en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`validFrom`, `validTo` y `assignedByUserId` se devuelven **crudos**, tal como estén en la fila. Se exponen porque son columnas de la tabla, no porque ninguna operación los gobierne.

**`003` — getById:**

```
{ ok, message, data: {
    userRoleId, userId, roleId, validFrom, validTo, assignedByUserId,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    user: { userId, username, firstName, lastName, email },
    role: { roleId, code, name, level }
} }
```

`username`, `firstName`, `lastName` y `email` se devuelven **descifrados** con `esaviDecrypt`.

**`002A` / `002B` — listado por usuario:** `data` es `{ count, user, rows }`. `user` sale **una sola vez por respuesta**, no una por fila — mismo criterio que SPEC F01 §3.7. `rows` tiene la forma de arriba **menos la clave `user`**.

```
{ ok, message, data: {
    count,
    user: { userId, username, firstName, lastName, email },
    rows: [ { userRoleId, userId, roleId, validFrom, validTo, assignedByUserId,
              isActive, createdAt, updatedAt, deletedAt, appDetails,
              role: { roleId, code, name, level } } ]
} }
```

**`006` — listado por rol:** simétrico. `role` sale una sola vez y cada fila lleva su `user` descifrado. Aquí el descifrado por fila es inevitable: identificar a los usuarios **es** el propósito del endpoint.

```
{ ok, message, data: {
    count,
    role: { roleId, code, name, level },
    rows: [ { userRoleId, userId, roleId, validFrom, validTo, assignedByUserId,
              isActive, createdAt, updatedAt, deletedAt, appDetails,
              user: { userId, username, firstName, lastName, email } } ]
} }
```

**`007` — masiva:** `data` es `{ count, rows }` con las filas creadas y reactivadas.

**`005A`, `005B`:** `{ ok, message }` **sin `data`**, según §10.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo. Los pasos 1 a 5 construyen la base sin exponer nada; a partir del 6 cada paso añade una operación. El paso 10 —el arreglo de `tokenValidation`— va **después** de que exista `005A`, para poder verificar en la misma sesión que revocar deja de autorizar.

1. **Registrar la abreviatura y las operaciones extra.** Añadir la fila `appUserRole` → `USERROLE` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y dos filas a la tabla de operaciones no canónicas: `006` listar por rol y `007` asignación masiva.
   *Verificación:* `USERROLE` aparece una sola vez en la tabla y no colisiona con `USER` ni `USERGEO`.

2. **Ajustar el modelo.** En `src/models/appUserRole.model.ts`, `appDetails` con `defaultValue: []` y `validFrom` con `defaultValue: sequelize.literal('current_timestamp')`. No se toca ninguna asociación.
   *Verificación:* `npm run build` en 0; un `AppUserRole.create({ userId, roleId })` deja `validFrom` con la hora del servidor de base de datos y `appDetails` como array.

3. **Tipos.** `src/types/user/appUserRole.types.ts` con las dos interfaces de §3.3, exportadas desde `src/types/user/index.ts`.
   *Verificación:* `import { CreateAppUserRoleInput } from '../types'` compila; `UpdateAppUserRoleInput` no existe en el repositorio.

4. **Las 16 claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

5. **Validadores.** `src/validators/appUserRole.validator.ts` con: `createAppUserRoleValidator` (`userId` y `roleId` UUID obligatorios; `validFrom` y `validTo` **rechazados** con 400), `bulkAssignRolesValidator` (`roleIds` array no vacío de UUID sin repetidos), `appUserRoleIdValidator`, `userIdParamValidator`, `roleIdParamValidator` y el validador de paginación de los listados. Alta en `src/validators/index.ts`.
   *Verificación:* enviar `validTo` en el cuerpo devuelve 400; `roleIds: []` devuelve 400; `roleIds` con el mismo UUID dos veces devuelve 400.

6. **`ESAVI-USERROLE-001` — asignar.** `assignAppUserRoleService` con los cuatro pasos de §3.5, incluidos los tres caminos del par y la guarda de escalada. Controlador que responde 201 o 200 según lo devuelto por el servicio. Ruta `POST /` con `validateUserRole(ADMIN)`. Alta del router en `src/routes/index.ts` bajo `/user-roles`.
   *Verificación:* asignar un par nuevo devuelve 201; repetirlo devuelve 409; revocarlo y repetirlo devuelve 200 sin insertar una segunda fila; un ADMIN asignando SUPERADMIN recibe 403; `assignedByUserId` es el del token aunque el cuerpo mande otro.

7. **`ESAVI-USERROLE-002A` y `002B` — listados por usuario.** Dos servicios y dos rutas (`GET /user/:userId` USER, `GET /admin/user/:userId` ADMIN), con `findAndCountAll`, orden `createdAt DESC` y paginación.
   *Verificación:* una asignación revocada no aparece en `/user/:userId` y sí en `/admin/user/:userId`; un USER recibe 403 en la ruta admin; `user` aparece una sola vez en `data`.

8. **`ESAVI-USERROLE-003` — obtener por ID.** `getAppUserRoleByIdService(id, lang, includeInactive)` con los dos includes de §3.7 y el descifrado de los campos PII. Ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una asignación revocada devuelve 404 para ADMIN y 200 para SUPERADMIN; `user.email` llega en claro.

9. **`ESAVI-USERROLE-005A` y `005B` — revocar y reinstaurar.** `setAppUserRoleActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. La revocación aplica antes la guarda del último SUPERADMIN; la reinstauración comprueba que el par no esté ocupado.
   *Verificación:* `DELETE` deja `isActive: false` y `deletedAt` con fecha, y **`validTo` sigue en `null`**; repetirlo devuelve 409; revocar el único SUPERADMIN devuelve 409; `PATCH /activate/:id` revierte ambos campos; las dos responden sin `data`.

10. **Arreglo de `tokenValidation`.** Filtrar `isActive: true` y `deletedAt: null` en el `through` de la `belongsToMany`, e `isActive: true` en `appRole`. Es el paso que convierte `005A` en una revocación real.
    *Verificación:* revocar el rol ADMIN de un usuario y reutilizar **su token anterior** contra una ruta ADMIN devuelve 403, no 200; un usuario con un rol activo sigue autorizándose igual; `npm test -- roles` sigue pasando.

11. **`ESAVI-USERROLE-006` — listar por rol.** `getAppUserRolesByRoleService` con `include` del `user` descifrado. Ruta `GET /role/:roleId` con `validateUserRole(ADMIN)`, declarada antes de `/:id`.
    *Verificación:* consultar el rol SUPERADMIN devuelve la nómina de superadministradores con su PII en claro; un USER recibe 403; un `roleId` inexistente devuelve 404.

12. **`ESAVI-USERROLE-007` — asignación masiva.** Servicio transaccional todo o nada, con la comprobación de roles en una sola consulta `[Op.in]` y la guarda de escalada sobre todos ellos. Ruta `POST /bulk` con `validateUserRole(ADMIN)`, declarada antes de `/:id`.
    *Verificación:* asignar dos roles devuelve 201 con `count: 2`; si uno no existe devuelve 404 y **ninguno** se creó; si uno excede el nivel devuelve 403 y ninguno se creó; si uno ya está activo devuelve 409 y ninguno se creó.

13. **Cubrir las ocho rutas en `tests/auth/roles.test.ts`.** Ocho filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de 43 a 51 en `tests/auth/roles.test.ts:137`.
    *Verificación:* `npm test -- roles` pasa.

14. **Suite de contrato `tests/contract/appUserRole.test.ts`.** Recorrido con `supertest`: asignar → obtener por ID → listar por usuario (público y admin) → listar por rol → revocar → reinstaurar → asignar sobre par revocado (200) → masiva. Más los caminos de error: par activo duplicado, escalada de privilegio, último SUPERADMIN, masiva con un rol inexistente y su reversión, y la revocación efectiva contra un token ya emitido.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las ocho rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones.
- [ ] `grep -rn "ESAVI-USERROLE-002[^AB]" src/` no devuelve resultados.
- [ ] `grep -rn "ESAVI-USERROLE-004" src/` no devuelve resultados: la operación no existe.
- [ ] `grep -rn "USERROLE" references/CONVENTIONS.md` devuelve la fila de la tabla de abreviaturas y las dos de operaciones no canónicas.
- [ ] Asignar un par `(userId, roleId)` nuevo devuelve **201**.
- [ ] Asignar el mismo par estando activo devuelve **409**, no 500 por el índice parcial.
- [ ] Asignar el mismo par estando revocado devuelve **200**, deja `deletedAt: null` y **no** inserta una segunda fila.
- [ ] `SELECT count(*) FROM "appUserRole" GROUP BY "userId", "roleId" HAVING count(*) > 1` no devuelve filas tras ejecutar la suite de contrato.
- [ ] Un ADMIN asignando el rol SUPERADMIN recibe **403**; asignando ADMIN o inferior, **201**.
- [ ] Un ADMIN puede asignarse a sí mismo un rol de nivel igual o inferior.
- [ ] `assignedByUserId` es el `userId` del token aunque el cuerpo envíe otro valor.
- [ ] Enviar `validFrom` o `validTo` en el cuerpo de `001` o `007` devuelve **400**.
- [ ] `SELECT count(*) FROM "appUserRole" WHERE "validTo" IS NOT NULL` devuelve **0** tras la suite de contrato.
- [ ] Toda fila creada por la API tiene `validFrom` con la hora del servidor de base de datos.
- [ ] `GET /user/:userId` no devuelve asignaciones revocadas; `GET /admin/user/:userId` sí, y responde **403** a un USER.
- [ ] Los dos listados por usuario devuelven `data` como `{ count, user, rows }`, con `user` **una sola vez** y su PII descifrada.
- [ ] `GET /role/:roleId` devuelve `{ count, role, rows }` con el `user` descifrado en cada fila y responde **403** a un USER.
- [ ] `GET /:id` devuelve `user` y `role`, con los cuatro campos PII de `user` **descifrados**.
- [ ] `GET /:id` de una asignación revocada: 404 para USER y ADMIN, 200 para SUPERADMIN.
- [ ] `DELETE /:id` deja `isActive: false`, `deletedAt` con fecha y **`validTo` intacto en `null`**.
- [ ] Revocar la última asignación activa del rol SUPERADMIN devuelve **409**; con dos SUPERADMIN activos, la primera revocación devuelve **200**.
- [ ] `PATCH /activate/:id` revierte los dos campos y exige SUPERADMIN.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` **sin `data`**.
- [ ] Tras revocar el rol ADMIN de un usuario, **su token anterior** recibe **403** en una ruta ADMIN.
- [ ] Un usuario cuyo `appRole` está inactivo no autoriza con ese rol.
- [ ] `POST /bulk` con dos roles válidos devuelve **201** con `count: 2`.
- [ ] `POST /bulk` con un rol inexistente devuelve **404** y **ninguna** fila se creó.
- [ ] `POST /bulk` con un rol de nivel superior al propio devuelve **403** y ninguna fila se creó.
- [ ] `POST /bulk` con `roleIds: []` o con UUID repetidos devuelve **400**.
- [ ] `GET /:id` no captura `bulk`, `user`, `admin`, `role` ni `activate` como UUID.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `appDetails.method` guarda `'ESAVI-USERROLE-005A'` y `'ESAVI-USERROLE-005B'`, sin sufijos `_ACTIVATION` ni `_DEACTIVATION`.
- [ ] Ningún servicio escribe `sysDetails`: lo pone el trigger.
- [ ] `src/helpers/permissions.helper.ts` no cambia; sigue exportando los mismos siete predicados.
- [ ] El tipo `AuthUser` no cambia y `req.user` conserva la misma forma.
- [ ] `src/services/user.service.ts` no cambia: sigue asignando roles en su propia transacción.
- [ ] Las 16 claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 51 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la vigencia temporal**

- **Sí:** `isActive` es el único gobernador del estado. `validFrom` y `validTo` quedan fuera del alcance funcional. Una asignación de rol está vigente o no lo está; la caducidad automática no se ha pedido y añadirla duplicaría el estado con dos mecanismos que hay que mantener sincronizados.
- **No:** replicar la semántica de SPEC F01, donde `005A` escribe `validTo` junto con `isActive` y los listados aceptan `?current=`. Es la decisión correcta allí —la cobertura territorial sí es temporal— y coste sin beneficio aquí.
- **Sí:** `validFrom` se deja al default del DDL y `validTo` en `null`. Las columnas existen y se devuelven en la respuesta, pero ninguna operación las gobierna. Que el `CHECK` `CK_appUserRole_dates` sea inviolable mientras `validTo` sea `null` es la consecuencia útil: este spec no necesita el 409 `INVALID_DATE_RANGE`.
- **No:** eliminar las columnas del DDL. Modificar el esquema afecta a datos ya cargados y a la carga de `esaviapp.sql` en los tests. Se dejan sin uso, documentadas.
- **No:** filtrar `validTo` en `tokenValidation` para alinearse con `getUserPermissions`. Sería coherente con el DDL, pero incoherente con la decisión de que `isActive` manda. El riesgo residual está en §7.

**Sobre la operación `004`**

- **Sí:** `004` no existe en esta entidad, y el número queda reservado sin usar. Sin vigencia editable, una asignación no tiene ningún campo mutable: `userId` y `roleId` la definen, `isActive` es de `005A`/`005B`.
- **No:** un `PUT /:id` que cambie el `roleId`. Convertiría el update en una reasignación encubierta, con dos filas tocadas donde el verbo promete una.
- **No:** reasignar como operación propia, al estilo del `006` de USERGEO. En geografía mover a alguien de territorio es un acto único; en roles, revocar y asignar son dos decisiones distintas que conviene auditar por separado.

**Sobre la escalada de privilegio**

- **Sí:** solo se asigna un rol de nivel **menor o igual** al propio. Un ADMIN puede crear ADMINs, nunca SUPERADMINs. Es la regla habitual y no rompe el flujo de alta de usuarios, donde un ADMIN da de alta a otros ADMIN.
- **No:** exigir nivel **estrictamente menor**. Impediría que un ADMIN nombre a otro ADMIN, que es precisamente lo que hace hoy `createUserService`.
- **No:** exigir SUPERADMIN en `001` y olvidarse de comparar niveles. Más simple, pero se desvía de la matriz canónica de §9 y convierte cada alta de usuario ordinaria en una tarea de superadministrador.
- **Sí:** la guarda vive en el **servicio**, no en la ruta. §9 lo manda explícitamente: una regla que no se expresa por umbral de nivel no puede estar en `validateUserRole`, que compara contra un valor fijo y no contra el cuerpo de la petición.
- **Sí:** la guarda responde **403**, aunque §10 atribuya ese status a `validateUserRole`. Es un fallo de autorización, no un conflicto de datos: devolver 409 haría que el cliente lo confundiera con un duplicado. Es la primera vez que un servicio del repositorio emite 403 y queda escrito aquí.
- **Sí:** la auto-asignación lateral queda permitida. La guarda de nivel cierra el único caso peligroso; prohibirla además bloquearía al único SUPERADMIN de un despliegue recién instalado, que no tiene a nadie por encima que le ajuste sus propios roles.
- **No:** prohibir tocar los propios roles salvo a SUPERADMIN. Introduce una excepción por nombre de rol dentro del servicio que no existe en ningún otro sitio del repositorio.

**Sobre el último SUPERADMIN**

- **Sí:** `005A` rechaza revocar la última asignación activa del rol SUPERADMIN. `005B` exige SUPERADMIN, así que sin la guarda el sistema queda sin nadie capaz de deshacer la revocación, y la única salida es SQL contra producción.
- **Sí:** la guarda identifica el rol por `appRole.code` comparado con `ROLES.SUPERADMIN`. `UQ_appRole_code` garantiza que el código es único; `name` no tiene ninguna restricción de unicidad. Que `permissions.helper.ts` compare por `name` es una incoherencia previa, catalogada en §7.
- **Sí:** el recuento exige que el **usuario** de la otra asignación también esté activo. Un SUPERADMIN de reserva sobre un usuario desactivado no puede iniciar sesión, así que no cuenta como salvavidas.
- **No:** extender la guarda a "el usuario no puede quedarse sin ningún rol". Un usuario sin roles es un estado legítimo: existe, puede autenticarse y no puede hacer nada. Bloquearlo impediría retirar privilegios a alguien que se va.

**Sobre `tokenValidation`**

- **Sí:** el arreglo entra en este spec. Un `DELETE` que no revoca es peor que no tener `DELETE`: promete una garantía de seguridad que no cumple.
- **Sí:** el filtro va en el `include` de la `belongsToMany` existente (`auth.associations.ts:16`), no en una consulta nueva. La asociación ya está declarada y el `through` admite `where`.
- **No:** llamar a la función `getUserPermissions` del DDL desde el middleware. Resuelve permisos finos que hoy no se usan en ninguna parte, y ataría la autenticación a una función almacenada.
- **Sí:** filtrar también `appRole.isActive`. Desactivar un rol entero —por ejemplo retirar ANALYTICS del sistema— debe dejar de autorizar sin tener que revocar asignación por asignación.
- **No:** invalidar los tokens ya emitidos. `tokenValidation` recarga los roles desde la base de datos en **cada** petición (`:37-49`), así que el cambio surte efecto en la siguiente llamada sin tocar la emisión de tokens.

**Sobre los listados**

- **Sí:** listado por rol como `006`. Auditar quién tiene SUPERADMIN es un consumidor real, y §6 reserva los sufijos `A`/`B` para variantes de la misma operación, no para operaciones distintas. Por eso no es `002C`.
- **No:** un `002C`/`002D` público y admin para el listado por rol. Estiraría la numeración de listado en una segunda dimensión y haría que `002` dejara de significar una cosa.
- **Sí:** `006` exige ADMIN y no tiene variante pública. La nómina de administradores no es información que un USER necesite.
- **Sí:** `user` una sola vez en `002A`/`002B` y `role` una sola vez en `006`. Es el criterio que SPEC F01 §3.7 fijó, y evita repetir el mismo objeto y sus tres descifrados `count` veces.
- **Sí:** en `006` el `user` sí va dentro de cada fila, descifrado. Identificar a los usuarios es el propósito del endpoint; ahí el descifrado por fila no es un coste evitable.

**Sobre la forma**

- **Sí:** una sola fila por `(userId, roleId)`, para siempre, reactivando en vez de insertar. Mismo criterio que SPEC F01: hace el estado legible de un vistazo y elimina la pregunta "¿cuál de las tres filas manda?".
- **Sí:** `001` reactiva y devuelve **200** en vez de 201. El cliente no conoce el `userRoleId` de una fila revocada que sus listados no le muestran, así que obligarle a `PATCH /activate/:id` sería obligarle a adivinar.
- **No:** normalizar con `toConstantCase` o `toTitleCase`. La entidad no tiene ningún campo de texto propio.
- **No:** cifrar ningún campo con `esaviCrypt`. No hay PII propia en la tabla; los UUID no son datos personales. La PII que aparece en la respuesta viene de `appUser` y se descifra al leer.
- **No:** migrar la asignación de roles de `createUserService` al servicio nuevo. Es un refactor con riesgo sobre el único flujo transaccional del repositorio, y no aporta nada a la superficie que este spec entrega.
- **No:** exponer `appRole`, `appPermission` ni `appRolePermission`. Este spec asume que los roles ya existen; el CRUD de roles y el modelo de permisos finos son otros specs.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El arreglo de `tokenValidation` puede dejar sin acceso a usuarios cuyas filas de `appUserRole` tengan hoy `isActive: false` o `deletedAt` poblado por SQL directo | Antes del paso 10, comprobar con `SELECT count(*) FROM "appUserRole" WHERE "isActive" = false OR "deletedAt" IS NOT NULL` cuántas filas cambian de comportamiento. Es el paso más sensible del plan y por eso va aislado en su propio commit |
| Una fila con `validTo` vencido cargada por SQL directo seguiría autorizando, porque el filtro nuevo no mira `validTo` | Consecuencia aceptada de que `isActive` gobierna. La API nunca escribe `validTo`, así que solo puede ocurrir por escritura externa. Si aparece un caso real, el spec de vigencia lo resuelve |
| El índice parcial del DDL permite lo que la aplicación prohíbe: por SQL directo pueden convivir dos filas del mismo par | La invariante se verifica en la suite con la consulta `GROUP BY … HAVING count(*) > 1` de §5. Un `UNIQUE` total lo cerraría de verdad, pero es cambio de esquema y va en otro spec |
| La guarda del último SUPERADMIN identifica el rol por `code`, mientras `permissions.helper.ts:8-11` lo compara por `name` | Incoherencia previa al spec, no introducida por él. `code` es la elección correcta porque tiene `UQ_appRole_code`; unificar el criterio en el helper es un cambio transversal que va aparte |
| `ROLES.SUPERADMIN` sale de `src/constants/roles.constants.ts`, que lee variables de entorno inexistentes (DEUDA-031) | El valor cae en el literal `'SUPERADMIN'` por el `\|\|`, que es el código real en base de datos. La guarda funciona hoy; si DEUDA-031 se resuelve cambiando los nombres, esta guarda es uno de los sitios a revisar |
| Entre la comprobación del último SUPERADMIN y el `UPDATE` puede colarse otra revocación concurrente, dejando el sistema sin ninguno | La comprobación y la escritura van en la **misma transacción** que ya abre `setAppUserRoleActivationService`. Es una ventana estrecha con dos administradores revocando a la vez; no se añade bloqueo explícito de fila |
| La guarda de escalada lee `req.user.roles[].level`, que puebla `tokenValidation` desde `appRole.level` — una columna que hoy nadie mantiene | El paso 6 verifica explícitamente el 403 de un ADMIN asignando SUPERADMIN. Si `level` estuviera mal poblado en base de datos, la verificación falla y se detecta en el mismo paso |
| `GET /:id` captura `bulk`, `user`, `admin`, `role` o `activate` como UUID | Las cinco rutas literales se declaran antes que `/:id`; cubierto por un criterio de aceptación propio |
| `007` es transaccional; una transacción mal cerrada deja conexiones colgadas | Sigue el patrón de `createUserService`, que ya usa `commit()` y `rollback()` en el `catch`. La verificación del paso 12 comprueba explícitamente las tres reversiones |

---

## 8. Impacto en el contrato HTTP

El spec añade ocho endpoints nuevos, que por sí solos no cambiarían nada de lo que reciben los clientes. El arreglo de `tokenValidation` **sí**:

| Situación | Antes | Después |
|---|---|---|
| Petición con un token cuyo usuario tiene una asignación de rol con `isActive: false` | El rol autoriza igual: **200** | El rol no cuenta: **403** si era el único que daba nivel suficiente |
| Petición cuyo usuario tiene una asignación con `deletedAt` poblado | El rol autoriza igual | El rol no cuenta |
| Petición cuyo usuario tiene un rol cuyo `appRole.isActive` es `false` | El rol autoriza igual | El rol no cuenta |
| Usuario sin ningún rol activo restante | Podía seguir operando con roles revocados | Solo pasa las rutas sin `validateUserRole` |

No cambia la forma de `req.user`, ni el tipo `AuthUser`, ni la emisión de tokens: los tokens ya emitidos siguen siendo válidos, porque el middleware siempre recargó los roles desde la base de datos en cada petición.

---

## Lo que **no** está en este spec

- Vigencia temporal de las asignaciones: `validFrom` y `validTo` se quedan sin gobierno.
- Una operación `004` de actualización para esta entidad.
- Reasignar un rol por otro en una sola operación transaccional.
- Baja masiva de asignaciones.
- CRUD de `appRole`: los roles no se crean, editan ni listan por la API.
- `appPermission`, `appRolePermission` y la función `getUserPermissions`.
- Sustituir `ROLE_LEVELS` por la columna `appRole.level` en `validateUserRole`.
- Unificar el criterio `code` frente a `name` en `permissions.helper.ts`.
- Migrar la asignación de roles de `createUserService` al servicio nuevo.
- Histórico de varias filas por el mismo par `(userId, roleId)`.
- Cambiar el índice único parcial del DDL por un `UNIQUE` total.
- Invalidar los tokens ya emitidos al revocar un rol.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
