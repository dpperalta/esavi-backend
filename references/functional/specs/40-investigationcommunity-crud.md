# SPEC F40 — CRUD de `investigationCommunity`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK; y precedente de las coordenadas `DECIMAL(10,7)`)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), **SPEC F32 (`investigationMedicalHistory` — aporta `satelliteCascade.service.ts`, que este spec consume ya extraído)**, **SPEC F34 (`investigationClinicalEvaluation` — aporta el patrón del bloque condicional con su asimetría `001`/`004`)**, **SPEC F36 (`investigationVaccinationContext` — aporta el contador `smallint` con techo replicado y la precedencia «prohibición antes que obligación»)**, SPEC F38 y SPEC F39 (hermanas de forma: misma PK-FK, misma ausencia de `isActive`, mismo listado dual, mismo `005C`), SPEC F13 y SPEC F14 (patrón de satélite sin `isActive`), SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-25
> **Objetivo:** Dar de alta `investigationCommunity` —dónde vive el paciente y si la comunidad reportó otros eventos parecidos— como la **décima** tabla con FK directa a `investigation` que recibe spec propio.

---

## 1. Por qué existe este spec

`investigationCommunity` responde al bloque del formulario que **sale del expediente y mira al entorno**. Todas las satélites anteriores describen al paciente, a la vacuna o al acto de vacunar; ésta pregunta por lo que pasó **alrededor**: dónde vive el afectado y si en su comunidad hubo más casos como el suyo. Son dos grupos y nada más:

- **La ubicación del paciente**, en `patientLatitude` y `patientLongitude`.
- **El evento similar en la comunidad**, gobernado por `hadSimilarEvent`: qué pasó, a cuántos alcanzó y cómo se reparten esos afectados entre vacunados, no vacunados y desconocidos.
- Más `otherComments` y `notes`, las dos siempre abiertas.

Hoy la tabla existe en `esaviapp.sql:1238-1258` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **décima tabla con FK directa a `investigation`** que recibe spec propio, tras F29, F30, F31, F32, F34, F36, F37, F38 y F39. Los cuatro rasgos de forma que fijó F38 se cumplen aquí sin matices, y se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`:1239`) y destino de `FK_investigationCommunity_investigation` (`:1257`). Sin `UNIQUE` adicional: la clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **décima** del repositorio así. De ahí que **no haya `005A` ni `005B`**, y que la visibilidad se herede de `investigation.isActive`.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete`, así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar.
- **Solo lleva el trigger genérico.** `TRG_investigationCommunity_setSysDetails`, del bucle de `esaviapp.sql:1291-1306`. `updatedAt` lo escribe la aplicación.

**Y es la satélite más estrecha especificada hasta hoy:** diez columnas de datos, frente a las veintiséis de F39 y las quince de F38. Ninguna es `NOT NULL`.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco.** Dos cosas:

**A — Es la primera satélite con coordenadas, y son del domicilio del paciente.** `patientLatitude` y `patientLongitude` (`:1240-1241`) tienen el mismo tipo `numeric(10,7)` que las de `investigation`, pero **no el mismo significado**. F28 razonó explícitamente que no cifraba las suyas porque *«las coordenadas son del punto de vacunación, no del domicilio»* — aquí son exactamente el domicilio, y el nombre de la columna lo dice. El paciente está cifrado en su propia tabla; su ubicación, en ésta, no lo estará. §6 declara la decisión y §7 la declara riesgo.

**B — Es el primer bloque condicional del repositorio con un campo obligatorio y cuatro opcionales dentro.** El comentario del DDL (`:1243`) dice *«If answer is "Yes", then the following fields are required»* y abarca cinco columnas. F34, F36 y F38 leyeron su comentario como «permitido y opcional»; F39 lo leyó como «al menos uno». Este spec lo lee como **uno obligatorio y cuatro opcionales**: la descripción del evento es el dato mínimo que el bloque existe para capturar, y los contadores son un desglose que el informante puede no tener. §6 razona por qué no se eligió ninguna de las otras dos lecturas.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationCommunity`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29, F30, F32, F34, F36, F38 y F39 mantuvieron.
- **Listado dual `002A` / `002B`**: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve filas cuya investigación está activa; `002B` en `GET /admin` para ADMIN las devuelve todas.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear el segundo registro comunitario de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVCOMM_001_INVESTIGATION_NOT_FOUND`; no tiene ya registro comunitario, sin filtrar por `deletedAt` → 409 `INVCOMM_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la fila responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Alta vacía.** Las diez columnas de datos son anulables y **ninguna es obligatoria**: `POST { investigationId }` devuelve **201** con las diez en `null`. La fila se abre como borrador y se completa por `PUT`. Es el patrón de F13, F14, F29, F32, F34, F36, F38 y F39.
- **`investigationId` inmutable en el `004`:** se ignora en silencio si llega, sin 400.
- **El bloque del evento similar.** `hadSimilarEvent` gobierna a cinco campos —`similarEventDescription`, `similarEventCount`, `affectedVaccinated`, `affectedUnvaccinated` y `affectedUnknown`—:
  - **Solo `'YES'` abre el bloque.** `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null` lo cierran, los cinco por igual.
  - Con el bloque **abierto**, `similarEventDescription` es **obligatoria** → si su valor resultante es `null`, **400** `INVCOMM_<op>_SIMILAR_EVENT_DESCRIPTION_REQUIRED`. **Los cuatro contadores siguen siendo opcionales.**
  - Con el bloque **cerrado**, los cinco campos están **prohibidos**, con la asimetría `001` / `004`: **400** en el alta; en el update, **forzados a `null` como derivados condicionales** si el cliente no los manda, **400** si los manda con valor. Mandarlos explícitamente en `null` **no** es error.
  - **La prohibición corre antes que la obligación**, como fijó F36: un body con el bloque cerrado y la descripción presente recibe `SIMILAR_EVENT_FIELDS_NOT_ALLOWED`, nunca `SIMILAR_EVENT_DESCRIPTION_REQUIRED`.
- **La obligación se evalúa sobre el estado resultante, no sobre el body.** Un `PUT { notes: 'x' }` sobre una fila con el bloque abierto y con descripción guardada **no** falla. Un `PUT { similarEventDescription: null }` sobre esa misma fila es **400**: para vaciarla hay que cerrar `hadSimilarEvent` en la misma petición, y entonces los cinco campos se fuerzan a `null` sin error.
- **Los cuatro contadores no se validan unos contra otros.** `affectedVaccinated + affectedUnvaccinated + affectedUnknown` **no** tiene que cuadrar con `similarEventCount`. El formulario los pregunta por separado y se guardan tal como llegan.
- **Las dos coordenadas son independientes entre sí.** Mandar `patientLatitude` sin `patientLongitude` es un registro válido: se guarda la mitad. No hay regla de par.
- **Rango geográfico replicado en el validador.** `patientLatitude` entre `-90` y `90`, `patientLongitude` entre `-180` y `180`, además de `.isDecimal({ decimal_digits: '0,7' })`. **Es una desviación deliberada de F28**, que solo valida los decimales; §6 la razona.
- **Los cuatro contadores validados con `.isInt({ min: 0, max: 32767 })`** admitiendo `null`: replica el `CHECK >= 0` del DDL **y** el techo de `smallint`, para que un desbordamiento sea 400 y no un 500 de Postgres. Es la regla de F36.
- **Ningún campo cifrado.** Las coordenadas del domicilio **no** se cifran: `esaviCrypt` produce texto y las columnas son `numeric(10,7)`. Queda declarado como riesgo en §7 y como decisión en §6.
- **Normalización al escribir:** `.trim()` sobre las tres columnas de texto —`similarEventDescription`, `otherComments` y `notes`—, **sin ningún tope de longitud**: las tres son `text` en el DDL y no tienen techo declarado. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre**, ya sobre `src/services/common/satelliteCascade.service.ts` **sin modificarlo**: `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica añadir invocaciones en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, **junto a las que F29, F30, F32, F34, F36, F37, F38 y F39 ya dejaron puestas**.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto a los que las specs anteriores dejaron.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVCOMM_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**, porque el control de `isActive` de `purgeEntityService` es inerte sobre una tabla que no tiene esa columna.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación. Orden `createdAt DESC`.
- Alta de la abreviatura **`INVCOMM`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationCommunity.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F32** debe estar `Implementado`. No hay dependencia de modelo, pero sí de código: `satelliteCascade.service.ts` nace allí y este spec lo consume tal cual.

**Fuera de alcance (otros specs):**

- **La última satélite de `investigation` que sigue sin spec:** `investigationCovidHistory` (`:1014-1036`). Con este spec, `investigationCommunity` sale de esa lista y solo queda aquélla.
- **Cifrar las coordenadas del domicilio del paciente.** Exigiría cambiar el tipo de las dos columnas de `numeric(10,7)` a texto en el DDL, migrar las filas ya cargadas y renunciar a toda comparación numérica sobre ellas. Es un spec propio, y §7 lo declara riesgo abierto.
- **Cualquier búsqueda geográfica por proximidad**, cálculo de distancia entre el domicilio y el punto de vacunación de F28, o agregación por zona. Sería la primera consulta geoespacial del repositorio.
- **Validar la coherencia entre los contadores.** Que los tres `affected*` sumen `similarEventCount` es plausible como control de calidad, pero el formulario los pregunta por separado y un informante puede conocer el total sin el desglose.
- **Exigir alguno de los cuatro contadores** cuando el bloque está abierto. La descripción es el dato mínimo; los números son un desglose que puede no existir cuando se abre la investigación.
- **Tratar las dos coordenadas como un par indivisible.** Mandar una sin la otra se acepta, igual que en F28.
- **Cualquier regla cruzada con `investigationVaccinationContext`.** `isCluster` y sus contadores de F36 describen un agrupamiento de casos, y `hadSimilarEvent` describe un rumor comunitario: se solapan conceptualmente y atarlas exige antes decidir cuál manda.
- **Derivar un indicador de «brote»** a partir de los cuatro contadores. Es un juicio de clasificación, no un dato de investigación.
- **Filtrar, contar o agregar por cualquier campo de dominio.** Los dos únicos filtros del listado son los de F29, F32, F34, F36, F38 y F39.
- **Estructurar `similarEventDescription`, `otherComments` o `notes`** como catálogo, ni imponerles tope de longitud, ni búsqueda por texto sobre ellas.
- **Modificar `esaviapp.sql`.** Ni añadir `isActive`, ni un `CHECK` sobre el bloque, ni un índice, ni meter `investigation` en `preventPhysicalDelete`. **Este spec no toca el DDL en ninguna línea** — es la tercera vez, tras F38 y F39.
- **Modificar `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.** Los cinco se consumen tal cual están.
- **Cambiar el comportamiento de F29 a F39.** Este spec solo añade invocaciones junto a las suyas; sus suites de contrato deben pasar sin tocar un solo caso.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationCommunity` — `esaviapp.sql:1238-1258`. **La tabla no se altera, y este spec no añade una sola línea al DDL.**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:1239`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationCommunity_investigation` → `investigation`, `ON DELETE CASCADE` (`:1257`) |
| `patientLatitude` | `numeric(10,7)` | sí | `:1240`. **Domicilio del paciente.** Vuelve de `pg` como cadena |
| `patientLongitude` | `numeric(10,7)` | sí | `:1241`. **Domicilio del paciente.** Vuelve de `pg` como cadena |
| `hadSimilarEvent` | `answerOption` | sí | `:1242`. **Bandera del bloque del evento similar. Abre con `'YES'`** |
| `similarEventDescription` | `text` | sí | `:1244`. Campo 1 del bloque. **El único obligatorio con el bloque abierto** |
| `similarEventCount` | `smallint` | sí | `:1245`. Campo 2 del bloque. `CHECK (… IS NULL OR … >= 0)` |
| `affectedVaccinated` | `smallint` | sí | `:1246`. Campo 3 del bloque. `CHECK (… IS NULL OR … >= 0)` |
| `affectedUnvaccinated` | `smallint` | sí | `:1247`. Campo 4 del bloque. `CHECK (… IS NULL OR … >= 0)` |
| `affectedUnknown` | `smallint` | sí | `:1248`. Campo 5 del bloque. `CHECK (… IS NULL OR … >= 0)` |
| `otherComments` | `text` | sí | `:1250`. **Fuera del bloque.** Texto libre |
| `notes` | `text` | sí | `:1251`. **Fuera del bloque.** Texto libre |

**Diez columnas de datos, las diez anulables.** Ninguna es `NOT NULL`, y de ahí sale directamente el alta vacía de §2. Es la satélite **más estrecha** especificada hasta hoy: F38 tenía quince y F39 veintiséis.

**Restricciones.** **Una sola clave foránea** —la del padre—, **cuatro `CHECK`** —los de los contadores, todos con la forma `IS NULL OR >= 0`—, **ninguna `UNIQUE`** —la PK ya lo es— y **ningún índice declarado** más allá del de la clave primaria. **No hace falta añadir ninguno:** el `investigationId` por el que filtra el listado *es* la clave primaria, que ya está indexada.

**Las dos columnas de texto de fuera del bloque no son intercambiables.** `otherComments` (`:1250`) son los comentarios del informante sobre el entorno; `notes` (`:1251`) son las observaciones del investigador sobre toda la fila. La distinción no está escrita en el DDL y ninguna de las dos la sugiere por el nombre. Este spec no las une ni les da regla: **las dos son texto libre siempre abierto**.

#### El único comentario del DDL, y qué dice exactamente

`:1243` — *«If answer is "Yes", then the following fields are required»* — y `:1249` — *«End above fields»*. Es la **única regla de negocio escrita en el esquema de esta tabla**, y delimita cinco columnas: `:1244` a `:1248`.

Tres lecturas que este spec fija y que el comentario no resuelve solo:

1. **La polaridad es la habitual.** Abre `'YES'`, como F34, F36 y F38, y **no** como F39, que es el único bloque del repositorio que abre con `'NO'`.
2. **«Required» se implementa como «la descripción sí, los contadores no».** Es la tercera lectura distinta que el repositorio hace de la misma palabra —F34/F36/F38 la leyeron como «permitido y opcional», F39 como «al menos uno»—, y §6 razona por qué aquí no vale ninguna de las dos.
3. **El comentario abarca los cuatro contadores**, así que están dentro del bloque a efectos de **prohibición** aunque no lo estén a efectos de **obligación**. Con el bloque cerrado caen los cinco; con el bloque abierto solo se reclama uno.

Todo lo demás de la tabla —las dos coordenadas, `otherComments` y `notes`— **no está insinuado en el DDL** y este spec lo declara explícitamente independiente, que es una decisión y no una omisión.

**El ENUM `answerOption`** se declara en `esaviapp.sql:26` con cinco valores: `'YES'`, `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`. Ya vive en `src/constants/enums.constants.ts` como `ANSWER_OPTIONS`, con el tipo `AnswerOption`. **No se añade ninguna constante nueva.** Una sola columna lo usa.

**Las columnas transversales, y la que falta.** Están `createdAt` (`:1252`), `updatedAt` (`:1253`), `deletedAt` (`:1254`), `sysDetails` (`:1255`) y `appDetails` (`:1256`). **Falta `isActive`**, igual que en las nueve tablas listadas en §1. Es la décima del repositorio así.

**Triggers.** Solo `TRG_investigationCommunity_setSysDetails`, del bucle genérico de `esaviapp.sql:1291-1306`. La tabla no figura en el bucle `preventPhysicalDelete`, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco figura en `setSortOrderByParent`: no tiene `sortOrder`.

**Hoja del grafo.** `grep 'REFERENCES "investigationCommunity"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationCommunity.model.ts`. Clase `InvestigationCommunity`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationCommunity'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14, F29, F30, F32, F34, F36, F38 y F39: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- `patientLatitude` y `patientLongitude` — `DataTypes.DECIMAL(10, 7)`, `allowNull: true`, como en `src/models/healthFacility.model.ts` y `src/models/investigation.model.ts`.
- `hadSimilarEvent` — `DataTypes.ENUM(...ANSWER_OPTIONS)`, `allowNull: true`, importando `ANSWER_OPTIONS` y el tipo `AnswerOption` de `src/constants/enums.constants.ts`.
- Los cuatro contadores — `DataTypes.SMALLINT`, `allowNull: true`. **`SMALLINT` y no `INTEGER`**: que el tipo del modelo coincida con el de la columna es lo que hace que el techo de 32767 sea una propiedad declarada y no un accidente. Es la decisión de F36.
- Las tres columnas de texto — `DataTypes.TEXT`, `allowNull: true`. **Ninguna lleva longitud**, porque ninguna es `varchar` en el DDL.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationCommunity.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationCommunity.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationCommunity, { as: 'community', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `community` no colisiona con `source` (F29), `autopsy` (F30), `teamMembers` (F31), `medicalHistory` (F32), `clinicalEvaluation` (F34), `vaccinationContext` (F36), `vaccinesAdministered` (F37), `coldChain` (F38) ni `administrationError` (F39).

**Dos asociaciones y ninguna más.** No hay ninguna FK a `catalogItem`, así que no hay ni un `include` de catálogo en todo el spec.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `community` **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationCommunity.types.ts`, junto a los del resto del dominio, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationCommunityInput {
    investigationId: string;
    patientLatitude?: number | null;
    patientLongitude?: number | null;
    hadSimilarEvent?: AnswerOption | null;
    similarEventDescription?: string | null;
    similarEventCount?: number | null;
    affectedVaccinated?: number | null;
    affectedUnvaccinated?: number | null;
    affectedUnknown?: number | null;
    otherComments?: string | null;
    notes?: string | null;
}
```

**`investigationId` es el único campo obligatorio del tipo.** Los diez restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo.

**Las coordenadas se declaran `number | null`** aunque `pg` las devuelva como cadena. Es lo que hizo F28 con las suyas, y la comparación numérica del helper es la que absorbe la diferencia en el `004`.

`AnswerOption` se importa de `src/constants/enums.constants.ts`; **no se declara ningún tipo nuevo de enumerado**.

El update usa `Partial<CreateInvestigationCommunityInput>`. **No se declara `UpdateInvestigationCommunityInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Los cinco campos del bloque se declaran como una constante local del servicio, para que el forzado a `null` se escriba una sola vez y no como cinco asignaciones sueltas:

```ts
const SIMILAR_EVENT_FIELDS = [
    'similarEventDescription',
    'similarEventCount',
    'affectedVaccinated',
    'affectedUnvaccinated',
    'affectedUnknown',
] as const;
```

**El orden del array no significa nada**: no hay precedencia entre los cinco. `similarEventDescription` va primera solo porque es la única obligatoria. No va a `src/constants/investigation.constants.ts` porque solo lo consume este servicio, igual que F27, F32, F34, F36, F38 y F39 mantuvieron locales sus listas.

### 3.4 Superficie HTTP

```
POST   /api/investigation-communities                ESAVI-INVCOMM-001   USER        (nuevo)
GET    /api/investigation-communities                ESAVI-INVCOMM-002A  USER        (nuevo)
GET    /api/investigation-communities/admin          ESAVI-INVCOMM-002B  ADMIN       (nuevo)
DELETE /api/investigation-communities/purge/:id      ESAVI-INVCOMM-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-communities/case/:caseId   ESAVI-INVCOMM-006   USER        (nuevo)
GET    /api/investigation-communities/:id            ESAVI-INVCOMM-003   USER        (nuevo)
PUT    /api/investigation-communities/:id            ESAVI-INVCOMM-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationCommunity.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14 y F28 a F39, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar el registro comunitario es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationCommunity` · `006` · obtener el registro comunitario de un caso — la cadena `caso → investigación → comunidad` es uno a uno en los dos saltos**.

**La abreviatura es `INVCOMM`.** Siete letras, no colisiona con las registradas y `grep "ESAVI-INVCOMM-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-INVTEAM-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-`, `ESAVI-INVCLIEV-`, `ESAVI-INVVACTX-`, `ESAVI-INVVACAD-`, `ESAVI-INVCOLD-`, `ESAVI-INVADMER-` ni `ESAVI-EVALINST-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

Las dos reglas del bloque miran el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resulting(campo) = data[campo] !== undefined ? (data[campo] ?? null) : stored[campo]
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**La distinción por presencia sí hace falta, y solo en un sitio:** la asimetría `001`/`004` de los campos prohibidos, que es la de F34 y no una regla nueva. La obligación de la descripción **no** la usa: mira únicamente el resultante.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| Coordenadas con `.isDecimal({ decimal_digits: '0,7' })`, admitiendo `null` | validador | 400 `common.validationError` |
| `patientLatitude` en `[-90, 90]` y `patientLongitude` en `[-180, 180]` | validador | 400 `common.validationError` |
| `hadSimilarEvent` dentro de `ANSWER_OPTIONS`, admitiendo `null` | validador | 400 `common.validationError` |
| Los cuatro contadores con `.isInt({ min: 0, max: 32767 })`, admitiendo `null` | validador | 400 `common.validationError` |
| Las tres columnas de texto como cadena, **sin tope de longitud** | validador | 400 `common.validationError` |
| Algún campo del bloque con valor y el bloque cerrado | **servicio** | 400 `INVCOMM_<op>_SIMILAR_EVENT_FIELDS_NOT_ALLOWED` |
| Bloque abierto y `similarEventDescription` resultante en `null` | **servicio** | 400 `INVCOMM_<op>_SIMILAR_EVENT_DESCRIPTION_REQUIRED` |

**Los cuatro `CHECK` del DDL sí se replican en el validador**, con su techo de `smallint`, igual que en F36: sin el techo, un `40000` sería un 500 de Postgres en vez de un 400 legible.

**El rango geográfico se replica aunque el DDL no lo declare.** `numeric(10,7)` admite hasta `999.9999999`, así que una latitud de `500` entraría sin protesta de Postgres y se guardaría como un domicilio imposible. §6 razona por qué esto se aparta de F28.

**No hay ninguna validación de FK contra catálogo**, porque no hay ninguna FK a catálogo. Como F38 y F39, el servicio no consulta otra tabla más que `investigation`.

#### El bloque del evento similar

**Solo `hadSimilarEvent` resultante `'YES'` abre el bloque.** `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y `null` lo cierran, los cinco por igual. La lógica del formulario es directa: si no hubo evento similar, o no se sabe, no hay nada que describir ni a quién contar.

**Con el bloque cerrado**, los cinco campos están **prohibidos**, con la asimetría de F34, F36, F38 y F39:

- **`001` — es 400.** Mandar cualquiera de ellos con valor —incluido un `0` en un contador— junto a un `hadSimilarEvent` que no es `'YES'` es `INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente los manda.** Los que **no viajan** se **fuerzan a `null`**: cerrar el bloque limpia los cinco campos sin pedir permiso ni devolver error. Los que **viajan con valor** producen 400 `INVCOMM_004_SIMILAR_EVENT_FIELDS_NOT_ALLOWED`. Mandarlos en `null` **no** es error: es el mismo destino al que el forzado llega solo.

**`0` cuenta como valor y no como ausencia.** Es exactamente el caso que §11 advierte: un `if( data.affectedVaccinated )` trataría el `0` como si no hubiera llegado, y ese cero significa «ninguno de los afectados estaba vacunado», que es la respuesta más informativa que este bloque puede dar.

**Con el bloque abierto, `similarEventDescription` es obligatoria.** Si su valor resultante es `null` → 400 `INVCOMM_<op>_SIMILAR_EVENT_DESCRIPTION_REQUIRED`. Tres consecuencias, y las tres son norma:

- **`POST { investigationId, hadSimilarEvent: 'YES' }` a secas es 400.** No se puede abrir el bloque y dejarlo sin describir. El alta vacía de §2 sigue funcionando porque `null` cierra el bloque.
- **La regla se evalúa sobre el estado resultante, no sobre el body.** Un `PUT { notes: 'x' }` sobre una fila con el bloque abierto y descrito **no** falla: la descripción guardada cuenta.
- **Un `PUT { similarEventDescription: null }` sobre una fila con el bloque abierto es 400.** Para vaciarla hay que mandar `hadSimilarEvent` a otro valor **en la misma petición**; entonces el bloque queda cerrado, la obligación no aplica y los cinco campos se fuerzan a `null`.

**Los cuatro contadores siguen siendo opcionales con el bloque abierto**, y no se validan unos contra otros: `affectedVaccinated + affectedUnvaccinated + affectedUnknown` **no** tiene que sumar `similarEventCount`.

**El orden entre las dos reglas es fijo: la prohibición primero, la obligación después.** Un body con `hadSimilarEvent: 'NO'` y `similarEventDescription: 'hubo tres casos'` recibe `SIMILAR_EVENT_FIELDS_NOT_ALLOWED`, **nunca** `SIMILAR_EVENT_DESCRIPTION_REQUIRED`. Con el bloque cerrado la obligación ni se evalúa. Es la precedencia que fijó F36: el error que se devuelve es el del problema de fuera, no el del de dentro.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** los cinco campos entran en `candidates` **siempre** que el bloque esté cerrado, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difieren. Si la fila ya los tenía en `null`, el diff no encuentra nada y **no se escribe**: cerrar un bloque ya cerrado no crece `appDetails`.

#### Los campos sin ninguna regla

**Las dos coordenadas.** `patientLatitude` y `patientLongitude` son independientes entre sí y de todo lo demás. Mandar una sin la otra se guarda tal cual. No hay regla de par, ni relación con las coordenadas de vacunación de `investigation`.

**`otherComments` y `notes`.** Texto libre siempre abierto, las dos. Se guardan aunque el bloque esté cerrado.

**Que estos cuatro campos no tengan reglas es una decisión declarada, no un olvido**, y §6 la razona.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Un registro comunitario cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVCOMM-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVCOMM_001_INVESTIGATION_NOT_FOUND`.
2. Esa investigación **no tiene ya registro comunitario**, buscando **sin filtrar por `deletedAt`** → 409 `INVCOMM_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fila sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. El bloque, en su variante estricta: **primero** la prohibición si está cerrado, **después** la obligación de la descripción si está abierto.
4. Normaliza: `.trim()` sobre las tres columnas de texto.
5. Inserta con la entrada de auditoría `method: 'ESAVI-INVCOMM-001'`.

**El alta mínima es `{ investigationId }`** y devuelve 201 con las diez columnas de datos en `null`.

**`ESAVI-INVCOMM-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**`ESAVI-INVCOMM-002B` — listar, admin.** Idéntica, con el include del padre en `where: {}`: devuelve también los registros de investigaciones inactivas. Los mismos dos filtros y el mismo orden.

**`ESAVI-INVCOMM-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVCOMM_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVCOMM-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVCOMM_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVCOMM_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene registro comunitario → 404 `INVCOMM_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVCOMM-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVCOMM_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Un registro comunitario no se traslada entre investigaciones.
3. Cálculo del estado resultante, la prohibición y la obligación. **Antes del diff y con independencia de él.**
4. `stored` sale de `community.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `patientLatitude` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. `DECIMAL`: vuelve de `pg` como cadena; lo resuelve la regla numérica del helper. `0` es valor |
| `patientLongitude` | ídem anterior | anulable, `DECIMAL`. `0` es valor |
| `hadSimilarEvent` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Es la bandera: nunca se fuerza** |
| `similarEventDescription` | bloque **abierto**: `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` · bloque **cerrado**: **`null` siempre** | derivado condicional, `.trim()` antes de comparar. Con el bloque abierto su resultante **no puede ser `null`** |
| `similarEventCount` | bloque **abierto**: `data.x !== undefined ? (data.x ?? null) : undefined` · bloque **cerrado**: **`null` siempre** | derivado condicional. `0` es valor, nunca ausencia |
| `affectedVaccinated` | ídem anterior | derivado condicional |
| `affectedUnvaccinated` | ídem anterior | derivado condicional |
| `affectedUnknown` | ídem anterior | derivado condicional |
| `otherComments` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Fuera del bloque: nunca forzado ni prohibido** |
| `notes` | `data.x !== undefined ? (data.x?.trim() ?? null) : undefined` | anulable, `.trim()`. **Fuera del bloque: nunca forzado ni prohibido** |

**Cinco campos derivados condicionales y cinco anulables directos.** Ningún campo cifrado y ningún derivado incondicional: no hay nada que esta entidad recalcule en cada `PUT`.

**`ESAVI-INVCOMM-005C` — borrado físico.** SUPERADMIN. `assertRowIsSealed` sobre `deletedAt` → 409 `INVCOMM_005C_NOT_DELETED` si la fila sigue viva. Después `purgeEntityService`, cuyo control de `isActive` es inerte aquí. Volcado al log en `warn` antes del `destroy`. **No toca `appDetails`**: la fila desaparece en la misma transacción. Responde 200 con `{ ok, message }` **sin `data`**.

#### Arrastre del `deletedAt` — tres invocaciones, ningún archivo común modificado

Se cuelga de `satelliteCascade.service.ts` (F32) **sin tocarlo**, junto a las invocaciones que F29, F30, F32, F34, F36, F37, F38 y F39 ya dejaron:

| Origen | Efecto sobre `investigationCommunity` |
|---|---|
| `ESAVI-INVESTGN-005A` | sella `deletedAt` |
| `ESAVI-CASE-005A` | sella `deletedAt` |
| `ESAVI-INVESTGN-005B` | limpia `deletedAt` |
| `ESAVI-INVESTGN-005C` | la fila se destruye por `ON DELETE CASCADE`; volcado al log en `warn` antes del `destroy` del padre |

**El arrastre no es un update diferencial y no pasa por `buildDifferentialUpdate`.** Es una escritura con intención propia: registra que el padre fue retirado, y lo hace aunque ningún campo de datos de esta fila cambie. Es la misma declaración que hicieron F29 a F39, y se repite aquí porque el silencio sería indistinguible del olvido.

### 3.6 Claves i18n nuevas

En `src/data/i18n/es.json`, `en.json` y `nl.json`, bajo `investigationCommunity`:

| Clave | Uso |
|---|---|
| `investigationCommunity.createdSuccess` / `createdFailed` | `001` |
| `investigationCommunity.getSuccess` / `getFailed` | `003` y `006` |
| `investigationCommunity.getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `investigationCommunity.updatedSuccess` / `updatedFailed` | `004` |
| `investigationCommunity.purgeSuccess` / `purgeFailed` | `005C` |
| `investigationCommunity.notFound` | 404 en `003`, `004`, `005C` y `006` |
| `investigationCommunity.investigationNotFound` | 404 de la investigación en `001` y `006` |
| `investigationCommunity.caseNotFound` | 404 del caso en `006` |
| `investigationCommunity.alreadyExists` | 409 en `001`, con `{{investigationId}}` |
| `investigationCommunity.notDeleted` | 409 en `005C` sobre una fila no sellada |
| `investigationCommunity.similarEventFieldsNotAllowed` | 400 con el bloque cerrado y algún campo con valor |
| `investigationCommunity.similarEventDescriptionRequired` | 400 con el bloque abierto y la descripción resultante en `null` |
| `investigationCommunity.idRequired` | parámetro ausente |

**Ninguna clave para las validaciones de forma:** las emite el validador y las responde `validateFields` con `common.validationError`. Los cuatro `CHECK` de contador, el techo de `smallint` y el rango geográfico caen ahí.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

`003`, `006`, `001` y `004` devuelven el objeto completo:

```
{ ok, message, data: {
    investigationId,
    patientLatitude, patientLongitude,
    hadSimilarEvent, similarEventDescription, similarEventCount,
    affectedVaccinated, affectedUnvaccinated, affectedUnknown,
    otherComments, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    investigation: { investigationId, caseId, isActive }
} }
```

**El include de `investigation` viaja acotado a tres campos.** Es lo que el cliente necesita para saber de qué caso cuelga la fila y si su padre está vivo; devolver la investigación entera duplicaría la carga útil de `ESAVI-INVESTGN-003`.

**No hay ningún include de catálogo.** `hadSimilarEvent` es una cadena del ENUM y no resuelve contra nada.

`002A` y `002B` devuelven `{ count, rows }` de `findAndCountAll`, **con cada fila en la misma forma completa**. No hay forma reducida como en F28: diez columnas por elemento no justifican dos contratos distintos, y las coordenadas —que es lo que F28 se preocupó de conservar en su listado— aquí van igualmente.

`005C` responde **solo** `{ ok, message }`, sin `data`, según §10 de las convenciones.

**`sysDetails` no se expone en ninguna operación.** `isActive` no aparece porque la columna no existe.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registro de la abreviatura y de la operación no canónica.** Alta de `investigationCommunity` → `INVCOMM` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y de la fila `investigationCommunity` · `006` en la tabla de operaciones no canónicas.
   *Verificación:* `grep -n "INVCOMM" references/CONVENTIONS.md` devuelve las dos filas; la abreviatura no aparece dos veces en la tabla.

2. **Modelo y asociaciones.** `src/models/investigationCommunity.model.ts` con las diez columnas de datos, `timestamps: false`, `freezeTableName: true`, PK **sin** `defaultValue` y **sin** atributo `isActive`. Las dos coordenadas como `DECIMAL(10, 7)`, `hadSimilarEvent` como `ENUM(...ANSWER_OPTIONS)`, los cuatro contadores como `SMALLINT` y las tres columnas de texto como `TEXT` sin longitud. `src/models/associations/investigationCommunity.associations.ts` con el `belongsTo` y el `hasOne` de alias `community`. Alta en `src/models/index.ts` y en `initModels()`.
   *Verificación:* `npm run build` compila; un `findOne` en consola sobre una fila existente devuelve las diez columnas y `investigation` se resuelve por el include.

3. **Tipos.** `src/types/investigation/investigationCommunity.types.ts` con `CreateInvestigationCommunityInput`, las dos coordenadas y los cuatro contadores como `number | null`, `hadSimilarEvent` como `AnswerOption | null`. Alta en el barrel del dominio.
   *Verificación:* `npm run build` compila; `grep -rn "UpdateInvestigationCommunityInput" src/` no devuelve resultados.

4. **Claves i18n.** Las trece claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

5. **Validadores.** `src/validators/investigationCommunity.validator.ts` con cinco arrays: `investigationCommunityIdValidator`, `investigationCommunityCaseIdValidator` (para el `param('caseId')` del `006`), `investigationCommunityListValidator` (los dos filtros más `limit` y `offset`), `createInvestigationCommunityValidator` y `updateInvestigationCommunityValidator`. El de create exige `investigationId` UUID; los dos de cuerpo comparten las coordenadas con `.isDecimal({ decimal_digits: '0,7' })` **más el rango** —`[-90, 90]` y `[-180, 180]`—, `hadSimilarEvent` con `.isIn(ANSWER_OPTIONS)`, los cuatro contadores con `.isInt({ min: 0, max: 32767 })` y las tres columnas de texto con `.isString()` y **sin `.isLength()`**. Todos admiten `null`. **Ni la prohibición ni la obligación del bloque van aquí:** dependen del estado guardado y viven en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `POST` con `hadSimilarEvent: 'MAYBE'` responde 400 `common.validationError`; con `patientLatitude: 500` también; con `patientLatitude` de ocho decimales también; con `similarEventCount: -1` y con `similarEventCount: 40000` también; con `notes` de 5000 caracteres responde **201**, no 400.

6. **`ESAVI-INVCOMM-001` — crear.** Servicio, controlador y ruta, con las dos guardas del alta, la prohibición del bloque, la obligación de la descripción **después** de la prohibición, el `.trim()` de las tres columnas de texto y la entrada de auditoría.
   *Verificación:* `POST { investigationId }` de una investigación activa devuelve **201** con las diez en `null`; repetirlo devuelve **409**; con una investigación inactiva devuelve **404**; `POST { investigationId, hadSimilarEvent: 'YES' }` a secas devuelve **400** `similarEventDescriptionRequired`; con `'YES'` y descripción devuelve **201** aunque no lleve ningún contador; `{ hadSimilarEvent: 'NO', similarEventCount: 0 }` devuelve **400** `similarEventFieldsNotAllowed` —el cero es valor—; `{ hadSimilarEvent: 'NO', similarEventDescription: 'x' }` devuelve **400** `similarEventFieldsNotAllowed` y **no** `similarEventDescriptionRequired`.

7. **`ESAVI-INVCOMM-002A` y `002B` — listados.** Los dos servicios, el controlador único que bifurca por `canViewInactive`, las dos rutas con `/admin` declarada antes de `/:id`, los dos filtros y el orden `createdAt DESC`.
   *Verificación:* una fila cuya investigación está inactiva no aparece en `GET /` y sí en `GET /admin`; un USER recibe 403 en `/admin`; `GET /?caseId=<uuid inexistente>` devuelve 200 con `{ count: 0, rows: [] }`; toda fila trae las dos coordenadas y no trae `sysDetails`.

8. **`ESAVI-INVCOMM-003` — obtener por ID.** Con la visibilidad heredada y el include acotado a tres campos de `investigation`.
   *Verificación:* un `investigationId` inexistente devuelve 404; una fila de investigación inactiva devuelve 404 para USER y ADMIN y 200 para SUPERADMIN.

9. **`ESAVI-INVCOMM-006` — obtener por caso.** Ruta `/case/:caseId` declarada antes de `/:id`, con los tres 404 distintos.
   *Verificación:* los tres códigos —`CASE_NOT_FOUND`, `INVESTIGATION_NOT_FOUND`, `NOT_FOUND`— se obtienen cada uno con su escenario; la respuesta es el objeto y no `{ count, rows }`.

10. **`ESAVI-INVCOMM-004` — actualizar.** La prohibición y la obligación sobre el estado resultante, **antes del diff**; `buildDifferentialUpdate` con la tabla de `candidates` de §3.5; `investigationId` ignorado en silencio; `updatedAt` escrito por la aplicación.
    *Verificación:* reenviar íntegra la respuesta del `GET` responde 200 sin escribir nada; cambiar solo `notes` añade **una** entrada a `appDetails`; un `PUT { notes: 'x' }` sobre una fila con el bloque abierto y descrito responde **200** y no dispara la obligación; un `PUT { similarEventDescription: null }` sobre esa fila responde **400**; cerrar `hadSimilarEvent` en el mismo `PUT` deja los cinco campos del bloque en `null` sin error; `PUT { patientLatitude: 0 }` guarda `0` y no `null`.

11. **`ESAVI-INVCOMM-005C` — borrado físico.** Ruta `/purge/:id` declarada antes de `/:id`, `assertRowIsSealed`, `purgeEntityService`, volcado al log en `warn`.
    *Verificación:* purgar una fila sin `deletedAt` devuelve **409**; con `deletedAt` sellado devuelve **200** sin `data`, y `src/logs/esaviLog.log` contiene la línea `warn` con `ESAVI-INVCOMM-005C` y el volcado de la fila.

12. **Arrastre del `deletedAt`.** Tres invocaciones de `satelliteCascade.service.ts` —dos de sellado y una de limpieza— en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, junto a las existentes. Volcado al log de la fila arrastrada en `ESAVI-INVESTGN-005C`.
    *Verificación:* `DELETE /api/investigations/:id` sella el `deletedAt` del registro comunitario; `PATCH /api/investigations/activate/:id` lo limpia; `DELETE /api/esavi-cases/:id` lo sella también. Las suites de F29 a F39 siguen pasando sin tocar un caso.

13. **Alta en `ROUTE_RULES`.** Las siete rutas de §3.4 en `tests/auth/roles.test.ts`, con su rol mínimo y su código de operación.
    *Verificación:* `npm test -- roles` sale en 0 y falla si se comenta cualquiera de las siete filas.

14. **Suite de contrato.** `tests/contract/investigationCommunity.test.ts` con el recorrido completo, más los casos propios: alta vacía, duplicado, la obligación de la descripción en `001` y `004`, **la precedencia de la prohibición sobre la obligación**, la asimetría `001`/`004`, la opcionalidad de los cuatro contadores, la independencia de las dos coordenadas, el rango geográfico, el techo de `smallint` y los cinco criterios de update diferencial de §5.
    *Verificación:* `npm test` sale en 0.

15. **Ampliación de las suites del padre.** `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.
    *Verificación:* `npm run check` sale en 0.

**Dos casos de la suite merecen mención porque no salen del recorrido normal.** El primero es la **precedencia**: hace falta un caso que mande `hadSimilarEvent: 'NO'` **con** descripción y espere `similarEventFieldsNotAllowed`, porque una implementación que evalúe la obligación primero devuelve el otro código y todos los demás casos del bloque pasan igual. El segundo es la **opcionalidad de los contadores**: un `POST` con `'YES'`, descripción y **ningún** contador debe devolver 201, porque es la única red que impide que un mantenedor futuro lea el *required* del DDL como «los cinco» y rompa el contrato en silencio.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación —ruta, controlador, servicio, `AppError` y `appDetails.method`— coinciden en las siete operaciones. En `005C` son **cuatro**: no hay `appDetails.method` porque la fila se destruye.
- [ ] `grep -rn "ESAVI-INVCOMM-002[^AB]" src/` no devuelve resultados.
- [ ] `grep -rn "ESAVI-INVCOMM-005[AB]" src/` no devuelve resultados: esta entidad no tiene activación ni borrado lógico propio.
- [ ] `grep -rn "isActive" src/models/investigationCommunity.model.ts src/services/investigationCommunity.service.ts` solo devuelve las líneas del `where` del include de `investigation`.
- [ ] `references/CONVENTIONS.md` §6 lista `INVCOMM` en la tabla de abreviaturas y la operación `006` en la de no canónicas.
- [ ] `git diff --stat esaviapp.sql` está vacío: **este spec no toca el DDL en ninguna línea**.

**Alta y unicidad**

- [ ] `POST { investigationId }` de una investigación activa devuelve **201** con las diez columnas de datos en `null`.
- [ ] Repetir ese `POST` devuelve **409** `INVCOMM_001_ALREADY_EXISTS`, y sigue devolviéndolo cuando la fila existente tiene `deletedAt` sellado.
- [ ] `POST` sobre una investigación inactiva o inexistente devuelve **404** `INVCOMM_001_INVESTIGATION_NOT_FOUND`.

**Polaridad y prohibición del bloque**

- [ ] `POST { hadSimilarEvent: 'NO', similarEventDescription: 'tres casos en el barrio' }` devuelve **400** `INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED`.
- [ ] Lo mismo con `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'` y sin la bandera: los cinco estados cierran por igual.
- [ ] `POST { hadSimilarEvent: 'NO', similarEventCount: 0 }` devuelve **400** con el mismo código: **el cero es valor, no ausencia**.
- [ ] `POST { hadSimilarEvent: 'YES', similarEventDescription: 'x' }` devuelve **201**.

**Precedencia entre las dos reglas**

- [ ] `POST { hadSimilarEvent: 'NO', similarEventDescription: 'x' }` devuelve `similarEventFieldsNotAllowed` y **nunca** `similarEventDescriptionRequired`. Una implementación que evalúe la obligación primero falla aquí y solo aquí.

**Obligación de la descripción**

- [ ] `POST { investigationId, hadSimilarEvent: 'YES' }` a secas devuelve **400** `INVCOMM_001_SIMILAR_EVENT_DESCRIPTION_REQUIRED`.
- [ ] `POST { hadSimilarEvent: 'YES', similarEventDescription: 'x' }` **sin ningún contador** devuelve **201**: los cuatro contadores siguen siendo opcionales con el bloque abierto.
- [ ] `POST { hadSimilarEvent: 'YES', similarEventCount: 3 }` **sin descripción** devuelve **400** `similarEventDescriptionRequired`: los contadores no sustituyen a la descripción.
- [ ] `PUT { notes: 'x' }` sobre una fila con el bloque abierto y descrito devuelve **200**: la obligación mira el estado resultante, no el body.
- [ ] `PUT { similarEventDescription: null }` sobre esa misma fila devuelve **400** `INVCOMM_004_SIMILAR_EVENT_DESCRIPTION_REQUIRED`.
- [ ] Ese mismo `PUT` acompañado de `hadSimilarEvent: 'NO'` devuelve **200** y deja los cinco campos del bloque en `null`.

**Asimetría `001` / `004`**

- [ ] `PUT { hadSimilarEvent: 'NO' }` sobre una fila con el bloque abierto y poblado devuelve **200** y deja los cinco campos en `null`, sin error.
- [ ] `PUT { hadSimilarEvent: 'NO', similarEventCount: 2 }` devuelve **400** `INVCOMM_004_SIMILAR_EVENT_FIELDS_NOT_ALLOWED`.
- [ ] `PUT { hadSimilarEvent: 'NO', similarEventCount: null }` devuelve **200**: mandarlo en `null` no es error.

**Los campos sin reglas**

- [ ] `POST { patientLatitude: -0.1806532 }` **sin** `patientLongitude` devuelve **201**: las dos coordenadas son independientes.
- [ ] `POST { patientLatitude: 0, patientLongitude: 0 }` guarda `0` en las dos y no `null`.
- [ ] `otherComments` y `notes` se guardan con el bloque cerrado: están fuera de él.
- [ ] `POST` con `similarEventCount: 2` y los tres `affected*` sumando `9` devuelve **201**: **no hay validación de coherencia entre contadores**.

**Validaciones de forma**

- [ ] `patientLatitude: 500` → **400**, y `patientLongitude: 200` → **400**: el rango se replica aunque el DDL no lo declare.
- [ ] `patientLatitude` con ocho decimales → **400**, no un error de Postgres.
- [ ] `similarEventCount: -1` → **400**, y `similarEventCount: 40000` → **400**: el `CHECK >= 0` y el techo de `smallint` se replican los dos.
- [ ] Los cuatro contadores están declarados en el modelo como `SMALLINT`, no como `INTEGER`.
- [ ] `notes` de 5000 caracteres → **201**: las tres columnas de texto no tienen tope.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationCommunity.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada. *En esta entidad el segundo caso no aplica —no hay `code` ni ninguna `UNIQUE`—; el primero se verifica con un `PUT` sobre una fila cuya investigación está inactiva, que responde **404** para USER y ADMIN.*
- [ ] Reenviar la misma `patientLatitude` que devolvió el `GET` **no** cuenta como cambio, pese a que `pg` la entrega como cadena y el body la manda como número.
- [ ] Un `PUT` que cierra un bloque ya cerrado —`hadSimilarEvent: 'NO'` sobre una fila con los cinco campos ya en `null`— **no escribe nada**: el forzado a `null` pasa por el diff como cualquier otro candidato.
- [ ] Un `PUT` que reenvía `affectedVaccinated: 0` sobre una fila que ya lo tenía en `0` no escribe nada: **el cero se compara como valor**, no se descarta como ausencia.
- [ ] Un `PUT` que solo cambia el espaciado de `notes` —`' texto '` sobre `'texto'`— **no escribe nada**: el `.trim()` se aplica antes de comparar.
- [ ] `PUT { investigationId: '<otro uuid>' }` devuelve **200** sin escribir nada y sin 400: el campo se ignora en silencio.

**Visibilidad y lecturas**

- [ ] Una fila cuya investigación está inactiva devuelve **404** en `003`, `004` y `006` para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] `GET /` no la devuelve; `GET /admin` sí.
- [ ] Los filtros `investigationId` y `caseId` son acumulativos y por igualdad; con un UUID inexistente devuelven **200** con `{ count: 0, rows: [] }`.
- [ ] `006` devuelve el objeto, no `{ count, rows }`, y distingue los tres 404 con códigos distintos.
- [ ] Las cuatro operaciones que devuelven el objeto, **y también las filas de los dos listados**, exponen las diez columnas de datos más `createdAt`, `updatedAt`, `deletedAt`, `appDetails` y el `investigation` acotado a tres campos, y **no exponen `sysDetails`**.

**Borrado físico y arrastre**

- [ ] `DELETE /purge/:id` sobre una fila sin `deletedAt` devuelve **409** `INVCOMM_005C_NOT_DELETED`.
- [ ] `DELETE /purge/:id` sobre una fila sellada devuelve **200** con `{ ok, message }` y **sin `data`**, y deja en `src/logs/esaviLog.log` una línea `warn` con el código de operación y el volcado de la fila.
- [ ] `ESAVI-INVESTGN-005A` y `ESAVI-CASE-005A` sellan el `deletedAt` del registro comunitario; `ESAVI-INVESTGN-005B` lo limpia.
- [ ] `ESAVI-INVESTGN-005C` destruye la fila por cascada y deja su volcado en el log antes del `destroy` del padre.
- [ ] Las suites de contrato de F29 a F39 pasan sin modificar un solo caso.

**Cierre**

- [ ] Las trece claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] Las siete rutas están en `ROUTE_RULES` de `tests/auth/roles.test.ts`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la forma de la entidad**

- **Sí:** calcar la forma de F38 y F39 —PK que es FK, sin `isActive`, listado dual, `006` por caso, `005C` con `assertRowIsSealed`, arrastre por los tres caminos—. Es la décima satélite de `investigation` y la novena con esta forma exacta; inventar una variante aquí solo añadiría un caso especial que el cliente tendría que aprender.
- **No:** añadir `isActive` a la tabla. Sería modificar el DDL para darle a un satélite un estado propio que su padre ya define. Es la decisión de F13 y F14, heredada sin reabrirse.
- **No:** `005A` ni `005B`. Sin `isActive` no hay estado que activar, y fabricarlo sobre `deletedAt` daría dos mecanismos de retirada para la misma fila.
- **No:** fundir esta entidad con `investigationVaccinationContext` (F36). Las dos hablan de casos múltiples —`isCluster` allí, `hadSimilarEvent` aquí— pero son dos tablas distintas con dos PK distintas, y unirlas exigiría inventar un esquema que el DDL no tiene.

**Sobre la lectura del *required* del comentario `:1243`**

- **Sí:** implementarlo como **`similarEventDescription` obligatoria y los cuatro contadores opcionales**. La pregunta que el bloque hace es «¿qué pasó en la comunidad?», y su respuesta mínima es la descripción. Los números son un desglose que el informante puede no tener cuando se abre la investigación.
- **No:** leerlo como «permitido y opcional», que es lo que hicieron F34, F36 y F38. Aquí dejaría abrir el bloque y no registrar nada: una fila que declara que hubo un evento similar y no dice cuál. Eso es exactamente lo que el bloque existe para evitar.
- **No:** leerlo como «al menos uno de los cinco», que es lo que hizo F39 con sus jeringas. Permitiría satisfacer la regla con un `affectedUnknown: 4` y sin descripción — un número de afectados por un evento que nadie describió. En F39 los cuatro booleanos eran **respuestas equivalentes** a la misma pregunta y cualquiera valía; aquí los cinco campos **no** son equivalentes: uno es el hecho y cuatro son su medida.
- **No:** leerlo como «los cinco obligatorios». Convertiría cada `PUT` parcial en un 400 salvo que el cliente reenviara el bloque entero — justo lo que el update diferencial de F12 vino a evitar—, y obligaría a inventar cifras que nadie conoce.
- **Sí:** evaluar la obligación sobre el estado resultante, de modo que un `PUT { notes: 'x' }` sobre una fila ya descrita no falle. Evaluarla sobre el body convertiría cualquier update parcial de una fila con el bloque abierto en un 400.
- **Sí:** que un `PUT { similarEventDescription: null }` sea 400, con la salida de cerrar la bandera en la misma petición. La alternativa —cerrar el bloque automáticamente al vaciar la descripción— tomaría por el cliente una decisión que cambia el significado de la respuesta a la pregunta principal.

**Sobre la precedencia entre las dos reglas**

- **Sí: la prohibición corre antes que la obligación.** Un body con `hadSimilarEvent: 'NO'` y descripción recibe `similarEventFieldsNotAllowed`, no `similarEventDescriptionRequired`. El error que se devuelve es el del problema de fuera, no el del de dentro. Es literalmente la decisión de F36 con su regla del vial compartido.
- **Sí:** un criterio de aceptación dedicado a la precedencia. Es el único que falla si el orden se invierte; todos los demás casos del bloque pasan igual.

**Sobre las coordenadas del domicilio**

- **No:** cifrar `patientLatitude` ni `patientLongitude`. `esaviCrypt` produce texto y las columnas son `numeric(10,7)`: cifrarlas exigiría cambiar el tipo en el DDL, migrar las filas ya cargadas y renunciar a toda comparación numérica sobre ellas — incluida la del update diferencial. Es un spec propio, no una línea de éste.
- **Sí:** dejar escrito que **no es el mismo caso que F28**. Aquélla razonó que no cifraba porque sus coordenadas eran del punto de vacunación y no del domicilio; aquí son el domicilio y el nombre de la columna lo dice. Callarlo dejaría el precedente de F28 cubriendo un caso que no cubre. §7 lo declara riesgo abierto.
- **Sí:** validar el rango geográfico —`[-90, 90]` y `[-180, 180]`—, apartándose de F28, que solo valida los decimales. `numeric(10,7)` admite hasta `999.9999999`, así que sin el rango una latitud de `500` se guarda como un domicilio imposible y nadie se entera. Es el mismo razonamiento que llevó a F36 a replicar el techo de `smallint`: lo que el tipo no protege, lo protege el validador.
- **No:** propagar ese rango a F28 en este spec. Es una corrección de otra entidad y le corresponde su propio cambio; aquí solo se declara la divergencia.
- **No:** tratar las dos coordenadas como un par indivisible. Un informante puede aportar media coordenada tanto como puede no aportar ninguna, y exigir el par crearía un 400 que ningún criterio del formulario respalda. Es lo que hace F28.

**Sobre los contadores**

- **Sí:** replicar en el validador el `CHECK >= 0` **y** el techo de 32767. Sin el techo, un `40000` llega a Postgres y vuelve como 500 por desbordamiento de tipo. Es la decisión de F36.
- **Sí:** `SMALLINT` en el modelo, no `INTEGER`. Que el tipo del modelo coincida con el de la columna es lo que hace que el techo sea una propiedad declarada y no un accidente.
- **No:** validar que los tres `affected*` sumen `similarEventCount`. Es plausible como control de calidad, pero el formulario los pregunta por separado y un informante puede conocer el total sin el desglose, o el desglose de una parte sin el total. Un 400 ahí rechazaría datos verdaderos.
- **Sí:** tratar el `0` como valor y no como ausencia, en la prohibición y en el diff. Es el caso que §11 advierte, y aquí es especialmente caro: `affectedVaccinated: 0` significa «ninguno de los afectados estaba vacunado», que es el dato más informativo que este bloque puede dar.

**Sobre lo que este spec deliberadamente no hace**

- **Sí:** no tocar el DDL en ninguna línea. Es el tercer spec de la serie de satélites que no lo modifica, tras F38 y F39, y es una propiedad verificable: `git diff --stat esaviapp.sql` vacío.
- **Sí:** declarar explícitamente que las dos coordenadas, `otherComments` y `notes` **no tienen ninguna regla**. Es una decisión, no una omisión, y sin escribirla el siguiente implementador la leerá como un olvido.
- **No:** unir `otherComments` y `notes` en una sola columna, ni darle regla a ninguna. El DDL las tiene separadas y este spec las respeta separadas, aunque su distinción no esté escrita en ninguna parte.
- **No:** imponer un tope de longitud a las tres columnas de texto. Las tres son `text` en el DDL, sin techo declarado; inventar un límite en el validador crearía un 400 que la base de datos no respalda.
- **No:** cualquier consulta geoespacial —proximidad, distancia al punto de vacunación de F28, agregación por zona—. Sería la primera del repositorio y abre un frente entero: índices, extensión de PostGIS y un contrato de consulta nuevo.
- **No:** derivar un indicador de «brote» de los cuatro contadores. Es un juicio de clasificación, no un dato de investigación, y cruza con `finalClassification`.
- **No:** filtrar el listado por campos de dominio. Sería el primer filtro de ese tipo del repositorio; los dos filtros son los de F29, F32, F34, F36, F38 y F39.
- **No:** forma reducida en el listado, como sí hizo F28. Diez columnas por elemento no justifican dos contratos distintos, y lo que aquélla se preocupó de conservar en su forma reducida —las coordenadas— aquí va igualmente.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El domicilio del paciente viaja sin cifrar.** Es el dato más reidentificable de todo el bloque de investigación: unas coordenadas con siete decimales señalan una vivienda concreta, y cualquier USER que pueda leer la investigación las ve. El paciente está cifrado en su propia tabla, y esta fila deshace en la práctica buena parte de esa protección | **No se mitiga en este spec: se declara.** Cifrar exige cambiar el tipo de las dos columnas en el DDL y migrar lo ya cargado, y §2 lo deja fuera de alcance como spec propio. Lo que sí queda cerrado es que **el precedente de F28 no cubre este caso** —aquéllas eran del punto de vacunación— y que §6 lo dice con esas palabras, para que nadie lo reabra creyendo que ya estaba decidido |
| **La obligación evaluada antes que la prohibición.** Devolvería `similarEventDescriptionRequired` a un cliente cuyo problema real es que el bloque está cerrado, y el formulario le pediría rellenar un campo que no puede rellenar | §3.5 fija el orden y §5 tiene un criterio dedicado. Es el único que falla si el orden se invierte: todos los demás casos del bloque pasan igual |
| **La obligación evaluada sobre el body en vez de sobre el estado resultante.** Convertiría cualquier `PUT` parcial de una fila con el bloque abierto en un 400 — incluido uno que solo cambia `notes` | §3.5 lo declara explícitamente y §5 lo verifica con un `PUT { notes: 'x' }` sobre una fila descrita. Es el mismo error que F38 y F39 evitaron en sus reglas |
| **El *required* leído como «los cinco campos».** Es la lectura literal del comentario del DDL y la más plausible de un implementador que no lea §6: rompería todo `PUT` parcial y obligaría a inventar cifras que nadie conoce | §3.1 fija la lectura junto al comentario, §6 razona las tres alternativas descartadas y §5 la verifica con un `POST` de `'YES'` + descripción y **ningún** contador que debe devolver 201 |
| **El `0` tratado como ausencia.** Un `if( data.affectedVaccinated )` escrito por costumbre lo descartaría en tres sitios: la prohibición del `001`, el forzado del `004` y el diff. «Ninguno de los afectados estaba vacunado» se perdería en silencio | Tres criterios de §5 lo verifican por separado, uno de ellos también sobre `patientLatitude: 0`. §11 lo declara norma |
| **La coordenada reenviada como número contra la guardada como cadena.** `pg` devuelve `DECIMAL` como cadena; un diff ingenuo vería `"−0.1806532" !== -0.1806532` y escribiría en cada `PUT` | Lo absorbe la regla numérica de `buildDifferentialUpdate`, que ya resolvió F28. §5 lo verifica reenviando la respuesta del `GET` |
| **Una latitud imposible aceptada por Postgres.** `numeric(10,7)` admite `999.9999999` y el DDL no tiene `CHECK` de rango: sin la validación, un `500` se guarda y solo se descubre al pintar el mapa | El validador replica el rango, apartándose de F28; §6 razona la divergencia y §5 la verifica con dos criterios |
| **`GET /:id` captura `/admin`, `/purge` o `/case` como UUID** | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por `ROUTE_RULES` |
| **Un `ESAVI-INVESTGN-005C` destruye esta fila sin aviso previo** | Decisión heredada de F13, F29, F30, F32, F34, F36, F38 y F39: se deja disparar la cascada, con el volcado al log en `warn` como única mitigación |

**No hay sección 8.** Este spec solo añade rutas nuevas: no modifica el contrato HTTP de ninguna entidad existente. `investigation` no cambia su respuesta —el inverso `community` no se incluye en ninguna de sus operaciones— y las suites de F29 a F39 pasan sin tocar un caso.

---

## Lo que **no** está en este spec

- **La última satélite de `investigation` que sigue sin spec:** `investigationCovidHistory`.
- **Cifrar las coordenadas del domicilio del paciente**, ni cambiar el tipo de las dos columnas para permitirlo.
- **Cualquier consulta geoespacial:** proximidad, distancia al punto de vacunación de F28, agregación por zona.
- **Validar la coherencia** entre `similarEventCount` y los tres `affected*`.
- **Exigir alguno de los cuatro contadores** con el bloque abierto.
- **Tratar las dos coordenadas como un par indivisible.**
- **Corregir la ausencia de rango geográfico en F28.**
- **Cualquier regla cruzada** con `investigationVaccinationContext`.
- **Derivar un indicador de «brote»** de los cuatro contadores.
- **Filtrar, contar o agregar** por cualquier campo de dominio.
- **Búsqueda por texto** sobre las tres columnas libres, ni topes de longitud sobre ellas.
- **Forma reducida** en el listado.
- **Modificar `esaviapp.sql`** en ninguna línea.
- **Modificar `satelliteCascade.service.ts`, `purgeEntityService`, `assertRowIsSealed` ni `buildDifferentialUpdate`.**
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.**
- **Exponer o editar `sysDetails`.**

Cada uno de esos, si aterriza, va en su propio spec.
