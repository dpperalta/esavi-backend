# Deuda técnica — esavi-backend

Desviaciones del canon definido en [CONVENTIONS.md](./CONVENTIONS.md), detectadas en el código existente a **2026-07-31**.

Cada entrada tiene un ID estable, para convertirse después en un spec independiente. **No se corrige nada al leer este archivo**: se resuelve deliberadamente, una entrada a la vez.

**Regla**: ninguna de estas desviaciones es precedente. El código nuevo sigue el canon aunque el archivo de al lado no lo haga.

## Severidad

| Nivel | Significado |
|---|---|
| 🔴 Alta | Bug activo, hueco de seguridad o comportamiento incorrecto en producción |
| 🟠 Media | Inconsistencia que confunde al consumidor de la API o rompe la trazabilidad |
| 🟡 Baja | Nomenclatura, duplicación o limpieza; sin impacto funcional |

## Resumen

| ID | Severidad | Título |
|---|---|---|
| [DEUDA-001](#deuda-001) | 🔴 | `setEntityActiveStatusService` ignora `notFoundMessage` |
| [DEUDA-002](#deuda-002) | 🔴 | Endpoint de seed sin autenticación |
| [DEUDA-003](#deuda-003) | 🔴 | Tres claves i18n referenciadas que no existen |
| [DEUDA-004](#deuda-004) | 🔴 | `nd.json` tiene 23 de 124 claves |
| [DEUDA-005](#deuda-005) | 🔴 | `DELETE /catalog-types/:id` declara rol `USER` |
| [DEUDA-006](#deuda-006) | 🔴 | Siete rutas sin `validateFields` ni validadores |
| [DEUDA-007](#deuda-007) | 🔴 | `limit` / `offset` sin validar llegan como `NaN` a Sequelize |
| [DEUDA-008](#deuda-008) | 🟠 | Códigos `ESAVI-*` desalineados entre capas |
| [DEUDA-009](#deuda-009) | 🟠 | Guards de rol duplicados dentro de los controladores |
| [DEUDA-010](#deuda-010) | 🟠 | `validateUserRole(SUPERADMIN, ADMIN)` exige 100, no 50 |
| [DEUDA-011](#deuda-011) | 🟠 | 400 vs 409 para el mismo caso de duplicado |
| [DEUDA-012](#deuda-012) | 🟠 | Login responde 404 ante credenciales inválidas |
| [DEUDA-013](#deuda-013) | 🟠 | Unicidad de `code` con criterio distinto en create y update |
| [DEUDA-014](#deuda-014) | 🟠 | El update no revalida las FK |
| [DEUDA-015](#deuda-015) | 🟠 | Validadores incorrectos y sin spread en `geoLocation.routes.ts` |
| [DEUDA-016](#deuda-016) | 🟠 | Typo `ESAIV-HF-*` y abreviatura de dos letras |
| [DEUDA-017](#deuda-017) | 🟠 | CORS abierto en producción |
| [DEUDA-018](#deuda-018) | 🟠 | Sin transacciones fuera de `user.service.ts` |
| [DEUDA-019](#deuda-019) | 🟡 | Sufijos de archivo fuera de norma |
| [DEUDA-020](#deuda-020) | 🟡 | `CreateCatalogItem` sin sufijo `Input` |
| [DEUDA-021](#deuda-021) | 🟡 | `UpdateGeoLevelTypeInput` declarado y nunca usado |
| [DEUDA-022](#deuda-022) | 🟡 | Código duplicado en `healthFacility.service.ts` |
| [DEUDA-023](#deuda-023) | 🟡 | Código comentado obsoleto |
| [DEUDA-024](#deuda-024) | 🟡 | `loginController` y `const route` |
| [DEUDA-025](#deuda-025) | 🟡 | Falta `geoLevelTypeIdValidator` |
| [DEUDA-026](#deuda-026) | 🟡 | Paginación duplicada y hardcodeada |
| [DEUDA-027](#deuda-027) | 🟡 | `AppDetails` declarado y nunca importado |
| [DEUDA-028](#deuda-028) | 🟡 | `AuthUser` y `Express.Request['user']` divergen |
| [DEUDA-029](#deuda-029) | 🟡 | Barrels de `types/` con dos estilos |
| [DEUDA-030](#deuda-030) | 🟡 | Sin tests ni linter |
| [DEUDA-031](#deuda-031) | 🔴 | `roles.constants.ts` lee variables de entorno que no existen |
| [DEUDA-032](#deuda-032) | 🟠 | Los middlewares construyen respuestas de error a mano |
| [DEUDA-033](#deuda-033) | 🟠 | `tokenValidation` deja `email` y `displayName` cifrados en `req.user` |
| [DEUDA-034](#deuda-034) | 🟠 | Reasignar `parentGeoLocationId` puede crear un ciclo |
| [DEUDA-035](#deuda-035) | 🟡 | `canViewInactive` exige SUPERADMIN; la matriz dice ADMIN |
| [DEUDA-036](#deuda-036) | 🟡 | Quedan 8 `console.log` en `src/` fuera del alcance del SPEC 06 |

## Mapa de resolución

La serie de specs de [`specs/`](./specs/) cubre las entradas 001–030. Las
entradas 031–035 todavía no tienen spec.

| Spec | Entradas que cierra |
|---|---|
| [01 — Autorización y superficie expuesta](./specs/01-authorization-and-exposure.md) | 002, 005, 009, 010, 012, 017 |
| [02 — Validación de entrada y paginación](./specs/02-input-validation.md) | 006, 007, 015, 025, 026 |
| [03 — Paridad i18n](./specs/03-i18n-parity.md) | 003, 004 |
| [04 — Contrato de conflicto y consistencia](./specs/04-data-contract-consistency.md) | 001, 011, 013, 014, 018 |
| [05 — Códigos de operación](./specs/05-operation-codes.md) | 008, 016 |
| [06 — Nomenclatura, tipos y código muerto](./specs/06-naming-and-types.md) | 019, 020, 021, 022, 023, 024, 027, 028, 029 |
| [07 — Linter y suite mínima](./specs/07-tooling-and-tests.md) | 030 |
| sin spec | 031, 032, 033, 034, 035 |

Orden de ejecución: 01 → 02 → 03 → 04 → 05 → 06 → 07. El 05 renumera líneas
que tocan el 01, el 02 y el 04; el 06 renombra archivos que editan los cinco
anteriores; el 07 escribe la suite contra el comportamiento ya corregido.

**El SPEC 04 corrige la aceptación escrita en [DEUDA-013](#deuda-013)**: el
criterio correcto es *sin* filtrar por `isActive`, no `isActive: true`. Ver
las decisiones de ese spec.

---

<a id="deuda-001"></a>
## DEUDA-001 🔴 `setEntityActiveStatusService` ignora `notFoundMessage`

**Archivo**: `src/services/common/entityActivation.service.ts:29`

Recibe `options.notFoundMessage` y no lo usa: siempre emite el mensaje de `geoLevelType`, para todas las entidades.

```ts
throw new AppError(getMessage('geoLevelType.notFound', options.lang || 'en'), 404, options.notFoundCode);
```

Borrar un `catalogItem` inexistente responde "Tipo de nivel geográfico no encontrado". Afecta a las cuatro entidades que usan el servicio genérico.

**Aceptación**: usa `options.notFoundMessage`; borrar cada entidad inexistente devuelve su propio mensaje.

---

<a id="deuda-002"></a>
## DEUDA-002 🔴 Endpoint de seed sin autenticación

**Archivo**: `src/routes/seed.route.ts:8-9`

`tokenValidation` y `validateUserRole` están comentados. `POST /api/seed/admin` solo está protegido por que `?enable=` coincida con `SEED_ACTION`, un valor de entorno.

**Aceptación**: el endpoint exige `SUPERADMIN`, o se elimina del router en producción.

---

<a id="deuda-003"></a>
## DEUDA-003 🔴 Tres claves i18n referenciadas que no existen

`getMessage` devuelve **cadena vacía** cuando la clave falta, así que el cliente recibe `message: ""` sin ningún error visible.

| Clave | Referenciada en | Nota |
|---|---|---|
| `auth.loginFailed` | `src/controllers/auth.controller.ts:21` | no existe en ningún JSON |
| `catalogItem.updateFailed` | `src/controllers/catalogItem.controller.ts:110` | el JSON define `updatedFailed` |
| `facilityType.notFound` | `src/services/healthFacility.service.ts:35` | el namespace `facilityType` no existe |

**Aceptación**: las tres resuelven a texto en los tres idiomas.

---

<a id="deuda-004"></a>
## DEUDA-004 🔴 `nd.json` tiene 23 de 124 claves

**Archivo**: `src/data/i18n/nd.json`

`es.json` y `en.json` están a la par (124 claves, cero diferencias). `nd.json` solo cubre `common`, `seed`, `auth`, `crypto`, `user` y `role`, y de forma parcial. Faltan **101 claves**, incluidos los namespaces completos de `geoLevelType`, `geoLocation`, `catalogType`, `catalogItem` y `healthFacility`.

`nd` está en `SUPPORTED_LANGUAGES`, así que un cliente que lo pida recibe la mayoría de respuestas con `message: ""`.

**Aceptación**: paridad de claves con `es.json`, o `nd` sale de `SUPPORTED_LANGUAGES` hasta completarse.

---

<a id="deuda-005"></a>
## DEUDA-005 🔴 `DELETE /catalog-types/:id` declara rol `USER`

**Archivo**: `src/routes/catalogType.routes.ts`

La ruta declara `validateUserRole(USER)` (nivel ≥ 25). Lo único que impide que cualquier usuario autenticado borre un tipo de catálogo es el guard `isSuperAdmin` dentro del controlador (`catalogType.controller.ts:96`). Si se retira ese guard al limpiar [DEUDA-009](#deuda-009), el endpoint queda abierto.

Debe corregirse **antes** que DEUDA-009, no después.

**Aceptación**: la ruta declara `ADMIN` conforme a la matriz canónica.

---

<a id="deuda-006"></a>
## DEUDA-006 🔴 Siete rutas sin `validateFields` ni validadores

Reciben un `:id` sin comprobar que sea un UUID, o parámetros de query sin validar. Un id malformado llega a Sequelize y produce un 500 en vez de un 400.

| Ruta | Archivo |
|---|---|
| `GET /catalog-types/` | `catalogType.routes.ts` |
| `GET /catalog-types/:id` | `catalogType.routes.ts` |
| `DELETE /catalog-types/:id` | `catalogType.routes.ts` |
| `GET /geo-level-types/` | `geoLevelType.routes.ts` |
| `GET /geo-level-types/:id` | `geoLevelType.routes.ts` |
| `DELETE /geo-level-types/:id` | `geoLevelType.routes.ts` |
| `PATCH /geo-level-types/activate/:id` | `geoLevelType.routes.ts` |
| `GET /catalog-items/admin/type/:id` | `catalogItem.route.ts` |
| `GET /health-facilities/location/:id` | `healthFacility.routes.ts` |

**Aceptación**: toda ruta con `:id` lleva su `entityIdValidator` seguido de `validateFields`.

---

<a id="deuda-007"></a>
## DEUDA-007 🔴 `limit` / `offset` sin validar llegan como `NaN` a Sequelize

Ningún endpoint valida los parámetros de paginación. En el estilo dominante:

```ts
const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
```

`?limit=abc` produce `NaN`, que se pasa tal cual a Sequelize. Tampoco hay tope máximo: `?limit=999999` es una petición válida.

**Aceptación**: `entityListValidator` con `isInt({ min: 1, max: 100 })` para `limit` y `isInt({ min: 0 })` para `offset`, aplicado en todos los listados.

---

<a id="deuda-008"></a>
## DEUDA-008 🟠 Códigos `ESAVI-*` desalineados entre capas

En `catalogType`, `geoLevelType` y `geoLocation`, el mismo número significa operaciones distintas según la capa:

| Entidad | Capa route/controller | Capa service |
|---|---|---|
| catalogType | `003` = getById, `004` = update, `005A/B` = delete/activate | `003` = update, `004` = activación |
| geoLevelType | idem | `002A/002B`, `003` = getById, `004` = update, `005` = activación |
| geoLocation | idem | idem |

Rastrear una operación por su código a través de las capas es imposible, que es justamente para lo que existe el código.

`catalogItem` es la única entidad coherente entre capas, pero usa el esquema antiguo (`003` = update, `004A/B` = delete/activate) y también hay que migrarla al canon.

**Aceptación**: todas las entidades usan `001 / 002[A|B] / 003 / 004 / 005A / 005B` de forma idéntica en las cinco ubicaciones.

---

<a id="deuda-009"></a>
## DEUDA-009 🟠 Guards de rol duplicados dentro de los controladores

Siete sitios repiten la autorización que ya hizo el middleware:

```ts
if( !isSuperAdmin(req.user as AuthUser) ) {
    return res.status(403).json({ ok: false, message: getMessage('auth.forbidden', req.lang) });
}
```

`catalogType.controller.ts:96,122` · `geoLevelType.controller.ts:76,103,129` · `geoLocation.controller.ts:102,129`

El efecto visible: en `geoLocation`, `PATCH /activate/:id` declara `ADMIN` en la ruta, así que un ADMIN pasa el middleware y recibe un 403 del controlador después. La autorización real vive en dos sitios que no coinciden.

Depende de [DEUDA-005](#deuda-005).

**Aceptación**: cero chequeos de rol en controladores; el nivel de la ruta refleja la exigencia real.

---

<a id="deuda-010"></a>
## DEUDA-010 🟠 `validateUserRole(SUPERADMIN, ADMIN)` exige 100, no 50

**Archivo**: `src/routes/geoLevelType.routes.ts` — `GET /geo-level-types/`

`validateUserRole` aplica `Math.max` sobre los niveles requeridos, de modo que pasar dos roles exige el **mayor**, no el menor. La ruta aparenta admitir ADMIN pero en la práctica es solo-SUPERADMIN.

**Aceptación**: se pasa un solo rol, el nivel mínimo admitido. Opcionalmente, `validateUserRole` usa `Math.min` y se documenta — pero el canon prefiere un solo argumento.

---

<a id="deuda-011"></a>
## DEUDA-011 🟠 400 vs 409 para el mismo caso de duplicado

| Entidad | create | update |
|---|---|---|
| catalogItem | **400** | **409** |
| catalogType | **400** | **409** |
| geoLevelType | 409 | 409 |
| geoLocation | **400** | **400** |
| healthFacility | **400** | — |
| user (email) | 409 | — |

La misma entidad devuelve códigos distintos para el mismo conflicto según la operación. El frontend no puede tratarlo de forma uniforme.

**Aceptación**: `409` en todos los casos de duplicado.

---

<a id="deuda-012"></a>
## DEUDA-012 🟠 Login responde 404 ante credenciales inválidas

**Archivo**: `src/services/auth.service.ts:32,36`

Tanto "usuario no encontrado" como "contraseña incorrecta" lanzan `AppError(..., 404, 'AUTH_001_INVALID_CREDENTIALS')`. El canon fija `401`.

Nota: usar el mismo código y mensaje para ambos casos **es correcto** y debe conservarse — evita enumeración de usuarios. Lo que cambia es 404 → 401.

**Aceptación**: `401` en ambos casos, mensaje indistinguible entre ellos.

---

<a id="deuda-013"></a>
## DEUDA-013 🟠 Unicidad de `code` con criterio distinto en create y update

En create se busca **sin** filtrar por `isActive`; en update **sí** se filtra por `isActive: true`.

```ts
// create — catalogItem.service.ts:23
const existingItem = await CatalogItem.findOne({ where: { catalogTypeId, code } });

// update — catalogItem.service.ts:124
const existingItem = await CatalogItem.findOne({
    where: { code, catalogTypeId, isActive: true, catalogItemId: { [Op.ne]: id } }
});
```

Consecuencia: un código ocupado por un registro **inactivo** bloquea la creación, pero pasa la validación en update. El mismo código es válido o no según por dónde se entre.

**Aceptación**: mismo criterio en ambas (`isActive: true`), documentado en la sección 11 del canon.

---

<a id="deuda-014"></a>
## DEUDA-014 🟠 El update no revalida las FK

`updateCatalogItemService` acepta `catalogTypeId` en el validador, pero el servicio nunca lo valida ni lo aplica. Lo mismo en las demás entidades con FK: la comprobación de existencia y `isActive` solo ocurre en create.

**Aceptación**: el update valida toda FK presente en el payload con el mismo criterio que el create, o la rechaza explícitamente si el cambio de FK no está permitido.

---

<a id="deuda-015"></a>
## DEUDA-015 🟠 Validadores incorrectos y sin spread en `geoLocation.routes.ts`

Tres rutas pasan `updateGeoLocationValidator` **sin `...`**, y dos de ellas lo usan en operaciones que no son un update:

```ts
router.put('/:id',           ..., updateGeoLocationValidator, validateFields, updateGeoLocation);
router.delete('/:id',        ..., updateGeoLocationValidator, validateFields, deleteGeoLocation);
router.patch('/activate/:id',..., updateGeoLocationValidator, validateFields, activateGeoLocation);
```

Sin el spread, el array se monta como un único middleware. Y un DELETE no debe validar el body de un update: debe validar el `:id`.

`auth.routes.ts` también pasa `loginValidator` sin spread.

**Aceptación**: spread en todas; DELETE y PATCH usan `geoLocationIdValidator`.

---

<a id="deuda-016"></a>
## DEUDA-016 🟠 Typo `ESAIV-HF-*` y abreviatura de dos letras

**Archivo**: `src/services/healthFacility.service.ts:9,87`

Los códigos dicen `ESAIV-HF-001` y `ESAIV-HF-002` — `ESAIV` en vez de `ESAVI`. Una búsqueda por `ESAVI-HF` no los encuentra, que es justo lo que el código de operación debe permitir.

Además: la ruta usa `ESAVI-HF-002A` y el controlador `ESAVI-HF-002` para el mismo endpoint, y `HF` es una abreviatura de dos letras, prohibida por el canon (registrada como `HFAC`).

**Aceptación**: `ESAVI-HFAC-*` uniforme en las cinco ubicaciones.

---

<a id="deuda-017"></a>
## DEUDA-017 🟠 CORS abierto en producción

**Archivo**: `src/index.ts:27`

`app.use(cors())` sin configuración, con un `TODO` ya presente en el código.

**Aceptación**: lista de orígenes permitidos por entorno.

---

<a id="deuda-018"></a>
## DEUDA-018 🟠 Sin transacciones fuera de `user.service.ts`

Solo `user.service.ts` usa `sequelize.transaction()`. Los demás servicios hacen varias escrituras dependientes sin envolverlas: un fallo a mitad deja el estado inconsistente.

`setEntityActiveStatusService` acepta un `transaction?` opcional que **ningún llamador le pasa**.

**Aceptación**: transacción en toda operación con más de una escritura dependiente.

---

<a id="deuda-019"></a>
## DEUDA-019 🟡 Sufijos de archivo fuera de norma

| Archivo actual | Debería ser |
|---|---|
| `src/routes/catalogItem.route.ts` | `catalogItem.routes.ts` |
| `src/routes/seed.route.ts` | `seed.routes.ts` |
| `src/models/associations/catalog.association.ts` | `catalog.associations.ts` |
| `src/types/catalog/catalogItem.type.ts` | `catalogItem.types.ts` |
| `src/types/catalog/catalogType.type.ts` | `catalogType.types.ts` |
| `src/types/healthFacility.types.ts` | `src/types/healthFacility/healthFacility.types.ts` |

Además, `src/types/geographical/` usa un adjetivo donde el canon pide un sustantivo (`geography/`).

**Aceptación**: renombrados con sus imports actualizados; `npm run build` pasa.

---

<a id="deuda-020"></a>
## DEUDA-020 🟡 `CreateCatalogItem` sin sufijo `Input`

**Archivo**: `src/types/catalog/catalogItem.type.ts`

Es el único tipo de entrada sin el sufijo. Las otras seis entidades usan `CreateXInput`.

**Aceptación**: renombrado a `CreateCatalogItemInput`.

---

<a id="deuda-021"></a>
## DEUDA-021 🟡 `UpdateGeoLevelTypeInput` declarado y nunca usado

**Archivo**: `src/types/geographical/geoLevelType.types.ts:7`

Se declara y se exporta, pero el servicio usa `Partial<CreateGeoLevelTypeInput>`. Es la única entidad que declara un tipo de update, y está muerto.

**Aceptación**: se elimina; el canon fija `Partial<CreateXInput>`.

---

<a id="deuda-022"></a>
## DEUDA-022 🟡 Código duplicado en `healthFacility.service.ts`

**Archivo**: `src/services/healthFacility.service.ts:106-140`

Contiene copias literales de `getActiveCatalogItemsByTypeService`, `getAllCatalogItemsByTypeService` y `getCatalogItemByIdService` — mismos nombres que en `catalogItem.service.ts`, con sus comentarios `ESAVI-CATITEM-002A/B/C` y sus códigos de error `CATITEM_*`. No se exportan en el bloque final: son código muerto copiado.

**Aceptación**: eliminadas.

---

<a id="deuda-023"></a>
## DEUDA-023 🟡 Código comentado obsoleto

- `src/routes/geoLocation.routes.ts:47-53` — bloque comentado con rutas de **geoLevelType**, que además usan `/:id/activate` en vez de `/activate/:id`.
- `src/middlewares/roleValidation.middleware.ts:5-20` — implementación anterior de `validateUserRole`, por nombre en vez de por nivel.
- `src/helpers/crypto.helper.ts:18-23,39-54` — variante GCM comentada.
- `src/services/auth.service.ts:46-48,55-58` — campos comentados en el payload del JWT.

**Aceptación**: eliminados. El historial lo guarda git.

---

<a id="deuda-024"></a>
## DEUDA-024 🟡 `loginController` y `const route`

- `src/controllers/auth.controller.ts` — `loginController` es el único controlador con sufijo `Controller`. Debería ser `login`.
- `src/routes/geoLocation.routes.ts` — usa `const route = Router()` y `export default route`. El canon fija `router`.

---

<a id="deuda-025"></a>
## DEUDA-025 🟡 Falta `geoLevelTypeIdValidator`

**Archivo**: `src/validators/geoLevelType.validator.ts`

Es la única entidad sin validador de id, y por eso sus rutas con `:id` no validan el UUID. Bloquea parte de [DEUDA-006](#deuda-006).

---

<a id="deuda-026"></a>
## DEUDA-026 🟡 Paginación duplicada y hardcodeada

`geoLevelType.service.ts:8-9` y `geoLocation.service.ts:7-8` declaran `DEFAULT_LIMIT`/`DEFAULT_OFFSET` por duplicado; `catalogItem`, `catalogType` y `healthFacility` hardcodean `10` y `0` sin leer el entorno. `healthFacility.controller.ts:30-31` resuelve el default en el controlador en vez de en el servicio.

**Aceptación**: una única constante compartida leída del entorno; el default se resuelve siempre en el servicio.

---

<a id="deuda-027"></a>
## DEUDA-027 🟡 `AppDetails` declarado y nunca importado

**Archivo**: `src/types/common/audit.types.ts:16`

El tipo existe y los modelos lo usan, pero **ningún servicio lo importa**: todos los objetos de auditoría son literales inline sin tipar. Un typo en `method` o un campo faltante no lo detecta el compilador.

---

<a id="deuda-028"></a>
## DEUDA-028 🟡 `AuthUser` y `Express.Request['user']` divergen

`AuthUser` (`src/types/user/user.types.ts`) y la extensión de `Express.Request` (`src/types/express/index.d.ts`) son estructuras distintas y no vinculadas. De ahí el `req.user as AuthUser` repetido en todos los controladores, y el `{ userId: req.user?.userId } as AuthUser` que construye un objeto incompleto.

Además `tokenValidation` puebla `roles` con `{ name, level }`, mientras `UserRole` declara `roleId` y `code` como obligatorios.

**Aceptación**: un solo tipo; `Express.Request['user']` es `AuthUser`. Los casts desaparecen.

---

<a id="deuda-029"></a>
## DEUDA-029 🟡 Barrels de `types/` con dos estilos

`types/catalog/index.ts` y `types/common/index.ts` usan `export * from`; `types/geographical/index.ts` y `types/user/index.ts` usan re-export nominal explícito. Con el nominal, un tipo nuevo no se exporta hasta que alguien lo añade a mano.

**Aceptación**: `export * from` en todos.

---

<a id="deuda-030"></a>
## DEUDA-030 🟡 Sin tests ni linter

`npm test` sale con error; no hay ESLint ni Prettier configurados. Nada de este documento es verificable automáticamente: las reglas del canon se comprueban leyendo.

**Aceptación**: ESLint con reglas de nomenclatura (`@typescript-eslint/naming-convention`) y una suite mínima sobre el contrato de respuesta y la matriz de roles.

---

<a id="deuda-031"></a>
## DEUDA-031 🔴 `roles.constants.ts` lee variables de entorno que no existen

**Archivo**: `src/constants/roles.constants.ts:2-5`

Lee `ROLE_SUPERADMIN`, `ROLE_ADMIN`, `ROLE_USER` y `ROLE_ANALYTICS`. Ninguna está declarada en `.env.example`, `.env.development` ni `.env.production`. Lo que sí existe en `.env.example` es `ESAVI_SUPERADMIN=SUPERADMIN_ROLE`, que nadie lee.

Hoy funciona porque los cuatro caen a su valor por defecto. Pero si alguien define `ROLE_SUPERADMIN='SUPERADMIN_ROLE'` creyendo que es la variable buena, `ROLE_LEVELS` se indexa con esa cadena, deja de coincidir con el `name` que la BD devuelve, y `validateUserRole` calcula nivel 0 para todos: **403 en toda la API**.

**Aceptación**: un solo juego de nombres de variable, presente en `.env.example` y en los dos `.env.*`, o los defaults como única fuente y las variables eliminadas del código.

---

<a id="deuda-032"></a>
## DEUDA-032 🟠 Los middlewares construyen respuestas de error a mano

`tokenValidation.middleware.ts` (cinco veces) y `roleValidation.middleware.ts` (una) responden con `res.status(...).json({ ok: false, message, error })` en vez de pasar por `AppError` y `errorHandler`.

Consecuencia: esas respuestas llevan la clave `error`, no `errors` ni `code`, y exponen el mensaje real del error también en producción — justo lo que `errorHandler` evita.

**Aceptación**: los dos middlewares lanzan `AppError` con su código de operación y dejan que `errorHandler` construya la respuesta.

---

<a id="deuda-033"></a>
## DEUDA-033 🟠 `tokenValidation` deja `email` y `displayName` cifrados en `req.user`

**Archivo**: `src/middlewares/tokenValidation.middleware.ts:63-68`

Toma `email` y `displayName` directamente del modelo, que los almacena cifrados con `esaviCrypt`, y los adjunta a `req.user` sin `esaviDecrypt`. `loginService` sí descifra antes de responder.

Cualquier consumidor de `req.user.email` obtiene el texto cifrado. Hoy nadie lo usa, y por eso no se ha notado.

**Aceptación**: `req.user` contiene los mismos valores descifrados que devuelve el login.

---

<a id="deuda-034"></a>
## DEUDA-034 🟠 Reasignar `parentGeoLocationId` puede crear un ciclo

Detectada al redactar el [SPEC 04](./specs/04-data-contract-consistency.md), que habilita el cambio de FK en el update.

Nada impide asignar como padre de una ubicación a uno de sus propios descendientes, ni a sí misma. El árbol geográfico queda con un ciclo, y cualquier recorrido recursivo sobre él no termina.

**Aceptación**: el update rechaza con 409 un `parentGeoLocationId` que sea la propia ubicación o uno de sus descendientes.

---

<a id="deuda-035"></a>
## DEUDA-035 🟡 `canViewInactive` exige SUPERADMIN; la matriz dice ADMIN

**Archivo**: `src/helpers/permissions.helper.ts`

`canViewInactive` devuelve verdadero solo para SUPERADMIN. La matriz canónica de la sección 9 fija el listado que incluye inactivos (`002B`) en **ADMIN**.

El resultado: un ADMIN pasa el middleware de una ruta declarada `ADMIN` y recibe únicamente los registros activos, sin ninguna señal de que se le está filtrando.

**Aceptación**: `canViewInactive` admite ADMIN, o la matriz canónica se corrige a SUPERADMIN. Las dos fuentes deben decir lo mismo.

---

<a id="deuda-036"></a>
## DEUDA-036 🟡 Quedan 8 `console.log` en `src/` fuera del alcance del SPEC 06

Detectada al implementar el [SPEC 06](./specs/06-naming-and-types.md), cuyo alcance solo cubría los dos `console.log` de depuración que sí eliminó.

No son homogéneos y por eso no se tratan juntos:

| Ubicación | Qué es |
|---|---|
| `health.controller.ts:4-5` | depuración olvidada: vuelca `req.query.lang` y `req.lang` en cada petición de salud |
| `geoLocation.service.ts:254` | depuración olvidada: `console.log('ACTUALIZA')` |
| `connection.ts:40`, `index.ts:96-98` | banner de arranque; salida intencional, pero esquiva `esaviLog` |
| `connection.ts:28` | `logging: env === 'development' ? console.log : false`; es el logger que recibe Sequelize, no un log suelto |

Los dos primeros grupos se eliminan o pasan a `esaviLog`. El último es funcional: cambiarlo altera el comportamiento en desarrollo.

**Aceptación**: los tres `console.log` de depuración no existen; los cuatro del banner salen por `esaviLog`; `connection.ts:28` se documenta como uso legítimo o se sustituye por un logger explícito.
