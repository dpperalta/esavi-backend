# SPEC F31 — CRUD de `investigationTeamMember`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: es el padre de esta tabla)**, **SPEC F16 (`notificationEvent` — aporta el hallazgo del `sortOrder` en el `005B` y la nota de `CREATE_FIELDS`)**, **SPEC F27 (`notificationPregnancyComplication` — hermana de forma: la colección con `sortOrder`, el índice añadido al DDL y la reasignación del `005B`)**, SPEC F29 y SPEC F30 (`investigationSource` e `investigationAutopsy` — hermanas de padre: aportan la visibilidad heredada de `investigation`), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-21
> **Objetivo:** Dar de alta `investigationTeamMember` —quiénes investigaron el caso— como la **tercera** de las catorce tablas satélite de `investigation`, y la **primera de ellas que es una colección con estado propio**.

---

## 1. Por qué existe este spec

`investigationTeamMember` responde a la última pregunta del formulario de investigación, la que firma el documento: **quién investigó**. Nombre, institución, correo, teléfono y unas notas, por cada persona del equipo. N filas por investigación, ordenadas.

Hoy la tabla existe en `esaviapp.sql:995-1011` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **tercera de las catorce satélites de `investigation`**, después de las que dieron de alta el [SPEC F29](./29-investigationsource-crud.md) y el [SPEC F30](./30-investigationautopsy-crud.md). Comparte con ellas el padre y la visibilidad heredada, y **no comparte nada más de su forma**. De las dos cosas que las hermanas fijaron, una se hereda y la otra se rompe:

- **Se hereda la visibilidad del padre.** Toda lectura incluye `investigation` con `required: true`: si la investigación está inactiva, el miembro responde 404 para USER y ADMIN, y 200 para SUPERADMIN vía `canViewInactive`. Es literalmente el mismo mecanismo de F29 §3.5, y no se reabre.
- **Se rompe la forma de la tabla.** F29 y F30 son uno a uno con la PK compartida: `investigationId` era su clave primaria. Aquí hay **PK propia** (`investigationTeamMemberId`, `:996`, con `DEFAULT gen_random_uuid()`) y `investigationId` es una FK `NOT NULL` corriente (`:997`). No hay unicidad que defender, no hay 409 de «ya tiene», y el `003` deja de ser el acceso por investigación.

**Lo que la separa, y es la razón de que el spec no sea un calco de ninguna de las cinco entidades que se le parecen.** Cuatro cosas:

**A — Es la primera satélite de `investigation` con `isActive`, y con ella vuelven las siete operaciones canónicas.** `isActive boolean NOT NULL DEFAULT true` (`:1004`). F13, F14, F29 y F30 son las cuatro tablas del repositorio sin esa columna, y las cuatro renunciaron a `005A` y `005B` porque no había estado propio que activar. Aquí lo hay: retirar a una persona del equipo investigador es un hecho del dominio con significado propio —se equivocaron al anotarla, o dejó de participar— y no depende de que su investigación siga viva. **De ahí sale la consecuencia directa: no hay cascada.** Ni `ESAVI-INVESTGN-005A` ni `ESAVI-CASE-005A` tocan estas filas, a diferencia de las cuatro funciones `cascadeSeal*` que hoy viven en `investigation.service.ts` y `esaviCase.service.ts`. Un `isActive` propio que una cascada pisara dejaría de significar nada, y al reactivar la investigación no habría forma de distinguir a quien se retiró a mano de quien arrastró el padre. La visibilidad la aporta el include; el estado, la columna.

**B — Arrastra el hallazgo del `005B` de F16, y es la sexta vez.** Figura en el bucle `setSortOrderByParent` con `investigationId` como padre (`:1317`) y tiene índice único parcial `UQ_investigationTeamMember_parent_sortOrder` sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1349-1351`). El trigger es `BEFORE INSERT` solamente, y `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número: reactivar a un miembro cuyo `sortOrder` ya lo tomó otro hermano vivo revienta el índice. F16 lo descubrió, F21, F22, F24 y F27 lo arrastraron, y aquí vuelve entero. Es la razón de que el `005B` **no** delegue sin más en `setEntityActiveStatusService`.

**C — Es la primera tabla del bloque de investigación con datos personales, y se declara que no se cifran.** `fullName`, `email` y `phone` identifican a personas reales. La decisión es **no cifrar**, y se razona en §6: el equipo investigador es personal sanitario actuando en función pública, no el paciente; `email` es `citext` (`:1000`) precisamente para comparar sin distinguir mayúsculas, y `esaviCrypt` —determinista, con IV fijo— dejaría esa propiedad de la columna inerte. Es la misma línea de `notifier`, y la contraria a `appUser`. **Es la decisión más cara de revertir de todo el spec.**

**D — Es la primera colección del repositorio cuya guarda de duplicado se apoya en un campo de texto libre.** No hay `UNIQUE` en el DDL ni catálogo que resolver: la guarda compara `fullName` ya normalizado con `toTitleCase` contra las filas **activas** de la misma investigación. F27 comparaba un par de UUIDs; aquí se comparan nombres escritos a mano, con todo lo que eso implica —y lo que **no** cubre queda declarado en §7.

**Y dos rasgos que no la separan:** el `ON DELETE CASCADE` de su FK (`:1010`) dispara de verdad, porque `investigation` no figura en el bucle `preventPhysicalDelete` (`:1364-1377`), así que un `ESAVI-INVESTGN-005C` arrastra estas filas sin preguntar; y tampoco existe `TRG_investigationTeamMember_setUpdatedAt` —el bucle genérico lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationTeamMember`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Nueve operaciones:** las siete canónicas (`001`, `002A`, `002B`, `003`, `004`, `005A`, `005B`), más `005C` de borrado físico y la no canónica `006` listar por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Es la primera satélite de `investigation` con `005A` y `005B`**, porque es la primera con `isActive`. F29 y F30 renunciaron a las dos y aquí vuelven enteras.
- **Listado por padre, no global.** `002A` en `GET /investigation/:investigationId` para USER devuelve solo los miembros activos; `002B` en `GET /admin/investigation/:investigationId` para ADMIN los devuelve todos, incluidos los de `deletedAt` sellado. **Sin ningún filtro por query**, ordenados por `sortOrder` ascendente y paginados con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Es el patrón de colección de F27, no el listado global con filtros de F29 y F30.
- **Relación uno a N con `investigation`**, con PK propia. Una investigación admite cuantos miembros haga falta; **no hay 409 de «ya tiene»** y el `003` entra por el `investigationTeamMemberId`, no por el `investigationId`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, el miembro responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`. Los dos listados devuelven 404 sobre una investigación inactiva, con el mismo criterio.
- **Sin cascada desde el padre.** Ni `ESAVI-INVESTGN-005A`, ni `ESAVI-INVESTGN-005B`, ni `ESAVI-CASE-005A` tocan estas filas. `investigation.service.ts` y `esaviCase.service.ts` **no se modifican**: es el primer spec de satélite de investigación que no añade una función `cascade*`. La razón está en §1.A y la decisión, razonada en §6.
- **Guarda del alta:** la investigación existe y está **activa** → 404 `INVTEAM_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe miembros nuevos.
- **Guarda de duplicado sobre `fullName` normalizado**, en `001` y en `004` → 409 `INVTEAM_<op>_ALREADY_EXISTS`. Compara el valor ya pasado por `toTitleCase` contra las filas **activas** de la misma investigación, excluyendo la propia fila en el `004`. No está respaldada por ninguna restricción de base: es regla de negocio del servicio.
- **`fullName` obligatorio en el `001` y no anulable en el `004`.** Es la única columna de datos `NOT NULL` de la tabla. Modificable —un nombre se corrige— pero un `fullName: null` es **400**.
- **`institutionName`, `email`, `phone` y `notes` anulables en el `004`**, con `null` explícito como forma de borrar el dato.
- **`investigationId` y `sortOrder` inmutables**, ignorados en silencio en el `004`, sin 400. Un miembro no se traslada entre investigaciones y su orden lo gobierna la base.
- **`sortOrder` asignado por la base.** El `001` nunca lo envía —lo pone `TRG_investigationTeamMember_setSortOrder` (`:1317`)—. Exige la lista explícita `CREATE_FIELDS` en el `create`, por la razón que F16 §3.2 documentó: sin ella la validación `notNull` de Sequelize mata el alta antes de que el trigger llegue a ejecutarse.
- **Reasignación de `sortOrder` en `ESAVI-INVTEAM-005B`** cuando el número que ocupaba la fila ya lo tomó otro miembro vivo de la misma investigación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5, y la razón por la que la activación no delega sin más en `setEntityActiveStatusService`.
- **Normalización al escribir:** `toTitleCase` sobre `fullName`; `.trim()` + `.toLowerCase()` sobre `email`; `.trim()` sobre `phone` y `notes`. **`institutionName` se guarda tal cual lo escribe el investigador**, solo con `.trim()`: `toTitleCase` convertiría `MINSAL` en `Minsal`. Ningún campo lleva `toConstantCase` — no hay `code`.
- **Sin cifrado de ningún campo.** Decisión declarada en §1.C y razonada en §6.
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo: nada cuelga de un miembro. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial, igual que en F16 y F27.
- **Guarda del `005C`: la fila debe estar inactiva.** La aporta el control de `isActive` que `purgeEntityService` ya lleva dentro, que aquí **sí es efectivo** —a diferencia de F29 y F30, donde la columna no existía y el control era inerte—. No se consume `assertRowIsSealed` ni se toca `rowSeal.helper.ts`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5: dos inmutables que no entran, uno obligatorio no anulable y cuatro anulables.
- **Una línea nueva en `esaviapp.sql`:** el índice `IX_investigationTeamMember_investigation` sobre `("investigationId")`. Hoy el único índice sobre esa columna es el parcial de `sortOrder`, que excluye precisamente las filas con `deletedAt` sellado que el `002B` tiene que leer. Es lo que hicieron F21, F22, F24 y F27.
- Alta de la abreviatura **`INVTEAM`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/investigationTeamMember.test.ts`.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado` —lo está—. `investigation` es el padre de esta tabla y el include obligatorio de toda lectura.

**Fuera de alcance (otros specs):**

- **Las otras once satélites de `investigation`:** `investigationCovidHistory` (`esaviapp.sql:1013-1035`), `investigationMedicalHistory` (`1037-1064`), `investigationPregnancyCondition` (`1066-1081`), `investigationClinicalEvaluation` (`1083-1107`), `evaluationInstitution` (`1109-1128`), `investigationVaccinationContext` (`1130-1151`), `investigationVaccineAdministered` (`1153-1168`), `investigationColdChain` (`1170-1193`), `investigationAdministrationError` (`1195-1229`) e `investigationCommunity` (`1231-1249`).
- **Reordenar miembros** — un `007` que mueva a uno de posición y desplace a sus hermanos. Es lo que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. Su propio spec, y el mismo que F16 §2 y F27 §2 dejaron abierto.
- **Vincular un miembro del equipo con un `appUser`.** La tabla no tiene FK a `appUser` y este spec no la añade: `fullName` es texto libre, no una referencia. Si la vinculación se quiere, es un cambio de esquema y su propio spec.
- **Cualquier deduplicación real de personas** — normalizar acentos, detectar `Juan Pérez` frente a `Juan Perez`, o cruzar por `email`. La guarda de §3.5 compara `fullName` tras `toTitleCase` y nada más. Lo que no cubre está en §7.
- **Cualquier filtro de listado** por `institutionName`, por `email` o por texto. Los dos listados devuelven todos los miembros de su investigación, paginados y ordenados por `sortOrder`.
- **Cualquier regla que exija al menos un miembro** para cerrar una investigación, o que valide su composición. Una investigación sin equipo registrado es válida hoy y lo sigue siendo.
- **Exigir `email` o `phone`.** Los dos son opcionales en el DDL y lo siguen siendo aquí: hay miembros de los que solo se anota el nombre.
- **Cifrado de `fullName`, `email` o `phone`.** Descartado en §6.
- **Añadir cascada desde `investigation` o desde `esaviCase`.** Descartado en §6. `investigation.service.ts` y `esaviCase.service.ts` no se tocan.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene miembros.** Se deja disparar la cascada de Postgres, con el volcado al log como única mitigación —el mismo que F29 y F30 ya dejaron puesto en `purgeInvestigationService`, ampliado con estas filas.
- **Modificar `esaviapp.sql`** más allá del índice: ni el trigger de `sortOrder`, ni el índice único parcial, ni el `CHECK`, ni el `ON DELETE CASCADE`, ni el tipo `citext` de `email`.
- **Modificar `setEntityActiveStatusService`, `purgeEntityService` o `assertRowIsSealed`.** Los tres se consumen tal cual están, y el tercero ni siquiera se consume.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationTeamMember` — `esaviapp.sql:995-1011`. Se le añade **un índice** y nada más.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationTeamMemberId` | `uuid` | no | **PK propia** con `DEFAULT gen_random_uuid()` (`:996`) |
| `investigationId` | `uuid` | no | `FK_investigationTeamMember_investigation` → `investigation`, `ON UPDATE CASCADE ON DELETE CASCADE` (`:1010`) |
| `fullName` | `varchar(250)` | no | **única columna de datos obligatoria** (`:998`) |
| `institutionName` | `varchar(500)` | sí | `:999` |
| `email` | `citext` | sí | `:1000`. Comparación case-insensitive en base |
| `phone` | `varchar(50)` | sí | `:1001` |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)` (`:1002`). Lo asigna el trigger; la aplicación no lo envía |
| `notes` | `text` | sí | `:1003` |
| `isActive` | `boolean` | no | `DEFAULT true` (`:1004`) |

**Restricciones.** Una sola clave foránea y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla.** La única unicidad de base vive fuera, en el índice parcial `UQ_investigationTeamMember_parent_sortOrder` sobre `("investigationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL` (`:1349-1351`). Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `B` de §1. **La guarda de duplicado de `fullName` no está respaldada por ninguna restricción**: es regla de negocio del servicio.

**El índice que falta, y que este spec añade.** Hoy no existe ningún índice sobre `investigationId` a secas: el parcial de arriba lo cubre solo para las filas vivas. El `002B` lee precisamente las otras. Se añade **una línea**:

```sql
CREATE INDEX IF NOT EXISTS "IX_investigationTeamMember_investigation"
  ON "investigationTeamMember" ("investigationId");
```

**`citext` en `email`.** Es el único uso del tipo en las 45 tablas junto al de `appUser`. La comparación en base ya ignora mayúsculas; la aplicación normaliza igualmente a minúsculas al escribir, para que el diff del `004` compare texto estable y no produzca una diferencia inventada entre `Ana@x.cl` y `ana@x.cl`.

**Las columnas transversales están todas.** `isActive`, `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. Es la primera satélite de `investigation` que no le falta ninguna.

**Triggers. Dos.** `TRG_investigationTeamMember_setSysDetails`, del bucle genérico (`:1284-1298`). Y `TRG_investigationTeamMember_setSortOrder`, del bucle de orden (`:1305-1331`), que ejecuta `setSortOrderByParent('investigationId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` de la misma investigación, bajo `pg_advisory_xact_lock`. **No hay** `preventPhysicalDelete` —la tabla no figura en `:1364-1377`—, así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. **No hay** `setUpdatedAt`: lo escribe la aplicación.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationTeamMember.model.ts`. Clase `InvestigationTeamMember`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationTeamMember'`.

`investigationTeamMemberId` es la PK **con** `defaultValue: sequelize.literal('gen_random_uuid()')` — a diferencia de F29 y F30, donde la PK era la FK y la aportaba el cliente. Aquí el id lo mina la base.

`fullName` va `DataTypes.STRING(250)` con `allowNull: false`. `institutionName` va `DataTypes.STRING(500)`, `email` y `phone` `DataTypes.STRING(50)` el segundo, `notes` `DataTypes.TEXT`, todos `allowNull: true`. `email` se declara como `DataTypes.STRING` sin longitud: `citext` no la tiene.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, por la razón que F16 §3.2 documentó: un `defaultValue: 0` haría que el `INSERT` mandara el `0` que el trigger interpreta como «asígnamelo tú», y funcionaría por accidente.

> **Nota de implementación, heredada de F16 y confirmada por F27.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere con `notNull Violation: InvestigationTeamMember.sortOrder cannot be null` y el trigger nunca se ejecuta. Lo que deja la columna fuera de la sentencia es la lista explícita: `InvestigationTeamMember.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y **sin** `sortOrder` ni `investigationTeamMemberId`.

Asociaciones, en `src/models/associations/investigationTeamMember.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationTeamMember.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasMany(InvestigationTeamMember, { as: 'teamMembers', foreignKey: 'investigationId' })` — `hasMany` y no `hasOne`: es la primera satélite de `investigation` que es colección.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia.

### 3.3 Tipos

`src/types/investigation/investigationTeamMember.types.ts`, junto a los de `investigation`, `investigationSource` e `investigationAutopsy`, exportado por el `index.ts` de barrel que el dominio ya tiene:

```ts
export interface CreateInvestigationTeamMemberInput {
    investigationId: string;
    fullName: string;
    institutionName?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
}
```

**Dos columnas no están en la interfaz.** `investigationTeamMemberId` lo mina la base, y `sortOrder` es inmutable y lo asigna el trigger: que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande.

El update usa `Partial<CreateInvestigationTeamMemberInput>`. **No se declara `UpdateInvestigationTeamMemberInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero el servicio lo ignora siempre.

`fullName` **no** admite `| null`: es la única columna de datos no nula y un `null` explícito es 400. Los otros cuatro sí lo admiten, y es lo que permite al cliente borrar un dato ya guardado. No se necesita ninguna constante nueva: esta entidad no referencia ningún catálogo.

### 3.4 Superficie HTTP

```
POST   /api/investigation-team-members                          ESAVI-INVTEAM-001   USER        (nuevo)
GET    /api/investigation-team-members/admin/investigation/:id   ESAVI-INVTEAM-002B  ADMIN       (nuevo)
GET    /api/investigation-team-members/investigation/:id         ESAVI-INVTEAM-002A  USER        (nuevo)
GET    /api/investigation-team-members/case/:caseId              ESAVI-INVTEAM-006   USER        (nuevo)
DELETE /api/investigation-team-members/purge/:id                 ESAVI-INVTEAM-005C  SUPERADMIN  (nuevo)
PATCH  /api/investigation-team-members/activate/:id              ESAVI-INVTEAM-005B  ADMIN       (nuevo)
GET    /api/investigation-team-members/:id                       ESAVI-INVTEAM-003   USER        (nuevo)
PUT    /api/investigation-team-members/:id                       ESAVI-INVTEAM-004   USER        (nuevo)
DELETE /api/investigation-team-members/:id                       ESAVI-INVTEAM-005A  ADMIN       (nuevo)
```

**Nueve rutas, y `:id` es el `investigationTeamMemberId`.** A diferencia de F29 y F30, el `003` **no** es el acceso por investigación: para eso está el `002A`.

Orden de declaración en `src/routes/investigationTeamMember.routes.ts`: las rutas con prefijo literal (`/admin/investigation/:id`, `/investigation/:id`, `/case/:caseId`, `/purge/:id`, `/activate/:id`) van **antes** de `/:id`, y `/admin/investigation/:id` antes que `/investigation/:id`, o Express capturará los literales como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28, F29 y F30, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso.

**`005B` en ADMIN y no en SUPERADMIN**, siguiendo a F27: la activación de esta entidad no es la delegación trivial que la matriz canónica supone, sino una operación con reasignación de `sortOrder`, y quien administra el caso debe poder ejecutarla. `005C` se queda en SUPERADMIN.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationTeamMember` · `006` · listar el equipo investigador de un caso — la cadena `caso → investigación` es uno a uno, pero de la investigación cuelgan N miembros**.

**La abreviatura es `INVTEAM`.** Siete letras, no colisiona con las treinta y dos registradas, y `grep "ESAVI-INVTEAM-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-` ni `ESAVI-INVAUT-`.

### 3.5 Reglas de negocio por operación

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Un miembro cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). Los dos listados aplican el mismo criterio sobre la investigación del `:id` de ruta antes de leer nada.

**El `005A`, el `005B` y el `005C` no la aplican.** Quien retira, reactiva o purga actúa sobre el estado propio de la fila, y ese estado existe con independencia del padre. Es la diferencia directa con F29 y F30, donde no había estado propio que gobernar.

#### Guarda de duplicado — `001` y `004`

Se compara `fullName` **ya normalizado con `toTitleCase`** contra las filas de la **misma investigación** con `isActive: true`, excluyendo en el `004` la propia fila con `investigationTeamMemberId: { [Op.ne]: id }`. Si hay coincidencia → **409** `INVTEAM_<op>_ALREADY_EXISTS`, con `{{fullName}}` interpolado.

**Se compara contra activas, no contra todas.** Un miembro retirado no bloquea volver a dar de alta a la misma persona: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`. La consecuencia —que un `005B` pueda dejar dos filas activas con el mismo nombre— está declarada en §6 y no se corrige aquí.

**En el `004` la guarda solo se evalúa cuando `fullName` viaja en el body**, y **antes** del diff. Si no viaja, no hay nombre nuevo que comprobar.

#### Por operación

**`ESAVI-INVTEAM-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVTEAM_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe miembros nuevos.
2. Normaliza: `toTitleCase` sobre `fullName`; `.trim()` sobre `institutionName`; `.trim().toLowerCase()` sobre `email`; `.trim()` sobre `phone` y `notes`.
3. Guarda de duplicado sobre el `fullName` ya normalizado → 409 `INVTEAM_001_ALREADY_EXISTS`.
4. `create` con `fields: CREATE_FIELDS`, **sin `sortOrder`**, para que lo asigne el trigger, y con la entrada de auditoría `method: 'ESAVI-INVTEAM-001'`.

Un alta con solo `investigationId` y `fullName` es válida y devuelve 201, con los cuatro campos opcionales en `null` y el `sortOrder` que le toque.

**`ESAVI-INVTEAM-002A` — listar activos por investigación.** La investigación existe y está activa, salvo `canViewInactive` → 404 `INVTEAM_002A_INVESTIGATION_NOT_FOUND`. `findAndCountAll` con `where: { investigationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. **Sin filtros por query.** Devuelve la forma completa de §3.7.

Una investigación sin miembros devuelve **200** con `{ count: 0, rows: [] }`, no 404.

**`ESAVI-INVTEAM-002B` — listar todos por investigación.** Idéntica, con `where: { investigationId }` y sin filtrar por `isActive`: devuelve también los retirados y los de `deletedAt` sellado. Mismo código de 404 salvo el sufijo: `INVTEAM_002B_INVESTIGATION_NOT_FOUND`. **Es la operación que justifica el índice nuevo de §3.1.**

**`ESAVI-INVTEAM-003` — obtener por ID.** El `:id` es el `investigationTeamMemberId`. Visibilidad heredada más el `isActive` propio, gobernados los dos por `canViewInactive` → 404 `INVTEAM_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVTEAM-006` — listar por caso.** Entra por el `caseId` y atraviesa el salto uno a uno hasta la investigación, de donde cuelgan N miembros. Dos 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVTEAM_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVTEAM_006_INVESTIGATION_NOT_FOUND`.

Una investigación sin miembros devuelve **200** con `{ count: 0, rows: [] }`. Devuelve `{ count, rows }` como los dos listados —no un objeto— y **solo los activos**, con el mismo criterio que el `002A`.

**`ESAVI-INVTEAM-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVTEAM_004_NOT_FOUND`.
2. `investigationId` y `sortOrder` **se ignoran siempre**, vengan o no en el body, sin 400.
3. Guarda de duplicado, solo si `fullName` viaja. **Antes del diff y con independencia de él.**
4. `stored` sale de `member.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationTeamMemberId` | **no entra** | PK |
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `fullName` | `data.fullName !== undefined ? toTitleCase(data.fullName.trim()) : undefined` | **no anulable**: un `null` explícito lo corta el validador con 400 y nunca llega aquí. Se compara **ya normalizado**, o renombrar `ana pérez` a `Ana Pérez` produciría una diferencia falsa |
| `institutionName` | `data.institutionName !== undefined ? (data.institutionName ? data.institutionName.trim() : null) : undefined` | anulable. **Sin `toTitleCase`** |
| `email` | `data.email !== undefined ? (data.email ? data.email.trim().toLowerCase() : null) : undefined` | anulable. Se compara **en minúsculas**, o `Ana@x.cl` frente a `ana@x.cl` produciría una diferencia que `citext` ni siquiera reconoce |
| `phone` | `data.phone !== undefined ? (data.phone ? data.phone.trim() : null) : undefined` | anulable |
| `notes` | `data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined` | anulable |
| `isActive` | **no entra** | lo gobiernan `005A` y `005B` |

**Ningún campo va bajo un `if( data.x )`**, y los cinco se comparan contra `undefined`. **Ningún campo va cifrado**, por §1.C.

**`ESAVI-INVTEAM-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'INVTEAM_005A_NOT_FOUND'`, `alreadyInStateCode: 'INVTEAM_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-INVTEAM-005A'`. **No consulta nada más**: la tabla es hoja del grafo. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — correcto y deliberado, el hueco queda para el siguiente miembro.

**`ESAVI-INVTEAM-005B` — reactivar, con reasignación de `sortOrder`.** Cuatro pasos, en transacción:

1. La fila existe, con `paranoid: false` → 404 `INVTEAM_005B_NOT_FOUND`. Si ya está activa → 409 `INVTEAM_005B_ALREADY_ACTIVE`.
2. Se busca colisión: otra fila de la **misma** investigación, con el **mismo** `sortOrder`, con `deletedAt: null` y `investigationTeamMemberId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa investigación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que la escritura es libre. El miembro reaparece al final de la lista.
4. `isActive: true`, `deletedAt: null`, entrada en `appDetails` con `method: 'ESAVI-INVTEAM-005B'`.

**El `005B` no revalida la cadena.** Reactivar a un miembro cuya investigación se desactivó entretanto responde **200**: el estado propio de la fila no depende del padre, y quien no deba verlo ya lo tiene tapado por la visibilidad heredada del `003` y de los listados.

**`ESAVI-INVTEAM-005C` — purgar.** `purgeInvestigationTeamMemberService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** visibilidad heredada → 404 `INVTEAM_005C_NOT_FOUND`; **409 si la fila está activa**, con el control de `isActive` que el helper ya lleva dentro y que **aquí sí es efectivo**, a diferencia de F29 y F30; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` — la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6. **No se consume `assertRowIsSealed`.**

#### Lo que no es diferencial, y por qué

- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Nace de una restricción de la base, no de comparar un valor entrante contra el guardado.
- **`005A` y `005B`** — registran un hecho, no un cambio de dato. Que la entrada en `appDetails` quede es precisamente lo que se quiere.

#### El volcado del `ESAVI-INVESTGN-005C`

El purgado de una investigación arrastra sus miembros por `ON DELETE CASCADE` sin pasar por ningún servicio. Se **amplía** el volcado en nivel `warn` que F29 y F30 ya dejaron en `purgeInvestigationService` para que registre también el número de miembros que van a desaparecer, antes del `destroy` y dentro de la misma transacción. **No se bloquea la purga.** Es el único punto en que este spec toca `investigation.service.ts`.

**Validaciones de forma** (las emite `validateFields` con 400): en creación, `investigationId` obligatorio y `.isUUID()`, `fullName` obligatorio, cadena, máximo **250**; `institutionName` cadena, máximo **500**; `email` con `.isEmail()`; `phone` cadena libre, máximo **50**; `notes` cadena. En actualización, los cinco opcionales, pero **`fullName` no anulable** —un `null` explícito es 400— y los otros cuatro sí. `:id` y `:caseId` con `.isUUID()`; `limit` y `offset` con `.isInt()`. **`sortOrder`, `investigationTeamMemberId` e `isActive` no se declaran en ningún validador.**

### 3.6 Claves i18n nuevas

Bloque `investigationTeamMember` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

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
| `alreadyActive` | 409 al reactivar un miembro ya activo |
| `alreadyInactive` | 409 al desactivar un miembro ya inactivo |
| `investigationNotFound` | 404 cuando la investigación no existe o está inactiva, en `001`, `002A`, `002B` y `006` |
| `alreadyExists` | 409 de duplicado de `fullName` en `001` y `004`. Lleva `{{fullName}}` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. **No se añade ninguna clave a los bloques `investigation` ni `esaviCase`:** no hay cascada que produzca mensajes propios, y el volcado del `005C` va al log, no a la respuesta.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004` y **también las filas de `002A`, `002B` y `006`**:

```
{ ok, message, data: {
    investigationTeamMemberId, investigationId,
    fullName, institutionName, email, phone,
    sortOrder, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    investigation: {
        investigationId, isActive, investigationStartDate,
        status: { catalogItemId, code, name },
        case:   { caseId, caseCode, eventDate }
    }
} }
```

**No hay forma reducida**, y el include del padre viaja también en los listados. Es la decisión que este spec toma frente a la alternativa de dejarlo solo en las operaciones de fila: el include es lo que implementa la visibilidad heredada, y una respuesta de listado que no lo lleva deja al cliente sin poder explicar por qué el mismo registro responde 404 desde el `003`. La repetición del bloque en las N filas de la misma investigación es el coste aceptado.

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba, ordenadas por `sortOrder` ascendente.

`005A`, `005B` y `005C` responden según su patrón habitual: los dos primeros con la fila actualizada, el tercero con `{ ok, message }` sin `data`.

`sysDetails` **nunca** se devuelve, ni el del miembro ni el de la investigación. `investigation.status` viaja resuelto y **nunca llega `null`**, por la regla que el F28 §3.5 impuso a aquella entidad. Ninguna respuesta incluye datos de las otras once tablas satélite.

---

## 4. Plan de implementación

**Precondición.** El **SPEC F28** debe estar `Implementado` —lo está—. `investigation` es el padre de esta tabla y el include obligatorio de toda lectura.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **El índice, en `esaviapp.sql`.** `IX_investigationTeamMember_investigation` sobre `("investigationId")`, junto al bloque de índices de `:1333-1360`. **Una sola línea de contenido.** Nada más se toca del DDL.
   *Verificación:* `git diff esaviapp.sql` muestra exactamente el `CREATE INDEX` añadido; ejecutar el DDL completo sobre una base limpia no produce errores; el trigger de `sortOrder` (`:1317`), el índice único parcial (`:1349-1351`), el `CHECK` y la FK quedan intactos.

2. **Modelo y asociaciones.** `src/models/investigationTeamMember.model.ts` con la PK **con** `defaultValue: gen_random_uuid()`, `fullName` en `STRING(250)` y `allowNull: false`, los cuatro opcionales, y **`sortOrder` en `allowNull: false` sin `defaultValue`**; `src/models/associations/investigationTeamMember.associations.ts` con el `belongsTo` a `Investigation` como `investigation` y el inverso `Investigation.hasMany(InvestigationTeamMember, { as: 'teamMembers' })`, registrado en `initModels()`. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `InvestigationTeamMember.findAll({ include: ['investigation'] })` desde el REPL devuelve filas sin error de alias, y un include anidado `investigation → case` también; `grep -n "defaultValue" src/models/investigationTeamMember.model.ts` no devuelve nada para `sortOrder`; `git diff --stat src/controllers/investigation.controller.ts` no muestra cambios — el contrato de F28 no gana los miembros en su respuesta; `npm test` sigue en verde.

3. **Tipos.** `src/types/investigation/investigationTeamMember.types.ts` con `CreateInvestigationTeamMemberInput`, exportado por el `index.ts` de barrel del dominio.
   *Verificación:* `npm run build` en 0; `grep -rn "UpdateInvestigationTeamMemberInput" src/` no devuelve resultados; `grep -n "sortOrder\|investigationTeamMemberId\|isActive" src/types/investigation/investigationTeamMember.types.ts` no devuelve resultados — las tres columnas que el cliente no envía no existen en el tipo.

4. **Claves i18n.** El bloque `investigationTeamMember` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las veintiuna claves.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

5. **Validadores.** `src/validators/investigationTeamMember.validator.ts` con cinco arrays: `investigationTeamMemberIdValidator`, `investigationTeamMemberInvestigationIdValidator` (para el `param` de los dos listados), `investigationTeamMemberCaseIdValidator` (para el `006`), `createInvestigationTeamMemberValidator` y `updateInvestigationTeamMemberValidator`, con las reglas de forma de §3.5. **`sortOrder`, `investigationTeamMemberId` e `isActive` no se declaran en ninguno.** Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; un `POST` sin `fullName` devuelve 400 y no llega al servicio; un `fullName` de 251 caracteres devuelve 400 del validador y no un error de Postgres; un `email: "no-es-correo"` devuelve 400 y un `email: null` no; un `PUT` con `fullName: null` devuelve **400**, y con `institutionName: null`, `email: null`, `phone: null` o `notes: null` **no**; un body con `sortOrder: 5` no produce 400.

6. **`ESAVI-INVTEAM-001` — crear.** `createInvestigationTeamMemberService` con los cuatro pasos de §3.5 en ese orden: investigación existente y activa, normalización, guarda de duplicado sobre el `fullName` ya normalizado, `create` con `fields: CREATE_FIELDS` **sin `sortOrder`**. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un alta con `investigationId` y `fullName` devuelve 201 con los cuatro opcionales en `null`; sobre una investigación inactiva devuelve **404** `INVTEAM_001_INVESTIGATION_NOT_FOUND`; **tres altas seguidas sobre la misma investigación reciben `sortOrder` 1, 2 y 3 sin que el servicio lo envíe**; `grep -n "CREATE_FIELDS" src/services/investigationTeamMember.service.ts` devuelve la lista, y no contiene `sortOrder` ni `investigationTeamMemberId`; `fullName: "ana pérez"` se guarda como `Ana Pérez`; repetir ese alta devuelve **409** `INVTEAM_001_ALREADY_EXISTS` con el nombre interpolado, y `fullName: "ANA PÉREZ"` también —la guarda compara el valor normalizado—; `email: "Ana@X.CL"` se guarda como `ana@x.cl`; `institutionName: "MINSAL"` se guarda **tal cual**, sin `toTitleCase`.

7. **`ESAVI-INVTEAM-002A` y `002B` — los dos listados.** Servicios, controladores y rutas `GET /investigation/:id` y `GET /admin/investigation/:id`, declaradas **antes** de `/:id` y con la de `admin` antes que la pública. `findAndCountAll` con `order` por `sortOrder ASC`, paginación y la forma completa de §3.7. Comprobación previa de la investigación con la visibilidad heredada.
   *Verificación:* el `002A` devuelve solo activos y el `002B` todos, incluidos los de `deletedAt` sellado; las filas llegan ordenadas por `sortOrder` ascendente; `data` es `{ count, rows }` en los dos; un USER recibe 403 en el `002B`; sobre una investigación inactiva los dos devuelven 404 para USER y ADMIN, y 200 para SUPERADMIN; una investigación sin miembros devuelve **200** con `count: 0`; **el `002B` sobre una investigación con miembros borrados usa el índice nuevo** — `EXPLAIN` sobre la consulta muestra `IX_investigationTeamMember_investigation` y no un `Seq Scan`; `grep -n "req.query" src/controllers/investigationTeamMember.controller.ts` solo devuelve `limit` y `offset`; toda fila trae el bloque `investigation` con su `status` y su `case`, y ninguna trae `sysDetails`.

8. **`ESAVI-INVTEAM-003` — obtener por ID.** `getInvestigationTeamMemberByIdService(id, lang, includeInactive)` con el include obligatorio del padre y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; un miembro cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; un miembro con `isActive: false` se comporta igual; `investigation.status` no llega `null`; `sysDetails` no aparece ni en el miembro ni en la investigación; `GET /activate/algo` no entra por esta ruta.

9. **`ESAVI-INVTEAM-006` — listar por caso.** `getInvestigationTeamMembersByCaseIdService(caseId, lang, includeInactive, limit, offset)` con los **dos** 404 distintos de §3.5, devolviendo `{ count, rows }` y **solo los activos**. Ruta `GET /case/:caseId` en USER, declarada antes de `/:id`. Fila `investigationTeamMember` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y miembros devuelve 200 con `{ count, rows }`; un `caseId` inexistente devuelve 404 `INVTEAM_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVTEAM_006_INVESTIGATION_NOT_FOUND`; **los dos códigos son distintos entre sí**; una investigación sin miembros devuelve **200** con `count: 0`, no 404; un miembro desactivado no aparece; `GET /case/no-es-uuid` devuelve 400.

10. **`ESAVI-INVTEAM-004` — actualizar, diferencial.** `updateInvestigationTeamMemberService` con los seis pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` y `sortOrder` ignorados; los cinco campos de datos comparados contra `undefined` y **ya normalizados**. La lectura para el diff se hace **sin `attributes` acotados** y con el include del padre. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
    *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; **un `PUT` con `{ fullName: "ana pérez" }` sobre una fila que ya tiene `Ana Pérez` no escribe nada** — es el criterio que la normalización previa a la comparación protege; **un `PUT` con `{ email: "ANA@X.CL" }` sobre una fila con `ana@x.cl` tampoco**; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; `{ institutionName: null }` vacía el campo y sí escribe; enviar `investigationId` o `sortOrder: 99` devuelve 200 y no los modifica; un `fullName` que colisiona con otro miembro **activo** de la misma investigación devuelve **409**, y si colisiona con uno **inactivo** devuelve 200; renombrar una fila a su propio nombre no dispara el 409.

11. **`ESAVI-INVTEAM-005A` — desactivar.** Delegación limpia en `setEntityActiveStatusService` con los tres códigos de §3.5. Controlador y ruta `DELETE /:id` en ADMIN, declarada después de las literales. **Sin ninguna consulta previa:** la tabla es hoja.
    *Verificación:* la fila queda con `isActive: false` y `deletedAt` sellado; desactivar dos veces devuelve 409 `INVTEAM_005A_ALREADY_INACTIVE`; un USER recibe 403; **tras desactivar, un alta nueva sobre la misma investigación reutiliza el `sortOrder` liberado**; desactivar al miembro de una investigación inactiva **funciona** — el `005A` no aplica visibilidad heredada.

12. **`ESAVI-INVTEAM-005B` — reactivar con reasignación de `sortOrder`.** Los cuatro pasos de §3.5 en transacción propia. Ruta `PATCH /activate/:id` en ADMIN, declarada antes de `/:id`.
    *Verificación:* el escenario que rompe la delegación limpia —crear A y B, desactivar **B**, crear C (que toma el `sortOrder` liberado de B), reactivar B— devuelve **200** y B reaparece con un `sortOrder` nuevo al final, **sin** error de índice único. **La fila que se desactiva tiene que ser la de mayor `sortOrder`**: `setSortOrderByParent` asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas, así que **no rellena huecos** — desactivar A dejaría a B viva con el 2, y C nacería con 3 sin colisionar con nadie. Esa variante también va a la suite, y debe responder 200 dejando el `sortOrder` de A intacto; reactivar cuando no hay colisión no toca `sortOrder`; reactivar a uno ya activo devuelve 409 `INVTEAM_005B_ALREADY_ACTIVE`; **reactivar a uno cuya investigación se desactivó entretanto responde 200** — el `005B` no revalida la cadena; reactivar a uno cuyo `fullName` ya existe vivo responde **200**, no 409, y la investigación queda con el nombre duplicado: es la consecuencia asumida de §6, y va a la suite como escenario explícito para que nadie la corrija por accidente; un USER recibe 403.

13. **`ESAVI-INVTEAM-005C` — purgar.** `purgeInvestigationTeamMemberService` sobre `purgeEntityService`, con transacción propia y existencia con `paranoid: false`. **Sin `assertRowIsSealed`:** el control de `isActive` del helper basta. Ruta `DELETE /purge/:id` en SUPERADMIN, declarada junto a las otras literales.
    *Verificación:* purgar una fila **activa** devuelve 409 y la fila sigue ahí — **es la comprobación que prueba que el control de `isActive` de `purgeEntityService` sí es efectivo en esta entidad**, al contrario que en F29 y F30; desactivar y purgar devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; la investigación y los demás miembros siguen intactos; `grep -n "assertRowIsSealed" src/services/investigationTeamMember.service.ts` no devuelve nada.

14. **Ampliar el volcado del `ESAVI-INVESTGN-005C`.** En `purgeInvestigationService` de `src/services/investigation.service.ts`, añadir al volcado en `warn` que F29 y F30 ya dejaron puesto el número de miembros que la cascada de Postgres va a destruir, antes del `destroy` y en la misma transacción. **Es el único punto en que este spec toca ese archivo.** No se añade ninguna función `cascade*`, ni aquí ni en `esaviCase.service.ts`.
    *Verificación:* purgar una investigación con miembros deja la línea `warn` en `src/logs/esaviLog.log` con el conteo, y **no** devuelve error; las filas desaparecen; `git diff src/services/esaviCase.service.ts` **no muestra cambios**; `grep -n "cascade.*TeamMember" src/` no devuelve nada; desactivar y reactivar una investigación con miembros **no altera su `isActive` ni su `deletedAt`** — es la comprobación de que la ausencia de cascada es deliberada y no un olvido, y va a la suite.

15. **Registrar la entidad en las convenciones.** Fila `investigationTeamMember` → `INVTEAM` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationTeamMember` · `006` · «listar el equipo investigador de un caso — la cadena `caso → investigación` es uno a uno, pero de la investigación cuelgan N miembros» en la tabla de operaciones no canónicas.
    *Verificación:* `INVTEAM` aparece una sola vez y no colisiona con las treinta y dos existentes; la tabla de no canónicas suma exactamente una fila.

16. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más nueve.
    *Verificación:* `npm test -- roles` pasa; el `005B` figura con `minRole` ADMIN y no SUPERADMIN.

17. **Suite de contrato `tests/contract/investigationTeamMember.test.ts`.** Recorrido completo con `supertest`: crear → listar activos por investigación → listar todos → obtener por ID → listar por caso → actualizar → desactivar → reactivar → purgar. Más los caminos de error: investigación inexistente e inactiva (404), 400 de `fullName` ausente y de `fullName: null`, 400 de `email` inválido, 409 de duplicado en `001` y en `004`, 201 del duplicado sobre fila **inactiva**, los dos 404 distintos del `006`, 409 de purga sobre fila activa, el escenario de colisión de `sortOrder` del paso 12 en sus dos variantes, el de duplicado por reactivación, y el bloque diferencial completo de §5 —con cobertura explícita de la normalización previa a la comparación en `fullName` y en `email`—. Más el caso de no-cascada del paso 14.
    *Verificación:* `npm test -- investigationTeamMember` en verde, y `npm run check` completo en 0.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Existen las **nueve** rutas de §3.4, con sus roles, y `/:id` está declarada después de todas las literales; `/admin/investigation/:id` antes que `/investigation/:id`.
- [ ] El código `ESAVI-INVTEAM-<NNN>` es **idéntico** en los cinco lugares de cada operación: comentario de ruta, comentario de controlador, comentario de servicio, `code` del `AppError` y `appDetails.method`.
- [ ] `INVTEAM` está registrada en la tabla de abreviaturas de `CONVENTIONS.md` §6, una sola vez.
- [ ] La fila `investigationTeamMember` · `006` está en la tabla de operaciones no canónicas.
- [ ] Los controladores no importan ningún modelo; los servicios lanzan `AppError` y no devuelven payloads de error.
- [ ] Toda respuesta de éxito es `{ ok, message, data }` con `message` salido de `getMessage(key, req.lang)`.
- [ ] Las veintiuna claves i18n existen en `es`, `en` y `nl`, y `npm run i18n:check` pasa.
- [ ] `sysDetails` no aparece en ninguna respuesta, ni la del miembro ni la de la investigación incluida.

**Esquema**

- [ ] `esaviapp.sql` gana **exactamente** el `CREATE INDEX IX_investigationTeamMember_investigation` y nada más.
- [ ] El trigger de `sortOrder` (`:1317`), el índice único parcial (`:1349-1351`), el `CHECK` y la FK quedan sin tocar.
- [ ] `EXPLAIN` de la consulta del `002B` sobre una investigación con miembros borrados usa el índice nuevo.

**`sortOrder`, el trigger y el `005B`**

- [ ] Tres altas seguidas sobre la misma investigación reciben `sortOrder` 1, 2 y 3 **sin que el servicio envíe la columna**.
- [ ] `CREATE_FIELDS` está declarada en el servicio y **no** contiene `sortOrder` ni `investigationTeamMemberId`.
- [ ] El modelo declara `sortOrder` con `allowNull: false` y **sin** `defaultValue`.
- [ ] Desactivar el miembro de mayor `sortOrder`, crear otro —que toma el número liberado— y reactivar al primero devuelve **200**, sin error de índice único, y el reactivado reaparece al final.
- [ ] Reactivar cuando no hay colisión **no toca** `sortOrder`.
- [ ] Un `PUT` con `sortOrder` en el body devuelve 200 y no lo modifica.

**Visibilidad heredada y ausencia de cascada**

- [ ] `003`, `004`, `002A`, `002B` y `006` devuelven **404** cuando la investigación está inactiva, para USER y ADMIN, y **200** para SUPERADMIN.
- [ ] `005A`, `005B` y `005C` **no** aplican la visibilidad heredada: operan sobre el estado propio de la fila aunque el padre esté retirado.
- [ ] Desactivar y reactivar una investigación **no altera** el `isActive` ni el `deletedAt` de sus miembros.
- [ ] Desactivar un caso **no altera** el `isActive` ni el `deletedAt` de los miembros de su investigación.
- [ ] `git diff src/services/esaviCase.service.ts` no muestra cambios, y `src/services/investigation.service.ts` cambia **solo** en el volcado del `005C`.

**Reglas de negocio**

- [ ] Un alta sobre investigación inactiva devuelve 404 `INVTEAM_001_INVESTIGATION_NOT_FOUND`.
- [ ] `fullName` duplicado dentro de la misma investigación devuelve **409** en `001` y en `004`, comparando el valor ya pasado por `toTitleCase`.
- [ ] El duplicado se compara **solo contra filas activas**: repetir el nombre de un miembro retirado devuelve 201.
- [ ] `fullName: null` en el `004` devuelve **400**; `institutionName`, `email`, `phone` y `notes` en `null` devuelven 200 y vacían el campo.
- [ ] `institutionName` se guarda **tal cual**: `MINSAL` no se convierte en `Minsal`.
- [ ] `email` se guarda en minúsculas y con `.trim()`; un `email` inválido devuelve 400 del validador.
- [ ] Purgar una fila **activa** devuelve 409; el servicio **no** consume `assertRowIsSealed`.
- [ ] Purgar una investigación con miembros los destruye por cascada de Postgres, deja una línea `warn` con el conteo y **no** devuelve error.

**Update diferencial — `ESAVI-INVTEAM-004`**

- [ ] Un `PUT` que reenvía **íntegra** la respuesta de su `GET` devuelve 200 y **no escribe**: sin `UPDATE`, sin mover `updatedAt`, sin entrada nueva en `appDetails` y sin avanzar `sysDetails.version`. Un `PUT` con `{}` se comporta igual.
- [ ] Un `PUT` que cambia **un** campo escribe **solo ese campo**, añade **una** entrada a `appDetails` preservando el historial anterior, y avanza la versión en exactamente 1.
- [ ] Ningún campo entra en `candidates` bajo un `if( data.x )`: los cinco se comparan contra `undefined`, y la tabla de §3.5 es la referencia exacta.
- [ ] Los dos campos inmutables —`investigationId` y `sortOrder`— **no entran** en `candidates` y se ignoran en silencio, sin 400.
- [ ] Los campos normalizados se comparan **ya normalizados**: `fullName: "ana pérez"` sobre `Ana Pérez` y `email: "ANA@X.CL"` sobre `ana@x.cl` **no escriben nada**.

---

## 6. Decisiones tomadas y descartadas

**Sin cifrado de `fullName`, `email` y `phone`. Descartado cifrarlos con `esaviCrypt`.**
Es la decisión más cara de revertir del spec, y por eso se razona entera. Tres argumentos la sostienen. **Uno de dominio:** el equipo investigador es personal sanitario identificado en función pública dentro de un documento oficial —el informe de investigación lo firman con nombre e institución—, no el paciente cuyos datos el sistema protege. La frontera que `appUser` traza no está entre «datos de personas» y «datos de cosas», sino entre identidad protegida e identidad publicada. **Uno técnico:** `email` es `citext` (`:1000`), un tipo elegido explícitamente para comparar sin distinguir mayúsculas; `esaviCrypt` es determinista con IV fijo, así que cifrarlo dejaría esa propiedad inerte y la columna sería un `text` disfrazado. **Y uno de precedente:** `notifier` —la persona que reporta el caso— ya se guarda en claro, y `investigationTeamMember` es su equivalente en la fase de investigación. Cifrar aquí y no allí sería incoherente. La decisión se declara para que quede rastreable: si mañana la política de privacidad cambia, esto es lo que hay que reabrir, y el coste será una migración de datos, no un cambio de código.

**Sin cascada desde `investigation` ni desde `esaviCase`. Descartado replicar las cuatro funciones `cascadeSeal*` de F29 y F30.**
Es la primera vez que un spec de satélite de investigación **no** añade una función `cascade*`, y la diferencia es la columna `isActive`. En F29 y F30 el `deletedAt` no significaba «alguien retiró esta fila» sino «su investigación estaba retirada»: no había estado propio que pisar, así que la cascada era la única forma de que el sello significara algo. Aquí sí lo hay. Retirar a una persona del equipo es un hecho del dominio con autor y motivo propios, y una cascada que lo escribiera destruiría información: al reactivar la investigación no habría forma de distinguir a quien se retiró a mano de quien arrastró el padre, y la cascada de subida del `005B` —legítima en F29 porque no resucitaba nada— aquí resucitaría a alguien que un ADMIN había retirado a propósito. La visibilidad la aporta el include del padre en toda lectura; el estado, la columna. **Es además el precedente ya establecido** por las tres colecciones con `isActive` que cuelgan de `notification`: `esaviCase.service.ts` tiene siete funciones `cascade*` y ninguna toca `notificationEvent`, `notificationMedication` ni `notificationVaccine`.

**Listado por padre, sin filtros. Descartado el listado global con filtros `investigationId` y `caseId` de F29 y F30.**
Aquellas dos entidades eran uno a uno: un listado global de fuentes de investigación es una tabla de N filas independientes que se filtra. Ésta es una colección: los miembros de una investigación solo tienen sentido leídos juntos y en su orden. Un `GET /` global devolvería un revuelto de personas de investigaciones distintas paginado por `createdAt`, que no responde a ninguna pregunta del dominio, y obligaría a exponer `sortOrder` en un contexto donde no ordena nada. Se sigue a F27.

**Guarda de duplicado sobre `fullName` normalizado, comparando solo contra filas activas. Descartadas dos alternativas.**
*Descartado no poner guarda:* el error real que se quiere evitar es el doble alta por doble clic o por dos personas cargando el mismo informe, y sin guarda la investigación acumula duplicados silenciosos que solo se ven al imprimir el documento. *Descartado comparar contra todas las filas, activas o no:* haría imposible deshacer un alta equivocada dando de alta de nuevo a la misma persona sin pasar por el `005B`, que es la vía natural cuando lo que estaba mal era otro campo. *Descartado comparar por `email`:* es opcional, y la mayoría de las altas no lo llevan.

**Consecuencia asumida: el `005B` puede dejar dos filas activas con el mismo `fullName`.** Reactivar a un miembro cuyo nombre ya volvió a darse de alta responde 200 y no 409. Es la misma consecuencia que F27 §6 asumió para su par `(término, tipo)`, y por la misma razón: el `005B` es una operación de recuperación, y bloquearla dejaría filas irrecuperables por un conflicto que el usuario no puede resolver desde esa ruta. Va a la suite como escenario explícito para que nadie la «corrija» por accidente.

**`005B` en ADMIN y no en SUPERADMIN.** La matriz canónica de §9 reserva la activación al SUPERADMIN porque suele ser una delegación trivial en `setEntityActiveStatusService`. Aquí no lo es: lleva reasignación de `sortOrder` en transacción y forma parte del flujo operativo de corregir un informe de investigación. Se sigue a F27.

**`institutionName` sin `toTitleCase`, contra la norma general de §Normalización.** La convención aplica `toTitleCase` a los campos de nombre, y `fullName` la respeta. `institutionName` no: los nombres de institución del dominio son siglas —`MINSAL`, `ISP`, `OPS`— y `toTitleCase` las convertiría en `Minsal`, `Isp`, `Ops`, corrompiendo un dato que después se imprime en un documento oficial. Se guarda con `.trim()` y nada más. Es una desviación deliberada y acotada a esta columna.

**Guarda del `005C` por `isActive` y no por `assertRowIsSealed`.** F29 y F30 tuvieron que recurrir al helper de sellado porque sus tablas no tienen `isActive` y el control que `purgeEntityService` lleva dentro era inerte —`undefined !== true` deja pasar toda fila—. Aquí la columna existe y el control funciona: purgar una fila activa devuelve 409 sin añadir una línea de código. Consumir `assertRowIsSealed` habría duplicado una guarda que el helper ya hace, y creado una dependencia a `rowSeal.helper.ts` que esta entidad no necesita.

**`sortOrder` inmutable, sin operación de reordenación.** Se descarta meter un `007` en este spec. Reordenar exige transacción sobre N filas, una decisión sobre si el orden queda denso o disperso, y un contrato para el caso de que dos clientes reordenen a la vez. Es el mismo pendiente que F16 §2 y F27 §2 dejaron abiertos, y merece un spec que lo resuelva para las seis entidades con `sortOrder` a la vez, no una sexta implementación distinta.

---

## 7. Riesgos identificados

**El `sortOrder` del `005B`, por sexta vez.** Es el riesgo conocido del repositorio y el único con historial de haber roto algo. `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número, y el índice único parcial se condiciona por `deletedAt`, no por `isActive`. La mitigación es el paso 12 del plan y su escenario de suite. **El riesgo residual no es que falle, es que la sexta implementación diverja de las cinco anteriores**: cinco copias del mismo bloque en cinco servicios, sin helper común. Este spec no lo extrae —hacerlo tocaría cinco entidades ya `Implementado`— pero lo deja anotado como el candidato más claro a un spec de consolidación.

**El duplicado por reactivación.** Declarado y asumido en §6, pero es un estado incoherente que el sistema permite alcanzar: dos filas activas con el mismo `fullName` en la misma investigación. Si el informe se imprime desde estos datos, saldrá la persona dos veces. La mitigación es que el escenario está en la suite y documentado; la corrección real —un `007` de fusión, o una guarda en el `005B` con respuesta 409 y un camino de salida— queda fuera.

**La guarda de duplicado es cosmética frente a la realidad de los datos.** Compara `fullName` tras `toTitleCase` y nada más: `Juan Pérez` y `Juan Perez` son dos personas distintas para el sistema, igual que `J. Pérez`. No detecta nada que no sea una coincidencia exacta de texto normalizado. **No se presenta como deduplicación** y §2 lo deja fuera de alcance explícitamente, pero conviene que quien lea la respuesta 409 sepa qué está garantizando y qué no.

**La decisión de no cifrar es de una sola dirección.** Revertirla más tarde exige migrar los datos ya escritos, no solo cambiar el servicio, y el `citext` de `email` dejaría de tener sentido. Si hay alguna duda sobre la política de privacidad aplicable al personal investigador, el momento de resolverla es antes de la primera carga de producción, no después.

**El include del padre en los listados repite el mismo bloque en N filas.** Es el coste aceptado en §3.7. Con equipos de tres a seis personas es despreciable; si alguna investigación acumulara decenas de miembros, la respuesta del `002B` crecería de forma no lineal en información redundante. La paginación lo acota, y no se mitiga más.

**La cascada de Postgres del `ESAVI-INVESTGN-005C` sigue sin bloquearse.** Purgar una investigación destruye a todo su equipo sin preguntar. La única mitigación es el volcado en `warn` del paso 14, que deja rastro pero no impide nada. Es la decisión heredada de F13 y confirmada por F29 y F30, y este spec no la reabre.

---

## 8. Impacto en el contrato HTTP

**Ninguno sobre las entidades existentes.** Este spec es puramente aditivo: añade nueve rutas nuevas bajo `/api/investigation-team-members` y no modifica ninguna respuesta ya publicada.

En concreto: `Investigation.hasMany(InvestigationTeamMember, { as: 'teamMembers' })` se declara para que las consultas puedan usarlo, pero **el include no se añade a ninguna operación de `investigation`**, así que su contrato no cambia. `src/services/investigation.service.ts` se toca solo para ampliar un volcado al log, que no viaja en ninguna respuesta. `src/services/esaviCase.service.ts` no se toca. `setEntityActiveStatusService`, `purgeEntityService` y `assertRowIsSealed` se consumen sin modificarse, así que ninguna de las entidades que dependen de ellos cambia de comportamiento.

El único cambio observable fuera de la entidad nueva es el índice añadido a `esaviapp.sql`, que afecta al plan de consulta y no al contrato.

---

## Lo que **no** está en este spec

- Las once satélites de `investigation` que siguen sin implementar.
- La operación de reordenación (`007`) que el `sortOrder` inmutable deja pendiente, aquí y en las cinco entidades anteriores.
- El helper común que extraería la reasignación de `sortOrder` del `005B`, hoy duplicada en cinco servicios y a punto de estarlo en seis.
- Cualquier vínculo entre un miembro del equipo y un `appUser`. `fullName` es texto libre.
- Cualquier deduplicación real de personas: acentos, iniciales, cruce por `email`.
- Cualquier filtro de listado, búsqueda por texto o agregación sobre el equipo investigador.
- Cualquier regla que exija un equipo mínimo, o que valide su composición, para cerrar una investigación.
- Cifrado de `fullName`, `email` o `phone`.
- Cascada de activación o desactivación desde `investigation` o desde `esaviCase`.
- Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene equipo.
- Cualquier modificación de `esaviapp.sql` más allá del índice del paso 1.
- Exponer o editar `sysDetails`.
