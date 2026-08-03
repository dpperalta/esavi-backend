# SPEC 02 — Validación de entrada y paginación

> **Estado:** Implementado
> **Depende de:** SPEC 01 (toca los mismos archivos de rutas)
> **Fecha:** 2026-08-01
> **Objetivo:** Que ninguna ruta llegue a Sequelize con un `:id` no verificado ni con un `limit`/`offset` sin validar.

Cubre las entradas **DEUDA-006, DEUDA-007, DEUDA-015, DEUDA-025 y DEUDA-026** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Segundo spec de la serie de seis que salda la deuda técnica catalogada a 2026-07-31.

---

## 1. Por qué existe este spec

Nueve rutas reciben un `:id` sin comprobar que sea un UUID, y ningún endpoint valida la paginación. Las dos cosas tienen el mismo efecto: entrada sin verificar llega hasta Sequelize, que responde con un 500 donde correspondía un 400. `?limit=abc` produce un `NaN` que se pasa tal cual al ORM, y `?limit=999999` es hoy una petición perfectamente válida.

---

## 2. Alcance

**Dentro:**

- Crear `geoLevelTypeIdValidator` — la única entidad que no lo tiene.
- Crear los 5 `entityListValidator` (`limit` 1–100, `offset` ≥ 0).
- Añadir `...idValidator` + `validateFields` a las 9 rutas que hoy no validan su `:id`.
- Añadir `...listValidator` + `validateFields` a las 6 rutas de listado.
- Corregir los 4 spreads ausentes: 3 en `geoLocation.routes.ts`, 1 en `auth.routes.ts`.
- `DELETE` y `PATCH /activate` de `geoLocation` pasan a usar `geoLocationIdValidator`, no `updateGeoLocationValidator`.
- Sacar `...entityIdValidator` de los 4 `updateXValidator`; se compone en la ruta.
- Una sola constante de paginación en `src/constants/pagination.constants.ts`.
- El default se resuelve siempre en el servicio, nunca en el controlador.
- Corregir `ESAVI_APP_DEFAULT_OFFSET` a `0` en los tres archivos de entorno.

**Fuera de alcance (specs siguientes):**

- Los niveles de rol de esas mismas rutas — SPEC 01.
- Renumerar los códigos `ESAVI-*` — SPEC 05.
- El `console.log` de `geoLocation.controller.ts:34` y el bloque comentado del final de `geoLocation.routes.ts` — SPEC 06.
- Las tres copias muertas dentro de `healthFacility.service.ts` — SPEC 06.
- Validar el cuerpo de create/update más allá de lo que ya existe.

---

## 3. Modelo de datos

No hay estructuras nuevas. Hay un archivo de constantes nuevo y una corrección de entorno.

`src/constants/pagination.constants.ts`:

```ts
export const DEFAULT_LIMIT = process.env.ESAVI_APP_DEFAULT_LIMIT
    ? parseInt(process.env.ESAVI_APP_DEFAULT_LIMIT) : 10;
export const DEFAULT_OFFSET = process.env.ESAVI_APP_DEFAULT_OFFSET
    ? parseInt(process.env.ESAVI_APP_DEFAULT_OFFSET) : 0;
export const MAX_LIMIT = 100;
```

Forma de los cinco validadores de listado, uno por entidad:

```ts
export const catalogTypeListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];
```

`MAX_LIMIT` existe como constante para el servicio; el validador escribe `max: 100` literal, porque `express-validator` se declara de forma estática en el módulo.

### Inventario de rutas a tocar

| Ruta | Falta hoy | Queda con |
|---|---|---|
| `GET /catalog-types/` | todo | `...catalogTypeListValidator` |
| `GET /catalog-types/:id` | todo | `...catalogTypeIdValidator` |
| `DELETE /catalog-types/:id` | todo | `...catalogTypeIdValidator` |
| `PATCH /catalog-types/activate/:id` | todo | `...catalogTypeIdValidator` |
| `GET /geo-level-types/` | todo | `...geoLevelTypeListValidator` |
| `GET /geo-level-types/:id` | todo | `...geoLevelTypeIdValidator` *(nuevo)* |
| `DELETE /geo-level-types/:id` | todo | `...geoLevelTypeIdValidator` |
| `PATCH /geo-level-types/activate/:id` | todo | `...geoLevelTypeIdValidator` |
| `GET /catalog-items/type/:id` | list | `...catalogItemIdValidator, ...catalogItemListValidator` |
| `GET /catalog-items/admin/type/:id` | todo | `...catalogItemIdValidator, ...catalogItemListValidator` |
| `GET /geo-locations/` | list | `...geoLocationListValidator` |
| `GET /geo-locations/:id` | todo | `...geoLocationIdValidator` |
| `PUT /geo-locations/:id` | spread | `...geoLocationIdValidator, ...updateGeoLocationValidator` |
| `DELETE /geo-locations/:id` | validador incorrecto | `...geoLocationIdValidator` |
| `PATCH /geo-locations/activate/:id` | validador incorrecto | `...geoLocationIdValidator` |
| `GET /health-facilities/location/:id` | todo | `...geoLocationIdValidator, ...healthFacilityListValidator` |
| `POST /auth/login` | spread | `...loginValidator` |

Dos apuntes sobre esa tabla:

- `GET /health-facilities/location/:id` recibe un **geoLocationId**, no un id de establecimiento. Por eso lleva `geoLocationIdValidator` y no `healthFacilityIdValidator` — el mensaje de error debe nombrar la entidad correcta.
- `POST /auth/login` está en DEUDA-015 pero no es paginación ni `:id`. Va aquí porque es el mismo defecto —array pasado sin spread— y son dos caracteres.

---

## 4. Plan de implementación

1. **Constantes de paginación.** Crear `src/constants/pagination.constants.ts` con `DEFAULT_LIMIT`, `DEFAULT_OFFSET` y `MAX_LIMIT`. Corregir `ESAVI_APP_DEFAULT_OFFSET` a `0` en `.env.example`, `.env.development` y `.env.production`.
   *Verificación:* `npm run build` pasa; nada la consume todavía.

2. **Servicios consumen la constante.** Eliminar las declaraciones duplicadas de `geoLevelType.service.ts:8-9` y `geoLocation.service.ts:7-8`. Sustituir los `limit: number = 10, offset: number = 0` hardcodeados de `catalogItem.service.ts:67,84`, `catalogType.service.ts:31,42` y `healthFacility.service.ts:88` por los valores importados.
   *Verificación:* `grep -rn "= 10, offset" src/services/` no devuelve nada.

3. **El default sale del controlador.** En `healthFacility.controller.ts:30-31`, sustituir `parseInt(...) || 10` por el idiom dominante, que pasa `undefined` al servicio y deja que el servicio resuelva el default.
   *Verificación:* `GET /health-facilities/location/:id` sin query devuelve `DEFAULT_LIMIT` filas.

4. **Validadores nuevos.** Crear `geoLevelTypeIdValidator` en `src/validators/geoLevelType.validator.ts` y los cinco `entityListValidator`, uno por archivo de validador. El barrel ya usa `export *`, así que no requiere registro manual.
   *Verificación:* `npm run build` pasa; nada los consume todavía.

5. **Composición del id en el update.** Sacar `...entityIdValidator` de `updateCatalogItemValidator`, `updateCatalogTypeValidator`, `updateGeoLocationValidator` y `updateHealthFacilityValidator`, y añadirlo en las rutas `PUT` correspondientes. Ambas mitades en el mismo commit: por separado, el `PUT` queda sin validar el `:id`. Eliminar también el `param('id')` suelto de `updateGeoLevelTypeValidator:10`.
   *Verificación:* `PUT /api/catalog-items/no-es-uuid` devuelve 400 con un solo error de id, no dos.

6. **Rutas que no validaban nada.** Aplicar las 11 filas restantes del inventario, cada una con su `validateFields` detrás. Corregir los cuatro spreads ausentes de `geoLocation.routes.ts:25,29,33` y `auth.routes.ts:10`.
   *Verificación:* `GET /api/catalog-types/no-es-uuid` devuelve 400, no 500.

7. **Barrido final.** Comprobar que toda ruta con `:id` o con paginación lleva validador y `validateFields`, y que ninguna pasa un array sin spread.
   *Verificación:* la checklist de aceptación completa.

---

## 5. Criterios de aceptación

- [ ] `GET /api/catalog-types/no-es-uuid` devuelve 400.
- [ ] `GET /api/geo-level-types/no-es-uuid` devuelve 400.
- [ ] `DELETE /api/geo-level-types/no-es-uuid` devuelve 400.
- [ ] `PATCH /api/geo-level-types/activate/no-es-uuid` devuelve 400.
- [ ] `GET /api/catalog-items/admin/type/no-es-uuid` devuelve 400.
- [ ] `GET /api/health-facilities/location/no-es-uuid` devuelve 400 y el mensaje nombra GeoLocation, no Health Facility.
- [ ] Ninguna de las rutas anteriores devuelve 500 con un id malformado.
- [ ] `?limit=abc` devuelve 400 en los 6 listados.
- [ ] `?limit=0` y `?limit=101` devuelven 400.
- [ ] `?limit=100` devuelve 200.
- [ ] `?offset=-1` devuelve 400.
- [ ] Un listado sin `limit` devuelve exactamente `DEFAULT_LIMIT` filas.
- [ ] Un listado sin `offset` incluye el primer registro del orden.
- [ ] `PUT /api/catalog-items/<uuid-invalido>` devuelve un único error de id.
- [ ] `DELETE /api/geo-locations/:id` no exige ningún campo del body.
- [ ] `POST /api/auth/login` sin email devuelve 400 con el error del validador.
- [ ] `grep -rn "DEFAULT_LIMIT =" src/services/` no devuelve resultados.
- [ ] `grep -rnE "validateUserRole\([A-Z]+\), [a-zA-Z]+Validator," src/routes/` no devuelve resultados (ningún array sin spread).
- [ ] `npm run build` compila sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** un `entityListValidator` por entidad. Sigue la plantilla 14.2 del canon y deja espacio a filtros de query propios — `geoLocation` ya recibe `geoLevelId` y `parentId` sin validar, y ahí es donde se validarán.
- **No:** un `paginationValidator` compartido. Ahorra cinco arrays casi iguales pero obliga a modificar el canon y a mezclar dos validadores en cuanto una entidad necesite filtros propios.
- **Sí:** `max: 100` en `limit`. Sin tope, `?limit=999999` es una petición válida contra tablas de catálogo que crecerán.
- **Sí:** `DEFAULT_OFFSET = 0`. El `1` de `.env.example` hace que todo listado que lea el entorno se salte su primer registro. Es un bug, no una convención de paginación por página.
- **Sí:** el default se resuelve en el servicio. Con el default en el controlador, un segundo consumidor del servicio obtiene otro comportamiento.
- **Sí:** sacar el `:id` de los `updateXValidator`, aunque no esté catalogado como deuda. Contradice la sección 14.2 y produce doble validación en `catalogItem.route.ts:29`; corregirlo aparte obligaría a editar los mismos cuatro archivos dos veces.
- **No:** validar `geoLevelId` y `parentId` en `GET /geo-locations/`. Son filtros, no paginación; entran cuando se aborde el filtrado de listados.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un cliente que hoy manda `?limit=500` empieza a recibir 400 | Documentado en el impacto; 100 es el tope del canon y el frontend pagina |
| Cambiar `DEFAULT_OFFSET` de 1 a 0 altera el contenido de la primera página en los listados de `geoLevelType` y `geoLocation` | Es la corrección de un salto de registro, no una regresión; se avisa al frontend |
| El paso 5 partido en dos commits deja los `PUT` sin validar el `:id` | El plan lo declara explícito: las dos mitades van en el mismo commit |

---

## 8. Impacto en el contrato HTTP

| Caso | Antes | Después |
|---|---|---|
| `:id` malformado en las 9 rutas listadas | 500 | **400** |
| `?limit=abc` | 200 con resultado impredecible | **400** |
| `?limit>100` | 200 | **400** |
| Primera página de `geoLevelType` / `geoLocation` sin `offset` | empezaba en el 2.º registro | **empieza en el 1.º** |
| `DELETE /api/geo-locations/:id` con body inválido | 400 | **200** (ya no valida body) |

---

## Lo que **no** está en este spec

- Niveles de rol (SPEC 01).
- Claves i18n (SPEC 03).
- Códigos de operación (SPEC 05).
- `console.log` y código comentado (SPEC 06).
- Filtros de query distintos de `limit` / `offset`.

Cada uno de esos, si aterriza, va en su propio spec.
