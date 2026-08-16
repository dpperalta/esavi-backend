# SPEC F20 — Importación masiva de `catalogItem` desde ficheros `.xlsx`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (`buildDifferentialUpdate` — la rama de actualización lo usa), SPEC F17 (aporta `multer` y `fileUpload.middleware.ts`), **SPEC F19 (dependencia dura de forma: aporta `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })` ya generalizado, la dependencia `exceljs` y el precedente de parser de `.xlsx`, informe y lotes)**
> **Fecha:** 2026-08-16
> **Objetivo:** Poblar el catálogo de configuración subiendo un `.xlsx` a un endpoint administrativo, resolviendo el `catalogType` de cada fila por su código y creándolo cuando no exista, con inserción de lo nuevo y actualización diferencial de lo existente.

---

## 1. Por qué existe este spec

`catalogItem` es el catálogo de configuración de la aplicación: los valores que rellenan los desplegables de una notificación, de una investigación y de una ficha de paciente. Hoy la única puerta de escritura es el `ESAVI-CATITEM-001`, **una fila por petición**.

Eso basta para corregir un valor suelto y no basta para nada más. Poner en marcha un país nuevo significa cargar decenas de tipos con cientos de ítems entre todos, y hacerlo por el `001` son cientos de peticiones encadenadas a mano, cada una con su `catalogTypeId` en UUID que hay que averiguar antes. El resultado previsible es que el catálogo acabe cargado por SQL directo contra la base, sin `appDetails`, sin normalización y sin que nadie sepa de dónde salió cada fila.

**Este importador es el tercero del repositorio y el primero que no lee un diccionario.** F17 carga MedDRA desde un `.asc` y F19 carga WHODrug desde un `.xlsx`; los dos importan **dato citado de un diccionario licenciado**, y por eso los dos decidieron **no normalizar**: un término se guarda tal como lo escribió su propietario. Un `catalogItem` es lo contrario — es configuración de esta aplicación, acuñada aquí —, así que el importador **mantiene la normalización del `001`**: `toConstantCase` en el `code` y `toTitleCase` en el `name`, y la unicidad se compara contra el valor ya normalizado. Es la primera divergencia deliberada respecto a los dos precedentes.

**La segunda es la clave.** `UQ_catalogItem_type_code UNIQUE ("catalogTypeId", "code")` (`esaviapp.sql:229`) es **compuesta**: `ACTIVO` es un código legítimo en tres tipos distintos a la vez. El fichero no puede identificar una fila por su `code`, y `catalogTypeId` es un UUID que nadie transcribe a mano en un Excel. De ahí sale el diseño: el fichero trae **`catalogTypeCode` y `catalogTypeName`**, la fila se resuelve por el par `(catalogTypeCode, code)`, y el UUID lo pone el importador.

**Y la tercera es que este importador escribe en dos tablas.** Cuando el `catalogTypeCode` de una fila no existe, el tipo **se crea al vuelo** con el `catalogTypeName` que trae el fichero. Es una decisión tomada a conciencia y en contra de la recomendación inicial de este documento: el fichero trae el nombre, así que hay con qué crearlo, y cortar la carga porque falta un tipo obligaría a un ida y vuelta por el `ESAVI-CATTYPE-001` antes de poder importar nada. Lo que compra en comodidad lo paga en riesgo —una errata en `catalogTypeCode` no falla, funda un tipo nuevo—, y por eso el informe lleva un contador `catalogTypesCreated` que hace visible ese efecto en la respuesta. El razonamiento completo está en §6 y el riesgo en §7.

Ese cruce de tablas obliga además a una precisión que no se ve a simple vista: **cada tabla normaliza su `code` con una regla distinta**. `catalogItem.code` pasa por `toConstantCase` (`catalogItem.service.ts:22`) y `catalogType.code` pasa por **`toCamelCase`** (`catalogType.service.ts:94`). El importador aplica la de cada una; si aplicara una sola, cada carga fundaría un tipo duplicado del que ya existe.

**Lo que ya no hay que construir.** F17 dejó `multer` y `src/middlewares/fileUpload.middleware.ts` con `memoryStorage` y 20 MB de tope; F19 lo generalizó a `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })` precisamente para que la segunda entidad con adjuntos no heredara los mensajes de la primera, e instaló `exceljs`. Este spec es el que cobra esa generalización: la invoca con `{ i18nPrefix: 'catalogItem', codePrefix: 'CATITEM_006' }` y no toca el middleware. Lo genuinamente nuevo es el parser de las siete cabeceras y la resolución del tipo.

**El código es `ESAVI-CATITEM-006`, no `007`.** `catalogItem` no tiene ninguna operación no canónica registrada, así que arranca en `006`. Los dos importadores anteriores ocuparon `007` porque sus entidades ya tenían un `006` — la resolución implícita de `diagnosticTerm` y el hueco reservado de `vaccineWhodrug` —, y copiar el número por analogía dejaría un `006` vacío para siempre.

---

## 2. Alcance

**Dentro:**

- Una operación no canónica, **`ESAVI-CATITEM-006`** — importación masiva, con ruta propia: `POST /api/catalog-items/import`, rol **SUPERADMIN**.
- Alta de la fila de `ESAVI-CATITEM-006` en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- Parser en `src/helpers/catalogItemParser.helper.ts`, con su alta en el barrel de helpers. **Función pura, sin acceso a base de datos.**
- **Siete cabeceras**, con emparejamiento normalizado —minúsculas, sin espacios, guiones ni guiones bajos—: `catalogTypeCode`, `catalogTypeName`, `code`, `name`, `value`, `description`, `sortOrder`.
- Cabeceras **obligatorias**: `catalogTypeCode`, `catalogTypeName`, `code`, `name`. Si falta alguna, la operación corta con 400 antes de leer una sola fila de datos.
- Lectura **siempre de la primera hoja** del libro, con la cabecera en la **fila 1** y los datos desde la 2.
- **Normalización al escribir**, igual que el `001` y a diferencia de F17 y F19: `toConstantCase` en `catalogItem.code`, `toTitleCase` en `catalogItem.name` y en `catalogType.name`, y **`toCamelCase`** en `catalogType.code`. La unicidad se compara siempre contra el valor ya normalizado.
- **Resolución del `catalogType`** por su `code` normalizado, **sin filtrar por `isActive`**, con **creación al vuelo** cuando no existe, usando el `catalogTypeName` del fichero. Una caché en memoria por importación garantiza que un tipo nuevo que aparece en N filas se cree **una sola vez**.
- Procesamiento por lotes de 1000 filas, cada lote en su propia transacción.
- **Inserción** de los ítems cuyo par `(catalogTypeId, code)` no existe.
- **Actualización diferencial** de los que ya existen, sobre `name`, `value`, `description` y `sortOrder`, mediante `buildDifferentialUpdate`.
- **Coerción de `sortOrder`**: celda vacía, no entera, negativa o mayor que 32767 entra como `0`, y cada coerción se cuenta en `sortOrderCoerced`.
- Modo `dryRun`: recorre, valida y cuenta sin escribir nada, **ni ítems ni tipos**.
- Informe de resultado con `read`, `inserted`, `updated`, `unchanged`, `invalid`, `duplicated`, `catalogTypesCreated`, `sortOrderCoerced`, la hoja leída, las cabeceras opcionales ausentes, las desconocidas ignoradas, y las primeras 20 filas rechazadas con su motivo.
- Cinco claves i18n nuevas en el bloque `catalogItem` de `es`, `en` y `nl`, subiendo el bloque de **19 a 24** claves.
- Una fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **143 a 144** — 143 es el número que deja F19.
- Fixture `tests/fixtures/catalog-items-sample.xlsx` y bloque de cobertura en `tests/contract/catalogItem.test.ts`.

**Fuera de alcance (otros specs):**

- **El CRUD de `catalogItem`.** Las siete operaciones canónicas ya están implementadas; este spec añade un endpoint a esa superficie y no redefine ninguno.
- **El CRUD de `catalogType` y su propia importación masiva.** El importador crea tipos como efecto colateral declarado, no gestiona el catálogo maestro. Un `.xlsx` de tipos es otro spec.
- **Actualizar un `catalogType` existente desde el fichero.** Si el tipo ya existe, su `name`, `description` y `sortOrder` se quedan como están: el `catalogTypeName` del fichero solo sirve para crearlo. El fichero es autoridad sobre los ítems, no sobre el catálogo maestro, y una carga de ítems que renombrara tipos en silencio sería el peor efecto posible de este endpoint.
- **La reactivación por importación**, ni de ítems ni de tipos. Un ítem desactivado con el `005A` sigue inactivo aunque el fichero lo traiga, y un tipo inactivo se reutiliza sin reactivarse; `isActive` no entra en ningún diff. Misma decisión que F19 y por la misma razón: el fichero no declara vigencia, así que inferirla sería inventarla.
- **`metadata`.** El importador **no la toca en absoluto**, ni al insertar ni al actualizar. En `catalogItem` es un campo de negocio que el cliente escribe con el `001` y el `004`, a diferencia de `vaccineWhodrug`, donde era exclusiva del importador. Las filas insertadas se quedan con el `'{}'` del DDL. Esto significa que **no hay marca de procedencia por fila**: quien quiera saber de dónde salió un ítem lo mira en `appDetails`.
- **`isActive` como columna del fichero.** Todo lo insertado entra activo.
- **La reversión de una importación.** No hay «deshacer la carga del martes», y con creación de tipos al vuelo eso incluye no borrar los tipos que la carga fundó.
- **El versionado de cargas.** No hay tabla de importaciones ni histórico; sin `metadata` no hay siquiera `dictionaryVersion` que guardar, y por eso el body tampoco lo acepta.
- **La detección de ítems retirados.** Un ítem que ya no viene en el fichero se queda como está: no hay «desactivar todo lo que no aparezca», que convertiría cada carga parcial en un borrado masivo.
- **La importación asíncrona con cola y consulta de progreso.**
- **La carga por CSV, JSON o `.asc`.** Un solo formato de entrada por endpoint.
- **Libros con varias hojas o con la cabecera fuera de la fila 1.** Se lee la primera hoja y se espera la cabecera en la primera fila. No hay parámetro `sheet`.
- **Extraer un lector genérico de `.xlsx`** que compartan este parser y el de F19. Es la segunda aparición del patrón; la abstracción se hace a la tercera y con datos, no antes.
- **El `005C` de purga.** `catalogItem` está en la lista de entidades protegidas de `CONVENTIONS.md` §9 y sigue sin purga física.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tablas origen

**No hay tablas nuevas y no se toca el DDL.** Es la diferencia más visible con F19, que tuvo que corregir el esquema antes de escribir una línea de código. Aquí `esaviapp.sql` no cambia.

**`catalogItem` (`esaviapp.sql:213-232`)** — la tabla que se escribe:

| Columna | Tipo | Cómo la trata el importador |
|---|---|---|
| `catalogItemId` | `uuid PK DEFAULT gen_random_uuid()` | lo pone Postgres |
| `catalogTypeId` | `uuid NOT NULL`, FK `ON DELETE RESTRICT` | **resuelto**, nunca leído del fichero |
| `code` | `varchar(100) NOT NULL` | del fichero, con `toConstantCase` |
| `name` | `varchar(250) NOT NULL` | del fichero, con `toTitleCase` |
| `value` | `varchar(250)` | del fichero, solo `.trim()` |
| `description` | `text` | del fichero, solo `.trim()` |
| `sortOrder` | `smallint NOT NULL DEFAULT 0 CHECK (>= 0)` | del fichero, con coerción a `0` |
| `metadata` | `jsonb DEFAULT '{}'` | **no se toca nunca** |
| `isActive`, `deletedAt` | | `true` / `null` al insertar; fuera del diff |

Las tres piezas del DDL que gobiernan la operación:

- **`UQ_catalogItem_type_code UNIQUE ("catalogTypeId", "code")`** (`:229`) — el árbitro de la deduplicación, y **compuesto**. Es lo que obliga a resolver el tipo antes de poder decidir si una fila es nueva.
- **`FK_catalogItem_catalogType`** (`:228`) — con `ON DELETE RESTRICT`, así que el tipo tiene que existir **antes** del `bulkCreate` del lote.
- **`TRG_catalogItem_setSysDetails`** — se dispara una vez por fila insertada o actualizada, también dentro de un `bulkCreate`.

`TRG_catalogItem_preventPhysicalDelete` es irrelevante: la importación nunca borra. `IX_catalogItem_catalogTypeId` sí trabaja, porque la lectura de existentes va filtrada por tipo.

**`catalogType` (`esaviapp.sql:198-211`)** — la tabla que se lee y, cuando falta un tipo, se escribe:

- `UQ_catalogType_code UNIQUE ("code")`, **simple**: por eso la búsqueda del tipo es por `code` y nada más.
- `code varchar(100) NOT NULL` y `name varchar(200) NOT NULL` — ojo, **200, no 250** como en `catalogItem`. Son límites distintos y el parser los valida por separado.
- **No tiene `metadata`.** Un tipo creado al vuelo no puede llevar marca de procedencia; lo único que queda de él es su entrada en `appDetails`.

`appDetails` se escribe siempre como array y se lee con `Array.isArray(row.appDetails) ? row.appDetails : []`, porque el `DEFAULT` del DDL es `'{}'` y no `'[]'`.

### 3.2 Modelo Sequelize

**Sin cambios.** `src/models/catalogItem.model.ts` y `src/models/catalogType.model.ts` ya existen y cubren todas las columnas implicadas. Tampoco cambian las asociaciones: la relación `catalogType` → `catalogItem` ya está cableada en `src/models/associations/`.

### 3.3 Tipos

En `src/types/catalog/catalogItem.types.ts`:

```ts
export interface ImportCatalogItemsInput {
    dryRun?: boolean;             // default false
}

// Las tres columnas opcionales del fichero. sortOrder llega ya coercionado a un entero válido
export interface CatalogItemFileValues {
    value: string | null;
    description: string | null;
    sortOrder: number;
}

export interface ParsedCatalogItemRow {
    row: number;                  // 1-based sobre la hoja; la fila 1 es la cabecera
    catalogTypeCode: string;      // ya normalizado con toCamelCase
    catalogTypeName: string | null;   // ya con toTitleCase; solo se usa si hay que crear el tipo
    code: string;                 // ya normalizado con toConstantCase
    name: string;                 // ya con toTitleCase
    values: CatalogItemFileValues;
    sortOrderCoerced: boolean;    // la celda venía vacía o inválida y entró como 0
}

export interface RejectedCatalogItemRow {
    row: number;
    reason: 'EMPTY_CATALOG_TYPE_CODE' | 'EMPTY_CODE' | 'EMPTY_NAME'
          | 'VALUE_TOO_LONG' | 'DUPLICATE_IN_FILE' | 'CATALOG_TYPE_NAME_REQUIRED';
    column?: string;              // solo en VALUE_TOO_LONG: qué columna se pasó
}

export interface CatalogItemImportReport {
    read: number;
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    duplicated: number;
    catalogTypesCreated: number;
    sortOrderCoerced: number;
    dryRun: boolean;
    sheet: string;
    missingOptionalHeaders: string[];
    unknownHeaders: string[];
    errors: RejectedCatalogItemRow[];  // las 20 primeras, no todas
}
```

`ImportCatalogItemsInput` **no lleva `dictionaryVersion`**, a diferencia de los dos importadores anteriores: sin `metadata` no hay dónde guardarlo. Y **no se declara ningún `Update...Input`**, por §4 de las convenciones.

`CATALOG_TYPE_NAME_REQUIRED` es el único motivo de rechazo que **no emite el parser sino el servicio**, en el momento de resolver el tipo y solo cuando hay que crearlo. El parser es una función pura y no puede saber si un tipo existe, así que `errors` recoge rechazos de dos orígenes, ambos con su número de fila. La contrapartida —exigir `catalogTypeName` en todas las filas— obligaría a rellenar una columna que se ignora en la mayoría de las cargas.

### 3.4 Superficie HTTP

```
POST   /api/catalog-items/import          ESAVI-CATITEM-006   SUPERADMIN  (nuevo)
```

Las siete rutas existentes no cambian. `/import` es una **ruta literal** y se declara **antes** de `GET /:id`, `PUT /:id` y `DELETE /:id`, junto a `/type/:id`, `/admin/type/:id` y `/activate/:id`.

Petición:

```
POST /api/catalog-items/import
Content-Type: multipart/form-data

file    (requerido)  el .xlsx, campo de tipo archivo
dryRun  (opcional)   'true' | 'false', default false
```

Sin parámetro `sheet` y sin `encoding`. Sin `dictionaryVersion`: no hay `metadata` donde guardarlo.

El middleware se invoca con `uploadSingleFile('file', { i18nPrefix: 'catalogItem', codePrefix: 'CATITEM_006' })` y **no se modifica**: F19 ya lo dejó parametrizado por entidad.

### 3.5 Reglas de negocio por operación

**`ESAVI-CATITEM-006` — importar.** `importCatalogItemsService(fileBuffer, data, authUser, lang)` en `src/services/catalogItem.service.ts`. Seis fases:

**Fase 1 — recepción.** El middleware deja el fichero en `req.file` con `memoryStorage`. Sin fichero → 400 `CATITEM_006_FILE_REQUIRED`, comprobado en el controlador y otra vez en el servicio. Fichero que excede los 20 MB → 413 `CATITEM_006_FILE_TOO_LARGE`, aplicado por multer y traducido en el middleware.

**Fase 2 — parseo.** `parseCatalogItemsXlsxFile(buffer)` en `src/helpers/catalogItemParser.helper.ts` devuelve `{ sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders }`:

1. Abre el libro con `exceljs`. Si el buffer no es un `.xlsx` válido o no tiene ninguna hoja → 400 `CATITEM_006_FILE_INVALID`.
2. Toma la **primera hoja** y guarda su nombre. La **fila 1** es la cabecera; los datos empiezan en la 2.
3. Cada cabecera se **normaliza** —minúsculas, sin espacios, `-` ni `_`— y se busca en el mapa de alias:

| Cabecera del fichero | Destino | Normalización al escribir | Límite |
|---|---|---|---|
| `catalogTypeCode` | `catalogType.code` (búsqueda) | `toCamelCase` | 100 |
| `catalogTypeName` | `catalogType.name` (solo al crear) | `toTitleCase` | 200 |
| `code` | `catalogItem.code` | `toConstantCase` | 100 |
| `name` | `catalogItem.name` | `toTitleCase` | 250 |
| `value` | `catalogItem.value` | solo `.trim()` | 250 |
| `description` | `catalogItem.description` | solo `.trim()` | — (`text`) |
| `sortOrder` | `catalogItem.sortOrder` | entero, coerción a `0` | 0–32767 |

4. **Cabeceras obligatorias**: `catalogTypeCode`, `catalogTypeName`, `code`, `name`. Si falta alguna → 400 `CATITEM_006_FILE_INVALID` con la lista, **antes de leer una sola fila de datos**. Una opcional ausente se anota en `missingOptionalHeaders` y su columna entra como `null` —o `0` en `sortOrder`— en todas las filas. Una desconocida se anota en `unknownHeaders` y se ignora.
5. Una fila **totalmente vacía** se descarta: no cuenta como leída ni como inválida.
6. Cada celda de texto se recorta; si queda vacía entra como **`null`**, nunca como `''`.
7. **La normalización se aplica en el parser, no en el servicio**, porque la unicidad se compara contra el valor normalizado y el parser es quien detecta los duplicados internos del fichero.
8. `catalogTypeCode` vacío → `EMPTY_CATALOG_TYPE_CODE`. `code` vacío → `EMPTY_CODE`. `name` vacío → `EMPTY_NAME`; los dos últimos romperían además el `NOT NULL` de su columna.
9. `catalogTypeName` vacío **no rechaza aquí**: el parser no sabe si el tipo existe. Se deja en `null` y lo resuelve la fase 3.
10. **`sortOrder`**: celda vacía, no numérica, no entera, negativa o mayor que 32767 entra como **`0`** y marca `sortOrderCoerced: true` en la fila. **No rechaza nunca**: el orden de un desplegable no vale una fila perdida, y el contador lo hace visible.
11. Un texto que excede el límite de su columna → rechazo `VALUE_TOO_LONG` con el nombre de la columna. Sin este filtro la fila reventaría el lote.
12. Par `(catalogTypeCode, code)` repetido **dentro del propio fichero**: **gana la primera aparición**; las siguientes se rechazan como `DUPLICATE_IN_FILE`. El duplicado es del **par**, no del `code` solo: `ACTIVO` en dos tipos distintos son dos ítems legítimos.

Una fila rechazada **no aborta nada**. Si tras el parseo `rows` está vacío → 400 `CATITEM_006_FILE_INVALID`. Junto con la cabecera incompleta, son los dos únicos casos en que el contenido corta la operación, y ambos cortan antes de escribir.

**Fase 3 — resolución de tipos.** Antes de tocar ítems, cada lote resuelve los `catalogTypeCode` distintos que trae:

1. `findAll` sobre `catalogType` con `where: { code: { [Op.in]: códigosDelLote } }`, **sin filtrar por `isActive`**: un tipo inactivo sigue ocupando su `code` y sirve para colgar ítems.
2. Los que no aparecen **se crean**, uno a uno, con `code` ya normalizado, `name` del fichero, y su entrada en `appDetails` con `method: 'ESAVI-CATITEM-006'`. Se crean **dentro de la transacción del lote**, antes del `bulkCreate` de ítems, porque la FK es `RESTRICT`.
3. Una fila cuyo tipo hay que crear pero que **no trae `catalogTypeName`** se rechaza con `CATALOG_TYPE_NAME_REQUIRED` y el tipo no se crea. Es el único rechazo que emite el servicio y no el parser.
4. **La caché de tipos vive en toda la importación, no en el lote**: un tipo creado en el primer lote se reutiliza en el tercero sin volver a consultarlo. Un tipo nuevo que aparece en 40 filas se crea **una vez**.
5. `catalogTypesCreated` cuenta las creaciones reales. En `dryRun` cuenta las que **se harían**, y ninguna se ejecuta.

**Fase 4 — proceso por lotes.** Las filas válidas se recorren en lotes de **1000**, cada uno en su transacción. Por lote:

1. `findAll` sobre `catalogItem` con `where: { catalogTypeId: { [Op.in]: tiposDelLote }, code: { [Op.in]: códigosDelLote } }`, **fila completa y sin `attributes` acotados** —precondición de `buildDifferentialUpdate`— y **sin filtrar por `isActive`**. La consulta sobreselecciona: devuelve pares que no están en el fichero. El emparejamiento exacto se hace en memoria sobre la clave `${catalogTypeId}|${code}`, que es lo que evita un `Op.or` de mil condiciones.
2. Las filas cuyo par no aparece son **nuevas**: se acumulan y se insertan con un solo `bulkCreate`.
3. Las que aparecen pasan por el diff, una a una.

**Fase 5 — inserción.** Un `bulkCreate` por lote, sin `updateOnDuplicate` y sin `ignoreDuplicates`. Cada fila lleva:

```
{ catalogTypeId, code, name, value, description, sortOrder,
  isActive: true,
  deletedAt: null,
  appDetails: [ { createdAt, user, method: 'ESAVI-CATITEM-006', detail } ] }
```

**`metadata` no se escribe**: queda con el `'{}'` del DDL. Es la diferencia con los dos importadores anteriores y sale de que en esta entidad `metadata` es campo del cliente.

Si el `bulkCreate` lanza `SequelizeUniqueConstraintError` —dos importaciones a la vez—, la transacción del lote revierte y el error sube como 500 `CATITEM_006_IMPORT_FAILED`. **No hay reintento.**

**Fase 6 — informe.** `errors` se recorta a las **20 primeras**; `invalid`, `duplicated`, `catalogTypesCreated` y `sortOrderCoerced` cuentan el total real.

**Modo `dryRun: true`.** Ejecuta las fases 1 a 4 —incluida la resolución de tipos y el cálculo del diff— y **omite toda escritura**, tanto de ítems como de tipos. Ninguna transacción se abre. Los tipos que se habrían creado se resuelven contra la caché en memoria para que las filas que cuelgan de ellos cuenten como `inserted` y no como error.

#### Contrato de update diferencial

`stored` sale de `item.get({ plain: true })`. Diff con `buildDifferentialUpdate`; si vuelve vacío **no se escribe nada** —ni `updatedAt`, ni `appDetails`, ni evento en `sysDetails`— y la fila cuenta como `unchanged`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `catalogTypeId` | **no entra** | mitad de la clave de búsqueda |
| `code` | **no entra** | la otra mitad; la fila se encontró *por* el par |
| `name` | `row.name` — **siempre** | ya con `toTitleCase` |
| `value` | `row.values.value` — **siempre** | `null` si la celda venía vacía |
| `description` | `row.values.description` — **siempre** | `null` si la celda venía vacía |
| `sortOrder` | `row.values.sortOrder` — **siempre** | ya coercionado; nunca `undefined` |
| `metadata` | **no entra** | campo del cliente; el importador no lo toca |
| `isActive` | **no entra** | el fichero no declara vigencia |
| `deletedAt` | **no entra** | derivado de `isActive`, que no cambia |

Tres puntos que la tabla no dice sola:

- **Los cuatro entran siempre, sin `if` de presencia.** No hay body de cliente que preguntar: el fichero es la fuente completa de los cuatro, y es el helper quien decide si hay `UPDATE`. Una reimportación del mismo fichero deja todo en `unchanged` y no escribe una sola vez.
- **Una celda vacía en `value` o `description` propone `null`, y eso es un cambio si había valor.** Es la consecuencia buscada de haber elegido que el fichero sea la fuente completa: la importación es idempotente y el estado final es el del fichero, no la unión del fichero con lo que hubiera antes.
- **`sortOrder` nunca entra bajo `if( row.values.sortOrder )`.** Es el error de copia-pega más probable de este spec: `0` es falso en JavaScript y es además el valor por defecto de la columna, así que ese `if` haría imposible devolver un ítem a la posición `0` por importación.

La actualización que sí escribe añade su entrada a `appDetails` con `method: 'ESAVI-CATITEM-006'` y preserva el historial con `[...currentAppDetails, newEntry]`.

**Escrituras que no pasan por el helper**, declaradas una a una:

1. El `bulkCreate` de ítems de la fase 5 — es una inserción.
2. El `CatalogType.create` de la fase 3 — es una inserción, y la única escritura de este spec fuera de `catalogItem`.

**No hay ninguna escritura diferencial sobre `catalogType`.** Un tipo que ya existe no se actualiza nunca: su `name`, `description` y `sortOrder` se quedan como estaban, aunque el fichero traiga otro `catalogTypeName`.

### 3.6 Claves i18n nuevas

Cinco claves en el bloque `catalogItem` de `es.json`, `en.json` y `nl.json`, que pasa de **19 a 24**:

| Clave | Uso |
|---|---|
| `importedSuccess` | 200 del `006` |
| `importedFailed` | 500 del `006` |
| `fileRequired` | 400 cuando no viaja el fichero |
| `fileInvalid` | 400 cuando el libro no es válido, falta una cabecera obligatoria o no hay ninguna fila válida |
| `fileTooLarge` | 413 cuando excede los 20 MB |

Son los mismos cinco nombres que estrenaron `diagnosticTerm` y `vaccineWhodrug`. Esa paridad es lo que hace funcionar el `i18nPrefix` del middleware: `getMessage(\`${ i18nPrefix }.fileTooLarge\`, req.lang)` resuelve en las tres entidades porque las tres declaran la clave. **Ninguna clave nueva para los 400 de validación** de `dryRun`: los resuelve `validateFields`.

### 3.7 Forma de la respuesta

Éxito, **200**:

```
{ ok, message, data: {
    read, inserted, updated, unchanged, invalid, duplicated,
    catalogTypesCreated, sortOrderCoerced,
    dryRun, sheet,
    missingOptionalHeaders: [ "description" ],
    unknownHeaders: [ "observaciones" ],
    errors: [ { row, reason, column? } ]
} }
```

**200 y no 201**: no hay recurso identificable que devolver ni URL a la que apuntar. `data` no contiene ni un solo `catalogItemId` ni `catalogTypeId`.

`catalogTypesCreated` es el campo que más importa de este informe y el que no tienen los otros dos importadores. Una carga que devuelve `catalogTypesCreated: 1` cuando quien la subió esperaba `0` es la señal —la única— de que hay una errata en `catalogTypeCode` y de que acaba de nacer un tipo que nadie pidió.

Los errores salen por `errorHandler` con la forma habitual `{ ok, message, code, errors }`.

---

## 4. Plan de implementación

**Precondición.** Este spec se apoya en tres cosas que deja F19 y que tienen que estar en `main` antes de empezar: la firma `uploadSingleFile(fieldName, { i18nPrefix, codePrefix })`, la dependencia `exceljs`, y las **143** entradas de `ROUTE_RULES`. Si F19 no ha aterrizado, el paso 5 no compila y el 6 cuenta mal.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registrar la operación no canónica.** Fila `catalogItem | 006 | importación masiva desde fichero .xlsx, con creación de catalogType al vuelo — SUPERADMIN, POST /import` en la tabla de `references/CONVENTIONS.md` §6. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla tiene una entrada `006` para `catalogItem` y ninguna otra entidad se ve afectada. La abreviatura `CATITEM` ya estaba registrada y no se acuña ninguna.

2. **Tipos y parser.** Las cuatro interfaces de §3.3 en `src/types/catalog/catalogItem.types.ts`. `src/helpers/catalogItemParser.helper.ts` con `parseCatalogItemsXlsxFile(buffer)`, el mapa de las siete cabeceras, los límites por columna y los doce puntos de la fase 2, con su alta en `src/helpers/index.ts`. **Función pura, sin acceso a base de datos.**
   *Verificación:* prueba unitaria sobre libros construidos en memoria — `ACTIVO` bajo dos `catalogTypeCode` distintos salen como **dos filas válidas** y no como duplicado; el mismo par repetido produce un `DUPLICATE_IN_FILE`; `code` y `catalogTypeCode` salen con normalizaciones **distintas** (`toConstantCase` frente a `toCamelCase`) sobre la misma cadena de entrada; una hoja sin `code` produce el corte por cabecera obligatoria; una celda vacía sale `null` y no `''`; `sortOrder` vacío, `-1`, `abc` y `40000` salen todos `0` con `sortOrderCoerced: true`, y `0` explícito sale `0` con `sortOrderCoerced: false`; un `catalogTypeName` vacío **no** rechaza la fila.

3. **Las cinco claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; el bloque `catalogItem` tiene 24 claves en los tres idiomas.

4. **`ESAVI-CATITEM-006` — servicio.** `importCatalogItemsService` en `src/services/catalogItem.service.ts` con las seis fases de §3.5: resolución de tipos con caché de toda la importación y creación al vuelo, lectura de ítems existentes por `(catalogTypeId, code)`, `bulkCreate` de los nuevos, diff de los existentes con los cuatro `candidates`, transacción por lote y construcción del informe. Incluye la rama `dryRun`.
   *Verificación:* un libro con 3 ítems de un tipo inexistente devuelve `inserted: 3, catalogTypesCreated: 1` y **un solo** `catalogType` nuevo, no tres; invocado dos veces seguidas con el mismo libro devuelve la segunda vez `inserted: 0, updated: 0, unchanged: 3, catalogTypesCreated: 0` y ninguna fila crece en `appDetails`; un libro cuyo tipo no existe y sin `catalogTypeName` devuelve esas filas en `errors` con `CATALOG_TYPE_NAME_REQUIRED` y **no crea el tipo**.

5. **`ESAVI-CATITEM-006` — controlador, validador y ruta.** Controlador que lee `req.file` y `dryRun` del body, devuelve 400 `CATITEM_006_FILE_REQUIRED` si no hay fichero, y sigue el idiom de `catch` de §10. Validador `importCatalogItemsValidator` con `dryRun` opcional booleano. Ruta `POST /import` con `tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file', { i18nPrefix: 'catalogItem', codePrefix: 'CATITEM_006' }), ...importCatalogItemsValidator, validateFields, importCatalogItems`, declarada **antes** de las rutas con `:id`.
   *Verificación:* una petición sin fichero devuelve **400** `CATITEM_006_FILE_REQUIRED`; un ADMIN recibe **403**; un `.xlsx` válido devuelve **200** con el informe; `?dryRun=true` deja intactas **las dos tablas**; `POST /import` no se interpreta como un `:id`.

6. **Cubrir la ruta en `tests/auth/roles.test.ts`.** Una fila en `ROUTE_RULES` con `minRole: SUPERADMIN` y código `ESAVI-CATITEM-006`, y subir el total esperado de **143 a 144**.
   *Verificación:* `npm test -- roles` pasa con 144.

7. **Fixture y suite de contrato.** `tests/fixtures/catalog-items-sample.xlsx` con la cabecera de siete columnas y ocho filas de datos: tres ítems de un tipo **existente**, dos de un tipo **inexistente** con su `catalogTypeName`, uno con `code` repetido dentro del mismo tipo, uno con `code` vacío, y uno con un `sortOrder` inválido. Bloque nuevo en `tests/contract/catalogItem.test.ts` que sube el fichero con `.attach()`.
   *Verificación:* el informe devuelve `read: 8, inserted: 5, invalid: 1, duplicated: 1, catalogTypesCreated: 1, sortOrderCoerced: 1`; la reimportación sale `unchanged: 5` con `catalogTypesCreated: 0`; cambiar `name` en una fila del libro produce `updated: 1`. **El fixture no puede quedar ignorado por git**: `.gitignore` tiene un `*.xlsx` global, ya excepcionado en `!tests/fixtures/*.xlsx` por F19 — comprobar con `git check-ignore -v` que la excepción sigue en pie.

8. **Los casos que solo se ven a escala.** Importar un libro de ~2000 ítems repartidos en 30 tipos, la mitad de ellos inexistentes, contra una base local; medir el tiempo total de la petición.
   *Verificación:* la petición termina dentro del timeout por defecto; `SELECT count(*) FROM "catalogType"` sube exactamente en el número de tipos nuevos y ni uno más — que es la prueba de que la caché es de toda la importación y no del lote —; una segunda pasada deja `unchanged` igual al total y `catalogTypesCreated: 0`.

---

## 5. Criterios de aceptación

- [ ] `POST /api/catalog-items/import` responde **200** con el informe de §3.7, y **403** para ADMIN.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en `ESAVI-CATITEM-006`, y no hay ningún `007` para esta entidad.
- [ ] `esaviapp.sql` **no cambia**: `git diff --stat esaviapp.sql` sale vacío al cerrar la rama.
- [ ] Dos ítems con el mismo `code` bajo **tipos distintos** se importan los dos. La unicidad es del par, y ése es el criterio que distingue este importador de los dos anteriores.
- [ ] Dos filas del fichero con el mismo par `(catalogTypeCode, code)`: la primera se importa, la segunda sale en `errors` con `DUPLICATE_IN_FILE`.
- [ ] `code` se guarda con `toConstantCase` y `name` con `toTitleCase`, igual que por el `001`: importar `  activo simple  ` y crearlo por el `001` producen **la misma fila**, y la segunda vía responde 409 `CATITEM_001_CODE_EXISTS`.
- [ ] `catalogTypeCode` se normaliza con **`toCamelCase`** y no con `toConstantCase`: importar un fichero cuyo `catalogTypeCode` es `tipo evento` resuelve contra el `catalogType` que el `ESAVI-CATTYPE-001` habría creado con esa misma entrada, y **no** funda uno nuevo.
- [ ] Un tipo inexistente que aparece en N filas se crea **una vez**: `catalogTypesCreated: 1` y `SELECT count(*) FROM "catalogType" WHERE "code" = ...` devuelve 1.
- [ ] Un tipo **inactivo** se reutiliza sin reactivarse: los ítems entran, y el tipo conserva `isActive: false` y su `deletedAt`.
- [ ] Una fila cuyo tipo hay que crear pero sin `catalogTypeName` sale en `errors` con `CATALOG_TYPE_NAME_REQUIRED`, y **el tipo no se crea**.
- [ ] Un libro sin la columna `code` devuelve **400** `CATITEM_006_FILE_INVALID` y **no escribe ninguna fila en ninguna de las dos tablas**.
- [ ] Una cabecera desconocida no rompe la carga y aparece en `unknownHeaders`; una opcional ausente aparece en `missingOptionalHeaders` y su columna queda en `null` —o en `0` para `sortOrder`—.
- [ ] Una celda vacía se guarda como `null`, **no** como `''`.
- [ ] `sortOrder` vacío, `-1`, `abc` y `40000` se guardan todos como `0` y suman a `sortOrderCoerced`; un `0` explícito se guarda como `0` y **no** suma.
- [ ] Toda fila creada queda con `metadata` en `{}` y `isActive: true`; **`grep -n "metadata" src/services/catalogItem.service.ts`** no muestra ninguna referencia dentro de `importCatalogItemsService`.
- [ ] Una petición sin fichero devuelve **400**; un fichero de 21 MB devuelve **413**; un libro que no produce ninguna fila válida devuelve **400** `CATITEM_006_FILE_INVALID`.
- [ ] `errors` trae como mucho 20 entradas aunque `invalid` sea mayor, y todos los contadores cuentan el total real.
- [ ] `dryRun: true` devuelve el mismo informe, incluido `catalogTypesCreated` con lo que **se habría** creado, y deja `SELECT count(*)` sin cambios en `catalogItem` **y** en `catalogType`.
- [ ] Las veinticuatro claves existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 144 entradas y `npm test -- roles` pasa.
- [ ] El fixture está versionado: `git check-ignore -v tests/fixtures/catalog-items-sample.xlsx` no devuelve nada.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Reimportar el mismo fichero sin cambios responde **200** con `updated: 0` y `unchanged: N`: ninguna fila crece en `appDetails`, ningún `sysDetails.version` avanza y ningún `updatedAt` se mueve. Es el criterio que de verdad discrimina.
- [ ] Un fichero en el que **una** fila cambió `name` produce `updated: 1` y `unchanged: N-1`, y esa fila añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] Un fichero idéntico salvo por un `description` que pasó de tener texto a estar vacío produce `updated: 1` y deja esa fila con `description: null`. El fichero es la fuente completa, y vaciar es un cambio.
- [ ] Un fichero idéntico salvo por un `sortOrder` que pasó de `5` a vacío produce `updated: 1` y deja la fila en `0`: el `0` no se descarta por falsedad.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/catalogItem.service.ts` no devuelve resultados.

**Propios del `006`:**

- [ ] `catalogTypeId` y `code` **no entran** en `candidates`, y `name`, `value`, `description` y `sortOrder` sí: la lista de §3.5 se corresponde una a una con el bloque del servicio.
- [ ] `metadata` **no entra** en `candidates`: un `metadata` escrito con el `004` sobrevive intacto a la reimportación.
- [ ] `isActive` **no entra** en `candidates`: un ítem desactivado con el `005A` sigue con `isActive: false` y con su `deletedAt` intacto después de reimportar el fichero que lo contiene.
- [ ] **`catalogType` no se actualiza nunca**: un tipo existente cuyo `catalogTypeName` en el fichero difiere del almacenado conserva su `name`, no crece en `appDetails` y no avanza su `sysDetails.version`.
- [ ] Una fila cuyo `name` supera los 250 caracteres sale en `errors` con `VALUE_TOO_LONG` y `column: 'name'`, y no revienta el lote. Lo mismo con un `catalogTypeName` de más de **200**, que es un límite distinto.
- [ ] Una fila totalmente vacía en medio de la hoja no cuenta en `read` ni en `invalid`.
- [ ] El importador no consulta ni escribe ninguna tabla fuera de `catalogItem` y `catalogType`.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** el fichero trae **`catalogTypeCode` y `catalogTypeName`** como columnas, y no un `catalogTypeId` en el body. La unicidad es del par `(catalogTypeId, code)`, así que el tipo tiene que viajar con cada fila si se quiere cargar más de un catálogo por libro — que es el caso real de un seed. **No:** un `catalogTypeId` en el body que aplique a todo el fichero; obliga a un libro por tipo y a que quien lo sube conozca un UUID que nadie transcribe a mano. **No:** una columna con el UUID por fila, por lo mismo.
- **Sí:** **crear el `catalogType` al vuelo** cuando no existe. Es una decisión tomada en contra de la recomendación inicial de este documento y conviene que conste así. A favor: el fichero trae el nombre, así que hay con qué crearlo, y cortar la carga porque falta un tipo obliga a un ida y vuelta por el `ESAVI-CATTYPE-001` antes de poder importar nada, que es exactamente la fricción que este endpoint viene a quitar. En contra, y asumido: una errata en `catalogTypeCode` no falla, **funda un tipo nuevo**, y el tipo fundado por error no se limpia solo porque la importación no tiene reversión. La mitigación es `catalogTypesCreated` en la respuesta y `dryRun` para verlo antes de escribir. **No:** rechazar la fila con `CATALOG_TYPE_NOT_FOUND`. **No:** cortar toda la operación con 400.
- **Sí:** mantener `toConstantCase` en `code` y `toTitleCase` en `name`, al revés que F17 y F19. Aquellos importan dato citado de un diccionario licenciado y por eso solo recortan; un `catalogItem` es configuración acuñada en esta aplicación, y si el importador no normalizara, el mismo valor entraría distinto según la puerta —`001` o `006`— y la unicidad dejaría de detectar el duplicado.
- **Sí:** aplicar **`toCamelCase` a `catalogType.code`** y `toConstantCase` a `catalogItem.code`, distinto en cada tabla. No es una inconsistencia que este spec introduzca: es la que ya tienen los servicios (`catalogType.service.ts:94` frente a `catalogItem.service.ts:22`), y el importador la respeta porque su trabajo es resolver contra lo que ya existe. **No:** unificar las dos reglas aquí. Sería un cambio de comportamiento del `CATTYPE-001` y del `CATTYPE-004` escondido dentro de un spec de importación; si hay que unificarlas, es otro spec y con su migración de datos.
- **Sí:** el fichero es la **fuente completa** de `name`, `value`, `description` y `sortOrder`, y una celda vacía propone `null` o `0`. Hace la importación idempotente: el estado final es el del fichero, no la unión del fichero con lo que hubiera antes, y `unchanged` se vuelve una señal fiable. **No:** que una celda vacía signifique «no lo toques». Protegería lo escrito a mano a cambio de que no hubiera forma de vaciar un campo por importación, y de que dos ficheros distintos pudieran dejar la tabla en el mismo estado por caminos que nadie sabe reconstruir.
- **Sí:** `metadata` **fuera del importador por completo**, ni al insertar ni al actualizar. Es la tercera divergencia con F17 y F19, y sale de que aquí `metadata` es un campo de negocio que el cliente escribe con el `001` y el `004`, no un hueco reservado a la procedencia. **No:** estampar `importedFrom`/`importedAt` como hacen los otros dos; pisaría lo del administrador en la rama de inserción y obligaría a un merge en la de actualización. El coste asumido es que **no hay marca de procedencia por fila**: de dónde salió un ítem se mira en `appDetails`, que es donde vive el resto de su historia.
- **Sí:** sin `dictionaryVersion` en el body. Sin `metadata` no hay dónde guardarlo, y un parámetro que se acepta y se descarta es peor que no tenerlo.
- **Sí:** `sortOrder` inválido **se coerciona a `0` y se cuenta**, no rechaza la fila. El orden de un desplegable no vale un ítem perdido, y un rechazo por esa columna dejaría fuera datos buenos por un detalle cosmético. `sortOrderCoerced` es lo que impide que la coerción sea silenciosa. **No:** rechazar con `INVALID_SORT_ORDER`. **No:** coercionar sin contarlo.
- **Sí:** **no actualizar nunca un `catalogType` existente** desde el fichero. El `catalogTypeName` solo sirve para crearlo. Una carga de ítems que renombrara tipos en silencio es el peor efecto que podría tener este endpoint: el nombre de un tipo lo ve toda la aplicación y quien sube un Excel de ítems no está pensando en eso. **No:** un diff sobre `catalogType.name`, aunque fuera diferencial.
- **Sí:** reutilizar un `catalogType` **inactivo** sin reactivarlo, y no reactivar ítems desactivados. Misma decisión que F19 y por la misma razón: el fichero no trae columna de vigencia, así que inferirla sería inventarla, y reactivar revertiría en silencio una desactivación deliberada. **No:** rechazar la fila por tipo inactivo, que dejaría un catálogo a medio cargar por una decisión administrativa ajena al fichero.
- **Sí:** la **caché de tipos es de toda la importación**, no del lote. Un tipo nuevo que aparece en 40 filas repartidas entre dos lotes debe crearse una vez; una caché por lote lo intentaría dos veces y la segunda chocaría contra `UQ_catalogType_code` dentro de una transacción que arrastraría el lote entero.
- **Sí:** un solo `findAll` de ítems por lote con `catalogTypeId IN (...) AND code IN (...)`, sobreseleccionando, y el emparejamiento exacto del par en memoria. **No:** un `Op.or` de mil pares, que produce una consulta que Postgres planifica mal y que es ilegible en el log. **No:** una consulta por fila.
- **Sí:** lotes de 1000 con transacción por lote, como los dos importadores anteriores. Un fallo deja confirmado lo anterior y el informe dice hasta dónde llegó; reimportar es idempotente, así que reanudar es volver a subirlo.
- **No:** `bulkCreate` con `updateOnDuplicate`. Pisa `appDetails` y `metadata`, escribe aunque nada haya cambiado, y deja un update que no pasa por `buildDifferentialUpdate`. El `SELECT` previo cuesta una consulta y compra las tres cosas.
- **No:** reintentar ante `SequelizeUniqueConstraintError`. Significa dos importaciones simultáneas, que con rol SUPERADMIN es un error de operación y conviene que se vea.
- **Sí:** rol **SUPERADMIN**, aunque el `001` de la entidad sea ADMIN. Es la escritura de mayor alcance del catálogo y además **crea filas en otra tabla**, que es más de lo que un ADMIN puede hacer hoy con `catalogType` sin pasar por su propio `001`. Mismo criterio que los otros dos importadores. **No:** ADMIN por simetría con el `001`.
- **Sí:** un **parser propio**, `catalogItemParser.helper.ts`, duplicando la mecánica de abrir el libro y leer la cabecera. Es la segunda aparición del patrón, y una abstracción sacada de dos casos suele quedarse corta al tercero: el de F19 tiene 27 alias y límites de otra tabla, y el genérico que valiera para ambos tendría que parametrizar alias, obligatorias, límites y normalización por columna — que es casi todo el parser. **No:** extraer ahora el lector genérico y refactorizar F19.
- **Sí:** `dryRun`. Con creación de tipos al vuelo y sin reversión, poder ver `catalogTypesCreated` antes de escribir deja de ser una comodidad y pasa a ser la única red que hay.
- **Sí:** 200 en vez de 201. No hay recurso creado que devolver ni `Location` que apuntar: lo que vuelve es el informe de un proceso.
- **Sí:** leer siempre la primera hoja, sin parámetro `sheet`, y devolver su nombre en el informe. Resuelve el único caso real —subir un libro cuya primera pestaña no era la que se creía— sin ampliar la superficie.
- **Sí:** el rechazo `CATALOG_TYPE_NAME_REQUIRED` lo emite **el servicio** y no el parser, de modo que `errors` recoge rechazos de dos orígenes. El parser es puro y no puede saber si el tipo existe; exigir el nombre siempre obligaría a rellenar una columna que se ignora en la mayoría de las cargas.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Una errata en `catalogTypeCode` funda un tipo que nadie pidió**, y como no hay reversión se queda en el catálogo maestro para siempre, visible en todos los desplegables que listan tipos | Es el riesgo central de la decisión de crear al vuelo, y está asumido. `catalogTypesCreated` va en la respuesta y no solo en el log, y `dryRun` permite verlo **antes** de escribir. Limpiarlo después es un `005A` de `CATTYPE` a mano |
| Las dos normalizaciones de `code` se implementan con la misma función y **cada carga funda un tipo duplicado** del que ya existe | `toCamelCase` para `catalogType` y `toConstantCase` para `catalogItem` están en la tabla de §3.5 columna por columna, hay un criterio de aceptación propio para cada una, y el paso 2 lo verifica con la misma cadena de entrada pasando por las dos |
| Un `if( row.values.sortOrder )` descarta el `0` y un ítem no puede volver a la primera posición por importación | `0` es falso en JavaScript **y** es el valor por defecto de la columna, lo que hace el fallo silencioso por partida doble. Cubierto por un criterio de aceptación propio y por el bloque de contrato |
| La caché de tipos se implementa **por lote** en vez de por importación, y un tipo nuevo repartido entre dos lotes choca contra `UQ_catalogType_code` arrastrando el segundo lote entero | Declarado en la fase 3 de §3.5 y verificado en el paso 8 con 30 tipos sobre ~2000 filas, que es lo que fuerza el reparto entre lotes. Con un fichero pequeño el fallo no aparece |
| **Vaciar por celda vacía borra trabajo hecho a mano.** Un administrador escribe una `description` con el `004`; alguien reimporta el fichero original, que la trae vacía, y la descripción desaparece | Es la consecuencia buscada de que el fichero sea la fuente completa, no un efecto colateral: está en §6, en el contrato de §3.5 y en un criterio de aceptación. `metadata`, que es el otro campo que un administrador escribe, sí queda protegido porque no entra en el diff |
| Un fichero cuyo `catalogTypeName` difiere del almacenado hace pensar que el importador renombra tipos, y alguien lo «arregla» añadiendo ese diff | El criterio de aceptación es explícito y verificable: el tipo no crece en `appDetails` ni avanza `sysDetails.version`. La razón está en §6 |
| El fixture `.xlsx` queda **fuera del commit** por el `*.xlsx` global de `.gitignore`, y la suite de contrato no corre en un clon limpio | Ya le pasó a F19 y por eso existe la excepción `!tests/fixtures/*.xlsx`. El paso 7 y un criterio de aceptación lo comprueban con `git check-ignore -v` en vez de darlo por hecho |
| El endpoint se implementa **antes** de que F19 aterrice y `uploadSingleFile` todavía tiene la firma vieja de un solo argumento | Declarado como precondición al principio de §4, junto con el recuento de `ROUTE_RULES`, que también depende de F19 |
| Dos importaciones simultáneas crean el mismo `catalogType` a la vez y una revienta contra `UQ_catalogType_code` | Sin reintento, por decisión de §6: con rol SUPERADMIN son dos personas pisándose, y el 500 con el lote revertido es la señal correcta. Los lotes ya confirmados quedan, y reimportar es idempotente |
| El fichero crece a decenas de miles de filas y la petición no cabe en el timeout del proxy | El paso 8 lo mide con ~2000 filas, que es el orden de magnitud declarado para un catálogo de configuración. Si el catálogo llegara a las escalas de MedDRA, la cola dejaría de estar fuera de alcance y sería otro spec |

---

## 8. Impacto en el contrato HTTP

**Sobre los endpoints existentes: ninguno.** El spec añade `POST /api/catalog-items/import` y no cambia el comportamiento de ningún cliente actual. Las siete operaciones canónicas de `catalogItem` y las de `catalogType` responden exactamente igual que hoy.

**No se toca `esaviapp.sql`**, a diferencia de F19: la tabla ya tiene todo lo que este importador necesita, incluida la restricción compuesta que le da la clave.

**No se toca `fileUpload.middleware.ts`**: F19 lo dejó parametrizado por entidad precisamente para que el tercer importador no tuviera que volver a abrirlo. Este spec es la comprobación de que aquella generalización sirvió.

**Efecto indirecto sobre `catalogType`, declarado.** El endpoint crea filas en una tabla que no es la suya. Ningún endpoint de `catalogType` cambia, pero su contenido puede crecer por una petición dirigida a `/api/catalog-items/import`, y eso aparece en la respuesta como `catalogTypesCreated` y en la fila creada como una entrada de `appDetails` con `method: 'ESAVI-CATITEM-006'` — que es cómo se rastrea después de dónde salió un tipo que nadie recuerda haber creado.

---

## Lo que **no** está en este spec

- El CRUD de `catalogItem`, ya implementado, y el de `catalogType`.
- La importación masiva de `catalogType` desde su propio fichero.
- Actualizar un `catalogType` existente —`name`, `description` o `sortOrder`— desde el fichero de ítems.
- La reversión de una importación, incluida la limpieza de los tipos que fundó.
- El versionado de cargas y el histórico de importaciones.
- La detección de ítems retirados entre dos ficheros.
- La reactivación de ítems o de tipos por importación.
- Escribir `metadata` desde el importador, y por tanto cualquier marca de procedencia por fila.
- `isActive` como columna del fichero.
- La importación asíncrona con cola y consulta de progreso.
- La carga por CSV, JSON o `.asc`.
- Libros con varias hojas o con la cabecera fuera de la fila 1.
- Extraer un lector genérico de `.xlsx` compartido con el parser de F19.
- Unificar la normalización de `code` entre `catalogType` y `catalogItem`.
- El `005C` de purga física, del que `catalogItem` está excluido por ser entidad protegida.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
