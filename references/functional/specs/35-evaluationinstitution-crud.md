# SPEC F35 — CRUD de `evaluationInstitution`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F34 (`investigationClinicalEvaluation` — dependencia dura de modelo: es el padre de la FK, y quien declaró por escrito que esta tabla tendría su propio spec)**, **SPEC F33 (`investigationPregnancyCondition` — gemela estructural: la otra nieta del bloque de investigación, aporta la cadena de dos saltos con el estado solo en el segundo)**, **SPEC F31 (`investigationTeamMember` — hermana de forma: aporta la colección con `isActive` que ninguna cascada pisa y la decisión de no aplicar `toTitleCase` a `institutionName`)**, **SPEC F04 y SPEC F05 (patrón de cifrado PII sobre `appUser` y `patient`)**, SPEC F09 (`healthFacility` — maestro de la FK), SPEC F02 (`catalogItem` — maestro de la FK de tipo), SPEC F16 (`notificationEvent` — origen del hallazgo del `sortOrder` en el `005B`), SPEC F28 (`investigation` — su volcado de purga gana una línea), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa)
> **Fecha:** 2026-08-24
> **Objetivo:** Dar de alta `evaluationInstitution` —las instituciones que participaron en la evaluación clínica del paciente investigado, con su contacto— como la **segunda nieta del bloque de investigación** y la primera que cuelga de `investigationClinicalEvaluation`.

---

## 1. Por qué existe este spec

`evaluationInstitution` guarda **cada institución que evaluó clínicamente al paciente**: una lista de N filas ordenadas por institución, cada una con su establecimiento del maestro cuando existe o con el nombre libre cuando no, más el nombre y el contacto de la persona que atendió y el tipo de institución tomado del catálogo.

Hoy la tabla existe en `esaviapp.sql:1111-1130` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta. [F34](./34-investigationclinicalevaluation-crud.md) la nombra ocho veces, la declara fuera de alcance en su §2 y §6, y deja escrito en `investigationClinicalEvaluation.service.ts:611` el comentario que este spec viene a sustituir: *«ON DELETE CASCADE every evaluationInstitution of that investigation, when that table exists»*.

**Es la segunda nieta del bloque, y la primera que cuelga de la evaluación clínica.** `CONVENTIONS.md` la lista entre las catorce satélites de `investigation`, y el listado vuelve a engañar igual que con F33: `FK_evaluationInstitution_clinicalEvaluation` (`:1127`) apunta a `investigationClinicalEvaluation("investigationId")`, no a `investigation("investigationId")`. De ahí salen los cuatro rasgos que la separan.

**A — Su padre no tiene estado propio, exactamente como en F33.** `investigationClinicalEvaluation` es una de las cinco tablas del repositorio sin `isActive`: lo único que puede estar sellado en ella es el `deletedAt`, y su estado real vive un salto más arriba, en `investigation.isActive`. La cadena de visibilidad heredada es de **dos saltos con el estado solo en el segundo** —`institution → clinicalEvaluation → investigation`—, la misma forma que F33 estrenó y la segunda vez que aparece.

**B — Su `sortOrder` es nullable y sin `DEFAULT 0`, y es la única de las nueve del bucle que lo es.** `esaviapp.sql:1114` declara `"sortOrder" smallint CHECK ("sortOrder" IS NULL OR "sortOrder" >= 0)`: sin `NOT NULL` y sin default, frente al `smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0)` de sus ocho hermanas. `setSortOrderByParent` acepta `NULL` como «asígnamelo tú» —el comentario del DDL en `:1310` lo dice: *«If sortOrder is NULL or 0»*—, así que **aquí la trampa de F16 no aplica**: el modelo declara `allowNull: true` sin `defaultValue`, el `INSERT` puede llevar la columna en `NULL` y el trigger la resuelve. **Este spec no necesita `CREATE_FIELDS`**, y es el primero de la familia que no lo lleva.

**C — Arrastra el hallazgo del `005B` de F16, y es la octava vez.** Figura en el bucle `setSortOrderByParent` con `investigationId` como padre (`:1324`) y tiene índice único parcial `UQ_evaluationInstitution_parent_sortOrder` sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1360-1362`). El trigger es `BEFORE INSERT` solamente, y `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número: reactivar una institución cuyo `sortOrder` ya lo tomó otra hermana viva revienta el índice. F16 lo descubrió; F21, F22, F24, F27, F31 y F33 lo arrastraron; aquí vuelve entero, con el matiz de que el índice **también** excluye las filas de `sortOrder IS NULL`, que aquí sí pueden existir.

**D — Es la primera nieta con FKs a dos maestros, y con PII cifrada.** Sus tres claves foráneas —a `investigationClinicalEvaluation`, a `healthFacility` y a `catalogItem`— la separan de F33, que solo tenía la del padre y la del término clínico. Y sus dos columnas de persona, `personName` (`:1117`) y `personContact` (`:1118`), son PII directa: se cifran con `esaviCrypt`, siguiendo al pie de la letra lo que su propio padre hace con `clinicalDetailsPersonName` (`investigationClinicalEvaluation.service.ts:280-282`). **Es la primera colección del repositorio con columnas cifradas**, lo que obliga a descifrar fila por fila en los dos listados.

**Y dos rasgos que no la separan, heredados de F31 y F33 y verificados en el código:** ninguna cascada de estado la toca —`investigation.service.ts:514` deja fuera del `cascadeSealSatellite` a las satélites con `isActive`—, así que ni `ESAVI-INVESTGN-005A` ni `ESAVI-CASE-005A` le sellan el `deletedAt`; y no existe `TRG_evaluationInstitution_setUpdatedAt`, así que `updatedAt` lo escribe la aplicación.

**Y una tabla de la que no cuelga nada.** Es hoja del grafo: `grep 'REFERENCES "evaluationInstitution"' esaviapp.sql` no devuelve nada. Su `005C` no lleva volcado de cascada.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `evaluationInstitution`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones y ninguna más:** `001` crear, `002A` listar activas por investigación, `002B` listar todas por investigación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar y `005C` borrado físico. **Sin `006` en ninguna forma** — se entra por el `investigationId`, que es a la vez la PK de la evaluación clínica y la de la investigación, y que `ESAVI-INVCLIEV-006` ya devuelve a partir del `caseId`. Es la decisión de F24, F27 y F33, y por tanto **F35 no añade fila a la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6**.
- **Listado por padre, no global.** `002A` en `GET /investigation/:investigationId` para USER devuelve solo las instituciones activas; `002B` en `GET /admin/investigation/:investigationId` para ADMIN las devuelve todas, incluidas las de `deletedAt` sellado. **Sin ningún filtro por query**, ordenadas por `sortOrder` ascendente y paginadas con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. El resto se entra por `evaluationInstitutionId`. Nunca por `/`.
- **Guarda del alta, con tres motivos y un solo 404** `EVALINST_001_CLINICAL_EVALUATION_NOT_FOUND`: la evaluación clínica no existe, está sellada (`deletedAt` no nulo) o su investigación está inactiva. Una sola consulta sobre `investigationClinicalEvaluation` con `paranoid: false` e `include` de `investigation`. Los tres motivos comparten código y mensaje: al investigador no le sirve distinguirlos, y el eslabón que falta está en los tres casos un nivel más arriba.
- **La misma guarda en los dos listados**, con `EVALINST_002A_CLINICAL_EVALUATION_NOT_FOUND` y `EVALINST_002B_CLINICAL_EVALUATION_NOT_FOUND`. **Una evaluación sin instituciones devuelve 200 con `{ count: 0, rows: [] }`; una evaluación que no existe devuelve 404.**
- **Visibilidad heredada en cadena de dos saltos, con el estado solo en el segundo.** Toda lectura incluye `clinicalEvaluation` y, a través de ella, `investigation`: si la evaluación está sellada **o** la investigación está inactiva, la institución responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`). Aplica a `002A`, `002B`, `003` y `004`. **No aplica a `005A`, `005B` ni `005C`**, que actúan sobre el estado propio de la fila, por el criterio de F31 y F33.
- **Regla de identificación en `001` y `004`: `healthFacilityId` o `institutionName`, al menos uno.** Un alta sin ninguno de los dos es **400** `EVALINST_001_IDENTIFICATION_REQUIRED`. En el `004` la regla se evalúa **sobre el estado resultante**, no sobre el body: vaciar el único de los dos que había es 400; vaciar uno cuando el otro sobrevive es 200.
- **Los dos identificadores conviven.** Cuando llega `healthFacilityId`, `institutionName` **se guarda igual** si el investigador lo escribió: no hay columna donde denormalizar el nombre del maestro, y borrar el texto perdería información. El cliente muestra `institutionName ?? healthFacility.name`. Es la forma de F33 con `conditionRaw`, sin su lógica de divergencia: aquí **no se compara** el texto contra el nombre del establecimiento ni se anula por coincidir.
- **Validación de `healthFacilityId` en `001` y `004`**: el establecimiento debe existir y estar **activo** → 404 `EVALINST_<op>_HEALTH_FACILITY_NOT_FOUND`. Con la forma de `assertHealthFacilityIsValid` de `esaviCase.service.ts:116-125`.
- **Validación de `evaluationInstitutionTypeItemId` en `001` y `004`**, con el doble salto: el ítem debe existir, estar **activo** y pertenecer al `catalogType` de `code` **`evaluationInstitutionType`** → 404 `EVALINST_<op>_INSTITUTION_TYPE_NOT_FOUND`. Es `assertCatalogItemIsValid` de `investigationMedicalHistory.service.ts:222-246`, literal. La FK del DDL apunta a `catalogItem` sin distinguir el tipo, y ese filtro es la **única** defensa contra un ítem de `sex` almacenado como tipo de institución.
- **Siembra del catálogo `evaluationInstitutionType` en `esaviapp.sql`**, cinco líneas `CALL "upsertCatalogItem"(...)` junto a las de `healthFacilityType` (`:1582-1586`): `HOSPITAL`, `HEALTH_CENTER`, `LABORATORY`, `PRIVATE_PRACTICE` y `OTHER`, con `sortOrder` 1 a 5. El procedimiento es idempotente por `ON CONFLICT`.
- **Guarda de duplicado**, en `001` y `004`: el `healthFacilityId` no puede repetirse entre las instituciones **activas** de la misma evaluación → 409 `EVALINST_<op>_ALREADY_EXISTS`. **Solo corre cuando `healthFacilityId` tiene valor**: dos instituciones de texto libre son registros distintos. No está respaldada por ninguna restricción de base —no hay `UNIQUE` en el DDL—: es regla de negocio del servicio. **El `005B` no la revalida**, y el duplicado por reactivación es consecuencia asumida, razonada en §6.
- **Cifrado de `personName` y `personContact` con `esaviCrypt`**, siguiendo a F34 (`investigationClinicalEvaluation.service.ts:280-282`) y a F04/F05. Se descifran con `esaviDecrypt` en las **cinco** operaciones que devuelven la fila, **listados incluidos**, así que el ciphertext nunca cruza la frontera HTTP. En el `004` se comparan **sobre texto plano** y `esaviCrypt` se aplica **después** del diff. **Es la primera colección del repositorio con columnas cifradas**, y por eso el descifrado en los listados es fila por fila.
- **`investigationId` y `sortOrder` inmutables**, ignorados en silencio en el `004`, sin 400. Una institución no se traslada entre evaluaciones y su orden lo gobierna la base.
- **`sortOrder` asignado por la base, y sin `CREATE_FIELDS`.** La columna es `NULL`-able y sin `DEFAULT 0` (`:1114`), y `setSortOrderByParent` trata el `NULL` como «asígnamelo tú». El modelo la declara `allowNull: true` sin `defaultValue`, el `INSERT` la lleva en `NULL` y el trigger la resuelve. **Es el primer spec de la familia que no necesita la lista explícita de campos** que F16 §3.2 impuso.
- **Reasignación de `sortOrder` en `ESAVI-EVALINST-005B`** cuando el número que ocupaba la fila ya lo tomó otra institución viva de la misma evaluación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación no delega sin más en `setEntityActiveStatusService`.
- **Normalización al escribir:** `trim()` sobre `institutionName`, `personContact` y `notes`; `toTitleCase(trim())` sobre `personName` **antes** de cifrar. **`institutionName` no lleva `toTitleCase`, deliberadamente** — es la decisión de F31 (`investigationTeamMember.service.ts:159-163`): «MINSAL no debe volverse Minsal».
- **Sin cascada de estado desde ningún padre.** Ni `ESAVI-INVCLIEV-*`, ni `ESAVI-INVESTGN-005A`, ni `ESAVI-CASE-005A` tocan estas filas: `investigation.service.ts:514` deja fuera del `cascadeSealSatellite` a las satélites con `isActive`. **`satelliteCascade.service.ts` no se toca.**
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — deliberado: el hueco queda para la siguiente institución.
- **`005C` sin volcado de cascada**, porque no hay nada que arrastrar. Guarda canónica: la fila debe estar en `isActive: false` → si no, 409. La aporta `purgeEntityService` tal cual, que aquí **sí es efectivo** porque la columna existe.
- **Dos volcados `warn` en dos archivos ajenos, y ningún bloqueo:**
  - `investigationClinicalEvaluation.service.ts` — `ESAVI-INVCLIEV-005C` gana el conteo de `evaluationInstitutionId` que su `ON DELETE CASCADE` destruye, con `paranoid: false`. **Sustituye el comentario de `:611`** que dice «when that table exists».
  - `investigation.service.ts` — `ESAVI-INVESTGN-005C` gana su **séptima** línea, la segunda de **segundo salto**, junto a las seis que dejaron F29, F30, F31, F32, F33 y F34.

  Los dos son conteo y no volcado por fila, por el criterio que F31 fijó para las colecciones — y aquí además es obligatorio: un snapshot por fila escupiría PII cifrada al log.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5: dos inmutables que no entran, dos cifrados que se comparan en claro y cinco anulables.
- **Dos añadidos a `esaviapp.sql` y nada más:** el índice `IX_evaluationInstitution_investigation` sobre `("investigationId")` —el parcial de `:1360-1362` no sirve para el `002B`, que lee también filas con `deletedAt` sellado— y las cinco `CALL` de la siembra.
- Alta de la abreviatura **`EVALINST`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/evaluationInstitution.test.ts`.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F34** debe estar `Implementado` —lo está—. `investigationClinicalEvaluation` es el padre de la FK: sin una fila suya no puede existir ninguna institución, y su ausencia es el 404 del `001`.
- **`healthFacility` debe tener datos cargados** para poder referenciar establecimientos del maestro. Un alta con solo `institutionName` no lo necesita.
- **El catálogo `evaluationInstitutionType` lo siembra este spec**, así que no es precondición externa. Sí lo es haber ejecutado el DDL actualizado antes de probar el `001` con tipo.

**Fuera de alcance (otros specs):**

- **Denormalizar el nombre del establecimiento en `institutionName`.** No hay columna para ello y no se inventa ninguna: el nombre del maestro se lee del `include`, y `institutionName` guarda solo lo que el investigador escribió.
- **Cualquier regla de coherencia entre `healthFacilityId` e `institutionName`.** Mandar los dos con textos que no se parecen devuelve **201**, no 409. Comparar nombres exige normalizar acentos y decidir umbrales de parecido; no se resuelve aquí.
- **Cualquier guarda contra los campos de la evaluación clínica padre** — `receivedMedicalAttention`, `sourceExam` y compañía. Cargar una institución sobre una evaluación que declara `receivedMedicalAttention: 'NO'` devuelve **201**. La regla del bloque vive entera en F34 §3.5 y replicarla aquí duplicaría la fuente de verdad. Es la decisión de F27 y F33, razonada en §6.
- **Bloquear `ESAVI-INVCLIEV-005C` o `ESAVI-INVESTGN-005C`** cuando haya instituciones registradas. Se deja disparar la cascada de Postgres, con el volcado al log como única mitigación.
- **Las otras seis satélites de `investigation`:** `investigationCovidHistory` (`esaviapp.sql:1014-1036`), `investigationVaccinationContext` (`1132-1154`), `investigationVaccineAdministered` (`1156-1171`), `investigationColdChain` (`1173-1196`), `investigationAdministrationError` (`1198-1233`) e `investigationCommunity` (`1235-1254`).
- **Reordenar instituciones** — un `007` que mueva una de posición y desplace a sus hermanas. Es lo que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. Su propio spec, y el mismo que F16, F27, F31 y F33 dejaron abierto.
- **Un `006` por `caseId` o por `investigationId`.** Se entra por `/investigation/:id`, y ese `:id` es el que `ESAVI-INVCLIEV-006` ya devuelve a partir del caso.
- **Cualquier filtro de listado** por `healthFacilityId`, por tipo o por texto. Los dos listados devuelven todas las instituciones de su evaluación, paginadas y ordenadas por `sortOrder`.
- **Buscar u ordenar por `personName` o `personContact`.** Es **imposible** mientras estén cifradas, y así se declara: un `ORDER BY` sobre una columna cifrada ordena ciphertext. Es la misma limitación que F34 §3.5 dejó escrita para `clinicalDetailsPersonName`.
- **Deduplicar instituciones de texto libre.** La guarda compara `healthFacilityId` y nada más; dos instituciones sin establecimiento no colisionan aunque el texto sea idéntico. Lo que no cubre queda en §7.
- **Incluir las instituciones en la respuesta de `investigationClinicalEvaluation`.** El contrato de F34 no cambia: el `hasMany` se declara para el volcado, no para el payload.
- **Modificar `esaviapp.sql`** más allá del índice y las cinco `CALL`: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`, ni las tres FKs —incluida la que hace de esta tabla una nieta y no una satélite—.
- **Modificar `purgeEntityService`, `setEntityActiveStatusService` ni `satelliteCascade.service.ts`.**
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la enésima copia. La deuda que F24 §7 declaró vencida sigue vencida.
- Crear instituciones automáticamente al dar de alta una evaluación clínica.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`evaluationInstitution` — `esaviapp.sql:1111-1130`. Se le añade **un índice y nada más**; la siembra del catálogo va aparte, al final del fichero.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `evaluationInstitutionId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` (`:1112`) |
| `investigationId` | `uuid` | no | `FK_evaluationInstitution_clinicalEvaluation` → **`investigationClinicalEvaluation("investigationId")`**, `ON DELETE CASCADE` (`:1113`, `:1127`). **Sin `UNIQUE`** → uno a muchos |
| `sortOrder` | `smallint` | **sí** | `CHECK ("sortOrder" IS NULL OR "sortOrder" >= 0)` (`:1114`). **Sin `NOT NULL` y sin `DEFAULT`.** Lo asigna el trigger; la aplicación no lo envía |
| `healthFacilityId` | `uuid` | sí | `FK_evaluationInstitution_facility` → `healthFacility`, `ON DELETE RESTRICT` (`:1115`, `:1128`) |
| `institutionName` | `varchar(250)` | sí | Solo `trim()` — **sin `toTitleCase`** (`:1116`) |
| `personName` | `varchar(250)` | sí | **Cifrada** con `esaviCrypt`, sobre `toTitleCase(trim())` (`:1117`) |
| `personContact` | `varchar(250)` | sí | **Cifrada** con `esaviCrypt`, sobre `trim()` (`:1118`) |
| `evaluationInstitutionTypeItemId` | `uuid` | sí | `FK_evaluationInstitution_type` → `catalogItem`, `ON DELETE RESTRICT` (`:1119`, `:1129`) |
| `notes` | `text` | sí | Solo `trim()` (`:1120`) |

**El nombre de la columna FK engaña, igual que en F33.** Se llama `investigationId` y **no apunta a `investigation`**: apunta a la PK de `investigationClinicalEvaluation`, que resulta ser el mismo UUID porque aquella tabla comparte clave con su padre. El valor sirve para las dos consultas, pero la existencia que hay que comprobar es la de la **evaluación clínica**, no la de la investigación: una investigación viva sin fila de evaluación no admite instituciones.

**El `sortOrder` es la anomalía de esta tabla.** Es la **única** de las nueve del bucle `setSortOrderByParent` declarada `NULL`-able y sin `DEFAULT 0`; las ocho restantes llevan `smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0)`. La consecuencia práctica está en §3.2 y es buena: aquí no hace falta `CREATE_FIELDS`.

**Restricciones.** Tres claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla.** La única unicidad de base vive fuera, en el índice parcial `UQ_evaluationInstitution_parent_sortOrder` sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1360-1362`). Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `C` de §1; que excluya además `sortOrder IS NULL` es un matiz que aquí sí puede darse. **La guarda de duplicado sobre `healthFacilityId` no está respaldada por nada**: es regla de negocio del servicio.

**Los dos `ON DELETE RESTRICT` sí son efectivos, y es la diferencia con F33.** `healthFacility` y `catalogItem` figuran ambos en el bucle `preventPhysicalDelete` (`:1374-1378`) y no tienen `005C`, así que nunca llega a intentarse el borrado que la restricción bloquearía. La restricción es real pero inalcanzable, exactamente como el `RESTRICT` hacia `diagnosticTerm` en F33.

**Las columnas transversales.** Están las seis: `isActive` (`:1121`), `createdAt` (`:1122`), `updatedAt` (`:1123`), `deletedAt` (`:1124`), `sysDetails` (`:1125`) y `appDetails` (`:1126`).

**Triggers. Dos.** `TRG_evaluationInstitution_setSysDetails`, del bucle genérico. Y `TRG_evaluationInstitution_setSortOrder`, del bucle de orden (`:1324`), que ejecuta `setSortOrderByParent('investigationId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si es `NULL` **o `0`**, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre, bajo `pg_advisory_xact_lock`. **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `:1374-1378`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

**Hoja del grafo.** `grep 'REFERENCES "evaluationInstitution"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

**Las dos líneas que se añaden al DDL.**

1. `CREATE INDEX IF NOT EXISTS "IX_evaluationInstitution_investigation" ON "evaluationInstitution" ("investigationId");`, inmediatamente después del `CREATE TABLE` de `:1130`, con la forma de `IX_investigationTeamMember_investigation` (`:1015`). El parcial de `:1360-1362` no cubre el `002B`, que lee también filas con `deletedAt` sellado.
2. Las cinco `CALL "upsertCatalogItem"('evaluationInstitutionType', 'Evaluation institution type', …)` al final del bloque de siembra, junto a las de `healthFacilityType` (`:1582-1586`):

```
CALL "upsertCatalogItem"('evaluationInstitutionType', 'Evaluation institution type', 'HOSPITAL',         'Hospital',         'HOSPITAL',         1);
CALL "upsertCatalogItem"('evaluationInstitutionType', 'Evaluation institution type', 'HEALTH_CENTER',    'Health center',    'HEALTH_CENTER',    2);
CALL "upsertCatalogItem"('evaluationInstitutionType', 'Evaluation institution type', 'LABORATORY',       'Laboratory',       'LABORATORY',       3);
CALL "upsertCatalogItem"('evaluationInstitutionType', 'Evaluation institution type', 'PRIVATE_PRACTICE', 'Private practice', 'PRIVATE_PRACTICE', 4);
CALL "upsertCatalogItem"('evaluationInstitutionType', 'Evaluation institution type', 'OTHER',            'Other',            'OTHER',            5);
```

El `code` del `catalogType` va en camelCase, que es la excepción de normalización declarada en `CONVENTIONS.md`; los `code` de los ítems van en `CONSTANT_CASE`, como los de `healthFacilityType`. El procedimiento es idempotente por `ON CONFLICT ("catalogTypeId", "code")` y reactiva la fila si estaba retirada, así que ejecutar el DDL dos veces no duplica nada.

### 3.2 Modelo Sequelize

Archivo: `src/models/evaluationInstitution.model.ts`. Clase `EvaluationInstitution`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'evaluationInstitution'`.

`evaluationInstitutionId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')` — la clave es propia y la genera la base. `investigationId` va `DataTypes.UUID` con `allowNull: false`. `healthFacilityId` y `evaluationInstitutionTypeItemId` van `DataTypes.UUID` con `allowNull: true`. `institutionName`, `personName` y `personContact` van `DataTypes.STRING(250)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres. `notes` va `DataTypes.TEXT`.

> **La longitud de las cifradas es la trampa.** `esaviCrypt` devuelve una cadena más larga que su texto plano, y es **esa** la que tiene que caber en `varchar(250)`. El validador acota el **texto plano** a un máximo que deje margen suficiente tras cifrar; §3.3 fija la cifra en **120 caracteres** para `personName` y `personContact`. Un nombre de 250 caracteres válido para el validador produciría un ciphertext que Postgres rechaza, y el error saldría del driver en vez del validador.

**`sortOrder` se declara `allowNull: true` y sin `defaultValue`.** Es la consecuencia del hallazgo `B` de §1 y la diferencia con F16, F21, F22, F24, F27, F31 y F33:

> **Nota de implementación — por qué aquí no hace falta `CREATE_FIELDS`.** En las ocho hermanas la columna es `NOT NULL`, así que Sequelize corre su validación `notNull` antes de emitir el `INSERT` y el alta muere con `notNull Violation` sin que el trigger llegue a ejecutarse; la única salida era la lista explícita `fields: CREATE_FIELDS`. Aquí la columna admite `NULL`, la validación no salta, el `INSERT` lleva `"sortOrder" = NULL` y `setSortOrderByParent` lo interpreta como «asígnamelo tú». **El `create` es el corriente, sin `fields`**, y el servicio simplemente no envía la clave.

Asociaciones, en `src/models/associations/evaluationInstitution.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `EvaluationInstitution.belongsTo(InvestigationClinicalEvaluation, { as: 'clinicalEvaluation', foreignKey: 'investigationId' })`
- `InvestigationClinicalEvaluation.hasMany(EvaluationInstitution, { as: 'evaluationInstitutions', foreignKey: 'investigationId' })`
- `EvaluationInstitution.belongsTo(HealthFacility, { as: 'healthFacility', foreignKey: 'healthFacilityId' })`
- `EvaluationInstitution.belongsTo(CatalogItem, { as: 'institutionType', foreignKey: 'evaluationInstitutionTypeItemId' })`

**El `belongsTo` se declara sobre `investigationId` apuntando a `InvestigationClinicalEvaluation`**, no a `Investigation`. Es la asociación que más fácil se escribe mal, porque el nombre de la columna sugiere lo contrario. Es el riesgo que F33 §7 documentó, y vuelve idéntico.

El `hasMany` se declara porque lo necesita el volcado del `ESAVI-INVCLIEV-005C`. **No se incluye en ninguna respuesta de `investigationClinicalEvaluation`**: el contrato de F34 no cambia. Ni `HealthFacility` ni `CatalogItem` ganan inverso.

Alta en `src/models/index.ts` y en el barrel de asociaciones.

**Los tres `include` que el servicio compone:**

- **Visibilidad heredada**, en `002A`, `002B`, `003` y `004` — dos saltos: `{ model: InvestigationClinicalEvaluation, as: 'clinicalEvaluation', required: true, attributes: ['investigationId', 'deletedAt'], paranoid: false, include: [{ model: Investigation, as: 'investigation', required: true, attributes: ['investigationId', 'isActive'], where: includeInactive ? {} : { isActive: true } }] }`. **El eslabón intermedio se comprueba por `deletedAt` y no por `isActive`**, porque aquella tabla no tiene la columna; el `paranoid: false` es lo que permite verlo sellado en vez de que el `include` lo esconda.
- **Respuesta**, en `001`, `003`, `004` y las filas de los listados: `{ model: HealthFacility, as: 'healthFacility', attributes: ['healthFacilityId', 'localCode', 'name', 'isActive'], required: false }`.
- **Respuesta**, los mismos: `{ model: CatalogItem, as: 'institutionType', attributes: ['catalogItemId', 'code', 'name'], required: false }`.

Los dos últimos van con `required: false`: las dos FKs son nullable y un `INNER JOIN` escondería las instituciones de texto libre.

### 3.3 Tipos

Ruta: `src/types/investigation/evaluationInstitution.types.ts`, junto a los archivos que aquel dominio ya tiene, exportado por su `index.ts` de barrel.

```ts
export interface CreateEvaluationInstitutionInput {
    investigationId: string;
    healthFacilityId?: string | null;
    institutionName?: string | null;
    personName?: string | null;
    personContact?: string | null;
    evaluationInstitutionTypeItemId?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateEvaluationInstitutionInput>`. **No se declara `UpdateEvaluationInstitutionInput`** — prohibido por §4 de las convenciones.

**Ninguna clave de entrada deja de ser columna**, a diferencia de F33: aquí no hay resolución contra ningún maestro que derive valores. Lo que el cliente manda es lo que se guarda, normalizado y —en dos casos— cifrado.

**Dos columnas no están en la interfaz.** `evaluationInstitutionId` la genera la base; `sortOrder` es inmutable y lo asigna el trigger, y que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande.

**Los límites del validador, y por qué no coinciden con el DDL:**

| Campo | Máximo del validador | Razón |
|---|---|---|
| `institutionName` | 250 | Coincide con `varchar(250)`: no se cifra |
| `personName` | **120** | Se cifra: el ciphertext debe caber en `varchar(250)` |
| `personContact` | **120** | Idem |
| `notes` | sin límite | La columna es `text` |

**`healthFacilityId` o `institutionName`, al menos uno.** La regla **no** la resuelve el validador de campo a campo: en el `004` depende del estado guardado, no solo del body. Vive en el servicio y responde 400 desde allí, con clave propia. Es la única validación de forma del spec que no sale de `validateFields`, y §6 lo razona.

### 3.4 Superficie HTTP

Ruta base `/api/evaluation-institutions`, registrada en `src/routes/index.ts`.

```
POST   /api/evaluation-institutions                           ESAVI-EVALINST-001   USER        (nuevo)
GET    /api/evaluation-institutions/admin/investigation/:id    ESAVI-EVALINST-002B  ADMIN       (nuevo)
GET    /api/evaluation-institutions/investigation/:id          ESAVI-EVALINST-002A  USER        (nuevo)
DELETE /api/evaluation-institutions/purge/:id                  ESAVI-EVALINST-005C  SUPERADMIN  (nuevo)
PATCH  /api/evaluation-institutions/activate/:id               ESAVI-EVALINST-005B  ADMIN       (nuevo)
GET    /api/evaluation-institutions/:id                        ESAVI-EVALINST-003   USER        (nuevo)
PUT    /api/evaluation-institutions/:id                        ESAVI-EVALINST-004   USER        (nuevo)
DELETE /api/evaluation-institutions/:id                        ESAVI-EVALINST-005A  ADMIN       (nuevo)
```

**Ocho rutas, y `:id` es el `evaluationInstitutionId`** salvo en los dos listados, donde es el `investigationId`. El `003` **no** es el acceso por investigación: para eso está el `002A`.

**Orden de declaración.** Las literales van **antes** de `/:id`, y `/admin/investigation/:id` antes que `/investigation/:id`, o Express capturaría `admin`, `investigation`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las ocho están escritas arriba en el orden exacto en que deben aparecer en `src/routes/evaluationInstitution.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `INVTEAM`, `PREGCOMP` e `INVPREG`.

**Roles.** `001`, `002A`, `003` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28 a F34, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso, y partir el formulario de evaluación clínica entre dos roles rompería la captura por la mitad. `002B` y `005A` en **ADMIN**. **`005B` en ADMIN y no en SUPERADMIN**, siguiendo a F27, F31 y F33: la activación de esta entidad no es la delegación trivial que la matriz canónica supone, sino una operación con reasignación de `sortOrder`, y quien administra el caso debe poder ejecutarla. `005C` se queda en **SUPERADMIN**.

**Ocho operaciones y ninguna no canónica.** Es la cuarta de la familia sin `006`, tras F24, F27 y F33, y por tanto **no añade fila a la tabla de operaciones no canónicas de §6**.

**La abreviatura es `EVALINST`.** Ocho letras, no colisiona con las treinta y cuatro registradas, y `grep "ESAVI-EVALINST-"` no se cruza con `ESAVI-INVCLIEV-`, `ESAVI-INVESTGN-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-`, `ESAVI-INVTEAM-`, `ESAVI-INVSRC-` ni `ESAVI-INVAUT-`.

Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, a continuación de las que dejó F34.

### 3.5 Reglas de negocio por operación

#### La guarda del padre — compartida por `001`, `002A` y `002B`

Una sola consulta sobre `investigationClinicalEvaluation` por PK, con `paranoid: false` e `include` de `investigation` (`attributes: ['investigationId', 'isActive']`). Falla, con **404** y un único código por operación, si se cumple cualquiera de estas tres:

1. No hay fila de evaluación clínica.
2. La fila tiene `deletedAt` no nulo — la selló un `ESAVI-INVESTGN-005A` a través de `cascadeSealSatellite`.
3. Su investigación tiene `isActive: false`.

**Los tres motivos comparten código y mensaje.** Al investigador no le sirve distinguirlos: en los tres casos el eslabón que falta está un nivel más arriba y la acción correctiva es la misma.

**En los dos listados la comprobación 3 la relaja `canViewInactive`**; las comprobaciones 1 y 2 **no se relajan para nadie**, ni siquiera para SUPERADMIN: una fila sellada sí es visible —es lo que el `paranoid: false` permite—, pero una evaluación inexistente no tiene instituciones que listar bajo ningún rol.

**En el `001` no hay relajación de ninguna de las tres.** Una evaluación sellada o de investigación inactiva no recibe instituciones nuevas, sea quien sea quien lo pida. Es el criterio de F31 y F33.

#### Visibilidad heredada — compartida por `003`, `004` y las filas de los dos listados

Toda lectura de una institución incluye la cadena de dos saltos de §3.2. La institución responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`, si:

- su evaluación clínica tiene `deletedAt` sellado, **o**
- su investigación tiene `isActive: false`, **o**
- la propia institución tiene `isActive: false`.

Las tres se evalúan igual y ninguna tiene prioridad: basta que una falle.

**El `005A`, el `005B` y el `005C` no la aplican.** Quien retira, reactiva o purga actúa sobre el estado propio de la fila, y ese estado existe con independencia de sus dos padres.

#### Las dos validaciones de maestro — `001` y `004`

Las dos corren **antes del diff y con independencia de él**: un establecimiento inactivo es 404 aunque coincida con el guardado.

**`healthFacilityId`.** `HealthFacility.findOne({ where: { healthFacilityId, isActive: true }, attributes: ['healthFacilityId'] })`. Si no hay fila → **404** `EVALINST_<op>_HEALTH_FACILITY_NOT_FOUND`. Dos motivos —no existe, está inactivo— y un solo error, con la forma de `esaviCase.service.ts:116-125`. **Solo corre cuando la clave llega con valor**: un `healthFacilityId: null` explícito no resuelve nada, porque se está vaciando.

**`evaluationInstitutionTypeItemId`.** Doble salto, con la forma de `assertCatalogItemIsValid` (`investigationMedicalHistory.service.ts:222-246`): `CatalogItem.findOne({ where: { catalogItemId, isActive: true }, include: [{ model: CatalogType, as: 'catalogType', where: { code: 'evaluationInstitutionType' }, attributes: [] }] })`. Si no hay fila → **404** `EVALINST_<op>_INSTITUTION_TYPE_NOT_FOUND`. Tres motivos —no existe, está inactivo, no pertenece al catálogo— y un solo error, porque ninguno de los tres es accionable de forma distinta. Igual que la anterior, solo corre cuando la clave llega con valor.

#### La regla de identificación — `001` y `004`

**Al menos uno de `healthFacilityId` e `institutionName` debe quedar con valor**, o **400** `EVALINST_<op>_IDENTIFICATION_REQUIRED`.

- En el `001` se evalúa sobre el body, que es el estado resultante completo.
- En el `004` se evalúa sobre el **estado resultante**: `data.healthFacilityId !== undefined ? data.healthFacilityId : stored.healthFacilityId`, y lo mismo con `institutionName` ya normalizado. Vaciar el único que había es 400; vaciar uno cuando el otro sobrevive es 200.

**Se comprueba antes que las dos validaciones de maestro**: no tiene sentido resolver un establecimiento en una fila que va a quedar sin identificar de todos modos.

#### Guarda de duplicado — `001` y `004`

`findOne` sobre el mismo `investigationId`, el mismo `healthFacilityId` e `isActive: true`, excluyendo en el `004` la propia fila con `evaluationInstitutionId: { [Op.ne]: id }`. Si hay fila → **409** `EVALINST_<op>_ALREADY_EXISTS`.

**Solo corre cuando `healthFacilityId` queda con valor.** Con `null` no se comprueba nada: dos instituciones de texto libre son registros distintos aunque el texto coincida, y una guarda inventada no debe ser más rígida que las que la base sí impone —que aquí son ninguna.

**Se compara contra activas, no contra todas.** Una institución retirada no bloquea volver a cargar el mismo establecimiento: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`. La consecuencia —que un `005B` pueda dejar dos filas activas con el mismo establecimiento— está declarada en §6.

#### El cifrado, y dónde entra en cada operación

`personName` y `personContact` son las dos únicas columnas cifradas.

- **Al escribir** (`001` y `004`): `esaviCrypt` se aplica **al final**, sobre el valor ya normalizado —`toTitleCase(trim())` para `personName`, `trim()` para `personContact`— y, en el `004`, **después** del diff.
- **Al leer** (`001`, `002A`, `002B`, `003`, `004`): `esaviDecrypt` sobre el valor guardado antes de construir el payload, **fila por fila en los dos listados**. El ciphertext nunca cruza la frontera HTTP.
- **En el diff** (`004`): `stored.personName` y `stored.personContact` llegan **descifrados**, y la comparación es sobre texto plano. Comparar ciphertext funcionaría hoy —`esaviCrypt` es determinista mientras el IV sea fijo— y se rompería en silencio el día que deje de serlo. Es la regla de F34 (`investigationClinicalEvaluation.service.ts:458-463`), literal.
- **Un `null` nunca se pasa a `esaviDecrypt` ni a `esaviCrypt`.** Las dos columnas son anulables y el guardián es explícito en los dos sentidos.

**Ordenar o buscar por estas dos columnas es imposible**, y por eso el `002A` y el `002B` ordenan por `sortOrder` y no aceptan filtros. Está declarado fuera de alcance en §2.

#### Por operación

**`ESAVI-EVALINST-001` — crear.** Todo dentro de **una transacción**. En este orden:

1. **La guarda del padre** → 404 `EVALINST_001_CLINICAL_EVALUATION_NOT_FOUND`.
2. Normalización: `trim()` sobre `institutionName`, `personContact` y `notes`; `toTitleCase(trim())` sobre `personName`. **`institutionName` no lleva `toTitleCase`.**
3. **La regla de identificación** → 400 `EVALINST_001_IDENTIFICATION_REQUIRED`.
4. **Validación de `healthFacilityId`**, si viaja → 404 `EVALINST_001_HEALTH_FACILITY_NOT_FOUND`.
5. **Validación de `evaluationInstitutionTypeItemId`**, si viaja → 404 `EVALINST_001_INSTITUTION_TYPE_NOT_FOUND`.
6. **Guarda de duplicado**, solo si `healthFacilityId` quedó con valor → 409 `EVALINST_001_ALREADY_EXISTS`.
7. Cifrado de `personName` y `personContact`.
8. `create` **sin la clave `sortOrder`** y **sin `fields`**, para que lo asigne el trigger.
9. Entrada de auditoría en `appDetails` con `method: 'ESAVI-EVALINST-001'`.

Un alta con solo `investigationId` e `institutionName` es válida y devuelve **201**, con las cuatro claves restantes en `null` y el `sortOrder` que le toque.

**`ESAVI-EVALINST-002A` — listar activas por investigación.** La guarda del padre → 404 `EVALINST_002A_CLINICAL_EVALUATION_NOT_FOUND`. `findAndCountAll` con `where: { investigationId, isActive: true }`, los dos `include` de respuesta, `order: [['sortOrder', 'ASC']]` y paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query. **Descifrado fila por fila** antes de responder.

Una evaluación sin instituciones devuelve **200** con `{ count: 0, rows: [] }`, no 404.

**`ESAVI-EVALINST-002B` — listar todas por investigación.** Idéntica, con `where: { investigationId }`, **sin** el `isActive: true`, con `paranoid: false` y `validateUserRole(ADMIN)`. Devuelve también las retiradas y las de `deletedAt` sellado. Mismo 404 salvo el sufijo: `EVALINST_002B_CLINICAL_EVALUATION_NOT_FOUND`. **Es la operación que justifica el índice nuevo de §3.1.**

**`ESAVI-EVALINST-003` — obtener por ID.** El `:id` es el `evaluationInstitutionId`. Existencia más la visibilidad heredada de dos saltos más el `isActive` propio, gobernados los tres por `canViewInactive` → 404 `EVALINST_003_NOT_FOUND`. Forma completa de §3.7, con las dos columnas descifradas.

**`ESAVI-EVALINST-004` — actualizar.** Dentro de **transacción**. En este orden:

1. Existencia con visibilidad heredada → 404 `EVALINST_004_NOT_FOUND`.
2. `investigationId` y `sortOrder` **se ignoran siempre**, vengan o no en el body, sin 400.
3. `stored` sale de `institution.get({ plain: true })`, **no de una consulta acotada**: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió». `stored.personName` y `stored.personContact` se **descifran** aquí, y desde ese punto llevan texto plano.
4. Normalización de los cuatro textos.
5. **La regla de identificación sobre el estado resultante** → 400 `EVALINST_004_IDENTIFICATION_REQUIRED`.
6. **Las dos validaciones de maestro** y la **guarda de duplicado**. **Antes del diff y con independencia de él.**
7. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
8. **Cifrado, después del diff**: si `personName` o `personContact` figuran entre las claves que devolvió el helper y no son `null`, se pasan por `esaviCrypt` sobre el objeto de actualización.
9. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `evaluationInstitutionId` | **no entra** | PK |
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `healthFacilityId` | `data.healthFacilityId !== undefined ? (data.healthFacilityId ?? null) : undefined` | anulable |
| `institutionName` | `data.institutionName !== undefined ? normalizeText(data.institutionName) : undefined` | anulable; solo `trim()`, **sin `toTitleCase`** |
| `personName` | `data.personName !== undefined ? normalizePersonName(data.personName) : undefined` | anulable y **cifrado**: texto plano en el diff, `esaviCrypt` después |
| `personContact` | `data.personContact !== undefined ? normalizeText(data.personContact) : undefined` | anulable y **cifrado**: texto plano en el diff, `esaviCrypt` después |
| `evaluationInstitutionTypeItemId` | `data.evaluationInstitutionTypeItemId !== undefined ? (data.evaluationInstitutionTypeItemId ?? null) : undefined` | anulable |
| `notes` | `data.notes !== undefined ? normalizeText(data.notes) : undefined` | anulable; solo `trim()` |
| `isActive` | **no entra** | lo gobiernan `005A` y `005B` |

**Cinco anulables, dos cifrados y ningún derivado.** Es la tabla más simple de las tres últimas specs: sin resolución contra maestro no hay nada que recalcular, así que **ningún campo entra «siempre»**. `normalizeText` devuelve `null` para la cadena vacía, de modo que `institutionName: ""` vacía la columna en vez de guardar `''`.

**`ESAVI-EVALINST-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'EVALINST_005A_NOT_FOUND'`, `alreadyInStateCode: 'EVALINST_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-EVALINST-005A'`. **No consulta nada más**: la tabla es hoja y no aplica visibilidad heredada. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — deliberado: el hueco queda para la siguiente institución.

**`ESAVI-EVALINST-005B` — reactivar.** Dentro de **transacción**, y **no** es delegación limpia. Es el hallazgo de F16, entero:

1. Se busca la fila con `paranoid: false` → 404 `EVALINST_005B_NOT_FOUND`.
2. Si existe y está inactiva, se busca colisión: otra fila del **mismo** `investigationId`, con el **mismo** `sortOrder`, con `deletedAt: null` y `evaluationInstitutionId: { [Op.ne]: id }`. **Si el `sortOrder` de la fila es `null` no hay colisión posible** —el índice parcial excluye los nulos— y el paso se salta.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de ese padre —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que la escritura es libre. La institución reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'EVALINST_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-EVALINST-005B'`.

Si la fila estaba **activa**, el paso 2 no encuentra colisión y el helper levanta su 409 con normalidad.

**El `005B` no revalida nada más**: ni la guarda de duplicado, ni los dos maestros, ni la regla de identificación, ni el estado de la evaluación o de la investigación. Reactivar es deshacer una desactivación.

**`ESAVI-EVALINST-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'EVALINST_005C_NOT_FOUND'` y `stillActiveCode: 'EVALINST_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. La aporta el control que el helper ya lleva dentro, que aquí **sí es efectivo** porque la columna existe. **Sin consulta previa y sin volcado de cascada**: la tabla es hoja del grafo. Sin entrada en `appDetails` —la fila se destruye en la misma transacción—, que es la ausencia que `CONVENTIONS.md` §6 declara legítima.

#### Los dos volcados en servicios ajenos

Ninguno bloquea nada, ninguno abre transacción propia y los dos se escriben **antes** del `destroy`, dentro de la transacción que ya existe. Los dos son **conteo y no snapshot por fila** — y aquí no es solo el criterio de F31: un snapshot escupiría al log el ciphertext de dos columnas PII.

**En `investigationClinicalEvaluation.service.ts`, dentro de `purgeInvestigationClinicalEvaluationService`:**

```
ESAVI-INVCLIEV-005C: N evaluation institution(s) dragged by ON DELETE CASCADE, purged by <userId>
```

`EvaluationInstitution.count({ where: { investigationId: id }, paranoid: false, transaction })`. El `paranoid: false` cuenta también las que un `005A` selló: la cascada las destruye igual. Se emite solo si `N > 0`. **El comentario de `:611` que dice «when that table exists» se sustituye por el volcado real.**

**En `investigation.service.ts`, dentro de `purgeInvestigationService`** — séptima línea del volcado, y la **segunda de segundo salto** tras la que dejó F33:

```
ESAVI-INVESTGN-005C: N evaluation institution(s) dragged by ON DELETE CASCADE in two hops, purged by <userId>
```

Mismo `count`, con el mismo `investigationId`: la PK compartida de la evaluación clínica hace que el segundo salto no cueste una consulta extra. Va la **última**, agrupada con los otros dos conteos que ya están al final de la función (`:691` y `:712`).

#### Escrituras que no son diferenciales, declaradas una a una

- **El `001`** — es un `create`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: esta institución vuelve a estar viva y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005A` y el `005B`** — escrituras de estado, delegadas en `setEntityActiveStatusService`.
- **El `005C`** — destruye la fila.

**Este spec no escribe en ninguna otra tabla.** No toca `investigationClinicalEvaluation`, ni `healthFacility`, ni `catalogItem`, ni `catalogType`: los dos maestros se **leen** para validar y nada más. Lo único que toca fuera son las dos líneas de log de los volcados. La siembra del catálogo la hace el DDL, no la aplicación.

### 3.6 Claves i18n nuevas

Bajo `evaluationInstitution`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `evaluationInstitution.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente o no visible |
| `evaluationInstitution.idRequired` | 400 del validador de `:id` |
| `evaluationInstitution.clinicalEvaluationNotFound` | 404 cuando la evaluación clínica no existe, está sellada, o su investigación está inactiva |
| `evaluationInstitution.healthFacilityNotFound` | 404 cuando el establecimiento no existe o está inactivo |
| `evaluationInstitution.institutionTypeNotFound` | 404 cuando el ítem no existe, está inactivo o no pertenece a `evaluationInstitutionType` |
| `evaluationInstitution.identificationRequired` | 400 cuando el estado resultante no tiene ni `healthFacilityId` ni `institutionName` |
| `evaluationInstitution.alreadyExists` | 409 cuando la evaluación ya tiene una institución **activa** con el mismo establecimiento |
| `evaluationInstitution.stillActive` | 409 al purgar una institución que no fue retirada antes |
| `.createdSuccess` / `.createdFailed` | 201 y 500 del `001` |
| `.getSuccess` / `.getFailed` | 200 y 500 de `002A`, `002B` y `003` |
| `.updatedSuccess` / `.updatedFailed` | 200 y 500 del `004` |
| `.deletedSuccess` / `.deletedFailed` | 200 y 500 del `005A` |
| `.activatedSuccess` / `.activatedFailed` | 200 y 500 del `005B` |
| `.alreadyActive` / `.alreadyInactive` | 409 de `005B` y `005A` |
| `.purgeSuccess` / `.purgeFailed` | 200 y 500 del `005C` |

**Las validaciones de forma no generan clave propia.** Los máximos de 250 y 120 caracteres y el formato UUID de las tres claves foráneas los responde `validateFields` con `common.validationError`. **La única excepción es `identificationRequired`**, que es un 400 del servicio y no del validador, por la razón de §3.3.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `001`, `003` y `004`:

```
{ ok, message, data: {
    evaluationInstitutionId, investigationId, sortOrder,
    healthFacilityId, institutionName, personName, personContact,
    evaluationInstitutionTypeItemId, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    healthFacility: { healthFacilityId, localCode, name, isActive } | null,
    institutionType: { catalogItemId, code, name } | null
} }
```

**`personName` y `personContact` viajan siempre en claro**, descifradas con `esaviDecrypt`, o en `null`. El ciphertext no aparece en ninguna respuesta de ninguna de las cinco operaciones que devuelven la fila.

**El nombre que el cliente muestra es `institutionName ?? healthFacility.name`.** No hay un tercer campo que lo resuelva, y los dos conviven a propósito: cuando ambos tienen valor, el texto del investigador manda sobre el del maestro sin borrarlo.

`healthFacility` e `institutionType` se incluyen cuando la FK correspondiente tiene valor, y valen `null` cuando no. `institutionType` lleva **tres** campos, con la forma que F32 usa para sus cuatro catálogos.

En `002A` y `002B`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba, **descifrada fila por fila**, y ordenadas por `sortOrder` ascendente.

**Nada de la evaluación clínica ni de la investigación viaja en la respuesta.** `clinicalEvaluation` se consulta solo para la visibilidad heredada, con `attributes` acotados, y se descarta al construir el payload. Quien necesite la evaluación entra por `ESAVI-INVCLIEV-003`.

`sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura.** Añadir la fila `evaluationInstitution | EVALINST` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en el orden alfabético que la tabla mantiene —entre `esaviCase` y `geoLevelType`—. **La tabla de operaciones no canónicas no se toca:** F35 no tiene `006`. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla contiene la fila nueva; `EVALINST` no aparece dos veces y no colisiona con `INVCLIEV`, `INVESTGN`, `INVMEDH`, `INVPREG`, `INVTEAM`, `INVSRC` ni `INVAUT`; `git diff references/CONVENTIONS.md` muestra **una sola** fila añadida y ningún cambio en la tabla de operaciones no canónicas.

2. **El índice y la siembra en `esaviapp.sql`.** `CREATE INDEX IF NOT EXISTS "IX_evaluationInstitution_investigation" ON "evaluationInstitution" ("investigationId");` inmediatamente después del `CREATE TABLE` de `:1130`, con la forma de `IX_investigationTeamMember_investigation`. Y las cinco `CALL "upsertCatalogItem"('evaluationInstitutionType', …)` de §3.1, al final del bloque de siembra.
   *Verificación:* `git diff esaviapp.sql` muestra **exactamente seis líneas añadidas** y ninguna modificada; ejecutar el DDL completo sobre una base limpia no produce errores; ejecutarlo **dos veces seguidas** deja cinco ítems y no diez; `SELECT count(*) FROM "catalogItem" ci JOIN "catalogType" ct USING ("catalogTypeId") WHERE ct."code" = 'evaluationInstitutionType'` devuelve **5**; el trigger de `sortOrder`, el índice único parcial, el `CHECK` y las tres FKs quedan intactos.

3. **Modelo y asociaciones.** `src/models/evaluationInstitution.model.ts` con los nueve atributos de datos y las seis transversales, `sortOrder` **`allowNull: true` y sin `defaultValue`**, las tres columnas de texto en `STRING(250)`. `src/models/associations/evaluationInstitution.associations.ts` con los cuatro vínculos de §3.2. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` compila; una consulta manual `EvaluationInstitution.findAll({ include: ['clinicalEvaluation', 'healthFacility', 'institutionType'] })` no lanza `EagerLoadingError`; el `belongsTo` de `investigationId` apunta a `InvestigationClinicalEvaluation` y **no** a `Investigation`; `InvestigationClinicalEvaluation.hasMany` existe con alias `evaluationInstitutions` y no colisiona con ningún alias de F29 a F34.

4. **Tipos y validadores.** `src/types/investigation/evaluationInstitution.types.ts` con la única interfaz de §3.3, exportada por el barrel del dominio. `src/validators/evaluationInstitution.validators.ts` con los cinco validadores —create, list por padre, id, update, activate—, registrado en el barrel, con los máximos de §3.3: 250 para `institutionName` y **120** para `personName` y `personContact`.
   *Verificación:* `npm run build` compila; **no existe** ningún `UpdateEvaluationInstitutionInput`; un `POST` sin `investigationId` responde 400 `common.validationError`; un `personName` de 121 caracteres responde 400 **del validador**, no del driver; un `institutionName` de 251 responde 400; un `healthFacilityId` que no es UUID responde 400.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` pasa; `npx jest tests/i18n` pasa; ninguna clave existe en dos de los tres archivos.

6. **`ESAVI-EVALINST-001`.** Servicio, controlador y ruta. Transacción, guarda del padre, normalización, regla de identificación, las dos validaciones de maestro, guarda de duplicado, cifrado y entrada de auditoría. `create` **sin `sortOrder` y sin `fields`**.
   *Verificación:* un alta con `investigationId` e `institutionName` devuelve **201** con `sortOrder: 1` sobre una evaluación vacía, y la segunda recibe `sortOrder: 2`; el `INSERT` emitido lleva `"sortOrder"` en `NULL` **y aun así el trigger lo resuelve** —es el punto que separa esta tabla de sus ocho hermanas—; un alta sin `healthFacilityId` ni `institutionName` responde 400 `EVALINST_001_IDENTIFICATION_REQUIRED`; con un `healthFacilityId` inactivo, 404; con un `evaluationInstitutionTypeItemId` de otro catálogo —un ítem de `sex`—, 404 `EVALINST_001_INSTITUTION_TYPE_NOT_FOUND`; sobre un `investigationId` sin evaluación clínica, con la fila sellada, o con la investigación inactiva, responde 404 `EVALINST_001_CLINICAL_EVALUATION_NOT_FOUND` en los tres casos, **también como SUPERADMIN**; repetir el mismo establecimiento activo responde 409; `SELECT "personName" FROM "evaluationInstitution"` devuelve ciphertext y la respuesta HTTP devuelve el nombre en claro con `toTitleCase` aplicado; `appDetails` tiene una entrada con `method: 'ESAVI-EVALINST-001'`.

7. **`ESAVI-EVALINST-002A` y `002B`.** Los dos listados por `investigationId`, con la guarda del padre, `findAndCountAll`, los dos `include` de respuesta, descifrado fila por fila, orden por `sortOrder` y paginación.
   *Verificación:* el `002A` devuelve solo activas y el `002B` también las inactivas y las de `deletedAt` sellado; **ninguna fila de ninguno de los dos contiene ciphertext** en `personName` ni en `personContact`; los dos devuelven `{ count, rows }` ordenados por `sortOrder` ascendente; una evaluación sin instituciones devuelve **200** con `{ count: 0, rows: [] }`; un `investigationId` sin evaluación clínica devuelve **404**, también como SUPERADMIN; una investigación inactiva devuelve 404 para USER y ADMIN y **200** para SUPERADMIN; el `002B` con rol USER responde 403; `?limit=1&offset=1` devuelve la segunda fila con el `count` total; ningún parámetro de query distinto de `limit`, `offset` y `lang` altera el resultado.

8. **`ESAVI-EVALINST-003`.** Obtener por `evaluationInstitutionId` con la cadena de dos saltos.
   *Verificación:* devuelve la forma de §3.7 con `healthFacility` e `institutionType` anidados o `null`; una institución de texto libre devuelve los dos en `null` y **200**, no 404; una institución inactiva responde 404 para USER y 200 para SUPERADMIN; una activa cuya evaluación está sellada responde 404 para USER y ADMIN y 200 para SUPERADMIN; lo mismo con la investigación inactiva; `sysDetails` no aparece en el payload.

9. **`ESAVI-EVALINST-004`.** Transacción, `stored` completo con las dos columnas descifradas, regla de identificación sobre el estado resultante, las dos validaciones de maestro, guarda de duplicado, `buildDifferentialUpdate` con la tabla de `candidates` y `esaviCrypt` **después** del diff.
   *Verificación:* la del bloque de update diferencial de §5, entera, incluido el criterio de ciphertext idéntico byte a byte.

10. **`ESAVI-EVALINST-005A`.** Delegación en `setEntityActiveStatusService`.
    *Verificación:* sella `isActive: false` y `deletedAt`; repetir responde 409 `EVALINST_005A_ALREADY_INACTIVE`; **no comprueba el estado de la evaluación ni de la investigación** —retirar una institución de una investigación inactiva devuelve 200—; tras el `005A`, un alta nueva sobre la misma evaluación puede recibir el `sortOrder` liberado; `appDetails` crece con `method: 'ESAVI-EVALINST-005A'`.

11. **`ESAVI-EVALINST-005B`.** Transacción, detección de colisión de `sortOrder`, reasignación previa y delegación.
    *Verificación:* con dos instituciones en `sortOrder` 1 y 2, retirar la **2**, crear una nueva —que recibe `MAX(1) + 1 = 2` y colisiona con la retirada— y reactivar la retirada devuelve **200** y la deja en **`3`**, sin violar el índice único parcial; sin colisión conserva su número original; una fila con `sortOrder: null` se reactiva sin entrar en el paso de colisión; reactivar una fila ya activa responde 409 `EVALINST_005B_ALREADY_ACTIVE`; la reactivación **no** revalida la guarda de duplicado, los dos maestros, la regla de identificación ni el estado de los padres; el rol mínimo es ADMIN y un USER recibe 403.

12. **`ESAVI-EVALINST-005C`.** `purgeEntityService` sin modificarlo.
    *Verificación:* purgar una institución activa responde 409 `EVALINST_005C_STILL_ACTIVE`; purgar una retirada la destruye y un `003` posterior responde 404; el `healthFacility` y el `catalogItem` que citaba **siguen existiendo**; el rol mínimo es SUPERADMIN; `purgeEntityService`, `setEntityActiveStatusService` y `satelliteCascade.service.ts` no aparecen en `git diff`.

13. **El volcado de `ESAVI-INVCLIEV-005C`.** Añadir el `count` y la línea `warn` en `purgeInvestigationClinicalEvaluationService`, y **sustituir el comentario de `investigationClinicalEvaluation.service.ts:611`** que dice «when that table exists» por la referencia a este spec.
    *Verificación:* purgar una evaluación con tres instituciones —una de ellas sellada— escribe **una** línea `warn` con `3`; con cero instituciones **no escribe ninguna línea**; la línea es un conteo y **no contiene ciphertext ni ningún dato de persona**; la purga **no se bloquea** en ningún caso; `git diff src/services/investigationClinicalEvaluation.service.ts` toca únicamente el `005C`, sin rozar el `004` ni el cifrado de `clinicalDetailsPersonName`.

14. **El volcado de `ESAVI-INVESTGN-005C`.** Séptima línea en `purgeInvestigationService`, la última, junto a los conteos de `:691` y `:712`.
    *Verificación:* purgar una investigación con evaluación clínica e instituciones escribe las siete líneas, la nueva la última; purgar una investigación sin evaluación clínica no escribe ninguna de las dos; `git diff src/services/investigation.service.ts` toca únicamente `purgeInvestigationService` y **no** las funciones `cascadeSeal*` de `:471-520`.

15. **Rutas y registro.** `src/routes/evaluationInstitution.routes.ts` con las ocho en el orden de §3.4, montado en `src/routes/index.ts` bajo `/api/evaluation-institutions`.
    *Verificación:* `GET /admin/investigation/<uuid>` alcanza el `002B` y no el `003`; `PATCH /activate/<uuid>` alcanza el `005B`; `DELETE /purge/<uuid>` alcanza el `005C`; ninguna literal cae en el validador de UUID del `:id`; el comentario `// Code: ESAVI-EVALINST-<NNN>` está en la ruta, el controlador y el servicio, y coincide con el `AppError` y con `appDetails.method` en los cinco lugares.

16. **Pruebas.** Ocho filas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y `tests/contract/evaluationInstitution.test.ts` con el recorrido completo, siguiendo a `tests/contract/investigationPregnancyCondition.test.ts`.
    *Verificación:* `npm run check` pasa entero —build, lint, `i18n:check` y jest—; la suite de roles cuenta las ocho rutas nuevas y ninguna queda sin regla; la de contrato cubre el alta, los dos listados con descifrado, el `003`, los siete escenarios de update diferencial de §5, el `005A`, el `005B` con colisión de `sortOrder`, el `005C` y los dos volcados.

---

## 5. Criterios de aceptación

**Del DDL y la siembra:**

1. `esaviapp.sql` crece en **seis líneas**: una de índice y cinco de `CALL`. Ninguna línea existente se modifica.
2. Ejecutar el DDL dos veces seguidas sobre la misma base deja **cinco** ítems en `evaluationInstitutionType`, no diez. `SELECT count(*)` sobre el join con `catalogType` devuelve `5`, con `sortOrder` de 1 a 5.

**Del alta (`001`):**

3. `POST` con `investigationId` e `institutionName` sobre una evaluación clínica vacía y visible → **201**, `healthFacilityId: null`, `evaluationInstitutionTypeItemId: null`, `personName: null`, `personContact: null`, `sortOrder: 1`, `isActive: true`. La segunda alta recibe `sortOrder: 2`.
4. El `INSERT` emitido lleva `"sortOrder"` en **`NULL`** y el trigger lo resuelve igual. Verificable con `logging` de Sequelize en la suite. **No existe ninguna constante `CREATE_FIELDS` en el servicio.**
5. `POST` **sin `healthFacilityId` y sin `institutionName`** → **400** `EVALINST_001_IDENTIFICATION_REQUIRED`, aunque lleguen `personName`, `personContact`, tipo y `notes`.
6. `POST` con los **dos** identificadores → **201**, y los dos se guardan: `institutionName` conserva el texto del investigador aunque no se parezca al `name` del establecimiento. No hay 409 ni anulación.
7. `POST` con un `healthFacilityId` inexistente **o inactivo** → **404** `EVALINST_001_HEALTH_FACILITY_NOT_FOUND`, con el mismo mensaje en los dos casos.
8. `POST` con un `evaluationInstitutionTypeItemId` que es un `catalogItem` **activo de otro catálogo** —un ítem de `sex`— → **404** `EVALINST_001_INSTITUTION_TYPE_NOT_FOUND`. Es el criterio que demuestra que el doble salto está implementado y no solo la existencia del UUID.
9. `POST` sobre un `investigationId` **sin fila de evaluación clínica**, con la fila **sellada**, o con la **investigación inactiva** → **404** `EVALINST_001_CLINICAL_EVALUATION_NOT_FOUND` en los tres casos, con el mismo mensaje, **también con token SUPERADMIN**.
10. `POST` de un establecimiento que ya tiene una institución **activa** en esa evaluación → **409** `EVALINST_001_ALREADY_EXISTS`. Si la que lo tiene está **inactiva** → **201**.
11. `POST` del mismo `institutionName` dos veces **sin `healthFacilityId`** → **201** las dos, y quedan dos filas.
12. `POST` con `institutionName: "MINSAL"` guarda **`MINSAL`**, no `Minsal`. `POST` con `personName: "  juan pérez  "` guarda el cifrado de **`Juan Pérez`**.
13. Sobre una evaluación clínica con `receivedMedicalAttention: 'NO'` → **201**. No hay guarda de coherencia contra el padre.

**Del cifrado:**

14. `SELECT "personName", "personContact" FROM "evaluationInstitution"` devuelve **ciphertext** en las dos columnas. Ninguna respuesta HTTP de `001`, `002A`, `002B`, `003` ni `004` lo contiene: las cinco devuelven texto plano o `null`.
15. Una fila con `personName: null` responde `null`, y **`esaviDecrypt` nunca recibe un `null`**: el guardián es explícito. Lo mismo con `personContact`.

**De los listados (`002A`, `002B`):**

16. El `002A` devuelve solo `isActive: true`; el `002B` devuelve también las inactivas y las de `deletedAt` sellado. Los dos, `{ count, rows }` ordenados por `sortOrder` ascendente, con las dos columnas descifradas **en todas las filas**.
17. Una evaluación visible sin instituciones → **200** con `{ count: 0, rows: [] }`. Un `investigationId` sin fila de evaluación clínica → **404**, con cualquier rol.
18. Una investigación inactiva → **404** para USER y ADMIN, **200** para SUPERADMIN. El `002B` con rol USER → **403**.
19. `?limit=1&offset=1` devuelve la segunda fila y el `count` total, no `1`.

**De la lectura (`003`):**

20. Devuelve la forma exacta de §3.7. `healthFacility` con **cuatro** campos, `institutionType` con **tres**; los dos valen `null` en una institución de texto libre, que responde **200**. `sysDetails` no aparece.
21. Los tres motivos de invisibilidad —institución inactiva, evaluación sellada, investigación inactiva— responden **404** para USER y ADMIN y **200** para SUPERADMIN, cada uno por separado y combinados.

**Del update diferencial (`004`) — el bloque de SPEC F12, entero:**

22. **Un `PUT` que reenvía íntegra la respuesta de su `GET` responde 200 sin escribir nada:** `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve. Verificable comparando `updatedAt` y `jsonb_array_length("appDetails")` antes y después: los dos idénticos.
23. **Un `PUT` con body vacío `{}` se comporta igual que el anterior.**
24. **Un `PUT` que cambia un solo campo añade una entrada a `appDetails`** —con `method: 'ESAVI-EVALINST-004'`— y avanza `sysDetails.version` en 1. El historial anterior se conserva íntegro.
25. **El servicio usa `buildDifferentialUpdate`**; `grep -n "delete objectToUpdate" src/services/evaluationInstitution.service.ts` no devuelve resultados.
26. **Un `PUT` con una FK inactiva responde 404** —tanto `healthFacilityId` como `evaluationInstitutionTypeItemId`, y aunque coincidan con lo guardado— **y con un establecimiento ya ocupado 409**, aunque el resto del body no cambie nada.
27. **Un `PUT` que reenvía el `personName` guardado deja la columna cifrada idéntica byte a byte.** Es el criterio que demuestra que el diff corre sobre texto plano: comparar ciphertext también lo pasaría hoy, pero el criterio 22 no se sostendría si `stored` no se descifrara.
28. **Los campos inmutables se ignoran en silencio.** Un `PUT` con `investigationId` de otra investigación o con `sortOrder: 99` devuelve **200**, no 400, y ninguno de los dos cambia en la base.
29. Los cinco anulables se vacían con `null` explícito y **sí** cuentan como diferencia; ausentes, se dejan como estaban. `institutionName: ""` vacía la columna a `null`, no guarda cadena vacía.
30. **La regla de identificación se evalúa sobre el estado resultante.** Con una fila que solo tiene `institutionName`, un `PUT` con `institutionName: null` → **400** `EVALINST_004_IDENTIFICATION_REQUIRED`. Con una fila que tiene los dos, un `PUT` con `institutionName: null` → **200**.
31. Cuando el diff vuelve vacío, la respuesta es **200** con la fila tal cual, no 304 ni 204.

**De la activación (`005A`, `005B`):**

32. `005A` sella `isActive: false` y `deletedAt`, **sin comprobar el estado de la evaluación ni de la investigación**: retirar una institución de una investigación inactiva devuelve **200**. Repetir → 409 `EVALINST_005A_ALREADY_INACTIVE`.
33. **El escenario de colisión de `sortOrder`, entero:** con dos instituciones en `1` y `2`, retirar la **`2`**, crear una nueva —que recibe `MAX(1) + 1 = 2`— y reactivar la retirada → **200**, y la reactivada queda en **`3`**. El índice único parcial no se viola y ninguna de las tres filas comparte número.
34. Sin colisión, el `005B` conserva el `sortOrder` original. Reactivar una fila ya activa → 409 `EVALINST_005B_ALREADY_ACTIVE`. El rol mínimo es **ADMIN**; un USER recibe 403.
35. El `005B` **no** revalida la guarda de duplicado ni los dos maestros: reactivar puede dejar dos instituciones activas con el mismo establecimiento, o una que apunta a un `healthFacility` retirado entretanto. Es consecuencia asumida y declarada en §6.

**De la purga (`005C`) y los dos volcados:**

36. Purgar una institución **activa** → **409** `EVALINST_005C_STILL_ACTIVE`. Purgar una retirada la destruye, y un `003` posterior → 404. El `healthFacility` y el `catalogItem` que citaba **siguen existiendo**.
37. `ESAVI-INVCLIEV-005C` sobre una evaluación con tres instituciones —una sellada— escribe **una** línea `warn` con el conteo `3` y **no se bloquea**. Con cero instituciones no escribe ninguna línea. **La línea no contiene ciphertext ni ningún dato de persona.**
38. `ESAVI-INVESTGN-005C` escribe **siete** líneas `warn` cuando existen las seis satélites anteriores y las instituciones, la nueva la última.
39. `grep -n "when that table exists" src/services/investigationClinicalEvaluation.service.ts` no devuelve resultados.

**De la forma y del canon:**

40. El código `ESAVI-EVALINST-<NNN>` es **idéntico** en los cinco lugares —ruta, controlador, servicio, `AppError` y `appDetails.method`— en las ocho operaciones.
41. `grep -rn "ESAVI-EVALINST-002[^AB]" src/` no devuelve resultados.
42. `npm run check` pasa entero. `npm run i18n:check` no reporta claves huérfanas y `tests/auth/roles.test.ts` cubre las ocho rutas nuevas.
43. `git diff` **no toca** `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts`, ni ninguna parte de `investigation.service.ts` fuera de `purgeInvestigationService`, ni de `investigationClinicalEvaluation.service.ts` fuera de su `005C`.

---

## 6. Decisiones tomadas y descartadas

**`personName` y `personContact` se cifran las dos.**

- **Sí:** su propio padre ya lo hace. F34 cifra `clinicalDetailsPersonName` con el mismo argumento —es el nombre de una persona real, no un dato clínico—, y esta tabla guarda **lo mismo** una fila más abajo: el nombre de quien atendió y su teléfono o correo. Dejarlas en claro haría que el mismo dato estuviera protegido en la evaluación clínica y expuesto en sus instituciones, que es la peor de las dos opciones.
- **Sí, también `personContact`:** un teléfono o un correo identifica a una persona igual o mejor que su nombre. Cifrar solo el nombre protegería la mitad menos identificadora del par.
- **El precio, aceptado:** buscar y ordenar por esas dos columnas queda **imposible para siempre**, y el descifrado en los listados es fila por fila. Es el mismo coste que F05 asume en `patient` y F34 en la evaluación clínica. Los dos listados ordenan por `sortOrder`, que es lo que la tabla tiene para ordenar de todos modos.
- **No:** cifrado no determinista o IV por fila. Rompería la unicidad por igualdad de todo el repositorio y es un cambio transversal, no una decisión de esta entidad.

**El límite del validador es 120 y no 250.**

- **Sí:** lo que tiene que caber en `varchar(250)` es el **ciphertext**, no el texto plano. Un límite de 250 sobre el texto plano dejaría pasar valores que Postgres rechaza, y el error saldría del driver como un 500 en vez del validador como un 400.
- **No:** ampliar la columna a `varchar(500)` en el DDL. Modificar el esquema afecta a la carga de `esaviapp.sql` en los tests y a datos ya cargados; 120 caracteres sobran para un nombre y para un teléfono o correo.

**`healthFacilityId` e `institutionName` conviven, y no se comparan.**

- **Sí:** los dos se guardan tal cual y el cliente muestra `institutionName ?? healthFacility.name`. Es la forma de F33 con `conditionRaw`, y no pierde información: el investigador que escribe «Hospital del Niño, urgencias» sobre un establecimiento del maestro está diciendo algo que el maestro no dice.
- **No:** forzar `institutionName` a `null` cuando llega `healthFacilityId`. Más limpio en la base y peor para quien captura: borra deliberadamente lo que el investigador escribió.
- **No:** hacerlos excluyentes con 400. Convertiría en error una combinación que es la más informativa de las tres.
- **Y no:** la lógica de divergencia de F33, que anula `conditionRaw` cuando coincide con el nombre del maestro. Allí tenía sentido porque el maestro clínico es canónico; aquí el nombre del establecimiento y el que escribe el investigador no son el mismo tipo de dato, y compararlos exigiría normalizar acentos y decidir umbrales de parecido. Está declarado fuera de alcance.

**La regla de identificación vive en el servicio, no en el validador.**

- **Sí:** en el `004` depende del **estado guardado**, no solo del body. Un `PUT` con `institutionName: null` es válido o no según lo que haya en la fila, y eso el validador no lo sabe. Ponerla en los dos sitios duplicaría la regla y la desincronizaría en cuanto una de las dos copias cambiara.
- **La consecuencia asumida:** es la única validación de forma del spec que no responde `common.validationError`, y por eso tiene clave i18n propia. Está declarado en §3.6 para que no se lea como una omisión.
- **No:** dejar que un alta sin identificar pase con 201. Una institución evaluadora sin nombre ni establecimiento no informa de nada, y el DDL la admite solo porque todas sus columnas de datos son nullable.

**Aquí no hace falta `CREATE_FIELDS`, y es la primera vez.**

- **Sí:** la columna `sortOrder` de esta tabla es `NULL`-able y sin `DEFAULT 0` (`:1114`), a diferencia de sus ocho hermanas del bucle. La validación `notNull` de Sequelize no salta, el `INSERT` lleva la columna en `NULL` y `setSortOrderByParent` la resuelve. La lista explícita de campos que F16 §3.2 impuso resolvía un problema que aquí no existe.
- **Se declara en vez de copiarse por inercia:** replicar `CREATE_FIELDS` «porque las hermanas lo llevan» habría funcionado igual y habría dejado en el código una defensa sin causa, que el próximo lector tendría que investigar para descubrir que sobra.

**Sin guarda de coherencia contra los campos de la evaluación clínica padre.** Cargar una institución sobre una evaluación con `receivedMedicalAttention: 'NO'` devuelve 201.

- **Sí:** la regla del bloque vive entera en F34 §3.5. Replicarla aquí crearía **dos fuentes de verdad para la misma regla**, y la segunda quedaría desincronizada en cuanto la primera cambiara. Es la decisión de F27 frente a `hasComplications` y la de F33 frente a `isPregnancyConfirmed`, por tercera vez.
- **No:** 409 cuando el padre declara que no hubo atención médica. Suena a integridad y es una trampa de orden: el investigador que rellena el formulario de arriba abajo cargaría las instituciones antes de haber guardado la bandera.

**El `005C` de la evaluación clínica no se bloquea. Se vuelca.**

- **Sí:** volcado `warn` con el conteo, y la purga sigue. Quien la ejecuta es SUPERADMIN sobre una evaluación ya sellada; un bloqueo le obligaría a purgar en dos pasos con la única ventaja de un aviso que el log ya da. Es la línea de F13, F29, F30, F31, F32, F33 y F34.
- **No:** 409 cuando haya instituciones registradas. Además del argumento de arriba, el bloqueo sería **incompleto**: `ESAVI-INVESTGN-005C` destruye estas filas por el mismo `CASCADE` sin pasar por el servicio de la evaluación, así que la puerta cerrada tendría una ventana abierta al lado.

**Conteo y no snapshot por fila, y aquí no es solo estética.** F29, F30, F32 y F34 vuelcan snapshot porque son uno a uno y caben en una línea. Este spec no puede: un snapshot de estas filas escribiría **ciphertext de dos columnas PII en `esaviLog.log`**, que es un fichero de texto plano en disco. El conteo es la única forma correcta, y coincide además con el criterio que F31 fijó para las colecciones.

**Sin `006`.** Se entra por `/investigation/:id`, y ese `:id` es el que `ESAVI-INVCLIEV-006` ya devuelve a partir del `caseId`.

- **Sí:** la decisión de F24, F27 y F33. Un `006` por caso duplicaría la cadena de guardas —caso, investigación, evaluación clínica— para ahorrar una llamada que el cliente ya hace.
- **No:** la simetría con F31, F32 y F34, que sí lo tienen. La simetría es real y se rompe a conciencia: en aquéllas el `investigationId` no aparece en ninguna respuesta previa que el cliente tenga a mano, y aquí sí.

**La guarda de duplicado es solo el establecimiento, y solo contra activas.**

- **Sí:** es el único identificador comparable que la fila tiene. `institutionName` es texto libre y el tipo de institución no identifica nada por sí solo. Y compara contra **activas** porque una institución retirada no debe bloquear volver a cargar la misma: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`.
- **La consecuencia asumida:** un `005B` puede dejar dos instituciones activas con el mismo establecimiento, porque la reactivación no revalida la guarda. Se acepta a cambio de que reactivar siga siendo lo que dice ser —deshacer una desactivación— y no una segunda alta encubierta que pueda fallar por el estado de filas ajenas. Es la decisión de F27, F31 y F33, literal.
- **Y lo que no cubre:** dos instituciones de texto libre con el mismo nombre no colisionan. Está en §7.

**`005B` en ADMIN y no en SUPERADMIN.** La matriz canónica de §9 pone la activación en SUPERADMIN porque supone una delegación trivial. Aquí no lo es: lleva reasignación de `sortOrder` dentro de una transacción, y es una operación de administración del caso, no de administración del sistema. Es el precedente de F27, F31 y F33.

**El catálogo se siembra en el DDL y no desde la aplicación.**

- **Sí:** `upsertCatalogItem` ya existe (`:1473`), es idempotente por `ON CONFLICT` y es como se sembraron `healthFacilityType`, `sex`, `ageUnit` y los demás. Cinco líneas junto a las suyas es la forma que el repositorio ya tiene.
- **No:** un `008` de siembra como el de `systemConfig`, ni un fichero declarativo en `src/data/`. Aquel spec lo necesitaba porque sus valores por defecto cambian con el tiempo y hay que reponerlos tras desplegar; cinco tipos de institución no cambian, y darles endpoint propio sería superficie HTTP a cambio de nada.
- **No:** dejarlo como precondición externa documentada. Sin el catálogo, `evaluationInstitutionTypeItemId` es inservible y todo `POST` con tipo responde 404: sembrarlo fuera del spec convertiría un requisito en una nota que alguien tiene que leer.

**El eslabón intermedio se comprueba por `deletedAt`.** No hay alternativa: `investigationClinicalEvaluation` no tiene `isActive`. Es la segunda vez que una cadena de visibilidad del repositorio atraviesa una tabla sin estado propio —F33 fue la primera—, y el `paranoid: false` del `include` es lo que permite ver la fila sellada en vez de que el `include` la esconda y convierta un 404 explicado en un 404 mudo.

**La guarda del padre falla también para SUPERADMIN en el `001` y en las comprobaciones 1 y 2 de los listados.** `canViewInactive` relaja la **visibilidad**, no la **existencia**: una evaluación que no existe no tiene instituciones que listar bajo ningún rol, y una sellada no recibe filas nuevas ni siquiera de quien puede verla. Lo que sí se relaja para SUPERADMIN es el `isActive` de la investigación, que es estado y no existencia.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El ciphertext no cabe en `varchar(250)`.** `esaviCrypt` alarga el texto, y un `personName` largo produciría un error del driver en vez de un 400 del validador | El límite del validador es **120** y no 250, declarado en §3.3 y verificado en el paso 4 del plan. Es la trampa que ninguna spec anterior tuvo porque `appUser` y `patient` cifran sobre columnas `text` |
| **El nombre de la columna `investigationId` invita a asociarla con `Investigation`.** Un `belongsTo` mal escrito compilaría, y el `include` funcionaría —el UUID es el mismo— hasta el día en que existan evaluaciones clínicas sin investigación o al revés | §3.2 lo declara explícitamente y el paso 3 del plan lo verifica por su nombre. Es el mismo riesgo que F33 §7 documentó, y vuelve idéntico. La guarda del `001` sobre una evaluación inexistente con investigación viva es el caso que lo destapa, y está en el criterio 9 |
| **Copiar `CREATE_FIELDS` de las hermanas por inercia.** Funcionaría, y dejaría en el código una defensa sin causa | El criterio 4 exige que **no exista** la constante, y §1.B y §6 explican por qué. Es la verificación que convierte una ausencia en una decisión |
| **Dos instituciones de texto libre con el mismo nombre no colisionan.** La guarda compara `healthFacilityId`, así que cargar «Hospital del Niño» dos veces sin establecimiento produce dos filas | Asumido y declarado en §2. Deduplicar texto libre exige normalizar acentos y decidir umbrales de parecido; es lo mismo que F31 §7 dejó abierto para `fullName` y F33 para `conditionRaw` |
| **El `005B` puede reactivar una institución que apunta a un `healthFacility` retirado entretanto.** La reactivación no revalida los maestros | Declarado en §6 y en el criterio 35. Revalidarlos convertiría el `005B` en una segunda alta encubierta que puede fallar por el estado de filas ajenas, que es justo lo que F27, F31 y F33 decidieron evitar |
| **La reasignación del `005B` manda la institución al final de la lista**, y el orden que el investigador había dado se pierde | Es el mismo comportamiento de F16, F27, F31 y F33. El `007` de reordenación, fuera de alcance, es lo que lo resolverá; hasta entonces el orden se corrige retirando y volviendo a cargar |
| **El `005A` libera el `sortOrder` y otra institución puede tomarlo**, de modo que dos filas —una viva, una retirada— comparten número hasta que el `005B` lo arregle | Es la razón de ser del `005B` con reasignación, y el índice único parcial no se viola porque la retirada está fuera de él. Criterio 33 |
| **Un volcado por fila filtraría PII cifrada al log.** `esaviLog.log` es texto plano en disco | Los dos volcados son **conteo**, nunca snapshot, y el criterio 37 lo verifica explícitamente. Es la primera vez que el criterio de F31 para las colecciones deja de ser estético |
| **La purga de una investigación destruye las instituciones sin auditoría**, dos saltos más abajo y fuera de todo servicio | El volcado `warn` es la única mitigación posible sin bloquear, y es la que este spec añade. Declarado en §6 |
| **Sin el catálogo sembrado, todo `POST` con tipo responde 404** y el motivo es indistinguible de un UUID mal escrito | Por eso la siembra entra en este spec y no queda como precondición externa. El criterio 2 la verifica, y la idempotencia del procedimiento hace que ejecutar el DDL dos veces sea seguro |

---

## Lo que **no** está en este spec

- Denormalizar el nombre del establecimiento en `institutionName`, ni compararlos entre sí en ningún sentido.
- Cualquier guarda de coherencia entre las instituciones y los campos de la evaluación clínica padre.
- Bloquear `ESAVI-INVCLIEV-005C` o `ESAVI-INVESTGN-005C` cuando existan instituciones.
- Las otras seis satélites de `investigation`: `investigationCovidHistory`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- Reordenar instituciones — el `007` que F16, F27, F31 y F33 dejaron abierto.
- Un `006` por `caseId`.
- Filtros de listado por establecimiento, por tipo o por texto.
- Buscar u ordenar por `personName` o `personContact` — imposible mientras estén cifradas.
- Deduplicar instituciones de texto libre.
- Incluir las instituciones en la respuesta de `investigationClinicalEvaluation`.
- Modificar `esaviapp.sql` más allá del índice y las cinco `CALL`, ni `purgeEntityService`, `setEntityActiveStatusService` o `satelliteCascade.service.ts`.
- Extraer `normalizeText` a un helper compartido.
- Crear instituciones automáticamente al dar de alta una evaluación clínica.
- Exponer o editar `sysDetails`.
