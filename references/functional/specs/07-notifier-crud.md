# SPEC F07 — CRUD completo de notifier

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F04 (patrón de cifrado PII sobre `appUser`), SPEC F08 (operación `005C` de borrado físico), **SPEC F06 (`esaviCase` — dependencia dura: sin el modelo `EsaviCase` este spec no se puede implementar, y además se modifica su servicio de desactivación)**
> **Fecha:** 2026-08-10
> **Objetivo:** Dar de alta la entidad `notifier` con sus siete artefactos y sus siete operaciones canónicas, cifrando los datos personales del notificador, y saldar la deuda de desactivación en cascada que el SPEC F06 dejó declarada.

---

## 1. Por qué existe este spec

`notifier` es la primera de las cinco tablas satélite de `esaviCase` que recibe implementación. Guarda a la persona que reporta el evento: su nombre, su profesión, su ubicación y sus datos de contacto. Sin ella, un caso ESAVI existe en el sistema sin que conste quién lo notificó — que es un dato de vigilancia epidemiológica, no un adorno.

Hoy la tabla existe en `esaviapp.sql:666-688` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Cuatro características la separan de las entidades ya especificadas:

**A — Es el primer satélite, y por tanto le toca pagar la deuda del SPEC F06.** Aquel spec dejó escrito, en su §2, §6 y §7, que la desactivación en cascada de los satélites la resuelve «el spec que introduzca el primer satélite», y que «no se difiere indefinidamente: es la condición de entrada del siguiente spec del dominio». Éste es ese spec. Implica **modificar `setEsaviCaseActivationService`**, un servicio ya implementado y cerrado.

**B — El `ON DELETE CASCADE` del DDL no protege nada.** `FK_notifier_case` declara `ON DELETE CASCADE` (`esaviapp.sql:684`), pero `TRG_esaviCase_preventPhysicalDelete` (`esaviapp.sql:1361-1366`) impide todo borrado físico de `esaviCase`. La cascada declarada **nunca dispara**. La integridad del ciclo de vida entre caso y notificador es responsabilidad exclusiva de la aplicación.

**C — `notifier` no está protegida contra el borrado físico.** La lista de `preventPhysicalDelete` cubre 18 tablas maestras —incluidas `esaviCase` y `patient`— y **`notifier` no está en ella** (`esaviapp.sql:1354-1360`). Un `DELETE FROM "notifier"` ejecuta sin error. En `esaviCase` el borrado lógico era la única vía posible; aquí es una disciplina que solo sostiene el código de la aplicación.

**D — El trigger de `updatedAt` no existe en ninguna tabla del esquema.** El bucle genérico de `esaviapp.sql:1274-1291` hace `DROP TRIGGER IF EXISTS "TRG_<tabla>_setUpdatedAt"` y **nunca emite el `CREATE` correspondiente**: solo crea `TRG_<tabla>_setSysDetails`. El SPEC F06 §3.1 daba por existente `TRG_esaviCase_setUpdatedAt`; no existe, ni para `esaviCase` ni para `notifier` ni para ninguna otra. `updatedAt` lo escribe la aplicación en cada `update`, como ya hace el resto de servicios del repositorio. No es un problema que este spec resuelva —el comportamiento actual es correcto— pero la afirmación del F06 queda corregida aquí.

Sí alcanza a la tabla `TRG_notifier_setSysDetails`, que es el único trigger que la toca. No valida ninguna regla de negocio.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notifier`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Las siete operaciones canónicas: `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- La operación `005C` de borrado físico, en SUPERADMIN, que le corresponde por no estar `notifier` en el bucle `preventPhysicalDelete` del DDL. Las reglas transversales las fija el [SPEC F08](./08-physical-delete.md); aquí solo se declara la ruta y las claves de la entidad.
- Relación **uno a muchos** con `esaviCase`: un caso admite varios notificadores. Es lo que declara el DDL, que no impone `UNIQUE ("caseId")`.
- Cifrado con `esaviCrypt` de cuatro campos: `firstName`, `lastName`, `email` y `address`. `phoneNumber`, `room` y `details` quedan en claro.
- Normalización en escritura, siempre **antes** de cifrar: `toTitleCase` en `firstName`, `lastName` y `address`; `.trim().toLowerCase()` en `email`; `.trim()` en `room`, `phoneNumber` y `details`.
- `caseId` obligatorio en el alta e **inmutable**: se ignora si llega en el body de `004`.
- Validación de las tres FK en create y en update: `caseId` existente y activo; `professionItemId` activo y perteneciente a `catalogType.code = 'profession'`; `geoLocationId` activo.
- Listados con `findAndCountAll`, orden por defecto `createdAt DESC`, paginación y tres filtros por query acumulativos con `AND`: `caseId`, `professionItemId` y `geoLocationId`.
- **Saldar la deuda del SPEC F06:** `ESAVI-CASE-005A` desactiva, en la misma transacción, todos los `notifier` activos del caso. La cascada es **solo de bajada**: `ESAVI-CASE-005B` no reactiva ninguno. Implica modificar `src/services/esaviCase.service.ts` y su suite de contrato.
- Alta de la abreviatura `NOTIFIER` en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/notifier.test.ts`.

**Fuera de alcance (otros specs):**

- Las otras cuatro tablas satélite de `esaviCase` —`classification`, `notification`, `investigation` y `finalClassification`— y las veintiocho que cuelgan de ellas.
- **Extender la cascada de `ESAVI-CASE-005A` a esos cuatro satélites.** Este spec la construye y la deja funcionando para `notifier`; cada spec posterior añade su tabla al mismo punto. El mecanismo queda hecho, no el catálogo completo.
- Sembrar el `catalogType` de código `'profession'` y sus items. **Es precondición de la implementación, no parte de ella:** sin ese catálogo, `professionItemId` no se puede informar y toda alta que lo incluya devolverá 404. El alta de catálogos se hace por los endpoints ya existentes de `catalogType` y `catalogItem`.
- Añadir `notifier` a la lista de `preventPhysicalDelete` del DDL, o cualquier otra modificación de `esaviapp.sql`. El DDL no se toca.
- Crear el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea. Afecta a las 45 tablas, no a ésta; va en su propio spec si alguna vez se decide.
- Imponer un notificador único por caso. El DDL no lo pide y el dominio admite varios.
- Cualquier unicidad sobre `email`, `phoneNumber` o la combinación de nombre y caso.
- Búsqueda o filtrado por nombre, correo o dirección. Sobre campos cifrados solo cabe la igualdad exacta, y este spec no expone ningún endpoint de búsqueda.
- Un endpoint `006` de búsqueda por identificador, como el que tiene `patient`. El notificador no tiene documento ni código propio.
- Vincular el notificador con un `appUser` del sistema. El DDL no declara esa FK.
- Reasignar un notificador a otro caso.
- Ordenar el listado alfabéticamente por nombre. Los nombres están cifrados.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notifier` — `esaviapp.sql:666-688`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `notifierId` | `uuid` | no | PK, `gen_random_uuid()` |
| `caseId` | `uuid` | **no** | `FK_notifier_case` → `esaviCase`, `ON DELETE CASCADE`. **Sin `UNIQUE`**: uno a muchos |
| `geoLocationId` | `uuid` | sí | `FK_notifier_geoLocation` → `geoLocation`, `ON DELETE RESTRICT` |
| `professionItemId` | `uuid` | sí | `FK_notifier_profession` → `catalogItem`, `ON DELETE RESTRICT` |
| `firstName` | `varchar(150)` | **no** | cifrado |
| `lastName` | `varchar(150)` | sí | cifrado; la aplicación lo exige en el alta |
| `room` | `varchar(50)` | sí | en claro |
| `address` | `varchar(250)` | sí | cifrado |
| `phoneNumber` | `varchar(50)` | sí | en claro |
| `email` | `citext` | sí | cifrado; **sin** `UNIQUE` en el DDL |
| `details` | `text` | sí | en claro |

Índice: `IX_notifier_case` sobre `caseId`.

Las cuatro columnas transversales están presentes y completas: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB), más `createdAt` y `updatedAt`. No hay anomalía que resolver antes de implementar.

**Sobre la longitud de las columnas cifradas.** `esaviCrypt` produce un criptograma en base64 más largo que el texto de origen. `firstName` y `lastName` son `varchar(150)` y `address` es `varchar(250)`: el margen es el mismo con el que `patient` cifra sus cuatro nombres de `varchar(150)`, así que el patrón ya está probado en el repositorio. `email` es `citext`, sin límite.

**Triggers.** El único que alcanza a la tabla es `TRG_notifier_setSysDetails`, creado por el bucle genérico de `esaviapp.sql:1274-1291`. No valida ninguna regla de negocio. **No existe `TRG_notifier_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea, en ninguna tabla— ni **`TRG_notifier_preventPhysicalDelete`**: `notifier` no figura en la lista de `esaviapp.sql:1354-1360`. Un `DELETE` físico sobre esta tabla ejecuta sin error. El borrado lógico es disciplina de la aplicación y no está respaldado por la base.

### 3.2 Modelo Sequelize

Archivo: `src/models/notifier.model.ts`. Clase `Notifier`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notifier'`. PK `notifierId` con `defaultValue: sequelize.literal('gen_random_uuid()')`.

`caseId` y `firstName` van `allowNull: false`, calcando el DDL. `lastName` va `allowNull: true` en el modelo —el DDL lo permite— aunque el validador lo exija en el alta: el modelo refleja la tabla, la regla vive en el validador.

`email` se declara como `DataTypes.STRING`: la columna es `citext`, pero guarda el criptograma, así que la insensibilidad a mayúsculas de Postgres se aplicaría al texto cifrado y no al original. La normalización a minúsculas la hace el servicio antes de cifrar.

Asociaciones, en `src/models/associations/notifier.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `Notifier.belongsTo(EsaviCase, { as: 'case', foreignKey: 'caseId' })`
- `Notifier.belongsTo(CatalogItem, { as: 'profession', foreignKey: 'professionItemId' })`
- `Notifier.belongsTo(GeoLocation, { as: 'geoLocation', foreignKey: 'geoLocationId' })`

Ninguna va dentro del archivo del modelo. Alta en `src/models/index.ts`.

**`EsaviCase.hasMany(Notifier, { as: 'notifiers', foreignKey: 'caseId' })` sí se declara**, y es la excepción a la regla que fijó el SPEC F06 §3.2 al no declarar los inversos de `Patient` y `HealthFacility`. Allí ninguna operación lo necesitaba; aquí la cascada de `ESAVI-CASE-005A` recorre los notificadores del caso, así que el inverso es funcionalmente necesario. **No se añade a las respuestas de `esaviCase`**: el include no se declara en ninguna operación de aquella entidad, y su contrato HTTP no cambia.

### 3.3 Tipos

`src/types/notifier/notifier.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`. El barrel del dominio es obligatorio: `src/types/healthFacility/` no lo tiene y eso está catalogado como deuda; no se repite.

```ts
export interface CreateNotifierInput {
    caseId: string;
    firstName: string;
    lastName: string;
    professionItemId?: string | null;
    geoLocationId?: string | null;
    room?: string | null;
    address?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
    details?: string | null;
    isActive?: boolean;
}
```

`lastName` figura como obligatorio en la interfaz aunque el DDL lo permita nulo: un notificador con solo nombre de pila no identifica a nadie, y es la misma exigencia que `patient` hace sobre sus dos apellidos principales.

El update usa `Partial<CreateNotifierInput>`. No se declara `UpdateNotifierInput`. `caseId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre**: es inmutable.

### 3.4 Superficie HTTP

```
POST   /api/notifiers                  ESAVI-NOTIFIER-001   USER        (nuevo)
GET    /api/notifiers                  ESAVI-NOTIFIER-002A  USER        (nuevo)
GET    /api/notifiers/admin            ESAVI-NOTIFIER-002B  ADMIN       (nuevo)
GET    /api/notifiers/:id              ESAVI-NOTIFIER-003   USER        (nuevo)
PUT    /api/notifiers/:id              ESAVI-NOTIFIER-004   USER        (nuevo)
DELETE /api/notifiers/:id              ESAVI-NOTIFIER-005A  ADMIN       (nuevo)
PATCH  /api/notifiers/activate/:id     ESAVI-NOTIFIER-005B  SUPERADMIN  (nuevo)
DELETE /api/notifiers/purge/:id        ESAVI-NOTIFIER-005C  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/notifier.routes.ts`: las rutas literales (`/admin`, `/activate/:id`, `/purge/:id`) van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la misma desviación de los SPEC F05 y F06, y por la misma razón: el notificador se captura en el mismo flujo operativo que el caso, y con create en ADMIN el flujo se corta a la mitad. `005A` se queda en ADMIN y `005B` en SUPERADMIN.

No hay operaciones no canónicas: el filtro por caso va por query sobre `002A`/`002B`, no como ruta propia.

### 3.5 Reglas de negocio por operación

**`ESAVI-NOTIFIER-001` — crear.** En este orden:

1. Valida `caseId`: existe y `isActive: true` → 404 `NOTIFIER_001_CASE_NOT_FOUND`. Un caso retirado no admite notificadores nuevos.
2. Si viene `professionItemId`: existe, `isActive: true` y su `catalogType.code` es `'profession'` → 404 `NOTIFIER_001_PROFESSION_NOT_FOUND`.
3. Si viene `geoLocationId`: existe y `isActive: true` → 404 `NOTIFIER_001_GEOLOCATION_NOT_FOUND`.
4. Normaliza: `toTitleCase` en `firstName`, `lastName` y `address`; `.trim().toLowerCase()` en `email`; `.trim()` en `room`, `phoneNumber` y `details`.
5. Cifra con `esaviCrypt` los cuatro campos PII —`firstName`, `lastName`, `email`, `address`—, **después** de normalizar. El orden importa: cifrar antes de normalizar produce el criptograma del texto crudo.
6. Inserta con la entrada de auditoría `method: 'ESAVI-NOTIFIER-001'`.

No hay comprobación de unicidad de ningún tipo. El DDL no declara ninguna `UNIQUE` sobre esta tabla, y el mismo notificador puede figurar legítimamente en varios casos.

**`ESAVI-NOTIFIER-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, includes `case`, `profession` y `geoLocation`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. **El orden no puede ser alfabético**: los nombres están cifrados y `ORDER BY "lastName"` ordenaría por el criptograma. Filtros opcionales por query, acumulativos con `AND`:

- `caseId` — igualdad, UUID.
- `professionItemId` — igualdad, UUID.
- `geoLocationId` — igualdad, UUID.

Un filtro de FK con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404: filtrar por algo inexistente es una búsqueda vacía, no un recurso ausente. Devuelve la forma reducida de §3.7, con los campos cifrados descifrados.

El `where` filtra por el `isActive` **del notificador**, no por el del caso. Con la cascada de `ESAVI-CASE-005A`, los notificadores de un caso retirado ya están inactivos, así que el resultado es el mismo sin necesidad de un `required: true` sobre el include.

**`ESAVI-NOTIFIER-002B` — listar, admin.** Idéntica, sin `isActive` en el `where`. Los mismos tres filtros.

**`ESAVI-NOTIFIER-003` — obtener por ID.** `where` con `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero — hoy **SUPERADMIN**, según `src/helpers/permissions.helper.ts:24-26` → 404 `NOTIFIER_003_NOT_FOUND`. Devuelve la forma completa de §3.7 con los cuatro campos descifrados.

**`ESAVI-NOTIFIER-004` — actualizar.** En este orden:

1. Existencia → 404 `NOTIFIER_004_NOT_FOUND`.
2. `caseId` **se ignora siempre**, venga o no en el body. Un notificador no se traslada entre casos: se desactiva y se crea de nuevo en el correcto.
3. Si viene `professionItemId`: existe, activo y del catálogo `'profession'` → 404 `NOTIFIER_004_PROFESSION_NOT_FOUND`.
4. Si viene `geoLocationId`: existe y activo → 404 `NOTIFIER_004_GEOLOCATION_NOT_FOUND`.
5. Normaliza y cifra los campos que lleguen, en ese orden, con las mismas reglas del `001`.
6. Escribe `updatedAt` explícitamente. No hay trigger que lo haga.
7. Preserva el historial con `[...currentAppDetails, newEntry]`.

**`ESAVI-NOTIFIER-005A` / `005B` — desactivar y reactivar.** `setNotifierActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, calculando `const op = isActive ? '005B' : '005A'`. El `where` filtra **solo por la PK**. `DELETE` sella `deletedAt`; `PATCH /activate` lo deja en `null`. Ambos responden `{ ok, message }` sin `data`.

**Reactivar un notificador no exige que su caso esté activo.** Es deliberado: la cascada es solo de bajada, y quien reactiva es SUPERADMIN, que también es el único que ve casos inactivos por `canViewInactive`. Bloquearlo obligaría a reactivar el caso primero, lo que revierte una decisión administrativa mayor para arreglar una menor.

**La cascada — modificación de `ESAVI-CASE-005A`.** Dentro de la transacción que `setEsaviCaseActivationService` ya abre (`src/services/esaviCase.service.ts:350-374`), y **solo cuando `isActive === false`**, se ejecuta un `Notifier.update` masivo sobre los notificadores activos del caso:

```
UPDATE "notifier"
SET "isActive" = false, "deletedAt" = <now>, "updatedAt" = <now>
WHERE "caseId" = <id> AND "isActive" = true
```

Va **después** de la desactivación del caso y **antes** del `commit`: si el caso ya estaba inactivo, `setEntityActiveStatusService` lanza 409 y la cascada no llega a ejecutarse. El `appDetails` de cada notificador arrastrado recibe una entrada con `method: 'ESAVI-CASE-005A'` —el código de la operación que lo desactivó, no el suyo— y `detail` indicando que cayó por cascada. Cuando `isActive === true`, la cascada **no se ejecuta**: `ESAVI-CASE-005B` no toca ningún notificador.

Un caso sin notificadores desactiva cero filas y no falla.

**`ESAVI-NOTIFIER-005C` — purgar.** `purgeNotifierService(id, authUser, lang)` sobre `purgeEntityService`, con transacción. Existencia con `paranoid: false` → 404 `NOTIFIER_005C_NOT_FOUND`; la fila debe estar en `isActive: false` → si no, 409 `NOTIFIER_005C_STILL_ACTIVE`; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. Las reglas transversales están en el [SPEC F08](./08-physical-delete.md) y no se repiten aquí.

`notifier` está habilitada porque no figura en el bucle `preventPhysicalDelete` de `esaviapp.sql:1354-1360`. **Purgar un notificador no afecta a su caso:** la FK va del notificador al caso, no al revés, y ninguna tabla referencia `notifierId`. No hay nada que se arrastre por cascada.

Los cuatro campos cifrados se vuelcan al log **cifrados**, sin tratamiento especial: el volcado sale de la instancia de Sequelize y el descifrado ocurre al construir la respuesta.

**Validaciones de forma** (las emite `validateFields` con 400, no el servicio): `caseId` obligatorio y `.isUUID()` en create; `professionItemId` y `geoLocationId` con `.isUUID()` cuando lleguen; `firstName` y `lastName` obligatorios en create, de 2 a 150 caracteres; `email` con `.isEmail()` cuando llegue; `phoneNumber` hasta 50 caracteres; `room` hasta 50; `address` hasta 250.

Los límites de longitud se validan sobre el texto **en claro**, antes de cifrar. Es lo correcto: el usuario escribe texto plano y el mensaje de error debe hablar de lo que escribió, no del criptograma.

### 3.6 Claves i18n nuevas

Bloque `notifier` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `deletedSuccess` / `deletedFailed` | `005A` |
| `activatedSuccess` / `activatedFailed` | `005B` |
| `notFound` | 404 en `003`, `004`, `005A` y `005B` |
| `idRequired` | parámetro ausente |
| `alreadyActive` / `alreadyInactive` | 409 de `setEntityActiveStatusService` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `stillActive` | 409 al purgar un notificador que sigue activo. Lleva `{{id}}` |
| `caseNotFound` | 404 cuando `caseId` no existe o está inactivo |
| `professionNotFound` | 404 cuando `professionItemId` no existe, está inactivo o no es del catálogo `profession` |
| `geoLocationNotFound` | 404 cuando `geoLocationId` no existe o está inactivo |

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

No se añade ninguna clave al bloque `esaviCase`: la cascada no produce mensajes propios, ocurre dentro de una operación que ya tiene los suyos.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003` y `004`:

```
{ ok, message, data: {
    notifierId, firstName, lastName, email, phoneNumber, room, address, details,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    case:        { caseId, caseCode, reportDate },
    profession:  { catalogItemId, code, name },
    geoLocation: { geoLocationId, name }
} }
```

**Reducida** — `002A` y `002B`, dentro de `{ count, rows }`:

```
{ notifierId, firstName, lastName, email, phoneNumber, room, address, isActive,
  case:        { caseId, caseCode, reportDate },
  profession:  { catalogItemId, code, name },
  geoLocation: { geoLocationId, name } }
```

La reducida omite solo `details` y `appDetails`: `details` es texto libre sin límite de longitud y volcarlo en cada fila de una página hace la respuesta impredecible. El resto de los campos de contacto sí van en el listado, porque el caso de uso del listado es precisamente localizar al notificador.

`firstName`, `lastName`, `email` y `address` llegan **descifrados** con `esaviDecrypt` en las cinco operaciones que devuelven notificador. `sysDetails` **nunca** se devuelve, en ninguna operación.

Los includes nulos se devuelven como `null`, no se omiten: `profession` y `geoLocation` son opcionales y el cliente necesita distinguir «no informado» de «campo ausente en la respuesta».

---

## 4. Plan de implementación

**Precondiciones.** Dos, antes del paso 1:

- El SPEC F06 debe estar implementado. `caseId` es `NOT NULL`, la asociación, la validación de FK y la cascada necesitan el modelo `EsaviCase`. Sin él, ningún paso compila.
- Debe existir un `catalogType` con `code = 'profession'` y al menos un `catalogItem` activo bajo él, cargado por los endpoints ya existentes de catálogos. Sin eso, el paso 4 no se puede verificar y toda alta con `professionItemId` devuelve 404.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Modelo, asociaciones y tipos.** `src/models/notifier.model.ts` con `caseId` y `firstName` en `allowNull: false` y `email` como `STRING`; `src/models/associations/notifier.associations.ts` con `case`, `profession` y `geoLocation`, más el inverso `EsaviCase.hasMany(Notifier, { as: 'notifiers' })`, registrado en `initModels()`; `src/types/notifier/notifier.types.ts` con `CreateNotifierInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `Notifier.findAndCountAll({ include: ['case', 'profession', 'geoLocation'] })` desde un script suelto devuelve filas sin error de asociación; `npm test` sigue en verde, porque el `hasMany` nuevo no se incluye en ninguna respuesta de `esaviCase` y su contrato no cambia.

2. **Claves i18n.** El bloque `notifier` completo de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

3. **Validadores.** `src/validators/notifier.validator.ts` con cuatro arrays: `notifierIdValidator`, `notifierListValidator` (los tres filtros de §3.5 más `limit` y `offset`), `createNotifierValidator` (`caseId`, `firstName` y `lastName` obligatorios; los tres UUID validados; `email` con `.isEmail()`; los límites de longitud de §3.5) y `updateNotifierValidator` (todo opcional, mismas reglas de formato). Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

4. **`ESAVI-NOTIFIER-001` — crear.** `createNotifierService` con los seis pasos de §3.5 en ese orden: las tres FK, normalizar, cifrar, insertar con auditoría. Sin ninguna comprobación de unicidad. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* crear con `firstName: "maría josé"` guarda el cifrado de `María José` y la respuesta lo devuelve descifrado; con `email: "  ANA@Correo.EC  "` guarda el cifrado de `ana@correo.ec`; un `caseId` inactivo devuelve **404**; un `professionItemId` del catálogo `sex` devuelve **404**; dos notificadores con el mismo nombre y correo en el mismo caso se crean los dos con **201**, sin 409; consultar la fila en la base muestra `firstName` ilegible y `phoneNumber` legible.

5. **`ESAVI-NOTIFIER-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, los tres filtros acumulativos de §3.5, los tres includes, orden `createdAt DESC`, paginación y forma reducida de §3.7 con los campos descifrados. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve notificadores inactivos y `/admin` sí; un USER recibe 403 en `/admin`; `?caseId=` de un caso con tres notificadores devuelve `count: 3`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los tres filtros combinados se aplican con `AND`; ninguna fila trae `details`, `appDetails` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total; los nombres llegan descifrados; un notificador sin profesión trae `profession: null`.

6. **`ESAVI-NOTIFIER-003` — obtener por ID.** `getNotifierByIdService(id, lang, includeInactive)` con los tres includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; un notificador desactivado devuelve 404 para USER y para ADMIN, y 200 para SUPERADMIN; los cuatro campos PII llegan descifrados; `sysDetails` no aparece.

7. **`ESAVI-NOTIFIER-004` — actualizar.** `updateNotifierService` con los siete pasos de §3.5 y el patrón `objectToUpdate` del repositorio, escribiendo `updatedAt` explícitamente. Ruta `PUT /:id` en USER.
   *Verificación:* enviar `caseId` no lo modifica y la respuesta sigue trayendo el caso original; cambiar solo `lastName` deja `firstName` intacto y correctamente cifrado; un `professionItemId` inactivo devuelve 404; un PUT sin cambios devuelve 200 con una entrada más en `appDetails`, las anteriores intactas y `updatedAt` actualizado.

8. **`ESAVI-NOTIFIER-005A` y `005B` — desactivar y reactivar.** `setNotifierActivationService` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El `where` filtra solo por la PK. Dos controladores y dos rutas: `DELETE /:id` en ADMIN, `PATCH /activate/:id` en SUPERADMIN, ambas respondiendo sin `data`.
   *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve 409 `NOTIFIER_005A_ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe 403 en `PATCH /activate/:id`; reactivar un notificador cuyo caso está inactivo devuelve **200**, no un error.

9. **`ESAVI-NOTIFIER-005C` — purgar.** `purgeNotifierService` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción propia. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `notifierIdValidator` y declarada junto a las otras literales. Las tres claves i18n del bloque.
   *Verificación:* purgar un notificador activo devuelve 409 `NOTIFIER_005C_STILL_ACTIVE` y la fila sigue ahí; desactivarlo y purgarlo devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; el caso al que pertenecía sigue existiendo e intacto.

10. **La cascada — modificar `ESAVI-CASE-005A`.** Dentro de la transacción ya existente de `setEsaviCaseActivationService` (`src/services/esaviCase.service.ts:350-374`), después de `setEntityActiveStatusService` y antes del `commit`, un `Notifier.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt`, y añade a cada `appDetails` una entrada con `method: 'ESAVI-CASE-005A'`. **Solo cuando `isActive === false`.** Este paso va el último de los de código porque depende del modelo del paso 1 y no lo necesita ningún paso anterior.
   *Verificación:* desactivar un caso con dos notificadores activos los deja los dos inactivos con `deletedAt` sellado; reactivar el caso **no** los reactiva; desactivar un caso sin notificadores responde 200 sin error; desactivar un caso ya inactivo devuelve 409 y **ningún** notificador cambia de estado; un notificador que ya estaba inactivo antes de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.

11. **Registrar la entidad en las convenciones.** Fila `notifier` → `NOTIFIER` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6.
    *Verificación:* la abreviatura aparece una sola vez en la tabla y no colisiona con las trece existentes; la tabla de operaciones no canónicas queda intacta, porque este spec no añade ninguna.

12. **Cubrir las ocho rutas en `tests/auth/roles.test.ts`.** Ocho filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **82 a 90** (`tests/auth/roles.test.ts:186`). El 82 de partida ya incluye el `ESAVI-USERGEO-005C` que introdujo el SPEC F08.
    *Verificación:* `npm test -- roles` pasa.

13. **Suite de contrato `tests/contract/notifier.test.ts`.** Recorrido completo con `supertest`, siguiendo el molde de `healthFacility.test.ts`: crear → obtener por ID → listar público y admin con cada filtro → actualizar → desactivar → reactivar. Más los caminos de error: `caseId` inexistente (404), `caseId` inactivo (404), `professionItemId` de otro catálogo (404), `geoLocationId` inactivo (404), alta sin `caseId` (400), alta sin `lastName` (400), `email` malformado (400). Y las dos reglas propias: dos notificadores idénticos en el mismo caso se crean los dos, y enviar `caseId` en el `PUT` no mueve el notificador.
    *Verificación:* `npm test -- notifier` en verde.

14. **Ampliar `tests/contract/esaviCase.test.ts` con la cascada.** Tres casos nuevos en la suite ya existente: desactivar un caso arrastra sus notificadores activos; reactivarlo no los devuelve; un notificador desactivado a mano antes de la cascada conserva su estado y su `deletedAt`.
    *Verificación:* `npm test` en verde; la suite de `esaviCase` no pierde ninguno de sus casos anteriores.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las ocho rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones canónicas. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-NOTIFIER-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-NOTIFIER-00[6-9]" src/` no devuelve resultados: este spec no añade operaciones no canónicas.
- [ ] `NOTIFIER` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6.
- [ ] Existen los siete artefactos y `src/types/notifier/index.ts` está presente.
- [ ] `GET /api/notifiers/admin` no responde 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `EsaviCase.hasMany(Notifier)` está declarado, y `notifiers` **no** aparece en ninguna respuesta de `/api/esavi-cases`.

**Cifrado y normalización**

- [ ] Crear con `firstName: "maría josé"` guarda el cifrado de `María José`.
- [ ] Crear con `email: "  ANA@Correo.EC  "` guarda el cifrado de `ana@correo.ec`.
- [ ] Crear con `address: "av. amazonas 123"` guarda el cifrado de `Av. Amazonas 123`.
- [ ] Leer la fila directamente en la base muestra `firstName`, `lastName`, `email` y `address` ilegibles, y `phoneNumber`, `room` y `details` legibles.
- [ ] Los cuatro campos PII llegan **descifrados** en las cinco operaciones que devuelven notificador.
- [ ] Un `firstName` de 151 caracteres devuelve 400: el límite se valida sobre el texto en claro, no sobre el criptograma.
- [ ] Actualizar solo `lastName` deja `firstName` intacto y correctamente cifrado, no doblemente cifrado.

**Reglas de negocio**

- [ ] Crear sin `caseId`, sin `firstName` o sin `lastName` devuelve 400.
- [ ] Un `caseId` inexistente o inactivo devuelve 404 en create.
- [ ] Un `professionItemId` inexistente, inactivo o de un `catalogType` distinto de `'profession'` devuelve 404, tanto en create como en update.
- [ ] Un `geoLocationId` inexistente o inactivo devuelve 404, tanto en create como en update.
- [ ] Dos notificadores con el mismo nombre, correo y caso se crean los dos con 201: no hay unicidad.
- [ ] Enviar `caseId` en el body de `PUT /:id` deja el caso original intacto.
- [ ] Un notificador sin `professionItemId` ni `geoLocationId` se crea con 201 y la respuesta trae `profession: null` y `geoLocation: null`.

**Listados y filtros**

- [ ] `GET /` no devuelve notificadores inactivos; `GET /admin` sí.
- [ ] Un USER recibe 403 en `GET /admin`.
- [ ] `?caseId=` de un caso con tres notificadores devuelve `count: 3`.
- [ ] `?caseId=` de un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`, nunca 404.
- [ ] Los tres filtros combinados se aplican con `AND`.
- [ ] El orden por defecto es `createdAt DESC` y **no** hay ningún `ORDER BY` sobre un campo cifrado.
- [ ] Las filas del listado traen `email`, `address` y `room`, y no traen `details` ni `appDetails`.
- [ ] `sysDetails` no aparece en ninguna respuesta de ninguna operación.

**Cascada desde `esaviCase`**

- [ ] `DELETE /api/esavi-cases/:id` de un caso con dos notificadores activos los deja los dos con `isActive: false` y `deletedAt` sellado.
- [ ] `PATCH /api/esavi-cases/activate/:id` **no** reactiva ningún notificador.
- [ ] Un notificador desactivado a mano antes de la cascada conserva su `deletedAt` original y no recibe una entrada nueva en `appDetails`.
- [ ] Desactivar un caso ya inactivo devuelve 409 y **ningún** notificador cambia de estado: la transacción no llega a la cascada.
- [ ] Desactivar un caso sin notificadores responde 200 sin error.
- [ ] El `appDetails` de un notificador arrastrado por la cascada registra `method: 'ESAVI-CASE-005A'`, no `'ESAVI-NOTIFIER-005A'`.
- [ ] `PATCH /api/notifiers/activate/:id` sobre un notificador cuyo caso está inactivo devuelve **200**.

**Ciclo de vida y auditoría**

- [ ] `GET /:id` de un notificador inactivo: 404 para USER y para ADMIN, 200 para SUPERADMIN. La visibilidad la decide `canViewInactive`, que hoy es solo SUPERADMIN (`src/helpers/permissions.helper.ts:24-26`).
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] Desactivar dos veces devuelve 409 `NOTIFIER_005A_ALREADY_INACTIVE`.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Cada create, update y activación añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `appDetails.method` guarda solo el código, sin `_ACTIVATION` ni `_DEACTIVATION` detrás.
- [ ] `PUT /:id` actualiza `updatedAt`: ningún trigger lo hace por la aplicación.

**Borrado físico (`005C`)**

- [ ] `DELETE /purge/:id` sobre un notificador activo devuelve **409** `NOTIFIER_005C_STILL_ACTIVE` y la fila sigue existiendo.
- [ ] Sobre un notificador desactivado devuelve **200** con `{ ok, message }` y sin `data`.
- [ ] Tras la purga, `Notifier.findByPk(id, { paranoid: false })` devuelve `null`.
- [ ] Repetir la purga devuelve **404** `NOTIFIER_005C_NOT_FOUND`.
- [ ] Un ADMIN recibe **403**.
- [ ] Purgar un notificador **no** altera su caso: el `esaviCase` sigue existiendo con los mismos datos.
- [ ] El log recoge una línea `ESAVI-NOTIFIER-005C` en nivel `warn`, y los cuatro campos PII aparecen **cifrados** en el volcado.

**Cierre**

- [ ] Las claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` pasa de 82 a 90 entradas y `npm test -- roles` pasa.
- [ ] La suite `tests/contract/esaviCase.test.ts` conserva todos sus casos anteriores y suma los tres de la cascada.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la cardinalidad**

- **Sí:** uno a muchos. `classification` y `notification` declaran `UNIQUE ("caseId")` y `notifier` no (`esaviapp.sql:684-687`). Donde el esquema quiso una relación uno a uno lo dijo; aquí no lo dijo.
- **No:** imponer en código un notificador activo por caso con un 409. Es exactamente la clase de restricción inventada que el SPEC 09 vino a corregir en `healthFacility`: la aplicación mintiendo sobre un alcance que el SQL no declara.

**Sobre el cifrado**

- **Sí:** cifrar `firstName`, `lastName`, `email` y `address`. Es la línea que trazaron el SPEC F04 sobre `appUser` y el F05 sobre `patient`. El notificador es una persona identificable vinculada a un evento adverso concreto.
- **Sí:** cifrar `address`, aunque no haya precedente — `patient` no tiene columna equivalente. Una dirección postal identifica tanto como un nombre, y dejarla en claro haría que el cifrado del resto sirviera de poco.
- **No:** cifrar `phoneNumber`. Quedó fuera en `appUser` y en `patient`, y no se cambia de criterio a mitad de repositorio.
- **No:** cifrar `room` ni `details`. `room` es un número de consultorio, que no identifica a nadie por sí solo; `details` es texto libre operativo y cifrarlo impediría cualquier uso futuro sin ganar nada hoy.
- **Sí:** normalizar **antes** de cifrar, siempre. Cifrar primero produce el criptograma del texto crudo, y entonces `ana@correo.ec` y `ANA@Correo.EC` son dos valores distintos e irrecuperables.
- **Sí:** `email` a minúsculas antes de cifrar. `citext` no ayuda: la columna guarda el criptograma, así que la insensibilidad de Postgres se aplica al texto cifrado.
- **Sí:** validar las longitudes sobre el texto en claro. El usuario escribe texto plano y el 400 debe hablar de lo que escribió.

**Sobre la cascada — la deuda del SPEC F06**

- **Sí:** pagarla en este spec, aunque implique modificar `esaviCase`, que estaba cerrado. El F06 se comprometió explícitamente a que la resolviera «el spec que introduzca el primer satélite». Diferirla otra vez convertiría el compromiso en un TODO permanente.
- **Sí:** la cascada vive en `setEsaviCaseActivationService`, dentro de la transacción que ese servicio ya abre. Es el único punto por el que un caso se desactiva.
- **Sí:** cascada **solo de bajada**. Es la única opción que no destruye información: reactivar en cascada resucitaría notificadores que alguien retiró a propósito antes de tocar el caso.
- **No:** cascada simétrica que marque en `appDetails` cuáles cayeron por cascada, para reactivar solo ésos. Convierte la auditoría —que es append-only y descriptiva— en estado de negocio consultable, y cualquier hueco en el historial rompería la reactivación.
- **No:** dejar los notificadores activos y filtrarlos por el `isActive` del caso padre con un `required: true` en el include. Obligaría a que toda consulta futura sobre `notifier` recordara mirar al padre, y el estado real de la fila mentiría sobre el estado efectivo.
- **Sí:** el `appDetails` del notificador arrastrado registra `method: 'ESAVI-CASE-005A'`. La operación que lo desactivó fue ésa; poner `ESAVI-NOTIFIER-005A` haría creer que alguien lo desactivó individualmente.
- **Sí:** un `update` masivo en vez de recorrer los notificadores uno a uno. La cascada no toma decisiones por fila, y N `update` individuales dentro de una transacción escalan mal en un caso con muchos notificadores.
- **Sí:** reactivar un notificador **no** exige que su caso esté activo. Quien reactiva es SUPERADMIN, que es el único que ve los inactivos y quien decide. Bloquearlo obligaría a revertir una decisión administrativa mayor para arreglar una menor.
- **Sí, pero después:** extender la cascada a los otros cuatro satélites. Este spec construye el mecanismo y lo deja funcionando; cada spec posterior añade su tabla al mismo punto del servicio.

**Sobre `caseId`**

- **Sí:** obligatorio en el alta y con el caso **activo**. Es la regla de FK de §11, y colgar un notificador nuevo de un caso recién retirado contradice la cascada que este mismo spec introduce.
- **Sí:** inmutable en `004`, ignorado sin error si llega en el body. Es la misma decisión que el F06 tomó con `caseCode`. Trasladar un notificador dejaría a dos casos con auditoría incoherente: el origen registra una salida que su historial no explica.
- **No:** devolver 400 cuando `caseId` llega en el `PUT`. El F06 fijó el precedente contrario con `caseCode`, y un 400 por un campo que el cliente puede estar reenviando entero desde un `GET` previo es hostil sin motivo.

**Sobre los roles**

- **Sí:** `001` y `004` en **USER**, desviándose de la matriz canónica de §9. Es la desviación de los SPEC F05 y F06 y por la misma razón: el notificador se captura en el mismo flujo operativo que el caso.
- **Sí:** `005A` en ADMIN y `005B` en SUPERADMIN. Retirar un notificador del registro no es parte del flujo de notificación.

**Sobre el listado**

- **Sí:** dual `GET /` + `GET /admin`, como `esaviCase` y `patient`.
- **No:** listado por FK al estilo `healthFacility`, con `/case/:id` y `/admin/case/:id`. Es la misma decisión del F06: duplicaría servicio, controlador, validador y filas de `ROUTE_RULES` para la consulta que el filtro `?caseId=` ya resuelve.
- **Sí:** orden `createdAt DESC`. Los nombres están cifrados y `ORDER BY "lastName"` ordenaría por el criptograma, que es un orden arbitrario y estable — lo peor de las dos cosas, porque parece correcto.
- **Sí:** 200 con `count: 0` cuando el filtro apunta a un UUID inexistente. Filtrar por algo que no existe es una búsqueda vacía, no un recurso ausente.
- **Sí:** `email`, `address` y `room` en la forma reducida. El caso de uso del listado es localizar al notificador; obligar a un `GET /:id` por cada fila para conseguir un teléfono y un correo convierte una pantalla en N+1 peticiones.
- **No:** incluir `details` en la reducida. Es texto libre sin límite de longitud y hace el tamaño de la página impredecible.
- **No:** filtrar por el `isActive` del caso padre con `required: true` en el include. Con la cascada implementada el resultado es el mismo, y el include condicionado encarece la consulta sin cambiar nada.

**Sobre el modelo y las reglas**

- **Sí:** ninguna comprobación de unicidad. El DDL no declara ninguna `UNIQUE` sobre la tabla, y el mismo notificador puede figurar legítimamente en varios casos. Dentro del mismo caso, un duplicado es un error de captura, no una violación de integridad.
- **Sí:** `lastName` obligatorio en la aplicación aunque el DDL lo permita nulo. Un notificador con solo nombre de pila no identifica a nadie. Es la misma asimetría que `patient` mantiene entre su DDL permisivo y su validador.
- **Sí:** validar que `professionItemId` pertenezca al `catalogType` de código `'profession'`. Sin esa comprobación, cualquier `catalogItem` del sistema —un tipo de instalación, un sexo— entra como profesión y el dato queda inservible.
- **No:** sembrar el catálogo `'profession'` desde este spec. Los catálogos se cargan por los endpoints de `catalogType` y `catalogItem`, que ya existen; hacerlo aquí duplicaría esa vía y ataría el spec a un juego de datos concreto.
- **Sí:** declarar `EsaviCase.hasMany(Notifier)`, apartándose de la regla del F06 §3.2. Allí los inversos no los necesitaba ninguna operación; aquí la cascada recorre los notificadores del caso.
- **No:** incluir `notifiers` en las respuestas de `/api/esavi-cases`. El `hasMany` existe para la cascada, no para el contrato. Añadirlo cambiaría el tamaño de una respuesta ya publicada y va en su propio spec si alguna vez se pide.
- **Sí:** exponer `005C`. `notifier` no figura en el bucle `preventPhysicalDelete`, así que le corresponde por la regla del [SPEC F08](./08-physical-delete.md), que es objetiva y no se decide entidad por entidad. Las razones de fondo —por qué `005C` y no `006`, por qué SUPERADMIN, por qué se exige `isActive: false`— están allí y no se repiten aquí.
- **No:** añadir `notifier` a la lista de `preventPhysicalDelete` del DDL. `esaviapp.sql` no se toca. La respuesta a la falta de protección es la operación controlada del F08, no un cambio de esquema.
- **No:** crear el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea. Afecta a las 45 tablas y todos los servicios del repositorio ya escriben `updatedAt` a mano; el arreglo es transversal y va en su propio spec.
- **No:** vincular el notificador con un `appUser`. El DDL no declara esa FK, y el notificador puede ser personal externo sin cuenta en el sistema.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| `notifier` **no** está en la lista de `preventPhysicalDelete` (`esaviapp.sql:1354-1360`), así que un `DELETE FROM "notifier"` ejecuta sin error y borra datos de forma irreversible | Ya no es una vía descontrolada: el [SPEC F08](./08-physical-delete.md) la convierte en la operación `005C`, que exige SUPERADMIN, exige que la fila esté desactivada y vuelca su contenido al log antes de destruirla. Lo que queda es que el borrado sigue siendo posible por SQL directo sin ninguno de esos controles, cosa que el DDL no impide y este spec no cambia |
| El rastro de una purga vive solo en `src/logs/esaviLog.log`, que está en `.gitignore`, sin retención y con rotación por tamaño | Es la limitación asumida del F08 y está declarada allí en §7. Para `notifier` importa algo más que para otras entidades: el volcado contiene los cuatro campos PII, aunque cifrados |
| La cascada modifica `setEsaviCaseActivationService`, un servicio implementado y con suite de contrato en verde | El cambio es aditivo y está acotado a la rama `isActive === false`, dentro de la transacción que ya existía. El paso 13 amplía `tests/contract/esaviCase.test.ts` sin retirar ninguno de sus casos, así que una regresión en el comportamiento anterior falla la suite |
| Cada spec de satélite que venga después tiene que acordarse de sumarse a la cascada, y no hay nada que lo fuerce | El mecanismo queda escrito en un solo punto de `esaviCase.service.ts` y documentado en §2 como alcance explícito de los specs posteriores. Un satélite que se olvide deja filas huérfanas activas, que es el mismo síntoma que este spec corrige — detectable, pero solo si alguien mira |
| El `catalogType` de código `'profession'` no existe en el DDL ni en ninguna siembra del repositorio: si no se carga antes, toda alta con `professionItemId` devuelve 404 y parece un fallo del endpoint | Está declarado como precondición del plan de implementación, no como paso. El mensaje `notifier.professionNotFound` nombra la causa. La carga se hace por los endpoints ya existentes de catálogos |
| Cifrar `address` no tiene precedente en el repositorio, y `esaviCrypt` sobre `varchar(250)` podría desbordar la columna con direcciones largas | `patient` ya cifra cuatro `varchar(150)` sin incidencias, y el validador limita `address` a 250 caracteres **en claro**. Conviene comprobar el margen real con una dirección de longitud máxima antes de cerrar el paso 4, porque el desbordamiento se manifestaría como un 500 de Postgres y no como un 400 |
| Los cuatro campos cifrados no admiten búsqueda ni orden: un cliente que espere buscar notificadores por nombre no puede | Es la consecuencia asumida del cifrado determinista, la misma que ya tiene `patient`. Queda fuera de alcance en §2. Si alguna vez se pide, la única vía es la igualdad exacta sobre el valor cifrado, como hace `ESAVI-PATIENT-006` |
| `GET /:id` captura `admin` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato |
| Un caso puede acumular notificadores duplicados por errores de captura, y nada lo impide | Es deliberado: no hay unicidad porque el DDL no la declara y el dominio admite varios notificadores. La limpieza es operativa, con `005A` sobre el duplicado |
| Reactivar un notificador cuyo caso sigue inactivo deja una fila activa colgando de un padre retirado — justo el estado que la cascada corrige | Solo lo puede hacer SUPERADMIN, que es quien ve los inactivos y quien decide. Bloquearlo obligaría a reactivar el caso entero. Queda como acción deliberada de un rol que sabe lo que hace, no como agujero |

---

## 8. Impacto en el contrato HTTP

Este spec añade siete endpoints nuevos, que no impactan a nadie. Pero **sí cambia el comportamiento de un endpoint ya publicado**:

| Endpoint | Antes | Después |
|---|---|---|
| `DELETE /api/esavi-cases/:id` (`ESAVI-CASE-005A`) | Desactiva únicamente la fila del caso | Desactiva el caso **y todos sus notificadores activos**, en la misma transacción |
| `PATCH /api/esavi-cases/activate/:id` (`ESAVI-CASE-005B`) | Reactiva la fila del caso | Sin cambios: **no** reactiva ningún notificador |

La forma de la respuesta de las dos operaciones no cambia: siguen devolviendo `{ ok, message }` sin `data`, y siguen respondiendo 200 en éxito y 409 cuando el caso ya está en el estado pedido. Lo que cambia es el efecto lateral.

La asimetría es intencional y está razonada en §6: desactivar un caso arrastra, reactivarlo no devuelve. Un cliente que hoy desactive y reactive un caso esperando volver al estado anterior **no lo consigue** — los notificadores quedan inactivos y hay que reactivarlos uno a uno con `PATCH /api/notifiers/activate/:id`, que exige SUPERADMIN. Conviene avisar a los consumidores de la API antes de desplegar.

`GET /api/esavi-cases` y `GET /api/esavi-cases/:id` **no cambian**: el `hasMany` nuevo no se incluye en ninguna de sus consultas y `notifiers` no aparece en sus respuestas.

---

## Lo que **no** está en este spec

- Las otras cuatro tablas satélite de `esaviCase` —`classification`, `notification`, `investigation` y `finalClassification`— y las veintiocho que cuelgan de ellas.
- Extender la cascada de `ESAVI-CASE-005A` a esos cuatro satélites. El mecanismo queda construido; el catálogo completo lo van sumando los specs posteriores.
- Sembrar el `catalogType` de código `'profession'` y sus items. Es precondición, no alcance.
- Añadir `notifier` a la lista de `preventPhysicalDelete`, crear el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea, o cualquier otra modificación de `esaviapp.sql`.
- Las reglas transversales de la operación `005C`, que están en el [SPEC F08](./08-physical-delete.md). Aquí solo se declara la ruta y las claves de esta entidad.
- Imponer un notificador único por caso, o cualquier otra unicidad sobre `email`, `phoneNumber` o la combinación de nombre y caso.
- Búsqueda o filtrado por nombre, correo o dirección, y cualquier endpoint `006` de búsqueda.
- Ordenar el listado alfabéticamente por nombre.
- Incluir `notifiers` en las respuestas de `/api/esavi-cases`.
- Vincular el notificador con un `appUser` del sistema.
- Reasignar un notificador a otro caso.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
