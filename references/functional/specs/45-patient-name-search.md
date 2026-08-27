# SPEC F45 — Búsqueda de paciente por nombre completo

> **Estado:** Borrador
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F05 (`patient`, `ESAVI-PATIENT-006`)
> **Fecha:** 2026-08-27
> **Objetivo:** Permitir identificar a un paciente ya registrado cuando no se dispone de ningún documento, usando la coincidencia exacta de sus dos nombres y dos apellidos, sin abrir una vía de enumeración del padrón ni degradar la protección de los datos personales.

---

## 1. Por qué existe este spec

**El alta de un caso ESAVI empieza por decidir si el paciente ya existe.** El flujo operativo es: buscar al paciente, reutilizarlo si aparece, crearlo si no, y solo entonces abrir el `esaviCase`. Hoy ese primer paso solo funciona si quien captura tiene un identificador en la mano.

`searchPatientsByIdentifierService` (`src/services/patient.service.ts:345`) resuelve la búsqueda con un `Op.or` sobre exactamente tres columnas — `documentNumber`, `passportNumber` y `healthSystemCode` (`patient.service.ts:359-365`). No hay ninguna otra vía de búsqueda: `002A`/`002B` listan y paginan, pero no filtran por nombre. Un paciente que llega sin documento —un menor, un extranjero en tránsito, una persona atendida en una brigada de vacunación rural— no se puede encontrar, y el operador no tiene más opción que crearlo de nuevo.

**La consecuencia es duplicación silenciosa.** El DDL solo protege un identificador: `UQ_patient_documentNumber` (`esaviapp.sql:642`). No hay unicidad por nombre, ni por nombre y fecha de nacimiento. Cada vez que un paciente sin documento vuelve al sistema, nace una fila nueva, y con ella un historial de eventos adversos partido en dos. En farmacovigilancia eso no es un problema de higiene de datos: es la diferencia entre ver un patrón y no verlo.

**La búsqueda es técnicamente posible, y ésa es la razón de que este spec sea corto.** Los cuatro campos de nombre se cifran con `esaviCrypt`, que es determinista y de IV fijo, y se cifran **después** de pasar por `normalizeName` (`patient.service.ts:125-130`), que es `toTitleCase(value.trim())`. Repetir esa misma composición sobre lo que teclea el usuario reproduce byte a byte el texto cifrado almacenado, de modo que la igualdad exacta funciona como cualquier `where`. Es exactamente el mecanismo que el `006` ya usa sobre `documentNumber`. No hace falta descifrar el padrón, ni añadir columnas, ni tocar el esquema.

**Lo que no es posible, y este spec no finge que lo sea.** Con cifrado determinista solo existe la igualdad. No hay `LIKE`, ni prefijo, ni ordenación, ni similitud fonética, ni tolerancia a una letra cambiada. La búsqueda encuentra al paciente cuyos cuatro campos coinciden **exactamente** tras normalizar, y a nadie más. Un apellido tecleado con una letra distinta no devuelve nada. Aceptar esa limitación es la condición para no descifrar nombres en memoria en cada búsqueda, que es la alternativa y es peor.

---

## 2. Alcance

**Dentro:**

- `ESAVI-PATIENT-007` — `GET /api/patients/search-by-name`. Rol mínimo `USER`, el mismo que el `006`. Los cuatro componentes viajan como **query params**, no en la ruta: son cuatro valores con espacios y acentos, y `/search/:a/:b/:c/:d` sería tanto ilegible como frágil ante un apellido vacío.
- **Coincidencia exacta sobre los cuatro campos**, cada uno normalizado con `normalizeName` y cifrado con `esaviCrypt` antes de comparar: `firstName`, `middleName`, `lastName`, `secondLastName`.
- **Respuesta en el formato de lista ya existente** — `{ count, rows }` con `toPatientListRow`, idéntico al del `006`, para que el frontend reutilice el mismo componente de resultados.
- **Resultado vacío es un resultado**: `200` con `count: 0`, nunca `404`. Es la misma decisión que ya tomó el `006` y por la misma razón — un `404` aquí significaría «este paciente no existe», que es justo la afirmación que un endpoint de búsqueda no debe hacer.
- **Extracción de `normalizeName` a `stringHandling.helper.ts`.** Hoy está declarada tres veces, idéntica, en `patient.service.ts:20`, `notifier.service.ts:20` e `investigationTeamMember.service.ts`. Este spec la necesita en un cuarto sitio y no va a hacer la cuarta copia. Sube al helper, con su alta en el barrel, y los tres servicios existentes pasan a importarla — **sin cambiar su comportamiento**, porque cualquier cambio en esa función altera el texto cifrado de filas ya escritas (§4).
- Claves i18n nuevas en `es`, `en` y `nl`.
- Fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts` y casos nuevos en `tests/contract/patient.test.ts`.

**Fuera de alcance (otros specs, o descartado):**

- **Búsqueda parcial, por prefijo, difusa o fonética.** Incompatible con el cifrado determinista. Habilitarla exige una columna de índice ciego —un hash de un nombre normalizado y desacentuado, o un `blind index` por token— y eso es un spec de esquema propio, con su migración y su repoblado.
- **Unicidad de paciente por nombre.** Cuatro nombres iguales son un homónimo perfectamente posible, no un duplicado. Este spec **encuentra** candidatos; decidir que dos filas son la misma persona es fusión de registros, y es otro spec.
- **Fusión o deduplicación de pacientes ya duplicados.** Ni detección, ni informe, ni fusión. Este spec reduce la duplicación futura; no repara la existente.
- **Búsqueda combinada con `birthDate` o sexo como desempate.** Se evalúa cuando exista evidencia de que los homónimos son un problema real en el padrón; añadirla ahora es diseño especulativo.
- **Cambiar `normalizeName`, `toTitleCase` o el esquema de cifrado.** Ver §4: el defecto conocido de `toTitleCase` con nombres que empiezan por vocal acentuada se documenta aquí, y se corrige en el spec de repoblado que le corresponde.
- **Ampliar el `006` con los nombres**, en vez de un endpoint nuevo. Ver §5.

---

## 3. Diseño

### 3.1 Contrato

```
GET /api/patients/search-by-name
    ?firstName=…&middleName=…&lastName=…&secondLastName=…
    [&limit=&offset=&includeInactive=]
```

`ESAVI-PATIENT-007`, rol mínimo `USER`.

Cada uno de los cuatro se normaliza con `normalizeName` y se cifra con `esaviCrypt`; el `where` es la conjunción de las cuatro igualdades, más el filtro de `isActive` que ya gobierna `canViewInactive`. Se resuelve con `findAndCountAll`, `LIST_ATTRIBUTES`, los mismos `include` de sexo y residencia, y la misma paginación que el `006`.

### 3.2 Los campos nulos, que es la decisión que importa

`middleName` y `secondLastName` son **nullable** en el DDL (`esaviapp.sql:623,625`). Un paciente con un solo apellido tiene `secondLastName: NULL`, y `NULL = <cualquier cosa>` es `NULL` en SQL: una búsqueda que exija los cuatro no lo encontrará jamás, por bien tecleado que esté.

La regla de este spec: **el parámetro ausente o vacío se traduce en `IS NULL`, no en «ignórame».** Buscar sin `secondLastName` significa *«pacientes cuyo segundo apellido está vacío»*, no *«pacientes con cualquier segundo apellido»*. Es lo que hace que la búsqueda siga siendo exacta y su resultado, interpretable.

Consecuencia que el frontend debe conocer y mostrar: los cuatro campos del formulario se envían siempre, y dejar uno en blanco es una afirmación sobre el paciente, no una omisión. Un resultado vacío tras dejar el segundo apellido en blanco no significa que el paciente no exista; puede significar que sí tiene segundo apellido registrado.

**Mínimo exigido:** `firstName` y `lastName` son obligatorios. Sin ellos la consulta degenera en «todos los pacientes con dos campos nulos», que es un volcado del padrón con otro nombre. Devuelve `400 PATIENT_007_NAME_REQUIRED`.

### 3.3 Superficie de enumeración

Un endpoint que confirma la existencia de una persona por su nombre es, por construcción, consultable en masa. Tres medidas, todas dentro del alcance:

- **Autenticado y con rol `USER` mínimo**, igual que el `006`. No hay superficie anónima.
- **Sin comodines y sin resultados parciales.** Sin igualdad exacta de cuatro campos no hay forma de barrer el padrón probando prefijos.
- **`limit` acotado** por la paginación estándar; un homónimo cuádruple es una rareza y una página basta.

Queda anotado como riesgo aceptado: un usuario legítimo que ya conoce el nombre completo de una persona puede confirmar si está en el sistema. Es inherente a la función que se pide y es la misma exposición que ya concede el `006` a quien conoce un número de documento.

### 3.4 Artefactos

Los siete de la convención, todos sobre archivos que ya existen: validador (`patient.validator.ts`), servicio, controlador, ruta, tipos, claves i18n y pruebas. No hay modelo nuevo, ni asociación nueva, ni cambio de esquema.

**La ruta se declara antes de `GET /:id`** (`patient.routes.ts:51`), por la misma razón que ya obligó a colocar allí `/admin` y `/search/:identifier`: Express capturaría `search-by-name` como un `:id` y el validador de UUID respondería un 400 desconcertante.

### 3.5 Claves i18n

Reutiliza `patient.getSuccessPlural`, `patient.getFailedPlural` y `patient.searchEmpty`, que ya existen en los tres idiomas. Añade `patient.nameRequired` para el 400 de §3.2. *(Pendiente de cerrar la lista definitiva al redactar §3.6 completo.)*

---

## 4. `normalizeName` es la superficie de riesgo real

Extraer la función al helper es refactor. **Modificarla no lo es**, y este spec lo deja escrito para que nadie lo descubra en producción:

`normalizeName` corre **antes** del cifrado, así que forma parte de la identidad almacenada. El texto cifrado de una fila escrita hoy es `esaviCrypt(toTitleCase(input.trim()))`. Cambiar `toTitleCase` —añadir desacentuado, cambiar el manejo de guiones o de partículas como *de la*— **no migra nada**: las filas viejas conservan el cifrado viejo, las nuevas nacen con otro distinto, y este endpoint deja de encontrar a los pacientes anteriores al cambio. El fallo es silencioso: no hay error, solo resultados vacíos.

**Defecto conocido, verificado, y no corregido aquí.** `toTitleCase` (`stringHandling.helper.ts:71`) usa `/\w\S*/g`, y `\w` sin la bandera `u` no incluye vocales acentuadas. Sobre un nombre que empieza por una de ellas, la primera coincidencia no es la primera letra: `"Ángel"` produce `"ÁNgel"` y `"ángel"` produce `"áNgel"`. Son dos textos cifrados distintos para lo que el usuario considera el mismo nombre, y la búsqueda solo encuentra el que coincide con cómo se tecleó al crear la fila.

No se corrige en este spec porque arreglar la función invalida el cifrado de todas las filas afectadas. Corresponde a un spec de **normalización y repoblado** que descifre, renormalice y recifre los cinco campos de `patient` —y los equivalentes de `notifier`, `investigationTeamMember` y `appUser`— en una sola pasada transaccional. Ese spec es prerrequisito de cualquier mejora de esta búsqueda, y sería el momento natural de introducir el índice ciego desacentuado que habilitaría la búsqueda parcial que §2 deja fuera.

Mientras tanto, la mitigación es del frontend: mostrar el nombre tal como se registró en los resultados, para que el operador vea por qué su búsqueda falló.

---

## 5. Decisiones tomadas y descartadas

- **Sí:** endpoint nuevo `007` en vez de ampliar el `006`. El `006` es un `Op.or` sobre tres identificadores intercambiables que un usuario teclea en una sola caja; éste es un `Op.and` sobre cuatro campos con semántica de nulos propia y un mínimo obligatorio. Meterlos en la misma firma produce un servicio con dos modos que no comparten nada salvo el `findAndCountAll`.
- **Sí:** query params. Cuatro valores con espacios, acentos y posibles vacíos no caben con dignidad en segmentos de ruta.
- **Sí:** el campo vacío significa `IS NULL`. La alternativa —ignorar el campo ausente— convierte la búsqueda exacta en una búsqueda por subconjunto cuyo resultado el operador no puede interpretar, y reabre la enumeración por barrido.
- **Sí:** `firstName` y `lastName` obligatorios. Sin mínimo, el endpoint es un listado del padrón.
- **No:** descifrar el padrón en memoria para comparar sin distinguir mayúsculas ni acentos. Es correcto funcionalmente y ruinoso en todo lo demás: lee la tabla entera en cada búsqueda y expone en memoria del proceso justo los datos que el cifrado protege.
- **No:** `birthDate` como quinto criterio en esta entrega. Ver §2.
- **No:** tocar `toTitleCase`. Ver §4.
- **Pendiente:** si el `007` debe devolver, además de los pacientes, una señal de que existen filas **inactivas** que coinciden. Un paciente desactivado que reaparece debería reactivarse, no duplicarse — pero `canViewInactive` ya gobierna esa visibilidad por rol y conviene no contradecirlo. Se resuelve antes de pasar a `Aprobado`.

---

## 6. Pendiente de redactar antes de `Aprobado`

Este documento fija el problema, el alcance y las decisiones de diseño. Faltan, con el detalle que exige `.claude/skills/esavi-spec/template.md`:

- §3 completo — tipos, firma exacta del servicio, tabla de validadores campo por campo, lista cerrada de claves i18n en los tres idiomas.
- El plan de implementación por pasos con su verificación cada uno.
- Los criterios de aceptación y el checklist.
- La sección de impacto sobre clientes existentes. Se anticipa que es **nula**: el endpoint es nuevo y el único cambio sobre código existente —extraer `normalizeName`— es de comportamiento idéntico por construcción.

**Este spec no declara contrato de update diferencial**: no escribe sobre ninguna fila. Es una operación de solo lectura, y el bloque de §3.5/§5 que la plantilla exige para las escrituras no aplica. La ausencia es deliberada y debe verificarse como tal — ninguna ruta de `007` puede terminar en un `UPDATE`.
