# SPEC F45 — Búsqueda de paciente por nombre

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F05 (`patient`, `ESAVI-PATIENT-006`), **SPEC F47 (modelo de nombre del paciente, implementado)**
> **Fecha:** 2026-08-29 — reescritura completa sobre el modelo del SPEC F47
> **Objetivo:** Permitir identificar a un paciente ya registrado cuando no se dispone de ningún documento, buscando por las palabras de su nombre contra el índice de tokens cifrados que el SPEC F47 dejó construido.

---

## Nota de reescritura — 2026-08-29

**Este documento sustituye por completo al que llevaba este número.** La versión anterior —fechada el 2026-08-27— resolvía la búsqueda con la igualdad exacta de cuatro columnas de nombre: `firstName`, `middleName`, `lastName`, `secondLastName`. Esas cuatro columnas ya no existen. El [SPEC F47](47-patient-name-model.md), redactado después y **hoy implementado**, las fusionó en `names` y `lastNames` y añadió `nameTokens`, la columna de tokens cifrados con índice GIN que este spec consume.

Lo que se conserva del documento anterior: el endpoint `ESAVI-PATIENT-007` con rol mínimo `USER`, el `200` con `count: 0` en vez de `404`, la señal `inactiveCount` (§3.3), el análisis de superficie de enumeración (§3.4) y el criterio de que ninguna ruta del `007` puede terminar en una escritura.

Lo que desaparece: la semántica de «parámetro vacío significa `IS NULL`», el tipo `PatientNameSearchInput` y la extracción de `normalizeName` al helper —que el F47 ya hizo (`stringHandling.helper.ts:82`)—.

Lo que cambia respecto a lo que el propio F47 §9 anticipaba: **no son dos query params, es uno.** La razón está en §4 y es el único punto donde este spec se aparta de lo que aquel documento dejó previsto.

---

## 1. Por qué existe este spec

**El alta de un caso ESAVI empieza por decidir si el paciente ya existe.** El flujo operativo es: buscar al paciente, reutilizarlo si aparece, crearlo si no, y solo entonces abrir el `esaviCase`. Hoy ese primer paso solo funciona si quien captura tiene un identificador en la mano.

`searchPatientsByIdentifierService` (`src/services/patient.service.ts:369`) resuelve la búsqueda con un `Op.or` sobre exactamente tres columnas — `documentNumber`, `passportNumber` y `healthSystemCode`. No hay ninguna otra vía: `002A`/`002B` listan y paginan, pero no filtran por nombre. Un paciente que llega sin documento —un menor, un extranjero en tránsito, una persona atendida en una brigada de vacunación rural— no se puede encontrar, y el operador no tiene más opción que crearlo de nuevo.

**La consecuencia es duplicación silenciosa.** El DDL solo protege un identificador: `UQ_patient_documentNumber`. No hay unicidad por nombre, ni por nombre y fecha de nacimiento. Cada vez que un paciente sin documento vuelve al sistema, nace una fila nueva, y con ella un historial de eventos adversos partido en dos. En farmacovigilancia eso no es un problema de higiene de datos: es la diferencia entre ver un patrón y no verlo.

**La maquinaria ya está construida y no se usa.** El SPEC F47 dejó en `patient` una columna `nameTokens text[]` (`esaviapp.sql:663`) con los tokens cifrados de la forma normal de cada nombre, y un índice GIN sobre ella (`esaviapp.sql:683`). `createPatientService` la calcula en cada alta (`patient.service.ts:139`) y `updatePatientService` la mantiene como campo derivado dentro del update diferencial. **Nadie la lee.** Este spec es el endpoint que le da sentido: sin él, `nameTokens` es coste de escritura sin contrapartida.

**Lo que la búsqueda por tokens sí resuelve, y el diseño anterior no.** Teclear `Torres` encuentra a `Torres Vega`, a `Torres Mendoza` y a `Torres`, porque la comprobación es de pertenencia al conjunto de palabras, no de igualdad de la columna entera. Añadir `Vega` reduce el resultado. Es el comportamiento que el operador de una brigada necesita: conoce el apellido, no la ficha completa.

**Lo que sigue sin ser posible, y este spec no finge que lo sea.** Los tokens dan coincidencia por **palabra completa**. `Tor` no encuentra a `Torres`, y `Torrez` tampoco: el prefijo exige n-gramas cifrados y la errata exige distancia de edición sobre texto claro, y ninguna de las dos cosa cabe bajo `esaviCrypt`. Tampoco hay ordenación por relevancia (§3.4). Lo que sí es indiferente es la caja, la tilde y el espacio sobrante, porque `toSearchForm` los normaliza antes de tokenizar — incluida la `ñ`, que se pliega en `n` por decisión declarada en F47 §3.3.

---

## 2. Alcance

**Dentro:**

- `ESAVI-PATIENT-007` — `GET /api/patients/search-by-name`. Rol mínimo `USER`, el mismo que el `006`.
- **Un único query param `name`**, que se tokeniza con `toNameTokens` y se cifra token a token. Ver §4 para por qué es uno y no dos.
- **Coincidencia conjuntiva de tokens** — `nameTokens` debe contener **todos** los tokens de lo tecleado, resuelto con `Op.contains` sobre el índice GIN.
- **Respuesta en el formato de lista ya existente** — `{ count, rows }` con `toPatientListRow`, idéntico al del `006`, más el campo `inactiveCount` de §3.3.
- **Resultado vacío es un resultado**: `200` con `count: 0`, nunca `404`. Es la misma decisión que ya tomó el `006` y por la misma razón — un `404` aquí significaría «este paciente no existe», que es justo la afirmación que un endpoint de búsqueda no debe hacer.
- **Señal de coincidencias inactivas** — `data.inactiveCount`, para que un paciente desactivado no se duplique en silencio. Ver §3.3.
- **Guarda de token vacío en el servicio**, además de la del validador. Es la única defensa contra el volcado del padrón y §3.2 explica por qué el validador no basta.
- Dos claves i18n nuevas en `es`, `en` y `nl`.
- Fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts:132-139` y casos nuevos en `tests/contract/patient.test.ts`.

**Fuera de alcance (otros specs, o descartado):**

- **Búsqueda por prefijo, difusa o fonética.** `Tor` no encontrará a `Torres`. Declarado fuera por el F47 §2 y esa decisión no se reabre aquí.
- **Distinguir en la consulta un nombre de un apellido.** No es una omisión: el índice no conserva la procedencia del token. Ver §4.
- **Ordenación por relevancia.** Ver §3.4.
- **Unicidad de paciente por nombre.** Dos personas con el mismo nombre son homónimos posibles, no un duplicado. Este spec **encuentra** candidatos; decidir que dos filas son la misma persona es fusión de registros, y es otro spec.
- **Fusión o deduplicación de pacientes ya duplicados.** Ni detección, ni informe, ni fusión. Este spec reduce la duplicación futura; no repara la existente.
- **Reactivar el paciente inactivo que el `007` señala.** El `007` avisa de que existe; reactivarlo sigue siendo el `005B`, con su rol `SUPERADMIN`. Automatizar ese salto es otro spec.
- **Búsqueda combinada con `birthDate` o sexo como desempate.** Se evalúa cuando exista evidencia de que los homónimos son un problema real en el padrón; añadirla ahora es diseño especulativo.
- **Tocar `toSearchForm`, `toNameTokens` o el esquema de cifrado.** F47 §4 declaró `toSearchForm` intocable y este spec hereda esa norma: cambiarla invalida en silencio todos los `nameTokens` escritos y exige repoblar la columna.
- **Ampliar el `006` con el nombre**, en vez de un endpoint nuevo. Ver §7.

---

## 3. Modelo de datos

**No hay tablas nuevas, ni columnas nuevas, ni asociaciones nuevas.** El `007` es una operación de **solo lectura** sobre `patient`, con el modelo, las columnas y las asociaciones que el SPEC F47 ya dejó implementados. Las sub-secciones de tabla origen y modelo Sequelize de la plantilla no aplican y se omiten deliberadamente.

Las columnas que este spec consulta, todas ya existentes:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `nameTokens` | `text[]` | no, `DEFAULT '{}'` | Tokens cifrados de la forma normal. **Es la única columna que se filtra** y nunca se devuelve; `esaviapp.sql:663`, índice GIN en `:683` |
| `names` | `text` | no | Cifrada. Se devuelve descifrada en cada fila |
| `lastNames` | `text` | no | Cifrada. Se devuelve descifrada en cada fila |

### 3.1 Contrato

```
GET /api/patients/search-by-name?name=…[&limit=&offset=]
```

`ESAVI-PATIENT-007`, rol mínimo `USER`.

Lo tecleado se tokeniza con `toNameTokens(name)` —que aplica `toSearchForm` a cada palabra: recorte, colapso de espacios, desacentuado y mayúsculas— y cada token resultante se cifra con `esaviCrypt`, exactamente como los cifra `createPatientService` al escribirlos (`patient.service.ts:139`). Reproducir esa misma composición es lo que hace que la comparación cifrado-contra-cifrado encuentre la fila.

El `where` es:

```ts
{
    nameTokens: { [Op.contains]: encryptedTokens },
    ...( canViewInactive ? {} : { isActive: true } )
}
```

`Op.contains` sobre una columna `ARRAY` genera `"nameTokens" @> ARRAY[…]`, que es lo que el índice GIN sirve. La semántica es **conjuntiva**: la fila debe contener todos los tokens tecleados, y puede contener más. Un token de más en la consulta reduce el resultado; nunca lo amplía.

Se resuelve con `findAndCountAll`, `LIST_ATTRIBUTES`, los mismos `include` de sexo y residencia, el mismo `LIST_ORDER` y la misma paginación que el `006`. `LIST_ATTRIBUTES` (`patient.service.ts:45`) no incluye `nameTokens`, así que la columna que gobierna la búsqueda no viaja en la respuesta sin necesidad de excluirla explícitamente.

**No hay parámetro `includeInactive`.** La visibilidad de las filas inactivas la decide `canViewInactive(req.user)` en el controlador, exactamente como en el `006` (`patient.controller.ts:127`). Un query param sería una segunda vía de decidir lo mismo, y las dos podrían discrepar.

### 3.2 El conjunto de tokens vacío, que es la decisión que importa

Ésta es la §3.2 del documento anterior reemplazada por completo: donde antes había semántica de nulos, ahora hay un solo riesgo, y es más grave.

**`Op.contains: []` es verdadero para toda fila.** `ARRAY[] <@ cualquier array` se cumple siempre, así que una consulta con cero tokens no filtra nada: devuelve la primera página del padrón entero con un `count` igual al número total de pacientes. No es un error visible —responde 200 con datos bien formados— y es exactamente el volcado que este endpoint no puede permitir.

La regla: **si `toNameTokens(name)` devuelve una lista vacía, el `007` responde `400 PATIENT_007_NAME_REQUIRED`** con el mensaje `patient.nameRequired`. Nunca ejecuta la consulta.

**La comprobación vive en dos sitios, y aquí no es redundancia defensiva sino cobertura de dos casos distintos:**

- El **validador** rechaza `name` ausente, vacío o de solo espacios, con el `400` estándar de `validateFields`.
- El **servicio** rechaza lo que el validador no puede ver: una cadena que pasa `notEmpty` y aun así **tokeniza a cero elementos**. El caso existe y es reproducible: una entrada compuesta solo de marcas diacríticas combinantes —`"́̈"`— tiene longitud no nula, sobrevive al `trim()` y al `notEmpty()`, y `toSearchForm` la deja en la cadena vacía porque su tercer paso elimina justamente ese rango Unicode. Sin la guarda del servicio, esa entrada devuelve el padrón.

Vale la pena decirlo explícito porque invierte el argumento habitual: en el resto del repositorio la doble validación es una precaución por si el servicio se invoca desde otro servicio sin su cadena de middlewares. Aquí, además, **el validador es estructuralmente incapaz** de cubrir el caso, porque la condición no es sobre la cadena sino sobre lo que la tokenización hace con ella.

### 3.3 Coincidencias inactivas — `inactiveCount`

Un paciente desactivado que reaparece debe reactivarse, no duplicarse. Pero el operador con rol `USER` no ve filas inactivas, así que sin ninguna señal su búsqueda devuelve vacío y él crea el duplicado: exactamente el fallo que este spec existe para reducir.

La respuesta lleva por eso un tercer campo junto a `count` y `rows`:

**`inactiveCount`** — número total de filas que coinciden con los tokens tecleados y tienen `isActive: false`. Se calcula con un `Patient.count` propio sobre el mismo `where` de tokens más `isActive: false`, **sin paginar**, y se devuelve siempre, con independencia del rol.

Lo que significa en cada caso:

- **`USER`** — `rows` solo trae activos. `{ count: 0, rows: [], inactiveCount: 1 }` le dice «hay un registro desactivado que coincide; pide su reactivación en vez de crear otro».
- **`ADMIN` y superiores** — `canViewInactive` es verdadero, así que las filas inactivas ya vienen en `rows`. `inactiveCount` es entonces un desglose de `count`, no información adicional.

El campo es un **número, nunca una fila**: no expone ni el `patientId`, ni el documento, ni la fecha de nacimiento del paciente desactivado. Lo único que revela es la existencia de una coincidencia, a alguien que ya tecleó al menos una palabra exacta del nombre — la misma exposición que §3.4 acepta para las filas activas.

**Coste.** Es una consulta `COUNT` extra por búsqueda, y aquí el balance es mejor que el que declaraba el documento anterior: entonces eran dos recorridos completos de tabla, porque las columnas cifradas no tenían índice. Ahora las dos consultas atacan `IX_patient_nameTokens`, así que el `COUNT` es una segunda visita al mismo índice GIN. Sigue sin ser gratis, pero deja de ser el argumento que era.

### 3.4 Superficie de enumeración

**Este spec amplía la superficie respecto al diseño anterior, y conviene decirlo sin rodeos.** Con la igualdad exacta de cuatro campos hacía falta conocer el nombre completo de una persona para confirmar que estaba en el sistema. Con tokens conjuntivos basta un apellido común: `GARCIA` devuelve una página de pacientes reales, con su documento y su fecha de nacimiento. Eso no es un efecto secundario del diseño — **es la función que se pidió**, y no hay forma de conceder «encuentra a los Torres» sin conceder también «enumera a los García».

Cuatro medidas, todas dentro del alcance:

- **Autenticado y con rol `USER` mínimo**, igual que el `006`. No hay superficie anónima.
- **Sin comodines y sin prefijos.** Hay que acertar la palabra entera; no se puede barrer el padrón probando `A`, `B`, `C`.
- **Cero tokens es un `400`**, nunca un listado (§3.2). Es la medida que impide convertir el endpoint en un `002A` sin rol `ADMIN`.
- **`limit` acotado** por `patientListValidator` — entero entre 1 y 100.

Queda anotado como **riesgo aceptado y mayor que el anterior**: un usuario legítimo puede enumerar por apellido. La alternativa —exigir el nombre completo— es el diseño que el F47 descartó por no resolver el caso de uso. Si en algún momento hace falta acotarlo, la salida natural es un mínimo de dos tokens o un registro de auditoría de búsquedas, y ambas cosas son un spec propio.

**Sin ordenación por relevancia.** `LIST_ORDER` ordena por `createdAt DESC` (`patient.service.ts:56`) y este endpoint no lo cambia. Devolver primero a quien coincide en más palabras exigiría contar coincidencias sobre texto claro, y los tokens están cifrados. La consecuencia operativa: buscar `Torres` en un padrón con muchos `Torres` devuelve los más recientes, no los más parecidos. La forma de refinar es **añadir palabras**, no paginar — y eso es lo que el frontend debe enseñar a hacer.

### 3.5 Tipos

**No se declara ningún tipo nuevo, y la ausencia es deliberada.** El documento anterior definía un `PatientNameSearchInput` de cuatro campos; con un único parámetro de texto, un tipo sería una envoltura de un `string`. El servicio recibe `name: string` directamente, con la misma forma de firma que `searchPatientsByIdentifierService` ya usa para su `identifier`.

### 3.6 Superficie HTTP y reglas de negocio

```
POST   /api/patients                         ESAVI-PATIENT-001    USER        (existe)
GET    /api/patients                         ESAVI-PATIENT-002A   USER        (existe)
GET    /api/patients/admin                   ESAVI-PATIENT-002B   ADMIN       (existe)
PATCH  /api/patients/activate/:id            ESAVI-PATIENT-005B   SUPERADMIN  (existe)
GET    /api/patients/search/:identifier      ESAVI-PATIENT-006    USER        (existe)
GET    /api/patients/search-by-name          ESAVI-PATIENT-007    USER        (nuevo)
GET    /api/patients/:id                     ESAVI-PATIENT-003    USER        (existe)
PUT    /api/patients/:id                     ESAVI-PATIENT-004    USER        (existe)
DELETE /api/patients/:id                     ESAVI-PATIENT-005A   ADMIN       (existe)
```

**Orden de declaración.** `search-by-name` se declara **antes** de `GET /:id` (`patient.routes.ts:51`), por la misma razón que ya obligó a colocar allí `/admin`, `/activate/:id` y `/search/:identifier`: Express capturaría `search-by-name` como un `:id`, `patientIdValidator` exigiría un UUID y el cliente recibiría un 400 desconcertante en vez de su búsqueda. No colisiona con `/search/:identifier`: son dos segmentos literales distintos.

**`ESAVI-PATIENT-007` — buscar por nombre.**

1. `name`, tras `.trim()`, no puede ser vacío → lo corta el validador con el `400` estándar.
2. `toNameTokens(name)` produce la lista de tokens en claro. Si la lista está vacía → `400 PATIENT_007_NAME_REQUIRED`, mensaje `patient.nameRequired` (§3.2).
3. Cada token se cifra con `esaviCrypt`. El `where` es `nameTokens: { [Op.contains]: encryptedTokens }`, más `isActive: true` cuando `canViewInactive` es falso.
4. `findAndCountAll` con `attributes: LIST_ATTRIBUTES`, `include: [SEX_INCLUDE, LIST_RESIDENCE_INCLUDE]`, `order: LIST_ORDER`, `limit` y `offset`.
5. `Patient.count` sobre el mismo `where` de tokens más `isActive: false` → `inactiveCount` (§3.3).
6. Un resultado vacío **no es un error**: 200 con `count: 0`. Nunca 404.

**Firma del servicio** — `src/services/patient.service.ts`, junto a `searchPatientsByIdentifierService`:

```ts
const searchPatientsByNameService = async (
    name: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => { /* devuelve { count, inactiveCount, rows } */ }
```

**Este spec no declara contrato de update diferencial, y la ausencia es deliberada.** El `007` no escribe sobre ninguna fila: no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`. La tabla de `candidates` y el bloque de criterios que `CONVENTIONS.md` §11 exige para las escrituras no aplican aquí. Lo que sí se verifica, en §6, es justamente que ninguna ruta del `007` termine en una escritura.

### 3.7 Validador

`patientNameSearchValidator` en `src/validators/patient.validator.ts`, exportado por el barrel existente. Se compone en la ruta **junto a** `patientListValidator`, que ya cubre `limit` y `offset`.

| Campo | Regla | Mensaje |
|---|---|---|
| `query('name')` | `.trim().notEmpty()` | `Name is required` |
| `query('name')` | `.isLength({ max: 200 })` | `Name must be at most 200 characters long` |

El `max: 200` replica el de `createPatientValidator` sobre `names` y `lastNames` (`patient.validator.ts:34-37`), que es de donde sale ese tope — la columna es `text` y no impone ninguno. Una cadena más larga que la que el create admite no puede coincidir con nada guardado, así que no merece llegar a la base de datos.

**El validador no comprueba el número de tokens.** No puede: la tokenización vive en el helper y su resultado depende de `toSearchForm`, no de la forma de la cadena. Esa comprobación es del servicio (§3.2).

### 3.8 Claves i18n nuevas

Reutiliza `patient.getSuccessPlural`, `patient.getFailedPlural` y `patient.searchEmpty`, que ya existen en los tres idiomas. Se añaden dos, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `patient.nameRequired` | 400 cuando lo tecleado no produce ningún token (§3.2) |
| `patient.searchEmptyInactive` | 200 con `count: 0` e `inactiveCount > 0` (§3.3) |

Texto propuesto:

| Clave | `es` | `en` | `nl` |
|---|---|---|---|
| `nameRequired` | Debe indicar al menos un nombre o apellido para la búsqueda | At least one name or last name is required for the search | Minstens één voor- of achternaam is verplicht voor de zoekopdracht |
| `searchEmptyInactive` | No existen resultados activos, pero sí registros desactivados que coinciden | There are no active results, but there are deactivated records that match | Er zijn geen actieve resultaten, maar er zijn wel gedeactiveerde records die overeenkomen |

`patient.namesRequired` ya existe y **no se reutiliza**: es del `001` y habla de campos obligatorios del alta, no de un criterio de búsqueda insuficiente. Dos situaciones distintas con dos mensajes distintos.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.9 Forma de la respuesta

```
{ ok, message, data: {
    count,
    inactiveCount,
    rows: [ {
        patientId, names, lastNames, documentNumber, birthDate,
        healthSystemCode, isActive,
        sex: { catalogItemId, code, name, value },
        residence: { geoLocationId, name }
    } ]
} }
```

`rows` es exactamente lo que produce `toPatientListRow`, con las columnas cifradas ya descifradas. Las filas inactivas se filtran salvo que `canViewInactive(req.user)` sea verdadero.

**`nameTokens` no aparece nunca**, ni en `rows` ni en ningún otro sitio. `LIST_ATTRIBUTES` (`patient.service.ts:45`) no lo enumera, así que no llega a leerse. Exponerlo entregaría la forma normal cifrada de cada nombre y con ella la superficie de análisis de frecuencia que F47 §8 acepta solo para el acceso directo a la base de datos, nunca para la API.

El `message` se resuelve en el controlador con las tres claves deletreadas literalmente, para que `i18n:check` pueda verificarlas de forma estática — es el mismo patrón del `006` (`patient.controller.ts:131-133`):

| Condición | Clave |
|---|---|
| `count > 0` | `patient.getSuccessPlural` |
| `count === 0` y `inactiveCount > 0` | `patient.searchEmptyInactive` |
| `count === 0` y `inactiveCount === 0` | `patient.searchEmpty` |

---

## 4. Un solo parámetro, porque el índice es un conjunto plano

El SPEC F47 §9 anticipó que este spec tendría «dos query params». **No los tiene, y la razón no es de estilo: es que el modelo implementado no permite tres.**

`createPatientService` calcula la columna así (`patient.service.ts:139`):

```ts
const nameTokens = toNameTokens(data.names, data.lastNames).map((token) => esaviCrypt(token));
```

`toNameTokens` (`stringHandling.helper.ts:136`) recibe los dos valores como argumentos variádicos, los aplana con `flatMap` y devuelve **una sola lista sin duplicados**. El token `TORRES` queda en el array sin ninguna marca de si vino de `names` o de `lastNames`. La procedencia se pierde en la escritura, y ninguna consulta puede recuperarla en la lectura.

La consecuencia es directa: un `where` sobre `nameTokens` **no puede** exigir «estos tokens entre los nombres y estos otros entre los apellidos». Solo puede exigir «estos tokens, en alguna parte del nombre». Aceptar dos query params y unirlos igualmente en un solo `Op.contains` sería peor que tener uno: la API prometería una distinción que el motor no hace, y un operador que buscara `name=Torres&lastNames=Vega` obtendría el mismo resultado que buscando al revés, sin manera de saber por qué.

**Las tres salidas posibles, y por qué se elige la primera:**

1. **Un parámetro `name`.** El contrato dice exactamente lo que el índice hace. Es lo que este spec adopta.
2. **Dos columnas de tokens** —`nameTokens` y `lastNameTokens`—, cada una con su índice GIN. Recupera la distinción, a costa de un cambio de esquema, un segundo índice, un segundo campo derivado en el update diferencial del `004` y el repoblado correspondiente. Es un spec propio y no está justificado por ninguna necesidad observada.
3. **Dos parámetros que se aplanan en uno.** Descartada: promete lo que no cumple.

**Lo que se pierde con la opción 1** es distinguir a una persona llamada `María Torres` de una llamada `Torres María`: ambas coinciden con `name=maria torres`. Es encontrar de más, y el F47 §3.3 ya fijó el principio que gobierna este caso al aceptar que `Muñoz` y `Munoz` sean el mismo paciente a efectos de búsqueda: **encontrar de más es recuperable —el operador descarta la fila— mientras que no encontrar produce un duplicado.** Este spec aplica la misma regla, no una nueva.

**Lo que se gana** es que la caja única es también lo que el operador espera. El `006` ya es una caja única sobre tres identificadores intercambiables, y el frontend no tiene que pedirle a alguien que teclea deprisa que decida si `Del Cisne` es nombre o apellido antes de poder buscar.

**Norma heredada que este spec no puede tocar.** F47 §4 declaró `toSearchForm` intocable, y aquí esa norma se vuelve más estricta, no menos: hasta hoy un cambio en ella solo desalineaba la columna consigo misma; a partir de este endpoint, desalinea la consulta respecto del índice y el síntoma es una búsqueda que deja de encontrar sin producir ningún error. Cualquier cambio en `toSearchForm` o en `toNameTokens` exige repoblar `nameTokens` en la misma entrega — barato con este modelo, porque se recalcula desde `names` y `lastNames` sin perder nada, pero no opcional.

---

## 5. Plan de implementación

Siete pasos. Cada uno deja el proyecto compilando y arrancable, y cada uno es committeable por separado. No hay paso de esquema, ni de modelo, ni de tipos: el SPEC F47 los dejó hechos.

1. **Claves i18n.** `patient.nameRequired` y `patient.searchEmptyInactive` en `es.json`, `en.json` y `nl.json`, con los textos de §3.8.
   *Verificación:* `npm run i18n:check` sale en 0 y `tests/i18n/messages.test.ts` pasa.

2. **`patientNameSearchValidator`.** En `src/validators/patient.validator.ts`, con las dos reglas de §3.7. Se registra en el barrel de `validators/`.
   *Verificación:* `npm run build` y `npm run lint` en 0.

3. **`searchPatientsByNameService`.** Firma de §3.6, junto a `searchPatientsByIdentifierService`. Tokenización con `toNameTokens`, guarda de lista vacía que lanza `PATIENT_007_NAME_REQUIRED`, cifrado token a token, `where` con `Op.contains`, `findAndCountAll` con `LIST_ATTRIBUTES` y el `Patient.count` de `inactiveCount`. Se exporta en el bloque final del archivo. Comentario con el código de operación sobre la función.
   *Verificación:* buscar una palabra del apellido de un paciente sembrado devuelve `count: 1`; buscar un prefijo de esa palabra devuelve `count: 0`; invocar el servicio con `'   '` lanza el `AppError` y no ejecuta ninguna consulta.

4. **`searchPatientsByName` — controlador.** En `src/controllers/patient.controller.ts`. Lee `name` de `req.query`, `limit` y `offset` como ya hacen los demás, pasa `canViewInactive(req.user as AuthUser)`, y resuelve el `message` con las tres claves deletreadas de §3.9. `catch` con el idioma del repositorio: `esaviLog` con el código, `next(error)` si ya es `AppError`, y si no `new AppError(getMessage('patient.getFailedPlural', req.lang), 500, 'PATIENT_007_SEARCH_FAILED', error)`.
   *Verificación:* `npm run build` en 0; el controlador no importa ningún modelo.

5. **Ruta.** `router.get('/search-by-name', tokenValidation, validateUserRole(USER), ...patientNameSearchValidator, ...patientListValidator, validateFields, searchPatientsByName)` en `src/routes/patient.routes.ts`, declarada **antes** de `GET /:id`.
   *Verificación:* `GET /api/patients/search-by-name?name=X` responde 200 y no un 400 de UUID inválido.

6. **`ROUTE_RULES`.** Fila nueva en `tests/auth/roles.test.ts`, entre el `006` y el `003`, respetando el orden de declaración: `{ method: 'get', path: '/api/patients/search-by-name?name=A', minRole: 'USER', code: 'ESAVI-PATIENT-007' }`.
   *Verificación:* `tests/auth/roles.test.ts` pasa; sin token responde 401 y con rol `ANALYTICS` responde 403.

7. **Casos de contrato.** En `tests/contract/patient.test.ts`, junto al helper `searchPatients` ya existente, se añade un `searchPatientsByName`. Cubre los diez criterios de §6.
   *Verificación:* `npm run check` en 0.

---

## 6. Criterios de aceptación

**Búsqueda:**

- [ ] `GET /api/patients/search-by-name?name=…` responde 200 con `{ count, inactiveCount, rows }`.
- [ ] Un paciente con `lastNames: "Torres Vega"` se encuentra tecleando solo `Torres`, y sus `rows[0]` traen `names` y `lastNames` en claro.
- [ ] Ese mismo paciente se encuentra tecleando `Torres Vega`, y **no** se encuentra tecleando `Torres Mendoza`: un token de más reduce el resultado, nunca lo amplía.
- [ ] `torres` en minúscula, `  torres  ` con espacios sobrantes y `Tórres` con tilde encuentran los tres al mismo paciente — la forma normal los colapsa.
- [ ] Un paciente con `lastNames: "Muñoz"` se encuentra tecleando `Munoz`, y al revés. Es el comportamiento buscado de F47 §3.3, no un accidente.
- [ ] Un prefijo **no** encuentra: `Tor` devuelve 200 con `count: 0`, nunca 404 y nunca al paciente `Torres`.
- [ ] Un nombre que no existe devuelve 200 con `count: 0` y el mensaje de `patient.searchEmpty`.

**Volcado del padrón — la superficie que §3.2 cierra:**

- [ ] `name` ausente responde 400.
- [ ] `name` de solo espacios responde 400, y **no** un 200 con el padrón entero.
- [ ] Un `name` compuesto solo de marcas diacríticas combinantes —`"́"`— responde 400 con `PATIENT_007_NAME_REQUIRED` y el mensaje `patient.nameRequired`. Es el caso que el validador no puede ver y el servicio sí.
- [ ] En ninguno de los tres casos anteriores el `count` de la respuesta es mayor que 0.

**Inactivos y exposición:**

- [ ] Un paciente desactivado devuelve, para `USER`, `count: 0` con `inactiveCount: 1` y el mensaje de `patient.searchEmptyInactive`.
- [ ] Ese mismo paciente aparece en `rows` para `ADMIN`, con `inactiveCount: 1` como desglose de `count`.
- [ ] Ninguna respuesta del `007` contiene la cadena `nameTokens`.
- [ ] Sin token responde 401; con rol `ANALYTICS` responde 403.

**Convenciones:**

- [ ] `GET /api/patients/search-by-name` **no** es capturada por `GET /:id`: la respuesta no es un 400 de UUID inválido.
- [ ] Los cinco puntos del código de operación coinciden: comentario en ruta, en controlador, en servicio, código del `AppError` (`PATIENT_007_*`) y mensaje de `esaviLog`. `grep -rn "ESAVI-PATIENT-007" src/` devuelve exactamente esas apariciones.
- [ ] **El `007` no escribe**: tras cien búsquedas, el `appDetails` del paciente encontrado no crece, su `updatedAt` no se mueve y `sysDetails.version` no avanza. En el servicio, el bloque del `007` no contiene ningún `.update(`, `.create(` ni `transaction`.
- [ ] Las dos claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 7. Decisiones tomadas y descartadas

- **Sí:** un solo query param `name`. El índice no conserva la procedencia del token, así que dos parámetros prometerían una distinción que el motor no hace. Ver §4.
- **Sí:** `Op.contains` y no una comparación campo a campo. Es lo que usa el índice GIN que F47 dejó creado, y lo que da la semántica conjuntiva: añadir palabras reduce, quitar palabras amplía.
- **Sí:** endpoint nuevo `007` en vez de ampliar el `006`. El `006` es un `Op.or` sobre tres identificadores intercambiables; éste es una comprobación de pertenencia sobre una columna de array con su propio mínimo obligatorio y su propia señal de inactivos. Meterlos en la misma firma produce un servicio con dos modos que no comparten nada salvo el `findAndCountAll`.
- **Sí:** query param y no segmento de ruta. Un nombre lleva espacios y acentos, y `/search-by-name/:name` los arrastra a la URL con peor legibilidad y sin ganar nada.
- **Sí:** `inactiveCount` como número, siempre presente. Sin señal, el `USER` que no ve inactivos duplica al paciente desactivado, que es el fallo que este spec existe para reducir. Un número no contradice `canViewInactive` —no entrega ninguna fila ni ningún campo— y su fuga es la que §3.4 ya acepta.
- **Sí:** validar el mínimo dos veces. Aquí no es solo la precaución habitual: el validador es incapaz de ver el caso de los cero tokens, porque la condición es sobre el resultado de la tokenización y no sobre la cadena (§3.2).
- **Sí:** aceptar que `name=maria torres` encuentre tanto a `María Torres` como a `Torres María`. Es el mismo principio con el que F47 aceptó plegar la `ñ`: encontrar de más es recuperable, no encontrar produce un duplicado.
- **No:** exigir un mínimo de dos tokens. Rompería el caso de uso que motiva el spec —el operador de brigada que solo conoce el apellido— para acotar una superficie de enumeración que §3.4 ya declara aceptada. Si hiciera falta, es un cambio de una línea y un spec propio.
- **No:** una segunda columna `lastNameTokens` para distinguir nombres de apellidos. Cambio de esquema, segundo índice, segundo derivado en el update diferencial del `004` y repoblado, a cambio de una distinción que nadie ha pedido. Ver §4, opción 2.
- **No:** ordenar por relevancia. Contar coincidencias exige texto claro y los tokens están cifrados. La forma de refinar es añadir palabras (§3.4).
- **No:** exponer las filas inactivas a cualquier `USER`. Resolvería lo mismo contradiciendo el mecanismo de visibilidad de todo el repositorio, y por la entidad más sensible del esquema.
- **No:** un query param `includeInactive`. Sería una segunda vía de decidir lo que `canViewInactive` ya decide, y las dos podrían discrepar.
- **No:** exponer `nameTokens` en la respuesta, ni siquiera para depurar. Entrega la forma normal cifrada de cada nombre y con ella el análisis de frecuencia de F47 §8.
- **No:** búsqueda por prefijo o tolerante a erratas. Decidido en F47 §2 y no se reabre aquí.
- **No:** `birthDate` o sexo como criterio de desempate en esta entrega. Se evalúa cuando haya evidencia de que los homónimos son un problema real.

---

## 8. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Un `name` que tokeniza a cero elementos vuelca el padrón**, porque `Op.contains: []` es verdadero para toda fila y la respuesta parece normal | La guarda del servicio de §3.2, que es independiente del validador porque éste no puede ver el caso. Cuatro criterios de aceptación propios en §6, incluido el de las marcas diacríticas sueltas |
| **Enumeración por apellido común.** `GARCIA` devuelve una página de pacientes reales con documento y fecha de nacimiento — más superficie que la del diseño anterior | Declarado y aceptado en §3.4: es inseparable de la función que se pide. Se acota con el rol `USER`, el `limit ≤ 100` y la ausencia de prefijos. Si hace falta más, la salida es un mínimo de dos tokens o auditoría de búsquedas, en su propio spec |
| Cambiar `toSearchForm` o `toNameTokens` desalinea la consulta respecto del índice; el fallo es silencioso — no hay error, solo resultados vacíos | F47 §4 las declara intocables y §4 de este spec endurece la norma: cualquier cambio exige repoblar `nameTokens` en la misma entrega. Es barato —se recalcula desde `names` y `lastNames`— pero no opcional |
| `GET /:id` captura `search-by-name` como UUID | La ruta literal se declara antes de `/:id`; cubierto por un criterio de aceptación propio |
| El `COUNT` extra de `inactiveCount` duplica el trabajo por búsqueda | Menor que en el diseño anterior: ambas consultas usan `IX_patient_nameTokens` en vez de recorrer la tabla. Declarado en §3.3 |
| El operador teclea `Tor` y concluye que el paciente no existe | Limitación real y no corregible bajo cifrado. Mitigación del frontend: el formulario debe decir que se busca por palabras completas y que añadir palabras refina, no amplía |
| Un homónimo se elige por error porque el orden es por fecha y no por relevancia | §3.4 lo declara; `rows` trae `documentNumber` y `birthDate` para que el operador desempate a la vista |

---

## 9. Impacto en el contrato HTTP

**Nulo para los clientes existentes.** El `007` es un endpoint nuevo; ninguna ruta actual cambia de status, de forma de `data` ni de mensaje, y este spec **no modifica ni una línea de código ya escrito**: no toca modelos, ni el esquema, ni los servicios de escritura, ni los helpers. Solo añade un validador, un servicio, un controlador, una ruta y dos claves i18n.

Es la diferencia con el SPEC F47, que sí fue un cambio incompatible. Este spec es el consumidor de aquel trabajo.

---

## Lo que **no** está en este spec

- Búsqueda por prefijo, por similitud o tolerante a erratas.
- Distinguir en la consulta un nombre de un apellido, o una segunda columna de tokens.
- Ordenación por relevancia.
- Unicidad de paciente por nombre.
- Detección, informe o fusión de pacientes ya duplicados.
- Reactivar el paciente inactivo que `inactiveCount` señala.
- `birthDate` o sexo como criterio de desempate.
- Un mínimo de dos tokens o auditoría de búsquedas como acotación de la enumeración.
- Cualquier cambio en `toSearchForm`, `toNameTokens` o el esquema de cifrado.

Cada uno de esos, si aterriza, va en su propio spec.
