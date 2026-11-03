# SPEC F66 — Dashboard: indicadores de vigilancia

> **Estado:** Implementado
> **Depende de:** SPEC 01, SPEC 02, SPEC 04, SPEC 05, SPEC 08, **SPEC F26** (`systemConfig`), **SPEC F41** (`finalClassification`), **SPEC F44** (`caseWorkflow`), **SPEC F48** (filtro `geoLocationId`), **SPEC F49** (alcance geográfico), **SPEC F65** (marco del dominio `DASH`)
> **Fecha:** 2026-11-02
> **Objetivo:** Dar al home los indicadores de vigilancia ESAVI de un periodo —volumen, gravedad, defunciones, oportunidad de notificación, tiempos de cierre y causalidad—, comparados con el periodo anterior y acotados al territorio del usuario.

---

## 1. Por qué existe este spec

**F65 dice qué hay que hacer; falta decir cómo va la vigilancia.** El trabajo pendiente es una foto operativa del momento actual. Un responsable de vigilancia necesita además indicadores de un periodo: cuántos casos se notificaron, qué proporción fue grave, cuántas muertes hubo, si se notifica a tiempo, cuánto tarda en cerrarse un expediente y cómo se distribuye la causalidad. Hoy ninguno de esos números se puede obtener por API sin recorrer caso por caso.

**Los datos están, repartidos en cinco tablas.**

- La gravedad y sus ocho criterios viven en `classification` (`isSeriousEvent`, `caused*`).
- Las defunciones aparecen en tres sitios que pueden no coincidir: `classification.causedDeath`, `notification.deathDate` e `investigationAutopsy.isDeath`.
- La oportunidad sale de `esaviCase.eventDate` y `reportDate`.
- Los tiempos salen de los sellos de `caseWorkflow` (F44).
- La causalidad OMS vive en `finalClassification` (F41). No se guarda como una categoría única, sino como booleanos por bloque más un orden de prelación. Agregarla exige una regla de derivación que **ningún spec ha fijado todavía**, y este la fija.

**Hay un parámetro sembrado que nadie consume.** `ESAVI_NOTIFICATION_DEADLINE_DAYS` (`src/data/systemConfig.defaults.ts`, scope `NOTIFICATION`, 30 días) define desde F26 el plazo de notificación, y ningún servicio lo lee. El indicador de oportunidad es su primer consumidor natural.

**`ANALYTICS` existe y no tiene nada que leer.** El rol de nivel 10 está en `ROLE_LEVELS` desde el inicio, pero todas las lecturas de casos exigen `USER` (20) o más (F64), así que hoy un analista no alcanza ninguna ruta de datos. Este spec le abre la primera: agregados sin `caseId` ni datos personales.

**Un indicador sin territorio es una fuga.** Igual que en F65, los conteos pasan por `resolveUserGeoScopeIds`. Este spec además admite `?geoLocationId=` para bajar de nivel. Ese filtro **solo puede estrechar el alcance**: intersecta con la cobertura del usuario, y una unidad ajena o inexistente da ceros, nunca un error que confirme su existencia.

**F66 define el periodo que heredan F67 y F68.** `from`, `to`, el valor por defecto, el rango máximo y el periodo anterior se validan una sola vez, en un validador del dominio que reutilizan las series y la alerta por lote.

---

## 2. Alcance

**Dentro:**

- **Validador de periodo compartido del dominio `DASH`** (`dashboardPeriodValidator`), reutilizable por F67 y F68:
  - `from` y `to` opcionales, en formato `YYYY-MM-DD`.
  - Sin ninguno de los dos: los últimos 30 días hasta `current_date`, ambos extremos incluidos.
  - Con solo `to`: `from = to − 29`. Con solo `from`: `to = current_date`.
  - `from > to`, `to` futura o un rango de más de 366 días → **400**.
  - **Periodo anterior:** el tramo de igual duración inmediatamente antes de `from`. Lo calcula el servicio, no viaja en la query.
- **Filtro `geoLocationId` opcional**, compartido por el dominio. Se expande con `resolveGeoSubtreeIds` y se **intersecta** con `resolveUserGeoScopeIds`. Una unidad ajena o inexistente da ceros con 200, nunca 403 ni 404.
- **`ESAVI-DASH-007` — indicadores de vigilancia.** `GET /api/dashboard/indicators`, rol mínimo **`ANALYTICS`**. Ancla general: `esaviCase.reportDate` dentro del periodo. Bloques:
  - **Volumen:** casos del periodo actual y del anterior, con su desglose por `notification.notificationType` (`SEVERE`, `NON_SEVERE`, sin notificación).
  - **Gravedad:** casos con clasificación, graves (`isSeriousEvent = true`) y sin clasificación, con actual y anterior. Además, el conteo de cada uno de los ocho criterios `caused*` del periodo actual.
  - **Defunciones:** casos con `classification.causedDeath = true` **o** `notification.deathDate IS NOT NULL` **o** `investigationAutopsy.isDeath = true`, con actual y anterior. Además, autopsias solicitadas (`notification.autopsyRequested`) y realizadas (`investigationAutopsy.isAutopsyPerformed`) del periodo actual.
  - **Oportunidad de notificación:** mediana de días entre `eventDate` y `reportDate`, casos dentro de `ESAVI_NOTIFICATION_DEADLINE_DAYS` y casos sin `eventDate`, que se cuentan aparte.
  - **Tiempos de cierre** (**ancla `closedAt` dentro del periodo**, la única excepción): casos cerrados en el periodo, mediana de días entre `openedAt` y `closedAt`, y mediana de duración de cada una de las cuatro etapas completadas. Solo cuentan los casos actualmente `CLOSED`.
  - **Causalidad OMS:** distribución A, B, C, D y «sin clasificar» sobre los casos del periodo con `finalClassification` activa, más el desglose de las cuatro subcategorías de A. Aparte va el conteo de casos del periodo sin clasificación final.
- **Regla de derivación de la categoría principal de causalidad** (§3.2). Este spec la fija, y la reutilizarán F67 y cualquier otro consumidor.
- **Primer consumidor de `ESAVI_NOTIFICATION_DEADLINE_DAYS`.**
- Claves i18n, fila en `ROUTE_RULES` y casos nuevos en `tests/contract/dashboard.test.ts`.

**Nota para el frontend:**

> Los bloques comparables traen `{ current, previous }` con valores crudos. La variación la calcula la interfaz, que decide cómo mostrar el paso de 0 a N. Las medianas son `null` cuando no hay casos, no 0. `ANALYTICS` también está acotado por territorio: un analista sin asignaciones ve ceros, y la interfaz debe avisarlo con `scope.hasAssignments`, igual que en F65.

**Fuera de alcance (otros specs, o descartado):**

- Curva por semana epidemiológica, vacunas sospechosas, sexo y edad, geografía, errores programáticos y cadena de frío. → **SPEC F67**.
- Alerta de agrupamiento por lote. → **SPEC F68**.
- Ancla elegible por query (`?dateField=`). Se fijó `reportDate` (§6).
- Variación porcentual calculada en el backend.
- Comparación con el mismo periodo del año anterior, o con varios periodos. Solo se compara con el periodo inmediatamente anterior.
- Validar la coherencia entre las tres fuentes de defunción, o corregir datos discrepantes. El dashboard cuenta; no audita.
- Validar coherencia entre bloques de `finalClassification` (por ejemplo, A y C marcados a la vez). Sigue fuera, como en F41.
- Exportar los indicadores (CSV, PDF).
- Abrir a `ANALYTICS` cualquier ruta que devuelva casos individuales.
- Caché o vistas materializadas. Aplica la misma condición de entrada que en F65 §7.

---

## 3. Modelo de datos

**No hay tablas, columnas, modelos, asociaciones ni índices nuevos.** Solo se lee.

### 3.1 Columnas consultadas

| Tabla | DDL | Columnas | Vigencia | Papel |
|---|---|---|---|---|
| `esaviCase` | `:725` | `caseId`, `healthFacilityId`, `reportDate` (`IX_esaviCase_reportDate`), `eventDate` | `isActive`, `deletedAt IS NULL` | Universo y ancla |
| `healthFacility` | `:476` | `geoLocationId` | — | Territorio (F49) |
| `caseWorkflow` | `:1410` | `statusItemId`, `openedAt`, `closedAt`, los ocho `<etapa>StartedAt`/`EndedAt` | `isActive` | Tiempos de cierre |
| `catalogItem` | `:214` | `code` del tipo `caseWorkflowStatus` | — | Identificar `CLOSED` |
| `classification` | `:775` | `caseId` (`UQ_classification_case`), `isSeriousEvent`, `causedDeath`, `causedDisability`, `causedCongenitalAnomaly`, `causedFetalDeath`, `causedLifeThreatening`, `causedHospitalization`, `causedAbortion`, `causedOtherCondition` | `isActive` | Gravedad y defunción |
| `notification` | `:803` | `caseId` (`UQ_notification_case`), `notificationType`, `deathDate`, `autopsyRequested` | `isActive` | Volumen por tipo, defunción, autopsia solicitada |
| `investigation` | `:1028` | `investigationId`, `caseId` (`UQ_investigation_case`) | `isActive` | Puente a la autopsia |
| `investigationAutopsy` | `:1075` | `investigationId` (PK), `isDeath`, `isAutopsyPerformed` | **`deletedAt IS NULL`** | Defunción y autopsia realizada |
| `finalClassification` | `:1380` | `caseId` (`UQ_finalClassification_case`), `importanceAItemId`/`B`/`C`, los cuatro `aIsRelatedTo*`, `bIsConsistentTemporalRelation`, `bHasDeterminantFactor`, `cHasCoincidentCause`, `dIsUnclassifiable` | `isActive` | Causalidad |
| `catalogItem` | `:214` | `catalogItemId`, `value` del tipo `finalClassificationImportance` (`:1826-1828`) | — | Prelación `1`/`2`/`3` |

**Anomalía declarada:** `investigationAutopsy` no tiene `isActive`, que es una de las cuatro columnas transversales. No la resuelve este spec, que se limita a filtrar por `deletedAt IS NULL`. Queda catalogada como [DEUDA-047](../../TECHNICAL_DEBT.md#deuda-047) (paso 1 del plan).

Todas las relaciones satélite son uno a uno con el caso (`UQ_*_case`), así que **ningún join multiplica filas**.

### 3.2 Definición de los indicadores

**Periodo.** `[from, to]` cerrado, en fechas. `days = to − from + 1`. Periodo anterior: `[from − days, from − 1]`.

**Universo del periodo (Uₚ).** Casos del universo U de F65 —caso activo, workflow activo, dentro del alcance— con `reportDate` en `[from, to]`. El alcance efectivo es:

- `resolveUserGeoScopeIds(authUser)` cuando no viaja `geoLocationId`;
- `resolveGeoSubtreeIds([geoLocationId])` cuando viaja y el usuario es administrador;
- la intersección de los dos cuando viaja y el usuario no es administrador. Si la intersección es vacía, el servicio no consulta y devuelve ceros.

**Volumen.** `total` = |Uₚ|. `byNotificationType` = conteo por `notification.notificationType` (`SEVERE`, `NON_SEVERE`) más `none`, que son los casos sin notificación activa. Se calcula con `current` y `previous`.

**Gravedad.**

- `classified`: casos de Uₚ con `classification` activa.
- `serious`: los clasificados con `isSeriousEvent = true`.
- `unclassified`: |Uₚ| − `classified`.

Los tres llevan `current` y `previous`. `criteria` cuenta, solo en el periodo actual, cuántos casos clasificados tienen en `true` cada uno de los ocho `caused*`. Un caso puede sumar en varios criterios.

**Defunciones.**

- `deaths`: casos de Uₚ en los que se cumple cualquiera de estas tres condiciones: `classification.causedDeath = true`, `notification.deathDate IS NOT NULL` o `investigationAutopsy.isDeath = true`. Se usan las filas vigentes de cada tabla y cada caso se cuenta una sola vez. Lleva `current` y `previous`.
- `autopsyRequested`: casos de Uₚ con `notification.autopsyRequested = true`.
- `autopsyPerformed`: casos de Uₚ con `investigationAutopsy.isAutopsyPerformed = true`.

Estos dos últimos solo se calculan para el periodo actual.

**Oportunidad de notificación.** Sobre Uₚ, periodo actual:

- `withEventDate` y `withoutEventDate`;
- `medianDays`: `percentile_cont(0.5)` de `reportDate − eventDate`, redondeado a 1 decimal, o `null` si no hay casos con `eventDate`;
- `onTime`: casos con `reportDate − eventDate <= ESAVI_NOTIFICATION_DEADLINE_DAYS`;
- `deadlineDays`: el valor leído.

Si esa configuración falta o no es numérica, `deadlineDays` y `onTime` son `null` y se registra una advertencia en el log. Es la misma tolerancia que F65 aplica al umbral de estancados: el resto del bloque se calcula igual.

**Tiempos de cierre.** Universo propio: casos de U, **no de Uₚ**, cuyo estado actual es `CLOSED` y cuyo `closedAt::date` cae en `[from, to]`.

- `closedCases`;
- `medianDaysToClose`: mediana de `closedAt − openedAt` en días, con 1 decimal;
- `stageMedianDays`: un objeto con las cuatro etapas (`CLASSIFICATION`, `NOTIFICATION`, `INVESTIGATION`, `FINAL_CLASSIFICATION`). Cada valor es la mediana de `<etapa>EndedAt − <etapa>StartedAt` entre los casos que tienen los dos sellos, o `null`.

Solo periodo actual.

**Causalidad OMS: regla de la categoría principal.** Para cada `finalClassification` activa de un caso de Uₚ, en este orden:

1. `dIsUnclassifiable = true` → **`D`**.
2. Si no, el bloque cuyo `importance*ItemId` apunta al `catalogItem` de `value = 'MAX'` del tipo `finalClassificationImportance` → **`A`**, **`B`** o **`C`**.
3. Si no hay prelación `1`, el primer bloque con algún booleano en `true`, en orden A → B → C.

**Corrección en implementación (2026-11-03).** La redacción original comparaba con `value = '1'`, igual que F41 §A, pero la siembra real (`esaviapp.sql:1826-1828`) guarda la prelación como `code` `1`/`2`/`3` y `value` `MAX`/`MED`/`MIN`. Se compara por `value`, que es la clave estable según F46, con la constante `FINAL_CLASSIFICATION_TOP_IMPORTANCE_VALUE`. Queda pendiente, fuera de este spec, añadir `('finalClassificationImportance', 'MAX')` a los valores bloqueados con `isValueLocked`: la regla de F46 dice que todo valor que nombre `src/` va bloqueado.
4. Si no hay nada → **`UNCLASSIFIED`**.

Salida del bloque:

- `withFinalClassification` y `withoutFinalClassification`, que suman |Uₚ|;
- `categories`: `{ A, B, C, D, UNCLASSIFIED }`, que suman `withFinalClassification`;
- `aSubcategories`: `{ vaccineProduct, qualityDeviation, programmaticError, stress }`, que cuenta los casos de categoría `A` con cada `aIsRelatedTo*` en `true`. Pueden sumar más que `A`, porque un caso puede marcar varias.

Solo periodo actual. La regla se implementa **una vez**, como una expresión SQL con `CASE` en una constante del servicio, para que F67 la reutilice sin copiarla.

### 3.3 Constantes y tipos

**`src/constants/dashboard.constants.ts`** (creado en F65) añade:

- `DASHBOARD_DEFAULT_PERIOD_DAYS = 30`
- `DASHBOARD_MAX_PERIOD_DAYS = 366`
- `NOTIFICATION_CONFIG_SCOPE = 'NOTIFICATION'`
- `NOTIFICATION_DEADLINE_DAYS_CODE = 'ESAVI_NOTIFICATION_DEADLINE_DAYS'`

**`src/constants/finalClassification.constants.ts` (nuevo):** `FINAL_CLASSIFICATION_IMPORTANCE_CATALOG_CODE = 'finalClassificationImportance'`, trasladada desde `IMPORTANCE_CATALOG_CODE` (`finalClassification.service.ts:20`).

**`src/types/dashboard/dashboard.types.ts`** añade:

```ts
export interface DashboardPeriod { from: string; to: string; days: number; }

export interface DashboardComparable { current: number; previous: number; }

export interface DashboardIndicators {
    period: DashboardPeriod;
    previousPeriod: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    volume: {
        total: DashboardComparable;
        byNotificationType: { SEVERE: DashboardComparable; NON_SEVERE: DashboardComparable; none: DashboardComparable };
    };
    severity: {
        classified: DashboardComparable;
        serious: DashboardComparable;
        unclassified: DashboardComparable;
        criteria: Record<'death' | 'disability' | 'congenitalAnomaly' | 'fetalDeath' | 'lifeThreatening' | 'hospitalization' | 'abortion' | 'otherCondition', number>;
    };
    deaths: { total: DashboardComparable; autopsyRequested: number; autopsyPerformed: number };
    timeliness: { withEventDate: number; withoutEventDate: number; medianDays: number | null; onTime: number | null; deadlineDays: number | null };
    closure: { closedCases: number; medianDaysToClose: number | null; stageMedianDays: Record<CaseWorkflowStage, number | null> };
    causality: {
        withFinalClassification: number;
        withoutFinalClassification: number;
        categories: Record<'A' | 'B' | 'C' | 'D' | 'UNCLASSIFIED', number>;
        aSubcategories: Record<'vaccineProduct' | 'qualityDeviation' | 'programmaticError' | 'stress', number>;
    };
}

export interface DashboardPeriodQuery { from?: string; to?: string; geoLocationId?: string; }
```

### 3.4 Superficie HTTP

```
GET /api/dashboard/pending-work   ESAVI-DASH-006   USER        (existe, F65)
GET /api/dashboard/indicators     ESAVI-DASH-007   ANALYTICS   (nuevo)
```

Cadena: `tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getIndicators`.

### 3.5 Reglas de negocio por operación

**Validador `dashboardPeriodValidator`** (`src/validators/dashboard.validator.ts`), exportado para F67 y F68:

- `from` y `to`: `optional().isISO8601({ strict: true })`, solo fecha.
- `geoLocationId`: `optional().isUUID()`.
- Una regla `custom` que, con los valores ya resueltos (por defecto incluido), rechaza con 400: `from > to`, `to > current_date` o más de `DASHBOARD_MAX_PERIOD_DAYS` días.
- **La resolución de los valores por defecto la hace el servicio**, con `resolveDashboardPeriod(query)`, en `src/helpers/dashboardPeriod.helper.ts`. El validador llama a la misma función para comprobar los límites, así que la regla no se duplica.

**`ESAVI-DASH-007` — indicadores.** Orden:

1. `resolveDashboardPeriod(query)` → periodo actual y anterior.
2. Alcance efectivo (§3.2). Si resulta vacío, devuelve la estructura completa con ceros y medianas `null`, sin consultar.
3. Lee `ESAVI_NOTIFICATION_DEADLINE_DAYS` con `getAppConfigNumber`. Si falta o es inválida → `null` más la advertencia `esaviLog('ESAVI-DASH-007 - ESAVI_NOTIFICATION_DEADLINE_DAYS missing or invalid, onTime disabled', 'warn')`.
4. Ejecuta las agregaciones con `sequelize.query` parametrizado en `Promise.all`:
   - volumen, gravedad y defunciones en una consulta con `COUNT(*) FILTER (WHERE …)` sobre los dos periodos a la vez;
   - oportunidad;
   - cierre;
   - causalidad.
5. Cualquier otro fallo → 500 `DASH_007_FETCH_FAILED`.

**`geoLocationId` inexistente o ajeno:** no es error. Da intersección vacía → ceros con 200. El servicio **no comprueba** si la unidad existe, porque esa comprobación es justo lo que filtraría información.

**Escrituras:** ninguna. No aplica el contrato de update diferencial.

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `dashboard.indicatorsSuccess` | `message` del 200 de `ESAVI-DASH-007` |
| `dashboard.indicatorsFailed` | 500 `DASH_007_FETCH_FAILED` |
| `dashboard.invalidPeriod` | 400 del validador: `from > to`, `to` futura o rango mayor al máximo, interpolando `{{maxDays}}` |

### 3.7 Forma de la respuesta

```
{ ok, message, data: {
    period: { from, to, days }, previousPeriod: { from, to, days },
    scope: { restricted, hasAssignments, geoLocationId },
    volume:     { total: {current, previous}, byNotificationType: { SEVERE, NON_SEVERE, none } },
    severity:   { classified, serious, unclassified, criteria: { death, disability, ... } },
    deaths:     { total: {current, previous}, autopsyRequested, autopsyPerformed },
    timeliness: { withEventDate, withoutEventDate, medianDays, onTime, deadlineDays },
    closure:    { closedCases, medianDaysToClose, stageMedianDays: { CLASSIFICATION, NOTIFICATION, INVESTIGATION, FINAL_CLASSIFICATION } },
    causality:  { withFinalClassification, withoutFinalClassification, categories: { A, B, C, D, UNCLASSIFIED }, aSubcategories: { ... } }
} }
```

**Ningún `caseId`, `caseCode` ni dato de paciente.** Es la condición que permite abrirlo a `ANALYTICS`.

`scope.geoLocationId` devuelve el valor recibido. Ni confirma ni niega que la unidad exista o esté dentro del alcance.

---

## 4. Plan de implementación

Depende de que F65 esté implementado: dominio `DASH`, `dashboard.constants.ts`, `dashboard.types.ts`, rutas y `caseWorkflow.constants.ts`.

1. **Catalogar la anomalía de `investigationAutopsy`.** Abrir `DEUDA-047` en `references/TECHNICAL_DEBT.md`: la tabla no tiene `isActive` (`esaviapp.sql:1075-1092`), y los consumidores filtran por `deletedAt IS NULL`. Enlace bidireccional con este spec.
   *Verificación:* `grep -n "DEUDA-047" references/TECHNICAL_DEBT.md references/functional/specs/66-*.md` devuelve las dos referencias.

2. **Registrar la operación.** Fila `dashboard | 007 | indicadores de vigilancia de un periodo, comparados con el anterior y acotados por F49. GET /indicators, ANALYTICS` en `references/CONVENTIONS.md` §6.
   *Verificación:* `grep -n "dashboard | 007" references/CONVENTIONS.md` devuelve la fila.

3. **Constantes.**
   - Las de §3.3 se añaden a `src/constants/dashboard.constants.ts`.
   - `IMPORTANCE_CATALOG_CODE` (`finalClassification.service.ts:20`) se mueve a `src/constants/finalClassification.constants.ts` como `FINAL_CLASSIFICATION_IMPORTANCE_CATALOG_CODE`, y el servicio de F41 la importa de ahí. Es el mismo movimiento que F65 hizo con el workflow.

   *Verificación:* `grep -rn "'finalClassificationImportance'" src/` devuelve una sola línea, la de la constante; `finalClassification.test.ts` pasa sin cambios.

4. **Periodo compartido.**
   - `resolveDashboardPeriod(query)` en `src/helpers/dashboardPeriod.helper.ts`, registrado en el barrel de `helpers/`. Devuelve el periodo actual y el anterior a partir de `current_date`.
   - `dashboardPeriodValidator` en `src/validators/dashboard.validator.ts`, registrado en el barrel de `validators/`.
   - Tipos `DashboardPeriod` y `DashboardPeriodQuery`.

   *Verificación:* pruebas unitarias del helper:
   - sin parámetros → 30 días que terminan hoy;
   - solo `to=2026-03-31` → `from=2026-03-02`;
   - `from=2026-01-01&to=2026-01-31` → anterior `2025-12-01..2025-12-31`;
   - 367 días → error.

5. **Claves i18n.** Las tres de §3.6 en `es`, `en` y `nl`.
   *Verificación:* `npm run i18n:check` sale en 0.

6. **Regla de causalidad.** Constante `CAUSALITY_CATEGORY_SQL` en `src/services/dashboard.service.ts`, con la expresión `CASE` de §3.2. Se exporta para F67.
   *Verificación:* la prueba de contrato del paso 8 cubre las cuatro ramas de la regla y el empate sin prelación.

7. **`ESAVI-DASH-007` — indicadores.**
   - `getIndicatorsService(query, authUser, lang)` con los pasos 1 a 5 de §3.5;
   - controlador `getIndicators`;
   - ruta `GET /indicators` en `src/routes/dashboard.routes.ts`;
   - tipo `DashboardIndicators`.

   *Verificación:* como ADMIN, sin parámetros, responde 200 con `period.days = 30` y todos los bloques; con `?from=2026-05-01&to=2026-04-01` responde 400 con `dashboard.invalidPeriod`.

8. **Pruebas de convención.**
   - **Fixture de usuario sin roles.** En `tests/setup/auth.ts`, un usuario autenticado sin ninguna asignación en `appUserRole`, expuesto como `authHeaderWithoutRole()`. `getUserRoleLevel` (`src/helpers/roleLevel.helper.ts:4-10`) le asigna nivel `0`, y `validateUserRole` lo rechaza con 403 `AUTH_ROLE_FORBIDDEN` (`roleValidation.middleware.ts:18-22`).
   - **Invariante de la matriz.** En `tests/auth/roles.test.ts`, el 403 de una ruta con mínimo `ANALYTICS` se prueba con ese usuario. La invariante (`roles.test.ts:87-91`) pasa a «todo mínimo distinto de `ANALYTICS` tiene un rol por debajo».
   - Fila `GET /api/dashboard/indicators → ANALYTICS, ESAVI-DASH-007` en `tests/setup/routeRules.ts`, y el conteo de `ROUTE_RULES` sube en 1.
   - Escenarios de §5 en `tests/contract/dashboard.test.ts`.

   *Verificación:* `npm test -- roles dashboard finalClassification` sale en 0; el usuario sin roles recibe 403 en `/api/dashboard/indicators`.

---

## 5. Criterios de aceptación

**Superficie y roles**

- [ ] `GET /api/dashboard/indicators` responde 200 a los siete roles, desde `ANALYTICS` hasta `SUPERADMIN`; 403 `AUTH_ROLE_FORBIDDEN` al usuario autenticado sin roles; 401 sin token.
- [ ] Los puntos del código de operación coinciden: ruta, controlador, servicio, `esaviLog` y `AppError` (`DASH_007_*`).
- [ ] `roles.test.ts` prueba el 403 de las rutas con mínimo `ANALYTICS` con el usuario sin roles, y la invariante «hay un rol por debajo» sigue vigente para todos los demás mínimos.
- [ ] `grep -rn "'finalClassificationImportance'" src/` devuelve una sola línea, y `finalClassification.test.ts` pasa sin cambios.
- [ ] `DEUDA-047` está catalogada y enlazada en los dos sentidos.

**Periodo**

- [ ] Sin parámetros: `period` son los 30 días que terminan en `current_date`, y `previousPeriod` son los 30 anteriores.
- [ ] `?to=2026-03-31` → `period.from = 2026-03-02`.
- [ ] `?from=2026-01-01&to=2026-01-31` → `previousPeriod = 2025-12-01..2025-12-31`, `days = 31`.
- [ ] `from > to`, `to` futura, un rango de 367 días o una fecha mal formada → 400.
- [ ] Un caso con `reportDate = from` y otro con `reportDate = to` cuentan los dos (extremos incluidos). Uno con `reportDate = from − 1` cuenta en `previous`.

**Alcance**

- [ ] Un analista asignado al territorio A no cuenta ningún caso del B en ningún bloque.
- [ ] El mismo analista con `?geoLocationId=<B>` recibe **200 con todo a cero**, igual que con un UUID inexistente. Las dos respuestas son idénticas salvo `generatedAt`.
- [ ] Un ADMIN con `?geoLocationId=<A>` cuenta solo A y sus descendientes.
- [ ] Un analista sin asignaciones recibe 200 con ceros, medianas `null` y `scope.hasAssignments = false`.

**Volumen y gravedad**

- [ ] `volume.total.current` coincide con el `count` de `GET /api/esavi-cases?reportDateFrom=<from>&reportDateTo=<to>` del mismo usuario no administrador.
- [ ] `SEVERE + NON_SEVERE + none` es igual a `total`, en los dos periodos.
- [ ] `classified + unclassified` es igual a `total`, y `serious` es menor o igual que `classified`.
- [ ] Un caso con `causedDeath` y `causedHospitalization` en `true` suma 1 en cada uno de esos dos criterios.

**Defunciones**

- [ ] Un caso con muerte en las tres fuentes cuenta **una sola vez**.
- [ ] Tres casos, cada uno con muerte en una sola de las fuentes (`causedDeath`, `deathDate`, `isDeath`), suman 3.
- [ ] Una `investigationAutopsy` con `deletedAt` informado no cuenta, ni como muerte ni como autopsia realizada.

**Oportunidad**

- [ ] Con un plazo de 30, un caso con 30 días entre evento y reporte cuenta en `onTime` y uno con 31 no.
- [ ] Un caso sin `eventDate` suma en `withoutEventDate` y no entra en la mediana.
- [ ] Con los casos de 2, 4 y 10 días, `medianDays = 4`; con 2 y 5, `medianDays = 3.5`.
- [ ] Con la configuración del plazo desactivada y sin variable de entorno: 200, `onTime` y `deadlineDays` en `null`, el resto del bloque calculado y la advertencia `ESAVI-DASH-007` en el log.

**Cierre**

- [ ] Un caso con `reportDate` fuera del periodo, pero cerrado dentro, entra en `closure`.
- [ ] Un caso reabierto, con `closedAt` dentro del periodo pero estado distinto de `CLOSED`, no entra.
- [ ] Una etapa sin `EndedAt` no entra en su mediana. Si ninguna la tiene, `stageMedianDays.<etapa>` es `null`.

**Causalidad**

- [ ] `dIsUnclassifiable = true` → `D`, aunque tenga otros campos.
- [ ] `importanceB` con `value = '1'` y `aIsRelatedToStress = true` → `B`. La prelación manda sobre los booleanos.
- [ ] Sin prelación, `bHasDeterminantFactor = true` y `cHasCoincidentCause = true` → `B`.
- [ ] Una fila con todo en `null` → `UNCLASSIFIED`.
- [ ] `withFinalClassification + withoutFinalClassification` es igual a `volume.total.current`, y la suma de `categories` es igual a `withFinalClassification`.
- [ ] Un caso `A` con `aIsRelatedToVaccineProduct` y `aIsRelatedToStress` en `true` suma 1 en cada subcategoría.

**Datos expuestos**

- [ ] La respuesta no contiene ninguna clave `caseId`, `caseCode`, `patientId` ni ningún dato del paciente en ningún nivel. Se verifica recorriendo el JSON.
- [ ] `scope.geoLocationId` devuelve el valor recibido tal cual, sin indicar si existe.

**Sin escrituras**

- [ ] Llamar a `ESAVI-DASH-007` no modifica `updatedAt`, `appDetails` ni `sysDetails` de ninguna fila de la fixture.

**Cierre del spec**

- [ ] Las claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

No va el bloque de update diferencial, porque ninguna operación escribe sobre una fila existente.

---

## 6. Decisiones tomadas y descartadas

**Periodo**

- **Sí:** anclar en `reportDate`. Es `NOT NULL`, tiene índice y la controla el sistema. Con `eventDate`, que es anulable, los casos sin fecha de evento desaparecerían de todos los indicadores.
- **No:** un ancla elegible por query (`?dateField=`). Duplica la superficie de pruebas, y dos usuarios mirando «el mismo mes» verían cifras distintas sin saber por qué.
- **Sí:** los tiempos de cierre anclados en `closedAt`, como única excepción. Con `reportDate`, los casos recientes casi nunca están cerrados y la mediana sale sesgada hacia los casos rápidos.
- **Sí:** solo cuentan los casos actualmente `CLOSED`. Un reabierto conserva `closedAt`, pero no está cerrado, y su duración sería falsa.
- **Sí:** 30 días por defecto y 366 como máximo. El máximo protege al home de un barrido histórico completo, y 366 admite un año bisiesto.
- **Sí:** comparar con el periodo anterior de igual duración, devolviendo valores crudos.
- **No:** calcular la variación porcentual en el backend. Pasar de 0 a N no tiene un porcentaje correcto, y decidir cómo mostrarlo es tarea de la interfaz.
- **No:** comparar con el mismo periodo del año anterior. Exige un histórico suficiente y otra decisión de diseño.
- **Sí:** la resolución del periodo en un helper que comparten el validador y el servicio, para que la regla de límites no exista dos veces.

**Alcance**

- **Sí:** `ANALYTICS` acotado por territorio. Ser analista no da acceso nacional. Quien necesite el país completo recibe una asignación a la raíz en `appUserGeoLocation`, que es auditable y revocable.
- **Sí:** `geoLocationId` solo puede estrechar. Una unidad ajena o inexistente da ceros con 200.
- **No:** responder 403 o 404 a una unidad fuera del alcance. Los dos códigos confirman que la unidad existe y que el usuario no la alcanza, que es la información que F49 protege.
- **Sí:** abrir esta ruta a `ANALYTICS`, porque no devuelve ningún identificador de caso ni de paciente.

**Indicadores**

- **Sí:** defunción = cualquiera de las tres fuentes. En vigilancia, perder una muerte cuesta más que contarla con una fuente sola.
- **No:** reconciliar las tres fuentes. El dashboard cuenta; auditar la coherencia es otro proceso.
- **Sí:** el denominador de la gravedad son los casos clasificados. Los no clasificados se informan aparte y no diluyen el porcentaje.
- **Sí:** reutilizar `ESAVI_NOTIFICATION_DEADLINE_DAYS`, sembrado desde F26 y sin consumidor.
- **Sí:** si falta esa configuración, `onTime: null` y advertencia en el log, en lugar de 500. Es la misma tolerancia que F65.
- **Sí:** medianas con `percentile_cont(0.5)` y 1 decimal, `null` sin casos. Una mediana de 0 días con 0 casos sería un dato falso.
- **No:** promedios. Un solo caso atípico de 400 días deforma el promedio y no la mediana.

**Causalidad**

- **Sí:** la regla D → prelación `1` → primer bloque A/B/C con algún `true` → `UNCLASSIFIED`, validada por el equipo clínico. Es determinista y depende solo de la fila.
- **Sí:** el denominador son los casos con `finalClassification` activa. Los que no la tienen van aparte, porque la mayoría de los casos no graves nunca llegan a esa etapa.
- **Sí:** separar `UNCLASSIFIED` (la fila existe pero está vacía) de `withoutFinalClassification` (la fila no existe). Son situaciones distintas para el seguimiento.
- **Sí:** la regla vive una sola vez, como expresión SQL exportada, para que F67 no la copie.

**Pruebas**

- **Sí:** una fixture de usuario sin roles para el 403 de las rutas `ANALYTICS`.
- **No:** omitir el 403 de esas rutas. La matriz de roles perdería justo la garantía que existe para proteger.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| No hay índice sobre `caseWorkflow.closedAt` y el bloque de cierre lo recorre | El universo está acotado primero por territorio y por estado `CLOSED` (`IX_caseWorkflow_status`). Si el p95 supera 1 s, el índice `IX_caseWorkflow_closedAt` va en el spec de rendimiento que prevé F65 §7 |
| Cinco agregaciones en cada carga del home de un analista | Van en `Promise.all`, y volumen, gravedad y defunciones comparten una sola consulta con `FILTER`. Aplica la misma condición de entrada para caché que en F65 |
| La regla de causalidad se aparta del criterio clínico en un caso límite | La regla está escrita y probada rama por rama (§5), y cambiarla es un cambio de una expresión con su spec |
| Un analista nacional sin asignación ve ceros y cree que no hay casos | `scope.hasAssignments = false` viaja en la respuesta, y el frontend avisa (§8) |
| La anomalía de `investigationAutopsy` (sin `isActive`) se olvida | Queda catalogada como `DEUDA-047` |
| `current_date` del servidor de base de datos difiere del huso del usuario | Es el mismo criterio con que `reportDate` toma su valor por defecto, así que es coherente con los datos guardados |

---

## 8. Impacto en el contrato HTTP

**Aditivo.** Se añade `GET /api/dashboard/indicators`. Ninguna ruta existente cambia.

**Primera ruta abierta a `ANALYTICS`.** Hasta hoy, ese rol no alcanzaba ninguna ruta de datos.

**Notas para el spec del frontend:**

1. Los bloques comparables traen `{ current, previous }` crudos. La variación la calcula la interfaz.
2. Las medianas `null` significan «sin casos», no 0. `onTime: null` significa que el plazo no está configurado.
3. `scope.hasAssignments = false` → aviso explícito de «sin territorio asignado», también para `ANALYTICS`.
4. El selector de unidad geográfica debe ofrecer solo unidades dentro de la cobertura del usuario (`ESAVI-USERGEO-008`). Una unidad ajena devuelve ceros, no un error.
5. Los tiempos de cierre se rotulan como «casos **cerrados** en el periodo». Es el único bloque que no se refiere a los casos reportados en ese periodo.
6. La causalidad distingue «sin clasificación final» (el caso no llegó a esa etapa) de «sin clasificar» (la etapa se abrió, pero no se marcó nada).

---

## Lo que **no** está en este spec

- Series temporales, vacunas, sexo y edad, geografía, errores programáticos (SPEC F67).
- Alerta por lote (SPEC F68).
- Actividad reciente (SPEC F69).
- Ancla de periodo elegible por query.
- Variación porcentual calculada en el backend.
- Comparación interanual o con varios periodos.
- Reconciliación de las fuentes de defunción.
- Validación de coherencia entre bloques de `finalClassification`.
- Exportación de indicadores.
- Índice sobre `caseWorkflow.closedAt` y caché.
- Resolver la falta de `isActive` en `investigationAutopsy` (`DEUDA-047`).

Cada uno de esos, si aterriza, va en su propio spec.
