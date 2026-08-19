# SPEC F25 — CRUD de `notificationPregnancy`

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F10 (`notification` — dependencia dura de modelo: es el padre de la FK y la fuente de la visibilidad heredada)**, **SPEC F26 (`systemConfig` — dependencia dura de implementación, aún sin redactar: la regla del sexo femenino lee de ahí el `catalogItemId`, y sin esa entidad F25 no se puede implementar)**, SPEC F13 (`severeNotification` — precedente de la satélite uno a uno, y quien dejó abierta la pregunta que §6 de este spec responde), SPEC F24 (`notificationDiluent` — precedente inmediato de la familia y del `005C`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa)
> **Fecha:** 2026-08-18
> **Objetivo:** Dar de alta `notificationPregnancy` —la sección de embarazo de una notificación ESAVI— como la séptima tabla satélite de `notification`, primera del repositorio que es uno a uno **y** tiene estado propio.

---

## 1. Por qué existe este spec

`notificationPregnancy` es la **séptima de las ocho tablas satélite de `notification`** que recibe implementación. Con ella se abre la rama del embarazo, la única que quedaba después de que [F24](./24-notificationdiluent-crud.md) cerrara la de la vacunación.

Guarda **si la paciente estaba embarazada cuando se vacunó y cuando ocurrió el ESAVI**, con las dos fechas que sitúan la gestación —última menstruación y fecha probable de parto— y una respuesta sobre si hubo complicaciones. Es la información que decide si un ESAVI se investiga como evento en gestante, con las implicaciones que eso tiene para el feto y para la clasificación final del caso.

Hoy la tabla existe en `esaviapp.sql:886-903` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**A — Es una forma nueva: uno a uno *con* estado propio.** Las seis satélites ya especificadas se reparten en dos familias y ésta no cae en ninguna. F13 y F14 son uno a uno, pero **comparten la PK** con `notification` (`:748`, `:765`) y **no tienen `isActive`**, así que carecen de `005A` y `005B`. F16, F21, F22 y F24 tienen estado, pero son uno a muchos y arrastran `sortOrder`. `notificationPregnancy` tiene **PK propia** `pregnancyId` (`:887`), **`UNIQUE` sobre la FK** (`:902`) e **`isActive`** (`:895`). De ahí sale su superficie: siete operaciones, sin `002` porque no hay nada que listar, y con el par de activación completo porque sí hay estado que mover.

**B — La `UNIQUE` es plana, no parcial, y eso gobierna el `001`.** `UQ_notificationPregnancy_notification` (`:902`) es una restricción de columna. No se parece al `UQ_notificationDiluent_parent_sortOrder` de F24 (`:1341-1343`), que se condiciona a `deletedAt IS NULL`. La consecuencia es concreta: **una fila desactivada sigue ocupando el hueco**, y mientras exista ninguna otra fila de embarazo puede crearse para esa notificación. El `001` responde **409** aunque la fila que estorba esté inactiva, y el camino de vuelta es el `005B`.

**C — No es hoja del grafo, a diferencia de F24.** `notificationPregnancyComplication` (`:905-923`) cuelga de ella por `FK_notificationPregnancyComplication_pregnancy` con `ON DELETE CASCADE` (`:920`). Purgar un embarazo destruye sus complicaciones. Como esa tabla no tendrá modelo hasta su propio spec, el volcado al log se resuelve con `sequelize.query`, que es exactamente lo que F22 hizo con `notificationDiluent` antes de que F24 la modelara.

**D — Depende de una entidad que todavía no existe en `src/`, y es la primera vez que pasa.** La regla del sexo lee el `catalogItemId` femenino de `systemConfig` (`:358-377`), una tabla sin modelo. **F25 no se puede implementar hasta que exista el spec de `systemConfig` y esté implementado**, aunque se haya redactado antes. Es también la primera vez que un servicio de este repositorio lee configuración de despliegue en lugar de una constante del código, y §6 razona por qué aquí no cabía la constante.

**E — No hereda el hallazgo del `005B` de F16, y conviene decirlo.** La tabla **no tiene `sortOrder`** ni figura en la lista de `setSortOrderByParent` (`:1305-1313`) ni tiene índice único parcial (`:1338-1350`). El choque entre trigger, índice parcial y `entityActivation.service.ts:34` que F16 descubrió y que F21, F22 y F24 arrastraron **aquí no existe**. Su `005B` es una delegación limpia, la primera de la familia con estado que puede serlo.

**F — Es la primera satélite que no toca `esaviapp.sql`.** F21, F22 y F24 añadieron un índice sobre su FK. Aquí no hace falta: la `UNIQUE` de `:902` ya crea el índice sobre `notificationId`, y no hay otra columna por la que se filtre.

**G — Responde una pregunta que F13 dejó por escrito.** F13 §Fuera-de-alcance dice, palabra por palabra, que la relación entre `severeNotification.hasPregnancyComplications` / `pregnancyComplicationsDescription` (`:753-754`) y estas tablas «es una pregunta para el spec de aquellas». Este es ese spec, y la respuesta —conviven, no se sincronizan— está razonada en §6.

**Y lo que hace única a esta tabla entre las siete.** Es la primera con un campo de datos **obligatorio en el alta**: `wasPregnantAtVaccination` debe llegar en el `001`. Las seis anteriores admitían un alta con solo la FK del padre. Aquí no: una fila de embarazo que no dice si había embarazo no informa de nada, y a diferencia de F24 el problema no se resuelve con una guarda de contenido mínimo genérica, porque hay un campo concreto que es la razón de ser de la tabla.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notificationPregnancy`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones y ninguna más:** `001` crear, `003` obtener por ID, `006` obtener por notificación, `004` actualizar, `005A` desactivar, `005B` reactivar y `005C` borrado físico. **Sin `002` en ninguna forma** — la relación es uno a uno y un listado de una fila no tiene lector.
- **Ningún cambio en `esaviapp.sql`.** Es la primera satélite que no añade ni una línea: la `UNIQUE` de `:902` ya crea el índice sobre `notificationId` y no hay otra columna por la que se filtre.
- **Relación uno a uno con `notification`.** Se entra por `/notification/:notificationId` en el `006`, y por `pregnancyId` en el resto. Nunca por `/`.
- **Guarda del alta:** la notificación existe y está **activa** → 404 `NOTIFPRG_001_NOTIFICATION_NOT_FOUND`. **Sin filtro por `notificationType`**: el embarazo es igual de relevante en una notificación grave que en una no grave, y el DDL no lo restringe. Es la desviación deliberada respecto de F13, razonada en §6.
- **Guarda de unicidad en el `001`:** si ya existe una fila de embarazo para esa notificación → **409** `NOTIFPRG_001_ALREADY_EXISTS`, **incluso si está desactivada**. La `UNIQUE` de `:902` es plana y la fila inactiva sigue ocupando el hueco; la clave i18n dice explícitamente que el camino de vuelta es el `005B`.
- **`wasPregnantAtVaccination` obligatorio en el `001`**, con `.isIn(ANSWER_OPTIONS)`. Se exige la **respuesta**, no un contenido concreto: `'NO'`, `'UNKNOWN'` y `'NO_ANSWER'` son valores válidos. En el `004` **sí es anulable** — vaciarlo después es legítimo y se declara en §6.
- **Regla del sexo femenino, solo en el `001`.** El `catalogItemId` del sexo femenino se lee de `systemConfig` con `code: 'PREGNANCY_FEMALE_SEX_ITEM'` y `scope: 'GLOBAL'`. Si el paciente del caso tiene `sexItemId` con valor y **no** coincide → 400 `NOTIFPRG_001_PATIENT_NOT_FEMALE`. Tres precisiones que son parte de la regla:
  - **`sexItemId` en `null` no bloquea.** Sexo desconocido no es prueba de que no haya embarazo.
  - **La clave de `systemConfig` ausente, inactiva o apuntando a un `catalogItemId` inexistente es 500**, no 400. Es un fallo de configuración del despliegue y el notificador no puede arreglarlo.
  - **No corre en el `004`.** El sexo del paciente no cambia por un `PUT` al embarazo.
- **Regla del rango gestacional**, en `001` y en `004` sobre el **estado resultante**: con las **dos** fechas presentes, `probableDeliveryDate - lastMenstruationDate` debe estar entre **266 y 294 días inclusive** → 400 `NOTIFPRG_<op>_DELIVERY_DATE_OUT_OF_RANGE`. Es la regla de Naegele con ±14 días. Con una sola fecha, o ninguna, no se comprueba nada. Los dos límites van como constantes con nombre en `src/constants/notification.constants.ts`. **Un solo error**, que absorbe también el caso de una FPP anterior a la menstruación.
- **Visibilidad heredada, a un solo nivel.** Toda lectura incluye `notification`: si está inactiva, el embarazo responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Aplica a `003`, `006` y `004`. Es un salto, no dos como en F24: `notificationPregnancy` cuelga directamente de la cabecera.
- **`005B` como delegación limpia.** No hay `sortOrder` que reasignar, así que el `005B` **no** arrastra el hallazgo de F16: es una llamada a `setEntityActiveStatusService` y nada más. Es la primera de la familia con estado que puede serlo.
- **`005C` con volcado de cascada.** `notificationPregnancyComplication` cuelga con `ON DELETE CASCADE`, así que purgar un embarazo destruye filas hijas. Como esa tabla aún no tiene modelo, el conteo y la lista de `complicationId` se obtienen con `sequelize.query` antes del `purgeEntityService`, exactamente como F22 hizo con los diluyentes antes de que F24 los modelara.
- **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`:** una línea `warn` con el `pregnancyId` que la cascada arrastra, junto a las cuatro que F16, F21, F22 y F24 ya dejaron. Implica tocar `src/services/notification.service.ts` solo en ese punto.
- **`005A` y `005B` no se bloquean por nada.** Desactivar un embarazo con complicaciones vivas responde 200: la visibilidad heredada que su propio spec declare resolverá la lectura.
- **Normalización al escribir: solo `trim()`** sobre `notes`, con `normalizeText` —un texto que queda vacío es texto ausente—. Es la quinta copia del helper, y la deuda que F24 §7 declaró vencida sigue vencida.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` de §3.5: `notificationId` inmutable, seis campos comparados, **ninguno derivado**.
- Alta de la abreviatura **`NOTIFPRG`** en `references/CONVENTIONS.md` §6, y del `006` en su tabla de operaciones no canónicas.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **177 a 184**— y suite `tests/contract/notificationPregnancy.test.ts`.

**Precondiciones de datos** (no son parte de la implementación):

- **`systemConfig` debe estar implementado antes que F25.** No es una precondición de datos sino de código, y es la única dependencia dura de este spec. Está declarada en el header y repetida aquí porque decide el orden de ejecución: el spec de `systemConfig` se redacta después pero se implementa antes.
- **La clave `PREGNANCY_FEMALE_SEX_ITEM` debe existir y apuntar a un `catalogItem` real.** Sin ella el `001` responde 500 en cada intento. Es una fila que se carga por el `001` de `systemConfig`, no código que este spec escriba.
- **El catálogo de sexo debe estar cargado** y su ítem femenino debe existir, porque es a lo que la clave apunta. `esaviapp.sql` no lo siembra.

**Fuera de alcance (otros specs):**

- **`notificationPregnancyComplication`** (`esaviapp.sql:905-923`). Es la octava y última satélite de `notification`, y una entidad completa por su cuenta: PK propia, `sortOrder` con trigger (`:1310`) e índice único parcial (`:1344-1346`), dos FKs a maestros —`diagnosticTerm` y `catalogItem`— y `metadata` JSONB. Va en su propio spec, que dependerá de éste.
- **El CRUD de `systemConfig`.** Este spec **lee** una clave y no escribe ninguna. Todo lo demás de esa entidad —`valueType` con su `CHECK`, `scope` en la `UNIQUE` compuesta, `isEncrypted`, `isEditable` y la tabla `systemConfigHistory`— es materia de su propio spec.
- **Cualquier sincronización con `severeNotification`.** `hasPregnancyComplications` y `pregnancyComplicationsDescription` (`:753-754`) siguen siendo columnas de aquella tabla y se tratan como tales. Ni este spec las lee, ni las escribe, ni las contrasta con `hasComplications`. La respuesta a la pregunta que F13 dejó abierta es «conviven», y está razonada en §6; la migración de la descripción a la tabla hija, si llega, es su propio spec.
- **Derivar `hasComplications` de las filas de `notificationPregnancyComplication`.** Es dato del cliente en este spec, y quien decida si eso cambia es el spec de la tabla hija.
- **Validar la edad del paciente.** Contrastar el embarazo con `patient.birthDate` cruzaría las mismas tres tablas que la regla del sexo para bloquear capturas legítimas sobre datos incompletos. F13 §6 ya lo descartó.
- **Cruzar las fechas con `esaviCase.eventDate` o con `notificationVaccine.vaccinationDate`.** La regla gestacional es interna a la fila y no sube por el grafo. Es el criterio de un solo salto que F24 §6 fijó, llevado al extremo: aquí no hay ni un salto.
- **Cualquier regla cruzada entre los dos tri-estado.** Un `wasPregnantAtVaccination: 'NO'` con `wasPregnantAtEsavi: 'YES'` es un embarazo iniciado después de la vacunación, que es un registro legítimo y clínicamente relevante.
- **Cualquier regla que ate `hasComplications` a las fechas o a los tri-estado.** La descripción de la complicación vive en la tabla hija, no aquí.
- **Reglas sobre `probableDeliveryDate` respecto de hoy.** Una FPP en el pasado es un embarazo ya terminado, que es exactamente el caso que muchos ESAVI en gestantes documentan.
- **Distinguir la fuente de la FPP.** No hay columna que registre si la fecha viene de Naegele o de ecografía, así que el rango se aplica a todas por igual. Consecuencia asumida y razonada en §6.
- **Reactivar la fila desde el `001`.** Un `POST` que a veces es un `PATCH` no existe en este repositorio y no se estrena aquí.
- **Convertir `UQ_notificationPregnancy_notification` en índice parcial** sobre `deletedAt IS NULL`. Sería cambio de DDL y dejaría dos filas de embarazo por notificación en la base.
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la quinta copia y el refactor esté vencido desde F24 §7.
- **Cualquier filtro de listado**, y cualquier paginación. No hay listado.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII directa del paciente.
- Crear la fila de embarazo automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notificationPregnancy` — `esaviapp.sql:886-903`. **No se le añade ni se le cambia nada.**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `pregnancyId` | `uuid` | no | PK **propia**, `DEFAULT gen_random_uuid()` (`:887`) |
| `notificationId` | `uuid` | no | `FK_notificationPregnancy_notification` → `notification`, `ON DELETE CASCADE` (`:888`, `:901`). **`UQ_notificationPregnancy_notification` UNIQUE** (`:902`) → uno a uno |
| `wasPregnantAtVaccination` | `"answerOption"` | sí en el DDL | Tri-estado. **La aplicación lo exige en el `001`** — la única columna de datos obligatoria (`:889`) |
| `wasPregnantAtEsavi` | `"answerOption"` | sí | Tri-estado (`:890`) |
| `lastMenstruationDate` | `date` | sí | Entra en la regla del rango gestacional (`:891`) |
| `probableDeliveryDate` | `date` | sí | Ídem (`:892`) |
| `hasComplications` | `"answerOption"` | sí | Dato del cliente, **no derivado** de la tabla hija (`:893`) |
| `notes` | `text` | sí | Solo `trim()` (`:894`) |

**Seis columnas de datos, las seis anulables en el DDL.** La obligatoriedad de `wasPregnantAtVaccination` la impone la aplicación, no el esquema, y solo en el alta. Es una desviación deliberada entre DDL y contrato, razonada en §6.

**El tri-estado `answerOption`.** `esaviapp.sql:26` lo declara como `ENUM ('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER')`, y ya existe en el código: `ANSWER_OPTIONS` y `AnswerOption` en `src/constants/enums.constants.ts`, compartidos por `notification` y `severeNotification`. **No se redeclaran** — `src/constants/notification.constants.ts:9-11` lo dice explícitamente. `null` y `'NO_ANSWER'` son datos distintos, como F13 §3.3 dejó fijado.

**Restricciones.** Una clave foránea, una `UNIQUE` y ningún `CHECK`. La `UNIQUE` de `:902` es **de columna, no un índice parcial**: no lleva `WHERE "deletedAt" IS NULL`, a diferencia del `UQ_notificationDiluent_parent_sortOrder` de F24 (`:1341-1343`). De ahí sale el 409 sobre fila inactiva del `001`, que es el hallazgo `B` de §1.

**Las columnas transversales.** Están las seis: `isActive` (`:895`), `createdAt` (`:896`), `updatedAt` (`:897`), `deletedAt` (`:898`), `sysDetails` (`:899`) y `appDetails` (`:900`).

**Triggers.** **Uno solo:** `TRG_notificationPregnancy_setSysDetails`, del bucle genérico de `:1280-1296`. **No** figura en la lista de `setSortOrderByParent` (`:1305-1313`) —no tiene `sortOrder`— ni tiene índice único parcial (`:1338-1350`). **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `esaviapp.sql:1361-1375`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

**Con tabla hija.** `notificationPregnancyComplication` referencia `pregnancyId` con `ON DELETE CASCADE` (`:920`). No es hoja del grafo, y de ahí sale el volcado de cascada de su `005C`.

**Sin índice que añadir.** La `UNIQUE` de `:902` ya crea el índice sobre `notificationId`, que es la única columna por la que este spec filtra. Es la razón de que F25 no toque el DDL, a diferencia de F21, F22 y F24.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationPregnancy.model.ts`. Clase `NotificationPregnancy`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationPregnancy'`.

`pregnancyId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `notificationId` va `DataTypes.UUID` con `allowNull: false` y **sin `unique: true`**: la restricción la impone la base y declararla en el modelo no añade nada, porque Sequelize no la comprueba antes del `INSERT`. La unicidad se valida en el servicio con un `findOne` explícito, para devolver 409 en vez de un `23505`.

Los tres tri-estado van `DataTypes.ENUM(...ANSWER_OPTIONS)` con `allowNull: true`, importando `ANSWER_OPTIONS` y `AnswerOption` de `src/constants/enums.constants.ts`. Es lo que ya hacen `notification.model.ts:63` y `severeNotification.model.ts:51`.

`lastMenstruationDate` y `probableDeliveryDate` van `DataTypes.DATEONLY` — el helper de diff ya compara `DATEONLY` con `slice(0, 10)`. `notes` va `DataTypes.TEXT`.

**Sin `sortOrder` y sin `CREATE_FIELDS`.** La tabla no tiene esa columna, así que el `001` es un `create` normal y **no necesita** la lista explícita de campos que F16 descubrió y que F21, F22 y F24 arrastraron.

Asociaciones, en `src/models/associations/notificationPregnancy.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationPregnancy.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasOne(NotificationPregnancy, { as: 'pregnancy', foreignKey: 'notificationId' })`

**`hasOne` y no `hasMany`**, porque la `UNIQUE` de `:902` lo impone. Es el mismo criterio que `notification.associations.ts:14` aplicó a `EsaviCase.hasOne(Notification)`. El `hasOne` se declara porque lo necesita el volcado al log de la cascada de purga de la cabecera. **No se incluye en ninguna respuesta de `notification`**: el contrato HTTP de F10 no cambia.

Alta en `src/models/index.ts` y en el barrel de asociaciones.

**Los dos `include` que el servicio compone**, ninguno de los cuales necesita asociaciones nuevas:

- **Visibilidad heredada**, en `003`, `006` y `004` — un salto: `include: [{ model: Notification, as: 'notification', attributes: ['notificationId', 'isActive'] }]`.
- **Regla del sexo**, solo en el `001` — tres saltos, sobre las asociaciones que F06 y F10 ya declararon: `notification → case → patient`, con `attributes: ['patientId', 'sexItemId']` en el último. `Notification.belongsTo(EsaviCase, { as: 'case' })` está en `notification.associations.ts:7` y `EsaviCase.belongsTo(Patient, { as: 'patient' })` en `esaviCase.associations.ts:10`. La misma consulta que valida la existencia de la notificación trae el sexo, así que la regla **no cuesta una segunda consulta**.

### 3.3 Tipos

Ruta: `src/types/notificationPregnancy/notificationPregnancy.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts`.

```ts
export interface CreateNotificationPregnancyInput {
    notificationId: string;
    wasPregnantAtVaccination: AnswerOption;
    wasPregnantAtEsavi?: AnswerOption | null;
    lastMenstruationDate?: string | null;
    probableDeliveryDate?: string | null;
    hasComplications?: AnswerOption | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationPregnancyInput>`. **No se declara `UpdateNotificationPregnancyInput`** — prohibido por §4 de las convenciones.

**`wasPregnantAtVaccination` es el único campo de datos no opcional**, y es lo que hace a esta interfaz distinta de las seis satélites anteriores. En el `004`, `Partial<>` lo vuelve opcional y anulable, que es exactamente el contrato que §2 fijó: obligatorio al nacer, vaciable después.

**Ningún campo de entrada que no sea columna.** Las siete claves de entrada son las siete columnas escribibles. La interfaz es plana y no hay nada que descartar antes del `create`.

`AnswerOption` se importa de `src/constants/enums.constants.ts`, como hacen `notification.types.ts` y `severeNotification.types.ts`.

### 3.4 Superficie HTTP

Ruta base `/api/notification-pregnancies`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-pregnancies                          ESAVI-NOTIFPRG-001   USER        (nuevo)
GET    /api/notification-pregnancies/notification/:notificationId
                                                              ESAVI-NOTIFPRG-006   USER        (nuevo)
DELETE /api/notification-pregnancies/purge/:id                ESAVI-NOTIFPRG-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-pregnancies/activate/:id             ESAVI-NOTIFPRG-005B  SUPERADMIN  (nuevo)
GET    /api/notification-pregnancies/:id                      ESAVI-NOTIFPRG-003   USER        (nuevo)
PUT    /api/notification-pregnancies/:id                      ESAVI-NOTIFPRG-004   USER        (nuevo)
DELETE /api/notification-pregnancies/:id                      ESAVI-NOTIFPRG-005A  ADMIN       (nuevo)
```

**Orden de declaración.** Las literales van **antes** de `/:id`, o Express capturaría `notification`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las siete están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationPregnancy.routes.ts`.

**Sin `002` en ninguna forma**, ni único ni dual. La relación es uno a uno: cada notificación tiene como mucho un embarazo, así que el `006` devuelve **un objeto, no un `{ count, rows }`**. Es la forma de F13 y F14, no la de F16, F21, F22 y F24.

**`006` es la única operación no canónica** y se registra en la tabla de §6 de `CONVENTIONS.md` como **`notificationPregnancy` · `006` · obtener el embarazo de una notificación**.

**Roles.** `001`, `003`, `004` y `006` en **USER**, siguiendo la desviación que F05, F06, F07, F09, F10, F13 y F14 fijaron: el detalle clínico se captura en el mismo flujo operativo que la notificación, y partirlo en dos roles rompería el formulario por la mitad. `005A` en **ADMIN**, `005B` y `005C` en **SUPERADMIN**, como manda §9 del canon.

Siete filas nuevas en `ROUTE_RULES`: de **177** a **184**.

### 3.5 Reglas de negocio por operación

**`ESAVI-NOTIFPRG-001` — crear.** En este orden:

1. La notificación existe y está **activa** → 404 `NOTIFPRG_001_NOTIFICATION_NOT_FOUND`. Una sola consulta con el `include` de tres saltos de §3.2, que trae además `patient.sexItemId` para el paso 3. **Sin filtro por `notificationType`.**
2. **Unicidad uno a uno:** `NotificationPregnancy.findOne({ where: { notificationId }, paranoid: false })`. Si hay fila → **409** `NOTIFPRG_001_ALREADY_EXISTS`, **esté activa o no**. La `UNIQUE` de `:902` es plana y la fila inactiva ocupa el hueco igual; el mensaje remite al `005B`.
3. **Regla del sexo femenino.** Se lee de `systemConfig` la fila con `code: 'PREGNANCY_FEMALE_SEX_ITEM'`, `scope: 'GLOBAL'` e `isActive: true`, cuyo `value` es el `catalogItemId` del sexo femenino.
   - Si la fila **no existe, está inactiva, o su valor no corresponde a un `catalogItem` existente** → **500** `NOTIFPRG_001_SEX_CONFIG_MISSING`. Es un fallo de configuración del despliegue, no del cliente.
   - Si `patient.sexItemId` es **`null`** → no se comprueba nada y el alta sigue.
   - Si `patient.sexItemId` tiene valor y **no** coincide con el configurado → **400** `NOTIFPRG_001_PATIENT_NOT_FEMALE`.
4. **Obligatoriedad de `wasPregnantAtVaccination`.** La emite `validateFields` con 400 antes de llegar al servicio: `.exists()` más `.isIn(ANSWER_OPTIONS)`. Cualquiera de los cinco valores vale.
5. **Rango gestacional**, solo si llegan las **dos** fechas: `probableDeliveryDate - lastMenstruationDate` en días debe estar entre `GESTATION_MIN_DAYS` (266) y `GESTATION_MAX_DAYS` (294), **ambos inclusive** → si no, 400 `NOTIFPRG_001_DELIVERY_DATE_OUT_OF_RANGE`. Con una sola fecha, o ninguna, no se comprueba nada.
6. Normalización: `normalizeText` sobre `notes` —`trim()`, y un texto que queda vacío es texto ausente—. **Ningún `toTitleCase` ni `toConstantCase`:** no hay ni códigos ni nombres en esta tabla.
7. `create` normal, **sin `fields` explícitos**: no hay `sortOrder` que excluir.
8. Entrada de auditoría en `appDetails` con `method: 'ESAVI-NOTIFPRG-001'`.

**No hay transacción propia.** Es un `create` único sobre una sola tabla y la transacción implícita de Sequelize basta.

**`ESAVI-NOTIFPRG-003` — obtener por ID.** Existencia → 404 `NOTIFPRG_003_NOT_FOUND`. Incluye `notification`: si está inactiva y quien pide no cumple `canViewInactive`, **404**. Un embarazo inactivo también es 404 salvo `canViewInactive`. Las dos condiciones se evalúan igual y ninguna tiene prioridad: basta que una falle.

**`ESAVI-NOTIFPRG-006` — obtener el embarazo de una notificación.** La notificación existe y está activa, salvo `canViewInactive` → 404 `NOTIFPRG_006_NOTIFICATION_NOT_FOUND`. Después, `findOne({ where: { notificationId } })`; si la notificación no tiene embarazo → 404 `NOTIFPRG_006_NOT_FOUND`. **Devuelve un objeto, no una colección**, y por tanto no lleva paginación ni `order`. Un embarazo inactivo es 404 salvo `canViewInactive`.

**`ESAVI-NOTIFPRG-004` — actualizar.** Existencia → 404 `NOTIFPRG_004_NOT_FOUND`, incluida la visibilidad heredada. Después, y **antes del diff y con independencia de él**, la regla del rango gestacional evaluada sobre el **estado resultante** —lo guardado fundido con lo que llega—, nunca sobre el body → 400 `NOTIFPRG_004_DELIVERY_DATE_OUT_OF_RANGE`. **La regla del sexo no corre aquí**, y §6 dice por qué. `stored` sale de `pregnancy.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `notificationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `wasPregnantAtVaccination` | `data.wasPregnantAtVaccination !== undefined ? (data.wasPregnantAtVaccination ?? null) : undefined` | anulable **aquí**, aunque sea obligatorio en el `001` |
| `wasPregnantAtEsavi` | `data.wasPregnantAtEsavi !== undefined ? (data.wasPregnantAtEsavi ?? null) : undefined` | anulable, tri-estado |
| `lastMenstruationDate` | `data.lastMenstruationDate !== undefined ? (data.lastMenstruationDate ?? null) : undefined` | `DATEONLY`; validada antes del diff |
| `probableDeliveryDate` | `data.probableDeliveryDate !== undefined ? (data.probableDeliveryDate ?? null) : undefined` | `DATEONLY`; ídem |
| `hasComplications` | `data.hasComplications !== undefined ? (data.hasComplications ?? null) : undefined` | anulable; **dato del cliente, no derivado** |
| `notes` | `data.notes !== undefined ? normalizeText(data.notes) : undefined` | anulable; solo `trim()` |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**Seis campos comparados y ninguno derivado.** Los tres tri-estado se comparan como primitivos, y `null` frente a `'NO_ANSWER'` **sí** es un cambio: son datos distintos, como F13 fijó.

**`ESAVI-NOTIFPRG-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'NOTIFPRG_005A_NOT_FOUND'`, `alreadyInStateCode: 'NOTIFPRG_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-NOTIFPRG-005A'`. **No consulta nada más:** desactivar un embarazo con complicaciones vivas responde 200. Sella `deletedAt`, lo que **no libera** el hueco de la `UNIQUE`, porque ésta no se condiciona a `deletedAt`.

**`ESAVI-NOTIFPRG-005B` — reactivar.** Delegación limpia en `setEntityActiveStatusService` con `alreadyInStateCode: 'NOTIFPRG_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-NOTIFPRG-005B'`. **Sin transacción propia y sin ninguna corrección previa:** no hay `sortOrder` que reasignar, así que el hallazgo de F16 no aplica y este `005B` es la primera delegación limpia de la familia con estado. Tampoco revalida nada —ni el sexo, ni el rango gestacional, ni el estado de la notificación—: reactivar es deshacer una desactivación, no reescribir la fila.

**`ESAVI-NOTIFPRG-005C` — borrado físico.** Antes del `purgeEntityService`, **una consulta previa** con `sequelize.query` que cuenta y lista los `complicationId` de `notificationPregnancyComplication` que la cascada va a arrastrar, y los vuelca al log en nivel `warn`. Se usa SQL crudo porque esa tabla no tiene modelo hasta su propio spec; es exactamente lo que F22 hizo con `notificationDiluent`. Después, `purgeEntityService` sin modificación, con `notFoundCode: 'NOTIFPRG_005C_NOT_FOUND'` y `stillActiveCode: 'NOTIFPRG_005C_STILL_ACTIVE'`. La guarda es la canónica de §6 sobre la **propia fila**: debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la notificación** ni el de las complicaciones. Sin entrada en `appDetails` —la fila se destruye en la misma transacción—, que es la ausencia que `CONVENTIONS.md` §6 declara legítima para esta operación.

**Escrituras que no son diferenciales, declaradas una a una:**

- **El `001`** — es un `create`.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **El `005C`** — destruye la fila y arrastra sus complicaciones por cascada de la base.

**Este spec no escribe en ninguna otra tabla**, ni por cambio de valor ni por presencia de clave. Lo único que toca fuera de `notificationPregnancy` es una línea de log en la cascada de purga de la cabecera. De `systemConfig` **solo lee**.

### 3.6 Claves i18n nuevas

Bajo `notificationPregnancy`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationPregnancy.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente, y en el `006` cuando la notificación no tiene embarazo |
| `notificationPregnancy.idRequired` | 400 del validador de `:id` |
| `notificationPregnancy.notificationNotFound` | 404 cuando la notificación no existe o está inactiva |
| `notificationPregnancy.alreadyExists` | 409 del `001` cuando la notificación ya tiene embarazo; el texto indica que una fila desactivada se recupera con `PATCH /activate/:id` |
| `notificationPregnancy.patientNotFemale` | 400 cuando el paciente del caso tiene un sexo registrado distinto del femenino |
| `notificationPregnancy.sexConfigMissing` | 500 cuando la clave `PREGNANCY_FEMALE_SEX_ITEM` falta, está inactiva o apunta a un `catalogItem` inexistente |
| `notificationPregnancy.pregnantAtVaccinationRequired` | 400 del validador cuando `wasPregnantAtVaccination` no llega en el `001` |
| `notificationPregnancy.deliveryDateOutOfRange` | 400 cuando la FPP no cae entre 266 y 294 días desde la última menstruación |
| `notificationPregnancy.stillActive` | 409 al purgar un embarazo que no fue retirado antes |
| `notificationPregnancy.createdSuccess` / `createdFailed` | 201 y 500 del `001` |
| `notificationPregnancy.getSuccess` / `getFailed` | 200 y 500 de `003` y `006` |
| `notificationPregnancy.updatedSuccess` / `updatedFailed` | 200 y 500 del `004` |
| `notificationPregnancy.deletedSuccess` / `deletedFailed` | 200 y 500 del `005A` |
| `notificationPregnancy.activatedSuccess` / `activatedFailed` | 200 y 500 del `005B` |
| `notificationPregnancy.alreadyActive` / `alreadyInactive` | 409 de `005B` y `005A` |
| `notificationPregnancy.purgeSuccess` / `purgeFailed` | 200 y 500 del `005C` |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `001`, `003`, `004` y `006`, `data` es la fila desnuda:

```
{ ok, message, data: {
    pregnancyId, notificationId,
    wasPregnantAtVaccination, wasPregnantAtEsavi,
    lastMenstruationDate, probableDeliveryDate,
    hasComplications, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails
} }
```

**Nada resuelto y nada anidado.** La única FK es `notificationId`, y `notification` se consulta solo para la visibilidad heredada —y en el `001` también para el sexo del paciente—, con `attributes` acotados, descartándose al construir el payload. Es lo que F24 §3.7 hizo con `vaccine` y `notification`: quien necesite la cabecera entra por `ESAVI-NOTIFCN-003`, y quien necesite el paciente por `ESAVI-PATIENT-003`.

**`notificationId` viaja crudo en la respuesta**, aunque sea inmutable en el `004`. El criterio de aceptación del update diferencial exige que un `PUT` que reenvía la respuesta de su `GET` responda 200 sin escribir, y para eso la clave tiene que estar ahí; el servicio la ignora en silencio.

**El `006` devuelve un objeto, no `{ count, rows }`.** No hay `findAndCountAll`, ni paginación, ni `order`: la relación es uno a uno.

**Las complicaciones no viajan en ninguna respuesta.** `notificationPregnancyComplication` no tiene modelo hasta su propio spec, y cuando lo tenga, incluirla aquí será una decisión de aquel spec, no de éste.

`sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

> **Bloqueo previo, no es un paso.** Ningún paso de este plan que toque la regla del sexo puede ejecutarse hasta que `systemConfig` tenga modelo y servicio, y hasta que la fila `PREGNANCY_FEMALE_SEX_ITEM` esté cargada. Los pasos 1 a 7 y 9 a 17 **sí** son ejecutables antes: el único que depende de `systemConfig` es el 8. Si el spec de `systemConfig` se retrasa, F25 puede llegar hasta el paso 17 con el 8 pendiente, y en ese estado el `001` no valida el sexo — pero entonces **no está terminado**, y el criterio de aceptación correspondiente queda en rojo.

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `notificationPregnancy | NOTIFPRG` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `notificationPregnancy · 006 · obtener el embarazo de una notificación` a su tabla de operaciones no canónicas. La norma exige registrar **antes** de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla de abreviaturas contiene la fila nueva; `NOTIFPRG` no aparece dos veces y no colisiona con `NOTIFCN`, `NOTIFDIL`, `NOTIFEVT`, `NOTIFMED`, `NOTIFVAC` ni `NOTIFIER`; la tabla de operaciones no canónicas gana **una** fila.

2. **Constantes.** En `src/constants/notification.constants.ts`: `GESTATION_MIN_DAYS = 266`, `GESTATION_MAX_DAYS = 294` y el `code` de la clave de configuración, `PREGNANCY_FEMALE_SEX_ITEM_CONFIG_CODE = 'PREGNANCY_FEMALE_SEX_ITEM'`. **`ANSWER_OPTIONS` no se toca ni se redeclara** — vive en `src/constants/enums.constants.ts` y ese archivo ya lo advierte en su comentario.
   *Verificación:* `npm run build` en 0; `grep -n "266\|294" src/services/notificationPregnancy.service.ts` no devuelve resultados —los números no aparecen sueltos en el servicio—; `grep -rn "ANSWER_OPTIONS" src/constants/notification.constants.ts` no devuelve ninguna declaración nueva.

3. **Modelo y asociaciones.** `src/models/notificationPregnancy.model.ts` según §3.2, y `src/models/associations/notificationPregnancy.associations.ts` con el `belongsTo` y el `hasOne`. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` en 0; un `NotificationPregnancy.findAll({ include: ['notification'] })` desde el REPL devuelve filas sin error de asociación; un `include` de tres saltos `notification → case → patient` también; `grep -n "hasMany" src/models/associations/notificationPregnancy.associations.ts` no devuelve resultados —es `hasOne`—; `grep -n "unique" src/models/notificationPregnancy.model.ts` no devuelve resultados; `git diff --stat src/controllers/notification.controller.ts` no muestra cambios: el contrato de F10 no gana el embarazo en su respuesta.

4. **Tipos.** `src/types/notificationPregnancy/notificationPregnancy.types.ts` con `CreateNotificationPregnancyInput`, más su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateNotificationPregnancyInput" src/` no devuelve resultados; `wasPregnantAtVaccination` es el único campo de datos **sin** `?` en la interfaz.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`. El texto de `alreadyExists` menciona explícitamente el camino de reactivación.
   *Verificación:* `npm run i18n:check` en 0; el mensaje de `alreadyExists` en los tres idiomas nombra la operación de activación.

6. **Validadores.** `src/validators/notificationPregnancy.validator.ts` con el validador de creación, el de actualización, el de `:id` y el del `:notificationId` de ruta. En creación: `notificationId` obligatorio y `.isUUID()`; `wasPregnantAtVaccination` con `.exists()` y `.isIn(ANSWER_OPTIONS)`; los otros dos tri-estado con `.isIn(ANSWER_OPTIONS)` cuando lleguen; las dos fechas en formato ISO; `notes` como cadena. En actualización, `wasPregnantAtVaccination` es opcional y **anulable**. Alta en el barrel de `validators/`.
   *Verificación:* un `POST` sin `wasPregnantAtVaccination` devuelve **400** y no llega al servicio; `wasPregnantAtVaccination: 'MAYBE'` devuelve 400 del validador, no 500; un `PUT` con `wasPregnantAtVaccination: null` **no** produce 400 del validador; un `POST` con `notificationId` no UUID devuelve 400.

7. **`ESAVI-NOTIFPRG-001` — crear, sin la regla del sexo.** `createNotificationPregnancyService` con los pasos 1, 2 y 4 a 8 de §3.5: guarda de la notificación con su `include`, guarda de unicidad con `paranoid: false`, rango gestacional, `normalizeText` sobre `notes`, `create` y auditoría. Controlador y ruta `POST /`.
   *Verificación:* un alta mínima —`notificationId` y `wasPregnantAtVaccination`— devuelve 201 con los otros cinco campos en `null`; repetirla devuelve **409** `NOTIFPRG_001_ALREADY_EXISTS`; desactivar la fila y repetir el `POST` **también** devuelve 409, no 201 — es el hallazgo `B` de §1 y el criterio que más fácil se rompe; sobre una notificación inactiva devuelve 404; sobre un `notificationId` inexistente devuelve 404; sobre una notificación `NON_SEVERE` devuelve **201**, no 409 — aquí no hay filtro por tipo; la suite no produce ningún error `23505`.

8. **La regla del sexo femenino.** El paso 3 de §3.5, dentro del mismo `001`: lectura de `systemConfig` por `code` y `scope` con `isActive: true`, y comparación contra el `patient.sexItemId` que el `include` de tres saltos ya trajo. **Este paso depende de que `systemConfig` esté implementado.**
   *Verificación:* con la clave sembrada, crear sobre un caso cuyo paciente es masculino devuelve **400** `NOTIFPRG_001_PATIENT_NOT_FEMALE`; sobre un paciente femenino devuelve 201; sobre un paciente con `sexItemId: null` devuelve **201**; borrando la fila de `systemConfig`, cualquier alta devuelve **500** `NOTIFPRG_001_SEX_CONFIG_MISSING` y no 400; desactivando esa fila, lo mismo; apuntándola a un `catalogItemId` inexistente, lo mismo; la regla **no cuesta una segunda consulta al paciente** — el servicio no contiene ninguna llamada a `Patient.findOne`.

9. **`ESAVI-NOTIFPRG-003` — obtener por ID.** Servicio con el `include` de un salto y las dos condiciones sin prioridad entre ellas. Ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* `GET /api/notification-pregnancies/activate/algo` responde 400 de UUID y no 404 de embarazo; un embarazo cuya notificación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; un embarazo inactivo con la notificación activa, lo mismo.

10. **`ESAVI-NOTIFPRG-006` — obtener el embarazo de una notificación.** Servicio, controlador y ruta `GET /notification/:notificationId`, declarada antes de `/:id`. Devuelve un objeto.
    *Verificación:* devuelve la fila directamente y **no** `{ count, rows }`; una notificación sin embarazo devuelve 404 `NOTIFPRG_006_NOT_FOUND`; una notificación inexistente o inactiva devuelve 404 `NOTIFPRG_006_NOTIFICATION_NOT_FOUND`; los dos 404 llevan códigos distintos; `grep -n "findAndCountAll\|DEFAULT_LIMIT" src/services/notificationPregnancy.service.ts` no devuelve resultados.

11. **`ESAVI-NOTIFPRG-004` — actualizar.** `buildDifferentialUpdate` con la tabla de `candidates` de §3.5, y el rango gestacional evaluado sobre el estado resultante antes del diff. Ruta `PUT /:id`.
    *Verificación:* un `PUT` que reenvía la respuesta del `GET` responde 200 sin escribir; enviar un `notificationId` distinto no lo modifica y devuelve 200; un `PUT` con `wasPregnantAtVaccination: null` responde **200** y lo vacía —es anulable aquí, a diferencia del `001`—; un `PUT` que mueve `probableDeliveryDate` fuera del rango responde 400 aunque el resto del body no cambie; un `PUT` que cambia `hasComplications` de `null` a `'NO_ANSWER'` **sí** escribe; **no** se consulta `systemConfig`: `grep -n "systemConfig\|SystemConfig" src/services/notificationPregnancy.service.ts` aparece **una sola vez**, en el `001`.

12. **`ESAVI-NOTIFPRG-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, ruta `DELETE /:id` con `validateUserRole(ADMIN)`.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409; desactivar un embarazo con complicaciones cargadas responde **200**; un USER recibe 403.

13. **`ESAVI-NOTIFPRG-005B` — reactivar.** Delegación limpia, ruta `PATCH /activate/:id`. **Sin transacción propia y sin corrección previa de ningún campo.**
    *Verificación:* reactivar devuelve 200 y limpia `deletedAt`; reactivar uno ya activo devuelve 409; reactivar uno cuya notificación se desactivó entretanto responde **200** — el `005B` no revalida nada; después de reactivar, un `POST` sobre la misma notificación sigue devolviendo 409; `grep -n "transaction" src/services/notificationPregnancy.service.ts` no devuelve resultados en el `005B`.

14. **`ESAVI-NOTIFPRG-005C` — borrado físico con volcado de cascada.** La consulta previa con `sequelize.query` que cuenta y lista los `complicationId`, la línea `warn`, y después `purgeEntityService` sin modificarlo. Ruta `DELETE /purge/:id` declarada antes de `/:id`.
    *Verificación:* purgar un embarazo activo devuelve 409; purgar uno desactivado devuelve 200 y la fila desaparece; purgar uno con dos complicaciones deja **una** línea `warn` con los dos `complicationId` y las dos filas hijas desaparecen de la base; purgar uno sin complicaciones **no** deja esa línea; `git diff --stat src/services/common/entityPurge.service.ts` no muestra cambios.

15. **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`.** En `src/services/notification.service.ts`, junto a las cuatro líneas que F16, F21, F22 y F24 dejaron, y antes del `destroy` de la notificación, **una sola línea** `warn` con el `pregnancyId` que la cascada arrastra. Se resuelve con el `hasOne` declarado en el paso 3, sin SQL crudo. Es el único punto de este spec que toca un servicio ajeno.
    *Verificación:* purgar una notificación con embarazo deja **una** línea con su `pregnancyId`, y siguen apareciendo las de eventos, medicamentos, vacunas y diluyentes; purgar una notificación sin embarazo no deja esa línea; `git diff --stat src/services/severeNotification.service.ts` no muestra cambios — la pregunta que F13 dejó abierta se responde en prosa, no en código.

16. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **177 a 184** en la aserción de longitud.
    *Verificación:* `npm test -- roles` en 0.

17. **Suite `tests/contract/notificationPregnancy.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por notificación → actualizar → desactivar → reactivar → purgar. Más los caminos de error: 409 de alta duplicada sobre fila **activa** y sobre fila **inactiva** —dos escenarios distintos—, 404 de notificación inactiva, 400 de `wasPregnantAtVaccination` ausente, 400 de sexo masculino, 500 de configuración ausente, 400 de rango gestacional en `001` y en `004`, 409 de purga sobre fila activa, y los cinco casos de update diferencial de §5.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones — cuatro en el `005C`, que no escribe auditoría.
- [ ] `grep -rn "ESAVI-NOTIFPRG-002" src/` no devuelve resultados — esta entidad no tiene listado en ninguna forma.
- [ ] `references/CONVENTIONS.md` §6 contiene la fila `notificationPregnancy | NOTIFPRG`, y su tabla de operaciones no canónicas gana **una** fila con el `006`.
- [ ] `ROUTE_RULES` tiene 184 filas y la aserción de longitud de `tests/auth/roles.test.ts` espera ese número.

**DDL:**

- [ ] `git diff esaviapp.sql` **no muestra ningún cambio**. Es la primera satélite que no toca el esquema.
- [ ] `grep -n "sortOrder" src/models/notificationPregnancy.model.ts src/types/notificationPregnancy/notificationPregnancy.types.ts src/services/notificationPregnancy.service.ts` no devuelve resultados: la tabla no tiene esa columna y nada del código la inventa.
- [ ] `grep -n "CREATE_FIELDS" src/services/notificationPregnancy.service.ts` no devuelve resultados — sin `sortOrder` no hay campo que excluir del `create`.

**Uno a uno y la `UNIQUE` plana:**

- [ ] Un segundo `POST` sobre una notificación que ya tiene embarazo **activo** responde **409** `NOTIFPRG_001_ALREADY_EXISTS`.
- [ ] Desactivar el embarazo y repetir el `POST` responde **409 igualmente**, no 201. La `UNIQUE` de `:902` no se condiciona a `deletedAt`.
- [ ] El mensaje de `alreadyExists` en `es`, `en` y `nl` menciona la operación de activación como camino de vuelta.
- [ ] Reactivar por `005B` y consultar por `006` devuelve la misma fila que existía antes de desactivarla.
- [ ] La suite completa no produce ningún error `23505` de Postgres: la unicidad se comprueba en el servicio, no se deja estallar en la base.
- [ ] `grep -n "unique" src/models/notificationPregnancy.model.ts` no devuelve resultados.

**Regla del sexo femenino:**

- [ ] Crear sobre un caso cuyo paciente tiene un `sexItemId` distinto del configurado responde **400** `NOTIFPRG_001_PATIENT_NOT_FEMALE`.
- [ ] Crear sobre un paciente con `sexItemId: null` responde **201**. El sexo desconocido no bloquea.
- [ ] Con la fila de `systemConfig` ausente, inactiva, o apuntando a un `catalogItemId` inexistente, el `001` responde **500** `NOTIFPRG_001_SEX_CONFIG_MISSING` — nunca 400, y nunca 201.
- [ ] Un `PUT` **no** consulta `systemConfig`: la regla del sexo no corre en el `004`.
- [ ] El `005B` tampoco la consulta: reactivar un embarazo cuyo paciente cambió de sexo entretanto responde **200**.
- [ ] El servicio no contiene ninguna llamada a `Patient.findOne`: `grep -n "Patient.find" src/services/notificationPregnancy.service.ts` no devuelve resultados. El sexo llega por el `include` de tres saltos del `001`.
- [ ] El `code` de la clave de configuración no aparece como cadena suelta: `grep -n "'PREGNANCY_FEMALE_SEX_ITEM'" src/services/` no devuelve resultados — viene de `src/constants/notification.constants.ts`.

**Rango gestacional:**

- [ ] Con `lastMenstruationDate: '2026-01-01'`, una `probableDeliveryDate` a **266** días responde 201, y a **294** días también. Los dos límites son inclusive.
- [ ] A **265** días responde **400** `NOTIFPRG_001_DELIVERY_DATE_OUT_OF_RANGE`, y a **295** días también.
- [ ] Una `probableDeliveryDate` **anterior** a `lastMenstruationDate` responde 400 con **ese mismo código**: no hay un segundo error para ese caso.
- [ ] Con una sola fecha, o con ninguna, el alta responde 201 sea cual sea la otra.
- [ ] Un `PUT` que mueve `probableDeliveryDate` fuera del rango responde **400** aunque el resto del body no cambie nada, y la regla se evalúa sobre el estado resultante: un `PUT` que solo manda `lastMenstruationDate` y descuadra el rango con la FPP **ya guardada** también responde 400.
- [ ] Los números 266 y 294 no aparecen en el servicio: `grep -n "266\|294" src/services/notificationPregnancy.service.ts` no devuelve resultados.
- [ ] El servicio no consulta `esaviCase` ni `notificationVaccine`: `grep -n "EsaviCase\|NotificationVaccine" src/services/notificationPregnancy.service.ts` no devuelve resultados fuera del `include` del `001`, que llega a `patient` y para ahí.

**`wasPregnantAtVaccination`:**

- [ ] Un `POST` sin el campo responde **400** del validador y no llega al servicio.
- [ ] Un `POST` con `'NO'`, con `'UNKNOWN'` y con `'NO_ANSWER'` responde **201** en los tres casos: se exige la respuesta, no un contenido.
- [ ] Un `POST` con `'MAYBE'` responde 400 del validador, no 500.
- [ ] Un `PUT` con `wasPregnantAtVaccination: null` responde **200** y deja la columna en `null`.
- [ ] En `CreateNotificationPregnancyInput` es el único campo de datos declarado sin `?`.

**Visibilidad heredada y estado:**

- [ ] Un embarazo cuya notificación está inactiva responde 404 en `003` y en `006` para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] Un embarazo inactivo con la notificación activa responde lo mismo.
- [ ] Crear sobre una notificación inactiva responde 404.
- [ ] Crear sobre una notificación `NON_SEVERE` responde **201**: no hay filtro por `notificationType`.
- [ ] `GET /api/notification-pregnancies/purge/algo` responde 400 de UUID, no 404 de embarazo.
- [ ] El `005B` es una delegación limpia: `grep -n "transaction" src/services/notificationPregnancy.service.ts` no devuelve resultados.
- [ ] `git diff --stat src/services/common/entityPurge.service.ts src/services/common/entityActivation.service.ts` no muestra cambios.

**El `006` y la ausencia de listado:**

- [ ] `GET /notification/:notificationId` devuelve la fila como objeto, **no** `{ count, rows }`.
- [ ] Una notificación existente y activa **sin** embarazo responde 404 `NOTIFPRG_006_NOT_FOUND`; una notificación inexistente responde 404 `NOTIFPRG_006_NOTIFICATION_NOT_FOUND`. Son dos códigos distintos y los dos están montados en la suite.
- [ ] `grep -n "findAndCountAll\|DEFAULT_LIMIT\|DEFAULT_OFFSET" src/services/notificationPregnancy.service.ts` no devuelve resultados.

**No es hoja del grafo:**

- [ ] Purgar un embarazo con dos complicaciones deja **una** línea `warn` con los dos `complicationId`, y las dos filas hijas desaparecen de la base por cascada.
- [ ] Purgar un embarazo sin complicaciones **no** deja esa línea.
- [ ] Desactivar un embarazo con complicaciones vivas responde **200**: el `005A` no se bloquea por nada.
- [ ] Purgar una notificación con embarazo deja **una** línea `warn` con su `pregnancyId`, y las de eventos, medicamentos, vacunas y diluyentes siguen apareciendo.
- [ ] `git diff --stat src/services/severeNotification.service.ts` no muestra cambios: la convivencia con `hasPregnancyComplications` se declara en §6, no se implementa.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/notificationPregnancy.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

Sobre el último: la primera mitad se cumple en su forma propia —un `PUT` sobre un embarazo cuya **notificación** está inactiva responde **404** aunque el body sea idéntico al guardado, por la visibilidad heredada—. La segunda mitad **no aplica**: esta tabla no tiene `code` ni ninguna unicidad que el `004` pueda violar, porque su única `UNIQUE` es sobre `notificationId`, que es inmutable. Se anota como tal y no se borra, igual que F22 y F24 hicieron con el suyo.

- [ ] Un `PUT` con `notes: "  Gestante de 32 semanas  "` sobre un `Gestante de 32 semanas` guardado responde **200 sin escribir** — el `trim()` corre antes de comparar.
- [ ] Un `PUT` con `notes: ""` sobre unas `notes` guardadas las deja en `null` — `normalizeText` convierte el texto vacío en ausencia.
- [ ] Un `PUT` que mueve un tri-estado de `null` a `'NO_ANSWER'` **sí** escribe, y al revés también: son datos distintos.
- [ ] Un `PUT` que solo cambia `notes` deja los tres tri-estado y las dos fechas idénticos.
- [ ] Un `PUT` con `notificationId` distinto responde **200**, no lo modifica y no cuenta como cambio.

**Cierre:**

- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Superficie y numeración**

- **Sí:** `NOTIFPRG`, ocho letras. Mantiene el prefijo que ya identifica a la familia (`NOTIFCN`, `NOTIFEVT`, `NOTIFMED`, `NOTIFVAC`, `NOTIFDIL`) y deja libre `PREGCOMP` para la tabla hija, que la necesitará. `PREGNANT` sin prefijo se descartó por romper la simetría de las seis hermanas.
- **Sí:** siete operaciones, sin `002` en ninguna forma. La `UNIQUE` de `:902` hace que cada notificación tenga como mucho un embarazo: un listado devolvería siempre cero o una fila, con paginación que nunca pagina y un `count` que solo vale 0 o 1. Es la forma de F13 y F14.
- **Sí:** `005A` y `005B`, a diferencia de F13 y F14. Esas dos tablas no tienen `isActive`; ésta sí (`:895`). La superficie se deriva del esquema, no de la analogía con la satélite más parecida.
- **Sí:** `006` por `notificationId`, registrado como operación no canónica. Es el punto de entrada real: quien abre el formulario de una notificación tiene su `notificationId`, no el `pregnancyId`.
- **Sí:** ruta base `/api/notification-pregnancies`, en plural con guiones y con el nombre completo de la tabla. El prefijo `notification-` distingue de las tablas de embarazo de investigación —`investigationPregnancyCondition` (`:1065`)—, que competirían por el mismo espacio de nombres.
- **Sí:** `001`, `003`, `004` y `006` en USER. Es la desviación que F05, F06, F07, F09, F10, F13 y F14 fijaron: el detalle clínico se captura en el mismo flujo que la notificación.

**La forma uno a uno y la `UNIQUE` plana**

- **Sí:** 409 en el `001` aunque la fila que estorba esté **inactiva**. Es la lectura honesta de `:902`, que no se condiciona a `deletedAt`. Decir 201 y dejar que estalle un `23505` sería mentirle al cliente sobre lo que va a pasar.
- **No:** que el `001` reactive la fila inactiva. Convertiría un `POST` en un `PATCH` intermitente: el mismo verbo crearía o resucitaría según un estado que el cliente no ve. El repositorio no tiene ese patrón y no se estrena aquí. El camino de vuelta —`005B`— existe, es explícito, y el mensaje de `alreadyExists` lo nombra.
- **No:** convertir la `UNIQUE` en índice parcial sobre `deletedAt IS NULL`, al estilo de `UQ_notificationDiluent_parent_sortOrder`. Sería cambio de DDL, y dejaría convivir dos filas de embarazo por notificación —una viva y una borrada—, con la pregunta abierta de cuál devuelve el `006` cuando alguien reactiva la vieja.
- **Sí:** validar la unicidad en el servicio con un `findOne` y `paranoid: false`, en vez de declarar `unique: true` en el modelo. Sequelize no comprueba `unique` antes del `INSERT`: declararlo solo documenta, y el 409 hay que producirlo igual.
- **Sí:** `hasOne` y no `hasMany` en la asociación inversa, y **sin** incluirla en ninguna respuesta de `notification`. Es el criterio de `notification.associations.ts:14`, con su razón escrita ahí: declarar la asociación invita a incluirla, y eso sería un cambio de contrato en F10.

**El sexo del paciente**

- **Sí:** validar que el paciente sea femenino. Un embarazo registrado sobre un paciente masculino es un error de captura con consecuencias clínicas, no una rareza tolerable.
- **Sí:** leer el `catalogItemId` femenino de `systemConfig`, aunque eso convierta a una entidad sin implementar en dependencia dura. Las alternativas eran peores, y las tres se consideraron:
  - **No:** comparar contra un `catalogItem.code` fijado como constante. `catalogItem.service.ts:72` y `:188` acuñan el código **siempre** desde el propio `name` con `mintCatalogItemCode`, y ningún `code` viaja en el body ni en el archivo de importación. El código resultante depende del idioma con que se cargó el catálogo: `'femenino'` en un despliegue, `'female'` en otro. Además, **ningún servicio del repositorio compara hoy un `catalogItem.code` contra una constante**, y estrenar ese acoplamiento aquí lo volvería precedente para las 37 tablas pendientes.
  - **No:** comparar contra `catalogItem.value = '2'`, el código administrativo de ISO 5218. Es mejor que el `code` —`value` es texto libre y la acuñación no lo toca— pero sigue siendo una constante en el código que depende de que alguien cargue el catálogo con ese valor, sin nada que lo declare ni lo verifique.
  - **No:** pedir `patientId` en el body del `001`. Es derivable de `notificationId`, así que introduce un par que puede llegar incoherente y obliga a validar que el paciente enviado sea de verdad el del caso. Un dato que el servidor deduce no se le pide al cliente.
- **Sí:** que el sexo llegue por el `include` de tres saltos de la consulta que ya se hace, y no por una segunda consulta. `notification → case → patient` se apoya en asociaciones que F06 y F10 ya declararon; la regla no cuesta un viaje más a la base.
- **Sí:** `sexItemId: null` no bloquea. El sexo desconocido no es prueba de que no haya embarazo, y bloquearlo perdería el caso entero por un dato demográfico que se puede completar después.
- **Sí:** 500 y no 400 cuando la configuración falta. Es la decisión menos evidente del spec y la más fácil de invertir por parecer «más amable». Un 400 le dice al notificador que su envío está mal cuando el problema es que nadie sembró una fila en el despliegue: le hace buscar el error donde no está. El 500 lo pone donde está, en el servidor, y sale en el log.
- **Sí:** la regla corre **solo en el `001`**. El sexo del paciente no cambia por un `PUT` al embarazo, y revalidarlo en cada update haría fallar la edición de un registro que ya existe si alguien corrigió el catálogo entretanto — bloqueando precisamente la corrección de datos que el `004` sirve para hacer.
- **No:** validar la edad del paciente contra `birthDate`. Cruzaría las mismas tres tablas para bloquear capturas legítimas sobre datos incompletos. F13 §6 ya lo descartó y no hay razón nueva.

**`wasPregnantAtVaccination`**

- **Sí:** obligatorio en el `001`, aunque el DDL lo declare anulable. Una fila de embarazo que no dice si había embarazo no informa de nada; es el equivalente a la fila vacía que F24 combatió con su guarda de contenido mínimo, pero aquí el campo que la evita es uno concreto y nombrable.
- **Sí:** se exige la **respuesta**, no un valor. `'NO'`, `'UNKNOWN'` y `'NO_ANSWER'` son válidos. Exigir `'YES'` convertiría la tabla en un registro de embarazos confirmados y perdería el caso que más importa documentar: la vacunación de alguien de quien no se sabía si estaba embarazada.
- **Sí:** anulable en el `004`. Es asimétrico y deliberado. El `001` garantiza que la fila nace informada; el `004` sirve para **corregir**, y un notificador que descubre que respondió por error tiene que poder retirar la respuesta sin borrar la fila entera. La alternativa —obligarle a un `005A` y volver a crear— pierde el `pregnancyId` y toda su auditoría.
- **No:** una guarda de contenido mínimo genérica al estilo de F24. Aquí no hace falta: hay un campo concreto que es la razón de ser de la tabla, y exigirlo es más claro que exigir «al menos uno de los seis».

**El rango gestacional**

- **Sí:** 266 a 294 días inclusive, que es Naegele con ±14 días —38 a 42 semanas—. Una FPP fuera de ese rango respecto de la última menstruación es casi siempre un error de captura o de conversión de fechas.
- **Sí:** **un solo error**, que absorbe el caso de una FPP anterior a la menstruación. Partirlo en dos mensajes no le da al cliente nada accionable de más: lo que necesita saber es que las dos fechas no cuadran entre sí.
- **Sí:** bloquear con 400 aunque una FPP fijada por ecografía pueda caer legítimamente fuera del rango. **No hay columna que registre la fuente de la FPP**, así que no hay forma de distinguir ese caso de un error de captura, y la elección es entre bloquear los dos o ninguno. Se asume el coste: es la decisión más discutible del spec y la que primero habría que revisar si el campo resulta molesto en producción. La salida limpia sería una columna que declare la fuente, y eso es cambio de DDL en otro spec.
- **Sí:** los límites como constantes con nombre, con criterio de aceptación que prohíbe los números sueltos en el servicio. Son valores clínicos que alguien va a querer ajustar, y buscarlos por `grep` de `294` es peor que leerlos de `notification.constants.ts`.
- **Sí:** la regla no aplica si falta cualquiera de las dos fechas. Las dos son anulables y un embarazo del que solo se conoce una fecha es un registro legítimo.
- **No:** ninguna regla que compare `probableDeliveryDate` con hoy. Una FPP en el pasado es un embarazo ya terminado, que es exactamente el caso que muchos ESAVI en gestantes documentan.
- **No:** cruzar las fechas con `esaviCase.eventDate` o con `notificationVaccine.vaccinationDate`. La regla es interna a la fila y no sube por el grafo. Es el criterio de un solo salto de F24 §6 llevado al extremo: aquí no hay ni un salto, y añadirlo ataría esta entidad a tablas que no la gobiernan.
- **No:** reglas cruzadas entre los dos tri-estado. Un `wasPregnantAtVaccination: 'NO'` con `wasPregnantAtEsavi: 'YES'` es un embarazo iniciado después de la vacunación: legítimo, y clínicamente relevante precisamente por serlo.

**`hasComplications` y la convivencia con `severeNotification`**

- **Sí:** `hasComplications` es dato del cliente en este spec. Derivarlo de `notificationPregnancyComplication` sería derivar de una tabla que todavía no tiene modelo, y un derivado que cuenta filas inexistentes vale siempre `'NO'`.
- **Sí:** dejar abierta la decisión de derivarlo, para el spec de la tabla hija. Ahí sí habrá filas que contar, y ahí se decidirá si el campo pasa a ser derivado —entrando en `candidates` **siempre**, como manda F12— o se queda como declaración independiente del notificador.
- **Sí:** responder la pregunta que F13 dejó abierta con **«conviven y no se sincronizan»**. `severeNotification.hasPregnancyComplications` y `pregnancyComplicationsDescription` (`:753-754`) son columnas de aquella tabla y siguen siéndolo. Sincronizarlas con `hasComplications` obligaría a decidir cuál gana cuando difieren, a escribir en una tabla ajena desde este servicio, y a hacerlo en las dos direcciones. Es un spec de consolidación, no una nota al pie de un CRUD.
- **No:** migrar `pregnancyComplicationsDescription` a la tabla hija ahora. Es la evolución natural —una descripción de complicación pertenece a la fila de la complicación— pero mover una columna con datos ya cargados es una migración, no un CRUD.

**Estado, cascada y visibilidad**

- **Sí:** un `005B` que delega sin más. La tabla no tiene `sortOrder`, no figura en `setSortOrderByParent` (`:1305-1313`) y no tiene índice único parcial. El choque que F16 descubrió y que F21, F22 y F24 arrastraron **aquí no existe**, y copiar su solución produciría una transacción y una consulta que no corrigen nada.
- **Sí:** el `005B` no revalida nada — ni el sexo, ni el rango, ni el estado de la notificación. Reactivar es deshacer una desactivación.
- **Sí:** volcar la cascada del `005C` con `sequelize.query`. La tabla hija no tiene modelo hasta su propio spec, y es literalmente la situación de F22 con `notificationDiluent`. Cuando `notificationPregnancyComplication` se implemente, su spec decidirá si reescribe esta consulta o la deja, con el mismo criterio con que F24 decidió no tocar la de F22.
- **Sí:** una línea de log en la cascada de `ESAVI-NOTIFCN-005C`, resuelta con el `hasOne` y sin SQL crudo. Sin ella, purgar una notificación destruye un embarazo sin dejar rastro.
- **Sí:** visibilidad heredada de **un** salto. `notificationPregnancy` cuelga directamente de la cabecera, así que la cadena de dos niveles que F24 estrenó no aplica. Componerla igualmente por simetría añadiría un `include` que no protege de nada.
- **Sí:** el `005A` no se bloquea por complicaciones vivas. La visibilidad heredada que el spec de la tabla hija declare resolverá su lectura, que es como el repositorio ha resuelto siempre el arrastre de estado.
- **Sí:** ningún cambio en `esaviapp.sql`. La `UNIQUE` de `:902` ya crea el índice sobre la única columna por la que se filtra, y no hay ningún tipo mal elegido que corregir.
- **Sí:** no filtrar por `notificationType`, desviándose de F13. Aquella tabla **es** el detalle de una notificación grave y su nombre lo dice; ésta no: un embarazo importa igual en una notificación no grave, y el DDL no declara ninguna restricción de tipo.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **F25 se implementa antes que `systemConfig`** y alguien resuelve el bloqueo dejando la regla del sexo fuera «temporalmente», que es como se queda para siempre | El header lo declara dependencia dura, §2 lo repite como precondición, §4 lo pone como bloqueo previo con la lista exacta de pasos ejecutables sin él, y §5 tiene siete criterios que quedan en rojo mientras el paso 8 no exista. Un F25 sin paso 8 **no está terminado** |
| **La fila `PREGNANCY_FEMALE_SEX_ITEM` no está sembrada el día del despliegue** y el `001` responde 500 en cada intento: el endpoint nace inservible | Declarado en §2 como precondición de datos. Es el riesgo que **no se cierra con código ni con pruebas**: la fila se carga por el `001` de `systemConfig` antes de abrir el endpoint, y conviene verificarlo en el mismo despliegue. El 500 y su clave i18n propia hacen que el fallo se diagnostique en un vistazo del log |
| **El 500 de configuración se «arregla» convirtiéndolo en 400**, y el notificador pasa a buscar el error en su formulario | §6 razona por qué es 500, §3.5 lo fija y §5 lo verifica con tres escenarios: clave ausente, clave inactiva y clave apuntando a un `catalogItemId` inexistente. Los tres responden 500, nunca 400 y nunca 201 |
| **El `001` responde 201 sobre una notificación con embarazo desactivado**, porque quien lo implemente comprueba la unicidad sin `paranoid: false` y da por hecho que el borrado lógico libera el hueco — que es lo que pasa en las cuatro satélites anteriores | Es el error más probable de todo el spec, porque contradice la intuición que F16, F21, F22 y F24 construyeron. §1.B lo razona desde el DDL, §3.5 exige `paranoid: false`, y §5 lo verifica como escenario **separado** del 409 sobre fila activa |
| Se copia el `005B` de F24 con su transacción y su reasignación de `sortOrder`, sobre una tabla que no tiene esa columna | §3.5 y §6 dicen que aquí la delegación es limpia; §5 lo verifica por ausencia con `grep -n "transaction"` y con el `grep` de `sortOrder` sobre modelo, tipos y servicio |
| Se declara `unique: true` en el modelo y alguien da por hecho que Sequelize produce el 409 | §3.2 y §6 explican que Sequelize no lo comprueba antes del `INSERT`; §5 exige que la suite completa no produzca ningún `23505` y que `grep -n "unique"` sobre el modelo no devuelva nada |
| **La regla del rango bloquea una FPP legítima fijada por ecografía**, y el campo se vuelve molesto en producción | Asumido y razonado en §6, que además nombra la salida limpia: una columna que declare la fuente de la FPP, en otro spec. Los límites son constantes con nombre precisamente para que ajustarlos sea una línea |
| La regla del rango se implementa con límites exclusivos y 266 o 294 días exactos quedan bloqueados | §5 fija los cuatro bordes: 266 y 294 responden 201; 265 y 295 responden 400 |
| La regla del rango se evalúa sobre el body en el `004`, y un `PUT` que solo mueve `lastMenstruationDate` descuadra el rango sin que nadie lo note | §3.5 exige evaluarla sobre el estado resultante; §5 lo verifica con el caso de un `PUT` que solo manda una de las dos fechas |
| **`wasPregnantAtVaccination` se hace obligatorio también en el `004`** por simetría con el `001`, y se pierde la vía para corregir una respuesta dada por error | §6 razona la asimetría y §5 exige que un `PUT` con `null` responda 200 y vacíe la columna |
| Se exige `'YES'` en vez de exigir solo que el campo llegue, y se pierde el caso de la vacunación con embarazo no conocido | §2, §3.5 y §5 lo fijan: los cinco valores del enum son válidos, y hay criterio explícito para `'NO'`, `'UNKNOWN'` y `'NO_ANSWER'` |
| **`hasComplications` se deriva de la tabla hija** en cuanto ésta exista, sin que nadie revise si el `004` sigue siendo el caso limpio de F12 | §6 deja la decisión explícitamente para el spec de la tabla hija, y recuerda que un derivado entra en `candidates` **siempre**, sin `if` de presencia |
| Se sincroniza `hasComplications` con `severeNotification.hasPregnancyComplications` «ya que estamos», y el servicio empieza a escribir en una tabla ajena | §2 lo pone fuera de alcance, §6 lo razona con la pregunta de cuál gana cuando difieren, y §5 exige que `git diff --stat src/services/severeNotification.service.ts` no muestre cambios |
| Se filtra por `notificationType` copiando el `SEVNOT_001_NOTIFICATION_NOT_SEVERE` de F13 | §6 razona la desviación y §5 la fija: crear sobre una notificación `NON_SEVERE` responde **201** |
| Se añade un `002` «porque todas las satélites lo tienen» | §5 lo vigila por ausencia: `grep -rn "ESAVI-NOTIFPRG-002" src/` no debe devolver resultados, y el servicio no puede contener `findAndCountAll` |
| Se copia el `005C` de F24, que no tiene consulta previa, y purgar un embarazo destruye complicaciones sin dejar rastro | §3.5 exige la consulta con `sequelize.query`, y §5 la verifica con dos complicaciones y con el caso de cero, que **no** debe dejar línea |
| Se valida el sexo con una segunda consulta al paciente, duplicando un viaje que el `include` ya hace | §5 lo vigila por ausencia: `grep -n "Patient.find"` sobre el servicio no debe devolver resultados |
| `GET /:id` captura `/notification`, `/purge` o `/activate` como UUID | Las tres literales se declaran antes que `/:id`, en el orden exacto de §3.4; cubierto por la suite de contrato |
| Se redeclara `ANSWER_OPTIONS` en `notification.constants.ts` | Ese archivo ya lo advierte en su comentario de `:9-11`; el paso 2 del plan lo verifica |

**§8 no aplica.** Este spec añade endpoints nuevos y una línea de log en un servicio existente. Ningún status, campo ni mensaje que los clientes ya reciben cambia de forma, y `esaviapp.sql` no se toca.

---

## Lo que **no** está en este spec

- **`notificationPregnancyComplication`** (`esaviapp.sql:905-923`), la octava y última satélite de `notification`. Va en su propio spec, que dependerá de éste.
- **El CRUD de `systemConfig`.** F25 lee una clave y no escribe ninguna. `valueType`, `scope`, `isEncrypted`, `isEditable` y `systemConfigHistory` son materia de su propio spec, que se implementa **antes** que éste.
- **Sembrar la fila `PREGNANCY_FEMALE_SEX_ITEM`**, ni el catálogo de sexo al que apunta. Son precondiciones de datos, no código que este spec escriba.
- **Cualquier sincronización con `severeNotification`.** `hasPregnancyComplications` y `pregnancyComplicationsDescription` siguen siendo columnas de aquella tabla; la respuesta a F13 es que conviven.
- **Migrar `pregnancyComplicationsDescription` a la tabla hija.** Es una migración de datos, no un CRUD.
- **Derivar `hasComplications` de las complicaciones.** Lo decidirá el spec de la tabla hija.
- **Validar la edad del paciente**, ni ningún otro dato demográfico más allá del sexo.
- **Cruzar las fechas con `esaviCase.eventDate` o con `notificationVaccine.vaccinationDate`.** La regla gestacional es interna a la fila.
- **Cualquier regla cruzada entre los dos tri-estado**, y cualquiera que ate `hasComplications` a las fechas.
- **Cualquier regla sobre `probableDeliveryDate` respecto de hoy.**
- **Distinguir la fuente de la FPP** — no hay columna que la registre, y añadirla es cambio de DDL en otro spec.
- **Reactivar la fila desde el `001`.** Un `POST` que a veces es un `PATCH` no existe en este repositorio.
- **Convertir `UQ_notificationPregnancy_notification` en índice parcial.**
- **Cualquier forma de `002`**, y cualquier paginación o filtro. No hay listado.
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la quinta copia y el refactor esté vencido desde F24 §7.
- **Modificar `esaviapp.sql`**, `purgeEntityService` o `setEntityActiveStatusService`.
- **Incluir el embarazo en la respuesta de `notification`.** El contrato de F10 no cambia.
- Cifrado de ningún campo.
- Crear la fila de embarazo automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
