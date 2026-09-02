# SPEC F49 — Alcance geográfico del usuario sobre los casos ESAVI

> **Estado:** Implementado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), **SPEC F01 (`appUserGeoLocation`, `ESAVI-USERGEO-008`, implementado)**, **SPEC F06 (`esaviCase`, implementado)**, **SPEC F48 (filtros de fecha y unidad geográfica, implementado)**
> **Fecha:** 2026-08-31
> **Objetivo:** Que un usuario no administrador alcance únicamente los casos ESAVI reportados en las unidades geográficas que tiene asignadas en `appUserGeoLocation`, o en cualquiera de sus descendientes.

---

## 1. Por qué existe este spec

**Hoy cualquier usuario con rol `USER` alcanza todos los casos del país.** `GET /api/esavi-cases` (`ESAVI-CASE-002A`) solo filtra por `isActive: true` y por lo que venga en la query. Un auxiliar de una parroquia de Loja lista, abre y edita los casos de Esmeraldas sin ninguna barrera. La única autorización que existe es el nivel de rol —`validateUserRole(USER)`, `roles.constants.ts`—, y el nivel de rol no sabe nada de territorio.

**La tabla que lo resuelve existe, está poblada por API y nadie la consulta desde los casos.** `appUserGeoLocation` (`esaviapp.sql:510-576`) vincula usuario y unidad geográfica con vigencia temporal, y el SPEC F01 le dio sus once operaciones, incluida `ESAVI-USERGEO-008`, que expande las asignaciones vigentes de un usuario a su cobertura efectiva (`appUserGeoLocation.service.ts:525-568`). Ese endpoint responde hoy la pregunta «¿qué territorio le toca a este usuario?» y su respuesta no gobierna absolutamente nada: es informativa.

**El puente de datos también está montado, y el SPEC F48 acaba de recorrerlo.** `esaviCase.healthFacilityId → healthFacility.geoLocationId → geoLocation.parentGeoLocationId` ya se recorre con un `WITH RECURSIVE` desde `esaviCase.service.ts:332-357`, pero como **filtro opcional que elige el cliente**, no como límite que le impone el servidor. El cliente que no manda `geoLocationId` sigue viendo el país entero. Este spec usa el mismo camino en la dirección contraria: no lo que el usuario pide ver, sino lo que puede ver.

**Un filtro solo en los listados sería cosmética, no control.** Si el alcance viviera únicamente en `002A`, el caso ajeno desaparecería de la pantalla pero seguiría entregándose entero por `GET /api/esavi-cases/:id` a quien tuviera el UUID —y el `003` devuelve el caso completo, con el paciente descifrado—. Por eso este spec cubre también el `003`, el `004` y la creación, y por eso se llama alcance y no filtro.

**El `002B` es el escape legítimo.** `GET /api/esavi-cases/admin` es ADMIN y sigue viendo todo. Sin una vía sin restricción territorial, un caso reportado en una unidad de salud sin geolocalizar quedaría fuera del alcance de todo el mundo y sería inalcanzable por API.

---

## 2. Alcance

**Dentro:**

- **El alcance geográfico del usuario**: la lista de `geoLocationId` que resulta de expandir sus asignaciones vigentes en `appUserGeoLocation` a todos sus descendientes activos, resuelta una vez por petición.
- **`ESAVI-CASE-002A`** — el listado activo se acota al alcance del usuario, **intersectado** con el `geoLocationId` explícito del SPEC F48 cuando viaja.
- **`ESAVI-CASE-003`** — un caso fuera del alcance responde **404**, indistinguible de un caso inexistente.
- **`ESAVI-CASE-004`** — la misma puerta que el `003`, más la comprobación de que la `healthFacilityId` de destino, si viaja, también esté dentro del alcance.
- **`ESAVI-CASE-001`** — no se puede crear un caso en una unidad de salud fuera del alcance. Sin esta pieza el usuario crea casos que no puede volver a leer (§7).
- **Exención de administradores**: `isAdmin(authUser)` —SUPERADMIN y ADMIN— no lleva restricción territorial en ninguna de las cuatro operaciones. `002B`, `005A` y `005B` quedan intactos por ser ya de rol administrador.
- **Extracción del recorrido recursivo** a `src/services/common/geoScope.service.ts`, con la constante de profundidad única, cumpliendo la condición que el propio SPEC F48 §4 dejó escrita (§4).
- Firma nueva de los servicios de listado y de detalle: reciben `authUser`.
- Casos nuevos en `tests/contract/esaviCase.test.ts` y usuarios con asignación territorial en las fixtures.

**Fuera de alcance (otros specs, o descartado):**

- **Las 22 entidades satélite del expediente** — `notification`, `investigation` y sus trece tablas, `classification`, `finalClassification`, `caseWorkflow`, `notifier`. Todas se dirigen a una fila por `caseId` y ninguna lleva alcance después de este spec. Es la continuación natural y es un spec propio: son unas 40 rutas y exige un guard invocado desde cada servicio. **Mientras no aterrice, el contenido clínico de un caso fuera del territorio sigue siendo alcanzable por esas rutas.** Queda declarado aquí, sin eufemismos, como el límite real de este spec.
- **Rutas nuevas, códigos de operación nuevos y claves i18n nuevas.** Ninguna de las tres. `ROUTE_RULES` (`tests/auth/roles.test.ts`) no cambia ni una fila.
- **Una bandera de configuración para activar el alcance por fases.** Se evaluó y se descartó: §7 lo razona y §8 lo convierte en una precondición de despliegue.
- **Alcance sobre `002B`.** Es el endpoint de administración y su rol ya es ADMIN.
- **Alcance sobre `patient`, `healthFacility` o `geoLocation`.** Un usuario seguirá listando pacientes y unidades de salud de todo el país. Cada uno es su propio spec.
- **Alcance por la geografía de residencia del paciente.** Este spec acota por dónde se reportó el caso, igual que el F48.
- **Alcance de escritura sobre `appUserGeoLocation` mismo** — quién puede asignar a quién sigue gobernado por el rol, tal como lo dejó el SPEC F01.
- **Un rol territorial nuevo**, o niveles de `ROLE_LEVELS` distintos. La matriz de roles no cambia.
- **Cachear la cobertura en el JWT o en `req.user`.** El payload del token lleva solo `userId` y `tokenValidation` re-lee al usuario en cada petición; meter territorio en el token haría que una reasignación tardara hasta la expiración en surtir efecto.
- **Devolver en la respuesta cuántos casos quedaron fuera por alcance.** Un contador de lo que no puedes ver es información sobre lo que no puedes ver.

---

## 3. Modelo de datos

**No hay tablas nuevas, ni columnas nuevas, ni modelos nuevos, ni asociaciones nuevas, ni índices nuevos.** Todo lo que este spec consulta existe y está indexado. Las sub-secciones de tabla origen y modelo Sequelize de la plantilla se sustituyen por el inventario de lo que se lee y por la definición del alcance.

### 3.1 Columnas consultadas

| Tabla | Columna | Tipo | Nulo | Papel en este spec |
|---|---|---|---|---|
| `appUserGeoLocation` | `userId` | `uuid` | no | Raíz de la consulta. Indexada (`esaviapp.sql:529`) |
| `appUserGeoLocation` | `geoLocationId` | `uuid` | no | Unidad asignada. Indexada (`esaviapp.sql:532`) |
| `appUserGeoLocation` | `validFrom` / `validTo` | `timestamptz` | `validTo` sí | Vigencia de la asignación (§3.2) |
| `appUserGeoLocation` | `isActive` | `boolean` | no | Una asignación desactivada no otorga alcance |
| `geoLocation` | `geoLocationId` / `parentGeoLocationId` | `uuid` | el padre sí | Aristas del recorrido. Indexadas (`esaviapp.sql:470`) |
| `geoLocation` | `isActive` | `boolean` | no | Corta ramas, igual que en el `008` y en el F48 |
| `healthFacility` | `geoLocationId` | `uuid` | **sí** | Columna contra la que se aplica el alcance. Indexada (`esaviapp.sql:498`) |
| `esaviCase` | `healthFacilityId` | `uuid` | no | Puente del caso hacia el territorio |

**`healthFacility.geoLocationId` es nulable, y eso tiene una consecuencia que se declara aquí:** un caso abierto en una unidad de salud sin geolocalizar **no pertenece a ningún territorio**, así que ningún usuario no administrador lo alcanza, por ninguna de las cuatro operaciones. No es un caso especial que haya que manejar: es la definición. La vía para verlo es el `002B`, y la solución real es geolocalizar la unidad.

### 3.2 Qué es el alcance de un usuario

**Definición.** El alcance de un usuario es el conjunto de `geoLocationId` que resulta de:

1. Tomar sus filas de `appUserGeoLocation` con `isActive = true`, `deletedAt IS NULL` y vigencia abierta o futura — `validTo IS NULL OR validTo > now()`.
2. Quedarse con las que apuntan a una `geoLocation` con `isActive = true`.
3. Expandir cada una a todos sus descendientes activos, a cualquier profundidad.

Son exactamente las tres reglas que ya aplica `ESAVI-USERGEO-008` (`appUserGeoLocation.service.ts:536-568`). **No se inventa un segundo criterio de cobertura**: si el `008` dice que un usuario cubre un territorio, este spec le deja ver sus casos, y al revés. Tener dos definiciones de cobertura en el mismo repositorio sería peor que cualquiera de las dos.

**`validFrom` no se comprueba.** El `008` tampoco lo hace: la fila existe desde que se crea y `CK_appUserGeoLocation_dates` ya garantiza `validTo > validFrom`. Cambiarlo aquí y no allí es precisamente la divergencia que §3.2 evita.

**Un usuario sin ninguna asignación vigente tiene alcance vacío, y alcance vacío es no ver nada.** No es «ve todo»: `002A` le responde 200 con `count: 0`, y `003` le responde 404 para cualquier caso. Es la decisión tomada, es la única compatible con llamar a esto un control, y es también la que obliga a poblar `appUserGeoLocation` **antes** de desplegar (§8).

**El alcance se resuelve una vez por petición**, en el servicio, y no se cachea entre peticiones. Una reasignación surte efecto en la petición siguiente.

### 3.3 Los dos exentos

`isAdmin(authUser)` —`src/helpers/permissions.helper.ts:19-21`, SUPERADMIN y ADMIN— **no lleva restricción territorial**. En código, el resolutor devuelve `null` para un administrador, y `null` significa «sin restricción», que es exactamente el convenio que ya usa `buildFacilityInclude` del SPEC F48 (`esaviCase.service.ts:359-368`) para «sin filtro geográfico». Los dos conceptos se componen sin un tercer valor.

La distinción entre `null` (sin restricción) y `[]` (alcance vacío) es la pieza central de este spec y **no se puede colapsar**: `Op.in` sobre una lista vacía no casa con ninguna fila, que es la respuesta correcta para un usuario sin asignaciones, mientras que `null` salta el filtro entero. Confundirlas en un sentido abre el sistema; en el otro, lo cierra a todo el mundo.

`ANALYTICS` (nivel 10) no entra en la cuenta: no alcanza el `validateUserRole(USER)` de ninguna de estas rutas.

### 3.4 Cómo se compone con el filtro explícito del SPEC F48

En `002A` pueden viajar dos restricciones geográficas a la vez: el alcance que impone el servidor y el `geoLocationId` que pide el cliente. **Se intersectan**, y la intersección se calcula sobre listas de identificadores ya expandidas, no sobre el árbol.

| Alcance del usuario | `geoLocationId` en la query | Lista aplicada al `include` |
|---|---|---|
| `null` (administrador) | ausente | `null` — sin `where`, `required: false`, como hoy |
| `null` (administrador) | presente | El subárbol pedido — comportamiento del F48, sin cambios |
| Lista de ids | ausente | El alcance completo |
| Lista de ids | presente | La **intersección** de las dos listas |
| `[]` (sin asignaciones) | cualquiera | `[]` — página vacía |

**La intersección puede quedar vacía, y eso responde 200 con `count: 0`, nunca 403.** Pedir un territorio que no te toca no es un error de autorización que haya que anunciar: es una búsqueda sin resultados. Devolver 403 confirmaría al cliente que el territorio existe y que hay algo detrás, que es justo lo que el 404 del `003` evita (§3.5).

**El `geoLocationId` explícito conserva su semántica completa**: sigue expandiéndose a su subárbol antes de intersectar. Un usuario asignado a una provincia que filtra por uno de sus cantones ve ese cantón; si filtra por un cantón de otra provincia, ve una página vacía.

### 3.5 Reglas de negocio por operación

Ninguna operación cambia de código, de ruta ni de rol. Lo que cambia es lo que cada una comprueba.

**`ESAVI-CASE-002A` — listar activos.** El servicio recibe `authUser`. Resuelve el alcance; si es `null`, se comporta exactamente como hoy. Si es una lista, la intersecta con el subárbol del `geoLocationId` cuando viaja (§3.4) y aplica el resultado al `include` de `healthFacility` con `required: true`, reutilizando el `buildFacilityInclude` que ya existe. **No lanza ningún error**: un alcance vacío es una página vacía.

**`ESAVI-CASE-002B` — listar todos.** No se toca. Es ADMIN y los administradores están exentos.

**`ESAVI-CASE-003` — obtener por ID.** Tras localizar el caso y **antes** de devolverlo, comprueba la pertenencia: la `geoLocation` de la unidad de salud del caso tiene que estar en el alcance. Si no lo está —o si la unidad no tiene `geoLocationId`— responde **404 `esaviCase.notFound`** con el código `CASE_003_OUT_OF_SCOPE`.

**El status es 404 y no 403, deliberadamente.** Un 403 confirma que el caso existe, y la existencia de un caso ESAVI en un territorio ajeno es en sí un dato clínico. Para el cliente, un caso fuera de alcance y un caso inexistente son la misma respuesta, byte a byte: mismo status, mismo mensaje, mismo envoltorio. **El código del `AppError` sí los distingue**, y esa es la única traza que queda —en el log de `esaviLog`, no en la respuesta—, que es donde hace falta para investigar un intento de acceso.

**`ESAVI-CASE-004` — actualizar.** Dos comprobaciones, en este orden y las dos antes del diferencial:

1. **Pertenencia del caso guardado**, idéntica a la del `003` → 404 `esaviCase.notFound`, código `CASE_004_OUT_OF_SCOPE`. Va inmediatamente después del `findByPk` y antes de cualquier otra validación: no se informa de un conflicto sobre una fila que no se puede ver.
2. **Pertenencia de la unidad de salud de destino**, solo si `healthFacilityId` viaja en el body → 404 `esaviCase.healthFacilityNotFound`, código `CASE_004_FACILITY_OUT_OF_SCOPE`. Se comprueba dentro de `assertHealthFacilityIsValid`, que ya existe y ya devuelve 404 para una unidad inactiva: una unidad fuera de tu alcance se comporta igual que una unidad que no existe. Cierra la vía de sacarse un caso del propio territorio, o de meterse uno ajeno.

**`ESAVI-CASE-001` — crear.** La unidad de salud tiene que estar dentro del alcance → 404 `esaviCase.healthFacilityNotFound`, código `CASE_001_FACILITY_OUT_OF_SCOPE`, desde el mismo `assertHealthFacilityIsValid`. Sin esta pieza, un usuario puede crear un caso en un territorio ajeno y perderlo en el mismo instante: el `201` le devuelve el caso y el `GET` siguiente le responde 404. Un estado así no es una restricción, es un error.

**`ESAVI-CASE-005A` y `005B` — desactivar y activar.** No se tocan. Son ADMIN y SUPERADMIN.

### 3.6 Firmas y tipos

**No se añade ninguna interfaz.** `EsaviCaseListFilters` no crece: el alcance no es un filtro del cliente y no viaja por la query. `AuthUser` (`src/types/user/user.types.ts:23-28`) ya lleva `userId` y `roles`, que es todo lo que hace falta.

Cambian tres firmas de servicio, todas en `src/services/esaviCase.service.ts`:

```ts
getEsaviCasesService(filters, limit, offset, authUser?)
getEsaviCaseByIdService(id, lang, canViewInactive, authUser?)
// createEsaviCaseService y updateEsaviCaseService ya reciben authUser: no cambian de firma
```

`authUser` va **al final y opcional** en las dos, por la misma razón por la que el `dateCondition` del F48 mantiene su precedencia interna: un servicio llamado sin la cadena de middlewares tiene que seguir siendo correcto. **`authUser` ausente se trata como alcance vacío, no como administrador** — el valor por defecto de un control es cerrado.

El módulo nuevo es `src/services/common/geoScope.service.ts` y exporta dos funciones:

```ts
resolveGeoSubtreeIds(rootIds: string[]): Promise<string[]>
resolveUserGeoScopeIds(authUser?: AuthUser): Promise<string[] | null>
```

La primera es el CTE del F48 generalizado a N raíces. La segunda devuelve `null` para un administrador, y para el resto lee las asignaciones vigentes y las expande con la primera. Ninguna de las dos abre transacción: son `SELECT`.

### 3.7 Ninguna clave i18n nueva

**Cero.** Los tres errores que este spec introduce reutilizan claves que ya existen en `es`, `en` y `nl`:

| Situación | Clave reutilizada | Status |
|---|---|---|
| Caso fuera de alcance en `003` y `004` | `esaviCase.notFound` | 404 |
| Unidad de salud fuera de alcance en `001` y `004` | `esaviCase.healthFacilityNotFound` | 404 |
| Listado con alcance vacío | — (no es error) | 200 |

**Y la reutilización no es un ahorro, es el mecanismo.** Si el caso fuera de alcance tuviera un mensaje propio, el mensaje sería la fuga que el 404 pretende cerrar. `git diff` sobre `src/data/i18n/` tiene que quedar vacío.

### 3.8 Este spec no cambia ningún contrato de update diferencial

El `ESAVI-CASE-004` es un update diferencial y lo seguirá siendo: su tabla de `candidates` está declarada en el SPEC F06 y su motor es `buildDifferentialUpdate` (`esaviCase.service.ts:437-447`). **Este spec no añade, quita ni reordena ningún candidato.** Lo único que hace es interponer dos guardas de pertenencia **antes** del diff, en la misma posición en la que ya viven la existencia y la validación de FK — que, según §11 de `CONVENTIONS.md`, van antes del diferencial y son independientes de él.

Las otras tres operaciones tocadas no escriben o no son diferenciales: `001` es una creación, `002A` y `003` son de solo lectura. Los cinco criterios obligatorios de §5 siguen aplicando al `004` y se recogen en §6 como verificación de no regresión.

### 3.9 Forma de la respuesta

**No cambia ni un campo, en ninguna de las cuatro operaciones.** `data` del `002A` sigue siendo `{ count, rows }` con la forma que fijó el SPEC F48 §3.9, incluido `healthFacility.geoLocation`. El `003`, el `001` y el `004` devuelven exactamente lo que devuelven hoy.

Lo que cambia es **qué filas** hay dentro y **para quién**, no cómo se ven. Un cliente no tiene forma de distinguir por la forma de la respuesta si el alcance está activo: por eso este spec es incompatible hacia atrás en comportamiento y compatible en contrato (§9).

---

## 4. El tercer consumidor: por qué ahora sí se extrae el recorrido

El SPEC F48 §4 dejó escrito cuándo se revisa su decisión de duplicar el `WITH RECURSIVE`: *«cuando aparezca un tercer consumidor del subárbol de `geoLocation`»*. Este spec es ese tercer consumidor, así que la condición está cumplida y la extracción entra aquí.

**Qué se extrae.** El CTE de `esaviCase.service.ts:332-357` se mueve a `src/services/common/geoScope.service.ts` y se generaliza de una raíz a N raíces —el término base pasa de `= :geoLocationId` a `= ANY(:rootIds)`—. Con eso, la misma función sirve al filtro explícito del F48 (una raíz) y al alcance del usuario (todas sus asignaciones). El `esaviCase.service.ts` la importa y borra su copia.

**Qué no se extrae, y por qué.** `ESAVI-USERGEO-008` conserva su consulta. No es la misma con otra proyección: devuelve `name`, `level`, `parentGeoLocationId` y un `isAssigned` agregado con `bool_or`, porque su respuesta tiene que distinguir lo asignado de lo heredado, y esa distinción no existe en las otras dos llamadas. Reescribirlo sobre el helper significaría dos consultas donde hoy hay una, y a cambio de nada que el cliente note. El argumento del F48 —que cambiarle el motor al endpoint que decide qué territorio ve un usuario es riesgo puro— sigue en pie, y ahora pesa más: a partir de este spec, ese mismo criterio gobierna el acceso a los casos.

**Lo que sí se unifica es la guarda, que era el riesgo real.** `MAX_GEO_SUBTREE_DEPTH = 50` pasa a vivir en `geoScope.service.ts` y `appUserGeoLocation.service.ts` la importa, eliminando `MAX_COVERAGE_DEPTH`. Las dos constantes que el F48 obligaba a mantener iguales por comentario pasan a ser una sola por construcción. El `UNION` en vez de `UNION ALL` se mantiene en los dos sitios y §6 lo verifica.

**Cuándo se revisa esta decisión.** Cuando el `008` necesite cambiar por cualquier otra razón. Entonces se migra dentro de ese spec, con sus verificaciones propias, y no de arrastre en éste.

---

## 5. Plan de implementación

Siete pasos. Cada uno deja el proyecto compilando y arrancable, y cada uno es committeable por separado. **Los tres primeros no cambian ningún comportamiento observable**; a partir del cuarto, cada paso cierra una puerta y tiene su verificación por HTTP.

1. **`src/services/common/geoScope.service.ts` — el módulo, sin consumidores todavía.** `MAX_GEO_SUBTREE_DEPTH = 50` con su comentario, la interfaz local de la fila del CTE, `resolveGeoSubtreeIds(rootIds)` con el término base sobre `ANY(:rootIds)` y las dos guardas de ciclo, y `resolveUserGeoScopeIds(authUser)` con su `null` para `isAdmin`. Alta en el barrel si `services/common/` lo tiene; si no, importación directa, como hacen los cinco servicios comunes existentes.
   *Verificación:* `npm run build` y `npm run lint` en 0. Ningún servicio lo importa aún y `npm test` sigue en verde sin cambios.

2. **Migrar el filtro del SPEC F48 al módulo.** `esaviCase.service.ts` borra su `resolveGeoSubtreeIds` privado, su `MAX_GEO_SUBTREE_DEPTH` y su `GeoSubtreeRow`, e importa la función común pasándole `[filters.geoLocationId]`.
   *Verificación:* los ocho criterios del filtro geográfico del SPEC F48 §6 siguen pasando sin tocar el test. `grep -n "WITH RECURSIVE" src/services/esaviCase.service.ts` no devuelve nada.

3. **Unificar la constante de profundidad.** `appUserGeoLocation.service.ts` importa `MAX_GEO_SUBTREE_DEPTH` de `common/geoScope.service.ts` y elimina `MAX_COVERAGE_DEPTH`. La consulta del `008` no se toca.
   *Verificación:* `grep -rn "MAX_COVERAGE_DEPTH" src/` no devuelve resultados; el `008` responde lo mismo que antes para un usuario con asignaciones en tres niveles.

4. **`ESAVI-CASE-002A` — el alcance en el listado.** `getEsaviCasesService` recibe `authUser`; el controlador le pasa `req.user`. Resolución del alcance y composición con el `geoLocationId` explícito según la tabla de §3.4. `getAllEsaviCasesService` (`002B`) **no se toca**.
   *Verificación:* un USER asignado a una provincia lista solo los casos de sus unidades; un USER sin asignaciones recibe 200 con `count: 0`; un ADMIN sigue viendo todo en `002A` y en `002B`; `?geoLocationId=<cantón ajeno>` devuelve 200 con `count: 0`, no 403.

5. **`ESAVI-CASE-003` — la puerta del detalle.** Guarda de pertenencia tras `findEsaviCaseWithRelations`, con 404 `esaviCase.notFound` y código `CASE_003_OUT_OF_SCOPE`. Firma y controlador.
   *Verificación:* el mismo `caseId` responde 200 para el USER de su territorio y 404 para el USER de otro; las dos respuestas de 404 —caso inexistente y caso ajeno— son idénticas en status, `message` y `code` del envoltorio; el log distingue las dos.

6. **`ESAVI-CASE-001` y `ESAVI-CASE-004` — las puertas de escritura.** La comprobación de alcance dentro de `assertHealthFacilityIsValid`, que ya recibe el código de operación, y la guarda de pertenencia del caso guardado al principio del `004`, antes de la coherencia de fechas y antes del diferencial.
   *Verificación:* crear un caso en una unidad ajena responde 404 y no inserta nada; editar un caso ajeno responde 404 sin tocar la fila; mover un caso propio a una unidad ajena responde 404; editar un caso propio sigue comportándose exactamente igual que antes.

7. **Fixtures y casos de contrato.** `tests/setup/auth.ts` gana usuarios con asignación territorial —hoy solo emite un usuario por rol, sin geografía—, y `tests/contract/esaviCase.test.ts` cubre los criterios de §6. Hace falta sembrar dos ramas independientes de la jerarquía, con unidades de salud y casos en cada una, y un usuario asignado a cada rama.
   *Verificación:* `npm run check` en 0.

**`tests/auth/roles.test.ts` no se toca en ningún paso.** No hay rutas nuevas, y que `ROUTE_RULES` no cambie es en sí la comprobación de que este spec se mantuvo dentro de su alcance.

---

## 6. Criterios de aceptación

**El alcance en el listado (`002A`):**

- [ ] Un USER asignado a una provincia lista los casos de las unidades de salud colgadas de sus cantones y parroquias, y ninguno de otra provincia.
- [ ] Un USER **sin ninguna fila** en `appUserGeoLocation` recibe 200 con `count: 0`, **nunca 403 ni 500**.
- [ ] Un USER cuya única asignación tiene `validTo` en el pasado recibe 200 con `count: 0`.
- [ ] Un USER cuya única asignación tiene `isActive: false` recibe 200 con `count: 0`.
- [ ] Desactivar la `geoLocation` asignada deja al usuario con `count: 0`, aunque sus descendientes sigan activos.
- [ ] Un ADMIN y un SUPERADMIN reciben en `002A` exactamente el mismo `count` que antes de este spec, con y sin asignaciones propias.
- [ ] `count` con `limit=2` es el total del alcance, no 2.

**La composición con el filtro del SPEC F48:**

- [ ] Un USER de la provincia A que filtra por un cantón de A ve los casos de ese cantón.
- [ ] Un USER de la provincia A que filtra por un cantón de B recibe 200 con `count: 0`, **no 403**.
- [ ] Un USER asignado a un cantón que filtra por la provincia entera ve solo los casos de su cantón: la intersección, no la unión.
- [ ] Los ocho criterios del filtro geográfico del SPEC F48 §6 siguen pasando para un ADMIN, sin modificar el test.

**La puerta del detalle (`003`):**

- [ ] `GET /api/esavi-cases/:id` sobre un caso del propio territorio responde 200 con la misma forma que antes.
- [ ] El mismo `caseId` responde 404 para un USER de otro territorio.
- [ ] La respuesta de un caso ajeno y la de un `caseId` inexistente son **idénticas**: mismo status, mismo `message`, mismo `code` en el envoltorio del `errorHandler`. Un cliente no puede distinguirlas.
- [ ] En `src/logs/esaviLog.log`, las dos situaciones sí se distinguen: `CASE_003_OUT_OF_SCOPE` frente a `CASE_003_NOT_FOUND`.
- [ ] Un ADMIN alcanza cualquier caso por el `003`.

**Las puertas de escritura (`001`, `004`):**

- [ ] Crear un caso con una `healthFacilityId` fuera del alcance responde 404 `esaviCase.healthFacilityNotFound` y **no inserta ninguna fila**: ni en `esaviCase` ni en `caseWorkflow`.
- [ ] Crear un caso en una unidad del propio territorio sigue respondiendo 201, con el `caseCode` generado igual que antes.
- [ ] Un caso creado por un USER es inmediatamente legible por ese mismo USER con el `003`. **Es el criterio que justifica incluir el `001` en este spec.**
- [ ] Editar un caso ajeno responde 404 y la fila no cambia: `updatedAt` no se mueve, `appDetails` no crece y `sysDetails.version` no avanza.
- [ ] Mover un caso propio a una unidad de salud fuera del alcance responde 404 y no escribe nada.
- [ ] La guarda de pertenencia del `004` se ejecuta **antes** que la coherencia de fechas: un caso ajeno con fechas incoherentes en el body responde 404, no 400.

**No regresión del update diferencial del `004`:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET`, sobre un caso del propio territorio, responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio sigue usando `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/esaviCase.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada.

**Casos sin territorio:**

- [ ] Un caso abierto en una unidad de salud con `geoLocationId: null` no lo alcanza ningún USER, por ninguna de las cuatro operaciones, y sí lo alcanza un ADMIN por el `002B` y por el `003`.

**La extracción del recorrido (§4):**

- [ ] `grep -rn "WITH RECURSIVE" src/services/` devuelve exactamente dos apariciones: `common/geoScope.service.ts` y `appUserGeoLocation.service.ts`.
- [ ] `grep -rn "MAX_COVERAGE_DEPTH" src/` no devuelve resultados; la constante única vale 50.
- [ ] Las dos consultas restantes usan `UNION`, no `UNION ALL`.
- [ ] Un árbol con un ciclo sembrado a mano —A padre de B, B padre de A— devuelve respuesta en el `002A`, en el `003` y en el `008`, y no cuelga ninguna de las tres peticiones.
- [ ] `ESAVI-USERGEO-008` devuelve exactamente lo mismo que antes del spec para un usuario con asignaciones en tres niveles.

**Convenciones:**

- [ ] `src/routes/esaviCase.routes.ts` no cambia, y `ROUTE_RULES` en `tests/auth/roles.test.ts` tampoco.
- [ ] **Ninguna clave i18n nueva**: `git diff` sobre `src/data/i18n/` está vacío y `npm run i18n:check` sale en 0.
- [ ] **Ningún código de operación nuevo**: `grep -rn "ESAVI-CASE-00" src/` devuelve las mismas apariciones que antes del spec. Los códigos de `AppError` nuevos —`CASE_003_OUT_OF_SCOPE`, `CASE_004_OUT_OF_SCOPE`, `CASE_001_FACILITY_OUT_OF_SCOPE`, `CASE_004_FACILITY_OUT_OF_SCOPE`— son variantes de error dentro de operaciones existentes, no operaciones nuevas.
- [ ] Los controladores no importan ningún modelo ni resuelven ningún alcance: pasan `req.user` y nada más.
- [ ] `resolveUserGeoScopeIds(undefined)` devuelve `[]`, no `null`: sin usuario, el alcance es vacío.
- [ ] Ninguna función de `common/geoScope.service.ts` abre transacción ni contiene `.update(`, `.create(` ni `.destroy(`.
- [ ] `npm run check` sale en 0.

---

## 7. Decisiones tomadas y descartadas

- **Sí:** control de acceso, no comodidad de listado. Acotar solo el `002A` dejaría el caso ajeno entero —con el paciente descifrado— a un `GET /:id` de distancia. El coste es cuatro operaciones en vez de una.
- **Sí:** **un usuario sin asignaciones no ve nada.** Es la decisión que hace que esto sea un control: el criterio contrario —«sin asignaciones ve todo»— convierte el alcance en opcional y garantiza que nunca llegue a aplicarse, porque el estado por defecto de cualquier usuario nuevo sería el irrestricto. El precio, asumido y explícito, es que `appUserGeoLocation` tiene que estar poblada antes del despliegue (§8).
- **No:** una bandera en `systemConfig` para activar el alcance por fases. Se evaluó como mitigación del riesgo de despliegue y se descartó por tres razones: una bandera que apaga un control de acceso es una bandera que alguien apaga en producción para desbloquear un incidente y nadie vuelve a encender; obliga a mantener y probar los dos comportamientos indefinidamente; y el problema que resuelve —poblar la tabla— se resuelve mejor poblando la tabla, que es trabajo acotado y verificable de una vez.
- **Sí:** administradores exentos. Sin una vía sin restricción territorial, un caso en una unidad de salud sin geolocalizar sería inalcanzable por API para todo el mundo. El `002B` ya era el endpoint de esa vía.
- **Sí:** 404 y no 403 para un caso fuera de alcance. La existencia de un caso ESAVI en un territorio ajeno es en sí un dato clínico, y un 403 la confirma. La traza para investigar el intento queda en el código del `AppError` y en el log, no en la respuesta.
- **Sí:** 200 con página vacía y no 403 cuando el `geoLocationId` pedido cae fuera del alcance. Es la norma que ya declara `buildListWhere` para un filtro que no casa (`esaviCase.service.ts:255-257`), y un 403 aquí confirmaría al cliente que ese territorio existe.
- **Sí:** intersección con el filtro del SPEC F48, no sustitución ni prioridad. Son dos preguntas distintas —lo que el cliente pide ver y lo que puede ver— y la respuesta correcta es la que satisface las dos.
- **Sí:** incluir el `001`. Sin él, un usuario crea un caso en territorio ajeno y lo pierde en el mismo instante: el `201` se lo devuelve y el `GET` siguiente le responde 404. Es la única de las cuatro operaciones que no aporta confidencialidad, y entra por coherencia.
- **Sí:** reutilizar `esaviCase.notFound` y `esaviCase.healthFacilityNotFound` en vez de acuñar mensajes propios. Un mensaje propio para «fuera de tu territorio» sería exactamente la fuga que el 404 cierra.
- **Sí:** `authUser` ausente equivale a alcance vacío, no a exención. El valor por defecto de un control es cerrado, y un servicio llamado fuera de la cadena de middlewares no debe abrirse solo.
- **Sí:** `null` para «sin restricción» y `[]` para «alcance vacío», reutilizando el convenio que el SPEC F48 ya estableció en `buildFacilityInclude`. Un tercer valor —un booleano aparte— multiplicaría los estados sin añadir información.
- **Sí:** resolver el alcance en cada petición. `tokenValidation` ya re-lee al usuario con sus roles en cada petición; el territorio sigue el mismo criterio y una reasignación surte efecto de inmediato.
- **No:** meter la cobertura en el JWT. Haría que quitarle el territorio a alguien tardara hasta la expiración del token, que es lo contrario de lo que un control de acceso necesita.
- **No:** comprobar `validFrom`. El `008` no lo hace, `CK_appUserGeoLocation_dates` ya garantiza la coherencia de las dos fechas, y una definición de cobertura distinta a la del `008` sería la divergencia que este spec evita.
- **No:** extender el alcance a las 22 entidades satélite en este spec. Cada una arrastra su propio servicio y su propio `caseId`, y hacerlo aquí convertiría siete pasos en más de treinta. Va en su spec, y hasta entonces el límite está declarado en §2 y en §8.
- **No:** migrar `ESAVI-USERGEO-008` al helper extraído. Su consulta devuelve cinco columnas y un agregado que ninguna otra llamada necesita; reescribirla es riesgo sobre el endpoint que define la cobertura, a cambio de nada visible. Ver §4.
- **No:** un contador de casos excluidos por alcance en la respuesta del listado. Informar de cuánto no puedes ver es informar sobre lo que no puedes ver.

---

## 8. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **El día del despliegue, todo USER sin asignaciones se queda sin casos.** `appUserGeoLocation` está prácticamente vacía hoy, y la decisión de §7 es que alcance vacío es no ver nada. El síntoma no es un error: es un listado vacío, que un operador lee como pérdida de datos | **Precondición de despliegue, no una bandera.** Antes de subir este spec hay que asignar territorio a cada usuario activo con rol USER, y verificarlo con el propio `ESAVI-USERGEO-008` usuario por usuario. `ESAVI-USERGEO-007` —asignación masiva— existe justamente para eso. La consulta de verificación previa es directa: los `appUser` activos con rol USER que no tienen ninguna fila vigente en `appUserGeoLocation`. Si esa lista no está vacía, el spec no se despliega |
| **El expediente clínico sigue alcanzable por las rutas satélite.** `GET /api/notifications?caseId=…` y las de investigación no llevan alcance después de este spec, así que quien tenga el `caseId` de un caso ajeno sigue leyendo su contenido | Declarado sin rodeos en §2 y aquí. Es el límite conocido de este spec y su continuación es el spec siguiente. Lo que este spec sí cierra es el descubrimiento: sin el `002A` ni el `003`, obtener el `caseId` de un caso ajeno deja de ser trivial. **No es equivalente a estar cerrado**, y no debe presentarse como tal |
| **Un usuario pierde acceso a los casos que él mismo creó** si se le reasigna de territorio. Los casos quedan en el territorio antiguo | Es la consecuencia correcta de un alcance territorial: los casos pertenecen al territorio, no a quien los tecleó. `ESAVI-USERGEO-006` —reasignación— es la operación que provoca esto y ya es de rol administrador. La mitigación es operativa: reasignar con conocimiento de lo que implica |
| **Desactivar una `geoLocation` intermedia deja sin alcance a los usuarios asignados por debajo**, y sin ningún aviso | Heredado del `008` y del SPEC F48 §8, con la misma decisión: un solo criterio de territorio vigente en todo el repositorio. La mitigación real es que desactivar una unidad territorial con descendientes activos es lo que no debería hacerse, y eso es una regla del CRUD de `geoLocation` |
| **Dos consultas más por petición en el endpoint más caliente**: las asignaciones y el CTE del alcance. Un administrador no paga ninguna de las dos | Las dos son sobre columnas indexadas —`IX_appUserGeoLocation_userId`, `IX_geoLocation_parent`— y el resultado es una lista de UUID que cabe en memoria. El alcance se resuelve una vez por petición, no una por fila. Si el volumen lo exige, una caché por petición es la salida, y no cambia el contrato |
| **Un alcance muy amplio produce un `Op.in` con miles de identificadores.** Un usuario asignado al nivel país expande a toda la jerarquía | El síntoma es una consulta grande, no incorrecta. Si aparece en la práctica, la salida es reconocer el alcance de nivel raíz y tratarlo como `null` —el usuario cubre todo—, y eso es un ajuste de una línea en `resolveUserGeoScopeIds`. No se implementa por adelantado |
| **Un servicio nuevo que liste casos y olvide pedir el alcance queda abierto por omisión.** El control es opt-in por llamada, no una barrera del pipeline | `authUser` opcional que por defecto cierra (§3.6) limita el daño a quien lo omita entero. La barrera estructural sería un middleware o un scope de Sequelize, y ninguno de los dos encaja en el pipeline actual `routes → controller → service → model` sin un rediseño transversal. Queda como riesgo aceptado y como argumento a favor del spec de las satélite |
| **La generalización del CTE a N raíces cambia el filtro del SPEC F48, que hoy funciona** | El paso 2 es una migración pura, sin cambio de comportamiento, y su verificación es que los ocho criterios geográficos del F48 §6 pasen **sin tocar el test**. Si hay que tocar el test, la migración está mal |

---

## 9. Impacto en el contrato HTTP

**El contrato no cambia. El comportamiento sí, y de forma incompatible hacia atrás para el rol USER.**

Lo que **no** cambia: ninguna ruta, ningún código de operación, ningún rol, ninguna clave i18n, ningún campo de `data`, ningún mensaje. `src/routes/esaviCase.routes.ts` no se toca y `ROUTE_RULES` tampoco. Para un ADMIN o un SUPERADMIN, la API responde exactamente lo mismo que antes en las siete operaciones de `esaviCase`.

Lo que **sí** cambia, y solo para usuarios con rol USER sin nivel administrador:

1. **`GET /api/esavi-cases` devuelve menos filas**, y para un usuario sin asignaciones devuelve cero. Mismo status, mismo envoltorio, distinto `count`.
2. **`GET /api/esavi-cases/:id` pasa de 200 a 404** para los casos fuera del territorio.
3. **`POST /api/esavi-cases` pasa de 201 a 404** cuando la unidad de salud está fuera del territorio.
4. **`PUT /api/esavi-cases/:id` pasa de 200 a 404** para un caso ajeno, o cuando se intenta mover el caso a una unidad ajena.

Los cuatro son endurecimientos deliberados y ninguno introduce un status que el endpoint no devolviera ya por otras razones: los tres 404 son indistinguibles de los que la operación ya emitía. **Un cliente correctamente escrito no necesita ningún cambio**; un cliente que asumía que un `caseId` válido siempre es legible sí.

**El esquema no cambia**: ni tablas, ni columnas, ni índices, ni triggers.

---

## Lo que **no** está en este spec

- Alcance geográfico sobre `notification`, `investigation` y las veinte tablas restantes del expediente. **Hasta que aterrice, el contenido clínico de un caso ajeno sigue siendo alcanzable por esas rutas con el `caseId` en la mano.**
- Alcance sobre `patient`, `healthFacility`, `geoLocation` o cualquier otra entidad.
- Alcance sobre `ESAVI-CASE-002B`, `005A` y `005B`.
- Una bandera de configuración para activar o desactivar el alcance.
- Alcance por la geografía de residencia del paciente.
- Un rol territorial nuevo o cambios en `ROLE_LEVELS`.
- Cachear la cobertura en el JWT o entre peticiones.
- Migrar `ESAVI-USERGEO-008` al recorrido común.
- Señalar en la respuesta cuántos casos quedaron fuera por alcance.
- Un middleware o un scope de Sequelize que imponga el alcance a nivel de pipeline.

Cada uno de esos, si aterriza, va en su propio spec.
