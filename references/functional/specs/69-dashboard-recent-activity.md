# SPEC F69 — Dashboard: actividad reciente

> **Estado:** Borrador
> **Depende de:** SPEC 01, SPEC 04, SPEC 05, SPEC 06 (`AppDetails` tipado), SPEC 08, **SPEC F42** (`appSession`, motivos de revocación), **SPEC F44** (`caseWorkflow`), **SPEC F49** (alcance geográfico), **SPEC F59** (autor de auditoría por email), **SPEC F63** (retención de `appSession`), **SPEC F65** (marco `DASH`, universo U)
> **Fecha:** 2026-11-02
> **Objetivo:** Mostrar en el home qué ha pasado últimamente en los casos del territorio del usuario y en cuáles intervino él, y dar al SUPERADMIN un resumen del uso del sistema por sesiones, sin exponer más de lo que cada rol ya puede ver.

---

## 1. Por qué existe este spec

**F65 a F68 dicen cómo están los casos; ninguno dice qué está pasando con ellos.** Un responsable territorial que entra al home quiere saber qué se movió desde su última visita: qué casos se abrieron, cuáles cambiaron de etapa, cuáles se cerraron o reabrieron. Un notificador o investigador quiere volver a los casos en los que estaba trabajando sin buscarlos en el listado. Hoy ninguna de las dos cosas se puede pedir por API.

**El historial ya existe y nadie lo consulta de forma transversal.** Cada escritura sobre un caso o su flujo añade una entrada `{ createdAt, user, method, detail }` al `appDetails` de la fila (`src/types/common/audit.types.ts:16-21`). En `esaviCase` quedan el alta, las ediciones y la activación. En `caseWorkflow` queda cada transición del expediente (F44). Esa historia solo se ve hoy caso por caso, dentro de la respuesta de cada `GET`.

**`appDetails` no está pensado para consultas transversales, y este spec lo asume.** No tiene índice: leerlo exige expandir el arreglo JSONB de cada fila del alcance. Por eso el feed se limita a dos tablas, `esaviCase` y `caseWorkflow`, que son uno a uno con el caso y cubren el alta, la edición y todo el recorrido del expediente. Además usa una ventana fija de 30 días y un tope de filas. Las ~22 tablas satélite quedan fuera, con su razón (§6).

**El autor de una entrada es un dato sensible y ya tiene regla.** F59 decidió que `appDetails[].user` se muestra como email solo a ADMIN y SUPERADMIN, y como `null` al resto, resolviéndolo con una sola consulta. El feed reutiliza `resolveAppDetailsAuthorsService` tal cual. Un `USER` ve qué pasó, pero no quién lo hizo; a menos que haya sido él, porque «mis casos» se filtra por su propio `userId` en el servidor.

**El código de operación no es un texto para mostrar.** `ESAVI-CASEFLOW-010` no le dice nada a un usuario, y el campo `detail` es texto libre en inglés pensado para auditoría. El feed traduce cada código a una acción estable (`CASE_CLOSED`, `STAGE_STARTED`…), que el frontend localiza, y no expone `detail`.

**El SUPERADMIN necesita ver el uso del sistema, no a las personas.** `appSession` (F63) registra cada sesión con su inicio, caducidad y revocación. Contar sesiones vigentes, usuarios activos y revocaciones por motivo responde «¿se está usando el sistema?, ¿hay algo raro con las sesiones?» sin exponer IP, agente ni identidades. Va en un endpoint aparte porque su rol y su contenido no tienen nada que ver con los casos.

---

## 2. Alcance

**Dentro:**

- **`ESAVI-DASH-011` — actividad reciente de casos.** `GET /api/dashboard/recent-activity`, rol mínimo `USER`, sin parámetros. Universo: casos de U (F65: activos, con workflow activo, dentro del alcance de F49). Ventana: entradas de `appDetails` con `createdAt` en los últimos **30 días**. Dos bloques:
  - **Actividad del territorio:**
    - las **20** entradas más recientes del `appDetails` de `esaviCase` y `caseWorkflow` de esos casos, excluida `ESAVI-CASEFLOW-001`;
    - cada una con `caseId`, `caseCode`, `occurredAt`, `method`, `action` y `author`, resuelto según F59.
  - **Mis casos:**
    - los **10** casos de U en los que el usuario autenticado aparece como autor de alguna entrada de esas dos tablas dentro de la ventana, ordenados por su última intervención;
    - cada uno con `caseId`, `caseCode`, estado actual del workflow, `lastActionAt` y `lastAction`, que son la última intervención **del usuario**.
- **Mapa `method → action`**, cerrado y en constantes:

  | `method` | `action` |
  |---|---|
  | `ESAVI-CASE-001` | `CASE_CREATED` |
  | `ESAVI-CASE-004` | `CASE_UPDATED` |
  | `ESAVI-CASE-005A` | `CASE_DEACTIVATED` |
  | `ESAVI-CASE-005B` | `CASE_ACTIVATED` |
  | `ESAVI-CASEFLOW-005A` | `WORKFLOW_DEACTIVATED` |
  | `ESAVI-CASEFLOW-005B` | `WORKFLOW_ACTIVATED` |
  | `ESAVI-CASEFLOW-007` | `STAGE_COMPLETED` |
  | `ESAVI-CASEFLOW-008` | `CASE_CLOSED` |
  | `ESAVI-CASEFLOW-009` | `CASE_REOPENED` |
  | `ESAVI-CASEFLOW-010` | `VALIDATION_REQUESTED` |
  | `ESAVI-CASEFLOW-011` | `VALIDATION_RESOLVED` |
  | `ESAVI-CASEFLOW-012` | `STAGE_STARTED` |
  | cualquier otro | `OTHER` |

- **`ESAVI-DASH-012` — actividad del sistema.** `GET /api/dashboard/system-activity`, rol mínimo `SUPERADMIN`, sin parámetros. Solo conteos sobre `appSession` sin `deletedAt`:
  - `activeSessions`: `revokedAt IS NULL` y (`expiresAt IS NULL` o `expiresAt > now()`);
  - `activeUsers24h` y `activeUsers7d`: usuarios distintos con alguna sesión iniciada (`startedAt`) en esas ventanas;
  - `sessionsStarted24h` y `sessionsStarted7d`;
  - `revocations7d`: sesiones revocadas en los últimos 7 días, agrupadas por `revokedReason`. Trae siempre los seis motivos de `SESSION_REVOKE_REASONS` (`src/constants/session.constants.ts:79-86`), con 0 cuando no hubo. Añade `UNSPECIFIED` si alguna revocación tiene `revokedReason` nulo, y `OTHER` si aparece un valor fuera de la lista.
- **Constantes de ventana y tope** en `dashboard.constants.ts`.
- **Catalogación de `DEUDA-048`** (§3.1).
- Claves i18n, filas en `ROUTE_RULES` y casos nuevos en `tests/contract/dashboard.test.ts`.

**Nota para el frontend:**

> `author` es un email solo para ADMIN y SUPERADMIN; para el resto es siempre `null`, también cuando el autor es el propio usuario. «Mis casos» ya está filtrado en el servidor y no necesita autor.
>
> `action` se localiza en la interfaz. `method` viaja para soporte y depuración, no para mostrarlo.
>
> `STAGE_STARTED` y `STAGE_COMPLETED` **no indican qué etapa**: el registro de auditoría no la guarda de forma estructurada. Para mostrarla, la interfaz puede usar el estado actual del caso o abrir su workflow.
>
> Un caso desactivado desaparece del feed, porque sale del universo.

**Fuera de alcance (otros specs, o descartado):**

- Actividad de las ~22 tablas satélite: notificación, vacunas, investigación, clasificación y sus satélites (§6).
- Exponer `detail`, o derivar de él la etapa de un `STAGE_*`.
- Ventana o tope configurables en `systemConfig`.
- Paginación o «cargar más» del feed.
- Marcar eventos como leídos, o «desde mi última visita». Exige guardar estado por usuario.
- Casos inactivos en el feed, incluso para ADMIN.
- Índices sobre `appDetails` o una tabla de eventos dedicada. Se aborda solo si se cumple la condición de rendimiento de F65 §7.
- En la actividad del sistema: IP, `userAgent`, lista de usuarios conectados, identidades, intentos de login fallidos (el esquema no los registra) y actividad de entidades que no son casos (usuarios, catálogos, configuración).
- Notificaciones push o en tiempo real.
- Corregir el `DEFAULT` de `appDetails` en el DDL (`DEUDA-048`).

---

## 3. Modelo de datos

**No hay tablas, columnas, modelos, asociaciones ni índices nuevos.** Solo se lee.

### 3.1 Columnas consultadas

| Tabla | DDL | Columnas | Vigencia | Papel |
|---|---|---|---|---|
| `esaviCase` | `:725` | `caseId`, `caseCode`, `healthFacilityId`, `appDetails` | `isActive`, `deletedAt IS NULL` | Universo U y eventos del caso |
| `healthFacility` | `:476` | `geoLocationId` | — | Alcance (F49) |
| `caseWorkflow` | `:1410` | `caseId`, `statusItemId`, `appDetails` | `isActive` | Eventos del flujo y estado actual |
| `catalogItem` | `:214` | `code` del tipo `caseWorkflowStatus` | — | Estado en «mis casos» |
| `appUser` | — | `userId`, `email` (cifrado) | — | Solo a través de `resolveAppDetailsAuthorsService` (F59) |
| `appSession` | `:349-366` | `userId`, `startedAt`, `expiresAt`, `revokedAt`, `revokedReason` (`IX_appSession_userId`, `IX_appSession_active`) | **`deletedAt IS NULL`** | Actividad del sistema |

**Anomalías:**

- `appSession` no tiene `isActive`. Ya está registrado desde F42 y F63 lo recuerda. Este spec no lo cambia.
- **`appDetails` tiene `DEFAULT '{}'::jsonb` (objeto) en las 49 tablas**, frente a la convención de arreglo (`CLAUDE.md`, «Audit trail»). Los servicios siempre escriben un arreglo, pero una fila insertada por otra vía —la función SQL `createEsaviCase()`, una carga manual o una semilla— queda con `{}`, y sobre ella `jsonb_array_elements` lanza un error. Se cataloga como [DEUDA-048](../../TECHNICAL_DEBT.md#deuda-048). Toda expansión de este spec filtra antes por `jsonb_typeof(...) = 'array'`.

### 3.2 Definiciones

**Ventana.** `now() − DASHBOARD_ACTIVITY_WINDOW_DAYS` (30 días) hasta `now()`, sobre `(elem->>'createdAt')::timestamptz`.

**Eventos.** Un CTE que une, con `UNION ALL`, la expansión de:

- `esaviCase."appDetails"`, para los casos de U;
- `caseWorkflow."appDetails"`, del workflow activo de cada caso de U.

En los dos casos con estas condiciones:

- `jsonb_typeof("appDetails") = 'array'`;
- la entrada tiene `createdAt` y `method` como texto;
- `createdAt` está dentro de la ventana;
- `method` no está en `DASHBOARD_ACTIVITY_EXCLUDED_METHODS` (`ESAVI-CASEFLOW-001`).

Cada evento es `{ caseId, caseCode, occurredAt, method, user }`.

**Actividad del territorio.** Los 20 eventos (`DASHBOARD_ACTIVITY_LIMIT`) más recientes, ordenados por `occurredAt DESC, caseCode ASC`. Después:

- `action = DASHBOARD_ACTIVITY_ACTION_MAP[method] ?? 'OTHER'`, calculado en el servicio;
- `author` se resuelve con `resolveAppDetailsAuthorsService(rows, isAdmin(authUser))`, el mismo servicio de F59, que hace una sola consulta y nunca devuelve un `userId`. Para hacerlo, el servicio da a cada fila la forma `{ appDetails: [{ user, … }] }` que ese servicio sabe recorrer, y después la aplana.

**Mis casos.** Sobre el mismo CTE, filtrado por `user = :userId` (el `userId` de `authUser`, nunca recibido por query):

- agrupa por caso y toma la entrada más reciente;
- ordena por `lastActionAt DESC, caseCode ASC`;
- se queda con los 10 primeros (`DASHBOARD_MY_CASES_LIMIT`);
- añade el `statusCode` actual del workflow.

Las entradas con `user = 'undefined'` (escrituras sin usuario autenticado, `caseWorkflow.service.ts:552`) nunca coinciden con un `userId` real, y su `author` es `null` para cualquier rol.

**Actividad del sistema.** Una sola consulta sobre `appSession` con `deletedAt IS NULL` y `COUNT(...) FILTER (WHERE …)` para cada contador de §2. Además, una consulta `GROUP BY COALESCE(revokedReason, 'UNSPECIFIED')` para `revocations7d`. El servicio completa los seis motivos de `SESSION_REVOKE_REASONS` con 0 y agrupa como `OTHER` cualquier valor fuera de la lista y distinto de `UNSPECIFIED`. Orden: los seis motivos en el orden de la constante, después `UNSPECIFIED` y `OTHER` si existen.

### 3.3 Constantes y tipos

**`src/constants/dashboard.constants.ts`** añade:

- `DASHBOARD_ACTIVITY_WINDOW_DAYS = 30`
- `DASHBOARD_ACTIVITY_LIMIT = 20`
- `DASHBOARD_MY_CASES_LIMIT = 10`
- `DASHBOARD_ACTIVITY_EXCLUDED_METHODS = ['ESAVI-CASEFLOW-001']`
- `DASHBOARD_ACTIVITY_ACTION_MAP`: el mapa de §2, `Readonly<Record<string, DashboardActivityAction>>`

**`src/types/dashboard/dashboard.types.ts`** añade:

```ts
export type DashboardActivityAction =
    'CASE_CREATED' | 'CASE_UPDATED' | 'CASE_DEACTIVATED' | 'CASE_ACTIVATED' |
    'WORKFLOW_DEACTIVATED' | 'WORKFLOW_ACTIVATED' | 'STAGE_STARTED' | 'STAGE_COMPLETED' |
    'CASE_CLOSED' | 'CASE_REOPENED' | 'VALIDATION_REQUESTED' | 'VALIDATION_RESOLVED' | 'OTHER';

export interface DashboardActivityEvent {
    caseId: string; caseCode: string; occurredAt: string;
    method: string; action: DashboardActivityAction; author: string | null;
}

export interface DashboardMyCase {
    caseId: string; caseCode: string; statusCode: string;
    lastActionAt: string; lastAction: DashboardActivityAction;
}

export interface DashboardRecentActivity {
    windowDays: number;
    scope: { restricted: boolean; hasAssignments: boolean };
    territory: DashboardActivityEvent[];
    myCases: DashboardMyCase[];
}

export interface DashboardSystemActivity {
    generatedAt: string;
    activeSessions: number;
    activeUsers24h: number; activeUsers7d: number;
    sessionsStarted24h: number; sessionsStarted7d: number;
    revocations7d: { reason: string; count: number }[];
}
```

### 3.4 Superficie HTTP

```
GET /api/dashboard/recent-activity   ESAVI-DASH-011   USER         (nuevo)
GET /api/dashboard/system-activity   ESAVI-DASH-012   SUPERADMIN   (nuevo)
```

Las dos rutas no reciben parámetros. Cadena: `tokenValidation, validateUserRole(ROL), handler`, sin validadores, igual que `ESAVI-DASH-006`.

### 3.5 Reglas de negocio por operación

**`ESAVI-DASH-011` — actividad reciente.**

1. `resolveUserGeoScopeIds(authUser)`. Si es `[]` → `territory: []`, `myCases: []`, `scope.hasAssignments = false`, sin consultar.
2. Dos consultas parametrizadas en `Promise.all` sobre el mismo CTE: actividad del territorio y mis casos.
3. Mapeo de `action` en el servicio.
4. Resolución de autores con F59 sobre `territory`. `myCases` no lleva autor.
5. Cualquier fallo → 500 `DASH_011_FETCH_FAILED`.

**`ESAVI-DASH-012` — actividad del sistema.**

1. Las dos consultas de §3.2 en `Promise.all`.
2. Cualquier fallo → 500 `DASH_012_FETCH_FAILED`.

No aplica alcance geográfico: la ruta es SUPERADMIN, que no tiene restricción territorial (F49).

**Escrituras:** ninguna. No aplica el contrato de update diferencial.

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `dashboard.recentActivitySuccess` | 200 de `ESAVI-DASH-011` |
| `dashboard.recentActivityFailed` | 500 `DASH_011_FETCH_FAILED` |
| `dashboard.systemActivitySuccess` | 200 de `ESAVI-DASH-012` |
| `dashboard.systemActivityFailed` | 500 `DASH_012_FETCH_FAILED` |

### 3.7 Forma de la respuesta

```
// 011
{ ok, message, data: {
    windowDays: 30,
    scope: { restricted, hasAssignments },
    territory: [ { caseId, caseCode, occurredAt, method, action, author } ],   // author: email (ADMIN+) | null
    myCases:   [ { caseId, caseCode, statusCode, lastActionAt, lastAction } ]
} }

// 012
{ ok, message, data: {
    generatedAt, activeSessions, activeUsers24h, activeUsers7d, sessionsStarted24h, sessionsStarted7d,
    revocations7d: [ { reason, count } ]
} }
```

- `011` no devuelve `detail`, ni `userId`, ni datos del paciente.
- `012` no devuelve ningún `userId`, `sessionId`, IP ni `userAgent`.

---

## 4. Plan de implementación

Depende de que F65 esté implementado: dominio `DASH`, universo U y constantes del workflow. No depende de F66 a F68.

1. **Catalogar `DEUDA-048`.** En `references/TECHNICAL_DEBT.md`: las 49 tablas declaran `"appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb` (un objeto), mientras la convención y todos los servicios escriben un arreglo. Una fila insertada por otra vía rompe cualquier `jsonb_array_elements`. Enlace bidireccional con este spec.
   *Verificación:* `grep -n "DEUDA-048" references/TECHNICAL_DEBT.md references/functional/specs/69-*.md` devuelve las dos referencias.

2. **Registrar las operaciones.** Filas `dashboard | 011` (actividad reciente de casos del territorio y «mis casos», `appDetails` de `esaviCase` y `caseWorkflow`, ventana de 30 días. `GET /recent-activity`, USER) y `dashboard | 012` (conteos de sesiones de `appSession`. `GET /system-activity`, SUPERADMIN) en `references/CONVENTIONS.md` §6.
   *Verificación:* `grep -n "dashboard | 01[12]" references/CONVENTIONS.md` devuelve las dos filas.

3. **Constantes, tipos e i18n.** Las de §3.3 y las cuatro claves de §3.6.
   *Verificación:* `npm run build` y `npm run i18n:check` salen en 0.

4. **`ESAVI-DASH-011` — actividad reciente.** `getRecentActivityService(authUser, lang)`, controlador `getRecentActivity` y ruta `GET /recent-activity`.
   *Verificación:*
   - como ADMIN, con una fixture que cierra y reabre un caso, el feed trae `CASE_REOPENED` y luego `CASE_CLOSED`, en ese orden, con `author` en forma de email;
   - el mismo feed pedido por un `USER` trae `author: null`;
   - un caso con `appDetails = '{}'` en la base no rompe la respuesta.

5. **`ESAVI-DASH-012` — actividad del sistema.** `getSystemActivityService(lang)`, controlador `getSystemActivity` y ruta `GET /system-activity`.
   *Verificación:* después de un login y un logout en la fixture, `sessionsStarted24h` sube en 1 y `revocations7d` suma 1 en `LOGOUT`.

6. **Pruebas de convención.** Dos filas en `tests/setup/routeRules.ts` (`011` → `USER`, `012` → `SUPERADMIN`), con el conteo de `ROUTE_RULES` +2, y los escenarios de §5 en `tests/contract/dashboard.test.ts`.
   *Verificación:* `npm test -- roles dashboard` sale en 0; `ANALYTICS` recibe 403 en `011` y `ADMIN` recibe 403 en `012`.

---

## 5. Criterios de aceptación

**Superficie y roles**

- [ ] `GET /api/dashboard/recent-activity` responde 200 de `USER` a `SUPERADMIN`, 403 a `ANALYTICS` y 401 sin token.
- [ ] `GET /api/dashboard/system-activity` responde 200 a `SUPERADMIN`, 403 a `ADMIN` y 401 sin token.
- [ ] Los puntos del código de operación coinciden en las dos operaciones (`DASH_011_*`, `DASH_012_*`).
- [ ] `DEUDA-048` está catalogada y enlazada en los dos sentidos.

**Feed del territorio (`011`)**

- [ ] Crear un caso produce **un** evento `CASE_CREATED`, no dos: `ESAVI-CASEFLOW-001` no aparece.
- [ ] Cerrar y reabrir un caso produce `CASE_CLOSED` y `CASE_REOPENED`, ordenados por `occurredAt` descendente.
- [ ] Cada `method` de la tabla de §2 se traduce a su `action`, y un `method` desconocido inyectado en la fixture se traduce a `OTHER`.
- [ ] Una entrada con `createdAt` de hace 31 días no aparece; una de hace 29 sí.
- [ ] Con 25 eventos en la ventana, `territory` trae 20.
- [ ] Un usuario restringido al territorio A no recibe ningún evento de casos del B.
- [ ] Un caso desactivado no aporta eventos.
- [ ] Un caso cuyo `appDetails` es `{}` en la base no rompe la respuesta y no aporta eventos.
- [ ] Ninguna entrada trae `detail` ni un `userId`.

**Autores (F59)**

- [ ] Para ADMIN y SUPERADMIN, `author` es el email descifrado del autor.
- [ ] Para `USER`, `NOTIFIER`, `INVESTIGATOR` y `EVALUATOR`, `author` es `null` en todos los eventos, incluidos los suyos.
- [ ] Una entrada con `user = 'undefined'` tiene `author: null` también para ADMIN.
- [ ] La resolución de autores hace como máximo una consulta a `appUser` por petición.

**Mis casos (`011`)**

- [ ] Un usuario que hizo `CASE-004` sobre el caso X y luego `CASEFLOW-010` sobre el mismo caso ve X **una vez**, con `lastAction = 'VALIDATION_REQUESTED'`.
- [ ] Un caso en el que solo intervino otro usuario no aparece.
- [ ] Un caso en el que el usuario intervino hace 31 días, y no después, no aparece.
- [ ] `statusCode` es el estado actual del workflow, no el de la intervención.
- [ ] Con 12 casos con intervención, `myCases` trae 10, ordenados por `lastActionAt` descendente.
- [ ] Un caso propio que salió del alcance del usuario (reasignación territorial) no aparece.

**Alcance vacío**

- [ ] Un usuario sin asignaciones recibe 200 con `territory: []`, `myCases: []` y `scope.hasAssignments = false`.

**Sistema (`012`)**

- [ ] Una sesión con `revokedAt IS NULL` y `expiresAt` futura cuenta en `activeSessions`; con `expiresAt` pasada no cuenta; con `deletedAt` no cuenta.
- [ ] Dos sesiones del mismo usuario iniciadas hoy suman 2 en `sessionsStarted24h` y 1 en `activeUsers24h`.
- [ ] `revocations7d` trae siempre los seis motivos de `SESSION_REVOKE_REASONS`, con 0 cuando no hubo, más `UNSPECIFIED` si existe alguna revocación con `revokedReason` nulo.
- [ ] La respuesta no contiene ningún `userId`, `sessionId`, `ipAddress`, `userAgent` ni email.

**Sin escrituras**

- [ ] Llamar a `011` y `012` no modifica ninguna fila, ni siquiera de `appSession`.

**Cierre**

- [ ] Las cuatro claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

No va el bloque de update diferencial, porque ninguna operación escribe sobre una fila existente.

---

## 6. Decisiones tomadas y descartadas

**Fuente de los eventos**

- **Sí:** solo `esaviCase` y `caseWorkflow`. Son uno a uno con el caso y cubren el alta, la edición y cada transición del expediente, que es lo que un usuario reconoce como «pasó algo con el caso».
- **No:** las ~22 tablas satélite. Habría que unir 24 expansiones de JSONB sin índice en cada carga del home, el feed se llenaría de ediciones menores (una vacuna, un antecedente) y cada satélite nueva obligaría a tocar el dashboard. Completar una etapa ya resume ese trabajo.
- **Sí:** excluir `ESAVI-CASEFLOW-001`, que se escribe en la misma transacción que `ESAVI-CASE-001` y duplicaría cada alta.
- **Sí:** leer `appDetails` en lugar de crear una tabla de eventos. Es el registro que ya existe y que todos los servicios mantienen. Una tabla nueva solo se justifica si se cumple la condición de rendimiento de F65 §7.
- **Sí:** protegerse con `jsonb_typeof = 'array'` y catalogar `DEUDA-048`, en vez de corregir el `DEFAULT` de 49 tablas en este spec.

**Presentación**

- **Sí:** traducir `method` a un `action` estable, con un mapa cerrado y `OTHER` como valor de reserva. El frontend localiza sin conocer los códigos internos, y un código nuevo no rompe el contrato.
- **No:** exponer `detail`. Es texto libre en inglés pensado para auditoría, y puede contener identificadores.
- **No:** deducir la etapa de un `STAGE_*` a partir de `detail`. Extraer datos de un texto libre se rompe en cuanto alguien cambia la redacción.

**Autores**

- **Sí:** reutilizar `resolveAppDetailsAuthorsService` (F59) sin modificarlo. La regla de quién ve al autor ya está decidida y probada.
- **Sí:** «mis casos» filtra por el `userId` del token en el servidor. Así un `USER` ve su trabajo sin que el feed le revele la identidad de nadie.
- **No:** mostrar «tú» como autor a un `USER` en sus propios eventos. Exigiría que el frontend comparara con un `userId` que la respuesta no expone, o que el backend añadiera un tratamiento especial a la regla de F59.

**Ventana y tamaño**

- **Sí:** 30 días fijos, 20 eventos y 10 casos, en constantes. Acotan el coste de la expansión y bastan para un feed de inicio.
- **No:** el periodo `from`/`to` de F66. Un feed responde «qué es lo último», no «qué pasó en marzo».
- **No:** paginación ni «cargar más». Para el historial completo de un caso está su propio `GET`.
- **No:** «desde mi última visita». Exige guardar estado por usuario.

**Actividad del sistema**

- **Sí:** un endpoint aparte, solo para `SUPERADMIN`. Su rol y su contenido no tienen relación con los casos.
- **Sí:** solo conteos. Responden «¿se usa el sistema?» y «¿hay algo raro con las sesiones?» sin exponer a nadie.
- **No:** IP, `userAgent` ni lista de conectados. Son datos personales, y su consulta es un caso de uso de investigación de seguridad que merece su propio spec y su propia auditoría.
- **Sí:** los seis motivos de revocación siempre presentes, tomados de `SESSION_REVOKE_REASONS`.
- **No:** contar logins fallidos. El esquema no los registra.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Expandir `appDetails` de todos los casos del alcance es costoso cuando el historial crece | La ventana de 30 días se aplica sobre cada entrada después de expandir, así que el coste crece con las filas del alcance. La condición de entrada de F65 §7 aplica, y la salida natural es una tabla de eventos o un índice de expresión |
| Una fila con `appDetails = '{}'` u otro valor no arreglo tumba la consulta | `jsonb_typeof(...) = 'array'` antes de expandir. Hay una prueba de contrato con `{}`. `DEUDA-048` catalogada |
| Una entrada con `createdAt` mal formado hace fallar el `::timestamptz` | Todos los servicios escriben `new Date()` y se serializa en ISO. Si aparece una entrada corrupta, el endpoint responde 500 `DASH_011_FETCH_FAILED` con la traza, en lugar de ocultar el dato en silencio |
| Un código de operación nuevo que escriba en estas tablas aparece como `OTHER` | Es visible en el feed. Añadirlo al mapa es un cambio de una línea en una constante |
| Un usuario reasignado deja de ver en «mis casos» casos que sí trabajó | Es la regla de F49: el alcance manda sobre la autoría |
| Volumen de `appSession` | F63 purga las sesiones antiguas por retención, así que la tabla está acotada |

---

## 8. Impacto en el contrato HTTP

**Aditivo.** Dos rutas nuevas: `GET /api/dashboard/recent-activity` (`USER`) y `GET /api/dashboard/system-activity` (`SUPERADMIN`). Ninguna ruta existente cambia.

**Notas para el spec del frontend:**

1. `author` es un email solo para ADMIN y SUPERADMIN. Para el resto es siempre `null`, también en sus propios eventos.
2. `action` se localiza en la interfaz. `method` es para soporte, no para mostrar.
3. `STAGE_STARTED` y `STAGE_COMPLETED` no dicen qué etapa. Si hace falta, se muestra el estado actual del caso.
4. El feed cubre 30 días (`windowDays`) y como máximo 20 eventos. No hay «ver más»: el historial completo está en el detalle del caso.
5. «Mis casos» lleva directamente a `GET /api/esavi-cases/:id`. `statusCode` es el estado actual.
6. `revocations7d` con `REUSE_DETECTED` mayor que 0 indica un posible robo de token de refresco (F42) y merece un aviso visual destacado para el SUPERADMIN.
7. `scope.hasAssignments = false` → aviso de «sin territorio asignado», como en F65.

---

## Lo que **no** está en este spec

- Actividad de las tablas satélite del caso.
- `detail`, o la etapa de un `STAGE_*`.
- Ventana o tope configurables, paginación, «cargar más».
- «Desde mi última visita» o eventos leídos.
- Casos inactivos en el feed.
- Tabla de eventos o índices sobre `appDetails`.
- Corregir el `DEFAULT` de `appDetails` (`DEUDA-048`).
- IP, `userAgent`, lista de conectados o intentos fallidos en la actividad del sistema.
- Actividad sobre usuarios, catálogos o configuración.
- Notificaciones en tiempo real.

Cada uno de esos, si aterriza, va en su propio spec.
