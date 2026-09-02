# SPEC F53 — Importación masiva de geografía y establecimientos desde un `.xlsx`

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC 09 (normalización de `healthFacility`), SPEC F12 (`buildDifferentialUpdate`), SPEC F17 (aporta `multer` y `fileUpload.middleware.ts`), SPEC F19 (aporta `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })` y la dependencia `exceljs`), **SPEC F20 (dependencia dura de forma: el patrón de parser `.xlsx`, informe, lotes y `dryRun`)**
> **Fecha:** 2026-09-02
> **Objetivo:** Cargar el árbol geográfico completo y el padrón de establecimientos desde un único `.xlsx` de tres hojas, y generar esa misma plantilla desde el servidor con los catálogos vigentes ya incrustados.

---

## 1. Por qué existe este spec

`geoLocation` y `healthFacility` tienen su CRUD completo, y aun así **no hay forma practicable de cargarlos**. El motivo no es que falte un endpoint: es que las siete operaciones canónicas están diseñadas para corregir una fila, y aquí no hay ninguna fila suelta que corregir. Hay un árbol.

**A — El `001` obliga a conocer dos UUID antes de poder llamarlo.** `createGeoLocationService` recibe `parentGeoLocationId` y `geoLevelTypeId` como UUID (`geoLocation.service.ts:20-32`). Ninguno de los dos existe antes de la carga: el del padre lo devuelve la petición anterior. Cargar la geografía de un país con cuatro niveles administrativos son miles de peticiones **estrictamente encadenadas** —cada una espera el UUID de la que la precede— y ningún formulario razonable las orquesta. Eso es lo que detectó la revisión del frontend, y es lo que este spec resuelve.

**B — `externalCode` es el único identificador transcribible, y la base no lo protege.** El modelo declara `externalCode` con `unique: true` (`geoLocation.model.ts:66`). El DDL **no tiene esa restricción** (`esaviapp.sql:452`): la columna es un `varchar(100)` nulable y nada más. El modelo miente sobre una garantía que no existe. Hoy eso solo produce un 409 que el servicio comprueba a mano (`geoLocation.service.ts:33-41`); a partir de este spec, `externalCode` pasa a ser **la identidad de la fila y el destino de todo `parentCode`**, y una unicidad que no impone la base dejaría el padre de un subárbol sin resolver de forma determinista. Es el único cambio de DDL del spec, y está verificado que hoy no hay duplicados.

**C — Este es el cuarto importador del repositorio y el primero que carga un grafo.** F17 lee MedDRA desde un `.asc`, F19 lee WHODrug desde un `.xlsx` y [F20](20-catalogitem-bulk-import.md) carga `catalogItem`. Los tres importan **listas planas**: cada fila se resuelve sola, y el orden del fichero no significa nada. Aquí cada fila apunta a otra fila del mismo fichero, y de ahí sale todo lo que este spec tiene de nuevo: proceso en orden ascendente de `level` para que el orden de las filas sea irrelevante, rechazo **en cascada** de los descendientes de una fila rechazada, y detección de ciclos. Un importador de grafo que solo copiara el patrón de F20 insertaría huérfanos o reventaría la FK.

**D — Y el primero que además genera el fichero.** La plantilla no es una comodidad: es lo que hace que los códigos de catálogo no se escriban a mano. La hoja de catálogos se genera desde la base viva y alimenta los desplegables de las otras dos, así que el operador **elige** un `level` y un `facilityTypeCode` en vez de adivinarlos. Con `includeExisting=true` el mismo endpoint vuelca lo ya cargado, y el par descargar–editar–subir se convierte en el mantenimiento ordinario de la geografía: apoyado en el update diferencial de [SPEC F12](12-differential.md), reimportar sin cambios no escribe ni una fila.

**E — La derivación del nivel choca con lo que hace hoy el `001`.** Este spec resuelve `geoLevelTypeId` a partir del `level` del fichero, buscando el `geoLevelType` cuyo `sortOrder` coincide. El `001` no hace eso: deriva `level` del padre (`data.level ?? parent.level + 1`, `geoLocation.service.ts:32`) y acepta el `geoLevelTypeId` que le manden, sin comprobar que casen. Pueden existir filas cargadas que violen la invariante que el importador adopta. No es bloqueante —`level` y `geoLevelTypeId` quedan fuera del diff, así que el importador no reescribe ninguna— pero obliga a un motivo de rechazo propio y a que el spec lo diga en voz alta.

**F — `geoLevelType` no está sembrado y su `sortOrder` no es único.** `esaviapp.sql:431-442` declara `sortOrder smallint NOT NULL DEFAULT 0` sin `UNIQUE`, y el DDL no inserta ni una fila —a diferencia de `healthFacilityType`, que sí siembra sus cinco valores en `esaviapp.sql:1696-1700`. En una base recién creada, que es justo el escenario de una primera carga, no hay niveles: la plantilla saldría con el desplegable vacío y todas las filas se rechazarían después de que alguien rellenara el fichero entero. De ahí la verificación previa de §3.5, que corta con 409 en los dos endpoints y dice qué corregir.

Este spec **no** añade el índice único sobre `geoLevelType.sortOrder` que esa invariante sugeriría. Hay duplicados en filas ya desactivadas, así que el índice tendría que ser parcial, y un índice parcial sobre `deletedAt IS NULL` convierte cualquier `ESAVI-GEOTYPE-005B` posterior en un `SequelizeUniqueConstraintError` — un **500** en una reactivación, causado por un índice creado para otra cosa. La verificación previa cubre el mismo riesgo sin ese acoplamiento. El razonamiento completo está en §6.

---

## 2. Alcance

**Dentro:**

- Dos operaciones no canónicas sobre `geoLocation`, con su alta en la tabla de `references/CONVENTIONS.md` §6:
  - **`ESAVI-GEOLOC-006`** — importación masiva. `POST /api/geo-locations/import`, **SUPERADMIN**.
  - **`ESAVI-GEOLOC-007`** — generación de la plantilla. `GET /api/geo-locations/import/template`, **ADMIN**.
- **Un solo cambio en `esaviapp.sql`**: el índice único parcial `UQ_geoLocation_externalCode`.
- **Lector genérico en `src/helpers/xlsxSheetReader.helper.ts`**, con su alta en el barrel. Expone `normalizeHeader(header)` y `readSheet(workbook, { sheet, headerAliases, requiredHeaders })`, que devuelve `{ sheet, rows, missingRequiredHeaders, missingOptionalHeaders, unknownHeaders }`. Cada fila llega como `{ row, cells }` con **cadenas recortadas y `null` en las vacías**: sin normalización de dominio, sin coerción de tipos, sin reglas de negocio. La selección de hoja acepta **nombre normalizado o índice**, que es la única capacidad nueva respecto a lo que hoy hacen los dos parsers existentes.
- **Migración de `whodrugParser.helper.ts` y `catalogItemParser.helper.ts` al lector**, sin cambiar ni una respuesta HTTP de F19 ni de F20. `WhodrugFileError` y `CatalogItemFileError` **se conservan con su nombre**: sus servicios los comprueban con `instanceof` para devolver el 400, y renombrarlas cambiaría el comportamiento de dos specs ya `Implementado`. El lector lanza `XlsxFileError` y cada parser la reenvuelve en la suya.
- Parser en `src/helpers/geoImportParser.helper.ts`, con su alta en el barrel. **Función pura, sin acceso a base de datos.**
- Constructor de la plantilla en `src/helpers/geoTemplateBuilder.helper.ts`, también puro: recibe catálogos y filas ya consultados y devuelve el buffer del libro.
- **Tres hojas emparejadas por nombre normalizado** —minúsculas, sin espacios ni separadores—: `geoLocation`, `healthFacility` y `catalogs`. No se lee por posición.
- **La hoja `catalogs` no se lee nunca.** Se genera para alimentar los desplegables de Excel y el importador la ignora por completo, esté como esté.
- **Carga parcial admitida**: un libro con solo la hoja `geoLocation` es válido. La hoja `healthFacility` ausente no es error; la `catalogs` sobra siempre.
- **Verificación previa de `geoLevelType`**, compartida por los dos endpoints y ejecutada antes de leer o escribir nada: al menos un nivel activo, `sortOrder` sin repetir y serie contigua desde 1. Falla con **409** y el detalle del problema en `message`.
- Resolución de `geoLevelTypeId` a partir del `level` del fichero, por `geoLevelType.sortOrder = level`.
- **Proceso en orden ascendente de `level`**, de modo que el orden de las filas dentro de la hoja es irrelevante.
- **Rechazo en cascada**: los descendientes de una fila rechazada se rechazan con `ORPHAN`, en cualquier profundidad.
- Detección de ciclos dentro del propio fichero.
- Resolución del padre por `externalCode` —primero contra las filas del fichero, después contra la base— y del establecimiento por `localCode`.
- **Inserción** de las filas cuyo identificador no existe, con `bulkCreate` por lotes de 1000, cada lote en su transacción.
- **Actualización diferencial** de las que ya existen, en las dos tablas, mediante `buildDifferentialUpdate`.
- **Prohibición del reparentado y del cambio de nivel**, con los motivos `PARENT_CHANGED` y `LEVEL_CHANGED` visibles en el informe.
- Coerción de `geoLocation.sortOrder` a `0` cuando la celda viene vacía o inválida, con contador.
- Modo `dryRun` (`default: false`): recorre, resuelve y cuenta sin abrir ninguna transacción.
- Parámetro `includeExisting` en el `007`: vuelca en las hojas 1 y 2 las filas **activas** ya cargadas.
- Validación de datos de Excel sobre las columnas de catálogo, con rangos con nombre apuntando a la hoja `catalogs`, y sobre `geoExternalCode` apuntando a la columna `externalCode` de la hoja 1.
- Informe de resultado con contadores por tabla, incluido `inactiveMatched`.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Dos filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **325 a 327**.
- Fixture `tests/fixtures/geo-bulk-sample.xlsx` y bloque de cobertura en `tests/contract/geoLocation.test.ts`.
- **Una desviación declarada del contrato de respuesta de §10**: el `200` del `007` es un binario con `Content-Disposition`, no el sobre `{ ok, message, data }`. Todos sus errores sí salen por `errorHandler` con el sobre habitual. Se registra en `CONVENTIONS.md` §10 como excepción nombrada.

**Fuera de alcance (otros specs):**

- **El CRUD de `geoLocation` y de `healthFacility`.** Las catorce operaciones canónicas ya existen; este spec añade dos endpoints a esa superficie y no redefine ninguno.
- **Crear catálogos al vuelo.** Ni `geoLevelType` ni `catalogItem`. Es la divergencia deliberada respecto a F20, que sí funda `catalogType` desde su importador. Un código que no resuelve rechaza la fila.
- **Mover una geolocalización o un establecimiento de padre.** Un reparentado arrastra un subárbol entero y con él el alcance geográfico de los usuarios ([SPEC F49](49-esavicase-geo-scope.md)). Sigue siendo trabajo del `004`, una fila cada vez y con un humano mirando.
- **Corregir [DEUDA-034](../../TECHNICAL_DEBT.md#deuda-034)** —el `004` de `geoLocation` admite un padre que crea un ciclo—. Este spec cierra esa puerta **solo en el importador**, que no reparenta; la deuda sigue viva en el `004` y se resuelve en su propio spec.
- **Añadir un índice único a `geoLevelType.sortOrder`.** Razonado en §1.F y en §6.
- **La reactivación por importación.** Una fila desactivada con el `005A` sigue inactiva aunque el fichero la traiga: `isActive` no entra en ningún diff. Misma decisión que F19 y F20, y por la misma razón — el fichero no declara vigencia, así que inferirla sería inventarla.
- **Volcar filas inactivas en la plantilla.** `includeExisting` trae solo activas.
- **`geoPolygon`.** No es transcribible en una celda y no tiene columna en el fichero. El importador no lo toca ni al insertar ni al actualizar.
- **La detección de filas retiradas.** Una geolocalización que ya no viene en el fichero se queda como está. No hay «desactivar todo lo que no aparezca», que convertiría cada carga parcial en un borrado masivo.
- **La reversión de una carga y el versionado de importaciones.** No hay «deshacer la carga del martes» ni tabla de histórico.
- **La importación asíncrona con cola y consulta de progreso.**
- **La carga por CSV, JSON o `.asc`.** Un solo formato de entrada por endpoint.
- **Migrar `meddraParser.helper.ts` al lector genérico.** Lee un `.asc` de ancho fijo, no un libro de Excel; no comparte nada con el lector.
- **Normalizar o migrar las filas ya cargadas.** Es un cambio de datos, no de código.
- **El `005C` de purga.** Las dos entidades están en la lista de protegidas de `CONVENTIONS.md` §9.
- **Un endpoint de árbol o de descendientes recursivos.**
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tablas origen

**No hay tablas nuevas.** El DDL cambia en **una sola línea**.

**`geoLocation` — `esaviapp.sql:444-470`.** La tabla principal que se escribe:

| Columna | Tipo | Nulo | Cómo la trata el importador |
|---|---|---|---|
| `geoLocationId` | `uuid` | no | PK `gen_random_uuid()`, lo pone Postgres |
| `geoLevelTypeId` | `uuid` | **no** | **resuelto** por `geoLevelType.sortOrder = level`; nunca viaja en el fichero |
| `parentGeoLocationId` | `uuid` | sí | resuelto por `parentCode`; `null` en `level = 1` |
| `name` | `varchar(200)` | no | del fichero, solo `.trim()` — **sin `toTitleCase`** |
| `officialName` | `varchar(250)` | sí | `.trim()`; celda vacía → `null` |
| `shortName` | `varchar(100)` | sí | ídem |
| `isoCode` | `varchar(20)` | sí | ídem |
| `externalCode` | `varchar(100)` | sí | **identidad de la fila**; solo `.trim()`, obligatorio en el fichero |
| `latitude` / `longitude` | `numeric(10,7)` | sí | del fichero; el helper los compara numéricamente |
| `geoPolygon` | `geometry` | sí | **no se toca nunca** |
| `level` | `smallint` | sí | del fichero; resuelve el tipo y ordena el proceso |
| `sortOrder` | `smallint NOT NULL DEFAULT 0 CHECK (>= 0)` | no | del fichero, con coerción a `0` |
| `isActive`, `deletedAt` | | | `true` / `null` al insertar; fuera del diff |

Las piezas del DDL que gobiernan la operación:

- **`UQ_geoLocation_parent_name UNIQUE ("parentGeoLocationId", "name")`** (`:467`). En Postgres los `NULL` son distintos entre sí, así que **no protege el nivel 1**: dos raíces homónimas con padre nulo son legales para la base. El importador lo compensa resolviendo el nivel 1 solo por `externalCode`.
- **`FK_geoLocation_geoLevelType`** y **`FK_geoLocation_parent`** (`:464-465`), ambas `ON DELETE RESTRICT`: el padre tiene que existir y estar **comprometido** antes del `bulkCreate` de sus hijos. De ahí el proceso por niveles ascendentes con una transacción por lote.
- **`CK_geoLocation_notSelfParent`** (`:466`) cubre el auto-padre directo, no el ciclo `A→B→A`. Ese lo detecta el parser.
- **`TRG_geoLocation_setSysDetails`** existe, aunque no aparezca escrito con ese nombre: lo crea el bucle de `esaviapp.sql:1366-1381` sobre toda tabla con columna `sysDetails`. Se dispara una vez por fila insertada o actualizada, también dentro de un `bulkCreate`.
- **`setSortOrderByParent` no aplica aquí.** El bucle de `esaviapp.sql:1389-1414` lo instala solo en nueve tablas transaccionales, y `geoLocation` no es una de ellas. Es lo que hace segura la coerción a `0`: ningún trigger la reescribe por detrás.
- `TRG_geoLocation_preventPhysicalDelete` (`:1453`, `:1459`) es irrelevante — la importación nunca borra.

**El índice nuevo**, única modificación de `esaviapp.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_geoLocation_externalCode"
  ON "geoLocation" ("externalCode") WHERE "externalCode" IS NOT NULL;
```

Parcial porque la columna es nulable y las filas creadas por el `001` sin código llevan `''` o `null`. Verificado en la base que hoy no hay duplicados.

**`healthFacility` — `esaviapp.sql:472-500`.** La segunda tabla que se escribe:

| Columna | Tipo | Nulo | Cómo la trata el importador |
|---|---|---|---|
| `healthFacilityId` | `uuid` | no | lo pone Postgres |
| `geoLocationId` | `uuid` | sí | **resuelto** por `geoExternalCode` |
| `parentHealthFacilityId` | `uuid` | sí | resuelto por `parentLocalCode`; `null` si la celda viene vacía |
| `facilityTypeItemId` | `uuid` | sí | **resuelto** por `facilityTypeCode` dentro del catálogo `healthFacilityType` |
| `localCode` | `varchar(200)` | sí | **identidad de la fila**; `toConstantCase`, obligatorio en el fichero |
| `name` | `varchar(250)` | no | del fichero, con `toTitleCase` |
| `officialName`, `shortName`, `address` | | sí | `.trim()`; vacío → `null` |
| `latitude` / `longitude` | `numeric(10,7)` | sí | comparación numérica |
| `phone` | `varchar(50)` | sí | `.trim()` |
| `email` | `citext` | sí | `.trim()`; la columna ya es insensible a la caja |

- **`UQ_healthFacility_localCode UNIQUE ("localCode")`** (`:496`) — unicidad **global**, tal como la fijó [SPEC 09](../../specs/09-healthfacility-crud.md). Es el árbitro de la deduplicación de la hoja 2.
- **`TRG_healthFacility_validateCatalogs`** (`:1384-1386`) ejecuta `validateCatalogItemType(facilityTypeItemId, 'healthFacilityType')`. El importador resuelve el tipo **contra ese mismo catálogo antes de escribir**: si dejara que lo atrapara el trigger, el lote entero reventaría con un 500 en vez de rechazar una fila.
- `FK_healthFacility_geoLocation`, `FK_healthFacility_parent` y `FK_healthFacility_type` (`:492-494`), las tres `ON DELETE RESTRICT`.

Las dos tablas llevan las cuatro columnas transversales: `isActive`, `deletedAt`, `sysDetails` y `appDetails`. **`appDetails` se escribe siempre como array y se lee con `Array.isArray(row.appDetails) ? row.appDetails : []`**, porque el `DEFAULT` del DDL es `'{}'` y no `'[]'`.

**Tablas que se leen y nunca se escriben:** `geoLevelType` (`:431-442`) y `catalogItem` filtrado por su `catalogType.code = 'healthFacilityType'`.

### 3.2 Modelo Sequelize

**Sin cambios en ningún modelo.** `geoLocation.model.ts` y `healthFacility.model.ts` cubren todas las columnas implicadas, y las asociaciones ya están cableadas en `src/models/associations/`.

Un efecto colateral que conviene anotar: `geoLocation.model.ts:66` declara `externalCode` con `unique: true` sobre una columna que hoy no tiene restricción en la base. Con el índice de §3.1 **el modelo deja de mentir**. Nadie tiene que editarlo, pero la afirmación pasa a ser cierta.

Este spec **no** corrige las otras dos divergencias del mismo modelo —`geoLevelTypeId` declarado `allowNull: true` frente al `NOT NULL` del DDL, y `level` declarado `allowNull: false` frente a la columna nulable—. No afectan a la importación: el importador siempre escribe los dos.

### 3.3 Tipos y helpers

**El lector genérico** — `src/helpers/xlsxSheetReader.helper.ts`, con su alta en `src/helpers/index.ts`. **Función pura, sin acceso a base de datos y sin ninguna regla de dominio.**

```ts
export interface RawSheetRow {
    row: number;                              // 1-based sobre la hoja; la 1 es la cabecera
    cells: Record<string, string | null>;     // recortado; celda vacía → null, nunca ''
}

export interface ReadSheetResult {
    sheet: string;
    rows: RawSheetRow[];
    missingRequiredHeaders: string[];
    missingOptionalHeaders: string[];
    unknownHeaders: string[];
}

export interface ReadSheetOptions {
    sheet?: string | number;          // nombre normalizado o índice; default 0
    headerAliases: Record<string, string>;
    requiredHeaders: string[];
}
```

Expone `normalizeHeader(header)` —minúsculas, sin espacios, `-` ni `_`—, `readSheet(workbook, options)` y la clase `XlsxFileError`. Lo que **no** hace: normalizar nombres, acuñar códigos, coercionar números, deduplicar ni validar nada de negocio. Todo eso sigue viviendo en el parser de cada dominio.

`whodrugParser.helper.ts` y `catalogItemParser.helper.ts` pasan a apoyarse en él y conservan `WhodrugFileError` y `CatalogItemFileError` con su nombre actual, reenvolviendo la `XlsxFileError` que el lector lanza. Ninguna respuesta HTTP de F19 ni de F20 cambia.

**Los tipos del importador** — `src/types/geography/geoImport.types.ts`, archivo nuevo, con su alta en `src/types/index.ts`. Van aquí y no en `geoLocation.types.ts` porque describen las dos entidades a la vez:

```ts
export interface ImportGeoDataInput {
    dryRun?: boolean;                 // default false
}

export interface GenerateGeoTemplateInput {
    includeExisting?: boolean;        // default false
}

export interface ParsedGeoLocationRow {
    row: number;
    externalCode: string;
    parentCode: string | null;        // null solo en level 1
    name: string;
    level: number;
    values: {
        officialName: string | null;
        shortName: string | null;
        isoCode: string | null;
        latitude: number | null;
        longitude: number | null;
        sortOrder: number;            // ya coercionado
    };
    sortOrderCoerced: boolean;
}

export interface ParsedHealthFacilityRow {
    row: number;
    localCode: string;                // ya con toConstantCase
    name: string;                     // ya con toTitleCase
    geoExternalCode: string;
    facilityTypeCode: string;
    parentLocalCode: string | null;
    values: {
        officialName: string | null;
        shortName: string | null;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        phone: string | null;
        email: string | null;
    };
}

export type GeoRejectionReason =
    | 'EMPTY_EXTERNAL_CODE' | 'EMPTY_NAME' | 'EMPTY_LEVEL' | 'INVALID_LEVEL'
    | 'MISSING_PARENT_CODE' | 'UNEXPECTED_PARENT_CODE'
    | 'DUPLICATE_IN_FILE' | 'VALUE_TOO_LONG' | 'CYCLE'
    | 'GEO_LEVEL_NOT_FOUND' | 'PARENT_NOT_FOUND' | 'PARENT_INACTIVE'
    | 'PARENT_LEVEL_MISMATCH' | 'SIBLING_NAME_EXISTS'
    | 'PARENT_CHANGED' | 'LEVEL_CHANGED' | 'ORPHAN'
    | 'EMPTY_LOCAL_CODE' | 'EMPTY_FACILITY_TYPE' | 'EMPTY_GEO_CODE'
    | 'GEO_NOT_FOUND' | 'FACILITY_TYPE_NOT_FOUND' | 'LOCATION_CHANGED';

export interface RejectedGeoRow {
    sheet: 'geoLocation' | 'healthFacility';
    row: number;
    reason: GeoRejectionReason;
    column?: string;                  // solo en VALUE_TOO_LONG
}

export interface GeoEntityCounters {
    read: number;
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    duplicated: number;
    inactiveMatched: number;
}

export interface GeoImportReport {
    dryRun: boolean;
    sheets: { geoLocation: string; healthFacility: string | null };
    geoLocation: GeoEntityCounters & { sortOrderCoerced: number };
    healthFacility: GeoEntityCounters;
    missingOptionalHeaders: { geoLocation: string[]; healthFacility: string[] };
    unknownHeaders: { geoLocation: string[]; healthFacility: string[] };
    errors: RejectedGeoRow[];         // 20 por hoja, no todas
}
```

**No se declara ningún `Update...Input`**, por §4 de las convenciones. `ImportGeoDataInput` no lleva `dictionaryVersion`: no hay `metadata` en ninguna de las dos tablas donde guardarlo.

Diez de los motivos de rechazo **no los emite el parser sino el servicio** —`GEO_LEVEL_NOT_FOUND`, `PARENT_NOT_FOUND`, `PARENT_INACTIVE`, `PARENT_LEVEL_MISMATCH`, `SIBLING_NAME_EXISTS`, `PARENT_CHANGED`, `LEVEL_CHANGED`, `ORPHAN`, `GEO_NOT_FOUND`, `FACILITY_TYPE_NOT_FOUND` y `LOCATION_CHANGED`—, porque todos dependen del estado de la base y el parser es puro. `errors` recoge rechazos de los dos orígenes, cada uno con su hoja y su número de fila.

**El constructor de la plantilla** — `src/helpers/geoTemplateBuilder.helper.ts`, también puro: recibe los catálogos y las filas ya consultados y devuelve el `Buffer` del libro. No consulta nada.

**El parser** — `src/helpers/geoImportParser.helper.ts`, puro, apoyado en el lector genérico.

### 3.4 Superficie HTTP

```
POST /api/geo-locations/import                        ESAVI-GEOLOC-006  SUPERADMIN  (nuevo)
GET  /api/geo-locations/import/template               ESAVI-GEOLOC-007  ADMIN       (nuevo)
```

Las seis rutas existentes de `geoLocation` no cambian. **`/import` e `/import/template` son rutas literales y se declaran antes de `GET /:id`**, junto a `/activate/:id`, o Express capturará `import` como un `:id` y el validador de UUID responderá 400.

Petición del `006`:

```
POST /api/geo-locations/import
Content-Type: multipart/form-data

file    (requerido)  el .xlsx, campo de tipo archivo
dryRun  (opcional)   'true' | 'false', default false
```

El middleware se invoca con `uploadSingleFile('file', { i18nPrefix: 'geoLocation', codePrefix: 'GEOLOC_006' })` y **no se modifica**: F19 ya lo dejó parametrizado por entidad. Sin parámetro `sheet` y sin `encoding`.

Petición del `007`:

```
GET /api/geo-locations/import/template?includeExisting=true
```

`includeExisting` es opcional, `'true' | 'false'`, default `false`.

### 3.5 Reglas de negocio por operación

#### Fase 0 — verificación previa, compartida por las dos operaciones

`assertGeoLevelTypesReady(codePrefix, lang)` en `src/services/geoLocation.service.ts`. Se ejecuta **antes de leer el fichero en el `006` y antes de consultar nada en el `007`**:

1. `findAll` sobre `geoLevelType` con `where: { isActive: true }`, ordenado por `sortOrder` ascendente.
2. Ninguno → **409** `GEOLOC_00X_LEVEL_TYPES_MISSING`.
3. Dos o más con el mismo `sortOrder` → **409** `GEOLOC_00X_LEVEL_TYPES_DUPLICATED_ORDER`, con los órdenes repetidos interpolados en el `message`.
4. Los `sortOrder` no forman serie contigua desde 1 → **409** `GEOLOC_00X_LEVEL_TYPES_NOT_CONTIGUOUS`, con el primer hueco interpolado.
5. Devuelve un `Map<number, string>` de `level` → `geoLevelTypeId`, que es lo único que el resto de la operación usa.

**El detalle accionable viaja en `message`, no en `errors`.** `errorHandler` solo pone texto real en `errors` cuando `NODE_ENV=development` (§10), así que en producción el operador vería `'Internal server error'` y no sabría qué corregir. Es la razón de que sean tres claves i18n con interpolación y no una genérica.

`00X` es `006` o `007` según quién invoque: el código de operación nunca se comparte entre dos endpoints.

#### `ESAVI-GEOLOC-007` — generar la plantilla

`generateGeoTemplateService(data, authUser, lang)`. Cuatro fases:

**Fase 0.** La verificación previa. Un 409 aquí impide que nadie rellene un libro que no se va a poder cargar.

**Fase 1 — catálogos.** Los `geoLevelType` activos ya consultados en la fase 0 —`level` es su `sortOrder`, más su `name`— y los `catalogItem` activos cuyo `catalogType.code` es `'healthFacilityType'`, con su `code` y su `name`. Un catálogo de tipos vacío **no es error**: la hoja 2 sale con el desplegable vacío y el hecho es visible. Bloquear una carga de geografía por el catálogo de establecimientos sería un falso positivo.

**Fase 2 — volcado, solo si `includeExisting`.** `findAll` sobre `geoLocation` con `where: { isActive: true }`, ordenado por `level`, `sortOrder` y `name`, incluyendo el padre con `attributes: ['externalCode']`. Y sobre `healthFacility` con `where: { isActive: true }`, incluyendo su `geoLocation` y su padre por el mismo procedimiento. **Solo activas, con independencia del rol**: `canViewInactive` no interviene aquí, porque lo que se decide no es visibilidad sino qué es reimportable, y una fila inactiva que volviera en el fichero se actualizaría sin reactivarse — un efecto que nadie pidió.

**Fase 3 — construcción.** `buildGeoTemplateWorkbook(...)` arma las tres hojas:

- `geoLocation` y `healthFacility` con su fila de cabecera y las filas volcadas, si las hay.
- `catalogs` con dos bloques —`level | name` y `code | name`—, cada uno expuesto como **rango con nombre** (`GeoLevels`, `FacilityTypes`) mediante `workbook.definedNames`.
- Validación de datos: lista sobre `level` contra `GeoLevels`; lista sobre `facilityTypeCode` contra `FacilityTypes`; lista sobre `geoExternalCode` contra la columna `externalCode` de la hoja 1, con rango holgado; entero `>= 0` sobre `sortOrder`.
- **`parentCode` no lleva validación de lista.** El padre nace en la misma hoja mientras se escribe el fichero, así que la única lista posible sería autorreferencial. Su red es el rechazo en cascada del `006`.

**Fase 4 — respuesta.** El `Buffer` sale con `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y `Content-Disposition: attachment; filename="esavi-geo-template-YYYY-MM-DD.xlsx"`. **No hay sobre `{ ok, message, data }`** — es la desviación declarada de §10, y por eso el `007` no tiene clave i18n de éxito. Todos sus errores sí salen por `errorHandler` con el sobre habitual.

#### `ESAVI-GEOLOC-006` — importar

`importGeoDataService(fileBuffer, data, authUser, lang)`. Siete fases.

**Fase 0.** La verificación previa, idéntica.

**Fase 1 — recepción.** El middleware deja el fichero en `req.file` con `memoryStorage`. Sin fichero → **400** `GEOLOC_006_FILE_REQUIRED`, comprobado en el controlador y otra vez en el servicio. Más de 20 MB → **413** `GEOLOC_006_FILE_TOO_LARGE`, aplicado por multer y traducido en el middleware.

**Fase 2 — parseo.** `parseGeoImportFile(buffer)` devuelve las dos secciones y sus rechazos. Función pura:

1. Abre el libro con `exceljs`. Buffer inválido o sin hojas → **400** `GEOLOC_006_FILE_INVALID`.
2. Localiza la hoja `geoLocation` por **nombre normalizado**. Ausente → **400** `GEOLOC_006_FILE_INVALID`.
3. Localiza `healthFacility` por el mismo criterio. **Ausente no es error**: la sección queda vacía y `sheets.healthFacility` sale `null`. La hoja `catalogs` se ignora esté como esté, y no entra en `unknownHeaders`.
4. Cabeceras obligatorias por hoja. Si falta alguna → **400** `GEOLOC_006_FILE_INVALID` con la lista, **antes de leer una sola fila de datos**:

| Hoja | Obligatorias | Opcionales |
|---|---|---|
| `geoLocation` | `externalCode`, `name`, `level`, `parentCode` | `officialName`, `shortName`, `isoCode`, `latitude`, `longitude`, `sortOrder` |
| `healthFacility` | `localCode`, `name`, `geoExternalCode`, `facilityTypeCode` | `officialName`, `shortName`, `address`, `latitude`, `longitude`, `phone`, `email`, `parentLocalCode` |

   `parentCode` es cabecera obligatoria aunque su **celda** sea legítimamente vacía en el nivel 1: lo que no puede faltar es la columna.

   **Una cabecera opcional ausente se anota en `missingOptionalHeaders` y su campo entra en `candidates` como `undefined`**, no como `null`: la hoja no declara nada sobre esa columna y las filas existentes **conservan su valor**. En las filas nuevas entra como `null` —o `0` en `sortOrder`—, que es el único valor posible al insertar. La distinción respecto a una celda vacía está desarrollada en el contrato de update diferencial, más abajo. Una cabecera desconocida se anota en `unknownHeaders` y se ignora.
5. Una fila totalmente vacía se descarta: no cuenta como leída ni como inválida.
6. Cada celda de texto se recorta; vacía entra como `null`, nunca como `''`.
7. **Normalización, distinta por hoja y replicando el `001` de cada entidad.** En `geoLocation`, solo `.trim()`: ni `toTitleCase` en `name` ni `toConstantCase` en `externalCode`, porque `createGeoLocationService` no los aplica (`geoLocation.service.ts:73-80`) y un importador que normalizara crearía filas que el `001` no sabría encontrar. En `healthFacility`, `toConstantCase` en `localCode` y `toTitleCase` en `name`, porque eso es lo que hace su `001` desde SPEC 09 (`healthFacility.service.ts:62,83`).
8. Rechazos de celda: `externalCode` vacío → `EMPTY_EXTERNAL_CODE`; `name` vacío → `EMPTY_NAME`; `level` vacío → `EMPTY_LEVEL`; `level` no entero o menor que 1 → `INVALID_LEVEL`; `level = 1` **con** `parentCode` → `UNEXPECTED_PARENT_CODE`; `level > 1` **sin** `parentCode` → `MISSING_PARENT_CODE`. En la hoja 2: `EMPTY_LOCAL_CODE`, `EMPTY_NAME`, `EMPTY_GEO_CODE`, `EMPTY_FACILITY_TYPE`.
9. **`sortOrder`**: celda vacía, no numérica, no entera, negativa o mayor que 32767 entra como **`0`** y marca `sortOrderCoerced: true`. **No rechaza nunca**, igual que en F20. Aquí es además la divergencia declarada respecto al `001`, que calcularía `max(sortOrder) + 1` entre hermanos (`geoLocation.service.ts:54-64`): dentro de un `bulkCreate` ese cálculo daría el mismo valor a todas las filas nuevas del lote y haría que reimportar el mismo fichero produjera valores distintos.
10. Texto que excede el límite de su columna → `VALUE_TOO_LONG` con el nombre de la columna. Sin este filtro la fila reventaría el lote entero.
11. **Duplicado dentro del fichero**: `externalCode` repetido en la hoja 1, `localCode` repetido en la hoja 2. **Gana la primera aparición**; las siguientes salen `DUPLICATE_IN_FILE`.
12. **Ciclos dentro del fichero**: recorriendo `parentCode` sobre las filas del propio libro. Toda fila de un ciclo sale `CYCLE`. El recorrido lleva conjunto de visitados y tope de saltos, como el de SPEC 09.

Si tras el parseo la sección `geoLocation` no tiene ninguna fila válida **y** la hoja 2 tampoco, → **400** `GEOLOC_006_FILE_INVALID`. Junto con la cabecera incompleta y la hoja 1 ausente, son los tres casos en que el contenido corta la operación, y los tres cortan antes de escribir.

**Fase 3 — resolución del grafo geográfico y rechazo en cascada.** Las filas se agrupan por `level` y se recorren en **orden ascendente**. Por nivel:

1. El `geoLevelTypeId` sale del `Map` de la fase 0. Un `level` que no está en el mapa → `GEO_LEVEL_NOT_FOUND` para todas sus filas.
2. El padre se resuelve primero contra las filas **ya procesadas del fichero** y después contra la base por `externalCode`. **La consulta a la base no filtra por `isActive`**: es una resolución de identidad, no una validación de FK, y el criterio es el mismo que §11 fija para la unicidad.
3. No aparece en ninguno de los dos sitios → `PARENT_NOT_FOUND`.
4. Aparece en la base pero **inactivo, y la fila es nueva** → `PARENT_INACTIVE`. Colgar una geolocalización nueva de un padre desactivado es casi siempre una errata, y el `001` tampoco lo permite (`geoLocation.service.ts:22-26`). Para una fila **existente** la cuestión no se plantea: su padre no se vuelve a resolver.
5. El padre resuelto no está en `level - 1` → `PARENT_LEVEL_MISMATCH`.
6. **Cascada**: toda fila cuyo padre fue rechazado por cualquier motivo —incluidos los de la fase 2— se rechaza con `ORPHAN`, y la cascada se propaga a cualquier profundidad. **Este es el punto que distingue a este importador de los tres anteriores**: sin él, un rechazo en el nivel 2 dejaría insertadas sus parroquias colgando de nada, o reventaría la FK.
7. `SIBLING_NAME_EXISTS` cuando el `name` de la fila ya lo ocupa otro hermano bajo el mismo padre, comprobado contra base y contra el fichero. Es lo que impone `UQ_geoLocation_parent_name`, y sin la comprobación previa el lote entero caería con un `23505`. **No se comprueba en el nivel 1**, donde la restricción no protege nada.

**Fase 4 — geoLocation por lotes.** Dentro de cada nivel, las filas válidas se recorren en lotes de **1000**, cada lote en su transacción. Los niveles se procesan en serie: el nivel N está comprometido antes de que empiece el N+1, que es lo que la FK `RESTRICT` exige.

Por lote: `findAll` sobre `geoLocation` con `where: { externalCode: { [Op.in]: códigosDelLote } }`, **fila completa y sin `attributes` acotados** —precondición de `buildDifferentialUpdate`— y **sin filtrar por `isActive`**. Las que no aparecen son nuevas y se insertan con un solo `bulkCreate`. Las que aparecen pasan por el diff, una a una, y si están inactivas suman a `inactiveMatched`.

**Antes del diff, dos rechazos propios de una fila existente:**

- El `parentCode` del fichero no coincide con el `externalCode` del padre guardado → **`PARENT_CHANGED`**. La fila no se toca.
- El `level` del fichero no coincide con el guardado → **`LEVEL_CHANGED`**. Tampoco.

Mover una geolocalización arrastra un subárbol y con él el alcance geográfico de los usuarios ([SPEC F49](49-esavicase-geo-scope.md)); cambiar el nivel sin cambiar el padre deja el árbol incoherente. Las dos cosas siguen siendo trabajo del `004`, una fila cada vez.

**Fase 5 — healthFacility.** Solo si la hoja existe. La jerarquía de establecimientos **no tiene columna `level`**, así que el orden sale de un recorrido iterativo: en cada pasada se procesan las filas cuyo `parentLocalCode` está vacío o ya resuelto; se repite mientras alguna pasada avance. Lo que quede sin resolver al detenerse el avance son ciclos o huérfanos, y sale `CYCLE` u `ORPHAN` según el caso.

Por fila: `geoExternalCode` resuelto contra `geoLocation` → ausente, `GEO_NOT_FOUND`. `facilityTypeCode` resuelto contra los `catalogItem` **activos** del catálogo `healthFacilityType` → ausente, `FACILITY_TYPE_NOT_FOUND`. La resolución del tipo se hace aquí y no se delega en `TRG_healthFacility_validateCatalogs`, que abortaría el lote con un 500.

Mismos lotes de 1000, misma lectura de existentes por `localCode`, mismo reparto entre `bulkCreate` y diff. Y los dos rechazos análogos a los de la fase 4: `parentLocalCode` distinto del guardado → `PARENT_CHANGED`; `geoExternalCode` distinto del guardado → `LOCATION_CHANGED`, que es un traslado de establecimiento y merece la misma prudencia.

**Fase 6 — informe.** `errors` se recorta a las **20 primeras por hoja**, no 20 en total: un fichero con la hoja 1 rota no puede dejar invisibles los errores de la 2. Todos los contadores cuentan el total real.

**Modo `dryRun: true`.** Ejecuta las fases 0 a 5 —incluidas la resolución del grafo, la cascada y el cálculo del diff— y **omite toda escritura**. Ninguna transacción se abre. Las filas del fichero sirven de registro de «lo que existiría», de modo que un hijo cuyo padre también es nuevo cuenta como `inserted` y no como `PARENT_NOT_FOUND`.

#### Contrato de update diferencial

`stored` sale de `row.get({ plain: true })` — la fila completa. Diff con `buildDifferentialUpdate`; si vuelve vacío **no se escribe nada** —ni `updatedAt`, ni `appDetails`, ni evento en `sysDetails`— y la fila cuenta como `unchanged`.

**`geoLocation`:**

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `externalCode` | **no entra** | es la clave de búsqueda: la fila se encontró *por* él |
| `parentGeoLocationId` | **no entra** | un cambio se rechaza con `PARENT_CHANGED` antes del diff |
| `level` | **no entra** | un cambio se rechaza con `LEVEL_CHANGED` antes del diff |
| `geoLevelTypeId` | **no entra** | derivado de `level`, que es inmutable por esta puerta |
| `name` | `row.name` — **siempre** | columna obligatoria; solo `.trim()` |
| `officialName` | `row.values.officialName` — **siempre que la columna esté en la hoja** | `null` si la celda venía vacía |
| `shortName` | `row.values.shortName` — **siempre que la columna esté en la hoja** | ídem |
| `isoCode` | `row.values.isoCode` — **siempre que la columna esté en la hoja** | ídem |
| `latitude` | `row.values.latitude` — **siempre que la columna esté en la hoja** | el helper compara numéricamente contra la cadena de `pg` |
| `longitude` | `row.values.longitude` — **siempre que la columna esté en la hoja** | ídem |
| `sortOrder` | `row.values.sortOrder` — **siempre que la columna esté en la hoja** | ya coercionado; nunca bajo un `if` de veracidad |
| `geoPolygon` | **no entra** | no viaja en el fichero |
| `isActive`, `deletedAt` | **no entran** | el fichero no declara vigencia |

**`healthFacility`:**

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `localCode` | **no entra** | clave de búsqueda |
| `geoLocationId` | **no entra** | un cambio se rechaza con `LOCATION_CHANGED` |
| `parentHealthFacilityId` | **no entra** | un cambio se rechaza con `PARENT_CHANGED` |
| `facilityTypeItemId` | resuelto del fichero — **siempre** | columna obligatoria. **Sí es editable**: cambiar el tipo de un establecimiento no mueve nada del árbol |
| `name` | `row.name` — **siempre** | columna obligatoria; con `toTitleCase` |
| `officialName`, `shortName`, `address` | **siempre que la columna esté en la hoja** | `null` si la celda venía vacía |
| `latitude`, `longitude` | **siempre que la columna esté en la hoja** | comparación numérica |
| `phone`, `email` | **siempre que la columna esté en la hoja** | `.trim()` |
| `isActive`, `deletedAt` | **no entran** | el fichero no declara vigencia |

Cinco puntos que las tablas no dicen solas:

- **Los campos editables entran sin `if` de presencia de valor.** No hay body de cliente que preguntar: el fichero es la fuente completa **de las columnas que trae**, y es el helper quien decide si hay `UPDATE`. Una reimportación del mismo fichero deja todo en `unchanged` y no escribe una sola vez.
- **Cabecera ausente y celda vacía no son lo mismo.** Una columna que no está en la hoja entra como `undefined` y la fila existente conserva su valor; una celda vacía en una columna presente propone `null`, y eso es un cambio si había valor. Es la distinción de §11 entre «no vino» y «vino vacío», aplicada a nivel de columna. Heredar el criterio de F20 —columna ausente igual a `null`— haría que un libro con solo las cuatro cabeceras obligatorias vaciara cinco columnas de todas las filas existentes, en silencio y sin que ningún contador lo delatara.
- **Sobre las columnas que sí trae, el fichero es la fuente completa.** El estado final es el del fichero, no la unión del fichero con lo que hubiera antes. Es también la razón de que `includeExisting` importe tanto: editar sobre el volcado evita vaciar por omisión lo que nadie quería vaciar.
- **`sortOrder` nunca entra bajo `if( row.values.sortOrder )`.** `0` es falso en JavaScript y es además el valor por defecto de la columna, así que ese `if` haría imposible devolver una geolocalización a la posición `0` por importación.
- **`latitude` y `longitude` se dejan al helper.** Las columnas `DECIMAL` vuelven de `pg` como cadena —`'-0.2299000'` frente al `-0.2299` del fichero—, y un `!==` entre ellas es siempre verdadero. El helper ya compara numéricamente (§11), y `geoLocation.service.ts:262-265` documenta que este mismo error ya ocurrió una vez en el `004`.

La actualización que sí escribe añade su entrada a `appDetails` con `method: 'ESAVI-GEOLOC-006'` y preserva el historial con `[...currentAppDetails, newEntry]`. **Las filas de `healthFacility` también llevan `'ESAVI-GEOLOC-006'`**, aunque sea el código de otra entidad: una carga es un hecho único y debe poder rastrearse como tal, exactamente como F20 escribió `ESAVI-CATITEM-006` en las filas de `catalogType` que fundó.

**Escrituras que no pasan por el helper**, declaradas una a una:

1. El `bulkCreate` de `geoLocation` de la fase 4 — es una inserción.
2. El `bulkCreate` de `healthFacility` de la fase 5 — es una inserción.

No hay ninguna otra. El importador no activa, no desactiva, no reactiva y no mueve nada.

### 3.6 Claves i18n nuevas

Nueve claves en el bloque `geoLocation` de `es.json`, `en.json` y `nl.json`, que pasa de **22 a 31**:

| Clave | Uso |
|---|---|
| `importedSuccess` | 200 del `006` |
| `importedFailed` | 500 del `006` |
| `fileRequired` | 400 cuando no viaja el fichero |
| `fileInvalid` | 400 cuando el libro no es válido, falta la hoja `geoLocation`, falta una cabecera obligatoria o no hay ninguna fila válida |
| `fileTooLarge` | 413 cuando excede los 20 MB |
| `levelTypesMissing` | 409 cuando no hay ningún `geoLevelType` activo |
| `levelTypesDuplicatedOrder` | 409 con `{{orders}}` interpolado |
| `levelTypesNotContiguous` | 409 con `{{expected}}` interpolado |
| `templateFailed` | 500 del `007` |

Los cinco primeros son los mismos nombres que estrenaron `diagnosticTerm`, `vaccineWhodrug` y `catalogItem`. Esa paridad es lo que hace funcionar el `i18nPrefix` del middleware: `getMessage(\`${ i18nPrefix }.fileTooLarge\`, req.lang)` resuelve en las cuatro entidades porque las cuatro declaran la clave.

**El bloque `healthFacility` no crece**: se queda en sus 25 claves. La operación es una sola y su prefijo es `geoLocation`. **No hay clave de éxito para el `007`**: su 200 es binario y no lleva `message`.

### 3.7 Forma de la respuesta

**`006`**, éxito, **200**:

```
{ ok, message, data: {
    dryRun: false,
    sheets: { geoLocation: "geoLocation", healthFacility: "healthFacility" },
    geoLocation:    { read, inserted, updated, unchanged, invalid, duplicated,
                      inactiveMatched, sortOrderCoerced },
    healthFacility: { read, inserted, updated, unchanged, invalid, duplicated,
                      inactiveMatched },
    missingOptionalHeaders: { geoLocation: [ "isoCode" ], healthFacility: [] },
    unknownHeaders:         { geoLocation: [ "observaciones" ], healthFacility: [] },
    errors: [ { sheet, row, reason, column? } ]
} }
```

**200 y no 201**: no hay recurso identificable que devolver ni URL a la que apuntar. `data` no contiene ni un solo `geoLocationId` ni `healthFacilityId`.

Los tres contadores que más importan de este informe, y que no tiene ninguno de los importadores anteriores: **`inactiveMatched`** delata que el fichero está tocando filas desactivadas que no se van a reactivar; **`PARENT_CHANGED` en `errors`** delata que alguien editó una celda que mueve el árbol; y **`ORPHAN`** aparece siempre en bloque, porque un solo rechazo arriba tumba una rama entera — leer `invalid: 340` sin entender que 339 son cascada de un `VALUE_TOO_LONG` en el nivel 2 es el malentendido más probable de este endpoint.

**`007`**, éxito, **200**: el cuerpo es el `.xlsx` binario. `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="esavi-geo-template-2026-09-02.xlsx"`. **Sin sobre.**

Los errores de las dos operaciones salen por `errorHandler` con la forma habitual `{ ok, message, code, errors }`.

---

## 4. Plan de implementación

**Precondición.** Tres cosas que ya están en `main` y de las que este spec depende: la firma `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })` que dejó F19, la dependencia `exceljs@4.4`, y las **325** entradas de `ROUTE_RULES` (`tests/auth/roles.test.ts:751`). Si algo aterriza antes que este spec, el paso 12 hay que recalcularlo.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo. Los pasos 1 a 3 no añaden funcionalidad: registran, corrigen y reunifican antes de ampliar, para que lo que se rompa se rompa con superficie pequeña.

1. **Registrar las dos operaciones y la desviación del contrato.** Filas `geoLocation | 006 | importación masiva de geografía y establecimientos desde .xlsx — SUPERADMIN, POST /import` y `geoLocation | 007 | generación de la plantilla .xlsx con catálogos incrustados — ADMIN, GET /import/template` en la tabla de `references/CONVENTIONS.md` §6. Y un párrafo en §10 que nombre el `007` como la única operación del repositorio cuyo 200 no lleva el sobre `{ ok, message, data }`. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* las dos filas existen en §6, ninguna abreviatura nueva se acuña —`GEOLOC` ya estaba registrada— y §10 nombra la excepción con su código de operación.

2. **El índice único de `externalCode`.** La sentencia de §3.1 en `esaviapp.sql`, junto al resto de índices de `geoLocation` (`:469-470`).
   *Verificación:* `psql` recarga `esaviapp.sql` sobre la base de test sin error; `INSERT` de dos filas con el mismo `externalCode` falla con `23505`; dos filas con `externalCode` nulo se insertan las dos —que es lo que compra el `WHERE ... IS NOT NULL`—; `npm test` sigue en verde.

3. **El lector genérico y la migración de los dos parsers existentes.** `src/helpers/xlsxSheetReader.helper.ts` con `normalizeHeader`, `readSheet` y `XlsxFileError`, y su alta en el barrel. `whodrugParser.helper.ts` y `catalogItemParser.helper.ts` pasan a apoyarse en él, conservando `WhodrugFileError` y `CatalogItemFileError` con su nombre y reenvolviendo la del lector. **Ningún cambio de comportamiento.**
   *Verificación:* `npm test -- vaccineWhodrug` y `npm test -- catalogItem` pasan sin tocar una sola aserción; los mismos fixtures de F19 y F20 producen informes idénticos campo por campo; `grep -n "worksheets\[0\]" src/helpers/` solo aparece dentro del lector.

4. **Los tipos.** `src/types/geography/geoImport.types.ts` con las siete interfaces y el union de §3.3, más su alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0.

5. **Las nueve claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; el bloque `geoLocation` tiene 31 claves en los tres idiomas y `healthFacility` sigue en 25.

6. **El parser.** `src/helpers/geoImportParser.helper.ts` con `parseGeoImportFile(buffer)`, las dos secciones, los alias de cabecera de las dos hojas, los límites por columna y los doce puntos de la fase 2, con su alta en el barrel. **Función pura, sin acceso a base de datos.**
   *Verificación:* prueba unitaria sobre libros construidos en memoria — una hoja `catalogs` presente se ignora y **no** entra en `unknownHeaders`; un libro sin hoja `healthFacility` produce la sección vacía y ningún error; un libro sin hoja `geoLocation` corta; `level = 1` con `parentCode` sale `UNEXPECTED_PARENT_CODE` y `level = 2` sin él sale `MISSING_PARENT_CODE`; `sortOrder` vacío, `-1`, `abc` y `40000` salen todos `0` con `sortOrderCoerced: true`, y un `0` explícito sale `0` con `false`; `A→B→A` dentro del fichero saca las dos filas con `CYCLE`; un `externalCode` repetido conserva la primera aparición.

7. **El constructor de la plantilla.** `src/helpers/geoTemplateBuilder.helper.ts` con `buildGeoTemplateWorkbook(...)`: tres hojas, los dos rangos con nombre y las cuatro validaciones de datos de §3.5. **Puro**: recibe catálogos y filas ya consultados.
   *Verificación:* el buffer generado se reabre con `exceljs` y tiene exactamente tres hojas con los nombres esperados; `workbook.definedNames` contiene `GeoLevels` y `FacilityTypes`; la celda `level` de la fila 2 de la hoja 1 lleva `dataValidation` de tipo lista apuntando a `GeoLevels`; **el libro generado sin filas se vuelve a leer con `parseGeoImportFile` sin producir ningún error de cabecera** — que es la prueba de que el generador y el parser hablan del mismo contrato.

8. **La verificación previa compartida.** `assertGeoLevelTypesReady(codePrefix, lang)` en `src/services/geoLocation.service.ts`, con los cinco puntos de la fase 0.
   *Verificación:* sin ningún `geoLevelType` activo lanza 409 `LEVEL_TYPES_MISSING`; con dos activos en `sortOrder: 2` lanza `LEVEL_TYPES_DUPLICATED_ORDER` y el `message` **nombra el `2`** aun con `NODE_ENV=production`; con `sortOrder` 1, 2 y 4 lanza `LEVEL_TYPES_NOT_CONTIGUOUS` nombrando el 3; con 1, 2, 3 devuelve el `Map` de tres entradas.

9. **`ESAVI-GEOLOC-007` — plantilla completa.** `generateGeoTemplateService` con sus cuatro fases; controlador que responde el binario con sus dos cabeceras y **no** construye el sobre; validador `generateGeoTemplateValidator` con `includeExisting` opcional booleano; ruta `GET /import/template` con `tokenValidation, validateUserRole(ADMIN), ...validator, validateFields, generateGeoTemplate`, declarada **antes** de `GET /:id`.
   *Verificación:* un USER recibe 403 y un ADMIN 200; la respuesta llega con `Content-Disposition: attachment` y se abre en Excel; sin `includeExisting` las hojas 1 y 2 traen solo la cabecera; con `includeExisting=true` traen las filas activas y **ninguna inactiva**; con cero `geoLevelType` activos devuelve **409 con el sobre normal**, que es la prueba de que la desviación afecta solo al camino de éxito.

10. **`ESAVI-GEOLOC-006` — servicio.** `importGeoDataService` con las siete fases de §3.5: resolución del grafo por niveles ascendentes, cascada de `ORPHAN`, lectura de existentes por `externalCode` y por `localCode`, `bulkCreate` de los nuevos, diff de los existentes con las dos tablas de `candidates`, rechazos `PARENT_CHANGED` / `LEVEL_CHANGED` / `LOCATION_CHANGED` antes del diff, transacción por lote, pasada iterativa de establecimientos y construcción del informe. Incluye la rama `dryRun`.
    *Verificación:* un libro de tres niveles encadenados **desordenado a propósito** —las parroquias primero, el país al final— importa los tres niveles completos; rechazar una fila de nivel 2 rechaza sus descendientes de niveles 3 y 4 con `ORPHAN` y **no inserta ninguno**; `SELECT count(*) FROM "geoLocation" WHERE "parentGeoLocationId" IS NULL` no crece por encima de las raíces reales; invocarlo dos veces con el mismo libro deja la segunda vez todo en `unchanged` y ninguna fila crece en `appDetails`.

11. **`ESAVI-GEOLOC-006` — controlador, validador y ruta.** Controlador que lee `req.file` y `dryRun`, devuelve 400 `GEOLOC_006_FILE_REQUIRED` si no hay fichero, y sigue el idiom de `catch` de §10. Validador `importGeoDataValidator` con `dryRun` opcional booleano. Ruta `POST /import` con `tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file', { i18nPrefix: 'geoLocation', codePrefix: 'GEOLOC_006' }), ...importGeoDataValidator, validateFields, importGeoData`, declarada **antes** de las rutas con `:id`.
    *Verificación:* una petición sin fichero devuelve 400; un **ADMIN recibe 403** —y es el contraste con el `007`, que el mismo ADMIN sí puede llamar—; un `.xlsx` válido devuelve 200 con el informe; `dryRun=true` deja `SELECT count(*)` idéntico en las dos tablas; `POST /import` no se interpreta como un `:id`.

12. **Cubrir las dos rutas en `tests/auth/roles.test.ts`.** Dos filas en `ROUTE_RULES` —`006` con `minRole: SUPERADMIN`, `007` con `minRole: ADMIN`— y subir el total esperado de **325 a 327**.
    *Verificación:* `npm test -- roles` pasa con 327.

13. **Fixture y suite de contrato.** `tests/fixtures/geo-bulk-sample.xlsx` con las tres hojas. La hoja `geoLocation` lleva **12 filas**: siete válidas repartidas en cuatro niveles —una de ellas con `sortOrder: "abc"`—, un `externalCode` repetido, una con el `name` por encima de 200 caracteres, un hijo de esa misma fila, una con un `parentCode` que no existe, y un hijo de esa última. La hoja `healthFacility` lleva **4 filas**: dos válidas —la segunda colgando de la primera por `parentLocalCode`, para ejercitar la pasada iterativa—, una con un `facilityTypeCode` inexistente y una con un `geoExternalCode` inexistente. Bloque nuevo en `tests/contract/geoLocation.test.ts` que sube el fichero con `.attach()`.
    *Verificación:* el informe devuelve `geoLocation: { read: 12, inserted: 7, duplicated: 1, invalid: 4, sortOrderCoerced: 1 }` y `healthFacility: { read: 4, inserted: 2, invalid: 2 }` — y **`12 = 7 + 1 + 4`** y **`4 = 2 + 2`**, que es la comprobación de que los contadores cierran; de los cuatro `invalid` de la hoja 1, **dos son `ORPHAN`**; la reimportación sale `unchanged: 7` y `unchanged: 2`; editar el `parentCode` de una fila existente produce `PARENT_CHANGED` y deja `parentGeoLocationId` intacto en la base. **El fixture no puede quedar ignorado por git**: `.gitignore` tiene un `*.xlsx` global ya excepcionado en `!tests/fixtures/*.xlsx` por F19 — comprobar con `git check-ignore -v` que la excepción sigue en pie.

14. **Los casos que solo se ven a escala.** Generar la plantilla con `includeExisting=true` sobre una base con ~2000 geolocalizaciones de cuatro niveles y ~500 establecimientos, editarla y volver a subirla contra una base local. Medir el tiempo de las dos peticiones.
    *Verificación:* las dos terminan dentro del timeout por defecto; la reimportación sin editar nada deja `updated: 0` en las dos tablas y `SELECT max("updatedAt")` no se mueve; el fichero descargado y vuelto a subir sin tocar **no produce ni un solo `PARENT_CHANGED`**, que es la prueba de que el volcado escribe el `parentCode` que el importador espera leer.

El paso 3 es el único que toca código de specs ya `Implementado`, y su red son las suites de F19 y F20; si algo se mueve ahí, se ve antes de escribir una línea de este spec. Y el paso 14 no es un test automatizado sino una comprobación manual con datos reales: el ciclo descargar–editar–subir es la razón de ser del spec y no hay forma honesta de verificarlo con un fixture de doce filas.

---

## 5. Criterios de aceptación

- [ ] `POST /api/geo-locations/import` responde **200** con el informe de §3.7 y **403** para ADMIN. `GET /api/geo-locations/import/template` responde **200** para ADMIN y **403** para USER.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en `ESAVI-GEOLOC-006` y en `ESAVI-GEOLOC-007`.
- [ ] `git diff esaviapp.sql` al cerrar la rama muestra **solo** el `CREATE UNIQUE INDEX "UQ_geoLocation_externalCode"`, y ninguna otra línea.
- [ ] Insertar dos `geoLocation` con el mismo `externalCode` falla con `23505`; insertar dos con `externalCode` nulo no falla.
- [ ] **El orden de las filas dentro de la hoja es irrelevante:** el mismo libro con las filas barajadas produce un informe idéntico campo por campo.
- [ ] Rechazar una fila de nivel 2 rechaza **todos** sus descendientes con `ORPHAN` en cualquier profundidad, y ninguno de ellos se inserta.
- [ ] Un ciclo `A→B→A` dentro del fichero saca las dos filas con `CYCLE` y no inserta ninguna.
- [ ] Un `parentCode` que no está ni en el fichero ni en la base sale `PARENT_NOT_FOUND`; un padre existente pero inactivo sale `PARENT_INACTIVE` **solo si la fila es nueva**.
- [ ] Dos filas del fichero con el mismo `externalCode`: la primera se importa, la segunda sale `DUPLICATE_IN_FILE`.
- [ ] `sortOrder` vacío, `-1`, `abc` y `40000` se guardan todos como `0` y suman a `sortOrderCoerced`; un `0` explícito se guarda como `0` y **no** suma.
- [ ] `geoLocation.name` se guarda con solo `.trim()` y `externalCode` sin normalizar: importar `  Santo Domingo de los Tsáchilas  ` y crearlo por el `ESAVI-GEOLOC-001` producen **la misma fila**. `healthFacility` sí normaliza: `localCode: "  hosp central  "` guarda `HOSP_CENTRAL` y `name: "hospital central"` guarda `Hospital Central`, igual que por el `ESAVI-HFAC-001`.
- [ ] **Ningún catálogo se crea por esta puerta:** `SELECT count(*) FROM "geoLevelType"` y el recuento de `catalogItem` del tipo `healthFacilityType` no cambian tras una importación con códigos inexistentes; esas filas salen `GEO_LEVEL_NOT_FOUND` y `FACILITY_TYPE_NOT_FOUND`.
- [ ] `grep -n "GeoLevelType.create\|CatalogItem.create" src/services/geoLocation.service.ts` no devuelve nada dentro de `importGeoDataService`.
- [ ] Sin ningún `geoLevelType` activo, los **dos** endpoints devuelven **409** antes de leer o generar nada, y el `message` nombra el problema **con `NODE_ENV=production`**.
- [ ] Con dos `geoLevelType` activos en el mismo `sortOrder`, el 409 interpola los órdenes repetidos; con la serie 1, 2, 4, interpola el hueco.
- [ ] Un libro sin la hoja `geoLocation` devuelve **400** `GEOLOC_006_FILE_INVALID` y **no escribe ninguna fila en ninguna de las dos tablas**. Un libro **sin** la hoja `healthFacility` se importa con normalidad y devuelve `sheets.healthFacility: null`.
- [ ] La hoja `catalogs` se ignora por completo: alterarla a mano no cambia el informe y **no aparece en `unknownHeaders`**.
- [ ] `errors` trae como mucho **20 entradas por hoja**, y una hoja 1 con 300 errores no impide ver los de la hoja 2.
- [ ] `dryRun: true` devuelve el mismo informe y deja `SELECT count(*)` sin cambios en `geoLocation` **y** en `healthFacility`.
- [ ] El `007` responde el `.xlsx` binario con `Content-Disposition: attachment`, sin sobre; sus **errores** sí salen con `{ ok, message, code, errors }`.
- [ ] `includeExisting=true` vuelca solo filas activas: una geolocalización desactivada no aparece en la plantilla para ningún rol, ni siquiera SUPERADMIN.
- [ ] El libro generado por el `007` **sin filas** se vuelve a subir al `006` sin producir ningún error de cabecera. Generador y parser hablan del mismo contrato.
- [ ] La plantilla trae `dataValidation` de tipo lista en `level`, `facilityTypeCode` y `geoExternalCode`, y los rangos con nombre `GeoLevels` y `FacilityTypes` existen en `workbook.definedNames`.
- [ ] Las suites de F19 y F20 pasan sin tocar una sola aserción tras la migración al lector genérico, y `grep -rn "worksheets\[0\]" src/helpers/` solo aparece dentro de `xlsxSheetReader.helper.ts`.
- [ ] Las treinta y una claves existen en es, en y nl; `healthFacility` sigue en 25; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 327 entradas y `npm test -- roles` pasa.
- [ ] El fixture está versionado: `git check-ignore -v tests/fixtures/geo-bulk-sample.xlsx` no devuelve nada.
- [ ] Los contadores cierran: `12 = 7 + 1 + 4` en la hoja 1 y `4 = 2 + 2` en la hoja 2 del fixture.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] **Descargar la plantilla con `includeExisting=true` y volver a subirla sin editarla responde 200 con `updated: 0` y `unchanged: N` en las dos tablas**: ninguna fila crece en `appDetails`, ningún `sysDetails.version` avanza y ningún `updatedAt` se mueve. Es el criterio que de verdad discrimina, y el que valida el ciclo completo del spec.
- [ ] Un libro con **solo las cuatro cabeceras obligatorias** no vacía ninguna columna opcional de las filas existentes: `officialName`, `shortName`, `isoCode`, `latitude` y `longitude` conservan su valor, y las filas salen `unchanged`.
- [ ] Un fichero en el que **una** fila cambió el `name` produce `updated: 1` y `unchanged: N-1`; esa fila añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/geoLocation.service.ts` no devuelve resultados.
- [ ] Un `facilityTypeCode` inexistente responde con la fila en `errors` y **no** escribe, aunque el resto de la fila no cambie nada; una fila cuyo `parentCode` cambió sale `PARENT_CHANGED` y su `parentGeoLocationId` queda intacto en la base.
- [ ] Una celda **vacía** en una columna **presente** sí propone `null`: borrar el `officialName` de una fila en el libro descargado produce `updated: 1` y deja la columna en `null`.

Los dos últimos criterios están escritos como par a propósito: uno comprueba que la ausencia de columna **no** escribe, el otro que la celda vacía **sí**. Verificados por separado, es imposible confundir los dos comportamientos en la implementación.

---

## 6. Decisiones tomadas y descartadas

**Sobre la forma del fichero**

- **Sí:** un solo libro con **tres hojas**. Es lo que pidió el planteamiento inicial —un único archivo— sin pagar el precio de mezclar dos entidades en una tabla.
- **No:** una hoja única con todo, discriminando por `level`. Las dos entidades no comparten columnas: `healthFacility` necesita `localCode`, `address`, `phone`, `email` y `facilityTypeCode`, y `geoLocation` necesita `isoCode` y `externalCode`. Una hoja única serían dieciséis columnas donde cada fila deja la mitad vacías, y la identidad de la fila cambiaría según el valor de otra celda.
- **No:** carga por niveles en peticiones separadas —primero el nivel 1, luego el 2, etc.—. Lo único que compra es garantizar que el padre exista antes que el hijo, y eso el servidor lo resuelve solo procesando por `level` ascendente dentro de una única petición. Trasladar ese trabajo al operador son N viajes y N oportunidades de equivocar el orden.
- **Sí:** el orden de las filas dentro de la hoja es irrelevante. Es la consecuencia de la decisión anterior y hay un criterio de aceptación que lo fija.
- **Sí:** admitir un libro con **solo la hoja `geoLocation`**. La geografía se carga una vez y los establecimientos llegan después, en tandas.

**Sobre la identidad y el esquema**

- **Sí:** `externalCode` como identidad de `geoLocation`, con índice único parcial en la base. Es el único identificador de la tabla que un humano transcribe, y todo `parentCode` apunta a él. Sin unicidad impuesta por Postgres, el padre de un subárbol no se resuelve de forma determinista.
- **No:** dejar la unicidad solo en el servicio, como está hoy. `geoLocation.model.ts:66` ya declara `unique: true` sobre una columna que la base no protege; el spec convierte esa afirmación en verdad en vez de añadir otra comprobación que también se pueda saltar.
- **No:** un índice único sobre `geoLevelType.sortOrder`, que es lo que la invariante «`level` = `sortOrder`» pediría. Hay duplicados en filas ya desactivadas, así que tendría que ser parcial sobre `deletedAt IS NULL` — y entonces el primer `ESAVI-GEOTYPE-005B` que reactivara uno de esos niveles duplicados devolvería un **500** por `SequelizeUniqueConstraintError`, en una operación que no tiene nada que ver con este spec. La verificación previa cubre el mismo riesgo sin ese acoplamiento.
- **Sí:** derivar `geoLevelTypeId` del `level` por `geoLevelType.sortOrder`. Deja el fichero en diez columnas y evita que el operador transcriba un código de nivel en cada una de las miles de filas.
- **No:** una columna `geoLevelTypeCode` explícita en el fichero. Era la opción más segura contra un `sortOrder` reordenado, y se descartó a cambio de la verificación previa, que ataca el mismo problema en el único punto donde importa.
- **No:** sembrar `geoLevelType` en `esaviapp.sql` como se siembra `healthFacilityType` (`:1696-1700`). Los niveles administrativos son propios de cada país y el despliegue es multi-país —hay locale `nl`—; sembrar los de uno solo en el DDL es peor que la precondición manual de cargar cuatro o seis filas por el CRUD.

**Sobre lo que el importador puede y no puede hacer**

- **Sí:** el importador **no crea ningún catálogo**. Ni `geoLevelType` ni `catalogItem`. Un código que no resuelve rechaza la fila.
- **No:** crear catálogos al vuelo como hace F20 con `catalogType`. F20 lo hizo porque su fichero traía el `catalogTypeName` con que fundarlos, y aun así tuvo que añadir el contador `catalogTypesCreated` para hacer visible que una errata funda un tipo. Aquí no hay con qué crearlos y, sobre todo, la plantilla ya elimina la necesidad: los códigos válidos vienen en desplegables generados desde la base viva.
- **Sí:** **prohibir el reparentado**, con `PARENT_CHANGED` y `LEVEL_CHANGED` visibles en el informe. Mover una geolocalización arrastra un subárbol y con él el alcance geográfico de los usuarios ([SPEC F49](49-esavicase-geo-scope.md)). Un movimiento así merece un humano mirando, no una celda editada entre tres mil.
- **No:** permitir el reparentado con un contador que lo delatara. Era la alternativa simétrica a lo que hizo F20 con `catalogTypesCreated`, y se descartó porque el daño no es comparable: fundar un catálogo de más es ruido, mover una provincia cambia qué casos ve cada epidemiólogo.
- **Sí:** rechazar `PARENT_INACTIVE` **solo en filas nuevas**. Para una existente el padre ni se vuelve a resolver, así que la pregunta no se plantea.
- **Sí:** resolver el padre contra la base **sin filtrar por `isActive`**. Es una resolución de identidad, no una validación de FK, y es el mismo criterio que §11 fija para la unicidad.
- **Sí:** actualizar las filas que resuelven contra una fila inactiva, **sin reactivarlas**, con el contador `inactiveMatched`. Misma decisión que F19 y F20: el fichero no declara vigencia, así que inferirla sería inventarla.
- **No:** rechazar esas filas. Habría convertido cada desactivación en un agujero permanente del fichero, imposible de corregir por esta puerta.

**Sobre la escritura**

- **Sí:** `sortOrder` vacío entra como **`0`**, con contador. Es lo que hace F20 y lo que la columna declara por defecto.
- **No:** replicar el `max(sortOrder) + 1` que hace el `001` (`geoLocation.service.ts:54-64`). Dentro de un `bulkCreate` ese cálculo daría el mismo valor a todas las filas nuevas del lote, y reimportar el mismo fichero produciría valores distintos cada vez — el fichero dejaría de ser idempotente.
- **Sí:** **cabecera ausente ≠ celda vacía**. Una columna que no está en la hoja entra como `undefined` y conserva lo guardado; una celda vacía en una columna presente propone `null`. Heredar el criterio de F20 —columna ausente igual a `null`— habría hecho que un libro con las cuatro cabeceras obligatorias vaciara cinco columnas de todas las filas existentes, en silencio y sin que ningún contador lo delatara.
- **Sí:** `geoLocation` se escribe **solo con `.trim()`**, sin `toTitleCase` en `name` ni normalización en `externalCode`.
- **No:** aplicar `toTitleCase` como hace el resto del repositorio. `createGeoLocationService` no lo hace (`:73-80`), y un importador que normalizara crearía filas que el `001` no sabría encontrar. Además `externalCode` no es un código acuñado aquí: viene de un padrón externo y alterarlo rompería la correspondencia. `healthFacility` **sí** normaliza, porque su `001` lo hace desde SPEC 09.
- **Sí:** un **único código de operación** para las escrituras en las dos tablas, y `ESAVI-GEOLOC-006` también en el `appDetails` de las filas de `healthFacility`. Es exactamente lo que hizo F20 al escribir `catalogType` desde `ESAVI-CATITEM-006`.
- **No:** registrar un `ESAVI-HFAC-007` propio para la mitad de establecimientos. Dos códigos para una sola transacción harían imposible rastrear una carga como el hecho único que es.
- **Sí:** pasada iterativa para ordenar los establecimientos. No tienen columna `level`, así que su jerarquía se resuelve procesando en cada vuelta lo que ya tiene padre resuelto, hasta que ninguna vuelta avance.

**Sobre la plantilla**

- **Sí:** un endpoint que **genera** el fichero, y no solo uno que lo lee. Es lo que convierte los códigos de catálogo en desplegables y evita que se transcriban a mano.
- **Sí:** `includeExisting`, y desde el primer día. Convierte el par de endpoints en el mantenimiento ordinario de la geografía: descargar, corregir doce filas, subir, y el update diferencial escribe solo esas doce. Sin él, el spec resolvería el alta y dejaría el mantenimiento en el mismo punto muerto de partida.
- **No:** volcar filas inactivas. Volverían en el fichero, se actualizarían sin reactivarse y nadie habría pedido ese efecto.
- **Sí:** la hoja `catalogs` **no se lee nunca**. Es ayuda visual para Excel. Si el importador leyera de ella, el día que alguien pegue una fila a mano esa hoja empezaría a comportarse como autoridad.
- **Sí:** `parentCode` **sin** validación de lista. El padre nace en la misma hoja mientras se escribe el fichero, así que la única lista posible sería autorreferencial y circular. Su red es el rechazo en cascada.
- **Sí:** plantilla **ADMIN**, carga **SUPERADMIN**. ADMIN son perfiles epidemiológicos que sí preparan los datos; cargarlos contra la base es trabajo informático.
- **Sí:** desviar el contrato de respuesta de §10 para el `200` del `007`, y registrarlo como excepción nombrada. Un `.xlsx` no cabe en `data`. Los errores del `007` sí usan el sobre, que es lo que mantiene la desviación acotada a un solo camino.

**Sobre el alcance técnico**

- **Sí:** extraer el lector genérico de `.xlsx` ahora. Es la tercera aparición del patrón, que es el umbral que F20 dejó fijado, y la duplicación verificada son ~90 líneas casi idénticas en `whodrugParser.helper.ts:100-276` y `catalogItemParser.helper.ts:77-251`: `normalizeHeader`, los alias normalizados por `reduce`, `readHeader(getRow(1))`, el barrido con `eachRow` y el cálculo de cabeceras ausentes.
- **No:** migrar `meddraParser.helper.ts`. Lee un `.asc` de ancho fijo y no comparte nada con el lector.
- **No:** cambiar el nombre de `WhodrugFileError` ni de `CatalogItemFileError`. Sus servicios los comprueban con `instanceof` para devolver el 400; renombrarlas cambiaría el comportamiento de dos specs ya `Implementado`.
- **Sí:** `errors` recortado a **20 por hoja** y no a 20 en total. Una hoja 1 rota no puede dejar invisibles los errores de la hoja 2.
- **Sí:** `dryRun` con `default: false`. Cambiar el default del servidor rompería la simetría con los tres importadores existentes; que la primera pasada sea en seco es decisión del frontend.
- **No:** corregir [DEUDA-034](../../TECHNICAL_DEBT.md#deuda-034) —el `004` admite un padre que crea un ciclo—. Este spec cierra esa puerta solo en el importador, que no reparenta. La deuda sigue viva en el `004` y se resuelve en su propio spec.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El `CREATE UNIQUE INDEX` falla al desplegar porque entre la verificación y el despliegue alguien cargó un `externalCode` duplicado por SQL directo | Repetir la consulta de duplicados **en el momento del despliegue**, no solo al escribir el spec. El índice es `IF NOT EXISTS`, pero eso no lo salva de datos que lo violen |
| `invalid: 340` de los que 339 son cascada de un solo `VALUE_TOO_LONG` en el nivel 2, y quien lee el informe busca 340 erratas | `ORPHAN` es un motivo propio y aparece como tal en `errors`; el orden de proceso garantiza que la causa raíz salga **antes** que sus cascadas. `dryRun` como primera pasada lo hace visible sin escribir |
| El operador pega 3.000 filas desde otro Excel y borra las validaciones de datos de las celdas destino | Es el modo de uso más probable y **no se puede evitar**: Excel descarta la validación al pegar valores. Por eso la plantilla no permite relajar ni una sola validación del servidor. Es ergonomía, no una capa de garantía |
| Una plantilla descargada hace un mes trae códigos de catálogo que ya no existen | La fila se rechaza con `GEO_LEVEL_NOT_FOUND` o `FACILITY_TYPE_NOT_FOUND`, que nombran el problema. No hay versionado de plantillas y no se añade: el rechazo con motivo claro es suficiente |
| `includeExisting=true` sobre una base grande genera un fichero pesado y una petición lenta | El paso 14 del plan lo mide con ~2000 geolocalizaciones. No hay paginación: si el volumen real la exige, es otro spec |
| La importación se procesa **síncrona** dentro del timeout HTTP | Lotes de 1000 con transacción por lote. La importación asíncrona con cola y progreso está declarada fuera de alcance; si el volumen la exige, es otro spec |
| La migración del lector genérico rompe F19 o F20 en silencio | Las suites de contrato de `vaccineWhodrug` y `catalogItem` son la red, y el paso 3 va aislado y antes de todo lo nuevo: si algo se mueve, se ve antes de escribir una línea de este spec |
| Dos importaciones simultáneas chocan en el `bulkCreate` | La transacción del lote revierte y el error sube como **500** `GEOLOC_006_IMPORT_FAILED`. **No hay reintento**, igual que en F20. La operación es SUPERADMIN y no se espera concurrencia |
| Una fila cargada por el `001` con un `level` que no casa con el `sortOrder` de su `geoLevelType` conserva esa incoherencia para siempre | El importador nunca reescribe `level` ni `geoLevelTypeId`, así que no la empeora — pero tampoco la corrige. Se arregla por el `004`, una fila cada vez. Queda fuera de alcance de forma consciente |
| Un cliente genérico que asume el sobre `{ ok, ... }` en toda respuesta 200 se rompe con el `007` | Es un endpoint **nuevo**: ningún cliente existente lo consume. La excepción queda registrada en `CONVENTIONS.md` §10 y sus errores sí usan el sobre |
| `GET /:id` captura `import` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato |

---

## 8. Impacto en el contrato HTTP

Este spec **no cambia ninguno de los endpoints existentes**. Las seis rutas de `geoLocation` y las siete de `healthFacility` responden exactamente lo mismo que antes.

Lo que sí cambia es una **norma** del repositorio:

| | Antes | Después |
|---|---|---|
| Sobre de respuesta en éxito | `{ ok, message, data }` en **todos** los endpoints, sin excepción (§10) | Igual, **salvo `ESAVI-GEOLOC-007`**, cuyo 200 es un `.xlsx` binario con `Content-Disposition`. Registrado como excepción nombrada en §10 |
| Unicidad de `geoLocation.externalCode` | comprobada solo en el servicio (`geoLocation.service.ts:33-41`), 409 | igual desde la API — **más** un índice en la base, que cierra la puerta a los duplicados creados por SQL directo |

La segunda fila no altera ninguna respuesta: el `001` y el `004` ya devolvían 409 por esa causa. Lo que cambia es que ahora la garantía existe también para quien no entra por la API.

---

## Lo que **no** está en este spec

- Crear `geoLevelType` o `catalogItem` al vuelo desde el fichero.
- Mover una geolocalización o un establecimiento de padre.
- Reactivar filas por importación, y volcar las inactivas en la plantilla.
- Desactivar lo que no aparece en el fichero.
- `geoPolygon`.
- La reversión de una carga y el versionado de importaciones.
- La importación asíncrona con cola y consulta de progreso.
- La carga por CSV, JSON o `.asc`.
- Migrar `meddraParser.helper.ts` al lector genérico.
- Un índice único sobre `geoLevelType.sortOrder`.
- Sembrar `geoLevelType` en `esaviapp.sql`.
- Corregir [DEUDA-034](../../TECHNICAL_DEBT.md#deuda-034) en el `004` de `geoLocation`.
- Normalizar o migrar las filas ya cargadas.
- El `005C` de purga.
- Un endpoint de árbol o de descendientes recursivos.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
