# SPEC F06 — CRUD completo de esaviCase

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F05 (`patient` — dependencia dura: sin el modelo `Patient` este spec no se puede implementar)**
> **Fecha:** 2026-08-06
> **Objetivo:** Dar de alta la entidad `esaviCase` con sus siete artefactos y sus siete operaciones canónicas, generando el `caseCode` a partir del código de la instalación, la fecha de reporte y un secuencial diario.

---

## 1. Por qué existe este spec

`esaviCase` es el nodo central del dominio. Cinco tablas cuelgan de `caseId` con `ON DELETE CASCADE` — `notifier` (`esaviapp.sql:688`), `classification` (`717`), `notification` (`741`), `investigation` (`944`) y `finalClassification` (`1269`) —, y esas cinco arrastran a su vez las veintiocho tablas de los bloques de notificación e investigación. Mientras el caso no exista en `src/`, ninguna de las treinta y tres puede implementarse: todas necesitan un caso al que apuntar.

Hoy la tabla existe en `esaviapp.sql:646-668` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta. Un caso solo se puede cargar por SQL directo.

Tres características la separan de las entidades ya especificadas:

**A — Es la primera entidad con dos FK obligatorias.** `patientId` y `healthFacilityId` son `NOT NULL` con `ON DELETE RESTRICT` (`esaviapp.sql:663-664`). En `patient` las dos FK eran opcionales y su validación era una cortesía; aquí un caso sin paciente o sin instalación no es representable, y la validación de ambas deja de ser opcional en cualquier orden de escritura.

**B — El `caseCode` es obligatorio, único y nadie lo genera.** `UQ_esaviCase_caseCode` impone unicidad global sobre un `varchar(200)` `NOT NULL`, y el DDL no trae ni `DEFAULT`, ni secuencia, ni trigger que lo rellene. Un `INSERT` sin `caseCode` falla en la base. La aplicación tiene que producirlo, y producirlo sin colisionar.

**C — La función `createEsaviCase()` del esquema está desfasada.** `esaviapp.sql:1379-1396` inserta `patientId`, `caseCode`, `reportDate`, `eventDate` y `countryIsoCode` — pero **no `healthFacilityId`**, que es `NOT NULL`. Cualquier llamada a esa función falla siempre. No es un problema que este spec resuelva —el servicio inserta con Sequelize y no la usa—, pero conviene saber que existe y que no es una vía alternativa de alta.

A eso se suma una ausencia respecto a `healthFacility`: el DDL declara `TRG_healthFacility_validateCatalogs` para validar catálogos en esa tabla, pero **`esaviCase` no tiene ningún trigger de validación** (`esaviapp.sql:1296-1299`). Los tres genéricos que sí la alcanzan —`TRG_esaviCase_setUpdatedAt`, `TRG_esaviCase_setSysDetails` y `TRG_esaviCase_preventPhysicalDelete` (`esaviapp.sql:1367`)— no comprueban ninguna regla de negocio. El estado de las FK y la coherencia de las fechas son responsabilidad exclusiva del servicio.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `esaviCase`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Las siete operaciones canónicas: `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- Generación por el sistema de `caseCode` con formato `<localCode>-DDMMYYYY-NNNN`: el `localCode` de la instalación, la `reportDate` del caso en `DDMMYYYY`, y un secuencial de cuatro dígitos que empieza en `0001` y reinicia por **instalación y fecha**. Nunca recibido del cliente, nunca modificable.
- Reintento acotado a tres intentos ante violación de `UQ_esaviCase_caseCode`, recalculando el secuencial en cada intento.
- Rechazo del alta cuando la instalación no tiene `localCode`: sin prefijo no hay código, y no se inventa uno.
- Validación de las dos FK obligatorias en create **y** en update: `patientId` y `healthFacilityId` deben existir y estar activos.
- Normalización en escritura: `.trim().toUpperCase()` en `countryIsoCode`, `toTitleCase` en `notificationOrganization`.
- Coherencia de fechas: `reportDate` y `eventDate` no pueden ser futuras, y `eventDate` no puede ser posterior a `reportDate`. `reportFillingDate` tampoco puede ser futura.
- Listados con `findAndCountAll`, orden por defecto `reportDate DESC`, paginación y tres filtros por query: `patientId`, `healthFacilityId` y el rango `reportDateFrom`/`reportDateTo`.
- Alta de la abreviatura `CASE` en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/esaviCase.test.ts`.

**Fuera de alcance (otros specs):**

- Las cinco tablas satélite —`notifier`, `classification`, `notification`, `investigation` y `finalClassification`— y las veintiocho que cuelgan de ellas. Este spec deja el caso listo para que se apoyen en él, pero no crea ninguna.
- **El borrado lógico en cascada de los satélites.** Hoy `DELETE /:id` desactiva solo la fila del caso y no toca nada más, porque no hay nada que tocar. Cuando `notification` e `investigation` tengan modelo, la desactivación de un caso tiene que arrastrar a sus hijos: el `ON DELETE CASCADE` del DDL solo actúa en borrados físicos, que `TRG_esaviCase_preventPhysicalDelete` impide. Queda anotado como deuda explícita de este spec, a resolver en el spec que introduzca el primer satélite.
- Hacer `localCode` obligatorio en `healthFacility`. Es una modificación de una entidad ya implementada y va en su propio spec. Aquí solo se rechaza el alta cuando falta.
- Corregir `createEsaviCase()` en `esaviapp.sql`. El DDL no se toca.
- Búsqueda por texto sobre `details` o `notificationOrganization`.
- Filtrar o listar casos por geolocalización, siguiendo la jerarquía de la instalación.
- Validar `countryIsoCode` contra un catálogo de países. No existe la tabla; se valida solo la forma.
- Reasignar un caso a otro paciente por fusión de duplicados.
- Exportar casos, generar reportes o cualquier agregación estadística.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`esaviCase` — `esaviapp.sql:646-668`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `caseId` | `uuid` | no | PK, `gen_random_uuid()` |
| `patientId` | `uuid` | **no** | `FK_esaviCase_patient` → `patient`, `ON DELETE RESTRICT` |
| `healthFacilityId` | `uuid` | **no** | `FK_esaviCase_healthFacility` → `healthFacility`, `ON DELETE RESTRICT` |
| `caseCode` | `varchar(200)` | **no** | `UQ_esaviCase_caseCode` — unicidad global; generado por el sistema |
| `reportDate` | `date` | **no** | `DEFAULT current_date`; no se admite futura |
| `eventDate` | `date` | sí | no futura, no posterior a `reportDate` |
| `countryIsoCode` | `varchar(5)` | sí | normalizado a mayúsculas; sin catálogo que lo respalde |
| `reportFillingDate` | `date` | sí | no futura |
| `notificationOrganization` | `varchar(250)` | sí | `toTitleCase` |
| `details` | `text` | sí | |

Índices: `IX_esaviCase_patient` sobre `patientId` e `IX_esaviCase_reportDate` sobre `reportDate`.

Las cuatro columnas transversales están presentes y completas: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB), más `createdAt` y `updatedAt`. No hay anomalía que resolver antes de implementar.

Tres triggers genéricos alcanzan a la tabla: `TRG_esaviCase_setUpdatedAt`, `TRG_esaviCase_setSysDetails` y `TRG_esaviCase_preventPhysicalDelete` (`esaviapp.sql:1367`). El tercero hace que un `DELETE` físico falle en la base: el borrado lógico no es una preferencia de diseño, es la única vía. **Ninguno valida reglas de negocio**, y no existe trigger de validación específico como el de `healthFacility`.

Cinco tablas referencian `caseId` con `ON DELETE CASCADE` — `notifier`, `classification`, `notification`, `investigation` y `finalClassification` —, y `classification` y `notification` declaran además `UNIQUE ("caseId")`: son relaciones uno a uno. Ninguna tiene modelo todavía.

### 3.2 Modelo Sequelize

Archivo: `src/models/esaviCase.model.ts`. Clase `EsaviCase`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'esaviCase'`. PK `caseId` con `defaultValue: sequelize.literal('gen_random_uuid()')`.

Las cuatro columnas de fecha —`reportDate`, `eventDate`, `reportFillingDate`— van como **`DATEONLY`**, no `DATE`: son columnas `date` y `DATE` arrastraría zona horaria, desplazando la fecha de reporte un día según el huso del servidor. Es la misma decisión que tomó el SPEC F05 con `birthDate`, y aquí importa más: la fecha de reporte forma parte del `caseCode`.

`patientId`, `healthFacilityId`, `caseCode` y `reportDate` van `allowNull: false`, calcando el DDL. `caseCode` **no lleva `defaultValue`**: lo produce el servicio antes del `create`.

Asociaciones, en `src/models/associations/esaviCase.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `EsaviCase.belongsTo(Patient, { as: 'patient', foreignKey: 'patientId' })`
- `EsaviCase.belongsTo(HealthFacility, { as: 'healthFacility', foreignKey: 'healthFacilityId' })`

Ninguna de las dos va dentro del archivo del modelo. Alta en `src/models/index.ts`.

Los inversos `Patient.hasMany` y `HealthFacility.hasMany` **no se declaran**. No hay ninguna operación de este spec que los necesite —los listados filtran por FK, no navegan desde el padre— y declararlos ahora invita a incluirlos en las respuestas de `patient` y `healthFacility`, que es un cambio de contrato que este spec no hace.

### 3.3 Tipos

`src/types/esaviCase/esaviCase.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`. El barrel del dominio es obligatorio: `src/types/healthFacility/` no lo tiene y eso está catalogado como deuda; no se repite.

```ts
export interface CreateEsaviCaseInput {
    patientId: string;
    healthFacilityId: string;
    reportDate?: string | null;
    eventDate?: string | null;
    countryIsoCode?: string | null;
    reportFillingDate?: string | null;
    notificationOrganization?: string | null;
    details?: string | null;
    isActive?: boolean;
}
```

`caseCode` **no aparece en la interfaz**. Lo genera el servicio; si el cliente lo manda, se ignora sin error.

`reportDate` es opcional en la entrada aunque sea `NOT NULL` en el DDL: si no llega, el servicio usa la fecha de hoy antes de calcular el `caseCode`. No se delega en el `DEFAULT current_date` de la base, porque el código de caso necesita conocer la fecha **antes** del `INSERT`.

El update usa `Partial<CreateEsaviCaseInput>`. No se declara `UpdateEsaviCaseInput`.

### 3.4 Superficie HTTP

```
POST   /api/esavi-cases                  ESAVI-CASE-001   USER        (nuevo)
GET    /api/esavi-cases                  ESAVI-CASE-002A  USER        (nuevo)
GET    /api/esavi-cases/admin            ESAVI-CASE-002B  ADMIN       (nuevo)
GET    /api/esavi-cases/:id              ESAVI-CASE-003   USER        (nuevo)
PUT    /api/esavi-cases/:id              ESAVI-CASE-004   USER        (nuevo)
DELETE /api/esavi-cases/:id              ESAVI-CASE-005A  ADMIN       (nuevo)
PATCH  /api/esavi-cases/activate/:id     ESAVI-CASE-005B  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/esaviCase.routes.ts`: las rutas literales (`/admin`, `/activate/:id`) van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la misma desviación que tomó el SPEC F05 con `patient` y por la misma razón: quien abre un caso ESAVI es el personal operativo que acaba de registrar al paciente. `005A` se queda en ADMIN y `005B` en SUPERADMIN.

No hay operaciones no canónicas: los filtros de listado van por query sobre `002A`/`002B`, no como endpoints propios.

### 3.5 Reglas de negocio por operación

**`ESAVI-CASE-001` — crear.** En este orden:

1. Resuelve `reportDate`: la que venga en el body o la fecha de hoy si no viene.
2. Valida `patientId`: existe y `isActive: true` → 404 `CASE_001_PATIENT_NOT_FOUND`.
3. Valida `healthFacilityId`: existe y `isActive: true` → 404 `CASE_001_FACILITY_NOT_FOUND`.
4. La instalación tiene `localCode` no vacío → 409 `CASE_001_LOCALCODE_MISSING`. Es 409 y no 400: el body del cliente es correcto, lo que está mal es el estado de un recurso referenciado.
5. Normaliza: `.trim().toUpperCase()` en `countryIsoCode`, `toTitleCase` en `notificationOrganization`.
6. Genera `caseCode` (ver abajo) e inserta con la entrada de auditoría `method: 'ESAVI-CASE-001'`.

**Generación del `caseCode`.** Prefijo `<localCode>` tal cual está guardado, separador `-`, la `reportDate` formateada `DDMMYYYY`, separador `-`, y el secuencial de cuatro dígitos con relleno de ceros. Para `HOSP` y el 6 de agosto de 2026: `HOSP-06082026-0001`.

El secuencial sale de una sola consulta:

```
MAX("caseCode") WHERE "healthFacilityId" = <id> AND "reportDate" = <fecha>
```

y se le suma uno. El máximo lexicográfico coincide con el numérico porque el secuencial tiene ancho fijo con ceros a la izquierda, así que no hace falta parsear la cadena. La consulta **no filtra por `isActive`**: un caso desactivado sigue ocupando su código, y reutilizarlo produciría una violación de `UQ_esaviCase_caseCode`.

**El reintento.** El cálculo no es atómico: dos altas simultáneas en la misma instalación y fecha obtienen el mismo `MAX`. El servicio envuelve el `create` en un bucle de **hasta tres intentos**; ante un `SequelizeUniqueConstraintError` sobre `caseCode` recalcula el máximo y reintenta. Agotados los tres, responde 409 `CASE_001_CODE_EXISTS`. Cualquier otro error se propaga sin reintentar.

**`ESAVI-CASE-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, includes `patient` y `healthFacility`, orden `[['reportDate', 'DESC'], ['caseCode', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. El segundo criterio de orden desempata los casos del mismo día de forma estable. Filtros opcionales por query, acumulativos con `AND`:

- `patientId` — igualdad, UUID.
- `healthFacilityId` — igualdad, UUID.
- `reportDateFrom` / `reportDateTo` — `Op.between` cuando llegan las dos, `Op.gte` u `Op.lte` cuando llega una sola.

Un filtro de FK con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404: filtrar por algo inexistente es una búsqueda vacía, no un recurso ausente. Devuelve la forma reducida de §3.7.

**`ESAVI-CASE-002B` — listar, admin.** Idéntica, sin `isActive` en el `where`. Los mismos tres filtros.

**`ESAVI-CASE-003` — obtener por ID.** `where` con `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero → 404 `CASE_003_NOT_FOUND`. Devuelve la forma completa de §3.7.

**`ESAVI-CASE-004` — actualizar.** En este orden:

1. Existencia → 404 `CASE_004_NOT_FOUND`.
2. Si viene `patientId`: existe y activo → 404 `CASE_004_PATIENT_NOT_FOUND`.
3. Si viene `healthFacilityId`: existe y activo → 404 `CASE_004_FACILITY_NOT_FOUND`.
4. Coherencia de fechas contra el estado **resultante**, no contra el body: si solo llega `eventDate`, se compara con la `reportDate` ya guardada.
5. `caseCode` **se ignora siempre**, venga o no en el body. Cambiar `healthFacilityId` o `reportDate` **no** regenera el código: un identificador que cambia deja de identificar.
6. Preserva el historial con `[...currentAppDetails, newEntry]`.

**`ESAVI-CASE-005A` / `005B` — desactivar y reactivar.** `setEsaviCaseActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, calculando `const op = isActive ? '005B' : '005A'`. El `where` filtra **solo por la PK**. **No se toca ninguna tabla satélite**: hoy ninguna tiene modelo. `DELETE` sella `deletedAt`; `PATCH /activate` lo deja en `null`. Ambos responden `{ ok, message }` sin `data`.

**Validaciones de forma** (las emite `validateFields` con 400, no el servicio): `reportDate`, `eventDate` y `reportFillingDate` con `.isISO8601()` y rechazo de fechas posteriores a hoy; `eventDate` no posterior a `reportDate`; `countryIsoCode` de 2 a 5 caracteres alfabéticos; `patientId` y `healthFacilityId` con `.isUUID()`, obligatorios en create.

### 3.6 Claves i18n nuevas

Bloque `esaviCase` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

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
| `patientNotFound` | 404 cuando `patientId` no existe o está inactivo |
| `healthFacilityNotFound` | 404 cuando `healthFacilityId` no existe o está inactivo |
| `facilityLocalCodeMissing` | 409 cuando la instalación no tiene `localCode` y el caso no puede numerarse |
| `caseCodeExists` | 409 tras agotar los tres reintentos de generación |
| `invalidDateRange` | 400 cuando `eventDate` es posterior a `reportDate` |
| `futureDate` | 400 cuando cualquiera de las tres fechas es futura |

No hay `codeExists` genérico: el conflicto de `caseCode` no lo provoca el cliente y merece un mensaje propio. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

### 3.7 Forma de la respuesta

**Completa** — `003`, `001` y `004`:

```
{ ok, message, data: {
    caseId, caseCode, reportDate, eventDate, countryIsoCode,
    reportFillingDate, notificationOrganization, details,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    patient:        { patientId, firstName, lastName, documentNumber, healthSystemCode },
    healthFacility: { healthFacilityId, localCode, name }
} }
```

**Reducida** — `002A` y `002B`, dentro de `{ count, rows }`:

```
{ caseId, caseCode, reportDate, eventDate, isActive,
  patient:        { patientId, firstName, lastName, healthSystemCode },
  healthFacility: { healthFacilityId, localCode, name } }
```

La reducida omite `details`, `countryIsoCode`, `reportFillingDate`, `notificationOrganization` y `appDetails`: `details` es texto libre sin límite de longitud y volcarlo en cada fila de una página hace la respuesta impredecible.

Los campos del paciente llegan **descifrados** con `esaviDecrypt`, como impone el SPEC F05; `documentNumber` solo aparece en la forma completa. `sysDetails` **nunca** se devuelve, en ninguna operación.

---

## 4. Plan de implementación

**Precondición.** El SPEC F05 debe estar implementado antes del paso 1: `patientId` es `NOT NULL` y las asociaciones, la validación de FK y la forma de respuesta necesitan el modelo `Patient`. Sin él, ningún paso de este plan compila.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Modelo, asociaciones y tipos.** `src/models/esaviCase.model.ts` con las tres fechas como `DATEONLY` y `caseCode` sin `defaultValue`; `src/models/associations/esaviCase.associations.ts` con `patient` y `healthFacility`, registrado en `initModels()`; `src/types/esaviCase/esaviCase.types.ts` con `CreateEsaviCaseInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `EsaviCase.findAndCountAll({ include: ['patient', 'healthFacility'] })` desde un script suelto devuelve filas sin error de asociación; ni `Patient` ni `HealthFacility` declaran `hasMany` hacia el caso.

2. **Claves i18n.** El bloque `esaviCase` completo de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

3. **Helper de formato del código.** `formatCaseCode(localCode, reportDate, sequence)` en `src/helpers/identifier.helper.ts` —el archivo que crea el SPEC F05—, registrado en `src/helpers/index.ts`. Función pura: no lee la base, no calcula el secuencial, solo compone `<localCode>-DDMMYYYY-NNNN` con relleno de cuatro ceros. El cálculo del secuencial vive en el servicio, que es quien tiene la transacción.
   *Verificación:* `formatCaseCode('HOSP', '2026-08-06', 1)` devuelve `HOSP-06082026-0001`; con `sequence: 42` devuelve `HOSP-06082026-0042`; con `sequence: 10000` la función lanza en vez de producir un código de cinco dígitos.

4. **Validadores.** `src/validators/esaviCase.validator.ts` con cuatro arrays: `esaviCaseIdValidator`, `esaviCaseListValidator` (los tres filtros de §3.5 más `limit` y `offset`), `createEsaviCaseValidator` (`patientId` y `healthFacilityId` obligatorios y UUID; las tres fechas ISO 8601 y no futuras; `eventDate` no posterior a `reportDate`; `countryIsoCode` de 2 a 5 alfabéticos) y `updateEsaviCaseValidator` (todo opcional, mismas reglas de formato). Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

5. **`ESAVI-CASE-001` — crear.** `createEsaviCaseService` con los seis pasos de §3.5 en ese orden, la consulta de `MAX("caseCode")` sin filtro de `isActive`, y el bucle de tres reintentos que solo captura `SequelizeUniqueConstraintError` sobre `caseCode`. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* el primer caso del día en una instalación devuelve `...-0001` y el segundo `...-0002`; desactivar el `-0002` y crear otro devuelve `-0003`, no `-0002`; un caso en otra instalación el mismo día vuelve a empezar en `-0001`; una instalación sin `localCode` devuelve **409**; un `patientId` inactivo devuelve **404**; enviar `caseCode: "MIO"` en el body no altera el generado; `eventDate` posterior a `reportDate` devuelve **400**.

6. **`ESAVI-CASE-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, los tres filtros acumulativos de §3.5, includes `patient` y `healthFacility`, orden `reportDate DESC, caseCode DESC`, paginación y forma reducida de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve casos inactivos y `/admin` sí; un USER recibe 403 en `/admin`; `?patientId=` de un paciente con dos casos devuelve `count: 2`; `?patientId=` de un UUID inexistente devuelve **200** con `count: 0`; `?reportDateFrom` y `?reportDateTo` juntos acotan el rango por ambos extremos, y cada uno por separado acota solo el suyo; los tres filtros combinados se aplican con `AND`; ninguna fila trae `details` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total.

7. **`ESAVI-CASE-003` — obtener por ID.** `getEsaviCaseByIdService(id, lang, includeInactive)` con los dos includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; un caso desactivado devuelve 404 para USER y 200 para ADMIN; los campos del paciente llegan descifrados; `sysDetails` no aparece.

8. **`ESAVI-CASE-004` — actualizar.** `updateEsaviCaseService` con los seis pasos de §3.5 y el patrón `objectToUpdate` del repositorio, comparando las fechas contra el estado resultante y no contra el body. Ruta `PUT /:id` en USER.
   *Verificación:* enviar `caseCode` no lo modifica; cambiar `healthFacilityId` **no** regenera el código; cambiar solo `eventDate` a un día posterior a la `reportDate` guardada devuelve 400; un `patientId` inactivo devuelve 404; un PUT sin cambios devuelve 200 con una entrada más en `appDetails` y las anteriores intactas.

9. **`ESAVI-CASE-005A` y `005B` — desactivar y reactivar.** `setEsaviCaseActivationService` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El `where` filtra solo por la PK. Dos controladores y dos rutas: `DELETE /:id` en ADMIN, `PATCH /activate/:id` en SUPERADMIN, ambas respondiendo sin `data`.
   *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve 409 `CASE_005A_ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe 403 en `PATCH /activate/:id`; el `caseCode` del caso desactivado sigue sin poder reutilizarse.

10. **Registrar la entidad en las convenciones.** Fila `esaviCase` → `CASE` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6.
    *Verificación:* la abreviatura aparece una sola vez en la tabla y no colisiona con las nueve existentes; la tabla de operaciones no canónicas queda intacta, porque este spec no añade ninguna.

11. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado en siete.
    *Verificación:* `npm test -- roles` pasa.

12. **Suite de contrato `tests/contract/esaviCase.test.ts`.** Recorrido completo con `supertest`, siguiendo el molde de `healthFacility.test.ts`: crear → obtener por ID → listar público y admin con cada filtro → actualizar → desactivar → reactivar. Más los caminos de error: instalación sin `localCode` (409), `patientId` inactivo (404), `healthFacilityId` inexistente (404), `eventDate` posterior a `reportDate` (400), fecha futura (400), alta sin `patientId` (400). Y la secuencia del código: tres altas consecutivas en la misma instalación y fecha producen `-0001`, `-0002` y `-0003`.
    *Verificación:* `npm test` en verde.

La carrera del secuencial **no queda cubierta por la suite**. Jest corre con `--runInBand` y supertest emite peticiones secuenciales, así que dos altas nunca se solapan de verdad. El reintento del paso 5 se verifica por lectura del código y por el 409 tras agotar los intentos, no por un test de concurrencia. Queda anotado en §7.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones.
- [ ] `grep -rn "ESAVI-CASE-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-CASE-00[6-9]" src/` no devuelve resultados: este spec no añade operaciones no canónicas.
- [ ] `CASE` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6.
- [ ] Existen los siete artefactos y `src/types/esaviCase/index.ts` está presente.
- [ ] `GET /api/esavi-cases/admin` no responde 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] Ni `Patient` ni `HealthFacility` declaran `hasMany` hacia `EsaviCase`.

**`caseCode`**

- [ ] El primer caso de una instalación en una fecha recibe el sufijo `-0001`, el segundo `-0002` y el tercero `-0003`.
- [ ] El prefijo es exactamente el `localCode` de la instalación y la fecha es la `reportDate` en `DDMMYYYY`.
- [ ] Dos instalaciones distintas el mismo día empiezan las dos en `-0001`.
- [ ] La misma instalación en dos fechas distintas empieza las dos veces en `-0001`.
- [ ] Desactivar un caso y crear otro en la misma instalación y fecha **no** reutiliza el código liberado.
- [ ] Crear en una instalación sin `localCode` devuelve **409**, no 500 ni un código con prefijo vacío.
- [ ] Enviar `caseCode` en el body de `POST /` no altera el código generado.
- [ ] Enviar `caseCode` en el body de `PUT /:id` deja el código intacto.
- [ ] Cambiar `healthFacilityId` o `reportDate` por `PUT /:id` no regenera el `caseCode`.
- [ ] `CreateEsaviCaseInput` no declara `caseCode`.
- [ ] `formatCaseCode` lanza con un secuencial de 10000 en vez de emitir cinco dígitos.

**Reglas de negocio**

- [ ] Crear sin `patientId` o sin `healthFacilityId` devuelve 400.
- [ ] Un `patientId` inexistente o inactivo devuelve 404, tanto en create como en update.
- [ ] Un `healthFacilityId` inexistente o inactivo devuelve 404, tanto en create como en update.
- [ ] Crear con `reportDate` de mañana devuelve 400; con la fecha de hoy devuelve 201.
- [ ] Crear con `eventDate` posterior a `reportDate` devuelve 400.
- [ ] Actualizar solo `eventDate` a un día posterior a la `reportDate` **ya guardada** devuelve 400.
- [ ] Crear sin `reportDate` guarda la fecha de hoy y el `caseCode` lleva esa misma fecha.
- [ ] Crear con `countryIsoCode: " ec "` guarda `EC`.

**Listados y filtros**

- [ ] `GET /` no devuelve casos inactivos; `GET /admin` sí.
- [ ] Un USER recibe 403 en `GET /admin`.
- [ ] `?patientId=` de un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`, nunca 404.
- [ ] `?reportDateFrom` y `?reportDateTo` juntos acotan por ambos extremos; cada uno por separado acota solo el suyo.
- [ ] Los tres filtros combinados se aplican con `AND`.
- [ ] El orden por defecto es `reportDate DESC` y desempata por `caseCode DESC`.
- [ ] Las filas del listado no traen `details`, `countryIsoCode`, `reportFillingDate`, `notificationOrganization` ni `appDetails`.
- [ ] `sysDetails` no aparece en ninguna respuesta de ninguna operación.
- [ ] Los campos del paciente llegan **descifrados** en las cinco operaciones que devuelven caso.

**Ciclo de vida y auditoría**

- [ ] `GET /:id` de un caso inactivo: 404 para USER, 200 para ADMIN.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] Desactivar dos veces devuelve 409 `CASE_005A_ALREADY_INACTIVE`.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Cada create, update y activación añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `appDetails.method` guarda solo el código, sin `_ACTIVATION` ni `_DEACTIVATION` detrás.

**Cierre**

- [ ] Las claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene siete entradas más que antes de este spec y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el `caseCode`**

- **Sí:** generarlo el sistema e ignorar el campo si llega en el body, sin devolver 400. Es el identificador oficial del caso: si el cliente lo elige, dos operadores acaban compitiendo por el mismo código y el 409 lo recibe quien llegó segundo por un error que no cometió.
- **Sí:** formato `<localCode>-DDMMYYYY-NNNN`. Es legible, dictable por teléfono y dice de un vistazo dónde y cuándo se reportó el caso, que es como se habla de un ESAVI en operación.
- **No:** un UID opaco aleatorio como el `healthSystemCode` del SPEC F05. Allí el requisito era el contrario —el código no debía revelar nada, porque acompaña a datos cifrados—; aquí el caso no es un dato personal y el operador necesita reconocerlo sin abrirlo.
- **Sí:** el prefijo sale de `localCode` y de ningún otro campo. Es el único de `healthFacility` con `UNIQUE` (`UQ_healthFacility_localCode`), así que es el único que garantiza que dos instalaciones no compartan prefijo.
- **No:** caer a `shortName`, a las primeras letras de `name` o a un literal fijo cuando falta `localCode`. Un prefijo inventado hace que el código deje de identificar la instalación, que es justo lo que el formato promete; y `shortName` no es único, así que dos instalaciones podrían generar el mismo código.
- **Sí:** 409 y no 400 cuando la instalación no tiene `localCode`. El body del cliente es correcto: lo que impide el alta es el estado de un recurso referenciado.
- **Sí:** la fecha del código es `reportDate`, no la de creación de la fila. Es el dato de negocio, y es el que el operador tiene delante cuando busca el caso.
- **No:** usar la fecha de creación para que el código sea monótono. Un caso capturado hoy con fecha de reporte de ayer llevaría la fecha de hoy, y el código diría algo distinto de lo que dice el registro.
- **Sí:** el secuencial reinicia por instalación y fecha. Cuatro dígitos dan 9999 casos por instalación y día, muy por encima de cualquier volumen real.
- **Sí:** `MAX("caseCode")` lexicográfico en vez de parsear el sufijo. Con ancho fijo y ceros a la izquierda el orden alfabético coincide con el numérico, y la consulta se resuelve sin `substring` ni casts.
- **Sí:** la consulta del máximo **no** filtra por `isActive`. Un caso desactivado conserva su código: reutilizarlo violaría `UQ_esaviCase_caseCode`, y además dos casos históricos distintos compartirían identificador.
- **Sí:** inmutable en `004`, incluso al cambiar `healthFacilityId` o `reportDate`. Un identificador que cambia deja de identificar, y cualquier documento impreso con el valor anterior queda huérfano. Es la misma decisión que tomó el SPEC F05.

**Sobre la carrera del secuencial**

- **Sí:** reintento acotado a tres intentos, capturando solo `SequelizeUniqueConstraintError` sobre `caseCode`. El `UNIQUE` de la base es la autoridad; la aplicación se limita a recalcular y volver a intentar.
- **No:** `SELECT ... FOR UPDATE` sobre las filas del día. Bloquea a todos los que reportan en esa instalación mientras dura la transacción, ningún otro servicio del repositorio usa bloqueo explícito, y el patrón se copiaría después a entidades donde no hace falta.
- **No:** ignorar la colisión, como se hizo con `healthSystemCode`. Allí eran 32¹² combinaciones aleatorias y la probabilidad era del orden de 10⁻⁶; aquí la colisión es **sistemática**: dos altas simultáneas leen el mismo máximo siempre.
- **No:** una secuencia de Postgres o un `DEFAULT` en el DDL. `esaviapp.sql` no se toca, y una secuencia global no sabe reiniciar por instalación y fecha.

**Sobre los roles**

- **Sí:** `001` y `004` en **USER**, desviándose de la matriz canónica de §9. Es la misma desviación del SPEC F05 y por la misma razón: quien abre un caso es el personal operativo que acaba de registrar al paciente, y con create en ADMIN el flujo se corta a la mitad.
- **Sí:** `005A` en ADMIN y `005B` en SUPERADMIN. Retirar un caso del registro de vigilancia no es parte del flujo de notificación.

**Sobre el listado**

- **Sí:** dual `GET /` + `GET /admin`, como `patient` y `catalogItem`.
- **No:** listado por FK al estilo `healthFacility`, con `/patient/:id` y `/facility/:id`. Allí la entidad no tiene sentido sin su padre; un caso sí lo tiene, y dos rutas más habrían duplicado servicio, controlador, validador y filas de `ROUTE_RULES` para la misma consulta que un filtro resuelve.
- **Sí:** tres filtros por query, acumulativos con `AND`. `IX_esaviCase_patient` e `IX_esaviCase_reportDate` están puestos justo para esos accesos.
- **Sí:** 200 con `count: 0` cuando el filtro apunta a un UUID inexistente. Filtrar por algo que no existe es una búsqueda vacía, no un recurso ausente, y el frontend no tiene que ramificar por status.
- **Sí:** orden `reportDate DESC` con desempate por `caseCode DESC`. Sin el segundo criterio, los casos del mismo día salen en orden arbitrario y la paginación puede repetir u omitir filas entre páginas.
- **No:** búsqueda por texto sobre `details` o `notificationOrganization`. No existe `Op.iLike` en ningún servicio del repositorio; introducirlo es un cambio transversal.

**Sobre el modelo y las reglas**

- **Sí:** validar `patientId` y `healthFacilityId` existentes **y activos**, en create y en update. `ON DELETE RESTRICT` protege contra el borrado físico, que los triggers ya impiden; no dice nada sobre referenciar una fila desactivada.
- **Sí:** las tres fechas como `DATEONLY`. Con `DATE`, Sequelize arrastra zona horaria y desplaza la fecha un día según el huso — y esa fecha va dentro del `caseCode`.
- **Sí:** `reportDate` opcional en la entrada aunque sea `NOT NULL` en el DDL, resuelta en el servicio. El `DEFAULT current_date` de la base llega demasiado tarde: el código de caso necesita la fecha **antes** del `INSERT`.
- **Sí:** rechazar fechas futuras y `eventDate` posterior a `reportDate`. Un evento reportado antes de ocurrir es un error de captura, y es la única coherencia que los datos admiten sin inventar reglas clínicas.
- **Sí:** comparar las fechas en `004` contra el estado **resultante**, no contra el body. Validar solo lo que llega deja pasar un `eventDate` incoherente con la `reportDate` ya guardada.
- **No:** validar `countryIsoCode` contra un catálogo. No existe la tabla de países en el esquema; se valida la forma y nada más.
- **No:** declarar los inversos `hasMany` en `Patient` y `HealthFacility`. Ninguna operación de este spec los necesita, y declararlos invita a incluirlos en las respuestas de esas dos entidades, que es un cambio de contrato ajeno a este spec.
- **No:** bloquear la desactivación por referencias entrantes. Ninguna de las cinco tablas satélite tiene modelo; consultarlas acoplaría el caso a un dominio que aún no existe. Es la misma decisión del SPEC 09 y del F05.
- **Sí, pero después:** la desactivación en cascada de los satélites. El `ON DELETE CASCADE` del DDL solo actúa en borrados físicos, que `TRG_esaviCase_preventPhysicalDelete` impide, así que hoy desactivar un caso dejaría sus hijos activos y huérfanos. Mientras no haya hijos no hay problema; en cuanto exista el primero, hay que resolverlo. Queda como deuda declarada de este spec en §2 y en §7.
- **No:** corregir `createEsaviCase()` en `esaviapp.sql`, aunque esté rota. El DDL no se toca, y el servicio no la usa.
- **No:** cifrar ningún campo. Ninguna columna de `esaviCase` es un dato personal; los del paciente viven en `patient` y los cifra el SPEC F05.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Desactivar un caso deja sus satélites activos y huérfanos: el `ON DELETE CASCADE` del DDL solo actúa en borrados físicos, que `TRG_esaviCase_preventPhysicalDelete` impide | Hoy es inocuo porque ninguna de las cinco tablas satélite tiene modelo. El spec que introduzca la primera **debe** resolverlo, y hasta entonces la deuda queda declarada en §2 y §6. No se difiere indefinidamente: es la condición de entrada del siguiente spec del dominio |
| La carrera del secuencial no queda cubierta por las pruebas: Jest corre con `--runInBand` y supertest emite peticiones secuenciales, así que dos altas nunca se solapan de verdad | El reintento se verifica por lectura del código y por el 409 tras agotar los tres intentos. Un test de concurrencia real necesitaría un runner paralelo y un esquema de pruebas por worker, que es un cambio de infraestructura de test ajeno a este spec |
| Tres reintentos pueden no bastar bajo una ráfaga sostenida de altas simultáneas en la misma instalación y fecha, y el operador recibe un 409 por un conflicto que no provocó | El volumen real de casos por instalación y día se cuenta por decenas, no por decenas simultáneas. Si el 409 `CASE_001_CODE_EXISTS` aparece en el log, la salida es subir el número de intentos o pasar al bloqueo explícito, en su propio spec |
| `localCode` es nullable en `healthFacility` (`esaviapp.sql:449`), así que instalaciones ya cargadas pueden no tenerlo y bloquear el alta de casos con un 409 que el operador no sabe resolver | El mensaje `esaviCase.facilityLocalCodeMissing` nombra la causa. La solución de fondo —hacer `localCode` obligatorio en `healthFacility`— está fuera de alcance y necesita su propio spec, más una revisión de los datos ya cargados |
| Cambiar el `localCode` de una instalación deja los casos anteriores con un prefijo que ya no corresponde a ningún código vigente | Es la consecuencia de que el `caseCode` sea inmutable, y es la correcta: el código refleja el estado en el momento del reporte. Quien necesite el `localCode` actual lo tiene en el include `healthFacility` de la respuesta |
| `GET /:id` captura `admin` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato |
| Las tres fechas como `DATEONLY` devuelven `string`, no `Date`, y un consumidor que espere ISO completo se rompe | Es la representación correcta de una columna `date`. Queda documentado en §3.7; conviene avisar a los consumidores de la API |
| `createEsaviCase()` (`esaviapp.sql:1379-1396`) omite `healthFacilityId`, que es `NOT NULL`: cualquier llamada falla, y además produciría un caso sin `caseCode` válido | El servicio no la usa y este spec no la corrige. Queda documentada en §1 para que nadie la tome por una vía alternativa de alta |
| Un caso desactivado retiene su `caseCode` para siempre, así que el secuencial del día tiene huecos y no cuenta los casos vigentes | Es deliberado: el código identifica un caso histórico, no una posición en una lista. Cualquier conteo se hace con el `count` del listado, no leyendo el sufijo |

---

## Lo que **no** está en este spec

- Las cinco tablas satélite —`notifier`, `classification`, `notification`, `investigation` y `finalClassification`— y las veintiocho que cuelgan de ellas.
- El borrado lógico en cascada de los satélites al desactivar un caso. Es deuda declarada: la resuelve el spec que introduzca el primer satélite.
- Hacer `localCode` obligatorio en `healthFacility`.
- Corregir `createEsaviCase()` en `esaviapp.sql`, o cualquier otra modificación del DDL.
- Búsqueda por texto sobre `details` o `notificationOrganization`.
- Filtrar o listar casos por geolocalización siguiendo la jerarquía de la instalación.
- Validar `countryIsoCode` contra un catálogo de países.
- Reasignar un caso a otro paciente por fusión de duplicados.
- Regenerar el `caseCode` de un caso existente.
- Un test de concurrencia real sobre el secuencial.
- Exportar casos, generar reportes o cualquier agregación estadística.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
