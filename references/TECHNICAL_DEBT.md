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

Un ✅ delante del título marca la entrada como **saldada**: el spec que la cierra ya está implementado y verificado. La entrada se conserva con su descripción original, para que el diagnóstico siga siendo legible.

## Resumen

| ID | Severidad | Título |
|---|---|---|
| [DEUDA-001](#deuda-001) | 🔴 | ✅ `setEntityActiveStatusService` ignora `notFoundMessage` |
| [DEUDA-002](#deuda-002) | 🔴 | ✅ Endpoint de seed sin autenticación |
| [DEUDA-003](#deuda-003) | 🔴 | ✅ Tres claves i18n referenciadas que no existen |
| [DEUDA-004](#deuda-004) | 🔴 | ✅ `nd.json` tiene 23 de 124 claves |
| [DEUDA-005](#deuda-005) | 🔴 | ✅ `DELETE /catalog-types/:id` declara rol `USER` |
| [DEUDA-006](#deuda-006) | 🔴 | ✅ Siete rutas sin `validateFields` ni validadores |
| [DEUDA-007](#deuda-007) | 🔴 | ✅ `limit` / `offset` sin validar llegan como `NaN` a Sequelize |
| [DEUDA-008](#deuda-008) | 🟠 | ✅ Códigos `ESAVI-*` desalineados entre capas |
| [DEUDA-009](#deuda-009) | 🟠 | ✅ Guards de rol duplicados dentro de los controladores |
| [DEUDA-010](#deuda-010) | 🟠 | ✅ `validateUserRole(SUPERADMIN, ADMIN)` exige 100, no 50 |
| [DEUDA-011](#deuda-011) | 🟠 | ✅ 400 vs 409 para el mismo caso de duplicado |
| [DEUDA-012](#deuda-012) | 🟠 | ✅ Login responde 404 ante credenciales inválidas |
| [DEUDA-013](#deuda-013) | 🟠 | ✅ Unicidad de `code` con criterio distinto en create y update |
| [DEUDA-014](#deuda-014) | 🟠 | ✅ El update no revalida las FK |
| [DEUDA-015](#deuda-015) | 🟠 | ✅ Validadores incorrectos y sin spread en `geoLocation.routes.ts` |
| [DEUDA-016](#deuda-016) | 🟠 | ✅ Typo `ESAIV-HF-*` y abreviatura de dos letras |
| [DEUDA-017](#deuda-017) | 🟠 | ✅ CORS abierto en producción |
| [DEUDA-018](#deuda-018) | 🟠 | ✅ Sin transacciones fuera de `user.service.ts` |
| [DEUDA-019](#deuda-019) | 🟡 | ✅ Sufijos de archivo fuera de norma |
| [DEUDA-020](#deuda-020) | 🟡 | ✅ `CreateCatalogItem` sin sufijo `Input` |
| [DEUDA-021](#deuda-021) | 🟡 | ✅ `UpdateGeoLevelTypeInput` declarado y nunca usado |
| [DEUDA-022](#deuda-022) | 🟡 | ✅ Código duplicado en `healthFacility.service.ts` |
| [DEUDA-023](#deuda-023) | 🟡 | ✅ Código comentado obsoleto |
| [DEUDA-024](#deuda-024) | 🟡 | ✅ `loginController` y `const route` |
| [DEUDA-025](#deuda-025) | 🟡 | ✅ Falta `geoLevelTypeIdValidator` |
| [DEUDA-026](#deuda-026) | 🟡 | ✅ Paginación duplicada y hardcodeada |
| [DEUDA-027](#deuda-027) | 🟡 | ✅ `AppDetails` declarado y nunca importado |
| [DEUDA-028](#deuda-028) | 🟡 | ✅ `AuthUser` y `Express.Request['user']` divergen |
| [DEUDA-029](#deuda-029) | 🟡 | ✅ Barrels de `types/` con dos estilos |
| [DEUDA-030](#deuda-030) | 🟡 | ✅ Sin tests ni linter |
| [DEUDA-031](#deuda-031) | 🔴 | `roles.constants.ts` lee variables de entorno que no existen |
| [DEUDA-032](#deuda-032) | 🟠 | Los middlewares construyen respuestas de error a mano |
| [DEUDA-033](#deuda-033) | 🟠 | `tokenValidation` deja `email` y `displayName` cifrados en `req.user` |
| [DEUDA-034](#deuda-034) | 🟠 | Reasignar `parentGeoLocationId` puede crear un ciclo |
| [DEUDA-035](#deuda-035) | 🟠 | `canViewInactive` exige SUPERADMIN; la matriz dice ADMIN |
| [DEUDA-036](#deuda-036) | 🟡 | El banner de arranque esquiva `esaviLog` |
| [DEUDA-037](#deuda-037) | 🟠 | ✅ `DEFAULT_LANGUAGE` se lee antes de que `dotenv` pueble el entorno |
| [DEUDA-038](#deuda-038) | 🟠 | ✅ El idioma resuelto no llega desde el controlador al servicio |
| [DEUDA-039](#deuda-039) | 🔴 | ✅ `geoPolygon` no coincide con la columna `geopolygon` del SQL |
| [DEUDA-040](#deuda-040) | 🟠 | El validador de update anuncia `isActive` y el servicio lo ignora |
| [DEUDA-041](#deuda-041) | 🟠 | ✅ Seis servicios de update escriben aunque no cambie ningún dato |
| [DEUDA-042](#deuda-042) | 🟠 | Tres endpoints rechazan con 400 la respuesta de su propio `GET` |
| [DEUDA-043](#deuda-043) | 🟡 | `sortOrder: 0` no se puede guardar en tres servicios |
| [DEUDA-044](#deuda-044) | 🟠 | ✅ `notificationOrganization` se guarda en mayúsculas y su caso de contrato falla |
| [DEUDA-045](#deuda-045) | 🟠 | `appDetails.user` expone el UUID interno del usuario en toda respuesta |
| [DEUDA-046](#deuda-046) | 🔴 | El rate limit se cuenta por IP y sin `trust proxy` |

## Mapa de resolución

La serie de specs de [`specs/`](./specs/) cubre las entradas 001–030, el
SPEC 08 cubre 037 y 038, el SPEC 09 cubre 039 y el SPEC F12 cubre 041 — de esta
última, el SPEC F09 había corregido por adelantado la única entidad que él mismo
estrenaba. Las entradas 031–036, 040, 042, 043, 045 y 046 todavía no tienen
spec; 042 y 043 las detectó el propio SPEC F12 al implementarse.

**Saldadas a 2026-08-03**: las 30 entradas 001–030, por los siete specs de la
serie, más 037 y 038 por el SPEC 08. Los ocho specs están en estado
Implementado.

Tres se cerraron por una vía distinta a la que proponía su «Aceptación», y la
nota de cada una lo hace constar: **002** (el router de seed deja de montarse en
producción, en vez de exigir SUPERADMIN), **013** (unicidad **sin** filtrar por
`isActive`, alineada con las UNIQUE del DDL, en vez de con `isActive: true`) y
**018** (alcance reducido a conectar el `transaction` del servicio genérico).

| Spec | Entradas que cierra |
|---|---|
| [01 — Autorización y superficie expuesta](./specs/01-authorization-and-exposure.md) | 002, 005, 009, 010, 012, 017 |
| [02 — Validación de entrada y paginación](./specs/02-input-validation.md) | 006, 007, 015, 025, 026 |
| [03 — Paridad i18n](./specs/03-i18n-parity.md) | 003, 004 |
| [04 — Contrato de conflicto y consistencia](./specs/04-data-contract-consistency.md) | 001, 011, 013, 014, 018 |
| [05 — Códigos de operación](./specs/05-operation-codes.md) | 008, 016 |
| [06 — Nomenclatura, tipos y código muerto](./specs/06-naming-and-types.md) | 019, 020, 021, 022, 023, 024, 027, 028, 029 |
| [07 — Linter y suite mínima](./specs/07-tooling-and-tests.md) | 030 |
| [08 — Idioma efectivo](./specs/08-language-propagation.md) | 037, 038 |
| [09 — CRUD de healthFacility](./specs/09-healthfacility-crud.md) | 039 |
| [F12 — Update diferencial uniforme](./functional/specs/12-differential.md) | 041 |
| sin spec | 031, 032, 033, 034, 035, 036, 040, 042, 043, 045, 046 |

Orden de ejecución: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08. El 05 renumera
líneas que tocan el 01, el 02 y el 04; el 06 renombra archivos que editan los
cinco anteriores; el 07 escribe la suite contra el comportamiento ya corregido;
el 08 depende del 03, que garantizó que las claves existan en los tres idiomas.

**El SPEC 08 desvía la numeración que él mismo propone**: fue redactado el
2026-08-02 pidiendo registrar sus dos hallazgos como DEUDA-036 y DEUDA-037,
pero el 2026-08-03 el SPEC 06 ocupó el 036 con el banner de arranque. Los IDs
son estables, así que los hallazgos del 08 son [DEUDA-037](#deuda-037) y
[DEUDA-038](#deuda-038).

**El SPEC 04 corrige la aceptación escrita en [DEUDA-013](#deuda-013)**: el
criterio correcto es *sin* filtrar por `isActive`, no `isActive: true`. Ver
las decisiones de ese spec.

---

<a id="deuda-001"></a>
## DEUDA-001 🔴 ✅ `setEntityActiveStatusService` ignora `notFoundMessage`

> ✅ **Saldada** por el [SPEC 04](./specs/04-data-contract-consistency.md) el 2026-08-03. La línea 25 de `entityActivation.service.ts` lanza `AppError(options.notFoundMessage, ...)`. Cada entidad devuelve su propio mensaje.

**Archivo**: `src/services/common/entityActivation.service.ts:29`

Recibe `options.notFoundMessage` y no lo usa: siempre emite el mensaje de `geoLevelType`, para todas las entidades.

```ts
throw new AppError(getMessage('geoLevelType.notFound', options.lang || 'en'), 404, options.notFoundCode);
```

Borrar un `catalogItem` inexistente responde "Tipo de nivel geográfico no encontrado". Afecta a las cuatro entidades que usan el servicio genérico.

**Aceptación**: usa `options.notFoundMessage`; borrar cada entidad inexistente devuelve su propio mensaje.

---

<a id="deuda-002"></a>
## DEUDA-002 🔴 ✅ Endpoint de seed sin autenticación

> ✅ **Saldada** por el [SPEC 01](./specs/01-authorization-and-exposure.md) el 2026-08-03. Cerrada por la segunda vía que la propia Aceptación admitía, no por la primera: `src/routes/index.ts:18-20` no monta `/seed` cuando `NODE_ENV === "production"`. El middleware sigue comentado en `seed.routes.ts` a propósito, y en el resto de entornos el gate `?enable=SEED_ACTION` se conserva.

**Archivo**: `src/routes/seed.route.ts:8-9`

`tokenValidation` y `validateUserRole` están comentados. `POST /api/seed/admin` solo está protegido por que `?enable=` coincida con `SEED_ACTION`, un valor de entorno.

**Aceptación**: el endpoint exige `SUPERADMIN`, o se elimina del router en producción.

---

<a id="deuda-003"></a>
## DEUDA-003 🔴 ✅ Tres claves i18n referenciadas que no existen

> ✅ **Saldada** por el [SPEC 03](./specs/03-i18n-parity.md) el 2026-08-03. `auth.loginFailed` existe en los tres idiomas; `catalogItem.updateFailed` y `facilityType.notFound` ya no se referencian desde el código. `npm run i18n:check` no reporta referencias sin resolver.

`getMessage` devuelve **cadena vacía** cuando la clave falta, así que el cliente recibe `message: ""` sin ningún error visible.

| Clave | Referenciada en | Nota |
|---|---|---|
| `auth.loginFailed` | `src/controllers/auth.controller.ts:21` | no existe en ningún JSON |
| `catalogItem.updateFailed` | `src/controllers/catalogItem.controller.ts:110` | el JSON define `updatedFailed` |
| `facilityType.notFound` | `src/services/healthFacility.service.ts:35` | el namespace `facilityType` no existe |

**Aceptación**: las tres resuelven a texto en los tres idiomas.

---

<a id="deuda-004"></a>
## DEUDA-004 🔴 ✅ `nd.json` tiene 23 de 124 claves

> ✅ **Saldada** por el [SPEC 03](./specs/03-i18n-parity.md) el 2026-08-03. `nd.json` renombrado a `nl.json`, con los tres catálogos a 132 claves idénticas. Verificado por `npm run i18n:check` y fijado por el bloque de paridad de `tests/i18n/messages.test.ts`: borrar o vaciar una clave de `nl.json` rompe la suite.

**Archivo**: `src/data/i18n/nd.json`

`es.json` y `en.json` están a la par (124 claves, cero diferencias). `nd.json` solo cubre `common`, `seed`, `auth`, `crypto`, `user` y `role`, y de forma parcial. Faltan **101 claves**, incluidos los namespaces completos de `geoLevelType`, `geoLocation`, `catalogType`, `catalogItem` y `healthFacility`.

`nd` está en `SUPPORTED_LANGUAGES`, así que un cliente que lo pida recibe la mayoría de respuestas con `message: ""`.

**Aceptación**: paridad de claves con `es.json`, o `nd` sale de `SUPPORTED_LANGUAGES` hasta completarse.

---

<a id="deuda-005"></a>
## DEUDA-005 🔴 ✅ `DELETE /catalog-types/:id` declara rol `USER`

> ✅ **Saldada** por el [SPEC 01](./specs/01-authorization-and-exposure.md) el 2026-08-03. `catalogType.routes.ts:29` declara `ADMIN`. Fijado por `tests/auth/roles.test.ts` (regla `ESAVI-CATTYPE-005A`): un USER recibe 403.

**Archivo**: `src/routes/catalogType.routes.ts`

La ruta declara `validateUserRole(USER)` (nivel ≥ 25). Lo único que impide que cualquier usuario autenticado borre un tipo de catálogo es el guard `isSuperAdmin` dentro del controlador (`catalogType.controller.ts:96`). Si se retira ese guard al limpiar [DEUDA-009](#deuda-009), el endpoint queda abierto.

Debe corregirse **antes** que DEUDA-009, no después.

**Aceptación**: la ruta declara `ADMIN` conforme a la matriz canónica.

---

<a id="deuda-006"></a>
## DEUDA-006 🔴 ✅ Siete rutas sin `validateFields` ni validadores

> ✅ **Saldada** por el [SPEC 02](./specs/02-input-validation.md) el 2026-08-03. Las 19 rutas con `:id` llevan su validador seguido de `validateFields`; ninguna queda sin él.

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
## DEUDA-007 🔴 ✅ `limit` / `offset` sin validar llegan como `NaN` a Sequelize

> ✅ **Saldada** por el [SPEC 02](./specs/02-input-validation.md) el 2026-08-03. Los cinco `*ListValidator` aplican `isInt({ min: 1, max: 100 })` a `limit` e `isInt({ min: 0 })` a `offset`.

Ningún endpoint valida los parámetros de paginación. En el estilo dominante:

```ts
const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
```

`?limit=abc` produce `NaN`, que se pasa tal cual a Sequelize. Tampoco hay tope máximo: `?limit=999999` es una petición válida.

**Aceptación**: `entityListValidator` con `isInt({ min: 1, max: 100 })` para `limit` y `isInt({ min: 0 })` para `offset`, aplicado en todos los listados.

---

<a id="deuda-008"></a>
## DEUDA-008 🟠 ✅ Códigos `ESAVI-*` desalineados entre capas

> ✅ **Saldada** por el [SPEC 05](./specs/05-operation-codes.md) el 2026-08-03. Las entidades usan la numeración canónica `001 / 002[A|B] / 003 / 004 / 005A / 005B` de forma idéntica en las cinco ubicaciones.

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
## DEUDA-009 🟠 ✅ Guards de rol duplicados dentro de los controladores

> ✅ **Saldada** por el [SPEC 01](./specs/01-authorization-and-exposure.md) el 2026-08-03. Cero ocurrencias de `isSuperAdmin` y cero `status(403)` en `src/controllers/`. La autorización vive solo en la ruta.

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
## DEUDA-010 🟠 ✅ `validateUserRole(SUPERADMIN, ADMIN)` exige 100, no 50

> ✅ **Saldada** por el [SPEC 01](./specs/01-authorization-and-exposure.md) el 2026-08-03. `grep -rnE "validateUserRole\([^)]*," src/routes/` no devuelve nada: ninguna ruta pasa más de un rol.

**Archivo**: `src/routes/geoLevelType.routes.ts` — `GET /geo-level-types/`

`validateUserRole` aplica `Math.max` sobre los niveles requeridos, de modo que pasar dos roles exige el **mayor**, no el menor. La ruta aparenta admitir ADMIN pero en la práctica es solo-SUPERADMIN.

**Aceptación**: se pasa un solo rol, el nivel mínimo admitido. Opcionalmente, `validateUserRole` usa `Math.min` y se documenta — pero el canon prefiere un solo argumento.

---

<a id="deuda-011"></a>
## DEUDA-011 🟠 ✅ 400 vs 409 para el mismo caso de duplicado

> ✅ **Saldada** por el [SPEC 04](./specs/04-data-contract-consistency.md) el 2026-08-03. Todos los duplicados responden 409. Fijado por `tests/contract/response.test.ts`, que cubre el duplicado en create y en update; degradar cualquiera de los dos a 400 rompe la suite.

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
## DEUDA-012 🟠 ✅ Login responde 404 ante credenciales inválidas

> ✅ **Saldada** por el [SPEC 01](./specs/01-authorization-and-exposure.md) el 2026-08-03. `auth.service.ts:32,36` lanzan 401 en ambos casos, con mensaje y código idénticos entre sí.

**Archivo**: `src/services/auth.service.ts:32,36`

Tanto "usuario no encontrado" como "contraseña incorrecta" lanzan `AppError(..., 404, 'AUTH_001_INVALID_CREDENTIALS')`. El canon fija `401`.

Nota: usar el mismo código y mensaje para ambos casos **es correcto** y debe conservarse — evita enumeración de usuarios. Lo que cambia es 404 → 401.

**Aceptación**: `401` en ambos casos, mensaje indistinguible entre ellos.

---

<a id="deuda-013"></a>
## DEUDA-013 🟠 ✅ Unicidad de `code` con criterio distinto en create y update

> ✅ **Saldada** por el [SPEC 04](./specs/04-data-contract-consistency.md) el 2026-08-03. Resuelta con el criterio **contrario** al que proponía la Aceptación original. El spec fijó la unicidad **sin** filtrar por `isActive`, alineada con las UNIQUE reales del DDL, en vez de `isActive: true`. Los cuatro servicios aplican ese mismo criterio en create y en update.

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
## DEUDA-014 🟠 ✅ El update no revalida las FK

> ✅ **Saldada** por el [SPEC 04](./specs/04-data-contract-consistency.md) el 2026-08-03. `updateCatalogItemService:125-136` valida `catalogTypeId` cuando viene en el payload, con el criterio del create.

`updateCatalogItemService` acepta `catalogTypeId` en el validador, pero el servicio nunca lo valida ni lo aplica. Lo mismo en las demás entidades con FK: la comprobación de existencia y `isActive` solo ocurre en create.

**Aceptación**: el update valida toda FK presente en el payload con el mismo criterio que el create, o la rechaza explícitamente si el cambio de FK no está permitido.

---

<a id="deuda-015"></a>
## DEUDA-015 🟠 ✅ Validadores incorrectos y sin spread en `geoLocation.routes.ts`

> ✅ **Saldada** por el [SPEC 02](./specs/02-input-validation.md) el 2026-08-03. Todos los validadores se pasan con spread; ninguna ruta lo omite.

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
## DEUDA-016 🟠 ✅ Typo `ESAIV-HF-*` y abreviatura de dos letras

> ✅ **Saldada** por el [SPEC 05](./specs/05-operation-codes.md) el 2026-08-03. Los códigos son `ESAVI-HFAC-001` y `ESAVI-HFAC-002`. `ESAIV` solo sobrevive en `src/logs/esaviLog.log`, que está gitignored.

**Archivo**: `src/services/healthFacility.service.ts:9,87`

Los códigos dicen `ESAIV-HF-001` y `ESAIV-HF-002` — `ESAIV` en vez de `ESAVI`. Una búsqueda por `ESAVI-HF` no los encuentra, que es justo lo que el código de operación debe permitir.

Además: la ruta usa `ESAVI-HF-002A` y el controlador `ESAVI-HF-002` para el mismo endpoint, y `HF` es una abreviatura de dos letras, prohibida por el canon (registrada como `HFAC`).

**Aceptación**: `ESAVI-HFAC-*` uniforme en las cinco ubicaciones.

---

<a id="deuda-017"></a>
## DEUDA-017 🟠 ✅ CORS abierto en producción

> ✅ **Saldada** por el [SPEC 01](./specs/01-authorization-and-exposure.md) el 2026-08-03. `src/app.ts:55` monta `cors()` con la lista blanca de `CORS_ORIGINS`, obligatoria cuando `NODE_ENV=production`.

**Archivo**: `src/index.ts:27`

`app.use(cors())` sin configuración, con un `TODO` ya presente en el código.

**Aceptación**: lista de orígenes permitidos por entorno.

---

<a id="deuda-018"></a>
## DEUDA-018 🟠 ✅ Sin transacciones fuera de `user.service.ts`

> ✅ **Saldada** por el [SPEC 04](./specs/04-data-contract-consistency.md) el 2026-08-03. Saldada con el alcance que el spec redujo a propósito: el `transaction` de `setEntityActiveStatusService` queda conectado en sus llamadores, y queda registrado que hoy ninguna otra operación es multi-escritura. Envolver operaciones de una sola escritura se descartó explícitamente.

Solo `user.service.ts` usa `sequelize.transaction()`. Los demás servicios hacen varias escrituras dependientes sin envolverlas: un fallo a mitad deja el estado inconsistente.

`setEntityActiveStatusService` acepta un `transaction?` opcional que **ningún llamador le pasa**.

**Aceptación**: transacción en toda operación con más de una escritura dependiente.

---

<a id="deuda-019"></a>
## DEUDA-019 🟡 ✅ Sufijos de archivo fuera de norma

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Los siete movimientos se hicieron con `git mv`, en un commit sin cambios de contenido; `git log --follow` cruza el renombrado con similitud `R100`.

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
## DEUDA-020 🟡 ✅ `CreateCatalogItem` sin sufijo `Input`

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Renombrado a `CreateCatalogItemInput` en la declaración y en sus tres usos de `catalogItem.service.ts`.

**Archivo**: `src/types/catalog/catalogItem.type.ts`

Es el único tipo de entrada sin el sufijo. Las otras seis entidades usan `CreateXInput`.

**Aceptación**: renombrado a `CreateCatalogItemInput`.

---

<a id="deuda-021"></a>
## DEUDA-021 🟡 ✅ `UpdateGeoLevelTypeInput` declarado y nunca usado

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Eliminada la interfaz y su re-export en el barrel de `geography/`.

**Archivo**: `src/types/geographical/geoLevelType.types.ts:7`

Se declara y se exporta, pero el servicio usa `Partial<CreateGeoLevelTypeInput>`. Es la única entidad que declara un tipo de update, y está muerto.

**Aceptación**: se elimina; el canon fija `Partial<CreateXInput>`.

---

<a id="deuda-022"></a>
## DEUDA-022 🟡 ✅ Código duplicado en `healthFacility.service.ts`

> ✅ **Saldada**, verificada por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Las tres copias ya no estaban al llegar el spec: un spec anterior de la serie las eliminó. Comprobado que las tres funciones tienen una única definición, en `catalogItem.service.ts`.

**Archivo**: `src/services/healthFacility.service.ts:106-140`

Contiene copias literales de `getActiveCatalogItemsByTypeService`, `getAllCatalogItemsByTypeService` y `getCatalogItemByIdService` — mismos nombres que en `catalogItem.service.ts`, con sus comentarios `ESAVI-CATITEM-002A/B/C` y sus códigos de error `CATITEM_*`. No se exportan en el bloque final: son código muerto copiado.

**Aceptación**: eliminadas.

---

<a id="deuda-023"></a>
## DEUDA-023 🟡 ✅ Código comentado obsoleto

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Eliminados los cuatro bloques, más la línea 13 de `crypto.helper.ts` —una quinta variante muerta que esta entrada no listaba— y los dos `console.log` de `geoLocation.controller.ts` y `tokenValidation.middleware.ts`. Los ocho `console.log` restantes en `src/` quedaron fuera de alcance: ver [DEUDA-036](#deuda-036).

- `src/routes/geoLocation.routes.ts:47-53` — bloque comentado con rutas de **geoLevelType**, que además usan `/:id/activate` en vez de `/activate/:id`.
- `src/middlewares/roleValidation.middleware.ts:5-20` — implementación anterior de `validateUserRole`, por nombre en vez de por nivel.
- `src/helpers/crypto.helper.ts:18-23,39-54` — variante GCM comentada.
- `src/services/auth.service.ts:46-48,55-58` — campos comentados en el payload del JWT.

**Aceptación**: eliminados. El historial lo guarda git.

---

<a id="deuda-024"></a>
## DEUDA-024 🟡 ✅ `loginController` y `const route`

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. `loginController` → `login` (declaración, export, import y handler de la ruta); `const route` → `const router` en los 8 puntos de `geoLocation.routes.ts`.

- `src/controllers/auth.controller.ts` — `loginController` es el único controlador con sufijo `Controller`. Debería ser `login`.
- `src/routes/geoLocation.routes.ts` — usa `const route = Router()` y `export default route`. El canon fija `router`.

---

<a id="deuda-025"></a>
## DEUDA-025 🟡 ✅ Falta `geoLevelTypeIdValidator`

> ✅ **Saldada** por el [SPEC 02](./specs/02-input-validation.md) el 2026-08-03. `geoLevelTypeIdValidator` existe en `src/validators/geoLevelType.validator.ts:3`.

**Archivo**: `src/validators/geoLevelType.validator.ts`

Es la única entidad sin validador de id, y por eso sus rutas con `:id` no validan el UUID. Bloquea parte de [DEUDA-006](#deuda-006).

---

<a id="deuda-026"></a>
## DEUDA-026 🟡 ✅ Paginación duplicada y hardcodeada

> ✅ **Saldada** por el [SPEC 02](./specs/02-input-validation.md) el 2026-08-03. `src/constants/pagination.constants.ts` es la única fuente, leída del entorno, e importada por los cinco servicios. El default se resuelve en el servicio.

`geoLevelType.service.ts:8-9` y `geoLocation.service.ts:7-8` declaran `DEFAULT_LIMIT`/`DEFAULT_OFFSET` por duplicado; `catalogItem`, `catalogType` y `healthFacility` hardcodean `10` y `0` sin leer el entorno. `healthFacility.controller.ts:30-31` resuelve el default en el controlador en vez de en el servicio.

**Aceptación**: una única constante compartida leída del entorno; el default se resuelve siempre en el servicio.

---

<a id="deuda-027"></a>
## DEUDA-027 🟡 ✅ `AppDetails` declarado y nunca importado

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Los seis servicios lo importan; 11 objetos de auditoría se extrajeron a constantes anotadas y otros 4 quedan cubiertos al tipar `ActivationOptions.appDetail` como `AppDetails`. Verificado: un typo en una clave rompe la compilación con `TS2561`.

**Archivo**: `src/types/common/audit.types.ts:16`

El tipo existe y los modelos lo usan, pero **ningún servicio lo importa**: todos los objetos de auditoría son literales inline sin tipar. Un typo en `method` o un campo faltante no lo detecta el compilador.

---

<a id="deuda-028"></a>
## DEUDA-028 🟡 ✅ `AuthUser` y `Express.Request['user']` divergen

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. `Express.Request['user']` es ahora `AuthUser`; `UserRole` declara `roleId` y `code` como opcionales, describiendo lo que el token puebla de verdad. Los 25 casts desaparecieron. Al quitarlos aflora que `req.user` es opcional y sus consumidores lo exigían obligatorio: los 8 predicados de `permissions.helper.ts` y `CreateUserServiceParams.authUser` pasaron a opcionales. Es corrección de tipo pura — `hasAnyRole` ya devolvía `false` ante `undefined`.

`AuthUser` (`src/types/user/user.types.ts`) y la extensión de `Express.Request` (`src/types/express/index.d.ts`) son estructuras distintas y no vinculadas. De ahí el `req.user as AuthUser` repetido en todos los controladores, y el `{ userId: req.user?.userId } as AuthUser` que construye un objeto incompleto.

Además `tokenValidation` puebla `roles` con `{ name, level }`, mientras `UserRole` declara `roleId` y `code` como obligatorios.

**Aceptación**: un solo tipo; `Express.Request['user']` es `AuthUser`. Los casts desaparecen.

---

<a id="deuda-029"></a>
## DEUDA-029 🟡 ✅ Barrels de `types/` con dos estilos

> ✅ **Saldada** por el [SPEC 06](./specs/06-naming-and-types.md) el 2026-08-03. Los cuatro barrels usan `export * from`. El caso que lo justificaba estaba vivo: `UserRole` llevaba tiempo declarado pero ausente del barrel nominal, así que no era importable desde `../types`.

`types/catalog/index.ts` y `types/common/index.ts` usan `export * from`; `types/geographical/index.ts` y `types/user/index.ts` usan re-export nominal explícito. Con el nominal, un tipo nuevo no se exporta hasta que alguien lo añade a mano.

**Aceptación**: `export * from` en todos.

---

<a id="deuda-030"></a>
## DEUDA-030 🟡 ✅ Sin tests ni linter

> ✅ **Saldada** por el [SPEC 07](./specs/07-tooling-and-tests.md) el 2026-08-03. Jest + ts-jest + supertest sobre una base de pruebas real (116 tests: contrato de respuesta, matriz de roles e i18n), ESLint 9 plano con la tabla de `naming-convention`, Prettier con `eslint-config-prettier`, y `npm run check` encadenando build, lint, i18n:check y test. Queda registrado que sin CI los comandos existen pero nada garantiza que se ejecuten.

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
## DEUDA-035 🟠 `canViewInactive` exige SUPERADMIN; la matriz dice ADMIN

**Archivo**: `src/helpers/permissions.helper.ts`

`canViewInactive` devuelve verdadero solo para SUPERADMIN. La matriz canónica de la sección 9 fija el listado que incluye inactivos (`002B`) en **ADMIN**.

El resultado: un ADMIN pasa el middleware de una ruta declarada `ADMIN` y recibe únicamente los registros activos, sin ninguna señal de que se le está filtrando.

**Aceptación**: `canViewInactive` admite ADMIN, o la matriz canónica se corrige a SUPERADMIN. Las dos fuentes deben decir lo mismo.

**Nota del SPEC 06 (2026-08-03)**: el paso 8 pasó los 4 puntos de geografía de `isSuperAdmin` a `canViewInactive`, así que el predicado gobierna ahora 7 usos en vez de 3. El bug no cambió —los dos predicados devuelven hoy lo mismo—, pero la corrección se aplica en un solo sitio y alcanza a los siete. Se resuelve en un spec propio: es un cambio de comportamiento observable y, antes que eso, una decisión de canon sobre si el listado `002B` debe ser ADMIN o SUPERADMIN.

**Nota del SPEC 09 (2026-08-03) — severidad subida de 🟡 a 🟠**: hasta ahora las dos mitades de la contradicción vivían en entidades distintas y ningún consumidor las cruzaba. `healthFacility` es la primera entidad donde coinciden en la misma superficie, y el resultado es visible desde fuera:

```
GET /api/health-facilities/admin/location/:id   (ADMIN)  → 200, incluye la instalación inactiva
GET /api/health-facilities/:id                  (ADMIN)  → 404 sobre esa misma instalación
```

La ruta `002B` filtra por rol de ruta —`validateUserRole(ADMIN)`, sin `isActive` en el `where`— mientras que `003` delega en `canViewInactive`, que solo concede a SUPERADMIN. El mismo usuario ve una fila en el listado y no puede abrirla. Deja de ser una inconsistencia de canon para ser un comportamiento incorrecto de cara al cliente.

El SPEC 09 no lo corrigió deliberadamente: su paso 5 manda usar `canViewInactive`, y cambiar el predicado alcanzaría a 7 puntos de llamada en 5 entidades, ninguno cubierto por su suite. El criterio de aceptación del spec se corrigió para describir el comportamiento real (404 para USER y ADMIN, 200 para SUPERADMIN), y `tests/contract/healthFacility.test.ts` lo fija con un comentario que remite aquí. Cuando esta entrada se salde, esos tests fallarán: ésa es la señal de que hay que actualizarlos.

---

<a id="deuda-036"></a>
## DEUDA-036 🟡 El banner de arranque esquiva `esaviLog`

Detectada al implementar el [SPEC 06](./specs/06-naming-and-types.md), cuyo alcance solo cubría los dos `console.log` de depuración que sí eliminó. Quedaban otros ocho en `src/`, no homogéneos.

**Resueltos a 2026-08-03** (eliminados a mano, fuera del SPEC 06): los tres de depuración olvidada — `health.controller.ts:4-5`, que volcaba `req.query.lang` y `req.lang` en cada petición de salud, y `geoLocation.service.ts:254`, un `console.log('ACTUALIZA')`.

Quedan cinco, en dos grupos que no se tratan igual:

| Ubicación | Qué es |
|---|---|
| `connection.ts:40`, `index.ts:96-98` | banner de arranque; salida intencional, pero esquiva `esaviLog` |
| `connection.ts:28` | `logging: env === 'development' ? console.log : false`; es el logger que recibe Sequelize, no un log suelto |

El primero es una inconsistencia de canal: la salida es deliberada, pero no pasa por el logger del proyecto. El segundo es funcional — cambiarlo altera qué se registra en desarrollo.

**Aceptación**: los cuatro del banner salen por `esaviLog`; `connection.ts:28` se documenta como uso legítimo o se sustituye por un logger explícito.

---

<a id="deuda-037"></a>
## DEUDA-037 🟠 ✅ `DEFAULT_LANGUAGE` se lee antes de que `dotenv` pueble el entorno

> ✅ **Saldada** por el [SPEC 08](./specs/08-language-propagation.md) el 2026-08-03. `getDefaultLanguage()` resuelve el valor en cada llamada, no al cargar el módulo, y el literal de reserva pasó de `'en'` a `'es'`. `startServer()` detiene el arranque con `process.exit(1)` si `DEFAULT_LANGUAGE` no está entre los idiomas usables, con la misma política que `resolveCorsOrigins()`. `languageMiddleware` dejó de resolver su propio default para no divergir del helper. Verificado en caliente: con `DEFAULT_LANGUAGE=es`, un JSON malformado sin `req.lang` responde en español; con `DEFAULT_LANGUAGE=xx` el servidor no arranca y deja el motivo en `esaviLog`. Ese registro exigió añadir `esaviLogFlush()`: log4js escribe en asíncrono y el `process.exit(1)` descartaba la entrada.

Detectada al verificar el [SPEC 03](./specs/03-i18n-parity.md) el 2026-08-02, contra la API corriendo con `DEFAULT_LANGUAGE=es`. La cierra el [SPEC 08](./specs/08-language-propagation.md).

**Archivo**: `src/helpers/i18n.helper.ts:13`

La constante se resuelve en el cuerpo del módulo:

```ts
const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE as lang || 'en';
```

Los `import` de `src/index.ts` se hoistean, así que la cadena `index.ts → routes → controllers → helpers` ejecuta ese módulo **antes** de la línea 19, donde `dotenv.config()` puebla el entorno. El operador `||` se queda con la rama derecha en todos los arranques: el idioma por defecto del helper nunca es el configurado.

```
POST /api/auth/login?lang=es   (JSON malformado)
→ 500 {"message":"Internal server error. Please try again later."}
```

Esto convierte en trampa el fallback que instaló el SPEC 03: su nivel 2 cae a `'en'`, no al idioma que el equipo cree haber configurado. Y ninguna prueba lo distingue de un fallback legítimo.

Es el mismo patrón que [DEUDA-031](#deuda-031) —leer `process.env` al cargar el módulo—, en otro archivo y con otra consecuencia.

**Aceptación**: `i18n.helper.ts` no lee `process.env` en el cuerpo del módulo; con `DEFAULT_LANGUAGE=es`, un error sin `req.lang` responde en español. Un `DEFAULT_LANGUAGE` fuera de `SUPPORTED_LANGUAGES` detiene el arranque en vez de degradar en silencio.

---

<a id="deuda-038"></a>
## DEUDA-038 🟠 ✅ El idioma resuelto no llega desde el controlador al servicio

> ✅ **Saldada** por el [SPEC 08](./specs/08-language-propagation.md) el 2026-08-03. `lang` es un parámetro **requerido** en las 17 firmas de servicio y en `CreateUserServiceParams`, así que omitirlo es un error de compilación; `loginService` lo recibe y `login` le pasa `req.lang`; las tres llamadas a `getMessage` sin idioma lo reciben. Dos ajustes que el spec no preveía y que el compilador impuso: `authUser?: AuthUser` pasó a `authUser: AuthUser | undefined` en 13 firmas —un parámetro requerido no puede seguir a uno opcional (TS1016)— y `Express.Request['lang']` pasó a requerido, que es lo que ya ocurre en ejecución porque `languageMiddleware` se monta antes de las rutas. El cuarto bloque de `scripts/i18n-check.js` fija las tres formas de fuga: restaurar cualquiera de ellas devuelve exit 1.
>
> **El recuento fue 19, no 20**: `entityActivation.service.ts` ya no declaraba `lang?: string` al llegar el spec. El [SPEC 04](./specs/04-data-contract-consistency.md) se lo había quitado al hacerlo usar `notFoundMessage`, así que ahora recibe los mensajes ya traducidos.

Detectada junto a [DEUDA-037](#deuda-037) el 2026-08-02. La cierra el [SPEC 08](./specs/08-language-propagation.md).

`languageMiddleware` resuelve `req.lang` correctamente, pero de ahí en adelante hay tres fugas:

| Fuga | Dónde | Efecto |
|---|---|---|
| `lang: string = 'en'` en la firma | 19 funciones de `src/services/`, más `lang?: string` en `entityActivation.service.ts` | si el controlador olvida pasarlo, el idioma no cae al configurado: cae a inglés |
| `lang` ausente de la firma | `loginService` (`auth.service.ts:17`), y `loginController` no se lo pasa | todo el flujo de autenticación responde siempre en un solo idioma |
| `getMessage(clave)` sin segundo argumento | `auth.service.ts:32`, `auth.service.ts:36`, `geoLocation.service.ts:140` | el mensaje ignora el idioma pedido |

```
POST /api/auth/login?lang=es   (credenciales inválidas)
→ 401 {"message":"Invalid email or password. Please try again."}
```

El cliente pidió español y `req.lang` valía `es`. El mensaje sale en inglés porque nunca llegó al servicio.

El valor por defecto es lo que dejó pasar el bug: un parámetro opcional no obliga a nadie a propagarlo, y el literal `'en'` disfraza la omisión de comportamiento normal.

**Aceptación**: `lang` es un parámetro **requerido** en las firmas de servicio, de modo que cada fuga futura sea un error de compilación; todo controlador que llame a un servicio con mensajes le pasa `req.lang`; `npm run i18n:check` falla si reaparece cualquiera de las tres formas.

---

<a id="deuda-039"></a>
## DEUDA-039 🔴 ✅ `geoPolygon` no coincide con la columna `geopolygon` del SQL

> ✅ **Saldada definitivamente** el 2026-08-04, al alinear el DDL con el resto del esquema: `esaviapp.sql:427` declara ahora `"geoPolygon"` en camelCase entrecomillado, y `geoLocation.model.ts` volvió a mapear el atributo **sin `field`**. El nombre del atributo y el de la columna coinciden, que es la convención de las otras 44 tablas.
>
> ⚠️ **Saldada primero a medias** por el [SPEC 09](./specs/09-healthfacility-crud.md) el 2026-08-03, con `field: 'geopolygon'` en el modelo. Aquello alineaba el modelo con el DDL de entonces, pero no con las bases ya creadas: la de desarrollo tenía —y tiene— la columna como `"geoPolygon"`, de modo que el mismo error reaparecía con el nombre invertido. Se detectó al verificar el paso 2 del [SPEC F01](./functional/specs/01-appusergeolocation-crud.md) el 2026-08-04.
>
> Lo que **sí** se mantiene del SPEC 09: las dos comprobaciones de FK de `healthFacility.service.ts` (create y update) piden `attributes: ['geoLocationId']`. Una comprobación de existencia no necesita traerse la geometría, y así el servicio no depende de que el mapeo de otra entidad sea correcto.

Detectada al escribir la suite de contrato del [SPEC 09](./specs/09-healthfacility-crud.md) el 2026-08-03, que fue lo primero que ejecutó estos endpoints contra el `esaviapp.sql` real.

`esaviapp.sql:427` declaraba la columna **toda en minúsculas** —`"geopolygon"`—, a diferencia del resto de columnas de la tabla, que son camelCase entrecomillado. `geoLocation.model.ts:84` la declaraba como `geoPolygon` sin `field`, así que Sequelize la citaba como `"GeoLocation"."geoPolygon"`.

Toda consulta que seleccionara la lista completa de atributos de `GeoLocation` fallaba:

```
POST /api/geo-locations
→ 500  error: no existe la columna «geoPolygon»
       hint: Probablemente quiera hacer referencia a la columna «GeoLocation.geopolygon».
```

El alcance era mayor que la propia entidad: `createHealthFacilityService` valida su FK con `GeoLocation.findOne(...)` sin acotar `attributes`, de modo que **`POST /api/health-facilities` también devolvía 500**. Ningún test lo detectaba porque hasta el SPEC 09 ninguna suite creaba una geoLocation.

**Aceptación**: `POST` y `GET /api/geo-locations` responden 201 y 200 contra el esquema de `esaviapp.sql`, y la suite de contrato de `healthFacility` crea sus fixtures por la API en vez de por SQL directo.

---

<a id="deuda-040"></a>
## DEUDA-040 🟠 El validador de update anuncia `isActive` y el servicio lo ignora

**Archivos**: `src/validators/catalogItem.validator.ts:41`, `src/validators/catalogType.validator.ts:28`

Detectada al implementar el [SPEC 09](./specs/09-healthfacility-crud.md) el 2026-08-03, que arrastraba la misma línea en `healthFacility.validator.ts` y la eliminó al crear su endpoint de update.

Los dos validadores aceptan `isActive` en el cuerpo del `PUT`:

```ts
body('isActive').optional().isBoolean().withMessage('isActive must be a boolean value')
```

Ninguno de los dos servicios lo lee: `objectToUpdate` no lo contempla en `updateCatalogItemService` ni en `updateCatalogTypeService`. El resultado es un campo que la API declara aceptar y descarta en silencio:

```
PUT /api/catalog-items/:id   { "isActive": false }
→ 200, con la entidad intacta y todavía activa
```

Sin error y sin señal. El cliente tiene motivos para creer que desactivó el registro.

La plantilla de `updateEntityValidator` de la sección 14.2 de [CONVENTIONS.md](./CONVENTIONS.md) **no incluye `isActive`**, y con razón: el estado se cambia por `005A` y `005B`, que sellan `deletedAt` y pasan por `setEntityActiveStatusService`. Aplicarlo desde el update abriría un segundo camino sin esas garantías.

**Aceptación**: las dos líneas desaparecen, o los servicios de update aplican el campo — pero entonces `deletedAt` y las reglas de `005A`/`005B` tienen que respetarse también por esa vía. La primera opción es la que siguió el SPEC 09.

---

<a id="deuda-041"></a>
## DEUDA-041 🟠 ✅ Seis servicios de update escriben aunque no cambie ningún dato

**Archivos**: `src/services/appRole.service.ts:115`, `src/services/appUserGeoLocation.service.ts:220`, `src/services/esaviCase.service.ts:286`, `src/services/notifier.service.ts:242`, `src/services/patient.service.ts:219`, `src/services/user.service.ts:230`

Detectada el 2026-08-11 al cerrar el [SPEC F09](./functional/specs/09-classification-crud.md), a partir de un `PUT` que no cambiaba nada y aun así dejaba rastro.

La regla de **update diferencial** de la sección 11 de [CONVENTIONS.md](./CONVENTIONS.md) exige tres cosas: no tocar lo que no viaja en el body, no tocar lo que viaja igual a lo guardado, y no escribir nada —ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`— cuando no cambió ningún campo. Seis servicios ya la cumplen —`catalogItem`, `catalogType`, `geoLevelType`, `geoLocation`, `healthFacility` y `classification`, este último corregido en el propio SPEC F09, que fue donde se detectó—; seis no.

Dos grados de desviación:

| Servicio | Compara con lo guardado | Omite la escritura si no hay cambios |
|---|---|---|
| `appRole` | sí | **no** |
| `appUserGeoLocation` | no | no |
| ~~`classification`~~ | ✅ sí | ✅ sí — corregida por el SPEC F09 |
| `esaviCase` | no | no |
| `notifier` | no | no |
| `patient` | no | no |
| `user` | no | no |

Los cinco últimos solo comprueban **presencia** de la clave en el body, no diferencia de valor: reenviar entera la ficha recién leída con un `GET` reescribe todas las columnas con su propio valor y añade una entrada de auditoría. `appRole` sí compara campo a campo, pero escribe igualmente, con un comentario que declara la intención contraria a la norma:

```ts
// The audit entry is written even when no field changed: an update that touched nothing is
// still an update someone attempted, and appDetails is the only record of who tried
```

El efecto no es un dato corrupto, es un `appDetails` inservible: cada vez que alguien abre y cierra un formulario queda una entrada que no registra ningún cambio, y las modificaciones reales dejan de distinguirse del ruido. En las entidades con PII se suma un segundo efecto — cada reescritura vuelve a cifrar el mismo texto plano — y en las que recalculan un derivado, un tercero: `updatedAt` avanza sin que nada haya avanzado.

**Cuidado con dos casos que no son simple comparación de igualdad**:

- Los campos cifrados (`patient`, `notifier`, `user`) se comparan **descifrando el guardado**, nunca ciphertext contra ciphertext.
- Los valores **derivados** cuentan como diferencia aunque el cliente no los haya enviado: la edad recalculada de `classification` o el `caseCode` de `esaviCase`.

**Aceptación**: los seis servicios siguen el patrón de `updateCatalogItemService` (`src/services/catalogItem.service.ts:152-183`); un `PUT` idéntico al estado guardado responde 200, no añade entrada a `appDetails` y no mueve `updatedAt`; las suites de contrato que hoy afirman lo contrario se corrigen en el mismo spec — al menos `esaviCase` y `notifier` tienen un caso que espera una entrada nueva tras un `PUT` sin cambios, y `classification` ya enseña la forma correcta.

**Saldada** por el [SPEC F12](./functional/specs/12-differential.md) el 2026-08-11, con **cuatro correcciones a este diagnóstico**:

- **La tabla clasifica mal dos servicios.** `user` sí compara con lo guardado —los cinco campos, uno a uno— y escribe igual; su grado es el de `appRole`, no el de los que solo miran presencia. Y `appUserGeoLocation` compara `validFrom` por `getTime()`; lo que decidía por presencia era solo `validTo`.
- **El alcance real llegó a `sysDetails`, no solo a `appDetails`.** `esaviapp.sql:1288` monta `TRG_<tabla>_setSysDetails` sobre todas las tablas, y en `UPDATE` la función incrementa `sysDetails.version` y añade un evento a `sysDetails.auditTrail`. Cada escritura vacía ensuciaba dos rastros y consumía una versión.
- **Dos de los seis servicios que esta entrada daba por correctos también escribían siempre.** `latitude` y `longitude` son `DECIMAL(10, 7)` y `pg` los devuelve como cadena sin `setTypeParser`: `'-0.2299000' !== -0.2299` es siempre verdadero, así que `geoLocation` y `healthFacility` reescribían la fila en cada `PUT` que reenviara sus coordenadas. La fuga estaba en el tipo, no en la lógica del diff, y por eso la revisión que produjo esta entrada no la vio.
- **`esaviCase.caseCode` no es un derivado en riesgo.** `esaviCase.service.ts` lo declara inmutable y el `004` no lo regenera.

La corrección no repitió el patrón doce veces: se extrajo a `buildDifferentialUpdate` (`src/helpers/differentialUpdate.helper.ts`), que ahora es el patrón canónico de la sección 11 de [CONVENTIONS.md](./CONVENTIONS.md) y absorbe las seis reglas de comparación, incluida la de las cadenas numéricas que cerró la fuga `DECIMAL`.

---

<a id="deuda-042"></a>
## DEUDA-042 🟠 Tres endpoints rechazan con 400 la respuesta de su propio `GET`

**Archivos**: `src/validators/geoLocation.validator.ts`, `src/validators/healthFacility.validator.ts`, `src/validators/classification.validator.ts`

Detectada el 2026-08-11 al escribir el caso de contrato del [SPEC F12](./functional/specs/12-differential.md), que reenvía con un `PUT` la respuesta íntegra de un `GET` — el uso normal de un formulario. Tres de los doce endpoints responden 400 a su propia respuesta, por tres asimetrías entre lo que devuelven y lo que aceptan:

| Endpoint | Campo | Causa |
|---|---|---|
| `PUT /api/geo-locations/:id` | `parentGeoLocationId` | el validador es `optional()` pero no `{ nullable: true }`, y la respuesta trae `null` cuando no hay padre |
| `PUT /api/health-facilities/:id` | `parentHealthFacilityId` | la misma |
| `PUT /api/classifications/:id` | `age` | el validador exige `age` y `ageUnitItemId` juntos, pero la respuesta expone `age` y el objeto `ageUnit`, nunca `ageUnitItemId` |

Se suma un cuarto caso menor, de otra causa: un `appUser` creado sin `username` devuelve `username: ''`, y reenviarlo choca con el `notEmpty` del validador. Habría que decidir si la columna es anulable antes de tocar nada.

El daño es del consumidor: un cliente que implemente el formulario de la forma evidente —leer, editar un campo, devolver el objeto— recibe un 400 con un mensaje sobre un campo que él nunca escribió. Hoy lo esquiva quien ya conoce la asimetría.

Es pariente de [DEUDA-040](#deuda-040) —el validador y el servicio de un mismo endpoint no dicen lo mismo—, pero al revés: allí el validador acepta de más, aquí rechaza de más.

**Aceptación**: el `PUT` acepta la respuesta de su `GET` sin cambios en los cuatro casos. Los dos primeros son un `{ nullable: true }`; el tercero exige decidir si la respuesta expone `ageUnitItemId` o si el validador deja de exigir la pareja. El caso de contrato del SPEC F12 quita su `strip` correspondiente cuando cada uno se cierre.

---

<a id="deuda-043"></a>
## DEUDA-043 🟡 `sortOrder: 0` no se puede guardar en tres servicios

**Archivos**: `src/services/catalogItem.service.ts`, `src/services/catalogType.service.ts`, `src/services/geoLevelType.service.ts`

Detectada el 2026-08-11 al migrar los tres servicios al helper en el [SPEC F12](./functional/specs/12-differential.md), que conservó la condición tal cual para que el paso fuera neutro.

Los tres deciden por veracidad y no contra `undefined`:

```ts
sortOrder: data.sortOrder ? data.sortOrder : undefined
```

Un `sortOrder: 0` es falsy, así que se descarta como si no hubiera viajado. El validador lo acepta —`isInt()` sin mínimo—, el servicio lo ignora y la respuesta devuelve 200 con el valor anterior.

Es la primera de las cuatro precisiones de la sección 11 de [CONVENTIONS.md](./CONVENTIONS.md) incumplida: un `0` es un valor legítimo, como lo son el `false` y la cadena vacía.

**Aceptación**: los tres pasan a `data.sortOrder !== undefined ? data.sortOrder : undefined`; un `PUT` con `sortOrder: 0` sobre un registro con otro orden lo guarda y añade su entrada en `appDetails`.

---

<a id="deuda-044"></a>
## DEUDA-044 🟠 ✅ `notificationOrganization` se guarda en mayúsculas y su caso de contrato falla

**Archivos**: `src/services/esaviCase.service.ts`, `tests/contract/esaviCase.test.ts`

Detectada el 2026-08-19 al correr `npm run check` durante la implementación del [SPEC F27](./functional/specs/27-notificationpregnancycomplication-crud.md). **No la introdujo ese spec**: se reprodujo en el commit `76a34e5`, anterior a su primera línea de código, montando un worktree sobre esa base.

El servicio normaliza el campo a mayúsculas:

```ts
const normalizeOrganization = (value: string): string => value.trim().toUpperCase();
```

y el caso de contrato del propio SPEC F06 espera Title Case:

```ts
expect(data.notificationOrganization).toBe('Ministerio De Salud');
```

El resultado es `MINISTERIO DE SALUD`, así que `tests/contract/esaviCase.test.ts` falla en el test «creates a case and returns the full shape with the patient decrypted». Es el único test rojo de la suite completa.

Las dos mitades entraron en el mismo spec y con días de diferencia —el servicio en `9485318`, el test en `e479788`—, de modo que la divergencia nació dentro de F06 y nadie la vio porque el test se escribió después.

Hay que decidir cuál de los dos manda. La sección de Normalización de [CONVENTIONS.md](./CONVENTIONS.md) reserva `toConstantCase` para los campos `code` y `toTitleCase` para los `name`, y el nombre de una organización es un nombre propio, no un código: el canon apunta a `toTitleCase`, que es además lo que el test ya afirma. `countryIsoCode` sí es correcto en mayúsculas — un ISO 3166-1 alfa-2 lo es por definición — y su `normalizeCountryIsoCode` se queda como está.

**Aceptación**: `normalizeOrganization` pasa a `toTitleCase`, o el caso de contrato se corrige a mayúsculas si el dominio prefiere ese criterio. `npm run check` sale en 0 sin tocar ningún otro archivo.

**Saldada el 2026-08-28** por el [SPEC F46](./functional/specs/46-catalogitem-value-lock.md), paso 9, por la vía que proponía la «Aceptación»: `normalizeOrganization` pasa a `toTitleCase(value.trim())` en `src/services/esaviCase.service.ts`. Manda el SPEC F06, que lo declara en tres sitios, y es lo que el test ya afirmaba. `normalizeCountryIsoCode` se queda en mayúsculas.

---

<a id="deuda-045"></a>
## DEUDA-045 🟠 `appDetails.user` expone el UUID interno del usuario en toda respuesta

**Archivos**: `src/types/common/audit.types.ts:18`, y los 38 servicios con operaciones de lectura.

Detectada el 2026-09-02 al revisar qué identificadores recibe el frontend.

Toda tabla lleva `appDetails` (JSONB array) y cada entrada guarda en `user` el **UUID** de quien ejecutó la operación. Ese array viaja íntegro en la respuesta de casi todos los `GET`: solo `user.service.ts:63-67` y `systemConfig.service.ts` lo excluyen, y únicamente en sus listados. El consumidor recibe entonces una lista de UUID que no puede mostrar sin una llamada extra por cada uno, y a cambio se le entrega un identificador interno que no necesita para nada.

Lo que se quiere es que la respuesta diga el **email** del autor. Con dos límites que definen la forma de la solución:

**La escritura no cambia.** La tentación es guardar el email en vez del `userId` al construir la entrada de auditoría, y es el camino equivocado por tres razones. `email` está cifrado con `esaviCrypt` precisamente para que la PII no repose en claro; escribirlo en `appDetails` la dejaría **sin cifrar** en el JSONB de las 45 tablas, y la auditoría es acumulativa, así que sería para siempre. Son además unos 146 puntos de escritura repartidos en 47 servicios. Y no arreglaría ninguna de las filas ya escritas.

**La resolución va en la lectura, explícita, no en un middleware.** El punto correcto es el mismo donde `user.service.ts:44-59` ya descifra su propia PII antes de responder (`decryptPii` / `toUserResponse`): un helper compartido —`resolveAppDetailsAuthors`— que junte los `userId` únicos de la respuesta, haga **un solo** `findAll` sobre `AppUser` y sustituya `user` por el email descifrado. Un query por respuesta, no uno por entrada de auditoría.

Se evaluó y se descartó un middleware genérico sobre `res.json`. Reconocería la entrada de auditoría por la forma de sus claves (`createdAt`, `user`, `method`, `detail`), de modo que reescribiría cualquier otro JSONB que coincidiera por casualidad, y necesitaría recorrer a ciegas las tres formas de respuesta que conviven (objeto, `{ count, rows }`, entidad con sub-entidades anidadas). Sería, además, la única pieza del repositorio que transforma la respuesta sin que el servicio lo declare. Lo que sí conserva del middleware es la ventaja que lo hacía atractivo: si el helper lee un flag, la resolución se puede desactivar desde un solo sitio.

**Alcance**: 130 funciones `get*Service` en 38 archivos son el techo; el suelo son las que devuelven la fila completa con su `appDetails`. La razón de que sea tan disperso es que no existe capa de serialización compartida: los controladores pasan el `data` del servicio a `res.json` sin tocarlo, así que no hay un punto único que ya esté dando forma a las respuestas.

**Decisión pendiente**: qué se responde cuando el `userId` no resuelve a ningún `AppUser`. Son dos casos reales, no hipotéticos — un usuario purgado por su `005C`, y el literal `'undefined'` que los servicios escriben cuando la operación no trae `authUser` (`user.service.ts:123`, `healthFacility.service.ts:74`, y así en todos). Dejar el UUID reintroduce la exposición justo en el caso raro; un literal i18n la evita pero pierde el rastro. Sea cual sea la decisión, el helper tiene que contemplar el `'undefined'` ya escrito en filas existentes.

**Aceptación**: ninguna respuesta de la API contiene un UUID en `appDetails[].user`; el valor es el email del autor. La escritura sigue guardando el `userId`, verificable directamente en la base. Un `GET` de un listado de N filas ejecuta **un** query adicional, no N. Un caso de contrato lo fija sobre al menos una entidad.

---

<a id="deuda-046"></a>
## DEUDA-046 🔴 El rate limit se cuenta por IP y sin `trust proxy`

**Archivos**: `src/app.ts:71-79`, `src/middlewares/rateLimit.middleware.ts`

Detectada el 2026-09-02 al integrar el frontend: con navegación normal se alcanza el límite y hay que esperar.

El limiter global concede **100 peticiones por IP cada 15 minutos** —unas 6,7 por minuto— y se monta antes de las rutas. Son cuatro problemas distintos que comparten el mismo punto de montaje y hay que resolver juntos.

**1. El techo es bajo para un cliente SPA.** Una pantalla que carga sus catálogos en paralelo gasta diez o veinte peticiones en un segundo. El límite se diseñó contra el abuso y hoy lo que frena es el uso normal.

**2. La cuenta es por IP, y eso se rompe detrás de NAT.** Es el problema de fondo, y es propio de este dominio: una unidad de salud entera sale por una sola IP pública, de modo que sus usuarios se reparten los mismos 100 requests y se bloquean entre sí. El sujeto que se quiere limitar es la **cuenta**, no la ubicación de red. Lo mismo alcanza al `passwordResetLimiter` de `rateLimit.middleware.ts:30-36`: sus 5 peticiones por ventana son 5 para todo el centro de salud, no 5 por persona.

**3. `trust proxy` no está configurado en ningún punto de `src/`.** Mientras la API corra expuesta directamente no se nota, pero en cuanto quede detrás de un proxy o balanceador —nginx, Cloud Run, Heroku— `req.ip` pasa a ser la IP del proxy y **todos los usuarios comparten un único bucket de 100**. El rate limit deja de ser molesto y pasa a ser inservible. La corrección tampoco es `trust proxy: true` a secas: confiar en todo `X-Forwarded-For` permite falsificar la cabecera y evadir el límite por completo. Hay que declarar el número de saltos reales de la infraestructura.

De aquí sale la severidad 🔴: no del techo bajo, que es una molestia, sino de la combinación de 2 y 3 — en producción el límite mide algo distinto de lo que cree medir, y en un despliegue con proxy se degrada a un contador global.

**4. El 429 rompe el contrato de respuesta.** El limiter responde con la cadena de `message` tal cual, sin pasar por `errorHandler`: sin `{ ok, message, code, errors }` y sin i18n. El cliente no puede tratar ese error como trata los demás. Es el mismo patrón que [DEUDA-032](#deuda-032), en otro middleware.

**Dirección de la solución**: el limiter corre **antes** de `tokenValidation`, así que `req.user` todavía no existe cuando se calcula la clave. La salida sin tocar las rutas es un único limiter con `keyGenerator` propio que verifique el JWT por su cuenta —`jwt.verify`, sin consultar la base, mucho más barato que `tokenValidation`, que sí relee el usuario y sus roles en cada petición— y devuelva `user:<userId>` cuando el token es válido, cayendo a la IP cuando no lo es. Con `limit` dinámico: cuota amplia para la cuenta autenticada y cuota corta para el tráfico anónimo, que es el que hay que seguir frenando en login y en recuperación de contraseña. El límite por IP **no se elimina**: se reserva para quien todavía no se identificó.

Debe **verificarse la firma**, nunca solo decodificar: un `jwt.decode` dejaría que cualquiera eligiera su propio bucket inventando un `userId` distinto en cada petición, que es evadir el límite por definición.

Dos precisiones de `express-rate-limit@8`, la versión instalada: `max` está deprecado a favor de `limit`, y un `keyGenerator` propio con reserva a IP tiene que usar el helper `ipKeyGenerator` — sin él, un cliente IPv6 obtiene un bucket por dirección y rota libremente dentro de su propio /64.

Queda fuera de alcance, pero conviene anotarlo: el store por defecto es en memoria, así que los contadores se reinician con el proceso y no se comparten entre instancias. Mientras el despliegue sea de una sola instancia no cambia nada.

**Aceptación**: dos usuarios autenticados distintos detrás de la misma IP pública no consumen la cuota del otro. `trust proxy` declara los saltos reales y una cabecera `X-Forwarded-For` falsificada no altera la clave del limiter. El tráfico anónimo conserva un límite por IP, y `POST /api/auth/login` sigue frenado. Un 429 responde con el sobre `{ ok, message, code, errors }` e i18n, como cualquier otro error. Los tests siguen sin montar el limiter, por la razón que `app.ts:71-72` ya documenta.
