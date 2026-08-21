# SPEC F28 — CRUD completo de investigation

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F06 (`esaviCase` — dependencia dura: `caseId` es `NOT NULL`)**, SPEC F07 (mecanismo de cascada de `ESAVI-CASE-005A`, al que esta entidad se suma como cuarto satélite), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-20
> **Objetivo:** Dar de alta la entidad `investigation` —solo la tabla raíz, sin ninguna de sus catorce satélites— con sus siete artefactos, sus siete operaciones canónicas más el acceso por caso y el borrado físico.

---

## 1. Por qué existe este spec

`investigation` es la **cuarta** de las cinco tablas satélite de `esaviCase` que recibe implementación, después de `notifier`, `classification` y `notification`. Es la raíz del bloque de investigación: cuándo empezó la indagación, en qué estado está, dónde se vacunó al paciente y con qué coordenadas. De ella cuelgan **catorce** tablas de detalle que este spec no toca.

Hoy la tabla existe en `esaviapp.sql:929-954` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Cinco características la sitúan respecto de lo ya implementado:

**A — Es uno a uno con el caso, como `classification` y `notification`.** `UQ_investigation_case` declara `UNIQUE ("caseId")` (`esaviapp.sql:952`). Un caso tiene como mucho una investigación, y el intento de abrir la segunda es un conflicto, no un alta. La tabla declara además `IX_investigation_case` (`esaviapp.sql:954`), redundante con el índice único que Postgres crea de oficio para la `UNIQUE`. No es un problema y este spec no lo retira.

**B — Todas sus columnas de datos son anulables.** Salvo `caseId`, el DDL no declara ni un `NOT NULL` ni un `DEFAULT` en toda la tabla. Una investigación se abre prácticamente vacía y se va completando; eso convierte el `004` en la operación principal de la entidad, no en un accesorio, y hace que el contrato de update diferencial de §3.5 sea la pieza central del spec.

**C — El estado de la investigación es la única excepción a esa regla, y la impone la aplicación, no el esquema.** `statusItemId` es anulable en el DDL, pero este spec lo trata como **derivado que nunca queda en `null`**: si no llega en el alta —o si llega explícitamente en `null` en el update—, el servicio resuelve el `catalogItem` de código `'0'` («Desconocido») del `catalogType` `investigationStatus`. Un registro de investigación sin estado no es un dato consultable.

**D — Los seis valores aprobados de `investigationStatus` no son los que siembra el DDL.** `esaviapp.sql:1586-1588` carga `NOT_STARTED`, `IN_PROGRESS` y `CLOSED`; los aprobados son seis, con `code` numérico: `0` Desconocido, `1` En Recuperación/resolviendo, `2` Recuperado/resuelto, `3` No Recuperado/no Resuelto, `4` Recuperado/resuelto Con Secuelas, `5` Fallecido. Este spec **sustituye esas tres líneas de semilla** — es la primera vez que un spec del repositorio modifica `esaviapp.sql`, y el alcance de la modificación son exactamente tres `CALL "upsertCatalogItem"(...)`, sin tocar ni una línea de DDL. Como `upsertCatalogItem` no borra, las bases ya cargadas conservarían los tres antiguos: retirarlos es precondición de despliegue, declarada en §2.

**E — El `ON DELETE CASCADE` del DDL no protege nada, igual que en los tres satélites anteriores.** `FK_investigation_case` declara `ON DELETE CASCADE` (`esaviapp.sql:947`), pero `TRG_esaviCase_preventPhysicalDelete` impide todo borrado físico de `esaviCase` (`esaviapp.sql:1363-1379`), así que la cascada declarada **nunca dispara**. La integridad del ciclo de vida la sostiene solo la aplicación, en el mecanismo del SPEC F07 (`src/services/esaviCase.service.ts:590-592`), al que esta entidad se suma como cuarta función hermana.

`investigation` **tampoco está** en la lista de `preventPhysicalDelete` (`esaviapp.sql:1369-1373`), así que un `DELETE FROM "investigation"` ejecuta sin error y le corresponde la operación `005C` del SPEC F08. Con una advertencia que ninguna entidad anterior tuvo tan grande: sus catorce satélites declaran `ON DELETE CASCADE` sobre `investigationId`.

El único trigger que alcanza a la tabla es `TRG_investigation_setSysDetails`, creado por el bucle genérico de `esaviapp.sql:1284-1298`. No valida ninguna regla de negocio. **No existe `TRG_investigation_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigation`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Las siete operaciones canónicas: `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- La operación no canónica **`006` — obtener por caso**, `GET /case/:caseId`, que es la consulta real del dominio: el cliente tiene el `caseId`, no el `investigationId`. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- La operación `005C` de borrado físico, en SUPERADMIN, que le corresponde por no estar `investigation` en el bucle `preventPhysicalDelete` del DDL. Las reglas transversales las fija el [SPEC F08](./08-physical-delete.md); aquí solo se declara la ruta, las claves de la entidad y la advertencia de cascada sobre las catorce satélites.
- Relación **uno a uno** con `esaviCase`, sostenida por `UQ_investigation_case`. Investigar dos veces el mismo caso devuelve **409**, y el hueco **no se libera** cuando la existente está inactiva: para volver a investigar hay que reactivar la anterior o purgarla.
- **`statusItemId` nunca queda en `null`.** Si no llega en el `001`, o si llega explícitamente en `null` en el `004`, el servicio resuelve el `catalogItem` de código `'0'` del `catalogType` de código `investigationStatus` y lo guarda. Es un **derivado**: entra siempre en `candidates`, sin `if` de presencia.
- Validación de FK en create y update, todas contra filas activas:
  - `caseId` → `esaviCase` existente y activo.
  - `statusItemId` → `catalogItem` activo y perteneciente al `catalogType` de código `investigationStatus`.
  - `vaccinationSiteItemId` → `catalogItem` activo y perteneciente al `catalogType` de código `vaccinationSite`.
  - `vaccinationHealthFacilityId` → `healthFacility` existente y activo.
  - `vaccinationGeoLocationId` → `geoLocation` existente y activo.
- **Sustitución de las tres líneas de semilla** `CALL "upsertCatalogItem"('investigationStatus', ...)` de `esaviapp.sql:1586-1588` por las seis aprobadas, con `code` numérico `'0'` a `'5'`. Es la única modificación de `esaviapp.sql` que este spec autoriza, y no toca ninguna línea de DDL.
- `hospitalizationDate` e `investigationStartDate` no futuras, emitido por el validador con 400 reutilizando `isNotFutureDate`.
- `vaccinationLatitude` y `vaccinationLongitude` como `DECIMAL(10,7)`, validadas con `.isDecimal({ decimal_digits: '0,7' })` igual que en `healthFacility`.
- Update diferencial obligatorio en el `004`, con la tabla de `candidates` campo por campo de §3.5 y el bloque de criterios de §5.
- Listados con `findAndCountAll`, orden por defecto `createdAt DESC`, paginación y cuatro filtros por query acumulativos con `AND`: `caseId`, `statusItemId`, `vaccinationHealthFacilityId` y `vaccinationGeoLocationId`.
- **Sumar `investigation` a la cascada del SPEC F07:** `ESAVI-CASE-005A` desactiva también la investigación activa del caso, en la misma transacción y en el mismo punto de `src/services/esaviCase.service.ts:590-592`, como cuarta función hermana. La cascada sigue siendo **solo de bajada**: `ESAVI-CASE-005B` no reactiva nada.
- Alta de la abreviatura `INVESTGN` en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/investigation.test.ts`, más la ampliación de `tests/contract/esaviCase.test.ts` con la cascada.

**Precondiciones de despliegue** (no son parte de la implementación):

- En bases ya cargadas, **desactivar los tres `catalogItem` antiguos** de `investigationStatus` —`NOT_STARTED`, `IN_PROGRESS` y `CLOSED`— con `DELETE /api/catalog-items/:id`. `upsertCatalogItem` no borra: sin este paso conviven con los seis nuevos y el catálogo devuelve nueve ítems con dos semánticas.
- Debe existir el `catalogType` de código `vaccinationSite` con sus ítems activos. **El DDL no lo siembra**: se carga por los endpoints ya existentes de `catalogType` y `catalogItem`. Sin él, todo `vaccinationSiteItemId` devuelve 404.
- Debe existir el ítem `code: '0'` de `investigationStatus`. Sin él, un alta sin `statusItemId` devuelve **500** `INVESTGN_001_DEFAULT_STATUS_MISSING`.

**Fuera de alcance (otros specs):**

- **Las catorce tablas satélite de `investigation`**, que es la acotación explícita de este spec: `investigationSource` (`esaviapp.sql:956-974`), `investigationAutopsy` (`976-993`), `investigationTeamMember` (`995-1011`), `investigationCovidHistory` (`1013-1035`), `investigationMedicalHistory` (`1037-1064`), `investigationPregnancyCondition` (`1066-1081`), `investigationClinicalEvaluation` (`1083-1107`), `evaluationInstitution` (`1109-1128`), `investigationVaccinationContext` (`1130-1151`), `investigationVaccineAdministered` (`1153-1168`), `investigationColdChain` (`1170-1193`), `investigationAdministrationError` (`1195-1229`) e `investigationCommunity` (`1231-1249`). Ninguna se modela, ni se asocia, ni se incluye en ninguna respuesta.
- `finalClassification`, la quinta satélite de `esaviCase`.
- Extender la cascada de `ESAVI-CASE-005A` a esas otras tablas.
- Crear la investigación automáticamente cuando `notification.requestInvestigation` es `true`. Investigar es un acto posterior y deliberado, y atar las dos entidades exigiría decidir qué pasa cuando ese campo vuelve a `false`.
- Cualquier regla cruzada contra `notification` o `classification`: ni coherencia entre el estado `5` («Fallecido») y el desenlace `DEATH` de la notificación, ni entre `hospitalizationDate` y `classification.firstConsultationDate`.
- Validar `hospitalizationDate` o `investigationStartDate` contra `esaviCase.eventDate`, o una contra la otra. Solo se comprueba que no sean futuras.
- Sembrar el `catalogType` de código `vaccinationSite`, o los seis ítems nuevos en bases ya cargadas. Son precondiciones, no implementación.
- Cualquier modificación de `esaviapp.sql` **que no sean las tres líneas de semilla declaradas arriba**: ni el índice `IX_investigation_case` redundante, ni añadir `investigation` a `preventPhysicalDelete`, ni el índice único parcial que liberaría el `caseId` de una investigación inactiva, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- Cifrado de ningún campo. La tabla no contiene datos identificativos del paciente: las coordenadas son del punto de vacunación, no del domicilio.
- Búsqueda por texto sobre `notes`, filtros por rango de fechas y búsqueda geográfica por proximidad de coordenadas.
- Cualquier endpoint de estadística, conteo por estado de investigación o exportación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigation` — `esaviapp.sql:929-954`. Su DDL no se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | PK, `gen_random_uuid()` |
| `caseId` | `uuid` | **no** | `FK_investigation_case` → `esaviCase`, `ON DELETE CASCADE`. **`UQ_investigation_case` UNIQUE**: uno a uno. Inmutable |
| `statusItemId` | `uuid` | sí | `FK_investigation_status` → `catalogItem`, `ON DELETE RESTRICT`. Catálogo `investigationStatus`. La aplicación nunca lo deja en `null` |
| `vaccinationSiteItemId` | `uuid` | sí | `FK_investigation_vaccinationSite` → `catalogItem`, `ON DELETE RESTRICT`. Catálogo `vaccinationSite` |
| `vaccinationHealthFacilityId` | `uuid` | sí | `FK_investigation_vaccinationFacility` → `healthFacility`, `ON DELETE RESTRICT` |
| `vaccinationGeoLocationId` | `uuid` | sí | `FK_investigation_vaccinationGeo` → `geoLocation`, `ON DELETE RESTRICT` |
| `hospitalizationDate` | `date` | sí | no futura |
| `investigationStartDate` | `date` | sí | no futura |
| `vaccinationLatitude` | `numeric(10,7)` | sí | vuelve de `pg` como cadena |
| `vaccinationLongitude` | `numeric(10,7)` | sí | vuelve de `pg` como cadena |
| `notes` | `text` | sí | texto libre |

**Salvo `caseId`, ninguna columna de datos es `NOT NULL` y ninguna tiene `DEFAULT`.** No hay `CHECK` en la tabla.

Las cuatro columnas transversales están presentes y completas: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB), más `createdAt` y `updatedAt`.

**Índices.** `IX_investigation_case` (`esaviapp.sql:954`) es **redundante** con el índice único que Postgres crea de oficio para `UQ_investigation_case`: los dos son sobre `("caseId")`. No se retira — modificar el DDL está fuera de alcance.

**Triggers.** El único que alcanza a la tabla es `TRG_investigation_setSysDetails`, del bucle genérico de `esaviapp.sql:1284-1298`. **No existe `TRG_investigation_setUpdatedAt`** ni **`TRG_investigation_preventPhysicalDelete`**: `investigation` no figura en la lista de `esaviapp.sql:1369-1373`, así que un `DELETE` físico ejecuta sin error.

**Semilla que sí se modifica.** Las tres líneas `esaviapp.sql:1586-1588` se sustituyen por seis, respetando la firma de `upsertCatalogItem(typeCode, typeName, code, name, value, sortOrder)`:

| `code` | `name` | `sortOrder` |
|---|---|---|
| `0` | Desconocido | 0 |
| `1` | En Recuperación/resolviendo | 1 |
| `2` | Recuperado/resuelto | 2 |
| `3` | No Recuperado/no Resuelto | 3 |
| `4` | Recuperado/resuelto Con Secuelas | 4 |
| `5` | Fallecido | 5 |

`toCodeFromInput('0')` devuelve `'0'` (`src/helpers/stringHandling.helper.ts:28-45`): un código numérico atraviesa la normalización de `catalogItem` intacto y es idempotente. No hace falta ninguna excepción.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigation.model.ts`. Clase `Investigation`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigation'`. PK `investigationId` con `defaultValue: sequelize.literal('gen_random_uuid()')`.

`caseId` va `allowNull: false`, calcando el DDL; **todo lo demás va `allowNull: true`**, incluido `statusItemId`: que la aplicación nunca lo deje vacío es una regla de servicio, y declararlo `allowNull: false` en el modelo lo convertiría en un error de Sequelize en vez de en el 500 con mensaje propio de §3.5.

`vaccinationLatitude` y `vaccinationLongitude` se declaran `DataTypes.DECIMAL(10, 7)`, como en `src/models/healthFacility.model.ts`. `hospitalizationDate` e `investigationStartDate` van `DataTypes.DATEONLY`.

Asociaciones, en `src/models/associations/investigation.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `Investigation.belongsTo(EsaviCase, { as: 'case', foreignKey: 'caseId' })`
- `Investigation.belongsTo(CatalogItem, { as: 'status', foreignKey: 'statusItemId' })`
- `Investigation.belongsTo(CatalogItem, { as: 'vaccinationSite', foreignKey: 'vaccinationSiteItemId' })`
- `Investigation.belongsTo(HealthFacility, { as: 'vaccinationHealthFacility', foreignKey: 'vaccinationHealthFacilityId' })`
- `Investigation.belongsTo(GeoLocation, { as: 'vaccinationGeoLocation', foreignKey: 'vaccinationGeoLocationId' })`
- `EsaviCase.hasOne(Investigation, { as: 'investigation', foreignKey: 'caseId' })` — `hasOne` y no `hasMany` porque `UQ_investigation_case` lo impone, siguiendo el criterio que F09 fijó para `classification`.

Los dos `belongsTo` a `CatalogItem` **necesitan alias distintos** (`status` y `vaccinationSite`): sin ellos Sequelize no puede resolver dos asociaciones al mismo modelo.

Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso **no se añade a ninguna respuesta de `esaviCase`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia.

### 3.3 Tipos y constantes

**Constantes** — `src/constants/investigation.constants.ts`, archivo nuevo:

```ts
export const INVESTIGATION_STATUS_CATALOG_CODE = 'investigationStatus';
export const VACCINATION_SITE_CATALOG_CODE = 'vaccinationSite';
export const DEFAULT_INVESTIGATION_STATUS_CODE = '0';
```

Los tres códigos viven aquí y **no se escriben literales en el servicio**: son el acoplamiento del spec con datos que están fuera del esquema, y tenerlos en un solo sitio es lo que permite verificar por `grep` que no se han duplicado.

**Tipos** — `src/types/investigation/investigation.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`:

```ts
export interface CreateInvestigationInput {
    caseId: string;
    statusItemId?: string | null;
    vaccinationSiteItemId?: string | null;
    vaccinationHealthFacilityId?: string | null;
    vaccinationGeoLocationId?: string | null;
    hospitalizationDate?: string | null;
    investigationStartDate?: string | null;
    vaccinationLatitude?: number | null;
    vaccinationLongitude?: number | null;
    notes?: string | null;
    isActive?: boolean;
}
```

`statusItemId` admite `| null` en el tipo porque el cliente **sí puede enviarlo en `null`** — lo que no puede es conseguir que se guarde así. El update usa `Partial<CreateInvestigationInput>`. No se declara `UpdateInvestigationInput`. `caseId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre**: es inmutable.

### 3.4 Superficie HTTP

```
POST   /api/investigations                ESAVI-INVESTGN-001   USER        (nuevo)
GET    /api/investigations                ESAVI-INVESTGN-002A  USER        (nuevo)
GET    /api/investigations/admin          ESAVI-INVESTGN-002B  ADMIN       (nuevo)
GET    /api/investigations/case/:caseId   ESAVI-INVESTGN-006   USER        (nuevo)
GET    /api/investigations/:id            ESAVI-INVESTGN-003   USER        (nuevo)
PUT    /api/investigations/:id            ESAVI-INVESTGN-004   USER        (nuevo)
DELETE /api/investigations/:id            ESAVI-INVESTGN-005A  ADMIN       (nuevo)
PATCH  /api/investigations/activate/:id   ESAVI-INVESTGN-005B  SUPERADMIN  (nuevo)
DELETE /api/investigations/purge/:id      ESAVI-INVESTGN-005C  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/investigation.routes.ts`: las rutas con prefijo literal (`/admin`, `/case/:caseId`, `/activate/:id`, `/purge/:id`) van **antes** de `/:id`, o Express capturará `admin` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la misma desviación de los SPEC F05, F06, F07, F09 y F10 y por la misma razón: la investigación se captura en el mismo flujo operativo que el caso. `005A` se queda en ADMIN, y `005B` y `005C` en SUPERADMIN.

**La abreviatura es `INVESTGN`, no `INVEST`.** Las catorce satélites llegarán con abreviaturas propias, y `ESAVI-INVEST-` sería prefijo de cualquiera que empiece por `INVEST`: todo `grep` de los criterios de aceptación devolvería entidades mezcladas. Es el mismo razonamiento por el que el F10 eligió `NOTIFCN` sobre `NOTIF`.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigation` · `006` · obtener la investigación de un caso**.

### 3.5 Reglas de negocio por operación

#### Resolución del estado — compartida por `001` y `004`

Vive en el servicio y es la regla propia de la entidad:

1. Si llega `statusItemId` con un UUID, se resuelve el item: existente, `isActive: true` y perteneciente al `catalogType` de código `investigationStatus` → si no, **404** `INVESTGN_<op>_STATUS_NOT_FOUND`.
2. Si **no** llega, o llega explícitamente en `null`, se resuelve el item de `code: '0'` de ese mismo catálogo, activo.
3. Si ese item por defecto no existe o está inactivo → **500** `INVESTGN_<op>_DEFAULT_STATUS_MISSING`. No es culpa del cliente: es la precondición de despliegue de §2 sin cumplir, y merece un mensaje que lo diga en vez de un «Internal server error» opaco.

El resultado de esta resolución es un **derivado**: en el `004` entra en `candidates` **siempre**, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difiere del guardado.

#### Validación de FK — compartida por `001` y `004`

Las cuatro restantes, todas contra filas activas y **antes** del diff:

- `caseId` → `esaviCase` activo → 404 `INVESTGN_001_CASE_NOT_FOUND`. Solo en `001`: en el `004` el campo es inmutable y no se valida.
- `vaccinationSiteItemId` → `catalogItem` activo del `catalogType` de código `vaccinationSite` → 404 `INVESTGN_<op>_VACCINATION_SITE_NOT_FOUND`.
- `vaccinationHealthFacilityId` → `healthFacility` activo → 404 `INVESTGN_<op>_HEALTH_FACILITY_NOT_FOUND`.
- `vaccinationGeoLocationId` → `geoLocation` activo → 404 `INVESTGN_<op>_GEO_LOCATION_NOT_FOUND`.

Una FK que llega en `null` explícito **no se valida**: se limpia. Una FK que llega con UUID se valida aunque coincida con la guardada — es la regla de §11, independiente del diff.

#### Por operación

**`ESAVI-INVESTGN-001` — crear.** En este orden:

1. Valida `caseId`: existe y `isActive: true` → 404 `INVESTGN_001_CASE_NOT_FOUND`. Un caso retirado no se investiga.
2. Comprueba que el caso **no tenga ya investigación**, sin filtrar por `isActive` → 409 `INVESTGN_001_CASE_ALREADY_INVESTIGATED`. Es el canon de §11: la `UNIQUE` del DDL tampoco filtra por `isActive`, así que un `caseId` ocupado por una investigación desactivada **sigue ocupado**. El mensaje lleva `{{caseId}}`, porque si no el cliente ve un 409 por una fila que no puede ver.
3. Resuelve el estado con los tres pasos de arriba.
4. Valida las tres FK restantes que lleguen.
5. Normaliza: `.trim()` sobre `notes`. No hay más normalización — la entidad no tiene `code` ni `name`, así que no aplican `toConstantCase` ni `toTitleCase`.
6. Inserta con la entrada de auditoría `method: 'ESAVI-INVESTGN-001'`.

**`ESAVI-INVESTGN-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, los cinco includes de §3.7, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Cuatro filtros opcionales por query, acumulativos con `AND` y por igualdad: `caseId`, `statusItemId`, `vaccinationHealthFacilityId` y `vaccinationGeoLocationId`, todos UUID. Un filtro de FK con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma reducida de §3.7.

**`ESAVI-INVESTGN-002B` — listar, admin.** Idéntica, sin `isActive` en el `where`. Los mismos cuatro filtros.

**`ESAVI-INVESTGN-003` — obtener por ID.** `where` con `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero —hoy **SUPERADMIN**, `src/helpers/permissions.helper.ts:24-26`— → 404 `INVESTGN_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-INVESTGN-006` — obtener por caso.** Mismo servicio de lectura que `003` pero buscando por `caseId`, con los mismos includes, la misma forma completa y la misma regla de `canViewInactive`. Dos 404 distintos, y la diferencia importa para el cliente:

- El caso no existe → 404 `INVESTGN_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVESTGN_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la relación es uno a uno y envolver una ficha en una colección obligaría al cliente a desempaquetar un array de un elemento.

**`ESAVI-INVESTGN-004` — actualizar.** En este orden:

1. Existencia → 404 `INVESTGN_004_NOT_FOUND`.
2. `caseId` **se ignora siempre**, venga o no en el body. Una investigación no se traslada entre casos: sus catorce satélites futuras cuelgan de ella y el traslado dejaría el detalle clínico bajo otro paciente.
3. Resuelve el estado y valida las tres FK que lleguen. **Antes del diff y con independencia de él.**
4. `stored` sale de `investigation.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió».
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Si hay diferencias, escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `caseId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `statusItemId` | **siempre**, con el item resuelto | derivado: nunca bajo un `if` de presencia, y nunca `null` |
| `vaccinationSiteItemId` | `data.vaccinationSiteItemId !== undefined ? (data.vaccinationSiteItemId ?? null) : undefined` | anulable |
| `vaccinationHealthFacilityId` | `data.vaccinationHealthFacilityId !== undefined ? (data.vaccinationHealthFacilityId ?? null) : undefined` | anulable |
| `vaccinationGeoLocationId` | `data.vaccinationGeoLocationId !== undefined ? (data.vaccinationGeoLocationId ?? null) : undefined` | anulable |
| `hospitalizationDate` | `data.hospitalizationDate !== undefined ? (data.hospitalizationDate ?? null) : undefined` | `DATEONLY`: el helper compara con `slice(0, 10)` |
| `investigationStartDate` | `data.investigationStartDate !== undefined ? (data.investigationStartDate ?? null) : undefined` | `DATEONLY` |
| `vaccinationLatitude` | `data.vaccinationLatitude !== undefined ? (data.vaccinationLatitude ?? null) : undefined` | `DECIMAL`: vuelve de `pg` como cadena; lo resuelve la regla numérica del helper |
| `vaccinationLongitude` | `data.vaccinationLongitude !== undefined ? (data.vaccinationLongitude ?? null) : undefined` | `DECIMAL` |
| `notes` | `data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : undefined` | anulable, con `.trim()` antes de comparar |

Ningún campo va bajo un `if( data.x )`: eso descartaría en silencio el `0` de una coordenada y la cadena vacía de `notes`, y dejaría los campos anulables sin forma de vaciarse. **Ningún campo de esta entidad va cifrado.**

**`ESAVI-INVESTGN-005A` / `005B` — desactivar y reactivar.** `setInvestigationActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, calculando `const op = isActive ? '005B' : '005A'`. El `where` filtra **solo por la PK**. `DELETE` sella `deletedAt`; `PATCH /activate` lo deja en `null`. Ambos responden `{ ok, message }` sin `data`.

**No pasan por `buildDifferentialUpdate`, y es deliberado:** son escrituras con intención propia. Registran el hecho de retirar o devolver la fila aunque ningún campo de datos cambie, y ese registro en `appDetails` es precisamente lo que se quiere conservar.

Reactivar una investigación **no exige** que su caso esté activo, por la misma razón que en `notifier`, `classification` y `notification`: la cascada es solo de bajada y quien reactiva es SUPERADMIN. No puede haber conflicto con la `UNIQUE` al reactivar, porque el `caseId` nunca se liberó.

**La cascada — ampliación de `ESAVI-CASE-005A`.** Dentro de la transacción que `setEsaviCaseActivationService` ya abre, junto a las tres funciones hermanas de `src/services/esaviCase.service.ts:590-592` y **solo cuando `isActive === false`**, se añade `cascadeDeactivateInvestigation`: un `Investigation.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt`, y añade a `appDetails` una entrada con `method: 'ESAVI-CASE-005A'` —el código de la operación que la desactivó, no el suyo— reutilizando el mismo `sequelize.literal` que ya resuelve el `appDetails` heredado como objeto. Un caso sin investigación desactiva cero filas y no falla. **Tampoco es diferencial**, por lo mismo que las activaciones. `ESAVI-CASE-005B` no reactiva nada.

**`ESAVI-INVESTGN-005C` — purgar.** `purgeInvestigationService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` → 404 `INVESTGN_005C_NOT_FOUND`; la fila debe estar en `isActive: false` → si no, 409 `INVESTGN_005C_STILL_ACTIVE`; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` — la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6.

**Purgar sí libera el `caseId`**, y es la única vía que lo hace. **Advertencia para cuando lleguen las satélites:** las catorce declaran `ON DELETE CASCADE` sobre `investigationId`, así que un `005C` arrastrará consigo toda la investigación detallada sin pedir confirmación. Hoy no hay nada que arrastrar; el spec que dé de alta la primera satélite debe revisar esta operación.

**Validaciones de forma** (las emite `validateFields` con 400): `caseId` obligatorio y `.isUUID()` en create; los cuatro campos de FK con `.isUUID()` cuando lleguen; `hospitalizationDate` e `investigationStartDate` con `.isISO8601()` y no futuras vía `isNotFutureDate`; `vaccinationLatitude` y `vaccinationLongitude` con `.isDecimal({ decimal_digits: '0,7' })`; `notes` como cadena; `limit` y `offset` con `.isInt()` en el listado.

### 3.6 Claves i18n nuevas

Bloque `investigation` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

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
| `stillActive` | 409 al purgar una investigación activa. Lleva `{{id}}` |
| `caseNotFound` | 404 cuando `caseId` no existe o está inactivo, en `001` y en `006` |
| `caseAlreadyInvestigated` | 409 cuando el caso ya tiene investigación, activa o no. Lleva `{{caseId}}` |
| `statusNotFound` | 404 cuando el `statusItemId` no existe, está inactivo o no es del catálogo `investigationStatus` |
| `defaultStatusMissing` | 500 cuando el ítem `code: '0'` no está sembrado o está inactivo |
| `vaccinationSiteNotFound` | 404 cuando el `vaccinationSiteItemId` no existe, está inactivo o no es del catálogo `vaccinationSite` |
| `healthFacilityNotFound` | 404 cuando el `vaccinationHealthFacilityId` no existe o está inactivo |
| `geoLocationNotFound` | 404 cuando el `vaccinationGeoLocationId` no existe o está inactivo |

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave al bloque `esaviCase`: la cascada no produce mensajes propios.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004` y `006`:

```
{ ok, message, data: {
    investigationId, hospitalizationDate, investigationStartDate,
    vaccinationLatitude, vaccinationLongitude,
    notes, isActive, createdAt, updatedAt, deletedAt, appDetails,
    case:                      { caseId, caseCode, reportDate, eventDate },
    status:                    { catalogItemId, code, name },
    vaccinationSite:           { catalogItemId, code, name },
    vaccinationHealthFacility: { healthFacilityId, localCode, name },
    vaccinationGeoLocation:    { geoLocationId, name, level }
} }
```

`geoLocation` **no tiene columna `code`** (`esaviapp.sql:412-431`): el include reproduce el de `src/services/healthFacility.service.ts:141`.

**Reducida** — `002A` y `002B`, dentro de `{ count, rows }`: la misma forma **sin `notes` y sin `appDetails`**, y sin `createdAt`, `updatedAt` ni `deletedAt`. Las dos coordenadas **sí van**: son el dato que permite pintar el listado en un mapa sin abrir cada ficha.

`status` **nunca llega `null`** en ninguna respuesta: es la consecuencia observable de la regla de §3.5. Los otros tres includes sí, y cuando lo están se devuelven como `null`, no se omiten. `sysDetails` **nunca** se devuelve, en ninguna operación. Ninguna respuesta incluye datos de las catorce tablas satélite.

---

## 4. Plan de implementación

**Precondiciones.** Tres, antes del paso 1:

- El **SPEC F06** debe estar implementado —lo está—. `caseId` es `NOT NULL`, y la asociación, la validación de FK y la cascada necesitan el modelo `EsaviCase`.
- Debe existir el `catalogType` de código `vaccinationSite` con sus `catalogItem` activos, cargados por los endpoints ya existentes de catálogos. Sin ellos, toda alta que envíe `vaccinationSiteItemId` devuelve 404 `vaccinationSiteNotFound`.
- En bases ya cargadas, los tres `catalogItem` antiguos de `investigationStatus` deben desactivarse con `DELETE /api/catalog-items/:id`. El paso 1 los sustituye en el DDL, pero `upsertCatalogItem` no borra lo ya insertado.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Semilla del catálogo `investigationStatus`.** Sustituir las tres líneas `CALL "upsertCatalogItem"('investigationStatus', ...)` de `esaviapp.sql:1586-1588` por las seis de la tabla de §3.1, con `code` de `'0'` a `'5'` y `sortOrder` de 0 a 5. **Es la única modificación de `esaviapp.sql` de todo el spec**, y va la primera porque los tests cargan el esquema y todo paso posterior depende de que el ítem `'0'` exista.
   *Verificación:* recargar el esquema en la base de test y comprobar que `investigationStatus` devuelve seis ítems; `GET /api/catalog-items?catalogTypeId=<investigationStatus>` los lista con sus códigos numéricos; `npm test` sigue en verde, porque ninguna suite actual referencia los tres antiguos.

2. **Constantes, modelo, asociaciones y tipos.** `src/constants/investigation.constants.ts` con los tres códigos de §3.3; `src/models/investigation.model.ts` con `caseId` en `allowNull: false` y todo lo demás en `allowNull: true`, las dos coordenadas en `DataTypes.DECIMAL(10, 7)` y las dos fechas en `DataTypes.DATEONLY`; `src/models/associations/investigation.associations.ts` con los cinco `belongsTo` —`status` y `vaccinationSite` con alias distintos sobre `CatalogItem`— más el inverso `EsaviCase.hasOne(Investigation, { as: 'investigation' })`, registrado en `initModels()`; `src/types/investigation/investigation.types.ts` con `CreateInvestigationInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `Investigation.findAndCountAll({ include: ['case', 'status', 'vaccinationSite', 'vaccinationHealthFacility', 'vaccinationGeoLocation'] })` desde un script suelto devuelve filas sin error de alias duplicado; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `esaviCase`.

3. **Claves i18n.** El bloque `investigation` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las veintisiete claves.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

4. **Validadores.** `src/validators/investigation.validator.ts` con cinco arrays: `investigationIdValidator`, `investigationCaseIdValidator` (para el `param('caseId')` del `006`), `investigationListValidator` (los cuatro filtros de §3.5 más `limit` y `offset`), `createInvestigationValidator` y `updateInvestigationValidator`. Los dos de cuerpo incluyen las validaciones de forma de §3.5, con `isNotFutureDate` en las dos fechas y `.isDecimal({ decimal_digits: '0,7' })` en las dos coordenadas. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

5. **`ESAVI-INVESTGN-001` — crear.** `createInvestigationService` con los seis pasos de §3.5 en ese orden: FK del caso, unicidad del `caseId` sin filtrar por `isActive`, resolución del estado con su defecto, validación de las tres FK restantes, `.trim()` de `notes`, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un alta con solo `caseId` devuelve 201 con `status` resuelto al ítem `'0'` y los demás campos en `null`; investigar dos veces el mismo caso devuelve **409** `INVESTGN_001_CASE_ALREADY_INVESTIGATED`, y también lo devuelve si la primera está desactivada; un `caseId` inactivo devuelve **404**; un `statusItemId` de otro `catalogType` devuelve **404** `statusNotFound`; desactivar el ítem `'0'` y crear sin `statusItemId` devuelve **500** `INVESTGN_001_DEFAULT_STATUS_MISSING`; un `vaccinationHealthFacilityId` inactivo devuelve **404**; `hospitalizationDate` de mañana devuelve **400** del validador.

6. **`ESAVI-INVESTGN-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, los cuatro filtros acumulativos, los cinco includes, orden `createdAt DESC`, paginación y forma reducida de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve investigaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?statusItemId=` de un UUID inexistente devuelve **200** con `count: 0`; los cuatro filtros combinados se aplican con `AND`; toda fila trae las dos coordenadas y ninguna trae `notes`, `appDetails` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total.

7. **`ESAVI-INVESTGN-003` — obtener por ID.** `getInvestigationByIdService(id, lang, includeInactive)` con los cinco includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una investigación desactivada devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; `status` nunca llega `null`; los otros tres includes vacíos llegan como `null` y no se omiten; `sysDetails` no aparece.

8. **`ESAVI-INVESTGN-006` — obtener por caso.** `getInvestigationByCaseIdService(caseId, lang, includeInactive)` con los dos 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `investigationCaseIdValidator`, declarada antes de `/:id`. Fila `investigation` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación devuelve 200 con la ficha completa, no envuelta en un array; un caso sin investigación devuelve 404 `INVESTGN_006_NOT_FOUND`; un `caseId` inexistente devuelve 404 `INVESTGN_006_CASE_NOT_FOUND` — un código distinto del anterior; un caso cuya investigación está inactiva devuelve 404 para USER y 200 para SUPERADMIN; `GET /case/no-es-uuid` devuelve 400.

9. **`ESAVI-INVESTGN-004` — actualizar, diferencial.** `updateInvestigationService` con los seis pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `caseId` ignorado; `statusItemId` como derivado que entra siempre; los ocho campos restantes comparados contra `undefined`, no por veracidad. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; enviar `caseId` no lo modifica y no devuelve error; `statusItemId: null` deja el estado en el ítem `'0'`, no en `null`; `vaccinationLatitude: 0` se guarda como `0` y no se descarta; `notes: ""` vacía el campo; un `vaccinationGeoLocationId` inactivo devuelve **404** aunque el resto del body no cambie nada.

10. **`ESAVI-INVESTGN-005A` y `005B` — desactivar y reactivar.** `setInvestigationActivationService` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El `where` filtra solo por la PK. Dos controladores y dos rutas: `DELETE /:id` en ADMIN, `PATCH /activate/:id` en SUPERADMIN, ambas respondiendo sin `data`.
    *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve 409 `INVESTGN_005A_ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe 403 en `PATCH /activate/:id`; reactivar una investigación cuyo caso está inactivo devuelve **200**; tras desactivar, `POST` sobre el mismo caso sigue devolviendo **409**, no 201.

11. **`ESAVI-INVESTGN-005C` — purgar.** `purgeInvestigationService` sobre `purgeEntityService`, con transacción propia. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `investigationIdValidator` y declarada junto a las otras literales.
    *Verificación:* purgar una investigación activa devuelve 409 `INVESTGN_005C_STILL_ACTIVE` y la fila sigue ahí; desactivarla y purgarla devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre el mismo caso devuelve 201**: es la única vía que libera el `caseId`; el caso al que pertenecía sigue existiendo e intacto.

12. **La cascada — ampliar `ESAVI-CASE-005A`.** Cuarta función hermana `cascadeDeactivateInvestigation` junto a las tres de `src/services/esaviCase.service.ts:404-473`, invocada en el mismo bloque de las líneas 590-592, dentro de la misma transacción y **solo cuando `isActive === false`**. `Investigation.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt` y añade la entrada con `method: 'ESAVI-CASE-005A'`, reutilizando el mismo `sequelize.literal` de `appDetails`. Este paso va el último de los de código porque depende del modelo del paso 2 y no lo necesita ningún paso anterior.
    *Verificación:* desactivar un caso con investigación, notificación, clasificación y notificadores activos los deja **todos** inactivos con `deletedAt` sellado; reactivar el caso no reactiva ninguno; desactivar un caso sin investigación responde 200 sin error; desactivar un caso ya inactivo devuelve 409 y **nada** cambia de estado; una investigación que ya estaba inactiva conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; el `appDetails` de la arrastrada registra `ESAVI-CASE-005A`.

13. **Registrar la entidad en las convenciones.** Fila `investigation` → `INVESTGN` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigation` · `006` · «obtener la investigación de un caso» en la tabla de operaciones no canónicas.
    *Verificación:* `INVESTGN` aparece una sola vez y no colisiona con las veintiocho existentes; la tabla de no canónicas suma exactamente una fila.

14. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más nueve.
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/investigation.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → desactivar → reactivar → purgar. Más los caminos de error: `caseId` inexistente (404), `caseId` inactivo (404), caso ya investigado activo e inactivo (409 los dos), `statusItemId` de otro catálogo (404), `vaccinationSiteItemId` de otro catálogo (404), `vaccinationHealthFacilityId` inactivo (404), `vaccinationGeoLocationId` inactivo (404), fechas futuras (400), coordenada con ocho decimales (400). Y el bloque diferencial completo de §5, que es la parte no negociable de esta suite.
    *Verificación:* `npm test -- investigation` en verde.

16. **Ampliar `tests/contract/esaviCase.test.ts` con la cascada.** Tres casos nuevos sobre la suite ya existente: desactivar un caso arrastra su investigación activa; reactivarlo no la devuelve; una investigación desactivada a mano antes de la cascada conserva su estado y su `deletedAt`. Los casos de `notifier`, `classification` y `notification` se mantienen intactos.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVESTGN-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVESTGN-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "ESAVI-INVEST-" src/` no devuelve resultados: la abreviatura es `INVESTGN`.
- [ ] `INVESTGN` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigation` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` está presente.
- [ ] `GET /api/investigations/admin` y `GET /api/investigations/case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `EsaviCase.hasOne(Investigation)` está declarado, e `investigation` **no** aparece en ninguna respuesta de `/api/esavi-cases`.
- [ ] `grep -n "'investigationStatus'\|'vaccinationSite'\|'0'" src/services/investigation.service.ts` no devuelve los tres literales: viven en `src/constants/investigation.constants.ts`.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigation.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada.
- [ ] Un `PUT` con `vaccinationLatitude: 0` guarda `0`, y otro con `notes: ""` deja el campo vacío: ningún candidato entra bajo un `if( data.x )`.
- [ ] Reenviar la misma `vaccinationLatitude` que devolvió el `GET` **no** cuenta como cambio, pese a que `pg` la entrega como cadena y el body la manda como número.
- [ ] Reenviar la misma `hospitalizationDate` que devolvió el `GET` **no** cuenta como cambio.

**Estado de la investigación**

- [ ] Un alta sin `statusItemId` guarda el ítem de `code: '0'` del catálogo `investigationStatus`, y la respuesta lo devuelve resuelto.
- [ ] Un `PUT` con `statusItemId: null` deja el estado en ese mismo ítem, **nunca** en `null`.
- [ ] Ninguna respuesta de ninguna operación devuelve `status: null`.
- [ ] Un `statusItemId` que no existe, está inactivo o pertenece a otro `catalogType` → **404** `statusNotFound`.
- [ ] Con el ítem `code: '0'` desactivado, un alta sin `statusItemId` → **500** `INVESTGN_001_DEFAULT_STATUS_MISSING`, con su mensaje propio y no con `'Internal server error'` en `NODE_ENV=development`.
- [ ] `investigationStatus` tiene exactamente seis ítems tras cargar `esaviapp.sql`, con `code` de `'0'` a `'5'`.
- [ ] La única diferencia de `git diff esaviapp.sql` son las líneas de semilla de `investigationStatus`: ni un `CREATE TABLE`, ni un índice, ni un trigger modificado.

**Uno a uno**

- [ ] `POST` sobre un caso que ya tiene investigación **activa** devuelve **409** `caseAlreadyInvestigated`, con el `caseId` interpolado en el mensaje.
- [ ] `POST` sobre un caso cuya investigación está **inactiva** devuelve también **409**: el hueco no se libera con el borrado lógico.
- [ ] Purgar la investigación con `005C` libera el `caseId`, y un `POST` posterior sobre ese caso devuelve **201**.
- [ ] Enviar `caseId` en el body de `PUT /:id` deja el caso original intacto y no devuelve error.
- [ ] Ningún `INSERT` llega a Postgres con el `caseId` ocupado: la suite no produce ningún error `23505`.

**FK y validación de forma**

- [ ] Cada una de las cuatro FK inexistente o inactiva devuelve **404** con un código de `AppError` distinto de las otras tres.
- [ ] Un `vaccinationSiteItemId` de un `catalogType` distinto de `vaccinationSite` devuelve **404**, no 200.
- [ ] `hospitalizationDate` o `investigationStartDate` posteriores a hoy → **400**, emitido por el validador.
- [ ] `vaccinationLatitude` con ocho decimales → **400**, no un error de Postgres.
- [ ] No se valida ninguna relación entre las dos fechas ni contra `esaviCase.eventDate`: enviar una hospitalización anterior al evento devuelve **201**.

**Acceso por caso (`006`)**

- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`.
- [ ] Un caso inexistente devuelve **404** `INVESTGN_006_CASE_NOT_FOUND`; un caso sin investigación devuelve **404** `INVESTGN_006_NOT_FOUND`. Los dos códigos son distintos.
- [ ] Un caso cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN.

**Ciclo de vida y cascada**

- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` sellado; `PATCH /activate/:id` devuelve `deletedAt` a `null`.
- [ ] Repetir cualquiera de los dos devuelve **409** `alreadyInactive` / `alreadyActive`.
- [ ] Purgar una investigación activa devuelve **409** `stillActive` y la fila sigue existiendo.
- [ ] Desactivar un caso arrastra su investigación activa junto a sus otros tres satélites, en la misma transacción.
- [ ] Reactivar el caso **no** reactiva la investigación.
- [ ] La investigación arrastrada registra `method: 'ESAVI-CASE-005A'` en `appDetails`, y su historial anterior queda intacto.
- [ ] Una investigación ya inactiva antes de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.

**Listados y respuesta**

- [ ] Los cuatro filtros de §3.5 se combinan con `AND` y son por igualdad.
- [ ] Un filtro de FK con un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`.
- [ ] Las filas del listado traen las dos coordenadas y no traen `notes`, `appDetails`, `createdAt`, `updatedAt` ni `deletedAt`.
- [ ] `sysDetails` no aparece en ninguna respuesta de ninguna operación.
- [ ] Ninguna respuesta incluye datos de las catorce tablas satélite.

**Cierre**

- [ ] Las veintisiete claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` cubre las nueve rutas nuevas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** abreviatura `INVESTGN`. **No:** `INVEST`, que sería prefijo de cualquier abreviatura futura de las catorce satélites que empiece por esas seis letras, y haría que los `grep` de los criterios de aceptación devolvieran entidades mezcladas. Es la lección que dejó el F10 al elegir `NOTIFCN` sobre `NOTIF`.
- **Sí:** solo la tabla raíz. **No:** implementar el bloque de investigación completo. Son quince tablas: un spec así no lo ejecuta nadie, y el mismo criterio se aplicó al F10 con las ocho satélites de `notification`.
- **Sí:** `statusItemId` contra el `catalogType` de código `investigationStatus`. **No:** contra `outcome`, que se valoró en la ronda de preguntas. `outcome` ya lo consume `notification.outcomeItemId` con la semántica de desenlace del paciente, y compartirlo haría que un mismo `catalogItem` significara dos cosas distintas según la tabla que lo referencie. La FK del DDL se llama `FK_investigation_status` y el catálogo ya existía sembrado: se respeta esa lectura del esquema.
- **Sí:** sustituir las tres líneas de semilla de `investigationStatus` por las seis aprobadas. **No:** dejar `esaviapp.sql` intacto y cargar los seis solo por endpoint. Es la primera vez que un spec toca ese archivo, y la excepción se acota a tres `CALL "upsertCatalogItem"(...)` sin una línea de DDL. La alternativa dejaba el esquema sembrando en cada carga tres valores que el spec declara muertos, incluidos los entornos de test que se recrean desde cero.
- **No:** borrar los tres antiguos desde el propio `esaviapp.sql`. `upsertCatalogItem` no borra, y añadir un `DELETE` al esquema alcanzaría filas ya referenciadas por otras tablas. Retirarlos es una operación de datos por el endpoint de desactivación, declarada como precondición de despliegue.
- **Sí:** `statusItemId` nunca en `null`, con el ítem `'0'` como defecto y tratado como derivado. **No:** anulable normal. Una investigación sin estado no es consultable, y si el alta nunca lo deja vacío el update tampoco debería poder vaciarlo. Es el mismo criterio que el F10 fijó para `requestInvestigation`.
- **Sí:** **500** cuando el ítem `'0'` no está sembrado. **No:** 404 reutilizando `statusNotFound`, ni 400. El cliente no mandó nada mal: falta una precondición del servidor, y un 4xx haría que se buscara el error en el body durante horas. La clave `defaultStatusMissing` existe precisamente para que el mensaje diga qué falta.
- **Sí:** los tres códigos de catálogo en `src/constants/investigation.constants.ts`. **No:** literales en el servicio. Son el acoplamiento del spec con datos que viven fuera del esquema, y el `grep` del criterio de aceptación solo puede verificarlos si están en un único sitio.
- **Sí:** `caseId` inmutable en el `004`, ignorado en silencio y sin 400. **No:** permitir el traslado entre casos. Las catorce satélites futuras cuelgan de `investigationId`, y mover la raíz llevaría el detalle clínico de un paciente al expediente de otro. Si alguna vez hace falta, es una operación no canónica propia con su transacción, no un `PUT`.
- **Sí:** uno a uno con 409 y hueco que no se libera con el borrado lógico. Es el mismo criterio de F09 y F10, y por el mismo motivo: la `UNIQUE` del DDL tampoco filtra por `isActive`.
- **Sí:** sumarse a la cascada de `ESAVI-CASE-005A` como cuarta función hermana. **No:** ampliar `cascadeDeactivateNotifiers` ni fundir las cuatro en una. Funciones separadas dejan cada satélite aislado, que es lo que permitió que F09 y F10 tocaran el mismo bloque sin colisionar. **No:** cascada de subida en `005B`: F07 fijó el criterio y ya lo heredan tres entidades.
- **Sí:** las dos coordenadas en la forma reducida del listado. **No:** omitirlas como se omite `notes`. Son el dato que permite pintar el listado en un mapa sin abrir cada ficha, que es el uso previsible de un listado de investigaciones.
- **Sí:** validar solo que las dos fechas no sean futuras. **No:** exigir que `investigationStartDate` sea posterior a `hospitalizationDate`, ni contrastarlas con `esaviCase.eventDate`. Lo primero supone un orden que el dominio no garantiza —se puede investigar antes de que haya hospitalización—; lo segundo exige una lectura extra en el servicio para una regla que nadie pidió. Los dos quedan en §7.
- **No:** crear la investigación automáticamente cuando `notification.requestInvestigation` es `true`. Habría que decidir qué ocurre cuando ese campo vuelve a `false`, y ninguna respuesta es buena: borrar la investigación destruye trabajo, y dejarla contradice el campo.
- **No:** ninguna regla cruzada entre el estado `5` («Fallecido») y el desenlace `DEATH` de `notification`. Son dos catálogos distintos que hoy nadie garantiza alineados, y atar las dos entidades merece su propio spec.
- **No:** cifrar ningún campo. Las coordenadas son del punto de vacunación, no del domicilio del paciente, y el paciente ya está cifrado en su propia tabla.
- **No:** retirar el `IX_investigation_case` redundante. El índice de más cuesta escrituras marginales y no rompe nada; el spec ya gasta su excepción de `esaviapp.sql` en la semilla.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Las bases ya cargadas conservan `NOT_STARTED`, `IN_PROGRESS` y `CLOSED` activos en `investigationStatus` junto a los seis nuevos, y un cliente puede guardarlos como estado válido | La desactivación de los tres es precondición de despliegue declarada en §2 y en el plan. **No hay mitigación en código:** el servicio valida contra el `catalogType`, no contra una lista cerrada de códigos, y no puede distinguir un ítem legítimo de uno heredado |
| Los seis valores aprobados son semánticamente el desenlace del paciente —recuperado, con secuelas, fallecido—, no el avance de la investigación, pese a vivir en un catálogo llamado `investigationStatus` | Decisión de dominio del usuario, tomada de forma explícita en la ronda de preguntas. Queda registrada aquí para que quien lea la tabla dentro de un año no la interprete como un error de carga |
| Un mismo hecho puede quedar contradicho entre `investigation.statusItemId` = `5` («Fallecido») y `notification.outcomeItemId` ≠ `DEATH` | Sin mitigación en este spec. La coherencia entre los dos catálogos merece su propio spec, con la decisión previa de cuál de los dos manda |
| El `catalogType` de código `vaccinationSite` no sembrado convierte todo `vaccinationSiteItemId` en un 404 | Es precondición declarada en §2 y en el plan de implementación; el mensaje `vaccinationSiteNotFound` no distingue el caso, y esa ambigüedad se acepta a cambio de no añadir una clave más |
| El ítem `code: '0'` desactivado por error deja **toda** alta sin `statusItemId` devolviendo 500 | Es el comportamiento buscado, no un fallo: el 500 lleva clave propia (`defaultStatusMissing`) y nombra la causa. El riesgo real es que nadie lo note hasta el primer alta, y por eso el criterio de aceptación lo verifica explícitamente |
| `GET /:id` captura `/admin` o `/case` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato y por un criterio de aceptación explícito |
| `investigationStartDate` anterior a `hospitalizationDate`, o cualquiera de las dos anterior al `eventDate` del caso | Solo se valida que no sean futuras. Las comprobaciones cruzadas quedan fuera de alcance; el dato es corregible por `PUT` |
| `005C` sobre una investigación con satélites arrastrará **catorce** tablas por `ON DELETE CASCADE` sin avisar | Hoy no hay satélites implementadas y no hay filas que arrastrar. El spec que dé de alta la primera debe revisar esta operación; queda escrito en §3.5 y es la advertencia más grande del spec |
| El `PUT` es la operación principal de la entidad —todas las columnas son anulables— y un fallo del diferencial ensuciaría `appDetails` y `sysDetails` en cada apertura de formulario | Los ocho criterios del bloque diferencial de §5 son la cobertura; el corte temprano cuando el diff vuelve vacío es la única línea de control que le queda al servicio |
| Este spec y cualquier otro hermano editan el mismo bloque de `esaviCase.service.ts` y el mismo total de `ROUTE_RULES` | El paso 12 aísla la cascada en una cuarta función hermana en vez de ampliar las existentes, para que los cambios no colisionen |

---

## 8. Impacto en el contrato HTTP

El spec añade nueve rutas nuevas y **no cambia la forma** de ninguna respuesta existente. Cambia dos comportamientos ya observables:

**`DELETE /api/esavi-cases/:id` (`ESAVI-CASE-005A`) pasa a desactivar también la investigación activa del caso.** El status, el mensaje y el cuerpo de la respuesta son idénticos; lo que cambia es el efecto sobre otras filas. Un cliente que desactive un caso y consulte después `GET /api/investigations/case/:caseId` recibirá 404 donde antes —si la entidad hubiera existido— habría recibido 200.

**El contenido del catálogo `investigationStatus` cambia.** `GET /api/catalog-items` filtrado por ese `catalogType` devolvía tres ítems con `code` en `CONSTANT_CASE` —`NOT_STARTED`, `IN_PROGRESS`, `CLOSED`— y pasa a devolver seis con `code` numérico de `'0'` a `'5'`. Ningún endpoint del repositorio los consumía todavía, así que no rompe a ningún cliente actual; pero es un cambio de datos visible por API, y por eso se declara aquí y no solo en §3.1. En bases ya cargadas los nueve conviven hasta que se ejecute la precondición de despliegue de §2.

`GET /api/esavi-cases` y `GET /api/esavi-cases/:id` **no** incluyen la investigación en su `data`: la asociación `hasOne` se declara pero no se usa en ninguna respuesta de aquella entidad.

---

## Lo que **no** está en este spec

- Las catorce tablas satélite de `investigation`: `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationCovidHistory`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `evaluationInstitution`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- `finalClassification`, la quinta satélite de `esaviCase`.
- Crear la investigación automáticamente cuando `notification.requestInvestigation` es `true`.
- Cualquier regla cruzada contra `notification` o `classification`, incluida la coherencia entre el estado `5` («Fallecido») y el desenlace `DEATH`.
- Trasladar una investigación de un caso a otro.
- Validar las dos fechas entre sí o contra `esaviCase.eventDate`.
- Búsqueda por texto sobre `notes`, filtros por rango de fechas y búsqueda geográfica por proximidad de coordenadas.
- Sembrar el `catalogType` de código `vaccinationSite`, y desactivar los tres ítems antiguos de `investigationStatus` en bases ya cargadas: son precondiciones de despliegue, no implementación.
- Cualquier modificación de `esaviapp.sql` que no sean las tres líneas de semilla de `investigationStatus`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
