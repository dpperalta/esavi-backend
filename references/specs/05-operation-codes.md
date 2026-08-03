# SPEC 05 — Códigos de operación trazables

> **Estado:** Aprobado
> **Depende de:** SPEC 01, SPEC 02, SPEC 04 (tocan las mismas líneas)
> **Fecha:** 2026-08-01
> **Objetivo:** Que un código `ESAVI-*` signifique la misma operación en las cinco ubicaciones donde aparece.

Cubre las entradas **DEUDA-008 y DEUDA-016** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Quinto spec de la serie de seis que salda la deuda técnica catalogada a 2026-07-31.

---

## 1. Por qué existe este spec

El código de operación existe para rastrear una petición desde la ruta hasta el log. Hoy no sirve para eso en tres de las cinco entidades: `003` es getById en la ruta de `catalogType` y update en su servicio, `catalogItem` usa un esquema de numeración anterior al canon, y los códigos de `healthFacility` están escritos `ESAIV`, así que una búsqueda por `ESAVI-HF` no los encuentra.

Este spec no cambia comportamiento. Cambia identificadores y comentarios.

---

## 2. Alcance

**Dentro:**

- Renumerar el servicio de `catalogType` para que coincida con su ruta.
- Migrar `catalogItem` completo al esquema canónico (`002C→003`, `003→004`, `004A/B→005A/B`).
- Corregir `healthFacility`: `ESAIV`→`ESAVI`, `HF`→`HFAC`, y `002A`→`002`.
- Sufijo `A`/`B` en la activación, también en el código del `AppError`.
- Normalizar las acciones no estándar de los `AppError` (`GEOTYPE_003_LEVEL_NOT_FOUND` → `GEOTYPE_003_NOT_FOUND`).
- Documentar en `CONVENTIONS.md` sección 6 la regla del listado dual: un solo `GET /` se numera `002` en la ruta, y sus dos servicios `002A` / `002B`.

**Fuera de alcance (specs siguientes):**

- Partir `GET /` en dos rutas `002A` / `002B` como hace `catalogItem`. Se descarta, ver Decisiones.
- Las tres funciones muertas de `healthFacility.service.ts:105-150`, que llevan códigos `CATITEM-*` copiados. **No se renumeran**: SPEC 06 las elimina enteras.
- Cambiar el nombre de los archivos o de las funciones — SPEC 06.
- Las entradas de `src/logs/esaviLog.log` ya escritas con los códigos antiguos. El archivo está gitignorado y es histórico.

---

## 3. Modelo de datos

No hay datos nuevos. Cambia el valor de un identificador en cinco sitios por operación, uno de los cuales —`appDetails.method`— **se persiste en la BD**.

### Estado real por entidad

| Entidad | Ruta | Controlador | Servicio | Veredicto |
|---|---|---|---|---|
| `geoLevelType` | canónico | canónico | canónico salvo sufijo A/B en activación | casi limpio |
| `geoLocation` | canónico | canónico | canónico salvo sufijo A/B en activación | casi limpio |
| `catalogType` | canónico | canónico | **desalineado** | renumerar servicio |
| `catalogItem` | esquema antiguo | esquema antiguo | esquema antiguo | migrar las tres capas |
| `healthFacility` | `ESAVI-HF-002A` | `ESAVI-HF-002` | `ESAIV-HF-*` | corregir las tres |

### `catalogType` — solo el servicio

| Función | Hoy | Canon |
|---|---|---|
| `getCatalogTypeByIdService` | `002C` | **`003`** |
| `updateCatalogTypeService` | `003` | **`004`** |
| `setCatalogTypeActivationService` | `004` | **`005A` / `005B`** |
| `CATTYPE_003_NOT_FOUND` (update) | | **`CATTYPE_004_NOT_FOUND`** |
| `CATTYPE_003_CODE_EXISTS` | | **`CATTYPE_004_CODE_EXISTS`** |
| `CATTYPE_004_NOT_FOUND` (activación) | | **`CATTYPE_005A/B_NOT_FOUND`** |

### `catalogItem` — las tres capas

| Operación | Hoy | Canon |
|---|---|---|
| getById | `002C` | **`003`** |
| update | `003` | **`004`** |
| soft delete | `004A` | **`005A`** |
| activate | `004B` | **`005B`** |
| `CATITEM_001_NOT_FOUND` (en getById) | | **`CATITEM_003_NOT_FOUND`** |
| `CATITEM_003_NOT_FOUND` (en update) | | **`CATITEM_004_NOT_FOUND`** |
| `CATITEM_003_CODE_EXISTS` | | **`CATITEM_004_CODE_EXISTS`** |
| `CATITEM_004_NOT_FOUND` (activación) | | **`CATITEM_005A/B_NOT_FOUND`** |

`create` (`001`) y los listados (`002A` / `002B`) no cambian.

### `healthFacility` — prefijo, abreviatura y número

| Ubicación | Hoy | Canon |
|---|---|---|
| ruta, create | `ESAVI-HF-001` | **`ESAVI-HFAC-001`** |
| ruta, list | `ESAVI-HF-002A` | **`ESAVI-HFAC-002`** |
| controlador | `ESAVI-HF-001` / `ESAVI-HF-002` | **`ESAVI-HFAC-001` / `-002`** |
| servicio | `ESAIV-HF-001` / `ESAIV-HF-002` | **`ESAVI-HFAC-001` / `-002`** |
| `appDetails.method` | `'ESAIV-HF-001'` | **`'ESAVI-HFAC-001'`** |
| `AppError` | `HF_001_*`, `HF_002_*` | **`HFAC_001_*`, `HFAC_002_*`** |

### Activación con sufijo

```ts
// antes
notFoundCode: 'CATTYPE_004_NOT_FOUND',
method: 'ESAVI-CATTYPE-004' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' )

// después
const op = isActive ? '005B' : '005A';
notFoundCode: `CATTYPE_${ op }_NOT_FOUND`,
method: `ESAVI-CATTYPE-${ op }`
```

Aplica a las cuatro entidades que usan el servicio genérico.

### Acciones de `AppError` no estándar

| Hoy | Canon |
|---|---|
| `GEOTYPE_003_LEVEL_NOT_FOUND` | `GEOTYPE_003_NOT_FOUND` |
| `GEOTYPE_004_LEVEL_NOT_FOUND` | `GEOTYPE_004_NOT_FOUND` |
| `GEOTYPE_005_LEVEL_NOT_FOUND` | `GEOTYPE_005A/B_NOT_FOUND` |
| `GEOLOC_003_LOCATION_NOT_FOUND` | `GEOLOC_003_NOT_FOUND` |
| `GEOLOC_004_LOCATION_NOT_FOUND` | `GEOLOC_004_NOT_FOUND` |
| `GEOLOC_005_LOCATION_NOT_FOUND` | `GEOLOC_005A/B_NOT_FOUND` |
| `GEOTYPE_001_ALREADY_EXISTS` | `GEOTYPE_001_CODE_EXISTS` |
| `GEOTYPE_004_ALREADY_EXISTS` | `GEOTYPE_004_CODE_EXISTS` |

`GEOLOC_001_GEOLEVELTYPE_NOT_FOUND` y `HFAC_001_PARENT_HEALTH_FACILITY_NOT_FOUND` **no** cambian: son la forma `<FK>_NOT_FOUND`, que el canon admite.

---

## 4. Plan de implementación

Cada paso es una entidad completa. El orden va de menos a más invasivo, y ninguna entidad se deja a medias entre capas.

1. **Sufijo A/B en la activación.** En los cuatro servicios que llaman a `setEntityActiveStatusService`, calcular `op` y usarlo en `notFoundCode`, en `appDetails.method` y en el comentario de la función.
   *Verificación:* desactivar un catalogType deja `appDetails.method` con `'ESAVI-CATTYPE-005A'`.

2. **Acciones estándar en `AppError`.** Aplicar la tabla de acciones no estándar en `geoLevelType.service.ts` y `geoLocation.service.ts`.
   *Verificación:* `grep -rn "_LEVEL_NOT_FOUND\|_LOCATION_NOT_FOUND\|_ALREADY_EXISTS" src/` no devuelve resultados.

3. **`catalogType`.** Renumerar las tres funciones del servicio y sus códigos de error según la tabla. La ruta y el controlador no se tocan.
   *Verificación:* los tres comentarios del servicio coinciden con los de la ruta para la misma operación.

4. **`catalogItem`.** Aplicar la migración al esquema canónico en la ruta, el controlador y el servicio a la vez, incluidos los mensajes de `esaviLog` y los `appDetails.method`.
   *Verificación:* `grep -rn "CATITEM-002C\|CATITEM-004A\|CATITEM-004B" src/` no devuelve resultados.

5. **`healthFacility`.** Sustituir `ESAIV`→`ESAVI` y `HF`→`HFAC` en la ruta, el controlador y el servicio, y unificar el listado en `002`. No tocar las tres funciones muertas de las líneas 105-150.
   *Verificación:* `grep -rn "ESAIV\|ESAVI-HF-\|'HF_" src/` solo devuelve coincidencias dentro del bloque muerto que elimina el SPEC 06.

6. **Canon actualizado.** Añadir a `CONVENTIONS.md` sección 6 la regla del listado dual y un ejemplo del sufijo de activación.
   *Verificación:* la sección 6 describe el caso de `GET /` bifurcado.

---

## 5. Criterios de aceptación

- [ ] `grep -rn "ESAIV" src/` no devuelve resultados fuera de `src/logs/`.
- [ ] `grep -rn "ESAVI-HF-" src/` no devuelve resultados fuera de `src/logs/`.
- [ ] `grep -rn "'HF_" src/` no devuelve resultados fuera del bloque muerto.
- [ ] `grep -rn "CATITEM-002C\|CATITEM-004A\|CATITEM-004B" src/` no devuelve resultados fuera de `src/logs/`.
- [ ] `grep -rn "CATTYPE-002C" src/` no devuelve resultados.
- [ ] Para cada una de las cinco entidades, el código de la ruta, el del controlador y el del servicio coinciden para la misma operación.
- [ ] Todo código de `AppError` sigue `<ENTIDAD>_<NNN>_<ACCION>` con una acción de la lista estándar o de la forma `<FK>_NOT_FOUND`.
- [ ] Desactivar cualquier entidad deja `appDetails.method` terminado en `005A`.
- [ ] Activar cualquier entidad deja `appDetails.method` terminado en `005B`.
- [ ] Ningún `appDetails.method` contiene `_ACTIVATION` ni `_DEACTIVATION`.
- [ ] La sección 6 de `CONVENTIONS.md` documenta la regla del listado dual.
- [ ] `npm run build` compila sin errores.
- [ ] Ninguna respuesta HTTP cambia de status ni de forma respecto a antes del spec.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** la ruta numera `002` y los servicios `002A` / `002B` cuando hay un solo `GET /` bifurcado. El código de la ruta describe el endpoint, del que hay uno; los sufijos describen las variantes del servicio, de las que hay dos. Es lo que ya hacen tres entidades y solo faltaba escribirlo.
- **No:** partir `GET /` en `GET /` y `GET /admin` para las tres entidades. Sería más coherente con la matriz de roles, pero cambia URLs que el frontend ya consume y eso es un cambio de API, no una corrección de deuda.
- **Sí:** sufijo `A`/`B` también en el código del `AppError`. El valor de un código de operación es poder buscarlo en el log y saber exactamente qué se intentó; `CATTYPE_005_NOT_FOUND` no distingue un borrado de una activación.
- **Sí:** normalizar `LEVEL_NOT_FOUND` y `LOCATION_NOT_FOUND` a `NOT_FOUND`. La entidad ya está en el prefijo; repetirla en la acción impide agrupar por tipo de fallo.
- **Sí:** conservar `<FK>_NOT_FOUND`. El canon lo admite y distingue "no existe el recurso" de "no existe la referencia que me pasaste", que son dos fallos distintos con el mismo 404.
- **No:** renumerar las tres funciones muertas de `healthFacility.service.ts`. Se borran en el SPEC 06; renumerarlas antes es trabajo que se tira.
- **No:** reescribir los `appDetails.method` ya persistidos con códigos antiguos. Es un registro de auditoría: refleja lo que el sistema hizo cuando lo hizo, y reescribirlo destruye precisamente su valor.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El histórico de `appDetails` queda con dos esquemas de numeración conviviendo | Es intencional y está en Decisiones; la fecha de cada entrada permite interpretarla |
| Una búsqueda operativa por `CATITEM-003` devuelve update tras el cambio y getById antes | Documentado aquí; el corte es la fecha de despliegue de este spec |
| Renumerar en cuatro archivos a la vez invita a dejar una capa sin tocar | La aceptación exige coincidencia entre las cinco ubicaciones, entidad por entidad |
| Colisión con SPEC 01, 02 y 04, que editan las mismas líneas | Declarado como dependencia en la cabecera: este spec va después de los tres |

---

## Lo que **no** está en este spec

- Partir los listados en dos rutas.
- Eliminar el código muerto de `healthFacility.service.ts` (SPEC 06).
- Renombrar archivos, funciones o tipos (SPEC 06).
- Reescribir la auditoría histórica.
- Cualquier cambio de comportamiento observable por el cliente.

Este es el único spec de la serie con cero impacto en el contrato HTTP, por eso no lleva sección de impacto.
