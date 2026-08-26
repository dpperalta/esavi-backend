# SPEC F39 — CRUD de `investigationAdministrationError`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), **SPEC F32 (`investigationMedicalHistory` — aporta `satelliteCascade.service.ts`, que este spec consume ya extraído)**, **SPEC F34 (`investigationClinicalEvaluation` — aporta el patrón del bloque condicional con su asimetría `001`/`004`)**, **SPEC F38 (`investigationColdChain` — hermana de forma directa: misma PK-FK, misma ausencia de `isActive`, misma convivencia de `boolean` y `answerOption`, mismo listado dual)**, SPEC F13 y SPEC F14 (patrón de satélite sin `isActive`), SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-25
> **Objetivo:** Dar de alta `investigationAdministrationError` —qué falló en el acto de administrar la vacuna: con qué jeringas se aplicó, cómo se reconstituyó y qué errores concretos hubo en prescripción, preparación, manipulación y aplicación— como la **novena** tabla con FK directa a `investigation` que recibe spec propio.

---

## 1. Por qué existe este spec

`investigationAdministrationError` responde al bloque del formulario de investigación que audita el **error programático**: no si la vacuna era mala, sino si se administró mal. Es la contraparte de F38 — aquélla pregunta cómo se conservó el producto antes de aplicarse, ésta pregunta qué pasó al aplicarlo. La tabla separa **cuatro grupos**:

- **Las jeringas.** Si se usaron autodesactivables (`usedAutoDisableSyringes`) y, si no, cuáles se usaron: de vidrio, desechables, desechables recicladas u otras, más la descripción de esas otras y los hallazgos clave.
- **La reconstitución.** Cinco preguntas sobre cómo se reconstituyó el frasco —misma jeringa, misma jeringa con otra vacuna, jeringa distinta del mismo vial, jeringa distinta con otra vacuna, y si se siguió la recomendación del fabricante— más sus hallazgos.
- **Los seis errores concretos.** Prescripción, vacuna contaminada, condiciones anormales del producto, preparación, manipulación y administración impropia; cada uno con su bandera y su nota.
- **Las observaciones generales**, en `notes`.

Hoy la tabla existe en `esaviapp.sql:1200-1236` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **novena tabla con FK directa a `investigation`** que recibe spec propio, tras F29, F30, F31, F32, F34, F36, F37 y F38. De forma es hermana directa de **F38**, y los cuatro rasgos que aquélla fijó se cumplen aquí sin matices — se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`:1201`) y destino de `FK_investigationAdministrationError_investigation` (`:1235`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **novena** del repositorio así, tras `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy`, `investigationMedicalHistory`, `investigationClinicalEvaluation`, `investigationVaccinationContext` e `investigationColdChain`. De ahí sale que **no haya `005A` ni `005B`**, y que la visibilidad se herede de `investigation.isActive`.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete`, así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar.
- **Solo lleva el trigger genérico.** `TRG_investigationAdministrationError_setSysDetails`, del bucle de `esaviapp.sql:1290-1305`. `updatedAt` lo escribe la aplicación.

**Y tres cosas que este spec ya no tiene que resolver.** `satelliteCascade.service.ts` nace en F32 y esta entidad es su siguiente consumidora, sin tocarlo. La asimetría `001`/`004` de un bloque condicional —400 en el alta, forzado a `null` en el update— la fijó F34. Y **no hay ninguna FK a `catalogItem`**: como F38, este spec **no siembra nada en el DDL** y no tiene una sola validación de doble salto contra un catálogo.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco de F38.** Tres cosas, y las tres viven en el bloque de jeringas:

**A — Es el primer bloque del repositorio que abre con la respuesta negativa.** El único comentario del DDL (`:1203`) dice *«If answer is "No", then the following fields are required»*: la bandera es `usedAutoDisableSyringes` y lo que abre el bloque es `'NO'`, no `'YES'`. La lógica del formulario es transparente —si no se usaron jeringas autodesactivables, hay que decir cuáles se usaron— pero invierte la polaridad de todos los bloques anteriores: en F34, F36 y F38 abría la afirmación. Un implementador que copie el patrón sin leer esta línea escribirá la condición al revés y la suite no se lo dirá salvo por un caso.

**B — Es la primera regla de «al menos uno» del repositorio.** Con el bloque abierto, al menos uno de los cuatro booleanos de tipo de jeringa debe resultar `true`. Hasta hoy «bloque abierto» significaba «permitido y opcional» en todas las entidades; aquí significa **exigible**, porque el comentario del DDL dice *required* y porque un bloque abierto y vacío no registra nada: declara que no se usaron autodesactivables y calla lo que sí se usó, que es justo el dato que el bloque existe para capturar.

**C — Es el primer bloque anidado del repositorio.** `usedOtherSyringes === true` abre `otherSyringesDescription`, **dentro** del bloque que `usedAutoDisableSyringes === 'NO'` ya abrió. La descripción tiene por tanto dos condiciones encadenadas y basta que falle una para que quede prohibida. §3.5 lo resuelve declarando el anidado como una segunda pasada sobre el estado resultante, no como una condición compuesta.

**Y una asimetría de tipos que el DDL impone y este spec respeta, igual que F38.** Los cuatro tipos de jeringa son `boolean` puro (`:1204-1207`); las otras doce columnas de respuesta son `answerOption`. Conviven dentro del **mismo** bloque: la bandera que lo abre es `answerOption` y lo que contiene son booleanos. El modelo calza con la tabla y **no traduce entre los dos tipos**.

**Es además la satélite más ancha especificada hasta hoy:** veintiséis columnas de datos, frente a las quince de F38. Ninguna es `NOT NULL`.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationAdministrationError`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29, F30, F32, F34, F36 y F38 mantuvieron.
- **Listado dual `002A` / `002B`**, heredado de F38: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve filas cuya investigación está activa; `002B` en `GET /admin` para ADMIN las devuelve todas.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear el segundo error de administración de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVADMER_001_INVESTIGATION_NOT_FOUND`; no tiene ya error de administración, sin filtrar por `deletedAt` → 409 `INVADMER_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la fila responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Alta vacía.** Las veintiséis columnas de datos son anulables y **ninguna es obligatoria**: `POST { investigationId }` devuelve **201** con las veintiséis en `null`. La fila se abre como borrador y se completa por `PUT`. Es el patrón de F13, F14, F29, F32, F34, F36 y F38.
- **`investigationId` inmutable en el `004`:** se ignora en silencio si llega, sin 400.
- **Cuatro columnas `boolean` y doce `answerOption`, sin traducción entre ellas.** `usedGlassSyringes`, `usedDisposableSyringes`, `usedRecycledDisposableSyringes` y `usedOtherSyringes` se exponen como booleanos de tres estados (`true` / `false` / `null`); las doce restantes se validan contra `ANSWER_OPTIONS`. El modelo respeta el DDL literalmente.
- **El bloque de jeringas, que abre con la respuesta negativa.** `usedAutoDisableSyringes` gobierna a los cuatro booleanos de tipo y a `otherSyringesDescription`:
  - **Solo `'NO'` abre el bloque.** `'YES'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null` lo cierran, los cinco por igual.
  - Con el bloque **abierto**, **al menos uno** de los cuatro booleanos debe resultar `true` → si no, **400** `INVADMER_<op>_SYRINGE_TYPE_REQUIRED`. Es la primera regla de mínimo del repositorio.
  - Con el bloque **cerrado**, los cinco campos están **prohibidos**, con la asimetría `001` / `004`: **400** en el alta; en el update, **forzados a `null` como derivados condicionales** si el cliente no los manda, **400** si los manda con valor. Mandarlos explícitamente en `null` **no** es error.
  - `syringesKeyFindings` **queda fuera del bloque**: es texto libre y está siempre abierto.
- **El bloque anidado de la descripción.** `usedOtherSyringes === true` abre `otherSyringesDescription`, dentro del bloque exterior ya abierto. Si el exterior está cerrado, o si el exterior está abierto pero `usedOtherSyringes` no resulta `true`, la descripción está prohibida con la misma asimetría `001` / `004` y el código `INVADMER_<op>_OTHER_DESCRIPTION_NOT_ALLOWED`. La descripción **nunca es exigible**: `usedOtherSyringes: true` sin descripción es un alta válida.
- **El grupo de reconstitución es de cinco columnas independientes.** `reconstitutionUsedSameSyringe`, `reconstitutionUsedSameSyringeDifferentVaccine`, `reconstitutionUsedDifferentSyringeSameVial`, `reconstitutionUsedDifferentSyringeDifferentVaccine` y `reconstitutionFollowedManufacturerRecommendation` **no** se excluyen entre sí y no se validan unas contra otras. Cada respuesta del formulario se guarda tal como llega.
- **Los seis pares `had*` / `*Notes` son doce columnas independientes.** Ninguna nota cuelga de su bandera: un `'NO'` acompañado del motivo, un `'UNKNOWN'` con la explicación de por qué no se sabe o un comentario suelto son registros válidos. **No hay aquí ningún bloque condicional.**
- **Ningún campo cifrado.** La tabla no contiene ningún nombre de persona ni dato identificativo. Las diez columnas de texto son texto libre plano.
- **Normalización al escribir:** `.trim()` sobre las diez columnas de texto —`otherSyringesDescription`, `syringesKeyFindings`, `reconstitutionKeyFindings`, los seis `*Notes` y `notes`—, **sin ningún tope de longitud**: las diez son `text` en el DDL y no tienen techo declarado. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre**, ya sobre `src/services/common/satelliteCascade.service.ts` **sin modificarlo**: `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica añadir invocaciones en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, **junto a las que F29, F30, F32, F34, F36, F37 y F38 ya dejaron puestas**.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto a los que las specs anteriores dejaron.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVADMER_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**, porque el control de `isActive` de `purgeEntityService` es inerte sobre una tabla que no tiene esa columna.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación. Orden `createdAt DESC`.
- Alta de la abreviatura **`INVADMER`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationAdministrationError.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F32** debe estar `Implementado`. No hay dependencia de modelo, pero sí de código: `satelliteCascade.service.ts` nace allí y este spec lo consume tal cual.

**Fuera de alcance (otros specs):**

- **Las dos satélites de `investigation` que siguen sin spec:** `investigationCovidHistory` (`:1014-1036`) e `investigationCommunity` (`:1238-1258`). Con este spec, `investigationAdministrationError` sale de esa lista.
- **Exigir la descripción cuando `usedOtherSyringes` es `true`.** El bloque anidado abre la columna, no la reclama: quien marca «otras» puede no saber aún cuáles. Convertirla en exigible es una segunda regla de mínimo y merece decidirse con el dato de uso en la mano.
- **Cualquier regla cruzada con `investigationColdChain`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `notificationVaccine` o `notificationDiluent`.** `hadContaminatedVaccine` y `hadAbnormalVaccineConditions` se solapan conceptualmente con los hallazgos de nevera de F38, y la reconstitución con el frasco multidosis de F36. Atarlas exige antes decidir cuál manda.
- **Exclusión mutua dentro del grupo de reconstitución.** Las cuatro primeras preguntas describen prácticas que en la práctica se excluyen, pero el formulario las hace por separado y el registro debe permitirse tal como llega. Introducir la exclusión exigiría además decidir la precedencia, como hizo F38 con los contenedores.
- **Derivar una conclusión «hubo error programático»** a partir de las dieciséis respuestas. Es un dato de clasificación, no de investigación, y cruza con `finalClassification`.
- **Filtrar, contar o agregar por cualquier campo de dominio** —tipo de jeringa, práctica de reconstitución, cualquiera de los seis errores—. Sería el primer filtro por dato de dominio del repositorio y abre la puerta a tableros. Los dos únicos filtros del listado son los de F29, F32, F34, F36 y F38.
- **Estructurar `otherSyringesDescription`** ni ninguno de los seis `*Notes` como catálogo. Son `text` libre en el DDL y así se quedan.
- **Imponer un tope de longitud** a las diez columnas de texto. El DDL no lo declara y este spec no lo inventa.
- **Búsqueda por texto** sobre ninguna de las diez columnas libres.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene error de administración.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión de F13, F29, F30, F32, F34, F36 y F38, heredada sin reabrirse.
- **Modificar `esaviapp.sql`.** Ni añadir `isActive`, ni un `CHECK` sobre el bloque de jeringas, ni un índice, ni meter `investigation` en `preventPhysicalDelete`, ni sembrar ningún catálogo. **Este spec no toca el DDL en ninguna línea** — es la segunda vez, tras F38.
- **Modificar `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.** Los cinco se consumen tal cual están.
- **Cambiar el comportamiento de F29, F30, F32, F34, F36, F37 ni F38.** Este spec solo añade invocaciones junto a las suyas; sus suites de contrato deben pasar sin tocar un solo caso.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2 y sigue mereciendo su propio spec.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationAdministrationError` — `esaviapp.sql:1200-1236`. **La tabla no se altera, y este spec no añade una sola línea al DDL.**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:1201`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationAdministrationError_investigation` → `investigation`, `ON DELETE CASCADE` (`:1235`) |
| `usedAutoDisableSyringes` | `answerOption` | sí | `:1202`. **Bandera del bloque de jeringas. Abre con `'NO'`** |
| `usedGlassSyringes` | `boolean` | sí | `:1204`. Bloque de jeringas |
| `usedDisposableSyringes` | `boolean` | sí | `:1205`. Bloque de jeringas |
| `usedRecycledDisposableSyringes` | `boolean` | sí | `:1206`. Bloque de jeringas |
| `usedOtherSyringes` | `boolean` | sí | `:1207`. Bloque de jeringas. **Y bandera del bloque anidado** |
| `otherSyringesDescription` | `text` | sí | `:1208`. Bloque de jeringas **y** bloque anidado. Texto libre |
| `syringesKeyFindings` | `text` | sí | `:1210`. **Fuera del bloque.** Texto libre |
| `reconstitutionUsedSameSyringe` | `answerOption` | sí | `:1211`. Independiente |
| `reconstitutionUsedSameSyringeDifferentVaccine` | `answerOption` | sí | `:1212`. Independiente |
| `reconstitutionUsedDifferentSyringeSameVial` | `answerOption` | sí | `:1213`. Independiente |
| `reconstitutionUsedDifferentSyringeDifferentVaccine` | `answerOption` | sí | `:1214`. Independiente |
| `reconstitutionFollowedManufacturerRecommendation` | `answerOption` | sí | `:1215`. Independiente |
| `reconstitutionKeyFindings` | `text` | sí | `:1216`. Texto libre |
| `hadPrescriptionError` | `answerOption` | sí | `:1217`. Independiente |
| `prescriptionErrorNotes` | `text` | sí | `:1218`. Independiente. **No cuelga de `:1217`** |
| `hadContaminatedVaccine` | `answerOption` | sí | `:1219`. Independiente |
| `contaminatedVaccineNotes` | `text` | sí | `:1220`. Independiente. **No cuelga de `:1219`** |
| `hadAbnormalVaccineConditions` | `answerOption` | sí | `:1221`. Independiente |
| `abnormalConditionsNotes` | `text` | sí | `:1222`. Independiente. **No cuelga de `:1221`** |
| `hadPreparationError` | `answerOption` | sí | `:1223`. Independiente |
| `preparationErrorNotes` | `text` | sí | `:1224`. Independiente. **No cuelga de `:1223`** |
| `hadHandlingError` | `answerOption` | sí | `:1225`. Independiente |
| `handlingErrorNotes` | `text` | sí | `:1226`. Independiente. **No cuelga de `:1225`** |
| `hadImproperAdministration` | `answerOption` | sí | `:1227`. Independiente |
| `improperAdministrationNotes` | `text` | sí | `:1228`. Independiente. **No cuelga de `:1227`** |
| `notes` | `text` | sí | `:1229`. Texto libre |

**Veintiséis columnas de datos, las veintiséis anulables.** Ninguna es `NOT NULL`, y de ahí sale directamente el alta vacía de §2. Es la satélite más ancha especificada hasta hoy: F38 tenía quince.

**Restricciones.** **Una sola clave foránea** —la del padre—, **ningún `CHECK`**, **ninguna `UNIQUE`** —la PK ya lo es— y **ningún índice declarado** más allá del de la clave primaria. **No hace falta añadir ninguno:** el `investigationId` por el que filtra el listado *es* la clave primaria, que ya está indexada.

**Cinco de las diez columnas de texto tienen `Notes` en el nombre y una sola de ellas es la nota general.** `notes` (`:1229`) son las observaciones de toda la fila; los seis `*Notes` de `:1218` a `:1228` son la nota de **su** error concreto. La distinción no está escrita en el DDL y el nombre de la última no la sugiere.

#### El único comentario del DDL, y qué dice exactamente

`:1203` — *«If answer is "No", then the following fields are required»* — y `:1209` — *«End above fields»*. Es la **única regla de negocio escrita en el esquema de esta tabla**, y delimita cinco columnas: `:1204` a `:1208`.

Tres lecturas que este spec fija y que el comentario no resuelve solo:

1. **La polaridad es la que dice.** Abre `'NO'`, no `'YES'`. Es el primer bloque del repositorio así, y §7 lo declara riesgo.
2. **«Required» se implementa como «al menos uno»**, no como «los cuatro presentes». La decisión y su alternativa descartada están en §6.
3. **El comentario abarca `otherSyringesDescription`** —está entre `:1203` y `:1209`—, así que la descripción pertenece al bloque exterior **además** de al anidado. El anidado no lo dice el DDL en ninguna parte: sale del formulario y queda escrito aquí por primera vez.

Todo lo demás de la tabla —los cinco de reconstitución, los seis pares y `notes`— **no está insinuado en el DDL** y este spec lo declara explícitamente independiente, que es una decisión y no una omisión.

**El ENUM `answerOption`** se declara en `esaviapp.sql:26` con cinco valores: `'YES'`, `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`. Ya vive en `src/constants/enums.constants.ts:8` como `ANSWER_OPTIONS`, con el tipo `AnswerOption` en `:10`. **No se añade ninguna constante nueva.** Doce columnas lo usan; las otras cuatro son `boolean` puro y **no se traducen a él**.

**Las columnas transversales, y la que falta.** Están `createdAt` (`:1230`), `updatedAt` (`:1231`), `deletedAt` (`:1232`), `sysDetails` (`:1233`) y `appDetails` (`:1234`). **Falta `isActive`**, igual que en las ocho tablas listadas en §1. Es la novena del repositorio así.

**Triggers.** Solo `TRG_investigationAdministrationError_setSysDetails`, del bucle genérico de `esaviapp.sql:1290-1305`. La tabla no figura en el bucle `preventPhysicalDelete`, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco figura en `setSortOrderByParent`: no tiene `sortOrder`.

**Hoja del grafo.** `grep 'REFERENCES "investigationAdministrationError"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationAdministrationError.model.ts`. Clase `InvestigationAdministrationError`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationAdministrationError'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14, F29, F30, F32, F34, F36 y F38: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- Los cuatro tipos de jeringa — `DataTypes.BOOLEAN`, `allowNull: true`. **`BOOLEAN` y no `ENUM`**: el modelo calza con la columna, y traducir aquí a `answerOption` sería inventar un tipo que la tabla no tiene.
- Las doce columnas de respuesta — `DataTypes.ENUM(...ANSWER_OPTIONS)`, `allowNull: true`, importando `ANSWER_OPTIONS` y el tipo `AnswerOption` de `src/constants/enums.constants.ts`. Es el patrón de `severeNotification.model.ts:51-67`.
- Las diez columnas de texto — `DataTypes.TEXT`, `allowNull: true`. **Ninguna lleva longitud**, porque ninguna es `varchar` en el DDL. Es la diferencia con F38, que capó `transportTypeThermo` a 250.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationAdministrationError.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationAdministrationError.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationAdministrationError, { as: 'administrationError', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `administrationError` no colisiona con `source` (F29), `autopsy` (F30), `teamMembers` (F31), `medicalHistory` (F32), `clinicalEvaluation` (F34), `vaccinationContext` (F36), `vaccinesAdministered` (F37) ni `coldChain` (F38).

**Dos asociaciones y ninguna más.** No hay ninguna FK a `catalogItem`, así que no hay ni un `include` de catálogo en todo el spec.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `administrationError` **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationAdministrationError.types.ts`, junto a los del resto del dominio, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationAdministrationErrorInput {
    investigationId: string;
    usedAutoDisableSyringes?: AnswerOption | null;
    usedGlassSyringes?: boolean | null;
    usedDisposableSyringes?: boolean | null;
    usedRecycledDisposableSyringes?: boolean | null;
    usedOtherSyringes?: boolean | null;
    otherSyringesDescription?: string | null;
    syringesKeyFindings?: string | null;
    reconstitutionUsedSameSyringe?: AnswerOption | null;
    reconstitutionUsedSameSyringeDifferentVaccine?: AnswerOption | null;
    reconstitutionUsedDifferentSyringeSameVial?: AnswerOption | null;
    reconstitutionUsedDifferentSyringeDifferentVaccine?: AnswerOption | null;
    reconstitutionFollowedManufacturerRecommendation?: AnswerOption | null;
    reconstitutionKeyFindings?: string | null;
    hadPrescriptionError?: AnswerOption | null;
    prescriptionErrorNotes?: string | null;
    hadContaminatedVaccine?: AnswerOption | null;
    contaminatedVaccineNotes?: string | null;
    hadAbnormalVaccineConditions?: AnswerOption | null;
    abnormalConditionsNotes?: string | null;
    hadPreparationError?: AnswerOption | null;
    preparationErrorNotes?: string | null;
    hadHandlingError?: AnswerOption | null;
    handlingErrorNotes?: string | null;
    hadImproperAdministration?: AnswerOption | null;
    improperAdministrationNotes?: string | null;
    notes?: string | null;
}
```

**`investigationId` es el único campo obligatorio del tipo.** Los veintiséis restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo.

**Los cuatro tipos de jeringa son `boolean | null` y no `AnswerOption | null`**, mientras que la bandera que los gobierna sí es `AnswerOption | null`. Es la asimetría del DDL, trasladada al contrato sin suavizar.

`AnswerOption` se importa de `src/constants/enums.constants.ts`; **no se declara ningún tipo nuevo de enumerado**.

El update usa `Partial<CreateInvestigationAdministrationErrorInput>`. **No se declara `UpdateInvestigationAdministrationErrorInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Los cuatro tipos de jeringa se declaran como una constante local del servicio, para que la regla de mínimo se escriba una sola vez y no como cuatro comparaciones sueltas:

```ts
const SYRINGE_TYPE_FIELDS = [
    'usedGlassSyringes',
    'usedDisposableSyringes',
    'usedRecycledDisposableSyringes',
    'usedOtherSyringes',
] as const;
```

**El orden del array no significa nada aquí** —a diferencia de F38, donde *era* la precedencia—: no hay precedencia que declarar, solo una comprobación de «alguno resulta `true`». Y el bloque completo, para el forzado a `null`, es ese array más `otherSyringesDescription`. No va a `src/constants/investigation.constants.ts` porque solo lo consume este servicio, igual que F27, F32, F34, F36 y F38 mantuvieron locales sus listas.

### 3.4 Superficie HTTP

```
POST   /api/investigation-administration-errors                ESAVI-INVADMER-001   USER        (nuevo)
GET    /api/investigation-administration-errors                ESAVI-INVADMER-002A  USER        (nuevo)
GET    /api/investigation-administration-errors/admin          ESAVI-INVADMER-002B  ADMIN       (nuevo)
DELETE /api/investigation-administration-errors/purge/:id      ESAVI-INVADMER-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-administration-errors/case/:caseId   ESAVI-INVADMER-006   USER        (nuevo)
GET    /api/investigation-administration-errors/:id            ESAVI-INVADMER-003   USER        (nuevo)
PUT    /api/investigation-administration-errors/:id            ESAVI-INVADMER-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationAdministrationError.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14 y F28 a F38, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar un error de administración es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationAdministrationError` · `006` · obtener el error de administración de un caso — la cadena `caso → investigación → error` es uno a uno en los dos saltos**.

**La abreviatura es `INVADMER`.** Ocho letras —el techo de la norma—, no colisiona con las treinta y ocho registradas y `grep "ESAVI-INVADMER-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-INVTEAM-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-`, `ESAVI-INVCLIEV-`, `ESAVI-INVVACTX-`, `ESAVI-INVVACAD-`, `ESAVI-INVCOLD-` ni `ESAVI-EVALINST-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

Las dos reglas de esta entidad miran el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resulting(campo) = data[campo] !== undefined ? (data[campo] ?? null) : stored[campo]
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**A diferencia de F38, aquí no hace falta saber si la clave viajó.** Aquella entidad necesitaba `travels()` para separar un conflicto de un relevo; ésta no tiene ninguna regla de precedencia entre campos y le basta el estado resultante. La única distinción por presencia que hay en este spec es la asimetría `001`/`004` de los campos prohibidos, que es la de F34 y no una regla nueva.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| Los cuatro tipos de jeringa booleanos, admitiendo `null` | validador | 400 `common.validationError` |
| Las doce `answerOption` dentro de `ANSWER_OPTIONS`, admitiendo `null` | validador | 400 `common.validationError` |
| Las diez columnas de texto como cadena, **sin tope de longitud** | validador | 400 `common.validationError` |
| Bloque de jeringas abierto y ningún tipo resultante en `true` | **servicio** | 400 `INVADMER_<op>_SYRINGE_TYPE_REQUIRED` |
| Algún campo del bloque con valor y el bloque cerrado | **servicio** | 400 `INVADMER_<op>_SYRINGE_DETAIL_NOT_ALLOWED` |
| `otherSyringesDescription` con valor y el anidado cerrado | **servicio** | 400 `INVADMER_<op>_OTHER_DESCRIPTION_NOT_ALLOWED` |

**No hay ninguna validación de FK contra catálogo**, porque no hay ninguna FK a catálogo. Como F38, el servicio no consulta otra tabla más que `investigation`.

**No hay ninguna validación de rango numérico**, porque no hay una sola columna numérica.

#### El bloque de jeringas — el primero que abre con la negación

**Solo `usedAutoDisableSyringes` resultante `'NO'` abre el bloque.** `'YES'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null` lo cierran, los cinco por igual. La lógica del formulario es directa: si sí se usaron autodesactivables, no hay nada más que preguntar; si no se sabe o no aplica, tampoco hay tipo que declarar.

**Con el bloque abierto, el mínimo es exigible.** Al menos uno de los cuatro campos de `SYRINGE_TYPE_FIELDS` debe resultar **`true`**. Si los cuatro resultan `false` o `null` —en cualquier combinación— es **400** `INVADMER_<op>_SYRINGE_TYPE_REQUIRED`. Tres consecuencias, y las tres son norma:

- **`POST { investigationId, usedAutoDisableSyringes: 'NO' }` a secas es 400.** No se puede abrir el bloque y dejarlo vacío. El alta vacía de §2 sigue funcionando porque `null` cierra el bloque.
- **La regla se evalúa sobre el estado resultante, no sobre el body.** Un `PUT { notes: 'x' }` sobre una fila con el bloque abierto y ya poblado **no** falla: los tipos guardados cuentan.
- **Un `PUT` que apaga el último `true` es 400.** `PUT { usedGlassSyringes: false }` sobre una fila donde el vidrio era el único `true` deja el bloque abierto sin ningún tipo declarado. Para cerrarlo hay que mandar `usedAutoDisableSyringes` a otro valor **en la misma petición**; entonces el bloque queda cerrado, la regla de mínimo no aplica y los cinco campos se fuerzan a `null`.

**Con el bloque cerrado**, los cinco campos —los cuatro booleanos y `otherSyringesDescription`— están **prohibidos**, con la asimetría de F34, F36 y F38:

- **`001` — es 400.** Mandar cualquiera de ellos con valor —`true` **o** `false`, o una cadena— junto a un `usedAutoDisableSyringes` que no es `'NO'` es `INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente los manda.** Los que **no viajan** se **fuerzan a `null`**: cerrar el bloque limpia los cinco campos sin pedir permiso ni devolver error. Los que **viajan con valor** producen 400 `INVADMER_004_SYRINGE_DETAIL_NOT_ALLOWED`. Mandarlos en `null` **no** es error: es el mismo destino al que el forzado llega solo.

**`false` cuenta como valor y no como ausencia.** Es exactamente el caso que §11 advierte: un `if( data.usedGlassSyringes )` trataría el `false` como si no hubiera llegado, y este campo lo usa para decir «se usaron jeringas, pero no de vidrio», que es una respuesta legítima del formulario.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** los cinco campos entran en `candidates` **siempre** que el bloque esté cerrado, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difieren. Si la fila ya los tenía en `null`, el diff no encuentra nada y **no se escribe**: cerrar un bloque ya cerrado no crece `appDetails`.

**`syringesKeyFindings` está fuera del bloque** y no se ve afectado por nada de lo anterior. Se guarda aunque no se haya declarado ningún tipo de jeringa.

#### El bloque anidado — `otherSyringesDescription`

`otherSyringesDescription` tiene **dos** condiciones encadenadas, y se evalúan como **dos pasadas sucesivas sobre el estado resultante**, no como una condición compuesta:

1. **Pasada exterior.** Si el bloque de jeringas está cerrado, la descripción cae con los otros cuatro: 400 `SYRINGE_DETAIL_NOT_ALLOWED` en el `001`, forzada a `null` en el `004`. La segunda pasada no llega a ejecutarse.
2. **Pasada anidada.** Con el bloque exterior abierto, la descripción se permite **solo si `usedOtherSyringes` resulta `true`**. Con `false` o `null` está prohibida: 400 `INVADMER_001_OTHER_DESCRIPTION_NOT_ALLOWED` en el alta, forzada a `null` en el update si no viaja y 400 `INVADMER_004_OTHER_DESCRIPTION_NOT_ALLOWED` si viaja con valor.

**Separar las dos pasadas no es un detalle de implementación: cambia el código de error que ve el cliente.** Una condición compuesta devolvería el mismo 400 para «no declaraste que usaste otras jeringas» y para «ni siquiera abriste el bloque», que son dos correcciones distintas del formulario.

**La descripción nunca es exigible.** `usedOtherSyringes: true` sin descripción es un alta válida y un update válido: el bloque anidado abre la columna, no la reclama. Es lo que §2 deja fuera de alcance.

#### Los tres grupos sin ninguna regla

**Reconstitución.** Las cinco columnas de `:1211` a `:1215` son independientes entre sí y de todo lo demás. **No se excluyen mutuamente**, aunque las cuatro primeras describan prácticas que en la práctica lo son: el formulario las pregunta por separado y el registro debe permitirse tal como llega. `reconstitutionKeyFindings` es texto libre siempre abierto.

**Los seis pares `had*` / `*Notes`.** Ninguna nota cuelga de su bandera. Un `hadPrescriptionError: 'NO'` con `prescriptionErrorNotes: 'la receta venía firmada y rotulada'` es un registro válido, igual que un `'UNKNOWN'` con el motivo de la duda o una nota sin bandera. Las doce columnas se guardan tal como llegan.

**`notes`.** Observaciones de toda la fila, siempre abierta.

**Que estos tres grupos no tengan reglas es una decisión declarada, no un olvido**, y §6 la razona. Un implementador que «complete» el patrón colgando las notas de sus banderas rompe seis criterios de aceptación de §5.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Un error de administración cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVADMER-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVADMER_001_INVESTIGATION_NOT_FOUND`.
2. Esa investigación **no tiene ya error de administración**, buscando **sin filtrar por `deletedAt`** → 409 `INVADMER_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fila sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. El bloque de jeringas, en su variante estricta: prohibición si está cerrado, regla de mínimo si está abierto.
4. El bloque anidado de `otherSyringesDescription`, en segunda pasada.
5. Normaliza: `.trim()` sobre las diez columnas de texto.
6. Inserta con la entrada de auditoría `method: 'ESAVI-INVADMER-001'`.

**El alta mínima es `{ investigationId }`** y devuelve 201 con las veintiséis columnas de datos en `null`.

**`ESAVI-INVADMER-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**`ESAVI-INVADMER-002B` — listar, admin.** Idéntica, con el include del padre en `where: {}`: devuelve también los errores de administración de investigaciones inactivas. Los mismos dos filtros y el mismo orden.

**`ESAVI-INVADMER-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVADMER_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVADMER-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVADMER_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVADMER_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene error de administración → 404 `INVADMER_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVADMER-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVADMER_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Un error de administración no se traslada entre investigaciones.
3. Cálculo del estado resultante, el bloque de jeringas y su anidado. **Antes del diff y con independencia de él.**
4. `stored` sale de `administrationError.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `usedAutoDisableSyringes` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Es la bandera: nunca se fuerza** |
| `usedGlassSyringes` | bloque **abierto**: `data.x !== undefined ? (data.x ?? null) : undefined` · bloque **cerrado**: **`null` siempre** | derivado condicional. `false` es valor, nunca ausencia |
| `usedDisposableSyringes` | ídem anterior | derivado condicional |
| `usedRecycledDisposableSyringes` | ídem anterior | derivado condicional |
| `usedOtherSyringes` | ídem anterior | derivado condicional. **Y bandera del anidado** |
| `otherSyringesDescription` | bloque exterior **y** anidado **abiertos**: `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` · cualquiera de los dos **cerrado**: **`null` siempre** | derivado condicional de doble condición, `.trim()` antes de comparar |
| `syringesKeyFindings` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Fuera del bloque: nunca forzado ni prohibido** |
| `reconstitutionUsedSameSyringe` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `reconstitutionUsedSameSyringeDifferentVaccine` | ídem | anulable |
| `reconstitutionUsedDifferentSyringeSameVial` | ídem | anulable |
| `reconstitutionUsedDifferentSyringeDifferentVaccine` | ídem | anulable |
| `reconstitutionFollowedManufacturerRecommendation` | ídem | anulable |
| `reconstitutionKeyFindings` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()` |
| `hadPrescriptionError` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `prescriptionErrorNotes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `hadContaminatedVaccine` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `contaminatedVaccineNotes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `hadAbnormalVaccineConditions` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `abnormalConditionsNotes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `hadPreparationError` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `preparationErrorNotes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `hadHandlingError` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `handlingErrorNotes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `hadImproperAdministration` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `improperAdministrationNotes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `notes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()` |

**Cinco campos derivados condicionales y veintiuno anulables directos.** Ningún campo cifrado y ningún derivado incondicional: no hay nada que esta entidad recalcule en cada `PUT`.

**`ESAVI-INVADMER-005C` — borrado físico.** SUPERADMIN. `assertRowIsSealed` sobre `deletedAt` → 409 `INVADMER_005C_NOT_DELETED` si la fila sigue viva. Después `purgeEntityService`, cuyo control de `isActive` es inerte aquí. Volcado al log en `warn` antes del `destroy`. **No toca `appDetails`**: la fila desaparece en la misma transacción. Responde 200 con `{ ok, message }` **sin `data`**.

#### Arrastre del `deletedAt` — tres invocaciones, ningún archivo común modificado

Se cuelga de `satelliteCascade.service.ts` (F32) **sin tocarlo**, junto a las invocaciones que F29, F30, F32, F34, F36, F37 y F38 ya dejaron:

| Origen | Efecto sobre `investigationAdministrationError` |
|---|---|
| `ESAVI-INVESTGN-005A` | sella `deletedAt` |
| `ESAVI-CASE-005A` | sella `deletedAt` |
| `ESAVI-INVESTGN-005B` | limpia `deletedAt` |
| `ESAVI-INVESTGN-005C` | la fila se destruye por `ON DELETE CASCADE`; volcado al log en `warn` antes del `destroy` del padre |

**El arrastre no es un update diferencial y no pasa por `buildDifferentialUpdate`.** Es una escritura con intención propia: registra que el padre fue retirado, y lo hace aunque ningún campo de datos de esta fila cambie. Es la misma declaración que hicieron F29, F30, F32, F34, F36, F37 y F38, y se repite aquí porque el silencio sería indistinguible del olvido.

### 3.6 Claves i18n nuevas

En `src/data/i18n/es.json`, `en.json` y `nl.json`, bajo `investigationAdministrationError`:

| Clave | Uso |
|---|---|
| `investigationAdministrationError.createdSuccess` / `createdFailed` | `001` |
| `investigationAdministrationError.getSuccess` / `getFailed` | `003` y `006` |
| `investigationAdministrationError.getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `investigationAdministrationError.updatedSuccess` / `updatedFailed` | `004` |
| `investigationAdministrationError.purgedSuccess` / `purgedFailed` | `005C` |
| `investigationAdministrationError.notFound` | 404 en `003`, `004`, `005C` y `006` |
| `investigationAdministrationError.investigationNotFound` | 404 de la investigación en `001` y `006` |
| `investigationAdministrationError.caseNotFound` | 404 del caso en `006` |
| `investigationAdministrationError.alreadyExists` | 409 en `001`, con `{{investigationId}}` |
| `investigationAdministrationError.notDeleted` | 409 en `005C` sobre una fila no sellada |
| `investigationAdministrationError.syringeTypeRequired` | 400 con el bloque abierto y ningún tipo en `true` |
| `investigationAdministrationError.syringeDetailNotAllowed` | 400 con el bloque de jeringas cerrado |
| `investigationAdministrationError.otherDescriptionNotAllowed` | 400 con el bloque anidado cerrado |
| `investigationAdministrationError.idRequired` | parámetro ausente |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`003`, `006`, `001` y `004` devuelven el objeto completo:

```
{ ok, message, data: {
    investigationId,
    usedAutoDisableSyringes, usedGlassSyringes, usedDisposableSyringes,
    usedRecycledDisposableSyringes, usedOtherSyringes, otherSyringesDescription,
    syringesKeyFindings,
    reconstitutionUsedSameSyringe, reconstitutionUsedSameSyringeDifferentVaccine,
    reconstitutionUsedDifferentSyringeSameVial,
    reconstitutionUsedDifferentSyringeDifferentVaccine,
    reconstitutionFollowedManufacturerRecommendation, reconstitutionKeyFindings,
    hadPrescriptionError, prescriptionErrorNotes,
    hadContaminatedVaccine, contaminatedVaccineNotes,
    hadAbnormalVaccineConditions, abnormalConditionsNotes,
    hadPreparationError, preparationErrorNotes,
    hadHandlingError, handlingErrorNotes,
    hadImproperAdministration, improperAdministrationNotes,
    notes,
    createdAt, updatedAt, deletedAt, appDetails,
    investigation: { investigationId, caseId, isActive }
} }
```

**El include de `investigation` viaja acotado a tres campos.** Es lo que el cliente necesita para saber de qué caso cuelga la fila y si su padre está vivo; devolver la investigación entera duplicaría la carga útil de `ESAVI-INVESTGN-003`.

**No hay ningún include de catálogo.** Las dieciséis columnas de respuesta son valores literales —booleanos y cadenas del ENUM— y no resuelven contra nada.

`002A` y `002B` devuelven `{ count, rows }` de `findAndCountAll`, con cada fila en la misma forma. **Son filas anchas: veintiséis columnas de datos por elemento**, y por eso la paginación por defecto no se relaja aquí.

`005C` responde **solo** `{ ok, message }`, sin `data`, según §10 de las convenciones.

**`sysDetails` no se expone en ninguna operación.** `isActive` no aparece porque la columna no existe.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registro de la abreviatura y de la operación no canónica.** Alta de `investigationAdministrationError` → `INVADMER` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y de la fila `investigationAdministrationError` · `006` en la tabla de operaciones no canónicas.
   *Verificación:* `grep -n "INVADMER" references/CONVENTIONS.md` devuelve las dos filas; la abreviatura no aparece dos veces en la tabla.

2. **Modelo y asociaciones.** `src/models/investigationAdministrationError.model.ts` con las veintiséis columnas de datos, `timestamps: false`, `freezeTableName: true`, PK **sin** `defaultValue` y **sin** atributo `isActive`. Los cuatro tipos de jeringa como `BOOLEAN`, las doce respuestas como `ENUM(...ANSWER_OPTIONS)`, las diez columnas de texto como `TEXT` sin longitud. `src/models/associations/investigationAdministrationError.associations.ts` con el `belongsTo` y el `hasOne` de alias `administrationError`. Alta en `src/models/index.ts` y en `initModels()`.
   *Verificación:* `npm run build` compila; un `findOne` en consola sobre una fila existente devuelve las veintiséis columnas y `investigation` se resuelve por el include.

3. **Tipos.** `src/types/investigation/investigationAdministrationError.types.ts` con `CreateInvestigationAdministrationErrorInput`, los cuatro tipos de jeringa como `boolean | null` y las doce respuestas como `AnswerOption | null`. Alta en el barrel del dominio.
   *Verificación:* `npm run build` compila; `grep -rn "UpdateInvestigationAdministrationErrorInput" src/` no devuelve resultados.

4. **Claves i18n.** Las catorce claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

5. **Validadores.** `src/validators/investigationAdministrationError.validator.ts` con los tres obligatorios —`investigationAdministrationErrorIdValidator`, `createInvestigationAdministrationErrorValidator`, `updateInvestigationAdministrationErrorValidator`— más el de listado. Los cuatro booleanos con `.isBoolean()` admitiendo `null`, las doce respuestas con `.isIn(ANSWER_OPTIONS)`, las diez columnas de texto con `.isString()` y **sin `.isLength()`**. Alta en `src/validators/index.ts`.
   *Verificación:* un `POST` con `hadHandlingError: 'MAYBE'` responde 400 `common.validationError`; uno con `usedGlassSyringes: 'yes'` también; uno con `notes` de 5000 caracteres responde **201**, no 400.

6. **`ESAVI-INVADMER-001` — crear.** Servicio, controlador y ruta, con las dos guardas del alta, el bloque de jeringas en variante estricta —prohibición y regla de mínimo—, el bloque anidado en segunda pasada, el `.trim()` de las diez columnas de texto y la entrada de auditoría.
   *Verificación:* `POST { investigationId }` de una investigación activa devuelve **201** con las veintiséis en `null`; repetirlo devuelve **409**; con una investigación inactiva devuelve **404**; `POST { investigationId, usedAutoDisableSyringes: 'NO' }` a secas devuelve **400** `SYRINGE_TYPE_REQUIRED`; con `usedGlassSyringes: false` y sin bandera devuelve **400** `SYRINGE_DETAIL_NOT_ALLOWED`; con el bloque abierto, `usedDisposableSyringes: true` y `otherSyringesDescription` devuelve **400** `OTHER_DESCRIPTION_NOT_ALLOWED`.

7. **`ESAVI-INVADMER-002A` y `002B` — listados.** Los dos servicios, el controlador único que bifurca por `canViewInactive`, las dos rutas con `/admin` declarada antes de `/:id`, los dos filtros y el orden `createdAt DESC`.
   *Verificación:* una fila cuya investigación está inactiva no aparece en `GET /` y sí en `GET /admin`; `GET /?caseId=<uuid inexistente>` devuelve 200 con `{ count: 0, rows: [] }`.

8. **`ESAVI-INVADMER-003` — obtener por ID.** Con la visibilidad heredada y el include acotado a tres campos de `investigation`.
   *Verificación:* un `investigationId` inexistente devuelve 404; una fila de investigación inactiva devuelve 404 para USER y ADMIN y 200 para SUPERADMIN.

9. **`ESAVI-INVADMER-006` — obtener por caso.** Ruta `/case/:caseId` declarada antes de `/:id`, con los tres 404 distintos.
   *Verificación:* los tres códigos —`CASE_NOT_FOUND`, `INVESTIGATION_NOT_FOUND`, `NOT_FOUND`— se obtienen cada uno con su escenario; la respuesta es el objeto y no `{ count, rows }`.

10. **`ESAVI-INVADMER-004` — actualizar.** El bloque de jeringas y su anidado sobre el estado resultante, **antes del diff**; `buildDifferentialUpdate` con la tabla de `candidates` de §3.5; `investigationId` ignorado en silencio; `updatedAt` escrito por la aplicación.
    *Verificación:* reenviar íntegra la respuesta del `GET` responde 200 sin escribir nada; cambiar solo `notes` añade **una** entrada a `appDetails`; un `PUT { notes: 'x' }` sobre una fila con el bloque abierto y poblado responde **200** y no dispara la regla de mínimo; un `PUT` que apaga el último `true` responde **400**; cerrar la bandera en el mismo `PUT` deja los cinco campos del bloque en `null` sin error.

11. **`ESAVI-INVADMER-005C` — borrado físico.** Ruta `/purge/:id` declarada antes de `/:id`, `assertRowIsSealed`, `purgeEntityService`, volcado al log en `warn`.
    *Verificación:* purgar una fila sin `deletedAt` devuelve **409**; con `deletedAt` sellado devuelve **200** sin `data`, y `src/logs/esaviLog.log` contiene la línea `warn` con `ESAVI-INVADMER-005C` y el volcado de la fila.

12. **Arrastre del `deletedAt`.** Tres invocaciones de `satelliteCascade.service.ts` —dos de sellado y una de limpieza— en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, junto a las existentes. Volcado al log de la fila arrastrada en `ESAVI-INVESTGN-005C`.
    *Verificación:* `DELETE /api/investigations/:id` sella el `deletedAt` del error de administración; `PATCH /api/investigations/activate/:id` lo limpia; `DELETE /api/esavi-cases/:id` lo sella también. Las suites de F29, F30, F32, F34, F36, F37 y F38 siguen pasando sin tocar un caso.

13. **Alta en `ROUTE_RULES`.** Las siete rutas de §3.4 en `tests/auth/roles.test.ts`, con su rol mínimo y su código de operación.
    *Verificación:* `npm test -- roles` sale en 0 y falla si se comenta cualquiera de las siete filas.

14. **Suite de contrato.** `tests/contract/investigationAdministrationError.test.ts` con el recorrido completo, más los casos propios: alta vacía, duplicado, **la polaridad invertida del bloque**, la regla de mínimo en `001` y `004`, la asimetría de la prohibición, las **dos pasadas** del anidado con sus dos códigos distintos, la independencia de los tres grupos sin reglas, y los cinco criterios de update diferencial de §5.
    *Verificación:* `npm test` sale en 0.

15. **Ampliación de las suites del padre.** `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.
    *Verificación:* `npm run check` sale en 0.

**Dos casos de la suite merecen mención porque no salen del recorrido normal.** El primero es la **polaridad**: hace falta un caso que mande `usedAutoDisableSyringes: 'YES'` con un tipo de jeringa y espere **400**, porque una implementación con la condición invertida pasa todos los demás casos del bloque. El segundo es la **independencia de las notas**: seis casos que guardan cada `*Notes` con su bandera en `'NO'` y esperan **201**, porque son la única red que impide que un cambio futuro las cuelgue de sus banderas «completando» el patrón.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación —ruta, controlador, servicio, `AppError` y `appDetails.method`— coinciden en las siete operaciones. En `005C` son **cuatro**: no hay `appDetails.method` porque la fila se destruye.
- [ ] `grep -rn "ESAVI-INVADMER-002[^AB]" src/` no devuelve resultados.
- [ ] `grep -rn "ESAVI-INVADMER-005[AB]" src/` no devuelve resultados: esta entidad no tiene activación ni borrado lógico propio.
- [ ] `grep -rn "isActive" src/models/investigationAdministrationError.model.ts src/services/investigationAdministrationError.service.ts` solo devuelve las líneas del `where` del include de `investigation`.
- [ ] `references/CONVENTIONS.md` §6 lista `INVADMER` en la tabla de abreviaturas y la operación `006` en la de no canónicas.
- [ ] `git diff --stat esaviapp.sql` está vacío: **este spec no toca el DDL en ninguna línea**.

**Alta y unicidad**

- [ ] `POST { investigationId }` de una investigación activa devuelve **201** con las veintiséis columnas de datos en `null`.
- [ ] Repetir ese `POST` devuelve **409** `INVADMER_001_ALREADY_EXISTS`, y sigue devolviéndolo cuando la fila existente tiene `deletedAt` sellado.
- [ ] `POST` sobre una investigación inactiva o inexistente devuelve **404** `INVADMER_001_INVESTIGATION_NOT_FOUND`.

**Polaridad del bloque de jeringas**

- [ ] `POST { usedAutoDisableSyringes: 'YES', usedGlassSyringes: true }` devuelve **400** `INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED`: **`'YES'` cierra el bloque**. Una implementación con la condición invertida falla aquí y solo aquí.
- [ ] Lo mismo con `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y sin la bandera: los cinco estados cierran por igual.
- [ ] `POST { usedAutoDisableSyringes: 'NO', usedGlassSyringes: true }` devuelve **201**.

**Regla de mínimo**

- [ ] `POST { investigationId, usedAutoDisableSyringes: 'NO' }` a secas devuelve **400** `INVADMER_001_SYRINGE_TYPE_REQUIRED`.
- [ ] `POST` con la bandera en `'NO'` y los cuatro tipos en `false` devuelve **400** con el mismo código: **`false` no cuenta como declaración**.
- [ ] `PUT { notes: 'x' }` sobre una fila con el bloque abierto y algún tipo en `true` devuelve **200**: la regla mira el estado resultante, no el body.
- [ ] `PUT { usedGlassSyringes: false }` sobre una fila donde el vidrio era el único `true` devuelve **400** `INVADMER_004_SYRINGE_TYPE_REQUIRED`.
- [ ] Ese mismo `PUT` acompañado de `usedAutoDisableSyringes: 'YES'` devuelve **200** y deja los cinco campos del bloque en `null`.

**Prohibición y asimetría `001` / `004`**

- [ ] `POST` con el bloque cerrado y cualquiera de los cinco campos con valor —`true`, `false` o cadena— devuelve **400** `INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED`.
- [ ] `PUT { usedAutoDisableSyringes: 'YES' }` sobre una fila con el bloque abierto y poblado devuelve **200** y deja los cinco campos en `null`, sin error.
- [ ] `PUT { usedAutoDisableSyringes: 'YES', usedGlassSyringes: true }` devuelve **400** `INVADMER_004_SYRINGE_DETAIL_NOT_ALLOWED`.
- [ ] `PUT { usedAutoDisableSyringes: 'YES', usedGlassSyringes: null }` devuelve **200**: mandarlo en `null` no es error.

**Bloque anidado de la descripción**

- [ ] Con el bloque exterior **abierto** y `usedOtherSyringes: true`, `otherSyringesDescription` se guarda: **201**.
- [ ] Con el exterior **abierto** y `usedOtherSyringes` en `false` o `null`, mandar la descripción devuelve **400** `INVADMER_001_OTHER_DESCRIPTION_NOT_ALLOWED`.
- [ ] Con el exterior **cerrado**, mandar la descripción devuelve **400** `INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED` —**no** el del anidado—: las dos pasadas devuelven códigos distintos y el orden importa.
- [ ] `POST` con `usedAutoDisableSyringes: 'NO'`, `usedOtherSyringes: true` y **sin** descripción devuelve **201**: la descripción nunca es exigible.
- [ ] `PUT { usedOtherSyringes: false }` sobre una fila con descripción guardada la deja en `null` sin error, siempre que quede otro tipo en `true`.

**Los tres grupos sin reglas**

- [ ] Los seis `*Notes` se guardan con su bandera en `'NO'`: seis casos, seis **201**. Colgar cualquiera de ellos de su bandera rompe uno.
- [ ] Un `*Notes` se guarda con su bandera en `null`.
- [ ] Las cinco columnas de reconstitución se guardan **todas en `'YES'` a la vez**: no hay exclusión mutua entre ellas.
- [ ] `syringesKeyFindings` se guarda con el bloque de jeringas cerrado: está fuera del bloque.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationAdministrationError.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada. *En esta entidad el segundo caso no aplica —no hay `code` ni ninguna `UNIQUE`—; el primero se verifica con un `PUT` sobre una fila cuya investigación está inactiva, que responde **404** para USER y ADMIN.*
- [ ] Un `PUT` que cierra un bloque ya cerrado —`usedAutoDisableSyringes: 'YES'` sobre una fila con los cinco campos ya en `null`— **no escribe nada**: el forzado a `null` pasa por el diff como cualquier otro candidato.
- [ ] Un `PUT` que reenvía `usedGlassSyringes: false` sobre una fila que ya lo tenía en `false` no escribe nada: **`false` se compara como valor**, no se descarta como ausencia.
- [ ] Un `PUT` que solo cambia el espaciado de un `*Notes` —`' texto '` sobre `'texto'`— **no escribe nada**: el `.trim()` se aplica antes de comparar.
- [ ] `PUT { investigationId: '<otro uuid>' }` devuelve **200** sin escribir nada y sin 400: el campo se ignora en silencio.

**Visibilidad y lecturas**

- [ ] Una fila cuya investigación está inactiva devuelve **404** en `003`, `004` y `006` para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] `GET /` no la devuelve; `GET /admin` sí.
- [ ] Los filtros `investigationId` y `caseId` son acumulativos y por igualdad; con un UUID inexistente devuelven **200** con `{ count: 0, rows: [] }`.
- [ ] `006` devuelve el objeto, no `{ count, rows }`, y distingue los tres 404 con códigos distintos.
- [ ] Las cuatro operaciones que devuelven el objeto exponen las veintiséis columnas de datos más `createdAt`, `updatedAt`, `deletedAt`, `appDetails` y el `investigation` acotado a tres campos, y **no exponen `sysDetails`**.

**Borrado físico y arrastre**

- [ ] `DELETE /purge/:id` sobre una fila sin `deletedAt` devuelve **409** `INVADMER_005C_NOT_DELETED`.
- [ ] `DELETE /purge/:id` sobre una fila sellada devuelve **200** con `{ ok, message }` y **sin `data`**, y deja en `src/logs/esaviLog.log` una línea `warn` con el código de operación y el volcado de la fila.
- [ ] `ESAVI-INVESTGN-005A` y `ESAVI-CASE-005A` sellan el `deletedAt` del error de administración; `ESAVI-INVESTGN-005B` lo limpia.
- [ ] `ESAVI-INVESTGN-005C` destruye la fila por cascada y deja su volcado en el log antes del `destroy` del padre.
- [ ] Las suites de contrato de F29, F30, F32, F34, F36, F37 y F38 pasan sin modificar un solo caso.

**Cierre**

- [ ] Las catorce claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] Las siete rutas están en `ROUTE_RULES` de `tests/auth/roles.test.ts`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la forma de la entidad**

- **Sí:** calcar la forma de F38 —PK que es FK, sin `isActive`, listado dual, `006` por caso, `005C` con `assertRowIsSealed`, arrastre por los tres caminos—. Es la novena satélite de `investigation` y la octava con esta forma exacta; inventar una variante aquí solo añadiría un caso especial que el cliente tendría que aprender.
- **No:** añadir `isActive` a la tabla. Sería modificar el DDL para darle a un satélite un estado propio que su padre ya define. Es la decisión de F13 y F14, heredada sin reabrirse.
- **No:** `005A` ni `005B`. Sin `isActive` no hay estado que activar, y fabricarlo sobre `deletedAt` daría dos mecanismos de retirada para la misma fila.
- **No:** partir la entidad en dos specs por sus cuatro grupos —jeringas, reconstitución, errores concretos—. Son veintiséis columnas de **una sola tabla** con una sola PK; separarlas exigiría inventar tablas que el DDL no tiene. Lo ancho de la fila no es motivo para partir el spec: solo un grupo tiene reglas.

**Sobre la polaridad del bloque de jeringas**

- **Sí:** que abra con `'NO'`. Es lo que dice el único comentario del DDL (`:1203`) y lo que pide la lógica del formulario: si no se usaron autodesactivables, hay que declarar qué se usó. Invertirla para «uniformar» con F34, F36 y F38 haría que el bloque abriera cuando no hay nada que preguntar.
- **Sí:** que solo `'NO'` abra, dejando `'YES'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null` como cerrado, los cinco por igual. Es la misma forma de F34, F36 y F38 con el valor de apertura cambiado, y no un mecanismo distinto.
- **Sí:** un criterio de aceptación dedicado a la polaridad. Es el único que falla si la condición se escribe invertida; todos los demás casos del bloque pasan igual. §7 lo declara riesgo.

**Sobre la regla de «al menos uno»**

- **Sí:** implementar el *required* del comentario como «al menos uno de los cuatro resulta `true`». Es la lectura fiel de la pregunta que el bloque hace —«¿cuáles se usaron?»— y la primera regla de mínimo del repositorio.
- **No:** interpretarlo como «los cuatro presentes». Obligaría a mandar cuatro booleanos para declarar un solo tipo de jeringa, y convertiría cada `PUT` parcial en un 400 salvo que el cliente reenviara el bloque entero — justo lo que el update diferencial de F12 vino a evitar.
- **No:** dejar el bloque abierto como «permitido y opcional», que es lo que hicieron F34, F36 y F38. Aquí el DDL dice *required* y un bloque abierto y vacío no registra nada: declara que no se usaron autodesactivables y calla lo que sí se usó, que es exactamente el dato que el bloque existe para capturar.
- **Sí:** evaluar la regla sobre el estado resultante, de modo que un `PUT { notes: 'x' }` sobre una fila ya poblada no falle. Evaluarla sobre el body convertiría cualquier update parcial de una fila con el bloque abierto en un 400.
- **Sí:** que un `PUT` que apaga el último `true` sea 400, con la salida de cerrar la bandera en la misma petición. La alternativa —cerrar el bloque automáticamente— tomaría por el cliente una decisión que cambia el significado de la respuesta a la pregunta principal.
- **No:** un `CHECK` en el DDL que exprese el mínimo. Un `CHECK` no distingue «el campo no aplica» de «el campo falta», que es justo la distinción que la asimetría `001`/`004` necesita, y bloquearía las filas ya cargadas que tengan el bloque abierto y vacío.

**Sobre el bloque anidado**

- **Sí:** que `usedOtherSyringes === true` gobierne a `otherSyringesDescription`. Es el primer bloque anidado del repositorio, y no lo dice el DDL: el comentario de `:1203` mete la descripción en el bloque exterior y calla la segunda condición. Sale del formulario.
- **Sí:** resolverlo como **dos pasadas sucesivas** y no como una condición compuesta. Cambia el código de error que ve el cliente: «no declaraste que usaste otras jeringas» y «ni siquiera abriste el bloque» son dos correcciones distintas del formulario, y una condición compuesta las colapsaría en un solo 400.
- **No:** exigir la descripción cuando `usedOtherSyringes` es `true`. Sería una segunda regla de mínimo, sobre un campo de texto libre y sin respaldo en el DDL: quien marca «otras» puede no saber aún cuáles. §2 lo deja fuera de alcance explícitamente.

**Sobre los tres grupos sin reglas**

- **Sí:** declarar explícitamente que los cinco de reconstitución, los seis pares `had*`/`*Notes` y `notes` **no tienen ninguna regla**. Es una decisión, no una omisión, y sin escribirla el siguiente implementador la leerá como un olvido y «completará» el patrón.
- **No:** colgar cada `*Notes` de su bandera. Un `'NO'` acompañado del motivo, un `'UNKNOWN'` con la explicación de por qué no se sabe o un comentario suelto son registros perfectamente válidos, y un bloque condicional los borraría al forzar la nota a `null`. Seis criterios de §5 lo protegen.
- **No:** exclusión mutua entre las cuatro primeras de reconstitución. Describen prácticas que en el terreno se excluyen, pero el formulario las pregunta por separado y el registro debe permitirse tal como llega. Introducirla exigiría además decidir la precedencia, como hizo F38 con los contenedores, y sin un caso real que lo justifique sería inventar una regla.

**Sobre la asimetría de tipos**

- **Sí:** respetar el DDL y exponer los cuatro tipos de jeringa como `boolean` de tres estados dentro de un bloque cuya bandera es `answerOption`. El modelo tiene que calzar con la tabla, y la asimetría es visible en el contrato porque es real en el esquema. Es la decisión de F38.
- **No:** traducir los cuatro booleanos a `answerOption`. Obligaría a decidir a qué booleano corresponden `'UNKNOWN'`, `'NOT_APPLICABLE'` y `'NO_ANSWER'` — tres valores que un `boolean` no puede representar y que se perderían al guardar.
- **Sí:** tratar `false` como valor y no como ausencia, en el bloque, en la regla de mínimo y en el diff. Es el caso que §11 advierte, y aquí aparece tres veces: `false` no abre nada, no cuenta como declaración de tipo y no se descarta en el diff.

**Sobre lo que este spec deliberadamente no hace**

- **Sí:** no tocar el DDL en ninguna línea. Es el segundo spec de la serie de satélites que no lo modifica, tras F38, y es una propiedad verificable: `git diff --stat esaviapp.sql` vacío.
- **No:** imponer un tope de longitud a las diez columnas de texto. Las diez son `text` en el DDL, sin techo declarado; inventar un límite en el validador crearía un 400 que la base de datos no respalda y que ningún criterio del formulario justifica.
- **No:** convertir `otherSyringesDescription` ni ninguno de los seis `*Notes` en un catálogo. Mientras el dato entre como texto libre, guardarlo como texto libre es la lectura fiel.
- **No:** derivar una conclusión «hubo error programático» de las dieciséis respuestas. Es un juicio de clasificación, no un dato de investigación, y cruza con `finalClassification`.
- **No:** cruzar `hadContaminatedVaccine` o `hadAbnormalVaccineConditions` con los hallazgos de nevera de F38, ni la reconstitución con el frasco multidosis de F36. Se solapan conceptualmente, y atarlas exige antes decidir cuál manda.
- **No:** filtrar el listado por campos de dominio. Sería el primer filtro de ese tipo del repositorio y abre la puerta a tableros; los dos filtros son los de F29, F32, F34, F36 y F38.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **La polaridad invertida.** Es el primer bloque del repositorio que abre con `'NO'`, y F34, F36 y F38 entrenan a leer lo contrario. Un implementador que copie el patrón escribirá `=== 'YES'` y **todos los casos del bloque seguirán pasando** salvo uno: la fila queda abierta cuando no hay nada que preguntar y cerrada justo cuando el formulario pide el dato | Declarado en §1 como novedad, en §3.1 junto al comentario del DDL y en §6 como decisión. §5 tiene tres criterios dedicados —`'YES'` con un tipo devuelve 400, los otros cuatro estados igual, `'NO'` con un tipo devuelve 201— que una condición invertida rompe de inmediato |
| **La regla de mínimo evaluada sobre el body en vez de sobre el estado resultante.** Convertiría cualquier `PUT` parcial de una fila con el bloque abierto en un 400 — incluido uno que solo cambia `notes` | §3.5 lo declara explícitamente y §5 lo verifica con un `PUT { notes: 'x' }` sobre una fila poblada. Es el mismo error que F38 evitó en su regla de transporte |
| **El anidado colapsado en una condición compuesta.** Devolvería el mismo 400 para «no abriste el bloque» y para «no declaraste otras jeringas», y el cliente no sabría qué corregir | §3.5 lo declara como dos pasadas con orden fijo, y §5 exige que el exterior cerrado devuelva `SYRINGE_DETAIL_NOT_ALLOWED` y no el código del anidado |
| **Las notas colgadas de sus banderas por «completar» el patrón.** Es el cambio más plausible de un mantenedor futuro: seis pares `bandera` + `nota` piden a gritos un bloque condicional, y no lo son. Colgarlas borraría en silencio las notas ya guardadas con la bandera en `'NO'` | Declarado en §3.1 columna por columna, en §3.5 como grupo sin reglas y en §6 como decisión. §5 tiene seis criterios —uno por par— que un bloque condicional rompe todos a la vez |
| **`false` tratado como ausencia.** Un `if( data.usedGlassSyringes )` escrito por costumbre descartaría el valor en tres sitios distintos: la prohibición del `001`, la regla de mínimo y el diff | Tres criterios de §5 lo verifican por separado. §11 lo declara norma |
| **Veintiséis columnas en un solo servicio.** La tabla de `candidates` de §3.5 es la más larga del repositorio, y una columna olvidada al escribirla no falla al compilar: simplemente deja de poder actualizarse, en silencio | La tabla de §3.5 es exhaustiva y ordenada como el DDL. El criterio de §5 que exige las veintiséis en la respuesta de las cuatro operaciones detecta la omisión en el modelo; un caso por grupo en la suite la detecta en el diff |
| **`GET /:id` captura `/admin`, `/purge` o `/case` como UUID** | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por `ROUTE_RULES` |
| **Un `ESAVI-INVESTGN-005C` destruye esta fila sin aviso previo** | Decisión heredada de F13, F29, F30, F32, F34, F36 y F38: se deja disparar la cascada, con el volcado al log en `warn` como única mitigación |

**No hay sección 8.** Este spec solo añade rutas nuevas: no modifica el contrato HTTP de ninguna entidad existente. `investigation` no cambia su respuesta —el inverso `administrationError` no se incluye en ninguna de sus operaciones— y las suites de F29 a F38 pasan sin tocar un caso.

---

## Lo que **no** está en este spec

- **Las dos satélites de `investigation` que siguen sin spec:** `investigationCovidHistory` e `investigationCommunity`.
- **Exigir `otherSyringesDescription`** cuando `usedOtherSyringes` es `true`.
- **Exclusión mutua** dentro del grupo de reconstitución.
- **Colgar los seis `*Notes`** de sus banderas.
- **Cualquier regla cruzada** con `investigationColdChain`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `notificationVaccine` o `notificationDiluent`.
- **Derivar una conclusión** «hubo error programático» de las dieciséis respuestas.
- **Filtrar, contar o agregar** por cualquier campo de dominio.
- **Búsqueda por texto** sobre las diez columnas libres.
- **Topes de longitud** en las diez columnas de texto.
- **Modificar `esaviapp.sql`** en ninguna línea.
- **Modificar `satelliteCascade.service.ts`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.**
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.**
- **Exponer o editar `sysDetails`.**

Cada uno de esos, si aterriza, va en su propio spec.
