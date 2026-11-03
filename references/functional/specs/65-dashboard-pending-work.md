# SPEC F65 — Dashboard: marco común y trabajo pendiente

> **Estado:** Implementado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), **SPEC F26** (`systemConfig`), **SPEC F44** (`caseWorkflow`), **SPEC F48** (filtros del listado de casos), **SPEC F49** (alcance geográfico), **SPEC F64** (roles por etapa)
> **Fecha:** 2026-11-02
> **Objetivo:** Dar al home un endpoint que diga, dentro del territorio del usuario, cuántos casos hay en cada estado, cuáles llevan demasiado tiempo detenidos y qué investigaciones solicitadas siguen sin iniciar.

---

## 1. Por qué existe este spec

**El home no tiene de dónde leer.** Ninguna ruta de `/api` devuelve agregados. Para saber cuántos casos hay en investigación, el frontend tendría que paginar `GET /api/esavi-cases` completo y pedir el `caseWorkflow` de cada caso por separado (`ESAVI-CASEFLOW-006`). Son N+1 llamadas por cada carga del home, con un coste que crece con el histórico.

**Los datos para responder ya existen y están normalizados.** `caseWorkflow` (`esaviapp.sql`) guarda el estado actual en `statusItemId`, contra el catálogo `caseWorkflowStatus` y sus ocho estados (`caseWorkflow.service.ts:32-41`). También sella el inicio y el fin de cada una de las cuatro etapas, más `openedAt`, `closedAt`, `lastReopenedAt` y `reopenCount`. `notification.requestInvestigation` marca qué casos deben investigarse. Nada de esto requiere columnas nuevas: falta la consulta que lo agregue.

**Un agregado sin alcance territorial filtraría lo que el listado oculta.** El SPEC F49 limitó `ESAVI-CASE-002A` y `003` al territorio del usuario. Un contador nacional en el home le diría a un usuario de Loja cuántos casos graves hay en Esmeraldas, lo mismo que F49 §2 descartó expresamente («un contador de lo que no puedes ver es información sobre lo que no puedes ver»). Por eso el dashboard cuenta con el mismo `resolveUserGeoScopeIds` (`src/services/common/geoScope.service.ts:56`) y no con un criterio propio.

**Hoy nadie detecta un caso detenido.** El SPEC F44 sella cuándo empieza y termina cada etapa, pero ningún proceso compara esas fechas con la fecha actual. Un caso puede pasar meses en `IN_INVESTIGATION` sin que nadie lo vea, salvo quien lo abra a mano. El umbral que define «demasiado tiempo» es un parámetro operativo y debe poder cambiarse sin desplegar, así que vive en `systemConfig` (SPEC F26).

**Una cifra del embudo tiene que llevar a sus casos.** El listado de casos filtra por fechas y geografía (SPEC F48), pero no por estado del workflow. Sin ese filtro, el «12 en investigación» del home no se puede pulsar para ver cuáles son. Por eso este spec amplía `ESAVI-CASE-002A` y `002B` con `?statusCode=`.

**F65 fija el marco que heredan F66 a F69.** Se encarga de la abreviatura `DASH`, la ruta base `/api/dashboard`, la regla de alcance y la regla de que el payload no varía según el rol. Los specs de KPIs, series, alerta por lote y actividad solo añaden operaciones sobre ese marco.

---

## 2. Alcance

**Dentro:**

- **Marco común del dominio dashboard**, que heredan los SPEC F66 a F69:
  - Abreviatura `DASH`, registrada en `references/CONVENTIONS.md` §6.
  - Ruta base `/api/dashboard`, con su archivo de rutas, controlador, servicio, validador y tipos. No hay modelo ni asociaciones, porque el dominio no tiene tabla propia.
  - Numeración desde `006`. El rango `001`–`005B` no se usa porque no hay CRUD.
  - **Regla de alcance:** toda operación del dominio cuenta solo los casos dentro de `resolveUserGeoScopeIds(authUser)`. ADMIN y SUPERADMIN ven el país. Un usuario sin asignaciones ve 0.
  - **Regla de payload uniforme:** la respuesta no varía según el rol de etapa (`NOTIFIER`, `INVESTIGATOR`, `EVALUATOR`). Solo la acota el territorio.
- **`ESAVI-DASH-006` — trabajo pendiente.** `GET /api/dashboard/pending-work`, rol mínimo `USER`. Devuelve:
  - **Embudo:** número de casos en cada uno de los ocho estados de `caseWorkflowStatus`. Los ocho vienen siempre, aunque sea con 0.
  - **Estancados:** total y top 10 de los más antiguos, con `caseId`, `caseCode`, estado, etapa abierta y días detenido.
  - **Investigaciones pendientes:** total y top 10 de los más antiguos.
  - **Reabiertos:** número de casos no cerrados con `reopenCount > 0`.
- **Configuración `ESAVI_DASHBOARD_STALE_DAYS`:** scope `DASHBOARD`, `valueType: 'number'`, valor por defecto `15`. Se siembra en `src/data/systemConfig.defaults.ts` y la sincroniza `ESAVI-SYSCONF-008`.
- **Filtro `?statusCode=` en `ESAVI-CASE-002A` y `002B`.** Acepta uno de los ocho códigos de estado. Un código fuera de la lista responde 400.
- **Constantes del workflow en `src/constants/caseWorkflow.constants.ts`.** El catálogo `caseWorkflowStatus`, los ocho estados y las cuatro etapas salen de `caseWorkflow.service.ts:28-59`. Así los usan el workflow, el dashboard y el validador del listado sin importar un servicio desde otro.
- Claves i18n en `es`, `en` y `nl`, filas en `ROUTE_RULES` y la suite `tests/contract/dashboard.test.ts`.

**Nota para el frontend (contrato, no implementación):**

> El payload de `ESAVI-DASH-006` es **idéntico para todos los roles**. Solo lo acota el territorio del usuario. Decidir qué resaltar según el rol es responsabilidad de la interfaz. Por ejemplo, a un `INVESTIGATOR` se le destacan las investigaciones pendientes y a un `EVALUATOR` los casos en `IN_FINAL_CLASSIFICATION`. El rol efectivo se lee del perfil (`ESAVI-USER-007`). Ocultar un bloque **no es un control de acceso**: el dato ya viaja en la respuesta y es legítimo que el usuario lo vea.
>
> `stalled.staleDays = 0` (o cualquier valor menor que 1) significa que la detección de estancados está **desactivada**, no que no haya casos detenidos. La interfaz debe mostrarlo así.

Esta nota se repite en §8 para que el spec del frontend la cite.

**Fuera de alcance (otros specs, o descartado):**

- **KPIs de vigilancia con periodo** (`from`/`to`): casos del periodo, % de graves, defunciones, oportunidad de notificación, tiempo de cierre y causalidad. → **SPEC F66**.
- **Series y distribuciones:** curva semanal, vacunas sospechosas, sexo y edad, geografía, errores programáticos. → **SPEC F67**.
- **Alerta por lote** (`batchNumber`). → **SPEC F68**.
- **Actividad reciente y «mis casos»**, incluidos los casos creados por el propio usuario. Exige leer `appDetails` y es otra decisión técnica. → **SPEC F69**.
- **Parámetros de periodo en `006`.** Es una foto del momento actual. El validador de periodo compartido lo define el F66, que es su primer consumidor.
- **Un umbral de estancamiento por etapa.** Se eligió uno global (§6).
- **Notificar o enviar correo** cuando un caso se estanca. El dashboard solo informa, y avisar es un proceso programado distinto.
- **Caché, vistas materializadas o refresco programado.** §7 lo deja como riesgo con su condición de entrada.
- **Personalizar el payload por rol de etapa.** Se descartó (§6); la nota de arriba cubre el uso en el frontend.
- **Alcance territorial sobre las 22 entidades satélite del caso.** Sigue siendo el límite que declaró F49 §2. Este spec no lo amplía ni lo empeora: solo devuelve `caseId` y `caseCode` de casos que el usuario ya alcanza.
- **Exponer el filtro `statusCode` en otras rutas** distintas del listado de casos.

---

## 3. Modelo de datos

**No hay tablas, columnas, modelos, asociaciones ni índices nuevos.** El dominio `dashboard` solo lee. Las subsecciones de tabla origen y modelo Sequelize de la plantilla se sustituyen por el inventario de lo que se consulta y por la definición exacta de cada métrica.

### 3.1 Columnas consultadas

| Tabla | DDL | Columnas | Papel |
|---|---|---|---|
| `esaviCase` | `esaviapp.sql:725` | `caseId`, `caseCode`, `healthFacilityId`, `isActive`, `deletedAt` | Universo de casos |
| `healthFacility` | `esaviapp.sql:476` | `healthFacilityId`, `geoLocationId` | Puente al territorio, igual que en F49 |
| `caseWorkflow` | `esaviapp.sql:1410` | `caseId` (`UQ_caseWorkflow_case`), `statusItemId` (`IX_caseWorkflow_status`), `openedAt`, `classificationStartedAt`/`EndedAt`, `notificationStartedAt`/`EndedAt`, `investigationStartedAt`/`EndedAt`, `finalClassificationStartedAt`/`EndedAt`, `lastReopenedAt`, `reopenCount`, `isActive` | Estado, reloj de estancamiento, reaperturas, inicio de la investigación |
| `catalogItem` | `esaviapp.sql:214` | `catalogItemId`, `code`, `name`, `sortOrder`, del tipo `caseWorkflowStatus` (`esaviapp.sql:1879-1886`) | Los ocho estados y su orden |
| `notification` | `esaviapp.sql:803` | `caseId` (`UQ_notification_case`), `requestInvestigation`, `isActive` | Investigación solicitada |

Las cinco tablas tienen las cuatro columnas transversales (`isActive`, `deletedAt`, `sysDetails`, `appDetails`). `investigation` no se consulta: el inicio de la investigación se lee del sello `caseWorkflow.investigationStartedAt` (§3.2).

### 3.2 Definición de las métricas

**Universo común (U).** Un caso entra en el universo si cumple todo esto:

- `esaviCase.isActive = true` y `esaviCase.deletedAt IS NULL`;
- tiene un `caseWorkflow` con `isActive = true`;
- si `resolveUserGeoScopeIds(authUser)` no es `null`, su `healthFacility.geoLocationId` está en esa lista. Un establecimiento sin `geoLocationId` queda fuera para quien no es administrador, igual que en F49.

Si el alcance es `[]` (usuario sin asignaciones), el servicio **no consulta** y devuelve la estructura completa con ceros. Un alcance vacío no es un error.

**Embudo.** Se parte del catálogo `caseWorkflowStatus` (activos, ordenados por `sortOrder`) y se cruza con `LEFT JOIN` contra U agrupado por `statusItemId`. Por eso los ocho estados vienen siempre, con `count = 0` si no tienen casos. `openCases` es la suma de todos los estados salvo `CLOSED`.

**Estancados.**

- *Candidatos:* los casos de U cuyo estado no es `CLOSED`.
- *Etapa abierta:* la de las cuatro etapas (`CASE_WORKFLOW_STAGES`) que tiene `<etapa>StartedAt` sin `<etapa>EndedAt`. Si hubiera más de una, que sería un dato inconsistente, se toma la de `StartedAt` más reciente. Si no hay ninguna, `openStage` es `null`.
- *Fecha de referencia:* `GREATEST(COALESCE(<etapaAbierta>StartedAt, openedAt), lastReopenedAt)`. `GREATEST` de PostgreSQL ignora los `NULL`, así que un caso nunca reabierto se mide sin `lastReopenedAt`. **`PENDING_VALIDATION` no reinicia el reloj**, porque el workflow no guarda ninguna fecha para esa transición y la etapa sigue abierta.
- *Días detenido:* `floor(extract(epoch from now() - referenceAt) / 86400)`.
- *Estancado* si los días detenido son al menos `ESAVI_DASHBOARD_STALE_DAYS`.
- *Top:* los 10 casos con `referenceAt` más antigua. El empate se resuelve por `caseCode` ascendente.
- *Umbral menor que 1:* desactiva el bloque. Devuelve `staleDays` con el valor leído, `total = 0` e `items = []`, y no ejecuta la consulta.

**Investigaciones pendientes.**

- *Candidatos:* casos de U no `CLOSED` con una `notification` activa que tiene `requestInvestigation = true`, con `caseWorkflow.notificationEndedAt IS NOT NULL` y con `caseWorkflow.investigationStartedAt IS NULL`.
- *Fecha de solicitud:* `caseWorkflow.notificationEndedAt`, es decir, el cierre de la etapa de notificación, que es cuando la solicitud queda firme. Si es `NULL`, el caso no entra en el bloque: la solicitud aún puede cambiar.
- *Top:* los 10 con la solicitud más antigua; `daysWaiting` se calcula igual que los días detenido.

El criterio de «iniciada» es el sello del sistema que pone `ESAVI-CASEFLOW-012`, no `investigation.investigationStartDate`, que se escribe a mano y puede quedar vacío.

**Reabiertos.** Casos de U no `CLOSED` con `reopenCount > 0`.

### 3.3 Constantes y tipos

**`src/constants/caseWorkflow.constants.ts` (nuevo).** Se trasladan **sin cambiar valores** desde `caseWorkflow.service.ts:28-59`:

- `CASE_WORKFLOW_STATUS_CATALOG_CODE = 'caseWorkflowStatus'`
- `CASE_WORKFLOW_STATUS`: los ocho estados, `as const`
- `CASE_WORKFLOW_STAGES` y `CASE_WORKFLOW_STAGE_FIELD`

`caseWorkflow.service.ts` pasa a importarlas. Sus nombres locales `STATUS`, `STAGES` y `STAGE_FIELD` desaparecen.

**`src/constants/dashboard.constants.ts` (nuevo):**

- `DASHBOARD_CONFIG_SCOPE = 'DASHBOARD'`
- `DASHBOARD_STALE_DAYS_CODE = 'ESAVI_DASHBOARD_STALE_DAYS'`
- `DASHBOARD_TOP_LIMIT = 10`

**`src/types/dashboard/dashboard.types.ts` (nuevo)**, con su `index.ts` de barrel y su alta en `src/types/index.ts`:

```ts
export interface DashboardStatusCount {
    statusCode: string;
    statusName: string;
    sortOrder: number;
    count: number;
}

export interface DashboardStalledCase {
    caseId: string;
    caseCode: string;
    statusCode: string;
    openStage: CaseWorkflowStage | null;
    referenceAt: string;
    daysStalled: number;
}

export interface DashboardPendingInvestigation {
    caseId: string;
    caseCode: string;
    statusCode: string;
    requestedAt: string;
    daysWaiting: number;
}

export interface DashboardPendingWork {
    generatedAt: string;
    scope: { restricted: boolean; hasAssignments: boolean };
    funnel: DashboardStatusCount[];
    openCases: number;
    stalled: { staleDays: number; total: number; items: DashboardStalledCase[] };
    pendingInvestigations: { total: number; items: DashboardPendingInvestigation[] };
    reopened: { total: number };
}
```

El tipo de filtros del listado de casos gana `statusCode?: string`.

### 3.4 Superficie HTTP

```
GET /api/dashboard/pending-work   ESAVI-DASH-006    USER    (nuevo)
GET /api/esavi-cases              ESAVI-CASE-002A   USER    (existe, gana ?statusCode)
GET /api/esavi-cases/admin        ESAVI-CASE-002B   ADMIN   (existe, gana ?statusCode)
```

`src/routes/dashboard.routes.ts` se registra en `src/routes/index.ts` como `/dashboard`. Este spec no declara rutas con `:id`. Si los F66 a F69 añaden alguna, sus rutas literales van antes.

### 3.5 Reglas de negocio por operación

**`ESAVI-DASH-006` — trabajo pendiente.** No recibe query ni body. El validador del dominio no tiene reglas para el `006`, y la cadena de middlewares es `tokenValidation, validateUserRole(USER), handler`, sin `validateFields`, porque no hay entrada que validar. Orden:

1. Resuelve `resolveUserGeoScopeIds(authUser)`. Si es `[]`, devuelve los ceros (§3.2).
2. Lee el umbral con `getAppConfigNumber(DASHBOARD_STALE_DAYS_CODE, DASHBOARD_CONFIG_SCOPE, lang)`. **Si el helper lanza su `AppError` de configuración ausente o no numérica, el servicio lo captura y usa `0`**. Eso desactiva el bloque de estancados en lugar de tumbar el home, y deja una traza `esaviLog('ESAVI-DASH-006 - ESAVI_DASHBOARD_STALE_DAYS missing or invalid, stalled block disabled', 'warn')`. Cualquier otro error del helper sigue su curso normal.
3. Carga los ítems activos del catálogo `caseWorkflowStatus`. Si no hay ninguno → 500 `DASH_006_STATUS_CATALOG_MISSING`, porque el despliegue está roto, no la petición.
4. Ejecuta las cuatro agregaciones con `sequelize.query` parametrizado (`replacements`, `QueryTypes.SELECT`), igual que `geoScope.service.ts`. Nunca se interpola texto. Las cuatro son independientes y van en `Promise.all`, sin transacción porque son lecturas.
5. Cualquier otro fallo → 500 `DASH_006_FETCH_FAILED`.

**`ESAVI-CASE-002A` / `002B` — filtro `statusCode`.**

- *Validador:* `query('statusCode').optional().trim().isIn(Object.values(CASE_WORKFLOW_STATUS))`. Un valor fuera de la lista → 400 desde `validateFields`. El resto de filtros de F48 y el alcance de F49 no cambian.
- *Servicio:* si `statusCode` viaja, añade el include `{ model: CaseWorkflow, as: 'workflow', attributes: [], required: true, where: { isActive: true } }`, con un include anidado `{ model: CatalogItem, as: 'status', attributes: [], required: true, where: { code: statusCode } }`.
  - Con `attributes: []`, las filas devueltas no cambian de forma.
  - La relación es `hasOne` con `UQ_caseWorkflow_case`, así que el `count` de `findAndCountAll` no se infla.
  - Sin `statusCode`, la consulta queda exactamente igual que hoy.

**Escrituras.** Ninguna operación de este spec escribe sobre una fila existente, así que **no aplica el contrato de update diferencial ni su bloque de §5**. La única escritura relacionada es la siembra de `ESAVI_DASHBOARD_STALE_DAYS`, que hace el `ESAVI-SYSCONF-008` existente. Esa operación es solo de alta y no modifica filas presentes, por lo que tampoco es un update diferencial (SPEC F26).

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `dashboard.pendingWorkSuccess` | `message` del 200 de `ESAVI-DASH-006` |
| `dashboard.pendingWorkFailed` | 500 `DASH_006_FETCH_FAILED` |
| `dashboard.statusCatalogMissing` | 500 `DASH_006_STATUS_CATALOG_MISSING` |

Van en `es`, `en` y `nl`. El filtro `statusCode` no necesita claves nuevas: su 400 usa el mensaje del validador, como los demás filtros de F48.

### 3.7 Forma de la respuesta

```
{ ok, message, data: {
    generatedAt,                                  // ISO, now() del servidor
    scope: { restricted, hasAssignments },        // restricted=false para admin
    funnel: [ { statusCode, statusName, sortOrder, count } ],   // siempre 8, por sortOrder
    openCases,
    stalled: { staleDays, total, items: [ { caseId, caseCode, statusCode, openStage, referenceAt, daysStalled } ] },
    pendingInvestigations: { total, items: [ { caseId, caseCode, statusCode, requestedAt, daysWaiting } ] },
    reopened: { total }
} }
```

- `statusName` es el `name` guardado en `catalogItem`. El frontend localiza por `statusCode`.
- `items` tiene como máximo `DASHBOARD_TOP_LIMIT` elementos.
- No se devuelve ningún dato del paciente: solo `caseId` y `caseCode`, de casos que el usuario ya alcanza por `ESAVI-CASE-003`.

---

## 4. Plan de implementación

Primero va la refactorización sin cambio de comportamiento, después la ampliación de un endpoint que ya existe y al final el dominio nuevo. Cada paso compila y se puede committear por separado.

1. **Extraer las constantes del workflow.** Crear `src/constants/caseWorkflow.constants.ts` con `CASE_WORKFLOW_STATUS_CATALOG_CODE`, `CASE_WORKFLOW_STATUS`, `CASE_WORKFLOW_STAGES` y `CASE_WORKFLOW_STAGE_FIELD`, con los valores copiados de `caseWorkflow.service.ts:28-59`. El servicio pasa a importarlas y borra sus copias locales.
   *Verificación:* `grep -n "const STATUS = {" src/services/caseWorkflow.service.ts` no devuelve nada; `npm run check` sale en 0 sin tocar ningún test.

2. **Registrar la abreviatura.** Añadir `dashboard | DASH` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `dashboard | 006 | trabajo pendiente — embudo, estancados, investigaciones pendientes y reabiertos, acotado por F49. GET /pending-work, USER` a la tabla de operaciones propias.
   *Verificación:* `grep -n "DASH" references/CONVENTIONS.md` devuelve las dos filas, y `DASH` aparece una sola vez en la tabla de abreviaturas.

3. **Configuración del umbral.** Crear `src/constants/dashboard.constants.ts` (`DASHBOARD_CONFIG_SCOPE`, `DASHBOARD_STALE_DAYS_CODE`, `DASHBOARD_TOP_LIMIT`). Añadir a `src/data/systemConfig.defaults.ts` la entrada `ESAVI_DASHBOARD_STALE_DAYS`: `value: 15`, `valueType: 'number'`, `scope: 'DASHBOARD'`, `isEncrypted: false`, `isEditable: true`, con `name` y `description` en español como las demás. La descripción indica que un valor menor que 1 desactiva la detección.
   *Verificación:* `POST /api/system-configs/sync` como SUPERADMIN crea la fila; una segunda llamada crea 0; `GET /api/system-configs/code/ESAVI_DASHBOARD_STALE_DAYS?scope=DASHBOARD` devuelve `15`.

4. **Filtro `statusCode` en `ESAVI-CASE-002A` y `002B`.** Añadir la regla `isIn` al validador del listado en `src/validators/esaviCase.validator.ts`, `statusCode?` al tipo de filtros, y el include condicional `workflow → status` en el constructor de la consulta de `esaviCase.service.ts`, compartido por los dos listados. Casos nuevos en `tests/contract/esaviCase.test.ts`.
   *Verificación:* `?statusCode=IN_INVESTIGATION` devuelve solo casos en ese estado y su `count` coincide con las filas; `?statusCode=FOO` responde 400; sin el parámetro, la respuesta es idéntica a la de antes del cambio.

5. **Tipos del dominio.** `src/types/dashboard/dashboard.types.ts` con las interfaces de §3.3, su `index.ts` y su alta en `src/types/index.ts`.
   *Verificación:* `npm run build` sale en 0.

6. **Claves i18n.** Las tres claves de §3.6 en `src/data/i18n/es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

7. **`ESAVI-DASH-006` — trabajo pendiente.**
   - `getPendingWorkService(authUser, lang)` en `src/services/dashboard.service.ts`, con los pasos 1 a 5 de §3.5 y las cuatro consultas de §3.2 en `Promise.all`.
   - `getPendingWork` en `src/controllers/dashboard.controller.ts`, con el idiom de error estándar.
   - `src/routes/dashboard.routes.ts` con `GET /pending-work`, registrado como `/dashboard` en `src/routes/index.ts`.
   - El código `ESAVI-DASH-006` aparece en la ruta, el controlador, el servicio, `esaviLog` y los `AppError`. `appDetails.method` no aplica porque no hay escritura.

   *Verificación:* como ADMIN devuelve los ocho estados y `scope.restricted = false`; un USER sin asignaciones recibe todo a cero con `scope.hasAssignments = false`; con el umbral a `0` el bloque `stalled` llega vacío y con `staleDays: 0`.

8. **Pruebas de convención.** Fila `GET /api/dashboard/pending-work → USER, ESAVI-DASH-006` en `ROUTE_RULES` de `tests/auth/roles.test.ts`, y suite `tests/contract/dashboard.test.ts` con los escenarios de §5. Las fixtures incluyen casos en dos territorios, uno estancado, uno con investigación solicitada sin iniciar y uno reabierto.
   *Verificación:* `npm test -- dashboard roles esaviCase` sale en 0.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] `GET /api/dashboard/pending-work` responde 200 a `USER`, `NOTIFIER`, `INVESTIGATOR`, `EVALUATOR`, `ADMIN` y `SUPERADMIN`, 403 a `ANALYTICS` y 401 sin token.
- [ ] Los puntos del código de operación coinciden: ruta, controlador, servicio, `esaviLog` y `AppError` (`DASH_006_*`).
- [ ] `grep -rn "ESAVI-DASH-00[1-5]" src/` no devuelve resultados.
- [ ] `DASH` está registrada en `references/CONVENTIONS.md` §6 junto con su fila `006`.
- [ ] `grep -n "const STATUS = {\|const STAGES\b" src/services/caseWorkflow.service.ts` no devuelve resultados, y `caseWorkflow.test.ts` pasa sin cambios.

**Embudo**

- [ ] `funnel` trae siempre los ocho estados en orden de `sortOrder`, incluidos los que tienen `count = 0`.
- [ ] La suma de `funnel[].count` es igual al número de casos activos con workflow activo dentro del alcance, y `openCases` es esa suma menos el `count` de `CLOSED`.
- [ ] Un caso desactivado (`ESAVI-CASE-005A`) deja de contarse.

**Alcance (F49)**

- [ ] Un ADMIN ve casos de los dos territorios de la fixture y recibe `scope.restricted = false`.
- [ ] Un USER asignado al territorio A no cuenta ningún caso del B en ningún bloque, y ningún `caseId` del B aparece en `items`.
- [ ] Un USER sin asignaciones recibe 200 con todos los contadores a 0, `items` vacíos, los ocho estados en `funnel` y `scope.hasAssignments = false`.
- [ ] Un caso en un establecimiento sin `geoLocationId` lo cuenta el ADMIN, pero no un USER.

**Estancados**

- [ ] Un caso con `investigationStartedAt` de hace 20 días y `investigationEndedAt` nulo aparece con `openStage: 'INVESTIGATION'` y `daysStalled = 20` cuando el umbral es 15.
- [ ] El mismo caso no aparece cuando el umbral es 30.
- [ ] Pasar ese caso a `PENDING_VALIDATION` (`ESAVI-CASEFLOW-010`) no cambia su `referenceAt` ni sus `daysStalled`.
- [ ] Un caso reabierto ayer, con una etapa abierta hace 40 días, tiene `daysStalled = 1`.
- [ ] Un caso `CLOSED` nunca aparece en el bloque, aunque sea muy antiguo.
- [ ] `items` tiene como máximo 10 elementos, ordenados por `referenceAt` ascendente, y `total` cuenta todos los casos estancados, no solo los 10.
- [ ] Con `ESAVI_DASHBOARD_STALE_DAYS = 0`, la respuesta trae `stalled.staleDays = 0`, `total = 0` e `items = []`.
- [ ] Con la configuración desactivada (`isActive = false`) y sin variable de entorno, el endpoint responde **200**, no 500, con `staleDays = 0`, y `esaviLog.log` registra la advertencia `ESAVI-DASH-006`.

**Investigaciones pendientes**

- [ ] Un caso con `requestInvestigation = true`, `notificationEndedAt` puesto e `investigationStartedAt` nulo aparece, con `requestedAt = notificationEndedAt`.
- [ ] El mismo caso sale del bloque en cuanto se crea su investigación, porque `ESAVI-CASEFLOW-012` sella `investigationStartedAt`.
- [ ] Un caso con `requestInvestigation = true` pero `notificationEndedAt` nulo no aparece.
- [ ] Un caso con `requestInvestigation = false` no aparece.

**Reabiertos**

- [ ] Un caso reabierto (`ESAVI-CASEFLOW-009`) y no cerrado de nuevo suma 1 a `reopened.total`. Si se vuelve a cerrar, deja de sumar.

**Filtro `statusCode` en el listado de casos**

- [ ] `GET /api/esavi-cases?statusCode=IN_INVESTIGATION` devuelve solo casos en ese estado; `count` es igual al número de filas sin paginar, y coincide con el `count` de ese estado en `funnel` para el mismo usuario.
- [ ] `GET /api/esavi-cases?statusCode=FOO` responde 400.
- [ ] `statusCode` combinado con `geoLocationId` (F48) y con el alcance de F49 da la intersección de los tres filtros.
- [ ] Sin `statusCode`, la respuesta de `002A` y `002B` es idéntica a la de antes del spec: mismas filas, mismo `count`, mismos campos por fila.
- [ ] `GET /api/esavi-cases/admin?statusCode=CLOSED` funciona igual para ADMIN.

**Datos expuestos**

- [ ] Ningún elemento de `items` trae datos del paciente: las claves son exactamente las declaradas en §3.7.

**Sin escrituras**

- [ ] Llamar a `ESAVI-DASH-006` no modifica ninguna fila: `updatedAt`, `appDetails` y `sysDetails` de los casos y workflows de la fixture quedan iguales antes y después.

**Cierre**

- [ ] Las tres claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` incluye la ruta nueva.
- [ ] `npm run check` sale en 0.

No va el bloque de cinco criterios de update diferencial. Ninguna operación de este spec escribe sobre una fila existente, como declara §3.5.

---

## 6. Decisiones tomadas y descartadas

**Forma del dominio**

- **Sí:** un dominio `dashboard` con abreviatura propia (`DASH`) y numeración desde `006`. No es una entidad ni tiene tabla. Darle `001`–`005B` sería inventar un CRUD que no existe, y el precedente de un dominio sin tabla es `meddra`.
- **No:** colgar los agregados de `/api/esavi-cases/stats` o de `/api/case-workflows/summary`. El dashboard cruzará en F66 a F69 tablas de notificación, investigación y clasificación final. Atarlo a una entidad obligaría a moverlo después.
- **Sí:** un endpoint por bloque temático (F65 trabajo pendiente, F66 KPIs, F67 series…) y no uno solo con todo. Cada bloque tiene su propio coste de consulta y sus parámetros, y el frontend puede cargarlos en paralelo y en forma progresiva.

**Alcance y roles**

- **Sí:** reutilizar `resolveUserGeoScopeIds` de F49 tal cual. Un contador con otro criterio de territorio filtraría lo que el listado oculta, que es justo lo que F49 descartó.
- **Sí:** un usuario sin asignaciones recibe ceros y 200, no 403. Es el mismo cierre por defecto de F49, y el frontend distingue el caso por `scope.hasAssignments`.
- **Sí:** rol mínimo `USER`, igual que todas las lecturas del caso en F64.
- **No:** abrir el `006` a `ANALYTICS`. Es un panel operativo de expedientes concretos (`caseId`, `caseCode`). Los indicadores agregados para análisis van en F66 y F67.
- **Sí:** payload idéntico para todos los roles. Los roles de F64 están anidados por nivel, así que «lo de cada uno» se solapa. Además, todos esos roles ya leen los mismos casos por `ESAVI-CASE-003`. Resaltar según el rol es presentación, y queda en el frontend (nota de §2 y §8).
- **No:** personalizar el payload según el rol de etapa. Duplicaría la lógica de roles en el servicio sin ganar ningún control de acceso.

**Estancados**

- **Sí:** medir sobre la etapa abierta (`<etapa>StartedAt` sin `EndedAt`) y no sobre `updatedAt`. `updatedAt` se mueve con cualquier escritura, incluida una corrección menor, y escondería casos realmente detenidos.
- **Sí:** que `PENDING_VALIDATION` no reinicie el reloj. El workflow no guarda cuándo se pidió la validación, y pedirla no hace avanzar el expediente.
- **No:** leer `appDetails` para fechar la entrada en `PENDING_VALIDATION`. Habría que recorrer JSONB en cada carga del home para ganar una precisión que no cambia la decisión de «este caso está detenido».
- **Sí:** que `lastReopenedAt` reinicie el reloj, mediante `GREATEST`. Una reapertura es una decisión administrativa reciente, y medir desde una etapa abierta hace meses daría un falso positivo inmediato.
- **Sí:** un umbral global, `ESAVI_DASHBOARD_STALE_DAYS = 15`, en `systemConfig`. Es un parámetro operativo y se ajusta sin desplegar, con historial en `systemConfigHistory`.
- **No:** un umbral por etapa. Son cuatro parámetros para una primera versión sin datos reales de duración por etapa. F66 medirá esos tiempos, y con esa evidencia se puede abrir un spec propio.
- **Sí:** un umbral menor que 1 desactiva el bloque, igual que `ESAVI_SESSION_RETENTION_DAYS`.
- **Sí:** si falta la configuración, o no es numérica, se usa 0 y se escribe una advertencia en el log, en vez de responder 500. Un parámetro opcional de un panel no debe tumbar el home. Esto se aparta del comportamiento general de `getAppConfigNumber`, y se acota a este único parámetro con su traza.

**Investigaciones pendientes**

- **Sí:** solicitud = `notificationEndedAt`. Es cuando termina el proceso de notificación y la solicitud queda firme.
- **Sí:** iniciada = `caseWorkflow.investigationStartedAt IS NOT NULL`. Es el sello que pone `ESAVI-CASEFLOW-012` y siempre existe una vez creada la investigación.
- **No:** `investigation.investigationStartDate`. Se escribe a mano y puede quedar vacía, así que un expediente en plena investigación figuraría como pendiente.
- **No:** `notification.updatedAt` como fecha de solicitud, porque se mueve con cualquier escritura.
- **No:** contar las solicitudes con la notificación sin cerrar. Mientras la etapa siga abierta, la bandera puede cambiar.

**Consulta y respuesta**

- **Sí:** SQL parametrizado (`sequelize.query` con `replacements`) para las agregaciones. `GROUP BY` con `LEFT JOIN` al catálogo y `GREATEST`/`COALESCE` sobre timestamps no se expresan bien con el ORM, y `geoScope.service.ts` es el precedente en el repositorio.
- **Sí:** las cuatro consultas en `Promise.all` y sin transacción, porque son lecturas independientes.
- **Sí:** totales más un top 10 en estancados e investigaciones pendientes, para que el home enlace a los casos sin una segunda llamada.
- **No:** paginar los `items` del dashboard. Para la lista completa está el listado de casos con `?statusCode=`.
- **Sí:** devolver solo `caseId` y `caseCode`, sin datos del paciente. El home no necesita PII, y descifrarla en una vista agregada multiplica la exposición.
- **Sí:** devolver el `name` del catálogo en `funnel`, además del `code`. El frontend localiza por `code`, y el `name` sirve como texto de respaldo.

**Filtro del listado**

- **Sí:** incluir `?statusCode=` en `ESAVI-CASE-002A` y `002B` dentro de este spec. Sin él, el embudo es una cifra que no lleva a ningún sitio.
- **Sí:** filtrar por `code` del estado y no por `statusItemId`. El frontend ya conoce los ocho códigos, que son estables y legibles, mientras que los UUID cambian entre entornos.
- **No:** aceptar varios estados a la vez (`?statusCode=A,B`). Ningún bloque del home lo necesita, y se puede añadir sin romper nada.
- **Sí:** extraer las constantes del workflow a `src/constants/`. Hoy el validador del listado tendría que importar un servicio para conocer los estados, al revés de lo que dicta el flujo de capas.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Las agregaciones se vuelven lentas cuando crece el histórico, porque el home se carga en cada sesión | Las consultas se apoyan en `IX_caseWorkflow_status`, `UQ_caseWorkflow_case`, `UQ_notification_case` y en la FK de `esaviCase` a `healthFacility`. **Condición de entrada para un spec de caché o vista materializada:** el p95 de `ESAVI-DASH-006` supera 1 s con datos de producción. Hasta entonces no se añade infraestructura |
| Un alcance territorial amplio, como una provincia entera, genera un `IN (:scope)` con cientos de `geoLocationId` | Es el mismo patrón que ya ejecuta `ESAVI-CASE-002A` con F49 en cada listado. El árbol tiene la profundidad acotada por `MAX_GEO_SUBTREE_DEPTH` |
| Mover las constantes del workflow rompe en silencio a `caseWorkflow.service.ts` | El paso 1 no cambia valores y se committea solo, y `caseWorkflow.test.ts` tiene que pasar sin modificarse (§5) |
| Un caso con datos de etapa inconsistentes (dos etapas abiertas a la vez) se clasifica mal | Se toma la etapa de `StartedAt` más reciente (§3.2). El caso aparece igual si está detenido, y la inconsistencia no tumba la consulta |
| Si alguien desactiva la configuración por error, desaparece la detección de estancados y nadie lo nota | `staleDays = 0` viaja en la respuesta y el frontend lo muestra como «detección desactivada» (§8). El log registra la advertencia en cada carga |
| El `count` de `002A` con `statusCode` se infla por el include | La relación es `hasOne` con `UQ_caseWorkflow_case`, así que no hay filas duplicadas. Un criterio de §5 compara el `count` con el del embudo |

---

## 8. Impacto en el contrato HTTP

**Cambios aditivos. Ningún cliente actual se rompe.**

| Ruta | Antes | Después |
|---|---|---|
| `GET /api/dashboard/pending-work` | No existe (404) | 200 con el payload de §3.7 |
| `GET /api/esavi-cases`, `GET /api/esavi-cases/admin` | `?statusCode` se ignora | `?statusCode` filtra por estado; un valor desconocido responde **400** |

El único cambio de comportamiento sobre una ruta existente es ese 400. Un cliente que hoy mande `statusCode` con un valor arbitrario, y que hasta ahora se ignoraba, pasará a recibir 400. No hay constancia de ningún cliente que lo haga.

**Notas para el spec del frontend:**

1. **El payload es idéntico para todos los roles.** Solo lo acota el territorio del usuario. La interfaz decide qué resaltar según el rol efectivo, que se lee del perfil (`ESAVI-USER-007`). Por ejemplo: investigaciones pendientes para `INVESTIGATOR`, `IN_FINAL_CLASSIFICATION` para `EVALUATOR`, `OPEN`/`IN_CLASSIFICATION`/`IN_NOTIFICATION` para `NOTIFIER`. Ocultar un bloque no es control de acceso, porque el dato ya viaja y el usuario está autorizado a verlo.
2. **`stalled.staleDays < 1` significa que la detección está desactivada**, no que no haya casos detenidos. Se muestra como tal.
3. **`scope.hasAssignments = false`** significa que el usuario no tiene territorio asignado. Conviene mostrar un aviso explícito en lugar de un panel vacío que parezca «todo en orden».
4. **Cada cifra del embudo enlaza** a `GET /api/esavi-cases?statusCode=<statusCode>`. El `count` de ese listado coincide con el del embudo para el mismo usuario.
5. **Las etiquetas se localizan por `statusCode`.** `statusName` es solo texto de respaldo.
6. **`total` y `items` son distintos:** `items` trae como máximo 10 elementos, y `total` cuenta todos los casos del bloque.

---

## Lo que **no** está en este spec

- KPIs de vigilancia con periodo: casos, % de graves, defunciones, oportunidad de notificación, tiempo de cierre, causalidad (SPEC F66).
- Series y distribuciones: curva semanal, vacunas sospechosas, sexo y edad, geografía, errores programáticos (SPEC F67).
- Alerta de agrupamiento por lote (SPEC F68).
- Actividad reciente y «mis casos» (SPEC F69).
- Umbral de estancamiento por etapa.
- Avisos o correos por casos estancados.
- Caché, vistas materializadas o refresco programado.
- Payload personalizado por rol de etapa.
- Filtro por varios estados a la vez en el listado de casos.
- Alcance territorial sobre las entidades satélite del caso.

Cada uno de esos, si aterriza, va en su propio spec.
