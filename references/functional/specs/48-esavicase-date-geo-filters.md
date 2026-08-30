# SPEC F48 — Filtros de fecha y unidad geográfica en el listado de casos ESAVI

> **Estado:** Implementado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 04 (consistencia del contrato), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), **SPEC F06 (`esaviCase`, `ESAVI-CASE-002A`/`002B`, implementado)**, SPEC F01 (`appUserGeoLocation`, `ESAVI-USERGEO-008` — precedente del recorrido recursivo, no dependencia de código)
> **Fecha:** 2026-08-30
> **Objetivo:** Permitir acotar el listado de casos ESAVI por cualquiera de sus tres fechas —exacta o por rango— y por la unidad geográfica de la unidad de salud que los reportó, incluyendo todas las unidades que cuelgan de ella.

---

## 1. Por qué existe este spec

**El listado de casos hoy solo sabe acotar por una fecha y no sabe nada de geografía.** `buildListWhere` (`esaviCase.service.ts:258-275`) acumula cuatro filtros con AND: `patientId`, `healthFacilityId`, `reportDateFrom` y `reportDateTo`. Es todo. Un `002A` o un `002B` no pueden responder ninguna de las dos preguntas que la vigilancia epidemiológica hace primero.

**La primera pregunta es por la fecha del evento, no por la del papeleo.** `reportDate` es la fecha en que alguien registró el caso; `eventDate` es la fecha en que la persona presentó el evento adverso. Un conglomerado de ESAVI se detecta buscando eventos ocurridos en la misma ventana, no reportes tecleados en la misma ventana — y entre las dos fechas puede haber días o semanas de retraso de notificación. Hoy `eventDate` está en la tabla (`esaviapp.sql:690`), viaja en el body del `001` y del `004`, se devuelve en cada fila del listado (`LIST_ATTRIBUTES`, `esaviCase.service.ts:58`) y **no se puede filtrar por ella**. `reportFillingDate` está en la misma situación.

**La segunda pregunta es por territorio, y hoy no tiene ninguna respuesta.** El único filtro espacial disponible es `healthFacilityId`: una unidad de salud concreta, de una en una. Para saber qué pasó en una provincia hay que conocer de antemano el listado completo de sus establecimientos, pedirlos uno a uno y sumar a mano en el cliente. La estructura que hace falta ya existe en el esquema —`esaviCase.healthFacilityId → healthFacility.geoLocationId → geoLocation.parentGeoLocationId`, con la jerarquía autorreferente completa— y nadie la recorre desde el listado de casos.

**El caso exacto es hoy un truco no evidente.** Buscar los casos de un día concreto exige mandar `reportDateFrom` y `reportDateTo` con el mismo valor. Funciona, pero es una convención que no está escrita en ninguna parte del contrato, y es la consulta más frecuente que hace un operador.

**Filtrar por un nodo sin expandir su subárbol no sirve de nada, y conviene decirlo antes de §3.** `healthFacility.geoLocationId` apunta casi siempre a la unidad más fina de la jerarquía —la parroquia, el cantón—, no a la provincia. Un filtro de igualdad estricta contra una provincia devolvería cero filas en una base perfectamente poblada, y el usuario concluiría que no hay casos. Por eso este spec resuelve el subárbol, y por eso lo hace con un recorrido recursivo y no con un `IN` plano.

**La maquinaria de ese recorrido ya está escrita y probada en el repositorio.** `ESAVI-USERGEO-008` (`appUserGeoLocation.service.ts:536-568`) expande la cobertura de un usuario con un `WITH RECURSIVE`, dos guardas contra ciclos —`UNION` en vez de `UNION ALL` y un tope explícito de profundidad— y parámetros ligados en vez de interpolación de cadenas. Este spec no inventa la técnica: la aplica a otra raíz.

---

## 2. Alcance

**Dentro:**

- **Nueve parámetros de fecha** en `GET /api/esavi-cases` (`ESAVI-CASE-002A`) y `GET /api/esavi-cases/admin` (`ESAVI-CASE-002B`): exacta, `From` y `To` para cada una de `reportDate`, `eventDate` y `reportFillingDate`. Los dos ya existentes —`reportDateFrom` y `reportDateTo`— conservan su nombre y su comportamiento.
- **Un parámetro `geoLocationId`**, que acota a los casos cuya unidad de salud pertenece a esa unidad geográfica **o a cualquiera de sus descendientes activos**, resuelto con un `WITH RECURSIVE` local al servicio de casos.
- **Validación cruzada en el validador**: exacta y rango sobre la misma columna son mutuamente excluyentes, y `From` no puede ser posterior a `To`. Salen por el `400` estándar de `validateFields`.
- **Dos índices nuevos en `esaviapp.sql`**: `IX_esaviCase_eventDate` e `IX_esaviCase_reportFillingDate`, junto al `IX_esaviCase_reportDate` que ya existe (`:707`).
- **Ampliación aditiva de la fila del listado**: `healthFacility` pasa a llevar anidado `geoLocation: { geoLocationId, name }` en `002A` y `002B`.
- `EsaviCaseListFilters` (`src/types/esaviCase/esaviCase.types.ts:16`) crece de cuatro claves a trece.
- Casos nuevos en `tests/contract/esaviCase.test.ts`.

**Fuera de alcance (otros specs, o descartado):**

- **Rutas nuevas.** No hay `006`, no hay `/search`. Los dos listados existentes crecen en filtros; `src/routes/esaviCase.routes.ts` no se toca y `ROUTE_RULES` (`tests/auth/roles.test.ts`) no cambia ni una fila.
- **Claves i18n nuevas.** Ninguna. Todos los errores que este spec introduce son de forma de la query y los emite `validateFields` con `common.validationError`, que ya existe en los tres idiomas.
- **Varias unidades geográficas a la vez.** `geoLocationId` admite un UUID, no una lista. Admitir varias obliga a decidir la semántica de la unión de subárboles solapados y multiplica el recorrido; si aterriza, es su propio spec.
- **Un `includeDescendants=false`.** El filtro geográfico es siempre jerárquico. Un modo de igualdad estricta sería un segundo comportamiento para el mismo parámetro y §7 explica por qué no se ofrece.
- **Migrar `ESAVI-USERGEO-008` a un servicio común de subárbol.** Se evaluó y se descartó: ver §4. El CTE de este spec vive en `esaviCase.service.ts` y el `008` queda intacto.
- **Filtrar por la geografía de residencia del paciente.** `patient` tiene su propia geolocalización de residencia, y no es la misma pregunta: este spec filtra por **dónde se reportó el caso**, no por dónde vive la persona. Un `patientGeoLocationId` es otro filtro, con otra semántica y otro spec.
- **Ordenación por fecha de evento o por geografía.** `LIST_ORDER` sigue siendo `reportDate DESC, caseCode DESC` (`esaviCase.service.ts:70`). Cambiarlo altera la paginación de clientes existentes.
- **Agregados, conteos por unidad geográfica o series temporales.** Este spec devuelve filas paginadas, no un informe. Un `GET /api/esavi-cases/stats` es otro spec.
- **Filtrar por el estado del flujo (`caseWorkflow`), por clasificación o por gravedad.** Todos son filtros legítimos y ninguno entra aquí: cada uno cuelga de una tabla distinta y arrastra su propio `include`.
- **Exportación a CSV o Excel del resultado filtrado.**
- **Tocar `esaviCaseIdValidator`, `createEsaviCaseValidator` o `updateEsaviCaseValidator`.** Las reglas de fecha del body —incluida `isNotFutureDate`— no cambian, y §3.7 explica por qué los filtros no las heredan.
- **Cualquier escritura.** Ver §3.8.

---

## 3. Modelo de datos

**No hay tablas nuevas, ni columnas nuevas, ni modelos nuevos, ni asociaciones nuevas.** El único cambio de esquema son dos índices (§3.2). Las sub-secciones de tabla origen y modelo Sequelize de la plantilla se sustituyen por el inventario de lo que se consulta.

### 3.1 Columnas consultadas

Todas existen y ninguna cambia de tipo ni de nulabilidad.

| Tabla | Columna | Tipo | Nulo | Papel en este spec |
|---|---|---|---|---|
| `esaviCase` | `reportDate` | `date` | no, `DEFAULT current_date` | Filtro exacto y de rango. Ya indexada (`esaviapp.sql:707`) |
| `esaviCase` | `eventDate` | `date` | **sí** | Filtro exacto y de rango. Índice nuevo (§3.2) |
| `esaviCase` | `reportFillingDate` | `date` | **sí** | Filtro exacto y de rango. Índice nuevo (§3.2) |
| `esaviCase` | `healthFacilityId` | `uuid` | no | Puente hacia la geografía. `IX_esaviCase_patient` no lo cubre; el join lo resuelve por la PK de `healthFacility` |
| `healthFacility` | `geoLocationId` | `uuid` | **sí** | Columna contra la que se aplica el subárbol. Indexada (`esaviapp.sql:498`) |
| `geoLocation` | `geoLocationId` | `uuid` | no | Raíz del recorrido |
| `geoLocation` | `parentGeoLocationId` | `uuid` | **sí** | Arista del recorrido. Indexada (`esaviapp.sql:470`) |
| `geoLocation` | `isActive` | `boolean` | no | Corta ramas (§3.4) |
| `geoLocation` | `name` | `varchar(200)` | no | Se devuelve en la fila del listado (§3.9) |

**Las dos fechas nuevas son nulables, y eso tiene una consecuencia que se declara aquí:** un caso sin `eventDate` **nunca** aparece cuando se filtra por `eventDate`, en ninguna de sus tres formas. `NULL` no satisface `=`, ni `>=`, ni `<=`, ni `BETWEEN`. No es un caso especial que haya que manejar: es la semántica de SQL y es la correcta —quien pregunta por eventos ocurridos en marzo no está preguntando por casos cuya fecha de evento se desconoce—. Lo mismo vale para `reportFillingDate`. `reportDate` es `NOT NULL`, así que no le afecta.

### 3.2 Índices nuevos

En `esaviapp.sql`, inmediatamente después del `IX_esaviCase_reportDate` existente (`:707`):

```sql
CREATE INDEX IF NOT EXISTS "IX_esaviCase_eventDate" ON "esaviCase" ("eventDate");
CREATE INDEX IF NOT EXISTS "IX_esaviCase_reportFillingDate" ON "esaviCase" ("reportFillingDate");
```

Son la contrapartida obligada de admitir el filtro: sin ellos, cada consulta por `eventDate` recorre la tabla entera, y `esaviCase` es la tabla que más crece del esquema. El `IF NOT EXISTS` es el mismo idioma del resto del archivo.

**El repositorio no tiene sistema de migraciones** —`esaviapp.sql` es el DDL autoritativo y no hay `sequelize.sync()`—, así que en una base ya desplegada las dos sentencias hay que ejecutarlas a mano. Este spec no entrega un `.sql` de parche aparte: las dos líneas de arriba son el parche, y son idempotentes.

### 3.3 Contrato de la query

```
GET /api/esavi-cases[/admin]?<filtros>&limit=&offset=
```

Trece filtros, todos opcionales, **todos acumulados con AND**. Los cuatro primeros ya existen y no cambian:

| Parámetro | Tipo | Semántica |
|---|---|---|
| `patientId` | UUID | igualdad *(existe)* |
| `healthFacilityId` | UUID | igualdad *(existe)* |
| `reportDateFrom` | `YYYY-MM-DD` | `>=` *(existe)* |
| `reportDateTo` | `YYYY-MM-DD` | `<=` *(existe)* |
| `reportDate` | `YYYY-MM-DD` | igualdad — **excluye** a los dos anteriores |
| `eventDateFrom` | `YYYY-MM-DD` | `>=` |
| `eventDateTo` | `YYYY-MM-DD` | `<=` |
| `eventDate` | `YYYY-MM-DD` | igualdad — **excluye** a los dos anteriores |
| `reportFillingDateFrom` | `YYYY-MM-DD` | `>=` |
| `reportFillingDateTo` | `YYYY-MM-DD` | `<=` |
| `reportFillingDate` | `YYYY-MM-DD` | igualdad — **excluye** a los dos anteriores |
| `geoLocationId` | UUID | subárbol (§3.4) |

**La exclusión mutua es por columna, no global.** `?reportDate=2026-03-01&eventDateFrom=2026-02-01` es una consulta válida y frecuente: «casos reportados ese día cuyo evento fue de febrero en adelante». Lo que no se admite es `?reportDate=…&reportDateFrom=…`, porque las dos formas gobiernan la misma columna y no hay una lectura obvia de su combinación. Se rechaza con 400 en el validador (§3.7), no se resuelve dando prioridad a una de las dos.

**Las fechas se recortan a `YYYY-MM-DD` antes de comparar**, con el `normalizeIsoDate` que ya existe (`esaviCase.service.ts:22`). Las tres columnas son `date`, así que un timestamp ISO completo que llegue del cliente no puede desplazar el día por la zona horaria del servidor. Es la misma razón por la que el validador de body ya trabaja sobre `String(value).slice(0, 10)`.

**El rango es inclusivo en los dos extremos**: `Op.between` cuando viajan `From` y `To`, `Op.gte` con solo `From`, `Op.lte` con solo `To`. Es lo que ya hace `buildListWhere` para `reportDate` y no cambia.

### 3.4 El subárbol geográfico

**El filtro `geoLocationId` se resuelve en dos pasos**, y el primero es una consulta aparte que ocurre antes del `findAndCountAll`.

**Paso 1 — expandir el subárbol.** Un `WITH RECURSIVE` local a `esaviCase.service.ts`, ejecutado con `sequelize.query` y `QueryTypes.SELECT`:

```sql
WITH RECURSIVE subtree AS (
    SELECT g."geoLocationId", 1 AS depth
    FROM "geoLocation" g
    WHERE g."geoLocationId" = :geoLocationId
      AND g."isActive" = true
    UNION
    SELECT c."geoLocationId", s.depth + 1
    FROM subtree s
    JOIN "geoLocation" c ON c."parentGeoLocationId" = s."geoLocationId"
    WHERE c."isActive" = true
      AND s.depth < :maxDepth
)
SELECT "geoLocationId" FROM subtree
```

Devuelve la raíz **y** todos sus descendientes activos, a cualquier profundidad. Cuatro propiedades, todas heredadas del `ESAVI-USERGEO-008` y ninguna negociable:

- **`UNION` y no `UNION ALL`.** Deduplica, y con ello un ciclo en los datos deja de ser una recursión infinita.
- **Tope explícito de profundidad.** `MAX_GEO_SUBTREE_DEPTH = 50`, constante propia del archivo con el mismo valor que `MAX_COVERAGE_DEPTH` (`appUserGeoLocation.service.ts:14`). Ninguna restricción del DDL puede detectar un ciclo: `CK_geoLocation_notSelfParent` solo impide que una fila sea su propio padre, no que A→B→A. Las dos guardas son independientes y las dos se mantienen.
- **Parámetros ligados**, nunca interpolación de cadenas.
- **Solo se selecciona `geoLocationId`.** No hace falta nada más: el resultado es la lista de identificadores del paso 2.

**Paso 2 — aplicar la lista al listado.** El `HEALTH_FACILITY_INCLUDE` existente (`esaviCase.service.ts:45-49`) se compone con un `where` y pasa a ser obligatorio:

```ts
{ ...HEALTH_FACILITY_INCLUDE, where: { geoLocationId: { [Op.in]: subtreeIds } }, required: true }
```

**El `required: true` solo se aplica cuando `geoLocationId` viaja.** Sin el filtro, el `include` sigue siendo el de siempre —un `LEFT JOIN` que no descarta filas—. La diferencia importa y se declara: con `required: true`, `findAndCountAll` calcula el `count` sobre el join, que es exactamente lo que se quiere aquí, pero es un plan de consulta distinto al del listado sin filtro geográfico.

**`Op.in` sobre una lista vacía es `IN (NULL)`, que no casa con ninguna fila.** Es el comportamiento correcto y el que sostiene la decisión de §3.5: una raíz inexistente o desactivada produce subárbol vacío, y el listado devuelve `count: 0`.

**Tres consecuencias declaradas y aceptadas:**

1. **Una unidad de salud sin `geoLocationId` nunca aparece bajo este filtro.** La columna es nullable (`esaviapp.sql:476`) y `NULL` no satisface `IN`. Los casos abiertos en ella siguen siendo visibles en el listado sin filtro geográfico, y solo desaparecen cuando se pregunta por territorio. Es la pregunta la que no los alcanza, no el filtro el que los pierde.
2. **Desactivar una `geoLocation` intermedia corta la rama.** Sus descendientes dejan de alcanzarse desde cualquier ancestro, aunque ellos sigan activos. Es la misma regla que aplica el `008` y se mantiene por coherencia: una unidad territorial desactivada no forma parte de ninguna cobertura.
3. **Las unidades de salud inactivas NO se filtran.** El join no lleva `isActive: true` sobre `healthFacility`. Un caso activo abierto en un establecimiento que después se dio de baja sigue siendo un caso que debe aparecer en la vigilancia de su territorio; ocultarlo sería pérdida silenciosa de datos. La visibilidad de las filas la decide `isActive` **del caso**, en el `where` de `002A`, como hasta ahora.

**Coste.** Una consulta recursiva extra por petición, solo cuando `geoLocationId` viaja, sobre `IX_geoLocation_parent`. El paso 2 usa `IX_healthFacility_geoLocation`. No hay recorrido de tabla en ninguno de los dos.

### 3.5 Reglas de negocio por operación

Las dos operaciones son las existentes y ninguna cambia de ruta, de código ni de rol.

```
GET /api/esavi-cases          ESAVI-CASE-002A   USER    (existe — crece en filtros)
GET /api/esavi-cases/admin    ESAVI-CASE-002B   ADMIN   (existe — crece en filtros)
```

**`ESAVI-CASE-002A` y `ESAVI-CASE-002B` — listar con filtros.** El comportamiento es idéntico en las dos salvo por `isActive`, que ya las distingue hoy:

1. El controlador arma el objeto de filtros desde `req.query` con `listFilters` (`esaviCase.controller.ts`), que pasa de cuatro claves a trece. No valida nada: eso ya ocurrió en el validador.
2. `buildListWhere` acumula con AND. Para cada una de las tres columnas de fecha, en este orden: si viaja la exacta, `where.<col> = normalizeIsoDate(exacta)`; si no, se aplica el rango con `Op.between` / `Op.gte` / `Op.lte` según qué extremos viajen; si no viaja nada, la columna no entra en el `where`.
3. Si viaja `geoLocationId`, se ejecuta el `WITH RECURSIVE` de §3.4 y se obtiene `subtreeIds`. Si el resultado es una lista vacía —la raíz no existe, o está inactiva— **no se corta la ejecución**: la lista vacía se aplica igual y el `Op.in` devuelve cero filas.
4. `findAndCountAll` con `attributes: LIST_ATTRIBUTES`, `include: [LIST_PATIENT_INCLUDE, <el include de facility de §3.4>]`, `order: LIST_ORDER`, `limit` y `offset`. Nada de esto cambia respecto de hoy.
5. `002A` añade `isActive: true` al `where`; `002B` no. Igual que hoy.
6. Las filas pasan por `toEsaviCaseListRow`, que descifra la PII del paciente. Igual que hoy.

**Un filtro que no encuentra nada devuelve 200 con `count: 0`, nunca 404.** Es la norma que el propio archivo ya declara (`esaviCase.service.ts:255-257`) para `patientId` y `healthFacilityId`, y **`geoLocationId` no es una excepción**: un UUID de unidad geográfica que no existe produce una página vacía, no un `CASE_002_GEOLOC_NOT_FOUND`. Se consideró la excepción —un UUID mal tecleado es indistinguible de «no hay casos en esa provincia»— y se descartó en §7: tener dos filtros que dan página vacía y un tercero que da 404 obliga al cliente a un caso especial por parámetro, y la ambigüedad se resuelve en el frontend, que ya conoce la unidad porque la eligió de un selector.

**Ninguna FK se valida.** Este spec no comprueba que la `geoLocation` exista antes de expandirla, y la ausencia es deliberada: la regla de validación de FK de `CONVENTIONS.md` §11 gobierna las **escrituras** —una FK que apunta a una fila inactiva es 404 en un `001` o un `004`—, no los filtros de lectura. Un filtro no referencia: acota.

### 3.6 Tipos

Un único tipo cambia, `src/types/esaviCase/esaviCase.types.ts:16`. Las cuatro claves existentes se conservan con su nombre:

```ts
export interface EsaviCaseListFilters {
    patientId?: string;
    healthFacilityId?: string;
    geoLocationId?: string;
    reportDate?: string;
    reportDateFrom?: string;
    reportDateTo?: string;
    eventDate?: string;
    eventDateFrom?: string;
    eventDateTo?: string;
    reportFillingDate?: string;
    reportFillingDateFrom?: string;
    reportFillingDateTo?: string;
}
```

Todas `string | undefined`: llegan de `req.query` y se normalizan en el servicio, no en el tipo. No se declara ningún tipo nuevo — ni un `DateRangeFilter`, ni un `GeoSubtreeRow`, salvo la interfaz mínima que el `sequelize.query<…>` del CTE necesita para tipar su fila (`{ geoLocationId: string }`), declarada local al servicio como ya hace el `008` con `CoverageRow`.

### 3.7 Validador

`esaviCaseListValidator` (`src/validators/esaviCase.validator.ts:31-44`) crece. Las seis reglas existentes no se tocan.

| Campo | Regla | Mensaje |
|---|---|---|
| `query('geoLocationId')` | `.optional().isUUID().trim()` | `Geo Location ID must be a valid UUID` |
| `query('reportDate')`, `query('eventDate')`, `query('reportFillingDate')` | `.optional().isISO8601()` | `<Campo> must be a valid ISO 8601 date` |
| `query('eventDateFrom')`, `query('eventDateTo')`, `query('reportFillingDateFrom')`, `query('reportFillingDateTo')` | `.optional().isISO8601()` | idem |
| las tres exactas | `.custom()` — rechaza si viaja también el `From` o el `To` de **su misma** columna | `<Campo> cannot be combined with <Campo>From or <Campo>To` |
| los tres `To` | `.custom()` — rechaza si su `From` viaja y es posterior | `<Campo>From cannot be later than <Campo>To` |

Las dos comprobaciones cruzadas se escriben una sola vez como dos funciones de fábrica —una que recibe el nombre de la columna y devuelve el `.custom()` correspondiente— y se aplican a las tres columnas. Escribirlas seis veces a mano es donde se cuela la que compara la columna equivocada.

**Toda la validación de este spec vive en el validador, y aquí eso sí basta.** Es la diferencia con el SPEC F45, que necesitó una segunda guarda en el servicio porque la condición era sobre el resultado de una tokenización que el validador no puede ver. Aquí las dos condiciones son sobre la **forma de la query** —qué parámetros viajan juntos, y cómo se ordenan dos cadenas `YYYY-MM-DD`—, y el validador las ve enteras. Duplicarlas en el servicio sería la redundancia que no aporta nada.

**Los filtros no heredan `isNotFutureDate`.** Los validadores de body la aplican a las tres columnas (`esaviCase.validator.ts:56-70`) porque registrar un evento que aún no ha ocurrido es un error de captura. Filtrar hasta una fecha futura no lo es: es un rango abierto por arriba, escrito con un tope generoso, y es una consulta legítima que devuelve lo que haya. Rechazarla convertiría en 400 la forma más natural de decir «de marzo en adelante».

**El orden de comparación es lexicográfico sobre `YYYY-MM-DD`**, con el mismo `toIsoDay` que el archivo ya define (`:16`). No se construye ningún `Date`: hacerlo arrastraría la zona horaria del servidor a una comparación entre dos fechas de calendario, que es exactamente lo que el comentario de cabecera del validador (`:1-4`) declara que no se hace en este archivo.

### 3.8 Este spec no declara contrato de update diferencial

**Y la ausencia es deliberada, no un olvido.** El `002A` y el `002B` son operaciones de solo lectura: no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`. La tabla de `candidates` y el bloque de cinco criterios que `CONVENTIONS.md` §11 exige para toda escritura sobre una fila existente no aplican aquí, por la misma razón por la que no aplicaron al SPEC F45.

Lo que sí se verifica, y está en §6, es que ninguna ruta nueva de este spec termine en una escritura — incluido el `sequelize.query` del CTE, que es un `SELECT` y va sin transacción.

### 3.9 Forma de la respuesta

```
{ ok, message, data: {
    count,
    rows: [ {
        caseId, caseCode, reportDate, eventDate, isActive,
        patient: { patientId, names, lastNames, healthSystemCode },
        healthFacility: {
            healthFacilityId, localCode, name,
            geoLocation: { geoLocationId, name } | null
        }
    } ]
} }
```

**El único cambio es `healthFacility.geoLocation`**, anidado y aditivo. Se consigue componiendo el `HEALTH_FACILITY_INCLUDE` existente con un `include` propio sobre la asociación `geoLocation` que ya está declarada (`healthFacility.associations.ts:12`), con `attributes: ['geoLocationId', 'name']` y **sin** `required`, para que una unidad de salud sin geolocalizar siga apareciendo con `geoLocation: null` en vez de desaparecer de la página.

**Aparece siempre, no solo cuando se filtra por geografía.** Un `include` condicionado por la presencia de un query param daría dos formas distintas de `data.rows` para el mismo endpoint, y el cliente tendría que descubrir cuál le tocó. El coste es un join más en cada listado, resuelto por la PK de `geoLocation`.

**Es un cambio aditivo sobre dos endpoints en producción**, y §9 lo declara como tal: ningún campo existente cambia de nombre, de tipo ni de posición, así que un cliente que ignore la clave nueva no se entera. No se devuelve la ruta completa hasta la raíz —ni el `level`, ni el `parent`—: sería una respuesta N veces más grande por fila para una jerarquía que el cliente ya conoce por el `002` de `geoLocation`.

**`count` sigue siendo el total de casos que casan con los filtros**, no el número de filas de la página. Cuando viaja `geoLocationId` lo calcula sobre el join (§3.4), y sigue siendo el mismo número que el cliente necesita para paginar.

---

## 4. Por qué el recorrido recursivo se duplica en vez de extraerse

El repositorio ya tiene un `WITH RECURSIVE` sobre `geoLocation` (`appUserGeoLocation.service.ts:536-568`), y este spec escribe un segundo muy parecido. La duplicación es deliberada y conviene dejar dicho por qué, porque el instinto correcto ante dos consultas casi iguales es extraer la común.

**No son la misma consulta.** El `008` parte de un **conjunto** de raíces —todas las asignaciones vigentes de un usuario, con su filtro de `validTo`— y devuelve `geoLocationId`, `name`, `level`, `parentGeoLocationId` y un `isAssigned` agregado con `bool_or`, porque su respuesta distingue lo asignado de lo heredado. Este spec parte de **una** raíz, no sabe nada de asignaciones ni de vigencias, y necesita una única columna. Un helper que sirviera a los dos recibiría un array de raíces, un filtro opcional de vigencia y una bandera de forma de salida: tres parámetros para dos llamadas, y la parte realmente común —cuatro líneas de `UNION` con un tope de profundidad— quedaría enterrada bajo la firma.

**Extraerlo obliga a re-verificar el `008`, que hoy funciona.** `ESAVI-USERGEO-008` es el endpoint que decide qué territorio ve un usuario. Cambiarle el motor para ahorrar cuatro líneas en otro archivo pone en riesgo una respuesta de cobertura a cambio de nada que el usuario final note. Si el helper se equivoca, el síntoma no es un error: es un usuario que ve de más o de menos.

**Las tres salidas evaluadas:**

1. **Extraer a `common/geoSubtree.service.ts` y migrar el `008`.** La correcta si hubiera un tercer consumidor, o si las dos consultas coincidieran en la forma de salida. Hoy no ocurre ninguna de las dos cosas.
2. **CTE propio en `esaviCase.service.ts`, `008` intacto.** Lo que este spec adopta. Riesgo de regresión cero, coste una duplicación acotada y visible.
3. **Extraer sin tocar el `008`, anotando la migración como deuda.** Deja el helper con un solo consumidor y una deuda abierta que nadie cerrará: lo peor de las dos.

**Lo que sí es obligación de este spec** es que las dos guardas contra ciclos sean idénticas en los dos sitios —`UNION` en vez de `UNION ALL`, y tope explícito de profundidad—, y que la constante nueva lleve el mismo valor `50` con un comentario que la enlace con `MAX_COVERAGE_DEPTH`. La duplicación admisible es la de la consulta; la de un criterio de seguridad que después diverge, no.

**Cuándo se revisa esta decisión.** Cuando aparezca un tercer consumidor del subárbol de `geoLocation`. Entonces la extracción tiene tres llamadores que justifican la firma general, y el `008` se migra dentro de ese spec, con sus propias verificaciones.

---

## 5. Plan de implementación

Ocho pasos. Cada uno deja el proyecto compilando y arrancable, y cada uno es committeable por separado. No hay paso de modelo ni de asociaciones: las dos que hacen falta ya existen.

1. **Índices.** Las dos líneas de §3.2 en `esaviapp.sql`, después del `IX_esaviCase_reportDate` (`:707`). En la base de desarrollo se ejecutan a mano.
   *Verificación:* `\d "esaviCase"` en `psql` lista los tres índices de fecha; volver a ejecutar el bloque no falla, por el `IF NOT EXISTS`.

2. **`EsaviCaseListFilters`.** De cuatro claves a trece, con la forma exacta de §3.6, en `src/types/esaviCase/esaviCase.types.ts`. El barrel de `types/esaviCase/` ya lo exporta y no cambia.
   *Verificación:* `npm run build` en 0. Ningún archivo más se toca en este paso.

3. **`listFilters` — controlador.** En `src/controllers/esaviCase.controller.ts`, las nueve claves nuevas leídas de `req.query` con el mismo casteo que las cuatro existentes. `getEsaviCases` y `getAllEsaviCases` no cambian ni una línea: siguen llamando a `listFilters(req)`.
   *Verificación:* `npm run build` y `npm run lint` en 0. Los filtros nuevos viajan al servicio, que todavía los ignora — el comportamiento observable no cambia y `tests/contract/esaviCase.test.ts` sigue en verde.

4. **`esaviCaseListValidator`.** Las reglas de §3.7 en `src/validators/esaviCase.validator.ts`, incluidas las dos funciones de fábrica de las comprobaciones cruzadas. Las seis reglas existentes no se tocan.
   *Verificación:* `?reportDate=2026-03-01&reportDateFrom=2026-03-01` responde 400; `?eventDateFrom=2026-05-01&eventDateTo=2026-04-01` responde 400; `?reportDate=2030-01-01` responde **200**, no 400; `?geoLocationId=abc` responde 400.

5. **Las tres columnas de fecha en `buildListWhere`.** Se reescribe el bloque de `esaviCase.service.ts:264-272` como una función que recibe el nombre de la columna y los tres valores, y se invoca tres veces. La exacta gana sobre el rango dentro de su columna; con la validación de §3.7 esa precedencia no llega a ejercerse nunca, y está ahí para que el servicio siga siendo correcto si se le llama sin la cadena de middlewares.
   *Verificación:* un caso con `eventDate` de febrero no aparece filtrando por `eventDateFrom` de marzo, y sí filtrando por `eventDate` exacta; un caso con `eventDate: null` no aparece bajo ningún filtro de `eventDate`; el filtro de `reportDate` sigue comportándose como antes en los dos listados.

6. **El subárbol geográfico.** La constante `MAX_GEO_SUBTREE_DEPTH = 50` con su comentario, la interfaz local de la fila, el `WITH RECURSIVE` de §3.4 con `sequelize.query` y `QueryTypes.SELECT`, y el `include` de facility compuesto con `where` y `required: true` **solo** cuando `geoLocationId` viaja. Como `buildListWhere` devuelve un `where` y esto es un `include`, la resolución del subárbol vive en los dos servicios de listado, no dentro de `buildListWhere`.
   *Verificación:* filtrando por una `geoLocation` de nivel provincia aparecen los casos de las unidades de salud colgadas de sus cantones, no solo los de la provincia literal; desactivar un cantón intermedio hace desaparecer los casos de sus parroquias; un `geoLocationId` inexistente devuelve 200 con `count: 0`, nunca 404; un caso en una unidad de salud sin `geoLocationId` no aparece bajo el filtro y sí aparece sin él.

7. **`geoLocation` en la fila del listado.** El `include` anidado de §3.9 sobre `HEALTH_FACILITY_INCLUDE`, sin `required`, con `attributes: ['geoLocationId', 'name']`. Afecta a `002A` y `002B` por igual.
   *Verificación:* cada fila de los dos listados trae `healthFacility.geoLocation` con sus dos campos, o `null` si la unidad no está geolocalizada; ninguna fila desaparece por este cambio — el `count` de un listado sin filtros es el mismo antes y después.

8. **Casos de contrato.** En `tests/contract/esaviCase.test.ts`, cubriendo los criterios de §6. Necesitan sembrar una jerarquía de al menos tres niveles de `geoLocation` con unidades de salud en el nivel más fino, y un caso con `eventDate: null`.
   *Verificación:* `npm run check` en 0.

**`tests/auth/roles.test.ts` no se toca en ningún paso.** No hay rutas nuevas, así que `ROUTE_RULES` no cambia — y que no cambie es en sí una comprobación de que este spec se mantuvo dentro de su alcance.

**Los tres primeros pasos son reversibles sin efecto visible.** A partir del 4, cada paso cambia comportamiento observable y tiene su verificación propia por HTTP.

---

## 6. Criterios de aceptación

**Filtros de fecha — forma exacta:**

- [ ] `?reportDate=2026-03-01` devuelve exactamente los casos con esa fecha de reporte, y ninguno del 28 de febrero ni del 2 de marzo.
- [ ] `?eventDate=2026-03-01` y `?reportFillingDate=2026-03-01` se comportan igual sobre sus columnas.
- [ ] `?reportDate=2026-03-01T18:30:00Z` devuelve lo mismo que `?reportDate=2026-03-01`: el timestamp se recorta a `YYYY-MM-DD` y la zona horaria del servidor no desplaza el día.

**Filtros de fecha — rangos:**

- [ ] `?eventDateFrom=2026-03-01&eventDateTo=2026-03-31` incluye los casos del día 1 y del día 31: el rango es inclusivo en los dos extremos.
- [ ] `?eventDateFrom=2026-03-01` sin `To` devuelve todo lo posterior o igual; `?eventDateTo=2026-03-31` sin `From`, todo lo anterior o igual.
- [ ] `?reportDateFrom` y `?reportDateTo` siguen comportándose exactamente como antes de este spec, solos y combinados.

**Nulos y acumulación:**

- [ ] Un caso con `eventDate: null` **no** aparece bajo ningún filtro de `eventDate` —exacta, `From` ni `To`— y sí aparece en el listado sin ese filtro.
- [ ] `?reportDate=2026-03-01&eventDateFrom=2026-02-01` devuelve solo los casos que cumplen **las dos** condiciones: la acumulación entre columnas es AND.
- [ ] Los trece filtros combinados en una sola query devuelven un resultado coherente y no producen error.

**Combinaciones rechazadas — 400 del validador:**

- [ ] `?reportDate=…&reportDateFrom=…` responde 400. Igual con `reportDateTo`, y en las otras dos columnas.
- [ ] `?eventDateFrom=2026-05-01&eventDateTo=2026-04-01` responde 400: `From` posterior a `To`.
- [ ] `?reportDate=…&eventDateFrom=…` responde **200**: la exclusión es por columna, no global.
- [ ] `?reportDate=2030-01-01` responde **200** con `count: 0`, no 400: los filtros no heredan `isNotFutureDate`.
- [ ] `?reportDate=no-es-fecha` y `?geoLocationId=abc` responden 400.
- [ ] Los cinco 400 anteriores salen del `errorHandler` con el envoltorio `{ ok, message, code, errors }` y `message` resuelto desde `common.validationError`.

**Filtro geográfico:**

- [ ] Con una jerarquía provincia → cantón → parroquia y las unidades de salud colgadas de la parroquia, `?geoLocationId=<provincia>` devuelve los casos de esas unidades. Es el criterio que justifica el spec: con igualdad estricta devolvería `count: 0`.
- [ ] `?geoLocationId=<parroquia>` devuelve solo los suyos, y son un subconjunto del resultado de la provincia.
- [ ] Desactivar el cantón intermedio hace desaparecer los casos de sus parroquias del resultado de la provincia, aunque las parroquias sigan activas.
- [ ] Un `geoLocationId` que no existe responde 200 con `count: 0`, **nunca 404**. Igual si la unidad existe pero está inactiva.
- [ ] Un caso abierto en una unidad de salud con `geoLocationId: null` no aparece bajo ningún filtro geográfico, y sí aparece sin él.
- [ ] Un caso activo abierto en una unidad de salud **desactivada** sí aparece bajo el filtro geográfico de su territorio: el join no filtra por `healthFacility.isActive`.
- [ ] Un árbol con un ciclo sembrado a mano —A padre de B, B padre de A— devuelve respuesta y no cuelga la petición.
- [ ] `?geoLocationId=…&limit=2` devuelve dos filas con un `count` igual al total del subárbol, no a 2.

**Forma de la respuesta:**

- [ ] Cada fila de `002A` y `002B` trae `healthFacility.geoLocation` con `geoLocationId` y `name`, o `null` si la unidad no está geolocalizada.
- [ ] Ninguna fila desaparece por el `include` nuevo: el `count` de un listado sin filtros es idéntico antes y después del paso 7.
- [ ] `healthFacility.geoLocation` aparece **también** cuando no se filtra por geografía.
- [ ] Ningún campo existente de `data.rows` cambia de nombre, de tipo ni de posición.

**Los dos roles:**

- [ ] Los trece filtros funcionan igual en `002A` y en `002B`.
- [ ] `002A` sigue devolviendo solo casos activos y `002B` sigue incluyendo los inactivos, con cualquier combinación de filtros.
- [ ] `GET /api/esavi-cases/admin` sigue respondiendo 403 con rol `USER` y 401 sin token.

**Este spec no escribe:**

- [ ] Tras cien listados con todos los filtros, el `appDetails` de los casos devueltos no crece, su `updatedAt` no se mueve y `sysDetails.version` no avanza.
- [ ] En `esaviCase.service.ts`, el código añadido por este spec no contiene ningún `.update(`, `.create(`, `.destroy(` ni `transaction`. El `sequelize.query` del CTE es un `SELECT` y va sin transacción.

**Convenciones:**

- [ ] `src/routes/esaviCase.routes.ts` no cambia, y `ROUTE_RULES` en `tests/auth/roles.test.ts` tampoco.
- [ ] No se añade ninguna clave i18n: `git diff` sobre `src/data/i18n/` está vacío y `npm run i18n:check` sale en 0.
- [ ] Los códigos de operación siguen coincidiendo en los cinco lugares: `grep -rn "ESAVI-CASE-002" src/` devuelve las mismas apariciones que antes del spec, con `CASE_002A_FETCH_FAILED` y `CASE_002B_FETCH_FAILED` intactos. Este spec **no acuña ningún código nuevo**.
- [ ] El controlador no importa ningún modelo ni construye ningún `where`.
- [ ] `MAX_GEO_SUBTREE_DEPTH` vale 50, igual que `MAX_COVERAGE_DEPTH`, y su comentario lo enlaza explícitamente.
- [ ] `npm run check` sale en 0.

---

## 7. Decisiones tomadas y descartadas

- **Sí:** ampliar `002A` y `002B` en vez de abrir un `ESAVI-CASE-006`. Los filtros ya viven en `buildListWhere` y comparten paginación, `include`, `LIST_ATTRIBUTES` y `LIST_ORDER`. Un endpoint de búsqueda propio los duplicaría enteros para cambiar solo el `where`, y dejaría dos listados de casos que hay que mantener sincronizados. El coste asumido es que este spec toca código en producción en lugar de solo añadir.
- **Sí:** las tres columnas de fecha, incluida `reportFillingDate`. `eventDate` es la que justifica el spec —la vigilancia busca por fecha del evento, no del reporte—, y `reportFillingDate` entra por simetría: tenerla en la tabla, devolverla en el `003` y no poder filtrarla sería la misma carencia que este spec corrige, dejada a medias.
- **Sí:** crear `IX_esaviCase_eventDate` e `IX_esaviCase_reportFillingDate`. Admitir un filtro sobre una columna sin índice en la tabla que más crece del esquema es diferir el problema al primer mes de datos reales.
- **Sí:** un parámetro exacto propio por columna, mutuamente excluyente con su rango. Mandar `From` y `To` con el mismo valor funciona, pero es una convención no escrita para la consulta más frecuente que hace un operador. El precio es tres parámetros más y una comprobación cruzada.
- **Sí:** exclusión mutua **por columna** y no global. `?reportDate=…&eventDateFrom=…` es una pregunta legítima y frecuente; prohibirla por uniformidad no protegería de nada.
- **Sí:** rechazar la combinación inválida con 400 en vez de dar prioridad a una de las dos formas. Un `?reportDate=…&reportDateFrom=…` no tiene lectura obvia, y elegir en silencio significa devolver un resultado que el cliente no pidió sin decírselo.
- **Sí:** toda la validación en el validador, sin segunda guarda en el servicio. A diferencia del F45, aquí la condición es sobre la forma de la query y el validador la ve entera. Duplicarla sería redundancia sin cobertura adicional.
- **Sí:** filtro geográfico jerárquico, con subárbol recursivo. Es la única forma en que el filtro sirve: `healthFacility.geoLocationId` apunta a la unidad más fina, así que la igualdad estricta contra una provincia devuelve cero filas en una base bien poblada y el usuario concluye que no hay casos.
- **Sí:** un solo `geoLocationId`. Cubre el caso pedido; admitir una lista obliga a decidir la semántica de subárboles solapados y multiplica el recorrido.
- **Sí:** CTE propio en `esaviCase.service.ts`, dejando `ESAVI-USERGEO-008` intacto. Las dos consultas no son la misma —conjunto de raíces con vigencias frente a raíz única, y formas de salida distintas— y extraer el helper pondría en riesgo el endpoint que decide qué territorio ve cada usuario. Ver §4.
- **Sí:** excluir del subárbol las `geoLocation` inactivas, aun sabiendo que desactivar una unidad intermedia corta la rama. Es la regla que ya aplica el `008`, y tener dos criterios distintos de qué cuenta como territorio vigente en el mismo repositorio es peor que la consecuencia.
- **Sí:** **no** filtrar por `healthFacility.isActive` en el join. Un caso activo abierto en un establecimiento dado de baja después sigue siendo un caso que debe verse en la vigilancia de su territorio. La visibilidad la decide `isActive` del caso, como en todo el listado.
- **Sí:** `geoLocationId` inexistente devuelve página vacía, no 404. Es la norma que el propio `buildListWhere` ya declara para `patientId` y `healthFacilityId` (`esaviCase.service.ts:255-257`). Se evaluó la excepción —un UUID mal tecleado es indistinguible de «no hay casos aquí»— y se descartó: tener dos filtros que dan página vacía y un tercero que da 404 obliga al cliente a un caso especial por parámetro, y quien filtra por territorio eligió la unidad de un selector que ya sabe que existe.
- **Sí:** devolver `healthFacility.geoLocation` en todas las filas, también sin filtro geográfico. Condicionar el `include` al query param daría dos formas distintas de `data.rows` para el mismo endpoint.
- **No:** un `includeDescendants=true|false`. Sería un segundo comportamiento bajo el mismo parámetro, y el modo de igualdad estricta —el que quedaría en `false`— es justamente el que §1 declara inútil. Quien necesite una unidad de salud concreta ya tiene `healthFacilityId`.
- **No:** validar que la `geoLocation` exista y esté activa antes de expandirla. La regla de validación de FK de `CONVENTIONS.md` §11 gobierna las escrituras, no los filtros: un filtro no referencia, acota.
- **No:** aplicar `isNotFutureDate` a los filtros. Convertiría en 400 la forma natural de escribir un rango abierto por arriba.
- **No:** cambiar `LIST_ORDER` para ordenar por `eventDate` cuando se filtra por ella. Un orden que depende de los filtros hace que la paginación cambie de significado entre dos consultas y rompe a los clientes existentes.
- **No:** filtrar por la geografía de residencia del paciente en este spec. Es otra pregunta —dónde vive la persona, no dónde se reportó el caso— con otro `include` y otra semántica.
- **No:** devolver la ruta geográfica completa hasta la raíz en cada fila. Multiplicaría el tamaño de la respuesta por una jerarquía que el cliente ya conoce por el `002` de `geoLocation`.
- **No:** agregados, conteos por territorio o series temporales. Este spec devuelve filas paginadas; un informe es otro endpoint y otro spec.

---

## 8. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Un ciclo en el árbol de `geoLocation` cuelga la petición.** `CK_geoLocation_notSelfParent` solo impide que una fila sea su propio padre; A→B→A no lo detecta ninguna restricción del DDL | Las dos guardas del `008`, replicadas: `UNION` en vez de `UNION ALL` y `MAX_GEO_SUBTREE_DEPTH = 50`. Son independientes y las dos se mantienen. Criterio de aceptación propio en §6, con el ciclo sembrado a mano |
| **`required: true` cambia el plan de consulta del `count`** solo cuando viaja `geoLocationId`, así que el listado tiene dos comportamientos de conteo según los filtros | Declarado en §3.4. El resultado es el correcto en los dos casos —el `count` del join es el total del subárbol— y §6 lo verifica con `limit=2` frente al total |
| **Desactivar una `geoLocation` intermedia corta la rama** y los casos de sus descendientes desaparecen del territorio sin ningún aviso. Un usuario puede leerlo como pérdida de datos | Decisión deliberada de §7, heredada del `008`, con criterio de aceptación propio. La mitigación real es operativa: desactivar una unidad territorial con descendientes activos es lo que no debería hacerse, y eso es una regla del CRUD de `geoLocation`, no de este spec |
| **Los casos en unidades de salud sin `geoLocationId` son invisibles al filtro territorial**, y nada en la respuesta lo señala | Declarado en §3.4 y confirmado como comportamiento aceptado. Se evaluó añadir un contador de casos excluidos por esa razón y se dejó fuera: exige una segunda consulta en cada petición para un dato de calidad del padrón, que se resuelve mejor geolocalizando las unidades que reportando el hueco en cada listado |
| **Un caso sin `eventDate` desaparece al filtrar por esa columna**, y el operador puede concluir que no existe | Es la semántica de SQL sobre `NULL` y §3.1 la declara. Criterio de aceptación propio. Mitigación del frontend: el formulario debe indicar que filtrar por fecha de evento excluye los casos sin esa fecha registrada |
| **Trece filtros opcionales son 8.192 combinaciones**, y los tests cubren una fracción | Los filtros son independientes y se acumulan con AND, así que el riesgo real está en las combinaciones cruzadas de una misma columna —que el validador cierra— y en el filtro geográfico —que tiene ocho criterios propios—. §6 cubre las clases, no el producto cartesiano |
| **El `include` nuevo de `geoLocation` añade un join a todos los listados de casos**, incluidos los que no filtran por territorio | Es un join por la PK de `geoLocation`, sin `required`. El coste es real pero acotado, y se acepta a cambio de que `data.rows` tenga una sola forma. §6 verifica que ninguna fila desaparezca por él |
| **La duplicación del CTE puede divergir** del `008`: alguien corrige un ciclo en un sitio y no en el otro | §4 fija la obligación de que las dos guardas sean idénticas, y §6 verifica el valor y el comentario que enlaza las dos constantes. Es la mitigación posible: la alternativa —extraer el helper— tiene su propio riesgo, mayor, y se descartó |
| **Los dos índices no se crean en la base ya desplegada**, porque el repositorio no tiene migraciones y el paso 1 solo edita el `.sql` | Las dos sentencias son idempotentes y están en §3.2 listas para ejecutar. El síntoma de olvidarlas es lentitud creciente, no un error, así que queda anotado como lo que hay que verificar en el despliegue — es el punto más frágil de este spec |

---

## 9. Impacto en el contrato HTTP

**Compatible hacia atrás, con un cambio aditivo declarado.**

Lo que **no** cambia: ninguna ruta, ningún código de operación, ningún rol, ningún status, ningún mensaje, ninguna clave i18n. `src/routes/esaviCase.routes.ts` no se toca y `ROUTE_RULES` tampoco. Un cliente que hoy llama a `GET /api/esavi-cases?reportDateFrom=…&reportDateTo=…` recibe exactamente lo mismo después de este spec.

Lo que **sí** cambia, en los dos listados:

1. **Nueve query params nuevos**, todos opcionales. Un cliente que no los manda no nota nada.
2. **`data.rows[].healthFacility.geoLocation`**, objeto nuevo anidado, o `null`. Aditivo: ningún campo existente cambia de nombre, de tipo ni de posición, y un cliente que ignore la clave sigue funcionando.
3. **Tres combinaciones de query que antes eran 200 y ahora son 400**: exacta junto a su `From` o su `To`, y `From` posterior a `To`. Formalmente es un endurecimiento del contrato, pero ninguna de las tres podía existir antes —los tres parámetros exactos son nuevos— salvo `reportDateFrom` > `reportDateTo`, que hasta hoy devolvía 200 con `count: 0`. Ese es el único caso en que un cliente existente puede ver un status distinto, y devolvía una lista vacía para una consulta que no tiene sentido.

**El esquema cambia**, aunque el contrato HTTP no lo refleje: dos índices nuevos en `esaviCase`. Sin efecto sobre las respuestas y con efecto sobre el tiempo de respuesta.

---

## Lo que **no** está en este spec

- Un endpoint de búsqueda propio para casos: los filtros viven en los listados existentes.
- Varias unidades geográficas en una misma consulta.
- Un modo de filtro geográfico no jerárquico (`includeDescendants=false`).
- Extraer el recorrido recursivo a un servicio común, ni migrar `ESAVI-USERGEO-008`.
- Filtrar por la geografía de residencia del paciente.
- Filtrar por estado del flujo (`caseWorkflow`), clasificación o gravedad.
- Ordenación por fecha de evento, por territorio o por relevancia.
- Agregados, conteos por unidad geográfica o series temporales.
- Exportación del resultado filtrado.
- Señalar en la respuesta cuántos casos quedaron fuera por unidad de salud sin geolocalizar.
- Cualquier escritura, en cualquier tabla.

Cada uno de esos, si aterriza, va en su propio spec.
