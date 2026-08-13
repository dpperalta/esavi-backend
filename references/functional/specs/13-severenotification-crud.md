# SPEC F13 — CRUD de `severeNotification`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F10 (`notification` — dependencia dura: la PK de esta tabla *es* su FK, y su ciclo de vida lo gobierna aquella entidad)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa)
> **Fecha:** 2026-08-12
> **Objetivo:** Dar de alta `severeNotification`, el detalle clínico de una notificación grave, como la primera entidad del repositorio **sin columna `isActive`**: su ciclo de vida no es suyo, lo gobierna íntegramente su cabecera.

---

## 1. Por qué existe este spec

`severeNotification` es la **primera de las ocho tablas satélite de `notification`** que recibe implementación. El [SPEC F10](./10-notification-header-crud.md) las dejó fuera de alcance a propósito y en bloque: entregó la cabecera de la notificación —qué ocurrió, cuál fue el desenlace, si se pide investigación— y aplazó el detalle clínico. Este spec entrega el detalle de la rama grave: antecedentes de eventos previos, tres tipos de alergia y complicaciones del embarazo.

Hoy la tabla existe en `esaviapp.sql:743-758` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Cuatro rasgos la separan de todo lo especificado hasta ahora, y los cuatro empujan en la misma dirección — **esta entidad no tiene vida propia**.

**A — La clave primaria *es* la clave foránea.** `notificationId` se declara `uuid PRIMARY KEY` **sin `DEFAULT gen_random_uuid()`** (`esaviapp.sql:744`) y a la vez es el destino de `FK_severeNotification_notification` (`esaviapp.sql:757`). No hay identificador propio que generar: la fila no se identifica a sí misma, se identifica por la notificación que extiende. El uno a uno no necesita ninguna `UNIQUE` adicional —lo impone la propia PK—, a diferencia de `classification` y `notification`, que sí llevan la suya sobre `caseId`. Intentar crear el segundo detalle de una misma notificación es una colisión de clave primaria.

**B — No tiene `isActive`, y es la primera del repositorio.** De las cuatro columnas transversales que el canon da por presentes en toda tabla del esquema, aquí falta la primera: hay `deletedAt`, `sysDetails` y `appDetails`, pero **no hay `isActive`**. No es un descuido del DDL: `nonSevereNotification` (`esaviapp.sql:760-783`) tampoco la tiene, así que el esquema decidió que las satélites no gestionan su propio estado.

Eso rompe los dos servicios comunes que toda entidad usa hoy:

- `setEntityActiveStatusService` compara `current.isActive === options.isActive` (`src/services/common/entityActivation.service.ts:28`) y después escribe `isActive` (`:33`). Sobre esta tabla el 409 de «ya está en ese estado» nunca saltaría, y el `UPDATE` fallaría en Postgres contra una columna que no existe.
- `purgeEntityService` corta con `if( current.isActive === true )` (`src/services/common/entityPurge.service.ts:30`). Aquí eso es `undefined !== true`: **toda fila sería purgable de inmediato**, sin la retirada previa que §6 del canon llama «la red de seguridad».

La consecuencia de diseño es la decisión central del spec: **`severeNotification` no expone `005A` ni `005B`**. No hay estado que activar ni desactivar. Lo que hay es un `deletedAt` que sella la cabecera al retirarse, y lo limpia al volver.

**C — El `ON DELETE CASCADE` del DDL aquí *sí* dispara, y era una advertencia escrita.** En `notifier`, `classification` y `notification`, la cascada declarada sobre `esaviCase` nunca se ejecuta: `TRG_esaviCase_preventPhysicalDelete` impide todo borrado físico del padre. Aquí el padre es `notification`, que **no** figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1354-1360`), así que `FK_severeNotification_notification` con su `ON DELETE CASCADE` (`esaviapp.sql:757`) es una cascada real: **`ESAVI-NOTIFCN-005C` destruye esta fila sin pedir confirmación y sin dejar rastro propio**.

El F10 lo dejó anotado palabra por palabra en su §3.5: «*las ocho declaran `ON DELETE CASCADE` sobre `notificationId`, así que un `005C` arrastrará consigo toda la notificación detallada sin pedir confirmación. Hoy no hay nada que arrastrar; **cuando lo haya, esa operación debe revisarse**»*. Este spec es ese «cuando lo haya», y la revisión está en §8.

**D — Es la primera consumidora del ENUM `answerOption` fuera de `notification`, y dispara una mudanza ya comprometida.** Los cinco campos de respuesta de la tabla son `"answerOption"` (`esaviapp.sql:26`), el mismo ENUM que `notification` usa en dos columnas. `src/constants/notification.constants.ts:10-12` dejó la instrucción escrita: «*`answerOption` lo comparten seis tablas más… cuando se especifique la primera, esta constante **se mueve** a un archivo compartido — no se copia*». Ésta es esa primera.

**Y un rasgo que *no* la separa:** el trigger. `TRG_severeNotification_setSysDetails` lo monta el bucle genérico sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1275-1290`), así que cada `UPDATE` incrementa `sysDetails.version` y añade un evento a `auditTrail` exactamente igual que en el resto. No existe `TRG_severeNotification_setUpdatedAt` —el bucle lo hace `DROP` y no lo crea en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `severeNotification`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Cinco operaciones, no siete:** `001` crear, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** La tabla no tiene `isActive` y esta entidad no gestiona su estado: lo gobierna su cabecera. Retirar el detalle es retirar la notificación.
- **Ningún listado.** Ni `002`, ni `002A`, ni `002B`. Razonado en §6 y repetido al final: sin `isActive` las dos variantes del listado dual devolverían exactamente las mismas filas y se diferenciarían solo en el rol exigido.
- Relación **uno a uno** con `notification`, sostenida por la propia clave primaria. Crear el segundo detalle de una misma notificación devuelve **409**.
- **Guardas del alta**, en este orden: la notificación existe y está **activa** → 404; su `notificationType` es **`SEVERE`** → 409; no tiene ya detalle → 409.
- **Visibilidad heredada de la cabecera.** Toda lectura incluye `notification` y comprueba su `isActive`: si la notificación está inactiva, el detalle responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Regla de coherencia del embarazo**, evaluada en el servicio sobre el **estado resultante** en el `004`, no sobre el body: con `hasPregnancyComplications: 'YES'` la descripción es obligatoria → 400; con cualquier otro valor o con `null`, enviar descripción es → 400.
- **Arrastre desde la cabecera, por los dos caminos que la desactivan.** `ESAVI-NOTIFCN-005A` y `ESAVI-CASE-005A` sellan el `deletedAt` del detalle y le añaden entrada a `appDetails` con el código de la operación que lo arrastró. Implica modificar `src/services/notification.service.ts` y `src/services/esaviCase.service.ts`.
- **`ESAVI-NOTIFCN-005B` limpia ese `deletedAt`.** Es la **primera excepción** al criterio de «cascada solo de bajada» que fijó el SPEC F07 y heredaron el F09 y el F10, y va razonada en §6. `ESAVI-CASE-005B` no limpia nada, porque tampoco reactiva la notificación.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `SEVNOT_005C_NOT_DELETED`. Se comprueba **en el servicio de la entidad, antes de delegar**, sin tocar `purgeEntityService` ni el comportamiento de las cuatro entidades que ya lo usan.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12): los siete campos son anulables y entran comparados contra `undefined`; `notificationId` es inmutable y se ignora si llega.
- **Mudanza de `ANSWER_OPTIONS` y `AnswerOption`** de `src/constants/notification.constants.ts` a `src/constants/enums.constants.ts`, con los importadores actuales apuntando al archivo nuevo. Se mueve, no se copia: es la instrucción que el propio archivo dejó escrita en sus líneas 10-12.
- **Volcado al log de la fila arrastrada por `ESAVI-NOTIFCN-005C`**, en nivel `warn`, antes de que la cascada de Postgres la destruya. Sin bloquear la purga.
- Alta de la abreviatura `SEVNOT` en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Cinco filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **108 a 113**—, suite `tests/contract/severeNotification.test.ts`, y ampliación de `tests/contract/notification.test.ts` y `tests/contract/esaviCase.test.ts` con el arrastre.

**Fuera de alcance (otros specs):**

- **Las otras siete satélites de `notification`:** `nonSevereNotification` (`esaviapp.sql:760-783`), `notificationEvent` (`785-808`), `notificationMedication` (`810-831`), `notificationVaccine` (`833-857`), `notificationDiluent` (`859-878`), `notificationPregnancy` (`880-897`) y `notificationPregnancyComplication` (`899-920`).
- **`nonSevereNotification` en particular**, que es la hermana simétrica de ésta y comparte todos sus rasgos estructurales. Este spec **reserva** `NSEVNOT` como su abreviatura futura y no la da de alta: se registra cuando se escriba su spec.
- **`notificationPregnancy` y `notificationPregnancyComplication`.** Que existan tablas propias para el embarazo no cambia nada aquí: `hasPregnancyComplications` y su descripción son columnas de esta tabla y se tratan como tales. La relación entre ambas —si la descripción debiera migrar allí— es una pregunta para el spec de aquellas.
- **Cualquier listado de detalles graves**, y cualquier filtro o conteo por los cinco `answerOption`. Si aparece un tablero que lo pida, es un `002` en su propio spec.
- **Contrastar `hasPregnancyComplications` con el sexo o la edad del paciente.** Cruzaría tres tablas para validar un campo opcional y bloquearía capturas legítimas en datos incompletos.
- **Cualquier regla cruzada contra `classification`**, incluido comprobar que un detalle grave concuerde con `classification.isSeriousEvent`. Son dos satélites hermanos de ramas distintas y ninguno referencia al otro.
- **Bloquear `ESAVI-NOTIFCN-005C` cuando la notificación tiene detalle grave.** Se deja disparar la cascada, con el volcado al log como única mitigación. Razonado en §6 y detallado en §8.
- **Añadir `isActive` a `severeNotification`**, ni ninguna otra modificación de `esaviapp.sql`: ni la FK, ni su `ON DELETE CASCADE`, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- **Modificar `setEntityActiveStatusService` o `purgeEntityService`.** Los dos se quedan como están; lo que esta entidad necesita distinto lo resuelve en su propio servicio.
- Cifrado de ningún campo. El detalle es clínico, no identificativo: el paciente ya está cifrado en su tabla.
- Búsqueda por texto sobre `pregnancyComplicationsDescription` o `notes`. No existe `Op.iLike` en ningún servicio del repositorio.
- Crear el detalle automáticamente al dar de alta una notificación con `notificationType: 'SEVERE'`. Son dos actos distintos, y el F10 ya declaró que el tipo no exige ninguna fila satélite.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`severeNotification` — `esaviapp.sql:743-758`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `notificationId` | `uuid` | no | **PK y FK a la vez**. Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente |
| `hasPreviousEventHistory` | `"answerOption"` | sí | ENUM de 5 valores; tri-estado con `null` |
| `hasAllergyToOtherVaccines` | `"answerOption"` | sí | ídem |
| `hasAllergyToMedications` | `"answerOption"` | sí | ídem |
| `hasAllergyToPreviousSameVaccine` | `"answerOption"` | sí | ídem |
| `hasPregnancyComplications` | `"answerOption"` | sí | ídem. Gobierna la regla de coherencia |
| `pregnancyComplicationsDescription` | `text` | sí | solo con `hasPregnancyComplications: 'YES'` |
| `notes` | `text` | sí | texto libre |

**Restricciones.** Una sola: `FK_severeNotification_notification` → `notification("notificationId")`, `ON UPDATE CASCADE ON DELETE CASCADE` (`esaviapp.sql:757`). **Ninguna `UNIQUE`** —no hace falta, la PK ya lo es— y **ningún `CHECK`**. Ningún índice declarado más allá del que Postgres crea de oficio para la clave primaria.

**El ENUM.** `answerOption` — `esaviapp.sql:26` — `('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER')`. Compartido con `notification` y con cinco tablas más. Añadirle un valor es una migración del esquema. Un `INSERT` con otra cadena falla con `22P02` y llegaría al cliente como 500, así que la validación de entrada de §3.5 es obligatoria, no defensiva.

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB). **Falta `isActive`.** Es la anomalía declarada en §1-B y no se corrige: es deliberada del esquema —`nonSevereNotification` tampoco la tiene— y arreglarla obligaría a tocar el DDL y a arrastrar a las otras siete satélites.

**Triggers.** Solo `TRG_severeNotification_setSysDetails`, del bucle genérico que monta el trigger sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1275-1290`). No existe `TRG_severeNotification_setUpdatedAt` ni `TRG_severeNotification_preventPhysicalDelete`: la tabla no figura en el bucle de `esaviapp.sql:1354-1360`, así que un `DELETE` físico ejecuta sin error y le corresponde la operación `005C`.

### 3.2 Modelo Sequelize

Archivo: `src/models/severeNotification.model.ts`. Clase `SevereNotification`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'severeNotification'`.

**La PK se declara sin `defaultValue`.** Es la diferencia con los quince modelos anteriores, y es intencionada: `notificationId` va `primaryKey: true`, `allowNull: false` y **sin** `sequelize.literal('gen_random_uuid()')`. Declarar el default haría que un alta sin `notificationId` generase un UUID huérfano que la FK rechazaría después, convirtiendo un 400 legible en un error de integridad.

Los cinco campos de respuesta se declaran con `DataTypes.ENUM(...ANSWER_OPTIONS)`, alimentado por la constante compartida de §3.3 y nunca por literales, siguiendo la regla que el F10 fijó al introducir el primer ENUM del repositorio. Los dos textos van `DataTypes.TEXT`, todos `allowNull: true`.

**No se declara ningún atributo `isActive`.** Sería inventar una columna que el DDL no tiene, y Sequelize la incluiría en cada `SELECT`.

Asociaciones, en `src/models/associations/severeNotification.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `SevereNotification.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasOne(SevereNotification, { as: 'severeNotification', foreignKey: 'notificationId' })`

Las dos usan la misma columna en los dos lados, porque la PK del destino y la del origen son la misma. El inverso se declara porque lo necesitan el arrastre y el volcado al log de §3.5; **no se añade a ninguna respuesta de `notification`**, cuyo contrato HTTP no cambia. Alta en `src/models/index.ts`.

### 3.3 Tipos y constantes

**La mudanza del ENUM compartido.** Archivo nuevo `src/constants/enums.constants.ts`:

```ts
export const ANSWER_OPTIONS = ['YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] as const;
export type AnswerOption = (typeof ANSWER_OPTIONS)[number];
```

`src/constants/notification.constants.ts` se queda **solo** con `NOTIFICATION_TYPES` y `NotificationType`, y su comentario de las líneas 10-12 —el que anunciaba esta mudanza— se sustituye por el hecho consumado. Los importadores actuales de `ANSWER_OPTIONS` pasan a apuntar al archivo nuevo. Se **mueve**, no se copia: dos listas del mismo ENUM divergen en cuanto alguien añada un valor a una sola.

**Tipos** — `src/types/severeNotification/severeNotification.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`:

```ts
export interface CreateSevereNotificationInput {
    notificationId: string;
    hasPreviousEventHistory?: AnswerOption | null;
    hasAllergyToOtherVaccines?: AnswerOption | null;
    hasAllergyToMedications?: AnswerOption | null;
    hasAllergyToPreviousSameVaccine?: AnswerOption | null;
    hasPregnancyComplications?: AnswerOption | null;
    pregnancyComplicationsDescription?: string | null;
    notes?: string | null;
}
```

**Es la primera `CreateEntityInput` del repositorio sin `isActive`**, por la misma razón que el modelo no lo declara. `notificationId` es el único campo obligatorio: los siete restantes son opcionales y anulables, y esa nulabilidad explícita es la que sostiene el tri-estado.

El update usa `Partial<CreateSevereNotificationInput>`. No se declara `UpdateSevereNotificationInput`. `notificationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre**.

### 3.4 Superficie HTTP

```
POST   /api/severe-notifications                 ESAVI-SEVNOT-001   USER        (nuevo)
GET    /api/severe-notifications/case/:caseId    ESAVI-SEVNOT-006   USER        (nuevo)
DELETE /api/severe-notifications/purge/:id       ESAVI-SEVNOT-005C  SUPERADMIN  (nuevo)
GET    /api/severe-notifications/:id             ESAVI-SEVNOT-003   USER        (nuevo)
PUT    /api/severe-notifications/:id             ESAVI-SEVNOT-004   USER        (nuevo)
```

Orden de declaración en `src/routes/severeNotification.routes.ts`: las rutas con prefijo literal (`/case/:caseId`, `/purge/:id`) van **antes** de `/:id`, o Express capturará `case` y `purge` como un `:id` y el validador de UUID responderá 400.

**`:id` es el `notificationId`.** No hay identificador propio: el parámetro se llama `:id` por uniformidad con las demás rutas del repositorio, pero lo que viaja es la PK compartida. El validador es el mismo `.isUUID()` de siempre.

`001`, `003`, `004` y `006` en **USER** siguen la desviación que F05, F06, F07, F09 y F10 ya fijaron: el detalle clínico se captura en el mismo flujo operativo que la notificación, y partirlo en dos roles rompería el formulario por la mitad. `005C` se queda en SUPERADMIN, como manda §6 del canon.

**Es la primera entidad del repositorio sin ninguna operación en ADMIN.** No es una desviación de la matriz: la única operación canónica que le correspondería —`005A`— no existe en esta entidad.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`severeNotification` · `006` · obtener el detalle grave de un caso**.

### 3.5 Reglas de negocio por operación

#### La regla del embarazo — compartida por `001` y `004`

Es la única dependencia entre campos de la tabla, y vive en el **servicio**, no en el validador: en el `004` hay que evaluarla contra lo que ya está guardado, y el validador solo ve el body.

1. Si `hasPregnancyComplications` resulta **`'YES'`**, `pregnancyComplicationsDescription` es **obligatoria** y no puede quedar vacía tras `.trim()` → si falta, **400** `SEVNOT_<op>_PREGNANCY_DESCRIPTION_REQUIRED`.
2. Si resulta cualquier otro valor —`'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`— o `null`, enviar descripción es **400** `SEVNOT_<op>_PREGNANCY_DESCRIPTION_NOT_ALLOWED`. No se ignora en silencio: una descripción de complicaciones bajo un «no hubo complicaciones» es un dato contradictorio que nadie detectaría después.

En el `004` los dos pasos se evalúan sobre el **estado resultante** —lo guardado fusionado con lo que llega—, no solo sobre el body. Si no, un `PUT` que mueve `hasPregnancyComplications` de `'YES'` a `'NO'` sin tocar la descripción dejaría el texto huérfano. Moverlo **fuera** de `'YES'` exige limpiar la descripción en el mismo `PUT`, enviándola en `null`; si no, es 400.

Es el mismo mecanismo que el F10 construyó para la regla de fallecimiento, con la misma decisión de status: **400 y no 409**, porque el problema es la combinación de campos del body aunque el chequeo viva en el servicio.

#### Por operación

**`ESAVI-SEVNOT-001` — crear.** En este orden:

1. La notificación existe y está **activa** → 404 `SEVNOT_001_NOTIFICATION_NOT_FOUND`. Una notificación retirada no recibe detalle nuevo.
2. Su `notificationType` es **`SEVERE`** → si no, **409** `SEVNOT_001_NOTIFICATION_NOT_SEVERE`. Es 409 y no 400 porque no es un body malformado: es un conflicto con el estado de otra fila, y un `NON_SEVERE` no puede tener detalle grave nunca. El mensaje lleva `{{notificationId}}`.
3. La notificación **no tiene ya detalle** → 409 `SEVNOT_001_ALREADY_EXISTS`, con `{{notificationId}}`. La comprobación es un `findByPk` previo, no confiar en la colisión de PK: un `23505` llegaría al cliente como 500.
4. Regla del embarazo completa.
5. Normaliza con `.trim()` los dos textos libres. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
6. Inserta con la entrada de auditoría `method: 'ESAVI-SEVNOT-001'`.

El `deletedAt` nace en `null`. Como la notificación tiene que estar activa para llegar aquí, no hay forma de crear un detalle ya arrastrado.

**`ESAVI-SEVNOT-003` — obtener por ID.** `findByPk` con el include obligatorio de `notification`. Dos filtros, y el segundo es el que implementa la visibilidad heredada:

- La fila existe → si no, 404 `SEVNOT_003_NOT_FOUND`.
- Su notificación está activa, **salvo** que `canViewInactive(req.user)` sea verdadero —hoy SUPERADMIN, `src/helpers/permissions.helper.ts:24-26`— → si no, el mismo 404 `SEVNOT_003_NOT_FOUND`, sin distinguir. Un USER no debe poder deducir que existe un detalle bajo una notificación que no puede ver.

El `deletedAt` propio **no filtra nada**: una fila arrastrada sigue siendo visible para quien puede ver su cabecera. Es lo que permite consultarla antes de purgarla.

**`ESAVI-SEVNOT-006` — obtener por caso.** La consulta real del dominio: el cliente tiene el `caseId`, no el `notificationId`. Se parte de `SevereNotification` con `include` de `notification` filtrado por `caseId`, misma forma completa y misma regla de `canViewInactive`. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe → 404 `SEVNOT_006_CASE_NOT_FOUND`.
- El caso existe y no tiene notificación visible → 404 `SEVNOT_006_NOTIFICATION_NOT_FOUND`.
- La notificación existe y no tiene detalle grave → 404 `SEVNOT_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena `caso → notificación → detalle` es uno a uno en los dos saltos.

**`ESAVI-SEVNOT-004` — actualizar.** En este orden:

1. Existencia y visibilidad heredada, igual que el `003` → 404 `SEVNOT_004_NOT_FOUND`.
2. `notificationId` **se ignora siempre**, venga o no en el body. Es la PK: cambiarlo no es actualizar, es crear otra fila.
3. Regla del embarazo sobre el **estado resultante**.
4. Normaliza con `.trim()` los dos textos que lleguen.
5. Update diferencial, según la tabla de abajo.
6. Escribe `updatedAt` explícitamente. No hay trigger que lo haga.
7. Preserva el historial con `[...currentAppDetails, newEntry]`.

**Contrato de update diferencial** (§11 del canon, SPEC F12). `stored` sale de `severeNotification.get({ plain: true })` —la fila completa, sin `attributes` acotados—, el diff lo construye `buildDifferentialUpdate` y, si vuelve vacío, se devuelve la fila **sin escribir nada**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `hasPreviousEventHistory` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable, tri-estado |
| `hasAllergyToOtherVaccines` | ídem | anulable, tri-estado |
| `hasAllergyToMedications` | ídem | anulable, tri-estado |
| `hasAllergyToPreviousSameVaccine` | ídem | anulable, tri-estado |
| `hasPregnancyComplications` | ídem | anulable, tri-estado |
| `pregnancyComplicationsDescription` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, normalizado antes de comparar |
| `notes` | ídem | anulable, normalizado antes de comparar |
| `notificationId` | **no entra** | inmutable, se ignora sin error |

Los siete se comparan contra `undefined` y **nunca por veracidad**: un `if( data.x )` descartaría en silencio la cadena vacía y, sobre todo, impediría anular un campo. Aquí eso importa más que en otras entidades, porque `null` y `'NO_ANSWER'` son datos distintos y el `PUT` tiene que poder ir de uno al otro en los dos sentidos. **Ningún campo cifrado y ningún derivado:** los siete llegan del cliente y se guardan tal cual.

**Escrituras que no son diferenciales**, y por qué. Las tres registran un hecho aunque ningún campo de datos cambie, así que no pasan por el helper:

- **El arrastre** de `ESAVI-NOTIFCN-005A` y `ESAVI-CASE-005A`: sella `deletedAt` y añade auditoría. El hecho es la retirada, no un cambio de contenido.
- **La limpieza** de `ESAVI-NOTIFCN-005B`: devuelve `deletedAt` a `null` y añade auditoría.
- **`ESAVI-SEVNOT-005C`**: destruye la fila.

**El arrastre desde la cabecera.** Dos disparadores, un solo comportamiento:

- `ESAVI-NOTIFCN-005A`, en `src/services/notification.service.ts`, dentro de la transacción que la activación ya abre.
- `ESAVI-CASE-005A`, en el mismo bloque de `src/services/esaviCase.service.ts:357-381` donde viven `cascadeDeactivateNotifiers` y su hermana de `notification`. El `Notification.update` masivo que hay allí no pasa por el servicio de `notification`, así que la cadena `caso → notificación → detalle` hay que recorrerla explícitamente.

En los dos casos, y **solo cuando `isActive === false`**, se sella `deletedAt` y `updatedAt` sobre el detalle cuyo `deletedAt` sea `null`, y se añade a `appDetails` una entrada con `method` igual al **código de la operación que lo arrastró** —`'ESAVI-NOTIFCN-005A'` o `'ESAVI-CASE-005A'`, nunca `'ESAVI-SEVNOT-*'`—, siguiendo el criterio que el F07 fijó para la cascada. Una notificación sin detalle arrastra cero filas y no falla. **Un detalle que ya tenía `deletedAt` sellado no se vuelve a sellar** y no recibe entrada nueva: conserva su fecha original.

**La limpieza desde `ESAVI-NOTIFCN-005B`.** Devuelve `deletedAt` a `null`, escribe `updatedAt` y añade entrada con `method: 'ESAVI-NOTIFCN-005B'`. Es la **primera cascada de subida del repositorio** y está razonada en §6. `ESAVI-CASE-005B` no limpia nada, porque tampoco reactiva la notificación.

**`ESAVI-SEVNOT-005C` — purgar.** `purgeSevereNotificationService(id, authUser, lang)` sobre `purgeEntityService`, con transacción. Con una guarda propia **antes** de delegar:

- Existencia → 404 `SEVNOT_005C_NOT_FOUND`.
- `deletedAt` **no** puede ser `null` → si lo es, **409** `SEVNOT_005C_NOT_DELETED`. Es la traducción de la regla de §6 —«solo se purga lo que alguien retiró antes de forma deliberada y reversible»— al único sello que esta tabla tiene. Se comprueba aquí y no en `purgeEntityService`, cuya guarda por `isActive` se queda intacta para las cuatro entidades que ya la usan.

Después delega en el genérico, que vuelca la fila al log en `warn` y ejecuta el `destroy`. Responde `{ ok, message }` sin `data`.

**Validaciones de forma** (las emite `validateFields` con 400): `notificationId` obligatorio y `.isUUID()` en create; los cinco campos de respuesta con `.isIn(ANSWER_OPTIONS)` cuando lleguen; `pregnancyComplicationsDescription` y `notes` como cadena. El `param('id')` y el `param('caseId')` con `.isUUID()`.

### 3.6 Claves i18n nuevas

Bloque `severeNotification` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005C` y `006` |
| `idRequired` | parámetro ausente |
| `notificationNotFound` | 404 cuando la notificación no existe o está inactiva, en `001` y en `006` |
| `notificationNotSevere` | 409 cuando el `notificationType` no es `SEVERE`. Lleva `{{notificationId}}` |
| `alreadyExists` | 409 cuando la notificación ya tiene detalle grave. Lleva `{{notificationId}}` |
| `caseNotFound` | 404 cuando el `caseId` no existe, en `006` |
| `pregnancyDescriptionRequired` | 400 cuando `hasPregnancyComplications` es `YES` y falta la descripción |
| `pregnancyDescriptionNotAllowed` | 400 cuando no es `YES` y la descripción llega |
| `notDeleted` | 409 al purgar un detalle que no fue arrastrado. Lleva `{{id}}` |

Diecisiete claves. **No hay `getSuccessPlural` ni `getFailedPlural`** —no hay listados— ni **`alreadyActive` / `alreadyInactive`** —no hay `005A` ni `005B`—. Son las tres ausencias que distinguen este bloque de los de las demás entidades, y son consecuencia directa de §1-B, no un olvido. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

No se añade ninguna clave a los bloques `notification` ni `esaviCase`: el arrastre no produce mensajes propios.

### 3.7 Forma de la respuesta

Una sola forma, porque no hay listados. `001`, `003`, `004`:

```
{ ok, message, data: {
    notificationId,
    hasPreviousEventHistory, hasAllergyToOtherVaccines, hasAllergyToMedications,
    hasAllergyToPreviousSameVaccine, hasPregnancyComplications,
    pregnancyComplicationsDescription, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    notification: {
        notificationId, notificationType, esaviDescription, isActive,
        case: { caseId, caseCode, eventDate }
    }
} }
```

`006` devuelve exactamente lo mismo. `005C` responde `{ ok, message }` sin `data`.

Cuatro precisiones:

- **`deletedAt` sí viaja, y es el único indicador de estado que tiene la fila.** No hay `isActive` que devolver. Un cliente que quiera saber si el detalle está vigente mira ese campo, o mira `notification.isActive`, que es la fuente real.
- **`notification.isActive` viaja a propósito.** Es lo que gobierna la visibilidad del detalle, y ocultarlo dejaría al cliente sin forma de explicar por qué una ficha que leyó ayer hoy devuelve 404.
- Los cinco campos tri-estado se devuelven **tal como están**, `null` incluido: nunca se normalizan a `NO_ANSWER` ni a `false`.
- **`sysDetails` nunca se devuelve**, en ninguna operación. Tampoco el `sysDetails` de la notificación incluida.

---

## 4. Plan de implementación

**Precondiciones.** Dos, antes del paso 1:

- El **SPEC F10 debe estar implementado** —lo está—. Sin el modelo `Notification`, ni la asociación, ni la validación de la cabecera, ni el arrastre son escribibles. Es dependencia dura: la PK de esta tabla *es* la FK a aquélla.
- El **SPEC F06** debe estar implementado —lo está—, porque el paso 11 modifica `esaviCase.service.ts` y el `006` entra por `caseId`.

No hay ninguna precondición de datos sembrados: esta entidad no referencia ningún `catalogItem`, así que no hereda la del `catalogType` `outcome` que el F10 declaró. Lo que sí necesitan los fixtures de las suites es una notificación con `notificationType: 'SEVERE'`, que se crea por la API.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Mudar `ANSWER_OPTIONS` al archivo compartido.** Crear `src/constants/enums.constants.ts` con `ANSWER_OPTIONS` y `AnswerOption`; retirarlos de `src/constants/notification.constants.ts`, que se queda solo con `NOTIFICATION_TYPES` y `NotificationType`, y sustituir su comentario de las líneas 10-12 por el hecho consumado. Repuntar los importadores actuales. Sin ningún cambio de comportamiento.
   *Verificación:* `npm run build` en 0; `grep -rn "'NOT_APPLICABLE'" src/` devuelve **una sola** definición, la del archivo nuevo; `npm test -- notification` en verde sin tocar ni un caso de la suite.

2. **Modelo, asociaciones y tipos.** `src/models/severeNotification.model.ts` con la PK `notificationId` **sin `defaultValue`**, los cinco `DataTypes.ENUM(...ANSWER_OPTIONS)`, los dos `TEXT` y **ningún atributo `isActive`**; `src/models/associations/severeNotification.associations.ts` con `notification` y el inverso `Notification.hasOne(SevereNotification, { as: 'severeNotification' })`, registrado en `initModels()`; `src/types/severeNotification/severeNotification.types.ts` con `CreateSevereNotificationInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `SevereNotification.findOne({ include: ['notification'] })` desde un script suelto devuelve sin error de asociación; un `SevereNotification.create` con `hasAllergyToMedications: 'MAYBE'` falla en Sequelize **antes** de llegar a Postgres; `npm test` sigue en verde, porque el `hasOne` nuevo no entra en ninguna respuesta de `notification`.

3. **Claves i18n.** Las diecisiete de §3.6 en `es.json`, `en.json` y `nl.json`, **sin** `getSuccessPlural`, `getFailedPlural`, `alreadyActive` ni `alreadyInactive`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

4. **Validadores.** `src/validators/severeNotification.validator.ts` con cuatro arrays: `severeNotificationIdValidator`, `severeNotificationCaseIdValidator`, `createSevereNotificationValidator` y `updateSevereNotificationValidator`. Los dos de cuerpo con `.isIn(ANSWER_OPTIONS)` importado del archivo del paso 1. **Ningún validador de listado**: no hay listados. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

5. **`ESAVI-SEVNOT-001` — crear.** `createSevereNotificationService` con los seis pasos de §3.5 en ese orden: cabecera existente y activa, tipo `SEVERE`, detalle no existente por `findByPk` previo, regla del embarazo, `.trim()` de los dos textos, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un alta mínima —solo `notificationId`— devuelve 201 con los cinco tri-estado en `null` y `deletedAt` en `null`; repetirla devuelve **409** `SEVNOT_001_ALREADY_EXISTS`; sobre una notificación `NON_SEVERE` devuelve **409** `SEVNOT_001_NOTIFICATION_NOT_SEVERE`; sobre una notificación inactiva devuelve **404**; sobre un `notificationId` inexistente devuelve **404**; `hasPregnancyComplications: 'YES'` sin descripción devuelve **400**; `hasPregnancyComplications: 'NO'` con descripción devuelve **400**; `hasAllergyToMedications: 'MAYBE'` devuelve **400** del validador, no 500; la suite no produce ningún error `23505`.

6. **`ESAVI-SEVNOT-003` — obtener por ID.** `getSevereNotificationByIdService(id, lang, includeInactive)` con el include obligatorio de `notification` y la forma completa de §3.7; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; un detalle cuya notificación está inactiva devuelve 404 para USER y para ADMIN, y 200 para SUPERADMIN; los dos 404 llevan el mismo código, sin distinguir la causa; un detalle con `deletedAt` sellado y cabecera activa devuelve **200**, no 404; `notification.isActive` viaja en la respuesta; `sysDetails` no aparece ni en el detalle ni en la notificación incluida.

7. **`ESAVI-SEVNOT-006` — obtener por caso.** `getSevereNotificationByCaseIdService(caseId, lang, includeInactive)` con los tres 404 distintos de §3.5, devolviendo **el objeto**. Ruta `GET /case/:caseId` en USER, declarada antes de `/:id`. Fila `severeNotification` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con la cadena completa devuelve 200 con la ficha, no envuelta en un array; un `caseId` inexistente devuelve 404 `SEVNOT_006_CASE_NOT_FOUND`; un caso sin notificación devuelve 404 `SEVNOT_006_NOTIFICATION_NOT_FOUND`; una notificación sin detalle devuelve 404 `SEVNOT_006_NOT_FOUND`; los tres códigos son distintos entre sí; `GET /case/no-es-uuid` devuelve 400.

8. **`ESAVI-SEVNOT-004` — actualizar.** `updateSevereNotificationService` con los siete pasos de §3.5: visibilidad heredada, `notificationId` ignorado, regla del embarazo sobre el estado resultante, `.trim()`, `buildDifferentialUpdate` con los siete candidatos de la tabla, corte por diff vacío, `updatedAt` a mano y `[...currentAppDetails, newEntry]`. Ruta `PUT /:id` en USER.
   *Verificación:* enviar `notificationId` distinto no lo modifica y devuelve 200; mover `hasPregnancyComplications` de `'YES'` a `'NO'` sin limpiar la descripción devuelve **400**, y enviándola en `null` devuelve **200**; `hasPreviousEventHistory: null` sobre una fila que valía `'NO_ANSWER'` **sí** escribe, y al revés también; un `PUT` que reenvía íntegra la respuesta del `GET` devuelve 200 y **no** añade entrada a `appDetails` ni avanza `sysDetails.version`; un `PUT` con body vacío se comporta igual; un `PUT` que cambia un solo campo añade **una** entrada y avanza la versión en 1.

9. **`ESAVI-SEVNOT-005C` — purgar.** `purgeSevereNotificationService` con la guarda propia de `deletedAt` **antes** de delegar en `purgeEntityService`, con transacción. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, declarada junto a las literales.
   *Verificación:* purgar un detalle con `deletedAt` en `null` devuelve **409** `SEVNOT_005C_NOT_DELETED` y la fila sigue ahí; arrastrarlo desactivando su notificación y purgarlo entonces devuelve 200 sin `data`, y `findByPk` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; el log recoge el volcado en `warn`; **la notificación a la que pertenecía sigue existiendo e intacta**.

10. **El arrastre y la limpieza desde `notification`.** En `src/services/notification.service.ts`, dentro de la transacción que la activación ya abre: cuando `isActive === false`, sellar `deletedAt` y `updatedAt` del detalle cuyo `deletedAt` sea `null` y añadirle entrada con `method: 'ESAVI-NOTIFCN-005A'`; cuando `isActive === true`, devolver `deletedAt` a `null` y añadir entrada con `method: 'ESAVI-NOTIFCN-005B'`.
    *Verificación:* desactivar una notificación con detalle le sella el `deletedAt` y le añade la entrada; el detalle sigue siendo legible por SUPERADMIN; reactivarla lo devuelve a `null` y añade la segunda entrada, con el historial anterior intacto; una notificación sin detalle responde 200 sin error; un detalle que ya tenía `deletedAt` sellado conserva su fecha original y **no** recibe entrada nueva al desactivar otra vez; `npm test -- notification` en verde con los casos existentes sin tocar.

11. **El arrastre desde `esaviCase`.** En el mismo bloque de `src/services/esaviCase.service.ts:357-381` donde viven `cascadeDeactivateNotifiers` y la de `notification`, una función hermana que recorre la cadena `caso → notificación → detalle` y aplica el mismo sellado, con `method: 'ESAVI-CASE-005A'`. Solo cuando `isActive === false`. Va después del paso 10 para que el comportamiento ya esté probado por un camino antes de abrir el segundo.
    *Verificación:* desactivar un caso deja el detalle con `deletedAt` sellado y entrada `ESAVI-CASE-005A`, y su notificación inactiva en la misma transacción; reactivar el caso **no** limpia nada, porque tampoco reactiva la notificación; desactivar un caso sin notificación, o con notificación sin detalle, responde 200 sin error; desactivar un caso ya inactivo devuelve 409 y **nada** cambia de estado.

12. **Volcado al log de la fila que arrastra `ESAVI-NOTIFCN-005C`.** Antes del `destroy` de la notificación, si tiene detalle, volcarlo a `esaviLog` en nivel `warn` con el mismo formato que usa `purgeEntityService`. No bloquea la purga.
    *Verificación:* purgar una notificación con detalle deja **dos** volcados en el log, el de la notificación y el del detalle; después, `SevereNotification.findByPk` devuelve `null` sin que ninguna operación de esta entidad lo haya borrado; purgar una notificación sin detalle deja un solo volcado.

13. **Registrar la entidad en las convenciones.** Fila `severeNotification` → `SEVNOT` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `severeNotification` · `006` · «obtener el detalle grave de un caso» en la tabla de operaciones no canónicas.
    *Verificación:* `SEVNOT` aparece una sola vez, no colisiona con las dieciséis existentes y no es prefijo de ninguna; `NSEVNOT` **no** se da de alta.

14. **Cubrir las cinco rutas en `tests/auth/roles.test.ts`.** Cinco filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **108 a 113** (`tests/auth/roles.test.ts:229`).
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/severeNotification.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por caso → actualizar → arrastrar desactivando la notificación → purgar. Más los caminos de error: notificación inexistente (404), inactiva (404), `NON_SEVERE` (409), detalle duplicado (409), `answerOption` fuera del ENUM (400), embarazo sin descripción (400), descripción sin embarazo (400), purga sin arrastre previo (409). Y las tres reglas propias: `notificationId` inmutable en el `PUT`, la regla del embarazo sobre el estado resultante, y el caso homogéneo de update diferencial —reenviar la respuesta del `GET` no escribe nada—.
    *Verificación:* `npm test -- severeNotification` en verde.

16. **Ampliar `tests/contract/notification.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera: el arrastre de `005A`, la limpieza de `005B`, el detalle que ya estaba sellado y no se re-sella, y el doble volcado de `005C`. En la segunda: el arrastre transitivo desde `ESAVI-CASE-005A` y la comprobación de que `005B` no lo deshace. Ninguna de las dos suites pierde casos.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las cinco rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en `001`, `003`, `004` y `006`. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-SEVNOT-002" src/` no devuelve resultados: la entidad no tiene listados.
- [ ] `grep -rn "ESAVI-SEVNOT-005[AB]" src/` no devuelve resultados: la entidad no tiene activación ni desactivación.
- [ ] `grep -rn "ESAVI-SEVNOT-00[789]" src/` no devuelve resultados: la única no canónica es `006`.
- [ ] `SEVNOT` está en la tabla de abreviaturas de §6 del canon, y la fila `severeNotification` · `006` en la de operaciones no canónicas. `NSEVNOT` **no** está registrada.
- [ ] Existen los siete artefactos y `src/types/severeNotification/index.ts` está presente.
- [ ] `GET /api/severe-notifications/case/:caseId` y `DELETE /api/severe-notifications/purge/:id` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Notification.hasOne(SevereNotification)` está declarado, y el detalle **no** aparece en ninguna respuesta de `/api/notifications`.
- [ ] `esaviapp.sql` no tiene ni una línea modificada.

**La tabla sin `isActive`**

- [ ] `grep -n "isActive" src/models/severeNotification.model.ts` no devuelve resultados.
- [ ] `CreateSevereNotificationInput` no declara `isActive`.
- [ ] Ninguna respuesta de la entidad incluye un campo `isActive` propio; sí incluye `notification.isActive`.
- [ ] `grep -rn "setEntityActiveStatusService" src/services/severeNotification.service.ts` no devuelve resultados.
- [ ] `src/services/common/entityActivation.service.ts` y `src/services/common/entityPurge.service.ts` no tienen ni una línea modificada.

**El ENUM compartido**

- [ ] `src/constants/enums.constants.ts` existe con `ANSWER_OPTIONS` y `AnswerOption`.
- [ ] `grep -rn "'NOT_APPLICABLE'" src/` devuelve **una sola** definición: ni el modelo, ni el validador, ni `notification.constants.ts` repiten los literales.
- [ ] `notification.constants.ts` ya no exporta `ANSWER_OPTIONS` y su comentario de la mudanza está actualizado.
- [ ] Los valores coinciden exactamente con el ENUM de `esaviapp.sql:26`, en el mismo orden.
- [ ] `POST` con `hasAllergyToMedications: 'MAYBE'` devuelve **400** con el envoltorio de `validateFields`, nunca 500.

**Alta y uno a uno**

- [ ] `POST` con solo `notificationId` devuelve **201**, con los cinco tri-estado en `null` y `deletedAt` en `null`.
- [ ] `POST` sobre una notificación que ya tiene detalle devuelve **409** `alreadyExists`, con el `notificationId` interpolado.
- [ ] `POST` sobre una notificación `NON_SEVERE` devuelve **409** `notificationNotSevere`, no 400.
- [ ] `POST` sobre una notificación inactiva devuelve **404**; sobre un `notificationId` inexistente, **404**.
- [ ] Ningún `INSERT` llega a Postgres con la PK ocupada: la suite no produce ningún error `23505`.
- [ ] `PUT /:id` con un `notificationId` distinto en el body deja la fila donde estaba y devuelve **200**.

**Regla del embarazo**

- [ ] `hasPregnancyComplications: 'YES'` sin descripción → **400** `pregnancyDescriptionRequired`.
- [ ] `hasPregnancyComplications: 'YES'` con descripción en blanco tras `.trim()` → **400**.
- [ ] Cualquier otro valor, o `null`, con descripción en el body → **400** `pregnancyDescriptionNotAllowed`.
- [ ] Un `PUT` que mueve `hasPregnancyComplications` de `'YES'` a `'NO'` **sin** limpiar la descripción → **400**; el mismo `PUT` enviándola en `null` → **200**. La regla se evalúa sobre el estado resultante.
- [ ] Un `PUT` que solo toca `notes` sobre una fila con `'YES'` y descripción guardada → **200**: la regla se cumple con lo que ya hay.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/severeNotification.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada. *(En esta entidad el primer supuesto es el `notificationId` de la cabecera, comprobado en `001`; el segundo no aplica: no hay ningún campo `code`.)*
- [ ] `hasPreviousEventHistory: null` sobre una fila que valía `'NO_ANSWER'` **sí** escribe, y el camino inverso también: `null` y `NO_ANSWER` no son intercambiables en ninguna dirección.

**Tri-estado**

- [ ] Los cinco campos no informados llegan como `null` en todas las respuestas, nunca como `NO_ANSWER`.
- [ ] `'NO_ANSWER'` se guarda y se devuelve como `'NO_ANSWER'`, distinguible de `null`.

**Visibilidad heredada**

- [ ] `GET /:id` de un detalle cuya notificación está inactiva devuelve **404** para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] Ese 404 lleva el mismo código que el de una fila inexistente: la causa no se distingue.
- [ ] Un detalle con `deletedAt` sellado y cabecera **activa** devuelve **200**: el sello propio no filtra lecturas.
- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`.
- [ ] Los tres 404 del `006` —caso, notificación y detalle— llevan tres códigos distintos.

**Arrastre y limpieza**

- [ ] Desactivar la notificación con `ESAVI-NOTIFCN-005A` sella el `deletedAt` del detalle y le añade entrada con `method: 'ESAVI-NOTIFCN-005A'`.
- [ ] Reactivarla con `005B` devuelve `deletedAt` a `null` y añade entrada con `method: 'ESAVI-NOTIFCN-005B'`, con el historial anterior intacto.
- [ ] Un detalle que **ya** tenía `deletedAt` sellado conserva su fecha original y no recibe entrada nueva al volver a desactivar la cabecera.
- [ ] Desactivar el caso con `ESAVI-CASE-005A` sella el detalle con `method: 'ESAVI-CASE-005A'`, en la misma transacción que desactiva la notificación.
- [ ] Reactivar el caso con `ESAVI-CASE-005B` **no** limpia el `deletedAt` del detalle, porque tampoco reactiva la notificación.
- [ ] Ninguna entrada de `appDetails` del detalle lleva un `method` de la forma `ESAVI-SEVNOT-005*`: las escribe siempre la operación que lo arrastró.
- [ ] Desactivar un caso o una notificación **sin** detalle responde 200 y no falla.

**Purga**

- [ ] `DELETE /purge/:id` sobre un detalle con `deletedAt` en `null` devuelve **409** `notDeleted` y la fila sigue existiendo.
- [ ] Tras arrastrarlo, la misma llamada devuelve **200** sin `data` y `findByPk` devuelve `null`.
- [ ] Repetirla devuelve **404**; un ADMIN recibe **403**.
- [ ] La notificación a la que pertenecía sigue existiendo e intacta.
- [ ] Purgar la **notificación** con `ESAVI-NOTIFCN-005C` deja **dos** volcados en `esaviLog` en nivel `warn` —el de la notificación y el del detalle— y destruye las dos filas.
- [ ] Purgar una notificación sin detalle deja un solo volcado y sigue funcionando igual que antes de este spec.

**Cierre**

- [ ] Las diecisiete claves nuevas existen en `es`, `en` y `nl`, y el bloque **no** contiene `getSuccessPlural`, `getFailedPlural`, `alreadyActive` ni `alreadyInactive`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene **113** filas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la abreviatura**

- **Sí:** `SEVNOT`, seis letras. No colisiona con las dieciséis registradas y ninguna es prefijo de otra — en particular convive limpiamente con `NOTIFCN` y `NOTIFIER`, que es la trampa que el F10 ya tuvo que esquivar.
- **No:** `SEVNOTIF`, ocho letras. Cabe, pero condena a su hermana: `nonSevereNotification` pediría `NSEVNOTIF`, que son nueve y se pasa del límite de §6. Con `SEVNOT` el par `SEVNOT`/`NSEVNOT` mantiene la simetría cuando llegue.
- **No:** dar de alta `NSEVNOT` ya, «para reservarla». Una abreviatura registrada sin entidad que la use es una fila que nadie sabe si está viva. Queda anotada aquí y en §2, que es donde alguien la buscará.

**Sobre la ausencia de `isActive` — la decisión estructural del spec**

- **Sí:** aceptar la tabla como está y **no exponer `005A` ni `005B`**. El esquema decidió que las satélites no gestionan su estado, y `nonSevereNotification` lo confirma. Una entidad que no tiene estado propio no debe tener endpoints para cambiarlo.
- **No:** añadir `isActive` a `esaviapp.sql`. Habría alineado la entidad con las quince anteriores, pero tocar el DDL está fuera de norma en todos los specs del repositorio, afecta a datos ya cargados y a la carga del esquema en los tests, y arrastraría la misma decisión a las siete satélites restantes por coherencia.
- **No:** simular el estado con un `isActive` virtual derivado de `deletedAt`. Un campo que la base no tiene y la aplicación finge es la clase de mentira que se descubre tres meses después, cuando alguien consulta por SQL directo y ve otra cosa que la API.
- **No:** borrado lógico propio sobre `deletedAt`, con sus `005A`/`005B` a mano. Habría conservado las siete operaciones, pero introduce una segunda forma de retirar filas en el repositorio y obliga a reescribir la guarda de `purgeEntityService`. El detalle no tiene por qué poder retirarse sin su cabecera: no significa nada solo.

**Sobre la ausencia de listados**

- **Sí:** ningún `002`, ni único ni dual. Se consideró el par `002A`/`002B` por simetría con las nueve entidades que ya lo tienen, y se descartó por una razón que lo cierra: **el listado dual existe para separar filas activas de inactivas**, y sin `isActive` los dos endpoints devolverían exactamente las mismas filas, diferenciándose solo en el rol exigido. Simetría de forma, con dos rutas que no hacen cosas distintas.
- **No:** un `002` único con filtros por los cinco `answerOption`. Es lo que pediría un tablero de «cuántas notificaciones graves declaran alergia a medicamentos», y es un caso real — pero no hay hoy quien lo consuma, y un listado de detalles clínicos sin su cabecera no se lee. Cuando aparezca el consumidor, va en su spec con sus filtros pensados para él.
- **Consecuencia asumida:** esta entidad no tiene forma reducida de respuesta ni claves `getSuccessPlural`. Es la primera del repositorio así, y las ausencias están declaradas en §3.6 para que no se lean como olvidos.

**Sobre el ciclo de vida y el arrastre**

- **Sí:** el arrastre **sella `deletedAt` y escribe auditoría**, en vez de no escribir nada. La alternativa —dejar la fila intacta y confiar en que la visibilidad heredada la esconda— era más barata y no tocaba servicios ajenos, pero deja la fila sin ningún rastro de cuándo dejó de estar vigente, y sin el sello no habría con qué gobernar la purga.
- **Sí:** `method` con el código de **la operación que arrastró** —`ESAVI-NOTIFCN-005A` o `ESAVI-CASE-005A`—, nunca uno de `SEVNOT`. Es el criterio que el F07 fijó para la cascada y que el F09 y el F11 heredaron: la auditoría dice quién lo hizo, no sobre qué fila cayó.
- **Sí:** el arrastre entra **también desde `ESAVI-CASE-005A`**. El `Notification.update` masivo de `esaviCase.service.ts:357-381` no pasa por el servicio de `notification`, así que la cadena hay que recorrerla explícitamente. Sin esto, un detalle bajo un caso desactivado quedaría invisible pero sin sellar, y por tanto **nunca purgable** — dos formas de llegar al mismo estado con resultados distintos.
- **Sí:** `ESAVI-NOTIFCN-005B` **limpia** el `deletedAt`. Es la **primera cascada de subida del repositorio** y rompe el criterio de «solo de bajada» del F07. Se acepta porque esta relación no es como las otras: `notifier` y `classification` son entidades con vida propia que alguien puede haber retirado por su cuenta, y respetar esa decisión al reactivar el padre es correcto. Aquí el detalle **no tiene decisión propia que respetar** — no hay forma de retirarlo sin retirar la cabecera—, así que no limpiarlo dejaría una notificación activa con su detalle marcado como borrado, que es un estado que ningún cliente sabe representar.
- **No:** extender esa subida a `ESAVI-CASE-005B`. Reactivar el caso no reactiva la notificación —criterio del F07, intacto—, así que no hay nada que limpiar por debajo.
- **No:** que el `deletedAt` propio filtre las lecturas. Un detalle arrastrado sigue siendo legible por quien puede ver su cabecera, y eso es lo que permite consultarlo antes de purgarlo. La visibilidad la gobierna `notification.isActive`, en un solo sitio.

**Sobre la purga**

- **Sí:** guarda por `deletedAt IS NOT NULL`, con 409 `notDeleted`. Traduce la regla de §6 —«el borrado físico solo alcanza a lo que alguien retiró antes de forma deliberada y reversible»— al único sello que esta tabla tiene. Sin ella, `purgeEntityService` evalúa `undefined !== true` y **toda fila sería purgable de inmediato**, que es exactamente la red de seguridad que §6 no quiere perder.
- **Sí:** la guarda vive en `purgeSevereNotificationService`, **antes** de delegar. **No:** extender `purgeEntityService` con un predicado opcional. Habría sido más general y dejaría el criterio en un solo sitio para las satélites futuras, pero modifica un servicio común del que ya dependen `notifier`, `classification`, `appUserGeoLocation` y `notification`, para resolver un caso que hoy tiene una sola entidad. Si la segunda satélite necesita lo mismo, ése es el momento de generalizarlo — con dos casos a la vista y no con uno imaginado.
- **Sí:** `ESAVI-NOTIFCN-005C` **vuelca el detalle al log y no bloquea**. `purgeEntityService` se apoya en que el volcado es «el único rastro que queda de una operación irreversible» (`entityPurge.service.ts:33-38`), y hoy ese volcado solo cubre la fila que se borra explícitamente: lo que destruye la cascada de Postgres desaparecería sin que nada lo hubiera escrito nunca.
- **No:** bloquear con 409 la purga de una notificación con detalle, obligando a purgar el detalle primero. Es lo más fiel a la filosofía de los dos pasos, pero convierte una operación en dos y obliga a repetir la decisión —y la comprobación— con las siete satélites restantes. Con ocho, purgar una notificación serían nueve llamadas en el orden correcto.
- **No:** dejarlo en silencio, como está hoy. Es la única de las tres que destruye datos sin dejar rastro de qué destruyó.

**Sobre las reglas de negocio**

- **Sí:** regla estricta del embarazo en las dos direcciones, calcada de la regla de fallecimiento del F10, y evaluada sobre el **estado resultante** en el `004`. Es el mismo problema con otros campos, y dos entidades hermanas resolviendo igual el mismo problema es lo que hace que la tercera se escriba sola.
- **Sí:** **400** para las dos violaciones. §10 reserva el 409 para duplicados y conflictos de estado de la fila; aquí el problema es la combinación de campos del body, aunque el chequeo viva en el servicio y no en `validateFields`.
- **No:** tolerar la descripción cuando la respuesta no es `'YES'`. Ignorarla en silencio guardaría un texto que contradice al campo que lo gobierna, y nadie lo detectaría después.
- **Sí:** **409** para el `notificationType` que no es `SEVERE`. **No:** 400. No es un body malformado que el cliente pueda corregir reenviándolo: una notificación `NON_SEVERE` no puede tener detalle grave nunca, y eso es un conflicto con el estado de otra fila.
- **No:** contrastar `hasPregnancyComplications` con el sexo o la edad del paciente. Cruzaría tres tablas para validar un campo opcional y bloquearía capturas legítimas sobre datos incompletos.
- **No:** validar nada contra `classification.isSeriousEvent`. Son dos satélites de ramas distintas que no se referencian, y atarlos aquí acoplaría dos specs sin necesidad.

**Sobre la forma**

- **Sí:** PK sin `defaultValue` en el modelo. Declarar `gen_random_uuid()` haría que un alta sin `notificationId` generara un UUID huérfano que la FK rechazaría después, convirtiendo un 400 legible en un error de integridad.
- **Sí:** `findByPk` previo para detectar el detalle duplicado, en vez de dejar que colisione la PK. Un `23505` llega al cliente como 500 y el mensaje de Postgres no dice nada útil.
- **Sí:** mudar `ANSWER_OPTIONS` a `src/constants/enums.constants.ts`, en su propio paso y su propio commit. Es la instrucción que `notification.constants.ts:10-12` dejó escrita, y aislarla permite verificar que `notification` no cambia antes de que haya código nuevo que pueda enmascararlo.
- **No:** copiarla al archivo de esta entidad. Dos listas del mismo ENUM divergen en cuanto alguien añada un valor a una sola, y el ENUM lo comparten siete tablas.
- **Sí:** el mismo 404 en el `003` tanto si la fila no existe como si su cabecera está inactiva. Distinguirlos le confirmaría a un USER que existe un detalle bajo una notificación que no puede ver.
- **Sí:** tres 404 distintos en el `006`. La asimetría con el `003` es deliberada: allí el cliente ya tiene la PK del detalle; aquí entra por un `caseId` y necesita saber en qué eslabón de la cadena se rompió.
- **Sí:** `notification.isActive` en la respuesta. Es lo que gobierna la visibilidad del detalle, y ocultarlo dejaría al cliente sin forma de explicar por qué una ficha que leyó ayer hoy devuelve 404.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **La cascada de subida de `005B` se lee como el criterio general del repositorio** y alguien la copia a `notifier` o `classification`, donde rompería la decisión del F07 de respetar una retirada deliberada | Está razonada en §6 con la condición que la habilita —una entidad **sin forma de retirarse por su cuenta**— y esa condición no la cumple ninguna de las entidades con `isActive`. La excepción viaja con su frontera escrita |
| Se modifican **dos servicios cerrados** —`notification.service.ts` y `esaviCase.service.ts`— con suites de contrato dependiendo de ellos | Los pasos 10 y 11 van separados y en ese orden, para que el comportamiento quede probado por un camino antes de abrir el segundo. Las suites existentes de las dos entidades se verifican intactas antes de ampliarlas en el paso 16 |
| **La guarda por `isActive` de `purgeEntityService` es inerte en esta tabla.** Si alguien retira la comprobación de `deletedAt` del servicio de la entidad —refactorizando, o «unificando» las purgas— el `005C` deja de estar protegido **sin que falle ninguna compilación** | Cubierto por un criterio de aceptación explícito y por un caso de la suite de contrato: purgar sin arrastre previo debe devolver 409. Es la única red, y por eso está escrita dos veces |
| `ESAVI-NOTIFCN-005C` **sigue destruyendo el detalle** por la cascada de Postgres. El volcado al log es rastro, no protección | Decisión consciente de §6, con las dos alternativas descartadas por escrito. Quien tiene SUPERADMIN puede provocar lo mismo por SQL directo, y §6 del canon ya declara la cascada como comportamiento del esquema |
| **Las siete satélites restantes heredarán todas estas decisiones.** Lo que aquí es una excepción razonada se convierte, por repetición, en el patrón de facto de las tablas sin `isActive` | Es el efecto buscado, y por eso §6 razona cada pieza en vez de resolverla al paso. La segunda satélite que llegue debería reusar este spec como plantilla — y es el momento de generalizar la guarda de purga, con dos casos a la vista |
| Alguien vuelve a declarar `ANSWER_OPTIONS` en `notification.constants.ts` al tocar aquella entidad, y las dos listas divergen en silencio | Criterio de aceptación por `grep`: una sola definición de `'NOT_APPLICABLE'` en todo `src/`. Falla en cuanto aparezca la segunda |
| Una fila con `deletedAt` sellado bajo una cabecera **activa** devuelve 200, y ese estado el flujo normal no lo produce: el arrastre siempre desactiva la cabecera y `005B` siempre limpia el sello | Se acepta y se documenta. Si aparece, es señal de escritura directa en base o de una transacción a medias, y devolver la fila es mejor que esconderla: quien la vea podrá corregirla |
| El arrastre mueve el `updatedAt` del detalle sin que nadie lo haya editado | Es correcto: la fila cambió. No hay ningún listado ordenado por esa columna en esta entidad, porque no hay listados |

---

## 8. Impacto en el contrato HTTP

El spec añade cinco rutas nuevas y **no cambia la forma** de ninguna respuesta existente. Sí cambia el **efecto lateral** de tres endpoints ya publicados:

| Endpoint | Antes | Después |
|---|---|---|
| `DELETE /api/notifications/:id` (`ESAVI-NOTIFCN-005A`) | Desactiva la notificación. Ningún efecto sobre otras tablas | Además sella el `deletedAt` del detalle grave y le añade entrada de auditoría |
| `PATCH /api/notifications/activate/:id` (`ESAVI-NOTIFCN-005B`) | Reactiva la notificación. Ningún efecto sobre otras tablas | Además devuelve a `null` el `deletedAt` del detalle y le añade entrada |
| `DELETE /api/esavi-cases/:id` (`ESAVI-CASE-005A`) | Desactiva el caso, sus notificadores y su notificación | Además sella el detalle grave que cuelgue de esa notificación, en la misma transacción |

Los tres siguen respondiendo el mismo status, el mismo mensaje y el mismo cuerpo. Lo que cambia es lo que le pasa a otras filas.

**`DELETE /api/notifications/purge/:id` (`ESAVI-NOTIFCN-005C`) no cambia en nada observable desde HTTP.** Sigue respondiendo 200 sin `data` y sigue destruyendo el detalle por la cascada del DDL. Lo único nuevo es un segundo volcado en `esaviLog`, que no viaja al cliente. Se declara aquí porque el F10 dejó esa operación marcada para revisión, y ésta es la revisión.

**`GET /api/notifications` y `GET /api/notifications/:id` no cambian.** La asociación `hasOne` se declara pero no entra en ninguna respuesta de aquella entidad: el detalle se pide por su propia ruta.

Una consecuencia que conviene decir explícitamente: **un cliente que hoy desactiva una notificación y la reactiva después recupera exactamente el estado anterior, y eso sigue siendo cierto con el detalle**. Es la razón de que `005B` limpie el sello — sin esa mitad, el ciclo desactivar-reactivar dejaría el detalle marcado para siempre y purgable por accidente.

---

## Lo que **no** está en este spec

- Las otras siete tablas satélite de `notification`: `nonSevereNotification`, `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- Dar de alta `NSEVNOT` ni ninguna otra abreviatura futura: se registran cuando su entidad se escriba.
- Cualquier listado de detalles graves —`002`, `002A` o `002B`— y cualquier filtro, conteo o tablero sobre los cinco `answerOption`.
- Cualquier operación `005A` o `005B` sobre esta entidad. No tiene estado propio que activar.
- Añadir `isActive` a `severeNotification`, ni ninguna otra modificación de `esaviapp.sql`: ni la FK, ni su `ON DELETE CASCADE`, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- Modificar `setEntityActiveStatusService` o `purgeEntityService`, ni generalizar la guarda de purga para las satélites que vengan.
- Bloquear `ESAVI-NOTIFCN-005C` cuando la notificación tiene detalle grave. La cascada sigue disparando; lo único nuevo es el volcado al log.
- Contrastar `hasPregnancyComplications` con el sexo o la edad del paciente, ni con `notificationPregnancy`.
- Cualquier regla cruzada contra `classification`, incluida la coherencia con `isSeriousEvent`.
- Crear el detalle automáticamente al dar de alta una notificación `SEVERE`.
- Búsqueda por texto sobre `pregnancyComplicationsDescription` o `notes`.
- Cifrar ningún campo.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
