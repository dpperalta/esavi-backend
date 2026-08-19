# SPEC F26 — CRUD de `systemConfig` con historial de cambios

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F04 (`appUser` — el `007` incluye al autor del cambio y lo descifra con `esaviDecrypt`), SPEC F12 (`buildDifferentialUpdate` — el `004` lo usa), SPEC F23 (precedente directo: el último CRUD plano sin `005C`)
> **Fecha:** 2026-08-19
> **Objetivo:** Dar de alta `systemConfig` como almacén de parámetros de la aplicación, con historial de cambios en `systemConfigHistory`, lectura por clave y siembra idempotente de configuraciones iniciales.

---

## 1. Por qué existe este spec

`systemConfig` es **el almacén de parámetros de comportamiento de la aplicación**: aquello que un administrador tiene que poder cambiar sin tocar el código ni el servidor. Hoy la tabla existe en `esaviapp.sql:358-377`, su hija `systemConfigHistory` en `esaviapp.sql:379-394`, y ninguna de las dos tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

**Lo que se configura hoy y por qué no basta.** Todo parámetro ajustable del repositorio vive en `.env.${NODE_ENV}`: `ESAVI_APP_DEFAULT_LIMIT` y `ESAVI_APP_DEFAULT_OFFSET` (`src/constants/pagination.constants.ts`), `CORS_ORIGINS`, `SUPPORTED_LANGUAGES`, `SEED_ACTION`. Un fichero de entorno tiene tres límites que esta tabla resuelve:

1. **Cambiar un valor exige redeploy.** El fichero se lee en el arranque de `src/app.ts`, así que ajustar un límite implica parar el proceso.
2. **No deja rastro de quién lo cambió.** Un `.env` editado por SSH no tiene autor, ni fecha, ni motivo. `systemConfigHistory` guarda los cuatro datos —`previousValue`, `newValue`, `changedByUserId`, `changeReason`— precisamente para eso.
3. **No distingue ámbitos.** `UQ_systemConfig_code_scope` permite que el mismo `code` tenga valores distintos por `scope`, algo que un fichero plano de pares clave-valor no expresa.

**Es la primera entidad del bloque «Auth y sistema».** De las seis pendientes de ese dominio —`appPermission`, `appRolePermission`, `appSession`, `systemConfig`, `systemConfigHistory` y `appUserGeoLocation`, ésta última ya entregada por el [SPEC F01](./01-appusergeolocation-crud.md)—, `systemConfig` es la única que no depende de ninguna otra: no tiene ninguna FK saliente, y la única entrante es la de su propia hija.

**Es también la primera entidad del repositorio con un valor cifrado en columna `jsonb`.** `isEncrypted` (`esaviapp.sql:366`) declara que el contenido de `value` es un secreto. `appUser` cifra columnas `varchar` con `esaviCrypt`; aquí la columna es `jsonb NOT NULL`, así que el ciphertext tiene que viajar envuelto en un objeto JSON. Eso arrastra dos consecuencias que §3 resuelve: cómo se guarda y cómo se compara en el diff.

**Una divergencia declarada en el propio DDL.** El procedimiento almacenado `upsertSystemConfig` (`esaviapp.sql:1498-1539`) hace `INSERT`-o-`UPDATE` por el par `(code, scope)` y escribe **siempre** una fila en `systemConfigHistory`, incluso cuando el valor no cambió. Es exactamente lo contrario del update diferencial que impone `references/CONVENTIONS.md` §11. Este spec **no lo invoca** y tampoco lo borra; la razón está en §6.

**Sin `005C`.** `systemConfig` y `systemConfigHistory` figuran las dos en el bucle `preventPhysicalDelete` (`esaviapp.sql:1371`), así que por la regla de disponibilidad de `references/CONVENTIONS.md` §6 el borrado físico **no se declara**.

**Tres operaciones no canónicas**, razonadas en §6: `006` leer por `(code, scope)` —porque la aplicación no conoce el UUID de su propia configuración—, `007` leer el historial y `008` sembrar las configuraciones iniciales de forma idempotente.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos de `systemConfig`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta. **Con archivo de asociaciones**, a diferencia del [SPEC F23](./23-diluentcatalog-crud.md): la entidad tiene una FK entrante desde su hija.
- El **modelo de `systemConfigHistory`** y su archivo de tipos, **sin CRUD propio**. Se escribe desde el `001`, el `004` y el `008`, y se lee desde el `007`. No recibe abreviatura `ESAVI-*` propia: se entra siempre por el `systemConfigId` padre.
- **Siete operaciones canónicas** — `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- **Tres operaciones no canónicas**, razonadas en §6:
  - `006` — leer por el par `(code, scope)`, `GET /code/:code`, rol USER.
  - `007` — listar el historial de una configuración, `GET /:id/history`, rol SUPERADMIN.
  - `008` — sembrar las configuraciones iniciales de forma idempotente, `POST /sync`, rol SUPERADMIN.
- Ruta base **`/api/system-configs`**.
- Alta de la abreviatura `SYSCONF` en la tabla de `references/CONVENTIONS.md` §6, y de las tres operaciones no canónicas en su tabla de códigos desde `006`.
- **Desviación declarada de la matriz de roles de §9:** `001`, `004`, `005A` y `005B` exigen **SUPERADMIN**, no ADMIN. La razón está en §6.
- Las **ocho columnas de datos** de §3.1 escribibles en el `001`: `code`, `name`, `description`, `value`, `valueType`, `scope`, `isEncrypted`, `isEditable`. En el `004` solo cuatro son mutables — `name`, `description`, `value`, `valueType`— más `isEditable`; `code`, `scope` e `isEncrypted` son **inmutables**.
- Unicidad **compuesta de `(code, scope)`**, comparada contra los dos valores ya normalizados, **sin filtrar por `isActive`**, excluyendo el propio id en el `004` con `{ [Op.ne]: id }` y resuelta **antes** del diff.
- `code` y `scope` normalizados con **`toConstantCase`**; `name` **solo con `.trim()`**.
- **Validación cruzada de `value` contra `valueType`** en el servicio, contra el `valueType` **resultante** — el nuevo si viaja en el body, el guardado si no. Un desajuste es **400**.
- **Cifrado real del `value` cuando `isEncrypted: true`**: se guarda envuelto como `{ "enc": "<ciphertext>" }` con `esaviCrypt`, el diff se hace **sobre texto plano**, y el descifrado en respuesta queda restringido a SUPERADMIN y solo en `003`, `006` y `007`. En los listados va siempre enmascarado.
- **`isEditable: false` bloquea el `004`** con 409, antes del diff. El propio `isEditable` sí es mutable, y solo por SUPERADMIN.
- Escritura de `systemConfigHistory` en el `001` y el `008` siempre, y en el `004` **solo cuando `value` figura entre las claves que devolvió `buildDifferentialUpdate`**. Nunca en `005A` ni en `005B`.
- `changeReason` como campo del body que **no es columna de `systemConfig`**: no entra en `candidates` y solo viaja a la fila de historial. Opcional en el `001`, **obligatorio en el `004` cuando el body trae `value`**.
- Tres filtros de listado en `002A` y `002B`: `scope`, `valueType` y `search` (`Op.iLike` sobre `name` y `code`, mínimo 2 caracteres). Orden por defecto `scope ASC, code ASC`.
- El catálogo declarativo `src/data/systemConfig.defaults.ts`, que alimenta el `008` y **tiende a crecer**: añadir un parámetro es añadir una entrada y volver a llamar al endpoint tras desplegar.
- Un bloque `systemConfig` con **veinticuatro claves i18n** en `es`, `en` y `nl`.
- Diez filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, subiendo el total esperado de **177 a 187**.
- Suite `tests/contract/systemConfig.test.ts`.

**Fuera de alcance (otros specs):**

- **Migrar a esta tabla los parámetros que hoy viven en `.env`.** `ESAVI_APP_DEFAULT_LIMIT`, `CORS_ORIGINS` y compañía siguen leyéndose del entorno exactamente como hoy. Decidir cuáles bajan a base de datos, en qué orden y qué pasa mientras conviven las dos fuentes es un spec de configuración en sí mismo. El `008` siembra filas; **nadie las consume todavía desde el código de arranque**.
- **Cachear la lectura de configuración en memoria.** Un parámetro leído en cada petición merece caché con invalidación al escribir. Hoy no hay ninguna capa de caché en el repositorio, y añadirla es un cambio transversal.
- **CRUD propio de `systemConfigHistory`.** La tabla es append-only por diseño: no se crea, ni se actualiza, ni se desactiva desde la API. Solo se lee por el `007`.
- **Cambiar el régimen de cifrado de una fila existente.** `isEncrypted` es inmutable en el `004`. Pasar de `false` a `true` obliga a cifrar el valor guardado, y al revés a descifrarlo: es una escritura con intención propia, con su transacción y su entrada de historial, y va en su propio spec.
- **Rotación de la clave de cifrado.** Recifrar todo lo guardado con una clave nueva alcanza también a `appUser`, así que es un spec transversal, no de esta entidad.
- **Borrar el procedimiento `upsertSystemConfig` del DDL.** El fichero se carga en los tests y tocarlo es un cambio de esquema. Se declara la divergencia y no se invoca.
- **Que el `008` actualice filas existentes.** Es deliberadamente solo-alta: lo que hay en producción manda sobre el default. Un endpoint que reponga valores por defecto sobre configuración ajustada a mano es otro spec, con otro rol y otra confirmación.
- **El borrado físico `005C`.** Las dos tablas están protegidas por `preventPhysicalDelete`; el endpoint no se declara.
- **Versionado o *rollback* desde el historial.** El `007` lee; restaurar un `previousValue` es una escritura con su propia semántica.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tablas origen

**`systemConfig`** — `esaviapp.sql:358-377`. Quince columnas: la PK, **8 de datos** y 6 transversales. **Ninguna clave foránea saliente.**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `systemConfigId` | `uuid` | no | PK, `gen_random_uuid()` |
| `code` | `varchar(150)` | no | mitad de `UQ_systemConfig_code_scope` |
| `name` | `varchar(200)` | no | |
| `description` | `text` | sí | |
| `value` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `valueType` | `varchar(50)` | no | `DEFAULT 'json'`, acotado por `CK_systemConfig_valueType` |
| `scope` | `varchar(100)` | no | `DEFAULT 'GLOBAL'`, la otra mitad del `UNIQUE` |
| `isEncrypted` | `boolean` | no | `DEFAULT false` |
| `isEditable` | `boolean` | no | `DEFAULT true` |
| `isActive` | `boolean` | no | `DEFAULT true` |
| `createdAt` | `timestamptz` | no | `DEFAULT current_timestamp` |
| `updatedAt` | `timestamptz` | sí | lo escribe la aplicación |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `appDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |

Dos restricciones, las dos con nombre:

- `UQ_systemConfig_code_scope UNIQUE ("code", "scope")` — `esaviapp.sql:374`. Unicidad **compuesta**, no global: el mismo `code` puede repetirse en `scope` distintos.
- `CK_systemConfig_valueType CHECK ("valueType" IN ('string', 'number', 'boolean', 'json', 'array'))` — `esaviapp.sql:375`. **Cinco valores, en minúscula.**

Un índice propio: `IX_systemConfig_active ON ("isActive") WHERE "deletedAt" IS NULL` — `esaviapp.sql:377`. Es un índice **parcial**, y no cambia nada del servicio: filtrar por `isActive` en el `002A` lo aprovecha sin pedirlo.

**`systemConfigHistory`** — `esaviapp.sql:379-394`. Once columnas: la PK, **4 de datos** y 6 transversales.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `systemConfigHistoryId` | `uuid` | no | PK, `gen_random_uuid()` |
| `systemConfigId` | `uuid` | no | FK → `systemConfig`, `ON UPDATE CASCADE ON DELETE RESTRICT` |
| `previousValue` | `jsonb` | sí | `null` en la primera fila de una configuración |
| `newValue` | `jsonb` | no | |
| `changedByUserId` | `uuid` | sí | FK → `appUser."userId"`, `ON UPDATE CASCADE ON DELETE SET NULL` |
| `changeReason` | `text` | sí | |
| `createdAt` | `timestamptz` | no | `DEFAULT current_timestamp` |
| `updatedAt` | `timestamptz` | sí | |
| `deletedAt` | `timestamptz` | sí | |
| `sysDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |
| `appDetails` | `jsonb` | no | `DEFAULT '{}'::jsonb` |

Un índice propio, `IX_systemConfigHistory_config ON ("systemConfigId", "createdAt" DESC)` — `esaviapp.sql:394`. El orden del `007` es exactamente ése, y no por casualidad.

**Anomalía: `systemConfigHistory` no tiene columna `isActive`.** Es la excepción a la regla de que toda tabla del esquema lleva las cuatro transversales. No es un problema a resolver antes de implementar: la tabla es **append-only** y no expone `005A` ni `005B`, así que no hay estado que activar ni desactivar. El modelo Sequelize **no declara `isActive`**, y ése es justamente el motivo por el que la tabla no puede pasar por `setEntityActiveStatusService`. `systemConfig` sí tiene las cuatro completas.

**Los dos triggers que alcanzan a las dos tablas los montan bucles genéricos**, no declaraciones específicas:

- `TRG_<tabla>_setSysDetails`, del bucle sobre toda tabla con columna `sysDetails` (`esaviapp.sql:1280-1295`). Incrementa `sysDetails.version` y añade un evento a `sysDetails.auditTrail` en cada `UPDATE` — la razón de fondo por la que el `004` no debe escribir cuando nada cambió.
- `TRG_<tabla>_preventPhysicalDelete`, del bucle sobre las 18 tablas protegidas (`esaviapp.sql:1361-1375`); las dos aparecen en `esaviapp.sql:1371`.

**No existe `TRG_systemConfig_setUpdatedAt`**: el bucle de `sysDetails` lo borra si lo encuentra y no lo vuelve a crear, así que `updatedAt` lo escribe siempre la aplicación.

Sobre `appDetails`, el mismo comportamiento que dejaron escrito los specs anteriores: su `DEFAULT` en el DDL es `'{}'` —un objeto—, no `'[]'`; el servicio escribe siempre un array y lo lee con `Array.isArray(config.appDetails) ? config.appDetails : []`.

**El procedimiento `upsertSystemConfig`** — `esaviapp.sql:1498-1539`. Existe, funciona y **este spec no lo invoca**. Hace tres cosas incompatibles con la norma: resuelve por `(code, scope)` con `INSERT`-o-`UPDATE` sin distinguir alta de modificación, sobrescribe `value` con `COALESCE("pValue", '{}')` —lo que convierte un parámetro ausente en un objeto vacío en vez de dejarlo como estaba—, y escribe una fila de historial **siempre**, incluso cuando el valor no cambió. Queda documentado aquí para que nadie lo descubra dentro de seis meses y lo tome por la vía oficial.

### 3.2 Modelos Sequelize

**`src/models/systemConfig.model.ts`**, clase `SystemConfig`, con las **quince columnas** de §3.1. `timestamps: false`, `freezeTableName: true`, `tableName: 'systemConfig'`, PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `value`, `sysDetails` y `appDetails` como `DataTypes.JSONB`. Anchos respetados: `code` `STRING(150)`, `name` `STRING(200)`, `valueType` `STRING(50)`, `scope` `STRING(100)`; `description` como `TEXT`. `valueType` con `defaultValue: 'json'`, `scope` con `defaultValue: 'GLOBAL'`, `isEncrypted` con `defaultValue: false`, `isEditable` e `isActive` con `defaultValue: true`, los cuatro `allowNull: false`.

**`src/models/systemConfigHistory.model.ts`**, clase `SystemConfigHistory`, con las **once columnas** de §3.1 y **sin `isActive`**. `previousValue` como `JSONB` nullable, `newValue` como `JSONB` no nulo, `changeReason` como `TEXT` nullable, `changedByUserId` como `UUID` nullable.

Los dos con alta en `src/models/index.ts`.

**`src/models/associations/systemConfig.associations.ts`** — un solo archivo para las tres asociaciones, registrado en `initModels()`:

```ts
SystemConfig.hasMany(SystemConfigHistory, { foreignKey: 'systemConfigId', as: 'history' });
SystemConfigHistory.belongsTo(SystemConfig, { foreignKey: 'systemConfigId', as: 'config' });
SystemConfigHistory.belongsTo(AppUser, { foreignKey: 'changedByUserId', as: 'changedByUser' });
```

El alias `changedByUser` es el que usa el `include` del `007`. La tercera asociación se declara aquí y no en `appUser.associations.ts` porque la clave la posee `systemConfigHistory`.

### 3.3 Tipos

`src/types/systemConfig/systemConfig.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.

```ts
export type SystemConfigValueType = 'string' | 'number' | 'boolean' | 'json' | 'array';

export interface CreateSystemConfigInput {
    code: string;                        // inmutable tras el alta; mitad de la clave única
    name: string;
    description?: string | null;
    value: unknown;                      // jsonb; su forma la gobierna valueType
    valueType?: SystemConfigValueType;   // por defecto 'json'
    scope?: string;                      // por defecto 'GLOBAL'; inmutable tras el alta
    isEncrypted?: boolean;               // inmutable tras el alta
    isEditable?: boolean;
    isActive?: boolean;
    changeReason?: string | null;        // NO es columna de systemConfig: viaja a systemConfigHistory
}
```

`SystemConfigValueType` refleja el `CK_systemConfig_valueType` en TypeScript. Que los cinco literales estén en dos sitios —el `CHECK` del DDL y este tipo— es deliberado: el servidor no lee restricciones de Postgres para validar entrada, y un desajuste con el DDL sería un 500.

`value` se tipa `unknown` y no `Record<string, unknown>`: un `valueType: 'number'` guarda `42`, que es JSON válido y no es un objeto.

**`changeReason` es el campo que rompe la simetría del `Partial`**, y merece leerse dos veces: viaja en el body del `001` y del `004`, pero **no es columna de `systemConfig`**. No entra en `candidates`, no se compara con nada, y su único destino es la fila de `systemConfigHistory`.

El update usa `Partial<CreateSystemConfigInput>`. **No se declara `UpdateSystemConfigInput`** — está prohibido por §4 de las convenciones.

`src/types/systemConfig/systemConfigHistory.types.ts`, en el mismo dominio y bajo el mismo barrel:

```ts
export interface CreateSystemConfigHistoryInput {
    systemConfigId: string;
    previousValue?: unknown;             // null en la primera fila de una configuración
    newValue: unknown;
    changedByUserId?: string | null;
    changeReason?: string | null;
}
```

No hay input de update: la tabla es append-only.

El catálogo del `008` se tipa en el mismo archivo y vive en `src/data/systemConfig.defaults.ts`:

```ts
export interface SystemConfigDefault {
    code: string;
    name: string;
    description?: string | null;
    value: unknown;
    valueType: SystemConfigValueType;
    scope: string;
    isEncrypted?: boolean;
    isEditable?: boolean;
}
```

Cada campo se declara explícito, sin apoyarse en los `DEFAULT` del DDL: un catálogo que se lee para saber qué debería existir no puede tener huecos que solo resuelve la base.

### 3.4 Superficie HTTP

```
POST   /api/system-configs                 ESAVI-SYSCONF-001   SUPERADMIN  (nuevo)
GET    /api/system-configs                 ESAVI-SYSCONF-002A  USER        (nuevo)
GET    /api/system-configs/admin           ESAVI-SYSCONF-002B  ADMIN       (nuevo)
GET    /api/system-configs/code/:code      ESAVI-SYSCONF-006   USER        (nuevo)
POST   /api/system-configs/sync            ESAVI-SYSCONF-008   SUPERADMIN  (nuevo)
GET    /api/system-configs/:id/history     ESAVI-SYSCONF-007   SUPERADMIN  (nuevo)
GET    /api/system-configs/:id             ESAVI-SYSCONF-003   USER        (nuevo)
PUT    /api/system-configs/:id             ESAVI-SYSCONF-004   SUPERADMIN  (nuevo)
DELETE /api/system-configs/:id             ESAVI-SYSCONF-005A  SUPERADMIN  (nuevo)
PATCH  /api/system-configs/activate/:id    ESAVI-SYSCONF-005B  SUPERADMIN  (nuevo)
```

**El orden de declaración de `src/routes/systemConfig.routes.ts` es el del bloque anterior, y no es cosmético.** Las cuatro rutas literales —`/admin`, `/code/:code`, `/sync` y `/activate/:id`— van **antes** de `/:id`, o Express capturará `admin` y `sync` como un `:id` y el validador de UUID responderá 400. `/:id/history` también va antes de `/:id` por legibilidad, aunque ahí Express distingue por número de segmentos y no habría colisión.

**Cuatro de las diez rutas se desvían de la matriz canónica de §9**, exigiendo SUPERADMIN donde la norma pone ADMIN: `001`, `004`, `005A` y `005B`. La razón está en §6. `002B` se queda en ADMIN y las tres lecturas ordinarias en USER.

**No hay `005C`**: las dos tablas están protegidas por `preventPhysicalDelete`. Los códigos `009` en adelante quedan libres.

`systemConfigHistory` **no tiene ninguna ruta propia**. Su única superficie es el `007`, que cuelga del padre.

### 3.5 Reglas de negocio por operación

**`ESAVI-SYSCONF-001` — crear.** En este orden:

1. Normaliza `code` y `scope` con `toConstantCase`, `name` **solo con `.trim()`**, `description` con `.trim()` cuando viene. `scope` ausente se resuelve a `GLOBAL` **antes** de normalizar y de comprobar unicidad; `valueType` ausente, a `'json'`.
2. Valida `value` contra `valueType` según la tabla de más abajo → 400 `SYSCONF_001_VALUE_TYPE_MISMATCH`.
3. Comprueba unicidad del par `(code, scope)` **contra los dos valores ya normalizados** y **sin filtrar por `isActive`** → 409 `SYSCONF_001_CODE_EXISTS`.
4. Si `isEncrypted` es `true`, cifra: `value` se serializa a texto, pasa por `esaviCrypt` y se guarda envuelto como `{ "enc": "<ciphertext>" }`.
5. Escribe la fila de `systemConfig` y **una fila de `systemConfigHistory`** con `previousValue: null`, `newValue` igual al `value` que se guardó —cifrado si lo está—, `changedByUserId: authUser?.userId ?? null` y `changeReason` del body si vino.
6. Las dos escrituras van en **una transacción**, por §11: son dependientes y el historial no puede quedar huérfano de su configuración.

Entrada de auditoría en `appDetails` de las dos filas con `method: 'ESAVI-SYSCONF-001'`.

**Validación cruzada de `value` contra `valueType`** — la misma tabla rige el `001`, el `004` y el `008`:

| `valueType` | `value` aceptado |
|---|---|
| `string` | `typeof value === 'string'` |
| `number` | `typeof value === 'number' && Number.isFinite(value)` |
| `boolean` | `typeof value === 'boolean'` |
| `array` | `Array.isArray(value)` |
| `json` | cualquier valor JSON serializable **que no sea `undefined`** |

`null` es un valor JSON legítimo y **solo** se acepta bajo `valueType: 'json'`: un `valueType: 'number'` con `value: null` es 400, porque la columna existe para que el consumidor pueda confiar en el tipo sin comprobarlo.

**`ESAVI-SYSCONF-002A` — listar público.** `findAndCountAll` con `isActive: true` fijo. Tres filtros opcionales por query:

| Filtro | Comparación |
|---|---|
| `scope` | igualdad exacta contra el valor normalizado con `toConstantCase` |
| `valueType` | igualdad exacta, restringido a los cinco del `CHECK` → 400 si es otro |
| `search` | `Op.iLike` con `%valor%` sobre `name` **y** `code`, unidos por `Op.or`; **mínimo 2 caracteres** → 400 si es más corto |

Paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET` de `src/constants/pagination.constants.ts`, `limit` entre 1 y 100. Orden **`scope ASC, code ASC`**.

**Toda fila con `isEncrypted: true` sale con `value: null`, sea cual sea el rol de quien pide** — también para SUPERADMIN. Un listado es una lectura de conjunto; quien necesite el secreto lo pide por su `003` o por su `006`, uno a uno y dejando el rastro en el log de esa operación.

**`ESAVI-SYSCONF-002B` — listar admin.** Gemela, sin `isActive` en el `where`. Mismos filtros, mismo orden, misma paginación y **el mismo enmascarado**.

**`ESAVI-SYSCONF-003` — obtener por ID.** Existencia → 404 `SYSCONF_003_NOT_FOUND`. Una configuración inactiva devuelve 404 salvo que `canViewInactive(req.user)` sea verdadero — y ese predicado es **solo SUPERADMIN** (`src/helpers/permissions.helper.ts`), así que un ADMIN recibe el mismo 404 que un USER aunque el `002B` sí le muestre inactivas. Es la misma asimetría deliberada que ya tienen `healthFacility`, `diagnosticTerm`, `vaccineWhodrug` y `diluentCatalog`.

**El descifrado del `value` es SUPERADMIN-only y aquí sí ocurre:** si `isEncrypted` es `true`, el servicio devuelve el valor descifrado con `esaviDecrypt` **solo** cuando quien pide es SUPERADMIN; para USER y ADMIN sale `value: null`. Sin `include` de historial: el historial tiene su propia operación.

**`ESAVI-SYSCONF-006` — obtener por `(code, scope)`.** Rol USER. `code` llega por la ruta y `scope` por query, opcional con defecto `GLOBAL`; **los dos se normalizan con `toConstantCase` antes de buscar**, de forma que `GET /code/esavi_max_upload_size` y `GET /code/ESAVI_MAX_UPLOAD_SIZE` resuelven a la misma fila. Par inexistente → 404 `SYSCONF_006_NOT_FOUND`. Las reglas de inactivos y de descifrado son **exactamente** las del `003`: misma respuesta, otra puerta de entrada.

**`ESAVI-SYSCONF-007` — listar el historial.** Rol SUPERADMIN. Existencia del padre → 404 `SYSCONF_007_NOT_FOUND`, **antes** de consultar la hija: un id inexistente no devuelve una lista vacía, que se leería como «esta configuración nunca cambió». `findAndCountAll` sobre `SystemConfigHistory` con `where: { systemConfigId: id }`, orden **`createdAt DESC`** —el índice `IX_systemConfigHistory_config` es exactamente ése— y paginación estándar. `include` de `AppUser` con alias `changedByUser`, atributos `userId` y `displayName`, **descifrado con `esaviDecrypt`** antes de responder; `null` cuando la FK quedó en `null` por el `ON DELETE SET NULL`. `previousValue` y `newValue` de una configuración cifrada se **descifran** aquí, y solo aquí, porque el endpoint ya es SUPERADMIN-only.

**`ESAVI-SYSCONF-008` — sembrar configuraciones iniciales.** Rol SUPERADMIN, `POST /sync`, **sin body**. Recorre `src/data/systemConfig.defaults.ts` y, por cada entrada, resuelve el par `(code, scope)` ya normalizado:

- **No existe** → la crea con las mismas reglas del `001`, incluida la validación cruzada, el cifrado y su fila de historial.
- **Existe, activa o inactiva** → **no la toca**. Ni el valor, ni el nombre, ni el estado. Una fila inactiva cuenta como existente y el sync no la reactiva.

Todo en **una sola transacción, todo o nada**: una entrada del catálogo con un `valueType` mal declarado aborta la siembra completa con 400 `SYSCONF_008_VALUE_TYPE_MISMATCH`, en vez de dejar media configuración creada. La respuesta lleva `{ created: [...], skipped: [...] }` con el par `(code, scope)` de cada una. Es **idempotente**: llamarlo dos veces seguidas deja `created` vacío la segunda vez.

**`ESAVI-SYSCONF-005A` / `005B` — desactivar y reactivar.** Sobre `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`), con transacción propia. El `where` filtra **solo por la PK**. Desactivar dos veces → 409 `SYSCONF_005A_ALREADY_INACTIVE`; reactivar lo ya activo → 409 `SYSCONF_005B_ALREADY_ACTIVE`. En `appDetails.method` va **solo** el código calculado, sin `_ACTIVATION` pegado detrás.

**Ninguna de las dos escribe historial** y **ninguna consulta `isEditable`**: desactivar no cambia el valor de nada, y `isEditable` protege el contenido, no la existencia. Tampoco se comprueba la FK entrante desde `systemConfigHistory`: es borrado lógico, el `ON DELETE RESTRICT` no se dispara, y el historial de una configuración retirada sigue siendo legible.

#### Contrato de update diferencial

**`ESAVI-SYSCONF-004` — actualizar.** El orden importa y es éste:

1. Existencia → 404 `SYSCONF_004_NOT_FOUND`.
2. **`isEditable === false` → 409 `SYSCONF_004_NOT_EDITABLE`**, antes del diff y con independencia de lo que traiga el body. Una fila protegida rechaza el `PUT` aunque el body no cambie nada: el 409 informa del régimen de la fila, no del contenido de la petición.
3. Validación cruzada de `value` contra el **`valueType` resultante** —el del body si viaja, el guardado si no— → 400 `SYSCONF_004_VALUE_TYPE_MISMATCH`. También antes del diff.
4. Si `isEncrypted` es `true`, `stored.value` se **descifra** con `esaviDecrypt` antes de construir `stored`.
5. `stored` sale de `config.get({ plain: true })` — la fila completa, sin `attributes` acotados —, con el `value` ya en texto plano.
6. Diff con `buildDifferentialUpdate`. Si vuelve vacío se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`, ni fila de historial, y se responde 200.
7. Si `value` figura entre las claves devueltas y la fila es cifrada, **`esaviCrypt` se aplica ahora**, después del diff, y el valor se guarda envuelto en `{ "enc": "..." }`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `name` | `data.name ? data.name.trim() : undefined` | solo `trim`, sin `toTitleCase` |
| `description` | `data.description !== undefined ? (data.description?.trim() ?? null) : undefined` | anulable: `null` vacía, `undefined` es «no vino» |
| `value` | `data.value !== undefined ? data.value : undefined` | **texto plano** si la fila es cifrada; el helper lo compara con `JSON.stringify` |
| `valueType` | `data.valueType ?? undefined` | mutable; ya validado contra `value` en el paso 3 |
| `isEditable` | `data.isEditable !== undefined ? data.isEditable : undefined` | booleano: **nunca** bajo `if( data.isEditable )`, que descartaría el `false` |
| `code` | **no entra** | inmutable; se ignora sin 400 |
| `scope` | **no entra** | inmutable; se ignora sin 400 |
| `isEncrypted` | **no entra** | inmutable; cambiar el régimen de cifrado va en otro spec |
| `isActive` | **no entra** | lo gobiernan `005A`/`005B` |
| `changeReason` | **no entra** | no es columna de `systemConfig`; viaja solo a la fila de historial |

Son **cinco filas** en `candidates` sobre las ocho columnas de datos: tres son inmutables, y `isActive` y `changeReason` quedan fuera por motivos distintos.

**La escritura de historial es condicional y ésa es la regla central del `004`:** se inserta una fila en `systemConfigHistory` **si y solo si `'value'` está entre las claves que devolvió `buildDifferentialUpdate`**. Un `PUT` que solo corrige el `name` actualiza `systemConfig` y **no** escribe historial — la tabla se llama `previousValue`/`newValue` y registra cambios de valor, no de metadatos. `previousValue` guarda lo que había **tal como estaba almacenado**, cifrado si lo estaba; `newValue`, lo que queda, en el mismo régimen. `changeReason` es **obligatorio cuando el body trae `value`** → 400 desde el validador si falta.

Cuando hay historial, las dos escrituras van en **una transacción**. Cuando no lo hay, el `UPDATE` es una sola escritura y va sin ella, como el resto del repositorio.

Los cinco puntos que este `004` resuelve y que son los que se olvidan:

- **`isEditable` es booleano y entra comparándose contra `undefined`.** Un `if( data.isEditable )` haría imposible volver a proteger una fila, porque `false` se descartaría en silencio.
- **El `value` se compara descifrado.** Comparar ciphertext funciona solo mientras el IV de `esaviCrypt` sea fijo, y atarse a eso rompe la comparación en silencio el día que se pase a un IV aleatorio. Además, el mismo texto plano cifrado dos veces con IV aleatorio daría dos ciphertexts distintos y todo `PUT` parecería un cambio.
- **`value` es `jsonb` y el helper ya lo compara con `JSON.stringify` en los dos lados.** El servicio no compara objetos a mano.
- **`isEditable` y `valueType` se validan antes del diff y son independientes de él.** Una fila protegida es 409 aunque el body no cambie nada; un `valueType` incompatible con el `value` resultante es 400 aunque ese `value` sea el que ya estaba guardado.
- **Ninguna unicidad se comprueba en el `004`, y no es un olvido:** las dos mitades de `UQ_systemConfig_code_scope` son inmutables, así que el par no puede colisionar. Es el motivo por el que el quinto criterio canónico de §5 se adapta en vez de copiarse.

**El único efecto lateral sobre otra tabla es la fila de historial**, y su disparador es **la comparación del valor resultante contra el guardado** —la presencia de `'value'` en la salida del helper—, nunca la presencia de la clave `value` en el body. No hay recálculos ni cascadas.

**No pasan por el helper**, y se declara una por una: el `001` y el `008` (son `create`), y el `005A` y el `005B` (escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`, que registran un hecho aunque ningún campo de datos cambie).

### 3.6 Claves i18n nuevas

Bloque `systemConfig` en `src/data/i18n/es.json`, `en.json` y `nl.json` — **veinticuatro claves**: las dieciséis estándar más ocho propias de las tres operaciones no canónicas y de las dos reglas nuevas.

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | 201 y 500 del `001` |
| `getSuccess` / `getFailed` | 200 y 500 del `003` |
| `getSuccessPlural` / `getFailedPlural` | 200 y 500 de `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | 200 y 500 del `004` |
| `deletedSuccess` / `deletedFailed` | 200 y 500 del `005A` |
| `activatedSuccess` / `activatedFailed` | 200 y 500 del `005B` |
| `notFound` | 404 en `003`, `004`, `005A`, `005B` y `007` |
| `codeExists` | 409 por par `(code, scope)` duplicado en `001`; interpola `{{code}}` y `{{scope}}` |
| `alreadyActive` / `alreadyInactive` | 409 de `setEntityActiveStatusService` |
| `getByCodeSuccess` / `getByCodeFailed` | 200 y 500 del `006` |
| `codeNotFound` | 404 del `006`; interpola `{{code}}` y `{{scope}}` |
| `historySuccessPlural` / `historyFailedPlural` | 200 y 500 del `007` |
| `syncSuccess` / `syncFailed` | 200 y 500 del `008` |
| `notEditable` | 409 del `004` sobre una fila con `isEditable: false` |
| `valueTypeMismatch` | 400 de la validación cruzada en `001`, `004` y `008`; interpola `{{valueType}}` |

`codeExists` conserva el nombre canónico de §13 aunque la unicidad sea compuesta; lo que cambia es el mensaje, que nombra el par. La razón está en §6.

`tests/i18n/messages.test.ts` exige paridad exacta: o las veinticuatro están en los tres archivos, o la suite falla.

**Ninguna clave nueva para los 400 de validación de entrada.** Los mensajes de `express-validator` los resuelve `validateFields` con su propio mecanismo. `valueTypeMismatch` es la excepción y por eso figura: esa validación la hace el **servicio**, no el validador, porque en el `004` necesita el `valueType` guardado.

### 3.7 Forma de la respuesta

`003` y `006` devuelven la fila **completa**: las quince columnas menos `sysDetails`, que no se expone nunca.

```
{ ok, message, data: {
    systemConfigId, code, name, description, value, valueType, scope,
    isEncrypted, isEditable, isActive, createdAt, updatedAt, deletedAt, appDetails
} }
```

Cada fila de `002A` y `002B` tiene esa misma forma. **La única diferencia entre las cuatro lecturas está en el `value` de una fila cifrada:**

| Operación | Rol | `value` con `isEncrypted: true` |
|---|---|---|
| `002A` / `002B` | cualquiera | `null` |
| `003` / `006` | USER, ADMIN | `null` |
| `003` / `006` | SUPERADMIN | descifrado con `esaviDecrypt` |

El enmascarado es **`value: null`**, no `"***"`. La fila lleva `isEncrypted: true`, así que el cliente sabe distinguir «cifrado y no visible para ti» de «vacío»; y un `"***"` reenviado en un `PUT` se guardaría como valor literal.

Los listados devuelven `{ count, rows }` de `findAndCountAll` dentro de `data`. `002A` filtra por `isActive: true`; `002B` no filtra.

`007` devuelve `{ count, rows }` con esta forma por fila:

```
{ systemConfigHistoryId, systemConfigId, previousValue, newValue,
  changeReason, createdAt,
  changedByUser: { userId, displayName } | null }
```

`changedByUserId` **no** se repite fuera del objeto anidado, y `displayName` llega descifrado. `previousValue` y `newValue` se descifran cuando la configuración es cifrada, porque el endpoint ya es SUPERADMIN-only.

`008` devuelve el resumen de la siembra:

```
{ ok, message, data: {
    created: [ { code, scope } ],
    skipped: [ { code, scope } ]
} }
```

Sin las filas completas: lo que interesa de un sync es qué faltaba, no el contenido de lo que ya había.

`001` responde 201 con la fila creada en `data` —con el `value` **enmascarado** si `isEncrypted` es `true`, aunque quien crea sea SUPERADMIN: la respuesta de un `create` no es la puerta para leer secretos, y para eso está el `003`—. `004` responde 200 con la fila resultante, cambiada o no, bajo las mismas reglas de enmascarado que el `003`. `005A` y `005B` responden `{ ok, message }` **sin** `data`.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Registrar la abreviatura y las tres operaciones no canónicas.** Añadir la fila `systemConfig | SYSCONF` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en su posición alfabética —entre `severeNotification` y `vaccineWhodrug`—, y tres filas a la tabla de operaciones desde `006`: `systemConfig | 006 | leer por el par (code, scope)`, `007 | listar el historial de cambios` y `008 | siembra idempotente de configuraciones iniciales`. La norma exige registrar **antes** de usar, así que este paso va primero aunque no toque `src/`.
   *Verificación:* `SYSCONF` aparece una sola vez en la tabla y no colisiona con las 25 existentes; las tres filas de operaciones citan la entidad `systemConfig` y ningún número se repite.

2. **Modelos, asociaciones, tipos y barrels.** `src/models/systemConfig.model.ts` con las quince columnas de §3.1 y `src/models/systemConfigHistory.model.ts` con las once, **sin `isActive`** en la segunda. Anchos respetados: `STRING(150)` en `code`, `STRING(200)` en `name`, `STRING(50)` en `valueType`, `STRING(100)` en `scope`. `src/models/associations/systemConfig.associations.ts` con las tres asociaciones de §3.2, registrado en `initModels()`. `src/types/systemConfig/` con los dos archivos de tipos, su `index.ts` de barrel y el alta en `src/types/index.ts`. Alta de los dos modelos en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `SystemConfig.findAll({ include: 'history' })` en un script suelto devuelve filas sin error de columna ni de asociación inexistente.

3. **Las veinticuatro claves i18n** de §3.6 en `es.json`, `en.json` y `nl.json`, con los parámetros de interpolación `{{code}}`, `{{scope}}` y `{{valueType}}` donde corresponde.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

4. **Helpers de dominio del `value`.** `src/helpers/systemConfigValue.helper.ts` con tres funciones, dadas de alta en el barrel `src/helpers/index.ts`: la validación cruzada de la tabla de §3.5, el cifrado a `{ "enc": "..." }` y el descifrado inverso. Las consumen seis operaciones —`001`, `003`, `004`, `006`, `007` y `008`—, así que se escriben una vez y antes que ninguna de ellas.
   *Verificación:* pruebas unitarias directas del helper: `valueType: 'number'` con `value: "42"` es inválido y con `42` válido; `valueType: 'json'` con `value: null` es válido y `valueType: 'number'` con `null` no; cifrar y descifrar un objeto devuelve el mismo objeto por `JSON.stringify`.

5. **`ESAVI-SYSCONF-001` — crear.** `createSystemConfigService` con la secuencia de siete pasos de §3.5, transacción y fila de historial. Controlador y validador: `code` y `name` obligatorios con sus longitudes, `value` obligatorio, `valueType` opcional restringido a los cinco literales, `scope` opcional, `isEncrypted`/`isEditable`/`isActive` opcionales booleanos, `changeReason` opcional. Ruta `POST /` con `validateUserRole(SUPERADMIN)`. Alta del validador en `src/validators/index.ts` y de la ruta en `src/routes/index.ts` bajo `/api/system-configs`.
   *Verificación:* crear con `code: "  esavi max upload  "` guarda `ESAVI_MAX_UPLOAD`; crear sin `scope` guarda `GLOBAL`; repetir el par `(code, scope)` devuelve **409**, no 500, incluso si la primera fila está inactiva; el **mismo `code` con otro `scope`** se crea sin conflicto; crear con `valueType: 'number'` y `value: "42"` devuelve **400**; crear con `isEncrypted: true` deja en la columna un objeto con la sola clave `enc` y responde con `value: null`; la fila de `systemConfigHistory` existe con `previousValue: null`.

6. **`ESAVI-SYSCONF-002A` — listado público.** `getActiveSystemConfigsService` con `isActive: true`, los tres filtros de §3.5, `findAndCountAll`, orden `scope ASC, code ASC` y enmascarado de los cifrados. Validador de query con `search` de mínimo 2 caracteres, `valueType` restringido a los cinco literales y `limit` entre 1 y 100. Ruta `GET /` con `validateUserRole(USER)`.
   *Verificación:* `?scope=notification` encuentra las filas de `NOTIFICATION`; `?valueType=texto` devuelve **400**; `?search=upload` encuentra por `name` y por `code`; `?search=u` devuelve **400**; una fila inactiva no aparece; toda fila con `isEncrypted: true` sale con `value: null` **también para SUPERADMIN**.

7. **`ESAVI-SYSCONF-002B` — listado admin.** Gemela sin `isActive` en el `where`. Ruta `GET /admin` con `validateUserRole(ADMIN)`, declarada **antes** de `/:id`.
   *Verificación:* un ADMIN ve las inactivas; un USER recibe **403**; los tres filtros y el enmascarado se comportan igual que en `002A`.

8. **`ESAVI-SYSCONF-003` — obtener por ID.** `getSystemConfigByIdService(id, lang, includeInactive, canDecrypt)`; controlador que pasa `canViewInactive(req.user)` en los dos últimos argumentos, que en la práctica son el mismo predicado; ruta `GET /:id` declarada **después** de todas las literales, con su `systemConfigIdValidator`.
   *Verificación:* un ID inexistente devuelve **404**; `GET /admin` y `GET /sync` no se interpretan como un `:id`; una fila inactiva devuelve **404** para USER y para ADMIN, y **200** para SUPERADMIN; una fila cifrada devuelve `value: null` para ADMIN y el valor descifrado para SUPERADMIN.

9. **`ESAVI-SYSCONF-006` — obtener por `(code, scope)`.** `getSystemConfigByCodeService(code, scope, lang, includeInactive, canDecrypt)`, con los dos normalizados antes de buscar. Ruta `GET /code/:code` con `validateUserRole(USER)`, declarada antes de `/:id`, y validador con `scope` opcional por query.
   *Verificación:* `GET /code/esavi_max_upload` y `GET /code/ESAVI_MAX_UPLOAD` devuelven la misma fila; sin `?scope=` resuelve contra `GLOBAL`; un par inexistente devuelve **404**; las reglas de inactivos y de descifrado son idénticas a las del `003`.

10. **`ESAVI-SYSCONF-004` — actualizar.** `updateSystemConfigService` con el orden de siete pasos de §3.5, la tabla de `candidates` completa —cinco campos— y `buildDifferentialUpdate`. Historial condicional a que `'value'` esté en la salida del helper, con transacción solo en ese caso. Preserva el historial de `appDetails` con `[...currentAppDetails, newEntry]`. Ruta `PUT /:id` con `validateUserRole(SUPERADMIN)` y validador que exige `changeReason` cuando el body trae `value`.
    *Verificación:* un `PUT` que reenvía íntegra la respuesta del `GET` devuelve **200** sin tocar `appDetails`, `updatedAt` ni `sysDetails.version`, y sin crear fila de historial; un `PUT` sobre una fila con `isEditable: false` devuelve **409** aunque el body no cambie nada; un `PUT` que solo cambia `name` **no** crea fila de historial; un `PUT` que cambia `value` sin `changeReason` devuelve **400**; un `PUT` con `code` o `scope` distintos responde **200** y los ignora en silencio; un `PUT` sobre una fila cifrada que reenvía el valor descifrado tal cual **no escribe**.

11. **`ESAVI-SYSCONF-005A` y `005B` — desactivar y reactivar.** `setSystemConfigActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción. Dos controladores y dos rutas — `DELETE /:id` y `PATCH /activate/:id`, **las dos SUPERADMIN** —, ambas respondiendo sin `data`.
    *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve **409** `ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe **403** en las dos; desactivar una fila con `isEditable: false` **funciona**, porque esa bandera protege el valor y no la existencia; ninguna de las dos crea fila de historial.

12. **`ESAVI-SYSCONF-007` — listar el historial.** `getSystemConfigHistoryService(id, limit, offset, lang)` con la comprobación de existencia del padre primero, `include` de `AppUser` con alias `changedByUser` y descifrado de `displayName`. Ruta `GET /:id/history` con `validateUserRole(SUPERADMIN)`, declarada antes de `/:id`.
    *Verificación:* un `systemConfigId` inexistente devuelve **404**, no una lista vacía; una configuración recién creada devuelve exactamente **una** fila; el orden es `createdAt DESC`; `changedByUser.displayName` llega en claro; una fila cuyo autor fue borrado devuelve `changedByUser: null`; un ADMIN recibe **403**.

13. **`ESAVI-SYSCONF-008` — sembrar.** `src/data/systemConfig.defaults.ts` con el catálogo inicial tipado, y `syncSystemConfigDefaultsService(authUser, lang)` con transacción única todo-o-nada. Ruta `POST /sync` con `validateUserRole(SUPERADMIN)`, sin body y sin validador de cuerpo, declarada antes de `/:id`.
    *Verificación:* la primera llamada crea las N entradas del catálogo y devuelve `skipped: []`; la segunda devuelve `created: []` y `skipped` con las N; desactivar una fila sembrada y volver a llamar **no la reactiva** y la cuenta en `skipped`; cambiar a mano el valor de una fila sembrada y volver a llamar **no lo repone**; una entrada del catálogo con `valueType: 'number'` y `value: "x"` aborta la siembra completa con **400** y no deja ninguna fila creada.

14. **Cubrir las diez rutas en `tests/auth/roles.test.ts`.** Diez filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **177 a 187** (`tests/auth/roles.test.ts:371`).
    *Verificación:* `npm test -- roles` pasa con 187.

15. **Suite `tests/contract/systemConfig.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por código → listar público → listar admin → actualizar → leer historial → desactivar → reactivar, verificando estado y envelope en cada paso. Más los caminos de error: 409 del par duplicado en create, 409 con la fila duplicada **inactiva**, 409 de `isEditable: false`, 400 de `valueTypeMismatch` en create y en update, 400 de `changeReason` ausente, 400 de `search` corto, y los cinco casos de update diferencial de §5. Tres bloques específicos: el del cifrado —enmascarado por operación y por rol, y `PUT` que reenvía el valor descifrado sin escribir—, el de la escritura condicional de historial, y el de idempotencia del `008`.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las diez rutas de §3.4 responden con su código de estado esperado, bajo `/api/system-configs`.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las diez operaciones.
- [ ] `grep -rn "ESAVI-SYSCONF-002[^AB]" src/` no devuelve resultados: todo es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-SYSCONF-005C\|/purge" src/routes/systemConfig.routes.ts` no devuelve resultados: las dos tablas están protegidas por `preventPhysicalDelete` y no exponen borrado físico.
- [ ] `grep -rn "upsertSystemConfig" src/` no devuelve resultados: el procedimiento del DDL no se invoca desde ninguna capa.
- [ ] Las tres operaciones no canónicas están registradas en la tabla de `references/CONVENTIONS.md` §6 con la entidad `systemConfig`.
- [ ] Crear con `code: "  esavi max upload  "` guarda `ESAVI_MAX_UPLOAD`; crear con `scope: "notification"` guarda `NOTIFICATION`.
- [ ] Crear sin `scope` guarda `GLOBAL`; crear sin `valueType` guarda `json`.
- [ ] Crear con `name: "Tamaño máximo de carga"` guarda ese texto **literal**: se aplica `.trim()` y nada más.
- [ ] Crear dos veces el mismo par `(code, scope)` devuelve 409, no 500, **incluso si el primero está inactivo**.
- [ ] Crear el **mismo `code` con otro `scope`** devuelve 201: la unicidad es compuesta, no global.
- [ ] Crear con `valueType: 'number'` y `value: "42"` devuelve 400; con `value: 42`, 201.
- [ ] Crear con `valueType: 'json'` y `value: null` devuelve 201; con `valueType: 'number'` y `value: null`, 400.
- [ ] `?scope=notification` filtra por `NOTIFICATION`; `?valueType=texto` devuelve 400; `?search=upload` encuentra por `name` **y** por `code`; `?search=u` devuelve 400.
- [ ] El orden por defecto de `002A` y `002B` es `scope ASC, code ASC`.
- [ ] `GET /admin`, `GET /sync` y `GET /code/...` no se interpretan como un `:id`.
- [ ] `GET /:id` de una fila inactiva: 404 para USER **y para ADMIN**, 200 para SUPERADMIN. `canViewInactive` es SUPERADMIN-only y el `002B` sigue siendo ADMIN: la asimetría es deliberada y la misma que tienen `healthFacility`, `diagnosticTerm`, `vaccineWhodrug` y `diluentCatalog`.
- [ ] `GET /code/esavi_max_upload` y `GET /code/ESAVI_MAX_UPLOAD` devuelven la misma fila; sin `?scope=` resuelve contra `GLOBAL`; un par inexistente devuelve 404.
- [ ] `POST`, `PUT`, `DELETE` y `PATCH /activate` devuelven 403 a un ADMIN: las cuatro escrituras son SUPERADMIN.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`, y **no** crean fila de historial.
- [ ] `DELETE /:id` sobre una fila con `isEditable: false` responde 200: esa bandera protege el valor, no la existencia.
- [ ] `appDetails.method` guarda `ESAVI-SYSCONF-005A` o `ESAVI-SYSCONF-005B`, sin `_ACTIVATION` pegado detrás.
- [ ] Cada operación de escritura añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `sysDetails` no aparece en ninguna respuesta: `grep -n "sysDetails" src/controllers/systemConfig.controller.ts` no devuelve resultados.
- [ ] Las veinticuatro claves existen en es, en y nl con los nombres de §3.6; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 187 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/systemConfig.service.ts` no devuelve resultados.
- [ ] Un `PUT` sobre una fila con `isEditable: false` responde **409**, y un `PUT` con un `value` incompatible con el `valueType` resultante responde **400**, aunque el resto del body no cambie nada. Las dos mitades del criterio canónico —FK inactiva y `code` ocupado— **no aplican**: `systemConfig` no tiene ninguna FK saliente, y `code` y `scope` son inmutables, así que el par único no puede colisionar en un update.

**Propios del cifrado:**

- [ ] Un `PUT` que reenvía el `value` descifrado que devolvió el `GET` sobre una fila cifrada responde **200** y **no escribe**: la columna cifrada queda idéntica byte a byte.
- [ ] Una fila con `isEncrypted: true` guarda en la columna un objeto con la sola clave `enc`, y su contenido no contiene el texto plano.
- [ ] `002A` y `002B` devuelven `value: null` en toda fila cifrada, **también para SUPERADMIN**.
- [ ] `003` y `006` devuelven `value: null` para USER y ADMIN, y el valor descifrado para SUPERADMIN.
- [ ] El `001` responde con `value: null` cuando `isEncrypted: true`, aunque quien crea sea SUPERADMIN.
- [ ] El enmascarado es `null` y nunca `"***"`: `grep -rn '"\*\*\*"' src/services/systemConfig.service.ts` no devuelve resultados.
- [ ] Un `PUT` con `isEncrypted: false` sobre una fila cifrada responde **200** y **no** la descifra: el campo es inmutable y se ignora.

**Propios del historial:**

- [ ] Crear una configuración deja exactamente **una** fila en `systemConfigHistory`, con `previousValue: null`.
- [ ] Un `PUT` que cambia **solo `name`** responde 200, escribe en `systemConfig` y **no** añade fila de historial.
- [ ] Un `PUT` que cambia `value` añade **una** fila con el `previousValue` correcto y el `changeReason` del body.
- [ ] Un `PUT` con `value` y sin `changeReason` responde **400**; un `PUT` sin `value` y sin `changeReason` responde 200.
- [ ] `changeReason` no aparece nunca en la fila de `systemConfig`: `grep -n "changeReason" src/models/systemConfig.model.ts` no devuelve resultados.
- [ ] `GET /:id/history` de un id inexistente responde **404**, no una lista vacía.
- [ ] `GET /:id/history` devuelve las filas en `createdAt DESC`, con `changedByUser.displayName` descifrado, y `changedByUser: null` cuando la FK está en `null`.
- [ ] `GET /:id/history` responde 403 a un ADMIN.
- [ ] `systemConfigHistory` no expone ninguna ruta propia: `grep -rn "systemConfigHistory" src/routes/` solo devuelve el `007`.

**Propios del `008` — idempotencia:**

- [ ] La primera llamada a `POST /sync` crea las N entradas del catálogo y devuelve `skipped: []`; la segunda devuelve `created: []` y `skipped` con las N.
- [ ] Una fila sembrada y luego **desactivada** cuenta como `skipped` y el sync **no la reactiva**.
- [ ] Una fila sembrada cuyo `value` se cambió a mano conserva el valor cambiado tras un nuevo sync.
- [ ] Una entrada del catálogo con `valueType` incompatible aborta la siembra completa con **400** y no deja ninguna fila creada.
- [ ] Cada fila creada por el sync deja su fila de historial con `previousValue: null`.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `SYSCONF`. Siete letras, dentro del rango de 4 a 8 de §6, no colisiona con las 25 registradas y se lee sin diccionario. **No:** `SYSCFG`, que abrevia una palabra ya abreviada y obliga a descifrar dos niveles; **no:** `CONFIG` a secas, que no dice de qué es la configuración y colisionaría de sentido con cualquier configuración futura de otro ámbito.
- **Sí:** `systemConfigHistory` **sin abreviatura propia y sin CRUD**. Sus dos puntos de contacto son la escritura desde el padre y la lectura por el `007`, y a los dos se entra por el `systemConfigId`. Darle abreviatura implicaría darle superficie propia, y una tabla append-only no tiene `001`, ni `004`, ni activación que ofrecer. **No:** un spec aparte para ella: `systemConfig` sin historial entrega una tabla que nadie puede auditar, que es justo el problema que §1 dice resolver. **No:** CRUD completo de las dos, que serían catorce endpoints y un spec que no ejecuta nadie.
- **Sí:** escritura en **SUPERADMIN** para `001`, `004`, `005A` y `005B`, desviándose de la matriz canónica de §9. Un parámetro de esta tabla gobierna el comportamiento de toda la aplicación para todos sus usuarios, y `isEncrypted` declara que alguno puede ser un secreto. Es la misma clase de riesgo que ya puso la activación en SUPERADMIN en todas las entidades: quien puede cambiar el estado del sistema es uno solo. **Sí:** `002B` se queda en **ADMIN** y las tres lecturas ordinarias en **USER**, porque leer qué parámetros existen no es lo mismo que cambiarlos —y el valor cifrado sigue oculto para los dos—. La desviación está declarada aquí y en §2, y es consciente, no un descuido de la matriz.
- **Sí:** `code` y `scope` **inmutables** tras el alta. Son la identidad por la que la aplicación lee su propia configuración: el `006` existe precisamente para que nadie tenga que conocer el UUID. Renombrar un `code` rompería en silencio a todo consumidor que lo pida por su nombre, y el fallo aparecería lejos del cambio, como un 404 en un módulo que hasta ayer funcionaba. **No:** mutables con su comprobación de unicidad, como en `healthFacility`, `diagnosticTerm` o `diluentCatalog`: ahí el `code` es una etiqueta de catálogo que un humano lee, aquí es una clave que un programa resuelve. Un typo en el `code` se corrige creando la fila buena y desactivando la mala, que además deja rastro.
- **Sí:** que un `code` o un `scope` en el body del `004` se **ignoren en silencio, sin 400**. Es lo que manda §11 para los campos inmutables, y evita que un cliente que reenvía la ficha completa del `GET` —el uso normal de un formulario— reciba un error por mandar algo que no pidió cambiar.
- **Sí:** `code` y `scope` normalizados con **`toConstantCase`**, la norma canónica de §11. Aquí sí aplica y en los catálogos clínicos no: `diagnosticTerm.code` y `vaccineWhodrug.drugCode` son datos **citados** de un diccionario externo, y alterarlos rompe la correspondencia con el fichero de origen. Un `code` de configuración lo acuña el administrador, no cita nada, y `ESAVI_MAX_UPLOAD_SIZE` es exactamente la forma en que se escribe una constante. Normalizar cierra además el duplicado por caja: sin ello convivirían `maxUpload` y `MAX_UPLOAD` como dos parámetros distintos, y el `006` devolvería uno u otro según cómo se teclease.
- **Sí:** normalizar también el `code` y el `scope` que llegan por el `006`, **antes** de buscar. Sin eso, el endpoint que existe para leer por nombre fallaría según la caja con que se escribiera la URL.
- **Sí:** `name` solo con `.trim()`, sin `toTitleCase`. Misma desviación de §11 que ya razonaron el F15, el F18 y el F23, y por el mismo motivo: `toTitleCase` convertiría `"Tamaño máximo de carga"` en `"Tamaño Máximo De Carga"`. **La asimetría con `code` es deliberada:** el código es un identificador que la aplicación fabrica; el nombre, un texto que el usuario escribe.
- **Sí:** unicidad **compuesta de `(code, scope)` y sin filtrar por `isActive`**. Es lo que impone `UQ_systemConfig_code_scope`, que no sabe de `isActive` — filtrar por él en la aplicación convertiría un 409 en un 500 cuando la base rechazara el `INSERT` con `23505`. Un par ocupado por una fila desactivada sigue ocupado.
- **Sí:** conservar el nombre canónico de clave **`codeExists`** de §13 aunque la unicidad sea compuesta, y que el mensaje nombre el par interpolando `{{code}}` y `{{scope}}`. **No:** acuñar `codeScopeExists`: la paridad de nombres entre entidades es lo que permite leer un `getMessage` sin abrir el JSON, y el matiz cabe entero en el texto del mensaje.
- **Sí:** `isEditable: false` bloquea el `004` con **409**, antes del diff. **No:** 403, que es el status del middleware de rol y significa «tú no puedes», cuando aquí el problema es la fila, no quien la pide: el mismo SUPERADMIN que recibe el 409 puede editar cualquier otra. Es un conflicto de estado del recurso, como el `alreadyActive` de las activaciones.
- **Sí:** rechazar el `PUT` sobre una fila protegida **aunque el body no cambie nada**. La alternativa —dejar pasar el `PUT` vacío porque el diff habría salido vacío igualmente— haría que el mismo endpoint respondiera 200 o 409 según el contenido, y un cliente no podría distinguir «esta fila es editable» de «no cambié nada». El 409 informa del régimen de la fila.
- **Sí:** `isEditable` **mutable, y solo por SUPERADMIN** —que es quien puede llamar al `004`, así que no hace falta ninguna regla extra—. Una fila protegida tiene que poder desprotegerse cuando el parámetro deja de ser crítico, y quien puede hacerlo es el mismo que puede cambiar cualquier valor. **No:** inmutable, que obligaría a entrar por SQL directo, es decir, sin auditoría, que es lo contrario de lo que esta tabla persigue. **Sí:** entra en `candidates` comparándose contra `undefined` y nunca bajo `if( data.isEditable )`, que descartaría el `false` y haría imposible volver a proteger una fila.
- **Sí:** `isEncrypted: true` significa **cifrado real** del `value` con `esaviCrypt`. **No:** guardarlo en claro y solo enmascararlo en la respuesta: eso protege de la API pero no de quien lee la base, un volcado de respaldo o un log de consultas, que es de donde salen los secretos en la práctica. **No:** dejar la bandera como metadato informativo que la aplicación no honra: una columna que dice «esto es un secreto» y no lo protege es peor que no tenerla, porque genera confianza infundada.
- **Sí:** guardar el ciphertext envuelto como **`{ "enc": "<ciphertext>" }`**. La columna es `jsonb NOT NULL` y `esaviCrypt` devuelve texto: guardar la cadena pelada como JSON string funcionaría, pero haría indistinguible un valor cifrado de un `valueType: 'string'` cualquiera con solo mirar la base. La clave `enc` es la marca. **No:** una columna nueva para el ciphertext, que es un cambio de esquema sobre una tabla que el DDL ya dejó preparada con su bandera.
- **Sí:** el diff del `004` se hace **sobre texto plano**, con `stored.value` descifrado y `esaviCrypt` aplicado después. Es la norma de §11 para campos cifrados, y aquí muerde más fuerte que en `appUser`: si algún día `esaviCrypt` pasa a IV aleatorio, comparar ciphertext haría que **todo** `PUT` pareciera un cambio y cada apertura de la pantalla escribiría una fila de historial.
- **Sí:** el valor cifrado se enmascara con **`value: null`**, no con `"***"`. La fila lleva `isEncrypted: true`, así que el cliente distingue «cifrado y no visible para ti» de «vacío» sin necesidad de un centinela. Y un `"***"` reenviado en un `PUT` —que es exactamente lo que hace un formulario que repinta lo que leyó— se guardaría como valor literal, destruyendo el secreto con un 200.
- **Sí:** enmascarar **siempre** en los listados, incluso para SUPERADMIN. Un listado es una lectura de conjunto y arrastraría todos los secretos a la vez a cualquier caché, historial de navegador o captura de pantalla. Quien necesite el valor lo pide por `003` o por `006`, uno a uno.
- **Sí:** descifrar solo para **SUPERADMIN**, y en `003`, `006` y `007`. `002B` es ADMIN y no descifra; el `007` no necesita regla propia porque el endpoint entero ya es SUPERADMIN-only.
- **Sí:** `isEncrypted` **inmutable** en el `004`. Pasar de `false` a `true` obliga a cifrar el valor guardado y al revés a descifrarlo: es una escritura con intención propia, con su transacción y su entrada de historial, y esconderla tras un campo booleano del formulario haría que un `PUT` a veces reescribiera una columna que el cliente no mencionó. Si aterriza, va en su propio spec.
- **Sí:** validar `value` contra `valueType` en el **servicio** y no en el validador. En el `004` la validación necesita el `valueType` **guardado** cuando el body no lo trae, y un validador de `express-validator` no consulta la base. Hacerlo en el servicio permite además usar exactamente la misma función en `001`, `004` y `008`. Es la excepción declarada a que los 400 salgan siempre de `validateFields`.
- **Sí:** validar contra el `valueType` **resultante**, no contra el que viaja en el body. Un `PUT` que solo cambia `valueType` a `'number'` sobre un `value` que es un array tiene que ser 400: la fila quedaría mintiendo sobre su propio tipo.
- **Sí:** `null` aceptado **solo** bajo `valueType: 'json'`. Es JSON válido, pero un `valueType: 'number'` existe para que el consumidor pueda confiar en el tipo sin comprobarlo, y un `null` obliga a comprobarlo igualmente.
- **Sí:** `valueType` **mutable**. Un parámetro puede cambiar de forma —de `string` a `array` cuando pasa de admitir un valor a admitir varios— y forzar a recrear la fila perdería su historial, que es la única memoria de cómo llegó a valer lo que vale.
- **Sí:** `changeReason` en el body sin ser columna de `systemConfig`. Es el único campo del repositorio que viaja en un `PUT` y no describe la fila que se actualiza, así que está señalado en §3.3 y en la tabla de `candidates` de §3.5. **Sí:** obligatorio cuando el body trae `value`, opcional en el resto. Sin él, el historial guarda quién y cuándo pero nunca por qué, que es la mitad de su utilidad; exigirlo siempre, en cambio, bloquearía una corrección de `name` por una formalidad.
- **Sí:** historial **condicional a que `value` cambie de verdad**, y no a que la clave `value` venga en el body. Es la regla de §11 aplicada a un efecto lateral: un formulario que reenvía la ficha completa generaría una fila de historial por cada apertura de pantalla, y un historial lleno de entradas sin cambio no es trazabilidad, es ruido que esconde las modificaciones reales. **No:** historial en cada `UPDATE`, que es lo que hace `upsertSystemConfig` y lo que este spec declara que no va a imitar.
- **No:** historial en `005A` y `005B`. Las columnas son `previousValue`/`newValue`: la tabla registra cambios de valor. Desactivar no cambia ninguno, y el rastro de la activación ya vive en `appDetails` y en `sysDetails.auditTrail`.
- **Sí:** `006` como operación no canónica con ruta `GET /code/:code`. Un CRUD por UUID no sirve para lo que existe la tabla: quien lee configuración conoce el nombre del parámetro, no su identificador. **No:** un query param sobre el `002A` (`GET /?code=X`), que devolvería `{ count, rows }` con una fila para una lectura que es de una sola entidad, y no podría distinguir «no existe» —que es 404— de «lista vacía» —que es 200—.
- **Sí:** `007` colgando del padre, `GET /:id/history`. Es la única forma de leer una tabla que no tiene sentido fuera de su configuración. **No:** `GET /system-config-history?configId=X`, que le daría a la hija una superficie propia y un `002` que nadie necesita.
- **Sí:** el `007` comprueba la existencia del padre **antes** de consultar la hija. Un id inexistente devolviendo `{ count: 0, rows: [] }` se lee como «esta configuración nunca cambió», que es una afirmación falsa sobre algo que no existe.
- **Sí:** `include` de `AppUser` con `displayName` descifrado en el `007`. Un UUID en una pantalla de auditoría obliga a una segunda petición por fila para saber quién fue, y quien lee un historial lee varias filas seguidas. **No:** devolver el UUID pelado; **no:** incluir el `email` u otros campos de `appUser`, que son PII que esta pantalla no necesita.
- **Sí:** siembra por **`ESAVI-SYSCONF-008`, `POST /sync`**, con catálogo declarativo en `src/data/systemConfig.defaults.ts`. Cubre lo que se pidió —que el conjunto de parámetros crezca con el tiempo— con el coste de añadir una entrada al fichero y volver a llamar al endpoint tras desplegar. **No:** colgarlo del seed router existente: `src/routes/index.ts:33-37` lo condiciona a `NODE_ENV !== 'production'`, y producción es justo donde la siembra hace falta. **No:** un script `npm run seed:config` fuera de la API, que no queda auditado en `appDetails`, no pasa por `validateUserRole` y exige acceso al servidor.
- **Sí:** el `008` es **solo-alta**: crea lo que falta y no toca nada existente. Lo que hay en producción manda sobre el default, y ésa es la única regla que impide que un deploy pise silenciosamente una configuración ajustada a mano. **No:** un sync que reponga valores por defecto; si alguna vez hace falta, es otro endpoint, con otra confirmación explícita.
- **Sí:** una fila **inactiva cuenta como existente** para el `008`, y el sync no la reactiva. Alguien la desactivó a propósito, y un `POST /sync` no puede deshacer una decisión deliberada de otro.
- **Sí:** transacción única todo-o-nada en el `008`. Una entrada mal declarada en el catálogo aborta la siembra completa: media configuración creada es un estado que nadie sabe cómo reanudar, y el catálogo es un fichero de código cuyo error se corrige y se vuelve a desplegar.
- **Sí:** no invocar `upsertSystemConfig` (`esaviapp.sql:1498-1539`) y **no borrarlo** del DDL. No se invoca porque hace tres cosas incompatibles con la norma —confunde alta con modificación, convierte un `value` ausente en `'{}'`, y escribe historial siempre—. No se borra porque el fichero se carga en los tests y tocarlo es un cambio de esquema sin ninguna ganancia. Queda documentado en §1 y en §3.1 para que nadie lo tome por la vía oficial dentro de seis meses.
- **Sí:** modelar `systemConfigHistory` **sin `isActive`**, calzando con el DDL. No es una anomalía a corregir: la tabla es append-only, no expone activación, y añadir la columna en el modelo sin que exista en la base sería un 500 en la primera consulta.
- **No:** migrar en este spec los parámetros que hoy viven en `.env`. El `008` siembra filas y **nadie las consume todavía** desde el código de arranque. Decidir cuáles bajan a base de datos, en qué orden y qué manda mientras las dos fuentes conviven es un spec de configuración en sí mismo, y meterlo aquí convertiría un CRUD en una migración transversal.
- **No:** caché en memoria de la lectura de configuración. Un parámetro leído en cada petición la merecerá, pero hoy no hay ninguna capa de caché en el repositorio e introducirla es un cambio transversal con su propia invalidación.
- **No:** versionado ni *rollback* desde el historial. El `007` lee; restaurar un `previousValue` es una escritura con su propia semántica, su propio código de operación y su propia entrada de historial.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El `value` cifrado se compara en ciphertext** y el `004` escribe en cada `PUT`, con una fila de historial por cada apertura de la pantalla | Es el error más probable del spec y el más caro: contamina la tabla que existe para auditar. Declarado en §3.5 paso 4, razonado en §6, y cubierto por un criterio propio en §5 —`PUT` que reenvía el valor descifrado no escribe y deja la columna idéntica byte a byte— |
| Un formulario repinta el `"***"` que recibió y lo reenvía en un `PUT`, guardando el centinela como valor real y **destruyendo el secreto con un 200** | Por eso el enmascarado es `value: null` y no `"***"`, con un `grep` en §5 que verifica que la cadena no aparece en el servicio. Un `null` reenviado sobre un campo cifrado tampoco pasa: `valueType` distinto de `'json'` lo rechaza con 400 |
| La escritura de historial se dispara por **presencia de la clave `value` en el body** en vez de por su aparición en la salida de `buildDifferentialUpdate` | Es la variante del error diferencial que los cinco criterios canónicos **no** atrapan, porque miran `appDetails` y `sysDetails`, no la tabla hija. Cubierto por un bloque propio en §5: un `PUT` que solo cambia `name` no añade fila de historial |
| El `004` valida `value` contra el `valueType` **del body** y una fila queda mintiendo sobre su propio tipo | Declarado en §3.5 paso 3 —contra el `valueType` **resultante**— y con criterio propio en §5 |
| La unicidad de `(code, scope)` se comprueba solo por `code`, y dos ámbitos legítimos colisionan; o se comprueba filtrando por `isActive` y el `INSERT` lo rechaza la base con un **500** donde toca un **409** | Dos criterios de aceptación separados: el mismo `code` con otro `scope` devuelve **201**, y el par repetido devuelve **409 con la primera fila inactiva** |
| `scope` ausente se normaliza **después** de resolverse a `GLOBAL`, o al revés, y conviven `GLOBAL` y `Global` como ámbitos distintos | El orden está fijado en §3.5 paso 1: se resuelve el defecto **antes** de normalizar y antes de comprobar unicidad. El `006` normaliza igual el `scope` que llega por query |
| Alguien invoca `upsertSystemConfig` por parecer «la vía del esquema», y se salta el diff, el cifrado y la validación de tipo de una sola llamada | Documentado en §1, §3.1 y §6, y verificado por `grep -rn "upsertSystemConfig" src/` en §5 |
| `isEditable` entra en `candidates` bajo `if( data.isEditable )` y una fila desprotegida no puede volver a protegerse | Nombrado en la tabla de §3.5 con su forma exacta, razonado en §6 y cubierto por el criterio de los booleanos |
| Un `POST /sync` en producción pisa una configuración ajustada a mano | El `008` es solo-alta por diseño y no toca ninguna fila existente, activa o inactiva. Tres criterios de aceptación lo verifican, incluido el del valor cambiado a mano que sobrevive al sync |
| La siembra falla a medias y deja un conjunto de parámetros que nadie sabe cómo reanudar | Transacción única todo-o-nada, con un criterio que exige **cero** filas creadas cuando una entrada del catálogo es inválida |
| Se toma la ausencia de `isActive` en `systemConfigHistory` por un olvido y se añade al modelo, provocando un 500 en la primera consulta | Declarada como anomalía verificada en §3.1, con su razón —la tabla es append-only— y recogida en §6 |
| `GET /:id` captura `/admin`, `/sync` o `/code` como UUID | Las cuatro rutas literales se declaran antes que `/:id`; hay un criterio de aceptación explícito y la suite de contrato lo cubre |
| Se lee la ausencia de `005C` como un olvido y se añade el endpoint, que la base rechazaría con un 500 | La regla de disponibilidad de §6 es objetiva contra el DDL, las dos tablas están en `esaviapp.sql:1371`, y un `grep` en §5 verifica la **ausencia** |
| La desviación de la matriz de roles se lee como error y alguien «corrige» el `004` a ADMIN | Declarada en §2, en §3.4 y razonada en §6, con un criterio que exige **403 para ADMIN** en las cuatro escrituras y las diez filas de `ROUTE_RULES` que lo fijan |

---

## 8. Impacto en el contrato HTTP

No cambia el comportamiento de ningún cliente actual: el spec solo añade endpoints nuevos. Tampoco hay cambios de esquema — el DDL de las dos tablas se toma tal cual está en `esaviapp.sql:358-394`, y el procedimiento `upsertSystemConfig` se deja intacto.

Lo que sí cambia es la **norma**, en dos puntos que quedan escritos en `references/CONVENTIONS.md` §6: el alta de la abreviatura `SYSCONF` y el registro de tres operaciones no canónicas —`006`, `007` y `008`—. Y una desviación declarada de la matriz de roles de §9, que este spec razona pero **no generaliza**: sigue siendo ADMIN el rol de escritura por defecto en el resto del repositorio.

---

## Lo que **no** está en este spec

- Migrar a la tabla los parámetros que hoy viven en `.env`. El `008` siembra filas; el código de arranque sigue leyendo del entorno.
- Cachear en memoria la lectura de configuración.
- CRUD propio de `systemConfigHistory`: la tabla es append-only y solo se lee por el `007`.
- Cambiar el régimen de cifrado de una fila existente. `isEncrypted` es inmutable.
- La rotación de la clave de cifrado, que alcanza también a `appUser`.
- Borrar el procedimiento `upsertSystemConfig` del DDL.
- Que el `008` actualice, reponga o reactive filas existentes.
- El borrado físico `005C`: las dos tablas están protegidas por `preventPhysicalDelete`.
- Versionado o *rollback* desde el historial.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
