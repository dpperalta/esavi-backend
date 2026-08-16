# SPEC F19 — Importación masiva de `vaccineWhodrug` desde ficheros WHODrug `.xlsx`

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (`buildDifferentialUpdate` — la rama de actualización lo usa), **SPEC F18 (`vaccineWhodrug` — dependencia dura: aporta modelo, tipos, ruta base y la normalización de `drugCode`; este spec lo enmienda, ver §1)**, SPEC F17 (precedente de forma: aporta `multer`, `fileUpload.middleware.ts` y la estructura de lotes, `dryRun` e informe)
> **Fecha:** 2026-08-14
> **Objetivo:** Cargar el diccionario WHODrug de vacunas en `vaccineWhodrug` subiendo un `.xlsx` a un endpoint administrativo, con inserción de lo nuevo y actualización diferencial de lo existente, previa corrección del esquema para que la clave del fichero sea la clave de la tabla.

---

## 1. Por qué existe este spec

El [SPEC F18](./18-vaccinewhodrug-crud.md) dejó `vaccineWhodrug` con una sola puerta de escritura: el alta administrativa de una fila (`001`). Y a diferencia de `diagnosticTerm`, **no le puso resolución implícita** — una entrada de un diccionario licenciado no se acuña desde un formulario, y esa decisión sigue en pie. La consecuencia es directa: **sin importación, el catálogo no se puebla nunca**, y las dos tablas que lo esperan —`notificationVaccine` e `investigationVaccineAdministered`— se quedarían indefinidamente con la FK en nulo y el texto crudo como único dato.

El F18 ya reservó `ESAVI-WHODRUG-007` para esto y lo dejó escrito en su §3.4. Este spec lo ocupa.

**El fichero real cambió el diseño.** El F18 se escribió sobre el DDL, sin ver el `.xlsx`. Al abrirlo aparecen tres filas como éstas:

| `id` | `drugCode` | `drugName` | `iso3Code` | `maHolders` |
|---|---|---|---|---|
| 25120001 | 00002001001 | Bcg vaccine | | |
| 25120002 | 00002001001 | Bcg vaccine | PRI | Organon |
| 25120003 | 00002001001 | {Vacuna BCG} | ECU | Serum Institut |

**El mismo `drugCode` en tres filas distintas.** No es un error del volcado: es cómo WHODrug modela el diccionario. Un mismo medicamento se alcanza por su presentación en cada país, con su titular de registro, su forma farmacéutica y su concentración. Llegar a la misma vacuna por sus distintos valores de `iso3Code`, `maHolders` o `form` **es el caso de uso**, no una anomalía a deduplicar.

Y eso choca de frente con `CONSTRAINT "UQ_vaccineWhodrug_drugCode" UNIQUE ("drugCode")` (`esaviapp.sql:597`): con el esquema tal cual, la segunda fila del fichero revienta el lote con `SequelizeUniqueConstraintError` y la importación no pasa de la línea 3. La clave natural del fichero es su columna **`id`** —`25120001`, `25120002`, `25120003`, única por fila—, que en la tabla es `externalId`, del que el F18 §3.1 anotó «sin unicidad declarada».

**Por eso este spec toca el esquema antes que el código.** Cuatro cambios sobre `esaviapp.sql:561-599`, detallados en §3.1:

1. `UQ_vaccineWhodrug_drugCode` se sustituye por `UQ_vaccineWhodrug_externalId`.
2. Se añade `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, que la tabla no tenía y la procedencia de la carga necesita.
3. La columna `acts` se renombra a `atcs`. Es una errata del DDL: la cabecera del fichero es `atcs` y los valores son códigos ATC (`J07AN`).
4. Las columnas `abbreviation` e `ingredient` —dos campos del fichero sin destino en el DDL original— ya están añadidas en `esaviapp.sql:573-574`.

**Y por eso enmendó al F18**, que aún no estaba implementado. La enmienda está enumerada punto por punto en §8 y **ya se aplicó sobre aquel documento**: `drugCode` dejó de ser único y perdió su 409, `externalId` pasó a ser la clave, y el recuento de columnas subió de 26 a 28 de datos más `metadata`. §8 se conserva como registro de qué cambió y por qué.

**Lo que ya no hay que construir.** El [SPEC F17](./17-diagnosticterm-bulk-import.md) dejó `multer` instalado y `src/middlewares/fileUpload.middleware.ts` operativo con `memoryStorage`, `MAX_UPLOAD_FILE_SIZE` de 20 MB y `files: 1`. Este spec lo reutiliza —tras generalizarlo, porque hoy está cableado a los mensajes y códigos de `diagnosticTerm`— y hereda su estructura probada: lotes con transacción propia, `dryRun`, informe de proceso y respuesta 200. Lo genuinamente nuevo es **leer un libro de Excel**, para lo que no hay ninguna librería en `package.json`.

**La escala, esta vez, no manda.** El fichero ronda las **3000 filas y 500 KB** — dos órdenes de magnitud por debajo del `llt.asc` de 90 000 líneas del F17. Los lotes de 1000 se conservan igualmente, por coherencia con el importador que ya existe y porque el diccionario crecerá.

---

## 2. Alcance

**Dentro:**

- **Cuatro cambios en `esaviapp.sql`**, sobre el bloque `vaccineWhodrug` (`561-599`): sustituir `UQ_vaccineWhodrug_drugCode` por `UQ_vaccineWhodrug_externalId`, añadir `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, renombrar `acts` a `atcs`, y dar por buenas `abbreviation` e `ingredient`, ya presentes en `573-574`. Es el primer paso del plan y el único que toca el esquema.
- Una operación no canónica, **`ESAVI-WHODRUG-007`** — importación masiva, con ruta propia: `POST /api/whodrug-vaccines/import`, rol **SUPERADMIN**.
- Alta de la fila de `ESAVI-WHODRUG-007` en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Generalización de `src/middlewares/fileUpload.middleware.ts`**: `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })`, y actualización de la única llamada existente —la del `ESAVI-DIAGTERM-007`— para que siga produciendo exactamente los mismos mensajes y códigos que hoy. Sin este cambio, una subida de WHODrug de 25 MB respondería con un mensaje de términos diagnósticos.
- Dependencia nueva: **`exceljs`**, en modo streaming.
- Parser en `src/helpers/whodrugParser.helper.ts`, con su alta en el barrel de helpers. **Función pura, sin acceso a base de datos.**
- **Tabla de alias de las 27 cabeceras** del fichero, con emparejamiento **normalizado** —minúsculas, sin espacios, guiones, guiones bajos ni signos `+`— aplicado sobre los alias declarados. Cinco cabeceras no resuelven por normalización sola y por eso la tabla es explícita.
- Cabeceras **obligatorias**: `id`, `drugCode`, `drugName`, `ingredientTranslations`. Si falta alguna, la operación corta con 400 antes de leer una sola fila de datos.
- Lectura **siempre de la primera hoja** del libro, con la cabecera en la **fila 1** y los datos desde la 2.
- Procesamiento por lotes de 1000 filas, cada lote en su propia transacción.
- **Inserción** de las filas cuyo `externalId` no existe, con `metadata` marcada como importada.
- **Actualización diferencial** de las que ya existen, sobre las 27 columnas que el fichero trae, mediante `buildDifferentialUpdate`.
- Modo `dryRun`: recorre, valida y cuenta sin escribir nada.
- Informe de resultado con `read`, `inserted`, `updated`, `unchanged`, `invalid`, `duplicated`, las cabeceras opcionales ausentes, las desconocidas ignoradas, y las primeras 20 filas rechazadas con su motivo.
- Cinco claves i18n nuevas en el bloque `vaccineWhodrug` de `es`, `en` y `nl`, subiendo el bloque de 16 a 21 claves.
- Una fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **142 a 143** — 142 es el número que deja el F18, aún sin implementar.
- Fixture `tests/fixtures/whodrug-vaccines-sample.xlsx` y bloque de cobertura en `tests/contract/vaccineWhodrug.test.ts`.
- **La enmienda al SPEC F18**, enumerada punto por punto en §8 y **ya aplicada** sobre aquel archivo. La sección se conserva como registro del cambio.

**Fuera de alcance (otros specs):**

- **El CRUD de `vaccineWhodrug`.** Es el [SPEC F18](./18-vaccinewhodrug-crud.md) y es dependencia dura: sin su modelo, sus tipos y su ruta base no hay dónde importar. Este spec añade un endpoint a los siete que aquél declara, no los redefine.
- **La resolución implícita desde una notificación.** No existe, y el F18 razonó por qué no la habrá. Este spec no la introduce por la puerta de atrás: la única entrada masiva es el fichero, y la única entrada unitaria es el `001`.
- **El versionado del diccionario.** No hay tabla de versiones ni histórico de cargas. `dictionaryVersion` se guarda como una clave del `metadata` de cada fila y nada más; una entidad `dictionaryImport` con su auditoría es otro spec.
- **La reversión de una importación.** No hay «deshacer la carga del martes». Quien se equivoca de fichero corrige con otra importación.
- **La jerarquía WHODrug y la codificación ATC como entidades.** `drugRecNo`, `drugRecNoSeq` y `atcs` se guardan como texto plano; no hay tabla que resuelva el árbol de productos ni la clasificación anatómico-terapéutica.
- **La fusión de entradas duplicadas.** Con `externalId` como clave, dos filas del fichero que describan la misma presentación siguen siendo dos filas. Reconciliarlas exige repuntar las dos FK entrantes, y las dos tablas destino no existen todavía.
- **`notificationVaccine` e `investigationVaccineAdministered`.**
- **La importación asíncrona con cola y consulta de progreso.** 3000 filas en 3 lotes caben de sobra en la propia petición.
- **La carga por CSV, JSON o `.asc`.** Un solo formato de entrada por endpoint; el `.asc` posicional es del F17 y su parser no se toca.
- **Libros con varias hojas o con la cabecera fuera de la fila 1.** Se lee la primera hoja y se espera la cabecera en la primera fila. No hay parámetro `sheet`.
- **La reactivación por importación.** Una entrada desactivada con el `005A` sigue inactiva aunque el fichero la traiga; `isActive` no entra en el diff. Es lo contrario de lo que decidió el F17, y a propósito — la razón está en §6.
- **Ampliar los filtros de listado del `002A`/`002B` a `abbreviation`, `ingredient` o `atcs`.** Los cinco filtros que declaró el F18 se quedan como están; añadir más es una enmienda a aquel spec, no a éste.
- **La búsqueda full-text sobre `IX_vaccineWhodrug_name`.** Sigue declarado y sin consumir, como lo dejó el F18.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

**No hay tablas nuevas.** Se escribe sobre `vaccineWhodrug` (`esaviapp.sql:561-599`), cuyo desglose columna a columna está en [SPEC F18 §3.1](./18-vaccinewhodrug-crud.md), que ya recoge las correcciones de §8 de este spec.

**Los cuatro cambios de esquema**, todos dentro del `CREATE TABLE`:

| # | Antes | Después | Por qué |
|---|---|---|---|
| 1 | `CONSTRAINT "UQ_vaccineWhodrug_drugCode" UNIQUE ("drugCode")` (`:597`) | `CONSTRAINT "UQ_vaccineWhodrug_externalId" UNIQUE ("externalId")` | El fichero repite `drugCode` por diseño y solo `id` es único por fila |
| 2 | — | `"metadata" jsonb NOT NULL DEFAULT '{}'::jsonb`, insertada **antes de `"isActive"`** | Misma posición y misma forma que en `diagnosticTerm` (`:551`); la procedencia de la carga necesita dónde vivir |
| 3 | `"acts" varchar(250)` (`:570`) | `"atcs" varchar(250)` | Errata del DDL: la cabecera del fichero es `atcs` y los valores son códigos ATC (`J07AN`) |
| 4 | — | `"abbreviation" varchar(250)`, `"ingredient" text` | Ya presentes en `:573-574`; se dan por buenas y se documentan |

La tabla queda en **36 columnas**: la PK, **28 de datos**, `metadata` y las 6 transversales.

`externalId` sigue siendo **nullable**, y eso es deliberado: Postgres admite N filas con `NULL` bajo un `UNIQUE`, así que un alta manual por el `001` que no traiga `externalId` nunca colisiona con el espacio de claves del diccionario. El importador, en cambio, lo exige siempre — el fichero lo trae en todas sus filas.

Las tres piezas del DDL que gobiernan esta operación:

- `UQ_vaccineWhodrug_externalId` — el árbitro de la deduplicación, ya con el cambio 1 aplicado.
- `TRG_vaccineWhodrug_setSysDetails` (`esaviapp.sql:1275-1290`) — se dispara **una vez por fila** insertada o actualizada, también dentro de un `bulkCreate`.
- `TRG_vaccineWhodrug_preventPhysicalDelete` (`esaviapp.sql:1365`) — irrelevante aquí: la importación nunca borra.

`IX_vaccineWhodrug_name` no interviene: la importación no busca por `drugName`.

`appDetails` mantiene el comportamiento que el F18 dejó escrito: se escribe siempre como array y se lee con `Array.isArray(drug.appDetails) ? drug.appDetails : []`, porque el `DEFAULT` del DDL es `'{}'` y no `'[]'`.

### 3.2 Modelo Sequelize

`src/models/vaccineWhodrug.model.ts` —el que crea el F18— cambia en dos puntos, ambos derivados de §3.1:

- El atributo `acts` pasa a llamarse **`atcs`**, con el mismo `DataTypes.STRING(250)`.
- Se añade **`metadata`** como `DataTypes.JSONB`, `allowNull: false`, `defaultValue: {}`.

Sin cambios en asociaciones: la entidad sigue sin FK saliente y sin archivo de asociaciones.

`metadata` **no forma parte de `CreateVaccineWhodrugInput`**. No es un campo que el cliente escriba: lo escribe el `007` al insertar y nadie más lo toca, ni siquiera el `004`. Se expone en las respuestas de lectura junto al resto de columnas, como hace `diagnosticTerm`.

### 3.3 Tipos

En `src/types/vaccineWhodrug/vaccineWhodrug.types.ts`, junto a los que crea el F18:

```ts
export interface ImportVaccineWhodrugsInput {
    dictionaryVersion?: string;   // libre, p. ej. 'WHODrug Global 2025 Sep 1'; solo se guarda en metadata
    dryRun?: boolean;             // default false
}

// Las 27 columnas que el fichero trae. `notes` queda fuera: no está en la cabecera.
export type VaccineWhodrugFileValues =
    Omit<CreateVaccineWhodrugInput, 'notes' | 'isActive' | 'externalId' | 'drugCode' | 'drugName'>;

export interface ParsedVaccineWhodrugRow {
    row: number;                  // 1-based sobre la hoja; la fila 1 es la cabecera
    externalId: number;           // de la columna `id`, ya convertida y validada
    drugCode: string;             // solo trim
    drugName: string;             // solo trim
    values: VaccineWhodrugFileValues;
}

export interface RejectedVaccineWhodrugRow {
    row: number;
    reason: 'INVALID_EXTERNAL_ID' | 'EMPTY_DRUG_CODE' | 'EMPTY_DRUG_NAME'
          | 'VALUE_TOO_LONG' | 'DUPLICATE_IN_FILE';
    column?: string;              // solo en VALUE_TOO_LONG: qué columna se pasó
}

export interface VaccineWhodrugImportReport {
    read: number;                 // filas de datos no vacías leídas
    inserted: number;
    updated: number;
    unchanged: number;            // existían y el diff salió vacío
    invalid: number;
    duplicated: number;           // `id` repetido dentro del propio fichero
    dryRun: boolean;
    sheet: string;                // nombre de la hoja leída, para que el informe sea trazable
    missingOptionalHeaders: string[];  // cabeceras opcionales ausentes; su columna entra como null
    unknownHeaders: string[];          // cabeceras del fichero sin destino, ignoradas
    errors: RejectedVaccineWhodrugRow[];  // las 20 primeras, no todas
}
```

`ImportVaccineWhodrugsInput` **no lleva ninguna columna de datos**: vienen todas del fichero. Tampoco lleva `encoding`, a diferencia del F17 — un `.xlsx` es un ZIP con XML dentro y la codificación es asunto del formato, no del cliente. Y **no se declara ningún `Update...Input`**, por §4 de las convenciones.

`RejectedVaccineWhodrugRow` **no guarda la fila cruda**, al contrario que el `raw` del F17. Una fila de 27 columnas recortada a 200 caracteres no dice nada útil, y el número de fila más el motivo llevan a quien revisa directamente a la celda en Excel.

### 3.4 Superficie HTTP

```
POST   /api/whodrug-vaccines/import          ESAVI-WHODRUG-007   SUPERADMIN  (nuevo)
```

Las siete rutas del F18 no cambian. `/import` es una **ruta literal** y se declara **antes** de `GET /:id`, `PUT /:id` y `DELETE /:id`, junto a `/admin` y `/activate/:id`; el método es `POST` y solo colisiona consigo mismo, pero el orden se respeta por coherencia con el resto del archivo.

Petición:

```
POST /api/whodrug-vaccines/import
Content-Type: multipart/form-data

file               (requerido)  el .xlsx, campo de tipo archivo
dictionaryVersion  (opcional)   texto libre, máx 100
dryRun             (opcional)   'true' | 'false', default false
```

Sin parámetro `sheet`: se lee siempre la primera hoja. Sin parámetro `encoding`: un `.xlsx` resuelve la codificación dentro del formato.

**El middleware de subida cambia de firma.** Hoy `uploadSingleFile(fieldName)` produce mensajes y códigos de `diagnosticTerm` cableados (`src/middlewares/fileUpload.middleware.ts:38-52`). Pasa a:

```ts
uploadSingleFile(fieldName: string, options: { i18nPrefix: string; codePrefix: string })
```

- El `007` de `vaccineWhodrug` lo invoca con `{ i18nPrefix: 'vaccineWhodrug', codePrefix: 'WHODRUG_007' }`.
- El `007` de `diagnosticTerm` se actualiza a `{ i18nPrefix: 'diagnosticTerm', codePrefix: 'DIAGTERM_007' }`, que reproduce **exactamente** lo que hoy emite: mismos mensajes, mismos códigos, mismos estados. Su suite de contrato no cambia una línea, y ése es el criterio de que la generalización salió bien.
- `MAX_UPLOAD_FILE_SIZE` se queda en 20 MB para ambas. El `.xlsx` real pesa ~500 KB.

### 3.5 Reglas de negocio por operación

**`ESAVI-WHODRUG-007` — importar.** `importVaccineWhodrugsService(fileBuffer, data, authUser, lang)` en `src/services/vaccineWhodrug.service.ts`. Cinco fases, en este orden:

**Fase 1 — recepción.** El middleware deja el fichero en `req.file` con `memoryStorage`. Sin fichero → 400 `WHODRUG_007_FILE_REQUIRED`, comprobado en el controlador. Fichero que excede el límite → 413 `WHODRUG_007_FILE_TOO_LARGE`, aplicado por multer y traducido en el middleware, no en el servicio.

**Fase 2 — parseo.** `parseWhodrugXlsxFile(buffer)` en `src/helpers/whodrugParser.helper.ts` devuelve `{ sheet, rows, rejected, missingOptionalHeaders, unknownHeaders }`:

1. Abre el libro con `exceljs`. Si el buffer no es un `.xlsx` válido o el libro no tiene ninguna hoja → 400 `WHODRUG_007_FILE_INVALID`.
2. Toma la **primera hoja** y guarda su nombre para el informe. La **fila 1** es la cabecera; los datos empiezan en la 2.
3. Cada cabecera se **normaliza** —minúsculas, sin espacios, `-`, `_` ni `+`— y se busca en el mapa de alias, normalizado igual. Las cinco cabeceras que no resolverían por normalización sola están en el mapa por eso.

| Cabecera del fichero | Columna | |
|---|---|---|
| `id` | `externalId` | **alias** |
| `drugCode` | `drugCode` | |
| `drugRecNo` | `drugRecNo` | |
| `drugRecNo+Seq01` | `drugRecNoSeq` | **alias** |
| `drugName` | `drugName` | |
| `language` | `language` | |
| `medicinalProductID` | `medicinalProductId` | normaliza |
| `atcs` | `atcs` | tras el renombrado de §3.1 |
| `ICD11` | `icd11` | normaliza |
| `ICD11term` | `icd11Term` | normaliza |
| `abbreviation` | `abbreviation` | |
| `ingredient` | `ingredient` | |
| `ingredientTranslations` | `ingredientTranslation` | **alias** |
| `languageCode` | `languageCode` | |
| `iso3Code` | `iso3Code` | |
| `country_medicinalProductID` | `countryMedicinalProductId` | normaliza |
| `maHolders` | `maHolders` | |
| `maHolders_medicinalProductID` | `maHoldersMedicinalProductId` | normaliza |
| `form` | `form` | |
| `formTranslations` | `formTranslations` | |
| `forms_medicinalProductID` | `formMedicinalProductId` | **alias** |
| `strength` | `strength` | |
| `strengths_medicinalProductID` | `strengthMedicinalProductId` | **alias** |
| `noDoses` | `noDose` | **alias** |
| `diluent` | `diluent` | |
| `isGeneric` | `isGeneric` | |
| `isPreferred` | `isPreferred` | |

4. **Cabeceras obligatorias**: `id`, `drugCode`, `drugName`, `ingredientTranslations`. Si falta alguna → 400 `WHODRUG_007_FILE_INVALID`, con la lista de las que faltan, **antes de leer una sola fila de datos**. Una cabecera opcional ausente se anota en `missingOptionalHeaders` y su columna entra como `null` en todas las filas. Una cabecera desconocida se anota en `unknownHeaders` y se ignora.
5. Filas de datos desde la 2. Una fila **totalmente vacía** se descarta: no cuenta como leída ni como inválida.
6. Cada celda de texto se recorta con `.trim()`; si queda vacía, entra como **`null`**, nunca como `''`. Una celda en blanco de Excel es «no hay dato», y guardarla como cadena vacía haría que el diff de una reimportación viera un cambio inexistente.
7. `externalId` sale de `id` convertido a entero. Vacío, no numérico o no entero → rechazo `INVALID_EXTERNAL_ID`.
8. `drugCode` y `drugName`, solo `.trim()` — nunca `toConstantCase` ni `toTitleCase`, por lo que el F18 §6 ya razonó. Vacíos → `EMPTY_DRUG_CODE` / `EMPTY_DRUG_NAME`; el segundo además rompería el `NOT NULL` de la columna.
9. **Booleanos.** `1`, `true`, `TRUE`, `Y` → `true`; `0`, `false`, `N` → `false`; **vacío** → `null` en `isGeneric` y `false` en `isPreferred`, que es `NOT NULL DEFAULT false` y no admite nulo en ninguna capa.
10. Un texto que excede el `varchar` de su columna → rechazo `VALUE_TOO_LONG`, con el nombre de la columna en el informe. Sin este filtro la fila reventaría el lote entero.
11. `externalId` repetido **dentro del propio fichero**: **gana la primera aparición**; las siguientes se rechazan como `DUPLICATE_IN_FILE`.

Una fila rechazada **no aborta nada**: se cuenta y el proceso sigue. Si tras el parseo `rows` está vacío → 400 `WHODRUG_007_FILE_INVALID`. Junto con la cabecera incompleta del punto 4, son los dos únicos casos en que un problema de contenido corta la operación, y ambos cortan antes de escribir.

**Fase 3 — proceso por lotes.** Las filas válidas se recorren en lotes de **1000** — tres lotes para el fichero real. Cada lote abre su propia transacción, hace su trabajo y confirma. Por lote:

1. `findAll` con `where: { externalId: { [Op.in]: idsDelLote } }`, **fila completa y sin `attributes` acotados** —es la precondición de `buildDifferentialUpdate`— y **sin filtrar por `isActive`**.
2. Las filas cuyo `externalId` no aparece en el resultado son **nuevas**: se acumulan y se insertan con un solo `bulkCreate`.
3. Las que sí aparecen pasan por el diff descrito más abajo, una a una.

**Fase 4 — inserción.** Un `bulkCreate` por lote, sin `updateOnDuplicate` y sin `ignoreDuplicates`. Cada fila lleva las 27 columnas del fichero más:

```
{ isActive: true,
  deletedAt: null,
  metadata: { importedFrom: 'WHODRUG', importedAt, dictionaryVersion, autoCreated: false },
  appDetails: [ { createdAt, user, method: 'ESAVI-WHODRUG-007', detail } ] }
```

`notes` no se escribe: el fichero no lo trae y la columna queda en `null`. `dictionaryVersion` se **omite** de `metadata` si no vino en el body, en vez de guardarse como `null`. No hay `reviewStatus`: `vaccineWhodrug` no tiene cola de revisión, porque no tiene resolución implícita que alimente ninguna.

Si el `bulkCreate` lanza `SequelizeUniqueConstraintError` —dos importaciones a la vez—, la transacción del lote revierte y el error se propaga como 500 `WHODRUG_007_IMPORT_FAILED`. **No hay reintento**: la concurrencia aquí es un error de operación, no un escenario normal, y el informe de los lotes ya confirmados dice hasta dónde llegó.

**Fase 5 — informe.** Se devuelve el `VaccineWhodrugImportReport` de §3.3. `errors` se recorta a las **20 primeras** entradas; `invalid` y `duplicated` cuentan el total real, no las 20.

**Modo `dryRun: true`.** Ejecuta las fases 1, 2 y 3 —incluida la lectura de existentes y el cálculo del diff— y **omite toda escritura**. El informe llega con los mismos números que produciría la ejecución real y `dryRun: true`. Ninguna transacción se abre.

#### Contrato de update diferencial

La rama de actualización de la fase 3 escribe sobre filas existentes, así que declara su tabla. `stored` sale de `drug.get({ plain: true })`. Diff con `buildDifferentialUpdate`; si vuelve vacío **no se escribe nada** —ni `updatedAt`, ni `appDetails`, ni evento en `sysDetails`— y la fila cuenta como `unchanged`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `externalId` | **no entra** | es la clave de búsqueda; una fila se encontró *por* él |
| `drugCode` | `row.drugCode` — **siempre** | ya recortado por el parser |
| `drugName` | `row.drugName` — **siempre** | ya recortado por el parser |
| Las 24 restantes del fichero | `row.values.<campo>` — **siempre** | ya recortadas y con `null` en las celdas vacías |
| `notes` | **no entra** | el fichero no lo trae; una nota escrita a mano por el `004` sobrevive a la reimportación |
| `isActive` | **no entra** | el fichero no declara vigencia — ver §6 |
| `deletedAt` | **no entra** | derivado de `isActive`, que no cambia |
| `metadata` | **no entra** | ver más abajo |

Las 26 columnas que entran, nombradas una a una para que no quede ninguna al criterio de quien implemente: `drugCode`, `drugName`, `drugRecNo`, `drugRecNoSeq`, `language`, `medicinalProductId`, `atcs`, `icd11`, `icd11Term`, `abbreviation`, `ingredient`, `ingredientTranslation`, `languageCode`, `iso3Code`, `countryMedicinalProductId`, `maHolders`, `maHoldersMedicinalProductId`, `form`, `formTranslations`, `formMedicinalProductId`, `strength`, `strengthMedicinalProductId`, `noDose`, `diluent`, `isGeneric`, `isPreferred`.

Cuatro puntos que la tabla no dice sola:

- **Las 26 entran siempre, sin `if` de presencia.** No hay body de cliente que preguntar: el fichero es la fuente completa de las 26, y es el helper quien decide si hay `UPDATE`. Una reimportación del mismo fichero deja las 3000 filas en `unchanged` y no escribe una sola vez. Es la diferencia entre este `007` y el `004` del F18, donde sí se compara contra `undefined` porque el cliente manda un `PUT` parcial.
- **Ningún booleano entra bajo `if( row.values.isPreferred )`.** Con 26 campos copiados en cadena, dos de ellos booleanos, ése es el error de copia-pega más probable del spec: descartaría en silencio el `false` y el flag no se podría desmarcar nunca por importación.
- **`isGeneric` admite `null` y `isPreferred` no.** El DDL no le puso `DEFAULT` al primero, así que `null` es un valor distinto de `false` y el helper debe poder proponerlo; el segundo es `NOT NULL` y nunca se propone nulo.
- **`metadata` no se reescribe en la rama de actualización.** Reimportar no debe pisar el `importedAt` de la primera carga ni el `dictionaryVersion` con el que entró la fila. La procedencia original es justo lo que sirve para auditar de dónde salió cada entrada.

La actualización que sí escribe añade su entrada a `appDetails` con `method: 'ESAVI-WHODRUG-007'` y preserva el historial con `[...currentAppDetails, newEntry]`.

**Escrituras que no pasan por el helper**, declaradas una a una: el `bulkCreate` de la fase 4, porque es una inserción. No hay ninguna otra.

**Efectos sobre otras tablas: ninguno.** La importación escribe en `vaccineWhodrug` y nada más. Las dos FK entrantes del F18 no se tocan.

### 3.6 Claves i18n nuevas

Cinco claves nuevas en el bloque `vaccineWhodrug` de `src/data/i18n/es.json`, `en.json` y `nl.json`, que pasa de 16 a 21:

| Clave | Uso |
|---|---|
| `importedSuccess` | 200 del `007` |
| `importedFailed` | 500 del `007` |
| `fileRequired` | 400 cuando no viaja el fichero |
| `fileInvalid` | 400 cuando el libro no es válido, le falta una cabecera obligatoria o no produce ninguna fila válida |
| `fileTooLarge` | 413 cuando excede los 20 MB |

Son las mismas cinco que estrenó `diagnosticTerm` en el F17, con los mismos nombres. La paridad de forma entre los dos importadores es lo que permite generalizar el middleware con un `i18nPrefix`: `getMessage(\`${ i18nPrefix }.fileTooLarge\`, req.lang)` resuelve en ambas entidades porque las dos declaran la clave.

Los nombres siguen `references/CONVENTIONS.md` §13: par `Success`/`Failed` para la operación, y las tres restantes nombran la condición, como ya hacen `notFound` y `alreadyActive`.

`fileInvalid` cubre tres condiciones distintas —libro ilegible, cabecera incompleta, cero filas válidas— con un solo mensaje. El detalle de cuál de las tres fue va en `errors` del `AppError`, que en `NODE_ENV=development` sí llega al cliente; el mensaje traducido se queda genérico, como el resto del repositorio.

**Ninguna clave nueva para los 400 de validación** de `dictionaryVersion` y `dryRun`: los resuelve `validateFields` con su propio mecanismo.

`tests/i18n/messages.test.ts` exige paridad exacta: o las veintiuna están en los tres archivos, o la suite falla.

### 3.7 Forma de la respuesta

Éxito, **200**:

```
{ ok, message, data: {
    read, inserted, updated, unchanged, invalid, duplicated,
    dryRun, sheet,
    missingOptionalHeaders: [ "diluent" ],
    unknownHeaders: [ "comentarios" ],
    errors: [ { row, reason, column? } ]
} }
```

**200 y no 201**, aunque la operación cree filas: no hay un recurso identificable que devolver ni una URL a la que apuntar. Lo que se devuelve es el informe de un proceso, y `data` no contiene ni un solo `vaccineWhodrugId`. Quien quiera ver lo importado usa el `002B` del F18 con `?search=`.

`sheet` va en el informe porque el endpoint no deja elegir hoja: si alguien sube un libro cuya primera pestaña no era la que creía, el nombre en la respuesta es lo que se lo dice.

`missingOptionalHeaders` y `unknownHeaders` son la otra mitad de lo mismo. Un export de WHODrug que renombre una columna no falla —la carga sigue— pero deja esa columna en `null` en 3000 filas, y sin el aviso nadie lo nota hasta que el autocomplete devuelve fichas vacías. Van en la respuesta, no solo en el log.

`errors` trae `column` únicamente en los rechazos `VALUE_TOO_LONG`; en los otros cuatro motivos la columna implicada ya está en el propio motivo.

Los errores salen por `errorHandler` con la forma habitual `{ ok, message, code, errors }`.

---

## 4. Plan de implementación

**Precondición de orden.** Este spec depende del F18, y el F18 depende del **paso 1** de este spec: su modelo y sus tipos se escriben contra el DDL, y el DDL cambia aquí. La secuencia real es:

> paso 1 de este spec → F18 (ya enmendado según §8) implementado entero → pasos 2 a 10 de este spec.

Es la única inversión del orden habitual, y está aquí escrita para que no se descubra a mitad de camino.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Los cuatro cambios de esquema en `esaviapp.sql`**, sobre el bloque `vaccineWhodrug` (`561-599`), exactamente como los describe §3.1: sustituir `UQ_vaccineWhodrug_drugCode` por `UQ_vaccineWhodrug_externalId`, insertar `"metadata" jsonb NOT NULL DEFAULT '{}'::jsonb` antes de `"isActive"`, renombrar `"acts"` a `"atcs"`, y dejar `abbreviation` e `ingredient` como están. **Va antes de implementar el F18.**
   *Verificación:* cargar `esaviapp.sql` en la base de tests levanta sin error; `\d "vaccineWhodrug"` muestra 36 columnas, `atcs` y no `acts`, `metadata` presente, y una sola restricción única, sobre `externalId`; insertar dos filas con el mismo `drugCode` y distinto `externalId` **funciona**, y dos con el mismo `externalId` **falla**.

2. **Registrar la operación no canónica.** Fila `vaccineWhodrug | 007 | importación masiva desde fichero WHODrug .xlsx — SUPERADMIN, POST /import` en la tabla de `references/CONVENTIONS.md` §6, después de la de `notificationEvent`. La norma exige registrar antes de usar, así que va primero de los pasos de código aunque no toque `src/`.
   *Verificación:* la tabla tiene una entrada `007` para `vaccineWhodrug` y ninguna otra entidad se ve afectada.

3. **Generalizar el middleware de subida.** `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })` en `src/middlewares/fileUpload.middleware.ts`, sustituyendo las cadenas cableadas de las líneas 38-52. Actualizar la única llamada existente, la del `ESAVI-DIAGTERM-007`, con `{ i18nPrefix: 'diagnosticTerm', codePrefix: 'DIAGTERM_007' }`.
   *Verificación:* `npm run build` en 0 y **`npm test -- diagnosticTerm` pasa sin tocar una línea de la suite**: mismos mensajes, mismos códigos, mismos estados. Es la prueba de que la generalización no cambió comportamiento.

4. **Dependencia y parser.** `npm i exceljs`. `src/helpers/whodrugParser.helper.ts` con `parseWhodrugXlsxFile(buffer)`, el mapa de alias de las 27 cabeceras y los once puntos de la fase 2 de §3.5, con su alta en `src/helpers/index.ts`. **Función pura, sin acceso a base de datos.** Las cuatro interfaces de §3.3 en `src/types/vaccineWhodrug/vaccineWhodrug.types.ts`.
   *Verificación:* prueba unitaria sobre un libro de tres filas construido en memoria — las tres del §1 salen con `externalId` 25120001/2/3 y el mismo `drugCode`; `forms_medicinalProductID` cae en `formMedicinalProductId` y `atcs` en `atcs`; una hoja sin la columna `ingredientTranslations` produce el corte por cabecera obligatoria; una celda vacía sale `null` y no `''`; `isPreferred` vacío sale `false` e `isGeneric` vacío sale `null`; un `id` repetido produce un `DUPLICATE_IN_FILE`.

5. **Las cinco claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

6. **`ESAVI-WHODRUG-007` — servicio.** `importVaccineWhodrugsService` en `src/services/vaccineWhodrug.service.ts` con las cinco fases de §3.5: lectura de existentes por `externalId` y lote, `bulkCreate` de los nuevos, diff de los existentes con las 26 columnas de `candidates`, transacción por lote y construcción del informe. Incluye la rama `dryRun`.
   *Verificación:* invocado con un libro de 3 filas sobre tabla vacía devuelve `inserted: 3`, y las tres conviven con el mismo `drugCode`; invocado dos veces seguidas con el mismo libro devuelve la segunda vez `inserted: 0, updated: 0, unchanged: 3` y ninguna fila crece en `appDetails`.

7. **`ESAVI-WHODRUG-007` — controlador, validador y ruta.** Controlador que lee `req.file` y los campos de texto del `body`, devuelve 400 `WHODRUG_007_FILE_REQUIRED` si no hay fichero, y sigue el idiom de `catch` de §10. Validador `importVaccineWhodrugsValidator` con `dictionaryVersion` opcional de máx 100 y `dryRun` opcional booleano. Ruta `POST /import` con `tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file', { i18nPrefix: 'vaccineWhodrug', codePrefix: 'WHODRUG_007' }), ...importVaccineWhodrugsValidator, validateFields, importVaccineWhodrugs`, declarada **antes** de las rutas con `:id`. Alta del validador en `src/validators/index.ts`.
   *Verificación:* una petición sin fichero devuelve **400** `WHODRUG_007_FILE_REQUIRED`; un ADMIN recibe **403**; un `.xlsx` de 3 filas devuelve **200** con el informe; `?dryRun=true` deja la tabla intacta; `POST /import` no se interpreta como un `:id`.

8. **Cubrir la ruta en `tests/auth/roles.test.ts`.** Una fila en `ROUTE_RULES` con `minRole: SUPERADMIN` y código `ESAVI-WHODRUG-007`, y subir el total esperado de **142 a 143**.
   *Verificación:* `npm test -- roles` pasa con 143.

9. **Fixture y suite de contrato.** `tests/fixtures/whodrug-vaccines-sample.xlsx` con la cabecera real de 27 columnas y siete filas de datos: las tres de BCG del §1 —mismo `drugCode`, distinto `id`—, una con `id` vacío, una con `drugName` vacío, una con el `id` de la primera repetido, y una con un `drugCode` de más de 250 caracteres. Bloque nuevo en `tests/contract/vaccineWhodrug.test.ts` que sube el fichero con `.attach()` de supertest.
   *Verificación:* el informe devuelve `read: 7, inserted: 3, invalid: 3, duplicated: 1`; la reimportación sale `unchanged: 3`; cambiar `maHolders` en una fila del libro produce `updated: 1`.

10. **Los casos que solo se ven con el fichero real.** Importar el `.xlsx` de ~3000 filas contra una base local, medir el tiempo total de la petición y comprobar que `missingOptionalHeaders` y `unknownHeaders` salen vacíos.
    *Verificación:* la petición termina dentro del timeout por defecto sin ajustes de proxy; `SELECT count(*) FROM "vaccineWhodrug"` coincide con `inserted`; una segunda pasada deja `unchanged` igual a ese número y `updated: 0`. Si el tiempo no cabe, la cola deja de estar fuera de alcance y se especifica aparte — ver §7.

---

## 5. Criterios de aceptación

- [ ] `POST /api/whodrug-vaccines/import` responde **200** con el informe de §3.7, y **403** para ADMIN.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en `ESAVI-WHODRUG-007`.
- [ ] `grep -rn "ESAVI-WHODRUG-007" src/` devuelve exactamente las cinco apariciones y ninguna con letra.
- [ ] El esquema cargado muestra 36 columnas en `vaccineWhodrug`, con `atcs` y sin `acts`, con `metadata`, y con una única restricción única sobre `externalId`.
- [ ] Las tres filas BCG del §1 —mismo `drugCode`, distinto `id`— **se importan las tres**. Es el criterio que justifica todo el cambio de esquema.
- [ ] Dos filas del fichero con el mismo `id`: la primera se importa, la segunda sale en `errors` con `DUPLICATE_IN_FILE`.
- [ ] Un libro sin la columna `ingredientTranslations` devuelve **400** `WHODRUG_007_FILE_INVALID` y **no escribe ninguna fila**, aunque el resto del fichero sea válido.
- [ ] Los cinco alias resuelven: `id`→`externalId`, `drugRecNo+Seq01`→`drugRecNoSeq`, `ingredientTranslations`→`ingredientTranslation`, `forms_medicinalProductID`→`formMedicinalProductId`, `strengths_medicinalProductID`→`strengthMedicinalProductId`, `noDoses`→`noDose`.
- [ ] Una cabecera escrita como `FORMS MEDICINAL PRODUCT ID` resuelve igual que `forms_medicinalProductID`: la normalización tolera caja y separadores.
- [ ] Una cabecera desconocida no rompe la carga y aparece en `unknownHeaders`; una opcional ausente aparece en `missingOptionalHeaders` y su columna queda en `null`.
- [ ] Una celda vacía se guarda como `null`, **no** como `''`.
- [ ] `isPreferred` vacío se guarda como `false`; `isGeneric` vacío se guarda como `null`; un `1` en cualquiera de las dos se guarda como `true`.
- [ ] `drugCode` se guarda con solo `.trim()`: `00002001001` entra tal cual, sin `toConstantCase`. `drugName` se guarda sin recapitalizar: `Bcg vaccine` y `{Vacuna BCG}` entran con su caja y sus llaves intactas.
- [ ] Toda fila creada lleva `metadata.importedFrom: 'WHODRUG'`, `metadata.importedAt` y `metadata.autoCreated: false`, y `notes` en `null`.
- [ ] Una petición sin fichero devuelve **400**; un fichero de 21 MB devuelve **413**; un libro que no produce ninguna fila válida devuelve **400** `WHODRUG_007_FILE_INVALID`.
- [ ] `errors` trae como mucho 20 entradas aunque `invalid` sea mayor, y `invalid` y `duplicated` cuentan el total real.
- [ ] `dryRun: true` devuelve el mismo informe y deja `SELECT count(*) FROM "vaccineWhodrug"` sin cambios.
- [ ] El fichero real de ~3000 filas se procesa en 3 lotes y termina en una sola petición.
- [ ] Las veintiuna claves existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 143 entradas y `npm test -- roles` pasa.
- [ ] **`npm test -- diagnosticTerm` pasa sin modificar la suite** después de generalizar el middleware: el `ESAVI-DIAGTERM-007` sigue emitiendo `DIAGTERM_007_FILE_TOO_LARGE` con `diagnosticTerm.fileTooLarge` y su 413.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Reimportar el mismo fichero sin cambios responde **200** con `updated: 0` y `unchanged: N`: ninguna fila crece en `appDetails`, ningún `sysDetails.version` avanza y ningún `updatedAt` se mueve. Es el criterio que de verdad discrimina.
- [ ] Un fichero en el que **una** fila cambió `maHolders` produce `updated: 1` y `unchanged: N-1`, y esa fila añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] Un fichero idéntico salvo por un `isPreferred` que pasó de `1` a vacío produce `updated: 1` y deja esa fila con `isPreferred: false`.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/vaccineWhodrug.service.ts` no devuelve resultados.
- [ ] La rama de actualización no reescribe `metadata`: una fila importada con `dictionaryVersion: 'A'` conserva ese valor tras reimportarse con `dictionaryVersion: 'B'`.

**Propios del `007`:**

- [ ] `isActive` **no entra** en `candidates`: una fila desactivada con el `005A` sigue con `isActive: false` y con su `deletedAt` intacto después de reimportar el fichero que la contiene.
- [ ] `notes` **no entra** en `candidates`: una nota escrita con el `004` sobrevive a la reimportación.
- [ ] `externalId` **no entra** en `candidates`, y las otras 26 columnas de datos sí: la lista de §3.5 se corresponde una a una con el bloque del servicio.
- [ ] Un fichero cuya única diferencia es que `isGeneric` pasó de vacío a `0` produce `updated: 1`: `null` y `false` son valores distintos y el `false` no se descarta por falsedad.
- [ ] Una fila cuyo `drugCode` supera los 250 caracteres sale en `errors` con `VALUE_TOO_LONG` y `column: 'drugCode'`, y no revienta el lote.
- [ ] Una fila totalmente vacía en medio de la hoja no cuenta en `read` ni en `invalid`.
- [ ] La importación no consulta ninguna otra tabla: `grep -n "notificationVaccine\|investigationVaccineAdministered" src/services/vaccineWhodrug.service.ts` no devuelve resultados.
- [ ] `sheet` en el informe trae el nombre real de la primera hoja del libro.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** cambiar el esquema antes que escribir el importador, y hacer de `externalId` la clave. El fichero repite `drugCode` por diseño —una vacuna se alcanza por su presentación en cada país— y solo la columna `id` es única por fila. Con `UQ_vaccineWhodrug_drugCode` en pie, la importación no pasa de la tercera línea. Es un cambio de una restricción, y el DDL es un fichero que se carga entero en los tests, así que no hay migración que orquestar.
- **No:** unicidad compuesta sobre `drugCode` más las columnas que distinguen las presentaciones (`iso3Code`, `maHoldersMedicinalProductId`, `formMedicinalProductId`, `strengthMedicinalProductId`). Requeriría saber cuál es la combinación mínima que WHODrug garantiza única, y no lo sabemos; una clave compuesta de cinco columnas nullable además se comporta mal bajo `UNIQUE` en Postgres, porque cualquier `NULL` en el grupo desactiva la comparación. `externalId` es una sola columna y el fichero ya la garantiza.
- **No:** dejar el esquema y deduplicar dentro del importador, quedándose con una fila por `drugCode`. Descartaría exactamente el dato por el que existe el catálogo: la presentación por país y por titular de registro.
- **Sí:** `externalId` **nullable** bajo el `UNIQUE`. Postgres admite N filas con `NULL`, así que un alta manual por el `001` que no traiga `externalId` nunca colisiona con el espacio de claves del diccionario. El importador lo exige; el CRUD no. Es la misma asimetría —API más estricta que el esquema donde importa— que el F18 aplicó a `drugCode`, solo que movida de columna.
- **Sí:** enmendar el F18 en §8 en vez de contradecirlo en silencio, y aplicarlo sobre aquel documento antes de que nadie lo implemente. Corregirlo entonces costó una relectura; corregirlo después habría costado un servicio, un validador, una suite y una clave i18n.
- **Sí:** renombrar `acts` a `atcs` en el DDL. La cabecera del fichero es `atcs` y los valores son códigos ATC (`J07AN`): la columna guarda clasificación anatómico-terapéutica, no «actos». Un alias lo taparía y dejaría el nombre equivocado en el modelo, en los tipos y en toda respuesta HTTP para siempre. **No:** conservar `acts` con alias, por eso.
- **Sí:** añadir `metadata jsonb` al DDL, en la misma posición y con el mismo `DEFAULT` que en `diagnosticTerm`. La procedencia de una carga —de qué versión del diccionario salió cada fila y cuándo entró— es dato de la fila, no de la operación. **No:** guardarla concatenada en `notes`, que es texto libre para el administrador y quedaría pisado. **No:** dejarla solo en `appDetails`, que es un array creciente donde consultar «¿de qué versión es esta fila?» exige recorrerlo.
- **Sí:** `exceljs` en modo streaming. `memoryStorage` ya tiene el buffer completo cargado, y un `.xlsx` es un ZIP que descomprime a bastante más XML del que pesa; leer por streaming acota el pico aunque hoy el fichero sean 500 KB. **No:** `xlsx` (SheetJS), pese a ser la estándar de facto: su paquete de npm arrastra advertencias de auditoría conocidas y el proyecto empuja a instalar desde su propio CDN, cosa que este repositorio no hace en ningún sitio.
- **Sí:** generalizar `uploadSingleFile` con `i18nPrefix` y `codePrefix`. Hoy emite mensajes de `diagnosticTerm` para cualquiera que lo use: la segunda entidad con adjuntos lo destapa, y la tercera lo repetiría. **No:** un segundo middleware para WHODrug, que duplicaría la configuración de multer y el límite de tamaño en dos sitios. **No:** claves genéricas `upload.fileTooLarge`, que perderían el rastro de qué operación falló justo cuando la respuesta se compone en producción sin `errors`.
- **Sí:** mapeo por **nombre de cabecera** con tabla de alias explícita. Un `.xlsx` tiene cabeceras y confiar en el orden de columnas de un Excel es frágil: basta que alguien inserte una columna para desplazar 27. **No:** por posición, como el `.asc` del F17 — aquel formato no tiene cabecera y no daba alternativa.
- **Sí:** normalización —minúsculas, sin espacios, `-`, `_` ni `+`— **encima** de los alias, no en lugar de ellos. Cinco cabeceras no resuelven por normalización sola: `id`, `drugRecNo+Seq01`, `ingredientTranslations`, `forms_medicinalProductID`, `strengths_medicinalProductID` y `noDoses` difieren del nombre de la columna en algo más que la caja. La normalización cubre lo que sí es cosmético, y el fichero ya mezcla tres estilos en la misma fila (`iso3Code`, `country_medicinalProductID`, `ICD11term`).
- **Sí:** cuatro cabeceras obligatorias — `id`, `drugCode`, `drugName` e `ingredientTranslations` —, con corte en 400 antes de leer una fila de datos. Las tres primeras son la clave y las dos columnas `NOT NULL` de hecho; la cuarta es decisión del propietario del dato. **No:** exigir que `ingredientTranslation` tenga valor en cada fila; lo obligatorio es que la columna exista, no que venga rellena.
- **Sí:** una cabecera desconocida se ignora y se anota en `unknownHeaders`, sin cortar. Un export que añada una columna nueva no debe bloquear la carga del diccionario entero. **Sí:** anotarla igualmente en la respuesta, porque una columna ignorada en silencio es una decisión que nadie revisa.
- **Sí:** celda vacía → `null`, nunca `''`. Una celda en blanco de Excel significa «no hay dato». Guardarla como cadena vacía haría que el diff de una reimportación viera un cambio donde no lo hay, y `unchanged` dejaría de ser una señal fiable.
- **Sí:** `isActive` **fuera** del diff, y toda inserción con `isActive: true`. Es lo contrario de lo que decidió el F17, y la asimetría es deliberada: el `llt.asc` de MedDRA trae una columna de vigencia y por tanto **es** la autoridad sobre ella; el `.xlsx` de WHODrug no dice nada de vigencia, así que inferirla del fichero sería inventarla. Con la columna ausente, quien manda es el administrador y su `005A`. **No:** reactivar por importación, que revertiría en silencio una desactivación deliberada.
- **Sí:** `notes` fuera del diff. El fichero no lo trae, y meterlo con `null` borraría en cada carga la nota que un administrador escribió con el `004`.
- **No:** reescribir `metadata` en la rama de actualización. Pisaría el `importedAt` de la primera carga y el `dictionaryVersion` con el que entró la fila, que es justo lo que sirve para auditar de dónde salió cada entrada.
- **Sí:** lotes de 1000 con transacción por lote, aunque el fichero real solo dé tres. La forma es la del F17, ya probada; una transacción única de 3000 filas funcionaría hoy y dejaría de funcionar cuando el diccionario crezca, sin aviso. Por lotes, un fallo deja confirmado lo anterior y el informe dice hasta dónde llegó; reimportar es idempotente, así que reanudar es volver a subirlo.
- **No:** `bulkCreate` con `updateOnDuplicate`. Es una sola instrucción y sería más rápido, pero pisa `appDetails` y `metadata`, escribe aunque nada haya cambiado, y deja el repositorio con un update que no pasa por `buildDifferentialUpdate`. El `SELECT` previo por lote cuesta una consulta y compra las tres cosas.
- **No:** reintentar ante `SequelizeUniqueConstraintError`. Aquí significa dos importaciones simultáneas, que con rol SUPERADMIN es un error de operación y conviene que se vea. Mismo criterio que el F17.
- **Sí:** `dryRun`. Un fichero equivocado escribe miles de filas y no hay deshacer. Comprobar antes cuesta una bandera booleana, y sirve además para medir el tiempo de proceso sin escribir — que es el riesgo abierto de §7.
- **Sí:** recortar `errors` a 20 entradas. **No:** guardar la fila cruda como el `raw` del F17: una fila de 27 columnas recortada no dice nada útil, y el número de fila más el motivo llevan a quien revisa directamente a la celda en Excel.
- **Sí:** 200 en vez de 201. No hay recurso creado que devolver ni `Location` que apuntar: lo que vuelve es el informe de un proceso, y `data` no trae un solo `vaccineWhodrugId`.
- **Sí:** procesar en la propia petición, sin cola. 3000 filas en tres lotes son seis consultas más los `bulkCreate`; es una operación ocasional de un SUPERADMIN, no un endpoint de tráfico.
- **Sí:** leer siempre la primera hoja, sin parámetro `sheet`, y devolver su nombre en el informe. Añadir el parámetro es fácil; lo caro es documentar cuándo usarlo. Devolver el nombre resuelve el único caso real —subir un libro cuya primera pestaña no era la que se creía— sin ampliar la superficie.
- **Sí:** rol SUPERADMIN, igual que el `007` de `diagnosticTerm`. Es la escritura de mayor alcance sobre la entidad, y el F18 ya reservó SUPERADMIN para el `005B`, que mueve una sola fila.
- **No:** parámetro `encoding`. Un `.xlsx` es un ZIP con XML dentro y la codificación es asunto del formato, no del cliente. El F17 lo necesitaba porque el `.asc` es texto plano sin declararla.
- **Sí:** `missingOptionalHeaders` y `unknownHeaders` en la respuesta, no solo en el log. Un export que renombre una columna no falla —la carga sigue— pero deja esa columna en `null` en 3000 filas, y sin el aviso nadie lo nota hasta que el autocomplete devuelve fichas vacías.
- **Sí:** sin `reviewStatus` en `metadata`, al revés que el F17. Aquella clave existe porque `diagnosticTerm` tiene resolución implícita y por tanto una cola de términos autogenerados que revisar. `vaccineWhodrug` no la tiene, y el F18 razonó por qué no la tendrá: no hay nada que encolar.
- **No:** ampliar los filtros del `002A`/`002B` a `abbreviation`, `ingredient` o `atcs` aprovechando que las columnas ya existen. Es una enmienda al F18, no a este spec, y mezclarlas haría que un spec de carga de datos cambiara la superficie de consulta.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El orden invertido se pasa por alto**: alguien implementa el F18 contra el DDL sin corregir y luego hay que rehacer modelo, tipos, validador y servicio | Declarado como precondición al principio de §4 y como enmienda completa en §8. El paso 1 de este spec es lo primero que se ejecuta de los dos specs juntos |
| El F18 se implementa **sin** la enmienda y los dos specs se contradicen en el código | La enmienda ya está aplicada sobre el F18, y §8 conserva el antes y el después punto por punto |
| El cambio de `UNIQUE` se aplica a `esaviapp.sql` pero una base ya creada conserva `UQ_vaccineWhodrug_drugCode` y la importación falla en producción con un error que el código no explica | El esquema no lo gestiona Sequelize y este repositorio no tiene migraciones: el fichero es la fuente y se recarga. Quien tenga una base viva necesita el `ALTER TABLE` a mano, y eso queda fuera de este spec porque no hay mecanismo donde ponerlo |
| **El `id` de WHODrug desborda `integer`.** La columna es `integer` (máx 2 147 483 647) y los del fichero rondan `25 120 001`; un export futuro con ids de diez dígitos rompería la carga entera | El parser rechaza la fila con `INVALID_EXTERNAL_ID` en vez de reventar el lote, así que el fallo es visible y acotado. La salida sería `bigint`, y eso es un cambio de esquema con su propio spec |
| La generalización del middleware rompe el `ESAVI-DIAGTERM-007` en silencio, cambiando un mensaje o un código | El criterio de aceptación es explícito: `npm test -- diagnosticTerm` pasa **sin modificar la suite**. Si algo cambió, la suite del F17 lo dice |
| Un `if( row.values.isPreferred )` descarta el `false` y el flag no se puede desmarcar por importación | Es el error de copia-pega más probable: 26 campos en cadena, dos de ellos booleanos. Cubierto por dos criterios de aceptación propios y por el bloque de contrato |
| Un export futuro renombra una cabecera y 3000 filas quedan con esa columna en `null` sin que nadie lo note | `missingOptionalHeaders` va en la respuesta, no solo en el log, y `dryRun` permite comprobarlo antes de escribir. Es la razón de que ese campo exista |
| **Una fila retirada del diccionario se queda activa para siempre.** El fichero no trae columna de vigencia, así que un export que ya no incluya una entrada no produce ninguna señal: la fila sigue en la tabla y en el autocomplete | Asumido. La alternativa —desactivar todo lo que no venga en el fichero— convertiría cada carga parcial en un borrado masivo, y nada garantiza que el `.xlsx` sea siempre el diccionario completo. Detectar retiradas exige comparar contra una carga anterior identificada, y eso es el versionado del diccionario, que está fuera de alcance |
| Dos cargas del mismo diccionario con `id` distintos duplican el catálogo entero, y ahora `drugCode` ya no lo impide | La clave la fija el proveedor del fichero, no este spec. `dryRun` muestra `inserted: 3000` en vez de `unchanged: 3000`, que es la señal inequívoca de que el fichero no es el que se creía |
| El tiempo de proceso del fichero real supera el timeout del proxy o del cliente | Con 3000 filas es improbable, pero no está medido. El paso 10 del plan lo mide contra el fichero real antes de dar el spec por cerrado, y `dryRun` sirve como medición sin escribir. Si no cabe, la cola deja de estar fuera de alcance y se especifica aparte |
| `exceljs` en streaming no evita que `memoryStorage` ya tenga el fichero entero en memoria | Es cierto y asumido: el streaming acota el pico del **XML descomprimido**, que es el múltiplo grande, no el del buffer. Con 500 KB de fichero ninguno de los dos importa; la decisión se toma pensando en el crecimiento |
| `metadata` se añade al DDL y el `004` del F18 acaba exponiéndola como campo escribible | §3.2 lo declara: `metadata` no forma parte de `CreateVaccineWhodrugInput` y no entra en `candidates`. La escribe el `007` al insertar y nadie más |

---

## 8. Impacto en el contrato HTTP y enmienda al SPEC F18

**Sobre los endpoints existentes: ninguno.** El spec añade `POST /api/whodrug-vaccines/import` y no cambia el comportamiento de ningún cliente actual. La generalización del middleware es explícitamente neutra: el `ESAVI-DIAGTERM-007` sigue emitiendo los mismos mensajes, códigos y estados, y su suite lo verifica sin modificarse.

**Sobre el SPEC F18 sí hubo impacto, y es la razón de esta sección.** La enmienda **ya está aplicada** sobre aquel documento; la tabla se conserva como registro de qué decía antes y qué dice ahora.

| # | En el F18 decía | Dice ahora |
|---|---|---|
| 1 | «26 columnas de datos», tabla de 33 columnas (§1, §2, §3.1) | **28 columnas de datos** más `metadata`; **36 en la tabla** |
| 2 | `drugCode` con unicidad **global**, 409 `WHODRUG_001_CODE_EXISTS` y `WHODRUG_004_CODE_EXISTS` (§2, §3.5, §6) | `drugCode` **sin unicidad**. Sigue **obligatorio como dato** en la API, pero no genera 409. Los dos códigos desaparecen |
| 3 | — | Unicidad sobre **`externalId`**: 409 `WHODRUG_001_EXTERNAL_ID_EXISTS` y `WHODRUG_004_EXTERNAL_ID_EXISTS`, comprobados **solo cuando el body trae `externalId` no nulo**, y en el `004` excluyendo el propio id con `{ [Op.ne]: id }` |
| 4 | Clave i18n `codeExists` (§3.6) | Clave **`externalIdExists`**. El bloque sigue teniendo **16 claves**, que este spec sube a 21 |
| 5 | Tabla de columnas de §3.1 | Añadir `abbreviation varchar(250)`, `ingredient text` y `metadata jsonb NOT NULL DEFAULT '{}'`; renombrar `acts` a **`atcs`**; sustituir `UQ_vaccineWhodrug_drugCode` por `UQ_vaccineWhodrug_externalId`; anotar que `externalId` es nullable **a propósito**, porque bajo un `UNIQUE` de Postgres eso permite altas manuales sin colisión |
| 6 | `CreateVaccineWhodrugInput` con 26 campos y `acts` (§3.3) | 28 campos: `acts` pasa a `atcs`, y se añaden `abbreviation?: string \| null` e `ingredient?: string \| null`. `externalId` sigue **opcional**. `metadata` **no entra** en la interfaz |
| 7 | Modelo con `acts` (§3.2) | Modelo con `atcs` y con `metadata` como `DataTypes.JSONB`, `allowNull: false`, `defaultValue: {}` |
| 8 | Tabla de `candidates` de 26 filas, «los 21 restantes» anulables de texto (§3.5) | **28 filas**; los anulables de texto pasan de 21 a **23**, con `abbreviation` e `ingredient` nombrados en la lista |
| 9 | Forma de la respuesta con 33 columnas menos `sysDetails` (§3.7) | 36 menos `sysDetails`: añadir `abbreviation`, `ingredient` y `metadata`, y sustituir `acts` por `atcs` |
| 10 | Criterios que exigen 26 entradas en `candidates` y 409 por `drugCode` duplicado (§5) | 28 entradas; el 409 pasa a ser por `externalId`, y se añade el criterio inverso: **dos filas con el mismo `drugCode` y distinto `externalId` conviven** |
| 11 | Decisión «`.trim()` + `.toUpperCase()` descartada» y riesgo de `abc1` frente a `ABC1` (§6, §7) | Pierden objeto: sin unicidad sobre `drugCode` no hay colisión por caja que temer. La normalización sigue siendo **solo `.trim()`**, por la razón original —es un dato citado—, que no cambia |
| 12 | «La importación masiva… es el SPEC F19 y reservará `ESAVI-WHODRUG-007`» (§2, §6, cierre) | El F19 **es este documento** y el código ya está ocupado |

Lo que **no** cambia del F18: las siete operaciones canónicas, sus roles, la ruta base `/api/whodrug-vaccines`, la ausencia de archivo de asociaciones, la ausencia de resolución implícita, la búsqueda con `Op.iLike`, los cinco filtros de listado, el `005C` que no existe, y el total de **142** entradas en `ROUTE_RULES` que deja tras de sí.

---

## Lo que **no** está en este spec

- El CRUD de `vaccineWhodrug`: es el SPEC F18, y es dependencia dura.
- El versionado del diccionario, el histórico de cargas y la detección de entradas retiradas entre versiones.
- La reversión de una importación.
- La jerarquía WHODrug y la codificación ATC como entidades: `atcs`, `drugRecNo` y `drugRecNoSeq` se guardan como texto.
- La fusión de entradas duplicadas y el repunte de las dos FK entrantes.
- `notificationVaccine` e `investigationVaccineAdministered`.
- La importación asíncrona con cola y consulta de progreso.
- La carga por CSV, JSON o `.asc`.
- Libros con varias hojas o con la cabecera fuera de la fila 1.
- La reactivación de entradas por importación.
- Ampliar los filtros de listado a `abbreviation`, `ingredient` o `atcs`.
- El `ALTER TABLE` sobre una base ya creada: este repositorio no tiene mecanismo de migraciones.
- Pasar `externalId` de `integer` a `bigint`.
- La búsqueda full-text sobre `IX_vaccineWhodrug_name`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
