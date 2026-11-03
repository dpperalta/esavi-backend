# SPEC F67 — Dashboard: series y distribuciones

> **Estado:** Implementado
> **Depende de:** SPEC 01, SPEC 02, SPEC 04, SPEC 05, SPEC 08, **SPEC F09** (`classification`, edad), **SPEC F22** (`notificationVaccine`), **SPEC F38** (`investigationColdChain`), **SPEC F39** (`investigationAdministrationError`), **SPEC F49** (alcance geográfico), **SPEC F65** (marco `DASH`), **SPEC F66** (periodo, filtro geográfico y universo Uₚ)
> **Fecha:** 2026-11-02
> **Objetivo:** Dar al home la curva epidemiológica semanal del periodo y la distribución de sus casos por vacuna sospechosa, sexo y edad, unidad geográfica y fallo programático, con el mismo universo y el mismo alcance que los indicadores de F66.

---

## 1. Por qué existe este spec

**F66 dice cuántos; falta decir cuándo, con qué, a quién y dónde.** Un total de casos del periodo no muestra si hay un brote en curso, si se concentran en una vacuna, en un grupo de edad o en un cantón, ni si detrás hay errores de administración o de cadena de frío. Estas son las preguntas que hace un epidemiólogo frente a un ESAVI, y hoy ninguna se puede responder por API sin descargar los casos uno a uno.

**La curva tiene que hablar el idioma de la vigilancia.** Los boletines de la región agrupan por semana epidemiológica OPS: de domingo a sábado, y la semana 1 es la primera que tiene al menos cuatro días del año nuevo. Una curva por semana ISO, o por mes calendario, no se puede comparar con los boletines nacionales. Este spec fija esa definición para todo el dominio `DASH`.

**Los totales tienen que cuadrar entre specs.** Si la curva sumara un número distinto de `volume.total` de F66 para el mismo periodo y el mismo usuario, el home mostraría dos verdades. Por eso F67 reutiliza el universo Uₚ de F66 (ancla `reportDate`), su validador de periodo y su filtro `geoLocationId`.

**Cada distribución necesita una regla que hoy no existe.**

- **Vacuna:** `notificationVaccine` guarda unas vacunas codificadas contra WHODrug (`vaccineWhodrugId`) y otras solo con texto libre (`vaccineName`), y un caso puede tener varias vacunas sospechosas.
- **Edad:** `classification` guarda la edad en tres unidades (`YEARS`, `MONTHS`, `DAYS`), y las bandas tienen que ser las que usa el programa de inmunizaciones.
- **Geografía:** un caso se ubica en el árbol de `geoLocation` a través de su establecimiento, y las filas dependen de qué unidad se esté mirando.
- **Fallos programáticos:** están repartidos en catorce columnas de dos tablas, con tipos mixtos (`boolean` y el enum `answerOption`).

Este spec fija cada una de esas reglas para que el frontend no las invente.

**Dos tablas más sin `isActive`.** `investigationAdministrationError` e `investigationColdChain` repiten la anomalía que F66 encontró en `investigationAutopsy`. Este spec amplía [DEUDA-047](../../TECHNICAL_DEBT.md#deuda-047) para cubrir las tres tablas satélite 1:1 de la investigación.

---

## 2. Alcance

**Dentro:**

- **Semana epidemiológica OPS como definición del dominio `DASH`:**
  - va de domingo a sábado;
  - la semana 1 de un año epidemiológico es la que contiene al menos cuatro días de ese año, es decir, la que contiene su primer miércoles;
  - la etiqueta es `YYYY-SENN` con el año epidemiológico, que puede no coincidir con el año civil de los primeros o últimos días de enero o diciembre.

  Se implementa una sola vez, en `src/helpers/epiWeek.helper.ts`.

- **`ESAVI-DASH-008` — curva epidemiológica.** `GET /api/dashboard/epi-curve`, rol mínimo `ANALYTICS`, con `dashboardPeriodValidator` (F66).
  - Una fila por semana epidemiológica que toca el periodo, **continua**: las semanas sin casos vienen con 0.
  - Los casos de Uₚ se agrupan por la semana de su `reportDate`, desglosados en graves, no graves y sin clasificar.
  - Las semanas de los extremos que el periodo cubre solo en parte llevan `partial: true` y solo cuentan los días dentro del periodo.
  - La suma de la curva es igual a `volume.total.current` de F66.

- **`ESAVI-DASH-009` — distribuciones.** `GET /api/dashboard/distributions`, rol mínimo `ANALYTICS`, con el mismo validador y el mismo universo Uₚ. Cuatro bloques:
  - **Vacunas sospechosas:** filas de `notificationVaccine` activas con `isSuspected = true`.
    - Se agrupan por `vaccineWhodrugId` (con `drugName`) o, si no hay, por `upper(trim(vaccineName))`, con `coded: false`.
    - Cuenta casos distintos, y en cada vacuna cuántos fueron graves.
    - Top 10 más una fila `others`, y aparte el número de casos sin ninguna vacuna sospechosa.
  - **Sexo y edad:** matriz de las nueve bandas de edad por los cuatro valores de sexo (`FEMALE`, `MALE`, `UNKNOWN`, `NONE`).
  - **Geografía:** hijos directos de la unidad de referencia, con `geoLocationId`, `name`, `latitude`, `longitude`, `total` y `serious`. Sin `geoPolygon`.
  - **Fallos programáticos:**
    - seis indicadores de administración y seis de cadena de frío, cada uno con su conteo de casos;
    - el número de casos con al menos un fallo en cada grupo;
    - el denominador: casos de Uₚ con investigación activa.
- **Bandas de edad** en `src/constants/dashboard.constants.ts`, con la regla de conversión de unidades de §3.2.
- **Ampliación de `DEUDA-047`** a `investigationAdministrationError` e `investigationColdChain`.
- Claves i18n, filas en `ROUTE_RULES` y casos nuevos en `tests/contract/dashboard.test.ts`.

**Nota para el frontend:**

> La curva es continua y ordenada. Una semana con `partial: true` no es comparable con las demás y conviene rotularla así. Las vacunas pueden sumar más que el total de casos, porque un caso con dos vacunas sospechosas cuenta en las dos. La geografía no trae polígonos: se piden aparte a `geoLocation` y se cachean, porque no cambian con el periodo. Un usuario restringido sin `geoLocationId` ve como filas sus unidades asignadas, no el país.

**Fuera de alcance (otros specs, o descartado):**

- Curva por fecha de evento (`eventDate`). Se fijó `reportDate` para que la curva cuadre con F66 (§6).
- Curva por mes, por día o por semana ISO.
- Umbrales de alerta o canal endémico sobre la curva: exigen un histórico y un método estadístico propios.
- Agrupamiento por lote (`batchNumber`). → **SPEC F68**.
- Polígonos geográficos en la respuesta, o un endpoint de polígonos.
- Distribución por residencia del paciente (`patient.residenceGeoLocationId`).
- Bandas de edad configurables en `systemConfig`.
- Campos de transporte de la cadena de frío como indicadores de fallo.
- Las notas de texto libre de las dos tablas de fallos (`*Notes`, `*KeyFindings`).
- Resolver la falta de `isActive` en las tres tablas (`DEUDA-047`).
- Actividad reciente (SPEC F69).

---

## 3. Modelo de datos

**No hay tablas, columnas, modelos, asociaciones ni índices nuevos.** Solo se lee.

### 3.1 Columnas consultadas

Además de las de F66 §3.1 (`esaviCase`, `healthFacility`, `caseWorkflow`, `classification`, `investigation`), que se reutilizan sin cambios:

| Tabla | DDL | Columnas | Vigencia | Papel |
|---|---|---|---|---|
| `notificationVaccine` | `:919-942` | `notificationId` (`IX_notificationVaccine_notification`), `vaccineWhodrugId` (`:922`), `isSuspected` (`:924`, `NOT NULL`), `vaccineName` | `isActive` | Vacunas sospechosas |
| `notification` | `:803` | `notificationId`, `caseId` (`UQ_notification_case`) | `isActive` | Puente caso → vacuna |
| `vaccineWhodrug` | `:604` | `vaccineWhodrugId`, `drugName` (`NOT NULL`) | — | Nombre de la vacuna codificada |
| `classification` | `:775-801` | `age` (`:778`, `CHECK >= 0`), `ageUnitItemId` (`:779`) | `isActive` | Edad |
| `catalogItem` | `:214` | `value` con `isValueLocked = true` (SPEC F46) de los tipos `ageUnit` (`YEARS`, `MONTHS`, `DAYS`, `:1775-1777`) y `sex` (`FEMALE`, `MALE`, `UNKNOWN`, `:1779-1781`). El `code` es del país y no se usa | — | Unidades y sexo |
| `patient` | `:699-721` | `patientId`, `sexItemId` (`:710`) | — | Sexo |
| `geoLocation` | `:447-471` | `geoLocationId`, `parentGeoLocationId` (`IX_geoLocation_parent`), `name`, `latitude`, `longitude` | `isActive` | Filas geográficas |
| `appUserGeoLocation` | `:510` | `userId`, `geoLocationId` | `isActive`, `deletedAt IS NULL` | Raíces de un usuario restringido |
| `investigationAdministrationError` | `:1299-1335` | `investigationId` (PK), `hadPrescriptionError`, `hadContaminatedVaccine`, `hadAbnormalVaccineConditions`, `hadPreparationError`, `hadHandlingError`, `hadImproperAdministration` (todas `answerOption`) | **`deletedAt IS NULL`** | Errores de administración |
| `investigationColdChain` | `:1274-1297` | `investigationId` (PK), `storageRangeDeviation` (`boolean`), `storageProcedureFollowed`, `storageVaccineNotUsable`, `storageDiluentNotUsable`, `storagePartiallyReconstitutedVaccine`, `storageOtherObjectPresent` (`answerOption`) | **`deletedAt IS NULL`** | Cadena de frío |

**Anomalía declarada:** `investigationAdministrationError` e `investigationColdChain` no tienen `isActive`. Se amplía `DEUDA-047`.

**Relaciones:** `notificationVaccine` es la única relación **uno a muchos** de este spec (una notificación, N vacunas). Por eso todo conteo que pase por ella usa `COUNT(DISTINCT caseId)`. El resto son uno a uno con el caso.

### 3.2 Definiciones

**Universo.** Uₚ de F66 §3.2, sin cambios: casos activos, con workflow activo, dentro del alcance efectivo y con `reportDate` en `[from, to]`. Si el alcance efectivo es vacío, el servicio no consulta y devuelve la estructura con ceros.

**Semana epidemiológica OPS** (`epiWeek.helper.ts`):

- `weekStart(d) = d − dow(d)`, donde `dow` es 0 para el domingo;
- `epiYear(d) = year(weekStart(d) + 3)`, es decir, el año del miércoles de esa semana;
- `epiWeek(d) = (weekStart(d) − weekStart(4 de enero de epiYear)) / 7 + 1`;
- etiqueta: `${epiYear}-SE${epiWeek con dos dígitos}`.

Las comprobaciones de §5 fijan tres años con 53 semanas o con un cambio de año a mitad de semana.

**`ESAVI-DASH-008` — curva.**

1. La lista continua de semanas sale del helper: desde `weekStart(from)` hasta `weekStart(to)`.
2. La consulta agrupa Uₚ por `reportDate − EXTRACT(DOW FROM reportDate)::int` y cuenta tres cosas:
   - `serious`: `classification.isSeriousEvent = true`;
   - `nonSerious`: clasificación activa con `isSeriousEvent` distinto de `true`;
   - `unclassified`: sin clasificación activa.
3. El servicio cruza la lista con el resultado; las semanas ausentes van con ceros.
4. `partial = weekStart < from || weekStart + 6 > to`.

**`ESAVI-DASH-009` — vacunas sospechosas.**

- *Clave de agrupación:*
  - con `vaccineWhodrugId`: `('W', vaccineWhodrugId)`, con la etiqueta `vaccineWhodrug.drugName`;
  - sin él: `('T', upper(trim(vaccineName)))`, con esa etiqueta;
  - las filas con `vaccineName` nulo o vacío y sin `vaccineWhodrugId` se agrupan como `('T', '')`, con la etiqueta `null`.
- *Por grupo:* `cases = COUNT(DISTINCT caseId)` y `serious` = los de esos casos con `isSeriousEvent = true`.
- *Orden:* `cases` descendente, empate por etiqueta ascendente. Las 10 primeras van a `items`. El resto suma en `others`, con los mismos dos campos y contando casos distintos de **todo** el resto, de modo que un caso no se cuenta dos veces dentro de `others`.
- *Aparte:* `casesWithoutSuspectedVaccine`, los casos de Uₚ sin ninguna fila sospechosa activa.

**`ESAVI-DASH-009` — sexo y edad.**

*Edad en años cumplidos (`ageYears`)* a partir de `classification.age` y del `value` bloqueado del `catalogItem` de `ageUnitItemId`:

| Unidad | Regla |
|---|---|
| `YEARS` | `age` |
| `MONTHS` | `floor(age / 12)` |
| `DAYS` | `floor(age / 365)` |
| sin clasificación, `age` nula, unidad nula o `value` desconocido o no bloqueado | desconocida |

*Bandas* (`DASHBOARD_AGE_BANDS`):

| Código | Regla sobre `ageYears` |
|---|---|
| `LT_1Y` | `0` (cubre 0–11 meses y 0–364 días) |
| `Y1_17` | 1–17 |
| `Y18_24` | 18–24 |
| `Y25_49` | 25–49 |
| `Y50_59` | 50–59 |
| `Y60_69` | 60–69 |
| `Y70_79` | 70–79 |
| `Y80_PLUS` | ≥ 80 |
| `UNKNOWN` | edad desconocida |

*Sexo:* el `value` bloqueado del `catalogItem` de `patient.sexItemId` (`FEMALE`, `MALE`, `UNKNOWN`). Sin `sexItemId`, o con un `value` fuera de esos tres o sin bloquear → `NONE`.

*Bloqueo de los values de sexo:* por la regla de SPEC F46 —un `value` se bloquea si y solo si `src/` lo nombra—, el bloque de despliegue de `esaviapp.sql` añade `('sex', 'FEMALE')`, `('sex', 'MALE')` y `('sex', 'UNKNOWN')` a los values bloqueados. Es un cambio de datos del seed, no de esquema.

*Salida:* una matriz completa de 9 × 4, en el orden de las tablas, con ceros explícitos. La suma de la matriz es igual a |Uₚ|.

**`ESAVI-DASH-009` — geografía.**

*Filas.* El conjunto R de unidades de referencia depende del usuario y de la query:

| Caso | R |
|---|---|
| Viaja `geoLocationId` | Sus hijos activos directos |
| Administrador, sin `geoLocationId` | Las unidades activas con `parentGeoLocationId IS NULL` |
| Restringido, sin `geoLocationId` | Sus raíces de asignación activas, **minimizadas**: se descarta toda raíz que sea descendiente de otra |

*Atribución.* Un `WITH RECURSIVE` que arrastra `rootId` desde cada fila de R, con el tope `MAX_GEO_SUBTREE_DEPTH`, atribuye cada caso de Uₚ a la fila cuyo subárbol contiene `healthFacility.geoLocationId`.

*Dos filas especiales:*

- `self`: con `geoLocationId`, los casos ubicados **en la propia unidad** de referencia y no en un hijo;
- `unlocated`: para cualquier usuario y con o sin `geoLocationId`, los casos de Uₚ que no se pueden atribuir a ninguna fila de R ni a `self`. Son tres situaciones:
  - el establecimiento no tiene `geoLocationId`;
  - su unidad está inactiva o cuelga de un ancestro inactivo, de modo que el recorrido recursivo no la alcanza;
  - su unidad cuelga de un hijo de la unidad de referencia que el filtro de alcance retiró de R, como un usuario asignado a un cantón que consulta el país.

  La fila no expone el nombre ni el `geoLocationId` de ninguna de esas unidades.

Ambas van con `geoLocationId: null` y una etiqueta fija. Se omiten si valen 0.

*Por fila:* `geoLocationId`, `name`, `latitude`, `longitude`, `total` y `serious`. Se ordenan por `total` descendente y luego por `name`. Se devuelven todas las filas de R, también las que tienen 0.

*Suma:* `Σ total = |Uₚ|`.

*Alcance:* para un usuario restringido con `geoLocationId`, los hijos que caen fuera de su alcance **no aparecen como filas**. Se filtra R contra el alcance antes de devolverlo, para no exponer ni siquiera los nombres de unidades ajenas.

**`ESAVI-DASH-009` — fallos programáticos.**

*Denominador `investigatedCases`:* casos de Uₚ con `investigation` activa.

*Administración* (`administrationErrors`), cada uno con valor `'YES'`:

- `prescriptionError`, `contaminatedVaccine`, `abnormalVaccineConditions`, `preparationError`, `handlingError`, `improperAdministration`;
- `anyError`: casos con al menos uno de los seis.

*Cadena de frío* (`coldChainFailures`):

- `rangeDeviation`: `storageRangeDeviation = true`;
- `procedureNotFollowed`: `storageProcedureFollowed = 'NO'`;
- `vaccineNotUsable`, `diluentNotUsable`, `partiallyReconstitutedVaccine`, `otherObjectPresent`: su columna en `'YES'`;
- `anyFailure`: casos con al menos uno de los seis.

*Datos ausentes:* una investigación sin fila en una de las tablas no cuenta como fallo de ese grupo, y se informa en `withoutAdministrationRecord` y `withoutColdChainRecord`. Las filas con `deletedAt` no cuentan.

### 3.3 Constantes, helpers y tipos

**`src/constants/dashboard.constants.ts`** añade:

- `DASHBOARD_VACCINE_TOP_LIMIT = 10`
- `DASHBOARD_AGE_BANDS`: un arreglo ordenado de `{ code, minYears, maxYears | null }`, con `UNKNOWN` al final
- `DASHBOARD_SEX_CODES = ['FEMALE', 'MALE', 'UNKNOWN', 'NONE']`

**`src/helpers/epiWeek.helper.ts` (nuevo)**, registrado en el barrel: `getEpiWeek(date)` → `{ epiYear, epiWeek, label, weekStart }`, y `listEpiWeeks(from, to)`.

**`src/services/common/geoScope.service.ts`** añade `resolveUserGeoRootIds(authUser)`. Extrae la consulta de raíces que hoy está dentro de `resolveUserGeoScopeIds` (`:60-…`), que pasa a usarla. Así F49 y F67 leen las asignaciones por el mismo camino.

**`src/types/dashboard/dashboard.types.ts`** añade:

```ts
export interface DashboardEpiWeek {
    label: string; epiYear: number; epiWeek: number; weekStart: string;
    partial: boolean; serious: number; nonSerious: number; unclassified: number; total: number;
}

export interface DashboardEpiCurve {
    period: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    weeks: DashboardEpiWeek[];
}

export interface DashboardVaccineRow { key: string; label: string | null; coded: boolean; cases: number; serious: number; }

export interface DashboardGeoRow {
    geoLocationId: string | null; kind: 'unit' | 'self' | 'unlocated';
    name: string | null; latitude: number | null; longitude: number | null; total: number; serious: number;
}

export interface DashboardDistributions {
    period: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    vaccines: { items: DashboardVaccineRow[]; others: { cases: number; serious: number }; casesWithoutSuspectedVaccine: number };
    sexAge: { bands: string[]; sexes: string[]; matrix: number[][] };
    geography: { rows: DashboardGeoRow[] };
    programmatic: {
        investigatedCases: number;
        withoutAdministrationRecord: number;
        withoutColdChainRecord: number;
        administrationErrors: Record<'prescriptionError' | 'contaminatedVaccine' | 'abnormalVaccineConditions' | 'preparationError' | 'handlingError' | 'improperAdministration' | 'anyError', number>;
        coldChainFailures: Record<'rangeDeviation' | 'procedureNotFollowed' | 'vaccineNotUsable' | 'diluentNotUsable' | 'partiallyReconstitutedVaccine' | 'otherObjectPresent' | 'anyFailure', number>;
    };
}
```

`key` es un identificador estable para el frontend: `W:<uuid>` o `T:<texto normalizado>`.

### 3.4 Superficie HTTP

```
GET /api/dashboard/pending-work    ESAVI-DASH-006   USER        (existe, F65)
GET /api/dashboard/indicators      ESAVI-DASH-007   ANALYTICS   (existe, F66)
GET /api/dashboard/epi-curve       ESAVI-DASH-008   ANALYTICS   (nuevo)
GET /api/dashboard/distributions   ESAVI-DASH-009   ANALYTICS   (nuevo)
```

Cadena de los dos nuevos: `tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, handler`.

### 3.5 Reglas de negocio por operación

**`ESAVI-DASH-008` — curva.**

1. `resolveDashboardPeriod(query)`. No usa el periodo anterior.
2. Alcance efectivo, como en F66. Si es vacío → semanas continuas con ceros.
3. Consulta agrupada por `weekStart` y cruce con `listEpiWeeks`.
4. Cualquier fallo → 500 `DASH_008_FETCH_FAILED`.

**`ESAVI-DASH-009` — distribuciones.**

1. Periodo y alcance efectivo, como en `008`. Si el alcance es vacío → estructura completa con ceros, la matriz 9 × 4 y `geography.rows` vacío.
2. Resolución de R (§3.2), filtrada contra el alcance.
3. Cuatro consultas parametrizadas en `Promise.all`: vacunas, sexo y edad, geografía y fallos programáticos.
4. Cualquier fallo → 500 `DASH_009_FETCH_FAILED`.

**`geoLocationId` ajeno o inexistente:** como en F66, ceros con 200, y `geography.rows` vacío. No se comprueba la existencia.

**Escrituras:** ninguna. No aplica el contrato de update diferencial.

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `dashboard.epiCurveSuccess` | 200 de `ESAVI-DASH-008` |
| `dashboard.epiCurveFailed` | 500 `DASH_008_FETCH_FAILED` |
| `dashboard.distributionsSuccess` | 200 de `ESAVI-DASH-009` |
| `dashboard.distributionsFailed` | 500 `DASH_009_FETCH_FAILED` |

Las etiquetas de bandas, sexos y filas especiales **no** van en i18n: viajan como códigos, y el frontend las localiza.

### 3.7 Forma de la respuesta

```
// 008
{ ok, message, data: {
    period, scope,
    weeks: [ { label: "2026-SE14", epiYear, epiWeek, weekStart, partial, serious, nonSerious, unclassified, total } ]
} }

// 009
{ ok, message, data: {
    period, scope,
    vaccines:     { items: [ { key, label, coded, cases, serious } ], others: { cases, serious }, casesWithoutSuspectedVaccine },
    sexAge:       { bands: [ "LT_1Y", …, "UNKNOWN" ], sexes: [ "FEMALE", "MALE", "UNKNOWN", "NONE" ], matrix: [ [..4], … 9 filas ] },
    geography:    { rows: [ { geoLocationId, kind, name, latitude, longitude, total, serious } ] },
    programmatic: { investigatedCases, withoutAdministrationRecord, withoutColdChainRecord, administrationErrors: {…}, coldChainFailures: {…} }
} }
```

**Ningún identificador de caso ni de paciente.** Los `geoLocationId` que viajan son solo de unidades dentro del alcance del usuario.

---

## 4. Plan de implementación

Depende de que F65 y F66 estén implementados: dominio `DASH`, `dashboardPeriodValidator`, `resolveDashboardPeriod`, la fixture de usuario sin roles y `DEUDA-047`.

1. **Ampliar `DEUDA-047`.** En `references/TECHNICAL_DEBT.md`, la deuda pasa a cubrir las tres tablas satélite 1:1 de la investigación sin `isActive`: `investigationAutopsy`, `investigationAdministrationError` (`esaviapp.sql:1299-1335`) e `investigationColdChain` (`:1274-1297`). Se añade el enlace a este spec.
   *Verificación:* la entrada de `DEUDA-047` nombra las tres tablas y enlaza F66 y F67.

2. **Registrar las operaciones.** Filas `dashboard | 008` (curva por semana epidemiológica OPS, `GET /epi-curve`, `ANALYTICS`) y `dashboard | 009` (vacunas, sexo y edad, geografía y fallos programáticos, `GET /distributions`, `ANALYTICS`) en `references/CONVENTIONS.md` §6.
   *Verificación:* `grep -n "dashboard | 00[89]" references/CONVENTIONS.md` devuelve las dos filas.

3. **Extraer `resolveUserGeoRootIds`.** En `src/services/common/geoScope.service.ts`, la consulta de raíces de `resolveUserGeoScopeIds` pasa a su propia función exportada, y `resolveUserGeoScopeIds` la invoca. Sin cambio de comportamiento.
   *Verificación:* `esaviCase.test.ts` y `appUserGeoLocation.test.ts` pasan sin modificarse.

4. **Semana epidemiológica.** `src/helpers/epiWeek.helper.ts` con `getEpiWeek` y `listEpiWeeks`, registrado en el barrel.
   *Verificación:* pruebas unitarias con las fechas fijas de §5. Cubren un año de 53 semanas, el 1 de enero en la última semana del año anterior y el 31 de diciembre en la semana 1 del año siguiente.

5. **Constantes y tipos.** Las de §3.3 en `dashboard.constants.ts` y `dashboard.types.ts`.
   *Verificación:* `npm run build` sale en 0.

6. **Claves i18n.** Las cuatro de §3.6 en `es`, `en` y `nl`.
   *Verificación:* `npm run i18n:check` sale en 0.

7. **`ESAVI-DASH-008` — curva.** `getEpiCurveService(query, authUser, lang)`, controlador `getEpiCurve` y ruta `GET /epi-curve`.
   *Verificación:* como ADMIN, con `?from=2026-01-01&to=2026-01-28`, la primera semana (`2025-SE53`) y la última (`2026-SE04`) llevan `partial: true`; la suma de `total` coincide con `volume.total.current` de `ESAVI-DASH-007` con la misma query.

8. **`ESAVI-DASH-009` — esqueleto, vacunas, sexo y edad.** `getDistributionsService(query, authUser, lang)`, controlador `getDistributions` y ruta `GET /distributions`, con los bloques `vaccines` y `sexAge`. Los bloques `geography` y `programmatic` salen vacíos en este paso.
   *Verificación:* la matriz es 9 × 4 y suma |Uₚ|; un caso con dos vacunas sospechosas suma en las dos filas.

9. **`ESAVI-DASH-009` — geografía.** Resolución de R, filtrada contra el alcance, y atribución recursiva con `rootId`.
   *Verificación:* un ADMIN sin `geoLocationId` ve las unidades de nivel 1; un usuario restringido con dos raíces solapadas ve solo la superior; `Σ total = |Uₚ|`.

10. **`ESAVI-DASH-009` — fallos programáticos.** Las dos agregaciones con su denominador y los conteos de registros ausentes.
    *Verificación:* un caso con `hadHandlingError = 'YES'` y `storageRangeDeviation = true` suma 1 en `handlingError`, en `anyError`, en `rangeDeviation` y en `anyFailure`.

11. **Pruebas de convención.** Dos filas en `tests/setup/routeRules.ts` (`008` y `009`, `ANALYTICS`), con el conteo de `ROUTE_RULES` +2, y los escenarios de §5 en `tests/contract/dashboard.test.ts`.
    *Verificación:* `npm test -- roles dashboard` sale en 0, y el usuario sin roles recibe 403 en las dos rutas.

---

## 5. Criterios de aceptación

**Superficie y roles**

- [ ] `GET /api/dashboard/epi-curve` y `GET /api/dashboard/distributions` responden 200 a los siete roles, 403 `AUTH_ROLE_FORBIDDEN` al usuario sin roles y 401 sin token.
- [ ] Los puntos del código de operación coinciden en las dos operaciones (`DASH_008_*`, `DASH_009_*`).
- [ ] `esaviCase.test.ts` y `appUserGeoLocation.test.ts` pasan sin cambios tras extraer `resolveUserGeoRootIds`.
- [ ] `DEUDA-047` nombra las tres tablas y enlaza F66 y F67.

**Semana epidemiológica** (pruebas unitarias del helper)

- [ ] `2026-01-04` (domingo) → `2026-SE01`, `weekStart = 2026-01-04`.
- [ ] `2026-01-01` (jueves) → **`2025-SE53`**, `weekStart = 2025-12-28`.
- [ ] `2024-12-31` (martes) → **`2025-SE01`**, `weekStart = 2024-12-29`.
- [ ] `2026-04-01` → `2026-SE13`, `weekStart = 2026-03-29`.
- [ ] `listEpiWeeks` sobre el año epidemiológico 2025 devuelve 53 semanas, de `2024-12-29` a `2025-12-27` como inicios.

**Curva (`008`)**

- [ ] `?from=2026-01-01&to=2026-01-28` devuelve 5 semanas en orden: `2025-SE53` (`partial: true`), `2026-SE01` a `2026-SE03` (`partial: false`) y `2026-SE04` (`partial: true`).
- [ ] Una semana sin casos aparece con los cuatro contadores a 0.
- [ ] Un caso con `reportDate = 2026-01-02` suma en `2025-SE53`, pero solo cuenta porque está dentro del periodo. Uno del `2025-12-30` no aparece.
- [ ] En cada semana, `serious + nonSerious + unclassified = total`.
- [ ] La suma de `total` es igual a `volume.total.current` de `ESAVI-DASH-007` con la misma query y el mismo usuario.

**Vacunas (`009`)**

- [ ] Un caso con dos vacunas sospechosas distintas suma 1 en cada una.
- [ ] Un caso con la misma vacuna sospechosa en dos filas suma 1, no 2.
- [ ] Dos filas sin `vaccineWhodrugId`, con `vaccineName` `" Pfizer "` y `"PFIZER"`, caen en el mismo grupo, `key = "T:PFIZER"`, `coded: false`.
- [ ] Una fila con `isSuspected = false` no cuenta.
- [ ] Con 12 vacunas distintas, `items` trae 10 y `others` cuenta casos distintos de las 2 restantes.
- [ ] `casesWithoutSuspectedVaccine` cuenta los casos de Uₚ sin ninguna fila sospechosa activa.

**Sexo y edad (`009`)**

- [ ] La matriz es siempre 9 × 4, en el orden de `bands` y `sexes`, y su suma es |Uₚ|.
- [ ] 11 meses → `LT_1Y`; 12 meses → `Y1_17`; 364 días → `LT_1Y`; 365 días → `Y1_17`.
- [ ] 17 años → `Y1_17`; 18 → `Y18_24`; 49 → `Y25_49`; 50 → `Y50_59`; 79 → `Y70_79`; 80 → `Y80_PLUS`.
- [ ] Un caso sin clasificación, con `age` nula o con `ageUnitItemId` nulo → `UNKNOWN`.
- [ ] Un paciente sin `sexItemId` → columna `NONE`.

**Geografía (`009`)**

- [ ] Un ADMIN sin `geoLocationId` recibe como filas las unidades sin padre, incluidas las que tienen 0, y la fila `unlocated` si hay casos no atribuibles (establecimientos sin ubicación o bajo unidades inactivas).
- [ ] Con `geoLocationId = <provincia>`, las filas son sus cantones, más `self` si hay casos ubicados directamente en la provincia.
- [ ] Un usuario restringido asignado a una provincia y a uno de sus cantones ve una sola fila: la provincia.
- [ ] Un usuario restringido con `geoLocationId` de una unidad que contiene territorio ajeno no recibe como fila ningún hijo fuera de su alcance. Ni el nombre ni el `geoLocationId` de ese hijo aparecen en la respuesta.
- [ ] Un usuario restringido asignado a un cantón que consulta con `geoLocationId` = el país ve sus casos en la fila `unlocated`, y ninguna provincia como fila.
- [ ] `Σ rows.total = |Uₚ|`.
- [ ] Ninguna fila trae `geoPolygon`.

**Fallos programáticos (`009`)**

- [ ] `investigatedCases` cuenta los casos de Uₚ con investigación activa.
- [ ] `hadHandlingError = 'YES'` suma en `handlingError` y en `anyError`; `'NO'`, `'UNKNOWN'` o `null` no suman.
- [ ] `storageProcedureFollowed = 'NO'` suma en `procedureNotFollowed`; `'YES'` no.
- [ ] Un caso con tres fallos de administración suma 1 en `anyError`.
- [ ] Una investigación sin fila de cadena de frío suma en `withoutColdChainRecord` y no en ningún fallo.
- [ ] Una fila de cualquiera de las dos tablas con `deletedAt` informado no cuenta.

**Alcance y datos expuestos**

- [ ] Un analista del territorio A no recibe ningún conteo del B en ninguno de los dos endpoints.
- [ ] Con `?geoLocationId=<B>` o con un UUID inexistente, la respuesta es 200 con ceros y `geography.rows` vacío, idéntica en los dos casos.
- [ ] Ninguna de las dos respuestas contiene `caseId`, `caseCode`, `patientId` ni datos del paciente, en ningún nivel.

**Sin escrituras**

- [ ] Llamar a `008` y `009` no modifica `updatedAt`, `appDetails` ni `sysDetails` de ninguna fila de la fixture.

**Cierre**

- [ ] Las cuatro claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

No va el bloque de update diferencial, porque ninguna operación escribe sobre una fila existente.

---

## 6. Decisiones tomadas y descartadas

**Forma**

- **Sí:** dos endpoints, la curva por un lado y las distribuciones por otro. La curva es una serie que el frontend dibuja de forma independiente y que se puede consultar sola. Las cuatro distribuciones comparten universo y se pintan juntas.
- **No:** un endpoint por distribución. Serían cuatro llamadas con el mismo universo y la misma resolución de alcance repetida cuatro veces.
- **No:** meter la curva dentro de `ESAVI-DASH-007`. Mezclaría un resumen de un número por indicador con una serie de hasta 53 filas, y F66 ya está cerrado.

**Curva**

- **Sí:** semana epidemiológica OPS, la que usan los boletines de la región.
- **No:** semana ISO, que empieza en lunes y no se puede comparar con los boletines nacionales.
- **Sí:** agrupar por `reportDate`, para que la curva cuadre con `volume.total` de F66.
- **No:** la curva por `eventDate`. Tendría otro universo, sus totales no cuadrarían con F66 y los casos sin fecha de evento desaparecerían.
- **Sí:** serie continua, con las semanas vacías a 0. Un hueco en la serie se lee como «no hay datos», no como «cero casos».
- **Sí:** marcar las semanas parciales en lugar de recortar el periodo a semanas completas. El periodo lo elige el usuario, y el backend no debe cambiarlo en silencio.
- **Sí:** el cálculo de la semana en un helper de JS y no en SQL, porque es una regla de calendario con casos límite que se prueban unitariamente.

**Vacunas**

- **Sí:** contar casos distintos, no filas. Una vacuna anotada dos veces en un mismo caso es un solo caso.
- **Sí:** agrupar el texto libre por `upper(trim())` y marcarlo con `coded: false`, para que se vea la deuda de codificación WHODrug sin perder esos casos.
- **No:** fusionar el texto libre con las vacunas codificadas por similitud de nombre. Es un emparejamiento difuso que puede equivocarse en silencio.
- **Sí:** contar en `others` casos distintos de todo el resto, para que un caso con dos vacunas fuera del top no se cuente dos veces.

**Sexo y edad**

- **Sí:** las bandas que fijó el programa (`LT_1Y` a `Y80_PLUS`, más `UNKNOWN`), con `Y50_59` añadida para cerrar el hueco.
- **Sí:** convertir a años cumplidos con `floor`. Un niño de 12 meses o de 365 días ya cumplió un año.
- **No:** usar 365,25 días por año. Para el límite de un año no cambia la banda, y complica la regla sin ganar nada.
- **Sí:** bandas en constantes y no en `systemConfig`, porque cambiarlas altera la lectura histórica de la serie.
- **Sí:** matriz completa con ceros. El frontend dibuja la pirámide sin rellenar huecos.

**Geografía**

- **Sí:** las filas son los hijos directos de una unidad de referencia. Permiten bajar de nivel sin un parámetro nuevo de nivel.
- **Sí:** minimizar las raíces solapadas de un usuario, para que ningún caso cuente dos veces.
- **Sí:** las filas especiales `self` y `unlocated`. Sin ellas, `Σ total ≠ |Uₚ|` y faltarían casos sin explicación.
- **Sí:** filtrar R contra el alcance, para que un hijo ajeno no aparezca ni siquiera con 0. Su nombre ya es información sobre un territorio que el usuario no alcanza.
- **No:** incluir `geoPolygon`. Es pesado, no cambia con el periodo y se cachea mejor aparte.
- **No:** la residencia del paciente como ubicación. Se usa la ubicación del establecimiento, coherente con F49.

**Fallos programáticos**

- **Sí:** la lista de seis indicadores por grupo que validó el equipo, más «al menos uno».
- **No:** los campos de transporte como fallo.
- **Sí:** `'YES'` como único valor de fallo en `answerOption`. `UNKNOWN` y `NO_ANSWER` no prueban que hubiera un fallo.
- **Sí:** informar las investigaciones sin registro, para que un 0 en fallos no se confunda con «no se evaluó».

**Implementación**

- **Sí:** extraer `resolveUserGeoRootIds`, para que F49 y F67 lean las asignaciones por el mismo camino.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| La atribución geográfica recursiva con muchas filas (por ejemplo, 24 provincias) es costosa | Un solo `WITH RECURSIVE` con `rootId` y el tope `MAX_GEO_SUBTREE_DEPTH`, y no una consulta por fila. Aplica la condición de caché de F65 §7 |
| El texto libre de vacunas fragmenta el ranking (`PFIZER` y `COMIRNATY` como dos filas distintas) | `coded: false` lo hace visible. La solución es codificar contra WHODrug al notificar, y no corresponde al dashboard |
| Un error en la semana epidemiológica desplaza toda la curva | Pruebas unitarias con los tres casos límite del calendario (§5) |
| Las raíces de asignación cambian entre dos cargas y las filas geográficas cambian de forma | Es el comportamiento correcto: el alcance se resuelve en cada petición, como en F49 |
| Las tres tablas sin `isActive` acumulan filas con soft delete inconsistente | `DEUDA-047` ampliada. Mientras tanto se filtra por `deletedAt` |
| Edades con unidad incoherente (por ejemplo, 500 meses) | Se convierten igual (41 años). El dashboard no valida datos de origen; esa regla es de F09 |

---

## 8. Impacto en el contrato HTTP

**Aditivo.** Dos rutas nuevas: `GET /api/dashboard/epi-curve` y `GET /api/dashboard/distributions`. Ninguna ruta existente cambia.

**Notas para el spec del frontend:**

1. La curva usa semanas epidemiológicas OPS. La etiqueta `2025-SE53` puede contener días de enero de 2026: el año es el **epidemiológico**.
2. Una semana con `partial: true` se rotula como incompleta y no se compara con las demás.
3. Las vacunas pueden sumar más que el total de casos. `coded: false` indica que no está codificada en WHODrug, y conviene distinguirla visualmente.
4. La matriz de sexo y edad llega completa. Las etiquetas se localizan por código.
5. Los polígonos se piden aparte. Las filas `self` y `unlocated` no tienen polígono ni coordenadas.
6. Para profundizar en el mapa, se vuelve a llamar con `geoLocationId` = la fila pulsada. Las filas que el usuario no alcanza nunca llegan.
7. Los fallos programáticos se leen sobre `investigatedCases`, no sobre el total de casos. `withoutAdministrationRecord` y `withoutColdChainRecord` indican qué parte no se evaluó.

---

## Lo que **no** está en este spec

- Curva por fecha de evento, por mes, por día o por semana ISO.
- Canal endémico o umbrales de alerta sobre la curva.
- Agrupamiento por lote (SPEC F68).
- Actividad reciente (SPEC F69).
- Polígonos geográficos en la respuesta o un endpoint de polígonos.
- Distribución por residencia del paciente.
- Bandas de edad configurables.
- Fusión difusa de nombres de vacunas sin codificar.
- Campos de transporte de la cadena de frío como indicadores.
- Notas de texto libre de los fallos programáticos.
- Resolver la falta de `isActive` en las tablas de `DEUDA-047`.

Cada uno de esos, si aterriza, va en su propio spec.
