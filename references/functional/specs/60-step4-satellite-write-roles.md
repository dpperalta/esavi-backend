# SPEC F60 — Escrituras de los satélites del paso 4 en USER

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 05 (códigos de operación), SPEC F16 (`notificationEvent`), SPEC F21 (`notificationMedication`), SPEC F22 (`notificationVaccine`), SPEC F24 (`notificationDiluent`), SPEC F25 (`notificationPregnancy`), SPEC F27 (`notificationPregnancyComplication`), SPEC F57 (`notificationMedicalHistory`), SPEC F31 y SPEC F58 (precedente del `005B` en ADMIN)
> **Fecha:** 2026-09-21
> **Objetivo:** Que quien crea un satélite del paso 4 pueda también corregirlo y retirarlo, y que quien supervisa pueda deshacer esa retirada, alineando el paso 4 con el paso 5.

---

## 1. Por qué existe este spec

**A — Un USER crea contenido clínico y no puede corregirlo ni retirarlo.** El 2026-09-04 los cuatro `001` de `NOTIFEVT`, `NOTIFVAC`, `NOTIFDIL` y `NOTIFMED` bajaron a USER, y sus `004` y `005A` se quedaron en ADMIN. Hoy, en `src/routes/`:

| Ruta | Línea | Rol hoy |
|---|---|---|
| `PUT /api/notification-events/:id` | `notificationEvent.routes.ts:73` | ADMIN |
| `DELETE /api/notification-events/:id` | `notificationEvent.routes.ts:77` | ADMIN |
| `PUT /api/notification-vaccines/:id` | `notificationVaccine.routes.ts:73` | ADMIN |
| `DELETE /api/notification-vaccines/:id` | `notificationVaccine.routes.ts:77` | ADMIN |
| `PUT /api/notification-diluents/:id` | `notificationDiluent.routes.ts:64` | ADMIN |
| `DELETE /api/notification-diluents/:id` | `notificationDiluent.routes.ts:68` | ADMIN |
| `PUT /api/notification-medications/:id` | `notificationMedication.routes.ts:73` | ADMIN |
| `DELETE /api/notification-medications/:id` | `notificationMedication.routes.ts:77` | ADMIN |
| `DELETE /api/notification-pregnancies/:id` | `notificationPregnancy.routes.ts:66` | ADMIN |
| `DELETE /api/notification-pregnancy-complications/:id` | `notificationPregnancyComplication.routes.ts:71` | ADMIN |
| `DELETE /api/notification-medical-histories/:id` | `notificationMedicalHistory.routes.ts:83` | ADMIN |

El USER escribe una fila mal y la fila se queda. El estado intermedio es peor que el de partida: antes el USER no tocaba nada y la asimetría al menos era coherente.

**B — No hay política que defender.** Tres hechos la descartan:

- `notificationMedicalHistory` (SPEC F57) es un satélite del paso 4 escrito **después** de la petición del frontend. Tiene el mismo contrato que los cuatro bloqueados: lista contra la notificación y resolución contra un catálogo clínico. Sus `001` y `004` son USER.
- Las catorce entidades del paso 5 escriben como USER sin excepción. Incluye `investigationDiagnostic` (SPEC F58), un dato más sensible que la lista de vacunas administradas. Y desde el commit `d151805` (2026-09-16) también sus cinco `005A` con identidad propia —`INVTEAM`, `INVVACAD`, `INVPREG`, `EVALINST`, `INVDIAG`— son USER.
- Las vecinas directas del paso 4 —`NOTIFCN-004`, `SEVNOT-004`, `NSEVNOT-004`, `NOTIFPRG-004`, `PREGCOMP-004`, `MEDHIST-004`— ya son USER.

La asimetría es deriva: F16, F21, F22 y F24 eligieron sus roles por su cuenta.

**C — La norma escrita dice lo contrario de lo que hace el código, y hay que corregir la norma.** `references/CONVENTIONS.md` §9 declara que en el árbol de notificación **solo el `001`** es USER, y que «el `004`, el `005A` y el `002B` siguen la matriz canónica, porque corregir o dar de baja lo notificado no es notificar». Hoy lo incumplen `NOTIFCN-004`, `SEVNOT-004`, `NSEVNOT-004`, `NOTIFPRG-004`, `PREGCOMP-004`, `MEDHIST-004` y `NOTIFIER-004/005A`. La misma §9 prohíbe heredar la excepción «por analogía» fuera del árbol, y el paso 5 entero la hereda. Los comentarios de ruta del paso 5 lo registran como «departing from the canonical role». La regla se quedó atrás; este spec la reescribe para que describa la política real y la cumplan las once rutas de A.

**D — El `005B` reparte roles por familia, no entre un par.** La divergencia `MEDHIST-005B` (SUPERADMIN) frente a `INVDIAG-005B` (ADMIN) no es un caso aislado:

| Familia | `005B` hoy | Fuente |
|---|---|---|
| Satélites del paso 4 con `isActive`: `NOTIFEVT`, `NOTIFVAC`, `NOTIFDIL`, `NOTIFMED`, `NOTIFPRG`, `PREGCOMP`, `MEDHIST` | SUPERADMIN | `roles.test.ts:255,317,348,272,368,388,407` |
| Satélites del paso 5 con `isActive`: `INVTEAM`, `INVPREG`, `EVALINST`, `INVVACAD`, `INVDIAG` | ADMIN | `roles.test.ts:480,515,557,600,690` |

Las dos familias lo justifican por escrito, y con argumentos opuestos. `notificationMedicalHistory.routes.ts:63-64`: se queda en SUPERADMIN porque «in the notification block that operation never dropped below SUPERADMIN». F31 §3.4: baja a ADMIN porque la reasignación de `sortOrder` hace que «quien administra el caso debe poder ejecutarla». Alinear sólo `MEDHIST` o sólo `INVDIAG` movería la divergencia de sitio sin cerrarla. §6 decide.

---

## 2. Alcance

**Dentro:**

- Bajar a USER el argumento de `validateUserRole(...)` en `router.put('/:id', …)` y `router.delete('/:id', …)` de `NOTIFEVT`, `NOTIFVAC`, `NOTIFDIL` y `NOTIFMED`: ocho rutas.
- Bajar a USER el argumento de `validateUserRole(...)` en `router.delete('/:id', …)` de `NOTIFPRG`, `PREGCOMP` y `MEDHIST`: tres rutas.
- Bajar de SUPERADMIN a ADMIN el `005B` de las siete entidades del paso 4 con `isActive`: `NOTIFEVT`, `NOTIFVAC`, `NOTIFDIL`, `NOTIFMED`, `NOTIFPRG`, `PREGCOMP` y `MEDHIST`. Decisión razonada en §6.
- Actualizar el comentario de cada una de esas dieciocho rutas.
- Actualizar las dieciocho filas de `ROUTE_RULES` en `tests/auth/roles.test.ts` y las nueve aserciones de `tests/contract/` que dejan de ser ciertas (§3.3).
- Reescribir la excepción de `references/CONVENTIONS.md` §9 para que describa la política real (§3.2).
- Registrar la verificación de que los cinco `005A` del paso 5 ya son USER, sin tocarlos.

**Fuera de alcance (otros specs):**

- **Los `002B`, los `005C` y cualquier `005B` fuera de los siete del paso 4.** Los listados con inactivas se quedan en ADMIN y la purga en SUPERADMIN.
- **Los servicios, validadores y controladores.** Ningún servicio de estas entidades consulta el rol. `canViewInactive` sigue siendo SUPERADMIN y sigue decidiendo lo mismo. Este spec no toca ni una línea bajo `src/services/`.
- **El `005A` de las cabeceras de fase.** `CLASSIF-005A`, `NOTIFCN-005A` y `FINCLASS-005A` son ADMIN, y `INVESTGN-005A` es USER desde `d151805`. Retirar la cabecera de una fase es otra decisión que retirar un evento: arrastra la lectura de todo el paso. Se deja anotado como divergencia en §7 y queda fuera.
- **Rechazar escrituras sobre un expediente `CLOSED`.** Es el SPEC F61. F60 amplía quién puede escribir y F61 acota cuándo. Se pueden aplicar en cualquier orden.
- **Regenerar `API-ROUTES.md`.** Es un paso posterior a la implementación, en el repositorio del frontend (§4, paso 6).

---

## 3. Modelo de datos

No hay tablas, columnas, modelos, tipos ni claves i18n nuevos. Este spec es transversal: cambia la autorización de dieciocho rutas y la norma que la rige.

### 3.1 Superficie HTTP — Antes / Después

```
PUT    /api/notification-events/:id                       ESAVI-NOTIFEVT-004   ADMIN       → USER
DELETE /api/notification-events/:id                       ESAVI-NOTIFEVT-005A  ADMIN       → USER
PATCH  /api/notification-events/activate/:id              ESAVI-NOTIFEVT-005B  SUPERADMIN  → ADMIN
PUT    /api/notification-vaccines/:id                     ESAVI-NOTIFVAC-004   ADMIN       → USER
DELETE /api/notification-vaccines/:id                     ESAVI-NOTIFVAC-005A  ADMIN       → USER
PATCH  /api/notification-vaccines/activate/:id            ESAVI-NOTIFVAC-005B  SUPERADMIN  → ADMIN
PUT    /api/notification-diluents/:id                     ESAVI-NOTIFDIL-004   ADMIN       → USER
DELETE /api/notification-diluents/:id                     ESAVI-NOTIFDIL-005A  ADMIN       → USER
PATCH  /api/notification-diluents/activate/:id            ESAVI-NOTIFDIL-005B  SUPERADMIN  → ADMIN
PUT    /api/notification-medications/:id                  ESAVI-NOTIFMED-004   ADMIN       → USER
DELETE /api/notification-medications/:id                  ESAVI-NOTIFMED-005A  ADMIN       → USER
PATCH  /api/notification-medications/activate/:id         ESAVI-NOTIFMED-005B  SUPERADMIN  → ADMIN
DELETE /api/notification-pregnancies/:id                  ESAVI-NOTIFPRG-005A  ADMIN       → USER
PATCH  /api/notification-pregnancies/activate/:id         ESAVI-NOTIFPRG-005B  SUPERADMIN  → ADMIN
DELETE /api/notification-pregnancy-complications/:id      ESAVI-PREGCOMP-005A  ADMIN       → USER
PATCH  /api/notification-pregnancy-complications/activate/:id  ESAVI-PREGCOMP-005B  SUPERADMIN  → ADMIN
DELETE /api/notification-medical-histories/:id            ESAVI-MEDHIST-005A   ADMIN       → USER
PATCH  /api/notification-medical-histories/activate/:id   ESAVI-MEDHIST-005B   SUPERADMIN  → ADMIN
```

**Solo verificación, sin cambios** (bajaron en `d151805`):

```
DELETE /api/investigation-team-members/:id                ESAVI-INVTEAM-005A   USER  (existe)
DELETE /api/investigation-vaccines-administered/:id       ESAVI-INVVACAD-005A  USER  (existe)
DELETE /api/investigation-pregnancy-conditions/:id        ESAVI-INVPREG-005A   USER  (existe)
DELETE /api/evaluation-institutions/:id                   ESAVI-EVALINST-005A  USER  (existe)
DELETE /api/investigation-diagnostics/:id                 ESAVI-INVDIAG-005A   USER  (existe)
```

No cambia el orden de declaración: las rutas siguen donde están y solo cambia el argumento de `validateUserRole`. Sigue valiendo la regla de §9: un solo rol, el mínimo.

**Comentario de ruta.** El de cada ruta pasa a citar la excepción de §9 en vez de la matriz canónica. Forma, para el `004` y el `005A`: «USER, under the clinical file exception of CONVENTIONS §9: whoever records the row corrects and retires it». Para el `005B`: «ADMIN, under the clinical file exception of CONVENTIONS §9: undoing a USER's retirement belongs to whoever supervises the case, not to the system administrator». El comentario de `notificationMedicalHistory.routes.ts:63-64` desaparece: su premisa —«in the notification block that operation never dropped below SUPERADMIN»— deja de ser cierta.

### 3.2 Norma — `references/CONVENTIONS.md` §9

**Antes** (párrafo «Excepción declarada — el alta del árbol de notificación es `USER`»): solo el `001` de once entidades es USER; el `004`, el `005A` y el `002B` siguen la matriz canónica; ninguna entidad fuera del árbol hereda la excepción.

**Después** — el párrafo se sustituye por «Excepción declarada — el expediente clínico se escribe como `USER`», con este contenido:

| Entidades | `001` | `004` | `005A` | `005B` | `002B` | `005C` |
|---|---|---|---|---|---|---|
| Satélites de `notification` y de `investigation`, a cualquier profundidad | USER | USER | USER | ADMIN | ADMIN | SUPERADMIN |
| Cabeceras del expediente: `patient`, `esaviCase`, `notifier`, `classification`, `notification`, `investigation`, `finalClassification` | USER | USER | por entidad, ver `ROUTE_RULES` | SUPERADMIN | ADMIN | SUPERADMIN |

Y dos frases que la acompañan:

- **La razón.** Quien registra un dato clínico lo corrige y lo retira; retirar es borrado lógico, reversible con `005B`. Deshacer la retirada de un USER es supervisión del caso y va en ADMIN. Destruir va en SUPERADMIN.
- **El límite.** La excepción cubre las entidades de la tabla y ninguna más. Un spec nuevo que cuelgue de `notification` o de `investigation` la hereda sin tener que justificarla. Un spec fuera de ese árbol sigue la matriz canónica.

La fila de cabeceras declara el `005A` «por entidad» porque hoy no es uniforme (§7). Este spec no lo arregla, pero la norma no lo esconde.

### 3.3 Pruebas afectadas

**`tests/auth/roles.test.ts` → `ROUTE_RULES`.** Cambian dieciocho filas, las de §3.1: la columna `minRole` de cada una.

| Filas | `minRole` antes → después |
|---|---|
| `NOTIFEVT-004` `:257`, `NOTIFEVT-005A` `:258` | `ADMIN` → `USER` |
| `NOTIFMED-004` `:274`, `NOTIFMED-005A` `:275` | `ADMIN` → `USER` |
| `NOTIFVAC-004` `:319`, `NOTIFVAC-005A` `:320` | `ADMIN` → `USER` |
| `NOTIFDIL-004` `:350`, `NOTIFDIL-005A` `:351` | `ADMIN` → `USER` |
| `NOTIFPRG-005A` `:371`, `PREGCOMP-005A` `:391`, `MEDHIST-005A` `:410` | `ADMIN` → `USER` |
| `NOTIFEVT-005B` `:255`, `NOTIFMED-005B` `:272`, `NOTIFVAC-005B` `:317`, `NOTIFDIL-005B` `:348`, `NOTIFPRG-005B` `:368`, `PREGCOMP-005B` `:388`, `MEDHIST-005B` `:407` | `SUPERADMIN` → `ADMIN` |

La suite deriva de cada fila dos pruebas: el rol inmediatamente inferior recibe 403 y el mínimo no lo recibe. Para las filas en USER, «inferior» es ANALYTICS. Para las de `005B` en ADMIN, es USER. Los comentarios de bloque de `:245-249`, `:264-266`, `:306-311`, `:338-343` y `:395-401` que describan el reparto de roles se ajustan en el mismo paso.

`ROUTE_RULES` es también la fuente de `esavi-frontend/references/API-ROUTES.md`, que genera `esavi-frontend/references/scripts/extract-routes.cjs`. Este spec cambia dieciocho filas de ese inventario.

**`tests/contract/`.** Nueve aserciones dejan de ser ciertas y se invierten. Se prueba lo contrario: que el rol ahora admitido **no** recibe 403, y que el rol inferior sí lo recibe.

| Archivo | Línea | Hoy | Pasa a |
|---|---|---|---|
| `notificationEvent.test.ts` | `:602` | `004` con USER → 403 | `004` con USER → 200; con ANALYTICS → 403 |
| `notificationEvent.test.ts` | `:673` | `005B` con ADMIN → 403 | `005B` con ADMIN → 200; con USER → 403 |
| `notificationMedication.test.ts` | `:718` | `005B` con ADMIN → 403 | ídem |
| `notificationPregnancyComplication.test.ts` | `:779` | `005A` con USER → 403 | `005A` con USER → 200; con ANALYTICS → 403 |
| `notificationPregnancyComplication.test.ts` | `:868-869` | `005B` con USER y ADMIN → 403 | USER → 403; ADMIN → 200 |
| `notificationMedicalHistory.test.ts` | `:978-983` | `005A` con USER → 403 | `005A` con USER → 200; con ANALYTICS → 403 |
| `notificationMedicalHistory.test.ts` | `:1057-1064` | `005B` con ADMIN y USER → 403 | USER → 403; ADMIN → 200 |

Los títulos de esos `it(...)` que nombren el rol mínimo («el rol minimo es SUPERADMIN», «answers 403 for an ADMIN on the activation») se reescriben con el rol nuevo. La lista es la que devuelve hoy un `grep` sobre los siete archivos. El paso 4 del plan la vuelve a ejecutar para no dejar ninguna atrás.

### 3.4 Update diferencial

Este spec no modifica ninguna operación de escritura. Los `004` afectados ya pasan por `buildDifferentialUpdate` (SPEC F12), y este spec solo cambia quién puede invocarlos, no cómo escriben. Los `005A`/`005B` siguen siendo escrituras con intención propia, no diferenciales, como declaran sus specs de origen. No lleva tabla de `candidates` ni el bloque de cinco criterios de §5 porque no hay contrato de update que declarar.

---

## 4. Plan de implementación

1. **Norma.** Reescribir la excepción de `references/CONVENTIONS.md` §9 según §3.2. Va primero porque es lo que citan los comentarios de ruta de los pasos siguientes.
   *Verificación:* `grep -n "Solo el \`001\`" references/CONVENTIONS.md` no devuelve resultados; el párrafo nuevo contiene la tabla de §3.2.

2. **`004` y `005A` a USER.** Cambiar el argumento de `validateUserRole` en las once rutas de §1.A y reescribir su comentario (§3.1). Actualizar las once filas correspondientes de `ROUTE_RULES`.
   *Verificación:* `npx jest tests/auth/roles.test.ts` sale en 0; `grep -nE "router\.(put|delete)\('/:id', tokenValidation, validateUserRole\(ADMIN\)" src/routes/notification{Event,Vaccine,Diluent,Medication,Pregnancy,PregnancyComplication,MedicalHistory}.routes.ts` no devuelve resultados.

3. **`005B` a ADMIN.** Cambiar el argumento de `validateUserRole` en las siete rutas `PATCH /activate/:id` del paso 4 y reescribir su comentario, eliminando el de `notificationMedicalHistory.routes.ts:63-64`. Actualizar las siete filas de `ROUTE_RULES`.
   *Verificación:* `npx jest tests/auth/roles.test.ts` sale en 0; `grep -n "validateUserRole(SUPERADMIN)" src/routes/notification{Event,Vaccine,Diluent,Medication,Pregnancy,PregnancyComplication,MedicalHistory}.routes.ts` devuelve exactamente siete líneas, todas de `/purge/:id`.

4. **Contrato.** Invertir las aserciones de §3.3 en `tests/contract/`. Antes de cerrar, repetir la búsqueda: `grep -nE "(update|delete|remove|activate)[A-Za-z]*\([^)]*'(USER|ADMIN)'\)" tests/contract/notification*.test.ts | grep 403`.
   *Verificación:* la búsqueda solo devuelve aserciones coherentes con §3.1 (USER → 403 en `005B`, ninguna USER → 403 en `004`/`005A`); `npx jest tests/contract/notification` sale en 0.

5. **Cierre.** `npm run check`.
   *Verificación:* sale en 0.

6. **Fuera del repositorio, después del merge.** Regenerar `esavi-frontend/references/API-ROUTES.md` desde `esavi-backend` con `node ../esavi-frontend/references/scripts/extract-routes.cjs ../esavi-frontend/references/routes-table.md`, sustituir la sección «Rutas por entidad» y actualizar la fecha de cabecera. **`esavi-backend` no tiene copia propia de `API-ROUTES.md`**: el inventario vive solo en el frontend y se genera desde `ROUTE_RULES` de aquí. «Regenerar en los dos repositorios» significa ejecutar el script aquí y escribir el resultado allí.
   *Verificación:* en el `API-ROUTES.md` regenerado, las dieciocho filas de §3.1 muestran el rol nuevo, y las cinco `005A` del paso 5 muestran USER.

---

## 5. Criterios de aceptación

- [ ] Un USER responde **200** en `PUT /api/notification-events/:id`, `PUT /api/notification-vaccines/:id`, `PUT /api/notification-diluents/:id` y `PUT /api/notification-medications/:id` sobre una fila activa suya.
- [ ] Un USER responde **200** en el `DELETE /:id` de las siete entidades del paso 4 con `isActive`, y la fila queda con `isActive: false` y `deletedAt` sellado.
- [ ] Un ANALYTICS recibe **403** `AUTH_ROLE_FORBIDDEN` en esas once rutas.
- [ ] Un ADMIN responde **200** en el `PATCH /activate/:id` de las siete entidades del paso 4, y un USER recibe **403**.
- [ ] La reactivación por ADMIN de una fila cuyo `sortOrder` ya ocupó una hermana viva la reasigna igual que antes lo hacía SUPERADMIN, sin 500 por `UQ_*_parent_sortOrder`.
- [ ] Un USER sigue recibiendo **403** en el `002B` de las siete entidades, y un ADMIN en su `005C`.
- [ ] Las cinco rutas `005A` del paso 5 de §3.1 siguen en USER en `ROUTE_RULES` y en `src/routes/`.
- [ ] `git diff --stat main -- src/services src/controllers src/validators` no muestra cambios.
- [ ] `references/CONVENTIONS.md` §9 contiene la tabla de §3.2 y ya no dice que el `004` y el `005A` del árbol de notificación sigan la matriz canónica.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** bajar los once `004`/`005A` a USER. Las razones están en §1.B. La que decide es la de F57: un spec del mismo paso y el mismo tipo de dato, redactado después, eligió USER. No queda una política que los cuatro respeten y `MEDHIST` incumpla.
- **Sí:** reescribir la norma de §9 en vez de seguir acumulando desviaciones. La excepción la incumplen ya siete entidades del paso 4 y las catorce del paso 5. Cada spec nuevo del expediente habría tenido que razonar su propia «departure». Una norma que describe el reparto real es la que protege el próximo spec de volver a derivar.
- **Sí:** `005B` de los satélites en **ADMIN**, en las dos familias. Tres razones:
  1. Con el `005A` en USER, el `005B` es el deshacer de un error de un USER. Deshacer ese error es supervisión del caso, que es lo que hace un ADMIN. SUPERADMIN es el rol de sistema. Exigirlo convierte un «me equivoqué al borrar el evento» en una petición al administrador de la plataforma.
  2. El argumento de SUPERADMIN en el paso 4 era histórico, no de riesgo: «the operation never dropped below SUPERADMIN». El de ADMIN en el paso 5 es funcional: F31 §3.4 dice que la reasignación de `sortOrder` la debe poder ejecutar quien administra el caso. Esa reasignación es idéntica en las siete entidades del paso 4, que arrastran el mismo hallazgo de F16.
  3. Es la única opción que no crea una divergencia nueva. Tras este spec, **todo satélite con `isActive` tiene `005B` en ADMIN**. Toda cabecera sigue en SUPERADMIN. El criterio es visible: satélite o cabecera.
- **No:** mover solo `MEDHIST-005B` a ADMIN, la lectura literal de la petición. Cerraría el par `MEDHIST`/`INVDIAG` y abriría `MEDHIST`/`NOTIFEVT` dentro del mismo paso. **Es el único punto donde este spec toca un `005B` pese a que la petición decía que no se tocaban.** Si al revisar se prefiere el alcance literal, se eliminan las seis filas restantes del paso 3 y §3.2 declara «`005B` por entidad» para el paso 4.
- **No:** subir `INVDIAG-005B` (y con él los cinco del paso 5) a SUPERADMIN. Endurece operaciones que llevan en producción desde F31 sin incidentes. Además va en sentido contrario al de este spec: el problema que se está cerrando es que el USER no puede deshacer lo suyo, no que el ADMIN pueda demasiado.
- **No:** bajar los `002B` a USER. Listar las inactivas es auditoría, no captura. El asistente del frontend no las necesita.
- **No:** tocar el `005A` de las cabeceras de fase. Ver §7 y el bloque final.
- **Definición rápida sin ronda de aclaraciones.** La petición llegó con el alcance cerrado y delegó explícitamente la única decisión abierta (el `005B`). El spec se redactó entero en una pasada, sin la revisión sección por sección del flujo `/esavi-spec`. La decisión del `005B` es la que conviene releer.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un USER retira por error la vacuna de otro USER del mismo caso | Es borrado lógico: la fila, su `appDetails` y su `sortOrder` se conservan, y un ADMIN la reactiva con `005B`. `appDetails` registra quién retiró (`method: ESAVI-*-005A`) |
| El `005A` de las cabeceras queda incoherente: `INVESTGN-005A` es USER desde `d151805`, mientras que `NOTIFCN-005A`, `CLASSIF-005A` y `FINCLASS-005A` son ADMIN | Fuera de alcance, y declarado en la norma como «por entidad» para que no pase por regla. Es la próxima decisión a tomar. El cambio de `INVESTGN-005A` no pasó por spec y es el caso más delicado: retirar la cabecera oculta las trece satélites por visibilidad heredada |
| El inventario del frontend describe roles antiguos hasta que alguien lo regenere | Paso 6 del plan. El frontend ya diseña `FE12b` asumiendo USER (`CASE-PROCESS.md` §10.4) |

---

## 8. Impacto en el contrato HTTP

Ninguna respuesta cambia de forma. Cambia qué rol recibe 403:

- Once rutas que respondían **403** a un USER pasan a responder 200 (o el 404/409 de su servicio).
- Siete rutas que respondían **403** a un ADMIN pasan a responder 200 (o el 404/409 de su servicio).

Ninguna ruta pasa a rechazar a un rol que antes admitía.

---

## Lo que **no** está en este spec

- Los `002B`, los `005C` y los `005B` de las cabeceras.
- El `005A` de las cabeceras de fase (`CLASSIF`, `NOTIFCN`, `INVESTGN`, `FINCLASS`).
- Rechazar escrituras sobre un expediente cerrado — SPEC F61.
- Cualquier cambio en servicios, validadores o controladores.

Cada uno de esos, si aterriza, va en su propio spec.
