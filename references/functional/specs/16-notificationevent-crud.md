# SPEC F16 — CRUD de `notificationEvent`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F10 (`notification` — dependencia dura de modelo: es el padre de la FK y la fuente de la visibilidad heredada)**, **SPEC F15 (`diagnosticTerm` — dependencia dura de implementación: aporta `resolveDiagnosticTermService`, sobre el que se cuelga la resolución del `001` y del `004`)**, SPEC F06 (`esaviCase` — el `006` entra por el `caseId`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa, y gobierna cuándo se re-dispara la resolución contra el maestro)
> **Fecha:** 2026-08-13
> **Objetivo:** Dar de alta `notificationEvent` —los eventos adversos que motivan una notificación— como la primera tabla satélite de `notification` con cardinalidad uno a muchos, estado propio y orden entre hermanas.

---

## 1. Por qué existe este spec

`notificationEvent` es la **tercera de las ocho tablas satélite de `notification`** que recibe implementación, y la primera que no se parece a las dos anteriores. El [SPEC F10](./10-notification-header-crud.md) las dejó fuera de alcance en bloque; el [SPEC F13](./13-severenotification-crud.md) y el [SPEC F14](./14-nonseverenotification-crud.md) entregaron las dos ramas del detalle —grave y no grave—, que son **uno a uno, sin estado propio y sin orden entre sí**. Ésta es lo contrario en los tres ejes.

Guarda **el evento adverso en sí**: qué le pasó al paciente, cuándo empezó, y contra qué término del catálogo clínico se codifica. Es la razón por la que la notificación existe, y por eso no depende del `notificationType`: un ESAVI se describe igual sea grave o no grave. Un caso puede acumular muchos.

Hoy la tabla existe en `esaviapp.sql:785-808` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**A — Es la primera satélite uno a muchos.** `eventId` es `uuid PRIMARY KEY DEFAULT gen_random_uuid()` (`:786`) y `notificationId` es una columna aparte, `NOT NULL` (`:787`), con un índice **no único** (`:808`). Las dos hermanas montaban el uno a uno sobre la propia PK; aquí no hay `UNIQUE` que limite cuántas filas cuelgan de una notificación, y no debe haberlo. La consecuencia inmediata es que **sí hay listado** —`002A` y `002B`, que en F13 y F14 no existían— y que el listado se entra por la FK, no por `/`.

**B — Es la primera satélite con `isActive`.** La columna está en `:799`. F13 §1 razonó la ausencia en sus hermanas como una decisión del esquema sobre las satélites; esta tabla demuestra que la decisión no fue por ser satélite, sino por ser **detalle uno a uno de una cabecera que ya lleva estado**. Un evento es una fila con vida propia: se reporta, se descubre mal digitado y se retira, sin que la notificación entera se mueva. De ahí salen **ocho operaciones**, no cinco: las siete canónicas más `005C`.

**C — Es la primera entidad con orden entre hermanas, y el orden tiene una trampa verificada.** `sortOrder` es `smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0)` (`:789`), lo asigna el trigger `TRG_notificationEvent_setSortOrder` (`esaviapp.sql:1298-1323`) y lo protege el índice único parcial `UQ_notificationEvent_parent_sortOrder` sobre `("notificationId", "sortOrder") WHERE "deletedAt" IS NULL` (`:1326-1328`). Las tres piezas encajan mal en un punto concreto:

- El trigger es `BEFORE INSERT` **solamente** (`:1318`), y calcula `COALESCE(MAX("sortOrder"), 0) + 1 ... WHERE "deletedAt" IS NULL` (`:183`).
- `ESAVI-NOTIFEVT-005A` sella `deletedAt`, así que **el número que ocupaba esa fila sale del índice y sale del `MAX`**.
- Un alta posterior reutiliza ese número con toda legitimidad.
- `setEntityActiveStatusService:34` reactiva con `deletedAt: null` — y en ese instante **dos filas vivas comparten `(notificationId, sortOrder)`** y el índice único revienta.

En concreto: eventos 1, 2 y 3; se desactiva el 3; se crea uno nuevo que recibe el 3; se reactiva el antiguo → **500** por violación de restricción, en una operación que la norma describe como el simple deshacer de `005A`. No es hipotético: sale de leer las tres piezas juntas. Este spec tiene que resolverlo en `ESAVI-NOTIFEVT-005B`, y es la única razón por la que esta entidad no puede delegar la activación en `setEntityActiveStatusService` sin más.

**D — Es la primera consumidora de `ESAVI-DIAGTERM-006`.** El [SPEC F15](./15-diagnosticterm-crud.md) entregó `resolveDiagnosticTermService` para que el catálogo clínico crezca cuando alguien notifica, y lo escribió anticipando exactamente esta tabla: `src/services/common/diagnosticTermResolution.service.ts:36` dice que *«la divergencia se preserva en la columna `*Raw*` de la tabla llamante»*. Esa columna es `esaviRawName` (`:792`). Este spec es quien la usa por primera vez.

**Y dos rasgos que sí comparte con sus hermanas.** El `ON DELETE CASCADE` hacia `notification` (`:805`) dispara de verdad, porque `notification` no figura en `preventPhysicalDelete` (`esaviapp.sql:1355-1361`). Y el trigger `TRG_notificationEvent_setSysDetails` lo monta el bucle genérico (`:1274-1291`); no hay `setUpdatedAt`, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notificationEvent`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones canónicas más una no canónica:** `001` crear, `002A` listar activos por notificación, `002B` listar todos por notificación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar, `005C` borrado físico, y `006` listar los eventos de un caso. Alta de la fila de `006` en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Relación uno a muchos con `notification`.** No hay límite de eventos por notificación, ni `UNIQUE` que lo imponga. Los listados se entran por la FK —`/notification/:id`— y nunca por `/`.
- **Guarda única del alta:** la notificación existe y está **activa** → 404 `NOTIFEVT_001_NOTIFICATION_NOT_FOUND`. **Ninguna guarda por `notificationType`:** el evento es independiente de si la notificación es grave o no grave.
- **Resolución contra el catálogo clínico vía `ESAVI-DIAGTERM-006`**, dentro de la transacción del `001` y del `004`:
  - Con `esaviCode` y `source` ausente o `LOCAL` → `resolveDiagnosticTermService`, que devuelve el término existente o **lo crea**.
  - Con `esaviCode` y `source` distinto de `LOCAL` → búsqueda del par `(source, code)` sin crear nada; si no existe → **404** `NOTIFEVT_001_DIAGTERM_NOT_FOUND`.
  - Sin `esaviCode` → `diagnosticTermId` queda `null` y `esaviName` es texto libre.
  - En los tres casos, `esaviName` se guarda con el nombre del **maestro** cuando hubo término, y `esaviRawName` con el texto del notificador **solo si difiere**.
- **Resolución disparada por el cambio de valor, no por la presencia de la clave** (SPEC F12): en el `004`, un `esaviCode` que llega igual al guardado no se resuelve ni se consulta. Reenviar íntegra la respuesta del `GET` **no escribe en `diagnosticTerm`**.
- **`sortOrder` inmutable y asignado por la base.** El `001` nunca lo envía: lo pone `TRG_notificationEvent_setSortOrder`. El `004` lo ignora en silencio, sin 400. Reordenar eventos no está en este spec.
- **Reasignación de `sortOrder` en `ESAVI-NOTIFEVT-005B`** cuando el número que ocupaba la fila ya lo tomó otro evento vivo de la misma notificación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación **no** delega sin más en `setEntityActiveStatusService`.
- **Regla de coherencia del evento «otro»**, evaluada en el servicio sobre el **estado resultante** en el `004`, nunca sobre el body: con `isOtherEsavi: true` la descripción es obligatoria y `esaviCode` y `diagnosticTermId` deben venir vacíos → 400; con `false`, enviar `otherDescription` → 400.
- **Visibilidad heredada de la cabecera.** Toda lectura incluye `notification` y comprueba su `isActive`: si la notificación está inactiva, sus eventos responden **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Aplica a `002A`, `002B`, `003` y `006`.
- **`005C` sin mirar al padre.** Un evento mal digitado se purga con su notificación activa: son dos pasos —`005A` y luego `005C`— y la guarda es la canónica de §6 sobre la **propia fila**, que `purgeEntityService` (`src/services/common/entityPurge.service.ts:31`) ya aplica sin modificación alguna.
- **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`:** **una sola línea** en nivel `warn` con el conteo y la lista de `eventId` arrastrados, sin el contenido de las filas. Implica tocar `src/services/notification.service.ts` solo en ese punto.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` de §3.5: `notificationId` y `sortOrder` inmutables, tres campos derivados de la resolución y siete anulables.
- Alta de la abreviatura **`NOTIFEVT`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **126 a 135**— y suite `tests/contract/notificationEvent.test.ts`.

**Precondiciones de datos** (no son parte de la implementación):

- Ninguna. A diferencia de F14, esta entidad no depende de ningún `catalogType` sembrado: su única FK opcional es al maestro clínico, y ése se alimenta solo por el `006` de `DIAGTERM`.

**Fuera de alcance (otros specs):**

- **Las otras cinco satélites de `notification`:** `notificationMedication` (`esaviapp.sql:810-833`), `notificationVaccine` (`835-861`), `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- **Reordenar eventos** — un `007` que mueva un evento de posición y desplace a sus hermanas. Es la operación que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. Su propio spec.
- **Cualquier regla sobre `isMainEsavi`.** El DDL no la impone y este spec tampoco: nada impide dos eventos principales en la misma notificación, ni ninguno. Si el funcional pide el radio button, es un spec de ampliación con la regla escrita.
- **Arrastre de estado desde la cabecera.** Desactivar una notificación **no** toca el `isActive` ni el `deletedAt` de sus eventos. La visibilidad heredada ya los oculta, y sin arrastre este spec no toca `esaviCase.service.ts` en absoluto. Si más adelante se quiere el sellado, es un spec que lo razone.
- **Cualquier filtro de listado** por `isMainEsavi`, `diagnosticTermId`, `startDate` o texto sobre `esaviName`. Los dos listados devuelven todos los eventos de su notificación, paginados y ordenados por `sortOrder`.
- **Ampliar `ResolveDiagnosticTermInput` con `source`.** El `006` de F15 sigue forzando `LOCAL`, y este spec lo respeta: la rama con `source` externo es una búsqueda propia de este servicio, no una llamada al resolver.
- **Recodificar eventos ya guardados** cuando un término del maestro cambia de nombre. El nombre guardado en `esaviName` es histórico por diseño, y F15 §6 ya razonó que el maestro no reescribe notificaciones pasadas.
- **Modificar `esaviapp.sql`**: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`.
- **Modificar `purgeEntityService`.** Sirve tal cual.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII del paciente.
- Crear eventos automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notificationEvent` — `esaviapp.sql:785-807`, más su índice en `:808`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `eventId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` |
| `notificationId` | `uuid` | no | `FK_notificationEvent_notification` → `notification`, `ON DELETE CASCADE`. Índice **no único** `IX_notificationEvent_notification` |
| `diagnosticTermId` | `uuid` | sí | `FK_notificationEvent_diagnosticTerm` → `diagnosticTerm`, `ON DELETE RESTRICT` |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)`. Lo asigna el trigger; la aplicación no lo envía |
| `esaviName` | `varchar(250)` | no | **La única columna de datos obligatoria** |
| `esaviCode` | `varchar(250)` | sí | Código del término; entrada de la resolución |
| `esaviRawName` | `varchar(500)` | sí | Texto tal como lo escribió el notificador, solo si difiere del maestro |
| `isMainEsavi` | `boolean` | no | `DEFAULT false`. Sin restricción de unicidad por notificación |
| `startDate` | `date` | sí | Fecha de inicio del evento |
| `startTime` | `time` | sí | Hora de inicio, columna separada de la fecha |
| `isOtherEsavi` | `boolean` | no | `DEFAULT false`. Gobierna la regla de coherencia |
| `otherDescription` | `varchar(500)` | sí | Solo con `isOtherEsavi: true` |
| `notes` | `text` | sí | Texto libre |

**Trece columnas de datos: una obligatoria, dos booleanas no nulas con defecto, y diez anulables.**

**Restricciones.** Dos claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla** — la única unicidad de negocio vive fuera, en el índice parcial `UQ_notificationEvent_parent_sortOrder` (`:1326-1328`) sobre `("notificationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `C` de §1.

`FK_notificationEvent_diagnosticTerm` es `ON DELETE RESTRICT`, así que **un evento impide borrar físicamente su término** — irrelevante en la práctica, porque `diagnosticTerm` figura en `preventPhysicalDelete` y no tiene `005C`.

**El `startDate` / `startTime` partido en dos columnas.** El DDL separa fecha y hora, y este spec no las junta: son dos preguntas distintas del formulario y la hora se desconoce con frecuencia. `startDate: '2026-08-01'` con `startTime: null` es un evento perfectamente registrado.

**Las columnas transversales.** Están las seis: `isActive` (`:799`), `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. No falta ninguna, a diferencia de F13 y F14.

**Triggers.** Dos. `TRG_notificationEvent_setSysDetails`, del bucle genérico (`:1274-1291`). Y `TRG_notificationEvent_setSortOrder`, del bucle de orden (`:1298-1323`), que ejecuta `setSortOrderByParent('notificationId')` **solo `BEFORE INSERT`** (`:1318`): respeta un `sortOrder` recibido si es mayor que 0 (`:169-171`) y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre (`:182-188`), bajo `pg_advisory_xact_lock` para que dos altas concurrentes no choquen (`:180`). **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `esaviapp.sql:1355-1361`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationEvent.model.ts`. Clase `NotificationEvent`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationEvent'`.

`eventId` es la PK **con** `defaultValue: sequelize.literal('gen_random_uuid()')` — al revés que F13 y F14, donde la PK la aportaba el cliente. Aquí la genera la base como en cualquier entidad raíz.

`notificationId` va `DataTypes.UUID` con `allowNull: false`. `diagnosticTermId` va `DataTypes.UUID` con `allowNull: true`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`.** No llevarlo al `create` es lo que deja actuar al trigger; declararle un `defaultValue: 0` en Sequelize haría que el `INSERT` mandara `0` explícito, que es justo el valor que el trigger interpreta como «asígnamelo tú» (`:169`) — funcionaría, pero por accidente. Se omite del `create` y punto.

> **Nota de implementación.** Omitir el valor **no basta**: Sequelize corre su propia validación `notNull` sobre todos los atributos del modelo antes de emitir el `INSERT`, así que el alta muere en la aplicación con `notNull Violation: NotificationEvent.sortOrder cannot be null` y el trigger nunca llega a ejecutarse. Lo que deja la columna fuera de la sentencia es pasar la lista explícita de columnas al `create` — `NotificationEvent.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y sin `sortOrder` ni `eventId`. El modelo queda como se describe arriba.

Las longitudes van explícitas, para que un texto largo falle en Sequelize y no en Postgres: `esaviName` `DataTypes.STRING(250)` con `allowNull: false`; `esaviCode` `DataTypes.STRING(250)`; `esaviRawName` y `otherDescription` `DataTypes.STRING(500)`; `notes` `DataTypes.TEXT`.

`isMainEsavi` e `isOtherEsavi` van `DataTypes.BOOLEAN` con `allowNull: false` y `defaultValue: false`. **No son tri-estado**, a diferencia de los seis `verified*` de F14: el DDL los declara `NOT NULL`, así que `null` no es un valor posible y la comparación en el diff nunca es contra `undefined` por veracidad.

`startDate` va `DataTypes.DATEONLY` —el helper de diff ya compara `DATEONLY` con `slice(0, 10)`— y `startTime` va `DataTypes.TIME`, que vuelve de `pg` como cadena `'HH:MM:SS'`.

Asociaciones, en `src/models/associations/notificationEvent.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationEvent.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasMany(NotificationEvent, { as: 'events', foreignKey: 'notificationId' })`
- `NotificationEvent.belongsTo(DiagnosticTerm, { as: 'diagnosticTerm', foreignKey: 'diagnosticTermId' })`

El `hasMany` **sí** se declara —F13 y F14 declararon `hasOne`— porque lo necesitan el `006`, la visibilidad heredada y el volcado al log de la cascada de purga. **Ningún inverso `hasMany` desde `DiagnosticTerm`**: nadie lo necesita y declararlo invitaría a incluir eventos en las respuestas del catálogo, cuyo contrato no cambia. Alta en `src/models/index.ts`.

### 3.3 Tipos

Ruta: `src/types/notificationEvent/notificationEvent.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts` — el barrel del dominio **sí** se crea, a diferencia de la desviación catalogada de `healthFacility`.

```ts
export interface CreateNotificationEventInput {
    notificationId: string;
    esaviName: string;
    esaviCode?: string | null;
    source?: 'LOCAL' | 'MEDDRA' | 'WHODRUG';   // entrada de la resolución, no se persiste
    isMainEsavi?: boolean;
    startDate?: string | null;
    startTime?: string | null;
    isOtherEsavi?: boolean;
    otherDescription?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationEventInput>`. **No se declara `UpdateNotificationEventInput`** — prohibido por §4 de las convenciones.

Tres ausencias deliberadas en la interfaz:

- **`sortOrder` no está.** Es inmutable y lo asigna la base. Que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande.
- **`diagnosticTermId` no está.** No lo elige el cliente: lo devuelve la resolución. Aceptarlo abriría una segunda puerta para apuntar a un término sin pasar por `esaviCode`, y con ella la pregunta de qué gana entre los dos.
- **`esaviRawName` no está.** Es derivado: lo calcula el servicio comparando lo que mandó el notificador con lo que dice el maestro.

**`source` es el único campo de entrada que no es columna.** Gobierna qué rama de resolución se toma y se descarta después. Sus valores son los del ENUM `termSource` del DDL; la lista literal se toma de `src/constants/enums.constants.ts`, que F13 creó y F15 amplió, sin redeclararla aquí.

> **Nota de implementación.** El snippet de arriba escribe tres literales, pero `TERM_SOURCES` tiene **cuatro** valores — `MEDDRA`, `WHODRUG`, `LOCAL` y `OTHER`. Manda la regla de no redeclarar: el tipo del campo es `TermSource`, así que `OTHER` también se admite y cae en la rama externa —buscar el par `(source, code)` sin crear nada, 404 si no existe—, que es coherente con la regla «`source` distinto de `LOCAL` no acuña».

### 3.4 Superficie HTTP

Ruta base `/api/notification-events`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-events                          ESAVI-NOTIFEVT-001   USER        (nuevo)
GET    /api/notification-events/case/:caseId             ESAVI-NOTIFEVT-006   USER        (nuevo)
GET    /api/notification-events/admin/notification/:id   ESAVI-NOTIFEVT-002B  ADMIN       (nuevo)
GET    /api/notification-events/notification/:id         ESAVI-NOTIFEVT-002A  USER        (nuevo)
DELETE /api/notification-events/purge/:id                ESAVI-NOTIFEVT-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-events/activate/:id             ESAVI-NOTIFEVT-005B  SUPERADMIN  (nuevo)
GET    /api/notification-events/:id                      ESAVI-NOTIFEVT-003   USER        (nuevo)
PUT    /api/notification-events/:id                      ESAVI-NOTIFEVT-004   ADMIN       (nuevo)
DELETE /api/notification-events/:id                      ESAVI-NOTIFEVT-005A  ADMIN       (nuevo)
```

**Orden de declaración.** Las literales van **antes** de `/:id`, o Express capturaría `case`, `admin`, `notification`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las nueve están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationEvent.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `HFAC`, no la de `GEOTYPE`.

`ESAVI-NOTIFEVT-006` **sí tiene ruta** —a diferencia del `006` de `DIAGTERM`— y por tanto sí lleva fila en `ROUTE_RULES` y el código en los cinco lugares. Se registra en la tabla de operaciones no canónicas de §6 como: *«listar los eventos de un caso — la cadena `caso → notificación` es uno a uno, pero de la notificación cuelgan N eventos»*.

Nueve filas nuevas en `ROUTE_RULES`: de **126** a **135**.

> **Nota de implementación.** El spec se escribió cuando `ROUTE_RULES` tenía 125 filas. La 126 es `ESAVI-DIAGTERM-007`, la importación masiva que entró con SPEC F17 antes que este spec, así que el total real es 126 → 135. Corregido aquí, en §2 y en §5.

### 3.5 Reglas de negocio por operación

**`ESAVI-NOTIFEVT-001` — crear.** En este orden:

1. La notificación existe y está **activa** → 404 `NOTIFEVT_001_NOTIFICATION_NOT_FOUND`. Sin comprobar `notificationType`.
2. Coherencia del evento «otro», sobre el body: con `isOtherEsavi: true`, `otherDescription` es obligatoria → 400 `NOTIFEVT_001_OTHER_DESCRIPTION_REQUIRED`, y `esaviCode` debe venir vacío → 400 `NOTIFEVT_001_OTHER_ESAVI_CONFLICT`. Con `isOtherEsavi: false`, enviar `otherDescription` → 400 `NOTIFEVT_001_OTHER_DESCRIPTION_NOT_ALLOWED`.
3. Resolución del término, en transacción propia abierta por este servicio:
   - Sin `esaviCode` → `diagnosticTermId: null`, `esaviName: data.esaviName.trim()`, `esaviRawName: null`.
   - Con `esaviCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService({ code, name: data.esaviName, operationCode: 'ESAVI-NOTIFEVT-001' }, authUser, lang, transaction)`, que **devuelve el término o lo crea**.
   - Con `esaviCode` y `source` distinto de `'LOCAL'` → `DiagnosticTerm.findOne({ where: { source, code: toConstantCase(code.trim()) } })`, **sin crear nada**; si no existe → 404 `NOTIFEVT_001_DIAGTERM_NOT_FOUND`. La consulta no filtra por `isActive`: un término retirado sigue siendo referenciable, por la misma razón que `resolveDiagnosticTermService:37-38` no lo filtra.
4. Con término resuelto: `diagnosticTermId` = el suyo, `esaviName` = **el nombre del maestro**, y `esaviRawName` = el texto del notificador **solo si difiere** del maestro; si coincide, `null`. El maestro manda sobre el nombre y la divergencia se preserva, que es el contrato que F15 dejó escrito.
5. `create` **sin `sortOrder`**, para que lo asigne `TRG_notificationEvent_setSortOrder`.
6. Entrada de auditoría en `appDetails` con `method: 'ESAVI-NOTIFEVT-001'`.

La transacción es propia y envuelve la resolución: si el `create` del evento falla, el término recién acuñado se revierte con él.

**`ESAVI-NOTIFEVT-002A` — listar activos por notificación.** La notificación existe y está activa, salvo `canViewInactive` → 404 `NOTIFEVT_002A_NOTIFICATION_NOT_FOUND`. `findAndCountAll` con `where: { notificationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query.

**`ESAVI-NOTIFEVT-002B` — listar todos por notificación.** Idéntico, sin el filtro `isActive` y con `paranoid: false`. Rol ADMIN.

**`ESAVI-NOTIFEVT-003` — obtener por ID.** Existencia → 404 `NOTIFEVT_003_NOT_FOUND`. Incluye `notification`: si la notificación está inactiva y quien pide no cumple `canViewInactive`, **404**. Un evento inactivo también es 404 salvo `canViewInactive`.

**`ESAVI-NOTIFEVT-006` — listar los eventos de un caso.** El caso existe y está activo → 404 `NOTIFEVT_006_CASE_NOT_FOUND`. Su notificación existe y está activa → 404 `NOTIFEVT_006_NOTIFICATION_NOT_FOUND`. A partir de ahí es el `002A`: solo activos, ordenados por `sortOrder`. La variante admin no se declara — quien necesite ver inactivos entra por `002B` con el `notificationId` que este mismo endpoint devuelve.

**`ESAVI-NOTIFEVT-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'NOTIFEVT_005A_NOT_FOUND'`, `alreadyInStateCode: 'NOTIFEVT_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-NOTIFEVT-005A'`. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial. Es correcto y deliberado: el hueco queda disponible para el siguiente evento.

**`ESAVI-NOTIFEVT-005B` — reactivar.** **La única operación de este spec que no es una delegación limpia**, por el hallazgo `C` de §1. En transacción propia:

1. `NotificationEvent.findOne({ where: { eventId: id }, paranoid: false, transaction })`. Si no hay fila, se pasa directo al paso 4 y el helper levanta el 404.
2. Si la fila existe y está inactiva, se busca colisión: otra fila de la **misma** notificación, con el **mismo** `sortOrder`, con `deletedAt: null` y `eventId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa notificación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que esta escritura es libre. El evento reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'NOTIFEVT_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-NOTIFEVT-005B'`, que limpia `deletedAt` con el `sortOrder` ya corregido.

Si la fila estaba **activa**, el paso 2 no encuentra colisión —el índice garantiza que ninguna otra fila viva comparte su número— así que no se escribe nada y el helper levanta su 409 con normalidad. No hacen falta comprobaciones duplicadas de estado.

El orden de los pasos 3 y 4 es la clave entera: invertirlos hace fallar el índice en el propio `UPDATE` del helper, porque no es una restricción diferible y no hay forma de corregir después.

**`ESAVI-NOTIFEVT-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'NOTIFEVT_005C_NOT_FOUND'` y `stillActiveCode: 'NOTIFEVT_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la notificación**: un evento mal digitado se retira y se purga con su notificación activa, que es el caso de uso que motiva la operación. Sin entrada en `appDetails` —la fila se destruye en la misma transacción— y con el volcado a `warn` que el helper ya escribe.

**`ESAVI-NOTIFEVT-004` — actualizar.** Existencia → 404 `NOTIFEVT_004_NOT_FOUND`, incluida la visibilidad heredada. Coherencia del evento «otro» evaluada sobre el **estado resultante**, no sobre el body → 400. `stored` sale de `event.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila sin escribir.

Los tres valores derivados se calculan así, y **entran siempre en `candidates`**:

- `incomingCode` = `data.esaviCode !== undefined ? (data.esaviCode ? toConstantCase(data.esaviCode.trim()) : null) : stored.esaviCode`
- `incomingRawName` = `data.esaviName !== undefined && data.esaviName.trim() !== stored.esaviName ? data.esaviName.trim() : (stored.esaviRawName ?? stored.esaviName)`
- **La resolución solo se dispara si `incomingCode !== stored.esaviCode`.** Un código que llega igual al guardado no consulta el maestro ni lo escribe.

> **Nota de implementación — por qué `incomingRawName` lleva la segunda condición.** La fórmula original era `data.esaviName !== undefined ? data.esaviName.trim() : (...)`, y choca con el criterio de §5 *«un `PUT` que reenvía íntegra la respuesta de su `GET` no escribe nada»* en toda fila con divergencia. El `GET` devuelve `esaviName` con el nombre **del maestro**, así que al reenviarlo `incomingRawName` pasaba a ser ese mismo nombre, coincidía con el maestro y `esaviRawName` se borraba a `null`: un `PUT` que no cambia nada destruía lo que escribió el notificador. Un `esaviName` que llega **igual** al guardado no es una reescritura —es la palabra del maestro volviendo en el body— y por eso cae al fallback como una clave ausente. Cambiar el nombre a cualquier otro texto sigue moviendo `esaviRawName`.

> **Nota de implementación — `startTime` se normaliza antes de comparar.** La columna es `time` y `pg` la devuelve como `'HH:MM:SS'`, mientras que el validador admite `'HH:MM'` porque un formulario que solo pregunta horas y minutos no tiene por qué inventarse los segundos. Sin rellenarlos, un `PUT` con `'14:30'` sobre un `'14:30:00'` guardado contaría como cambio y dejaría entrada de auditoría por un valor que Postgres almacena idéntico — justo lo que combate F12. El candidato es `data.startTime !== undefined ? normalizeTime(data.startTime) : undefined`, y la misma normalización se aplica en el `001`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `notificationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `esaviCode` | `incomingCode` | anulable; normalizado antes de comparar |
| `diagnosticTermId` | **siempre**, del término resuelto o `null` | derivado |
| `esaviName` | **siempre**: el nombre del maestro si hay término, `incomingRawName` si no | derivado |
| `esaviRawName` | **siempre**: `incomingRawName` si difiere del nombre del maestro, `null` si coincide | derivado |
| `isMainEsavi` | `data.isMainEsavi !== undefined ? data.isMainEsavi : undefined` | `NOT NULL`: nunca por veracidad, nunca a `null` |
| `isOtherEsavi` | ídem | ídem |
| `startDate` | `data.startDate !== undefined ? (data.startDate ?? null) : undefined` | `DATEONLY`; el helper compara con `slice(0, 10)` |
| `startTime` | `data.startTime !== undefined ? (data.startTime ?? null) : undefined` | cadena `'HH:MM:SS'` |
| `otherDescription` | `data.otherDescription !== undefined ? (data.otherDescription ?? null) : undefined` | anulable |
| `notes` | `data.notes !== undefined ? (data.notes ?? null) : undefined` | anulable |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

Unicidad y FK **antes del diff y con independencia de él**: la resolución con `source` externo devuelve 404 aunque el resto del body no cambie nada.

**Escrituras que no son diferenciales, declaradas una a una:**

- **El `001`** — es un `create`.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: este evento vuelve a estar vivo y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005C`** — destruye la fila.
- **El `006` de `DIAGTERM` en su rama de creación** — es un `create` en otra tabla, ya razonado en F15.

**Este spec no propaga nada a otra tabla por cambio de valor.** Lo único que escribe fuera de `notificationEvent` es la acuñación de un término, y su disparador ya es el cambio real de `esaviCode`, no la presencia de la clave.

### 3.6 Claves i18n nuevas

Bajo `notificationEvent`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationEvent.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente |
| `notificationEvent.idRequired` | 400 del validador de `:id` |
| `notificationEvent.notificationNotFound` | 404 cuando la notificación no existe o está inactiva |
| `notificationEvent.caseNotFound` | 404 del `006` cuando el caso no existe o está inactivo |
| `notificationEvent.diagnosticTermNotFound` | 404 con `source` externo y par `(source, code)` inexistente |
| `notificationEvent.otherEsaviConflict` | 400 al declarar `isOtherEsavi: true` junto a un `esaviCode` |
| `notificationEvent.otherDescriptionRequired` | 400 con `isOtherEsavi: true` sin descripción |
| `notificationEvent.otherDescriptionNotAllowed` | 400 con descripción sin `isOtherEsavi: true` |
| `notificationEvent.stillActive` | 409 al purgar un evento que no fue retirado antes |
| `notificationEvent.createdSuccess` / `createdFailed` | 201 y 500 del `001` |
| `notificationEvent.getSuccess` / `getFailed` | 200 y 500 de `002A`, `002B`, `003` y `006` |
| `notificationEvent.updatedSuccess` / `updatedFailed` | 200 y 500 del `004` |
| `notificationEvent.deletedSuccess` / `deletedFailed` | 200 y 500 del `005A` |
| `notificationEvent.activatedSuccess` / `activatedFailed` | 200 y 500 del `005B` |
| `notificationEvent.alreadyActive` / `alreadyInactive` | 409 de `005B` y `005A` |
| `notificationEvent.purgeSuccess` / `purgeFailed` | 200 y 500 del `005C` |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `003`, `001` y `004`, `data` es la fila con su término resuelto:

```
{ ok, message, data: {
    eventId, notificationId, diagnosticTermId, sortOrder,
    esaviName, esaviCode, esaviRawName, isMainEsavi,
    startDate, startTime, isOtherEsavi, otherDescription, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    diagnosticTerm: { diagnosticTermId, source, code, name, termGroup, isActive } | null
} }
```

`diagnosticTerm` se incluye siempre que exista la FK, con esos seis campos: sin `metadata` —lleva los marcadores internos de la resolución implícita, `autoCreated` y `reviewStatus`, que son gobernanza del catálogo y no dato de la notificación— y sin `appDetails` ni `sysDetails`.

**`notification` no se incluye en la respuesta**, aunque toda lectura la consulte para la visibilidad heredada. Se resuelve con `attributes: ['notificationId', 'isActive']` y se descarta al construir el payload: el cliente que necesite la cabecera entra por `ESAVI-NOTIFCN-003`.

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente. `sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `notificationEvent | NOTIFEVT` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila de `ESAVI-NOTIFEVT-006` a la tabla de operaciones no canónicas. La norma exige registrar **antes** de usar, así que va primero aunque no toque `src/`.
   *Verificación:* las dos tablas de §6 contienen la fila nueva; `NOTIFEVT` no aparece dos veces.

2. **Modelo y asociaciones.** `src/models/notificationEvent.model.ts` según §3.2, y `src/models/associations/notificationEvent.associations.ts` con las tres asociaciones. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` en 0; un `NotificationEvent.findAll({ include: ['notification', 'diagnosticTerm'] })` desde el REPL devuelve filas sin error de asociación.

3. **Tipos.** `src/types/notificationEvent/notificationEvent.types.ts` con `CreateNotificationEventInput`, más su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateNotificationEventInput" src/` no devuelve resultados.

4. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0.

5. **Validadores.** `src/validators/notificationEvent.validator.ts` con el validador de creación, el de actualización, el de `:id`, el de `:caseId` y el del `notificationId` de ruta. `source` acotado al ENUM `termSource`; `startTime` con formato `HH:MM` o `HH:MM:SS`; longitudes máximas iguales a las del DDL. **`sortOrder` y `diagnosticTermId` no se declaran en ningún validador.** Alta en el barrel de `validators/`.
   *Verificación:* un body con `sortOrder: 5` no produce 400 y el campo se ignora; un `source: 'MEDRA'` mal escrito produce 400.

6. **`ESAVI-NOTIFEVT-001` — crear.** `createNotificationEventService` con los seis pasos de §3.5, transacción propia envolviendo la resolución. Controlador y ruta `POST /`.
   *Verificación:* crear con `esaviCode: 'fiebre alta'` inexistente crea la fila en `diagnosticTerm` con `code: 'FIEBRE_ALTA'` y `metadata.autoCreated: true`; crear con `source: 'MEDDRA'` y un código inexistente devuelve **404** sin crear nada; tres altas seguidas sobre la misma notificación reciben `sortOrder` 1, 2 y 3 sin que el servicio lo envíe.

7. **`ESAVI-NOTIFEVT-002A` — listar activos por notificación.** Servicio, controlador y ruta `GET /notification/:id`, declarada después de `/admin/notification/:id`.
   *Verificación:* devuelve `{ count, rows }` ordenado por `sortOrder`; un evento desactivado desaparece del listado; una notificación inactiva devuelve 404 para USER.

8. **`ESAVI-NOTIFEVT-002B` — listar todos por notificación.** Servicio con `paranoid: false`, ruta `GET /admin/notification/:id` con `validateUserRole(ADMIN)`.
   *Verificación:* el mismo listado del paso anterior incluye el evento desactivado; un USER recibe 403.

9. **`ESAVI-NOTIFEVT-003` — obtener por ID.** Servicio con la visibilidad heredada de §3.5, ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* `GET /api/notification-events/activate/algo` responde 400 de UUID y no 404 de evento; un evento cuya notificación está inactiva devuelve 404 para ADMIN y 200 para SUPERADMIN.

10. **`ESAVI-NOTIFEVT-006` — listar los eventos de un caso.** Servicio que salta `caso → notificación → eventos`, ruta `GET /case/:caseId`.
    *Verificación:* un caso sin notificación devuelve 404; un caso con notificación y tres eventos devuelve los tres ordenados.

11. **`ESAVI-NOTIFEVT-004` — actualizar.** `buildDifferentialUpdate` con la tabla de `candidates` de §3.5 y la resolución condicionada al cambio de `esaviCode`. Ruta `PUT /:id`.
    *Verificación:* un `PUT` que reenvía la respuesta del `GET` responde 200 sin escribir; cambiar solo `notes` no consulta `diagnosticTerm`; cambiar `esaviCode` a un código nuevo acuña el término y actualiza los tres derivados en una sola entrada de `appDetails`.

12. **`ESAVI-NOTIFEVT-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, ruta `DELETE /:id`.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409.

13. **`ESAVI-NOTIFEVT-005B` — reactivar.** Los cuatro pasos de §3.5, en transacción propia. Ruta `PATCH /activate/:id`.
    *Verificación:* el escenario del hallazgo `C` —crear tres eventos, desactivar el tercero, crear un cuarto que recibe el `sortOrder` 3, reactivar el tercero— responde **200** y deja el reactivado con `sortOrder: 4`; reactivar un evento sin colisión **no** mueve su `sortOrder`; reactivar uno ya activo devuelve 409.

14. **`ESAVI-NOTIFEVT-005C` — borrado físico.** `purgeEntityService` sin modificarlo, ruta `DELETE /purge/:id` declarada antes de `/:id`.
    *Verificación:* purgar un evento activo devuelve 409; purgar uno desactivado con su notificación **activa** devuelve 200 y deja una línea `warn` con el volcado; `grep -n "purgeEntityService" src/services/common/entityPurge.service.ts` muestra el archivo sin cambios respecto a `main`.

15. **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`.** En `src/services/notification.service.ts`, antes del `destroy` de la notificación, una sola línea `warn` con el conteo y la lista de `eventId` que la cascada va a arrastrar. Es el único punto de este spec que toca un servicio ajeno.
    *Verificación:* purgar una notificación con cuatro eventos deja **una** línea con los cuatro `eventId`; purgar una sin eventos no deja línea alguna.

16. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **126 a 135** en la aserción de longitud de `tests/auth/roles.test.ts`.
    *Verificación:* `npm test -- roles` en 0.

17. **Suite `tests/contract/notificationEvent.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar por notificación → listar admin → listar por caso → actualizar → desactivar → reactivar → purgar. Más los caminos de error: 404 de notificación inactiva, 404 de caso inexistente, 404 de término externo inexistente, los tres 400 de coherencia del evento «otro», 409 de purga sobre fila activa, y los cinco casos de update diferencial de §5. Bloque aparte para el escenario de colisión de `sortOrder` del paso 13 y para las tres ramas de resolución del paso 6.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las nueve operaciones.
- [ ] `grep -rn "ESAVI-NOTIFEVT-002[^AB]" src/` no devuelve resultados.
- [ ] `references/CONVENTIONS.md` §6 contiene la fila `notificationEvent | NOTIFEVT` y la fila de `ESAVI-NOTIFEVT-006`.
- [ ] `ROUTE_RULES` tiene 135 filas y la aserción de longitud de `tests/auth/roles.test.ts` espera ese número.

**Resolución contra el catálogo clínico:**

- [ ] Crear con `esaviCode: "  fiebre alta  "` inexistente y sin `source` deja en `diagnosticTerm` una fila con `source: 'LOCAL'`, `code: 'FIEBRE_ALTA'` y `metadata.autoCreated: true`.
- [ ] Crear con `source: 'MEDDRA'` y un `esaviCode` inexistente responde **404** y **no** crea fila en `diagnosticTerm`.
- [ ] Crear con `esaviName: "dolor de cabeza"` sobre un término cuyo nombre guardado es `Cefalea` deja `esaviName: 'Cefalea'` y `esaviRawName: 'dolor de cabeza'`.
- [ ] Crear con un `esaviName` idéntico al del maestro deja `esaviRawName: null`.
- [ ] Crear sin `esaviCode` deja `diagnosticTermId: null` y `esaviName` con el texto enviado.
- [ ] `grep -n "source" src/services/common/diagnosticTermResolution.service.ts` muestra el archivo sin cambios respecto a `main`.

**Orden y estado:**

- [ ] Tres altas seguidas sobre la misma notificación reciben `sortOrder` 1, 2 y 3 sin que ningún servicio envíe el campo.
- [ ] `grep -n "sortOrder" src/types/notificationEvent/notificationEvent.types.ts` no devuelve **ningún campo** — solo la línea de comentario que razona su ausencia, que es deliberada y no incumple el criterio.
- [ ] Un `PUT` con `sortOrder: 99` en el body responde 200 y deja el `sortOrder` guardado intacto, sin 400.
- [ ] **Escenario de colisión:** crear tres eventos, desactivar el tercero, crear un cuarto —que recibe `sortOrder: 3`—, y reactivar el tercero responde **200** y lo deja con `sortOrder: 4`.
- [ ] Reactivar un evento cuyo `sortOrder` sigue libre responde 200 y **no** mueve el `sortOrder`.
- [ ] Purgar un evento desactivado cuya notificación está **activa** responde 200.
- [ ] Purgar un evento activo responde **409**.
- [ ] `git diff --stat src/services/common/entityPurge.service.ts src/services/common/entityActivation.service.ts` no muestra cambios.

**Visibilidad heredada:**

- [ ] Un evento cuya notificación está inactiva responde 404 en `003` para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] Crear un evento sobre una notificación inactiva responde 404.
- [ ] `GET /api/notification-events/activate/algo` responde 400 de UUID, no 404 de evento.

**Coherencia del evento «otro»:**

- [ ] `isOtherEsavi: true` sin `otherDescription` responde 400.
- [ ] `isOtherEsavi: true` junto a un `esaviCode` responde 400.
- [ ] `isOtherEsavi: false` con `otherDescription` responde 400.
- [ ] Un `PUT` que solo envía `otherDescription` sobre una fila con `isOtherEsavi: false` responde 400 — la regla se evalúa sobre el estado resultante, no sobre el body.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/notificationEvent.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

Sobre el último: en esta entidad **no hay `code` propio ni 409 de duplicado**, así que el ítem se cumple por su primera mitad — un `PUT` con `source: 'MEDDRA'` y un `esaviCode` inexistente responde **404** aunque ningún otro campo cambie. La segunda mitad no aplica y se anota como tal, no se borra.

- [ ] Un `PUT` que reenvía el `esaviCode` guardado **no consulta ni escribe** `diagnosticTerm`.
- [ ] Un `PUT` que solo cambia `notes` deja `diagnosticTermId`, `esaviName` y `esaviRawName` idénticos.

**Cierre:**

- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] Purgar una notificación con cuatro eventos deja **una** línea `warn` con los cuatro `eventId`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Superficie y numeración**

- **Sí:** `NOTIFEVT`, ocho letras. `EVENT` se descartó por genérico: el dominio de investigación tiene sus propios eventos y la abreviatura dejaría de identificar una entidad.
- **Sí:** ocho operaciones canónicas. Es la primera satélite con `isActive`, así que `005A` y `005B` tienen sentido —un evento se retira sin mover la notificación— y `005C` está habilitada por la regla objetiva de §6: la tabla no figura en `preventPhysicalDelete`.
- **Sí:** listado por FK, `/notification/:id`, nunca `/`. Un evento no existe sin su notificación, y un listado global de eventos no tiene lector. Es la forma de `HFAC` con `/location/:id`.
- **Sí:** `002A` y `002B` como dos rutas distintas, cada una con su letra en los cinco lugares. La alternativa —un `GET` bifurcado por rol— habría dejado el código sin letra en ruta y controlador, y aquí las dos rutas difieren también en el rol mínimo.
- **Sí:** el `006` con ruta HTTP, al contrario que el `006` de `DIAGTERM`. Es una lectura, no una escritura: no abre ninguna puerta que el `002A` no tenga ya abierta.
- **No:** una variante admin del `006`. Devuelve el `notificationId`, que es la entrada al `002B`. Duplicar la ruta para ahorrar un salto no compensa la fila extra en `ROUTE_RULES` y el código nuevo.

**`sortOrder`**

- **Sí:** `sortOrder` inmutable y asignado por la base. El trigger ya resuelve la concurrencia con `pg_advisory_xact_lock`; replicar esa lógica en la aplicación sería competir con ella.
- **Sí:** dejarlo fuera del tipo de entrada, no solo ignorarlo en el servicio. Es la garantía más barata de que ningún `create` futuro lo mande por descuido.
- **No:** admitirlo en el `001` y en el `004` traduciendo la violación del índice a un 409. Convierte un detalle de presentación en un error que el cliente tiene que entender y resolver.
- **No:** reordenamiento en cascada dentro de este spec. Necesita transacción sobre N filas y una decisión sobre si el orden es denso o disperso. Queda declarado como `007` en otro spec, con nombre, para que no se cuele durante la implementación.
- **Sí:** reasignar el `sortOrder` al reactivar cuando el número ya está tomado. Reactivar es el deshacer de una desactivación y no debe poder fallar por una restricción que el usuario no provocó ni puede ver. El evento vuelve al final de la lista, que es una consecuencia visible y explicable.
- **No:** devolver 409 en el `005B` colisionado. Obligaría a purgar o reordenar otro evento para poder deshacer una acción propia, y el orden es de presentación, no de identidad.
- **No:** reasignar siempre, colisione o no. Movería de sitio eventos que nadie pidió mover.
- **Sí:** reasignar **antes** de limpiar `deletedAt`. No es preferencia de estilo: el índice único parcial no es diferible, así que el orden inverso falla en el propio `UPDATE` del helper y no hay forma de corregir después. Verificado leyendo `esaviapp.sql:1326-1328` junto a `entityActivation.service.ts:34`.

**Resolución contra el catálogo clínico**

- **Sí:** `source` en el body del `001` y del `004`, con creación implícita **solo** en `LOCAL`. Es lo que el funcional necesita sin contradecir a F15: un cliente sigue sin poder afirmar que un término pertenece a MedDRA o WHODrug.
- **No:** ampliar `ResolveDiagnosticTermInput` con `source`. Revertiría una decisión razonada de F15 §6 y obligaría a reabrir aquel spec por una necesidad que se resuelve con una consulta local de cuatro líneas.
- **No:** aceptar `diagnosticTermId` directo del cliente. Sería una segunda puerta para apuntar a un término, y con ella la pregunta de qué gana cuando llegan los dos.
- **Sí:** `esaviName` derivado del maestro cuando hay término, con la divergencia en `esaviRawName`. Es el contrato que `diagnosticTermResolution.service.ts:36` dejó escrito antes de que existiera un consumidor.
- **Sí:** la resolución se dispara por cambio de `esaviCode`, no por su presencia. Sin esto, cada `PUT` que reenvía el `GET` consultaría el maestro, y un `PUT` que solo corrige una nota tocaría el catálogo clínico.
- **Sí:** la búsqueda con `source` externo no filtra por `isActive`. Un término retirado sigue siendo referenciable, por la misma razón que el resolver de F15 tampoco lo filtra: reactivarlo desde una notificación desharía en silencio la decisión de un administrador.

**Estado y visibilidad**

- **Sí:** sin arrastre desde la cabecera. La visibilidad heredada ya oculta los eventos de una notificación inactiva, y sellar N filas para conseguir lo mismo añade dos funciones de cascada, dos suites tocadas y un camino de reversión. Si el sellado se necesita después, es un spec que lo razone.
- **No:** copiar el arrastre de F13 y F14. Su premisa —«las satélites no gestionan su propio estado», `notification.service.ts:419`— no se cumple aquí: ésta sí lo gestiona.
- **Sí:** `005C` sin mirar el estado de la notificación. Es el caso de uso que motiva la operación: un evento mal digitado se corrige retirándolo y purgándolo, sin desactivar la notificación entera. La red de seguridad sigue siendo la canónica —dos pasos deliberados sobre la propia fila— y ésa no se toca.
- **Sí:** una sola línea `warn` con conteo y `eventId` en la cascada de purga de la cabecera. Volcar N filas completas convierte un aviso en ruido; volcar nada deja una destrucción sin rastro. Los `eventId` bastan para cruzar con la auditoría previa.
- **No:** ninguna regla sobre `isMainEsavi`. El DDL no la impone y el funcional no la ha pedido. Inventarla ahora obligaría a escribir sobre filas hermanas —desmarcar la anterior— por una suposición sobre cómo es el formulario.

**Respuesta y modelo**

- **Sí:** incluir `diagnosticTerm` en la respuesta, sin `metadata`. Los marcadores `autoCreated` y `reviewStatus` son gobernanza del catálogo, no dato de la notificación, y exponerlos invitaría a que un cliente los interpretara.
- **No:** incluir `notification` en la respuesta, aunque toda lectura la consulte. Se resuelve con dos atributos y se descarta; quien necesite la cabecera entra por `ESAVI-NOTIFCN-003`.
- **No:** el inverso `hasMany` desde `DiagnosticTerm`. Nadie lo necesita, y declararlo invitaría a incluir eventos en las respuestas del catálogo.
- **Sí:** `isMainEsavi` e `isOtherEsavi` como booleanos estrictos, no tri-estado. El DDL los declara `NOT NULL`; tratarlos como los `verified*` de F14 sería copiar un patrón que aquí no aplica.
- **Sí:** `startDate` y `startTime` en columnas separadas, sin juntarlas. Son dos preguntas distintas del formulario y la hora se desconoce con frecuencia.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El `005B` se implementa delegando sin más en `setEntityActiveStatusService` y el escenario de colisión produce 500 | El escenario está escrito paso a paso en el plan (§4, paso 13) y como criterio de aceptación con los cuatro movimientos literales |
| Alguien invierte los pasos 3 y 4 del `005B` porque «da igual el orden» | §3.5 y §6 dicen por qué no da igual, con la línea del índice y la del helper |
| El `004` resuelve el término en cada `PUT` y acaba escribiendo en el catálogo clínico al reenviar el `GET` | Dos criterios de aceptación explícitos, y la tabla de `candidates` que separa `esaviCode` (comparado) de los tres derivados |
| Un `005A` libera un `sortOrder` que otro evento reutiliza, y el listado deja un hueco visible | Es el comportamiento declarado del trigger, no un defecto. El orden es de presentación y el `007` de reordenamiento existe para cuando moleste |
| `GET /:id` captura `/case`, `/admin`, `/purge` o `/activate` como UUID | Las cinco literales se declaran antes que `/:id`, en el orden exacto de §3.4; cubierto por la suite de contrato |
| La cascada de `ESAVI-NOTIFCN-005C` destruye eventos sin rastro individual | Línea `warn` con conteo y `eventId` antes del `destroy` (§4, paso 15) |
| Dos altas concurrentes sobre la misma notificación reciben el mismo `sortOrder` | Lo resuelve `pg_advisory_xact_lock` dentro del trigger (`esaviapp.sql:180`); la aplicación no interviene |

**§8 no aplica.** Este spec solo añade endpoints nuevos y una línea de log en un servicio existente. Ningún status, campo ni mensaje que los clientes ya reciben cambia de forma.

---

## Lo que **no** está en este spec

- **Reordenar eventos** — el `007` que mueva un evento de posición y desplace a sus hermanas.
- **Cualquier regla sobre `isMainEsavi`**, incluido el «como máximo uno por notificación».
- **Arrastre de estado desde la cabecera** — desactivar una notificación no toca el `isActive` ni el `deletedAt` de sus eventos.
- **Filtros de listado** por `isMainEsavi`, `diagnosticTermId`, `startDate` o texto sobre `esaviName`.
- **Ampliar `ResolveDiagnosticTermInput` con `source`** — el `006` de F15 sigue forzando `LOCAL`.
- **Recodificar eventos ya guardados** cuando un término del maestro cambia de nombre.
- **Las otras cinco satélites de `notification`:** `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- **Modificar `esaviapp.sql`**, `purgeEntityService` o `setEntityActiveStatusService`.
- Cifrado de ningún campo.
- Crear eventos automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
