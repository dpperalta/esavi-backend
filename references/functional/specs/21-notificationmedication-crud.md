# SPEC F21 — CRUD de `notificationMedication`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F10 (`notification` — dependencia dura de modelo: es el padre de la FK y la fuente de la visibilidad heredada)**, **SPEC F16 (`notificationEvent` — dependencia dura de precedente: aporta la solución verificada al choque entre el trigger de `sortOrder` y la reactivación, que aquí se reproduce idéntica)**, SPEC F14 (`nonSevereNotification` — aporta el patrón de validación de un `catalogItem` contra su `catalogType`), SPEC F06 (`esaviCase` — el `006` entra por el `caseId`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa)
> **Fecha:** 2026-08-16
> **Objetivo:** Dar de alta `notificationMedication` —los medicamentos que el paciente tomaba cuando ocurrió el evento— como la cuarta tabla satélite de `notification`, replicando la forma que `notificationEvent` dejó probada y añadiendo la validación de dos catálogos.

---

## 1. Por qué existe este spec

`notificationMedication` es la **cuarta de las ocho tablas satélite de `notification`** que recibe implementación. El [SPEC F10](./10-notification-header-crud.md) las dejó fuera de alcance en bloque; [F13](./13-severenotification-crud.md) y [F14](./14-nonseverenotification-crud.md) entregaron las dos ramas del detalle —uno a uno, sin estado propio, sin orden—; [F16](./16-notificationevent-crud.md) entregó la primera uno a muchos con estado y orden propios. Ésta es la **segunda de esa última familia**, y ese parentesco es lo que gobierna el spec entero.

Guarda **la medicación concomitante**: qué tomaba el paciente cuando apareció el evento adverso, en qué forma farmacéutica, por qué vía y desde cuándo. Es información de contexto clínico, no la causa declarada del ESAVI —eso lo guarda `notificationEvent`— y por eso no depende del `notificationType`: la medicación se pregunta igual sea la notificación grave o no grave. Una notificación puede acumular muchas filas o ninguna.

Hoy la tabla existe en `esaviapp.sql:814-835` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**A — Es una copia estructural de `notificationEvent`, y eso es deliberado.** PK propia con `gen_random_uuid()` (`:815`), `notificationId` `NOT NULL` con `ON DELETE CASCADE` (`:816`, `:832`), `sortOrder` gobernado por trigger (`:817`, `:1310`), `isActive` con las seis transversales completas (`:826-831`), y ausencia de `preventPhysicalDelete` (`esaviapp.sql:1358-1375`) que habilita el `005C`. De ahí salen las **mismas nueve operaciones** de F16, con los mismos roles y la misma forma de ruta. Un spec que se inventara aquí una superficie distinta obligaría a leer dos patrones donde el esquema declara uno.

**B — Hereda el hallazgo del `005B`, sin variación.** F16 §1.C documentó que el trigger `setSortOrderByParent` es `BEFORE INSERT` **solamente** (`esaviapp.sql:1322`) y calcula `COALESCE(MAX("sortOrder"), 0) + 1 ... WHERE "deletedAt" IS NULL` (`:183`); que el índice único parcial `UQ_notificationMedication_parent_sortOrder` (`:1334-1336`) se condiciona también a `deletedAt IS NULL`; y que `setEntityActiveStatusService:34` reactiva limpiando `deletedAt`. Las tres piezas producen el mismo choque: medicamentos 1, 2 y 3; se desactiva el 3; se crea uno nuevo que recibe el 3; se reactiva el antiguo → **500** por violación de restricción. Este spec **no vuelve a razonar el problema**: adopta la solución de F16 —reasignar `sortOrder` a `MAX+1` antes de tocar `deletedAt`— y la declara con el mismo detalle, porque es la única operación que no delega limpiamente.

**C — Es la primera entidad con dos FK a `catalogItem` sin trigger que las valide.** `pharmaceuticalFormItemId` (`:821`) y `administrationRouteItemId` (`:822`) apuntan a `catalogItem` con `ON DELETE RESTRICT`, y **nada en la base comprueba que apunten al catálogo correcto**: el único `validateCatalogItemType` del DDL es el de `healthFacility` (`:473`). Sin guarda en el servicio, cualquier UUID de `catalogItem` válido —un tipo de establecimiento, un sexo— entraría como forma farmacéutica. La guarda es la de F14 (`nonSevereNotification.service.ts:191-209`): el ítem existe, está activo y su `catalogType` tiene el `code` esperado. Los dos catálogos ya vienen sembrados en `esaviapp.sql:1590-1593`, así que no hay precondición de despliegue.

**D — Le falta el índice sobre la FK, y este spec lo añade.** `notificationEvent` declara `IX_notificationEvent_notification` (`:812`); `notificationMedication` no declara ninguno, y sin embargo sus dos listados y el `006` entran exactamente por `notificationId`. Es la **única razón por la que este spec toca `esaviapp.sql`**, y lo hace con una línea idempotente `CREATE INDEX IF NOT EXISTS` junto a la tabla. El fichero es la DDL autoritativa y `tests/setup/database.ts:9` lo carga entero para construir la base de pruebas, así que el índice se verifica solo.

**Y lo que no comparte con F16.** No hay resolución contra ningún maestro: `medicationCode` es texto libre, sin vademécum detrás y sin FK que lo respalde. Eso simplifica el `001` y el `004` —no hay transacción envolviendo una acuñación, ni campos derivados— y deja el update diferencial como el caso limpio de F12: doce candidatos, todos comparados contra lo guardado, ninguno calculado.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notificationMedication`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones canónicas más una no canónica:** `001` crear, `002A` listar activos por notificación, `002B` listar todos por notificación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar, `005C` borrado físico, y `006` listar los medicamentos de un caso. Alta de la fila de `006` en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Relación uno a muchos con `notification`.** No hay límite de medicamentos por notificación ni `UNIQUE` que lo imponga. Los listados se entran por la FK —`/notification/:id`— y nunca por `/`.
- **Guarda única del alta:** la notificación existe y está **activa** → 404 `NOTIFMED_001_NOTIFICATION_NOT_FOUND`. **Ninguna guarda por `notificationType`:** la medicación concomitante se registra igual sea la notificación grave o no grave.
- **Validación de los dos catálogos en el `001` y en el `004`**, con el patrón de `assertVaccinationSiteIsValid` (`nonSevereNotification.service.ts:191`):
  - `pharmaceuticalFormItemId` debe existir, estar **activo** y pertenecer al `catalogType` con `code: 'pharmaceuticalForm'` → 404 `NOTIFMED_<op>_PHARMACEUTICAL_FORM_NOT_FOUND`.
  - `administrationRouteItemId` debe existir, estar **activo** y pertenecer al `catalogType` con `code: 'administrationRoute'` → 404 `NOTIFMED_<op>_ADMINISTRATION_ROUTE_NOT_FOUND`.
  - Las dos son **opcionales**: ausentes o `null`, no se valida nada.
  - La validación corre **antes del diff y con independencia de él**: un `PUT` con una forma farmacéutica inactiva responde 404 aunque ningún otro campo cambie.
  - **En lectura no se filtra por `isActive`.** Un ítem retirado después del registro sigue viajando en la respuesta: la fila es histórica y dice con qué forma y por qué vía se administró.
- **Índice nuevo en `esaviapp.sql`:** `CREATE INDEX IF NOT EXISTS "IX_notificationMedication_notification" ON "notificationMedication" ("notificationId");`, declarado inmediatamente después de la tabla, espejo de `:812`. Es el **único** cambio de este spec sobre el DDL.
- **`sortOrder` inmutable y asignado por la base.** El `001` nunca lo envía. El `004` lo ignora en silencio, sin 400. No aparece en el tipo de entrada.
- **Reasignación de `sortOrder` en `ESAVI-NOTIFMED-005B`** cuando el número que ocupaba la fila ya lo tomó otro medicamento vivo de la misma notificación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación **no** delega sin más en `setEntityActiveStatusService`. La solución es la de F16, verificada allí.
- **Regla de coherencia del medicamento «otro»**, evaluada en el servicio sobre el **estado resultante** en el `004`, nunca sobre el body: con `isOtherMedication: true`, `otherMedicationText` es obligatorio → 400; con `false`, enviarlo → 400. **`medicationCode` queda libre en ambos casos** — sin maestro detrás, prohibirlo sería una regla que el DDL no insinúa.
- **Visibilidad heredada de la cabecera.** Toda lectura incluye `notification` y comprueba su `isActive`: si la notificación está inactiva, sus medicamentos responden **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Aplica a `002A`, `002B`, `003` y `006`.
- **`005C` sin mirar al padre.** La guarda es la canónica de §6 sobre la **propia fila**, que `purgeEntityService` (`src/services/common/entityPurge.service.ts:31`) ya aplica sin modificación alguna.
- **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`:** **una sola línea** en nivel `warn` con el conteo y la lista de `medicationId` arrastrados, junto a la que F16 ya dejó para los eventos. Implica tocar `src/services/notification.service.ts` solo en ese punto.
- **Normalización al escribir:** `toTitleCase` sobre `medicationName`; **solo `trim()`** sobre `medicationCode`, `dose` y `otherMedicationText`. La desviación de `medicationCode` respecto a §11 se razona en §6.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` de §3.5: `notificationId` y `sortOrder` inmutables, ocho campos comparados, **ninguno derivado**.
- Alta de la abreviatura **`NOTIFMED`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **144 a 153**— y suite `tests/contract/notificationMedication.test.ts`.

**Precondiciones de datos** (no son parte de la implementación):

- Los catálogos `pharmaceuticalForm` y `administrationRoute` están sembrados por el propio `esaviapp.sql:1590-1593`. Si una base desplegada los hubiera perdido, **toda** escritura con esas dos FK caería en 404 — es la misma dependencia que F14 declaró para `vaccinationSite`, y se resuelve reejecutando los `CALL "upsertCatalogItem"`, que son idempotentes.

**Fuera de alcance (otros specs):**

- **Las otras cuatro satélites de `notification`:** `notificationVaccine` (`esaviapp.sql:837-861`), `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- **Reordenar medicamentos** — el `007` que mueva una fila de posición y desplace a sus hermanas. Es la misma operación que F16 dejó pendiente para los eventos, y cuando se escriba debe cubrir las dos entidades a la vez.
- **Cualquier vínculo entre `medicationCode` y un maestro de fármacos.** No hay vademécum en el esquema, la columna es `varchar(250)` libre y ninguna FK la respalda. Si algún día se quiere resolver contra un catálogo —al estilo de `ESAVI-DIAGTERM-006`—, es un spec que primero cree ese maestro.
- **Arrastre de estado desde la cabecera.** Desactivar una notificación **no** toca el `isActive` ni el `deletedAt` de sus medicamentos. La visibilidad heredada ya los oculta.
- **Cualquier filtro de listado** por `isOtherMedication`, `pharmaceuticalFormItemId`, `administrationRouteItemId`, `startDate` o texto sobre `medicationName`. Los dos listados devuelven todos los medicamentos de su notificación, paginados y ordenados por `sortOrder`.
- **Cualquier comprobación de duplicados.** El mismo `medicationName` puede repetirse en la misma notificación: dos filas del mismo fármaco con dosis o vía distintas son un registro legítimo.
- **Cualquier regla que cruce `startDate` con la fecha de vacunación o la del evento.** El DDL no la impone y el funcional no la ha pedido.
- **Modificar `esaviapp.sql` más allá del índice de §2**: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`, ni los `CALL "upsertCatalogItem"`.
- **Modificar `purgeEntityService` ni `setEntityActiveStatusService`.** Sirven tal cual.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII del paciente.
- Crear medicamentos automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notificationMedication` — `esaviapp.sql:814-835`. **Se altera en un solo punto:** se le añade el índice sobre la FK que hoy no tiene.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `medicationId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` |
| `notificationId` | `uuid` | no | `FK_notificationMedication_notification` → `notification`, `ON DELETE CASCADE`. **Sin índice hoy** |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)`. Lo asigna el trigger; la aplicación no lo envía |
| `medicationName` | `varchar(250)` | no | **La única columna de datos obligatoria** |
| `medicationCode` | `varchar(250)` | sí | Texto libre, **sin maestro ni FK detrás** |
| `dose` | `varchar(100)` | sí | Texto libre: `'500 mg cada 8 h'` es un valor válido |
| `pharmaceuticalFormItemId` | `uuid` | sí | `FK_notificationMedication_form` → `catalogItem`, `ON DELETE RESTRICT` |
| `administrationRouteItemId` | `uuid` | sí | `FK_notificationMedication_route` → `catalogItem`, `ON DELETE RESTRICT` |
| `startDate` | `date` | sí | Fecha de inicio de la toma |
| `isOtherMedication` | `boolean` | no | `DEFAULT false`. Gobierna la regla de coherencia |
| `otherMedicationText` | `text` | sí | Solo con `isOtherMedication: true` |

**Ocho columnas de datos: una obligatoria, una booleana no nula con defecto, y seis anulables.** Es la satélite más pequeña de las implementadas hasta ahora.

**Restricciones.** Tres claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla** — la única unicidad de negocio vive fuera, en el índice parcial `UQ_notificationMedication_parent_sortOrder` (`:1334-1336`) sobre `("notificationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `B` de §1.

Las dos FK a `catalogItem` son `ON DELETE RESTRICT`, así que un medicamento impide borrar físicamente su forma o su vía — irrelevante en la práctica, porque `catalogItem` figura en `preventPhysicalDelete` (`esaviapp.sql:1362-1367`) y no tiene `005C`.

**El índice que se añade.** Una línea idempotente inmediatamente después del `CREATE TABLE`, espejo exacto de `IX_notificationEvent_notification` (`:812`):

```sql
CREATE INDEX IF NOT EXISTS "IX_notificationMedication_notification" ON "notificationMedication" ("notificationId");
```

No es cosmética: los dos listados y el `006` filtran exclusivamente por `notificationId`, y sin índice cada uno recorre la tabla entera. El `IF NOT EXISTS` la hace reejecutable sobre una base ya desplegada, y `tests/setup/database.ts:9` carga el fichero completo al construir la base de pruebas, así que la verificación es automática.

**El `startDate` sin hora.** A diferencia de `notificationEvent`, que parte fecha y hora en dos columnas, aquí solo hay `date`: cuándo empezó a tomarse un medicamento es una fecha, no un instante. No hay `startTime` que normalizar, y por tanto **no aplica la nota de `normalizeTime`** que F16 §3.5 necesitó.

**Las columnas transversales.** Están las seis: `isActive` (`:826`), `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`.

**Triggers.** Dos, los dos de bucle genérico. `TRG_notificationMedication_setSysDetails` (`:1279-1294`). Y `TRG_notificationMedication_setSortOrder` (`:1301-1328`, registrado en `:1310`), que ejecuta `setSortOrderByParent('notificationId')` **solo `BEFORE INSERT`** (`:1322`): respeta un `sortOrder` recibido si es mayor que 0 (`:169-171`) y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre (`:182-188`), bajo `pg_advisory_xact_lock` (`:180`). **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `esaviapp.sql:1358-1375`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationMedication.model.ts`. Clase `NotificationMedication`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationMedication'`.

`medicationId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `notificationId` va `DataTypes.UUID` con `allowNull: false`; las dos FK de catálogo, `DataTypes.UUID` con `allowNull: true`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, exactamente como F16 §3.2. Declararle `defaultValue: 0` haría que el `INSERT` mandara `0` explícito —el valor que el trigger interpreta como «asígnamelo tú» (`:169`)—, que funcionaría por accidente.

> **Nota de implementación.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere en la aplicación con `notNull Violation: NotificationMedication.sortOrder cannot be null` y el trigger nunca llega a ejecutarse. Lo que deja la columna fuera de la sentencia es pasar la lista explícita al `create` — `NotificationMedication.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y sin `sortOrder` ni `medicationId`. Es el mismo remedio que F16 verificó; no se re-descubre.

Longitudes explícitas, para que un texto largo falle en Sequelize y no en Postgres: `medicationName` `DataTypes.STRING(250)` con `allowNull: false`; `medicationCode` `DataTypes.STRING(250)`; `dose` `DataTypes.STRING(100)`; `otherMedicationText` `DataTypes.TEXT`.

`isOtherMedication` va `DataTypes.BOOLEAN` con `allowNull: false` y `defaultValue: false`. **No es tri-estado**: el DDL lo declara `NOT NULL`, así que `null` no es un valor posible y la comparación en el diff nunca es por veracidad.

`startDate` va `DataTypes.DATEONLY` — el helper de diff ya compara `DATEONLY` con `slice(0, 10)`.

Asociaciones, en `src/models/associations/notificationMedication.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationMedication.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasMany(NotificationMedication, { as: 'medications', foreignKey: 'notificationId' })`
- `NotificationMedication.belongsTo(CatalogItem, { as: 'pharmaceuticalForm', foreignKey: 'pharmaceuticalFormItemId' })`
- `NotificationMedication.belongsTo(CatalogItem, { as: 'administrationRoute', foreignKey: 'administrationRouteItemId' })`

El `hasMany` **sí** se declara: lo necesitan el `006`, la visibilidad heredada y el volcado al log de la cascada de purga. **Ningún inverso `hasMany` desde `CatalogItem`**: nadie lo necesita y declararlo invitaría a incluir medicamentos en las respuestas del catálogo, cuyo contrato no cambia. Alta en `src/models/index.ts`.

### 3.3 Tipos

Ruta: `src/types/notificationMedication/notificationMedication.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts`.

```ts
export interface CreateNotificationMedicationInput {
    notificationId: string;
    medicationName: string;
    medicationCode?: string | null;
    dose?: string | null;
    pharmaceuticalFormItemId?: string | null;
    administrationRouteItemId?: string | null;
    startDate?: string | null;
    isOtherMedication?: boolean;
    otherMedicationText?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationMedicationInput>`. **No se declara `UpdateNotificationMedicationInput`** — prohibido por §4 de las convenciones.

Una sola ausencia deliberada: **`sortOrder` no está**. Es inmutable y lo asigna la base; que no exista en el tipo es la garantía más barata de que ningún servicio lo mande.

**Ningún campo de entrada que no sea columna.** A diferencia de F16, que necesitaba `source` para elegir rama de resolución, aquí las diez claves de entrada son las diez columnas escribibles. La interfaz es plana y no hay nada que descartar antes del `create`.

### 3.4 Superficie HTTP

Ruta base `/api/notification-medications`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-medications                          ESAVI-NOTIFMED-001   ADMIN       (nuevo)
GET    /api/notification-medications/case/:caseId             ESAVI-NOTIFMED-006   USER        (nuevo)
GET    /api/notification-medications/admin/notification/:id   ESAVI-NOTIFMED-002B  ADMIN       (nuevo)
GET    /api/notification-medications/notification/:id         ESAVI-NOTIFMED-002A  USER        (nuevo)
DELETE /api/notification-medications/purge/:id                ESAVI-NOTIFMED-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-medications/activate/:id             ESAVI-NOTIFMED-005B  SUPERADMIN  (nuevo)
GET    /api/notification-medications/:id                      ESAVI-NOTIFMED-003   USER        (nuevo)
PUT    /api/notification-medications/:id                      ESAVI-NOTIFMED-004   ADMIN       (nuevo)
DELETE /api/notification-medications/:id                      ESAVI-NOTIFMED-005A  ADMIN       (nuevo)
```

**Orden de declaración.** Las literales van **antes** de `/:id`, o Express capturaría `case`, `admin`, `notification`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las nueve están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationMedication.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `HFAC` y de `NOTIFEVT`, no la de `GEOTYPE`.

`ESAVI-NOTIFMED-006` **sí tiene ruta**, como el `006` de `NOTIFEVT`. Se registra en la tabla de operaciones no canónicas de §6 como: *«listar los medicamentos de un caso — la cadena `caso → notificación` es uno a uno, pero de la notificación cuelgan N medicamentos»*.

Nueve filas nuevas en `ROUTE_RULES`: de **144** a **153**.

### 3.5 Reglas de negocio por operación

**`ESAVI-NOTIFMED-001` — crear.** En este orden:

1. La notificación existe y está **activa** → 404 `NOTIFMED_001_NOTIFICATION_NOT_FOUND`. Sin comprobar `notificationType`.
2. Coherencia del medicamento «otro», sobre el body: con `isOtherMedication: true`, `otherMedicationText` es obligatorio → 400 `NOTIFMED_001_OTHER_TEXT_REQUIRED`. Con `isOtherMedication: false` o ausente, enviar `otherMedicationText` → 400 `NOTIFMED_001_OTHER_TEXT_NOT_ALLOWED`. **`medicationCode` no participa en la regla.**
3. Validación de catálogos, solo para las FK presentes y no nulas:
   - `pharmaceuticalFormItemId` → `CatalogItem.findOne({ where: { catalogItemId, isActive: true }, include: [{ model: CatalogType, as: 'catalogType', where: { code: 'pharmaceuticalForm' }, attributes: [] }] })`; si no hay fila → 404 `NOTIFMED_001_PHARMACEUTICAL_FORM_NOT_FOUND`.
   - `administrationRouteItemId` → lo mismo contra `code: 'administrationRoute'`; si no hay fila → 404 `NOTIFMED_001_ADMINISTRATION_ROUTE_NOT_FOUND`.
   - Los dos códigos de catálogo se declaran como constantes del servicio, al modo de `VACCINATION_SITE_CATALOG_CODE` (`nonSevereNotification.service.ts:15`).
4. Normalización: `medicationName` con `toTitleCase(trim())`; `medicationCode`, `dose` y `otherMedicationText` con `trim()` a secas.
5. `create` **sin `sortOrder`**, con `fields: CREATE_FIELDS`, para que lo asigne `TRG_notificationMedication_setSortOrder`.
6. Entrada de auditoría en `appDetails` con `method: 'ESAVI-NOTIFMED-001'`.

**No hay transacción propia.** A diferencia de F16, aquí no se escribe en ninguna otra tabla: el `001` es un `create` único, y la transacción implícita de Sequelize basta.

**`ESAVI-NOTIFMED-002A` — listar activos por notificación.** La notificación existe y está activa, salvo `canViewInactive` → 404 `NOTIFMED_002A_NOTIFICATION_NOT_FOUND`. `findAndCountAll` con `where: { notificationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query.

**`ESAVI-NOTIFMED-002B` — listar todos por notificación.** Idéntico, sin el filtro `isActive` y con `paranoid: false`. Rol ADMIN.

**`ESAVI-NOTIFMED-003` — obtener por ID.** Existencia → 404 `NOTIFMED_003_NOT_FOUND`. Incluye `notification`: si la notificación está inactiva y quien pide no cumple `canViewInactive`, **404**. Un medicamento inactivo también es 404 salvo `canViewInactive`.

**`ESAVI-NOTIFMED-006` — listar los medicamentos de un caso.** El caso existe y está activo → 404 `NOTIFMED_006_CASE_NOT_FOUND`. Su notificación existe y está activa → 404 `NOTIFMED_006_NOTIFICATION_NOT_FOUND`. A partir de ahí es el `002A`: solo activos, ordenados por `sortOrder`. La variante admin no se declara — quien necesite ver inactivos entra por `002B` con el `notificationId` que este mismo endpoint devuelve.

**`ESAVI-NOTIFMED-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'NOTIFMED_005A_NOT_FOUND'`, `alreadyInStateCode: 'NOTIFMED_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-NOTIFMED-005A'`. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial. Es correcto y deliberado.

**`ESAVI-NOTIFMED-005B` — reactivar.** **La única operación de este spec que no es una delegación limpia**, por el hallazgo `B` de §1. En transacción propia:

1. `NotificationMedication.findOne({ where: { medicationId: id }, paranoid: false, transaction })`. Si no hay fila, se pasa directo al paso 4 y el helper levanta el 404.
2. Si la fila existe y está inactiva, se busca colisión: otra fila de la **misma** notificación, con el **mismo** `sortOrder`, con `deletedAt: null` y `medicationId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa notificación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que esta escritura es libre. El medicamento reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'NOTIFMED_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-NOTIFMED-005B'`, que limpia `deletedAt` con el `sortOrder` ya corregido.

Si la fila estaba **activa**, el paso 2 no encuentra colisión —el índice garantiza que ninguna otra fila viva comparte su número— así que no se escribe nada y el helper levanta su 409 con normalidad.

El orden de los pasos 3 y 4 es la clave entera: invertirlos hace fallar el índice en el propio `UPDATE` del helper, porque no es una restricción diferible y no hay forma de corregir después. **La reactivación no revalida los catálogos:** una forma farmacéutica desactivada mientras el medicamento estaba retirado no impide devolverlo a la vida, porque el dato es histórico y `005B` no escribe esas columnas.

**`ESAVI-NOTIFMED-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'NOTIFMED_005C_NOT_FOUND'` y `stillActiveCode: 'NOTIFMED_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la notificación.** Sin entrada en `appDetails` —la fila se destruye en la misma transacción— y con el volcado a `warn` que el helper ya escribe.

**`ESAVI-NOTIFMED-004` — actualizar.** Existencia → 404 `NOTIFMED_004_NOT_FOUND`, incluida la visibilidad heredada. Coherencia del medicamento «otro» evaluada sobre el **estado resultante**, no sobre el body → 400. Validación de catálogos **antes del diff y con independencia de él**, solo para las FK que llegan con valor no nulo. `stored` sale de `medication.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `notificationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `medicationName` | `data.medicationName !== undefined ? toTitleCase(data.medicationName.trim()) : undefined` | `NOT NULL`: **normalizado antes de comparar**, nunca a `null` |
| `medicationCode` | `data.medicationCode !== undefined ? (data.medicationCode?.trim() ?? null) : undefined` | anulable; solo `trim()` |
| `dose` | `data.dose !== undefined ? (data.dose?.trim() ?? null) : undefined` | anulable |
| `pharmaceuticalFormItemId` | `data.pharmaceuticalFormItemId !== undefined ? (data.pharmaceuticalFormItemId ?? null) : undefined` | anulable; validada antes del diff |
| `administrationRouteItemId` | `data.administrationRouteItemId !== undefined ? (data.administrationRouteItemId ?? null) : undefined` | anulable; validada antes del diff |
| `startDate` | `data.startDate !== undefined ? (data.startDate ?? null) : undefined` | `DATEONLY`; el helper compara con `slice(0, 10)` |
| `isOtherMedication` | `data.isOtherMedication !== undefined ? data.isOtherMedication : undefined` | `NOT NULL`: nunca por veracidad, nunca a `null` |
| `otherMedicationText` | `data.otherMedicationText !== undefined ? (data.otherMedicationText?.trim() ?? null) : undefined` | anulable |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**Ningún campo es derivado.** Es la diferencia práctica con F16, que arrastraba tres. Aquí los ocho candidatos se comparan contra lo guardado y nada se calcula a partir de otra tabla.

**Escrituras que no son diferenciales, declaradas una a una:**

- **El `001`** — es un `create`.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: este medicamento vuelve a estar vivo y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005C`** — destruye la fila.

**Este spec no escribe en ninguna otra tabla**, ni por cambio de valor ni por presencia de clave. Lo único que toca fuera de `notificationMedication` es una línea de log en la cascada de purga de la cabecera.

### 3.6 Claves i18n nuevas

Bajo `notificationMedication`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationMedication.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente |
| `notificationMedication.idRequired` | 400 del validador de `:id` |
| `notificationMedication.notificationNotFound` | 404 cuando la notificación no existe o está inactiva |
| `notificationMedication.caseNotFound` | 404 del `006` cuando el caso no existe o está inactivo |
| `notificationMedication.pharmaceuticalFormNotFound` | 404 cuando la forma farmacéutica no existe, está inactiva o no pertenece a su catálogo |
| `notificationMedication.administrationRouteNotFound` | 404 cuando la vía de administración no existe, está inactiva o no pertenece a su catálogo |
| `notificationMedication.otherTextRequired` | 400 con `isOtherMedication: true` sin `otherMedicationText` |
| `notificationMedication.otherTextNotAllowed` | 400 con `otherMedicationText` sin `isOtherMedication: true` |
| `notificationMedication.stillActive` | 409 al purgar un medicamento que no fue retirado antes |
| `notificationMedication.createdSuccess` / `createdFailed` | 201 y 500 del `001` |
| `notificationMedication.getSuccess` / `getFailed` | 200 y 500 de `002A`, `002B`, `003` y `006` |
| `notificationMedication.updatedSuccess` / `updatedFailed` | 200 y 500 del `004` |
| `notificationMedication.deletedSuccess` / `deletedFailed` | 200 y 500 del `005A` |
| `notificationMedication.activatedSuccess` / `activatedFailed` | 200 y 500 del `005B` |
| `notificationMedication.alreadyActive` / `alreadyInactive` | 409 de `005B` y `005A` |
| `notificationMedication.purgeSuccess` / `purgeFailed` | 200 y 500 del `005C` |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `003`, `001` y `004`, `data` es la fila con sus dos ítems de catálogo resueltos:

```
{ ok, message, data: {
    medicationId, notificationId, sortOrder,
    medicationName, medicationCode, dose,
    pharmaceuticalFormItemId, administrationRouteItemId,
    startDate, isOtherMedication, otherMedicationText,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    pharmaceuticalForm: { catalogItemId, code, name } | null,
    administrationRoute: { catalogItemId, code, name } | null
} }
```

**Las FK crudas viajan junto a los objetos resueltos.** Es el patrón de F16 y no el de F14 —que las excluye—, por una razón concreta: el `004` acepta esas dos claves en el body, así que un `PUT` que reenvía la respuesta de su `GET` necesita encontrarlas ahí. Excluirlas obligaría al cliente a leer el `catalogItemId` de dentro del objeto anidado para poder reenviarlo, y el criterio de aceptación del update diferencial dejaría de poder escribirse tal cual.

Los dos ítems se incluyen **sin filtrar por `isActive`**: un catálogo retirado después del registro sigue describiendo con qué forma y por qué vía se administró el medicamento. Se devuelven con tres campos, sin `sortOrder` ni `value` ni `catalogTypeId` — quien necesite el catálogo entero entra por `ESAVI-CATITEM-002A`.

**`notification` no se incluye en la respuesta**, aunque toda lectura la consulte para la visibilidad heredada. Se resuelve con `attributes: ['notificationId', 'isActive']` y se descarta al construir el payload: el cliente que necesite la cabecera entra por `ESAVI-NOTIFCN-003`.

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente. `sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `notificationMedication | NOTIFMED` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila de `ESAVI-NOTIFMED-006` a la tabla de operaciones no canónicas. La norma exige registrar **antes** de usar, así que va primero aunque no toque `src/`.
   *Verificación:* las dos tablas de §6 contienen la fila nueva; `NOTIFMED` no aparece dos veces.

2. **Índice sobre la FK en `esaviapp.sql`.** La línea `CREATE INDEX IF NOT EXISTS "IX_notificationMedication_notification" ON "notificationMedication" ("notificationId");` inmediatamente después del `CREATE TABLE` (`:835`), en la misma posición relativa que la de `notificationEvent` en `:812`. Es el único cambio de este spec sobre el DDL y va antes que el modelo, para que la base de pruebas ya lo tenga cuando corra la primera suite.
   *Verificación:* `git diff esaviapp.sql` muestra **una sola línea añadida**; tras recrear la base de pruebas, `SELECT indexname FROM pg_indexes WHERE tablename = 'notificationMedication'` devuelve el índice nuevo junto al `UQ_` parcial.

3. **Modelo y asociaciones.** `src/models/notificationMedication.model.ts` según §3.2, y `src/models/associations/notificationMedication.associations.ts` con las cuatro asociaciones. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` en 0; un `NotificationMedication.findAll({ include: ['notification', 'pharmaceuticalForm', 'administrationRoute'] })` desde el REPL devuelve filas sin error de asociación.

4. **Tipos.** `src/types/notificationMedication/notificationMedication.types.ts` con `CreateNotificationMedicationInput`, más su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateNotificationMedicationInput" src/` no devuelve resultados.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0.

6. **Validadores.** `src/validators/notificationMedication.validator.ts` con el validador de creación, el de actualización, el de `:id`, el de `:caseId` y el del `notificationId` de ruta. Longitudes máximas iguales a las del DDL —250, 250, 100—, `startDate` en formato fecha ISO, las dos FK como UUID opcional y anulable. **`sortOrder` no se declara en ningún validador.** Alta en el barrel de `validators/`.
   *Verificación:* un body con `sortOrder: 5` no produce 400 y el campo se ignora; un `medicationName` de 251 caracteres produce 400; un `pharmaceuticalFormItemId: null` explícito **no** produce 400.

7. **`ESAVI-NOTIFMED-001` — crear.** `createNotificationMedicationService` con los seis pasos de §3.5, incluidas las dos constantes de código de catálogo y el `fields: CREATE_FIELDS` del `create`. Controlador y ruta `POST /`.
   *Verificación:* crear con las dos FK sembradas devuelve 201 con los dos objetos resueltos; crear con un `pharmaceuticalFormItemId` que apunta a un ítem de otro catálogo —por ejemplo uno de `administrationRoute`— devuelve **404**, no 201; tres altas seguidas sobre la misma notificación reciben `sortOrder` 1, 2 y 3 sin que el servicio lo envíe.

8. **`ESAVI-NOTIFMED-002A` — listar activos por notificación.** Servicio, controlador y ruta `GET /notification/:id`, declarada después de `/admin/notification/:id`.
   *Verificación:* devuelve `{ count, rows }` ordenado por `sortOrder`; un medicamento desactivado desaparece del listado; una notificación inactiva devuelve 404 para USER.

9. **`ESAVI-NOTIFMED-002B` — listar todos por notificación.** Servicio con `paranoid: false`, ruta `GET /admin/notification/:id` con `validateUserRole(ADMIN)`.
   *Verificación:* el mismo listado del paso anterior incluye el medicamento desactivado; un USER recibe 403.

10. **`ESAVI-NOTIFMED-003` — obtener por ID.** Servicio con la visibilidad heredada de §3.5, ruta `GET /:id` declarada **después** de todas las literales.
    *Verificación:* `GET /api/notification-medications/activate/algo` responde 400 de UUID y no 404 de medicamento; un medicamento cuya notificación está inactiva devuelve 404 para ADMIN y 200 para SUPERADMIN.

11. **`ESAVI-NOTIFMED-006` — listar los medicamentos de un caso.** Servicio que salta `caso → notificación → medicamentos`, ruta `GET /case/:caseId`.
    *Verificación:* un caso sin notificación devuelve 404; un caso con notificación y tres medicamentos devuelve los tres ordenados.

12. **`ESAVI-NOTIFMED-004` — actualizar.** `buildDifferentialUpdate` con la tabla de `candidates` de §3.5, la validación de catálogos previa al diff y la coherencia del «otro» sobre el estado resultante. Ruta `PUT /:id`.
    *Verificación:* un `PUT` que reenvía la respuesta del `GET` responde 200 sin escribir; un `PUT` con `medicationName: "IBUPROFENO"` sobre un `Ibuprofeno` guardado **no** escribe, porque la normalización corre antes de comparar; un `PUT` con una forma farmacéutica inactiva responde 404 aunque el resto del body sea idéntico.

13. **`ESAVI-NOTIFMED-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, ruta `DELETE /:id`.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409.

14. **`ESAVI-NOTIFMED-005B` — reactivar.** Los cuatro pasos de §3.5, en transacción propia. Ruta `PATCH /activate/:id`.
    *Verificación:* el escenario del hallazgo `B` —crear tres medicamentos, desactivar el tercero, crear un cuarto que recibe el `sortOrder` 3, reactivar el tercero— responde **200** y deja el reactivado con `sortOrder: 4`; reactivar uno sin colisión **no** mueve su `sortOrder`; reactivar uno cuya forma farmacéutica se desactivó entretanto responde **200**; reactivar uno ya activo devuelve 409.

15. **`ESAVI-NOTIFMED-005C` — borrado físico.** `purgeEntityService` sin modificarlo, ruta `DELETE /purge/:id` declarada antes de `/:id`.
    *Verificación:* purgar un medicamento activo devuelve 409; purgar uno desactivado con su notificación **activa** devuelve 200 y deja una línea `warn` con el volcado; `git diff --stat src/services/common/entityPurge.service.ts` no muestra cambios.

16. **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`.** En `src/services/notification.service.ts`, junto a la línea que F16 dejó para los eventos y antes del `destroy` de la notificación, una sola línea `warn` con el conteo y la lista de `medicationId` que la cascada va a arrastrar. Es el único punto de este spec que toca un servicio ajeno.
    *Verificación:* purgar una notificación con cuatro medicamentos deja **una** línea con los cuatro `medicationId`, y sigue dejando la de los eventos; purgar una sin medicamentos no deja línea alguna.

17. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **144 a 153** en la aserción de longitud.
    *Verificación:* `npm test -- roles` en 0.

18. **Suite `tests/contract/notificationMedication.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar por notificación → listar admin → listar por caso → actualizar → desactivar → reactivar → purgar. Más los caminos de error: 404 de notificación inactiva, 404 de caso inexistente, los dos 404 de catálogo cruzado, los dos 400 de coherencia del «otro», 409 de purga sobre fila activa, y los cinco casos de update diferencial de §5. Bloque aparte para el escenario de colisión de `sortOrder` del paso 14.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las nueve operaciones — cuatro en el `005C`, que no escribe auditoría.
- [ ] `grep -rn "ESAVI-NOTIFMED-002[^AB]" src/` no devuelve resultados.
- [ ] `references/CONVENTIONS.md` §6 contiene la fila `notificationMedication | NOTIFMED` y la fila de `ESAVI-NOTIFMED-006`.
- [ ] `ROUTE_RULES` tiene 153 filas y la aserción de longitud de `tests/auth/roles.test.ts` espera ese número.

**Índice y DDL:**

- [ ] `git diff esaviapp.sql` muestra **exactamente una línea añadida**, la del `CREATE INDEX IF NOT EXISTS "IX_notificationMedication_notification"`.
- [ ] Sobre la base de pruebas recreada, `pg_indexes` devuelve `IX_notificationMedication_notification` y `UQ_notificationMedication_parent_sortOrder` para esa tabla.
- [ ] Reejecutar `esaviapp.sql` entero sobre una base ya cargada no falla — el `IF NOT EXISTS` lo hace idempotente.

**Validación de los dos catálogos:**

- [ ] Crear con un `pharmaceuticalFormItemId` que apunta a un `catalogItem` de otro `catalogType` responde **404**, no 201.
- [ ] Crear con un `administrationRouteItemId` que apunta a un ítem **inactivo** de su propio catálogo responde **404**.
- [ ] Crear sin ninguna de las dos FK responde **201** con ambos objetos resueltos en `null`.
- [ ] Un `PUT` con `pharmaceuticalFormItemId: null` explícito borra la FK y devuelve `pharmaceuticalForm: null`.
- [ ] Desactivar el `catalogItem` de una forma farmacéutica **después** del registro no rompe el `GET`: la fila sigue devolviendo el objeto resuelto.
- [ ] `git diff --stat src/services/nonSevereNotification.service.ts` no muestra cambios — el patrón se copia, no se extrae a un helper compartido en este spec.

**Orden y estado:**

- [ ] Tres altas seguidas sobre la misma notificación reciben `sortOrder` 1, 2 y 3 sin que ningún servicio envíe el campo.
- [ ] `grep -n "sortOrder" src/types/notificationMedication/notificationMedication.types.ts` no devuelve **ningún campo**.
- [ ] Un `PUT` con `sortOrder: 99` en el body responde 200 y deja el `sortOrder` guardado intacto, sin 400.
- [ ] **Escenario de colisión:** crear tres medicamentos, desactivar el tercero, crear un cuarto —que recibe `sortOrder: 3`—, y reactivar el tercero responde **200** y lo deja con `sortOrder: 4`.
- [ ] Reactivar un medicamento cuyo `sortOrder` sigue libre responde 200 y **no** mueve el `sortOrder`.
- [ ] Reactivar un medicamento cuya forma farmacéutica se desactivó entretanto responde **200** — el `005B` no revalida catálogos.
- [ ] Purgar un medicamento desactivado cuya notificación está **activa** responde 200.
- [ ] Purgar un medicamento activo responde **409**.
- [ ] `git diff --stat src/services/common/entityPurge.service.ts src/services/common/entityActivation.service.ts` no muestra cambios.

**Visibilidad heredada:**

- [ ] Un medicamento cuya notificación está inactiva responde 404 en `003` para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] Crear un medicamento sobre una notificación inactiva responde 404.
- [ ] `GET /api/notification-medications/activate/algo` responde 400 de UUID, no 404 de medicamento.

**Coherencia del medicamento «otro»:**

- [ ] `isOtherMedication: true` sin `otherMedicationText` responde 400.
- [ ] `isOtherMedication: false` con `otherMedicationText` responde 400.
- [ ] `isOtherMedication: true` **junto a un `medicationCode`** responde **201** — la regla no toca esa columna, y el criterio existe para que nadie copie de F16 la prohibición que allí sí aplicaba.
- [ ] Un `PUT` que solo envía `otherMedicationText` sobre una fila con `isOtherMedication: false` responde 400 — la regla se evalúa sobre el estado resultante, no sobre el body.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/notificationMedication.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

Sobre el último: en esta entidad **no hay `code` propio ni 409 de duplicado** —el `medicationCode` es texto libre y se admiten repetidos—, así que el ítem se cumple por su primera mitad: un `PUT` con un `administrationRouteItemId` inactivo responde **404** aunque ningún otro campo cambie. La segunda mitad no aplica y se anota como tal, no se borra.

- [ ] Un `PUT` con `medicationName: "IBUPROFENO"` sobre un `Ibuprofeno` guardado responde **200 sin escribir** — la normalización corre antes de comparar.
- [ ] Un `PUT` con `medicationCode: "  ABC-123  "` sobre un `ABC-123` guardado responde **200 sin escribir** — el `trim()` también corre antes de comparar, y el guion sobrevive.
- [ ] Un `PUT` que solo cambia `dose` deja las dos FK de catálogo, `medicationName` y `startDate` idénticos.

**Cierre:**

- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] Purgar una notificación con cuatro medicamentos deja **una** línea `warn` con los cuatro `medicationId`, y la de los eventos sigue apareciendo.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Superficie y numeración**

- **Sí:** `NOTIFMED`, ocho letras. `MEDICATION` excede el máximo de §6 y `MED` queda por debajo del mínimo de cuatro; `NOTIFMED` mantiene además el prefijo que ya identifica a la familia de satélites (`NOTIFCN`, `NOTIFEVT`).
- **Sí:** las nueve operaciones de F16, sin variación. La tabla tiene `isActive`, PK propia y no figura en `preventPhysicalDelete`, así que las ocho canónicas se derivan del esquema; el `006` se añade por la misma razón que allí. Inventar aquí una superficie distinta obligaría a leer dos patrones donde el DDL declara uno.
- **Sí:** listado por FK, `/notification/:id`, nunca `/`. Un medicamento no existe sin su notificación, y un listado global no tiene lector.
- **Sí:** el `006` con ruta HTTP. Es una lectura y no abre ninguna puerta que el `002A` no tenga ya abierta.
- **No:** una variante admin del `006`. Devuelve el `notificationId`, que es la entrada al `002B`.

**El índice sobre la FK**

- **Sí:** añadirlo, aunque eso rompa la norma de no tocar `esaviapp.sql`. Los tres endpoints de lectura filtran por `notificationId` y la tabla es la única de su familia que no lo tiene indexado — la omisión es un descuido del DDL, no una decisión. El coste es una línea idempotente y la base de pruebas lo verifica sola.
- **No:** dejarlo fuera de alcance apoyándose en que el índice único parcial `("notificationId", "sortOrder")` ya sirve de prefijo. Es cierto que serviría, pero es un índice **parcial**: solo cubre las filas con `deletedAt IS NULL`, y el `002B` lee precisamente las que no lo cumplen. Confiar en un índice parcial para una consulta que no comparte su predicado es apoyarse en un accidente.
- **No:** abrir un fichero de migraciones para este cambio. El repositorio no tiene ninguno y `esaviapp.sql` es la DDL autoritativa que `tests/setup/database.ts:9` carga entera; introducir un mecanismo nuevo por un índice sería un spec aparte.

**Los dos catálogos**

- **Sí:** validar en el servicio que cada FK pertenece a su `catalogType`. Sin la guarda, cualquier `catalogItem` válido entra como forma farmacéutica, y el `ON DELETE RESTRICT` del DDL no impide nada de eso — solo protege el borrado.
- **No:** añadir un trigger `validateCatalogItemType` al estilo del de `healthFacility` (`esaviapp.sql:473`). Movería la regla a la base para dos columnas, devolvería un 500 en vez de un 404 y ampliaría el único cambio de DDL de este spec de una línea a un bloque.
- **Sí:** exigir `isActive: true` al escribir y **no** filtrar por `isActive` al leer. Es la asimetría que F14 ya razonó: elegir hoy un catálogo retirado es un error, pero haberlo elegido ayer es un hecho. Filtrar en lectura devolvería `null` donde hay dato guardado, y un cliente que reenviara ese `GET` escribiría una disociación que nadie pidió.
- **No:** extraer el patrón de `assertVaccinationSiteIsValid` a un helper compartido. Es tentador con la tercera copia, pero la firma tendría que absorber el código de `AppError`, la clave i18n y el `op`, y el spec pasaría a tocar `nonSevereNotification.service.ts`. Cuando exista la cuarta o quinta copia, el helper merecerá su propio spec de refactor.
- **Sí:** las dos FK opcionales. El DDL las declara anulables y un notificador puede saber qué tomaba el paciente sin saber en qué forma ni por qué vía.

**`medicationCode` y la normalización**

- **Sí:** `toTitleCase` sobre `medicationName`, como manda §11 para nombres.
- **Sí:** solo `trim()` sobre `medicationCode`, desviándose de la regla de §11 que pide `toConstantCase` para códigos. La regla existe para que la unicidad se compare contra un valor canónico, y **aquí no hay unicidad que comparar**: la columna no tiene `UNIQUE`, no tiene FK y no resuelve contra ningún maestro. Aplicar `toConstantCase` solo lograría mutilar la transcripción de un código de vademécum —`ABC-123` pasaría a `ABC_123`— destruyendo el único valor que la columna tiene, que es reproducir lo que el notificador leyó en la caja.
- **No:** validar el formato de `medicationCode` con una expresión regular. No hay estándar que imponer mientras no exista maestro.
- **Sí:** normalizar **antes** de comparar en el diff. Sin eso, un `PUT` que reenvía el `GET` con el nombre en mayúsculas contaría como cambio y dejaría auditoría por un valor que la base almacenaría idéntico — justo lo que F12 combate.

**Coherencia del «otro»**

- **Sí:** la regla se limita a `otherMedicationText`. Es la opción (a) de la ronda de definición.
- **No:** copiar de F16 la prohibición de enviar código junto a `isOther`. Allí tenía sentido porque `esaviCode` es la entrada a un maestro y declarar «otro» significa precisamente que el maestro no lo cubre. Aquí `medicationCode` no entra en ningún maestro: un medicamento no listado en el formulario puede perfectamente traer el código impreso en su envase, y prohibirlo perdería dato. Hay un criterio de aceptación explícito para que nadie restaure la simetría por parecido visual.
- **Sí:** evaluar la regla sobre el **estado resultante** en el `004`, no sobre el body. Un `PUT` que solo envía la descripción tiene que ver el `isOtherMedication` guardado, o la regla se evade enviando los dos campos en peticiones separadas.

**Estado, visibilidad y orden**

- **Sí:** adoptar la solución del `005B` de F16 sin re-razonarla. El choque entre trigger, índice parcial y `entityActivation.service.ts:34` es el mismo mecanismo sobre la misma configuración; volver a deducirlo desde cero invitaría a llegar a una conclusión distinta por una entidad que no lo es.
- **Sí:** el `005B` no revalida catálogos. Reactivar es deshacer una desactivación, no reescribir la fila: exigir que la forma farmacéutica siga activa haría que la decisión de un administrador sobre el catálogo bloqueara el deshacer de otro sobre una notificación.
- **Sí:** sin arrastre de estado desde la cabecera. La visibilidad heredada ya oculta los medicamentos de una notificación inactiva.
- **Sí:** sin comprobación de duplicados. Dos filas del mismo fármaco con dosis o vía distintas son un registro legítimo, y el DDL no declara ninguna `UNIQUE` que insinúe lo contrario.
- **Sí:** una sola línea `warn` con conteo y `medicationId` en la cascada de purga de la cabecera, junto a la de los eventos. Volcar N filas completas convierte un aviso en ruido; volcar nada deja una destrucción sin rastro.

**Respuesta y modelo**

- **Sí:** devolver las FK crudas **y** los objetos resueltos, al modo de F16 y no de F14. El `004` acepta esas dos claves en el body, así que el criterio «un `PUT` que reenvía el `GET` no escribe nada» exige que estén en el `GET`. En F14 no había esa tensión porque el detalle no se reenvía igual.
- **Sí:** los ítems de catálogo con tres campos —`catalogItemId`, `code`, `name`—. `sortOrder`, `value` y `catalogTypeId` son gobernanza del catálogo, no dato de la notificación.
- **No:** el inverso `hasMany` desde `CatalogItem`. Nadie lo necesita, y declararlo invitaría a incluir medicamentos en las respuestas del catálogo.
- **No:** incluir `notification` en la respuesta, aunque toda lectura la consulte. Se resuelve con dos atributos y se descarta.
- **Sí:** `isOtherMedication` como booleano estricto, no tri-estado. El DDL lo declara `NOT NULL`; tratarlo como los `verified*` de F14 sería copiar un patrón que aquí no aplica.
- **Sí:** `startDate` sin columna de hora, porque el DDL no la tiene. La consecuencia práctica es que **no** se importa `normalizeTime` ni se replica la nota que F16 necesitó para `startTime`.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El `005B` se implementa delegando sin más en `setEntityActiveStatusService` y el escenario de colisión produce 500 | El escenario está escrito paso a paso en el plan (§4, paso 14) y como criterio de aceptación con los cuatro movimientos literales. F16 ya lo verificó sobre la misma configuración |
| Alguien invierte los pasos 3 y 4 del `005B` porque «da igual el orden» | §3.5 y §6 dicen por qué no da igual: el índice único parcial no es diferible y el orden inverso falla en el propio `UPDATE` del helper |
| La validación de catálogo se implementa como un `findByPk` sin comprobar el `catalogType`, y cualquier `catalogItem` entra como forma farmacéutica | Dos criterios de aceptación con el caso del catálogo cruzado, y el patrón citado con archivo y línea (`nonSevereNotification.service.ts:191`) |
| Se aplica `toConstantCase` a `medicationCode` por seguir §11 al pie de la letra, y las transcripciones de vademécum se mutilan | §6 razona la desviación y §5 la fija con el criterio de `"  ABC-123  "`, que exige que el guion sobreviva |
| Se copia de F16 la prohibición de `medicationCode` junto a `isOtherMedication: true` por parecido visual entre las dos entidades | Criterio de aceptación explícito que exige **201** en ese caso, escrito precisamente para bloquear la copia |
| La línea del índice se olvida, o se añade en el bloque de índices del final en vez de junto a la tabla | Es un paso propio del plan (§4, paso 2), antes del modelo, con verificación por `git diff` y por `pg_indexes` |
| El `002B` se apoya sin saberlo en el índice único parcial y degrada al crecer la tabla | El índice nuevo no es parcial y cubre las filas con `deletedAt` sellado, que son las que el `002B` lee |
| `GET /:id` captura `/case`, `/admin`, `/purge` o `/activate` como UUID | Las cinco literales se declaran antes que `/:id`, en el orden exacto de §3.4; cubierto por la suite de contrato |
| La cascada de `ESAVI-NOTIFCN-005C` destruye medicamentos sin rastro individual | Línea `warn` con conteo y `medicationId` antes del `destroy` (§4, paso 16) |
| Dos altas concurrentes sobre la misma notificación reciben el mismo `sortOrder` | Lo resuelve `pg_advisory_xact_lock` dentro del trigger (`esaviapp.sql:180`); la aplicación no interviene |

**§8 no aplica.** Este spec solo añade endpoints nuevos, un índice y una línea de log en un servicio existente. Ningún status, campo ni mensaje que los clientes ya reciben cambia de forma.

---

## Lo que **no** está en este spec

- **Las otras cuatro satélites de `notification`:** `notificationVaccine`, `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- **Reordenar medicamentos** — el `007` que mueva una fila de posición y desplace a sus hermanas. Cuando se escriba, debe cubrir también los eventos de F16.
- **Cualquier vínculo entre `medicationCode` y un maestro de fármacos.** No hay vademécum en el esquema; si algún día se quiere resolver contra un catálogo, es un spec que primero cree ese maestro.
- **Extraer a un helper compartido la validación de un `catalogItem` contra su `catalogType`.** Es la tercera copia del patrón; el refactor tendrá su propio spec cuando haya más.
- **Arrastre de estado desde la cabecera** — desactivar una notificación no toca el `isActive` ni el `deletedAt` de sus medicamentos.
- **Filtros de listado** por `isOtherMedication`, las dos FK de catálogo, `startDate` o texto sobre `medicationName`.
- **Comprobación de duplicados** dentro de la misma notificación.
- **Cualquier regla que cruce `startDate` con la fecha de vacunación o la del evento.**
- **Modificar `esaviapp.sql` más allá del índice de §3.1**, `purgeEntityService` o `setEntityActiveStatusService`.
- Cifrado de ningún campo.
- Crear medicamentos automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
