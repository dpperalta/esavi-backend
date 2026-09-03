# SPEC F22 — CRUD de `notificationVaccine`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F10 (`notification` — dependencia dura de modelo: es el padre de la FK y la fuente de la visibilidad heredada)**, **SPEC F18 (`vaccineWhodrug` — dependencia dura de modelo: es el maestro que esta tabla referencia, y sin él la FK no apunta a nada)**, **SPEC F16 (`notificationEvent` — dependencia dura de precedente: aporta la solución verificada al choque entre el trigger de `sortOrder` y la reactivación)**, SPEC F21 (`notificationMedication` — precedente inmediato de forma: nueve operaciones, visibilidad heredada y línea de log en la cascada), SPEC F19 (importación de `vaccineWhodrug` — es lo que puebla el maestro), SPEC F06 (`esaviCase` — el `006` entra por el `caseId` y de ahí sale `eventDate`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa)
> **Fecha:** 2026-08-17
> **Objetivo:** Dar de alta `notificationVaccine` —las vacunas administradas que la notificación registra, sospechosas o no— como la quinta tabla satélite de `notification`, primera consumidora del maestro `vaccineWhodrug` y primera satélite con tabla hija propia.

---

## 1. Por qué existe este spec

`notificationVaccine` es la **quinta de las ocho tablas satélite de `notification`** que recibe implementación, y la **tercera de la familia «uno a muchos con estado y orden propios»** que abrió F16. El [SPEC F10](./10-notification-header-crud.md) dejó las ocho fuera de alcance en bloque; [F13](./13-severenotification-crud.md) y [F14](./14-nonseverenotification-crud.md) entregaron las dos ramas del detalle uno a uno; [F16](./16-notificationevent-crud.md) entregó la primera uno a muchos y [F21](./21-notificationmedication-crud.md) la segunda.

Guarda **qué se administró**: la vacuna, su lote, su fecha y hora, el número de dosis, su caducidad, y si se la señala como sospechosa del evento. Es el dato central de la notificación —sin vacuna no hay ESAVI— y a la vez el único que el esquema deja enteramente opcional columna por columna.

Hoy la tabla existe en `esaviapp.sql:838-861` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**A — Es una copia estructural de `notificationMedication`, y eso vuelve a ser deliberado.** PK propia `vaccineId` con `gen_random_uuid()` (`:839`), `notificationId` `NOT NULL` con `ON DELETE CASCADE` (`:840`, `:859`), `sortOrder` gobernado por trigger (`:842`, registrado en `:1312`), las seis transversales completas (`:853-858`), y ausencia de `preventPhysicalDelete` (`:1361-1373`) que habilita el `005C`. De ahí salen las **mismas nueve operaciones** de F16 y F21, con los mismos roles y la misma forma de ruta. Con una diferencia de menos: **el índice sobre la FK ya existe** (`IX_notificationVaccine_notification`, `:862`), así que el único cambio de DDL que F21 necesitó aquí no hace falta.

**B — Hereda el hallazgo del `005B`, sin variación.** F16 §1.C documentó que `setSortOrderByParent` es `BEFORE INSERT` **solamente** (`:1323`) y calcula `COALESCE(MAX("sortOrder"), 0) + 1 ... WHERE "deletedAt" IS NULL` (`:182-188`); que el índice único parcial `UQ_notificationVaccine_parent_sortOrder` (`:1338-1340`) se condiciona también a `deletedAt IS NULL`; y que `setEntityActiveStatusService:34` reactiva limpiando `deletedAt`. Las tres piezas producen el mismo choque, y este spec **no vuelve a razonarlo**: adopta la solución de F16 —reasignar `sortOrder` a `MAX+1` antes de tocar `deletedAt`— porque es el mismo mecanismo sobre la misma configuración.

**C — Es la primera consumidora de `vaccineWhodrug`, y el maestro fue diseñado para ella.** [F18](./18-vaccinewhodrug-crud.md) §1 citó `notificationVaccine.vaccineWhodrugId` como una de las dos razones de su existencia, y anticipó textualmente el patrón: la FK nullable representa «notificado pero sin codificar», y los tres campos de texto —`whoCode`, `vaccineCode`, `vaccineName` (`:844-846`)— conservan lo que el notificador leyó en el carné aunque el maestro se renombre después. **A diferencia de `diagnosticTerm`, no hay resolución implícita:** [F19](./19-vaccinewhodrug-bulk-import.md) §1 recuerda que una entrada de un diccionario licenciado no se acuña desde un formulario. La consecuencia práctica es que aquí **no hay `006` de acuñación** como en `NOTIFEVT`, no hay transacción envolviendo el `001`, y **ningún campo es derivado**: los tres textos son del cliente y nunca se copian del maestro.

**D — Es la primera satélite con tabla hija propia.** De `notificationVaccine` cuelga `notificationDiluent` (`:864-883`) con `ON DELETE CASCADE` sobre `vaccineId` (`:881`). Sus cuatro hermanas mayores eran hojas del grafo; ésta no. La consecuencia recae entera sobre el `005C`, que destruye filas de una tabla que ni siquiera está modelada, y por eso este spec le exige dejar rastro en el log.

**E — Es la primera regla de coherencia del repositorio que cruza hacia arriba dos tablas.** Un ESAVI es, por definición, un evento posterior a la inmunización: `vaccinationDate` no puede ser posterior a `esaviCase.eventDate` (`:652`). La comprobación salta `notificationVaccine → notification → esaviCase`, y **no** consulta `notificationEvent`: la fecha del ESAVI es una sola y vive en el caso, mientras que los eventos notificados son los diagnósticos, que son otra cosa y son N.

**F — El DDL se corrige en una línea.** `isSuspected` estaba declarado `"answerOption"` (el ENUM tri-estado `SI`/`NO`/`NO_SABE`) y pasa a `boolean NOT NULL DEFAULT false`. Es la corrección ya aplicada en la base de desarrollo, y es la correcta: señalar una vacuna como sospechosa es una marca binaria que el notificador pone o no pone, no una pregunta con tres respuestas posibles como `hasRelevantMedicalHistory` (`:725`). Es el **único** cambio de este spec sobre `esaviapp.sql`.

**Y lo que hace única a esta tabla entre las cinco satélites ya especificadas.** Sus **once columnas de datos son opcionales sin excepción** —una booleana con defecto y diez anulables—, así que el DDL admite una fila que solo dice «esta notificación tiene una vacuna» sin decir cuál. Es el primer caso en que el esquema no protege ni el dato mínimo, y de ahí sale la única guarda de contenido que este spec añade: al menos uno de `vaccineWhodrugId` o `vaccineName`.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notificationVaccine`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones canónicas más una no canónica:** `001` crear, `002A` listar activas por notificación, `002B` listar todas por notificación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar, `005C` borrado físico, y `006` listar las vacunas de un caso. Alta de la fila de `006` en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Corrección de una línea en `esaviapp.sql`:** `isSuspected` pasa de `"answerOption"` a `boolean NOT NULL DEFAULT false` (`:843`). Es el **único** cambio de este spec sobre el DDL, ya aplicado en la base de desarrollo, y se razona en §6.
- **Relación uno a muchos con `notification`.** No hay límite de vacunas por notificación ni `UNIQUE` que lo imponga. Los listados se entran por la FK —`/notification/:id`— y nunca por `/`.
- **Guarda del alta:** la notificación existe y está **activa** → 404 `NOTIFVAC_001_NOTIFICATION_NOT_FOUND`. **Ninguna guarda por `notificationType`:** las vacunas administradas se registran igual sea la notificación grave o no grave.
- **Guarda de contenido mínimo**, en `001` y en `004` sobre el estado resultante: debe haber **al menos uno** de `vaccineWhodrugId` o `vaccineName` → 400 `NOTIFVAC_<op>_VACCINE_REQUIRED`. Es la única defensa contra la fila vacía que el DDL admite, y respeta el diseño «codificado **o** crudo» que F18 §1 fijó para esta tabla.
- **Validación de la FK al maestro en `001` y en `004`:** `vaccineWhodrugId` debe existir y estar **activo** → 404 `NOTIFVAC_<op>_WHODRUG_NOT_FOUND`.
  - Es **opcional**: ausente o `null`, no se valida nada y la notificación queda sin codificar, que es un estado legítimo.
  - Corre **antes del diff y con independencia de él**: un `PUT` con una vacuna del maestro desactivada responde 404 aunque ningún otro campo cambie.
  - **En lectura no se filtra por `isActive`.** Una entrada retirada del maestro después del registro sigue viajando resuelta en la respuesta: F18 §6 decidió que desactivar significa «deja de ofrecerse en el autocomplete», no «deja de existir».
- **Regla de coherencia temporal**, en `001` y en `004` sobre el estado resultante: `vaccinationDate` no puede ser **posterior** a `esaviCase.eventDate` → 400 `NOTIFVAC_<op>_VACCINATION_AFTER_EVENT`. La comprobación salta `notificationVaccine → notification → esaviCase` (`:652`) y **no** consulta `notificationEvent`. **No aplica** si falta cualquiera de las dos fechas, que es el caso corriente: las vacunas suelen cargarse antes de que el caso tenga `eventDate`.
- **`sortOrder` inmutable y asignado por la base.** El `001` nunca lo envía y usa `fields: CREATE_FIELDS`. El `004` lo ignora en silencio, sin 400. No aparece en el tipo de entrada.
- **Reasignación de `sortOrder` en `ESAVI-NOTIFVAC-005B`** cuando el número que ocupaba la fila ya lo tomó otra vacuna viva de la misma notificación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación **no** delega sin más en `setEntityActiveStatusService`. La solución es la de F16, verificada allí y reconfirmada en F21.
- **Visibilidad heredada de la cabecera.** Toda lectura incluye `notification` y comprueba su `isActive`: si la notificación está inactiva, sus vacunas responden **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Aplica a `002A`, `002B`, `003` y `006`.
- **`005C` con volcado de la cascada hija.** La guarda es la canónica de §6 sobre la **propia fila**, que `purgeEntityService` ya aplica sin modificación. Antes del `destroy`, **una línea `warn`** con el conteo y la lista de `diluentId` de `notificationDiluent` que la cascada (`:881`) va a arrastrar. La consulta se hace con SQL crudo: esa tabla no tiene modelo y este spec no se lo da.
- **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`:** **una sola línea** en nivel `warn` con el conteo y la lista de `vaccineId` arrastrados, junto a las que F16 y F21 ya dejaron para eventos y medicamentos. Los `notificationDiluent` que caen en el segundo salto **no** se vuelcan ahí; los volcará el spec de esa tabla. Implica tocar `src/services/notification.service.ts` solo en ese punto.
- **`005A` y `005B` no miran a los diluyentes.** Desactivar una vacuna no toca el `isActive` de sus `notificationDiluent` ni se bloquea por tenerlos vivos.
- **Normalización al escribir: solo `trim()`** sobre `whoCode`, `vaccineCode`, `vaccineName`, `batchNumber` y `notes`. La desviación de §11 —que pediría `toTitleCase` para un nombre— se razona en §6. `vaccinationTime` se normaliza con una copia local de `normalizeTime`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` de §3.5: `notificationId` y `sortOrder` inmutables, once campos comparados, **ninguno derivado**.
- Alta de la abreviatura **`NOTIFVAC`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **153 a 162**— y suite `tests/contract/notificationVaccine.test.ts`.

**Precondiciones de datos** (no son parte de la implementación):

- `vaccineWhodrug` se puebla por la importación de [F19](./19-vaccinewhodrug-bulk-import.md). Sobre una base con el maestro vacío, **toda escritura que mande `vaccineWhodrugId` cae en 404** — pero, a diferencia de las FK de catálogo de F21, eso **no bloquea el registro**: la vacuna se notifica con `vaccineName` en texto crudo y la fila queda sin codificar, que es exactamente el estado que el esquema previó.

**Fuera de alcance (otros specs):**

- **Las otras tres satélites de `notification`:** `notificationDiluent` (`esaviapp.sql:864-883`), `notificationPregnancy` (`885-902`) y `notificationPregnancyComplication` (`904-925`). `notificationDiluent` es hija de esta tabla y su spec natural es el siguiente, pero aquí no se modela, ni se asocia, ni se incluye en ninguna respuesta: solo se cuenta y se vuelca al log en el `005C`.
- **El espejo de la regla de coherencia temporal.** Editar `esaviCase.eventDate` a una fecha anterior a una vacuna ya cargada, o dar de alta un caso incoherente, **seguirá pasando**: validarlo obliga a tocar `esaviCase.service.ts` y a decidir qué hacer con las filas que ya violan la regla. Queda para un spec de coherencia posterior, que deberá cubrir los dos lados a la vez.
- **Reordenar vacunas** — el `007` que mueva una fila de posición y desplace a sus hermanas. Es la misma operación pendiente para eventos (F16) y medicamentos (F21); cuando se escriba debe cubrir las tres entidades.
- **Cualquier resolución o acuñación contra `vaccineWhodrug`.** No hay un `ESAVI-WHODRUG-006` al estilo de `DIAGTERM-006`, y F18 §6 decidió que no lo haya: el maestro se puebla por importación, no por formulario.
- **Derivar `whoCode`, `vaccineCode` o `vaccineName` del maestro** cuando llega la FK. Los tres son copia de lo notificado y el servicio no los toca.
- **Arrastre de estado, en los dos sentidos.** Desactivar una notificación no toca sus vacunas; desactivar una vacuna no toca sus diluyentes. La visibilidad heredada ya resuelve la lectura.
- **Cualquier filtro de listado** por `isSuspected`, `vaccineWhodrugId`, `batchNumber`, fechas o texto sobre `vaccineName`. Los dos listados devuelven todas las vacunas de su notificación, paginadas y ordenadas por `sortOrder`.
- **Cualquier comprobación de duplicados.** La misma vacuna puede repetirse en una notificación: dos dosis, dos lotes o dos fechas distintas son un registro legítimo.
- **Cualquier regla sobre `expirationDate`.** Una vacuna administrada después de caducar es precisamente el hallazgo que un ESAVI documenta; validarlo con un 400 impediría registrar el caso que motiva la notificación.
- **Cualquier regla de negocio sobre `isSuspected`**, del tipo «al menos una vacuna sospechosa por notificación». Mientras se investiga, todas pueden estar sin marcar.
- **Extraer `normalizeTime` y `normalizeText` a un helper compartido.** Es la segunda copia; el refactor tendrá su propio spec, y hacerlo aquí metería `notificationEvent.service.ts` en el alcance.
- **Modificar `esaviapp.sql` más allá de la línea de `isSuspected`**: ni el trigger de `sortOrder`, ni el índice único parcial, ni el índice sobre la FK —que ya existe—, ni los `CHECK`, ni ningún `ON DELETE`.
- **Modificar `purgeEntityService` ni `setEntityActiveStatusService`.** Sirven tal cual.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII del paciente.
- Crear vacunas automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notificationVaccine` — `esaviapp.sql:838-861`, con su índice sobre la FK en `:862`. **Se altera en un solo punto:** el tipo de `isSuspected`.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `vaccineId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` |
| `notificationId` | `uuid` | no | `FK_notificationVaccine_notification` → `notification`, `ON DELETE CASCADE`. **Ya indexada** en `:862` |
| `vaccineWhodrugId` | `uuid` | sí | `FK_notificationVaccine_whodrug` → `vaccineWhodrug`, `ON DELETE RESTRICT`. Nula = «notificado sin codificar» |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)`. Lo asigna el trigger; la aplicación no lo envía |
| `isSuspected` | `boolean` | no | `DEFAULT false`. **Corregido por este spec**: era `"answerOption"` |
| `whoCode` | `varchar(250)` | sí | Copia de lo notificado, sin derivar del maestro |
| `vaccineCode` | `varchar(250)` | sí | Ídem |
| `vaccineName` | `varchar(500)` | sí | Ídem. **La columna de texto más larga de la tabla** |
| `vaccinationDate` | `date` | sí | Entra en la regla de coherencia temporal |
| `vaccinationTime` | `time` | sí | Se normaliza a `HH:MM:SS` antes de comparar |
| `doseNumber` | `smallint` | sí | `CHECK ("doseNumber" IS NULL OR "doseNumber" >= 0)`. Sin máximo |
| `batchNumber` | `varchar(100)` | sí | Lote |
| `expirationDate` | `date` | sí | Sin regla que la cruce con `vaccinationDate` |
| `notes` | `text` | sí | Texto libre |

**Once columnas de datos: una booleana no nula con defecto y diez anulables. Ninguna obligatoria.** Es la única de las cinco satélites especificadas en que el esquema no exige ni un dato de negocio, y el origen de la guarda de contenido mínimo de §2.

**La línea que cambia.** `isSuspected` (`:843`) pasa de `"answerOption"` a `boolean NOT NULL DEFAULT false`. El ENUM tri-estado sirve para preguntas de anamnesis que admiten «no sabe» —`hasRelevantMedicalHistory` (`:725`), `takesMedication` (`:726`)—, pero señalar una vacuna como sospechosa es una marca que el notificador pone o no pone. Como booleano `NOT NULL`, `null` deja de ser un valor posible y la comparación en el diff nunca es por veracidad.

**Restricciones.** Dos claves foráneas y dos `CHECK`. **Ninguna `UNIQUE` declarada en la tabla** — la única unicidad de negocio vive fuera, en el índice parcial `UQ_notificationVaccine_parent_sortOrder` (`:1338-1340`) sobre `("notificationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `B` de §1.

La FK a `vaccineWhodrug` es `ON DELETE RESTRICT`, así que una vacuna notificada impide borrar físicamente su entrada del maestro — irrelevante en la práctica, porque `vaccineWhodrug` figura en `preventPhysicalDelete` (`:1366`) y no tiene `005C`.

**Índices: los dos que hacen falta ya existen.** `IX_notificationVaccine_notification` (`:862`) cubre los dos listados y el `006`, que filtran exclusivamente por `notificationId`. Este spec **no toca ningún índice**, a diferencia de F21, que tuvo que añadir el suyo.

**La tabla hija.** `notificationDiluent` (`:864-883`) referencia `vaccineId` con `ON DELETE CASCADE` (`:881`). No se modela aquí. Su única aparición en este spec es el conteo que el `005C` vuelca al log antes de destruir.

**`vaccinationDate` y `vaccinationTime` en columnas separadas.** El DDL las parte, y este spec no las junta: son dos preguntas distintas del formulario y la hora se desconoce con frecuencia. `vaccinationDate: '2026-08-01'` con `vaccinationTime: null` es una vacuna perfectamente registrada. La regla de coherencia temporal opera **solo sobre la fecha**: `esaviCase.eventDate` es `date` y no hay hora con la que comparar.

**Las columnas transversales.** Están las seis: `isActive` (`:853`), `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`.

**Triggers.** Dos, los dos de bucle genérico. `TRG_notificationVaccine_setSysDetails` (`:1280-1295`). Y `TRG_notificationVaccine_setSortOrder` (`:1302-1329`, registrado en `:1312`), que ejecuta `setSortOrderByParent('notificationId')` **solo `BEFORE INSERT`** (`:1323`): respeta un `sortOrder` recibido si es mayor que 0 (`:168-170`) y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre (`:182-188`), bajo `pg_advisory_xact_lock` (`:179`). **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `esaviapp.sql:1361-1373`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationVaccine.model.ts`. Clase `NotificationVaccine`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationVaccine'`.

`vaccineId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `notificationId` va `DataTypes.UUID` con `allowNull: false`; `vaccineWhodrugId`, `DataTypes.UUID` con `allowNull: true`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, exactamente como F16 §3.2 y F21 §3.2. Declararle `defaultValue: 0` haría que el `INSERT` mandara `0` explícito —el valor que el trigger interpreta como «asígnamelo tú» (`:168`)—, que funcionaría por accidente.

> **Nota de implementación.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere en la aplicación con `notNull Violation: NotificationVaccine.sortOrder cannot be null` y el trigger nunca llega a ejecutarse. Lo que deja la columna fuera de la sentencia es pasar la lista explícita al `create` — `NotificationVaccine.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y sin `sortOrder` ni `vaccineId`. Es el remedio que F16 verificó y F21 reconfirmó; no se re-descubre.

Longitudes explícitas, para que un texto largo falle en Sequelize y no en Postgres: `whoCode` y `vaccineCode` `DataTypes.STRING(250)`; `vaccineName` `DataTypes.STRING(500)`; `batchNumber` `DataTypes.STRING(100)`; `notes` `DataTypes.TEXT`.

`isSuspected` va `DataTypes.BOOLEAN` con `allowNull: false` y `defaultValue: false`. **No es tri-estado**: tras la corrección de §3.1 el DDL lo declara `NOT NULL`, así que `null` no es un valor posible.

`vaccinationDate` y `expirationDate` van `DataTypes.DATEONLY` — el helper de diff ya compara `DATEONLY` con `slice(0, 10)`. `vaccinationTime` va `DataTypes.TIME`. `doseNumber` va `DataTypes.SMALLINT` con `allowNull: true`.

Asociaciones, en `src/models/associations/notificationVaccine.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationVaccine.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasMany(NotificationVaccine, { as: 'vaccines', foreignKey: 'notificationId' })`
- `NotificationVaccine.belongsTo(VaccineWhodrug, { as: 'vaccineWhodrug', foreignKey: 'vaccineWhodrugId' })`

El `hasMany` **sí** se declara: lo necesitan el `006`, la visibilidad heredada y el volcado al log de la cascada de purga. **Ningún inverso `hasMany` desde `VaccineWhodrug`**: nadie lo necesita, declararlo invitaría a incluir notificaciones en las respuestas del maestro —cuyo contrato F18 fijó— y F18 §3.2 dejó esa entidad deliberadamente **sin archivo de asociaciones**; esta es la primera FK entrante y se declara, como allí se dijo, del lado que posee la clave. **Ninguna asociación hacia `notificationDiluent`**: esa tabla no tiene modelo. Alta en `src/models/index.ts`.

### 3.3 Tipos

Ruta: `src/types/notificationVaccine/notificationVaccine.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts`.

```ts
export interface CreateNotificationVaccineInput {
    notificationId: string;
    vaccineWhodrugId?: string | null;
    isSuspected?: boolean;
    whoCode?: string | null;
    vaccineCode?: string | null;
    vaccineName?: string | null;
    vaccinationDate?: string | null;
    vaccinationTime?: string | null;
    doseNumber?: number | null;
    batchNumber?: string | null;
    expirationDate?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationVaccineInput>`. **No se declara `UpdateNotificationVaccineInput`** — prohibido por §4 de las convenciones.

Una sola ausencia deliberada: **`sortOrder` no está**. Es inmutable y lo asigna la base; que no exista en el tipo es la garantía más barata de que ningún servicio lo mande.

**Ningún campo de entrada que no sea columna.** A diferencia de F16, que necesitaba `source` para elegir rama de resolución, aquí no hay resolución que gobernar: las doce claves de entrada son las doce columnas escribibles. La interfaz es plana y no hay nada que descartar antes del `create`.

**Todos los campos de datos son opcionales en el tipo, y eso es fiel al DDL.** La guarda de contenido mínimo —al menos `vaccineWhodrugId` o `vaccineName`— vive en el servicio y no en el tipo, porque en el `004` se evalúa sobre el **estado resultante** y TypeScript no puede expresar esa condición.

### 3.4 Superficie HTTP

Ruta base `/api/notification-vaccines`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-vaccines                          ESAVI-NOTIFVAC-001   USER        (nuevo)
GET    /api/notification-vaccines/case/:caseId             ESAVI-NOTIFVAC-006   USER        (nuevo)
GET    /api/notification-vaccines/admin/notification/:id   ESAVI-NOTIFVAC-002B  ADMIN       (nuevo)
GET    /api/notification-vaccines/notification/:id         ESAVI-NOTIFVAC-002A  USER        (nuevo)
DELETE /api/notification-vaccines/purge/:id                ESAVI-NOTIFVAC-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-vaccines/activate/:id             ESAVI-NOTIFVAC-005B  SUPERADMIN  (nuevo)
GET    /api/notification-vaccines/:id                      ESAVI-NOTIFVAC-003   USER        (nuevo)
PUT    /api/notification-vaccines/:id                      ESAVI-NOTIFVAC-004   ADMIN       (nuevo)
DELETE /api/notification-vaccines/:id                      ESAVI-NOTIFVAC-005A  ADMIN       (nuevo)
```

**Orden de declaración.** Las literales van **antes** de `/:id`, o Express capturaría `case`, `admin`, `notification`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las nueve están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationVaccine.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `HFAC`, `NOTIFEVT` y `NOTIFMED`, no la de `GEOTYPE`.

`ESAVI-NOTIFVAC-006` **sí tiene ruta**, como el `006` de `NOTIFEVT` y `NOTIFMED`. Se registra en la tabla de operaciones no canónicas de §6 como: *«listar las vacunas de un caso — la cadena `caso → notificación` es uno a uno, pero de la notificación cuelgan N vacunas»*.

Nueve filas nuevas en `ROUTE_RULES`: de **153** a **162**.

### 3.5 Reglas de negocio por operación

**`ESAVI-NOTIFVAC-001` — crear.** En este orden:

1. La notificación existe y está **activa** → 404 `NOTIFVAC_001_NOTIFICATION_NOT_FOUND`. Sin comprobar `notificationType`. Se carga con `include: [{ model: EsaviCase, as: 'case', attributes: ['caseId', 'eventDate'] }]`, para tener la fecha del paso 4 sin una segunda consulta.
2. **Contenido mínimo:** si no llega `vaccineWhodrugId` ni `vaccineName` con valor no nulo → 400 `NOTIFVAC_001_VACCINE_REQUIRED`.
3. **Maestro**, solo si `vaccineWhodrugId` llega con valor no nulo: `VaccineWhodrug.findOne({ where: { vaccineWhodrugId, isActive: true } })`; si no hay fila → 404 `NOTIFVAC_001_WHODRUG_NOT_FOUND`. Basta el `findOne` sobre la propia tabla: el maestro no cuelga de ningún `catalogType`, así que aquí **no** aplica el patrón de doble salto que F14 y F21 necesitaron.
4. **Coherencia temporal**, solo si `vaccinationDate` llega con valor y el caso tiene `eventDate`: si `vaccinationDate > case.eventDate` → 400 `NOTIFVAC_001_VACCINATION_AFTER_EVENT`. Con cualquiera de las dos fechas ausente, no se comprueba nada.
5. Normalización: `normalizeText` sobre `whoCode`, `vaccineCode`, `vaccineName`, `batchNumber` y `notes` —`trim()`, y un texto que queda vacío es texto ausente—; `normalizeTime` sobre `vaccinationTime`. **Ningún `toTitleCase`.**
6. `create` **sin `sortOrder`**, con `fields: CREATE_FIELDS`, para que lo asigne `TRG_notificationVaccine_setSortOrder`.
7. Entrada de auditoría en `appDetails` con `method: 'ESAVI-NOTIFVAC-001'`.

**No hay transacción propia.** Como en F21 y a diferencia de F16, aquí no se escribe en ninguna otra tabla: no hay acuñación en el maestro y el `001` es un `create` único, así que la transacción implícita de Sequelize basta.

**`ESAVI-NOTIFVAC-002A` — listar activas por notificación.** La notificación existe y está activa, salvo `canViewInactive` → 404 `NOTIFVAC_002A_NOTIFICATION_NOT_FOUND`. `findAndCountAll` con `where: { notificationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query.

**`ESAVI-NOTIFVAC-002B` — listar todas por notificación.** Idéntico, sin el filtro `isActive` y con `paranoid: false`. Rol ADMIN.

**`ESAVI-NOTIFVAC-003` — obtener por ID.** Existencia → 404 `NOTIFVAC_003_NOT_FOUND`. Incluye `notification`: si la notificación está inactiva y quien pide no cumple `canViewInactive`, **404**. Una vacuna inactiva también es 404 salvo `canViewInactive`.

**`ESAVI-NOTIFVAC-006` — listar las vacunas de un caso.** El caso existe y está activo → 404 `NOTIFVAC_006_CASE_NOT_FOUND`. Su notificación existe y está activa → 404 `NOTIFVAC_006_NOTIFICATION_NOT_FOUND`. A partir de ahí es el `002A`: solo activas, ordenadas por `sortOrder`. La variante admin no se declara — quien necesite ver inactivas entra por `002B` con el `notificationId` que este mismo endpoint devuelve.

**`ESAVI-NOTIFVAC-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'NOTIFVAC_005A_NOT_FOUND'`, `alreadyInStateCode: 'NOTIFVAC_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-NOTIFVAC-005A'`. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial. Es correcto y deliberado. **No consulta `notificationDiluent`:** desactivar una vacuna no bloquea por tener diluyentes vivos ni los toca.

**`ESAVI-NOTIFVAC-005B` — reactivar.** **La única operación de este spec que no es una delegación limpia**, por el hallazgo `B` de §1. En transacción propia:

1. `NotificationVaccine.findOne({ where: { vaccineId: id }, paranoid: false, transaction })`. Si no hay fila, se pasa directo al paso 4 y el helper levanta el 404.
2. Si la fila existe y está inactiva, se busca colisión: otra fila de la **misma** notificación, con el **mismo** `sortOrder`, con `deletedAt: null` y `vaccineId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa notificación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que esta escritura es libre. La vacuna reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'NOTIFVAC_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-NOTIFVAC-005B'`, que limpia `deletedAt` con el `sortOrder` ya corregido.

Si la fila estaba **activa**, el paso 2 no encuentra colisión —el índice garantiza que ninguna otra fila viva comparte su número— así que no se escribe nada y el helper levanta su 409 con normalidad.

El orden de los pasos 3 y 4 es la clave entera: invertirlos hace fallar el índice en el propio `UPDATE` del helper, porque no es una restricción diferible y no hay forma de corregir después. **La reactivación no revalida nada más:** ni el maestro, ni el contenido mínimo, ni la coherencia temporal. Reactivar es deshacer una desactivación, no reescribir la fila.

**`ESAVI-NOTIFVAC-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'NOTIFVAC_005C_NOT_FOUND'` y `stillActiveCode: 'NOTIFVAC_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la notificación.** Sin entrada en `appDetails` —la fila se destruye en la misma transacción— y con el volcado a `warn` que el helper ya escribe.

**Más el volcado de la cascada hija**, que es lo propio de esta entidad. Antes de llamar al helper se consultan los `diluentId` de `notificationDiluent` que cuelgan de esa vacuna, con `sequelize.query` y `QueryTypes.SELECT` —esa tabla no tiene modelo y este spec no se lo da—. La línea `warn` con el conteo y la lista se escribe **después** de que el helper devuelva sin error: así una purga que acaba en 409 o en 404 no deja un aviso de una destrucción que no ocurrió. Si la vacuna no tiene diluyentes, no se escribe línea alguna.

**`ESAVI-NOTIFVAC-004` — actualizar.** Existencia → 404 `NOTIFVAC_004_NOT_FOUND`, incluida la visibilidad heredada. Después, y **antes del diff y con independencia de él**, las tres guardas del `001` evaluadas sobre el **estado resultante** —lo guardado fundido con lo que llega—, nunca sobre el body: contenido mínimo → 400 `NOTIFVAC_004_VACCINE_REQUIRED`; maestro, solo si `vaccineWhodrugId` llega con valor no nulo → 404 `NOTIFVAC_004_WHODRUG_NOT_FOUND`; coherencia temporal → 400 `NOTIFVAC_004_VACCINATION_AFTER_EVENT`. `stored` sale de `vaccine.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `notificationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `vaccineWhodrugId` | `data.vaccineWhodrugId !== undefined ? (data.vaccineWhodrugId ?? null) : undefined` | anulable; validado antes del diff |
| `isSuspected` | `data.isSuspected !== undefined ? data.isSuspected : undefined` | `NOT NULL`: nunca por veracidad, nunca a `null` |
| `whoCode` | `data.whoCode !== undefined ? normalizeText(data.whoCode) : undefined` | anulable; solo `trim()` |
| `vaccineCode` | `data.vaccineCode !== undefined ? normalizeText(data.vaccineCode) : undefined` | anulable; solo `trim()` |
| `vaccineName` | `data.vaccineName !== undefined ? normalizeText(data.vaccineName) : undefined` | anulable; **sin `toTitleCase`** |
| `vaccinationDate` | `data.vaccinationDate !== undefined ? (data.vaccinationDate ?? null) : undefined` | `DATEONLY`; el helper compara con `slice(0, 10)` |
| `vaccinationTime` | `data.vaccinationTime !== undefined ? normalizeTime(data.vaccinationTime) : undefined` | anulable; `'14:30'` se rellena a `'14:30:00'` **antes** de comparar |
| `doseNumber` | `data.doseNumber !== undefined ? (data.doseNumber ?? null) : undefined` | anulable |
| `batchNumber` | `data.batchNumber !== undefined ? normalizeText(data.batchNumber) : undefined` | anulable; solo `trim()` |
| `expirationDate` | `data.expirationDate !== undefined ? (data.expirationDate ?? null) : undefined` | `DATEONLY` |
| `notes` | `data.notes !== undefined ? normalizeText(data.notes) : undefined` | anulable |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**Once campos comparados y ninguno derivado.** Es la consecuencia directa de la decisión de §6: los tres textos son copia de lo notificado y el servicio jamás los rellena desde `vaccineWhodrug`. Un `PUT` que solo manda la FK **no** reescribe `whoCode` ni `vaccineName`.

**Escrituras que no son diferenciales, declaradas una a una:**

- **El `001`** — es un `create`.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: esta vacuna vuelve a estar viva y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005C`** — destruye la fila, y con ella sus diluyentes por cascada de la base.

**Este spec no escribe en ninguna otra tabla**, ni por cambio de valor ni por presencia de clave. Lo que toca fuera de `notificationVaccine` son dos líneas de log: la del `005C` sobre `notificationDiluent` y la de la cascada de purga de la cabecera.

### 3.6 Claves i18n nuevas

Bajo `notificationVaccine`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationVaccine.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente |
| `notificationVaccine.idRequired` | 400 del validador de `:id` |
| `notificationVaccine.notificationNotFound` | 404 cuando la notificación no existe o está inactiva |
| `notificationVaccine.caseNotFound` | 404 del `006` cuando el caso no existe o está inactivo |
| `notificationVaccine.whodrugNotFound` | 404 cuando la entrada del maestro no existe o está inactiva |
| `notificationVaccine.vaccineRequired` | 400 cuando no hay ni `vaccineWhodrugId` ni `vaccineName` |
| `notificationVaccine.vaccinationAfterEvent` | 400 cuando `vaccinationDate` es posterior al `eventDate` del caso |
| `notificationVaccine.stillActive` | 409 al purgar una vacuna que no fue retirada antes |
| `notificationVaccine.createdSuccess` / `createdFailed` | 201 y 500 del `001` |
| `notificationVaccine.getSuccess` / `getFailed` | 200 y 500 de `002A`, `002B`, `003` y `006` |
| `notificationVaccine.updatedSuccess` / `updatedFailed` | 200 y 500 del `004` |
| `notificationVaccine.deletedSuccess` / `deletedFailed` | 200 y 500 del `005A` |
| `notificationVaccine.activatedSuccess` / `activatedFailed` | 200 y 500 del `005B` |
| `notificationVaccine.alreadyActive` / `alreadyInactive` | 409 de `005B` y `005A` |
| `notificationVaccine.purgeSuccess` / `purgeFailed` | 200 y 500 del `005C` |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `003`, `001` y `004`, `data` es la fila con su entrada de maestro resuelta:

```
{ ok, message, data: {
    vaccineId, notificationId, vaccineWhodrugId, sortOrder,
    isSuspected, whoCode, vaccineCode, vaccineName,
    vaccinationDate, vaccinationTime, doseNumber,
    batchNumber, expirationDate, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    vaccineWhodrug: { vaccineWhodrugId, drugCode, drugName } | null
} }
```

**La FK cruda viaja junto al objeto resuelto.** Es el patrón de F16 y F21: el `004` acepta `vaccineWhodrugId` en el body, así que un `PUT` que reenvía la respuesta de su `GET` necesita encontrarla ahí. Excluirla obligaría al cliente a leer el id de dentro del objeto anidado, y el criterio de aceptación del update diferencial dejaría de poder escribirse tal cual.

El maestro se incluye **sin filtrar por `isActive`**: una entrada retirada después del registro sigue diciendo qué se administró. Se devuelve con tres campos —`vaccineWhodrugId`, `drugCode`, `drugName`— y ninguno de los otros veintiséis; quien necesite la ficha entera entra por `ESAVI-WHODRUG-003`.

**`notification` no se incluye en la respuesta**, aunque toda lectura la consulte para la visibilidad heredada. Se resuelve con `attributes: ['notificationId', 'isActive']` —más `case` con `['caseId', 'eventDate']` en las dos operaciones de escritura— y se descarta al construir el payload: el cliente que necesite la cabecera entra por `ESAVI-NOTIFCN-003`. **`notificationDiluent` no aparece en ninguna respuesta.**

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente. `sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `notificationVaccine | NOTIFVAC` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila de `ESAVI-NOTIFVAC-006` a la tabla de operaciones no canónicas. La norma exige registrar **antes** de usar, así que va primero aunque no toque `src/`.
   *Verificación:* las dos tablas de §6 contienen la fila nueva; `NOTIFVAC` no aparece dos veces y no colisiona con `NOTIFCN`, `NOTIFEVT`, `NOTIFMED` ni `NOTIFIER`.

2. **Corrección de `isSuspected` en `esaviapp.sql`.** La línea `:843` pasa a `"isSuspected" boolean NOT NULL DEFAULT false,`. **El cambio ya está aplicado en el árbol de trabajo y en la base de desarrollo**; este paso lo consolida como parte del spec y lo deja committeado antes que el modelo, para que la base de pruebas ya lo tenga cuando corra la primera suite. Es el único cambio de este spec sobre el DDL.
   *Verificación:* `git diff esaviapp.sql` muestra **una sola línea modificada**; tras recrear la base de pruebas, `\d "notificationVaccine"` da `isSuspected | boolean | not null default false`. **Sobre una base ya desplegada el fichero no basta** —`CREATE TABLE IF NOT EXISTS` no altera una tabla existente—, así que el cambio de tipo exige un `ALTER TABLE` manual; queda anotado en §7.

3. **Modelo y asociaciones.** `src/models/notificationVaccine.model.ts` según §3.2, y `src/models/associations/notificationVaccine.associations.ts` con las tres asociaciones. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` en 0; un `NotificationVaccine.findAll({ include: ['notification', 'vaccineWhodrug'] })` desde el REPL devuelve filas sin error de asociación; `grep -rn "notificationDiluent" src/models/` no devuelve resultados.

4. **Tipos.** `src/types/notificationVaccine/notificationVaccine.types.ts` con `CreateNotificationVaccineInput`, más su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateNotificationVaccineInput" src/` no devuelve resultados.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0.

6. **Validadores.** `src/validators/notificationVaccine.validator.ts` con el validador de creación, el de actualización, el de `:id`, el de `:caseId` y el del `notificationId` de ruta. Longitudes máximas iguales a las del DDL —250, 250, 500, 100—, `notes` sin tope, las dos fechas en formato ISO, `vaccinationTime` admitiendo `HH:MM` y `HH:MM:SS`, `doseNumber` entero `>= 0` **sin máximo**, `vaccineWhodrugId` como UUID opcional y anulable, `isSuspected` booleano opcional. **`sortOrder` no se declara en ningún validador.** Alta en el barrel de `validators/`.
   *Verificación:* un body con `sortOrder: 5` no produce 400 y el campo se ignora; un `vaccineName` de 501 caracteres produce 400; un `vaccineWhodrugId: null` explícito **no** produce 400; `vaccinationTime: '14:30'` **no** produce 400; `doseNumber: -1` produce 400.

7. **`ESAVI-NOTIFVAC-001` — crear.** `createNotificationVaccineService` con los siete pasos de §3.5, incluido el `include` del caso para la fecha y el `fields: CREATE_FIELDS` del `create`. Controlador y ruta `POST /`.
   *Verificación:* crear con `vaccineName` y sin FK devuelve 201 con `vaccineWhodrug: null`; crear con una FK del maestro **activa** devuelve 201 con los tres campos resueltos; crear sin `vaccineName` y sin FK devuelve **400**; crear con una FK del maestro desactivada devuelve **404**; tres altas seguidas sobre la misma notificación reciben `sortOrder` 1, 2 y 3 sin que el servicio lo envíe.

8. **La regla de coherencia temporal.** Dentro del mismo `001`, el paso 4 de §3.5. Se implementa como una función local del servicio, compartida después por el `004`.
   *Verificación:* con `eventDate: '2026-08-10'`, crear con `vaccinationDate: '2026-08-12'` devuelve **400**; con `'2026-08-10'` devuelve **201** —el mismo día es válido—; con `'2026-08-01'` devuelve 201; sobre un caso con `eventDate: null`, cualquier `vaccinationDate` devuelve 201; sin `vaccinationDate`, también.

9. **`ESAVI-NOTIFVAC-002A` — listar activas por notificación.** Servicio, controlador y ruta `GET /notification/:id`, declarada después de `/admin/notification/:id`.
   *Verificación:* devuelve `{ count, rows }` ordenado por `sortOrder`; una vacuna desactivada desaparece del listado; una notificación inactiva devuelve 404 para USER.

10. **`ESAVI-NOTIFVAC-002B` — listar todas por notificación.** Servicio con `paranoid: false`, ruta `GET /admin/notification/:id` con `validateUserRole(ADMIN)`.
    *Verificación:* el mismo listado del paso anterior incluye la vacuna desactivada; un USER recibe 403.

11. **`ESAVI-NOTIFVAC-003` — obtener por ID.** Servicio con la visibilidad heredada de §3.5, ruta `GET /:id` declarada **después** de todas las literales.
    *Verificación:* `GET /api/notification-vaccines/activate/algo` responde 400 de UUID y no 404 de vacuna; una vacuna cuya notificación está inactiva devuelve 404 para ADMIN y 200 para SUPERADMIN.

12. **`ESAVI-NOTIFVAC-006` — listar las vacunas de un caso.** Servicio que salta `caso → notificación → vacunas`, ruta `GET /case/:caseId`.
    *Verificación:* un caso sin notificación devuelve 404; un caso con notificación y tres vacunas devuelve las tres ordenadas.

13. **`ESAVI-NOTIFVAC-004` — actualizar.** `buildDifferentialUpdate` con la tabla de `candidates` de §3.5, y las tres guardas previas al diff evaluadas sobre el estado resultante. Ruta `PUT /:id`.
    *Verificación:* un `PUT` que reenvía la respuesta del `GET` responde 200 sin escribir; un `PUT` con `vaccineName: null` sobre una fila **sin** FK responde 400; un `PUT` con `vaccinationTime: '14:30'` sobre un `'14:30:00'` guardado **no** escribe; un `PUT` con una entrada de maestro inactiva responde 404 aunque el resto del body sea idéntico.

14. **`ESAVI-NOTIFVAC-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, ruta `DELETE /:id`.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409; `grep -n "notificationDiluent" src/services/notificationVaccine.service.ts` devuelve resultados **solo** dentro del `005C`.

15. **`ESAVI-NOTIFVAC-005B` — reactivar.** Los cuatro pasos de §3.5, en transacción propia. Ruta `PATCH /activate/:id`.
    *Verificación:* el escenario del hallazgo `B` —crear tres vacunas, desactivar la tercera, crear una cuarta que recibe el `sortOrder` 3, reactivar la tercera— responde **200** y deja la reactivada con `sortOrder: 4`; reactivar una sin colisión **no** mueve su `sortOrder`; reactivar una cuya entrada de maestro se desactivó entretanto responde **200**; reactivar una ya activa devuelve 409.

16. **`ESAVI-NOTIFVAC-005C` — borrado físico, con el volcado de la cascada hija.** `purgeEntityService` sin modificarlo, precedido por la consulta de `diluentId` con `sequelize.query` y seguido —solo si el helper devuelve sin error— por la línea `warn`. Ruta `DELETE /purge/:id` declarada antes de `/:id`.
    *Verificación:* purgar una vacuna activa devuelve 409 **y no deja línea de diluyentes**; purgar una desactivada con su notificación activa devuelve 200; con dos diluyentes colgando, deja **una** línea `warn` con el conteo y los dos `diluentId`, y las filas hijas desaparecen de la base; sin diluyentes, no deja línea; `git diff --stat src/services/common/entityPurge.service.ts` no muestra cambios.

17. **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`.** En `src/services/notification.service.ts`, junto a las líneas que F16 y F21 dejaron para eventos y medicamentos, y antes del `destroy` de la notificación, una sola línea `warn` con el conteo y la lista de `vaccineId` que la cascada va a arrastrar. **Sin tocar los diluyentes del segundo salto.** Es el único punto de este spec que toca un servicio ajeno.
    *Verificación:* purgar una notificación con tres vacunas deja **una** línea con los tres `vaccineId`, y siguen apareciendo las de eventos y medicamentos; purgar una sin vacunas no deja esa línea.

18. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **153 a 162** en la aserción de longitud.
    *Verificación:* `npm test -- roles` en 0.

19. **Suite `tests/contract/notificationVaccine.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar por notificación → listar admin → listar por caso → actualizar → desactivar → reactivar → purgar. Más los caminos de error: 404 de notificación inactiva, 404 de caso inexistente, 404 de maestro inactivo, 400 de contenido mínimo, 400 de coherencia temporal, 409 de purga sobre fila activa, y los cinco casos de update diferencial de §5. Bloque aparte para el escenario de colisión de `sortOrder` del paso 15.
    *Verificación:* `npm run check` en 0.

Diecinueve pasos, uno más que F21: el que sobra es el **paso 8**, la regla de coherencia temporal, separado del `001` a propósito aunque viva dentro de él — es la única regla nueva del spec y merece su propia línea de verificación con las cinco combinaciones de fechas.

---

## 5. Criterios de aceptación

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las nueve operaciones — cuatro en el `005C`, que no escribe auditoría.
- [ ] `grep -rn "ESAVI-NOTIFVAC-002[^AB]" src/` no devuelve resultados.
- [ ] `references/CONVENTIONS.md` §6 contiene la fila `notificationVaccine | NOTIFVAC` y la fila de `ESAVI-NOTIFVAC-006`.
- [ ] `ROUTE_RULES` tiene 162 filas y la aserción de longitud de `tests/auth/roles.test.ts` espera ese número.

**DDL:**

- [ ] `git diff esaviapp.sql` muestra **exactamente una línea modificada**, la de `isSuspected`, y **ninguna añadida** — el índice sobre la FK ya existía.
- [ ] Sobre la base de pruebas recreada, `isSuspected` es `boolean NOT NULL DEFAULT false` y **no** queda ninguna referencia al ENUM `answerOption` en esa tabla.
- [ ] Sobre la base de pruebas recreada, `pg_indexes` devuelve `IX_notificationVaccine_notification` y `UQ_notificationVaccine_parent_sortOrder` para esa tabla.

**Maestro `vaccineWhodrug`:**

- [ ] Crear con un `vaccineWhodrugId` **inactivo** responde **404**, no 201.
- [ ] Crear con un `vaccineWhodrugId` inexistente responde **404**.
- [ ] Crear solo con `vaccineName`, sin FK, responde **201** con `vaccineWhodrug: null`.
- [ ] Crear sin `vaccineName` y sin `vaccineWhodrugId` responde **400**.
- [ ] Un `PUT` con `vaccineWhodrugId: null` explícito sobre una fila que **sí** tiene `vaccineName` borra la FK y devuelve `vaccineWhodrug: null`; sobre una fila **sin** `vaccineName` responde **400**.
- [ ] Desactivar la entrada del maestro **después** del registro no rompe el `GET`: la fila sigue devolviendo el objeto resuelto con sus tres campos.
- [ ] Un `PUT` que solo manda `vaccineWhodrugId` **no** reescribe `whoCode`, `vaccineCode` ni `vaccineName`: ningún campo se deriva del maestro.
- [ ] La respuesta del maestro trae exactamente tres campos: `grep -n "drugRecNo\|atcs\|icd11\|abbreviation" src/services/notificationVaccine.service.ts` no devuelve resultados.
- [ ] `git diff --stat src/services/vaccineWhodrug.service.ts` no muestra cambios.

**Coherencia temporal:**

- [ ] Con `eventDate: '2026-08-10'`, crear con `vaccinationDate: '2026-08-12'` responde **400**.
- [ ] Con el mismo caso, `vaccinationDate: '2026-08-10'` responde **201** — el mismo día es válido.
- [ ] Sobre un caso con `eventDate: null`, cualquier `vaccinationDate` responde **201**.
- [ ] Una vacuna sin `vaccinationDate` responde **201** sea cual sea el `eventDate` del caso.
- [ ] Un `PUT` que mueve `vaccinationDate` más allá del `eventDate` responde **400** aunque el resto del body no cambie nada.
- [ ] El servicio **no consulta `notificationEvent`**: `grep -n "notificationEvent\|NotificationEvent" src/services/notificationVaccine.service.ts` no devuelve resultados.
- [ ] `git diff --stat src/services/esaviCase.service.ts src/services/notificationEvent.service.ts` no muestra cambios — el espejo de la regla queda fuera de alcance.

**Orden y estado:**

- [ ] Tres altas seguidas sobre la misma notificación reciben `sortOrder` 1, 2 y 3 sin que ningún servicio envíe el campo.
- [ ] `grep -n "sortOrder" src/types/notificationVaccine/notificationVaccine.types.ts` no devuelve **ningún campo**.
- [ ] Un `PUT` con `sortOrder: 99` en el body responde 200 y deja el `sortOrder` guardado intacto, sin 400.
- [ ] **Escenario de colisión:** crear tres vacunas, desactivar la tercera, crear una cuarta —que recibe `sortOrder: 3`—, y reactivar la tercera responde **200** y la deja con `sortOrder: 4`.
- [ ] Reactivar una vacuna cuyo `sortOrder` sigue libre responde 200 y **no** mueve el `sortOrder`.
- [ ] Reactivar una vacuna cuya entrada de maestro se desactivó entretanto responde **200** — el `005B` no revalida nada.
- [ ] Purgar una vacuna desactivada cuya notificación está **activa** responde 200.
- [ ] Purgar una vacuna activa responde **409**.
- [ ] `git diff --stat src/services/common/entityPurge.service.ts src/services/common/entityActivation.service.ts` no muestra cambios.

**La tabla hija:**

- [ ] Purgar una vacuna con dos `notificationDiluent` colgando deja **una** línea `warn` con el conteo y los dos `diluentId`, y las dos filas hijas desaparecen de la base.
- [ ] Purgar una vacuna **sin** diluyentes no deja línea alguna.
- [ ] Una purga que acaba en **409** no deja línea de diluyentes — el volcado se escribe después de que el helper devuelva sin error.
- [ ] Desactivar una vacuna con diluyentes vivos responde **200**: no se bloquea ni se toca el `isActive` de las hijas.
- [ ] `notificationDiluent` no aparece en ninguna respuesta HTTP ni en `src/models/`: `grep -rn "notificationDiluent" src/models/ src/types/ src/controllers/` no devuelve resultados.

**Visibilidad heredada:**

- [ ] Una vacuna cuya notificación está inactiva responde 404 en `003` para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] Crear una vacuna sobre una notificación inactiva responde 404.
- [ ] `GET /api/notification-vaccines/activate/algo` responde 400 de UUID, no 404 de vacuna.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/notificationVaccine.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

Sobre el último: en esta entidad **no hay `code` propio ni 409 de duplicado** —`whoCode` y `vaccineCode` son texto libre y se admiten repetidos, y no hay `UNIQUE` en la tabla—, así que el ítem se cumple por su primera mitad: un `PUT` con un `vaccineWhodrugId` inactivo responde **404** aunque ningún otro campo cambie. La segunda mitad no aplica y se anota como tal, no se borra.

- [ ] Un `PUT` con `vaccineName: "  BCG  "` sobre un `BCG` guardado responde **200 sin escribir** — el `trim()` corre antes de comparar.
- [ ] Un `PUT` con `vaccineName: "bcg"` sobre un `BCG` guardado **sí escribe**: no hay `toTitleCase` ni ninguna otra normalización de caja, y las siglas se guardan como el notificador las escribió.
- [ ] Un `PUT` con `vaccinationTime: '14:30'` sobre un `'14:30:00'` guardado responde **200 sin escribir**.
- [ ] Un `PUT` con `whoCode: ""` sobre un `whoCode` guardado lo deja en `null` — `normalizeText` convierte el texto vacío en ausencia.
- [ ] Un `PUT` que solo cambia `batchNumber` deja `vaccineWhodrugId`, `isSuspected`, las tres fechas y `doseNumber` idénticos.
- [ ] Un `PUT` con `isSuspected: false` sobre una fila con `isSuspected: true` **sí escribe** — la comparación no es por veracidad.

**Cierre:**

- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] Purgar una notificación con tres vacunas deja **una** línea `warn` con los tres `vaccineId`, y las de eventos y medicamentos siguen apareciendo.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Superficie y numeración**

- **Sí:** `NOTIFVAC`, ocho letras. `NOTIFVACC` tiene nueve y excede el máximo de §6; `VACCINE` colisionaría conceptualmente con `WHODRUG`, que es el maestro y no la notificación. `NOTIFVAC` mantiene además el prefijo que ya identifica a la familia (`NOTIFCN`, `NOTIFEVT`, `NOTIFMED`).
- **Sí:** las nueve operaciones de F16 y F21, sin variación. La tabla tiene `isActive`, PK propia y no figura en `preventPhysicalDelete`, así que las ocho canónicas se derivan del esquema; el `006` se añade por la misma razón que allí. Es la tercera entidad idéntica en forma: inventar aquí una superficie distinta obligaría a leer dos patrones donde el DDL declara uno.
- **Sí:** listado por FK, `/notification/:id`, nunca `/`. Una vacuna notificada no existe sin su notificación, y un listado global no tiene lector.
- **No:** una variante admin del `006`. Devuelve el `notificationId`, que es la entrada al `002B`.

**El DDL y `isSuspected`**

- **Sí:** cambiar `isSuspected` de `"answerOption"` a `boolean NOT NULL DEFAULT false`. El ENUM tri-estado existe para preguntas de anamnesis que admiten «no sabe»; señalar una vacuna como sospechosa es una marca que el notificador pone o no pone. El cambio ya estaba aplicado en la base de desarrollo y este spec lo consolida.
- **No:** tratarlo como los `verified*` de F14, que sí son tri-estado. Copiar aquel patrón por parecido visual reintroduciría un `null` que el DDL corregido ya no admite, y haría que el diff comparase por veracidad.
- **No:** añadir ningún índice. F21 tuvo que crear el suyo porque `notificationMedication` era la única de su familia sin índice sobre la FK; aquí `IX_notificationVaccine_notification` ya existe en `:862` y cubre los tres endpoints de lectura.
- **No:** abrir un fichero de migraciones para el cambio de tipo. El repositorio no tiene ninguno y `esaviapp.sql` es la DDL autoritativa. La consecuencia —que una base ya desplegada necesita un `ALTER TABLE` a mano— queda declarada en §7 en vez de resolverse con un mecanismo nuevo que sería un spec aparte.

**El maestro `vaccineWhodrug`**

- **Sí:** FK opcional. F18 §1 lo dejó escrito antes de que esta tabla existiera: la FK nula representa «notificado pero sin codificar», y la notificación **no se bloquea** por no estar codificada. Es lo contrario de lo que hicieron las FK de catálogo de F21, y la diferencia es real: allí faltaba una forma farmacéutica, aquí falta el diccionario entero mientras no se importe.
- **Sí:** exigir `isActive: true` al escribir y **no** filtrar por `isActive` al leer. Es la asimetría que F14 razonó y F21 repitió: elegir hoy una entrada retirada es un error, pero haberla elegido ayer es un hecho.
- **Sí:** validar con un `findOne` sobre la propia tabla, sin el doble salto contra `catalogType`. `vaccineWhodrug` es un maestro autónomo y no cuelga de ningún tipo de catálogo; replicar aquí el patrón de `assertVaccinationSiteIsValid` sería copiar una solución sin su problema.
- **No:** derivar `whoCode`, `vaccineCode` o `vaccineName` del maestro cuando llega la FK. Es la decisión más consecuente del spec. F18 §1 dice que la copia de texto conserva **lo notificado**, y rellenarla desde el maestro destruiría exactamente la divergencia que esas tres columnas existen para guardar: si el carné dice una cosa y el diccionario otra, la notificación tiene que poder decir las dos. El efecto práctico es que **ningún campo es derivado** y el `004` es el caso limpio de F12, con once candidatos y ninguno calculado.
- **No:** una resolución implícita al estilo de `ESAVI-DIAGTERM-006`, que acuñase la entrada del maestro cuando el notificador escribe una vacuna que no está. F18 §6 y F19 §1 ya lo descartaron: un diccionario licenciado se puebla por importación, no por formulario.
- **No:** el inverso `hasMany` desde `VaccineWhodrug`. F18 §3.2 dejó esa entidad deliberadamente sin archivo de asociaciones, y la FK entrante se declara del lado que posee la clave.

**Contenido mínimo y normalización**

- **Sí:** exigir al menos uno de `vaccineWhodrugId` o `vaccineName`. El DDL admite una fila que solo dice «esta notificación tiene una vacuna» sin decir cuál, y eso no es un registro: es ruido con `sortOrder`. Es la guarda mínima que respeta el diseño «codificado **o** crudo» sin exigir ninguna de las dos ramas en concreto.
- **No:** exigir siempre `vaccineName`, aunque venga la FK. Cuando la vacuna está codificada, el nombre ya lo da el maestro y obligar a copiarlo produciría transcripciones inventadas por el cliente.
- **No:** exigir nada más —lote, fecha, dosis—. Un notificador puede saber qué se administró sin tener el carné delante, y bloquear la notificación por un lote desconocido pierde el caso entero.
- **Sí:** solo `trim()` sobre `vaccineName`, desviándose de la regla de §11 que pide `toTitleCase` para nombres. Los nombres de vacuna son mayoritariamente siglas —`BCG`, `SRP`, `DPT`, `VPH`, `COVID-19 mRNA`— y `toTitleCase` las mutilaría a `Bcg` o `Covid-19 Mrna`, destruyendo el único valor que la columna tiene, que es reproducir lo que consta en el carné. Es la misma razón que F21 §6 dio para `medicationCode`, y aquí con más peso porque el campo **es** la copia de lo notificado. Hay un criterio de aceptación explícito —`"bcg"` sobre `BCG` **sí** escribe— para que nadie restaure la normalización de caja por simetría con F21.
- **Sí:** `normalizeText`, que convierte en `null` el texto que queda vacío tras el `trim()`. Un `whoCode: ""` es ausencia de código, no un código vacío, y guardarlo como cadena vacía dejaría dos representaciones del mismo hecho.
- **Sí:** normalizar **antes** de comparar en el diff. Sin eso, un `PUT` que reenvía el `GET` con espacios sobrantes contaría como cambio y dejaría auditoría por un valor que la base almacenaría idéntico.
- **Sí:** copiar `normalizeTime` y `normalizeText` a este servicio en vez de extraerlas a `stringHandling.helper.ts`. Es la segunda copia; extraer obliga a tocar `notificationEvent.service.ts` y mete F16 en el alcance. Es el criterio que F21 aplicó a `assertVaccinationSiteIsValid`, y sigue vigente: el refactor merece su propio spec cuando haya una tercera.

**Coherencia temporal**

- **Sí:** `vaccinationDate` no puede ser posterior a `esaviCase.eventDate`. Un ESAVI es por definición un evento posterior a la inmunización; una vacuna administrada después del evento que se le atribuye es un dato imposible, no un caso raro.
- **Sí:** comparar contra `esaviCase.eventDate` y **no** contra `notificationEvent.startDate`. La fecha del ESAVI es una sola y vive en el caso; los eventos notificados son los diagnósticos, son N, y su fecha responde otra pregunta. Comparar contra el mínimo de N fechas habría atado esta entidad a otra satélite hermana sin ninguna necesidad.
- **Sí:** el mismo día es válido. Una reacción inmediata se registra con la fecha de la vacunación, y exigir estrictamente posterior invalidaría los casos más agudos.
- **Sí:** la regla no aplica si falta cualquiera de las dos fechas. Es el caso corriente, no la excepción: las vacunas suelen cargarse antes de que el caso tenga `eventDate`.
- **No:** el espejo. Editar `esaviCase.eventDate` a una fecha anterior a una vacuna ya cargada seguirá pasando. Cerrarlo obliga a tocar `esaviCase.service.ts` y a decidir qué se hace con las filas que ya violan la regla — dos preguntas que merecen un spec de coherencia propio, y que este spec deja anotadas en vez de resolver a medias.
- **No:** ninguna regla sobre `expirationDate`. Una vacuna administrada después de caducar es precisamente el hallazgo que un ESAVI documenta; un 400 ahí impediría registrar el caso que motiva la notificación. Es la decisión que más fácil sería «arreglar» por parecer un descuido, y por eso está escrita.

**La tabla hija**

- **Sí:** volcar al log los `diluentId` que el `005C` destruye por cascada. Es la primera vez que una operación de este repositorio destruye filas de una tabla que nadie ha modelado; sin la línea, la destrucción no deja rastro en ningún sitio.
- **Sí:** consultarlos con `sequelize.query`. Modelar `notificationDiluent` solo para contarlo lo metería en el alcance de este spec y adelantaría decisiones —asociaciones, tipos, respuesta— que corresponden a su propio spec.
- **Sí:** escribir la línea **después** de que `purgeEntityService` devuelva sin error. Escribirla antes dejaría avisos de destrucciones que acaban en 409, que es peor que no avisar.
- **No:** bloquear con 409 la purga de una vacuna con diluyentes vivos. El `ON DELETE CASCADE` del DDL declara que los diluyentes no sobreviven a su vacuna; convertir eso en un bloqueo contradiría el esquema y obligaría a purgar a mano una tabla sin endpoints.
- **No:** volcar los diluyentes en la cascada de la cabecera. Ahí caen por un salto indirecto, y consultarlos exigiría a este spec una segunda consulta cruda sobre una tabla que no le pertenece. Los volcará el spec de `notificationDiluent`.
- **No:** arrastrar `isActive` de la vacuna a sus diluyentes. La visibilidad heredada lo resolverá su spec, igual que aquí se hereda de la cabecera.

**Estado, visibilidad y orden**

- **Sí:** adoptar la solución del `005B` de F16 sin re-razonarla. El choque entre trigger, índice parcial y `entityActivation.service.ts:34` es el mismo mecanismo sobre la misma configuración, ya verificado dos veces.
- **Sí:** el `005B` no revalida nada — ni el maestro, ni el contenido mínimo, ni la coherencia temporal. Reactivar es deshacer una desactivación, no reescribir la fila.
- **Sí:** sin arrastre de estado desde la cabecera. La visibilidad heredada ya oculta las vacunas de una notificación inactiva.
- **Sí:** sin comprobación de duplicados. Dos dosis de la misma vacuna, o dos lotes distintos, son un registro legítimo, y el DDL no declara ninguna `UNIQUE` que insinúe lo contrario.
- **Sí:** sin regla sobre `isSuspected`. Exigir al menos una sospechosa por notificación bloquearía el registro mientras la investigación decide, que es justo cuando los datos se cargan.
- **Sí:** una sola línea `warn` con conteo y `vaccineId` en la cascada de purga de la cabecera, junto a las de F16 y F21.

**Respuesta y modelo**

- **Sí:** devolver la FK cruda **y** el objeto resuelto, al modo de F16 y F21. El `004` acepta `vaccineWhodrugId` en el body, así que el criterio «un `PUT` que reenvía el `GET` no escribe nada» exige que esté en el `GET`.
- **Sí:** el maestro con tres campos —`vaccineWhodrugId`, `drugCode`, `drugName`—. Las otras veintiséis columnas son gobernanza del diccionario, no dato de la notificación, y quien las necesite entra por `ESAVI-WHODRUG-003`.
- **No:** incluir `notification` en la respuesta, aunque toda lectura la consulte. Se resuelve con dos atributos y se descarta.
- **Sí:** `vaccinationDate` y `vaccinationTime` en columnas separadas, porque el DDL las separa. La hora se desconoce con frecuencia y juntarlas obligaría a inventarla.
- **Sí:** `doseNumber` sin máximo. El DDL solo impone `>= 0`; un tope inventado rompería una pauta de refuerzos futura.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El cambio de tipo de `isSuspected` **no llega a una base ya desplegada**: `CREATE TABLE IF NOT EXISTS` no altera una tabla existente, así que reejecutar `esaviapp.sql` deja la columna como `answerOption` y el modelo escribe booleanos contra un ENUM | Declarado en §4, paso 2, con su verificación. Sobre una base ya cargada el cambio exige un `ALTER TABLE "notificationVaccine" ALTER COLUMN "isSuspected" ...` a mano, ejecutado antes de desplegar. La base de pruebas se recrea desde cero y no sufre el problema, así que **la suite no detectará este fallo**: es el único riesgo del spec que las pruebas no cubren |
| Alguien deriva `whoCode` o `vaccineName` del maestro «porque están vacíos y el dato existe» | §3.5 lo declara, §6 lo razona con la divergencia carné/diccionario, y hay un criterio de aceptación que exige que un `PUT` con solo la FK no reescriba los tres textos |
| Se aplica `toTitleCase` a `vaccineName` por seguir §11 o por simetría con `medicationName` de F21, y las siglas se mutilan | §6 razona la desviación y §5 la fija con el criterio de `"bcg"` sobre `BCG`, que exige que **sí** escriba: la caja se guarda como se notificó |
| La regla de coherencia temporal se implementa contra `notificationEvent.startDate` por parecer «la fecha del evento» | §3.5 y §6 dicen contra qué se compara y por qué; el criterio de aceptación exige que `grep` de `notificationEvent` en el servicio no devuelva nada |
| La regla se implementa como estrictamente posterior y una reacción inmediata queda bloqueada | Criterio de aceptación explícito: el mismo día responde **201** |
| El `005B` se implementa delegando sin más en `setEntityActiveStatusService` y el escenario de colisión produce 500 | El escenario está escrito paso a paso en el plan (§4, paso 15) y como criterio de aceptación con los cuatro movimientos literales. F16 lo verificó y F21 lo reconfirmó sobre la misma configuración |
| Alguien invierte los pasos 3 y 4 del `005B` porque «da igual el orden» | §3.5 y §6 dicen por qué no da igual: el índice único parcial no es diferible y el orden inverso falla en el propio `UPDATE` del helper |
| La guarda de contenido mínimo se evalúa sobre el body en el `004`, y un `PUT` que solo manda `vaccineName: null` vacía la fila | §3.5 exige evaluarla sobre el estado resultante; hay criterio de aceptación con las dos variantes, según la fila tenga o no la otra rama |
| El volcado de diluyentes se escribe antes del helper y deja avisos de purgas que acabaron en 409 | §3.5 fija el orden y §5 lo verifica: una purga que responde 409 no deja línea |
| Se modela `notificationDiluent` «ya que hay que contarlo» y el spec se dobla de tamaño | El conteo va por `sequelize.query`; hay criterio de aceptación que exige que `notificationDiluent` no aparezca en `src/models/`, `src/types/` ni `src/controllers/` |
| `GET /:id` captura `/case`, `/admin`, `/purge` o `/activate` como UUID | Las cinco literales se declaran antes que `/:id`, en el orden exacto de §3.4; cubierto por la suite de contrato |
| Dos altas concurrentes sobre la misma notificación reciben el mismo `sortOrder` | Lo resuelve `pg_advisory_xact_lock` dentro del trigger (`esaviapp.sql:179`); la aplicación no interviene |
| El maestro está vacío en un entorno nuevo y se interpreta como que la entidad no funciona | Es un estado previsto: sin importar el diccionario, las vacunas se notifican con `vaccineName` en texto crudo. Declarado en §2 como precondición de datos, no como bloqueo |

**§8 no aplica.** Este spec añade endpoints nuevos, corrige el tipo de una columna que ningún endpoint expone todavía y añade una línea de log en un servicio existente. Ningún status, campo ni mensaje que los clientes ya reciben cambia de forma.

---

## Lo que **no** está en este spec

- **Las otras tres satélites de `notification`:** `notificationDiluent` —hija de esta tabla, y el siguiente spec natural—, `notificationPregnancy` y `notificationPregnancyComplication`.
- **El espejo de la regla de coherencia temporal.** Editar `esaviCase.eventDate` o dar de alta un caso que contradiga una vacuna ya cargada seguirá pasando. Es un spec de coherencia posterior que deberá cubrir los dos lados a la vez.
- **Reordenar vacunas** — el `007` que mueva una fila de posición y desplace a sus hermanas. Cuando se escriba, debe cubrir también los eventos de F16 y los medicamentos de F21.
- **Cualquier resolución o acuñación contra `vaccineWhodrug`.** El maestro se puebla por importación (F19), no por formulario.
- **Derivar `whoCode`, `vaccineCode` o `vaccineName` del maestro.** Los tres son copia de lo notificado.
- **Arrastre de estado en cualquiera de los dos sentidos** — ni de la cabecera hacia las vacunas, ni de las vacunas hacia sus diluyentes.
- **Filtros de listado** por `isSuspected`, `vaccineWhodrugId`, `batchNumber`, fechas o texto sobre `vaccineName`.
- **Comprobación de duplicados** dentro de la misma notificación.
- **Cualquier regla sobre `expirationDate`**, incluida la vacuna caducada al administrarse.
- **Cualquier regla de negocio sobre `isSuspected`**, del tipo «al menos una sospechosa por notificación».
- **Extraer `normalizeTime` y `normalizeText` a un helper compartido.**
- **Modificar `esaviapp.sql` más allá de la línea de `isSuspected`**, `purgeEntityService` o `setEntityActiveStatusService`.
- Cifrado de ningún campo.
- Crear vacunas automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
