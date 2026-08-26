# SPEC F41 — CRUD completo de `finalClassification`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F06 (`esaviCase` — dependencia dura: `caseId` es `NOT NULL` y es el único padre de esta tabla)**, **SPEC F09 (`classification` — gemela de forma: PK propia, `UNIQUE ("caseId")`, FK a `catalogItem` validada por `catalogType`, `006` por caso y cascada de `ESAVI-CASE-005A`; además le reservó de palabra la abreviatura `FINCLASS`)**, SPEC F07 (mecanismo de cascada de `ESAVI-CASE-005A`, al que esta entidad se suma), SPEC F08 (operación `005C`), SPEC F12 (update diferencial), **SPEC F34 y SPEC F36 (aportan la asimetría `001`/`004` del bloque condicional y la precedencia entre reglas)**, SPEC F40 (aporta la evaluación sobre el estado resultante)
> **Fecha:** 2026-08-25
> **Objetivo:** Dar de alta `finalClassification` —el veredicto de causalidad del algoritmo OMS/OPS sobre un caso ESAVI— con sus siete artefactos, sus siete operaciones canónicas más el borrado físico y el acceso por caso, cerrando el último de los cinco satélites de `esaviCase` que quedaba sin spec.

---

## 1. Por qué existe este spec

`finalClassification` es la **quinta y última** tabla satélite de `esaviCase` que recibe spec, tras `notifier` (F07), `classification` (F09), `notification` (F10) e `investigation` (F28). Guarda el final del circuito de vigilancia: cuando el caso ya está notificado, clasificado por gravedad e investigado, alguien tiene que decir **a qué se debió**. Eso es esta tabla, y sin ella el expediente queda abierto para siempre.

Hoy la tabla existe en `esaviapp.sql:1260-1286` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**Sus ocho booleanos son el algoritmo de causalidad de la OMS/OPS**, y por eso no son ocho campos sueltos sino cuatro bloques:

| Bloque | Columnas | Qué afirma |
|---|---|---|
| **A** — relacionado con la vacunación | `aIsRelatedToVaccineProduct`, `aIsRelatedToQualityDeviation`, `aIsRelatedToProgrammaticError`, `aIsRelatedToStress` | el evento se atribuye al producto, a una desviación de calidad, a un error programático o a la ansiedad del acto |
| **B** — indeterminado | `bIsConsistentTemporalRelation`, `bHasDeterminantFactor` | hay relación temporal consistente, o un factor determinante, pero la evidencia no basta |
| **C** — coincidente | `cHasCoincidentCause` | el evento tiene otra causa y coincidió en el tiempo |
| **D** — inclasificable | `dIsUnclassifiable` | no hay información suficiente para decir nada |

**No es una satélite de `investigation`, y eso la aparta de las trece specs anteriores.** F28 a F40 comparten una forma que aquí **no aplica en ningún punto**: PK que es FK, ausencia de `isActive`, listado dual heredado del padre, arrastre de `deletedAt` por `satelliteCascade.service.ts`. `finalClassification` cuelga de `esaviCase` directamente, tiene PK propia y tiene `isActive`. **Su gemela de forma es F09**, y este spec la calca en cuatro puntos:

- **PK propia.** `finalClassificationId uuid PRIMARY KEY DEFAULT gen_random_uuid()` (`:1261`). El `:id` de las rutas **no** es el `caseId`, y por eso la operación `006` por caso tiene sentido propio: el cliente tiene el caso, no el UUID de la clasificación final.
- **Uno a uno declarado en el DDL.** `UQ_finalClassification_case` (`:1285`), exactamente como `UQ_classification_case`. Crear la segunda es 409, y el hueco **no se libera** con un `isActive: false`.
- **Tiene `isActive`** (`:1275`), así que tiene `005A` y `005B` —las dos operaciones que las trece specs anteriores no tenían— además de `005C`.
- **Entra en la cascada de `ESAVI-CASE-005A`** que construyó F07 y a la que F09, F10 y F28 se sumaron. Es la **cuarta y última** invocación que se añade a ese punto de `src/services/esaviCase.service.ts`.

**Lo nuevo, y es lo que hace que el spec no sea un calco de F09.** Tres cosas:

**A — Los tres `importance*ItemId` son un orden de prelación, no tres campos independientes.** `importanceAItemId`, `importanceBItemId` e `importanceCItemId` (`:1263-1265`) apuntan los tres al **mismo** `catalogType` —`finalClassificationImportance`, sembrado con tres items de `code` y `value` `1`, `2` y `3`— y **no pueden repetir valor entre sí**. Tres ranuras, tres valores posibles, todos distintos: el clasificador no marca tres cosas sueltas, **ordena los bloques A, B y C por fuerza de evidencia**. Ninguna entidad del repositorio tenía hasta hoy una regla de unicidad *entre columnas de la misma fila*.

**B — `dIsUnclassifiable` es una bandera que cierra las otras diez columnas.** Es el primer bloque condicional del repositorio cuya bandera **prohíbe** en vez de habilitar: F34, F36, F38, F39 y F40 tenían todos una bandera que **abría** un bloque de campos, y aquí `dIsUnclassifiable: true` los **cierra**. La mecánica es la misma —asimetría `001`/`004`, forzado a `null` como derivado condicional en el update— pero la polaridad está invertida, y eso es exactamente lo que un implementador que venga de F40 va a leer al revés.

**C — Es la primera entidad ESAVI sin una sola validación en la base.** La tabla no tiene **ningún `CHECK`**, **ningún índice propio** y **ningún trigger de negocio**. F09 tenía al menos el `CHECK ("age" >= 0)` como última línea de defensa; aquí no hay ninguna. **Todo el contrato vive en el servicio y en el validador**, y si el spec no lo escribe, no lo escribe nadie.

**Y una ausencia que la separa de F09:** aquí **no hay ningún campo calculado**. F09 derivaba `age` y `ageUnitItemId` de dos fechas, e `isSeriousEvent` de nueve booleanos. En `finalClassification` **no se deriva nada a partir de otra tabla**: los doce campos de datos vienen del cliente, y toda la complejidad está en la coherencia entre ellos. Un juicio de causalidad no se calcula.

**El `ON DELETE CASCADE` de `FK_finalClassification_case` (`:1281`) nunca dispara.** `esaviCase` sí figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1372-1386`), así que no hay borrado físico del padre que pueda arrastrar esta fila. La integridad del ciclo de vida la sostiene solo la cascada de aplicación de F07. En sentido contrario, `finalClassification` **no** está en ese bucle, así que un `DELETE` físico sobre ella ejecuta y le corresponde la operación `005C` de F08.

**Es hoja del grafo:** `grep 'REFERENCES "finalClassification"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

**Triggers.** Solo `TRG_finalClassification_setSysDetails`, del bucle genérico de `esaviapp.sql:1291-1306`. No existe `TRG_finalClassification_setUpdatedAt` —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación. Tampoco figura en `setSortOrderByParent`: no tiene `sortOrder`.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `finalClassification`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Nueve operaciones:** las siete canónicas —`001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar—, más `005C` borrado físico y la no canónica **`006` obtener por caso**. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **`005A` y `005B` sí existen**, porque la tabla tiene `isActive` propio (`:1275`). Es la primera entidad con activación desde F26, y la aparta de las trece specs de satélites de `investigation`. Van por `setEntityActiveStatusService`, sin lógica propia.
- **`005C`** le corresponde por no figurar `finalClassification` en el bucle `preventPhysicalDelete` (`esaviapp.sql:1372-1386`). Las reglas transversales las fija el SPEC F08; aquí solo se declara la ruta y las claves de la entidad. Sin volcado de cascada: la tabla es hoja del grafo.
- **Listado dual `002A` / `002B`** sobre el `isActive` **propio** de la fila, no heredado de nadie: `GET /` para USER devuelve solo las activas, `GET /admin` para ADMIN las devuelve todas. Es el patrón de F09, no el de F28-F40.
- Relación **uno a uno** con `esaviCase`, sostenida por `UQ_finalClassification_case` (`:1285`). Crear la segunda clasificación final de un caso devuelve **409**, y el hueco **no se libera** cuando la existente está inactiva: para clasificar de nuevo hay que reactivar la anterior o purgarla.
- **Guardas del alta**, en este orden: el caso existe y está **activo** → 404 `FINCLASS_001_CASE_NOT_FOUND`; ese caso **no tiene ya clasificación final**, buscando **sin filtrar por `isActive`** → 409 `FINCLASS_001_CASE_ALREADY_FINAL_CLASSIFIED`, con `{{caseId}}` en el mensaje.
- **La única precondición del alta es el caso.** No se exige que exista `classification`, ni `notification`, ni `investigation`. El DDL no declara ninguna FK a esas tablas y este spec no inventa la que no hay.
- **Alta vacía.** Las doce columnas de datos son anulables: `POST { caseId }` devuelve **201** con las doce en `null`. La fila se abre como veredicto pendiente y se completa por `PUT`. Es el patrón de F09.
- **`caseId` obligatorio en el alta e inmutable en el `004`:** se ignora en silencio si llega, sin 400. Una clasificación final no se traslada entre casos.
- **Tri-estado en los ocho booleanos.** Lo que no llega se guarda `null`, **nunca `false`**: hay que poder distinguir «este bloque se evaluó y se descartó» de «este bloque no se evaluó». A diferencia de F09 —que tuvo que modificar el DDL para conseguirlo—, aquí las ocho columnas **ya son nulables** (`:1266-1273`) y **este spec no toca `esaviapp.sql` en ninguna línea**.
- **Los tres `importance*ItemId` contra un único `catalogType`.** Los tres se validan contra el catálogo de código **`finalClassificationImportance`**: el `catalogItem` debe existir, estar activo y pertenecer a ese tipo → si no, **404** `FINCLASS_<op>_IMPORTANCE_NOT_FOUND`. Es el mecanismo de `assertAgeUnitIsValid` de F09 (`src/services/classification.service.ts:155`), aplicado tres veces.
- **Regla de prelación: los tres `importance*ItemId` no pueden repetir valor.** Se comparan **solo los que tengan valor**: `A=1, B=2, C=null` es válido; `A=1, B=1, C=null` es **400** `FINCLASS_<op>_IMPORTANCE_DUPLICATED`. Los tres siguen siendo independientemente anulables, así que el alta vacía y el `PUT` parcial se conservan. **Es la primera regla de unicidad entre columnas de la misma fila del repositorio.**
- **La regla de prelación se evalúa sobre el estado resultante, no sobre el body.** Un `PUT { notes: 'x' }` sobre una fila con `A=1, B=2` **no** falla; un `PUT { importanceBItemId: <el item que A ya tiene> }` **sí** falla, aunque `importanceAItemId` no viaje. Es la norma de F40.
- **El bloque D — `dIsUnclassifiable` cierra las otras diez columnas.** Con `dIsUnclassifiable: true`, los siete booleanos restantes y los tres `importance*ItemId` están **prohibidos**, con la asimetría `001`/`004` de F34, F36, F38 y F40:
  - **`001` — es 400.** Mandar cualquiera de los diez con valor —incluido un `false` en un booleano— junto a `dIsUnclassifiable: true` es `FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`.
  - **`004` — depende de si el cliente los manda.** Los que **no viajan** se **fuerzan a `null`**: marcar D limpia el veredicto anterior sin pedir permiso ni devolver error. Los que **viajan con valor** producen 400 `FINCLASS_004_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`. Mandarlos explícitamente en `null` **no** es error.
  - **`false` cuenta como valor y no como ausencia.** Un `aIsRelatedToStress: false` junto a `dIsUnclassifiable: true` es 400: afirma que el bloque A se evaluó, y D dice que no se pudo evaluar nada.
- **La bandera de este bloque cierra, no abre.** Es la polaridad inversa de F34, F36, F38, F39 y F40, y §6 la razona. `dIsUnclassifiable` en `false` o en `null` deja las diez columnas completamente libres.
- **La prohibición de D corre antes que la regla de prelación.** Un body con `dIsUnclassifiable: true` y `importanceAItemId` recibe `UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`, nunca `IMPORTANCE_DUPLICATED`. Es la precedencia que fijó F36: el error que se devuelve es el del problema de fuera, no el del de dentro.
- **Los booleanos de un bloque y su `importance*` son independientes.** `importanceAItemId` con valor **no** exige que ninguno de los cuatro `aIsRelatedTo*` sea `true`, ni al revés. Son dos ejes: los booleanos dicen **qué** se marcó, los `importance*` dicen **en qué orden de fuerza**. Ninguna validación cruzada entre ellos.
- **Ningún campo calculado, y ninguna dependencia de lectura transitiva.** A diferencia de F09, esta entidad no deriva nada de `patient` ni de `esaviCase`: las doce columnas de datos vienen del cliente. Un juicio de causalidad no se calcula.
- **Normalización al escribir:** `.trim()` sobre `notes`, la única columna de texto, **sin tope de longitud** —es `text` en el DDL—. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`, y no hay ninguna clave `codeExists`.
- **Ningún campo cifrado.** La tabla no contiene datos identificativos: un veredicto de causalidad no identifica a nadie, y el paciente ya está cifrado en su propia tabla. Es la posición de F09.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Suma a la cascada de F07:** `ESAVI-CASE-005A` desactiva también la clasificación final activa del caso, en la misma transacción y en el mismo punto de `src/services/esaviCase.service.ts`, junto a las de `notifier`, `classification`, `notification` e `investigation`. **Es la cuarta y última invocación que se añade a ese punto.** La cascada sigue siendo **solo de bajada**: `ESAVI-CASE-005B` no reactiva nada.
- **Un solo filtro en el listado:** `caseId`, por igualdad, UUID. Orden por defecto `createdAt DESC`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`.
- **Forma de la respuesta con las FK resueltas**, calcando el `DETAIL_EXCLUDE` de F09 (`src/services/classification.service.ts:40`): se excluyen `caseId`, `importanceAItemId`, `importanceBItemId` e `importanceCItemId`, y en su lugar viajan los objetos `case`, `importanceA`, `importanceB` e `importanceC`.
- Alta de la abreviatura **`FINCLASS`** en `references/CONVENTIONS.md` §6. **F09 la dejó reservada de palabra precisamente para este spec**, y aquí se registra.
- Claves i18n nuevas en `es`, `en` y `nl`.
- **Nueve filas nuevas en `ROUTE_RULES`** de `tests/auth/roles.test.ts`, suite `tests/contract/finalClassification.test.ts`, y ampliación de `tests/contract/esaviCase.test.ts` con la cascada.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F06** debe estar `Implementado`. `caseId` es `NOT NULL` y el alta lo valida contra `esaviCase`.
- **El `catalogType` de código `finalClassificationImportance` debe estar sembrado**, con tres `catalogItem` de `code` y `value` `1`, `2` y `3`. Es precondición igual que el `ageUnit` de F09: **sin ese catálogo, todo alta que informe un `importance*` devuelve 404**, aunque el alta vacía siga funcionando. La carga se hace por los endpoints ya existentes de `catalogType` y `catalogItem`, o por la importación masiva de F20.

**Fuera de alcance (otros specs):**

- **Sembrar el `catalogType` `finalClassificationImportance` y sus tres items.** Es precondición, no parte de la implementación.
- **Exigir que el caso tenga `classification`, `notification` o `investigation`** antes de clasificarlo en firme. Es una regla de proceso plausible —el veredicto normalmente llega después de investigar— pero el DDL no declara ninguna de esas dependencias, y convertirla en 409 bloquearía la clasificación de casos que se cierran sin investigación.
- **Derivar el veredicto automáticamente** de los datos de la investigación, de `classification.isSeriousEvent` o de cualquier otra tabla. La causalidad la decide una persona.
- **Crear la clasificación final automáticamente al dar de alta un `esaviCase`**, o al cerrar su investigación.
- **Versionar o historiar el veredicto.** Que un caso se reclasifique y quede constancia de los dos juicios exigiría una tabla de historial que el esquema no tiene; hoy el rastro está en `appDetails`.
- **Validar la coherencia entre los booleanos de bloques distintos.** Marcar a la vez `aIsRelatedToVaccineProduct: true` y `cHasCoincidentCause: true` es contradictorio en el algoritmo OMS, pero el DDL no lo impide y este spec **solo** declara la exclusión de D, que es la que se pidió. §6 razona por qué no se extiende a A/B/C.
- **Atar los `importance*` a los booleanos de su bloque.**
- **Cualquier endpoint de estadística, conteo por bloque de causalidad o exportación.**
- **Filtrar, contar o agregar por cualquier campo de dominio.** El único filtro del listado es `caseId`.
- **Bloquear la desactivación de un caso porque tenga clasificación final**, o cualquier otra regla que ate el ciclo de vida del caso al contenido del veredicto.
- **Extender la cascada de `ESAVI-CASE-005B` hacia arriba** para que reactivar un caso reactive sus satélites. Sigue pendiente desde F07 y afectaría a las cinco entidades a la vez.
- **Cifrado de ningún campo.**
- **Modificar `esaviapp.sql`.** Ni añadir los `CHECK` que la tabla no tiene, ni un índice, ni un `UNIQUE` parcial que libere el `caseId` de una fila inactiva, ni meter `finalClassification` en `preventPhysicalDelete`. **Este spec no toca el DDL en ninguna línea.**
- **Modificar `setEntityActiveStatusService`, `purgeEntityService` ni `buildDifferentialUpdate`.** Los tres se consumen tal cual están.
- **Cambiar el comportamiento de F07, F09, F10 ni F28.** Este spec solo añade una invocación junto a las suyas; sus suites de contrato deben pasar sin tocar un solo caso.
- **`investigationCovidHistory`**, la única tabla del esquema que seguirá sin spec después de éste.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`finalClassification` — `esaviapp.sql:1260-1286`. **La tabla no se altera, y este spec no añade una sola línea al DDL.**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `finalClassificationId` | `uuid` | no | `:1261`. **PK propia**, `DEFAULT gen_random_uuid()` |
| `caseId` | `uuid` | **no** | `:1262`. `FK_finalClassification_case` → `esaviCase`, `ON DELETE CASCADE` (`:1281`). **`UQ_finalClassification_case` UNIQUE** (`:1285`): uno a uno |
| `importanceAItemId` | `uuid` | sí | `:1263`. → `catalogItem`, `ON DELETE RESTRICT` (`:1282`). Prelación del bloque A |
| `importanceBItemId` | `uuid` | sí | `:1264`. → `catalogItem`, `ON DELETE RESTRICT` (`:1283`). Prelación del bloque B |
| `importanceCItemId` | `uuid` | sí | `:1265`. → `catalogItem`, `ON DELETE RESTRICT` (`:1284`). Prelación del bloque C |
| `aIsRelatedToVaccineProduct` | `boolean` | sí | `:1266`. Bloque A, tri-estado |
| `aIsRelatedToQualityDeviation` | `boolean` | sí | `:1267`. Bloque A, tri-estado |
| `aIsRelatedToProgrammaticError` | `boolean` | sí | `:1268`. Bloque A, tri-estado |
| `aIsRelatedToStress` | `boolean` | sí | `:1269`. Bloque A, tri-estado |
| `bIsConsistentTemporalRelation` | `boolean` | sí | `:1270`. Bloque B, tri-estado |
| `bHasDeterminantFactor` | `boolean` | sí | `:1271`. Bloque B, tri-estado |
| `cHasCoincidentCause` | `boolean` | sí | `:1272`. Bloque C, tri-estado |
| `dIsUnclassifiable` | `boolean` | sí | `:1273`. **Bloque D — la bandera que cierra las otras diez columnas**, tri-estado |
| `notes` | `text` | sí | `:1274`. Texto libre, siempre abierto |

**Doce columnas de datos, las doce anulables.** Solo `caseId` es `NOT NULL`, y de ahí sale directamente el alta vacía de §2.

**Restricciones.** **Cuatro claves foráneas** —el caso y las tres de catálogo—, **una `UNIQUE`** —`UQ_finalClassification_case`—, **ningún `CHECK`** y **ningún índice declarado** más allá de los que Postgres crea de oficio para la PK y la `UNIQUE`.

**Ningún `CHECK`, y esto no es un detalle.** F09 tenía al menos el `CHECK ("age" >= 0)` como última línea de defensa contra un cálculo roto. Aquí **no hay ninguna validación en la base**: ni de rango, ni de exclusión entre bloques, ni de unicidad entre los tres `importance*`. Todo el contrato de esta tabla vive en el validador y en el servicio, y lo que este spec no escriba no lo escribe nadie.

**No hace falta añadir ningún índice.** El acceso por `caseId` —que es el de la operación `006` y el del único filtro del listado— se apoya en el índice único que Postgres crea de oficio para `UQ_finalClassification_case`, que sirve exactamente igual para la igualdad. Es la misma situación de F09.

Las columnas transversales están completas: `isActive` (`:1275`), `createdAt` (`:1276`), `updatedAt` (`:1277`), `deletedAt` (`:1278`), `sysDetails` (`:1279`) y `appDetails` (`:1280`). **`isActive` está presente**, a diferencia de las diez satélites de `investigation` de F29 a F40.

#### Los cuatro bloques, y qué columna pertenece a cuál

| Bloque | Columnas booleanas | Su `importance*` |
|---|---|---|
| **A** — relacionado con la vacunación | `aIsRelatedToVaccineProduct`, `aIsRelatedToQualityDeviation`, `aIsRelatedToProgrammaticError`, `aIsRelatedToStress` | `importanceAItemId` |
| **B** — indeterminado | `bIsConsistentTemporalRelation`, `bHasDeterminantFactor` | `importanceBItemId` |
| **C** — coincidente | `cHasCoincidentCause` | `importanceCItemId` |
| **D** — inclasificable | `dIsUnclassifiable` | **ninguno** |

**El prefijo de la columna es la única señal del bloque, y el DDL no dice nada más.** No hay comentarios en el esquema de esta tabla —a diferencia de F40, que tenía uno—, así que **todas las reglas de §3.5 son decisiones de este spec y no lecturas del DDL**. Que D no tenga `importance*` propio es coherente: no se ordena por fuerza lo que no se pudo evaluar.

**Triggers.** Solo `TRG_finalClassification_setSysDetails`, del bucle genérico de `esaviapp.sql:1291-1306`. **No existe `TRG_finalClassification_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea—, así que `updatedAt` lo escribe la aplicación. La tabla **no** figura en el bucle `preventPhysicalDelete` (`:1372-1386`), así que un `DELETE` físico ejecuta y le corresponde `005C`. Tampoco figura en `setSortOrderByParent`.

**Hoja del grafo.** `grep 'REFERENCES "finalClassification"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

**El `ON DELETE CASCADE` de `:1281` nunca dispara**, porque `esaviCase` **sí** está protegida por `preventPhysicalDelete`. Es la situación que F07 y F09 ya describieron: la cascada declarada es letra muerta y el ciclo de vida lo sostiene la aplicación.

### 3.2 Modelo Sequelize

Archivo: `src/models/finalClassification.model.ts`. Clase `FinalClassification`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'finalClassification'`. PK `finalClassificationId` **con** `defaultValue: sequelize.literal('gen_random_uuid()')` — al contrario que las diez satélites de `investigation`, aquí la PK **no** es la FK y el cliente no la aporta.

`caseId` va `allowNull: false`, calcando el DDL; **todo lo demás va `allowNull: true`**.

Los ocho booleanos van `DataTypes.BOOLEAN` **sin `defaultValue`**. Es la decisión de F09 y por la misma razón: declarar `defaultValue: false` convertiría el tri-estado en dos estados y borraría la distinción entre «este bloque se descartó» y «este bloque no se evaluó», que es justo lo que §2 preserva. Aquí sale gratis, porque el DDL ya los tiene nulables.

`notes` va `DataTypes.TEXT`, **sin longitud**: es `text` en el DDL.

Asociaciones, en `src/models/associations/finalClassification.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `FinalClassification.belongsTo(EsaviCase, { as: 'case', foreignKey: 'caseId' })`
- `FinalClassification.belongsTo(CatalogItem, { as: 'importanceA', foreignKey: 'importanceAItemId' })`
- `FinalClassification.belongsTo(CatalogItem, { as: 'importanceB', foreignKey: 'importanceBItemId' })`
- `FinalClassification.belongsTo(CatalogItem, { as: 'importanceC', foreignKey: 'importanceCItemId' })`
- `EsaviCase.hasOne(FinalClassification, { as: 'finalClassification', foreignKey: 'caseId' })` — **`hasOne` y no `hasMany`**, porque `UQ_finalClassification_case` lo impone. El alias `finalClassification` no colisiona con `notifiers` (F07), `classification` (F09), `notification` (F10) ni `investigation` (F28).

**Cinco asociaciones, y tres de ellas son al mismo modelo con alias distintos.** Es la primera entidad del repositorio con tres `belongsTo` a `catalogItem`; el alias es lo único que las separa y tiene que coincidir exactamente con el nombre del include de §3.7.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `finalClassification` **no se añade a ninguna respuesta de `esaviCase`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consume la cascada de §3.5.

### 3.3 Tipos

`src/types/finalClassification/finalClassification.types.ts`, con su `index.ts` de barrel, siguiendo la estructura por entidad de `src/types/classification/`:

```ts
export interface CreateFinalClassificationInput {
    caseId: string;
    importanceAItemId?: string | null;
    importanceBItemId?: string | null;
    importanceCItemId?: string | null;
    aIsRelatedToVaccineProduct?: boolean | null;
    aIsRelatedToQualityDeviation?: boolean | null;
    aIsRelatedToProgrammaticError?: boolean | null;
    aIsRelatedToStress?: boolean | null;
    bIsConsistentTemporalRelation?: boolean | null;
    bHasDeterminantFactor?: boolean | null;
    cHasCoincidentCause?: boolean | null;
    dIsUnclassifiable?: boolean | null;
    notes?: string | null;
}
```

**`caseId` es el único campo obligatorio del tipo.** Los doce restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo. En los booleanos es además lo que sostiene el tri-estado en el contrato HTTP, no solo en la base.

El update usa `Partial<CreateFinalClassificationInput>`. **No se declara `UpdateFinalClassificationInput`.** `caseId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Dos constantes locales del servicio, para que el forzado a `null` y la regla de prelación se escriban una sola vez:

```ts
const IMPORTANCE_CATALOG_CODE = 'finalClassificationImportance';

const IMPORTANCE_FIELDS = [
    'importanceAItemId',
    'importanceBItemId',
    'importanceCItemId',
] as const;

const UNCLASSIFIABLE_FORBIDDEN_FIELDS = [
    ...IMPORTANCE_FIELDS,
    'aIsRelatedToVaccineProduct',
    'aIsRelatedToQualityDeviation',
    'aIsRelatedToProgrammaticError',
    'aIsRelatedToStress',
    'bIsConsistentTemporalRelation',
    'bHasDeterminantFactor',
    'cHasCoincidentCause',
] as const;
```

`IMPORTANCE_CATALOG_CODE` calca el `AGE_UNIT_CATALOG_CODE` de `src/services/classification.service.ts:22`. **Los tres arrays son locales del servicio**, no van a `src/constants/`: solo los consume este archivo, igual que F27, F32, F34, F36, F38, F39 y F40 mantuvieron locales sus listas.

**`UNCLASSIFIABLE_FORBIDDEN_FIELDS` son diez y no once:** `dIsUnclassifiable` **no** está en la lista. Es la bandera, no un campo prohibido, y ponerla dentro haría que marcarla se prohibiera a sí misma.

### 3.4 Superficie HTTP

```
POST   /api/final-classifications                ESAVI-FINCLASS-001   USER        (nuevo)
GET    /api/final-classifications                ESAVI-FINCLASS-002A  USER        (nuevo)
GET    /api/final-classifications/admin          ESAVI-FINCLASS-002B  ADMIN       (nuevo)
GET    /api/final-classifications/case/:caseId   ESAVI-FINCLASS-006   USER        (nuevo)
GET    /api/final-classifications/:id            ESAVI-FINCLASS-003   USER        (nuevo)
PUT    /api/final-classifications/:id            ESAVI-FINCLASS-004   USER        (nuevo)
DELETE /api/final-classifications/:id            ESAVI-FINCLASS-005A  ADMIN       (nuevo)
PATCH  /api/final-classifications/activate/:id   ESAVI-FINCLASS-005B  SUPERADMIN  (nuevo)
DELETE /api/final-classifications/purge/:id      ESAVI-FINCLASS-005C  SUPERADMIN  (nuevo)
```

**Nueve rutas, y `:id` es el `finalClassificationId`, no el `caseId`.** Ésa es la diferencia con las diez satélites de `investigation`, donde los dos coincidían, y la razón de que `006` no sea redundante con `003`: el cliente tiene el caso en la mano y el UUID de la clasificación final no lo ha visto nunca.

Orden de declaración en `src/routes/finalClassification.routes.ts`: las rutas con prefijo literal (`/admin`, `/case/:caseId`, `/activate/:id`, `/purge/:id`) van **antes** de `/:id`, o Express capturará `admin`, `case`, `activate` y `purge` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14 y F28 a F40, y por la misma razón: el veredicto se captura en el mismo flujo operativo que el caso. `005A` se queda en **ADMIN**, y `005B` y `005C` en **SUPERADMIN**.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`finalClassification` · `006` · obtener la clasificación final de un caso — la relación es uno a uno y se entra por el `caseId`**.

**La abreviatura es `FINCLASS`.** Ocho letras, reservada de palabra por F09 §2 y registrada aquí. No colisiona con `CLASSIF`, y `grep "ESAVI-FINCLASS-"` no se cruza con `ESAVI-CLASSIF-` ni con ninguna de las treinta y cuatro restantes.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

Las dos reglas de coherencia miran el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resulting(campo) = data[campo] !== undefined ? (data[campo] ?? null) : stored[campo]
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**La distinción por presencia sí hace falta, y solo en un sitio:** la asimetría `001`/`004` del bloque D. La regla de prelación **no** la usa: mira únicamente el resultante.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `caseId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| Los tres `importance*ItemId` con formato UUID, admitiendo `null` | validador | 400 `common.validationError` |
| Los ocho booleanos con `.isBoolean()`, admitiendo `null` | validador | 400 `common.validationError` |
| `notes` como cadena, **sin tope de longitud** | validador | 400 `common.validationError` |
| El caso existe y está activo (`001`) | **servicio** | 404 `FINCLASS_001_CASE_NOT_FOUND` |
| El caso no tiene ya clasificación final (`001`) | **servicio** | 409 `FINCLASS_001_CASE_ALREADY_FINAL_CLASSIFIED` |
| Cada `importance*ItemId` existe, está activo y es del `catalogType` `finalClassificationImportance` | **servicio** | 404 `FINCLASS_<op>_IMPORTANCE_NOT_FOUND` |
| Algún campo prohibido con valor y `dIsUnclassifiable` resultante en `true` | **servicio** | 400 `FINCLASS_<op>_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED` |
| Dos `importance*` resultantes con el mismo `catalogItemId` | **servicio** | 400 `FINCLASS_<op>_IMPORTANCE_DUPLICATED` |

**Ninguna de las cinco reglas de negocio cabe en el validador**, porque las cinco dependen de la base de datos o del estado guardado. Es la consecuencia directa de que la tabla no tenga un solo `CHECK`: el validador aquí solo comprueba formas.

#### Orden de evaluación — es fijo y son cuatro pasos

1. **Existencia** — el caso en el `001`, la fila en el `004`.
2. **La prohibición de D.**
3. **La regla de prelación.**
4. **La validación de las tres FK de catálogo.**

**La prohibición de D corre antes que la regla de prelación**, y ésa es la precedencia que fijó F36: el error que se devuelve es el del problema de fuera, no el del de dentro. Un body con `dIsUnclassifiable: true`, `importanceAItemId: <item 1>` e `importanceBItemId: <item 1>` recibe `UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`, **nunca** `IMPORTANCE_DUPLICATED`.

**La validación de catálogo va la última**, después del forzado a `null` del `004`: no tiene sentido resolver contra `catalogItem` tres UUID que el paso 2 acaba de descartar. Es una consulta que se ahorra y un 404 que nunca se emite por un campo que no se va a guardar.

#### El bloque D — la bandera que cierra

**Solo `dIsUnclassifiable` resultante en `true` cierra el bloque.** `false` y `null` lo dejan abierto, y con el bloque abierto **las diez columnas están completamente libres**: ninguna regla las alcanza salvo la de prelación.

**Es la polaridad inversa de todo el repositorio.** F34, F36, F38, F39 y F40 tienen banderas que **abren** un bloque de campos permitidos; ésta lo **cierra**. La mecánica —asimetría `001`/`004`, forzado a `null` como derivado condicional— es idéntica, pero leerla por analogía da el resultado contrario. §6 razona por qué la polaridad es ésta y no la otra.

**Con `dIsUnclassifiable: true`**, los diez campos de `UNCLASSIFIABLE_FORBIDDEN_FIELDS` están prohibidos, con la asimetría de F34, F36, F38, F39 y F40:

- **`001` — es 400.** Mandar cualquiera de los diez con valor es `FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente los manda.** Los que **no viajan** se **fuerzan a `null`**: marcar D limpia el veredicto anterior sin pedir permiso ni devolver error. Los que **viajan con valor** producen 400 `FINCLASS_004_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`. Mandarlos en `null` **no** es error: es el mismo destino al que el forzado llega solo.

**`false` cuenta como valor y no como ausencia.** Un `POST { dIsUnclassifiable: true, aIsRelatedToStress: false }` es **400**, no 201. Ese `false` afirma que el bloque A se evaluó y se descartó, y D dice que no se pudo evaluar nada: son dos afirmaciones incompatibles, y la comprobación tiene que ser `!== undefined && !== null`, nunca un `if( data.aIsRelatedToStress )` que trataría el `false` como si no hubiera llegado.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** los diez campos entran en `candidates` **siempre** que D esté activo, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difieren. Si la fila ya los tenía en `null`, el diff no encuentra nada y **no se escribe**: marcar D sobre una fila ya inclasificable no crece `appDetails`.

#### La regla de prelación — los tres `importance*` no repiten

**Se comparan solo los que tengan valor resultante.** Los `null` no participan: `A=1, B=2, C=null` es válido, `A=1, C=3, B=null` también, y una fila con los tres en `null` también. Dos o tres con el **mismo `catalogItemId`** son **400** `FINCLASS_<op>_IMPORTANCE_DUPLICATED`.

**No se exige que las tres viajen juntas, ni que estén completas.** Un veredicto puede ordenar dos bloques y dejar el tercero sin evaluar, y exigir el trío convertiría todo `PUT` parcial en un 400 — justo lo que el update diferencial de F12 vino a evitar.

**Se evalúa sobre el estado resultante.** Un `PUT { notes: 'x' }` sobre una fila con `A=1, B=2` **no** falla. Un `PUT { importanceBItemId: <el item que A ya tiene> }` **sí** falla, aunque `importanceAItemId` no viaje en el body: la fila resultante tendría dos ranuras con el mismo valor.

**La comparación es por `catalogItemId`, no por `code` ni por `value`.** El catálogo se siembra con tres items de códigos `1`, `2` y `3`, pero la regla no lee el código: compara los tres UUID entre sí. Si alguien sembrara dos items distintos con el mismo `value`, la regla los dejaría pasar — y eso es correcto, porque son dos filas distintas del catálogo y la unicidad de `catalogItem` es asunto de F20, no de este spec.

**Es la primera regla de unicidad entre columnas de la misma fila del repositorio.** Todas las anteriores comparaban una columna contra el resto de la tabla; ésta compara tres columnas entre sí, dentro de una sola fila, y no hay `UNIQUE` de Postgres que pueda expresarla.

#### Las tres FK de catálogo

Cada `importance*ItemId` con valor resultante se valida como cualquier FK del repositorio: **existe**, está **activo** y pertenece al `catalogType` de código **`finalClassificationImportance`** → si no, **404** `FINCLASS_<op>_IMPORTANCE_NOT_FOUND`. Es el mecanismo de `assertAgeUnitIsValid` (`src/services/classification.service.ts:155`), aplicado a los tres campos.

**No hay clave `importanceCatalogMissing`, a diferencia de F09.** Aquélla buscaba items **por código** (`YEARS`, `MONTHS`, `DAYS`) y necesitaba distinguir «el catálogo no está sembrado» de «el item que mandaste no vale». Aquí el servicio **nunca busca por código**: recibe un UUID y comprueba a qué tipo pertenece. Si el catálogo no está sembrado, ningún UUID pertenecerá a él y la respuesta correcta es la misma `IMPORTANCE_NOT_FOUND`.

**El mensaje debe nombrar cuál de las tres falló.** Lleva un parámetro `{{block}}` con `A`, `B` o `C`: tres campos con el mismo código de error y sin distintivo dejarían al cliente adivinando cuál de los tres rechazó el servidor.

#### Lo que no tiene ninguna regla

**Los booleanos entre sí.** Marcar a la vez `aIsRelatedToVaccineProduct: true` y `cHasCoincidentCause: true` es contradictorio en el algoritmo OMS, y **este spec lo acepta**. La única exclusión declarada es la de D. §6 razona por qué.

**Los booleanos contra su `importance*`.** `importanceAItemId` con valor no exige ningún `aIsRelatedTo*` en `true`, ni al revés. Son dos ejes independientes.

**`notes`.** Texto libre siempre abierto, incluso con D activo: la razón por la que un caso es inclasificable es exactamente lo que se escribe ahí.

**Que estos tres grupos no tengan reglas es una decisión declarada, no un olvido.**

#### Por operación

**`ESAVI-FINCLASS-001` — crear.** En este orden:

1. El caso existe y está `isActive: true` → 404 `FINCLASS_001_CASE_NOT_FOUND`. Un caso retirado no se clasifica en firme.
2. Ese caso **no tiene ya clasificación final**, buscando **sin filtrar por `isActive`** → 409 `FINCLASS_001_CASE_ALREADY_FINAL_CLASSIFIED`. Es el canon de §11: la `UNIQUE` del DDL tampoco filtra por `isActive`, así que un `caseId` ocupado por una fila desactivada **sigue ocupado**. El mensaje lleva `{{caseId}}`, porque si no el cliente ve un 409 por una fila que no puede ver.
3. La prohibición de D, en su variante estricta: cualquiera de los diez con valor es 400.
4. La regla de prelación sobre los `importance*` que lleguen con valor.
5. Las tres FK de catálogo.
6. Normaliza: `.trim()` sobre `notes`. No hay más normalización: la entidad no tiene `code` ni `name`.
7. Inserta con la entrada de auditoría `method: 'ESAVI-FINCLASS-001'`.

**El alta mínima es `{ caseId }`** y devuelve 201 con las doce columnas de datos en `null`.

**`ESAVI-FINCLASS-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }` **sobre la propia fila**, los cuatro includes de §3.7, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. **Un solo filtro opcional por query:** `caseId`, por igualdad, UUID. Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404.

**`ESAVI-FINCLASS-002B` — listar, admin.** Idéntica, con `where: {}`: devuelve también las clasificaciones finales inactivas. El mismo filtro y el mismo orden.

**`ESAVI-FINCLASS-003` — obtener por ID.** El `:id` es el `finalClassificationId`. Una fila inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive(req.user)` → 404 `FINCLASS_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-FINCLASS-006` — obtener por caso.** Entra por el `caseId` y atraviesa un solo salto uno a uno. Dos 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `FINCLASS_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene clasificación final visible → 404 `FINCLASS_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la relación es uno a uno. La visibilidad de la fila sigue la misma regla que el `003`.

**`ESAVI-FINCLASS-004` — actualizar.** En este orden:

1. Existencia y visibilidad → 404 `FINCLASS_004_NOT_FOUND`.
2. `caseId` **se ignora siempre**, venga o no en el body. Una clasificación final no se traslada entre casos.
3. Cálculo del estado resultante, la prohibición de D, la regla de prelación y las tres FK de catálogo. **Antes del diff y con independencia de él.**
4. `stored` sale de `finalClassification.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `caseId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `importanceAItemId` | D **abierto**: `data.x !== undefined ? (data.x ?? null) : undefined` · D **activo**: **`null` siempre** | derivado condicional. Participa en la regla de prelación |
| `importanceBItemId` | ídem anterior | derivado condicional |
| `importanceCItemId` | ídem anterior | derivado condicional |
| `aIsRelatedToVaccineProduct` | D **abierto**: `data.x !== undefined ? (data.x ?? null) : undefined` · D **activo**: **`null` siempre** | derivado condicional. **`false` es valor, nunca ausencia** |
| `aIsRelatedToQualityDeviation` | ídem anterior | derivado condicional. `false` es valor |
| `aIsRelatedToProgrammaticError` | ídem anterior | derivado condicional. `false` es valor |
| `aIsRelatedToStress` | ídem anterior | derivado condicional. `false` es valor |
| `bIsConsistentTemporalRelation` | ídem anterior | derivado condicional. `false` es valor |
| `bHasDeterminantFactor` | ídem anterior | derivado condicional. `false` es valor |
| `cHasCoincidentCause` | ídem anterior | derivado condicional. `false` es valor |
| `dIsUnclassifiable` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Es la bandera: nunca se fuerza** |
| `notes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Fuera del bloque: nunca forzado ni prohibido** |

**Diez campos derivados condicionales y dos anulables directos.** Ningún campo cifrado y ningún derivado incondicional: no hay nada que esta entidad recalcule en cada `PUT`. Es la diferencia estructural con F09, cuyo `age`, `ageUnitItemId` e `isSeriousEvent` entraban en `candidates` en **toda** operación.

**`ESAVI-FINCLASS-005A` y `005B` — desactivar y reactivar.** Por `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`), **sin lógica propia**. El sufijo se calcula al entrar (`const op = isActive ? '005B' : '005A'`) y viaja a los tres sitios: `notFoundCode`, `alreadyInStateCode` y `appDetail.method`. Códigos `FINCLASS_005A_NOT_FOUND` / `FINCLASS_005B_NOT_FOUND` y `FINCLASS_005A_ALREADY_INACTIVE` / `FINCLASS_005B_ALREADY_ACTIVE`.

**Ninguna guarda de `hasActiveChildren`:** la tabla es hoja del grafo y no tiene hijos que bloqueen la desactivación.

**Desactivar la clasificación final no toca el caso.** La cascada es de bajada y solo de bajada: retirar el veredicto no retira nada más.

**`ESAVI-FINCLASS-005C` — borrado físico.** SUPERADMIN. La fila debe estar ya en `isActive: false` → **409** `FINCLASS_005C_STILL_ACTIVE` si sigue activa, según §6 de las convenciones. Después `purgeEntityService`. Volcado al log en `warn` con la fila completa antes del `destroy`. **No toca `appDetails`**: la fila desaparece en la misma transacción, así que el código aparece en **cuatro** lugares y no en cinco. Responde 200 con `{ ok, message }` **sin `data`**.

**Sin volcado de cascada:** la tabla es hoja y no arrastra nada.

#### La cascada de `ESAVI-CASE-005A` — una invocación, ningún archivo común modificado

Se suma al punto que F07 construyó en `src/services/esaviCase.service.ts`, junto a las invocaciones de `notifier` (F07), `classification` (F09), `notification` (F10) e `investigation` (F28):

| Origen | Efecto sobre `finalClassification` |
|---|---|
| `ESAVI-CASE-005A` | desactiva la clasificación final **activa** del caso, en la misma transacción |
| `ESAVI-CASE-005B` | **nada.** La cascada es solo de bajada, desde F07 |
| `ESAVI-CASE-005C` | **no existe.** `esaviCase` está en `preventPhysicalDelete` |

Es un `update` masivo filtrado por `caseId` e `isActive: true`, como los cuatro anteriores: `UQ_finalClassification_case` lo deja en como mucho una fila, pero el update no toma ninguna decisión por fila y un caso sin clasificación final actualiza cero filas sin error.

**La cascada no es un update diferencial y no pasa por `buildDifferentialUpdate`.** Es una escritura con intención propia: registra que el caso fue retirado, y lo hace aunque ningún campo de datos de esta fila cambie. Es la misma declaración que hicieron F07, F09, F10 y F28, y se repite aquí porque el silencio sería indistinguible del olvido.

### 3.6 Claves i18n nuevas

En `src/data/i18n/es.json`, `en.json` y `nl.json`, bajo `finalClassification`, calcando la nomenclatura de la sección `classification` que ya existe:

| Clave | Uso |
|---|---|
| `finalClassification.createdSuccess` / `createdFailed` | `001` |
| `finalClassification.getSuccess` / `getFailed` | `003` y `006` |
| `finalClassification.getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `finalClassification.updatedSuccess` / `updatedFailed` | `004` |
| `finalClassification.deletedSuccess` / `deletedFailed` | `005A` |
| `finalClassification.activatedSuccess` / `activatedFailed` | `005B` |
| `finalClassification.purgeSuccess` / `purgeFailed` | `005C` |
| `finalClassification.notFound` | 404 en `003`, `004`, `005A`, `005B`, `005C` y `006` |
| `finalClassification.caseNotFound` | 404 del caso en `001` y `006` |
| `finalClassification.caseAlreadyFinalClassified` | 409 en `001`, con `{{caseId}}` |
| `finalClassification.importanceNotFound` | 404 de FK de catálogo, con `{{block}}` = `A`, `B` o `C` |
| `finalClassification.importanceDuplicated` | 400 con dos `importance*` resultantes iguales |
| `finalClassification.unclassifiableFieldsNotAllowed` | 400 con D activo y algún campo prohibido con valor |
| `finalClassification.alreadyActive` / `alreadyInactive` | 409 en `005B` / `005A` |
| `finalClassification.stillActive` | 409 en `005C` sobre una fila activa |
| `finalClassification.idRequired` | parámetro ausente |

**Veinticuatro claves. Ninguna para las validaciones de forma:** las emite el validador y las responde `validateFields` con `common.validationError`.

**Ninguna clave `importanceCatalogMissing`**, a diferencia del `ageUnitCatalogMissing` de F09: el servicio nunca busca items por código, así que el catálogo sin sembrar y el UUID inválido son el mismo caso.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`003`, `006`, `001` y `004` devuelven el objeto completo, con las cuatro FK **resueltas y excluidas en crudo**, calcando el `DETAIL_EXCLUDE` de `src/services/classification.service.ts:40`:

```
{ ok, message, data: {
    finalClassificationId,
    aIsRelatedToVaccineProduct, aIsRelatedToQualityDeviation,
    aIsRelatedToProgrammaticError, aIsRelatedToStress,
    bIsConsistentTemporalRelation, bHasDeterminantFactor,
    cHasCoincidentCause, dIsUnclassifiable,
    notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    case:        { caseId, caseCode, isActive },
    importanceA: { catalogItemId, code, name, value } | null,
    importanceB: { catalogItemId, code, name, value } | null,
    importanceC: { catalogItemId, code, name, value } | null
} }
```

**`caseId`, `importanceAItemId`, `importanceBItemId` e `importanceCItemId` no aparecen en crudo.** Van excluidos por `DETAIL_EXCLUDE` y los sustituyen los cuatro objetos resueltos. Es exactamente lo que hace F09 con `case` y `ageUnit`.

**Los tres `importance*` son `null` cuando la columna lo es**, y el `include` va `required: false` en los tres: una clasificación final que solo ordenó el bloque A tiene que seguir apareciendo en el listado.

**El include de `case` viaja acotado a tres campos.** Es lo que el cliente necesita para saber de qué caso cuelga el veredicto y si el caso sigue vivo; devolver el caso entero duplicaría la carga útil de `ESAVI-CASE-003`.

`002A` y `002B` devuelven `{ count, rows }` de `findAndCountAll`, **con cada fila en la misma forma completa**. No hay forma reducida: doce columnas y cuatro includes por elemento no justifican dos contratos distintos.

`005A` y `005B` devuelven la fila en la misma forma. `005C` responde **solo** `{ ok, message }`, sin `data`, según §10 de las convenciones.

**`sysDetails` no se expone en ninguna operación.** `isActive` **sí** aparece, porque la columna existe y es el estado que gobierna los dos listados.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registro de la abreviatura y de la operación no canónica.** Alta de `finalClassification` → `FINCLASS` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6 —la que F09 dejó reservada de palabra—, y de la fila `finalClassification` · `006` en la tabla de operaciones no canónicas.
   *Verificación:* `grep -n "FINCLASS" references/CONVENTIONS.md` devuelve las dos filas; la abreviatura no aparece dos veces en la tabla.

2. **Modelo y asociaciones.** `src/models/finalClassification.model.ts` con las doce columnas de datos, `timestamps: false`, `freezeTableName: true`, PK **con** `defaultValue: sequelize.literal('gen_random_uuid()')`, `caseId` en `allowNull: false` y todo lo demás en `allowNull: true`. Los ocho booleanos como `DataTypes.BOOLEAN` **sin `defaultValue`**, `notes` como `TEXT` sin longitud. `src/models/associations/finalClassification.associations.ts` con los cuatro `belongsTo` —`case`, `importanceA`, `importanceB`, `importanceC`— y el `hasOne` inverso de alias `finalClassification`. Alta en `src/models/index.ts` y en `initModels()`.
   *Verificación:* `npm run build` compila; un `findOne` en consola sobre una fila existente devuelve las doce columnas y resuelve los cuatro includes con alias distintos; `grep -n "defaultValue" src/models/finalClassification.model.ts` devuelve **solo** la línea de la PK.

3. **Tipos.** `src/types/finalClassification/finalClassification.types.ts` con `CreateFinalClassificationInput`, los ocho booleanos como `boolean | null` y los tres `importance*ItemId` como `string | null`. Su `index.ts` de barrel y alta en `src/types/index.ts`.
   *Verificación:* `npm run build` compila; `grep -rn "UpdateFinalClassificationInput" src/` no devuelve resultados.

4. **Claves i18n.** Las veinticuatro claves de §3.6 en `es.json`, `en.json` y `nl.json`, con `{{caseId}}` en `caseAlreadyFinalClassified` y `{{block}}` en `importanceNotFound`.
   *Verificación:* `npm run i18n:check` sale en 0; `grep -n "importanceCatalogMissing" src/data/i18n/*.json` no devuelve resultados.

5. **Validadores.** `src/validators/finalClassification.validator.ts` con cinco arrays: `finalClassificationIdValidator`, `finalClassificationCaseIdValidator` (para el `param('caseId')` del `006`), `finalClassificationListValidator` (el filtro `caseId` más `limit` y `offset`), `createFinalClassificationValidator` y `updateFinalClassificationValidator`. El de create exige `caseId` UUID; los dos de cuerpo comparten los tres `importance*ItemId` con `.isUUID()`, los ocho booleanos con `.isBoolean()` y `notes` con `.isString()` y **sin `.isLength()`**. Todos admiten `null`. **Ninguna de las cinco reglas de negocio va aquí:** las cinco dependen de la base o del estado guardado y viven en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `POST` con `importanceAItemId: 'no-es-uuid'` responde 400 `common.validationError`; con `dIsUnclassifiable: 'sí'` también; con `notes` de 5000 caracteres responde **201**, no 400; `grep -n "IMPORTANCE_DUPLICATED\|UNCLASSIFIABLE" src/validators/finalClassification.validator.ts` no devuelve resultados.

6. **`ESAVI-FINCLASS-001` — crear.** Servicio, controlador y ruta, con las dos guardas del alta, la prohibición de D, la regla de prelación, la validación de las tres FK de catálogo **en ese orden**, el `.trim()` de `notes` y la entrada de auditoría.
   *Verificación:* `POST { caseId }` de un caso activo devuelve **201** con las doce en `null`; repetirlo devuelve **409**, y sigue devolviéndolo si la fila existente está inactiva; con un caso inactivo devuelve **404**; `POST { caseId, dIsUnclassifiable: true }` a secas devuelve **201**; `{ dIsUnclassifiable: true, aIsRelatedToStress: false }` devuelve **400** `unclassifiableFieldsNotAllowed` —el `false` es valor—; `{ importanceAItemId: X, importanceBItemId: X }` devuelve **400** `importanceDuplicated`; `{ importanceAItemId: <item de otro catalogType> }` devuelve **404** `importanceNotFound` con `{{block}}` = `A`; `{ dIsUnclassifiable: true, importanceAItemId: X, importanceBItemId: X }` devuelve `unclassifiableFieldsNotAllowed` y **no** `importanceDuplicated`.

7. **`ESAVI-FINCLASS-002A` y `002B` — listados.** Los dos servicios, el controlador único que bifurca por `canViewInactive`, las dos rutas con `/admin` declarada antes de `/:id`, el filtro `caseId`, el orden `createdAt DESC` y los cuatro includes en `required: false`.
   *Verificación:* una fila inactiva no aparece en `GET /` y sí en `GET /admin`; un USER recibe 403 en `/admin`; `GET /?caseId=<uuid inexistente>` devuelve 200 con `{ count: 0, rows: [] }`; una fila con `importanceB` e `importanceC` en `null` **sí** aparece en el listado; ninguna fila trae `sysDetails`, `caseId` ni los tres `importance*ItemId` en crudo.

8. **`ESAVI-FINCLASS-003` — obtener por ID.** Con la visibilidad por `isActive` propio y el `DETAIL_EXCLUDE` de §3.7.
   *Verificación:* un `finalClassificationId` inexistente devuelve 404; una fila inactiva devuelve 404 para USER y ADMIN y 200 para SUPERADMIN; la respuesta trae `case`, `importanceA`, `importanceB` e `importanceC` y **no** trae `caseId` ni los tres `*ItemId`.

9. **`ESAVI-FINCLASS-006` — obtener por caso.** Ruta `/case/:caseId` declarada antes de `/:id`, con los dos 404 distintos.
   *Verificación:* `CASE_NOT_FOUND` y `NOT_FOUND` se obtienen cada uno con su escenario; la respuesta es el objeto y no `{ count, rows }`.

10. **`ESAVI-FINCLASS-004` — actualizar.** La prohibición de D, la regla de prelación y las FK de catálogo sobre el estado resultante, **antes del diff**; `buildDifferentialUpdate` con la tabla de `candidates` de §3.5; `caseId` ignorado en silencio; `updatedAt` escrito por la aplicación.
    *Verificación:* reenviar íntegra la respuesta del `GET` responde 200 sin escribir nada; cambiar solo `notes` añade **una** entrada a `appDetails`; `PUT { dIsUnclassifiable: true }` sobre una fila con `A=1, B=2, aIsRelatedToStress: true` responde **200** y deja los diez campos en `null`; `PUT { dIsUnclassifiable: true, cHasCoincidentCause: true }` responde **400**; `PUT { dIsUnclassifiable: true, cHasCoincidentCause: null }` responde **200**; `PUT { importanceBItemId: <el item que A ya tiene> }` responde **400** `importanceDuplicated` aunque `importanceAItemId` no viaje; `PUT { notes: 'x' }` sobre una fila con `A=1, B=2` responde **200**; `PUT { aIsRelatedToStress: false }` guarda `false` y no `null`.

11. **`ESAVI-FINCLASS-005A` y `005B` — desactivar y reactivar.** Por `setEntityActiveStatusService`, con el sufijo calculado al entrar y **sin guarda de hijos**. Ruta `/activate/:id` declarada antes de `/:id`.
    *Verificación:* `DELETE /:id` sella `isActive: false` y `deletedAt`, y devuelve 409 `alreadyInactive` la segunda vez; `PATCH /activate/:id` lo revierte y devuelve 409 `alreadyActive` la segunda vez; un ADMIN recibe 403 en `/activate/:id`; `grep -n "hasActiveChildren" src/services/finalClassification.service.ts` no devuelve resultados.

12. **`ESAVI-FINCLASS-005C` — borrado físico.** Ruta `/purge/:id` declarada antes de `/:id`, guarda de `isActive: false`, `purgeEntityService`, volcado al log en `warn`.
    *Verificación:* purgar una fila activa devuelve **409** `FINCLASS_005C_STILL_ACTIVE`; una inactiva devuelve **200** sin `data`, y `src/logs/esaviLog.log` contiene la línea `warn` con `ESAVI-FINCLASS-005C` y el volcado de la fila; después de purgar, un `POST` con el mismo `caseId` devuelve **201**: el hueco quedó libre.

13. **Cascada de `ESAVI-CASE-005A`.** Una invocación en `src/services/esaviCase.service.ts`, en el mismo punto y dentro de la misma transacción que las de `notifier`, `classification`, `notification` e `investigation`. **Es la cuarta y última que se añade a ese punto.**
    *Verificación:* `DELETE /api/esavi-cases/:id` desactiva la clasificación final activa del caso; `PATCH /api/esavi-cases/activate/:id` **no** la reactiva; un caso sin clasificación final se desactiva sin error. Las suites de F07, F09, F10 y F28 siguen pasando sin tocar un caso.

14. **Alta en `ROUTE_RULES`.** Las nueve rutas de §3.4 en `tests/auth/roles.test.ts`, con su rol mínimo y su código de operación. **El contador de `toHaveLength` pasa de 280 a 289.**
    *Verificación:* `npm test -- roles` sale en 0 y falla si se comenta cualquiera de las nueve filas o si el contador no se actualiza.

15. **Suite de contrato.** `tests/contract/finalClassification.test.ts` con el recorrido completo, más los casos propios: alta vacía, duplicado por `caseId` con la fila inactiva, la prohibición de D en `001` y `004`, **la precedencia de la prohibición sobre la prelación**, la asimetría `001`/`004`, el `false` tratado como valor, la regla de prelación sobre el estado resultante, los tres bloques del `importanceNotFound` y los criterios de update diferencial de §5.
    *Verificación:* `npm test` sale en 0.

16. **Ampliación de la suite del padre.** `tests/contract/esaviCase.test.ts` con la cascada de `005A` sobre `finalClassification` y con la no-reactivación en `005B`.
    *Verificación:* `npm run check` sale en 0.

**Tres casos de la suite merecen mención porque no salen del recorrido normal.** El primero es la **precedencia**: hace falta un caso que mande `dIsUnclassifiable: true` **con** dos `importance*` repetidos y espere `unclassifiableFieldsNotAllowed`, porque una implementación que evalúe la prelación primero devuelve el otro código y todos los demás casos del bloque pasan igual. El segundo es el **`false` como valor**: un `POST { dIsUnclassifiable: true, aIsRelatedToStress: false }` debe ser 400, y es el único caso que falla si alguien escribe `if( data.aIsRelatedToStress )` por costumbre. El tercero es la **prelación sobre el estado resultante**: un `PUT` que manda **solo** `importanceBItemId` debe fallar contra el `importanceAItemId` que ya estaba guardado, y una implementación que compare únicamente lo que viaja en el body lo deja pasar.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación —ruta, controlador, servicio, `AppError` y `appDetails.method`— coinciden en las nueve operaciones. En `005C` son **cuatro**: no hay `appDetails.method` porque la fila se destruye.
- [ ] `grep -rn "ESAVI-FINCLASS-002[^AB]" src/` no devuelve resultados.
- [ ] `references/CONVENTIONS.md` §6 lista `FINCLASS` en la tabla de abreviaturas y la operación `006` en la de no canónicas.
- [ ] `git diff --stat esaviapp.sql` está vacío: **este spec no toca el DDL en ninguna línea**. Es la diferencia con F09, que sí tuvo que hacer nulables sus nueve booleanos.

**Alta y unicidad**

- [ ] `POST { caseId }` de un caso activo devuelve **201** con las doce columnas de datos en `null`.
- [ ] Repetir ese `POST` devuelve **409** `FINCLASS_001_CASE_ALREADY_FINAL_CLASSIFIED`, y sigue devolviéndolo cuando la fila existente está en `isActive: false`.
- [ ] El mensaje de ese 409 interpola el `{{caseId}}`.
- [ ] `POST` sobre un caso inactivo o inexistente devuelve **404** `FINCLASS_001_CASE_NOT_FOUND`.
- [ ] `POST { caseId }` sobre un caso **sin** `classification`, **sin** `notification` y **sin** `investigation` devuelve **201**: la única precondición es el caso.

**El bloque D — prohibición**

- [ ] `POST { caseId, dIsUnclassifiable: true }` a secas devuelve **201**.
- [ ] `POST { dIsUnclassifiable: true, cHasCoincidentCause: true }` devuelve **400** `FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`.
- [ ] `POST { dIsUnclassifiable: true, aIsRelatedToStress: false }` devuelve **400** con el mismo código: **el `false` es valor, no ausencia**.
- [ ] `POST { dIsUnclassifiable: true, importanceAItemId: <válido> }` devuelve **400**: los tres `importance*` están entre los diez prohibidos.
- [ ] `POST { dIsUnclassifiable: true, notes: 'sin datos suficientes' }` devuelve **201**: `notes` está fuera del bloque.
- [ ] `POST { dIsUnclassifiable: false, cHasCoincidentCause: true }` devuelve **201**, y `POST { cHasCoincidentCause: true }` sin la bandera también: **solo `true` cierra**.

**Precedencia entre las dos reglas**

- [ ] `POST { dIsUnclassifiable: true, importanceAItemId: X, importanceBItemId: X }` devuelve `unclassifiableFieldsNotAllowed` y **nunca** `importanceDuplicated`. Una implementación que evalúe la prelación primero falla aquí y solo aquí.
- [ ] `POST { dIsUnclassifiable: true, importanceAItemId: <item de otro catalogType> }` devuelve `unclassifiableFieldsNotAllowed` y **nunca** `importanceNotFound`: la validación de catálogo va la última y no llega a ejecutarse.

**Regla de prelación**

- [ ] `POST { importanceAItemId: X, importanceBItemId: X }` devuelve **400** `FINCLASS_001_IMPORTANCE_DUPLICATED`.
- [ ] `POST { importanceAItemId: <1>, importanceBItemId: <2>, importanceCItemId: <3> }` devuelve **201**.
- [ ] `POST { importanceAItemId: <1>, importanceCItemId: <3> }` **sin** `importanceB` devuelve **201**: los `null` no participan y no se exige el trío completo.
- [ ] `POST { caseId }` con los tres en `null` devuelve **201**.
- [ ] `PUT { notes: 'x' }` sobre una fila con `A=1, B=2` devuelve **200**: la regla mira el estado resultante, no el body.
- [ ] `PUT { importanceBItemId: <el item que A ya tiene> }` sobre esa fila devuelve **400** `FINCLASS_004_IMPORTANCE_DUPLICATED`, **aunque `importanceAItemId` no viaje en el body**. Una implementación que compare solo lo que viaja lo deja pasar.
- [ ] `PUT { importanceAItemId: null, importanceBItemId: <el item que A tenía> }` sobre esa fila devuelve **200**: el resultante ya no repite.

**Las tres FK de catálogo**

- [ ] Un `importance*ItemId` inexistente, inactivo, o perteneciente a un `catalogType` distinto de `finalClassificationImportance`, devuelve **404** `FINCLASS_<op>_IMPORTANCE_NOT_FOUND`.
- [ ] El mensaje de ese 404 interpola `{{block}}` con `A`, `B` o `C` según cuál de los tres falló.
- [ ] Con el catálogo **sin sembrar**, todo `POST` que informe un `importance*` devuelve **404** `importanceNotFound`, y `POST { caseId }` sigue devolviendo **201**.
- [ ] `grep -rn "importanceCatalogMissing" src/` no devuelve resultados.

**Tri-estado**

- [ ] `POST { cHasCoincidentCause: false }` guarda `false`, y omitir el campo guarda `null`. Los dos son distinguibles en la respuesta.
- [ ] Los ocho booleanos están declarados en el modelo **sin `defaultValue`**; `grep -n "defaultValue" src/models/finalClassification.model.ts` devuelve **solo** la línea de la PK.
- [ ] `PUT { cHasCoincidentCause: null }` sobre una fila que lo tenía en `false` responde **200** y lo deja en `null`: el `| null` del tipo permite borrar, no solo cambiar.

**Validaciones de forma**

- [ ] `importanceAItemId: 'no-es-uuid'` → **400** `common.validationError`.
- [ ] `dIsUnclassifiable: 'sí'` → **400**.
- [ ] `notes` de 5000 caracteres → **201**: la única columna de texto no tiene tope.
- [ ] Ninguna de las cinco reglas de negocio vive en el validador: `grep -n "IMPORTANCE_DUPLICATED\|UNCLASSIFIABLE\|ALREADY_FINAL" src/validators/finalClassification.validator.ts` no devuelve resultados.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/finalClassification.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada. *En esta entidad el segundo caso no aplica —no hay `code`—; el primero se verifica con un `PUT { importanceAItemId: <item desactivado> }`, que responde **404** aunque la fila no cambie en nada más.*
- [ ] Un `PUT` que marca D sobre una fila **ya inclasificable y con los diez campos en `null`** **no escribe nada**: el forzado a `null` pasa por el diff como cualquier otro candidato.
- [ ] Un `PUT` que reenvía `aIsRelatedToStress: false` sobre una fila que ya lo tenía en `false` no escribe nada: **el `false` se compara como valor**, no se descarta como ausencia.
- [ ] Un `PUT` que solo cambia el espaciado de `notes` —`' texto '` sobre `'texto'`— **no escribe nada**: el `.trim()` se aplica antes de comparar.
- [ ] `PUT { caseId: '<otro uuid>' }` devuelve **200** sin escribir nada y sin 400: el campo se ignora en silencio.

**Asimetría `001` / `004` del bloque D**

- [ ] `PUT { dIsUnclassifiable: true }` sobre una fila con `A=1, B=2, aIsRelatedToStress: true` devuelve **200** y deja los diez campos en `null`, sin error.
- [ ] `PUT { dIsUnclassifiable: true, cHasCoincidentCause: true }` devuelve **400** `FINCLASS_004_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`.
- [ ] `PUT { dIsUnclassifiable: true, cHasCoincidentCause: null }` devuelve **200**: mandarlo en `null` no es error.

**Visibilidad y lecturas**

- [ ] Una fila inactiva devuelve **404** en `003`, `004` y `006` para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] `GET /` no la devuelve; `GET /admin` sí.
- [ ] El filtro `caseId` es por igualdad; con un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`.
- [ ] `006` devuelve el objeto, no `{ count, rows }`, y distingue `CASE_NOT_FOUND` de `NOT_FOUND` con códigos distintos.
- [ ] Las operaciones que devuelven el objeto, **y también las filas de los dos listados**, traen `case`, `importanceA`, `importanceB` e `importanceC` resueltos, **no traen** `caseId` ni los tres `*ItemId` en crudo, y **no exponen `sysDetails`**.
- [ ] Una fila con `importanceB` e `importanceC` en `null` aparece igualmente en los dos listados: los tres includes van `required: false`.
- [ ] `isActive` **sí** aparece en la respuesta.

**Activación, borrado físico y cascada**

- [ ] `DELETE /:id` sella `isActive: false` y `deletedAt`; repetirlo devuelve **409** `alreadyInactive`.
- [ ] `PATCH /activate/:id` lo revierte; repetirlo devuelve **409** `alreadyActive`.
- [ ] Un ADMIN recibe **403** en `/activate/:id` y en `/purge/:id`.
- [ ] `grep -n "hasActiveChildren" src/services/finalClassification.service.ts` no devuelve resultados: la tabla es hoja del grafo.
- [ ] `DELETE /purge/:id` sobre una fila activa devuelve **409** `FINCLASS_005C_STILL_ACTIVE`.
- [ ] `DELETE /purge/:id` sobre una fila inactiva devuelve **200** con `{ ok, message }` y **sin `data`**, y deja en `src/logs/esaviLog.log` una línea `warn` con el código de operación y el volcado de la fila.
- [ ] Después de purgar, un `POST` con el mismo `caseId` devuelve **201**: solo el `005C` libera el hueco.
- [ ] `ESAVI-CASE-005A` desactiva la clasificación final activa del caso, en la misma transacción.
- [ ] `ESAVI-CASE-005B` **no** la reactiva: la cascada es solo de bajada.
- [ ] Desactivar un caso que no tiene clasificación final no produce error.
- [ ] Las suites de contrato de F07, F09, F10 y F28 pasan sin modificar un solo caso.

**Cierre**

- [ ] Las veinticuatro claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] Las nueve rutas están en `ROUTE_RULES` de `tests/auth/roles.test.ts` y el contador de `toHaveLength` dice **289**.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la forma de la entidad**

- **Sí:** calcar F09 y **no** F28-F40. Es la tentación inmediata —trece specs seguidos con la otra forma— pero `finalClassification` tiene PK propia, tiene `isActive` y cuelga de `esaviCase`, no de `investigation`. Copiar la forma de las satélites de investigación habría producido una entidad sin `005A`/`005B` y con un `:id` que no es su clave primaria.
- **Sí:** `005A` y `005B` por `setEntityActiveStatusService`, sin lógica propia. La tabla es hoja del grafo: no hay hijos que bloqueen la desactivación y no hay nada que inventar.
- **Sí:** mantener `006` pese a que la relación es uno a uno. Aquí **no** es redundante con `003`, porque el `:id` del `003` es el `finalClassificationId` y el cliente nunca lo ha visto. Es la situación de F09, no la de F38-F40, donde los dos coincidían.
- **No:** exigir `classification`, `notification` o `investigation` antes de clasificar en firme. Es una regla de proceso plausible —el veredicto normalmente llega al final— pero el DDL no declara ninguna de esas dependencias, y convertirla en 409 bloquearía la clasificación de casos que se cierran sin investigación. Si el proceso la necesita, es un spec propio con su propia decisión sobre qué pasa con los casos ya cargados.
- **No:** crear la clasificación final automáticamente al abrir el caso o al cerrar su investigación. Clasificar la causalidad es un acto deliberado y posterior, igual que clasificar la gravedad en F09.

**Sobre los tres `importance*`**

- **Sí:** un único `catalogType` —`finalClassificationImportance`— compartido por las tres columnas, sembrado con tres items de `code` y `value` `1`, `2` y `3`. Los tres campos son la misma escala aplicada a tres bloques, y tres catálogos distintos con contenido idéntico serían tres sitios donde mantener lo mismo.
- **No:** tres `catalogType` separados, uno por bloque. Se descartó al confirmarse que la escala es la misma y que su semántica es de **orden de prelación**, no de subclase: si A, B y C tuvieran escalas distintas no podrían compararse entre sí, y la regla de «todas diferentes» no tendría sentido.
- **No:** dejar los tres sin validación de tipo, comprobando solo que el `catalogItem` exista y esté activo. Permitiría meter una unidad de edad en la ranura de prelación, y el error se descubriría al pintar el informe.
- **Sí:** códigos `1`, `2` y `3` literales, aunque el resto del repositorio use códigos alfabéticos. La escala es ordinal y sus etiquetas naturales son números; inventar `LEVEL_1` añadiría una traducción mental sin ganar nada. `toCodeFromInput` es idempotente sobre un dígito, así que la excepción camelCase de `catalogItem` no se rompe.
- **Sí:** que la regla de «todas diferentes» compare **solo las que tengan valor**. Es lo que preserva el alta vacía de §2 y el `PUT` parcial de F12 a la vez.
- **No:** exigir el trío completo, ni «todo o nada», ni «las tres obligatorias salvo D». Un veredicto puede ordenar dos bloques y dejar el tercero sin evaluar, y las tres alternativas convertían updates parciales legítimos en 400.
- **Sí:** comparar por `catalogItemId` y no por `code` ni por `value`. La regla es «no repitas ranura», no «no repitas número», y leer el código metería una dependencia del contenido del catálogo dentro de la lógica de coherencia.
- **Sí:** evaluar la regla sobre el estado resultante. Evaluarla solo sobre el body dejaría pasar el caso más probable de todos: un `PUT` que manda una sola ranura y choca con lo que ya estaba guardado.

**Sobre el bloque D y su polaridad**

- **Sí:** que `dIsUnclassifiable: true` prohíba los **diez** campos restantes, y no solo los siete booleanos. Si el caso es inclasificable no hay bloques que ordenar, y dejar los `importance*` fuera de la prohibición permitiría una fila que declara «no se pudo evaluar nada» y a la vez ordena A por delante de B.
- **Sí:** la asimetría `001`/`004` de F34, F36, F38, F39 y F40 — 400 en el alta, forzado a `null` en el update. Es el mismo razonamiento de aquéllas: en el alta no hay estado heredado que limpiar, así que aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo; en el update sí lo hay, y exigir al cliente que lo limpie a mano convertiría marcar una casilla en un body de once claves.
- **No:** 400 en las dos operaciones, con el cliente limpiando explícitamente. Se consideró y se descartó al ver el efecto concreto: un `PUT { dIsUnclassifiable: true }` sobre una fila poblada sería 400, y el formulario tendría que construir `{ dIsUnclassifiable: true, importanceAItemId: null, importanceBItemId: null, importanceCItemId: null, aIsRelatedToVaccineProduct: null, … }` para marcar una casilla. Es explícito, pero el coste recae entero en el cliente y ninguna otra entidad del repositorio lo cobra.
- **Sí:** dejar escrito que **la polaridad de esta bandera es la inversa** de todas las anteriores. F34, F36, F38, F39 y F40 tienen banderas que **abren** un bloque; ésta lo **cierra**. La mecánica es idéntica y por eso es peligrosa: un implementador que venga de F40 y lea por analogía escribirá la condición al revés y **todos los casos felices seguirán pasando**.
- **Sí:** tratar el `false` como valor y no como ausencia. Es el caso que §11 advierte, y aquí es especialmente caro: `aIsRelatedToStress: false` afirma que el bloque A se evaluó y se descartó, mientras que D afirma que no se pudo evaluar nada. Son incompatibles, y un `if( data.aIsRelatedToStress )` escrito por costumbre las deja convivir en la misma fila.
- **Sí:** `notes` fuera del bloque, incluso con D activo. La razón por la que un caso es inclasificable es exactamente lo que hay que poder escribir ahí, y prohibirlo dejaría el veredicto más ambiguo de todos sin explicación.
- **No:** meter `dIsUnclassifiable` en `UNCLASSIFIABLE_FORBIDDEN_FIELDS`. Es la bandera, no un campo prohibido, y ponerla dentro haría que marcarla se prohibiera a sí misma. Parece obvio escrito, y es el error de una línea que un `map` sobre las once columnas produce solo.

**Sobre la precedencia y el orden de evaluación**

- **Sí: la prohibición de D corre antes que la regla de prelación**, y las dos antes que la validación de catálogo. El error que se devuelve es el del problema de fuera, no el del de dentro. Es literalmente la decisión de F36 y de F40.
- **Sí:** la validación de catálogo la última, después del forzado a `null` del `004`. No tiene sentido resolver contra `catalogItem` tres UUID que el paso anterior acaba de descartar: es una consulta que se ahorra y un 404 que nunca se emite por un campo que no se va a guardar.
- **Sí:** dos criterios de aceptación dedicados a la precedencia. Son los únicos que fallan si el orden se invierte; todos los demás casos del bloque pasan igual.

**Sobre lo que este spec deliberadamente no valida**

- **No:** exclusión mutua entre los bloques A, B y C. Marcar a la vez `aIsRelatedToVaccineProduct: true` y `cHasCoincidentCause: true` es contradictorio en el algoritmo OMS, y aun así se acepta. Dos razones: el DDL no lo impide, y —más importante— **la existencia misma de los tres `importance*` presupone que puede haber más de un bloque marcado**. Si los bloques fueran mutuamente excluyentes no habría nada que ordenar por prelación, y las tres columnas sobrarían.
- **No:** atar `importanceAItemId` a que algún `aIsRelatedTo*` sea `true`. Son dos ejes: los booleanos dicen **qué** se marcó, los `importance*` dicen **en qué orden de fuerza**. Atarlos multiplica los 400 sin que el DDL lo insinúe, y bloquearía el flujo natural de rellenar el formulario por partes.
- **Sí:** declarar explícitamente que estos dos grupos **no tienen ninguna regla**. Es una decisión, no una omisión, y sin escribirla el siguiente implementador la leerá como un olvido — o peor, la «arreglará».
- **No:** imponer tope de longitud a `notes`. Es `text` en el DDL, sin techo declarado; inventar un límite en el validador crearía un 400 que la base de datos no respalda.
- **No:** versionar o historiar el veredicto. Que un caso se reclasifique y quede constancia de los dos juicios exigiría una tabla que el esquema no tiene; hoy el rastro está en `appDetails`, que es donde el repositorio lo guarda todo.
- **No:** filtrar el listado por campos de dominio —por bloque de causalidad, por `dIsUnclassifiable`, por `importanceAItemId`—. Sería el primer filtro de ese tipo del repositorio, y el único filtro es `caseId`.
- **No:** cifrar ningún campo. Un veredicto de causalidad no identifica a nadie, y el paciente ya está cifrado en su propia tabla. Es la posición de F09.
- **Sí:** no tocar el DDL en ninguna línea. Es la diferencia con F09, que tuvo que hacer nulables sus nueve booleanos para conseguir el tri-estado; aquí el esquema ya lo permite y no hay nada que corregir. Es una propiedad verificable: `git diff --stat esaviapp.sql` vacío.
- **No:** añadir un `UNIQUE` parcial que libere el `caseId` de una clasificación final inactiva. Es la misma tentación que F09 declinó, y por la misma razón: el 409 sobre una fila que el cliente no puede ver es confuso, pero abrir el hueco permitiría dos veredictos vivos sobre el mismo caso en cuanto alguien reactivara el primero.

**Sobre el catálogo**

- **Sí:** la siembra de `finalClassificationImportance` es **precondición de implementación, no parte del spec**. Es la posición de F09 con `ageUnit`, y la consecuencia está declarada: sin el catálogo, todo alta que informe un `importance*` devuelve 404, y el alta vacía sigue funcionando.
- **No:** una clave `importanceCatalogMissing` equivalente al `ageUnitCatalogMissing` de F09. Aquélla la necesitaba porque buscaba items **por código** y tenía que distinguir «el catálogo no está» de «el item no vale». Aquí el servicio recibe un UUID y comprueba a qué tipo pertenece: los dos casos son indistinguibles desde dentro, y forzar la distinción exigiría una consulta extra al `catalogType` que no cambia lo que el cliente debe hacer.
- **Sí:** que el mensaje de `importanceNotFound` lleve `{{block}}`. Tres campos con el mismo código de error y sin distintivo dejan al cliente adivinando cuál de los tres rechazó el servidor.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **La polaridad de `dIsUnclassifiable` leída al revés.** Es el riesgo principal de este spec. Trece specs seguidos —F34, F36, F38, F39, F40— tienen una bandera que **abre** un bloque de campos permitidos; ésta lo **cierra**. Un implementador que copie la estructura de F40 y adapte los nombres escribirá `if( resulting.dIsUnclassifiable !== true )` donde va `=== true`, y **todos los casos felices seguirán pasando**: el alta vacía, el `PUT` parcial, la prelación. Solo fallan los casos de prohibición | §1, §2, §3.5 y §6 lo dicen con esas palabras, cada uno en su registro. §5 tiene seis criterios de prohibición y uno explícito de que `false` y `null` **no** cierran, que es el que atrapa la inversión |
| **El `false` tratado como ausencia.** Un `if( data.aIsRelatedToStress )` escrito por costumbre lo descartaría en tres sitios: la prohibición del `001`, el forzado del `004` y el diff. «El bloque A se evaluó y se descartó» se perdería en silencio, y una fila podría afirmar a la vez que es inclasificable y que descartó el bloque A | Tres criterios de §5 lo verifican por separado, en `001`, en `004` y en el diff. §11 lo declara norma y §3.5 exige la comparación `!== undefined && !== null` |
| **La regla de prelación evaluada sobre el body en vez de sobre el estado resultante.** Dejaría pasar el caso más probable de todos: un `PUT` que manda una sola ranura y choca con lo que ya estaba guardado. La fila queda con dos bloques en la misma posición y nadie se entera hasta el informe | §3.5 lo declara explícitamente y §5 lo verifica con un `PUT { importanceBItemId: <el de A> }` sin que `importanceAItemId` viaje. §4 lo señala como uno de los tres casos que no salen del recorrido normal |
| **La prohibición evaluada después de la prelación, o después del catálogo.** Devolvería `importanceDuplicated` o `importanceNotFound` a un cliente cuyo problema real es que marcó D, y el formulario le pediría corregir un campo que no debería estar ahí | §3.5 fija el orden en cuatro pasos y §5 tiene **dos** criterios dedicados. Son los únicos que fallan si el orden se invierte |
| **El catálogo `finalClassificationImportance` sin sembrar en el entorno de destino.** Es precondición y no parte del spec, así que nada en el código la comprueba. El síntoma es engañoso: el alta vacía funciona, el `005A`/`005B` funciona, el listado funciona — y **solo** falla el alta que informa un `importance*`, con un 404 que parece un error de datos del cliente | §2 lo declara precondición con esas palabras, §3.5 explica por qué no hay una clave `importanceCatalogMissing` que lo distinga, y §5 tiene un criterio que lo verifica como escenario: catálogo vacío → 404 en el alta con `importance*` y **201** en el alta vacía |
| **`dIsUnclassifiable` metido en la lista de campos prohibidos.** Un `map` sobre las once columnas lo incluye solo, y entonces marcar D se prohíbe a sí mismo: `POST { dIsUnclassifiable: true }` devuelve 400 y el bloque D es inalcanzable | §3.3 declara la constante con los diez campos y dice explícitamente que son diez y no once. §5 lo verifica con `POST { caseId, dIsUnclassifiable: true }` → **201** |
| **Los tres `belongsTo` al mismo modelo con `required: true`.** Es el error de configuración natural en una entidad con tres includes opcionales al mismo `catalogItem`: una clasificación final que solo ordenó el bloque A **desaparecería** de los dos listados y del `003`, sin error y sin rastro | §3.7 exige `required: false` en los tres y §5 lo verifica con una fila de `importanceB` e `importanceC` en `null` que debe seguir apareciendo en el listado |
| **La forma de F28-F40 copiada por inercia.** Trece specs consecutivos con PK que es FK, sin `isActive` y sin `005A`/`005B`. Aplicarla aquí produciría una entidad sin activación y con un `:id` que no es su clave primaria — y el `006` dejaría de tener sentido | §1 abre declarando que la gemela es F09 y que la forma de F28-F40 **no aplica en ningún punto**. §3.2 marca la PK **con** `defaultValue` y §5 exige que las nueve rutas respondan, incluidas `005A` y `005B` |
| **Ninguna validación en la base.** La tabla no tiene un solo `CHECK`, así que una fila incoherente escrita por SQL directo, por una migración o por un endpoint futuro **no la detiene nadie**. Es la diferencia real con F09, que al menos tenía el `CHECK ("age" >= 0)` | **No se mitiga en este spec: se declara.** Añadir los `CHECK` exigiría tocar el DDL, y §2 lo deja fuera de alcance. Lo que sí queda cerrado es que §3.1 lo dice en voz alta —«lo que este spec no escriba no lo escribe nadie»— para que nadie asuma una red que no existe |
| **El 409 del `001` sobre un `caseId` ocupado por una fila inactiva.** El cliente ve un conflicto por una fila que no puede listar ni consultar, y no tiene forma de deducir qué pasó | El mensaje interpola `{{caseId}}` y §5 lo verifica. La salida está documentada: reactivar la anterior con `005B` o purgarla con `005C`. Es el mismo compromiso que F09 aceptó |
| **Un caso reactivado con la clasificación final aún desactivada.** `ESAVI-CASE-005B` no reactiva nada, así que tras un ciclo desactivar-reactivar el caso vuelve sin veredicto visible | Decisión heredada de F07 y compartida por F09, F10 y F28: la cascada es solo de bajada. La reactivación en bloque es un spec propio que afecta a las **cinco** entidades a la vez, y hacerla aquí para una sola dejaría el comportamiento incoherente entre satélites |
| **`GET /:id` captura `/admin`, `/case`, `/activate` o `/purge` como UUID** | Las cuatro rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato y por `ROUTE_RULES` |

**No hay sección 8.** Este spec solo añade rutas nuevas: no modifica el contrato HTTP de ninguna entidad existente. `esaviCase` no cambia su respuesta —el inverso `finalClassification` no se incluye en ninguna de sus operaciones—, y las suites de F07, F09, F10 y F28 pasan sin tocar un caso.

---

## Lo que **no** está en este spec

- **Sembrar el `catalogType` `finalClassificationImportance`** y sus tres items. Es precondición de implementación.
- **Exigir `classification`, `notification` o `investigation`** antes de clasificar un caso en firme.
- **Derivar el veredicto automáticamente** de la investigación, de `classification.isSeriousEvent` o de cualquier otra tabla.
- **Crear la clasificación final automáticamente** al abrir el caso o al cerrar su investigación.
- **Versionar o historiar el veredicto** cuando un caso se reclasifica.
- **Validar la exclusión mutua entre los bloques A, B y C.** La única exclusión declarada es la de D.
- **Atar los `importance*` a los booleanos de su bloque.**
- **Añadir `CHECK` al DDL** que impongan en la base cualquiera de las cinco reglas de negocio.
- **Cualquier endpoint de estadística, conteo por bloque de causalidad o exportación.**
- **Filtrar, contar o agregar** por cualquier campo de dominio. El único filtro es `caseId`.
- **Bloquear la desactivación de un caso** porque tenga clasificación final.
- **Extender la cascada de `ESAVI-CASE-005B` hacia arriba**, para las cinco entidades satélite a la vez.
- **Un `UNIQUE` parcial** que libere el `caseId` de una clasificación final inactiva.
- **Cifrado de ningún campo**, ni topes de longitud sobre `notes`.
- **Forma reducida** en el listado.
- **Modificar `esaviapp.sql`** en ninguna línea.
- **Modificar `setEntityActiveStatusService`, `purgeEntityService` ni `buildDifferentialUpdate`.**
- **`investigationCovidHistory`**, la única tabla del esquema que seguirá sin spec después de éste.
- **Exponer o editar `sysDetails`.**

Cada uno de esos, si aterriza, va en su propio spec.
