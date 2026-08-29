# SPEC F45 — Búsqueda de paciente por nombre completo

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F05 (`patient`, `ESAVI-PATIENT-006`), **SPEC F47 (modelo de nombre del paciente)**
> **Fecha:** 2026-08-27
> **Objetivo:** Permitir identificar a un paciente ya registrado cuando no se dispone de ningún documento, usando la coincidencia exacta de sus dos nombres y dos apellidos, sin abrir una vía de enumeración del padrón ni degradar la protección de los datos personales.

---

## Nota de implementación — 2026-08-28

**Este spec no se implementa tal como está.** Queda supeditado al [SPEC F47](47-patient-name-model.md), que se redactó después y cambia el modelo de datos sobre el que este documento se apoya.

El motivo es que el caso de uso real no es el que este spec resolvía. Aquí la búsqueda es la igualdad exacta de los cuatro campos del nombre, de modo que teclear `Torres` no encuentra a `Torres Vega` y el operador acaba creando el duplicado — justo el fallo que §1 dice querer reducir. El F47 sustituye las cuatro columnas de nombre por `names` y `lastNames`, y traslada la búsqueda a una columna de tokens cifrados que sí admite la coincidencia parcial por palabra.

**Qué sobrevive de este documento** y se traslada tal cual al F45 reescrito: el endpoint `ESAVI-PATIENT-007` con rol mínimo `USER`, el `200` con `count: 0` en vez de `404`, la señal `inactiveCount` de coincidencias inactivas (§3.3), el análisis de superficie de enumeración (§3.4) y el criterio de que ninguna ruta del `007` puede terminar en una escritura.

**Qué desaparece:** toda la §3.2 —la semántica de «parámetro vacío significa `IS NULL`»—, que era la parte más frágil del diseño y que el modelo de dos columnas vuelve innecesaria. Y con ella los cuatro query params, que pasan a ser dos.

**Qué cambia:** el `where` deja de ser una conjunción de cuatro igualdades sobre columnas y pasa a comprobar que `nameTokens` contiene todos los tokens de lo tecleado.

El orden de trabajo es F47 primero, y este spec se reescribe encima una vez implementado.

---

## 1. Por qué existe este spec

**El alta de un caso ESAVI empieza por decidir si el paciente ya existe.** El flujo operativo es: buscar al paciente, reutilizarlo si aparece, crearlo si no, y solo entonces abrir el `esaviCase`. Hoy ese primer paso solo funciona si quien captura tiene un identificador en la mano.

`searchPatientsByIdentifierService` (`src/services/patient.service.ts:345`) resuelve la búsqueda con un `Op.or` sobre exactamente tres columnas — `documentNumber`, `passportNumber` y `healthSystemCode` (`patient.service.ts:359-365`). No hay ninguna otra vía de búsqueda: `002A`/`002B` listan y paginan, pero no filtran por nombre. Un paciente que llega sin documento —un menor, un extranjero en tránsito, una persona atendida en una brigada de vacunación rural— no se puede encontrar, y el operador no tiene más opción que crearlo de nuevo.

**La consecuencia es duplicación silenciosa.** El DDL solo protege un identificador: `UQ_patient_documentNumber` (`esaviapp.sql:665`). No hay unicidad por nombre, ni por nombre y fecha de nacimiento. Cada vez que un paciente sin documento vuelve al sistema, nace una fila nueva, y con ella un historial de eventos adversos partido en dos. En farmacovigilancia eso no es un problema de higiene de datos: es la diferencia entre ver un patrón y no verlo.

**La búsqueda es técnicamente posible, y ésa es la razón de que este spec sea corto.** Los cuatro campos de nombre se cifran con `esaviCrypt`, que es determinista y de IV fijo, y se cifran **después** de pasar por `normalizeName` (`patient.service.ts:125-130`), que es `toTitleCase(value.trim())`. Repetir esa misma composición sobre lo que teclea el usuario reproduce byte a byte el texto cifrado almacenado, de modo que la igualdad exacta funciona como cualquier `where`. Es exactamente el mecanismo que el `006` ya usa sobre `documentNumber`. No hace falta descifrar el padrón, ni añadir columnas, ni tocar el esquema.

**Lo que no es posible, y este spec no finge que lo sea.** Con cifrado determinista solo existe la igualdad. No hay `LIKE`, ni prefijo, ni ordenación, ni similitud fonética, ni tolerancia a una letra cambiada. La búsqueda encuentra al paciente cuyos cuatro campos coinciden **exactamente** tras normalizar, y a nadie más. Un apellido tecleado con una letra distinta no devuelve nada. Aceptar esa limitación es la condición para no descifrar nombres en memoria en cada búsqueda, que es la alternativa y es peor.

---

## 2. Alcance

**Dentro:**

- `ESAVI-PATIENT-007` — `GET /api/patients/search-by-name`. Rol mínimo `USER`, el mismo que el `006`. Los cuatro componentes viajan como **query params**, no en la ruta: son cuatro valores con espacios y acentos, y `/search/:a/:b/:c/:d` sería tanto ilegible como frágil ante un apellido vacío.
- **Coincidencia exacta sobre los cuatro campos**, cada uno normalizado con `normalizeName` y cifrado con `esaviCrypt` antes de comparar: `firstName`, `middleName`, `lastName`, `secondLastName`.
- **Respuesta en el formato de lista ya existente** — `{ count, rows }` con `toPatientListRow`, idéntico al del `006`, más el campo `inactiveCount` de §3.3.
- **Resultado vacío es un resultado**: `200` con `count: 0`, nunca `404`. Es la misma decisión que ya tomó el `006` y por la misma razón — un `404` aquí significaría «este paciente no existe», que es justo la afirmación que un endpoint de búsqueda no debe hacer.
- **Señal de coincidencias inactivas** — `data.inactiveCount`, para que un paciente desactivado no se duplique en silencio. Ver §3.3.
- **Extracción de `normalizeName` a `stringHandling.helper.ts`.** Hoy el mismo cuerpo está declarado tres veces: `normalizeName` en `patient.service.ts:20` y en `notifier.service.ts:20`, y `normalizeFullName` en `investigationTeamMember.service.ts:172` — distinto nombre, función idéntica. Este spec la necesita en un cuarto sitio y no va a hacer la cuarta copia. Sube al helper y los tres servicios existentes pasan a importarla — **sin cambiar su comportamiento**, porque cualquier cambio en esa función altera el texto cifrado de filas ya escritas (§4).
- Claves i18n nuevas en `es`, `en` y `nl`.
- Fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts:132-139` y casos nuevos en `tests/contract/patient.test.ts`.

**Fuera de alcance (otros specs, o descartado):**

- **Búsqueda parcial, por prefijo, difusa o fonética.** Incompatible con el cifrado determinista. Habilitarla exige una columna de índice ciego —un hash de un nombre normalizado y desacentuado, o un `blind index` por token— y eso es un spec de esquema propio, con su migración y su repoblado.
- **Unicidad de paciente por nombre.** Cuatro nombres iguales son un homónimo perfectamente posible, no un duplicado. Este spec **encuentra** candidatos; decidir que dos filas son la misma persona es fusión de registros, y es otro spec.
- **Fusión o deduplicación de pacientes ya duplicados.** Ni detección, ni informe, ni fusión. Este spec reduce la duplicación futura; no repara la existente.
- **Reactivar el paciente inactivo que el `007` señala.** El `007` avisa de que existe; reactivarlo sigue siendo el `005B`, con su rol `SUPERADMIN`. Automatizar ese salto es otro spec.
- **Búsqueda combinada con `birthDate` o sexo como desempate.** Se evalúa cuando exista evidencia de que los homónimos son un problema real en el padrón; añadirla ahora es diseño especulativo.
- **Unificar las demás normalizaciones con `toTitleCase` inline.** `user.service.ts:79-80,286-287` e `investigationClinicalEvaluation.service.ts:145` repiten la misma composición con otra firma —el segundo devuelve `null` para el vacío—. No entran: este spec sube exactamente la función de tres líneas idénticas, no emprende una unificación transversal.
- **Cambiar `normalizeName`, `toTitleCase` o el esquema de cifrado.** Ver §4: el defecto conocido de `toTitleCase` con nombres que empiezan por vocal acentuada se documenta aquí, y se corrige en el spec de repoblado que le corresponde.
- **Ampliar el `006` con los nombres**, en vez de un endpoint nuevo. Ver §6.

---

## 3. Modelo de datos

**No hay tablas nuevas, ni columnas nuevas, ni asociaciones nuevas.** El `007` es una operación de solo lectura sobre `patient` — `esaviapp.sql:643-666` — con el modelo y las asociaciones que ya declaró el SPEC F05. Las sub-secciones 3.1 y 3.2 de la plantilla no aplican y se omiten deliberadamente.

Las cuatro columnas que este spec consulta ya existen y su nulabilidad es la que gobierna toda la §3.3:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `firstName` | `text` | sí | cifrada con `esaviCrypt`; `esaviapp.sql:645` |
| `middleName` | `text` | sí | cifrada; `esaviapp.sql:646` |
| `lastName` | `text` | sí | cifrada; `esaviapp.sql:647` |
| `secondLastName` | `text` | sí | cifrada; `esaviapp.sql:648` |

Las cuatro son `text` sin límite y **las cuatro son nulables en el DDL**, incluidas `firstName` y `lastName`: quien exige esas dos es `createPatientService` (`patient.service.ts:125-126`), no el esquema. El tope de 150 caracteres que aplica §3.7 sale de `createPatientValidator`, no de la columna.

### 3.1 Contrato

```
GET /api/patients/search-by-name
    ?firstName=…&lastName=…[&middleName=…][&secondLastName=…][&limit=&offset=]
```

`ESAVI-PATIENT-007`, rol mínimo `USER`.

Cada uno de los cuatro se normaliza con `normalizeName` y se cifra con `esaviCrypt`; el `where` es la conjunción de las cuatro igualdades, más el filtro de `isActive` que ya gobierna `canViewInactive`. Se resuelve con `findAndCountAll`, `LIST_ATTRIBUTES`, los mismos `include` de sexo y residencia, el mismo `LIST_ORDER` y la misma paginación que el `006`.

**No hay parámetro `includeInactive`.** La visibilidad de las filas inactivas la decide `canViewInactive(req.user)` en el controlador, exactamente como en el `006` (`patient.controller.ts:127`). Un query param sería una segunda vía de decidir lo mismo.

### 3.2 Los campos nulos, que es la decisión que importa

`middleName` y `secondLastName` son **nullable** en el DDL (`esaviapp.sql:646,648`). Un paciente con un solo apellido tiene `secondLastName: NULL`, y `NULL = <cualquier cosa>` es `NULL` en SQL: una búsqueda que exija los cuatro no lo encontrará jamás, por bien tecleado que esté.

La regla de este spec: **el parámetro ausente o vacío se traduce en `IS NULL`, no en «ignórame».** Buscar sin `secondLastName` significa *«pacientes cuyo segundo apellido está vacío»*, no *«pacientes con cualquier segundo apellido»*. Es lo que hace que la búsqueda siga siendo exacta y su resultado, interpretable.

En Sequelize eso es literal: `where: { secondLastName: null }` genera `"secondLastName" IS NULL`. El servicio no construye SQL a mano.

Consecuencia que el frontend debe conocer y mostrar: los cuatro campos del formulario se envían siempre, y dejar uno en blanco es una afirmación sobre el paciente, no una omisión. Un resultado vacío tras dejar el segundo apellido en blanco no significa que el paciente no exista; puede significar que sí tiene segundo apellido registrado.

**Mínimo exigido:** `firstName` y `lastName` son obligatorios. Sin ellos la consulta degenera en «todos los pacientes con dos campos nulos», que es un volcado del padrón con otro nombre. Devuelve `400`.

La comprobación vive en dos sitios a propósito. El validador rechaza el vacío y el solo-espacios con el `400` estándar de `validateFields`. El servicio la repite y lanza `PATIENT_007_NAME_REQUIRED`: un servicio que confía en su validador deja de ser invocable desde otro servicio sin heredar el agujero.

### 3.3 Coincidencias inactivas — `inactiveCount`

Un paciente desactivado que reaparece debe reactivarse, no duplicarse. Pero el operador con rol `USER` no ve filas inactivas, así que sin ninguna señal su búsqueda devuelve vacío y él crea el duplicado: exactamente el fallo que este spec existe para reducir.

La respuesta lleva por eso un tercer campo junto a `count` y `rows`:

**`inactiveCount`** — número total de filas que coinciden con los cuatro nombres y tienen `isActive: false`. Se calcula con un `Patient.count` propio sobre el mismo `where` de nombres más `isActive: false`, **sin paginar**, y se devuelve siempre, con independencia del rol.

Lo que significa en cada caso:

- **`USER`** — `rows` solo trae activos. `{ count: 0, rows: [], inactiveCount: 1 }` le dice «hay un registro desactivado que coincide; pide su reactivación en vez de crear otro».
- **`ADMIN` y superiores** — `canViewInactive` es verdadero, así que las filas inactivas ya vienen en `rows`. `inactiveCount` es entonces un desglose de `count`, no información adicional.

El campo es un **número, nunca una fila**: no expone ni el `patientId`, ni el documento, ni la fecha de nacimiento del paciente desactivado. Lo único que revela es la existencia de una coincidencia, a alguien que ya tecleó los cuatro componentes exactos del nombre — la misma exposición que §3.4 ya acepta para las filas activas.

**Coste:** una consulta `COUNT` extra por búsqueda. Se declara aquí porque no es gratis: las columnas cifradas no tienen índice, así que son dos recorridos de tabla donde el `006` hace uno. Se acepta a cambio de la señal; si el volumen lo convierte en un problema, la solución es el índice ciego de §2, no quitar el campo.

### 3.4 Superficie de enumeración

Un endpoint que confirma la existencia de una persona por su nombre es, por construcción, consultable en masa. Tres medidas, todas dentro del alcance:

- **Autenticado y con rol `USER` mínimo**, igual que el `006`. No hay superficie anónima.
- **Sin comodines y sin resultados parciales.** Sin igualdad exacta de cuatro campos no hay forma de barrer el padrón probando prefijos.
- **`limit` acotado** por `patientListValidator` — entero entre 1 y 100. Un homónimo cuádruple es una rareza y una página basta.

Queda anotado como riesgo aceptado: un usuario legítimo que ya conoce el nombre completo de una persona puede confirmar si está en el sistema. Es inherente a la función que se pide y es la misma exposición que ya concede el `006` a quien conoce un número de documento.

### 3.5 Tipos

`src/types/patient/patient.types.ts`, junto a `CreatePatientInput`, con su alta ya cubierta por el barrel existente:

```ts
export interface PatientNameSearchInput {
    firstName: string;
    lastName: string;
    middleName?: string | null;
    secondLastName?: string | null;
}
```

Los dos opcionales son **anulables a propósito**: `undefined`, `null` y `''` son el mismo caso — «este paciente no tiene ese componente» — y el servicio los colapsa en `null` antes de construir el `where`. No hay un cuarto significado.

### 3.6 Superficie HTTP y reglas de negocio

```
GET    /api/patients                         ESAVI-PATIENT-002A   USER        (existe)
GET    /api/patients/admin                   ESAVI-PATIENT-002B   ADMIN       (existe)
PATCH  /api/patients/activate/:id            ESAVI-PATIENT-005B   SUPERADMIN  (existe)
GET    /api/patients/search/:identifier      ESAVI-PATIENT-006    USER        (existe)
GET    /api/patients/search-by-name          ESAVI-PATIENT-007    USER        (nuevo)
GET    /api/patients/:id                     ESAVI-PATIENT-003    USER        (existe)
```

**Orden de declaración.** `search-by-name` se declara **antes** de `GET /:id` (`patient.routes.ts:51`), por la misma razón que ya obligó a colocar allí `/admin`, `/activate/:id` y `/search/:identifier`: Express capturaría `search-by-name` como un `:id`, `patientIdValidator` exigiría un UUID y el cliente recibiría un 400 desconcertante en vez de su búsqueda. No colisiona con `/search/:identifier`: son dos segmentos literales distintos.

**`ESAVI-PATIENT-007` — buscar por nombre completo.**

1. `firstName` y `lastName`, tras `.trim()`, no pueden ser vacíos → `400 PATIENT_007_NAME_REQUIRED`, mensaje `patient.nameRequired`.
2. Los cuatro se normalizan con `normalizeName` y se cifran con `esaviCrypt`. Los dos opcionales, cuando llegan vacíos, se traducen en `null` — que es `IS NULL` (§3.2), no una igualdad contra la cadena vacía cifrada.
3. `findAndCountAll` con el `where` de los cuatro campos, más `isActive: true` cuando `canViewInactive` es falso. `attributes: LIST_ATTRIBUTES`, `include: [SEX_INCLUDE, LIST_RESIDENCE_INCLUDE]`, `order: LIST_ORDER`, `limit` y `offset`.
4. `Patient.count` sobre el mismo `where` de nombres más `isActive: false` → `inactiveCount` (§3.3).
5. Un resultado vacío **no es un error**: 200 con `count: 0`. Nunca 404.

**Firma del servicio** — `src/services/patient.service.ts`, junto a `searchPatientsByIdentifierService`:

```ts
const searchPatientsByNameService = async (
    input: PatientNameSearchInput,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => { /* devuelve { count, inactiveCount, rows } */ }
```

**Este spec no declara contrato de update diferencial, y la ausencia es deliberada.** El `007` no escribe sobre ninguna fila: no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`. La tabla de `candidates` y el bloque de cinco criterios que la plantilla exige para las escrituras no aplican aquí. Lo que sí se verifica, en §5, es justamente que ninguna ruta del `007` termine en una escritura.

### 3.7 Validador

`patientNameSearchValidator` en `src/validators/patient.validator.ts`, exportado por el barrel existente. Se compone en la ruta **junto a** `patientListValidator`, que ya cubre `limit` y `offset`.

| Campo | Regla | Mensaje |
|---|---|---|
| `query('firstName')` | `.trim().notEmpty()` | `First Name is required` |
| `query('firstName')` | `.isLength({ max: 150 })` | `First Name must be at most 150 characters long` |
| `query('lastName')` | `.trim().notEmpty()` | `Last Name is required` |
| `query('lastName')` | `.isLength({ max: 150 })` | `Last Name must be at most 150 characters long` |
| `query('middleName')` | `.optional().trim().isLength({ max: 150 })` | `Middle Name must be at most 150 characters long` |
| `query('secondLastName')` | `.optional().trim().isLength({ max: 150 })` | `Second Last Name must be at most 150 characters long` |

Los dos opcionales **no llevan `notEmpty`**: la cadena vacía es un valor legítimo y significa `IS NULL` (§3.2). Los `max: 150` replican los de `createPatientValidator`, que es de donde sale ese tope — las columnas son `text` y no imponen ninguno. Un valor más largo que el que el create admite no puede coincidir con nada guardado, así que no merece llegar a la base de datos.

### 3.8 Claves i18n nuevas

Reutiliza `patient.getSuccessPlural`, `patient.getFailedPlural` y `patient.searchEmpty`, que ya existen en los tres idiomas. Se añaden dos, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `patient.nameRequired` | 400 cuando falta `firstName` o `lastName` (§3.2) |
| `patient.searchEmptyInactive` | 200 con `count: 0` e `inactiveCount > 0` (§3.3) |

Texto propuesto:

| Clave | `es` | `en` | `nl` |
|---|---|---|---|
| `nameRequired` | El nombre y el apellido del paciente son obligatorios para la búsqueda | First name and last name are required for the search | Voornaam en achternaam zijn verplicht voor de zoekopdracht |
| `searchEmptyInactive` | No existen resultados activos, pero sí registros desactivados que coinciden | There are no active results, but there are deactivated records that match | Er zijn geen actieve resultaten, maar er zijn wel gedeactiveerde records die overeenkomen |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.9 Forma de la respuesta

```
{ ok, message, data: {
    count,
    inactiveCount,
    rows: [ {
        patientId, firstName, lastName, documentNumber, birthDate,
        healthSystemCode, isActive,
        sex: { catalogItemId, code, name },
        residence: { geoLocationId, name }
    } ]
} }
```

`rows` es exactamente lo que produce `toPatientListRow`, con las tres columnas cifradas ya descifradas. Las filas inactivas se filtran salvo que `canViewInactive(req.user)` sea verdadero.

El `message` se resuelve en el controlador con las tres claves deletreadas literalmente, para que `i18n:check` pueda verificarlas de forma estática — es el mismo patrón del `006` (`patient.controller.ts:131-133`):

| Condición | Clave |
|---|---|
| `count > 0` | `patient.getSuccessPlural` |
| `count === 0` y `inactiveCount > 0` | `patient.searchEmptyInactive` |
| `count === 0` y `inactiveCount === 0` | `patient.searchEmpty` |

---

## 4. `normalizeName` es la superficie de riesgo real

Extraer la función al helper es refactor. **Modificarla no lo es**, y este spec lo deja escrito para que nadie lo descubra en producción:

`normalizeName` corre **antes** del cifrado, así que forma parte de la identidad almacenada. El texto cifrado de una fila escrita hoy es `esaviCrypt(toTitleCase(input.trim()))`. Cambiar `toTitleCase` —añadir desacentuado, cambiar el manejo de guiones o de partículas como *de la*— **no migra nada**: las filas viejas conservan el cifrado viejo, las nuevas nacen con otro distinto, y este endpoint deja de encontrar a los pacientes anteriores al cambio. El fallo es silencioso: no hay error, solo resultados vacíos.

**Defecto conocido, verificado, y no corregido aquí.** `toTitleCase` (`stringHandling.helper.ts:71`) usa `/\w\S*/g`, y `\w` sin la bandera `u` no incluye vocales acentuadas. Sobre un nombre que empieza por una de ellas, la primera coincidencia no es la primera letra: `"Ángel"` produce `"ÁNgel"` y `"ángel"` produce `"áNgel"`. Son dos textos cifrados distintos para lo que el usuario considera el mismo nombre, y la búsqueda solo encuentra el que coincide con cómo se tecleó al crear la fila.

No se corrige en este spec porque arreglar la función invalida el cifrado de todas las filas afectadas. Corresponde a un spec de **normalización y repoblado** que descifre, renormalice y recifre los cinco campos de `patient` —y los equivalentes de `notifier`, `investigationTeamMember` y `appUser`— en una sola pasada transaccional. Ese spec es prerrequisito de cualquier mejora de esta búsqueda, y sería el momento natural de introducir el índice ciego desacentuado que habilitaría la búsqueda parcial que §2 deja fuera.

Mientras tanto, la mitigación es del frontend: mostrar el nombre tal como se registró en los resultados, para que el operador vea por qué su búsqueda falló.

**El Paso 1 del plan es, por eso, el paso delicado del spec.** Mueve código sin cambiar ni un carácter del cuerpo de la función. Su verificación no es que compile: es que el cifrado de un nombre ya guardado siga siendo byte a byte el mismo.

---

## 5. Plan de implementación

Nueve pasos. Cada uno deja el proyecto compilando y arrancable, y cada uno es committeable por separado.

1. **Extraer `normalizeName` a `stringHandling.helper.ts`.** Se declara `export const normalizeName = (value: string): string => toTitleCase(value.trim());` con el cuerpo **idéntico**, y se borran las tres copias locales: `patient.service.ts:20`, `notifier.service.ts:20` y `normalizeFullName` en `investigationTeamMember.service.ts:172` — en este último se renombran también sus llamadas. Los tres servicios pasan a importar del barrel `../helpers`, que ya reexporta el archivo (`helpers/index.ts:16`). No se toca `toTitleCase`.
   *Verificación:* `grep -rn "const normalizeName\|const normalizeFullName" src/services/` no devuelve nada; `npm run build` y `npm test` salen en 0 con las suites de `patient`, `notifier` e `investigationTeamMember` en verde, que es lo que prueba que el cifrado no se movió.

2. **Tipo `PatientNameSearchInput`.** En `src/types/patient/patient.types.ts`, tal como está en §3.5.
   *Verificación:* `npm run build` en 0; el tipo se importa desde `../types` sin alta adicional en ningún barrel.

3. **Claves i18n.** `patient.nameRequired` y `patient.searchEmptyInactive` en los tres archivos, con los textos de §3.8.
   *Verificación:* `npm run i18n:check` sale en 0 y `tests/i18n/messages.test.ts` pasa.

4. **`patientNameSearchValidator`.** En `src/validators/patient.validator.ts`, con las seis reglas de §3.7. El barrel ya lo exporta (`validators/index.ts:12`).
   *Verificación:* `npm run build` y `npm run lint` en 0.

5. **`searchPatientsByNameService`.** Firma de §3.6. Guarda de nombre obligatorio, normalización y cifrado de los cuatro, `where` conjuntivo con `null` para los ausentes, `findAndCountAll` con `LIST_ATTRIBUTES` y el `Patient.count` de `inactiveCount`. Se exporta en el bloque final del archivo. Comentario con el código de operación sobre la función.
   *Verificación:* buscar los cuatro nombres exactos de un paciente sembrado devuelve `count: 1`; cambiar una letra del apellido devuelve `count: 0`.

6. **`searchPatientsByName` — controlador.** En `src/controllers/patient.controller.ts`. Lee los cuatro de `req.query`, `limit` y `offset` como ya hacen los demás, pasa `canViewInactive(req.user as AuthUser)`, y resuelve el `message` con las tres claves deletreadas de §3.9. `catch` con el idioma del repositorio: `esaviLog` con el código, `next(error)` si ya es `AppError`, y si no `new AppError(getMessage('patient.getFailedPlural', req.lang), 500, 'PATIENT_007_SEARCH_FAILED', error)`.
   *Verificación:* `npm run build` en 0; el controlador no importa ningún modelo.

7. **Ruta.** `router.get('/search-by-name', tokenValidation, validateUserRole(USER), ...patientNameSearchValidator, ...patientListValidator, validateFields, searchPatientsByName)` en `src/routes/patient.routes.ts`, declarada **antes** de `GET /:id`.
   *Verificación:* `GET /api/patients/search-by-name?firstName=X&lastName=Y` responde 200 y no un 400 de UUID inválido.

8. **`ROUTE_RULES`.** Fila nueva en `tests/auth/roles.test.ts`, entre el `006` y el `003`, respetando el orden de declaración: `{ method: 'get', path: '/api/patients/search-by-name?firstName=A&lastName=B', minRole: 'USER', code: 'ESAVI-PATIENT-007' }`.
   *Verificación:* `tests/auth/roles.test.ts` pasa; sin token responde 401 y con rol `ANALYTICS` responde 403.

9. **Casos de contrato.** En `tests/contract/patient.test.ts`, junto al helper `searchPatients` ya existente, se añade un `searchPatientsByName`. Cubre: coincidencia exacta de los cuatro; coincidencia con `secondLastName` vacío contra un paciente que lo tiene `NULL`; el mismo paciente **no** encontrado cuando se manda un `secondLastName` que no tiene; búsqueda sin `lastName` → 400; una letra distinta → `count: 0`; y el paciente desactivado que devuelve `count: 0` con `inactiveCount: 1` para `USER`.
   *Verificación:* `npm test` en 0.

---

## 6. Criterios de aceptación

- [ ] `GET /api/patients/search-by-name?firstName=…&lastName=…` responde 200 con `{ count, inactiveCount, rows }`.
- [ ] Los cuatro nombres exactos de un paciente sembrado devuelven `count: 1`, y sus `rows[0]` traen `firstName` y `lastName` en claro.
- [ ] Cambiar una sola letra de `lastName` devuelve 200 con `count: 0`, nunca 404.
- [ ] Un paciente con `secondLastName: NULL` se encuentra **sin** mandar `secondLastName`, y **no** se encuentra mandando uno cualquiera.
- [ ] Un paciente con `secondLastName` guardado **no** se encuentra dejando el parámetro en blanco.
- [ ] Omitir `lastName` responde 400; omitir ambos también.
- [ ] Un `lastName` de solo espacios responde 400 y no un 200 con el padrón entero.
- [ ] Un paciente desactivado devuelve, para `USER`, `count: 0` con `inactiveCount: 1` y el mensaje de `patient.searchEmptyInactive`.
- [ ] Ese mismo paciente aparece en `rows` para `ADMIN`, con `inactiveCount: 1` como desglose.
- [ ] Sin token responde 401; con rol `ANALYTICS` responde 403.
- [ ] `GET /api/patients/search-by-name` **no** es capturada por `GET /:id`: la respuesta no es un 400 de UUID inválido.
- [ ] Los cinco puntos del código de operación coinciden: comentario en ruta, en controlador, en servicio, código del `AppError` (`PATIENT_007_*`) y mensaje de `esaviLog`. `grep -rn "ESAVI-PATIENT-007" src/` devuelve exactamente esas apariciones.
- [ ] **El `007` no escribe**: tras cien búsquedas, el `appDetails` del paciente encontrado no crece, su `updatedAt` no se mueve y `sysDetails.version` no avanza. `grep -n "007" src/services/patient.service.ts` no aparece junto a ningún `.update(`, `.create(` ni `transaction`.
- [ ] `grep -rn "const normalizeName\|const normalizeFullName" src/services/` no devuelve resultados.
- [ ] El cifrado no se movió: un paciente creado **antes** del Paso 1 se sigue encontrando por nombre después de él, y su columna `firstName` es byte a byte la misma.
- [ ] Las dos claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 7. Decisiones tomadas y descartadas

- **Sí:** endpoint nuevo `007` en vez de ampliar el `006`. El `006` es un `Op.or` sobre tres identificadores intercambiables que un usuario teclea en una sola caja; éste es un `Op.and` sobre cuatro campos con semántica de nulos propia y un mínimo obligatorio. Meterlos en la misma firma produce un servicio con dos modos que no comparten nada salvo el `findAndCountAll`.
- **Sí:** query params. Cuatro valores con espacios, acentos y posibles vacíos no caben con dignidad en segmentos de ruta.
- **Sí:** el campo vacío significa `IS NULL`. La alternativa —ignorar el campo ausente— convierte la búsqueda exacta en una búsqueda por subconjunto cuyo resultado el operador no puede interpretar, y reabre la enumeración por barrido.
- **Sí:** `firstName` y `lastName` obligatorios. Sin mínimo, el endpoint es un listado del padrón.
- **Sí:** `inactiveCount` como número, siempre presente. Resuelve el pendiente que este spec arrastraba: sin señal, el `USER` que no ve inactivos duplica al paciente desactivado, que es el fallo que el spec existe para reducir. Un número no contradice `canViewInactive` —no entrega ninguna fila ni ningún campo— y su fuga es la que §3.4 ya acepta.
- **Sí:** validar el mínimo dos veces, en el validador y en el servicio. Duplicación barata frente a un servicio invocable desde otro servicio sin su cadena de middlewares.
- **No:** exponer las filas inactivas a cualquier `USER`. Resolvería lo mismo contradiciendo el mecanismo de visibilidad de todo el repositorio, y por una entidad que es precisamente la más sensible del esquema.
- **No:** un query param `includeInactive`. Sería una segunda vía de decidir lo que `canViewInactive` ya decide, y las dos podrían discrepar.
- **No:** descifrar el padrón en memoria para comparar sin distinguir mayúsculas ni acentos. Es correcto funcionalmente y ruinoso en todo lo demás: lee la tabla entera en cada búsqueda y expone en memoria del proceso justo los datos que el cifrado protege.
- **No:** `birthDate` como quinto criterio en esta entrega. Ver §2.
- **No:** tocar `toTitleCase`. Ver §4.
- **No:** unificar en el helper las otras variantes de la normalización (`user.service.ts`, `investigationClinicalEvaluation.service.ts`). Tienen otra firma y otro tratamiento del vacío; unificarlas es un refactor transversal con riesgo de cifrado propio, y no es lo que este spec necesita.

---

## 8. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Tocar `toTitleCase` al mover `normalizeName` invalida el cifrado de las filas existentes; el fallo es silencioso | El Paso 1 mueve el cuerpo sin alterarlo, y el criterio de §6 comprueba que un paciente anterior al cambio se sigue encontrando |
| `GET /:id` captura `search-by-name` como UUID | La ruta literal se declara antes de `/:id`; cubierto por un criterio de aceptación propio |
| El `COUNT` extra de `inactiveCount` duplica el recorrido de tabla sobre columnas sin índice | Declarado en §3.3; si el volumen lo hace notar, la salida es el índice ciego de §2, no quitar el campo |
| Un operador interpreta el campo en blanco como «no filtres por esto» y concluye que el paciente no existe | §3.2 lo declara contrato explícito; la mitigación es del frontend, que envía siempre los cuatro campos y lo explica en el formulario |
| Un nombre con vocal acentuada inicial no se encuentra según cómo se tecleó al crearlo | Defecto conocido de §4; se corrige en el spec de repoblado, no aquí. El frontend muestra el nombre tal como se registró |

---

## 9. Impacto en el contrato HTTP

**Nulo para los clientes existentes.** El `007` es un endpoint nuevo; ninguna ruta actual cambia de status, de forma de `data` ni de mensaje. El único cambio sobre código ya escrito —subir `normalizeName` al helper— es de comportamiento idéntico por construcción, y §6 lo verifica como tal.

---

## Lo que **no** está en este spec

- Búsqueda parcial, por prefijo, difusa o fonética.
- Unicidad de paciente por nombre.
- Detección, informe o fusión de pacientes ya duplicados.
- Reactivar el paciente inactivo que `inactiveCount` señala.
- `birthDate` o sexo como criterio de desempate.
- Corregir `toTitleCase` o repoblar las columnas cifradas.
- Ampliar el `006` con los nombres.

Cada uno de esos, si aterriza, va en su propio spec.
