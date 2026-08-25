# SPEC F37 — CRUD de `investigationVaccineAdministered`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — padre de la FK, y de quien esta tabla hereda su visibilidad)**, **SPEC F31 (`investigationTeamMember` — hermana estructural exacta: aporta el patrón completo de satélite-colección con `isActive` y `sortOrder`)**, **SPEC F18 (`vaccineWhodrug` — el maestro que resuelve `vaccineWhodrugId`)**, SPEC F19 (importación que puebla ese maestro), SPEC F22 (`notificationVaccine` — primera consumidora del maestro, aporta la forma del `include` y del 404), SPEC F35 (`evaluationInstitution` — aporta el tratamiento del `sortOrder` anulable sin `DEFAULT`), SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-24
> **Objetivo:** Dar de alta `investigationVaccineAdministered` —el listado de vacunas que la investigación registra como administradas, con su número de dosis— como la **séptima** satélite directa de `investigation` con spec propio y la **segunda** de ellas que es una colección y no un uno a uno.

---

## 1. Por qué existe este spec

`investigationVaccineAdministered` responde al bloque del formulario de investigación que enumera **qué se administró**. No describe el evento ni la jornada: describe el conjunto de vacunas puestas, cada una con su dosis de la pauta. Es una lista, no una ficha.

Hoy la tabla existe en `esaviapp.sql:1157-1172` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **séptima de las once satélites directas de `investigation`** que recibe spec propio, después del [SPEC F29](./29-investigationsource-crud.md), el [SPEC F30](./30-investigationautopsy-crud.md), el [SPEC F31](./31-investigationteammember-crud.md), el [SPEC F32](./32-investigationmedicalhistory-crud.md), el [SPEC F34](./34-investigationclinicalevaluation-crud.md) y el [SPEC F36](./36-investigationvaccinationcontext-crud.md).

**De forma es hermana de F31 y de nadie más.** De las once satélites directas, **solo dos son colecciones**: `investigationTeamMember` y ésta. Las nueve restantes tienen `investigationId` como clave primaria y son uno a uno. La consecuencia es que este spec **no** hereda casi nada de F29, F30, F32, F34 ni F36, y sí prácticamente todo de F31:

- **Clave primaria propia.** `vaccineAdministeredId` es `uuid PRIMARY KEY DEFAULT gen_random_uuid()` (`:1158`) e `investigationId` es una columna `NOT NULL` **sin `UNIQUE`** (`:1159`). Una investigación tiene N vacunas administradas, y el uno a uno de F36 aquí no aplica.
- **Tiene `isActive`** (`:1164`). De ahí salen `005A` y `005B` completos, que las satélites sin esa columna no pueden tener.
- **Ninguna cascada de estado la toca.** `investigation.service.ts:514` deja fuera del `cascadeSealSatellite` a las satélites con `isActive`, así que ni `ESAVI-INVESTGN-005A`, ni `005B`, ni `ESAVI-CASE-005A` le sellan el `deletedAt`. **`satelliteCascade.service.ts` no se toca**, y éste es el segundo spec de satélite de investigación que no añade una función `cascade*`.
- **La guarda del `005C` es efectiva.** El control de `isActive` que `purgeEntityService` lleva dentro funciona aquí, porque la columna existe. No se consume `assertRowIsSealed` ni se toca `rowSeal.helper.ts`.
- **Lleva `sortOrder` gobernado por la base.** `TRG_investigationVaccineAdministered_setSortOrder` (`:1327`) ejecuta `setSortOrderByParent('investigationId')` **solo `BEFORE INSERT`**, y el índice único parcial `UQ_investigationVaccineAdministered_parent_sortOrder` (`:1365-1367`) impide dos órdenes iguales entre filas vivas del mismo padre.

**Y tres rasgos que no la separan de ninguna de sus hermanas.** El `ON DELETE CASCADE` de su FK al padre (`:1170`) dispara de verdad, porque `investigation` no figura en el bucle `preventPhysicalDelete` (`:1375-1380`), así que un `ESAVI-INVESTGN-005C` arrastra estas filas sin preguntar. No existe `TRG_investigationVaccineAdministered_setUpdatedAt` —el bucle genérico lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación. Y es **hoja del grafo**: `grep 'REFERENCES "investigationVaccineAdministered"' esaviapp.sql` no devuelve nada, así que su `005C` no arrastra nada.

**Lo que sí es propio de esta tabla, y es la razón de que el spec no sea un calco de F31.** Tres cosas:

**A — El DDL admite una fila que no dice qué vacuna se administró.** Las cuatro columnas de datos son anulables, `vaccineWhodrugId` incluida, así que `INSERT` con solo `investigationId` es válido para Postgres. Y aquí, a diferencia de `notificationVaccine`, **no hay ningún campo de texto crudo**: F22 podía tolerar la FK nula porque `vaccineName` guardaba el nombre sin codificar, y el propio F22 §1 llama a ese diseño «codificado **o** crudo». Esta tabla no tiene el «o». Una fila sin `vaccineWhodrugId` es una fila que afirma que se administró una vacuna y es incapaz de decir cuál. Este spec la prohíbe: **`vaccineWhodrugId` es obligatorio a nivel de aplicación**, con 400 en el `001` y sobre el estado resultante en el `004`. Es la primera vez que un spec del repositorio endurece a obligatoria una FK que el DDL declara anulable, y §6 lo razona.

**B — La unicidad no está en el esquema y la tabla la necesita.** El DDL no declara ninguna `UNIQUE` sobre `(investigationId, vaccineWhodrugId, doseNumber)`, así que nada impide registrar dos veces la misma vacuna con la misma dosis en la misma investigación. En una lista que después se cruza con `notificationVaccine` y con la clasificación, un duplicado no es un dato: es ruido que altera el recuento. La impone la aplicación, con 409.

**C — Hereda el `sortOrder` anulable de F35, no el de F31.** `sortOrder` es `smallint` **sin `NOT NULL` y sin `DEFAULT 0`** (`:1160`), que es la anomalía que F35 §1 documentó y la diferencia con las siete tablas del bucle que sí llevan `NOT NULL DEFAULT 0`. La consecuencia práctica es buena y se hereda tal cual: el `create` va **sin la clave `sortOrder` y sin `fields`**, y el trigger la resuelve. **Este spec no necesita `CREATE_FIELDS`.**

**Y un conflicto de precedentes que este spec resuelve.** `doseNumber` es `smallint`, y F22 §6 decidió para su propio `doseNumber` no ponerle techo en el validador, razonando que «un tope inventado rompería una pauta de refuerzos futura». La consecuencia es que un `40000` sale hoy como **500 de Postgres** por desbordamiento de tipo. F36 §6 tomó después la decisión contraria sobre sus cuatro contadores, y es la que este spec adopta: el techo de **32767** no es un tope de dominio inventado, es la capacidad declarada de la columna. §6 lo anota como divergencia explícita con F22, y **no toca aquel servicio**.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationVaccineAdministered`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Ocho operaciones:** `001` crear, `002A` listar activas por investigación, `002B` listar todas por investigación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar, `005C` borrado físico, más la no canónica `006` listar por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **`005A` y `005B` completos**, sobre `setEntityActiveStatusService`. La tabla tiene `isActive`, así que tiene estado propio que retirar y devolver. Es lo que F29, F30, F32, F34 y F36 no pudieron tener.
- **Listado dual por padre, nunca por `/`.** `002A` en `GET /investigation/:id` para USER devuelve solo las filas activas; `002B` en `GET /admin/investigation/:id` para ADMIN las devuelve todas, incluidas las retiradas. **Sin ningún filtro por query**, ordenadas por `sortOrder` ascendente y paginadas con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. El resto se entra por `vaccineAdministeredId`.
- **Relación uno a muchos con `investigation`.** Una investigación registra N vacunas administradas. No hay guarda de «ya existe» sobre el padre, a diferencia de las satélites uno a uno.
- **Guarda del alta:** la investigación existe y está **activa** → 404 `INVVACAD_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe vacunas nuevas.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la fila responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Los dos listados y el `006` aplican el mismo criterio sobre la investigación antes de leer nada.
- **`vaccineWhodrugId` obligatorio a nivel de aplicación**, aunque el DDL lo declare anulable: en el `001` si falta o llega `null` → **400** `INVVACAD_001_VACCINE_REQUIRED`; en el `004` la regla se evalúa sobre el **estado resultante**, así que un `{ vaccineWhodrugId: null }` explícito sobre una fila guardada → **400** `INVVACAD_004_VACCINE_REQUIRED`. Es el endurecimiento razonado en §1-A y en §6.
- **Validación de la FK al maestro en `001` y en `004`:** `VaccineWhodrug.findOne({ where: { vaccineWhodrugId, isActive: true } })`; si no hay fila → **404** `INVVACAD_<op>_WHODRUG_NOT_FOUND`. `findOne` simple, **sin doble salto**: el maestro no cuelga de ningún `catalogType`. Es la forma de F22 §3.5.
- **Unicidad dentro de la investigación** sobre la terna `(investigationId, vaccineWhodrugId, doseNumber)`, comparada entre filas con `isActive: true` y excluyendo en el `004` la propia fila con `vaccineAdministeredId: { [Op.ne]: id }` → **409** `INVVACAD_<op>_ALREADY_EXISTS`. `doseNumber` entra en la comparación **con su valor `null` incluido**: dos filas de la misma vacuna sin número de dosis son la misma fila repetida.
- **`doseNumber` opcional, con `0` válido y techo de 32767.** Validador `.isInt({ min: 0, max: 32767 })` admitiendo `null`: el `CHECK >= 0` del DDL cubre el suelo y el techo lo impone el tipo `smallint`. Es la decisión de F36 §6 y la divergencia explícita con F22, razonada en §6.
- **`sortOrder` asignado por la base, y sin `CREATE_FIELDS`.** La columna es `NULL`-able y sin `DEFAULT 0` (`:1160`), y `setSortOrderByParent` trata el `NULL` como «asígnamelo tú». El modelo la declara `allowNull: true` sin `defaultValue`, el `INSERT` la lleva en `NULL` y el trigger la resuelve. Es el hallazgo de F35 §1-B, heredado tal cual.
- **`investigationId` y `sortOrder` inmutables** en el `004`, ignorados en silencio si llegan, sin 400. Una vacuna administrada no se traslada entre investigaciones y su orden lo gobierna la base.
- **Reasignación de `sortOrder` en `ESAVI-INVVACAD-005B`** cuando el número que ocupaba la fila ya lo tomó otra viva de la misma investigación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la reactivación no delega sin más en `setEntityActiveStatusService`. Es el patrón de F31 §3.5 y F35.
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo y no aplica visibilidad heredada al desactivar. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial: el hueco queda para la siguiente vacuna, deliberadamente.
- **`005B` revalida la unicidad de la terna, y solo eso.** Si otra fila activa de la misma investigación ya ocupa la terna resultante, la reactivación se rechaza con **409** `INVVACAD_005B_ALREADY_EXISTS`. La comprobación va **antes** de la reasignación de `sortOrder`. Es la única revalidación que hace: **no** comprueba la cadena del padre —reactivar una fila cuya investigación se desactivó entretanto responde **200**, por la razón de F31 §3.5— ni el estado del maestro.
- **Guarda del `005C`: la fila debe estar inactiva** → si no, 409. La aporta `purgeEntityService` tal cual, que aquí **sí es efectivo** porque la columna `isActive` existe.
- **Ampliación del volcado en `warn` de `purgeInvestigationService`** para que registre también cuántas vacunas administradas van a desaparecer por `ON DELETE CASCADE`, junto a lo que F29 a F36 ya dejaron. **Es el único punto en que este spec toca `investigation.service.ts`**, y **no** se bloquea la purga.
- **Ningún campo cifrado.** La tabla no contiene ningún dato identificativo: una FK a un diccionario, un entero y una nota.
- **Normalización al escribir:** `.trim()` sobre `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Un índice nuevo en `esaviapp.sql`:** `IX_investigationVaccineAdministered_investigation` sobre `("investigationId")`. Es **la única** modificación del DDL en todo el spec, y la justifica el `002B`: el único índice que hoy cubre esa columna es el parcial `UQ_..._parent_sortOrder`, que excluye las filas selladas y las de `sortOrder` nulo, justo las que aquel listado sí devuelve. Es lo que F31 y F35 hicieron.
- Alta de la abreviatura **`INVVACAD`** en `references/CONVENTIONS.md` §6 — reservada por F36 §6 precisamente para esta tabla.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationVaccineAdministered.test.ts` y ampliación de `tests/contract/investigation.test.ts` con la cascada del `005C`.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. Es el padre de la FK y de él sale la visibilidad heredada.
- El **SPEC F18** debe estar `Implementado`. `vaccineWhodrugId` es obligatorio, así que **sin el modelo del maestro no hay alta posible**.
- **El maestro poblado por la importación de [F19](./19-vaccinewhodrug-bulk-import.md).** Y aquí, a diferencia de F22, esto no es una nota: con `vaccineWhodrug` vacío **ningún `POST` puede tener éxito**, porque no hay forma de registrar la vacuna sin codificar. Es la consecuencia directa del endurecimiento de §1-A y está en §7 como riesgo.

**Fuera de alcance (otros specs):**

- **Las cuatro satélites de `investigation` que siguen sin spec:** `investigationCovidHistory` (`:1014-1036`), `investigationColdChain` (`:1174-1197`), `investigationAdministrationError` (`:1199-1234`) e `investigationCommunity` (`:1236-1256`).
- **Cualquier regla cruzada con `notificationVaccine`.** Aquella tabla registra las vacunas que la **notificación** declaró; ésta, las que la **investigación** confirmó administradas. Contrastarlas —marcar discrepancias, precargar una desde la otra, exigir que la investigada esté entre las notificadas— es exactamente el trabajo del investigador y convertirlo en regla exige antes decidir cuál de las dos manda. Ni una precarga: el `001` no copia nada de `notificationVaccine`.
- **Cualquier regla cruzada con `investigationVaccinationContext`.** Aquélla dice en qué contexto se administró la dosis y ésta cuáles se administraron. Que `vaccinatedPerVialCount` sea alto no dice nada sobre cuántas filas hay aquí, como F36 §2 ya declaró desde el otro lado.
- **Cualquier regla cruzada con `investigationColdChain` o `investigationAdministrationError`**, aunque las tres hablen de la misma dosis.
- **Reordenar las vacunas** — un `007` que mueva una de posición y desplace a sus hermanas. Es lo que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. Su propio spec, y el mismo que F16, F27, F31, F33 y F35 dejaron abierto.
- **Cualquier filtro de listado** por `vaccineWhodrugId`, por `doseNumber` o por texto sobre `notes`. Los dos listados devuelven todas las vacunas de su investigación, paginadas y ordenadas por `sortOrder`.
- **Cualquier resolución o acuñación contra `vaccineWhodrug`.** No hay un `ESAVI-WHODRUG-006`, y F18 §6 decidió que no lo haya: el maestro se puebla por importación, no por formulario. Una vacuna que no está en el diccionario **no se puede registrar aquí**, y ésa es la consecuencia aceptada.
- **Denormalizar nada del maestro.** Ni `drugName`, ni `drugCode`, ni un `vaccineName` de respaldo. La tabla no tiene esas columnas y este spec no las añade: es lo que separa esta entidad de `notificationVaccine`, y volver a introducirlas reabriría el diseño «codificado o crudo» que aquí no aplica.
- **Derivar nada de `doseNumber`** —una pauta, una secuencia esperada, una validación de que la dosis 3 no llegue antes que la 2—. El campo se guarda y no se interpreta.
- **Modificar `esaviapp.sql`** más allá del índice: ni el trigger de `sortOrder`, ni el índice único parcial, ni los dos `CHECK`, ni el `ON DELETE CASCADE`, ni convertir `vaccineWhodrugId` en `NOT NULL` — el endurecimiento vive en la aplicación, y §6 razona por qué.
- **Modificar `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService` ni `buildDifferentialUpdate`.** Los cuatro se consumen tal cual están.
- **Cambiar el comportamiento de F29 a F36.** Este spec solo amplía el volcado de `purgeInvestigationService`; sus suites de contrato deben pasar sin tocar un solo caso.
- **Cambiar el `doseNumber` sin techo de `notificationVaccine`.** La divergencia se declara en §6 y aquel servicio no se toca. Si mañana se unifica, es su propio spec.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationVaccineAdministered` — `esaviapp.sql:1157-1172`. La tabla **no se altera**; lo único que este spec añade al DDL es una línea de índice.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `vaccineAdministeredId` | `uuid` | no | PK con `DEFAULT gen_random_uuid()` (`:1158`). **La mina la base** |
| `investigationId` | `uuid` | **no** | `:1159`. `FK_investigationVaccineAdministered_investigation` → `investigation`, `ON DELETE CASCADE` (`:1170`). **Sin `UNIQUE`: es una colección** |
| `sortOrder` | `smallint` | sí | `:1160`. `CHECK ("sortOrder" IS NULL OR "sortOrder" >= 0)`. **Sin `NOT NULL` y sin `DEFAULT`.** Lo asigna el trigger; la aplicación no lo envía |
| `vaccineWhodrugId` | `uuid` | sí en el DDL | `:1161`. `FK_investigationVaccineAdministered_whodrug` → `vaccineWhodrug`, `ON DELETE RESTRICT` (`:1171`). **La aplicación lo exige**, ver §3.5 |
| `doseNumber` | `smallint` | sí | `:1162`. `CHECK ("doseNumber" IS NULL OR "doseNumber" >= 0)`. Techo de 32767 impuesto por el tipo |
| `notes` | `text` | sí | `:1163`. Texto libre |

**Cuatro columnas de datos y ninguna obligatoria en el esquema.** De ahí sale el hallazgo `A` de §1: el DDL admite una fila que afirma que se administró una vacuna sin decir cuál, y esta tabla —a diferencia de `notificationVaccine`— no tiene ningún campo de texto crudo con el que salvar el dato.

**Restricciones.** **Dos claves foráneas** —el padre y el maestro—, **dos `CHECK`** —`sortOrder` y `doseNumber` contra el cero—, **ninguna `UNIQUE`** y **ningún índice sobre `investigationId`**. La terna `(investigationId, vaccineWhodrugId, doseNumber)` no está protegida por nada: la unicidad de §3.5 la impone íntegramente la aplicación.

**La FK al maestro es `ON DELETE RESTRICT`**, así que una vacuna administrada impide borrar físicamente su entrada del diccionario — irrelevante en la práctica, porque `vaccineWhodrug` figura en `preventPhysicalDelete` (`:1377`) y no tiene `005C`. Es la misma situación que F22 §3.1 documentó.

**Las columnas transversales están todas.** `isActive` (`:1164`), `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. No falta ninguna, a diferencia de las siete satélites sin `isActive`.

**Triggers. Dos.** `TRG_investigationVaccineAdministered_setSysDetails`, del bucle genérico de `:1289-1304`. Y `TRG_investigationVaccineAdministered_setSortOrder`, del bucle de orden (`:1327`), que ejecuta `setSortOrderByParent('investigationId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si es `NULL` **o `0`**, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre, bajo `pg_advisory_xact_lock`. **No hay** `setUpdatedAt`: lo escribe la aplicación.

**Y un índice único parcial**, `UQ_investigationVaccineAdministered_parent_sortOrder` (`:1365-1367`), sobre `("investigationId", "sortOrder")` con `WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. Es el que obliga a la reasignación de `sortOrder` del `005B`, y el que **libera el hueco** cuando el `005A` sella `deletedAt`.

**El `sortOrder` es la misma anomalía que F35 documentó.** Es la segunda de las nueve tablas del bucle `setSortOrderByParent` declarada `NULL`-able y sin `DEFAULT 0`; las siete restantes llevan `smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0)`. La consecuencia práctica está en §3.2 y es buena: aquí tampoco hace falta `CREATE_FIELDS`.

**Hoja del grafo.** `grep 'REFERENCES "investigationVaccineAdministered"' esaviapp.sql` no devuelve nada. Su `005C` no arrastra nada y no lleva volcado de cascada propio.

**Lo único que se añade al DDL**, junto al `IX_evaluationInstitution_investigation` que dejó F35 (`:1131`):

```
CREATE INDEX IF NOT EXISTS "IX_investigationVaccineAdministered_investigation" ON "investigationVaccineAdministered" ("investigationId");
```

**Lo justifica el `002B`.** El índice parcial existente cubre `("investigationId", "sortOrder")` solo para filas con `deletedAt IS NULL` y `sortOrder IS NOT NULL`, y el listado admin lee precisamente las que quedan fuera: las selladas. Sin el índice nuevo, `002B` degenera en recorrido secuencial en cuanto la tabla crece.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationVaccineAdministered.model.ts`. Clase `InvestigationVaccineAdministered`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationVaccineAdministered'`.

`vaccineAdministeredId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')` — **al contrario que en F29, F30, F32, F34 y F36**, donde la PK era la FK y declararla con `defaultValue` habría convertido un alta sin padre en un error de integridad de Postgres. Aquí la clave es propia y la mina la base.

Tipos de atributo:

- `investigationId` — `DataTypes.UUID`, `allowNull: false`.
- `sortOrder` — `DataTypes.SMALLINT`, **`allowNull: true` y sin `defaultValue`**. Es la consecuencia del hallazgo `C` de §1: con `allowNull: false` o con un `defaultValue: 0`, Sequelize mandaría un valor en el `INSERT` y el trigger no tendría nada que asignar. La columna se omite del `create` y la resuelve la base.
- `vaccineWhodrugId` — `DataTypes.UUID`, **`allowNull: true`**. El modelo refleja el DDL; la obligatoriedad vive en el validador y en el servicio, no aquí. §6 razona por qué el modelo no miente sobre la columna.
- `doseNumber` — `DataTypes.SMALLINT`, `allowNull: true`. **`SMALLINT` y no `INTEGER`**: que el tipo del modelo coincida con el de la columna es lo que hace que el techo de 32767 sea una propiedad declarada y no un accidente.
- `notes` — `DataTypes.TEXT`, `allowNull: true`.
- `isActive` — `DataTypes.BOOLEAN`, `allowNull: false`, `defaultValue: true`.

Asociaciones, en `src/models/associations/investigationVaccineAdministered.associations.ts` — archivo nuevo, registrado en el barrel de asociaciones y en `initModels()`:

- `InvestigationVaccineAdministered.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasMany(InvestigationVaccineAdministered, { as: 'vaccinesAdministered', foreignKey: 'investigationId' })` — **`hasMany` y no `hasOne`**, porque `investigationId` no lleva `UNIQUE`. El alias `vaccinesAdministered` no colisiona con `source` (F29), `autopsy` (F30), `teamMembers` (F31), `medicalHistory` (F32), `clinicalEvaluation` (F34) ni `vaccinationContext` (F36).
- `InvestigationVaccineAdministered.belongsTo(VaccineWhodrug, { as: 'vaccineWhodrug', foreignKey: 'vaccineWhodrugId' })` — mismo alias que usa `notificationVaccine` sobre el mismo maestro (F22 §3.2), en un modelo distinto y por tanto sin colisión.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `vaccinesAdministered` **no se añade a ninguna respuesta de `investigation`**: el `include` no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consume el volcado en `warn` de `purgeInvestigationService`.

### 3.3 Tipos

`src/types/investigation/investigationVaccineAdministered.types.ts`, junto a los de `investigation`, `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation` e `investigationVaccinationContext`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationVaccineAdministeredInput {
    investigationId: string;
    vaccineWhodrugId: string;
    doseNumber?: number | null;
    notes?: string | null;
}
```

**Dos campos obligatorios, y el segundo es la decisión de §1-A hecha tipo.** `vaccineWhodrugId` se declara `string` y no `string | null` aunque el DDL admita el nulo: el tipo dice lo que la aplicación exige, no lo que la columna tolera. Los dos restantes son opcionales y anulables, y el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado y no solo cambiarlo.

**Tres columnas no están en la interfaz.** `vaccineAdministeredId` lo mina la base; `sortOrder` es inmutable y lo asigna el trigger; `isActive` lo gobiernan `005A` y `005B`. Que ninguno exista en el tipo es la forma más barata de garantizar que ningún servicio los mande.

El update usa `Partial<CreateInvestigationVaccineAdministeredInput>`. **No se declara `UpdateInvestigationVaccineAdministeredInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`. `vaccineWhodrugId` aparece como opcional, y ahí está el matiz: **opcional en el body no es opcional en el resultado**. Ausente significa «no lo toques»; `null` explícito significa «bórralo», y eso es lo que el `004` rechaza con 400. La regla se evalúa sobre el estado resultante y TypeScript no puede expresarla, igual que en F22 §3.3.

El `code` del maestro no interviene: **no hay ninguna constante nueva** ni ninguna lista local en este servicio.

### 3.4 Superficie HTTP

```
POST   /api/investigation-vaccines-administered                          ESAVI-INVVACAD-001   USER        (nuevo)
GET    /api/investigation-vaccines-administered/admin/investigation/:id  ESAVI-INVVACAD-002B  ADMIN       (nuevo)
GET    /api/investigation-vaccines-administered/investigation/:id        ESAVI-INVVACAD-002A  USER        (nuevo)
GET    /api/investigation-vaccines-administered/case/:caseId             ESAVI-INVVACAD-006   USER        (nuevo)
DELETE /api/investigation-vaccines-administered/purge/:id                ESAVI-INVVACAD-005C  SUPERADMIN  (nuevo)
PATCH  /api/investigation-vaccines-administered/activate/:id             ESAVI-INVVACAD-005B  ADMIN       (nuevo)
GET    /api/investigation-vaccines-administered/:id                      ESAVI-INVVACAD-003   USER        (nuevo)
PUT    /api/investigation-vaccines-administered/:id                      ESAVI-INVVACAD-004   USER        (nuevo)
DELETE /api/investigation-vaccines-administered/:id                      ESAVI-INVVACAD-005A  ADMIN       (nuevo)
```

**Nueve rutas, y `:id` es el `vaccineAdministeredId`.** La clave es propia, así que el acceso por fila y el acceso por investigación son cosas distintas: la primera es el `003` y la segunda son los dos listados. Es la diferencia con las satélites uno a uno, donde el `003` ya era el acceso por investigación.

Orden de declaración en `src/routes/investigationVaccineAdministered.routes.ts`: las rutas con prefijo literal (`/admin/investigation/:id`, `/investigation/:id`, `/case/:caseId`, `/purge/:id`, `/activate/:id`) van **antes** de `/:id`, o Express capturará `admin`, `investigation`, `case`, `purge` y `activate` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14 y F28 a F36, y por la misma razón: la captura la hace el usuario, en el mismo flujo operativo que el caso. **Todo lo demás sigue el canon exactamente:** `002A` y `003` en USER, `002B`, `005A` y `005B` en ADMIN, `005C` en SUPERADMIN. El `006` va en USER, como su `002A`.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationVaccineAdministered` · `006` · listar las vacunas administradas de un caso — la cadena `caso → investigación` es uno a uno y la última `investigación → vacunas` es uno a muchos, así que devuelve `{ count, rows }`**.

**La abreviatura es `INVVACAD`.** Ocho letras, **reservada por F36 §6 para esta tabla** precisamente porque `investigationVaccinationContext` e `investigationVaccineAdministered` se parecen lo bastante como para confundirse en un `grep` del log. `grep "ESAVI-INVVACAD-"` no se cruza con `ESAVI-INVVACTX-`, `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-INVTEAM-`, `ESAVI-INVMEDH-`, `ESAVI-INVPREG-`, `ESAVI-INVCLIEV-`, `ESAVI-EVALINST-` ni `ESAVI-WHODRUG-`.

### 3.5 Reglas de negocio por operación

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| `vaccineWhodrugId` **presente** y UUID (`001`) | validador | 400 `common.validationError` |
| `vaccineWhodrugId` UUID **o `null`** (`004`) | validador | 400 `common.validationError` |
| `doseNumber` con `.isInt({ min: 0, max: 32767 })`, admitiendo `null` | validador | 400 `common.validationError` |
| `notes` como cadena | validador | 400 `common.validationError` |
| `vaccineWhodrugId` resultante nulo (`004`) | **servicio** | 400 `INVVACAD_004_VACCINE_REQUIRED` |
| La investigación existe y está activa | **servicio** | 404 `INVVACAD_<op>_INVESTIGATION_NOT_FOUND` |
| `vaccineWhodrugId` existe y está activo | **servicio** | 404 `INVVACAD_<op>_WHODRUG_NOT_FOUND` |
| Terna repetida entre filas activas de la investigación | **servicio** | 409 `INVVACAD_<op>_ALREADY_EXISTS` |

**La obligatoriedad de `vaccineWhodrugId` se reparte entre las dos capas, y el reparto no es arbitrario.** En el `001` la puede resolver el validador, porque el body es el estado completo: falta la clave, falta el dato. En el `004` no, porque «ausente» significa «no lo toques» y solo el servicio sabe qué hay guardado. De ahí que el validador del `004` **admita `null`** y sea el servicio quien lo rechace: el 400 llega igual, pero por el camino que puede distinguir los dos casos.

**Los dos `CHECK` del DDL se replican en el validador**, y el techo de 32767 con ellos. El techo no está en el `CHECK` sino en el tipo `smallint`: sin él, un `40000` sería un 500 de Postgres en vez de un 400 legible. Es la decisión de F36 §6 y la divergencia con F22, razonada en §6.

#### La validación del maestro

Corre **antes del diff y con independencia de él**: una entrada del diccionario desactivada después del registro es 404 aunque coincida con la guardada.

`VaccineWhodrug.findOne({ where: { vaccineWhodrugId, isActive: true } })`; si no hay fila → **404** `INVVACAD_<op>_WHODRUG_NOT_FOUND`. Basta el `findOne` sobre la propia tabla: el maestro no cuelga de ningún `catalogType`, así que aquí **no** aplica el patrón de doble salto que F14, F21, F35 y F36 necesitaron. Es exactamente lo que hizo F22 §3.5.

**Solo corre cuando la clave llega con valor.** En el `004`, un `vaccineWhodrugId` ausente no se revalida, y uno `null` ya fue rechazado por la regla anterior.

#### La unicidad de la terna

Se compara `(investigationId, vaccineWhodrugId, doseNumber)` **resultante** contra las filas de la **misma investigación** con `isActive: true`, excluyendo en el `004` la propia fila con `vaccineAdministeredId: { [Op.ne]: id }`. Si hay coincidencia → **409** `INVVACAD_<op>_ALREADY_EXISTS`, con `{{doseNumber}}` interpolado.

**`doseNumber` entra en la comparación con su `null` incluido.** Dos filas de la misma vacuna sin número de dosis son la misma fila repetida, así que `doseNumber: null` compara contra `null` y colisiona. En Sequelize eso es `{ doseNumber: null }` en el `where`, que genera `IS NULL` y no `= NULL`; escribirlo con `Op.eq` sobre un nulo no encontraría nunca la colisión y el duplicado entraría.

**Se compara solo contra filas activas.** Una fila retirada por `005A` no bloquea el alta de la misma vacuna: la lista viva es la que tiene que ser coherente.

**Y por eso la regla se comprueba en tres operaciones, no en dos.** El `001` y el `004` no son las únicas puertas por las que un duplicado puede entrar en la lista viva: el `005B` es la tercera, porque devuelve a la lista una fila cuya terna pudo ocuparse mientras estaba retirada. La comprobación es la misma —terna resultante contra las filas activas de la investigación, excluyendo la propia— y el código de error también: **409** `INVVACAD_005B_ALREADY_EXISTS`. §6 razona la consecuencia, que no es gratis.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Una fila cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). Los dos listados y el `006` aplican el mismo criterio sobre la investigación **antes** de leer nada, y devuelven 404 si no la ven.

**El padre se consulta y se descarta.** Se resuelve con `attributes: ['investigationId', 'isActive']` y no viaja en la respuesta: es la decisión de F35, y §3.7 la detalla.

**`005A`, `005B` y `005C` no aplican visibilidad heredada.** Retirar, devolver o purgar una fila no depende del estado del padre.

#### Por operación

**`ESAVI-INVVACAD-001` — crear.** En transacción, en este orden:

1. La investigación existe y está `isActive: true` → 404 `INVVACAD_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe vacunas nuevas.
2. `vaccineWhodrugId` presente y no nulo. Lo cubre el validador con 400 `common.validationError`; el servicio **no** lo repite.
3. El maestro: existe y está activo → 404 `INVVACAD_001_WHODRUG_NOT_FOUND`.
4. Unicidad de la terna entre las filas activas de esa investigación → 409 `INVVACAD_001_ALREADY_EXISTS`.
5. Normaliza: `.trim()` sobre `notes`. No hay `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
6. `create` **sin la clave `sortOrder`** y **sin `fields`**, para que lo asigne el trigger.
7. Entrada de auditoría en `appDetails` con `method: 'ESAVI-INVVACAD-001'`.

El alta mínima es `{ investigationId, vaccineWhodrugId }` y devuelve **201** con `doseNumber` y `notes` en `null`, `isActive: true` y el `sortOrder` que le toque.

**`ESAVI-INVVACAD-002A` — listar activas por investigación.** La investigación existe y está activa, salvo `canViewInactive` → 404 `INVVACAD_002A_INVESTIGATION_NOT_FOUND`. `findAndCountAll` con `where: { investigationId, isActive: true }`, el `include` del maestro en `required: false`, `order: [['sortOrder', 'ASC']]` y paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. **Sin filtros por query.** Devuelve la forma completa de §3.7.

**El `include` del maestro va en `required: false`.** En la práctica toda fila creada por esta API tiene su FK resuelta, pero una fila cargada por SQL directo puede no tenerla, y con `required: true` desaparecería del listado sin dejar rastro.

**`ESAVI-INVVACAD-002B` — listar todas por investigación.** Idéntica, con `where: { investigationId }` y sin filtrar por `isActive`: devuelve también las retiradas y las de `deletedAt` sellado. Mismo código de 404 salvo el sufijo: `INVVACAD_002B_INVESTIGATION_NOT_FOUND`. **Es la operación que justifica el índice nuevo de §3.1.**

**`ESAVI-INVVACAD-003` — obtener por ID.** El `:id` es el `vaccineAdministeredId`. Visibilidad heredada más el `isActive` propio, gobernados los dos por `canViewInactive` → 404 `INVVACAD_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVVACAD-006` — listar por caso.** Entra por el `caseId` y atraviesa los dos saltos. Dos 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVVACAD_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVVACAD_006_INVESTIGATION_NOT_FOUND`.

Una investigación **sin vacunas registradas devuelve 200** con `{ count: 0, rows: [] }`, no 404: el último salto es uno a muchos y la lista vacía es un resultado legítimo. Devuelve solo las filas con `isActive: true`, ordenadas por `sortOrder` y paginadas, como el `002A`.

**`ESAVI-INVVACAD-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada y el `isActive` propio → 404 `INVVACAD_004_NOT_FOUND`.
2. `investigationId` y `sortOrder` **se ignoran siempre**, vengan o no en el body, sin 400. Una vacuna administrada no se traslada entre investigaciones y su orden lo gobierna la base.
3. Estado resultante de `vaccineWhodrugId` y `doseNumber`: `data.x !== undefined ? (data.x ?? null) : stored.x`.
4. Si el `vaccineWhodrugId` resultante es nulo → **400** `INVVACAD_004_VACCINE_REQUIRED`. **Antes del diff y con independencia de él.**
5. El maestro, solo si la clave llega con valor → 404 `INVVACAD_004_WHODRUG_NOT_FOUND`. **También antes del diff:** una entrada inactiva es 404 aunque coincida con la guardada.
6. Unicidad de la terna resultante, excluyendo la propia fila → 409 `INVVACAD_004_ALREADY_EXISTS`. **Igualmente antes del diff:** una terna ocupada es 409 aunque el resto del body no cambie nada.
7. `stored` sale de `row.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
8. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
9. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `isActive` | **no entra** | lo gobiernan `005A` y `005B` |
| `vaccineWhodrugId` | `data.vaccineWhodrugId !== undefined ? (data.vaccineWhodrugId ?? null) : undefined` | anulable **en forma**, obligatorio en resultado: el `null` ya fue rechazado con 400 en el paso 4, así que aquí nunca llega |
| `doseNumber` | `data.doseNumber !== undefined ? (data.doseNumber ?? null) : undefined` | anulable. **`0` es un valor válido** |
| `notes` | `data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined` | anulable, `.trim()` antes de comparar |

**Ningún campo va bajo un `if( data.x )`.** Sobre `doseNumber` sería directamente destructivo: **`0` es un valor válido** —la dosis cero de una pauta que empieza en cero— y un `if` de veracidad lo tiraría, dejando el campo sin forma de guardarlo. Sobre `notes` descartaría en silencio la cadena vacía con la que se vacía el campo.

**`vaccineWhodrugId` entra como anulable pese a ser obligatorio, y es deliberado.** La forma del candidato no es donde se impone la regla: la impone el paso 4, antes y aparte. Escribirlo aquí como `data.x ? data.x : undefined` haría que un `null` que hubiera sobrevivido se descartase en silencio en vez de fallar, y eso es exactamente lo que la regla existe para impedir.

**`ESAVI-INVVACAD-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'INVVACAD_005A_NOT_FOUND'`, `alreadyInStateCode: 'INVVACAD_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-INVVACAD-005A'`. **No consulta nada más**: la tabla es hoja del grafo y no aplica visibilidad heredada. Sella `isActive: false` y `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — correcto y deliberado, el hueco queda para la siguiente vacuna.

**`ESAVI-INVVACAD-005B` — reactivar, con guarda de unicidad y reasignación de `sortOrder`.** Cinco pasos, en transacción:

1. La fila existe, con `paranoid: false` → 404 `INVVACAD_005B_NOT_FOUND`. Si ya está activa → 409 `INVVACAD_005B_ALREADY_ACTIVE`.
2. **Unicidad de la terna.** Otra fila de la **misma** investigación, con el **mismo** `vaccineWhodrugId` y el **mismo** `doseNumber` —nulo incluido, con `IS NULL`—, con `isActive: true` y `vaccineAdministeredId: { [Op.ne]: id }` → **409** `INVVACAD_005B_ALREADY_EXISTS`, con `{{doseNumber}}` interpolado. La terna es la guardada: el `005B` no recibe body.
3. Se busca colisión de orden: otra fila de la **misma** investigación, con el **mismo** `sortOrder`, con `deletedAt: null` y `vaccineAdministeredId: { [Op.ne]: id }`. **Si el `sortOrder` de la fila es `null` no hay colisión posible** —el índice parcial excluye los nulos— y el paso se salta.
4. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa investigación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que la escritura es libre. La vacuna reaparece al final de la lista.
5. `isActive: true`, `deletedAt: null`, entrada en `appDetails` con `method: 'ESAVI-INVVACAD-005B'`.

**El orden entre el paso 2 y el paso 3 no es indiferente.** La guarda de unicidad va **antes** de la reasignación de `sortOrder`: reordenar una fila que después se va a rechazar dejaría escrita una modificación que ninguna operación completada justifica, y el `appDetails` registraría un movimiento que nadie pidió.

**Y el `005B` no revalida nada más.** Ni la cadena del padre —reactivar una fila cuya investigación se desactivó entretanto responde 200, por la razón de F31 §3.5— ni el estado del maestro: una entrada del diccionario retirada después del registro sigue diciendo qué se administró, como en toda lectura. §6 razona las tres decisiones por separado, porque no comparten motivo.

**`ESAVI-INVVACAD-005C` — purgar.** `purgeInvestigationVaccineAdministeredService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** visibilidad heredada → 404 `INVVACAD_005C_NOT_FOUND`; **409 si la fila está activa**, con el control de `isActive` que el helper ya lleva dentro y que **aquí sí es efectivo**, a diferencia de F29, F30, F32, F34 y F36; volcado en `warn` de la fila completa —no hay ningún campo cifrado ni identificativo que omitir—; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` —la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6. **No se consume `assertRowIsSealed`** ni se toca `rowSeal.helper.ts`. **Y no arrastra nada:** la tabla es hoja del grafo.

#### Lo que no es diferencial, y por qué

- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Nace de una restricción de la base, no de comparar un valor entrante contra el guardado.
- **`005A` y `005B`** — registran un hecho, no un cambio de dato. Que la entrada en `appDetails` quede es precisamente lo que se quiere.
- **`001`** — es un alta, no hay fila previa contra la que comparar.

#### El volcado del `ESAVI-INVESTGN-005C`

El purgado de una investigación arrastra sus vacunas administradas por `ON DELETE CASCADE` sin pasar por ningún servicio. Se **amplía** el volcado en nivel `warn` que F29 a F36 ya dejaron en `purgeInvestigationService` para que registre también cuántas filas de esta tabla van a desaparecer, antes del `destroy` y dentro de la misma transacción, con `InvestigationVaccineAdministered.count({ where: { investigationId: id }, paranoid: false, transaction })`. El `paranoid: false` cuenta también las que un `005A` selló: la cascada las destruye igual. Se emite solo si `N > 0`. **No se bloquea la purga**, y **es el único punto en que este spec toca `investigation.service.ts`**.

**Ninguna cascada de estado la toca.** Ni `ESAVI-INVESTGN-005A`, ni `ESAVI-INVESTGN-005B`, ni `ESAVI-CASE-005A`: `investigation.service.ts:514` deja fuera del `cascadeSealSatellite` a las satélites con `isActive`. `satelliteCascade.service.ts` y `esaviCase.service.ts` **no se modifican**.

**Validaciones de forma** (las emite `validateFields` con 400): en el `001`, `investigationId` y `vaccineWhodrugId` obligatorios y `.isUUID()`; en el `004`, `vaccineWhodrugId` con `.isUUID()` **admitiendo `null`**; en los dos, `doseNumber` con `.isInt({ min: 0, max: 32767 })` admitiendo `null` y `notes` como cadena. `param('id')` con `.isUUID()` en `003`, `004`, `005A`, `005B` y `005C`; `param('id')` en los dos listados —donde es el `investigationId`— y `param('caseId')` en el `006`, los tres con `.isUUID()`; `limit` y `offset` con `.isInt()` en los tres listados.

### 3.6 Claves i18n nuevas

Bloque `investigationVaccineAdministered` en `src/data/i18n/es.json`, `en.json` y `nl.json` — **veintitrés claves**:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` |
| `getSuccessPlural` / `getFailedPlural` | `002A`, `002B` y `006` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `deletedSuccess` / `deletedFailed` | `005A` |
| `activatedSuccess` / `activatedFailed` | `005B` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005A`, `005B` y `005C` |
| `idRequired` | parámetro ausente |
| `alreadyActive` | 409 al reactivar una fila ya activa |
| `alreadyInactive` | 409 al desactivar una fila ya retirada, y 409 del `005C` sobre una fila activa |
| `investigationNotFound` | 404 cuando la investigación no existe o está inactiva, en `001`, `002A`, `002B` y `006` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |
| `whodrugNotFound` | 404 cuando `vaccineWhodrugId` no existe o está inactivo en el maestro |
| `vaccineRequired` | 400 cuando el `vaccineWhodrugId` resultante es nulo en el `004` |
| `alreadyExists` | 409 cuando la terna ya está registrada entre las filas activas de la investigación, en `001`, `004` **y `005B`**. Lleva `{{doseNumber}}` |

**`vaccineRequired` existe solo para el `004`.** En el `001` la ausencia la resuelve el validador con `common.validationError`, como toda validación de forma del repositorio. Que haya una clave propia y no dos es fiel al reparto de §3.5: son dos capas distintas resolviendo la misma regla sobre información distinta.

**Ninguna clave para las validaciones de forma:** el techo de 32767, el suelo del `CHECK` y los UUID caen todos en `common.validationError`.

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. **No se añade ninguna clave** a los bloques `investigation`, `esaviCase` ni `vaccineWhodrug`: el volcado del `005C` va al log y no produce mensaje, y el maestro solo se lee.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004` y **también las filas de `002A`, `002B` y `006`**:

```
{ ok, message, data: {
    vaccineAdministeredId, investigationId, sortOrder,
    vaccineWhodrugId, doseNumber, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    vaccineWhodrug: { vaccineWhodrugId, drugCode, drugName } | null
} }
```

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente.

**No hay forma reducida.** Cuatro columnas de datos y un objeto de maestro con tres campos: recortarlas dejaría un listado sin contenido.

**La FK cruda viaja junto al objeto resuelto.** Es el patrón de F16, F21 y F22: el `004` acepta `vaccineWhodrugId` en el body, así que un `PUT` que reenvía la respuesta de su `GET` necesita encontrarla ahí. Excluirla obligaría al cliente a leer el id de dentro del objeto anidado, y el criterio de aceptación del update diferencial dejaría de poder escribirse tal cual.

**El maestro se incluye sin filtrar por `isActive`**, con tres campos —`vaccineWhodrugId`, `drugCode`, `drugName`— y ninguna de las otras veintiséis columnas. Una entrada retirada del diccionario después del registro sigue diciendo qué se administró; quien necesite la ficha entera entra por `ESAVI-WHODRUG-003`. Es la decisión de F22 §3.7, heredada literalmente.

**`vaccineWhodrug` puede llegar `null`, y eso solo puede pasar con datos que esta API no creó.** El `001` exige la FK y el `004` impide vaciarla, así que toda fila nacida por HTTP la tiene resuelta. El `null` queda para las filas cargadas por SQL directo, y el `include` en `required: false` es lo que garantiza que aparezcan en vez de desaparecer del listado.

**`sortOrder` se devuelve aunque sea inmutable.** El cliente no puede escribirlo, pero sí necesita leerlo: es el orden en que la lista se presenta, y sin él no puede explicar por qué las filas llegan como llegan.

**`doseNumber` se devuelve como número, y el `0` no se colapsa a `null`.** «Dosis cero» y «no se sabe qué dosis» son datos distintos, y ninguna respuesta convierte uno en el otro.

**Nada de la investigación viaja en la respuesta.** Se consulta en toda lectura con `attributes: ['investigationId', 'isActive']` para la visibilidad heredada y se descarta al construir el payload: quien necesite la investigación entra por `ESAVI-INVESTGN-003`. Es la decisión de F35 §3.7 y la diferencia con F31, razonada en §6. `sysDetails` **nunca** se devuelve, ni el de la fila ni el del maestro. Ninguna respuesta incluye datos de las otras diez satélites de `investigation`.

---

## 4. Plan de implementación

**Precondiciones.** El **SPEC F28** debe estar `Implementado` —es el padre de la FK y de él sale la visibilidad heredada— y el **SPEC F18** también: `vaccineWhodrugId` es obligatorio, así que sin el modelo del maestro no hay alta posible. Y el maestro debe estar **poblado** por la importación de F19 para que los pasos 6 en adelante se puedan ejercitar.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Añadir el índice al DDL.** La línea `CREATE INDEX IF NOT EXISTS "IX_investigationVaccineAdministered_investigation" ON "investigationVaccineAdministered" ("investigationId");` junto al `IX_evaluationInstitution_investigation` que dejó F35 (`:1131`). **Es la única modificación de `esaviapp.sql` en todo el spec**, y va primera porque es la que no depende de nada.
   *Verificación:* `git diff esaviapp.sql` muestra **exactamente una línea añadida** y ninguna modificada; ejecutar el DDL completo sobre una base limpia no produce errores; ejecutarlo **dos veces seguidas** tampoco, por el `IF NOT EXISTS`; `\d "investigationVaccineAdministered"` lista el índice nuevo **junto a** `UQ_investigationVaccineAdministered_parent_sortOrder`, que sigue intacto, y los dos `CHECK` y las dos FKs siguen ahí.

2. **Modelo, asociaciones y tipos.** `src/models/investigationVaccineAdministered.model.ts` con la PK `vaccineAdministeredId` en `gen_random_uuid()`, `sortOrder` **`allowNull: true` y sin `defaultValue`**, `vaccineWhodrugId` en `UUID` con `allowNull: true`, `doseNumber` en **`SMALLINT`**, `notes` en `TEXT` e `isActive` en `BOOLEAN` con `defaultValue: true`. `src/models/associations/investigationVaccineAdministered.associations.ts` con los tres vínculos de §3.2, registrado en el barrel de asociaciones y en `initModels()`. `src/types/investigation/investigationVaccineAdministered.types.ts` con `CreateInvestigationVaccineAdministeredInput`, exportado por el `index.ts` de barrel del dominio. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; `Investigation.hasMany(..., { as: 'vaccinesAdministered' })` está declarado y no colisiona con `source`, `autopsy`, `teamMembers`, `medicalHistory`, `clinicalEvaluation` ni `vaccinationContext`; un `findAll` con el `include` del maestro devuelve el objeto resuelto; `grep -n "isActive" src/types/investigation/investigationVaccineAdministered.types.ts` no devuelve resultados; `npm test` sigue en verde, porque el `hasMany` nuevo no se incluye en ninguna respuesta de `investigation`.

3. **Claves i18n.** El bloque `investigationVaccineAdministered` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las **veintitrés** claves.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; `whodrugNotFound` y `vaccineRequired` están en los tres idiomas y **no son copia literal la una de la otra** — una dice que la vacuna no existe en el diccionario y la otra que falta la vacuna; `alreadyExists` lleva `{{doseNumber}}` en los tres.

4. **Validadores.** `src/validators/investigationVaccineAdministered.validator.ts` con seis arrays: `investigationVaccineAdministeredIdValidator`, `investigationVaccineAdministeredInvestigationIdValidator` (el `param('id')` de los dos listados), `investigationVaccineAdministeredCaseIdValidator` (el `param('caseId')` del `006`), `investigationVaccineAdministeredListValidator` (`limit` y `offset`, **sin filtros**), `createInvestigationVaccineAdministeredValidator` y `updateInvestigationVaccineAdministeredValidator`. El de create exige `investigationId` y **`vaccineWhodrugId`** con `.isUUID()`; el de update admite `vaccineWhodrugId` con `.isUUID()` **o `null`**; los dos comparten `doseNumber` con `.isInt({ min: 0, max: 32767 })` admitiendo `null` y `notes` como cadena. **Ni la obligatoriedad resultante ni la unicidad van aquí:** dependen del estado guardado y viven en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; un `POST` sin `vaccineWhodrugId` produce 400 en esta capa; un `PUT` con `vaccineWhodrugId: null` **no** produce 400 aquí —lo hará el servicio en el paso 9—; `doseNumber: -1` produce 400 y `0` **no**; `doseNumber: 40000` produce **400 y no un 500 de Postgres**; `sortOrder` en el body se ignora sin error.

5. **`ESAVI-INVVACAD-001` — crear.** Servicio, controlador y ruta `POST /` con `validateUserRole(USER)`. Transacción, guarda del padre, validación del maestro, unicidad de la terna, `.trim()` sobre `notes`, `create` **sin `sortOrder` y sin `fields`**, entrada de auditoría.
   *Verificación:* el alta mínima `{ investigationId, vaccineWhodrugId }` devuelve **201** con `doseNumber` y `notes` en `null`, `isActive: true` y `sortOrder: 1`; la segunda vacuna de la misma investigación recibe `sortOrder: 2`; una investigación inactiva devuelve **404** `investigationNotFound`; un `vaccineWhodrugId` inexistente o **inactivo** devuelve **404** `whodrugNotFound`; repetir la misma terna devuelve **409** `alreadyExists` con el `doseNumber` interpolado; **la misma vacuna con `doseNumber` distinto devuelve 201**; **dos filas de la misma vacuna sin `doseNumber` devuelven 409 la segunda** —es el criterio que prueba que el `null` compara con `IS NULL` y no con `= NULL`—; `{ doseNumber: 0 }` guarda `0` y no `null`.

6. **`ESAVI-INVVACAD-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, la guarda del padre, el `include` del maestro en `required: false`, `order: [['sortOrder','ASC']]`, paginación y la forma completa de §3.7. Dos rutas: `GET /investigation/:id` en USER y `GET /admin/investigation/:id` en ADMIN, declaradas antes de `/:id`.
   *Verificación:* `/investigation/:id` no devuelve las filas retiradas y `/admin/investigation/:id` sí; un USER recibe 403 en la admin; las dos devuelven **404** sobre una investigación inactiva, y **200** para SUPERADMIN; una investigación sin vacunas devuelve **200** con `count: 0`, no 404; las filas llegan ordenadas por `sortOrder` ascendente; toda fila trae las cuatro columnas de datos, `sortOrder`, `isActive`, `appDetails` y el objeto del maestro; ninguna trae `sysDetails` ni bloque `investigation`; `?limit=2` devuelve dos filas con el `count` total.

7. **`ESAVI-INVVACAD-003` — obtener por ID.** `getInvestigationVaccineAdministeredByIdService(id, lang, includeInactive)`, con el `include` del padre acotado a dos atributos y descartado, el del maestro resuelto, y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una fila retirada devuelve 404 para USER y 200 para SUPERADMIN; una fila cuya investigación está inactiva devuelve 404 para USER y ADMIN y 200 para SUPERADMIN; `vaccineWhodrug` llega con sus tres campos y `vaccineWhodrugId` viaja **también** suelto; `sysDetails` no aparece en ninguno de los objetos de la respuesta.

8. **`ESAVI-INVVACAD-006` — listar por caso.** `getInvestigationVaccineAdministeredByCaseIdService(caseId, lang, includeInactive)` con los **dos** 404 distintos de §3.5, devolviendo `{ count, rows }`. Ruta `GET /case/:caseId` en USER, declarada antes de `/:id`. Fila `investigationVaccineAdministered` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y vacunas devuelve 200 con `{ count, rows }`; un `caseId` inexistente devuelve 404 `INVVACAD_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVVACAD_006_INVESTIGATION_NOT_FOUND`, un código distinto del anterior; **una investigación sin vacunas devuelve 200 con `count: 0`, no 404**; `GET /case/no-es-uuid` devuelve 400.

9. **`ESAVI-INVVACAD-004` — actualizar, diferencial.** `updateInvestigationVaccineAdministeredService` con los nueve pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` y `sortOrder` ignorados; la obligatoriedad resultante, el maestro y la unicidad **antes** del diff. La lectura para el diff se hace **sin `attributes` acotados** y con el `include` del padre, para que la visibilidad heredada se compruebe en la misma consulta de la que sale la instancia. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; **`{ vaccineWhodrugId: null }` devuelve 400** `vaccineRequired`; `{ doseNumber: null }` **sí** vacía el campo; `{ doseNumber: 0 }` sobre una fila con `2` guarda `0`; enviar `investigationId` o `sortOrder` distintos no los modifica y no devuelve error; un `vaccineWhodrugId` inactivo devuelve **404 aunque coincida con el guardado**; cambiar `doseNumber` a uno ya ocupado por otra fila activa de la misma vacuna devuelve **409**.

10. **`ESAVI-INVVACAD-005A` — desactivar.** Delegación en `setEntityActiveStatusService`, controlador y ruta `DELETE /:id` en ADMIN.
    *Verificación:* sella `isActive: false` y `deletedAt`; repetir responde 409 `alreadyInactive`; **no comprueba el estado de la investigación** —retirar una vacuna de una investigación inactiva devuelve 200—; tras el `005A`, un alta nueva sobre la misma investigación puede recibir el `sortOrder` liberado; **y la misma terna se puede volver a registrar**; `appDetails` crece con `method: 'ESAVI-INVVACAD-005A'`.

11. **`ESAVI-INVVACAD-005B` — reactivar.** Transacción, guarda de unicidad de la terna, detección de colisión de `sortOrder`, reasignación previa y delegación, con los cinco pasos de §3.5 **en ese orden**. Ruta `PATCH /activate/:id` en ADMIN, declarada antes de `/:id`.
    *Verificación:* reactivar sin colisión conserva el `sortOrder` original; **reactivar cuando otra fila viva ya ocupa ese número la manda al final de la lista** y ninguna de las dos rompe el índice único parcial; una fila con `sortOrder: null` se reactiva sin tocar nada; repetir devuelve 409 `alreadyActive`; reactivar una fila cuya investigación se desactivó entretanto devuelve **200**; **reactivar una fila cuya terna volvió a registrarse entretanto devuelve 409 `alreadyExists`, la fila sigue retirada y su `sortOrder` no se ha movido** —eso último es lo que prueba que la guarda corre antes de la reasignación—; `appDetails` registra `ESAVI-INVVACAD-005B` solo en las reactivaciones que sí ocurren.

12. **`ESAVI-INVVACAD-005C` — purgar.** `purgeInvestigationVaccineAdministeredService` sobre `purgeEntityService`, con transacción propia, existencia con `paranoid: false` y **sin** visibilidad heredada. Volcado en `warn` de la fila completa antes del `destroy`. Ruta `DELETE /purge/:id` en SUPERADMIN, declarada junto a las otras literales.
    *Verificación:* purgar una fila **activa** devuelve 409 y la fila sigue ahí; desactivar y purgar devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; la investigación, sus otras satélites y **la entrada del maestro** siguen existiendo e intactas; queda una línea `warn` en `src/logs/esaviLog.log` con la fila completa.

13. **Ampliar el volcado de `purgeInvestigationService`.** El `count` con `paranoid: false` de §3.5 y su línea `warn`, junto a los que F29 a F36 ya dejaron, antes del `destroy` y en la misma transacción. **Es el único punto en que este spec toca `investigation.service.ts`.**
    *Verificación:* purgar una investigación con vacunas administradas deja **una línea `warn` más** que antes y **no** devuelve error; las filas desaparecen por la cascada de Postgres; una investigación sin vacunas no emite la línea; `git diff src/services/common/satelliteCascade.service.ts` y `git diff src/services/esaviCase.service.ts` están **vacíos**; los volcados de las siete satélites anteriores siguen emitiéndose igual.

14. **Registrar la entidad en las convenciones.** Fila `investigationVaccineAdministered` → `INVVACAD` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationVaccineAdministered` · `006` en la de operaciones no canónicas.
    *Verificación:* `INVVACAD` aparece una sola vez y no colisiona con las registradas; la tabla de no canónicas suma exactamente una fila.

15. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más nueve.
    *Verificación:* `npm test -- roles` pasa.

16. **Suite de contrato `tests/contract/investigationVaccineAdministered.test.ts`.** Recorrido completo con `supertest`: crear dos vacunas → obtener por ID → listar público y admin → listar por caso → actualizar → desactivar → reactivar → purgar. Más los caminos de error: investigación inexistente e inactiva (404), maestro inexistente e inactivo (404), terna repetida en `001` y en `004` (409), **la terna con `doseNumber` nulo en las dos filas** (409), `vaccineWhodrugId: null` en el `004` (400), `doseNumber` fuera de rango por arriba y por abajo (400), caso inexistente y caso sin investigación en el `006` (404 con códigos distintos), reactivar con colisión de `sortOrder`, **reactivar con la terna reocupada (409, con la fila intacta y su `sortOrder` sin mover) y el desbloqueo posterior retirando la fila nueva (200)**, y purgar una fila activa (409). Más el bloque diferencial completo de §5, con cobertura explícita del **`0`** en `doseNumber`.
    *Verificación:* `npm test -- investigationVaccineAdministered` en verde.

17. **Ampliar `tests/contract/investigation.test.ts`.** Tres casos: desactivar la investigación **no** toca las vacunas administradas, reactivarla tampoco, y purgar la investigación las destruye por cascada de Postgres sin devolver error. **Los casos que F29 a F36 añadieron a esa suite se mantienen intactos**, y los dos primeros son la comprobación de que esta entidad queda deliberadamente fuera del `cascadeSealSatellite`.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso; `tests/contract/esaviCase.test.ts` no se modifica.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVVACAD-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVVACAD-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "sortOrder" src/services/investigationVaccineAdministered.service.ts` aparece **solo** en el `005B`: ni el `001` lo manda, ni el `004` lo compara.
- [ ] `grep -n "fields:" src/services/investigationVaccineAdministered.service.ts` no devuelve resultados: el `create` no lleva lista explícita de campos, y por eso el trigger puede asignar el `sortOrder`.
- [ ] `doseNumber` está declarado en el modelo como `SMALLINT`, no como `INTEGER`.
- [ ] `INVVACAD` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigationVaccineAdministered` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` exporta el archivo nuevo.
- [ ] `GET .../admin/investigation/:id`, `.../investigation/:id`, `.../case/:caseId`, `DELETE .../purge/:id` y `PATCH .../activate/:id` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Investigation.hasMany(InvestigationVaccineAdministered, { as: 'vaccinesAdministered' })` está declarado, no colisiona con los seis alias de las satélites anteriores, y las vacunas **no** aparecen en ninguna respuesta de `/api/investigations`.
- [ ] `git diff esaviapp.sql` muestra **exactamente una línea añadida** —el índice— y ninguna modificada.

**La vacuna obligatoria y el maestro**

- [ ] `POST` sin `vaccineWhodrugId` → **400**, y con `vaccineWhodrugId: null` → **400** también.
- [ ] `PUT` con `{ vaccineWhodrugId: null }` sobre una fila guardada → **400** `vaccineRequired`. La columna no se puede vaciar por ningún camino.
- [ ] `PUT` **sin** la clave `vaccineWhodrugId` sobre esa misma fila → **200**. Ausente y `null` no son lo mismo, y este par de criterios es el que lo demuestra.
- [ ] `POST` y `PUT` con un `vaccineWhodrugId` que apunta a una entrada **inactiva** del maestro → **404** `whodrugNotFound`, en las dos operaciones.
- [ ] El maestro se resuelve con un `findOne` simple: `grep -n "CatalogType" src/services/investigationVaccineAdministered.service.ts` no devuelve resultados. No hay doble salto porque no hay catálogo del que colgar.
- [ ] Una fila cuyo maestro se desactivó **después** del registro sigue devolviéndose en el `003` y en los listados, con su objeto `vaccineWhodrug` resuelto: el `include` no filtra por `isActive`.
- [ ] La respuesta trae `vaccineWhodrugId` **suelto** además del objeto anidado.

**La unicidad de la terna**

- [ ] `POST` de la misma `(investigationId, vaccineWhodrugId, doseNumber)` dos veces → **409** `alreadyExists` la segunda, con el `doseNumber` interpolado.
- [ ] `POST` de la misma vacuna con `doseNumber` distinto → **201**. La dosis forma parte de la identidad.
- [ ] **`POST` de la misma vacuna sin `doseNumber` dos veces → 409 la segunda.** Es el criterio que prueba que el nulo se compara con `IS NULL` y no con `= NULL`; sin él el duplicado entra y ningún otro caso lo detecta.
- [ ] `PUT` que mueve una fila a una terna ya ocupada por otra activa → **409**; el mismo `PUT` sobre la propia fila → **200**, porque se excluye con `{ [Op.ne]: id }`.
- [ ] Tras un `005A`, la misma terna se puede registrar de nuevo con **201**: la unicidad solo mira las filas activas.
- [ ] **`005B` sobre esa fila retirada, con la terna ya reocupada, responde 409** `alreadyExists`; la fila sigue retirada, su `sortOrder` **no** se ha movido y su `appDetails` no ha crecido. Es el criterio que prueba que la guarda de unicidad corre **antes** de la reasignación de orden.
- [ ] Retirar la fila nueva y repetir el `005B` sobre la vieja responde **200**: el conflicto era de estado, no permanente.
- [ ] `grep -n "ALREADY_EXISTS" src/services/investigationVaccineAdministered.service.ts` aparece en **tres** operaciones —`001`, `004` y `005B`—, con la misma clave i18n en las tres.

**El `sortOrder` gobernado por la base**

- [ ] Tres altas seguidas sobre la misma investigación reciben `sortOrder` 1, 2 y 3 sin que la aplicación lo envíe nunca.
- [ ] Mandar `sortOrder` en el body del `001` o del `004` no cambia nada y **no** devuelve 400.
- [ ] Un `005A` libera el número: el alta siguiente lo reutiliza.
- [ ] Un `005B` sobre una fila cuyo número ya lo tomó otra viva la reubica al final y **ninguna de las dos** viola `UQ_investigationVaccineAdministered_parent_sortOrder`.
- [ ] Los dos listados devuelven las filas ordenadas por `sortOrder` ascendente.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationVaccineAdministered.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con una terna ya ocupada **409**, aunque el resto del body no cambie nada.
- [ ] **`{ doseNumber: 0 }` sobre una fila con `2` guarda `0`**, y `{ doseNumber: null }` la vacía. Ningún candidato entra bajo un `if( data.x )`.
- [ ] `{ notes: "" }` deja el campo vacío, y un `notes` con espacios alrededor del mismo texto guardado **no** cuenta como cambio: el `.trim()` va antes de comparar.
- [ ] Un `PUT` sobre una fila cuya investigación está inactiva responde **404** para USER y ADMIN y **200** para SUPERADMIN.

**Estado, purgado y aislamiento**

- [ ] `005A` sella `isActive: false` y `deletedAt`; repetirlo devuelve 409 `alreadyInactive`.
- [ ] `005B` devuelve `isActive: true` y `deletedAt: null`; repetirlo devuelve 409 `alreadyActive`.
- [ ] `005B` sobre una fila cuya investigación se desactivó entretanto responde **200**: el estado propio no depende del padre. Y sobre una fila cuyo maestro se desactivó entretanto, **200** también.
- [ ] `005C` sobre una fila **activa** responde **409** y la fila sigue ahí. El control de `isActive` de `purgeEntityService` es efectivo aquí, y `grep -n "assertRowIsSealed" src/services/investigationVaccineAdministered.service.ts` no devuelve resultados.
- [ ] `005C` sobre una fila retirada responde 200 sin `data`, la destruye y deja una línea `warn` con la fila completa; la entrada del maestro sigue intacta.
- [ ] **Desactivar y reactivar la investigación no toca estas filas:** su `deletedAt`, su `isActive` y su `appDetails` quedan exactamente igual. Es el criterio que prueba que la entidad queda fuera del `cascadeSealSatellite`, y por tanto `git diff src/services/common/satelliteCascade.service.ts` y `git diff src/services/esaviCase.service.ts` están **vacíos**.
- [ ] Purgar la investigación las destruye por cascada de Postgres, sin error, y deja **una línea `warn` más** que antes en `src/logs/esaviLog.log`.
- [ ] Las suites de contrato de F29 a F36 pasan **sin que se haya tocado un solo caso**.

**Cierre**

- [ ] Las veintitrés claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la vacuna obligatoria**

- **Sí: `vaccineWhodrugId` obligatorio a nivel de aplicación. No: seguir el DDL y admitir la fila sin vacuna.** Es el primer spec del repositorio que endurece a obligatoria una FK que el esquema declara anulable, y la razón es que esta tabla no tiene el respaldo que sí tenía `notificationVaccine`. F22 §1 llamó a aquel diseño «codificado **o** crudo»: la FK podía faltar porque `vaccineName` guardaba el nombre sin codificar. Aquí no hay «o». Una fila sin `vaccineWhodrugId` afirma que se administró una vacuna y es incapaz de decir cuál, y aguas abajo no sirve para nada: ni para contar, ni para cruzar con la notificación, ni para clasificar.
- **No: añadir un `vaccineName` de texto crudo para poder tolerar la FK nula.** Sería copiar el diseño de `notificationVaccine` en una tabla que el esquema no diseñó así, y obligaría a modificar el DDL. La investigación se hace **después** de la notificación, con el diccionario ya a mano: si la vacuna no está codificada, el problema es del maestro y se resuelve en F19, no aquí.
- **No: cambiar `esaviapp.sql` para poner `NOT NULL` en la columna.** Modificar el esquema afecta a datos ya cargados y a la carga del DDL en los tests, y el `NOT NULL` no distingue «falta» de «no aplica» con un mensaje legible: un fallo de integridad de Postgres es un 500, y lo que el cliente necesita es un 400 que diga qué falta. La aplicación es la capa que puede decirlo.
- **Sí: la obligatoriedad repartida entre validador (`001`) y servicio (`004`).** En el alta el body es el estado completo y el validador basta. En el update «ausente» significa «no lo toques», y solo el servicio sabe qué hay guardado. Por eso el validador del `004` admite `null` y es el servicio quien lo rechaza: un validador que lo prohibiera de entrada devolvería el 400 correcto por el motivo equivocado, y bloquearía además la única forma de escribir el criterio «un `PUT` que reenvía el `GET` no escribe nada».

**Sobre la unicidad**

- **Sí: unicidad de `(investigationId, vaccineWhodrugId, doseNumber)` entre filas activas.** El DDL no la impone y la lista la necesita: es un recuento que después se cruza con `notificationVaccine` y con la clasificación, y un duplicado no es un dato, es ruido que altera el total.
- **Sí: `doseNumber` dentro de la terna, con su `null` incluido.** Dos filas de la misma vacuna sin número de dosis son la misma fila repetida. Dejar el nulo fuera de la comparación sería el agujero exacto por el que entran los duplicados que esta regla existe para impedir, y por eso tiene criterio de aceptación propio.
- **No: unicidad solo sobre `(investigationId, vaccineWhodrugId)`.** Una pauta con refuerzo administra la misma vacuna dos veces, y es dato legítimo. La dosis forma parte de la identidad de la fila.
- **No: llevar la unicidad al DDL como índice único parcial.** Se valoró, y se descarta por lo mismo que el `NOT NULL`: un fallo de índice es un 500 y lo que el cliente necesita es un 409 con el `doseNumber` interpolado. Además, un índice único sobre una terna con nulos se comporta distinto según el motor, y aquí la semántica «dos nulos colisionan» es justo la contraria de la que Postgres da por defecto.
- **Sí: comparar solo contra filas activas. Sí: bloquear el `005B` cuando la terna volvió a ocuparse.** Son las dos caras de la misma regla. Que la unicidad mire solo la lista viva es lo que permite volver a registrar una vacuna retirada por error; y precisamente por eso el `005B` es la **tercera puerta** por la que un duplicado puede entrar en esa lista, junto al `001` y al `004`. Una regla que se comprueba en dos de las tres puertas no es una regla, es una costumbre. Se valoró dejar pasar la reactivación —argumentando que un `005B` es una operación de estado y no de dato, que es el criterio de F31 §3.5— y se descarta: lo que importa no es por qué puerta entra el duplicado, sino que la lista viva quede con dos filas idénticas, que es exactamente lo que la unicidad existe para impedir. Y el resultado sería peor que un 409: dos filas indistinguibles que ninguna operación posterior puede desempatar.
- **Y la consecuencia se asume por escrito: una fila puede quedar irrecuperable.** Si su terna se reocupó mientras estaba retirada, ya no se puede reactivar nunca por esa vía. Las dos salidas son retirar la fila nueva con `005A` y reactivar entonces la vieja —el conflicto es de estado, no permanente—, o purgar la vieja con `005C`. Se valoró un desempate automático —renumerar la dosis, reactivar y retirar la otra— y se descarta: elegir cuál de las dos filas sobrevive es una decisión del investigador, no del servicio, y tomarla en silencio destruiría la que no eligió.
- **Sí: 409 y no 400. Sí: la misma clave `alreadyExists` que el `001` y el `004`.** Lo primero lo impone `CONVENTIONS.md` §10 —409 para todo duplicado— y además es lo correcto de fondo: el `005B` no lleva body, así que no hay nada mal formado que reprochar al cliente; lo que hay es un conflicto con el estado de la tabla. Lo segundo es para que el cliente trate el conflicto igual venga de donde venga: el problema que el usuario tiene que resolver es el mismo en las tres operaciones.

**Sobre `doseNumber`**

- **Sí: techo de 32767 en el validador. No: dejarlo sin tope como decidió F22 §6.** Es una divergencia consciente con un spec anterior y conviene que quede escrita. El razonamiento de F22 —«un tope inventado rompería una pauta de refuerzos futura»— es correcto sobre un tope **de dominio**, y este no lo es: 32767 es la capacidad declarada de la columna `smallint`. Sin él, un `40000` no se guarda de todas formas; simplemente falla como **500 de Postgres** en vez de como 400 legible. F36 §6 tomó ya esta decisión sobre sus cuatro contadores y es la que se hereda. **`notificationVaccine` no se toca:** unificarlo es su propio spec.
- **Sí: `0` válido.** El `CHECK` del DDL lo admite y una pauta puede numerar desde cero. Es también la razón por la que ningún candidato entra bajo un `if( data.x )`.
- **No: derivar nada de `doseNumber`** —una secuencia esperada, una validación de que la dosis 3 no llegue antes que la 2, una pauta—. Exigiría un modelo de esquema de vacunación que el repositorio no tiene.

**Sobre la forma y el estado**

- **Sí: `sortOrder` asignado por el trigger, con el `create` sin `fields`.** La columna es anulable y sin `DEFAULT 0`, que es la anomalía que F35 §1 documentó, y aprovecharla ahorra la lista `CREATE_FIELDS` que F16 §3.2 impuso a las siete tablas que sí llevan `NOT NULL DEFAULT 0`.
- **Sí: `sortOrder` inmutable en el `004`, ignorado sin 400.** Reordenar es una operación sobre N filas con transacción propia, y tiene su propio spec pendiente desde F16.
- **Sí: la reasignación de `sortOrder` del `005B`, declarada no diferencial.** Escritura con intención propia sobre un campo que el cliente no envió ni puede enviar: nace de una restricción de la base, no de comparar un valor entrante contra el guardado. Es la decisión de F31 y F35, heredada sin reabrirse.
- **Sí: no incluir la investigación en la respuesta.** Es la decisión de F35 y no la de F31, y se separa de aquélla porque aquí el padre no aporta nada al cliente: F31 devolvía `investigation` con su `status` y su `case` porque el bloque de equipo se consulta a veces sin contexto previo, mientras que este listado se pinta **dentro** del formulario de la investigación, que ya tiene esos datos en pantalla. Repetirlos en cada una de las N filas es peso sin lector. El padre se consulta igualmente en toda lectura, con `attributes` acotados, y se descarta.
- **Sí: el maestro con tres campos —`vaccineWhodrugId`, `drugCode`, `drugName`— y sin filtrar por `isActive`.** Las otras veintiséis columnas son gobernanza del diccionario, no dato de la investigación. Es la decisión de F22 §6, heredada literalmente para que las dos entidades que consumen el maestro lo devuelvan igual.
- **Sí: la FK cruda junto al objeto resuelto**, al modo de F16, F21 y F22. El `004` acepta `vaccineWhodrugId` en el body, así que el criterio «un `PUT` que reenvía el `GET` no escribe nada» exige que esté en el `GET`.
- **Sí: el `include` del maestro en `required: false`**, aunque la aplicación garantice la FK. Con `required: true`, una fila cargada por SQL directo sin `vaccineWhodrugId` desaparecería del listado sin dejar rastro, que es el error clásico de una FK anulable resuelta con include.
- **Sí: forma completa también en los listados. No: una forma reducida.** Cuatro columnas de datos y un objeto de tres campos; recortarlas dejaría un listado sin contenido.

**Sobre el alcance**

- **Sí: quedar fuera del `cascadeSealSatellite`, como F31 y F35.** No es una omisión: la tabla tiene `isActive` y por tanto estado propio, y sellarle el `deletedAt` desde el padre convertiría en indistinguibles «la retiró un investigador» y «su investigación estaba retirada». Las satélites que sí se sellan lo hacen porque **no** tienen otra marca de estado. Que desactivar la investigación no toque estas filas tiene criterio de aceptación propio, precisamente para que nadie lo lea como un olvido.
- **Sí: dejar disparar el `ESAVI-INVESTGN-005C` con las vacunas colgando, con el volcado en `warn` como única mitigación. No: bloquearlo.** Es la decisión de F13 y de F29 a F36, heredada sin reabrirse.
- **Sí: el índice `IX_investigationVaccineAdministered_investigation`.** Lo justifica el `002B`: el índice parcial existente excluye las filas selladas y las de `sortOrder` nulo, que son justo las que aquel listado devuelve. Es lo que F31 y F35 hicieron sobre sus propias tablas.
- **No: filtros en los listados.** Ya están acotados por el padre, y una investigación tiene pocas vacunas. El primer filtro por dato de dominio abre la puerta a los tableros, como F36 §6 razonó.
- **No: precargar las vacunas desde `notificationVaccine` en el `001`, ni contrastarlas después.** Es exactamente el trabajo del investigador —confirmar o desmentir lo notificado— y automatizarlo exige decidir antes cuál de las dos tablas manda. Esa decisión no está tomada, y tomarla de paso en este spec sería tomarla mal.
- **Sí: `INVVACAD`, la abreviatura que F36 §6 reservó.** No se acuña nada nuevo: aquel spec la apartó precisamente para que `INVVACTX` y ésta no se confundan en un `grep` del log, y usar otra ahora desperdiciaría esa previsión.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El maestro `vaccineWhodrug` está vacío y ningún `POST` puede tener éxito.** Es el riesgo principal del spec y la consecuencia directa de hacer obligatoria la FK: a diferencia de F22, aquí no hay texto crudo con el que salvar el registro | La importación de [F19](./19-vaccinewhodrug-bulk-import.md) es precondición declarada en §2, no una nota al margen. En un entorno nuevo hay que ejecutarla **antes** de exponer el formulario de investigación, y el 404 `whodrugNotFound` es el síntoma que hay que saber leer |
| Un `if( data.doseNumber )` descarta el `0` en silencio, y la dosis cero se vuelve inexpresable | §3.5 lo prohíbe explícitamente y §5 lo verifica. Es el mismo fallo que F34 y F36 documentaron sobre sus propios campos |
| La unicidad se implementa con `Op.eq` sobre `doseNumber` y **el nulo no colisiona nunca**, así que el duplicado más probable —la misma vacuna dos veces sin dosis— entra sin que nada lo note | Es un fallo silencioso: ningún otro caso lo detecta. Tiene criterio de aceptación propio en §5 y verificación explícita en el paso 5 del plan. Sequelize genera `IS NULL` con `{ doseNumber: null }`, y ésa es la forma que el servicio debe usar |
| El `create` se escribe con `fields:` o con `sortOrder: 0`, y el trigger deja de asignar el orden | El paso 5 verifica que tres altas reciben 1, 2 y 3, y §5 lo comprueba con `grep -n "fields:"`. Es el mismo tropiezo que F35 §1-B evitó |
| El `005B` se implementa delegando sin más en `setEntityActiveStatusService`, sin la reasignación, y la reactivación viola el índice único parcial con un 500 | Solo ocurre cuando el número quedó ocupado, así que un test ingenuo pasa. El paso 11 y §5 lo ejercitan con la colisión provocada a mano |
| La guarda de unicidad del `005B` se coloca **después** de la reasignación de `sortOrder`, y una reactivación rechazada deja la fila movida de sitio: el 409 llega, pero el orden ya cambió y `appDetails` registra un movimiento que nadie pidió | El orden de los pasos 2 y 3 está fijado en §3.5 con su razón, y §5 lo verifica comprobando que tras el 409 **el `sortOrder` no se ha movido**. Sin ese criterio el fallo es invisible: la respuesta HTTP es idéntica |
| Una fila queda irrecuperable porque su terna se reocupó mientras estaba retirada, y quien la reactiva no entiende por qué el 409 no se va | Es consecuencia aceptada, no defecto, y está razonada en §6 con las dos salidas: retirar la fila nueva, o purgar la vieja. El mensaje lleva el `doseNumber` interpolado, que es el dato con el que el usuario encuentra la fila que estorba |
| Alguien añade esta tabla al `cascadeSealSatellite` «por simetría» con F29, F30, F32, F34 y F36, y el `deletedAt` deja de distinguir quién retiró la fila | §6 lo razona y §5 tiene el criterio inverso: desactivar y reactivar la investigación **no** debe tocar nada aquí. Los `git diff` vacíos de `satelliteCascade.service.ts` y `esaviCase.service.ts` son parte del checklist |
| El techo de 32767 se omite «porque F22 no lo puso», y un `doseNumber` grande devuelve 500 | La divergencia está declarada en §1, §2, §3.5 y §6, con criterio de aceptación propio. F22 no se toca, y eso también está escrito |
| `GET /:id` captura `admin`, `investigation`, `case`, `purge` y `activate` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato y por un criterio de §5 |
| Un `PUT` con `vaccineWhodrugId: null` se traga el nulo y vacía la columna, deshaciendo el endurecimiento por la puerta de atrás | Es la razón por la que el candidato entra como anulable y la regla vive **antes** del diff, en el paso 4 del `004`. §5 lo verifica junto al caso contrario —la clave ausente— para que el par no se pueda confundir |

---

## Lo que **no** está en este spec

- Las cuatro satélites de `investigation` que siguen sin spec: `investigationCovidHistory`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- Cualquier regla cruzada con `notificationVaccine`: ni precarga, ni contraste, ni marcado de discrepancias entre lo notificado y lo investigado.
- Cualquier regla cruzada con `investigationVaccinationContext`, `investigationColdChain` o `investigationAdministrationError`.
- Reordenar las vacunas de una investigación — el `007` que el `sortOrder` inmutable deja pendiente desde F16.
- Cualquier filtro de listado por `vaccineWhodrugId`, por `doseNumber` o por texto sobre `notes`.
- Cualquier resolución o acuñación contra `vaccineWhodrug`: el maestro se puebla por importación, no por formulario.
- Denormalizar nada del maestro en esta tabla, ni un `vaccineName` de respaldo.
- Derivar nada de `doseNumber`: pautas, secuencias esperadas o validaciones de orden entre dosis.
- Convertir `vaccineWhodrugId` en `NOT NULL` en el DDL, ni llevar la unicidad de la terna a un índice único.
- Cambiar el `doseNumber` sin techo de `notificationVaccine`.
- Sellar estas filas desde `ESAVI-INVESTGN-005A`, `005B` o `ESAVI-CASE-005A`, ni bloquear el `ESAVI-INVESTGN-005C`.
- Modificar `esaviapp.sql` más allá del índice, ni `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService` o `buildDifferentialUpdate`.
- Añadir el listado dual a `severeNotification` y `nonSevereNotification`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
