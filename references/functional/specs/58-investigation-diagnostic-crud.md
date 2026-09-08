# SPEC F58 — CRUD de `investigationDiagnostic`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F57 (`notificationMedicalHistory` — precedente directo: aporta la forma de añadir una tabla al DDL, las tres ramas de resolución contra el maestro clínico, la guarda de duplicado sin respaldo de base y el `005C` fuera de `preventPhysicalDelete`)**, **SPEC F33 (`investigationPregnancyCondition` — gemelo estructural dentro de la cadena de investigación: aporta la tabla de `candidates` con derivados)**, **SPEC F15 (`diagnosticTerm` — dependencia dura de implementación: aporta `resolveDiagnosticTermService`)**, **SPEC F28 (`investigation` — padre de la FK: sin investigación no hay diagnóstico, y su volcado de purga gana una décima línea)**, SPEC F31 (`investigationTeamMember` — hermana de forma: de ahí salen la matriz de roles de la familia y la forma del `006`), SPEC F16 (`notificationEvent` — origen del hallazgo del `sortOrder` en el `005B` y de la nota de `CREATE_FIELDS`), SPEC F46 (`value` semántico de los catálogos sembrados), SPEC F47 (`patient` — precedente de editar `esaviapp.sql` en el sitio, sin migración), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate`)
> **Fecha:** 2026-09-08
> **Objetivo:** Crear `investigationDiagnostic` —los diagnósticos finales del paciente investigado, N por investigación, resueltos contra el maestro clínico y tipificados por catálogo— como **la segunda tabla que este repositorio añade al DDL, y la primera que además siembra su propio catálogo**.

---

## 1. Por qué existe este spec

La investigación termina en un diagnóstico y **no hay ninguna columna donde escribirlo**. `investigationClinicalEvaluation` (`esaviapp.sql:1182`) guarda `completeClinicalSummary`, `signsAndSymptoms` y `familyClinicalDetails`: tres campos `text` de prosa libre. `investigation` (`:1026`) guarda `statusItemId`, que es el **desenlace** del paciente —recuperado, fallecido—, no lo que se le diagnosticó. Y `finalClassification` (`:1357`) guarda la **causalidad** frente a la vacuna, que es otra pregunta distinta. El diagnóstico final, hoy, vive dentro de un párrafo de texto que nadie puede agregar, contar ni cruzar con el maestro clínico.

**A — Es la segunda tabla nueva del repositorio, y la primera que siembra catálogo.** F57 abrió la puerta apoyándose en F47: se edita `esaviapp.sql` en el sitio, sin script de migración, porque el sistema está en desarrollo y la base se carga entera. Ese supuesto sigue vigente. La diferencia con F57 es que aquí no basta con el `CREATE TABLE`: la tabla trae una FK a `catalogItem` cuyo `catalogType` **no existe todavía**, así que el spec siembra también los tres `CALL "upsertCatalogItem"` de `diagnosticType`. **El esquema pasa de 49 a 50 tablas.** La línea de `CLAUDE.md` dice hoy «49 tables» y «46» modelos, cifras que ya son correctas —F57 dejó contadas su tabla y su modelo—, así que este spec las deja en 50 y 47.

**B — De forma es el gemelo de F33 con una diferencia de profundidad y dos columnas propias.** PK propia con `DEFAULT gen_random_uuid()`, FK `NOT NULL` al padre con `ON DELETE CASCADE`, `diagnosticTermId` anulable con `ON DELETE RESTRICT`, una sola columna de texto libre, `sortOrder` por trigger, `isActive` propio y las cinco transversales. Pero F33 es **nieta** —cuelga de `investigationMedicalHistory`— y ésta es **hija directa** de `investigation`: la visibilidad heredada es de **un salto**, como en `investigationTeamMember` y `investigationVaccineAdministered`. Y añade dos columnas que ninguna hermana de resolución clínica tiene: `diagnosticDate` y `diagnosticTypeItemId`.

**C — Cuelga de `investigation` y no de `investigationClinicalEvaluation`, deliberadamente.** El formulario captura el diagnóstico final dentro de la sección de evaluación clínica, y `evaluationInstitution` (`:1206`) sí cuelga de ahí. Pero **un diagnóstico final puede conocerse sin que la evaluación clínica se haya ejecutado** —llega por informe de laboratorio, por epicrisis del hospital, por autopsia—, y colgarlo del bloque 1:1 obligaría a crear una `investigationClinicalEvaluation` vacía solo para poder registrarlo. La proximidad en el formulario no es una jerarquía de datos. La consecuencia asumida —dos secciones del formulario escribiendo contra padres distintos— está en §7.

**D — Arrastra el hallazgo del `005B` de F16, y es la novena vez.** La tabla entra en el bucle `setSortOrderByParent` (`:1445-1462`) con `investigationId` como padre y lleva índice único parcial sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. El trigger es `BEFORE INSERT` solamente y `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número: reactivar un diagnóstico cuyo `sortOrder` ya lo tomó otro hermano vivo revienta el índice. F16 lo descubrió; F21, F22, F24, F27, F31, F33 y F57 lo arrastraron; aquí vuelve entero, y es la razón de que el `005B` no delegue sin más en `setEntityActiveStatusService`.

**E — Nace con un trigger heredado y dos listas que hay que tocar a mano.** El bucle de `sysDetails` (`:1422-1437`) **no lista tablas: las descubre** con una consulta a `information_schema.columns`, así que declarar la columna basta para que `TRG_investigationDiagnostic_setSysDetails` exista. El de `sortOrder` va por lista literal y **sí hay que añadir la fila**. Y `preventPhysicalDelete` (`:1507-1522`) también va por lista: dejarla fuera —deliberado— es lo que hace que a esta tabla le corresponda un `005C`.

**F — El `sortOrder` es presentación y nada más.** Se descartó una marca `isPrimary` con índice único parcial. El orden de la lista **no** declara cuál es el diagnóstico principal: son N diagnósticos finales de igual rango, y quien los presenta decide cómo. Razonado en §6.

**Y un rasgo que no la separa:** el `ESAVI-INVESTGN-005A` **no** sella estas filas. `satelliteCascade.service.ts` arrastra únicamente los satélites 1:1 sin `isActive` propio; las hijas 1:N con estado propio se quedan fuera, exactamente como `investigationTeamMember`, `investigationVaccineAdministered` y `evaluationInstitution`. **`satelliteCascade.service.ts` no se toca.** Lo que sí las alcanza es el `005C`: el `ON DELETE CASCADE` de Postgres las destruye, y por eso el volcado de la purga de la investigación gana una décima línea.

---

## 2. Alcance

**Dentro:**

- **La tabla nueva en `esaviapp.sql`**, con la forma de §3.1: `CREATE TABLE`, su índice `IX_investigationDiagnostic_investigation`, su fila en el bucle `setSortOrderByParent` y su índice único parcial `UQ_investigationDiagnostic_parent_sortOrder`. **Fuera** de `preventPhysicalDelete`. Se inserta al final del bloque `-- Investigation split model`, después de `investigationCommunity` (`esaviapp.sql:1355`) y antes de `finalClassification` (`:1357`).
- **La siembra del `catalogType` `diagnosticType`**, tres `CALL "upsertCatalogItem"` en el bloque de siembra, junto a `evaluationInstitutionType` (`:1783`): `PRESUMPTIVE` / Presuntivo, `CONFIRMED` / Confirmado, `DIFFERENTIAL` / Diferencial, con `value` idéntico al `code` y `sortOrder` 1 a 3. Es la primera vez que un spec de entidad siembra el catálogo del que depende, en vez de declararlo precondición de despliegue.
- **La constante `DIAGNOSTIC_TYPE_CATALOG_CODE = 'diagnosticType'`** en `src/constants/investigation.constants.ts`, junto a las tres que ya viven ahí, y **nunca escrita como literal en el servicio** — la misma regla que verifican por `grep` los criterios de aceptación de F28.
- **La cuenta de tablas de `CLAUDE.md`**, que queda en **50**, y la de modelos, que queda en **47**.
- Los siete artefactos completos: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta, bajo la ruta base `/api/investigation-diagnostics`.
- **Nueve operaciones y ninguna más:** `001` crear, `002A` listar activos por investigación, `002B` listar todos por investigación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar, `005C` borrado físico y **`006` listar los diagnósticos de un caso**. El `006` tiene ruta HTTP, como el de `INVTEAM` e `INVVACAD`, y **se registra en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6**.
- **Matriz de roles de la familia de investigación**, no la canónica de §9: `001`, `002A`, `003`, `004` y `006` para **USER**; `002B`, `005A` y `005B` para **ADMIN**; `005C` para **SUPERADMIN**. Es la matriz literal de `INVTEAM`, `INVPREG` e `INVVACAD` — quien captura la investigación es el mismo USER que captura su diagnóstico. La desviación frente a §9 se razona en §6.
- **Listado por padre, no global.** `002A` en `GET /investigation/:id` para USER devuelve solo los activos; `002B` en `GET /admin/investigation/:id` para ADMIN los devuelve todos, incluidos los de `deletedAt` sellado. **Sin ningún filtro por query** —tampoco por `diagnosticTypeItemId`—, ordenados por `sortOrder` ascendente y paginados con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Nunca por `/`.
- **El `006` entra por `caseId` y es el `002A` con dos guardas delante**, en la forma literal de `INVTEAM-006`: el caso existe y está activo → 404; su investigación existe y está activa → 404; a partir de ahí, solo activos, ordenados por `sortOrder`. **No se declara variante admin del `006`**: quien necesite ver inactivos entra por el `002B` con el `investigationId` que este mismo endpoint devuelve.
- **Guarda del padre en `001`, `002A` y `002B`:** la investigación existe y está activa → 404 `INVDIAG_<op>_INVESTIGATION_NOT_FOUND`. En los dos listados la comprobación de estado la relaja `canViewInactive`; **en el `001` no se relaja para nadie**: una investigación inactiva no recibe diagnósticos nuevos, sea quien sea quien lo pida.
- **Visibilidad heredada de un salto**, en `002A`, `002B`, `003`, `004` y las filas del `006`: si la investigación está inactiva **o** el propio diagnóstico está inactivo, la respuesta es **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`). **No aplica a `005A`, `005B` ni `005C`**, que actúan sobre el estado propio de la fila.
- **Resolución contra el maestro clínico, en `001` y `004`**, con las tres ramas de F33 y F57:
  - Con `diagnosticCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService`, que devuelve el término existente o **lo crea**.
  - Con `diagnosticCode` y `source` distinto de `'LOCAL'` → `findOne` sobre el par `(source, code)`, **sin crear nada**; si no existe → 404 `INVDIAG_<op>_DIAGTERM_NOT_FOUND`.
  - Sin `diagnosticCode` → `diagnosticTermId` queda `null` y `diagnosticRaw` guarda el texto tal cual.
- **Dos campos derivados, no tres.** `diagnosticTermId` y `diagnosticRaw`. La tabla **no tiene columna para el nombre del maestro ni para el código**: `diagnosticRaw` guarda el texto del investigador **solo si difiere** del nombre del maestro, y el nombre canónico se lee del `include`. Es la tabla de F33 y F57, literal.
- **Resolución disparada por el cambio de valor, no por la presencia de la clave** (SPEC F12): en el `004`, un `diagnosticCode` que llega igual al guardado no se resuelve ni se consulta. Reenviar íntegra la respuesta del `GET` **no escribe en `diagnosticTerm`**.
- **`diagnosticName` obligatorio en el `001`**, máximo 500 caracteres, y **no anulable en el `004`**: un `null` explícito es 400 del validador.
- **`diagnosticDate` y `diagnosticTypeItemId` anulables en las dos operaciones.** El formulario actual no los captura; se declaran porque el dato es útil y añadir columnas después cuesta más que dejarlas puestas. Al ser anulables, entran en `candidates` comparados contra `undefined` y no por veracidad (§3.5).
- **Validación de `diagnosticTypeItemId` en `001` y `004`**, con las tres guardas habituales: el ítem existe, está activo, y su `catalogType.code` es `diagnosticType` → 400 `INVDIAG_<op>_INVALID_DIAGNOSTIC_TYPE` si falla cualquiera. **Sin valor por defecto**: a diferencia de `investigation.statusItemId`, aquí la ausencia se guarda como `null` y no se sustituye por ningún ítem.
- **`diagnosticDate` no futura** → 400 del validador. **Y nada más**: no se cruza contra `investigation.investigationStartDate`, ni contra `investigation.hospitalizationDate`, ni contra `esaviCase.eventDate`. Razonado en §6.
- **Guarda de duplicado**, en `001` y `004`: el `diagnosticTermId` no puede repetirse entre los diagnósticos **activos** de la misma investigación → 409 `INVDIAG_<op>_ALREADY_EXISTS`. **Solo corre si el término resolvió**: dos diagnósticos de texto libre son registros distintos aunque el texto coincida. No está respaldada por ninguna restricción de base: es regla de negocio del servicio. **El `005B` no la revalida**, y el duplicado por reactivación es consecuencia asumida, razonada en §6.
- **`investigationId` y `sortOrder` inmutables**, ignorados en silencio en el `004`, sin 400. Un diagnóstico no se traslada entre investigaciones y su orden lo gobierna la base.
- **`sortOrder` asignado por la base.** El `001` nunca lo envía. Exige la lista explícita `CREATE_FIELDS` en el `create`, por la razón que F16 §3.2 documentó: sin ella la validación `notNull` de Sequelize mata el alta antes de que el trigger llegue a ejecutarse.
- **Reasignación de `sortOrder` en `ESAVI-INVDIAG-005B`** cuando el número que ocupaba la fila ya lo tomó otro diagnóstico vivo de la misma investigación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5.
- **Normalización al escribir: solo `trim()`** sobre `diagnosticName` y `notes`, con `normalizeText`. Ningún `toTitleCase` ni `toConstantCase` — no hay `code` propio, y el del término lo normaliza `resolveDiagnosticTermService`.
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo: ninguna de las 50 la referencia. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — deliberado.
- **`005C` sin volcado de cascada propio**, porque no arrastra nada. Guarda canónica: la fila debe estar en `isActive: false` → si no, 409. La aporta `purgeEntityService` tal cual.
- **Un volcado `warn` en un archivo ajeno, y ningún bloqueo:** `investigation.service.ts` gana `dumpInvestigationDiagnosticsBeforeCascade`, la **décima** función de volcado de `ESAVI-INVESTGN-005C`, contada como la de `investigationTeamMember` (`investigation.service.ts:865`). Es la **única escritura de este spec fuera de su propia tabla**.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5: dos inmutables que no entran, dos derivados que entran **siempre**, y tres anulables.
- Alta de la abreviatura **`INVDIAG`** en `references/CONVENTIONS.md` §6, y de la fila del `006` en la tabla de operaciones no canónicas.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/investigationDiagnostic.test.ts`.

**Fuera de alcance:**

- **`satelliteCascade.service.ts` no se toca.** El `ESAVI-INVESTGN-005A` arrastra solo los satélites 1:1 sin `isActive` propio; esta tabla tiene estado propio y se queda fuera, como `investigationTeamMember`, `investigationVaccineAdministered` y `evaluationInstitution`.
- **No se escribe nada en `investigationClinicalEvaluation`.** Ni se exige que exista, ni se marca en ella que haya diagnóstico. Las dos secciones del formulario son vecinas, no jerárquicas.
- **No se escribe nada en `finalClassification` ni se dispara la clasificación final de F41.** El diagnóstico final es dato clínico; la clasificación es un juicio de causalidad con su propio flujo y su propia entidad.
- **No se toca `caseWorkflow` (F44).** Registrar un diagnóstico no avanza el estado administrativo del caso.
- **Sin marca de diagnóstico principal.** No hay `isPrimary` ni índice único parcial que lo respalde. Si más adelante se necesita, es una columna nueva y un spec nuevo.
- **Sin filtros de listado.** Ni por `diagnosticTypeItemId`, ni por rango de `diagnosticDate`, ni por término. Si se necesitan, van en el spec de búsqueda que corresponda, no aquí.
- **Sin `002` global ni listado transversal de diagnósticos.** Se entra siempre por investigación o por caso.
- **Sin agregación ni reporte.** Contar diagnósticos por término o por tipo es analítica y no cabe en un CRUD.
- **Sin migración de los diagnósticos que hoy viven en `completeClinicalSummary`.** El texto libre existente se queda donde está: nadie lo parsea ni lo mueve.

---

## 3. Modelo de datos

### 3.1 Tabla origen — **nueva**

`investigationDiagnostic` no existe todavía. Se declara entera al final del bloque `-- Investigation split model`, después de `investigationCommunity` (`esaviapp.sql:1355`) y antes de `finalClassification` (`:1357`): cierra la investigación, que es exactamente lo que el diagnóstico final hace.

```sql
CREATE TABLE IF NOT EXISTS "investigationDiagnostic" (
  "diagnosticId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investigationId" uuid NOT NULL,
  "diagnosticTermId" uuid,
  "diagnosticRaw" varchar(500),
  "diagnosticDate" date,
  "diagnosticTypeItemId" uuid,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationDiagnostic_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigationDiagnostic_term" FOREIGN KEY ("diagnosticTermId") REFERENCES "diagnosticTerm" ("diagnosticTermId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationDiagnostic_diagnosticType" FOREIGN KEY ("diagnosticTypeItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "IX_investigationDiagnostic_investigation" ON "investigationDiagnostic" ("investigationId");
```

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `diagnosticId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()`. Espejo de `pregnancyConditionId` (`:1165`) |
| `investigationId` | `uuid` | no | FK → `investigation("investigationId")`, `ON DELETE CASCADE`. **Sin `UNIQUE`** → uno a muchos |
| `diagnosticTermId` | `uuid` | sí | FK → `diagnosticTerm`, `ON DELETE RESTRICT`. **Derivada**: la devuelve la resolución, no el cliente |
| `diagnosticRaw` | `varchar(500)` | sí | Texto del investigador. **Derivada**: se guarda solo si difiere del nombre del maestro |
| `diagnosticDate` | `date` | sí | Fecha del diagnóstico. `date` y no `timestamptz`, como `hospitalizationDate` e `investigationStartDate` (`:1032-1033`) |
| `diagnosticTypeItemId` | `uuid` | sí | FK → `catalogItem`, `ON DELETE RESTRICT`. Presuntivo / confirmado / diferencial |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)`. Lo asigna el trigger; la aplicación no lo envía |
| `notes` | `text` | sí | Solo `trim()` |
| + `isActive`, `createdAt`, `updatedAt`, `deletedAt`, `sysDetails`, `appDetails` | | | Las seis transversales, en la forma exacta de `investigationPregnancyCondition` (`:1170-1175`) |

**Cuatro decisiones del DDL que no son copia mecánica.**

1. **Una sola raíz léxica: `diagnostic`.** `diagnosticRaw`, `diagnosticDate`, `diagnosticTypeItemId`, `diagnosticId`. El inglés natural pediría `diagnosisDate`, y se descarta: `notificationMedicalHistory` mantiene `historyRaw` / `historyName` / `historyCode` y F33 mantiene `conditionRaw`, y una entidad con dos raíces obliga a recordar cuál lleva cada uno de los siete artefactos. La longitud `varchar(500)` sale de las dos hermanas.
2. **`diagnosticTypeItemId` existe, y por eso hay catálogo que sembrar.** Es la diferencia real frente a F33 y F57, que no tienen ninguna FK a `catalogItem`. La forma es la de `complicationTypeItemId` de F27 (`:989`), pero **no** entra en la guarda de duplicado: la unicidad es sobre el término solo, razonado en §6.
3. **Sin `CHECK` sobre `diagnosticDate`.** La regla «no futura» se compara contra `current_date`, que no es inmutable y por tanto no puede vivir en un `CHECK` de Postgres. La guarda es del validador y solo del validador, y así queda declarado para que nadie la busque en la base.
4. **Sin `metadata jsonb`.** `notificationPregnancyComplication` la lleva (`:991`); F33 y F57 no. Se sigue a las dos últimas: no hay nada que guardar ahí que `sysDetails` y `appDetails` no cubran, y una columna abierta sin contrato declarado es una invitación a escribir lo que sea.

**Restricciones.** Tres claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla.** La única unicidad de base vive fuera, en el índice parcial de más abajo. **La guarda de duplicado sobre `diagnosticTermId` no está respaldada por nada**: es regla de negocio del servicio.

**Los dos `ON DELETE RESTRICT` son inertes en la práctica.** `diagnosticTerm` y `catalogItem` figuran ambos en el bucle `preventPhysicalDelete` (`:1507-1522`) y ninguno tiene `005C`, así que nunca llega a intentarse el borrado que las restricciones bloquearían.

**Las tres líneas que se añaden fuera del `CREATE TABLE`:**

- **Fila en el bucle `setSortOrderByParent`** (`:1445-1462`), como `('investigationDiagnostic', 'investigationId'),` a continuación de `('investigationVaccineAdministered', 'investigationId')` (`:1455`). Sin ella no hay `TRG_investigationDiagnostic_setSortOrder`, y todas las filas nacerían con `sortOrder: 0`.
- **Índice único parcial**, junto a los diez que ya hay (`:1473-1505`):
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "UQ_investigationDiagnostic_parent_sortOrder"
    ON "investigationDiagnostic" ("investigationId", "sortOrder")
    WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
  ```
  Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `D` de §1.
- **El índice `IX_investigationDiagnostic_investigation`**, en la línea siguiente al `CREATE TABLE`, con la forma de `IX_investigationPregnancyCondition_investigation` (`:1180`). El parcial no cubre el `002B`, que lee también filas con `deletedAt` sellado.

**La siembra del catálogo**, en el bloque de `CALL "upsertCatalogItem"`, inmediatamente después de `evaluationInstitutionType` (`:1787`):

```sql
CALL "upsertCatalogItem"('diagnosticType', 'Diagnostic type', 'PRESUMPTIVE',  'Presuntivo',  'PRESUMPTIVE',  1);
CALL "upsertCatalogItem"('diagnosticType', 'Diagnostic type', 'CONFIRMED',    'Confirmado',  'CONFIRMED',    2);
CALL "upsertCatalogItem"('diagnosticType', 'Diagnostic type', 'DIFFERENTIAL', 'Diferencial', 'DIFFERENTIAL', 3);
```

`code` y `value` idénticos, en `CONSTANT_CASE`; `name` en español, siguiendo a `investigationStatus` (`:1767-1772`) y no a `evaluationInstitutionType`, que los tiene en inglés. `upsertCatalogItem` crea el `catalogType` si no existe y es idempotente, así que recargar el DDL no duplica nada.

**Triggers. Dos, y solo uno se declara.** `TRG_investigationDiagnostic_setSysDetails` aparece solo: el bucle de `:1422-1437` **descubre** las tablas consultando `information_schema.columns` por la columna `sysDetails`, así que declararla basta. `TRG_investigationDiagnostic_setSortOrder` sí exige la fila del bucle literal, y ejecuta `setSortOrderByParent('investigationId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre, bajo `pg_advisory_xact_lock`. **No hay** `setUpdatedAt` —el bucle genérico lo borra explícitamente (`:1434`)—: `updatedAt` lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla **no** se añade a la lista de `:1507-1522`, así que un `DELETE` físico ejecuta y le corresponde `005C`. Es deliberado y sigue a las nueve hijas transaccionales.

**Hoja del grafo.** Ninguna de las 50 tablas la referenciará. Su `005C` no arrastra nada y no lleva volcado de cascada.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationDiagnostic.model.ts`. Clase `InvestigationDiagnostic`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationDiagnostic'`.

`diagnosticId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `investigationId` va `DataTypes.UUID` con `allowNull: false`. `diagnosticTermId` y `diagnosticTypeItemId` van `DataTypes.UUID` con `allowNull: true`. `diagnosticRaw` va `DataTypes.STRING(500)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres. `diagnosticDate` va `DataTypes.DATEONLY`, como `investigationStartDate` en `investigation.model.ts`. `notes` va `DataTypes.TEXT`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, por la razón que F16 §3.2 documentó: un `defaultValue: 0` haría que el `INSERT` mandara el `0` que el trigger interpreta como «asígnamelo tú», y funcionaría por accidente.

> **Nota de implementación, heredada de F16.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere con `notNull Violation: InvestigationDiagnostic.sortOrder cannot be null` y el trigger nunca se ejecuta. Lo que deja la columna fuera de la sentencia es la lista explícita: `InvestigationDiagnostic.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y **sin** `sortOrder` ni `diagnosticId`.

Asociaciones, en `src/models/associations/investigationDiagnostic.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationDiagnostic.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasMany(InvestigationDiagnostic, { as: 'diagnostics', foreignKey: 'investigationId' })`
- `InvestigationDiagnostic.belongsTo(DiagnosticTerm, { as: 'diagnosticTerm', foreignKey: 'diagnosticTermId' })`
- `InvestigationDiagnostic.belongsTo(CatalogItem, { as: 'diagnosticType', foreignKey: 'diagnosticTypeItemId' })`

El alias `diagnostics` no colisiona con ninguno de los que `investigation.associations.ts` ya declara para sus catorce satélites. El `hasMany` se declara porque lo necesita el volcado de §3.5. **No se incluye en ninguna respuesta de `investigation`**: el contrato de F28 no cambia. `DiagnosticTerm` y `CatalogItem` no ganan ningún inverso, igual que en F27, F33 y F57.

Alta en `src/models/index.ts` y en el barrel de asociaciones.

**Los tres `include` que el servicio compone:**

- **Visibilidad heredada**, en `002A`, `002B`, `003`, `004` y las filas del `006` — un solo salto: `{ model: Investigation, as: 'investigation', required: true, attributes: ['investigationId', 'isActive'], where: includeInactive ? {} : { isActive: true } }`. **Es la forma corriente de `INVTEAM` e `INVVACAD`**, no la cadena de dos saltos con `paranoid: false` que F33 necesitó: aquí el padre tiene `isActive` propio y el estado se lee de un tirón.
- **Término**, en `001`, `003`, `004` y las filas de los listados: `diagnosticTerm` con `attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']`, los seis exactos de F57.
- **Tipo**, en las mismas cuatro: `diagnosticType` con `attributes: ['catalogItemId', 'code', 'name', 'value']`.

### 3.3 Tipos

Ruta: `src/types/investigationDiagnostic/investigationDiagnostic.types.ts`, directorio nuevo con su `index.ts` de barrel, registrado en `src/types/index.ts`. Es la forma de `investigationVaccineAdministered` y `investigationPregnancyCondition`, que tienen carpeta propia; no la de `investigation`, que agrupa seis archivos en una.

```ts
export interface CreateInvestigationDiagnosticInput {
    investigationId: string;
    diagnosticName: string;
    diagnosticCode?: string | null;
    source?: TermSource | null;
    diagnosticDate?: string | null;
    diagnosticTypeItemId?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateInvestigationDiagnosticInput>`. **No se declara `UpdateInvestigationDiagnosticInput`** — prohibido por §4 de las convenciones.

**Tres claves de entrada no son columnas**, y es la consecuencia directa de resolver contra el maestro:

- **`diagnosticName`** es el texto del investigador. No hay columna con ese nombre: alimenta `diagnosticRaw`, que solo lo guarda si difiere del maestro.
- **`diagnosticCode`** y **`source`** alimentan la resolución y no se guardan en ninguna parte de esta tabla. El código vive en `diagnosticTerm`, que es donde F15 lo puso.

**Tres columnas no están en la interfaz.** `diagnosticTermId` y `diagnosticRaw` son derivadas —aceptarlas abriría la segunda puerta que F16 §6 cerró—; `sortOrder` es inmutable y lo asigna la base, y que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande.

`diagnosticDate` viaja como `string` en formato `YYYY-MM-DD`, que es lo que `DATEONLY` devuelve y lo que el validador comprueba. `TermSource` se importa de `src/constants/enums.constants.ts`, donde F15 lo dejó. **No se declara ningún enumerado nuevo.**

### 3.4 Superficie HTTP

Ruta base `/api/investigation-diagnostics`, registrada en `src/routes/index.ts`.

```
POST   /api/investigation-diagnostics                          ESAVI-INVDIAG-001   USER        (nuevo)
GET    /api/investigation-diagnostics/case/:caseId             ESAVI-INVDIAG-006   USER        (nuevo)
GET    /api/investigation-diagnostics/admin/investigation/:id  ESAVI-INVDIAG-002B  ADMIN       (nuevo)
GET    /api/investigation-diagnostics/investigation/:id        ESAVI-INVDIAG-002A  USER        (nuevo)
DELETE /api/investigation-diagnostics/purge/:id                ESAVI-INVDIAG-005C  SUPERADMIN  (nuevo)
PATCH  /api/investigation-diagnostics/activate/:id             ESAVI-INVDIAG-005B  ADMIN       (nuevo)
GET    /api/investigation-diagnostics/:id                      ESAVI-INVDIAG-003   USER        (nuevo)
PUT    /api/investigation-diagnostics/:id                      ESAVI-INVDIAG-004   USER        (nuevo)
DELETE /api/investigation-diagnostics/:id                      ESAVI-INVDIAG-005A  ADMIN       (nuevo)
```

**Nueve rutas, y `:id` es el `diagnosticId`** salvo en los dos listados, donde es el `investigationId`, y en el `006`, donde es el `caseId`. El `003` **no** es el acceso por investigación: para eso está el `002A`.

**Orden de declaración.** Las literales van **antes** de `/:id`, y `/admin/investigation/:id` antes que `/investigation/:id`, o Express capturaría `case`, `admin`, `investigation`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las nueve están escritas arriba en el orden exacto en que deben aparecer en `src/routes/investigationDiagnostic.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `INVTEAM`, `INVPREG` e `INVVACAD`, no la de `GEOTYPE`.

**Roles — la matriz de la familia de investigación, sin ninguna desviación.** `001`, `002A`, `003`, `004` y `006` en **USER**; `002B`, `005A` y `005B` en **ADMIN**; `005C` en **SUPERADMIN**.

Es la matriz literal de `investigationTeamMember.routes.ts:32-86`, y también la de `INVPREG` e `INVVACAD`. Frente a la canónica de §9 hay dos diferencias, y las dos son de la familia entera, no de este spec: el **`001` y el `004` en USER**, porque quien captura la investigación es quien registra y corrige sus diagnósticos; y el **`005B` en ADMIN** y no en SUPERADMIN, donde el bloque de notificación sí lo deja. **La reasignación de `sortOrder` del `005B` vive por tanto en ADMIN**, a diferencia de F57 — es la consecuencia directa de seguir a la familia, y está razonada en §6.

**`ESAVI-INVDIAG-006` sí tiene ruta**, como el `006` de `INVTEAM` e `INVVACAD`. Se registra en la tabla de operaciones no canónicas de §6 como: *«listar los diagnósticos finales de un caso — la cadena `caso → investigación` es uno a uno por `UQ_investigation_case`, pero de la investigación cuelgan N diagnósticos»*.

**La abreviatura es `INVDIAG`.** Siete letras, no colisiona con las cuarenta y nueve registradas, y `grep "ESAVI-INVDIAG-"` no se cruza con `ESAVI-DIAGTERM-`, `ESAVI-INVESTGN-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-` ni con ninguna de las otras diez `INV*`. Conserva el prefijo `INV` de las hermanas de la cadena, que es lo que la separa de `DIAGTERM` —el maestro clínico— sin ambigüedad de lectura.

Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`: de **345** a **354**.

### 3.5 Reglas de negocio por operación

#### La guarda del padre — compartida por `001`, `002A` y `002B`

`Investigation.findOne({ where: { investigationId }, attributes: ['investigationId', 'isActive'] })`. Falla con **404** y un único código por operación si no hay fila o si la fila tiene `isActive: false`. **Sin comprobar `statusItemId`**: el diagnóstico final se registra igual sobre una investigación en curso que sobre una cerrada, y sobre un paciente recuperado que sobre uno fallecido.

**En los dos listados la comprobación de estado la relaja `canViewInactive`**; la de existencia **no se relaja para nadie**: una investigación inexistente no tiene diagnósticos que listar bajo ningún rol.

**En el `001` no hay relajación de ninguna de las dos.** Una investigación inactiva no recibe diagnósticos nuevos, sea quien sea quien lo pida. Es el criterio de F31, F33 y F57 para su `001`.

**No se comprueba `investigationClinicalEvaluation`.** Ni que exista, ni su estado. Es la decisión `C` de §1.

#### Visibilidad heredada — compartida por `003`, `004` y las filas de los tres listados

Toda lectura de un diagnóstico incluye `investigation` con el `include` de §3.2. Responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`), si:

- su investigación tiene `isActive: false`, **o**
- el propio diagnóstico tiene `isActive: false`.

Las dos condiciones se evalúan igual y ninguna tiene prioridad: basta que una falle.

**El `005A`, el `005B` y el `005C` no la aplican.** Quien retira, reactiva o purga actúa sobre el estado propio de la fila, y ese estado existe con independencia de su padre. Es el criterio de F21, F31, F33 y F57.

#### La guarda del tipo — `001` y `004`

Solo corre cuando `diagnosticTypeItemId` llega con valor. `CatalogItem.findOne` con `include` de `catalogType`, y tres condiciones: el ítem existe, tiene `isActive: true`, y su `catalogType.code` es `DIAGNOSTIC_TYPE_CATALOG_CODE`. Si falla cualquiera → **400** `INVDIAG_<op>_INVALID_DIAGNOSTIC_TYPE`.

**El código del catálogo se lee de `src/constants/investigation.constants.ts` y nunca se escribe como literal en el servicio.** Es la regla que los criterios de aceptación de F28 verifican por `grep`, y solo funciona si hay un único sitio donde mirar.

**Sin valor por defecto.** `investigation.statusItemId` cae en `DEFAULT_INVESTIGATION_STATUS_VALUE` cuando falta; aquí no. Un diagnóstico sin tipo declarado se guarda con `diagnosticTypeItemId: null`, porque «presuntivo» y «no consta» no son lo mismo y el formulario actual no distingue.

**Un `null` explícito no pasa por la guarda**: es una anulación legítima, y el `004` la trata como cambio de valor.

#### Guarda de duplicado — `001` y `004`

`findOne` sobre el mismo `investigationId`, el mismo `diagnosticTermId` e `isActive: true`, excluyendo en el `004` la propia fila con `diagnosticId: { [Op.ne]: id }`. Si hay fila → **409** `INVDIAG_<op>_ALREADY_EXISTS`.

**Solo corre si el término resolvió.** Con `diagnosticTermId: null` no se comprueba nada: dos diagnósticos de texto libre son registros distintos aunque el texto coincida, y una guarda inventada no debe ser más rígida que las que la base sí impone —que aquí son ninguna.

**Es sobre el término solo, no sobre el par `(término, tipo)`.** El mismo término no puede figurar dos veces vivo en la misma investigación, ni siquiera como presuntivo y confirmado a la vez: cuando un diagnóstico presuntivo se confirma, lo que corresponde es un `004` sobre la fila que ya existe, no una fila nueva. Razonado en §6.

**Va después de la resolución**, porque el término que se compara es el resuelto, no el código enviado.

**Se compara contra activos, no contra todos.** Un diagnóstico retirado no bloquea volver a cargar el mismo término: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`. La consecuencia —que un `005B` pueda dejar dos filas activas con el mismo término— está declarada en §6.

#### Por operación

**`ESAVI-INVDIAG-001` — crear.** Todo dentro de **una transacción**, porque la resolución del término puede escribir en `diagnosticTerm`. En este orden:

1. **La guarda del padre** → 404 `INVDIAG_001_INVESTIGATION_NOT_FOUND`.
2. **La guarda del tipo**, si `diagnosticTypeItemId` llegó → 400 `INVDIAG_001_INVALID_DIAGNOSTIC_TYPE`.
3. **Resolución del término**, en tres ramas:
   - Sin `diagnosticCode` → `diagnosticTermId: null` y `diagnosticRaw: normalizeText(data.diagnosticName)`.
   - Con `diagnosticCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService({ code, name: data.diagnosticName, operationCode: 'ESAVI-INVDIAG-001' }, authUser, lang, transaction)`, que **devuelve el término o lo crea**.
   - Con `diagnosticCode` y `source` distinto de `'LOCAL'` → `DiagnosticTerm.findOne({ where: { source, code: toConstantCase(code.trim()) } })`, **sin crear nada**; si no existe → 404 `INVDIAG_001_DIAGTERM_NOT_FOUND`. La consulta no filtra por `isActive`: un término retirado sigue siendo referenciable, por la misma razón que `diagnosticTermResolution.service.ts:37-38` no lo filtra.
4. Con término resuelto: `diagnosticTermId` = el suyo, y `diagnosticRaw` = el texto del investigador **solo si difiere** del nombre del maestro; si coincide, `null`.
5. **Guarda de duplicado**, solo si `diagnosticTermId` quedó con valor → 409 `INVDIAG_001_ALREADY_EXISTS`.
6. Normalización: `normalizeText` sobre `diagnosticName` y `notes`. **Ningún `toTitleCase` ni `toConstantCase`** — el del código lo aplica `resolveDiagnosticTermService`.
7. `create` con `fields: CREATE_FIELDS`, **sin `sortOrder`**, para que lo asigne el trigger.
8. Entrada de auditoría en `appDetails` con `method: 'ESAVI-INVDIAG-001'`.

**Nada se escribe en `investigationClinicalEvaluation`, en `finalClassification` ni en `caseWorkflow` en ningún paso.**

**`ESAVI-INVDIAG-002A` — listar activos por investigación.** Guarda del padre, relajada por `canViewInactive` en el estado → 404 `INVDIAG_002A_INVESTIGATION_NOT_FOUND`. `findAndCountAll` con `where: { investigationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, `include` de `diagnosticTerm` y `diagnosticType`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query. **Una investigación sin diagnósticos devuelve 200 con `{ count: 0, rows: [] }`; una investigación que no existe devuelve 404.**

**`ESAVI-INVDIAG-002B` — listar todos por investigación.** Idéntico, sin el filtro `isActive` y con `paranoid: false`. Rol ADMIN.

**`ESAVI-INVDIAG-003` — obtener por ID.** Existencia → 404 `INVDIAG_003_NOT_FOUND`, con la visibilidad heredada aplicada.

**`ESAVI-INVDIAG-006` — listar los diagnósticos de un caso.** El caso existe y está activo → 404 `INVDIAG_006_CASE_NOT_FOUND`. Su investigación existe y está activa → 404 `INVDIAG_006_INVESTIGATION_NOT_FOUND`. A partir de ahí es el `002A`: solo activos, ordenados por `sortOrder`, paginados. La variante admin no se declara. Es la forma literal de `INVTEAM-006`.

**`ESAVI-INVDIAG-004` — actualizar.** Existencia → 404 `INVDIAG_004_NOT_FOUND`, incluida la visibilidad heredada. Todo en **una transacción**, porque la re-resolución puede escribir en `diagnosticTerm`. `stored` sale de `diagnostic.get({ plain: true })` — la fila completa, sin `attributes` acotados.

La **re-resolución está condicionada al cambio de valor**, no a la presencia de la clave (SPEC F12). Se calcula `incomingName = data.diagnosticName !== undefined ? normalizeText(data.diagnosticName) : (stored.diagnosticRaw ?? stored.diagnosticTerm?.name)` y se re-resuelve **solo si** llega `diagnosticCode` o `source` con un valor distinto del que produjo el término guardado, o si `diagnosticName` cambió sobre una fila con término resuelto. Si nada de eso cambia, **no se consulta ni se escribe en `diagnosticTerm`**: reenviar íntegra la respuesta del `GET` no toca el maestro.

Guarda del tipo si `diagnosticTypeItemId` llega con valor; guarda de duplicado sobre el término resultante, excluyendo la propia fila. Después, `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `diagnosticId` | **no entra** | PK |
| `diagnosticTermId` | `resolved.diagnosticTermId` — **entra siempre** | **derivado**: lo produce la resolución, no el cliente. Cuando no hubo re-resolución vale lo mismo que `stored` y el helper lo descarta solo |
| `diagnosticRaw` | `resolved.diagnosticRaw` — **entra siempre** | **derivado**: el texto entrante solo si difiere del nombre del maestro, si no `null`. Anulable, y el `null` es un valor legítimo, no una ausencia |
| `diagnosticDate` | `data.diagnosticDate !== undefined ? (data.diagnosticDate ?? null) : undefined` | anulable: se compara contra `undefined`, **nunca por veracidad**. La comparación es sobre la cadena `YYYY-MM-DD` que devuelve `DATEONLY`, no sobre un `Date` |
| `diagnosticTypeItemId` | `data.diagnosticTypeItemId !== undefined ? (data.diagnosticTypeItemId ?? null) : undefined` | anulable: se compara contra `undefined`, **nunca por veracidad** |
| `notes` | `data.notes !== undefined ? (data.notes?.trim() ?? null) : undefined` | anulable: se compara contra `undefined`, **nunca por veracidad** |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**`diagnosticName`, `diagnosticCode` y `source` no aparecen en la tabla porque no son columnas.** Los tres alimentan la resolución y desembocan en los dos derivados. Es la razón de que los derivados entren **siempre**: su valor no sale de comparar una clave del body contra lo guardado, sino de recalcular con lo que hubiera. El helper hace el resto — si el resultado coincide con `stored`, no hay escritura.

**`diagnosticName` no es anulable en el `004`.** Un `null` explícito lo rechaza el validador con 400: un diagnóstico sin nombre no informa de nada.

**`diagnosticDate` sí es anulable**, y un `null` explícito la borra. La guarda de fecha no futura corre solo cuando llega un valor.

**`ESAVI-INVDIAG-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'INVDIAG_005A_NOT_FOUND'`, `alreadyInStateCode: 'INVDIAG_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-INVDIAG-005A'`. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial. Es correcto y deliberado. **No comprueba el estado de la investigación.**

**`ESAVI-INVDIAG-005B` — reactivar.** **La única operación de este spec que no es una delegación limpia**, por el hallazgo `D` de §1. En transacción propia:

1. `InvestigationDiagnostic.findOne({ where: { diagnosticId: id }, paranoid: false, transaction })`. Si no hay fila, se pasa directo al paso 4 y el helper levanta el 404.
2. Si la fila existe y está inactiva, se busca colisión: otra fila de la **misma** investigación, con el **mismo** `sortOrder`, con `deletedAt: null` y `diagnosticId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa investigación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que esta escritura es libre. El diagnóstico reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'INVDIAG_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-INVDIAG-005B'`, que limpia `deletedAt` con el `sortOrder` ya corregido.

El orden de los pasos 3 y 4 es la clave entera: invertirlos hace fallar el índice en el propio `UPDATE` del helper, porque no es una restricción diferible. **La reactivación no revalida la guarda de duplicado, ni la del tipo, ni el estado del padre**: el dato es histórico y `005B` no escribe esas columnas.

**`ESAVI-INVDIAG-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'INVDIAG_005C_NOT_FOUND'` y `stillActiveCode: 'INVDIAG_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la investigación.** El `diagnosticTerm` y el `catalogItem` que citaba sobreviven. Sin entrada en `appDetails` —la fila se destruye en la misma transacción— y con el volcado a `warn` que el helper ya escribe.

#### El volcado en un servicio ajeno

`investigation.service.ts` gana `dumpInvestigationDiagnosticsBeforeCascade(investigationId, userId, transaction)`, la **décima** función de volcado de `ESAVI-INVESTGN-005C`, calcada de la de `investigationTeamMember` (`investigation.service.ts:855-870`): `findAll` con `attributes: ['diagnosticId']` y `paranoid: false`, retorno silencioso si no hay filas, una línea `warn` con el conteo y los ids, y `try/catch` que nunca aborta la purga. Se invoca junto a las otras nueve, antes de `purgeEntityService`.

**Es un rastro, no una protección: la purga no se bloquea y la cascada dispara igual.** Es la línea de F16, F21, F22 y F31.

#### Escrituras que no son diferenciales, declaradas una a una

- **El `001`** — es un `create`.
- **La creación de un término en `diagnosticTerm` por la rama `LOCAL`**, en `001` y `004`. Escritura sobre otra tabla, con intención propia: registra que este código no existía en el maestro. En el `004` **solo ocurre si el código cambió realmente**, nunca por presencia de la clave.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: este diagnóstico vuelve a estar vivo y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005C`** — destruye la fila.

**Este spec no escribe en ninguna otra tabla.** Lo único que toca fuera de `investigationDiagnostic` y de `diagnosticTerm` es una línea de log en la cascada de purga de la cabecera. **`investigation`, `investigationClinicalEvaluation`, `finalClassification` y `caseWorkflow` no se escriben nunca**, ni por cambio de valor ni por presencia de clave.

### 3.6 Claves i18n nuevas

Bajo `investigationDiagnostic`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `investigationDiagnostic.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente o no visible |
| `investigationDiagnostic.idRequired` | 400 del validador de `:id` |
| `investigationDiagnostic.investigationNotFound` | 404 cuando la investigación no existe o está inactiva |
| `investigationDiagnostic.caseNotFound` | 404 del `006` cuando el caso no existe o está inactivo |
| `investigationDiagnostic.diagnosticTermNotFound` | 404 con `source` externo y par `(source, code)` inexistente |
| `investigationDiagnostic.invalidDiagnosticType` | 400 cuando `diagnosticTypeItemId` no existe, está inactivo o no pertenece a `diagnosticType` |
| `investigationDiagnostic.alreadyExists` | 409 cuando la investigación ya tiene un diagnóstico **activo** con el mismo término |
| `investigationDiagnostic.nameRequired` | 400 del validador cuando `diagnosticName` no llega en el `001`, o llega como `null` en el `004` |
| `investigationDiagnostic.futureDate` | 400 del validador cuando `diagnosticDate` es posterior a hoy |
| `investigationDiagnostic.stillActive` | 409 al purgar un diagnóstico que no fue retirado antes |
| `.createdSuccess` / `.createdFailed` | 201 y 500 del `001` |
| `.getSuccess` / `.getFailed` | 200 y 500 de `002A`, `002B`, `003` y `006` |
| `.updatedSuccess` / `.updatedFailed` | 200 y 500 del `004` |
| `.deletedSuccess` / `.deletedFailed` | 200 y 500 del `005A` |
| `.activatedSuccess` / `.activatedFailed` | 200 y 500 del `005B` |
| `.alreadyActive` / `.alreadyInactive` | 409 de `005B` y `005A` |
| `.purgeSuccess` / `.purgeFailed` | 200 y 500 del `005C` |

**`futureDate` sí lleva clave propia** aunque la levante el validador: el mensaje genérico de `common.validationError` no dice cuál de los campos falló, y la fecha es el único de este spec con una regla semántica y no de forma.

**El resto de validaciones de forma no generan clave propia.** El máximo de 500 caracteres de `diagnosticName`, el formato UUID de `investigationId` y `diagnosticTypeItemId`, el formato `YYYY-MM-DD` de `diagnosticDate` y el enumerado de `source` los responde `validateFields` con `common.validationError`.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `001`, `003` y `004`:

```
{ ok, message, data: {
    diagnosticId, investigationId, diagnosticTermId,
    diagnosticRaw, diagnosticDate, diagnosticTypeItemId, sortOrder, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    diagnosticTerm: { diagnosticTermId, source, code, name, termGroup, isActive } | null,
    diagnosticType: { catalogItemId, code, name, value } | null
} }
```

`diagnosticTerm` se incluye siempre que exista la FK, con esos seis campos y **sin `metadata`**: lleva los marcadores internos de la resolución implícita —`autoCreated`, `reviewStatus`—, que son gobernanza del catálogo y no dato de la investigación. Es la decisión de F16, F27, F33 y F57, literal.

`diagnosticType` se incluye con cuatro campos y **sin `sortOrder` ni `isActive`**: el orden del catálogo es cosa de quien pinta el desplegable, y para eso está `ESAVI-CATITEM-002A`.

**El nombre que el cliente muestra es `diagnosticRaw ?? diagnosticTerm.name`.** No hay un tercer campo que lo resuelva. Cuando `diagnosticRaw` es `null`, el investigador escribió exactamente lo que dice el maestro.

`diagnosticDate` viaja como `YYYY-MM-DD`, sin hora ni zona, que es lo que `DATEONLY` devuelve.

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente.

**Nada de la investigación ni del caso viaja en la respuesta.** `investigation` se consulta solo para la visibilidad heredada, con `attributes` acotados, y se descarta al construir el payload.

`sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `investigationDiagnostic | INVDIAG` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en el orden alfabético que la tabla mantiene —entre `investigationCommunity` y `investigationMedicalHistory`—, y la fila del `006` a la tabla de operaciones no canónicas, a continuación de la de `investigationVaccineAdministered`. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla contiene la fila nueva; `INVDIAG` no aparece dos veces y no colisiona con `DIAGTERM`, `INVESTGN`, `INVMEDH`, `INVPREG` ni con ninguna otra `INV*`; `git diff references/CONVENTIONS.md` muestra **exactamente dos** filas añadidas y ningún otro cambio.

2. **La tabla en `esaviapp.sql`.** El `CREATE TABLE` de §3.1 con su `IX_investigationDiagnostic_investigation`, insertado tras `investigationCommunity` (`:1355`) y antes de `finalClassification` (`:1357`); la fila `('investigationDiagnostic', 'investigationId'),` en el bucle `setSortOrderByParent` tras `:1455`; y el índice único parcial `UQ_investigationDiagnostic_parent_sortOrder` junto a los diez de `:1473-1505`. **La lista de `preventPhysicalDelete` no se toca.**
   *Verificación:* ejecutar el DDL completo sobre una base limpia no produce errores; `\d "investigationDiagnostic"` muestra las catorce columnas, las tres FKs y el `CHECK`; `SELECT tgname FROM pg_trigger WHERE tgrelid = '"investigationDiagnostic"'::regclass` devuelve **exactamente dos** triggers —`setSysDetails` y `setSortOrder`— y **ninguno** de `setUpdatedAt` ni `preventPhysicalDelete`; `git diff esaviapp.sql` toca solo las tres zonas descritas más la del paso 3, y ninguna otra tabla; un `DELETE` físico directo sobre una fila ejecuta sin error.

3. **La siembra del catálogo y su constante.** Los tres `CALL "upsertCatalogItem"` de §3.1 tras `evaluationInstitutionType` (`:1787`), y `DIAGNOSTIC_TYPE_CATALOG_CODE = 'diagnosticType'` en `src/constants/investigation.constants.ts`, junto a las tres que ya viven ahí y con su comentario de dos líneas explicando que el DDL sí la siembra —a diferencia de `VACCINATION_SITE_CATALOG_CODE`.
   *Verificación:* tras cargar el DDL, `SELECT ci."code", ci."value", ci."sortOrder" FROM "catalogItem" ci JOIN "catalogType" ct USING ("catalogTypeId") WHERE ct."code" = 'diagnosticType' ORDER BY ci."sortOrder"` devuelve **exactamente tres** filas, `PRESUMPTIVE` / `CONFIRMED` / `DIFFERENTIAL`, con `code` igual a `value`; ejecutar el DDL dos veces seguidas **no** duplica ninguna; `grep -rn "'diagnosticType'" src/` devuelve **una sola** línea, la de la constante.

4. **La cuenta de tablas en `CLAUDE.md`.** Dejarla en **50** en la sección *Database schema*, y la de modelos en **47**.
   *Verificación:* la cifra coincide con `grep -c "^CREATE TABLE IF NOT EXISTS" esaviapp.sql`; la lista de tablas sin modelo que la línea enumera sigue siendo correcta.

5. **Modelo y asociaciones.** `src/models/investigationDiagnostic.model.ts` con los ocho atributos de datos y las seis transversales, `sortOrder` **sin `defaultValue`**, `diagnosticRaw` en `STRING(500)` y `diagnosticDate` en `DATEONLY`. `src/models/associations/investigationDiagnostic.associations.ts` con los cuatro vínculos de §3.2. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` compila; `InvestigationDiagnostic.findAll({ include: ['investigation', 'diagnosticTerm', 'diagnosticType'] })` no lanza `EagerLoadingError`; el alias `diagnostics` del `hasMany` no colisiona con ninguno de los que `investigation.associations.ts` ya declara para sus catorce satélites; el modelo **no** declara `defaultValue` en `sortOrder`.

6. **Tipos y validadores.** `src/types/investigationDiagnostic/investigationDiagnostic.types.ts` con la única interfaz de §3.3, más su `index.ts` de barrel, registrado en `src/types/index.ts`. `src/validators/investigationDiagnostic.validators.ts` con los seis validadores —create, list por investigación, list por caso, id, update, activate—, registrado en el barrel.
   *Verificación:* `npm run build` compila; **no existe** ningún `UpdateInvestigationDiagnosticInput`; un `POST` sin `diagnosticName` responde 400 `common.validationError`; un `PUT` con `diagnosticName: null` responde 400; un `diagnosticName` de 501 caracteres responde 400; un `source` fuera del enumerado responde 400; una `diagnosticDate` de mañana responde 400 `investigationDiagnostic.futureDate`; una `diagnosticDate` de hoy responde 201; un `diagnosticTypeItemId` que no es UUID responde 400; un `:id` que no es UUID responde 400.

7. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` pasa; `npx jest tests/i18n` pasa; ninguna clave existe en dos de los tres archivos.

8. **`ESAVI-INVDIAG-001`.** Servicio, controlador y ruta. Transacción, guarda del padre, guarda del tipo, las tres ramas de resolución, los dos derivados, la guarda de duplicado, `fields: CREATE_FIELDS` y la entrada de auditoría.
   *Verificación:* un alta con solo `investigationId` y `diagnosticName` devuelve **201** con `diagnosticTermId: null`, `diagnosticRaw` con el texto, `diagnosticDate: null`, `diagnosticTypeItemId: null` y `sortOrder: 1` sobre una investigación vacía; la segunda alta recibe `sortOrder: 2`; con `diagnosticCode` nuevo y sin `source` se crea la fila en `diagnosticTerm` y `diagnosticRaw` queda `null` si el nombre coincide con el del maestro; con `source: 'MEDDRA'` y un código inexistente responde 404 `INVDIAG_001_DIAGTERM_NOT_FOUND` **y no se crea ningún término**; con un `diagnosticTypeItemId` de otro `catalogType`, o inactivo, o inexistente, responde 400 `INVDIAG_001_INVALID_DIAGNOSTIC_TYPE`; sobre una investigación inexistente o inactiva responde 404 `INVDIAG_001_INVESTIGATION_NOT_FOUND`, **también como SUPERADMIN**; sobre una investigación **sin** `investigationClinicalEvaluation` responde **201**; repetir el mismo término activo responde 409 `INVDIAG_001_ALREADY_EXISTS`; repetir el mismo texto **sin** código responde 201; `appDetails` tiene una entrada con `method: 'ESAVI-INVDIAG-001'`; el `INSERT` emitido **no contiene la columna `sortOrder`**.

9. **`ESAVI-INVDIAG-002A` y `002B`.** Los dos listados por `investigationId`, con la guarda del padre, `findAndCountAll`, orden por `sortOrder` y paginación.
   *Verificación:* el `002A` devuelve solo activos y el `002B` también los inactivos y los de `deletedAt` sellado; los dos devuelven `{ count, rows }` ordenados por `sortOrder` ascendente; una investigación sin diagnósticos devuelve **200** con `{ count: 0, rows: [] }`; una investigación inexistente devuelve **404**, también como SUPERADMIN; una investigación inactiva devuelve 404 para USER y ADMIN y **200** para SUPERADMIN; el `002B` con rol USER responde 403; `?limit=1&offset=1` devuelve la segunda fila con el `count` total; ningún parámetro de query distinto de `limit`, `offset` y `lang` altera el resultado — en particular `?diagnosticTypeItemId=` se ignora.

10. **`ESAVI-INVDIAG-003`.** Obtener por `diagnosticId` con la visibilidad heredada de un salto.
    *Verificación:* devuelve la forma de §3.7 con `diagnosticTerm` y `diagnosticType` anidados o `null`; un diagnóstico inactivo responde 404 para USER y 200 para SUPERADMIN; un diagnóstico activo cuya investigación está inactiva responde 404 para USER y ADMIN y 200 para SUPERADMIN; `diagnosticDate` viaja como `YYYY-MM-DD` sin hora; `sysDetails` no aparece en el payload; `diagnosticTerm.metadata` no aparece en el payload.

11. **`ESAVI-INVDIAG-006`.** Listado por `caseId`, con las dos guardas delante y el cuerpo del `002A`.
    *Verificación:* devuelve `{ count, rows }` con los diagnósticos activos del caso ordenados por `sortOrder`; un `caseId` inexistente o inactivo responde 404 `INVDIAG_006_CASE_NOT_FOUND`; un caso activo **sin investigación** responde 404 `INVDIAG_006_INVESTIGATION_NOT_FOUND`; un caso con investigación y sin diagnósticos responde 200 con `{ count: 0, rows: [] }`; **no** devuelve diagnósticos inactivos ni siquiera como SUPERADMIN —para eso está el `002B`—; el rol mínimo es USER.

12. **`ESAVI-INVDIAG-004`.** Transacción, `stored` completo, la fórmula de `incomingName`, la re-resolución condicionada, la guarda del tipo, la guarda de duplicado y `buildDifferentialUpdate` con la tabla de `candidates`.
    *Verificación:* la del bloque de update diferencial de §5, entera.

13. **`ESAVI-INVDIAG-005A`.** Delegación en `setEntityActiveStatusService`.
    *Verificación:* sella `isActive: false` y `deletedAt`; repetir responde 409 `INVDIAG_005A_ALREADY_INACTIVE`; **no comprueba el estado de la investigación** —retirar un diagnóstico de una investigación inactiva devuelve 200—; tras el `005A`, un alta nueva sobre la misma investigación puede recibir el `sortOrder` liberado; `appDetails` crece con `method: 'ESAVI-INVDIAG-005A'`; el rol mínimo es ADMIN y un USER recibe 403.

14. **`ESAVI-INVDIAG-005B`.** Transacción, detección de colisión de `sortOrder`, reasignación previa y delegación.
    *Verificación:* con dos diagnósticos en `sortOrder` 1 y 2, retirar el **2**, crear uno nuevo —que recibe `MAX(1) + 1 = 2` y colisiona con el retirado— y reactivar el retirado devuelve **200** y lo deja en **`3`**, sin violar el índice único parcial; sin colisión conserva su número original; reactivar una fila ya activa responde 409 `INVDIAG_005B_ALREADY_ACTIVE`; la reactivación **no** revalida la guarda de duplicado, ni la del tipo, ni el estado del padre; el rol mínimo es **ADMIN** —no SUPERADMIN— y un USER recibe 403.

15. **`ESAVI-INVDIAG-005C`.** `purgeEntityService` sin modificarlo.
    *Verificación:* purgar un diagnóstico activo responde 409 `INVDIAG_005C_STILL_ACTIVE`; purgar uno retirado lo destruye y un `003` posterior responde 404; el `diagnosticTerm` y el `catalogItem` que citaba **siguen existiendo**; el rol mínimo es SUPERADMIN; `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` y `diagnosticTermResolution.service.ts` no aparecen en `git diff`.

16. **El volcado de `ESAVI-INVESTGN-005C`.** Añadir `dumpInvestigationDiagnosticsBeforeCascade` a `src/services/investigation.service.ts`, con la forma de la de `investigationTeamMember` (`:855-870`), e invocarla junto a las otras nueve dentro de `purgeInvestigationService`.
    *Verificación:* purgar una investigación con tres diagnósticos —uno de ellos retirado— escribe **una** línea `warn` con `3` y los tres `diagnosticId`; con cero diagnósticos **no escribe ninguna línea**; la purga **no se bloquea** en ningún caso y un fallo dentro del volcado no la aborta; `git diff src/services/investigation.service.ts` toca únicamente la función nueva y su invocación, **sin rozar** las nueve anteriores ni el bloque de cascada de satélites.

17. **Rutas y registro.** `src/routes/investigationDiagnostic.routes.ts` con las nueve en el orden de §3.4, montado en `src/routes/index.ts` bajo `/api/investigation-diagnostics`.
    *Verificación:* `GET /case/<uuid>` alcanza el `006` y no el `003`; `GET /admin/investigation/<uuid>` alcanza el `002B` y no el `002A`; `PATCH /activate/<uuid>` alcanza el `005B`; `DELETE /purge/<uuid>` alcanza el `005C`; ninguna literal cae en el validador de UUID del `:id`; el comentario `// Code: ESAVI-INVDIAG-<NNN>` está en la ruta, el controlador y el servicio, y coincide con el `AppError` y con `appDetails.method` en los cinco lugares.

18. **Pruebas.** Nueve filas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de 345 a 354— y `tests/contract/investigationDiagnostic.test.ts` con el recorrido completo, siguiendo a `tests/contract/investigationTeamMember.test.ts`.
    *Verificación:* `npm run check` pasa entero —build, lint, `i18n:check` y jest—; la suite de roles cuenta las nueve rutas nuevas y ninguna queda sin regla; la de contrato cubre el alta, los dos listados por investigación, el `006`, el `003`, los cinco escenarios de update diferencial de §5, la guarda del tipo, la de fecha futura, el `005A`, el `005B` con colisión de `sortOrder`, el `005C` y el volcado.

---

## 5. Criterios de aceptación

**Del DDL y de la siembra:**

1. Ejecutar `esaviapp.sql` sobre una base limpia crea `investigationDiagnostic` con catorce columnas, tres FKs y un `CHECK`, y **no altera ninguna otra tabla**.
2. `SELECT tgname FROM pg_trigger WHERE tgrelid = '"investigationDiagnostic"'::regclass AND NOT tgisinternal` devuelve **exactamente dos** filas: `TRG_investigationDiagnostic_setSysDetails` y `TRG_investigationDiagnostic_setSortOrder`. **No existe** `setUpdatedAt` ni `preventPhysicalDelete`.
3. Un `DELETE` físico directo sobre una fila **ejecuta**, y purgar la investigación padre destruye sus diagnósticos por `ON DELETE CASCADE`.
4. El `catalogType` `diagnosticType` existe con **exactamente tres** ítems —`PRESUMPTIVE`, `CONFIRMED`, `DIFFERENTIAL`—, con `code` igual a `value` y `sortOrder` 1 a 3. **Cargar el DDL dos veces no duplica ninguno**: `upsertCatalogItem` es idempotente.
5. `grep -rn "'diagnosticType'" src/` devuelve **una sola** línea: la de `DIAGNOSTIC_TYPE_CATALOG_CODE`. El literal no aparece en ningún servicio, controlador, validador ni test.
6. `CLAUDE.md` dice 50 tablas y la cifra coincide con `grep -c "^CREATE TABLE IF NOT EXISTS" esaviapp.sql`. La cuenta de modelos dice 47 y las tres tablas sin modelo siguen siendo `appPermission`, `appRolePermission` e `investigationCovidHistory`.

**Del alta (`001`):**

7. `POST` con `investigationId` y `diagnosticName` sobre una investigación vacía y visible → **201**, `diagnosticTermId: null`, `diagnosticRaw` con el texto, `diagnosticDate: null`, `diagnosticTypeItemId: null`, `notes: null`, `sortOrder: 1`, `isActive: true`. La segunda alta recibe `sortOrder: 2`.
8. El `INSERT` emitido **no contiene la columna `sortOrder`**. Verificable con `logging` de Sequelize en la suite.
9. `POST` con `diagnosticCode` inédito y sin `source` → 201, se crea la fila en `diagnosticTerm` con `source: 'LOCAL'`, y `diagnosticRaw` queda **`null`** si `diagnosticName` coincide con el nombre del maestro, o con el texto si difiere.
10. `POST` con `source: 'MEDDRA'` y un código que no existe → **404** `INVDIAG_001_DIAGTERM_NOT_FOUND`, y `SELECT count(*) FROM "diagnosticTerm"` no ha cambiado.
11. `POST` con `diagnosticTypeItemId` **inexistente**, **inactivo**, o de **otro `catalogType`** → **400** `INVDIAG_001_INVALID_DIAGNOSTIC_TYPE` en los tres casos. Con el ítem `CONFIRMED` de `diagnosticType` → **201**. Sin la clave → **201** con `diagnosticTypeItemId: null`, y **no se sustituye por ningún ítem por defecto**.
12. `POST` con `diagnosticDate` de mañana → **400** `investigationDiagnostic.futureDate`. Con la fecha de hoy o anterior → **201**. **Sin cruzarla con `investigation.investigationStartDate`**: una fecha anterior al inicio de la investigación devuelve **201**.
13. `POST` sobre una investigación **inexistente** o **inactiva** → **404** `INVDIAG_001_INVESTIGATION_NOT_FOUND` en los dos casos, con el mismo mensaje, **también con token SUPERADMIN**.
14. `POST` sobre una investigación **sin `investigationClinicalEvaluation`** → **201**. La existencia del bloque clínico no se comprueba en ninguna operación.
15. `POST` de un término que ya tiene un diagnóstico **activo** en esa investigación → **409** `INVDIAG_001_ALREADY_EXISTS`, **también si el `diagnosticTypeItemId` es distinto**. Si el que lo tiene está **inactivo** → **201**.
16. `POST` del mismo texto dos veces **sin `diagnosticCode`** → **201** las dos, y quedan dos filas.
17. `investigation.statusItemId` no altera ningún resultado: el alta se comporta igual sobre una investigación en curso que sobre una con el paciente fallecido.

**De los listados (`002A`, `002B`, `006`):**

18. El `002A` devuelve solo `isActive: true`; el `002B` devuelve también los inactivos y los de `deletedAt` sellado. Los dos, `{ count, rows }` ordenados por `sortOrder` ascendente.
19. Una investigación visible sin diagnósticos → **200** con `{ count: 0, rows: [] }`. Un `investigationId` inexistente → **404**, con cualquier rol.
20. Una investigación inactiva → **404** para USER y ADMIN, **200** para SUPERADMIN. El `002B` con rol USER → **403**.
21. `?limit=1&offset=1` devuelve la segunda fila y el `count` total, no `1`. **`?diagnosticTypeItemId=` no altera el resultado**: el filtro no existe.
22. El `006` sobre un caso activo con investigación devuelve los diagnósticos **activos** ordenados por `sortOrder`. Un `caseId` inexistente o inactivo → **404** `INVDIAG_006_CASE_NOT_FOUND`; un caso activo sin investigación → **404** `INVDIAG_006_INVESTIGATION_NOT_FOUND`; un caso con investigación y sin diagnósticos → **200** con `{ count: 0, rows: [] }`.
23. El `006` **no** devuelve diagnósticos inactivos ni siquiera con token SUPERADMIN. La variante admin no existe y se entra por el `002B`.

**De la lectura (`003`):**

24. Devuelve la forma exacta de §3.7. `diagnosticTerm` con **seis** campos y **sin `metadata`**; `diagnosticType` con **cuatro** campos y sin `sortOrder` ni `isActive`; `sysDetails` no aparece.
25. `diagnosticDate` viaja como `YYYY-MM-DD`, sin hora ni desplazamiento de zona. Guardar `2026-03-01` y leerlo devuelve `2026-03-01` con `TZ=UTC` y con `TZ=America/Guayaquil`.
26. Los dos motivos de invisibilidad —diagnóstico inactivo, investigación inactiva— responden **404** para USER y ADMIN y **200** para SUPERADMIN, cada uno por separado y combinados.

**Del update diferencial (`004`) — el bloque de SPEC F12, entero:**

27. **Un `PUT` con el body idéntico a lo guardado no escribe nada.** Ni `UPDATE`, ni `updatedAt`, ni entrada nueva en `appDetails`, ni evento en `sysDetails`. Verificable comparando `updatedAt` y `jsonb_array_length("appDetails")` antes y después: los dos idénticos.
28. **Reenviar íntegra la respuesta del `GET` no escribe nada**, incluida una fila con `diagnosticRaw` divergente del nombre del maestro y con `diagnosticDate` y `diagnosticTypeItemId` poblados. Es la trampa que la fórmula de `incomingName` cubre: el nombre efectivo que el `GET` mostró vuelve como una clave ausente, no como una reescritura.
29. **Un `PUT` que cambia un solo campo escribe ese campo y nada más.** `appDetails` crece en **exactamente una** entrada, con `method: 'ESAVI-INVDIAG-004'`, y el historial anterior se conserva íntegro.
30. **La escritura la dispara el cambio de valor, no la presencia de la clave.** Un `PUT` con `diagnosticCode` igual al que produjo el término guardado **no consulta ni escribe `diagnosticTerm`** —`SELECT count(*)` sobre el maestro no cambia y `updatedAt` del diagnóstico tampoco—. Un `diagnosticCode` distinto sí re-dispara la resolución.
31. **Un `diagnosticTypeItemId` idéntico al guardado no pasa por la guarda del tipo ni escribe.** Uno distinto sí la ejecuta, y si es inválido → **400** `INVDIAG_004_INVALID_DIAGNOSTIC_TYPE` **sin haber escrito nada**.
32. **Los campos inmutables se ignoran en silencio.** Un `PUT` con `investigationId` de otra investigación o con `sortOrder: 99` devuelve **200**, no 400, y ninguno de los dos cambia en la base.
33. Los tres anulables se comparan contra `undefined` y **nunca por veracidad**: `notes: null`, `diagnosticDate: null` y `diagnosticTypeItemId: null` explícitos borran el valor y **sí** cuentan como diferencia; ausentes lo dejan como estaba. `diagnosticName: null` es **400** del validador y nunca llega al servicio.
34. Cuando el diff vuelve vacío, la respuesta es **200** con la fila tal cual, no 304 ni 204.
35. Un `PUT` que resuelve a un término que ya tiene otro diagnóstico activo en esa investigación → **409** `INVDIAG_004_ALREADY_EXISTS`, y la propia fila queda excluida de la comprobación.
36. **Ningún `PUT` escribe en `investigation`, `investigationClinicalEvaluation`, `finalClassification` ni `caseWorkflow`**, cambie lo que cambie. El `updatedAt` de las cuatro es idéntico antes y después.

**De la activación (`005A`, `005B`):**

37. `005A` sella `isActive: false` y `deletedAt`, **sin comprobar el estado de la investigación**: retirar un diagnóstico de una investigación inactiva devuelve **200**. Repetir → 409 `INVDIAG_005A_ALREADY_INACTIVE`.
38. Retirar el **último** diagnóstico activo de una investigación **no toca ninguna otra tabla**.
39. **El escenario de colisión de `sortOrder`, entero:** con dos diagnósticos en `1` y `2`, retirar el **`2`**, crear uno nuevo —que recibe `MAX(1) + 1 = 2`— y reactivar el retirado → **200**, y el reactivado queda en **`3`**. El índice único parcial no se viola y ninguna de las tres filas comparte número.
40. Sin colisión, el `005B` conserva el `sortOrder` original. Reactivar una fila ya activa → 409 `INVDIAG_005B_ALREADY_ACTIVE`. El rol mínimo es **ADMIN** —la familia de investigación, no SUPERADMIN—; un USER recibe 403.
41. El `005B` **no** revalida la guarda de duplicado ni la del tipo: reactivar puede dejar dos diagnósticos activos con el mismo término, y puede devolver a la vida una fila que apunta a un `catalogItem` desde entonces desactivado. Son consecuencias asumidas y declaradas en §6 y §7.

**De la purga (`005C`) y del volcado:**

42. Purgar un diagnóstico **activo** → **409** `INVDIAG_005C_STILL_ACTIVE`. Purgar uno retirado lo destruye, y un `003` posterior → 404. El `diagnosticTerm` y el `catalogItem` que citaba **siguen existiendo**.
43. `ESAVI-INVESTGN-005C` sobre una investigación con tres diagnósticos —uno retirado— escribe **una** línea `warn` con el conteo `3` y los tres `diagnosticId`, y **no se bloquea**. Con cero diagnósticos no escribe ninguna línea.
44. Un fallo dentro del volcado —la consulta lanza— **no aborta la purga**: el `catch` escribe su línea `error` y la operación continúa.
45. `ESAVI-INVESTGN-005A` **no** sella los diagnósticos: tras desactivar la investigación, sus filas conservan `isActive: true` y `deletedAt: null`. Solo dejan de ser visibles, por la visibilidad heredada.

**De la forma y del canon:**

46. El código `ESAVI-INVDIAG-<NNN>` es **idéntico** en los cinco lugares —ruta, controlador, servicio, `AppError` y `appDetails.method`— en las nueve operaciones.
47. `npm run check` pasa entero. `npm run i18n:check` no reporta claves huérfanas y `tests/auth/roles.test.ts` cubre las nueve rutas nuevas, de 345 a 354.
48. `git diff` **no toca** `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts`, `diagnosticTermResolution.service.ts`, ni ninguna parte de `investigation.service.ts` fuera de la función de volcado nueva y su invocación en `purgeInvestigationService`.
49. `esaviapp.sql` crece en **cuatro zonas y solo cuatro**: el bloque `CREATE TABLE` con su índice, la fila del bucle `setSortOrderByParent`, el índice único parcial y los tres `CALL "upsertCatalogItem"`.

---

## 6. Decisiones tomadas y descartadas

**Cuelga de `investigation` y no de `investigationClinicalEvaluation`.** El formulario captura el diagnóstico final dentro de la sección clínica, y `evaluationInstitution` sí cuelga de ahí, así que la nieta era la opción de simetría. Se descarta porque **un diagnóstico final puede conocerse sin que la evaluación clínica se haya ejecutado**: llega por informe de laboratorio, por epicrisis o por autopsia. Colgarlo del 1:1 obligaría a crear una `investigationClinicalEvaluation` vacía solo para poder registrarlo, y encadenaría la visibilidad del diagnóstico al estado de un bloque con el que no tiene relación causal. La proximidad en el formulario no es una jerarquía de datos. Beneficio adicional: la visibilidad heredada es de un salto y no necesita el `paranoid: false` de dos saltos que F33 tuvo que inventar.

**N filas y no un 1:1.** Un paciente puede salir de la investigación con varios diagnósticos finales, y meterlos en una sola fila obligaría a concatenarlos en texto, que es exactamente el problema que este spec resuelve. La forma 1:1 —`investigationId` como PK, sin `sortOrder` ni `isActive`, cinco operaciones— se descartó en la fase de definición.

**Sin `isPrimary`.** Se consideró una marca de diagnóstico principal con índice único parcial `("investigationId") WHERE "isPrimary" AND "deletedAt" IS NULL`. Se descarta: los N diagnósticos finales son de igual rango clínico y el formulario no pide jerarquía. **El `sortOrder` es presentación y nada más**, y explícitamente **no** hace de principal implícito: lo gobierna un trigger y el `005B` lo reasigna, así que apoyar una jerarquía clínica en él la dejaría a merced de una reactivación. Si más adelante hace falta, es una columna nueva y un spec nuevo.

**Una sola raíz léxica, `diagnostic`.** El inglés natural pide `diagnosisDate` junto a `diagnosticTermId`, y se descarta la mezcla. `notificationMedicalHistory` mantiene `historyRaw` / `historyName` / `historyCode` y F33 mantiene `conditionRaw`; una entidad con dos raíces obliga a recordar cuál lleva cada uno de los siete artefactos, y ése es el tipo de detalle que se equivoca en el sexto.

**La guarda de duplicado es sobre el término solo, no sobre el par `(término, tipo)`.** La alternativa —permitir el mismo término como presuntivo y luego como confirmado— se descarta: cuando un diagnóstico presuntivo se confirma, lo que corresponde es un `004` sobre la fila que ya existe, y ésa es además la operación que deja rastro en `appDetails` de que el diagnóstico cambió de estatus. Dos filas vivas con el mismo término y distinto tipo no son dos hechos: son el mismo hecho contado dos veces.

**Se compara contra activos, y el `005B` no la revalida.** Como en F16, F21, F27, F33 y F57. La consecuencia asumida es que reactivar un diagnóstico retirado puede dejar **dos filas activas con el mismo término** si en el intervalo se cargó otra vez. Se acepta por lo mismo que en las cinco anteriores: revalidar en el `005B` convertiría una operación de estado en una de negocio, y dejaría filas históricas irrecuperables por un conflicto que nació después de retirarlas. El duplicado se resuelve con un `005A` sobre la que sobre.

**Sin valor por defecto para `diagnosticTypeItemId`.** `investigation.statusItemId` cae en `DEFAULT_INVESTIGATION_STATUS_VALUE` cuando falta, y aquí no se copia: «presuntivo» y «no consta» no son lo mismo, y el formulario actual no captura el campo. Sustituir la ausencia por un ítem inventaría un dato clínico que nadie afirmó.

**`diagnosticDate` y `diagnosticTypeItemId` se declaran aunque el formulario no las capture.** La alternativa era dejarlas fuera y añadirlas cuando el formulario las pida. Se descarta porque añadir columnas después cuesta un spec entero y, en un esquema que se cargará con datos, una migración; declararlas ahora cuesta dos filas de una tabla. Al ser anulables, un cliente que las ignore se comporta exactamente igual que si no existieran.

**La regla de fecha no futura vive solo en el validador.** Un `CHECK` sobre `current_date` no es inmutable y Postgres no lo admite, así que la base no puede respaldarla. Queda declarado en §3.1 para que nadie la busque ahí.

**`diagnosticDate` no se cruza con ninguna otra fecha.** Ni `investigation.investigationStartDate`, ni `investigation.hospitalizationDate`, ni `esaviCase.eventDate`. Un diagnóstico final puede fecharse antes del inicio formal de la investigación —el laboratorio lo emitió antes de que el caso se abriera—, y encadenarlo a fechas de otras tablas crea un acoplamiento que ninguna hermana tiene hoy y que fallaría en los casos reales que llegan tarde.

**El DDL siembra el catálogo, en vez de declararlo precondición de despliegue.** `VACCINATION_SITE_CATALOG_CODE` es precondición y se carga por los endpoints de catálogo; aquí se siembra. La razón: los tres tipos de diagnóstico son un cerrado clínico universal, no una lista que cada despliegue configure, y una FK obligatoria de validar contra un catálogo que puede no existir convierte un 400 de negocio en un fallo de instalación. Es la primera vez que un spec de entidad hace esto, y queda como precedente para el siguiente que lo necesite.

**La matriz de roles es la de la familia de investigación, sin desviaciones propias.** Frente a la canónica de §9 hay dos diferencias —`001` y `004` en USER, `005B` en ADMIN— y las dos las hereda de `INVTEAM`, `INVPREG` e `INVVACAD`. Se consideró subir el `005B` a SUPERADMIN, como F57, por ser la operación que arrastra la reasignación de `sortOrder`; se descarta: romper la simetría con las diez hermanas de la cadena para proteger una reasignación que el propio servicio resuelve sin ambigüedad es un coste sin beneficio, y obligaría a explicar en cada revisión por qué esta tabla reactiva distinto que sus vecinas.

**Sin filtros de listado.** Ni por tipo, ni por rango de fecha, ni por término. La lista por investigación es de tres o cuatro filas y el cliente filtra en memoria. Añadir un filtro por query obliga a declararlo en el validador, a documentarlo en el contrato y a probarlo, para ahorrar un `.filter()`.

**No se escribe nada en `finalClassification` ni en `caseWorkflow`.** Se consideró que registrar el primer diagnóstico final avanzara el estado administrativo del caso. Se descarta por la misma razón que F57 desacopló `hasRelevantMedicalHistory`: el flujo del caso es dato de gestión, el diagnóstico es dato clínico, y hacer que una hija dispare la transición de su abuelo duplica la fuente de verdad del flujo, que F44 puso en un solo sitio.

**Sin migración del texto libre existente.** `completeClinicalSummary` seguirá conteniendo diagnósticos escritos en prosa. Nadie los parsea ni los mueve: una migración heurística sobre texto clínico libre produce datos falsos con apariencia de estructurados, que es peor que no tener datos.

---

## 7. Riesgos identificados

**1 — Un diagnóstico final vive fuera del bloque donde el formulario lo pinta.** La sección clínica del formulario escribirá contra dos padres distintos: `investigationClinicalEvaluation` para su prosa y `investigationDiagnostic` para sus diagnósticos. Un cliente que desactive la investigación clínica y espere que los diagnósticos desaparezcan con ella se llevará una sorpresa: siguen ahí, colgando de `investigation`. *Mitigación:* está declarado en §1.C, en §2 y en el criterio 14; el `005A` de `investigationClinicalEvaluation` no toca nada de esta tabla y así queda escrito.

**2 — Una investigación puede quedar con diagnósticos y sin evaluación clínica.** Es el precio de la decisión anterior, y es deliberado: el laboratorio llega antes que el médico. *Mitigación:* ninguna en el backend. Si el formulario quiere obligar a lo contrario, es regla de presentación.

**3 — El `005B` puede devolver a la vida una fila que apunta a un `catalogItem` desactivado desde entonces.** La reactivación no revalida la guarda del tipo, así que un diagnóstico reactivado puede quedar citando un `diagnosticTypeItemId` que ya no está activo. *Mitigación:* asumido, y es la posición coherente con el resto del repositorio —el `include` de la respuesta devuelve el ítem con su `isActive`, así que el cliente ve el estado real. Los tres ítems sembrados no se desactivan en la práctica.

**4 — El duplicado por reactivación.** Dos filas activas con el mismo `diagnosticTermId` en la misma investigación, si entre el `005A` y el `005B` alguien cargó el término otra vez. *Mitigación:* declarado en §6 y en el criterio 41; ninguna restricción de base lo impide porque ninguna se declaró. Se resuelve con un `005A` sobre la que sobre.

**5 — El `sortOrder` se lee como jerarquía clínica.** Es presentación y solo presentación, pero una lista ordenada invita a interpretar que el primero es el principal — y el `005B` puede mandar al final un diagnóstico que estaba primero. *Mitigación:* declarado en §1.F y §6. Si el negocio termina necesitando un principal, es `isPrimary` y otro spec, no una relectura del `sortOrder`.

**6 — Segunda tabla nueva, y la primera que siembra catálogo.** El precedente de editar `esaviapp.sql` en el sitio se apoya en que el sistema está en desarrollo y la base se carga entera. Si en el intervalo aparece un despliegue con datos, este spec necesita una migración que no tiene. *Mitigación:* comprobar antes de implementar que el supuesto sigue vigente. La siembra en sí es segura en cualquier caso: `upsertCatalogItem` es idempotente y no toca filas existentes de otros catálogos.

**7 — `ROUTE_RULES` crece a 354 filas.** La suite de roles empieza a ser un archivo largo de mantener. *Mitigación:* ninguna en este spec; es deuda de forma de la propia suite y no le corresponde a una entidad resolverla.

---

## 8. Impacto en el contrato HTTP

**Nueve endpoints nuevos y ningún cambio en los existentes.**

Las nueve rutas de §3.4 se añaden bajo `/api/investigation-diagnostics`, que hoy no existe. Ningún endpoint anterior cambia de forma, de rol ni de código:

- **`investigation` (F28) no cambia.** El `002`, el `003` y el `006` de `ESAVI-INVESTGN` siguen devolviendo exactamente lo mismo: los diagnósticos **no** se anidan en la respuesta de la investigación. Quien los quiera entra por `ESAVI-INVDIAG-002A` o por el `006`.
- **`investigationClinicalEvaluation` (F34) no cambia.** Ni en su forma de respuesta, ni en sus guardas, ni en su cascada.
- **`finalClassification` (F41) y `caseWorkflow` (F44) no cambian.**
- **`diagnosticTerm` (F15) no cambia de contrato**, aunque este spec escriba en su tabla por la rama `LOCAL`. Es la misma escritura que ya hacen `NOTIFEVT`, `PREGCOMP`, `INVPREG` y `MEDHIST`.
- **`catalogItem` (`ESAVI-CATITEM-002A`) gana tres filas de datos**, las del `catalogType` `diagnosticType`, por la siembra del DDL. El contrato del endpoint no se toca.
- **`ESAVI-INVESTGN-005C` cambia solo en el log.** Una línea `warn` más antes de la cascada; el código de respuesta, el payload y las guardas son idénticos.

**Códigos de error nuevos**, todos bajo el prefijo `INVDIAG_`: `_NOT_FOUND`, `_INVESTIGATION_NOT_FOUND`, `_CASE_NOT_FOUND`, `_DIAGTERM_NOT_FOUND`, `_INVALID_DIAGNOSTIC_TYPE`, `_ALREADY_EXISTS`, `_ALREADY_ACTIVE`, `_ALREADY_INACTIVE`, `_STILL_ACTIVE`. Ninguno colisiona con los existentes.

El sobre `{ ok, message, data }` / `{ ok, message, code, errors }` de §10 de las convenciones se respeta sin excepción en las nueve operaciones.

---

## Lo que **no** está en este spec

- **La marca de diagnóstico principal.** Sin `isPrimary`, sin índice único parcial que lo respalde, y sin que el `sortOrder` haga de sustituto.
- **Los filtros de listado.** Ni por `diagnosticTypeItemId`, ni por rango de `diagnosticDate`, ni por término, ni búsqueda por texto.
- **El listado global de diagnósticos.** No hay `002` por `/`. Se entra siempre por investigación o por caso.
- **La variante admin del `006`.** Quien necesite ver inactivos entra por el `002B`.
- **Cualquier agregación o reporte.** Contar diagnósticos por término, por tipo o por período es analítica y no cabe en un CRUD.
- **La escritura en `investigationClinicalEvaluation`, `finalClassification` o `caseWorkflow`.** Ni marcas, ni banderas, ni transiciones de estado.
- **La cascada del `ESAVI-INVESTGN-005A`.** `satelliteCascade.service.ts` no se toca: los diagnósticos conservan su estado propio cuando la investigación se desactiva.
- **La migración del texto libre de `completeClinicalSummary`.** El texto existente se queda donde está.
- **Los diagnósticos de la notificación.** Esta tabla es de la cadena de investigación. Lo que la notificación registra son antecedentes (F57) y eventos (F16), y son otra cosa.
- **La revisión de los términos creados por la rama `LOCAL`.** La gobernanza del maestro clínico —`autoCreated`, `reviewStatus`— es de F15 y no se toca aquí.
- **Cualquier cambio en `preventPhysicalDelete`.** La tabla queda fuera de la lista, deliberadamente, y ninguna otra entra ni sale.
