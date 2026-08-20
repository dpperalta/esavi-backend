# SPEC F27 — CRUD de `notificationPregnancyComplication`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F25 (`notificationPregnancy` — dependencia dura de modelo: es el padre de la FK, la fuente de la visibilidad heredada y quien dejó abierta la pregunta que §6 responde)**, **SPEC F15 (`diagnosticTerm` — dependencia dura de implementación: aporta `resolveDiagnosticTermService`)**, SPEC F16 (`notificationEvent` — precedente de la resolución contra el maestro y del hallazgo del `005B`), SPEC F24 (`notificationDiluent` — precedente de la nieta y de la visibilidad heredada en cadena), SPEC F10 (`notification` — la cascada de su `005C` gana una línea), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa, y gobierna cuándo se re-dispara la resolución contra el maestro)
> **Fecha:** 2026-08-19
> **Objetivo:** Dar de alta `notificationPregnancyComplication` —las complicaciones de la sección de embarazo— como la **octava y última** tabla satélite de `notification`, cerrando el mapa que F10 abrió.

---

## 1. Por qué existe este spec

`notificationPregnancyComplication` es la **octava satélite de `notification`**, y con ella no queda ninguna. Guarda **cada complicación registrada sobre un embarazo notificado** —anomalías congénitas, complicaciones fetales o neonatales, complicaciones del parto—, tipificada contra un catálogo y, cuando el notificador aporta un código, resuelta contra el maestro clínico.

Hoy la tabla existe en `esaviapp.sql:905-923` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta. [F25](./25-notificationpregnancy-crud.md) la nombra doce veces y no la toca.

**A — Es una nieta, pero no la nieta de F24.** `notificationDiluent` cuelga de `notificationVaccine`, que cuelga de `notification`, y **los dos saltos son N**. Aquí el primer salto es **uno a uno**: `UQ_notificationPregnancy_notification` (`:902`) garantiza un solo embarazo por notificación. La consecuencia práctica es que la cadena de visibilidad heredada es la misma que estrenó F24 —dos saltos, `complication → pregnancy → notification`— pero el abanico no se abre hasta el segundo nivel.

**B — Arrastra el hallazgo del `005B` de F16, y es la quinta vez.** Figura en la lista de `setSortOrderByParent` con `pregnancyId` como padre (`:1310`) y tiene índice único parcial `UQ_notificationPregnancyComplication_parent_sortOrder` sobre `("pregnancyId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1345-1346`). El trigger es `BEFORE INSERT` solamente, y `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número: reactivar una fila cuyo `sortOrder` ya lo tomó otra hermana viva revienta el índice. F16 lo descubrió, F21, F22 y F24 lo arrastraron, y aquí vuelve entero. **Es la diferencia exacta con su padre**, cuyo `005B` F25 §1.E pudo declarar delegación limpia precisamente porque `notificationPregnancy` no tiene `sortOrder`.

**C — Es la segunda consumidora de `resolveDiagnosticTermService`, y la primera sin sitio donde copiar el maestro.** `notificationEvent` tiene tres columnas para el término: `esaviName` NOT NULL con el nombre del maestro, `esaviCode` con el código y `esaviRawName` con la divergencia (`:794-796`). Esta tabla tiene **una sola**: `complicationRawName` (`:910`). No hay dónde denormalizar el nombre ni el código, así que ambos se leen del maestro por el `include`, y la tabla de derivados de F16 pasa de **tres campos a dos**. Es una simplificación del DDL, no un descuido: el nombre canónico de una complicación vive en `diagnosticTerm` y no tiene por qué duplicarse en cada fila que lo cite.

**D — Tiene dos FKs a maestros y se validan de forma distinta.** `complicationTypeItemId` (`:909`) apunta a `catalogItem` y es **obligatoria en el alta**, validada con el doble salto contra `catalogType` que `nonSevereNotification.service.ts:191` estableció: el ítem existe, está activo y pertenece al catálogo `pregnancyComplicationType`. `diagnosticTermId` (`:908`) es **opcional y derivada** —no viaja en el body, la devuelve la resolución—. Las dos son `ON DELETE RESTRICT` (`:921-922`), así que una complicación impide borrar físicamente lo que cita; irrelevante en la práctica, porque `diagnosticTerm` y `catalogItem` figuran en `preventPhysicalDelete` (`:1366-1367`) y no tienen `005C`.

**E — Estrena una guarda de unicidad que la base no respalda.** El par `(diagnosticTermId, complicationTypeItemId)` no puede repetirse entre las complicaciones **activas** del mismo embarazo → 409. No hay `UNIQUE` ni índice que lo imponga: es regla de negocio pura, y por eso mira solo filas activas y solo corre cuando hay término. Es lo contrario del `001` de F25, cuyo 409 sobre fila inactiva nacía de una restricción real de la base (`:902`) que había que respetar. Aquí no hay ninguna, y una guarda inventada no debe ser más rígida que las que sí existen.

**F — Responde la pregunta que F25 dejó por escrito.** F25 §6 dice, palabra por palabra, que si `hasComplications` pasa a ser derivado *«lo decidirá el spec de la tabla hija»*. La respuesta es **no**: sigue siendo dato del cliente. F27 lee de `notificationPregnancy` para la visibilidad heredada y **no le escribe nunca**, ni en el `001`, ni en el `005A`, ni en el `005B`. §6 razona por qué.

**G — Es hoja del grafo.** Ninguna tabla la referencia, así que su `005C` no lleva volcado de cascada. Pero **cierra dos cascadas ajenas**: el `005C` de `NOTIFPRG` ya vuelca sus `complicationId` con `sequelize.query` (F25 §3.5) y esa consulta se queda como está; y la cascada de `ESAVI-NOTIFCN-005C`, que hoy destruye complicaciones en un tercer salto sin dejar rastro, gana su sexta línea `warn`.

**H — Vuelve a tocar `esaviapp.sql`, con una sola línea.** F25 fue la única satélite que no tocó el esquema. Ésta añade `IX_notificationPregnancyComplication_pregnancy`, como hicieron F21, F22 y F24: el único índice que existe hoy sobre `pregnancyId` es el parcial de `sortOrder`, que deja fuera precisamente las filas borradas que el `002B` tiene que leer.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notificationPregnancyComplication`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones y ninguna más:** `001` crear, `002A` listar activas por embarazo, `002B` listar todas por embarazo, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar y `005C` borrado físico. **Sin `006` en ninguna forma** — se entra por `pregnancyId`, que el `ESAVI-NOTIFPRG-006` ya devuelve, y F27 no añade fila a la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
- **Una sola línea nueva en `esaviapp.sql`:** `CREATE INDEX IF NOT EXISTS "IX_notificationPregnancyComplication_pregnancy" ON "notificationPregnancyComplication" ("pregnancyId")`. El índice parcial de `:1345-1346` no sirve para el `002B`, que lee también filas con `deletedAt` sellado.
- **Relación uno a muchos con `notificationPregnancy`.** Se entra por `/pregnancy/:pregnancyId` en los dos listados, y por `complicationId` en el resto. Nunca por `/`.
- **Guarda del alta:** el embarazo existe y está **activo**, y su notificación también → 404 `PREGCOMP_001_PREGNANCY_NOT_FOUND`. Es un `include` de un salto sobre la consulta que ya se hace; la notificación no se consulta aparte.
- **`complicationTypeItemId` obligatorio en el `001`**, validado con el doble salto de `assertVaccinationSiteIsValid`: el `catalogItem` existe, está activo y su `catalogType` tiene `code: 'pregnancyComplicationType'` → si no, 404 `PREGCOMP_001_COMPLICATION_TYPE_NOT_FOUND`. **El catálogo no se cablea:** el spec valida la pertenencia al tipo, no el contenido. Los tres ítems que el dominio maneja hoy —anomalías congénitas, complicaciones fetales o neonatales, complicaciones del parto— son datos de una instalación concreta y pueden crecer o diferir por país.
- **Resolución contra el maestro clínico, en `001` y `004`**, con las dos ramas de F16:
  - Con `complicationCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService`, que devuelve el término existente o **lo crea**.
  - Con `complicationCode` y `source` distinto de `'LOCAL'` → `findOne` sobre el par `(source, code)`, **sin crear nada**; si no existe → 404 `PREGCOMP_<op>_DIAGTERM_NOT_FOUND`.
  - Sin `complicationCode` → `diagnosticTermId` queda `null` y `complicationRawName` guarda el texto del notificador tal cual.
- **Dos campos derivados, no tres.** `diagnosticTermId` y `complicationRawName`. Esta tabla **no tiene columna para el nombre del maestro ni para el código**, así que `complicationRawName` guarda el texto del notificador **solo si difiere** del nombre del maestro, y el nombre canónico se lee del `include`. Es la tabla de F16 menos una fila.
- **Resolución disparada por el cambio de valor, no por la presencia de la clave** (SPEC F12): en el `004`, un `complicationCode` que llega igual al guardado no se resuelve ni se consulta. Reenviar íntegra la respuesta del `GET` **no escribe en `diagnosticTerm`**.
- **`complicationName` obligatorio en el `001`**, máximo 500 caracteres. Una complicación sin nombre no informa de nada. Es la forma que F25 eligió para `wasPregnantAtVaccination` —un campo concreto y nombrable— en lugar de la guarda de contenido mínimo genérica de F24.
- **Guarda de duplicado**, en `001` y `004`: el par `(diagnosticTermId, complicationTypeItemId)` no puede repetirse entre las complicaciones **activas** del mismo embarazo → 409 `PREGCOMP_<op>_ALREADY_EXISTS`. **Solo corre si `diagnosticTermId` tiene valor**: dos complicaciones de texto libre del mismo tipo son registros distintos. **El `005B` no la revalida**, y el duplicado por reactivación es consecuencia asumida, razonada en §6.
- **`complicationTypeItemId` no es anulable en el `004`.** La clave es opcional en el body, pero si llega debe ser un UUID válido: un `null` explícito es 400 del validador. Obligatorio al nacer y vaciable después dejaría filas que el `001` habría rechazado. Es la asimetría contraria a la que F25 eligió para `wasPregnantAtVaccination`, y §6 dice por qué.
- **`sortOrder` inmutable y asignado por la base.** El `001` nunca lo envía —lo pone `TRG_notificationPregnancyComplication_setSortOrder` (`:1310`)— y el `004` lo ignora en silencio, sin 400. Exige la lista explícita `CREATE_FIELDS` en el `create`, por la razón que F16 §3.2 documentó: sin ella, la validación `notNull` de Sequelize mata el alta antes de que el trigger llegue a ejecutarse.
- **Reasignación de `sortOrder` en `ESAVI-PREGCOMP-005B`** cuando el número que ocupaba la fila ya lo tomó otra complicación viva del mismo embarazo. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación **no** delega sin más en `setEntityActiveStatusService`.
- **Visibilidad heredada, en cadena de dos saltos.** Toda lectura incluye `pregnancy` y, a través de ella, `notification`: si cualquiera de las dos está inactiva, la complicación responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Aplica a `002A`, `002B`, `003` y `004`. Es la cadena que F24 estrenó.
- **Los dos listados devuelven `{ count, rows }`** de `findAndCountAll`, ordenados por `sortOrder` ascendente, paginados con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. **Sin ningún filtro por query.**
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial, igual que en F16.
- **`005C` sin volcado de cascada**, porque no hay nada que arrastrar. Guarda canónica: la fila debe estar en `isActive: false` → si no, 409.
- **Sexta línea `warn` en la cascada de `ESAVI-NOTIFCN-005C`**, con el conteo y la lista de `complicationId` que el **tercer salto** `notification → pregnancy → complications` destruye, junto a las cinco que F16, F21, F22, F24 y F25 dejaron. Implica tocar `src/services/notification.service.ts` solo en ese punto.
- **Normalización al escribir: solo `trim()`** sobre `complicationName` y `notes`, con `normalizeText`. Es la **octava** copia del helper —`nonSevereNotification`, `notificationDiluent`, `notificationEvent`, `notificationMedication`, `notificationPregnancy`, `notificationVaccine` y `severeNotification` ya la tienen—, y la deuda que F24 §7 declaró vencida sigue vencida.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` de §3.5: `pregnancyId` y `sortOrder` inmutables, dos campos derivados que entran **siempre**, y dos anulables.
- Alta de la abreviatura **`PREGCOMP`** en `references/CONVENTIONS.md` §6, reservada por F25 §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **194 a 202**— y suite `tests/contract/notificationPregnancyComplication.test.ts`.

**Precondiciones de datos** (no son parte de la implementación):

- **El catálogo `pregnancyComplicationType` debe existir y estar cargado**, con al menos los ítems que la instalación use. Sin él, todo `complicationTypeItemId` cae en el 404 y el `001` nace inservible. Se carga por el `ESAVI-CATITEM-001` o por su importación masiva, no por código que este spec escriba. Es la misma precondición que `nonSevereNotification.service.ts:188-190` declara para `vaccinationSite`.
- **El maestro `diagnosticTerm` no necesita precarga.** La rama `LOCAL` acuña términos al vuelo, que es exactamente para lo que F15 lo escribió.

**Fuera de alcance (otros specs):**

- **Derivar `hasComplications` de estas filas.** F25 §6 dejó la decisión aquí y la respuesta es no: F27 **no escribe nunca** en `notificationPregnancy`. Razonado en §6.
- **Cualquier guarda de coherencia contra `hasComplications` del padre.** Cargar una complicación sobre un embarazo con `hasComplications: 'NO'` responde **201**, no 409.
- **Cualquier sincronización con `severeNotification`.** `hasPregnancyComplications` y `pregnancyComplicationsDescription` (`:753-754`) siguen siendo columnas de aquella tabla. La respuesta de F25 §6 a la pregunta de F13 fue «conviven», y F27 no la cambia.
- **Migrar `pregnancyComplicationsDescription` a esta tabla.** Es la evolución natural y es una migración de datos, no un CRUD.
- **`metadata`** (`:912`). No se acepta en el body, no entra en `candidates` y no se expone. La fila nace con `{}` por el `DEFAULT`. La columna queda reservada para el spec que le encuentre un uso, como `diagnosticTerm.metadata` esperó hasta que F15 le puso `autoCreated` y `reviewStatus`.
- **Reordenar complicaciones** — un `007` que mueva una de posición y desplace a sus hermanas. Es lo que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. Su propio spec, y el mismo que F16 §2 dejó abierto.
- **Aceptar `diagnosticTermId` directo del cliente.** Sería una segunda puerta para apuntar a un término, y con ella la pregunta de qué gana cuando llegan los dos. F16 §6 ya lo descartó.
- **Cablear los tres ítems del catálogo de tipos** como constantes o como `CHECK`. Cambian por instalación y por país; lo que se valida es la pertenencia al `catalogType`, no el contenido.
- **Cualquier filtro de listado** por `complicationTypeItemId`, por `diagnosticTermId` o por texto. Los dos listados devuelven todas las complicaciones de su embarazo, paginadas y ordenadas por `sortOrder`.
- **Un `006` por `notificationId` o por `caseId`.** Se entra por `pregnancyId`, que el `ESAVI-NOTIFPRG-006` devuelve; añadir un salto más solo para ahorrar una llamada duplicaría la cadena de guardas.
- **Reescribir el volcado con `sequelize.query` del `ESAVI-NOTIFPRG-005C`** ahora que esta tabla tiene modelo. F25 §6 lo anticipó y F24 sentó el precedente al no tocar la consulta cruda de F22.
- **Bloquear el `005A` del embarazo** cuando tenga complicaciones vivas. F25 §2 ya declaró que responde 200, y la visibilidad heredada de este spec resuelve la lectura.
- **Modificar `esaviapp.sql`** más allá del índice: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`.
- **Modificar `purgeEntityService`, `setEntityActiveStatusService` ni `diagnosticTermResolution.service.ts`.**
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la octava copia.
- **Incluir las complicaciones en la respuesta de `notificationPregnancy`.** El contrato de F25 no cambia.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII directa del paciente.
- Crear complicaciones automáticamente al dar de alta un embarazo.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notificationPregnancyComplication` — `esaviapp.sql:905-923`. Se le añade **un índice y nada más**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `complicationId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` (`:906`) |
| `pregnancyId` | `uuid` | no | `FK_notificationPregnancyComplication_pregnancy` → `notificationPregnancy`, `ON DELETE CASCADE` (`:907`, `:920`). **Sin `UNIQUE`** → uno a muchos |
| `diagnosticTermId` | `uuid` | sí | `FK_..._term` → `diagnosticTerm`, `ON DELETE RESTRICT` (`:908`, `:921`). **Derivada**: la devuelve la resolución, no el cliente |
| `complicationTypeItemId` | `uuid` | sí en el DDL | `FK_..._type` → `catalogItem`, `ON DELETE RESTRICT` (`:909`, `:922`). **La aplicación la exige en el `001`** |
| `complicationRawName` | `varchar(500)` | sí | Texto del notificador. **Derivada**: se guarda solo si difiere del nombre del maestro (`:910`) |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)` (`:911`). Lo asigna el trigger; la aplicación no lo envía |
| `metadata` | `jsonb` | no | `DEFAULT '{}'` (`:912`). **Fuera de alcance**: no se acepta, no se compara y no se expone |
| `notes` | `text` | sí | Solo `trim()` (`:913`) |

**La obligatoriedad de `complicationTypeItemId` la impone la aplicación, no el esquema**, y solo en el alta. Es una desviación deliberada entre DDL y contrato, del mismo tipo que F25 introdujo con `wasPregnantAtVaccination` — pero resuelta al revés en el `004`, y §6 dice por qué.

**Restricciones.** Tres claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla.** La única unicidad de base vive fuera, en el índice parcial `UQ_notificationPregnancyComplication_parent_sortOrder` sobre `("pregnancyId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1345-1346`). Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `B` de §1. **La guarda de duplicado de `(diagnosticTermId, complicationTypeItemId)` no está respaldada por ninguna restricción**: es regla de negocio del servicio.

**Las columnas transversales.** Están las seis: `isActive` (`:914`), `createdAt` (`:915`), `updatedAt` (`:916`), `deletedAt` (`:917`), `sysDetails` (`:918`) y `appDetails` (`:919`).

**Triggers. Dos.** `TRG_notificationPregnancyComplication_setSysDetails`, del bucle genérico (`:1280-1296`). Y `TRG_notificationPregnancyComplication_setSortOrder`, del bucle de orden (`:1305-1313`), que ejecuta `setSortOrderByParent('pregnancyId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo embarazo, bajo `pg_advisory_xact_lock`. **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `:1366-1369`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

**Hoja del grafo.** Ninguna tabla la referencia. Su `005C` no arrastra nada y no lleva volcado de cascada.

**El índice que se añade.** `IX_notificationPregnancyComplication_pregnancy` sobre `("pregnancyId")`, en la línea siguiente al `CREATE TABLE`, con la forma de `IX_notificationDiluent_vaccine` (`:884`). El parcial de `:1345-1346` no cubre el `002B`, que lee también filas con `deletedAt` sellado.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationPregnancyComplication.model.ts`. Clase `NotificationPregnancyComplication`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationPregnancyComplication'`.

`complicationId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `pregnancyId` va `DataTypes.UUID` con `allowNull: false`. `diagnosticTermId` y `complicationTypeItemId` van `DataTypes.UUID` con `allowNull: true` — **la obligatoriedad del tipo es del validador, no del modelo**, porque el DDL la declara anulable y el `004` no la exige.

`complicationRawName` va `DataTypes.STRING(500)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres. `notes` va `DataTypes.TEXT`. `metadata` se declara `DataTypes.JSONB` con `allowNull: false` para que el modelo refleje la tabla, y **ningún servicio la escribe ni la lee**.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, por la razón que F16 §3.2 documentó: un `defaultValue: 0` haría que el `INSERT` mandara el `0` que el trigger interpreta como «asígnamelo tú», y funcionaría por accidente.

> **Nota de implementación, heredada de F16.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere con `notNull Violation: NotificationPregnancyComplication.sortOrder cannot be null` y el trigger nunca se ejecuta. Lo que deja la columna fuera de la sentencia es la lista explícita: `NotificationPregnancyComplication.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y **sin** `sortOrder`, `complicationId` ni `metadata`.

Asociaciones, en `src/models/associations/notificationPregnancyComplication.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationPregnancyComplication.belongsTo(NotificationPregnancy, { as: 'pregnancy', foreignKey: 'pregnancyId' })`
- `NotificationPregnancy.hasMany(NotificationPregnancyComplication, { as: 'complications', foreignKey: 'pregnancyId' })`
- `NotificationPregnancyComplication.belongsTo(DiagnosticTerm, { as: 'diagnosticTerm', foreignKey: 'diagnosticTermId' })`
- `NotificationPregnancyComplication.belongsTo(CatalogItem, { as: 'complicationType', foreignKey: 'complicationTypeItemId' })`

El `hasMany` se declara porque lo necesita el volcado de la cascada de `ESAVI-NOTIFCN-005C`, que lo recorre como tercer salto. **No se incluye en ninguna respuesta de `notificationPregnancy`**: el contrato de F25 no cambia.

Alta en `src/models/index.ts` y en el barrel de asociaciones.

**Los tres `include` que el servicio compone:**

- **Visibilidad heredada**, en `002A`, `002B`, `003` y `004` — dos saltos: `{ model: NotificationPregnancy, as: 'pregnancy', attributes: ['pregnancyId', 'isActive'], include: [{ model: Notification, as: 'notification', attributes: ['notificationId', 'isActive'] }] }`. Es la cadena de F24.
- **Respuesta**, en `001`, `003`, `004` y las filas de los listados: `diagnosticTerm` con seis atributos y `complicationType` con cuatro.
- **Validación del tipo**, solo en `001` y `004`: `CatalogItem` con `include` de `CatalogType` filtrado por `code`, con `attributes: []` — el patrón exacto de `nonSevereNotification.service.ts:191-201`.

### 3.3 Tipos

Ruta: `src/types/notificationPregnancyComplication/notificationPregnancyComplication.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts`.

```ts
export interface CreateNotificationPregnancyComplicationInput {
    pregnancyId: string;
    complicationTypeItemId: string;
    complicationName: string;
    complicationCode?: string | null;
    source?: TermSource | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationPregnancyComplicationInput>`. **No se declara `UpdateNotificationPregnancyComplicationInput`** — prohibido por §4 de las convenciones.

**Tres claves de entrada no son columnas**, y es la consecuencia directa de la decisión de resolver contra el maestro:

- **`complicationName`** es el texto del notificador. No hay columna con ese nombre: alimenta `complicationRawName`, que solo lo guarda si difiere del maestro.
- **`complicationCode`** y **`source`** alimentan la resolución y no se guardan en ninguna parte de esta tabla. El código vive en `diagnosticTerm`, que es donde F15 lo puso.

**Tres columnas no están en la interfaz.** `diagnosticTermId` y `complicationRawName` son derivadas —aceptarlas abriría la segunda puerta que F16 §6 cerró—; `sortOrder` es inmutable y lo asigna la base, y que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande. `metadata` tampoco está, por §2.

`TermSource` se importa de donde F15 lo dejó, junto al ENUM `termSource` del DDL.

### 3.4 Superficie HTTP

Ruta base `/api/notification-pregnancy-complications`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-pregnancy-complications                        ESAVI-PREGCOMP-001   USER        (nuevo)
GET    /api/notification-pregnancy-complications/admin/pregnancy/:id    ESAVI-PREGCOMP-002B  ADMIN       (nuevo)
GET    /api/notification-pregnancy-complications/pregnancy/:id          ESAVI-PREGCOMP-002A  USER        (nuevo)
DELETE /api/notification-pregnancy-complications/purge/:id              ESAVI-PREGCOMP-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-pregnancy-complications/activate/:id           ESAVI-PREGCOMP-005B  SUPERADMIN  (nuevo)
GET    /api/notification-pregnancy-complications/:id                    ESAVI-PREGCOMP-003   USER        (nuevo)
PUT    /api/notification-pregnancy-complications/:id                    ESAVI-PREGCOMP-004   USER        (nuevo)
DELETE /api/notification-pregnancy-complications/:id                    ESAVI-PREGCOMP-005A  ADMIN       (nuevo)
```

**Orden de declaración.** Las literales van **antes** de `/:id`, o Express capturaría `admin`, `pregnancy`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las ocho están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationPregnancyComplication.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `NOTIFEVT`, `NOTIFVAC` y `NOTIFDIL`.

**Ocho operaciones y ninguna no canónica.** Es la segunda de la familia sin `006`, tras F24, y por tanto **no añade fila a la tabla de operaciones no canónicas de §6**.

**Roles.** `001`, `002A`, `003` y `004` en **USER**, siguiendo a su padre F25 y no a F24: la complicación se captura en el mismo formulario de embarazo que la fila padre, y partir el formulario entre dos roles rompería la captura por la mitad. `002B` y `005A` en **ADMIN**, `005B` y `005C` en **SUPERADMIN**, como manda §9 del canon.

Ocho filas nuevas en `ROUTE_RULES`: de **194** a **202**. El punto de partida lo dejó F25 en `tests/auth/roles.test.ts:415`.

### 3.5 Reglas de negocio por operación

**`ESAVI-PREGCOMP-001` — crear.** Todo dentro de **una transacción**, porque la resolución del término puede escribir en `diagnosticTerm`. En este orden:

1. El embarazo existe, está **activo**, y su notificación existe y está **activa** → 404 `PREGCOMP_001_PREGNANCY_NOT_FOUND`. Una sola consulta con el `include` de dos saltos de §3.2. Los tres motivos comparten código y mensaje: al notificador no le sirve distinguirlos.
2. **Tipo de complicación**, obligatorio: `CatalogItem.findOne` con `isActive: true` e `include` de `CatalogType` filtrado por `code: 'pregnancyComplicationType'` y `attributes: []`. Si no hay fila → 404 `PREGCOMP_001_COMPLICATION_TYPE_NOT_FOUND`. Tres causas —no existe, está inactivo, no pertenece al catálogo— y un solo error, como `assertVaccinationSiteIsValid`.
3. **Resolución del término**, en tres ramas:
   - Sin `complicationCode` → `diagnosticTermId: null` y `complicationRawName: normalizeText(data.complicationName)`.
   - Con `complicationCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService({ code, name: data.complicationName, operationCode: 'ESAVI-PREGCOMP-001' }, authUser, lang, transaction)`, que **devuelve el término o lo crea**.
   - Con `complicationCode` y `source` distinto de `'LOCAL'` → `DiagnosticTerm.findOne({ where: { source, code: toConstantCase(code.trim()) } })`, **sin crear nada**; si no existe → 404 `PREGCOMP_001_DIAGTERM_NOT_FOUND`. La consulta no filtra por `isActive`: un término retirado sigue siendo referenciable, por la misma razón que `diagnosticTermResolution.service.ts:37-38` no lo filtra.
4. Con término resuelto: `diagnosticTermId` = el suyo, y `complicationRawName` = el texto del notificador **solo si difiere** del nombre del maestro; si coincide, `null`. **No hay tercera columna que escribir**: el nombre canónico se lee del maestro por el `include`, que es la diferencia con F16.
5. **Guarda de duplicado**, solo si `diagnosticTermId` quedó con valor: `findOne` sobre el mismo `pregnancyId`, el mismo `diagnosticTermId`, el mismo `complicationTypeItemId` e `isActive: true`. Si hay fila → **409** `PREGCOMP_001_ALREADY_EXISTS`. **Va después de la resolución**, porque el término que se compara es el resuelto, no el código enviado. Con `diagnosticTermId: null` no se comprueba nada.
6. Normalización: `normalizeText` sobre `complicationName` y `notes`. **Ningún `toTitleCase` ni `toConstantCase`** — el `toConstantCase` del código lo aplica `resolveDiagnosticTermService`, no este servicio.
7. `create` con `fields: CREATE_FIELDS`, **sin `sortOrder`**, para que lo asigne el trigger.
8. Entrada de auditoría en `appDetails` con `method: 'ESAVI-PREGCOMP-001'`.

**`ESAVI-PREGCOMP-002A` — listar activas por embarazo.** El embarazo existe y está activo, y su notificación también, salvo `canViewInactive` → 404 `PREGCOMP_002A_PREGNANCY_NOT_FOUND`. `findAndCountAll` con `where: { pregnancyId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query.

**`ESAVI-PREGCOMP-002B` — listar todas por embarazo.** Igual, sin el `isActive: true`, con `paranoid: false` y `validateUserRole(ADMIN)`. La guarda del embarazo sigue aplicando: un ADMIN ve complicaciones inactivas, no complicaciones de un embarazo inactivo.

**`ESAVI-PREGCOMP-003` — obtener por ID.** Existencia → 404 `PREGCOMP_003_NOT_FOUND`. Incluye la cadena de dos saltos: si el embarazo **o** la notificación están inactivos y quien pide no cumple `canViewInactive`, **404**. Una complicación inactiva también es 404 salvo `canViewInactive`. Las tres condiciones se evalúan igual y ninguna tiene prioridad: basta que una falle.

**`ESAVI-PREGCOMP-004` — actualizar.** Dentro de **transacción**, por la misma razón que el `001`. Existencia → 404 `PREGCOMP_004_NOT_FOUND`, incluida la visibilidad heredada de dos saltos. `stored` sale de `complication.get({ plain: true })` con su `diagnosticTerm`, no de una consulta acotada.

**El nombre efectivo y cuándo se re-resuelve.** Sea `storedEffectiveName` = `stored.complicationRawName ?? stored.diagnosticTerm.name` — exactamente lo que el `GET` muestra como nombre de la complicación. Entonces:

```
incomingName = data.complicationName !== undefined
               && normalizeText(data.complicationName) !== storedEffectiveName
             ? normalizeText(data.complicationName)
             : storedEffectiveName
```

> **Nota de implementación — por qué la segunda condición.** Es la trampa que F16 §3.5 documentó, en su forma simplificada. Sin ella, un `PUT` que reenvía íntegra la respuesta de su `GET` reescribiría `complicationRawName` en toda fila con divergencia. Un `complicationName` que llega **igual al que el `GET` mostró** no es una reescritura, y por eso cae al fallback como una clave ausente. Aquí la fórmula es más corta que la de F16 porque hay **una sola** columna de texto: `storedEffectiveName` es inequívoco, mientras que allí había que elegir entre `esaviName` y `esaviRawName`.

La resolución se re-dispara **solo si `complicationCode` o `source` llegan con un valor distinto del que produjo el término guardado**, o si `incomingName` cambió. Un `PUT` que reenvía el código guardado **no consulta ni escribe** `diagnosticTerm`. Después, la guarda de duplicado del paso 5 sobre el par resultante, excluyendo la propia fila → 409 `PREGCOMP_004_ALREADY_EXISTS`. Diff con `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `pregnancyId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `metadata` | **no entra** | fuera de alcance |
| `diagnosticTermId` | **siempre**, del término resuelto o `null` | derivado |
| `complicationRawName` | **siempre**: `incomingName` si difiere del nombre del maestro, `null` si coincide, `incomingName` si no hay término | derivado |
| `complicationTypeItemId` | `data.complicationTypeItemId !== undefined ? data.complicationTypeItemId : undefined` | **no anulable**: un `null` explícito es 400 del validador. Si llega con valor, se revalida con el doble salto → 404 `PREGCOMP_004_COMPLICATION_TYPE_NOT_FOUND` |
| `notes` | `data.notes !== undefined ? normalizeText(data.notes) : undefined` | anulable; solo `trim()` |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**Dos campos derivados y dos comparados.** `complicationName` **no aparece en la tabla** porque no es columna: entra a través de los dos derivados. Y como el `001` lo exige, el `004` **tampoco lo deja vaciar**: un `null` explícito es 400 del validador, igual que `complicationTypeItemId`.

**`ESAVI-PREGCOMP-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'PREGCOMP_005A_NOT_FOUND'`, `alreadyInStateCode: 'PREGCOMP_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-PREGCOMP-005A'`. **No consulta nada más**: la tabla es hoja. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — correcto y deliberado, el hueco queda para la siguiente complicación.

**`ESAVI-PREGCOMP-005B` — reactivar.** Dentro de **transacción**, y **no** es delegación limpia. Es el hallazgo de F16, entero:

1. Se busca la fila con `paranoid: false` → 404 `PREGCOMP_005B_NOT_FOUND`.
2. Si existe y está inactiva, se busca colisión: otra fila del **mismo** embarazo, con el **mismo** `sortOrder`, con `deletedAt: null` y `complicationId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de ese embarazo —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que la escritura es libre. La complicación reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'PREGCOMP_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-PREGCOMP-005B'`.

Si la fila estaba **activa**, el paso 2 no encuentra colisión y el helper levanta su 409 con normalidad.

**El `005B` no revalida nada más**: ni el par de duplicado, ni el tipo de complicación, ni el estado del embarazo o de la notificación. Reactivar es deshacer una desactivación, que es el criterio de F25 §6. La consecuencia —reactivar puede resucitar un par `(diagnosticTermId, complicationTypeItemId)` que ya existe vivo— está asumida y razonada en §6.

**`ESAVI-PREGCOMP-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'PREGCOMP_005C_NOT_FOUND'` y `stillActiveCode: 'PREGCOMP_005C_STILL_ACTIVE'`. La guarda es la canónica de §6 sobre la propia fila: debe estar en `isActive: false` → si no, **409**. **Sin consulta previa y sin volcado de cascada**: la tabla es hoja del grafo, a diferencia del `005C` de F25. Sin entrada en `appDetails` —la fila se destruye en la misma transacción—, que es la ausencia que `CONVENTIONS.md` §6 declara legítima.

**Escrituras que no son diferenciales, declaradas una a una:**

- **El `001`** — es un `create`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: esta complicación vuelve a estar viva y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005A` y el `005B`** — escrituras de estado, delegadas en `setEntityActiveStatusService`.
- **El `005C`** — destruye la fila.
- **La acuñación de un `diagnosticTerm` en la rama `LOCAL`** — la hace `resolveDiagnosticTermService`, con su propia auditoría, y este spec no la modifica. **Se dispara por el cambio de valor**, nunca por la presencia de la clave: un `complicationCode` reenviado igual no consulta ni escribe el maestro.

**Este spec no escribe en ninguna otra tabla.** En particular, **no toca `notificationPregnancy`**: ni `hasComplications`, ni `updatedAt`, ni `appDetails`. Lo único que toca fuera es una línea de log en la cascada de purga de la cabecera.

### 3.6 Claves i18n nuevas

Bajo `notificationPregnancyComplication`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationPregnancyComplication.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente |
| `notificationPregnancyComplication.idRequired` | 400 del validador de `:id` |
| `notificationPregnancyComplication.pregnancyNotFound` | 404 cuando el embarazo no existe, está inactivo, o su notificación lo está |
| `notificationPregnancyComplication.complicationTypeNotFound` | 404 cuando el `catalogItem` no existe, está inactivo o no pertenece a `pregnancyComplicationType` |
| `notificationPregnancyComplication.diagnosticTermNotFound` | 404 con `source` externo y par `(source, code)` inexistente |
| `notificationPregnancyComplication.alreadyExists` | 409 cuando el embarazo ya tiene una complicación **activa** con el mismo término y el mismo tipo |
| `notificationPregnancyComplication.nameRequired` | 400 del validador cuando `complicationName` no llega en el `001`, o llega como `null` en el `004` |
| `notificationPregnancyComplication.complicationTypeRequired` | 400 del validador cuando `complicationTypeItemId` no llega en el `001`, o llega como `null` en el `004` |
| `notificationPregnancyComplication.stillActive` | 409 al purgar una complicación que no fue retirada antes |
| `.createdSuccess` / `.createdFailed` | 201 y 500 del `001` |
| `.getSuccess` / `.getFailed` | 200 y 500 de `002A`, `002B` y `003` |
| `.updatedSuccess` / `.updatedFailed` | 200 y 500 del `004` |
| `.deletedSuccess` / `.deletedFailed` | 200 y 500 del `005A` |
| `.activatedSuccess` / `.activatedFailed` | 200 y 500 del `005B` |
| `.alreadyActive` / `.alreadyInactive` | 409 de `005B` y `005A` |
| `.purgeSuccess` / `.purgeFailed` | 200 y 500 del `005C` |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `001`, `003` y `004`:

```
{ ok, message, data: {
    complicationId, pregnancyId, diagnosticTermId, complicationTypeItemId,
    complicationRawName, sortOrder, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    diagnosticTerm: { diagnosticTermId, source, code, name, termGroup, isActive } | null,
    complicationType: { catalogItemId, code, name, isActive }
} }
```

`diagnosticTerm` se incluye siempre que exista la FK, con esos seis campos y **sin `metadata`**: lleva los marcadores internos de la resolución implícita —`autoCreated`, `reviewStatus`—, que son gobernanza del catálogo y no dato de la notificación. Es la decisión de F16 §3.7, literal.

`complicationType` va acotado a cuatro campos y **siempre existe**, porque la FK es obligatoria en el alta y el `004` no la deja vaciar.

**El nombre que el cliente muestra es `complicationRawName ?? diagnosticTerm.name`.** No hay un tercer campo que lo resuelva, y ésa es la simplificación que el DDL impone. Cuando `complicationRawName` es `null`, el notificador escribió exactamente lo que dice el maestro.

**`metadata` no viaja en ninguna respuesta.** Está fuera de alcance por §2.

En `002A` y `002B`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente.

**Nada del embarazo ni de la notificación viaja en la respuesta.** `pregnancy` se consulta solo para la visibilidad heredada, con `attributes` acotados, y se descarta al construir el payload. Quien necesite el embarazo entra por `ESAVI-NOTIFPRG-003`.

`sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura.** Añadir la fila `notificationPregnancyComplication | PREGCOMP` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en el orden alfabético que la tabla mantiene. **La tabla de operaciones no canónicas no se toca:** F27 no tiene `006`. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla de abreviaturas contiene la fila nueva; `PREGCOMP` no aparece dos veces y no colisiona con `NOTIFPRG`, `NOTIFCN`, `NOTIFDIL`, `NOTIFEVT`, `NOTIFMED`, `NOTIFVAC`, `NOTIFIER` ni `DIAGTERM`; `git diff references/CONVENTIONS.md` muestra **una sola** fila añadida y ningún cambio en la tabla de operaciones no canónicas.

2. **El índice en `esaviapp.sql`.** `CREATE INDEX IF NOT EXISTS "IX_notificationPregnancyComplication_pregnancy" ON "notificationPregnancyComplication" ("pregnancyId");`, inmediatamente después del `CREATE TABLE` de `:923`, con la forma de `IX_notificationDiluent_vaccine` (`:884`).
   *Verificación:* `git diff esaviapp.sql` muestra **exactamente una línea añadida**; ejecutar el DDL completo sobre una base limpia no produce errores; el trigger de `sortOrder`, el índice único parcial y las tres FKs quedan intactos.

3. **Modelo y asociaciones.** `src/models/notificationPregnancyComplication.model.ts` según §3.2, y `src/models/associations/notificationPregnancyComplication.associations.ts` con el `belongsTo` al embarazo, el `hasMany` inverso y los dos `belongsTo` a los maestros. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` en 0; un `NotificationPregnancyComplication.findAll({ include: ['pregnancy', 'diagnosticTerm', 'complicationType'] })` desde el REPL devuelve filas sin error de asociación; un `include` anidado `pregnancy → notification` también; `grep -n "defaultValue" src/models/notificationPregnancyComplication.model.ts` no devuelve nada para `sortOrder`; `git diff --stat src/controllers/notificationPregnancy.controller.ts` no muestra cambios — el contrato de F25 no gana las complicaciones en su respuesta.

4. **Tipos.** `src/types/notificationPregnancyComplication/notificationPregnancyComplication.types.ts` con `CreateNotificationPregnancyComplicationInput`, más su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateNotificationPregnancyComplicationInput" src/` no devuelve resultados; `grep -n "diagnosticTermId\|complicationRawName\|sortOrder\|metadata" src/types/notificationPregnancyComplication/notificationPregnancyComplication.types.ts` no devuelve resultados — las cuatro columnas que el cliente no envía no existen en el tipo.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0.

6. **Validadores.** `src/validators/notificationPregnancyComplication.validator.ts` con el validador de creación, el de actualización, el de `:id` y el del `:pregnancyId` de ruta. En creación: `pregnancyId` y `complicationTypeItemId` obligatorios y `.isUUID()`; `complicationName` obligatorio, cadena, máximo **500**; `complicationCode` opcional; `source` acotado al ENUM `termSource`; `notes` como cadena. En actualización: los cuatro opcionales, pero `complicationTypeItemId` y `complicationName` **no anulables** —un `null` explícito es 400—, y `notes` sí anulable. **`sortOrder`, `diagnosticTermId`, `complicationRawName` y `metadata` no se declaran en ningún validador.** Alta en el barrel de `validators/`.
   *Verificación:* un `POST` sin `complicationName` devuelve **400** y no llega al servicio; sin `complicationTypeItemId` también; un `complicationName` de 501 caracteres devuelve 400 del validador y no un error de Postgres; un `source: 'MEDRA'` mal escrito devuelve 400; un body con `sortOrder: 5` **no** produce 400 y el campo se ignora; un `PUT` con `complicationTypeItemId: null` devuelve **400**, y con `notes: null` **no**.

7. **`ESAVI-PREGCOMP-001` — crear, sin la resolución del término.** `createNotificationPregnancyComplicationService` con los pasos 1, 2, 6, 7 y 8 de §3.5: guarda del embarazo con su `include` de dos saltos, doble salto del tipo de complicación, `normalizeText`, `create` con `CREATE_FIELDS` y auditoría. La rama sin `complicationCode` del paso 3 —`diagnosticTermId: null`, `complicationRawName` con el texto— entra aquí. Controlador y ruta `POST /`.
   *Verificación:* un alta con `pregnancyId`, `complicationTypeItemId` y `complicationName` devuelve 201 con `diagnosticTermId: null` y `complicationRawName` con el texto enviado; sobre un embarazo inactivo devuelve 404, y sobre uno cuya **notificación** está inactiva también, con el mismo código; con un `complicationTypeItemId` de otro catálogo devuelve **404** `PREGCOMP_001_COMPLICATION_TYPE_NOT_FOUND`, y con uno inactivo lo mismo; tres altas seguidas sobre el mismo embarazo reciben `sortOrder` 1, 2 y 3 **sin que el servicio lo envíe**; `grep -n "CREATE_FIELDS" src/services/notificationPregnancyComplication.service.ts` devuelve la lista, y no contiene `sortOrder` ni `metadata`.

8. **La resolución del término y la guarda de duplicado.** Los pasos 3, 4 y 5 de §3.5 dentro del mismo `001`, en transacción: las dos ramas con código, el cálculo de `complicationRawName` contra el nombre del maestro, y el 409 sobre el par `(diagnosticTermId, complicationTypeItemId)` entre las filas **activas** del embarazo.
   *Verificación:* crear con `complicationCode: '  anomalia cardiaca  '` inexistente y sin `source` deja en `diagnosticTerm` una fila con `source: 'LOCAL'`, `code: 'ANOMALIA_CARDIACA'` y `metadata.autoCreated: true`; crear con `source: 'MEDDRA'` y un código inexistente devuelve **404** y **no** crea fila en `diagnosticTerm`; crear con un `complicationName` distinto del nombre del maestro deja `complicationRawName` con el texto del notificador, y con uno idéntico lo deja en `null`; repetir el alta con el mismo código y el mismo tipo devuelve **409** `PREGCOMP_001_ALREADY_EXISTS`; con el mismo código y **otro tipo** devuelve **201**; **desactivar la primera y repetir el alta devuelve 201**, no 409 — la guarda mira solo activas, y es lo contrario del `001` de F25; dos altas seguidas **sin** `complicationCode` y con el mismo tipo devuelven **201** las dos; `git diff --stat src/services/common/diagnosticTermResolution.service.ts` no muestra cambios.

9. **`ESAVI-PREGCOMP-002A` y `002B` — los dos listados.** Servicios, controladores y rutas `GET /pregnancy/:id` y `GET /admin/pregnancy/:id`, declaradas **antes** de `/:id` y con `admin` antes que la pública. `findAndCountAll` con `order` por `sortOrder` y paginación.
   *Verificación:* el `002A` devuelve solo activas y el `002B` todas, incluidas las de `deletedAt` sellado; las filas llegan ordenadas por `sortOrder` ascendente; `data` es `{ count, rows }` en los dos; un USER recibe 403 en el `002B`; sobre un embarazo inactivo los dos devuelven 404 para USER y ADMIN, y 200 para SUPERADMIN; **el `002B` sobre un embarazo activo con complicaciones borradas usa el índice nuevo** — `EXPLAIN` sobre la consulta muestra `IX_notificationPregnancyComplication_pregnancy` y no un `Seq Scan`; `grep -n "req.query" src/controllers/notificationPregnancyComplication.controller.ts` solo devuelve `limit` y `offset`.

10. **`ESAVI-PREGCOMP-003` — obtener por ID.** Servicio con el `include` de dos saltos, los dos `include` de respuesta, y las tres condiciones sin prioridad entre ellas. Ruta `GET /:id` declarada **después** de todas las literales.
    *Verificación:* `GET /api/notification-pregnancy-complications/activate/algo` responde 400 de UUID y no 404 de complicación; una complicación cuyo embarazo está inactivo devuelve 404 para USER y ADMIN y 200 para SUPERADMIN; una cuya **notificación** está inactiva, lo mismo; una complicación inactiva con toda la cadena activa, lo mismo; la respuesta lleva `diagnosticTerm` **sin `metadata`** y `complicationType` con cuatro campos; `grep -n "metadata" src/controllers/notificationPregnancyComplication.controller.ts` no devuelve resultados.

11. **`ESAVI-PREGCOMP-004` — actualizar.** `buildDifferentialUpdate` con la tabla de `candidates` de §3.5, la fórmula de `incomingName` con su segunda condición, la re-resolución disparada por cambio de valor, la revalidación del tipo cuando llega, y la guarda de duplicado excluyendo la propia fila. Ruta `PUT /:id`.
    *Verificación:* un `PUT` que reenvía íntegra la respuesta del `GET` responde 200 **sin escribir** y **sin consultar** `diagnosticTerm`, incluso sobre una fila con `complicationRawName` distinto del maestro — es el criterio que la nota de implementación protege; cambiar solo `notes` no consulta ni `diagnosticTerm` ni `catalogItem`; cambiar `complicationCode` a un código nuevo acuña el término y actualiza los **dos** derivados en **una sola** entrada de `appDetails`; enviar un `pregnancyId` distinto no lo modifica y devuelve 200; un `PUT` con `sortOrder: 99` devuelve 200 y no lo cambia; un `PUT` que deja el par `(término, tipo)` igual al de otra complicación **activa** del mismo embarazo devuelve **409**.

12. **`ESAVI-PREGCOMP-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, ruta `DELETE /:id` con `validateUserRole(ADMIN)`.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409; un USER recibe 403; tras desactivar, un alta nueva sobre el mismo embarazo **reutiliza el `sortOrder` liberado**.

13. **`ESAVI-PREGCOMP-005B` — reactivar con reasignación de `sortOrder`.** Los cuatro pasos de §3.5 en transacción. Ruta `PATCH /activate/:id`.
    *Verificación:* el escenario que rompe la delegación limpia —crear A y B, desactivar A, crear C (que toma el `sortOrder` liberado de A), reactivar A— devuelve **200** y A reaparece con un `sortOrder` nuevo al final, **sin** error de índice único; reactivar cuando no hay colisión no toca `sortOrder`; reactivar una ya activa devuelve 409; reactivar una cuyo embarazo se desactivó entretanto responde **200** — el `005B` no revalida la cadena; reactivar una cuyo par `(término, tipo)` ya existe vivo responde **200**, no 409, y el embarazo queda con el par duplicado: es la consecuencia asumida de §6, y va en la suite como escenario explícito para que nadie la corrija por accidente.

14. **`ESAVI-PREGCOMP-005C` — borrado físico.** `purgeEntityService` sin modificarlo, ruta `DELETE /purge/:id` declarada antes de `/:id`. **Sin consulta previa ni volcado.**
    *Verificación:* purgar una complicación activa devuelve 409; purgar una desactivada devuelve 200 y la fila desaparece; el término y el ítem de catálogo que citaba **siguen existiendo**; `grep -n "sequelize.query" src/services/notificationPregnancyComplication.service.ts` no devuelve resultados — la tabla es hoja y no hay cascada que volcar; `git diff --stat src/services/common/entityPurge.service.ts` no muestra cambios.

15. **Sexta línea en la cascada de `ESAVI-NOTIFCN-005C`.** En `src/services/notification.service.ts`, junto a las cinco que F16, F21, F22, F24 y F25 dejaron, y antes del `destroy` de la notificación, **una sola línea** `warn` con el conteo y la lista de `complicationId` que la cascada arrastra en el **tercer salto** `notification → pregnancy → complications`. Se resuelve con el `hasOne` de F25 más el `hasMany` del paso 3, sin SQL crudo. Es el único punto de este spec que toca un servicio ajeno.
    *Verificación:* purgar una notificación con embarazo y dos complicaciones deja **una** línea con los dos `complicationId`, y siguen apareciendo las cinco de eventos, medicamentos, vacunas, diluyentes y embarazo; purgar una notificación con embarazo **sin** complicaciones no deja esa línea; purgar una notificación sin embarazo tampoco; `git diff --stat src/services/notificationPregnancy.service.ts` **no muestra cambios** — el volcado con `sequelize.query` del `ESAVI-NOTIFPRG-005C` se queda como F25 lo escribió.

16. **Cubrir las ocho rutas en `tests/auth/roles.test.ts`.** Ocho filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **194 a 202** en la aserción de longitud (`tests/auth/roles.test.ts:415`).
    *Verificación:* `npm test -- roles` en 0.

17. **Suite `tests/contract/notificationPregnancyComplication.test.ts`.** Recorrido completo con `supertest`: crear → listar activas → listar todas → obtener por ID → actualizar → desactivar → reactivar → purgar. Más los caminos de error: 404 de embarazo inactivo y de notificación inactiva, 404 de tipo de otro catálogo, 404 de término externo inexistente, 400 de `complicationName` ausente y de `complicationTypeItemId` ausente, 400 de `null` explícito en los dos, 409 de duplicado en `001` y en `004`, 201 del duplicado sobre fila **inactiva**, 409 de purga sobre fila activa, el escenario de colisión de `sortOrder` del paso 13, el de duplicado por reactivación, y los cinco casos de update diferencial de §5.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

- [ ] Las ocho rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones — cuatro en el `005C`, que no escribe auditoría.
- [ ] `grep -rn "ESAVI-PREGCOMP-006" src/` no devuelve resultados — esta entidad no tiene operación no canónica.
- [ ] `references/CONVENTIONS.md` §6 contiene la fila `notificationPregnancyComplication | PREGCOMP`, y su tabla de operaciones no canónicas **no gana ninguna fila**.
- [ ] `ROUTE_RULES` tiene 202 filas y la aserción de longitud de `tests/auth/roles.test.ts` espera ese número.

**DDL:**

- [ ] `git diff esaviapp.sql` muestra **exactamente una línea añadida**: el `IX_notificationPregnancyComplication_pregnancy`.
- [ ] El trigger de `sortOrder` (`:1310`), el índice único parcial (`:1345-1346`), el `CHECK` y las tres FKs quedan sin tocar.
- [ ] `EXPLAIN` sobre la consulta del `002B` muestra el índice nuevo y no un `Seq Scan`.

**`sortOrder`, el trigger y el `005B`:**

- [ ] Tres altas seguidas sobre el mismo embarazo reciben `sortOrder` 1, 2 y 3 **sin que el servicio lo envíe**.
- [ ] `grep -n "sortOrder" src/types/notificationPregnancyComplication/notificationPregnancyComplication.types.ts src/validators/notificationPregnancyComplication.validator.ts` no devuelve resultados.
- [ ] `CREATE_FIELDS` existe en el servicio y **no** contiene `sortOrder`, `complicationId` ni `metadata`.
- [ ] Un `POST` con `sortOrder: 5` en el body responde 201 y el campo se ignora; un `PUT` con `sortOrder: 99` responde 200 y no lo cambia.
- [ ] **El escenario de colisión:** crear A y B, desactivar A, crear C —que toma el número liberado—, reactivar A responde **200**, A reaparece con un `sortOrder` nuevo al final, y **no** se produce error de índice único.
- [ ] Reactivar sin colisión **no** toca `sortOrder`.
- [ ] La reasignación ocurre **antes** de limpiar `deletedAt`, dentro de la misma transacción.
- [ ] `git diff --stat src/services/common/entityActivation.service.ts src/services/common/entityPurge.service.ts` no muestra cambios.

**Resolución contra el maestro:**

- [ ] Crear con `complicationCode: "  anomalia cardiaca  "` inexistente y sin `source` deja en `diagnosticTerm` una fila con `source: 'LOCAL'`, `code: 'ANOMALIA_CARDIACA'` y `metadata.autoCreated: true`.
- [ ] Crear con `source: 'MEDDRA'` y un `complicationCode` inexistente responde **404** y **no** crea fila en `diagnosticTerm`.
- [ ] Crear con `complicationName: "problema del corazón"` sobre un término cuyo nombre guardado es `Anomalía cardíaca` deja `complicationRawName: 'problema del corazón'` y `diagnosticTermId` con el suyo.
- [ ] Crear con un `complicationName` idéntico al del maestro deja `complicationRawName: null`.
- [ ] Crear **sin** `complicationCode` deja `diagnosticTermId: null` y `complicationRawName` con el texto enviado.
- [ ] `git diff --stat src/services/common/diagnosticTermResolution.service.ts` no muestra cambios.
- [ ] La respuesta lleva `diagnosticTerm` con seis campos y **sin `metadata`**: `grep -n "metadata" src/controllers/notificationPregnancyComplication.controller.ts` no devuelve resultados.

**Tipo de complicación:**

- [ ] Un `POST` sin `complicationTypeItemId` responde **400** del validador y no llega al servicio.
- [ ] Un `complicationTypeItemId` que apunta a un `catalogItem` de **otro** `catalogType` responde **404** `PREGCOMP_001_COMPLICATION_TYPE_NOT_FOUND`; uno inactivo, lo mismo; uno inexistente, lo mismo. Tres escenarios, un solo código.
- [ ] Un `PUT` con `complicationTypeItemId: null` responde **400**, no 200.
- [ ] Un `PUT` que cambia el tipo a uno válido responde 200 y lo escribe; a uno de otro catálogo, **404**.
- [ ] Los tres nombres del catálogo no aparecen en `src/`: `grep -rn "Anomalías congénitas\|congenital" src/services/ src/constants/` no devuelve resultados. El spec valida la pertenencia al `catalogType`, no el contenido.
- [ ] El `code` del catálogo no aparece como cadena suelta en el servicio: viene de una constante declarada arriba, como `VACCINATION_SITE_CATALOG_CODE` en `nonSevereNotification.service.ts:15`.

**Guarda de duplicado:**

- [ ] Dos altas con el **mismo término** y el **mismo tipo** sobre el mismo embarazo: la segunda responde **409** `PREGCOMP_001_ALREADY_EXISTS`.
- [ ] Con el mismo término y **otro tipo**, responde **201**.
- [ ] Con el mismo tipo y **otro término**, responde **201**.
- [ ] Desactivar la primera y repetir el alta responde **201**, no 409. La guarda mira solo filas activas, y es deliberadamente lo contrario del `001` de F25.
- [ ] Dos altas **sin** `complicationCode` y con el mismo tipo responden **201** las dos: sin término no hay guarda.
- [ ] Un `PUT` que deja el par igual al de otra complicación **activa** del mismo embarazo responde **409**; el mismo par sobre la **propia** fila responde 200 sin escribir.
- [ ] **Reactivar una complicación cuyo par ya existe vivo responde 200**, y el embarazo queda con el par duplicado. Es la consecuencia asumida de §6 y está montada en la suite como escenario explícito.
- [ ] La suite completa no produce ningún error `23505` de Postgres.

**Visibilidad heredada en cadena y listados:**

- [ ] Una complicación cuyo **embarazo** está inactivo responde 404 en `002A`, `002B`, `003` y `004` para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] Una complicación cuya **notificación** está inactiva responde lo mismo, aunque el embarazo esté activo.
- [ ] Una complicación inactiva con toda la cadena activa responde lo mismo.
- [ ] Crear sobre un embarazo inactivo, o cuya notificación lo está, responde 404.
- [ ] El `002A` devuelve solo activas y el `002B` todas, incluidas las de `deletedAt` sellado; los dos ordenados por `sortOrder` ascendente.
- [ ] `data` es `{ count, rows }` en los dos listados.
- [ ] Un USER recibe 403 en el `002B`.
- [ ] No hay ningún filtro por query más allá de `limit` y `offset`.
- [ ] `GET /api/notification-pregnancy-complications/purge/algo` responde 400 de UUID, no 404 de complicación.

**El padre no se toca:**

- [ ] `git diff --stat src/services/notificationPregnancy.service.ts` **no muestra cambios**: ni el `hasComplications`, ni el volcado con `sequelize.query` del `005C`.
- [ ] Crear una complicación sobre un embarazo con `hasComplications: 'NO'` responde **201**, y el campo del padre **no se modifica**: su `updatedAt`, su `sysDetails.version` y su `appDetails` quedan idénticos.
- [ ] Desactivar la última complicación viva **tampoco** toca el padre.
- [ ] `git diff --stat src/services/severeNotification.service.ts` no muestra cambios.
- [ ] La respuesta de `ESAVI-NOTIFPRG-003` **no** gana las complicaciones: `git diff --stat src/controllers/notificationPregnancy.controller.ts` no muestra cambios.

**La cascada de la cabecera:**

- [ ] Purgar una notificación con embarazo y dos complicaciones deja **una** línea `warn` con los dos `complicationId`, y siguen apareciendo las cinco de eventos, medicamentos, vacunas, diluyentes y embarazo.
- [ ] Purgar una notificación con embarazo **sin** complicaciones no deja esa línea.
- [ ] Las filas hijas desaparecen de la base por la cascada de `:920`.
- [ ] `grep -n "sequelize.query" src/services/notificationPregnancyComplication.service.ts` no devuelve resultados: la tabla es hoja y su `005C` no vuelca nada.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve. **Se verifica también sobre una fila con `complicationRawName` distinto del nombre del maestro** — es el caso que la nota de implementación de §3.5 protege, y el que F16 descubrió rompiéndose.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1 — incluido el caso de cambiar `complicationCode`, que mueve los **dos** derivados en **una sola** entrada.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/notificationPregnancyComplication.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

Sobre el último: la primera mitad se cumple en dos formas —un `PUT` sobre una complicación cuyo **embarazo** o cuya **notificación** están inactivos responde 404 aunque el body sea idéntico al guardado, y un `PUT` con un `complicationTypeItemId` inactivo responde 404 por la misma razón—. La segunda mitad se cumple en su forma propia: esta tabla no tiene `code`, pero **sí tiene una unicidad de negocio que el `004` puede violar**, y un `PUT` que deja el par `(término, tipo)` igual al de otra complicación activa responde **409** aunque no cambie ningún otro campo. Es la primera vez en la familia que las dos mitades del criterio se cumplen de verdad.

- [ ] Un `PUT` que reenvía el `complicationCode` guardado **no consulta ni escribe** `diagnosticTerm`.
- [ ] Un `PUT` que solo cambia `notes` deja `diagnosticTermId`, `complicationRawName` y `complicationTypeItemId` idénticos, y no consulta ni `diagnosticTerm` ni `catalogItem`.
- [ ] Un `PUT` con `notes: "  Detectada en ecografía  "` sobre unas `Detectada en ecografía` guardadas responde **200 sin escribir** — el `trim()` corre antes de comparar.
- [ ] Un `PUT` con `notes: ""` sobre unas `notes` guardadas las deja en `null`.
- [ ] Un `PUT` con `pregnancyId` distinto responde **200**, no lo modifica y no cuenta como cambio.
- [ ] `metadata` no aparece en ningún `candidates`, en ninguna respuesta y en ningún validador: `grep -rn "metadata" src/services/notificationPregnancyComplication.service.ts src/validators/notificationPregnancyComplication.validator.ts` no devuelve resultados.

**Cierre:**

- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Superficie y numeración**

- **Sí:** `PREGCOMP`, ocho letras. F25 §6 la reservó explícitamente para esta tabla cuando eligió `NOTIFPRG` para el padre. Se descartó `NOTIFPRGCOMP` por pasar de ocho letras, y `COMPLIC` por no decir de qué dominio es la complicación — `investigationPregnancyCondition` (`:1065`) competiría por el mismo espacio.
- **Sí:** ocho operaciones con listado dual y **sin `006`**. Se entra por `pregnancyId`, que el `ESAVI-NOTIFPRG-006` ya devuelve al abrir el formulario de embarazo. Es el cierre de F24, aplicado por una razón distinta: allí el `006` no tenía sentido porque la cadena tenía dos saltos N; aquí sí lo tendría —el primer salto es uno a uno— y aun así no se añade, porque el cliente que llega a las complicaciones ya pasó por el embarazo.
- **No:** un `006` por `notificationId` o por `caseId`. Ahorraría una llamada al cliente que solo tiene la cabecera, a cambio de una tercera cadena de guardas y una fila en la tabla de operaciones no canónicas. La llamada que ahorra es la que ese cliente tiene que hacer de todas formas para pintar el embarazo.
- **Sí:** ruta base `/api/notification-pregnancy-complications`, en plural con guiones y con el nombre completo de la tabla. El prefijo `notification-` la distingue de `investigationPregnancyCondition`, que es la tabla de embarazo de la rama de investigación.
- **Sí:** `001`, `002A`, `003` y `004` en **USER**, siguiendo a F25 y no a F24. Es la divergencia declarada de la familia: F24 puso sus escrituras en ADMIN, F25 las puso en USER. Manda el padre, porque las complicaciones se capturan en el mismo formulario que el embarazo y en la misma sesión; exigir un ADMIN a mitad del formulario lo partiría en dos.

**La resolución contra el maestro, con una columna menos**

- **Sí:** la mecánica de F16 entera, incluidas las dos ramas de `source`. Las complicaciones del embarazo son el dominio donde un código MedDRA ya cargado tiene más sentido, y divergir del precedente obligaría a explicar por qué el mismo maestro se resuelve distinto según quién lo llame.
- **Sí:** `complicationRawName` guarda el texto del notificador **solo si difiere** del nombre del maestro. Es el contrato que `diagnosticTermResolution.service.ts:36` dejó escrito —«la divergencia se preserva en la columna `*Raw*` de la tabla llamante»— y ésta es la segunda tabla que lo cumple.
- **Sí:** **dos derivados y no tres**, porque el DDL da una sola columna de texto. No se añaden `complicationName` ni `complicationCode` al esquema para imitar a `notificationEvent`. El nombre canónico y el código viven en `diagnosticTerm` y se leen del `include`: denormalizarlos aquí crearía dos copias que envejecen cuando alguien corrige el maestro, que es exactamente el problema que `esaviName` tiene hoy en F16 y que nadie ha resuelto.
- **Sí:** la fórmula de `incomingName` con su segunda condición, heredada de la nota de implementación de F16. Sin ella, un `PUT` que no cambia nada destruye lo que escribió el notificador en toda fila con divergencia. Aquí la fórmula es más corta porque `storedEffectiveName` es inequívoco: hay una sola columna de texto y el `GET` muestra exactamente eso.
- **No:** aceptar `diagnosticTermId` directo del cliente. Sería una segunda puerta para apuntar a un término, y con ella la pregunta de qué gana cuando llegan los dos. F16 §6 lo descartó y no hay razón nueva.
- **No:** exigir `complicationCode`. Una complicación que el notificador describe sin poder codificarla es un registro legítimo, y perderla por no tener código sería perder el dato clínico entero. Sin código, `diagnosticTermId` queda `null` y `complicationRawName` guarda el texto: la fila informa igual.

**El tipo de complicación**

- **Sí:** obligatorio en el `001`, aunque el DDL lo declare anulable. Una complicación sin tipificar no se agrega ni se cuenta, y la tipificación en tres grupos —anomalías congénitas, complicaciones fetales o neonatales, complicaciones del parto— es lo que hace utilizable la sección de embarazo.
- **Sí:** validar la **pertenencia al `catalogType`** y no el contenido. Los tres ítems son datos de una instalación: pueden crecer, y en otro país pueden ser otros. Cablearlos como constantes o como `CHECK` condenaría el despliegue al primer catálogo que se modeló, que es exactamente el error que `assertVaccinationGeoLocationIsValid` documenta en `nonSevereNotification.service.ts:212-216` sobre los nombres de nivel geográfico.
- **Sí:** el doble salto contra `catalogType.code`, con la constante `'pregnancyComplicationType'` declarada en el servicio. Es el patrón de `assertVaccinationSiteIsValid` (`:191-201`), literal. Se asume su misma debilidad —el `code` de un `catalogType` se acuña con `toCamelCase` desde su `name` y depende del idioma de carga—, y se asume porque el repositorio ya la aceptó dos veces y estrenar aquí un tercer mecanismo sería peor que heredar el existente. La salida limpia sería una clave de `systemConfig` como la que F25 usó para el sexo; no se hace porque F25 §6 razonó ese camino para un **`catalogItemId`** que cambia por instalación, y aquí lo que se ancla es un `catalogType`, que es estructura y no dato.
- **No:** anulable en el `004`. Es la asimetría contraria a la que F25 eligió para `wasPregnantAtVaccination`, y la razón es que allí se vaciaba una **respuesta** —retirar una respuesta dada por error es una corrección legítima— y aquí se vaciaría una **clasificación obligatoria**, dejando en la base filas que el `001` habría rechazado. Corregir una tipificación errónea se hace enviando la correcta, no borrándola.

**La guarda de duplicado**

- **Sí:** 409 sobre el par `(diagnosticTermId, complicationTypeItemId)`. Registrar dos veces la misma complicación con la misma tipificación no aporta información y sí distorsiona cualquier recuento.
- **Sí:** **solo si `diagnosticTermId` tiene valor.** Dos complicaciones de texto libre del mismo tipo son registros distintos por definición: no hay identidad que comparar, y comparar `null` con `null` convertiría el segundo texto libre en 409 sin razón.
- **Sí:** **mira solo filas activas.** Es deliberadamente lo contrario del `001` de F25, y la diferencia está en qué respalda cada guarda. Allí había una `UNIQUE` real (`:902`) que no se condiciona a `deletedAt`, y decir 201 habría sido mentirle al cliente sobre lo que iba a pasar en la base. Aquí no hay ninguna restricción: la guarda es invención del servicio, y una regla inventada no debe ser más rígida que las que la base impone. Desactivar una complicación y volver a cargarla es el camino natural de corrección, y bloquearlo obligaría a un `005B` de SUPERADMIN para deshacer un error de captura de un USER.
- **No:** añadir un índice único parcial que respalde la guarda. Sería cambio de DDL sobre una regla que aún no se ha usado en producción, y dejaría el `005B` sin salida: reactivar chocaría contra el índice en vez de responder algo.
- **Sí:** el `005B` **no** revalida el par, y puede resucitar un duplicado. Se elige por coherencia con F25 §6 —«reactivar es deshacer una desactivación, no reescribir la fila»— y porque la alternativa es peor: un `005B` que responde 409 deja a un SUPERADMIN con una fila que ya no puede volver y sin nada que hacer al respecto, salvo purgarla. El duplicado resultante es visible, corregible por `005A` y no rompe nada. **Va como escenario explícito en la suite** precisamente para que nadie lo «arregle» sin leer esto.
- **Sí:** la guarda corre **después** de la resolución. Lo que se compara es el término resuelto, no el código enviado: dos códigos distintos pueden resolver al mismo término, y comparar códigos dejaría pasar el duplicado que la regla existe para evitar.

**`hasComplications` y el padre**

- **Sí:** `hasComplications` **sigue siendo dato del cliente**, y ésta es la respuesta a la pregunta que F25 §6 dejó aquí por escrito. Derivarlo obligaría a que este servicio escribiera en `notificationPregnancy` en el `001`, en el `005A`, en el `005B` y en el `005C`, y a decidir qué pasa con `'UNKNOWN'` y `'NO_ANSWER'`, que no tienen equivalente en «hay filas / no hay filas». El tri-estado no es un booleano y forzarlo a serlo perdería información que el notificador sí dio.
- **No:** una guarda que bloquee el alta cuando el padre dice `hasComplications: 'NO'`. Suena a coherencia y es una trampa de flujo: obligaría a un `PUT` al embarazo antes de cada primera complicación, y el orden en que un notificador rellena un formulario no es asunto del servidor. La incoherencia queda visible en los datos, que es donde un analista puede verla y decidir.
- **Sí:** F27 **no escribe nunca** en `notificationPregnancy`. Ni `hasComplications`, ni `updatedAt`, ni `appDetails`. Es criterio de aceptación verificable por `git diff --stat`, y lo es porque es la desviación más tentadora del spec.
- **Sí:** mantener la respuesta de F25 a F13 —`severeNotification.hasPregnancyComplications` y `pregnancyComplicationsDescription` **conviven y no se sincronizan**—. Sincronizarlas ahora que existe la tabla hija sería un spec de consolidación con una migración de datos dentro, no una nota al pie de un CRUD.

**Estado, cascada y forma**

- **Sí:** el `005B` con reasignación de `sortOrder` en transacción, copiando F16. Aquí el hallazgo **sí** aplica: la tabla figura en `setSortOrderByParent` (`:1310`) y tiene índice único parcial (`:1345-1346`). Es la diferencia exacta con su padre, cuyo `005B` F25 pudo dejar como delegación limpia, y el error más fácil de cometer es copiar el del padre por proximidad en vez del de F16 por semejanza estructural.
- **Sí:** el `005A` no se bloquea por nada. La tabla es hoja del grafo: no hay hijos vivos que proteger.
- **Sí:** liberar el `sortOrder` al desactivar. El hueco queda para la siguiente complicación, que es el comportamiento que F16 §3.5 declaró correcto y deliberado.
- **Sí:** `metadata` fuera de alcance. La columna existe en tres tablas del esquema y solo en `diagnosticTerm` significa algo, porque F15 le puso marcadores con nombre. Aceptarla como objeto libre del cliente llenaría de esquemas privados una columna que nadie valida; reservarla para marcadores del servicio duplicaría lo que `diagnosticTerm.metadata.autoCreated` ya guarda. Se deja con `{}` hasta que alguien tenga un uso que declarar.
- **Sí:** visibilidad heredada de **dos** saltos, la cadena de F24. Componer un tercer salto hasta `esaviCase` no protegería de nada que la notificación no proteja ya.
- **Sí:** el índice sobre `pregnancyId`. El parcial de `:1345-1346` excluye las filas con `deletedAt` sellado, que son exactamente las que el `002B` existe para leer.
- **Sí:** **no reescribir** el volcado con `sequelize.query` del `ESAVI-NOTIFPRG-005C` ahora que la tabla tiene modelo. F25 §6 lo anticipó y F24 sentó el precedente al dejar intacta la consulta cruda de F22. Funciona, está probado, y cambiarlo mueve código ajeno sin ganar nada.
- **Sí:** la sexta línea en la cascada de `ESAVI-NOTIFCN-005C`. Sin ella, purgar una notificación destruye complicaciones en un tercer salto sin dejar rastro en ningún sitio, que es justo lo que F22 evitó para las vacunas y F24 para los diluyentes.
- **Sí:** nada del embarazo ni de la notificación viaja en la respuesta. Quien necesite el embarazo entra por `ESAVI-NOTIFPRG-003`.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Se copia el `005B` del padre**, que F25 §1.E declaró delegación limpia, sobre una tabla que **sí** tiene `sortOrder` con trigger e índice único parcial. Reactivar revienta con error de índice único en cuanto otra complicación tomó el número liberado | Es el riesgo **más probable del spec**, porque el precedente equivocado es el más cercano: F25 es el padre y su `005B` está tres archivos más allá. §1.B lo razona desde el DDL, §3.5 detalla los cuatro pasos de F16, y §5 lo verifica con el escenario completo de colisión —crear A y B, desactivar A, crear C, reactivar A—, que falla ruidosamente si alguien delegó |
| **Un `PUT` que reenvía la respuesta de su `GET` borra `complicationRawName`** en toda fila con divergencia, y el texto del notificador desaparece sin que nadie lo note | Es la trampa que F16 documentó y pagó. §3.5 fija la fórmula de `incomingName` con su segunda condición y la nota que explica por qué existe; §5 exige el criterio **sobre una fila con divergencia**, no solo sobre una fila cualquiera |
| **La guarda de duplicado se implementa mirando también filas inactivas**, por analogía con el `001` de F25, y desactivar una complicación deja al notificador sin poder volver a cargarla | §1.E razona la diferencia —allí había una `UNIQUE` real que respaldar, aquí no hay ninguna—, §3.5 exige `isActive: true` en el `findOne`, y §5 lo verifica con el escenario de desactivar y repetir el alta, que debe responder **201** |
| **Se «arregla» el `005B` para que revalide el par** y responda 409, dejando a un SUPERADMIN con una fila que ya no puede reactivar y sin nada que hacer salvo purgarla | §6 razona la elección y §5 monta el duplicado por reactivación como **escenario explícito** que exige 200. Es un criterio que existe para que nadie lo cambie sin leer la razón |
| **La guarda de duplicado corre antes de la resolución**, comparando códigos en vez de términos, y dos códigos que resuelven al mismo término pasan como si fueran distintos | §3.5 fija el orden —resolver, luego comparar— y §6 lo razona. El caso está en la suite como alta con dos códigos sinónimos que resuelven al mismo `diagnosticTermId` |
| **Se deriva `hasComplications` del padre** «ya que estamos», y el servicio empieza a escribir en `notificationPregnancy` en cuatro operaciones | F25 §6 dejó la decisión aquí y §6 la responde con el argumento del tri-estado. §5 lo vigila con `git diff --stat src/services/notificationPregnancy.service.ts` sin cambios y con la verificación de que el `updatedAt` del padre no se mueve al crear una complicación |
| **Se bloquea el alta cuando el padre dice `hasComplications: 'NO'`** por coherencia aparente, y el notificador queda obligado a un `PUT` al embarazo antes de cada primera complicación | §2 lo pone fuera de alcance y §6 lo razona: el orden en que se rellena un formulario no es asunto del servidor. §5 exige **201** en ese escenario |
| **Se cablean los tres ítems del catálogo** como constantes o como `CHECK`, y el despliegue queda condenado al primer país que se modeló | §6 lo razona con el precedente de `assertVaccinationGeoLocationIsValid`, y §5 lo vigila por ausencia: ningún nombre de complicación aparece en `src/` |
| **El catálogo `pregnancyComplicationType` no está cargado el día del despliegue**, y todo `complicationTypeItemId` cae en el 404: el endpoint nace inservible | Declarado en §2 como precondición de datos. Es el riesgo que **no se cierra con código**: el catálogo se carga por el `ESAVI-CATITEM-001` o por su importación masiva antes de abrir el endpoint. Es la misma precondición que `nonSevereNotification.service.ts:188-190` ya declara para `vaccinationSite`, con el mismo remedio |
| Se declara `defaultValue: 0` en `sortOrder`, o se omite el campo del `create` sin la lista `CREATE_FIELDS`, y el alta muere con `notNull Violation` antes de que el trigger actúe | §3.2 lo documenta con la nota de implementación de F16; §5 exige que `CREATE_FIELDS` exista y no contenga `sortOrder`, y verifica que tres altas seguidas reciban 1, 2 y 3 |
| **Se añaden `complicationName` o `complicationCode` como columnas** al esquema, para imitar a `notificationEvent` | §6 lo razona: serían dos copias que envejecen cuando alguien corrige el maestro, que es el problema que `esaviName` tiene hoy en F16. §5 exige que `git diff esaviapp.sql` muestre **exactamente una línea**, la del índice |
| **`metadata` se abre como objeto libre del cliente** y cada integración inventa su esquema dentro de una columna que nadie valida | §2 la deja fuera de alcance, §6 lo razona, y §5 lo vigila por ausencia con un `grep` sobre servicio y validador |
| Se acepta `complicationTypeItemId: null` en el `004` por simetría con la asimetría que F25 aplicó a `wasPregnantAtVaccination`, y quedan en la base filas sin tipificar que el `001` habría rechazado | §6 razona por qué las dos asimetrías van en sentidos contrarios —allí se vacía una respuesta, aquí una clasificación obligatoria— y §5 exige **400** ante el `null` explícito |
| Se reescribe el volcado con `sequelize.query` del `ESAVI-NOTIFPRG-005C` ahora que hay modelo, moviendo código ajeno y probado | §2 lo pone fuera de alcance con el precedente de F24 sobre la consulta de F22; §5 exige que `git diff --stat src/services/notificationPregnancy.service.ts` no muestre cambios |
| Se olvida la sexta línea de la cascada de `ESAVI-NOTIFCN-005C`, y purgar una notificación destruye complicaciones en silencio en el tercer salto | Paso 15 del plan con su verificación, y criterio en §5 que exige la línea con dos complicaciones y su **ausencia** cuando no hay ninguna |
| `GET /:id` captura `/admin`, `/pregnancy`, `/purge` o `/activate` como UUID | Las cuatro literales se declaran antes que `/:id`, en el orden exacto de §3.4; cubierto por la suite de contrato |
| Se añade un filtro de listado «que apenas cuesta» por tipo o por término | §2 lo pone fuera de alcance y §5 exige que el controlador solo lea `limit` y `offset` de `req.query` |

**§8 no aplica.** Este spec añade endpoints nuevos, un índice y una línea de log en un servicio existente. Ningún status, campo ni mensaje que los clientes ya reciben cambia de forma.

---

## Lo que **no** está en este spec

- **Derivar `hasComplications` de estas filas.** F25 §6 dejó la decisión aquí y la respuesta es no. F27 no escribe nunca en `notificationPregnancy`.
- **Cualquier guarda de coherencia contra `hasComplications`.** Crear una complicación sobre un embarazo que dice `'NO'` responde 201.
- **Cualquier sincronización con `severeNotification`.** `hasPregnancyComplications` y `pregnancyComplicationsDescription` (`:753-754`) conviven y no se sincronizan, que es la respuesta que F25 §6 dio a F13.
- **Migrar `pregnancyComplicationsDescription` a esta tabla.** Es una migración de datos, no un CRUD.
- **`metadata`** (`:912`). No se acepta, no se compara y no se expone. Queda reservada para el spec que le encuentre un uso.
- **Reordenar complicaciones** — el `007` que el `sortOrder` inmutable deja pendiente, con su transacción sobre N filas y su decisión entre orden denso o disperso. Es el mismo que F16 §2 dejó abierto para los eventos, y cuando llegue debería resolver las dos entidades a la vez.
- **Aceptar `diagnosticTermId` directo del cliente.**
- **Exigir `complicationCode`.** Una complicación descrita sin código es un registro legítimo.
- **Cablear los tres ítems del catálogo de tipos**, ni anclarlos a una clave de `systemConfig` como F25 hizo con el sexo. Lo que se ancla aquí es un `catalogType`, que es estructura.
- **Un índice único que respalde la guarda de duplicado.** Sería cambio de DDL sobre una regla sin rodaje, y dejaría el `005B` sin salida.
- **Que el `005B` revalide el par de duplicado**, el tipo de complicación o el estado de la cadena. Reactivar es deshacer una desactivación.
- **Cualquier filtro de listado**, por tipo, por término o por texto.
- **Un `006`** por `notificationId` o por `caseId`.
- **Reescribir el volcado con `sequelize.query` del `ESAVI-NOTIFPRG-005C`.**
- **Bloquear el `005A` del embarazo** cuando tenga complicaciones vivas. F25 §2 ya lo declaró.
- **Modificar `esaviapp.sql`** más allá del índice: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`.
- **Modificar `purgeEntityService`, `setEntityActiveStatusService` ni `diagnosticTermResolution.service.ts`.**
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la octava copia y el refactor esté vencido desde F24 §7.
- **Incluir las complicaciones en la respuesta de `notificationPregnancy`.** El contrato de F25 no cambia.
- Cifrado de ningún campo.
- Crear complicaciones automáticamente al dar de alta un embarazo.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
