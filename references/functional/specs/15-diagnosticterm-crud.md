# SPEC F15 — CRUD de `diagnosticTerm` y resolución implícita de términos

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa), SPEC F13 (aporta `src/constants/enums.constants.ts`, donde se registra el segundo ENUM compartido del esquema)
> **Fecha:** 2026-08-13
> **Objetivo:** Dar de alta `diagnosticTerm` con sus siete operaciones canónicas y un servicio común de resolución que permite a otros dominios referenciar un término existente o crearlo al vuelo cuando no existe.

---

## 1. Por qué existe este spec

`diagnosticTerm` es el **vocabulario controlado con el que se codifican los eventos clínicos** del sistema: qué le pasó al paciente, dicho con un término que se pueda contar, agrupar y comparar entre notificaciones. Hoy la tabla existe en `esaviapp.sql:545-559` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es el primero de los tres catálogos clínicos pendientes y el más urgente de los tres, porque **tres tablas lo esperan**, todas con FK nullable y `ON DELETE RESTRICT`:

- `notificationEvent.diagnosticTermId` — `esaviapp.sql:788`
- `notificationPregnancyComplication.diagnosticTermId` — `esaviapp.sql:902`
- `investigationPregnancyCondition.diagnosticTermId` — `esaviapp.sql:1062`

Ninguna está implementada. `notificationEvent` es la siguiente satélite de `notification` en la cola, y no se puede especificar sin decidir antes de dónde salen sus términos.

**El patrón que el esquema impone: crudo más codificado.** Las tres tablas llevan, junto a la FK, un campo de texto libre — `esaviRawName`, `complicationRawName`, `conditionRaw`. No es redundancia. El notificador escribe lo que ve y la notificación **no se bloquea** por no estar codificada; la FK nullable existe para representar «notificado pero sin codificar». `notificationEvent` va un paso más allá y guarda además `esaviName` y `esaviCode` como copia del término al momento de codificar, de modo que renombrar el maestro no reescribe la historia. De ahí que la tabla esté protegida contra el borrado físico.

**Lo que hace que este spec no sea un CRUD más.** Un catálogo clínico que solo se alimenta por su endpoint administrativo no se alimenta nunca: el término aparece cuando alguien notifica, no cuando un administrador se anticipa. Por eso el spec entrega, además de las siete operaciones canónicas, un **servicio común de resolución** (`006`) que busca el término por su par `(source, code)` y lo crea si no existe. La escritura al maestro pasa a tener dos orígenes con reglas distintas, y esa asimetría es el núcleo del documento:

| | `001` — alta administrativa | `006` — resolución implícita |
|---|---|---|
| Quién | ADMIN | cualquiera autorizado a notificar, incluido USER |
| Qué `source` acepta | los cuatro del enum | **solo `LOCAL`** |
| Superficie HTTP | `POST /api/diagnostic-terms` | ninguna: servicio interno |
| Marca en `metadata` | ninguna | `autoCreated: true`, `createdFrom`, `reviewStatus: 'PENDING'` |

Un cliente no puede afirmar que un término pertenece a un diccionario licenciado; eso es un alta administrativa o una importación. Y la creación implícita se marca porque **un maestro que se llena solo se llena mal**: sin el marcador, nadie puede distinguir el término revisado del que entró por un formulario a las tres de la mañana.

**Tres precedentes nuevos para el repositorio**, los tres acotados a esta entidad y declarados aquí de frente:

- **`Op.iLike`.** El SPEC 09 dejó escrito que no existe en ningún servicio. Este spec lo introduce, limitado a `name` y a los dos listados.
- **Filtro sobre una clave JSONB.** `metadata.reviewStatus`, solo en `002B`.
- **Una escritura al maestro disparada desde otro dominio.** El `006` corre dentro de la transacción de quien lo llama, no en una propia.

**Sin `005C`.** `diagnosticTerm` figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1354-1360`), así que por la regla de disponibilidad de `CONVENTIONS.md` §6 el borrado físico **no se declara**. Son siete operaciones canónicas más la no canónica `006`, no ocho.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `diagnosticTerm`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones canónicas** — `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- **Una operación no canónica, `006`** — `resolveDiagnosticTermService` en `src/services/common/diagnosticTermResolution.service.ts`, **sin ruta HTTP**. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- Alta de la abreviatura `DIAGTERM` en la tabla de `references/CONVENTIONS.md` §6.
- Registro del ENUM `termSource` como `TERM_SOURCES` en `src/constants/enums.constants.ts`, junto a `ANSWER_OPTIONS`.
- `code` **obligatorio** en la API, más estricto que el DDL, para que `UQ_diagnosticTerm_source_code` proteja de verdad toda fila.
- Unicidad por el par `(source, code)`, comparada contra el `code` ya normalizado con `toConstantCase`, sin filtrar por `isActive` y excluyendo el propio id en el `004` con `{ [Op.ne]: id }`.
- `source` inmutable en el `004`.
- Búsqueda por texto con `Op.iLike` sobre `name`, acotada a `002A` y `002B`.
- Filtro `reviewStatus` sobre la clave JSONB `metadata.reviewStatus`, acotado a `002B`.
- `reviewStatus` como campo escribible de primer nivel en el `004`, fundido sobre el `metadata` guardado.
- Un bloque `diagnosticTerm` con dieciséis claves i18n en `es`, `en` y `nl`, nombradas según `references/CONVENTIONS.md` §13.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de 118 a 125.
- Suite `tests/contract/diagnosticTerm.test.ts`, con cobertura explícita de las cuatro ramas del `006`.

**Fuera de alcance (otros specs):**

- **El flujo de gobernanza del catálogo.** Endpoint de cola de revisión, acciones masivas, aprobación en lote y notificación de pendientes. Este spec deja `reviewStatus` escribible y filtrable; el proceso que lo consume es otro documento.
- **La fusión de términos duplicados.** Repuntar las tres FK entrantes antes de retirar el sobrante es una operación con su propia transacción y su propio rol, y las tres tablas destino aún no existen.
- **La recodificación de un evento ya guardado.** Cambiar el `diagnosticTermId` de un `notificationEvent` es una operación de ese dominio, no una variante del CRUD de este.
- **La importación masiva desde MedDRA o WHODrug.** Es carga de datos con versionado de diccionario, no un endpoint.
- **`notificationEvent`, `notificationPregnancyComplication` e `investigationPregnancyCondition`.** Este spec entrega el resolver; quien lo llama llega en sus propios specs.
- **El índice parcial `UNIQUE (source, lower(name)) WHERE code IS NULL`.** Al hacer `code` obligatorio en la API deja de hacer falta; añadirlo sería tocar `esaviapp.sql`.
- **Promover un término de `LOCAL` a `MEDDRA`.** Cambia la identidad de una fila ya referenciada; va con la fusión, en el spec de gobernanza.
- **Búsqueda por `termGroup` parcial o por `code` parcial.** El `iLike` se acota a `name`; `termGroup` y `code` se filtran por igualdad.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`diagnosticTerm` — `esaviapp.sql:545-559`. Tabla plana: **ninguna clave foránea saliente**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `diagnosticTermId` | `uuid` | no | PK, `gen_random_uuid()` |
| `source` | `"termSource"` | no | ENUM, `DEFAULT 'LOCAL'` |
| `code` | `varchar(100)` | **sí en el DDL** | la API lo exige obligatorio |
| `name` | `varchar(500)` | no | |
| `termGroup` | `varchar(250)` | sí | |
| `metadata` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `isActive` | `boolean` | no | `DEFAULT true` |
| `createdAt` | `timestamptz` | no | `DEFAULT current_timestamp` |
| `updatedAt` | `timestamptz` | sí | lo escribe la aplicación |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `appDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |

Restricción única: `CONSTRAINT "UQ_diagnosticTerm_source_code" UNIQUE ("source", "code")` (`esaviapp.sql:558`). Es unicidad **por par**, no global: `MEDDRA`/`10019211` y `LOCAL`/`10019211` conviven legítimamente.

Sin `CHECK` propios y sin FK. Los dos triggers que la alcanzan los montan bucles genéricos: `TRG_diagnosticTerm_setSysDetails` sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1275-1290`), y `TRG_diagnosticTerm_preventPhysicalDelete` sobre las 18 tablas protegidas (`esaviapp.sql:1356-1370`). No existe `TRG_diagnosticTerm_setUpdatedAt`.

Las cuatro columnas transversales están completas. Una precisión sobre `appDetails`: su `DEFAULT` en el DDL es `'{}'` —un objeto—, no `'[]'`. Es uniforme en las 45 tablas del esquema y el repositorio ya convive con ello: el servicio escribe siempre un array y lo lee con `Array.isArray(term.appDetails) ? term.appDetails : []`, que resuelve el default sin tocar el SQL.

**ENUM `termSource`** — `esaviapp.sql:36`: `'MEDDRA'`, `'WHODRUG'`, `'LOCAL'`, `'OTHER'`. Es el segundo ENUM compartido del esquema y se registra en `src/constants/enums.constants.ts` con la forma que el SPEC F13 estableció para `ANSWER_OPTIONS`:

```ts
export const TERM_SOURCES = ['MEDDRA', 'WHODRUG', 'LOCAL', 'OTHER'] as const;
export type TermSource = (typeof TERM_SOURCES)[number];
```

### 3.2 Modelo Sequelize

`src/models/diagnosticTerm.model.ts`, clase `DiagnosticTerm`. `timestamps: false`, `freezeTableName: true`, `tableName: 'diagnosticTerm'`, PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `source` se declara `DataTypes.ENUM(...TERM_SOURCES)`, importando la constante en vez de repetir los literales. `metadata`, `sysDetails` y `appDetails` como `DataTypes.JSONB`. Alta en `src/models/index.ts`.

**Sin archivo de asociaciones.** Es la primera entidad del repositorio sin ninguna: no tiene FK saliente, y las tres entrantes las declararán los specs de las tablas hijas, en sus propios archivos, porque la asociación pertenece al lado que posee la clave. Crear hoy un `diagnosticTerm.associations.ts` con un cuerpo vacío y registrarlo en `initAssociations()` añade un artefacto que no hace nada y que el siguiente spec tendría que abrir igualmente. Es una desviación consciente del artefacto 2 de `CONVENTIONS.md` §1, y queda razonada en §6.

### 3.3 Tipos

`src/types/diagnosticTerm/diagnosticTerm.types.ts`, con su `index.ts` de barrel —el dominio sí lo lleva, a diferencia de `healthFacility`— y alta en `src/types/index.ts`.

```ts
export interface CreateDiagnosticTermInput {
    source?: TermSource;          // default 'LOCAL'; inmutable en el 004
    code: string;                 // obligatorio en la API aunque el DDL lo permita nulo
    name: string;
    termGroup?: string | null;
    reviewStatus?: string;        // campo plano; se funde sobre metadata
    isActive?: boolean;
}
```

El update usa `Partial<CreateDiagnosticTermInput>`. **No se declara `UpdateDiagnosticTermInput`.**

`metadata` no aparece en la interfaz de entrada: no es escribible desde la API. La única puerta a su contenido es `reviewStatus`.

Para el resolver, en el mismo archivo:

```ts
export interface ResolveDiagnosticTermInput {
    code: string;
    name: string;
    operationCode: string;        // el código del endpoint que dispara la resolución
}
```

### 3.4 Superficie HTTP

```
POST   /api/diagnostic-terms                 ESAVI-DIAGTERM-001   ADMIN       (nuevo)
GET    /api/diagnostic-terms                 ESAVI-DIAGTERM-002A  USER        (nuevo)
GET    /api/diagnostic-terms/admin           ESAVI-DIAGTERM-002B  ADMIN       (nuevo)
GET    /api/diagnostic-terms/:id             ESAVI-DIAGTERM-003   USER        (nuevo)
PUT    /api/diagnostic-terms/:id             ESAVI-DIAGTERM-004   ADMIN       (nuevo)
DELETE /api/diagnostic-terms/:id             ESAVI-DIAGTERM-005A  ADMIN       (nuevo)
PATCH  /api/diagnostic-terms/activate/:id    ESAVI-DIAGTERM-005B  SUPERADMIN  (nuevo)
                                             ESAVI-DIAGTERM-006   (sin ruta)  (nuevo)
```

Orden de declaración en `diagnosticTerm.routes.ts`: las rutas literales `/admin` y `/activate/:id` van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

`ESAVI-DIAGTERM-006` no tiene fila en `ROUTE_RULES` porque no tiene ruta. El código existe en cuatro de los cinco lugares de §6 —comentario de servicio, código de `AppError`, `esaviLog` y `appDetails.method`—; el quinto, el comentario de ruta, no aplica.

### 3.5 Reglas de negocio por operación

**`ESAVI-DIAGTERM-001` — crear.** `source` toma `'LOCAL'` si no viene. Normaliza `code` con `toConstantCase(data.code.trim())` y `name` con `.trim()` únicamente. Comprueba unicidad del par `(source, code)` contra el valor ya normalizado y **sin filtrar por `isActive`** → 409 `DIAGTERM_001_CODE_EXISTS`. `metadata` se guarda como `{}`: el alta administrativa no lleva marcadores. Entrada de auditoría con `method: 'ESAVI-DIAGTERM-001'`.

**`ESAVI-DIAGTERM-002A` — listar público.** `findAndCountAll` con `isActive: true` fijo. Filtros por query: `search` (`Op.iLike` con `%valor%` sobre `name`, mínimo 2 caracteres), `source` (uno de `TERM_SOURCES`), `termGroup` (igualdad exacta sobre el valor `.trim()`). Paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Orden `name ASC`.

**`ESAVI-DIAGTERM-002B` — listar admin.** Gemela sin `isActive` en el `where`, más un cuarto filtro: `reviewStatus`, resuelto sobre la clave JSONB `metadata.reviewStatus`. Mismo orden y misma paginación.

**`ESAVI-DIAGTERM-003` — obtener por ID.** Existencia → 404 `DIAGTERM_003_NOT_FOUND`. Un término inactivo devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — y ese predicado es **solo SUPERADMIN** (`src/helpers/permissions.helper.ts:24`), así que un ADMIN recibe el mismo 404 que un USER. Es la asimetría que ya tiene `healthFacility`: el `002B` es ADMIN y lista inactivos, pero el `003` no los deja pedir por ID. Sin includes: la entidad no tiene asociaciones.

**`ESAVI-DIAGTERM-005A` / `005B` — desactivar y reactivar.** Sobre `setEntityActiveStatusService`, con transacción propia, igual que `setCatalogItemActivationService`. El `where` filtra **solo por la PK**. **No se comprueba ninguna FK entrante**: es borrado lógico, los `ON DELETE RESTRICT` no se disparan, y un término inactivo se sigue referenciando por diseño. Desactivar significa «deja de ofrecerse en el autocomplete», no «deja de existir». **No pasan por `buildDifferentialUpdate`**: son escrituras con intención propia que registran un hecho de estado.

**`ESAVI-DIAGTERM-006` — resolver término.** `resolveDiagnosticTermService({ code, name, operationCode }, authUser, lang, transaction)` en `src/services/common/diagnosticTermResolution.service.ts`. Recibe la transacción del llamante y **no abre una propia**: si la notificación se revierte, el término creado se revierte con ella. `source` es siempre `'LOCAL'`, no es parámetro. Cuatro ramas, en este orden:

1. Normaliza `code` con `toConstantCase(code.trim())` — el mismo tratamiento que el `001`, o el resolver no encontraría lo que el CRUD guardó.
2. `findOne` por `{ source: 'LOCAL', code }`, **sin filtrar por `isActive`**. Si existe, devuelve la fila **sin escribir nada**: ni `updatedAt`, ni `appDetails`, ni aunque el `name` entrante difiera del guardado. El maestro manda; la divergencia se conserva en el campo `*Raw*` de la tabla llamante.
3. Si no existe, `create` con `name` `.trim()`, `metadata: { autoCreated: true, createdFrom: operationCode, reviewStatus: 'PENDING' }` y una entrada de auditoría con `method: 'ESAVI-DIAGTERM-006'` y el `userId` de la sesión que notificó.
4. Si el `create` lanza `SequelizeUniqueConstraintError`, otra transacción ganó la carrera: relee por el mismo `where` y devuelve la fila ganadora. **El índice único es el árbitro, no el `findOne` del paso 2.** Si la relectura tampoco encuentra nada, se propaga el error original — es un fallo real, no una carrera.

   **El `create` —y solo él— va dentro de un `SAVEPOINT`** de la transacción del llamante, con `sequelize.transaction({ transaction }, …)`. Sin él la rama 4 es inalcanzable en el único escenario que la justifica: en Postgres, una violación de restricción **aborta la transacción entera**, y toda orden posterior del bloque se rechaza con `current transaction is aborted`, incluida la relectura. El savepoint no es una transacción propia — vive dentro de la del llamante, y el `rollback` del llamante lo deshace igual, así que la garantía de la sección 6 se mantiene intacta.

El resolver no lanza 404 ni 409 propios: su contrato es «siempre devuelve un término». Los errores de infraestructura los envuelve el endpoint llamante con su propio código de operación.

#### Contrato de update diferencial

**`ESAVI-DIAGTERM-004` — actualizar.** Existencia → 404 `DIAGTERM_004_NOT_FOUND`. Unicidad del par `(source, code)` excluyendo el propio id con `{ [Op.ne]: id }` → 409 `DIAGTERM_004_CODE_EXISTS`, **antes** del diff e independientemente de él: un `code` ocupado es 409 aunque el resto del body no cambie nada. El `source` del par es siempre el **guardado**, nunca el del body, porque `source` es inmutable. `stored` sale de `term.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `source` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `code` | `data.code ? toConstantCase(data.code.trim()) : undefined` | normalizado antes de comparar |
| `name` | `data.name ? data.name.trim() : undefined` | solo `trim` — ver §6 |
| `termGroup` | `data.termGroup !== undefined ? (data.termGroup?.trim() ?? null) : undefined` | anulable: `null` es un valor, `undefined` es «no vino» |
| `metadata` | `data.reviewStatus !== undefined ? { ...storedMetadata, reviewStatus: data.reviewStatus } : undefined` | derivado de un campo plano; el helper compara con `JSON.stringify` |
| `isActive` | **no entra** | lo gobiernan `005A`/`005B` |

La fila de `metadata` es la única con sustancia. `reviewStatus` llega plano en el body y se escribe fundido sobre el `metadata` guardado, preservando `autoCreated` y `createdFrom`. Un `PUT` que reenvíe el mismo `reviewStatus` produce un objeto idéntico, `JSON.stringify` coincide y el helper no detecta cambio — que es exactamente el comportamiento buscado.

**Ninguna operación de este spec propaga nada a otra tabla.** El `006` escribe en `diagnosticTerm` y devuelve un id; quien lo llama decide qué hacer con él.

**No pasan por el helper**, y se declara aquí una por una: el `001` (es un `create`), el `005A` y el `005B` (escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`), y el `006` en su rama de creación (también un `create`). En su rama de coincidencia, el `006` no escribe nada en absoluto, que es la forma más estricta del mismo principio.

### 3.6 Claves i18n nuevas

Bloque `diagnosticTerm` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` | 201 del `001` |
| `createdFailed` | 500 del `001` |
| `getSuccess` | 200 del `003` |
| `getFailed` | 500 del `003` |
| `getSuccessPlural` | 200 de `002A` y `002B` |
| `getFailedPlural` | 500 de `002A` y `002B` |
| `updatedSuccess` | 200 del `004` |
| `updatedFailed` | 500 del `004` |
| `deletedSuccess` | 200 del `005A` |
| `deletedFailed` | 500 del `005A` |
| `activatedSuccess` | 200 del `005B` |
| `activatedFailed` | 500 del `005B` |
| `notFound` | 404 en `003`, `004`, `005A` y `005B` |
| `codeExists` | 409 por `(source, code)` duplicado, en `001` y `004` |
| `alreadyActive` | 409 de `setEntityActiveStatusService` |
| `alreadyInactive` | 409 de `setEntityActiveStatusService` |

Los nombres siguen la nomenclatura de `references/CONVENTIONS.md` §13 —`createdSuccess`/`createdFailed` y no `created`, par `Plural` para los listados—, que es la que ya usan `healthFacility` y `nonSevereNotification` en `src/data/i18n/es.json`. La regla de §13 «si el endpoint existe, sus dos claves existen» obliga además a `deletedFailed` y `activatedFailed`, que un endpoint sin variante de error no necesitaría.

El `006` no estrena claves: no responde HTTP por sí mismo.

### 3.7 Forma de la respuesta

`003`, y cada fila de `002A` y `002B`:

```
{ ok, message, data: {
    diagnosticTermId, source, code, name, termGroup, metadata,
    isActive, createdAt, updatedAt, deletedAt, appDetails
} }
```

Misma forma completa en los tres, incluida `metadata`. Los listados devuelven `{ count, rows }` de `findAndCountAll` dentro de `data`. `002A` filtra por `isActive: true`; `002B` no filtra. `005A` y `005B` responden `{ ok, message }` **sin** `data`.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `diagnosticTerm | DIAGTERM` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila de `ESAVI-DIAGTERM-006` a la tabla de operaciones no canónicas con su descripción y la nota de que no tiene ruta. La norma exige registrar **antes** de usar, así que este paso va primero aunque no toque `src/`.
   *Verificación:* `DIAGTERM` aparece una sola vez en la tabla y no colisiona con las 18 existentes.

2. **Enum, modelo, tipos y barrels.** `TERM_SOURCES` y `TermSource` en `src/constants/enums.constants.ts`. `src/models/diagnosticTerm.model.ts` con las 12 columnas de §3.1 y alta en `src/models/index.ts`. `src/types/diagnosticTerm/diagnosticTerm.types.ts` con `CreateDiagnosticTermInput` y `ResolveDiagnosticTermInput`, su `index.ts` de barrel y el alta en `src/types/index.ts`. Sin archivo de asociaciones.
   *Verificación:* `npm run build` en 0; un `DiagnosticTerm.findAll()` en un script suelto devuelve filas sin error de columna inexistente.

3. **Las dieciséis claves i18n** del §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

4. **`ESAVI-DIAGTERM-001` — crear.** `createDiagnosticTermService`, controlador, validador con `code` obligatorio, `name` obligatorio, `source` opcional en `TERM_SOURCES` y `termGroup` opcional. Ruta `POST /` con `validateUserRole(ADMIN)`. Alta del validador en `src/validators/index.ts` y de la ruta en `src/routes/index.ts`.
   *Verificación:* crear con `code: "  11002-10115  "` guarda `11002_10115`; repetir el mismo par `(source, code)` devuelve **409**, no 500; crear sin `code` devuelve **400**; crear con `source: 'FAKE'` devuelve **400**.

5. **`ESAVI-DIAGTERM-002A` — listado público.** `getAllDiagnosticTermsService` con `isActive: true`, los tres filtros de §3.5, `findAndCountAll`, orden `name ASC`. Validador de query con `search` de mínimo 2 caracteres y `limit` entre 1 y 100. Ruta `GET /` con `validateUserRole(USER)`.
   *Verificación:* `?search=cef` devuelve los términos cuyo `name` contiene «cef» en cualquier posición y sin distinguir mayúsculas; `?search=c` devuelve **400**; un término inactivo no aparece.

6. **`ESAVI-DIAGTERM-002B` — listado admin.** Gemela sin `isActive` en el `where` y con el filtro `reviewStatus` sobre `metadata.reviewStatus`. Ruta `GET /admin` con `validateUserRole(ADMIN)`, declarada **antes** de `/:id`.
   *Verificación:* un ADMIN ve los inactivos; un USER recibe **403**; `?reviewStatus=PENDING` devuelve solo los términos con esa clave en `metadata`.

7. **`ESAVI-DIAGTERM-003` — obtener por ID.** `getDiagnosticTermByIdService(id, lang, includeInactive)`; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales, con su `diagnosticTermIdValidator`.
   *Verificación:* un ID inexistente devuelve **404**; `GET /admin` no se interpreta como un `:id`; un término inactivo devuelve **404** para USER y para ADMIN, y **200** para SUPERADMIN.

8. **`ESAVI-DIAGTERM-004` — actualizar.** `updateDiagnosticTermService` con la tabla de `candidates` de §3.5 y `buildDifferentialUpdate`. Unicidad del par contra el `source` **guardado**, antes del diff. Preserva el historial con `[...currentAppDetails, newEntry]`. Ruta `PUT /:id` con `validateUserRole(ADMIN)`.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta del `GET` devuelve **200** sin tocar `appDetails`, `updatedAt` ni `sysDetails.version`; un `PUT` con `source` distinto lo ignora sin error; un `PUT` con `reviewStatus: 'APPROVED'` conserva `autoCreated` y `createdFrom` en `metadata`.

9. **`ESAVI-DIAGTERM-005A` y `005B` — desactivar y reactivar.** `setDiagnosticTermActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción. Dos controladores y dos rutas — `DELETE /:id` ADMIN, `PATCH /activate/:id` SUPERADMIN —, ambas respondiendo sin `data`.
   *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve **409** `ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe **403** en `PATCH /activate/:id`.

10. **`ESAVI-DIAGTERM-006` — resolver término.** `src/services/common/diagnosticTermResolution.service.ts` con las cuatro ramas de §3.5. Recibe la transacción por parámetro y no abre una propia. Sin ruta, sin controlador y sin validador: el llamante valida su propio body.
    *Verificación:* invocado con un `code` existente no escribe nada —`appDetails` no crece y `updatedAt` no se mueve—, aunque el `name` difiera; invocado con un `code` nuevo crea la fila con `metadata.autoCreated` en `true` y `reviewStatus` en `'PENDING'`; el término creado aparece en `002B` con `?reviewStatus=PENDING`.

11. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **118 a 125**. `006` no lleva fila.
    *Verificación:* `npm test -- roles` pasa con 125.

12. **Suite `tests/contract/diagnosticTerm.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar público → listar admin → actualizar → desactivar → reactivar, verificando estado y envelope en cada paso. Más los caminos de error: 409 de par duplicado en create y en update, 400 de `search` corto, 400 de `source` fuera del enum, y los cinco casos de update diferencial de §5. Bloque aparte para el `006`, invocando el servicio directamente —no hay ruta— y cubriendo sus cuatro ramas, incluida la carrera: dos llamadas concurrentes con el mismo `code` nuevo terminan con **una sola** fila en la tabla y el mismo `diagnosticTermId` devuelto a las dos.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones canónicas; en el `006` coinciden los cuatro que aplican.
- [ ] `grep -rn "ESAVI-DIAGTERM-002[^AB]" src/` no devuelve resultados: todo es `002A` o `002B`.
- [ ] Crear con `code: "  11002-10115  "` guarda `11002_10115`.
- [ ] Crear con `name: "dolor de cabeza"` guarda `dolor de cabeza` **sin** recapitalizar.
- [ ] Crear sin `code` devuelve 400; crear con `source: 'FAKE'` devuelve 400.
- [ ] Crear dos veces el mismo par `(source, code)` devuelve 409, no 500, incluso si el primero está inactivo.
- [ ] Crear el mismo `code` con `source` distinto devuelve 201: la unicidad es del par.
- [ ] `?search=cef` encuentra `Cefalea` y `Dolor cefálico`; `?search=c` devuelve 400.
- [ ] `GET /admin` no se interpreta como un `:id`.
- [ ] `GET /:id` de un término inactivo: 404 para USER **y para ADMIN**, 200 para SUPERADMIN. `canViewInactive` es SUPERADMIN-only, y el `002B` sigue siendo ADMIN: la asimetría es deliberada y la misma que tiene `healthFacility`.
- [ ] `?reviewStatus=PENDING` en `002B` devuelve solo los términos con esa clave en `metadata`; el filtro no existe en `002A`.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Desactivar un término no consulta ninguna tabla hija: `grep -n "notificationEvent\|PregnancyComplication\|PregnancyCondition" src/services/diagnosticTerm.service.ts` no devuelve resultados.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] Las dieciséis claves existen en es, en y nl con los nombres de §3.6; `npm run i18n:check` sale en 0.
- [ ] `grep -n '"created"\|"updated"\|"deleted"\|"activated"' src/data/i18n/es.json` no devuelve resultados dentro del bloque `diagnosticTerm`: las claves llevan sufijo `Success`.
- [ ] `ROUTE_RULES` tiene 125 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/diagnosticTerm.service.ts` no devuelve resultados.
- [ ] Un `PUT` con un `code` ya ocupado responde **409** aunque el resto del body no cambie nada. La mitad del criterio canónico que habla de FK inactivas no aplica: `diagnosticTerm` no tiene ninguna FK saliente.

**Propios del `004`:**

- [ ] Un `PUT` con un `source` distinto del guardado responde **200** y deja `source` intacto, sin 400.
- [ ] Un `PUT` con `reviewStatus: 'APPROVED'` sobre un término autogenerado conserva `autoCreated: true` y `createdFrom` en `metadata`.
- [ ] Un `PUT` que reenvía el mismo `reviewStatus` no escribe nada.
- [ ] Un `PUT` con `termGroup: null` vacía la columna; un `PUT` sin la clave `termGroup` la deja como estaba.

**Propios del `006`:**

- [ ] Resolver un `code` existente devuelve su `diagnosticTermId` **sin escribir**: `appDetails` no crece y `updatedAt` no se mueve, aunque el `name` entrante difiera del guardado.
- [ ] Resolver un `code` existente pero **inactivo** devuelve su id igual, sin reactivarlo ni crear una fila nueva.
- [ ] Resolver un `code` nuevo crea la fila con `source: 'LOCAL'`, `metadata.autoCreated: true`, `metadata.createdFrom` con el código del endpoint llamante y `metadata.reviewStatus: 'PENDING'`.
- [ ] Resolver con `code: "  11002-10115  "` encuentra el término guardado como `11002_10115`: el resolver y el `001` normalizan igual.
- [ ] Dos resoluciones concurrentes del mismo `code` nuevo terminan con **una sola** fila y devuelven el mismo `diagnosticTermId`.
- [ ] La rama 4 responde **con la transacción del llamante abierta**: el `INSERT` perdedor colisiona, la relectura devuelve la fila ganadora y el llamante confirma sin error. Es el caso que el `SAVEPOINT` hace posible.
- [ ] Un `rollback` de la transacción del llamante deshace también el término creado: `grep -n "sequelize.transaction()" src/services/common/diagnosticTermResolution.service.ts` no devuelve resultados.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** unicidad por el par `(source, code)`. Es lo que declara `UQ_diagnosticTerm_source_code`. El mismo código puede existir en dos diccionarios y son términos distintos.
- **Sí:** `code` obligatorio en la API aunque el DDL lo permita nulo. Con toda fila codificada, la restricción única protege de verdad. La API más estricta que el esquema es la dirección segura; la contraria deja agujeros que solo se ven en producción.
- **No:** añadir el índice parcial `UNIQUE (source, lower(name)) WHERE code IS NULL`. Sería necesario si `code` fuera opcional, y obligaría a tocar `esaviapp.sql`, que se carga en los tests. Al hacerlo obligatorio, sobra.
- **Sí:** creación implícita desde el `006`. Un catálogo clínico que solo crece por su endpoint administrativo no crece: el término aparece cuando alguien notifica. La alternativa —rechazar la notificación por un término no catalogado— traslada al notificador un problema de gobernanza que no es suyo.
- **Sí:** el `006` fuerza `source: 'LOCAL'`. Un cliente no puede afirmar que un término pertenece a MedDRA o WHODrug; esos diccionarios se licencian y se versionan, y sus filas entran por importación.
- **Sí:** el `006` sin ruta HTTP. Exponerlo abriría una segunda puerta de escritura al maestro, con la incómoda pregunta de por qué un USER escribe donde el `001` exige ADMIN. Como servicio interno, la asimetría se lee bien: **la creación implícita es un efecto de notificar, no un alta de catálogo**.
- **Sí:** darle código `ESAVI-DIAGTERM-006` aun sin ruta. Escribe filas y deja `appDetails.method`; sin código registrado, ese `method` sería un valor huérfano que nadie puede rastrear hasta una operación.
- **Sí:** el `006` recibe la transacción del llamante. Si la notificación se revierte, el término creado se revierte con ella. Abrir una transacción propia dejaría términos huérfanos de notificaciones que nunca existieron.
- **Sí:** el maestro manda sobre el nombre entrante. Si el `code` existe con otro `name`, se referencia y no se toca nada. Actualizar el maestro con lo último que llegó dejaría que un notificador con un error tipográfico renombrase el término para todas las notificaciones históricas.
- **No:** responder 409 cuando el `name` entrante difiere del guardado. Endurecería el flujo de captura por una discrepancia que el campo `*Raw*` de la tabla llamante ya conserva íntegra.
- **Sí:** resolver la carrera por violación de unicidad y relectura. `findOrCreate` de Sequelize no cierra la ventana entre el `SELECT` y el `INSERT`. El índice único es el único árbitro fiable bajo concurrencia.
- **Sí:** el `create` del `006` dentro de un `SAVEPOINT`. Es la única forma de que la relectura de la rama 4 pueda ejecutarse: Postgres aborta la transacción completa ante una violación de restricción, y sin punto de recuperación la relectura muere con un `current transaction is aborted` que se lleva por delante la notificación entera. Verificado a mano antes de escribirlo: sin savepoint, el caso falla; con él, devuelve la fila ganadora y la transacción del llamante confirma con normalidad.
- **No:** dar al resolver una transacción propia para aislar el `create`. Resolvería el aborto y rompería lo importante: un término creado sobreviviría al `rollback` de la notificación que lo originó. El savepoint da lo primero sin costar lo segundo.
- **Sí:** un término inactivo se referencia igual. Desactivar significa «deja de ofrecerse en el autocomplete». Reactivarlo desde una notificación anularía en silencio la decisión de un administrador.
- **No:** bloquear la desactivación cuando el término ya está referenciado. Es borrado lógico: los `ON DELETE RESTRICT` no se disparan, y consultar tres tablas de otros dominios acoplaría este catálogo a notificación y a investigación. Es el mismo razonamiento que el SPEC 09 aplicó a `healthFacility`.
- **Sí:** marcar lo autogenerado con `metadata.autoCreated`, `createdFrom` y `reviewStatus`. Sin el marcador nadie distingue el término revisado del que entró por un formulario, y en seis meses conviven `Cefalea`, `Dolor de Cabeza` y `DOLOR CABEZA` sin forma de saber cuál mirar.
- **Sí:** `reviewStatus` escribible como campo plano en el `004`. Es la única vía para que un `PENDING` llegue a `APPROVED`; sin ella la cola de revisión solo crece y el marcador es decorativo.
- **No:** `metadata` escribible completa. Un `PUT` con `metadata: {}` borraría el rastro de autoría. Acotar la escritura a una sola clave conocida cuesta una línea y cierra el agujero.
- **Sí:** filtrar por `metadata.reviewStatus` en `002B`. Es el primer filtro JSONB del repositorio y se acota a un listado admin de un catálogo pequeño.
- **Sí:** introducir `Op.iLike`, limitado a `name` y a los dos listados. El caso de uso real del catálogo es el autocomplete del formulario de notificación; entregarlo sin búsqueda por texto sería entregar la mitad. El SPEC 09 lo difirió por ser transversal, y este spec lo acota deliberadamente a una entidad para que siga sin serlo.
- **Sí:** `name` solo con `.trim()`, sin `toTitleCase`. Es una desviación razonada de `CONVENTIONS.md` §11. El nombre de un término de diccionario es un dato **citado**, no un nombre propio que la aplicación embellece: `toTitleCase` convertiría `Dolor de Cabeza` en `Dolor De Cabeza` y destruiría la capitalización oficial de cualquier término importado. La deduplicación no sufre, porque el resolver busca siempre por `code`.
- **No:** aplicar `toTitleCase` solo cuando `source = 'LOCAL'`. Una regla de normalización condicional obliga a razonar el `004` dos veces y a decidir qué pasa si el `source` cambiara.
- **Sí:** `source` inmutable en el `004`. Cambiarlo reescribe la identidad de una fila ya referenciada y mueve el par único bajo los pies de la restricción. Promover un término local a MedDRA es una operación de fusión, no una edición de campo.
- **Sí:** ignorar `source` en silencio en vez de responder 400. Es la forma que §11 prescribe para los campos inmutables, y evita que un cliente que reenvía la respuesta del `GET` reciba un error por un campo que no pretendía cambiar.
- **Sí:** no crear archivo de asociaciones. `diagnosticTerm` no tiene FK saliente y las tres entrantes pertenecen a las tablas hijas, que las declararán en sus propios archivos. Un `initDiagnosticTermAssociations()` con cuerpo vacío registrado en `initAssociations()` es un artefacto que no hace nada y que el siguiente spec abriría igualmente. Es desviación consciente del artefacto 2 de §1, no olvido.
- **No:** exponer contadores de uso en el `003`. Contar referencias exige consultar tres tablas que aún no existen, y el número no cambia ninguna decisión del administrador.
- **Sí:** claves i18n con la nomenclatura de §13 —`createdSuccess`, `deletedSuccess`, par `Plural` en los listados— en vez de los nombres cortos que llevaba la primera redacción de §3.6. Son cuatro claves más, y a cambio `diagnosticTerm` no nace como la única entidad del repositorio con un esquema de nombres propio. La paridad de forma entre entidades es lo que permite leer un `getMessage` sin abrir el JSON.
- **Sí:** forma de respuesta completa también en `002A`. Recortarla para el autocomplete rompería la simetría con el resto del repositorio a cambio de unos pocos bytes por fila.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El maestro se llena de variantes del mismo término introducidas por notificadores | Todo lo autogenerado nace con `reviewStatus: 'PENDING'` y es filtrable en `002B`. La fusión y la aprobación son el spec de gobernanza; este spec garantiza que la cola exista y sea consultable |
| Dos notificaciones simultáneas con el mismo `code` nuevo duplican la fila | El `INSERT` se intenta y el `SequelizeUniqueConstraintError` se captura releyendo la fila ganadora. El árbitro es el índice único, no el `SELECT` previo |
| La violación de unicidad aborta la transacción del llamante y la relectura no puede ejecutarse | El `create` va en un `SAVEPOINT`: la violación revierte solo hasta ahí y el bloque exterior sigue operativo. Cubierto por un criterio de aceptación propio |
| Dos transacciones abiertas insertan el mismo `code` a la vez | Postgres **bloquea** el segundo `INSERT` hasta que la primera termina; no falla de inmediato. Es comportamiento correcto, pero conviene saberlo al escribir pruebas: dos resoluciones concurrentes sin confirmar se esperan mutuamente |
| El `006` normaliza el `code` distinto que el `001` y nunca encuentra lo guardado | Ambos aplican `toConstantCase(code.trim())`. Cubierto por un criterio de aceptación explícito |
| Un notificador escribe un `code` inventado y crea un término basura | Es el precio de no bloquear la captura, y por eso se marca. Sin la marca el problema existiría igual y además sería invisible |
| `Op.iLike` con `%valor%` no usa índice y degrada con el catálogo lleno | El mínimo de 2 caracteres y el `limit` acotan el coste. Si MedDRA entra completo —del orden de 80 000 términos—, hará falta un índice `gin_trgm_ops`, y eso es un cambio de esquema con su propio spec |
| El filtro `metadata.reviewStatus` tampoco usa índice | Solo corre en `002B`, un listado administrativo de baja frecuencia |
| `GET /:id` captura `/admin` o `/activate` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato |
| Una notificación se revierte y deja el término creado | El `006` corre en la transacción del llamante y no abre una propia. Verificado por `grep` en los criterios de aceptación |
| Un término se desactiva y las notificaciones que lo referencian quedan apuntando a algo que el autocomplete ya no ofrece | Es el comportamiento buscado: la referencia es histórica. `notificationEvent` guarda además `esaviName` y `esaviCode` como copia, así que la notificación se lee entera sin el maestro |

---

## 8. Impacto en el contrato HTTP

No aplica. El spec solo añade endpoints nuevos; ningún cliente actual cambia de comportamiento.

---

## Lo que **no** está en este spec

- El flujo de gobernanza del catálogo: cola de revisión, aprobación en lote, notificación de pendientes.
- La fusión de términos duplicados y el repunte de las FK entrantes.
- La recodificación de un `notificationEvent` ya guardado.
- La importación masiva desde MedDRA o WHODrug, y el versionado del diccionario.
- `notificationEvent`, `notificationPregnancyComplication` e `investigationPregnancyCondition`.
- Promover un término de `LOCAL` a `MEDDRA`.
- Búsqueda parcial sobre `termGroup` o sobre `code`.
- El índice `gin_trgm_ops` sobre `name`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
