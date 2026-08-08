# SPEC F04 — CRUD completo de appUser

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Relacionado con:** SPEC F02 (`appUserRole`), que gobierna los roles de un usuario y cuya guarda de escalada se replica aquí en `001`; y SPEC F03 (`appRole`), que hace que `appRole.level` sea la fuente del nivel con el que esa guarda compara
> **Fecha:** 2026-08-05
> **Objetivo:** Completar las siete operaciones canónicas de `appUser` sobre el único `001` que existe hoy, y añadir el cambio de contraseña y la consulta del propio perfil, que hoy no tienen forma de ejecutarse.
>
> **Enmienda del 2026-08-08 (durante la implementación):** `statusItemId` y `lastLoginAt` **salen del alcance**. `esaviapp.sql:248-249` las declara, pero las bases de datos ya desplegadas se crearon con un esquema anterior y no las tienen; como el DDL usa `CREATE TABLE IF NOT EXISTS`, volver a ejecutarlo no las añade. Antes que arrastrar una migración en un spec de CRUD, se decidió no tocar esas dos columnas. Todo lo que dependía de ellas —el ajuste del modelo, la asociación con `catalogItem`, la validación contra el catálogo `userStatus` en `001` y `004`, y la escritura de `lastLoginAt` en el login— queda **fuera**, y las secciones de abajo se leen con esa enmienda por delante. La normalización del correo en el login **sí se implementó**.

---

## 1. Por qué existe este spec

`appUser` es la entidad de identidad del sistema: sin ella no hay autenticación, ni autorización, ni auditoría —`appDetails.user` guarda un `userId` en cada escritura de todas las demás tablas—. Tiene los siete artefactos y, aun así, **una sola operación**: `ESAVI-USER-001`, en `src/routes/user.routes.ts:12`. La única otra puerta de entrada es `POST /api/auth/login`.

La consecuencia es directa: **un usuario dado de alta no se puede consultar, listar, corregir, desactivar ni reactivar por la API.** Un correo mal tecleado, un apellido cambiado o la baja de alguien que se va de la organización exigen SQL directo contra producción. Y como los campos van cifrados con `esaviCrypt`, ese SQL directo tampoco es trivial: hay que cifrar el valor fuera de la aplicación para poder buscarlo.

Cuatro desajustes verificados que este spec resuelve:

**A — El modelo ignora dos columnas que el SQL sí tiene.** *(Fuera de alcance por la enmienda: las bases desplegadas no tienen esas columnas.)* `esaviapp.sql:248-249` declara `statusItemId` (FK a `catalogItem`) y `lastLoginAt`, y ninguna de las dos existe en `src/models/appUser.model.ts`. `lastLoginAt` no se escribe nunca: `src/services/auth.service.ts:17-57` autentica, genera el token y no deja rastro de cuándo. Es el dato que responde "¿quién sigue usando el sistema?", y hoy la respuesta solo está en los logs. El catálogo `userStatus` está sembrado en `esaviapp.sql:1579-1582` con `ACTIVE`, `INACTIVE`, `LOCKED` y `PENDING_ACTIVATION`, esperando a que alguien lo use.

**B — La unicidad está mal delimitada, y por partida doble.** `src/services/user.service.ts:18-24` busca el correo existente filtrando por `isActive: true`, contra el canon de §11: un correo ocupado por un usuario dado de baja **sigue ocupado** para `UQ_appUser_email`, así que la validación lo deja pasar y Postgres lo rechaza con `23505` — el cliente recibe **500** donde le corresponde **409**. Y `username` no se comprueba en absoluto: `UQ_appUser_username` existe en `esaviapp.sql:257` y el servicio no lo mira, con el mismo desenlace.

**C — `requiresPasswordChange` es una promesa que nadie puede cumplir.** `user.service.ts:55` pone la bandera en `true` en cada alta —el usuario recibe una contraseña elegida por otra persona— y `seed.controller.ts:55` la pone en `false` para el superadministrador inicial. **Ninguna línea del repositorio la lee**, y no existe ningún endpoint para cambiar la contraseña. El flujo que el `001` actual describe no tiene final.

**D — Residuos en los artefactos existentes.** `appUser.model.ts:71` declara `phone` como `STRING(150)` donde el SQL dice `varchar(50)`. El comentario de `user.routes.ts:11` es `// POST /api/users - Create a new user (SUPERADMIN only)`, que no sigue el formato de dos líneas con `// Code:` de §7. `createUserValidator` no valida `username` ni `phone`, y exige `roleId` como UUID único (`user.validator.ts:8`) mientras `CreateUserInput` lo declara `string | string[]` — enviar el array que el tipo promete devuelve 400. `appDetails` no tiene `defaultValue: []`. Y `user.service.ts:3-5` importa los tres modelos por ruta directa en vez de desde el barrel.

Dos divergencias que **no** son desajustes y se documentan en §3.2: `email` y `passwordHash` son `allowNull: false` en el modelo y nulables en el SQL, deliberadamente; y `externalProvider`/`externalSubject` existen sin uso porque la autenticación externa está fuera del MVP.

---

## 2. Alcance

**Dentro:**

- Las **seis operaciones canónicas que faltan**: `002A` listar, `002B` listar para administración, `003` obtener por ID, `004` actualizar, `005A` desactivar y `005B` reactivar. El `001` ya existe y se corrige.
- **Dos operaciones no canónicas:** `006` cambiar la propia contraseña (`PATCH /me/password`) y `007` consultar el propio perfil (`GET /me`). Se registran en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6, siguiendo el precedente de `USERGEO`.
- **`001` baja de SUPERADMIN a ADMIN**, alineándose con la matriz canónica de §9, **con guarda de escalada**: un ADMIN solo puede dar de alta usuarios con roles de nivel menor o igual al suyo; un SUPERADMIN puede asignar cualquiera. Es la misma guarda que SPEC F02 §3.5 aplica a `USERROLE-001`, aquí sobre el `roleId` del alta.
- **Ajustes del modelo:** `phone` corrige su longitud de 150 a 50; `appDetails` recibe `defaultValue: []`. *(Enmienda: `statusItemId` y `lastLoginAt` no se añaden.)*
- **Unicidad corregida:** `email` y `username` se comprueban **sin filtrar por `isActive`**, sobre el valor ya cifrado, y excluyendo el propio registro en update con `[Op.ne]`. `username` solo se comprueba cuando viene, porque es opcional; sin la comprobación, `UQ_appUser_username` devolvería 500 en vez de 409.
- **Normalización del correo en el login**, igual que en el alta. Es la única modificación de `src/services/auth.service.ts`. *(Enmienda: `lastLoginAt` no se escribe.)*
- **Normalización antes de cifrar:** `email` a minúsculas y `.trim()`, `firstName` y `lastName` con `toTitleCase`, `username` con `.trim()`. `displayName` se recalcula desde `firstName` y `lastName` en `001` y en `004`, y nunca se acepta en el cuerpo.
- **Guardas de `005A`:** un usuario no puede desactivarse a sí mismo (409), y no se puede desactivar al último SUPERADMIN activo del sistema (409).
- **Los cuatro validadores de §4 completos**, más el de `006`. La longitud mínima de contraseña sube de 6 a **8** en `001` y en `006`.
- **Limpieza de los residuos de §1.D:** comentario de ruta en formato de dos líneas con `// Code:`, modelos importados desde el barrel, y `roleId` coherente entre el validador y `CreateUserInput`.
- Claves i18n nuevas en `src/data/i18n/es.json`, `en.json` y `nl.json`.
- Ocho filas nuevas en `ROUTE_RULES` (43 → 51) y suite `tests/contract/appUser.test.ts`.

**Fuera de alcance (otros specs):**

- **Autenticación externa.** `externalProvider` y `externalSubject` se quedan en el modelo, sin uso y sin borrarse. Ninguna operación los lee ni los escribe. No está contemplado en el MVP.
- **Sesiones.** La tabla `appSession` (`esaviapp.sql:341-360`) existe y sigue sin modelo. Cambiar la contraseña **no invalida el token en curso**, porque no hay dónde revocarlo.
- **Restablecer la contraseña de un tercero.** `006` actúa siempre sobre el usuario del token; ni un SUPERADMIN cambia la de otro. Es un endpoint distinto, con sus propias decisiones de seguridad.
- **Recuperación de contraseña por correo** y **bloqueo por intentos fallidos**. El ítem `LOCKED` del catálogo `userStatus` se queda sin quien lo escriba.
- **Cambiar los roles de un usuario existente.** `004` no acepta `roleId`: asignar y revocar roles es SPEC F02.
- **`statusItemId` y `lastLoginAt` por completo** *(enmienda del 2026-08-08)*. Las dos columnas se quedan en `esaviapp.sql` sin modelo ni consumidor, como `externalProvider`. Incorporarlas exige una migración sobre las bases ya desplegadas, y eso va en su propio spec. Con ellas se caen la asociación `appUser` ↔ `catalogItem`, la validación contra el catálogo `userStatus`, la clave `user.statusNotFound` y los códigos `USER_001_STATUS_NOT_FOUND` / `USER_004_STATUS_NOT_FOUND`.
- **Filtros y búsqueda en el listado.** Solo `limit` y `offset`. Buscar por nombre o correo es imposible sobre campos cifrados sin un cambio de esquema, y ordenar por ellos ordenaría por el criptograma.
- **Cambiar el esquema de cifrado o migrar los datos ya cifrados.** `esaviCrypt` se usa tal cual está.
- **CRUD de `appUserGeoLocation` (SPEC F01) y de `appUserRole` (SPEC F02).**
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`appUser` — `esaviapp.sql:237-263`. La tabla ya existe y **no se altera**; `username` ya es nulable en el DDL del repositorio.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `userId` | `uuid` | no | PK, `gen_random_uuid()` |
| `username` | `citext` | sí | `UQ_appUser_username` — cifrado |
| `email` | `citext` | sí | `UQ_appUser_email` — cifrado; el modelo lo exige (§3.2) |
| `passwordHash` | `text` | sí | bcrypt; el modelo lo exige (§3.2) |
| `externalProvider` | `varchar(100)` | sí | **sin uso**, fuera de alcance |
| `externalSubject` | `varchar(200)` | sí | **sin uso**, fuera de alcance |
| `displayName` | `varchar(250)` | no | cifrado; calculado, nunca recibido |
| `firstName` | `varchar(150)` | sí | cifrado |
| `lastName` | `varchar(150)` | sí | cifrado |
| `phone` | `varchar(50)` | sí | **sin cifrar**; el modelo declara 150 |
| `statusItemId` | `uuid` | sí | FK → `catalogItem`, **ausente del modelo** |
| `lastLoginAt` | `timestamptz` | sí | **ausente del modelo**, nunca escrito |
| `requiresPasswordChange` | `bool` | no | default `false` |
| `isActive` | `bool` | no | default `true` |
| `createdAt` | `timestamptz` | no | default `current_timestamp` |
| `updatedAt` / `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | default `'{}'` — lo escribe el trigger |
| `appDetails` | `jsonb` | no | default `'{}'` — el servicio escribe **array** |

**Restricciones:** `UQ_appUser_username`, `UQ_appUser_email`, `FK_appUser_statusItem` → `catalogItem("catalogItemId")` `ON UPDATE CASCADE ON DELETE RESTRICT`, y `CK_appUser_authSource` — `CHECK ("passwordHash" IS NOT NULL OR "externalSubject" IS NOT NULL)`. Con la autenticación externa fuera de alcance, este `CHECK` **nunca puede violarse**: el modelo exige `passwordHash`.

**Índices:** `IX_appUser_statusItemId`, `IX_appUser_active` sobre `("isActive") WHERE "deletedAt" IS NULL`.

**Triggers:** `TRG_appUser_setSysDetails`, del bloque genérico de `esaviapp.sql:1276-1294`, y `TRG_appUser_preventPhysicalDelete`, del de `esaviapp.sql:1360-1375`. **No hay ningún trigger que valide `statusItemId` contra su catálogo** —a diferencia de `healthFacility`, que sí tiene `TRG_healthFacility_validateCatalogs`—, así que la validación es responsabilidad exclusiva del servicio.

**Tablas relacionadas que se consultan pero no se modifican:**

- `catalogItem` / `catalogType` — el `statusItemId` debe pertenecer al catálogo `userStatus`, sembrado en `esaviapp.sql:1579-1582` con `ACTIVE`, `INACTIVE`, `LOCKED` y `PENDING_ACTIVATION`.
- `appUserRole` y `appRole` — se consultan en `001` para validar los roles del alta, en `003`/`007` para devolverlos, y en `005A` para la guarda del último SUPERADMIN.

### 3.2 Modelo Sequelize

`src/models/appUser.model.ts` **ya existe**, clase `AppUser`, dada de alta en `src/models/index.ts`. Cumple §12: `timestamps: false`, `freezeTableName: true`, `tableName: 'appUser'`, PK UUID con `sequelize.literal('gen_random_uuid()')`.

Dos ajustes *(los otros dos, `statusItemId` y `lastLoginAt`, caen por la enmienda)*:

| Antes | Después |
|---|---|
| `phone: { type: STRING(150) }` | `STRING(50)` — alineado a `esaviapp.sql:247` |
| `appDetails: { allowNull: true }` | `defaultValue: []`, como `geoLocation.model.ts:114` |

Y dos divergencias con el DDL que **se mantienen a propósito**:

- **`email` sigue en `allowNull: false`** aunque el SQL lo permita nulo. Sin autenticación externa, un usuario sin correo no puede iniciar sesión: `loginService` busca precisamente por ahí.
- **`passwordHash` sigue en `allowNull: false`** por la misma razón. Es lo que hace que `CK_appUser_authSource` sea inviolable mientras el MVP no tenga autenticación externa. La aplicación puede ser más estricta que el esquema; al revés, no.

**Ninguna asociación nueva** *(enmienda: el enlace con `catalogItem` bajo el alias `status` se cae con `statusItemId`)*. Las seis asociaciones de `appUser` con `appUserRole` y `appRole` ya están declaradas en ese mismo archivo (`:7-8`, `:13-14`, `:16-17`) y no se tocan.

### 3.3 Tipos

`src/types/user/user.types.ts` **ya existe**. Se corrige `CreateUserInput` y se añade una interfaz para `006`:

```ts
export interface CreateUserInput {
    username?: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    roleId: string | string[];
}

export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
}
```

`phone` se añade *(enmienda: `statusItemId` no)*; `roleId` se queda como `string | string[]` y **el validador se alinea a esa forma**, en vez de al revés — hoy `user.validator.ts:8` rechaza el array que el tipo promete.

Para `004` **no se declara `UpdateUserInput`** — está prohibido por §4. El update usa `Partial<CreateUserInput>`, del que el servicio ignora `password` y `roleId`: el primero es territorio de `006`, el segundo de SPEC F02.

`UserRole`, `AuthUser` y `CreateUserServiceParams` **no cambian**.

### 3.4 Superficie HTTP

```
POST   /api/users                    ESAVI-USER-001   ADMIN       (existe, cambia de rol)
GET    /api/users                    ESAVI-USER-002A  ADMIN       (nuevo)
GET    /api/users/admin              ESAVI-USER-002B  ADMIN       (nuevo)
GET    /api/users/me                 ESAVI-USER-007   USER        (nuevo)
PATCH  /api/users/me/password        ESAVI-USER-006   USER        (nuevo)
GET    /api/users/:id                ESAVI-USER-003   ADMIN       (nuevo)
PUT    /api/users/:id                ESAVI-USER-004   ADMIN       (nuevo)
DELETE /api/users/:id                ESAVI-USER-005A  ADMIN       (nuevo)
PATCH  /api/users/activate/:id       ESAVI-USER-005B  SUPERADMIN  (nuevo)
```

El router ya está dado de alta en `src/routes/index.ts:26` bajo `/users`.

**`002A` y `002B` exigen los dos ADMIN**, no USER. Es la desviación de la matriz canónica de §9 que se decidió: un listado de usuarios devuelve nombres, correos y teléfonos descifrados de toda la plantilla. La diferencia entre ambos sigue siendo la de siempre — `002B` incluye los desactivados—, y `002B` no sube a SUPERADMIN porque `canViewInactive` ya distingue quién ve qué dentro de `003`.

*(Enmienda: `statusItemId` no viaja en ningún cuerpo y `status` no aparece en ninguna respuesta.)*

**`006` y `007` extienden el rango `001`–`005B`** de §6, siguiendo el precedente que abrió `appUserGeoLocation`. Se registran en la tabla de operaciones no canónicas.

**Orden de declaración en `user.routes.ts`:** las cuatro rutas literales (`/admin`, `/me`, `/me/password`, `/activate/:id`) van **antes** de `/:id`, o Express capturará `admin` y `me` como un `:id` y el validador de UUID responderá 400.

### 3.5 Reglas de negocio por operación

**Cifrado — invariante global.** `username`, `email`, `firstName`, `lastName` y `displayName` se guardan cifrados con `esaviCrypt` y se devuelven descifrados con `esaviDecrypt`. Toda búsqueda por esos campos es **por igualdad sobre el valor cifrado** (`where: { email: esaviCrypt(email) }`), que es lo que permite el IV fijo del helper. `phone` **no se cifra** — no lo está hoy y cambiarlo obligaría a migrar los datos existentes. `passwordHash` se excluye de **todas** las respuestas con `attributes: { exclude: ['passwordHash'] }`.

**Normalización antes de cifrar.** `email` a minúsculas y `.trim()`; `firstName` y `lastName` con `toTitleCase`; `username` con `.trim()`, sin tocar mayúsculas. El orden importa: normalizar **después** de cifrar produciría un criptograma distinto para el mismo valor y rompería las búsquedas por igualdad.

**`displayName` es calculado, nunca recibido.** Se compone como `` `${firstName} ${lastName}` `` —ya normalizados— y se cifra. `001` lo hace hoy (`user.service.ts:53`) y `004` pasa a recalcularlo cuando cambie cualquiera de los dos. Enviarlo en el cuerpo devuelve **400**.

**`ESAVI-USER-001` — crear.** Se corrige, en este orden:

1. Normaliza y cifra los cinco campos.
2. `email` libre → si no, **409** `USER_001_EMAIL_EXISTS`, clave `user.alreadyExists`. **Sin filtrar por `isActive`**: es lo que garantiza `UQ_appUser_email`.
3. Si viene `username`, libre → si no, **409** `USER_001_USERNAME_EXISTS`, clave `user.usernameExists`. Misma regla.
4. Los roles de `roleId` existen y están activos, en una sola consulta → si no, **404** `USER_001_ROLE_NOT_FOUND`, clave `role.notFound` (comportamiento actual, se conserva).
5. **Guarda de escalada:** ningún rol pedido puede tener `appRole.level` mayor que el nivel máximo del solicitante → **403** `USER_001_ROLE_LEVEL_EXCEEDED`, clave `user.roleLevelExceeded`. Un ADMIN da de alta ADMIN o inferior; un SUPERADMIN, cualquiera.
6. Crea el usuario y sus filas de `appUserRole` **en la transacción que ya existe**, con `requiresPasswordChange: true`.

Responde **201**. El servicio pasa a importar los modelos desde `'../models'`.

**`ESAVI-USER-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, `include` de `roles`, orden `[['createdAt', 'DESC']]` y paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. **El orden no puede ser alfabético**: los nombres están cifrados y `ORDER BY` ordenaría por el criptograma. Sin filtros por query más allá de `limit` y `offset`.

**`ESAVI-USER-002B` — listar, administración.** Idéntico, **sin `isActive` en el `where`**.

**`ESAVI-USER-003` — obtener por ID.** Existencia → **404** `USER_003_NOT_FOUND`. Un usuario desactivado devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — hoy **SUPERADMIN**, según `permissions.helper.ts:24-26`. Incluye `roles` *(enmienda: ya no hay `status`)*.

**`ESAVI-USER-004` — actualizar.** Acepta **solo** `username`, `email`, `firstName`, `lastName` y `phone` *(enmienda: `statusItemId` se cae)*. En este orden:

1. Existencia → **404** `USER_004_NOT_FOUND`.
2. Si viene `email`, normalizado, cifrado y distinto del actual: unicidad excluyendo el propio id con `{ [Op.ne]: id }` → **409** `USER_004_EMAIL_EXISTS`.
3. Si viene `username`: misma comprobación → **409** `USER_004_USERNAME_EXISTS`.
4. Si cambió `firstName` o `lastName`, recalcula y cifra `displayName`.
5. Actualiza con el patrón `objectToUpdate` y preserva el historial con `[...currentAppDetails, newEntry]`.

`password`, `roleId`, `displayName`, `isActive`, `requiresPasswordChange`, `externalProvider` y `externalSubject` en el cuerpo devuelven **400**.

**`ESAVI-USER-005A` — desactivar.** Antes de delegar, dos guardas:

1. Si `id` es igual a `authUser.userId` → **409** `USER_005A_SELF_DEACTIVATION`, clave `user.selfDeactivation`. Nadie se cierra la puerta desde dentro.
2. Si el usuario porta el rol SUPERADMIN y es el **último** con ese rol activo —contando asignaciones activas en `appUserRole` cuyo usuario esté también activo— → **409** `USER_005A_LAST_SUPERADMIN`, clave `user.lastSuperAdmin`. Es la hermana de la guarda de SPEC F02 §3.5: allí se protege la última asignación, aquí el último portador.

Después delega en `setEntityActiveStatusService` con transacción, igual que `setCatalogItemActivationService`. Escribe `isActive: false` y `deletedAt: now()`. Doble desactivación → **409** `USER_005A_ALREADY_INACTIVE`.

**`ESAVI-USER-005B` — reactivar.** Revierte `isActive: true` y `deletedAt: null`. Doble reactivación → **409** `USER_005B_ALREADY_ACTIVE`. Antes comprueba que ni el `email` ni el `username` del usuario estén ocupados por **otro usuario activo** → **409**. `appDetails.method` guarda `'ESAVI-USER-005B'`, sin sufijos (§6).

**`ESAVI-USER-006` — cambiar la propia contraseña.** Actúa **siempre** sobre `authUser.userId`; el `id` no viaja en la ruta y no se acepta en el cuerpo. En este orden:

1. Recupera el usuario del token; si no existe o está inactivo → **401** `USER_006_INVALID_CREDENTIALS`.
2. `bcrypt.compare(currentPassword, user.passwordHash)` → si falla, **401** `USER_006_INVALID_CREDENTIALS`, clave `auth.invalidCredentials`. Es 401 y no 403 por coherencia con §10, que atribuye ese status a las credenciales inválidas.
3. `newPassword` distinta de `currentPassword` → si no, **409** `USER_006_SAME_PASSWORD`, clave `user.samePassword`.
4. Guarda el hash nuevo y pone `requiresPasswordChange: false`.

Responde **200** `{ ok, message }` **sin `data`**: la respuesta de un cambio de contraseña no devuelve el usuario. **No invalida el token en curso** — no hay tabla de sesiones en el MVP, y queda anotado en §7.

**`ESAVI-USER-007` — consultar el propio perfil.** Devuelve el usuario de `authUser.userId` con la misma forma que `003`, sin comprobar rol más allá de `USER`. No admite parámetros. Es el único punto por el que un USER accede a datos de `appUser`.

**`loginService` — un cambio** *(enmienda: eran dos; la escritura de `lastLoginAt` se cae)*. En `src/services/auth.service.ts`:

1. **Normaliza el correo** —minúsculas y `.trim()`— antes de `esaviCrypt`, exactamente igual que el alta. Sin esto, `001` guardaría el cifrado de la forma en minúsculas y un login que teclee mayúsculas produciría otro criptograma: credenciales correctas con respuesta 401.

El resto del archivo —la forma de la respuesta del login y el mapeo de roles— **no cambia**.

### 3.6 Claves i18n nuevas

Se amplía el bloque `user` existente (`es.json:33-41`, hoy con siete claves). El bloque `role` no se toca.

| Clave | Uso |
|---|---|
| `user.getSuccess` / `getFailed` | `003` y `007` |
| `user.getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `user.updatedSuccess` / `updatedFailed` | `004` |
| `user.deletedSuccess` / `deletedFailed` | `005A` |
| `user.activatedSuccess` / `activatedFailed` | `005B` |
| `user.passwordChangedSuccess` / `passwordChangedFailed` | `006` |
| `user.usernameExists` | 409 de `username` duplicado, con `{{username}}` |
| `user.roleLevelExceeded` | 403 al dar de alta con un rol de nivel superior al propio |
| `user.selfDeactivation` | 409 al intentar desactivarse a uno mismo |
| `user.lastSuperAdmin` | 409 al desactivar al último SUPERADMIN activo |
| `user.samePassword` | 409 cuando la contraseña nueva es igual a la actual |
| `user.alreadyActive` | 409 al reactivar un usuario ya activo |
| `user.alreadyInactive` | 409 al desactivar un usuario ya desactivado |
| `user.idRequired` | parámetro ausente |

Veinte claves nuevas sobre las siete que ya existen —la tabla enumeraba 21 y la enmienda retira `user.statusNotFound`—. `user.alreadyExists`, `user.notFound`, `user.createdSuccess` y `user.createdFailed` se reutilizan; `auth.invalidCredentials` también, en `006`. `tests/i18n/messages.test.ts` exige paridad exacta: las diecinueve van en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`passwordHash` y `sysDetails` **nunca se devuelven**. `username`, `email`, `firstName`, `lastName` y `displayName` llegan **descifrados**.

**`003` y `007` — getById y perfil propio:**

```
{ ok, message, data: {
    userId, username, email, displayName, firstName, lastName, phone,
    requiresPasswordChange, isActive,
    createdAt, updatedAt, deletedAt, appDetails,
    roles: [ { roleId, code, name, level } ]
} }
```

**`002A` / `002B` — listados:** `data` es `{ count, rows }` tal cual lo devuelve `findAndCountAll` (§11). Cada fila lleva las mismas claves **menos `appDetails`**: el historial de auditoría de cada usuario multiplicado por el tamaño de la página hace la respuesta ilegible, y quien lo necesita entra por `003`.

**`001` y `004`:** el usuario creado o actualizado, con la forma de `003`. `001` conserva el `include` de roles que ya hace hoy (`user.service.ts:84-91`), ampliado con `level`.

**`005A`, `005B` y `006`:** `{ ok, message }` **sin `data`**, según §10.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo. Los pasos 1 a 5 preparan la base sin exponer nada. El paso 6 **corrige el `001` que ya está en producción** antes de ampliar: si algo se rompe, se rompe con la superficie pequeña. Del 7 al 12 cada paso añade una operación.

1. **Registrar las operaciones no canónicas.** Dos filas en la tabla de `references/CONVENTIONS.md` §6: `appUser` → `006` cambiar la propia contraseña, y `appUser` → `007` consultar el propio perfil. La abreviatura `USER` ya está registrada y no se toca.
   *Verificación:* las dos filas aparecen junto a las tres de `appUserGeoLocation`; no se ha añadido ninguna abreviatura nueva.

2. **Ajustar el modelo.** En `src/models/appUser.model.ts`: corregir `phone` a `STRING(50)` y `appDetails` con `defaultValue: []`. *(Enmienda: sin `statusItemId`, sin `lastLoginAt` y sin asociación con `CatalogItem`.)*
   *Verificación:* `npm run build` en 0; un `AppUser.create(...)` deja `appDetails` como array vacío.

3. **Tipos.** En `src/types/user/user.types.ts`: `phone` en `CreateUserInput` *(enmienda: sin `statusItemId`)*, e interfaz `ChangePasswordInput`. `UserRole`, `AuthUser` y `CreateUserServiceParams` no cambian.
   *Verificación:* `import { ChangePasswordInput } from '../types'` compila; `grep -rn "UpdateUserInput" src/` no devuelve nada.

4. **Las 20 claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`, ampliando el bloque `user` existente.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

5. **Validadores.** En `src/validators/user.validator.ts`: añadir `userIdValidator`, `userListValidator`, `updateUserValidator` y `changePasswordValidator`; y corregir `createUserValidator` — `roleId` que acepte UUID o array de UUID, `username` opcional con `.trim()`, `phone` opcional ≤ 50, `password` con mínimo **8**, y rechazo explícito de `displayName`, `isActive` y `requiresPasswordChange` *(enmienda: `lastLoginAt` ya no se menciona)*. Alta en `src/validators/index.ts`.
   *Verificación:* `roleId` como array de dos UUID devuelve 201 en vez del 400 actual; `password` de 7 caracteres devuelve 400; enviar `displayName` devuelve 400; un `phone` de 51 caracteres devuelve 400.

6. **Corregir `ESAVI-USER-001`.** En `user.service.ts`: importar los modelos desde `'../models'`, quitar el filtro `isActive: true` de la comprobación de unicidad, añadir la de `username`, y aplicar la guarda de escalada sobre los roles pedidos. En `user.routes.ts`: bajar el rol a `validateUserRole(ADMIN)` y poner el comentario de dos líneas de §7.
   *Verificación:* crear con el correo de un usuario **desactivado** devuelve 409, no 500; repetir un `username` devuelve 409; un ADMIN dando de alta con rol SUPERADMIN recibe 403 y con rol ADMIN recibe 201; un SUPERADMIN puede asignar cualquiera.

7. **`ESAVI-USER-002A` y `002B` — listados.** Dos servicios y dos rutas (`GET /` y `GET /admin`, ambas ADMIN), con `findAndCountAll`, `include` de roles, orden `createdAt DESC`, paginación, `passwordHash` excluido y los cinco campos descifrados.
   *Verificación:* un usuario desactivado no aparece en `/` y sí en `/admin`; un USER recibe 403 en las dos; ninguna fila contiene `passwordHash` ni `appDetails`; los correos llegan en claro.

8. **`ESAVI-USER-003` — obtener por ID.** `getUserByIdService(id, lang, canViewInactive)` con el include de `roles`. Ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; un usuario desactivado devuelve 404 para ADMIN y 200 para SUPERADMIN; `roles[].level` viene poblado.

9. **`ESAVI-USER-007` — perfil propio.** Servicio que reutiliza el de `003` sobre `authUser.userId`, controlador y ruta `GET /me` con `validateUserRole(USER)`, declarada **antes** de `/:id`.
   *Verificación:* un USER recibe 200 con su propia ficha y sigue recibiendo 403 en `GET /:id`; la respuesta no contiene `passwordHash`.

10. **`ESAVI-USER-004` — actualizar.** `updateUserService` con los seis pasos de §3.5, el recálculo de `displayName` y el historial preservado con `[...currentAppDetails, newEntry]`.
    *Verificación:* cambiar `firstName` actualiza `displayName` descifrado; poner el correo de otro usuario devuelve 409; enviar `roleId` o `password` devuelve 400; un PUT sin cambios devuelve 200 con una entrada más en `appDetails`.

11. **`ESAVI-USER-005A` y `005B` — desactivar y reactivar.** `setUserActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. La desactivación aplica antes las dos guardas de §3.5.
    *Verificación:* desactivarse a uno mismo devuelve 409; desactivar al único SUPERADMIN devuelve 409, y con dos SUPERADMIN activos el primero se desactiva con 200; desactivar dos veces devuelve 409; `PATCH /activate/:id` deja `deletedAt` en `null` y exige SUPERADMIN; las dos responden sin `data`.

12. **`ESAVI-USER-006` — cambiar la propia contraseña.** `changePasswordService(authUser, data, lang)` con los cuatro pasos de §3.5. Ruta `PATCH /me/password` con `validateUserRole(USER)`, declarada antes de `/:id`.
    *Verificación:* con la contraseña actual correcta devuelve 200 y el login siguiente funciona con la nueva y falla con la vieja; una contraseña actual equivocada devuelve 401; repetir la misma devuelve 409; tras el cambio, `requiresPasswordChange` queda en `false`; la respuesta no trae `data`.

13. **`loginService` — normalización.** Normalizar el correo antes de cifrar. *(Enmienda: sin la escritura de `lastLoginAt`.)*
    *Verificación:* un usuario creado con `email: "Juan@Correo.EC"` inicia sesión escribiendo `juan@correo.ec` y también `JUAN@CORREO.EC`; `npm test -- roles` sigue pasando.

14. **Cubrir las rutas en `tests/auth/roles.test.ts`.** Ocho filas nuevas en `ROUTE_RULES`, **más la corrección del `minRole` de la fila existente** de `POST /api/users` (`:81`), que pasa de `SUPERADMIN` a `ADMIN`. Subir el total esperado. *(Enmienda: la base real era **58**, no 43, porque SPEC F02 y F03 ya estaban implementados; el total pasa a **66**.)*
    *Verificación:* `npm test -- roles` pasa y la fila de `POST /api/users` declara `ADMIN`.

15. **Suite de contrato `tests/contract/appUser.test.ts`.** Recorrido con `supertest`: crear → perfil propio → obtener por ID → listar (público y admin) → actualizar → cambiar contraseña → login con la nueva → desactivar → reactivar. Más los caminos de error: correo duplicado de un usuario desactivado, `username` duplicado, escalada de rol en el alta, autodesactivación, último SUPERADMIN, y contraseña actual equivocada.
    *Verificación:* `npm test` en verde y `npm run check` en 0.

Dos apuntes sobre el orden:

- **El paso 6 va antes que cualquier operación nueva.** Es el único que toca un endpoint ya desplegado y el único que cambia un rol de acceso: aislarlo permite revertirlo sin arrastrar seis operaciones nuevas.
- **El paso 13 podría ir el segundo** —son dos cambios pequeños en `auth.service.ts`—, pero colocado tras `003` la verificación es directa: se hace login y se consulta la ficha para ver el `lastLoginAt` actualizado, sin mirar la base de datos a mano.

---

## 5. Criterios de aceptación

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las nueve operaciones.
- [ ] `grep -rn "ESAVI-USER-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-USER-00[67]" references/CONVENTIONS.md` devuelve las dos filas de la tabla de operaciones no canónicas.
- [ ] Toda función exportada de los cuatro artefactos lleva el comentario de dos líneas de §7, incluido el `POST /` de `user.routes.ts`.
- [ ] `src/services/user.service.ts` importa los modelos desde `'../models'`.

**Creación y unicidad**

- [ ] Crear con el correo de un usuario **desactivado** devuelve **409**, no 500 por `UQ_appUser_email`.
- [ ] Crear con un `username` ya existente devuelve **409**, no 500 por `UQ_appUser_username`.
- [ ] Crear **sin** `username` devuelve **201**.
- [ ] Crear con `email: "  JUAN@Correo.EC  "` guarda el cifrado de `juan@correo.ec`, y buscar ese correo en el login funciona.
- [ ] Crear con `firstName: "juan carlos"` guarda el cifrado de `Juan Carlos`, y `displayName` es el cifrado de `Juan Carlos <apellido>`.
- [ ] Crear con `password` de 7 caracteres devuelve **400**.
- [ ] Crear con `roleId` como array de dos UUID válidos devuelve **201** y deja dos filas en `appUserRole`.
- [ ] Enviar `displayName`, `isActive` o `requiresPasswordChange` en el cuerpo de `001` o `004` devuelve **400**.
- [ ] Todo usuario creado por la API tiene `requiresPasswordChange: true`.

**Escalada de rol**

- [ ] Un ADMIN dando de alta con rol SUPERADMIN recibe **403**; con rol ADMIN o inferior, **201**.
- [ ] Un SUPERADMIN puede dar de alta con cualquier rol.
- [ ] `POST /api/users` responde **201** a un ADMIN: la ruta ya no exige SUPERADMIN.

**Lectura y cifrado**

- [ ] `GET /` no devuelve usuarios desactivados; `GET /admin` sí; las dos responden **403** a un USER.
- [ ] Los dos listados devuelven `data` como `{ count, rows }`, ordenados por `createdAt DESC`.
- [ ] Ninguna respuesta de ninguna operación contiene `passwordHash` ni `sysDetails`.
- [ ] Ninguna fila de `002A`/`002B` contiene `appDetails`.
- [ ] `username`, `email`, `firstName`, `lastName` y `displayName` llegan **descifrados** en las nueve operaciones que devuelven usuario.
- [ ] `GET /:id` devuelve `roles` con `level` poblado.
- [ ] `GET /:id` de un usuario desactivado: 404 para ADMIN, 200 para SUPERADMIN.
- [ ] `GET /me` devuelve 200 a un USER, y ese mismo USER recibe 403 en `GET /:id` y en `GET /`.
- [ ] `GET /:id` no captura `admin`, `me` ni `activate` como UUID.

**Actualización**

- [ ] `PUT /:id` cambiando `firstName` recalcula `displayName`.
- [ ] `PUT /:id` con el correo de otro usuario devuelve **409**, esté ese usuario activo o no.
- [ ] `PUT /:id` con `roleId` o `password` en el cuerpo devuelve **400**.
- [ ] Un PUT sin cambios devuelve **200** con la entidad intacta y una entrada más en `appDetails`.

**Desactivación y reactivación**

- [ ] Desactivarse a uno mismo devuelve **409**.
- [ ] Desactivar al último SUPERADMIN activo devuelve **409**; con dos SUPERADMIN activos, la primera desactivación devuelve **200**.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha.
- [ ] Desactivar dos veces devuelve **409** `ALREADY_INACTIVE`; reactivar dos veces devuelve **409** `ALREADY_ACTIVE`.
- [ ] `PATCH /activate/:id` exige SUPERADMIN y deja `deletedAt` en `null`.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` **sin `data`**.
- [ ] `appDetails.method` guarda `'ESAVI-USER-005A'` y `'ESAVI-USER-005B'`, sin sufijos `_ACTIVATION` ni `_DEACTIVATION`.

**Contraseña y login**

- [ ] `PATCH /me/password` con la contraseña actual correcta devuelve **200**; el login siguiente funciona con la nueva y falla con la anterior.
- [ ] `PATCH /me/password` con la contraseña actual equivocada devuelve **401**.
- [ ] `PATCH /me/password` con `newPassword` igual a la actual devuelve **409**.
- [ ] `PATCH /me/password` con `newPassword` de 7 caracteres devuelve **400**.
- [ ] Tras el cambio, `requiresPasswordChange` queda en **`false`**.
- [ ] `006` responde `{ ok, message }` **sin `data`**, y no hay ninguna ruta que permita cambiar la contraseña de otro usuario.
- [ ] Un usuario creado con el correo en mayúsculas inicia sesión escribiéndolo en minúsculas, y al revés.
- [ ] Un login no añade ninguna entrada a `appDetails`.

**Cierre**

- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] Ningún servicio escribe `sysDetails`: lo pone el trigger.
- [ ] `src/helpers/crypto.helper.ts` no cambia.
- [ ] El tipo `AuthUser` no cambia y `req.user` conserva la misma forma.
- [ ] `esaviapp.sql` no cambia.
- [ ] Las 20 claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 66 entradas, la fila de `POST /api/users` declara `ADMIN`, y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el alcance**

- **Sí:** el cambio de contraseña entra en este spec como `006`. `001` pone `requiresPasswordChange: true` en cada alta desde que existe; sin `006`, esa bandera describe un flujo que no tiene final y el usuario se queda con la contraseña que le puso otra persona.
- **No:** autenticación externa, sesiones, recuperación por correo y bloqueo por intentos fallidos. No están contemplados en el MVP. `externalProvider`, `externalSubject`, `appSession` y el ítem `LOCKED` se quedan donde están, sin uso.
- **No:** borrar `externalProvider` y `externalSubject` del modelo. Eliminarlos sería afirmar que la autenticación externa no llegará; se quedan documentados como columnas sin consumidor.
- **Sí:** `GET /me` como operación `007` propia. Con `003` en ADMIN, un USER no podría ver ni su propia ficha.
- **No:** resolver eso con una excepción dentro de `003` que compare `req.user.userId === id`. Haría que un mismo endpoint signifique dos cosas según quién llame, y la excepción tendría que vivir en el servicio para no violar §9.
- **No:** que `004` acepte `roleId`. Cambiar los roles de alguien es SPEC F02, y esconderlo dentro de un update de perfil dejaría dos filas tocadas donde el verbo promete una.
- **No:** restablecer la contraseña de un tercero, ni siquiera siendo SUPERADMIN. Es un endpoint con decisiones de seguridad propias —cómo se comunica la nueva contraseña, si caduca— y no está pedido.

**Sobre el cifrado y la normalización**

- **Sí:** normalizar **antes** de cifrar. Es el orden que hace que la búsqueda por igualdad funcione: normalizar después produciría un criptograma distinto para el mismo valor y el login dejaría de encontrar al usuario.
- **Sí:** `email` a minúsculas, **en el alta y en el login**. `citext` no ayuda aquí — la columna guarda el criptograma, no el correo, así que la insensibilidad a mayúsculas de Postgres se aplica al texto cifrado y no al original. La normalización tiene que hacerla la aplicación, y en los dos extremos o no sirve de nada.
- **Sí:** `phone` **sin cifrar**. Hoy no lo está, y cifrarlo obligaría a migrar los datos ya cargados. Queda como asimetría documentada, no como olvido.
- **No:** cifrar `statusItemId`, `lastLoginAt` ni ningún UUID. No son datos personales.
- **Sí:** `displayName` calculado y nunca recibido. Es lo que hace `001` hoy; aceptarlo en el cuerpo permitiría que dejara de coincidir con el nombre y el apellido que sí se guardan.
- **No:** ordenar los listados alfabéticamente. Los nombres están cifrados: `ORDER BY "lastName"` ordenaría por el criptograma, que es un orden arbitrario y estable, es decir, el peor de los dos mundos — parece que funciona.
- **No:** permitir búsqueda o filtros por nombre y correo. Sobre campos cifrados solo cabe la igualdad exacta; una búsqueda parcial exigiría cambiar el esquema de cifrado, y eso es otro spec.

**Sobre la unicidad**

- **Sí:** unicidad sin filtrar por `isActive`, en `email` y en `username`. Es lo que garantizan las dos `UNIQUE` del DDL, que tampoco filtran. Filtrar deja pasar valores que Postgres rechaza con `23505`, convirtiendo un 409 en un 500 (§11 y SPEC 04).
- **Sí:** comprobar `username` aunque sea opcional. Sin la comprobación, un `username` repetido llega hasta `UQ_appUser_username` y sale como 500.
- **No:** liberar el correo de un usuario dado de baja. Exigiría índices únicos parciales `WHERE "isActive"`, que hoy no existen en ninguna tabla del esquema.

**Sobre los roles y el acceso**

- **Sí:** `001` baja a ADMIN. Es la matriz canónica de §9, y SPEC F02 §6 ya argumentó que dar de alta usuarios es tarea ordinaria de un administrador.
- **Sí:** con guarda de escalada en el **servicio**. Un ADMIN que pudiera crear un SUPERADMIN convertiría el descenso de rol en una vía de escalada trivial. §9 manda resolver en el servicio lo que no se expresa por umbral de ruta.
- **Sí:** la guarda responde **403**, siguiendo el precedente que abrió SPEC F02 §6 para el mismo caso.
- **Sí:** `002A`, `002B` y `003` exigen **ADMIN**, desviándose de la matriz canónica, que pediría USER. Un listado de usuarios devuelve nombres, correos y teléfonos descifrados de toda la plantilla: es el único caso del repositorio donde el listado "público" no puede serlo.
- **No:** subir `002B` a SUPERADMIN. La diferencia entre las dos variantes es ver o no a los desactivados, y `canViewInactive` ya distingue quién ve qué dentro de `003`.

**Sobre la contraseña**

- **Sí:** mínimo **8** caracteres, en `001` y en `006`. Dejar `001` en los 6 actuales significaría que el alta impone una contraseña más débil de la que el propio usuario puede elegir después.
- **No:** exigir mayúsculas, dígitos o símbolos. No hay política de contraseñas declarada en ningún sitio del proyecto; inventarla dentro de un spec de CRUD es tomar una decisión de producto por la puerta de atrás.
- **Sí:** verificar la contraseña actual antes de cambiarla. Sin eso, un token robado permite tomar la cuenta de forma permanente en una sola petición.
- **Sí:** **401** cuando la contraseña actual no coincide, no 403. §10 atribuye el 401 a las credenciales inválidas, y eso es exactamente lo que ocurre.
- **Sí:** rechazar con 409 que la nueva sea igual a la actual. Un cambio de contraseña que no cambia nada deja `requiresPasswordChange: false` sin que la contraseña impuesta haya dejado de estar en uso.
- **No:** invalidar el token en curso al cambiar la contraseña. No hay tabla de sesiones en el MVP y `tokenValidation` no consulta ninguna lista de revocación: no existe dónde revocarlo. Queda en §7.

**Sobre el estado y las guardas**

- **Sí:** `statusItemId` e `isActive` son **independientes**. Es lo que hace el resto del repositorio con `isActive`, y sincronizarlos ataría dos servicios a unos códigos de catálogo sembrados que nadie garantiza que existan en cada despliegue.
- **No:** que `005A` ponga además el ítem `INACTIVE`. Obligaría a resolver un `catalogItem` por `code` dentro del servicio de activación genérico, que hoy no sabe nada de catálogos.
- **~~Sí~~ → No, por la enmienda:** validar `statusItemId` contra `catalogType.code = 'userStatus'`. La validación era correcta y seguirá siéndolo el día que la columna exista en las bases desplegadas; se retira porque la columna no existe, no porque la regla estuviera mal.
- **Sí:** prohibir la autodesactivación. Un administrador que se desactiva a sí mismo deja de poder reactivarse, y `005B` exige SUPERADMIN.
- **Sí:** proteger al último SUPERADMIN activo. Es la hermana de la guarda de SPEC F02 §3.5: allí se protege la última asignación de rol, aquí el último portador. Sin las dos, el sistema puede quedarse sin gobierno por dos caminos distintos.
- **No:** extender la guarda a "el último ADMIN". Un despliegue sin ADMIN sigue teniendo SUPERADMIN, que puede crear otro.

**Sobre la forma**

- **~~Sí~~ → No, por la enmienda:** `lastLoginAt` escrito en el login. Se retira con la columna. Que un login no deba añadir entrada a `appDetails` sigue en pie: es lo que hace que hoy el login no deje rastro alguno.
- **Sí:** `appDetails` fuera de los listados. El historial completo de cada usuario multiplicado por el tamaño de página hace la respuesta ilegible; quien lo necesita entra por `003`.
- **Sí:** `006` responde sin `data`. §10 lo pide para `delete` y `activate`; aquí se extiende porque devolver el usuario tras cambiar la contraseña no aporta nada y agranda una respuesta sensible.
- **Sí:** `email` y `passwordHash` siguen siendo `allowNull: false` en el modelo aunque el SQL los permita nulos. Sin autenticación externa, un usuario sin correo o sin contraseña no puede entrar. Es lo que hace inviolable el `CK_appUser_authSource`.
- **Sí:** alinear el validador con `CreateUserInput` en `roleId`, y no al revés. El tipo promete `string | string[]` y `createUserService:29` ya trata las dos formas; el único que se quedó atrás es el validador.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Los correos ya cargados con mayúsculas quedan cifrados en su forma original; tras normalizar, un login que teclee el correo en minúsculas no los encontrará | El login normaliza igual que el alta, así que el problema solo afecta a las filas creadas **antes** del spec cuyo correo tuviera mayúsculas. Antes del paso 13 conviene comprobar cuántas hay; como están cifradas, la comprobación exige descifrar y comparar, no una consulta SQL directa |
| Cambiar la contraseña **no invalida el token en curso**: quien haya robado un token sigue operando hasta que expire, aunque la víctima cambie la contraseña | Consecuencia aceptada de no tener `appSession` en el MVP. El único límite es la expiración del JWT. Es el riesgo de seguridad conocido de este spec y la razón principal para priorizar el spec de sesiones |
| Bajar `001` de SUPERADMIN a ADMIN amplía quién puede dar de alta usuarios | La guarda de escalada impide que un ADMIN cree un SUPERADMIN, `ROUTE_RULES` fija el rol mínimo y hay dos criterios de aceptación explícitos. El alta de usuarios ordinaria deja de ser tarea de superadministrador, que es el objetivo |
| La guarda de escalada lee `req.user.roles[].level`, una columna que hoy no mantiene nadie y que solo SPEC F03 convierte en fuente de la verdad | El seed escribe 100 y 25 correctamente, así que la guarda funciona hoy. El paso 6 verifica explícitamente el 403 de un ADMIN creando SUPERADMIN: si `level` estuviera mal poblado, la verificación falla ahí |
| Entre la comprobación del último SUPERADMIN y el `UPDATE` puede colarse otra desactivación concurrente, dejando el sistema sin ninguno | La comprobación y la escritura van en la misma transacción que ya abre `setUserActivationService`. Ventana estrecha, con dos administradores desactivando a la vez; no se añade bloqueo explícito de fila |
| Un usuario desactivado puede quedar con `statusItemId` apuntando a `ACTIVE` | Consecuencia buscada de que los dos estados sean independientes. `isActive` es el que gobierna el acceso; `statusItemId` es informativo hasta que exista un consumidor que le dé significado |
| Una fila cargada por SQL directo **sin cifrar** hace que `esaviDecrypt` lance, y un solo registro corrupto rompe el listado entero con un 500 | El riesgo existe hoy en `loginService` y no lo introduce este spec, pero los listados lo amplifican: pasa de afectar a un usuario a tumbar la página completa. Si aparece un caso real, el descifrado tolerante a fallos va en su propio spec |
| Los listados descifran cinco campos por fila | Con `DEFAULT_LIMIT` en 10 son cincuenta operaciones AES por petición. El validador topa `limit` en 100, así que el peor caso está acotado |
| El paso 14 parte de 43 entradas en `ROUTE_RULES`; si SPEC F02 o F03 se implementan antes, el número base es otro | El plan lo advierte y la verificación es que la suite pase, no que el número sea 51 |

---

## 8. Impacto en el contrato HTTP

El spec añade ocho endpoints nuevos, que por sí solos no cambian nada de lo que reciben los clientes existentes. Las correcciones sobre `001` y sobre el login **sí**:

| Situación | Antes | Después |
|---|---|---|
| `POST /api/users` con un token de ADMIN | **403** de `validateUserRole` | **201**, si los roles pedidos no superan su nivel |
| `POST /api/users` con un token de ADMIN pidiendo el rol SUPERADMIN | **403** de `validateUserRole` | **403** del servicio, con `USER_001_ROLE_LEVEL_EXCEEDED` y otro mensaje |
| Crear con el correo de un usuario **desactivado** | **500**, `23505` de `UQ_appUser_email` | **409** `USER_001_EMAIL_EXISTS` |
| Crear con un `username` repetido | **500**, `23505` de `UQ_appUser_username` | **409** `USER_001_USERNAME_EXISTS` |
| Crear con `password` de 6 o 7 caracteres | **201** | **400** de `validateFields` |
| Crear con `roleId` como array | **400**: el validador exige un UUID único | **201**, con una fila de `appUserRole` por rol |
| Crear con `email` en mayúsculas | Se guarda cifrado tal cual se escribió | Se guarda el cifrado de la forma en minúsculas |
| Login escribiendo el correo con otras mayúsculas que en el alta | **401**: el criptograma no coincide | **200**: los dos lados normalizan igual |

Las tres filas de `500` → `409`/`404` son correcciones: esas peticiones ya fallaban, solo que con el código equivocado y sin mensaje útil.

Dos filas exigen aviso a los consumidores de la API: **la contraseña mínima pasa de 6 a 8**, que romperá cualquier alta automatizada que use contraseñas cortas; y **`POST /api/users` deja de exigir SUPERADMIN**, que no rompe nada pero cambia quién puede llamarlo.

No cambia la forma de `req.user`, ni el tipo `AuthUser`, ni la emisión de tokens, ni la respuesta de `POST /api/auth/login`.

---

## Lo que **no** está en este spec

- Autenticación externa: `externalProvider` y `externalSubject` se quedan en el modelo sin consumidor.
- Sesiones (`appSession`) y revocación de tokens: cambiar la contraseña no invalida el token en curso.
- Recuperación de contraseña por correo.
- Bloqueo por intentos fallidos: el ítem `LOCKED` del catálogo `userStatus` se queda sin quien lo escriba.
- Restablecer la contraseña de un tercero, ni siquiera siendo SUPERADMIN.
- Política de contraseñas más allá de la longitud mínima.
- Cambiar los roles de un usuario existente: es SPEC F02 (`appUserRole`).
- Asignar geolocalizaciones a un usuario: es SPEC F01 (`appUserGeoLocation`).
- `statusItemId` y `lastLoginAt`: las dos columnas se quedan en `esaviapp.sql` sin modelo ni consumidor. Incorporarlas exige migrar las bases ya desplegadas y va en su propio spec.
- Búsqueda o filtros por nombre, correo o estado en los listados; ordenación alfabética.
- Cifrar `phone`, cambiar el esquema de `esaviCrypt` o migrar los datos ya cifrados.
- Descifrado tolerante a filas cargadas en claro por SQL directo.
- Eliminar `externalProvider` y `externalSubject` del modelo.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
