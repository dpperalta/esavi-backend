# SPEC F30 — CRUD de `investigationAutopsy`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), **SPEC F29 (`investigationSource` — hermana directa: aporta el patrón completo de satélite de `investigation`, los tres arrastres del `deletedAt` y el listado dual heredado)**, SPEC F13 (patrón de satélite sin `isActive`), SPEC F14 (`assertRowIsSealed` en `src/helpers/rowSeal.helper.ts`), SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-21
> **Objetivo:** Dar de alta `investigationAutopsy` —el fallecimiento y la autopsia de un caso investigado— como la **segunda** de las catorce tablas satélite de `investigation`.

---

## 1. Por qué existe este spec

`investigationAutopsy` responde al bloque del formulario de investigación que solo se abre cuando el caso fue **mortal**: cuándo murió el paciente, a qué hora, si se le practicó autopsia o si está programada, en qué fecha, y unos comentarios.

Hoy la tabla existe en `esaviapp.sql:976-993` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **segunda de las catorce satélites de `investigation`**, después de la que dio de alta el [SPEC F29](./29-investigationsource-crud.md). Estructuralmente es su calco, y los cuatro rasgos que aquel spec desarrolló se cumplen aquí sin matices. Se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`esaviapp.sql:977`) y destino de `FK_investigationAutopsy_investigation` (`:992`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **cuarta** del repositorio así, tras `severeNotification`, `nonSevereNotification` e `investigationSource`. De ahí salen, igual que allí, menos operaciones de las siete canónicas: **no hay `005A` ni `005B`**.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1369-1373`), así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar.
- **Solo lleva el trigger genérico.** `TRG_investigationAutopsy_setSysDetails`, del bucle de `esaviapp.sql:1284-1298`. **No existe `TRG_investigationAutopsy_setUpdatedAt`**: `updatedAt` lo escribe la aplicación.

**Una corrección al F29.** Su §6 afirma, al justificar por qué no absorbía esta tabla, que `investigationAutopsy` «consume `answerOption` y arrastra fechas y horas». La mitad es falsa: el DDL declara `isDeath`, `isAutopsyPerformed` e `isAutopsyScheduled` como `boolean` planos (`:978`, `:981`, `:982`), no como el ENUM de cinco valores. **Esta entidad no consume `answerOption`.** Lo de las fechas sí es cierto, y es de donde sale todo lo que la separa. La decisión de dividir sigue siendo la correcta; el razonamiento que la sostenía era parcialmente equivocado.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco.** Tres cosas:

**A — Tiene un campo obligatorio, y es el primero de una satélite.** `isDeath` es `NOT NULL DEFAULT true` (`:978`), la única columna de datos no nula de la tabla. En F13, F14 y F29 la fila se abría entera vacía y se completaba con el `PUT`. Aquí no: **el alta exige `isDeath: true` y `deathDate`**. La razón es de dominio, no de esquema — una fila de autopsia sin muerte registrada no es un borrador, es una contradicción.

**B — `deathTime` es la primera columna `time` del repositorio.** Ninguna de las 45 tablas había expuesto ese tipo hasta ahora. Trae un problema propio del update diferencial: Postgres devuelve `'14:30:00'` y un cliente que manda `'14:30'` produciría una diferencia inventada en **cada apertura del formulario**. La normalización a `HH:mm:ss` antes de comparar no es cosmética.

**C — Tiene reglas cruzadas entre fechas, y no solo entre una bandera y su fecha.** F29 tenía una sola regla de coherencia, la de la fuente «otra», y miraba dos columnas. Aquí hay cuatro comprobaciones sobre el estado resultante, dos de ellas temporales y una que **cruza dos fechas distintas** (`autopsyDate` frente a `deathDate`). Es la primera vez que una regla de coherencia del repositorio necesita comparar dos valores guardados que pueden no viajar ninguno de los dos en el body.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationAutopsy`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29 mantuvo.
- **Listado dual `002A` / `002B`**, heredado de F29: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve autopsias cuya investigación está activa; `002B` en `GET /admin` para ADMIN las devuelve todas.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear la segunda autopsia de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVAUT_001_INVESTIGATION_NOT_FOUND`; no tiene ya autopsia, sin filtrar por `deletedAt` → 409 `INVAUT_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la autopsia responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **`isDeath` obligatorio y solo verdadero en el `001`.** Un alta sin la clave, o con `isDeath: false`, es **400**. La fila de autopsia solo existe sobre un fallecimiento.
- **`isDeath` inmutable en el `004`:** se ignora en silencio si llega, sin 400, igual que el `investigationId` de F29.
- **`deathDate` obligatoria en el `001` y no anulable en el `004`.** Es modificable —una fecha se corrige— pero un `deathDate: null` es **400**: vaciarla reabriría por la puerta de atrás lo que el alta prohíbe.
- **Las dos banderas de autopsia son mutuamente excluyentes en `true`.** `isAutopsyPerformed` e `isAutopsyScheduled` resultantes las dos verdaderas es **400**. Combinaciones válidas: una sola en `true`, o las dos en `false` / `null`. No se puede haber practicado una autopsia y tenerla programada a la vez.
- **Cada bandera gobierna su fecha**, evaluado sobre el estado resultante y con la asimetría `001` / `004` de F29: con la bandera no verdadera su fecha está **prohibida**; con la bandera en `true` la fecha **puede faltar** y completarse después por `PUT`.
- **Dos reglas temporales.** `deathDate` y `autopsyDate` no pueden ser futuras. `autopsyDate` no puede ser **anterior** a la `deathDate` resultante. `scheduledAutopsyDate` **sí** puede estar en el pasado: una autopsia programada que nunca se ejecutó es un estado real del dominio, y un registro histórico es la vía normal de cargarla.
- **`deathTime` normalizado a `HH:mm:ss`** antes de comparar en el diff. El validador acepta `HH:mm` y `HH:mm:ss`.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre:** `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica tocar `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, en este último junto a las **siete** funciones hermanas que ya viven ahí tras F29.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto al que F29 ya dejó puesto para la fuente.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVAUT_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación.
- Alta de la abreviatura **`INVAUT`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationAutopsy.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F29** debe estar `Implementado`. No hay dependencia de modelo entre las dos tablas, pero sí de código: este spec añade su arrastre **junto** al de la fuente en los mismos tres puntos de `investigation.service.ts` y `esaviCase.service.ts`, y el volcado de su `005C` va en el mismo bloque.

**Fuera de alcance (otros specs):**

- **Las otras doce satélites de `investigation`:** `investigationTeamMember` (`esaviapp.sql:995-1011`), `investigationCovidHistory` (`1013-1035`), `investigationMedicalHistory` (`1037-1064`), `investigationPregnancyCondition` (`1066-1081`), `investigationClinicalEvaluation` (`1083-1107`), `evaluationInstitution` (`1109-1128`), `investigationVaccinationContext` (`1130-1151`), `investigationVaccineAdministered` (`1153-1168`), `investigationColdChain` (`1170-1193`), `investigationAdministrationError` (`1195-1229`) e `investigationCommunity` (`1231-1249`).
- **Cualquier regla cruzada con `investigationSource`.** Que `autopsyRecord` o `verbalAutopsyRecord` estén marcadas como fuente no obliga a que exista esta fila, ni al revés. Es la simétrica exacta de lo que F29 §2 dejó fuera respecto de esta tabla, y atarlas exige antes decidir cuál manda.
- **Cualquier regla cruzada con `esaviCase`**: que el caso conste como mortal, que su `eventDate` sea anterior a la `deathDate`, o que el desenlace del caso se recalcule al registrar la autopsia. La única fecha que este spec compara es `autopsyDate` contra `deathDate`, las dos de esta misma tabla.
- **Cualquier regla cruzada con `classification` o con el desenlace de la notificación.** Registrar una muerte aquí no toca ninguna otra tabla.
- **Cualquier tablero, conteo o filtro por `isAutopsyPerformed`** —«cuántas investigaciones acabaron en autopsia»—. Si aparece, es su propio spec con la agregación declarada.
- **Filtros booleanos propios en el listado.** Solo los dos de F29.
- **Crear la autopsia automáticamente al dar de alta una investigación**, o al marcar un caso como mortal.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2 y sigue mereciendo su propio spec.
- **Modificar `esaviapp.sql`**: ni añadir `isActive`, ni un `CHECK` sobre las dos banderas o sobre el orden de las fechas, ni meter `investigation` en `preventPhysicalDelete`, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- **Modificar `setEntityActiveStatusService`, `purgeEntityService` o `assertRowIsSealed`.** Los tres se consumen tal cual están.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene autopsia.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión de F13 y F29, heredada sin reabrirse.
- **Cifrado de ningún campo.** La tabla no contiene ni un dato identificativo: dos fechas, una hora, tres booleanos y dos textos. La identidad del fallecido vive en `patient`, no aquí.
- **Búsqueda por texto** sobre `autopsyComments` o `notes`.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationAutopsy` — `esaviapp.sql:976-993`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:977`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationAutopsy_investigation` → `investigation`, `ON DELETE CASCADE` |
| `isDeath` | `boolean` | **no** | `:978`. `DEFAULT true`. La única columna de datos no nula de la tabla |
| `deathDate` | `date` | sí | fecha del fallecimiento. **Obligatoria por regla de negocio**, no por el DDL |
| `deathTime` | `time` | sí | hora del fallecimiento. **Primera columna `time` del repositorio** |
| `isAutopsyPerformed` | `boolean` | sí | tri-estado con `null`. Gobierna `autopsyDate` |
| `isAutopsyScheduled` | `boolean` | sí | tri-estado con `null`. Gobierna `scheduledAutopsyDate` |
| `autopsyDate` | `date` | sí | fecha en que se practicó |
| `scheduledAutopsyDate` | `date` | sí | fecha en que está programada |
| `autopsyComments` | `text` | sí | texto libre sobre el procedimiento |
| `notes` | `text` | sí | texto libre |

**Nueve columnas de datos.** Ocho anulables en el DDL y una no nula, `isDeath`.

**Restricciones.** Una sola clave foránea y nada más: **ninguna `UNIQUE`** —la PK ya lo es—, **ningún `CHECK`** y **ningún índice declarado** más allá del de la clave primaria. Ni la exclusividad de las dos banderas ni el orden de las fechas están en el esquema: **todo lo impone la aplicación**, y por eso §3.5 es la sección larga de este spec.

**Ninguna longitud máxima declarada.** `autopsyComments` y `notes` son `text`, sin `varchar(n)`. No hay ningún límite que replicar en el modelo.

**El tri-estado sobre `boolean`.** `isAutopsyPerformed` e `isAutopsyScheduled` son `boolean` **anulables**, y esa nulabilidad sostiene los tres estados: `true` y `false` son respuestas dadas, `null` es la ausencia de respuesta. Esta entidad **no** consume `answerOption`, pese a lo que afirma F29 §6.

**`isDeath` es la excepción, y no es tri-estado.** Es no nula y este spec la restringe todavía más: solo admite `true`. Ver §3.5 y §6.

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. **Falta `isActive`**, igual que en `severeNotification`, `nonSevereNotification` e `investigationSource`. Es la cuarta tabla del repositorio así.

**Triggers.** Solo `TRG_investigationAutopsy_setSysDetails`, del bucle genérico de `esaviapp.sql:1284-1298`. No hay `preventPhysicalDelete` —la tabla no figura en `esaviapp.sql:1369-1373`—, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco existe `TRG_investigationAutopsy_setUpdatedAt`.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationAutopsy.model.ts`. Clase `InvestigationAutopsy`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationAutopsy'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14 y F29: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- `isDeath` — `DataTypes.BOOLEAN`, `allowNull: false`. **Sin `defaultValue` en el modelo**: el valor lo exige el validador, y un default de aplicación taparía la ausencia de la clave en vez de rechazarla.
- `isAutopsyPerformed`, `isAutopsyScheduled` — `DataTypes.BOOLEAN`, `allowNull: true`.
- `deathDate`, `autopsyDate`, `scheduledAutopsyDate` — **`DataTypes.DATEONLY`**, `allowNull: true`. Nunca `DATE`: la columna es `date` y `DATEONLY` es lo que devuelve la cadena `YYYY-MM-DD` que espera la regla de comparación de `buildDifferentialUpdate`.
- `deathTime` — **`DataTypes.TIME`**, `allowNull: true`. Devuelve una cadena `HH:mm:ss`.
- `autopsyComments`, `notes` — `DataTypes.TEXT`, `allowNull: true`.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationAutopsy.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationAutopsy.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationAutopsy, { as: 'autopsy', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `autopsy` no colisiona con el `source` que F29 declaró sobre el mismo modelo.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationAutopsy.types.ts`, junto a los de `investigation` e `investigationSource`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationAutopsyInput {
    investigationId: string;
    isDeath: boolean;
    deathDate: string;
    deathTime?: string | null;
    isAutopsyPerformed?: boolean | null;
    isAutopsyScheduled?: boolean | null;
    autopsyDate?: string | null;
    scheduledAutopsyDate?: string | null;
    autopsyComments?: string | null;
    notes?: string | null;
}
```

**`isDeath` y `deathDate` son los dos únicos campos obligatorios del tipo**, y es la primera satélite del repositorio que tiene alguno. Las tres fechas viajan como cadena `YYYY-MM-DD` y `deathTime` como `HH:mm` o `HH:mm:ss`; ninguna se tipa como `Date`.

**No hay `isActive` en el tipo**, porque no hay columna. El update usa `Partial<CreateInvestigationAutopsyInput>`. No se declara `UpdateInvestigationAutopsyInput`. `investigationId` e `isDeath` aparecen en el `Partial` por construcción del tipo, pero **el servicio los ignora siempre** en el `004`: los dos son inmutables.

Los campos anulables admiten `| null` explícito: es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo. `deathDate` **no lo admite**, y ésa es la diferencia que §3.5 desarrolla. No se necesita ninguna constante nueva: esta entidad no referencia ningún catálogo.

### 3.4 Superficie HTTP

```
POST   /api/investigation-autopsies                ESAVI-INVAUT-001   USER        (nuevo)
GET    /api/investigation-autopsies                ESAVI-INVAUT-002A  USER        (nuevo)
GET    /api/investigation-autopsies/admin          ESAVI-INVAUT-002B  ADMIN       (nuevo)
DELETE /api/investigation-autopsies/purge/:id      ESAVI-INVAUT-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-autopsies/case/:caseId   ESAVI-INVAUT-006   USER        (nuevo)
GET    /api/investigation-autopsies/:id            ESAVI-INVAUT-003   USER        (nuevo)
PUT    /api/investigation-autopsies/:id            ESAVI-INVAUT-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationAutopsy.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28 y F29, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar una autopsia es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationAutopsy` · `006` · obtener la autopsia de un caso — la cadena `caso → investigación → autopsia` es uno a uno en los dos saltos**.

**La abreviatura es `INVAUT`.** Seis letras, no colisiona con las treinta registradas y `grep "ESAVI-INVAUT-"` no se cruza con `ESAVI-INVESTGN-` ni con `ESAVI-INVSRC-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

Las cuatro reglas de coherencia miran el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado:

```
resultingDeathDate  = data.deathDate  !== undefined ? data.deathDate  : stored.deathDate
resultingPerformed  = data.isAutopsyPerformed !== undefined ? (data.isAutopsyPerformed ?? null) : stored.isAutopsyPerformed
resultingScheduled  = data.isAutopsyScheduled !== undefined ? (data.isAutopsyScheduled ?? null) : stored.isAutopsyScheduled
resultingAutopsyDate = data.autopsyDate !== undefined ? (data.autopsyDate ?? null) : stored.autopsyDate
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Las emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Van **antes** del diff y con independencia de él.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| `isDeath` presente y **estrictamente `true`** (`001`) | validador | 400 `common.validationError` |
| `deathDate` presente y `YYYY-MM-DD` (`001`) | validador | 400 `common.validationError` |
| `deathDate` **no nula** si viaja (`004`) | validador | 400 `common.validationError` |
| `deathDate` y `autopsyDate` **no futuras** | validador | 400 `common.validationError` |
| `deathTime` en `HH:mm` o `HH:mm:ss` | validador | 400 `common.validationError` |
| Las dos banderas resultantes en `true` | **servicio** | 400 `INVAUT_<op>_AUTOPSY_FLAGS_EXCLUSIVE` |
| Fecha prohibida por su bandera | **servicio** | 400 `INVAUT_<op>_AUTOPSY_DATE_NOT_ALLOWED` / `..._SCHEDULED_AUTOPSY_DATE_NOT_ALLOWED` |
| `autopsyDate` anterior a la `deathDate` resultante | **servicio** | 400 `INVAUT_<op>_AUTOPSY_DATE_BEFORE_DEATH` |

Las cuatro obligatoriedades y las dos reglas temporales simples **no necesitan estado guardado**, así que viven en el validador y las responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio. No generan clave i18n propia. `scheduledAutopsyDate` **no** lleva comprobación temporal: puede estar en el pasado.

#### Las cuatro reglas de coherencia

**1 — Exclusividad de las banderas.** `resultingPerformed === true` y `resultingScheduled === true` a la vez es **400** `AUTOPSY_FLAGS_EXCLUSIVE`. No se puede haber practicado una autopsia y tenerla programada al mismo tiempo. Válidas: una sola en `true`, o las dos en `false` / `null` — no haberla hecho y no haberla planificado es un estado normal.

**2 y 3 — Cada bandera gobierna su fecha.** Con la bandera resultante **verdadera**, su fecha es **opcional**: puede faltar en el alta y completarse después por `PUT`. Con la bandera resultante **no verdadera** —`false` o `null`— su fecha está **prohibida**, y aquí las dos operaciones se separan, replicando la asimetría que F29 fijó para la fuente «otra»:

- **`001` — es 400.** Mandar `autopsyDate` junto a un `isAutopsyPerformed` no verdadero es `INVAUT_001_AUTOPSY_DATE_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio una fecha que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente la manda.** Si `autopsyDate` **no viaja en el body**, se **fuerza a `null`**: apagar la bandera limpia su fecha sin pedir permiso ni devolver error. Si **viaja con contenido**, sigue siendo 400 `INVAUT_004_AUTOPSY_DATE_NOT_ALLOWED`: un body que apaga la bandera y a la vez fecha la autopsia se contradice a sí mismo, y tragárselo perdería el dato en silencio haciendo creer al cliente que se guardó. Mandarla en `null` **no** es error: es el mismo destino al que el forzado llega solo.

Idéntico para el par `isAutopsyScheduled` / `scheduledAutopsyDate`.

**El forzado a `null` es un derivado, no una limpieza posterior:** entra en `candidates` **siempre** que la bandera resultante no sea verdadera, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difiere. Si la fila ya tenía la fecha en `null`, el diff no encuentra nada y **no se escribe**: apagar una bandera que ya estaba apagada no crece `appDetails`.

**4 — La autopsia no precede a la muerte.** Si `resultingAutopsyDate` no es nula y es **anterior** a `resultingDeathDate`, es **400** `AUTOPSY_DATE_BEFORE_DEATH`. Se comparan las dos como cadena `YYYY-MM-DD`, sin construir `Date`. Es la única regla del spec que cruza dos columnas de datos, y la única que puede dispararse con **ninguna** de las dos fechas viajando en el body: basta corregir la `deathDate` para que la `autopsyDate` guardada quede por detrás. `scheduledAutopsyDate` **no** entra en esta regla: puede ser anterior a la muerte —una autopsia programada antes del desenlace es un caso real— y su restricción temporal es ninguna.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Una autopsia cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVAUT-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVAUT_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe autopsias nuevas.
2. Esa investigación **no tiene ya autopsia**, buscando **sin filtrar por `deletedAt`** → 409 `INVAUT_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una autopsia sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. Las cuatro reglas de coherencia, en su variante estricta.
4. Normaliza: `deathTime` a `HH:mm:ss` con `toTimeString`, `.trim()` sobre `autopsyComments` y `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
5. Inserta con la entrada de auditoría `method: 'ESAVI-INVAUT-001'`.

**El alta mínima es `{ investigationId, isDeath: true, deathDate }`** y devuelve 201 con las siete columnas restantes en `null`. **No hay alta vacía**, y es la diferencia de fondo con F13, F14 y F29: allí la fila se abría entera en blanco.

**`toTimeString` es un helper nuevo** en `src/helpers/stringHandling.helper.ts`, registrado en el barrel: acepta `HH:mm` y `HH:mm:ss` y devuelve siempre `HH:mm:ss`. Es idempotente sobre su propia salida, que es lo que lo hace utilizable dentro del diff.

**`ESAVI-INVAUT-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, orden `[['deathDate', 'DESC'], ['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**El orden se aparta del `createdAt DESC` de F29** y encabeza por `deathDate`: es el dato que ordena el dominio, y a diferencia de F29 aquí está garantizado que existe en toda fila. `createdAt` queda de desempate.

**`ESAVI-INVAUT-002B` — listar, admin.** Idéntica, con el include en `where: {}`: devuelve también las autopsias de investigaciones inactivas. Los mismos dos filtros y el mismo orden.

**`ESAVI-INVAUT-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVAUT_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVAUT-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVAUT_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVAUT_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene autopsia → 404 `INVAUT_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVAUT-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVAUT_004_NOT_FOUND`.
2. `investigationId` e `isDeath` **se ignoran siempre**, vengan o no en el body. Una autopsia no se traslada entre investigaciones, y una fila que existe presupone el fallecimiento: `isDeath: false` no la convierte en otra cosa, la contradice.
3. Cálculo del estado resultante y las cuatro reglas de coherencia. **Antes del diff y con independencia de él.**
4. `stored` sale de `autopsy.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `isDeath` | **no entra** | inmutable: se ignora en silencio, sin 400. La fila solo existe sobre un fallecimiento |
| `deathDate` | `data.deathDate !== undefined ? data.deathDate : undefined` | **sin el `?? null` de los anulables**: el `null` ya lo rechazó el validador. Es modificable, no vaciable |
| `deathTime` | `data.deathTime !== undefined ? (data.deathTime ? toTimeString(data.deathTime) : null) : undefined` | anulable, **normalizado a `HH:mm:ss` antes de comparar** |
| `isAutopsyPerformed` | `data.isAutopsyPerformed !== undefined ? (data.isAutopsyPerformed ?? null) : undefined` | tri-estado: `false` es un valor, no una ausencia |
| `isAutopsyScheduled` | `data.isAutopsyScheduled !== undefined ? (data.isAutopsyScheduled ?? null) : undefined` | ídem |
| `autopsyDate` | con `resultingPerformed === true`: `data.autopsyDate !== undefined ? (data.autopsyDate ?? null) : undefined` — con `resultingPerformed` distinto de `true`: **siempre `null`** | **derivado condicional**: cuando la bandera se apaga, el `null` entra aunque el cliente no haya mandado nada |
| `scheduledAutopsyDate` | con `resultingScheduled === true`: `data.scheduledAutopsyDate !== undefined ? (data.scheduledAutopsyDate ?? null) : undefined` — con `resultingScheduled` distinto de `true`: **siempre `null`** | ídem |
| `autopsyComments` | `data.autopsyComments !== undefined ? (data.autopsyComments ? data.autopsyComments.trim() : null) : undefined` | anulable, con `.trim()` antes de comparar |
| `notes` | `data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined` | anulable, con `.trim()` antes de comparar |

**Ningún campo va bajo un `if( data.x )`.** Un `if` de veracidad haría imposible guardar un `false` en las dos banderas — que es precisamente la respuesta «no se practicó autopsia», la mitad del dominio de esos dos campos. **Ningún campo va cifrado.**

**Las tres fechas se comparan por la regla `DATEONLY` del helper** (`String(v).slice(0, 10)`), que ya existe. `deathTime` se compara como cadena, y por eso la normalización previa es obligatoria: sin ella, un `'14:30'` sobre un `'14:30:00'` guardado contaría como cambio en cada apertura del formulario.

**`ESAVI-INVAUT-005C` — purgar.** `purgeInvestigationAutopsyService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** la visibilidad heredada —quien purga es SUPERADMIN y la fila puede colgar de una investigación retirada— → 404 `INVAUT_005C_NOT_FOUND`; guarda de sellado con `assertRowIsSealed(row, 'INVAUT_005C_NOT_DELETED', lang)` → 409 si `deletedAt` está vacío; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` — la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6.

**La guarda de sellado es la única red de seguridad de la tabla.** El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** aquí: la columna no existe, `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró nunca. `assertRowIsSealed` se consume **sin modificarlo**: deriva la clave `investigationAutopsy.notDeleted` del nombre de tabla y el id del `primaryKeyAttribute` del modelo.

**Purgar sí libera el `investigationId`**, y es la única vía que lo hace. Tras un `005C`, un `POST` sobre esa misma investigación devuelve 201.

#### Los tres arrastres del `deletedAt`

Sin `isActive`, lo que las cascadas mueven es el sello de `deletedAt`. Los tres son `update` masivos, no lecturas seguidas de escrituras por fila, y los tres se añaden **junto** a los que F29 ya dejó puestos, en los mismos tres puntos.

**`ESAVI-INVESTGN-005A` — sellar.** Dentro de la transacción que `setInvestigationActivationService` ya abre y **solo cuando `isActive === false`**, `cascadeSealInvestigationAutopsy` sella `deletedAt` y `updatedAt` sobre la autopsia de esa investigación **que aún no lo tenga sellado**, y añade a `appDetails` una entrada con `method: 'ESAVI-INVESTGN-005A'` —el código de la operación que la arrastró, no el suyo—. Una investigación sin autopsia sella cero filas y no falla. Una autopsia ya sellada conserva su `deletedAt` original y **no** recibe entrada nueva.

**`ESAVI-CASE-005A` — sellar también.** `cascadeSealInvestigationAutopsies` en `src/services/esaviCase.service.ts`, **octava** función hermana junto a las siete que F29 dejó, invocada en el mismo bloque. Es necesaria y no redundante, por la razón exacta que F29 §3.5 documentó: desactivar el caso arrastra la investigación con un `Investigation.update` masivo que **no** pasa por `setInvestigationActivationService`, así que la cascada del punto anterior nunca dispara desde aquí. Alcanza a las autopsias cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`. Registra `method: 'ESAVI-CASE-005A'`.

**`ESAVI-INVESTGN-005B` — limpiar.** `cascadeClearInvestigationAutopsy` devuelve `deletedAt` a `null` al reactivar la investigación. Es una **cascada de subida**, legítima por lo mismo que en F29: el `deletedAt` de la autopsia no significa «alguien la retiró», significa «su investigación estaba retirada». Registra `method: 'ESAVI-INVESTGN-005B'`. **`ESAVI-CASE-005B` no limpia nada**, coherente con F07 y F29.

**Ninguno de los tres pasa por `buildDifferentialUpdate`, y es deliberado:** son escrituras con intención propia. Registran el hecho de sellar o devolver la fila, y ese registro en `appDetails` es precisamente lo que se quiere conservar.

**Volcado del `ESAVI-INVESTGN-005C`.** El purgado de una investigación arrastra su autopsia por `ON DELETE CASCADE` sin pasar por ningún servicio. Se añade a `purgeInvestigationService` un volcado en nivel `warn` de la fila que va a desaparecer, **junto al que F29 dejó para la fuente**, antes del `destroy` y dentro de la misma transacción. **No se bloquea la purga.**

**Validaciones de forma** (las emite `validateFields` con 400): en el `001`, `investigationId` obligatorio y `.isUUID()`, `isDeath` obligatorio y estrictamente `true`, `deathDate` obligatoria y `YYYY-MM-DD` no futura; en el `004`, `deathDate` opcional pero **no nula** si viaja; en los dos, `deathTime` en `HH:mm` o `HH:mm:ss` admitiendo `null`, las dos banderas con `.isBoolean()` admitiendo `null`, `autopsyDate` en `YYYY-MM-DD` no futura, `scheduledAutopsyDate` en `YYYY-MM-DD` **sin restricción temporal**, y los dos textos como cadena. `caseId` con `.isUUID()` en el `param` del `006`; los dos filtros del listado con `.isUUID()`, y `limit` y `offset` con `.isInt()`.

### 3.6 Claves i18n nuevas

Bloque `investigationAutopsy` en `src/data/i18n/es.json`, `en.json` y `nl.json` — **veinte claves**:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005C` y `006` |
| `idRequired` | parámetro ausente |
| `notDeleted` | 409 al purgar una autopsia sin `deletedAt` sellado. La deriva `assertRowIsSealed` del nombre de tabla, y lleva `{{id}}` |
| `investigationNotFound` | 404 cuando la investigación no existe o está inactiva, en `001` y en `006` |
| `alreadyExists` | 409 cuando la investigación ya tiene autopsia, sellada o no. Lleva `{{investigationId}}` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |
| `autopsyFlagsExclusive` | 400 con las dos banderas resultantes en `true` |
| `autopsyDateNotAllowed` | 400 al mandar `autopsyDate` con un `isAutopsyPerformed` no verdadero. **En el `001` siempre; en el `004` solo cuando la fecha viaja en el body** |
| `scheduledAutopsyDateNotAllowed` | ídem para `scheduledAutopsyDate` e `isAutopsyScheduled` |
| `autopsyDateBeforeDeath` | 400 con la `autopsyDate` resultante anterior a la `deathDate` resultante. Lleva `{{autopsyDate}}` y `{{deathDate}}` |

**Las obligatoriedades y las dos reglas de «no futura» no llevan clave propia:** las emite el validador y las responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio.

**No hay `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`**: no existen las operaciones que las usarían. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave a los bloques `investigation` ni `esaviCase`: los tres arrastres no producen mensajes propios.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004`, `006` y **también las filas de `002A` y `002B`**:

```
{ ok, message, data: {
    investigationId,
    isDeath, deathDate, deathTime,
    isAutopsyPerformed, isAutopsyScheduled,
    autopsyDate, scheduledAutopsyDate,
    autopsyComments, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    investigation: {
        investigationId, isActive, investigationStartDate,
        status: { catalogItemId, code, name },
        case:   { caseId, caseCode, eventDate }
    }
} }
```

**No hay forma reducida.** El listado devuelve la misma ficha que el `003`, por la misma razón que en F29: la entidad tiene nueve columnas de datos y recortarla dejaría un listado sin contenido. En listados, `data` es `{ count, rows }` de `findAndCountAll`.

**No se devuelve `isActive`**, porque la tabla no tiene esa columna. `deletedAt` es la única marca de estado que la fila lleva, e `investigation.isActive` es la fuente real de su visibilidad.

**Las tres fechas se devuelven como cadena `YYYY-MM-DD`** —es lo que da `DATEONLY`— y `deathTime` como `HH:mm:ss`, la forma normalizada, nunca la que mandó el cliente. **Las dos banderas se devuelven exactamente como se guardaron, `null` incluido**: un `null` significa que el formulario no recogió la respuesta y un `false` que el investigador respondió que no.

El include de la investigación es **obligatorio y no decorativo**: es lo que implementa la visibilidad heredada. Su `status` viaja resuelto y **nunca llega `null`**, por la regla que el F28 §3.5 impuso a aquella entidad. `sysDetails` **nunca** se devuelve, ni el de la autopsia ni el de la investigación. Ninguna respuesta incluye datos de las otras trece tablas satélite, `investigationSource` incluida.

---

## 4. Plan de implementación

**Precondiciones.** El **SPEC F28** debe estar `Implementado` —la PK de esta tabla es su FK— y el **SPEC F29** también: los pasos 11 y 12 añaden su arrastre junto al de la fuente en los mismos tres puntos, y el paso 10 reutiliza `assertRowIsSealed` tal como aquel spec lo dejó.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Helper `toTimeString`.** Función nueva en `src/helpers/stringHandling.helper.ts`, exportada por el barrel: acepta `HH:mm` y `HH:mm:ss` y devuelve siempre `HH:mm:ss`. Idempotente sobre su propia salida — es lo que la hace utilizable dentro del diff. Va primero porque el modelo, el validador y el servicio la consumen, y porque es la única pieza de este spec que no es de la entidad.
   *Verificación:* `npm run build` en 0; `toTimeString('14:30')` y `toTimeString('14:30:00')` devuelven los dos `'14:30:00'`; ninguna función existente del helper cambia de comportamiento.

2. **Modelo, asociaciones y tipos.** `src/models/investigationAutopsy.model.ts` con la PK **sin `defaultValue`**, `isDeath` en `BOOLEAN` `allowNull: false` y **sin `defaultValue`**, las dos banderas en `BOOLEAN` anulable, las tres fechas en **`DATEONLY`**, `deathTime` en **`TIME`**, los dos textos en `TEXT`, y **sin atributo `isActive`**; `src/models/associations/investigationAutopsy.associations.ts` con el `belongsTo` a `Investigation` como `investigation` y el inverso `Investigation.hasOne(InvestigationAutopsy, { as: 'autopsy' })`, registrado en `initModels()`; `src/types/investigation/investigationAutopsy.types.ts` con `CreateInvestigationAutopsyInput`, exportado por el `index.ts` de barrel del dominio. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `InvestigationAutopsy.findAll({ include: ['investigation'] })` desde un script suelto devuelve filas sin error de alias, y el alias `autopsy` no colisiona con el `source` de F29; una fila leída devuelve `deathDate` como `'YYYY-MM-DD'` y `deathTime` como `'HH:mm:ss'`; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `investigation`.

3. **Claves i18n.** El bloque `investigationAutopsy` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las **veinte** claves. **Sin `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`.** Ninguna clave para las obligatoriedades ni para «no futura»: ésas las responde `validateFields`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; `investigationAutopsy.notDeleted` existe en los tres archivos, que es lo que `assertRowIsSealed` resolverá en tiempo de ejecución sin que ningún `grep` estático lo vea.

4. **Validadores.** `src/validators/investigationAutopsy.validator.ts` con cinco arrays: `investigationAutopsyIdValidator`, `investigationAutopsyCaseIdValidator` (para el `param('caseId')` del `006`), `investigationAutopsyListValidator` (los dos filtros más `limit` y `offset`), `createInvestigationAutopsyValidator` y `updateInvestigationAutopsyValidator`. El de create exige `investigationId` UUID, `isDeath` **estrictamente `true`** y `deathDate` `YYYY-MM-DD` no futura; el de update deja `deathDate` opcional pero **no nula**. Los dos llevan `deathTime` en `HH:mm` o `HH:mm:ss` admitiendo `null`, las banderas con `.isBoolean()` admitiendo `null`, `autopsyDate` no futura, `scheduledAutopsyDate` **sin restricción temporal**, y los dos textos como cadena. **Ninguna de las cuatro reglas de coherencia va aquí:** dependen del estado guardado y viven en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; `isDeath: false` produce 400 y `isDeath: true` no; una `deathDate` de mañana produce 400 y una `scheduledAutopsyDate` de mañana no; `deathTime: "14:30"` pasa y `deathTime: "25:00"` no; en update, `deathDate: null` produce 400.

5. **`ESAVI-INVAUT-001` — crear.** `createInvestigationAutopsyService` con los cinco pasos de §3.5 en ese orden: investigación existente y activa, unicidad del `investigationId` sin filtrar por `deletedAt`, las **cuatro reglas de coherencia** en su variante estricta, normalización de `deathTime` y `.trim()` de los dos textos, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* el alta mínima `{ investigationId, isDeath: true, deathDate }` devuelve 201 con las siete columnas restantes en `null`; sin `deathDate` devuelve 400; crear dos veces sobre la misma investigación devuelve **409** `INVAUT_001_ALREADY_EXISTS` con el `investigationId` interpolado; una investigación inactiva devuelve **404**; las dos banderas en `true` devuelven **400** `AUTOPSY_FLAGS_EXCLUSIVE`; `{ isAutopsyPerformed: false, autopsyDate: "..." }` devuelve **400** `AUTOPSY_DATE_NOT_ALLOWED`; una `autopsyDate` anterior a la `deathDate` devuelve **400** `AUTOPSY_DATE_BEFORE_DEATH`; `{ isAutopsyPerformed: true }` sin fecha devuelve **201**; `deathTime: "14:30"` se guarda como `'14:30:00'`.

6. **`ESAVI-INVAUT-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, el include de la investigación en `required: true` con su `status` y su `case`, los dos filtros acumulativos, orden `[['deathDate','DESC'],['createdAt','DESC']]`, paginación y la forma completa de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve autopsias de investigaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los dos filtros combinados se aplican con `AND`; toda fila trae las nueve columnas de datos y `appDetails`; ninguna trae `isActive` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total; el orden encabeza por `deathDate` descendente.

7. **`ESAVI-INVAUT-003` — obtener por ID.** `getInvestigationAutopsyByIdService(id, lang, includeInactive)` donde el `id` es el `investigationId`, con el include obligatorio del padre y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una autopsia cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; una autopsia con `deletedAt` sellado pero investigación activa **sí se devuelve** —el sello no oculta la fila, la oculta el padre—; `investigation.status` no llega `null`; `sysDetails` no aparece ni en la autopsia ni en la investigación.

8. **`ESAVI-INVAUT-006` — obtener por caso.** `getInvestigationAutopsyByCaseIdService(caseId, lang, includeInactive)` con los **tres** 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `investigationAutopsyCaseIdValidator`, declarada antes de `/:id`. Fila `investigationAutopsy` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y autopsia devuelve 200 con la ficha completa, no envuelta en un array; un `caseId` inexistente devuelve 404 `INVAUT_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVAUT_006_INVESTIGATION_NOT_FOUND`; una investigación sin autopsia devuelve 404 `INVAUT_006_NOT_FOUND`. Los tres códigos son distintos entre sí; `GET /case/no-es-uuid` devuelve 400.

9. **`ESAVI-INVAUT-004` — actualizar, diferencial.** `updateInvestigationAutopsyService` con los seis pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` e `isDeath` ignorados; `deathDate` modificable pero no vaciable; las dos banderas y los dos textos comparados contra `undefined`; `autopsyDate` y `scheduledAutopsyDate` como derivados condicionales; `deathTime` normalizado antes de comparar. La lectura para el diff se hace **sin `attributes` acotados** y con el include del padre, para que la visibilidad heredada se compruebe en la misma consulta de la que sale la instancia. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; **`{ isAutopsyPerformed: false }` sobre una fila con `true` se guarda como `false`** y no se descarta; `{ isAutopsyPerformed: null }` vacía el campo; enviar `investigationId` o `isDeath: false` no los modifica y no devuelve error; `{ deathDate: null }` devuelve **400**; `{ deathTime: "14:30" }` sobre una fila con `'14:30:00'` **no escribe nada**; `{ isAutopsyPerformed: false }` sobre una fila con `autopsyDate` la deja en `null` en la **misma** petición con **una** entrada en `appDetails`; `{ isAutopsyPerformed: false, autopsyDate: "..." }` devuelve **400**; `{ isAutopsyScheduled: true }` sobre una fila con `isAutopsyPerformed: true` devuelve **400** `AUTOPSY_FLAGS_EXCLUSIVE`; mover la `deathDate` por detrás de una `autopsyDate` guardada devuelve **400** `AUTOPSY_DATE_BEFORE_DEATH` **sin que la `autopsyDate` viaje en el body**.

10. **`ESAVI-INVAUT-005C` — purgar.** `purgeInvestigationAutopsyService` sobre `purgeEntityService`, con transacción propia, existencia con `paranoid: false` y **sin** visibilidad heredada, y `assertRowIsSealed(row, 'INVAUT_005C_NOT_DELETED', lang)` **antes** del `destroy`. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `investigationAutopsyIdValidator` y declarada junto a las otras literales.
    *Verificación:* purgar una autopsia sin `deletedAt` sellado devuelve 409 `notDeleted` con el id interpolado y la fila sigue ahí — **es la comprobación que prueba que el control de `isActive` de `purgeEntityService` es inerte aquí**; desactivar la investigación y purgar la autopsia devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre esa investigación devuelve 201**; la investigación y su `investigationSource` siguen existiendo e intactos.

11. **Los dos arrastres desde `investigation` y el volcado del `005C`.** En `src/services/investigation.service.ts`: `cascadeSealInvestigationAutopsy` invocada desde `setInvestigationActivationService` **solo cuando `isActive === false`**, y `cascadeClearInvestigationAutopsy` **solo cuando `isActive === true`**, las dos dentro de la transacción que aquel servicio ya abre y **junto a las dos que F29 dejó**. La primera sella `deletedAt` y `updatedAt` **solo sobre la fila que aún no lo tenga sellado** y registra `method: 'ESAVI-INVESTGN-005A'`; la segunda devuelve `deletedAt` a `null` y registra `'ESAVI-INVESTGN-005B'`. Más el volcado en `warn` de la autopsia en `purgeInvestigationService`, antes del `destroy` y en la misma transacción.
    *Verificación:* desactivar una investigación con autopsia le sella `deletedAt`; reactivarla lo devuelve a `null`; una autopsia sellada a mano **antes** de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; una investigación sin autopsia se desactiva y se reactiva sin error; el `appDetails` de la arrastrada registra `ESAVI-INVESTGN-005A` y luego `ESAVI-INVESTGN-005B`, con su historial anterior intacto; **el arrastre de `investigationSource` sigue funcionando igual** y las dos filas se sellan en la misma transacción; purgar una investigación con autopsia deja **dos** líneas `warn` en `src/logs/esaviLog.log` —la fuente y la autopsia— y **no** devuelve error.

12. **El tercer arrastre, desde `esaviCase`.** `cascadeSealInvestigationAutopsies` en `src/services/esaviCase.service.ts`, **octava** función hermana, invocada en el mismo bloque que las siete anteriores, dentro de la misma transacción y **solo cuando `isActive === false`**. Alcanza a las autopsias cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`, y registra `method: 'ESAVI-CASE-005A'`. Va después del paso 11 porque depende del modelo y no lo necesita ningún paso anterior. **`ESAVI-CASE-005B` no se toca.**
    *Verificación:* desactivar un caso con investigación y autopsia **sella la autopsia**, y ése es el punto entero del paso: sin él quedaría sin sellar, porque la investigación la arrastra un `update` masivo que no pasa por `setInvestigationActivationService`; reactivar el caso no limpia el sello; un caso sin investigación, o con investigación sin autopsia, se desactiva sin error; las **siete** cascadas anteriores siguen produciendo el mismo efecto.

13. **Registrar la entidad en las convenciones.** Fila `investigationAutopsy` → `INVAUT` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationAutopsy` · `006` · «obtener la autopsia de un caso — la cadena `caso → investigación → autopsia` es uno a uno en los dos saltos» en la tabla de operaciones no canónicas.
    *Verificación:* `INVAUT` aparece una sola vez y no colisiona con las treinta existentes; la tabla de no canónicas suma exactamente una fila.

14. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más siete.
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/investigationAutopsy.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → purgar. Más los caminos de error: investigación inexistente (404), investigación inactiva (404), investigación ya con autopsia sellada y sin sellar (409 las dos), caso inexistente y caso sin investigación en el `006` (404 con códigos distintos), las **cuatro** reglas de coherencia en sus variantes de `001` y de `004`, `isDeath: false` en el alta (400) y en la edición (ignorado), `deathDate: null` en la edición (400), y purgar sin sellar (409). Más el bloque diferencial completo de §5, con cobertura explícita del **`false`** en las dos banderas y del **`deathTime` sin segundos**.
    *Verificación:* `npm test -- investigationAutopsy` en verde.

16. **Ampliar `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera, tres casos: desactivar la investigación sella su autopsia, reactivarla la limpia, y purgar la investigación destruye la autopsia por cascada de Postgres sin devolver error. En la segunda, dos: desactivar el caso sella la autopsia de su investigación, y reactivarlo no la limpia. **Los casos que F29 añadió a las dos suites se mantienen intactos**, y los nuevos comprueban que las dos satélites se arrastran juntas.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las seis operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVAUT-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVAUT-005[AB]" src/` no devuelve resultados: la entidad **no tiene** activación ni desactivación propias.
- [ ] `grep -rn "ESAVI-INVAUT-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "isActive" src/models/investigationAutopsy.model.ts` no devuelve resultados: la tabla no tiene esa columna.
- [ ] `grep -rn "answerOption" src/models/investigationAutopsy.model.ts src/types/investigation/investigationAutopsy.types.ts` no devuelve resultados: esta entidad no consume el ENUM, pese a lo que afirma F29 §6.
- [ ] `INVAUT` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigationAutopsy` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` exporta el archivo nuevo.
- [ ] `GET /api/investigation-autopsies/admin` y `GET /api/investigation-autopsies/case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Investigation.hasOne(InvestigationAutopsy, { as: 'autopsy' })` está declarado, no colisiona con el alias `source` de F29, y la autopsia **no** aparece en ninguna respuesta de `/api/investigations`.
- [ ] `git diff esaviapp.sql` está vacío.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationAutopsy.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada. En esta entidad la única FK es la PK: un `PUT` sobre una autopsia cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] **`{ isAutopsyPerformed: false }` sobre una fila con `true` guarda `false`**, y `{ isAutopsyPerformed: null }` la vacía. Ningún candidato entra bajo un `if( data.x )`.
- [ ] `{ deathTime: "14:30" }` sobre una fila con `'14:30:00'` guardado **no** cuenta como cambio: la normalización va antes de comparar. Es el criterio que justifica el helper del paso 1.
- [ ] `{ notes: "" }` deja el campo vacío, y un `notes` con espacios alrededor del mismo texto guardado **no** cuenta como cambio: el `.trim()` va antes de comparar.
- [ ] Reenviar las tres fechas tal como las devolvió el `GET` **no** cuenta como cambio: la regla `DATEONLY` del helper las compara por `String(v).slice(0, 10)`.

**Campos inmutables y obligatorios**

- [ ] `POST` sin `isDeath` → **400**. `POST` con `isDeath: false` → **400**. La fila de autopsia solo existe sobre un fallecimiento.
- [ ] `POST` sin `deathDate` → **400**. Es el segundo campo obligatorio, y el que separa esta entidad de F13, F14 y F29.
- [ ] `POST` con solo `{ investigationId, isDeath: true, deathDate }` → **201**, con las siete columnas restantes en `null`.
- [ ] `PUT` con `isDeath: false` → **200 sin escribir nada**: se ignora en silencio, sin 400 y sin entrada en `appDetails`.
- [ ] `PUT` con `investigationId` distinto → no lo modifica y no devuelve error.
- [ ] `PUT` con `{ deathDate: null }` → **400**. La fecha se corrige, no se borra.
- [ ] `PUT` con una `deathDate` distinta y válida → **200**, y el campo cambia. Modificable no es lo mismo que vaciable.
- [ ] `POST` o `PUT` con una `deathDate` o una `autopsyDate` futuras → **400**. Una `scheduledAutopsyDate` futura → **200**, y una en el pasado también.

**Las cuatro reglas de coherencia**

- [ ] `POST` con `isAutopsyPerformed: true` e `isAutopsyScheduled: true` → **400** `AUTOPSY_FLAGS_EXCLUSIVE`. Igual en `PUT`, incluso cuando **una sola** bandera viaja y la otra sale de la fila guardada.
- [ ] `POST` con las dos banderas en `false`, o las dos en `null`, o una en `false` y otra en `null` → **200**. No haberla hecho y no haberla planificado es un estado válido.
- [ ] `POST` con `{ isAutopsyPerformed: false, autopsyDate: "..." }` → **400** `AUTOPSY_DATE_NOT_ALLOWED`. El `001` es estricto.
- [ ] `POST` con `{ isAutopsyScheduled: null, scheduledAutopsyDate: "..." }` → **400** `SCHEDULED_AUTOPSY_DATE_NOT_ALLOWED`. `null` cuenta como no verdadero.
- [ ] `POST` con `{ isAutopsyPerformed: true }` y **sin** `autopsyDate` → **201**. La fecha puede completarse después.
- [ ] `PUT` con `{ isAutopsyPerformed: false }` sobre una fila con `autopsyDate` guardada → **200**, con `autopsyDate` en `null` en la **misma** petición y **una** sola entrada en `appDetails`.
- [ ] `PUT` con `{ isAutopsyPerformed: false, autopsyDate: "..." }` → **400**. El forzado silencioso no se traga un body que se contradice a sí mismo.
- [ ] `PUT` con `{ isAutopsyPerformed: false }` sobre una fila que ya tenía `false` y `autopsyDate: null` → **200 sin escribir nada**: el `null` forzado entra en `candidates` pero el diff no encuentra diferencia.
- [ ] `POST` con una `autopsyDate` anterior a la `deathDate` → **400** `AUTOPSY_DATE_BEFORE_DEATH`, con las dos fechas interpoladas.
- [ ] `PUT` que solo mueve la `deathDate` por detrás de una `autopsyDate` **guardada** → **400** `AUTOPSY_DATE_BEFORE_DEATH`. Es el criterio que prueba que la regla mira el estado resultante y no el body: la `autopsyDate` no viaja.
- [ ] `PUT` con una `scheduledAutopsyDate` anterior a la `deathDate` → **200**. La fecha programada no entra en esa regla.

**Uno a uno y ciclo de vida**

- [ ] `POST` sobre una investigación que ya tiene autopsia devuelve **409** `alreadyExists`, con el `investigationId` interpolado.
- [ ] `POST` sobre una investigación cuya autopsia tiene `deletedAt` sellado devuelve también **409**: el sello no libera el hueco de la clave primaria.
- [ ] Purgar la autopsia con `005C` libera el `investigationId`, y un `POST` posterior devuelve **201**.
- [ ] Purgar una autopsia **sin** `deletedAt` sellado devuelve **409** `notDeleted` y la fila sigue existiendo. Es el criterio que prueba que el control de `isActive` de `purgeEntityService` es inerte sobre esta tabla.
- [ ] `assertRowIsSealed` se consume sin modificarlo: `git diff src/helpers/rowSeal.helper.ts` está vacío.
- [ ] Purgar la autopsia **no** toca el `investigationSource` de la misma investigación.
- [ ] Ninguna ruta responde a `DELETE /api/investigation-autopsies/:id` ni a `PATCH /api/investigation-autopsies/activate/:id`: las dos devuelven 404 de Express.

**Los tres arrastres**

- [ ] Desactivar la investigación con `INVESTGN-005A` sella el `deletedAt` de su autopsia y registra `method: 'ESAVI-INVESTGN-005A'` en su `appDetails`.
- [ ] Reactivarla con `INVESTGN-005B` devuelve `deletedAt` a `null` y registra `'ESAVI-INVESTGN-005B'`. El historial anterior queda intacto en los dos casos.
- [ ] **Desactivar el caso con `CASE-005A` sella la autopsia**, y registra `method: 'ESAVI-CASE-005A'`. Sin el paso 12 este criterio falla, y es la única forma de detectarlo.
- [ ] Reactivar el caso con `CASE-005B` **no** limpia el sello de la autopsia, coherente con F07 y F29.
- [ ] Una autopsia sellada a mano antes de cualquier cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.
- [ ] Una investigación sin autopsia, y un caso sin investigación, atraviesan las tres cascadas sin error y sin afectar a ninguna fila.
- [ ] **Una investigación con fuente y autopsia sella y limpia las dos en la misma transacción**, y las siete cascadas que `esaviCase.service.ts` ya tenía siguen produciendo el mismo efecto.
- [ ] Purgar la investigación con `INVESTGN-005C` destruye la autopsia por cascada de Postgres, deja **dos** líneas `warn` en el log —fuente y autopsia— y **no** devuelve error.

**Listados y respuesta**

- [ ] Los dos filtros de §3.5 se combinan con `AND` y son por igualdad; `caseId` resuelve por el include de la investigación.
- [ ] Un filtro con un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`.
- [ ] `GET /` no devuelve autopsias de investigaciones inactivas; `GET /admin` sí; un USER recibe **403** en `/admin`.
- [ ] El listado ordena por `deathDate` descendente, con `createdAt` de desempate.
- [ ] Las filas del listado traen la **misma** forma completa que el `003`: no hay forma reducida.
- [ ] Ninguna respuesta devuelve `isActive` en la autopsia, y ninguna devuelve `sysDetails` — ni el de la autopsia ni el de la investigación incluida.
- [ ] `investigation.status` no llega `null` en ninguna respuesta.
- [ ] Las tres fechas se devuelven como `YYYY-MM-DD` y `deathTime` como `HH:mm:ss`, la forma normalizada y no la que mandó el cliente.
- [ ] Las dos banderas se devuelven tal como se guardaron: un `null` no se convierte en `false` al construir la respuesta.
- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`, y sus tres 404 llevan códigos distintos entre sí.
- [ ] Ninguna respuesta incluye datos de las otras trece tablas satélite, `investigationSource` incluida.

**Cierre**

- [ ] `toTimeString('14:30')` y `toTimeString('14:30:00')` devuelven los dos `'14:30:00'`, y ninguna función existente de `stringHandling.helper.ts` cambia de comportamiento.
- [ ] Las veinte claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` cubre las siete rutas nuevas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `INVAUT`. **No:** `INVAUTOP`, que cumple el máximo de ocho letras pero no aporta legibilidad; **no:** `AUTOPSY`, que pierde la pertenencia al bloque de investigación y rompería el `grep` por familia. `INVAUT` no colisiona con las treinta registradas y no se cruza con `ESAVI-INVESTGN-` ni con `ESAVI-INVSRC-`.
- **Sí:** solo esta tabla. **No:** aprovechar el spec para meter `investigationTeamMember` o cualquier otra satélite contigua. Es el criterio que fijaron F10 con las ocho satélites de `notification`, F28 con las catorce de `investigation` y F29 al dividirse de ésta.
- **Sí:** corregir en §1 la afirmación de F29 §6 sobre `answerOption`. **No:** editar el archivo del F29, que está `Aprobado` y cuya decisión de fondo —dividir— sigue siendo correcta. Se deja la corrección aquí y un criterio de aceptación que la verifica en el código.
- **Sí:** `isDeath` obligatorio y estrictamente `true` en el `001`. **No:** replicar en la aplicación el `DEFAULT true` del SQL. Un default silencioso marcaría como fallecido a un paciente vivo cuando el cliente simplemente olvidó la clave, y es el peor error posible en esta entidad. **No:** ocultarlo del tipo y escribirlo fijo: obligar al cliente a declararlo es lo que convierte el alta en una afirmación consciente.
- **Sí:** `isDeath` inmutable en el `004`, ignorado en silencio. **No:** permitir `isDeath: false` para «deshacer» el registro. Una fila que existe presupone el fallecimiento; ponerla en `false` no la convierte en otra cosa, la contradice. Si la muerte se registró por error, lo que corresponde es retirar la investigación y purgar la fila, no dejar una autopsia de alguien vivo. **No:** devolver 400, que rompería el `PUT` que reenvía la respuesta del `GET` — el uso normal de un formulario.
- **Sí:** `deathDate` obligatoria en el `001`. **No:** abrir la fila entera vacía como F13, F14 y F29. Aquí la fila no es un borrador de formulario: es el registro de un hecho con fecha, y sin fecha no registra nada.
- **Sí:** `deathDate` modificable pero **no anulable** en el `004`. **No:** tratarla como un anulable más. Vaciarla reabriría por la puerta de atrás justo lo que el `001` prohíbe, y dejaría filas que afirman una muerte sin decir cuándo. **No:** hacerla también inmutable: una fecha mal tecleada tiene que poder corregirse sin purgar y recrear la fila.
- **Sí:** las dos banderas de autopsia mutuamente excluyentes en `true`. **No:** admitir las dos como un histórico —«se programó y luego se hizo»—. El esquema no tiene dónde guardar esa secuencia, y las dos fechas juntas no la reconstruyen. Cuando la autopsia se practica, la programación deja de ser el estado y pasa a ser pasado: lo que la fila registra es el estado actual.
- **Sí:** las dos banderas en `false` o en `null` a la vez. Es un estado normal y frecuente: ni se hizo la autopsia ni se planificó.
- **Sí:** las banderas como tri-estado anulable, con `false` como valor de primera clase. **No:** normalizarlas a `false` al leer ni al escribir. `null` es «el formulario no lo recogió» y `false` es «el investigador dijo que no»; fundirlas destruiría la única forma de saber si la investigación llegó a preguntarlo. Es la decisión que F29 tomó para sus ocho fuentes.
- **Sí:** con la bandera en `true`, su fecha es **opcional**. **No:** exigirla. Marcar que la autopsia se practicó y no conocer todavía la fecha exacta es un estado real, y exigirla obligaría al cliente a inventar un dato para poder guardar.
- **Sí:** la asimetría `001` / `004` en las fechas prohibidas, calcada de la regla «otra» de F29. El `004` resuelve un huérfano que él no creó —la fecha la guardó una petición anterior— y el `001` no tiene huérfanos que resolver. **No:** la misma regla en las dos, que en el alta produciría un 201 mintiendo sobre lo que guardó.
- **Sí:** conservar el 400 cuando la fecha **sí** viaja junto a una bandera no verdadera. **No:** silenciarlo también. Un body que apaga la bandera y a la vez fecha la autopsia se contradice a sí mismo; tragárselo perdería el dato en silencio y el cliente creería haberlo guardado.
- **Sí:** las dos fechas forzadas como **derivados condicionales**, entrando en `candidates` sin `if` de presencia. **No:** limpiarlas con un `update` posterior al diff. Un segundo `UPDATE` escribiría aunque nada cambie, y rompería el criterio de que apagar una bandera ya apagada no crece `appDetails`.
- **Sí:** `autopsyDate` no anterior a la `deathDate` resultante. Es la única regla del spec que cruza dos columnas, y la única que puede dispararse sin que ninguna de las dos fechas viaje en el body. **No:** dejarla fuera por simetría con las demás reglas temporales: una autopsia anterior a la muerte no es un dato dudoso, es imposible.
- **Sí:** `scheduledAutopsyDate` sin ninguna restricción temporal. Puede estar en el pasado —un registro histórico de una autopsia programada que nunca se ejecutó— y puede ser anterior a la muerte. **No:** exigir que sea futura ni posterior al fallecimiento: las dos reglas romperían la carga de datos históricos, que es la vía normal de poblar esta tabla.
- **Sí:** `deathDate` y `autopsyDate` no futuras, comprobado en el **validador**. No necesitan estado guardado, y `validateFields` ya responde 400 con `common.validationError` sin generar clave i18n propia. **No:** meterlas en el servicio junto a las cuatro reglas de coherencia, que sí lo necesitan.
- **Sí:** cuatro claves i18n para las reglas de coherencia y **ninguna** para las obligatoriedades ni para «no futura». Es el reparto que ya usa todo el repositorio entre validador y servicio, y añadir claves para lo que emite `validateFields` crearía un segundo canal de mensajes de validación.
- **Sí:** `deathTime` como `DataTypes.TIME` normalizado a `HH:mm:ss` en un helper propio. **No:** `DataTypes.STRING` guardando lo que llegue, que dejaría `'14:30'` y `'14:30:00'` como dos valores distintos del mismo dato. **No:** exigir `HH:mm:ss` estricto en el validador: obligaría al cliente a añadir segundos que ningún formulario de hora pide, y el problema de comparación seguiría ahí en cuanto alguien mandara los dos formatos.
- **Sí:** `toTimeString` como helper compartido en `stringHandling.helper.ts`. **No:** normalizar en línea dentro del servicio. La normalización tiene que ser idempotente y usarse en `001` y en `004` con exactamente el mismo criterio; escrita dos veces es como divergen.
- **Sí:** las tres fechas en `DataTypes.DATEONLY`. **No:** `DATE`, que devolvería un `Date` con zona horaria sobre una columna `date` y haría que la regla `DATEONLY` de `buildDifferentialUpdate` comparara cosas distintas según el huso del servidor.
- **Sí:** orden del listado por `deathDate DESC` con `createdAt` de desempate, apartándose del `createdAt DESC` de F29. Aquí la fecha del hecho existe en toda fila —es obligatoria— y es la que ordena el dominio. **No:** ordenar por `autopsyDate`, que es nula en la mayoría de las filas.
- **Sí:** listado dual `002A` / `002B`, heredado de F29. La visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos.
- **Sí:** cinco operaciones de escritura y lectura más las dos de listado, sin `005A` ni `005B`. **No:** inventar una activación que escriba `deletedAt` a mano. La tabla no tiene estado propio: retirar una autopsia es retirar su investigación.
- **Sí:** el `003` por `investigationId`, que es la PK, y el `006` por `/case/:caseId` atravesando los dos saltos. Es la consulta real del dominio —el cliente tiene el caso, no la investigación—.
- **Sí:** tres 404 distintos en el `006`. **No:** un solo `notFound` genérico. Que el caso no exista, que no haya investigación abierta o que la investigación no tenga autopsia registrada son tres acciones distintas del usuario.
- **Sí:** forma completa también en el listado. **No:** una forma reducida como la de F28. Nueve columnas de datos, y recortarlas dejaría un listado sin contenido.
- **Sí:** la octava función hermana en `esaviCase.service.ts`. **No:** confiar en la cascada de `INVESTGN-005A`. Desactivar el caso arrastra la investigación con un `update` masivo que nunca pasa por `setInvestigationActivationService`, así que aquella cascada no dispara desde ahí y la autopsia quedaría sin sellar. Es el error más fácil de cometer en este spec, igual que lo fue en F29, y por eso tiene criterio de aceptación propio.
- **Sí:** cascada de subida en `INVESTGN-005B`. El `deletedAt` de la autopsia no significa «alguien la retiró», significa «su investigación estaba retirada». **No:** cascada de subida desde `CASE-005B`, que contradiría a F07.
- **Sí:** dejar que `INVESTGN-005C` arrastre la autopsia, con volcado en `warn` como única mitigación. **No:** bloquear la purga de una investigación que tenga autopsia. Es la decisión de F13 y F29, heredada sin reabrirse.
- **Sí:** `investigationId` inmutable en el `004`. **No:** permitir el traslado entre investigaciones. Una autopsia es el registro del fallecimiento de *ese* paciente; moverla llevaría una muerte al expediente de otro.
- **No:** cifrar ningún campo. Dos fechas, una hora, tres booleanos y dos textos sobre procedimiento. La identidad del fallecido vive en `patient`, y es allí donde el cifrado ya se aplica.
- **No:** ninguna regla cruzada con `investigationSource`, `esaviCase` ni `classification`. Que `autopsyRecord` esté marcada como fuente sin que exista esta fila, o que el caso no conste como mortal, son hoy incoherencias posibles y aceptadas. Atarlas exige antes decidir cuál de las dos tablas manda, y eso es un spec de reglas cruzadas, no un CRUD.
- **No:** filtros booleanos por `isAutopsyPerformed` en el listado, ni tablero de autopsias. Es una agregación con su propia forma de respuesta.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Un default de aplicación sobre `isDeath`** —replicando el `DEFAULT true` del SQL— marcaría como fallecido a un paciente vivo cuando el cliente olvida la clave. Es el peor error posible de esta entidad y sería completamente silencioso: la respuesta sería un 201 normal | El validador exige `isDeath` presente y estrictamente `true`, y el modelo se declara **sin `defaultValue`**. Dos criterios de aceptación lo verifican: sin la clave es 400, y con `false` también |
| **`deathTime` es la primera columna `time` del repositorio**, y Postgres devuelve `'14:30:00'` donde el formulario manda `'14:30'`. Sin normalizar, cada apertura de la pantalla generaría una entrada en `appDetails` y un evento en `sysDetails` por un dato que nadie tocó | `toTimeString` normaliza a `HH:mm:ss` **antes** de comparar, en `001` y en `004` por igual. El criterio de aceptación correspondiente es el que justifica que el helper exista, y va en el paso 1 del plan precisamente para que ninguna operación se escriba antes que él |
| **La regla `autopsyDate >= deathDate` puede dispararse sin que ninguna de las dos fechas viaje en el body.** Un servicio que la evaluara sobre el body en vez de sobre el estado resultante dejaría pasar una `deathDate` corregida que deja la autopsia por delante de la muerte | El estado resultante se calcula una vez al entrar y las cuatro reglas lo consumen. Tiene criterio de aceptación propio: mover solo la `deathDate` por detrás de una `autopsyDate` guardada debe devolver 400 |
| Un `if( data.x )` en la construcción de `candidates` haría **imposible guardar un `false`** en las dos banderas, y el fallo es silencioso: el `PUT` devuelve 200 y el campo se queda como estaba | Es el riesgo que seis de los doce servicios del repositorio materializaron. La tabla de `candidates` de §3.5 lo declara campo por campo y hay criterio explícito sobre `isAutopsyPerformed` |
| **`deathDate` es obligatoria pero anulable en el DDL**, así que nada en la base impide vaciarla. Un `004` que la tratara como un anulable más reabriría lo que el `001` prohíbe y dejaría filas que afirman una muerte sin decir cuándo | El validador rechaza `deathDate: null` en el `004`, y en `candidates` entra **sin** el `?? null` de los anulables. Dos criterios lo separan del caso legítimo: `null` es 400, una fecha distinta es 200 |
| El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** sobre esta tabla: `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró | `assertRowIsSealed` es la única red, y por eso la guarda va **antes** del `destroy` y tiene criterio propio. El helper ya existe y se consume sin modificarlo |
| La cascada de `ESAVI-INVESTGN-005A` **no dispara** cuando quien arrastra la investigación es `ESAVI-CASE-005A`, porque aquélla se implementa con un `update` masivo que no pasa por el servicio de activación. La autopsia quedaría sin sellar y nadie lo notaría | La octava función hermana del paso 12 existe exactamente para esto. Es el mismo riesgo que F29 documentó, y sigue siendo el error más fácil de cometer: el paso anterior parece haberlo resuelto y no lo resuelve |
| **Este spec edita los mismos tres puntos que F29 acaba de tocar** —dos cascadas en `investigation.service.ts`, una en `esaviCase.service.ts`, un volcado en `purgeInvestigationService`— y las trece satélites restantes editarán los mismos | Los criterios de aceptación verifican que **las dos** filas se sellan y se limpian en la misma transacción, y que las siete cascadas anteriores de `esaviCase.service.ts` siguen intactas. Aun así, **ésta es la segunda copia del mismo arrastre: si la tercera satélite vuelve a duplicarlo, ése es el momento de extraer un servicio común**, y F29 §7 ya lo dejó anotado |
| `ESAVI-INVESTGN-005C` destruye la autopsia por cascada de Postgres sin pasar por ningún servicio de esta entidad: ni auditoría, ni `appDetails`, ni posibilidad de deshacer | El volcado en `warn` es la única mitigación, y es deliberado. Quien la ejecuta es SUPERADMIN sobre una investigación ya retirada |
| Una autopsia puede afirmar que se practicó sin que `investigationSource.autopsyRecord` esté marcado, y al revés. Y una fila puede existir sobre un caso que no consta como mortal | Sin mitigación en este spec: las reglas cruzadas quedan fuera de alcance en §2, en los dos sentidos. F29 dejó la simétrica declarada, así que la incoherencia está documentada desde los dos lados |
| El `004` es la operación principal de la entidad —la fila se abre con dos campos y se completa después—, así que un fallo del diferencial ensuciaría `appDetails` y `sysDetails` en **cada apertura del formulario** | Los nueve criterios del bloque diferencial de §5 son la cobertura; el corte temprano cuando el diff vuelve vacío es la única línea de control que le queda al servicio |
| El forzado de las dos fechas a `null` entra en `candidates` en **toda** petición cuya bandera resultante no sea verdadera, incluidas las que no tocan nada de autopsia | Es correcto y está buscado: el helper decide si difiere. El criterio que lo verifica es el `PUT` con `{ isAutopsyPerformed: false }` sobre una fila ya apagada, que debe responder 200 **sin escribir** |
| `GET /:id` captura `/admin`, `/purge` o `/case` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por un criterio de aceptación explícito |

---

## 8. Impacto en el contrato HTTP

El spec añade siete rutas nuevas y **no cambia la forma de ninguna respuesta existente**. Ningún endpoint devuelve un campo distinto, ni un status distinto, ni un mensaje distinto.

Lo que sí cambia son **efectos sobre filas de una entidad que hasta ahora no existía**, y por eso ningún cliente actual puede notarlo:

- `DELETE /api/investigations/:id`, `PATCH /api/investigations/activate/:id` y `DELETE /api/esavi-cases/:id` pasan a sellar o limpiar también el `deletedAt` de la autopsia, junto al de la fuente que F29 ya arrastraba. Status, mensaje y cuerpo son idénticos.
- `DELETE /api/investigations/purge/:id` añade una **segunda** línea en `warn` al log. La respuesta no cambia.

`GET /api/investigations` y `GET /api/investigations/:id` **no** incluyen la autopsia en su `data`: la asociación `hasOne` se declara pero no se usa en ninguna respuesta de aquella entidad, igual que la de F29.

Un cambio de código sin superficie HTTP: `src/helpers/stringHandling.helper.ts` gana `toTimeString`. **Ninguna función existente del helper cambia de comportamiento**, así que ninguna entidad ya implementada se ve afectada.

---

## Lo que **no** está en este spec

- Las otras doce tablas satélite de `investigation`: `investigationTeamMember`, `investigationCovidHistory`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `evaluationInstitution`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- Cualquier regla cruzada con `investigationSource` —que `autopsyRecord` o `verbalAutopsyRecord` obliguen a que exista esta fila, o al revés—, con `esaviCase` —que el caso conste como mortal, o que su `eventDate` limite la `deathDate`— o con `classification`.
- Cualquier tablero, conteo o filtro por `isAutopsyPerformed`, y cualquier filtro booleano propio en el listado.
- Crear la autopsia automáticamente al dar de alta una investigación o al marcar un caso como mortal.
- Permitir `isDeath: false`, vaciar la `deathDate`, o admitir las dos banderas de autopsia en `true` a la vez.
- Restricción temporal alguna sobre `scheduledAutopsyDate`.
- Añadir el listado dual a `severeNotification` y `nonSevereNotification`, pendiente desde F29 §2.
- Extraer un servicio común para el arrastre y la visibilidad heredada de las satélites de `investigation`. Ésta es la segunda copia; la decisión se toma cuando llegue la tercera.
- Trasladar una autopsia de una investigación a otra.
- Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene autopsia.
- Modificar `esaviapp.sql`, `setEntityActiveStatusService`, `purgeEntityService` o `assertRowIsSealed`.
- Editar el archivo del SPEC F29, pese a la corrección que §1 hace de su §6.
- Cifrado de ningún campo.
- Búsqueda por texto sobre `autopsyComments` o `notes`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
