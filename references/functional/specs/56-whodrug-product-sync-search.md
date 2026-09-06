# SPEC F56 — Espejo del estándar WHODrug y buscador de medicación concomitante

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (`buildDifferentialUpdate` — la rama de actualización del `007` lo usa), SPEC F26 (`systemConfig` — aporta la tabla y el catálogo declarativo), SPEC F43 (`appConfig.helper` — fija la precedencia `systemConfig` > `.env`), SPEC F19 (precedente de forma: lotes con transacción propia, `dryRun` e informe de proceso), SPEC F55 (precedente de consumo de un API externa con credenciales en `systemConfig`)
> **Fecha:** 2026-09-04
> **Objetivo:** Descargar el estándar WHODrug íntegro a una tabla propia y ofrecer sobre ella un buscador de medicación concomitante que excluye vacunas y filtra por país.

---

## 1. Por qué existe este spec

**`notificationMedication` no tiene maestro detrás.** El [SPEC F21](./21-notificationmedication-crud.md) dejó `medicationName` como `varchar(250)` de texto libre y `medicationCode` como texto que el propio modelo documenta así: *«Free text with no master and no foreign key behind it»*. El notificador escribe lo que lee en la caja. Dos personas escriben el mismo medicamento de tres maneras, y ninguna consulta agregada sobre medicación concomitante es fiable.

**El vocabulario que falta ya existe y está licenciado.** El API `regional-drugs` de la UMC devuelve el diccionario WHODrug completo. Los dos scripts de `references/external/` son la prueba de concepto que ya corre en producción contra DHIS2: [`01_transforme_v3.0.1.py`](../../external/01_transforme_v3.0.1.py) descarga y aplana el estándar; [`02_transforme_optionSet_v1.4.0.py`](../../external/02_transforme_optionSet_v1.4.0.py) proyecta de ahí la lista que el usuario ve hoy al registrar un concomitante — escribe el nombre comercial o el principio activo, y encuentra el medicamento.

**Este spec traslada ese mecanismo al backend, sin la capa DHIS2.** La aplicación no se conecta ni se conectará a DHIS2, así que todo lo que en el script 02 existe por y para DHIS2 desaparece: la codificación de `drugCode` en once caracteres, los identificadores de metadatos, la estructura `optionSets`/`options` y la opción de respaldo `999`. Lo que sí se conserva es lo que describe el comportamiento esperado por el usuario:

- **el nombre que lee** — `ingredientTranslations (drugName)`, con las traducciones deduplicadas y unidas por `; `;
- **la exclusión de vacunas** — un producto con algún ATC bajo `J07` no es medicación concomitante;
- **el filtro por país** — un medicamento no comercializado en el país no debería ofrecerse.

**Por qué una tabla nueva y no `vaccineWhodrug`.** El [SPEC F18](./18-vaccinewhodrug-crud.md) construyó `vaccineWhodrug` como catálogo **curado** de vacunas: trae `icd11`, `icd11Term`, `abbreviation`, `noDose` y `diluent`, columnas que el API `regional-drugs` **no devuelve** y de las que depende el árbol de cinco niveles del [SPEC F54](./54-whodrug-tree-navigation.md). Es además el destino de las claves foráneas de `notificationVaccine` e `investigationVaccineAdministered`. El API no puede ser su fuente de verdad, y mezclar en esa tabla el volcado crudo de medicamentos dejaría que una FK de vacuna apuntara a un ibuprofeno.

**El solape es deliberado y hay que dejarlo dicho.** `whodrugProduct` guarda el estándar **íntegro**, vacunas incluidas: un espejo con agujeros no es un espejo, y recortarlo en la descarga obligaría a volver a bajar el volcado el día que haga falta algo de lo excluido. En consecuencia las vacunas existen en dos tablas, con papeles distintos que no deben confundirse:

| | `vaccineWhodrug` | `whodrugProduct` |
|---|---|---|
| Qué es | catálogo curado de vacunas | espejo crudo del API |
| Fuente | fichero `.xlsx` (`ESAVI-WHODRUG-007`) | API `regional-drugs` (`ESAVI-WHODPROD-007`) |
| Quién lo referencia | `notificationVaccine`, `investigationVaccineAdministered` | nadie todavía |
| Filas `J07` | son su contenido | existen, inertes |

Las filas `J07` de `whodrugProduct` no las sirve ningún endpoint de este spec: el `006` las excluye por definición y el `002B` es de inspección. Enriquecer `vaccineWhodrug` desde ellas es una posibilidad futura, no un compromiso de este documento.

---

## 2. Alcance

**Dentro:**

- Tabla `whodrugProduct` nueva en `esaviapp.sql`, con las 18 columnas del estándar aplanado, `rowHash` como clave natural, `optionName` y `optionNameSearch` derivadas, `metadata` de procedencia y las seis transversales.
- Modelo `src/models/whodrugProduct.model.ts` y su barrel. Sin archivo de asociaciones: la tabla no tiene ni una clave foránea, ni saliente ni entrante — es el tercer caso del repositorio, tras `vaccineWhodrug` y `diagnosticTerm`.
- `ESAVI-WHODPROD-007` — `POST /api/whodrug-products/sync`, SUPERADMIN. Descarga íntegra, aplanado, alta de lo nuevo, actualización diferencial de lo existente por `rowHash`, y baja lógica de las filas que desaparecieron del estándar. Con `dryRun` e informe de proceso.
- `ESAVI-WHODPROD-006` — `GET /api/whodrug-products/search`, USER. Buscador de medicación concomitante: excluye los ATC configurados, filtra por país y devuelve `{ code, name }` a grano de medicamento.
- `ESAVI-WHODPROD-002B` — `GET /api/whodrug-products/admin`, ADMIN. Listado paginado de inspección que devuelve la fila **tal como está registrada**, con filtro por nombre o por principio activo y sin ninguna de las dos políticas del `006`.
- Siete filas nuevas en `src/data/systemConfig.defaults.ts`, scope `WHODRUG`, para que `ESAVI-SYSCONF-008` las siembre.
- Claves i18n en `es`, `en` y `nl`; filas en `ROUTE_RULES` de `tests/auth/roles.test.ts`; suite `tests/contract/whodrugProduct.test.ts`.

**Fuera de alcance (otros specs):**

- **Enlazar `notificationMedication` con el catálogo.** Ni columna FK, ni resolución implícita, ni cambio alguno en el CRUD del F21. `medicationName` y `medicationCode` siguen siendo texto libre. Es un spec propio y pequeño, y separarlo permite poblar y validar el catálogo antes de atarle una tabla de producción.
- **La opción «Otro (no consta en la lista)».** No es un medicamento y no vive en el catálogo. `notificationMedication` ya la modela con `isOtherMedication` y `otherMedicationText`.
- **Toda huella de DHIS2:** la codificación de `drugCode` a once caracteres, la generación de identificadores de metadatos y la exportación del JSON `optionSets`/`options`.
- **`001`, `004`, `005A` y `005B`.** Nadie edita a mano un espejo de un estándar externo. La única puerta de escritura es el `007`.
- **Enriquecer `vaccineWhodrug`** con las filas `J07` de esta tabla.
- **Programar el `sync`.** No hay cron, ni disparo automático, ni aviso de estándar caducado: lo lanza un SUPERADMIN cuando la UMC publica una versión nueva.
- **Sincronización asíncrona con seguimiento de progreso** (responder 202 y consultar el estado aparte). Se documenta como riesgo en §7 y es la salida si el `sync` síncrono no cabe en el timeout.
- **Restringir por idioma la búsqueda del `002B`** sobre `ingredient` frente a `ingredientTranslations`. Declarado en §3.5 como pendiente.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`whodrugProduct` **no existe en `esaviapp.sql`**. Este spec la crea, igual que el [SPEC F19](./19-vaccinewhodrug-bulk-import.md) tocó el esquema antes que el código: el DDL es autoritativo y no lo genera Sequelize, así que la tabla se escribe a mano en el fichero antes de escribir el modelo. Va en el bloque `Domain master data`, inmediatamente después de `vaccineWhodrug` (`esaviapp.sql:601-641`) y antes de `diluentCatalog` (`esaviapp.sql:643`).

**Las 18 columnas del estándar**, una por cada clave del diccionario que arma `01_transforme_v3.0.1.py:120-139`, más `drugAtcs`:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `drugCode` | `varchar(50)` | no | El código del estándar, **en claro**. Se repite entre filas por diseño: el mismo medicamento se alcanza por su presentación en cada país |
| `drugName` | `text` | no | Nombre comercial |
| `drugAtcs` | `text` | sí | **Todos** los ATC del medicamento, replicados en cada una de sus filas, delimitados por `;` al principio y al final: `;J07AN01;L03AX;` |
| `medicinalProductId` | `varchar(250)` | sí | `medicinalProductID` de nivel medicamento |
| `atcs` | `varchar(250)` | sí | **Un solo código ATC por fila** — el aplanado explota la lista. El nombre conserva el plural del origen, como en `vaccineWhodrug` |
| `ingredient` | `text` | sí | Principios activos unidos por `;`, en el orden del origen |
| `ingredientTranslations` | `text` | sí | Traducciones unidas por `;`, alineadas posicionalmente con `ingredient` |
| `languageCode` | `varchar(10)` | sí | `es-ES` cuando hubo traducción, nulo cuando no |
| `iso3Code` | `varchar(3)` | sí | Nulo cuando el producto no declara `countryOfSales` |
| `countryMedicinalProductId` | `varchar(250)` | sí | |
| `maHolders` | `text` | sí | Titular del registro sanitario |
| `maHoldersMedicinalProductId` | `varchar(250)` | sí | |
| `form` | `text` | sí | Forma farmacéutica |
| `formMedicinalProductId` | `varchar(250)` | sí | |
| `strength` | `text` | sí | Concentración |
| `strengthMedicinalProductId` | `varchar(250)` | sí | |
| `isGeneric` | `boolean` | no | `DEFAULT false` |
| `isPreferred` | `boolean` | no | `DEFAULT false` |

**Por qué existe `drugAtcs`.** La exclusión de vacunas es una regla de nivel medicamento y la tabla es de nivel presentación. El script 02 descarta el producto entero *«si al menos uno de sus códigos ATC inicia con cualquiera de los prefijos»* (`02_transforme_optionSet_v1.4.0.py:331-350`), pero el aplanado deja **un solo ATC por fila**. Un medicamento con ATC `J07AN01` y `L03AX` quedaría excluido por su primera fila y colado por la segunda. Resolverlo con una subconsulta `drugCode NOT IN (…)` sobre cientos de miles de filas es caro; con esta columna la exclusión es un predicado por fila —`"drugAtcs" NOT LIKE '%;J07%'`— fiel a la regla original. El aplanado dispone del producto completo antes de explotarlo, así que la columna no cuesta ni una consulta más. No lleva índice propio: el predicado se evalúa sobre el conjunto que ya redujeron el índice trigram y el filtro de país.

**Tres columnas propias**, que el estándar no trae y sin las cuales el mecanismo no funciona:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `rowHash` | `char(64)` | no | `UQ_whodrugProduct_rowHash`. SHA-256 en hexadecimal de la tupla que identifica la presentación. El API **no devuelve ningún identificador de fila**: sin esta clave cada `sync` duplicaría la tabla entera |
| `optionName` | `text` | no | `ingredientTranslations (drugName)` ya compuesto y normalizado. Sin límite de ancho: un `varchar(500)` seguía siendo una talla arbitraria y la carga real del estándar la excedía |
| `optionNameSearch` | `text` | no | El anterior en minúsculas y sin diacríticos. Es la única columna que toca el buscador |

Más `metadata jsonb NOT NULL DEFAULT '{}'::jsonb` para la procedencia de la carga, y las seis transversales que lleva toda tabla del esquema: `isActive`, `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. Los `DEFAULT` se copian textualmente de `vaccineWhodrug` (`esaviapp.sql:631-637`), `appDetails` incluido con su `'{}'::jsonb` — es lo que hacen las 45 tablas del fichero y este spec no abre ese frente.

**Sin ninguna clave foránea, ni saliente ni entrante.** Es la tercera tabla del repositorio en esa situación, tras `vaccineWhodrug` y `diagnosticTerm`, y la consecuencia es la misma: no hay archivo de asociaciones.

**Composición del `rowHash`.** Siete campos unidos por `|`, con la cadena vacía donde el valor sea nulo, en este orden fijo:

```
drugCode | atcs | iso3Code | countryMedicinalProductId
         | maHoldersMedicinalProductId | formMedicinalProductId | strengthMedicinalProductId
```

Son los siete que identifican unívocamente una hoja del recorrido `ATC → país → titular → forma → concentración` que el script 01 aplana. Los nombres (`maHolders`, `form`, `strength`) quedan fuera a propósito: son datos que la UMC puede corregir sin que la fila deje de ser la misma, y meterlos en la clave convertiría cada corrección de una errata en un alta más una baja. `drugAtcs` tampoco entra: es dato del medicamento, no de la presentación.

**Índices:**

| Índice | Definición | Para qué |
|---|---|---|
| `UQ_whodrugProduct_rowHash` | `UNIQUE ("rowHash")` | Clave natural del `sync` |
| `IX_whodrugProduct_search` | `USING gin ("optionNameSearch" gin_trgm_ops)` | El `ILIKE '%term%'` del `006` sobre cientos de miles de filas |
| `IX_whodrugProduct_drugCode` | `("drugCode")` | Agrupación a grano de medicamento |
| `IX_whodrugProduct_iso3Code` | `("iso3Code")` | Filtro por país del `006` |

`IX_whodrugProduct_search` **exige una extensión que el esquema no tiene**: `CREATE EXTENSION IF NOT EXISTS pg_trgm;` se añade junto a `pgcrypto` y `citext` en `esaviapp.sql:22-23`. La alternativa era imitar el `IX_vaccineWhodrug_name` (`esaviapp.sql:641`), un GIN sobre `to_tsvector('simple', ...)`, que no cubre la coincidencia por infijo: quien escribe `cetamol` no encontraría `paracetamol`, y en un autocompletar eso es un fallo, no un matiz. Queda registrado en §6.

No hace falta `unaccent`: `optionNameSearch` se calcula ya sin diacríticos en Node, en la importación, y el término de búsqueda se normaliza igual antes de la consulta.

---

### 3.2 Modelo Sequelize

`src/models/whodrugProduct.model.ts`, clase `WhodrugProduct`. Las decisiones de definición son las de §12 de las convenciones, sin desviación: `tableName: 'whodrugProduct'` en camelCase, `modelName: 'WhodrugProduct'`, `timestamps: false`, `freezeTableName: true`, y la PK `whodrugProductId` con `defaultValue: sequelize.literal('gen_random_uuid()')`.

Dos puntos donde el modelo se aparta de su vecino `vaccineWhodrug` y conviene que sea explícito:

- **`isGeneric` es binario aquí, no ternario.** En `vaccineWhodrug` la columna es anulable y `null` significa «se desconoce», porque el `.xlsx` puede callar. Aquí el aplanado del origen resuelve siempre el valor —`int(drug.get("isGeneric", False))`, `01_transforme_v3.0.1.py:39`— así que la columna es `NOT NULL DEFAULT false`. Importa porque el `006` decide con ella qué hacer con las filas sin país: un tercer estado dejaría esa regla sin definir.
- **`optionName` y `optionNameSearch` son derivadas y de escritura exclusiva del `007`.** El modelo las declara como cualquier otra columna, pero ninguna operación las recibe de un cliente. Se recalculan siempre en la importación y entran en `candidates` sin condición de presencia, como manda §11 para todo derivado.

**Sin archivo en `src/models/associations/`.** Alta en el barrel `src/models/index.ts` y nada en `initModels()` más allá de la importación del modelo.

---

### 3.3 Tipos

`src/types/whodrugProduct/whodrugProduct.types.ts`, con su `index.ts` de dominio —el barrel que `src/types/healthFacility/` no tiene y que las convenciones sí piden para toda entidad nueva— y alta en `src/types/index.ts`.

**No hay `CreateWhodrugProductInput`.** No existe el `001`: la única puerta de escritura es la importación, y lo que ésta construye no es el body de un cliente sino la fila aplanada. El tipo que ocupa ese lugar es `WhodrugProductFlatRow`:

```ts
// Una hoja del recorrido ATC → país → titular → forma → concentración, ya aplanada
export interface WhodrugProductFlatRow {
    rowHash: string;
    drugCode: string;
    drugName: string;
    drugAtcs?: string | null;
    medicinalProductId?: string | null;
    atcs?: string | null;
    ingredient?: string | null;
    ingredientTranslations?: string | null;
    languageCode?: string | null;
    iso3Code?: string | null;
    countryMedicinalProductId?: string | null;
    maHolders?: string | null;
    maHoldersMedicinalProductId?: string | null;
    form?: string | null;
    formMedicinalProductId?: string | null;
    strength?: string | null;
    strengthMedicinalProductId?: string | null;
    isGeneric: boolean;
    isPreferred: boolean;
    optionName: string;
    optionNameSearch: string;
}
```

**El contrato del API externa se tipa, no se navega a ciegas.** Siete interfaces que describen lo que devuelve `regional-drugs`, con todo opcional porque nada de lo que manda un tercero está garantizado: `WhodrugApiDrug`, `WhodrugApiAtc`, `WhodrugApiIngredient`, `WhodrugApiCountry`, `WhodrugApiMaHolder`, `WhodrugApiForm` y `WhodrugApiStrength`. Es lo que evita que el aplanado se escriba sobre `any` y que un `null` en `maHolders` reviente el lote en vez de dejar la columna vacía.

**La configuración resuelta**, con la misma forma que `MeddraResolvedConfig` (`src/services/meddra.service.ts`):

```ts
export interface WhodrugDownloadConfig {
    clientKey: string;
    licenseKey: string;
    downloadUrl: string;
    downloadParams: Record<string, string>;
}

export interface WhodrugSearchPolicy {
    countryIso3: string;
    excludedAtcPrefixes: string[];
}
```

**El `007`**, con la forma que fijó el F19:

```ts
export interface SyncWhodrugProductsInput {
    dictionaryVersion?: string;
    dryRun?: boolean;
}

export interface WhodrugProductSyncReport {
    downloaded: number;    // productos que devolvió el API
    flattened: number;     // filas tras aplanar
    inserted: number;
    updated: number;
    unchanged: number;
    deactivated: number;   // filas que ya no están en el estándar
    invalid: number;
    duplicated: number;    // mismo rowHash dos veces en la misma descarga
    dryRun: boolean;
    errors: RejectedWhodrugProduct[];   // solo las 20 primeras
}

export interface RejectedWhodrugProduct {
    drugCode: string | null;
    reason: 'EMPTY_DRUG_CODE' | 'EMPTY_DRUG_NAME' | 'EMPTY_OPTION_NAME'
          | 'VALUE_TOO_LONG' | 'DUPLICATE_IN_DOWNLOAD';
    column?: string;
}
```

`RejectedWhodrugProduct` se aparta de `RejectedVaccineWhodrugRow` en una cosa: no lleva número de fila. En un `.xlsx` el número lleva al revisor a la celda; en una respuesta JSON del API no señala nada que nadie pueda abrir, y el `drugCode` sí.

**El `006` y el `002B`:**

```ts
export interface WhodrugSearchOption {
    code: string;    // drugCode en claro
    name: string;    // optionName
}

export interface WhodrugProductListFilters {
    name?: string;         // ILIKE sobre drugName
    ingredient?: string;   // ILIKE sobre ingredient e ingredientTranslations
    limit?: number;
    offset?: number;
}
```

El update usa `Partial<>` de lo que corresponda; **no se declara ningún `UpdateWhodrugProductInput`**, prohibido por §4 de las convenciones.

---

### 3.4 Superficie HTTP

```
GET    /api/whodrug-products/search    ESAVI-WHODPROD-006   USER        (nuevo)
GET    /api/whodrug-products/admin     ESAVI-WHODPROD-002B  ADMIN       (nuevo)
POST   /api/whodrug-products/sync      ESAVI-WHODPROD-007   SUPERADMIN  (nuevo)
```

Alta en `src/routes/index.ts` bajo `/api/whodrug-products`. La cadena de middlewares es la invariable de §8:

```ts
router.get('/search', tokenValidation, validateUserRole(USER), ...searchWhodrugProductsValidator, validateFields, searchWhodrugProducts);
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...whodrugProductListValidator, validateFields, getAllWhodrugProducts);
router.post('/sync', tokenValidation, validateUserRole(SUPERADMIN), ...syncWhodrugProductsValidator, validateFields, syncWhodrugProducts);
```

**Las tres rutas son literales y no hay ninguna `/:id`.** Es la primera vez en el repositorio que un router no lo tiene, así que aquí no existe el riesgo de que Express capture `admin` como un UUID. La nota de orden de declaración sigue valiendo hacia el futuro: **si algún día se añade un `003`, va declarado después de las tres**.

**No hay `002A`.** El listado público no existe porque el `006` ocupa ese lugar: quien no es ADMIN no lista el espejo, busca en él. Y no hay `003` porque el `006` devuelve `code` y `name`, no identificadores — no hay ficha que abrir después.

**El `002B` no aplica ninguna de las dos políticas del `006`.** Es un endpoint de inspección: devuelve la fila tal como está registrada, vacunas incluidas, sin filtro de país. Su razón de ser es poder comprobar qué entró en la última descarga sin abrir una consola de `psql`.

**El `007` es de ejecución única concurrente.** Una bandera en memoria del proceso rechaza una segunda sincronización mientras hay una en vuelo → 409 `WHODPROD_007_ALREADY_RUNNING`. No es un limitador de tasa como el `meddraSearchLimiter` del F55 —aquel existe porque cada búsqueda consume licencia por cuenta—: aquí el problema es que dos descargas simultáneas se pisen las bajas lógicas entre sí.

**El `006` no lleva limitador.** Consulta la base local; el coste por pulsación es un índice trigram, no una llamada a un API licenciado.

---

### 3.5 Reglas de negocio por operación

#### `ESAVI-WHODPROD-007` — sincronizar el espejo

Ocho pasos, en este orden:

1. **Interruptor.** `getAppConfigBoolean('ESAVI_WHODRUG_ENABLED', 'WHODRUG', lang)`. En `false` → **503** `WHODPROD_007_DISABLED`, sin salir a la red. Se siembra apagado, por la misma razón que el F55 siembra apagado MedDRA: un despliegue recién sincronizado no debe empezar a llamar a un API licenciado por haber corrido el `ESAVI-SYSCONF-008`.
2. **Configuración.** Las dos credenciales, la URL y los parámetros, por `appConfig.helper`. El `APPCONFIG_VALUE_MISSING` se traduce a **503** `WHODPROD_007_NOT_CONFIGURED`: que WHODrug no esté configurado no es un fallo del servidor, es un servicio que este despliegue no ofrece. Se resuelve en cada llamada y no se cachea.
3. **Descarga.** `GET` con las cabeceras `umc-client-key` y `umc-license-key` y los parámetros configurados, bajo un `AbortController` con `WHODRUG_DOWNLOAD_TIMEOUT_MS`. Respuesta no 2xx, cuerpo que no es un array, o timeout → **502** `WHODPROD_007_DOWNLOAD_FAILED`.
4. **Aplanado.** El anidamiento de `01_transforme_v3.0.1.py:76-139`, tal cual: `ATC → país → titular → forma → concentración`, con la rama de nulos que emite una fila aunque el nivel esté vacío. **Sin exclusión de ATC y sin filtro de país** — el espejo es íntegro.
5. **Derivados por fila.** `optionName` con la regla de `build_option_name` —traducciones deduplicadas sin distinguir mayúsculas, unidas por `; `, entre paréntesis el `drugName`— pero **sin el truncado a 230 caracteres**: ese límite era una validación de DHIS2 y aquí la columna es `text`, sin ancho que respetar. Después `optionNameSearch`, `drugAtcs` y `rowHash`.
6. **Rechazos.** Fila sin `drugCode`, sin `drugName` o con `optionName` vacío → `errors`, contada en `invalid`. Valor que excede el ancho de su columna → `VALUE_TOO_LONG` con `column`. Dos filas con el mismo `rowHash` en la misma descarga → gana la primera, contada en `duplicated`.
7. **Escritura por lotes de 1000, cada uno en su propia transacción.** Por lote: lectura de las filas existentes con `rowHash` `Op.in`, alta de las que no están, y para las que sí, las ramas descritas abajo.
8. **Bajas.** Los `rowHash` que la tabla tiene activos y esta descarga no trajo.

Con `dryRun: true` se recorre todo y no se escribe nada: los contadores del informe salen calculados y `dryRun` viaja en `true`.

Respuesta **200**, no 201: lo que devuelve no es un recurso creado sino el informe de un proceso. Es la decisión del F19 y se mantiene.

**`metadata` se sella en el alta y no se vuelve a tocar.** Lleva `{ source: 'UMC_REGIONAL_DRUGS', dictionaryVersion, downloadedAt, params }`. Si entrara en el diferencial, `downloadedAt` garantizaría una diferencia en cada sincronización y **todas las filas se reescribirían siempre**: el contrato diferencial quedaría de adorno y `appDetails` crecería una entrada por fila y por descarga. La procedencia que interesa conservar es la del alta.

##### Contrato de update diferencial — rama de actualización del `007`

`stored` sale de `row.get({ plain: true })`, la fila completa y sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío **no se escribe**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`, y la fila cuenta como `unchanged`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `drugName` | **siempre**: `flat.drugName` | derivado del origen, no de un cliente: no hay presencia de clave que comprobar |
| `drugAtcs` | **siempre**: `flat.drugAtcs ?? null` | anulable |
| `medicinalProductId` | **siempre**: `flat.medicinalProductId ?? null` | anulable |
| `atcs` | **siempre**: `flat.atcs ?? null` | anulable |
| `ingredient` | **siempre**: `flat.ingredient ?? null` | anulable |
| `ingredientTranslations` | **siempre**: `flat.ingredientTranslations ?? null` | anulable |
| `languageCode` | **siempre**: `flat.languageCode ?? null` | anulable |
| `maHolders` | **siempre**: `flat.maHolders ?? null` | anulable |
| `form` | **siempre**: `flat.form ?? null` | anulable |
| `strength` | **siempre**: `flat.strength ?? null` | anulable |
| `isGeneric` | **siempre**: `flat.isGeneric` | binario, nunca `null` |
| `isPreferred` | **siempre**: `flat.isPreferred` | binario, nunca `null` |
| `optionName` | **siempre**, recalculado | derivado: lo decide el helper, no un `if` de presencia |
| `optionNameSearch` | **siempre**, recalculado | derivado |
| `drugCode` | **no entra** | forma parte del `rowHash`: si cambiara sería otra fila |
| `iso3Code`, `countryMedicinalProductId`, `maHoldersMedicinalProductId`, `formMedicinalProductId`, `strengthMedicinalProductId` | **no entran** | los cinco forman parte del `rowHash`, por el mismo motivo |
| `rowHash` | **no entra** | es la clave por la que se localizó la fila |
| `metadata` | **no entra** | ver arriba: `downloadedAt` haría diferir toda fila en toda descarga |
| `isActive`, `deletedAt` | **no entran** | los mueven las dos escrituras con intención propia de abajo |

Aquí ningún campo entra bajo condición de presencia, y es deliberado: **el `007` no recibe un body parcial, recibe el estándar completo**. Un valor que el API dejó de mandar es un valor que se borró, y tiene que llegar al diff como `null` — no como `undefined`. La forma `data.x !== undefined ? (data.x ?? null) : undefined` que usan los `004` del repositorio aquí sería un error: dejaría la fila con datos que el estándar ya no tiene.

No hay campos cifrados ni comprobaciones de unicidad o de clave foránea previas al diff: la tabla no tiene FKs y su único `UNIQUE` es el `rowHash`, que es cómo se encontró la fila.

##### Las dos escrituras que **no** son diferenciales

- **Baja lógica de lo retirado.** Una fila activa cuyo `rowHash` no vino en la descarga pasa a `isActive: false` con `deletedAt`. Registra un hecho —«este producto ya no está en el estándar»— y por eso no pasa por el helper. Entrada en `appDetails` con `method: 'ESAVI-WHODPROD-007'` y `detail` indicando la retirada. Cuenta en `deactivated`.
- **Reactivación de lo que vuelve.** Una fila inactiva cuyo `rowHash` sí vino se reactiva: `isActive: true`, `deletedAt: null`. Es la simétrica de la anterior y una reactivación nunca es diferencial, igual que en el `005B` canónico. Su entrada de auditoría es independiente del diff de datos, que se aplica en la misma pasada si además algún valor cambió.

##### Auditoría

Toda escritura —alta, actualización diferencial, baja y reactivación— añade su entrada a `appDetails` preservando el histórico con `[...currentAppDetails, newEntry]`, con `user: authUser.userId` y `method: 'ESAVI-WHODPROD-007'`. Una fila `unchanged` no recibe ninguna.

---

#### `ESAVI-WHODPROD-006` — buscar medicación concomitante

`term` obligatorio, **mínimo 3 caracteres tras `trim`**, máximo 250. Lo impone el validador → **400** por `validateFields`, siguiendo el precedente de `healthFacility.validator.ts:21-26`, que valida en el validador las longitudes mínimas de `name` y `code`.

`limit` opcional, por defecto **20**, tope **50**.

El servicio normaliza el término igual que se normalizó la columna —minúsculas y sin diacríticos— y consulta:

```
DISTINCT ON ("drugCode")   →   "drugCode", "optionName"

WHERE  "isActive" = true  AND  "deletedAt" IS NULL
  AND  "optionNameSearch" LIKE '%<término normalizado>%'
  AND  "drugAtcs" NOT LIKE '%;J07%'                       ← un predicado por prefijo configurado
  AND  ( "iso3Code" = '<país configurado>'
         OR ( "iso3Code" IS NULL AND "isGeneric" = true ) )

ORDER BY  "drugCode", "isPreferred" DESC, "optionName"
LIMIT     <limit>
```

Cuatro puntos que la consulta decide y conviene que estén escritos:

- **La política es configuración, no parámetro.** `ESAVI_WHODRUG_SEARCH_COUNTRY` y `ESAVI_WHODRUG_SEARCH_EXCLUDED_ATC` se resuelven por `appConfig.helper` en cada búsqueda. El cliente no puede pedir vacunas ni cambiar de país: si pudiera, la exclusión dejaría de ser una regla del sistema.
- **Las filas sin país entran solo si el producto es genérico.** Un genérico sin `countryOfSales` es una laguna del volcado y ocultarlo dejaría fuera del buscador buena parte de la medicación más común; un producto de marca sin país declarado no tiene por qué ofrecerse en este despliegue.
- **`DISTINCT ON ("drugCode")` colapsa a grano de medicamento.** El `ORDER BY` empieza obligatoriamente por `"drugCode"` —lo exige Postgres— y sigue por `"isPreferred" DESC`, de modo que entre las N presentaciones de un medicamento gane la preferida. Como `optionName` depende solo de campos de nivel medicamento, todas las filas de un mismo `drugCode` producen el mismo nombre: el desempate es determinista, no arbitrario.
- **No se deduplica por nombre.** El script 02 descarta un producto cuyo `drugName` ya apareció (`collect_unique_options`, líneas 391-396). Para un `optionSet` de DHIS2 tiene sentido; para un buscador haría desaparecer productos distintos que comparten nombre comercial. Aquí la única deduplicación es por `drugCode`.

Fallo de la consulta → **500** `WHODPROD_006_FETCH_FAILED`. Configuración ausente → **503** `WHODPROD_006_NOT_CONFIGURED`. **El servicio no escribe nada**: no hay `appDetails`, ni `sysDetails`, ni auditoría, igual que el `ESAVI-MEDDRA-006`.

---

#### `ESAVI-WHODPROD-002B` — listar para inspección

Paginado con `findAndCountAll`, `DEFAULT_LIMIT` y `DEFAULT_OFFSET` de `pagination.constants.ts`. Dos filtros opcionales, ambos con mínimo 3 caracteres y `Op.iLike` como en `HFAC-006` y `CATITEM-007`:

- `name` → sobre `drugName`.
- `ingredient` → sobre `ingredient` **e** `ingredientTranslations`, unidos por `Op.or`. Que el principio activo se busque en las dos columnas es el punto: el operador escribe indistintamente `paracetamol` o `acetaminophen`.

Orden por defecto `drugName ASC, drugCode ASC`. **Sin exclusión de ATC y sin filtro de país** — es un espejo y se inspecciona entero. Las filas inactivas se incluyen: `002B` es la variante de administración y `canViewInactive(req.user)` es verdadero para ADMIN. Fallo → **500** `WHODPROD_002B_FETCH_FAILED`.

> **Pendiente declarado, no implementado.** El filtro `ingredient` busca hoy en `ingredient` **e** `ingredientTranslations`, siempre y con independencia de `req.lang`. Es lo correcto mientras el operador de este endpoint sea un administrador que inspecciona el espejo. A futuro puede requerirse que **cuando el idioma no sea inglés la búsqueda se restrinja a `ingredientTranslations`**: `ingredient` viene del estándar en inglés, y en una interfaz en español ofrecer coincidencias sobre la columna inglesa mezcla dos vocabularios en un mismo resultado. El cambio es un `Op.or` que se vuelve condicional sobre `req.lang`, sin tocar el esquema ni el contrato. No se implementa aquí porque `req.lang` hoy resuelve el idioma del **mensaje**, no el del **dato**, y hacerlo gobernar además la consulta es una decisión transversal que merece su propio spec.

---

### 3.6 Claves i18n nuevas

En los **tres** archivos, `src/data/i18n/{es,en,nl}.json`. `tests/i18n/messages.test.ts` exige paridad exacta.

| Clave | Uso |
|---|---|
| `whodrugProduct.searched` | 200 del `006` |
| `whodrugProduct.listed` | 200 del `002B` |
| `whodrugProduct.synced` | 200 del `007`, con el informe |
| `whodrugProduct.syncDisabled` | 503 — `ESAVI_WHODRUG_ENABLED` en `false` |
| `whodrugProduct.notConfigured` | 503 — falta configuración en el `006` o en el `007` |
| `whodrugProduct.downloadFailed` | 502 — el API de la UMC no respondió o respondió algo que no es una lista |
| `whodrugProduct.syncAlreadyRunning` | 409 — ya hay una sincronización en vuelo |
| `whodrugProduct.syncFailed` | 500 — fallo al escribir los lotes |
| `whodrugProduct.searchFailed` | 500 — fallo de la consulta del `006` |
| `whodrugProduct.fetchFailed` | 500 — fallo de la consulta del `002B` |

---

### 3.7 Forma de la respuesta

**`006` — búsqueda.** Un autocompletar no pagina: no hay `offset`, no hay total y `count` es cuántas filas van en `rows`.

```
{ ok, message, data: {
    term,
    count,
    rows: [ { code, name } ]
} }
```

`count` sale de `rows.length`, y cuando iguala el `limit` significa que hubo más y el cliente debe afinar el término. Conserva `{ count, rows }`, la forma que tienen todos los listados del repositorio, en vez de devolver el array pelado.

**`002B` — listado.** `{ count, rows }` de `findAndCountAll`, con la fila completa:

```
{ ok, message, data: {
    count,
    rows: [ {
        whodrugProductId, rowHash, drugCode, drugName, drugAtcs, medicinalProductId, atcs,
        ingredient, ingredientTranslations, languageCode,
        iso3Code, countryMedicinalProductId, maHolders, maHoldersMedicinalProductId,
        form, formMedicinalProductId, strength, strengthMedicinalProductId,
        isGeneric, isPreferred, optionName, optionNameSearch, metadata,
        isActive, createdAt, updatedAt, deletedAt, appDetails
    } ]
} }
```

`sysDetails` **no se expone**, en ningún endpoint: es la regla de §10 y aquí no hay excepción.

**`007` — sincronización.** `data` es el `WhodrugProductSyncReport` de §3.3, íntegro, con `errors` recortado a las 20 primeras entradas.

---

## 4. Plan de implementación

Catorce pasos. Cada uno deja el repositorio compilando y arrancable, y cada uno se puede committear solo.

1. **Esquema.** `CREATE EXTENSION IF NOT EXISTS pg_trgm;` junto a `pgcrypto` y `citext` (`esaviapp.sql:22-23`). `CREATE TABLE IF NOT EXISTS "whodrugProduct"` con las 18 columnas del estándar, las tres propias, `metadata` y las seis transversales, más los cuatro índices de §3.1. Va después de `vaccineWhodrug` (`esaviapp.sql:641`) y antes de `diluentCatalog` (`esaviapp.sql:643`).
   *Verificación:* cargar `esaviapp.sql` en una base limpia termina sin error y `\d "whodrugProduct"` lista las 28 columnas y los cuatro índices.

2. **Modelo.** `src/models/whodrugProduct.model.ts`, clase `WhodrugProduct`, alta en el barrel `src/models/index.ts`. Sin archivo de asociaciones y sin tocar `initModels()` más allá de la importación.
   *Verificación:* `npm run build` en 0 y `WhodrugProduct.findAll({ limit: 1 })` devuelve `[]` contra la base recién cargada.

3. **Tipos.** `src/types/whodrugProduct/whodrugProduct.types.ts` con las interfaces de §3.3, su `index.ts` de dominio y alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `import { WhodrugProductFlatRow } from '../types'` resuelve.

4. **Constantes.** `src/constants/whodrug.constants.ts` con el scope `WHODRUG`, los siete códigos de configuración, `WHODRUG_DOWNLOAD_TIMEOUT_MS`, `WHODRUG_BATCH_SIZE` (1000), `WHODRUG_SEARCH_DEFAULT_LIMIT` (20), `WHODRUG_SEARCH_MAX_LIMIT` (50) y `WHODRUG_SEARCH_MIN_TERM_LENGTH` (3). Ni un literal suelto en el servicio, como en `meddra.constants.ts`.
   *Verificación:* `grep -n "1000\|'WHODRUG'" src/services/whodrugProduct.service.ts` no devuelve resultados.

5. **Configuración sembrada.** Siete entradas nuevas en `src/data/systemConfig.defaults.ts`, scope `WHODRUG`: `ESAVI_WHODRUG_ENABLED` (`boolean`, **sembrado en `false`**), `ESAVI_WHODRUG_CLIENT_KEY` y `ESAVI_WHODRUG_LICENSE_KEY` (`string`, `isEncrypted: true`, sembradas vacías), `ESAVI_WHODRUG_DOWNLOAD_URL`, `ESAVI_WHODRUG_DOWNLOAD_PARAMS` (`json`, con `MedProdLevel`, `IncludeAtc` e `IngredientTranslations`), `ESAVI_WHODRUG_SEARCH_COUNTRY` y `ESAVI_WHODRUG_SEARCH_EXCLUDED_ATC`.
   *Verificación:* `POST /api/system-configs/sync` crea siete filas; una segunda llamada no crea ninguna y no pisa valores ya cargados.

6. **i18n.** Las diez claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

7. **Aplanado.** `src/helpers/whodrugFlatten.helper.ts`: el recorrido de cinco niveles, la composición de `optionName`, la normalización de `optionNameSearch`, el armado de `drugAtcs` y el cálculo de `rowHash`. Es una función pura sobre el JSON del API, sin base de datos y sin red. Alta en el barrel de `helpers/`.
   *Verificación:* una prueba unitaria sobre un fixture de tres productos —uno sin `countryOfSales`, uno con dos ATC, uno sin traducciones— produce el número de filas esperado; el mismo fixture aplanado dos veces da los mismos `rowHash`.

8. **Validadores.** `src/validators/whodrugProduct.validator.ts` con `searchWhodrugProductsValidator`, `whodrugProductListValidator` y `syncWhodrugProductsValidator`. Alta en el barrel.
   *Verificación:* `GET /search?term=ab` responde 400; `?term=abc` pasa al controlador.

9. **`ESAVI-WHODPROD-002B` — listar para inspección.** Servicio, controlador y ruta `GET /admin`. Va antes que el `007` a propósito: es el instrumento con el que se comprueba qué escribió la sincronización.
   *Verificación:* contra la tabla vacía responde 200 con `{ count: 0, rows: [] }`; un USER recibe 403.

10. **`ESAVI-WHODPROD-007` — sincronizar.** Servicio con los ocho pasos de §3.5, controlador y ruta `POST /sync`. Incluye la bandera de ejecución única, la rama diferencial con `buildDifferentialUpdate`, las bajas y las reactivaciones.
    *Verificación:* con `ESAVI_WHODRUG_ENABLED` en `false` responde 503 sin salir a la red; con `dryRun: true` el informe trae contadores y `COUNT(*)` sigue en 0; una primera pasada real inserta N filas y el `002B` las muestra.

11. **La segunda pasada.** No es código nuevo: es el paso en que se verifica el contrato diferencial del `007` con datos reales.
    *Verificación:* repetir el `sync` sobre la misma descarga devuelve `inserted: 0`, `updated: 0`, `unchanged: N`; `SELECT COUNT(*) FROM "whodrugProduct" WHERE "updatedAt" IS NOT NULL` sigue en 0.

12. **`ESAVI-WHODPROD-006` — buscar.** Servicio, controlador y ruta `GET /search`, con la consulta de §3.5 y la política resuelta por `appConfig.helper`.
    *Verificación:* un término que coincide con una vacuna devuelve 0 resultados; un término que coincide con un medicamento de N presentaciones devuelve **una** fila; ningún resultado trae `iso3Code` distinto del configurado salvo genéricos sin país.

13. **Registro de la abreviatura.** `WHODPROD` en la tabla de §6 de `references/CONVENTIONS.md`, y las dos filas de operaciones no canónicas: `whodrugProduct | 006 | búsqueda de medicación concomitante` y `whodrugProduct | 007 | sincronización del estándar desde el API de la UMC`.
    *Verificación:* la abreviatura aparece una sola vez en la tabla y no colisiona con `WHODRUG`.

14. **Pruebas.** Las tres rutas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y la suite `tests/contract/whodrugProduct.test.ts`, con `healthFacility.test.ts` como referencia de forma.
    *Verificación:* `npm run check` sale en 0.

---

## 5. Criterios de aceptación

- [ ] `esaviapp.sql` carga en una base limpia y `whodrugProduct` queda con sus 28 columnas, su `UNIQUE` sobre `rowHash` y sus cuatro índices.
- [ ] Las tres rutas de §3.4 responden con su status esperado, y con 403 a un rol por debajo del suyo.
- [ ] Los cinco lugares del código de operación —ruta, controlador, servicio, `AppError` y `appDetails.method`— coinciden en las tres operaciones.
- [ ] `grep -rn "ESAVI-WHODPROD-002[^B]" src/` no devuelve resultados.
- [ ] `grep -rn "umc-client-key\|umc-license-key" src/` devuelve solo nombres de cabecera, nunca un valor.
- [ ] Con `ESAVI_WHODRUG_ENABLED` en `false`, el `007` responde **503** y no abre ninguna conexión saliente.
- [ ] Sin las dos credenciales configuradas, el `007` responde **503** y el `006` responde **503**.
- [ ] Un `007` con `dryRun: true` devuelve el informe completo y deja `SELECT COUNT(*) FROM "whodrugProduct"` en 0.
- [ ] Un segundo `007` lanzado mientras hay uno en vuelo responde **409**.
- [ ] Tras una sincronización real, `SELECT COUNT(DISTINCT "rowHash") = COUNT(*)` es verdadero.
- [ ] Un producto con ATC `J07AN01` **está** en la tabla y **no** aparece en ningún resultado del `006`.
- [ ] Un producto con dos ATC, uno `J07` y otro no, no aparece en ningún resultado del `006` por ninguna de sus filas.
- [ ] Un medicamento con N presentaciones devuelve **una sola** fila en el `006`.
- [ ] Un genérico con `iso3Code` nulo aparece en el `006`; un producto de marca con `iso3Code` nulo no aparece.
- [ ] `GET /search?term=ab` responde **400**; `?term=abc` responde **200**.
- [ ] `GET /search?limit=500` devuelve como mucho 50 filas.
- [ ] Un `name` del `002B` que coincide con una vacuna **sí** la devuelve: el listado de inspección no aplica la exclusión de ATC.
- [ ] Las diez claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

**Bloque obligatorio de update diferencial.** Este spec no tiene `004` ni `PUT`: la única operación que escribe sobre filas existentes es la rama de actualización del `007`. Los cinco criterios del canon se trasladan a ella conservando lo que cada uno discrimina, y el primero queda **más fuerte** que su original — donde un `PUT` reenvía la respuesta de su `GET`, aquí se reenvía el estándar entero:

- [ ] Un `007` que vuelve a descargar el mismo estándar responde **200** sin escribir nada: `inserted: 0`, `updated: 0`, `unchanged: N`, ninguna fila crece en `appDetails`, ninguna avanza `sysDetails.version` y `updatedAt` sigue en `NULL` en todas.
- [ ] Un `007` sobre una descarga que solo trae filas ya guardadas se comporta igual que el anterior.
- [ ] Un `007` sobre una descarga en la que **un solo** campo de **una sola** fila cambió devuelve `updated: 1` y `unchanged: N-1`, añade **una** entrada a `appDetails` de esa fila y avanza su `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/whodrugProduct.service.ts` no devuelve resultados.
- [ ] El quinto criterio del canon —FK inactiva 404, `code` ocupado 409— **no aplica**: la tabla no tiene ninguna clave foránea y su único `UNIQUE` es el `rowHash`, que es cómo se localiza la fila y no una colisión posible. Se sustituye por: dos filas de la misma descarga con el mismo `rowHash` no provocan `SequelizeUniqueConstraintError`; la segunda cuenta en `duplicated`.

**Criterios de las dos escrituras con intención propia**, que por definición no pasan por el helper:

- [ ] Un `rowHash` activo que la descarga no trae queda con `isActive: false` y `deletedAt` sellado, cuenta en `deactivated` y recibe su entrada en `appDetails`.
- [ ] Una fila dada de baja que reaparece en una descarga posterior vuelve a `isActive: true` con `deletedAt` en `NULL`, y recibe su entrada en `appDetails` aunque ningún campo de datos haya cambiado.
- [ ] Una fila desactivada no aparece en el `006`, y sí en el `002B`.
- [ ] `metadata.downloadedAt` de una fila insertada en la primera sincronización **no cambia** tras la segunda.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** tabla nueva e independiente de `vaccineWhodrug`. Las dos fuentes no son intercambiables —el `.xlsx` curado trae `icd11`, `abbreviation`, `noDose` y `diluent`, que el API no devuelve— y `vaccineWhodrug` es el destino de dos claves foráneas que no deben poder apuntar a un medicamento.
- **No:** una sola tabla `whodrugProduct` con discriminador por ATC que absorbiera también a `vaccineWhodrug`. Es la consolidación natural a futuro, pero hoy costaría tocar el F18, el F19, el F54 y dos FKs a cambio de nada.
- **Sí:** guardar el estándar **íntegro**, vacunas incluidas. Un espejo con agujeros no es un espejo, y recortarlo obligaría a volver a descargar el volcado el día que haga falta algo de lo excluido. El precio es que las vacunas existan en dos tablas; se documenta en §1 para que sea decisión y no descuido.
- **Sí:** la exclusión de ATC y el filtro de país en el **`006`**, no en el `007`. La política de qué es medicación concomitante puede cambiar sin volver a bajar 500 MB.
- **Sí:** `rowHash` como clave natural. El API no devuelve ningún identificador de fila. Sin ella, cada sincronización duplicaría la tabla entera.
- **No:** usar el `id` del fichero como hizo el F19 con `externalId`. Ese `id` existe en el `.xlsx` de vacunas y no en la respuesta del API; no hay nada equivalente que reutilizar.
- **No:** incluir `maHolders`, `form` y `strength` en el `rowHash`. Son datos que la UMC corrige sin que la presentación deje de ser la misma; incluirlos convertiría cada corrección de una errata en un alta más una baja.
- **Sí:** `drugAtcs` replicando en cada fila todos los ATC del medicamento. Es la única forma barata de aplicar una regla de nivel medicamento sobre una tabla de nivel presentación. La alternativa, `drugCode NOT IN (subconsulta)`, cuesta un recorrido extra por búsqueda.
- **Sí:** `pg_trgm` y un índice GIN sobre `optionNameSearch`.
- **No:** imitar el `IX_vaccineWhodrug_name`, GIN sobre `to_tsvector('simple', ...)`. No cubre la coincidencia por infijo: quien escribe `cetamol` no encontraría `paracetamol`, y en un autocompletar eso es un fallo.
- **No:** la extensión `unaccent`. `optionNameSearch` se calcula ya sin diacríticos en Node y el término se normaliza igual antes de consultar; una extensión menos que instalar en cada despliegue.
- **Sí:** baja lógica de lo que desaparece del estándar. Un medicamento retirado no debe seguir apareciendo en un autocompletar, y el soft delete conserva la fila para lo que ya la referencie.
- **No:** borrado físico de lo retirado, ni dejarlo intacto. Lo primero rompe cualquier referencia histórica; lo segundo hace crecer el buscador con productos que ya no existen.
- **Sí:** `metadata` sellada en el alta y fuera de `candidates`. Con `downloadedAt` dentro del diferencial, toda fila diferiría en toda descarga y el contrato quedaría de adorno.
- **Sí:** las filas sin país entran en el `006` solo si `isGeneric` es verdadero. Un genérico sin `countryOfSales` es una laguna del volcado; un producto de marca sin país declarado no tiene por qué ofrecerse en este despliegue.
- **Sí:** deduplicar solo por `drugCode`. La deduplicación adicional por `drugName` del script 02 (líneas 391-396) es correcta para un `optionSet` y haría desaparecer de un buscador productos distintos que comparten nombre comercial.
- **Sí:** devolver `{ code, name }` y nada más en el `006`. Es un autocompletar que dispara por pulsación; la fila completa se consulta por el `002B`.
- **No:** endpoints `001`, `004`, `005A` y `005B`. Nadie edita a mano un espejo de un estándar externo, y `vaccineWhodrug` ya demostró que un alta manual sin importación no puebla nada.
- **No:** la opción `999 — Otro (no consta en la lista)` en el catálogo o en la respuesta. No es un medicamento; `notificationMedication` ya la modela con `isOtherMedication` y `otherMedicationText`.
- **No:** la codificación de `drugCode` del script 02 y su columna `dhis2Code`. La aplicación no se conecta a DHIS2; conservar la transformación sería mantener para siempre una vuelta que nadie deshace.
- **Sí:** bandera de ejecución única en el `007`, con 409. Dos descargas simultáneas se pisarían las bajas lógicas entre sí.
- **No:** limitador de tasa en el `006`. Consulta la base local: no consume licencia por llamada, que es lo que justifica el `meddraSearchLimiter` del F55.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El `sync` síncrono no cabe en el ciclo request/response: descarga el volcado regional completo, lo aplana y escribe cientos de miles de filas | Lotes de 1000 con transacción propia, `dryRun` obligatorio en la primera pasada y `WHODRUG_DOWNLOAD_TIMEOUT_MS` explícito. Si aun así se agota el timeout, la salida es responder 202 y consultar el progreso aparte — declarado fuera de alcance en §2 |
| Las credenciales `umc-client-key` y `umc-license-key` viajan literales en los dos scripts versionados de `references/external/` | Parecen valores de ejemplo; si no lo son, hay que rotarlas. En el backend van cifradas en `systemConfig` y nunca en el código: lo cubre el criterio del `grep` en §5 |
| El volumen de `appDetails` crece con cada sincronización que sí cambia filas | Solo las filas que difieren reciben entrada; una descarga idéntica no escribe ninguna. Es exactamente lo que garantiza el bloque diferencial de §5 |
| Un cambio de formato del API de la UMC deja columnas en nulo sin que nadie se entere | El aplanado se escribe sobre las siete interfaces tipadas de §3.3, y el informe del `007` cuenta `invalid` y `flattened`: una caída brusca de `flattened` entre dos descargas es la señal |
| `whodrugProduct` y `vaccineWhodrug` contienen ambas las vacunas y alguien las confunde | La tabla comparativa de §1 y la ausencia de todo endpoint que sirva filas `J07` desde `whodrugProduct` |
| El índice trigram no basta con términos de 3 caracteres muy comunes | El `LIMIT` de 50 acota la respuesta; si aparece latencia, la palanca es subir `WHODRUG_SEARCH_MIN_TERM_LENGTH`, que es una constante y no un cambio de esquema |

---

## Lo que **no** está en este spec

- Enlazar `notificationMedication` con el catálogo: ni columna FK, ni resolución implícita, ni cambio alguno en el CRUD del SPEC F21.
- La opción «Otro (no consta en la lista)».
- Los endpoints `001`, `004`, `005A` y `005B`.
- Toda huella de DHIS2: la codificación de `drugCode`, los identificadores de metadatos y la exportación del JSON `optionSets`/`options`.
- Enriquecer `vaccineWhodrug` con las filas `J07` de esta tabla.
- Programar la sincronización: no hay cron, ni disparo automático, ni aviso de estándar caducado.
- Sincronización asíncrona con seguimiento de progreso.
- Restringir por idioma la búsqueda del `002B` sobre `ingredient` frente a `ingredientTranslations`.

Cada uno de esos, si aterriza, va en su propio spec.
