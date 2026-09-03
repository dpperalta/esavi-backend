# SPEC F24 — CRUD de `notificationDiluent`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F22 (`notificationVaccine` — dependencia dura de modelo: es el padre de la FK, la fuente del primer nivel de visibilidad heredada y quien dejó escrita la promesa que este spec salda)**, **SPEC F23 (`diluentCatalog` — dependencia dura de modelo: es el maestro que esta tabla referencia, y sin él la FK no apunta a nada)**, **SPEC F10 (`notification` — segundo nivel de la visibilidad heredada, y el servicio donde este spec añade la línea de log del segundo salto)**, SPEC F16 (`notificationEvent` — precedente del choque entre el trigger de `sortOrder` y la reactivación), SPEC F21 (`notificationMedication` — precedente del índice que falta sobre la FK), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa)
> **Fecha:** 2026-08-18
> **Objetivo:** Dar de alta `notificationDiluent` —el diluyente con el que se reconstituyó cada vacuna notificada— como la sexta tabla satélite de `notification`, primera nieta del grafo y primera consumidora del maestro `diluentCatalog`.

---

## 1. Por qué existe este spec

`notificationDiluent` es la **sexta de las ocho tablas satélite de `notification`** que recibe implementación, y la **cuarta de la familia «uno a muchos con estado y orden propios»** que abrió F16. Con ella, la rama de la vacunación queda cerrada: qué se administró lo guarda [F22](./22-notificationvaccine-crud.md), y con qué se reconstituyó lo guarda esta tabla.

Guarda **con qué se diluyó el vial**: el diluyente, su lote, su caducidad, y la fecha y hora en que se reconstituyó. [F23](./23-diluentcatalog-crud.md) §1 razonó por qué eso importa —un ESAVI puede deberse a que se reconstituyó con el diluyente equivocado, con uno de otro fabricante, o con uno cuya cadena de frío se rompió— y dejó dicho que `notificationDiluent` era «la siguiente satélite natural de la cadena». Este spec es esa cadena.

Hoy la tabla existe en `esaviapp.sql:864-883` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**A — Es una copia estructural de `notificationVaccine`, un nivel más abajo.** PK propia `diluentId` con `gen_random_uuid()` (`:865`), FK `NOT NULL` con `ON DELETE CASCADE` (`:866`, `:881`), FK nullable al maestro con `ON DELETE RESTRICT` (`:867`, `:882`), `sortOrder` gobernado por trigger (`:868`, registrado en `:1313`), las seis transversales completas (`:875-880`), y ausencia de `preventPhysicalDelete` (`:1361-1375`) que habilita el `005C`. De ahí salen las **mismas ocho operaciones canónicas** de F22, con los mismos roles y la misma forma de ruta. La única diferencia de superficie es de menos: **no hay `006`**, y la razón está en §6.

**B — Hereda el hallazgo del `005B`, sin variación.** F16 §1.C documentó que `setSortOrderByParent` es `BEFORE INSERT` **solamente** (`:1323`), que respeta un `sortOrder` recibido mayor que 0 (`:169-171`) y que si no calcula `COALESCE(MAX("sortOrder"), 0) + 1 ... WHERE "deletedAt" IS NULL` (`:182-188`) bajo `pg_advisory_xact_lock` (`:180`); que el índice único parcial `UQ_notificationDiluent_parent_sortOrder` (`:1341-1343`) se condiciona también a `deletedAt IS NULL`; y que `setEntityActiveStatusService:34` reactiva limpiando `deletedAt`. Las tres piezas producen el mismo choque, y este spec **no vuelve a razonarlo**: adopta la solución de F16 —reasignar `sortOrder` a `MAX+1` antes de tocar `deletedAt`—, ya verificada allí y reconfirmada en F21 y F22.

**C — Le falta el índice sobre su FK, y es el mismo hueco que F21 encontró.** `notificationEvent` (`:812`), `notificationMedication` —tras F21— y `notificationVaccine` (`:862`) tienen todas su `IX_*` sobre la columna padre. `notificationDiluent` **no**, y sus dos endpoints de lectura filtran exclusivamente por `vaccineId`. Este spec añade `IX_notificationDiluent_vaccine`, y es su **único** cambio sobre `esaviapp.sql`.

**D — Es la primera nieta del grafo, y ahí está lo único estructuralmente nuevo.** Sus cinco hermanas mayores cuelgan directamente de `notification`, así que su visibilidad heredada era un salto. Aquí son dos: `notificationDiluent → notificationVaccine → notification`. Un diluyente perfectamente activo es invisible si su vacuna fue retirada, y también si la notificación entera lo fue. Es la primera vez que el repositorio compone la regla en cadena, y la razón por la que toda lectura de esta entidad lleva un `include` anidado.

**E — Es la primera y única consumidora de `diluentCatalog`, y el maestro fue diseñado para ella.** F23 §1 citó `notificationDiluent.diluentCatalogId` (`:867`) como **la única** FK entrante que justificaba su existencia, y anticipó textualmente el patrón: la FK nullable representa «notificado pero sin codificar», y los dos campos de texto —`diluentName` y `diluentCode` (`:873-874`)— conservan lo que el notificador transcribió del vial aunque el maestro se renombre después. **No hay resolución implícita:** F23 §6 descartó expresamente un equivalente al `ESAVI-DIAGTERM-006`, porque un diluyente es un producto físico con composición declarada y no una descripción que el notificador acuñe. La consecuencia práctica es que aquí **ningún campo es derivado**: los dos textos son del cliente y nunca se copian del maestro.

**F — Es hoja del grafo, y eso simplifica su `005C`.** Nada cuelga de `notificationDiluent`. Su borrado físico destruye una fila y ninguna más, así que —a diferencia del `005C` de F22— **no vuelca ninguna cascada al log**: no hay nada que volcar.

**G — Salda una promesa escrita.** F22 §2 dejó dicho, palabra por palabra, que los `notificationDiluent` que caen en el segundo salto de la cascada de `ESAVI-NOTIFCN-005C` «no se vuelcan ahí; los volcará el spec de esa tabla». Este es ese spec, y la línea se añade en `src/services/notification.service.ts`, junto a las tres que F16, F21 y F22 ya dejaron.

**Y lo que hace única a esta tabla entre las seis satélites ya especificadas.** Sus **siete columnas de datos son opcionales sin excepción** —siete anulables, ni una booleana con defecto—, así que el DDL admite una fila que solo dice «esta vacuna llevó un diluyente» sin decir cuál. Es el mismo agujero que F22 encontró, y aquí es más ancho: allí quedaba `isSuspected` como dato mínimo garantizado, y aquí no queda nada. De ahí sale la única guarda de contenido que este spec añade: al menos uno de `diluentCatalogId` o `diluentName`.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `notificationDiluent`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones canónicas y ninguna más:** `001` crear, `002A` listar activos por vacuna, `002B` listar todos por vacuna, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar y `005C` borrado físico. **Sin `006`** — la razón está en §6.
- **Un solo cambio en `esaviapp.sql`:** añadir `IX_notificationDiluent_vaccine` sobre `("vaccineId")`, el índice que la tabla no tiene y que sus dos listados necesitan. Es la corrección que F21 hizo para `notificationMedication`, aplicada aquí por el mismo motivo.
- **Relación uno a muchos con `notificationVaccine`.** No hay límite de diluyentes por vacuna ni `UNIQUE` que lo imponga. Los listados se entran por la FK —`/vaccine/:id`— y nunca por `/`.
- **Guarda del alta:** la vacuna existe y está **activa**, y su notificación existe y está **activa** → 404 `NOTIFDIL_001_VACCINE_NOT_FOUND`. Los dos niveles se comprueban en la misma consulta, con un `include` anidado.
- **Guarda de contenido mínimo**, en `001` y en `004` sobre el estado resultante: debe haber **al menos uno** de `diluentCatalogId` o `diluentName` → 400 `NOTIFDIL_<op>_DILUENT_REQUIRED`. Es la única defensa contra la fila vacía que el DDL admite, y respeta el diseño «codificado **o** crudo» que F23 §1 fijó para esta tabla.
- **Validación de la FK al maestro en `001` y en `004`:** `diluentCatalogId` debe existir y estar **activo** → 404 `NOTIFDIL_<op>_CATALOG_NOT_FOUND`.
  - Es **opcional**: ausente o `null`, no se valida nada y el diluyente queda sin codificar, que es un estado legítimo.
  - Corre **antes del diff y con independencia de él**: un `PUT` con un diluyente del maestro desactivado responde 404 aunque ningún otro campo cambie.
  - **En lectura no se filtra por `isActive`.** Una entrada retirada del maestro después del registro sigue viajando resuelta en la respuesta: es la asimetría que F14 razonó y que F21, F22 y F23 repitieron.
- **Regla de coherencia temporal**, en `001` y en `004` sobre el estado resultante: `reconstitutionDate` no puede ser **posterior** a `notificationVaccine.vaccinationDate` → 400 `NOTIFDIL_<op>_RECONSTITUTION_AFTER_VACCINATION`. Un vial se reconstituye antes o el mismo día en que se administra, nunca después. La comprobación es de **un solo salto** —al padre directo— y no llega a `esaviCase`. **No aplica** si falta cualquiera de las dos fechas.
- **Visibilidad heredada en cadena, a dos niveles.** Toda lectura incluye `vaccine` y, dentro, `notification`: si cualquiera de las dos está inactiva, el diluyente responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Aplica a `002A`, `002B`, `003` y `004`. Es lo único estructuralmente nuevo del spec.
- **`sortOrder` inmutable y asignado por la base.** El `001` nunca lo envía y usa `fields: CREATE_FIELDS`. El `004` lo ignora en silencio, sin 400. No aparece en el tipo de entrada.
- **Reasignación de `sortOrder` en `ESAVI-NOTIFDIL-005B`** cuando el número que ocupaba la fila ya lo tomó otro diluyente vivo de la misma vacuna. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación **no** delega sin más en `setEntityActiveStatusService`. La solución es la de F16, verificada allí y reconfirmada en F21 y F22.
- **`005C` sin volcado de cascada.** `notificationDiluent` es hoja del grafo: nada cuelga de ella y su destrucción no arrastra ninguna fila. `purgeEntityService` se usa sin modificación y sin ninguna consulta previa.
- **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`, saldando la promesa de F22 §2:** una sola línea en nivel `warn` con el conteo y la lista de `diluentId` que la cascada arrastra en el **segundo salto** —`notification → notificationVaccine → notificationDiluent`—, junto a las tres que F16, F21 y F22 ya dejaron. Implica tocar `src/services/notification.service.ts` solo en ese punto.
- **`005A` y `005B` no se bloquean por nada.** No hay hijos que consultar ni estado que arrastrar.
- **Normalización al escribir: solo `trim()`** sobre `diluentName`, `diluentCode` y `batchNumber`, con `normalizeText` —un texto que queda vacío es texto ausente—. `reconstitutionTime` se normaliza con una copia local de `normalizeTime`. La desviación de §11 —que pediría `toTitleCase` para un nombre— se razona en §6.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` de §3.5: `vaccineId` y `sortOrder` inmutables, siete campos comparados, **ninguno derivado**.
- Alta de la abreviatura **`NOTIFDIL`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **169 a 177**— y suite `tests/contract/notificationDiluent.test.ts`.

**Precondiciones de datos** (no son parte de la implementación):

- **`diluentCatalog` necesita una entrada «Desconocido».** La guarda de contenido mínimo obliga a identificar el diluyente de algún modo, y un notificador puede saber que el vial se reconstituyó sin saber con qué. Sin esa fila, el único camino que le queda es escribir texto libre en `diluentName`, que es precisamente lo que el maestro existe para evitar. Es una fila que se carga por `ESAVI-DILUENT-001`, no código que este spec escriba, y por eso va aquí y no en el plan de implementación.
- El resto de `diluentCatalog` se puebla a mano, como F23 §2 decidió. Sobre una base con el maestro vacío, toda escritura que mande `diluentCatalogId` cae en 404 — pero eso **no bloquea el registro**: el diluyente se notifica con `diluentName` en texto crudo y la fila queda sin codificar, que es exactamente el estado que el esquema previó.

**Fuera de alcance (otros specs):**

- **Las dos satélites de `notification` que quedan:** `notificationPregnancy` (`esaviapp.sql:885-902`) y `notificationPregnancyComplication` (`904-925`). Con este spec, la rama de la vacunación queda cerrada y solo queda la del embarazo.
- **Cualquier forma de `006`.** Ni «listar los diluyentes de un caso» ni «los de una notificación»: la cadena es un abanico de dos niveles y aplanarla mezcla filas de vacunas distintas sin un orden que las gobierne. Se entra por `vaccineId`, que el `002A` de `NOTIFVAC` ya devuelve. Razonado en §6.
- **El espejo de la regla de coherencia temporal.** Editar `notificationVaccine.vaccinationDate` a una fecha anterior a un diluyente ya cargado **seguirá pasando**: validarlo obliga a tocar `notificationVaccine.service.ts` y a decidir qué hacer con las filas que ya violan la regla. Es la misma deuda que F22 §2 dejó abierta para `esaviCase.eventDate`, y el spec de coherencia que la cierre deberá cubrir los dos pares a la vez.
- **Reordenar diluyentes** — el `007` que mueva una fila de posición y desplace a sus hermanas. Es la misma operación pendiente para eventos (F16), medicamentos (F21) y vacunas (F22); cuando se escriba debe cubrir las cuatro entidades.
- **Cualquier resolución o acuñación contra `diluentCatalog`.** No hay un `ESAVI-DILUENT-006` al estilo de `DIAGTERM-006`, y F23 §6 decidió que no lo haya.
- **Derivar `diluentName` o `diluentCode` del maestro** cuando llega la FK. Los dos son copia de lo transcrito del vial y el servicio no los toca.
- **Reescribir la consulta cruda de `notificationVaccine.service.ts`.** El `005C` de F22 cuenta los `diluentId` con `sequelize.query` porque esta tabla no tenía modelo. Ahora lo tendrá, pero cambiar esa consulta mete el servicio de F22 en el alcance sin ganar nada: la línea de log ya funciona y su criterio de aceptación sigue verde.
- **Arrastre de estado, en los dos sentidos.** Desactivar una vacuna no toca sus diluyentes; desactivar un diluyente no toca nada. La visibilidad heredada ya resuelve la lectura.
- **Cualquier filtro de listado** por `diluentCatalogId`, `batchNumber`, fechas o texto sobre `diluentName`. Los dos listados devuelven todos los diluyentes de su vacuna, paginados y ordenados por `sortOrder`.
- **Cualquier comprobación de duplicados.** El mismo diluyente puede repetirse en una vacuna: dos lotes o dos reconstituciones distintas son un registro legítimo.
- **Cualquier regla sobre `expirationDate`.** Un diluyente usado después de caducar es precisamente el hallazgo que un ESAVI documenta; validarlo con un 400 impediría registrar el caso que motiva la notificación. Es la decisión de F22 §6, palabra por palabra.
- **La compatibilidad clínica entre un diluyente y una vacuna.** No hay tabla puente en el esquema; F23 §2 ya lo dejó fuera y este spec no lo recupera.
- **Extraer `normalizeTime` y `normalizeText` a un helper compartido.** Es la cuarta copia; el refactor tendrá su propio spec, y hacerlo aquí metería tres servicios ajenos en el alcance.
- **Modificar `esaviapp.sql` más allá del índice nuevo**: ni el trigger de `sortOrder`, ni el índice único parcial, ni los `CHECK`, ni ningún `ON DELETE`, ni ninguna columna.
- **Modificar `purgeEntityService` ni `setEntityActiveStatusService`.** Sirven tal cual.
- Cifrado de ningún campo. Ninguna columna de esta tabla es PII del paciente.
- Crear diluyentes automáticamente al dar de alta una vacuna.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`notificationDiluent` — `esaviapp.sql:864-883`. **Se le añade una línea:** el índice sobre la FK.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `diluentId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()` (`:865`) |
| `vaccineId` | `uuid` | no | `FK_notificationDiluent_vaccine` → `notificationVaccine`, `ON DELETE CASCADE` (`:866`, `:881`). **Sin índice — lo añade este spec** |
| `diluentCatalogId` | `uuid` | sí | `FK_notificationDiluent_catalog` → `diluentCatalog`, `ON DELETE RESTRICT` (`:867`, `:882`). Nulo = «notificado sin codificar» |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)` (`:868`). Lo asigna el trigger; la aplicación no lo envía |
| `batchNumber` | `varchar(250)` | sí | Lote del diluyente, no el de la vacuna (`:869`) |
| `expirationDate` | `date` | sí | Sin regla que la cruce con nada (`:870`) |
| `reconstitutionDate` | `date` | sí | Entra en la regla de coherencia temporal (`:871`) |
| `reconstitutionTime` | `time` | sí | Se normaliza a `HH:MM:SS` antes de comparar (`:872`) |
| `diluentName` | `varchar(250)` | sí | Copia de lo transcrito del vial, sin derivar del maestro (`:873`) |
| `diluentCode` | `varchar(250)` | sí | Ídem (`:874`) |

**Siete columnas de datos, las siete anulables. Ninguna obligatoria, y ni una booleana con defecto.** Es el DDL más permisivo de las seis satélites especificadas —más aún que el de F22, donde `isSuspected` garantizaba al menos un dato— y el origen de la guarda de contenido mínimo de §2.

**Restricciones.** Dos claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla** — la única unicidad de negocio vive fuera, en el índice parcial `UQ_notificationDiluent_parent_sortOrder` (`:1341-1343`) sobre `("vaccineId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `B` de §1.

La FK a `diluentCatalog` es `ON DELETE RESTRICT`, así que un diluyente notificado impide borrar físicamente su entrada del maestro — irrelevante en la práctica, porque `diluentCatalog` figura en `preventPhysicalDelete` (`:1361-1375`) y F23 decidió no darle `005C`.

**La línea que se añade.** `CREATE INDEX IF NOT EXISTS "IX_notificationDiluent_vaccine" ON "notificationDiluent" ("vaccineId");`, inmediatamente después del `CREATE TABLE`, en la misma forma y posición que `IX_notificationVaccine_notification` (`:862`). Es el **único** cambio de este spec sobre el DDL. A diferencia del cambio de tipo de F22, **un índice sí se propaga a una base ya desplegada** reejecutando el fichero: `CREATE INDEX IF NOT EXISTS` es idempotente y no depende de `CREATE TABLE IF NOT EXISTS`.

**Las columnas transversales.** Están las seis: `isActive` (`:875`), `createdAt` (`:876`), `updatedAt` (`:877`), `deletedAt` (`:878`), `sysDetails` (`:879`) y `appDetails` (`:880`).

**Triggers.** Dos, los dos de bucle genérico. `TRG_notificationDiluent_setSysDetails` (`:1280-1295`). Y `TRG_notificationDiluent_setSortOrder` (`:1302-1329`, registrado en `:1313`), que ejecuta `setSortOrderByParent('vaccineId')` **solo `BEFORE INSERT`** (`:1323`): respeta un `sortOrder` recibido si es mayor que 0 (`:169-171`) y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre (`:182-188`), bajo `pg_advisory_xact_lock` (`:180`). **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla no figura en `esaviapp.sql:1361-1375`, así que un `DELETE` físico ejecuta y le corresponde `005C`.

**Sin tabla hija.** Nada referencia `diluentId`. Es hoja del grafo, y de ahí sale la simplificación de su `005C`.

**`reconstitutionDate` y `reconstitutionTime` en columnas separadas.** El DDL las parte y este spec no las junta, por la misma razón que F22 no juntó `vaccinationDate` y `vaccinationTime`: la hora se desconoce con frecuencia. La regla de coherencia temporal opera **solo sobre la fecha** — `notificationVaccine.vaccinationDate` es `date` y no hay hora con la que comparar, aunque la vacuna sí tenga `vaccinationTime`.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationDiluent.model.ts`. Clase `NotificationDiluent`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationDiluent'`.

`diluentId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `vaccineId` va `DataTypes.UUID` con `allowNull: false`; `diluentCatalogId`, `DataTypes.UUID` con `allowNull: true`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, exactamente como F16, F21 y F22 §3.2. Declararle `defaultValue: 0` haría que el `INSERT` mandara `0` explícito —el valor que el trigger interpreta como «asígnamelo tú» (`:169`)—, que funcionaría por accidente.

> **Nota de implementación.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere en la aplicación con `notNull Violation: NotificationDiluent.sortOrder cannot be null` y el trigger nunca llega a ejecutarse. Lo que deja la columna fuera de la sentencia es pasar la lista explícita al `create` — `NotificationDiluent.create({ ... }, { fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y sin `sortOrder` ni `diluentId`. Es el remedio que F16 verificó y que F21 y F22 reconfirmaron; no se re-descubre.

Longitudes explícitas, para que un texto largo falle en Sequelize y no en Postgres: `batchNumber`, `diluentName` y `diluentCode` van `DataTypes.STRING(250)` — las tres, porque el DDL les da la misma anchura.

`expirationDate` y `reconstitutionDate` van `DataTypes.DATEONLY` — el helper de diff ya compara `DATEONLY` con `slice(0, 10)`. `reconstitutionTime` va `DataTypes.TIME`.

**Ninguna columna booleana de datos.** `isActive` es la transversal de siempre y no forma parte del cuerpo de la entidad.

Asociaciones, en `src/models/associations/notificationDiluent.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationDiluent.belongsTo(NotificationVaccine, { as: 'vaccine', foreignKey: 'vaccineId' })`
- `NotificationVaccine.hasMany(NotificationDiluent, { as: 'diluents', foreignKey: 'vaccineId' })`
- `NotificationDiluent.belongsTo(DiluentCatalog, { as: 'diluentCatalog', foreignKey: 'diluentCatalogId' })`

El `hasMany` **sí** se declara: lo necesita el volcado al log de la cascada de purga de la cabecera, que salta `notification → vaccines → diluents`. **Ningún inverso `hasMany` desde `DiluentCatalog`**: F23 §3.2 dejó esa entidad deliberadamente **sin archivo de asociaciones** por no tener FK salientes, y ésta es su primera FK entrante; se declara del lado que posee la clave, como F22 hizo con `VaccineWhodrug`. Alta en `src/models/index.ts` y en el barrel de asociaciones.

**El `include` anidado de la visibilidad heredada** se apoya en la asociación `vaccine` de arriba más la `notification` que F22 ya declaró: `include: [{ model: NotificationVaccine, as: 'vaccine', attributes: ['vaccineId', 'isActive', 'vaccinationDate'], include: [{ model: Notification, as: 'notification', attributes: ['notificationId', 'isActive'] }] }]`. Ninguna asociación nueva hace falta para eso — se compone con las que ya existen, y `vaccinationDate` viaja en el mismo `include` para que la regla temporal no cueste una segunda consulta.

### 3.3 Tipos

Ruta: `src/types/notificationDiluent/notificationDiluent.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts`.

```ts
export interface CreateNotificationDiluentInput {
    vaccineId: string;
    diluentCatalogId?: string | null;
    batchNumber?: string | null;
    expirationDate?: string | null;
    reconstitutionDate?: string | null;
    reconstitutionTime?: string | null;
    diluentName?: string | null;
    diluentCode?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationDiluentInput>`. **No se declara `UpdateNotificationDiluentInput`** — prohibido por §4 de las convenciones.

Una sola ausencia deliberada: **`sortOrder` no está**. Es inmutable y lo asigna la base; que no exista en el tipo es la garantía más barata de que ningún servicio lo mande.

**Ningún campo de entrada que no sea columna.** Las ocho claves de entrada son las ocho columnas escribibles. La interfaz es plana y no hay nada que descartar antes del `create`.

**Los siete campos de datos son opcionales en el tipo, y eso es fiel al DDL.** La guarda de contenido mínimo —al menos `diluentCatalogId` o `diluentName`— vive en el servicio y no en el tipo, porque en el `004` se evalúa sobre el **estado resultante** y TypeScript no puede expresar esa condición.

### 3.4 Superficie HTTP

Ruta base `/api/notification-diluents`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-diluents                     ESAVI-NOTIFDIL-001   USER        (nuevo)
GET    /api/notification-diluents/admin/vaccine/:id   ESAVI-NOTIFDIL-002B  ADMIN       (nuevo)
GET    /api/notification-diluents/vaccine/:id         ESAVI-NOTIFDIL-002A  USER        (nuevo)
DELETE /api/notification-diluents/purge/:id           ESAVI-NOTIFDIL-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-diluents/activate/:id        ESAVI-NOTIFDIL-005B  SUPERADMIN  (nuevo)
GET    /api/notification-diluents/:id                 ESAVI-NOTIFDIL-003   USER        (nuevo)
PUT    /api/notification-diluents/:id                 ESAVI-NOTIFDIL-004   ADMIN       (nuevo)
DELETE /api/notification-diluents/:id                 ESAVI-NOTIFDIL-005A  ADMIN       (nuevo)
```

**Orden de declaración.** Las literales van **antes** de `/:id`, o Express capturaría `admin`, `vaccine`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las ocho están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationDiluent.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `HFAC`, `NOTIFEVT`, `NOTIFMED` y `NOTIFVAC`, no la de `GEOTYPE`.

**Ocho operaciones y ninguna no canónica.** Es la primera de la familia sin `006`, y por tanto **la primera que no añade fila a la tabla de operaciones no canónicas de §6**.

Ocho filas nuevas en `ROUTE_RULES`: de **169** a **177**.

### 3.5 Reglas de negocio por operación

**`ESAVI-NOTIFDIL-001` — crear.** En este orden:

1. La vacuna existe y está **activa**, y su notificación existe y está **activa** → 404 `NOTIFDIL_001_VACCINE_NOT_FOUND`. Una sola consulta con el `include` anidado de §3.2, que trae además `vaccinationDate` para el paso 4.
2. **Contenido mínimo:** si no llega `diluentCatalogId` ni `diluentName` con valor no nulo → 400 `NOTIFDIL_001_DILUENT_REQUIRED`.
3. **Maestro**, solo si `diluentCatalogId` llega con valor no nulo: `DiluentCatalog.findOne({ where: { diluentCatalogId, isActive: true } })`; si no hay fila → 404 `NOTIFDIL_001_CATALOG_NOT_FOUND`. Basta el `findOne` sobre la propia tabla: `diluentCatalog` es un maestro autónomo que no cuelga de ningún `catalogType`, así que aquí **no** aplica el patrón de doble salto de F14 y F21.
4. **Coherencia temporal**, solo si `reconstitutionDate` llega con valor y la vacuna tiene `vaccinationDate`: si `reconstitutionDate > vaccine.vaccinationDate` → 400 `NOTIFDIL_001_RECONSTITUTION_AFTER_VACCINATION`. Con cualquiera de las dos fechas ausente, no se comprueba nada.
5. Normalización: `normalizeText` sobre `diluentName`, `diluentCode` y `batchNumber` —`trim()`, y un texto que queda vacío es texto ausente—; `normalizeTime` sobre `reconstitutionTime`. **Ningún `toTitleCase`.**
6. `create` **sin `sortOrder`**, con `fields: CREATE_FIELDS`, para que lo asigne `TRG_notificationDiluent_setSortOrder`.
7. Entrada de auditoría en `appDetails` con `method: 'ESAVI-NOTIFDIL-001'`.

**No hay transacción propia.** Como en F21 y F22, aquí no se escribe en ninguna otra tabla: el `001` es un `create` único y la transacción implícita de Sequelize basta.

**`ESAVI-NOTIFDIL-002A` — listar activos por vacuna.** La vacuna existe y está activa, y su notificación también, salvo `canViewInactive` → 404 `NOTIFDIL_002A_VACCINE_NOT_FOUND`. `findAndCountAll` con `where: { vaccineId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query.

**`ESAVI-NOTIFDIL-002B` — listar todos por vacuna.** Idéntico, sin el filtro `isActive` y con `paranoid: false`. Rol ADMIN.

**`ESAVI-NOTIFDIL-003` — obtener por ID.** Existencia → 404 `NOTIFDIL_003_NOT_FOUND`. Incluye `vaccine` y, dentro, `notification`: si **cualquiera de las dos** está inactiva y quien pide no cumple `canViewInactive`, **404**. Un diluyente inactivo también es 404 salvo `canViewInactive`. Las tres condiciones se evalúan igual y ninguna tiene prioridad sobre otra: basta que una falle.

**`ESAVI-NOTIFDIL-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'NOTIFDIL_005A_NOT_FOUND'`, `alreadyInStateCode: 'NOTIFDIL_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-NOTIFDIL-005A'`. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial. Es correcto y deliberado. **No consulta nada más:** la tabla es hoja y no hay hijos que bloqueen.

**`ESAVI-NOTIFDIL-005B` — reactivar.** **La única operación de este spec que no es una delegación limpia**, por el hallazgo `B` de §1. En transacción propia:

1. `NotificationDiluent.findOne({ where: { diluentId: id }, paranoid: false, transaction })`. Si no hay fila, se pasa directo al paso 4 y el helper levanta el 404.
2. Si la fila existe y está inactiva, se busca colisión: otra fila de la **misma** vacuna, con el **mismo** `sortOrder`, con `deletedAt: null` y `diluentId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa vacuna —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que esta escritura es libre. El diluyente reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'NOTIFDIL_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-NOTIFDIL-005B'`, que limpia `deletedAt` con el `sortOrder` ya corregido.

Si la fila estaba **activa**, el paso 2 no encuentra colisión —el índice garantiza que ninguna otra fila viva comparte su número— así que no se escribe nada y el helper levanta su 409 con normalidad.

El orden de los pasos 3 y 4 es la clave entera: invertirlos hace fallar el índice en el propio `UPDATE` del helper, porque no es una restricción diferible y no hay forma de corregir después. **La reactivación no revalida nada más:** ni el maestro, ni el contenido mínimo, ni la coherencia temporal, ni el estado de la vacuna padre. Reactivar es deshacer una desactivación, no reescribir la fila.

**`ESAVI-NOTIFDIL-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'NOTIFDIL_005C_NOT_FOUND'` y `stillActiveCode: 'NOTIFDIL_005C_STILL_ACTIVE'`. La guarda es la canónica de §6 sobre la **propia fila**: debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la vacuna ni el de la notificación.** Sin entrada en `appDetails` —la fila se destruye en la misma transacción— y con el volcado a `warn` que el helper ya escribe.

**Sin consulta previa y sin línea de cascada.** Es la diferencia con el `005C` de F22: aquella tenía una tabla hija que contar, y ésta no tiene ninguna. `purgeEntityService` se invoca directamente.

**`ESAVI-NOTIFDIL-004` — actualizar.** Existencia → 404 `NOTIFDIL_004_NOT_FOUND`, incluida la visibilidad heredada a dos niveles. Después, y **antes del diff y con independencia de él**, las tres guardas del `001` evaluadas sobre el **estado resultante** —lo guardado fundido con lo que llega—, nunca sobre el body: contenido mínimo → 400 `NOTIFDIL_004_DILUENT_REQUIRED`; maestro, solo si `diluentCatalogId` llega con valor no nulo → 404 `NOTIFDIL_004_CATALOG_NOT_FOUND`; coherencia temporal contra la `vaccinationDate` que ya trae el `include` → 400 `NOTIFDIL_004_RECONSTITUTION_AFTER_VACCINATION`. `stored` sale de `diluent.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `vaccineId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `diluentCatalogId` | `data.diluentCatalogId !== undefined ? (data.diluentCatalogId ?? null) : undefined` | anulable; validado antes del diff |
| `batchNumber` | `data.batchNumber !== undefined ? normalizeText(data.batchNumber) : undefined` | anulable; solo `trim()` |
| `expirationDate` | `data.expirationDate !== undefined ? (data.expirationDate ?? null) : undefined` | `DATEONLY`; el helper compara con `slice(0, 10)` |
| `reconstitutionDate` | `data.reconstitutionDate !== undefined ? (data.reconstitutionDate ?? null) : undefined` | `DATEONLY`; validada antes del diff |
| `reconstitutionTime` | `data.reconstitutionTime !== undefined ? normalizeTime(data.reconstitutionTime) : undefined` | anulable; `'09:15'` se rellena a `'09:15:00'` **antes** de comparar |
| `diluentName` | `data.diluentName !== undefined ? normalizeText(data.diluentName) : undefined` | anulable; **sin `toTitleCase`** |
| `diluentCode` | `data.diluentCode !== undefined ? normalizeText(data.diluentCode) : undefined` | anulable; solo `trim()` |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**Siete campos comparados y ninguno derivado.** Es la consecuencia directa de la decisión de §6: los dos textos son copia de lo transcrito del vial y el servicio jamás los rellena desde `diluentCatalog`. Un `PUT` que solo manda la FK **no** reescribe `diluentName` ni `diluentCode`.

**Escrituras que no son diferenciales, declaradas una a una:**

- **El `001`** — es un `create`.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: este diluyente vuelve a estar vivo y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005C`** — destruye la fila, y no arrastra ninguna otra.

**Este spec no escribe en ninguna otra tabla**, ni por cambio de valor ni por presencia de clave. Lo único que toca fuera de `notificationDiluent` es una línea de log en la cascada de purga de la cabecera.

### 3.6 Claves i18n nuevas

Bajo `notificationDiluent`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationDiluent.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente |
| `notificationDiluent.idRequired` | 400 del validador de `:id` |
| `notificationDiluent.vaccineNotFound` | 404 cuando la vacuna no existe o está inactiva, o su notificación lo está |
| `notificationDiluent.catalogNotFound` | 404 cuando la entrada del maestro no existe o está inactiva |
| `notificationDiluent.diluentRequired` | 400 cuando no hay ni `diluentCatalogId` ni `diluentName` |
| `notificationDiluent.reconstitutionAfterVaccination` | 400 cuando `reconstitutionDate` es posterior a la `vaccinationDate` de la vacuna |
| `notificationDiluent.stillActive` | 409 al purgar un diluyente que no fue retirado antes |
| `notificationDiluent.createdSuccess` / `createdFailed` | 201 y 500 del `001` |
| `notificationDiluent.getSuccess` / `getFailed` | 200 y 500 de `002A`, `002B` y `003` |
| `notificationDiluent.updatedSuccess` / `updatedFailed` | 200 y 500 del `004` |
| `notificationDiluent.deletedSuccess` / `deletedFailed` | 200 y 500 del `005A` |
| `notificationDiluent.activatedSuccess` / `activatedFailed` | 200 y 500 del `005B` |
| `notificationDiluent.alreadyActive` / `alreadyInactive` | 409 de `005B` y `005A` |
| `notificationDiluent.purgeSuccess` / `purgeFailed` | 200 y 500 del `005C` |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `003`, `001` y `004`, `data` es la fila con su entrada de maestro resuelta:

```
{ ok, message, data: {
    diluentId, vaccineId, diluentCatalogId, sortOrder,
    batchNumber, expirationDate,
    reconstitutionDate, reconstitutionTime,
    diluentName, diluentCode,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    diluentCatalog: { diluentCatalogId, code, name } | null
} }
```

**La FK cruda viaja junto al objeto resuelto.** Es el patrón de F16, F21 y F22: el `004` acepta `diluentCatalogId` en el body, así que un `PUT` que reenvía la respuesta de su `GET` necesita encontrarla ahí. Excluirla obligaría al cliente a leer el id de dentro del objeto anidado, y el criterio de aceptación del update diferencial dejaría de poder escribirse tal cual.

El maestro se incluye **sin filtrar por `isActive`**: una entrada retirada después del registro sigue diciendo con qué se reconstituyó. Se devuelve con tres campos —`diluentCatalogId`, `code`, `name`— y **sin `composition` ni `description`**; quien necesite la ficha entera entra por `ESAVI-DILUENT-003`.

**`vaccine` y `notification` no se incluyen en la respuesta**, aunque toda lectura las consulte para la visibilidad heredada y para la regla temporal. Se resuelven con `attributes` acotados —`['vaccineId', 'isActive', 'vaccinationDate']` y `['notificationId', 'isActive']`— y se descartan al construir el payload: el cliente que necesite la vacuna entra por `ESAVI-NOTIFVAC-003` y la cabecera por `ESAVI-NOTIFCN-003`.

En `002A` y `002B`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente. `sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura.** Añadir la fila `notificationDiluent | NOTIFDIL` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6. **No hay fila que añadir a la tabla de operaciones no canónicas**: este spec no declara ninguna. La norma exige registrar **antes** de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla de abreviaturas de §6 contiene la fila nueva; `NOTIFDIL` no aparece dos veces y no colisiona con `NOTIFCN`, `NOTIFEVT`, `NOTIFMED`, `NOTIFVAC`, `NOTIFIER` ni `DILUENT`; la tabla de operaciones no canónicas queda **sin cambios**.

2. **Índice sobre la FK en `esaviapp.sql`.** Añadir `CREATE INDEX IF NOT EXISTS "IX_notificationDiluent_vaccine" ON "notificationDiluent" ("vaccineId");` inmediatamente después del `CREATE TABLE` de `:883`, en la misma forma y posición que `IX_notificationVaccine_notification` (`:862`). Es el único cambio de este spec sobre el DDL y va antes que el modelo, para que la base de pruebas ya lo tenga cuando corra la primera suite.
   *Verificación:* `git diff esaviapp.sql` muestra **una sola línea añadida y ninguna modificada**; tras recrear la base de pruebas, `pg_indexes` devuelve `IX_notificationDiluent_vaccine` y `UQ_notificationDiluent_parent_sortOrder` para esa tabla. A diferencia del cambio de tipo de F22, reejecutar el fichero **sí** propaga este cambio a una base ya desplegada: `CREATE INDEX IF NOT EXISTS` es idempotente y no depende del `CREATE TABLE`.

3. **Modelo y asociaciones.** `src/models/notificationDiluent.model.ts` según §3.2, y `src/models/associations/notificationDiluent.associations.ts` con las tres asociaciones. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` en 0; un `NotificationDiluent.findAll({ include: ['vaccine', 'diluentCatalog'] })` desde el REPL devuelve filas sin error de asociación; un `include` anidado `vaccine → notification` también; `grep -rn "hasMany" src/models/associations/diluentCatalog*` no devuelve resultados —ese archivo no existe y no se crea—.

4. **Tipos.** `src/types/notificationDiluent/notificationDiluent.types.ts` con `CreateNotificationDiluentInput`, más su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateNotificationDiluentInput" src/` no devuelve resultados; `grep -n "sortOrder" src/types/notificationDiluent/notificationDiluent.types.ts` no devuelve **ningún campo**.

5. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0.

6. **Validadores.** `src/validators/notificationDiluent.validator.ts` con el validador de creación, el de actualización, el de `:id` y el del `vaccineId` de ruta. Longitudes máximas iguales a las del DDL —250 en los tres textos—, las dos fechas en formato ISO, `reconstitutionTime` admitiendo `HH:MM` y `HH:MM:SS`, `diluentCatalogId` como UUID opcional y anulable. **`sortOrder` no se declara en ningún validador.** Alta en el barrel de `validators/`.
   *Verificación:* un body con `sortOrder: 5` no produce 400 y el campo se ignora; un `diluentName` de 251 caracteres produce 400; un `diluentCatalogId: null` explícito **no** produce 400; `reconstitutionTime: '09:15'` **no** produce 400.

7. **`ESAVI-NOTIFDIL-001` — crear.** `createNotificationDiluentService` con los siete pasos de §3.5, incluidos el `include` anidado del padre y el `fields: CREATE_FIELDS` del `create`. Controlador y ruta `POST /`.
   *Verificación:* crear con `diluentName` y sin FK devuelve 201 con `diluentCatalog: null`; crear con una FK del maestro **activa** devuelve 201 con los tres campos resueltos; crear sin `diluentName` y sin FK devuelve **400**; crear con una FK del maestro desactivada devuelve **404**; crear sobre una vacuna inactiva devuelve **404**; crear sobre una vacuna activa cuya **notificación** está inactiva devuelve **404**; tres altas seguidas sobre la misma vacuna reciben `sortOrder` 1, 2 y 3 sin que el servicio lo envíe.

8. **La regla de coherencia temporal.** Dentro del mismo `001`, el paso 4 de §3.5. Se implementa como una función local del servicio, compartida después por el `004`.
   *Verificación:* sobre una vacuna con `vaccinationDate: '2026-08-10'`, crear con `reconstitutionDate: '2026-08-11'` devuelve **400**; con `'2026-08-10'` devuelve **201** —el mismo día es el caso normal, no la excepción—; con `'2026-08-09'` devuelve 201; sobre una vacuna con `vaccinationDate: null`, cualquier `reconstitutionDate` devuelve 201; sin `reconstitutionDate`, también. El servicio **no consulta `esaviCase`**.

9. **`ESAVI-NOTIFDIL-002A` — listar activos por vacuna.** Servicio, controlador y ruta `GET /vaccine/:id`, declarada después de `/admin/vaccine/:id`.
   *Verificación:* devuelve `{ count, rows }` ordenado por `sortOrder`; un diluyente desactivado desaparece del listado; una vacuna inactiva devuelve 404 para USER; una vacuna activa con notificación inactiva también.

10. **`ESAVI-NOTIFDIL-002B` — listar todos por vacuna.** Servicio con `paranoid: false`, ruta `GET /admin/vaccine/:id` con `validateUserRole(ADMIN)`.
    *Verificación:* el mismo listado del paso anterior incluye el diluyente desactivado; un USER recibe 403.

11. **`ESAVI-NOTIFDIL-003` — obtener por ID, con la visibilidad heredada en cadena.** Servicio con el `include` anidado de §3.2 y las tres condiciones sin prioridad entre ellas. Ruta `GET /:id` declarada **después** de todas las literales.
    *Verificación:* `GET /api/notification-diluents/activate/algo` responde 400 de UUID y no 404 de diluyente; un diluyente cuya **vacuna** está inactiva devuelve 404 para ADMIN y 200 para SUPERADMIN; un diluyente cuya **notificación** está inactiva —con la vacuna activa— devuelve lo mismo; un diluyente inactivo con los dos padres activos, también.

12. **`ESAVI-NOTIFDIL-004` — actualizar.** `buildDifferentialUpdate` con la tabla de `candidates` de §3.5, y las tres guardas previas al diff evaluadas sobre el estado resultante. Ruta `PUT /:id`.
    *Verificación:* un `PUT` que reenvía la respuesta del `GET` responde 200 sin escribir; un `PUT` con `diluentName: null` sobre una fila **sin** FK responde 400; un `PUT` con `reconstitutionTime: '09:15'` sobre un `'09:15:00'` guardado **no** escribe; un `PUT` con una entrada de maestro inactiva responde 404 aunque el resto del body sea idéntico.

13. **`ESAVI-NOTIFDIL-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, ruta `DELETE /:id`.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409; desactivar no toca ninguna otra tabla.

14. **`ESAVI-NOTIFDIL-005B` — reactivar.** Los cuatro pasos de §3.5, en transacción propia. Ruta `PATCH /activate/:id`.
    *Verificación:* el escenario del hallazgo `B` —crear tres diluyentes, desactivar el tercero, crear un cuarto que recibe el `sortOrder` 3, reactivar el tercero— responde **200** y deja el reactivado con `sortOrder: 4`; reactivar uno sin colisión **no** mueve su `sortOrder`; reactivar uno cuya entrada de maestro se desactivó entretanto responde **200**; reactivar uno cuya vacuna se desactivó entretanto también responde **200**; reactivar uno ya activo devuelve 409.

15. **`ESAVI-NOTIFDIL-005C` — borrado físico.** `purgeEntityService` sin modificarlo y **sin ninguna consulta previa**: la tabla es hoja y no hay cascada que volcar. Ruta `DELETE /purge/:id` declarada antes de `/:id`.
    *Verificación:* purgar un diluyente activo devuelve 409; purgar uno desactivado con su vacuna activa devuelve 200; la fila desaparece de la base; `git diff --stat src/services/common/entityPurge.service.ts` no muestra cambios; el servicio no contiene ninguna llamada a `sequelize.query`.

16. **Volcado al log en la cascada de `ESAVI-NOTIFCN-005C`.** En `src/services/notification.service.ts`, junto a las tres líneas que F16, F21 y F22 dejaron para eventos, medicamentos y vacunas, y antes del `destroy` de la notificación, **una sola línea** `warn` con el conteo y la lista de `diluentId` que la cascada arrastra en el segundo salto. Se resuelve con el `hasMany` declarado en el paso 3 —`notification → vaccines → diluents`—, sin SQL crudo. Es el único punto de este spec que toca un servicio ajeno, y salda la promesa de F22 §2.
    *Verificación:* purgar una notificación con dos vacunas que suman tres diluyentes deja **una** línea con los tres `diluentId`, y siguen apareciendo las de eventos, medicamentos y vacunas; purgar una notificación cuyas vacunas no tienen diluyentes no deja esa línea; `git diff src/services/notificationVaccine.service.ts` no muestra cambios — la consulta cruda de F22 se queda como está.

17. **Cubrir las ocho rutas en `tests/auth/roles.test.ts`.** Ocho filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **169 a 177** en la aserción de longitud.
    *Verificación:* `npm test -- roles` en 0.

18. **Suite `tests/contract/notificationDiluent.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar por vacuna → listar admin → actualizar → desactivar → reactivar → purgar. Más los caminos de error: 404 de vacuna inactiva, 404 de notificación inactiva con vacuna activa, 404 de maestro inactivo, 400 de contenido mínimo, 400 de coherencia temporal, 409 de purga sobre fila activa, y los cinco casos de update diferencial de §5. Bloque aparte para el escenario de colisión de `sortOrder` del paso 14.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

- [ ] Las ocho rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones — cuatro en el `005C`, que no escribe auditoría.
- [ ] `grep -rn "ESAVI-NOTIFDIL-002[^AB]" src/` no devuelve resultados.
- [ ] `grep -rn "ESAVI-NOTIFDIL-006" src/ references/` no devuelve resultados — este spec no declara ninguna operación no canónica.
- [ ] `references/CONVENTIONS.md` §6 contiene la fila `notificationDiluent | NOTIFDIL`, y su tabla de operaciones no canónicas queda **sin cambios**.
- [ ] `ROUTE_RULES` tiene 177 filas y la aserción de longitud de `tests/auth/roles.test.ts` espera ese número.

**DDL:**

- [ ] `git diff esaviapp.sql` muestra **exactamente una línea añadida y ninguna modificada**, la del índice.
- [ ] Sobre la base de pruebas recreada, `pg_indexes` devuelve `IX_notificationDiluent_vaccine` y `UQ_notificationDiluent_parent_sortOrder` para esa tabla.
- [ ] Reejecutar `esaviapp.sql` sobre una base **ya cargada** crea el índice sin error y sin tocar ninguna fila.

**Maestro `diluentCatalog`:**

- [ ] Crear con un `diluentCatalogId` **inactivo** responde **404**, no 201.
- [ ] Crear con un `diluentCatalogId` inexistente responde **404**.
- [ ] Crear solo con `diluentName`, sin FK, responde **201** con `diluentCatalog: null`.
- [ ] Crear sin `diluentName` y sin `diluentCatalogId` responde **400**.
- [ ] Un `PUT` con `diluentCatalogId: null` explícito sobre una fila que **sí** tiene `diluentName` borra la FK y devuelve `diluentCatalog: null`; sobre una fila **sin** `diluentName` responde **400**.
- [ ] Desactivar la entrada del maestro **después** del registro no rompe el `GET`: la fila sigue devolviendo el objeto resuelto con sus tres campos.
- [ ] Un `PUT` que solo manda `diluentCatalogId` **no** reescribe `diluentName` ni `diluentCode`: ningún campo se deriva del maestro.
- [ ] La respuesta del maestro trae exactamente tres campos: `grep -n "composition\|description" src/services/notificationDiluent.service.ts` no devuelve resultados.
- [ ] `git diff --stat src/services/diluentCatalog.service.ts` no muestra cambios.

**Coherencia temporal:**

- [ ] Sobre una vacuna con `vaccinationDate: '2026-08-10'`, crear con `reconstitutionDate: '2026-08-11'` responde **400**.
- [ ] Con la misma vacuna, `reconstitutionDate: '2026-08-10'` responde **201** — el mismo día es el caso normal, no una excepción tolerada.
- [ ] Sobre una vacuna con `vaccinationDate: null`, cualquier `reconstitutionDate` responde **201**.
- [ ] Un diluyente sin `reconstitutionDate` responde **201** sea cual sea la `vaccinationDate` de la vacuna.
- [ ] Un `PUT` que mueve `reconstitutionDate` más allá de la `vaccinationDate` responde **400** aunque el resto del body no cambie nada.
- [ ] El servicio **no consulta `esaviCase`**: `grep -n "esaviCase\|EsaviCase" src/services/notificationDiluent.service.ts` no devuelve resultados — la regla es de un solo salto.
- [ ] `git diff --stat src/services/notificationVaccine.service.ts src/services/esaviCase.service.ts` no muestra cambios — el espejo de la regla queda fuera de alcance.

**Visibilidad heredada en cadena:**

- [ ] Un diluyente cuya **vacuna** está inactiva responde 404 en `003` para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] Un diluyente cuya **notificación** está inactiva, con la vacuna activa, responde exactamente lo mismo. Son dos escenarios distintos y los dos están montados en la suite.
- [ ] Un diluyente inactivo con los dos padres activos, también.
- [ ] Crear un diluyente sobre una vacuna inactiva responde 404; sobre una vacuna activa con notificación inactiva, también.
- [ ] Los dos listados aplican la misma cadena: `002A` sobre una vacuna cuya notificación está inactiva responde 404 para USER.
- [ ] `GET /api/notification-diluents/activate/algo` responde 400 de UUID, no 404 de diluyente.

**Orden y estado:**

- [ ] Tres altas seguidas sobre la misma vacuna reciben `sortOrder` 1, 2 y 3 sin que ningún servicio envíe el campo.
- [ ] `grep -n "sortOrder" src/types/notificationDiluent/notificationDiluent.types.ts` no devuelve **ningún campo**.
- [ ] Un `PUT` con `sortOrder: 99` en el body responde 200 y deja el `sortOrder` guardado intacto, sin 400.
- [ ] **Escenario de colisión:** crear tres diluyentes, desactivar el tercero, crear un cuarto —que recibe `sortOrder: 3`—, y reactivar el tercero responde **200** y lo deja con `sortOrder: 4`.
- [ ] Reactivar un diluyente cuyo `sortOrder` sigue libre responde 200 y **no** mueve su `sortOrder`.
- [ ] Reactivar un diluyente cuya entrada de maestro se desactivó entretanto responde **200**, y lo mismo si fue su vacuna la que se desactivó — el `005B` no revalida nada.
- [ ] Purgar un diluyente desactivado cuya vacuna está **activa** responde 200.
- [ ] Purgar un diluyente activo responde **409**.
- [ ] `git diff --stat src/services/common/entityPurge.service.ts src/services/common/entityActivation.service.ts` no muestra cambios.

**Hoja del grafo:**

- [ ] El `005C` no ejecuta ninguna consulta previa: `grep -n "sequelize.query" src/services/notificationDiluent.service.ts` no devuelve resultados.
- [ ] Purgar un diluyente no deja ninguna línea `warn` de cascada — solo el volcado de la fila que `purgeEntityService` ya escribe.
- [ ] Desactivar una vacuna con diluyentes vivos sigue respondiendo **200** y no toca su `isActive`: el criterio que F22 fijó sigue verde.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/notificationDiluent.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

Sobre el último: en esta entidad **no hay `code` propio ni 409 de duplicado** —`diluentCode` es texto libre y se admite repetido, y no hay `UNIQUE` en la tabla—, así que el ítem se cumple por su primera mitad: un `PUT` con un `diluentCatalogId` inactivo responde **404** aunque ningún otro campo cambie. La segunda mitad no aplica y se anota como tal, no se borra. Es la misma situación que F22 dejó escrita.

- [ ] Un `PUT` con `diluentName: "  Agua estéril  "` sobre un `Agua estéril` guardado responde **200 sin escribir** — el `trim()` corre antes de comparar.
- [ ] Un `PUT` con `diluentName: "agua estéril"` sobre un `Agua estéril` guardado **sí escribe**: no hay `toTitleCase` ni ninguna otra normalización de caja, y el nombre se guarda como el notificador lo transcribió del vial.
- [ ] Un `PUT` con `reconstitutionTime: '09:15'` sobre un `'09:15:00'` guardado responde **200 sin escribir**.
- [ ] Un `PUT` con `diluentCode: ""` sobre un `diluentCode` guardado lo deja en `null` — `normalizeText` convierte el texto vacío en ausencia.
- [ ] Un `PUT` que solo cambia `batchNumber` deja `diluentCatalogId`, las tres fechas y `reconstitutionTime` idénticos.

**Cierre:**

- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] Purgar una notificación con dos vacunas que suman tres diluyentes deja **una** línea `warn` con los tres `diluentId`, y las de eventos, medicamentos y vacunas siguen apareciendo.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Superficie y numeración**

- **Sí:** `NOTIFDIL`, ocho letras. `DILUENT` está tomada por `diluentCatalog` desde F23, y reutilizarla haría indistinguibles el maestro y la notificación en el código de operación, que es exactamente lo que la tabla de §6 existe para evitar. `NOTIFDIL` mantiene el prefijo que ya identifica a la familia (`NOTIFCN`, `NOTIFEVT`, `NOTIFMED`, `NOTIFVAC`).
- **Sí:** las ocho operaciones canónicas de F22. La tabla tiene `isActive`, PK propia y no figura en `preventPhysicalDelete`, así que se derivan del esquema. Es la cuarta entidad idéntica en forma: inventar aquí una superficie distinta obligaría a leer dos patrones donde el DDL declara uno.
- **No:** un `006`, en ninguna de sus dos formas. «Listar los diluyentes de un caso» y «los de una notificación» aplanan un abanico de dos niveles: devuelven filas de vacunas distintas mezcladas, y el `sortOrder` —que es relativo a **su** vacuna— deja de ordenar nada. Habría que inventar un orden compuesto que ninguna otra entidad tiene. Sus cuatro hermanas sí tienen `006` porque su cadena hasta el caso es uno a uno en todos los saltos menos el último; ésta es la primera en que hay dos saltos N, y ahí la operación deja de tener sentido. Se entra por `vaccineId`, que el `002A` de `NOTIFVAC` ya devuelve.
- **Sí:** listado por FK, `/vaccine/:id`, nunca `/`. Un diluyente notificado no existe sin su vacuna, y un listado global no tiene lector.
- **Sí:** ruta base `/api/notification-diluents`, en plural con guiones y con el nombre completo de la tabla. F23 se desvió a `/api/diluents` porque el sufijo `Catalog` no aporta nada a un cliente; aquí el prefijo `notification-` **sí** distingue, y sin él las dos entidades competirían por el mismo espacio de nombres.

**El DDL y el índice**

- **Sí:** añadir `IX_notificationDiluent_vaccine`. Es el mismo hueco que F21 encontró en `notificationMedication`: sus tres hermanas lo tienen y ella no, y los dos endpoints de lectura filtran exclusivamente por esa columna. Un índice de una línea evita un `Seq Scan` sobre una tabla que crece con cada vacuna notificada.
- **No:** ningún otro cambio de DDL. Ni el trigger, ni el índice único parcial, ni los `CHECK`, ni ninguna columna. A diferencia de F22, aquí no hay ningún tipo mal elegido que corregir: las siete columnas de datos son `varchar`, `date` y `time`, y ninguna intenta ser un ENUM.
- **Sí:** aprovechar que un `CREATE INDEX IF NOT EXISTS` **sí** se propaga reejecutando el fichero. F22 tuvo que declarar en §7 el riesgo de que su `ALTER` no llegara a una base desplegada; este spec no lo arrastra, y conviene dejar dicho por qué para que nadie generalice aquel riesgo a todo cambio de DDL.

**El maestro `diluentCatalog`**

- **Sí:** FK opcional. F23 §1 lo dejó escrito antes de que esta tabla se especificara: la FK nula representa «notificado pero sin codificar», y la notificación **no se bloquea** por no estar codificada.
- **Sí:** exigir `isActive: true` al escribir y **no** filtrar por `isActive` al leer. Es la asimetría que F14 razonó y que F21, F22 y F23 repitieron: elegir hoy una entrada retirada es un error, pero haberla elegido ayer es un hecho.
- **Sí:** validar con un `findOne` sobre la propia tabla, sin doble salto contra `catalogType`. `diluentCatalog` es un maestro autónomo y no cuelga de ningún tipo de catálogo.
- **No:** derivar `diluentName` o `diluentCode` del maestro cuando llega la FK. Es la decisión de F22 §6 sobre los textos de la vacuna, y aquí vale igual: si el vial dice una cosa y el catálogo otra, la notificación tiene que poder decir las dos. El efecto práctico es que **ningún campo es derivado** y el `004` es el caso limpio de F12, con siete candidatos y ninguno calculado.
- **No:** una resolución implícita al estilo de `ESAVI-DIAGTERM-006`, que acuñase la entrada del maestro cuando el notificador escribe un diluyente que no está. F23 §6 ya lo descartó: un diluyente es un producto físico con composición declarada, no una descripción que el notificador acuñe.
- **No:** el inverso `hasMany` desde `DiluentCatalog`. F23 §3.2 dejó esa entidad deliberadamente sin archivo de asociaciones, y esta primera FK entrante se declara del lado que posee la clave, como F22 hizo con `VaccineWhodrug`.
- **Sí:** devolver el maestro con tres campos y **sin `composition`**. Es tentador incluirla —es el dato clínicamente relevante de un diluyente, no gobernanza como las 26 columnas de WHODrug—, pero la respuesta de una notificación dice **qué se usó**, no la ficha del producto; quien la necesite entra por `ESAVI-DILUENT-003`, y así el payload no crece cada vez que el maestro gana una columna.

**Contenido mínimo**

- **Sí:** exigir al menos uno de `diluentCatalogId` o `diluentName`. El DDL admite una fila que solo dice «esta vacuna llevó un diluyente» sin decir cuál, y eso no es un registro: es ruido con `sortOrder`. Aquí el agujero es más ancho que en F22 —allí quedaba `isSuspected` como dato mínimo garantizado, y aquí no queda nada—, así que la guarda pesa más.
- **Sí:** resolver el caso «se reconstituyó pero no sé con qué» con una entrada **«Desconocido» en el maestro**, no relajando la guarda. Es la decisión de fondo del spec: obliga a que la ignorancia se registre como un valor explícito y contable, en vez de como una fila vacía indistinguible de un error de carga. Si un porcentaje alto de notificaciones apunta a «Desconocido», eso es un hallazgo de calidad del dato que una fila vacía nunca habría producido.
- **No:** exigir siempre `diluentName`, aunque venga la FK. Cuando el diluyente está codificado, el nombre ya lo da el maestro y obligar a copiarlo produciría transcripciones inventadas por el cliente.
- **No:** exigir nada más —lote, caducidad, fecha de reconstitución—. Un notificador puede saber con qué se reconstituyó sin tener el vial delante, y bloquear la notificación por un lote desconocido pierde el caso entero.

**Normalización**

- **Sí:** solo `trim()` sobre `diluentName`, desviándose de la regla de §11 que pide `toTitleCase` para nombres. Es la misma razón que F21 y F22 dieron: el campo **es** la copia de lo notificado, y su único valor es reproducir lo que consta en el vial. Hay un criterio de aceptación explícito —`"agua estéril"` sobre `Agua estéril` **sí** escribe— para que nadie restaure la normalización de caja por simetría con las entidades de catálogo.
- **Sí:** `normalizeText`, que convierte en `null` el texto que queda vacío tras el `trim()`. Un `diluentCode: ""` es ausencia de código, no un código vacío.
- **Sí:** normalizar **antes** de comparar en el diff. Sin eso, un `PUT` que reenvía el `GET` con espacios sobrantes contaría como cambio y dejaría auditoría por un valor que la base almacenaría idéntico.
- **Sí:** copiar `normalizeTime` y `normalizeText` a este servicio, por cuarta vez. F22 §6 dijo que el refactor merecía su propio spec «cuando haya una tercera», y ésta es la cuarta — pero extraerlas ahora obliga a tocar tres servicios ajenos dentro de un CRUD, que es exactamente el criterio que hizo aplazarlo las tres veces anteriores. Lo que cambia es que ya no es una previsión: **el refactor está vencido**, y queda anotado como riesgo en §7 en vez de como intención en §2.

**Coherencia temporal**

- **Sí:** `reconstitutionDate` no puede ser posterior a `notificationVaccine.vaccinationDate`. Un vial se reconstituye antes o el mismo día en que se administra; reconstituirlo después del pinchazo es un dato imposible, no un caso raro.
- **Sí:** un solo salto, al padre directo, **sin llegar a `esaviCase`**. Si `vaccinationDate` ya es coherente con `eventDate` por la regla de F22, y `reconstitutionDate` lo es con `vaccinationDate`, la transitividad hace el resto. Añadir aquí la comprobación contra el caso duplicaría una validación existente y ataría esta entidad a una tabla tres saltos más arriba.
- **Sí:** el mismo día es válido, y aquí es el **caso normal**, no una tolerancia. Un vial se reconstituye minutos antes de administrarse; la excepción es que las fechas difieran.
- **Sí:** la regla no aplica si falta cualquiera de las dos fechas.
- **No:** el espejo. Editar `notificationVaccine.vaccinationDate` a una fecha anterior a un diluyente ya cargado seguirá pasando. Es la misma deuda que F22 dejó abierta hacia `esaviCase`, y ya son dos pares esperando el mismo spec de coherencia; cerrarla a medias aquí produciría una regla que se cumple en un sentido y no en el otro.
- **No:** ninguna regla sobre `expirationDate`. Un diluyente usado después de caducar es precisamente el hallazgo que un ESAVI documenta. Es la decisión de F22 §6, y es la que más fácil sería «arreglar» por parecer un descuido.

**Hoja del grafo, estado y visibilidad**

- **Sí:** un `005C` sin consulta previa ni línea de cascada. Nada cuelga de esta tabla. Copiar el `005C` de F22 con su `sequelize.query` produciría una consulta que siempre devuelve vacío, y hay un criterio de aceptación por ausencia para impedirlo.
- **Sí:** saldar la promesa de F22 §2 y volcar los `diluentId` del segundo salto en la cascada de `ESAVI-NOTIFCN-005C`. Sin esa línea, purgar una notificación destruye diluyentes sin dejar rastro en ningún sitio — que es justo lo que F22 evitó para las vacunas.
- **Sí:** resolver ese volcado con el `hasMany` y un `include` anidado, no con SQL crudo. F22 usó `sequelize.query` porque esta tabla no tenía modelo; ahora lo tiene, y el motivo desapareció.
- **No:** reescribir la consulta cruda que F22 dejó en su propio `005C`. Ahora podría usar el modelo, pero cambiarla mete el servicio de F22 en el alcance sin ganar nada: la línea funciona y su criterio de aceptación sigue verde.
- **Sí:** visibilidad heredada a dos niveles, evaluada sin prioridad entre las tres condiciones. Basta que una falle, y así no hay que decidir qué mensaje gana cuando fallan dos.
- **No:** conformarse con comprobar solo la vacuna. Sería más barato en una consulta, pero dejaría visible un diluyente cuya notificación entera fue retirada, y la regla de visibilidad dejaría de ser transitiva justo donde el grafo se hace profundo. Esta tabla es la primera nieta; si aquí se rompe la cadena, las de investigación —que llegan a tres niveles— nacerán rotas.
- **Sí:** adoptar la solución del `005B` de F16 sin re-razonarla. El choque entre trigger, índice parcial y `entityActivation.service.ts:34` es el mismo mecanismo sobre la misma configuración, ya verificado tres veces.
- **Sí:** el `005B` no revalida nada — ni el maestro, ni el contenido mínimo, ni la coherencia temporal, ni el estado de la vacuna. Reactivar es deshacer una desactivación, no reescribir la fila.
- **Sí:** sin arrastre de estado en ninguno de los dos sentidos. La visibilidad heredada ya resuelve la lectura.
- **Sí:** sin comprobación de duplicados. Dos lotes distintos, o dos reconstituciones del mismo diluyente, son un registro legítimo, y el DDL no declara ninguna `UNIQUE` que insinúe lo contrario.
- **Sí:** `reconstitutionDate` y `reconstitutionTime` en columnas separadas, porque el DDL las separa. La hora se desconoce con frecuencia y juntarlas obligaría a inventarla.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El maestro no tiene la entrada «Desconocido» el día del despliegue** y la guarda de contenido mínimo se vuelve un muro: el notificador que sabe que hubo diluyente pero no cuál acaba escribiendo texto libre en `diluentName`, que es lo que el maestro existe para evitar | Declarado en §2 como precondición de datos, con su razón. Es el único riesgo del spec que **no se cierra con código ni con pruebas**: la fila se carga por `ESAVI-DILUENT-001` antes de abrir el endpoint, y conviene verificarlo en el mismo despliegue |
| **El refactor de `normalizeTime` y `normalizeText` está vencido.** Ésta es la cuarta copia; F22 §6 dijo que la tercera lo justificaba y se aplazó igual. Cada copia nueva abarata seguir copiando y encarece extraer | Anotado aquí en vez de en §2: ya no es una previsión sino una deuda. El spec que la cierre tendrá que tocar cuatro servicios a la vez, y ese coste solo crece. Conviene abrirlo antes de la quinta satélite |
| Alguien deriva `diluentName` o `diluentCode` del maestro «porque están vacíos y el dato existe» | §3.5 lo declara, §6 lo razona con la divergencia vial/catálogo, y hay un criterio de aceptación que exige que un `PUT` con solo la FK no reescriba los dos textos |
| Se aplica `toTitleCase` a `diluentName` por seguir §11 o por simetría con las entidades de catálogo | §6 razona la desviación y §5 la fija con el criterio de `"agua estéril"` sobre `Agua estéril`, que exige que **sí** escriba |
| **La visibilidad heredada se implementa a un solo nivel** —solo la vacuna— porque el `include` anidado es incómodo, y un diluyente de una notificación retirada queda visible | §3.5 exige los dos niveles y §5 los verifica **por separado**: vacuna inactiva y notificación inactiva con vacuna activa son dos escenarios distintos, y los dos están montados en la suite. §6 explica por qué importa: las tablas de investigación llegan a tres niveles |
| **El `005C` se copia entero desde F22**, con su `sequelize.query` incluida, y queda una consulta que siempre devuelve vacío | Criterio de aceptación por ausencia: `grep -n "sequelize.query" src/services/notificationDiluent.service.ts` no debe devolver resultados |
| Ahora que la tabla tiene modelo, alguien «mejora» la consulta cruda del `005C` de F22 y mete ese servicio en el alcance | Declarado en §2 como fuera de alcance y razonado en §6; hay criterio de aceptación que exige que `git diff src/services/notificationVaccine.service.ts` no muestre cambios |
| **Se añade un bloqueo al `005A` de la vacuna** —«no desactivar una vacuna con diluyentes vivos»— ahora que esta tabla es visible desde el código | §5 vigila hacia arriba: desactivar una vacuna con diluyentes vivos debe seguir respondiendo **200**. El criterio que F22 fijó tiene que seguir verde |
| La regla de coherencia temporal se implementa contra `esaviCase.eventDate` por parecer «la fecha del caso» | §3.5 y §6 dicen contra qué se compara y por qué es un solo salto; el criterio de aceptación exige que `grep` de `esaviCase` en el servicio no devuelva nada |
| La regla se implementa como estrictamente anterior y una reconstitución el mismo día queda bloqueada — que aquí es el caso **normal**, no la excepción | Criterio de aceptación explícito: el mismo día responde **201** |
| El `005B` se implementa delegando sin más en `setEntityActiveStatusService` y el escenario de colisión produce 500 | El escenario está escrito paso a paso en el plan (§4, paso 14) y como criterio de aceptación con los cuatro movimientos literales. F16 lo verificó y F21 y F22 lo reconfirmaron sobre la misma configuración |
| Alguien invierte los pasos 3 y 4 del `005B` porque «da igual el orden» | §3.5 y §6 dicen por qué no da igual: el índice único parcial no es diferible y el orden inverso falla en el propio `UPDATE` del helper |
| La guarda de contenido mínimo se evalúa sobre el body en el `004`, y un `PUT` que solo manda `diluentName: null` vacía la fila | §3.5 exige evaluarla sobre el estado resultante; hay criterio de aceptación con las dos variantes, según la fila tenga o no la otra rama |
| `GET /:id` captura `/admin`, `/vaccine`, `/purge` o `/activate` como UUID | Las cuatro literales se declaran antes que `/:id`, en el orden exacto de §3.4; cubierto por la suite de contrato |
| Dos altas concurrentes sobre la misma vacuna reciben el mismo `sortOrder` | Lo resuelve `pg_advisory_xact_lock` dentro del trigger (`esaviapp.sql:180`); la aplicación no interviene |
| Se reutiliza la abreviatura `DILUENT` y los códigos del maestro y de la notificación se vuelven indistinguibles | El paso 1 del plan da de alta `NOTIFDIL` **antes** de escribir código, y §5 verifica que la fila existe y no colisiona |

**§8 no aplica.** Este spec añade endpoints nuevos, añade un índice que ningún endpoint expone y añade una línea de log en un servicio existente. Ningún status, campo ni mensaje que los clientes ya reciben cambia de forma.

---

## Lo que **no** está en este spec

- **Las dos satélites de `notification` que quedan:** `notificationPregnancy` (`esaviapp.sql:885-902`) y `notificationPregnancyComplication` (`904-925`). Con este spec la rama de la vacunación queda cerrada y solo queda la del embarazo.
- **Cualquier forma de `006`** — ni «listar los diluyentes de un caso» ni «los de una notificación». Se entra por `vaccineId`.
- **El espejo de la regla de coherencia temporal.** Editar `notificationVaccine.vaccinationDate` a una fecha anterior a un diluyente ya cargado seguirá pasando. Ya son dos pares —éste y el de F22 hacia `esaviCase`— esperando un spec de coherencia que cubra los dos sentidos.
- **Reordenar diluyentes** — el `007` que mueva una fila de posición y desplace a sus hermanas. Cuando se escriba, debe cubrir también los eventos de F16, los medicamentos de F21 y las vacunas de F22.
- **Cualquier resolución o acuñación contra `diluentCatalog`.** El maestro se puebla a mano, como F23 decidió.
- **Derivar `diluentName` o `diluentCode` del maestro.** Los dos son copia de lo transcrito del vial.
- **Reescribir la consulta cruda del `005C` de `notificationVaccine`**, aunque ahora esta tabla tenga modelo.
- **Cargar la entrada «Desconocido» en `diluentCatalog`.** Es una precondición de datos que se resuelve con `ESAVI-DILUENT-001`, no código que este spec escriba.
- **Arrastre de estado en cualquiera de los dos sentidos** — ni de la vacuna hacia los diluyentes, ni de los diluyentes hacia nada.
- **Filtros de listado** por `diluentCatalogId`, `batchNumber`, fechas o texto sobre `diluentName`.
- **Comprobación de duplicados** dentro de la misma vacuna.
- **Cualquier regla sobre `expirationDate`**, incluido el diluyente caducado al reconstituir.
- **La compatibilidad clínica entre un diluyente y una vacuna.** No hay tabla puente en el esquema.
- **Extraer `normalizeTime` y `normalizeText` a un helper compartido**, aunque el refactor esté vencido y así conste en §7.
- **Modificar `esaviapp.sql` más allá del índice nuevo**, `purgeEntityService` o `setEntityActiveStatusService`.
- Cifrado de ningún campo.
- Crear diluyentes automáticamente al dar de alta una vacuna.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
