# SPEC F68 — Dashboard: alerta de agrupamiento por lote

> **Estado:** Aprobado
> **Depende de:** SPEC 01, SPEC 02, SPEC 04, SPEC 05, SPEC 08, **SPEC F22** (`notificationVaccine`), **SPEC F26** (`systemConfig`), **SPEC F48** (filtros del listado de casos), **SPEC F49** (alcance geográfico), **SPEC F65** (marco `DASH`, filtro `statusCode`), **SPEC F66** (periodo, universo Uₚ, regla de defunción), **SPEC F67** (clave de vacuna)
> **Fecha:** 2026-11-02
> **Objetivo:** Señalar en el home los lotes de vacuna que, dentro del periodo y del territorio del usuario, acumulan suficientes casos, casos graves o alguna defunción como para investigarlos, y permitir llegar a esos casos desde el listado.

---

## 1. Por qué existe este spec

**El agrupamiento por lote es la señal que la vigilancia ESAVI no puede dejar pasar.** Varios eventos tras vacunas del mismo lote apuntan a un problema de calidad del producto, de cadena de frío o de administración, y esas tres causas se corrigen retirando o investigando el lote. Detectarlo tarde significa seguir aplicándolo. Hoy el sistema guarda el lote de cada vacuna notificada, pero nadie lo agrega: para ver un agrupamiento, alguien tendría que abrir los casos uno por uno y comparar lotes a ojo.

**El lote se guarda tal como se escribe.** `notificationVaccine.batchNumber` (`esaviapp.sql:931`, `varchar(100)`) solo pasa por `trim()` al escribirse (F22, `notificationVaccine.service.ts:318`). `ab-123`, `AB 123` y `AB123` quedan como tres valores distintos, y un agrupamiento real se reparte en tres lotes que no alcanzan el umbral. La alerta tiene que normalizar al leer, y la regla de normalización debe ser una sola, compartida por la alerta y por el filtro del listado. Si no, la alerta diría «4 casos» y el listado mostraría 2.

**Un lote es de una vacuna.** El mismo número de lote en dos productos distintos son dos lotes distintos. La clave es vacuna + lote, con la clave de vacuna que F67 ya fijó (`W:<uuid>` para las codificadas en WHODrug y `T:<texto>` para el texto libre).

**La señal no depende de que el notificador sospechara de esa vacuna.** F67 cuenta solo las vacunas con `isSuspected = true`, porque responde «¿de qué vacuna se sospecha?». Aquí la pregunta es otra: «¿qué lotes aparecen repetidos en los ESAVI?». Un caso vacunado con dos productos, de los que solo uno se marcó como sospechoso, también aporta información sobre el lote del otro.

**El umbral es una decisión operativa.** Cuántos casos o cuántos graves justifican una alerta lo decide el programa, y puede cambiar sin desplegar. Va en `systemConfig`, con dos parámetros. La defunción no lleva umbral: una sola dispara la alerta.

**Una alerta tiene que llevar a sus casos, sin abrirlos a quien no debe verlos.** La alerta se abre a `ANALYTICS`, así que no trae `caseId`. Para seguirla, el listado de casos (`ESAVI-CASE-002A`/`002B`) gana el filtro `?batchNumber=` con `?vaccineKey=` opcional, con la misma normalización. El mismo patrón que `?statusCode=` en F65: quien tiene rol de lectura de casos llega a ellos; el analista ve la señal.

**Una vacuna caducada explica un agrupamiento.** `notificationVaccine` guarda `vaccinationDate` y `expirationDate`. Contar en cada lote cuántos casos se vacunaron después de la caducidad convierte la alerta en una pista de causa, sin consultas adicionales.

---

## 2. Alcance

**Dentro:**

- **Normalización del lote al leer, compartida por el dominio.** Una sola expresión SQL, `upper(regexp_replace(batchNumber, '[^A-Za-z0-9]', '', 'g'))`, en `src/constants/notificationVaccine.constants.ts`. Si el resultado es vacío, se trata como «sin lote». En el mismo archivo pasa a vivir la clave de vacuna de F67 (§3.2).
- **`ESAVI-DASH-010` — alertas por lote.** `GET /api/dashboard/batch-alerts`, rol mínimo `ANALYTICS`, con `dashboardPeriodValidator` (F66).
  - **Base:** las filas activas de `notificationVaccine` de los casos de Uₚ, **todas**, estén o no marcadas como sospechosas.
  - **Clave:** vacuna + lote normalizado.
  - **Regla de alerta:** un lote entra si se cumple **cualquiera** de estas condiciones:
    - casos ≥ `ESAVI_DASHBOARD_BATCH_MIN_CASES` (por defecto 3);
    - graves ≥ `ESAVI_DASHBOARD_BATCH_MIN_SERIOUS` (por defecto 2);
    - al menos una defunción, con la regla de las tres fuentes de F66.
  - **Umbrales:**
    - un umbral **menor que 1 desactiva su criterio**;
    - si una configuración **falta o es inválida**, se usa su valor por defecto y se registra una advertencia;
    - la defunción siempre dispara la alerta.
  - **Por alerta:**
    - la vacuna (`vaccineKey`, `label`, `coded`), el lote normalizado y hasta 5 variantes tal como se escribieron;
    - `cases`, `suspectedCases`, `serious`, `deaths` y `expiredAtVaccination`;
    - `firstReportDate` y `lastReportDate`;
    - el número de establecimientos y de unidades geográficas distintas;
    - las fechas de caducidad distintas registradas;
    - `reasons`: el motivo o los motivos que dispararon la alerta.
  - **Lista:** como máximo 50 alertas, ordenadas por defunciones, graves y casos, todos descendentes. Además: `total` de alertas, `batchesEvaluated`, `casesWithoutBatch` y los umbrales efectivos aplicados.
- **Configuraciones** `ESAVI_DASHBOARD_BATCH_MIN_CASES` (3) y `ESAVI_DASHBOARD_BATCH_MIN_SERIOUS` (2), scope `DASHBOARD`, sembradas en `systemConfig.defaults.ts`.
- **Filtro `?batchNumber=` con `?vaccineKey=` opcional en `ESAVI-CASE-002A` y `002B`:**
  - `batchNumber` se normaliza con la misma regla. Si queda vacío → 400;
  - `vaccineKey` acepta `W:<uuid>` o `T:<texto>`. Un formato inválido → 400;
  - por dentro es una subconsulta `EXISTS` sobre `notification → notificationVaccine` activas. No altera la forma de las filas ni infla el `count`;
  - se combina con `statusCode` (F65), con los filtros de F48 y con el alcance de F49.
- Claves i18n, filas en `ROUTE_RULES` y casos nuevos en `tests/contract/dashboard.test.ts` y `esaviCase.test.ts`.

**Nota para el frontend:**

> Cada alerta trae `vaccineKey` y `batchNumber` listos para el enlace `GET /api/esavi-cases?batchNumber=<batchNumber>&vaccineKey=<vaccineKey>`, que solo pueden abrir los roles `USER` y superiores. Para `ANALYTICS`, la alerta no es pulsable.
>
> `reasons` explica por qué salta cada alerta, y `thresholds` dice qué umbrales se aplicaron. Un umbral `null` significa que ese criterio está desactivado.
>
> Un usuario restringido ve el agrupamiento **solo dentro de su territorio**. Un lote distribuido en todo el país puede no alcanzar el umbral en su territorio y sí alcanzarlo a nivel nacional. Conviene rotular la lista como «lotes con alerta en su territorio».

**Fuera de alcance (otros specs, o descartado):**

- Lotes de diluyente (`notificationDiluent.batchNumber`). Se decidió no incluirlos.
- Normalizar el lote **al escribir**, o migrar los lotes ya guardados. Cambiaría el contrato de F22 y los datos históricos.
- Avisos, correos o notificaciones push cuando salta una alerta.
- Alertas con estado (vista, en investigación, descartada). Eso exige una tabla nueva y un flujo propio.
- Comparar con lotes de otros países o con un registro de lotes retirados.
- Detección estadística de agrupamientos (tasas por dosis aplicadas, ventanas deslizantes). No hay denominador de dosis administradas en el esquema.
- Agrupar lotes por similitud difusa. Solo se normalizan mayúsculas y caracteres no alfanuméricos.
- Devolver `caseId` en la alerta.
- Actividad reciente (SPEC F69).

---

## 3. Modelo de datos

**No hay tablas, columnas, modelos, asociaciones ni índices nuevos.** Solo se lee.

### 3.1 Columnas consultadas

Además de las de F66 §3.1, que se reutilizan para el universo, los graves y las defunciones:

| Tabla | DDL | Columnas | Vigencia | Papel |
|---|---|---|---|---|
| `notificationVaccine` | `:919-942` | `notificationId`, `vaccineWhodrugId`, `vaccineName`, `isSuspected`, `batchNumber` (`:931`, `varchar(100)`), `vaccinationDate`, `expirationDate` | `isActive` | Base de la alerta |
| `notification` | `:803` | `notificationId`, `caseId` | `isActive` | Puente caso → vacuna |
| `vaccineWhodrug` | `:604` | `drugName` | — | Etiqueta de la vacuna |
| `esaviCase` | `:725` | `healthFacilityId`, `reportDate` | (U) | Establecimientos y fechas |
| `healthFacility` | `:476` | `geoLocationId` | — | Unidades distintas |

`notificationVaccine` es uno a muchos con el caso. Todo conteo por caso usa `COUNT(DISTINCT caseId)`.

### 3.2 Definiciones

**Normalización del lote.**

- En SQL: `upper(regexp_replace(nv."batchNumber", '[^A-Za-z0-9]', '', 'g'))`.
- En JS (para el parámetro del listado): `value.toUpperCase().replace(/[^A-Z0-9]/g, '')`.

Las dos producen lo mismo. Una letra fuera de `A–Z`, como `Ñ` o una vocal con tilde, se elimina en ambas. Un lote nulo, o vacío tras normalizar, es «sin lote».

**Clave de vacuna.** La de F67 §3.2: `W:<vaccineWhodrugId>` si existe, si no `T:<upper(trim(vaccineName))>`, con `T:` cuando el nombre es nulo o vacío.

**Ubicación compartida de las dos expresiones.** Van en `src/constants/notificationVaccine.constants.ts`, porque las usan tanto `dashboard.service.ts` como `esaviCase.service.ts`, y un servicio no importa a otro para conseguir una regla:

- `BATCH_NUMBER_NORMALIZED_SQL(alias)`;
- `VACCINE_KEY_SQL(alias)`;
- `normalizeBatchNumber(value)`.

Si F67 ya está implementado, su expresión de clave se mueve aquí.

**Universo del lote.** Para cada par (`vaccineKey`, `batchNumber` normalizado) no vacío, las filas activas de `notificationVaccine` de casos de Uₚ, estén o no marcadas como sospechosas.

**Métricas por lote:**

| Campo | Definición |
|---|---|
| `cases` | `COUNT(DISTINCT caseId)` |
| `suspectedCases` | Casos con alguna fila de ese lote en `isSuspected = true` |
| `serious` | Casos del lote con `classification.isSeriousEvent = true` |
| `deaths` | Casos del lote que cumplen la regla de defunción de F66 (`causedDeath`, `deathDate` o `investigationAutopsy.isDeath`) |
| `expiredAtVaccination` | Casos con alguna fila del lote en la que `vaccinationDate > expirationDate`, ambas informadas |
| `firstReportDate` / `lastReportDate` | `min` y `max` de `reportDate` |
| `facilities` | `COUNT(DISTINCT healthFacilityId)` |
| `geoUnits` | `COUNT(DISTINCT healthFacility.geoLocationId)`, sin contar los nulos |
| `variants` | Hasta 5 valores distintos de `trim(batchNumber)`, en orden alfabético |
| `expirationDates` | Valores distintos de `expirationDate` no nulos, en orden ascendente |
| `label`, `coded` | Como en F67 |

**Umbrales efectivos.** Para cada uno de `ESAVI_DASHBOARD_BATCH_MIN_CASES` y `ESAVI_DASHBOARD_BATCH_MIN_SERIOUS`:

- se lee con `getAppConfigNumber`;
- si falta o es inválido: su valor por defecto (3 o 2) y la advertencia `esaviLog('ESAVI-DASH-010 - <code> missing or invalid, default <n> applied', 'warn')`;
- si es menor que 1: el criterio queda desactivado y su umbral efectivo es `null`.

**Regla de alerta.** Un lote es alerta si se cumple al menos una de estas condiciones, y cada una que se cumpla añade su motivo a `reasons`:

| Condición | Motivo |
|---|---|
| `minCases` no es `null` y `cases >= minCases` | `MIN_CASES` |
| `minSerious` no es `null` y `serious >= minSerious` | `MIN_SERIOUS` |
| `deaths >= 1` | `DEATH` |

**Orden y límite.** `deaths DESC, serious DESC, cases DESC, lastReportDate DESC, batchNumber ASC`. Se devuelven como máximo `DASHBOARD_BATCH_ALERT_LIMIT` (50). `total` es el número real de alertas, antes de aplicar el límite.

**Contadores globales.**

- `batchesEvaluated`: número de pares (vacuna, lote) no vacíos en el periodo.
- `casesWithoutBatch`: casos de Uₚ que no tienen ninguna fila activa con un lote no vacío tras normalizar. Incluye los casos sin vacunas.

**Filtro del listado de casos.** Con `batchNumber` (y `vaccineKey` opcional), `002A`/`002B` añaden a su `where` una condición `EXISTS`, construida con `sequelize.literal` y sus valores en `replacements`, nunca interpolados:

```
EXISTS (SELECT 1 FROM "notification" n JOIN "notificationVaccine" nv ON nv."notificationId" = n."notificationId"
        WHERE n."caseId" = "EsaviCase"."caseId" AND n."isActive" AND nv."isActive"
          AND <BATCH_NUMBER_NORMALIZED_SQL(nv)> = :batchNumber
          [AND <VACCINE_KEY_SQL(nv)> = :vaccineKey])
```

Para el mismo usuario, periodo (`reportDateFrom`/`reportDateTo`) y alcance, el `count` del listado es igual al `cases` de la alerta.

### 3.3 Constantes y tipos

**`src/constants/notificationVaccine.constants.ts` (nuevo):** `BATCH_NUMBER_NORMALIZED_SQL`, `VACCINE_KEY_SQL` y `normalizeBatchNumber`, descritas en §3.2, más `VACCINE_KEY_PATTERN = /^(W:[0-9a-f-]{36}|T:.*)$/i`.

**`src/constants/dashboard.constants.ts`** añade:

- `DASHBOARD_BATCH_ALERT_LIMIT = 50`
- `DASHBOARD_BATCH_MIN_CASES_CODE = 'ESAVI_DASHBOARD_BATCH_MIN_CASES'` y `DASHBOARD_BATCH_MIN_CASES_DEFAULT = 3`
- `DASHBOARD_BATCH_MIN_SERIOUS_CODE = 'ESAVI_DASHBOARD_BATCH_MIN_SERIOUS'` y `DASHBOARD_BATCH_MIN_SERIOUS_DEFAULT = 2`

**`src/types/dashboard/dashboard.types.ts`** añade:

```ts
export type DashboardBatchAlertReason = 'MIN_CASES' | 'MIN_SERIOUS' | 'DEATH';

export interface DashboardBatchAlert {
    vaccineKey: string; label: string | null; coded: boolean;
    batchNumber: string; variants: string[];
    cases: number; suspectedCases: number; serious: number; deaths: number; expiredAtVaccination: number;
    firstReportDate: string; lastReportDate: string;
    facilities: number; geoUnits: number; expirationDates: string[];
    reasons: DashboardBatchAlertReason[];
}

export interface DashboardBatchAlerts {
    period: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    thresholds: { minCases: number | null; minSerious: number | null };
    total: number; batchesEvaluated: number; casesWithoutBatch: number;
    alerts: DashboardBatchAlert[];
}
```

El tipo de filtros del listado de casos gana `batchNumber?: string` y `vaccineKey?: string`.

### 3.4 Superficie HTTP

```
GET /api/dashboard/batch-alerts   ESAVI-DASH-010    ANALYTICS   (nuevo)
GET /api/esavi-cases              ESAVI-CASE-002A   USER        (existe, gana ?batchNumber y ?vaccineKey)
GET /api/esavi-cases/admin        ESAVI-CASE-002B   ADMIN       (existe, gana ?batchNumber y ?vaccineKey)
```

Cadena de `010`: `tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getBatchAlerts`.

### 3.5 Reglas de negocio por operación

**`ESAVI-DASH-010` — alertas por lote.**

1. Periodo con `resolveDashboardPeriod`, sin periodo anterior.
2. Alcance efectivo, como en F66. Si es vacío → estructura con ceros, `alerts: []` y los umbrales efectivos.
3. Umbrales efectivos (§3.2).
4. Dos consultas parametrizadas en `Promise.all`:
   - **alertas:** `GROUP BY` sobre la clave, con `HAVING` sobre la regla. Los umbrales viajan como `CAST(:minCases AS int)`, que admite `NULL`. Lleva `COUNT(*) OVER ()` para `total`, y `LIMIT`;
   - **contadores globales:** `batchesEvaluated` y `casesWithoutBatch`.

   `reasons` se calcula en el servicio a partir de las métricas, para que la regla no viva en dos lenguajes.
5. Cualquier fallo → 500 `DASH_010_FETCH_FAILED`.

**`ESAVI-CASE-002A` / `002B` — filtro por lote.**

- *Validador:*
  - `query('batchNumber').optional().isString().isLength({ max: 100 })`, más una regla `custom` que rechaza con 400 si `normalizeBatchNumber(value)` queda vacío;
  - `query('vaccineKey').optional().matches(VACCINE_KEY_PATTERN)`;
  - `vaccineKey` sin `batchNumber` → 400.
- *Servicio:* si viaja `batchNumber`, añade la condición `EXISTS` de §3.2. Sin `batchNumber`, la consulta queda exactamente igual que hoy.

**Escrituras:** la única es la siembra de los dos umbrales por el `ESAVI-SYSCONF-008` existente, que es solo de alta (F26). Ninguna operación de este spec escribe sobre una fila existente, así que no aplica el contrato de update diferencial.

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `dashboard.batchAlertsSuccess` | 200 de `ESAVI-DASH-010` |
| `dashboard.batchAlertsFailed` | 500 `DASH_010_FETCH_FAILED` |

Los 400 de los filtros del listado usan los mensajes del validador, como el resto de filtros de F48 y F65. Los motivos de `reasons` viajan como códigos.

### 3.7 Forma de la respuesta

```
{ ok, message, data: {
    period, scope,
    thresholds: { minCases, minSerious },              // null = criterio desactivado
    total, batchesEvaluated, casesWithoutBatch,
    alerts: [ {
        vaccineKey, label, coded, batchNumber, variants: [ ... ],
        cases, suspectedCases, serious, deaths, expiredAtVaccination,
        firstReportDate, lastReportDate, facilities, geoUnits, expirationDates: [ ... ],
        reasons: [ "DEATH", "MIN_SERIOUS", ... ]
    } ]
} }
```

**Ningún identificador de caso ni de paciente.** Los números de lote no son datos personales.

---

## 4. Plan de implementación

Depende de que F65, F66 y F67 estén implementados: dominio `DASH`, periodo compartido, regla de defunción, clave de vacuna y fixture de usuario sin roles.

1. **Registrar la operación.** Fila `dashboard | 010 | alertas de agrupamiento por lote: vacuna + lote normalizado, por casos, graves o defunción, acotadas por F49. GET /batch-alerts, ANALYTICS` en `references/CONVENTIONS.md` §6.
   *Verificación:* `grep -n "dashboard | 010" references/CONVENTIONS.md` devuelve la fila.

2. **Expresiones compartidas.** Crear `src/constants/notificationVaccine.constants.ts` con `BATCH_NUMBER_NORMALIZED_SQL`, `VACCINE_KEY_SQL`, `normalizeBatchNumber` y `VACCINE_KEY_PATTERN`. `dashboard.service.ts` (F67) deja de definir su clave de vacuna y la importa de aquí. Sin cambio de comportamiento.
   *Verificación:* `ESAVI-DASH-009` devuelve las mismas `key` que antes del cambio; el resto de la suite de `dashboard` pasa sin modificarse. Prueba unitaria: `normalizeBatchNumber(' ab-12.3 ') === 'AB123'` y `normalizeBatchNumber('--') === ''`.

3. **Configuración de umbrales.** Constantes de §3.3 en `dashboard.constants.ts`, y dos entradas en `src/data/systemConfig.defaults.ts`:
   - `ESAVI_DASHBOARD_BATCH_MIN_CASES`, valor 3;
   - `ESAVI_DASHBOARD_BATCH_MIN_SERIOUS`, valor 2;
   - las dos con `valueType: 'number'`, `scope: 'DASHBOARD'`, `isEditable: true`, y una descripción en español que dice que un valor menor que 1 desactiva el criterio.

   *Verificación:* `POST /api/system-configs/sync` crea las dos filas; una segunda llamada crea 0.

4. **Filtro por lote en `ESAVI-CASE-002A` y `002B`.** Validador, tipo de filtros y condición `EXISTS` en el constructor de la consulta compartido por los dos listados. Casos nuevos en `tests/contract/esaviCase.test.ts`.
   *Verificación:*
   - `?batchNumber=ab-123` devuelve los casos con lote `AB 123` y `AB123`;
   - `?vaccineKey=W:<uuid>` sin `batchNumber` → 400; `?batchNumber=--` → 400;
   - sin los parámetros, la respuesta es idéntica a la de antes del cambio.

5. **Tipos e i18n.** Tipos de §3.3 y las dos claves de §3.6 en `es`, `en` y `nl`.
   *Verificación:* `npm run build` y `npm run i18n:check` salen en 0.

6. **`ESAVI-DASH-010` — alertas por lote.** `getBatchAlertsService(query, authUser, lang)`, controlador `getBatchAlerts` y ruta `GET /batch-alerts`.
   *Verificación:* con una fixture de 3 casos del mismo lote escrito de tres formas, como ADMIN, aparece una alerta con `cases = 3`, `reasons = ['MIN_CASES']` y tres `variants`. El listado filtrado con su `batchNumber` y su `vaccineKey` devuelve `count = 3`.

7. **Pruebas de convención.** Fila `GET /api/dashboard/batch-alerts → ANALYTICS, ESAVI-DASH-010` en `tests/setup/routeRules.ts` (conteo +1), y los escenarios de §5 en `tests/contract/dashboard.test.ts`.
   *Verificación:* `npm test -- roles dashboard esaviCase` sale en 0.

---

## 5. Criterios de aceptación

**Superficie y roles**

- [ ] `GET /api/dashboard/batch-alerts` responde 200 a los siete roles, 403 `AUTH_ROLE_FORBIDDEN` al usuario sin roles y 401 sin token.
- [ ] Los puntos del código de operación coinciden (`DASH_010_*`).
- [ ] `grep -rn "regexp_replace" src/services/` no devuelve resultados. La normalización solo vive en `notificationVaccine.constants.ts`.

**Normalización y clave**

- [ ] Tres casos con lote `ab-123`, `AB 123` y `AB.123` de la misma vacuna forman **una** alerta con `batchNumber = 'AB123'` y tres `variants`.
- [ ] El mismo lote `AB123` en dos vacunas distintas forma dos lotes distintos.
- [ ] Un lote `"--"` o vacío no forma ningún lote y su caso suma en `casesWithoutBatch`.
- [ ] Una vacuna con `isSuspected = false` cuenta en `cases` y no en `suspectedCases`.
- [ ] Un caso con el mismo lote en dos filas cuenta 1 en `cases`.

**Regla y umbrales**

- [ ] Con los valores por defecto (3 y 2): un lote con 3 casos no graves → alerta `['MIN_CASES']`; con 2 casos, ambos graves → `['MIN_SERIOUS']`; con 1 caso y una defunción → `['DEATH']`.
- [ ] Un lote con 2 casos, uno grave y sin defunciones, no es alerta, pero sí cuenta en `batchesEvaluated`.
- [ ] Un lote que cumple los tres criterios trae los tres motivos.
- [ ] Con `ESAVI_DASHBOARD_BATCH_MIN_CASES = 0`: `thresholds.minCases = null`, ningún lote salta por `MIN_CASES`, y los demás criterios siguen activos.
- [ ] Con las dos configuraciones desactivadas en `systemConfig` y sin variable de entorno: responde 200 con `thresholds = { minCases: 3, minSerious: 2 }` y deja dos advertencias `ESAVI-DASH-010` en el log.
- [ ] Una defunción por cualquiera de las tres fuentes de F66 dispara `DEATH`, aunque los dos umbrales estén desactivados.

**Métricas**

- [ ] Un caso con `vaccinationDate = 2026-03-10` y `expirationDate = 2026-03-01` suma en `expiredAtVaccination`; con `expirationDate` nula no suma.
- [ ] `facilities` y `geoUnits` cuentan valores distintos. Un establecimiento sin `geoLocationId` suma en `facilities` y no en `geoUnits`.
- [ ] `firstReportDate` y `lastReportDate` son el mínimo y el máximo de `reportDate` del lote.
- [ ] `variants` tiene como máximo 5 elementos, en orden alfabético.

**Orden y límite**

- [ ] Una alerta con una defunción y 1 caso va antes que otra con 0 defunciones y 10 casos.
- [ ] Con 55 lotes en alerta, `alerts` trae 50 y `total = 55`.

**Filtro del listado**

- [ ] `GET /api/esavi-cases?batchNumber=<b>&vaccineKey=<k>`, con el mismo periodo (`reportDateFrom`/`reportDateTo`) y el mismo usuario restringido, devuelve un `count` igual al `cases` de la alerta.
- [ ] `?batchNumber=ab 123` encuentra los casos con lote `AB-123`.
- [ ] Un caso con dos vacunas del mismo lote aparece una sola vez en el listado, y el `count` no se infla.
- [ ] `?vaccineKey=W:<uuid>` sin `batchNumber` → 400. `?vaccineKey=X:foo` → 400. `?batchNumber=---` → 400.
- [ ] `batchNumber` combinado con `statusCode` (F65) y con `geoLocationId` (F48) da la intersección.
- [ ] Sin `batchNumber`, la respuesta de `002A` y `002B` es idéntica a la de antes del spec.

**Alcance y datos expuestos**

- [ ] Un usuario restringido al territorio A no ve casos del B en ninguna métrica de ningún lote. Un lote con 2 casos en A y 2 en B no es alerta para él y sí lo es para un ADMIN.
- [ ] Con `?geoLocationId=<B>` o con un UUID inexistente: 200, `alerts: []` y contadores a 0, con respuestas idénticas.
- [ ] La respuesta no contiene `caseId`, `caseCode`, `patientId` ni datos del paciente en ningún nivel.

**Sin escrituras**

- [ ] Llamar a `010` y al listado filtrado no modifica `updatedAt`, `appDetails` ni `sysDetails` de ninguna fila.

**Cierre**

- [ ] Las claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

No va el bloque de update diferencial, porque ninguna operación escribe sobre una fila existente.

---

## 6. Decisiones tomadas y descartadas

**Clave y normalización**

- **Sí:** la clave es vacuna + lote. El mismo número de lote en dos productos son dos lotes físicos distintos.
- **Sí:** normalizar al leer con mayúsculas y quitando todo lo que no sea alfanumérico. Agrupa los errores de tipeo más habituales (guiones, espacios, puntos, minúsculas) sin inventar coincidencias.
- **No:** normalizar al escribir o migrar los lotes guardados. Cambiaría el contrato de F22 y reescribiría datos históricos. Normalizar al leer da el mismo agrupamiento sin tocar nada.
- **No:** agrupar por similitud difusa (`AB123` frente a `AB128`). Dos lotes que se parecen pueden ser lotes distintos, y fusionarlos fabrica una alerta falsa.
- **Sí:** devolver hasta 5 `variants`, para que quien investiga vea cómo se escribió el lote y pueda corregir el origen.
- **Sí:** la normalización y la clave de vacuna viven en `src/constants/notificationVaccine.constants.ts`, porque las usan dos servicios. Si la alerta y el listado normalizaran distinto, sus conteos no cuadrarían.

**Base de la alerta**

- **Sí:** todas las vacunas notificadas, no solo las sospechosas. La señal es sobre el lote, y `suspectedCases` conserva la información de la sospecha.
- **No:** incluir lotes de diluyente, por decisión del programa.
- **Sí:** el ancla `reportDate` y el periodo de F66, para que la alerta cuadre con los demás bloques del home y con el listado filtrado.

**Regla**

- **Sí:** se alerta si se cumple cualquiera de los tres criterios. Un lote con dos casos graves merece atención aunque no llegue al mínimo de casos.
- **Sí:** la defunción sin umbral. Una sola muerte asociada a un lote justifica revisarlo.
- **Sí:** los umbrales en `systemConfig`, porque son operativos y pueden cambiar sin desplegar, con historial.
- **Sí:** un umbral menor que 1 desactiva su criterio, como en F65.
- **Sí:** si falta una configuración, se aplica su valor por defecto en vez de desactivar el criterio. Aquí se aparta de F65 a propósito: perder una alerta de seguridad cuesta más que mostrar un falso positivo.
- **Sí:** `reasons` se calcula en el servicio y no en SQL, para que la regla no se escriba dos veces en dos lenguajes. El `HAVING` solo filtra.
- **No:** una detección estadística basada en tasas por dosis aplicadas. El esquema no tiene dosis administradas por lote, así que no hay denominador.

**Seguimiento**

- **Sí:** abrir la alerta a `ANALYTICS` sin `caseId`, y llegar a los casos por el listado filtrado, que exige `USER`. El analista ve la señal, y quien lee casos los abre.
- **No:** incluir `caseId` en la alerta, porque cerraría la alerta a `ANALYTICS` o expondría identificadores a un rol que no los lee.
- **Sí:** `vaccineKey` opcional en el listado, pero nunca sin `batchNumber`. Filtrar solo por vacuna es otra funcionalidad, que no se pidió.
- **Sí:** `EXISTS` y no un join, para que un caso con dos filas del mismo lote no se duplique ni infle el `count`.
- **No:** alertas con estado (vista, descartada). Necesitan una tabla y un flujo propio.

**Contenido de la alerta**

- **Sí:** `expiredAtVaccination`, una pista de causa sin coste adicional.
- **Sí:** `facilities` y `geoUnits`. Un lote con 5 casos en un solo establecimiento sugiere un error local; repartido en 5 provincias, un problema del producto.
- **Sí:** 50 alertas como máximo, con `total`. Más de 50 lotes en alerta indica que los umbrales están mal calibrados, no que el home deba mostrarlos todos.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| La normalización con `regexp_replace` impide usar índices en el `EXISTS` del listado | Antes de normalizar, la subconsulta ya está acotada por `caseId` y por las filas activas de la notificación del caso. El coste crece con las vacunas por caso, no con la tabla |
| Un usuario restringido no ve un agrupamiento nacional, porque el lote no alcanza el umbral en su territorio | Es la regla de F49 y está declarada. El ADMIN, o un usuario asignado a la raíz del país, ve el agrupamiento completo. El frontend rotula la lista como «en su territorio» |
| La normalización fusiona dos lotes reales que solo difieren en un separador (`AB-12` y `AB12`) | Es improbable en los códigos de fabricante. `variants` lo hace visible, y quien investiga lo descarta |
| Las letras fuera de `A–Z` (`Ñ`, vocales con tilde) se eliminan y dos lotes pueden colapsar | Los códigos de lote de fabricante no las usan. Las dos normalizaciones lo hacen igual, así que alerta y listado cuadran |
| Umbrales demasiado bajos inundan el home | Hay 50 como máximo, más `total`, y los umbrales son editables en `systemConfig` |
| Mover la clave de vacuna a `constants` rompe F67 | El paso 2 no cambia el comportamiento y se verifica contra las `key` existentes de `ESAVI-DASH-009` |

---

## 8. Impacto en el contrato HTTP

**Aditivo.** Se añade `GET /api/dashboard/batch-alerts`. `GET /api/esavi-cases` y `/admin` ganan `?batchNumber=` y `?vaccineKey=`.

**Cambios de comportamiento sobre rutas existentes:** dos parámetros, que hasta ahora se ignoraban, pueden responder 400: un `batchNumber` que queda vacío al normalizar, y un `vaccineKey` sin `batchNumber` o con un formato inválido. No hay constancia de clientes que los envíen.

**Notas para el spec del frontend:**

1. Para `USER` y superiores, cada alerta enlaza a `GET /api/esavi-cases?batchNumber=<batchNumber>&vaccineKey=<vaccineKey>&reportDateFrom=<from>&reportDateTo=<to>`, con los valores tal como llegan. Para `ANALYTICS`, la alerta no es pulsable.
2. `reasons` es una lista de códigos (`MIN_CASES`, `MIN_SERIOUS`, `DEATH`) que se localizan en la interfaz. `DEATH` merece el énfasis visual más alto.
3. `thresholds` con `null` significa criterio desactivado. Conviene mostrar los umbrales aplicados junto a la lista.
4. La lista se rotula como «lotes con alerta **en su territorio**». Un usuario restringido no ve agrupamientos que solo se forman a nivel nacional.
5. `variants` muestra cómo se escribió el lote. Si hay más de una, conviene destacarlo como un problema de calidad del dato.
6. `total > alerts.length` significa que hay más de 50 alertas. Se muestra el aviso, sin paginar.

---

## Lo que **no** está en este spec

- Lotes de diluyente.
- Normalizar el lote al escribir o migrar los guardados.
- Agrupación difusa de lotes.
- Avisos, correos o notificaciones push.
- Alertas con estado o seguimiento.
- Tasas por dosis aplicadas o detección estadística.
- Registro externo de lotes retirados.
- `caseId` en la alerta.
- Filtrar el listado de casos solo por vacuna.
- Actividad reciente (SPEC F69).

Cada uno de esos, si aterriza, va en su propio spec.
