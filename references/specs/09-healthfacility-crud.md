# SPEC 09 — CRUD completo de healthFacility

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Fecha:** 2026-08-03
> **Objetivo:** Completar los siete artefactos y las siete operaciones canónicas de `healthFacility`, y alinear los dos endpoints existentes con el SQL y con el resto de entidades.

---

## 1. Por qué existe este spec

`healthFacility` es la única entidad del repositorio con CRUD a medias: expone crear y listar por geoLocation, pero no permite consultar por ID, actualizar, desactivar ni reactivar. Un dato cargado con un error tipográfico solo se corrige por SQL directo.

Además arrastra tres desajustes verificados:

**A — La unicidad de `localCode` está mal delimitada.** `esaviapp.sql` declara `CONSTRAINT "UQ_healthFacility_localCode" UNIQUE ("localCode")` — unicidad global. `healthFacility.service.ts:53-63` la comprueba filtrando por `geoLocationId`. Un `localCode` repetido en otra geoLocation pasa la validación de la aplicación y revienta en Postgres: el cliente recibe **500** donde le corresponde un **409**.

**B — La validación del tipo de catálogo está desactivada.** `healthFacility.service.ts:32` tiene comentado `//where: { code: 'FACILITY_TYPE' }`. Cualquier `catalogItem` activo pasa como tipo de instalación. El trigger `TRG_healthFacility_validateCatalogs` sí lo impone contra `'healthFacilityType'`, de modo que el error llega como fallo de base de datos — otro 500 en lugar de un 404 controlado. El literal comentado además está equivocado: el catálogo se llama `healthFacilityType`, no `FACILITY_TYPE`.

**C — Es la única entidad que no normaliza al escribir.** El resto aplica `toConstantCase` a los códigos y `toTitleCase` a los nombres. `createHealthFacilityService` guarda `data.name` y `data.localCode` tal cual, lo que hace que la unicidad sea sensible a mayúsculas y espacios.

A eso se suman residuos: 120 líneas comentadas con una copia del modelo `GeoLocation` dentro de `healthFacility.model.ts`, `Op` importado sin usar en el servicio, `canViewInactive` importado sin usar en el controlador, `'unknown'` como usuario de auditoría donde el resto usa `'undefined'`, y los modelos importados por ruta directa en vez de desde el barrel.

---

## 2. Alcance

**Dentro:**

- Cinco endpoints nuevos: `ESAVI-HFAC-002B` (listar por geoLocation, admin), `ESAVI-HFAC-003` (obtener por ID), `ESAVI-HFAC-004` (actualizar), `ESAVI-HFAC-005A` (desactivar), `ESAVI-HFAC-005B` (reactivar).
- El actual `ESAVI-HFAC-002` pasa a llamarse `ESAVI-HFAC-002A`. La ruta y el rol no cambian.
- Unicidad global de `localCode` en create y update, comparada contra el valor normalizado.
- Normalización al escribir: `toConstantCase` para `localCode`, `toTitleCase` para `name`.
- `localCode` pasa a ser opcional de forma coherente: modelo `allowNull: true`, validador `.optional()`, límite alineado a 200 caracteres.
- Activación del filtro por `catalogType.code = 'healthFacilityType'` en create y update.
- Validación de ciclos en la jerarquía al cambiar `parentHealthFacilityId`.
- Bloqueo de la desactivación cuando existen hijos activos.
- Limpieza de residuos: bloque comentado del modelo, imports muertos, fallback de auditoría, importación desde el barrel.
- Tres claves i18n nuevas en `es`, `en` y `nl`.
- Cinco filas nuevas en `ROUTE_RULES` y suite `tests/contract/healthFacility.test.ts`.

**Fuera de alcance (otros specs):**

- Listado general de instalaciones sin geoLocation, con filtros por tipo o por padre. Se decidió mantener `/location/:id` como único punto de listado.
- Búsqueda por texto sobre `name` o `address`. No existe `Op.iLike` en ningún servicio del repositorio; introducirlo es un cambio transversal.
- Endpoint de árbol o de descendientes recursivos.
- Migración de datos existentes para normalizar `name` y `localCode` de filas ya cargadas.
- Corregir la unicidad de otras entidades o el `getCatalogItemByIdService` duplicado ([DEUDA-022](../TECHNICAL_DEBT.md#deuda-022), SPEC 06).
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

No hay tablas nuevas. La tabla `healthFacility` ya existe en `esaviapp.sql:444-480` y no se altera. Cambian tres cosas: una restricción del modelo, una interfaz de tipos y tres claves de traducción.

### 3.1 Ajuste del modelo

`src/models/healthFacility.model.ts`:

| Antes | Después |
|---|---|
| `localCode: { type: STRING(200), allowNull: false }` | `allowNull: true` — alineado al SQL |
| 120 líneas comentadas con una copia de `GeoLocation` (125-244) | eliminadas |

Ningún otro atributo cambia. `email` sigue siendo `CITEXT`, y `latitude`/`longitude` siguen siendo `DECIMAL(10,7)`.

### 3.2 Tipos

`src/types/healthFacility/healthFacility.types.ts` se corrige:

```ts
export interface CreateHealthFacilityInput {
    geoLocationId: string;
    parentHealthFacilityId?: string | null;
    facilityTypeItemId?: string | null;   // hoy declarado obligatorio; el SQL y el validador lo tratan como opcional
    localCode?: string | null;
    name: string;
    officialName?: string | null;
    shortName?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    phone?: string | null;
    email?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateHealthFacilityInput>`, como el resto de entidades. No se declara `UpdateHealthFacilityInput`.

### 3.3 Claves i18n nuevas

Se añaden al bloque `healthFacility` de `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `hasActiveChildren` | 409 al desactivar una instalación con hijos activos |
| `circularParent` | 409 al asignar como padre a un descendiente |
| `selfParent` | 409 al asignarse a sí misma como padre |

`tests/i18n/messages.test.ts` exige paridad exacta: las tres van en los tres archivos o la suite falla.

### 3.4 Superficie HTTP resultante

```
POST   /api/health-facilities                     ESAVI-HFAC-001   ADMIN       (existe)
GET    /api/health-facilities/location/:id        ESAVI-HFAC-002A  USER        (existe, se renumera)
GET    /api/health-facilities/admin/location/:id  ESAVI-HFAC-002B  ADMIN       (nuevo)
GET    /api/health-facilities/:id                 ESAVI-HFAC-003   USER        (nuevo)
PUT    /api/health-facilities/:id                 ESAVI-HFAC-004   ADMIN       (nuevo)
DELETE /api/health-facilities/:id                 ESAVI-HFAC-005A  ADMIN       (nuevo)
PATCH  /api/health-facilities/activate/:id        ESAVI-HFAC-005B  SUPERADMIN  (nuevo)
```

Orden de declaración en `healthFacility.routes.ts`: las rutas literales (`/location/:id`, `/admin/location/:id`, `/activate/:id`) van **antes** de `/:id`, o Express capturará `location` como un `:id` y el validador de UUID responderá 400.

### 3.5 Forma de la respuesta de `003`

```
{ ok, message, data: {
    healthFacilityId, geoLocationId, facilityTypeItemId, parentHealthFacilityId,
    localCode, name, officialName, shortName, address, latitude, longitude,
    phone, email, isActive, createdAt, updatedAt, deletedAt, appDetails,
    geoLocation:  { geoLocationId, name, level },
    facilityType: { catalogItemId, code, name },
    parent:       { healthFacilityId, name, localCode },
    children:   [ { healthFacilityId, name, localCode, isActive } ]
} }
```

`children` se filtra por `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero, igual que el resto de listados.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable. Los pasos 1 y 2 corrigen lo existente antes de ampliar: si algo se rompe, se rompe con la superficie pequeña.

1. **Limpiar el modelo y los tipos.** Borrar el bloque comentado de `healthFacility.model.ts`, poner `localCode` en `allowNull: true`, y corregir `facilityTypeItemId` a opcional en `CreateHealthFacilityInput`.
   *Verificación:* `npm run build` en 0; `POST /api/health-facilities` sin `localCode` sigue creando.

2. **Corregir el servicio existente.** En `createHealthFacilityService`: importar los modelos desde `'../models'`, quitar `Op` sin usar, activar `where: { code: 'healthFacilityType' }` en el include de `CatalogType`, cambiar la unicidad de `localCode` a global, aplicar `toConstantCase`/`toTitleCase`, y unificar el fallback de auditoría a `'undefined'`. En el controlador, quitar el import muerto de `canViewInactive`. Renumerar `002` → `002A` en los cinco puntos.
   *Verificación:* crear dos instalaciones con el mismo `localCode` en geoLocations distintas devuelve **409**, no 500; un `facilityTypeItemId` de otro catálogo devuelve **404**, no 500.

3. **Añadir las tres claves i18n** (`hasActiveChildren`, `circularParent`, `selfParent`) a los tres archivos.
   *Verificación:* `npm test -- messages` pasa.

4. **`ESAVI-HFAC-002B` — listado admin.** `getAllHealthFacilitiesByGeoLocationService`, gemela de la existente pero sin `isActive` en el `where`; controlador `getAllHealthFacilitiesByLocation`; ruta `GET /admin/location/:id` con `validateUserRole(ADMIN)`.
   *Verificación:* un ADMIN ve las inactivas en `/admin/location/:id`; un USER recibe 403.

5. **`ESAVI-HFAC-003` — obtener por ID.** `getHealthFacilityByIdService(id, lang, includeInactive)` con los cuatro includes descritos en §3.5; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; una instalación inactiva devuelve 404 para USER y 200 para ADMIN.

6. **`ESAVI-HFAC-004` — actualizar.** `updateHealthFacilityService` con el patrón `objectToUpdate` del repositorio. Valida en este orden: existencia de la instalación, `geoLocationId` activo si viene, `facilityTypeItemId` del catálogo correcto si viene, `parentHealthFacilityId` (existe y activo → no es el propio id → no es un descendiente, recorriendo la cadena de padres), y unicidad global de `localCode` excluyendo el propio id con `{ [Op.ne]: id }`. Preserva el historial con `[...currentAppDetails, newEntry]`.
   *Verificación:* asignarse a sí misma como padre devuelve 409; asignar un descendiente devuelve 409; un `localCode` de otra instalación devuelve 409; un PUT sin cambios devuelve 200 con la entidad intacta.

7. **`ESAVI-HFAC-005A` y `005B` — desactivar y reactivar.** `setHealthFacilityActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, igual que `setCatalogItemActivationService`. Antes de desactivar, contar hijos con `{ parentHealthFacilityId: id, isActive: true }`; si hay al menos uno, lanzar 409 `HFAC_005A_HAS_ACTIVE_CHILDREN`. Dos controladores y dos rutas (`DELETE /:id` ADMIN, `PATCH /activate/:id` SUPERADMIN), ambos respondiendo `{ ok, message }` sin `data`.
   *Verificación:* desactivar un padre con hijos activos devuelve 409; desactivar dos veces devuelve 409 `ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`.

8. **Cubrir las rutas nuevas en `tests/auth/roles.test.ts`.** Cinco filas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de 28 a 33.
   *Verificación:* `npm test -- roles` pasa.

9. **Suite de contrato `tests/contract/healthFacility.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → actualizar → listar (público y admin) → desactivar → reactivar, verificando estado y envelope en cada paso, más los casos de error 409 de `localCode`, ciclo y hijos activos.
   *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las siete operaciones.
- [ ] `grep -rn "ESAVI-HFAC-002[^AB]" src/` no devuelve resultados: todo es `002A` o `002B`.
- [ ] Crear dos instalaciones con el mismo `localCode` en geoLocations distintas devuelve 409, no 500.
- [ ] Crear con `localCode: "  hosp central  "` guarda `HOSP_CENTRAL` y `name: "hospital central"` guarda `Hospital Central`.
- [ ] Crear sin `localCode` devuelve 201.
- [ ] Un `facilityTypeItemId` que no pertenece al catálogo `healthFacilityType` devuelve 404, no 500.
- [ ] `GET /:id` devuelve `geoLocation`, `facilityType`, `parent` y `children`.
- [ ] `GET /:id` de una instalación inactiva: 404 para USER/ADMIN, 200 para ADMIN.
- [ ] `PUT /:id` con `parentHealthFacilityId` igual al propio id devuelve 409.
- [ ] `PUT /:id` con un descendiente como padre devuelve 409.
- [ ] `DELETE /:id` de una instalación con hijos activos devuelve 409.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Cada operación añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `healthFacility.model.ts` no contiene el bloque comentado de `GeoLocation`.
- [ ] `healthFacility.service.ts` importa los modelos desde `'../models'`.
- [ ] Las claves `hasActiveChildren`, `circularParent` y `selfParent` existen en es, en y nl.
- [ ] `ROUTE_RULES` tiene 33 entradas y `npm test -- roles` pasa.
- [ ] `npm run build`, `npm run lint` y `npm test` salen en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** unicidad global de `localCode`. Es lo que impone el SQL; la aplicación solo estaba mintiendo sobre el alcance y convirtiendo un 409 en un 500.
- **No:** cambiar el `UNIQUE` del SQL a `(geoLocationId, localCode)`. Modificar el esquema afecta a datos ya cargados y a la carga de `esaviapp.sql` en los tests; el código local se entiende como identificador nacional, no por localidad.
- **Sí:** `localCode` opcional. El SQL lo permite nulo y el servicio ya generaba un `'NC_' + Date.now()` de relleno; declararlo obligatorio en el modelo era la única de las tres fuentes que no lo permitía.
- **Sí:** normalizar `name` y `localCode`. Sin ello la unicidad global es sensible a mayúsculas y `healthFacility` sigue siendo la excepción del repositorio.
- **No:** migrar las filas ya cargadas al formato normalizado. Es un cambio de datos, no de código, y merece su propio spec con respaldo previo.
- **Sí:** solo la gemela admin de `/location/:id`. Añadir un listado general con filtros duplicaría la superficie sin un consumidor que lo pida.
- **Sí:** validar ciclos al mover una instalación. El `CHECK` del SQL solo cubre el auto-padre directo; un ciclo A→B→A deja el árbol irrecorrible y no lo detecta nadie.
- **No:** validar ciclos con una CTE recursiva en SQL. El recorrido de la cadena de padres en el servicio es legible y la jerarquía sanitaria tiene pocos niveles.
- **Sí:** bloquear la desactivación con hijos activos. Un padre inactivo con hijos activos deja el árbol en un estado que ningún listado sabe representar.
- **No:** comprobar `esaviCase`, `notifier` ni las demás FK entrantes antes de desactivar. Es borrado lógico: las restricciones `ON DELETE RESTRICT` no se disparan, y consultar cinco tablas de otros dominios acoplaría `healthFacility` a todo el esquema.
- **Sí:** incluir `children` en `003`. El riesgo de tamaño se acota filtrando por `isActive`.
- **Sí:** activar el filtro por `catalogType.code = 'healthFacilityType'`. El literal comentado decía `FACILITY_TYPE`, que no existe en el catálogo semilla — de ahí que se dejara desactivado.
- **Sí:** primera suite de contrato por entidad. Siete operaciones con cinco caminos de error no se verifican a mano de forma fiable.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Datos ya cargados con `localCode` duplicado en geoLocations distintas | El `UNIQUE` del SQL ya lo impedía: si existieran, la tabla no se habría podido cargar. El cambio solo adelanta el error al servicio |
| Normalizar rompe búsquedas de clientes que guardan el `localCode` original | Afecta solo a filas nuevas; las existentes no se tocan. Conviene avisar a los consumidores de la API |
| Activar la validación de tipo rechaza creaciones que hoy pasan | Es la corrección: esas creaciones ya fallaban en el trigger con un 500. Ahora fallan antes y con un mensaje claro |
| `GET /:id` captura `/location` o `/activate` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato |
| `children` sin límite en `003` devuelve una respuesta grande | La jerarquía sanitaria es de pocos niveles y pocos hijos por nodo. Si aparece un caso real, se pagina en otro spec |
| El recorrido de padres entra en bucle si ya existe un ciclo en los datos | El recorrido lleva un contador de saltos con tope y un conjunto de ids visitados; si lo supera, lanza `circularParent` |

---

## Lo que **no** está en este spec

- Listado general de instalaciones sin geoLocation, con filtros por tipo o por padre.
- Búsqueda por texto sobre `name` o `address`.
- Endpoint de árbol o de descendientes recursivos.
- Migración de los datos ya cargados al formato normalizado.
- Cambiar el `UNIQUE` del SQL a una clave compuesta.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
