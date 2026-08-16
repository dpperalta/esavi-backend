# SPEC F17 — Importación masiva de `diagnosticTerm` desde ficheros MedDRA `.asc`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F15 (`diagnosticTerm` — dependencia dura: aporta modelo, tipos, ruta base, `TERM_SOURCES` y la normalización de `code`)**, SPEC F12 (`buildDifferentialUpdate` — la rama de actualización lo usa)
> **Fecha:** 2026-08-13
> **Objetivo:** Cargar el diccionario MedDRA en `diagnosticTerm` subiendo un fichero `.asc` a un endpoint administrativo, con inserción de lo nuevo y actualización diferencial de lo existente.

---

## 1. Por qué existe este spec

El [SPEC F15](./15-diagnosticterm-crud.md) dejó `diagnosticTerm` con dos puertas de escritura: el alta administrativa de una fila (`001`) y la resolución implícita desde una notificación (`006`, que fuerza `source: 'LOCAL'`). Ninguna de las dos sirve para poblar el catálogo con un diccionario licenciado.

**Y sin diccionario, el catálogo nace vacío.** El `006` crea términos `LOCAL` marcados `reviewStatus: 'PENDING'`; es la red de seguridad para que la captura no se bloquee, no la fuente del vocabulario. El propio F15 lo anticipó en §7 y en su cierre: _«La importación masiva desde MedDRA o WHODrug. Es carga de datos con versionado de diccionario, no un endpoint»_. Este spec toma esa exclusión y la resuelve, con una corrección deliberada sobre aquella frase: **sí es un endpoint**, porque quien tiene el fichero es el administrador funcional, no quien tiene acceso al servidor. La razón está en §6.

**El formato de origen.** MedDRA distribuye sus ficheros como texto plano posicional, con `$` de separador y un `$` de cierre en cada línea. `llt.asc` — los *Lowest Level Terms*, el nivel con el que se codifica — tiene esta forma:

```
10000001$Neumonitis de "ventilación"$10081988$$$$$$$N$$
10000002$Déficit de 11-beta-hidroxilasa$10000002$$$$$$$Y$$
```

De las once posiciones, este spec lee **tres**:

| Posición | Campo MedDRA | Destino |
|---|---|---|
| 1 | `llt_code` | `code` |
| 2 | `llt_name` | `name` |
| 10 | `llt_currency` | `isActive` — `Y` vigente, `N` retirado |

El orden completo de `llt.asc` es `llt_code$llt_name$pt_code$llt_whoart_code$llt_harts_code$llt_costart_sym$llt_icd9_code$llt_icd9cm_code$llt_icd10_code$llt_currency$llt_jart_code$`: once campos y un `$` de cierre, así que `llt_currency` es el **décimo**. Las líneas de ejemplo de arriba lo confirman — la `N` y la `Y` caen en la posición 10.

Las ocho restantes —`pt_code` y los campos de codificación cruzada con otros diccionarios— quedan fuera: `diagnosticTerm` es una tabla plana sin jerarquía, y guardar el `pt_code` sin una tabla que lo resuelva sería guardar un número huérfano.

**La escala manda sobre el diseño.** `llt.asc` de una versión reciente ronda las **80 000–90 000 líneas** y los 8–10 MB. Eso descarta el `create` fila a fila del `001` y obliga a tres cosas que ninguna operación del repositorio hace hoy: leer un fichero subido, procesar por lotes, y devolver un **informe de proceso** en vez de un recurso.

---

## 2. Alcance

**Dentro:**

- Una operación no canónica, **`ESAVI-DIAGTERM-007`** — importación masiva, con ruta HTTP propia: `POST /api/diagnostic-terms/import`, rol **SUPERADMIN**.
- Alta de la fila de `ESAVI-DIAGTERM-007` en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- Recepción del fichero por `multipart/form-data` — **primera subida de archivos del repositorio**: alta de `multer` y de un middleware propio en `src/middlewares/fileUpload.middleware.ts`.
- Parser del formato `.asc` posicional separado por `$`, en `src/helpers/meddraParser.helper.ts`, con su alta en el barrel de helpers.
- Procesamiento por lotes de 1000 filas, cada lote en su propia transacción.
- **Inserción** de los pares `(source, code)` que no existen, con `metadata` marcada como importada.
- **Actualización diferencial** de los que ya existen, sobre `name`, `termGroup` e `isActive`, mediante `buildDifferentialUpdate`.
- `isActive` derivado de la posición 10 del fichero, en inserción y en actualización.
- Modo `dryRun`: recorre, valida y cuenta sin escribir nada.
- Informe de resultado con `read`, `inserted`, `updated`, `unchanged`, `invalid`, `duplicated` y las primeras 20 líneas rechazadas con su motivo.
- Cinco claves i18n nuevas en el bloque `diagnosticTerm` de `es`, `en` y `nl`, subiendo el bloque de 16 a 21 claves.
- Una fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **125 a 126**.
- Fixture `tests/fixtures/meddra-llt-sample.asc` y bloque de cobertura en `tests/contract/diagnosticTerm.test.ts`.

**Fuera de alcance (otros specs):**

- **La jerarquía MedDRA.** `pt`, `hlt`, `hlgt`, `soc` y los ficheros de relación (`llt_pt`, `hlt_pt`, …) exigen tablas que el esquema no tiene. Este spec importa términos planos, no un árbol.
- **El versionado del diccionario.** No hay tabla de versiones ni histórico de importaciones. `dictionaryVersion` se guarda como una clave en el `metadata` de cada fila y nada más; una entidad `dictionaryImport` con su auditoría es otro spec.
- **La reversión de una importación.** No hay «deshacer el lote 28.0». Quien se equivoca de fichero corrige con otra importación.
- **WHODrug.** Su formato no es este; el parser se acota a `.asc` posicional con `$`.
- **La fusión de un término `LOCAL` autogenerado con su equivalente `MEDDRA` recién importado.** Sigue siendo del spec de gobernanza que el F15 dejó pendiente, y es el escenario más probable después de la primera carga.
- **Promover un término de `LOCAL` a `MEDDRA`.** Igual que en el F15: cambia la identidad de una fila ya referenciada.
- **La importación asíncrona con cola y consulta de progreso.** Se procesa en la propia petición. Si el volumen lo desborda, la cola es un spec propio con su tabla de trabajos.
- **La carga por CSV, Excel o JSON.** Un solo formato de entrada.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

**No hay tablas nuevas.** Se escribe sobre `diagnosticTerm` — `esaviapp.sql:545-559` —, cuyo desglose columna a columna está en [SPEC F15 §3.1](./15-diagnosticterm-crud.md) y no se repite aquí.

Las tres piezas del DDL que gobiernan esta operación:

- `CONSTRAINT "UQ_diagnosticTerm_source_code" UNIQUE ("source", "code")` (`esaviapp.sql:558`) — el árbitro real de la deduplicación, igual que en el `006`.
- `TRG_diagnosticTerm_setSysDetails` (`esaviapp.sql:1275-1290`) — se dispara **una vez por fila** insertada o actualizada, también dentro de un `bulkCreate`.
- `TRG_diagnosticTerm_preventPhysicalDelete` (`esaviapp.sql:1356-1370`) — irrelevante aquí: la importación nunca borra.

`appDetails` mantiene el comportamiento que el F15 ya dejó escrito: se escribe siempre como array y se lee con `Array.isArray(term.appDetails) ? term.appDetails : []`.

### 3.2 Modelo Sequelize

Sin cambios. `src/models/diagnosticTerm.model.ts` queda tal como lo dejó el F15, sin asociaciones.

### 3.3 Tipos

En `src/types/diagnosticTerm/diagnosticTerm.types.ts`, junto a los que ya existen:

```ts
export interface ImportDiagnosticTermsInput {
    source?: TermSource;          // default 'MEDDRA'
    termGroup?: string;           // default 'LLT'
    dictionaryVersion?: string;   // libre, p. ej. '28.0'; solo se guarda en metadata
    encoding?: 'utf8' | 'latin1'; // default 'utf8'
    dryRun?: boolean;             // default false
}

export interface ParsedDiagnosticTermRow {
    line: number;                 // 1-based, para que el informe apunte al fichero
    code: string;                 // ya normalizado con toConstantCase
    name: string;                 // solo trim
    isActive: boolean;            // posición 10: 'N' → false, cualquier otra cosa → true
}

export interface RejectedDiagnosticTermRow {
    line: number;
    reason: 'EMPTY_CODE' | 'EMPTY_NAME' | 'CODE_TOO_LONG' | 'NAME_TOO_LONG' | 'MISSING_FIELDS' | 'DUPLICATE_IN_FILE';
    raw: string;                  // la línea recortada a 200 caracteres
}

export interface DiagnosticTermImportReport {
    read: number;                 // líneas no vacías leídas
    inserted: number;
    updated: number;
    unchanged: number;            // existían y el diff salió vacío
    invalid: number;
    duplicated: number;           // repetidas dentro del propio fichero
    dryRun: boolean;
    source: TermSource;
    termGroup: string;
    errors: RejectedDiagnosticTermRow[];  // las 20 primeras, no todas
}
```

`ImportDiagnosticTermsInput` **no lleva `code` ni `name`**: los datos vienen del fichero, no del body. Y no se declara ningún `Update...Input`, según §4 de las convenciones.

### 3.4 Superficie HTTP

```
POST   /api/diagnostic-terms/import          ESAVI-DIAGTERM-007   SUPERADMIN  (nuevo)
```

Las siete rutas del F15 no cambian. `/import` es una **ruta literal** y se declara **antes** de `GET /:id`, `PUT /:id` y `DELETE /:id`, junto a `/admin` y `/activate/:id`; el método es `POST` y solo colisiona consigo mismo, pero el orden se respeta por coherencia con el resto del archivo.

Petición:

```
POST /api/diagnostic-terms/import
Content-Type: multipart/form-data

file               (requerido)  el .asc, campo de tipo archivo
source             (opcional)   uno de TERM_SOURCES, default 'MEDDRA'
termGroup          (opcional)   default 'LLT'
dictionaryVersion  (opcional)   texto libre, máx 50
encoding           (opcional)   'utf8' | 'latin1', default 'utf8'
dryRun             (opcional)   'true' | 'false', default false
```

`source` y `termGroup` son parámetros y no constantes porque los ficheros `pt.asc`, `hlt.asc` y `soc.asc` comparten las dos primeras posiciones — `code` y `name` — con `llt.asc`. El caso de uso declarado es `LLT` sobre `MEDDRA`; los demás niveles se cargan con el mismo endpoint cambiando el campo, cada uno como un catálogo plano independiente.

### 3.5 Reglas de negocio por operación

**`ESAVI-DIAGTERM-007` — importar.** `importDiagnosticTermsService(fileBuffer, data, authUser, lang)` en `src/services/diagnosticTerm.service.ts`. Cinco fases, en este orden:

**Fase 1 — recepción.** El middleware `uploadSingleFile('file')` deja el fichero en `req.file` con `memoryStorage`, límite **20 MB** y un solo archivo. Sin fichero → 400 `DIAGTERM_007_FILE_REQUIRED`. Fichero que excede el límite → 413 `DIAGTERM_007_FILE_TOO_LARGE`. El límite lo aplica multer y el error se traduce en el middleware, no en el servicio.

**Fase 2 — parseo.** `parseMeddraAscFile(buffer, encoding)` en `src/helpers/meddraParser.helper.ts` devuelve `{ rows, rejected }`:

1. Decodifica el buffer con el `encoding` recibido y parte por `/\r?\n/`.
2. Descarta las líneas vacías o de solo espacios; no cuentan como leídas ni como inválidas.
3. Parte cada línea por `$`. Menos de dos posiciones → rechazo `MISSING_FIELDS`.
4. `code` = posición 1 normalizada con `toConstantCase(campo.trim())` — **la misma normalización que el `001` y el `006`**, o el catálogo acabaría con dos representaciones del mismo término.
5. `name` = posición 2 con `.trim()` únicamente. Nunca `toTitleCase`, por la razón que el F15 §6 dejó escrita: un término de diccionario es un dato citado.
6. `isActive` = posición 10; `'N'` (sin distinguir mayúsculas, ya recortada) → `false`; **cualquier otro valor, incluida la ausencia del campo, → `true`**.
7. Rechazos por contenido: `code` vacío → `EMPTY_CODE`; `name` vacío → `EMPTY_NAME`; `code` de más de 100 caracteres → `CODE_TOO_LONG`; `name` de más de 500 → `NAME_TOO_LONG`. Son los límites de `varchar` del DDL; sin este filtro la fila reventaría el lote entero.
8. Duplicados dentro del propio fichero: **gana la primera aparición**; las siguientes se rechazan como `DUPLICATE_IN_FILE`.

Una línea rechazada **no aborta nada**: se cuenta y el proceso sigue. Si tras el parseo `rows` está vacío —fichero vacío, binario o con otro separador— → 400 `DIAGTERM_007_FILE_INVALID`. Es el único caso en que un problema de contenido corta la operación, y corta antes de escribir.

**Fase 3 — proceso por lotes.** Las filas válidas se recorren en lotes de **1000**. Cada lote abre su propia transacción, hace su trabajo y confirma. Por lote:

1. `findAll` con `where: { source, code: { [Op.in]: codesDelLote } }`, **fila completa y sin `attributes` acotados** —es la precondición de `buildDifferentialUpdate`— y sin filtrar por `isActive`.
2. Las filas cuyo `code` no aparece en el resultado son **nuevas**: se acumulan y se insertan con un solo `bulkCreate`.
3. Las que sí aparecen pasan por el diff descrito más abajo, una a una.

**Fase 4 — inserción.** Un `bulkCreate` por lote, sin `updateOnDuplicate` y sin `ignoreDuplicates`. Cada fila lleva:

```
{ source, code, name, termGroup, isActive,
  deletedAt: isActive ? null : <fecha del proceso>,
  metadata: { importedFrom: source, importedAt, dictionaryVersion, reviewStatus: 'APPROVED', autoCreated: false },
  appDetails: [ { createdAt, user, method: 'ESAVI-DIAGTERM-007', detail } ] }
```

`reviewStatus: 'APPROVED'` y `autoCreated: false` son deliberados y opuestos a lo que escribe el `006`: un término que viene del diccionario oficial **no está pendiente de revisión de nadie**. `dictionaryVersion` se omite de `metadata` si no vino en el body, en vez de guardarse como `null`.

Si el `bulkCreate` lanza `SequelizeUniqueConstraintError` —otra importación corriendo a la vez—, la transacción del lote revierte y el error se propaga como 500 `DIAGTERM_007_IMPORT_FAILED`. **No hay reintento ni relectura**: a diferencia del `006`, aquí la concurrencia no es un escenario normal sino un error de operación, y el informe de los lotes ya confirmados dice hasta dónde llegó.

**Fase 5 — informe.** Se devuelve el `DiagnosticTermImportReport` de §3.3. `errors` se recorta a las **20 primeras** entradas: un fichero mal formado produciría 90 000 y la respuesta pesaría más que la petición. `invalid` y `duplicated` cuentan el total real, no las 20.

**Modo `dryRun: true`.** Ejecuta las fases 1, 2 y 3 —incluida la lectura de existentes y el cálculo del diff— y **omite toda escritura**. El informe llega con los mismos números que produciría la ejecución real y `dryRun: true`. Ninguna transacción se abre.

#### Contrato de update diferencial

La rama de actualización de la fase 3 escribe sobre filas existentes, así que declara su tabla. `stored` sale de `term.get({ plain: true })`. Diff con `buildDifferentialUpdate`; si vuelve vacío **no se escribe nada** —ni `updatedAt`, ni `appDetails`, ni evento en `sysDetails`— y la fila cuenta como `unchanged`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `source` | **no entra** | es la clave de búsqueda, no un dato a actualizar |
| `code` | **no entra** | es la clave de búsqueda; una fila se encontró *por* su code |
| `name` | `row.name` — siempre | ya recortado por el parser; el helper decide si difiere |
| `termGroup` | `data.termGroup ?? 'LLT'` — siempre | el fichero declara el nivel; una fila que entró sin `termGroup` lo recibe |
| `isActive` | `row.isActive` — siempre | derivado de la posición 10 |
| `deletedAt` | solo si `isActive` quedó en el resultado del diff: `objectToUpdate.isActive ? null : new Date()` | derivado del anterior; nunca entra por su cuenta |
| `metadata` | **no entra** | ver más abajo |

Tres puntos que la tabla no dice solos:

- **`name`, `termGroup` e `isActive` entran siempre**, sin `if` de presencia. No hay body de cliente que preguntar: el fichero es la fuente completa de los tres, y es el helper quien decide si hay `UPDATE`. Una reimportación del mismo fichero deja las 90 000 filas en `unchanged` y no escribe una sola vez.
- **`deletedAt` es un derivado condicionado**, no un candidato normal. Se calcula **después** del diff y solo cuando `isActive` cambió de verdad; si la vigencia no cambió, la columna no se toca aunque tenga un valor incoherente de antes.
- **`metadata` no se reescribe en la rama de actualización.** Reimportar no debe borrar el `autoCreated: true` ni el `createdFrom` de un término que nació por el `006` y que después apareció en el diccionario. Reconciliar esos dos orígenes es la fusión, y es del spec de gobernanza.

La actualización que sí escribe añade su entrada a `appDetails` con `method: 'ESAVI-DIAGTERM-007'` y preserva el historial con `[...currentAppDetails, newEntry]`.

**Escrituras que no pasan por el helper**, declaradas una a una: el `bulkCreate` de la fase 4, porque es una inserción. No hay ninguna otra.

**Efectos sobre otras tablas: ninguno.** La importación escribe en `diagnosticTerm` y nada más. Las tres FK entrantes del F15 no se tocan, ni siquiera cuando una fila se desactiva: un `notificationEvent` que apunta a un LLT retirado sigue apuntando ahí, que es exactamente lo que significa una referencia histórica.

### 3.6 Claves i18n nuevas

Cinco claves nuevas en el bloque `diagnosticTerm` de `src/data/i18n/es.json`, `en.json` y `nl.json`, que pasa de 16 a 21:

| Clave | Uso |
|---|---|
| `importedSuccess` | 200 del `007` |
| `importedFailed` | 500 del `007` |
| `fileRequired` | 400 cuando no viaja el fichero |
| `fileInvalid` | 400 cuando el fichero no produce ninguna fila válida |
| `fileTooLarge` | 413 cuando excede los 20 MB |

Los nombres siguen §13: par `Success`/`Failed` para la operación, y las tres restantes nombran la condición como ya hacen `notFound` y `codeExists`.

### 3.7 Forma de la respuesta

Éxito, **200**:

```
{ ok, message, data: {
    read, inserted, updated, unchanged, invalid, duplicated,
    dryRun, source, termGroup,
    errors: [ { line, reason, raw } ]
} }
```

**200 y no 201**, aunque la operación cree filas: no hay un recurso identificable que devolver ni una URL a la que apuntar. Lo que se devuelve es el informe de un proceso, y `data` no contiene ni un solo `diagnosticTermId`. Quien quiera ver lo importado usa el `002B` con `?source=MEDDRA`.

Los errores salen por `errorHandler` con la forma habitual `{ ok, message, code, errors }`.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registrar la operación no canónica.** Fila `diagnosticTerm | 007 | importación masiva desde fichero MedDRA .asc — SUPERADMIN, POST /import` en la tabla de `references/CONVENTIONS.md` §6. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* `diagnosticTerm` aparece dos veces en la tabla, con `006` y `007`, y ningún otro `007` de otra entidad se ve afectado.

2. **Dependencia y middleware de subida.** `npm i multer` y `npm i -D @types/multer`. `src/middlewares/fileUpload.middleware.ts` con `uploadSingleFile(fieldName)`: `memoryStorage`, `limits: { fileSize: 20 * 1024 * 1024, files: 1 }`, y traducción de `MulterError` — `LIMIT_FILE_SIZE` → 413 `DIAGTERM_007_FILE_TOO_LARGE`. Alta en `src/middlewares/index.ts`.
   *Verificación:* `npm run build` en 0; una ruta de prueba con el middleware recibe `req.file.buffer` con el contenido íntegro de un `.asc` de dos líneas.

3. **Las cinco claves i18n** del §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

4. **Tipos y parser.** Las cuatro interfaces de §3.3 en `src/types/diagnosticTerm/diagnosticTerm.types.ts`. `src/helpers/meddraParser.helper.ts` con `parseMeddraAscFile(buffer, encoding)` y los ocho puntos de la fase 2, con su alta en `src/helpers/index.ts`. **Función pura, sin acceso a base de datos.**
   *Verificación:* prueba unitaria sobre las dos líneas del §1 — la primera sale con `isActive: false`, la segunda con `true`, y `10000001` se guarda tal cual porque `toConstantCase` no lo altera; una línea con un solo `$` sale en `rejected` con `MISSING_FIELDS`; la misma `code` dos veces produce un `DUPLICATE_IN_FILE`.

5. **`ESAVI-DIAGTERM-007` — servicio.** `importDiagnosticTermsService` en `src/services/diagnosticTerm.service.ts` con las cinco fases de §3.5: lectura de existentes por lote, `bulkCreate` de los nuevos, diff de los existentes, transacción por lote y construcción del informe. Incluye la rama `dryRun`.
   *Verificación:* invocado con un buffer de 3 líneas sobre tabla vacía devuelve `inserted: 3`; invocado dos veces seguidas con el mismo buffer devuelve la segunda vez `inserted: 0, updated: 0, unchanged: 3` y ninguna fila crece en `appDetails`.

6. **`ESAVI-DIAGTERM-007` — controlador, validador y ruta.** Controlador que lee `req.file` y los campos de texto del `body`, con el idiom de `catch` de §10. Validador `importDiagnosticTermsValidator` con `source` opcional en `TERM_SOURCES`, `termGroup` opcional de máx 250, `dictionaryVersion` opcional de máx 50, `encoding` opcional en `['utf8','latin1']` y `dryRun` opcional booleano. Ruta `POST /import` con `tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file'), ...importDiagnosticTermsValidator, validateFields, importDiagnosticTerms`, declarada **antes** de las rutas con `:id`. Alta del validador en `src/validators/index.ts`.
   *Verificación:* una petición sin fichero devuelve **400** `DIAGTERM_007_FILE_REQUIRED`; un ADMIN recibe **403**; un `.asc` de 3 líneas devuelve **200** con el informe; `?dryRun=true` deja la tabla intacta.

7. **Cubrir la ruta en `tests/auth/roles.test.ts`.** Una fila en `ROUTE_RULES` con `minRole: SUPERADMIN` y código `ESAVI-DIAGTERM-007`, y subir el total esperado de **125 a 126**.
   *Verificación:* `npm test -- roles` pasa con 126.

8. **Fixture y suite de contrato.** `tests/fixtures/meddra-llt-sample.asc` con seis líneas: dos vigentes, una retirada (`N`), una duplicada, una sin `name` y una con un solo campo. Bloque nuevo en `tests/contract/diagnosticTerm.test.ts` que sube el fichero con `.attach()` de supertest y verifica el informe, la reimportación idempotente, la rama de actualización de `name` y el cambio de vigencia.
   *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] `POST /api/diagnostic-terms/import` responde **200** con el informe de §3.7, y **403** para ADMIN.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en `ESAVI-DIAGTERM-007`.
- [ ] `grep -rn "ESAVI-DIAGTERM-007" src/` devuelve exactamente las cinco apariciones y ninguna con letra.
- [ ] Importar las dos líneas de ejemplo del §1 crea `10000001` con `isActive: false` y `deletedAt` con fecha, y `10000002` con `isActive: true` y `deletedAt` en `null`.
- [ ] El `name` se guarda sin recapitalizar: `Déficit de 11-beta-hidroxilasa` entra tal cual, con sus acentos intactos.
- [ ] Toda fila creada lleva `metadata.reviewStatus: 'APPROVED'`, `metadata.autoCreated: false` y `metadata.importedFrom: 'MEDDRA'`.
- [ ] Una petición sin fichero devuelve **400**; un fichero de 21 MB devuelve **413**; un fichero sin ninguna línea válida devuelve **400** `DIAGTERM_007_FILE_INVALID`.
- [ ] Un fichero con 6 líneas de las que 2 son inválidas y 1 duplicada devuelve `read: 6, invalid: 2, duplicated: 1` y solo escribe 3 filas.
- [ ] `errors` trae como mucho 20 entradas aunque `invalid` sea mayor.
- [ ] `dryRun: true` devuelve el mismo informe y deja `SELECT count(*) FROM "diagnosticTerm"` sin cambios.
- [ ] Un fichero de 5000 líneas se procesa en 5 lotes y termina en una sola petición.
- [ ] Las cinco claves existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 126 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Reimportar el mismo fichero sin cambios responde **200** con `updated: 0` y `unchanged: N`: ninguna fila crece en `appDetails`, ningún `sysDetails.version` avanza y ningún `updatedAt` se mueve. Es el criterio que de verdad discrimina.
- [ ] Un fichero en el que **una** línea cambió el `name` produce `updated: 1` y `unchanged: N-1`, y esa fila añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] Un fichero idéntico salvo por un `Y` que pasó a `N` produce `updated: 1`, deja esa fila con `isActive: false` y `deletedAt` con fecha, y no toca `deletedAt` en ninguna otra.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/diagnosticTerm.service.ts` no devuelve resultados.
- [ ] La rama de actualización no reescribe `metadata`: un término creado por el `006` con `autoCreated: true` conserva esa clave y su `createdFrom` después de aparecer en una importación.

**Propios del `007`:**

- [ ] `code` y `name` salen de las posiciones 1 y 2, e `isActive` de la 10; el resto del fichero se ignora sin error.
- [ ] Una línea sin la posición 10 se importa con `isActive: true`.
- [ ] `toConstantCase` se aplica al `code`, igual que en el `001` y el `006`: importar `10000001` y después resolverlo por el `006` encuentra la misma fila, sin crear una `LOCAL` paralela.
- [ ] Importar con `source: 'MEDDRA'` un `code` que ya existe como `LOCAL` crea una fila nueva: la unicidad es del par, y son dos términos distintos.
- [ ] `termGroup` toma `'LLT'` cuando el body no lo trae.
- [ ] Un fichero guardado en latin-1 e importado con `encoding: 'latin1'` conserva los acentos; el mismo fichero leído como `utf8` produce caracteres de reemplazo — el parámetro sirve para algo.
- [ ] La importación no consulta ninguna otra tabla: `grep -n "notificationEvent\|Notification\|Investigation" src/services/diagnosticTerm.service.ts` no devuelve resultados.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** endpoint HTTP con subida de fichero, en vez del script CLI que el F15 anticipaba. Quien tiene el fichero de MedDRA es el administrador funcional del sistema, no quien tiene acceso al servidor de producción. Un script obligaría a que cada actualización del diccionario pasara por despliegue; el endpoint la convierte en una operación de administración con su rol, su token y su rastro en `appDetails`.
- **No:** script CLI además del endpoint. Dos superficies para la misma lógica es el doble de tests y de documentación. El servicio queda escrito de forma que un script futuro solo tendría que pasarle un buffer, y ese día se decidirá.
- **Sí:** rol SUPERADMIN. Es la escritura de mayor alcance del repositorio —decenas de miles de filas en una petición— y el F15 ya reservó SUPERADMIN para el `005B`, que mueve una sola fila. Dejarlo en ADMIN sería incoherente con eso.
- **Sí:** `multer` con `memoryStorage`. Un `llt.asc` completo ronda los 10 MB y se procesa una vez al año; escribirlo a disco añade permisos, limpieza de temporales y un modo de fallo nuevo a cambio de nada. El límite de 20 MB deja margen sobrado y frena la subida antes de que el buffer crezca.
- **No:** aceptar el fichero como cuerpo `text/plain` con `express.text()`, evitando la dependencia. Funciona, pero pierde el nombre del fichero, obliga a mandar los parámetros por query y deja el repositorio sin la pieza de subida que la próxima entidad con adjuntos necesitará igualmente.
- **Sí:** actualizar el `name` cuando difiere, en vez de omitir la fila existente. Es lo que hace utilizable una reimportación: MedDRA renombra términos entre versiones, y un catálogo que solo crece se desactualiza sin que nadie lo note. La escritura pasa por `buildDifferentialUpdate`, así que la reimportación de un fichero sin cambios no escribe nada.
- **No:** la regla del F15 «el maestro manda sobre el nombre entrante» en esta operación. Ahí el nombre entrante venía de un formulario y podía traer una errata; aquí viene del diccionario oficial, que **es** el maestro. La asimetría es deliberada: el `006` no reescribe y el `007` sí.
- **Sí:** mapear la posición 10 a `isActive`. Un LLT retirado por MedDRA no debe seguir ofreciéndose en el autocomplete, y borrarlo no es opción: las notificaciones históricas lo referencian. `isActive: false` es exactamente eso, y es el significado que el F15 le dio.
- **No:** descartar las filas con `N` en vez de importarlas inactivas. Un término retirado que ya se usaba en notificaciones históricas quedaría sin forma de recodificarse ni de mostrarse.
- **Sí:** que el `007` escriba `isActive`, pese a que el F15 dijo que lo gobiernan el `005A` y el `005B`. La vigencia de un término MedDRA la decide MedDRA, no un administrador; el fichero es la autoridad sobre sus propias filas. Queda como excepción declarada, acotada a esta operación, y visible en `appDetails` con su `method`.
- **Sí:** que una reimportación reactive un término que un administrador había desactivado a mano, si el fichero lo declara vigente. Es la consecuencia de la decisión anterior y se asume: sobre `source: 'MEDDRA'`, el fichero manda. Un administrador que quiera retirar un término vigente para su institución tiene el `005A`, y sabrá que la próxima importación lo revierte.
- **Sí:** `reviewStatus: 'APPROVED'` en lo importado, al revés que el `PENDING` del `006`. Meter 90 000 términos oficiales en la cola de revisión la volvería inútil el primer día.
- **No:** reescribir `metadata` en la rama de actualización. Borraría el `autoCreated` y el `createdFrom` de un término que nació por el `006`, que es justo la información que la fusión necesitará.
- **Sí:** transacción por lote de 1000 en vez de una sola transacción para todo el fichero. Una transacción de 90 000 filas mantiene bloqueos durante minutos y, si falla en la fila 89 000, tira el trabajo entero. Por lotes, un fallo deja confirmado lo anterior y el informe dice hasta dónde llegó; reimportar el mismo fichero es idempotente, así que reanudar es volver a subirlo.
- **No:** `bulkCreate` con `updateOnDuplicate`. Es una sola instrucción y sería más rápido, pero pisa `appDetails` y `metadata` de las filas existentes, escribe aunque nada haya cambiado, y deja el repositorio con un update que no pasa por `buildDifferentialUpdate`. El `SELECT` previo por lote cuesta una consulta y compra las tres cosas.
- **No:** reintentar ante `SequelizeUniqueConstraintError` como hace el `006`. Ahí la carrera es el escenario normal —dos notificadores a la vez—; aquí significa dos importaciones simultáneas, que es un error de operación y conviene que se vea.
- **Sí:** `dryRun`. Un fichero equivocado escribe decenas de miles de filas y no hay deshacer. Comprobar antes cuesta una bandera booleana.
- **Sí:** recortar `errors` a 20 entradas. Un fichero binario subido por error generaría 90 000 rechazos y una respuesta de varios megabytes. Los contadores siguen siendo exactos.
- **Sí:** parámetro `encoding` con `utf8` por defecto. MedDRA distribuye UTF-8 en sus versiones recientes, pero circulan copias en latin-1, y el síntoma —acentos rotos en 90 000 filas ya escritas— se descubre tarde y se arregla mal.
- **Sí:** `source` y `termGroup` parametrizables en vez de constantes `'MEDDRA'` y `'LLT'`. Las dos primeras posiciones de `pt.asc`, `hlt.asc` y `soc.asc` son las mismas, así que el mismo endpoint carga los otros niveles sin código nuevo. Los defaults cubren el caso declarado.
- **No:** importar la jerarquía leyendo el `pt_code` de la posición 3. `diagnosticTerm` es plano y no hay tabla donde colgar la relación; guardar el número sin resolverlo es guardar basura tipada.
- **Sí:** 200 en vez de 201. No hay recurso creado que devolver ni `Location` que apuntar: lo que vuelve es el informe de un proceso.
- **Sí:** procesar en la propia petición, sin cola. 90 000 filas en lotes de 1000 son 90 iteraciones de dos consultas; es una operación anual de un SUPERADMIN, no un endpoint de tráfico. La cola tiene su propio coste —tabla de trabajos, endpoint de progreso, worker— y se pagará cuando el volumen lo pida.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| La petición supera el timeout del proxy o del cliente con un fichero completo | El proceso por lotes acota la memoria pero no el tiempo total. Se mide con el fichero real antes de dar el spec por cerrado; si no cabe en el timeout, la cola deja de ser fuera de alcance y se especifica aparte. `dryRun` sirve como medición previa sin escribir |
| Una importación se corta a la mitad y deja el catálogo incompleto | Los lotes confirmados quedan escritos y el informe dice cuántos. Reimportar el mismo fichero es idempotente: lo ya escrito sale como `unchanged` |
| Dos importaciones simultáneas colisionan en el índice único | El lote perdedor revierte y la petición devuelve 500. Es un error de operación, no un caso a absorber; el rol SUPERADMIN hace el escenario improbable |
| El fichero llega en latin-1 y se importan 90 000 nombres con acentos rotos | Parámetro `encoding` y `dryRun` para comprobar antes. El informe no muestra los nombres, así que la verificación real es un `002B` con `?search=` después de una carga de prueba |
| Un fichero con otro separador se cuela y produce filas basura | Si ninguna línea produce dos campos, el parser no devuelve filas y la operación corta con 400 antes de escribir |
| Un `code` de MedDRA cambia de significado entre versiones y el `name` se sobrescribe sobre notificaciones ya codificadas | `notificationEvent` guarda `esaviName` y `esaviCode` como copia al momento de codificar, precisamente para esto. La notificación se lee entera sin depender del maestro |
| Los términos `LOCAL` autogenerados por el `006` duplican términos MedDRA recién importados | Es el escenario esperado tras la primera carga y no lo resuelve este spec. Los `LOCAL` quedan filtrables por `?reviewStatus=PENDING` en el `002B`; la fusión es el spec de gobernanza |
| La primera carga multiplica por mil el tamaño del catálogo y degrada el `Op.iLike` del `002A` | El F15 ya lo anticipó: con MedDRA completo hará falta un índice `gin_trgm_ops` sobre `name`. Es un cambio de esquema con su propio spec, y este spec es el que lo vuelve urgente |
| `multer` deja de mantenerse o cambia de API mayor | Está aislado en `src/middlewares/fileUpload.middleware.ts`; ningún controlador lo importa directamente |

---

## 8. Impacto en el contrato HTTP

No aplica a los endpoints existentes: el spec solo añade `POST /api/diagnostic-terms/import`.

Sí tiene un impacto operativo que conviene dejar escrito: tras la primera importación, el `002A` deja de devolver un catálogo de decenas de filas y pasa a uno de decenas de miles. Los clientes que hoy listan sin `search` recibirán la primera página de 10 términos ordenados por `name`, que es el comportamiento ya especificado — pero deja de ser útil como «lista completa». El autocomplete debe usar `search`.

---

## Lo que **no** está en este spec

- La jerarquía MedDRA: `pt`, `hlt`, `hlgt`, `soc` y sus ficheros de relación.
- El versionado del diccionario y el histórico de importaciones.
- La reversión de una importación.
- La importación desde WHODrug.
- La fusión de un término `LOCAL` autogenerado con su equivalente `MEDDRA`.
- Promover un término de `LOCAL` a `MEDDRA`.
- La importación asíncrona con cola y consulta de progreso.
- La carga por CSV, Excel o JSON.
- El índice `gin_trgm_ops` sobre `name`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
