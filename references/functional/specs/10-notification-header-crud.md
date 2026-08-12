# SPEC F10 — CRUD completo de notification

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F06 (`esaviCase` — dependencia dura: `caseId` es `NOT NULL`)**, SPEC F07 (mecanismo de cascada de `ESAVI-CASE-005A`, al que esta entidad se suma), SPEC F08 (operación `005C` de borrado físico)
> **Fecha:** 2026-08-10
> **Objetivo:** Dar de alta la entidad `notification` —solo la tabla raíz, sin ninguna de sus ocho satélites— con sus siete artefactos, sus siete operaciones canónicas más el acceso por caso y el borrado físico, introduciendo el primer uso de tipos ENUM de Postgres en el repositorio.

---

## 1. Por qué existe este spec

`notification` es la **tercera** de las cinco tablas satélite de `esaviCase` que recibe implementación, después de `notifier` y `classification`. Es la notificación propiamente dicha: qué ocurrió (`esaviDescription`), si el paciente tenía antecedentes o tomaba medicación, cuál fue el desenlace (`outcomeItemId`) y si se pide investigación. Es la pieza que convierte un caso registrado en un caso notificable.

Hoy la tabla existe en `esaviapp.sql:718-741` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Cuatro características la separan de las entidades ya especificadas:

**A — Es la primera entidad del repositorio con tipos ENUM de Postgres.** `notificationType` es `ENUM('SEVERE', 'NON_SEVERE')` y **`NOT NULL`** (`esaviapp.sql:31`, columna en `721`); `hasRelevantMedicalHistory` y `takesMedication` son `answerOption`, `ENUM('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER')` (`esaviapp.sql:26`). Ningún modelo de `src/models/` usa `DataTypes.ENUM` todavía: las tablas implementadas hasta hoy resuelven sus dominios cerrados con FKs a `catalogItem`. Aquí el esquema decidió otra cosa, y el modelo tiene que calcarla.

**B — Es uno a uno con el caso, igual que `classification`.** `UQ_notification_case` declara `UNIQUE ("caseId")` (`esaviapp.sql:739`). Un caso tiene como mucho una notificación, y el intento de crear la segunda es un conflicto, no un alta. A diferencia de `classification`, la tabla **sí** declara además `IX_notification_case` (`esaviapp.sql:741`), un índice redundante con el que Postgres ya crea de oficio para la `UNIQUE`. No es un problema: es una duplicación del DDL que este spec no toca.

**C — La regla de negocio principal es cruzada y vive en el servicio, no en el validador.** `deathDate`, `autopsyRequested` y `verbalAutopsyPerformed` solo tienen sentido cuando el desenlace es el fallecimiento, y el desenlace es un `outcomeItemId` que apunta a `catalogItem`. Saber si ese item es el de código `DEATH` exige leer la base. El validador solo ve un UUID opaco, así que la coherencia la impone el servicio — con 400, no con 409: sigue siendo entrada malformada del cliente.

**D — El `ON DELETE CASCADE` del DDL no protege nada, igual que en `notifier` y `classification`.** `FK_notification_case` declara `ON DELETE CASCADE` (`esaviapp.sql:737`), pero `TRG_esaviCase_preventPhysicalDelete` impide todo borrado físico de `esaviCase` (`esaviapp.sql:1363-1366`), así que la cascada declarada **nunca dispara**. La integridad del ciclo de vida la sostiene solo la aplicación, en el mecanismo que el SPEC F07 construyó en `cascadeDeactivateNotifiers` (`src/services/esaviCase.service.ts:357-381`). Éste es el segundo satélite que se suma a ese punto.

`notification` **tampoco está** en la lista de `preventPhysicalDelete` (`esaviapp.sql:1363-1366`), así que un `DELETE FROM "notification"` ejecuta sin error y le corresponde la operación `005C` del SPEC F08.

El único trigger que alcanza a la tabla es `TRG_notification_setSysDetails`, creado por el bucle genérico de `esaviapp.sql:1280-1291`. No valida ninguna regla de negocio. **No existe `TRG_notification_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notification`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Las siete operaciones canónicas: `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- La operación no canónica **`006` — obtener por caso**, `GET /case/:caseId`, que es la consulta real del dominio: el cliente tiene el `caseId`, no el `notificationId`. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- La operación `005C` de borrado físico, en SUPERADMIN, que le corresponde por no estar `notification` en el bucle `preventPhysicalDelete` del DDL. Las reglas transversales las fija el [SPEC F08](./08-physical-delete.md); aquí solo se declara la ruta y las claves de la entidad.
- Relación **uno a uno** con `esaviCase`, sostenida por `UQ_notification_case`. Notificar dos veces el mismo caso devuelve **409**, y el hueco **no se libera** cuando la existente está inactiva: para volver a notificar hay que reactivar la anterior o purgarla.
- **Primer uso de `DataTypes.ENUM` del repositorio**, para `notificationType` y para los dos campos `answerOption`, con los valores centralizados en `src/constants/notification.constants.ts` y reutilizados por el validador.
- **`notificationType` obligatorio en el alta e inmutable**: se ignora si llega en el body del `004`, igual que `caseId`.
- **Regla de fallecimiento**, evaluada en el servicio contra el código del `catalogItem` referenciado por `outcomeItemId`:
  - Cuando ese código es `DEATH`, `deathDate` y `autopsyRequested` son **obligatorios** → 400.
  - Cuando **no** lo es, enviar `deathDate`, `autopsyRequested` o `verbalAutopsyPerformed` es **400**. No se ignoran en silencio.
  - `verbalAutopsyPerformed` es siempre opcional, incluso con `DEATH`.
  - `deathDate` no puede ser futura, lo emite el validador con 400.
- Validación de FK en create y update: `caseId` existente y activo; `outcomeItemId` existente, activo y perteneciente al `catalogType` de código `outcome`.
- **`requestInvestigation` nunca queda en `null`**: si no llega en el body se guarda `false`, calcando el `DEFAULT false` del DDL.
- **Tri-estado preservado** en `hasRelevantMedicalHistory`, `takesMedication`, `autopsyRequested` y `verbalAutopsyPerformed`: lo que no llega se guarda `null` y se devuelve `null`. La ausencia **no** se normaliza a `NO_ANSWER`: un `null` señala falta de respuesta del formulario, y `NO_ANSWER` es una respuesta deliberada del notificador. Fundirlos borraría esa diferencia.
- Listados con `findAndCountAll`, orden por defecto `createdAt DESC`, paginación y cuatro filtros por query acumulativos con `AND`: `caseId`, `notificationType`, `requestInvestigation` y `outcomeItemId`.
- **Sumar `notification` a la cascada del SPEC F07:** `ESAVI-CASE-005A` desactiva también la notificación activa del caso, en la misma transacción y en el mismo punto de `src/services/esaviCase.service.ts`. La cascada sigue siendo **solo de bajada**: `ESAVI-CASE-005B` no reactiva nada.
- Alta de la abreviatura `NOTIFCN` en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **90 a 99**, o desde el total que haya dejado el F09 si se implementa antes— y suite `tests/contract/notification.test.ts`, más la ampliación de `tests/contract/esaviCase.test.ts` con la cascada.

**Fuera de alcance (otros specs):**

- **Las ocho tablas satélite de `notification`**, que es la acotación explícita de este spec: `severeNotification` (`esaviapp.sql:743-758`), `nonSevereNotification` (`760-783`), `notificationEvent` (`785-808`), `notificationMedication` (`810-831`), `notificationVaccine` (`833-857`), `notificationDiluent` (`859-878`), `notificationPregnancy` (`880-897`) y `notificationPregnancyComplication` (`899-920`). Ninguna se modela, ni se asocia, ni se incluye en ninguna respuesta.
- En consecuencia, **`notificationType: 'SEVERE'` no crea ni exige ninguna fila en `severeNotification`**, y `takesMedication: 'YES'` no exige ninguna fila en `notificationMedication`. Este spec entrega la cabecera de la notificación; el detalle clínico llega después.
- Las otras dos satélites de `esaviCase` —`investigation` y `finalClassification`— y las catorce que cuelgan de la primera.
- Extender la cascada de `ESAVI-CASE-005A` a esos otros satélites.
- Cualquier regla cruzada contra `classification`. En particular, **no** se comprueba que `classification.causedDeath` concuerde con un desenlace `DEATH`: `classification` está en `Borrador` y atar este spec a uno sin implementar lo bloquearía. Queda anotado en §7 como riesgo asumido.
- Sembrar el `catalogType` de código `outcome` y sus items, entre ellos el de código `DEATH`. **Es precondición de la implementación, no parte de ella.** La carga se hace por los endpoints ya existentes de `catalogType` y `catalogItem`.
- Cualquier modificación de `esaviapp.sql`: ni añadir valores a los ENUM, ni el índice único parcial que liberaría el `caseId` de una notificación inactiva, ni retirar el `IX_notification_case` redundante, ni añadir `notification` a `preventPhysicalDelete`, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- Cifrado de ningún campo. La tabla no contiene datos identificativos: el paciente ya está cifrado en su propia tabla y `esaviDescription` es una descripción clínica del evento, no de la persona.
- Búsqueda por texto sobre `esaviDescription` o `notes`. No existe `Op.iLike` en ningún servicio del repositorio; introducirlo es un cambio transversal.
- Filtrar u ordenar por rangos de `deathDate`. Los cuatro filtros de §3.5 son por igualdad.
- Cualquier endpoint de estadística, conteo por tipo de notificación o exportación.
- Crear la notificación automáticamente al dar de alta un `esaviCase`. Notificar es un acto posterior y deliberado.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notification` — `esaviapp.sql:718-741`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `notificationId` | `uuid` | no | PK, `gen_random_uuid()` |
| `caseId` | `uuid` | **no** | `FK_notification_case` → `esaviCase`, `ON DELETE CASCADE`. **`UQ_notification_case` UNIQUE**: uno a uno |
| `notificationType` | `"notificationType"` | **no** | ENUM `SEVERE` \| `NON_SEVERE`. Sin `DEFAULT`. Inmutable |
| `hasRelevantMedicalHistory` | `"answerOption"` | sí | ENUM de 5 valores; tri-estado con `null` |
| `takesMedication` | `"answerOption"` | sí | ENUM de 5 valores; tri-estado con `null` |
| `esaviDescription` | `text` | **no** | texto libre obligatorio |
| `outcomeItemId` | `uuid` | sí | `FK_notification_outcome` → `catalogItem`, `ON DELETE RESTRICT`. Gobierna la regla de fallecimiento |
| `requestInvestigation` | `boolean` | sí | `DEFAULT false`. La aplicación nunca lo deja en `null` |
| `deathDate` | `date` | sí | solo con desenlace `DEATH` |
| `autopsyRequested` | `boolean` | sí | tri-estado; solo con desenlace `DEATH` |
| `verbalAutopsyPerformed` | `boolean` | sí | tri-estado; solo con desenlace `DEATH`, siempre opcional |
| `notes` | `text` | sí | texto libre |

**Los dos ENUM de Postgres**, declarados al principio del DDL y compartidos con otras tablas:

- `notificationType` — `esaviapp.sql:31` — `('SEVERE', 'NON_SEVERE')`.
- `answerOption` — `esaviapp.sql:26` — `('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER')`.

Añadir un valor a cualquiera de los dos es una migración del esquema, no un cambio de aplicación. Ninguno de los dos admite valores libres: un `INSERT` con otra cadena falla con `22P02` y llegaría al cliente como 500. Por eso la validación de entrada de §3.5 es obligatoria, no defensiva.

**Índices.** `IX_notification_case` (`esaviapp.sql:741`) es **redundante** con el índice único que Postgres crea de oficio para `UQ_notification_case`: los dos son sobre `("caseId")`. La consulta de la operación `006` y el filtro por `caseId` funcionan igual con cualquiera de los dos. No se retira: modificar el DDL está fuera de alcance.

Las cuatro columnas transversales están presentes y completas: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB), más `createdAt` y `updatedAt`.

**Triggers.** El único que alcanza a la tabla es `TRG_notification_setSysDetails`, del bucle genérico de `esaviapp.sql:1280-1291`. **No existe `TRG_notification_setUpdatedAt`** ni **`TRG_notification_preventPhysicalDelete`**: `notification` no figura en la lista de `esaviapp.sql:1363-1366`, así que un `DELETE` físico ejecuta sin error.

### 3.2 Modelo Sequelize

Archivo: `src/models/notification.model.ts`. Clase `Notification`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notification'`. PK `notificationId` con `defaultValue: sequelize.literal('gen_random_uuid()')`.

`caseId`, `notificationType` y `esaviDescription` van `allowNull: false`, calcando el DDL; todo lo demás va `allowNull: true`.

**Las tres columnas ENUM se declaran con `DataTypes.ENUM(...)`**, alimentado por las constantes de §3.3. Es el primer uso de `DataTypes.ENUM` en `src/models/`: no hay precedente que imitar, así que la regla que este spec fija —y que hereda toda entidad posterior con ENUM de Postgres— es que **los valores nunca se escriben literales en el modelo**, sino que se importan del archivo de constantes, para que modelo y validador no puedan divergir.

`requestInvestigation` se declara `DataTypes.BOOLEAN` con `defaultValue: false`, calcando el `DEFAULT` del DDL. `autopsyRequested` y `verbalAutopsyPerformed` van `DataTypes.BOOLEAN` **sin `defaultValue`**: declararlo convertiría su tri-estado en dos estados.

Asociaciones, en `src/models/associations/notification.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `Notification.belongsTo(EsaviCase, { as: 'case', foreignKey: 'caseId' })`
- `Notification.belongsTo(CatalogItem, { as: 'outcome', foreignKey: 'outcomeItemId' })`
- `EsaviCase.hasOne(Notification, { as: 'notification', foreignKey: 'caseId' })` — `hasOne` y no `hasMany` porque `UQ_notification_case` lo impone, siguiendo el criterio que F09 fijó para `classification`.

Ninguna va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso **no se añade a ninguna respuesta de `esaviCase`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia.

### 3.3 Tipos y constantes

**Constantes** — `src/constants/notification.constants.ts`, archivo nuevo:

```ts
export const NOTIFICATION_TYPES = ['SEVERE', 'NON_SEVERE'] as const;
export const ANSWER_OPTIONS = ['YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type AnswerOption = (typeof ANSWER_OPTIONS)[number];
```

`ANSWER_OPTIONS` se declara aquí aunque el ENUM `answerOption` lo compartan otras seis tablas del esquema —`severeNotification`, `nonSevereNotification` y cuatro más, todas fuera de alcance—. Cuando alguna de ellas se especifique, la constante se **mueve** a un archivo compartido; no se duplica.

**Tipos** — `src/types/notification/notification.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`:

```ts
export interface CreateNotificationInput {
    caseId: string;
    notificationType: NotificationType;
    esaviDescription: string;
    hasRelevantMedicalHistory?: AnswerOption | null;
    takesMedication?: AnswerOption | null;
    outcomeItemId?: string | null;
    requestInvestigation?: boolean;
    deathDate?: string | null;
    autopsyRequested?: boolean | null;
    verbalAutopsyPerformed?: boolean | null;
    notes?: string | null;
    isActive?: boolean;
}
```

`requestInvestigation` es el único booleano opcional **sin `| null`**: no se guarda nunca en `null`. Los otros dos lo admiten explícitamente, que es lo que sostiene su tri-estado.

El update usa `Partial<CreateNotificationInput>`. No se declara `UpdateNotificationInput`. `caseId` y `notificationType` aparecen en el `Partial` por construcción del tipo, pero **el servicio los ignora siempre**: son inmutables.

### 3.4 Superficie HTTP

```
POST   /api/notifications                ESAVI-NOTIFCN-001   USER        (nuevo)
GET    /api/notifications                ESAVI-NOTIFCN-002A  USER        (nuevo)
GET    /api/notifications/admin          ESAVI-NOTIFCN-002B  ADMIN       (nuevo)
GET    /api/notifications/case/:caseId   ESAVI-NOTIFCN-006   USER        (nuevo)
GET    /api/notifications/:id            ESAVI-NOTIFCN-003   USER        (nuevo)
PUT    /api/notifications/:id            ESAVI-NOTIFCN-004   USER        (nuevo)
DELETE /api/notifications/:id            ESAVI-NOTIFCN-005A  ADMIN       (nuevo)
PATCH  /api/notifications/activate/:id   ESAVI-NOTIFCN-005B  SUPERADMIN  (nuevo)
DELETE /api/notifications/purge/:id      ESAVI-NOTIFCN-005C  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/notification.routes.ts`: las rutas con prefijo literal (`/admin`, `/case/:caseId`, `/activate/:id`, `/purge/:id`) van **antes** de `/:id`, o Express capturará `admin` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la misma desviación de los SPEC F05, F06, F07 y F09 y por la misma razón: la notificación se captura en el mismo flujo operativo que el caso. `005A` se queda en ADMIN y `005B` y `005C` en SUPERADMIN.

**La abreviatura es `NOTIFCN`, no `NOTIF`.** `NOTIFIER` ya está registrada, y `ESAVI-NOTIF-` sería prefijo de `ESAVI-NOTIFIER-`: todo `grep` de los criterios de aceptación devolvería las dos entidades mezcladas. Con `NOTIFCN` ninguna de las dos es prefijo de la otra.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`notification` · `006` · obtener la notificación de un caso**.

### 3.5 Reglas de negocio por operación

#### La regla de fallecimiento — compartida por `001` y `004`

Es la regla de negocio propia de la entidad, y vive **en el servicio**: depende del `code` del `catalogItem` referenciado, que el validador no puede ver.

1. Si llega `outcomeItemId`, se resuelve el item: existente, `isActive: true` y perteneciente al `catalogType` de código `outcome` → si no, **404** `NOTIFCN_<op>_OUTCOME_NOT_FOUND`. Un `catalogType` `outcome` sin sembrar hace que **todo** `outcomeItemId` caiga en este 404; es la precondición de despliegue que §2 declara.
2. Se lee el `code` del item resuelto y se compara con `DEATH` —en `toConstantCase`, como los guarda `catalogItem.service.ts:22`—.
3. Si el código es `DEATH`: `deathDate` y `autopsyRequested` son **obligatorios** → si falta cualquiera, **400** `NOTIFCN_<op>_DEATH_FIELDS_REQUIRED`. `verbalAutopsyPerformed` sigue siendo opcional.
4. Si el código **no** es `DEATH`, o si no llega `outcomeItemId`: enviar `deathDate`, `autopsyRequested` o `verbalAutopsyPerformed` es **400** `NOTIFCN_<op>_DEATH_FIELDS_NOT_ALLOWED`. No se ignoran en silencio: guardar una fecha de defunción bajo un desenlace de recuperación es un dato contradictorio que nadie detectaría después.
5. `deathDate` no futura, lo emite el **validador** con 400, reutilizando el helper `isNotFutureDate` que ya usan `esaviCase` y `patient`.

En el `004`, los pasos 3 y 4 se evalúan sobre el **estado resultante** —lo que ya hay en la fila fusionado con lo que llega en el body—, no solo sobre el body. Si no, un `PUT` que cambia el desenlace de `DEATH` a `RECOVERED` sin tocar `deathDate` dejaría la fecha huérfana. Cambiar el desenlace **a** un valor distinto de `DEATH` exige limpiar los tres campos en el mismo `PUT`, enviándolos en `null`; si no, es 400.

#### Por operación

**`ESAVI-NOTIFCN-001` — crear.** En este orden:

1. Valida `caseId`: existe y `isActive: true` → 404 `NOTIFCN_001_CASE_NOT_FOUND`. Un caso retirado no se notifica.
2. Comprueba que el caso **no tenga ya notificación**, sin filtrar por `isActive` → 409 `NOTIFCN_001_CASE_ALREADY_NOTIFIED`. Es el canon de §11: la `UNIQUE` del DDL tampoco filtra por `isActive`, así que un `caseId` ocupado por una notificación desactivada **sigue ocupado**. El mensaje lleva `{{caseId}}`, porque si no el cliente ve un 409 por una fila que no puede ver.
3. Resuelve el desenlace y aplica la regla de fallecimiento completa.
4. `requestInvestigation` se guarda `false` si no llega.
5. Normaliza: `.trim()` sobre `esaviDescription` y `notes`. No hay más normalización: la entidad no tiene `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
6. Inserta con la entrada de auditoría `method: 'ESAVI-NOTIFCN-001'`.

**`ESAVI-NOTIFCN-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, includes `case` y `outcome`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Cuatro filtros opcionales por query, acumulativos con `AND`:

- `caseId` — igualdad, UUID.
- `notificationType` — igualdad, uno de `NOTIFICATION_TYPES`. Un valor fuera del ENUM es **400** del validador, no un 500 de Postgres.
- `requestInvestigation` — igualdad, booleano.
- `outcomeItemId` — igualdad, UUID.

Un filtro de FK con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma reducida de §3.7.

**`ESAVI-NOTIFCN-002B` — listar, admin.** Idéntica, sin `isActive` en el `where`. Los mismos cuatro filtros.

**`ESAVI-NOTIFCN-003` — obtener por ID.** `where` con `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero —hoy **SUPERADMIN**, `src/helpers/permissions.helper.ts:24-26`— → 404 `NOTIFCN_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-NOTIFCN-006` — obtener por caso.** Mismo servicio de lectura que `003` pero buscando por `caseId`, con los mismos includes, la misma forma completa y la misma regla de `canViewInactive`. Dos 404 distintos, y la diferencia importa para el cliente:

- El caso no existe → 404 `NOTIFCN_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene notificación visible → 404 `NOTIFCN_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la relación es uno a uno y envolver una ficha en una colección obligaría al cliente a desempaquetar un array de un elemento.

**`ESAVI-NOTIFCN-004` — actualizar.** En este orden:

1. Existencia → 404 `NOTIFCN_004_NOT_FOUND`.
2. `caseId` y `notificationType` **se ignoran siempre**, vengan o no en el body. Una notificación no se traslada entre casos, y el tipo gobierna qué tabla satélite le corresponde: cambiarlo hoy, sin las satélites implementadas, dejaría filas huérfanas cuando lleguen.
3. Resuelve el desenlace y aplica la regla de fallecimiento sobre el **estado resultante**.
4. `requestInvestigation` conserva su valor si no llega en el body; nunca pasa a `null`.
5. Normaliza con `.trim()` los dos textos libres que lleguen. `esaviDescription` no puede quedar en cadena vacía → 400.
6. Escribe `updatedAt` explícitamente. No hay trigger que lo haga.
7. Preserva el historial con `[...currentAppDetails, newEntry]`.

**`ESAVI-NOTIFCN-005A` / `005B` — desactivar y reactivar.** `setNotificationActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, calculando `const op = isActive ? '005B' : '005A'`. El `where` filtra **solo por la PK**. `DELETE` sella `deletedAt`; `PATCH /activate` lo deja en `null`. Ambos responden `{ ok, message }` sin `data`.

Reactivar una notificación **no exige** que su caso esté activo, por la misma razón que en `notifier` y `classification`: la cascada es solo de bajada y quien reactiva es SUPERADMIN. No puede haber conflicto con la `UNIQUE` al reactivar, porque el `caseId` nunca se liberó.

**La cascada — ampliación de `ESAVI-CASE-005A`.** Dentro de la transacción que `setEsaviCaseActivationService` ya abre, en el **mismo punto** donde el SPEC F07 dejó `cascadeDeactivateNotifiers` (`src/services/esaviCase.service.ts:357-381`) y **solo cuando `isActive === false`**, se añade un `Notification.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt`, y añade a `appDetails` una entrada con `method: 'ESAVI-CASE-005A'` —el código de la operación que la desactivó, no el suyo— reutilizando el mismo `sequelize.literal` que ya resuelve el `appDetails` heredado como objeto. Un caso sin notificación desactiva cero filas y no falla. `ESAVI-CASE-005B` no reactiva nada.

**`ESAVI-NOTIFCN-005C` — purgar.** `purgeNotificationService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` → 404 `NOTIFCN_005C_NOT_FOUND`; la fila debe estar en `isActive: false` → si no, 409 `NOTIFCN_005C_STILL_ACTIVE`; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. Las reglas transversales están en el [SPEC F08](./08-physical-delete.md) y no se repiten aquí.

**Purgar sí libera el `caseId`**, y es la única vía que lo hace. **Advertencia para cuando lleguen las satélites:** las ocho declaran `ON DELETE CASCADE` sobre `notificationId`, así que un `005C` arrastrará consigo toda la notificación detallada sin pedir confirmación. Hoy no hay nada que arrastrar; cuando lo haya, esa operación debe revisarse.

**Validaciones de forma** (las emite `validateFields` con 400): `caseId` obligatorio y `.isUUID()` en create; `notificationType` obligatorio en create y `.isIn(NOTIFICATION_TYPES)`; `esaviDescription` obligatorio en create, cadena no vacía tras `.trim()`; `hasRelevantMedicalHistory` y `takesMedication` con `.isIn(ANSWER_OPTIONS)` cuando lleguen; `outcomeItemId` con `.isUUID()` cuando llegue; `requestInvestigation`, `autopsyRequested` y `verbalAutopsyPerformed` con `.isBoolean()`; `deathDate` con `.isISO8601()` y no futura; `notes` como cadena.

`deathDate` **no** se valida contra `esaviCase.eventDate`: el validador solo ve el body y el caso está en otra tabla. Queda anotado en §7 como riesgo asumido.

### 3.6 Claves i18n nuevas

Bloque `notification` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `deletedSuccess` / `deletedFailed` | `005A` |
| `activatedSuccess` / `activatedFailed` | `005B` |
| `notFound` | 404 en `003`, `004`, `005A`, `005B` y `006` |
| `idRequired` | parámetro ausente |
| `alreadyActive` / `alreadyInactive` | 409 de `setEntityActiveStatusService` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `stillActive` | 409 al purgar una notificación activa. Lleva `{{id}}` |
| `caseNotFound` | 404 cuando `caseId` no existe o está inactivo, en `001` y en `006` |
| `caseAlreadyNotified` | 409 cuando el caso ya tiene notificación, activa o no. Lleva `{{caseId}}` |
| `outcomeNotFound` | 404 cuando el `outcomeItemId` no existe, está inactivo o no es del catálogo `outcome` |
| `deathFieldsRequired` | 400 cuando el desenlace es `DEATH` y falta `deathDate` o `autopsyRequested` |
| `deathFieldsNotAllowed` | 400 cuando el desenlace no es `DEATH` y llega alguno de los tres campos de fallecimiento |

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave al bloque `esaviCase`: la cascada no produce mensajes propios.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004` y `006`:

```
{ ok, message, data: {
    notificationId, notificationType, esaviDescription,
    hasRelevantMedicalHistory, takesMedication,
    requestInvestigation, deathDate, autopsyRequested, verbalAutopsyPerformed,
    notes, isActive, createdAt, updatedAt, deletedAt, appDetails,
    case:    { caseId, caseCode, reportDate, eventDate },
    outcome: { catalogItemId, code, name }
} }
```

**Reducida** — `002A` y `002B`, dentro de `{ count, rows }`: la misma forma **sin `notes` y sin `appDetails`**, y sin `createdAt`, `updatedAt` ni `deletedAt`. `esaviDescription` **sí va**: es el dato que identifica de qué trata cada notificación, y una lista sin él obliga a abrir cada ficha para saber qué es.

`case` incluye `eventDate` porque es la fecha contra la que un cliente contrasta `deathDate`, aunque este spec no lo valide en servidor.

Los campos tri-estado —`hasRelevantMedicalHistory`, `takesMedication`, `autopsyRequested`, `verbalAutopsyPerformed`— se devuelven **tal como están**, `null` incluido: nunca se normalizan a `NO_ANSWER` ni a `false` al construir la respuesta. `outcome` nulo se devuelve como `null`, no se omite. `sysDetails` **nunca** se devuelve, en ninguna operación.

---

## 4. Plan de implementación

**Precondiciones.** Dos, antes del paso 1:

- El **SPEC F06** debe estar implementado —lo está—. `caseId` es `NOT NULL`, y la asociación, la validación de FK y la cascada necesitan el modelo `EsaviCase`.
- Debe existir un `catalogType` con `code = 'outcome'` y sus `catalogItem` activos, entre ellos el de código `DEATH`, cargados por los endpoints ya existentes de catálogos. Sin ellos, toda alta que envíe `outcomeItemId` devuelve 404 `outcomeNotFound`.

**No** depende del SPEC F09: `notification` y `classification` son satélites hermanos y no se referencian entre sí. Si F09 se implementa antes, el único punto de contacto es el total de `ROUTE_RULES` del paso 13 y el bloque de cascada del paso 11, donde los dos specs añaden código contiguo.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Constantes, modelo, asociaciones y tipos.** `src/constants/notification.constants.ts` con `NOTIFICATION_TYPES`, `ANSWER_OPTIONS` y sus dos tipos derivados; `src/models/notification.model.ts` con los tres `DataTypes.ENUM` alimentados por esas constantes, `caseId`, `notificationType` y `esaviDescription` en `allowNull: false`, `requestInvestigation` con `defaultValue: false` y los otros dos booleanos **sin `defaultValue`**; `src/models/associations/notification.associations.ts` con `case` y `outcome`, más el inverso `EsaviCase.hasOne(Notification, { as: 'notification' })`, registrado en `initModels()`; `src/types/notification/notification.types.ts` con `CreateNotificationInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `Notification.findAndCountAll({ include: ['case', 'outcome'] })` desde un script suelto devuelve filas sin error de asociación; un `Notification.create` con `notificationType: 'OTRO'` falla en Sequelize **antes** de llegar a Postgres; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `esaviCase`.

2. **Claves i18n.** El bloque `notification` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las veinticuatro claves.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

3. **Validadores.** `src/validators/notification.validator.ts` con cinco arrays: `notificationIdValidator`, `notificationCaseIdValidator` (para el `param('caseId')` del `006`), `notificationListValidator` (los cuatro filtros de §3.5 más `limit` y `offset`), `createNotificationValidator` y `updateNotificationValidator`. Ambos de cuerpo incluyen las validaciones de forma de §3.5, con `.isIn(NOTIFICATION_TYPES)` y `.isIn(ANSWER_OPTIONS)` importados de las constantes del paso 1, y `deathDate` con `isNotFutureDate`. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

4. **`ESAVI-NOTIFCN-001` — crear.** `createNotificationService` con los seis pasos de §3.5 en ese orden: FK del caso, unicidad del `caseId` sin filtrar por `isActive`, resolución del desenlace con la regla de fallecimiento completa, `requestInvestigation` a `false` por defecto, `.trim()` de los textos, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un alta mínima —`caseId`, `notificationType`, `esaviDescription`— devuelve 201 con `requestInvestigation: false` y los cuatro tri-estado en `null`; notificar dos veces el mismo caso devuelve **409** `NOTIFCN_001_CASE_ALREADY_NOTIFIED`, y también lo devuelve si la primera está desactivada; un `caseId` inactivo devuelve **404**; `notificationType: 'GRAVE'` devuelve **400** del validador, no 500; un `outcomeItemId` de otro `catalogType` devuelve **404**; con el item `DEATH` y sin `deathDate` devuelve **400** `deathFieldsRequired`; con el item `DEATH` y sin `autopsyRequested` devuelve **400**; con un desenlace distinto de `DEATH` y `deathDate` en el body devuelve **400** `deathFieldsNotAllowed`; `deathDate` de mañana devuelve **400** del validador.

5. **`ESAVI-NOTIFCN-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, los cuatro filtros acumulativos, los dos includes, orden `createdAt DESC`, paginación y forma reducida de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve notificaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?notificationType=SEVERE` filtra correctamente y `?notificationType=X` devuelve **400**; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los cuatro filtros combinados se aplican con `AND`; toda fila trae `esaviDescription` y ninguna trae `notes`, `appDetails` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total.

6. **`ESAVI-NOTIFCN-003` — obtener por ID.** `getNotificationByIdService(id, lang, includeInactive)` con los dos includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una notificación desactivada devuelve 404 para USER y para ADMIN, y 200 para SUPERADMIN; los tri-estado no informados llegan como `null`; `outcome` nulo llega como `null` y no se omite; `sysDetails` no aparece.

7. **`ESAVI-NOTIFCN-006` — obtener por caso.** `getNotificationByCaseIdService(caseId, lang, includeInactive)` con los dos 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `notificationCaseIdValidator`, declarada antes de `/:id`. Fila `notification` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con notificación devuelve 200 con la ficha completa, no envuelta en un array; un caso sin notificación devuelve 404 `NOTIFCN_006_NOT_FOUND`; un `caseId` inexistente devuelve 404 `NOTIFCN_006_CASE_NOT_FOUND` — un código distinto del anterior; un caso cuya notificación está inactiva devuelve 404 para USER y 200 para SUPERADMIN; `GET /case/no-es-uuid` devuelve 400.

8. **`ESAVI-NOTIFCN-004` — actualizar.** `updateNotificationService` con los siete pasos de §3.5, evaluando la regla de fallecimiento sobre el **estado resultante** y escribiendo `updatedAt` explícitamente. Ruta `PUT /:id` en USER.
   *Verificación:* enviar `caseId` o `notificationType` no los modifica y no devuelve error; cambiar el desenlace de `DEATH` a otro sin limpiar `deathDate` devuelve **400** `deathFieldsNotAllowed`; el mismo cambio enviando `deathDate`, `autopsyRequested` y `verbalAutopsyPerformed` en `null` devuelve **200**; cambiar el desenlace a `DEATH` sin enviar `deathDate` devuelve **400**; un `PUT` que no toca `requestInvestigation` lo deja como estaba y nunca en `null`; `esaviDescription: "   "` devuelve **400**; un `PUT` sin cambios devuelve 200 con una entrada más en `appDetails`, las anteriores intactas y `updatedAt` actualizado.

9. **`ESAVI-NOTIFCN-005A` y `005B` — desactivar y reactivar.** `setNotificationActivationService` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El `where` filtra solo por la PK. Dos controladores y dos rutas: `DELETE /:id` en ADMIN, `PATCH /activate/:id` en SUPERADMIN, ambas respondiendo sin `data`.
   *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve 409 `NOTIFCN_005A_ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe 403 en `PATCH /activate/:id`; reactivar una notificación cuyo caso está inactivo devuelve **200**; tras desactivar, `POST` sobre el mismo caso sigue devolviendo **409**, no 201.

10. **`ESAVI-NOTIFCN-005C` — purgar.** `purgeNotificationService` sobre `purgeEntityService`, con transacción propia. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `notificationIdValidator` y declarada junto a las otras literales.
    *Verificación:* purgar una notificación activa devuelve 409 `NOTIFCN_005C_STILL_ACTIVE` y la fila sigue ahí; desactivarla y purgarla devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre el mismo caso devuelve 201**: es la única vía que libera el `caseId`; el caso al que pertenecía sigue existiendo e intacto.

11. **La cascada — ampliar `ESAVI-CASE-005A`.** En el mismo bloque de `src/services/esaviCase.service.ts:357-381` donde vive `cascadeDeactivateNotifiers`, una función hermana `cascadeDeactivateNotification` con un `Notification.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt` y añade la entrada con `method: 'ESAVI-CASE-005A'`, reutilizando el mismo `sequelize.literal` de `appDetails`, invocada dentro de la misma transacción y **solo cuando `isActive === false`**. Este paso va el último de los de código porque depende del modelo del paso 1 y no lo necesita ningún paso anterior.
    *Verificación:* desactivar un caso con notificación y notificadores activos los deja **todos** inactivos con `deletedAt` sellado; reactivar el caso no reactiva ninguno; desactivar un caso sin notificación responde 200 sin error; desactivar un caso ya inactivo devuelve 409 y **nada** cambia de estado; una notificación que ya estaba inactiva conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; el `appDetails` de la arrastrada registra `ESAVI-CASE-005A`.

12. **Registrar la entidad en las convenciones.** Fila `notification` → `NOTIFCN` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `notification` · `006` · «obtener la notificación de un caso» en la tabla de operaciones no canónicas.
    *Verificación:* `NOTIFCN` aparece una sola vez y no colisiona con las catorce existentes; la tabla de no canónicas suma exactamente una fila.

13. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **90 a 99** (`tests/auth/roles.test.ts:198`). Si el SPEC F09 se implementa antes, el total de partida es el que aquél haya dejado.
    *Verificación:* `npm test -- roles` pasa.

14. **Suite de contrato `tests/contract/notification.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → desactivar → reactivar → purgar. Más los caminos de error: `caseId` inexistente (404), `caseId` inactivo (404), caso ya notificado activo e inactivo (409 los dos), `notificationType` fuera del ENUM (400), `notificationType` ausente en el alta (400), `esaviDescription` ausente o vacío (400), `hasRelevantMedicalHistory` fuera del ENUM (400), `outcomeItemId` de otro catálogo (404), `DEATH` sin `deathDate` (400), `DEATH` sin `autopsyRequested` (400), desenlace no `DEATH` con `deathDate` (400), `deathDate` futura (400). Y las tres reglas propias: `notificationType` y `caseId` inmutables en el `PUT`, la regla de fallecimiento evaluada sobre el estado resultante, y `requestInvestigation` que nunca queda en `null`.
    *Verificación:* `npm test -- notification` en verde.

15. **Ampliar `tests/contract/esaviCase.test.ts` con la cascada.** Tres casos nuevos sobre la suite ya existente: desactivar un caso arrastra su notificación activa; reactivarlo no la devuelve; una notificación desactivada a mano antes de la cascada conserva su estado y su `deletedAt`. Los casos de `notifier` que introdujo el F07 se mantienen intactos.
    *Verificación:* `npm test` en verde; ni la suite de `esaviCase` ni la de `notifier` pierden ningún caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-NOTIFCN-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-NOTIFCN-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "ESAVI-NOTIF-" src/` no devuelve resultados: la abreviatura es `NOTIFCN`, y ningún código de `notifier` aparece bajo un prefijo compartido.
- [ ] `NOTIFCN` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `notification` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/notification/index.ts` está presente.
- [ ] `GET /api/notifications/admin` y `GET /api/notifications/case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `EsaviCase.hasOne(Notification)` está declarado, y `notification` **no** aparece en ninguna respuesta de `/api/esavi-cases`.
- [ ] `esaviapp.sql` no tiene ni una línea modificada.

**ENUM**

- [ ] `src/constants/notification.constants.ts` existe, y `grep -rn "'NON_SEVERE'" src/` solo lo encuentra ahí: ni el modelo ni el validador repiten los literales.
- [ ] Los valores de `NOTIFICATION_TYPES` y `ANSWER_OPTIONS` coinciden exactamente con los ENUM de `esaviapp.sql:26` y `esaviapp.sql:31`, en el mismo orden.
- [ ] `POST` con `notificationType: 'GRAVE'` devuelve **400** con el envoltorio de `validateFields`, nunca 500. Lo mismo con `hasRelevantMedicalHistory: 'MAYBE'`.
- [ ] `POST` sin `notificationType` devuelve **400**: el DDL lo declara `NOT NULL` sin `DEFAULT`.
- [ ] `?notificationType=X` en el listado devuelve **400**, no un 500 de Postgres.
- [ ] Enviar `notificationType` en `PUT /:id` no cambia el tipo y devuelve **200**.

**Regla de fallecimiento**

- [ ] Con el `outcomeItemId` del item de código `DEATH` y sin `deathDate` → **400** `deathFieldsRequired`.
- [ ] Con ese mismo item y sin `autopsyRequested` → **400** `deathFieldsRequired`.
- [ ] Con ese mismo item, `deathDate` y `autopsyRequested`, y **sin** `verbalAutopsyPerformed` → **201**: el tercer campo es siempre opcional.
- [ ] Con un `outcomeItemId` cuyo código no es `DEATH` y `deathDate` en el body → **400** `deathFieldsNotAllowed`. Igual con `autopsyRequested` y con `verbalAutopsyPerformed`.
- [ ] Sin `outcomeItemId` y con cualquiera de los tres campos → **400** `deathFieldsNotAllowed`.
- [ ] `deathDate` posterior a la fecha actual → **400**, emitido por el validador.
- [ ] Un `PUT` que cambia el desenlace de `DEATH` a otro **sin** limpiar los tres campos → **400**; el mismo `PUT` enviándolos en `null` → **200**. La regla se evalúa sobre el estado resultante, no sobre el body.
- [ ] Un `outcomeItemId` que no existe, está inactivo o pertenece a otro `catalogType` → **404** `outcomeNotFound`, con un código de `AppError` distinto de los dos de fallecimiento.

**Tri-estado y defaults**

- [ ] Un alta sin `requestInvestigation` guarda `false`, no `null`, y la respuesta lo devuelve como `false`.
- [ ] Un `PUT` que no menciona `requestInvestigation` lo deja como estaba; ninguna fila de la suite acaba con ese campo en `null`.
- [ ] `hasRelevantMedicalHistory`, `takesMedication`, `autopsyRequested` y `verbalAutopsyPerformed` no informados llegan como `null` en todas las respuestas, nunca como `NO_ANSWER` ni como `false`.
- [ ] `hasRelevantMedicalHistory: 'NO_ANSWER'` se guarda y se devuelve como `'NO_ANSWER'`, distinguible de `null`.

**Uno a uno**

- [ ] `POST` sobre un caso que ya tiene notificación **activa** devuelve **409** `caseAlreadyNotified`, con el `caseId` interpolado en el mensaje.
- [ ] `POST` sobre un caso cuya notificación está **inactiva** devuelve también **409**: el hueco no se libera con el borrado lógico.
- [ ] Purgar la notificación con `005C` libera el `caseId`, y un `POST` posterior sobre ese caso devuelve **201**.
- [ ] Enviar `caseId` en el body de `PUT /:id` deja el caso original intacto y no devuelve error.
- [ ] Ningún `INSERT` llega a Postgres con el `caseId` ocupado: la suite no produce ningún error `23505`.

**Acceso por caso (`006`)**

- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`.
- [ ] Un caso inexistente devuelve **404** `NOTIFCN_006_CASE_NOT_FOUND`; un caso sin notificación devuelve **404** `NOTIFCN_006_NOT_FOUND`. Los dos códigos son distintos.
- [ ] Un caso cuya notificación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN.

**Ciclo de vida y cascada**

- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` sellado; `PATCH /activate/:id` devuelve `deletedAt` a `null`.
- [ ] Repetir cualquiera de los dos devuelve **409** `alreadyInactive` / `alreadyActive`.
- [ ] Purgar una notificación activa devuelve **409** `stillActive` y la fila sigue existiendo.
- [ ] Desactivar un caso arrastra su notificación activa y sus notificadores activos, en la misma transacción.
- [ ] Reactivar el caso **no** reactiva la notificación.
- [ ] La notificación arrastrada registra `method: 'ESAVI-CASE-005A'` en `appDetails`, y su historial anterior queda intacto.
- [ ] Una notificación ya inactiva antes de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.

**Listados y respuesta**

- [ ] Los cuatro filtros de §3.5 se combinan con `AND` y son por igualdad.
- [ ] Un filtro de FK con un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`.
- [ ] Las filas del listado traen `esaviDescription` y no traen `notes`, `appDetails`, `createdAt`, `updatedAt` ni `deletedAt`.
- [ ] `sysDetails` no aparece en ninguna respuesta de ninguna operación.
- [ ] Ninguna respuesta incluye datos de las ocho tablas satélite.

**Cierre**

- [ ] Las veinticuatro claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` cubre las nueve rutas nuevas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `NOTIFCN`. **No:** `NOTIF`, que es prefijo de `NOTIFIER` y haría que todo `grep -rn "ESAVI-NOTIF"` devolviera las dos entidades mezcladas, rompiendo los criterios de aceptación por grep que este repositorio usa desde el SPEC 05.
- **Sí:** `DataTypes.ENUM` en el modelo, con los valores en `src/constants/notification.constants.ts`. **No:** `DataTypes.STRING` validado solo en el validador. Con `STRING`, cualquier valor que se colara —por una ruta futura, un seed o un script— llegaría a Postgres y saldría como 500 con un `22P02` ilegible. Con `ENUM`, Sequelize lo detiene antes de la consulta.
- **No:** repetir los literales del ENUM en el modelo y en el validador. Es la razón de existir del archivo de constantes: dos listas separadas divergen en cuanto alguien añada un valor en una sola.
- **Sí:** `notificationType` inmutable en el `004`. **No:** permitir el cambio de tipo. `severeNotification` y `nonSevereNotification` cuelgan del tipo por `notificationId`, y aunque estén fuera de alcance, un cambio hoy dejaría filas satélite huérfanas cuando lleguen. Si alguna vez hace falta, es una operación no canónica propia con su transacción, no un `PUT`.
- **Sí:** la regla de fallecimiento contra el `code` del `catalogItem`, resuelta en el servicio. **No:** una columna booleana `isDeath` en `notification` ni un valor del ENUM. El desenlace ya es un catálogo, y duplicar la información en dos sitios garantiza que se contradigan.
- **Sí:** **400** para las dos violaciones de la regla de fallecimiento. **No:** 409. §10 reserva el 409 para duplicados y para conflictos de estado de la fila; aquí el problema es la combinación de campos del body, que es exactamente lo que §10 clasifica como 400, aunque el chequeo viva en el servicio y no en `validateFields`.
- **Sí:** rechazar con 400 los campos de fallecimiento cuando el desenlace no es `DEATH`. **No:** ignorarlos en silencio, como F09 hace con la edad calculada. Ahí el servidor tenía un valor mejor que el del cliente y podía sustituirlo; aquí no hay valor correcto que poner, y guardar una fecha de defunción bajo un desenlace de recuperación es un dato contradictorio que nadie detectaría después.
- **Sí:** evaluar esa regla sobre el estado resultante en el `004`, como F09 hace con su matriz de gravedad. **No:** evaluarla solo sobre el body, que dejaría fechas huérfanas al cambiar el desenlace.
- **Sí:** `requestInvestigation` nunca en `null`. **No:** tratarlo como tri-estado. El DDL le puso `DEFAULT false` y a los otros booleanos no: es la propia tabla la que dice que aquí «no informado» y «no» son lo mismo.
- **Sí:** guardar `null` cuando un `answerOption` no llega. **No:** normalizarlo a `NO_ANSWER`. `NO_ANSWER` es una respuesta deliberada del notificador —«el paciente no contestó»—; `null` es un campo que el formulario no recogió. Fundirlos haría imposible medir la completitud de las notificaciones.
- **Sí:** `esaviDescription` en la forma reducida del listado. **No:** omitirlo por longitud, como se hace con `notes`. Es el campo que identifica de qué trata cada notificación; sin él, la lista obliga a abrir cada ficha.
- **Sí:** uno a uno con 409 y hueco que no se libera con el borrado lógico. Es el mismo criterio que F09 razonó para `classification`, y por el mismo motivo: la `UNIQUE` del DDL tampoco filtra por `isActive`.
- **Sí:** sumarse a la cascada de `ESAVI-CASE-005A`. **No:** cascada de subida en `005B`. F07 fijó el criterio y F09 lo hereda; cambiarlo aquí obligaría a que los tres satélites se comportaran distinto entre sí.
- **No:** validar `deathDate` contra `esaviCase.eventDate`, ni `notification` contra `classification.causedDeath`. Lo primero exige subir la comprobación al servicio con una lectura extra; lo segundo ata este spec a uno en `Borrador`. Los dos quedan en §7.
- **No:** tocar `esaviapp.sql` para retirar el `IX_notification_case` redundante. El índice de más cuesta escrituras marginales y no rompe nada; modificar el DDL afecta a datos ya cargados y a la carga del esquema en los tests.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| `GET /:id` captura `/admin` o `/case` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por un criterio de aceptación explícito |
| `deathDate` anterior al `eventDate` del caso, o posterior a él por años | Solo se valida que no sea futura. La comprobación cruzada queda fuera de alcance; el dato es corregible por `PUT` |
| Un desenlace `DEATH` sin que `classification.causedDeath` lo sea, o al revés | Sin mitigación en este spec: `classification` está en `Borrador`. Cuando se implemente, la coherencia entre las dos tablas merece su propio spec |
| Añadir un valor al ENUM `answerOption` en la base sin actualizar `ANSWER_OPTIONS` deja la aplicación rechazando un valor válido con 400 | El archivo de constantes es único y está citado en los criterios de aceptación; toda migración del ENUM debe tocarlo en el mismo commit |
| `005C` sobre una notificación con satélites arrastrará las ocho tablas por `ON DELETE CASCADE` sin avisar | Hoy no hay satélites implementadas y no hay filas que arrastrar. El spec que dé de alta la primera debe revisar esta operación; queda escrito en §3.5 |
| El `catalogType` de código `outcome` no sembrado convierte todo `outcomeItemId` en un 404 | Es precondición declarada en §2 y en el plan de implementación; el mensaje `outcomeNotFound` no distingue el caso, y esa ambigüedad se acepta a cambio de no añadir una clave más |
| Dos specs hermanos (F09 y F10) editan el mismo bloque de `esaviCase.service.ts` y el mismo total de `ROUTE_RULES` | El paso 11 aísla la cascada en una función hermana de `cascadeDeactivateNotifiers` en vez de ampliarla, para que los dos cambios no colisionen |

---

## 8. Impacto en el contrato HTTP

El spec añade nueve rutas nuevas y **no cambia la forma** de ninguna respuesta existente. Cambia un solo comportamiento ya observable:

**`DELETE /api/esavi-cases/:id` (`ESAVI-CASE-005A`) pasa a desactivar también la notificación activa del caso.** El status, el mensaje y el cuerpo de la respuesta son idénticos; lo que cambia es el efecto sobre otras filas. Un cliente que desactive un caso y consulte después `GET /api/notifications/case/:caseId` recibirá 404 donde antes —si la entidad hubiera existido— habría recibido 200.

`GET /api/esavi-cases` y `GET /api/esavi-cases/:id` **no** incluyen la notificación en su `data`: la asociación `hasOne` se declara pero no se usa en ninguna respuesta de aquella entidad.

---

## Lo que **no** está en este spec

- Las ocho tablas satélite de `notification`: `severeNotification`, `nonSevereNotification`, `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- `investigation`, `finalClassification` y las catorce tablas de investigación.
- Cualquier regla cruzada contra `classification`, incluida la coherencia entre un desenlace `DEATH` y `causedDeath`.
- Cambiar el `notificationType` de una notificación ya creada.
- Búsqueda por texto sobre `esaviDescription` o `notes`, y filtros por rango de fechas.
- Sembrar el `catalogType` de código `outcome`.
- Cualquier modificación de `esaviapp.sql`, incluidos los valores de los ENUM.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
