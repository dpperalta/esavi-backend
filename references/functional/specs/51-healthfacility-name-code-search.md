# SPEC F51 — Búsqueda de establecimientos de salud por nombre o código

> **Estado:** Implementado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC 09 (`healthFacility`, CRUD base), SPEC F50 (patrón `Op.iLike`, implementado), **SPEC F52 (extracción de `escapeLike` al helper compartido)**
> **Fecha:** 2026-09-01
> **Objetivo:** Añadir `ESAVI-HFAC-006` — `GET /api/health-facilities/search` —, un buscador nacional de establecimientos por nombre o por `localCode`, sin exigir conocer de antemano su geolocalización.

---

## 1. Por qué existe este spec

**A — `healthFacility` no se puede buscar; solo se puede recorrer.** La entidad tiene siete endpoints (`ESAVI-HFAC-001` a `005B`) y ninguno acepta un criterio de texto. Los dos únicos listados son `getHealthFacilitiesByGeoLocationService` (`healthFacility.service.ts:98`) y `getAllHealthFacilitiesByGeoLocationService` (`healthFacility.service.ts:115`), y los dos abren con la misma guarda:

```ts
if (!geoLocationId) {
    throw new AppError(getMessage('geoLocation.idRequired', lang), 400, 'HFAC_002A_GEOLOCATIONID_REQUIRED');
}
```

El `geoLocationId` no es un filtro opcional: **es la clave de entrada obligatoria**, y viaja en la ruta (`/location/:id`, `/admin/location/:id`). No existe un `GET /api/health-facilities` global. Quien quiere encontrar un establecimiento tiene que saber primero en qué geolocalización está.

**B — Y esa es justamente la información que quien busca no tiene.** El operador que captura un caso ESAVI conoce el establecimiento por su nombre — "Hospital Vozandes", "Centro de Salud Chimbacalle" — o por el código con el que lo identifica su institución. La jerarquía geográfica es lo que quiere *averiguar*, no lo que puede aportar. Hoy la única vía es que el cliente itere el listado de geolocalizaciones y emita una llamada por cada una, lo que convierte una búsqueda en N peticiones y deja la decisión de "¿en cuántas provincias busco?" en manos del formulario.

**C — La deuda está declarada desde hace dos specs y nadie la ha recogido.** `references/specs/09-healthfacility-crud.md:45` la dejó fuera de su alcance con una razón que en su momento era cierta:

> Búsqueda por texto sobre `name` o `address`. No existe `Op.iLike` en ningún servicio del repositorio; introducirlo es un cambio transversal.

El [SPEC F50](50-geolocation-name-code-search.md) —hoy implementado— eliminó esa razón: introdujo `Op.iLike` sobre `geoLocation`, con el escape de `%` y `_` que exige cualquier patrón construido con entrada de usuario. Pero lo hizo acotado a una entidad, y volvió a dejar constancia de que ésta seguía pendiente: *"`healthFacility` no se toca. Ya estaba fuera del alcance de SPEC 09 por la misma razón y sigue sin resolverse aquí."* **Este spec es el que la resuelve.** El patrón ya está escrito y probado; lo que falta es aplicarlo.

**D — El F50 no se puede copiar tal cual, y ahí está la única decisión difícil.** Aquel spec fue barato porque `geoLocation` ya tenía un listado global al que añadir dos query params. `healthFacility` no lo tiene. Repetir la forma del F50 aquí significaría añadir `name` y `code` a los `002A`/`002B`, y eso no produce un buscador: produce un filtro dentro de una geolocalización que hay que conocer de antemano — es decir, no resuelve **B**. Por eso este spec abre un `006` propio en vez de ampliar el `002`. El razonamiento completo, con el costo comparado de las dos opciones, está en §6.

**E — Tres columnas de nombre, una de código, y ninguna consultable.** El DDL (`esaviapp.sql:472-497`) da `name varchar(250) NOT NULL`, `officialName varchar(250)` y `shortName varchar(100)` — tres formas legítimas del mismo establecimiento, cargadas indistintamente según la fuente del dato — más `localCode varchar(200)` con `UQ_healthFacility_localCode`, que es la única columna de código de la tabla. Quien recuerda "Vozandes" no sabe si eso está en `name`, en `officialName` o en `shortName`, y hoy da igual: ninguna de las tres es consultable por texto.

---

## 2. Alcance

**Dentro:**

- **`ESAVI-HFAC-006` — `GET /api/health-facilities/search`.** Endpoint nuevo, rol mínimo `USER`, el mismo que el `002A` y el `003`. Declarado en `healthFacility.routes.ts` **antes** de `GET /:id`, para que Express no capture `search` como un `:id` — el archivo ya resuelve así el orden de `location`, `admin` y `activate` y lo deja comentado.
- **Dos query params de texto, ambos opcionales por separado pero al menos uno obligatorio en conjunto:**
  - `name` — `Op.iLike` sobre `name`, `officialName` y `shortName`, las tres unidas entre sí con `Op.or`.
  - `code` — `Op.iLike` sobre `localCode`, la única columna de código de la tabla.
- **`name` y `code`, cuando llegan los dos, se combinan entre sí con `Op.or`** — coincide con el nombre o con el código, nunca se exigen ambos. Es la misma semántica que fijó el F50.
- **`geoLocationId` opcional por query**, combinado con `Op.and` contra el bloque de texto. Acota la búsqueda a una geolocalización cuando quien busca sí la conoce, sin convertirla en requisito.
- **Guarda de criterio vacío.** Sin `name` ni `code`, el servicio responde `400` con la clave nueva `healthFacility.searchCriteriaRequired`. Un `/search` sin criterio que vuelca la tabla es superficie de enumeración gratuita, y `geoLocationId` por sí solo no cuenta como criterio — para eso ya está el `002A`.
- **Longitud mínima de 2 caracteres** para `name` y `code` en el validador, además de los topes máximos alineados a las columnas.
- **Escape de `%` y `_`** en la entrada antes de interpolarla en el patrón (`escapeLike`), tal como lo dejó el F50.
- **Visibilidad de inactivos resuelta en el controlador con `canViewInactive`**, igual que el `003` (`healthFacility.controller.ts:84`): un `USER` ve solo activos, un `ADMIN` o `SUPERADMIN` ve también los inactivos. Un solo endpoint, sin desdoblar en `006A`/`006B`.
- **`include` de `geoLocation` y `facilityType`**, ambos con `attributes` mínimos (id y `name`). Las dos asociaciones ya existen (`healthFacility.associations.ts:12-13` y `:8`); no se toca `src/models/associations/`.
- **`sysDetails` excluido de la respuesta**, alineado con el `003` y con la convención de que es interno.
- **Respuesta `{ count, rows }`** de `findAndCountAll`, orden `name ASC` —el mismo de los dos listados existentes— y paginación reutilizando `healthFacilityListValidator`.
- **Resultado vacío es un resultado:** `200` con `count: 0`, nunca `404`.
- **Una clave i18n nueva** — `healthFacility.searchCriteriaRequired` — en `es`, `en` y `nl`. El éxito y el fallo reutilizan `getSuccessPlural` / `getFailedPlural`, que ya existen.
- **Los siete artefactos de `CONVENTIONS.md` §1**: ruta, controlador, servicio, validador, tipo, i18n y prueba.
- **Fila nueva en `ROUTE_RULES`** (`tests/auth/roles.test.ts:79-85`) y casos nuevos en `tests/contract/healthFacility.test.ts`.
- **Alta de `HFAC` `006` en la tabla de extensiones de `references/CONVENTIONS.md` §6.**
- **Enlace de vuelta desde el F50**: añadir a su "Lo que **no** está en este spec" que `healthFacility` se resuelve en este F51.

**Fuera de alcance (otros specs, o descartado):**

- **Ampliar los `002A`/`002B` con filtros de texto.** Es la opción (b) que se evaluó y se descartó: cuesta la mitad, pero no resuelve el problema de §1.B porque sigue exigiendo el `geoLocationId` en la ruta. Razonada en §6.
- **La fuga de `sysDetails` en los `002A`/`002B`.** `healthFacility.service.ts:102` y `:120` hacen `findAndCountAll` sin `attributes` y devuelven la columna entera. Es real y está verificada, pero corregirla cambia el contrato de dos endpoints ya implementados. **Este spec no la toca**: nace limpio en el `006` y deja la corrección del `002` a un spec propio.
- **Búsqueda sobre `address`.** El SPEC 09 la nombraba junto a `name` en su exclusión. Se queda fuera: una dirección no identifica un establecimiento como lo hace su nombre, y mezclarla en el mismo `Op.or` produce coincidencias por nombre de calle que ensucian el resultado.
- **Búsqueda sobre `email` o `phone`.** No son criterios de búsqueda de un formulario de captura; son datos de contacto de la ficha.
- **Búsqueda por el nombre del establecimiento padre.** Encontrar todos los puestos de salud que cuelgan de un hospital cuyo nombre se teclea exige un `include` con `where`, y es un caso de uso distinto —navegación jerárquica— que nadie ha pedido.
- **Alcance geográfico por las asignaciones del usuario.** No existe hoy ningún helper de `geoScope` en `src/`; el `006` ve todo el país, con la visibilidad de inactivos como único eje de restricción. Si el SPEC F49 aterriza esa noción, aplicarla al `006` será un cambio de una línea en el `where` y va en aquel spec, no en éste.
- **Búsqueda por prefijo, difusa o fonética.** `Voz` no encontrará "Vozandes" solo si la coincidencia fuera por palabra completa — no es el caso aquí, `Op.iLike` con `%valor%` sí la encuentra —, pero `Bosandes` seguirá sin encontrarla. La distancia de edición exige `pg_trgm` y queda fuera.
- **Tolerancia a acentos.** `Op.iLike` ignora la caja pero no la tilde: "Bogota" no iguala a "Bogotá". Resolverlo exige `unaccent` o una columna generada, que son cambio de esquema. Misma limitación que asumió el F50, anotada en §7.
- **Ordenación por relevancia de la coincidencia.** Se conserva `name ASC`.
- **Índice de trigramas (`gin_trgm_ops`) u otro cambio de esquema** para acelerar el `iLike` con comodín inicial. Anotado como riesgo en §7.
- **Contrato de update diferencial.** El `006` es de solo lectura: no escribe `appDetails`, ni `sysDetails`, ni `updatedAt`. Este spec **no declara** tabla de `candidates` ni el bloque de cinco criterios de `CONVENTIONS.md` §11, porque no hay ninguna operación que modifique una fila existente.

---

## 3. Modelo de datos

**No hay tabla nueva ni columna nueva.** `healthFacility` (`esaviapp.sql:472-497`) ya tiene las cuatro columnas que el buscador consulta. Lo que aparece es un endpoint y los siete artefactos que `CONVENTIONS.md` §1 exige para él, más una extracción de helper.

Columnas consultadas, textuales del DDL:

| Columna | Tipo | Nulable | Papel en el buscador |
|---|---|---|---|
| `name` | `varchar(250)` | NO | Filtro `name` |
| `officialName` | `varchar(250)` | SÍ | Filtro `name` |
| `shortName` | `varchar(100)` | SÍ | Filtro `name` |
| `localCode` | `varchar(200)` | SÍ | Filtro `code` — `UQ_healthFacility_localCode` |
| `geoLocationId` | `uuid` | SÍ | Filtro opcional de acotación + `include` |
| `facilityTypeItemId` | `uuid` | SÍ | `include` |
| `isActive` | `boolean` | NO | Visibilidad según `canViewInactive` |

Las columnas transversales (`deletedAt`, `sysDetails`, `appDetails`) no se tocan, y `sysDetails` no se devuelve.

### 3.1 Helper nuevo — `escapeLike`

`escapeLike` existe hoy como `const` privada de `src/services/geoLocation.service.ts:91` y no se exporta. Se extrae a `src/helpers/stringHandling.helper.ts`, junto a `normalizeName` y `toSearchForm`:

```ts
export const escapeLike = (value: string): string => value.replace(/[%_]/g, '\\$&');
```

`src/helpers/index.ts:16` ya reexporta el módulo con `export *`, así que **el barril no se edita**. `geoLocation.service.ts` borra su declaración local y lo importa del barril; su comportamiento no cambia en nada — es la misma expresión.

Es la misma extracción que el SPEC F47 hizo con `normalizeName` (`stringHandling.helper.ts:82`) cuando un segundo consumidor la necesitó.

### 3.2 Tipo nuevo

En `src/types/healthFacility/healthFacility.types.ts`, junto a `CreateHealthFacilityInput`:

```ts
export interface HealthFacilitySearchInput {
    name?: string;
    code?: string;
    geoLocationId?: string;
}
```

### 3.3 Validador

En `src/validators/healthFacility.validator.ts`, un export nuevo. `healthFacilityListValidator` **no se modifica**: se compone en la ruta junto al nuevo, igual que hoy se componen `geoLocationIdValidator` y `healthFacilityListValidator` en los `002`.

```ts
export const searchHealthFacilityValidator = [
    query('name').optional().trim()
        .isLength({ min: 2 }).withMessage('Name must be at least 2 characters long')
        .isLength({ max: 250 }).withMessage('Name must be at most 250 characters long'),
    query('code').optional().trim()
        .isLength({ min: 2 }).withMessage('Code must be at least 2 characters long')
        .isLength({ max: 200 }).withMessage('Code must be at most 200 characters long'),
    query('geoLocationId').optional().isUUID().withMessage('Geo Location ID must be a valid UUID').trim()
];
```

El tope de `name` es 250 — el `varchar` de `name` y `officialName`, las más largas de las tres columnas que consulta. Una cadena que no cabe en `shortName` (`varchar(100)`) tampoco puede coincidir con ella, así que no hace falta un segundo tope. El de `code` es 200, el de `localCode`.

> **Discrepancia observada, no corregida aquí.** `createHealthFacilityValidator` y `updateHealthFacilityValidator` topan `name` y `officialName` en **255**, cinco caracteres por encima del `varchar(250)` del DDL. Es un defecto real de los `001`/`004` —un nombre de 253 caracteres pasa el validador y revienta en Postgres— pero corregirlo cambia el contrato de dos endpoints implementados y no entra en este spec. El validador nuevo usa 250, el valor correcto.

### 3.4 Servicio

En `src/services/healthFacility.service.ts`, una función nueva. **No se modifican** `getHealthFacilitiesByGeoLocationService` ni `getAllHealthFacilitiesByGeoLocationService`.

```ts
// ESAVI-HFAC-006 - Search Health Facilities by Name or Code Service
const searchHealthFacilitiesService = async (
    filters: HealthFacilitySearchInput,
    lang: string,
    includeInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => { ... }
```

El orden de parámetros sigue al del `003` (`includeInactive` después de `lang`) y deja `limit`/`offset` al final, como los dos listados.

**Guarda de criterio.** Antes de construir nada:

```ts
const name = filters.name?.trim();
const code = filters.code?.trim();

if( !name && !code ) {
    throw new AppError(getMessage('healthFacility.searchCriteriaRequired', lang), 400, 'HFAC_006_SEARCH_CRITERIA_REQUIRED');
}
```

La guarda vive en el servicio además de en el validador, porque el validador solo declara los dos parámetros `optional()` — no puede expresar "al menos uno de los dos". Es la misma razón por la que el `007` de `patient` duplica su guarda.

**Construcción del `where`:**

```ts
const whereClause: any = {};

if( !includeInactive ) {
    whereClause.isActive = true;
}
if( filters.geoLocationId ) {
    whereClause.geoLocationId = filters.geoLocationId;
}

const textConditions: any[] = [];
if( name ) {
    const namePattern = `%${ escapeLike(name) }%`;
    textConditions.push(
        { name: { [Op.iLike]: namePattern } },
        { officialName: { [Op.iLike]: namePattern } },
        { shortName: { [Op.iLike]: namePattern } }
    );
}
if( code ) {
    textConditions.push({ localCode: { [Op.iLike]: `%${ escapeLike(code) }%` } });
}
whereClause[Op.or] = textConditions;
```

Las tres columnas de nombre entran **planas** en `textConditions`, no anidadas en su propio `Op.or`: como el operador que une `name` con `code` también es `Op.or`, anidar no cambiaría el resultado y añadiría un paréntesis inútil al SQL. El resultado es: `(name ILIKE p OR officialName ILIKE p OR shortName ILIKE p OR localCode ILIKE q) AND geoLocationId = z AND isActive = true`.

`whereClause[Op.or]` se asigna sin guarda de longitud porque la guarda de criterio ya garantiza que `textConditions` tiene al menos un elemento.

**Consulta:**

```ts
const healthFacilities = await HealthFacility.findAndCountAll({
    where: whereClause,
    attributes: { exclude: ['sysDetails'] },
    include: [
        { model: GeoLocation, as: 'geoLocation', attributes: ['geoLocationId', 'name'] },
        { model: CatalogItem, as: 'facilityType', attributes: ['catalogItemId', 'name'] }
    ],
    order: [['name', 'ASC']],
    limit,
    offset
});
```

Los dos `include` usan los alias ya declarados en `healthFacility.associations.ts:8` y `:13`. Ninguno lleva `required: true` — un establecimiento sin `facilityTypeItemId` (la columna es nulable) debe aparecer igual en el resultado.

### 3.5 Controlador y ruta

En `src/controllers/healthFacility.controller.ts`, un handler nuevo que sigue el idioma de los existentes: lee `req.query`, llama al servicio, no importa ningún modelo.

```ts
// ESAVI-HFAC-006 - Search Health Facilities by Name or Code
const searchHealthFacilities = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const name = req.query.name ? (req.query.name as string).trim() : undefined;
    const code = req.query.code ? (req.query.code as string).trim() : undefined;
    const geoLocationId = req.query.geoLocationId ? (req.query.geoLocationId as string).trim() : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await searchHealthFacilitiesService(
            { name, code, geoLocationId },
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        ...
    }
}
```

El `catch` sigue el idioma del repositorio: log con el código, `next(error)` si ya es `AppError`, y si no `new AppError(getMessage('healthFacility.getFailedPlural', req.lang), 500, 'HFAC_006_SEARCH_FAILED', error)`.

En `src/routes/healthFacility.routes.ts`, la ruta se declara **junto al resto de rutas literales, antes de `GET /:id`**:

```ts
// Search Health Facilities by Name or Code
// Code: ESAVI-HFAC-006
router.get('/search', tokenValidation, validateUserRole(USER), ...searchHealthFacilityValidator, ...healthFacilityListValidator, validateFields, searchHealthFacilities);
```

El archivo ya documenta esta restricción de orden en el comentario del `003`: *"Declared after the literal paths so Express does not capture 'location', 'admin' or 'activate' as an :id"*. `search` se suma a esa lista y el comentario se actualiza.

### 3.6 Superficie HTTP

```
GET /api/health-facilities/search?name=&code=&geoLocationId=&limit=&offset=   ESAVI-HFAC-006   USER   (nuevo)
```

| | |
|---|---|
| **Código** | `ESAVI-HFAC-006` |
| **Rol mínimo** | `USER` |
| **Éxito** | `200` — `healthFacility.getSuccessPlural` |
| **Sin criterio** | `400` — `healthFacility.searchCriteriaRequired` |
| **Sin coincidencias** | `200` con `count: 0` — nunca `404` |
| **Inactivos** | Visibles solo si `canViewInactive(req.user)` |

Los siete endpoints existentes (`001`, `002A`, `002B`, `003`, `004`, `005A`, `005B`) **no cambian**: ni su ruta, ni su rol, ni su respuesta.

Fila nueva en `ROUTE_RULES` (`tests/auth/roles.test.ts`), colocada entre el `002B` y el `003` para respetar el orden del archivo:

```ts
{ method: 'get',    path: '/api/health-facilities/search',                       minRole: 'USER',       code: 'ESAVI-HFAC-006' },
```

Alta en la tabla de extensiones de `references/CONVENTIONS.md` §6:

```markdown
| healthFacility | `006` | búsqueda por nombre o código — `Op.iLike` sobre `name`, `officialName`, `shortName` y `localCode`; nacional, con `geoLocationId` opcional. `GET /search`, USER |
```

### 3.7 Reglas de negocio

**`ESAVI-HFAC-006` — buscar.**

- **Al menos un criterio de texto.** Sin `name` ni `code` → `400`. `geoLocationId` por sí solo **no** es criterio suficiente: acota, no busca. Para listar una geolocalización completa ya está el `002A`.
- **`name` coincide contra tres columnas.** Un establecimiento aparece si el patrón coincide con `name`, con `officialName` **o** con `shortName`. Basta una.
- **`code` coincide contra `localCode`** y solo contra ella. Es la única columna de código de la tabla.
- **`name` y `code` juntos son disyuntivos.** Coincide con uno u otro; nunca se exigen los dos.
- **`geoLocationId` es conjuntivo.** Se combina con `Op.and` contra el bloque de texto. Es un eje distinto —ubicación, no identidad— y mezclarlo con `Op.or` devolvería establecimientos fuera de la geolocalización pedida.
- **`isActive` es conjuntivo.** Un `USER` nunca ve inactivos, con o sin criterio de texto.
- **Escape obligatorio.** `%` y `_` de la entrada se neutralizan con `escapeLike` antes de interpolar. Un `localCode` con guion bajo literal es frecuente en códigos administrativos.
- **No hay validación de FK.** `geoLocationId` no se comprueba contra `geoLocation`: un UUID inexistente devuelve `200` con `count: 0`, que es la respuesta correcta de un buscador — no `404`.
- **No hay unicidad que comprobar.** El `006` no escribe.

**Contrato de update diferencial: no aplica.** El `006` es de solo lectura. No hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`. La tabla de `candidates` de `CONVENTIONS.md` §11 y el bloque de cinco criterios de §5 no tienen objeto en este spec, y su ausencia es deliberada. **Ninguna operación de este spec escribe sobre una fila existente.**

### 3.8 Claves i18n nuevas

Una sola, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | `es` | `en` | `nl` |
|---|---|---|---|
| `healthFacility.searchCriteriaRequired` | "Debe indicar un nombre o un código para buscar" | "A name or a code is required to search" | "Een naam of een code is vereist om te zoeken" |

El éxito reutiliza `healthFacility.getSuccessPlural` y el fallo `healthFacility.getFailedPlural`, ambas ya presentes en los tres idiomas. No cambian de significado por servir también a un buscador.

### 3.9 Forma de la respuesta

```json
{
  "ok": true,
  "message": "Establecimientos de salud obtenidos exitosamente",
  "data": {
    "count": 3,
    "rows": [
      {
        "healthFacilityId": "…",
        "geoLocationId": "…",
        "parentHealthFacilityId": null,
        "facilityTypeItemId": "…",
        "localCode": "HVQ-001",
        "name": "Hospital Vozandes Quito",
        "officialName": "Hospital Vozandes de Quito",
        "shortName": "HVQ",
        "address": "…",
        "latitude": "-0.1806789",
        "longitude": "-78.4869560",
        "phone": "…",
        "email": "…",
        "isActive": true,
        "createdAt": "…",
        "updatedAt": null,
        "deletedAt": null,
        "appDetails": [ … ],
        "geoLocation": { "geoLocationId": "…", "name": "Quito" },
        "facilityType": { "catalogItemId": "…", "name": "Hospital" }
      }
    ]
  }
}
```

`count` es el total de coincidencias, no el tamaño de la página — es el `count` de `findAndCountAll`. `sysDetails` **no** aparece. `appDetails` sí, siguiendo lo que ya devuelve el `003`.

---

## 4. Plan de implementación

Nueve pasos. Los tres primeros no tienen superficie observable y preparan el terreno; el `006` empieza a responder en el paso 7.

1. ~~**Extraer `escapeLike` al helper compartido.**~~ **Este paso pasa al SPEC F52**, que toca cinco servicios que no escapaban nada y para el que el helper compartido es más suyo (F52 §6). Se ejecutó como parte de la implementación de este spec — `escapeLike` ya vivía en `src/helpers/stringHandling.helper.ts` cuando F52 empezó — y F52 §3.2 lo declara formalmente extraído. Sin efecto en el resto de este plan.

2. **Añadir el tipo `HealthFacilitySearchInput`.** En `src/types/healthFacility/healthFacility.types.ts`, junto a `CreateHealthFacilityInput`, con los tres campos opcionales de §3.2.
   *Verificación:* `npm run build` en 0; el tipo se importa desde el barril `../types` sin registrar nada nuevo en `src/types/index.ts` si ese barril ya reexporta el directorio.

3. **Añadir la clave i18n en los tres idiomas.** `healthFacility.searchCriteriaRequired` en `es.json`, `en.json` y `nl.json`, con los textos de §3.8.
   *Verificación:* `npm run i18n:check` en 0; `tests/i18n/messages.test.ts` pasa — es el que exige paridad exacta de claves entre los tres archivos.

4. **Añadir `searchHealthFacilityValidator`.** Nuevo export en `src/validators/healthFacility.validator.ts` con los tres `query()` de §3.3, registrado en el barril `src/validators/index.ts` si ese archivo enumera exports uno a uno. `healthFacilityListValidator` no se modifica.
   *Verificación:* `npm run build` en 0; `npm run lint` en 0.

5. **Escribir `searchHealthFacilitiesService`.** En `src/services/healthFacility.service.ts`: guarda de criterio vacío, construcción del `where` con `Op.iLike` y `escapeLike`, `attributes: { exclude: ['sysDetails'] }`, los dos `include` sin `required`, `order: [['name','ASC']]` y `findAndCountAll`. Exportar en el bloque de exports del archivo. Los dos servicios de listado existentes no se tocan.
   *Verificación:* invocar el servicio con `{ name: 'vozandes' }` devuelve las filas cuyo `name`, `officialName` **o** `shortName` contiene "vozandes" sin distinguir mayúsculas; con `{ code: 'HVQ_1' }` no coincide una fila cuyo `localCode` sea `HVQX1`; con `{}` lanza `AppError` 400 y código `HFAC_006_SEARCH_CRITERIA_REQUIRED`; con `includeInactive: false` ninguna fila devuelta tiene `isActive: false`; ninguna fila devuelta trae `sysDetails`.

6. **Escribir el controlador `searchHealthFacilities`.** En `src/controllers/healthFacility.controller.ts`, con las lecturas de `req.query` de §3.5, `canViewInactive(req.user as AuthUser)` y el `catch` en el idioma del repositorio (`HFAC_006_SEARCH_FAILED`).
   *Verificación:* `npm run build` en 0; el controlador sigue sin importar ningún modelo — `grep -n "from '../models" src/controllers/healthFacility.controller.ts` devuelve vacío.

7. **Registrar la ruta.** `router.get('/search', …)` en `src/routes/healthFacility.routes.ts`, declarada **antes** de `router.get('/:id', …)`, y actualizar el comentario del `003` para que nombre también `'search'` entre los literales que Express no debe capturar.
   *Verificación:* `GET /api/health-facilities/search?name=hospital` con token de `USER` responde `200` y **no** `400 Health Facility ID must be a valid UUID` — ese error sería la prueba de que `/:id` capturó la ruta; `GET /api/health-facilities/<uuid>` sigue respondiendo el `003`.

8. **Ampliar las pruebas.** Fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts` con el path y el código de §3.6, y casos nuevos en `tests/contract/healthFacility.test.ts`: coincidencia vía `name`, vía `officialName`, vía `shortName`, vía `localCode`, `name`+`code` disyuntivos, `name`+`geoLocationId` conjuntivos, sin criterio → `400`, sin coincidencias → `200` con `count: 0`, `USER` sin inactivos frente a `ADMIN` con inactivos, `_` literal en `code`, `name` de un carácter → `400`, y ausencia de `sysDetails` en las filas.
   *Verificación:* `npm run check` en 0.

9. **Cerrar la documentación.** Dos ediciones fuera de `src/`:
   - Alta de la fila `healthFacility | 006` en la tabla de extensiones de `references/CONVENTIONS.md` §6, con el texto de §3.6.
   - Enlace de vuelta en `references/functional/specs/50-geolocation-name-code-search.md`: su bloque "Lo que **no** está en este spec" dice hoy que `healthFacility` sigue sin resolverse; pasa a apuntar a este F51.

   *Verificación:* `grep -n "HFAC" references/CONVENTIONS.md` devuelve la abreviatura **y** la fila del `006`; `grep -n "51-healthfacility" references/functional/specs/50-geolocation-name-code-search.md` devuelve el enlace nuevo.

**Nota sobre el orden.** Los pasos 1 a 4 son independientes entre sí y pueden hacerse en cualquier orden, pero **el 1 va antes que el 5**: el servicio importa `escapeLike` del barril y no compila hasta que la extracción esté hecha. El 7 va después del 6 y el 6 después del 5, por la misma razón de compilación.

**Nota sobre lo que el plan no incluye.** No hay paso de migración ni de esquema: el `006` no añade columnas, índices ni restricciones. Tampoco hay paso para corregir el tope 255/250 de §3.3 ni la fuga de `sysDetails` de los `002`, ambos declarados fuera de alcance en §2.

---

## 5. Criterios de aceptación

**Coincidencia de texto**

- [ ] `GET /api/health-facilities/search?name=X` devuelve las filas cuyo `name` contiene `X`, sin distinguir mayúsculas.
- [ ] Una fila cuyo `officialName` contiene `X` pero cuyo `name` no, aparece igual en el resultado de `name=X`.
- [ ] Una fila cuyo `shortName` contiene `X` pero cuyo `name` y `officialName` no, aparece igual en el resultado de `name=X`.
- [ ] `GET /api/health-facilities/search?code=X` devuelve las filas cuyo `localCode` contiene `X`, sin distinguir mayúsculas.
- [ ] Una coincidencia parcial en medio de la cadena cuenta: `name=vozandes` encuentra "Hospital Vozandes Quito".

**Combinación de filtros**

- [ ] `?name=X&code=Y` devuelve las filas que coinciden con `X` **o** con `Y` — nunca exige las dos.
- [ ] `?name=X&geoLocationId=Z` devuelve solo filas que coinciden con `X` **y** cuyo `geoLocationId` es `Z`.
- [ ] `?name=X` sin `geoLocationId` devuelve coincidencias de **cualquier** geolocalización — es el criterio que distingue este spec de la alternativa descartada en §6.
- [ ] `?geoLocationId=Z` con un UUID que no existe en `geoLocation` responde `200` con `count: 0`, nunca `404`.

**Guardas y validación**

- [ ] `GET /api/health-facilities/search` sin `name` ni `code` responde `400` con la clave `healthFacility.searchCriteriaRequired`.
- [ ] `?geoLocationId=Z` como único parámetro responde `400`: acotar no es buscar.
- [ ] `?name=a` (un carácter) responde `400`; `?name=ab` responde `200`.
- [ ] `?name=` de más de 250 caracteres o `?code=` de más de 200 responde `400`.
- [ ] `?geoLocationId=noEsUnUuid` responde `400`.
- [ ] Un `code` que contiene `_` literal no se comporta como comodín: `?code=HVQ_1` no devuelve una fila cuyo `localCode` sea `HVQX1`.
- [ ] Un `name` que contiene `%` literal no devuelve la tabla entera.

**Autorización y visibilidad**

- [ ] Sin token, la ruta responde `401`.
- [ ] Un `ANALYTICS` (nivel 10, por debajo de `USER`) responde `403`.
- [ ] Un `USER` no ve ninguna fila con `isActive: false` en el resultado.
- [ ] Un `ADMIN` y un `SUPERADMIN` ven también las inactivas, con los mismos filtros de texto aplicados.
- [ ] `tests/auth/roles.test.ts` pasa con la fila nueva `ESAVI-HFAC-006` en `ROUTE_RULES`.

**Forma de la respuesta**

- [ ] La respuesta sigue el sobre `{ ok, message, data }` con `message` resuelto por `getMessage('healthFacility.getSuccessPlural', req.lang)`.
- [ ] `data` es `{ count, rows }`, y `count` es el total de coincidencias, no el tamaño de la página.
- [ ] Ninguna fila devuelta contiene `sysDetails`.
- [ ] Cada fila trae `geoLocation` con exactamente `geoLocationId` y `name`.
- [ ] Cada fila trae `facilityType` con exactamente `catalogItemId` y `name`, y una fila cuyo `facilityTypeItemId` es `null` aparece igual en el resultado con `facilityType: null`.
- [ ] Las filas vienen ordenadas por `name` ascendente.
- [ ] `?limit=` y `?offset=` pagina, con el tope de 100 que ya impone `healthFacilityListValidator`.

**Escrituras — no hay ninguna**

- [ ] El `006` no modifica ninguna fila: tras una búsqueda, el `updatedAt`, el `appDetails` y el `sysDetails` de toda fila devuelta son idénticos a los de antes de la petición.
- [ ] `searchHealthFacilitiesService` no invoca `update`, `create`, `destroy` ni `buildDifferentialUpdate`. **Este spec no declara contrato de update diferencial porque ninguna de sus operaciones escribe sobre una fila existente** — la ausencia de la tabla de `candidates` de `CONVENTIONS.md` §11 es deliberada, no un olvido.

**No regresión**

- [ ] Los siete endpoints existentes de `healthFacility` responden exactamente lo mismo que antes de este spec, en ruta, rol, código y forma.
- [ ] `GET /api/health-facilities/<uuid>` sigue resolviendo el `003` y no es capturado por la ruta `/search`.
- [ ] `GET /api/geo-locations?code=A_B` sigue comportándose como antes de extraer `escapeLike`: la extracción del paso 1 no cambia ningún comportamiento del F50.
- [ ] `grep -rn "escapeLike" src/` devuelve una sola definición, en `stringHandling.helper.ts`.
- [ ] `grep -n "from '../models" src/controllers/healthFacility.controller.ts` devuelve vacío: el controlador sigue sin tocar modelos.
- [ ] `references/CONVENTIONS.md` §6 lista la fila `healthFacility | 006`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

### La decisión central — endpoint propio, no filtros en el `002`

Se evaluaron las dos formas y se midió el costo de cada una antes de elegir.

| | (b) filtros en el `002A`/`002B` | (a) `006` propio — **elegida** |
|---|---|---|
| Validador | extender `healthFacilityListValidator` | export nuevo |
| Servicio | **dos** funciones, `where` duplicado | una función |
| Controlador | dos handlers | uno |
| Ruta | sin cambios | una ruta nueva |
| `ROUTE_RULES` | sin fila | una fila |
| i18n | ninguna clave | una clave × 3 idiomas |
| Tipo | ninguno | uno |
| **Archivos tocados** | **~3** | **~7** |

**(b) es aproximadamente la mitad del trabajo, y aun así se descartó.** La razón no es de costo sino de alcance: los dos listados exigen el `geoLocationId` **en la ruta** (`/location/:id`), no como filtro opcional. Con (b), quien teclea "Vozandes" sin saber en qué cantón está sigue sin poder encontrarlo, y el cliente tendría que iterar las geolocalizaciones y emitir una llamada por cada una. Eso no es un buscador: es un filtro dentro de una lista que ya hay que saber pedir. El problema de §1.B quedaría intacto.

Se registra además que el ahorro de (b) era menor de lo que aparenta: como `002A` y `002B` son hoy dos funciones separadas, la construcción del `where` con `Op.iLike` se habría duplicado igualmente. Lo que (b) ahorraba era plomería —ruta, tipo, clave, fila de prueba—, no lógica.

Se evaluó también una variante intermedia —(a) sin los `include`, para ahorrar el artefacto más incierto— y quedó sin objeto al comprobar que **las dos asociaciones ya existen** (`healthFacility.associations.ts:8` y `:13`): el `include` no cuesta nada.

### Lo demás

- **Sí:** `name` busca en las **tres** columnas de nombre (`name`, `officialName`, `shortName`) unidas por `Op.or`. Es el punto donde este spec se aparta del F50, que limitó la búsqueda a `name` porque en `geoLocation` las otras dos no tenían caso de uso pedido. En `healthFacility` sí lo tienen: las tres se cargan indistintamente según la fuente del dato, y quien recuerda "Vozandes" no sabe en cuál de las tres está.
- **Sí:** `code` busca solo en `localCode`. A diferencia de `geoLocation` —que no tiene columna de código y obligó al F50 a unir `externalCode` con `isoCode`—, aquí hay exactamente una, y además con `UQ_healthFacility_localCode`.
- **Sí:** `name` y `code` se combinan con `Op.or`, replicando el F50. Un buscador único de "nombre o código" no debe exigir que las dos coincidan a la vez.
- **Sí:** `geoLocationId` opcional por query. Da la acotación geográfica a quien la tiene sin convertirla en el requisito que hace inútil al `002` como buscador.
- **Sí:** `400` cuando no llega ni `name` ni `code`, con la guarda duplicada en validador y servicio. Un `/search` sin criterio vuelca la tabla, y `optional()` no sabe expresar "al menos uno de los dos". Misma solución que el `007` de `patient`.
- **Sí:** mínimo de 2 caracteres. **Segundo punto donde este spec se aparta del F50**, que no puso mínimo. La razón es que aquí el `Op.or` abarca cuatro columnas y no hay filtro geográfico obligatorio, así que un `name=a` recorre la tabla nacional entera para devolver una página de ruido.
- **Sí:** endpoint único con `canViewInactive` en vez de desdoblar en `006A`/`006B`. Es lo que ya hacen el `003` (`healthFacility.controller.ts:84`) y el `007` de `patient`. El desdoblamiento del `002` responde a que su ruta cambia (`/location` frente a `/admin/location`), y aquí no cambia.
- **Sí:** `200` con `count: 0` cuando no hay coincidencias. Un `404` en un buscador afirma "esto no existe", que es justo lo que un buscador no puede afirmar — solo sabe que no encontró.
- **Sí:** excluir `sysDetails`. Alineado con el `003`, que lo documenta como interno. Se hace pese a quedar asimétrico frente a los `002`, porque la asimetría correcta es preferible a propagar la fuga a un endpoint nuevo.
- **Sí:** extraer `escapeLike` a `stringHandling.helper.ts` en vez de redeclararlo. Precedente exacto del F47 con `normalizeName`. La alternativa —una segunda `const` idéntica— garantizaba una tercera en cuanto una tercera entidad necesitara buscar.
- **Sí:** los `include` sin `required: true`. `facilityTypeItemId` es nulable en el DDL; con `required` los establecimientos sin tipo desaparecerían silenciosamente del resultado, que es el peor fallo posible en un buscador.
- **No:** `address`. El SPEC 09 la nombraba junto a `name`, pero una dirección no identifica un establecimiento y su presencia en el mismo `Op.or` produce coincidencias por nombre de calle.
- **No:** `email` ni `phone`. Son datos de contacto de la ficha, no criterios de búsqueda de un formulario de captura.
- **No:** buscar por el nombre del establecimiento padre. Exige un `include` con `where` y es navegación jerárquica, un caso de uso distinto que nadie pidió.
- **No:** aplicar el alcance geográfico del usuario. No existe hoy ningún helper de `geoScope` en `src/` — se verificó. Si el F49 lo introduce, aplicarlo aquí es una línea en el `where` y va en aquel spec.
- **No:** normalizar acentos (`unaccent`, columna generada). Cambio de esquema, misma limitación que asumió el F50. Anotado en §7.
- **No:** ordenar por relevancia. Se conserva `name ASC`, el orden de los dos listados existentes.
- **No:** corregir el tope 255/250 de `createHealthFacilityValidator` y `updateHealthFacilityValidator`. Es un defecto real detectado al redactar §3.3, pero cambia el contrato de dos endpoints implementados. Queda anotado, no corregido.
- **No:** corregir la fuga de `sysDetails` de los `002A`/`002B`. Misma razón: cambia un contrato ya publicado y merece su propio spec.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Express captura `/search` como `:id`.** Si la ruta se declara después de `GET /:id`, toda petición al buscador responde `400 Health Facility ID must be a valid UUID` — un fallo que parece de validación y no de enrutado, y que cuesta encontrar | La ruta se declara junto a los literales, antes del `003`; el comentario que ya existe en el archivo se actualiza para nombrar `'search'`. Es el paso 7 del plan y tiene criterio de aceptación propio en §5 |
| **Un valor con `%` o `_` se interpreta como comodín.** `code=HVQ_1` coincidiría con "HVQ" + cualquier carácter + "1"; un `name=%` devolvería la tabla nacional entera | `escapeLike` neutraliza ambos antes de interpolar. El paso 1 lo convierte en helper compartido justamente para que ningún consumidor futuro lo olvide |
| **`iLike` con comodín inicial (`%valor%`) no usa índice B-tree.** Cada búsqueda recorre `healthFacility` completa, y a diferencia del F50 aquí son cuatro columnas por fila, sin filtro geográfico obligatorio que reduzca el conjunto | El volumen de `healthFacility` es la red de establecimientos de un país —miles de filas, no millones—, aceptable sin índice especial. El mínimo de 2 caracteres y el `limit` máximo de 100 acotan el peor caso. Si el catálogo crece, la salida es un índice `pg_trgm` (`gin_trgm_ops`), cambio de esquema fuera de este spec |
| **La extracción de `escapeLike` toca un servicio ya implementado.** El paso 1 modifica `geoLocation.service.ts`, que pertenece al F50 y está en producción | La extracción es literal: la misma expresión cambia de sitio, no de comportamiento. §5 incluye un criterio de no regresión explícito sobre `GET /api/geo-locations?code=A_B` |
| **`Op.iLike` no ignora tildes.** "Bogota" no encuentra "Bogotá", y quien teclea sin acentos —lo habitual— no encuentra lo que busca | Limitación conocida y asumida, heredada del F50. Resolverla exige `unaccent` o una columna generada, que es cambio de esquema. Se documenta en §2 como fuera de alcance para que nadie la reporte como defecto |
| **Superficie de enumeración.** Un `USER` puede recorrer la red nacional de establecimientos con búsquedas sucesivas de dos caracteres | `healthFacility` no es información sensible: es infraestructura sanitaria pública, y el `002A` ya la expone a `USER` geolocalización por geolocalización. El `006` cambia la comodidad del recorrido, no el nivel de exposición. A diferencia del `007` de `patient`, aquí no hay datos personales de por medio |
| **Un establecimiento sin `facilityTypeItemId` desaparece del resultado** si algún `include` se escribe con `required: true` | La columna es nulable en el DDL (`esaviapp.sql:476`) y §3.4 lo declara explícitamente. §5 lo verifica con un criterio propio: una fila sin tipo debe aparecer con `facilityType: null` |
| **`count` inflado por los `include`.** `findAndCountAll` con asociaciones puede contar filas duplicadas cuando el `include` es a-muchos | Los dos `include` son `belongsTo` —a-uno—, así que no multiplican filas. Se registra el riesgo porque es un error frecuente al añadir un tercer `include` más adelante: si algún día se incluye `children`, el `count` dejará de ser fiable sin `distinct: true` |

---

## 8. Impacto en el contrato HTTP

**Cambio aditivo. Ningún endpoint existente cambia de forma.**

| | Antes | Después |
|---|---|---|
| Endpoints de `healthFacility` | 7 | 8 |
| Códigos `ESAVI-HFAC-*` | `001`, `002A`, `002B`, `003`, `004`, `005A`, `005B` | los mismos + **`006`** |
| Rutas literales antes de `/:id` | `location`, `admin`, `activate` | + **`search`** |
| Claves i18n de `healthFacility` | 25 | 26 |
| Filas en `ROUTE_RULES` | 7 | 8 |

**Endpoint nuevo:**

```
GET /api/health-facilities/search?name=&code=&geoLocationId=&limit=&offset=
ESAVI-HFAC-006 · USER · 200 | 400 | 401 | 403
```

**Lo que un cliente existente nota:** nada. No cambia ninguna ruta, ningún rol mínimo, ningún código de operación, ninguna forma de respuesta, ninguna clave i18n existente. Un cliente que no conozca el `006` funciona exactamente igual que antes.

**Lo que un cliente nuevo gana:** resolver un establecimiento por su nombre o su código sin conocer su geolocalización — una petición donde antes hacían falta N.

**Único punto de atención para el equipo de frontend:** el `006` devuelve `geoLocation` y `facilityType` embebidos, que los `002A`/`002B` no devuelven. Un componente que renderice indistintamente resultados de ambos endpoints debe tolerar la ausencia de esos dos objetos cuando los datos vienen del `002`.

---

## Lo que **no** está en este spec

- Filtros de texto en los `002A`/`002B` — se evaluó y se descartó en §6.
- La corrección de la fuga de `sysDetails` en los `002A`/`002B`.
- La corrección del tope 255 de `createHealthFacilityValidator` y `updateHealthFacilityValidator`, cinco caracteres por encima del `varchar(250)` del DDL.
- Búsqueda sobre `address`, `email` o `phone`.
- Búsqueda por el nombre del establecimiento padre, o cualquier navegación jerárquica.
- Alcance geográfico según las asignaciones del usuario (`appUserGeoLocation`) — depende del SPEC F49.
- Tolerancia a acentos o a erratas (`unaccent`, `pg_trgm`, columna generada).
- Ordenación por relevancia de la coincidencia.
- Índice de trigramas u otro cambio de esquema para acelerar el `iLike`.
- Cualquier escritura sobre `healthFacility`: el `006` es de solo lectura y este spec no declara contrato de update diferencial.

Cada uno de esos, si aterriza, va en su propio spec.
