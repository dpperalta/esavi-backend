# SPEC F29 — CRUD de `investigationSource`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), **SPEC F13 (`severeNotification` — aporta el patrón de satélite sin `isActive` y las funciones de arrastre)**, **SPEC F14 (`nonSevereNotification` — aporta `assertRowIsSealed` en `src/helpers/rowSeal.helper.ts`, que este spec reutiliza sin tocarlo)**, SPEC F08 (operación `005C` de borrado físico), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-20
> **Objetivo:** Dar de alta `investigationSource` —las ocho fuentes de información con que se investigó un caso— como la **primera** de las catorce tablas satélite de `investigation` y la tercera del repositorio sin columna `isActive`.

---

## 1. Por qué existe este spec

`investigationSource` responde a una sola pregunta del formulario de investigación: **de dónde salió la información**. Ocho casillas —historia clínica, entrevista al vacunado, entrevista al personal de salud, registro de vacunación, protocolo de autopsia, autopsia verbal, informe de investigación y «otra»— más la descripción de esa «otra» y unas notas libres. Nada más.

Hoy la tabla existe en `esaviapp.sql:956-974` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **primera de las catorce satélites de `investigation`**, que el [SPEC F28](./28-investigation-crud.md) dejó fuera de alcance en bloque y de forma explícita. Estructuralmente no es terreno nuevo: es un calco de `nonSevereNotification` con el padre cambiado, y los cuatro rasgos que el F13 §1 desarrolló y el F14 §1 confirmó los cumple igual. Se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`esaviapp.sql:957`) y destino de `FK_investigationSource_investigation` (`:973`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **tercera** del repositorio, tras `severeNotification` y `nonSevereNotification`, y la primera que confirma que la decisión del esquema no era del bloque de notificación sino de todas las satélites. De ahí salen, igual que allí, **menos operaciones de las siete canónicas**: no hay `005A` ni `005B`.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1369-1373`), así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar. Es exactamente la advertencia que el F28 §3.5 dejó escrita —«el spec que dé de alta la primera satélite debe revisar esta operación»— y este spec es ese spec.
- **No consume `answerOption`.** Sus ocho fuentes son `boolean` anulables (`esaviapp.sql:958-965`), no el ENUM de cinco valores. Siguen siendo tri-estado: `null` es «el formulario no lo recogió» y `false` es un «no» deliberado.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco.** Dos cosas:

**A — Es la satélite más simple del repositorio, y por eso admite listado.** No tiene ni una clave foránea propia: el F14 estrenó tres y con ellas toda la fricción entre validación de FK y update diferencial. Aquí no hay nada que validar contra la base más allá del padre. Esa simplicidad es la que permite que esta entidad recupere el **listado dual** que F13 y F14 descartaron, y la que hace que su `004` sea diez comparaciones y ninguna consulta.

**B — El listado es la desviación deliberada respecto de sus dos hermanas mayores.** F13 y F14 argumentaron que sin `isActive` no hay dos variantes de listado que devuelvan filas distintas. **Ese argumento es incorrecto para esta entidad, y probablemente lo era también para aquéllas:** la visibilidad no la aporta una columna propia, la hereda de `investigation.isActive`. Un `002A` que filtra por investigación activa y un `002B` que no devuelven conjuntos distintos, y sin el segundo un ADMIN no tiene forma de ver la fuente de una investigación retirada. Este spec lo corrige para sí mismo y **no reabre** F13 ni F14: ampliarlas es su propio spec, declarado en §2.

**Y un rasgo que no la separa:** el trigger. `TRG_investigationSource_setSysDetails` lo monta el bucle genérico sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1284-1298`). **No existe `TRG_investigationSource_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationSource`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14, y aquí se mantiene íntegra.
- **Listado dual `002A` / `002B`**, que sí se recupera. La visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos: `002A` en `GET /` para USER solo devuelve fuentes cuya investigación está activa; `002B` en `GET /admin` para ADMIN las devuelve todas.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear la segunda fuente de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVSRC_001_INVESTIGATION_NOT_FOUND`; no tiene ya fuente, sin filtrar por `deletedAt` → 409 `INVSRC_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la fuente responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Las ocho fuentes como tri-estado sobre `boolean`**, devueltas tal cual se guardaron, `null` incluido. No se normalizan a `false` al construir la respuesta.
- **Las ocho fuentes no son excluyentes entre sí.** Nada en el DDL lo impide y este spec tampoco: son ocho preguntas independientes de un formulario.
- **Ninguna regla que exija al menos una fuente informada.** Un alta con las ocho en `null` es válida: es la vía normal de crear la fila y completarla con el `PUT`.
- **Regla de coherencia de la fuente «otra»**, replicada de F14 y evaluada en el servicio sobre el **estado resultante**, no sobre el body, con una asimetría deliberada entre `001` y `004` desarrollada en §3.5.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre:** `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también —porque desactivar el caso arrastra la investigación sin pasar por la cascada de aquélla—, y `ESAVI-INVESTGN-005B` limpia. Implica tocar `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, en este último junto a las seis funciones hermanas que ya viven ahí.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`.** Es la revisión que el F28 §3.5 dejó pendiente y la única mitigación de una cascada que hoy ya ejecuta.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVSRC_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**: deriva la clave i18n del nombre de tabla, así que `investigationSource.notDeleted` funciona sin registrar nada en ningún sitio.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12): los diez campos de datos son anulables y entran comparados contra `undefined`; `investigationId` es inmutable y se ignora en silencio si llega.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación.
- Alta de la abreviatura **`INVSRC`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationSource.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado` —lo está—. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.

**Fuera de alcance (otros specs):**

- **Las otras trece satélites de `investigation`:** `investigationAutopsy` (`esaviapp.sql:976-993`), `investigationTeamMember` (`995-1011`), `investigationCovidHistory` (`1013-1035`), `investigationMedicalHistory` (`1037-1064`), `investigationPregnancyCondition` (`1066-1081`), `investigationClinicalEvaluation` (`1083-1107`), `evaluationInstitution` (`1109-1128`), `investigationVaccinationContext` (`1130-1151`), `investigationVaccineAdministered` (`1153-1168`), `investigationColdChain` (`1170-1193`), `investigationAdministrationError` (`1195-1229`) e `investigationCommunity` (`1231-1249`).
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** El razonamiento de §1B las alcanza, pero ampliarlas toca dos entidades ya `Implementado` con sus suites cerradas, y merece su propio spec de ampliación.
- **Cualquier regla cruzada entre `autopsyRecord` o `verbalAutopsyRecord` y la tabla `investigationAutopsy`.** Marcar que hubo protocolo de autopsia como fuente y no registrar la autopsia es hoy una incoherencia posible y aceptada: aquella tabla ni siquiera está implementada.
- **Cualquier regla cruzada entre `history` y `classification`, o entre `vaccinationRecord` y `notificationVaccine`.** Ninguna fuente marcada obliga a que exista el registro correspondiente en otra tabla.
- **Cualquier tablero, conteo o filtro por las ocho fuentes** —«cuántas investigaciones usaron autopsia verbal»—. Si aparece, es su propio spec con la agregación declarada.
- **Exigir al menos una fuente informada, o hacerlas excluyentes.** Descartado en §6.
- **Crear la fuente automáticamente al dar de alta una investigación.**
- **Modificar `esaviapp.sql`**: ni añadir `isActive`, ni un `CHECK` sobre `other` y `otherDescription`, ni meter `investigation` en `preventPhysicalDelete`, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- **Modificar `setEntityActiveStatusService`, `purgeEntityService` o `assertRowIsSealed`.** Los tres se consumen tal cual están.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene fuente.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión que F13 tomó para su padre y aquí se hereda sin reabrirse.
- Cifrado de ningún campo. La tabla no contiene ni un dato identificativo: son ocho booleanos y dos textos sobre procedimiento.
- Búsqueda por texto sobre `otherDescription` o `notes`.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationSource` — `esaviapp.sql:956-974`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:957`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationSource_investigation` → `investigation`, `ON DELETE CASCADE` |
| `history` | `boolean` | sí | historia clínica. Tri-estado con `null` |
| `interviewVaccinatedPerson` | `boolean` | sí | entrevista al vacunado o su familia |
| `interviewHealthWorker` | `boolean` | sí | entrevista al personal de salud |
| `vaccinationRecord` | `boolean` | sí | registro o carné de vacunación |
| `autopsyRecord` | `boolean` | sí | protocolo de autopsia |
| `verbalAutopsyRecord` | `boolean` | sí | autopsia verbal |
| `investigationReport` | `boolean` | sí | informe de investigación |
| `other` | `boolean` | sí | `:965`. Gobierna la regla de coherencia |
| `otherDescription` | `text` | sí | solo con `other: true` |
| `notes` | `text` | sí | texto libre |

**Diez columnas de datos, todas anulables.** La única no nula de la tabla es la clave primaria.

**Restricciones.** Una sola clave foránea y nada más: **ninguna `UNIQUE`** —la PK ya lo es—, **ningún `CHECK`** y **ningún índice declarado** más allá del de la clave primaria. Es la tabla más simple del bloque de investigación.

**Ninguna longitud máxima declarada.** `otherDescription` y `notes` son `text`, sin `varchar(n)`. No hay ningún límite que replicar en el modelo, a diferencia de la `vaccinationCenterAddress` de F14.

**El tri-estado sobre `boolean`.** Las ocho fuentes son `boolean` **anulables**, y esa nulabilidad sostiene los tres estados: `true` y `false` son respuestas dadas, `null` es la ausencia de respuesta. Declararlas `NOT NULL DEFAULT false` respondería «no» a una pregunta que nadie llegó a hacer. Esta entidad **no** consume `answerOption`.

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. **Falta `isActive`**, igual que en `severeNotification` y `nonSevereNotification`. Es la tercera tabla del repositorio así, y la primera fuera del bloque de notificación: confirma que la decisión del esquema alcanza a todas las satélites y no solo a aquéllas.

**Triggers.** Solo `TRG_investigationSource_setSysDetails`, del bucle genérico de `esaviapp.sql:1284-1298`. No hay `preventPhysicalDelete` —la tabla no figura en `esaviapp.sql:1369-1373`—, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco existe `TRG_investigationSource_setUpdatedAt`: `updatedAt` lo escribe la aplicación.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationSource.model.ts`. Clase `InvestigationSource`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationSource'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13 y F14: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Las ocho fuentes van `DataTypes.BOOLEAN` con `allowNull: true`. `otherDescription` y `notes` van `DataTypes.TEXT`, también `allowNull: true`. No hay ninguna longitud que declarar.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationSource.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationSource.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationSource, { as: 'source', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationSource.types.ts`, junto al de `investigation`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationSourceInput {
    investigationId: string;
    history?: boolean | null;
    interviewVaccinatedPerson?: boolean | null;
    interviewHealthWorker?: boolean | null;
    vaccinationRecord?: boolean | null;
    autopsyRecord?: boolean | null;
    verbalAutopsyRecord?: boolean | null;
    investigationReport?: boolean | null;
    other?: boolean | null;
    otherDescription?: string | null;
    notes?: string | null;
}
```

**No hay `isActive` en el tipo**, porque no hay columna. El update usa `Partial<CreateInvestigationSourceInput>`. No se declara `UpdateInvestigationSourceInput`. `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre**: es inmutable.

Las ocho fuentes admiten `| null` explícito: es lo que permite al cliente **borrar** una respuesta ya dada, y no solo cambiarla. No se necesita ninguna constante nueva: esta entidad no referencia ningún catálogo.

### 3.4 Superficie HTTP

```
POST   /api/investigation-sources                ESAVI-INVSRC-001   USER        (nuevo)
GET    /api/investigation-sources                ESAVI-INVSRC-002A  USER        (nuevo)
GET    /api/investigation-sources/admin          ESAVI-INVSRC-002B  ADMIN       (nuevo)
DELETE /api/investigation-sources/purge/:id      ESAVI-INVSRC-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-sources/case/:caseId   ESAVI-INVSRC-006   USER        (nuevo)
GET    /api/investigation-sources/:id            ESAVI-INVSRC-003   USER        (nuevo)
PUT    /api/investigation-sources/:id            ESAVI-INVSRC-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationSource.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14 y F28, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** No es un olvido: sin `isActive` no hay estado propio que activar. Retirar una fuente es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationSource` · `006` · obtener las fuentes de investigación de un caso — la cadena `caso → investigación → fuente` es uno a uno en los dos saltos**.

**La abreviatura es `INVSRC`.** Seis letras, no colisiona con las veintinueve registradas y `grep "ESAVI-INVSRC-"` no se cruza con `ESAVI-INVESTGN-`, que es el criterio que el F28 fijó al elegir `INVESTGN` sobre `INVEST`.

### 3.5 Reglas de negocio por operación

#### Regla de coherencia de la fuente «otra»

El **estado resultante** de `other` gobierna la regla, y se calcula antes de nada:

```
resultingOther = data.other !== undefined ? (data.other ?? null) : stored.other
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Con `resultingOther === true`** — idéntico en las dos operaciones. La `otherDescription` resultante debe existir y no quedar vacía tras `.trim()`, venga en el body o esté ya guardada → si no, 400 `INVSRC_<op>_OTHER_DESCRIPTION_REQUIRED`. Un `PUT` que manda solo `other: true` sobre una fila que ya tiene descripción guardada es **válido**: el estado resultante es coherente.

**Con `resultingOther` distinto de `true`** — y aquí las dos operaciones se separan:

- **`001` — es 400.** Mandar `otherDescription` con contenido junto a un `other` no verdadero es `INVSRC_001_OTHER_DESCRIPTION_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio una descripción que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente la manda.** Si `otherDescription` **no viaja en el body**, se **fuerza a `null`**: apagar la fuente limpia su descripción sin pedir permiso ni devolver error. Si **viaja con contenido**, sigue siendo 400 `INVSRC_004_OTHER_DESCRIPTION_NOT_ALLOWED`: un body que apaga la fuente y a la vez describe la fuente se contradice a sí mismo, y tragárselo perdería el dato en silencio haciendo creer al cliente que se guardó. Mandarla en `null` o en cadena vacía **no** es error: es el mismo destino al que el forzado llega solo.

**El forzado a `null` es un derivado, no una limpieza posterior:** entra en `candidates` **siempre** que el `other` resultante no sea verdadero, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difiere. Si la fila ya tenía `otherDescription` en `null`, el diff no encuentra nada y **no se escribe**: apagar una fuente que ya estaba apagada no crece `appDetails`.

**La emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. La comprobación va **antes** del diff y con independencia de él.

**Asimetría declarada.** El `001` es estricto y el `004` limpia. No es una inconsistencia: son dos situaciones distintas. El `004` resuelve un huérfano que él no creó —la descripción la guardó una petición anterior—, y el `001` no tiene huérfanos que resolver.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Una fuente cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVSRC-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVSRC_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe fuentes nuevas.
2. Esa investigación **no tiene ya fuente**, buscando **sin filtrar por `deletedAt`** → 409 `INVSRC_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fuente sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. Regla de coherencia de «otra», en su variante estricta.
4. Normaliza: `.trim()` sobre `otherDescription` y `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
5. Inserta con la entrada de auditoría `method: 'ESAVI-INVSRC-001'`.

Las ocho fuentes se guardan tal cual llegan, `null` incluido. **Un alta con las diez columnas de datos vacías es válida** y devuelve 201.

**`ESAVI-INVSRC-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7.

**`ESAVI-INVSRC-002B` — listar, admin.** Idéntica, con el include en `where: {}`: devuelve también las fuentes de investigaciones inactivas. Los mismos dos filtros.

**`ESAVI-INVSRC-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVSRC_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVSRC-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVSRC_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVSRC_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene fuente → 404 `INVSRC_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVSRC-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVSRC_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Una fuente no se traslada entre investigaciones: es el registro de cómo se investigó *ésta*.
3. Regla de coherencia de «otra» sobre el estado resultante. **Antes del diff y con independencia de él.**
4. `stored` sale de `source.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `history` | `data.history !== undefined ? (data.history ?? null) : undefined` | tri-estado: `false` es un valor, no una ausencia |
| `interviewVaccinatedPerson` | `data.interviewVaccinatedPerson !== undefined ? (data.interviewVaccinatedPerson ?? null) : undefined` | ídem |
| `interviewHealthWorker` | `data.interviewHealthWorker !== undefined ? (data.interviewHealthWorker ?? null) : undefined` | ídem |
| `vaccinationRecord` | `data.vaccinationRecord !== undefined ? (data.vaccinationRecord ?? null) : undefined` | ídem |
| `autopsyRecord` | `data.autopsyRecord !== undefined ? (data.autopsyRecord ?? null) : undefined` | ídem |
| `verbalAutopsyRecord` | `data.verbalAutopsyRecord !== undefined ? (data.verbalAutopsyRecord ?? null) : undefined` | ídem |
| `investigationReport` | `data.investigationReport !== undefined ? (data.investigationReport ?? null) : undefined` | ídem |
| `other` | `data.other !== undefined ? (data.other ?? null) : undefined` | ídem. Su valor resultante gobierna la regla de coherencia |
| `otherDescription` | con `other` resultante `true`: `data.otherDescription !== undefined ? data.otherDescription.trim() : undefined` — con `other` resultante distinto de `true`: **siempre `null`** | **derivado condicional**: cuando la fuente se apaga, el `null` entra aunque el cliente no haya mandado nada |
| `notes` | `data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined` | anulable, con `.trim()` antes de comparar |

**Ningún campo va bajo un `if( data.x )`, y en esta entidad esa regla es más crítica que en ninguna otra del repositorio:** ocho de los diez campos son booleanos, y un `if` de veracidad haría **imposible** guardar un `false` — que es precisamente la respuesta «esta fuente no se usó», la mitad del dominio de la entidad. **Ningún campo va cifrado.**

**`ESAVI-INVSRC-005C` — purgar.** `purgeInvestigationSourceService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** la visibilidad heredada —quien purga es SUPERADMIN y la fila puede colgar de una investigación retirada— → 404 `INVSRC_005C_NOT_FOUND`; guarda de sellado con `assertRowIsSealed(row, 'INVSRC_005C_NOT_DELETED', lang)` → 409 si `deletedAt` está vacío; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` — la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6.

**La guarda de sellado es la única red de seguridad de la tabla.** El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** aquí: la columna no existe, `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró nunca. `assertRowIsSealed` se consume **sin modificarlo**: deriva la clave `investigationSource.notDeleted` del nombre de tabla y el id del `primaryKeyAttribute` del modelo.

**Purgar sí libera el `investigationId`**, y es la única vía que lo hace. Tras un `005C`, un `POST` sobre esa misma investigación devuelve 201.

#### Los tres arrastres del `deletedAt`

Sin `isActive`, lo que las cascadas mueven es el sello de `deletedAt`. Los tres son `update` masivos, no lecturas seguidas de escrituras por fila: la cascada no toma ninguna decisión por fila.

**`ESAVI-INVESTGN-005A` — sellar.** Dentro de la transacción que `setInvestigationActivationService` ya abre y **solo cuando `isActive === false`**, `cascadeSealInvestigationSource` sella `deletedAt` y `updatedAt` sobre la fuente de esa investigación **que aún no lo tenga sellado**, y añade a `appDetails` una entrada con `method: 'ESAVI-INVESTGN-005A'` —el código de la operación que la arrastró, no el suyo—. Una investigación sin fuente sella cero filas y no falla. Una fuente ya sellada conserva su `deletedAt` original y **no** recibe entrada nueva.

**`ESAVI-CASE-005A` — sellar también.** `cascadeSealInvestigationSources` en `src/services/esaviCase.service.ts`, séptima función hermana junto a las seis de `:404-566`, invocada en el mismo bloque de `:616-621`. Es necesaria y no redundante: desactivar el caso arrastra la investigación con un `Investigation.update` masivo que **no** pasa por `setInvestigationActivationService`, así que la cascada del punto anterior nunca dispara desde aquí. Sin ella, la fuente de una investigación arrastrada por su caso quedaría sin sellar. Alcanza a las fuentes cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`. Registra `method: 'ESAVI-CASE-005A'`.

**`ESAVI-INVESTGN-005B` — limpiar.** `cascadeClearInvestigationSource` devuelve `deletedAt` a `null` al reactivar la investigación. **Es una cascada de subida**, la excepción que F13 razonó y que F07 no admite para `esaviCase`: aquí es legítima porque la fuente no tiene estado propio que resucitar — su `deletedAt` no significa «alguien la retiró», significa «su investigación estaba retirada». Registra `method: 'ESAVI-INVESTGN-005B'`. **`ESAVI-CASE-005B` no limpia nada**, coherente con F07: reactivar el caso no reactiva la investigación, así que tampoco toca su fuente.

**Ninguno de los tres pasa por `buildDifferentialUpdate`, y es deliberado:** son escrituras con intención propia. Registran el hecho de sellar o devolver la fila, y ese registro en `appDetails` es precisamente lo que se quiere conservar.

**Volcado del `ESAVI-INVESTGN-005C`.** El purgado de una investigación arrastra su fuente por `ON DELETE CASCADE` sin pasar por ningún servicio. Se añade a `purgeInvestigationService` un volcado en nivel `warn` de la fila que va a desaparecer, antes del `destroy` y dentro de la misma transacción. Es la revisión que el F28 §3.5 dejó pendiente, y la única mitigación: **no se bloquea la purga**, por la misma decisión que F13 tomó para `notification`.

**Validaciones de forma** (las emite `validateFields` con 400): `investigationId` obligatorio y `.isUUID()` en create; las ocho fuentes con `.isBoolean()` cuando lleguen, admitiendo `null` explícito; `otherDescription` y `notes` como cadena; `caseId` con `.isUUID()` en el `param` del `006`; los dos filtros del listado con `.isUUID()`, y `limit` y `offset` con `.isInt()`.

### 3.6 Claves i18n nuevas

Bloque `investigationSource` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005C` y `006` |
| `idRequired` | parámetro ausente |
| `notDeleted` | 409 al purgar una fuente sin `deletedAt` sellado. La deriva `assertRowIsSealed` del nombre de tabla, y lleva `{{id}}` |
| `investigationNotFound` | 404 cuando la investigación no existe o está inactiva, en `001` y en `006` |
| `alreadyExists` | 409 cuando la investigación ya tiene fuente, sellada o no. Lleva `{{investigationId}}` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |
| `otherDescriptionRequired` | 400 con `other` resultante `true` y descripción vacía |
| `otherDescriptionNotAllowed` | 400 al mandar una descripción con contenido junto a un `other` no verdadero. **En el `001` siempre; en el `004` solo cuando la descripción viaja en el body** — si no viaja, se fuerza a `null` sin error |

**No hay `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`**: no existen las operaciones que las usarían. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave a los bloques `investigation` ni `esaviCase`: los tres arrastres no producen mensajes propios.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004`, `006` y **también las filas de `002A` y `002B`**:

```
{ ok, message, data: {
    investigationId,
    history, interviewVaccinatedPerson, interviewHealthWorker, vaccinationRecord,
    autopsyRecord, verbalAutopsyRecord, investigationReport,
    other, otherDescription, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    investigation: {
        investigationId, isActive, investigationStartDate,
        status: { catalogItemId, code, name },
        case:   { caseId, caseCode, eventDate }
    }
} }
```

**No hay forma reducida.** El listado devuelve la misma ficha que el `003`: la entidad tiene diez columnas de datos y recortarla dejaría un listado sin contenido. En listados, `data` es `{ count, rows }` de `findAndCountAll`.

**No se devuelve `isActive`**, porque la tabla no tiene esa columna. `deletedAt` es la única marca de estado que la fila lleva, e `investigation.isActive` es la fuente real de su visibilidad.

**Las ocho fuentes se devuelven exactamente como se guardaron, `null` incluido.** Nunca se normalizan a `false` al construir la respuesta: un `null` significa que el formulario no recogió la respuesta y un `false` que el investigador respondió que no.

El include de la investigación es **obligatorio y no decorativo**: es lo que implementa la visibilidad heredada, y ocultarlo dejaría al cliente sin poder explicar por qué un registro que leyó ayer hoy responde 404. Su `status` viaja resuelto y **nunca llega `null`**, por la regla que el F28 §3.5 impuso a aquella entidad. `sysDetails` **nunca** se devuelve, ni el de la fuente ni el de la investigación. Ninguna respuesta incluye datos de las otras trece tablas satélite.

---

## 4. Plan de implementación

**Precondición.** El **SPEC F28** debe estar `Implementado` —lo está—. La PK de esta tabla es su FK, y los arrastres se cuelgan de sus operaciones `005A`, `005B` y `005C`.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Modelo, asociaciones y tipos.** `src/models/investigationSource.model.ts` con la PK **sin `defaultValue`**, las ocho fuentes en `DataTypes.BOOLEAN` y los dos textos en `DataTypes.TEXT`, todos `allowNull: true`, y **sin atributo `isActive`**; `src/models/associations/investigationSource.associations.ts` con el `belongsTo` a `Investigation` como `investigation` y el inverso `Investigation.hasOne(InvestigationSource, { as: 'source' })`, registrado en `initModels()`; `src/types/investigation/investigationSource.types.ts` con `CreateInvestigationSourceInput`, exportado por el `index.ts` de barrel que el dominio ya tiene. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `InvestigationSource.findAll({ include: ['investigation'] })` desde un script suelto devuelve filas sin error de alias; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `investigation`.

2. **Claves i18n.** El bloque `investigationSource` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las diecinueve claves. **Sin `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`:** no existen las operaciones que las usarían.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; `investigationSource.notDeleted` existe en los tres archivos, que es lo que `assertRowIsSealed` resolverá en tiempo de ejecución sin que ningún `grep` estático lo vea.

3. **Validadores.** `src/validators/investigationSource.validator.ts` con cinco arrays: `investigationSourceIdValidator`, `investigationSourceCaseIdValidator` (para el `param('caseId')` del `006`), `investigationSourceListValidator` (los dos filtros de §3.5 más `limit` y `offset`), `createInvestigationSourceValidator` y `updateInvestigationSourceValidator`. Los dos de cuerpo llevan las ocho fuentes con `.isBoolean()` **admitiendo `null` explícito**, y los dos textos como cadena. **Ninguna regla de coherencia va aquí:** depende del estado guardado y vive en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen; un `history: null` no produce 400 y un `history: "sí"` sí.

4. **`ESAVI-INVSRC-001` — crear.** `createInvestigationSourceService` con los cinco pasos de §3.5 en ese orden: investigación existente y activa, unicidad del `investigationId` sin filtrar por `deletedAt`, regla de coherencia en su variante estricta, `.trim()` de los dos textos, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un alta con solo `investigationId` devuelve 201 con las diez columnas de datos en `null`; crear dos veces sobre la misma investigación devuelve **409** `INVSRC_001_ALREADY_EXISTS`, con el `investigationId` interpolado; una investigación inactiva devuelve **404**; `{ other: true }` sin descripción devuelve **400** `OTHER_DESCRIPTION_REQUIRED`; `{ other: false, otherDescription: "x" }` devuelve **400** `OTHER_DESCRIPTION_NOT_ALLOWED`; `{ history: false }` guarda `false` y no `null`.

5. **`ESAVI-INVSRC-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, el include de la investigación en `required: true` con su `status` y su `case`, los dos filtros acumulativos, orden `createdAt DESC`, paginación y la forma completa de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve fuentes de investigaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los dos filtros combinados se aplican con `AND`; toda fila trae las ocho fuentes, los dos textos y `appDetails`; ninguna trae `isActive` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total.

6. **`ESAVI-INVSRC-003` — obtener por ID.** `getInvestigationSourceByIdService(id, lang, includeInactive)` donde el `id` es el `investigationId`, con el include obligatorio del padre y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una fuente cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; una fuente con `deletedAt` sellado pero investigación activa **sí se devuelve** —el sello no oculta la fila, la oculta el padre—; `investigation.status` no llega `null`; `sysDetails` no aparece ni en la fuente ni en la investigación.

7. **`ESAVI-INVSRC-006` — obtener por caso.** `getInvestigationSourceByCaseIdService(caseId, lang, includeInactive)` con los **tres** 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `investigationSourceCaseIdValidator`, declarada antes de `/:id`. Fila `investigationSource` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y fuente devuelve 200 con la ficha completa, no envuelta en un array; un `caseId` inexistente devuelve 404 `INVSRC_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVSRC_006_INVESTIGATION_NOT_FOUND`; una investigación sin fuente devuelve 404 `INVSRC_006_NOT_FOUND`. Los tres códigos son distintos entre sí; `GET /case/no-es-uuid` devuelve 400.

8. **`ESAVI-INVSRC-004` — actualizar, diferencial.** `updateInvestigationSourceService` con los seis pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` ignorado; los ocho booleanos y `notes` comparados contra `undefined`; `otherDescription` como derivado condicional. La lectura para el diff se hace **sin `attributes` acotados** y con el include del padre, para que la visibilidad heredada se compruebe en la misma consulta de la que sale la instancia. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; **`{ history: false }` sobre una fila con `history: true` se guarda como `false`** y no se descarta; `{ history: null }` vacía el campo; enviar `investigationId` no lo modifica y no devuelve error; `{ other: true }` sobre una fila con descripción guardada devuelve 200; `{ other: false }` sobre esa misma fila deja `otherDescription` en `null` en la **misma** petición, con **una** entrada en `appDetails`; `{ other: false, otherDescription: "x" }` devuelve **400**; `{ other: false }` sobre una fila que ya tenía `other: false` y descripción `null` **no escribe nada**.

9. **`ESAVI-INVSRC-005C` — purgar.** `purgeInvestigationSourceService` sobre `purgeEntityService`, con transacción propia, existencia con `paranoid: false` y **sin** visibilidad heredada, y `assertRowIsSealed(row, 'INVSRC_005C_NOT_DELETED', lang)` **antes** del `destroy`. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `investigationSourceIdValidator` y declarada junto a las otras literales.
   *Verificación:* purgar una fuente sin `deletedAt` sellado devuelve 409 `notDeleted` con el id interpolado y la fila sigue ahí — **es la comprobación que prueba que el control de `isActive` de `purgeEntityService` es inerte aquí**; desactivar la investigación y purgar la fuente devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre esa investigación devuelve 201**: es la única vía que libera el `investigationId`; la investigación sigue existiendo e intacta.

10. **Los dos arrastres desde `investigation` y el volcado del `005C`.** En `src/services/investigation.service.ts`: `cascadeSealInvestigationSource` invocada desde `setInvestigationActivationService` **solo cuando `isActive === false`**, y `cascadeClearInvestigationSource` **solo cuando `isActive === true`**, las dos dentro de la transacción que aquel servicio ya abre. La primera sella `deletedAt` y `updatedAt` **solo sobre la fila que aún no lo tenga sellado** y registra `method: 'ESAVI-INVESTGN-005A'`; la segunda devuelve `deletedAt` a `null` y registra `'ESAVI-INVESTGN-005B'`. Más el volcado en `warn` de la fuente en `purgeInvestigationService`, antes del `destroy` y en la misma transacción.
    *Verificación:* desactivar una investigación con fuente le sella `deletedAt`; reactivarla lo devuelve a `null`; una fuente sellada a mano **antes** de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; una investigación sin fuente se desactiva y se reactiva sin error; el `appDetails` de la arrastrada registra `ESAVI-INVESTGN-005A` y luego `ESAVI-INVESTGN-005B`, con su historial anterior intacto; purgar una investigación con fuente deja la línea `warn` en `src/logs/esaviLog.log` y **no** devuelve error.

11. **El tercer arrastre, desde `esaviCase`.** `cascadeSealInvestigationSources` en `src/services/esaviCase.service.ts`, séptima función hermana junto a las seis de `:404-566`, invocada en el bloque de `:616-621` dentro de la misma transacción y **solo cuando `isActive === false`**. Alcanza a las fuentes cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`, y registra `method: 'ESAVI-CASE-005A'`. Va después del paso 10 porque depende del modelo y no lo necesita ningún paso anterior. **`ESAVI-CASE-005B` no se toca.**
    *Verificación:* desactivar un caso con investigación y fuente **sella la fuente**, y ése es el punto entero del paso: sin él la fuente quedaría sin sellar, porque la investigación la arrastra un `update` masivo que no pasa por `setInvestigationActivationService`; reactivar el caso no limpia el sello; un caso sin investigación, o con investigación sin fuente, se desactiva sin error; las seis cascadas anteriores siguen produciendo el mismo efecto.

12. **Registrar la entidad en las convenciones.** Fila `investigationSource` → `INVSRC` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationSource` · `006` · «obtener las fuentes de investigación de un caso — la cadena `caso → investigación → fuente` es uno a uno en los dos saltos» en la tabla de operaciones no canónicas.
    *Verificación:* `INVSRC` aparece una sola vez y no colisiona con las veintinueve existentes; la tabla de no canónicas suma exactamente una fila.

13. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más siete.
    *Verificación:* `npm test -- roles` pasa.

14. **Suite de contrato `tests/contract/investigationSource.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → purgar. Más los caminos de error: investigación inexistente (404), investigación inactiva (404), investigación ya con fuente sellada y sin sellar (409 las dos), caso inexistente y caso sin investigación en el `006` (404 con códigos distintos), las tres variantes de la regla de «otra» (400, 400 y el forzado silencioso), y purgar sin sellar (409). Más el bloque diferencial completo de §5, con **especial cobertura del `false`**: es la mitad del dominio de las ocho fuentes y lo que un `if( data.x )` rompería.
    *Verificación:* `npm test -- investigationSource` en verde.

15. **Ampliar `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera, tres casos: desactivar la investigación sella su fuente, reactivarla la limpia, y purgar la investigación destruye la fuente por cascada de Postgres sin devolver error. En la segunda, dos: desactivar el caso sella la fuente de su investigación, y reactivarlo no la limpia. Los casos existentes de ambas suites se mantienen intactos.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las seis operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVSRC-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVSRC-005[AB]" src/` no devuelve resultados: la entidad **no tiene** activación ni desactivación propias.
- [ ] `grep -rn "ESAVI-INVSRC-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "isActive" src/models/investigationSource.model.ts` no devuelve resultados: la tabla no tiene esa columna.
- [ ] `INVSRC` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigationSource` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` exporta el archivo nuevo.
- [ ] `GET /api/investigation-sources/admin` y `GET /api/investigation-sources/case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Investigation.hasOne(InvestigationSource)` está declarado, y la fuente **no** aparece en ninguna respuesta de `/api/investigations`.
- [ ] `git diff esaviapp.sql` está vacío.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationSource.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada. En esta entidad la única FK es la PK: un `PUT` sobre una fuente cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] **`{ history: false }` sobre una fila con `history: true` guarda `false`**, y `{ history: null }` la vacía. Ningún candidato entra bajo un `if( data.x )` — es el criterio que más importa aquí: ocho de los diez campos son booleanos y un `if` de veracidad haría imposible guardar la mitad del dominio.
- [ ] Un `PUT` que reenvía las ocho fuentes tal como las devolvió el `GET`, con sus `false` y sus `null`, **no** cuenta como cambio.
- [ ] `{ notes: "" }` deja el campo vacío, y un `notes` con espacios alrededor del mismo texto guardado **no** cuenta como cambio: el `.trim()` va antes de comparar.

**Regla de la fuente «otra»**

- [ ] `POST` con `{ other: true }` y sin descripción → **400** `OTHER_DESCRIPTION_REQUIRED`.
- [ ] `POST` con `{ other: false, otherDescription: "x" }` → **400** `OTHER_DESCRIPTION_NOT_ALLOWED`. El `001` es estricto.
- [ ] `PUT` con `{ other: true }` sobre una fila que ya tiene descripción guardada → **200**: la regla mira el estado resultante, no el body.
- [ ] `PUT` con `{ other: false }` sobre esa misma fila → **200**, con `otherDescription` en `null` en la **misma** petición y **una** sola entrada en `appDetails`. No hay huérfano y no hay error.
- [ ] `PUT` con `{ other: false, otherDescription: "x" }` → **400**. El forzado silencioso no se traga un body que se contradice a sí mismo.
- [ ] `PUT` con `{ other: false }` sobre una fila que ya tenía `other: false` y `otherDescription: null` → **200 sin escribir nada**: el `null` forzado entra en `candidates` pero el diff no encuentra diferencia.
- [ ] `PUT` con `{ other: true }` sobre una fila sin descripción guardada y sin mandarla → **400** `OTHER_DESCRIPTION_REQUIRED`.

**Uno a uno y ciclo de vida**

- [ ] `POST` sobre una investigación que ya tiene fuente devuelve **409** `alreadyExists`, con el `investigationId` interpolado.
- [ ] `POST` sobre una investigación cuya fuente tiene `deletedAt` sellado devuelve también **409**: el sello no libera el hueco de la clave primaria.
- [ ] Purgar la fuente con `005C` libera el `investigationId`, y un `POST` posterior devuelve **201**.
- [ ] Enviar `investigationId` en el body de `PUT /:id` no lo modifica y no devuelve error.
- [ ] Purgar una fuente **sin** `deletedAt` sellado devuelve **409** `notDeleted` y la fila sigue existiendo. Es el criterio que prueba que el control de `isActive` de `purgeEntityService` es inerte sobre esta tabla.
- [ ] `assertRowIsSealed` se consume sin modificarlo: `git diff src/helpers/rowSeal.helper.ts` está vacío.
- [ ] Ninguna ruta responde a `DELETE /api/investigation-sources/:id` ni a `PATCH /api/investigation-sources/activate/:id`: las dos devuelven 404 de Express.

**Los tres arrastres**

- [ ] Desactivar la investigación con `INVESTGN-005A` sella el `deletedAt` de su fuente y registra `method: 'ESAVI-INVESTGN-005A'` en su `appDetails`.
- [ ] Reactivarla con `INVESTGN-005B` devuelve `deletedAt` a `null` y registra `'ESAVI-INVESTGN-005B'`. El historial anterior queda intacto en los dos casos.
- [ ] **Desactivar el caso con `CASE-005A` sella la fuente**, y registra `method: 'ESAVI-CASE-005A'`. Sin el paso 11 este criterio falla, y es la única forma de detectarlo.
- [ ] Reactivar el caso con `CASE-005B` **no** limpia el sello de la fuente, coherente con F07.
- [ ] Una fuente sellada a mano antes de cualquier cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.
- [ ] Una investigación sin fuente, y un caso sin investigación, atraviesan las tres cascadas sin error y sin afectar a ninguna fila.
- [ ] Purgar la investigación con `INVESTGN-005C` destruye la fuente por cascada de Postgres, deja la línea `warn` en el log y **no** devuelve error.
- [ ] Las seis cascadas que `esaviCase.service.ts` ya tenía siguen produciendo el mismo efecto: ninguna suite anterior pierde un caso.

**Listados y respuesta**

- [ ] Los dos filtros de §3.5 se combinan con `AND` y son por igualdad; `caseId` resuelve por el include de la investigación.
- [ ] Un filtro con un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`.
- [ ] `GET /` no devuelve fuentes de investigaciones inactivas; `GET /admin` sí; un USER recibe **403** en `/admin`.
- [ ] Las filas del listado traen la **misma** forma completa que el `003`: no hay forma reducida.
- [ ] Ninguna respuesta devuelve `isActive` en la fuente, y ninguna devuelve `sysDetails` — ni el de la fuente ni el de la investigación incluida.
- [ ] `investigation.status` no llega `null` en ninguna respuesta.
- [ ] Las ocho fuentes se devuelven tal como se guardaron: un `null` no se convierte en `false` al construir la respuesta.
- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`, y sus tres 404 llevan códigos distintos entre sí.
- [ ] Ninguna respuesta incluye datos de las otras trece tablas satélite.

**Cierre**

- [ ] Las diecinueve claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` cubre las siete rutas nuevas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `INVSRC`. **No:** `INVSOURCE`, que se pasa del máximo de ocho letras; **no:** `INVSOURC`, que lo cumple a costa de ser ilegible. `INVSRC` no colisiona con las veintinueve registradas y `grep "ESAVI-INVSRC-"` no se cruza con `ESAVI-INVESTGN-`, que es el criterio que el F28 fijó al elegir `INVESTGN` sobre `INVEST`.
- **Sí:** solo esta tabla. **No:** aprovechar el spec para meter `investigationAutopsy`, que es la satélite contigua y comparte el bloque del formulario. Son dos entidades con reglas distintas —aquélla consume `answerOption` y arrastra fechas y horas—, y el criterio de dividir lo fijaron F10 con las ocho satélites de `notification` y F28 con las catorce de `investigation`.
- **Sí:** listado dual `002A` / `002B`, apartándose de F13 y F14. La visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos y sin `002B` un ADMIN no puede ver la fuente de una investigación retirada. El argumento de aquellos specs —«sin `isActive` no hay dos listados que difieran»— confundía el estado propio con la visibilidad. **No:** corregir F13 y F14 aquí: están `Implementado`, con sus suites cerradas, y ampliarlas es su propio spec.
- **Sí:** cinco operaciones de escritura y lectura más las dos de listado, sin `005A` ni `005B`. **No:** inventar una activación que escriba `deletedAt` a mano para simular el par. La tabla no tiene estado propio: retirar una fuente es retirar su investigación, y una operación que fingiera lo contrario dejaría dos verdades sobre el mismo hecho.
- **Sí:** el `003` por `investigationId`, que es la PK. **No:** un `006` por `/investigation/:id` como el de `notificationPregnancy`. Sería la misma consulta con otro nombre: aquí la clave primaria de la fila *es* el identificador de su padre.
- **Sí:** `006` por `/case/:caseId`, atravesando los dos saltos. Es la consulta real del dominio —el cliente tiene el caso, no la investigación— y el mismo criterio de `severeNotification` y `nonSevereNotification`.
- **Sí:** tres 404 distintos en el `006`. **No:** un solo `notFound` genérico. Un cliente que recibe 404 necesita saber si el caso no existe, si no hay investigación abierta o si la investigación aún no tiene fuentes registradas: son tres acciones distintas del usuario, y una sola clave las volvería indistinguibles.
- **Sí:** la regla de coherencia de «otra» evaluada sobre el estado resultante. **No:** sobre el body. Un `PUT` que solo enciende `other` sobre una fila que ya tiene descripción es coherente, y rechazarlo obligaría al cliente a reenviar un dato que no está cambiando — exactamente lo que el update diferencial existe para evitar.
- **Sí:** en el `004`, forzar `otherDescription` a `null` cuando la fuente se apaga y el cliente no manda descripción. **No:** devolver 400 pidiéndole que mande `otherDescription: null` explícito. El huérfano lo creó una petición anterior, no ésta, y el estado resultante es inequívoco: apagar la fuente es borrar su descripción. Un 400 aquí sería un trámite, no una protección.
- **Sí:** conservar el 400 cuando la descripción **sí** viaja junto a un `other` no verdadero. **No:** silenciarlo también. Un body que apaga la fuente y a la vez la describe se contradice a sí mismo; tragárselo perdería el texto en silencio y el cliente creería haberlo guardado. El riesgo de un dato perdido sin aviso pesa más que el de un 400 evitable.
- **Sí:** asimetría entre `001` y `004` en esa regla. **No:** la misma regla en las dos. El `004` resuelve un huérfano heredado; el `001` no tiene nada que heredar, así que aceptar y limpiar allí solo produciría un 201 que miente sobre lo que guardó.
- **Sí:** `otherDescription` forzado como **derivado condicional**, entrando en `candidates` sin `if` de presencia. **No:** limpiarlo con un `update` posterior al diff. Un segundo `UPDATE` escribiría aunque nada cambie, y rompería el criterio de que apagar una fuente ya apagada no crece `appDetails`.
- **Sí:** las ocho fuentes como tri-estado anulable, con `false` como valor de primera clase. **No:** normalizarlas a `false` al leer ni al escribir. `null` es «el formulario no lo recogió» y `false` es «el investigador dijo que no»; fundirlas destruiría la única forma de saber si la investigación llegó a preguntarlo.
- **No:** exigir al menos una fuente informada. Un alta con las ocho en `null` es la vía normal de abrir la fila y completarla con el `PUT`, igual que en F14. Exigirlo obligaría al cliente a inventar una respuesta para poder guardar un borrador.
- **No:** hacer las ocho fuentes excluyentes entre sí. El DDL no lo impide y el dominio tampoco: `history` e `investigationReport` a la vez es un caso normal. Son ocho preguntas independientes, no una selección única.
- **Sí:** forma completa también en el listado. **No:** una forma reducida como la de F28. La entidad tiene diez columnas de datos y ocho son la respuesta misma; recortarlas dejaría un listado sin contenido, y recortar solo los dos textos ahorraría muy poco a cambio de dos formas que mantener.
- **Sí:** `assertRowIsSealed` consumido tal cual. Su comentario habla de «satélites de `notification`», pero el helper es genérico: deriva la clave i18n del nombre de tabla y el id del `primaryKeyAttribute`. Esta entidad es la prueba de que la generalización que F14 hizo era la correcta, y por eso **no** se toca el archivo — ni siquiera el comentario, que actualizará el spec que lo reescriba por otra razón.
- **Sí:** la séptima función hermana en `esaviCase.service.ts`. **No:** confiar en la cascada de `INVESTGN-005A`. Desactivar el caso arrastra la investigación con un `update` masivo que nunca pasa por `setInvestigationActivationService`, así que aquella cascada no dispara desde ahí y la fuente quedaría sin sellar. Es el error más fácil de cometer en este spec y por eso tiene criterio de aceptación propio.
- **Sí:** cascada de subida en `INVESTGN-005B`. Es la excepción que F13 razonó, y aquí es legítima por lo mismo: el `deletedAt` de la fuente no significa «alguien la retiró», significa «su investigación estaba retirada». **No:** cascada de subida desde `CASE-005B`, que contradiría a F07 — reactivar el caso no reactiva la investigación, así que tampoco puede tocar su fuente.
- **Sí:** dejar que `INVESTGN-005C` arrastre la fuente, con volcado en `warn` como única mitigación. **No:** bloquear la purga de una investigación que tenga fuente. Es la decisión que F13 tomó para `notification` y se hereda sin reabrirse: quien purga es SUPERADMIN sobre una fila ya retirada, y añadir un bloqueo obligaría a purgar en dos pasos con la única ventaja de un aviso que el log ya da.
- **Sí:** `investigationId` inmutable en el `004`, ignorado en silencio y sin 400. **No:** permitir el traslado entre investigaciones. Una fuente es el registro de cómo se investigó *esa* investigación; moverla llevaría la procedencia de la información al expediente de otro paciente.
- **No:** cifrar ningún campo. Ocho booleanos y dos textos sobre procedimiento; no hay ni un dato identificativo del paciente.
- **No:** ninguna regla cruzada con `investigationAutopsy`, `classification` ni `notificationVaccine`. Marcar `autopsyRecord` sin que exista la autopsia registrada es hoy posible y aceptado: aquella tabla ni siquiera está implementada, y atar las dos exige antes decidir cuál manda.
- **No:** tablero ni conteo por las ocho fuentes. Es una agregación con su propia forma de respuesta, y meterla aquí convertiría un CRUD en dos entidades.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un `if( data.x )` en la construcción de `candidates` haría **imposible guardar un `false`** en las ocho fuentes, y el fallo es silencioso: el `PUT` devuelve 200 y el campo se queda como estaba | Es el riesgo más probable del spec, porque seis de los doce servicios del repositorio nacieron así. La tabla de `candidates` de §3.5 lo declara campo por campo y dos criterios de aceptación lo verifican explícitamente sobre `history` |
| El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** sobre esta tabla: `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró | `assertRowIsSealed` es la única red, y por eso la guarda va **antes** del `destroy` y tiene criterio propio. El helper ya existe y se consume sin modificarlo |
| La cascada de `ESAVI-INVESTGN-005A` **no dispara** cuando quien arrastra la investigación es `ESAVI-CASE-005A`, porque aquélla se implementa con un `update` masivo que no pasa por el servicio de activación. La fuente quedaría sin sellar y nadie lo notaría | La séptima función hermana del paso 11 existe exactamente para esto, y el criterio de aceptación correspondiente es el único que la detecta. Es el error más fácil de cometer en este spec |
| `ESAVI-INVESTGN-005C` destruye la fuente por cascada de Postgres sin pasar por ningún servicio de esta entidad: ni auditoría, ni `appDetails`, ni posibilidad de deshacer | El volcado en `warn` es la única mitigación, y es deliberado: se decidió no bloquear la purga. Quien la ejecuta es SUPERADMIN sobre una investigación ya retirada |
| Una fuente puede afirmar `autopsyRecord: true` sin que exista ninguna fila en `investigationAutopsy`, y al revés | Sin mitigación en este spec. Aquella tabla no está implementada, y la coherencia entre las dos exige antes decidir cuál manda. Queda fuera de alcance en §2 |
| El `004` es la operación principal de la entidad —las diez columnas son anulables y la fila se abre vacía—, así que un fallo del diferencial ensuciaría `appDetails` y `sysDetails` en **cada apertura del formulario** | Los ocho criterios del bloque diferencial de §5 son la cobertura; el corte temprano cuando el diff vuelve vacío es la única línea de control que le queda al servicio |
| El forzado de `otherDescription` a `null` entra en `candidates` en **toda** petición cuyo `other` resultante no sea verdadero, incluidas las que no tocan nada de «otra» | Es correcto y está buscado: el helper decide si difiere. El criterio que lo verifica es el `PUT` con `{ other: false }` sobre una fila ya apagada, que debe responder 200 **sin escribir** |
| `GET /:id` captura `/admin`, `/purge` o `/case` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por un criterio de aceptación explícito |
| Este spec y cualquier hermano futuro editan el mismo bloque de `esaviCase.service.ts` y el mismo total de `ROUTE_RULES` | El paso 11 aísla el arrastre en una séptima función hermana en vez de ampliar las seis existentes, que es lo que permitió a F09, F10, F13, F14 y F28 tocar ese bloque sin colisionar |
| Las trece satélites restantes de `investigation` llegarán con la misma forma, y trece copias de este servicio es lo que se estaría empezando aquí | Se acepta por ahora. `assertRowIsSealed` ya generalizó la pieza que F13 y F14 habrían duplicado; si la tercera satélite de `investigation` vuelve a copiar el arrastre y la visibilidad heredada, **ése es el momento de extraer un servicio común**, no antes |

---

## 8. Impacto en el contrato HTTP

El spec añade siete rutas nuevas y **no cambia la forma de ninguna respuesta existente**. Ningún endpoint devuelve un campo distinto, ni un status distinto, ni un mensaje distinto.

Lo que sí cambia son **efectos sobre filas de una entidad que hasta ahora no existía**, y por eso ningún cliente actual puede notarlo:

- `DELETE /api/investigations/:id`, `PATCH /api/investigations/activate/:id` y `DELETE /api/esavi-cases/:id` pasan a sellar o limpiar el `deletedAt` de la fuente. Status, mensaje y cuerpo son idénticos.
- `DELETE /api/investigations/purge/:id` añade una línea en `warn` al log. La respuesta no cambia.

`GET /api/investigations` y `GET /api/investigations/:id` **no** incluyen la fuente en su `data`: la asociación `hasOne` se declara pero no se usa en ninguna respuesta de aquella entidad.

---

## Lo que **no** está en este spec

- Las otras trece tablas satélite de `investigation`: `investigationAutopsy`, `investigationTeamMember`, `investigationCovidHistory`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `evaluationInstitution`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- Añadir el listado dual a `severeNotification` y `nonSevereNotification`, pese a que el razonamiento de §1B las alcanza.
- Cualquier regla cruzada entre `autopsyRecord` o `verbalAutopsyRecord` y la tabla `investigationAutopsy`, entre `history` y `classification`, o entre `vaccinationRecord` y `notificationVaccine`.
- Cualquier tablero, conteo o filtro por las ocho fuentes.
- Exigir al menos una fuente informada, o hacerlas excluyentes entre sí.
- Crear la fuente automáticamente al dar de alta una investigación.
- Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene fuente.
- Trasladar una fuente de una investigación a otra.
- Modificar `esaviapp.sql`, `setEntityActiveStatusService`, `purgeEntityService` o `assertRowIsSealed`.
- Cifrado de ningún campo.
- Búsqueda por texto sobre `otherDescription` o `notes`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
