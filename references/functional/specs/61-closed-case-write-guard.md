# SPEC F61 — Rechazar toda escritura sobre un expediente cerrado

> **Estado:** Aprobado
> **Depende de:** SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F44 (`caseWorkflow` — aporta el estado `CLOSED`, la reapertura `ESAVI-CASEFLOW-009` y el precedente `CASEFLOW_012_CASE_CLOSED`)**, SPEC F12 (update diferencial — el guardia va antes del diff), SPEC F06, F07, F09, F10, F13, F14, F16, F21, F22, F24, F25, F27, F28–F41, F57 y F58 (las 28 entidades cuyos servicios reciben el guardia)
> **Fecha:** 2026-09-21
> **Objetivo:** Que el servidor rechace con 409 toda escritura sobre el contenido de un expediente cuyo flujo está en `CLOSED`, igual que ya rechaza abrir una fase nueva.

---

## 1. Por qué existe este spec

**A — La regla existe, pero solo el cliente la aplica.** «Un expediente cerrado no se edita, y solo un ADMIN lo reabre con `ESAVI-CASEFLOW-009`» es la regla de `esavi-frontend/references/CASE-PROCESS.md` §4.5. Hoy vive entera en el cliente, que deshabilita los formularios. Un USER con las herramientas de desarrollo del navegador, o con `curl` y su token, escribe sobre un expediente cerrado sin que el backend lo impida. Esa regla es lo que separa lo que puede hacer un USER de lo que necesita un ADMIN, porque reabrir es ADMIN (`roles.test.ts:757`). Mientras no la aplique el servidor, un USER se salta la reapertura sin más que escribir directamente.

**B — El backend ya la aplica, pero en otras operaciones.** `src/services/caseWorkflow.service.ts` rechaza un expediente `CLOSED` en tres operaciones, todas con 409 y la clave `caseWorkflow.caseClosed`:

| Código | Línea | Operación |
|---|---|---|
| `CASEFLOW_007_CASE_CLOSED` | `:571` | completar etapa |
| `CASEFLOW_010_CASE_CLOSED` | `:812` | pedir validación |
| `CASEFLOW_012_CASE_CLOSED` | `:998` | abrir una fase: lo invocan los `001` de `CLASSIF`, `NOTIFCN`, `INVESTGN` y `FINCLASS` |

Crear la clasificación de un caso cerrado responde 409. Editarla después responde 200. La semántica ya está escrita, y lo que falta es aplicarla en todas las escrituras.

**C — Cubrir solo los cuatro `004` de fase deja la puerta entornada.** La petición mínima del frontend (§10.3) nombra `CLASSIF-004`, `NOTIFCN-004`, `INVESTGN-004` y `FINCLASS-004`. Pero la mayor parte de las escrituras reales de un expediente van a sus satélites: las vacunas, los eventos, la medicación, el equipo investigador, el diagnóstico. Con solo los cuatro `004`, un USER no podría cambiar la descripción del ESAVI de un caso cerrado, pero sí retirarle la vacuna. La regla del cliente no distingue cabecera de satélite, y el servidor tampoco debe hacerlo. §6 lo decide.

---

## 2. Alcance

**Dentro:**

- **Un guardia compartido**, `assertCaseIsOpen`, en `src/services/caseWorkflow.service.ts`. Recibe un `caseId` y lanza 409 `<PREFIX>_<op>_CASE_CLOSED` si el flujo de ese caso está en `CLOSED`.
- **Invocarlo en las 85 escrituras del expediente de §3.2**, en 28 servicios:
  - `ESAVI-CASE-004`.
  - Las cuatro escrituras de `NOTIFIER`.
  - `004`, `005A` y `005B` de las cuatro cabeceras de fase. Su `001` ya lo cubre `CASEFLOW_012`.
  - `001`, `004`, `005A` y `005B` de todo satélite de `notification` y de `investigation` que los exponga, a cualquier profundidad.
- **Una suite de contrato nueva**, `tests/contract/caseClosedGuard.test.ts`. Recorre las 85 rutas sobre un expediente cerrado y comprueba que ninguna ruta de escritura de esas familias en `ROUTE_RULES` se quede fuera.
- **La norma**: una subsección nueva en `references/CONVENTIONS.md` §11, para que todo satélite futuro nazca con el guardia.

**Fuera de alcance (otros specs):**

- **Las lecturas** (`002A`, `002B`, `003`, `006`). Un expediente cerrado se consulta.
- **El `005C` de todas las entidades.** Es SUPERADMIN, exige que la fila esté ya retirada y es una operación de gobierno del dato, no de captura. §6 lo razona.
- **`ESAVI-CASE-001`, `-005A` y `-005B`.** El `001` crea el caso, así que todavía no hay flujo que pueda estar cerrado. El `005A` y el `005B` actúan sobre el ciclo de vida del caso entero, no sobre su contenido. Retirar un duplicado cerrado es un acto administrativo legítimo.
- **`patient`.** Un paciente se comparte entre casos. Cerrar un caso no puede congelar los datos de una persona que tiene otros casos abiertos.
- **Las operaciones de `caseWorkflow`.** Ya tienen sus propias reglas de estado (F44).
- **Las cascadas internas** —`cascade*` de `esaviCase.service.ts` e `investigation.service.ts`, y `satelliteCascade.service.ts`—. No son rutas: las dispara una operación de cabecera que ya pasó, o no, por el guardia.
- **El backfill de flujos para los casos anteriores a F44.** Sigue fuera, como declaró F44. §3.3 explica por qué no hace falta aquí.
- **Cambios de rol.** Es el SPEC F60. Los dos specs son independientes y se aplican en cualquier orden.

---

## 3. Modelo de datos

No hay tablas, columnas, modelos, asociaciones ni tipos nuevos. Tampoco claves i18n nuevas (§3.6). El spec es transversal: añade una comprobación a servicios existentes.

### 3.1 De dónde sale el `caseId` — la cadena de cada tabla

Todas las tablas del expediente llegan a `esaviCase` en uno, dos o tres saltos. Según `esaviapp.sql`:

| Profundidad | Tablas | Camino a `caseId` |
|---|---|---|
| 0 | `esaviCase` | es su PK |
| 1 | `notifier` `:751`, `classification` `:773`, `notification` `:801`, `investigation` `:1026`, `finalClassification` `:1378` | columna `caseId` |
| 2 | `severeNotification`, `nonSevereNotification`, `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationPregnancy`, `notificationMedicalHistory` | `notificationId` → `notification.caseId` |
| 2 | `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationMedicalHistory`, `investigationClinicalEvaluation`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError`, `investigationCommunity`, `investigationDiagnostic` | `investigationId` → `investigation.caseId` |
| 3 | `notificationDiluent` `:943` | `vaccineId` → `notificationVaccine.notificationId` → `notification.caseId` |
| 3 | `notificationPregnancyComplication` `:984` | `pregnancyId` → `notificationPregnancy.notificationId` → `notification.caseId` |
| 3 | `investigationPregnancyCondition` `:1164`, `evaluationInstitution` `:1208` | `investigationId` → tabla 1:1 intermedia → `investigation.caseId` |

**Lo que hace barato el guardia: cada servicio ya lee esa cadena.** La visibilidad heredada (F16, F24, F27, F31, F33, F35…) obliga a todo servicio satélite a leer su padre, y a su abuelo si lo tiene, en cada operación. Ejemplos: `NOTIFICATION_INCLUDE` en `notificationEvent.service.ts:41-45`, `VACCINE_INCLUDE` con `notification` anidado en `notificationDiluent.service.ts:37-44`, `CLINICAL_EVALUATION_INCLUDE` con `investigation` anidado en `evaluationInstitution.service.ts:54-62`. Hoy esos includes piden `['notificationId', 'isActive']` o `['investigationId', 'isActive']`. Añadir `'caseId'` a los `attributes` del último eslabón no cuesta ninguna consulta nueva.

`caseWorkflow` tiene `UQ_caseWorkflow_case UNIQUE ("caseId")` (`:1434`): un caso tiene como mucho un flujo, y leerlo por `caseId` es una búsqueda por índice único.

### 3.2 Superficie HTTP afectada

Ninguna ruta nueva. Ninguna cambia de verbo, de path ni de rol. Las 85 de abajo ganan una respuesta posible: **409 `<PREFIX>_<op>_CASE_CLOSED`**.

```
Cabecera del caso                      ESAVI-CASE-004
Notificadores                          ESAVI-NOTIFIER-001 / -004 / -005A / -005B
Cabeceras de fase (001 ya cubierto)    ESAVI-CLASSIF-004 / -005A / -005B
                                       ESAVI-NOTIFCN-004 / -005A / -005B
                                       ESAVI-INVESTGN-004 / -005A / -005B
                                       ESAVI-FINCLASS-004 / -005A / -005B
Paso 4, 1:1                            ESAVI-SEVNOT-001 / -004
                                       ESAVI-NSEVNOT-001 / -004
Paso 4, colecciones                    ESAVI-NOTIFEVT-001 / -004 / -005A / -005B
                                       ESAVI-NOTIFMED-001 / -004 / -005A / -005B
                                       ESAVI-NOTIFVAC-001 / -004 / -005A / -005B
                                       ESAVI-NOTIFPRG-001 / -004 / -005A / -005B
                                       ESAVI-MEDHIST-001  / -004 / -005A / -005B
Paso 4, nietas                         ESAVI-NOTIFDIL-001 / -004 / -005A / -005B
                                       ESAVI-PREGCOMP-001 / -004 / -005A / -005B
Paso 5, 1:1                            ESAVI-INVSRC-001 / -004      ESAVI-INVAUT-001 / -004
                                       ESAVI-INVMEDH-001 / -004     ESAVI-INVCLIEV-001 / -004
                                       ESAVI-INVVACTX-001 / -004    ESAVI-INVCOLD-001 / -004
                                       ESAVI-INVADMER-001 / -004    ESAVI-INVCOMM-001 / -004
Paso 5, colecciones                    ESAVI-INVTEAM-001 / -004 / -005A / -005B
                                       ESAVI-INVVACAD-001 / -004 / -005A / -005B
                                       ESAVI-INVDIAG-001 / -004 / -005A / -005B
Paso 5, nietas                         ESAVI-INVPREG-001 / -004 / -005A / -005B
                                       ESAVI-EVALINST-001 / -004 / -005A / -005B
```

1 + 4 + 12 + 4 + 20 + 8 + 16 + 12 + 8 = **85 rutas**, en 28 servicios. Las tablas 1:1 sin `isActive` (`severeNotification`, `nonSevereNotification` y las ocho del paso 5) no exponen `005A` ni `005B`, así que no hay nada que cubrir en ellas.

### 3.3 El guardia — `assertCaseIsOpen`

**Ubicación.** `src/services/caseWorkflow.service.ts`, exportado junto a `advanceCaseWorkflowStageService`. Va ahí porque la constante `STATUS` (`:30`) y el include `STATUS_INCLUDE` (`:72`) ya viven en ese archivo, y el concepto de «cerrado» es del flujo. `classification.service.ts` y las otras tres cabeceras ya importan de ese archivo, así que no se crea ninguna dependencia nueva de dirección.

**Firma.** `assertCaseIsOpen(caseId, prefix, op, lang, transaction?)`. Sin retorno útil: si el caso está abierto, termina sin hacer nada; si está cerrado, lanza.

**Qué hace, en orden:**

1. Lee `CaseWorkflow` por `caseId`, con `attributes: ['caseWorkflowId']` y `STATUS_INCLUDE` reducido a `['code']`, dentro de `transaction` si llega una. **Sin filtro por `isActive`**: el estado del flujo es el hecho, esté o no retirada su fila.
2. **Si no hay flujo, termina sin lanzar.** Un caso anterior a F44 no tiene fila de flujo. Tampoco puede estar cerrado: cerrar exige `ESAVI-CASEFLOW-008`, y el `008` exige la fila. Ausencia de flujo implica «no cerrado». Bloquearlo convertiría cada caso heredado en no editable por un problema de datos que nada tiene que ver con esta regla.
3. Si `status.code === STATUS.CLOSED`, lanza `AppError(getMessage('caseWorkflow.caseClosed', lang), 409, `${prefix}_${op}_CASE_CLOSED`)`.

`PENDING_VALIDATION`, `OPEN` y los cuatro `IN_*` no bloquean. Solo `CLOSED` lo hace.

**No se reutiliza en `advanceCaseWorkflowStageService`.** El `012` necesita la fila completa del flujo para lo que hace después: sellar etapas y mover el estado. Además, a diferencia del guardia, un flujo ausente es para él un 404 (`CASEFLOW_012_NOT_FOUND`). Lo que sí cambia es su comentario de `:990-992`, que dice que es «the only rule of process this service enforces». Deja de serlo y pasa a remitir al guardia.

### 3.4 Dónde se invoca — orden dentro de cada operación

La regla general: **existencia y visibilidad primero, cierre después, y todo lo demás a continuación**. Un id inexistente sigue siendo 404 aunque el caso esté cerrado. Una FK inactiva o un duplicado de un caso cerrado responden 409 `*_CASE_CLOSED`, no el error de la FK: el expediente cerrado no admite la escritura, sea cual sea el body.

| Operación | Punto de inserción | De dónde sale el `caseId` | Consultas añadidas |
|---|---|---|---|
| `001` de satélite | Justo después de la comprobación de padre existente y activo (p. ej. `assertNotificationIsValid`, `notificationEvent.service.ts:106`) | `attributes` del padre, o del eslabón superior en las nietas, ampliados con `caseId` | **+1** |
| `001` de `NOTIFIER` | Después de validar que el caso existe | `data.caseId` | **+1** |
| `004` de todas | Justo después de leer la fila y responder 404 si falta, **antes** de FKs, unicidad y `buildDifferentialUpdate` | El include de la cadena que ya lee la fila (p. ej. `findNotificationEventRow`, `:91`), ampliado con `caseId`. En cabeceras y `notifier`, la columna de la fila. En `esaviCase`, el propio `id` | **+1** |
| `005A` / `005B` de todas | **Antes** de delegar en `setEntityActiveStatusService` y, en el `005B`, antes de `reassignSortOrderOnCollision` | Lectura mínima nueva de la fila con su cadena: `attributes` solo con la PK, includes solo con las claves hasta `caseId`, **sin filtros de `isActive`** (el `005B` actúa sobre filas retiradas). Si la fila no existe, no se evalúa el guardia y el servicio genérico responde su 404 de siempre | **+2** |

**Coste.** Una consulta más por escritura en `001` y `004`, y dos en `005A` y `005B`. Las dos son búsquedas por índice único o por PK. En los `005A` y `005B` podría bajar a una sola consulta con un include que llegara de la fila hasta `caseWorkflow`. No se hace: exigiría declarar asociaciones de `esaviCase` a `caseWorkflow` en once cadenas distintas para ahorrar una lectura en operaciones poco frecuentes.

**Transacción.** El guardia corre dentro de la transacción de la operación cuando la hay. No se toma ningún bloqueo sobre la fila del flujo (§6).

**Update diferencial.** El guardia va **antes** del diff, igual que la validación de FK y de unicidad (§11 de `CONVENTIONS.md`, bloque de F12). Un `PUT` sobre un caso cerrado responde 409 **aunque no cambie nada**: la respuesta no depende de lo que traiga el body. El contrato de `candidates` de cada `004` **no cambia**: el guardia no añade, quita ni transforma ningún campo. Las tablas de `candidates` siguen siendo las de sus specs de origen.

### 3.5 Reglas de negocio por familia

**Cabeceras de fase — `CLASSIF`, `NOTIFCN`, `INVESTGN`, `FINCLASS`.** `004`: la fila tiene `caseId`, y el guardia va tras el 404. `005A` y `005B`: lectura de `caseId` por PK y guardia. El `001` **no** se toca: sigue respondiendo `CASEFLOW_012_CASE_CLOSED`, porque su 409 lo lanza `advanceCaseWorkflowStageService` dentro de la transacción del alta. Añadir el guardia ahí duplicaría la consulta y cambiaría un código que el cliente ya conoce.

**`ESAVI-CASE-004`.** El `caseId` es el `:id` de ruta. El guardia va tras el 404 del caso.

**`NOTIFIER`.** `001`: `data.caseId`. `004`: la fila. `005A` y `005B`: lectura de `caseId` por PK.

**Satélites 1:1 sin `isActive`** (`SEVNOT`, `NSEVNOT` y los ocho del paso 5). `001` y `004`, con `caseId` desde el include de `notification` o de `investigation` que ya leen.

**Colecciones y nietas con `isActive`.** Las cuatro operaciones, con los puntos de §3.4.

**Códigos.** Uno por operación y por entidad: `CASE_004_CASE_CLOSED`, `NOTIFIER_001_CASE_CLOSED`, `CLASSIF_004_CASE_CLOSED`, `NOTIFEVT_005B_CASE_CLOSED`, `INVDIAG_005A_CASE_CLOSED`… El prefijo es la abreviatura registrada en `CONVENTIONS.md` §6. El sufijo `_CASE_CLOSED` es el mismo de `CASEFLOW_007/010/012`. Un cliente que quiera tratar el caso cerrado de forma genérica compara contra `/_CASE_CLOSED$/`, sin conocer las 85 operaciones.

### 3.6 Claves i18n

**Ninguna nueva.** Todas las operaciones usan `caseWorkflow.caseClosed`, que existe en los tres idiomas (`es.json:1048`: «El caso está cerrado. Reábralo antes de continuar con el expediente.»). Es el mismo mensaje que ya devuelve `CASEFLOW_012`, y dice lo que el usuario tiene que hacer. El `code` es lo que distingue la operación. Una clave por entidad diría 28 veces lo mismo.

### 3.7 Forma de la respuesta

La del error estándar de §10, sin cambios:

```
409 { ok: false, message: <caseWorkflow.caseClosed>, code: 'NOTIFEVT_004_CASE_CLOSED', errors }
```

Sin `data`. Las respuestas de éxito de las 85 rutas no cambian.

---

## 4. Plan de implementación

Cada paso se puede committear solo y deja la suite en verde. El paso 2 entrega por sí solo el mínimo pedido por el frontend. Los siguientes cierran la puerta familia a familia.

1. **El guardia.** `assertCaseIsOpen` en `caseWorkflow.service.ts` según §3.3. Comentario de `:990-992` actualizado. Utilidad de test `setCaseWorkflowStatus(caseId, code)` en `tests/setup/database.ts`, junto a `seedCaseWorkflow`, para cerrar un caso sin depender de las precondiciones de `ESAVI-CASEFLOW-008`.
   *Verificación:* `npm run build` sale en 0; `grep -n "export" src/services/caseWorkflow.service.ts` incluye `assertCaseIsOpen`.

2. **Las cuatro cabeceras de fase.** `004`, `005A` y `005B` de `CLASSIF`, `NOTIFCN`, `INVESTGN` y `FINCLASS`: doce operaciones. Crea `tests/contract/caseClosedGuard.test.ts` con la matriz `CLOSED_GUARD_RULES`, con la misma forma que `ROUTE_RULES` (`method`, `path`, `code`), y sus primeras doce filas.
   *Verificación:* sobre un caso cerrado, las doce responden 409 con su `code`; tras `ESAVI-CASEFLOW-009` las mismas peticiones responden 200.

3. **`esaviCase` y `notifier`.** `CASE-004` y las cuatro de `NOTIFIER`. Cinco filas más en la matriz.
   *Verificación:* ídem para las cinco.

4. **Paso 4, profundidad 2.** `SEVNOT`, `NSEVNOT`, `NOTIFEVT`, `NOTIFMED`, `NOTIFVAC`, `NOTIFPRG` y `MEDHIST`: veinticuatro operaciones. El include de `notification` gana `caseId` en cada servicio.
   *Verificación:* ídem para las veinticuatro; `npx jest tests/contract/notification` sigue en 0 (sus casos no tienen flujo o lo tienen abierto).

5. **Paso 4, profundidad 3.** `NOTIFDIL` y `PREGCOMP`: ocho operaciones. `caseId` en el `notification` anidado de `VACCINE_INCLUDE` y `PREGNANCY_INCLUDE`.
   *Verificación:* ídem para las ocho.

6. **Paso 5, profundidad 2.** Los ocho 1:1 (`001`, `004`) y `INVTEAM`, `INVVACAD`, `INVDIAG` (cuatro operaciones cada uno): veintiocho operaciones.
   *Verificación:* ídem para las veintiocho; `npx jest tests/contract/investigation` sigue en 0.

7. **Paso 5, profundidad 3.** `INVPREG` y `EVALINST`: ocho operaciones.
   *Verificación:* ídem para las ocho. La matriz tiene 85 filas.

8. **La guarda contra el olvido.** En `caseClosedGuard.test.ts`, un `describe('the matrix itself')` como el de `roles.test.ts:823`. Toma de `ROUTE_RULES` toda ruta cuya abreviatura sea una de las 28 de §3.2 y cuyo método no sea `get`, excluye `/purge/` y los `001` de las cuatro cabeceras de fase, `CASE-001`, `CASE-005A` y `CASE-005B`. Comprueba que el conjunto resultante es **exactamente** el de `CLOSED_GUARD_RULES`. `ROUTE_RULES` se exporta desde `roles.test.ts` o se mueve a `tests/setup/`, lo que resulte menos invasivo al implementar.
   *Verificación:* borrar una fila de `CLOSED_GUARD_RULES` hace fallar la suite nombrando la ruta ausente.

9. **Norma.** Subsección nueva en `references/CONVENTIONS.md` §11, «Expediente cerrado», con §3.3 y §3.4 resumidos: toda escritura sobre una tabla del expediente invoca `assertCaseIsOpen` tras el 404 y antes de todo lo demás, y toda ruta nueva de esas familias entra en `CLOSED_GUARD_RULES`. En §10, la fila `409` de la tabla de status codes gana el caso «el expediente está cerrado». En §15, una casilla más del checklist.
   *Verificación:* `grep -n "assertCaseIsOpen" references/CONVENTIONS.md` devuelve al menos una línea.

10. **Cierre.** `npm run check`.
    *Verificación:* sale en 0.

---

## 5. Criterios de aceptación

- [ ] Sobre un caso con flujo en `CLOSED`, las 85 rutas de §3.2 responden **409**, y cada `code` es `<PREFIX>_<op>_CASE_CLOSED` con la abreviatura y la operación de esa ruta.
- [ ] El `message` de esas respuestas es el de `caseWorkflow.caseClosed` en el idioma de la petición (`?lang=en` lo devuelve en inglés).
- [ ] Tras `ESAVI-CASEFLOW-009` (reabrir), las mismas peticiones responden lo mismo que antes de este spec.
- [ ] Sobre un caso en `PENDING_VALIDATION` las 85 rutas se comportan como antes de este spec.
- [ ] Sobre un caso **sin** fila de `caseWorkflow` las 85 rutas se comportan como antes de este spec.
- [ ] Un `PUT` con el `:id` de una fila inexistente responde **404**, no 409, aunque se envíe sobre un caso cerrado conocido.
- [ ] Un `PUT` con body `{}` sobre una fila de un caso cerrado responde **409**, no 200.
- [ ] Un `PUT` que cambia un campo sobre una fila de un caso cerrado no escribe: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `005A` rechazado por caso cerrado deja la fila con `isActive: true`. Un `005B` rechazado la deja con `isActive: false` y el mismo `sortOrder`.
- [ ] Los `001` de `CLASSIF`, `NOTIFCN`, `INVESTGN` y `FINCLASS` sobre un caso cerrado siguen respondiendo `CASEFLOW_012_CASE_CLOSED`.
- [ ] Las lecturas (`002A`, `002B`, `003`, `006`) y los `005C` de las 28 entidades responden sobre un caso cerrado igual que sobre uno abierto.
- [ ] `tests/contract/caseClosedGuard.test.ts` tiene 85 filas en `CLOSED_GUARD_RULES`, y su meta-prueba falla si se elimina cualquiera de ellas.
- [ ] `grep -rn "assertCaseIsOpen" src/services/ | grep -v caseWorkflow.service.ts | cut -d: -f1 | sort -u | wc -l` devuelve **28**.
- [ ] `git diff main -- src/data/i18n/` está vacío.

**Update diferencial.** El guardia no toca el contrato de `candidates` de ningún `004`. Los cinco criterios de F12 siguen vigentes sobre un caso **abierto** y se comprueban de nuevo, porque el `004` de 28 servicios cambia:

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] Los servicios usan `buildDifferentialUpdate`; `grep -rn "delete objectToUpdate" src/services/` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un valor único ya ocupado **409**, aunque el resto del body no cambie nada.

Las suites de contrato de las 28 entidades ya cubren esos cinco criterios y deben seguir en verde sin cambios.

- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí: cubrir los satélites. El spec es de 85 rutas, no de cuatro.** La regla del cliente es «el expediente cerrado no se edita», no «las cuatro cabeceras cerradas no se editan». Aplicarla solo en las cabeceras dejaría fuera la mayoría de las escrituras reales. Un USER no podría corregir la descripción del ESAVI de un caso cerrado, pero sí retirarle la vacuna o añadirle un diagnóstico. Ese estado sería peor que el de hoy, porque aparentaría una protección que no existe.
- **Sí: guardia en cada servicio, no middleware.** Cuatro razones:
  1. **Coste.** El `:id` de la ruta es el de la fila, no el del caso. Un middleware tendría que saber, para 28 entidades, cómo subir de esa fila al caso. Eso duplicaría las lecturas de cadena que los servicios ya hacen por la visibilidad heredada: +2 consultas en cada escritura, frente a +1 en `001` y `004`.
  2. **Atomicidad.** El middleware corre fuera de la transacción de la escritura. El guardia corre dentro.
  3. **Orden de errores.** Desde el middleware, un id inexistente daría 409 o un error del resolvedor antes que el 404 del servicio. En el servicio, el orden 404 → 409 → FK/unicidad → diff cae solo.
  4. **Norma.** `CONVENTIONS.md` §2 pone las reglas de negocio en el servicio, y F44 puso ahí la misma regla para el `012`.

  El argumento a favor del middleware —que no se puede olvidar en una ruta nueva— lo cubre la meta-prueba del paso 8, con el mismo mecanismo que ya protege `ROUTE_RULES`.
- **No: trigger en la base de datos.** Sería la protección más fuerte, porque cubriría también el SQL directo. Pero un trigger no puede producir `NOTIFEVT_004_CASE_CLOSED`, sino un error de PostgreSQL que el servicio tendría que traducir en 28 sitios. Además, F44 declaró la regla deliberadamente sin respaldo en el esquema, para poder retirarla sin migración (`caseWorkflow.service.ts:990-992`).
- **Sí: un flujo ausente no bloquea.** Un caso sin flujo no puede estar cerrado: cerrar exige la fila (§3.3). Bloquear sería castigar los casos anteriores a F44 por un backfill que no es asunto de este spec.
- **Sí: el guardia va antes del diff, así que un `PUT` vacío sobre un caso cerrado responde 409.** La alternativa era responder 200 cuando no hay cambios y 409 solo si los hay. Es más permisiva, pero le dice al cliente que el caso es editable cuando no lo es. La regla es sobre el expediente, no sobre el contenido del body.
- **Sí: `005A` y `005B` incluidos.** Retirar la vacuna de un caso cerrado lo altera tanto como editarla. El `005B` es ADMIN (o SUPERADMIN), y quien tiene ese rol puede reabrir con `009` antes. El guardia le exige ese paso explícito, que queda registrado en el flujo (`reopenCount`, `lastReopenedAt`).
- **No: `005C` incluido.** La purga es SUPERADMIN y solo alcanza filas ya retiradas por un `005A`. Tras este spec, ese `005A` no puede ocurrir con el caso cerrado. Purgar lo que se retiró antes de cerrar es limpieza de datos, no edición del expediente. Y bloquearla obligaría a reabrir un caso cerrado solo para borrar basura, dejando un `reopenCount` que no significa nada clínico.
- **No: `ESAVI-CASE-005A`/`005B` ni `patient`.** Ver §2. El primero es ciclo de vida del caso; el segundo, un dato compartido entre casos.
- **No: bloqueo `FOR SHARE` sobre la fila del flujo.** Cerraría la carrera entre una escritura y un `008` simultáneo. La carrera es de milisegundos. Su efecto es que entra una escritura que habría entrado igual diez milisegundos antes, así que no rompe ninguna integridad. Y el bloqueo serializaría el `008` contra toda escritura en curso del caso, que es un coste que la regla no justifica.
- **No: una clave i18n por entidad.** Ver §3.6.
- **No: dividir en varios specs por familia**, como pide el skill para specs de más de quince tablas. El cambio en cada servicio es el mismo en todos. Un spec parcial dejaría exactamente la puerta entornada que este spec existe para cerrar. En su lugar, el plan se divide por familia y cada paso se puede committear solo.
- **Definición rápida sin ronda de aclaraciones.** La petición delegó explícitamente la decisión de alcance y la de mecanismo. El spec se redactó entero en una pasada, sin la revisión sección por sección del flujo `/esavi-spec`. Las decisiones que conviene releer son la exclusión del `005C` y la del `ESAVI-CASE-005A`.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un satélite nuevo nace sin el guardia | La meta-prueba del paso 8 falla en cuanto su ruta entra en `ROUTE_RULES`, y la norma de §11 lo exige desde el spec |
| Un `005A`/`005B` responde 409 por caso cerrado antes que el 404 de una fila inexistente | §3.4: si la lectura mínima no encuentra la fila, el guardia no se evalúa y responde el servicio genérico. Cubierto por un criterio de §5 |
| El frontend recibe 409 donde hoy recibía 200 y lo muestra como error genérico | El cliente ya deshabilita esas escrituras sobre un caso cerrado, así que en uso normal no las emite. El 409 solo llega a quien se salta la interfaz, o por una carrera con el cierre. El sufijo `_CASE_CLOSED` es uniforme para tratarlo de una vez (§8) |
| Las suites de contrato existentes crean casos con flujo y lo cierran en algún punto | Los casos de las suites de satélite o no tienen flujo o lo tienen abierto. `caseWorkflow.test.ts` sí cierra y reabre, pero no escribe satélites entre medias. Los pasos 4 y 6 lo verifican ejecutando las suites de su familia |

---

## 8. Impacto en el contrato HTTP

Las 85 rutas de §3.2 ganan una respuesta: **409** con `code` `<PREFIX>_<op>_CASE_CLOSED` cuando el caso está cerrado. Hasta ahora respondían 200 en esa situación.

Para el cliente:

- **El sufijo es la interfaz.** `/_CASE_CLOSED$/` reconoce las 85 operaciones y las tres de `caseWorkflow` que ya lo usaban. No hace falta conocer los códigos uno por uno.
- **El mensaje ya viene traducido** y le dice al usuario qué hacer: reabrir.
- Ninguna respuesta de éxito cambia de forma. Ningún rol cambia.

---

## Lo que **no** está en este spec

- Bloquear lecturas, `005C`, `ESAVI-CASE-001/-005A/-005B` o `patient`.
- Un trigger de base de datos que aplique la regla.
- El backfill de flujos para casos anteriores a F44.
- Bloqueos de concurrencia sobre `caseWorkflow`.
- Cualquier cambio de rol — SPEC F60.

Cada uno de esos, si aterriza, va en su propio spec.
