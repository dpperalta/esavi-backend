# Convenciones de código — esavi-backend

Norma vinculante para todo código nuevo de este repositorio, sea escrito por una persona o generado por un modelo de IA.

**Idioma**: este documento está en español. **Todo el código va en inglés**: nombres de archivo, identificadores, comentarios, claves i18n y mensajes de error. Sin excepciones y sin tildes en identificadores.

Las desviaciones que hoy existen en `src/` están catalogadas en [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md). No son precedente: si un archivo existente contradice este documento, manda este documento.

---

## 1. Regla de oro

Un endpoint nuevo **siempre** genera siete artefactos, en este orden. Ninguno es opcional.

| # | Artefacto | Ubicación |
|---|---|---|
| 1 | Modelo | `src/models/<entidad>.model.ts` |
| 2 | Asociaciones | `src/models/associations/<dominio>.associations.ts` |
| 3 | Tipos | `src/types/<dominio>/<entidad>.types.ts` |
| 4 | Validadores | `src/validators/<entidad>.validator.ts` |
| 5 | Servicio | `src/services/<entidad>.service.ts` |
| 6 | Controlador | `src/controllers/<entidad>.controller.ts` |
| 7 | Ruta | `src/routes/<entidad>.routes.ts` |

Más dos registros obligatorios en el mismo commit:

- Claves i18n en **los tres** archivos: `src/data/i18n/es.json`, `en.json`, `nl.json`.
- Alta de la ruta en `src/routes/index.ts` y de los barrels correspondientes (`validators/index.ts`, `types/<dominio>/index.ts`, `models/index.ts`).

Entregar un endpoint sin validador, sin claves i18n o sin tipos no es "un endpoint incompleto": es un endpoint que no se acepta.

---

## 2. Flujo y responsabilidades

```
routes → middlewares → controller → service → model
```

| Capa | Sí hace | No hace |
|---|---|---|
| **Route** | Compone la cadena de middlewares y declara el rol requerido | Lógica |
| **Controller** | Lee `req.params`/`req.query`/`req.body`, llama a **un** servicio, arma la respuesta | Tocar modelos de Sequelize. Autorizar. Reglas de negocio |
| **Service** | Reglas de negocio, acceso a Sequelize, lanza `AppError` | Conocer `Request`/`Response`. Devolver payloads HTTP |
| **Model** | Definición de tabla y tipos | Lógica de negocio. Asociaciones (van en `associations/`) |

Un controlador que llama a `CatalogItem.findOne()` está mal. Un servicio que recibe `req` está mal.

---

## 3. Nomenclatura de archivos

Sufijo obligatorio por carpeta. **Plural donde el canon lo indica** — es la fuente de la mitad de las desviaciones actuales:

| Carpeta | Sufijo | Ejemplo |
|---|---|---|
| `routes/` | `.routes.ts` | `catalogItem.routes.ts` |
| `controllers/` | `.controller.ts` | `catalogItem.controller.ts` |
| `services/` | `.service.ts` | `catalogItem.service.ts` |
| `models/` | `.model.ts` | `catalogItem.model.ts` |
| `models/associations/` | `.associations.ts` | `catalog.associations.ts` |
| `validators/` | `.validator.ts` | `catalogItem.validator.ts` |
| `types/<dominio>/` | `.types.ts` | `catalogItem.types.ts` |
| `helpers/` | `.helper.ts` | `crypto.helper.ts` |
| `middlewares/` | `.middleware.ts` | `tokenValidation.middleware.ts` |
| `constants/` | `.constants.ts` | `roles.constants.ts` |

Reglas adicionales:

- La base del nombre va en **camelCase** y coincide exactamente con la entidad: `catalogItem`, no `catalog-item` ni `CatalogItem` ni `catalog_item`.
- Los tipos viven **siempre** en una subcarpeta de dominio (`types/catalog/`, `types/geography/`, `types/user/`, `types/common/`). Nunca sueltos en la raíz de `types/`.
- Los nombres de subcarpeta de dominio son **sustantivos en singular**: `catalog/`, `user/`, `common/`. No adjetivos.

---

## 4. Nomenclatura de símbolos

**camelCase** para variables y funciones · **PascalCase** para clases, interfaces y tipos · **SCREAMING_SNAKE_CASE** para constantes de módulo.

| Capa | Patrón | Ejemplo |
|---|---|---|
| Controller | `verbEntity` — **sin** sufijo | `createCatalogItem`, `getCatalogItemById` |
| Service | `verbEntityService` | `createCatalogItemService` |
| Service (activación) | `setEntityActivationService` | `setCatalogItemActivationService` |
| Validator (id) | `entityIdValidator` | `catalogItemIdValidator` |
| Validator (create) | `createEntityValidator` | `createCatalogItemValidator` |
| Validator (update) | `updateEntityValidator` | `updateCatalogItemValidator` |
| Tipo de entrada | `CreateEntityInput` | `CreateCatalogItemInput` |
| Modelo | `PascalCase` singular | `CatalogItem` |
| Asociaciones | `initDomainAssociations` | `initCatalogAssociations` |
| Router | **siempre** `router` | `const router = Router();` |

Reglas duras:

- Los **tres** validadores (`id`, `create`, `update`) son obligatorios por entidad, aunque un endpoint todavía no los use todos.
- **No se declara `UpdateEntityInput`.** El update usa `Partial<CreateEntityInput>`. Declararlo y no usarlo es lo que dejó a `UpdateGeoLevelTypeInput` como código muerto.
- Un controlador nunca lleva el sufijo `Controller`.
- El acrónimo va en camelCase normal: `geoLocationId`, no `geoLocationID`.

---

## 5. Estilo de exportación

| Capa | Estilo |
|---|---|
| Controllers, services, middlewares con lógica | `const x = ...` y **bloque `export { ... }` al final** |
| Validators, types, models, associations, constants | `export const` / `export interface` / `export class` **inline** |
| Routes | `export default router;` |

Ejemplo del bloque final (controllers y services):

```ts
const createCatalogItem = async (...) => { ... }
const getCatalogItemById = async (...) => { ... }

export {
    createCatalogItem,
    getCatalogItemById
}
```

El bloque va siempre multilínea, un símbolo por línea, aunque sea uno solo. Los barrels (`index.ts`) usan `export * from './x'` de forma uniforme — no se mezcla con re-export nominal.

---

## 6. Códigos de operación `ESAVI-*`

Cada endpoint tiene un código. Es el hilo que permite rastrear una petición desde la ruta hasta el log.

### Formato

```
ESAVI-<ENTIDAD>-<NNN>[A|B|C]
```

### Numeración — fija por operación, no negociable

| Código | Operación | HTTP | Ruta | Status éxito |
|---|---|---|---|---|
| `001` | create | POST | `/` | 201 |
| `002` | list | GET | `/` | 200 |
| `002A` | list público (solo activos) | GET | `/` | 200 |
| `002B` | list admin (incluye inactivos) | GET | `/admin` | 200 |
| `003` | getById | GET | `/:id` | 200 |
| `004` | update | PUT | `/:id` | 200 |
| `005A` | soft delete | DELETE | `/:id` | 200 |
| `005B` | activate | PATCH | `/activate/:id` | 200 |
| `005C` | borrado físico | DELETE | `/purge/:id` | 200 |

`002` sin letra cuando hay un solo listado; `002A`/`002B` cuando existen ambas variantes. Los sufijos `A`/`B`/`C` **solo** distinguen variantes de la misma operación, nunca operaciones distintas.

### Más allá de `005B` — operaciones no canónicas

El rango `001`–`005B` cubre las operaciones canónicas de un CRUD y **no se estira con letras** para meter otra cosa. Una operación que no sea ninguna de las siete recibe un número propio a partir de `006`, registrado aquí.

| Entidad | Código | Operación |
|---|---|---|
| appUserGeoLocation | `006` | reasignar — cierra la asignación origen y abre la del destino, transaccional |
| appUserGeoLocation | `007` | asignación masiva — un usuario a varias geolocalizaciones, todo o nada |
| appUserGeoLocation | `008` | cobertura efectiva — asignaciones vigentes más sus descendientes |
| appUserRole | `006` | listar por rol — quiénes tienen asignado un rol concreto |
| appUserRole | `007` | asignación masiva — varios roles a un usuario, todo o nada |
| appUser | `006` | cambiar la propia contraseña — actúa siempre sobre el usuario del token |
| appUser | `007` | consultar el propio perfil — la ficha del usuario del token |
| patient | `006` | búsqueda por identificador — documento, pasaporte o código de sistema |
| classification | `006` | obtener la clasificación de un caso — la relación es uno a uno y se entra por el `caseId` |
| notification | `006` | obtener la notificación de un caso — la relación es uno a uno y se entra por el `caseId` |
| severeNotification | `006` | obtener el detalle grave de un caso — la cadena `caso → notificación → detalle` es uno a uno en los dos saltos |
| nonSevereNotification | `006` | obtener el detalle no grave de un caso — la cadena `caso → notificación → detalle` es uno a uno en los dos saltos |

`appUserGeoLocation` es la primera entidad del repositorio que pasa de `005B`. Esconder una reasignación tras una letra de `004` haría que un `PUT` a veces creara registros, y el código de operación dejaría de servir para rastrear qué se intentó.

### Listado dual — un `GET /` que se bifurca en dos servicios

Cuando hay **una sola ruta** `GET /` que, según el rol de quien pide, llama a un servicio u otro (público solo-activos frente a admin con inactivos), la numeración es:

- **Ruta:** `002`, sin letra. El código de la ruta describe el endpoint, y endpoint hay uno.
- **Controlador:** `002`, sin letra. Es el que elige la rama con el predicado de permisos (`canViewInactive(...)`, `isSuperAdmin(...)`).
- **Servicios:** `002A` para la variante pública y `002B` para la de administración. Los sufijos describen las dos variantes del servicio, que sí son dos.

```ts
// routes/geoLevelType.routes.ts
// Code: ESAVI-GEOTYPE-002
router.get('/', tokenValidation, validateUserRole(USER), ...listValidator, validateFields, getGeoLevelTypes);

// controllers/geoLevelType.controller.ts
// Code: ESAVI-GEOTYPE-002
const data = isSuperAdmin(req.user as AuthUser)
    ? await getAllGeoLevelTypesService(limit, offset)     // ESAVI-GEOTYPE-002B
    : await getActiveGeoLevelTypesService(limit, offset); // ESAVI-GEOTYPE-002A
```

Esto **no** contradice la fila `002A`/`002B` de la tabla: allí son dos rutas distintas (`/` y `/admin`), como en `catalogItem`, y entonces cada ruta lleva su propia letra. La diferencia está en cuántas rutas existen, no en cuántos servicios.

### El mismo código en cinco lugares

Un código de operación aparece en cinco sitios y **debe ser idéntico en los cinco**. Ésta es la regla que más se ha roto:

1. Comentario de la ruta — `// Code: ESAVI-CATITEM-001`
2. Comentario del controlador — `// Code: ESAVI-CATITEM-001`
3. Comentario del servicio — `// ESAVI-CATITEM-001 - Create Catalog Item Service`
4. Código de `AppError` — `'CATITEM_001_CREATION_FAILED'`
5. `appDetails.method` de la auditoría — `'ESAVI-CATITEM-001'`

Que `003` sea "getById" en la ruta y "update" en el servicio de la misma entidad hace el código de operación inútil para rastrear nada.

### Código de `AppError`

Formato paralelo, con guion bajo y **sin** el prefijo `ESAVI-`:

```
<ENTIDAD>_<NNN>_<ACCION>
```

`CATITEM_001_CREATION_FAILED`, `CATITEM_003_NOT_FOUND`, `CATITEM_005B_ACTIVATION_FAILED`. Acciones estándar: `CREATION_FAILED`, `FETCH_FAILED`, `UPDATE_FAILED`, `DELETE_FAILED`, `ACTIVATION_FAILED`, `PURGE_FAILED`, `NOT_FOUND`, `CODE_EXISTS`, `ALREADY_ACTIVE`, `ALREADY_INACTIVE`, `STILL_ACTIVE`, `<FK>_NOT_FOUND`.

### Sufijo de activación — `005A` / `005B`

El servicio de activación es uno solo y atiende las dos operaciones, así que el número **no** se escribe fijo: se calcula al entrar y se usa en los tres sitios donde aparece.

```ts
// ESAVI-CATTYPE-005A / 005B - Setting Catalog Type Active/Inactive Service - For SuperAdmin
const setCatalogTypeActivationService = async (id, authUser?, lang = 'en', isActive = true) => {
    const op = isActive ? '005B' : '005A';
    ...
    notFoundCode: `CATTYPE_${ op }_NOT_FOUND`,
    alreadyInStateCode: `CATTYPE_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
    appDetail: {
        ...
        method: `ESAVI-CATTYPE-${ op }`,
    }
}
```

El sufijo va también en el código del `AppError`: `CATTYPE_005_NOT_FOUND` no distingue un borrado de una activación, y el valor de un código de operación es poder buscarlo en el log y saber exactamente qué se intentó.

`appDetails.method` guarda el código y **solo** el código: nunca `_ACTIVATION` ni `_DEACTIVATION` pegados detrás. Esos sufijos describen el resultado, no la operación, y rompen la búsqueda por código en la auditoría.

### Borrado físico — `005C`

`005A` retira una fila; `005C` la destruye. Es la única operación irreversible del repositorio, y por eso es la más reglada.

**`005C` es una variante de `005`, no una operación nueva.** Por eso lleva letra y no un número desde `006`: los sufijos `A`/`B`/`C` distinguen variantes de la misma operación, y las tres son formas de borrar o de deshacer el borrado. Numerarla `006` la habría dejado con un número distinto en cada entidad —`006` en `notifier`, `009` en `appUserGeoLocation`— y el mismo concepto sería imposible de buscar de forma uniforme en el log.

**Regla de disponibilidad.** Una entidad expone `005C` **si y solo si** su tabla **no** figura en el bucle `preventPhysicalDelete` de `esaviapp.sql:1354-1360`. La regla es objetiva y se verifica contra el DDL, no se decide por entidad. En las 18 tablas protegidas el endpoint **no se declara**: el trigger rechazaría el `DELETE` en la base y el cliente recibiría un 500 por una operación que la norma nunca debió ofrecer.

Protegidas, y por tanto **sin** `005C` — `catalogType`, `catalogItem`, `geoLevelType`, `geoLocation`, `healthFacility`, `diagnosticTerm`, `vaccineWhodrug`, `diluentCatalog`, `patient`, `esaviCase`, `appUser`, `appRole`, `appPermission`, `appUserRole`, `appRolePermission`, `appSession`, `systemConfig`, `systemConfigHistory`.

Habilitadas, y por tanto **con** `005C` — las 27 restantes:

| Dominio | Tablas |
|---|---|
| Auth | `appUserGeoLocation` |
| Núcleo ESAVI | `notifier`, `classification`, `finalClassification` |
| Notificación | `notification`, `severeNotification`, `nonSevereNotification`, `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy`, `notificationPregnancyComplication` |
| Investigación | `investigation`, `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationCovidHistory`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `evaluationInstitution`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError`, `investigationCommunity` |

**Contrato de la operación.** Rol **SUPERADMIN**, uno solo. Ruta `DELETE /purge/:id`, literal declarado **antes** de `/:id` como `/activate/:id`. Responde 200 con `{ ok, message }` **sin `data`**: no queda nada que devolver.

La fila debe estar ya en `isActive: false`. Purgar una fila activa devuelve **409**, no 200: el borrado físico solo alcanza a lo que alguien retiró antes de forma deliberada y reversible. Son dos pasos y eso es la red de seguridad, no una molestia.

**Aviso de cascada.** El `ON DELETE CASCADE` del DDL **sí dispara** en las tablas sin protección, porque no hay trigger que impida el borrado físico. Purgar una fila de `investigation` destruye sus **14** tablas satélite; purgar una de `notification` destruye las **8** suyas. La norma avisa y no lo bloquea: es el comportamiento declarado del esquema, y quien tiene SUPERADMIN puede provocarlo también por SQL directo. Las demás habilitadas no tienen hijos.

**Ésta es la única operación del repositorio donde el código no aparece en los cinco lugares, sino en cuatro.** El quinto es `appDetails.method`, y aquí no existe: la fila se destruye en la misma transacción, así que escribir auditoría dentro de ella es trabajo que se borra a sí mismo. El rastro va al log, en nivel `warn`, con el volcado de la fila completa antes del `destroy` (ver §11). El checklist de §15 no debe marcar esa ausencia como incumplimiento.

### Abreviaturas registradas

| Entidad | Abreviatura |
|---|---|
| appRole | `APPROLE` |
| appUserGeoLocation | `USERGEO` |
| appUserRole | `USERROLE` |
| catalogItem | `CATITEM` |
| catalogType | `CATTYPE` |
| classification | `CLASSIF` |
| esaviCase | `CASE` |
| geoLevelType | `GEOTYPE` |
| geoLocation | `GEOLOC` |
| healthFacility | `HFAC` |
| nonSevereNotification | `NSEVNOT` |
| notification | `NOTIFCN` |
| notifier | `NOTIFIER` |
| patient | `PATIENT` |
| severeNotification | `SEVNOT` |
| user | `USER` |
| auth | `AUTH` |
| seed | `SEED` |

Para acuñar una nueva: **4 a 8 letras**, mayúsculas, sin guiones, derivada del nombre de la entidad y única en la tabla. Se registra aquí **antes** de usarse. Abreviaturas de dos letras como `HF` quedan prohibidas por ambiguas.

---

## 7. Comentarios

Toda función exportada lleva comentario. Formato de **dos líneas**, idéntico en las tres capas:

```ts
// <Descripción En Title Case>
// Code: ESAVI-<ENTIDAD>-<NNN>
```

Ruta:
```ts
// Create Catalog Item
// Code: ESAVI-CATITEM-001
router.post('/', tokenValidation, ...);
```

Controlador:
```ts
// Create Catalog Item Controller
// Code: ESAVI-CATITEM-001
const createCatalogItem = async (req: Request, res: Response, next: NextFunction) => { ... }
```

Servicio:
```ts
// Create Catalog Item Service
// Code: ESAVI-CATITEM-001
const createCatalogItemService = async (...) => { ... }
```

Reglas:

- Descripción en **inglés** y **Title Case**.
- El controlador termina la descripción en `Controller`; el servicio en `Service`; la ruta no lleva sufijo.
- Si la operación es sensible al rol, se anota al final: `// Activate Catalog Item Controller - For SuperAdmin`.
- **Sin JSDoc.** Este repositorio no lo usa; introducirlo en un archivo suelto crea un tercer estilo.
- Dentro de un servicio, los pasos no evidentes llevan un `//` de una línea que explica **por qué**, no qué (`// Code must be unique within the same Catalog Type`).
- Prohibido dejar código comentado. Si no se usa, se borra: para eso está git.

---

## 8. Cadena de middlewares

Orden **invariable**, sin excepciones:

```ts
router.<method>('/<path>', tokenValidation, validateUserRole(ROL), ...entityValidator, validateFields, handler);
```

```ts
// Update Catalog Item
// Code: ESAVI-CATITEM-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogItemIdValidator, ...updateCatalogItemValidator, validateFields, updateCatalogItem);
```

Reglas duras:

- **El spread `...` es obligatorio.** Los validadores son arrays; pasarlos sin `...` los monta como un único middleware y la validación no se aplica como se espera.
- **Toda ruta con `:id` lleva su `entityIdValidator`**, incluidas DELETE y PATCH.
- **Toda ruta con validadores lleva `validateFields` inmediatamente después.** Sin él, `express-validator` recolecta errores que nadie lee y la petición sigue adelante.
- Cada validador se usa en su operación: el validador de update no va en DELETE ni en PATCH.
- `validateFields` (`src/middlewares/validateFields.middleware.ts`) responde 400 con `common.validationError`; el controlador nunca revalida lo que el validador ya cubrió.

Los roles se importan desestructurados al inicio del archivo de rutas:

```ts
const { SUPERADMIN, ADMIN, USER } = ROLES;
```

---

## 9. Autorización

**`ROLE_LEVELS` (`src/constants/roles.constants.ts`) es la fuente de la verdad.** La autorización es por peso numérico, no por nombre de rol:

| Rol | Nivel |
|---|---|
| `SUPERADMIN` | 100 |
| `ADMIN` | 50 |
| `USER` | 25 |
| `ANALYTICS` | 10 |

`validateUserRole(X)` significa **"nivel ≥ nivel(X)"**, no "es X". `validateUserRole(USER)` admite también a ADMIN y SUPERADMIN — es el comportamiento deseado y en eso se apoya toda la matriz.

Dos consecuencias que son regla:

1. **Nunca se pasa más de un rol.** `validateUserRole` aplica `Math.max` sobre los niveles requeridos, así que `validateUserRole(SUPERADMIN, ADMIN)` exige 100, no 50 — lo contrario de lo que aparenta. Se declara siempre el nivel **mínimo** que se quiere admitir, y uno solo.
2. **La ruta es el único punto de autorización.** Prohibido repetir el chequeo con `isSuperAdmin()` u otro predicado dentro del controlador: hoy provoca que un ADMIN pase el middleware y reciba un 403 del controlador después. Si una regla no se expresa por nivel (p. ej. "solo el dueño del registro"), va en el **servicio**, no en el controlador.

### Matriz canónica

| Operación | Rol mínimo |
|---|---|
| create (`001`) | `ADMIN` |
| list público (`002` / `002A`) | `USER` |
| list admin, incluye inactivos (`002B`) | `ADMIN` |
| getById (`003`) | `USER` |
| update (`004`) | `ADMIN` |
| soft delete (`005A`) | `ADMIN` |
| activate (`005B`) | `SUPERADMIN` |
| borrado físico (`005C`) | `SUPERADMIN` |

Los predicados de `src/helpers/permissions.helper.ts` (`canViewInactive`, `isAdmin`, …) **no autorizan**: modulan comportamiento dentro de un endpoint ya autorizado — típicamente si se ven o no los registros inactivos:

```ts
const data = await getCatalogItemByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
```

---

## 10. Contrato de respuesta

### Éxito

```ts
return res.status(200).json({
    ok: true,
    message: getMessage('catalogItem.getSuccess', req.lang),
    data
});
```

- `message` **siempre** desde `getMessage(key, req.lang)`. Nunca un literal.
- `201` en create, `200` en el resto.
- `delete`, `activate` y `purge` responden **sin** `data`.

### Error

Los produce `errorHandler` (`src/middlewares/errorHandler.middleware.ts`), último middleware de `src/app.ts`:

```ts
{ ok: false, message, code, errors }
```

`errors` solo contiene el texto real del error cuando `NODE_ENV=development`.

### Status codes

| Código | Cuándo |
|---|---|
| `400` | Entrada malformada (lo emite `validateFields`) o parámetro requerido ausente |
| `401` | Token ausente, inválido o expirado · **credenciales inválidas en login** |
| `403` | Nivel de rol insuficiente (lo emite `validateUserRole`) |
| `404` | El recurso o una FK referenciada no existe |
| `409` | Conflicto: `code`/`email` duplicado, **en create y en update por igual**; la fila ya está en el estado pedido en `005A`/`005B`; la fila **sigue activa** al intentar purgarla en `005C` |
| `500` | Error inesperado |

Un duplicado es `409` siempre. Usar `400` en create y `409` en update para el mismo caso, como ocurre hoy, hace imposible que el frontend distinga.

### Idiom obligatorio del `catch` del controlador

```ts
} catch (error) {
    esaviLog('ESAVI-CATITEM-001: Error creating Catalog Item: ' + error, 'error');
    if( error instanceof AppError ) {
        next(error);
        return;
    }
    next(new AppError(getMessage('catalogItem.createdFailed', req.lang), 500, 'CATITEM_001_CREATION_FAILED', error));
}
```

Tres pasos, en este orden: registrar con el código de operación, reenviar el `AppError` **sin tocarlo**, envolver cualquier otra cosa en un `AppError` 500. Un controlador nunca construye una respuesta de error a mano con `res.status(...).json({ ok: false })`.

---

## 11. Capa de servicio

### Firma

```ts
const updateCatalogItemService = async (
    id: string,
    data: Partial<CreateCatalogItemInput>,
    authUser?: AuthUser,
    lang: string = 'en'
) => { ... }
```

Orden: `id` → `data` → `authUser` → `lang`. El servicio lanza `AppError`; nunca devuelve `{ ok: false }`.

### Validación de FK

Antes de crear **o actualizar**, toda FK se comprueba activa:

```ts
const catalogType = await CatalogType.findOne({
    where: { catalogTypeId: data.catalogTypeId, isActive: true }
});
if (!catalogType) {
    throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATITEM_001_CATTYPE_NOT_FOUND');
}
```

El update **también** valida: hoy varios updates aceptan cambiar una FK sin comprobarla.

### Unicidad

El criterio de `isActive` debe ser **el mismo en create y en update**. El canon: la unicidad se evalúa **sin filtrar por `isActive`**, excluyendo el propio registro en update con `[Op.ne]`.

```ts
where: { catalogTypeId, code, catalogItemId: { [Op.ne]: id } }
```

Es lo que garantizan de verdad las `UNIQUE` del DDL, que tampoco filtran por `isActive`. Un código ocupado por un registro borrado lógicamente **sigue ocupado**: liberarlo exigiría índices únicos parciales `WHERE "isActive"`, que hoy no existen. Filtrar por `isActive: true` deja pasar valores que Postgres rechaza con `23505`, convirtiendo un 409 en un 500 (SPEC 04).

### Normalización en escritura

`toConstantCase` para `code`, `toTitleCase` para `name`, `.trim()` para el resto (`src/helpers/stringHandling.helper.ts`). **La comprobación de unicidad se hace sobre el valor ya normalizado**, nunca sobre el crudo.

### Update diferencial — solo se escribe lo que cambió

Un `PUT` **no** es «guarda lo que te mando». Es «deja el registro en este estado». De ahí tres reglas, en cascada:

1. **Lo que no viaja en el body no se toca.** Un campo ausente conserva su valor guardado; nunca se sobrescribe con `null` ni con un valor por defecto.
2. **Lo que viaja igual a lo que ya hay tampoco se toca.** La comparación se hace contra el valor **ya normalizado** (`toConstantCase`, `toTitleCase`, `.trim()`), porque `"  ana  "` y `"Ana"` son el mismo dato y guardarlos como distintos es un cambio inventado.
3. **Si no cambió nada, no hay escritura.** Ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`. Se responde 200 con el registro tal como está.

La razón de la tercera es la auditoría, y alcanza a dos rastros. Un cliente que reenvía entera la ficha que acaba de leer con un `GET` —que es el uso normal de un formulario— generaría una entrada de auditoría por cada vez que alguien abre y cierra la pantalla. Un `appDetails` lleno de entradas que no registran ningún cambio no es trazabilidad: es ruido que esconde las modificaciones reales. Y cada `UPDATE` dispara además `TRG_<tabla>_setSysDetails`, que incrementa `sysDetails.version` y añade un evento a `sysDetails.auditTrail`: la única forma de no ensuciar los dos sitios es no ejecutar el `UPDATE`.

**El patrón canónico es `buildDifferentialUpdate` (`src/helpers/differentialUpdate.helper.ts`), y es de uso obligatorio en los servicios de update.** No se vuelve a escribir la comparación campo a campo: escrita a mano no la vigila nada —omitir un campo no rompe la compilación ni ningún test—, y así es como seis de los doce servicios llegaron a estar desviados sin que nadie lo notara (SPEC F12).

```ts
const currentAppDetails = Array.isArray(entity.appDetails) ? entity.appDetails : [];
// stored tiene que ser la fila completa: con `attributes` acotados, un campo ausente vale
// undefined y toda comparación contra él da «cambió»
const stored = entity.get({ plain: true }) as Record<string, unknown>;
const objectToUpdate = buildDifferentialUpdate(stored, {
    code: data.code ? toConstantCase(data.code.trim()) : undefined,
    name: data.name ? toTitleCase(data.name.trim()) : undefined,
    notes: data.notes !== undefined ? ( data.notes ? data.notes.trim() : null ) : undefined
});
// Sin diferencias no hay escritura: ni UPDATE, ni updatedAt, ni entrada de auditoría,
// ni evento en sysDetails. Es la única línea de control que le queda al servicio
if( Object.keys(objectToUpdate).length === 0 ) {
    return entity;
}
return await entity.update({
    ...objectToUpdate,
    updatedAt: new Date(),
    appDetails: [ ...currentAppDetails, newEntry ]
}, { returning: true });
```

El helper recibe los valores **ya normalizados** y con `undefined` en las claves que no viajaron en el body; normalizar sigue siendo del servicio, porque el helper no sabe qué campo es un código y cuál un nombre. Devuelve solo las claves que difieren, aplicando estas reglas de comparación:

| Tipo de valor | Criterio |
|---|---|
| Primitivos | `!==` estricto |
| `null` en un lado y valor en el otro | es cambio |
| `Date` en cualquiera de los dos lados | ambos coercionados con `new Date(v).getTime()` |
| Objetos y arrays | `JSON.stringify` en los dos lados |
| Cadena numérica frente a número, si ambos coercionan a un número finito | comparación numérica |
| Fecha `DATEONLY` como cadena | `String(v).slice(0, 10)` en los dos lados |

La quinta existe porque las columnas `DECIMAL` vuelven de `pg` como cadena —`latitude` se lee `'-0.2299000'` y llega `-0.2299`—, así que un `!==` entre ellas es siempre verdadero.

Cuatro precisiones:

- **Los campos anulables se comparan contra `undefined`, no por veracidad.** `data.x !== undefined ? (data.x ?? null) : undefined` distingue «no vino» de «vino en `null`». Un `if( data.x )` descarta en silencio el `false`, el `0` y la cadena vacía, que son valores legítimos. En `candidates`, `undefined` es «no vino» y `null` es un valor: no son intercambiables, y colapsar el segundo en el primero deja un campo anulable sin forma de vaciarse.
- **Los campos cifrados se comparan sobre el texto plano**: el `stored` llega descifrado con `esaviDecrypt` y `esaviCrypt` se aplica **después**, sobre las claves que el helper devolvió. Comparar ciphertext funciona solo porque `esaviCrypt` usa un IV fijo, y atarse a eso hace que pasar a un IV aleatorio rompa la comparación en silencio.
- **Los derivados cuentan como cambio.** Si el servicio recalcula un valor —una edad, un `displayName`— entra en `candidates` **siempre**, no bajo un `if` de presencia, y es el helper quien decide si difiere del guardado.
- **La validación de FK y la unicidad van antes y son independientes** de si el campo cambió: una FK que llega apuntando a una fila inactiva es 404 aunque coincida con la guardada, y un `code` ocupado es 409 aunque el resto del body no cambie nada. La unicidad de un campo cifrado sí compara ciphertext, porque es una consulta a la base y no un diff.

### Auditoría — `appDetails`

Array JSONB append-only, tipado con `AppDetails` (`src/types/common/audit.types.ts`).

En create:
```ts
appDetails: [{
    createdAt: new Date(),
    user: authUser?.userId || 'undefined',
    method: 'ESAVI-CATITEM-001',
    detail: 'Catalog item created by service'
}]
```

En update se **preserva** el historial:
```ts
const currentAppDetails = Array.isArray(catalogItem.appDetails) ? catalogItem.appDetails : [];
// ...
appDetails: [ ...currentAppDetails, { ... } ]
```

Sobrescribir el array en vez de extenderlo destruye la trazabilidad. Fallback de usuario: `'undefined'`, uniforme.

### Borrado lógico y activación

Nunca se implementa a mano: se delega en `setEntityActiveStatusService` (`src/services/common/entityActivation.service.ts`).

```ts
const setCatalogItemActivationService = async (id: string, authUser?: AuthUser, lang: string = 'en', isActive: boolean = true) => {
    const transaction = await sequelize.transaction();
    try {
        const catalogItem = await setEntityActiveStatusService({
            model: CatalogItem,
            where: { catalogItemId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('catalogItem.notFound', lang),
            notFoundCode: 'CATITEM_005_NOT_FOUND',
            alreadyInStateMessage: getMessage(`catalogItem.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: 'CATITEM_005' + ( isActive ? 'B_ALREADY_ACTIVE' : 'A_ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-CATITEM-005' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' ),
                detail: `CatalogItem ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return catalogItem;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}
```

El `where` filtra **solo por la PK**. El estado lo compara el servicio genérico, que distingue tres casos:

| Situación | Respuesta |
|---|---|
| La entidad no existe | 404 con `notFoundMessage` |
| Ya está en el estado pedido | 409 con `alreadyActive` / `alreadyInactive` |
| Está en el otro estado | se actualiza |

Meter `isActive: !isActive` en el `where` convierte el segundo caso en un 404 que miente: el recurso existe. Cada entidad necesita sus claves `alreadyActive` y `alreadyInactive` en los tres idiomas.

`DELETE /:id` nunca borra físicamente: pone `isActive: false` y sella `deletedAt`. El borrado físico es una operación aparte, con su propia ruta, su propio rol y su propio servicio.

### Borrado físico — `005C`

Tampoco se implementa a mano: se delega en `purgeEntityService` (`src/services/common/entityPurge.service.ts`), envuelto en una transacción propia igual que el de activación.

El genérico hace cuatro cosas, en este orden:

1. `findOne` por la PK con `paranoid: false`, dentro de la transacción → 404 con `notFoundCode` si no existe.
2. Comprueba `isActive`. Si sigue en `true` → 409 con `stillActiveCode`. Solo se purga lo que ya fue retirado con `005A`.
3. `esaviLog` en nivel **`warn`** con el código de operación, el `userId`, la PK y el volcado de la fila completa.
4. `destroy({ force: true, transaction })`. El `force` no es opcional: sin él, un modelo con `paranoid` activo volvería a hacer un borrado lógico sobre una fila que ya lo estaba.

**No toca `appDetails`.** Es la única operación de escritura del repositorio que no añade entrada de auditoría, y no es un olvido: la fila desaparece en la misma transacción, así que cualquier cosa escrita en ella se destruye con ella.

El volcado al log es el **único** rastro que queda de una operación irreversible, y por eso es obligatorio y va antes del `destroy`. Sale de la instancia de Sequelize, así que los campos cifrados con `esaviCrypt` se escriben **cifrados**: el descifrado ocurre al construir la respuesta, no al leer de la base. Ninguna entidad filtra PII en claro al log por esta vía.

El `where` filtra **solo por la PK**, como en la activación. Meter `isActive: false` en el `where` convertiría el 409 del segundo caso en un 404 que miente: el recurso existe, lo que pasa es que todavía está vivo.

### Transacciones

**Obligatorias cuando hay más de una escritura dependiente.** Crear un usuario y asignarle roles, o crear una entidad y sus hijos, van en una transacción con `commit()` y `rollback()` en el `catch` (patrón de `src/services/user.service.ts`). Una sola escritura no la necesita.

Estado a 2026-08-02: las **únicas** operaciones multi-escritura del código son `createUserService` y los cuatro servicios de activación, que abren la transacción y la pasan a `setEntityActiveStatusService` por su parámetro `transaction`. Todo lo demás —creates, updates y borrados lógicos de catálogos y geografía— hace una sola escritura y va sin transacción, deliberadamente. La regla queda escrita para las entidades ESAVI que vienen, que sí tendrán hijos.

### Paginación

Los listados usan `findAndCountAll` y devuelven `{ count, rows }` tal cual dentro de `data`. Los valores por defecto salen del entorno mediante una constante compartida, no hardcodeados ni redeclarados por archivo:

```ts
const DEFAULT_LIMIT = process.env.ESAVI_APP_DEFAULT_LIMIT ? parseInt(process.env.ESAVI_APP_DEFAULT_LIMIT) : 10;
const DEFAULT_OFFSET = process.env.ESAVI_APP_DEFAULT_OFFSET ? parseInt(process.env.ESAVI_APP_DEFAULT_OFFSET) : 0;
```

`limit` y `offset` se validan en el validador de la ruta (`query('limit').optional().isInt({ min: 1, max: 100 })`) — sin eso, un `parseInt('abc')` manda `NaN` a Sequelize. El `order` de una misma entidad es coherente entre sus listados.

---

## 12. Modelos

- `timestamps: false` y `freezeTableName: true`.
- `tableName` en camelCase, coincidiendo con la tabla de `esaviapp.sql`.
- PK UUID: `defaultValue: sequelize.literal('gen_random_uuid()')`.
- Toda tabla lleva `isActive`, `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB array).
- **Las asociaciones nunca van en el archivo del modelo**: van en `src/models/associations/<dominio>.associations.ts` y se registran en `initAssociations()`.
- **El esquema no lo crea Sequelize.** `esaviapp.sql` es el DDL autoritativo; el modelo se escribe para calzar con la tabla existente. No se usa `sequelize.sync()`.

---

## 13. Claves i18n

Estructura `<entidad>.<clave>` en `src/data/i18n/{es,en,nl}.json`.

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | create |
| `getSuccess` / `getFailed` | getById |
| `getSuccessPlural` / `getFailedPlural` | list |
| `updatedSuccess` / `updatedFailed` | update |
| `deletedSuccess` / `deletedFailed` | soft delete |
| `activatedSuccess` / `activatedFailed` | activate |
| `notFound` / `notFoundPlural` | recurso inexistente |
| `codeExists` | duplicado de `code` |
| `idRequired` | parámetro ausente |

Reglas:

- El set de claves de una entidad es **el mismo para las siete operaciones**: si el endpoint existe, sus dos claves existen.
- Toda clave nueva se agrega a **los tres** archivos en el mismo commit. `getMessage` devuelve **cadena vacía** si la clave falta — no hay fallback a otro idioma, así que una clave ausente sale al cliente como `message: ""`.
- Interpolación con `{{param}}`: `getMessage('catalogItem.codeExists', lang, { code })`.
- Una clave referenciada desde el código y ausente del JSON es un bug silencioso. Se verifica antes de cerrar el PR.

---

## 14. Plantillas

Sustituir `Entity` / `entity` / `ENTITY` / `dominio` por los valores reales.

### 14.1 Tipos — `src/types/<dominio>/entity.types.ts`

```ts
export interface CreateEntityInput {
    code: string;
    name: string;
    description?: string | null;
    sortOrder?: number | null;
}
```

### 14.2 Validadores — `src/validators/entity.validator.ts`

```ts
import { body, param, query } from 'express-validator';

export const entityIdValidator = [
    param('id').notEmpty().withMessage('Entity ID is required')
        .isUUID().withMessage('Entity ID must be a valid UUID')
        .trim()
];

export const entityListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer')
];

export const createEntityValidator = [
    body('code').trim().notEmpty().withMessage('Code is required')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required')
        .isLength({ max: 250 }).withMessage('Name must be at most 250 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer')
];

export const updateEntityValidator = [
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty')
        .isLength({ max: 250 }).withMessage('Name must be at most 250 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer')
];
```

El validador de update **no** repite el de id: se componen en la ruta.

### 14.3 Servicio — `src/services/entity.service.ts`

```ts
import { Op } from 'sequelize';
import { AppError, buildDifferentialUpdate, getMessage, toConstantCase, toTitleCase } from '../helpers';
import { Entity } from '../models';
import { AuthUser, CreateEntityInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';

const DEFAULT_LIMIT = process.env.ESAVI_APP_DEFAULT_LIMIT ? parseInt(process.env.ESAVI_APP_DEFAULT_LIMIT) : 10;
const DEFAULT_OFFSET = process.env.ESAVI_APP_DEFAULT_OFFSET ? parseInt(process.env.ESAVI_APP_DEFAULT_OFFSET) : 0;

// Create Entity Service
// Code: ESAVI-ENTITY-001
const createEntityService = async (data: CreateEntityInput, authUser?: AuthUser, lang: string = 'en') => {
    const code = toConstantCase(data.code.trim());
    // Code must be unique among active records
    const existing = await Entity.findOne({ where: { code, isActive: true } });
    if( existing ) {
        throw new AppError(getMessage('entity.codeExists', lang, { code }), 409, 'ENTITY_001_CODE_EXISTS');
    }
    return await Entity.create({
        code,
        name: toTitleCase(data.name.trim()),
        description: data.description ? data.description.trim() : null,
        sortOrder: data.sortOrder ?? 0,
        appDetails: [{
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-ENTITY-001',
            detail: 'Entity created by service'
        }]
    });
}

// Get Active Entities Service
// Code: ESAVI-ENTITY-002A
const getActiveEntitiesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    return await Entity.findAndCountAll({
        where: { isActive: true },
        order: [['sortOrder', 'ASC'], ['name', 'ASC']],
        limit,
        offset
    });
}

// Get All Entities Service - For Admin
// Code: ESAVI-ENTITY-002B
const getAllEntitiesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    return await Entity.findAndCountAll({
        order: [['sortOrder', 'ASC'], ['name', 'ASC']],
        limit,
        offset
    });
}

// Get Entity By ID Service
// Code: ESAVI-ENTITY-003
const getEntityByIdService = async (id: string, lang: string = 'en', canViewInactive: boolean = false) => {
    const where = canViewInactive ? { entityId: id } : { entityId: id, isActive: true };
    const entity = await Entity.findOne({ where });
    if( !entity ) {
        throw new AppError(getMessage('entity.notFound', lang), 404, 'ENTITY_003_NOT_FOUND');
    }
    return entity;
}

// Update Entity Service
// Code: ESAVI-ENTITY-004
const updateEntityService = async (id: string, data: Partial<CreateEntityInput>, authUser?: AuthUser, lang: string = 'en') => {
    const entity = await Entity.findByPk(id);
    if( !entity ) {
        throw new AppError(getMessage('entity.notFound', lang), 404, 'ENTITY_004_NOT_FOUND');
    }
    const code = data.code ? toConstantCase(data.code.trim()) : undefined;
    if( code && code !== entity.code ) {
        const existing = await Entity.findOne({
            where: { code, isActive: true, entityId: { [Op.ne]: id } }
        });
        if( existing ) {
            throw new AppError(getMessage('entity.codeExists', lang, { code }), 409, 'ENTITY_004_CODE_EXISTS');
        }
    }
    // Only what actually changed travels to the UPDATE. The comparison lives in the helper, and
    // its stored side has to be the whole row — findByPk without narrowed attributes
    const stored = entity.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        code,
        name: data.name ? toTitleCase(data.name.trim()) : undefined,
        description: data.description !== undefined ? ( data.description?.trim() ?? null ) : undefined,
        sortOrder: data.sortOrder
    });
    // Nothing changed: no UPDATE, no updatedAt, no audit entry and no sysDetails event
    if( Object.keys(objectToUpdate).length === 0 ) {
        return entity;
    }
    const currentAppDetails = Array.isArray(entity.appDetails) ? entity.appDetails : [];
    return await entity.update({
        ...objectToUpdate,
        updatedAt: new Date(),
        appDetails: [
            ...currentAppDetails,
            {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-ENTITY-004',
                detail: 'Entity updated by service'
            }
        ]
    }, { returning: true });
}

// Set Entity Activation Service
// Code: ESAVI-ENTITY-005
const setEntityActivationService = async (id: string, authUser?: AuthUser, lang: string = 'en', isActive: boolean = true) => {
    return setEntityActiveStatusService({
        model: Entity,
        where: { entityId: id, isActive: !isActive },
        isActive,
        lang,
        notFoundMessage: getMessage('entity.notFound', lang),
        notFoundCode: 'ENTITY_005_NOT_FOUND',
        appDetail: {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-ENTITY-005' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' ),
            detail: `Entity ${ isActive ? 'activated' : 'deactivated' } by service`
        }
    });
}

export {
    createEntityService,
    getActiveEntitiesService,
    getAllEntitiesService,
    getEntityByIdService,
    updateEntityService,
    setEntityActivationService
}
```

### 14.4 Controlador — `src/controllers/entity.controller.ts`

```ts
import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createEntityService,
    getActiveEntitiesService,
    getAllEntitiesService,
    getEntityByIdService,
    updateEntityService,
    setEntityActivationService
} from '../services/entity.service';

// Create Entity Controller
// Code: ESAVI-ENTITY-001
const createEntity = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createEntityService(req.body, { userId: req.user?.userId } as AuthUser, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('entity.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-ENTITY-001: Error creating Entity: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('entity.createdFailed', req.lang), 500, 'ENTITY_001_CREATION_FAILED', error));
    }
}

// Get Entities Controller
// Code: ESAVI-ENTITY-002A
const getEntities = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getActiveEntitiesService(limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('entity.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-ENTITY-002A: Error fetching Entities: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('entity.getFailedPlural', req.lang), 500, 'ENTITY_002A_FETCH_FAILED', error));
    }
}

// Get Entity By ID Controller
// Code: ESAVI-ENTITY-003
const getEntityById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getEntityByIdService(id.toString().trim(), req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('entity.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-ENTITY-003: Error fetching Entity by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('entity.getFailed', req.lang), 500, 'ENTITY_003_FETCH_FAILED', error));
    }
}

// Delete Entity Controller - Soft delete
// Code: ESAVI-ENTITY-005A
const deleteEntity = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setEntityActivationService(id, { userId: req.user?.userId } as AuthUser, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('entity.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-ENTITY-005A: Error deleting Entity: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('entity.deletedFailed', req.lang), 500, 'ENTITY_005A_DELETE_FAILED', error));
    }
}

export {
    createEntity,
    getEntities,
    getEntityById,
    deleteEntity
}
```

`getAllEntities` (`002B`), `updateEntity` (`004`) y `activateEntity` (`005B`) siguen exactamente el mismo molde.

### 14.5 Ruta — `src/routes/entity.routes.ts`

```ts
import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateEntity,
    createEntity,
    deleteEntity,
    getAllEntities,
    getEntities,
    getEntityById,
    updateEntity
} from '../controllers/entity.controller';
import {
    createEntityValidator,
    entityIdValidator,
    entityListValidator,
    updateEntityValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Entity
// Code: ESAVI-ENTITY-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createEntityValidator, validateFields, createEntity);

// Get Entities
// Code: ESAVI-ENTITY-002A
router.get('/', tokenValidation, validateUserRole(USER), ...entityListValidator, validateFields, getEntities);

// Get All Entities - For Admin
// Code: ESAVI-ENTITY-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...entityListValidator, validateFields, getAllEntities);

// Get Entity by ID
// Code: ESAVI-ENTITY-003
router.get('/:id', tokenValidation, validateUserRole(USER), ...entityIdValidator, validateFields, getEntityById);

// Update Entity
// Code: ESAVI-ENTITY-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...entityIdValidator, ...updateEntityValidator, validateFields, updateEntity);

// Soft delete Entity
// Code: ESAVI-ENTITY-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...entityIdValidator, validateFields, deleteEntity);

// Activate Entity
// Code: ESAVI-ENTITY-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...entityIdValidator, validateFields, activateEntity);

export default router;
```

Y el alta en `src/routes/index.ts`:

```ts
router.use('/entities', entityRoutes);
```

La ruta base va en **kebab-case plural**: `/catalog-items`, `/geo-level-types`, `/health-facilities`.

### 14.6 Claves i18n — los tres archivos

```json
"entity": {
    "codeExists": "...",
    "notFound": "...",
    "idRequired": "...",
    "createdSuccess": "...",
    "createdFailed": "...",
    "getSuccess": "...",
    "getFailed": "...",
    "getSuccessPlural": "...",
    "getFailedPlural": "...",
    "updatedSuccess": "...",
    "updatedFailed": "...",
    "deletedSuccess": "...",
    "deletedFailed": "...",
    "activatedSuccess": "...",
    "activatedFailed": "..."
}
```

---

## 15. Checklist antes de cerrar un PR

- [ ] Existen los siete artefactos (modelo, asociaciones, tipos, validadores, servicio, controlador, ruta).
- [ ] Los nombres de archivo llevan el sufijo canónico, en plural donde corresponde (`.routes.ts`, `.types.ts`, `.associations.ts`).
- [ ] Los símbolos siguen el patrón: controlador sin sufijo, servicio con `Service`, tipo con `Input`.
- [ ] El código `ESAVI-*` es **idéntico** en los cinco lugares (ruta, controlador, servicio, `AppError`, `appDetails.method`).
- [ ] La numeración respeta el esquema fijo (`001` create … `005C` borrado físico).
- [ ] Si la tabla **no** figura en `preventPhysicalDelete` (`esaviapp.sql:1354-1360`), la entidad expone su `005C` en `DELETE /purge/:id` con `validateUserRole(SUPERADMIN)`; si figura, **no** lo expone.
- [ ] El `005C` exige `isActive: false` (409 si sigue activa) y vuelca la fila a `esaviLog` en nivel `warn` **antes** del `destroy`. Que no escriba en `appDetails` es correcto y no cuenta como incumplimiento del código en cinco lugares.
- [ ] La abreviatura de entidad está registrada en la tabla de la sección 6.
- [ ] Toda función exportada lleva el comentario de dos líneas.
- [ ] La cadena de middlewares está completa y con el spread `...`.
- [ ] Toda ruta con `:id` incluye su `entityIdValidator`, y toda ruta con validadores incluye `validateFields`.
- [ ] `validateUserRole` recibe **un solo** rol, el nivel mínimo.
- [ ] No hay chequeos de rol dentro del controlador.
- [ ] Los status codes siguen la tabla: `409` para duplicados en create **y** update.
- [ ] El `catch` del controlador sigue el idiom de tres pasos.
- [ ] El servicio valida las FK, normaliza en escritura y extiende `appDetails` sin sobrescribirlo.
- [ ] El update es **diferencial y pasa por `buildDifferentialUpdate`**: solo viajan al `UPDATE` los campos cuyo valor normalizado difiere del guardado, y sin diferencias no hay escritura, ni entrada de auditoría, ni evento en `sysDetails`.
- [ ] Hay transacción si se hace más de una escritura dependiente.
- [ ] Las claves i18n existen en `es.json`, `en.json` **y** `nl.json`, y todas las referenciadas desde el código existen.
- [ ] No queda código comentado.
- [ ] `npm run build` pasa.
