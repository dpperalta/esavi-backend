# SPEC 04 — Contrato de conflicto y consistencia de escritura

> **Estado:** Borrador
> **Depende de:** SPEC 03 (usa claves i18n que ese spec corrige y añade)
> **Fecha:** 2026-08-01
> **Objetivo:** Que un conflicto responda siempre 409 con el mensaje de su propia entidad, y que el update valide lo mismo que el create.

Cubre las entradas **DEUDA-001, DEUDA-011, DEUDA-013, DEUDA-014 y DEUDA-018** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Cuarto spec de la serie de seis que salda la deuda técnica catalogada a 2026-07-31.

---

## 1. Por qué existe este spec

Tres defectos distintos con la misma raíz: la capa de servicio no aplica el mismo criterio en todos los caminos de escritura.

El mismo duplicado devuelve 400 en create y 409 en update. El mismo `code` es válido o no según se entre por create o por update. El servicio genérico de activación responde siempre con el mensaje de `geoLevelType`, sea cual sea la entidad. Para el frontend, el resultado es una API que no se puede tratar de forma uniforme.

---

## 2. Alcance

**Dentro:**

- `setEntityActiveStatusService` usa `options.notFoundMessage`.
- Activar algo ya activo —o desactivar algo ya inactivo— responde 409 con `alreadyActive` / `alreadyInactive`, no 404.
- Los 5 duplicados que hoy devuelven 400 pasan a 409.
- Unicidad con el mismo criterio en create y update: **sin** filtrar por `isActive`, alineado con las UNIQUE del DDL.
- El update valida y aplica las FK presentes en el payload, con el criterio del create.
- `createGeoLocationService` valida el par `(parentGeoLocationId, name)`, que la BD declara único y nadie comprueba.
- Documentar en el spec el estado real de las transacciones y dejar el parámetro `transaction` del servicio genérico conectado donde aplique.

**Fuera de alcance (specs siguientes):**

- Mapear `UniqueConstraintError` de Sequelize a 409 en `errorHandler`. Se descarta, ver Decisiones.
- Índices únicos parciales `WHERE "isActive"` en el DDL. Sería una migración de esquema y este spec no toca `esaviapp.sql`.
- Envolver en transacción operaciones de una sola escritura.
- El update de `healthFacility`, que todavía no existe como endpoint.
- Los códigos `ESAVI-*` de los `AppError` que se tocan — SPEC 05.

---

## 3. Modelo de datos

No cambia ninguna tabla. Cambia el criterio con que se consulta antes de escribir.

### Restricciones únicas reales, según `esaviapp.sql`

| Tabla | Restricción | ¿La valida el servicio hoy? |
|---|---|---|
| `catalogType` | `UNIQUE (code)` | sí |
| `catalogItem` | `UNIQUE (catalogTypeId, code)` | sí |
| `geoLevelType` | `code ... UNIQUE` | sí |
| `healthFacility` | `UNIQUE (localCode)` | sí |
| `geoLocation` | `UNIQUE (parentGeoLocationId, name)` | **no** |
| `geoLocation` | — | valida `externalCode`, que **no** es único en la BD |

Ninguna de esas restricciones filtra por `isActive`. Por eso el criterio canónico de unicidad pasa a ser, en create y en update por igual:

```ts
// sin isActive en el where; en update, excluyendo el propio registro
where: { catalogTypeId, code, catalogItemId: { [Op.ne]: id } }
```

### Status de conflicto tras el spec

| Servicio | create | update |
|---|---|---|
| `catalogItem` | 400 → **409** | 409 |
| `catalogType` | 400 → **409** | 409 |
| `geoLevelType` | 409 | 409 |
| `geoLocation` (`externalCode`) | 400 → **409** | 400 → **409** |
| `geoLocation` (`parent`+`name`) | — → **409** *(nueva)* | — → **409** *(nueva)* |
| `healthFacility` | 400 → **409** | — |
| `user` (`email`) | 409 | — |

### Activación

```ts
// antes: where incluye isActive: !isActive  → 404 si ya está en ese estado
// después: where solo por PK; el servicio compara el estado y decide
//   entidad ausente        → 404 con options.notFoundMessage
//   ya en el estado pedido → 409 con alreadyActive / alreadyInactive
//   en el otro estado      → se actualiza
```

`lang` desaparece de `ActivationOptions`: solo existía para construir el mensaje que ahora llega ya resuelto en `notFoundMessage`.

Las claves `alreadyActive` y `alreadyInactive` existen hoy para `geoLevelType` y `catalogType`. Hay que añadirlas para `catalogItem`, `geoLocation` y `healthFacility` en los tres idiomas: **6 claves nuevas × 3 archivos**.

---

## 4. Plan de implementación

1. **Mensaje correcto en la activación.** En `entityActivation.service.ts:29`, sustituir el `getMessage('geoLevelType.notFound', ...)` por `options.notFoundMessage`. Eliminar `lang` de `ActivationOptions` y de los cuatro llamadores.
   *Verificación:* borrar un `catalogItem` inexistente responde con el mensaje de catalogItem.

2. **Claves de estado.** Añadir `alreadyActive` y `alreadyInactive` a `catalogItem`, `geoLocation` y `healthFacility` en `es.json`, `en.json` y `nl.json`. Total tras este paso: 132 claves por idioma.
   *Verificación:* `npm run i18n:check` sale con 0.

3. **Activación idempotente y honesta.** En `setEntityActiveStatusService`, quitar `isActive: !isActive` del `where` y comparar el estado después de encontrar la entidad. Añadir a `ActivationOptions` los campos `alreadyInStateMessage` y `alreadyInStateCode`, que los cuatro llamadores pasan resueltos.
   *Verificación:* activar un registro ya activo devuelve 409, no 404.

4. **409 en los cinco duplicados.** Cambiar el status en `catalogItem.service.ts:30`, `catalogType.service.ts:13`, `geoLocation.service.ts:42`, `geoLocation.service.ts:165` y `healthFacility.service.ts:59`.
   *Verificación:* crear con un `code` existente devuelve 409 en las cinco entidades.

5. **Criterio único de unicidad.** Quitar `isActive: true` de los `where` de comprobación en los updates de `catalogItem:124`, `catalogType:76`, `geoLevelType:84` y `geoLocation:157`. El `Op.ne` sobre la propia PK se mantiene.
   *Verificación:* un `code` ocupado por un registro inactivo se rechaza igual desde create que desde update.

6. **FK revalidadas en el update.** En `updateCatalogItemService`, validar y aplicar `catalogTypeId` cuando venga en el payload, reutilizando la comprobación del create. Mismo tratamiento para `geoLevelTypeId` y `parentGeoLocationId` en `updateGeoLocationService`. Una FK inexistente o inactiva devuelve 404.
   *Verificación:* actualizar un catalogItem con un `catalogTypeId` inexistente devuelve 404, y con uno válido mueve el ítem de tipo.

7. **Unicidad de (parent, name) en geoLocation.** Añadir la comprobación del par en create y en update, con 409 y mensaje propio (`geoLocation.alreadyExists`, ya existente).
   *Verificación:* crear dos ubicaciones con el mismo nombre bajo el mismo padre devuelve 409, no 500.

8. **Transacciones.** Conectar el `transaction` que ya acepta `setEntityActiveStatusService` en los cuatro llamadores, abriendo la transacción en el servicio de entidad. Registrar en `CONVENTIONS.md` sección 11 que hoy ninguna otra operación es multi-escritura.
   *Verificación:* `npm run build` pasa y la activación sigue funcionando.

---

## 5. Criterios de aceptación

- [ ] Borrar un `catalogItem` inexistente devuelve el mensaje de catalogItem.
- [ ] Borrar un `catalogType` inexistente devuelve el mensaje de catalogType.
- [ ] Borrar una `geoLocation` inexistente devuelve el mensaje de geoLocation.
- [ ] Ninguna respuesta de activación menciona geoLevelType para otra entidad.
- [ ] Activar un registro ya activo devuelve 409 con `alreadyActive`.
- [ ] Desactivar un registro ya inactivo devuelve 409 con `alreadyInactive`.
- [ ] Crear con `code` duplicado devuelve 409 en catalogItem, catalogType, geoLevelType, geoLocation y healthFacility.
- [ ] Actualizar con `code` duplicado devuelve 409 en las mismas entidades.
- [ ] `grep -rn "400, '[A-Z]*_[0-9]*[AB]*_.*EXISTS'" src/services/` no devuelve resultados.
- [ ] Un `code` ocupado por un registro inactivo se rechaza tanto en create como en update.
- [ ] Actualizar un catalogItem con `catalogTypeId` inexistente devuelve 404.
- [ ] Actualizar un catalogItem con `catalogTypeId` inactivo devuelve 404.
- [ ] Actualizar un catalogItem con `catalogTypeId` válido cambia el tipo y se refleja en la respuesta.
- [ ] Actualizar una geoLocation con `parentGeoLocationId` inexistente devuelve 404.
- [ ] Crear dos geoLocation con el mismo `name` bajo el mismo padre devuelve 409, no 500.
- [ ] Ninguna respuesta de este flujo devuelve 500 por violación de UNIQUE.
- [ ] `npm run i18n:check` sale con 0 con las 132 claves.
- [ ] `npm run build` compila sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** unicidad **sin** filtrar por `isActive`, en create y en update. Es lo que las UNIQUE del DDL garantizan de verdad. Esto **corrige la aceptación escrita en DEUDA-013**, que pedía `isActive: true` en ambas: aplicarla habría dejado pasar códigos que Postgres rechaza con `23505`, convirtiendo un 409 en un 500.
- **No:** índices únicos parciales `WHERE "isActive"` en el DDL. Es la otra forma de resolverlo y permitiría reciclar códigos de registros borrados, pero es una migración de esquema y un cambio de regla de negocio, no una corrección de deuda.
- **No:** mapear `UniqueConstraintError` a 409 en `errorHandler`. Convierte cualquier unicidad no validada en un 409 con mensaje genérico y quita presión para validar en el servicio, que es donde el mensaje puede ser útil. Se prefiere validar explícitamente `(parent, name)`.
- **Sí:** el update permite cambiar la FK, validándola. Hoy `updateCatalogItemService` acepta `catalogTypeId` en el validador y lo ignora en silencio, que es el peor de los comportamientos posibles.
- **Sí:** 409 con `alreadyActive` / `alreadyInactive` en vez de 404. El recurso existe; decir que no se encuentra es falso y las claves ya estaban escritas esperando este uso.
- **Sí:** eliminar `lang` de `ActivationOptions`. Tras usar `notFoundMessage`, no le queda ningún consumidor.
- **No:** envolver en transacción operaciones de una sola escritura. Ningún servicio actual, salvo `user.service.ts`, hace más de una escritura dependiente. La regla queda documentada para las entidades ESAVI que vienen, que sí tendrán hijos.
- **Sí:** validar `(parentGeoLocationId, name)`. Es la única UNIQUE del esquema que ningún servicio comprueba, y hoy produce un 500.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un frontend que hoy trata el 400 de duplicado deja de reconocerlo | Listado en el impacto; 409 es el código del canon y ya se usaba en la mitad de los casos |
| Permitir cambiar `parentGeoLocationId` puede crear un ciclo en el árbol de ubicaciones | La validación comprueba que el nuevo padre exista y esté activo; la detección de ciclos no está en este spec y se anota como deuda nueva |
| Quitar `isActive: !isActive` del `where` cambia el comportamiento de las cuatro entidades a la vez | Los criterios de aceptación cubren las cuatro por separado |
| El paso 2 depende del SPEC 03 | Declarado en la cabecera: sin la paridad de `nl.json`, `i18n:check` falla |

---

## 8. Impacto en el contrato HTTP

| Caso | Antes | Después |
|---|---|---|
| Duplicado en create (5 entidades) | 400 | **409** |
| Duplicado de `externalCode` en update de geoLocation | 400 | **409** |
| Activar un registro ya activo | 404 | **409** |
| Desactivar un registro ya inactivo | 404 | **409** |
| Borrar entidad inexistente distinta de geoLevelType | 404 con mensaje equivocado | **404** con el mensaje correcto |
| Update con FK inexistente | 200, la FK se ignoraba | **404** |
| Update con FK válida en catalogItem | 200, sin efecto | **200**, se aplica el cambio |
| `name` duplicado bajo el mismo padre | 500 | **409** |

---

## Lo que **no** está en este spec

- Detección de ciclos al reasignar `parentGeoLocationId`.
- Índices únicos parciales en el DDL.
- Mapeo global de errores de Sequelize en `errorHandler`.
- El update de `healthFacility`, que aún no existe.
- Los códigos `ESAVI-*` de los errores que se tocan (SPEC 05).

Cada uno de esos, si aterriza, va en su propio spec.
