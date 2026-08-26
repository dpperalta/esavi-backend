# SPEC F38 — CRUD de `investigationColdChain`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), SPEC F29 (`investigationSource`), SPEC F30 (`investigationAutopsy`), **SPEC F32 (`investigationMedicalHistory` — aporta `satelliteCascade.service.ts`, que este spec consume ya extraído)**, **SPEC F34 (`investigationClinicalEvaluation` — aporta el patrón del bloque condicional gobernado por una bandera booleana, con su asimetría `001`/`004`)**, **SPEC F36 (`investigationVaccinationContext` — hermana de forma directa: misma PK-FK, misma ausencia de `isActive`, mismo listado dual)**, SPEC F13 y SPEC F14 (patrón de satélite sin `isActive`), SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-25
> **Objetivo:** Dar de alta `investigationColdChain` —cómo se conservó y cómo viajó la vacuna investigada: si la temperatura de almacenamiento se monitorizó, si hubo desviación de rango, y en qué contenedor se transportó— como la **octava** tabla con FK directa a `investigation` que recibe spec propio.

---

## 1. Por qué existe este spec

`investigationColdChain` responde al bloque del formulario de investigación que audita la **cadena de frío**. No describe al paciente, ni al evento, ni la jornada de vacunación: describe **cómo se conservó el producto antes de aplicarse**. La tabla separa dos momentos:

- **El almacenamiento.** Si la temperatura se monitorizó (`storageTemperatureMonitored`), si hubo desviación del rango (`storageRangeDeviation`), si se siguió el procedimiento (`storageProcedureFollowed`), y cuatro hallazgos concretos de la nevera: objetos ajenos presentes, vacuna parcialmente reconstituida, vacuna inservible y diluyente inservible.
- **El transporte.** En qué contenedor viajó la vacuna, si se colocó y se devolvió en él, y de qué tipo era.

Hoy la tabla existe en `esaviapp.sql:1175-1198` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **octava tabla con FK directa a `investigation`** que recibe spec propio, tras F29, F30, F31, F32, F34, F36 y F37. De forma es hermana directa de **F36**, y los cuatro rasgos que aquélla fijó se cumplen aquí sin matices — se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`:1176`) y destino de `FK_investigationColdChain_investigation` (`:1197`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **octava** del repositorio así, tras `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy`, `investigationMedicalHistory`, `investigationClinicalEvaluation` e `investigationVaccinationContext`. De ahí sale que **no haya `005A` ni `005B`**, y que la visibilidad se herede de `investigation.isActive`.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete`, así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar. La tabla figura entre las 27 habilitadas para `005C` en `CONVENTIONS.md` §6.
- **Solo lleva el trigger genérico.** `TRG_investigationColdChain_setSysDetails`, del bucle de `esaviapp.sql:1290-1305`. `updatedAt` lo escribe la aplicación.

**Y tres cosas que este spec ya no tiene que resolver.** `satelliteCascade.service.ts` nace en F32 y esta entidad es su siguiente consumidora, sin tocarlo. El patrón del bloque condicional gobernado por una bandera —400 en el alta, forzado a `null` en el update— lo fijó F34. Y **no hay ninguna FK a `catalogItem`**: a diferencia de F35 y F36, este spec **no siembra nada en el DDL** y no tiene una sola validación de doble salto contra un catálogo.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco de F36.** Dos cosas, y las dos viven en el bloque de transporte:

**A — Es la primera exclusión mutua del repositorio resuelta por precedencia y no solo por error.** `transportUsedThermos` y `transportUsedColdPack` (`:1185`, `:1188`) describen **el mismo hecho** —en qué contenedor viajó la vacuna— y no pueden ser los dos `'YES'`. Hasta ahora, todo conflicto entre dos campos del repositorio se resolvía con un 400 y ahí terminaba. Aquí conviven **tres desenlaces distintos según de dónde venga cada `'YES'`**: conflicto si los dos viajan en el body (400), relevo si uno viaja y el otro está guardado (gana el del body, sin error), y empate heredado si ninguno viaja y los dos están guardados (gana el termo por precedencia, sin error). §3.5 lo declara caso por caso.

**B — Tres columnas cuyo nombre miente sobre su contenido, y es un hallazgo, no un error de este spec.** `transportSetInThermos`, `transportReturnedInThermos` y `transportTypeThermo` (`:1186`, `:1187`, `:1189`) llevan `Thermos` en el nombre, pero **el formulario vigente unifica los dos contenedores**: su pregunta real es «se colocó / se devolvió en el contenedor» y «de qué tipo era el contenedor», donde el contenedor puede ser un termo **o una caja fría**. Las tres columnas aplican al contenedor que se haya usado, sea cual sea, y por eso **no pertenecen al bloque de exclusión**: quedan abiertas siempre, incluso cuando no se declaró ningún contenedor. El DDL no lo dice en ningún sitio —esta tabla no tiene un solo comentario— y por eso queda escrito aquí, en §3.1 junto a la tabla de columnas, y como decisión en §6.

**Y una asimetría de tipos que el DDL impone y este spec respeta.** `storageTemperatureMonitored` y `storageRangeDeviation` son `boolean` puro (`:1177`, `:1178`); las otras ocho columnas de respuesta son `answerOption`. Conviven en el mismo bloque de almacenamiento. El modelo calza con la tabla y **no traduce entre los dos tipos**: la bandera booleana solo tiene tres estados —`true`, `false`, `null`— y solo `true` abre el bloque.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationColdChain`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29, F30, F32, F34 y F36 mantuvieron.
- **Listado dual `002A` / `002B`**, heredado de F36: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve filas cuya investigación está activa; `002B` en `GET /admin` para ADMIN las devuelve todas.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear la segunda cadena de frío de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVCOLD_001_INVESTIGATION_NOT_FOUND`; no tiene ya cadena de frío, sin filtrar por `deletedAt` → 409 `INVCOLD_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la fila responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Alta vacía.** Las quince columnas de datos son anulables y **ninguna es obligatoria**: `POST { investigationId }` devuelve **201** con las quince en `null`. La fila se abre como borrador y se completa por `PUT`. Es el patrón de F13, F14, F29, F32, F34 y F36.
- **`investigationId` inmutable en el `004`:** se ignora en silencio si llega, sin 400.
- **Dos columnas `boolean` y ocho `answerOption`, sin traducción entre ellas.** `storageTemperatureMonitored` y `storageRangeDeviation` se exponen como booleanos de tres estados (`true` / `false` / `null`); las ocho restantes se validan contra `ANSWER_OPTIONS`. El modelo respeta el DDL literalmente.
- **`storageTemperatureMonitored` gobierna a `storageRangeDeviation`**, y solo a él, con la regla de F34:
  - **Solo `true` abre el bloque.** `false` y `null` lo cierran, los dos por igual.
  - Con el bloque **cerrado**, `storageRangeDeviation` está **prohibido**, con la asimetría `001` / `004`: **400** en el alta; en el update, **forzado a `null` como derivado condicional** si el cliente no lo manda, **400** si lo manda con valor. Mandarlo explícitamente en `null` **no** es error.
  - `storageProcedureFollowed`, `storageOtherObjectPresent`, `storagePartiallyReconstitutedVaccine`, `storageVaccineNotUsable`, `storageDiluentNotUsable` y `storageKeyFindings` **quedan fuera del bloque**: son independientes y están siempre abiertos.
- **La exclusión mutua del contenedor de transporte**, entre `transportUsedThermos` y `transportUsedColdPack`, resuelta en tres casos según de dónde venga cada `'YES'`:
  - **Conflicto** — los dos viajan en el body y los dos resultan `'YES'` → **400** `INVCOLD_<op>_TRANSPORT_CONTAINER_CONFLICT`. En el `001` es el único caso posible.
  - **Relevo** — uno viaja en `'YES'` y el otro está guardado en `'YES'` → gana **el del body**; el guardado se fuerza a `'NO'` como derivado. Sin error.
  - **Empate heredado** — ninguno viaja y los dos están guardados en `'YES'` → gana el **termo** por precedencia; `transportUsedColdPack` se fuerza a `'NO'`. Sin error.
- **Las tres columnas del contenedor quedan siempre abiertas.** `transportSetInThermos`, `transportReturnedInThermos` y `transportTypeThermo` **no** forman parte de ningún bloque condicional: aplican al contenedor que se haya usado —termo o caja fría— y se guardan aunque no se declare ninguno. El hallazgo queda documentado en §3.1 y razonado en §6.
- **Ningún campo cifrado.** La tabla no contiene ningún nombre de persona ni dato identificativo. `transportTypeThermo`, `storageKeyFindings`, `transportKeyFindings` y `notes` son texto libre plano.
- **Normalización al escribir:** `.trim()` sobre `transportTypeThermo`, `storageKeyFindings`, `transportKeyFindings` y `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre**, ya sobre `src/services/common/satelliteCascade.service.ts` **sin modificarlo**: `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica añadir invocaciones en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, **junto a las que F29, F30, F32, F34, F36 y F37 ya dejaron puestas**.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto a los que las specs anteriores dejaron.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVCOLD_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**, porque el control de `isActive` de `purgeEntityService` es inerte sobre una tabla que no tiene esa columna.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación. Orden `createdAt DESC`.
- Alta de la abreviatura **`INVCOLD`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationColdChain.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F32** debe estar `Implementado`. No hay dependencia de modelo, pero sí de código: `satelliteCascade.service.ts` nace allí y este spec lo consume tal cual.

**Fuera de alcance (otros specs):**

- **Las tres satélites de `investigation` que siguen sin spec:** `investigationCovidHistory` (`:1014-1036`), `investigationAdministrationError` (`:1200-…`) e `investigationCommunity`.
- **Cualquier regla cruzada con `investigationVaccinationContext`.** El frasco multidosis aparece en las dos tablas y no significa lo mismo: allí es cuántas personas se vacunaron de él, aquí cómo se conservó. Atarlas exige antes decidir cuál manda.
- **Cualquier regla cruzada con `investigationVaccineAdministered`, `notificationVaccine`, `notificationDiluent` o `diluentCatalog`.** `storageDiluentNotUsable` es una respuesta del formulario, **no** una referencia al diluyente registrado en la notificación, y este spec no la resuelve contra ninguna fila.
- **Derivar una conclusión de la cadena de frío.** Una bandera «cadena de frío rota» calculada a partir de las diez respuestas sería un dato de clasificación, no de investigación, y cruza con `finalClassification`.
- **Filtrar, contar o agregar por cualquier campo de dominio** —desviación de rango, tipo de contenedor, hallazgos—. Sería el primer filtro por dato de dominio del repositorio y abre la puerta a tableros. Los dos únicos filtros del listado son los de F29, F32, F34 y F36.
- **Estructurar `transportTypeThermo`.** Es `varchar(250)` libre en el DDL y así se queda: convertirlo en un catálogo de tipos de contenedor es una decisión de modelo que ni el esquema ni el formulario respaldan hoy, y exigiría sembrar un `catalogType` que este spec deliberadamente no introduce.
- **Renombrar las tres columnas `*Thermos`** ni añadir columnas equivalentes con nombre neutro. El DDL es autoritativo y hay filas que dependen de él; el desajuste se documenta, no se corrige aquí.
- **Búsqueda por texto** sobre `storageKeyFindings`, `transportKeyFindings`, `transportTypeThermo` o `notes`.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene cadena de frío.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión de F13, F29, F30, F32, F34 y F36, heredada sin reabrirse.
- **Modificar `esaviapp.sql`.** Ni añadir `isActive`, ni un `CHECK` sobre la exclusión del contenedor, ni un índice, ni meter `investigation` en `preventPhysicalDelete`, ni sembrar ningún catálogo. **Este spec no toca el DDL en ninguna línea** — es la diferencia con F35 y F36.
- **Modificar `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.** Los cinco se consumen tal cual están.
- **Cambiar el comportamiento de F29, F30, F32, F34, F36 ni F37.** Este spec solo añade invocaciones junto a las suyas; sus suites de contrato deben pasar sin tocar un solo caso.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2 y sigue mereciendo su propio spec.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationColdChain` — `esaviapp.sql:1175-1198`. **La tabla no se altera, y este spec no añade una sola línea al DDL.**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:1176`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationColdChain_investigation` → `investigation`, `ON DELETE CASCADE` (`:1197`) |
| `storageTemperatureMonitored` | `boolean` | sí | `:1177`. **Bandera del bloque de almacenamiento.** Tres estados: `true`, `false`, `null` |
| `storageRangeDeviation` | `boolean` | sí | `:1178`. **Único campo del bloque.** Abierto solo con la bandera en `true` |
| `storageProcedureFollowed` | `answerOption` | sí | `:1179`. Independiente |
| `storageOtherObjectPresent` | `answerOption` | sí | `:1180`. Independiente |
| `storagePartiallyReconstitutedVaccine` | `answerOption` | sí | `:1181`. Independiente |
| `storageVaccineNotUsable` | `answerOption` | sí | `:1182`. Independiente |
| `storageDiluentNotUsable` | `answerOption` | sí | `:1183`. Independiente. **No resuelve contra `diluentCatalog` ni contra `notificationDiluent`** |
| `storageKeyFindings` | `text` | sí | `:1184`. Texto libre |
| `transportUsedThermos` | `answerOption` | sí | `:1185`. **Lado con precedencia de la exclusión mutua** |
| `transportSetInThermos` | `answerOption` | sí | `:1186`. **Aplica al contenedor, no al termo.** Siempre abierto |
| `transportReturnedInThermos` | `answerOption` | sí | `:1187`. **Aplica al contenedor, no al termo.** Siempre abierto |
| `transportUsedColdPack` | `answerOption` | sí | `:1188`. **Lado sin precedencia de la exclusión mutua** |
| `transportTypeThermo` | `varchar(250)` | sí | `:1189`. **Aplica al contenedor, no al termo.** Siempre abierto. Texto libre, sin catálogo |
| `transportKeyFindings` | `text` | sí | `:1190`. Texto libre |
| `notes` | `text` | sí | `:1191`. Texto libre |

**Quince columnas de datos, las quince anulables.** Ninguna es `NOT NULL`, y de ahí sale directamente el alta vacía de §2: no hay nada que el investigador esté obligado a saber para abrir la fila.

**Restricciones.** **Una sola clave foránea** —la del padre—, **ningún `CHECK`**, **ninguna `UNIQUE`** —la PK ya lo es— y **ningún índice declarado** más allá del de la clave primaria. **No hace falta añadir ninguno:** el `investigationId` por el que filtra el listado *es* la clave primaria, que ya está indexada.

**Es la tabla más desnuda de las satélites de `investigation` especificadas hasta hoy.** F36 tenía tres FKs y cuatro `CHECK`; ésta tiene una FK y cero `CHECK`. **Todo lo que este spec valida más allá de los tipos lo impone íntegramente la aplicación**, y por eso §3.5 es su sección larga.

**El DDL no lleva un solo comentario en esta tabla.** F36 tenía el de `:1144` —«If answer is "No", then the following field is required»—, que era la única regla de negocio escrita en el esquema. Aquí no hay ninguna: **ni el bloque de almacenamiento ni la exclusión del contenedor están insinuados en el DDL**. Salen del formulario vigente y quedan escritos aquí por primera vez.

#### Hallazgo — tres columnas cuyo nombre miente sobre su contenido

`transportSetInThermos`, `transportReturnedInThermos` y `transportTypeThermo` llevan `Thermos` en el nombre, pero **el formulario vigente unifica los dos contenedores**: pregunta «se colocó en el termo **o caja fría**», «se devolvió en el termo **o caja fría**» y «de qué tipo era». Las tres columnas describen **el contenedor que se haya usado**, sea termo o caja fría.

Tres consecuencias, y las tres son norma en este spec:

1. **Las tres columnas no pertenecen a ningún bloque condicional.** No las gobierna `transportUsedThermos` ni `transportUsedColdPack`: siguen abiertas aunque no se declare ningún contenedor.
2. **El orden del DDL refuerza la lectura equivocada y hay que ignorarlo.** `transportUsedColdPack` está declarado en `:1188`, **después** de las dos columnas `*InThermos`, como si éstas colgaran del termo de `:1185`. No es así.
3. **Los nombres no se cambian.** El DDL es autoritativo y hay filas cargadas. §6 lo declara como decisión y §7 como riesgo.

**El ENUM `answerOption`** se declara en `esaviapp.sql:26` con cinco valores: `'YES'`, `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`. Ya vive en `src/constants/enums.constants.ts:8` como `ANSWER_OPTIONS`, con el tipo `AnswerOption` en `:10`. **No se añade ninguna constante nueva.** Ocho columnas lo usan; las otras dos son `boolean` puro y **no se traducen a él**.

**Las columnas transversales, y la que falta.** Están `createdAt` (`:1192`), `updatedAt` (`:1193`), `deletedAt` (`:1194`), `sysDetails` (`:1195`) y `appDetails` (`:1196`). **Falta `isActive`**, igual que en `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy`, `investigationMedicalHistory`, `investigationClinicalEvaluation` e `investigationVaccinationContext`. Es la octava tabla del repositorio así.

**Triggers.** Solo `TRG_investigationColdChain_setSysDetails`, del bucle genérico de `esaviapp.sql:1290-1305`, que alcanza a toda tabla con columna `sysDetails`. La tabla no figura en el bucle `preventPhysicalDelete`, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco figura en `setSortOrderByParent`: no tiene `sortOrder`.

**Hoja del grafo.** `grep 'REFERENCES "investigationColdChain"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationColdChain.model.ts`. Clase `InvestigationColdChain`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationColdChain'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14, F29, F30, F32, F34 y F36: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- `storageTemperatureMonitored` y `storageRangeDeviation` — `DataTypes.BOOLEAN`, `allowNull: true`. **`BOOLEAN` y no `ENUM`**: el modelo calza con la columna, y traducir aquí a `answerOption` sería inventar un tipo que la tabla no tiene.
- Las ocho columnas de respuesta — `DataTypes.ENUM(...ANSWER_OPTIONS)`, `allowNull: true`, importando `ANSWER_OPTIONS` y el tipo `AnswerOption` de `src/constants/enums.constants.ts`. Es el patrón de `severeNotification.model.ts:51-67`.
- `transportTypeThermo` — `DataTypes.STRING(250)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres, siguiendo F35 y F36.
- `storageKeyFindings`, `transportKeyFindings` y `notes` — `DataTypes.TEXT`, `allowNull: true`.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationColdChain.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationColdChain.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationColdChain, { as: 'coldChain', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `coldChain` no colisiona con `source` (F29), `autopsy` (F30), `teamMembers` (F31), `medicalHistory` (F32), `clinicalEvaluation` (F34), `vaccinationContext` (F36) ni `vaccinesAdministered` (F37).

**Dos asociaciones y ninguna más.** Es la diferencia con F36, que necesitaba dos `belongsTo` extra al mismo catálogo con alias distintos: aquí **no hay ninguna FK a `catalogItem`**, así que no hay ni un `include` de catálogo en todo el spec.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `coldChain` **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationColdChain.types.ts`, junto a los de `investigation`, `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `investigationVaccinationContext` e `investigationVaccineAdministered`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationColdChainInput {
    investigationId: string;
    storageTemperatureMonitored?: boolean | null;
    storageRangeDeviation?: boolean | null;
    storageProcedureFollowed?: AnswerOption | null;
    storageOtherObjectPresent?: AnswerOption | null;
    storagePartiallyReconstitutedVaccine?: AnswerOption | null;
    storageVaccineNotUsable?: AnswerOption | null;
    storageDiluentNotUsable?: AnswerOption | null;
    storageKeyFindings?: string | null;
    transportUsedThermos?: AnswerOption | null;
    transportSetInThermos?: AnswerOption | null;
    transportReturnedInThermos?: AnswerOption | null;
    transportUsedColdPack?: AnswerOption | null;
    transportTypeThermo?: string | null;
    transportKeyFindings?: string | null;
    notes?: string | null;
}
```

**`investigationId` es el único campo obligatorio del tipo.** Los quince restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo.

**Los dos primeros son `boolean | null` y no `AnswerOption | null`.** Es la asimetría del DDL, trasladada al contrato sin suavizar.

`AnswerOption` se importa de `src/constants/enums.constants.ts`; **no se declara ningún tipo nuevo de enumerado**.

El update usa `Partial<CreateInvestigationColdChainInput>`. **No se declara `UpdateInvestigationColdChainInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Las dos columnas del contenedor se declaran como una constante local del servicio, para fijar la precedencia en un solo sitio en vez de repartirla por el código:

```ts
const TRANSPORT_CONTAINER_FIELDS = [
    'transportUsedThermos',
    'transportUsedColdPack',
] as const;
```

**El orden del array *es* la precedencia**: el primero gana en el empate heredado. No va a `src/constants/investigation.constants.ts` porque solo lo consume este servicio, igual que F27, F32, F34 y F36 mantuvieron locales sus listas.

**No hace falta una constante equivalente para el bloque de almacenamiento**: gobierna a **un solo** campo, `storageRangeDeviation`, y una lista de un elemento es ruido. Es la diferencia con F36, cuyo bloque tenía cuatro.

### 3.4 Superficie HTTP

```
POST   /api/investigation-cold-chains                ESAVI-INVCOLD-001   USER        (nuevo)
GET    /api/investigation-cold-chains                ESAVI-INVCOLD-002A  USER        (nuevo)
GET    /api/investigation-cold-chains/admin          ESAVI-INVCOLD-002B  ADMIN       (nuevo)
DELETE /api/investigation-cold-chains/purge/:id      ESAVI-INVCOLD-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-cold-chains/case/:caseId   ESAVI-INVCOLD-006   USER        (nuevo)
GET    /api/investigation-cold-chains/:id            ESAVI-INVCOLD-003   USER        (nuevo)
PUT    /api/investigation-cold-chains/:id            ESAVI-INVCOLD-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationColdChain.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14 y F28 a F37, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar una cadena de frío es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationColdChain` · `006` · obtener la cadena de frío de un caso — la cadena `caso → investigación → cadena de frío` es uno a uno en los dos saltos**.

**La abreviatura es `INVCOLD`.** Siete letras, no colisiona con las treinta y siete registradas y `grep "ESAVI-INVCOLD-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-INVTEAM-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-`, `ESAVI-INVCLIEV-`, `ESAVI-INVVACTX-`, `ESAVI-INVVACAD-` ni `ESAVI-EVALINST-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

Las dos reglas de esta entidad miran el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resulting(campo) = data[campo] !== undefined ? (data[campo] ?? null) : stored[campo]
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**La regla de transporte necesita además saber si la clave viajó.** Es la única del repositorio que lo necesita, y es lo que separa un conflicto de un relevo: `travels(campo) = data[campo] !== undefined`. Un campo que llega en `null` **sí viaja** — está diciendo «bórralo», que es una intención del cliente igual que cualquier otra.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| `storageTemperatureMonitored` y `storageRangeDeviation` booleanos, admitiendo `null` | validador | 400 `common.validationError` |
| Las ocho `answerOption` dentro de `ANSWER_OPTIONS`, admitiendo `null` | validador | 400 `common.validationError` |
| `transportTypeThermo` cadena de hasta 250 caracteres | validador | 400 `common.validationError` |
| `storageKeyFindings`, `transportKeyFindings` y `notes` como cadena | validador | 400 `common.validationError` |
| `storageRangeDeviation` con valor y `storageTemperatureMonitored` resultante distinto de `true` | **servicio** | 400 `INVCOLD_<op>_RANGE_DEVIATION_NOT_ALLOWED` |
| Los dos campos de contenedor viajan y los dos resultan `'YES'` | **servicio** | 400 `INVCOLD_<op>_TRANSPORT_CONTAINER_CONFLICT` |

**No hay ninguna validación de FK contra catálogo**, porque no hay ninguna FK a catálogo. Es la única de las satélites especificadas cuyo servicio no consulta otra tabla más que `investigation`.

**No hay ninguna validación de rango numérico**, porque no hay una sola columna numérica. Es la otra diferencia con F36, que replicaba cuatro `CHECK` y el techo de `smallint`.

#### El bloque de almacenamiento

**Solo `storageTemperatureMonitored` resultante `true` abre el bloque.** `false` y `null` lo cierran, los dos por igual. Es una bandera booleana de tres estados, y el «no abre» tiene por tanto **dos** formas, no cinco como en F36: `false` es «no se monitorizó» y `null` es «no se sabe», y bajo ninguna de las dos tiene sentido registrar una desviación de rango que nadie pudo medir.

**Con el bloque abierto**, `storageRangeDeviation` es opcional: se guarda tal como llegue, incluido `false`. No hay campo exigible.

**Con el bloque cerrado**, `storageRangeDeviation` está **prohibido**, con la asimetría de F34 y F36:

- **`001` — es 400.** Mandarlo con valor —`true` **o** `false`— junto a un `storageTemperatureMonitored` que no es `true` es `INVCOLD_001_RANGE_DEVIATION_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente lo manda.** Si **no viaja**, se **fuerza a `null`**: cerrar el bloque limpia el campo sin pedir permiso ni devolver error. Si **viaja con valor** —`true` o `false`— produce 400 `INVCOLD_004_RANGE_DEVIATION_NOT_ALLOWED`. Mandarlo en `null` **no** es error: es el mismo destino al que el forzado llega solo.

**`false` cuenta como valor y no como ausencia.** Es exactamente el caso que §11 advierte: un `if( data.storageRangeDeviation )` trataría el `false` como si no hubiera llegado, y este campo lo usa para decir «se monitorizó y no hubo desviación», que es el hallazgo más frecuente del formulario.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** el campo entra en `candidates` **siempre** que el bloque esté cerrado, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difiere. Si la fila ya lo tenía en `null`, el diff no encuentra nada y **no se escribe**: cerrar un bloque ya cerrado no crece `appDetails`.

**Las otras seis columnas de almacenamiento no están en el bloque** y no se ven afectadas por nada de lo anterior.

#### La exclusión mutua del contenedor de transporte

`transportUsedThermos` y `transportUsedColdPack` describen el mismo hecho y **no pueden resultar los dos `'YES'`**. El desenlace depende de **de dónde viene cada `'YES'`**, y son tres casos excluyentes evaluados en este orden:

**1 — Conflicto.** Los **dos** campos viajan en el body y los dos resultan `'YES'` → **400** `INVCOLD_<op>_TRANSPORT_CONTAINER_CONFLICT`. El cliente está afirmando dos cosas incompatibles en la misma petición, y ninguna precedencia puede adivinar cuál quiso decir. **En el `001` es el único caso posible**, porque no hay estado guardado.

**2 — Relevo.** **Uno** de los dos viaja en `'YES'` y el otro **no viaja** pero está guardado en `'YES'` → gana **el del body**, y el guardado se fuerza a `'NO'`. Sin error. Es el cambio de contenedor: un `PUT` con solo `{ transportUsedColdPack: 'YES' }` sobre una fila que tenía termo deja el termo en `'NO'` y la caja fría en `'YES'`. **La precedencia no interviene aquí**: lo que el cliente acaba de afirmar pesa más que lo que había.

**3 — Empate heredado.** **Ninguno** de los dos viaja y los dos están guardados en `'YES'` → gana el **termo** por precedencia, y `transportUsedColdPack` se fuerza a `'NO'`. Sin error.

**El tercer caso solo puede darse en una fila cargada antes de este spec o escrita por SQL directo**; la aplicación nunca lo produce. Se resuelve en silencio y **no con un 400** deliberadamente: un 400 dejaría esa fila **congelada**, sin que ningún `PUT` pudiera tocarla nunca —ni siquiera uno que solo cambia `notes`—. Así se repara sola en el primer update que reciba. §6 lo razona.

**Con cualquier otra combinación no se fuerza nada.** Los dos en `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` o `null`, o uno solo en `'YES'`, se guardan tal cual llegan.

**El forzado a `'NO'` es un derivado, igual que el del bloque de almacenamiento:** entra en `candidates` cuando la regla lo determina, sin `if` de presencia, y el diff decide si se escribe.

**Las tres columnas del contenedor —`transportSetInThermos`, `transportReturnedInThermos` y `transportTypeThermo`— quedan al margen de todo esto.** No se prohíben, no se fuerzan y no se validan contra ninguna de las dos banderas. Aplican al contenedor que se haya usado, y el formulario permite describirlo aunque no se haya declarado cuál fue. Es el hallazgo de §3.1, y es la razón de que este bloque **no** replique la forma de F34 y F36.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Una cadena de frío cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVCOLD-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVCOLD_001_INVESTIGATION_NOT_FOUND`.
2. Esa investigación **no tiene ya cadena de frío**, buscando **sin filtrar por `deletedAt`** → 409 `INVCOLD_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fila sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. El bloque de almacenamiento, en su variante estricta.
4. La exclusión del contenedor, que en el alta solo puede dar el caso de conflicto.
5. Normaliza: `.trim()` sobre `transportTypeThermo`, `storageKeyFindings`, `transportKeyFindings` y `notes`.
6. Inserta con la entrada de auditoría `method: 'ESAVI-INVCOLD-001'`.

**El alta mínima es `{ investigationId }`** y devuelve 201 con las quince columnas de datos en `null`.

**`ESAVI-INVCOLD-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**`ESAVI-INVCOLD-002B` — listar, admin.** Idéntica, con el include del padre en `where: {}`: devuelve también las cadenas de frío de investigaciones inactivas. Los mismos dos filtros y el mismo orden.

**`ESAVI-INVCOLD-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVCOLD_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVCOLD-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVCOLD_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVCOLD_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene cadena de frío → 404 `INVCOLD_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVCOLD-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVCOLD_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Una cadena de frío no se traslada entre investigaciones.
3. Cálculo del estado resultante, el bloque de almacenamiento y la exclusión del contenedor. **Antes del diff y con independencia de él.**
4. `stored` sale de `coldChain.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `storageTemperatureMonitored` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable booleano: `false` es un valor, nunca una ausencia |
| `storageRangeDeviation` | bloque **abierto**: `data.x !== undefined ? (data.x ?? null) : undefined` · bloque **cerrado**: **`null` siempre** | derivado condicional: con el bloque cerrado entra sin `if` de presencia |
| `storageProcedureFollowed` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `storageOtherObjectPresent` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `storagePartiallyReconstitutedVaccine` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `storageVaccineNotUsable` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `storageDiluentNotUsable` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable |
| `storageKeyFindings` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()` antes de comparar |
| `transportUsedThermos` | caso **relevo** con la caja fría ganando: **`'NO'` siempre** · resto: `data.x !== undefined ? (data.x ?? null) : undefined` | derivado condicional |
| `transportSetInThermos` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Nunca forzado ni prohibido** |
| `transportReturnedInThermos` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Nunca forzado ni prohibido** |
| `transportUsedColdPack` | casos **relevo** con el termo ganando y **empate heredado**: **`'NO'` siempre** · resto: `data.x !== undefined ? (data.x ?? null) : undefined` | derivado condicional |
| `transportTypeThermo` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Nunca forzado ni prohibido** |
| `transportKeyFindings` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()` antes de comparar |
| `notes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()` antes de comparar |

**Tres campos derivados condicionales y trece anulables directos.** Ningún campo cifrado y ningún derivado incondicional: no hay nada que esta entidad recalcule en cada `PUT`.

**`ESAVI-INVCOLD-005C` — borrado físico.** SUPERADMIN. `assertRowIsSealed` sobre `deletedAt` → 409 `INVCOLD_005C_NOT_DELETED` si la fila sigue viva. Después `purgeEntityService`, cuyo control de `isActive` es inerte aquí. Volcado al log en `warn` antes del `destroy`. **No toca `appDetails`**: la fila desaparece en la misma transacción. Responde 200 con `{ ok, message }` **sin `data`**.

#### Arrastre del `deletedAt` — tres invocaciones, ningún archivo común modificado

Se cuelga de `satelliteCascade.service.ts` (F32) **sin tocarlo**, junto a las invocaciones que F29, F30, F32, F34, F36 y F37 ya dejaron:

| Origen | Efecto sobre `investigationColdChain` |
|---|---|
| `ESAVI-INVESTGN-005A` | sella `deletedAt` |
| `ESAVI-CASE-005A` | sella `deletedAt` |
| `ESAVI-INVESTGN-005B` | limpia `deletedAt` |
| `ESAVI-INVESTGN-005C` | la fila se destruye por `ON DELETE CASCADE`; volcado al log en `warn` antes del `destroy` del padre |

**El arrastre no es un update diferencial y no pasa por `buildDifferentialUpdate`.** Es una escritura con intención propia: registra que el padre fue retirado, y lo hace aunque ningún campo de datos de esta fila cambie. Es la misma declaración que hicieron F29, F30, F32, F34, F36 y F37, y se repite aquí porque el silencio sería indistinguible del olvido.

### 3.6 Claves i18n nuevas

En `src/data/i18n/es.json`, `en.json` y `nl.json`, bajo `investigationColdChain`:

| Clave | Uso |
|---|---|
| `investigationColdChain.createdSuccess` / `createdFailed` | `001` |
| `investigationColdChain.getSuccess` / `getFailed` | `003` y `006` |
| `investigationColdChain.getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `investigationColdChain.updatedSuccess` / `updatedFailed` | `004` |
| `investigationColdChain.purgedSuccess` / `purgedFailed` | `005C` |
| `investigationColdChain.notFound` | 404 en `003`, `004`, `005C` y `006` |
| `investigationColdChain.investigationNotFound` | 404 de la investigación en `001` y `006` |
| `investigationColdChain.caseNotFound` | 404 del caso en `006` |
| `investigationColdChain.alreadyExists` | 409 en `001`, con `{{investigationId}}` |
| `investigationColdChain.notDeleted` | 409 en `005C` sobre una fila no sellada |
| `investigationColdChain.rangeDeviationNotAllowed` | 400 con el bloque de almacenamiento cerrado |
| `investigationColdChain.transportContainerConflict` | 400 con los dos contenedores en `'YES'` en el mismo body |
| `investigationColdChain.idRequired` | parámetro ausente |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`003`, `006`, `001` y `004` devuelven el objeto completo:

```
{ ok, message, data: {
    investigationId,
    storageTemperatureMonitored, storageRangeDeviation, storageProcedureFollowed,
    storageOtherObjectPresent, storagePartiallyReconstitutedVaccine,
    storageVaccineNotUsable, storageDiluentNotUsable, storageKeyFindings,
    transportUsedThermos, transportSetInThermos, transportReturnedInThermos,
    transportUsedColdPack, transportTypeThermo, transportKeyFindings,
    notes,
    createdAt, updatedAt, deletedAt, appDetails,
    investigation: { investigationId, caseId, isActive }
} }
```

**El include de `investigation` viaja acotado a tres campos.** Es lo que el cliente necesita para saber de qué caso cuelga la fila y si su padre está vivo; devolver la investigación entera duplicaría la carga útil de `ESAVI-INVESTGN-003`.

**No hay ningún include de catálogo.** Es la diferencia visible con F36 en la respuesta: aquí las diez columnas de respuesta son valores literales —booleanos y cadenas del ENUM— y no resuelven contra nada.

`002A` y `002B` devuelven `{ count, rows }` de `findAndCountAll`, con cada fila en la misma forma.

`005C` responde **solo** `{ ok, message }`, sin `data`, según §10 de las convenciones.

**`sysDetails` no se expone en ninguna operación.** `isActive` no aparece porque la columna no existe.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registro de la abreviatura y de la operación no canónica.** Alta de `investigationColdChain` → `INVCOLD` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y de la fila `investigationColdChain` · `006` en la tabla de operaciones no canónicas.
   *Verificación:* `grep -n "INVCOLD" references/CONVENTIONS.md` devuelve las dos filas; la abreviatura no aparece dos veces en la tabla.

2. **Modelo y asociaciones.** `src/models/investigationColdChain.model.ts` con las quince columnas de datos, `timestamps: false`, `freezeTableName: true`, PK **sin** `defaultValue` y **sin** atributo `isActive`. `src/models/associations/investigationColdChain.associations.ts` con el `belongsTo` y el `hasOne` de alias `coldChain`. Alta en `src/models/index.ts` y en `initModels()`.
   *Verificación:* `npm run build` compila; un `findOne` en consola sobre una fila existente devuelve las quince columnas y `investigation` se resuelve por el include.

3. **Tipos.** `src/types/investigation/investigationColdChain.types.ts` con `CreateInvestigationColdChainInput`, los dos primeros campos como `boolean | null` y los ocho de respuesta como `AnswerOption | null`. Alta en el barrel del dominio.
   *Verificación:* `npm run build` compila; `grep -rn "UpdateInvestigationColdChainInput" src/` no devuelve resultados.

4. **Claves i18n.** Las trece claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

5. **Validadores.** `src/validators/investigationColdChain.validator.ts` con los tres obligatorios —`investigationColdChainIdValidator`, `createInvestigationColdChainValidator`, `updateInvestigationColdChainValidator`— más el de listado. Los dos booleanos con `.isBoolean()` admitiendo `null`, las ocho respuestas con `.isIn(ANSWER_OPTIONS)`, `transportTypeThermo` con `.isLength({ max: 250 })`. Alta en `src/validators/index.ts`.
   *Verificación:* un `POST` con `storageProcedureFollowed: 'MAYBE'` responde 400 `common.validationError`; uno con `transportTypeThermo` de 251 caracteres también.

6. **`ESAVI-INVCOLD-001` — crear.** Servicio, controlador y ruta, con las dos guardas del alta, el bloque de almacenamiento en variante estricta, el caso de conflicto de la exclusión, el `.trim()` de los cuatro campos de texto y la entrada de auditoría.
   *Verificación:* `POST { investigationId }` de una investigación activa devuelve **201** con las quince en `null`; repetirlo devuelve **409**; con una investigación inactiva devuelve **404**; con `storageRangeDeviation: false` y sin `storageTemperatureMonitored` devuelve **400**; con los dos contenedores en `'YES'` devuelve **400**.

7. **`ESAVI-INVCOLD-002A` y `002B` — listados.** Los dos servicios, el controlador único que bifurca por `canViewInactive`, las dos rutas con `/admin` declarada antes de `/:id`, los dos filtros y el orden `createdAt DESC`.
   *Verificación:* una fila cuya investigación está inactiva no aparece en `GET /` y sí en `GET /admin`; `GET /?caseId=<uuid inexistente>` devuelve 200 con `{ count: 0, rows: [] }`.

8. **`ESAVI-INVCOLD-003` — obtener por ID.** Con la visibilidad heredada y el include acotado a tres campos de `investigation`.
   *Verificación:* un `investigationId` inexistente devuelve 404; una fila de investigación inactiva devuelve 404 para USER y ADMIN y 200 para SUPERADMIN.

9. **`ESAVI-INVCOLD-006` — obtener por caso.** Ruta `/case/:caseId` declarada antes de `/:id`, con los tres 404 distintos.
   *Verificación:* los tres códigos —`CASE_NOT_FOUND`, `INVESTIGATION_NOT_FOUND`, `NOT_FOUND`— se obtienen cada uno con su escenario; la respuesta es el objeto y no `{ count, rows }`.

10. **`ESAVI-INVCOLD-004` — actualizar.** El bloque de almacenamiento y la exclusión del contenedor sobre el estado resultante, **antes del diff**; `buildDifferentialUpdate` con la tabla de `candidates` de §3.5; `investigationId` ignorado en silencio; `updatedAt` escrito por la aplicación.
    *Verificación:* reenviar íntegra la respuesta del `GET` responde 200 sin escribir nada; cambiar solo `notes` añade **una** entrada a `appDetails`; un `PUT` con `{ transportUsedColdPack: 'YES' }` sobre una fila con termo deja el termo en `'NO'`; un `PUT` con los dos contenedores en `'YES'` responde 400; cerrar el bloque de almacenamiento deja `storageRangeDeviation` en `null` sin error.

11. **`ESAVI-INVCOLD-005C` — borrado físico.** Ruta `/purge/:id` declarada antes de `/:id`, `assertRowIsSealed`, `purgeEntityService`, volcado al log en `warn`.
    *Verificación:* purgar una fila sin `deletedAt` devuelve **409**; con `deletedAt` sellado devuelve **200** sin `data`, y `src/logs/esaviLog.log` contiene la línea `warn` con `ESAVI-INVCOLD-005C` y el volcado de la fila.

12. **Arrastre del `deletedAt`.** Tres invocaciones de `satelliteCascade.service.ts` —dos de sellado y una de limpieza— en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, junto a las existentes. Volcado al log de la fila arrastrada en `ESAVI-INVESTGN-005C`.
    *Verificación:* `DELETE /api/investigations/:id` sella el `deletedAt` de la cadena de frío; `PATCH /api/investigations/activate/:id` lo limpia; `DELETE /api/esavi-cases/:id` lo sella también. Las suites de F29, F30, F32, F34, F36 y F37 siguen pasando sin tocar un caso.

13. **Alta en `ROUTE_RULES`.** Las siete rutas de §3.4 en `tests/auth/roles.test.ts`, con su rol mínimo y su código de operación.
    *Verificación:* `npm test -- roles` sale en 0 y falla si se comenta cualquiera de las siete filas.

14. **Suite de contrato.** `tests/contract/investigationColdChain.test.ts` con el recorrido completo, más los casos propios: alta vacía, duplicado, bloque de almacenamiento en `001` y `004`, los **tres** casos de la exclusión del contenedor, y los cinco criterios de update diferencial de §5.
    *Verificación:* `npm test` sale en 0.

15. **Ampliación de las suites del padre.** `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.
    *Verificación:* `npm run check` sale en 0.

**El caso de empate heredado se prueba sembrando la fila por SQL directo** dentro de la suite, con los dos contenedores en `'YES'`. Es la única forma de producirlo: ninguna operación de la API lo genera, y sin sembrarlo la rama de precedencia queda sin cubrir.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación —ruta, controlador, servicio, `AppError` y `appDetails.method`— coinciden en las siete operaciones. En `005C` son **cuatro**: no hay `appDetails.method` porque la fila se destruye.
- [ ] `grep -rn "ESAVI-INVCOLD-002[^AB]" src/` no devuelve resultados.
- [ ] `grep -rn "ESAVI-INVCOLD-005[AB]" src/` no devuelve resultados: esta entidad no tiene activación ni borrado lógico propio.
- [ ] `grep -rn "isActive" src/models/investigationColdChain.model.ts src/services/investigationColdChain.service.ts` solo devuelve las líneas del `where` del include de `investigation`.
- [ ] `references/CONVENTIONS.md` §6 lista `INVCOLD` en la tabla de abreviaturas y la operación `006` en la de no canónicas.
- [ ] `git diff --stat esaviapp.sql` está vacío: **este spec no toca el DDL en ninguna línea**.

**Alta y unicidad**

- [ ] `POST { investigationId }` de una investigación activa devuelve **201** con las quince columnas de datos en `null`.
- [ ] Repetir ese `POST` devuelve **409** `INVCOLD_001_ALREADY_EXISTS`, y sigue devolviéndolo cuando la fila existente tiene `deletedAt` sellado.
- [ ] `POST` sobre una investigación inactiva o inexistente devuelve **404** `INVCOLD_001_INVESTIGATION_NOT_FOUND`.

**Bloque de almacenamiento**

- [ ] `POST` con `storageRangeDeviation: true` y sin `storageTemperatureMonitored` devuelve **400** `INVCOLD_001_RANGE_DEVIATION_NOT_ALLOWED`.
- [ ] `POST` con `storageRangeDeviation: false` y `storageTemperatureMonitored: false` devuelve **400** con el mismo código: **`false` cuenta como valor**, no como ausencia.
- [ ] `POST` con `storageTemperatureMonitored: true` y `storageRangeDeviation: false` devuelve **201** y guarda `false`, no `null`.
- [ ] `PUT { storageTemperatureMonitored: false }` sobre una fila con `storageRangeDeviation: true` devuelve **200** y deja `storageRangeDeviation` en `null`, sin error.
- [ ] `PUT { storageTemperatureMonitored: false, storageRangeDeviation: true }` devuelve **400** `INVCOLD_004_RANGE_DEVIATION_NOT_ALLOWED`.
- [ ] `PUT { storageTemperatureMonitored: false, storageRangeDeviation: null }` devuelve **200**: mandarlo en `null` no es error.

**Exclusión del contenedor de transporte**

- [ ] **Conflicto:** `POST` o `PUT` con `transportUsedThermos: 'YES'` y `transportUsedColdPack: 'YES'` en el mismo body devuelve **400** `INVCOLD_<op>_TRANSPORT_CONTAINER_CONFLICT`.
- [ ] **Relevo:** `PUT { transportUsedColdPack: 'YES' }` sobre una fila con `transportUsedThermos: 'YES'` devuelve **200**, deja el termo en `'NO'` y la caja fría en `'YES'`.
- [ ] **Relevo simétrico:** `PUT { transportUsedThermos: 'YES' }` sobre una fila con `transportUsedColdPack: 'YES'` devuelve **200** y deja la caja fría en `'NO'`.
- [ ] **Empate heredado:** sobre una fila sembrada por SQL con los dos en `'YES'`, un `PUT { notes: 'x' }` devuelve **200**, deja `transportUsedThermos: 'YES'` y fuerza `transportUsedColdPack` a `'NO'`.
- [ ] Ninguna combinación sin dos `'YES'` fuerza nada: `PUT { transportUsedThermos: 'NO' }` sobre una fila con `transportUsedColdPack: 'YES'` deja la caja fría intacta.
- [ ] `transportSetInThermos`, `transportReturnedInThermos` y `transportTypeThermo` se guardan con los dos contenedores en `'NO'` y con los dos en `null`: **nunca se prohíben ni se fuerzan**.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationColdChain.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada. *En esta entidad el segundo caso no aplica —no hay `code` ni ninguna `UNIQUE`—; el primero se verifica con un `PUT` sobre una fila cuya investigación está inactiva, que responde **404** para USER y ADMIN.*
- [ ] Un `PUT` que cierra un bloque ya cerrado —`storageTemperatureMonitored: false` sobre una fila con `storageRangeDeviation` ya en `null`— **no escribe nada**: el forzado a `null` pasa por el diff como cualquier otro candidato.
- [ ] Un `PUT` que reenvía `transportUsedColdPack: 'NO'` sobre una fila que ya lo tenía en `'NO'` no escribe nada, aunque la regla de precedencia haya vuelto a calcularlo.
- [ ] `PUT { investigationId: '<otro uuid>' }` devuelve **200** sin escribir nada y sin 400: el campo se ignora en silencio.

**Visibilidad y lecturas**

- [ ] Una fila cuya investigación está inactiva devuelve **404** en `003`, `004` y `006` para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] `GET /` no la devuelve; `GET /admin` sí.
- [ ] Los filtros `investigationId` y `caseId` son acumulativos y por igualdad; con un UUID inexistente devuelven **200** con `{ count: 0, rows: [] }`.
- [ ] `006` devuelve el objeto, no `{ count, rows }`, y distingue los tres 404 con códigos distintos.

**Borrado físico y arrastre**

- [ ] `DELETE /purge/:id` sobre una fila sin `deletedAt` devuelve **409** `INVCOLD_005C_NOT_DELETED`.
- [ ] `DELETE /purge/:id` sobre una fila sellada devuelve **200** con `{ ok, message }` y **sin `data`**, y deja en `src/logs/esaviLog.log` una línea `warn` con el código de operación y el volcado de la fila.
- [ ] `ESAVI-INVESTGN-005A` y `ESAVI-CASE-005A` sellan el `deletedAt` de la cadena de frío; `ESAVI-INVESTGN-005B` lo limpia.
- [ ] `ESAVI-INVESTGN-005C` destruye la fila por cascada y deja su volcado en el log antes del `destroy` del padre.
- [ ] Las suites de contrato de F29, F30, F32, F34, F36 y F37 pasan sin modificar un solo caso.

**Cierre**

- [ ] Las trece claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] Las siete rutas están en `ROUTE_RULES` de `tests/auth/roles.test.ts`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la forma de la entidad**

- **Sí:** calcar la forma de F36 —PK que es FK, sin `isActive`, listado dual, `006` por caso, `005C` con `assertRowIsSealed`, arrastre por los tres caminos—. Es la octava satélite de `investigation` y la séptima con esta forma exacta; inventar una variante aquí solo añadiría un caso especial que el cliente tendría que aprender.
- **No:** añadir `isActive` a la tabla. Sería modificar el DDL para darle a un satélite un estado propio que su padre ya define. Es la decisión de F13 y F14, heredada sin reabrirse.
- **No:** `005A` ni `005B`. Sin `isActive` no hay estado que activar, y fabricarlo sobre `deletedAt` daría dos mecanismos de retirada para la misma fila.

**Sobre la asimetría de tipos**

- **Sí:** respetar el DDL y exponer `storageTemperatureMonitored` y `storageRangeDeviation` como `boolean` de tres estados, junto a ocho columnas `answerOption`. El modelo tiene que calzar con la tabla, y la asimetría es visible en el contrato porque es real en el esquema.
- **No:** traducir los dos booleanos a `answerOption` en la API. Introduciría una conversión que ninguna entidad del repositorio hace hoy, y obligaría a decidir a qué booleano corresponden `'UNKNOWN'`, `'NOT_APPLICABLE'` y `'NO_ANSWER'` — tres valores que un `boolean` no puede representar y que se perderían al guardar.
- **No:** cambiar las dos columnas a `answerOption` en el DDL. Toca esquema y datos ya cargados, y no es lo que este spec viene a resolver.
- **Sí:** tratar `false` como valor y no como ausencia, en el bloque y en el diff. Es el caso que §11 advierte explícitamente, y aquí no es teórico: «se monitorizó y no hubo desviación» es el hallazgo más frecuente del formulario.

**Sobre el bloque de almacenamiento**

- **Sí:** que `storageTemperatureMonitored` gobierne a `storageRangeDeviation`, con la forma de F34 y F36. No lo dice el DDL, pero registrar una desviación de rango que nadie pudo medir es un dato sin significado.
- **Sí:** que solo `true` abra. `false` es «no se monitorizó» y `null` es «no se sabe»: bajo ninguno de los dos hay medición de la que derivar una desviación.
- **No:** meter en el bloque las otras seis columnas de almacenamiento. `storageProcedureFollowed`, los cuatro hallazgos de la nevera y `storageKeyFindings` se observan sin termómetro. Ampliar el bloque las haría depender de una monitorización que no necesitan.
- **No:** añadir un `CHECK` al DDL que exprese el bloque. Un `CHECK` no distingue «el campo no aplica» de «el campo falta», que es justo la distinción que la asimetría `001`/`004` necesita. Es la misma razón por la que F36 dejó su regla de `:1144` en la aplicación.

**Sobre la exclusión del contenedor**

- **Sí:** que dos `'YES'` en el mismo body sean **400** y no una precedencia silenciosa. Es lo que evita el error en el cliente: si la aplicación eligiera por él, el formulario nunca aprendería que las dos preguntas son la misma.
- **Sí:** que en el relevo gane **el valor que viaja en el body** sobre el guardado. La alternativa —precedencia fija del termo también aquí— haría que un `PUT { transportUsedColdPack: 'YES' }` revirtiera en silencio el cambio que el cliente acaba de pedir, y obligaría a mandar siempre los dos campos para cambiar de contenedor.
- **Sí:** que en el empate heredado gane el **termo**, en silencio y sin error. Es el único sitio donde la precedencia declarada acaba aplicándose.
- **No:** devolver 400 en el empate heredado. Congelaría la fila: ningún `PUT` podría tocarla nunca, ni siquiera uno que solo cambia `notes`, y la única reparación posible sería SQL directo. Resolviéndolo en silencio la fila se arregla sola en su primer update.
- **No:** un `CHECK` en el DDL que prohíba los dos `'YES'`. Convertiría el empate heredado en una fila **imposible de guardar**, y las filas que ya lo tengan bloquearían la carga del propio `esaviapp.sql` en los tests.

**Sobre las tres columnas `*Thermos`**

- **Sí:** documentar que `transportSetInThermos`, `transportReturnedInThermos` y `transportTypeThermo` describen **el contenedor** —termo o caja fría— y no el termo. El formulario vigente unifica los dos, y esa unificación no está escrita en ninguna parte del repositorio hasta este spec.
- **Sí:** dejarlas **siempre abiertas**, fuera de todo bloque condicional. Si colgaran de `transportUsedThermos`, un traslado en caja fría no podría registrar ni cómo se colocó ni de qué tipo era el contenedor — que es exactamente el dato que el investigador tiene.
- **No:** renombrar las tres columnas a nombres neutros —`transportSetInContainer` y equivalentes—. El DDL es autoritativo, hay filas cargadas y el renombrado arrastraría al modelo, a los tipos, al validador, a la suite y a todo cliente existente. El coste no lo paga este spec.
- **No:** añadir columnas nuevas con nombre correcto y dejar las viejas en desuso. Duplicaría el dato y dejaría al lector futuro con dos candidatas y ninguna forma de saber cuál manda.
- **No:** gobernar las tres desde una bandera «se usó algún contenedor» calculada. Sería un derivado inventado que el esquema no tiene y que el formulario no pregunta.

**Sobre lo que este spec deliberadamente no hace**

- **Sí:** no tocar el DDL en ninguna línea. Es el primer spec de la serie de satélites que no lo modifica, y es una propiedad verificable: `git diff --stat esaviapp.sql` vacío.
- **No:** convertir `transportTypeThermo` en una FK a un catálogo de tipos de contenedor. Exigiría sembrar un `catalogType` —lo que F35 y F36 sí hicieron— y decidir una lista cerrada de tipos que el formulario no tiene. Mientras el dato entre como texto libre, guardarlo como texto libre es la lectura fiel.
- **No:** derivar una conclusión «cadena de frío comprometida» de las diez respuestas. Es un juicio de clasificación, no un dato de investigación, y cruza con `finalClassification`.
- **No:** resolver `storageDiluentNotUsable` contra `notificationDiluent` o `diluentCatalog`. Es una respuesta del formulario sobre lo que había en la nevera, no una referencia al diluyente registrado en la notificación. Atarlas exige antes decidir cuál manda, y eso es otro spec.
- **No:** filtrar el listado por campos de dominio. Sería el primer filtro de ese tipo del repositorio y abre la puerta a tableros; los dos filtros son los de F29, F32, F34 y F36.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Los nombres `*Thermos` inducen a error.** Un lector futuro leerá `transportSetInThermos` y supondrá que solo aplica al termo, y el siguiente cambio los colgará de `transportUsedThermos` «arreglando» un olvido que no existe | Documentado en §3.1 como hallazgo, en §6 como decisión y aquí. La suite de contrato incluye un caso explícito que los guarda con los dos contenedores en `'NO'`: colgarlos de la bandera rompería ese test |
| **El empate heredado no lo produce ninguna operación de la API**, así que su rama de precedencia queda sin ejercitar por el uso normal y puede pudrirse sin que nadie lo note | El paso 14 del plan lo prueba sembrando la fila por SQL directo dentro de la suite. Es el único camino que la cubre |
| **`false` tratado como ausencia.** Un `if( data.storageRangeDeviation )` escrito por costumbre descartaría en silencio el valor más frecuente del formulario | Tres criterios de §5 lo verifican por separado: en el `001`, en el `004` y en el diff. §11 lo declara norma |
| **La regla de transporte necesita saber si la clave viajó**, y es la única del repositorio que lo necesita. Un refactor que uniforme todo a «estado resultante» borraría la diferencia entre conflicto y relevo | §3.5 lo declara explícitamente y los tres casos tienen criterio de aceptación propio. Un refactor que los colapse deja dos tests en rojo |
| **`GET /:id` captura `/admin`, `/purge` o `/case` como UUID** | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por `ROUTE_RULES` |
| **Un `ESAVI-INVESTGN-005C` destruye esta fila sin aviso previo** | Decisión heredada de F13, F29, F30, F32, F34 y F36: se deja disparar la cascada, con el volcado al log en `warn` como única mitigación |

---

## Lo que **no** está en este spec

- **Las tres satélites de `investigation` que siguen sin spec:** `investigationCovidHistory`, `investigationAdministrationError` e `investigationCommunity`.
- **Cualquier regla cruzada** con `investigationVaccinationContext`, `investigationVaccineAdministered`, `notificationVaccine`, `notificationDiluent` o `diluentCatalog`.
- **Renombrar las tres columnas `*Thermos`** ni añadir equivalentes con nombre neutro.
- **Convertir `transportTypeThermo` en un catálogo.**
- **Derivar una conclusión** «cadena de frío comprometida» de las diez respuestas.
- **Filtrar, contar o agregar** por cualquier campo de dominio.
- **Búsqueda por texto** sobre los cuatro campos libres.
- **Modificar `esaviapp.sql`** en ninguna línea.
- **Modificar `satelliteCascade.service.ts`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.**
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.**
- **Exponer o editar `sysDetails`.**

Cada uno de esos, si aterriza, va en su propio spec.
