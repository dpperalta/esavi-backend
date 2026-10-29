# SPEC F64 — Roles por etapa del caso: NOTIFIER, INVESTIGATOR y EVALUATOR

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización por nivel), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F44 (`caseWorkflow`: etapas, `complete-stage`, `close`, `reopen`, validación)**, **SPEC F49 (alcance geográfico — ortogonal, no se toca)**, SPEC F60 (escrituras de los satélites del paso 4 en USER), SPEC F61 (guardia de expediente cerrado)
> **Fecha:** 2026-10-29
> **Objetivo:** Que el recorrido del caso admita tres roles anidados (NOTIFIER, que solo notifica; INVESTIGATOR, que además investiga; y EVALUATOR, que además clasifica al final, cierra y reabre) sobre un `USER` que baja a rol de consulta sin escritura, dentro de la escalera numérica actual y sin quitar nada a ningún usuario existente.

---

## 1. Por qué existe este spec

**A — Hoy hay un solo rol operativo para todo el expediente.** Cualquier escritura del caso
exige `USER` (25): la notificación y sus satélites, la investigación y sus satélites,
`evaluationInstitution`, `finalClassification`, `complete-stage` (`ESAVI-CASEFLOW-007`),
`close` (`008`) y las dos operaciones de validación (`010`, `011`). Solo hay un escalón por
encima, `reopen` (`009`, `caseWorkflow.routes.ts:72`), que exige `ADMIN`. No hay forma de
dar de alta a un notificador de un centro de salud sin darle también la investigación
y la clasificación final.

**B — Las cuatro fases del workflow no coinciden con la división que se pide.** `STAGES`
(`caseWorkflow.service.ts:44`) las ordena así: `CLASSIFICATION`, `NOTIFICATION`,
`INVESTIGATION` y `FINAL_CLASSIFICATION`. `classification` es la **clasificación inicial**
(paso 3), donde se declara `isSeriousEvent`. `esavi-frontend/references/CASE-PROCESS.md` §1.1
la agrupa con «Notificación». Por eso pertenece al NOTIFIER. Al EVALUATOR solo le
corresponde `finalClassification` (paso 6).

**C — `complete-stage` es una sola ruta para las cuatro etapas.** La etapa viaja en el body
(`completeCaseWorkflowStageValidator`), así que el middleware de ruta no la ve. Con un único
`validateUserRole`, un NOTIFIER podría sellar el fin de la investigación o de la
clasificación final. Hace falta un guard por etapa en el servicio. El §9 de
`references/CONVENTIONS.md` lo prohíbe hoy («la ruta es el único punto de autorización»),
de modo que el spec declara la excepción.

**D — Los roles caben en la escalera porque son anidados.** `validateUserRole`
(`roleValidation.middleware.ts:6-32`) admite a quien tenga un nivel mayor o igual al de la ruta.
El nivel del usuario sale de `appRole.level`, y `ROLE_LEVELS` solo se usa si esa columna es nula.
El nivel exigido sale de la constante. USER ⊂ NOTIFIER ⊂ INVESTIGATOR ⊂ EVALUATOR ⊂ ADMIN es una
cadena, y una cadena se expresa con números sin cambiar el modelo de autorización.
Es la única razón por la que este spec no necesita permisos por etapa (§6).

**E — La DEUDA-031 está en el archivo que hay que tocar.**
[DEUDA-031](../../TECHNICAL_DEBT.md#deuda-031): `roles.constants.ts:2-5` lee `ROLE_*`, unas
variables que no existen en ningún `.env`. Añadir tres roles más con el mismo patrón
ampliaría la deuda. El spec la salda: los siete roles pasan a ser literales.

**F — No hay forma de dar de alta un usuario que todavía no registre.** `ESAVI-USER-001` exige
`roleId` (`user.validator.ts:48`), así que todo usuario nace con un rol. El más bajo que lee
catálogos y casos es `USER`, que hoy también escribe el expediente entero. `ANALYTICS` (10) no
sirve, porque no alcanza ni las lecturas de 25. Hace falta un rol de consulta por debajo del
umbral de escritura: `USER` baja a 20 y `NOTIFIER` (25) pasa a ser ese umbral.

---

## 2. Alcance

**Dentro:**

- **Constantes.** `src/constants/roles.constants.ts` gana `NOTIFIER` (25), `INVESTIGATOR` (30)
  y `EVALUATOR` (40). Los siete roles pasan a ser literales y desaparece todo `process.env.ROLE_*`,
  lo que salda la [DEUDA-031](../../TECHNICAL_DEBT.md#deuda-031). No se crea ninguna
  variable de entorno nueva.
- **`USER` baja de 25 a 20 y pasa a ser rol de consulta.** Sigue leyendo todo lo que lee hoy
  (catálogos, geografía y los casos de su territorio, F49), pero no escribe en el expediente.
  No se renombra ni se borra, y sigue siendo un rol independiente de `NOTIFIER`.
- **Semilla.** `ESAVI-SEED-001` (`src/controllers/seed.controller.ts`) hace `findOrCreate` de los
  tres roles nuevos, con nombre y código literales, el nivel de la constante e `isSystemRole: true`.
  El `findOrCreate` de `USER` pasa a tomar su nivel de la constante (20) y a crearlo con
  `isSystemRole: true`.
- **Migración de datos existentes.** Script de un solo uso `scripts/grant-evaluator-to-users.ts`,
  que hace dos cosas en este orden y en una transacción:
  1. Añade una asignación `EVALUATOR` a cada usuario con una asignación `USER` activa, sin retirar
     esta última.
  2. Baja la fila `USER` de `appRole` a `level = 20` con `isSystemRole = true`.
  
  Es idempotente, y ningún usuario existente pierde nada en ningún momento.
- **Rutas.** Pasan a `NOTIFIER` las escrituras de los pasos 1 a 4 que hoy están en `USER`, junto
  con `complete-stage` (`CASEFLOW-007`) y `request-validation` (`CASEFLOW-010`). Pasan a
  `INVESTIGATOR` el `001`, `004` y `005A` de `investigation` y de sus 13 satélites, incluido
  `evaluationInstitution`. Pasan a `EVALUATOR` el `001` y el `004` de `finalClassification`,
  junto con `close` (`CASEFLOW-008`), `reopen` (`CASEFLOW-009`, hoy `ADMIN`) y
  `resolve-validation` (`CASEFLOW-011`).
- **Lecturas.** Todas siguen en el literal `USER`, ahora 20.
- **Guard por etapa en `complete-stage`** (`CASEFLOW-007`). Lo aplica el servicio con un mapa
  etapa→nivel y responde 403 `CASEFLOW_007_STAGE_FORBIDDEN`. Va acompañado de un helper
  compartido que calcula el nivel efectivo del usuario con la misma fórmula que
  `validateUserRole`.
- **Garantía explícita del ADMIN.** `ADMIN` y `SUPERADMIN` cierran, reabren y completan cualquier
  etapa, y lo hacen por la escalera, sin una rama propia. Hay un test que lo fija.
- **Norma y pruebas.** Se actualizan:
  - el §9 de `references/CONVENTIONS.md` (niveles, política por familia y excepción del guard);
  - `tests/setup/routeRules.ts`, `tests/setup/auth.ts` (`TEST_ROLES`) y `tests/setup/database.ts`
    (roles sembrados);
  - las suites de `tests/contract/` del recorrido del caso, que hoy escriben con
    `authHeader('USER')` y pasan a escribir con el rol de su etapa.
- **i18n.** Una clave nueva, `caseWorkflow.stageForbidden`, en `es`, `en` y `nl`.

**Fuera de alcance (otros specs):**

- **Roles no anidados.** Por ejemplo, un evaluador que no notifica. Exige pasar a permisos por
  etapa (`appPermission` / `appRolePermission`, hoy sin modelo) y es otro modelo de autorización.
- **Restringir lecturas por rol.** Todas las lecturas del caso siguen en `USER` (20). Que un
  NOTIFIER no vea la investigación ni la clasificación final queda como pregunta abierta de
  producto (§6).
- **Renombrar o borrar el rol `USER`.** Solo cambia su nivel.
- **Retirar la asignación `USER`** a los usuarios migrados.
- **Cambiar lo que hoy está por encima de 25 y no es del recorrido por etapas.** Son los `005A`
  en `ADMIN` (`esaviCase`, `patient`, `classification`, `notification`, `finalClassification`),
  todos los `002B`, `005B` y `005C`, y la familia `caseWorkflow` `002B`/`005A`/`005B`.
- **La semilla de `ADMIN` y `ANALYTICS` en producción**, que hoy solo existen en
  `tests/setup/database.ts`.
- **Los nombres de rol que `ESAVI-SEED-001` lee de `ESAVI_SUPERADMIN` / `ESAVI_USER`**, y el
  reconocimiento por nombre de `isAdmin`. Quedan anotados como riesgo en §7.
- **El alcance geográfico (SPEC F49).** Es ortogonal: los roles nuevos no son admin y quedan
  acotados igual que `USER`.
- **El frontend.** Su spec cita los códigos de §8.

---

## 3. Modelo de datos

No hay tablas ni columnas nuevas. `appRole` (`esaviapp.sql:273-288`) y `appUserRole`
(`esaviapp.sql`, `UQ_appUserRole_active_user_role`) ya admiten roles arbitrarios con su
`level`. Lo que cambia es configuración, filas de datos y el nivel mínimo de las rutas.

### 3.1 Constantes — `src/constants/roles.constants.ts`

| | Antes | Después |
|---|---|---|
| `ROLES.SUPERADMIN` | `process.env.ROLE_SUPERADMIN \|\| 'SUPERADMIN'` | `'SUPERADMIN'` |
| `ROLES.ADMIN` | `process.env.ROLE_ADMIN \|\| 'ADMIN'` | `'ADMIN'` |
| `ROLES.EVALUATOR` | — | `'EVALUATOR'` |
| `ROLES.INVESTIGATOR` | — | `'INVESTIGATOR'` |
| `ROLES.NOTIFIER` | — | `'NOTIFIER'` |
| `ROLES.USER` | `process.env.ROLE_USER \|\| 'USER'` | `'USER'` |
| `ROLES.ANALYTICS` | `process.env.ROLE_ANALYTICS \|\| 'ANALYTICS'` | `'ANALYTICS'` |

| Rol | Nivel antes | Nivel después |
|---|---|---|
| `SUPERADMIN` | 100 | 100 |
| `ADMIN` | 50 | 50 |
| `EVALUATOR` | — | **40** |
| `INVESTIGATOR` | — | **30** |
| `NOTIFIER` | — | **25** |
| `USER` | 25 | **20** |
| `ANALYTICS` | 10 | 10 |

- **Sin variables de entorno.** Ni las cuatro que se leían sin existir ni otras nuevas.
  Un nombre de rol es un identificador del código, igual que un código `ESAVI-*`.
- **`USER` (20) es el umbral de lectura y `NOTIFIER` (25) el de escritura.** `USER` sigue siendo
  el literal de toda lectura del caso y de toda ruta que no es del caso (catálogos, geografía,
  MedDRA, WHODrug, `logout-all`…). Como 20 < 25, todos los roles de etapa las siguen pasando.
  `NOTIFIER` es el literal de toda escritura de los pasos 1 a 4.
- **No hay empates.** Cada rol tiene un nivel propio, así que `roleBelow` de `roles.test.ts` es
  determinista.
- **Los huecos entre niveles son deliberados.** Hay espacio entre 10 y 20, entre 25 y 30, entre
  30 y 40 y entre 40 y 50, por si un rol futuro tiene que caber en la cadena sin renumerar.

**Helper nuevo — `src/helpers/roleLevel.helper.ts`**, exportado por el barrel de `helpers/`:
`getUserRoleLevel(authUser)` devuelve
`Math.max(0, ...roles.map(r => r.level ?? ROLE_LEVELS[r.name.toUpperCase()] ?? 0))`.
Es la fórmula que hoy está en línea en `roleValidation.middleware.ts:16-23`. El middleware pasa
a usarlo, y el guard de §3.5 también, de modo que los dos no pueden divergir.
`requesterLevel` de `appRole.service.ts:31`, que no tiene el fallback a la constante, no se toca.

### 3.2 Semilla — `ESAVI-SEED-001`

`src/controllers/seed.controller.ts` añade, después del `findOrCreate` de `USER`, uno por
cada rol nuevo:

| `code` | `name` | `level` | `isSystemRole` | `description` |
|---|---|---|---|---|
| `NOTIFIER` | `NOTIFIER` | 25 | `true` | `Case notification (steps 1-4)` |
| `INVESTIGATOR` | `INVESTIGATOR` | 30 | `true` | `Case notification and investigation (steps 1-5)` |
| `EVALUATOR` | `EVALUATOR` | 40 | `true` | `Full case path, final classification, close and reopen` |

- **`where: { code }`, no `where: { name }`.** El `code` es `UQ_appRole_code`. El nombre, en
  cambio, no tiene restricción de unicidad en el DDL.
- **El nivel sale de `ROLE_LEVELS[ROLES.X]`, no de un número escrito a mano.** Si se mueve la
  constante, la semilla la sigue.
- **`isSystemRole: true`.** `ESAVI-APPROLE-004` y `005A` rechazan con 403
  `APPROLE_00x_SYSTEM_ROLE` editar o desactivar estos roles. Su nivel está atado a los
  literales de ruta. Si un ADMIN bajara el EVALUATOR a 35, el rol seguiría pasando la
  investigación y dejaría de cerrar.
- `appDetails` lleva la entrada habitual de la semilla: `method: 'ESAVI-SEED-001'`,
  `detail: 'Role created by seed script'`.
- **El `findOrCreate` de `USER` también cambia.** Hoy escribe `level: 25` a mano
  (`seed.controller.ts:92`) e `isSystemRole: false`. Pasa a `ROLE_LEVELS[ROLES.USER]` (20) e
  `isSystemRole: true`. Es un `findOrCreate`, así que solo afecta a una BD donde `USER` no exista
  aún. La fila de una BD ya sembrada la corrige el script de §3.3.
- **La semilla no siembra `ADMIN` ni `ANALYTICS`.** No lo hace hoy y este spec no lo cambia (§2).

### 3.3 Migración de los datos existentes

Es un script de un solo uso, siguiendo el precedente de `scripts/backfill-appUser-nameTokens.ts`:
`scripts/grant-evaluator-to-users.ts`, que se ejecuta con
`NODE_ENV=<env> npx ts-node scripts/grant-evaluator-to-users.ts`. Todo corre en **una sola
transacción**: o se aplican las dos partes o ninguna.

**Parte 1 — conceder `EVALUATOR` a los titulares actuales de `USER`.**

1. Resuelve el `roleId` de `USER` y de `EVALUATOR` por `code`. Si falta cualquiera de los dos,
   aborta con un mensaje que pide ejecutar antes `ESAVI-SEED-001`. No crea roles.
2. Selecciona las asignaciones de `USER` vigentes, con el mismo predicado que
   `UQ_appUserRole_active_user_role`: `isActive = true`, `deletedAt IS NULL` y `validTo IS NULL`.
3. Para cada `userId` que **no** tenga ya una asignación `EVALUATOR` vigente, inserta una con
   `validFrom: now`, `assignedByUserId: null` y esta entrada en `appDetails`:
   `{ createdAt, user: 'migrationScript', method: 'SPEC-F64-MIGRATION', detail: 'EVALUATOR granted to preserve pre-F64 USER capabilities' }`.

**Parte 2 — bajar `USER` a 20.**

4. Si la fila `USER` de `appRole` tiene `level ≠ 20` o `isSystemRole ≠ true`, la actualiza a
   `level = 20`, `isSystemRole = true` y `updatedAt = now`. Añade a su `appDetails` la entrada
   `{ createdAt, user: 'migrationScript', method: 'SPEC-F64-MIGRATION', detail: 'USER lowered from <old> to 20 (read-only role)' }`.
   Si ya está en 20 y es de sistema, no escribe nada.
5. Imprime cuántas asignaciones creó, cuántos usuarios omitió porque ya la tenían y si actualizó
   la fila `USER`.

- **El orden es la garantía.** La parte 1 va antes que la 2, en la misma transacción. Así, ningún
  titular de `USER` pasa nunca por un estado en el que tenga 20 sin tener ya 40: nadie pierde
  nada en ningún instante.
- **Hay que bajar el nivel en BD, no basta con la constante.** `validateUserRole` lee
  `appRole.level`, y la constante solo se usa si es nulo. Con la fila en 25, un `USER` seguiría
  escribiendo los pasos 1 a 4 aunque `ROLE_LEVELS.USER` diga 20.
- **Es aditivo en las asignaciones.** La asignación `USER` se conserva, y el nivel efectivo de sus
  titulares pasa de 25 a 40 por `Math.max`.
- **Es idempotente.** La segunda ejecución crea 0 asignaciones y no toca la fila `USER`. El índice
  único lo garantiza aunque el paso 3 fallara.
- **Se revierte** en dos pasos: devolver la fila `USER` a `level = 25` y desactivar las
  asignaciones que lleven `method: 'SPEC-F64-MIGRATION'`.
- **No es un update diferencial del canon, pero respeta su principio.** La parte 1 es una
  inserción con intención propia: registra una concesión de rol. La parte 2 es una corrección de
  datos de un solo uso. No pasa por `buildDifferentialUpdate` porque no es un endpoint, pero solo
  escribe si el valor guardado difiere del de destino. Sin diferencia, no hay `UPDATE` ni entrada
  en `appDetails`.

Un usuario dado de alta **después** de la migración con el rol `USER` tiene nivel 20: consulta y
no registra. El ADMIN decide qué rol de etapa le asigna cuando tenga que registrar.

### 3.4 Superficie HTTP — matriz de rutas

Solo cambia el rol mínimo. Ninguna ruta se crea, se borra ni se renumera, y ningún controlador
cambia su forma de respuesta.

#### 3.4.1 Notificación: pasos 1 a 4, fases `CLASSIFICATION` y `NOTIFICATION` — `USER` → `NOTIFIER`

Toda escritura de estos pasos que hoy está en `USER` pasa a `NOTIFIER`. El nivel exigido sigue
siendo 25, porque `NOTIFIER` vale lo que valía `USER`. Lo que cambia es que `USER`, ahora en 20,
deja de alcanzarlas. Los `005A` que ya estaban en `ADMIN` no se tocan.

| Entidad | Ruta base | Códigos que cambian | Antes | Después |
|---|---|---|---|---|
| `patient` (paso 1) | `/api/patients` | `ESAVI-PATIENT-001`, `-004` | `USER` | `NOTIFIER` |
| `esaviCase` (paso 2) | `/api/esavi-cases` | `ESAVI-CASE-001`, `-004` | `USER` | `NOTIFIER` |
| `notifier` (paso 2) | `/api/notifiers` | `ESAVI-NOTIFIER-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `classification` (paso 3, clasificación **inicial**) | `/api/classifications` | `ESAVI-CLASSIF-001`, `-004` | `USER` | `NOTIFIER` |
| `notification` (paso 4) | `/api/notifications` | `ESAVI-NOTIFCN-001`, `-004` | `USER` | `NOTIFIER` |
| `severeNotification` | `/api/severe-notifications` | `ESAVI-SEVNOT-001`, `-004` | `USER` | `NOTIFIER` |
| `nonSevereNotification` | `/api/non-severe-notifications` | `ESAVI-NSEVNOT-001`, `-004` | `USER` | `NOTIFIER` |
| `notificationEvent` | `/api/notification-events` | `ESAVI-NOTIFEVT-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `notificationMedication` | `/api/notification-medications` | `ESAVI-NOTIFMED-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `notificationVaccine` | `/api/notification-vaccines` | `ESAVI-NOTIFVAC-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `notificationDiluent` | `/api/notification-diluents` | `ESAVI-NOTIFDIL-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `notificationPregnancy` | `/api/notification-pregnancies` | `ESAVI-NOTIFPRG-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `notificationPregnancyComplication` | `/api/notification-pregnancy-complications` | `ESAVI-PREGCOMP-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |
| `notificationMedicalHistory` | `/api/notification-medical-histories` | `ESAVI-MEDHIST-001`, `-004`, `-005A` | `USER` | `NOTIFIER` |

Son **36 códigos**. Sin cambio, y por encima de 25: el `005A` de `patient`, `esaviCase`,
`classification` y `notification`, que sigue en `ADMIN`. `severeNotification` y
`nonSevereNotification` no tienen `005A`.

#### 3.4.2 Investigación: paso 5, fase `INVESTIGATION` — `USER` → `INVESTIGATOR`

| Entidad | Ruta base | Códigos que cambian | Antes | Después |
|---|---|---|---|---|
| `investigation` | `/api/investigations` | `ESAVI-INVESTGN-001`, `-004`, `-005A` | `USER` | `INVESTIGATOR` |
| `investigationSource` | `/api/investigation-sources` | `ESAVI-INVSRC-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationAutopsy` | `/api/investigation-autopsies` | `ESAVI-INVAUT-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationMedicalHistory` | `/api/investigation-medical-histories` | `ESAVI-INVMEDH-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationClinicalEvaluation` | `/api/investigation-clinical-evaluations` | `ESAVI-INVCLIEV-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationVaccinationContext` | `/api/investigation-vaccination-contexts` | `ESAVI-INVVACTX-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationColdChain` | `/api/investigation-cold-chains` | `ESAVI-INVCOLD-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationAdministrationError` | `/api/investigation-administration-errors` | `ESAVI-INVADMER-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationCommunity` | `/api/investigation-communities` | `ESAVI-INVCOMM-001`, `-004` | `USER` | `INVESTIGATOR` |
| `investigationTeamMember` | `/api/investigation-team-members` | `ESAVI-INVTEAM-001`, `-004`, `-005A` | `USER` | `INVESTIGATOR` |
| `investigationVaccineAdministered` | `/api/investigation-vaccines-administered` | `ESAVI-INVVACAD-001`, `-004`, `-005A` | `USER` | `INVESTIGATOR` |
| `investigationDiagnostic` | `/api/investigation-diagnostics` | `ESAVI-INVDIAG-001`, `-004`, `-005A` | `USER` | `INVESTIGATOR` |
| `investigationPregnancyCondition` | `/api/investigation-pregnancy-conditions` | `ESAVI-INVPREG-001`, `-004`, `-005A` | `USER` | `INVESTIGATOR` |
| `evaluationInstitution` | `/api/evaluation-institutions` | `ESAVI-EVALINST-001`, `-004`, `-005A` | `USER` | `INVESTIGATOR` |

Son **34 códigos**. Los ocho satélites 1:1 no tienen `005A` (§9: tablas de una fila por padre).

#### 3.4.3 Clasificación final: paso 6, fase `FINAL_CLASSIFICATION` — `USER` → `EVALUATOR`

| Código | Ruta | Antes | Después |
|---|---|---|---|
| `ESAVI-FINCLASS-001` | `POST /api/final-classifications` | `USER` | `EVALUATOR` |
| `ESAVI-FINCLASS-004` | `PUT /api/final-classifications/:id` | `USER` | `EVALUATOR` |
| `ESAVI-FINCLASS-005A` | `DELETE /api/final-classifications/:id` | `ADMIN` | `ADMIN` (sin cambio) |

**`classification` frente a `finalClassification`.** `classification` es la clasificación
**inicial** del paso 3. Ahí se declara `isSeriousEvent`, que decide el contenido de los pasos
siguientes y la precondición de cierre. Pertenece a la notificación y se queda en `USER`.
`finalClassification` es la conclusión causal del paso 6, la que da el evaluador. Por eso
`classification` sube solo a `NOTIFIER` y `finalClassification` hasta `EVALUATOR`.

#### 3.4.4 `caseWorkflow` — `/api/case-workflows`

| Código | Ruta | Antes | Después |
|---|---|---|---|
| `ESAVI-CASEFLOW-002A` | `GET /` | `USER` | `USER` |
| `ESAVI-CASEFLOW-003` | `GET /:id` | `USER` | `USER` |
| `ESAVI-CASEFLOW-006` | `GET /case/:caseId` | `USER` | `USER` |
| `ESAVI-CASEFLOW-007` | `PATCH /case/:caseId/complete-stage` | `USER` | **`NOTIFIER` + guard por etapa (§3.5)** |
| `ESAVI-CASEFLOW-008` | `PATCH /case/:caseId/close` | `USER` | **`EVALUATOR`** |
| `ESAVI-CASEFLOW-009` | `PATCH /case/:caseId/reopen` | `ADMIN` | **`EVALUATOR`** |
| `ESAVI-CASEFLOW-010` | `PATCH /case/:caseId/request-validation` | `USER` | **`NOTIFIER`** |
| `ESAVI-CASEFLOW-011` | `PATCH /case/:caseId/resolve-validation` | `USER` | **`EVALUATOR`** |
| `ESAVI-CASEFLOW-002B` | `GET /admin` | `ADMIN` | `ADMIN` |
| `ESAVI-CASEFLOW-005A` | `DELETE /:id` | `ADMIN` | `ADMIN` |
| `ESAVI-CASEFLOW-005B` | `PATCH /activate/:id` | `SUPERADMIN` | `SUPERADMIN` |

- **`ADMIN` y `SUPERADMIN` cierran, reabren y completan cualquier etapa siempre.** Lo hacen
  porque 50 y 100 ≥ 40. No hay una rama «si es admin» en el servicio, y no debe haberla:
  sería una segunda vía de autorización. La garantía la fija un test (§5).
- **`010` queda en 25, ahora con el literal `NOTIFIER`.** Pedir revisión es parte del trabajo de
  cualquiera que registre en el caso, pero no de quien solo consulta. **`011` sube a 40.**
  Resolver la revisión es un acto de evaluación, y hoy quien la pide puede resolverla él mismo.
- **`007` pasa al literal `NOTIFIER`.** Es el mínimo de las cuatro etapas, y un `USER` de consulta
  no completa ninguna.
- **`008` exige `EVALUATOR` para cualquier caso.** También para el no grave y sin
  investigación, que cumple las precondiciones solo con `classification` y `notification`.
  Cerrar es una decisión y no depende de qué tan corto fue el recorrido.

#### 3.4.5 Lo que no cambia

Mantienen la matriz del §9 sin cambios:

- **Todas las lecturas del caso** (`002A`, `003`, `006`, y las búsquedas `PATIENT-006`/`-007`)
  de todas las familias, en el literal `USER`. Ahora valen 20, así que un `USER` de consulta lee
  todo lo de su territorio (F49), incluidos los datos personales del paciente. Es la decisión
  tomada (§6).
- **Todas las rutas que no son del caso** y hoy están en `USER` (catálogos, geografía, MedDRA,
  WHODrug, `logout-all`…). Pasan a valer 20 sin tocar su literal.
- **Todos los `002B`**, en `ADMIN`.
- **Los `005B`**, en `ADMIN` o `SUPERADMIN` según la entidad, como hoy.
- **Todos los `005C`**, en `SUPERADMIN`.

Corregir, retirar y deshacer una retirada siguen siendo supervisión o destrucción, no
trabajo de etapa.

**Total: 77 códigos cambian de rol mínimo.** Son 36 de §3.4.1, 34 de §3.4.2, 2 de §3.4.3 y 5 de
§3.4.4. Además, `ESAVI-CASEFLOW-007` gana el guard de §3.5.

### 3.5 Reglas de negocio — guard por etapa de `ESAVI-CASEFLOW-007`

En `src/services/caseWorkflow.service.ts`, junto a `STAGE_FIELD` y `STAGE_STATUS`, se añade
un mapa más:

| Etapa (`CaseWorkflowStage`) | Rol mínimo | Nivel |
|---|---|---|
| `CLASSIFICATION` | `NOTIFIER` | 25 |
| `NOTIFICATION` | `NOTIFIER` | 25 |
| `INVESTIGATION` | `INVESTIGATOR` | 30 |
| `FINAL_CLASSIFICATION` | `EVALUATOR` | 40 |

Es `STAGE_MIN_ROLE: Record<CaseWorkflowStage, string>`, con valores `ROLES.*`. El nivel se lee de
`ROLE_LEVELS`, nunca de un número en línea, y el mapa coincide con la etapa de las rutas
de §3.4. Las dos primeras filas igualan el rol de la ruta, así que nunca rechazan. Se declaran
igualmente para que el mapa sea total sobre `CaseWorkflowStage` y una etapa nueva no pueda
quedar sin umbral.

**Orden en `completeCaseWorkflowStageService`:**

1. **Guard de etapa, lo primero.** Si `getUserRoleLevel(authUser) < ROLE_LEVELS[STAGE_MIN_ROLE[stage]]`,
   responde **403 `CASEFLOW_007_STAGE_FORBIDDEN`** con `caseWorkflow.stageForbidden` y `{ stage }`.
   - Va antes de cargar el expediente: autorizar precede a comprobar la existencia, igual que
     el middleware responde 403 antes de que el handler busque la fila.
   - Así, un NOTIFIER no aprende con un 404 o un 409 si un caso ajeno existe o en qué estado está.
2. Lo demás no cambia: `CASEFLOW_007_CASE_CLOSED`, `CASEFLOW_007_STAGE_NOT_STARTED` y
   `CASEFLOW_007_STAGE_ALREADY_COMPLETED`.

**Por qué un código propio y no `AUTH_ROLE_FORBIDDEN`.** `AUTH_ROLE_FORBIDDEN` significa «tu rol
no alcanza esta ruta», y el frontend lo trata como un acceso denegado a la pantalla.
`CASEFLOW_007_STAGE_FORBIDDEN` significa «la ruta sí, pero esta etapa no»: el usuario puede
seguir en el expediente y solo el botón de esa etapa le está vedado. El status es el mismo,
403, y el `code` los distingue.

**Excepción a §9, regla 2.** Es la única autorización fuera de la ruta que el canon admite, y
se declara allí (paso 9 del plan). Cumple tres condiciones:

- La ruta ya autorizó el nivel mínimo.
- El dato que decide (la etapa) solo existe en el body.
- El guard usa el mismo helper y la misma escala que el middleware.

Un predicado por nombre de rol (`isAdmin`, …) **no** sirve para esto.

**Update diferencial.** Este spec no añade ni modifica ninguna operación que escriba sobre una
fila existente de datos clínicos. `007`, `008`, `009` y `011` conservan su lógica; solo cambia
quién puede invocarlas. Las tres escrituras de datos del spec no pasan por
`buildDifferentialUpdate`, cada una con su razón:

- **El `findOrCreate` de la semilla** crea una fila o no hace nada, y nunca actualiza una
  existente.
- **La inserción de `appUserRole` del script de §3.3** registra una concesión de rol: es una
  escritura con intención propia.
- **La corrección de la fila `USER` del script de §3.3** no es un endpoint, pero aplica el
  principio de §11: solo escribe si el `level` o el `isSystemRole` guardados difieren de los de
  destino.

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `caseWorkflow.stageForbidden` | 403 `CASEFLOW_007_STAGE_FORBIDDEN`. Con `{{stage}}`. es: «Tu rol no permite completar la etapa {{stage}}» · en: «Your role does not allow completing the {{stage}} stage» · nl: «Uw rol staat niet toe de fase {{stage}} af te ronden» |

Va en `src/data/i18n/{es,en,nl}.json`, dentro del bloque `caseWorkflow`, junto a
`stageNotStarted`.

### 3.7 Forma de la respuesta

No cambia ningún `data`. El único contrato nuevo es el error del guard:

    { ok: false, message: "<caseWorkflow.stageForbidden>", code: "CASEFLOW_007_STAGE_FORBIDDEN", errors }

El rol nuevo aparece donde ya aparecen los roles: en `roles[]` de `ESAVI-USER-007` y en
`ESAVI-APPROLE-002A`, con su `level`, sin campos nuevos.

---

## 4. Plan de implementación

Cada paso compila, pasa `npm run check` y se puede commitear solo. La corrección de la
DEUDA-031 va primero porque toca el mismo archivo con la menor superficie posible.

1. **Saldar la DEUDA-031.** En `src/constants/roles.constants.ts`, los cuatro `ROLES.*` pasan a
   ser literales y desaparece todo `process.env.ROLE_*`. En `references/TECHNICAL_DEBT.md`, la
   DEUDA-031 se marca ✅ con una nota de saldo que enlaza a `./functional/specs/64-case-stage-roles.md`,
   y la fila del índice gana el ✅.
   *Verificación:* `grep -n "process.env" src/constants/roles.constants.ts` no devuelve nada;
   `grep -rn "ROLE_SUPERADMIN\|ROLE_ADMIN\|ROLE_USER\|ROLE_ANALYTICS" src/ tests/` no devuelve nada;
   `npm run check` sale en 0 sin tocar ningún test.

2. **Helper `getUserRoleLevel`.** Se crea `src/helpers/roleLevel.helper.ts` y se registra en el
   barrel `src/helpers/index.ts`. `roleValidation.middleware.ts` sustituye su cálculo en línea
   por el helper, sin cambiar la fórmula.
   *Verificación:* `tests/auth/roles.test.ts` pasa sin cambios, con 355 reglas y los dos lados
   de cada una; `grep -n "Math.max" src/middlewares/roleValidation.middleware.ts` solo devuelve
   el cálculo del nivel exigido.

3. **Constantes y fixtures de test.** `ROLES` y `ROLE_LEVELS` ganan `NOTIFIER` (25),
   `INVESTIGATOR` (30) y `EVALUATOR` (40), y `USER` baja a 20.
   - `tests/setup/database.ts` (`seedRoles`) siembra los siete con su `level` de `ROLE_LEVELS`.
   - `tests/setup/auth.ts` (`TEST_ROLES`) crea un usuario por cada uno de los siete.
   - `tests/setup/database.test.ts` comprueba los siete niveles.

   Ninguna ruta cambia todavía: toda ruta en `USER` exige ahora 20, y el usuario de test `USER`
   tiene 20, así que la matriz sigue pasando.
   *Verificación:* `npm test` pasa. `seeded the … canonical roles` devuelve los siete niveles
   `[100, 50, 40, 30, 25, 20, 10]`. `authHeader('NOTIFIER')` obtiene un token válido.

4. **Semilla `ESAVI-SEED-001`.** Tres `findOrCreate` por `code` en
   `src/controllers/seed.controller.ts`, y el de `USER` con el nivel de la constante e
   `isSystemRole: true`, según §3.2.
   *Verificación:* sobre una BD vacía, `GET /api/seed/admin?enable=<SEED_ACTION>` deja
   `USER`, `NOTIFIER`, `INVESTIGATOR` y `EVALUATOR` en `appRole` con `level` 20/25/30/40 e
   `isSystemRole = true`. Una segunda llamada no crea filas. `PUT /api/roles/:id` sobre
   `EVALUATOR` como ADMIN responde 403 `APPROLE_004_SYSTEM_ROLE`.

5. **Notificación → `NOTIFIER`.** Son los 36 códigos de §3.4.1 en sus 14 archivos de `src/routes/`,
   más `ESAVI-CASEFLOW-007` y `-010` en `caseWorkflow.routes.ts`. Sus 38 reglas en
   `tests/setup/routeRules.ts` pasan a `minRole: 'NOTIFIER'`. Las suites de `tests/contract/` de
   esas 14 entidades, y las partes de `caseWorkflow.test.ts` que completan etapas o piden
   validación, escriben con `authHeader('NOTIFIER')` en vez de `'USER'`.
   *Verificación:* `roles.test.ts` pasa: para cada uno de los 38, `USER` recibe 403 y `NOTIFIER`
   no. Las lecturas de esas familias siguen dando ≠ 403 a `USER`. `ROUTE_RULES` sigue teniendo 355
   reglas.

6. **Investigación → `INVESTIGATOR`.** Son los 34 códigos de §3.4.2 en sus 14 archivos de
   `src/routes/`, con sus 34 reglas, que pasan a `minRole: 'INVESTIGATOR'`. Las 14 suites de
   contrato de la investigación escriben con `authHeader('INVESTIGATOR')`.
   *Verificación:* `roles.test.ts` pasa: para cada uno de los 34, `NOTIFIER` recibe 403 e
   `INVESTIGATOR` no.

7. **Clasificación final → `EVALUATOR`.** `ESAVI-FINCLASS-001` y `-004` en
   `finalClassification.routes.ts`, con sus dos reglas. `finalClassification.test.ts` escribe con
   `authHeader('EVALUATOR')`.
   *Verificación:* `roles.test.ts`: `INVESTIGATOR` recibe 403 en los dos y `EVALUATOR` no.

8. **`caseWorkflow`: `008`, `009` y `011` → `EVALUATOR`.** En `caseWorkflow.routes.ts`, con sus
   tres reglas. `009` **baja** desde `ADMIN`. Las suites que cierran, reabren o resuelven
   (`caseWorkflow.test.ts`, `caseClosedGuard.test.ts`) lo hacen con `EVALUATOR` o con `ADMIN`.
   Se añade en `roles.test.ts` un bloque `describe('ADMIN keeps close and reopen')`, que comprueba
   que `ADMIN` y `SUPERADMIN` no reciben 403 en `008`, `009`, `011` ni en
   `complete-stage` con `stage: 'FINAL_CLASSIFICATION'`.
   *Verificación:* `INVESTIGATOR` recibe 403 en los tres. `EVALUATOR`, `ADMIN` y `SUPERADMIN` no.

9. **Guard por etapa en `ESAVI-CASEFLOW-007`.** En `caseWorkflow.service.ts` se añaden
   `STAGE_MIN_ROLE` y el guard como primera instrucción de `completeCaseWorkflowStageService`,
   según §3.5. La clave `caseWorkflow.stageForbidden` se añade en es/en/nl.
   En `tests/contract/caseWorkflow.test.ts` hay un caso para `INVESTIGATION` y otro para
   `FINAL_CLASSIFICATION`, cada uno con el rol justo por debajo (403
   `CASEFLOW_007_STAGE_FORBIDDEN`) y con el rol mínimo (≠ 403).
   *Verificación:* un `NOTIFIER` con `stage: 'INVESTIGATION'` sobre un `caseId` inexistente recibe
   **403**, no 404. Un `INVESTIGATOR` con `stage: 'INVESTIGATION'` sobre el mismo `caseId` recibe
   404. `npm run i18n:check` sale en 0.

10. **Norma — `references/CONVENTIONS.md` §9.**
    - La tabla de niveles pasa a tener siete filas.
    - Una subsección nueva, «Roles por etapa del recorrido del caso», con la política por familia
      de §3.4: lecturas en `USER`, pasos 1–4 en `NOTIFIER`, paso 5 en `INVESTIGATOR`, paso 6 y
      `close`/`reopen`/`resolve-validation` en `EVALUATOR`, y supervisión intacta.
    - La regla de herencia: un satélite nuevo de `investigation` nace en `INVESTIGATOR`; uno de
      `notification`, en `NOTIFIER`.
    - En la regla 2, la excepción del guard de `complete-stage`, con sus tres condiciones.
    - El límite del modelo: los roles son anidados; uno no anidado exige permisos por etapa.
    - La tabla «Excepción declarada — el expediente clínico se escribe como `USER`» se reescribe:
      el `001`/`004`/`005A` de cada fila apunta al rol de su etapa.

    *Verificación:* el §9 nombra los siete roles, la excepción y el límite.
    `grep -n "INVESTIGATOR" references/CONVENTIONS.md` devuelve resultados en §9.

11. **Migración de datos existentes.** `scripts/grant-evaluator-to-users.ts`, según §3.3, con la
    línea `Run with:` en su cabecera, como el precedente.
    *Verificación:* sobre la BD de desarrollo con N usuarios `USER` activos y la fila `USER` en 25:
    - La primera ejecución imprime `created: N` y `USER level: 25 → 20`.
    - La segunda imprime `created: 0, skipped: N` y no toca la fila `USER`: su `appDetails` no
      crece.
    - Un usuario migrado sigue pudiendo hacer `POST /api/final-classifications` (≠ 403).
    - Un usuario nuevo con solo `USER` recibe 403 en `POST /api/patients` y ≠ 403 en
      `GET /api/esavi-cases`.

---

## 5. Criterios de aceptación

**Constantes y deuda**

- [ ] `ROLE_LEVELS` contiene exactamente siete roles: SUPERADMIN 100, ADMIN 50, EVALUATOR 40,
      INVESTIGATOR 30, NOTIFIER 25, USER 20 y ANALYTICS 10.
- [ ] `grep -n "process.env" src/constants/roles.constants.ts` no devuelve resultados.
- [ ] No se añadió ninguna variable a `.env.example`, `.env.development`, `.env.production` ni `.env.test`.
- [ ] La DEUDA-031 está marcada ✅ en `references/TECHNICAL_DEBT.md` y enlaza a este spec.
- [ ] `roleValidation.middleware.ts` y `completeCaseWorkflowStageService` calculan el nivel del
      usuario con `getUserRoleLevel`, y no hay una tercera copia de la fórmula en `src/`.

**Semilla y migración**

- [ ] Tras `ESAVI-SEED-001`, `appRole` contiene `NOTIFIER`, `INVESTIGATOR` y `EVALUATOR` con
      `level` 25/30/40 e `isSystemRole = true`. Repetir la semilla no crea filas.
- [ ] `PUT /api/roles/:id` y `DELETE /api/roles/:id` sobre cualquiera de los tres responden 403
      `APPROLE_00x_SYSTEM_ROLE`.
- [ ] Tras `scripts/grant-evaluator-to-users.ts`, todo usuario con una asignación `USER` vigente
      tiene además una `EVALUATOR` vigente, y su asignación `USER` sigue activa.
- [ ] Tras el script, la fila `USER` de `appRole` tiene `level = 20` e `isSystemRole = true`, con
      una entrada `SPEC-F64-MIGRATION` en `appDetails`.
- [ ] La segunda ejecución del script crea 0 asignaciones y no añade ninguna entrada al
      `appDetails` de la fila `USER`.
- [ ] Si la parte 1 del script falla, la fila `USER` sigue en 25: las dos partes van en una
      transacción.
- [ ] Un usuario migrado responde ≠ 403 en `POST /api/final-classifications`,
      `PATCH /api/case-workflows/case/:caseId/close` y `.../reopen`.

**Matriz de rutas**

- [ ] Los 36 códigos de §3.4.1, junto con `ESAVI-CASEFLOW-007` y `-010`, exigen `NOTIFIER`:
      `USER` recibe 403 y `NOTIFIER` no.
- [ ] Los 34 códigos de §3.4.2 exigen `INVESTIGATOR`: `NOTIFIER` recibe 403 e `INVESTIGATOR` no.
- [ ] `ESAVI-FINCLASS-001` y `-004` exigen `EVALUATOR`: `INVESTIGATOR` recibe 403.
- [ ] `ESAVI-CASEFLOW-008`, `-009` y `-011` exigen `EVALUATOR`: `INVESTIGATOR` recibe 403 y
      `EVALUATOR` no.
- [ ] Toda ruta de §3.4.5 conserva su literal: el diff de este spec no toca ninguna de esas
      líneas en `src/routes/`.
- [ ] Un `USER` (20) recibe ≠ 403 en las lecturas del caso (`ESAVI-CASE-002A`, `-003`,
      `ESAVI-INVESTGN-006`, `ESAVI-FINCLASS-006`, `ESAVI-PATIENT-006`) y en las rutas fuera del
      caso que hoy exigen `USER` (p. ej. `ESAVI-CATITEM-002A`).
- [ ] `ROUTE_RULES` sigue teniendo 355 reglas, y `roles.test.ts` pasa con los siete roles.
- [ ] `grep -rn "authHeader('USER')" tests/contract/` solo aparece en lecturas o en suites fuera
      del recorrido del caso.

**ADMIN siempre cierra y reabre**

- [ ] `ADMIN` y `SUPERADMIN` reciben ≠ 403 en `ESAVI-CASEFLOW-008`, `-009`, `-011` y en `-007`
      con `stage: 'FINAL_CLASSIFICATION'`. Lo cubre el bloque
      `ADMIN keeps close and reopen` de `roles.test.ts`.
- [ ] `grep -n "isAdmin\|isSuperAdmin" src/services/caseWorkflow.service.ts` no devuelve
      resultados: la garantía sale de la escalera, no de una rama.

**Guard de `complete-stage`**

- [ ] `NOTIFIER` con `stage: 'INVESTIGATION'` → 403 `CASEFLOW_007_STAGE_FORBIDDEN`.
- [ ] `INVESTIGATOR` con `stage: 'FINAL_CLASSIFICATION'` → 403 `CASEFLOW_007_STAGE_FORBIDDEN`.
- [ ] `NOTIFIER` con `stage: 'CLASSIFICATION'` o `'NOTIFICATION'` → ≠ 403.
- [ ] `USER` con cualquier `stage` → 403 `AUTH_ROLE_FORBIDDEN`: la ruta lo rechaza antes que el
      guard.
- [ ] El guard precede a la existencia: `NOTIFIER` con `stage: 'INVESTIGATION'` sobre un `caseId`
      inexistente → 403, no 404.
- [ ] El 403 del guard lleva `code: 'CASEFLOW_007_STAGE_FORBIDDEN'`, nunca `AUTH_ROLE_FORBIDDEN`.
- [ ] Los cinco puntos del código de operación de `ESAVI-CASEFLOW-007` siguen coincidiendo.

**Norma, i18n y cierre**

- [ ] `references/CONVENTIONS.md` §9 recoge los siete niveles, la política por familia, la
      excepción del guard y el límite del modelo anidado.
- [ ] `caseWorkflow.stageForbidden` existe en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

**Update diferencial — no aplica, declarado.** Este spec no añade ni modifica ninguna operación
que escriba sobre una fila existente (§3.5). Por eso no lleva el bloque de cinco criterios de la
plantilla. Sus tres escrituras de datos están declaradas y razonadas en §3.5: el `findOrCreate`
de la semilla, la inserción de `appUserRole` del script y la corrección de la fila `USER`. Esta
última escribe solo si el valor difiere, y su criterio de idempotencia está en el bloque
«Semilla y migración».

---

## 6. Decisiones tomadas y descartadas

**Niveles y nombres**

- **Sí:** NOTIFIER 25, INVESTIGATOR 30 y EVALUATOR 40, dentro de la escalera numérica.
  Los tres roles son anidados, y una cadena se expresa con números sin tocar
  `validateUserRole`.
- **Sí:** NOTIFIER en 25, el nivel que tenía `USER`. Las escrituras de los pasos 1 a 4 conservan
  el umbral numérico que tenían. Solo cambia quién lo alcanza.
- **Sí:** `USER` baja a 20 como rol de consulta. `ESAVI-USER-001` exige un rol, así que «usuario
  creado que aún no registra» necesita uno por debajo del umbral de escritura. `ANALYTICS` (10)
  no sirve: no alcanza ni las lecturas.
- **Sí, consecuencia de lo anterior:** las escrituras de los pasos 1 a 4, `007` y `010` cambian su
  literal de `USER` a `NOTIFIER`. Con `USER` en 20, dejar el literal haría que un `USER` siguiera
  registrando. Es estrictamente necesario, no cosmético.
- **Sí:** `USER` y `NOTIFIER` siguen siendo roles independientes. `USER` no se renombra ni se borra.
- **No:** renombrar `USER` a `NOTIFIER`. Rompería la semilla, los fixtures, el espejo
  `ROLE_LEVELS` del frontend y cualquier BD desplegada cuyo `appRole.name` sea `USER`. Además,
  dejaría sin rol de consulta.
- **No:** dejar `USER` en 25 junto a `NOTIFIER`. Fue la primera versión de este spec. Se descartó
  porque no permitía dar de alta a alguien sin capacidad de registro, y porque el empate hacía
  indistinguibles dos roles con propósitos distintos.
- **Sí:** huecos entre niveles (10 → 20 → 25 → 30 → 40 → 50). Si aparece un rol intermedio, cabe
  sin renumerar los existentes.

**Usuarios existentes**

- **Sí:** un script **añade** `EVALUATOR` a los titulares actuales de `USER` y, después y en la
  misma transacción, baja la fila `USER` a 20. Nadie pierde nada el día del despliegue, y la
  asignación `USER` original queda como rastro de lo que tenían.
- **Sí:** bajar el nivel de `USER` también en BD, no solo en la constante. `validateUserRole` lee
  `appRole.level`. Con la fila en 25, la constante en 20 no tendría ningún efecto.
- **No:** `UPDATE "appRole" SET level = 40 WHERE code = 'USER'`. Funcionaría por la columna
  `level`, pero la BD diría 40 y la constante otra cosa. El respaldo del frontend
  (`getEffectiveLevel`) y los fixtures de test dirían algo distinto de producción. Además,
  dejaría sin rol de consulta.
- **No:** opción (c), aceptar la pérdida y que el ADMIN reasigne a mano. Desde el despliegue
  hasta la reasignación, cada usuario operativo perdería la investigación y la clasificación
  final.
- **No:** retirar la asignación `USER` a los migrados. Es irreversible sin un registro aparte,
  y no aporta nada mientras `EVALUATOR` domine por `Math.max`.

**Variables de entorno y semilla**

- **Sí:** literales para los siete roles, lo que salda la DEUDA-031. Ninguna variable `ROLE_*`
  existía. Mantener el patrón para los cuatro y no para los tres nuevos dejaría el archivo con
  dos estilos.
- **No:** crear variables `ROLE_NOTIFIER`, etc. Un nombre de rol es un identificador del
  código. Que sea configurable solo sirve para romper la autorización en silencio, que es lo
  que describe la DEUDA-031.
- **Sí:** `isSystemRole: true` para los tres nuevos y para `USER`. Su nivel está atado a los
  literales de ruta, y editarlo desde `ESAVI-APPROLE-004` rompería la cadena sin que nada lo
  avisara. Subir `USER` de nuevo a 25 le devolvería la escritura de los pasos 1 a 4.
- **No:** sembrar también `ADMIN` y `ANALYTICS` en producción. Es otra deuda y no la exige este
  spec.

**Matriz**

- **Sí:** `classification` (inicial, paso 3) en `USER` y `finalClassification` (paso 6) en
  `EVALUATOR`. La primera declara la gravedad y forma parte del acto de notificar
  (`CASE-PROCESS.md` §1.1). La segunda es la conclusión causal.
- **Sí:** `close` en `EVALUATOR` para todo caso, también el corto (no grave y sin
  investigación). Cerrar es una decisión, no una consecuencia de que existan filas.
- **Sí:** `reopen` baja de `ADMIN` a `EVALUATOR`. Quien puede cerrar puede deshacer su cierre.
  `ADMIN` conserva ambas por la escalera.
- **Sí:** `request-validation` en `NOTIFIER` y `resolve-validation` en `EVALUATOR`. Pedir
  revisión es de cualquiera que registre; resolverla, de quien evalúa. Hoy quien la pide puede
  resolverla él mismo.
- **Sí:** las operaciones de supervisión no cambian: `005A` en `ADMIN`, `002B`, `005B` y `005C`.
  Retirar, ver retirados, restaurar y destruir no son trabajo de etapa.
- **No:** una rama `isAdmin` en `close`/`reopen` para «garantizar» al ADMIN. La escalera ya lo
  garantiza, y una segunda vía de autorización es lo que §9 regla 2 prohíbe. La garantía la
  fija un test.

**Guard de `complete-stage`**

- **Sí:** guard en el servicio, con 403 `CASEFLOW_007_STAGE_FORBIDDEN`, como excepción declarada
  a §9 regla 2. La etapa solo existe en el body.
- **No:** partir `007` en cuatro rutas, una por etapa. Cambiaría el contrato HTTP y el frontend
  por una regla que cabe en un mapa.
- **No:** un middleware genérico `validateStageRole` en la ruta. Tendría que leer el body antes
  de `validateFields`. Además, sería un mecanismo nuevo para un único endpoint.
- **No:** reutilizar `AUTH_ROLE_FORBIDDEN`. El frontend tiene que distinguir «no puedes entrar
  aquí» de «no puedes completar esta etapa».
- **Sí:** guard antes de cargar el expediente. Así, un rol insuficiente no aprende con un 404 o
  un 409 si existe un caso ni en qué estado está.

**Lecturas**

- **Sí:** todas las lecturas del caso siguen en el literal `USER`, ahora 20. Un `USER` de consulta
  lee todo lo de su territorio (F49), incluidos los datos personales del paciente
  (`PATIENT-002A/003/006/007`). Es un rol de consulta coherente («supervisor de lectura») y no
  obliga a tocar ninguna lectura.
- **No:** subir las lecturas del caso a `NOTIFIER`, dejando a `USER` solo con catálogos. Habría
  que tocar unos 60 códigos más. Producto lo descartó.

**Lecturas por etapa — pregunta abierta de producto**

- **Sí, provisionalmente:** un NOTIFIER ve la investigación y la clasificación final de los casos
  de su territorio, y el EVALUATOR lee todo. Las razones:
  - `ESAVI-CASEFLOW-006` ya expone `exists` e `id` de las cuatro etapas para el reingreso al
    wizard.
  - El alcance geográfico (F49) ya acota el territorio.
  - El notificador tiene interés legítimo en el desenlace de lo que notificó.
- **Abierta:** ¿debe un NOTIFIER **no** ver el contenido de la investigación o de la
  clasificación final? Si producto lo decide, exigirá:
  - subir a `INVESTIGATOR`/`EVALUATOR` los `002A`, `003` y `006` de esas familias, unos 45 códigos;
  - decidir qué devuelve `ESAVI-CASEFLOW-006` en `stages` a quien no puede leerlas.

  Va en su propio spec.

**Límite del modelo**

- **Sí:** el modelo funciona **solo porque los roles son anidados**: USER ⊂ NOTIFIER ⊂
  INVESTIGATOR ⊂ EVALUATOR ⊂ ADMIN. Cada rol puede todo lo del anterior, y eso es exactamente lo que expresa
  `nivel ≥ umbral`.
- **No:** un rol no anidado, como un evaluador que no notifica o un investigador que no puede
  reabrir lo que otro cerró. No cabe en una escalera: exige pasar a permisos por etapa, con
  `appPermission` / `appRolePermission`, que existen en `esaviapp.sql` y no tienen modelo.
  Queda fuera de alcance. El primer rol no anidado que se pida invalida este spec como base y
  requiere un spec de autorización propio.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Ventana entre despliegue y migración.** Desde que arrancan las rutas nuevas hasta que corre el script de §3.3, los titulares de `USER` (aún en 25 en BD) notifican, pero no investigan, no clasifican al final ni cierran. | Orden de despliegue fijo: (1) desplegar, (2) `ESAVI-SEED-001`, (3) `scripts/grant-evaluator-to-users.ts`, en la misma ventana de mantenimiento. El script aborta si falta `EVALUATOR`, así que no se puede ejecutar fuera de orden en silencio. |
| **La fila `USER` se queda en 25 si el script no corre.** La constante dice 20, pero el middleware lee la BD. Un `USER` nuevo seguiría notificando. | El paso 11 de verificación lo detecta: un usuario con solo `USER` debe recibir 403 en `POST /api/patients`. Ese chequeo forma parte del despliegue. |
| **Roles personalizados con nivel entre 20 y 49**, creados por `ESAVI-APPROLE-001`. Los de 20 a 24, que hoy no alcanzan nada de 25, pasan a leer todo lo de `USER`. Los de 26 a 49, que hoy equivalen a `USER`, ganan la investigación (≥ 30) o todo el recorrido (≥ 40). Ninguno de esos cambios lo provoca una edición del rol. | Antes del despliegue: `SELECT "code", "level" FROM "appRole" WHERE "level" >= 20 AND "level" < 50 AND "code" <> 'USER' AND "deletedAt" IS NULL;`. Cada fila se revisa y se reajusta su `level` con `ESAVI-APPROLE-004`. El resultado se anota en la nota de implementación. |
| **Un `USER` de consulta ve datos personales del paciente.** Es la decisión tomada (§6, opción a). Quien da de alta a alguien «sin opciones» puede no esperarlo. | Queda escrito en el §9 de `CONVENTIONS.md` (paso 10) y en la descripción del rol. Si producto cambia de criterio, el cambio es subir las lecturas de `patient` a `NOTIFIER`, en su propio spec. |
| **Nombres de rol leídos de `ESAVI_SUPERADMIN` / `ESAVI_USER` en la semilla.** `.env.example` les da `SUPERADMIN_ROLE` / `USER_ROLE`. Una BD sembrada así tiene `name` ≠ `code`. | El script y la semilla nueva buscan por `code`, que la semilla siempre escribe literal (`'SUPERADMIN'`, `'USER'`), así que este spec funciona igual. El efecto previo —`isAdmin` compara por nombre y no reconoce `SUPERADMIN_ROLE`, de modo que F49 lo acota— no cambia aquí. Se registra como deuda nueva al cerrar el spec. |
| **El frontend sigue ofreciendo «Reabrir» solo a ADMIN** (`useCan(ROLE_LEVELS.ADMIN)`) y no conoce el 403 del guard. | No es un agujero de seguridad: el servidor decide. Es una desalineación de UX hasta que el spec FE cite los códigos de §8. `getEffectiveLevel` usa `role.level` del API, así que un EVALUATOR obtiene 40 aunque el espejo `ROLE_LEVELS` del frontend aún no lo nombre. |
| **Un satélite nuevo de `notification` o `investigation` nace en `USER`** por inercia de la excepción actual del §9, y un `USER` de consulta podría escribir en él. | El paso 10 reescribe esa tabla del §9: la herencia pasa a ser «el rol de la etapa del padre». |
| **Las suites de contrato del caso escriben hoy con `authHeader('USER')`.** Fallarán en cuanto suba su ruta. | Cada paso del plan que sube una familia actualiza en el mismo commit sus suites al rol de su etapa (pasos 5 a 8). |

---

## 8. Impacto en el contrato HTTP

El contrato cambia en dos sentidos. **77 códigos** cambian de rol mínimo, y `ESAVI-CASEFLOW-007`
gana un error nuevo. Además, el literal `USER` baja de 25 a 20, así que `USER` deja de escribir
el expediente. Ningún `data` cambia. El frontend
(`../esavi-frontend`) se ve afectado en tres puntos:

- replica `ROLE_LEVELS` en `src/shared/config/roles.ts`;
- consume `API-ROUTES.md`, regenerado desde las rutas;
- decide el botón de reabrir con `useCan(ROLE_LEVELS.ADMIN)`.

### 8.1 Códigos cuyo rol mínimo cambia — para que el spec FE los cite

**`USER` (25) → `NOTIFIER` (25) — 38 códigos.** El nivel no cambia; lo que cambia es que `USER`,
ahora en 20, deja de alcanzarlos.

    ESAVI-PATIENT-001    ESAVI-PATIENT-004
    ESAVI-CASE-001       ESAVI-CASE-004
    ESAVI-NOTIFIER-001   ESAVI-NOTIFIER-004   ESAVI-NOTIFIER-005A
    ESAVI-CLASSIF-001    ESAVI-CLASSIF-004
    ESAVI-NOTIFCN-001    ESAVI-NOTIFCN-004
    ESAVI-SEVNOT-001     ESAVI-SEVNOT-004
    ESAVI-NSEVNOT-001    ESAVI-NSEVNOT-004
    ESAVI-NOTIFEVT-001   ESAVI-NOTIFEVT-004   ESAVI-NOTIFEVT-005A
    ESAVI-NOTIFMED-001   ESAVI-NOTIFMED-004   ESAVI-NOTIFMED-005A
    ESAVI-NOTIFVAC-001   ESAVI-NOTIFVAC-004   ESAVI-NOTIFVAC-005A
    ESAVI-NOTIFDIL-001   ESAVI-NOTIFDIL-004   ESAVI-NOTIFDIL-005A
    ESAVI-NOTIFPRG-001   ESAVI-NOTIFPRG-004   ESAVI-NOTIFPRG-005A
    ESAVI-PREGCOMP-001   ESAVI-PREGCOMP-004   ESAVI-PREGCOMP-005A
    ESAVI-MEDHIST-001    ESAVI-MEDHIST-004    ESAVI-MEDHIST-005A
    ESAVI-CASEFLOW-007   (complete-stage, + guard por etapa)
    ESAVI-CASEFLOW-010   (request-validation)

**`USER` (25) → `INVESTIGATOR` (30) — 34 códigos**

    ESAVI-INVESTGN-001   ESAVI-INVESTGN-004   ESAVI-INVESTGN-005A
    ESAVI-INVSRC-001     ESAVI-INVSRC-004
    ESAVI-INVAUT-001     ESAVI-INVAUT-004
    ESAVI-INVMEDH-001    ESAVI-INVMEDH-004
    ESAVI-INVCLIEV-001   ESAVI-INVCLIEV-004
    ESAVI-INVVACTX-001   ESAVI-INVVACTX-004
    ESAVI-INVCOLD-001    ESAVI-INVCOLD-004
    ESAVI-INVADMER-001   ESAVI-INVADMER-004
    ESAVI-INVCOMM-001    ESAVI-INVCOMM-004
    ESAVI-INVTEAM-001    ESAVI-INVTEAM-004    ESAVI-INVTEAM-005A
    ESAVI-INVVACAD-001   ESAVI-INVVACAD-004   ESAVI-INVVACAD-005A
    ESAVI-INVDIAG-001    ESAVI-INVDIAG-004    ESAVI-INVDIAG-005A
    ESAVI-INVPREG-001    ESAVI-INVPREG-004    ESAVI-INVPREG-005A
    ESAVI-EVALINST-001   ESAVI-EVALINST-004   ESAVI-EVALINST-005A

**`USER` (25) → `EVALUATOR` (40) — 4 códigos**

    ESAVI-FINCLASS-001   ESAVI-FINCLASS-004
    ESAVI-CASEFLOW-008   (close)
    ESAVI-CASEFLOW-011   (resolve-validation)

**`ADMIN` (50) → `EVALUATOR` (40) — 1 código, el único que baja**

    ESAVI-CASEFLOW-009   (reopen)

**Error nuevo — 1 código**

    ESAVI-CASEFLOW-007   (complete-stage) → 403 CASEFLOW_007_STAGE_FORBIDDEN
                         INVESTIGATION exige 30 · FINAL_CLASSIFICATION exige 40

**Literal `USER` de 25 a 20 — todas las rutas que lo usan.** Ninguna cambia de literal. Ahora las
alcanza también un rol de nivel 20 a 24.

### 8.2 Qué tiene que hacer el frontend

- `ROLE_LEVELS` gana `NOTIFIER: 25`, `INVESTIGATOR: 30` y `EVALUATOR: 40`, y `USER` pasa a `20`.
- Toda pantalla o acción que hoy habilita **escribir** en los pasos 1 a 4 con
  `useCan(ROLE_LEVELS.USER)` pasa a `useCan(ROLE_LEVELS.NOTIFIER)`: crear paciente, abrir caso,
  pasos 2–4 del wizard, «Completar etapa» y «Pedir validación». Las vistas de solo lectura
  siguen en `USER`.
- «Reabrir» pasa de `useCan(ROLE_LEVELS.ADMIN)` a `useCan(ROLE_LEVELS.EVALUATOR)`.
  «Cerrar» y «Resolver validación» pasan a `useCan(ROLE_LEVELS.EVALUATOR)`.
  `ADMIN` las conserva por la escalera.
- Los pasos 5 y 6 del wizard quedan de solo lectura por debajo de 30 y de 40, respectivamente,
  y «Completar etapa» se oculta por etapa con el mismo mapa de §3.5.
- `CASEFLOW_007_STAGE_FORBIDDEN` se trata como un rechazo de la acción, no como pérdida de acceso
  a la pantalla. `AUTH_ROLE_FORBIDDEN` mantiene su tratamiento actual.
- `API-ROUTES.md` se regenera después del paso 7 del plan.

### 8.3 Lo que no cambia para ningún cliente

- Ninguna lectura cambia de literal: siguen en `USER`, ahora 20.
- Ningún `data` gana ni pierde campos.
- Ningún status cambia, salvo el 403 por rol en los 77 códigos de §8.1 y el 403 nuevo de `007`.

---

## Lo que **no** está en este spec

- Roles no anidados y permisos por etapa (`appPermission` / `appRolePermission`).
- Restringir las lecturas del caso por rol, incluidos los datos del paciente para `USER`. La
  restricción por etapa queda como pregunta abierta de producto (§6).
- Renombrar o borrar el rol `USER`.
- Retirar la asignación `USER` a los usuarios migrados.
- Cambiar los `005A`, `002B`, `005B` y `005C` del expediente.
- Sembrar `ADMIN` y `ANALYTICS` en producción.
- Corregir los nombres de rol que la semilla lee de `ESAVI_*` y el reconocimiento por nombre de
  `isAdmin`.
- Tocar el alcance geográfico (SPEC F49).
- Los cambios del frontend, que van en su propio spec.

Cada uno de esos, si aterriza, va en su propio spec.
