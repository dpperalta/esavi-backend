# SPEC F32 — CRUD de `investigationMedicalHistory`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), **SPEC F29 y SPEC F30 (`investigationSource` e `investigationAutopsy` — hermanas de forma: aportan el patrón de satélite uno a uno, la visibilidad heredada y los tres arrastres del `deletedAt` que este spec extrae a un servicio común)**, SPEC F13 y SPEC F14 (patrón de satélite sin `isActive`), **SPEC F25 (`notificationPregnancy` — aporta el tri-estado de `answerOption` sobre datos de embarazo)**, **SPEC F27 (`notificationPregnancyComplication` — aporta el patrón de validación de una FK a `catalogItem` contra su `catalogType`)**, SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-23
> **Objetivo:** Dar de alta `investigationMedicalHistory` —los antecedentes médicos, familiares y gestacionales del paciente investigado— como la **cuarta** de las catorce tablas satélite de `investigation`, y extraer a un servicio común el arrastre del `deletedAt` que F29 y F30 duplicaron.

---

## 1. Por qué existe este spec

`investigationMedicalHistory` responde al bloque de anamnesis del formulario de investigación: si el paciente había estado hospitalizado antes, si hay antecedentes familiares relevantes, y —cuando aplica— todo el detalle del embarazo y del nacimiento. Quince datos que el investigador recoge preguntando, no midiendo.

Hoy la tabla existe en `esaviapp.sql:1038-1065` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **cuarta de las catorce satélites de `investigation`**, después de las que dieron de alta el [SPEC F29](./29-investigationsource-crud.md), el [SPEC F30](./30-investigationautopsy-crud.md) y el [SPEC F31](./31-investigationteammember-crud.md). De forma es hermana de las dos primeras y **no** de la tercera, y los cuatro rasgos que aquéllas fijaron se cumplen aquí sin matices. Se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`esaviapp.sql:1039`) y destino de `FK_investigationMedicalHistory_investigation` (`:1060`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **quinta** del repositorio así, tras `severeNotification`, `nonSevereNotification`, `investigationSource` e `investigationAutopsy`. De ahí sale, igual que allí, que **no haya `005A` ni `005B`**.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1368-1381`), así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar.
- **Solo lleva el trigger genérico.** `TRG_investigationMedicalHistory_setSysDetails`, del bucle de `esaviapp.sql:1286-1301`. **No existe `TRG_investigationMedicalHistory_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—: `updatedAt` lo escribe la aplicación.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco.** Cuatro cosas:

**A — Es la primera satélite de `investigation` que consume `answerOption`, y son cinco columnas.** `hasPriorHospitalizationHistory`, `hasFamilyHistory`, `isPregnancyConfirmed`, `hasPregnancyRiskFactor` y `wasBreastfed` son el ENUM de cinco valores (`esaviapp.sql:26`), no booleanos. F29 declaraba ocho booleanos planos y F30 tres; el patrón viene de F13 y F25, no de sus hermanas de padre. La diferencia no es cosmética: sobre `answerOption` el «no» tiene **tres formas distintas** —`'NO'`, `'UNKNOWN'` y `'NOT_APPLICABLE'`— más el `null` de «no se preguntó», y toda regla de coherencia de §3.5 se escribe contra `=== 'YES'`, nunca contra la veracidad del valor.

**B — Es la primera del repositorio con una columna `numeric` de dominio.** `birthWeightGrams numeric(8,2)` (`:1052`). `pg` la devuelve como **cadena** —`'3250.00'`, no `3250`—, así que un cliente que reenvíe el número que le dio el `GET` produciría una diferencia inventada en cada apertura del formulario si el diff comparara con `!==`. `buildDifferentialUpdate` ya cubre exactamente ese caso con su regla de cadena-numérica contra número, y por eso el spec no añade helper alguno: lo que sí tiene que declarar es que el modelo va en `DECIMAL(8, 2)` y no en `FLOAT`, que es donde se rompería.

**C — Tiene cuatro FK a `catalogItem` y ninguno de sus cuatro catálogos está sembrado.** El DDL siembra ocho `catalogType` —`administrationRoute`, `ageUnit`, `healthFacilityType`, `investigationStatus`, `outcome`, `pharmaceuticalForm`, `sex`, `userStatus`— y ninguno de los cuatro que esta tabla necesita. Es la misma situación que F28 tuvo con `vaccinationSite` y F27 con `pregnancyComplicationType`, y se resuelve igual: el servicio valida contra el `catalogType` por código y el sembrado se declara **precondición de despliegue**, no implementación.

**D — Es el spec que salda la deuda que F30 dejó anotada.** Su §7 escribió, palabra por palabra, que «ésta es la segunda copia del mismo arrastre: si la tercera satélite vuelve a duplicarlo, ése es el momento de extraer un servicio común». F31 no llegó a serlo —tiene `isActive` propio y por eso no arrastra nada—, así que **ésta es la tercera**. El spec extrae `cascadeSealSatellite` y `cascadeClearSatellite` a `src/services/common/satelliteCascade.service.ts` y **migra a F29 y F30 a ese servicio** antes de dar de alta el suyo. Es la única parte del spec que toca código ya implementado, y es deliberada: dejar el helper con un solo consumidor produciría tres implementaciones vivas del mismo arrastre en vez de una.

**Y una tabla que depende de ésta y no existe todavía.** `investigationPregnancyCondition` (`esaviapp.sql:1067-1082`) apunta su FK a `investigationMedicalHistory("investigationId")`, no a `investigation`. Sin esta fila no puede existir ninguna condición de embarazo. Queda **fuera de alcance** —su propio spec—, pero la dependencia se declara aquí porque condiciona el orden en que se implementan las catorce satélites.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationMedicalHistory`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29 y F30 mantuvieron.
- **Listado dual `002A` / `002B`**, heredado de F29 y F30: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve antecedentes cuya investigación está activa; `002B` en `GET /admin` para ADMIN los devuelve todos.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear el segundo antecedente de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVMEDH_001_INVESTIGATION_NOT_FOUND`; no tiene ya antecedentes, sin filtrar por `deletedAt` → 409 `INVMEDH_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, el antecedente responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Alta vacía.** Las quince columnas de datos son anulables y **ninguna es obligatoria**: `POST { investigationId }` devuelve **201** con las quince en `null`. La fila se abre como borrador y se completa por `PUT`. Es el patrón de F13, F14 y F29, y lo contrario de F30, que exigía `isDeath` y `deathDate`.
- **`investigationId` inmutable en el `004`:** se ignora en silencio si llega, sin 400, igual que en F29 y F30.
- **Cinco columnas `answerOption`** —`hasPriorHospitalizationHistory`, `hasFamilyHistory`, `isPregnancyConfirmed`, `hasPregnancyRiskFactor`, `wasBreastfed`— validadas contra `ANSWER_OPTIONS` (`src/constants/enums.constants.ts:8`) y anulables. `null` («no se preguntó») y `'NO_ANSWER'` («se preguntó y no contestó») son datos distintos y no se funden, como fijó F13.
- **El bloque de embarazo gobernado por `isPregnancyConfirmed`.** Con el valor resultante distinto de `'YES'`, los **nueve** campos gestacionales están **prohibidos**: `gestationalWeeks`, `gestationMethodItemId`, `deliveryItemId`, `birthItemId`, `pregnancyOutcomeItemId`, `hasPregnancyRiskFactor`, `riskFactorDescription`, `birthWeightGrams` y `wasBreastfed`. Con la asimetría `001` / `004` de F29 y F30: **400** en el alta, y en el update **forzado a `null` como derivado condicional** si el cliente no los manda, **400** si los manda con contenido.
- **Ninguna otra regla de coherencia.** Los dos textos de observaciones —`priorHospitalizationObservations` y `familyHistoryObservations`— **no** están atados a su bandera: se pueden guardar con la bandera en cualquier valor, `null` incluido. Es la opción deliberadamente contenida; la razón está en §6.
- **Cuatro FK a `catalogItem`, validadas contra su `catalogType` por código**, con el patrón de F27 y F28: el ítem existe, está `isActive: true` y pertenece al `catalogType` indicado → si no, **404** con clave propia por cada uno.
  - `gestationMethodItemId` → `catalogType` de código `gestationMethod`.
  - `deliveryItemId` → `catalogType` de código `deliveryType`.
  - `birthItemId` → `catalogType` de código `birthCondition`.
  - `pregnancyOutcomeItemId` → `catalogType` de código `pregnancyOutcome`.
- **Los cuatro catálogos resueltos en la respuesta**, en **todas** las operaciones, listados incluidos: `{ catalogItemId, code, name }` bajo los alias `gestationMethod`, `delivery`, `birth` y `pregnancyOutcome`. Cinco `LEFT JOIN` por fila contando el del padre. Es lo que hace F27 con su `complicationType`.
- **Los dos `CHECK` del DDL replicados en el validador:** `gestationalWeeks` con `isInt({ min: 0, max: 45 })` y `birthWeightGrams` con `isFloat({ min: 0 })`, los dos a 400 con `common.validationError` y sin clave i18n propia.
- **`birthWeightGrams` en `DataTypes.DECIMAL(8, 2)`**, comparado en el diff por la regla de cadena-numérica de `buildDifferentialUpdate` que ya existe. No se añade helper alguno.
- **Normalización al escribir:** `.trim()` sobre los tres textos libres. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
- **Extracción del arrastre a un servicio común.** `cascadeSealSatellite` y `cascadeClearSatellite` en `src/services/common/satelliteCascade.service.ts` —archivo nuevo—, parametrizados por modelo y por código de operación. **F29 y F30 se migran a él en este spec**, en un paso propio y antes de dar de alta el arrastre de esta entidad. Salda lo que F30 §7 dejó anotado.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre**, ya sobre el servicio común: `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica tocar `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto a los dos que F29 y F30 ya dejaron puestos.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVMEDH_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**, porque el control de `isActive` de `purgeEntityService` es inerte sobre una tabla que no tiene esa columna.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación. Orden `createdAt DESC`.
- Alta de la abreviatura **`INVMEDH`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationMedicalHistory.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F29** y el **SPEC F30** deben estar `Implementado`. No hay dependencia de modelo, pero sí de código: el paso de extracción los migra a los dos al servicio común, y sus suites de contrato son la red que prueba que la migración no cambió comportamiento.
- **Deben existir los cuatro `catalogType`** —`gestationMethod`, `deliveryType`, `birthCondition`, `pregnancyOutcome`— con sus `catalogItem` activos, cargados por los endpoints ya existentes de catálogos. **El DDL no los siembra.** Sin ellos, toda alta o edición que envíe uno de los cuatro UUID devuelve 404.

**Fuera de alcance (otros specs):**

- **Las otras diez satélites de `investigation`:** `investigationCovidHistory` (`esaviapp.sql:1014-1036`), `investigationPregnancyCondition` (`1067-1082`), `investigationClinicalEvaluation` (`1084-1107`), `evaluationInstitution` (`1109-1129`), `investigationVaccinationContext` (`1131-1152`), `investigationVaccineAdministered` (`1155-1169`), `investigationColdChain` (`1172-1194`), `investigationAdministrationError` (`1197-1231`) e `investigationCommunity` (`1234-1252`).
- **`investigationPregnancyCondition` en particular**, pese a colgar de esta tabla y no de `investigation`. Su `005C` se arrastra por `ON DELETE CASCADE` sin bloqueo, con volcado en `warn` como única mitigación, igual que F29 y F30 decidieron para el suyo.
- **Sembrar los cuatro `catalogType`** ni sus ítems. Es precondición de despliegue, no implementación.
- **Cualquier regla cruzada con `notificationPregnancy`.** Que aquella tabla registre `wasPregnantAtVaccination: 'YES'` no obliga a que `isPregnancyConfirmed` valga lo mismo aquí, ni al revés. Son dos momentos distintos del expediente —la notificación y la investigación— y atarlos exige antes decidir cuál manda.
- **Cualquier regla cruzada con `patient`**: que el sexo del paciente sea compatible con un embarazo, o que su `birthDate` sea coherente con `birthWeightGrams` y `wasBreastfed`. Ninguna se comprueba.
- **Cualquier regla cruzada con `investigationCovidHistory`**, que es la satélite de anamnesis contigua y todavía no existe.
- **Atar `priorHospitalizationObservations` y `familyHistoryObservations` a su bandera.** Es la opción (c) que se valoró y se descartó; §6 lo razona.
- **Derivar nada de `gestationalWeeks`** —prematuridad, trimestre, categoría de peso al nacer—. No hay ningún campo derivado en esta entidad.
- **Cualquier tablero, conteo o filtro por `isPregnancyConfirmed`** o por cualquier otra columna de datos. Los dos únicos filtros del listado son los de F29 y F30.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2 y sigue mereciendo su propio spec.
- **Modificar `esaviapp.sql`**: ni añadir `isActive`, ni un `CHECK` sobre el bloque de embarazo, ni meter `investigation` en `preventPhysicalDelete`, ni sembrar catálogos.
- **Modificar `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.** Los cuatro se consumen tal cual están.
- **Cambiar el comportamiento de F29 o de F30 al migrarlos** al servicio común. La migración es de forma, no de fondo: sus suites de contrato deben pasar sin tocar un solo caso.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene antecedentes.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión de F13, F29 y F30, heredada sin reabrirse.
- **Cifrado de ningún campo.** Ver §6: son datos clínicos de un paciente cuya identidad vive cifrada en `patient`, y ninguna columna de esta tabla identifica a nadie por sí sola.
- **Búsqueda por texto** sobre los tres campos libres.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationMedicalHistory` — `esaviapp.sql:1038-1065`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:1039`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationMedicalHistory_investigation` → `investigation`, `ON DELETE CASCADE` |
| `hasPriorHospitalizationHistory` | `answerOption` | sí | `:1040`. ENUM de cinco valores |
| `priorHospitalizationObservations` | `text` | sí | texto libre, sin longitud declarada |
| `hasFamilyHistory` | `answerOption` | sí | `:1042` |
| `familyHistoryObservations` | `text` | sí | texto libre |
| `isPregnancyConfirmed` | `answerOption` | sí | `:1044`. **Gobierna los nueve campos siguientes** |
| `gestationalWeeks` | `smallint` | sí | `CHECK ("gestationalWeeks" IS NULL OR "gestationalWeeks" BETWEEN 0 AND 45)` (`:1045`) |
| `gestationMethodItemId` | `uuid` | sí | `FK_investigationMedicalHistory_gestationMethod` → `catalogItem`, `ON DELETE RESTRICT` (`:1061`) |
| `deliveryItemId` | `uuid` | sí | `FK_investigationMedicalHistory_delivery` → `catalogItem`, `ON DELETE RESTRICT` (`:1062`) |
| `birthItemId` | `uuid` | sí | `FK_investigationMedicalHistory_birth` → `catalogItem`, `ON DELETE RESTRICT` (`:1063`) |
| `pregnancyOutcomeItemId` | `uuid` | sí | `FK_investigationMedicalHistory_pregnancyOutcome` → `catalogItem`, `ON DELETE RESTRICT` (`:1064`) |
| `hasPregnancyRiskFactor` | `answerOption` | sí | `:1050` |
| `riskFactorDescription` | `text` | sí | texto libre |
| `birthWeightGrams` | `numeric(8,2)` | sí | `CHECK ("birthWeightGrams" IS NULL OR "birthWeightGrams" >= 0)` (`:1052`). **Primera columna `numeric` de dominio del repositorio** |
| `wasBreastfed` | `answerOption` | sí | `:1053` |
| `notes` | `text` | sí | texto libre |

**Quince columnas de datos, las quince anulables.** Ninguna es `NOT NULL`, y de ahí sale directamente el alta vacía de §2: no hay nada que el cliente esté obligado a saber para abrir la fila.

**Restricciones.** Cinco claves foráneas —una al padre y cuatro a `catalogItem`— y **dos `CHECK`**, los dos de rango y los dos tolerantes con `NULL`. **Ninguna `UNIQUE`** —la PK ya lo es— y **ningún índice declarado** más allá del de la clave primaria. El bloque de embarazo **no está en el esquema**: lo impone íntegramente la aplicación, y por eso §3.5 es la sección larga de este spec.

**El ENUM `answerOption`** se declara en `esaviapp.sql:26` con cinco valores: `'YES'`, `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`. Ya vive en `src/constants/enums.constants.ts:8` como `ANSWER_OPTIONS`, consumido por `notification`, `severeNotification` y `notificationPregnancy`. **No se añade ninguna constante nueva.**

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. **Falta `isActive`**, igual que en `severeNotification`, `nonSevereNotification`, `investigationSource` e `investigationAutopsy`. Es la quinta tabla del repositorio así.

**Triggers.** Solo `TRG_investigationMedicalHistory_setSysDetails`, del bucle genérico de `esaviapp.sql:1286-1301`. La tabla no figura en el bucle `preventPhysicalDelete` (`:1368-1381`), así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco figura en `setSortOrderByParent`: no tiene `sortOrder`, y por tanto **nada del hallazgo del `005B` de F16 aplica aquí**.

**Una tabla cuelga de ésta.** `investigationPregnancyCondition` (`:1067-1082`) referencia `investigationMedicalHistory("investigationId")` con `ON DELETE CASCADE` (`:1080`). Fuera de alcance, pero condiciona el orden de implementación de las catorce satélites.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationMedicalHistory.model.ts`. Clase `InvestigationMedicalHistory`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationMedicalHistory'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14, F29 y F30: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- Las cinco `answerOption` — `DataTypes.ENUM(...ANSWER_OPTIONS)`, `allowNull: true`, importando `ANSWER_OPTIONS` y el tipo `AnswerOption` de `src/constants/enums.constants.ts`. Es el patrón exacto de `severeNotification.model.ts:51-67`.
- `gestationalWeeks` — `DataTypes.SMALLINT`, `allowNull: true`.
- Los cuatro `*ItemId` — `DataTypes.UUID`, `allowNull: true`.
- `birthWeightGrams` — **`DataTypes.DECIMAL(8, 2)`**, `allowNull: true`. Nunca `FLOAT` ni `DOUBLE`: la columna es `numeric(8,2)`, `pg` la devuelve como cadena, y la regla de comparación numérica de `buildDifferentialUpdate` está escrita para eso.
- Los cuatro textos — `DataTypes.TEXT`, `allowNull: true`.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationMedicalHistory.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationMedicalHistory.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationMedicalHistory, { as: 'medicalHistory', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `medicalHistory` no colisiona con `source` (F29), `autopsy` (F30) ni `teamMembers` (F31).
- Cuatro `belongsTo` a `CatalogItem`, uno por FK, con alias `gestationMethod`, `delivery`, `birth` y `pregnancyOutcome` sobre `gestationMethodItemId`, `deliveryItemId`, `birthItemId` y `pregnancyOutcomeItemId`. **Sin inverso declarado**: `CatalogItem` no gana ningún `hasMany`, igual que en F27.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `medicalHistory` **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationMedicalHistory.types.ts`, junto a los de `investigation`, `investigationSource`, `investigationAutopsy` e `investigationTeamMember`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationMedicalHistoryInput {
    investigationId: string;
    hasPriorHospitalizationHistory?: AnswerOption | null;
    priorHospitalizationObservations?: string | null;
    hasFamilyHistory?: AnswerOption | null;
    familyHistoryObservations?: string | null;
    isPregnancyConfirmed?: AnswerOption | null;
    gestationalWeeks?: number | null;
    gestationMethodItemId?: string | null;
    deliveryItemId?: string | null;
    birthItemId?: string | null;
    pregnancyOutcomeItemId?: string | null;
    hasPregnancyRiskFactor?: AnswerOption | null;
    riskFactorDescription?: string | null;
    birthWeightGrams?: number | null;
    wasBreastfed?: AnswerOption | null;
    notes?: string | null;
}
```

**`investigationId` es el único campo obligatorio del tipo.** Los quince restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo.

`AnswerOption` se importa de `src/constants/enums.constants.ts`; **no se declara ningún tipo nuevo de enumerado**.

`birthWeightGrams` se tipa como `number` en la entrada —es lo que manda el cliente— y **se devuelve como cadena** en la respuesta, que es lo que da `DECIMAL`. La asimetría es real y está declarada en §3.7.

El update usa `Partial<CreateInvestigationMedicalHistoryInput>`. **No se declara `UpdateInvestigationMedicalHistoryInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Los cuatro códigos de catálogo se declaran como constantes del servicio, con el patrón de `notificationPregnancyComplication.service.ts:23`:

```ts
const GESTATION_METHOD_CATALOG_CODE = 'gestationMethod';
const DELIVERY_TYPE_CATALOG_CODE = 'deliveryType';
const BIRTH_CONDITION_CATALOG_CODE = 'birthCondition';
const PREGNANCY_OUTCOME_CATALOG_CODE = 'pregnancyOutcome';
```

**No van a `src/constants/investigation.constants.ts`**: solo los consume este servicio, igual que F27 mantuvo el suyo local.

### 3.4 Superficie HTTP

```
POST   /api/investigation-medical-histories                ESAVI-INVMEDH-001   USER        (nuevo)
GET    /api/investigation-medical-histories                ESAVI-INVMEDH-002A  USER        (nuevo)
GET    /api/investigation-medical-histories/admin          ESAVI-INVMEDH-002B  ADMIN       (nuevo)
DELETE /api/investigation-medical-histories/purge/:id      ESAVI-INVMEDH-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-medical-histories/case/:caseId   ESAVI-INVMEDH-006   USER        (nuevo)
GET    /api/investigation-medical-histories/:id            ESAVI-INVMEDH-003   USER        (nuevo)
PUT    /api/investigation-medical-histories/:id            ESAVI-INVMEDH-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationMedicalHistory.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28, F29, F30 y F31, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar unos antecedentes es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationMedicalHistory` · `006` · obtener los antecedentes de un caso — la cadena `caso → investigación → antecedentes` es uno a uno en los dos saltos**.

**La abreviatura es `INVMEDH`.** Siete letras, no colisiona con las registradas y `grep "ESAVI-INVMEDH-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-` ni `ESAVI-INVTEAM-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

La regla del bloque de embarazo mira el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resultingPregnancy = data.isPregnancyConfirmed !== undefined
    ? (data.isPregnancyConfirmed ?? null)
    : stored.isPregnancyConfirmed
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**La comparación es siempre `=== 'YES'`.** Sobre `answerOption` el «no» tiene cuatro formas —`'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`— más el `null` de «no se preguntó», y las cinco cuentan igual: **el bloque está cerrado**. Escribir la regla contra la veracidad del valor la rompería, porque las cinco cadenas del ENUM son `truthy`.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| Las cinco `answerOption` dentro de `ANSWER_OPTIONS`, admitiendo `null` | validador | 400 `common.validationError` |
| `gestationalWeeks` entero entre 0 y 45 | validador | 400 `common.validationError` |
| `birthWeightGrams` decimal ≥ 0 | validador | 400 `common.validationError` |
| Los cuatro `*ItemId` con formato UUID, admitiendo `null` | validador | 400 `common.validationError` |
| Los cuatro `*ItemId` existentes, activos y de su `catalogType` | **servicio** | 404 `INVMEDH_<op>_<FK>_NOT_FOUND` |
| Campo del bloque de embarazo con `resultingPregnancy !== 'YES'` | **servicio** | 400 `INVMEDH_<op>_PREGNANCY_FIELDS_NOT_ALLOWED` |

Los dos rangos replican los `CHECK` del DDL y no necesitan estado guardado, así que viven en el validador y los responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio. **No generan clave i18n propia.**

#### La regla del bloque de embarazo

Con `resultingPregnancy === 'YES'`, los nueve campos gestacionales son **libres**: pueden faltar, llegar con valor o llegar en `null`. Marcar el embarazo como confirmado y no conocer todavía las semanas de gestación es un estado real del formulario.

Con `resultingPregnancy` distinto de `'YES'`, los nueve están **prohibidos**, y las dos operaciones se separan replicando la asimetría que F29 fijó para la fuente «otra» y F30 para sus dos fechas de autopsia:

- **`001` — es 400.** Mandar cualquiera de los nueve con contenido junto a un `isPregnancyConfirmed` no `'YES'` es `INVMEDH_001_PREGNANCY_FIELDS_NOT_ALLOWED`, con el nombre del primer campo infractor interpolado. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente lo manda.** Si el campo **no viaja en el body**, se **fuerza a `null`**: cerrar el bloque limpia sus nueve campos sin pedir permiso ni devolver error. Si **viaja con contenido**, sigue siendo 400 `INVMEDH_004_PREGNANCY_FIELDS_NOT_ALLOWED`: un body que niega el embarazo y a la vez fecha el parto se contradice a sí mismo, y tragárselo perdería el dato en silencio haciendo creer al cliente que se guardó. Mandarlo en `null` **no** es error: es el mismo destino al que el forzado llega solo.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** los nueve entran en `candidates` **siempre** que `resultingPregnancy` no sea `'YES'`, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difieren. Si la fila ya los tenía en `null`, el diff no encuentra nada y **no se escribe**: cerrar un bloque ya cerrado no crece `appDetails`.

**Los cuatro `*ItemId` se validan contra su catálogo solo cuando van a guardarse con contenido.** Un `*ItemId` que el forzado va a poner en `null` no se resuelve: no hay nada que buscar. La validación de FK va **antes** del diff y es independiente de él —un ítem inactivo es 404 aunque coincida con el guardado—, pero es posterior a la regla del bloque.

**Los dos textos de observaciones no están atados a nada.** `priorHospitalizationObservations` y `familyHistoryObservations` se guardan con su bandera en cualquier valor, `null` incluido. Es deliberado y §6 lo razona.

#### Validación de las cuatro FK a `catalogItem`

Idéntica en `001` y en `004`, con el patrón de `assertComplicationTypeIsValid` (`src/services/notificationPregnancyComplication.service.ts:203-212`): `CatalogItem.findOne` por `catalogItemId` con `isActive: true`, incluyendo `CatalogType` con `where: { code: <CÓDIGO> }`. Si no aparece → **404** con su clave propia:

| Campo | `catalogType` | `AppError` |
|---|---|---|
| `gestationMethodItemId` | `gestationMethod` | `INVMEDH_<op>_GESTATION_METHOD_NOT_FOUND` |
| `deliveryItemId` | `deliveryType` | `INVMEDH_<op>_DELIVERY_NOT_FOUND` |
| `birthItemId` | `birthCondition` | `INVMEDH_<op>_BIRTH_NOT_FOUND` |
| `pregnancyOutcomeItemId` | `pregnancyOutcome` | `INVMEDH_<op>_PREGNANCY_OUTCOME_NOT_FOUND` |

**Un ítem que existe pero pertenece a otro `catalogType` devuelve 404, no 200.** Es lo que impide que un `catalogItem` de `outcome` acabe guardado como método de gestación: la FK del DDL apunta a `catalogItem` sin distinguir el tipo, así que el filtro es la única defensa.

**Los cuatro catálogos sin sembrar convierten todo UUID en un 404.** Es precondición de despliegue, declarada en §2; el mensaje no distingue el caso, y esa ambigüedad se acepta a cambio de no añadir cuatro claves más.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Unos antecedentes cuya investigación está inactiva responden **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVMEDH-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVMEDH_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe antecedentes nuevos.
2. Esa investigación **no tiene ya antecedentes**, buscando **sin filtrar por `deletedAt`** → 409 `INVMEDH_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fila sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. La regla del bloque de embarazo, en su variante estricta.
4. Las cuatro FK a `catalogItem`, solo las que viajen con contenido.
5. Normaliza: `.trim()` sobre los cuatro textos. No hay `code` ni `name`.
6. Inserta con la entrada de auditoría `method: 'ESAVI-INVMEDH-001'`.

**El alta mínima es `{ investigationId }`** y devuelve 201 con las quince columnas de datos en `null`.

**`ESAVI-INVMEDH-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, los cuatro includes de catálogo en `required: false`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**El orden es `createdAt DESC`**, como en F29 y a diferencia de F30. Esta entidad no tiene ninguna fecha del dominio que ordene mejor: sus quince columnas son respuestas de anamnesis, no hechos fechados.

**`ESAVI-INVMEDH-002B` — listar, admin.** Idéntica, con el include del padre en `where: {}`: devuelve también los antecedentes de investigaciones inactivas. Los mismos dos filtros, los mismos cuatro includes de catálogo y el mismo orden.

**`ESAVI-INVMEDH-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVMEDH_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVMEDH-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVMEDH_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVMEDH_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene antecedentes → 404 `INVMEDH_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVMEDH-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVMEDH_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Unos antecedentes no se trasladan entre investigaciones.
3. Cálculo de `resultingPregnancy` y la regla del bloque de embarazo. **Antes del diff y con independencia de él.**
4. Las cuatro FK a `catalogItem`, solo las que vayan a guardarse con contenido. **Antes del diff y con independencia de él.**
5. `stored` sale de `history.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
6. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
7. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `hasPriorHospitalizationHistory` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Fuera del bloque de embarazo** |
| `priorHospitalizationObservations` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, `.trim()` antes de comparar. Fuera del bloque |
| `hasFamilyHistory` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. Fuera del bloque |
| `familyHistoryObservations` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, `.trim()`. Fuera del bloque |
| `isPregnancyConfirmed` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Es la llave del bloque, y no forma parte de él** |
| `gestationalWeeks` | con `'YES'`: `data.x !== undefined ? (data.x ?? null) : undefined` — si no: **siempre `null`** | **derivado condicional** |
| `gestationMethodItemId` | ídem | derivado condicional |
| `deliveryItemId` | ídem | derivado condicional |
| `birthItemId` | ídem | derivado condicional |
| `pregnancyOutcomeItemId` | ídem | derivado condicional |
| `hasPregnancyRiskFactor` | ídem | derivado condicional |
| `riskFactorDescription` | con `'YES'`: `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` — si no: **siempre `null`** | derivado condicional, con `.trim()` |
| `birthWeightGrams` | con `'YES'`: `data.x !== undefined ? (data.x ?? null) : undefined` — si no: **siempre `null`** | derivado condicional. **Se compara por la regla numérica del helper**: `stored` llega como cadena `'3250.00'` |
| `wasBreastfed` | con `'YES'`: `data.x !== undefined ? (data.x ?? null) : undefined` — si no: **siempre `null`** | derivado condicional |
| `notes` | `data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined` | anulable, `.trim()`. Fuera del bloque |

**Ningún campo va bajo un `if( data.x )`.** Sobre las cinco `answerOption` un `if` de veracidad funcionaría por accidente —las cinco cadenas del ENUM son `truthy`— pero descartaría en silencio el `null` con el que se vacía el campo. Sobre `gestationalWeeks` sería directamente destructivo: **`0` es un valor válido** del `CHECK` y un `if` lo tiraría. Lo mismo con `birthWeightGrams`. **Ningún campo va cifrado.**

**`isPregnancyConfirmed` es la llave del bloque y no está gobernado por él.** Entra como anulable corriente: es el campo que decide, no uno de los decididos.

**`ESAVI-INVMEDH-005C` — purgar.** `purgeInvestigationMedicalHistoryService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** la visibilidad heredada —quien purga es SUPERADMIN y la fila puede colgar de una investigación retirada— → 404 `INVMEDH_005C_NOT_FOUND`; guarda de sellado con `assertRowIsSealed(row, 'INVMEDH_005C_NOT_DELETED', lang)` → 409 si `deletedAt` está vacío; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` —la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6.

**La guarda de sellado es la única red de seguridad de la tabla.** El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** aquí: la columna no existe, `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró nunca. Es la misma situación de F29 y F30, y la contraria a F31. `assertRowIsSealed` se consume **sin modificarlo**: deriva la clave `investigationMedicalHistory.notDeleted` del nombre de tabla y el id del `primaryKeyAttribute` del modelo.

**Purgar sí libera el `investigationId`**, y es la única vía que lo hace. Tras un `005C`, un `POST` sobre esa misma investigación devuelve 201. **Y arrastra por `ON DELETE CASCADE` todas las `investigationPregnancyCondition` de esa investigación**, cuando esa tabla exista.

#### El servicio común de arrastre, y los tres arrastres

Sin `isActive`, lo que las cascadas mueven es el sello de `deletedAt`. Los tres son `update` masivos, no lecturas seguidas de escrituras por fila.

**`src/services/common/satelliteCascade.service.ts` — archivo nuevo.** Dos funciones parametrizadas por modelo y por código de operación:

- `cascadeSealSatellite({ model, where, method, transaction })` — sella `deletedAt` y `updatedAt` sobre las filas que aún no lo tengan sellado, y añade a `appDetails` una entrada con el `method` recibido.
- `cascadeClearSatellite({ model, where, method, transaction })` — devuelve `deletedAt` a `null` y registra su entrada.

**F29 y F30 se migran a las dos.** Sus cuatro funciones actuales en `investigation.service.ts` y sus dos en `esaviCase.service.ts` pasan a ser llamadas al servicio común con su modelo y su `method`. **El comportamiento no cambia**: sus suites de contrato son la red que lo prueba, y ningún caso suyo se toca.

**`ESAVI-INVESTGN-005A` — sellar.** Dentro de la transacción que `setInvestigationActivationService` ya abre y **solo cuando `isActive === false`**, sella la fila de antecedentes de esa investigación con `method: 'ESAVI-INVESTGN-005A'` —el código de la operación que la arrastró, no el suyo—. Una investigación sin antecedentes sella cero filas y no falla. Una fila ya sellada conserva su `deletedAt` original y **no** recibe entrada nueva.

**`ESAVI-CASE-005A` — sellar también.** En `src/services/esaviCase.service.ts`, **novena** función hermana junto a las ocho que F29 y F30 dejaron, invocada en el mismo bloque. Es necesaria y no redundante, por la razón exacta que F29 §3.5 documentó: desactivar el caso arrastra la investigación con un `Investigation.update` masivo que **no** pasa por `setInvestigationActivationService`, así que la cascada del punto anterior nunca dispara desde aquí. Alcanza a los antecedentes cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`. Registra `method: 'ESAVI-CASE-005A'`.

**`ESAVI-INVESTGN-005B` — limpiar.** Devuelve `deletedAt` a `null` al reactivar la investigación. Es una **cascada de subida**, legítima por lo mismo que en F29 y F30: el `deletedAt` de los antecedentes no significa «alguien los retiró», significa «su investigación estaba retirada». Registra `method: 'ESAVI-INVESTGN-005B'`. **`ESAVI-CASE-005B` no limpia nada**, coherente con F07, F29 y F30.

**Ninguno de los tres pasa por `buildDifferentialUpdate`, y es deliberado:** son escrituras con intención propia. Registran el hecho de sellar o devolver la fila, y ese registro en `appDetails` es precisamente lo que se quiere conservar.

**Volcado del `ESAVI-INVESTGN-005C`.** El purgado de una investigación arrastra sus antecedentes por `ON DELETE CASCADE` sin pasar por ningún servicio. Se añade a `purgeInvestigationService` un volcado en nivel `warn` de la fila que va a desaparecer, **junto a los dos que F29 y F30 dejaron**, antes del `destroy` y dentro de la misma transacción. **No se bloquea la purga.**

**Validaciones de forma** (las emite `validateFields` con 400): en el `001`, `investigationId` obligatorio y `.isUUID()`; en los dos, las cinco `answerOption` con `.isIn(ANSWER_OPTIONS)` admitiendo `null`, `gestationalWeeks` con `.isInt({ min: 0, max: 45 })` admitiendo `null`, `birthWeightGrams` con `.isFloat({ min: 0 })` admitiendo `null`, los cuatro `*ItemId` con `.isUUID()` admitiendo `null`, y los cuatro textos como cadena. `caseId` con `.isUUID()` en el `param` del `006`; los dos filtros del listado con `.isUUID()`, y `limit` y `offset` con `.isInt()`.

### 3.6 Claves i18n nuevas

Bloque `investigationMedicalHistory` en `src/data/i18n/es.json`, `en.json` y `nl.json` — **veintiuna claves**:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005C` y `006` |
| `idRequired` | parámetro ausente |
| `notDeleted` | 409 al purgar una fila sin `deletedAt` sellado. La deriva `assertRowIsSealed` del nombre de tabla, y lleva `{{id}}` |
| `investigationNotFound` | 404 cuando la investigación no existe o está inactiva, en `001` y en `006` |
| `alreadyExists` | 409 cuando la investigación ya tiene antecedentes, sellados o no. Lleva `{{investigationId}}` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |
| `gestationMethodNotFound` | 404 cuando el ítem no existe, está inactivo o es de otro `catalogType` |
| `deliveryNotFound` | ídem para `deliveryItemId` |
| `birthNotFound` | ídem para `birthItemId` |
| `pregnancyOutcomeNotFound` | ídem para `pregnancyOutcomeItemId` |
| `pregnancyFieldsNotAllowed` | 400 al mandar un campo del bloque de embarazo con `isPregnancyConfirmed` resultante distinto de `'YES'`. Lleva `{{field}}` con el nombre del primer campo infractor. **En el `001` siempre; en el `004` solo cuando el campo viaja en el body** |

**Una sola clave para los nueve campos del bloque**, con el nombre interpolado. Nueve claves distintas dirían lo mismo nueve veces y multiplicarían por tres los archivos i18n sin añadir información al cliente.

**Los dos rangos no llevan clave propia:** los emite el validador y los responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio.

**No hay `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`**: no existen las operaciones que las usarían. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave a los bloques `investigation` ni `esaviCase`: los tres arrastres no producen mensajes propios, y la migración de F29 y F30 al servicio común **no toca ninguna clave existente**.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004`, `006` y **también las filas de `002A` y `002B`**:

```
{ ok, message, data: {
    investigationId,
    hasPriorHospitalizationHistory, priorHospitalizationObservations,
    hasFamilyHistory, familyHistoryObservations,
    isPregnancyConfirmed, gestationalWeeks,
    gestationMethodItemId, deliveryItemId, birthItemId, pregnancyOutcomeItemId,
    hasPregnancyRiskFactor, riskFactorDescription,
    birthWeightGrams, wasBreastfed, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    gestationMethod:  { catalogItemId, code, name } | null,
    delivery:         { catalogItemId, code, name } | null,
    birth:            { catalogItemId, code, name } | null,
    pregnancyOutcome: { catalogItemId, code, name } | null,
    investigation: {
        investigationId, isActive, investigationStartDate,
        status: { catalogItemId, code, name },
        case:   { caseId, caseCode, eventDate }
    }
} }
```

**No hay forma reducida.** El listado devuelve la misma ficha que el `003`, por la misma razón que en F29 y F30: quince columnas de datos, y recortarlas dejaría un listado sin contenido.

**Los cuatro UUID viajan además de su objeto resuelto.** El cliente que solo necesita el identificador no tiene que entrar en el objeto, y el que pinta el formulario tiene el `name` sin pedir el catálogo aparte. Los cuatro objetos llegan **`null`** cuando su columna lo es, que es el estado normal fuera del bloque de embarazo.

**`birthWeightGrams` se devuelve como cadena** —`'3250.00'`—, que es lo que da `DECIMAL` a través de `pg`. **No se convierte a número al construir la respuesta**: convertirlo obligaría a reconvertir antes de comparar en el diff y reabriría por otro lado el problema que la regla numérica del helper ya resuelve. El cliente recibe la cadena y la formatea.

**Las cinco `answerOption` se devuelven exactamente como se guardaron, `null` incluido**: un `null` significa que el formulario no recogió la respuesta y un `'NO_ANSWER'` que se preguntó y no se contestó.

**No se devuelve `isActive`**, porque la tabla no tiene esa columna. `deletedAt` es la única marca de estado que la fila lleva, e `investigation.isActive` es la fuente real de su visibilidad.

El include de la investigación es **obligatorio y no decorativo**: es lo que implementa la visibilidad heredada. Su `status` viaja resuelto y **nunca llega `null`**, por la regla que el F28 §3.5 impuso a aquella entidad. `sysDetails` **nunca** se devuelve, ni el de los antecedentes, ni el de la investigación, ni el de los cuatro `catalogItem`. Ninguna respuesta incluye datos de las otras trece tablas satélite.

---

## 4. Plan de implementación

**Precondiciones.** El **SPEC F28** debe estar `Implementado` —la PK de esta tabla es su FK—, y el **SPEC F29** y el **SPEC F30** también: el paso 1 los migra al servicio común y sus suites de contrato son la única red que prueba que la migración no cambió comportamiento. Los cuatro `catalogType` deben estar sembrados antes de poder ejercitar las FK.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Extraer el servicio común de arrastre y migrar F29 y F30.** `src/services/common/satelliteCascade.service.ts` con `cascadeSealSatellite` y `cascadeClearSatellite`, parametrizadas por modelo, `where`, `method` y `transaction`. Las cuatro funciones `cascade*` de `src/services/investigation.service.ts` y las dos de `src/services/esaviCase.service.ts` pasan a ser llamadas a las nuevas. **Sin ningún cambio de comportamiento**: mismo sellado, misma entrada en `appDetails`, mismo `method`, misma transacción. Va primero porque es el paso de corrección y porque los pasos 11 y 12 lo consumen; si algo se rompe, que se rompa con superficie pequeña y con las dos suites hermanas todavía intactas para detectarlo.
   *Verificación:* `npm run check` en 0 **sin tocar un solo caso** de `tests/contract/investigationSource.test.ts`, `investigationAutopsy.test.ts`, `investigation.test.ts` ni `esaviCase.test.ts`; `grep -c "cascadeSeal\|cascadeClear" src/services/investigation.service.ts` devuelve las mismas invocaciones que antes; desactivar y reactivar una investigación con fuente y autopsia produce exactamente las mismas entradas en los dos `appDetails` que antes de la migración.

2. **Modelo, asociaciones y tipos.** `src/models/investigationMedicalHistory.model.ts` con la PK **sin `defaultValue`**, las cinco `answerOption` en `ENUM(...ANSWER_OPTIONS)`, `gestationalWeeks` en `SMALLINT`, `birthWeightGrams` en **`DECIMAL(8, 2)`**, los cuatro `*ItemId` en `UUID`, los cuatro textos en `TEXT`, y **sin atributo `isActive`**; `src/models/associations/investigationMedicalHistory.associations.ts` con el `belongsTo` a `Investigation` como `investigation`, el inverso `Investigation.hasOne(..., { as: 'medicalHistory' })` y los cuatro `belongsTo` a `CatalogItem` con sus alias, registrado en `initModels()`; `src/types/investigation/investigationMedicalHistory.types.ts` con `CreateInvestigationMedicalHistoryInput`, exportado por el `index.ts` de barrel del dominio. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `findAll` con los cinco includes desde un script suelto devuelve filas sin error de alias, y `medicalHistory` no colisiona con `source`, `autopsy` ni `teamMembers`; una fila leída devuelve `birthWeightGrams` como **cadena**; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `investigation`.

3. **Claves i18n.** El bloque `investigationMedicalHistory` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las **veintiuna** claves. **Sin `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`.** Ninguna clave para los dos rangos: ésos los responde `validateFields`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; `investigationMedicalHistory.notDeleted` existe en los tres archivos, que es lo que `assertRowIsSealed` resolverá en tiempo de ejecución sin que ningún `grep` estático lo vea; `pregnancyFieldsNotAllowed` interpola `{{field}}` en los tres idiomas.

4. **Validadores.** `src/validators/investigationMedicalHistory.validator.ts` con cinco arrays: `investigationMedicalHistoryIdValidator`, `investigationMedicalHistoryCaseIdValidator` (para el `param('caseId')` del `006`), `investigationMedicalHistoryListValidator` (los dos filtros más `limit` y `offset`), `createInvestigationMedicalHistoryValidator` y `updateInvestigationMedicalHistoryValidator`. El de create exige `investigationId` UUID; los dos comparten las cinco `answerOption` con `.isIn(ANSWER_OPTIONS)` admitiendo `null`, `gestationalWeeks` con `.isInt({ min: 0, max: 45 })`, `birthWeightGrams` con `.isFloat({ min: 0 })`, los cuatro `*ItemId` con `.isUUID()` admitiendo `null` y los cuatro textos como cadena. **La regla del bloque de embarazo no va aquí:** depende del estado guardado y vive en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; `gestationalWeeks: 46` produce 400 y `0` no; `gestationalWeeks: null` pasa; `birthWeightGrams: -1` produce 400 y `0` no; `hasFamilyHistory: 'MAYBE'` produce 400 y los cinco valores de `ANSWER_OPTIONS` no; `wasBreastfed: null` pasa.

5. **`ESAVI-INVMEDH-001` — crear.** `createInvestigationMedicalHistoryService` con los seis pasos de §3.5 en ese orden: investigación existente y activa, unicidad del `investigationId` sin filtrar por `deletedAt`, la regla del bloque de embarazo en su variante estricta, las cuatro FK contra su `catalogType`, `.trim()` de los cuatro textos, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* el alta mínima `{ investigationId }` devuelve **201** con las quince columnas en `null`; crear dos veces sobre la misma investigación devuelve **409** `INVMEDH_001_ALREADY_EXISTS` con el `investigationId` interpolado; una investigación inactiva devuelve **404**; `{ isPregnancyConfirmed: 'NO', gestationalWeeks: 38 }` devuelve **400** `pregnancyFieldsNotAllowed` con `gestationalWeeks` interpolado; `{ gestationalWeeks: 38 }` sin `isPregnancyConfirmed` devuelve **400** por la misma regla —`null` no es `'YES'`—; `{ isPregnancyConfirmed: 'YES', gestationalWeeks: 38 }` devuelve **201**; un `deliveryItemId` del `catalogType` `gestationMethod` devuelve **404** `deliveryNotFound`; un `gestationMethodItemId` inactivo devuelve **404**.

6. **`ESAVI-INVMEDH-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, el include de la investigación en `required: true` con su `status` y su `case`, los cuatro includes de catálogo en `required: false`, los dos filtros acumulativos, orden `[['createdAt','DESC']]`, paginación y la forma completa de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve antecedentes de investigaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los dos filtros combinados se aplican con `AND`; toda fila trae las quince columnas, los cuatro objetos de catálogo y `appDetails`; ninguna trae `isActive` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total; una fila sin catálogos resueltos trae los cuatro objetos en `null` y **no** desaparece del listado — es lo que prueba que los cuatro includes van en `required: false`.

7. **`ESAVI-INVMEDH-003` — obtener por ID.** `getInvestigationMedicalHistoryByIdService(id, lang, includeInactive)` donde el `id` es el `investigationId`, con los cinco includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una fila cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; una fila con `deletedAt` sellado pero investigación activa **sí se devuelve** —el sello no oculta la fila, la oculta el padre—; `investigation.status` no llega `null`; `birthWeightGrams` llega como cadena; `sysDetails` no aparece en ninguno de los seis objetos de la respuesta.

8. **`ESAVI-INVMEDH-006` — obtener por caso.** `getInvestigationMedicalHistoryByCaseIdService(caseId, lang, includeInactive)` con los **tres** 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `investigationMedicalHistoryCaseIdValidator`, declarada antes de `/:id`. Fila `investigationMedicalHistory` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y antecedentes devuelve 200 con la ficha completa, no envuelta en un array; un `caseId` inexistente devuelve 404 `INVMEDH_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVMEDH_006_INVESTIGATION_NOT_FOUND`; una investigación sin antecedentes devuelve 404 `INVMEDH_006_NOT_FOUND`. Los tres códigos son distintos entre sí; `GET /case/no-es-uuid` devuelve 400.

9. **`ESAVI-INVMEDH-004` — actualizar, diferencial.** `updateInvestigationMedicalHistoryService` con los siete pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` ignorado; los cinco campos de fuera del bloque como anulables corrientes; los nueve del bloque como **derivados condicionales**; `isPregnancyConfirmed` como anulable corriente porque es la llave y no uno de los gobernados. La lectura para el diff se hace **sin `attributes` acotados** y con el include del padre, para que la visibilidad heredada se compruebe en la misma consulta de la que sale la instancia. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; **`{ gestationalWeeks: 0 }` sobre una fila con `38` se guarda como `0`** y no se descarta; `{ hasFamilyHistory: null }` vacía el campo; enviar `investigationId` distinto no lo modifica y no devuelve error; **`{ birthWeightGrams: 3250 }` sobre una fila con `'3250.00'` guardado no escribe nada**; `{ isPregnancyConfirmed: 'NO' }` sobre una fila con las nueve columnas del bloque llenas las deja las nueve en `null` en la **misma** petición con **una** entrada en `appDetails`; `{ isPregnancyConfirmed: 'NO', gestationalWeeks: 38 }` devuelve **400**; `{ gestationalWeeks: 38 }` sobre una fila con `isPregnancyConfirmed: 'NO'` guardado devuelve **400** sin que la llave viaje en el body.

10. **`ESAVI-INVMEDH-005C` — purgar.** `purgeInvestigationMedicalHistoryService` sobre `purgeEntityService`, con transacción propia, existencia con `paranoid: false` y **sin** visibilidad heredada, y `assertRowIsSealed(row, 'INVMEDH_005C_NOT_DELETED', lang)` **antes** del `destroy`. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `investigationMedicalHistoryIdValidator` y declarada junto a las otras literales.
    *Verificación:* purgar una fila sin `deletedAt` sellado devuelve 409 `notDeleted` con el id interpolado y la fila sigue ahí — **es la comprobación que prueba que el control de `isActive` de `purgeEntityService` es inerte aquí**; desactivar la investigación y purgar devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre esa investigación devuelve 201**; la investigación, su `investigationSource`, su `investigationAutopsy` y sus `investigationTeamMember` siguen existiendo e intactos.

11. **Los dos arrastres desde `investigation` y el volcado del `005C`.** En `src/services/investigation.service.ts`, dos llamadas nuevas al servicio común del paso 1 desde `setInvestigationActivationService`: `cascadeSealSatellite` con `InvestigationMedicalHistory` y `method: 'ESAVI-INVESTGN-005A'` **solo cuando `isActive === false`**, y `cascadeClearSatellite` con `'ESAVI-INVESTGN-005B'` **solo cuando `isActive === true`**, las dos dentro de la transacción que aquel servicio ya abre y junto a las de F29 y F30. Más el volcado en `warn` de la fila en `purgeInvestigationService`, antes del `destroy` y en la misma transacción.
    *Verificación:* desactivar una investigación con antecedentes les sella `deletedAt`; reactivarla lo devuelve a `null`; una fila sellada a mano **antes** de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; una investigación sin antecedentes se desactiva y se reactiva sin error; el `appDetails` de la arrastrada registra `ESAVI-INVESTGN-005A` y luego `ESAVI-INVESTGN-005B`, con su historial anterior intacto; **los arrastres de `investigationSource` y de `investigationAutopsy` siguen funcionando igual** y las tres filas se sellan en la misma transacción; purgar una investigación con las tres deja **tres** líneas `warn` en `src/logs/esaviLog.log` y **no** devuelve error.

12. **El tercer arrastre, desde `esaviCase`.** En `src/services/esaviCase.service.ts`, **novena** función hermana junto a las ocho que F29 y F30 dejaron, invocada en el mismo bloque, dentro de la misma transacción y **solo cuando `isActive === false`**, ya sobre el servicio común. Alcanza a los antecedentes cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`, y registra `method: 'ESAVI-CASE-005A'`. Va después del paso 11 porque depende del modelo y no lo necesita ningún paso anterior. **`ESAVI-CASE-005B` no se toca.**
    *Verificación:* desactivar un caso con investigación y antecedentes **sella los antecedentes**, y ése es el punto entero del paso: sin él quedarían sin sellar, porque la investigación la arrastra un `update` masivo que no pasa por `setInvestigationActivationService`; reactivar el caso no limpia el sello; un caso sin investigación, o con investigación sin antecedentes, se desactiva sin error; las **ocho** cascadas anteriores siguen produciendo el mismo efecto.

13. **Registrar la entidad en las convenciones.** Fila `investigationMedicalHistory` → `INVMEDH` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationMedicalHistory` · `006` · «obtener los antecedentes de un caso — la cadena `caso → investigación → antecedentes` es uno a uno en los dos saltos» en la tabla de operaciones no canónicas.
    *Verificación:* `INVMEDH` aparece una sola vez y no colisiona con las registradas; la tabla de no canónicas suma exactamente una fila.

14. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más siete.
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/investigationMedicalHistory.test.ts`.** Recorrido completo con `supertest`: crear vacío → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → purgar. Más los caminos de error: investigación inexistente (404), investigación inactiva (404), investigación ya con antecedentes sellados y sin sellar (409 las dos), caso inexistente y caso sin investigación en el `006` (404 con códigos distintos), la regla del bloque de embarazo en sus variantes de `001` y de `004`, los cuatro 404 de catálogo —incluido el ítem de otro `catalogType`—, y purgar sin sellar (409). Más el bloque diferencial completo de §5, con cobertura explícita del **`0`** en `gestationalWeeks` y del **`birthWeightGrams` como cadena**. La suite siembra los cuatro `catalogType` en su `beforeAll` por los endpoints de catálogos.
    *Verificación:* `npm test -- investigationMedicalHistory` en verde.

16. **Ampliar `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera, tres casos: desactivar la investigación sella sus antecedentes, reactivarla los limpia, y purgar la investigación los destruye por cascada de Postgres sin devolver error. En la segunda, dos: desactivar el caso sella los antecedentes de su investigación, y reactivarlo no los limpia. **Los casos que F29 y F30 añadieron a las dos suites se mantienen intactos**, y los nuevos comprueban que las tres satélites se arrastran juntas por el mismo servicio común.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las seis operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVMEDH-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVMEDH-005[AB]" src/` no devuelve resultados: la entidad **no tiene** activación ni desactivación propias.
- [ ] `grep -rn "ESAVI-INVMEDH-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "isActive" src/models/investigationMedicalHistory.model.ts` no devuelve resultados: la tabla no tiene esa columna.
- [ ] `grep -n "FLOAT\|DOUBLE" src/models/investigationMedicalHistory.model.ts` no devuelve resultados: `birthWeightGrams` va en `DECIMAL(8, 2)`.
- [ ] El modelo importa `ANSWER_OPTIONS` de `src/constants/enums.constants.ts` y **no declara ninguna lista de valores propia**.
- [ ] `INVMEDH` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigationMedicalHistory` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` exporta el archivo nuevo.
- [ ] `GET /api/investigation-medical-histories/admin` y `.../case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Investigation.hasOne(InvestigationMedicalHistory, { as: 'medicalHistory' })` está declarado, no colisiona con `source`, `autopsy` ni `teamMembers`, y los antecedentes **no** aparecen en ninguna respuesta de `/api/investigations`.
- [ ] `git diff esaviapp.sql` está vacío.

**El servicio común de arrastre**

- [ ] `src/services/common/satelliteCascade.service.ts` existe y lo consumen **las tres** satélites sin `isActive` que arrastran: `investigationSource`, `investigationAutopsy` e `investigationMedicalHistory`.
- [ ] `tests/contract/investigationSource.test.ts` e `investigationAutopsy.test.ts` pasan **sin que se haya tocado un solo caso**. Es el criterio que prueba que la migración fue de forma y no de fondo.
- [ ] Desactivar una investigación con las tres satélites sella las **tres** en la misma transacción, y reactivarla las limpia las tres.
- [ ] El `appDetails` de cada una de las tres registra su `method` correcto: `ESAVI-INVESTGN-005A`, `ESAVI-INVESTGN-005B` o `ESAVI-CASE-005A`, según la operación que la arrastró.
- [ ] `grep -rn "cascadeSeal\|cascadeClear" src/services/investigation.service.ts src/services/esaviCase.service.ts` no muestra ninguna implementación, solo invocaciones al servicio común.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationMedicalHistory.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada: los cuatro `*ItemId` con un ítem desactivado, y un `PUT` sobre una fila cuya investigación está inactiva, que responde **404** para USER y ADMIN y **200** para SUPERADMIN.
- [ ] **`{ gestationalWeeks: 0 }` sobre una fila con `38` guarda `0`**, y `{ gestationalWeeks: null }` la vacía. Ningún candidato entra bajo un `if( data.x )`.
- [ ] **`{ birthWeightGrams: 3250 }` sobre una fila con `'3250.00'` guardado no cuenta como cambio.** Es el criterio que prueba que la comparación numérica del helper está actuando y que la columna no se declaró en `FLOAT`.
- [ ] `{ hasFamilyHistory: null }` sobre una fila con `'NO_ANSWER'` vacía el campo, y `{ hasFamilyHistory: 'NO_ANSWER' }` sobre esa misma fila **no** cuenta como cambio: `null` y `'NO_ANSWER'` son datos distintos y ninguno se convierte en el otro.
- [ ] `{ notes: "" }` deja el campo vacío, y un `notes` con espacios alrededor del mismo texto guardado **no** cuenta como cambio: el `.trim()` va antes de comparar.
- [ ] Reenviar los cuatro `*ItemId` tal como los devolvió el `GET` **no** cuenta como cambio y **no** vuelve a resolver ninguna FK como error.

**Campos inmutables y alta vacía**

- [ ] `POST { investigationId }` → **201**, con las quince columnas de datos en `null`. No hay ningún campo obligatorio más.
- [ ] `POST` sin `investigationId` → **400** del validador, nunca un error de integridad de Postgres. Es lo que verifica que la PK se declaró sin `defaultValue`.
- [ ] `PUT` con un `investigationId` distinto → no lo modifica y no devuelve error.
- [ ] `POST` o `PUT` con `gestationalWeeks: 46`, `gestationalWeeks: -1` o `birthWeightGrams: -1` → **400** del validador. Con `0` en cualquiera de los dos → **200**.
- [ ] `POST` o `PUT` con una `answerOption` fuera de los cinco valores → **400**. Con cada uno de los cinco → **200**.

**El bloque de embarazo**

- [ ] `POST` con `{ isPregnancyConfirmed: 'NO', gestationalWeeks: 38 }` → **400** `pregnancyFieldsNotAllowed`, con `gestationalWeeks` interpolado en `{{field}}`.
- [ ] `POST` con `{ gestationalWeeks: 38 }` y **sin** `isPregnancyConfirmed` → **400** por la misma regla. `null` no es `'YES'`.
- [ ] `POST` con `{ isPregnancyConfirmed: 'UNKNOWN', wasBreastfed: 'YES' }` → **400**. Las cuatro formas del «no» —`'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`— cierran el bloque igual que el `null`.
- [ ] `POST` con `{ isPregnancyConfirmed: 'YES' }` y **ninguno** de los nueve campos → **201**. Confirmar el embarazo no obliga a completar nada.
- [ ] `POST` con `{ isPregnancyConfirmed: 'YES', gestationalWeeks: 38, birthWeightGrams: 3250, wasBreastfed: 'YES' }` → **201**, con los tres guardados.
- [ ] `PUT` con `{ isPregnancyConfirmed: 'NO' }` sobre una fila con los nueve campos llenos → **200**, con los **nueve** en `null` en la **misma** petición y **una** sola entrada en `appDetails`.
- [ ] `PUT` con `{ isPregnancyConfirmed: 'NO', gestationalWeeks: 38 }` → **400**. El forzado silencioso no se traga un body que se contradice a sí mismo.
- [ ] `PUT` con `{ isPregnancyConfirmed: 'NO', gestationalWeeks: null }` → **200**. Mandarlo en `null` es el mismo destino al que el forzado llega solo.
- [ ] `PUT` con `{ gestationalWeeks: 38 }` sobre una fila con `isPregnancyConfirmed: 'NO'` **guardado** → **400**. Es el criterio que prueba que la regla mira el estado resultante y no el body: la llave no viaja.
- [ ] `PUT` con `{ isPregnancyConfirmed: 'NO' }` sobre una fila que ya lo tenía en `'NO'` y los nueve campos en `null` → **200 sin escribir nada**: los nueve `null` forzados entran en `candidates` pero el diff no encuentra diferencia.
- [ ] `PUT` con `{ isPregnancyConfirmed: 'YES' }` sobre una fila con `'NO'` → **200**, y los nueve campos siguen en `null`. Abrir el bloque no inventa datos.
- [ ] Los dos textos de observaciones se guardan con su bandera en cualquier valor: `POST { hasFamilyHistory: 'NO', familyHistoryObservations: 'texto' }` → **201**. No están atados a nada.

**Las cuatro FK a `catalogItem`**

- [ ] Un `gestationMethodItemId` que no existe, está inactivo o pertenece a otro `catalogType` → **404** `gestationMethodNotFound`. Los cuatro campos con su clave distinta.
- [ ] Un `catalogItem` del `catalogType` `outcome` enviado como `pregnancyOutcomeItemId` → **404**, no 200. Es lo que prueba que el filtro por `catalogType` está actuando, porque la FK del DDL no distingue el tipo.
- [ ] Con los cuatro `catalogType` **sin sembrar**, toda alta que envíe uno de los cuatro UUID devuelve **404**. Es la precondición de despliegue de §2 hecha visible.
- [ ] Un `*ItemId` que el forzado del bloque va a poner en `null` **no** se resuelve contra el catálogo: un `PUT` con `{ isPregnancyConfirmed: 'NO' }` sobre una fila cuyo `deliveryItemId` guardado apunta a un ítem hoy desactivado responde **200**, no 404.

**Uno a uno y ciclo de vida**

- [ ] `POST` sobre una investigación que ya tiene antecedentes devuelve **409** `alreadyExists`, con el `investigationId` interpolado.
- [ ] `POST` sobre una investigación cuyos antecedentes tienen `deletedAt` sellado devuelve también **409**: el sello no libera el hueco de la clave primaria.
- [ ] Purgar con `005C` libera el `investigationId`, y un `POST` posterior devuelve **201**.
- [ ] Purgar una fila **sin** `deletedAt` sellado devuelve **409** `notDeleted` y la fila sigue existiendo. Es el criterio que prueba que el control de `isActive` de `purgeEntityService` es inerte sobre esta tabla.
- [ ] `assertRowIsSealed` se consume sin modificarlo: `git diff src/helpers/rowSeal.helper.ts` está vacío.
- [ ] Purgar los antecedentes **no** toca el `investigationSource`, el `investigationAutopsy` ni los `investigationTeamMember` de la misma investigación.
- [ ] Ninguna ruta responde a `DELETE /api/investigation-medical-histories/:id` ni a `PATCH /api/investigation-medical-histories/activate/:id`: las dos devuelven 404 de Express.

**Los tres arrastres**

- [ ] Desactivar la investigación con `INVESTGN-005A` sella el `deletedAt` de sus antecedentes y registra `method: 'ESAVI-INVESTGN-005A'` en su `appDetails`.
- [ ] Reactivarla con `INVESTGN-005B` devuelve `deletedAt` a `null` y registra `'ESAVI-INVESTGN-005B'`. El historial anterior queda intacto en los dos casos.
- [ ] **Desactivar el caso con `CASE-005A` sella los antecedentes**, y registra `method: 'ESAVI-CASE-005A'`. Sin el paso 12 este criterio falla, y es la única forma de detectarlo.
- [ ] Reactivar el caso con `CASE-005B` **no** limpia el sello, coherente con F07, F29 y F30.
- [ ] Una fila sellada a mano antes de cualquier cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.
- [ ] Una investigación sin antecedentes, y un caso sin investigación, atraviesan las tres cascadas sin error y sin afectar a ninguna fila.
- [ ] Purgar la investigación con `INVESTGN-005C` destruye los antecedentes por cascada de Postgres, deja **tres** líneas `warn` en el log —fuente, autopsia y antecedentes— y **no** devuelve error.

**Listados y respuesta**

- [ ] Los dos filtros de §3.5 se combinan con `AND` y son por igualdad; `caseId` resuelve por el include de la investigación.
- [ ] Un filtro con un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`.
- [ ] `GET /` no devuelve antecedentes de investigaciones inactivas; `GET /admin` sí; un USER recibe **403** en `/admin`.
- [ ] El listado ordena por `createdAt` descendente.
- [ ] Las filas del listado traen la **misma** forma completa que el `003`, con los cuatro catálogos resueltos: no hay forma reducida.
- [ ] **Una fila con los cuatro `*ItemId` en `null` aparece en el listado**, con los cuatro objetos en `null`. Es lo que prueba que los cuatro includes van en `required: false`.
- [ ] Ninguna respuesta devuelve `isActive` en los antecedentes, y ninguna devuelve `sysDetails` — ni el propio, ni el de la investigación, ni el de los cuatro `catalogItem`.
- [ ] `investigation.status` no llega `null` en ninguna respuesta.
- [ ] `birthWeightGrams` se devuelve como **cadena**, no como número.
- [ ] Las cinco `answerOption` se devuelven tal como se guardaron: un `null` no se convierte en `'NO'` al construir la respuesta.
- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`, y sus tres 404 llevan códigos distintos entre sí.
- [ ] Ninguna respuesta incluye datos de las otras trece tablas satélite.

**Cierre**

- [ ] Las veintiuna claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` cubre las siete rutas nuevas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `INVMEDH`. **No:** `INVMED`, más corta pero se lee como «medicamento» y se cruzaría conceptualmente con `notificationMedication`; **no:** `MEDHIST`, que pierde la pertenencia al bloque de investigación y rompería el `grep` por familia. `INVMEDH` no colisiona con las registradas y no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-` ni `ESAVI-INVTEAM-`.
- **Sí:** solo esta tabla. **No:** aprovechar el spec para meter `investigationCovidHistory`, que es la satélite de anamnesis contigua y comparte la mitad del dominio, ni `investigationPregnancyCondition`, que cuelga directamente de ésta. Es el criterio que fijaron F10 con las ocho satélites de `notification`, F28 con las catorce de `investigation` y F29, F30 y F31 al dividirse de ella.
- **Sí:** extraer `satelliteCascade.service.ts` y **migrar F29 y F30 en este mismo spec**. Es exactamente lo que F30 §7 se comprometió a hacer cuando llegara la tercera copia, y ha llegado. **No:** dejar el helper con un solo consumidor y aplazar la migración a un spec técnico aparte, que produciría **tres** implementaciones vivas del mismo arrastre en vez de una — el escenario que la deuda quería evitar. **No:** duplicar por tercera vez, que era la opción barata y la que convierte una deuda anotada en una deuda permanente.
- **Sí:** la migración va en el **paso 1**, antes de nada de esta entidad. Los pasos de corrección van antes que los de ampliación: si la extracción rompe algo, se rompe con las dos suites hermanas todavía intactas y sin una tercera entidad a medio construir encima.
- **Sí:** alta vacía con solo `investigationId`. **No:** exigir `isPregnancyConfirmed` ni ninguna otra respuesta. Las quince columnas son anulables en el DDL y ninguna tiene sentido como obligatoria: un antecedente que aún no se preguntó es un estado real del formulario, no un error del cliente. Es el patrón de F13, F14 y F29, y lo contrario de F30 — allí la fila registraba un hecho fechado, aquí es un cuestionario a medio llenar.
- **Sí:** el bloque de embarazo gobernado por `isPregnancyConfirmed === 'YES'`. Es la única regla de coherencia del spec y la única que el dominio pide sin ambigüedad: semanas de gestación, tipo de parto y peso al nacer no significan nada si no hubo embarazo.
- **Sí:** `wasBreastfed` y `birthWeightGrams` **dentro** del bloque. **No:** dejarlos libres, que fue la propuesta inicial por ser datos del recién nacido y no de la gestación. La consecuencia aceptada, y hay que dejarla escrita: **para registrar la lactancia o el peso al nacer de un lactante hay que responder `isPregnancyConfirmed: 'YES'`**, aunque el embarazo en sí no sea lo que se está investigando. La alternativa —dos campos sueltos fuera del bloque— dejaba una frontera arbitraria dentro de un mismo grupo del formulario, y la coherencia del bloque se consideró más valiosa que ese caso de uso. Va también a §7 como riesgo.
- **Sí:** la asimetría `001` / `004` en los campos prohibidos, calcada de la regla «otra» de F29 y de las dos fechas de F30. El `004` resuelve un huérfano que él no creó —el dato lo guardó una petición anterior— y el `001` no tiene huérfanos que resolver. **No:** la misma regla en las dos, que en el alta produciría un 201 mintiendo sobre lo que guardó.
- **Sí:** conservar el 400 cuando el campo **sí** viaja junto a un `isPregnancyConfirmed` no `'YES'`. **No:** silenciarlo también. Un body que niega el embarazo y a la vez declara las semanas de gestación se contradice a sí mismo; tragárselo perdería el dato en silencio y el cliente creería haberlo guardado.
- **Sí:** los nueve campos forzados como **derivados condicionales**, entrando en `candidates` sin `if` de presencia. **No:** limpiarlos con un `update` posterior al diff. Un segundo `UPDATE` escribiría aunque nada cambie, y rompería el criterio de que cerrar un bloque ya cerrado no crece `appDetails`.
- **Sí:** `isPregnancyConfirmed` como anulable corriente, fuera del bloque que gobierna. Es la llave, no uno de los decididos: si entrara como derivado se anularía a sí mismo.
- **No:** atar `priorHospitalizationObservations` a `hasPriorHospitalizationHistory`, ni `familyHistoryObservations` a `hasFamilyHistory`. Era la opción (c) de la ronda de preguntas. Un investigador puede anotar el detalle de una hospitalización antes de haber marcado la casilla, o dejar una nota explicando **por qué** la respuesta es `'UNKNOWN'` — que es justo cuando el texto libre más vale. Prohibirlo convertiría el campo más informativo del bloque en un 400. La diferencia con el bloque de embarazo es real: allí los nueve campos son **datos de un hecho que no ocurrió**; aquí el texto es **comentario sobre la respuesta**, cualquiera que ésta sea.
- **Sí:** una sola clave i18n `pregnancyFieldsNotAllowed` con `{{field}}` interpolado. **No:** nueve claves distintas, que dirían lo mismo nueve veces y multiplicarían por tres los archivos de idioma sin añadir información al cliente. **No:** una clave genérica sin el nombre del campo, que dejaría al cliente adivinando cuál de los nueve lo rompió.
- **Sí:** cuatro claves i18n distintas para las cuatro FK de catálogo. Aquí sí: son cuatro campos con cuatro catálogos distintos, y saber **cuál** falló es lo que le dice al cliente qué desplegable recargar.
- **Sí:** las cinco `answerOption` como tri-estado ampliado, con `null` y `'NO_ANSWER'` como datos distintos. **No:** normalizar `null` a `'NO_ANSWER'` al escribir, ni al revés. `null` es «el formulario no lo recogió» y `'NO_ANSWER'` es «se preguntó y no contestó»; fundirlos destruiría la única forma de saber si la investigación llegó a preguntarlo. Es la decisión de F13 y F25.
- **Sí:** la regla del bloque escrita contra `=== 'YES'`. **No:** contra la veracidad del valor, que funcionaría por accidente —las cinco cadenas del ENUM son `truthy`— y se rompería en silencio el día que alguien la refactorice. Las cuatro formas del «no» y el `null` cierran el bloque igual.
- **Sí:** `birthWeightGrams` en `DataTypes.DECIMAL(8, 2)`, devuelto como **cadena**. **No:** `FLOAT` ni `DOUBLE`, que perderían precisión sobre una columna `numeric(8,2)` y romperían la regla de comparación numérica del helper. **No:** convertir a número al construir la respuesta, que obligaría a reconvertir antes de comparar en el diff y reabriría por otro lado exactamente el problema que la regla del helper ya resuelve.
- **Sí:** los dos `CHECK` del DDL replicados en el **validador**. No necesitan estado guardado, y `validateFields` ya responde 400 con `common.validationError` sin generar clave i18n propia. **No:** dejarlos solo en la base, que convertiría un `gestationalWeeks: 46` en un 500 de integridad en vez de un 400 legible. **No:** meterlos en el servicio junto a la regla del bloque, que sí necesita estado.
- **Sí:** los cuatro `catalogItem` validados contra su `catalogType` por código, con el patrón de F27 y F28. La FK del DDL apunta a `catalogItem` sin distinguir el tipo, así que el filtro es la **única** defensa contra guardar un ítem de `outcome` como método de gestación.
- **Sí:** los cuatro códigos de catálogo como constantes locales del servicio, como en `notificationPregnancyComplication.service.ts:23`. **No:** llevarlos a `src/constants/investigation.constants.ts`, que solo tiene sentido cuando más de un servicio los consume — y aquí no ocurre.
- **Sí:** los cuatro catálogos resueltos en **todas** las operaciones, listados incluidos. Son cinco `LEFT JOIN` por fila contando el del padre, y es el coste que F27 ya aceptó por el suyo. **No:** devolver solo los UUID, que obligaría al cliente a pedir cuatro catálogos aparte para pintar una ficha. **No:** resolverlos en el detalle y no en el listado, que dejaría dos formas distintas de la misma entidad y obligaría al cliente a escribir dos parsers.
- **Sí:** los cuatro includes de catálogo en `required: false`. **No:** `required: true`, que haría desaparecer del listado toda fila sin catálogos resueltos — es decir, toda fila fuera del bloque de embarazo, que serán la mayoría.
- **Sí:** orden del listado por `createdAt DESC`, como F29. **No:** ordenar por ninguna columna de datos: las quince son respuestas de anamnesis, no hechos fechados, y ninguna ordena el dominio como la `deathDate` ordenaba F30.
- **Sí:** los dos filtros de F29 y F30, y solo ésos. **No:** un filtro por `isPregnancyConfirmed`. Filtrar antecedentes por respuesta clínica es una consulta de análisis, no de operación, y arrastra detrás la pregunta de qué hacer con los otros catorce campos.
- **Sí:** listado dual `002A` / `002B`, heredado de F29 y F30. La visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos.
- **Sí:** cinco operaciones de escritura y lectura más las dos de listado, sin `005A` ni `005B`. **No:** inventar una activación que escriba `deletedAt` a mano. La tabla no tiene estado propio: retirar unos antecedentes es retirar su investigación.
- **Sí:** el `003` por `investigationId`, que es la PK, y el `006` por `/case/:caseId` atravesando los dos saltos. Es la consulta real del dominio —el cliente tiene el caso, no la investigación—.
- **Sí:** tres 404 distintos en el `006`. **No:** un solo `notFound` genérico. Que el caso no exista, que no haya investigación abierta o que la anamnesis no se haya registrado son tres acciones distintas del usuario.
- **Sí:** `investigationId` inmutable en el `004`, ignorado en silencio. **No:** permitir el traslado entre investigaciones. **No:** devolver 400, que rompería el `PUT` que reenvía la respuesta del `GET` — el uso normal de un formulario.
- **No:** cifrar ningún campo. Son quince datos clínicos y ninguno identifica a nadie por sí solo: no hay nombre, ni documento, ni contacto. La identidad del paciente vive en `patient`, y es allí donde `esaviCrypt` ya se aplica. Es la línea contraria a la que F31 tuvo que razonar, porque allí sí había nombres de personas.
- **No:** ninguna regla cruzada con `notificationPregnancy`, `patient` ni `investigationCovidHistory`. Que la notificación diga `wasPregnantAtVaccination: 'YES'` y la investigación diga `isPregnancyConfirmed: 'NO'` es hoy una incoherencia posible y aceptada: son dos momentos distintos del expediente, y atarlos exige antes decidir cuál manda. Eso es un spec de reglas cruzadas, no un CRUD.
- **No:** derivar nada de `gestationalWeeks` —prematuridad, trimestre, categoría de peso—. Esta entidad no tiene ni un campo derivado, y añadir el primero traería consigo la pregunta de qué hacer cuando el cliente manda un valor que contradice al derivado.
- **No:** bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene antecedentes. Se deja disparar la cascada, con el volcado en `warn` como única mitigación. Es la decisión de F13, F29 y F30, heredada sin reabrirse.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **La migración de F29 y F30 al servicio común toca código implementado y en producción.** Un cambio sutil en el `where`, en el `method` o en la preservación de `appDetails` rompería dos entidades que hoy funcionan, y el fallo sería silencioso: las cascadas no devuelven error, solo dejan de sellar | Las suites de contrato de las dos hermanas son la red, y el criterio es que pasen **sin tocar un solo caso**. El paso 1 va antes que todo lo demás precisamente para que, si rompe, rompa sin una tercera entidad a medio construir encima |
| **`birthWeightGrams` vuelve de `pg` como cadena.** Un cliente que reenvíe el número que le dio el `GET` produciría una diferencia inventada en **cada apertura del formulario**, ensuciando `appDetails` y `sysDetails` sin que nadie tocara nada | `DECIMAL(8, 2)` en el modelo y la regla de comparación numérica que `buildDifferentialUpdate` ya tiene. Tiene criterio de aceptación propio, y un segundo criterio que verifica por `grep` que la columna no se declaró en `FLOAT` — que es donde el problema volvería |
| **La regla del bloque escrita contra la veracidad del valor funcionaría por accidente.** Las cinco cadenas de `answerOption` son `truthy`, así que `if( isPregnancyConfirmed )` da el mismo resultado que `=== 'YES'` en cuatro de los cinco casos… y el equivocado en el quinto, `'NO'` | La regla se declara en §3.5 contra `=== 'YES'` y hay criterio explícito con `'UNKNOWN'`, que es el valor que expone la diferencia sin ambigüedad |
| **Un `if( data.x )` en `candidates` haría imposible guardar `gestationalWeeks: 0` y `birthWeightGrams: 0`**, y el fallo es silencioso: el `PUT` devuelve 200 y el campo se queda como estaba | Es el riesgo que seis de los doce servicios del repositorio materializaron. La tabla de `candidates` de §3.5 lo declara campo por campo y hay criterio explícito sobre el `0` en los dos |
| **`wasBreastfed` y `birthWeightGrams` quedan inaccesibles sin declarar `isPregnancyConfirmed: 'YES'`.** Registrar la lactancia de un lactante cuyo embarazo no se investiga obliga a afirmar un embarazo confirmado, lo que puede llevar a marcarlo por conveniencia y contaminar el dato de la llave | Sin mitigación en código: es la decisión de §6, tomada a conciencia. La señal a vigilar es un `isPregnancyConfirmed: 'YES'` con los otros siete campos del bloque vacíos y solo esos dos llenos. Si el patrón aparece en los datos, lo que corresponde es un spec que saque los dos campos del bloque, no un parche |
| **Los cuatro `catalogType` no están sembrados y el DDL no los siembra.** Toda alta que envíe uno de los cuatro UUID devuelve 404 hasta que alguien los cargue, y el mensaje no distingue «el ítem no existe» de «el catálogo entero no existe» | Es precondición de despliegue declarada en §2 y en el plan. La ambigüedad del mensaje se acepta a cambio de no añadir cuatro claves más. Es exactamente lo que F28 aceptó con `vaccinationSite` |
| El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** sobre esta tabla: `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró | `assertRowIsSealed` es la única red, y por eso la guarda va **antes** del `destroy` y tiene criterio propio. El helper ya existe y se consume sin modificarlo |
| La cascada de `ESAVI-INVESTGN-005A` **no dispara** cuando quien arrastra la investigación es `ESAVI-CASE-005A`, porque aquélla se implementa con un `update` masivo que no pasa por el servicio de activación. La fila quedaría sin sellar y nadie lo notaría | La novena función hermana del paso 12 existe exactamente para esto. Es el mismo riesgo que F29 y F30 documentaron, y sigue siendo el error más fácil de cometer: el paso anterior parece haberlo resuelto y no lo resuelve |
| **`investigationPregnancyCondition` cuelga de esta tabla y todavía no existe.** Cuando se implemente, su `005C` y sus cascadas dependerán de una fila que este spec permite purgar sin comprobar nada aguas abajo | Hoy no hay nada que romper: la tabla está vacía y sin modelo. Su spec heredará el problema y tendrá que decidir si el `005C` de aquí se bloquea cuando existan condiciones registradas. Queda declarado en §2 y en §3.5 para que ese spec no lo descubra tarde |
| El `004` es la operación principal de la entidad —la fila se abre vacía y se completa después—, así que un fallo del diferencial ensuciaría `appDetails` y `sysDetails` en **cada apertura del formulario** | Los diez criterios del bloque diferencial de §5 son la cobertura; el corte temprano cuando el diff vuelve vacío es la única línea de control que le queda al servicio |
| El forzado de los nueve campos a `null` entra en `candidates` en **toda** petición cuyo `isPregnancyConfirmed` resultante no sea `'YES'`, que serán la mayoría | Es correcto y está buscado: el helper decide si difieren. El criterio que lo verifica es el `PUT` con `{ isPregnancyConfirmed: 'NO' }` sobre una fila ya cerrada, que debe responder 200 **sin escribir** |
| Los cuatro includes de catálogo en `required: true` harían **desaparecer del listado** toda fila sin catálogos resueltos, que son la mayoría, y el listado parecería simplemente vacío | `required: false` está declarado en §3.5 y hay criterio de aceptación que lista una fila con los cuatro en `null` |
| `GET /:id` captura `/admin`, `/purge` o `/case` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por un criterio de aceptación explícito |

---

## 8. Impacto en el contrato HTTP

El spec añade siete rutas nuevas y **no cambia la forma de ninguna respuesta existente**. Ningún endpoint devuelve un campo distinto, ni un status distinto, ni un mensaje distinto.

Lo que sí cambia son **efectos sobre filas de una entidad que hasta ahora no existía**, y por eso ningún cliente actual puede notarlo:

- `DELETE /api/investigations/:id`, `PATCH /api/investigations/activate/:id` y `DELETE /api/esavi-cases/:id` pasan a sellar o limpiar también el `deletedAt` de los antecedentes, junto al de la fuente y la autopsia que F29 y F30 ya arrastraban. Status, mensaje y cuerpo son idénticos.
- `DELETE /api/investigations/purge/:id` añade una **tercera** línea en `warn` al log. La respuesta no cambia.

`GET /api/investigations` y `GET /api/investigations/:id` **no** incluyen los antecedentes en su `data`: la asociación `hasOne` se declara pero no se usa en ninguna respuesta de aquella entidad, igual que las de F29 y F30.

**Un cambio de código sin superficie HTTP: la migración de F29 y F30 al servicio común.** `investigationSource` e `investigationAutopsy` pasan a arrastrarse por `cascadeSealSatellite` y `cascadeClearSatellite` en vez de por sus funciones propias. **Ni su comportamiento ni su contrato cambian** —mismo sellado, mismo `method` en `appDetails`, misma transacción—, y el criterio de aceptación que lo garantiza es que sus dos suites de contrato pasen sin tocar un solo caso.

---

## Lo que **no** está en este spec

- Las otras diez tablas satélite de `investigation`: `investigationCovidHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `evaluationInstitution`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- `investigationPregnancyCondition` en particular, pese a colgar de esta tabla y no de `investigation`.
- Sembrar los cuatro `catalogType` —`gestationMethod`, `deliveryType`, `birthCondition`, `pregnancyOutcome`— ni sus ítems: es precondición de despliegue, no implementación.
- Cualquier regla cruzada con `notificationPregnancy`, con `patient` —sexo compatible con un embarazo, `birthDate` coherente con el peso al nacer— o con `investigationCovidHistory`.
- Atar `priorHospitalizationObservations` y `familyHistoryObservations` a su bandera.
- Sacar `wasBreastfed` y `birthWeightGrams` del bloque de embarazo.
- Derivar prematuridad, trimestre o categoría de peso a partir de `gestationalWeeks` o de `birthWeightGrams`.
- Cualquier tablero, conteo o filtro por `isPregnancyConfirmed` o por cualquier otra columna de datos.
- Añadir el listado dual a `severeNotification` y `nonSevereNotification`, pendiente desde F29 §2.
- Cambiar el comportamiento de F29 o de F30 al migrarlos al servicio común: la migración es de forma, no de fondo.
- Trasladar unos antecedentes de una investigación a otra.
- Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene antecedentes.
- Modificar `esaviapp.sql`, `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.
- Cifrado de ningún campo.
- Búsqueda por texto sobre los cuatro campos libres.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
