# SPEC F18 — CRUD de `vaccineWhodrug`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa), SPEC F15 (precedente directo: catálogo clínico plano, `Op.iLike` acotado y normalización de un dato citado), **SPEC F19 paso 1 (precondición de orden: los cuatro cambios de esquema sobre `vaccineWhodrug` se aplican antes de escribir el modelo de este spec)**
> **Fecha:** 2026-08-14
> **Objetivo:** Dar de alta `vaccineWhodrug` con sus siete operaciones canónicas, como catálogo de consulta del diccionario WHODrug de vacunas.

> **Nota de revisión (2026-08-14).** El [SPEC F19](./19-vaccinewhodrug-bulk-import.md) abrió el fichero real del diccionario y encontró que **`drugCode` se repite por diseño** —una misma vacuna se alcanza por su presentación en cada país— y que la única columna única por fila es `id`, que en la tabla es `externalId`. Este documento ya incorpora la enmienda completa que aquel spec enumeró en su §8: `externalId` es la clave única, `drugCode` deja de tener unicidad, la columna `acts` pasa a `atcs`, se suma `metadata`, y el recuento sube a **28 columnas de datos** sobre una tabla de **36**. **El paso 1 del F19 —los cambios en `esaviapp.sql`— se ejecuta antes que el paso 2 de este spec**; el resto del F19 va después de implementar éste entero.

---

## 1. Por qué existe este spec

`vaccineWhodrug` es el **vocabulario controlado con el que se identifica la vacuna sospechosa** de un ESAVI: qué se administró, dicho con un código que se pueda cruzar entre notificaciones, entre investigaciones y con el resto del mundo. Hoy la tabla existe en `esaviapp.sql:561-599` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es el segundo de los tres catálogos clínicos pendientes, después del que abrió el [SPEC F15](./15-diagnosticterm-crud.md). **Dos tablas lo esperan**, las dos con FK nullable y `ON DELETE RESTRICT`:

- `notificationVaccine.vaccineWhodrugId` — `esaviapp.sql:836`
- `investigationVaccineAdministered.vaccineWhodrugId` — `esaviapp.sql:1150`

Ninguna de las dos está implementada. `notificationVaccine` es una de las satélites de `notification` que quedan en la cola, y no se puede especificar sin decidir antes de dónde sale la vacuna que referencia.

**El mismo patrón «crudo más codificado» del F15.** `notificationVaccine` lleva, junto a la FK, tres campos de texto libre — `whoCode`, `vaccineCode` y `vaccineName` (`esaviapp.sql:839-841`). No es redundancia. El notificador escribe la vacuna que consta en el carné y la notificación **no se bloquea** por no estar codificada; la FK nullable representa «notificado pero sin codificar», y la copia de texto conserva lo notificado aunque el maestro se renombre después.

**Dónde se aparta este spec del F15, y por qué.** El F15 entregó, además del CRUD, un servicio de resolución implícita (`006`) que crea el término al vuelo cuando el notificador escribe uno que no existe. **Aquí no lo hay.** Un término clínico local es una descripción que el notificador legítimamente acuña; una entrada de WHODrug es una fila de un diccionario licenciado, con su `drugRecNo`, su `medicinalProductId` y su titular de registro. Nadie la inventa desde un formulario. Cuando la vacuna no está codificada, la FK se queda en nulo y el texto crudo hace su trabajo — que es exactamente para lo que el esquema puso esos tres campos.

**El esquema ya anticipa cómo se consulta esta tabla.** `CREATE INDEX "IX_vaccineWhodrug_name" ... USING gin (to_tsvector('simple', coalesce("drugName", '')))` (`esaviapp.sql:599`) es el único índice de búsqueda por texto declarado en las 45 tablas. El caso de uso es el autocomplete del formulario de notificación, y este spec lo entrega — aunque, por la razón que está en §6, no por la vía de ese índice.

**Sin `005C`.** `vaccineWhodrug` figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1361-1370`), así que por la regla de disponibilidad de `CONVENTIONS.md` §6 el borrado físico **no se declara**. Son siete operaciones canónicas, ni una más.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `vaccineWhodrug`: modelo, tipos, validadores, servicio, controlador y ruta. **Sin archivo de asociaciones** — la entidad no tiene ninguna FK saliente; la razón está en §3.2 y en §6.
- **Siete operaciones canónicas** — `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar. Ninguna operación no canónica.
- Ruta base **`/api/whodrug-vaccines`**, deliberadamente distinta del nombre de la tabla `vaccineWhodrug`. La razón está en §6.
- Alta de la abreviatura `WHODRUG` en la tabla de `references/CONVENTIONS.md` §6.
- Las **28 columnas de datos** de §3.1 escribibles en `001` y `004`, con `drugCode` y `drugName` obligatorios y las 26 restantes opcionales. `metadata` **no** es escribible: la escribe el `007` del F19 al insertar y nadie más.
- `drugCode` **obligatorio como dato** en la API aunque el DDL lo permita nulo — una entrada de diccionario sin código no sirve para cruzar nada—, pero **sin unicidad**: el fichero real lo repite por diseño y el esquema ya no lo restringe.
- Unicidad **global de `externalId`**, comprobada **solo cuando el body lo trae no nulo**, sin filtrar por `isActive` y excluyendo el propio id en el `004` con `{ [Op.ne]: id }`.
- `drugCode` y `drugName` normalizados **solo con `.trim()`**, sin `toConstantCase` ni `toTitleCase`. Es una desviación razonada de `CONVENTIONS.md` §11, argumentada en §6.
- Búsqueda por texto con `Op.iLike` sobre `drugName`, acotada a `002A` y `002B`, con mínimo de 2 caracteres.
- Filtros de listado por `language`, `iso3Code`, `isPreferred` e `isGeneric`, todos por igualdad exacta. Orden por defecto `drugName ASC`.
- `drugCode` y `externalId` **mutables** en el `004`; solo el segundo lleva comprobación de unicidad antes del diff.
- Un bloque `vaccineWhodrug` con dieciséis claves i18n en `es`, `en` y `nl`, nombradas según `references/CONVENTIONS.md` §13.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **135 a 142**.
- Suite `tests/contract/vaccineWhodrug.test.ts`.

**Fuera de alcance (otros specs):**

- **La importación masiva del diccionario desde `.xlsx`.** Es el **SPEC F19**, que ocupa el código `ESAVI-WHODRUG-007`. Exige `multer`, una librería de lectura de Excel nueva en el repositorio, procesamiento por lotes en transacciones propias, modo `dryRun` e informe de proceso — es carga de datos, no un CRUD. Este spec deja la entidad lista para recibirla: el mismo `drugCode` normalizado igual y la misma clave —`externalId`— que el importador usa para deduplicar.
- **La resolución implícita desde una notificación.** No hay equivalente al `ESAVI-DIAGTERM-006` y no lo habrá: una entrada de un diccionario licenciado no se acuña desde un formulario. La razón completa está en §1 y en §6.
- **El versionado del diccionario.** No hay tabla de versiones ni histórico de cargas. El F19 guarda la procedencia de cada fila en `metadata` y nada más.
- **La jerarquía WHODrug y la codificación ATC.** `drugRecNo` y `drugRecNoSeq` se guardan como texto plano; no hay tabla que resuelva el árbol de productos ni la clasificación anatómico-terapéutica.
- **La fusión de entradas duplicadas.** Repuntar las dos FK entrantes antes de retirar la sobrante es una operación con su propia transacción y su propio rol, y las dos tablas destino aún no existen.
- **`notificationVaccine` e `investigationVaccineAdministered`.** Este spec entrega el maestro; quien lo referencia llega en sus propios specs.
- **La búsqueda full-text sobre `IX_vaccineWhodrug_name`.** El índice GIN queda sin usar deliberadamente; §6 explica por qué y qué haría falta para aprovecharlo.
- **Cualquier unicidad sobre `drugCode`,** compuesta o no. El fichero lo repite por diseño y el F19 razonó por qué ninguna combinación de columnas sirve de clave alternativa.
- **Cualquier regla de unicidad sobre `isPreferred`.** El DDL no impone ninguna y no hay columna que sirva de ámbito; es un flag libre.
- **Pasar `externalId` de `integer` a `bigint`.** Riesgo declarado en el F19 §7.
- **Exponer o editar `sysDetails`, y escribir `metadata` desde el CRUD.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`vaccineWhodrug` — `esaviapp.sql:561-599`, **con los cuatro cambios del paso 1 del [SPEC F19](./19-vaccinewhodrug-bulk-import.md) ya aplicados**. Tabla plana: **ninguna clave foránea saliente**. 36 columnas: la PK, 28 de datos, `metadata` y 6 transversales.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `vaccineWhodrugId` | `uuid` | no | PK, `gen_random_uuid()` |
| `externalId` | `integer` | sí | id en el sistema de origen. `UQ_vaccineWhodrug_externalId` — unicidad global. **Nullable a propósito**: bajo un `UNIQUE` de Postgres, N filas con `NULL` conviven, así que un alta manual sin `externalId` nunca colisiona con el espacio de claves del diccionario |
| `drugCode` | `varchar(250)` | **sí en el DDL** | **sin unicidad**: el fichero WHODrug lo repite por diseño. La API lo exige obligatorio como dato |
| `drugRecNo` | `varchar(50)` | sí | |
| `drugRecNoSeq` | `varchar(50)` | sí | |
| `drugName` | `text` | no | indexado por `IX_vaccineWhodrug_name` |
| `language` | `varchar(10)` | sí | |
| `medicinalProductId` | `varchar(250)` | sí | |
| `atcs` | `varchar(250)` | sí | **renombrada desde `acts`** por el paso 1 del F19: la cabecera del fichero es `atcs` y los valores son códigos ATC (`J07AN`) |
| `icd11` | `varchar(250)` | sí | |
| `icd11Term` | `varchar(500)` | sí | |
| `abbreviation` | `varchar(250)` | sí | |
| `ingredient` | `text` | sí | |
| `ingredientTranslation` | `text` | sí | |
| `languageCode` | `varchar(100)` | sí | distinta de `language` — ver la nota de abajo |
| `iso3Code` | `varchar(250)` | sí | |
| `countryMedicinalProductId` | `varchar(250)` | sí | |
| `maHolders` | `text` | sí | titulares de la autorización de comercialización |
| `maHoldersMedicinalProductId` | `varchar(250)` | sí | |
| `form` | `text` | sí | |
| `formTranslations` | `text` | sí | |
| `formMedicinalProductId` | `varchar(250)` | sí | |
| `strength` | `text` | sí | |
| `strengthMedicinalProductId` | `varchar(250)` | sí | |
| `noDose` | `text` | sí | |
| `diluent` | `text` | sí | texto libre; **no** es una FK a `diluentCatalog` |
| `isGeneric` | `boolean` | sí | **sin `DEFAULT`**: admite `null` como tercer estado |
| `isPreferred` | `boolean` | no | `DEFAULT false` |
| `notes` | `text` | sí | |
| `metadata` | `jsonb` | no | `DEFAULT '{}'::jsonb`. **Añadida por el paso 1 del F19.** No es columna de datos escribible: la escribe el `007` al insertar; este spec solo la lee |
| `isActive` | `boolean` | no | `DEFAULT true` |
| `createdAt` | `timestamptz` | no | `DEFAULT current_timestamp` |
| `updatedAt` | `timestamptz` | sí | lo escribe la aplicación |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `appDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |

Restricción única: `CONSTRAINT "UQ_vaccineWhodrug_externalId" UNIQUE ("externalId")` (`esaviapp.sql:597`, tras el paso 1 del F19). Es unicidad **global** sobre una sola columna, no compuesta — a diferencia del par `(source, code)` de `diagnosticTerm`. **Sobre `drugCode` no hay ninguna restricción**: dos filas con el mismo `drugCode` y distinto `externalId` son legítimas y describen dos presentaciones de la misma vacuna.

Índice: `CREATE INDEX "IX_vaccineWhodrug_name" ON "vaccineWhodrug" USING gin (to_tsvector('simple', coalesce("drugName", '')))` (`esaviapp.sql:599`). **Este spec no lo usa**; queda declarado y sin consumir por la razón de §6.

Sin `CHECK` propios y sin FK. Los dos triggers que alcanzan la tabla los montan bucles genéricos: `TRG_vaccineWhodrug_setSysDetails`, sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1275-1290`), y `TRG_vaccineWhodrug_preventPhysicalDelete`, sobre las 18 tablas protegidas (`esaviapp.sql:1356-1370`). **No existe `TRG_vaccineWhodrug_setUpdatedAt`**: el bucle de `sysDetails` lo borra explícitamente si lo encuentra y no lo vuelve a crear, así que `updatedAt` lo escribe siempre la aplicación.

Las cuatro columnas transversales están completas. Sobre `appDetails`, el mismo comportamiento que el F15 dejó escrito: su `DEFAULT` en el DDL es `'{}'` —un objeto—, no `'[]'`; el servicio escribe siempre un array y lo lee con `Array.isArray(drug.appDetails) ? drug.appDetails : []`, que resuelve el default sin tocar el SQL.

**Dos anomalías del DDL que este spec acepta tal cual, sin corregir:**

- **`language` y `languageCode` coexisten** como columnas distintas, de anchos distintos (`varchar(10)` y `varchar(100)`). Son dos campos del volcado de origen y este spec los expone como dos campos independientes. El fichero real confirma que **son dos cabeceras distintas** (`language` y `languageCode`, F19 §3.5), así que no hay nada que reconciliar: el DDL reproduce el origen.
- **`diluent` es texto libre**, no una FK a `diluentCatalog` (`esaviapp.sql:599`), pese a que la tabla existe. Este spec no inventa la relación: la columna es `text` y se trata como `text`.

Sin ENUM: ninguna columna de esta tabla usa un tipo enumerado.

### 3.2 Modelo Sequelize

`src/models/vaccineWhodrug.model.ts`, clase `VaccineWhodrug`, con las **36 columnas** de §3.1. `timestamps: false`, `freezeTableName: true`, `tableName: 'vaccineWhodrug'` —el nombre real de la tabla, aunque la ruta HTTP sea otra—, PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `sysDetails`, `appDetails` y `metadata` como `DataTypes.JSONB`. Las columnas `text` como `DataTypes.TEXT` y las `varchar(n)` como `DataTypes.STRING(n)`, respetando el ancho declarado. Alta en `src/models/index.ts`.

El atributo se llama **`atcs`**, no `acts`: el DDL se corrigió en el paso 1 del F19 y el modelo calza con la tabla, sin alias de por medio.

`metadata` se declara `DataTypes.JSONB`, `allowNull: false`, `defaultValue: {}`. Existe en el modelo porque la columna existe y las lecturas la devuelven, pero **ninguna operación de este spec la escribe**: la escribe el `ESAVI-WHODRUG-007` del F19 al insertar.

`isGeneric` se declara `allowNull: true` **sin `defaultValue`**, y `isPreferred` `allowNull: false, defaultValue: false`. La diferencia es del DDL y tiene consecuencias en la tabla de `candidates` de §3.5.

**Sin archivo de asociaciones.** Es el segundo caso del repositorio, después de `diagnosticTerm`: la entidad no tiene FK saliente, y las dos entrantes las declararán `notificationVaccine` e `investigationVaccineAdministered` en sus propios archivos, porque la asociación pertenece al lado que posee la clave. Crear hoy un `vaccineWhodrug.associations.ts` con cuerpo vacío y registrarlo en `initAssociations()` añade un artefacto que no hace nada. Es una desviación consciente del artefacto 2 de `CONVENTIONS.md` §1, con el precedente ya sentado por el F15, y queda razonada en §6.

### 3.3 Tipos

`src/types/vaccineWhodrug/vaccineWhodrug.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.

```ts
export interface CreateVaccineWhodrugInput {
    drugCode: string;                            // obligatorio en la API aunque el DDL lo permita nulo; sin unicidad
    drugName: string;
    externalId?: number | null;                  // clave única cuando viene; null admitido y no colisiona
    drugRecNo?: string | null;
    drugRecNoSeq?: string | null;
    language?: string | null;
    medicinalProductId?: string | null;
    atcs?: string | null;
    icd11?: string | null;
    icd11Term?: string | null;
    abbreviation?: string | null;
    ingredient?: string | null;
    ingredientTranslation?: string | null;
    languageCode?: string | null;
    iso3Code?: string | null;
    countryMedicinalProductId?: string | null;
    maHolders?: string | null;
    maHoldersMedicinalProductId?: string | null;
    form?: string | null;
    formTranslations?: string | null;
    formMedicinalProductId?: string | null;
    strength?: string | null;
    strengthMedicinalProductId?: string | null;
    noDose?: string | null;
    diluent?: string | null;
    isGeneric?: boolean | null;                  // tres estados: true, false, null
    isPreferred?: boolean;                       // NOT NULL DEFAULT false: nunca null
    notes?: string | null;
    isActive?: boolean;
}
```

Son **28 campos de datos** más `isActive`. **`metadata` no forma parte de la interfaz**: no es un campo que el cliente escriba.

El update usa `Partial<CreateVaccineWhodrugInput>`. **No se declara `UpdateVaccineWhodrugInput`** — está prohibido por §4 de las convenciones.

Las 26 columnas opcionales son `T | null` **salvo `isPreferred`**, que es `NOT NULL DEFAULT false` en el DDL y por tanto no admite `null` en ninguna capa. `isGeneric`, en cambio, sí: el DDL no le puso `DEFAULT`, así que «genérico», «no genérico» y «se desconoce» son tres valores distintos y la API los conserva.

### 3.4 Superficie HTTP

```
POST   /api/whodrug-vaccines                 ESAVI-WHODRUG-001   ADMIN       (nuevo)
GET    /api/whodrug-vaccines                 ESAVI-WHODRUG-002A  USER        (nuevo)
GET    /api/whodrug-vaccines/admin           ESAVI-WHODRUG-002B  ADMIN       (nuevo)
GET    /api/whodrug-vaccines/:id             ESAVI-WHODRUG-003   USER        (nuevo)
PUT    /api/whodrug-vaccines/:id             ESAVI-WHODRUG-004   ADMIN       (nuevo)
DELETE /api/whodrug-vaccines/:id             ESAVI-WHODRUG-005A  ADMIN       (nuevo)
PATCH  /api/whodrug-vaccines/activate/:id    ESAVI-WHODRUG-005B  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/vaccineWhodrug.routes.ts`: las rutas literales `/admin` y `/activate/:id` van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

**La ruta base no coincide con el nombre de la tabla.** La tabla es `vaccineWhodrug` y la ruta es `/api/whodrug-vaccines`; el archivo, el modelo, los tipos y el servicio siguen llamándose por la tabla. Es la única entidad del repositorio con esa divergencia y está decidida a propósito — la razón está en §6.

`ESAVI-WHODRUG-007` es la importación masiva del [SPEC F19](./19-vaccinewhodrug-bulk-import.md) y **no se declara aquí**: su ruta, su rol y su fila en `CONVENTIONS.md` §6 los aporta aquel spec, que es el que la implementa. Este documento solo deja el código apartado. `006` queda libre.

### 3.5 Reglas de negocio por operación

**`ESAVI-WHODRUG-001` — crear.** Normaliza `drugCode` y `drugName` **solo con `.trim()`**. Los 23 campos de texto opcionales también se guardan con `.trim()` cuando vienen. **`drugCode` no se comprueba contra nada**: no tiene unicidad y dos altas con el mismo código son legítimas. Si el body trae `externalId` **no nulo**, comprueba su unicidad global **sin filtrar por `isActive`** → 409 `WHODRUG_001_EXTERNAL_ID_EXISTS`; si no lo trae, no hay consulta previa y la fila entra con `externalId: null`. `isPreferred` toma `false` si no viene; `isGeneric` se queda en `null` si no viene. `metadata` no se escribe y queda en su `DEFAULT '{}'`. Entrada de auditoría en `appDetails` con `method: 'ESAVI-WHODRUG-001'`.

**`ESAVI-WHODRUG-002A` — listar público.** `findAndCountAll` con `isActive: true` fijo. Filtros por query, todos opcionales y combinables con `AND`:

| Filtro | Comparación |
|---|---|
| `search` | `Op.iLike` con `%valor%` sobre `drugName`; **mínimo 2 caracteres** → 400 si es más corto |
| `language` | igualdad exacta sobre el valor `.trim()` |
| `iso3Code` | igualdad exacta sobre el valor `.trim()` |
| `isPreferred` | booleano |
| `isGeneric` | booleano; **no** hay forma de filtrar por `null` — queda fuera de alcance |

Paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET` de `src/constants/pagination.constants.ts`, `limit` entre 1 y 100. Orden `drugName ASC`.

**`ESAVI-WHODRUG-002B` — listar admin.** Gemela, sin `isActive` en el `where`. Mismos cinco filtros, mismo orden y misma paginación. No añade ninguno propio: a diferencia de `diagnosticTerm`, esta entidad no tiene `metadata` ni cola de revisión.

**`ESAVI-WHODRUG-003` — obtener por ID.** Existencia → 404 `WHODRUG_003_NOT_FOUND`. Una entrada inactiva devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — y ese predicado es **solo SUPERADMIN** (`src/helpers/permissions.helper.ts`), así que un ADMIN recibe el mismo 404 que un USER, aunque el `002B` sí le muestre inactivos. Es la misma asimetría deliberada que ya tienen `healthFacility` y `diagnosticTerm`. Sin `include`: la entidad no tiene asociaciones.

**`ESAVI-WHODRUG-005A` / `005B` — desactivar y reactivar.** Sobre `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`), con transacción propia. El `where` filtra **solo por la PK**. Desactivar dos veces → 409 `WHODRUG_005A_ALREADY_INACTIVE`; reactivar lo ya activo → 409 `WHODRUG_005B_ALREADY_ACTIVE`. En `appDetails.method` va **solo** el código calculado (`005A` o `005B`), sin `_ACTIVATION` pegado detrás.

**No se comprueba ninguna FK entrante.** Es borrado lógico: los `ON DELETE RESTRICT` de `notificationVaccine` e `investigationVaccineAdministered` no se disparan, una vacuna inactiva se sigue referenciando por diseño, y ambas tablas ni siquiera existen todavía. Desactivar significa «deja de ofrecerse en el autocomplete», no «deja de existir».

#### Contrato de update diferencial

**`ESAVI-WHODRUG-004` — actualizar.** Existencia → 404 `WHODRUG_004_NOT_FOUND`. Si el body trae `externalId` **no nulo**, unicidad global excluyendo el propio id con `{ [Op.ne]: id }` y sin filtrar por `isActive` → 409 `WHODRUG_004_EXTERNAL_ID_EXISTS`, **antes** del diff e independientemente de él: un `externalId` ocupado es 409 aunque el resto del body no cambie nada. **`drugCode` no se comprueba**: no tiene unicidad. `stored` sale de `drug.get({ plain: true })` — la fila completa, sin `attributes` acotados. Diff con `buildDifferentialUpdate`; si vuelve vacío se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`, y se responde 200.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `drugCode` | `data.drugCode ? data.drugCode.trim() : undefined` | mutable; solo `trim` — ver §6. Sin comprobación de unicidad |
| `drugName` | `data.drugName ? data.drugName.trim() : undefined` | solo `trim`, sin `toTitleCase` — ver §6 |
| `externalId` | `data.externalId !== undefined ? (data.externalId ?? null) : undefined` | anulable numérico; **es la clave única**, comprobada antes del diff cuando llega no nulo |
| `isGeneric` | `data.isGeneric !== undefined ? (data.isGeneric ?? null) : undefined` | anulable booleano: `false` y `null` son valores distintos |
| `isPreferred` | `data.isPreferred !== undefined ? data.isPreferred : undefined` | **no anulable** (`NOT NULL` en el DDL). Nunca `if( data.isPreferred )`: descartaría `false` |
| Los 23 restantes | `data.<campo> !== undefined ? (data.<campo>?.trim() ?? null) : undefined` | anulables de texto |
| `isActive` | **no entra** | lo gobiernan `005A`/`005B` |
| `metadata` | **no entra** | la escribe el `007` del F19 al insertar; el CRUD no la toca |

Los 23 campos de texto anulables, nombrados uno a uno para que no quede ninguno al criterio de quien implemente: `drugRecNo`, `drugRecNoSeq`, `language`, `medicinalProductId`, `atcs`, `icd11`, `icd11Term`, `abbreviation`, `ingredient`, `ingredientTranslation`, `languageCode`, `iso3Code`, `countryMedicinalProductId`, `maHolders`, `maHoldersMedicinalProductId`, `form`, `formTranslations`, `formMedicinalProductId`, `strength`, `strengthMedicinalProductId`, `noDose`, `diluent`, `notes`.

Con `drugCode`, `drugName`, `externalId`, `isGeneric` e `isPreferred`, son **28 filas** en `candidates` — las 28 columnas de datos de §3.1, ninguna omitida.

Los tres puntos que esta tabla resuelve y que son los que se olvidan:

- **`isPreferred` y `isGeneric` no se tratan igual.** `isPreferred` es `NOT NULL DEFAULT false`: `null` no es un valor válido y no se propone nunca. `isGeneric` no tiene `DEFAULT` en el DDL, así que `null` sí es un valor y un `PUT` con `isGeneric: null` debe poder vaciar la columna.
- **Ningún campo booleano entra bajo `if( data.x )`.** Con 26 campos opcionales, ése es el error de copia-pega más probable de todo el spec: descartaría en silencio `false`, `0` y la cadena vacía.
- **La unicidad es de `externalId`, va antes del diff y es independiente de él.** No hay FK saliente que validar, así que la mitad del criterio canónico que habla de FK inactivas no aplica aquí.

**Ninguna operación de este spec propaga nada a otra tabla.** No hay recálculos, ni cascadas, ni escrituras en entidades vecinas.

**No pasan por el helper**, y se declara una por una: el `001` (es un `create`), y el `005A` y el `005B` (escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`, que registran un hecho aunque ningún campo de datos cambie).

### 3.6 Claves i18n nuevas

Bloque `vaccineWhodrug` en `src/data/i18n/es.json`, `en.json` y `nl.json` — dieciséis claves, las mismas que estrenó `diagnosticTerm` salvo que la del 409 nombra `externalId` en vez del código. El F19 añade cinco más y deja el bloque en veintiuna:

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
| `externalIdExists` | 409 por `externalId` duplicado, en `001` y `004` |
| `alreadyActive` | 409 de `setEntityActiveStatusService` |
| `alreadyInactive` | 409 de `setEntityActiveStatusService` |

Los nombres siguen la nomenclatura de `references/CONVENTIONS.md` §13 — `createdSuccess`/`createdFailed` y no `created`, par `Plural` para los listados. La regla de §13 «si el endpoint existe, sus dos claves existen» obliga a `deletedFailed` y `activatedFailed`, que un endpoint sin variante de error no necesitaría.

`tests/i18n/messages.test.ts` exige paridad exacta: o las dieciséis están en los tres archivos, o la suite falla.

**Ninguna clave nueva para los 400 de validación.** Los mensajes de `express-validator` los resuelve `validateFields` con su propio mecanismo, igual que en las diecisiete entidades anteriores.

### 3.7 Forma de la respuesta

`003`, y cada fila de `002A` y `002B`, devuelven la fila **completa**: las 36 columnas menos `sysDetails`, que no se expone nunca. `metadata` **sí** se expone —de solo lectura—, igual que hace `diagnosticTerm`.

```
{ ok, message, data: {
    vaccineWhodrugId, externalId, drugCode, drugRecNo, drugRecNoSeq, drugName,
    language, medicinalProductId, atcs, icd11, icd11Term, abbreviation, ingredient,
    ingredientTranslation, languageCode, iso3Code, countryMedicinalProductId,
    maHolders, maHoldersMedicinalProductId, form, formTranslations,
    formMedicinalProductId, strength, strengthMedicinalProductId, noDose, diluent,
    isGeneric, isPreferred, notes, metadata, isActive, createdAt, updatedAt,
    deletedAt, appDetails
} }
```

Misma forma en las tres operaciones de lectura, sin recortes para el autocomplete: recortarla rompería la simetría con el resto del repositorio a cambio de unos pocos bytes por fila, y el `limit` máximo de 100 acota el coste.

Los listados devuelven `{ count, rows }` de `findAndCountAll` dentro de `data`. `002A` filtra por `isActive: true`; `002B` no filtra.

`001` responde 201 con la fila creada en `data`. `004` responde 200 con la fila resultante —cambiada o no—. `005A` y `005B` responden `{ ok, message }` **sin** `data`.

Sin `include` en ninguna operación: la entidad no tiene asociaciones.

---

## 4. Plan de implementación

**Precondición de orden.** El **paso 1 del [SPEC F19](./19-vaccinewhodrug-bulk-import.md)** —los cuatro cambios de esquema sobre `esaviapp.sql`— se ejecuta **antes** que el paso 2 de este plan. El modelo y los tipos se escriben contra el DDL corregido; hacerlo al revés obliga a rehacer modelo, tipos, validador y servicio. La secuencia de los dos specs juntos es: paso 1 del F19 → este spec entero → pasos 2 a 10 del F19.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registrar la abreviatura.** Añadir la fila `vaccineWhodrug | WHODRUG` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en su posición alfabética. La norma exige registrar **antes** de usar, así que este paso va primero aunque no toque `src/`. **No** se registra `ESAVI-WHODRUG-007`: la importación es del SPEC F19 y se registrará allí.
   *Verificación:* `WHODRUG` aparece una sola vez en la tabla y no colisiona con las 20 existentes.

2. **Modelo, tipos y barrels.** `src/models/vaccineWhodrug.model.ts` con las 36 columnas de §3.1 —incluidas `atcs` y `metadata`—, respetando ancho de `varchar` frente a `text`, `isGeneric` sin `defaultValue` e `isPreferred` con `allowNull: false, defaultValue: false`. Alta en `src/models/index.ts`. `src/types/vaccineWhodrug/vaccineWhodrug.types.ts` con `CreateVaccineWhodrugInput` —28 campos de datos, sin `metadata`—, su `index.ts` de barrel y el alta en `src/types/index.ts`. **Sin archivo de asociaciones.**
   *Verificación:* `npm run build` en 0; un `VaccineWhodrug.findAll()` en un script suelto devuelve filas sin error de columna inexistente, y no aparece `acts` en ningún archivo de `src/`.

3. **Las dieciséis claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

4. **`ESAVI-WHODRUG-001` — crear.** `createVaccineWhodrugService`, controlador y validador: `drugCode` y `drugName` obligatorios, los otros 26 campos opcionales con su tipo y su longitud máxima, `externalId` entero, `isGeneric` e `isPreferred` booleanos. `metadata` **no** está en el validador. Ruta `POST /` con `validateUserRole(ADMIN)`. Alta del validador en `src/validators/index.ts` y de la ruta en `src/routes/index.ts` bajo `/api/whodrug-vaccines`.
   *Verificación:* crear con `drugCode: "  003649 01 001  "` guarda `003649 01 001` **con sus espacios interiores intactos**; repetir el mismo `drugCode` con distinto `externalId` devuelve **201** y deja dos filas; repetir el mismo `externalId` devuelve **409**, no 500; crear sin `drugCode` devuelve **400**; crear sin `externalId` guarda `null` y no consulta unicidad; crear sin `isPreferred` guarda `false` y sin `isGeneric` guarda `null`.

5. **`ESAVI-WHODRUG-002A` — listado público.** `getAllVaccineWhodrugsService` con `isActive: true`, los cinco filtros de §3.5, `findAndCountAll`, orden `drugName ASC`. Validador de query con `search` de mínimo 2 caracteres y `limit` entre 1 y 100. Ruta `GET /` con `validateUserRole(USER)`.
   *Verificación:* `?search=bcg` encuentra las entradas cuyo `drugName` contiene «bcg» en cualquier posición y sin distinguir mayúsculas; `?search=b` devuelve **400**; una entrada inactiva no aparece; `?isPreferred=false` devuelve las no preferidas y no una lista vacía.

6. **`ESAVI-WHODRUG-002B` — listado admin.** Gemela sin `isActive` en el `where`. Ruta `GET /admin` con `validateUserRole(ADMIN)`, declarada **antes** de `/:id`.
   *Verificación:* un ADMIN ve las inactivas; un USER recibe **403**; los cinco filtros se comportan igual que en `002A`.

7. **`ESAVI-WHODRUG-003` — obtener por ID.** `getVaccineWhodrugByIdService(id, lang, includeInactive)`; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales, con su `vaccineWhodrugIdValidator`.
   *Verificación:* un ID inexistente devuelve **404**; `GET /admin` no se interpreta como un `:id`; una entrada inactiva devuelve **404** para USER y para ADMIN, y **200** para SUPERADMIN.

8. **`ESAVI-WHODRUG-004` — actualizar.** `updateVaccineWhodrugService` con la tabla de `candidates` de §3.5 completa —las 28 columnas de datos, ninguna omitida— y `buildDifferentialUpdate`. Unicidad de `externalId` antes del diff, solo cuando llega no nulo. Preserva el historial con `[...currentAppDetails, newEntry]`. Ruta `PUT /:id` con `validateUserRole(ADMIN)` y el validador del `001` en variante opcional.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta del `GET` devuelve **200** sin tocar `appDetails`, `updatedAt` ni `sysDetails.version`; un `PUT` con `isPreferred: false` sobre una fila en `true` **sí** escribe; un `PUT` con `isGeneric: null` vacía la columna.

9. **`ESAVI-WHODRUG-005A` y `005B` — desactivar y reactivar.** `setVaccineWhodrugActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción. Dos controladores y dos rutas — `DELETE /:id` ADMIN, `PATCH /activate/:id` SUPERADMIN —, ambas respondiendo sin `data`.
   *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve **409** `ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe **403** en `PATCH /activate/:id`.

10. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **135 a 142**.
    *Verificación:* `npm test -- roles` pasa con 142.

11. **Suite `tests/contract/vaccineWhodrug.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → listar público → listar admin → actualizar → desactivar → reactivar, verificando estado y envelope en cada paso. Más los caminos de error: 409 de `externalId` duplicado en create y en update, 400 de `search` corto, 400 de `drugCode` ausente, y los cinco casos de update diferencial de §5. Más el caso que justifica el esquema: **dos altas con el mismo `drugCode` y distinto `externalId` conviven**. Bloque específico para los tres booleanos —`isPreferred` a `false`, `isGeneric` a `null`, `isGeneric` a `false`— que son donde el `if( data.x )` se rompe en silencio.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado, bajo `/api/whodrug-vaccines`.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones.
- [ ] `grep -rn "ESAVI-WHODRUG-002[^AB]" src/` no devuelve resultados: todo es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-WHODRUG-00[67]" src/` no devuelve resultados: este spec no tiene operaciones no canónicas.
- [ ] Crear con `drugCode: "  003649 01 001  "` guarda `003649 01 001`: se recortan los extremos y **no** se tocan los espacios interiores ni se aplica `toConstantCase`.
- [ ] Crear con `drugName: "BCG vaccine"` guarda `BCG vaccine` **sin** recapitalizar.
- [ ] Crear sin `drugCode` devuelve 400; crear sin `drugName` devuelve 400.
- [ ] **Dos filas con el mismo `drugCode` y distinto `externalId` conviven**: la segunda alta devuelve 201 y la tabla queda con dos filas. Es el criterio que justifica el cambio de esquema del F19.
- [ ] Crear dos veces el mismo `externalId` devuelve 409, no 500, incluso si el primero está inactivo.
- [ ] Crear sin `externalId` guarda `null` y no dispara ninguna consulta de unicidad; dos altas sin `externalId` conviven.
- [ ] Crear sin `isPreferred` guarda `false`; crear sin `isGeneric` guarda `null`.
- [ ] `grep -rn "acts" src/models/vaccineWhodrug.model.ts src/types/vaccineWhodrug/` no devuelve resultados: la columna es `atcs`.
- [ ] `?search=bcg` encuentra `BCG vaccine` y `Vacuna BCG`; `?search=b` devuelve 400.
- [ ] `?isPreferred=false` devuelve las entradas con el flag en `false`, no una lista vacía.
- [ ] `GET /admin` no se interpreta como un `:id`.
- [ ] `GET /:id` de una entrada inactiva: 404 para USER **y para ADMIN**, 200 para SUPERADMIN. `canViewInactive` es SUPERADMIN-only y el `002B` sigue siendo ADMIN: la asimetría es deliberada y la misma que tienen `healthFacility` y `diagnosticTerm`.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Desactivar una entrada no consulta ninguna tabla hija: `grep -n "notificationVaccine\|investigationVaccineAdministered" src/services/vaccineWhodrug.service.ts` no devuelve resultados.
- [ ] `appDetails.method` guarda `ESAVI-WHODRUG-005A` o `ESAVI-WHODRUG-005B`, sin `_ACTIVATION` pegado detrás.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `sysDetails` no aparece en ninguna respuesta: `grep -n "sysDetails" src/controllers/vaccineWhodrug.controller.ts` no devuelve resultados.
- [ ] `metadata` aparece en las respuestas de lectura y **ninguna operación de este spec la escribe**: `grep -n "metadata" src/services/vaccineWhodrug.service.ts` no devuelve resultados.
- [ ] Las dieciséis claves existen en es, en y nl con los nombres de §3.6; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 142 entradas y `npm test -- roles` pasa.
- [ ] No existe `src/models/associations/vaccineWhodrug.associations.ts`, y `initAssociations()` no lo referencia.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/vaccineWhodrug.service.ts` no devuelve resultados.
- [ ] Un `PUT` con un `externalId` ya ocupado responde **409** aunque el resto del body no cambie nada. La mitad del criterio canónico que habla de FK inactivas no aplica: `vaccineWhodrug` no tiene ninguna FK saliente.
- [ ] Un `PUT` con un `drugCode` que ya usa otra fila responde **200** y escribe: no hay unicidad que comprobar.

**Propios del `004` — los booleanos y los anulables:**

- [ ] Un `PUT` con `isPreferred: false` sobre una fila con `isPreferred: true` **escribe**: el `false` no se descarta por falsedad.
- [ ] Un `PUT` con `isGeneric: false` sobre una fila con `isGeneric: null` **escribe**: `false` y `null` son valores distintos.
- [ ] Un `PUT` con `isGeneric: null` sobre una fila con `isGeneric: true` vacía la columna.
- [ ] Un `PUT` sin la clave `isGeneric` deja la columna como estaba.
- [ ] Un `PUT` con `notes: null` vacía la columna; un `PUT` con `notes: ""` guarda la cadena vacía, que **no** es lo mismo.
- [ ] Las 28 columnas de datos aparecen en `candidates`: `grep -c` sobre el bloque del servicio devuelve 28 entradas, y ni `isActive` ni `metadata` están entre ellas.
- [ ] Un `PUT` con `isActive: false` en el body responde **200** y **no** desactiva la fila: la activación es de `005A`.
- [ ] Un `PUT` con `metadata` en el body responde **200** y **no** la escribe: la columna queda como estaba.
- [ ] Un `PUT` con `drugCode` cambiado a un valor cualquiera responde **200** y actualiza el código: es mutable y sin unicidad.
- [ ] Un `PUT` con `externalId: null` sobre una fila que lo tenía vacía la columna y responde **200**.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `WHODRUG`. Siete letras, dentro del rango de 4 a 8 de §6, no colisiona con las 20 registradas y se lee sin diccionario. **No:** `VACWHO`, que abrevia dos palabras a la mitad y no se reconoce a simple vista.
- **Sí:** ruta base `/api/whodrug-vaccines`, distinta del nombre de la tabla `vaccineWhodrug`. La tabla lee «medicamento WHODrug de vacuna»; lo que el catálogo contiene son **vacunas del diccionario WHODrug**, y ése es el orden en que un consumidor de la API las busca. La API es la superficie pública y puede corregir un nombre desafortunado del esquema; el archivo, el modelo, los tipos y el servicio siguen llamándose por la tabla, porque ahí el nombre tiene que calzar con el DDL.
- **No:** renombrar la tabla en `esaviapp.sql`. El fichero se carga en los tests y ya tiene dos FK entrantes declaradas contra ese nombre. Cambiar el esquema para arreglar una preferencia de lectura no compensa.
- **Sí:** `externalId` como clave única, y `drugCode` sin ninguna unicidad. Es la corrección que trajo el F19 al abrir el fichero real: `drugCode` se repite por diseño —una misma vacuna se alcanza por su presentación en cada país, con su titular de registro y su forma farmacéutica— y la única columna única por fila es `id`, que aquí es `externalId`. **No:** conservar `UQ_vaccineWhodrug_drugCode`, que haría fallar la importación en la tercera línea del fichero. **No:** una unicidad compuesta con `iso3Code`, `maHoldersMedicinalProductId` y compañía: no sabemos cuál es la combinación mínima que WHODrug garantiza única, y bajo `UNIQUE` en Postgres cualquier `NULL` del grupo desactiva la comparación.
- **Sí:** `drugCode` obligatorio **como dato** en la API aunque el DDL lo permita nulo. Una entrada de diccionario sin código no sirve para cruzar nada, que es lo único para lo que existe el catálogo. La API más estricta que el esquema es la dirección segura. Es el mismo movimiento que el F15 hizo con `diagnosticTerm.code`, solo que aquí sin unicidad detrás.
- **Sí:** `externalId` **nullable** bajo el `UNIQUE`, y la comprobación de duplicado **solo cuando el body lo trae no nulo**. Postgres admite N filas con `NULL` bajo un `UNIQUE`, así que un alta manual que no traiga `externalId` nunca colisiona con el espacio de claves del diccionario. El importador del F19 lo exige siempre; el CRUD no.
- **Sí:** las 28 columnas de datos escribibles en `001` y `004`. Es la opción fiel al DDL: cada columna existe porque el volcado de origen la trae. El fichero real del F19 lo confirmó: sus 27 cabeceras caen todas en columnas de esta tabla. El coste es un validador largo y una tabla de `candidates` de 28 filas, pero ambos son mecánicos.
- **Sí:** `metadata` en el modelo y en las respuestas de lectura, pero **fuera** de `CreateVaccineWhodrugInput` y fuera de `candidates`. La procedencia de una fila —de qué versión del diccionario salió y cuándo entró— la escribe el `007` al insertar, y que el `004` pudiera pisarla destruiría justamente el dato con el que se audita.
- **Sí:** `acts` renombrada a `atcs` en el DDL, no tapada con un alias. Los valores son códigos ATC (`J07AN`); un alias dejaría el nombre equivocado en el modelo, en los tipos y en toda respuesta HTTP para siempre.
- **No:** exponer un subconjunto «funcional» y dejar el resto en solo lectura. Obligaría a justificar campo por campo y a revisar la frontera cada vez que el importador toque una columna nueva.
- **No:** dejar la entidad en solo lectura y que toda escritura entre por la importación. Bloquearía la corrección de una fila mal cargada hasta que exista el F19, y dejaría al administrador sin ninguna vía de enmienda.
- **Sí:** la importación masiva `.xlsx` en su propio spec, el **F19**. Exige `multer`, una librería de lectura de Excel nueva, lotes transaccionales, `dryRun` e informe de proceso: es carga de datos, no un CRUD. Es el mismo corte que separó el F15 del F17. **No:** meterla aquí, que duplicaría el tamaño del documento y mezclaría dar de alta la entidad con poblarla.
- **Sí:** apartar `ESAVI-WHODRUG-007` para esa importación sin registrarlo en `CONVENTIONS.md` §6 desde aquí. La norma es registrar antes de **usar**: la fila la añade el F19, que es quien lo implementa.
- **Sí:** aceptar la inversión de orden con el F19 —su paso 1 antes que el paso 2 de este spec— en vez de duplicar el cambio de esquema en los dos documentos. El DDL tiene un solo dueño por cambio, y el que lo descubrió fue el F19.
- **Sí:** sin resolución implícita. `diagnosticTerm` la tiene porque un término clínico local es una descripción que el notificador legítimamente acuña. Una entrada de WHODrug es una fila de un diccionario licenciado, con su `drugRecNo`, su `medicinalProductId` y su titular de registro: nadie la inventa desde un formulario, y permitirlo llenaría el maestro de vacunas apócrifas indistinguibles de las reales.
- **Sí:** cuando la vacuna no está codificada, la FK se queda en nulo. `notificationVaccine` guarda `whoCode`, `vaccineCode` y `vaccineName` como texto crudo (`esaviapp.sql:839-841`); el esquema puso esos tres campos exactamente para este caso, y la notificación no se bloquea por no estar codificada.
- **Sí:** `drugCode` normalizado **solo con `.trim()`**. Un código de diccionario es un dato **citado**: `toConstantCase` convertiría `00002001001` en otra cosa y rompería la correspondencia con el fichero de origen, que es justo lo que hace útil al código. **No:** `toConstantCase`, por eso. **No:** `.trim()` + `.toUpperCase()`: se consideró cuando `drugCode` era único, para cerrar el duplicado por caja; sin unicidad sobre la columna ya no hay colisión que evitar, y alterar un dato citado sigue sin compensar. El contrato de normalización es el mismo que hereda el importador del F19: `.trim()` y nada más.
- **Sí:** `drugName` solo con `.trim()`, sin `toTitleCase`. Es la desviación de §11 que el F15 ya razonó y que aquí es aún más aguda: `toTitleCase` convertiría `BCG vaccine` en `Bcg Vaccine` y destruiría los acrónimos, que en un diccionario de vacunas son la mitad de los nombres.
- **Sí:** `Op.iLike` con `%valor%` sobre `drugName`, acotado a `002A` y `002B`, con el precedente ya abierto por el F15. El caso de uso real es el autocomplete del formulario de notificación, y un autocomplete necesita prefijos y fragmentos.
- **No:** búsqueda full-text con `to_tsvector(...) @@ plainto_tsquery(...)`, pese a que `IX_vaccineWhodrug_name` existe y está puesto ahí a propósito. `plainto_tsquery` casa lexemas completos: `cef` no encontraría `Cefalea` ni `bcg` un `BCG-SSI`. Usar el índice a costa de que el autocomplete no autocomplete es cambiar lo que importa por lo que se mide. **El índice queda declarado y sin consumir**, y aprovecharlo será un spec de rendimiento cuando el catálogo lo pida.
- **No:** ofrecer las dos vías con un `?fullText=true`. Dos semánticas de búsqueda sobre el mismo endpoint obligan a documentar cuál usar y garantizan que alguien use la equivocada.
- **Sí:** `drugCode` mutable en el `004`, y sin nada que comprobar. Un alta manual con un typo en el código tiene que poder corregirse, y la columna ya no restringe nada. **Sí:** `externalId` también mutable, ahí sí con unicidad global excluyendo el propio id: corregir un `id` mal tecleado es el mismo caso, pero sobre la clave.
- **Sí:** no bloquear la desactivación cuando la entrada ya está referenciada. Es borrado lógico: los `ON DELETE RESTRICT` no se disparan, consultar dos tablas de otros dominios acoplaría este catálogo a notificación y a investigación, y esas dos tablas ni siquiera existen. Mismo razonamiento que el SPEC 09 con `healthFacility` y el F15 con `diagnosticTerm`.
- **Sí:** una entrada inactiva se sigue referenciando. Desactivar significa «deja de ofrecerse en el autocomplete». La referencia histórica se conserva, y `notificationVaccine` guarda además la copia de texto, así que la notificación se lee entera sin el maestro.
- **Sí:** no crear archivo de asociaciones. `vaccineWhodrug` no tiene FK saliente y las dos entrantes pertenecen a las tablas hijas, que las declararán en sus propios archivos. Es desviación consciente del artefacto 2 de §1, con el precedente del F15, no olvido.
- **Sí:** `isPreferred` como flag libre, sin regla de unicidad. El DDL no impone ninguna y no hay columna que sirva de ámbito —¿preferida por país, por forma farmacéutica, por principio activo?—. Inventar el ámbito sería inventar semántica que el esquema no tiene.
- **Sí:** `isGeneric` con tres estados. El DDL lo dejó `boolean` **sin `DEFAULT`**, así que `null` significa «se desconoce» y es información distinta de `false`. Colapsarlo a dos estados en la API perdería ese dato en la primera importación.
- **Sí:** `language` y `languageCode` como dos campos independientes. Coexisten en el DDL con anchos distintos y el fichero real del F19 trae las dos cabeceras por separado: no son un duplicado que reconciliar, son dos datos.
- **Sí:** `diluent` tratado como texto libre. La columna es `text` y no hay FK a `diluentCatalog` pese a que la tabla existe (`esaviapp.sql:599`). Convertirla en relación es un cambio de esquema con su propio spec; el spec no inventa relaciones que el DDL no declara.
- **No:** filtrar por `isGeneric IS NULL` en los listados. Exigiría un valor centinela en la query (`?isGeneric=unknown`) y es un caso de uso administrativo que nadie ha pedido.
- **Sí:** las mismas dieciséis claves i18n que `diagnosticTerm`, con la nomenclatura de §13. La paridad de forma entre entidades es lo que permite leer un `getMessage` sin abrir el JSON.
- **Sí:** forma de respuesta completa también en `002A`. Recortarla para el autocomplete rompería la simetría con el resto del repositorio a cambio de unos pocos bytes por fila, y el `limit` máximo de 100 acota el coste.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Se implementa el modelo contra el DDL sin corregir** y hay que rehacer modelo, tipos, validador y servicio por `acts`, `metadata` y el `UNIQUE` | Declarado como precondición de orden al principio de §4 y en la nota de cabecera: el paso 1 del F19 va antes que el paso 2 de este plan |
| Alguien lee la ausencia de unicidad sobre `drugCode` como un descuido y la reintroduce | Está razonada en §6, anotada en la tabla de §3.1 y cubierta por un criterio de aceptación que exige que dos filas con el mismo `drugCode` **convivan**. Reintroducirla rompe la importación del F19 en su tercera línea |
| Una base ya creada conserva `UQ_vaccineWhodrug_drugCode` aunque `esaviapp.sql` cambie, y el `001` empieza a devolver 500 donde el spec promete 201 | El esquema no lo gestiona Sequelize y el repositorio no tiene migraciones: el fichero es la fuente y se recarga en los tests. Quien tenga una base viva necesita el `ALTER TABLE` a mano; queda fuera de alcance, como declara el F19 |
| El importador del F19 normaliza `drugCode` distinto que el `001` y el catálogo queda con dos convenciones de código | El contrato queda fijado **aquí**: `.trim()` y nada más. El F19 hereda la regla explícitamente |
| `Op.iLike` con `%valor%` no usa `IX_vaccineWhodrug_name` y degrada con el catálogo lleno | El mínimo de 2 caracteres y el `limit` máximo de 100 acotan el coste. El diccionario de vacunas es un subconjunto pequeño de WHODrug; si crece, hará falta un índice `gin_trgm_ops` sobre `drugName`, y ése es un spec de rendimiento |
| El índice GIN queda declarado y sin usar, y alguien lo lee como que la búsqueda ya está indexada | Declarado explícitamente en §3.1, en §2 y en §6. Es deuda visible, no invisible |
| Un `if( data.isPreferred )` en el `004` descarta el `false` en silencio y el flag no se puede desmarcar nunca | Es el error más probable de todo el spec: 26 campos copiados en cadena, tres de ellos booleanos. Cubierto por tres criterios de aceptación propios y por un bloque específico de la suite de contrato |
| `isGeneric` se declara con `defaultValue: false` en el modelo por inercia y se pierde el tercer estado | El DDL no le puso `DEFAULT` y §3.2 lo dice expresamente. Cubierto por el criterio de que crear sin `isGeneric` guarda `null` |
| Un validador con 26 campos opcionales omite alguno y ese campo queda inescribible sin error visible | Los 23 campos de texto están nombrados uno a uno en §3.5, y un criterio de aceptación exige 28 entradas en `candidates` |
| `metadata` acaba expuesta como campo escribible por inercia, al copiar el bloque de `candidates` desde otra entidad | §3.2 y §3.5 lo declaran, y un criterio de aceptación exige que `metadata` no aparezca en el servicio |
| `GET /:id` captura `/admin` o `/activate` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato |
| La divergencia entre la tabla `vaccineWhodrug` y la ruta `/api/whodrug-vaccines` confunde a quien busca el archivo por la URL | Es la única entidad del repositorio con esa divergencia y está anotada en §3.4, en §6 y en el comentario de cabecera de `src/routes/vaccineWhodrug.routes.ts` |
| Una vacuna se desactiva y las notificaciones que la referencian apuntan a algo que el autocomplete ya no ofrece | Es el comportamiento buscado: la referencia es histórica. `notificationVaccine` guarda además `whoCode` y `vaccineName` como copia, así que la notificación se lee entera sin el maestro |

---

## 8. Impacto en el contrato HTTP

No aplica. El spec solo añade endpoints nuevos; ningún cliente actual cambia de comportamiento.

Sobre el **esquema** sí hay impacto, y no es de este spec: los cuatro cambios sobre `vaccineWhodrug` —`UQ` de `drugCode` a `externalId`, alta de `metadata`, `acts` a `atcs`, y `abbreviation` e `ingredient` dadas por buenas— los declara y los ejecuta el paso 1 del [SPEC F19](./19-vaccinewhodrug-bulk-import.md). Este documento se escribe sobre el DDL resultante.

---

## Lo que **no** está en este spec

- La importación masiva del diccionario desde `.xlsx` — es el SPEC F19, que ocupa `ESAVI-WHODRUG-007` y aporta los cambios de esquema de los que este spec depende.
- La resolución implícita desde una notificación: no hay equivalente al `ESAVI-DIAGTERM-006` y no lo habrá.
- El versionado del diccionario y el histórico de cargas.
- La jerarquía WHODrug y la codificación ATC.
- La fusión de entradas duplicadas y el repunte de las dos FK entrantes.
- `notificationVaccine` e `investigationVaccineAdministered`.
- La búsqueda full-text sobre `IX_vaccineWhodrug_name`, y el índice `gin_trgm_ops` que la sustituiría.
- Cualquier unicidad sobre `drugCode`, sola o compuesta.
- Cualquier regla de unicidad sobre `isPreferred`.
- Pasar `externalId` de `integer` a `bigint`.
- Convertir `diluent` en una FK a `diluentCatalog`.
- Exponer o editar `sysDetails`, y escribir `metadata` desde el CRUD.

Cada uno de esos, si aterriza, va en su propio spec.
