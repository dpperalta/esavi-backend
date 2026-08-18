# SPEC F23 — CRUD de `diluentCatalog`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa), SPEC F15 y SPEC F18 (precedentes directos: los otros dos catálogos clínicos planos, sin asociaciones y sin `005C`)
> **Fecha:** 2026-08-18
> **Objetivo:** Dar de alta `diluentCatalog` con sus siete operaciones canónicas, como maestro de los diluyentes con los que se reconstituye una vacuna.

---

## 1. Por qué existe este spec

`diluentCatalog` es el **maestro de los diluyentes con los que se reconstituye una vacuna liofilizada**: qué líquido se le añadió al vial antes de administrarlo. Hoy la tabla existe en `esaviapp.sql:603-615` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**Por qué un diluyente merece maestro propio.** El diluyente no es un accesorio de la vacuna: es la mitad del producto administrado. Un ESAVI puede deberse a que se reconstituyó con el diluyente equivocado, con uno de otro fabricante, o con uno cuya cadena de frío se rompió — y el esquema lo tiene previsto. `investigationColdChain.storageDiluentNotUsable` (`esaviapp.sql:1176`) pregunta expresamente si el diluyente almacenado era inutilizable, y `investigationAdministrationError` recoge el error de administración. Nada de eso se analiza si el diluyente viaja como texto libre en cada notificación.

**Es el tercero y último de los catálogos clínicos pendientes**, después del [SPEC F15](./15-diagnosticterm-crud.md) (`diagnosticTerm`) y el [SPEC F18](./18-vaccinewhodrug-crud.md) (`vaccineWhodrug`). Con éste, el bloque de catálogos clínicos de `esaviapp.sql` queda cerrado.

**Una tabla lo espera**, con FK nullable y `ON DELETE RESTRICT`:

- `notificationDiluent.diluentCatalogId` — `esaviapp.sql:867`, constraint en `esaviapp.sql:882`

`notificationDiluent` no está implementada. Cuelga de `notificationVaccine` —que sí lo está, por el [SPEC F22](./22-notificationvaccine-crud.md)— y es la siguiente satélite natural de la cadena. No se puede especificar sin decidir antes de dónde sale el diluyente que referencia.

**El mismo patrón «crudo más codificado» de los otros dos catálogos.** `notificationDiluent` lleva, junto a la FK, dos campos de texto libre: `diluentName` y `diluentCode` (`esaviapp.sql:873-874`). No es redundancia. El notificador transcribe lo que consta en el vial y la notificación **no se bloquea** por no estar codificada; la FK nullable representa «notificado pero sin codificar», y la copia de texto conserva lo notificado aunque el maestro se renombre después.

**Es la tabla más pequeña del esquema en superficie de datos:** cuatro columnas —`code`, `name`, `description`, `composition`— sobre once. No tiene FKs salientes, ni ENUM, ni `CHECK`, ni índices propios, ni triggers específicos. Eso la convierte en el CRUD más limpio de los veintitrés specs funcionales, y en el sitio donde una desviación de la norma no tendría ninguna excusa.

**Sin `005C`.** `diluentCatalog` figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1361-1375`), así que por la regla de disponibilidad de `references/CONVENTIONS.md` §6 el borrado físico **no se declara**. Son siete operaciones canónicas, ni una más.

**Sin `006`.** Tampoco hay resolución implícita, a diferencia de `diagnosticTerm`. La razón está en §6.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos de `diluentCatalog`: modelo, tipos, validadores, servicio, controlador y ruta. **Sin archivo de asociaciones** — la entidad no tiene ninguna FK saliente; la razón está en §3.2 y en §6.
- **Siete operaciones canónicas** — `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar. Ninguna operación no canónica.
- Ruta base **`/api/diluents`**, deliberadamente distinta del nombre de la tabla `diluentCatalog`. La razón está en §6.
- Alta de la abreviatura `DILUENT` en la tabla de `references/CONVENTIONS.md` §6.
- Las **cuatro columnas de datos** de §3.1 escribibles en `001` y `004`: `code` y `name` obligatorios, `description` y `composition` opcionales y anulables.
- `code` **obligatorio como dato** en la API aunque el DDL lo permita nulo. Un diluyente sin código no se cruza con nada.
- Unicidad **global de `code`**, comparada contra el valor ya normalizado, **sin filtrar por `isActive`**, excluyendo el propio id en el `004` con `{ [Op.ne]: id }` y resuelta **antes** del diff.
- `code` normalizado con **`toConstantCase`** y `name` **solo con `.trim()`**. La asimetría es deliberada y está razonada en §6.
- `code` **mutable** en el `004`, con su comprobación de unicidad.
- Búsqueda por texto con `Op.iLike` sobre `name`, acotada a `002A` y `002B`, con mínimo de 2 caracteres. Sin ningún otro filtro de listado. Orden por defecto `name ASC`.
- Un bloque `diluentCatalog` con dieciséis claves i18n en `es`, `en` y `nl`, nombradas según `references/CONVENTIONS.md` §13.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **162 a 169**.
- Suite `tests/contract/diluentCatalog.test.ts`.

**Fuera de alcance (otros specs):**

- **`notificationDiluent`.** Este spec entrega el maestro; quien lo referencia llega en su propio spec, encadenado a `notificationVaccine` del [SPEC F22](./22-notificationvaccine-crud.md).
- **La resolución implícita desde una notificación.** No hay equivalente al `ESAVI-DIAGTERM-006` y no lo habrá: un diluyente es un producto físico con composición declarada, no una descripción que el notificador acuñe. La razón completa está en §6.
- **La importación masiva desde fichero.** No existe fichero de origen conocido para los diluyentes, a diferencia de MedDRA (SPEC F17) y WHODrug (SPEC F19). El catálogo se puebla a mano por su tamaño. `ESAVI-DILUENT-006` en adelante queda libre.
- **Convertir `vaccineWhodrug.diluent` en una FK a esta tabla.** Hoy es `text` libre (`esaviapp.sql:587`) y este spec no inventa relaciones que el DDL no declara. El [SPEC F18](./18-vaccinewhodrug-crud.md) ya lo dejó dicho en su propio «fuera de alcance»; convertirla es un cambio de esquema con su propio spec.
- **La relación entre un diluyente y las vacunas con las que es compatible.** No hay tabla puente en el esquema, y añadirla es modelar una regla clínica nueva, no dar de alta un catálogo.
- **El borrado físico `005C`.** La tabla está protegida por `preventPhysicalDelete`; el endpoint no se declara. No es una omisión revisable: es la regla de disponibilidad de §6 aplicada al DDL.
- **La fusión de entradas duplicadas.** Repuntar la FK entrante antes de retirar la sobrante es una operación con su propia transacción y su propio rol, y la tabla destino aún no existe.
- **Cualquier filtro de listado más allá de `search`.** La tabla no tiene ninguna columna que sirva de faceta: `description` y `composition` son texto largo, y no hay fabricante, presentación ni tipo.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`diluentCatalog` — `esaviapp.sql:603-615`. Tabla plana: **ninguna clave foránea saliente**. Once columnas: la PK, **4 de datos** y 6 transversales.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `diluentCatalogId` | `uuid` | no | PK, `gen_random_uuid()` |
| `code` | `varchar(100)` | **sí en el DDL** | `UNIQUE` declarado **en línea**, sin nombre de constraint — unicidad global. La API lo exige obligatorio como dato |
| `name` | `varchar(250)` | no | |
| `description` | `text` | sí | |
| `composition` | `text` | sí | composición del diluyente en texto libre |
| `isActive` | `boolean` | no | `DEFAULT true` |
| `createdAt` | `timestamptz` | no | `DEFAULT current_timestamp` |
| `updatedAt` | `timestamptz` | sí | lo escribe la aplicación |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `appDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |

**La unicidad de `code` es la única restricción de la tabla.** Se declara como modificador de columna —`"code" varchar(100) UNIQUE`— y no como `CONSTRAINT` con nombre, a diferencia de `UQ_vaccineWhodrug_externalId` o `UQ_diagnosticTerm_source_code`. Postgres le genera el nombre `diluentCatalog_code_key`. Es unicidad **global sobre una sola columna**, no compuesta.

**`code` es nullable bajo ese `UNIQUE`, y eso es deliberado en el DDL:** N filas con `NULL` conviven bajo un `UNIQUE` de Postgres. Este spec no lo aprovecha —exige `code` siempre— pero conviene saber que el esquema no lo impide.

Sin `CHECK`, sin FK, **sin índices propios** y sin ENUM. Los dos triggers que alcanzan la tabla los montan bucles genéricos, no declaraciones específicas:

- `TRG_diluentCatalog_setSysDetails`, del bucle sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1280-1295`).
- `TRG_diluentCatalog_preventPhysicalDelete`, del bucle sobre las 18 tablas protegidas (`esaviapp.sql:1361-1375`); `diluentCatalog` aparece en `esaviapp.sql:1368`.

**No existe `TRG_diluentCatalog_setUpdatedAt`**: el bucle de `sysDetails` lo borra explícitamente si lo encuentra y no lo vuelve a crear, así que `updatedAt` lo escribe siempre la aplicación.

Las cuatro columnas transversales están completas. Sobre `appDetails`, el mismo comportamiento que dejaron escrito el F15 y el F18: su `DEFAULT` en el DDL es `'{}'` —un objeto—, no `'[]'`; el servicio escribe siempre un array y lo lee con `Array.isArray(diluent.appDetails) ? diluent.appDetails : []`, que resuelve el default sin tocar el SQL.

**Una anomalía observada, que este spec no corrige:** `vaccineWhodrug.diluent` es `text` libre (`esaviapp.sql:587`) y **no** es una FK a esta tabla, pese a existir las dos. El F18 ya lo declaró fuera de alcance y aquí se repite el criterio: el spec no inventa relaciones que el DDL no declara.

### 3.2 Modelo Sequelize

`src/models/diluentCatalog.model.ts`, clase `DiluentCatalog`, con las **once columnas** de §3.1. `timestamps: false`, `freezeTableName: true`, `tableName: 'diluentCatalog'` —el nombre real de la tabla, aunque la ruta HTTP sea otra—, PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `sysDetails` y `appDetails` como `DataTypes.JSONB`. `code` como `DataTypes.STRING(100)` y `name` como `DataTypes.STRING(250)`, respetando el ancho declarado; `description` y `composition` como `DataTypes.TEXT`. Alta en `src/models/index.ts`.

`code` se declara `allowNull: true`, calzando con el DDL: la obligatoriedad la impone el validador, no la columna. `isActive` con `allowNull: false, defaultValue: true`.

**Sin archivo de asociaciones.** Es el tercer caso del repositorio, tras `diagnosticTerm` y `vaccineWhodrug`: la entidad no tiene FK saliente, y la única entrante la declarará `notificationDiluent` en su propio archivo, porque la asociación pertenece al lado que posee la clave. Crear hoy un `diluentCatalog.associations.ts` con cuerpo vacío y registrarlo en `initAssociations()` añade un artefacto que no hace nada. Es una desviación consciente del artefacto 2 de `CONVENTIONS.md` §1, con el precedente ya sentado dos veces, y queda razonada en §6.

### 3.3 Tipos

`src/types/diluentCatalog/diluentCatalog.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.

```ts
export interface CreateDiluentCatalogInput {
    code: string;                        // obligatorio en la API aunque el DDL lo permita nulo; único global
    name: string;
    description?: string | null;
    composition?: string | null;
    isActive?: boolean;
}
```

Son **cuatro campos de datos** más `isActive`.

El update usa `Partial<CreateDiluentCatalogInput>`. **No se declara `UpdateDiluentCatalogInput`** — está prohibido por §4 de las convenciones.

`description` y `composition` son `string | null`: `null` es un valor con el que se vacía la columna, distinto de no mandar la clave.

### 3.4 Superficie HTTP

```
POST   /api/diluents                 ESAVI-DILUENT-001   ADMIN       (nuevo)
GET    /api/diluents                 ESAVI-DILUENT-002A  USER        (nuevo)
GET    /api/diluents/admin           ESAVI-DILUENT-002B  ADMIN       (nuevo)
GET    /api/diluents/:id             ESAVI-DILUENT-003   USER        (nuevo)
PUT    /api/diluents/:id             ESAVI-DILUENT-004   ADMIN       (nuevo)
DELETE /api/diluents/:id             ESAVI-DILUENT-005A  ADMIN       (nuevo)
PATCH  /api/diluents/activate/:id    ESAVI-DILUENT-005B  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/diluentCatalog.routes.ts`: las rutas literales `/admin` y `/activate/:id` van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

**La ruta base no coincide con el nombre de la tabla.** La tabla es `diluentCatalog` y la ruta es `/api/diluents`; el archivo, el modelo, los tipos y el servicio siguen llamándose por la tabla. Es la segunda entidad del repositorio con esa divergencia, tras `vaccineWhodrug` → `/api/whodrug-vaccines`, y está decidida a propósito — la razón está en §6.

**No hay `005C`** (`diluentCatalog` está protegida por `preventPhysicalDelete`) **ni operaciones desde `006`**. Los códigos `006` en adelante quedan libres.

### 3.5 Reglas de negocio por operación

**`ESAVI-DILUENT-001` — crear.** Normaliza `code` con `toConstantCase` y `name` **solo con `.trim()`**. `description` y `composition` se guardan con `.trim()` cuando vienen. Comprueba unicidad global de `code` **contra el valor ya normalizado** y **sin filtrar por `isActive`** → 409 `DILUENT_001_CODE_EXISTS`. Entrada de auditoría en `appDetails` con `method: 'ESAVI-DILUENT-001'`.

**`ESAVI-DILUENT-002A` — listar público.** `findAndCountAll` con `isActive: true` fijo. Un solo filtro por query, opcional:

| Filtro | Comparación |
|---|---|
| `search` | `Op.iLike` con `%valor%` sobre `name`; **mínimo 2 caracteres** → 400 si es más corto |

Paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET` de `src/constants/pagination.constants.ts`, `limit` entre 1 y 100. Orden `name ASC`.

**`ESAVI-DILUENT-002B` — listar admin.** Gemela, sin `isActive` en el `where`. Mismo filtro, mismo orden y misma paginación. No añade ninguno propio.

**`ESAVI-DILUENT-003` — obtener por ID.** Existencia → 404 `DILUENT_003_NOT_FOUND`. Un diluyente inactivo devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — y ese predicado es **solo SUPERADMIN** (`src/helpers/permissions.helper.ts`), así que un ADMIN recibe el mismo 404 que un USER, aunque el `002B` sí le muestre inactivos. Es la misma asimetría deliberada que ya tienen `healthFacility`, `diagnosticTerm` y `vaccineWhodrug`. Sin `include`: la entidad no tiene asociaciones.

**`ESAVI-DILUENT-005A` / `005B` — desactivar y reactivar.** Sobre `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`), con transacción propia. El `where` filtra **solo por la PK**. Desactivar dos veces → 409 `DILUENT_005A_ALREADY_INACTIVE`; reactivar lo ya activo → 409 `DILUENT_005B_ALREADY_ACTIVE`. En `appDetails.method` va **solo** el código calculado (`005A` o `005B`), sin `_ACTIVATION` pegado detrás.

**No se comprueba ninguna FK entrante.** Es borrado lógico: el `ON DELETE RESTRICT` de `notificationDiluent` no se dispara, un diluyente inactivo se sigue referenciando por diseño, y esa tabla ni siquiera existe todavía. Desactivar significa «deja de ofrecerse en el desplegable», no «deja de existir».

#### Contrato de update diferencial

**`ESAVI-DILUENT-004` — actualizar.** Existencia → 404 `DILUENT_004_NOT_FOUND`. Si el body trae `code`, unicidad global contra el valor **ya normalizado**, excluyendo el propio id con `{ [Op.ne]: id }` y sin filtrar por `isActive` → 409 `DILUENT_004_CODE_EXISTS`, **antes** del diff e independientemente de él: un `code` ocupado es 409 aunque el resto del body no cambie nada. `stored` sale de `diluent.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`, y se responde 200.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `code` | `data.code ? toConstantCase(data.code.trim()) : undefined` | mutable; normalizado **antes** de comparar y antes de consultar unicidad |
| `name` | `data.name ? data.name.trim() : undefined` | solo `trim`, sin `toTitleCase` — ver §6 |
| `description` | `data.description !== undefined ? (data.description?.trim() ?? null) : undefined` | anulable: `null` vacía, `undefined` es «no vino» |
| `composition` | `data.composition !== undefined ? (data.composition?.trim() ?? null) : undefined` | anulable |
| `isActive` | **no entra** | lo gobiernan `005A`/`005B` |

Son **cuatro filas** en `candidates` — las cuatro columnas de datos de §3.1, ninguna omitida y ninguna de más.

Los tres puntos que esta tabla resuelve y que son los que se olvidan:

- **`code` se normaliza antes del diff y antes de la consulta de unicidad, con el mismo valor.** Comparar el body crudo contra el `stored` normalizado haría que un `PUT` con `"agua destilada"` sobre una fila que guarda `AGUA_DESTILADA` pareciera un cambio y escribiera en cada llamada.
- **`description` y `composition` son anulables y no entran bajo `if( data.x )`.** Ese `if` descartaría en silencio la cadena vacía y dejaría las columnas sin forma de vaciarse.
- **La unicidad va antes del diff y es independiente de él.** No hay FK saliente que validar, así que la mitad del criterio canónico que habla de FK inactivas no aplica aquí.

**Ninguna operación de este spec propaga nada a otra tabla.** No hay recálculos, ni cascadas, ni escrituras en entidades vecinas.

**No pasan por el helper**, y se declara una por una: el `001` (es un `create`), y el `005A` y el `005B` (escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`, que registran un hecho aunque ningún campo de datos cambie).

### 3.6 Claves i18n nuevas

Bloque `diluentCatalog` en `src/data/i18n/es.json`, `en.json` y `nl.json` — dieciséis claves, las mismas que estrenaron `diagnosticTerm` y `vaccineWhodrug`, con la del 409 nombrando `code`:

| Clave | Uso |
|---|---|
| `createdSuccess` | 201 del `001` |
| `createdFailed` | 500 del `001` |
| `getSuccess` | 200 del `003` |
| `getFailed` | 500 del `003` |
| `getSuccessPlural` | 200 de `002A` y `002B` |
| `getFailedPlural` | 500 de `002A` y `002B` |
| `updatedSuccess` | 200 del `004` |
| `updatedFailed` | 500 del `004` |
| `deletedSuccess` | 200 del `005A` |
| `deletedFailed` | 500 del `005A` |
| `activatedSuccess` | 200 del `005B` |
| `activatedFailed` | 500 del `005B` |
| `notFound` | 404 en `003`, `004`, `005A` y `005B` |
| `codeExists` | 409 por `code` duplicado, en `001` y `004` |
| `alreadyActive` | 409 de `setEntityActiveStatusService` |
| `alreadyInactive` | 409 de `setEntityActiveStatusService` |

Los nombres siguen la nomenclatura de `references/CONVENTIONS.md` §13 — `createdSuccess`/`createdFailed` y no `created`, par `Plural` para los listados. La regla de §13 «si el endpoint existe, sus dos claves existen» obliga a `deletedFailed` y `activatedFailed`, que un endpoint sin variante de error no necesitaría.

`tests/i18n/messages.test.ts` exige paridad exacta: o las dieciséis están en los tres archivos, o la suite falla.

**Ninguna clave nueva para los 400 de validación.** Los mensajes de `express-validator` los resuelve `validateFields` con su propio mecanismo, igual que en las veintidós entidades anteriores.

### 3.7 Forma de la respuesta

`003`, y cada fila de `002A` y `002B`, devuelven la fila **completa**: las once columnas menos `sysDetails`, que no se expone nunca.

```
{ ok, message, data: {
    diluentCatalogId, code, name, description, composition,
    isActive, createdAt, updatedAt, deletedAt, appDetails
} }
```

Misma forma en las tres operaciones de lectura, sin recortes para el desplegable: recortarla rompería la simetría con el resto del repositorio a cambio de unos pocos bytes por fila, sobre un catálogo que no pasará de unas decenas de filas.

Los listados devuelven `{ count, rows }` de `findAndCountAll` dentro de `data`. `002A` filtra por `isActive: true`; `002B` no filtra.

`001` responde 201 con la fila creada en `data`. `004` responde 200 con la fila resultante —cambiada o no—. `005A` y `005B` responden `{ ok, message }` **sin** `data`.

Sin `include` en ninguna operación: la entidad no tiene asociaciones.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registrar la abreviatura.** Añadir la fila `diluentCatalog | DILUENT` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en su posición alfabética —entre `diagnosticTerm` y `esaviCase`—. La norma exige registrar **antes** de usar, así que este paso va primero aunque no toque `src/`. **No** se registra ninguna operación no canónica: este spec no tiene ninguna.
   *Verificación:* `DILUENT` aparece una sola vez en la tabla y no colisiona con las 24 existentes.

2. **Corregir el rango de líneas de `preventPhysicalDelete` en `references/CONVENTIONS.md`.** El bucle se cita como `esaviapp.sql:1354-1360` en **dos** sitios —§6, regla de disponibilidad del `005C` (línea 252), y el checklist de PR de §15 (línea 1115)— pero hoy vive en **`esaviapp.sql:1361-1375`**: el DDL creció desde que se escribió esa referencia. Se corrigen las dos ocurrencias. **No** se tocan los siete specs funcionales que arrastran la misma cita: son documentos cerrados y su texto refleja el DDL del día en que se escribieron.
   *Verificación:* `grep -n "1354-1360" references/CONVENTIONS.md` no devuelve resultados; `sed -n '1361,1375p' esaviapp.sql` muestra el bucle completo con sus 18 tablas.

3. **Modelo, tipos y barrels.** `src/models/diluentCatalog.model.ts` con las once columnas de §3.1, respetando `STRING(100)` en `code`, `STRING(250)` en `name` y `TEXT` en `description` y `composition`; `code` con `allowNull: true`, calzando con el DDL. Alta en `src/models/index.ts`. `src/types/diluentCatalog/diluentCatalog.types.ts` con `CreateDiluentCatalogInput`, su `index.ts` de barrel y el alta en `src/types/index.ts`. **Sin archivo de asociaciones.**
   *Verificación:* `npm run build` en 0; un `DiluentCatalog.findAll()` en un script suelto devuelve filas sin error de columna inexistente.

4. **Las dieciséis claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

5. **`ESAVI-DILUENT-001` — crear.** `createDiluentCatalogService`, controlador y validador: `code` y `name` obligatorios con sus longitudes máximas (100 y 250), `description` y `composition` opcionales. Unicidad de `code` contra el valor normalizado, sin filtrar por `isActive`. Ruta `POST /` con `validateUserRole(ADMIN)`. Alta del validador en `src/validators/index.ts` y de la ruta en `src/routes/index.ts` bajo `/api/diluents`.
   *Verificación:* crear con `code: "  agua destilada  "` guarda `AGUA_DESTILADA`; repetir ese código devuelve **409**, no 500, incluso si la primera fila está inactiva; crear sin `code` devuelve **400** y sin `name` también; crear con `name: "Cloruro de sodio 0.9%"` guarda ese texto **literal**.

6. **`ESAVI-DILUENT-002A` — listado público.** `getAllDiluentCatalogsService` con `isActive: true`, el filtro `search` de §3.5, `findAndCountAll`, orden `name ASC`. Validador de query con `search` de mínimo 2 caracteres y `limit` entre 1 y 100. Ruta `GET /` con `validateUserRole(USER)`.
   *Verificación:* `?search=sodio` encuentra las filas cuyo `name` lo contiene en cualquier posición y sin distinguir mayúsculas; `?search=s` devuelve **400**; una fila inactiva no aparece.

7. **`ESAVI-DILUENT-002B` — listado admin.** Gemela sin `isActive` en el `where`. Ruta `GET /admin` con `validateUserRole(ADMIN)`, declarada **antes** de `/:id`.
   *Verificación:* un ADMIN ve las inactivas; un USER recibe **403**; el filtro `search` se comporta igual que en `002A`.

8. **`ESAVI-DILUENT-003` — obtener por ID.** `getDiluentCatalogByIdService(id, lang, includeInactive)`; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales, con su `diluentCatalogIdValidator`.
   *Verificación:* un ID inexistente devuelve **404**; `GET /admin` no se interpreta como un `:id`; una fila inactiva devuelve **404** para USER y para ADMIN, y **200** para SUPERADMIN.

9. **`ESAVI-DILUENT-004` — actualizar.** `updateDiluentCatalogService` con la tabla de `candidates` de §3.5 completa —las cuatro columnas de datos— y `buildDifferentialUpdate`. Unicidad de `code` sobre el valor normalizado, antes del diff. Preserva el historial con `[...currentAppDetails, newEntry]`. Ruta `PUT /:id` con `validateUserRole(ADMIN)` y el validador del `001` en variante opcional.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta del `GET` devuelve **200** sin tocar `appDetails`, `updatedAt` ni `sysDetails.version`; un `PUT` con `code: "agua destilada"` sobre una fila que guarda `AGUA_DESTILADA` **no escribe**; un `PUT` con `description: null` vacía la columna.

10. **`ESAVI-DILUENT-005A` y `005B` — desactivar y reactivar.** `setDiluentCatalogActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción. Dos controladores y dos rutas — `DELETE /:id` ADMIN, `PATCH /activate/:id` SUPERADMIN —, ambas respondiendo sin `data`.
    *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve **409** `ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe **403** en `PATCH /activate/:id`.

11. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **162 a 169** (`tests/auth/roles.test.ts:341`).
    *Verificación:* `npm test -- roles` pasa con 169.

12. **Suite `tests/contract/diluentCatalog.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar público → listar admin → actualizar → desactivar → reactivar, verificando estado y envelope en cada paso. Más los caminos de error: 409 de `code` duplicado en create y en update, 409 con la fila duplicada **inactiva**, 400 de `search` corto, 400 de `code` ausente, y los cinco casos de update diferencial de §5. Bloque específico para el par normalización/diff: un `PUT` que manda el `code` sin normalizar sobre la fila que ya lo guarda normalizado **no escribe**.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado, bajo `/api/diluents`.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones.
- [ ] `grep -rn "ESAVI-DILUENT-002[^AB]" src/` no devuelve resultados: todo es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-DILUENT-00[6789]" src/` no devuelve resultados: este spec no tiene operaciones no canónicas.
- [ ] `grep -rn "ESAVI-DILUENT-005C\|/purge" src/routes/diluentCatalog.routes.ts` no devuelve resultados: la tabla está protegida por `preventPhysicalDelete` y no expone borrado físico.
- [ ] Crear con `code: "  agua destilada  "` guarda `AGUA_DESTILADA`.
- [ ] Crear con `name: "Cloruro de sodio 0.9%"` guarda `Cloruro de sodio 0.9%` **sin** recapitalizar: se aplica `.trim()` y nada más.
- [ ] Crear sin `code` devuelve 400; crear sin `name` devuelve 400.
- [ ] Crear dos veces el mismo `code` devuelve 409, no 500, **incluso si el primero está inactivo**.
- [ ] `?search=sodio` encuentra `Cloruro de sodio 0.9%`; `?search=s` devuelve 400.
- [ ] `GET /admin` no se interpreta como un `:id`.
- [ ] `GET /:id` de una fila inactiva: 404 para USER **y para ADMIN**, 200 para SUPERADMIN. `canViewInactive` es SUPERADMIN-only y el `002B` sigue siendo ADMIN: la asimetría es deliberada y la misma que tienen `healthFacility`, `diagnosticTerm` y `vaccineWhodrug`.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Desactivar una fila no consulta ninguna tabla hija: `grep -n "notificationDiluent" src/services/diluentCatalog.service.ts` no devuelve resultados.
- [ ] `appDetails.method` guarda `ESAVI-DILUENT-005A` o `ESAVI-DILUENT-005B`, sin `_ACTIVATION` pegado detrás.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `sysDetails` no aparece en ninguna respuesta: `grep -n "sysDetails" src/controllers/diluentCatalog.controller.ts` no devuelve resultados.
- [ ] Las dieciséis claves existen en es, en y nl con los nombres de §3.6; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 169 entradas y `npm test -- roles` pasa.
- [ ] No existe `src/models/associations/diluentCatalog.associations.ts`, y `initAssociations()` no lo referencia.
- [ ] `grep -n "1354-1360" references/CONVENTIONS.md` no devuelve resultados: las dos citas del bucle `preventPhysicalDelete` apuntan a `esaviapp.sql:1361-1375`.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/diluentCatalog.service.ts` no devuelve resultados.
- [ ] Un `PUT` con un `code` ya ocupado por otra fila responde **409** aunque el resto del body no cambie nada. La mitad del criterio canónico que habla de FK inactivas no aplica: `diluentCatalog` no tiene ninguna FK saliente.

**Propios del `004` — la normalización y los anulables:**

- [ ] Un `PUT` con `code: "agua destilada"` sobre una fila que guarda `AGUA_DESTILADA` responde **200** y **no escribe**: el candidato se normaliza antes de comparar.
- [ ] Un `PUT` con `code` cambiado a un valor libre responde **200** y actualiza el código: es mutable.
- [ ] Un `PUT` con `description: null` vacía la columna; un `PUT` con `description: ""` guarda la cadena vacía, que **no** es lo mismo.
- [ ] Un `PUT` sin la clave `composition` deja la columna como estaba.
- [ ] Las cuatro columnas de datos aparecen en `candidates`, y `isActive` **no** está entre ellas.
- [ ] Un `PUT` con `isActive: false` en el body responde **200** y **no** desactiva la fila: la activación es de `005A`.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `DILUENT`. Siete letras, dentro del rango de 4 a 8 de §6, no colisiona con las 24 registradas y se lee sin diccionario. **No:** `DILCAT`, que abrevia dos palabras a la mitad y obliga a reconstruir mentalmente cuál era cada una.
- **Sí:** ruta base `/api/diluents`, distinta del nombre de la tabla `diluentCatalog`. Lo que el catálogo contiene son **diluyentes**; «catalog» describe el contenedor, no el recurso, y un recurso REST se nombra por lo que devuelve. El precedente es `vaccineWhodrug` → `/api/whodrug-vaccines` del [SPEC F18](./18-vaccinewhodrug-crud.md). El archivo, el modelo, los tipos y el servicio siguen llamándose por la tabla, porque ahí el nombre tiene que calzar con el DDL. **No:** `/api/diluent-catalogs`, que arrastra a la URL una palabra que no aporta nada al consumidor.
- **No:** renombrar la tabla en `esaviapp.sql`. El fichero se carga en los tests y ya tiene una FK entrante declarada contra ese nombre. Cambiar el esquema para arreglar una preferencia de lectura no compensa.
- **Sí:** `code` obligatorio **como dato** en la API aunque el DDL lo permita nulo. Un diluyente sin código no se cruza con nada, que es lo único para lo que existe un maestro. La API más estricta que el esquema es la dirección segura, y es el mismo movimiento que hicieron el F15 con `diagnosticTerm.code` y el F18 con `drugCode`. **No:** aprovechar que el `UNIQUE` de Postgres admite N filas con `NULL` para permitir altas sin código, como sí hace el F18 con `externalId`: allí el nulo distingue «alta manual» de «fila del diccionario importado», y aquí no hay importación de la que distinguirse.
- **Sí:** `code` normalizado con **`toConstantCase`**, la norma canónica de `CONVENTIONS.md` §11. Aquí sí aplica y en los otros dos catálogos clínicos no: `diagnosticTerm.code` y `vaccineWhodrug.drugCode` son datos **citados** de un diccionario externo —MedDRA, WHODrug— y alterarlos rompe la correspondencia con el fichero de origen. Un código de diluyente lo **acuña el administrador local** desde el formulario: no cita nada, así que normalizarlo cierra el duplicado por caja y por espaciado sin destruir información de nadie.
- **Sí:** `name` solo con `.trim()`, sin `toTitleCase`. Es la desviación de §11 que ya razonaron el F15 y el F18, y aquí es igual de aguda: `toTitleCase` convertiría `"Cloruro de sodio 0.9%"` en `"Cloruro De Sodio 0.9%"` y `"Agua para inyección"` en `"Agua Para Inyección"`. Un nombre de producto farmacéutico lleva preposiciones en minúscula y concentraciones que no se recapitalizan. **La asimetría con `code` es deliberada:** el código es un identificador que la aplicación fabrica, el nombre es un texto que el usuario escribe.
- **Sí:** unicidad de `code` **global y sin filtrar por `isActive`**. Un código ocupado por una fila desactivada sigue ocupado: reutilizarlo haría que dos filas distintas compartan identificador en la auditoría y en cualquier exportación histórica. Además es lo que impone el `UNIQUE` del DDL, que no sabe de `isActive` — filtrar por él en la aplicación convertiría un 409 en un 500 cuando la base rechazara el `INSERT`.
- **Sí:** `code` mutable en el `004`, con su comprobación de unicidad excluyendo el propio id. Un alta manual con un typo tiene que poder corregirse, y la unicidad ya protege el resultado. Es lo que hicieron `HFAC`, `DIAGTERM` y `WHODRUG`.
- **Sí:** normalizar el `code` candidato **antes** de compararlo en el diff, con exactamente la misma función que usa el `001`. Es el punto donde este spec se rompería en silencio: comparar `"agua destilada"` contra el `AGUA_DESTILADA` guardado daría «cambió» en cada `PUT`, y el catálogo acumularía una entrada de `appDetails` por cada guardado sin cambios. **No:** comparar el valor crudo y normalizar al escribir.
- **Sí:** sin resolución implícita. `diagnosticTerm` tiene su `006` porque un término clínico local es una descripción que el notificador legítimamente acuña sobre la marcha. Un diluyente es un **producto físico con composición declarada**: crear filas al vuelo desde un formulario llenaría un catálogo de una docena de entradas con variantes ortográficas de «agua destilada», indistinguibles del maestro real. **Sí:** cuando el diluyente no está codificado, la FK se queda en nulo y `notificationDiluent.diluentName` y `diluentCode` (`esaviapp.sql:873-874`) conservan lo notificado. El esquema puso esos dos campos exactamente para este caso, y la notificación no se bloquea por no estar codificada.
- **Sí:** sin importación masiva. Los otros dos catálogos clínicos la tienen —F17 desde MedDRA `.asc`, F19 desde WHODrug `.xlsx`— porque existe un fichero de origen reconocido. Para diluyentes no lo hay, y el catálogo cabe en una tarde de altas manuales. **No:** dejar `ESAVI-DILUENT-006` apartado «por si acaso»: apartar un código sin spec que lo implemente es exactamente el TODO que la norma prohíbe.
- **Sí:** no crear archivo de asociaciones. `diluentCatalog` no tiene FK saliente y la única entrante pertenece a `notificationDiluent`, que la declarará en su propio archivo. Es desviación consciente del artefacto 2 de §1, con dos precedentes ya sentados, no olvido.
- **Sí:** no bloquear la desactivación cuando el diluyente ya está referenciado. Es borrado lógico: el `ON DELETE RESTRICT` de `notificationDiluent` no se dispara, consultar una tabla de otro dominio acoplaría este catálogo a notificación, y esa tabla ni siquiera existe. Mismo razonamiento que el SPEC 09 con `healthFacility`, el F15 con `diagnosticTerm` y el F18 con `vaccineWhodrug`.
- **Sí:** un diluyente inactivo se sigue referenciando. Desactivar significa «deja de ofrecerse en el desplegable». La referencia histórica se conserva, y `notificationDiluent` guarda además la copia de texto, así que la notificación se lee entera sin el maestro.
- **Sí:** `Op.iLike` con `%valor%` sobre `name`, con mínimo de 2 caracteres, acotado a `002A` y `002B`. El precedente lo abrió el F15. **No:** prescindir del `search` por ser un catálogo corto: el endpoint lo consume el mismo formulario de notificación que ya busca así en `diagnosticTerm` y `vaccineWhodrug`, y una entidad que se comporta distinto obliga al cliente a escribir un caso especial. El coste de sostenerlo es un `where` de tres líneas.
- **No:** ningún otro filtro de listado. La tabla no tiene columna que sirva de faceta: `description` y `composition` son texto largo, y no hay fabricante, presentación ni tipo. Inventar uno sería inventar semántica que el esquema no tiene.
- **No:** un filtro o un endpoint que cruce diluyente con vacuna compatible. No hay tabla puente en el esquema; modelar esa compatibilidad es una regla clínica nueva, no dar de alta un catálogo.
- **No:** convertir `vaccineWhodrug.diluent` —hoy `text` libre, `esaviapp.sql:587`— en una FK a esta tabla, aprovechando que el maestro ya existe. Es un cambio de esquema sobre una tabla poblada por importación, y la columna trae el texto del fichero WHODrug, que no tiene por qué casar con ningún código local. El F18 ya lo dejó fuera; este spec mantiene el criterio.
- **Sí:** las mismas dieciséis claves i18n que `diagnosticTerm` y `vaccineWhodrug`, con la nomenclatura de §13. La paridad de forma entre entidades es lo que permite leer un `getMessage` sin abrir el JSON.
- **Sí:** forma de respuesta completa también en `002A`. Recortarla para el desplegable rompería la simetría con el resto del repositorio a cambio de unos pocos bytes por fila, sobre un catálogo que no pasará de unas decenas.
- **Sí:** corregir en `references/CONVENTIONS.md` las dos citas obsoletas del bucle `preventPhysicalDelete`, y **no** tocar las de los siete specs funcionales que arrastran la misma. La norma tiene que apuntar al DDL vigente porque se consulta para decidir; un spec cerrado es el registro de lo que se sabía el día que se escribió, y reescribirlo borra esa trazabilidad.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El `code` candidato se compara sin normalizar** y el `004` escribe en cada `PUT` que reenvía el `GET` con el código tal como lo teclea un humano | Es el error más probable de todo el spec, y el único que los cinco criterios canónicos de update diferencial **no** atrapan por sí solos: el `GET` devuelve el valor ya normalizado, así que reenviarlo íntegro pasa el test. Cubierto por un criterio propio en §5 —`PUT` con `code: "agua destilada"` sobre `AGUA_DESTILADA` no escribe— y por un bloque específico de la suite de contrato |
| Alguien aplica `toTitleCase` a `name` por inercia, copiando el bloque desde `healthFacility` o `catalogItem`, y `"Cloruro de sodio 0.9%"` se guarda como `"Cloruro De Sodio 0.9%"` | La asimetría `toConstantCase` en `code` / solo `.trim()` en `name` está razonada en §6, declarada en §3.5 y cubierta por dos criterios de aceptación. Es una desviación de §11 con dos precedentes (F15, F18) |
| La unicidad de `code` se comprueba filtrando por `isActive` y el `INSERT` acaba rechazado por la base: el cliente recibe **500** donde le corresponde un **409** | Declarado en §3.5 y en §6, con un criterio de aceptación que exige el 409 **con la fila duplicada inactiva**. Es la misma desviación que el SPEC 09 tuvo que corregir en `healthFacility` |
| `description` o `composition` entran bajo `if( data.x )` y quedan sin forma de vaciarse | Los dos están nombrados en la tabla de `candidates` de §3.5 con su forma exacta, y hay criterios propios para `null` y para la cadena vacía, que no son lo mismo |
| El `UNIQUE` de `code` es **anónimo** —declarado en línea, sin `CONSTRAINT` con nombre— así que el error de Postgres llega como `diluentCatalog_code_key` y no como un `UQ_*` reconocible | El servicio nunca depende del nombre del constraint: comprueba la unicidad con una consulta previa y devuelve 409 antes de llegar a la base. El nombre generado solo aparecería en un 500, que es justo lo que el spec evita |
| `GET /:id` captura `/admin` o `/activate` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato |
| La divergencia entre la tabla `diluentCatalog` y la ruta `/api/diluents` confunde a quien busca el archivo por la URL | Es la segunda entidad del repositorio con esa divergencia, tras `vaccineWhodrug`. Anotada en §3.4, en §6 y en el comentario de cabecera de `src/routes/diluentCatalog.routes.ts` |
| Alguien lee la ausencia de `005C` como un olvido y añade el endpoint, que la base rechazaría con un 500 | La regla de disponibilidad de §6 es objetiva contra el DDL, `diluentCatalog` está en `esaviapp.sql:1368`, y hay un criterio de aceptación que verifica la **ausencia** con un `grep` |
| Alguien lee la ausencia de `006` como un olvido y añade resolución implícita al estilo de `diagnosticTerm` | Razonado en §1, en §2 y en §6, y cubierto por el `grep` de `ESAVI-DILUENT-00[6789]` en §5 |
| Un diluyente se desactiva y las notificaciones que lo referencian apuntan a algo que el desplegable ya no ofrece | Es el comportamiento buscado: la referencia es histórica. `notificationDiluent` guarda además `diluentName` y `diluentCode` como copia, así que la notificación se lee entera sin el maestro |
| Se corrigen las dos citas de `CONVENTIONS.md` y alguien las vuelve a desincronizar en el siguiente crecimiento del DDL | El riesgo es estructural y este spec no lo resuelve: la norma cita líneas de un fichero que crece. Lo que sí hace es dejar el rango correcto hoy y un criterio de aceptación que lo verifica |

---

## 8. Impacto en el contrato HTTP

No aplica. El spec solo añade endpoints nuevos; ningún cliente actual cambia de comportamiento. Tampoco hay cambios de esquema: el DDL de `diluentCatalog` se toma tal cual está en `esaviapp.sql:603-615`.

El único cambio sobre material existente es documental —las dos citas de `references/CONVENTIONS.md` corregidas en el paso 2— y no altera ninguna regla, solo la línea a la que apunta.

---

## Lo que **no** está en este spec

- `notificationDiluent`, y con ella el resto de la cadena `notificación → vacuna → diluyente`.
- La resolución implícita desde una notificación: no hay equivalente al `ESAVI-DIAGTERM-006` y no lo habrá.
- La importación masiva desde fichero. No hay fichero de origen conocido, y `ESAVI-DILUENT-006` en adelante queda libre y sin reservar.
- Convertir `vaccineWhodrug.diluent` en una FK a esta tabla.
- La relación entre un diluyente y las vacunas con las que es compatible.
- El borrado físico `005C`: la tabla está protegida por `preventPhysicalDelete`.
- La fusión de entradas duplicadas y el repunte de la FK entrante.
- Cualquier filtro de listado más allá de `search`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
