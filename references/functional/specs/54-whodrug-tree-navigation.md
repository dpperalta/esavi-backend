# SPEC F54 — Navegación jerárquica del diccionario WHODrug

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F18 (la entidad, el modelo y la ruta base `/api/whodrug-vaccines` — implementado)**, **SPEC F19 (el importador que puebla la tabla — implementado)**, **SPEC F52 (`escapeLike` y `buildTextSearchConditions`, obligatorios en todo `Op.iLike` — implementado)**
> **Fecha:** 2026-09-02
> **Objetivo:** Dar cinco endpoints de lectura que recorran el árbol `abbreviation → drugName → maHolders → formTranslations → strength` y digan, en cada opción, si la vacuna ya quedó determinada.

> **Nota de implementación (2026-09-02).** Dos ajustes menores frente al cuerpo del documento, ninguno con efecto sobre el contrato HTTP:
>
> 1. **El orden se pide como `ASC` a secas, no como `ASC NULLS LAST`.** En Postgres un orden ascendente ya coloca los nulos al final, así que la cláusula explícita era redundante y obligaba a pasar la dirección como literal SQL en vez de por la API de Sequelize. El efecto es el que §3.5 describe: la opción sin valor cierra la lista.
> 2. **Se añadió el tipo `VaccineWhodrugTreeAncestor`** —`Exclude<VaccineWhodrugTreeLevel, 'strength'>`— que §3.3 no enumeraba. `strength` es la hoja del árbol y nunca es ancestro de nadie, así que tampoco viaja como parámetro; sin el tipo, el mapa de ancestros indexaba los filtros con una clave que no existe en ellos.

---

## 1. Por qué existe este spec

**A — Seleccionar una vacuna hoy exige listar el diccionario entero.** `vaccineWhodrug` es plana: 28 columnas de datos y ninguna jerarquía declarada. El [SPEC F18](./18-vaccinewhodrug-crud.md) entregó `002A` con paginación y filtro de texto sobre `drugName` y `drugCode`, que resuelve el autocompletado por nombre. Lo que no resuelve es el camino contrario, que es el que sigue quien llena el formulario de notificación: sé que fue una BCG, no sé cómo se llama la presentación exacta que se administró. Ese usuario necesita bajar por facetas, no escribir un nombre que no conoce.

**B — La jerarquía existe en los datos aunque no esté en el esquema.** Las cinco columnas la dibujan por sí solas: una abreviatura (`BCG`) agrupa nombres comerciales (`drugName`), cada nombre agrupa titulares de autorización (`maHolders`), cada titular agrupa formas farmacéuticas (`formTranslations`) y cada forma agrupa potencias (`strength`). Al final de las cinco selecciones queda **una fila**, que es la que la notificación referencia por su `vaccineWhodrugId`.

**C — El backend externo ya resolvió esto, y su solución tiene tres defectos que este spec no hereda.** `references/external/whodhis/src/controllers/vaccinesWhodrug.js` implementa los cinco niveles y es el punto de partida del diseño. Sus problemas, verificados en el archivo:

1. **Inyección SQL.** Las cinco consultas interpolan la query string directamente en el SQL: `WHERE vw."iso3Code" = '${country}'` (`vaccinesWhodrug.js:16`), y lo mismo con `abbreviation`, `drugName`, `maHolders` y `forms`. No hay ni un `replacements`.
2. **Tres consultas por petición.** Cada endpoint lanza un `COUNT` de distintos, un `COUNT` de filas y el `SELECT` (`:10`, `:23`, `:38`). Las tres recorren el mismo subconjunto.
3. **`total` no sirve para lo que el usuario quiere.** Es el número de filas de **todo el nivel**, no el de filas que cuelgan de **cada opción**. Con `count: 2, total: 4` no hay forma de saber si el `drugName` que el usuario acaba de pulsar es el que tiene 1 fila o el que tiene 3. La pregunta «¿ya es única esta vacuna?» se hace **por opción**, y el contador que la responde tiene que viajar en la opción.

**D — El `DISTINCT ON *` del externo devuelve una fila arbitraria.** `SELECT DISTINCT ON (vw."drugName") *` (`:112`) entrega, por cada nombre, las 28 columnas del primer registro del grupo según el orden. Los campos que **varían** dentro del grupo —`maHolders`, `strength`, `vaccineWhodrugId`— llegan con el valor de una fila cualquiera y el consumidor no tiene modo de saberlo. Un selector no necesita esas columnas: necesita el valor del nivel y saber si el camino terminó.

---

## 2. Alcance

**Dentro:**

- **Cinco operaciones nuevas de solo lectura**, `ESAVI-WHODRUG-006A` a `006E`, una por nivel del árbol, todas con rol mínimo `USER` bajo la ruta base ya existente `/api/whodrug-vaccines`.
- **Un contador por opción.** Cada opción devuelve `matchCount` —cuántas filas del diccionario cuelgan de ella— y `vaccineWhodrugId` **resuelto cuando `matchCount === 1`**, para que el frontend deje de desplegar listas en cuanto la vacuna queda determinada.
- **`count` y `total` de nivel**, conservados con la misma semántica del backend externo: `count` = opciones distintas, `total` = filas del subconjunto. Se derivan de las opciones ya calculadas, **sin consultas adicionales**.
- **Subconjunto de país e idioma** replicado del externo, con el idioma configurable: `iso3Code = :country` **o** (`iso3Code IS NULL` y `language = :language` y `isPreferred = true`). `country` opcional, `language` de `?language=` o de `req.lang`.
- **Encadenado con padre inmediato obligatorio.** Cada nivel exige el valor de su padre directo; los ancestros superiores son opcionales y acotan si llegan.
- **Los nulos son una opción navegable**, con `value: null` y el centinela `__NULL__` para reenviarlos al nivel siguiente. Ninguna fila del diccionario queda inalcanzable.
- **`?search=` por nivel**, con `buildTextSearchConditions` —y por tanto con `escapeLike`— sobre la columna del propio nivel, mínimo 2 caracteres.
- **Sin paginación.** Los cinco niveles devuelven su lista completa.
- **Dos claves i18n nuevas** en `es`, `en` y `nl`.
- **Cinco filas nuevas en `ROUTE_RULES`** de `tests/auth/roles.test.ts`, subiendo el total esperado de **325 a 330**.
- Ampliación de `tests/contract/vaccineWhodrug.test.ts` con el recorrido completo del árbol.

**Fuera de alcance (otros specs):**

- **Un endpoint de resolución acumulativa** que se salte por sí solo los niveles de un único valor y devuelva `nextLevel`. Se consideró y se descartó: el `matchCount` por opción ya le da al frontend lo que necesita para decidir, y un endpoint que decide por él fija en el backend una política de interfaz.
- **Devolver, por opción, cuántos valores distintos quedan en cada nivel inferior** (`remaining: { maHolders: 1, forms: 2 }`). Exige una agregación por nivel restante en cada petición; se aplaza hasta que haya una necesidad real medida.
- **Variantes `/admin` que incluyan filas inactivas.** La navegación existe para seleccionar una vacuna en un formulario; una entrada dada de baja no debe poder seleccionarse. Quien necesite ver inactivas tiene el `002B`.
- **Paginación de los niveles.** Ver el riesgo de §7.
- **Índices nuevos sobre las cinco columnas del árbol.** El diccionario cargado ronda las 3000 filas; el `GROUP BY` secuencial sobre esa tabla no justifica tocar el DDL. Si la tabla crece un orden de magnitud, es su propio spec.
- **Cambiar la superficie de `002A`, `002B`, `003`, `004` o del importador `007`.** Este spec solo añade.
- **Un sexto nivel por `noDose` o por `diluent`.** El árbol acordado tiene cinco niveles.
- **La búsqueda full-text sobre `IX_vaccineWhodrug_name`.** Sigue deliberadamente sin consumirse, por la razón del F18 §6.
- **Exponer `sysDetails` o `appDetails`** en las respuestas de navegación.

---

## 3. Modelo de datos

**No hay tablas nuevas, ni columnas nuevas, ni asociaciones nuevas.** Este spec reutiliza íntegro el modelo `VaccineWhodrug` de `src/models/vaccineWhodrug.model.ts` que entregó el [SPEC F18](./18-vaccinewhodrug-crud.md). No se toca `esaviapp.sql`.

### 3.1 Las cinco columnas del árbol

Todas de `vaccineWhodrug` (`esaviapp.sql:561-599`), todas **nullable**:

| Nivel | Columna | Tipo | Nulo | Parámetro de query |
|---|---|---|---|---|
| 1 | `abbreviation` | `varchar(250)` | sí | `abbreviation` |
| 2 | `drugName` | `text` | **no** | `drugName` |
| 3 | `maHolders` | `text` | sí | `maHolders` |
| 4 | `formTranslations` | `text` | sí | `formTranslations` |
| 5 | `strength` | `text` | sí | `strength` |

**Los parámetros de query se llaman exactamente como las columnas.** El backend externo llama `forms` al parámetro que filtra `formTranslations` (`vaccinesWhodrug.js:328`, `:341`) y `country` al que filtra `iso3Code`. Aquí no: el valor que devuelve un nivel es el que se reenvía al siguiente con el mismo nombre, y ese nombre es el de la columna. La única excepción es `country`, que se conserva por legibilidad y filtra `iso3Code` — está documentada en §6.

**El nivel 4 agrupa por `formTranslations`, no por `form`.** Es lo que hace el externo (`:241`, `:283`) y es la columna que el usuario lee. `form` no se expone en la navegación.

**`drugName` es la única columna `NOT NULL` de las cinco.** Las otras cuatro admiten nulo, y además el importador del F19 puede dejar cadena vacía donde el fichero traía una celda en blanco. §3.5 declara cómo se tratan.

### 3.2 Modelo Sequelize

Sin cambios. No se añade ninguna asociación: la entidad sigue sin ninguna clave foránea saliente, que es la razón por la que no tiene archivo en `src/models/associations/`.

### 3.3 Tipos

En `src/types/catalog/vaccineWhodrug.types.ts`, junto a los del F18, y exportados por su barril:

```ts
// Los cinco niveles del árbol, en orden. El orden del array es la jerarquía
export type VaccineWhodrugTreeLevel =
    'abbreviation' | 'drugName' | 'maHolders' | 'formTranslations' | 'strength';

// Filtros comunes a los cinco endpoints. Cada nivel exige su padre inmediato en el
// validador, no en el tipo: aquí todos son opcionales porque el nivel 1 no tiene padre
export interface VaccineWhodrugTreeFilters {
    country?: string;
    language?: string;
    search?: string;
    abbreviation?: string;
    drugName?: string;
    maHolders?: string;
    formTranslations?: string;
}

// Una opción del nivel. value es null cuando el grupo es el de las filas sin valor;
// vaccineWhodrugId solo viaja resuelto cuando matchCount === 1
export interface VaccineWhodrugTreeOption {
    value: string | null;
    matchCount: number;
    vaccineWhodrugId: string | null;
}

export interface VaccineWhodrugTreeResult {
    count: number;
    total: number;
    options: VaccineWhodrugTreeOption[];
}
```

No hay `CreateInput` ni `UpdateInput`: las cinco operaciones son `GET`.

### 3.4 Superficie HTTP

```
GET /api/whodrug-vaccines/abbreviations       ESAVI-WHODRUG-006A  USER  (nuevo)
GET /api/whodrug-vaccines/drug-names          ESAVI-WHODRUG-006B  USER  (nuevo)
GET /api/whodrug-vaccines/ma-holders          ESAVI-WHODRUG-006C  USER  (nuevo)
GET /api/whodrug-vaccines/forms               ESAVI-WHODRUG-006D  USER  (nuevo)
GET /api/whodrug-vaccines/strengths           ESAVI-WHODRUG-006E  USER  (nuevo)

GET /api/whodrug-vaccines                     ESAVI-WHODRUG-002A  USER  (existe)
GET /api/whodrug-vaccines/admin               ESAVI-WHODRUG-002B  ADMIN (existe)
GET /api/whodrug-vaccines/:id                 ESAVI-WHODRUG-003   USER  (existe)
```

**Las cinco rutas son literales y se declaran antes de `GET /:id`** en `src/routes/vaccineWhodrug.routes.ts`, junto a `/admin`, `/activate/:id` e `/import`. Si se declaran después, Express captura `abbreviations` como un `:id` y `vaccineWhodrugIdValidator` responde 400 en vez de listar.

**El sexto endpoint que el usuario pidió —«obtener toda la información de la vacuna por su Id»— ya existe** y es el `ESAVI-WHODRUG-003`. No se toca. Es el destino natural del `vaccineWhodrugId` que devuelve una opción con `matchCount === 1`.

**Parámetros por endpoint.** El padre inmediato es obligatorio; los ancestros superiores son opcionales y acotan si llegan.

| Endpoint | Obligatorio | Opcionales |
|---|---|---|
| `006A` `/abbreviations` | — | `country`, `language`, `search` |
| `006B` `/drug-names` | `abbreviation` | `country`, `language`, `search` |
| `006C` `/ma-holders` | `drugName` | `abbreviation`, `country`, `language`, `search` |
| `006D` `/forms` | `maHolders` | `drugName`, `abbreviation`, `country`, `language`, `search` |
| `006E` `/strengths` | `formTranslations` | `maHolders`, `drugName`, `abbreviation`, `country`, `language`, `search` |

La falta del padre inmediato la resuelve `express-validator` con `.notEmpty()` y `validateFields` responde **400** con el envoltorio de error estándar. No hay clave i18n para ese caso: es un error de validación de entrada, no una regla de negocio.

### 3.5 Reglas de negocio por operación

Las cinco operaciones comparten regla; solo cambian la columna que agrupan y el padre que exigen.

#### El subconjunto base — idéntico en los cinco niveles

```
isActive = true
AND (
      iso3Code = :country                      -- solo si country viaja
   OR ( iso3Code IS NULL
        AND language = :language
        AND isPreferred = true )
)
```

- **`isActive = true`, siempre.** Sin excepción y sin variante para administradores. Es la diferencia con el `002A`/`002B`, y la razón está en §2 y en §6.
- **`country` es opcional.** Cuando no viaja, la primera rama del `OR` desaparece y queda solo el subconjunto genérico preferido. Es exactamente lo que hace el externo cuando `req.query.country` es cadena vacía (`vaccinesWhodrug.js:8`), pero aquí es una condición ausente, no una comparación contra `''`.
- **`language` sale de `?language=`, y si no viaja, de `req.lang`.** El externo lo tiene fijado a `'es'` en las cinco consultas. `req.lang` ya está resuelto por `languageMiddleware` contra `SUPPORTED_LANGUAGES`, así que el valor siempre es uno de `es`, `en` o `nl`.
- **`isPreferred = true`,** no `= 1`: la columna es `boolean` en este esquema, mientras que en el backend externo es `SMALLINT` (`VaccinesWhoDrug.js:92`).
- **Toda la cláusula va entre paréntesis** y se combina con `Op.and` frente a los filtros de ancestro y de `search`. El `OR` del externo es el error más fácil de reproducir mal: si se aplana, el fallback genérico se traga los filtros de nivel.

#### Los filtros de ancestro

Igualdad exacta, `Op.eq`, sobre la columna correspondiente. El valor no se normaliza ni se pasa por `iLike`: procede de la respuesta del nivel anterior, así que coincide carácter a carácter con lo guardado.

**El centinela `__NULL__`.** Cuando un ancestro llega con el valor literal `__NULL__`, la condición **no** es igualdad sino `{ [Op.or]: [{ columna: null }, { columna: '' }] }`. Es lo que devuelve al camino las filas cuya opción del nivel anterior era `value: null`. `__NULL__` no aparece en el diccionario WHODrug y por eso puede reservarse.

#### La agrupación

Una sola consulta por petición, con `findAll` de Sequelize —nunca `sequelize.query` con interpolación—, agrupando por la columna del nivel:

- **Se agrupa por `NULLIF(columna, '')`**, no por la columna cruda. El importador del F19 deja cadena vacía donde el fichero traía celda en blanco, y sin el `NULLIF` esa cadena sería una opción distinta de `null` en la misma lista, con el mismo aspecto vacío en pantalla y contadores partidos.
- **`matchCount` es `COUNT(*)` del grupo,** convertido a `int`. Postgres devuelve `bigint` y el driver lo entrega como cadena; si no se convierte, la respuesta JSON trae `"matchCount": "3"` y el `=== 1` del frontend falla en silencio.
- **`vaccineWhodrugId` se resuelve en la misma consulta:** `CASE WHEN COUNT(*) = 1 THEN MIN("vaccineWhodrugId"::text) END`. Con un solo elemento en el grupo, el `MIN` es ese elemento. Con más de uno, la expresión es `NULL` y no hay id que dar. Es un literal SQL sin ninguna entrada de usuario dentro.
- **Orden: `ORDER BY 1 ASC NULLS LAST`.** Alfabético ascendente como el externo, con la opción sin valor al final de la lista en vez de encabezarla.

#### `count` y `total`

Se derivan del resultado ya en memoria: `count = options.length`, `total = suma de los matchCount`. **No hay una segunda ni una tercera consulta.** El externo lanza tres (`:10`, `:23`, `:38`); aquí es una.

#### `?search=`

`buildTextSearchConditions(search, [columnaDelNivel])` (`src/helpers/searchConditions.helper.ts:7`), que ya aplica `escapeLike` sobre `%` y `_`. Mínimo 2 caracteres, tope alineado a la columna.

**El `search` no corrompe `matchCount`, y esa es una propiedad que hay que entender antes de tocarlo.** Se filtra por la **misma columna que se agrupa**, de modo que o bien todas las filas de un grupo cumplen la condición o no la cumple ninguna: el filtro descarta grupos enteros, nunca filas sueltas dentro de un grupo. Si algún día se añadiera un `search` sobre una columna distinta de la del nivel, `matchCount` dejaría de significar «filas que cuelgan de esta opción» y la unicidad quedaría mal calculada.

#### Sin resultados

**200 con la lista vacía**, `{ count: 0, total: 0, options: [] }`. El externo devuelve 404 en los cinco niveles (`:57`, `:134`, `:218`, `:309`, `:407`); aquí no, porque una consulta que no encuentra coincidencias no es un error y el resto de listados del repositorio ya responde así.

#### Contrato de update diferencial

**Ninguna de las cinco operaciones escribe.** Son `GET` puros: no hay `UPDATE`, no hay `updatedAt`, no hay entrada en `appDetails` y no hay evento en `sysDetails`. No hay tabla de `candidates` que declarar ni `buildDifferentialUpdate` que invocar. Se deja escrito para que no se lea como olvido: la regla de `references/CONVENTIONS.md` §11 no aplica a este spec porque este spec no toca ninguna fila.

#### Estructura del servicio

Cinco funciones exportadas en `src/services/vaccineWhodrug.service.ts`, una por código de operación, cada una con su comentario `// ESAVI-WHODRUG-006x`:

`getWhodrugAbbreviationsService`, `getWhodrugDrugNamesService`, `getWhodrugMaHoldersService`, `getWhodrugFormsService`, `getWhodrugStrengthsService`.

Las cinco delegan en un helper privado del mismo archivo, `buildTreeLevelQuery(level, filters, lang)`, que construye el `where` y ejecuta la agregación. **Las cinco funciones exportadas se mantienen separadas a propósito:** cada una lleva su propio código en su `esaviLog` y en su `AppError` (`WHODRUG_006A_FETCH_FAILED` … `WHODRUG_006E_FETCH_FAILED`), que es lo que exige la regla de los cinco puntos del código de operación. Un servicio único parametrizado por nivel las colapsaría en un solo código.

### 3.6 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `vaccineWhodrug.optionsSuccess` | 200 de los cinco niveles |
| `vaccineWhodrug.optionsFailed` | 500 de los cinco niveles |

Dos claves para cinco endpoints, no diez: el mensaje que lee el usuario es el mismo —se obtuvieron las opciones— y lo que distingue el nivel es el código de operación, que viaja en el `AppError` y en el log, no en el texto. Van en `src/data/i18n/es.json`, `en.json` y `nl.json`; `tests/i18n/messages.test.ts` exige paridad exacta.

Texto en `es`: `"Opciones de vacunas WHODrug obtenidas exitosamente"` y `"Error al obtener las opciones de vacunas WHODrug. Por favor, inténtelo de nuevo más tarde."`

### 3.7 Forma de la respuesta

Idéntica en los cinco endpoints:

```
{ ok: true, message, data: {
    count,                       // opciones distintas del nivel
    total,                       // filas del subconjunto — la suma de los matchCount
    options: [
        { value, matchCount, vaccineWhodrugId }
    ]
} }
```

Ejemplo de `GET /api/whodrug-vaccines/drug-names?abbreviation=BCG&country=ECU`:

```json
{
  "ok": true,
  "message": "Opciones de vacunas WHODrug obtenidas exitosamente",
  "data": {
    "count": 2,
    "total": 4,
    "options": [
      { "value": "BCG VACCINE", "matchCount": 1, "vaccineWhodrugId": "a3f2…" },
      { "value": "BCG VACCINE SSI", "matchCount": 3, "vaccineWhodrugId": null }
    ]
  }
}
```

Se lee así: hay 2 nombres distintos que suman 4 filas. El primero ya determina una vacuna y el frontend puede ir directo al `003` con ese id; el segundo necesita bajar al nivel de `maHolders`.

**No se devuelve ninguna otra columna.** Ni `drugCode`, ni `atcs`, ni la fila completa: los datos de la vacuna se piden al `ESAVI-WHODRUG-003` cuando ya está determinada. `sysDetails` y `appDetails` no aparecen en ningún caso.

---

## 4. Plan de implementación

1. **Tipos.** `VaccineWhodrugTreeLevel`, `VaccineWhodrugTreeFilters`, `VaccineWhodrugTreeOption` y `VaccineWhodrugTreeResult` en `src/types/catalog/vaccineWhodrug.types.ts`, exportados por el barril.
   *Verificación:* `npm run build` compila sin errores.

2. **Claves i18n.** `vaccineWhodrug.optionsSuccess` y `vaccineWhodrug.optionsFailed` en los tres archivos.
   *Verificación:* `npm run i18n:check` sale en 0.

3. **Validadores.** Cinco arrays en `src/validators/vaccineWhodrug.validator.ts`, registrados en el barril, uno por nivel, cada uno con su padre inmediato en `.notEmpty()` y los ancestros en `.optional()`. `search` con mínimo 2 y máximo alineado a la columna; `country` máximo 250; `language` en `isIn(['es','en','nl'])`.
   *Verificación:* `GET /drug-names` sin `abbreviation` responde 400 con el envoltorio `{ ok:false, message, code, errors }`.

4. **Helper privado del servicio.** `buildTreeLevelQuery` en `src/services/vaccineWhodrug.service.ts`: subconjunto base, filtros de ancestro con el centinela `__NULL__`, `search` con `buildTextSearchConditions`, agregación por `NULLIF(columna, '')` con `COUNT(*)::int` y el `CASE WHEN COUNT(*) = 1`, orden `ASC NULLS LAST`, y el cálculo en memoria de `count` y `total`.
   *Verificación:* una consulta directa a la base con los mismos filtros devuelve el mismo número de grupos y la misma suma de filas.

5. **`ESAVI-WHODRUG-006A` — abreviaturas.** `getWhodrugAbbreviationsService`, controlador y ruta literal `GET /abbreviations` declarada antes de `/:id`.
   *Verificación:* el endpoint responde 200 con la lista ordenada; `?search=bc` la acota; `?country=ZZZ` devuelve solo el subconjunto genérico preferido.

6. **`ESAVI-WHODRUG-006B` — nombres.** Igual, exigiendo `abbreviation`.
   *Verificación:* una abreviatura con una sola fila devuelve una opción con `matchCount: 1` y `vaccineWhodrugId` no nulo; ese id responde 200 en `GET /:id`.

7. **`ESAVI-WHODRUG-006C` — titulares.** Igual, exigiendo `drugName`.
   *Verificación:* un `drugName` cuyas filas tengan `maHolders` nulo devuelve una opción con `value: null`, y reenviar `?maHolders=__NULL__` al nivel siguiente recupera esas mismas filas.

8. **`ESAVI-WHODRUG-006D` — formas.** Igual, exigiendo `maHolders`, agrupando `formTranslations`.
   *Verificación:* la suma de los `matchCount` coincide con el `total` del nivel.

9. **`ESAVI-WHODRUG-006E` — potencias.** Igual, exigiendo `formTranslations`.
   *Verificación:* el recorrido completo desde una abreviatura termina en una opción con `matchCount: 1`.

10. **Rutas y `ROUTE_RULES`.** Las cinco rutas en `src/routes/vaccineWhodrug.routes.ts`, con su comentario de código y **antes de `GET /:id`**; las cinco filas en `tests/auth/roles.test.ts` y el total esperado de 325 a 330.
    *Verificación:* `npm test -- tests/auth/roles.test.ts` pasa.

11. **Suite de contrato.** Ampliar `tests/contract/vaccineWhodrug.test.ts` con el recorrido de los cinco niveles sobre filas sembradas, la opción nula, el centinela y el caso sin resultados.
    *Verificación:* `npm run check` sale en 0.

---

## 5. Criterios de aceptación

- [ ] Las cinco rutas de §3.4 responden 200 para `USER` y 401 sin token.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `esaviLog`) coinciden en los cinco endpoints.
- [ ] `grep -rn "ESAVI-WHODRUG-006[^A-E]" src/` no devuelve resultados.
- [ ] Cada uno de los cuatro niveles hijos responde **400** cuando falta su padre inmediato, y **200** cuando llega solo el padre inmediato sin ancestros superiores.
- [ ] En toda respuesta, `count === data.options.length` y `total === suma de los matchCount`.
- [ ] Una opción con `matchCount === 1` trae `vaccineWhodrugId` no nulo, y ese id responde **200** en `GET /api/whodrug-vaccines/:id`.
- [ ] Una opción con `matchCount > 1` trae `vaccineWhodrugId: null`.
- [ ] `matchCount` llega en la respuesta JSON como **número**, no como cadena.
- [ ] Un nivel cuyas filas tienen el valor nulo o vacío devuelve **una sola** opción con `value: null`; reenviarla como `__NULL__` al nivel siguiente recupera exactamente esas filas.
- [ ] La opción `value: null` aparece **al final** de la lista, no al principio.
- [ ] Una fila con `isActive: false` no aparece en ningún nivel ni suma en ningún `matchCount`, ni siquiera para `SUPERADMIN`.
- [ ] Sin `?country=`, la respuesta contiene solo filas con `iso3Code IS NULL`, `isPreferred = true` y el idioma resuelto.
- [ ] Con `?country=` de un país sin filas propias, la respuesta sigue trayendo el subconjunto genérico preferido y ninguna fila de otro país.
- [ ] `?language=en` y `?language=es` sobre el mismo subconjunto genérico devuelven listas distintas; sin `?language=`, manda `req.lang`.
- [ ] `?search=a_b` no se comporta como comodín: el servicio usa `buildTextSearchConditions` y `grep -n "Op.iLike" src/services/vaccineWhodrug.service.ts` no muestra ninguna plantilla construida a mano.
- [ ] `grep -n "sequelize.query" src/services/vaccineWhodrug.service.ts` no devuelve resultados: ninguna consulta interpola la query string.
- [ ] `?search=a` (un carácter) responde 400.
- [ ] Un filtro sin coincidencias responde **200** con `{ count: 0, total: 0, options: [] }`, no 404.
- [ ] Ninguna respuesta de navegación contiene `sysDetails`, `appDetails` ni ninguna columna fuera de `value`, `matchCount` y `vaccineWhodrugId`.
- [ ] `GET /api/whodrug-vaccines/abbreviations` no es capturado por `GET /:id`: la respuesta es la lista, no un 400 de UUID inválido.
- [ ] `ROUTE_RULES` tiene 330 filas y `npm test -- tests/auth/roles.test.ts` pasa.
- [ ] Las dos claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

**Bloque de update diferencial:** no aplica. Las cinco operaciones son `GET` y no escriben ninguna fila; §3.5 lo declara y lo razona.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** `matchCount` por opción. Es la respuesta directa a la pregunta del usuario —«¿esta vacuna ya es única?»—, que el `total` global del backend externo no puede contestar porque agrega todo el nivel.
- **Sí:** conservar `count` y `total` de nivel con la semántica del externo. Cuestan cero consultas extra al derivarse de las opciones, y el frontend actual ya los entiende.
- **Sí:** resolver `vaccineWhodrugId` dentro de la misma consulta con `CASE WHEN COUNT(*) = 1 THEN MIN(...)`. La alternativa —una segunda consulta por opción única— es N+1 en un endpoint de autocompletado.
- **Sí:** cinco rutas explícitas en vez de una genérica con `?level=`. Cada nivel tiene su propio conjunto de parámetros obligatorios, su fila en `ROUTE_RULES` y su código de operación; una ruta genérica los colapsaría en una sola fila y en un solo código.
- **Sí:** cinco funciones de servicio delegando en un helper privado. Conserva el código de operación por endpoint sin duplicar la lógica de agregación cinco veces.
- **Sí:** `NULLIF(columna, '')` en la agrupación. El importador puede dejar cadena vacía; sin el `NULLIF` habría dos opciones visualmente idénticas con los contadores partidos.
- **Sí:** el centinela `__NULL__`. La alternativa —un parámetro booleano por nivel, `?maHoldersIsNull=true`— añade cinco parámetros al contrato para expresar lo mismo, y obliga al frontend a ramificar en vez de reenviar el `value` que recibió.
- **Sí:** los parámetros de query se llaman como las columnas. `forms` para filtrar `formTranslations` era una fuente segura de confusión entre las dos columnas de forma que tiene la tabla.
- **No:** `country` renombrado a `iso3Code`. Se conserva del backend externo: es el nombre que ya usa el frontend y el que un consumidor busca primero. Es la única excepción a la regla anterior y está declarada aquí.
- **No:** replicar el `sequelize.query` con interpolación de cadenas del externo. Son cinco puntos de inyección SQL abiertos a cualquier usuario autenticado.
- **No:** `DISTINCT ON *` devolviendo la fila entera. Los campos que varían dentro del grupo llegarían con el valor de una fila arbitraria y el consumidor no tendría cómo distinguirlos de los que sí representan al grupo.
- **No:** 404 cuando un nivel no tiene opciones. Ningún otro listado del repositorio lo hace y obliga al frontend a tratar como error lo que es una respuesta vacía legítima.
- **No:** variantes `/admin` con filas inactivas. Diez rutas y diez códigos para un caso de uso que el `002B` ya cubre, y una entrada dada de baja no debe poder seleccionarse en un formulario.
- **No:** paginación. Los cinco niveles se consumen como listas desplegables completas; `?search=` cubre el caso de la lista larga. Ver el riesgo de §7.
- **No:** el endpoint de resolución acumulativa con `nextLevel` y `skipped`. Fija en el backend una política de interfaz que el `matchCount` ya permite al frontend decidir por su cuenta.
- **No:** `remaining` por opción con el recuento de cada nivel inferior. Cuatro agregaciones adicionales por petición para una optimización que aún no está medida.
- **No:** índices nuevos sobre las cinco columnas del árbol. Con ~3000 filas el `GROUP BY` secuencial es irrelevante y tocar el DDL afecta a la carga de `esaviapp.sql` en los tests.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| `req.lang` resuelve `nl` y el diccionario cargado no tiene filas en neerlandés: el nivel 1 devuelve la lista vacía y parece una avería | `?language=` permite forzar el idioma sin cambiar el del resto de la sesión; el criterio de aceptación del subconjunto genérico lo cubre. Si se vuelve un problema real, el defecto pasa a ser configurable por `systemConfig`, en su propio spec |
| Sin paginación, `/abbreviations` o `/drug-names` pueden devolver listas largas si el diccionario crece | El diccionario cargado ronda las 3000 filas y las abreviaturas son decenas. `?search=` acota. Si la tabla crece un orden de magnitud, la paginación entra con su propio spec y sin romper el contrato: `count`, `total` y `options` ya tienen la forma correcta para admitirla |
| `GET /:id` captura `abbreviations` como UUID si las rutas nuevas se declaran después | Las cinco son literales y van antes de `/:id`, junto a `/admin`, `/activate/:id` e `/import`; cubierto por un criterio de aceptación y por la suite de contrato |
| `COUNT(*)` llega como cadena desde el driver de Postgres y el `=== 1` del frontend falla en silencio | Conversión explícita a `int` en la agregación, con su propio criterio de aceptación |
| Alguien añade en el futuro un `?search=` sobre una columna distinta de la del nivel y `matchCount` deja de contar el grupo entero | La propiedad está declarada y razonada en §3.5, en el punto de `?search=` |
| Una fila del diccionario con `maHolders` nulo queda inalcanzable por navegación | La opción `value: null` y el centinela `__NULL__` la mantienen alcanzable; hay criterio de aceptación para el recorrido completo sobre ella |

---

## 8. Impacto en el contrato HTTP

Ninguno. Este spec **solo añade** cinco endpoints. No cambia el status, el envoltorio, los parámetros ni la forma de respuesta de ninguna operación existente de `/api/whodrug-vaccines`.

---

## Lo que **no** está en este spec

- El endpoint de resolución acumulativa con `nextLevel` y `skipped`.
- El bloque `remaining` con el recuento de los niveles inferiores por opción.
- Variantes `/admin` de la navegación que incluyan filas inactivas.
- Paginación de los cinco niveles.
- Índices nuevos sobre `abbreviation`, `drugName`, `maHolders`, `formTranslations` o `strength`.
- Un sexto nivel por `noDose` o por `diluent`.
- La búsqueda full-text sobre `IX_vaccineWhodrug_name`.
- Cualquier cambio en `002A`, `002B`, `003`, `004`, `005A`, `005B` o el importador `007`.
- Exponer `sysDetails` o `appDetails` en las respuestas de navegación.

Cada uno de esos, si aterriza, va en su propio spec.
