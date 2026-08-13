# SPEC F14 — CRUD de `nonSevereNotification`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC 09 (`healthFacility` — una de las tres FK apunta ahí), **SPEC F13 (`severeNotification` — dependencia dura de implementación: aporta `src/constants/enums.constants.ts` y las dos funciones de arrastre sobre las que este spec se cuelga; no se implementa hasta que aquél esté `Implementado`)**, **SPEC F10 (`notification` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa, y gobierna cuándo se revalidan las tres FK)
> **Fecha:** 2026-08-12
> **Objetivo:** Dar de alta `nonSevereNotification`, el detalle de una notificación no grave —dónde se vacunó y cómo se verificó el evento—, como la **segunda** entidad sin columna `isActive` y la primera de las satélites que arrastra claves foráneas propias.

---

## 1. Por qué existe este spec

`nonSevereNotification` es la **segunda de las ocho tablas satélite de `notification`** que recibe implementación, y la hermana simétrica de `severeNotification`. El [SPEC F10](./10-notification-header-crud.md) las dejó fuera de alcance en bloque; el [SPEC F13](./13-severenotification-crud.md) entregó la rama grave y, al hacerlo, resolvió por escrito los cuatro problemas estructurales que comparten todas. Este spec entrega la rama no grave: **dónde se vacunó** —establecimiento, sitio, dirección y ubicación geográfica— y **cómo se verificó el evento** —seis fuentes de verificación, cada una tri-estado—.

Hoy la tabla existe en `esaviapp.sql:760-783` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**Lo que ya está resuelto y aquí no se vuelve a razonar.** Los cuatro rasgos que el F13 §1 desarrolló los cumple esta tabla exactamente igual, y se citan en vez de repetirse:

- **La PK *es* la FK.** `notificationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`esaviapp.sql:761`) y destino de `FK_nonSevereNotification_notification` (`:779`). Sin `UNIQUE` adicional: la propia PK impone el uno a uno.
- **No tiene `isActive`.** Es la segunda del repositorio, y la que confirma que no fue un descuido: el F13 ya citó esta tabla como su prueba de que el esquema decidió que las satélites no gestionan su estado. De ahí salen, igual que allí, **cinco operaciones y no siete**.
- **El `ON DELETE CASCADE` dispara de verdad**, porque `notification` no figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1354-1360`).
- **No consume `answerOption`.** Es el único de los cuatro rasgos que no comparte con su hermana: sus seis fuentes de verificación son `boolean` anulables en el DDL (`esaviapp.sql:766-771`), no el ENUM de cinco valores. Siguen siendo tri-estado —`null` es «el formulario no lo recogió» y `false` es un «no» deliberado—, así que todo lo que este spec razona sobre el tri-estado se mantiene; lo que cambia es el tipo. `ANSWER_OPTIONS` sigue viva en `src/constants/enums.constants.ts` para `notification`, `severeNotification` y las seis tablas del esquema que la esperan, y este spec no la toca.

**Lo que es nuevo, y es la razón de que este spec no sea un calco.** Tres cosas la separan de su hermana:

**A — Es la primera satélite con claves foráneas propias.** `severeNotification` no referencia nada más que su cabecera: sus siete campos son datos sueltos. Ésta tiene **tres**, todas `ON DELETE RESTRICT` (`esaviapp.sql:780-782`): `vaccinationHealthFacilityId` → `healthFacility`, `vaccinationSiteItemId` → `catalogItem` y `vaccinationGeoLocationId` → `geoLocation`. Las tres son opcionales, y las tres hay que resolverlas contra la base antes de escribir.

**B — Esas tres FK entran en fricción con el update diferencial, y la resolución es la del F12.** Validar una FK cuesta una consulta; hacerlo en cada `PUT` que la mencione convierte cualquier reenvío completo del `GET` en un 404 en cuanto un establecimiento se desactive. **La revalidación la dispara el cambio de valor, no la presencia de la clave** — el mismo criterio que gobierna la escritura. La consecuencia, declarada de frente en §3.5: una fila puede conservar una FK que hoy apunta a un establecimiento inactivo, y eso es correcto — **es un registro histórico de dónde se vacunó, no un puntero vigente**.

**C — Restringe el nivel geográfico, y es regla nueva en el repositorio.** `healthFacility`, el único precedente con FK a `geoLocation`, no restringe nada: su servicio solo comprueba que la ubicación exista (`src/services/healthFacility.service.ts:180-186`). Aquí `vaccinationGeoLocationId` debe apuntar al **nivel más profundo sembrado**, calculado en tiempo de consulta con `GeoLocation.max('level')`. No se ancla a ningún `geoLevelType.code`: los códigos cambian de un país a otro —`parish`, `parroquia`, `ward`— y anclar el filtro a un literal condena el despliegue al primer país que se modeló. `geoLocation.level` sirve porque **no es un dato que el cliente elija**: lo deriva la aplicación como `data.level ?? (parent ? parent.level + 1 : 1)` (`geoLocation.service.ts:32`), con `1` en la raíz.

**Y un rasgo que no la separa:** el trigger. `TRG_nonSevereNotification_setSysDetails` lo monta el bucle genérico sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1275-1290`). No existe `TRG_nonSevereNotification_setUpdatedAt`, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `nonSevereNotification`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Cinco operaciones, no siete:** `001` crear, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`**, ni **ningún listado** —`002`, `002A` ni `002B`—. Las dos ausencias son las del F13 y por la misma razón: sin `isActive` no hay estado propio que activar, ni dos variantes de listado que devuelvan filas distintas.
- Relación **uno a uno** con `notification`, sostenida por la propia clave primaria. Crear el segundo detalle de una misma notificación devuelve **409**.
- **Guardas del alta**, en este orden: la notificación existe y está **activa** → 404; su `notificationType` es **`NON_SEVERE`** → 409; no tiene ya detalle → 409.
- **Validación de las tres FK**, todas opcionales y todas resueltas contra la base cuando llegan con valor:
  - `vaccinationHealthFacilityId` → existente y **activo** → 404.
  - `vaccinationSiteItemId` → existente, activo y perteneciente al `catalogType` de código **`vaccinationSite`** → 404.
  - `vaccinationGeoLocationId` → existente, activa y con `level` igual al **máximo global** que devuelva `GeoLocation.max('level')` → 404.
- **Revalidación de FK gobernada por el cambio, no por la presencia** (SPEC F12): en el `004`, una FK que llega con el mismo valor guardado no se consulta ni se comprueba. Una fila conserva la FK que se registró aunque el destino se haya desactivado después.
- **Visibilidad heredada de la cabecera.** Toda lectura incluye `notification` y comprueba su `isActive`: si la notificación está inactiva, el detalle responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Regla de coherencia de la fuente «otra»**, evaluada en el servicio sobre el **estado resultante** en el `004`, no sobre el body: con `verifiedOtherSource: true` la descripción es obligatoria → 400; con cualquier otro valor o con `null`, enviar descripción es → 400.
- **Arrastre desde la cabecera, por los dos caminos que la desactivan** —`ESAVI-NOTIFCN-005A` y `ESAVI-CASE-005A`—, y **limpieza desde `ESAVI-NOTIFCN-005B`**, con la misma mecánica, el mismo criterio de `method` y la misma excepción de cascada de subida que el F13 razonó. Implica volver a tocar `src/services/notification.service.ts` y `src/services/esaviCase.service.ts`, esta vez **junto a** la función hermana que aquél dejó escrita.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `NSEVNOT_005C_NOT_DELETED`.
- **Extracción de esa guarda a un helper compartido** con `severeNotification`, sin tocar `purgeEntityService`. Es la respuesta a la condición que el F13 §6 dejó escrita —«si la segunda satélite necesita lo mismo, ése es el momento de generalizarlo»— y está razonada en §6.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12): los doce campos son anulables y entran comparados contra `undefined`; `notificationId` es inmutable y se ignora si llega.
- **Volcado al log de la fila arrastrada por `ESAVI-NOTIFCN-005C`**, en nivel `warn`, junto al que el F13 ya añadió para el detalle grave. Una notificación con detalle deja ahora **dos** volcados; nunca tres, porque las dos ramas son excluyentes por `notificationType`.
- Alta de la abreviatura **`NSEVNOT`** en `references/CONVENTIONS.md` §6 — reservada de palabra por el F13 y ahora registrada.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Cinco filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **113 a 118**, contando las cinco que añade el F13—, suite `tests/contract/nonSevereNotification.test.ts`, y ampliación de `tests/contract/notification.test.ts` y `tests/contract/esaviCase.test.ts` con el arrastre de la segunda rama.

**Precondiciones de datos** (no son parte de la implementación):

- El `catalogType` de código **`vaccinationSite`** sembrado con sus items activos, por los endpoints ya existentes de catálogos. Sin él, **todo** `vaccinationSiteItemId` cae en 404.
- Al menos un `geoLocation` en el nivel más profundo. Con un árbol geográfico de un solo nivel, el máximo es `1` y solo se admitiría la raíz.

**Fuera de alcance (otros specs):**

- **Las otras seis satélites de `notification`:** `notificationEvent` (`esaviapp.sql:785-808`), `notificationMedication` (`810-831`), `notificationVaccine` (`833-857`), `notificationDiluent` (`859-878`), `notificationPregnancy` (`880-897`) y `notificationPregnancyComplication` (`899-920`).
- **Cualquier regla de coherencia entre las tres columnas de lugar** —`vaccinationHealthFacilityId`, `vaccinationCenterAddress` y `vaccinationGeoLocationId`—. Las tres son opcionales e independientes: la vacunación pudo ocurrir en un puesto móvil sin establecimiento registrado, y es previsible que el funcional acabe pidiendo solo una de las tres. Cuando ese requisito se concrete, es un spec de ampliación con la regla escrita, no una suposición hoy.
- **Contrastar `vaccinationGeoLocationId` con el `geoLocationId` del establecimiento referenciado.** Un establecimiento lleva su propia ubicación y podría contradecir a la declarada; se acepta la discrepancia por lo mismo que el punto anterior.
- **Cualquier regla que exija al menos una fuente de verificación informada.** Un alta con los seis `verified*` en `null` es válida: es la vía normal de crear el detalle y completarlo con el `PUT`.
- **Cualquier listado de detalles no graves**, y cualquier filtro, conteo o tablero por los seis `verified*` o por establecimiento de vacunación. Si aparece un tablero que lo pida, es un `002` en su propio spec.
- **Anclar el nivel geográfico a un `geoLevelType.code`.** Descartado en §6: los códigos cambian por país.
- **Modificar `esaviapp.sql`**: ni añadir `isActive`, ni las FK, ni su `ON DELETE RESTRICT`, ni ningún `CHECK` sobre las columnas de lugar.
- **Modificar `setEntityActiveStatusService` o `purgeEntityService`.** Los dos se quedan como están; la guarda compartida vive en un helper propio, no dentro de ellos.
- **Bloquear `ESAVI-NOTIFCN-005C` cuando la notificación tiene detalle no grave.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión que el F13 tomó y aquí se hereda sin reabrirse.
- Cifrado de ningún campo, incluida `vaccinationCenterAddress`: es la dirección del centro de vacunación, no la del paciente.
- Búsqueda por texto sobre `vaccinationCenterAddress`, `otherSourceDescription` o `notes`.
- Crear el detalle automáticamente al dar de alta una notificación `NON_SEVERE`.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`nonSevereNotification` — `esaviapp.sql:760-783`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `notificationId` | `uuid` | no | **PK y FK a la vez**. Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente |
| `vaccinationHealthFacilityId` | `uuid` | sí | `FK_nonSevereNotification_facility` → `healthFacility`, `ON DELETE RESTRICT` |
| `vaccinationSiteItemId` | `uuid` | sí | `FK_nonSevereNotification_site` → `catalogItem`, `ON DELETE RESTRICT`. Acotado al catálogo `vaccinationSite` |
| `vaccinationCenterAddress` | `varchar(250)` | sí | texto libre. **Único campo con longitud máxima declarada** |
| `vaccinationGeoLocationId` | `uuid` | sí | `FK_nonSevereNotification_geo` → `geoLocation`, `ON DELETE RESTRICT`. Acotado al nivel más profundo |
| `verifiedPhysicalDocument` | `boolean` | sí | tri-estado con `null` |
| `verifiedElectronicRecord` | `boolean` | sí | ídem |
| `verifiedVerbalReport` | `boolean` | sí | ídem |
| `verifiedClinicalRecord` | `boolean` | sí | ídem |
| `verifiedUnknown` | `boolean` | sí | ídem |
| `verifiedOtherSource` | `boolean` | sí | ídem. Gobierna la regla de coherencia |
| `otherSourceDescription` | `text` | sí | solo con `verifiedOtherSource: true` |
| `notes` | `text` | sí | texto libre |

**Doce columnas de datos, todas anulables.** Ninguna es obligatoria: la única no nula de la tabla es la PK.

**Restricciones.** Cuatro claves foráneas y nada más: **ninguna `UNIQUE`** —la PK ya lo es— y **ningún `CHECK`**. Las tres FK de vacunación son `ON DELETE RESTRICT`, así que una fila de esta tabla **impide borrar físicamente** el establecimiento, el item de catálogo o la ubicación a los que apunta. Ningún índice declarado más allá del de la clave primaria.

**Las seis fuentes de verificación no son excluyentes.** Nada en el DDL impide que `verifiedPhysicalDocument` y `verifiedUnknown` valgan `true` a la vez, y este spec tampoco lo impide: son seis preguntas independientes de un formulario, no una selección única.

**El tri-estado sobre `boolean`.** Las seis columnas son `boolean` **anulables**, y esa nulabilidad es la que sostiene los tres estados: `true` y `false` son respuestas dadas, `null` es la ausencia de respuesta. Declararlas `NOT NULL DEFAULT false` respondería «no» a una pregunta que nadie llegó a hacer, y por eso no se hace. Esta entidad **no** consume `answerOption`.

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. **Falta `isActive`**, igual que en `severeNotification` y por la misma decisión del esquema.

**Triggers.** Solo `TRG_nonSevereNotification_setSysDetails`, del bucle genérico (`esaviapp.sql:1275-1290`). No hay `preventPhysicalDelete`: la tabla no figura en `esaviapp.sql:1354-1360`, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`.

### 3.2 Modelo Sequelize

Archivo: `src/models/nonSevereNotification.model.ts`. Clase `NonSevereNotification`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'nonSevereNotification'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en el F13: `gen_random_uuid()` convertiría un alta sin `notificationId` en un error de integridad en lugar de un 400 legible.

Los seis campos de verificación van `DataTypes.BOOLEAN` con `allowNull: true`. `vaccinationCenterAddress` va `DataTypes.STRING(250)` —**con la longitud explícita**, para que un texto de 300 caracteres falle en Sequelize y no en Postgres—, `otherSourceDescription` y `notes` van `DataTypes.TEXT`, y las tres FK `DataTypes.UUID`. Todos `allowNull: true`.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/nonSevereNotification.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NonSevereNotification.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasOne(NonSevereNotification, { as: 'nonSevereNotification', foreignKey: 'notificationId' })`
- `NonSevereNotification.belongsTo(HealthFacility, { as: 'vaccinationHealthFacility', foreignKey: 'vaccinationHealthFacilityId' })`
- `NonSevereNotification.belongsTo(CatalogItem, { as: 'vaccinationSite', foreignKey: 'vaccinationSiteItemId' })`
- `NonSevereNotification.belongsTo(GeoLocation, { as: 'vaccinationGeoLocation', foreignKey: 'vaccinationGeoLocationId' })`

Las dos primeras comparten columna en los dos lados, porque la PK del destino y la del origen son la misma. **Ningún inverso `hasMany` desde `healthFacility`, `catalogItem` ni `geoLocation`**: nadie los necesita y declararlos invitaría a incluirlos en las respuestas de aquellas entidades, cuyo contrato no cambia. El `hasOne` desde `Notification` sí se declara, porque lo necesitan el arrastre y el volcado al log. Alta en `src/models/index.ts`.

### 3.3 Tipos y constantes

**Ninguna constante compartida nueva, y ninguna importada tampoco.** Los seis campos son `boolean`, así que esta entidad no toca `src/constants/enums.constants.ts` ni en el modelo ni en el validador ni en los tipos.

**Una constante de módulo, privada del servicio**, siguiendo el patrón de `OUTCOME_CATALOG_CODE` en `notification.service.ts:13`:

```ts
// Code of the catalogType that groups the vaccination sites. Without this check any active
// catalogItem of the system would enter as a vaccination site.
const VACCINATION_SITE_CATALOG_CODE = 'vaccinationSite';
```

No va a `src/constants/`: es un literal que solo este servicio usa, y el precedente lo dejó en el archivo del servicio.

**Tipos** — `src/types/nonSevereNotification/nonSevereNotification.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`:

```ts
export interface CreateNonSevereNotificationInput {
    notificationId: string;
    vaccinationHealthFacilityId?: string | null;
    vaccinationSiteItemId?: string | null;
    vaccinationCenterAddress?: string | null;
    vaccinationGeoLocationId?: string | null;
    verifiedPhysicalDocument?: boolean | null;
    verifiedElectronicRecord?: boolean | null;
    verifiedVerbalReport?: boolean | null;
    verifiedClinicalRecord?: boolean | null;
    verifiedUnknown?: boolean | null;
    verifiedOtherSource?: boolean | null;
    otherSourceDescription?: string | null;
    notes?: string | null;
}
```

Sin `isActive`, como su hermana. `notificationId` es el único campo obligatorio; los doce restantes son opcionales y anulables, y esa nulabilidad explícita es la que sostiene tanto el tri-estado como la capacidad de **desasociar** una FK enviándola en `null`.

El update usa `Partial<CreateNonSevereNotificationInput>`. `notificationId` aparece en el `Partial` por construcción, pero **el servicio lo ignora siempre**.

### 3.4 Superficie HTTP

```
POST   /api/non-severe-notifications                 ESAVI-NSEVNOT-001   USER        (nuevo)
GET    /api/non-severe-notifications/case/:caseId    ESAVI-NSEVNOT-006   USER        (nuevo)
DELETE /api/non-severe-notifications/purge/:id       ESAVI-NSEVNOT-005C  SUPERADMIN  (nuevo)
GET    /api/non-severe-notifications/:id             ESAVI-NSEVNOT-003   USER        (nuevo)
PUT    /api/non-severe-notifications/:id             ESAVI-NSEVNOT-004   USER        (nuevo)
```

Orden de declaración en `src/routes/nonSevereNotification.routes.ts`: las rutas con prefijo literal (`/case/:caseId`, `/purge/:id`) van **antes** de `/:id`.

**`:id` es el `notificationId`.** No hay identificador propio; el parámetro se llama `:id` por uniformidad y el validador es el mismo `.isUUID()`.

Roles idénticos a los del F13, por la misma razón: el detalle se captura en el mismo flujo operativo que la notificación. Es la segunda entidad del repositorio **sin ninguna operación en ADMIN**, y por el mismo motivo — la única canónica que le correspondería, `005A`, no existe aquí.

`006` es la única operación no canónica y se registra en §6 de `CONVENTIONS.md` como **`nonSevereNotification` · `006` · obtener el detalle no grave de un caso**.

### 3.5 Reglas de negocio por operación

#### Resolución de las tres FK — compartida por `001` y `004`

Las tres son opcionales. **Un valor `null` no se resuelve ni se valida: desasociar siempre es legal.** Solo se consulta la base cuando llega un UUID con valor.

1. **`vaccinationHealthFacilityId`** → `findOne({ where: { healthFacilityId, isActive: true } })`. Si no aparece → **404** `NSEVNOT_<op>_HEALTH_FACILITY_NOT_FOUND`.
2. **`vaccinationSiteItemId`** → el item debe existir, estar activo y pertenecer al `catalogType` de código `vaccinationSite`, con el mismo `include` que `resolveOutcomeCode` usa en `notification.service.ts:128-141`. Si no → **404** `NSEVNOT_<op>_VACCINATION_SITE_NOT_FOUND`. Un catálogo sin sembrar hace que **todo** `vaccinationSiteItemId` caiga aquí; es la precondición de §2.
3. **`vaccinationGeoLocationId`** → la ubicación debe existir, estar activa y tener `level` igual al máximo global. Dos consultas: `GeoLocation.max('level', { where: { isActive: true } })` y después el `findOne` con ese `level` en el `where`. Si no → **404** `NSEVNOT_<op>_GEOLOCATION_NOT_FOUND`.

El máximo se calcula **sobre ubicaciones activas** y **en cada operación que lo necesite**, no se cachea: sembrar un nivel nuevo debe cambiar el comportamiento sin reiniciar el proceso. El 404 no distingue entre «no existe», «está inactiva» y «no es del nivel admitido» — tres causas, un mensaje, igual que el `outcomeNotFound` del F10.

#### La regla de la fuente «otra» — compartida por `001` y `004`

Es la única dependencia entre campos de la tabla, y vive en el **servicio**: en el `004` hay que evaluarla contra lo que ya está guardado, y el validador solo ve el body.

1. Si `verifiedOtherSource` resulta **`true`**, `otherSourceDescription` es **obligatoria** y no puede quedar vacía tras `.trim()` → si falta, **400** `NSEVNOT_<op>_OTHER_SOURCE_DESCRIPTION_REQUIRED`.
2. Si resulta `false` o `null`, enviar descripción es **400** `NSEVNOT_<op>_OTHER_SOURCE_DESCRIPTION_NOT_ALLOWED`.

En el `004` los dos pasos se evalúan sobre el **estado resultante** —lo guardado fusionado con lo que llega—, no solo sobre el body: mover `verifiedOtherSource` de `true` a `false` sin tocar la descripción dejaría el texto huérfano, así que exige limpiarla en el mismo `PUT` enviándola en `null`. Es la regla del embarazo del F13 con otros campos, y la del fallecimiento del F10 antes que ella. **400 y no 409**, por lo mismo: el problema es la combinación de campos del body aunque el chequeo viva en el servicio.

#### Por operación

**`ESAVI-NSEVNOT-001` — crear.** En este orden:

1. La notificación existe y está **activa** → 404 `NSEVNOT_001_NOTIFICATION_NOT_FOUND`.
2. Su `notificationType` es **`NON_SEVERE`** → si no, **409** `NSEVNOT_001_NOTIFICATION_NOT_NON_SEVERE`, con `{{notificationId}}`. Es 409 y no 400 por lo mismo que en el F13: una notificación `SEVERE` no puede tener detalle no grave nunca.
3. La notificación **no tiene ya detalle** → 409 `NSEVNOT_001_ALREADY_EXISTS`, con `{{notificationId}}`. Comprobado con un `findByPk` previo, no con la colisión de PK: un `23505` llegaría al cliente como 500.
4. Resolución de las tres FK que lleguen con valor.
5. Regla de la fuente «otra».
6. Normaliza con `.trim()` los tres textos libres. No hay `code` ni `name`: no aplican `toConstantCase` ni `toTitleCase`.
7. Inserta con la entrada de auditoría `method: 'ESAVI-NSEVNOT-001'`.

El `deletedAt` nace en `null`. Como la notificación tiene que estar activa para llegar aquí, no hay forma de crear un detalle ya arrastrado.

**`ESAVI-NSEVNOT-003` — obtener por ID.** `findByPk` con el include obligatorio de `notification` y los tres includes de vacunación. Dos filtros:

- La fila existe → si no, 404 `NSEVNOT_003_NOT_FOUND`.
- Su notificación está activa, **salvo** que `canViewInactive(req.user)` sea verdadero → si no, el mismo 404 `NSEVNOT_003_NOT_FOUND`, sin distinguir.

**Los tres includes de vacunación no filtran por `isActive`.** Un establecimiento desactivado después del registro se sigue devolviendo: la fila es histórica. Si se filtraran, la respuesta perdería el objeto y el cliente vería un `null` donde hay un dato guardado.

El `deletedAt` propio **no filtra nada**: una fila arrastrada sigue siendo visible para quien puede ver su cabecera. Es lo que permite consultarla antes de purgarla.

**`ESAVI-NSEVNOT-006` — obtener por caso.** Se parte de `NonSevereNotification` con `include` de `notification` filtrado por `caseId`, misma forma completa y misma regla de `canViewInactive`. Tres 404 distintos:

- El caso no existe → 404 `NSEVNOT_006_CASE_NOT_FOUND`.
- El caso existe y no tiene notificación visible → 404 `NSEVNOT_006_NOTIFICATION_NOT_FOUND`.
- La notificación existe y no tiene detalle no grave → 404 `NSEVNOT_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena `caso → notificación → detalle` es uno a uno en los dos saltos.

**`ESAVI-NSEVNOT-004` — actualizar.** En este orden:

1. Existencia y visibilidad heredada, igual que el `003` → 404 `NSEVNOT_004_NOT_FOUND`.
2. `notificationId` **se ignora siempre**.
3. Normaliza con `.trim()` los tres textos que lleguen.
4. Construye `candidates` según la tabla de abajo.
5. **Resuelve solo las FK que cambian** — ver el bloque siguiente.
6. Regla de la fuente «otra» sobre el **estado resultante**.
7. Update diferencial. Si el diff vuelve vacío, se devuelve la fila **sin escribir nada**.
8. Escribe `updatedAt` explícitamente. No hay trigger que lo haga.
9. Preserva el historial con `[...currentAppDetails, newEntry]`.

**Contrato de update diferencial** (§11 del canon, SPEC F12). `stored` sale de `nonSevereNotification.get({ plain: true })` —la fila completa, sin `attributes` acotados—, el diff lo construye `buildDifferentialUpdate` y, si vuelve vacío, no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `vaccinationHealthFacilityId` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. **Se resuelve solo si difiere de `stored`** |
| `vaccinationSiteItemId` | ídem | anulable. **Se resuelve solo si difiere de `stored`** |
| `vaccinationGeoLocationId` | ídem | anulable. **Se resuelve solo si difiere de `stored`** |
| `vaccinationCenterAddress` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, normalizado antes de comparar |
| `verifiedPhysicalDocument` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable, tri-estado |
| `verifiedElectronicRecord` | ídem | anulable, tri-estado |
| `verifiedVerbalReport` | ídem | anulable, tri-estado |
| `verifiedClinicalRecord` | ídem | anulable, tri-estado |
| `verifiedUnknown` | ídem | anulable, tri-estado |
| `verifiedOtherSource` | ídem | anulable, tri-estado |
| `otherSourceDescription` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, normalizado antes de comparar |
| `notes` | ídem | anulable, normalizado antes de comparar |
| `notificationId` | **no entra** | inmutable, se ignora sin error |

Los doce se comparan contra `undefined` y **nunca por veracidad**: un `if( data.x )` descartaría la cadena vacía e impediría anular una FK o un tri-estado. Aquí importa doblemente, porque `null` y `false` son datos distintos y **desasociar un establecimiento es una edición legítima**. **Ningún campo cifrado y ningún derivado.**

**La resolución de FK va gobernada por el diff, y es una desviación declarada del orden habitual.** El canon pide validar FK y unicidad **antes** del diff; aquí se hace **después de construir `candidates` y solo para las claves cuyo valor cambia**:

```
resolver si:  candidates.x !== undefined  &&  candidates.x !== null  &&  candidates.x !== stored.x
```

La razón es la del rasgo §1-B: un `PUT` que reenvía íntegro el `GET` no debe fallar porque un establecimiento se desactivó después del registro. La fila es histórica y su FK no es un puntero vigente. La consecuencia, asumida: **un `PUT` que apunta a una FK inactiva devuelve 404 solo si está cambiándola**; si la reenvía igual, devuelve 200 sin tocar nada. Es una excepción al criterio general y por eso está escrita aquí, en §5 y en §6.

**Escrituras que no son diferenciales**, y por qué. Las tres registran un hecho aunque ningún campo de datos cambie:

- **El arrastre** de `ESAVI-NOTIFCN-005A` y `ESAVI-CASE-005A`: sella `deletedAt` y añade auditoría.
- **La limpieza** de `ESAVI-NOTIFCN-005B`: devuelve `deletedAt` a `null` y añade auditoría.
- **`ESAVI-NSEVNOT-005C`**: destruye la fila.

**El arrastre desde la cabecera.** Mecánica idéntica a la del F13, sobre los mismos dos puntos y **junto a** la función que aquél dejó escrita:

- `ESAVI-NOTIFCN-005A`, en `src/services/notification.service.ts`, dentro de la transacción ya abierta.
- `ESAVI-CASE-005A`, en el bloque de `src/services/esaviCase.service.ts:357-381`, porque el `Notification.update` masivo de allí no pasa por el servicio de `notification`.

En los dos casos, y **solo cuando `isActive === false`**, se sella `deletedAt` y `updatedAt` sobre el detalle cuyo `deletedAt` sea `null`, con entrada de `appDetails` cuyo `method` es el **código de la operación que lo arrastró** —`'ESAVI-NOTIFCN-005A'` o `'ESAVI-CASE-005A'`, nunca `'ESAVI-NSEVNOT-*'`—. Un detalle ya sellado **no se vuelve a sellar** y conserva su fecha original.

**Una notificación tiene como mucho una de las dos ramas**, porque `notificationType` es único por fila. El arrastre intenta las dos y una de ellas siempre encuentra cero filas; eso no es un error ni merece log.

**La limpieza desde `ESAVI-NOTIFCN-005B`** devuelve `deletedAt` a `null` con entrada `method: 'ESAVI-NOTIFCN-005B'`. Es la misma cascada de subida que el F13 razonó como excepción al F07, y se hereda con su misma condición habilitante: una entidad **sin forma de retirarse por su cuenta**. `ESAVI-CASE-005B` no limpia nada.

**`ESAVI-NSEVNOT-005C` — purgar.** `purgeNonSevereNotificationService(id, authUser, lang)` sobre `purgeEntityService`, con transacción. Con la guarda compartida **antes** de delegar:

- Existencia → 404 `NSEVNOT_005C_NOT_FOUND`.
- `deletedAt` **no** puede ser `null` → si lo es, **409** `NSEVNOT_005C_NOT_DELETED`.

La comprobación se extrae al helper compartido `assertRowIsSealed(row, code, lang)` en `src/helpers/`, que este servicio y el de `severeNotification` invocan. `purgeEntityService` no se toca. Responde `{ ok, message }` sin `data`.

**Las tres FK `ON DELETE RESTRICT` no estorban aquí**: apuntan hacia fuera, así que purgar este detalle no las viola. Lo que sí impiden es purgar un `healthFacility`, un `catalogItem` o un `geoLocation` referenciado — comportamiento del esquema que este spec no cambia y que las entidades afectadas verán como un error de base, no como un 409 propio.

**Validaciones de forma** (las emite `validateFields` con 400): `notificationId` obligatorio y `.isUUID()` en create; las tres FK con `.isUUID()` cuando lleguen con valor; los seis campos de verificación con `.isBoolean()`; `vaccinationCenterAddress` como cadena de **250 caracteres máximo**; `otherSourceDescription` y `notes` como cadena. `param('id')` y `param('caseId')` con `.isUUID()`.

### 3.6 Claves i18n nuevas

Bloque `nonSevereNotification` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005C` y `006` |
| `idRequired` | parámetro ausente |
| `notificationNotFound` | 404 cuando la notificación no existe o está inactiva, en `001` y en `006` |
| `notificationNotNonSevere` | 409 cuando el `notificationType` no es `NON_SEVERE`. Lleva `{{notificationId}}` |
| `alreadyExists` | 409 cuando la notificación ya tiene detalle no grave. Lleva `{{notificationId}}` |
| `caseNotFound` | 404 cuando el `caseId` no existe, en `006` |
| `healthFacilityNotFound` | 404 cuando `vaccinationHealthFacilityId` no existe o está inactivo |
| `vaccinationSiteNotFound` | 404 cuando el item no existe, está inactivo o no es del catálogo `vaccinationSite` |
| `geoLocationNotFound` | 404 cuando la ubicación no existe, está inactiva o no es del nivel más profundo |
| `otherSourceDescriptionRequired` | 400 cuando `verifiedOtherSource` es `YES` y falta la descripción |
| `otherSourceDescriptionNotAllowed` | 400 cuando no es `YES` y la descripción llega |
| `notDeleted` | 409 al purgar un detalle que no fue arrastrado. Lleva `{{id}}` |

Veinte claves. **No hay `getSuccessPlural` ni `getFailedPlural`** —no hay listados— ni **`alreadyActive` / `alreadyInactive`** —no hay `005A` ni `005B`—, las mismas tres ausencias del F13. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

No se añade ninguna clave a los bloques `notification` ni `esaviCase`: el arrastre no produce mensajes propios.

### 3.7 Forma de la respuesta

Una sola forma, porque no hay listados. `001`, `003`, `004` y `006`:

```
{ ok, message, data: {
    notificationId,
    vaccinationCenterAddress,
    verifiedPhysicalDocument, verifiedElectronicRecord, verifiedVerbalReport,
    verifiedClinicalRecord, verifiedUnknown, verifiedOtherSource,
    otherSourceDescription, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    vaccinationHealthFacility: { healthFacilityId, name, localCode },
    vaccinationSite:           { catalogItemId, code, name },
    vaccinationGeoLocation:    { geoLocationId, name, level },
    notification: {
        notificationId, notificationType, esaviDescription, isActive,
        case: { caseId, caseCode, eventDate }
    }
} }
```

`005C` responde `{ ok, message }` sin `data`.

Cinco precisiones:

- **Los tres UUID crudos no viajan.** `vaccinationHealthFacilityId`, `vaccinationSiteItemId` y `vaccinationGeoLocationId` se excluyen y en su lugar van los objetos resueltos, con el `DETAIL_EXCLUDE` que `notification.service.ts:38` estrenó para `outcomeItemId`. El cliente que quiera el UUID lo lee dentro del objeto.
- **Una FK no informada se devuelve como `null` explícito**, nunca se omite la clave. Un cliente que itera las tres no debe distinguir entre «vacío» y «ausente».
- **`deletedAt` sí viaja, y es el único indicador de estado que tiene la fila.** No hay `isActive` que devolver.
- **`notification.isActive` viaja a propósito**: es lo que gobierna la visibilidad del detalle.
- Los seis campos tri-estado se devuelven **tal como están**, `null` incluido. **`sysDetails` nunca se devuelve**, ni el propio ni el de la notificación incluida.

---

## 4. Plan de implementación

**Precondiciones.** Cuatro, antes del paso 1:

- El **SPEC F13 debe estar `Implementado`**. Es dependencia dura: aporta `src/constants/enums.constants.ts`, el patrón de arrastre en los dos servicios ajenos y la guarda de purga que el paso 4 extrae. Empezar antes obliga a escribir aquí piezas que son de aquel spec.
- El **SPEC F10** implementado —lo está—, por la PK compartida.
- El **SPEC F06** implementado —lo está—, porque el paso 11 modifica `esaviCase.service.ts` y el `006` entra por `caseId`.
- **Datos sembrados:** el `catalogType` de código `vaccinationSite` con sus items activos, y un árbol geográfico con al menos un nivel por debajo de la raíz. Se cargan por los endpoints ya existentes de catálogos y geografía. **Son precondición, no parte de la implementación.**

Los fixtures de las suites necesitan además una notificación con `notificationType: 'NON_SEVERE'`, que se crea por la API.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Modelo, asociaciones y tipos.** `src/models/nonSevereNotification.model.ts` con la PK `notificationId` **sin `defaultValue`**, los seis `DataTypes.BOOLEAN` anulables, `vaccinationCenterAddress` como `STRING(250)`, los dos `TEXT`, las tres `UUID` y **ningún atributo `isActive`**; `src/models/associations/nonSevereNotification.associations.ts` con las cinco asociaciones de §3.2 y **sin ningún inverso** desde `healthFacility`, `catalogItem` ni `geoLocation`, registrado en `initModels()`; `src/types/nonSevereNotification/nonSevereNotification.types.ts` con `CreateNonSevereNotificationInput` y su `index.ts`. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `NonSevereNotification.findOne({ include: ['notification', 'vaccinationHealthFacility', 'vaccinationSite', 'vaccinationGeoLocation'] })` desde un script suelto devuelve sin error de asociación; un `create` con `verifiedUnknown: 'MAYBE'` falla en Sequelize **antes** de llegar a Postgres; `grep -rn "'NOT_APPLICABLE'" src/` sigue devolviendo **una sola** definición; `npm test` sigue en verde, porque el `hasOne` nuevo no entra en ninguna respuesta de `notification`.

2. **Claves i18n.** Las veinte de §3.6 en `es.json`, `en.json` y `nl.json`, **sin** `getSuccessPlural`, `getFailedPlural`, `alreadyActive` ni `alreadyInactive`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

3. **Validadores.** `src/validators/nonSevereNotification.validator.ts` con cuatro arrays: `nonSevereNotificationIdValidator`, `nonSevereNotificationCaseIdValidator`, `createNonSevereNotificationValidator` y `updateNonSevereNotificationValidator`. Los dos de cuerpo con `.isBoolean()` en los seis campos de verificación, `.isUUID()` en las tres FK y el límite de 250 en `vaccinationCenterAddress`. **Ningún validador de listado.** Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

4. **Extraer la guarda de purga a un helper compartido.** `assertRowIsSealed(row, code, lang)` en `src/helpers/`, registrado en el barrel, que lanza 409 cuando `deletedAt` es `null`. **Repuntar `src/services/severeNotification.service.ts` para que lo use**, retirando su copia. Sin ningún cambio de comportamiento y sin tocar `purgeEntityService`. Va antes de que exista el segundo consumidor, para que la refactorización se verifique contra una suite ya en verde.
   *Verificación:* `npm run build` en 0; `npm test -- severeNotification` pasa **sin tocar ni un caso**, incluido el de purgar sin arrastre previo que devuelve 409; `src/services/common/entityPurge.service.ts` no tiene ni una línea modificada.

5. **`ESAVI-NSEVNOT-001` — crear.** `createNonSevereNotificationService` con los siete pasos de §3.5 en ese orden, incluidas las tres resoluciones de FK y `VACCINATION_SITE_CATALOG_CODE` como constante de módulo. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un alta mínima —solo `notificationId`— devuelve 201 con los seis tri-estado y las tres FK en `null`, y `deletedAt` en `null`; repetirla devuelve **409** `NSEVNOT_001_ALREADY_EXISTS`; sobre una notificación `SEVERE` devuelve **409** `NSEVNOT_001_NOTIFICATION_NOT_NON_SEVERE`; sobre una notificación inactiva o inexistente, **404**; un `vaccinationHealthFacilityId` inactivo devuelve **404**; un `vaccinationSiteItemId` de otro `catalogType` devuelve **404**; un `vaccinationGeoLocationId` de un nivel que no es el máximo devuelve **404**, y el del nivel máximo devuelve **201**; `verifiedOtherSource: true` sin descripción devuelve **400**, y `false` con descripción también; la suite no produce ningún error `23505`.

6. **`ESAVI-NSEVNOT-003` — obtener por ID.** `getNonSevereNotificationByIdService(id, lang, includeInactive)` con los cuatro includes y la forma completa de §3.7, los tres UUID crudos excluidos vía `DETAIL_EXCLUDE`; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; un detalle cuya notificación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN, con el mismo código en los dos 404; un detalle con `deletedAt` sellado y cabecera activa devuelve **200**; **un detalle cuyo establecimiento se desactivó después sigue devolviendo el objeto `vaccinationHealthFacility` completo**, no `null`; las FK no informadas llegan como `null` explícito; `vaccinationHealthFacilityId` **no** aparece como campo suelto; `sysDetails` no aparece en ningún nivel.

7. **`ESAVI-NSEVNOT-006` — obtener por caso.** `getNonSevereNotificationByCaseIdService(caseId, lang, includeInactive)` con los tres 404 distintos, devolviendo **el objeto**. Ruta `GET /case/:caseId` en USER, declarada antes de `/:id`. Fila `nonSevereNotification` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con la cadena completa devuelve 200 con la ficha, no envuelta en un array; los tres 404 —`CASE_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `NOT_FOUND`— son distintos entre sí; un caso cuya notificación es `SEVERE` cae en el tercero; `GET /case/no-es-uuid` devuelve 400.

8. **`ESAVI-NSEVNOT-004` — actualizar.** `updateNonSevereNotificationService` con los nueve pasos de §3.5: visibilidad heredada, `notificationId` ignorado, `.trim()`, `candidates` con los doce campos de la tabla, **resolución de FK solo para las que cambian**, regla de la fuente «otra» sobre el estado resultante, `buildDifferentialUpdate`, corte por diff vacío, `updatedAt` a mano y `[...currentAppDetails, newEntry]`. Ruta `PUT /:id` en USER.
   *Verificación:* enviar `notificationId` distinto no lo modifica y devuelve 200; **reenviar el mismo `vaccinationHealthFacilityId` de un establecimiento que se desactivó entretanto devuelve 200 y no consulta la base**, mientras que cambiarlo a otro inactivo devuelve **404**; desasociar una FK enviándola en `null` devuelve 200 y la escribe; mover `verifiedOtherSource` de `true` a `false` sin limpiar la descripción devuelve **400**, y enviándola en `null` devuelve **200**; `verifiedUnknown: null` sobre una fila que valía `false` **sí** escribe, y al revés también; un `PUT` que reenvía íntegra la respuesta del `GET` devuelve 200 y **no** añade entrada a `appDetails` ni avanza `sysDetails.version`; un `PUT` con body vacío se comporta igual; un `PUT` que cambia un solo campo añade **una** entrada y avanza la versión en 1.

9. **`ESAVI-NSEVNOT-005C` — purgar.** `purgeNonSevereNotificationService` con `assertRowIsSealed` del paso 4 antes de delegar en `purgeEntityService`, con transacción. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, declarada junto a las literales.
   *Verificación:* purgar un detalle con `deletedAt` en `null` devuelve **409** `NSEVNOT_005C_NOT_DELETED` y la fila sigue ahí; arrastrarlo desactivando su notificación y purgarlo entonces devuelve 200 sin `data`, y `findByPk` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; el log recoge el volcado en `warn`; **la notificación, el establecimiento, el item de catálogo y la ubicación a los que apuntaba siguen existiendo e intactos**.

10. **El arrastre y la limpieza desde `notification`.** En `src/services/notification.service.ts`, **junto a** la función que el F13 dejó para el detalle grave y dentro de la misma transacción: cuando `isActive === false`, sellar `deletedAt` y `updatedAt` del detalle no grave cuyo `deletedAt` sea `null` y añadirle entrada con `method: 'ESAVI-NOTIFCN-005A'`; cuando `isActive === true`, devolver `deletedAt` a `null` con `method: 'ESAVI-NOTIFCN-005B'`.
    *Verificación:* desactivar una notificación `NON_SEVERE` con detalle le sella el `deletedAt` y le añade la entrada; reactivarla lo devuelve a `null` y añade la segunda, con el historial anterior intacto; **una notificación `SEVERE` sigue arrastrando solo su detalle grave y la rama no grave encuentra cero filas sin error ni log**; una notificación sin detalle responde 200; un detalle ya sellado conserva su fecha original y no recibe entrada nueva; `npm test -- notification` y `npm test -- severeNotification` en verde con los casos existentes sin tocar.

11. **El arrastre desde `esaviCase`.** En el bloque de `src/services/esaviCase.service.ts:357-381`, junto a la función hermana del F13, recorrer la cadena `caso → notificación → detalle no grave` con el mismo sellado y `method: 'ESAVI-CASE-005A'`. Solo cuando `isActive === false`. Va después del paso 10 para que el comportamiento esté probado por un camino antes de abrir el segundo.
    *Verificación:* desactivar un caso deja el detalle con `deletedAt` sellado y entrada `ESAVI-CASE-005A`, y su notificación inactiva en la misma transacción; reactivar el caso **no** limpia nada; desactivar un caso sin notificación, o con notificación sin detalle, responde 200; desactivar un caso ya inactivo devuelve 409 y **nada** cambia de estado; `npm test -- esaviCase` en verde con los casos del F13 intactos.

12. **Volcado al log de la fila que arrastra `ESAVI-NOTIFCN-005C`.** Junto al que el F13 añadió: antes del `destroy` de la notificación, si tiene detalle no grave, volcarlo a `esaviLog` en nivel `warn` con el mismo formato de `purgeEntityService`. No bloquea la purga.
    *Verificación:* purgar una notificación `NON_SEVERE` con detalle deja **dos** volcados —el de la notificación y el del detalle—; purgar una `SEVERE` con detalle deja también dos, no tres; purgar una sin detalle deja uno; después, `NonSevereNotification.findByPk` devuelve `null` sin que ninguna operación de esta entidad lo haya borrado.

13. **Registrar la entidad en las convenciones.** Fila `nonSevereNotification` → **`NSEVNOT`** en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `nonSevereNotification` · `006` · «obtener el detalle no grave de un caso» en la de operaciones no canónicas.
    *Verificación:* `NSEVNOT` aparece una sola vez y no colisiona con las diecisiete existentes; **no es prefijo de ninguna ni ninguna es prefijo suyo** —en particular convive con `SEVNOT`, `NOTIFCN` y `NOTIFIER`—; `grep -rn "ESAVI-SEVNOT-" src/` sigue devolviendo solo las operaciones del F13.

14. **Cubrir las cinco rutas en `tests/auth/roles.test.ts`.** Cinco filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **113 a 118**.
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/nonSevereNotification.test.ts`.** Recorrido completo: crear → obtener por ID → obtener por caso → actualizar → arrastrar desactivando la notificación → purgar. Más los caminos de error: notificación inexistente (404), inactiva (404), `SEVERE` (409), detalle duplicado (409), una fuente de verificación que no es boolean (400), dirección de más de 250 caracteres (400), fuente «otra» sin descripción (400), descripción sin fuente «otra» (400), las tres FK inválidas (404 cada una con su código), purga sin arrastre previo (409). Y las cuatro reglas propias: `notificationId` inmutable, la regla de la fuente «otra» sobre el estado resultante, el caso homogéneo de update diferencial, y **el caso histórico** — reenviar una FK cuyo destino se desactivó devuelve 200, cambiarla a un destino inactivo devuelve 404.
    *Verificación:* `npm test -- nonSevereNotification` en verde.

16. **Ampliar `tests/contract/notification.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera: el arrastre de `005A` y la limpieza de `005B` sobre la rama no grave, el detalle ya sellado que no se re-sella, el doble volcado de `005C`, y que una notificación `SEVERE` no toca la rama no grave. En la segunda: el arrastre transitivo desde `ESAVI-CASE-005A` y que `005B` no lo deshace. Ninguna de las dos suites pierde casos, incluidos los que el F13 añadió.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las cinco rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en `001`, `003`, `004` y `006`. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-NSEVNOT-002" src/` no devuelve resultados: la entidad no tiene listados.
- [ ] `grep -rn "ESAVI-NSEVNOT-005[AB]" src/` no devuelve resultados: no tiene activación ni desactivación.
- [ ] `grep -rn "ESAVI-NSEVNOT-00[789]" src/` no devuelve resultados: la única no canónica es `006`.
- [ ] `NSEVNOT` está en la tabla de abreviaturas de §6 del canon, y la fila `nonSevereNotification` · `006` en la de operaciones no canónicas.
- [ ] Ningún código `ESAVI-SEVNOT-*` cambia ni desaparece: `grep -rn "ESAVI-SEVNOT-" src/` sigue devolviendo exactamente las operaciones del F13.
- [ ] Existen los siete artefactos y `src/types/nonSevereNotification/index.ts` está presente.
- [ ] Las rutas literales no responden 400 por validación de UUID: se declaran antes de `/:id`.
- [ ] `Notification.hasOne(NonSevereNotification)` está declarado, y el detalle **no** aparece en ninguna respuesta de `/api/notifications`.
- [ ] `healthFacility`, `catalogItem` y `geoLocation` no declaran ningún inverso hacia esta entidad, y sus respuestas no cambian.
- [ ] `esaviapp.sql` no tiene ni una línea modificada.

**La tabla sin `isActive`**

- [ ] `grep -n "isActive" src/models/nonSevereNotification.model.ts` no devuelve resultados.
- [ ] `CreateNonSevereNotificationInput` no declara `isActive`.
- [ ] Ninguna respuesta de la entidad incluye un campo `isActive` propio; sí incluye `notification.isActive`.
- [ ] `grep -rn "setEntityActiveStatusService" src/services/nonSevereNotification.service.ts` no devuelve resultados.
- [ ] `src/services/common/entityActivation.service.ts` y `src/services/common/entityPurge.service.ts` no tienen ni una línea modificada.

**Los seis boolean**

- [ ] `grep -rn "ANSWER_OPTIONS" src/models/nonSevereNotification.model.ts src/validators/nonSevereNotification.validator.ts src/types/nonSevereNotification/` no devuelve resultados: esta entidad no consume el ENUM compartido.
- [ ] `grep -rn "'NOT_APPLICABLE'" src/` sigue devolviendo **una sola** definición, la de `enums.constants.ts`, intacta para las entidades que sí la usan.
- [ ] `POST` con `verifiedUnknown: 'MAYBE'` devuelve **400** con el envoltorio de `validateFields`, nunca 500.

**Alta y uno a uno**

- [ ] `POST` con solo `notificationId` devuelve **201**, con los seis tri-estado y las tres FK en `null` y `deletedAt` en `null`.
- [ ] `POST` sobre una notificación que ya tiene detalle devuelve **409** `alreadyExists`, con el `notificationId` interpolado.
- [ ] `POST` sobre una notificación `SEVERE` devuelve **409** `notificationNotNonSevere`, no 400.
- [ ] `POST` sobre una notificación inactiva o inexistente devuelve **404**.
- [ ] Ningún `INSERT` llega a Postgres con la PK ocupada: la suite no produce ningún error `23505`.
- [ ] `PUT /:id` con un `notificationId` distinto en el body deja la fila donde estaba y devuelve **200**.

**Las tres claves foráneas**

- [ ] `vaccinationHealthFacilityId` inexistente o inactivo → **404** `healthFacilityNotFound`.
- [ ] `vaccinationSiteItemId` inexistente, inactivo o de un `catalogType` distinto de `vaccinationSite` → **404** `vaccinationSiteNotFound`.
- [ ] `vaccinationGeoLocationId` de un nivel que **no** es el máximo → **404** `geoLocationNotFound`; del nivel máximo → **201**.
- [ ] Los tres 404 llevan tres códigos de `AppError` distintos entre sí y distintos del `notFound` de la entidad.
- [ ] Sembrar un nivel geográfico más profundo cambia el comportamiento **sin reiniciar el proceso**: la ubicación que antes pasaba ahora devuelve 404, y la nueva pasa.
- [ ] Las tres FK enviadas en `null` se aceptan y se escriben sin consultar la base.
- [ ] `vaccinationCenterAddress` de más de 250 caracteres devuelve **400** del validador, nunca un error de Postgres.

**El criterio histórico**

- [ ] Un `GET` de una fila cuyo establecimiento se desactivó después devuelve el objeto `vaccinationHealthFacility` **completo**, no `null`.
- [ ] Un `PUT` que **reenvía** ese mismo `vaccinationHealthFacilityId` devuelve **200** y no escribe nada.
- [ ] Un `PUT` que **cambia** esa FK a otro establecimiento inactivo devuelve **404**.
- [ ] Un `PUT` que la envía en `null` devuelve **200** y la desasocia.

**Regla de la fuente «otra»**

- [ ] `verifiedOtherSource: true` sin descripción → **400** `otherSourceDescriptionRequired`.
- [ ] `verifiedOtherSource: true` con descripción en blanco tras `.trim()` → **400**.
- [ ] Cualquier otro valor, o `null`, con descripción en el body → **400** `otherSourceDescriptionNotAllowed`.
- [ ] Un `PUT` que mueve `verifiedOtherSource` de `true` a `false` **sin** limpiar la descripción → **400**; el mismo `PUT` enviándola en `null` → **200**.
- [ ] Un `PUT` que solo toca `notes` sobre una fila con `true` y descripción guardada → **200**.
- [ ] Las seis fuentes son independientes: `verifiedPhysicalDocument: true` y `verifiedUnknown: true` a la vez → **201**, sin error.
- [ ] Un alta con las seis en `null` → **201**.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/nonSevereNotification.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** *cuando la está cambiando*, y **200** cuando la reenvía igual — la desviación declarada en §3.5 y §6. El segundo supuesto del criterio canónico, el `code` ya ocupado, **no aplica**: no hay ningún campo `code` ni ninguna `UNIQUE` en esta tabla.
- [ ] `verifiedUnknown: null` sobre una fila que valía `false` **sí** escribe, y el camino inverso también.

**Tri-estado**

- [ ] Los seis campos no informados llegan como `null` en todas las respuestas, nunca como `false`.
- [ ] `false` se guarda y se devuelve como `false`, distinguible de `null`.

**Visibilidad heredada**

- [ ] `GET /:id` de un detalle cuya notificación está inactiva devuelve **404** para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] Ese 404 lleva el mismo código que el de una fila inexistente: la causa no se distingue.
- [ ] Un detalle con `deletedAt` sellado y cabecera **activa** devuelve **200**.
- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`.
- [ ] Los tres 404 del `006` llevan tres códigos distintos, y un caso cuya notificación es `SEVERE` cae en el tercero.

**Forma de la respuesta**

- [ ] `vaccinationHealthFacilityId`, `vaccinationSiteItemId` y `vaccinationGeoLocationId` **no** viajan como campos sueltos: van resueltos en sus tres objetos.
- [ ] Una FK no informada devuelve `null` explícito, con la clave presente.
- [ ] `sysDetails` no aparece en ningún nivel de ninguna respuesta.

**Arrastre y limpieza**

- [ ] Desactivar la notificación con `ESAVI-NOTIFCN-005A` sella el `deletedAt` del detalle y le añade entrada con `method: 'ESAVI-NOTIFCN-005A'`.
- [ ] Reactivarla con `005B` devuelve `deletedAt` a `null` y añade entrada con `method: 'ESAVI-NOTIFCN-005B'`, con el historial anterior intacto.
- [ ] Un detalle que **ya** tenía `deletedAt` sellado conserva su fecha original y no recibe entrada nueva.
- [ ] Desactivar el caso con `ESAVI-CASE-005A` sella el detalle con `method: 'ESAVI-CASE-005A'`, en la misma transacción; `ESAVI-CASE-005B` **no** lo deshace.
- [ ] Ninguna entrada de `appDetails` del detalle lleva un `method` de la forma `ESAVI-NSEVNOT-005*`.
- [ ] Desactivar una notificación **`SEVERE`** no toca ninguna fila de `nonSevereNotification`, y no deja error ni entrada de log.
- [ ] Desactivar un caso o una notificación **sin** detalle responde 200 y no falla.

**Purga**

- [ ] `DELETE /purge/:id` sobre un detalle con `deletedAt` en `null` devuelve **409** `notDeleted` y la fila sigue existiendo.
- [ ] Tras arrastrarlo, la misma llamada devuelve **200** sin `data` y `findByPk` devuelve `null`.
- [ ] Repetirla devuelve **404**; un ADMIN recibe **403**.
- [ ] La notificación, el establecimiento, el item de catálogo y la ubicación referenciados siguen existiendo e intactos.
- [ ] `assertRowIsSealed` existe en `src/helpers/`, está en el barrel y lo usan **los dos** servicios de satélite; ninguno conserva su copia.
- [ ] Purgar la **notificación** con `ESAVI-NOTIFCN-005C` deja **dos** volcados en `esaviLog` en nivel `warn` —nunca tres— y destruye las dos filas.

**Cierre**

- [ ] Las veinte claves nuevas existen en `es`, `en` y `nl`, y el bloque **no** contiene `getSuccessPlural`, `getFailedPlural`, `alreadyActive` ni `alreadyInactive`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene **118** filas y `npm test -- roles` pasa.
- [ ] `npm test -- severeNotification`, `npm test -- notification` y `npm test -- esaviCase` pasan sin haber perdido ningún caso.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la abreviatura**

- **Sí:** `NSEVNOT`, siete letras, reservada de palabra por el F13 §6 y ahora registrada. Mantiene el par `SEVNOT`/`NSEVNOT`, que es exactamente para lo que aquél eligió seis letras en vez de ocho.
- **No:** `NONSEVNOT`, nueve letras: se pasa del límite de §6. **No:** `NSEVERE`, que pierde el «notification» y deja de leerse como pareja de la otra.
- **Consecuencia asumida:** `SEVNOT` es subcadena de `NSEVNOT`. Un `grep` sobre `ESAVI-SEVNOT-` no las confunde —el guion inicial las separa—, pero uno sobre `SEVNOT` sí. Está recogido como verificación del paso 13.

**Sobre la dependencia con el F13**

- **Sí:** dependencia **dura de implementación**. Este spec no se empieza hasta que `severeNotification` esté `Implementado`.
- **No:** dependencia blanda, con la mudanza de `ANSWER_OPTIONS` declarada como precondición idempotente. Habría permitido implementar los dos en cualquier orden, pero deja este spec conteniendo instrucciones que son de otro —«si `enums.constants.ts` no existe, créalo»—, y dos specs que pueden crear el mismo archivo acaban creándolo dos veces con contenidos parecidos.
- **Consecuencia asumida:** este spec queda bloqueado por el otro, incluido su conteo de `ROUTE_RULES`, que parte de 113 y no de 108.

**Sobre el nivel geográfico — la decisión propia de este spec**

- **Sí:** `vaccinationGeoLocationId` acotado al **nivel más profundo sembrado**, calculado como `GeoLocation.max('level')` sobre ubicaciones activas, en cada operación que lo necesite.
- **No:** anclarlo a un `geoLevelType.code` literal como `'parish'`. Es lo que hizo el F10 con `outcome` y lo que se propuso primero aquí, y se descartó por una razón que lo cierra: **los códigos geográficos cambian de un país a otro** —`parish`, `parroquia`, `ward`—, y anclar el filtro a uno condena el despliegue al primer país modelado. `level` es numérico y lo deriva la aplicación, así que no depende de la nomenclatura local.
- **No:** usar `geoLevelType.sortOrder` en lugar de `geoLocation.level`. Habría funcionado, pero exige un `include` extra en cada validación para llegar al tipo desde la ubicación, y `sortOrder` es un campo de presentación que alguien puede reordenar sin pensar en esto.
- **No:** el máximo **acotado a la rama** del propio registro, en vez de global. Es más justo con árboles desiguales, pero exige recorrer los ancestros de una ubicación **antes** de saber si esa ubicación es válida, que es circular; y convierte un 404 en algo que depende de por dónde se entre.
- **No:** sin restricción de nivel, como hace `healthFacility`. Habría sido el precedente, pero permite registrar «se vacunó en Ecuador» junto a «se vacunó en la parroquia X» en la misma columna, y ninguna consulta posterior puede tratar las dos igual.
- **Consecuencia asumida y anotada en §7:** el máximo es global, así que si una sola rama del árbol baja un nivel más que las demás, el resto del país se queda sin poder informar su lugar de vacunación.

**Sobre las FK y el update diferencial**

- **Sí:** revalidar una FK **solo cuando su valor cambia**. Es el criterio del F12 —lo que dispara el trabajo es el cambio— aplicado a la validación y no solo a la escritura, y es lo que hace que un `PUT` que reenvía el `GET` siga siendo inocuo aunque el mundo alrededor se haya movido.
- **No:** revalidar siempre que la clave llegue en el body. Más estricto y más simple de escribir, pero convierte cualquier `PUT` completo en un 404 en cuanto un establecimiento se desactive, dejando la fila **incapaz de editar sus propias `notes`** hasta que alguien reactive algo ajeno.
- **Sí, y es la razón de fondo:** estas tres FK son **registro histórico**, no punteros vigentes. Dicen dónde se vacunó, y eso no deja de ser cierto porque el establecimiento cierre.
- **Sí, en coherencia:** los includes de lectura **no filtran por `isActive`**. Si lo hicieran, la respuesta devolvería `null` donde hay un dato guardado, y el `PUT` que lo reenviara escribiría una desasociación que nadie pidió.
- **Es una desviación declarada** del orden que pide el canon —FK antes del diff—, y por eso aparece tres veces: en §3.5 con la condición literal, en §5 como matiz del cuarto criterio del bloque diferencial, y aquí con su razón.

**Sobre la guarda de purga**

- **Sí:** extraerla a `assertRowIsSealed` en `src/helpers/`, usado por los dos servicios de satélite. Es la respuesta a la condición que el F13 §6 dejó escrita —«si la segunda satélite necesita lo mismo, ése es el momento de generalizarlo, con dos casos a la vista y no con uno imaginado»—, y el segundo caso ya está aquí.
- **No:** añadir un predicado opcional a `purgeEntityService`. Deja el criterio en un solo sitio para las seis satélites que faltan, pero modifica un servicio común del que dependen `notifier`, `classification`, `appUserGeoLocation`, `notification` y `severeNotification`, para resolver algo que un helper resuelve sin tocarlo.
- **No:** duplicar la guarda, como hizo el F13 cuando era el único caso. Con ocho satélites serían ocho copias de la misma condición.
- **Consecuencia asumida:** el paso 4 modifica `severeNotification.service.ts`, un archivo de otro spec. Va en su propio commit y se verifica contra la suite de aquél sin tocarla.

**Sobre las tres columnas de lugar**

- **Sí:** las tres opcionales e independientes, sin ninguna regla de coherencia entre ellas.
- **No:** exigir al menos una. La vacunación pudo registrarse sin ningún dato de lugar y completarse después con el `PUT`; exigirlo rompe el alta mínima, que es la vía normal en las dos satélites.
- **No:** hacerlas excluyentes —o establecimiento, o dirección más ubicación—, ni forzar que `vaccinationGeoLocationId` coincida con el `geoLocationId` del establecimiento. Las dos reglas son plausibles y ninguna está confirmada por el funcional; escribirlas hoy es adivinar. **Queda anotado que es previsible que el funcional acabe pidiendo solo una de las tres**, y ése es un spec de ampliación con la regla escrita.

**Sobre las reglas de negocio**

- **Sí:** regla estricta de la fuente «otra» en las dos direcciones, evaluada sobre el **estado resultante** en el `004`. Es la tercera vez que el repositorio resuelve el mismo problema —fallecimiento en el F10, embarazo en el F13, fuente «otra» aquí— y las tres lo resuelven igual. Ésa es la señal de que la cuarta se escribirá sola.
- **Sí:** **400** para las dos violaciones, por lo mismo que en los otros dos: §10 reserva el 409 para duplicados y conflictos de estado de la fila.
- **No:** tolerar la descripción cuando la respuesta no es `true`. Guardaría un texto que contradice al campo que lo gobierna.
- **Sí:** **409** para el `notificationType` que no es `NON_SEVERE`. **No:** 400. No es un body corregible: una notificación `SEVERE` no puede tener detalle no grave nunca.
- **No:** exigir al menos una fuente de verificación informada. **No:** hacer excluyentes las seis. Son seis preguntas independientes de un formulario, y nada en el DDL sugiere lo contrario.

**Sobre la forma**

- **Sí:** PK sin `defaultValue`, y `findByPk` previo para detectar el duplicado en vez de dejar colisionar la clave. Las dos razones son las del F13 y no se reabren.
- **Sí:** `STRING(250)` explícito en `vaccinationCenterAddress`. Es el único campo del repositorio con longitud declarada en el DDL, y declararla en Sequelize convierte un `22001` de Postgres en un 400 del validador.
- **Sí:** excluir los tres UUID crudos de la respuesta y devolver los objetos resueltos, con el `DETAIL_EXCLUDE` que estrenó `notification.service.ts:38`. **No:** devolver ambos. Duplicar el dato invita a que dos clientes lean sitios distintos y uno se quede desactualizado.
- **Sí:** una FK no informada viaja como `null` explícito. Omitir la clave obliga al cliente a distinguir `undefined` de `null` para nada.
- **No:** declarar inversos `hasMany` desde `healthFacility`, `catalogItem` o `geoLocation`. Nadie los necesita, y declararlos invita a incluirlos en las respuestas de aquellas entidades.
- **Sí:** el mismo 404 en el `003` tanto si la fila no existe como si su cabecera está inactiva; **sí:** tres 404 distintos en el `006`. La asimetría es la del F13 y por la misma razón: allí el cliente ya tiene la PK, aquí entra por un `caseId` y necesita saber en qué eslabón se rompió la cadena.
- **Sí:** el máximo de `level` se recalcula en cada operación. **No:** cachearlo al arrancar. Sembrar un nivel nuevo debe surtir efecto sin reiniciar el proceso.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El máximo de `level` es global.** Si una sola rama del árbol geográfico baja un nivel más que las demás —una provincia con parroquias mientras el resto llega solo a cantones—, todo el país deja de poder informar su lugar de vacunación: el máximo sube y las ubicaciones de los demás dejan de ser válidas | Es la consecuencia aceptada de descartar el máximo por rama, razonada en §6. Se mitiga sembrando el árbol completo hasta el mismo nivel, que es lo que la precondición de §2 pide. Si aparece un despliegue con ramas desiguales, la salida no es parchear este filtro sino reabrirlo en un spec propio |
| **La dependencia dura con el F13 lo bloquea todo.** Si aquél cambia en revisión —por ejemplo si se decide añadir `isActive` al DDL— este spec cambia entero, no en un detalle | Está declarada en la cabecera, en §2, en §4 y en §6, y las precondiciones del plan la comprueban antes del paso 1. Es visible desde la primera línea, que es lo único que se puede hacer con una dependencia real |
| **El paso 4 modifica un archivo de otro spec**, `severeNotification.service.ts`, para extraerle la guarda de purga | Va en su propio commit, antes de que exista código nuevo que pueda enmascarar una regresión, y su verificación exige que la suite del F13 pase **sin tocar ni un caso** |
| **La revalidación de FK por cambio se lee como el criterio general** y alguien la copia a una entidad donde la FK sí es un puntero vigente —un `caseId`, un `notificationId`— dejando pasar referencias a filas retiradas | La condición habilitante está escrita en §6: vale para FK que son **registro histórico**, no para las que sostienen una jerarquía viva. La excepción viaja con su frontera, igual que la cascada de subida del F13 |
| **La guarda de purga sigue siendo la única red**, y ahora vive en un helper compartido: retirar su llamada de un servicio deja ese `005C` desprotegido **sin que falle ninguna compilación**, porque `purgeEntityService` evalúa `undefined !== true` sobre una tabla sin `isActive` | Cubierto por criterio de aceptación explícito y por un caso de la suite de contrato en **las dos** entidades. Extraer la guarda no la hace más segura, solo la hace única; la red sigue siendo la prueba |
| **Los pasos 10, 11 y 12 añaden una segunda rama junto a la primera.** El modo natural de romperlo es «generalizar» la función de arrastre del F13 en vez de escribir la hermana, y una generalización mal hecha aplica las dos ramas a la misma notificación | Verificación explícita en el paso 10 —una notificación `SEVERE` no toca la rama no grave— y en el paso 12 —dos volcados, nunca tres— |
| `SEVNOT` es subcadena de `NSEVNOT`: un `grep` descuidado sobre la primera captura las dos entidades | Verificación del paso 13, y los `grep` de §5 usan siempre el prefijo completo `ESAVI-SEVNOT-` con su guion |
| **El `catalogType` `vaccinationSite` sin sembrar convierte todo `vaccinationSiteItemId` en un 404**, y el mensaje no distingue esa causa | Precondición declarada en §2 y en el plan. La ambigüedad del mensaje se acepta a cambio de no añadir una clave más, que es la decisión que el F10 ya tomó con `outcomeNotFound` |
| **Las tres FK son `ON DELETE RESTRICT`**, así que una fila de esta tabla impide purgar físicamente el establecimiento, el item de catálogo o la ubicación a los que apunta | **Hoy no tiene efecto observable:** ninguna de esas tres entidades expone `005C` —solo lo hacen `classification`, `appUserGeoLocation`, `notifier` y `notification`—. Queda anotado para el spec que se lo añada a alguna de ellas: tendrá que decidir si traduce el `23503` de Postgres a un 409 propio o lo deja subir como 500 |
| **Las seis satélites restantes heredarán estas decisiones.** Lo que aquí son dos excepciones razonadas —la revalidación por cambio y el nivel geográfico— se convierten por repetición en el patrón de facto | Es el efecto buscado, y por eso §6 razona cada pieza. Con la tercera satélite habrá que decidir si la función de arrastre se generaliza de verdad: dos ramas conviven bien, ocho copiadas no |

---

## 8. Impacto en el contrato HTTP

El spec añade cinco rutas nuevas y **no cambia la forma** de ninguna respuesta existente. Sí amplía el **efecto lateral** de tres endpoints ya publicados, que el F13 acaba de tocar por la rama grave:

| Endpoint | Después del F13 | Después de este spec |
|---|---|---|
| `DELETE /api/notifications/:id` (`ESAVI-NOTIFCN-005A`) | Desactiva la notificación y sella el detalle **grave** | Sella también el detalle **no grave**. Como `notificationType` es único por fila, siempre actúa una sola rama |
| `PATCH /api/notifications/activate/:id` (`ESAVI-NOTIFCN-005B`) | Reactiva y limpia el `deletedAt` del detalle grave | Limpia también el del no grave |
| `DELETE /api/esavi-cases/:id` (`ESAVI-CASE-005A`) | Desactiva el caso, sus notificadores, su notificación y sella el detalle grave | Sella también el no grave, en la misma transacción |

Los tres siguen respondiendo el mismo status, el mismo mensaje y el mismo cuerpo. Lo que cambia es lo que le pasa a otras filas.

**`DELETE /api/notifications/purge/:id` (`ESAVI-NOTIFCN-005C`) no cambia en nada observable desde HTTP.** Sigue respondiendo 200 sin `data` y sigue destruyendo el detalle por la cascada del DDL. Lo único nuevo es que el volcado en `esaviLog` cubre ahora las dos ramas; una notificación con detalle deja dos volcados, nunca tres.

**`GET /api/notifications` y `GET /api/notifications/:id` no cambian.** La asociación `hasOne` se declara pero no entra en ninguna respuesta.

**`/api/health-facilities`, `/api/catalog-items` y `/api/geo-locations` no cambian hoy.** Ninguna expone `005C`, así que el `ON DELETE RESTRICT` de las tres FK nuevas no puede dispararse desde HTTP. Se declara aquí porque el spec que le añada borrado físico a cualquiera de las tres se encontrará con una restricción que hoy no existe.

Una consecuencia que conviene decir explícitamente, y es la misma que declaró el F13: **desactivar una notificación y reactivarla después devuelve el estado exacto anterior**, ahora también con el detalle no grave. Sin la mitad que limpia el sello, el ciclo dejaría el detalle marcado para siempre y purgable por accidente.

---

## Lo que **no** está en este spec

- Las otras seis tablas satélite de `notification`: `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy` y `notificationPregnancyComplication`.
- Cualquier listado de detalles no graves —`002`, `002A` o `002B`— y cualquier filtro, conteo o tablero sobre los seis `verified*` o sobre el establecimiento de vacunación.
- Cualquier operación `005A` o `005B` sobre esta entidad. No tiene estado propio que activar.
- Cualquier regla de coherencia entre `vaccinationHealthFacilityId`, `vaccinationCenterAddress` y `vaccinationGeoLocationId`, incluida la que exija al menos una de las tres. Es previsible que el funcional acabe pidiendo exactamente eso, y será un spec de ampliación con la regla escrita.
- Contrastar `vaccinationGeoLocationId` con el `geoLocationId` del establecimiento referenciado.
- Cualquier regla que exija al menos una fuente de verificación informada, o que haga excluyentes las seis.
- Anclar el nivel geográfico a un `geoLevelType.code`, o calcular el máximo por rama en lugar de global.
- Añadir `isActive` a `nonSevereNotification`, ni ninguna otra modificación de `esaviapp.sql`: ni las cuatro FK, ni sus `ON DELETE`, ni ningún `CHECK` sobre las columnas de lugar.
- Modificar `setEntityActiveStatusService` o `purgeEntityService`, ni añadirles predicados opcionales.
- Traducir a 409 el `23503` que provocarían las tres FK `ON DELETE RESTRICT` si alguna de las tres entidades destino llegara a exponer `005C`.
- Bloquear `ESAVI-NOTIFCN-005C` cuando la notificación tiene detalle. La cascada sigue disparando; lo único nuevo es el volcado al log.
- Crear el detalle automáticamente al dar de alta una notificación `NON_SEVERE`.
- Búsqueda por texto sobre `vaccinationCenterAddress`, `otherSourceDescription` o `notes`.
- Cifrar ningún campo.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
