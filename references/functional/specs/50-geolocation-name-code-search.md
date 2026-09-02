# SPEC F50 — Búsqueda de geoLocation por nombre o código

> **Estado:** Implementado
> **Depende de:** SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Fecha:** 2026-09-01
> **Objetivo:** Ampliar el listado `ESAVI-GEOLOC-002` con dos filtros opcionales — nombre y código — resueltos con `Op.iLike` sobre `name`, `externalCode` e `isoCode`.

---

## 1. Por qué existe este spec

`GET /api/geo-locations` (`ESAVI-GEOLOC-002`) ya admite filtrar por `geoLevelTypeId` y por `parentGeoLocationId`
(`geoLocation.controller.ts:31-32`), pero ninguno de los dos ayuda a quien conoce el nombre o el código de una
ubicación y no su jerarquía. Un formulario que necesita resolver "Quito" o "EC-P" contra `geoLocation` hoy tiene
que traer la tabla entera paginada y filtrar en el cliente, porque el listado no admite ningún filtro de texto.

**Es la primera vez que el repositorio usa `Op.iLike`.** Hasta ahora ningún servicio filtra por subcadena:
las búsquedas existentes (`006` de `patient`, `007` de `patient`) comparan por igualdad exacta o por
pertenencia a un conjunto de tokens exactos, nunca por coincidencia parcial. `references/specs/09-healthfacility-crud.md`
dejó la búsqueda por texto explícitamente fuera de su alcance con esta misma razón: "No existe `Op.iLike` en
ningún servicio del repositorio; introducirlo es un cambio transversal." Este spec es el que lo introduce,
acotado a una sola entidad y a dos columnas concretas, para que el patrón quede documentado antes de que
otra entidad lo necesite.

`geoLocation` no tiene una columna `code` propiamente dicha — a diferencia de `geoLevelType`, que sí la tiene
y queda fuera de este spec. Lo que juega ese papel son `externalCode` e `isoCode` (`esaviapp.sql:452-454`),
y hoy ninguna de las dos es buscable por texto parcial.

---

## 2. Alcance

**Dentro:**

- Dos query params opcionales nuevos en `GET /api/geo-locations` (`ESAVI-GEOLOC-002`): `name` y `code`.
- `name` filtra por `Op.iLike` sobre la columna `name` de `geoLocation`.
- `code` filtra por `Op.iLike` sobre `externalCode` **o** `isoCode`, unidos con `Op.or`.
- Cuando `name` y `code` llegan juntos, sus dos grupos de condiciones se combinan entre sí con `Op.or`
  (coincide con el nombre o con el código) y ese grupo se combina con `Op.and` junto a `geoLevelTypeId`
  y `parentGeoLocationId` cuando también vienen.
- Ambos filtros aplican por igual en `getActiveGeoLocationsService` (`002A`) y `getAllGeoLocationsService` (`002B`).
- Normalización mínima de entrada: `.trim()` sobre el valor recibido antes de envolverlo en `%…%`.
- Límite de longitud en el validador, alineado a las columnas que se consultan.

**Fuera de alcance (otros specs):**

- `geoLevelType` no se toca. No tenía filtro de texto en este spec, aunque sí tiene una columna `code` real;
  lo resuelve el [SPEC F52](52-name-code-resolution.md), que le añade `name` y `code` como parámetros canónicos.
- `healthFacility` no se toca. `references/specs/09-healthfacility-crud.md` ya lo dejó fuera de su alcance
  con la misma razón (`Op.iLike` inexistente); sigue sin resolverse aquí — la resuelve el [SPEC F51](51-healthfacility-name-code-search.md).
- Búsqueda en `officialName` o `shortName` de `geoLocation`. Se decidió que `name` es la columna que importa
  para el buscador; las otras dos quedan fuera hasta que exista un caso de uso que las pida.
- Búsqueda tolerante a acentos o a erratas. `Op.iLike` es insensible a mayúsculas pero no a tildes;
  igualar "Bogota" con "Bogotá" exigiría una columna generada o una extensión como `unaccent`, que es un
  cambio de esquema y no entra aquí.
- Ordenación por relevancia de la coincidencia. El listado conserva su `order` actual (`sortOrder ASC`).
- Cualquier cambio a `geoLocation.model.ts`, sus asociaciones o sus claves i18n existentes.

---

## 3. Modelo de datos

No hay tabla nueva ni columna nueva. `geoLocation` — `esaviapp.sql:444-468` — ya tiene `name` (`varchar(200)`,
no nulo), `externalCode` (`varchar(100)`, nulo) e `isoCode` (`varchar(20)`, nulo). Las cuatro columnas
transversales (`isActive`, `deletedAt`, `sysDetails`, `appDetails`) no se tocan. Cambian tres cosas: el
validador de listado, la firma de los dos servicios de listado y el controlador que los invoca.

### 3.1 Ajuste del validador

`src/validators/geoLocation.validator.ts`, en `geoLocationListValidator`:

| Antes | Después |
|---|---|
| `limit`, `offset` únicamente | se añaden `query('name')` y `query('code')`, ambos `.optional().trim()` |

```ts
query('name').optional().trim().isLength({ max: 200 })
    .withMessage('Name must be at most 200 characters long'),
query('code').optional().trim().isLength({ max: 100 })
    .withMessage('Code must be at most 100 characters long'),
```

El tope de `name` (200) replica el `varchar(200)` de la columna. El de `code` (100) replica `externalCode`,
que es la más larga de las dos columnas que consulta — una cadena que no cabría en `isoCode` (`varchar(20)`)
tampoco puede coincidir con ella, así que no hace falta un segundo tope más corto.

### 3.2 Ajuste del servicio

`src/services/geoLocation.service.ts`. Las firmas de los dos servicios de listado ganan dos parámetros:

```ts
const getActiveGeoLocationsService = async (
    geoLevelTypeId?: string,
    parentGeoLocationId?: string,
    name?: string,
    code?: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => { ... }
```

Misma ampliación en `getAllGeoLocationsService`. El orden de parámetros sigue al de los filtros ya existentes
(`geoLevelTypeId`, `parentGeoLocationId`) y dispone los nuevos antes de `limit`/`offset`, que van siempre al final.

Construcción del `where`:

```ts
const escapeLike = (value: string) => value.replace(/[%_]/g, '\\$&');

const textConditions: any[] = [];
if( name ) {
    textConditions.push({ name: { [Op.iLike]: `%${ escapeLike(name.trim()) }%` } });
}
if( code ) {
    const codePattern = `%${ escapeLike(code.trim()) }%`;
    textConditions.push({
        [Op.or]: [
            { externalCode: { [Op.iLike]: codePattern } },
            { isoCode: { [Op.iLike]: codePattern } }
        ]
    });
}
if( textConditions.length > 0 ) {
    whereClause[Op.or] = textConditions;
}
```

`escapeLike` neutraliza `%` y `_` en la entrada del usuario antes de interpolarla en el patrón — sin esto,
un valor como `code=A_B` coincidiría con "A" + cualquier carácter + "B" en vez de con el guion bajo literal.

`name` y `code`, cuando ambos llegan, se combinan con `Op.or` entre sí — coincide con uno u otro — y ese
bloque entra en el mismo objeto `whereClause` que ya trae `isActive`, `geoLevelTypeId` y `parentGeoLocationId`
como claves `AND` implícitas de Sequelize. El resultado es: (nombre O código) Y nivel Y padre Y activo.

### 3.3 Controlador

`src/controllers/geoLocation.controller.ts`, en `getGeoLocations`: dos lecturas más de `req.query`, mismo
patrón que las cuatro ya existentes.

```ts
const name = req.query.name ? (req.query.name as string).trim() : undefined;
const code = req.query.code ? (req.query.code as string).trim() : undefined;
```

Pasan a los dos servicios en el orden de §3.2. Ninguna otra línea del controlador cambia.

### 3.4 Superficie HTTP

```
GET /api/geo-locations?name=&code=&geoLevelId=&parentId=&limit=&offset=   ESAVI-GEOLOC-002   USER   (existe, se amplía)
```

La ruta, el código de operación y el rol mínimo no cambian — sigue siendo el mismo `002` dual por rol que
ya describe `references/CONVENTIONS.md` §6, resuelto en el controlador con `canViewInactive`. Lo único nuevo
son los dos query params, ambos opcionales y componibles con los cuatro que ya existían.

### 3.5 Reglas de negocio

**`ESAVI-GEOLOC-002` — listar, filtro ampliado.** `name` vacío o ausente no filtra por nombre; `code` vacío
o ausente no filtra por código; los dos ausentes dejan el comportamiento actual intacto — a diferencia del
`007` de `patient`, aquí un filtro vacío nunca vuelca la tabla completa por sí solo, porque `iLike` sobre un
patrón vacío (`%%`) sigue siendo una condición real que Postgres evalúa contra el índice de la tabla, no una
que se salte: coincide con todo, sí, pero eso no es distinto de omitir el filtro. La guarda del servicio evita
justamente construir esa condición vacía cuando el parámetro no llegó, así que el comportamiento con y sin el
parámetro vacío es idéntico y no hay ningún caso donde `iLike` se ejecute sobre `%%`.

No hay validación de FK nueva, ni unicidad nueva, ni escritura: `002` es de solo lectura y no toca `appDetails`
ni `sysDetails`. Este spec **no declara contrato de update diferencial** — no hay ninguna operación que
modifique una fila existente. La tabla de `candidates` y el bloque de cinco criterios de `CONVENTIONS.md` §11
no aplican.

### 3.6 Claves i18n nuevas

Ninguna. El `002` sigue resolviendo su mensaje con `geoLocation.getSuccessPlural` / `getFailedPlural`, que ya
existen en los tres idiomas y no cambian de significado por tener más filtros.

### 3.7 Forma de la respuesta

Sin cambios. Sigue siendo `{ count, rows }` de `findAndCountAll`, con las mismas columnas de `geoLocation` que
hoy devuelve el `002`. Los filtros nuevos no añaden ni quitan campos de cada fila — solo deciden cuáles entran.

---

## 4. Plan de implementación

1. **Ampliar `geoLocationListValidator`.** Añadir `query('name')` y `query('code')` opcionales con los topes
   de longitud de §3.1, en `src/validators/geoLocation.validator.ts`.
   *Verificación:* `npm run build` en 0; `GET /api/geo-locations?name=x` no responde 400.

2. **Ampliar `getActiveGeoLocationsService` y `getAllGeoLocationsService`.** Nuevos parámetros `name` y `code`,
   construcción del `where` con `Op.iLike`/`Op.or` y el escape de `escapeLike` de §3.2, en
   `src/services/geoLocation.service.ts`.
   *Verificación:* invocar el servicio con `name: 'quito'` devuelve las filas cuyo `name` contiene "quito"
   sin distinguir mayúsculas; sin `name` ni `code`, el resultado es idéntico al de antes del cambio; un
   `code: 'A_B'` no coincide con filas que no tienen el guion bajo literal.

3. **Ampliar el controlador `getGeoLocations`.** Leer `name` y `code` de `req.query` y pasarlos a los dos
   servicios, en `src/controllers/geoLocation.controller.ts`.
   *Verificación:* `npm run build` en 0; el controlador sigue sin importar ningún modelo.

4. **Casos de contrato.** En `tests/contract/geoLocation.test.ts` (o el archivo de contrato existente de la
   entidad), casos nuevos: filtro por `name` parcial, filtro por `code` que coincide vía `externalCode`,
   filtro por `code` que coincide vía `isoCode`, combinación `name`+`code` con `Op.or` entre ambos, combinación
   con `geoLevelTypeId`/`parentGeoLocationId` con `Op.and`, y el caso de ningún filtro devolviendo lo mismo
   que hoy.
   *Verificación:* `npm run check` en 0.

**Nota sobre `ROUTE_RULES`.** No hay fila nueva que añadir en `tests/auth/roles.test.ts`: la ruta, el método,
el rol mínimo y el código de operación (`ESAVI-GEOLOC-002`) ya están registrados y no cambian con este spec.

---

## 5. Criterios de aceptación

- [ ] `GET /api/geo-locations?name=X` devuelve solo filas cuyo `name` contiene `X`, sin distinguir mayúsculas.
- [ ] `GET /api/geo-locations?code=X` devuelve filas cuyo `externalCode` **o** `isoCode` contiene `X`.
- [ ] Una fila cuyo `isoCode` contiene `X` pero cuyo `externalCode` no, aparece igual en el resultado de `code=X`.
- [ ] `GET /api/geo-locations?name=X&code=Y` devuelve filas que coinciden con `X` **o** con `Y` — nunca exige las dos.
- [ ] `GET /api/geo-locations?name=X&geoLevelId=Z` devuelve solo filas que coinciden con `X` **y** pertenecen a `Z`.
- [ ] `GET /api/geo-locations` sin `name` ni `code` devuelve exactamente lo mismo que devolvía antes de este spec.
- [ ] Un `name` o `code` que no coincide con ninguna fila responde `200` con `count: 0`, nunca `404`.
- [ ] `name` u `code` de más de 200 / 100 caracteres respectivamente responde `400`.
- [ ] Un `USER` sigue viendo solo activos y un `ADMIN`/`SUPERADMIN` ve también inactivos, con los filtros de texto aplicados por igual en ambos casos.
- [ ] Un `code` que contiene `_` literal no se comporta como comodín: `escapeLike` lo neutraliza.
- [ ] `grep -rn "Op.iLike" src/services/geoLocation.service.ts` devuelve exactamente las dos apariciones de §3.2.
- [ ] Ninguna otra ruta ni servicio del repositorio queda modificado por este spec.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** ampliar el `002` existente en vez de crear un `006` dedicado. No hay cifrado ni tokens de por medio
  —a diferencia del `007` de `patient`—, así que un filtro más sobre el mismo listado es toda la complejidad
  que hace falta.
- **Sí:** `Op.iLike` con comodines en los dos extremos (`%valor%`), aunque sea la primera vez que el repositorio
  lo usa. Es lo que un buscador de UI espera, y acotarlo a una sola entidad y dos columnas concretas deja el
  patrón documentado sin comprometer al resto del repositorio a adoptarlo.
- **Sí:** `code` busca en `externalCode` **e** `isoCode` con `Op.or`. `geoLocation` no tiene una columna `code`
  real; las dos que hacen ese papel son intercambiables desde la perspectiva de quien busca — no sabe de
  antemano cuál de las dos tiene cargado el valor que recuerda.
- **Sí:** `name` y `code` se combinan entre sí con `Op.or`, no con `Op.and`. Es la respuesta explícita del
  usuario: un buscador único de "nombre o código" no debe exigir que las dos coincidan a la vez.
- **Sí:** ese bloque `Op.or` se combina con `Op.and` respecto a `geoLevelTypeId`, `parentGeoLocationId` e
  `isActive`. Son ejes distintos — jerarquía y estado, no identidad — y mezclarlos con `Op.or` dejaría
  resultados que no pertenecen a la jerarquía pedida.
- **Sí:** limitar el buscador a la columna `name`, sin `officialName` ni `shortName`. Es la columna con
  peso real en el esquema — gobierna la unicidad entre hermanos — y las otras dos no tienen un caso de uso
  pedido todavía.
- **Sí:** escapar `%` y `_` en la entrada del usuario antes de interpolarla en el patrón. Sin esto, cualquier
  código que contenga un guion bajo literal —frecuente en códigos administrativos— se comportaría como comodín.
- **No:** `geoLevelType`. Tiene una columna `code` real y sería un cambio de una sola columna, pero el usuario
  acotó este spec a `geoLocation` explícitamente. Lo resuelve el [SPEC F52](52-name-code-resolution.md).
- **No:** `healthFacility`. Ya estaba fuera del alcance de `references/specs/09-healthfacility-crud.md` por la
  misma razón (`Op.iLike` inexistente) y sigue sin resolverse aquí — la resuelve el [SPEC F51](51-healthfacility-name-code-search.md).
- **No:** normalizar acentos (`unaccent` o columna generada). Es un cambio de esquema y de índice que no está
  justificado por lo que se pidió; queda anotado como limitación conocida en §7.
- **No:** ordenar por relevancia de la coincidencia. El `order` actual (`sortOrder ASC`) se conserva; ordenar
  por cercanía de texto exigiría una función de similitud que no existe en el esquema.
- **No:** un parámetro único que busque en nombre y código a la vez (como el `name` de `patient` en el F45).
  El usuario pidió explícitamente los dos por separado — a diferencia de `patient`, aquí no hay pérdida de
  procedencia del token que fuerce a unificarlos: `name` y `code` son columnas distintas sin ambigüedad.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un valor de búsqueda que contiene `%` o `_` se interpreta como comodín de SQL en vez de carácter literal — buscar `code=A_B` coincidiría con "A" + cualquier carácter + "B", no con el guion bajo literal | El servicio escapa `%` y `_` en `name` y `code` antes de interpolarlos en el patrón (`escapeLike`), igual que exige cualquier uso de `iLike` con entrada de usuario. Forma parte del paso 2 del plan |
| `iLike` con comodín inicial (`%valor%`) no puede usar un índice B-tree estándar sobre `name`, `externalCode` ni `isoCode` — cada búsqueda recorre la tabla completa | El volumen de `geoLocation` es geografía nacional, no millones de filas; aceptable sin índice especial. Si el catálogo crece mucho, la salida es un índice `pg_trgm` (`gin_trgm_ops`), y es un cambio de esquema fuera de este spec |
| Un `code` o `name` de una sola letra devuelve una página grande de coincidencias parciales | Ya lo acota `limit` (máximo 100 por `geoLocationListValidator`); no es un endpoint nuevo con superficie de enumeración distinta a la que ya tenía el `002` |

---

## Lo que **no** está en este spec

- Búsqueda por texto en `geoLevelType` (tiene columna `code` real) — la resuelve el [SPEC F52](52-name-code-resolution.md).
- Búsqueda por texto en `healthFacility` (ya fuera de alcance en SPEC 09, sigue sin resolverse aquí) — la resuelve el [SPEC F51](51-healthfacility-name-code-search.md).
- Búsqueda en `officialName` o `shortName` de `geoLocation`.
- Normalización de acentos o tolerancia a erratas (`unaccent`, `pg_trgm`, columna generada).
- Ordenación por relevancia de la coincidencia.
- Índice de trigramas u otro cambio de esquema para acelerar `iLike`.

Cada uno de esos, si aterriza, va en su propio spec.
