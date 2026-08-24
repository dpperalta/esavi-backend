# SPEC F33 — CRUD de `investigationPregnancyCondition`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F32 (`investigationMedicalHistory` — dependencia dura de modelo: es el padre de la FK, y quien dejó por escrito la pregunta que §1.D responde)**, **SPEC F27 (`notificationPregnancyComplication` — gemelo estructural: aporta la resolución con dos derivados, la guarda de duplicado sin respaldo de base y el índice añadido al DDL)**, **SPEC F15 (`diagnosticTerm` — dependencia dura de implementación: aporta `resolveDiagnosticTermService`)**, SPEC F16 (`notificationEvent` — origen del hallazgo del `sortOrder` en el `005B` y de la nota de `CREATE_FIELDS`), SPEC F31 (`investigationTeamMember` — hermana de forma dentro del bloque de investigación: la colección con `isActive` que ninguna cascada pisa), SPEC F28 (`investigation` — su volcado de purga gana una línea), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa, y gobierna cuándo se re-dispara la resolución contra el maestro)
> **Fecha:** 2026-08-23
> **Objetivo:** Dar de alta `investigationPregnancyCondition` —las condiciones registradas sobre el embarazo del paciente investigado— como la **primera nieta del bloque de investigación**, y responder la pregunta que F32 dejó abierta sobre su propio `005C`.

---

## 1. Por qué existe este spec

`investigationPregnancyCondition` guarda **cada condición anotada sobre el embarazo** que los antecedentes de la investigación declararon confirmado: una lista de N filas, ordenada, cada una con su término resuelto contra el maestro clínico cuando el investigador aporta un código, o con el texto tal cual cuando no.

Hoy la tabla existe en `esaviapp.sql:1067-1082` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta. [F32](./32-investigationmedicalhistory-crud.md) la nombra siete veces, la declara fuera de alcance y le deja una decisión pendiente por escrito.

**Se cuenta entre las catorce satélites de `investigation`, pero no cuelga de ella.** `CONVENTIONS.md:272` y `references.md` la listan con las otras trece, y el listado es engañoso: `FK_investigationPregnancyCondition_medicalHistory` (`:1080`) apunta a `investigationMedicalHistory("investigationId")`, no a `investigation("investigationId")`. Es la **primera tabla del repositorio que cuelga de una satélite**, y de ahí salen los cuatro rasgos que la separan.

**A — Su padre no tiene estado propio.** `investigationMedicalHistory` es una de las cinco tablas del repositorio sin `isActive` (F32 §1): lo único que puede estar sellado en ella es el `deletedAt`, y su estado real vive un salto más arriba, en `investigation.isActive`. La cadena de visibilidad heredada es por tanto de **dos saltos con el estado solo en el segundo** —`condition → medicalHistory → investigation`—, y es una forma que ninguna spec anterior tuvo: F24 y F27 encadenaban dos saltos donde **ambos** eslabones tenían `isActive`.

**B — De forma es el gemelo de F27, no de sus vecinas de bloque.** PK propia (`pregnancyConditionId`, `:1068`, con `DEFAULT gen_random_uuid()`), FK `NOT NULL` corriente al padre, `isActive` propio, `sortOrder` por trigger, y **una sola columna de texto para el término**: `conditionRaw varchar(500)` (`:1071`). Igual que en `notificationPregnancyComplication`, no hay dónde denormalizar el nombre canónico ni el código, así que la tabla de derivados es de **dos campos y no tres** —`diagnosticTermId` y `conditionRaw`—, y el nombre del maestro se lee del `include`. La diferencia con F27 es que **aquí falta también el catálogo de tipo**: no hay `conditionTypeItemId`, así que la guarda de duplicado se reduce al término solo.

**C — Arrastra el hallazgo del `005B` de F16, y es la séptima vez.** Figura en el bucle `setSortOrderByParent` con `investigationId` como padre (`:1322`) y tiene índice único parcial `UQ_investigationPregnancyCondition_parent_sortOrder` sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1356-1357`). El trigger es `BEFORE INSERT` solamente, y `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número: reactivar una condición cuyo `sortOrder` ya lo tomó otra hermana viva revienta el índice. F16 lo descubrió, F21, F22, F24, F27 y F31 lo arrastraron, y aquí vuelve entero. Es la razón de que el `005B` **no** delegue sin más en `setEntityActiveStatusService`.

**D — Responde la pregunta que F32 dejó por escrito, y la respuesta es la misma que dio F27.** F32 §7 declaró que *«su spec heredará el problema y tendrá que decidir si el `005C` de aquí se bloquea cuando existan condiciones registradas»*. La respuesta es **no se bloquea**: `ESAVI-INVMEDH-005C` sigue purgando y la cascada sigue disparando, con el volcado `warn` como única mitigación. Es la línea de F13, F29, F30 y F32, razonada en §6. Y de la misma decisión sale la segunda cara: **`ESAVI-INVESTGN-005C` destruye estas filas en dos saltos** —`investigation → medicalHistory → conditions`— sin dejar hoy ningún rastro, así que su volcado gana la quinta línea, y es la primera de segundo salto que aquel servicio lleva.

**Y dos rasgos que no la separan, heredados de F31 y verificados en el código:** ninguna cascada de estado la toca —`investigation.service.ts:514` deja fuera del `cascadeSealSatellite` a las satélites con `isActive`, y lo comenta por su nombre—, así que ni `ESAVI-INVESTGN-005A` ni `ESAVI-CASE-005A` le sellan el `deletedAt`; y no existe `TRG_investigationPregnancyCondition_setUpdatedAt` —el bucle genérico de `:1292-1301` crea solo el de `sysDetails`, en las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

**Y una tabla de la que no cuelga nada.** Es hoja del grafo: ninguna de las 45 la referencia. Su `005C` no lleva volcado de cascada.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationPregnancyCondition`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones y ninguna más:** `001` crear, `002A` listar activas por investigación, `002B` listar todas por investigación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar y `005C` borrado físico. **Sin `006` en ninguna forma** — se entra por el `investigationId`, que es a la vez la PK de los antecedentes y la de la investigación, y que `ESAVI-INVESTGN-006` ya devuelve a partir del `caseId`. Es la decisión de F27 y no la de F31, y por tanto **F33 no añade fila a la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6**.
- **Listado por padre, no global.** `002A` en `GET /investigation/:investigationId` para USER devuelve solo las condiciones activas; `002B` en `GET /admin/investigation/:investigationId` para ADMIN las devuelve todas, incluidas las de `deletedAt` sellado. **Sin ningún filtro por query**, ordenadas por `sortOrder` ascendente y paginadas con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. El resto se entra por `pregnancyConditionId`. Nunca por `/`.
- **Guarda del alta, con tres motivos y un solo 404** `INVPREG_001_MEDICAL_HISTORY_NOT_FOUND`: los antecedentes no existen, están sellados (`deletedAt` no nulo) o su investigación está inactiva. Una sola consulta sobre `investigationMedicalHistory` con `include` de `investigation`. Los tres motivos comparten código y mensaje: al investigador no le sirve distinguirlos, y el eslabón que falta está en los dos casos un nivel más arriba.
- **La misma guarda en los dos listados**, con `INVPREG_002A_MEDICAL_HISTORY_NOT_FOUND` e `INVPREG_002B_MEDICAL_HISTORY_NOT_FOUND`. **Unos antecedentes sin condiciones devuelven 200 con `{ count: 0, rows: [] }`; unos antecedentes que no existen devuelven 404.** Es la diferencia con F31, donde el listado guardaba contra `investigation` y una investigación sin miembros era el único caso posible.
- **Visibilidad heredada en cadena de dos saltos, con el estado solo en el segundo.** Toda lectura incluye `medicalHistory` y, a través de ella, `investigation`: si los antecedentes están sellados **o** la investigación está inactiva, la condición responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`). Aplica a `002A`, `002B`, `003` y `004`. **No aplica a `005A`, `005B` ni `005C`**, que actúan sobre el estado propio de la fila, por el criterio de F31 §3.5.
- **Resolución contra el maestro clínico, en `001` y `004`**, con las tres ramas de F16 y F27:
  - Con `conditionCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService`, que devuelve el término existente o **lo crea**.
  - Con `conditionCode` y `source` distinto de `'LOCAL'` → `findOne` sobre el par `(source, code)`, **sin crear nada**; si no existe → 404 `INVPREG_<op>_DIAGTERM_NOT_FOUND`.
  - Sin `conditionCode` → `diagnosticTermId` queda `null` y `conditionRaw` guarda el texto del investigador tal cual.
- **Dos campos derivados, no tres.** `diagnosticTermId` y `conditionRaw`. La tabla **no tiene columna para el nombre del maestro ni para el código**, así que `conditionRaw` guarda el texto del investigador **solo si difiere** del nombre del maestro, y el nombre canónico se lee del `include`. Es la tabla de F27, literal.
- **Resolución disparada por el cambio de valor, no por la presencia de la clave** (SPEC F12): en el `004`, un `conditionCode` que llega igual al guardado no se resuelve ni se consulta. Reenviar íntegra la respuesta del `GET` **no escribe en `diagnosticTerm`**.
- **`conditionName` obligatorio en el `001`**, máximo 500 caracteres, y **no anulable en el `004`**: un `null` explícito es 400 del validador. Una condición sin nombre no informa de nada.
- **Guarda de duplicado**, en `001` y `004`: el `diagnosticTermId` no puede repetirse entre las condiciones **activas** de los mismos antecedentes → 409 `INVPREG_<op>_ALREADY_EXISTS`. **Solo corre si el término resolvió**: dos condiciones de texto libre son registros distintos. No está respaldada por ninguna restricción de base —no hay `UNIQUE` en el DDL—: es regla de negocio del servicio. **El `005B` no la revalida**, y el duplicado por reactivación es consecuencia asumida, razonada en §6.
- **`investigationId` y `sortOrder` inmutables**, ignorados en silencio en el `004`, sin 400. Una condición no se traslada entre investigaciones y su orden lo gobierna la base.
- **`sortOrder` asignado por la base.** El `001` nunca lo envía —lo pone `TRG_investigationPregnancyCondition_setSortOrder` (`:1322`)—. Exige la lista explícita `CREATE_FIELDS` en el `create`, por la razón que F16 §3.2 documentó: sin ella la validación `notNull` de Sequelize mata el alta antes de que el trigger llegue a ejecutarse.
- **Reasignación de `sortOrder` en `ESAVI-INVPREG-005B`** cuando el número que ocupaba la fila ya lo tomó otra condición viva de los mismos antecedentes. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación no delega sin más en `setEntityActiveStatusService`.
- **Normalización al escribir: solo `trim()`** sobre `conditionName` y `notes`, con `normalizeText`. Ningún `toTitleCase` ni `toConstantCase` — no hay `code` propio, y el del término lo normaliza `resolveDiagnosticTermService`.
- **Sin cascada de estado desde ningún padre.** Ni `ESAVI-INVMEDH-*`, ni `ESAVI-INVESTGN-005A`, ni `ESAVI-CASE-005A` tocan estas filas: `investigation.service.ts:514` deja fuera del `cascadeSealSatellite` a las satélites con `isActive`. **`satelliteCascade.service.ts` no se toca.**
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — deliberado: el hueco queda para la siguiente condición.
- **`005C` sin volcado de cascada**, porque no hay nada que arrastrar. Guarda canónica: la fila debe estar en `isActive: false` → si no, 409. La aporta `purgeEntityService` tal cual, que aquí **sí es efectivo** porque la columna existe.
- **Dos volcados `warn` en dos archivos ajenos, y ningún bloqueo:**
  - `investigationMedicalHistory.service.ts` — `ESAVI-INVMEDH-005C` gana el conteo de `pregnancyConditionId` que su `ON DELETE CASCADE` destruye, con `paranoid: false`. Es la respuesta a la pregunta que F32 §7 dejó abierta.
  - `investigation.service.ts` — `ESAVI-INVESTGN-005C` gana su **quinta** línea, la primera de **segundo salto**, junto a las cuatro que F29, F30, F31 y F32 dejaron.

  Los dos son conteo y no volcado por fila, por el criterio que F31 fijó para las colecciones.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5: dos inmutables que no entran, dos derivados que entran **siempre**, y uno anulable.
- **Una línea nueva en `esaviapp.sql`:** `CREATE INDEX IF NOT EXISTS "IX_investigationPregnancyCondition_investigation" ON "investigationPregnancyCondition" ("investigationId")`. El índice parcial de `:1356-1357` no sirve para el `002B`, que lee también filas con `deletedAt` sellado. Es lo que hicieron F21, F22, F24, F27 y F31.
- Alta de la abreviatura **`INVPREG`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/investigationPregnancyCondition.test.ts`.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F32** debe estar `Implementado` —lo está—. `investigationMedicalHistory` es el padre de la FK: sin una fila suya no puede existir ninguna condición, y su ausencia es el 404 del `001`.
- **El maestro `diagnosticTerm` no necesita precarga.** La rama `LOCAL` acuña términos al vuelo, que es exactamente para lo que F15 lo escribió. **No hay ningún `catalogType` que sembrar**: a diferencia de F27 y F32, esta tabla no tiene ninguna FK a `catalogItem`.

**Fuera de alcance (otros specs):**

- **Cualquier guarda de coherencia contra `isPregnancyConfirmed` del padre.** Cargar una condición sobre unos antecedentes con `isPregnancyConfirmed` distinto de `'YES'` responde **201**, no 409. La regla del bloque de embarazo vive en F32 §3.5 y replicarla aquí duplicaría la fuente de verdad. Razonado en §6, y es la decisión literal de F27 frente a `hasComplications`.
- **Que el cierre del bloque de embarazo en `ESAVI-INVMEDH-004` retire estas filas.** F32 fuerza a `null` sus nueve campos gestacionales cuando el bloque se cierra, y **no toca esta tabla**: las condiciones ya cargadas sobreviven. `investigationMedicalHistory.service.ts` solo se modifica en el `005C`, para el volcado.
- **Bloquear `ESAVI-INVMEDH-005C` o `ESAVI-INVESTGN-005C`** cuando haya condiciones registradas. Se deja disparar la cascada de Postgres, con el volcado al log como única mitigación.
- **Las otras diez satélites de `investigation`:** `investigationCovidHistory` (`esaviapp.sql:1014-1036`), `investigationClinicalEvaluation` (`1084-1107`), `evaluationInstitution` (`1109-1129`), `investigationVaccinationContext` (`1131-1152`), `investigationVaccineAdministered` (`1155-1169`), `investigationColdChain` (`1172-1194`), `investigationAdministrationError` (`1197-1231`) e `investigationCommunity` (`1234-1252`).
- **Reordenar condiciones** — un `007` que mueva una de posición y desplace a sus hermanas. Es lo que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. Su propio spec, y el mismo que F16, F27 y F31 dejaron abierto.
- **Aceptar `diagnosticTermId` directo del cliente.** Sería una segunda puerta para apuntar a un término, y con ella la pregunta de qué gana cuando llegan los dos. F16 §6 ya lo descartó.
- **Un `006` por `caseId` o por `investigationId`.** Se entra por `/investigation/:id`, y ese `:id` es el que `ESAVI-INVESTGN-006` ya devuelve a partir del caso.
- **Cualquier filtro de listado** por `diagnosticTermId` o por texto. Los dos listados devuelven todas las condiciones de sus antecedentes, paginadas y ordenadas por `sortOrder`.
- **Cualquier regla que exija al menos una condición** cuando `isPregnancyConfirmed` es `'YES'`, o que valide su composición. Unos antecedentes con embarazo confirmado y sin condiciones son válidos.
- **Incluir las condiciones en la respuesta de `investigationMedicalHistory`.** El contrato de F32 no cambia: el `hasMany` se declara para el volcado, no para el payload.
- **Deduplicar condiciones de texto libre.** La guarda compara `diagnosticTermId` y nada más; dos condiciones sin término no colisionan aunque el texto sea idéntico. Lo que no cubre queda en §7.
- **Modificar `esaviapp.sql`** más allá del índice: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`, ni la FK a `investigationMedicalHistory` —que es la que hace de esta tabla una nieta y no una satélite—.
- **Modificar `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` ni `diagnosticTermResolution.service.ts`.**
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la enésima copia. La deuda que F24 §7 declaró vencida sigue vencida.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII directa: `conditionRaw` es un término clínico, no un identificador de persona.
- Crear condiciones automáticamente al dar de alta unos antecedentes.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationPregnancyCondition` — `esaviapp.sql:1067-1082`. Se le añade **un índice y nada más**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `pregnancyConditionId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` (`:1068`) |
| `investigationId` | `uuid` | no | `FK_investigationPregnancyCondition_medicalHistory` → **`investigationMedicalHistory("investigationId")`**, `ON DELETE CASCADE` (`:1069`, `:1080`). **Sin `UNIQUE`** → uno a muchos |
| `diagnosticTermId` | `uuid` | sí | `FK_..._term` → `diagnosticTerm`, `ON DELETE RESTRICT` (`:1070`, `:1081`). **Derivada**: la devuelve la resolución, no el cliente |
| `conditionRaw` | `varchar(500)` | sí | Texto del investigador. **Derivada**: se guarda solo si difiere del nombre del maestro (`:1071`) |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)` (`:1072`). Lo asigna el trigger; la aplicación no lo envía |
| `notes` | `text` | sí | Solo `trim()` (`:1073`) |

**El nombre de la columna FK engaña.** Se llama `investigationId` y **no apunta a `investigation`**: apunta a la PK de `investigationMedicalHistory`, que resulta ser el mismo UUID porque aquella tabla comparte clave con su padre. La consecuencia práctica es que el valor sirve para las dos consultas, pero la existencia que hay que comprobar es la de los **antecedentes**, no la de la investigación: una investigación viva sin fila de antecedentes no admite condiciones.

**Restricciones.** Dos claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla.** La única unicidad de base vive fuera, en el índice parcial `UQ_investigationPregnancyCondition_parent_sortOrder` sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1356-1357`). Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `C` de §1. **La guarda de duplicado sobre `diagnosticTermId` no está respaldada por nada**: es regla de negocio del servicio.

**El `ON DELETE RESTRICT` hacia `diagnosticTerm` es inerte en la práctica.** El maestro figura en el bucle `preventPhysicalDelete` (`:1372-1377`) y no tiene `005C`, así que nunca llega a intentarse el borrado que la restricción bloquearía.

**Las columnas transversales.** Están las seis: `isActive` (`:1074`), `createdAt` (`:1075`), `updatedAt` (`:1076`), `deletedAt` (`:1077`), `sysDetails` (`:1078`) y `appDetails` (`:1079`).

**Triggers. Dos.** `TRG_investigationPregnancyCondition_setSysDetails`, del bucle genérico (`:1292-1301`). Y `TRG_investigationPregnancyCondition_setSortOrder`, del bucle de orden (`:1310-1335`), que ejecuta `setSortOrderByParent('investigationId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre, bajo `pg_advisory_xact_lock`. **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `:1372-1377`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

**Hoja del grafo.** Ninguna de las 45 tablas la referencia. Su `005C` no arrastra nada y no lleva volcado de cascada.

**El índice que se añade.** `IX_investigationPregnancyCondition_investigation` sobre `("investigationId")`, en la línea siguiente al `CREATE TABLE` de `:1082`, con la forma de `IX_investigationTeamMember_investigation`. El parcial de `:1356-1357` no cubre el `002B`, que lee también filas con `deletedAt` sellado.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationPregnancyCondition.model.ts`. Clase `InvestigationPregnancyCondition`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationPregnancyCondition'`.

`pregnancyConditionId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')` — **sí lo lleva**, a diferencia de F32: aquí la clave es propia y la genera la base, no la aporta el cliente. `investigationId` va `DataTypes.UUID` con `allowNull: false`. `diagnosticTermId` va `DataTypes.UUID` con `allowNull: true`. `conditionRaw` va `DataTypes.STRING(500)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres. `notes` va `DataTypes.TEXT`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, por la razón que F16 §3.2 documentó: un `defaultValue: 0` haría que el `INSERT` mandara el `0` que el trigger interpreta como «asígnamelo tú», y funcionaría por accidente.

> **Nota de implementación, heredada de F16.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere con `notNull Violation: InvestigationPregnancyCondition.sortOrder cannot be null` y el trigger nunca se ejecuta. Lo que deja la columna fuera de la sentencia es la lista explícita: `InvestigationPregnancyCondition.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y **sin** `sortOrder` ni `pregnancyConditionId`.

Asociaciones, en `src/models/associations/investigationPregnancyCondition.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationPregnancyCondition.belongsTo(InvestigationMedicalHistory, { as: 'medicalHistory', foreignKey: 'investigationId' })`
- `InvestigationMedicalHistory.hasMany(InvestigationPregnancyCondition, { as: 'pregnancyConditions', foreignKey: 'investigationId' })`
- `InvestigationPregnancyCondition.belongsTo(DiagnosticTerm, { as: 'diagnosticTerm', foreignKey: 'diagnosticTermId' })`

**El `belongsTo` se declara sobre `investigationId` apuntando a `InvestigationMedicalHistory`**, no a `Investigation`. Es la asociación que más fácil se escribe mal, porque el nombre de la columna sugiere lo contrario.

El `hasMany` se declara porque lo necesitan los dos volcados de §3.5. **No se incluye en ninguna respuesta de `investigationMedicalHistory`**: el contrato de F32 no cambia. `DiagnosticTerm` no gana ningún inverso, igual que en F27.

Alta en `src/models/index.ts` y en el barrel de asociaciones.

**Los dos `include` que el servicio compone:**

- **Visibilidad heredada**, en `002A`, `002B`, `003` y `004` — dos saltos: `{ model: InvestigationMedicalHistory, as: 'medicalHistory', required: true, attributes: ['investigationId', 'deletedAt'], paranoid: false, include: [{ model: Investigation, as: 'investigation', required: true, attributes: ['investigationId', 'isActive'], where: includeInactive ? {} : { isActive: true } }] }`. **El eslabón intermedio se comprueba por `deletedAt` y no por `isActive`**, porque aquella tabla no tiene la columna; el `paranoid: false` es lo que permite verlo sellado en vez de que el `include` lo esconda.
- **Respuesta**, en `001`, `003`, `004` y las filas de los listados: `diagnosticTerm` con seis atributos.

### 3.3 Tipos

Ruta: `src/types/investigation/investigationPregnancyCondition.types.ts`, junto a los cinco archivos que aquel dominio ya tiene, exportado por su `index.ts` de barrel.

```ts
export interface CreateInvestigationPregnancyConditionInput {
    investigationId: string;
    conditionName: string;
    conditionCode?: string | null;
    source?: TermSource | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateInvestigationPregnancyConditionInput>`. **No se declara `UpdateInvestigationPregnancyConditionInput`** — prohibido por §4 de las convenciones.

**Tres claves de entrada no son columnas**, y es la consecuencia directa de resolver contra el maestro:

- **`conditionName`** es el texto del investigador. No hay columna con ese nombre: alimenta `conditionRaw`, que solo lo guarda si difiere del maestro.
- **`conditionCode`** y **`source`** alimentan la resolución y no se guardan en ninguna parte de esta tabla. El código vive en `diagnosticTerm`, que es donde F15 lo puso.

**Tres columnas no están en la interfaz.** `diagnosticTermId` y `conditionRaw` son derivadas —aceptarlas abriría la segunda puerta que F16 §6 cerró—; `sortOrder` es inmutable y lo asigna la base, y que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande.

`TermSource` se importa de `src/constants/enums.constants.ts`, donde F15 lo dejó. **No se declara ningún enumerado nuevo.**

### 3.4 Superficie HTTP

Ruta base `/api/investigation-pregnancy-conditions`, registrada en `src/routes/index.ts`.

```
POST   /api/investigation-pregnancy-conditions                         ESAVI-INVPREG-001   USER        (nuevo)
GET    /api/investigation-pregnancy-conditions/admin/investigation/:id ESAVI-INVPREG-002B  ADMIN       (nuevo)
GET    /api/investigation-pregnancy-conditions/investigation/:id       ESAVI-INVPREG-002A  USER        (nuevo)
DELETE /api/investigation-pregnancy-conditions/purge/:id               ESAVI-INVPREG-005C  SUPERADMIN  (nuevo)
PATCH  /api/investigation-pregnancy-conditions/activate/:id            ESAVI-INVPREG-005B  ADMIN       (nuevo)
GET    /api/investigation-pregnancy-conditions/:id                     ESAVI-INVPREG-003   USER        (nuevo)
PUT    /api/investigation-pregnancy-conditions/:id                     ESAVI-INVPREG-004   USER        (nuevo)
DELETE /api/investigation-pregnancy-conditions/:id                     ESAVI-INVPREG-005A  ADMIN       (nuevo)
```

**Ocho rutas, y `:id` es el `pregnancyConditionId`** salvo en los dos listados, donde es el `investigationId`. El `003` **no** es el acceso por investigación: para eso está el `002A`.

**Orden de declaración.** Las literales van **antes** de `/:id`, y `/admin/investigation/:id` antes que `/investigation/:id`, o Express capturaría `admin`, `investigation`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las ocho están escritas arriba en el orden exacto en que deben aparecer en `src/routes/investigationPregnancyCondition.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `PREGCOMP` e `INVTEAM`.

**Roles.** `001`, `002A`, `003` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28, F29, F30, F31 y F32, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso, y partir el formulario de embarazo entre dos roles rompería la captura por la mitad. `002B` y `005A` en **ADMIN**. **`005B` en ADMIN y no en SUPERADMIN**, siguiendo a F27 y F31: la activación de esta entidad no es la delegación trivial que la matriz canónica supone, sino una operación con reasignación de `sortOrder`, y quien administra el caso debe poder ejecutarla. `005C` se queda en **SUPERADMIN**.

**Ocho operaciones y ninguna no canónica.** Es la tercera de la familia sin `006`, tras F24 y F27, y por tanto **no añade fila a la tabla de operaciones no canónicas de §6**.

**La abreviatura es `INVPREG`.** Siete letras, no colisiona con las treinta y tres registradas, y `grep "ESAVI-INVPREG-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVMEDH-`, `ESAVI-INVTEAM-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-NOTIFPRG-` ni `ESAVI-PREGCOMP-`.

Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, a continuación de las que dejó F32.

### 3.5 Reglas de negocio por operación

#### La guarda del padre — compartida por `001`, `002A` y `002B`

Una sola consulta sobre `investigationMedicalHistory` por PK, con `paranoid: false` e `include` de `investigation` (`attributes: ['investigationId', 'isActive']`). Falla, con **404** y un único código por operación, si se cumple cualquiera de estas tres:

1. No hay fila de antecedentes.
2. La fila tiene `deletedAt` no nulo — la selló un `ESAVI-INVESTGN-005A` a través de `cascadeSealSatellite`.
3. Su investigación tiene `isActive: false`.

**Los tres motivos comparten código y mensaje.** Al investigador no le sirve distinguirlos: en los tres casos el eslabón que falta está un nivel más arriba y la acción correctiva es la misma.

**En los dos listados la comprobación 3 la relaja `canViewInactive`**, como en toda visibilidad heredada del repositorio; las comprobaciones 1 y 2 **no se relajan para nadie**, ni siquiera para SUPERADMIN: una fila sellada sí es visible —es lo que el `paranoid: false` permite—, pero unos antecedentes inexistentes no tienen condiciones que listar bajo ningún rol.

**En el `001` no hay relajación de ninguna de las tres.** Unos antecedentes sellados o de investigación inactiva no reciben condiciones nuevas, sea quien sea quien lo pida. Es el criterio de F31 §3.5 para su `001`.

#### Visibilidad heredada — compartida por `003`, `004` y las filas de los dos listados

Toda lectura de una condición incluye la cadena de dos saltos de §3.2. La condición responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`), si:

- sus antecedentes tienen `deletedAt` sellado, **o**
- su investigación tiene `isActive: false`, **o**
- la propia condición tiene `isActive: false`.

Las tres condiciones se evalúan igual y ninguna tiene prioridad: basta que una falle.

**El `005A`, el `005B` y el `005C` no la aplican.** Quien retira, reactiva o purga actúa sobre el estado propio de la fila, y ese estado existe con independencia de sus dos padres. Es el criterio de F31.

#### Guarda de duplicado — `001` y `004`

`findOne` sobre el mismo `investigationId`, el mismo `diagnosticTermId` e `isActive: true`, excluyendo en el `004` la propia fila con `pregnancyConditionId: { [Op.ne]: id }`. Si hay fila → **409** `INVPREG_<op>_ALREADY_EXISTS`.

**Solo corre si el término resolvió.** Con `diagnosticTermId: null` no se comprueba nada: dos condiciones de texto libre son registros distintos aunque el texto coincida, y una guarda inventada no debe ser más rígida que las que la base sí impone —que aquí son ninguna.

**Va después de la resolución**, porque el término que se compara es el resuelto, no el código enviado.

**Se compara contra activas, no contra todas.** Una condición retirada no bloquea volver a cargar el mismo término: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`. La consecuencia —que un `005B` pueda dejar dos filas activas con el mismo término— está declarada en §6.

#### Por operación

**`ESAVI-INVPREG-001` — crear.** Todo dentro de **una transacción**, porque la resolución del término puede escribir en `diagnosticTerm`. En este orden:

1. **La guarda del padre** → 404 `INVPREG_001_MEDICAL_HISTORY_NOT_FOUND`.
2. **Resolución del término**, en tres ramas:
   - Sin `conditionCode` → `diagnosticTermId: null` y `conditionRaw: normalizeText(data.conditionName)`.
   - Con `conditionCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService({ code, name: data.conditionName, operationCode: 'ESAVI-INVPREG-001' }, authUser, lang, transaction)`, que **devuelve el término o lo crea**.
   - Con `conditionCode` y `source` distinto de `'LOCAL'` → `DiagnosticTerm.findOne({ where: { source, code: toConstantCase(code.trim()) } })`, **sin crear nada**; si no existe → 404 `INVPREG_001_DIAGTERM_NOT_FOUND`. La consulta no filtra por `isActive`: un término retirado sigue siendo referenciable, por la misma razón que `diagnosticTermResolution.service.ts:37-38` no lo filtra.
3. Con término resuelto: `diagnosticTermId` = el suyo, y `conditionRaw` = el texto del investigador **solo si difiere** del nombre del maestro; si coincide, `null`.
4. **Guarda de duplicado**, solo si `diagnosticTermId` quedó con valor → 409 `INVPREG_001_ALREADY_EXISTS`.
5. Normalización: `normalizeText` sobre `conditionName` y `notes`. **Ningún `toTitleCase` ni `toConstantCase`** — el del código lo aplica `resolveDiagnosticTermService`.
6. `create` con `fields: CREATE_FIELDS`, **sin `sortOrder`**, para que lo asigne el trigger.
7. Entrada de auditoría en `appDetails` con `method: 'ESAVI-INVPREG-001'`.

Un alta con solo `investigationId` y `conditionName` es válida y devuelve **201**, con `diagnosticTermId` y `notes` en `null`, `conditionRaw` con el texto y el `sortOrder` que le toque.

**`ESAVI-INVPREG-002A` — listar activas por investigación.** La guarda del padre → 404 `INVPREG_002A_MEDICAL_HISTORY_NOT_FOUND`. `findAndCountAll` con `where: { investigationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query.

Unos antecedentes sin condiciones devuelven **200** con `{ count: 0, rows: [] }`, no 404.

**`ESAVI-INVPREG-002B` — listar todas por investigación.** Idéntica, con `where: { investigationId }`, **sin** el `isActive: true`, con `paranoid: false` y `validateUserRole(ADMIN)`. Devuelve también las retiradas y las de `deletedAt` sellado. Mismo 404 salvo el sufijo: `INVPREG_002B_MEDICAL_HISTORY_NOT_FOUND`. **Es la operación que justifica el índice nuevo de §3.1.**

Un ADMIN ve condiciones inactivas, no condiciones de unos antecedentes que no existen.

**`ESAVI-INVPREG-003` — obtener por ID.** El `:id` es el `pregnancyConditionId`. Existencia más la visibilidad heredada de dos saltos más el `isActive` propio, gobernados los tres por `canViewInactive` → 404 `INVPREG_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVPREG-004` — actualizar.** Dentro de **transacción**, por la misma razón que el `001`. En este orden:

1. Existencia con visibilidad heredada → 404 `INVPREG_004_NOT_FOUND`.
2. `investigationId` y `sortOrder` **se ignoran siempre**, vengan o no en el body, sin 400.
3. `stored` sale de `condition.get({ plain: true })` con su `diagnosticTerm`, **no de una consulta acotada**: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
4. Resolución y guarda de duplicado, con las reglas de abajo. **Antes del diff y con independencia de él.**
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

**El nombre efectivo y cuándo se re-resuelve.** Sea `storedEffectiveName` = `stored.conditionRaw ?? stored.diagnosticTerm.name` — exactamente lo que el `GET` muestra como nombre de la condición. Entonces:

```
incomingName = data.conditionName !== undefined
               && normalizeText(data.conditionName) !== storedEffectiveName
             ? normalizeText(data.conditionName)
             : storedEffectiveName
```

> **Nota de implementación — por qué la segunda condición.** Es la trampa que F16 §3.5 documentó y F27 simplificó. Sin ella, un `PUT` que reenvía íntegra la respuesta de su `GET` reescribiría `conditionRaw` en toda fila con divergencia. Un `conditionName` que llega **igual al que el `GET` mostró** no es una reescritura, y por eso cae al fallback como una clave ausente.

La resolución se re-dispara **solo si `conditionCode` o `source` llegan con un valor distinto del que produjo el término guardado**, o si `incomingName` cambió. Un `PUT` que reenvía el código guardado **no consulta ni escribe** `diagnosticTerm`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `pregnancyConditionId` | **no entra** | PK |
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `diagnosticTermId` | **siempre**, del término resuelto o `null` | derivado |
| `conditionRaw` | **siempre**: `incomingName` si difiere del nombre del maestro, `null` si coincide, `incomingName` si no hay término | derivado |
| `notes` | `data.notes !== undefined ? normalizeText(data.notes) : undefined` | anulable; solo `trim()` |
| `isActive` | **no entra** | lo gobiernan `005A` y `005B` |

**Dos derivados y un solo comparado.** `conditionName` **no aparece en la tabla** porque no es columna: entra a través de los dos derivados. Y como el `001` lo exige, el `004` **tampoco lo deja vaciar**: un `conditionName: null` explícito es 400 del validador y nunca llega al servicio.

**`ESAVI-INVPREG-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'INVPREG_005A_NOT_FOUND'`, `alreadyInStateCode: 'INVPREG_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-INVPREG-005A'`. **No consulta nada más**: la tabla es hoja y no aplica visibilidad heredada. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — correcto y deliberado: el hueco queda para la siguiente condición.

**`ESAVI-INVPREG-005B` — reactivar.** Dentro de **transacción**, y **no** es delegación limpia. Es el hallazgo de F16, entero:

1. Se busca la fila con `paranoid: false` → 404 `INVPREG_005B_NOT_FOUND`.
2. Si existe y está inactiva, se busca colisión: otra fila del **mismo** `investigationId`, con el **mismo** `sortOrder`, con `deletedAt: null` y `pregnancyConditionId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de ese padre —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que la escritura es libre. La condición reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'INVPREG_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-INVPREG-005B'`.

Si la fila estaba **activa**, el paso 2 no encuentra colisión y el helper levanta su 409 con normalidad.

**El `005B` no revalida nada más**: ni la guarda de duplicado, ni el término, ni el estado de los antecedentes o de la investigación. Reactivar es deshacer una desactivación.

**`ESAVI-INVPREG-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'INVPREG_005C_NOT_FOUND'` y `stillActiveCode: 'INVPREG_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. La aporta el control que el helper ya lleva dentro, que aquí **sí es efectivo** porque la columna existe —a diferencia de F29, F30 y F32—. **Sin consulta previa y sin volcado de cascada**: la tabla es hoja del grafo. Sin entrada en `appDetails` —la fila se destruye en la misma transacción—, que es la ausencia que `CONVENTIONS.md` §6 declara legítima.

#### Los dos volcados en servicios ajenos

Ninguno bloquea nada, ninguno abre transacción propia y los dos se escriben **antes** del `destroy`, dentro de la transacción que ya existe. Los dos son **conteo y no snapshot por fila**, por el criterio que F31 fijó para las colecciones: veinte condiciones enterrarían la línea que importa bajo veinte más.

**En `investigationMedicalHistory.service.ts`, dentro de `purgeInvestigationMedicalHistoryService`** — es la respuesta a F32 §7:

```
ESAVI-INVMEDH-005C: N investigation pregnancy condition(s) dragged by ON DELETE CASCADE, purged by <userId>
```

`InvestigationPregnancyCondition.count({ where: { investigationId: id }, paranoid: false, transaction })`. El `paranoid: false` cuenta también las que un `005A` selló: la cascada las destruye igual. Se emite solo si `N > 0`. **El comentario de `:633` que dice «once that table exists» se sustituye por el volcado real.**

**En `investigation.service.ts`, dentro de `purgeInvestigationService`** — quinta línea del volcado, y **la primera de segundo salto** que aquel servicio lleva:

```
ESAVI-INVESTGN-005C: N investigation pregnancy condition(s) dragged by ON DELETE CASCADE in two hops, purged by <userId>
```

Mismo `count`, con el mismo `investigationId`: la PK compartida de los antecedentes hace que el segundo salto no cueste una consulta extra. Va **después** de la línea de `medicalHistory` que F32 dejó, porque destruirla es lo que arrastra éstas.

#### Escrituras que no son diferenciales, declaradas una a una

- **El `001`** — es un `create`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: esta condición vuelve a estar viva y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005A` y el `005B`** — escrituras de estado, delegadas en `setEntityActiveStatusService`.
- **El `005C`** — destruye la fila.
- **La acuñación de un `diagnosticTerm` en la rama `LOCAL`** — la hace `resolveDiagnosticTermService`, con su propia auditoría, y este spec no la modifica. **Se dispara por el cambio de valor**, nunca por la presencia de la clave: un `conditionCode` reenviado igual no consulta ni escribe el maestro.

**Este spec no escribe en ninguna otra tabla.** En particular, **no toca `investigationMedicalHistory`**: ni `isPregnancyConfirmed`, ni `updatedAt`, ni `appDetails`. Lo único que toca fuera son las dos líneas de log de los volcados.

### 3.6 Claves i18n nuevas

Bajo `investigationPregnancyCondition`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `investigationPregnancyCondition.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente o no visible |
| `investigationPregnancyCondition.idRequired` | 400 del validador de `:id` |
| `investigationPregnancyCondition.medicalHistoryNotFound` | 404 cuando los antecedentes no existen, están sellados, o su investigación está inactiva |
| `investigationPregnancyCondition.diagnosticTermNotFound` | 404 con `source` externo y par `(source, code)` inexistente |
| `investigationPregnancyCondition.alreadyExists` | 409 cuando los antecedentes ya tienen una condición **activa** con el mismo término |
| `investigationPregnancyCondition.nameRequired` | 400 del validador cuando `conditionName` no llega en el `001`, o llega como `null` en el `004` |
| `investigationPregnancyCondition.stillActive` | 409 al purgar una condición que no fue retirada antes |
| `.createdSuccess` / `.createdFailed` | 201 y 500 del `001` |
| `.getSuccess` / `.getFailed` | 200 y 500 de `002A`, `002B` y `003` |
| `.updatedSuccess` / `.updatedFailed` | 200 y 500 del `004` |
| `.deletedSuccess` / `.deletedFailed` | 200 y 500 del `005A` |
| `.activatedSuccess` / `.activatedFailed` | 200 y 500 del `005B` |
| `.alreadyActive` / `.alreadyInactive` | 409 de `005B` y `005A` |
| `.purgeSuccess` / `.purgeFailed` | 200 y 500 del `005C` |

**Las validaciones de forma no generan clave propia.** El máximo de 500 caracteres de `conditionName`, el formato UUID de `investigationId` y el enumerado de `source` los responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `001`, `003` y `004`:

```
{ ok, message, data: {
    pregnancyConditionId, investigationId, diagnosticTermId,
    conditionRaw, sortOrder, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    diagnosticTerm: { diagnosticTermId, source, code, name, termGroup, isActive } | null
} }
```

`diagnosticTerm` se incluye siempre que exista la FK, con esos seis campos y **sin `metadata`**: lleva los marcadores internos de la resolución implícita —`autoCreated`, `reviewStatus`—, que son gobernanza del catálogo y no dato de la investigación. Es la decisión de F16 §3.7 y F27 §3.7, literal.

**El nombre que el cliente muestra es `conditionRaw ?? diagnosticTerm.name`.** No hay un tercer campo que lo resuelva, y ésa es la simplificación que el DDL impone. Cuando `conditionRaw` es `null`, el investigador escribió exactamente lo que dice el maestro.

En `002A` y `002B`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente.

**Nada de los antecedentes ni de la investigación viaja en la respuesta.** `medicalHistory` se consulta solo para la visibilidad heredada, con `attributes` acotados, y se descarta al construir el payload. Quien necesite los antecedentes entra por `ESAVI-INVMEDH-003`.

`sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura.** Añadir la fila `investigationPregnancyCondition | INVPREG` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en el orden alfabético que la tabla mantiene —entre `investigationMedicalHistory` e `investigationSource`—. **La tabla de operaciones no canónicas no se toca:** F33 no tiene `006`. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla contiene la fila nueva; `INVPREG` no aparece dos veces y no colisiona con `INVESTGN`, `INVMEDH`, `INVTEAM`, `INVSRC`, `INVAUT`, `NOTIFPRG` ni `PREGCOMP`; `git diff references/CONVENTIONS.md` muestra **una sola** fila añadida y ningún cambio en la tabla de operaciones no canónicas.

2. **El índice en `esaviapp.sql`.** `CREATE INDEX IF NOT EXISTS "IX_investigationPregnancyCondition_investigation" ON "investigationPregnancyCondition" ("investigationId");`, inmediatamente después del `CREATE TABLE` de `:1082`, con la forma de `IX_investigationTeamMember_investigation`.
   *Verificación:* `git diff esaviapp.sql` muestra **exactamente una línea añadida**; ejecutar el DDL completo sobre una base limpia no produce errores; el trigger de `sortOrder`, el índice único parcial, el `CHECK` y las dos FKs quedan intactos.

3. **Modelo y asociaciones.** `src/models/investigationPregnancyCondition.model.ts` con los siete atributos de datos y las seis transversales, `sortOrder` **sin `defaultValue`**, `conditionRaw` en `STRING(500)`. `src/models/associations/investigationPregnancyCondition.associations.ts` con los tres vínculos de §3.2. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` compila; una consulta manual `InvestigationPregnancyCondition.findAll({ include: ['medicalHistory', 'diagnosticTerm'] })` no lanza `EagerLoadingError`; el `belongsTo` de `investigationId` apunta a `InvestigationMedicalHistory` y **no** a `Investigation`; `InvestigationMedicalHistory.hasMany` existe con alias `pregnancyConditions` y no colisiona con ningún alias de F29, F30, F31 ni F32.

4. **Tipos y validadores.** `src/types/investigation/investigationPregnancyCondition.types.ts` con la única interfaz de §3.3, exportada por el barrel del dominio. `src/validators/investigationPregnancyCondition.validators.ts` con los cinco validadores —create, list por padre, id, update, activate—, registrado en el barrel.
   *Verificación:* `npm run build` compila; **no existe** ningún `UpdateInvestigationPregnancyConditionInput`; un `POST` sin `conditionName` responde 400 `common.validationError`; un `PUT` con `conditionName: null` responde 400; un `conditionName` de 501 caracteres responde 400; un `source` fuera del enumerado responde 400.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` pasa; `npx jest tests/i18n` pasa; ninguna clave existe en dos de los tres archivos.

6. **`ESAVI-INVPREG-001`.** Servicio, controlador y ruta. Transacción, guarda del padre, las tres ramas de resolución, los dos derivados, la guarda de duplicado, `fields: CREATE_FIELDS` y la entrada de auditoría.
   *Verificación:* un alta con solo `investigationId` y `conditionName` devuelve **201** con `diagnosticTermId: null`, `conditionRaw` con el texto y `sortOrder: 1` sobre unos antecedentes vacíos; la segunda alta recibe `sortOrder: 2`; con `conditionCode` nuevo y sin `source` se crea la fila en `diagnosticTerm` y `conditionRaw` queda `null` si el nombre coincide con el del maestro; con `source: 'MEDDRA'` y un código inexistente responde 404 `INVPREG_001_DIAGTERM_NOT_FOUND` **y no se crea ningún término**; sobre un `investigationId` sin fila de antecedentes, con la fila sellada, o con la investigación inactiva, responde 404 `INVPREG_001_MEDICAL_HISTORY_NOT_FOUND` en los tres casos, **también como SUPERADMIN**; repetir el mismo término activo responde 409 `INVPREG_001_ALREADY_EXISTS`; repetir el mismo texto **sin** código responde 201; `appDetails` tiene una entrada con `method: 'ESAVI-INVPREG-001'`; el `INSERT` emitido **no contiene la columna `sortOrder`**.

7. **`ESAVI-INVPREG-002A` y `002B`.** Los dos listados por `investigationId`, con la guarda del padre, `findAndCountAll`, orden por `sortOrder` y paginación.
   *Verificación:* el `002A` devuelve solo activas y el `002B` también las inactivas y las de `deletedAt` sellado; los dos devuelven `{ count, rows }` ordenados por `sortOrder` ascendente; unos antecedentes sin condiciones devuelven **200** con `{ count: 0, rows: [] }`; un `investigationId` sin fila de antecedentes devuelve **404**, también como SUPERADMIN; una investigación inactiva devuelve 404 para USER y ADMIN y **200** para SUPERADMIN; el `002B` con rol USER responde 403; `?limit=1&offset=1` devuelve la segunda fila con el `count` total; ningún parámetro de query distinto de `limit`, `offset` y `lang` altera el resultado.

8. **`ESAVI-INVPREG-003`.** Obtener por `pregnancyConditionId` con la cadena de dos saltos.
   *Verificación:* devuelve la forma de §3.7 con `diagnosticTerm` anidado o `null`; una condición inactiva responde 404 para USER y 200 para SUPERADMIN; una condición activa cuyos antecedentes están sellados responde 404 para USER y ADMIN y 200 para SUPERADMIN; lo mismo con la investigación inactiva; `sysDetails` no aparece en el payload.

9. **`ESAVI-INVPREG-004`.** Transacción, `stored` completo, la fórmula de `incomingName`, la re-resolución condicionada, la guarda de duplicado y `buildDifferentialUpdate` con la tabla de `candidates`.
   *Verificación:* la del bloque de update diferencial de §5, entera.

10. **`ESAVI-INVPREG-005A`.** Delegación en `setEntityActiveStatusService`.
    *Verificación:* sella `isActive: false` y `deletedAt`; repetir responde 409 `INVPREG_005A_ALREADY_INACTIVE`; **no comprueba el estado de los antecedentes ni de la investigación** —desactivar una condición de una investigación inactiva devuelve 200—; tras el `005A`, un alta nueva sobre los mismos antecedentes puede recibir el `sortOrder` liberado; `appDetails` crece con `method: 'ESAVI-INVPREG-005A'`.

11. **`ESAVI-INVPREG-005B`.** Transacción, detección de colisión de `sortOrder`, reasignación previa y delegación.
    *Verificación:* con dos condiciones en `sortOrder` 1 y 2, retirar la **2**, crear una nueva —que recibe `MAX(1) + 1 = 2` y colisiona con la retirada— y reactivar la retirada devuelve **200** y la deja en **`3`**, sin violar el índice único parcial; sin colisión conserva su número original; reactivar una fila ya activa responde 409 `INVPREG_005B_ALREADY_ACTIVE`; la reactivación **no** revalida la guarda de duplicado ni el estado de los padres; el rol mínimo es ADMIN y un USER recibe 403.

12. **`ESAVI-INVPREG-005C`.** `purgeEntityService` sin modificarlo.
    *Verificación:* purgar una condición activa responde 409 `INVPREG_005C_STILL_ACTIVE`; purgar una retirada la destruye y un `003` posterior responde 404; el `diagnosticTerm` que citaba **sigue existiendo**; el rol mínimo es SUPERADMIN; `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` y `diagnosticTermResolution.service.ts` no aparecen en `git diff`.

13. **El volcado de `ESAVI-INVMEDH-005C`.** Añadir el `count` y la línea `warn` en `purgeInvestigationMedicalHistoryService`, y sustituir el comentario de `investigationMedicalHistory.service.ts:633` que dice «once that table exists» por la referencia a este spec.
    *Verificación:* purgar unos antecedentes con tres condiciones —una de ellas sellada— escribe **una** línea `warn` con `3`; con cero condiciones **no escribe ninguna línea**; la purga **no se bloquea** en ningún caso; `git diff src/services/investigationMedicalHistory.service.ts` toca únicamente el `005C`, sin rozar el `004` ni la regla del bloque de embarazo.

14. **El volcado de `ESAVI-INVESTGN-005C`.** Quinta línea en `purgeInvestigationService`, después de la de `medicalHistory` que dejó F32.
    *Verificación:* purgar una investigación con antecedentes y condiciones escribe las cinco líneas en orden, la nueva la última; purgar una investigación sin antecedentes no escribe ninguna de las dos; `git diff src/services/investigation.service.ts` toca únicamente `purgeInvestigationService` y **no** las funciones `cascadeSeal*` de `:471-520`.

15. **Rutas y registro.** `src/routes/investigationPregnancyCondition.routes.ts` con las ocho en el orden de §3.4, montado en `src/routes/index.ts` bajo `/api/investigation-pregnancy-conditions`.
    *Verificación:* `GET /admin/investigation/<uuid>` alcanza el `002B` y no el `003`; `PATCH /activate/<uuid>` alcanza el `005B`; `DELETE /purge/<uuid>` alcanza el `005C`; ninguna literal cae en el validador de UUID del `:id`; el comentario `// Code: ESAVI-INVPREG-<NNN>` está en la ruta, el controlador y el servicio, y coincide con el `AppError` y con `appDetails.method` en los cinco lugares.

16. **Pruebas.** Ocho filas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y `tests/contract/investigationPregnancyCondition.test.ts` con el recorrido completo, siguiendo a `tests/contract/investigationTeamMember.test.ts`.
    *Verificación:* `npm run check` pasa entero —build, lint, `i18n:check` y jest—; la suite de roles cuenta las ocho rutas nuevas y ninguna queda sin regla; la de contrato cubre el alta, los dos listados, el `003`, los cinco escenarios de update diferencial de §5, el `005A`, el `005B` con colisión de `sortOrder`, el `005C` y los dos volcados.

---

## 5. Criterios de aceptación

**Del alta (`001`):**

1. `POST` con `investigationId` y `conditionName` sobre unos antecedentes vacíos y visibles → **201**, `diagnosticTermId: null`, `conditionRaw` con el texto, `notes: null`, `sortOrder: 1`, `isActive: true`. La segunda alta recibe `sortOrder: 2`.
2. El `INSERT` emitido **no contiene la columna `sortOrder`**. Verificable con `logging` de Sequelize en la suite.
3. `POST` con `conditionCode` inédito y sin `source` → 201, se crea la fila en `diagnosticTerm` con `source: 'LOCAL'`, y `conditionRaw` queda **`null`** si `conditionName` coincide con el nombre del maestro, o con el texto si difiere.
4. `POST` con `source: 'MEDDRA'` y un código que no existe → **404** `INVPREG_001_DIAGTERM_NOT_FOUND`, y `SELECT count(*) FROM "diagnosticTerm"` no ha cambiado.
5. `POST` sobre un `investigationId` **sin fila de antecedentes**, con la fila **sellada**, o con la **investigación inactiva** → **404** `INVPREG_001_MEDICAL_HISTORY_NOT_FOUND` en los tres casos, con el mismo mensaje, **también con token SUPERADMIN**.
6. `POST` de un término que ya tiene una condición **activa** en esos antecedentes → **409** `INVPREG_001_ALREADY_EXISTS`. Si la que lo tiene está **inactiva** → **201**.
7. `POST` del mismo texto dos veces **sin `conditionCode`** → **201** las dos, y quedan dos filas.
8. `POST` sobre unos antecedentes con `isPregnancyConfirmed` distinto de `'YES'`, `null` incluido → **201**. No hay guarda de coherencia.

**De los listados (`002A`, `002B`):**

9. El `002A` devuelve solo `isActive: true`; el `002B` devuelve también las inactivas y las de `deletedAt` sellado. Los dos, `{ count, rows }` ordenados por `sortOrder` ascendente.
10. Unos antecedentes visibles sin condiciones → **200** con `{ count: 0, rows: [] }`. Un `investigationId` sin fila de antecedentes → **404**, con cualquier rol.
11. Una investigación inactiva → **404** para USER y ADMIN, **200** para SUPERADMIN. El `002B` con rol USER → **403**.
12. `?limit=1&offset=1` devuelve la segunda fila y el `count` total, no `1`.

**De la lectura (`003`):**

13. Devuelve la forma exacta de §3.7. `diagnosticTerm` con **seis** campos y **sin `metadata`**; `sysDetails` no aparece.
14. Los tres motivos de invisibilidad —condición inactiva, antecedentes sellados, investigación inactiva— responden **404** para USER y ADMIN y **200** para SUPERADMIN, cada uno por separado y combinados.

**Del update diferencial (`004`) — el bloque de SPEC F12, entero:**

15. **Un `PUT` con el body idéntico a lo guardado no escribe nada.** Ni `UPDATE`, ni `updatedAt`, ni entrada nueva en `appDetails`, ni evento en `sysDetails`. Verificable comparando `updatedAt` y `jsonb_array_length("appDetails")` antes y después: los dos idénticos.
16. **Reenviar íntegra la respuesta del `GET` no escribe nada**, incluida una fila con `conditionRaw` divergente del nombre del maestro. Es la trampa que la fórmula de `incomingName` cubre: el nombre efectivo que el `GET` mostró vuelve como una clave ausente, no como una reescritura.
17. **Un `PUT` que cambia un solo campo escribe ese campo y nada más.** `appDetails` crece en **exactamente una** entrada, con `method: 'ESAVI-INVPREG-004'`, y el historial anterior se conserva íntegro.
18. **La escritura la dispara el cambio de valor, no la presencia de la clave.** Un `PUT` con `conditionCode` igual al que produjo el término guardado **no consulta ni escribe `diagnosticTerm`** —`SELECT count(*)` sobre el maestro no cambia y `updatedAt` de la condición tampoco—. Un `conditionCode` distinto sí re-dispara la resolución.
19. **Los campos inmutables se ignoran en silencio.** Un `PUT` con `investigationId` de otra investigación o con `sortOrder: 99` devuelve **200**, no 400, y ninguno de los dos cambia en la base.
20. `notes` es anulable: `notes: null` explícito la borra y **sí** cuenta como diferencia; `notes` ausente la deja como estaba. `conditionName: null` es **400** del validador y nunca llega al servicio.
21. Cuando el diff vuelve vacío, la respuesta es **200** con la fila tal cual, no 304 ni 204.
22. Un `PUT` que resuelve a un término que ya tiene otra condición activa en esos antecedentes → **409** `INVPREG_004_ALREADY_EXISTS`, y la propia fila queda excluida de la comprobación.

**De la activación (`005A`, `005B`):**

23. `005A` sella `isActive: false` y `deletedAt`, **sin comprobar el estado de los antecedentes ni de la investigación**: retirar una condición de una investigación inactiva devuelve **200**. Repetir → 409 `INVPREG_005A_ALREADY_INACTIVE`.
24. **El escenario de colisión de `sortOrder`, entero:** con dos condiciones en `1` y `2`, retirar la **`2`**, crear una nueva —que recibe `MAX(1) + 1 = 2`— y reactivar la retirada → **200**, y la reactivada queda en **`3`**. El índice único parcial no se viola y ninguna de las tres filas comparte número.
25. Sin colisión, el `005B` conserva el `sortOrder` original. Reactivar una fila ya activa → 409 `INVPREG_005B_ALREADY_ACTIVE`. El rol mínimo es **ADMIN**; un USER recibe 403.
26. El `005B` **no** revalida la guarda de duplicado: reactivar puede dejar dos condiciones activas con el mismo término. Es consecuencia asumida y declarada en §6.

**De la purga (`005C`) y los dos volcados:**

27. Purgar una condición **activa** → **409** `INVPREG_005C_STILL_ACTIVE`. Purgar una retirada la destruye, y un `003` posterior → 404. El `diagnosticTerm` que citaba **sigue existiendo**.
28. `ESAVI-INVMEDH-005C` sobre unos antecedentes con tres condiciones —una sellada— escribe **una** línea `warn` con el conteo `3` y **no se bloquea**. Con cero condiciones no escribe ninguna línea.
29. `ESAVI-INVESTGN-005C` escribe **cinco** líneas `warn` cuando hay las cuatro satélites y las condiciones, la nueva la última y después de la de `medicalHistory`.

**De la forma y del canon:**

30. El código `ESAVI-INVPREG-<NNN>` es **idéntico** en los cinco lugares —ruta, controlador, servicio, `AppError` y `appDetails.method`— en las ocho operaciones.
31. `npm run check` pasa entero. `npm run i18n:check` no reporta claves huérfanas y `tests/auth/roles.test.ts` cubre las ocho rutas nuevas.
32. `git diff` **no toca** `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts`, `diagnosticTermResolution.service.ts`, ni ninguna parte de `investigation.service.ts` fuera de `purgeInvestigationService`, ni de `investigationMedicalHistory.service.ts` fuera de su `005C`.
33. `esaviapp.sql` crece en **una sola línea**, la del índice.

---

## 6. Decisiones tomadas y descartadas

**Sin guarda de coherencia contra `isPregnancyConfirmed`.** Cargar una condición sobre unos antecedentes que no declaran el embarazo confirmado devuelve 201.

- **Sí:** la regla del bloque de embarazo vive entera en F32 §3.5, que ya decide qué pasa con sus nueve campos gestacionales cuando el bloque se cierra. Replicarla aquí crearía **dos fuentes de verdad para la misma regla**, y la segunda quedaría desincronizada en cuanto la primera cambiara. Es la decisión literal de F27 frente a `hasComplications`, y por la misma razón.
- **No:** 409 cuando `isPregnancyConfirmed !== 'YES'`. Suena a integridad y es una trampa de orden: el investigador que rellena el formulario de arriba abajo cargaría las condiciones antes de haber guardado la bandera, y recibiría un 409 por una secuencia de captura perfectamente razonable.
- **Tampoco:** que el `004` de F32 retire estas filas al cerrar el bloque. Sería una cascada de estado disparada por un update, escrita en el servicio del padre, sobre una tabla con `isActive` propio — exactamente lo que F31 §1.A razonó que no debe pasar. Las condiciones ya cargadas sobreviven al cierre y se retiran a mano con el `005A`.

**El `005C` de los antecedentes no se bloquea. Se vuelca.** Es la respuesta a la pregunta que F32 §7 dejó por escrito.

- **Sí:** volcado `warn` con el conteo, y la purga sigue. Quien la ejecuta es SUPERADMIN sobre unos antecedentes ya sellados; un bloqueo le obligaría a purgar en dos pasos con la única ventaja de un aviso que el log ya da. Es la línea de F13, F29, F30, F31 y F32, y romperla aquí dejaría el repositorio con dos criterios distintos para la misma situación.
- **No:** 409 cuando haya condiciones registradas. Además del argumento de arriba, el bloqueo sería **incompleto**: `ESAVI-INVESTGN-005C` destruye estas filas por el mismo `CASCADE` sin pasar por el servicio de los antecedentes, así que la puerta cerrada tendría una ventana abierta al lado.

**Dos volcados y no uno.** El de segundo salto en `investigation.service.ts` cuesta un `count` con el mismo UUID —la PK compartida de los antecedentes lo regala— y es lo único que deja rastro de una destrucción que hoy es completamente silenciosa. F27 sentó el precedente al añadir su línea de tercer salto a `notification.service.ts`.

**Conteo y no snapshot por fila.** Es el criterio de F31: una lista de veinte condiciones enterraría bajo veinte líneas la que importa. F29, F30 y F32 vuelcan snapshot porque son uno a uno y caben en una línea.

**Sin `006`.** Se entra por `/investigation/:id`, y ese `:id` es el que `ESAVI-INVESTGN-006` ya devuelve a partir del `caseId`.

- **Sí:** la decisión de F27 y F24. Un `006` por caso duplicaría la cadena de guardas —caso, investigación, antecedentes— para ahorrar una llamada que el cliente ya hace.
- **No:** la simetría con F31, F29, F30 y F32, que sí lo tienen. La simetría es real y se rompe a conciencia: en aquéllas el `investigationId` no aparece en ninguna respuesta previa que el cliente tenga a mano, y aquí sí.

**La guarda de duplicado es solo el término, y solo contra activas.**

- **Sí:** F27 comparaba el par `(diagnosticTermId, complicationTypeItemId)` porque tenía catálogo de tipo. Aquí no lo hay, así que el par se reduce a uno. Y compara contra **activas** porque una condición retirada no debe bloquear volver a cargar la misma: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`.
- **La consecuencia asumida:** un `005B` puede dejar dos condiciones activas con el mismo término, porque la reactivación no revalida la guarda. Se acepta a cambio de que reactivar siga siendo lo que dice ser —deshacer una desactivación— y no una segunda alta encubierta que pueda fallar por el estado de filas ajenas. Es la decisión de F27 §6 y de F31 §6, literal.
- **Y lo que no cubre:** dos condiciones de texto libre con el mismo texto no colisionan. Está en §7.

**`005B` en ADMIN y no en SUPERADMIN.** La matriz canónica de §9 pone la activación en SUPERADMIN porque supone una delegación trivial. Aquí no lo es: lleva reasignación de `sortOrder` dentro de una transacción, y es una operación de administración del caso, no de administración del sistema. Es el precedente de F27 y F31.

**Sin cifrado.** `conditionRaw` es un término clínico —«diabetes gestacional»—, no un identificador de persona. Cifrarlo con `esaviCrypt` haría inútil cualquier búsqueda futura por texto y no protegería nada que el resto de la investigación no exponga ya. Es la línea de F27 y la contraria a `appUser`.

**La guarda del padre falla también para SUPERADMIN en el `001` y en las comprobaciones 1 y 2 de los listados.** `canViewInactive` relaja la **visibilidad**, no la **existencia**: unos antecedentes que no existen no tienen condiciones que listar bajo ningún rol, y unos sellados no reciben filas nuevas ni siquiera de quien puede verlos. Lo que sí se relaja para SUPERADMIN es el `isActive` de la investigación, que es estado y no existencia.

**El eslabón intermedio se comprueba por `deletedAt`.** No hay alternativa: `investigationMedicalHistory` no tiene `isActive`, y es la primera vez que una cadena de visibilidad del repositorio atraviesa una tabla sin estado propio. El `paranoid: false` del `include` es lo que permite ver la fila sellada en vez de que el `include` la esconda y convierta un 404 explicado en un 404 mudo.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El nombre de la columna `investigationId` invita a asociarla con `Investigation`.** Un `belongsTo` mal escrito compilaría, y el `include` funcionaría —el UUID es el mismo— hasta el día en que existan antecedentes sin investigación o al revés | §3.2 lo declara explícitamente y el paso 3 del plan lo verifica por su nombre. La guarda del `001` sobre unos antecedentes inexistentes con investigación viva es el caso que lo destapa, y está en los criterios 5 y 10 |
| **Dos condiciones de texto libre con el mismo texto no colisionan.** La guarda compara `diagnosticTermId`, así que cargar «diabetes gestacional» dos veces sin código produce dos filas | Asumido y declarado en §2. Deduplicar texto libre exige normalizar acentos y decidir umbrales de parecido; es lo mismo que F31 §7 dejó abierto para `fullName`, y no se resuelve aquí |
| **La rama `LOCAL` acuña términos al vuelo**, así que un código mal escrito crea un `diagnosticTerm` nuevo en vez de fallar | Es el diseño de F15, no un efecto de este spec: el término nace con `autoCreated` y `reviewStatus` en su `metadata`, precisamente para que la gobernanza del catálogo lo revise después |
| **La reasignación del `005B` manda la condición al final de la lista**, y el orden que el investigador había dado se pierde | Es el mismo comportamiento de F16, F27 y F31. El `007` de reordenación, fuera de alcance, es lo que lo resolverá; hasta entonces el orden se corrige retirando y volviendo a cargar |
| **El `005A` libera el `sortOrder` y otra condición puede tomarlo**, de modo que dos filas —una viva, una retirada— comparten número hasta que el `005B` lo arregle | Es la razón de ser del `005B` con reasignación, y el índice único parcial no se viola porque la retirada está fuera de él. Criterio 24 |
| **La purga de una investigación destruye las condiciones sin auditoría**, dos saltos más abajo y fuera de todo servicio | El volcado `warn` es la única mitigación posible sin bloquear, y es la que este spec añade. Declarado en §6 |

---

## Lo que **no** está en este spec

- Cualquier guarda de coherencia entre las condiciones y el `isPregnancyConfirmed` de sus antecedentes, en cualquiera de los dos sentidos.
- Que el cierre del bloque de embarazo en `ESAVI-INVMEDH-004` retire, borre o toque estas filas.
- Bloquear `ESAVI-INVMEDH-005C` o `ESAVI-INVESTGN-005C` cuando existan condiciones.
- Las otras diez satélites de `investigation`: `investigationCovidHistory`, `investigationClinicalEvaluation`, `evaluationInstitution`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- Reordenar condiciones — el `007` que F16, F27 y F31 dejaron abierto.
- Aceptar `diagnosticTermId` directo del cliente.
- Un `006` por `caseId`.
- Filtros de listado por término o por texto.
- Deduplicar condiciones de texto libre.
- Incluir las condiciones en la respuesta de `investigationMedicalHistory`.
- Cifrar `conditionRaw` o cualquier otro campo.
- Modificar `esaviapp.sql` más allá del índice, ni `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` o `diagnosticTermResolution.service.ts`.
- Extraer `normalizeText` a un helper compartido.
- Exponer o editar `sysDetails`.
