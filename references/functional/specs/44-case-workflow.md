# SPEC F44 — Flujo del expediente ESAVI (`caseWorkflow`)

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F06 (`esaviCase` — dependencia dura, la fila nace dentro de su `001`), SPEC F09 (`classification`), SPEC F10 (`notification`), SPEC F12 (update diferencial), SPEC F28 (`investigation`), SPEC F41 (`finalClassification`), **SPEC F43 (`appPasswordReset`) — dependencia de orden, no técnica: se implementa antes que este spec** (ver §1)
> **Fecha:** 2026-08-26
> **Objetivo:** Dar de alta `caseWorkflow` —la 47ª tabla del DDL— para registrar en qué punto del proceso está cada expediente, cuánto duró cada etapa, y permitir cerrarlo y reabrirlo.

---

## 1. Por qué existe este spec

**Hoy el estado de un expediente no está guardado en ninguna parte.** Las cinco etapas del proceso existen como tablas y las cinco están implementadas —`patient` (F05), `esaviCase` (F06), `classification` (F09), `notification` (F10), `investigation` (F28), `finalClassification` (F41)—, pero ninguna registra el avance del caso a través de ellas. Averiguar en qué punto está un caso obliga a cuatro consultas de existencia por `caseId`, una por satélite.

Eso deja tres cosas fuera del alcance del sistema:

**A — Un caso no se puede cerrar.** Cerrar un expediente es una decisión que alguien toma, no un hecho que se deduzca de la presencia de filas. Un caso con sus cinco etapas completas y un caso cerrado son indistinguibles en el esquema actual. Y sin cierre no hay reapertura: `esaviCase` solo tiene `isActive`/`deletedAt` (`esaviapp.sql:646-668`), que expresan «retirado», no «terminado».

**B — No se puede medir cuánto tarda el proceso.** Las tablas de etapa tienen `createdAt`, así que se sabe cuándo se creó cada fila, pero no cuándo el expediente entró y salió de cada fase. Un caso cuya notificación se creó el día 3 y se completó el día 40 es indistinguible de uno que se resolvió en una tarde. Para una vigilancia de farmacovigilancia, ese dato es el indicador de desempeño principal.

**C — No hay estado de validación.** Un caso que necesita revisión antes de continuar no tiene cómo señalarlo. Hoy se queda en el limbo y depende de que alguien lo recuerde.

**Este spec amplía el DDL, y no es el primero en hacerlo.** `esaviapp.sql` es autoritativo y `sequelize.sync()` no se usa; durante las primeras cuarenta y dos entregas todo spec escribía el modelo para calzar con una tabla ya existente, y el SPEC F06 llegó a declarar literalmente que el DDL no se toca. El [SPEC F43](./43-auth-password-reset.md) rompió esa regla primero, con `appPasswordReset` como tabla 46, y **se implementa antes que éste** — de modo que aquí el precedente ya está sentado y `caseWorkflow` es la **47ª** tabla del esquema. Tampoco había alternativa: ninguna de las 46 tablas guarda estado de expediente, y meterlo como columnas de `esaviCase` reabriría una entidad ya implementada para cargarla con un ciclo de vida que no es suyo. La tabla nueva aísla el cambio y deja las 46 existentes intactas.

**Orden de implementación respecto de F43.** Los dos specs son independientes: no comparten tablas, ni servicios, ni endpoints, ni claves i18n, y sus tablas se insertan en bloques distintos de `esaviapp.sql` —`appPasswordReset` en *Application administration*, justo después de `appSession`; `caseWorkflow` al final, después de `finalClassification`—, así que no compiten por el mismo lugar del archivo. El orden se fijó por riesgo, no por dependencia: F43 toca poco código existente, mientras que este spec convierte en transaccionales cinco servicios ya implementados. La única consecuencia práctica es de referencias: **todos los números de línea de `esaviapp.sql` citados en este spec corresponden al archivo previo a F43**, que inserta su bloque por encima de la mayoría de ellos y los desplaza. Al implementar, localizar por nombre —`CREATE TABLE "finalClassification"`, el `FOREACH t IN ARRAY` de `preventPhysicalDelete`— y no por número.

Un dato de contexto para no confundir dos cosas parecidas: `investigation.statusItemId` (`esaviapp.sql:932`) apunta al catálogo `investigationStatus` sembrado en `esaviapp.sql:1599-1604` —*Recuperado*, *Fallecido*, *No recuperado*—. Ése es el **desenlace clínico del paciente**. El estado que introduce este spec es el **avance administrativo del expediente**. Son ortogonales: un caso cerrado puede tener al paciente sin recuperar, y un paciente recuperado puede tener el expediente abierto.

---

## 2. Alcance

**Dentro:**

- **Tabla nueva `caseWorkflow` en `esaviapp.sql`**, una fila por caso, con `UQ_caseWorkflow_case UNIQUE ("caseId")` y `FK_caseWorkflow_case` con `ON DELETE CASCADE`, siguiendo la forma de los otros cuatro satélites 1:1 del caso.
- **Alta de `'caseWorkflow'` en el bucle `preventPhysicalDelete`** (`esaviapp.sql:1372-1386`). En consecuencia la entidad **no** expone `005C`, por la regla de disponibilidad de `references/CONVENTIONS.md` §6.
- **Catálogo `caseWorkflowStatus` sembrado en `esaviapp.sql`** con `upsertCatalogItem`, ocho ítems: `OPEN`, `IN_CLASSIFICATION`, `IN_NOTIFICATION`, `IN_INVESTIGATION`, `IN_FINAL_CLASSIFICATION`, `PENDING_VALIDATION`, `CLOSED`, `REOPENED`.
- Los siete artefactos completos de `caseWorkflow`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Once operaciones**: `001` (interno, sin ruta), `002A`, `002B`, `003`, `005A`, `005B`, `006`, `007` cerrar etapa, `008` cerrar caso, `009` reabrir, `010` pedir validación, `011` resolver validación y `012` avanzar de etapa (interno, sin ruta). **No hay `004`**: la fila no tiene ningún campo editable a mano.
- **Cuatro sellos de inicio y cuatro de fin**, uno por etapa, más `openedAt`, `closedAt` y `lastReopenedAt`. Las duraciones se **calculan al leer**; no hay columna que las guarde.
- **Resolución de la fila de cada etapa en el `data`** — `exists` e `id` por satélite, para que un cliente que retoma un expediente sepa en una sola llamada si cada etapa se crea con `POST` o se actualiza con `PUT /:id`. Ver §3.7.
- **Propagación del sello de inicio desde los cuatro servicios de etapa.** `createClassificationService`, `createNotificationService`, `createInvestigationService` y `createFinalClassificationService` sellan su `startedAt` y mueven `statusItemId`. Los cuatro pasan a ser multi-escritura y por tanto transaccionales.
- **Auto-sellado del fin de la etapa anterior.** Si al arrancar una etapa la anterior tiene su `endedAt` en `NULL`, se sella con el mismo instante. Ningún sello queda huérfano.
- **Modificación de `createEsaviCaseService` (SPEC F06)** para crear la fila de flujo en `OPEN` dentro de su propia transacción. Es la única forma de garantizar que no existan casos sin flujo.
- **Precondiciones de cierre** verificadas en el servicio, con 409 cuando falta una etapa exigible.
- **Reapertura por ADMIN**, con `reopenCount` y `lastReopenedAt`; el caso queda en `REOPENED` hasta la siguiente transición.
- **`PENDING_VALIDATION` reversible**: `previousStatusItemId` guarda el estado desde el que se pidió validación y al salir se restaura.
- Alta de la abreviatura `CASEFLOW` en `references/CONVENTIONS.md` §6, y de las siete operaciones no canónicas (`006`–`012`) en la tabla de §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/caseWorkflow.test.ts`.

**Fuera de alcance (otros specs):**

- **La tabla de eventos `caseWorkflowEvent` (1:N).** Este spec guarda el estado actual y sus sellos; el historial consultable de transiciones —quién movió qué y cuándo, con filtros— es una tabla aparte. Mientras tanto el rastro vive en `appDetails` y en `sysDetails.auditTrail`, que ya son append-only por `TRG_caseWorkflow_setSysDetails`.
- **Plazos, vencimientos y alertas.** Nada de *«un caso grave debe cerrarse en 90 días»*. Este spec deja los sellos que harían falta para calcularlo, y no calcula nada.
- **Backfill de los casos ya existentes.** Un caso creado antes de este spec no tendrá fila de flujo y su `006` responderá 404. El script de reconciliación va en su propio spec; aquí solo se garantiza que los casos **nuevos** siempre la tengan.
- **Resolver la discrepancia entre `classification.isSeriousEvent` y `notification.notificationType`.** Son dos declaraciones de gravedad que el esquema no obliga a coincidir. Este spec elige una como fuente y anota el riesgo; unificarlas es una corrección sobre F09 y F10.
- **Un `004` de update y las notas por etapa.** Con una fila por caso no hay dónde colgar una nota de etapa sin inventar una estructura. Si aparece la necesidad, va con `caseWorkflowEvent`.
- **`005C` borrado físico.** La tabla entra en `preventPhysicalDelete`; el trigger rechazaría el `DELETE` y el endpoint no se declara.
- **Cascada de desactivación desde `esaviCase`.** Desactivar un caso no desactiva hoy sus satélites —es la deuda que el propio SPEC F06 dejó anotada—, y este spec no la resuelve ni la agrava.
- **Reportes, exportación o agregación de duraciones.** Los sellos quedan expuestos en el `data`; agregarlos es otro spec.
- **Notificaciones, correos o webhooks al cambiar de estado.**
- **Bloquear la creación de una etapa porque la anterior no esté cerrada.** Se descartó explícitamente: convertiría este spec en un guardián capaz de romper los flujos de F09, F10, F28 y F41.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen — **nueva**

`caseWorkflow` no existe. Este spec la crea como **tabla 47**, después de la 46 que añade el [SPEC F43](./43-auth-password-reset.md). Se inserta en `esaviapp.sql` **después** de `finalClassification` (`esaviapp.sql:1260-1286` en el archivo previo a F43), que es la última tabla del bloque y el último satélite del caso. F43 inserta la suya mucho antes, tras `appSession`, así que las dos altas no se tocan y el `git diff` de cada una es un bloque contiguo distinto.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `caseWorkflowId` | `uuid` | no | PK, `gen_random_uuid()` |
| `caseId` | `uuid` | no | `FK_caseWorkflow_case` → `esaviCase`, `ON DELETE CASCADE`; `UQ_caseWorkflow_case` |
| `statusItemId` | `uuid` | no | `FK_caseWorkflow_status` → `catalogItem`, `ON DELETE RESTRICT` |
| `previousStatusItemId` | `uuid` | sí | `FK_caseWorkflow_previousStatus` → `catalogItem`; solo se llena al entrar en `PENDING_VALIDATION` |
| `openedAt` | `timestamptz` | no | `DEFAULT current_timestamp`; se sella al crear el caso |
| `classificationStartedAt` | `timestamptz` | sí | |
| `classificationEndedAt` | `timestamptz` | sí | |
| `notificationStartedAt` | `timestamptz` | sí | |
| `notificationEndedAt` | `timestamptz` | sí | |
| `investigationStartedAt` | `timestamptz` | sí | **No confundir con `investigation.investigationStartDate`** (`esaviapp.sql:937`, `date`), que es la fecha clínica de arranque de la investigación. Ésta es el instante en que el expediente entró en la fase |
| `investigationEndedAt` | `timestamptz` | sí | |
| `finalClassificationStartedAt` | `timestamptz` | sí | |
| `finalClassificationEndedAt` | `timestamptz` | sí | |
| `closedAt` | `timestamptz` | sí | |
| `lastReopenedAt` | `timestamptz` | sí | |
| `reopenCount` | `smallint` | no | `DEFAULT 0`, `CHECK ("reopenCount" >= 0)` |

Más las cinco transversales del esquema: `isActive boolean NOT NULL DEFAULT true`, `createdAt timestamptz NOT NULL DEFAULT current_timestamp`, `updatedAt timestamptz`, `deletedAt timestamptz`, `sysDetails jsonb NOT NULL DEFAULT '{}'::jsonb` y `appDetails jsonb NOT NULL DEFAULT '{}'::jsonb`.

Índices: `IX_caseWorkflow_case` sobre `("caseId")` e `IX_caseWorkflow_status` sobre `("statusItemId")`. El segundo existe porque el filtro por estado es el uso principal del listado.

Tres decisiones de forma que el spec deja escritas para que nadie las lea como descuido:

- **`appDetails` lleva `DEFAULT '{}'::jsonb`, no `'[]'`.** Es un array y el objeto vacío no lo representa, pero las 46 tablas del esquema lo declaran así —las 45 originales y `appPasswordReset`, que F43 alineó con la misma forma— y los servicios siempre insertan el array completo, de modo que el `DEFAULT` no llega a aplicarse nunca. Se mantiene la forma existente por coherencia; corregirla en las 47 tablas es otro spec.
- **No hay trigger de validación de catálogo.** `healthFacility` tiene `TRG_healthFacility_validateCatalogs`, pero `investigation.statusItemId` —el precedente exacto de este campo— no tiene ninguno y la validación la hace el servicio. Se sigue ese precedente.
- **Los dos triggers genéricos sí alcanzan a la tabla**, porque el bucle de `esaviapp.sql` los aplica a toda tabla con columna `sysDetails`: `TRG_caseWorkflow_setUpdatedAt` y `TRG_caseWorkflow_setSysDetails` se crean solos. El tercero, `TRG_caseWorkflow_preventPhysicalDelete`, **no**: hay que añadir `'caseWorkflow'` a mano al array del bucle de `esaviapp.sql:1372-1386`.

**Catálogo nuevo.** Ocho `CALL "upsertCatalogItem"` en el bloque de siembra, sobre el `catalogType` `caseWorkflowStatus`:

| `code` | `name` (es) | `sortOrder` |
|---|---|---|
| `OPEN` | Abierto | 1 |
| `IN_CLASSIFICATION` | En clasificación | 2 |
| `IN_NOTIFICATION` | En notificación | 3 |
| `IN_INVESTIGATION` | En investigación | 4 |
| `IN_FINAL_CLASSIFICATION` | En clasificación final | 5 |
| `PENDING_VALIDATION` | Pendiente de validación | 6 |
| `CLOSED` | Cerrado | 7 |
| `REOPENED` | Reabierto | 8 |

`caseWorkflowStatus` es un `catalogType`, así que su `code` va en camelCase por la excepción declarada de `references/CONVENTIONS.md` §Normalización; los `code` de los ocho `catalogItem` van en `CONSTANT_CASE`, como `userStatus` (`esaviapp.sql:1594-1597`).

### 3.2 Modelo Sequelize

Archivo `src/models/caseWorkflow.model.ts`, clase `CaseWorkflow`. `timestamps: false`, `freezeTableName: true`, `tableName: 'caseWorkflow'`, PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. Alta en `src/models/index.ts`.

Asociaciones en `src/models/associations/caseWorkflow.associations.ts`, registrado en `initAssociations()`. Nunca dentro del modelo:

- `CaseWorkflow.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' })`
- `EsaviCase.hasOne(CaseWorkflow, { foreignKey: 'caseId', as: 'workflow' })`
- `CaseWorkflow.belongsTo(CatalogItem, { foreignKey: 'statusItemId', as: 'status' })`
- `CaseWorkflow.belongsTo(CatalogItem, { foreignKey: 'previousStatusItemId', as: 'previousStatus' })`

Los dos `belongsTo` a `CatalogItem` necesitan alias distintos: sin ellos Sequelize no puede resolver dos asociaciones al mismo modelo.

### 3.3 Tipos

`src/types/caseWorkflow/caseWorkflow.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.

```ts
export type CaseWorkflowStage =
    | 'CLASSIFICATION'
    | 'NOTIFICATION'
    | 'INVESTIGATION'
    | 'FINAL_CLASSIFICATION';

export interface CreateCaseWorkflowInput {
    caseId: string;
}

export interface CompleteCaseWorkflowStageInput {
    stage: CaseWorkflowStage;
}

export interface CaseWorkflowListFilters {
    caseId?: string;
    statusCode?: string;     // `code` del catalogItem, no su UUID
    openedFrom?: string;     // ISO date
    openedTo?: string;
}

export interface CaseWorkflowStageDuration {
    startedAt: string | null;
    endedAt: string | null;
    durationMinutes: number | null;   // calculado al leer; null si falta un sello
}
```

`CreateCaseWorkflowInput` tiene un solo campo porque el resto lo decide el sistema: el estado inicial es siempre `OPEN` y `openedAt` es el instante de la creación. Ninguno de los dos se acepta del cliente.

**No se declara `UpdateCaseWorkflowInput`.** Está prohibido por §4 de las convenciones, y además aquí no habría qué poner: la entidad no tiene `004`.

`CaseWorkflowStage` es un tipo de la aplicación, no un `ENUM` de PostgreSQL. Solo viaja en el body de `007`; no se guarda en ninguna columna, así que no hay razón para llevarlo al esquema.

### 3.4 Superficie HTTP

Ruta base `/api/case-workflows`, registrada en `src/routes/index.ts`.

```
(sin ruta HTTP)                                     ESAVI-CASEFLOW-001   —           (nuevo)
(sin ruta HTTP)                                     ESAVI-CASEFLOW-012   —           (nuevo)
GET    /api/case-workflows                          ESAVI-CASEFLOW-002A  USER        (nuevo)
GET    /api/case-workflows/admin                    ESAVI-CASEFLOW-002B  ADMIN       (nuevo)
GET    /api/case-workflows/case/:caseId             ESAVI-CASEFLOW-006   USER        (nuevo)
PATCH  /api/case-workflows/case/:caseId/complete-stage       ESAVI-CASEFLOW-007   USER        (nuevo)
PATCH  /api/case-workflows/case/:caseId/close                ESAVI-CASEFLOW-008   USER        (nuevo)
PATCH  /api/case-workflows/case/:caseId/reopen               ESAVI-CASEFLOW-009   ADMIN       (nuevo)
PATCH  /api/case-workflows/case/:caseId/request-validation   ESAVI-CASEFLOW-010   USER        (nuevo)
PATCH  /api/case-workflows/case/:caseId/resolve-validation   ESAVI-CASEFLOW-011   USER        (nuevo)
GET    /api/case-workflows/:id                      ESAVI-CASEFLOW-003   USER        (nuevo)
PUT    /api/case-workflows/:id                      —                    —           (no existe)
DELETE /api/case-workflows/:id                      ESAVI-CASEFLOW-005A  ADMIN       (nuevo)
PATCH  /api/case-workflows/activate/:id             ESAVI-CASEFLOW-005B  SUPERADMIN  (nuevo)
DELETE /api/case-workflows/purge/:id                —                    —           (no existe)
```

**Orden de declaración.** Las rutas literales y las del prefijo `/case/` van **antes** de `/:id` y de `/activate/:id`. Sin ese orden Express captura `admin` y `case` como un `:id`, y el `caseWorkflowIdValidator` responde 400 sobre un UUID que nadie mandó.

**Todas las operaciones de transición cuelgan de `/case/:caseId`, no de `/:id`.** El cliente que ejecuta una transición conoce el caso, no el `caseWorkflowId`, y obligarle a resolver primero el UUID del flujo añade una llamada sin ganar nada. Deja además `/:id` libre para las tres operaciones canónicas que sí se dirigen a la fila por su PK.

**`001` y `012` no tienen ruta.** Son servicios internos que otros dominios invocan dentro de su propia transacción. Tienen precedente exacto: `ESAVI-SESSION-001`, `-006` y `-007` del SPEC F42 son igualmente operaciones sin superficie HTTP.

**No hay `004` ni `005C`.** El primero porque la fila no tiene ningún campo que un humano deba editar; el segundo porque `caseWorkflow` entra en `preventPhysicalDelete` y la regla de §6 lo prohíbe. Las dos ausencias son deliberadas y el checklist de §15 no debe marcarlas.

**`005A` y `005B` existen pero no son parte del flujo.** Desactivar una fila de flujo es una operación administrativa sobre el registro, no un cierre del expediente. Cerrar un caso es `008`. Confundir ambas es el error que este spec más quiere evitar, y por eso los mensajes i18n de `005A`/`005B` hablan de «registro de flujo» y nunca de «caso».

Cadena de middlewares, invariable:

```ts
router.<method>('/<path>', tokenValidation, validateUserRole(ROL), ...validator, validateFields, handler);
```

Toda ruta con `:caseId` lleva `caseIdValidator`; toda ruta con `:id` lleva `caseWorkflowIdValidator`; `validateFields` va inmediatamente después de los validadores; un solo rol por `validateUserRole`.

### 3.5 Reglas de negocio por operación

Servicio en `src/services/caseWorkflow.service.ts`. Todas las validaciones de FK devuelven **404** y todos los conflictos de estado **409**, según §10.

**`ESAVI-CASEFLOW-001` — crear el flujo (interno).** `createCaseWorkflowService(data, authUser, lang, transaction)`. Lo invoca `createEsaviCaseService` dentro de su propia transacción, así que **no valida que el caso exista**: se está creando en la misma unidad de trabajo. Resuelve el `catalogItem` de `code` `OPEN` bajo el `catalogType` `caseWorkflowStatus`; si el catálogo no está sembrado → 500 `CASEFLOW_001_STATUS_NOT_FOUND`, porque es un fallo de despliegue y no de entrada. Escribe `statusItemId = OPEN`, `openedAt = new Date()`, `reopenCount = 0`. Si ya existe flujo para ese caso → 409 `CASEFLOW_001_WORKFLOW_EXISTS`. Auditoría con `method: 'ESAVI-CASEFLOW-001'`.

**`ESAVI-CASEFLOW-012` — avanzar de etapa (interno, sin ruta).** `advanceCaseWorkflowStageService(caseId, stage, authUser, lang, transaction)`. Lo invocan los cuatro servicios de creación de etapa —`createClassificationService`, `createNotificationService`, `createInvestigationService` y `createFinalClassificationService`— dentro de la transacción que crea su propia fila. Hace cuatro cosas, en este orden:

1. Localiza el flujo por `caseId` → 404 `CASEFLOW_012_NOT_FOUND` si no existe (caso anterior a este spec; ver §7).
2. Si el estado es `CLOSED` → 409 `CASEFLOW_012_CASE_CLOSED`. Un expediente cerrado no gana etapas nuevas: primero se reabre.
3. Sella `<stage>StartedAt` **solo si estaba en `NULL`**. Es idempotente: reejecutarlo no reescribe el instante original.
4. Si la etapa **anterior** tiene `startedAt` no nulo y `endedAt` en `NULL`, la cierra con **el mismo instante**. Ningún sello queda huérfano y toda duración es calculable.

Sobre el estado: `012` mueve `statusItemId` al estado de la etapa (`IN_CLASSIFICATION`, `IN_NOTIFICATION`, `IN_INVESTIGATION`, `IN_FINAL_CLASSIFICATION`). **Excepción:** si el flujo está en `PENDING_VALIDATION`, el estado **no se mueve** — se actualiza `previousStatusItemId` al estado de la etapa nueva, de modo que `011` devuelva el caso al punto donde realmente está. Avanzar de etapa no cancela una validación pedida; ése es justo el propósito del estado.

> **Nota sobre `CASEFLOW_012_CASE_CLOSED`.** El rechazo de etapas nuevas sobre un caso `CLOSED` es una regla de proceso, no una restricción del esquema: ninguna columna ni constraint la impone. Vive en una sola comprobación del paso 2 de `012`. Si en el futuro se decide que un caso cerrado admita etapas nuevas —una investigación tardía, una corrección documental— basta con retirar esa comprobación, y no hay migración ni cambio de contrato que acompañarla. Queda escrito para que quien lo evalúe entonces sepa que el coste de abrirlo es de una línea.

**`ESAVI-CASEFLOW-002A` / `002B` — listar.** `findAndCountAll` con `{ count, rows }`, orden por defecto `openedAt DESC`, `limit`/`offset` desde `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Cuatro filtros por query: `caseId`, `statusCode`, `openedFrom` y `openedTo`. `statusCode` viaja como el `code` del `catalogItem` (`IN_INVESTIGATION`), no como su UUID: el cliente conoce el nombre del estado, no su identificador. Se resuelve contra `catalogItem` antes de consultar; un `statusCode` inexistente → 404 `CASEFLOW_002_STATUS_NOT_FOUND`. `002A` filtra `isActive: true`; `002B` no filtra.

**`ESAVI-CASEFLOW-003` — obtener por ID.** Por `caseWorkflowId` → 404 `CASEFLOW_003_NOT_FOUND`. Las filas inactivas solo son visibles si `canViewInactive(req.user)`.

**`ESAVI-CASEFLOW-006` — obtener el flujo de un caso.** Por `caseId`, relación 1:1 garantizada por `UQ_caseWorkflow_case`. El caso no existe → 404 `CASEFLOW_006_CASE_NOT_FOUND`; el caso existe pero no tiene flujo → 404 `CASEFLOW_006_NOT_FOUND`. Son dos códigos distintos a propósito: el segundo señala un caso anterior a este spec y es el síntoma que el backfill tendrá que resolver.

Es además **la llamada con la que un cliente retoma un expediente**: junto al estado y los sellos resuelve el PK de las cuatro etapas (`exists` e `id`, §3.7), de modo que una sola petición basta para saber en qué paso continuar y si cada etapa se crea o se actualiza. Los cuatro `findOne` de PK van en el mismo `Promise.all` que la carga del flujo.

**`ESAVI-CASEFLOW-007` — cerrar una etapa.** Body `{ stage }`, validado contra los cuatro valores de `CaseWorkflowStage` → 400 lo emite `validateFields`. Después: flujo inexistente → 404 `CASEFLOW_007_NOT_FOUND`; estado `CLOSED` → 409 `CASEFLOW_007_CASE_CLOSED`; `<stage>StartedAt` en `NULL` → 409 `CASEFLOW_007_STAGE_NOT_STARTED`; `<stage>EndedAt` ya sellado → 409 `CASEFLOW_007_STAGE_ALREADY_COMPLETED`. Sella `<stage>EndedAt = new Date()` y **no toca `statusItemId`**: el estado lo mueve la propagación, nunca el cierre de etapa.

**`ESAVI-CASEFLOW-008` — cerrar el caso.** Flujo inexistente → 404 `CASEFLOW_008_NOT_FOUND`; ya `CLOSED` → 409 `CASEFLOW_008_ALREADY_CLOSED`; en `PENDING_VALIDATION` → 409 `CASEFLOW_008_PENDING_VALIDATION`, porque cerrar un caso que alguien mandó a revisar sin resolverla vacía el estado de sentido.

Luego las precondiciones de etapa, todas sobre filas **activas** del caso:

| Etapa | Se exige cuando | Falla con |
|---|---|---|
| `classification` | siempre | 409 `CASEFLOW_008_CLASSIFICATION_REQUIRED` |
| `notification` | siempre | 409 `CASEFLOW_008_NOTIFICATION_REQUIRED` |
| `investigation` | `notification.requestInvestigation === true` | 409 `CASEFLOW_008_INVESTIGATION_REQUIRED` |
| `finalClassification` | `classification.isSeriousEvent === true` **o** `notification.requestInvestigation === true` | 409 `CASEFLOW_008_FINAL_CLASSIFICATION_REQUIRED` |

La gravedad se lee de `classification.isSeriousEvent` (`esaviapp.sql:700`), que es donde el usuario la declara. Un `NULL` se trata como «no grave». La cuarta fila cubre las cuatro combinaciones acordadas: un caso grave se clasifica formalmente aunque no se investigue, y un caso no grave que sí se investigó arrastra su clasificación final.

Al cerrar: sella `closedAt = new Date()`, pone `statusItemId = CLOSED`, deja `previousStatusItemId = null`, y **auto-sella el `endedAt` de la última etapa que siga abierta**, con el mismo instante y por la misma razón que en `012`.

**`ESAVI-CASEFLOW-009` — reabrir.** ADMIN. Flujo inexistente → 404 `CASEFLOW_009_NOT_FOUND`; estado distinto de `CLOSED` → 409 `CASEFLOW_009_NOT_CLOSED`. Pone `statusItemId = REOPENED`, `lastReopenedAt = new Date()` e incrementa `reopenCount` en 1. **`closedAt` no se borra**: conserva el instante del último cierre y se sobrescribe en el siguiente. `REOPENED` es transitorio — la próxima llamada a `012` lo saca de ahí.

**`ESAVI-CASEFLOW-010` — pedir validación.** Flujo inexistente → 404 `CASEFLOW_010_NOT_FOUND`; ya en `PENDING_VALIDATION` → 409 `CASEFLOW_010_ALREADY_PENDING`; estado `CLOSED` → 409 `CASEFLOW_010_CASE_CLOSED`. Copia `statusItemId` en `previousStatusItemId` y pone `statusItemId = PENDING_VALIDATION`. Se puede pedir desde cualquier estado abierto.

**`ESAVI-CASEFLOW-011` — resolver validación.** Flujo inexistente → 404 `CASEFLOW_011_NOT_FOUND`; estado distinto de `PENDING_VALIDATION` → 409 `CASEFLOW_011_NOT_PENDING`. Restaura `statusItemId = previousStatusItemId` y deja `previousStatusItemId = null`. Si `previousStatusItemId` viniera en `NULL` → 500 `CASEFLOW_011_PREVIOUS_STATUS_MISSING`: es una inconsistencia de datos que `010` hace imposible, y fallar ruidosamente es preferible a inventar un estado.

**`ESAVI-CASEFLOW-005A` / `005B` — desactivar y reactivar el registro.** Se delegan en `setEntityActiveStatusService` con `where` **solo por la PK**, `notFoundCode: 'CASEFLOW_005A_NOT_FOUND'` / `'CASEFLOW_005B_NOT_FOUND'` y `alreadyInStateCode` calculado. El número se calcula con `const op = isActive ? '005B' : '005A'` y `appDetails.method` guarda solo el código. No tocan el ciclo de vida del expediente.

#### Contrato de update diferencial

**Este spec no tiene `004` y ninguna de sus escrituras pasa por `buildDifferentialUpdate`.** No es un olvido, y §11 obliga a razonarlo una por una:

| Operación | Por qué no es diferencial |
|---|---|
| `001` | Es un create. Los `001` nunca pasan por el helper. |
| `007`, `008`, `009`, `010`, `011`, `012` | Son **escrituras con intención propia**. Registran que alguien ejecutó una transición, y el valor que escriben —un instante, un estado— es siempre distinto del guardado por construcción. No hay ningún caso en que un usuario reenvíe la ficha leída y provoque una escritura vacía: el body de las seis o está vacío o contiene solo `stage`. |
| `005A`, `005B` | Activaciones. §11 las excluye explícitamente y se delegan en `setEntityActiveStatusService`. |

La razón de fondo del `004` ausente es la misma: **ningún campo de `caseWorkflow` lo escribe un humano**. Los ocho sellos de etapa los pone `012` o `007`, el estado lo mueven las transiciones, `reopenCount` es un contador y `openedAt` lo fija el sistema. Un `PUT` sobre esta tabla solo podría corromperla, y por eso el endpoint no existe en vez de existir con un `candidates` vacío.

**Efecto lateral sobre otras tablas: ninguno.** El flujo **lee** `classification`, `notification`, `investigation` y `finalClassification` para decidir si puede cerrar, y no escribe en ninguna. La propagación va en la dirección contraria: son ellas las que llaman a `012`. Ese sentido único es lo que impide que este spec pueda romper una entidad ya implementada con una escritura inesperada.

### 3.6 Claves i18n nuevas

Todas bajo el prefijo `caseWorkflow.`, en los **tres** archivos: `src/data/i18n/es.json`, `en.json` y `nl.json`. `tests/i18n/messages.test.ts` exige paridad exacta.

**Éxito:**

| Clave | Uso |
|---|---|
| `caseWorkflow.createdSuccess` | `001` — no llega a viajar en respuesta HTTP, pero se registra en log y auditoría |
| `caseWorkflow.listSuccess` | `002A` / `002B` |
| `caseWorkflow.getSuccess` | `003` / `006` |
| `caseWorkflow.stageCompletedSuccess` | `007` |
| `caseWorkflow.closedSuccess` | `008` |
| `caseWorkflow.reopenedSuccess` | `009` |
| `caseWorkflow.validationRequestedSuccess` | `010` |
| `caseWorkflow.validationResolvedSuccess` | `011` |
| `caseWorkflow.deletedSuccess` | `005A` — habla de «registro de flujo», nunca de «caso» |
| `caseWorkflow.activatedSuccess` | `005B` — íd. |

**Conflicto y ausencia:**

| Clave | Uso |
|---|---|
| `caseWorkflow.notFound` | 404 en `003`, `006`, `007`–`012` y en `005A`/`005B` |
| `caseWorkflow.caseNotFound` | 404 en `006` cuando el caso no existe |
| `caseWorkflow.workflowExists` | 409 en `001` |
| `caseWorkflow.statusNotFound` | 500 en `001`, 404 en `002` con `statusCode` inexistente |
| `caseWorkflow.alreadyActive` / `caseWorkflow.alreadyInactive` | 409 en `005B` / `005A` |
| `caseWorkflow.caseClosed` | 409 en `007`, `010` y `012` |
| `caseWorkflow.alreadyClosed` | 409 en `008` |
| `caseWorkflow.notClosed` | 409 en `009` |
| `caseWorkflow.pendingValidation` | 409 en `008` |
| `caseWorkflow.alreadyPending` | 409 en `010` |
| `caseWorkflow.notPending` | 409 en `011` |
| `caseWorkflow.previousStatusMissing` | 500 en `011` |
| `caseWorkflow.stageNotStarted` | 409 en `007`, con `{{stage}}` interpolado |
| `caseWorkflow.stageAlreadyCompleted` | 409 en `007`, con `{{stage}}` interpolado |
| `caseWorkflow.classificationRequired` | 409 en `008` |
| `caseWorkflow.notificationRequired` | 409 en `008` |
| `caseWorkflow.investigationRequired` | 409 en `008` |
| `caseWorkflow.finalClassificationRequired` | 409 en `008` |

**Fallo genérico** (los del `catch` del controlador): `caseWorkflow.createdFailed`, `listFailed`, `getFailed`, `stageCompletedFailed`, `closedFailed`, `reopenedFailed`, `validationRequestedFailed`, `validationResolvedFailed`, `deletedFailed`, `activatedFailed`.

Las cuatro claves de precondición de `008` son distintas y no una sola parametrizada: el frontend necesita saber **qué** etapa falta para llevar al usuario a la pantalla correcta, y un `{{stage}}` interpolado obliga a parsear el mensaje.

### 3.7 Forma de la respuesta

`003` y `006` devuelven la ficha completa. Los ocho sellos de columna se **agrupan** en `stages`: sueltos son ocho campos que el cliente tiene que emparejar a mano.

```
{ ok, message, data: {
    caseWorkflowId, caseId,
    status:         { catalogItemId, code, name },
    previousStatus: { catalogItemId, code, name } | null,
    openedAt, closedAt, lastReopenedAt, reopenCount,
    stages: {
        classification:      { exists, id, startedAt, endedAt, durationMinutes },
        notification:        { exists, id, startedAt, endedAt, durationMinutes },
        investigation:       { exists, id, startedAt, endedAt, durationMinutes },
        finalClassification: { exists, id, startedAt, endedAt, durationMinutes }
    },
    totalDurationMinutes,
    isActive, createdAt, updatedAt, deletedAt, appDetails
} }
```

- **`exists` e `id`** resuelven la fila real de cada etapa: `id` es el PK del satélite (`classificationId`, `notificationId`, `investigationId`, `finalClassificationId`) o `null` cuando la etapa no se ha iniciado, y `exists` es `id !== null`. Se explica en detalle abajo.
- **`durationMinutes`** = `endedAt − startedAt` en minutos enteros. **`null`** si falta cualquiera de los dos sellos. No se guarda en ninguna columna: se calcula al construir la respuesta.
- **`totalDurationMinutes`** = `closedAt − openedAt`. **`null`** mientras el caso siga abierto. El tiempo transcurrido de un caso vivo lo calcula el cliente contra su propio reloj; el servidor no devuelve un valor que cambia entre dos llamadas idénticas.
- **`status` y `previousStatus`** viajan como objeto con `code` y `name`, no como UUID suelto. El `name` sale del `catalogItem` y ya está en el idioma del catálogo; **no** pasa por `getMessage`.
- **`sysDetails` no se expone**, en ninguna operación.

#### `exists` e `id` — por qué el flujo resuelve las filas de las etapas

Sin estos dos campos, un cliente que retoma un expediente a medio capturar **no sabe si debe crear o actualizar cada etapa**, y solo le quedan dos caminos, los dos malos: recordar los PK en su propio estado —que se pierde al recargar y falla en cuanto dos personas trabajan el mismo caso—, o encadenar cuatro `GET /case/:caseId`, uno por satélite, cada vez que abre la pantalla. Este spec ya hace la consulta por `caseId` para saber en qué etapa está el expediente; devolver además el PK que ya tuvo a la vista convierte cuatro llamadas en una y elimina la adivinación del lado del cliente.

La regla que habilita, y que el frontend aplica sin heurística: **`exists: false` → `POST` de la etapa; `exists: true` → `PUT /:id` sobre el `id` devuelto.**

Reglas de resolución:

- Un `findOne` por satélite filtrando `caseId` y `deletedAt IS NULL`, seleccionando **solo el PK**. La relación es 1:1 por el `UNIQUE ("caseId")` de cada tabla (`UQ_classification_case`, `UQ_notification_case`, `UQ_investigation_case`, `UQ_finalClassification_case`), así que no hay ambigüedad posible y cada consulta usa su índice.
- **Las cuatro consultas van en el mismo `Promise.all`** que la carga del flujo, no en serie.
- **Una etapa desactivada (`isActive: false`) cuenta como existente**, con su `id`. La fila está ahí y un `POST` chocaría contra el `UNIQUE`; lo que el cliente necesita en ese caso es reactivarla con su `005B`, no crearla de nuevo. Solo el borrado físico —que estas tablas no permiten— haría desaparecer el `id`.
- **`exists` e `id` son independientes de los sellos.** Un `startedAt` sellado con `id: null` significa que la fila se creó y luego se purgó; un `id` presente sin `startedAt` significa una fila anterior a este spec. Ninguno de los dos es normal, y separarlos hace que el síntoma se vea en vez de esconderse detrás de un solo booleano.
- **No se incluye el contenido de la etapa, solo su identidad.** Quien quiere los datos llama al `GET /case/:caseId` del satélite, que ya existe. Este bloque responde «¿existe y con qué `id`?», no «¿qué dice?»; embutir cuatro fichas completas aquí convertiría el `006` en un endpoint de agregación que ninguna otra pantalla necesita.
- **Los mismos cuatro campos viajan en `002A`/`002B`.** Es una consulta por fila del listado; se resuelve con un `include` de los cuatro satélites limitado al PK, no con un `findOne` por fila.

`002A` y `002B` devuelven `data: { count, rows }` de `findAndCountAll`, con cada fila en el mismo formato de arriba. `002A` filtra `isActive: true`; `002B` incluye las inactivas.

`007`, `008`, `009`, `010` y `011` devuelven **la ficha completa actualizada** en `data`, con el mismo formato. Es deliberado y no contradice §10: la regla de que una operación de estado no devuelve `data` cubre `005A`, `005B` y `005C`, cuyo efecto es retirar la fila de la vista. Aquí el efecto es moverla a un estado nuevo que el cliente necesita pintar de inmediato, y obligarle a un `006` de seguimiento sería una llamada de más por transición.

`005A` y `005B` responden **solo** `{ ok, message }`, sin `data`, como manda §10.

`001` no tiene respuesta HTTP: devuelve la instancia de Sequelize a `createEsaviCaseService`, que la usa dentro de su transacción.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Esquema.** Añadir `CREATE TABLE "caseWorkflow"` a `esaviapp.sql` después del bloque `CREATE TABLE "finalClassification"` (`esaviapp.sql:1286` antes de F43), con sus tres FK, `UQ_caseWorkflow_case`, el `CHECK` de `reopenCount` y los dos índices. Añadir `'caseWorkflow'` al array del bucle `preventPhysicalDelete` (`esaviapp.sql:1372-1386` antes de F43; localizarlo por el `FOREACH t IN ARRAY`, no por la línea, porque F43 ya lo habrá desplazado). Añadir las ocho `CALL "upsertCatalogItem"('caseWorkflowStatus', …)` al bloque de siembra.
   *Verificación:* cargar `esaviapp.sql` sobre una base limpia termina en 0; `appPasswordReset` sigue existiendo tras la recarga y su trigger `TRG_appPasswordReset_preventPhysicalDelete` sigue **sin** existir —el alta de `caseWorkflow` en el array no debe arrastrar la tabla de F43—; `SELECT tgname FROM pg_trigger WHERE tgrelid = '"caseWorkflow"'::regclass` devuelve los tres triggers; `SELECT count(*) FROM "catalogItem" ci JOIN "catalogType" ct USING("catalogTypeId") WHERE ct.code = 'caseWorkflowStatus'` devuelve 8; un `DELETE` directo sobre `caseWorkflow` es rechazado.

2. **Modelo y asociaciones.** `src/models/caseWorkflow.model.ts` con `timestamps: false`, `freezeTableName: true` y PK `gen_random_uuid()`. `src/models/associations/caseWorkflow.associations.ts` con las cuatro asociaciones de §3.2, registrado en `initAssociations()`. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `CaseWorkflow.findAll({ include: ['case', 'status', 'previousStatus'] })` desde un script suelto no lanza `EagerLoadingError`.

3. **Tipos.** `src/types/caseWorkflow/caseWorkflow.types.ts` con los cinco de §3.3, más `index.ts` de barrel y alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -n "UpdateCaseWorkflowInput" src/` no devuelve resultados.

4. **Claves i18n.** Las 38 claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

5. **Convenciones.** Alta de `CASEFLOW` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y de las siete operaciones no canónicas (`006`–`012`) en la tabla de operaciones no canónicas de la misma sección, cada una con su descripción de una línea. Marcar `012` y `001` como *«sin ruta HTTP»*, igual que `appSession-006`/`007`.
   *Verificación:* las siete filas existen y ninguna abreviatura aparece dos veces en la tabla.

6. **`ESAVI-CASEFLOW-001` — crear el flujo.** `createCaseWorkflowService(data, authUser, lang, transaction)` en `src/services/caseWorkflow.service.ts`. Resuelve el `catalogItem` `OPEN`, escribe `openedAt` y `reopenCount = 0`, añade la entrada de auditoría. Sin ruta, sin controlador.
   *Verificación:* invocado dos veces sobre el mismo `caseId` lanza `AppError` 409 con `CASEFLOW_001_WORKFLOW_EXISTS`; con el catálogo sin sembrar lanza 500 `CASEFLOW_001_STATUS_NOT_FOUND`.

7. **Integración con `createEsaviCaseService` (SPEC F06).** Envolver el servicio en una transacción propia —hoy es escritura única y no la tiene— y llamar a `createCaseWorkflowService` dentro, pasándole la misma transacción. Un fallo al crear el flujo revierte el caso.
   *Verificación:* `POST /api/esavi-cases` devuelve 201 y `GET /api/case-workflows/case/:caseId` devuelve el flujo en `OPEN`; forzando un fallo en el servicio de flujo, el caso **no** queda en la base.

8. **`ESAVI-CASEFLOW-012` — avanzar de etapa.** `advanceCaseWorkflowStageService(caseId, stage, authUser, lang, transaction)` con los cuatro pasos de §3.5: localizar, rechazar si `CLOSED`, sellar el inicio de forma idempotente, auto-sellar el fin de la anterior. Estado a la etapa, salvo en `PENDING_VALIDATION`, donde mueve `previousStatusItemId`. Sin ruta.
   *Verificación:* llamarlo dos veces con `NOTIFICATION` deja `notificationStartedAt` con el instante de la primera; llamarlo con `NOTIFICATION` sobre un flujo con `classificationStartedAt` y sin `classificationEndedAt` sella los dos con el mismo valor; sobre un flujo `CLOSED` lanza 409 `CASEFLOW_012_CASE_CLOSED`; sobre uno en `PENDING_VALIDATION` el `statusItemId` no cambia y `previousStatusItemId` sí.

9. **Integración con los cuatro servicios de etapa (F09, F10, F28, F41).** `createClassificationService`, `createNotificationService`, `createInvestigationService` y `createFinalClassificationService` pasan a transaccionales e invocan `advanceCaseWorkflowStageService` con su etapa dentro de la misma transacción.
   *Verificación:* crear una notificación mueve el flujo a `IN_NOTIFICATION` y sella `notificationStartedAt`; crear una etapa sobre un caso cerrado devuelve 409 y **no** crea la fila de la etapa; las suites de contrato de las cuatro entidades siguen en verde.

10. **`ESAVI-CASEFLOW-002A` / `002B` — listados.** Servicios, controlador que bifurca con `canViewInactive(req.user)`, validador de `limit`/`offset` y de los cuatro filtros, archivo de rutas `src/routes/caseWorkflow.routes.ts` y alta en `src/routes/index.ts`. `GET /admin` declarado antes que cualquier `/:id`.
    *Verificación:* `GET /api/case-workflows?statusCode=IN_NOTIFICATION` filtra; un `statusCode` inexistente devuelve 404; `GET /admin` con rol USER devuelve 403; `limit=abc` devuelve 400.

11. **`ESAVI-CASEFLOW-003` — obtener por ID.** `GET /:id` declarado **después** de todas las literales y del prefijo `/case/`.
    *Verificación:* un ID inexistente devuelve 404; una fila inactiva devuelve 404 para USER y 200 para ADMIN; `GET /api/case-workflows/admin` sigue resolviendo al listado y no al `003`.

12. **`ESAVI-CASEFLOW-006` — el flujo de un caso.** `GET /case/:caseId`, con los dos 404 distinguidos de §3.5 y el bloque `stages` de §3.7 completo, incluidos `exists` e `id` por etapa resueltos en el mismo `Promise.all`.
    *Verificación:* un `caseId` inexistente devuelve 404 con `CASEFLOW_006_CASE_NOT_FOUND`; un caso creado antes de este spec devuelve 404 con `CASEFLOW_006_NOT_FOUND`; un caso recién creado devuelve las cuatro etapas con `exists: false` e `id: null`; tras un `POST /api/classifications` la etapa `classification` devuelve `exists: true` con el `classificationId` real, y un `PUT` sobre ese `id` responde 200; desactivar la clasificación con su `005A` **no** cambia `exists` ni `id`.

13. **`ESAVI-CASEFLOW-007` — cerrar etapa.** `PATCH /case/:caseId/complete-stage` con `body('stage').isIn([...])`. Sella `endedAt` y no toca el estado.
    *Verificación:* `{ "stage": "FOO" }` devuelve 400; cerrar una etapa sin iniciar devuelve 409 `STAGE_NOT_STARTED`; cerrarla dos veces devuelve 409 `STAGE_ALREADY_COMPLETED`; tras cerrarla, `statusItemId` es el mismo que antes.

14. **`ESAVI-CASEFLOW-008` — cerrar el caso.** Las cuatro precondiciones de la tabla de §3.5, más los dos 409 de estado.
    *Verificación:* las cuatro combinaciones de `isSeriousEvent` × `requestInvestigation` responden lo que dice la tabla; cerrar sin clasificación devuelve 409 `CLASSIFICATION_REQUIRED`; cerrar desde `PENDING_VALIDATION` devuelve 409 `PENDING_VALIDATION`; al cerrar, la última etapa abierta queda con `endedAt` sellado y `totalDurationMinutes` deja de ser `null`.

15. **`ESAVI-CASEFLOW-009` — reabrir.** ADMIN. Incrementa `reopenCount`, sella `lastReopenedAt`, deja `closedAt` intacto.
    *Verificación:* reabrir un caso no cerrado devuelve 409 `NOT_CLOSED`; con rol USER devuelve 403; tras cerrar-reabrir-cerrar-reabrir, `reopenCount` vale 2 y `closedAt` es el del segundo cierre.

16. **`ESAVI-CASEFLOW-010` y `011` — validación.** Los dos endpoints, con `previousStatusItemId` como único mecanismo de retorno.
    *Verificación:* pedir validación desde `IN_INVESTIGATION` y resolverla devuelve el caso a `IN_INVESTIGATION` con `previousStatus` en `null`; resolver sin estar pendiente devuelve 409 `NOT_PENDING`; pedirla dos veces devuelve 409 `ALREADY_PENDING`.

17. **`ESAVI-CASEFLOW-005A` / `005B`.** Delegados en `setEntityActiveStatusService`, con el `op` calculado y `where` solo por la PK.
    *Verificación:* desactivar dos veces devuelve 409 `ALREADY_INACTIVE`; las dos respuestas son `{ ok, message }` sin `data`; `appDetails.method` guarda `ESAVI-CASEFLOW-005A` sin sufijos añadidos.

18. **`ROUTE_RULES`.** Una fila por cada una de las diez rutas HTTP en `tests/auth/roles.test.ts`, con su rol mínimo y su código de operación.
    *Verificación:* `npm test -- roles` en verde; ninguna ruta del router queda sin fila.

19. **Suite de contrato.** `tests/contract/caseWorkflow.test.ts`, siguiendo `tests/contract/healthFacility.test.ts` como referencia. Recorrido completo: crear caso → clasificar → notificar → investigar → clasificar final → cerrar → reabrir, comprobando el estado y los sellos en cada salto.
    *Verificación:* `npm run check` sale en 0.

---

## 5. Criterios de aceptación

**Esquema y catálogo**

- [ ] `esaviapp.sql` carga sobre una base limpia terminando en 0, con la tabla `caseWorkflow` creada.
- [ ] `SELECT count(*) FROM pg_trigger WHERE tgrelid = '"caseWorkflow"'::regclass` devuelve 3: `setUpdatedAt`, `setSysDetails` y `preventPhysicalDelete`.
- [ ] Un `DELETE FROM "caseWorkflow"` directo por SQL es rechazado por el trigger.
- [ ] El `catalogType` `caseWorkflowStatus` tiene exactamente 8 `catalogItem`, con los `code` de §3.1 en `CONSTANT_CASE`.
- [ ] Recargar `esaviapp.sql` dos veces seguidas no duplica ítems del catálogo — `upsertCatalogItem` es idempotente.
- [ ] La tabla `appPasswordReset` del SPEC F43 sigue creándose y **sigue sin** trigger `preventPhysicalDelete`: añadir `'caseWorkflow'` al array no arrastró la tabla de F43 ni alteró su bloque del archivo.

**Invariante del flujo**

- [ ] `POST /api/esavi-cases` deja el caso con su fila de flujo en `OPEN` y `openedAt` sellado, en la misma transacción.
- [ ] Forzando un fallo en `createCaseWorkflowService`, el `esaviCase` no queda en la base.
- [ ] `SELECT count(*) FROM "esaviCase" c LEFT JOIN "caseWorkflow" w USING("caseId") WHERE w."caseWorkflowId" IS NULL` devuelve 0 para todo caso creado después de este spec.

**Estados y sellos**

- [ ] Crear la clasificación mueve el estado a `IN_CLASSIFICATION`; la notificación, a `IN_NOTIFICATION`; la investigación, a `IN_INVESTIGATION`; la clasificación final, a `IN_FINAL_CLASSIFICATION`.
- [ ] Crear la notificación con `classificationEndedAt` en `NULL` lo sella con **el mismo instante** que `notificationStartedAt`.
- [ ] Invocar `advanceCaseWorkflowStageService` dos veces con la misma etapa deja `startedAt` con el valor de la primera llamada.
- [ ] Crear cualquiera de las cuatro etapas sobre un caso `CLOSED` devuelve **409** `CASEFLOW_012_CASE_CLOSED` y **no** crea la fila de la etapa.
- [ ] `007` sella `endedAt` y deja `statusItemId` sin tocar.
- [ ] `durationMinutes` de una etapa con los dos sellos es un entero; con uno solo es `null`.
- [ ] `totalDurationMinutes` es `null` mientras el caso no esté cerrado.

**Cierre, reapertura y validación**

- [ ] Las cuatro combinaciones de `classification.isSeriousEvent` × `notification.requestInvestigation` responden exactamente lo que dice la tabla de §3.5.
- [ ] Cerrar sin clasificación devuelve 409 `CASEFLOW_008_CLASSIFICATION_REQUIRED`; sin notificación, `..._NOTIFICATION_REQUIRED`.
- [ ] Cerrar desde `PENDING_VALIDATION` devuelve 409 `CASEFLOW_008_PENDING_VALIDATION`.
- [ ] Al cerrar, la última etapa abierta queda con `endedAt` sellado.
- [ ] `009` con rol USER devuelve 403; con ADMIN, 200.
- [ ] Tras cerrar → reabrir → cerrar → reabrir, `reopenCount` vale 2 y `closedAt` conserva el instante del **segundo** cierre.
- [ ] Pedir validación desde `IN_INVESTIGATION` y resolverla devuelve el caso a `IN_INVESTIGATION`, con `previousStatus` en `null`.
- [ ] Avanzar de etapa estando en `PENDING_VALIDATION` no cambia `statusItemId`, y `011` devuelve el caso al estado de la etapa nueva.

**Contrato y códigos**

- [ ] Las diez rutas de §3.4 responden con su status esperado y su rol mínimo.
- [ ] `GET /api/case-workflows/admin` resuelve al `002B` y no al `003`; `GET /api/case-workflows/case/:caseId` resuelve al `006`.
- [ ] Los cinco puntos de cada código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden.
- [ ] `005A` y `005B` responden `{ ok, message }` **sin** clave `data`.
- [ ] `007`–`011` responden con la ficha completa en `data`, incluyendo `stages` y `status`.
- [ ] Las cuatro entradas de `stages` traen `exists` e `id` en `003`, `006`, `002A`, `002B` y `007`–`011`, y `exists === (id !== null)` en todas.
- [ ] Un expediente completo devuelve los cuatro `id` y coinciden con los PK que devolvieron los cuatro `POST`.
- [ ] `002A`/`002B` resuelven los `id` con un `include` limitado al PK: el número de consultas **no** crece con el de filas de la página.
- [ ] `sysDetails` no aparece en ninguna respuesta.
- [ ] Las 38 claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.

**Update diferencial**

Este spec **no tiene `004`**, y por eso los cinco criterios canónicos de la plantilla —los que reenvían la respuesta de un `GET` en un `PUT`— no aplican: no hay `PUT` al que reenviarla. Lo que sí se verifica es que esa ausencia sea real y que ninguna escritura la esquive por otra vía:

- [ ] `PUT /api/case-workflows/:id` devuelve **404** de Express: la ruta no existe.
- [ ] `grep -n "buildDifferentialUpdate" src/services/caseWorkflow.service.ts` no devuelve resultados, y §3.5 razona por qué para cada una de las nueve escrituras.
- [ ] `grep -rn "UpdateCaseWorkflowInput\|Partial<CreateCaseWorkflowInput>" src/` no devuelve resultados.
- [ ] Ninguna de las nueve escrituras acepta del cliente un sello temporal, un `statusItemId` o un `reopenCount`: el único campo que viaja en un body es `stage` en `007`.
- [ ] Los cambios en los cinco servicios ya implementados (`esaviCase`, `classification`, `notification`, `investigation`, `finalClassification`) **no** tocan sus bloques de `buildDifferentialUpdate`: solo añaden la transacción y la llamada a `012`.
- [ ] Un `PUT` sobre cualquiera de esas cinco entidades que reenvía íntegra la respuesta de su `GET` sigue respondiendo **200** sin escribir nada, y **sin** mover el flujo del caso.

**Cierre**

- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el esquema**

- **Sí:** tabla nueva en `esaviapp.sql`, la 47ª. Ampliar el DDL se asume conscientemente y ya no estrena el camino: el SPEC F43 lo abrió antes con `appPasswordReset`. Ninguna de las 46 tablas existentes guarda estado de expediente, y no hay forma de añadirlo sin tocar el esquema.
- **No:** columnas de ciclo de vida sobre `esaviCase`. Cargaría una entidad ya implementada con un concepto que no es suyo y obligaría a reabrir el SPEC F06 entero, en vez de añadirle una línea.
- **No:** derivar el flujo en tiempo de consulta desde los `EXISTS` de las cuatro etapas, sin tabla. Cuesta cero en esquema y no permite cerrar ni reabrir: un cierre es una decisión que alguien toma, no algo deducible de qué filas existen.
- **Sí:** `caseWorkflow` entra en `preventPhysicalDelete`, y por tanto **no** hay `005C`. Es el rastro del ciclo de vida de un expediente de farmacovigilancia; su padre `esaviCase` ya está protegido y la hija no debería estarlo menos.
- **No:** trigger de validación de catálogo sobre `statusItemId`. `investigation.statusItemId` es el precedente exacto y no lo tiene; la validación va en el servicio.
- **Sí:** `appDetails` con `DEFAULT '{}'::jsonb`, igual que las 46 tablas existentes, aunque el valor correcto para un array sea `'[]'`. Los servicios siempre insertan el array completo, así que el `DEFAULT` no llega a aplicarse. Corregirlo en 47 tablas es otro spec.

**Sobre la forma de los datos**

- **Sí:** una fila por caso que muta. Responde *«¿en qué estado está el caso 123?»* en un `findOne`, y el historial ya lo conservan `appDetails` y `sysDetails.auditTrail`, que son append-only por trigger.
- **No:** una tabla de eventos `caseWorkflowEvent` (1:N) en este spec. Es lo correcto a largo plazo y es un spec propio: mezclar cabecera y log aquí produciría un documento que nadie ejecuta.
- **Sí:** `exists` e `id` de las cuatro etapas dentro de `stages`. Es lo que permite a un cliente retomar un expediente parcial sin adivinar: `exists: false` → `POST`, `exists: true` → `PUT /:id`. La alternativa —cuatro `GET /case/:caseId` a los satélites en cada apertura de pantalla— hace cuatro veces el trabajo que este endpoint ya está haciendo para saber en qué etapa está el caso.
- **No:** devolver la ficha completa de cada etapa dentro de `stages`. Convertiría el `006` en un endpoint de agregación cuyo `data` crece con cada campo que ganen las cuatro entidades, y ninguna pantalla necesita las cuatro fichas a la vez. Aquí va la identidad de la fila; el contenido lo sirve el `GET /case/:caseId` de cada satélite, que ya existe.
- **Sí:** una etapa desactivada cuenta como existente y conserva su `id`. Su fila sigue ahí y el `UNIQUE ("caseId")` rechazaría un `POST`; lo que corresponde es reactivarla con su `005B`, y para eso el cliente necesita el `id`.
- **Sí:** sellos de inicio **y** de fin por etapa. Con solo el inicio, la duración de una etapa sería la distancia hasta el inicio de la siguiente, que confunde «trabajar en la etapa» con «esperar a la siguiente».
- **No:** guardar `durationMinutes` en columna. Es un derivado puro de dos sellos de la misma fila; almacenarlo obliga a mantenerlo sincronizado sin ganar ninguna consulta.
- **No:** `totalDurationMinutes` calculado contra el reloj actual mientras el caso sigue abierto. Haría que dos llamadas idénticas devolvieran valores distintos. El transcurrido de un caso vivo lo calcula el cliente.

**Sobre los estados**

- **Sí:** los ocho estados como `catalogItem` bajo el `catalogType` `caseWorkflowStatus`. Es el patrón del repositorio —`userStatus`, `investigationStatus`— y añadir un estado no exige migración.
- **No:** `CREATE TYPE ... AS ENUM`. Más estricto en base, pero cada estado nuevo sería un `ALTER TYPE` sobre una tabla en producción.
- **Sí:** `IN_CLASSIFICATION` como octavo estado. Sin él, *«¿cuántos casos están sin clasificar?»* deja de ser una consulta por estado y `OPEN` acaba significando dos cosas.
- **Sí:** `REOPENED` transitorio, con `reopenCount` y `lastReopenedAt` como rastro persistente. Si `REOPENED` durara hasta el siguiente cierre, un caso reabierto y en investigación aparecería como `REOPENED` y se perdería su avance real.
- **Sí:** `PENDING_VALIDATION` reversible mediante `previousStatusItemId`, con `010` para entrar y `011` para salir. Dos hechos distintos, dos códigos de operación, dos entradas de auditoría.
- **No:** `010` como interruptor que entra y sale según el estado. Un endpoint menos, a cambio de que el código de operación deje de decir qué se intentó — que es exactamente para lo que sirve.
- **No:** que `PENDING_VALIDATION` se resuelva solo al avanzar de etapa. Un caso que necesita revisión seguiría avanzando sin que nadie la hiciera, y el estado no serviría para nada.

**Sobre quién escribe qué**

- **Sí:** híbrido — el **inicio** de cada etapa lo propaga automáticamente el servicio que crea la etapa; el **fin** lo marca el usuario con `007`. El inicio es un hecho observable; el fin es un juicio.
- **No:** un endpoint explícito también para el inicio. El flujo se desincronizaría en cuanto alguien creara una notificación sin llamarlo, y la invariante dejaría de sostenerse sola.
- **Sí:** auto-sellado del fin de la etapa anterior con el mismo instante en que arranca la siguiente. Ningún sello queda huérfano y toda duración es calculable, incluso si el usuario nunca ejecuta `007`.
- **No:** bloquear la creación de una etapa porque la anterior no esté cerrada. Convertiría este spec en un guardián capaz de romper los flujos de F09, F10, F28 y F41 por un `endedAt` que alguien olvidó marcar.
- **Sí:** 409 al crear una etapa sobre un caso `CLOSED`. Es coherente con el propósito de la reapertura: modificar los datos de un caso terminado exige reabrirlo primero. **La restricción es deliberadamente barata de revertir** — vive en una sola comprobación de `012`, sin respaldo en el esquema.

**Sobre el contrato**

- **Sí:** las transiciones cuelgan de `/case/:caseId`, no de `/:id`. El cliente que ejecuta una transición conoce el caso, no el UUID del flujo.
- **Sí:** sin `004`. Ningún campo de la tabla lo escribe un humano: los sellos los pone el sistema, el estado lo mueven las transiciones y `reopenCount` es un contador. Un `PUT` solo podría corromperla.
- **Sí:** `007`–`011` devuelven la ficha completa en `data`. La regla de §10 que prohíbe `data` cubre las operaciones que **retiran** la fila de la vista; éstas la mueven a un estado que el cliente necesita pintar de inmediato.
- **Sí:** `classification.isSeriousEvent` como fuente de la gravedad. Es donde el usuario la declara, en el paso del proceso donde la decide.
- **No:** `notification.notificationType` como fuente, pese a ser `NOT NULL`. Se declara un paso más tarde, y hacer depender el cierre de un dato posterior al que lo origina invierte el flujo.
- **No:** backfill de los casos anteriores a este spec. Es un script con su propio riesgo —inventar sellos que nadie registró— y merece su propio spec.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Los casos creados antes de este spec no tienen fila de flujo: su `006` devuelve 404 y crear una etapa sobre ellos falla con `CASEFLOW_012_NOT_FOUND` | El 404 lleva código propio, distinto del de «caso inexistente», para que el síntoma sea diagnosticable. El backfill queda declarado fuera de alcance y con spec propio |
| `classification.isSeriousEvent` y `notification.notificationType` pueden contradecirse: el esquema no obliga a que coincidan, y `isSeriousEvent` además es nullable | El cierre usa solo `isSeriousEvent`, y un `NULL` se trata como «no grave». La unificación de ambas declaraciones queda fuera de alcance y anotada como corrección sobre F09 y F10 |
| Cinco servicios ya implementados pasan a ser transaccionales y multi-escritura; un fallo en el flujo revierte ahora la creación de la etapa | Es el comportamiento buscado, y las suites de contrato de las cinco entidades son criterio de aceptación del paso 9 |
| `GET /:id` captura `admin` o `case` como UUID | Las literales y el prefijo `/case/` se declaran antes de `/:id`; cubierto por criterio de aceptación explícito |
| La regla «un caso cerrado no admite etapas nuevas» puede resultar demasiado estricta en operación real | Vive en una sola comprobación de `012`, sin respaldo en el esquema. Retirarla no requiere migración ni cambio de contrato, y así queda escrito en §3.5 y §6 |
| Dos campos de nombre casi idéntico: `caseWorkflow.investigationStartedAt` (instante del expediente) e `investigation.investigationStartDate` (fecha clínica) | Documentado en §3.1 y en el comentario del modelo. Están en tablas distintas y no se solapan en ninguna respuesta |
| El catálogo `caseWorkflowStatus` sin sembrar deja el `001` fallando en cada alta de caso, y por tanto impide crear casos | El `001` responde 500 con código propio `CASEFLOW_001_STATUS_NOT_FOUND`, y el paso 1 del plan verifica los ocho ítems antes de tocar `src/` |

---

## 8. Impacto en el contrato HTTP

Este spec **cambia respuestas que los clientes ya reciben hoy**, en cinco entidades ya implementadas:

| Endpoint | Antes | Después |
|---|---|---|
| `POST /api/classifications` | 201 siempre que el body fuera válido | **409** `CASEFLOW_012_CASE_CLOSED` si el caso está cerrado |
| `POST /api/notifications` | íd. | íd. |
| `POST /api/investigations` | íd. | íd. |
| `POST /api/final-classifications` | íd. | íd. |
| `POST /api/esavi-cases` | 201, escritura única | 201, ahora dentro de una transacción: si el flujo no se puede crear, **no se crea el caso** |

Las cuatro primeras filas son superficie de error nueva: un cliente que hoy asume que un `POST` válido siempre crea la fila tiene que contemplar el 409. El `data` de las cinco respuestas **no cambia**: ninguna de las cinco entidades gana ni pierde campos.

Ningún endpoint existente cambia de status en el camino feliz, ni cambia la forma de su `data`, ni deja de existir.

---

## Lo que **no** está en este spec

- La tabla de eventos `caseWorkflowEvent` con el historial consultable de transiciones.
- Plazos, vencimientos, alertas o cualquier indicador de cumplimiento sobre los sellos.
- El backfill de los casos creados antes de este spec.
- Unificar `classification.isSeriousEvent` con `notification.notificationType`.
- Un `004` de update y las notas por etapa.
- `005C` borrado físico.
- La cascada de desactivación desde `esaviCase` a sus satélites.
- Reportes, exportación o agregación de duraciones.
- Notificaciones, correos o webhooks al cambiar de estado.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
