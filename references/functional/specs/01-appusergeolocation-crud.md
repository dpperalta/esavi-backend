# SPEC F01 — CRUD de appUserGeoLocation

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Fecha:** 2026-08-03
> **Objetivo:** Dar de alta la entidad `appUserGeoLocation` con sus siete artefactos, las siete operaciones canónicas y una octava de reasignación, para que un administrador pueda asignar usuarios a geolocalizaciones con vigencia temporal.

---

## 1. Por qué existe este spec

`appUserGeoLocation` es la tabla que vincula un usuario con el territorio sobre el que trabaja. Existe en `esaviapp.sql:482-544` desde la carga inicial del esquema, con sus tres claves foráneas, sus tres índices y su índice único parcial, pero **no tiene modelo en `src/models/`**. Hoy no hay forma de leerla ni de escribirla desde la API: la única vía es SQL directo.

La consecuencia es que la autorización del repositorio no tiene dimensión geográfica. `src/helpers/permissions.helper.ts` expone siete predicados y **los siete son por rol**: `isAdmin`, `canViewInactive`, `canManageUsers`, `canImportGeographyData`, `canViewDashboards`, `canDeleteLocations`, `isSuperAdmin`. Un ADMIN de una provincia y un ADMIN nacional son hoy indistinguibles para el sistema.

Esta entidad es el prerrequisito de esa distinción, pero **no la implementa**. Este spec solo construye el registro: quién está asignado a qué territorio, desde cuándo y hasta cuándo. Filtrar `esaviCase`, `notification` o los listados de `geoLocation` por la cobertura del usuario que pregunta es un cambio transversal que depende de este registro y va en su propio spec.

Dos particularidades que este spec tiene que resolver de forma explícita, porque ninguna otra entidad del repositorio las tiene:

**A — Dos mecanismos de baja solapados.** La tabla lleva `isActive` y `deletedAt` como todas, pero además `validTo`, que expresa vigencia temporal. Sin una regla escrita, un registro puede quedar `isActive: true` con `validTo` en el pasado — activo y vencido a la vez, un estado que ningún listado sabe representar.

**B — El único índice único parcial del esquema.** `UQ_appUserGeoLocation_active_user_geoLocation` es único sobre `("userId", "geoLocationId")` pero solo `WHERE "deletedAt" IS NULL AND "isActive" = true AND "validTo" IS NULL`. El canon de `references/CONVENTIONS.md` §11 —"la unicidad se evalúa sin filtrar por `isActive`"— se escribió contra `UNIQUE` totales y no aplica aquí tal cual. Sin decidirlo, la primera creación duplicada se convierte en un `23505` de Postgres, es decir un **500** donde corresponde un **409**.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos de `appUserGeoLocation`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Diez operaciones: `001` crear, `002A` listar por usuario, `002B` listar por usuario para administración, `003` obtener por ID, `004` actualizar vigencia, `005A` cerrar, `005B` reabrir, `006` reasignar, `007` asignación masiva y `008` cobertura efectiva.
- La invariante **una sola fila por `(userId, geoLocationId)`**, más estricta que el índice parcial del DDL: el par nunca se duplica, se reactiva.
- `001` con dos caminos: inserta si el par no existe (`201`), reactiva la fila existente si está inactiva (`200`), y rechaza con `409` si ya está activa.
- Cierre coherente en `005A`: `validTo = now()` junto con `isActive: false` y `deletedAt`. `005B` revierte los tres, dejando `validTo` en `null`.
- `004` limitado a `validFrom` y `validTo`. Cambiar `userId` o `geoLocationId` por esta vía se rechaza.
- `006` reasignación transaccional: cierra la asignación origen y abre —o reactiva— la del mismo usuario en la geolocalización destino.
- `007` asignación masiva de un usuario a varias geolocalizaciones en una petición, **todo o nada** dentro de una transacción.
- `008` cobertura efectiva del usuario: las geolocalizaciones asignadas **más todos sus descendientes**, resueltos con una CTE recursiva sobre `parentGeoLocationId`.
- `resolveUserCoverageService` como pieza reutilizable, en la **capa de servicio**. `src/helpers/permissions.helper.ts` no se modifica y sus siete predicados siguen siendo puros y síncronos.
- `assignedByUserId` tomado siempre de `req.user.userId`; lo que venga en el body se ignora.
- Vigencia: `validFrom` opcional con default `now()`, y validación de `validTo > validFrom` en el servicio.
- Filtro `?current=` en el listado, con default `true` en `002A` y `false` en `002B`.
- Alta de la abreviatura `USERGEO` en la tabla de `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `src/data/i18n/es.json`, `en.json` y `nl.json`.
- Filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/appUserGeoLocation.test.ts`.

**Fuera de alcance (otros specs):**

- **Listado por geolocalización** — "qué usuarios cubren este territorio". Se decidió dejar `002` en una sola dirección, por usuario, para no estirar la convención con `002C`/`002D`.
- **Filtrado territorial de otras entidades.** Que `esaviCase`, `notification` o `geoLocation` se recorten según la cobertura de quien pregunta. Este spec entrega `resolveUserCoverageService` y el endpoint `008`; **conectarlo a los listados de otros dominios es el spec siguiente**.
- **Modificar `permissions.helper.ts`.** No se añade `canAccessGeoLocation` ni ningún predicado que consulte la base de datos. Los siete existentes se quedan puros.
- **Modificar `tokenValidation` o el tipo `AuthUser`.** La cobertura no se precarga en `req.user`: se resuelve bajo demanda, solo donde se necesita.
- **Cachear la cobertura.** `resolveUserCoverageService` consulta cada vez que se le llama. Si el perfilado lo pide, la caché va en su propio spec.
- **Histórico de varias filas por par.** El índice parcial del DDL lo permitiría; la invariante de una fila por par lo descarta. Una auditoría temporal completa exigiría otra tabla.
- **Asignación masiva parcial con informe** (`{ created, skipped, failed }` y status 207). Se descartó frente a todo o nada.
- **Baja masiva.** `007` solo asigna; cerrar varias asignaciones se hace una a una con `005A`.
- **Incluir `assignedBy` resuelto en la respuesta.** Se devuelve el `assignedByUserId` crudo para no arrastrar un tercer JOIN a `appUser`, con su descifrado, en cada fila del listado.
- **Migración o backfill** de asignaciones cargadas por SQL directo.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`appUserGeoLocation` — `esaviapp.sql:482-544`. La tabla ya existe y **no se altera**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `userGeoLocationId` | `uuid` | no | PK `appUserGeoLocation_pkey`, `gen_random_uuid()` |
| `userId` | `uuid` | no | FK → `appUser("userId")`, `ON DELETE RESTRICT ON UPDATE CASCADE` |
| `geoLocationId` | `uuid` | no | FK → `geoLocation("geoLocationId")`, `ON DELETE RESTRICT ON UPDATE CASCADE` |
| `validFrom` | `timestamptz` | no | default `CURRENT_TIMESTAMP` |
| `validTo` | `timestamptz` | sí | nulo = vigencia abierta |
| `assignedByUserId` | `uuid` | sí | FK → `appUser("userId")`, `ON DELETE SET NULL ON UPDATE CASCADE` |
| `isActive` | `bool` | no | default `true` |
| `createdAt` | `timestamptz` | no | default `CURRENT_TIMESTAMP` |
| `updatedAt` | `timestamptz` | sí | |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | default `'{}'` |
| `appDetails` | `jsonb` | no | default `'{}'` — el servicio escribe **array**, igual que el resto del esquema |

Las cuatro columnas transversales (`isActive`, `deletedAt`, `sysDetails`, `appDetails`) están presentes. No hay anomalía que resolver antes de implementar.

**Restricciones:**

- `CK_appUserGeoLocation_dates` — `CHECK (("validTo" IS NULL) OR ("validTo" > "validFrom"))`.
- `UQ_appUserGeoLocation_active_user_geoLocation` — índice único **parcial** sobre `("userId", "geoLocationId")` con predicado `WHERE "deletedAt" IS NULL AND "isActive" = true AND "validTo" IS NULL`.

**Índices:** `IX_appUserGeoLocation_userId`, `IX_appUserGeoLocation_geoLocationId`, `IX_appUserGeoLocation_assignedByUserId`.

**Trigger:** `TRG_appUserGeoLocation_setSysDetails`, `BEFORE INSERT OR UPDATE`, ejecuta `setSysDetails()`. El servicio **nunca** escribe `sysDetails`.

La herencia se apoya en `geoLocation.parentGeoLocationId` (`geoLocation.model.ts:9`) y en `geoLocation.level` (`:15`). Ninguna de las dos columnas se modifica.

### 3.2 Modelo Sequelize

`src/models/appUserGeoLocation.model.ts`, clase `AppUserGeoLocation`. Alta en el barrel `src/models/index.ts`.

Definición según §12: `timestamps: false`, `freezeTableName: true`, `tableName: 'appUserGeoLocation'`, PK UUID con `defaultValue: sequelize.literal('gen_random_uuid()')`, `appDetails` con `defaultValue: []` en el modelo aunque el DDL diga `'{}'` — es el criterio que ya sigue `geoLocation.model.ts:114`.

`validFrom` se declara `allowNull: false` con `defaultValue: sequelize.literal('current_timestamp')`. `validTo` y `assignedByUserId`, `allowNull: true`.

**Asociaciones** — archivo nuevo `src/models/associations/appUserGeoLocation.associations.ts`, registrado en `src/models/associations/index.ts` y llamado por `initModels()`. Nunca dentro del modelo.

| Asociación | Alias |
|---|---|
| `AppUserGeoLocation.belongsTo(AppUser, { foreignKey: 'userId' })` | `user` |
| `AppUserGeoLocation.belongsTo(GeoLocation, { foreignKey: 'geoLocationId' })` | `geoLocation` |
| `AppUser.hasMany(AppUserGeoLocation, { foreignKey: 'userId' })` | `geoAssignments` |
| `GeoLocation.hasMany(AppUserGeoLocation, { foreignKey: 'geoLocationId' })` | `userAssignments` |

**No se declara la asociación de `assignedByUserId`.** La respuesta devuelve el UUID crudo (§2, fuera de alcance); declarar un segundo `belongsTo` a `AppUser` sin consumidor solo invita a incluirlo "ya que está".

Va en archivo propio, no en `auth.associations.ts`, porque cruza los dominios de autenticación y geografía. Es el mismo criterio con el que `healthFacility` tiene el suyo.

### 3.3 Tipos

`src/types/user/appUserGeoLocation.types.ts`, exportado desde el barrel existente `src/types/user/index.ts`. No hace falta tocar `src/types/index.ts`, que ya reexporta `./user/index`.

```ts
export interface CreateAppUserGeoLocationInput {
    userId: string;
    geoLocationId: string;
    validFrom?: string | Date;        // default: now() en el servicio
    validTo?: string | Date | null;   // null = vigencia abierta
    isActive?: boolean;
}

export interface BulkAssignGeoLocationsInput {
    userId: string;
    geoLocationIds: string[];
    validFrom?: string | Date;
    validTo?: string | Date | null;
}

export interface ReassignGeoLocationInput {
    geoLocationId: string;            // destino
}
```

`assignedByUserId` **no aparece en ninguna interfaz de entrada**: sale de `req.user.userId` y se pasa al servicio como `authUser`, no como dato.

El update usa `Partial<CreateAppUserGeoLocationInput>`. **No se declara `UpdateAppUserGeoLocationInput`** — prohibido por §4. Que `004` solo acepte `validFrom` y `validTo` lo impone el validador, no el tipo.

### 3.4 Superficie HTTP

```
POST   /api/user-geo-locations                        ESAVI-USERGEO-001   ADMIN       (nuevo)
POST   /api/user-geo-locations/bulk                   ESAVI-USERGEO-007   ADMIN       (nuevo)
GET    /api/user-geo-locations/user/:userId           ESAVI-USERGEO-002A  USER        (nuevo)
GET    /api/user-geo-locations/admin/user/:userId     ESAVI-USERGEO-002B  ADMIN       (nuevo)
GET    /api/user-geo-locations/user/:userId/coverage  ESAVI-USERGEO-008   USER        (nuevo)
GET    /api/user-geo-locations/:id                    ESAVI-USERGEO-003   USER        (nuevo)
PUT    /api/user-geo-locations/:id                    ESAVI-USERGEO-004   ADMIN       (nuevo)
PATCH  /api/user-geo-locations/reassign/:id           ESAVI-USERGEO-006   ADMIN       (nuevo)
DELETE /api/user-geo-locations/:id                    ESAVI-USERGEO-005A  ADMIN       (nuevo)
PATCH  /api/user-geo-locations/activate/:id           ESAVI-USERGEO-005B  SUPERADMIN  (nuevo)
```

Alta en `src/routes/index.ts` bajo el prefijo `/user-geo-locations`.

**Orden de declaración en `appUserGeoLocation.routes.ts`.** Las rutas literales (`/bulk`, `/user/:userId`, `/admin/user/:userId`, `/user/:userId/coverage`, `/reassign/:id`, `/activate/:id`) van **antes** de `/:id`. En caso contrario Express captura `bulk`, `user` o `admin` como un `:id` y el validador de UUID responde 400. Dentro del grupo `/user/:userId`, la ruta con sufijo `/coverage` se declara **antes** que la de listado, por el mismo motivo invertido.

`006`, `007` y `008` extienden el rango `001`–`005B` de §6. Es deliberado y se justifica en §6 de este spec.

### 3.5 Reglas de negocio por operación

**Invariante global.** Existe **como máximo una fila por `(userId, geoLocationId)`**, sin importar su estado. Es más estricta que el índice parcial del DDL, que solo cubre las filas activas con `validTo` nulo. La comprobación de existencia se hace **siempre sin filtrar por `isActive`, `deletedAt` ni `validTo`**.

**`ESAVI-USERGEO-001` — crear.** En este orden:

1. `userId` existe y está activo → 404 `USERGEO_001_USER_NOT_FOUND`.
2. `geoLocationId` existe y está activo → 404 `USERGEO_001_GEOLOC_NOT_FOUND`.
3. `validTo`, si viene, es posterior a `validFrom` → 409 `USERGEO_001_INVALID_DATE_RANGE`.
4. Busca la fila del par `(userId, geoLocationId)`:
   - **No existe** → inserta con `assignedByUserId = authUser.userId`, `validFrom = data.validFrom ?? now()`. Responde **201**.
   - **Existe e `isActive: false`** → reactiva: `isActive: true`, `deletedAt: null`, `validTo: null`, `validFrom = data.validFrom ?? now()`, `assignedByUserId = authUser.userId`. Responde **200**.
   - **Existe e `isActive: true`** → 409 `USERGEO_001_ASSIGNMENT_EXISTS`.

En los dos primeros casos añade entrada a `appDetails` con `method: 'ESAVI-USERGEO-001'`; el detalle distingue `'Assignment created by service'` de `'Assignment reactivated by create'`. En la reactivación el historial se preserva con `[...currentAppDetails, newEntry]`.

**`ESAVI-USERGEO-002A` — listar por usuario, público.** `findAndCountAll` con `where: { userId, isActive: true }`. Filtro `current` con **default `true`**: añade `[Op.or]: [{ validTo: null }, { validTo: { [Op.gt]: new Date() } }]`. Con `?current=false` devuelve también las vencidas, siempre activas. Orden `validFrom DESC`. Paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Valida antes que el `userId` exista → 404 `USERGEO_002A_USER_NOT_FOUND`.

**`ESAVI-USERGEO-002B` — listar por usuario, administración.** Igual, sin `isActive` en el `where` y con `current` **default `false`**. 404 `USERGEO_002B_USER_NOT_FOUND`.

**`ESAVI-USERGEO-003` — obtener por ID.** Existencia → 404 `USERGEO_003_NOT_FOUND`. Una fila inactiva devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — que hoy significa **SUPERADMIN**, según `permissions.helper.ts:24-26`. Incluye `user` y `geoLocation` (§3.7).

**`ESAVI-USERGEO-004` — actualizar vigencia.** Solo `validFrom` y `validTo`. El validador rechaza `userId` y `geoLocationId` con 400; reasignar es `006`. Orden: existencia → 404 `USERGEO_004_NOT_FOUND`; la fila está activa → 409 `USERGEO_004_ALREADY_INACTIVE`; rango válido comparando el `validFrom` resultante contra el `validTo` resultante → 409 `USERGEO_004_INVALID_DATE_RANGE`. Patrón `objectToUpdate`, historial preservado.

**`ESAVI-USERGEO-005A` — cerrar.** Sobre `setEntityActiveStatusService`, con transacción. Escribe `isActive: false`, `deletedAt: now()` **y `validTo: now()`** — los tres a la vez. Doble cierre → 409 `USERGEO_005A_ALREADY_INACTIVE`. **Nada bloquea el cierre**: no se comprueba si es la última asignación del usuario.

**`ESAVI-USERGEO-005B` — reabrir.** Revierte los tres: `isActive: true`, `deletedAt: null`, `validTo: null`. Doble reapertura → 409 `USERGEO_005B_ALREADY_ACTIVE`. Antes de reabrir comprueba que el par siga siendo único; si otra fila del mismo par está activa, 409 `USERGEO_005B_ASSIGNMENT_EXISTS`. `appDetails.method` guarda `'ESAVI-USERGEO-005B'`, nunca con sufijo.

**`ESAVI-USERGEO-006` — reasignar.** Todo dentro de **una transacción**. Orden:

1. La asignación `:id` existe → 404 `USERGEO_006_NOT_FOUND`.
2. Está activa → 409 `USERGEO_006_ALREADY_INACTIVE`. No se reasigna desde una asignación cerrada.
3. El `geoLocationId` destino existe y está activo → 404 `USERGEO_006_GEOLOC_NOT_FOUND`.
4. El destino no es el origen → 409 `USERGEO_006_SAME_GEOLOCATION`.
5. Busca el par `(userId de la fila origen, geoLocationId destino)`:
   - **Existe y activo** → 409 `USERGEO_006_ASSIGNMENT_EXISTS`, se aborta la transacción.
   - **Existe e inactivo** → se reactiva, con la misma semántica que `001`.
   - **No existe** → se inserta.
6. Cierra el origen igual que `005A`: `validTo = now()`, `isActive: false`, `deletedAt: now()`.

Responde **200** con la asignación destino. Las dos filas reciben entrada en `appDetails` con `method: 'ESAVI-USERGEO-006'`, la de origen con detalle de cierre y la de destino con detalle de apertura.

**`ESAVI-USERGEO-007` — asignación masiva.** **Todo o nada** dentro de una transacción. Orden:

1. `userId` existe y está activo → 404 `USERGEO_007_USER_NOT_FOUND`.
2. `geoLocationIds` no está vacío y no tiene repetidos → 400, lo emite el validador.
3. Rango de fechas válido → 409 `USERGEO_007_INVALID_DATE_RANGE`.
4. Todas las geolocalizaciones existen y están activas, comprobadas en **una sola consulta** con `[Op.in]`; si falta alguna → 404 `USERGEO_007_GEOLOC_NOT_FOUND`, con el mensaje interpolando cuántas faltan.
5. Ninguno de los pares está ya **activo**; si alguno lo está → 409 `USERGEO_007_ASSIGNMENT_EXISTS`, transacción abortada sin escribir nada.
6. Inserta los pares nuevos y reactiva los inactivos, con la semántica de `001`.

Responde **201** con `{ count, rows }`. `appDetails.method` es `'ESAVI-USERGEO-007'` en todas las filas tocadas.

**`ESAVI-USERGEO-008` — cobertura efectiva.** `resolveUserCoverageService(userId, lang)`. `userId` existe → 404 `USERGEO_008_USER_NOT_FOUND`. Toma las geolocalizaciones **vigentes** del usuario —`isActive: true` y (`validTo IS NULL` o `validTo > now()`)— y las expande a todos sus descendientes con una **CTE recursiva** sobre `geoLocation.parentGeoLocationId`, filtrando `isActive: true` en el descenso.

La CTE lleva dos guardas: `UNION` en vez de `UNION ALL`, y un tope de profundidad. Si los datos contuvieran un ciclo, la consulta termina igual. El resultado es la unión sin repetidos de los nodos asignados y sus descendientes. **Es de solo lectura y no escribe `appDetails`.**

### 3.6 Claves i18n nuevas

Bloque `appUserGeoLocation` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `appUserGeoLocation.createSuccess` | 201 al crear una asignación |
| `appUserGeoLocation.reactivateSuccess` | 200 cuando `001` reactiva un par existente |
| `appUserGeoLocation.createdFailed` | 500 genérico de creación |
| `appUserGeoLocation.getSuccess` | 200 en listado y getById |
| `appUserGeoLocation.fetchFailed` | 500 genérico de lectura |
| `appUserGeoLocation.notFound` | 404 de asignación inexistente |
| `appUserGeoLocation.assignmentExists` | 409 de par ya activo, en `001`, `005B`, `006` y `007` |
| `appUserGeoLocation.invalidDateRange` | 409 cuando `validTo` no es posterior a `validFrom` |
| `appUserGeoLocation.updateSuccess` | 200 al actualizar vigencia |
| `appUserGeoLocation.updatedFailed` | 500 genérico de actualización |
| `appUserGeoLocation.alreadyInactive` | 409 al cerrar, actualizar o reasignar una asignación cerrada |
| `appUserGeoLocation.alreadyActive` | 409 al reabrir una asignación ya activa |
| `appUserGeoLocation.deleteSuccess` | 200 de `005A` |
| `appUserGeoLocation.activateSuccess` | 200 de `005B` |
| `appUserGeoLocation.reassignSuccess` | 200 de `006` |
| `appUserGeoLocation.reassignFailed` | 500 genérico de reasignación |
| `appUserGeoLocation.sameGeoLocation` | 409 al reasignar al mismo destino |
| `appUserGeoLocation.bulkSuccess` | 201 de `007` |
| `appUserGeoLocation.bulkFailed` | 500 genérico de asignación masiva |
| `appUserGeoLocation.geoLocationsNotFound` | 404 de `007` con `{{count}}` geolocalizaciones inexistentes |
| `appUserGeoLocation.coverageSuccess` | 200 de `008` |
| `appUserGeoLocation.coverageFailed` | 500 genérico de cobertura |

Las FK reutilizan las claves ya existentes `user.notFound` y `geoLocation.notFound`. `tests/i18n/messages.test.ts` exige paridad exacta: las 22 van en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

**`003` — getById:**

```
{ ok, message, data: {
    userGeoLocationId, userId, geoLocationId, validFrom, validTo,
    assignedByUserId, isActive, createdAt, updatedAt, deletedAt, appDetails,
    user:        { userId, username, firstName, lastName, email },
    geoLocation: { geoLocationId, name, level, parentGeoLocationId }
} }
```

`username`, `firstName`, `lastName` y `email` se devuelven **descifrados** con `esaviDecrypt`. `assignedByUserId` va crudo, sin resolver.

**`002A` / `002B` — listado:** `data` es `{ count, user, rows }`. `count` y `rows` salen de `findAndCountAll`; `rows` tiene la forma de arriba **menos la clave `user`**.

```
{ ok, message, data: {
    count,
    user: { userId, username, firstName, lastName, email },
    rows: [ { userGeoLocationId, userId, geoLocationId, validFrom, validTo,
              assignedByUserId, isActive, createdAt, updatedAt, deletedAt, appDetails,
              geoLocation: { geoLocationId, name, level, parentGeoLocationId } } ]
} }
```

`user` sale **una sola vez por respuesta**, no una por fila. Los dos listados son por usuario, así que el `user` de cada fila sería el mismo repetido `count` veces, con tres descifrados `esaviDecrypt` por fila. Decidido el 2026-08-04, durante el paso 7. `003` **no** cambia: sigue devolviendo `user` dentro de la fila, porque ahí solo hay una.

**`007` — masiva:** `data` es `{ count, rows }` con las filas creadas y reactivadas.

**`008` — cobertura:**

```
{ ok, message, data: {
    assigned: [ { geoLocationId, name, level } ],
    coverage: [ { geoLocationId, name, level, parentGeoLocationId } ],
    count
} }
```

`assigned` son los nodos asignados directamente; `coverage` es la expansión completa, que **incluye** los asignados. `count` es la longitud de `coverage`.

**`005A`, `005B`:** `{ ok, message }` **sin `data`**, según §10.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo. Los pasos 1 a 5 construyen la base sin exponer nada; a partir del 6 cada paso añade una operación.

1. **Registrar la abreviatura.** Añadir la fila `appUserGeoLocation` → `USERGEO` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y anotar en §6 que esta entidad extiende el rango con `006`, `007` y `008`.
   *Verificación:* `USERGEO` aparece una sola vez en la tabla y no colisiona con `USER` ni `GEOLOC`.

2. **Modelo y asociaciones.** `src/models/appUserGeoLocation.model.ts` con las doce columnas de §3.1; alta en `src/models/index.ts`; `src/models/associations/appUserGeoLocation.associations.ts` con las cuatro asociaciones de §3.2, registrado en `src/models/associations/index.ts` y llamado por `initModels()`.
   *Verificación:* `npm run build` en 0; un `AppUserGeoLocation.findAll({ include: ['user', 'geoLocation'] })` en `ts-node` devuelve filas sin error de asociación.

3. **Tipos.** `src/types/user/appUserGeoLocation.types.ts` con las tres interfaces de §3.3, exportadas desde `src/types/user/index.ts`.
   *Verificación:* `import { CreateAppUserGeoLocationInput } from '../types'` compila; `UpdateAppUserGeoLocationInput` no existe en el repositorio.

4. **Las 22 claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

5. **Validadores.** `src/validators/appUserGeoLocation.validator.ts` con: `createAppUserGeoLocationValidator` (`userId` y `geoLocationId` UUID obligatorios, `validFrom`/`validTo` ISO opcionales), `updateAppUserGeoLocationValidator` (solo `validFrom`/`validTo`; `userId` y `geoLocationId` rechazados con 400), `bulkAssignValidator` (`geoLocationIds` array no vacío de UUID sin repetidos), `reassignValidator` (`geoLocationId` UUID obligatorio), `appUserGeoLocationIdValidator` y `userIdParamValidator`. Alta en `src/validators/index.ts`.
   *Verificación:* un `geoLocationIds: []` devuelve 400; un `geoLocationIds` con el mismo UUID dos veces devuelve 400.

6. **`ESAVI-USERGEO-001` — crear.** `createAppUserGeoLocationService` con los cinco pasos de §3.5, incluidos los tres caminos del par. Controlador que responde 201 o 200 según lo devuelto por el servicio. Ruta `POST /` con `validateUserRole(ADMIN)`. Alta del router en `src/routes/index.ts` bajo `/user-geo-locations`.
   *Verificación:* crear un par nuevo devuelve 201; repetirlo devuelve 409; cerrarlo por SQL y repetirlo devuelve 200 con `validTo: null`; `assignedByUserId` es el del token aunque el body mande otro.

7. **`ESAVI-USERGEO-002A` y `002B` — listados por usuario.** Dos servicios y dos rutas (`GET /user/:userId` USER, `GET /admin/user/:userId` ADMIN), con `findAndCountAll`, `current` con sus defaults opuestos, orden `validFrom DESC` y paginación.
   *Verificación:* una asignación con `validTo` en el pasado no aparece en `/user/:userId`, sí en `/user/:userId?current=false` y sí en `/admin/user/:userId`; un USER recibe 403 en la ruta admin.

8. **`ESAVI-USERGEO-003` — obtener por ID.** `getAppUserGeoLocationByIdService(id, lang, includeInactive)` con los dos includes de §3.7 y el descifrado de los campos PII de `user`. Ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una asignación cerrada devuelve 404 para ADMIN y 200 para SUPERADMIN; `user.email` llega en claro.

9. **`ESAVI-USERGEO-004` — actualizar vigencia.** Patrón `objectToUpdate`, las tres validaciones de §3.5, historial preservado con `[...currentAppDetails, newEntry]`.
   *Verificación:* enviar `userId` en el body devuelve 400; `validTo` anterior a `validFrom` devuelve 409; actualizar una asignación cerrada devuelve 409.

10. **`ESAVI-USERGEO-005A` y `005B` — cerrar y reabrir.** `setAppUserGeoLocationActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El cierre escribe además `validTo = now()`; la reapertura lo devuelve a `null` tras comprobar que el par no esté ocupado.
    *Verificación:* `DELETE` deja `isActive: false`, `deletedAt` con fecha y `validTo` con fecha; repetirlo devuelve 409; `PATCH /activate/:id` deja los tres revertidos; reabrir un par cuyo gemelo está activo devuelve 409; ambas responden sin `data`.

11. **`ESAVI-USERGEO-006` — reasignar.** Servicio transaccional con los seis pasos de §3.5. Ruta `PATCH /reassign/:id` con `validateUserRole(ADMIN)`.
    *Verificación:* reasignar mueve al usuario y deja el origen cerrado con `validTo`; el mismo destino devuelve 409; un destino ya activo devuelve 409 y **el origen sigue abierto** (la transacción revirtió); reasignar desde una asignación cerrada devuelve 409.

12. **`ESAVI-USERGEO-007` — asignación masiva.** Servicio transaccional todo o nada, con la comprobación de geolocalizaciones en una sola consulta `[Op.in]`. Ruta `POST /bulk` con `validateUserRole(ADMIN)`, declarada antes de `/:id`.
    *Verificación:* asignar tres geolocalizaciones devuelve 201 con `count: 3`; si una no existe devuelve 404 y **ninguna** de las tres se creó; si una ya está activa devuelve 409 y ninguna se creó; una mezcla de pares nuevos e inactivos deja todos activos.

13. **`ESAVI-USERGEO-008` — cobertura efectiva.** `resolveUserCoverageService(userId, lang)` en `src/services/appUserGeoLocation.service.ts`, con la CTE recursiva sobre `geoLocation.parentGeoLocationId`, `UNION` y tope de profundidad. Ruta `GET /user/:userId/coverage` con `validateUserRole(USER)`, declarada **antes** de `GET /user/:userId`.
    *Verificación:* un usuario asignado a una provincia con dos cantones y cuatro parroquias devuelve `count: 7`; una geolocalización inactiva no aparece en `coverage`; una asignación vencida no aporta nodos; el servicio no escribe en `appDetails`.

14. **Cubrir las diez rutas en `tests/auth/roles.test.ts`.** Diez filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de 33 a 43 en `tests/auth/roles.test.ts:125`.
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/appUserGeoLocation.test.ts`.** Recorrido con `supertest`: crear → obtener por ID → listar (público, `current=false` y admin) → actualizar vigencia → reasignar → cerrar → reabrir → crear sobre par cerrado (200) → masiva → cobertura. Más los caminos de error: par activo duplicado, rango de fechas inválido, reasignación al mismo destino, masiva con una geolocalización inexistente y su reversión.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las diez rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las diez operaciones.
- [ ] `grep -rn "ESAVI-USERGEO-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "USERGEO" references/CONVENTIONS.md` devuelve la fila de la tabla de abreviaturas de §6.
- [ ] Crear un par `(userId, geoLocationId)` nuevo devuelve **201**.
- [ ] Crear el mismo par estando activo devuelve **409**, no 500.
- [ ] Crear el mismo par estando cerrado devuelve **200**, deja `validTo: null`, `deletedAt: null` y **no** inserta una segunda fila.
- [ ] `SELECT count(*) FROM "appUserGeoLocation" GROUP BY "userId", "geoLocationId" HAVING count(*) > 1` no devuelve filas tras ejecutar la suite de contrato.
- [ ] `assignedByUserId` es el `userId` del token aunque el body envíe otro valor.
- [ ] Crear con `validTo` anterior o igual a `validFrom` devuelve **409**, no 500 por el `CHECK`.
- [ ] Crear sin `validFrom` deja `validFrom` con la fecha actual.
- [ ] `GET /user/:userId` **no** devuelve asignaciones con `validTo` en el pasado; `?current=false` sí las devuelve.
- [ ] `GET /admin/user/:userId` devuelve las cerradas por defecto y responde **403** a un USER.
- [ ] Los dos listados devuelven `data` como `{ count, user, rows }` y ordenan por `validFrom DESC`.
- [ ] `user` aparece **una sola vez** en la respuesta de los listados, con su PII descifrada, y **no** dentro de cada fila de `rows`.
- [ ] `GET /:id` devuelve `user` y `geoLocation`, con `user.email`, `user.username`, `user.firstName` y `user.lastName` **descifrados**.
- [ ] `GET /:id` de una asignación cerrada: 404 para USER y ADMIN, 200 para SUPERADMIN.
- [ ] `PUT /:id` con `userId` o `geoLocationId` en el body devuelve **400**.
- [ ] `PUT /:id` sobre una asignación cerrada devuelve **409**.
- [ ] `DELETE /:id` deja `isActive: false`, `deletedAt` con fecha **y `validTo` con fecha**.
- [ ] `PATCH /activate/:id` deja los tres campos revertidos, con `validTo` en `null`.
- [ ] Reabrir una asignación cuyo par gemelo está activo devuelve **409**.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` **sin `data`**.
- [ ] `PATCH /reassign/:id` cierra el origen con `validTo` y devuelve **200** con la asignación destino.
- [ ] `PATCH /reassign/:id` con el mismo `geoLocationId` de origen devuelve **409**.
- [ ] `PATCH /reassign/:id` hacia un par ya activo devuelve **409** y **el origen sigue abierto**.
- [ ] `PATCH /reassign/:id` sobre una asignación cerrada devuelve **409**.
- [ ] `POST /bulk` con tres geolocalizaciones válidas devuelve **201** con `count: 3`.
- [ ] `POST /bulk` con una geolocalización inexistente devuelve **404** y **ninguna** de las filas se creó.
- [ ] `POST /bulk` con un par ya activo devuelve **409** y ninguna fila se creó.
- [ ] `POST /bulk` con `geoLocationIds: []` o con UUID repetidos devuelve **400**.
- [ ] `GET /user/:userId/coverage` sobre una provincia con dos cantones y cuatro parroquias devuelve `count: 7`, con `assigned` de longitud 1.
- [ ] Una geolocalización inactiva no aparece en `coverage`; una asignación vencida no aporta nodos.
- [ ] `GET /user/:userId/coverage` no añade entradas a `appDetails`.
- [ ] `GET /:id` no captura `bulk`, `user`, `admin`, `reassign` ni `activate` como UUID.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] Ningún servicio escribe `sysDetails`: lo pone el trigger `TRG_appUserGeoLocation_setSysDetails`.
- [ ] `src/helpers/permissions.helper.ts` no cambia; sigue exportando los mismos siete predicados.
- [ ] `src/middlewares/tokenValidation` y el tipo `AuthUser` no cambian.
- [ ] Las 22 claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 43 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la invariante del par**

- **Sí:** una sola fila por `(userId, geoLocationId)`, para siempre. Hace el estado de una asignación legible de un vistazo y elimina la pregunta "¿cuál de las tres filas de este par manda?".
- **No:** replicar el predicado del índice parcial del DDL, que permitiría varias filas cerradas del mismo par. Habría dado un histórico gratis, pero a cambio de una tabla donde cada par es una lista y no un estado. Un histórico temporal en serio necesita su propia tabla, no el efecto colateral de un índice.
- **No:** cambiar el índice parcial del SQL por un `UNIQUE` total. Modificar el esquema afecta a datos ya cargados y a la carga de `esaviapp.sql` en los tests. La aplicación es más estricta que el índice, que es la dirección segura.
- **Sí:** dejar escrito que esta entidad **se desvía del canon de unicidad de §11**. Ese canon se redactó contra `UNIQUE` totales; aquí el DDL trae un índice parcial y aplicarlo sin pensar convertiría un 409 en un 500.

**Sobre la doble baja**

- **Sí:** `005A` escribe `validTo` además de `isActive` y `deletedAt`. Sin ello quedan filas activas y vencidas a la vez, un estado que ningún listado sabe representar.
- **No:** eliminar `isActive` de esta entidad y gobernar todo con `validTo`. Rompería `setEntityActiveStatusService`, `canViewInactive` y las suites de contrato, que asumen `isActive` en toda entidad.
- **No:** eliminar `validTo` y gobernar todo con `isActive`. La vigencia temporal es un requerimiento real —usuarios que notifican solo entre dos fechas— y el DDL ya la modela.
- **Sí:** `current` con default `true` en `002A` y `false` en `002B`. Una asignación vencida no debe aparecerle a quien consulta el estado operativo; al administrador sí.

**Sobre la creación**

- **Sí:** `001` reactiva y devuelve **200** en vez de 201. El status distingue creación de reactivación sin que el cliente tenga que comparar `createdAt`.
- **No:** devolver 201 siempre. Es más simple para el cliente, pero miente sobre lo ocurrido.
- **No:** devolver 409 siempre que el par exista y obligar a `PATCH /activate/:id`. El cliente no conoce el `userGeoLocationId` de una fila cerrada que sus listados no le muestran.
- **Sí:** `assignedByUserId` desde `req.user.userId`, ignorando el body. Es un dato de auditoría: aceptarlo del cliente lo hace falsificable y no aporta ningún caso de uso.

**Sobre las operaciones extra**

- **Sí:** extender la numeración con `006`, `007` y `008`. La convención fija `001`–`005B` porque son las operaciones canónicas de un CRUD; reasignar, asignar en lote y calcular cobertura no son ninguna de ellas y meterlas a la fuerza en una letra de `004` haría el código de operación inútil para rastrear. Es la primera entidad del repositorio que pasa de `005B`, y se hace de forma deliberada.
- **No:** modelar la reasignación como un `PUT /:id` que cambia `geoLocationId`. Reasignar toca dos filas y necesita transacción; esconderlo tras el update haría que un `PUT` a veces creara registros.
- **Sí:** `006` rechaza el mismo destino y las asignaciones cerradas. Sin la primera guarda, la operación cierra y reabre la misma fila con dos entradas de auditoría y ningún efecto; sin la segunda, "mover" algo ya cerrado no tiene semántica definida.
- **Sí:** `007` todo o nada. Es la única semántica coherente con el resto del API, que no tiene ningún endpoint con éxito parcial.
- **No:** `007` con informe parcial y status 207. Habría introducido un status y una forma de `data` que no existen en ningún otro endpoint, y con ellos una segunda manera de leer un error.
- **No:** baja masiva. No se pidió, y el cierre en lote tiene reglas propias — qué pasa si una de las asignaciones ya está cerrada — que merecen decidirse aparte.

**Sobre la herencia y la cobertura**

- **Sí:** resolver la herencia **al leer**, con CTE recursiva. La asignación sigue siendo una fila y la expansión es una consulta.
- **No:** expandir al escribir, insertando una fila por descendiente. Multiplicaría las filas por cien y dejaría la tabla incoherente en cuanto se cree una parroquia nueva bajo un cantón ya asignado.
- **Sí:** primera CTE recursiva del repositorio. El SPEC 09 descartó una, pero ahí se recorrían **padres** —una cadena corta— y aquí se recorren **descendientes**, donde una provincia puede tener cientos de nodos por debajo. Recorrer eso en JavaScript sería una consulta por nivel.
- **Sí:** `UNION` y tope de profundidad en la CTE. Si los datos ya contuvieran un ciclo, la consulta termina igual en vez de colgar la petición.
- **Sí:** la cobertura vive en la **capa de servicio**, no en `permissions.helper.ts`. Los siete predicados del helper son puros y síncronos; uno que consulte la base de datos convertiría el helper en otra cosa.
- **No:** precargar la cobertura en `req.user` desde `tokenValidation`. Habría dado un predicado síncrono elegante, al precio de una CTE recursiva en **cada** petición del API, incluidas las que no tocan geografía.
- **No:** cachear la cobertura. Sin datos de uso, una caché es una fuente de incoherencias a cambio de un rendimiento que nadie ha medido.
- **Sí:** este spec **calcula** la herencia pero no la **aplica**. Recortar los listados de `esaviCase`, `notification` o `geoLocation` según la cobertura es un cambio transversal sobre dominios que aún no tienen modelo.

**Sobre la forma**

- **Sí:** `assignedByUserId` crudo en la respuesta. Resolverlo obligaría a un tercer JOIN a `appUser` y a descifrar tres campos más en cada fila de cada listado.
- **Sí:** descifrar `user` en `003` y en los listados. Devolver el `email` cifrado no le sirve a nadie, y es lo que ya hace el resto del repositorio.
- **No:** normalizar con `toConstantCase` o `toTitleCase`. La entidad no tiene ningún campo de texto propio: es la primera del repositorio donde la normalización no aplica, y conviene que quede dicho para que nadie la busque.
- **No:** cifrar ningún campo con `esaviCrypt`. No hay PII propia en la tabla; los UUID no son datos personales.
- **Sí:** listado en una sola dirección, por usuario. "Qué usuarios cubren este territorio" necesitaría `002C`/`002D` y estiraría la convención sin un consumidor que lo pida.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El índice parcial del DDL permite lo que la aplicación prohíbe: si alguien inserta por SQL directo, pueden convivir dos filas del mismo par | La invariante se verifica en la suite de contrato con la consulta `GROUP BY … HAVING count(*) > 1` de §5. Un `UNIQUE` total en el DDL lo cerraría de verdad, pero es cambio de esquema y va en otro spec |
| La CTE recursiva se cuelga si los datos de `geoLocation` contienen un ciclo | `UNION` en vez de `UNION ALL` y tope de profundidad explícito. La consulta termina aunque el árbol esté corrupto |
| La CTE recursiva devuelve miles de nodos para una asignación de nivel nacional | `008` no pagina hoy. La cobertura completa de un país cabe en una respuesta, pero si aparece un caso real se pagina en otro spec — y por eso `008` es el último paso del plan |
| SQL crudo en `resolveUserCoverageService`: es el primero del repositorio y no lo cubre el tipado de Sequelize | Se aísla en una sola función, con `replacements` parametrizados —nunca interpolación de cadenas— y se cubre con el caso de las siete geolocalizaciones de §5 |
| `006` y `007` son transaccionales; una transacción mal cerrada deja conexiones colgadas | Las dos siguen el patrón de `setCatalogItemActivationService`, que ya usa transacción. La verificación de §5 comprueba explícitamente la reversión |
| `GET /:id` captura `bulk`, `user`, `admin`, `reassign` o `activate` como UUID | Las cinco rutas literales se declaran antes que `/:id`; cubierto por un criterio de aceptación propio |
| `GET /user/:userId/coverage` queda tapada por `GET /user/:userId` si se declara después | Es el único caso de dos rutas literales anidadas del spec. Va declarada primero y con su propia verificación en el paso 13 |
| El default de `current` cambia según el endpoint, y un cliente que migre de `002A` a `002B` ve resultados distintos sin cambiar la query | Es deliberado y está documentado en §3.5. Los dos endpoints aceptan `?current=` explícito para no depender del default |
| `005A` escribe `validTo`, que `setEntityActiveStatusService` no contempla hoy | El servicio genérico se usa para los tres campos que ya conoce; `validTo` se escribe en el servicio de la entidad, dentro de la misma transacción. `entityActivation.service.ts` **no** se modifica |
| Un usuario con muchas asignaciones hace que `008` recorra un árbol por cada una | La expansión se hace en **una sola** CTE que arranca desde todos los nodos asignados a la vez, no una consulta por asignación |

---

## Lo que **no** está en este spec

- Listado por geolocalización — "qué usuarios cubren este territorio".
- Aplicar la cobertura a los listados de otras entidades: `esaviCase`, `notification` o `geoLocation` no se recortan según quién pregunta.
- Predicados territoriales en `src/helpers/permissions.helper.ts`.
- Modificar `tokenValidation`, el tipo `AuthUser` o precargar la cobertura en `req.user`.
- Cachear el resultado de `resolveUserCoverageService`.
- Histórico de varias filas por el mismo par `(userId, geoLocationId)`.
- Asignación masiva con éxito parcial e informe.
- Baja masiva de asignaciones.
- Paginación de `008`.
- Resolver `assignedBy` en la respuesta.
- Cambiar el índice único parcial del DDL por un `UNIQUE` total.
- Migración o backfill de asignaciones cargadas por SQL directo.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
