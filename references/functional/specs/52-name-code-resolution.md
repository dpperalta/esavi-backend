# SPEC F52 — Resolución por nombre y código

> **Estado:** Borrador
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F50 (patrón `Op.iLike`, implementado)**
> **Fecha:** 2026-09-01
> **Objetivo:** Dar a ocho entidades la capacidad de resolverse por nombre o por código, unificar la forma del parámetro de búsqueda y corregir la falta de escape de `%` y `_` en los cuatro servicios que ya usan `Op.iLike`.

---

## 1. Por qué existe este spec

**A — Hay dos convenciones de búsqueda incompatibles, y cuatro entidades sin ninguna.** Seis entidades del repositorio admiten hoy filtro de texto, con dos formas distintas de pedirlo:

| Forma | Entidades | Origen |
|---|---|---|
| `?search=` | `diagnosticTerm`, `diluentCatalog`, `vaccineWhodrug`, `systemConfig` | anteriores al F50 |
| `?name=` + `?code=` | `geoLocation`, `healthFacility` | [SPEC F50](50-geolocation-name-code-search.md), [SPEC F51](51-healthfacility-name-code-search.md) |

Un componente de autocompletado del frontend no puede escribirse una sola vez contra esta API: tiene que saber, entidad por entidad, cómo se llama el parámetro. Y ninguna de las dos formas cubre `catalogType`, `catalogItem`, `geoLevelType`, `appRole` ni `esaviCase`, cuyos validadores de listado declaran **solo** `limit` y `offset`.

**B — Cuatro de los cinco servicios que usan `Op.iLike` no escapan la entrada del usuario.** Es un defecto verificado, no una hipótesis:

```ts
// diagnosticTerm.service.ts:35
where.name = { [Op.iLike]: `%${filters.search.trim()}%` };
```

Lo mismo en `diluentCatalog.service.ts:31`, `vaccineWhodrug.service.ts:48` y `systemConfig.service.ts:87`. En los cuatro, un `search` que contenga `_` se comporta como comodín de un carácter y uno que contenga `%` como comodín de cualquier longitud. `escapeLike` —la función que neutraliza ambos— existe en un solo sitio, `geoLocation.service.ts:91`, y es una `const` privada que nadie más puede importar. Los códigos administrativos con guion bajo son frecuentes justo en estos catálogos.

**C — `catalogItem` es la tabla de resolución del sistema y es la única que no se puede buscar.** Sus FK están por todo el esquema: `facilityTypeItemId`, `sexItemId`, `professionItemId`, `ageUnitItemId`, `previousStatusItemId`. Y sin embargo **no tiene listado global**: solo `GET /type/:id` (`catalogItem.routes.ts:17`) y `GET /admin/type/:id` (`:21`), las dos con el `catalogTypeId` **en la ruta**. Quien quiere resolver "Hospital" o "AGE_YEARS" tiene que saber antes a qué `catalogType` pertenece. Es el mismo problema estructural que el F51 §1.B describió para `healthFacility`, en la tabla que más lo sufre.

**D — Un caso no se puede encontrar por el código que lleva impreso.** `esaviCase` tiene `caseCode varchar(200) NOT NULL` con `UQ_esaviCase_caseCode` (`esaviapp.sql:689`, `:705`). Su listado admite doce filtros —paciente, establecimiento, geolocalización y tres rangos de fecha, entre el F48 y el F49— y **ninguno es el código del caso**, que es el único dato que trae el formulario en papel cuando alguien llama preguntando por un expediente.

**E — Las cuatro entidades más antiguas devuelven `sysDetails` en sus `GET`.** `catalogItem`, `catalogType`, `geoLevelType` y `geoLocation` hacen `findAndCountAll` y `findOne` sin `attributes` (`catalogItem.service.ts:140`, `catalogType.service.ts:73`, `geoLevelType.service.ts:40`, `geoLocation.service.ts:130`), así que exponen la columna interna entera. El resto del repositorio ya la excluye —`appRole`, `diagnosticTerm`, `diluentCatalog`, `esaviCase`, `classification`, `investigation` y el `003` de `healthFacility`—, y el F51 dejó la corrección anotada como pendiente. Importa aquí y no en abstracto: si el `007` de `catalogItem` nace con la forma correcta y su `002` conserva la vieja, el mismo componente de frontend recibe dos formas de fila según de qué endpoint vengan los datos.

---

## 2. Alcance

**Dentro:**

**Helper compartido**

- **Extraer `escapeLike` a `src/helpers/stringHandling.helper.ts`.** Hoy es `const` privada en `geoLocation.service.ts:91`. Se convierte en export del barril y pasa a ser de uso obligatorio en todo `Op.iLike` construido con entrada de usuario.
- **Aplicarlo en los cuatro servicios que hoy no escapan**: `diagnosticTerm`, `diluentCatalog`, `vaccineWhodrug` y `systemConfig`. Corrige el defecto de §1.B.

**Forma canónica del parámetro**

- **`name` y `code` son la forma canónica**, separados, combinados entre sí con `Op.or` y con `Op.and` frente a cualquier otro filtro. Es la semántica que fijaron el F50 y el F51 y no cambia.
- **`search` sobrevive como alias** en las cuatro entidades donde ya existe (`diagnosticTerm`, `diluentCatalog`, `vaccineWhodrug`, `systemConfig`), con el significado "coincide en el nombre **o** en el código". Ningún cliente actual se rompe.
- **El alias queda congelado.** No se añade `search` a ninguna superficie nueva.
- **Mínimo de 2 caracteres y topes máximos alineados a cada columna**, en todos los parámetros **nuevos**. Los existentes no se endurecen.

**Ampliación de listados existentes — sin rutas nuevas**

| Entidad | Código | Qué gana | Columnas del `Op.or` |
|---|---|---|---|
| `catalogType` | `002A`/`002B` | `name`, `code` | `name`; `code` |
| `geoLevelType` | `002A`/`002B` | `name`, `code` | `name`; `code` |
| `appRole` | `002A`/`002B` | `name`, `code` | `name`; `code` |
| `esaviCase` | `002A`/`002B` | **`code` únicamente** | `caseCode` |
| `diagnosticTerm` | `002A`/`002B` | `name`, `code`; `code` entra además en el `search` | `name`; `code` |
| `diluentCatalog` | `002A`/`002B` | `name`, `code`; `code` entra además en el `search` | `name`; `code` |
| `vaccineWhodrug` | `002A`/`002B` | `name`, `code`; `drugCode` entra además en el `search` | `drugName`; `drugCode` |
| `systemConfig` | `002A`/`002B` | `name`, `code` como canónicos del `search` que ya cubría ambas | `name`; `code` |

`esaviCase` recibe solo `code` porque el DDL no le da ninguna columna de nombre: `notificationOrganization` es la institución que notifica, no el caso. Un `?name=` que llegue se ignora en silencio, igual que cualquier query no declarada — se deja escrito para que no se lea como olvido.

**Endpoint nuevo — uno solo**

- **`ESAVI-CATITEM-007` — `GET /api/catalog-items/search`**, rol mínimo `USER`. Buscador global de ítems de catálogo por `name` o `code`, con **`catalogTypeId` opcional** por query que acota sin ser requisito. Declarado entre las rutas literales, antes de `GET /:id`. Los `002A`/`002B` por `/type/:id` no cambian de ruta ni de rol.
- **Guarda de criterio vacío**: sin `name` ni `code` responde `400` con la clave nueva `catalogItem.searchCriteriaRequired`. `catalogTypeId` por sí solo no es criterio — para eso ya está el `002A`.

**Alineación de la forma de respuesta — cuatro entidades**

- **`attributes: { exclude: ['sysDetails'] }` en los `002A`, `002B` y `003`** de `catalogItem`, `catalogType`, `geoLevelType` y `geoLocation`. Cierra la fuga de §1.E y deja una sola forma de fila para los componentes que consumen indistintamente el `002` y el `007`.
- Alcance acotado a la superficie `GET`. Las respuestas del `001`, `004`, `005A` y `005B` no se tocan.

**Cierre**

- **Los artefactos que toque cada cambio**, según `CONVENTIONS.md` §1: validadores, tipos de filtro, servicios, controladores y —solo para el `007`— ruta, i18n y fila en `ROUTE_RULES`.
- **Alta de `CATITEM` `007`** en la tabla de extensiones de `references/CONVENTIONS.md` §6.
- **Edición del F51**: su paso 1 (extracción de `escapeLike`) pasa a este spec, y su header pasa a declarar `Depende de: SPEC F52`.

**Fuera de alcance (otros specs, o descartado):**

- **`appUser` y `notifier`.** `firstName`, `lastName`, `email` y `address` están cifrados con `esaviCrypt` de IV fijo (`notifier.service.ts:142-145`). `Op.iLike` sobre ciphertext no coincide con nada: solo hay igualdad exacta. La salida sería el modelo de tokens del [SPEC F47](47-patient-name-model.md), que es otro spec y bastante más caro.
- **`patient`.** Ya resuelto: `006` por identificador y `search-by-name` del F45/F47.
- **`evaluationInstitution`.** `institutionName` sí está en claro, pero se entra por `/investigation/:id` y no es catálogo de resolución.
- **Las tablas satélite de `notification` e `investigation`.** Se entran por `caseId`. `notificationEvent.esaviCode`, `notificationVaccine.vaccineCode` y compañía son copias denormalizadas dentro de un caso, no catálogos consultables.
- **`healthFacility`.** Lo resuelve el F51 con su `006`. Su fuga de `sysDetails` en los `002A`/`002B` sigue siendo suya y sigue sin corregirse: este spec alinea las cuatro entidades que ya toca, no las seis.
- **Retrofit del mínimo de 2 caracteres a `geoLocation`.** Endurecería un contrato publicado: un `?name=a` que hoy responde `200` pasaría a `400`.
- **Eliminar el alias `search`.** Se evaluó en §6 y se descartó: rompe cuatro endpoints vivos por consistencia cosmética.
- **La columna `value` de `catalogItem`** en la búsqueda. Es el valor operativo del ítem —el que blinda el [SPEC F46](46-catalogitem-value-lock.md)—, no su identidad.
- **`description`, `composition` y demás texto largo** de los catálogos. Una descripción no identifica una fila.
- **Un endpoint de igualdad exacta por código**, al estilo del `GET /code/:code` de `systemConfig`, para `geoLevelType` o `diluentCatalog` —las dos con `UNIQUE` sobre `code`—. Este spec da búsqueda parcial; la resolución exacta es otra operación.
- **Tolerancia a acentos.** `Op.iLike` ignora la caja pero no la tilde. `unaccent` o columna generada son cambio de esquema. Misma limitación asumida por el F50 y el F51.
- **Ordenación por relevancia.** Cada listado conserva su `order` actual.
- **Índice de trigramas (`gin_trgm_ops`) o cualquier otro cambio de esquema.** Anotado como riesgo en §7.
- **Contrato de update diferencial.** Este spec **no escribe sobre ninguna fila**: todas sus operaciones son de lectura. No declara tabla de `candidates` ni el bloque de cinco criterios de `CONVENTIONS.md` §11, y la ausencia es deliberada.

---

## 3. Modelo de datos

**No hay tabla nueva ni columna nueva.** Las nueve entidades que este spec toca ya tienen en el DDL todas las columnas que el buscador consulta. Lo que cambia son validadores, tipos de filtro, servicios y controladores; y aparecen un helper compartido, un endpoint y una clave i18n.

### 3.1 Columnas consultadas, textuales del DDL

| Entidad | `CREATE TABLE` | Columna de nombre | Columna de código | Restricción del código |
|---|---|---|---|---|
| `catalogType` | `esaviapp.sql:198` | `name varchar(200) NOT NULL` | `code varchar(100) NOT NULL` | `UQ_catalogType_code` — global |
| `catalogItem` | `:213` | `name varchar(250) NOT NULL` | `code varchar(100) NOT NULL` | `UQ_catalogItem_type_code` — **compuesta con `catalogTypeId`** |
| `appRole` | `:270` | `name varchar(200) NOT NULL` | `code varchar(100) NOT NULL` | `UQ_appRole_code` — global |
| `geoLevelType` | `:431` | `name varchar(150) NOT NULL` | `code varchar(100) NOT NULL UNIQUE` | global, inline |
| `diagnosticTerm` | `:584` | `name varchar(500) NOT NULL` | `code varchar(100)` (nulable) | `UQ_diagnosticTerm_source_code` |
| `vaccineWhodrug` | `:600` | `drugName text NOT NULL` | `drugCode varchar(250)` (nulable) | ninguna — el fichero repite `drugCode` por diseño |
| `diluentCatalog` | `:642` | `name varchar(250) NOT NULL` | `code varchar(100) UNIQUE` (nulable) | global |
| `esaviCase` | `:685` | — no tiene | `caseCode varchar(200) NOT NULL` | `UQ_esaviCase_caseCode` — global |
| `systemConfig` | `:362` | `name varchar(200) NOT NULL` | `code varchar(150) NOT NULL` | `UQ_systemConfig_code_scope` |

Dos consecuencias que son regla de negocio y no detalle:

- **`catalogItem.code` no es único globalmente.** La restricción es `(catalogTypeId, code)`, así que una búsqueda nacional por `code=ACTIVE` puede devolver legítimamente varias filas de tipos distintos. El `007` no es un resolvedor de uno: devuelve `{ count, rows }` como cualquier listado.
- **`vaccineWhodrug.drugCode` se repite por diseño** —una fila por presentación de país—, y el propio DDL lo comenta. Buscar por él devuelve N filas y eso es correcto.

Las cuatro columnas transversales (`isActive`, `deletedAt`, `sysDetails`, `appDetails`) no se tocan en ninguna entidad. `sysDetails` cambia de visibilidad, no de contenido — §3.8.

### 3.2 Helpers nuevos

**`escapeLike`** se extrae de `geoLocation.service.ts:91` a `src/helpers/stringHandling.helper.ts`, junto a `normalizeName` y `toSearchForm`:

```ts
export const escapeLike = (value: string): string => value.replace(/[%_]/g, '\\$&');
```

`src/helpers/index.ts:16` ya reexporta ese módulo con `export *`, así que para `escapeLike` **el barril no se edita**. Es la misma extracción que el F47 hizo con `normalizeName` cuando apareció un segundo consumidor; aquí aparecen ocho.

**`buildTextSearchConditions`** es archivo nuevo — `src/helpers/searchConditions.helper.ts` — porque necesita importar `Op` de Sequelize y `stringHandling.helper.ts` es de manipulación de cadenas, sin dependencia de ORM:

```ts
export const buildTextSearchConditions = (value: string | undefined, columns: string[]): any[] => { … }
```

Devuelve un array de condiciones `{ <columna>: { [Op.iLike]: '%valor%' } }`, ya escapado, o vacío si `value` no llegó. Los nueve servicios lo invocan una vez por `name` y otra por `code`, concatenan los dos arrays y los asignan a `whereClause[Op.or]`. **Este archivo sí se da de alta en `src/helpers/index.ts`**, con una línea `export * from './searchConditions.helper';`.

La alternativa —que cada servicio repita las seis líneas del F50— se descarta en §6: nueve copias de una construcción de `where` que hoy ya está mal en cuatro sitios es exactamente cómo se llegó al defecto de §1.B.

### 3.3 Validadores — Antes / Después

Cada entidad amplía **su** validador de listado ya existente. Ninguno se reescribe.

| Validador | Antes | Después |
|---|---|---|
| `catalogTypeListValidator` | `limit`, `offset` | + `name` (2–200), `code` (2–100) |
| `catalogItemListValidator` | `limit`, `offset` | sin cambios — el `007` compone su propio validador |
| `appRoleListValidator` | `limit`, `offset` | + `name` (2–200), `code` (2–100) |
| `geoLevelTypeListValidator` | `limit`, `offset` | + `name` (2–150), `code` (2–100) |
| `esaviCaseListValidator` | 12 filtros | + `code` (2–200) |
| `diagnosticTermListValidator` | `search` (2–500), `source`, `termGroup`, `reviewStatus` | + `name` (2–500), `code` (2–100) |
| `diluentCatalogListValidator` | `search` (2–500) | + `name` (2–250), `code` (2–100) |
| `vaccineWhodrugListValidator` | `search` (2–500), 4 filtros | + `name` (2–500), `code` (2–250) |
| `systemConfigListValidator` | `search` (2–500), `scope`, `valueType` | + `name` (2–200), `code` (2–150) |

Forma canónica de los dos `query()` nuevos, idéntica en las nueve:

```ts
query('name').optional().trim()
    .isLength({ min: 2 }).withMessage('Name must be at least 2 characters long')
    .isLength({ max: <ancho de la columna> }).withMessage('Name must be at most <N> characters long'),
query('code').optional().trim()
    .isLength({ min: 2 }).withMessage('Code must be at least 2 characters long')
    .isLength({ max: <ancho de la columna> }).withMessage('Code must be at most <N> characters long'),
```

El tope de cada uno replica el `varchar` de su columna. Las dos excepciones: `vaccineWhodrug.name` topa en 500 —`drugName` es `text`, sin ancho, y 500 es lo que ya usa su `search`— y `esaviCase` no declara `name`.

Los `search` existentes **no se tocan**: conservan su `min: 2` y su `max: 500`.

### 3.4 Tipos de filtro — Antes / Después

Cada interfaz de filtros gana los mismos dos campos opcionales, en `src/types/<dominio>/<entidad>.types.ts`:

```ts
export interface DiluentCatalogListFilters {
    search?: string;   // alias legado: nombre O código
    name?: string;     // nuevo
    code?: string;     // nuevo
}
```

`esaviCase` gana solo `code`. `catalogType`, `geoLevelType` y `appRole` no tienen hoy interfaz de filtros —sus servicios reciben `limit` y `offset` sueltos—, así que se les crea una: `CatalogTypeListFilters`, `GeoLevelTypeListFilters` y `AppRoleListFilters`, cada una con `name?` y `code?`. Es lo que evita que sus firmas crezcan a cuatro parámetros posicionales.

### 3.5 Servicios — patrón único

Los dos servicios de listado de cada entidad (`002A` y `002B`) construyen el bloque de texto igual:

```ts
const textConditions = [
    ...buildTextSearchConditions(filters.name ?? filters.search, ['name']),
    ...buildTextSearchConditions(filters.code ?? filters.search, ['code'])
];
if( textConditions.length > 0 ) {
    whereClause[Op.or] = textConditions;
}
```

Cuatro reglas que valen para las nueve entidades:

- **`name` y `code` se unen entre sí con `Op.or`.** Coincide con uno u otro; nunca se exigen los dos. Es la semántica del F50 y del F51.
- **El bloque de texto se une con `Op.and` a todo lo demás** — `isActive`, `catalogTypeId`, `scope`, `source`, los rangos de fecha de `esaviCase`. Son ejes distintos: ubicación, estado y tiempo no son identidad.
- **Un filtro ausente no filtra.** Sin `name`, `code` ni `search`, el listado devuelve exactamente lo que devolvía antes de este spec. Ninguna condición se construye sobre `%%`.
- **El alias resuelve a los dos lados.** `search` alimenta la columna de nombre y la de código a la vez; `name` y `code` explícitos ganan sobre él cuando llegan. En `vaccineWhodrug` las columnas son `drugName` y `drugCode`; el nombre del parámetro sigue siendo `name` y `code`.

El `order` de cada listado no cambia: `sortOrder ASC` donde ya lo era, `name ASC` donde ya lo era, y los dos criterios de los `002B` de `catalogType`, `catalogItem` y `geoLevelType` se conservan tal cual.

### 3.6 `ESAVI-CATITEM-007` — el único endpoint nuevo

**Tipo**, en `src/types/catalogItem/catalogItem.types.ts`:

```ts
export interface CatalogItemSearchInput {
    name?: string;
    code?: string;
    catalogTypeId?: string;
}
```

**Validador**, export nuevo en `src/validators/catalogItem.validator.ts`. `catalogItemListValidator` no se modifica: los dos se componen en la ruta.

```ts
export const searchCatalogItemValidator = [ /* name 2–250, code 2–100, catalogTypeId isUUID */ ];
```

**Servicio**, en `src/services/catalogItem.service.ts`. No se modifican `getActiveCatalogItemsByTypeService` ni `getAllCatalogItemsByTypeService`.

```ts
// ESAVI-CATITEM-007 - Search Catalog Items by Name or Code Service
const searchCatalogItemsService = async (
    filters: CatalogItemSearchInput,
    lang: string,
    includeInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => { … }
```

Guarda de criterio, antes de construir nada: sin `name` ni `code` lanza `AppError` con `getMessage('catalogItem.searchCriteriaRequired', lang)`, `400`, `CATITEM_007_SEARCH_CRITERIA_REQUIRED`. Vive en el servicio además de en el validador porque `optional()` no sabe expresar "al menos uno de los dos" — misma razón que el `007` de `patient` y el `006` de `healthFacility`.

El `where` resultante es `(name ILIKE p OR code ILIKE q) AND catalogTypeId = z AND isActive = true`, con las dos últimas condiciones solo cuando aplican. La consulta lleva `attributes: { exclude: ['sysDetails'] }`, `include` de `catalogType` con `catalogTypeId` y `name` sin `required`, `order: [['sortOrder', 'ASC'], ['name', 'ASC']]` —el de su `002B`— y `findAndCountAll`.

**Controlador**, en `src/controllers/catalogItem.controller.ts`: lee los tres valores de `req.query`, pasa `canViewInactive(req.user as AuthUser)` y no importa ningún modelo. El `catch` sigue el idioma del repositorio, con `CATITEM_007_SEARCH_FAILED`.

**Ruta**, en `src/routes/catalogItem.routes.ts`, declarada **entre las literales y antes de `GET /:id`** (`catalogItem.routes.ts:32`), junto a `/type/:id`, `/admin/type/:id` e `/import`:

```ts
// Search Catalog Items by Name or Code
// Code: ESAVI-CATITEM-007
router.get('/search', tokenValidation, validateUserRole(USER), ...searchCatalogItemValidator, ...catalogItemListValidator, validateFields, searchCatalogItems);
```

### 3.7 Superficie HTTP

```
GET /api/catalog-items/search?name=&code=&catalogTypeId=&limit=&offset=   ESAVI-CATITEM-007   USER   (nuevo)

GET /api/catalog-types?name=&code=                                        ESAVI-CATTYPE-002   USER   (existe, se amplía)
GET /api/geo-level-types?name=&code=                                      ESAVI-GEOTYPE-002   USER   (existe, se amplía)
GET /api/app-roles?name=&code=                                            ESAVI-APPROLE-002A  USER   (existe, se amplía)
GET /api/app-roles/admin?name=&code=                                      ESAVI-APPROLE-002B  ADMIN  (existe, se amplía)
GET /api/esavi-cases?code=                                                ESAVI-CASE-002A     USER   (existe, se amplía)
GET /api/esavi-cases/admin?code=                                          ESAVI-CASE-002B     ADMIN  (existe, se amplía)
GET /api/diagnostic-terms?name=&code=&search=                             ESAVI-DIAGTERM-002A USER   (existe, se amplía)
GET /api/diluent-catalogs?name=&code=&search=                             ESAVI-DILUENT-002A  USER   (existe, se amplía)
GET /api/vaccine-whodrugs?name=&code=&search=                             ESAVI-WHODRUG-002A  USER   (existe, se amplía)
GET /api/system-configs?name=&code=&search=                               ESAVI-SYSCONF-002A  USER   (existe, se amplía)
```

Los `/admin` de las cuatro últimas se amplían igual y no se listan por brevedad; ninguna cambia de ruta, de rol ni de código.

**Fila nueva en `ROUTE_RULES`** (`tests/auth/roles.test.ts`), la única que este spec añade:

```ts
{ method: 'get',    path: '/api/catalog-items/search',                      minRole: 'USER',       code: 'ESAVI-CATITEM-007' },
```

**Alta en la tabla de extensiones de `references/CONVENTIONS.md` §6:**

```markdown
| catalogItem | `007` | búsqueda global por nombre o código — `Op.iLike` sobre `name` y `code`, con `catalogTypeId` opcional. `GET /search`, USER |
```

### 3.8 Alineación de `sysDetails`

| Servicio | Operaciones | Antes | Después |
|---|---|---|---|
| `catalogItem.service.ts` | `002A` `:140`, `002B` `:159`, `003` `:175` | fila completa | `attributes: { exclude: ['sysDetails'] }` |
| `catalogType.service.ts` | `002A` `:73`, `002B` `:85`, `003` `:98` | fila completa | ídem |
| `geoLevelType.service.ts` | `002A` `:40`, `002B` `:51`, `003` `:64` | fila completa | ídem |
| `geoLocation.service.ts` | `002A` `:130`, `002B`, `003` | fila completa | ídem |

Es el patrón que ya siguen `appRole` (`LIST_EXCLUDE`, `appRole.service.ts:11`), `diagnosticTerm`, `diluentCatalog`, `esaviCase`, `classification`, `investigation` y el `003` de `healthFacility`. **Ningún test de contrato lee `sysDetails` de una respuesta HTTP en estas cuatro entidades** — se verificó: `catalogItem.test.ts:612` lo compara leyendo la fila de la base con `readRow`, no del body. `appDetails` sigue viajando.

### 3.9 Claves i18n nuevas

Una sola, en `es.json`, `en.json` y `nl.json`:

| Clave | `es` | `en` | `nl` |
|---|---|---|---|
| `catalogItem.searchCriteriaRequired` | "Debe indicar un nombre o un código para buscar" | "A name or a code is required to search" | "Een naam of een code is vereist om te zoeken" |

Todo lo demás reutiliza las claves que cada entidad ya tiene: los listados ampliados siguen resolviendo con su `getSuccessPlural` / `getFailedPlural`, y el `007` usa las de `catalogItem`, que no cambian de significado por servir también a un buscador.

### 3.10 Forma de la respuesta

Sin cambios de estructura en ningún sitio: sigue siendo el sobre `{ ok, message, data }` con `data` = `{ count, rows }` de `findAndCountAll`. `count` es el total de coincidencias, no el tamaño de la página.

Cambian dos cosas en el contenido de las filas, las dos para converger:

- **Desaparece `sysDetails`** en los `GET` de las cuatro entidades de §3.8.
- **El `007` embebe `catalogType`** con exactamente `catalogTypeId` y `name`. Es aditivo: un componente que no lo lea funciona igual.

Un resultado vacío es `200` con `count: 0`. **Nunca `404`**: un buscador solo puede afirmar que no encontró, no que no existe.

---

## 4. Plan de implementación

Veintisiete pasos. Cada uno toca **una entidad y un asunto**, deja el proyecto compilando y se puede committear y revertir solo. Los pasos de corrección (3 a 10) van antes que toda ampliación.

**Base — helpers compartidos**

1. **Extraer `escapeLike` al helper compartido.** Añadir el export a `src/helpers/stringHandling.helper.ts` con la firma de §3.2, borrar la `const` local de `geoLocation.service.ts:91` y sustituirla por el import del barril. `src/helpers/index.ts` no se toca: su línea 16 ya reexporta el módulo con `export *`.
   *Verificación:* `npm run build` en 0; `grep -rn "escapeLike" src/` devuelve **una sola definición**; `GET /api/geo-locations?code=A_B` se comporta como antes.

2. **Crear `src/helpers/searchConditions.helper.ts`** con `buildTextSearchConditions(value, columns)`, y darlo de alta en `src/helpers/index.ts` con `export * from './searchConditions.helper';`.
   *Verificación:* `('quito', ['name'])` devuelve una condición con patrón `%quito%`; `('A_B', ['code'])` devuelve el guion bajo escapado; `(undefined, ['name'])` devuelve `[]`.

**Corrección — el escape que falta (§1.B)**

En los cuatro pasos siguientes el `search` conserva **las mismas columnas que hoy**. Lo único que cambia es que la entrada se escapa.

3. **`diagnosticTerm`.** Sustituir la construcción manual de `diagnosticTerm.service.ts:35` por `buildTextSearchConditions`.
   *Verificación:* `GET /api/diagnostic-terms?search=A_B` deja de tratar el `_` como comodín; `?search=%` deja de volcar el catálogo; `tests/contract/diagnosticTerm.test.ts` pasa sin editarse.

4. **`diluentCatalog`.** Ídem sobre `diluentCatalog.service.ts:31`.
   *Verificación:* la misma, sobre `/api/diluent-catalogs`.

5. **`vaccineWhodrug`.** Ídem sobre `vaccineWhodrug.service.ts:48`.
   *Verificación:* la misma, sobre `/api/vaccine-whodrugs`.

6. **`systemConfig`.** Ídem sobre `systemConfig.service.ts:87`, que construye un `Op.or` de dos columnas.
   *Verificación:* la misma, sobre `/api/system-configs`, comprobando que el escape aplica a las dos columnas del `Op.or`.

**Corrección — la fuga de `sysDetails` (§1.E)**

7. **`catalogItem`.** `attributes: { exclude: ['sysDetails'] }` en `002A` (`:140`), `002B` (`:159`) y `003` (`:175`).
   *Verificación:* ninguna fila de esos tres endpoints trae `sysDetails`; `appDetails` sigue viajando; `npm test` pasa sin editar la suite — `catalogItem.test.ts:612` lee la fila con `readRow`, no del body.

8. **`catalogType`.** Ídem en `002A` (`:73`), `002B` (`:85`) y `003` (`:98`).
   *Verificación:* la misma, sobre `/api/catalog-types`.

9. **`geoLevelType`.** Ídem en `002A` (`:40`), `002B` (`:51`) y `003` (`:64`).
   *Verificación:* la misma, sobre `/api/geo-level-types`.

10. **`geoLocation`.** Ídem en `002A` (`:130`), `002B` y `003`.
    *Verificación:* la misma, sobre `/api/geo-locations`; los filtros `name` y `code` del F50 siguen respondiendo igual.

**Base — i18n**

11. **Clave `catalogItem.searchCriteriaRequired`** en `es.json`, `en.json` y `nl.json` con los textos de §3.9.
    *Verificación:* `npm run i18n:check` en 0; `tests/i18n/messages.test.ts` pasa.

**Ampliación — las cuatro entidades que ya tienen `search`**

Cada paso añade `name` y `code` al validador y a la interfaz de filtros, y hace que el servicio arme el `Op.or` con `filters.name ?? filters.search` sobre la columna de nombre y `filters.code ?? filters.search` sobre la de código.

12. **`diagnosticTerm`** — `name` (2–500) sobre `name`, `code` (2–100) sobre `code`.
    *Verificación:* `?code=X` devuelve filas cuyo `code` lo contiene; `?search=X` cubre ahora también el código; `?name=X&code=Y` devuelve la unión; sin parámetros, resultado idéntico al del paso 3.

13. **`diluentCatalog`** — `name` (2–250), `code` (2–100).
    *Verificación:* la misma, sobre `/api/diluent-catalogs`.

14. **`vaccineWhodrug`** — `name` (2–500) sobre `drugName`, `code` (2–250) sobre `drugCode`.
    *Verificación:* la misma; además `?search=` devuelve ahora filas que solo coinciden por `drugCode`, que es el cambio de significado declarado en §8.

15. **`systemConfig`** — `name` (2–200), `code` (2–150). Su `search` ya cubría las dos columnas, así que aquí solo se añaden los canónicos.
    *Verificación:* `?name=` y `?code=` filtran por separado; `?search=` devuelve exactamente lo mismo que antes del paso.

**Ampliación — las cuatro entidades sin ningún filtro de texto**

16. **`catalogType`** — crear `CatalogTypeListFilters`, añadir `name` (2–200) y `code` (2–100) al validador, cambiar la firma de sus dos servicios de listado para que reciban el objeto de filtros y actualizar el controlador.
    *Verificación:* `GET /api/catalog-types?name=vacuna` devuelve solo coincidencias; el `order` por `sortOrder` no cambia; un `USER` sigue sin ver inactivos en el `002A`.

17. **`geoLevelType`** — ídem, con `name` (2–150) y `code` (2–100).
    *Verificación:* la misma, sobre `/api/geo-level-types`.

18. **`appRole`** — ídem, con `name` (2–200) y `code` (2–100). Su `LIST_EXCLUDE` (`appRole.service.ts:11`) ya está bien y no se toca.
    *Verificación:* la misma, sobre `/api/app-roles` y `/api/app-roles/admin`.

19. **`esaviCase`** — añadir **solo** `code` (2–200) al validador y a `EsaviCaseListFilters`, con `Op.iLike` sobre `caseCode` en los dos servicios de listado. `name` no se declara.
    *Verificación:* `?code=2026` devuelve los casos cuyo `caseCode` lo contiene; combinado con `?reportDateFrom=` los dos se aplican con `Op.and`; los doce filtros existentes siguen funcionando.

**Endpoint nuevo — `ESAVI-CATITEM-007`**

20. **Tipo y validador.** `CatalogItemSearchInput` en `src/types/catalogItem/catalogItem.types.ts` y `searchCatalogItemValidator` en `src/validators/catalogItem.validator.ts`. `catalogItemListValidator` no se modifica.
    *Verificación:* `npm run build` y `npm run lint` en 0.

21. **Servicio `searchCatalogItemsService`.** Guarda de criterio, `where` de §3.6, `attributes: { exclude: ['sysDetails'] }`, `include` de `catalogType` sin `required`, orden `sortOrder ASC, name ASC` y `findAndCountAll`. Los dos servicios de listado por tipo no se tocan.
    *Verificación:* con `{ name: 'hospital' }` devuelve ítems de **cualquier** tipo; con `{}` lanza 400 con `CATITEM_007_SEARCH_CRITERIA_REQUIRED`; con `includeInactive: false` ninguna fila tiene `isActive: false`; ninguna fila trae `sysDetails`.

22. **Controlador y ruta.** Handler `searchCatalogItems` con `canViewInactive` y el `catch` del idioma del repositorio (`CATITEM_007_SEARCH_FAILED`); `router.get('/search', …)` declarada **antes** de `GET /:id` (`catalogItem.routes.ts:32`).
    *Verificación:* `GET /api/catalog-items/search?name=ho` con token `USER` responde `200` y **no** `400 Catalog Item ID must be a valid UUID`; `GET /api/catalog-items/<uuid>` sigue resolviendo el `003`; `grep -n "from '../models" src/controllers/catalogItem.controller.ts` devuelve vacío.

**Pruebas**

23. **`ROUTE_RULES` y contrato del `007`.** Fila nueva en `tests/auth/roles.test.ts` con el path y el código de §3.7; en `tests/contract/catalogItem.test.ts`: búsqueda sin `catalogTypeId`, con `catalogTypeId`, guarda de criterio → `400`, `USER` sin inactivos frente a `ADMIN` con inactivos, `_` literal, `count: 0` sin coincidencias, y `catalogType` embebido con dos campos.
    *Verificación:* `tests/auth/roles.test.ts` pasa con la fila nueva.

24. **Contrato de las cuatro con `search`.** Casos nuevos en las suites de `diagnosticTerm`, `diluentCatalog`, `vaccineWhodrug` y `systemConfig`: coincidencia por `name`, por `code`, los dos como disyunción, `search` cubriendo ambas columnas, mínimo de dos caracteres, y `_` literal que no actúa de comodín.
    *Verificación:* las cuatro suites pasan.

25. **Contrato de las cuatro sin filtro previo.** Casos equivalentes en `catalogType`, `geoLevelType`, `appRole` y `esaviCase` — en esta última, solo `code` y su conjunción con un filtro de fecha.
    *Verificación:* las cuatro suites pasan.

26. **Contrato de la alineación de `sysDetails`.** Un caso por entidad en `catalogItem`, `catalogType`, `geoLevelType` y `geoLocation`: ninguna fila del `002A`, `002B` ni `003` contiene `sysDetails`, y `appDetails` sí.
    *Verificación:* `npm run check` en 0.

**Documentación**

27. **Cerrar la documentación.** Tres ediciones fuera de `src/`: alta de la fila `catalogItem | 007` en `references/CONVENTIONS.md` §6; en el F51, su paso 1 pasa a este spec y su header declara `Depende de: SPEC F52`; en el F50, su bloque final deja de dar `geoLevelType` por pendiente y apunta aquí.
    *Verificación:* `grep -n "CATITEM | \`007\`" references/CONVENTIONS.md` devuelve la fila; `grep -n "52-" references/functional/specs/50-*.md references/functional/specs/51-*.md` devuelve los dos enlaces.

**Notas de orden.** Los pasos 1 y 2 van antes que todos: del 3 al 22 nada compila sin los helpers. Del 3 al 10 son ocho correcciones independientes entre sí, en cualquier orden. Del 12 al 19 son ocho ampliaciones independientes entre sí; cada una necesita hecho su paso de corrección correspondiente cuando lo tiene (3→12, 4→13, 5→14, 6→15, 7→21). El 21 va después del 11 por la clave i18n y el 22 después del 21. Del 23 al 26, cada paso de pruebas puede ir inmediatamente después de la ampliación que verifica, si prefieres commits más cerrados.

**Lo que el plan no incluye.** Ningún paso de migración o esquema. Ningún paso para eliminar el alias `search`, retrofitar el mínimo de dos caracteres a `geoLocation` o corregir la fuga de `sysDetails` de `healthFacility` — los tres fuera de alcance por §2.

---

## 5. Criterios de aceptación

**Escape de comodines — la corrección de §1.B**

- [ ] `?search=A_B` en `/api/diagnostic-terms`, `/api/diluent-catalogs`, `/api/vaccine-whodrugs` y `/api/system-configs` trata el `_` como carácter literal y no como comodín de un carácter.
- [ ] `?search=%` en las cuatro rutas **no** devuelve el catálogo entero.
- [ ] `grep -rn "Op.iLike" src/services/` no devuelve ninguna interpolación de una variable sin pasar por `buildTextSearchConditions`.
- [ ] `grep -rn "escapeLike" src/` devuelve una sola definición, en `stringHandling.helper.ts`.

**Fuga de `sysDetails` — la corrección de §1.E**

- [ ] Ninguna fila de los `002A`, `002B` y `003` de `catalogItem`, `catalogType`, `geoLevelType` y `geoLocation` contiene `sysDetails`.
- [ ] Esas mismas respuestas siguen trayendo `appDetails`.
- [ ] Las respuestas de `001`, `004`, `005A` y `005B` de esas cuatro entidades no cambian.

**Coincidencia de texto**

- [ ] `?name=X` devuelve las filas cuyo nombre contiene `X`, sin distinguir mayúsculas, en `catalogType`, `catalogItem` (vía `007`), `geoLevelType`, `appRole`, `diagnosticTerm`, `diluentCatalog`, `vaccineWhodrug` y `systemConfig`.
- [ ] `?code=X` devuelve las filas cuyo código contiene `X`, sin distinguir mayúsculas, en las ocho anteriores **y** en `esaviCase` sobre `caseCode`.
- [ ] En `vaccineWhodrug`, `?name=` consulta `drugName` y `?code=` consulta `drugCode`.
- [ ] Una coincidencia parcial en medio de la cadena cuenta: `?name=vacun` encuentra "Tipo De Vacuna".
- [ ] `?code=ACTIVE` en `/api/catalog-items/search` devuelve filas de **más de un** `catalogType` cuando existen, porque `UQ_catalogItem_type_code` es compuesta.

**Alias `search`**

- [ ] `?search=X` en `diagnosticTerm`, `diluentCatalog` y `vaccineWhodrug` devuelve ahora también las filas que coinciden **solo** por su columna de código.
- [ ] `?search=X` en `systemConfig` devuelve exactamente lo mismo que antes de este spec.
- [ ] `?name=X&search=Y` aplica `X` sobre la columna de nombre: el canónico gana sobre el alias.
- [ ] `search` **no** existe como parámetro en `catalogType`, `geoLevelType`, `appRole`, `esaviCase` ni en el `007` de `catalogItem`.

**Combinación de filtros**

- [ ] `?name=X&code=Y` devuelve las filas que coinciden con `X` **o** con `Y` — nunca exige las dos.
- [ ] `?name=X` combinado con un filtro no textual (`?source=`, `?scope=`, `?catalogTypeId=`, `?reportDateFrom=`) se aplica con `Op.and`.
- [ ] `GET /api/esavi-cases?code=X&reportDateFrom=Y` devuelve solo casos que cumplen las dos condiciones.
- [ ] Ningún listado devuelve resultados distintos a los de antes del spec cuando no se le pasa `name`, `code` ni `search`.

**Guardas y validación**

- [ ] `?name=a` o `?code=a` (un carácter) responde `400` en todo parámetro **nuevo**; `?name=ab` responde `200`.
- [ ] `GET /api/geo-locations?name=a` sigue respondiendo `200`: el mínimo no se retrofita al F50.
- [ ] Cada parámetro nuevo responde `400` al superar el tope de su columna, según la tabla de §3.3.
- [ ] Un valor con `_` literal no se comporta como comodín en ninguna de las nueve entidades.
- [ ] Un valor con `%` literal no devuelve la tabla entera en ninguna de las nueve.

**`ESAVI-CATITEM-007`**

- [ ] `GET /api/catalog-items/search?name=X` devuelve ítems sin exigir `catalogTypeId`.
- [ ] `?name=X&catalogTypeId=Z` devuelve solo ítems que coinciden con `X` **y** pertenecen a `Z`.
- [ ] `?catalogTypeId=Z` como único parámetro responde `400` con la clave `catalogItem.searchCriteriaRequired`: acotar no es buscar.
- [ ] `GET /api/catalog-items/search` sin ningún parámetro responde `400` con la misma clave.
- [ ] `?catalogTypeId=` con un UUID inexistente responde `200` con `count: 0`, nunca `404`.
- [ ] `?catalogTypeId=noEsUnUuid` responde `400`.
- [ ] `GET /api/catalog-items/<uuid>` sigue resolviendo el `003` y no es capturado por `/search`.
- [ ] Cada fila trae `catalogType` con exactamente `catalogTypeId` y `name`.
- [ ] Las filas vienen ordenadas por `sortOrder` ascendente y, a igualdad, por `name` ascendente.
- [ ] La clave `catalogItem.searchCriteriaRequired` existe en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.

**Autorización y visibilidad**

- [ ] Sin token, `/api/catalog-items/search` responde `401`; un `ANALYTICS` (nivel 10) responde `403`.
- [ ] Un `USER` no ve ninguna fila con `isActive: false` en ningún `002A` ni en el `007`.
- [ ] Un `ADMIN` y un `SUPERADMIN` ven también las inactivas, con los mismos filtros de texto aplicados.
- [ ] Ningún endpoint cambia su rol mínimo respecto de antes del spec.
- [ ] `tests/auth/roles.test.ts` pasa con la fila nueva `ESAVI-CATITEM-007` en `ROUTE_RULES`.

**Forma de la respuesta**

- [ ] Toda respuesta sigue el sobre `{ ok, message, data }` con `message` resuelto por `getMessage(key, req.lang)`.
- [ ] `data` es `{ count, rows }` de `findAndCountAll`, y `count` es el total de coincidencias, no el tamaño de la página.
- [ ] Un filtro que no coincide con ninguna fila responde `200` con `count: 0`, nunca `404`, en las nueve entidades.
- [ ] `?limit=` y `?offset=` siguen paginando con el tope de 100 de cada validador de listado.

**Escrituras — no hay ninguna**

- [ ] Ninguna operación de este spec modifica una fila: tras cualquier búsqueda, el `updatedAt`, el `appDetails` y el `sysDetails` de toda fila devuelta son idénticos a los de antes de la petición.
- [ ] Ningún servicio nuevo o modificado invoca `update`, `create`, `destroy` ni `buildDifferentialUpdate`. **Este spec no declara contrato de update diferencial porque ninguna de sus operaciones escribe sobre una fila existente** — la ausencia de la tabla de `candidates` de `CONVENTIONS.md` §11 y del bloque de cinco criterios es deliberada, no un olvido.

**No regresión**

- [ ] Los `002` de las nueve entidades, invocados sin ningún parámetro de texto, devuelven exactamente lo mismo que antes del spec — salvo la desaparición de `sysDetails` en las cuatro alineadas, que es el cambio declarado en §8.
- [ ] `GET /api/geo-locations?name=&code=` sigue comportándose como lo dejó el F50: la extracción de `escapeLike` del paso 1 no cambia ningún comportamiento.
- [ ] Ningún endpoint existente cambia de ruta ni de código de operación.
- [ ] `src/helpers/index.ts` gana exactamente una línea, la de `searchConditions.helper`.
- [ ] `references/CONVENTIONS.md` §6 lista la fila `catalogItem | 007`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

### La decisión central — un canónico nuevo con alias, no una migración

Se evaluaron tres formas de resolver la duplicidad de §1.A y se midió qué rompía cada una.

| | (a) `name`/`code` canónico, `search` como alias — **elegida** | (b) `name`/`code` canónico, `search` eliminado | (c) `search` canónico, `name`/`code` como alias |
|---|---|---|---|
| Endpoints rotos | 0 | 4 | 2 (`geoLocation`, `healthFacility`) |
| Specs contradichos | 0 | 0 | F50 (implementado) y F51 (aprobado) |
| Nombres para lo mismo | 2, congelado | 1 | 2, congelado |
| Aviso a frontend | no | sí | sí |

**(b) deja la API más limpia y aun así se descartó.** Rompe cuatro contratos vivos por una consistencia que es cosmética: `search` y `name`+`code` no significan cosas distintas, se escriben distinto. **(c) se descartó de entrada**: obliga a rehacer un spec implementado y otro aprobado, y el F50 §6 ya razonó por qué `name` y `code` van separados — "no hay pérdida de procedencia del token que fuerce a unificarlos".

El precio de (a) está declarado: la API queda con dos nombres para el mismo filtro. Se acota **congelando el alias** — `search` no aparece en ninguna superficie nueva, así que el conjunto de entidades que lo aceptan queda fijo en cuatro y no crece nunca.

### Lo demás

- **Sí:** un solo spec para nueve entidades. La alternativa —nueve specs pequeños— parecía más manejable, pero ninguno de ellos podía tomar la decisión que de verdad importa: cuál es la forma canónica del parámetro. Un spec por entidad habría perpetuado la duplicidad entidad por entidad.
- **Sí:** corregir el escape de `%` y `_` aquí, aunque sea un defecto preexistente y no lo pidiera nadie. Este spec multiplica por nueve los consumidores de `Op.iLike`; propagar la construcción sin escapar a nueve entidades más es exactamente cómo se llegó a tener el defecto en cuatro.
- **Sí:** `buildTextSearchConditions` como helper compartido en archivo propio. La alternativa —repetir las seis líneas del F50 en nueve servicios— se descartó por lo mismo: es la forma en que un defecto se copia. Va en `searchConditions.helper.ts` y no en `stringHandling.helper.ts` porque necesita importar `Op` de Sequelize, y ese archivo es de manipulación de cadenas, sin dependencia de ORM.
- **Sí:** `escapeLike` extraído en este spec y no en el F51. El F51 lo había reclamado como su paso 1, pero el F52 toca cinco servicios que hoy no escapan nada: el helper compartido es más suyo. El F51 pasa a depender de éste, y así ninguno queda bloqueado por el otro.
- **Sí:** las ocho entidades entran, `appRole` incluida. Su valor es bajo —la tabla se pagina entera en una petición— pero el coste es el mismo que el de `catalogType` y dejarla fuera obligaba a explicar por qué el mismo catálogo se busca en unos sitios y no en otros.
- **Sí:** `catalogItem` con endpoint propio (`007`) y no con filtros en su `002`. Es la misma decisión que tomó el F51 §6 para `healthFacility` y por la misma razón: sus dos listados exigen el `catalogTypeId` **en la ruta**, así que añadirles filtros de texto no produce un buscador, produce un filtro dentro de una lista que ya hay que saber pedir.
- **Sí:** `catalogTypeId` opcional en el `007`. Da la acotación a quien la tiene sin convertirla en el requisito que hace inútil al `002` como buscador.
- **Sí:** `400` cuando al `007` no le llega ni `name` ni `code`, con la guarda duplicada en validador y servicio. Un `/search` sin criterio vuelca la tabla, y `optional()` no sabe expresar "al menos uno de los dos". Misma solución que el `007` de `patient` y el `006` de `healthFacility`.
- **Sí:** los listados ampliados **no** llevan esa guarda. Ahí un filtro ausente simplemente no filtra, que es el comportamiento que ya tenían; exigir criterio rompería a todo cliente que hoy pagina el catálogo entero.
- **Sí:** `esaviCase` recibe solo `code`. El DDL no le da ninguna columna de nombre — `notificationOrganization` es la institución que notifica, no el caso — y un `name` inventado sobre esa columna devolvería coincidencias por institución cuando el usuario cree estar buscando un caso.
- **Sí:** un `?name=` en `esaviCase` se ignora en silencio en vez de responder `400`. Es lo que ya hace `express-validator` con cualquier query no declarada, y responder `400` obligaría a declarar el parámetro solo para rechazarlo.
- **Sí:** mínimo de dos caracteres en todo parámetro nuevo. El `Op.iLike` con comodín inicial no usa índice, así que una letra recorre la tabla entera para devolver una página de ruido. Es lo que ya imponen las cuatro entidades con `search`.
- **No:** retrofitar ese mínimo a `geoLocation`. Endurece un contrato publicado: un `?name=a` que hoy responde `200` pasaría a `400`. La asimetría queda declarada y es preferible a romper un cliente por una mejora marginal.
- **Sí:** alinear `sysDetails` en las cuatro entidades que este spec ya toca. Es lo que hace cierta la promesa de que el `002` y el `007` alimentan el mismo componente de frontend, y `excluir` es además el patrón mayoritario del repositorio — lo siguen `appRole`, `diagnosticTerm`, `diluentCatalog`, `esaviCase`, `classification`, `investigation` y el `003` de `healthFacility`. Se verificó antes de decidirlo que ninguna suite lee `sysDetails` de una respuesta HTTP en esas cuatro.
- **No:** alinear también `healthFacility`. Su fuga es real y está en los `002A`/`002B`, pero pertenece al F51, que ya la declaró fuera de su alcance. Este spec alinea las cuatro entidades que toca, no las seis.
- **No:** alinear las respuestas de `001`, `004` y `005`. Son rutas de escritura y no alimentan componentes de listado; ampliar ahí el cambio de contrato no compra nada.
- **No:** la columna `value` de `catalogItem` en la búsqueda. Es el valor operativo del ítem —el que blinda el F46—, no su identidad, y mezclarlo produce coincidencias por un dato que el usuario no está tecleando.
- **No:** `description`, `composition` ni ningún texto largo. Una descripción no identifica una fila y ensucia el `Op.or` con coincidencias accidentales.
- **No:** `appUser` ni `notifier`. Sus columnas de nombre están cifradas con `esaviCrypt` de IV fijo, y `Op.iLike` sobre ciphertext no coincide con nada. La salida sería el modelo de tokens del F47, que es otro spec.
- **No:** un endpoint de igualdad exacta por código —al estilo del `GET /code/:code` de `systemConfig`— para `geoLevelType` o `diluentCatalog`, las dos con `UNIQUE` sobre `code`. Es una operación distinta de la que pide este spec: resolver uno, no buscar entre varios.
- **No:** normalizar acentos (`unaccent`, columna generada). Cambio de esquema, misma limitación asumida por el F50 y el F51.
- **No:** ordenar por relevancia. Cada listado conserva su `order` actual; ordenar por cercanía de texto exige una función de similitud que no existe en el esquema.
- **No:** índice de trigramas. Anotado como riesgo en §7 y fuera de alcance por ser cambio de esquema.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Express captura `/search` como `:id`.** Si la ruta del `007` se declara después de `GET /:id`, toda petición al buscador responde `400 Catalog Item ID must be a valid UUID` — un fallo que parece de validación y no de enrutado | La ruta se declara junto a las literales que ya existen (`/type/:id`, `/admin/type/:id`, `/import`), antes del `003`. Es el paso 22 del plan y tiene criterio de aceptación propio en §5 |
| **`vaccineWhodrug` es el volumen real.** `drugName` es `text` sin ancho y el catálogo WHODrug tiene una fila por presentación de país: es la tabla más grande de las nueve, y el `iLike` con comodín inicial la recorre entera en cada búsqueda | El mínimo de dos caracteres y el `limit` máximo de 100 acotan el peor caso, y sus cuatro filtros existentes (`language`, `iso3Code`, `isPreferred`, `isGeneric`) reducen el conjunto cuando el cliente los usa. Si no basta, la salida es un índice `pg_trgm` (`gin_trgm_ops`) sobre `drugName` y `drugCode`, cambio de esquema fuera de este spec |
| **El escape se lee como regresión.** Un cliente que hoy manda `?search=VAC%` y recibe todo lo que empieza por "VAC" pasará a recibir solo lo que contenga el `%` literal — casi siempre nada | Es la corrección de un defecto, no un cambio de intención, y va declarada en §8. El comodín nunca fue una funcionalidad ofrecida: era entrada de usuario llegando cruda a la consulta |
| **`search` devuelve más filas que antes** en `diagnosticTerm`, `diluentCatalog` y `vaccineWhodrug`, porque pasa a cubrir la columna de código. Una UI que asumía "esto busca por nombre" mostrará coincidencias que el usuario no reconoce como tales | Es ampliación, no rotura: ninguna fila que antes salía deja de salir. Declarado en §8, y el cliente que quiera el comportamiento anterior tiene ahora el parámetro exacto para pedirlo — `?name=` |
| **Un cliente que lee `sysDetails` deja de recibirlo, en silencio.** No hay error: el campo simplemente no viene | Es interno por convención y el resto del repositorio ya lo excluye. Se verificó que ninguna suite lo lee de una respuesta HTTP en esas cuatro entidades. Va en §8 como el único cambio sustractivo del spec |
| **Un segundo `Op.or` sobre el mismo `whereClause` se sobrescribe sin aviso.** Si mañana alguien añade otra condición disyuntiva a uno de estos listados y la asigna con `whereClause[Op.or] = …`, la del buscador desaparece y nadie ve un error | Hoy ningún servicio de las nueve entidades usa `Op.or` fuera del buscador — se verificó, incluido `systemConfig`, cuyo único uso es justo el que este spec refactoriza. Se registra el riesgo porque la forma correcta cuando aparezca el segundo es anidar los dos bajo un `Op.and`, no asignar dos veces la misma clave |
| **`catalogItem.code` no es único globalmente.** `UQ_catalogItem_type_code` es compuesta, así que un cliente que trate al `007` como resolvedor de uno —"dame el ítem cuyo código es `ACTIVE`"— recibirá varias filas y tomará la primera | El `007` devuelve `{ count, rows }` como cualquier listado, nunca un objeto suelto, y §3.1 lo declara como regla de negocio. El cliente que necesite unicidad debe pasar además `catalogTypeId` |
| **Implementación parcial.** Nueve entidades en un spec: si se implementa la mitad, la API queda con tres convenciones en vez de dos | El plan son veintisiete pasos independientes y cada uno deja el proyecto compilando. Un corte a mitad deja entidades sin buscador, que es el estado de hoy, no un estado nuevo |
| **`Op.iLike` no ignora tildes.** "Bogota" no encuentra "Bogotá", y quien teclea sin acentos —lo habitual— no encuentra lo que busca | Limitación conocida y asumida, heredada del F50 y del F51. Resolverla exige `unaccent` o una columna generada. Documentada en §2 para que nadie la reporte como defecto |

---

## 8. Impacto en el contrato HTTP

**Mayoritariamente aditivo, con un cambio sustractivo y dos de comportamiento.** Ninguna ruta desaparece, ninguna cambia de rol, ningún código de operación se renumera.

| | Antes | Después |
|---|---|---|
| Endpoints de `catalogItem` | 8 | **9** |
| Códigos `ESAVI-CATITEM-*` | `001`…`005B`, `006` | los mismos + **`007`** |
| Entidades con filtro de texto | 6 | **10** |
| Convenciones de parámetro | 2 (`search`; `name`/`code`) | 2, con `name`/`code` canónico y `search` **congelado** en 4 entidades |
| Endpoints que devuelven `sysDetails` | 12 de las 4 entidades antiguas | **0** |
| Claves i18n de `catalogItem` | N | N + 1 |
| Filas en `ROUTE_RULES` | N | N + 1 |
| Servicios con `Op.iLike` sin escapar | 4 | **0** |

**Endpoint nuevo:**

```
GET /api/catalog-items/search?name=&code=&catalogTypeId=&limit=&offset=
ESAVI-CATITEM-007 · USER · 200 | 400 | 401 | 403
```

**Lo que un cliente existente nota — tres cosas, y solo tres:**

1. **`sysDetails` desaparece** de los `002A`, `002B` y `003` de `catalogItem`, `catalogType`, `geoLevelType` y `geoLocation`. Es el único campo que este spec quita. Ningún cliente debería estar leyéndolo: es interno por convención y el resto del repositorio ya no lo expone.
2. **`?search=` devuelve más filas** en `diagnostic-terms`, `diluent-catalogs` y `vaccine-whodrugs`, porque pasa a cubrir también la columna de código. Ninguna fila que antes salía deja de salir. En `system-configs` no cambia: ya cubría las dos.
3. **`%` y `_` dejan de actuar como comodines** en los cuatro `search` existentes. Un cliente que los estuviera explotando —deliberadamente o por accidente— recibirá menos resultados; era entrada cruda llegando a la consulta, no una funcionalidad.

**Lo que un cliente existente no nota:** todo lo demás. Los parámetros `name` y `code` son opcionales en las nueve entidades; un cliente que no los mande obtiene exactamente la misma respuesta que antes.

**Lo que un cliente nuevo gana:** un solo componente de autocompletado, con un solo par de parámetros, contra diez entidades — incluida la tabla de catálogos, que hasta ahora exigía conocer el `catalogTypeId` antes de poder buscar nada.

**Punto de atención para el equipo de frontend:** el `007` devuelve `catalogType` embebido, que los `002A`/`002B` de `catalogItem` no devuelven. Un componente que renderice indistintamente resultados de ambos debe tolerar la ausencia de ese objeto cuando los datos vienen del `002`.

---

## Lo que **no** está en este spec

- Búsqueda por texto en `appUser` y `notifier` — sus columnas de nombre están cifradas y exigen el modelo de tokens del F47.
- Búsqueda por texto en `evaluationInstitution` o en cualquier tabla satélite de `notification` e `investigation`.
- La búsqueda de `healthFacility`, que resuelve el F51 con su `006`.
- La corrección de la fuga de `sysDetails` en los `002A`/`002B` de `healthFacility`.
- La eliminación del alias `search` de las cuatro entidades que ya lo tienen.
- El retrofit del mínimo de dos caracteres a `geoLocation`.
- La alineación de `sysDetails` en las respuestas de `001`, `004`, `005A` y `005B`.
- Búsqueda sobre `value`, `description`, `composition` o cualquier otro texto largo.
- Un endpoint de igualdad exacta por código, al estilo del `GET /code/:code` de `systemConfig`.
- Tolerancia a acentos o a erratas (`unaccent`, `pg_trgm`, columna generada).
- Ordenación por relevancia de la coincidencia.
- Índice de trigramas u otro cambio de esquema para acelerar el `iLike`.
- Cualquier escritura: las diez operaciones de este spec son de solo lectura y no declara contrato de update diferencial.

Cada uno de esos, si aterriza, va en su propio spec.
