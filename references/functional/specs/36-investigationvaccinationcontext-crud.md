# SPEC F36 — CRUD de `investigationVaccinationContext`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), SPEC F29 (`investigationSource`), SPEC F30 (`investigationAutopsy`), **SPEC F32 (`investigationMedicalHistory` — aporta `satelliteCascade.service.ts`, que este spec consume ya extraído)**, **SPEC F34 (`investigationClinicalEvaluation` — hermana de forma directa: aporta el patrón del bloque condicional gobernado por una bandera, con su asimetría `001`/`004`)**, **SPEC F35 (`evaluationInstitution` — aporta el patrón de siembra de catálogo en el DDL y el doble salto de validación contra `catalogType`)**, SPEC F13 y SPEC F14 (patrón de satélite sin `isActive`), SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-24
> **Objetivo:** Dar de alta `investigationVaccinationContext` —el contexto de la jornada de vacunación en que se administró la dosis investigada: en qué franja horaria se aplicó, cuánta gente se vacunó del mismo frasco y del mismo lote, y si el caso forma parte de un conglomerado— como la **sexta** tabla con FK directa a `investigation` que recibe spec propio.

---

## 1. Por qué existe este spec

`investigationVaccinationContext` responde al bloque del formulario de investigación que sitúa la dosis en su jornada de vacunación. No describe al paciente ni al evento: describe **las circunstancias operativas de la aplicación**. Tres preguntas distintas conviven en la tabla:

- **La franja horaria.** En qué momento de la jornada se aplicó la vacuna, por separado para la presentación individual (`momentItemId`) y para el frasco multidosis (`multidoseItemId`). Es el dato que permite correlacionar un ESAVI con el final de una jornada larga.
- **La exposición compartida.** Cuántas personas se vacunaron del mismo frasco (`vaccinatedPerVialCount`) y del mismo lote (`vaccinatedPerBatchCount`), y en qué localidades (`locations`).
- **El conglomerado.** Si el caso pertenece a un clúster (`isCluster`), con qué identificador, cuántos casos adicionales lo componen y si compartieron el mismo frasco.

Hoy la tabla existe en `esaviapp.sql:1133-1155` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **sexta tabla con FK directa a `investigation`** que recibe spec propio, después del [SPEC F29](./29-investigationsource-crud.md), el [SPEC F30](./30-investigationautopsy-crud.md), el [SPEC F31](./31-investigationteammember-crud.md), el [SPEC F32](./32-investigationmedicalhistory-crud.md) y el [SPEC F34](./34-investigationclinicalevaluation-crud.md). De forma es hermana de F29, F30, F32 y F34, y **no** de F31, F33 ni F35. Los cuatro rasgos que aquéllas fijaron se cumplen aquí sin matices, y se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`esaviapp.sql:1134`) y destino de `FK_investigationVaccinationContext_investigation` (`:1152`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **séptima** del repositorio así, tras `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy`, `investigationMedicalHistory` e `investigationClinicalEvaluation`. De ahí sale, igual que allí, que **no haya `005A` ni `005B`**, y que la visibilidad se herede de `investigation.isActive`.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete`, así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar. La tabla figura entre las 27 habilitadas para `005C` en `CONVENTIONS.md` §6.
- **Solo lleva el trigger genérico.** `TRG_investigationVaccinationContext_setSysDetails`, del bucle de `esaviapp.sql:1286-1302`. `updatedAt` lo escribe la aplicación.

**Y dos cosas que este spec ya no tiene que resolver.** `satelliteCascade.service.ts` nace en F32 y esta entidad es su **quinta** consumidora: lo consume tal cual está, sin tocarlo. Y el patrón del bloque condicional —una bandera que abre o cierra un grupo de campos, con 400 en el alta y forzado a `null` en el update— lo fijó F34 con sus tres pares; aquí se aplica **una sola vez, sobre cuatro campos a la vez**.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco.** Tres cosas:

**A — Es el primer bloque condicional del repositorio gobernado por un `answerOption` y no por un `boolean`.** F29 y F34 gobiernan con banderas booleanas, donde el «no» tiene tres formas (`false`, `null`, ausente) y las tres cierran. Aquí `isCluster` es el ENUM de cinco valores, así que el «no» tiene **cinco** formas: `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null`. **Solo `'YES'` abre el bloque**, y §3.5 lo declara explícitamente porque es donde un lector supondría lo contrario.

**B — El bloque no tiene lado obligatorio.** F29 y F34 exigen la explicación cuando la bandera está encendida. Aquí no: con `isCluster` en `'YES'` los cuatro campos siguen siendo opcionales. La regla es **solo de prohibición**, y §6 razona por qué —el DDL no declara ningún `NOT NULL`, y un investigador puede saber que hay clúster antes de tener su identificador—.

**C — Dos FKs al mismo `catalogType`.** `momentItemId` y `multidoseItemId` (`:1135`, `:1136`) apuntan las dos a `catalogItem` y las dos se validan contra el **mismo** catálogo `vaccinationMoment`, que este spec siembra. Es la primera entidad del repositorio con dos columnas resueltas contra un mismo catálogo, lo que obliga a **dos `belongsTo` con alias distintos** sobre la misma asociación.

**Y una regla que el DDL insinúa y no impone.** El comentario de `esaviapp.sql:1144` —«If answer is "No", then the following field is required»— ata `clusterUsedSameVial === 'NO'` con `clusterSameVialCount`. Es la única regla de negocio que el esquema documenta y no puede hacer cumplir: no hay `CHECK` que la exprese. Este spec la implementa literalmente, y §6 explica por qué se implementa tal cual está escrita aunque su lectura sea contraintuitiva.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationVaccinationContext`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29, F30, F32 y F34 mantuvieron.
- **Listado dual `002A` / `002B`**, heredado de F29, F30, F32 y F34: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve contextos cuya investigación está activa; `002B` en `GET /admin` para ADMIN los devuelve todos.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear el segundo contexto de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVVACTX_001_INVESTIGATION_NOT_FOUND`; no tiene ya contexto, sin filtrar por `deletedAt` → 409 `INVVACTX_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, el contexto responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Alta vacía.** Las once columnas de datos son anulables y **ninguna es obligatoria**: `POST { investigationId }` devuelve **201** con las once en `null`. La fila se abre como borrador y se completa por `PUT`. Es el patrón de F13, F14, F29, F32 y F34.
- **`investigationId` inmutable en el `004`:** se ignora en silencio si llega, sin 400, igual que en F29, F30, F32 y F34.
- **Siembra de un `catalogType` nuevo en el DDL:** `vaccinationMoment` con tres ítems —`FIRST_HOURS`, `LAST_HOURS`, `UNKNOWN`—, con las tres `CALL "upsertCatalogItem"` al final del bloque de siembra, siguiendo F35. Es la **única** modificación de `esaviapp.sql`.
- **`momentItemId` y `multidoseItemId` validados por doble salto contra ese mismo catálogo**, con la forma de `assertCatalogItemIsValid`: no existe, está inactivo o pertenece a otro catálogo → **404**, con un código propio cada columna. Los dos son anulables, independientes entre sí y **no gobiernan nada**.
- **`isCluster` gobierna un bloque de cuatro campos** —`clusterIdentificationNumber`, `clusterAdditionalCaseCount`, `clusterUsedSameVial` y `clusterSameVialCount`—, con la regla de F34 replicada **sin su lado obligatorio**:
  - **Solo `isCluster` resultante `'YES'` abre el bloque.** `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null` lo cierran, los cinco por igual.
  - Con el bloque **abierto**, los cuatro campos son opcionales. No hay ningún campo exigible.
  - Con el bloque **cerrado**, los cuatro están **prohibidos**, con la asimetría `001` / `004`: **400** en el alta, y en el update **forzados a `null` como derivados condicionales** si el cliente no los manda, **400** si los manda con valor.
- **La regla del vial compartido**, la única que el DDL documenta (`:1144`): con el bloque abierto y `clusterUsedSameVial` resultante `'NO'`, `clusterSameVialCount` es **obligatorio** → si falta, **400** `INVVACTX_<op>_CLUSTER_SAME_VIAL_COUNT_REQUIRED`. Solo se evalúa con el bloque abierto.
- **Los cuatro contadores** —`vaccinatedPerVialCount`, `vaccinatedPerBatchCount`, `clusterAdditionalCaseCount` y `clusterSameVialCount`— validados con `.isInt({ min: 0, max: 32767 })` admitiendo `null`: replica el `CHECK >= 0` del DDL **y** el techo de `smallint`, para que un desbordamiento sea 400 y no un 500 de Postgres.
- **Ningún campo cifrado.** La tabla no contiene ningún nombre de persona ni dato identificativo. `locations` es texto libre plano.
- **Normalización al escribir:** `.trim()` sobre `locations`, `clusterIdentificationNumber` y `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre**, ya sobre `src/services/common/satelliteCascade.service.ts` **sin modificarlo**: `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica añadir invocaciones en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, **junto a las que F29, F30, F32 y F34 ya dejaron puestas**.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto a los cuatro que F29, F30, F32 y F34 dejaron.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVVACTX_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**, porque el control de `isActive` de `purgeEntityService` es inerte sobre una tabla que no tiene esa columna.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación. Orden `createdAt DESC`.
- Alta de la abreviatura **`INVVACTX`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationVaccinationContext.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F32** debe estar `Implementado`. No hay dependencia de modelo, pero sí de código: `satelliteCascade.service.ts` nace allí y este spec lo consume tal cual.
- **El DDL con la siembra de `vaccinationMoment` ejecutado.** Sin el catálogo, `momentItemId` y `multidoseItemId` son inservibles y todo `POST` que los mande responde 404. La siembra va **dentro** de este spec, no como nota externa: es la decisión que F35 tomó y aquí se hereda.

**Fuera de alcance (otros specs):**

- **Las cinco satélites de `investigation` que siguen sin spec:** `investigationCovidHistory` (`:1014-1036`), `investigationVaccineAdministered` (`:1157-1172`), `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- **Cualquier regla cruzada con `investigationVaccineAdministered`.** Aquella tabla registra **qué** vacunas se administraron y ésta **en qué contexto**. Que un `vaccinatedPerVialCount` sea alto no dice nada sobre cuántas filas de vacuna administrada existen, y atarlas exige antes decidir cuál manda.
- **Cualquier regla cruzada con `investigationColdChain`.** El frasco multidosis aparece en las dos tablas y no significa lo mismo: aquí es cuántos se vacunaron de él, allí será cómo se conservó.
- **Cualquier regla cruzada con `notificationVaccine`, `esaviCase` o `patient`.** Ni la fecha del evento condiciona la franja horaria, ni el lote de la notificación se contrasta con `vaccinatedPerBatchCount`.
- **Filtrar, contar o agregar por `isCluster`.** Sería el primer filtro por dato de dominio del repositorio y abre la puerta a tableros. Los dos únicos filtros del listado son los de F29, F32 y F34.
- **Cualquier lógica de conglomerado que cruce investigaciones.** `clusterIdentificationNumber` es una cadena libre: este spec la guarda y no la resuelve contra nada. Agrupar las investigaciones que comparten identificador, contarlas o validar que el `clusterAdditionalCaseCount` coincida con esa cuenta es un spec propio, y probablemente una entidad propia.
- **Búsqueda por texto** sobre `locations`, `clusterIdentificationNumber` o `notes`.
- **Estructurar `locations`.** Es `text` libre en el DDL y así se queda: convertirlo en una relación con `geoLocation` es una decisión de modelo que ni el esquema ni el formulario respaldan hoy.
- **Derivar nada** de los cuatro contadores —una suma, una proporción, una bandera «exposición masiva»—. No hay ningún campo derivado en esta entidad.
- **Ampliar el catálogo `vaccinationMoment`** más allá de los tres ítems sembrados, o reutilizarlo desde otra entidad. Si mañana otra tabla lo necesita, lo consume tal cual; añadirle ítems es un cambio de DDL con su propio spec.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene contexto de vacunación.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión de F13, F29, F30, F32 y F34, heredada sin reabrirse.
- **Modificar `esaviapp.sql` más allá de las tres `CALL` de siembra**: ni añadir `isActive`, ni un `CHECK` sobre el bloque de clúster, ni un índice, ni meter `investigation` en `preventPhysicalDelete`.
- **Modificar `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.** Los cinco se consumen tal cual están.
- **Cambiar el comportamiento de F29, F30, F32 ni F34.** Este spec solo añade invocaciones junto a las suyas; sus suites de contrato deben pasar sin tocar un solo caso.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2 y sigue mereciendo su propio spec.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationVaccinationContext` — `esaviapp.sql:1133-1155`. La tabla **no se altera**; lo único que este spec añade al DDL son las tres `CALL` de siembra del catálogo.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:1134`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationVaccinationContext_investigation` → `investigation`, `ON DELETE CASCADE` (`:1152`) |
| `momentItemId` | `uuid` | sí | `:1135`. `FK_investigationVaccinationContext_moment` → `catalogItem`, `ON DELETE RESTRICT` (`:1153`). Catálogo `vaccinationMoment` |
| `multidoseItemId` | `uuid` | sí | `:1136`. `FK_investigationVaccinationContext_multidose` → `catalogItem`, `ON DELETE RESTRICT` (`:1154`). **El mismo catálogo** `vaccinationMoment` |
| `vaccinatedPerVialCount` | `smallint` | sí | `:1137`. `CHECK (... IS NULL OR ... >= 0)` |
| `vaccinatedPerBatchCount` | `smallint` | sí | `:1138`. `CHECK (... IS NULL OR ... >= 0)` |
| `locations` | `text` | sí | `:1139`. Texto libre, sin estructura |
| `isCluster` | `answerOption` | sí | `:1140`. ENUM de cinco valores. **Gobierna el bloque de cuatro campos** |
| `clusterIdentificationNumber` | `varchar(100)` | sí | `:1141`. Campo 1 del bloque. Cadena libre, no resuelve contra nada |
| `clusterAdditionalCaseCount` | `smallint` | sí | `:1142`. Campo 2 del bloque. `CHECK (... IS NULL OR ... >= 0)` |
| `clusterUsedSameVial` | `answerOption` | sí | `:1143`. Campo 3 del bloque. **Y a su vez gobierna a `clusterSameVialCount`** |
| `clusterSameVialCount` | `smallint` | sí | `:1145`. Campo 4 del bloque. `CHECK (... IS NULL OR ... >= 0)`. Precedido en `:1144` por el **único comentario de regla de negocio del DDL** |

**Once columnas de datos, las once anulables.** Ninguna es `NOT NULL`, y de ahí sale directamente el alta vacía de §2: no hay nada que el investigador esté obligado a saber para abrir la fila.

**Restricciones.** **Tres claves foráneas** —el padre y las dos del catálogo—, **cuatro `CHECK`** —los cuatro contadores contra el cero—, **ninguna `UNIQUE`** —la PK ya lo es— y **ningún índice declarado** más allá del de la clave primaria. **No hace falta añadir ninguno:** el `investigationId` por el que filtra el listado *es* la clave primaria, que ya está indexada. Es la diferencia con F35, que sí tuvo que declarar el suyo.

**El bloque de clúster no está en el esquema.** Los cuatro `CHECK` acotan cada contador por separado y nada más; que `isCluster` gobierne a los cuatro campos, y que `clusterUsedSameVial` gobierne al último, lo impone íntegramente la aplicación. Por eso §3.5 es la sección larga de este spec.

**El comentario de `:1144` es la única regla de negocio escrita en el DDL** — «If answer is "No", then the following field is required»— y el esquema no puede hacerla cumplir: no hay `CHECK` que la exprese, porque un `CHECK` no distingue «el campo no aplica» de «el campo falta». La implementa el servicio.

**El ENUM `answerOption`** se declara en `esaviapp.sql:26` con cinco valores: `'YES'`, `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`. Ya vive en `src/constants/enums.constants.ts:8` como `ANSWER_OPTIONS`. **No se añade ninguna constante nueva.** Dos columnas lo usan: `isCluster` y `clusterUsedSameVial`.

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. **Falta `isActive`**, igual que en `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy`, `investigationMedicalHistory` e `investigationClinicalEvaluation`. Es la séptima tabla del repositorio así.

**Triggers.** Solo `TRG_investigationVaccinationContext_setSysDetails`, del bucle genérico de `esaviapp.sql:1286-1302`. La tabla no figura en el bucle `preventPhysicalDelete`, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco figura en `setSortOrderByParent`: no tiene `sortOrder`.

**Hoja del grafo.** `grep 'REFERENCES "investigationVaccinationContext"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

**Lo único que se añade al DDL.** Tres `CALL "upsertCatalogItem"` al final del bloque de siembra, junto a las de `evaluationInstitutionType` que dejó F35:

```
CALL "upsertCatalogItem"('vaccinationMoment', 'Vaccination moment', 'FIRST_HOURS', 'First hours of the session', 'FIRST_HOURS', 1);
CALL "upsertCatalogItem"('vaccinationMoment', 'Vaccination moment', 'LAST_HOURS',  'Last hours of the session',  'LAST_HOURS',  2);
CALL "upsertCatalogItem"('vaccinationMoment', 'Vaccination moment', 'UNKNOWN',     'Unknown',                    'UNKNOWN',     3);
```

El `code` del `catalogType` va en camelCase, que es la excepción de normalización declarada en `CONVENTIONS.md`; los `code` de los ítems van en `CONSTANT_CASE`, como los de `healthFacilityType` y `evaluationInstitutionType`. El procedimiento es idempotente por `ON CONFLICT ("catalogTypeId", "code")` y reactiva la fila si estaba retirada, así que ejecutar el DDL dos veces no duplica nada.

**Un solo catálogo para las dos columnas.** `momentItemId` y `multidoseItemId` responden la misma pregunta —en qué franja de la jornada se aplicó— sobre dos presentaciones distintas: la individual y la del frasco multidosis. Los tres ítems sirven a las dos, y duplicar el catálogo obligaría a mantener dos listas idénticas.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationVaccinationContext.model.ts`. Clase `InvestigationVaccinationContext`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationVaccinationContext'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14, F29, F30, F32 y F34: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- `momentItemId` y `multidoseItemId` — `DataTypes.UUID`, `allowNull: true`.
- `isCluster` y `clusterUsedSameVial` — `DataTypes.ENUM(...ANSWER_OPTIONS)`, `allowNull: true`, importando `ANSWER_OPTIONS` y el tipo `AnswerOption` de `src/constants/enums.constants.ts`. Es el patrón de `severeNotification.model.ts:51-67`.
- Los cuatro contadores — `DataTypes.SMALLINT`, `allowNull: true`. **`SMALLINT` y no `INTEGER`**: que el tipo del modelo coincida con el de la columna es lo que hace que el techo de 32767 sea una propiedad declarada y no un accidente.
- `clusterIdentificationNumber` — `DataTypes.STRING(100)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres, siguiendo F35.
- `locations` y `notes` — `DataTypes.TEXT`, `allowNull: true`.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationVaccinationContext.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationVaccinationContext.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationVaccinationContext, { as: 'vaccinationContext', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `vaccinationContext` no colisiona con `source` (F29), `autopsy` (F30), `teamMembers` (F31), `medicalHistory` (F32) ni `clinicalEvaluation` (F34).
- `InvestigationVaccinationContext.belongsTo(CatalogItem, { as: 'moment', foreignKey: 'momentItemId' })`
- `InvestigationVaccinationContext.belongsTo(CatalogItem, { as: 'multidoseMoment', foreignKey: 'multidoseItemId' })`

**Los dos últimos van al mismo modelo y por eso los alias son obligatorios y tienen que ser distintos.** Es la primera entidad del repositorio con dos FKs al mismo catálogo: sin alias, Sequelize no puede distinguir los dos `include` y la respuesta resolvería siempre la misma columna.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `vaccinationContext` **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationVaccinationContext.types.ts`, junto a los de `investigation`, `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationMedicalHistory`, `investigationPregnancyCondition` e `investigationClinicalEvaluation`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationVaccinationContextInput {
    investigationId: string;
    momentItemId?: string | null;
    multidoseItemId?: string | null;
    vaccinatedPerVialCount?: number | null;
    vaccinatedPerBatchCount?: number | null;
    locations?: string | null;
    isCluster?: AnswerOption | null;
    clusterIdentificationNumber?: string | null;
    clusterAdditionalCaseCount?: number | null;
    clusterUsedSameVial?: AnswerOption | null;
    clusterSameVialCount?: number | null;
    notes?: string | null;
}
```

**`investigationId` es el único campo obligatorio del tipo.** Los once restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo.

`AnswerOption` se importa de `src/constants/enums.constants.ts`; **no se declara ningún tipo nuevo de enumerado**.

El update usa `Partial<CreateInvestigationVaccinationContextInput>`. **No se declara `UpdateInvestigationVaccinationContextInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Los cuatro campos del bloque de clúster se declaran como una constante local del servicio, para que la prohibición y el forzado se apliquen recorriéndola en vez de escritos cuatro veces:

```ts
const CLUSTER_BLOCK_FIELDS = [
    'clusterIdentificationNumber',
    'clusterAdditionalCaseCount',
    'clusterUsedSameVial',
    'clusterSameVialCount',
] as const;
```

**No va a `src/constants/investigation.constants.ts`**: solo lo consume este servicio, igual que F27, F32 y F34 mantuvieron locales sus listas.

El `code` del catálogo también es local al servicio: `const VACCINATION_MOMENT_CATALOG = 'vaccinationMoment';`, consumido por las dos validaciones de doble salto.

### 3.4 Superficie HTTP

```
POST   /api/investigation-vaccination-contexts                ESAVI-INVVACTX-001   USER        (nuevo)
GET    /api/investigation-vaccination-contexts                ESAVI-INVVACTX-002A  USER        (nuevo)
GET    /api/investigation-vaccination-contexts/admin          ESAVI-INVVACTX-002B  ADMIN       (nuevo)
DELETE /api/investigation-vaccination-contexts/purge/:id      ESAVI-INVVACTX-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-vaccination-contexts/case/:caseId   ESAVI-INVVACTX-006   USER        (nuevo)
GET    /api/investigation-vaccination-contexts/:id            ESAVI-INVVACTX-003   USER        (nuevo)
PUT    /api/investigation-vaccination-contexts/:id            ESAVI-INVVACTX-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationVaccinationContext.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28 a F35, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar un contexto de vacunación es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationVaccinationContext` · `006` · obtener el contexto de vacunación de un caso — la cadena `caso → investigación → contexto` es uno a uno en los dos saltos**.

**La abreviatura es `INVVACTX`.** Ocho letras, no colisiona con las treinta y seis registradas y `grep "ESAVI-INVVACTX-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-INVTEAM-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-`, `ESAVI-INVCLIEV-` ni `ESAVI-EVALINST-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

La regla del bloque mira el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resultingIsCluster = data.isCluster !== undefined ? (data.isCluster ?? null) : stored.isCluster
resultingField     = data[field]    !== undefined ? (data[field]    ?? null) : stored[field]
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**La comparación es `=== 'YES'`, y solo `'YES'` abre.** Sobre un `answerOption` anulable el «no abre» tiene **cinco** formas —`'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null`— y las cinco cuentan igual: **el bloque está cerrado**. Es el punto donde un lector supondría que solo `'NO'` cierra, y no es así: `'UNKNOWN'` significa que no se sabe si hay clúster, y un identificador de clúster registrado bajo esa respuesta no describe nada.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| `momentItemId` y `multidoseItemId` UUID, admitiendo `null` | validador | 400 `common.validationError` |
| `isCluster` y `clusterUsedSameVial` dentro de `ANSWER_OPTIONS`, admitiendo `null` | validador | 400 `common.validationError` |
| Los cuatro contadores con `.isInt({ min: 0, max: 32767 })`, admitiendo `null` | validador | 400 `common.validationError` |
| `clusterIdentificationNumber` cadena de hasta 100 caracteres | validador | 400 `common.validationError` |
| `locations` y `notes` como cadena | validador | 400 `common.validationError` |
| `momentItemId` / `multidoseItemId` existen, activos y del catálogo correcto | **servicio** | 404 `INVVACTX_<op>_MOMENT_NOT_FOUND` / `..._MULTIDOSE_NOT_FOUND` |
| Campo del bloque con valor y `isCluster` resultante distinto de `'YES'` | **servicio** | 400 `INVVACTX_<op>_CLUSTER_FIELDS_NOT_ALLOWED` |
| `clusterUsedSameVial` resultante `'NO'` y `clusterSameVialCount` resultante ausente | **servicio** | 400 `INVVACTX_<op>_CLUSTER_SAME_VIAL_COUNT_REQUIRED` |

**Los cuatro `CHECK` del DDL sí se replican en el validador**, a diferencia de F34, que no tenía ninguno. El techo de 32767 no está en el `CHECK` sino en el tipo `smallint`, y se replica igual: sin él, un `40000` sería un 500 de Postgres en vez de un 400 legible.

#### Las dos validaciones de catálogo

Las dos corren **antes del diff y con independencia de él**: un ítem inactivo es 404 aunque coincida con el guardado.

Doble salto, con la forma de `assertCatalogItemIsValid` (`investigationMedicalHistory.service.ts:222-246`) y el mismo patrón que F35 usó para su tipo de institución: `CatalogItem.findOne({ where: { catalogItemId, isActive: true }, include: [{ model: CatalogType, as: 'catalogType', where: { code: 'vaccinationMoment' }, attributes: [] }] })`.

- Si no hay fila para `momentItemId` → **404** `INVVACTX_<op>_MOMENT_NOT_FOUND`.
- Si no hay fila para `multidoseItemId` → **404** `INVVACTX_<op>_MULTIDOSE_NOT_FOUND`.

Tres motivos —no existe, está inactivo, no pertenece al catálogo— y un solo error por columna, porque ninguno de los tres es accionable de forma distinta. **Cada una solo corre cuando su clave llega con valor**: un `momentItemId: null` explícito no resuelve nada, porque se está vaciando.

**Dos códigos distintos y no uno compartido**, aunque el catálogo sea el mismo: el cliente tiene dos campos en pantalla y necesita saber cuál rechazar.

#### El bloque de clúster

**Con `isCluster` resultante `'YES'`, el bloque está abierto.** Los cuatro campos son opcionales y se guardan tal como lleguen. **No hay ningún campo exigible**: es la diferencia deliberada con F29 y F34, razonada en §6.

**Con `isCluster` resultante distinto de `'YES'`, el bloque está cerrado** y los cuatro campos están prohibidos, con la asimetría de F34:

- **`001` — es 400.** Mandar cualquiera de los cuatro con valor junto a un `isCluster` que no es `'YES'` es `INVVACTX_001_CLUSTER_FIELDS_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente los manda.** Los campos que **no viajan en el body** se **fuerzan a `null`**: cerrar el bloque limpia sus cuatro campos sin pedir permiso ni devolver error. Los que **viajan con valor** producen 400 `INVVACTX_004_CLUSTER_FIELDS_NOT_ALLOWED`: un body que niega el clúster y a la vez lo describe se contradice a sí mismo, y tragárselo perdería el dato en silencio haciendo creer al cliente que se guardó. Mandarlos en `null` **no** es error: es el mismo destino al que el forzado llega solo.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** los cuatro campos entran en `candidates` **siempre** que el bloque esté cerrado, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difieren. Si la fila ya los tenía en `null`, el diff no encuentra nada y **no se escribe**: cerrar un bloque ya cerrado no crece `appDetails`.

**Un solo error para los cuatro campos, y no cuatro claves.** El bloque es un concepto único —«esto no es un clúster»— y el mensaje que el usuario necesita leer es el mismo sea cual sea el campo que sobra. Es lo contrario de lo que decidió F34 para sus tres pares, y §6 razona por qué la asimetría es correcta.

#### La regla del vial compartido

Es la regla del comentario de `esaviapp.sql:1144`, y **solo se evalúa con el bloque abierto**:

- Si `isCluster` resultante es `'YES'` **y** `clusterUsedSameVial` resultante es `'NO'`, entonces `clusterSameVialCount` resultante debe tener valor → si es `null`, **400** `INVVACTX_<op>_CLUSTER_SAME_VIAL_COUNT_REQUIRED`.
- Con cualquier otro valor de `clusterUsedSameVial` —incluido `'YES'`— el contador es opcional.
- Con el bloque **cerrado** la regla no se evalúa: los cuatro campos ya están prohibidos o forzados a `null`, y exigir uno de ellos sería contradictorio.

**Se implementa literalmente como está escrita en el DDL**, aunque su lectura sea contraintuitiva: si *no* todos los del clúster usaron el mismo frasco, hay que decir *cuántos* sí lo usaron. §6 razona por qué no se «corrige» a `'YES'`.

**La regla corre después de la prohibición del bloque**, en las dos operaciones. Un body con `isCluster: 'NO'` y `clusterUsedSameVial: 'NO'` recibe el 400 de la prohibición, no el de la obligación: el bloque cerrado manda.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Un contexto cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVVACTX-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVVACTX_001_INVESTIGATION_NOT_FOUND`.
2. Esa investigación **no tiene ya contexto**, buscando **sin filtrar por `deletedAt`** → 409 `INVVACTX_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fila sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. La regla del bloque de clúster, en su variante estricta.
4. La regla del vial compartido, si el bloque quedó abierto.
5. Las dos validaciones de catálogo, cada una solo si su clave llega con valor.
6. Normaliza: `.trim()` sobre `locations`, `clusterIdentificationNumber` y `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
7. Inserta con la entrada de auditoría `method: 'ESAVI-INVVACTX-001'`.

**El alta mínima es `{ investigationId }`** y devuelve 201 con las once columnas de datos en `null`.

**`ESAVI-INVVACTX-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, más los dos include de catálogo en `required: false`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**Los dos include de catálogo van en `required: false`**, y eso no es un detalle: con `required: true` un contexto sin franja horaria registrada desaparecería del listado. Es el error clásico de una FK anulable resuelta con include.

**`ESAVI-INVVACTX-002B` — listar, admin.** Idéntica, con el include del padre en `where: {}`: devuelve también los contextos de investigaciones inactivas. Los mismos dos filtros y el mismo orden.

**`ESAVI-INVVACTX-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVVACTX_003_NOT_FOUND`. Forma completa de §3.7 con los dos catálogos resueltos.

**`ESAVI-INVVACTX-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVVACTX_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVVACTX_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene contexto → 404 `INVVACTX_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVVACTX-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVVACTX_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Un contexto no se traslada entre investigaciones.
3. Cálculo del estado resultante, la regla del bloque de clúster y la del vial compartido. **Antes del diff y con independencia de él.**
4. Las dos validaciones de catálogo, cada una solo si su clave llega con valor. **También antes del diff:** un ítem inactivo es 404 aunque coincida con el guardado.
5. `stored` sale de `context.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
6. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
7. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `momentItemId` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. FK validada **antes** del diff |
| `multidoseItemId` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. FK validada **antes** del diff |
| `vaccinatedPerVialCount` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **`0` es un valor válido** |
| `vaccinatedPerBatchCount` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **`0` es un valor válido** |
| `locations` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, `.trim()` antes de comparar |
| `isCluster` | `data.x !== undefined ? (data.x ?? null) : undefined` | **llave del bloque: decide, no es decidida** |
| `clusterIdentificationNumber` | bloque abierto: `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` — bloque cerrado: **siempre `null`** | **derivado condicional** |
| `clusterAdditionalCaseCount` | bloque abierto: `data.x !== undefined ? (data.x ?? null) : undefined` — bloque cerrado: **siempre `null`** | derivado condicional |
| `clusterUsedSameVial` | ídem que el anterior | derivado condicional. Y a su vez llave de `clusterSameVialCount` |
| `clusterSameVialCount` | ídem | derivado condicional |
| `notes` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, `.trim()` |

**Ningún campo va bajo un `if( data.x )`.** Sobre los cuatro contadores sería directamente destructivo: **`0` es un valor válido** —«ninguna otra persona se vacunó de ese frasco» es un dato clínicamente relevante— y un `if` de veracidad lo tiraría, dejando el campo sin forma de guardar el cero. Sobre los dos `answerOption` funcionaría por accidente —las cinco cadenas del ENUM son `truthy`— pero descartaría en silencio el `null` con el que se vacía el campo.

**`isCluster` es la llave del bloque y no forma parte de él.** Entra como anulable corriente: es el campo que decide, no el decidido. `clusterUsedSameVial`, en cambio, es las dos cosas a la vez —campo del bloque y llave de `clusterSameVialCount`— y entra como derivado condicional del primero.

**`ESAVI-INVVACTX-005C` — purgar.** `purgeInvestigationVaccinationContextService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** la visibilidad heredada —quien purga es SUPERADMIN y la fila puede colgar de una investigación retirada— → 404 `INVVACTX_005C_NOT_FOUND`; guarda de sellado con `assertRowIsSealed(row, 'INVVACTX_005C_NOT_DELETED', lang)` → 409 si `deletedAt` está vacío; volcado al log en `warn` con la **fila completa** —no hay ningún campo cifrado ni identificativo que omitir, a diferencia de F34—; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` —la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6.

**La guarda de sellado es la única red de seguridad de la tabla.** El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** aquí: la columna no existe, `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró nunca. Es la misma situación de F29, F30, F32 y F34. `assertRowIsSealed` se consume **sin modificarlo**: deriva la clave `investigationVaccinationContext.notDeleted` del nombre de tabla y el id del `primaryKeyAttribute` del modelo.

**Purgar sí libera el `investigationId`**, y es la única vía que lo hace. Tras un `005C`, un `POST` sobre esa misma investigación devuelve 201. **Y no arrastra nada**: la tabla es hoja del grafo.

#### Los tres arrastres, ya sobre el servicio común

Sin `isActive`, lo que las cascadas mueven es el sello de `deletedAt`. Los tres son `update` masivos sobre `src/services/common/satelliteCascade.service.ts`, **que este spec consume sin modificar**. Es su **quinta** consumidora.

**`ESAVI-INVESTGN-005A` — sellar.** Dentro de la transacción que `setInvestigationActivationService` ya abre y **solo cuando `isActive === false`**, `cascadeSealSatellite` sella la fila de contexto de esa investigación con `method: 'ESAVI-INVESTGN-005A'` —el código de la operación que la arrastró, no el suyo—. Una investigación sin contexto sella cero filas y no falla. Una fila ya sellada conserva su `deletedAt` original y **no** recibe entrada nueva.

**`ESAVI-CASE-005A` — sellar también.** En `src/services/esaviCase.service.ts`, junto a las llamadas que F29, F30, F32 y F34 dejaron y en el mismo bloque. Es necesaria y no redundante, por la razón exacta que F29 §3.5 documentó: desactivar el caso arrastra la investigación con un `Investigation.update` masivo que **no** pasa por `setInvestigationActivationService`, así que la cascada del punto anterior nunca dispara desde aquí. Alcanza a los contextos cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`. Registra `method: 'ESAVI-CASE-005A'`.

**`ESAVI-INVESTGN-005B` — limpiar.** `cascadeClearSatellite` devuelve `deletedAt` a `null` al reactivar la investigación. Es una **cascada de subida**, legítima por lo mismo que en F29, F30, F32 y F34: el `deletedAt` del contexto no significa «alguien lo retiró», significa «su investigación estaba retirada». Registra `method: 'ESAVI-INVESTGN-005B'`. **`ESAVI-CASE-005B` no limpia nada**, coherente con F07, F29, F30, F32 y F34.

**Ninguno de los tres pasa por `buildDifferentialUpdate`, y es deliberado:** son escrituras con intención propia. Registran el hecho de sellar o devolver la fila, y ese registro en `appDetails` es precisamente lo que se quiere conservar.

**Volcado del `ESAVI-INVESTGN-005C`.** El purgado de una investigación arrastra su contexto por `ON DELETE CASCADE` sin pasar por ningún servicio. Se añade a `purgeInvestigationService` un volcado en nivel `warn` de la fila que va a desaparecer, junto a los cuatro que F29, F30, F32 y F34 dejaron, antes del `destroy` y dentro de la misma transacción. **No se bloquea la purga.**

**Validaciones de forma** (las emite `validateFields` con 400): en el `001`, `investigationId` obligatorio y `.isUUID()`; en los dos, `momentItemId` y `multidoseItemId` con `.isUUID()` admitiendo `null`, `isCluster` y `clusterUsedSameVial` con `.isIn(ANSWER_OPTIONS)` admitiendo `null`, los cuatro contadores con `.isInt({ min: 0, max: 32767 })` admitiendo `null`, `clusterIdentificationNumber` con `.isLength({ max: 100 })`, y `locations` y `notes` como cadena. `caseId` con `.isUUID()` en el `param` del `006`; los dos filtros del listado con `.isUUID()`, y `limit` y `offset` con `.isInt()`.

### 3.6 Claves i18n nuevas

Bloque `investigationVaccinationContext` en `src/data/i18n/es.json`, `en.json` y `nl.json` — **veinte claves**:

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
| `alreadyExists` | 409 cuando la investigación ya tiene contexto, sellado o no. Lleva `{{investigationId}}` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |
| `momentNotFound` | 404 cuando `momentItemId` no existe, está inactivo o no es de `vaccinationMoment` |
| `multidoseNotFound` | 404 cuando `multidoseItemId` no existe, está inactivo o no es de `vaccinationMoment` |
| `clusterFieldsNotAllowed` | 400 al mandar un campo del bloque con `isCluster` resultante distinto de `'YES'`. **En el `001` siempre; en el `004` solo cuando el campo viaja en el body** |
| `clusterSameVialCountRequired` | 400 con el bloque abierto, `clusterUsedSameVial` resultante `'NO'` y `clusterSameVialCount` ausente |

**Una sola clave para los cuatro campos del bloque, y no cuatro.** Es lo contrario de lo que decidió F34 para sus tres pares, y la razón está en §6: allí eran tres conceptos distintos, aquí es un solo concepto —«esto no es un clúster»— repartido en cuatro columnas. El mensaje que el usuario lee es el mismo sobre y sobra el que sobre.

**Dos claves distintas para los dos catálogos**, en cambio, aunque el catálogo sea el mismo: son dos campos separados en pantalla y el cliente necesita saber cuál corregir.

**Ninguna clave para las validaciones de forma:** las emite el validador y las responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio. Los cuatro `CHECK` de contador y el techo de `smallint` caen ahí.

**No hay `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`**: no existen las operaciones que las usarían. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave a los bloques `investigation`, `esaviCase`, `catalogItem` ni `catalogType`: los tres arrastres no producen mensajes propios y los dos maestros solo se leen.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004`, `006` y **también las filas de `002A` y `002B`**:

```
{ ok, message, data: {
    investigationId,
    momentItemId, multidoseItemId,
    vaccinatedPerVialCount, vaccinatedPerBatchCount,
    locations,
    isCluster, clusterIdentificationNumber, clusterAdditionalCaseCount,
    clusterUsedSameVial, clusterSameVialCount,
    notes,
    createdAt, updatedAt, deletedAt, appDetails,
    moment:          { catalogItemId, code, name },
    multidoseMoment: { catalogItemId, code, name },
    investigation: {
        investigationId, isActive, investigationStartDate,
        status: { catalogItemId, code, name },
        case:   { caseId, caseCode, eventDate }
    }
} }
```

**No hay forma reducida.** El listado devuelve la misma ficha que el `003`, por la misma razón que en F29, F30, F32 y F34: once columnas de datos, y recortarlas dejaría un listado sin contenido.

**`moment` y `multidoseMoment` llegan `null` cuando su FK lo está**, y eso es normal, no un error: las dos columnas son anulables y los dos include van en `required: false`. Es la diferencia con `investigation.status`, que **nunca** llega `null` por la regla que F28 §3.5 impuso a aquella entidad.

**Los dos `answerOption` se devuelven exactamente como se guardaron, `null` incluido**: un `null` significa que el formulario no recogió la respuesta y un `'NO_ANSWER'` que se preguntó y no se contestó.

**Los cuatro contadores se devuelven como número, y el `0` no se colapsa a `null`.** «Nadie más se vacunó de ese frasco» y «no se sabe cuántos» son datos distintos, y ninguna respuesta convierte uno en el otro.

**No se devuelve `isActive`**, porque la tabla no tiene esa columna. `deletedAt` es la única marca de estado que la fila lleva, e `investigation.isActive` es la fuente real de su visibilidad.

El include de la investigación es **obligatorio y no decorativo**: es lo que implementa la visibilidad heredada. `sysDetails` **nunca** se devuelve, ni el del contexto, ni el de la investigación, ni el de los ítems de catálogo. Ninguna respuesta incluye datos de las otras doce tablas satélite.

---

## 4. Plan de implementación

**Precondiciones.** El **SPEC F28** debe estar `Implementado` —la PK de esta tabla es su FK— y el **SPEC F32** también: `src/services/common/satelliteCascade.service.ts` nace allí y los pasos 11 y 12 lo consumen sin modificarlo.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Sembrar el catálogo `vaccinationMoment` en el DDL.** Las tres `CALL "upsertCatalogItem"` de §3.1 al final del bloque de siembra, junto a las de `evaluationInstitutionType`. **Es la única modificación de `esaviapp.sql` en todo el spec**, y va primera porque los pasos 5 y 9 no se pueden ejercitar sin ella.
   *Verificación:* `git diff esaviapp.sql` muestra **exactamente tres líneas añadidas** y ninguna modificada; ejecutar el DDL completo sobre una base limpia no produce errores; ejecutarlo **dos veces seguidas** deja tres ítems y no seis; `SELECT count(*) FROM "catalogItem" ci JOIN "catalogType" ct USING ("catalogTypeId") WHERE ct."code" = 'vaccinationMoment'` devuelve **3**, con `sortOrder` de 1 a 3.

2. **Modelo, asociaciones y tipos.** `src/models/investigationVaccinationContext.model.ts` con la PK **sin `defaultValue`**, `isCluster` y `clusterUsedSameVial` en `ENUM(...ANSWER_OPTIONS)`, los cuatro contadores en `SMALLINT`, `clusterIdentificationNumber` en `STRING(100)`, `locations` y `notes` en `TEXT`, y **sin atributo `isActive`**; `src/models/associations/investigationVaccinationContext.associations.ts` con el `belongsTo` a `Investigation` como `investigation`, el inverso `Investigation.hasOne(..., { as: 'vaccinationContext' })` y **los dos `belongsTo` a `CatalogItem` con alias `moment` y `multidoseMoment`**, registrado en `initModels()`; `src/types/investigation/investigationVaccinationContext.types.ts` con `CreateInvestigationVaccinationContextInput`, exportado por el `index.ts` de barrel del dominio. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; **un `findAll` con los dos include de catálogo a la vez devuelve dos objetos distintos y no dos copias del mismo** — es la comprobación que prueba que los alias están bien puestos; `vaccinationContext` no colisiona con `source`, `autopsy`, `teamMembers`, `medicalHistory` ni `clinicalEvaluation`; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `investigation`.

3. **Claves i18n.** El bloque `investigationVaccinationContext` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las **veinte** claves. **Sin `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`.**
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; `investigationVaccinationContext.notDeleted` existe en los tres archivos, que es lo que `assertRowIsSealed` resolverá en tiempo de ejecución sin que ningún `grep` estático lo vea; `momentNotFound` y `multidoseNotFound` están en los tres idiomas y **no son copia literal la una de la otra**.

4. **Validadores.** `src/validators/investigationVaccinationContext.validator.ts` con cinco arrays: `investigationVaccinationContextIdValidator`, `investigationVaccinationContextCaseIdValidator` (para el `param('caseId')` del `006`), `investigationVaccinationContextListValidator` (los dos filtros más `limit` y `offset`), `createInvestigationVaccinationContextValidator` y `updateInvestigationVaccinationContextValidator`. El de create exige `investigationId` UUID; los dos comparten las dos FKs de catálogo con `.isUUID()` admitiendo `null`, los dos `answerOption` con `.isIn(ANSWER_OPTIONS)` admitiendo `null`, los cuatro contadores con `.isInt({ min: 0, max: 32767 })` admitiendo `null`, `clusterIdentificationNumber` con `.isLength({ max: 100 })`, y `locations` y `notes` como cadena. **Ni la regla del bloque ni la del vial van aquí:** dependen del estado guardado y viven en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; `isCluster: 'MAYBE'` produce 400 y los cinco valores de `ANSWER_OPTIONS` no; `isCluster: null` pasa; `vaccinatedPerVialCount: -1` produce 400 y `0` **no**; `vaccinatedPerVialCount: 40000` produce **400 y no un 500 de Postgres**; un `clusterIdentificationNumber` de 101 caracteres produce 400; un body con el bloque incoherente **no** produce 400 en esta capa — lo hará el servicio en el paso 5.

5. **`ESAVI-INVVACTX-001` — crear.** `createInvestigationVaccinationContextService` con los siete pasos de §3.5 en ese orden: investigación existente y activa, unicidad del `investigationId` sin filtrar por `deletedAt`, la regla del bloque en su variante estricta, la regla del vial si el bloque quedó abierto, las dos validaciones de catálogo por doble salto, normalización con `.trim()`, inserción con auditoría. La prohibición del bloque se aplica recorriendo `CLUSTER_BLOCK_FIELDS`, **no escrita cuatro veces**. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* el alta mínima `{ investigationId }` devuelve **201** con las once columnas en `null`; crear dos veces sobre la misma investigación devuelve **409** `INVVACTX_001_ALREADY_EXISTS` con el `investigationId` interpolado; una investigación inactiva devuelve **404**; `{ isCluster: 'NO', clusterIdentificationNumber: 'C-1' }` devuelve **400** `clusterFieldsNotAllowed`; **`{ isCluster: 'UNKNOWN', clusterIdentificationNumber: 'C-1' }` devuelve también 400** —solo `'YES'` abre—; `{ isCluster: 'YES' }` sin ningún campo del bloque devuelve **201**; `{ isCluster: 'YES', clusterUsedSameVial: 'NO' }` sin contador devuelve **400** `clusterSameVialCountRequired`, y con `clusterSameVialCount: 0` devuelve **201**; un `momentItemId` que es un ítem **activo de otro catálogo** —uno de `sex`— devuelve **404** `momentNotFound`, que es el criterio que demuestra que el doble salto está implementado y no solo la existencia del UUID; el mismo UUID en `multidoseItemId` devuelve `multidoseNotFound` y no `momentNotFound`; `{ vaccinatedPerVialCount: 0 }` guarda `0` y no `null`.

6. **`ESAVI-INVVACTX-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, el include de la investigación en `required: true` con su `status` y su `case`, **los dos include de catálogo en `required: false`**, los dos filtros acumulativos, orden `[['createdAt','DESC']]`, paginación y la forma completa de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve contextos de investigaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; **un contexto con `momentItemId` en `null` aparece igualmente en los dos listados** — es lo que prueba que los include no son `required: true`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los dos filtros combinados se aplican con `AND`; toda fila trae las once columnas, `appDetails` y los dos objetos de catálogo; ninguna trae `isActive` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total.

7. **`ESAVI-INVVACTX-003` — obtener por ID.** `getInvestigationVaccinationContextByIdService(id, lang, includeInactive)` donde el `id` es el `investigationId`, con los tres include y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una fila cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; una fila con `deletedAt` sellado pero investigación activa **sí se devuelve** —el sello no oculta la fila, la oculta el padre—; `investigation.status` no llega `null`; `moment` y `multidoseMoment` llegan resueltos cuando su FK tiene valor y `null` cuando no; `sysDetails` no aparece en ninguno de los objetos de la respuesta.

8. **`ESAVI-INVVACTX-006` — obtener por caso.** `getInvestigationVaccinationContextByCaseIdService(caseId, lang, includeInactive)` con los **tres** 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `investigationVaccinationContextCaseIdValidator`, declarada antes de `/:id`. Fila `investigationVaccinationContext` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y contexto devuelve 200 con la ficha completa, no envuelta en un array; un `caseId` inexistente devuelve 404 `INVVACTX_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVVACTX_006_INVESTIGATION_NOT_FOUND`; una investigación sin contexto devuelve 404 `INVVACTX_006_NOT_FOUND`. Los tres códigos son distintos entre sí; `GET /case/no-es-uuid` devuelve 400.

9. **`ESAVI-INVVACTX-004` — actualizar, diferencial.** `updateInvestigationVaccinationContextService` con los siete pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` ignorado; `isCluster` y los campos sueltos como anulables corrientes; los **cuatro** campos del bloque como derivados condicionales contra el `isCluster` resultante; las dos validaciones de catálogo **antes** del diff. La lectura para el diff se hace **sin `attributes` acotados** y con el include del padre, para que la visibilidad heredada se compruebe en la misma consulta de la que sale la instancia. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; **`{ vaccinatedPerVialCount: 0 }` sobre una fila con `12` se guarda como `0`** y no se descarta; `{ vaccinatedPerVialCount: null }` vacía el campo; enviar `investigationId` distinto no lo modifica y no devuelve error; `{ isCluster: 'NO' }` sobre una fila con los cuatro campos del bloque llenos los deja **los cuatro en `null` en la misma petición** con **una** entrada en `appDetails`; `{ isCluster: 'NO', clusterIdentificationNumber: 'C-1' }` devuelve **400**; `{ isCluster: 'NO' }` sobre una fila que ya lo tenía cerrado y con el bloque vacío **no escribe nada**; un `momentItemId` que apunta a un ítem inactivo devuelve **404 aunque coincida con el guardado**.

10. **`ESAVI-INVVACTX-005C` — purgar.** `purgeInvestigationVaccinationContextService` sobre `purgeEntityService`, con transacción propia, existencia con `paranoid: false` y **sin** visibilidad heredada, y `assertRowIsSealed(row, 'INVVACTX_005C_NOT_DELETED', lang)` **antes** del `destroy`. Volcado en `warn` de la fila completa. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `investigationVaccinationContextIdValidator` y declarada junto a las otras literales.
    *Verificación:* purgar una fila sin `deletedAt` sellado devuelve 409 `notDeleted` con el id interpolado y la fila sigue ahí — **es la comprobación que prueba que el control de `isActive` de `purgeEntityService` es inerte aquí**; desactivar la investigación y purgar devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre esa investigación devuelve 201**; la investigación, sus otras satélites y **los ítems de `vaccinationMoment`** siguen existiendo e intactos.

11. **Los dos arrastres desde `investigation` y el volcado del `005C`.** En `src/services/investigation.service.ts`, dos llamadas nuevas al servicio común desde `setInvestigationActivationService`: `cascadeSealSatellite` con `InvestigationVaccinationContext` y `method: 'ESAVI-INVESTGN-005A'` **solo cuando `isActive === false`**, y `cascadeClearSatellite` con `'ESAVI-INVESTGN-005B'` **solo cuando `isActive === true`**, las dos dentro de la transacción que aquel servicio ya abre y junto a las de F29, F30, F32 y F34. Más el volcado en `warn` de la fila en `purgeInvestigationService`, antes del `destroy` y en la misma transacción. **`satelliteCascade.service.ts` no se toca.**
    *Verificación:* desactivar una investigación con contexto le sella `deletedAt`; reactivarla lo devuelve a `null`; una fila sellada a mano **antes** de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; una investigación sin contexto se desactiva y se reactiva sin error; el `appDetails` de la arrastrada registra `ESAVI-INVESTGN-005A` y luego `ESAVI-INVESTGN-005B`, con su historial anterior intacto; **los arrastres de las cuatro satélites anteriores siguen funcionando igual** y las cinco filas se sellan en la misma transacción; purgar una investigación con las cinco deja **cinco** líneas `warn` en `src/logs/esaviLog.log` y **no** devuelve error; `git diff src/services/common/satelliteCascade.service.ts` está vacío.

12. **El tercer arrastre, desde `esaviCase`.** En `src/services/esaviCase.service.ts`, una llamada más junto a las que F29, F30, F32 y F34 dejaron, invocada en el mismo bloque, dentro de la misma transacción y **solo cuando `isActive === false`**, sobre el servicio común. Alcanza a los contextos cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`, y registra `method: 'ESAVI-CASE-005A'`. Va después del paso 11 porque depende del modelo y no lo necesita ningún paso anterior. **`ESAVI-CASE-005B` no se toca.**
    *Verificación:* desactivar un caso con investigación y contexto **sella el contexto**, y ése es el punto entero del paso: sin él quedaría sin sellar, porque la investigación la arrastra un `update` masivo que no pasa por `setInvestigationActivationService`; reactivar el caso no limpia el sello; un caso sin investigación, o con investigación sin contexto, se desactiva sin error; las cascadas anteriores siguen produciendo el mismo efecto.

13. **Registrar la entidad en las convenciones.** Fila `investigationVaccinationContext` → `INVVACTX` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationVaccinationContext` · `006` · «obtener el contexto de vacunación de un caso — la cadena `caso → investigación → contexto` es uno a uno en los dos saltos» en la tabla de operaciones no canónicas.
    *Verificación:* `INVVACTX` aparece una sola vez y no colisiona con las registradas; la tabla de no canónicas suma exactamente una fila.

14. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más siete.
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/investigationVaccinationContext.test.ts`.** Recorrido completo con `supertest`: crear vacío → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → purgar. Más los caminos de error: investigación inexistente (404), investigación inactiva (404), investigación ya con contexto sellado y sin sellar (409 las dos), caso inexistente y caso sin investigación en el `006` (404 con códigos distintos), **el bloque de clúster en sus cinco variantes de `isCluster`** —`'YES'` abre, y `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'` y `null` cierran—, la regla del vial en `001` y en `004`, las dos FKs de catálogo con un ítem de otro catálogo (404 con códigos distintos), y purgar sin sellar (409). Más el bloque diferencial completo de §5, con cobertura explícita del **`0`** en los cuatro contadores.
    *Verificación:* `npm test -- investigationVaccinationContext` en verde.

16. **Ampliar `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera, tres casos: desactivar la investigación sella su contexto, reactivarla lo limpia, y purgar la investigación lo destruye por cascada de Postgres sin devolver error. En la segunda, dos: desactivar el caso sella el contexto de su investigación, y reactivarlo no lo limpia. **Los casos que F29, F30, F32 y F34 añadieron a las dos suites se mantienen intactos**, y los nuevos comprueban que las cinco satélites se arrastran juntas por el mismo servicio común.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las seis operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVVACTX-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVVACTX-005[AB]" src/` no devuelve resultados: la entidad **no tiene** activación ni desactivación propias.
- [ ] `grep -rn "ESAVI-INVVACTX-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "isActive" src/models/investigationVaccinationContext.model.ts` no devuelve resultados: la tabla no tiene esa columna.
- [ ] El modelo importa `ANSWER_OPTIONS` de `src/constants/enums.constants.ts` y **no declara ninguna lista de valores propia**.
- [ ] Los cuatro contadores están declarados en el modelo como `SMALLINT`, no como `INTEGER`.
- [ ] `INVVACTX` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigationVaccinationContext` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` exporta el archivo nuevo.
- [ ] `GET /api/investigation-vaccination-contexts/admin` y `.../case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Investigation.hasOne(InvestigationVaccinationContext, { as: 'vaccinationContext' })` está declarado, no colisiona con `source`, `autopsy`, `teamMembers`, `medicalHistory` ni `clinicalEvaluation`, y el contexto **no** aparece en ninguna respuesta de `/api/investigations`.
- [ ] `git diff esaviapp.sql` muestra **exactamente tres líneas añadidas** —las tres `CALL`— y ninguna modificada.

**El catálogo y las dos FKs**

- [ ] Ejecutar el DDL dos veces seguidas sobre la misma base deja **tres** ítems en `vaccinationMoment`, no seis. `SELECT count(*)` sobre el join con `catalogType` devuelve `3`, con `sortOrder` de 1 a 3.
- [ ] `POST` con un `momentItemId` que es un `catalogItem` **activo de otro catálogo** —un ítem de `sex`— → **404** `momentNotFound`. Es el criterio que demuestra que el doble salto está implementado y no solo la existencia del UUID.
- [ ] Ese mismo UUID en `multidoseItemId` → **404** `multidoseNotFound`, un código distinto del anterior. Las dos columnas comparten catálogo y **no** comparten error.
- [ ] Un `momentItemId` que apunta a un ítem **inactivo** de `vaccinationMoment` → 404, en `001` y en `004`.
- [ ] Los dos `belongsTo` a `CatalogItem` resuelven objetos **distintos**: una fila con `momentItemId` = `FIRST_HOURS` y `multidoseItemId` = `LAST_HOURS` devuelve `moment.code === 'FIRST_HOURS'` y `multidoseMoment.code === 'LAST_HOURS'`, no dos copias del mismo.
- [ ] Una fila con `momentItemId` en `null` **aparece igualmente** en los dos listados y en el `003`, con `moment: null`: los include de catálogo son `required: false`.

**El bloque de clúster**

- [ ] `POST` con `{ isCluster: 'NO', clusterIdentificationNumber: 'C-1' }` → **400** `clusterFieldsNotAllowed`.
- [ ] `POST` con `{ isCluster: 'UNKNOWN', clusterIdentificationNumber: 'C-1' }` → **400** también, e igual con `'NOT_APPLICABLE'`, `'NO_ANSWER'` y sin `isCluster`. **Solo `'YES'` abre el bloque**, y este criterio es el que lo prueba en las cinco formas del «no».
- [ ] `POST` con `{ isCluster: 'YES' }` y ningún campo del bloque → **201**. El bloque abierto **no exige nada**.
- [ ] Los cuatro campos del bloque producen el **mismo** código de error: `grep -n "clusterFieldsNotAllowed" src/services/investigationVaccinationContext.service.ts` muestra una sola clave para los cuatro.
- [ ] `PUT` con `{ isCluster: 'NO' }` sobre una fila con los cuatro campos del bloque llenos → **200**, con los **cuatro** en `null` en la **misma** petición y **una** sola entrada en `appDetails`. No hay huérfanos y no hay error.
- [ ] `PUT` con `{ isCluster: 'NO', clusterAdditionalCaseCount: 3 }` → **400**. El forzado silencioso no se traga un body que se contradice a sí mismo.
- [ ] `PUT` con `{ isCluster: 'NO' }` sobre una fila que ya lo tenía cerrado y con el bloque vacío → **200 sin escribir nada**: los cuatro `null` forzados entran en `candidates` pero el diff no encuentra diferencia.
- [ ] `PUT` con `{ isCluster: 'YES' }` sobre una fila con identificador ya guardado → **200**, y el identificador **sobrevive**. El estado resultante manda, no el body.

**La regla del vial compartido**

- [ ] `POST` con `{ isCluster: 'YES', clusterUsedSameVial: 'NO' }` y sin `clusterSameVialCount` → **400** `clusterSameVialCountRequired`.
- [ ] El mismo body con `clusterSameVialCount: 0` → **201**. El cero satisface la obligación.
- [ ] `POST` con `{ isCluster: 'YES', clusterUsedSameVial: 'YES' }` y sin contador → **201**. La obligación es solo del `'NO'`.
- [ ] `POST` con `{ isCluster: 'NO', clusterUsedSameVial: 'NO' }` → **400** `clusterFieldsNotAllowed`, **no** `clusterSameVialCountRequired`. Con el bloque cerrado la regla del vial no se evalúa.
- [ ] `PUT` con `{ clusterUsedSameVial: 'NO' }` sobre una fila con `isCluster: 'YES'` y sin contador guardado → **400**: la regla mira el estado resultante, no solo el body.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationVaccinationContext.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada —tanto `momentItemId` como `multidoseItemId`, y aunque coincidan con lo guardado—; y un `PUT` sobre una fila cuya investigación está inactiva responde **404** para USER y ADMIN y **200** para SUPERADMIN.
- [ ] **`{ vaccinatedPerVialCount: 0 }` sobre una fila con `12` guarda `0`**, y `{ vaccinatedPerVialCount: null }` la vacía. Ningún candidato entra bajo un `if( data.x )`, y esto vale para los **cuatro** contadores.
- [ ] `{ isCluster: null }` sobre una fila con `'NO_ANSWER'` vacía el campo, y `{ isCluster: 'NO_ANSWER' }` sobre esa misma fila **no** cuenta como cambio: `null` y `'NO_ANSWER'` son datos distintos y ninguno se convierte en el otro.
- [ ] `{ locations: "" }` deja el campo vacío, y un `locations` con espacios alrededor del mismo texto guardado **no** cuenta como cambio: el `.trim()` va antes de comparar. Igual para `clusterIdentificationNumber` y `notes`.

**Los tres arrastres**

- [ ] Desactivar una investigación con contexto le sella `deletedAt`; reactivarla lo devuelve a `null`.
- [ ] Desactivar un caso con investigación y contexto **sella el contexto**; reactivar el caso **no** lo limpia.
- [ ] El `appDetails` de la fila arrastrada registra su `method` correcto: `ESAVI-INVESTGN-005A`, `ESAVI-INVESTGN-005B` o `ESAVI-CASE-005A`, según la operación que la arrastró.
- [ ] Una fila ya sellada conserva su `deletedAt` original y no recibe entrada nueva.
- [ ] `git diff src/services/common/satelliteCascade.service.ts` está vacío: este spec lo consume, no lo modifica.
- [ ] `tests/contract/investigationSource.test.ts`, `investigationAutopsy.test.ts`, `investigationMedicalHistory.test.ts` e `investigationClinicalEvaluation.test.ts` pasan **sin que se haya tocado un solo caso**.
- [ ] Desactivar una investigación con las cinco satélites sin `isActive` las sella **las cinco** en la misma transacción.

**Cierre**

- [ ] Las veinte claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el bloque de clúster**

- **Sí: solo `'YES'` abre el bloque. No: que solo `'NO'` lo cierre.** Es la decisión que más fácilmente se lee al revés, y por eso está escrita tres veces en el spec. `isCluster` es un `answerOption` de cinco valores, no un booleano, así que entre «sí» y «no» hay tres respuestas más. Un `clusterIdentificationNumber` registrado bajo `isCluster: 'UNKNOWN'` no describe nada: si no se sabe si hay conglomerado, no hay conglomerado que identificar. Se valoró tratar `'UNKNOWN'` y `'NO_ANSWER'` como **neutros** —ni exigen ni prohíben— y se descarta: un estado neutro deja el bloque en tierra de nadie, sin regla que lo limpie en el `004` y sin criterio que lo verifique. Dos estados —abierto y cerrado— son verificables; tres no.
- **Sí: el bloque no tiene lado obligatorio.** Con `isCluster: 'YES'` los cuatro campos siguen siendo opcionales. Es la diferencia deliberada con F29 y F34, que sí exigen la explicación cuando la bandera está encendida, y se separa de ellas por dos razones. La primera es que el DDL no declara ningún `NOT NULL` ni ningún `CHECK` condicional. La segunda es de dominio: un investigador puede saber que el caso pertenece a un clúster **antes** de que ese clúster tenga identificador asignado, y bloquear el guardado ahí obligaría a inventarse un número. En F34 la asimetría era la contraria: una sospecha de maltrato sin una línea que la sustente no sirve para nada aguas abajo.
- **Sí: una sola clave i18n para los cuatro campos. No: cuatro claves, como F34 hizo con sus tres pares.** Allí eran tres conceptos distintos —«describe la otra fuente», «explica la sospecha de maltrato»— y el mensaje tenía que serlo también. Aquí es **un** concepto —«esto no es un clúster»— repartido en cuatro columnas, y el mensaje que el usuario lee es el mismo sobre cualquiera de ellas. Cuatro claves idénticas en tres idiomas son doce cadenas que divergen en la primera corrección.
- **Sí: el forzado como derivado condicional dentro de `candidates`. No: limpiarlo con un `update` posterior al diff.** Un segundo `UPDATE` escribiría aunque nada cambie, y rompería el criterio de que cerrar un bloque ya cerrado no crece `appDetails`. Es la decisión de F34, heredada sin reabrirse.
- **Sí: la asimetría `001` / `004` heredada de F29 y F34.** En el alta, mandar un campo del bloque con `isCluster` no `'YES'` es 400; en el update, si el campo no viaja se fuerza a `null` sin error, y si viaja con valor es 400. El huérfano lo creó una petición anterior, no ésta.

**Sobre la regla del vial compartido**

- **Sí: implementar el comentario del DDL literalmente —`'NO'` exige el contador—. No: «corregirlo» a `'YES'`.** La lectura intuitiva sería la contraria: si todos usaron el mismo frasco, dime cuántos. Pero el comentario de `esaviapp.sql:1144` dice `'No'`, y tiene sentido de dominio: cuando **no** todos los casos del clúster compartieron vial, el dato que falta es cuántos sí lo hicieron, porque ése es el subconjunto con exposición común. Cuando todos lo compartieron, el número ya está en `clusterAdditionalCaseCount` y preguntarlo otra vez sería redundante. Se valoró invertirla asumiendo un error de redacción y se descarta: el DDL es la fuente autoritativa del repositorio, y reinterpretarlo en la aplicación deja dos verdades donde había una. Si mañana se confirma que el comentario estaba mal, se corrige el DDL **y** el spec, no solo el código.
- **Sí: la regla solo se evalúa con el bloque abierto. No: evaluarla siempre.** Con `isCluster` cerrado los cuatro campos ya están prohibidos o forzados a `null`; exigir uno de ellos ahí sería pedir un dato y prohibirlo en la misma petición.
- **Sí: la prohibición del bloque corre antes que la obligación del vial.** Un body con `isCluster: 'NO'` y `clusterUsedSameVial: 'NO'` recibe `clusterFieldsNotAllowed`, no `clusterSameVialCountRequired`. El error que se devuelve es el del problema de fuera, no el del de dentro.
- **Sí: el `0` satisface la obligación.** «Ninguno de los otros casos usó el mismo vial» es una respuesta, no una ausencia. Es la misma razón por la que ningún candidato entra bajo un `if( data.x )`.

**Sobre el catálogo**

- **Sí: un solo `catalogType` para las dos columnas. No: dos catálogos con los mismos tres ítems.** `momentItemId` y `multidoseItemId` responden la misma pregunta —en qué franja de la jornada se aplicó— sobre dos presentaciones distintas. Duplicar el catálogo obligaría a mantener dos listas idénticas y a sembrar seis ítems donde bastan tres, con la garantía de que divergen en el primer añadido que solo se aplique a una.
- **Sí: dos códigos de error distintos pese al catálogo compartido.** El cliente tiene dos campos en pantalla y necesita saber cuál rechazar. Compartir catálogo es una decisión de datos; compartir mensaje sería una decisión de interfaz, y la peor de las dos.
- **Sí: sembrar el catálogo dentro de este spec, en el DDL.** Es la decisión de F35, heredada por la misma razón: sin el catálogo las dos columnas son inservibles y todo `POST` que las mande responde 404. **No: dejarlo como precondición externa documentada** — convertiría un requisito en una nota que alguien tiene que leer.
- **Sí: `code` en `CONSTANT_CASE` inglés y los nombres en inglés, con los ordinales del formulario como `sortOrder`.** Los `1`, `2` y `3` que el formulario usa para las tres franjas son **orden de presentación**, no identidad: un `code: '1'` sería imposible de leer en un log y colisionaría con cualquier otro catálogo que numerase igual. Toda la siembra del repositorio —`ageUnit`, `sex`, `healthFacilityType`, `evaluationInstitutionType`— hace lo mismo, y las etiquetas en español las sirve la capa de presentación.
- **Sí: los dos include de catálogo en `required: false`.** Con `required: true` un contexto sin franja horaria registrada desaparecería del listado. Es el error clásico de una FK anulable resuelta con include, y aquí afectaría a la mayoría de las filas: las once columnas son opcionales y el alta vacía es el caso normal.

**Sobre el alcance**

- **Sí: `SMALLINT` en el modelo y el techo de 32767 en el validador.** Sin el techo, un `40000` llega a Postgres y vuelve como 500 por desbordamiento de tipo. El `CHECK >= 0` del DDL cubre el suelo y nada cubre el techo salvo el tipo de la columna, así que el validador lo replica explícitamente.
- **No: filtrar, contar ni agregar por `isCluster`.** Sería el primer filtro por dato de dominio del repositorio, y el primero abre la puerta a los tableros. Los dos únicos filtros del listado siguen siendo `investigationId` y `caseId`, los de F29, F32 y F34.
- **No: resolver `clusterIdentificationNumber` contra nada.** Es una cadena libre que este spec guarda y no interpreta. Agrupar las investigaciones que comparten identificador, contarlas o validar que `clusterAdditionalCaseCount` coincida con esa cuenta exige decidir antes si el clúster es una entidad propia con su tabla, y esa decisión no está tomada.
- **No: estructurar `locations`.** Es `text` libre en el DDL y así se queda. Convertirlo en una relación con `geoLocation` es un cambio de modelo que ni el esquema ni el formulario respaldan hoy.
- **Sí: dejar disparar el `ESAVI-INVESTGN-005C` con el contexto colgando, con volcado en `warn` como única mitigación. No: bloquearlo.** Es la decisión de F13, F29, F30, F32 y F34, heredada sin reabrirse.
- **Sí: volcar la fila completa al log en el `005C`.** A diferencia de F34, aquí no hay ningún campo cifrado ni ningún nombre de persona que omitir: las once columnas son datos operativos de una jornada de vacunación.
- **Sí: listado dual `002A` / `002B`.** La visibilidad se hereda del padre, así que las dos variantes devuelven conjuntos distintos y la distinción no es decorativa.
- **Sí: forma completa también en los listados. No: una forma reducida.** Once columnas de datos y dos objetos de catálogo pequeños: recortarlas dejaría un listado sin contenido.
- **Sí: consumir `satelliteCascade.service.ts` sin modificarlo.** Ésta es su quinta consumidora y el archivo no se toca; que su `git diff` esté vacío es un criterio de aceptación.
- **Sí: `INVVACTX`, ocho letras.** Se valoró `INVVCTX` (siete) y se descarta por ilegible. Se reserva además `INVVACAD` para `investigationVaccineAdministered`, que es la siguiente satélite y cuyo nombre se parece lo bastante como para que dos abreviaturas mal elegidas se confundan en un `grep` del log.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Alguien lee `isCluster` como un booleano y asume que **solo `'NO'`** cierra el bloque, dejando `'UNKNOWN'` y `'NO_ANSWER'` como puertas abiertas por las que entran datos de clúster huérfanos | Es el riesgo principal del spec. Está declarado en §1-A, en §2, en §3.5 y en §6, y tiene criterio de aceptación propio que ejercita **las cinco formas del «no»**, no solo el `'NO'` |
| La regla del vial compartido se «corrige» a `'YES'` durante la implementación, por parecer más intuitiva | El comentario de `esaviapp.sql:1144` es la fuente y está citado textualmente en §3.1. §6 razona por qué se implementa literalmente y qué hacer si mañana se confirma que estaba mal: corregir el DDL **y** el spec, no solo el código |
| Los dos `belongsTo` al mismo `CatalogItem` se declaran sin alias distintos, y la respuesta resuelve dos veces la misma columna sin que ningún test lo note | El paso 2 lleva verificación específica —dos objetos distintos, no dos copias— y §5 tiene el criterio con dos ítems diferentes en las dos columnas. Es un fallo silencioso: sin ese caso concreto, una fila con las dos FKs iguales pasaría igual |
| Los include de catálogo se declaran en `required: true` y el listado pierde todas las filas sin franja horaria registrada, que son la mayoría | Está declarado en §3.5 y §3.7, con criterio propio en §5 y verificación en el paso 6. Con el alta vacía como caso normal, el fallo se manifestaría al día siguiente de desplegar |
| Un `if( data.x )` sobre los cuatro contadores descarta el `0` en silencio, y «nadie más se vacunó de ese frasco» se vuelve inexpresable | §3.5 lo prohíbe explícitamente y §5 lo verifica sobre los cuatro campos. Es el mismo fallo que F34 documentó sobre sus banderas booleanas |
| El DDL se despliega sin las tres `CALL` de siembra y las dos columnas de catálogo responden 404 sin que el error diga que falta el catálogo | La siembra es el **paso 1** del plan, precisamente para que no pueda quedarse atrás, y su verificación comprueba la idempotencia y el conteo. Es la decisión que F35 tomó y aquí se hereda |
| Un `smallint` desbordado devuelve 500 en vez de 400 | El validador replica el techo de 32767 además del `CHECK >= 0`, con criterio propio en §5 |
| `GET /:id` captura `/admin`, `/purge` y `/case` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato y por un criterio de §5 |
| El control de `isActive` de `purgeEntityService` es **inerte** sobre esta tabla, y un `005C` podría destruir una fila que nadie retiró | `assertRowIsSealed` es la única red, y su 409 tiene criterio propio en §5. Es la misma situación de F29, F30, F32 y F34, ya conocida y ya probada |
| Las cinco satélites sin `isActive` se sellan ahora en la misma transacción, y un fallo en la quinta invalida el arrastre de las cuatro anteriores | Es el comportamiento correcto —o se sellan todas o ninguna—, pero conviene saberlo: el criterio de §5 comprueba que las cinco se sellan juntas, y las suites de F29, F30, F32 y F34 deben pasar sin tocar un caso |

---

## 8. Impacto en el contrato HTTP

**Ninguno.** El spec solo añade endpoints nuevos. Las tres invocaciones que añade a `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts` no cambian el `data`, el `message` ni el status de ninguna operación de aquellas entidades: sellan y limpian una tabla que sus respuestas no incluyen. El `hasOne` nuevo tampoco aparece en ningún `include` de `/api/investigations`.

**Y el catálogo nuevo sí es visible, pero no rompe nada.** Las tres `CALL` de siembra añaden un `catalogType` y tres `catalogItem`, así que `GET /api/catalog-types` y `GET /api/catalog-items` devuelven **cuatro filas más** que antes y sus `count` cambian. Ningún cliente que pagine o filtre queda roto —las dos entidades ya crecen con cada spec que siembra su catálogo, y F35 dejó el mismo efecto—, pero un test que afirme un `count` literal sobre esos listados sí lo notaría.

---

## Lo que **no** está en este spec

- Las cinco satélites de `investigation` que siguen sin spec: `investigationCovidHistory`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- Cualquier regla cruzada con `investigationVaccineAdministered`, `investigationColdChain`, `notificationVaccine`, `esaviCase` o `patient`.
- Cualquier lógica de conglomerado que cruce investigaciones: agrupar por `clusterIdentificationNumber`, contarlas o contrastar `clusterAdditionalCaseCount` contra esa cuenta.
- Filtrar, contar o agregar por `isCluster`.
- Búsqueda por texto sobre `locations`, `clusterIdentificationNumber` o `notes`.
- Estructurar `locations` como relación con `geoLocation`.
- Derivar nada de los cuatro contadores.
- Ampliar el catálogo `vaccinationMoment` o reutilizarlo desde otra entidad.
- Operaciones `005A` y `005B`: la tabla no tiene `isActive`.
- Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene contexto de vacunación.
- Modificar `esaviapp.sql` más allá de las tres `CALL` de siembra, ni `satelliteCascade.service.ts`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.
- Añadir el listado dual a `severeNotification` y `nonSevereNotification`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
