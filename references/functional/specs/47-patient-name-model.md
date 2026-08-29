# SPEC F47 — Modelo de nombre del paciente y búsqueda por tokens

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F05 (`patient`), SPEC F12 (update diferencial)
> **Reemplaza el diseño de:** SPEC F45, que se reescribe encima de este (§9)
> **Fecha:** 2026-08-28
> **Objetivo:** Sustituir las cuatro columnas de nombre de `patient` por dos, guardar el nombre tal como se registró y buscar contra un índice de tokens cifrados que encuentre a `Torres Vega` tecleando solo `Torres`.

---

## 1. Por qué existe este spec

### A — Cuatro columnas no representan un nombre

`patient` es la única tabla del esquema con el nombre partido en cuatro: `firstName`, `middleName`, `lastName`, `secondLastName` (`esaviapp.sql:645-648`). `appUser` lo parte en dos (`esaviapp.sql:245-246`), `notifier` en dos (`esaviapp.sql:698-699`) e `investigationTeamMember` no lo parte — una sola columna `fullName` (`esaviapp.sql:1021`). El esquema ya no es coherente consigo mismo, y `patient` es el caso raro.

Cuatro columnas fijas tampoco alcanzan. Una persona con tres nombres de pila —`José Luis Antonio`— no cabe: o se pierde el tercero, o se apelmaza en `middleName` y la columna deja de significar «segundo nombre». Lo mismo con los apellidos compuestos: `de la Torre` ocupa un campo entero y el segundo apellido no tiene dónde ir. El modelo obliga a mentir sobre la estructura del nombre en cuanto el nombre no es exactamente `dos + dos`.

### B — La búsqueda que se necesita no es la que el cifrado permite

El [SPEC F45](45-patient-name-search.md) plantea encontrar al paciente sin documento por su nombre. Su diseño era la igualdad exacta de cuatro campos, porque es lo único que `esaviCrypt` —determinista y de IV fijo— permite comparar sin descifrar el padrón.

**Ese diseño no resuelve el caso real.** Quien captura en una brigada rural conoce el apellido, no la ficha completa. Teclear `Torres` debe devolver a `Torres Vega`, a `Torres Mendoza` y a `Torres`, para que el operador elija. Con igualdad sobre la columna entera, `TORRES` no coincide con `TORRES VEGA` y el resultado es vacío: el operador crea el duplicado, que es exactamente el fallo que F45 existía para reducir.

### C — La normalización parte el mismo nombre en varios cifrados

`normalizeName` (`patient.service.ts:20`) es `toTitleCase(value.trim())` y corre **antes** de cifrar, así que forma parte de la identidad almacenada. Tres variantes de escritura del mismo nombre producen hoy tres textos cifrados que no se encuentran entre sí:

| Tecleado | Guardado | |
|---|---|---|
| `María del Cisne` | `esaviCrypt("María Del Cisne")` | |
| `maria del cisne` | `esaviCrypt("Maria Del Cisne")` | tilde perdida |
| `María  del Cisne` | `esaviCrypt("María  Del Cisne")` | doble espacio |
| `Ángel` | `esaviCrypt("ÁNgel")` | defecto de `toTitleCase` |

La última fila es un defecto verificado: `toTitleCase` (`stringHandling.helper.ts:71`) usa `/\w\S*/g`, y `\w` sin la bandera `u` no incluye vocales acentuadas, así que la primera coincidencia no es la primera letra del nombre.

Los tres problemas se resuelven en la misma pasada porque los tres reescriben las mismas columnas. Hacerlos por separado son dos cambios de esquema donde cabe uno.

### D — La ventana para hacerlo es ahora

**El sistema está en desarrollo. No hay pre-producción, las instalaciones son locales y no hay datos de pacientes cargados.** Ese es el supuesto sobre el que se apoya todo este spec: no hay script de migración porque no hay nada que migrar. `esaviapp.sql` se cargará ya con la forma nueva.

Si el supuesto deja de ser cierto antes de implementar —una instalación piloto, una carga de prueba que alguien quiera conservar— **este spec no se implementa tal como está**: necesita un paso previo de fusión y repoblado que descifre, recomponga y recifre cada fila, y ese paso no está escrito aquí. Es la primera cosa que hay que verificar al abrir la rama.

---

## 2. Alcance

**Dentro:**

- **Fusión de las cuatro columnas de `patient` en dos** — `names` y `lastNames`, ambas `text NOT NULL` y cifradas. `esaviapp.sql` se edita en el sitio; no hay migración (§1D).
- **Columna nueva `nameTokens`** — `text[]` con los tokens cifrados de la forma normal, e índice GIN. Es la superficie de búsqueda; nunca sale en una respuesta.
- **Helper `toSearchForm`** en `stringHandling.helper.ts` — la forma normal: recorte, colapso de espacios, desacentuado y mayúsculas. Y `toNameTokens`, que la parte en palabras.
- **Corrección de `toTitleCase`** — añadir la bandera `u` y usar `\p{L}`. Deja de ser intocable en cuanto la búsqueda no depende de él (§4).
- **Extracción de `normalizeName` al helper**, que el F45 ya declaraba, con la migración de `notifier.service.ts:20` e `investigationTeamMember.service.ts:172`.
- **Reescritura de `ESAVI-PATIENT-001` y `004`** sobre el modelo nuevo, con `nameTokens` como campo derivado dentro del update diferencial.
- **Ajuste de `002A`, `002B`, `003` y `006`** a la forma de respuesta nueva.
- Claves i18n nuevas en `es`, `en` y `nl`; actualización de `tests/contract/patient.test.ts`.

**Fuera de alcance (otros specs, o descartado):**

- **El endpoint de búsqueda `ESAVI-PATIENT-007`.** Es del [SPEC F45](45-patient-name-search.md), que se reescribe encima de éste una vez implementado. Aquí se construye la maquinaria; allí se expone (§9).
- **Aplicar el modelo de dos columnas a `appUser` y `notifier`.** Ya tienen dos columnas y no sufren el problema de §1A. Su normalización sí queda pendiente y se anota en §8.
- **Búsqueda por prefijo o difusa.** Los tokens dan coincidencia por palabra completa: `Torres` encuentra `Torres Vega`, pero `Tor` no encuentra nada y `Torrez` tampoco. Tolerar erratas exige distancia de edición sobre texto claro, y eso es incompatible con el cifrado.
- **Deshacer el cifrado de los nombres.** Es la decisión que abarataría todo lo demás y no se toma aquí: ver §7.
- **Fusión de pacientes duplicados.** Este spec ayuda a encontrarlos; unirlos es otro spec.
- **Repoblar `investigationClinicalEvaluation.clinicalDetailsPersonName` y `evaluationInstitution.personName`.** No son nombres de paciente y nadie los busca.

---

## 3. Modelo de datos

### 3.1 Tabla origen — antes y después

`patient` — `esaviapp.sql:643-666`.

**Antes:**

| Columna | Tipo | Nulo |
|---|---|---|
| `firstName` | `text` | sí |
| `middleName` | `text` | sí |
| `lastName` | `text` | sí |
| `secondLastName` | `text` | sí |

*(Nota: el F45 §3 las describía como `varchar(150)`. Era un error — el DDL las declara `text` sin límite; el 150 sale de `createPatientValidator`, no del esquema.)*

**Después:**

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `names` | `text` | **no** | Cifrada. Todos los nombres de pila, en un campo |
| `lastNames` | `text` | **no** | Cifrada. Todos los apellidos, en un campo |
| `nameTokens` | `text[]` | no, `DEFAULT '{}'` | Tokens cifrados de la forma normal. Nunca se expone |

`NOT NULL` en las dos primeras es un endurecimiento, no un cambio: `createPatientService` ya exigía `firstName` y `lastName` (`patient.service.ts:125-126`). El esquema pasa a decir lo que el servicio ya hacía cumplir.

Índice nuevo, con el precedente de `IX_vaccineWhodrug_name` (`esaviapp.sql:624`):

```sql
CREATE INDEX IF NOT EXISTS "IX_patient_nameTokens" ON "patient" USING gin ("nameTokens");
```

Las cuatro columnas transversales del esquema —`isActive`, `deletedAt`, `sysDetails`, `appDetails`— no se tocan. `UQ_patient_documentNumber` tampoco.

### 3.2 Modelo Sequelize

`src/models/patient.model.ts`. Se sustituyen los cuatro atributos por `names` y `lastNames` (`DataTypes.TEXT`, `allowNull: false`) y se añade `nameTokens` como `DataTypes.ARRAY(DataTypes.TEXT)` con `defaultValue: []`. Se mantienen `timestamps: false`, `freezeTableName: true` y el `tableName` entrecomillado. No hay asociaciones nuevas.

### 3.3 La forma normal, que es el núcleo del spec

Dos helpers nuevos en `src/helpers/stringHandling.helper.ts`, exportados por el barrel que ya reexporta el archivo (`helpers/index.ts:16`).

**`toSearchForm(text)`** — cuatro pasos, en este orden:

1. `trim()`.
2. Colapsar todo espacio interno repetido en uno solo: `replace(/\s+/g, ' ')`.
3. Desacentuar: descomponer con `normalize('NFD')` y eliminar el rango de marcas diacríticas combinantes.
4. `toUpperCase()`.

`"  María  del Cisne "` → `"MARIA DEL CISNE"`. Es idempotente sobre su propia salida, que es la condición para poder usarla dentro de un update diferencial sin inventar diferencias.

**La `ñ` se convierte en `n`, y es deliberado.** `NFD` descompone `ñ` en `n` más una tilde combinante, y el paso 3 la elimina: `MUÑOZ` produce el token `MUNOZ`. En español la `ñ` es una letra propia, no una `n` acentuada, así que esto merece decirse en voz alta: **`Muñoz` y `Munoz` pasan a ser el mismo paciente a efectos de búsqueda.** Se acepta porque el teclado de captura rápida y los sistemas de origen escriben ambas indistintamente, y encontrar de más es recuperable —el operador descarta— mientras que no encontrar produce un duplicado. La columna mostrada conserva la `ñ` intacta.

**`toNameTokens(...values)`** — aplica `toSearchForm` a cada valor, parte por espacios, descarta los vacíos y devuelve la lista sin duplicados. `toNameTokens("María del Cisne", "Torres Vega")` → `["MARIA", "DEL", "CISNE", "TORRES", "VEGA"]`.

Las partículas —`DE`, `DEL`, `LA`, `Y`— **se indexan como cualquier otro token**. No hay lista de palabras vacías: con la semántica conjuntiva de §3.6, teclear `del` solo añade una restricción que el paciente cumple, y omitirlo no impide encontrarlo. Una lista de excepciones sería una fuente de discrepancias entre lo que se indexa y lo que se busca.

### 3.4 Tipos

`src/types/patient/patient.types.ts`:

```ts
export interface CreatePatientInput {
    names: string;
    lastNames: string;
    documentNumber: string;
    birthDate?: string | null;
    passportNumber?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    sexItemId?: string | null;
    residenceGeoLocationId?: string | null;
    isActive?: boolean;
}
```

Desaparecen `middleName` y `secondLastName`. El update sigue siendo `Partial<CreatePatientInput>`; no se declara `UpdatePatientInput`. `nameTokens` **no está en el input**: es derivado y el cliente no lo envía nunca.

### 3.5 Superficie HTTP

```
POST   /api/patients                       ESAVI-PATIENT-001   USER        (existe, cambia el body)
GET    /api/patients                       ESAVI-PATIENT-002A  USER        (existe, cambia data)
GET    /api/patients/admin                 ESAVI-PATIENT-002B  ADMIN       (existe, cambia data)
PATCH  /api/patients/activate/:id          ESAVI-PATIENT-005B  SUPERADMIN  (existe, sin cambios)
GET    /api/patients/search/:identifier    ESAVI-PATIENT-006   USER        (existe, cambia data)
GET    /api/patients/:id                   ESAVI-PATIENT-003   USER        (existe, cambia data)
PUT    /api/patients/:id                   ESAVI-PATIENT-004   USER        (existe, cambia el body)
DELETE /api/patients/:id                   ESAVI-PATIENT-005A  ADMIN       (existe, sin cambios)
```

No hay rutas nuevas ni cambia el orden de declaración: las literales siguen antes de `/:id` (`patient.routes.ts:51`).

### 3.6 Reglas de negocio por operación

**`ESAVI-PATIENT-001` — crear.** `names` y `lastNames` son obligatorios; su ausencia la corta el validador. Se normalizan para mostrar con `normalizeName` —`toTitleCase` ya corregido— y se cifran. `nameTokens` se calcula con `toNameTokens(names, lastNames)` sobre los valores **antes** de cifrar, y cada token se cifra individualmente con `esaviCrypt`. Unicidad de `documentNumber` sin filtrar por `isActive`, como hoy → 409 `PATIENT_001_DOCUMENT_EXISTS`. Entrada de auditoría con `method: 'ESAVI-PATIENT-001'`.

**`ESAVI-PATIENT-004` — actualizar.** Existencia → 404 `PATIENT_004_NOT_FOUND`. Unicidad de `documentNumber` excluyendo el propio id → 409 `PATIENT_004_DOCUMENT_EXISTS`, **antes** del diff. Validez de `sexItemId` y `residenceGeoLocationId` también antes del diff.

#### Contrato de update diferencial

`stored` sale de `patient.get({ plain: true })` —la fila completa, sin `attributes` acotados— con las columnas cifradas descifradas: la comparación es sobre texto plano, nunca ciphertext contra ciphertext. `esaviCrypt` se aplica **después** del diff. Diff con `buildDifferentialUpdate`; si vuelve vacío se devuelve la fila sin escribir.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `names` | `data.names ? normalizeName(data.names) : undefined` | obligatorio: no puede vaciarse |
| `lastNames` | `data.lastNames ? normalizeName(data.lastNames) : undefined` | obligatorio: no puede vaciarse |
| `nameTokens` | **siempre**, recalculado desde el `names` y `lastNames` resultantes | derivado: no va bajo un `if` de presencia |
| `documentNumber` | `data.documentNumber ? normalizeDocument(data.documentNumber) : undefined` | cifrado |
| `passportNumber` | `data.passportNumber !== undefined ? ( data.passportNumber ? normalizeDocument(data.passportNumber) : null ) : undefined` | anulable y cifrado |
| `email` | `data.email !== undefined ? ( data.email ? normalizeEmail(data.email) : null ) : undefined` | anulable y cifrado |
| `birthDate` | `data.birthDate !== undefined ? ( data.birthDate ? normalizeBirthDate(data.birthDate) : null ) : undefined` | anulable; dispara el recálculo de edades |
| `phoneNumber` | `data.phoneNumber !== undefined ? ( data.phoneNumber ? data.phoneNumber.trim() : null ) : undefined` | anulable |
| `sexItemId` | `data.sexItemId !== undefined ? ( data.sexItemId || null ) : undefined` | anulable |
| `residenceGeoLocationId` | `data.residenceGeoLocationId !== undefined ? ( data.residenceGeoLocationId || null ) : undefined` | anulable |

**`nameTokens` es el campo delicado de esta tabla.** Entra en `candidates` en toda actualización, calculado sobre el `names` y `lastNames` que van a quedar guardados —los nuevos si vinieron, los almacenados si no—, y se compara **como lista de texto plano** contra los tokens descifrados de `stored`. Es `buildDifferentialUpdate` quien decide si difiere. Dos consecuencias que hay que tener presentes:

- Un `PUT` que solo corrige el teléfono deja `nameTokens` idéntico y por tanto fuera del `UPDATE`. No hay reescritura espuria.
- Un `PUT` que cambia `María` por `Maria` **sí** cambia la columna mostrada, pero **no** los tokens: la forma normal de ambos es `MARIA`. El diff detecta el cambio en `names` y no en `nameTokens`, y escribe solo el primero. Es el comportamiento correcto y conviene que una prueba lo fije.

El recálculo de edades de `classification` cuando cambia `birthDate` se mantiene tal cual (`patient.service.ts:323-325`).

**`002A`, `002B`, `003`, `006`** — solo cambia qué columnas se leen y devuelven. `LIST_ATTRIBUTES` pasa a `['patientId', 'names', 'lastNames', 'documentNumber', 'birthDate', 'healthSystemCode', 'isActive']`. `PII_FIELDS` pasa a `['names', 'lastNames', 'documentNumber', 'passportNumber', 'email']`. `nameTokens` se añade a `DETAIL_EXCLUDE` junto a `sysDetails`.

**`005A` y `005B` no son escrituras diferenciales**, y siguen sin serlo: registran un hecho —la baja o el alta lógica— aunque ningún campo de datos cambie, y por eso no pasan por el helper. Van por `setEntityActiveStatusService` sin cambio alguno en este spec.

### 3.7 Validador

En `src/validators/patient.validator.ts`, `createPatientValidator` y `updatePatientValidator` sustituyen sus cuatro reglas de nombre por dos:

| Campo | Regla en create | Regla en update |
|---|---|---|
| `names` | `.trim().notEmpty()`, `.isLength({ max: 200 })` | `.optional().trim().notEmpty()`, `.isLength({ max: 200 })` |
| `lastNames` | `.trim().notEmpty()`, `.isLength({ max: 200 })` | `.optional().trim().notEmpty()`, `.isLength({ max: 200 })` |

200 y no 150: un campo que ahora carga tres nombres de pila o dos apellidos compuestos necesita más sitio, y la columna es `text` sin límite propio. El tope existe para que un cuerpo absurdo no llegue a la base de datos, no porque el esquema lo imponga.

### 3.8 Claves i18n nuevas

| Clave | Uso |
|---|---|
| `patient.namesRequired` | 400 cuando falta `names` o `lastNames` en el `001` |

| Clave | `es` | `en` | `nl` |
|---|---|---|---|
| `namesRequired` | Los nombres y los apellidos del paciente son obligatorios | Patient names and last names are required | Voornamen en achternamen van de patiënt zijn verplicht |

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

### 3.9 Forma de la respuesta

Detalle (`001`, `003`, `004`):

```
{ ok, message, data: {
    patientId, names, lastNames, birthDate, documentNumber, passportNumber,
    email, phoneNumber, healthSystemCode, isActive,
    sex: { catalogItemId, code, name },
    residence: { geoLocationId, name, geoLevelTypeId, level },
    createdAt, updatedAt, deletedAt, appDetails
} }
```

Listado (`002A`, `002B`, `006`): `{ count, rows }`, con `names` y `lastNames` descifrados en cada fila.

**`nameTokens` no aparece en ninguna respuesta, nunca.** Es maquinaria de búsqueda: exponerlo entregaría la forma normal cifrada de cada nombre y con ella la superficie de análisis de frecuencia de §8, a cualquiera con acceso al endpoint. Se excluye con `DETAIL_EXCLUDE` y quedando fuera de `LIST_ATTRIBUTES`.

---

## 4. Por qué ahora sí se puede corregir `toTitleCase`

El [SPEC F45 §4](45-patient-name-search.md) declaraba `toTitleCase` intocable, y tenía razón bajo su diseño: allí la columna mostrada era también la columna buscada, así que cambiar la normalización cambiaba la identidad almacenada y rompía la búsqueda en silencio.

**Este spec disuelve ese acoplamiento.** La búsqueda pasa a depender de `nameTokens`, no de la columna mostrada. `normalizeName` queda relegada a decidir cómo se ve un nombre, y una función de presentación se puede corregir sin que nada deje de encontrarse.

La corrección es de un carácter y medio: `/\w\S*/g` pasa a `/\p{L}\S*/gu`. Con ella `"ángel"` produce `"Ángel"` en vez de `"áNgel"`. Lo que cambia es el aspecto de las filas creadas a partir de ahora; lo que no cambia es que se encuentren, porque `toSearchForm` no pasa por ahí.

Sigue en pie el principio que F45 dejó escrito y que este spec hereda: **`toSearchForm` es ahora la función intocable.** Cambiarla —añadir una lista de palabras vacías, tratar los guiones, dejar de desacentuar la `ñ`— invalida todos los `nameTokens` ya escritos, y el fallo es silencioso: no hay error, solo resultados vacíos. Cualquier cambio en ella exige un repoblado de la columna, que con el modelo de este spec es barato —se recalcula desde `names` y `lastNames`, sin perder nada— pero no es opcional.

---

## 5. Plan de implementación

Once pasos. Cada uno deja el proyecto compilando y arrancable, y cada uno es committeable por separado. **El Paso 0 no es opcional.**

0. **Verificar el supuesto de §1D.** Confirmar que ninguna instalación tiene filas en `patient` que alguien quiera conservar. Si las hay, este plan se detiene y se escribe antes el paso de fusión y repoblado.
   *Verificación:* `SELECT count(*) FROM "patient";` en cada entorno declarado devuelve 0, o su contenido es descartable.

1. **`toSearchForm` y `toNameTokens` en `stringHandling.helper.ts`.** Con los cuatro pasos de §3.3, y pruebas unitarias propias.
   *Verificación:* `toSearchForm("  María  del Cisne ")` devuelve `"MARIA DEL CISNE"`; aplicarla dos veces da lo mismo que aplicarla una; `toNameTokens("Muñoz")` devuelve `["MUNOZ"]`.

2. **Extraer `normalizeName` al helper y corregir `toTitleCase`.** `normalizeName` sube desde `patient.service.ts:20`; se borran las copias de `notifier.service.ts:20` y `normalizeFullName` de `investigationTeamMember.service.ts:172`, renombrando sus llamadas. `toTitleCase` pasa a `/\p{L}\S*/gu`.
   *Verificación:* `grep -rn "const normalizeName\|const normalizeFullName" src/services/` no devuelve nada; `toTitleCase("ángel")` devuelve `"Ángel"`; `npm test` en verde.

3. **`esaviapp.sql`.** Las cuatro columnas pasan a `names` y `lastNames` (`text NOT NULL`), se añade `nameTokens text[] NOT NULL DEFAULT '{}'` y el índice GIN de §3.1.
   *Verificación:* `tests/setup/database.test.ts` carga el esquema sin error y `\d patient` muestra las tres columnas y el índice.

4. **Modelo.** `src/models/patient.model.ts` según §3.2.
   *Verificación:* `npm run build` en 0.

5. **Tipos.** `CreatePatientInput` según §3.4.
   *Verificación:* `npm run build` falla en todos los sitios que aún usan los campos viejos, que es la lista de trabajo de los pasos siguientes.

6. **Validadores.** Las dos reglas de §3.7 en create y update.
   *Verificación:* un `POST` sin `lastNames` responde 400.

7. **Clave i18n.** `patient.namesRequired` en los tres archivos.
   *Verificación:* `npm run i18n:check` en 0.

8. **`ESAVI-PATIENT-001`.** Create con `names`, `lastNames` y el cálculo de `nameTokens`.
   *Verificación:* crear `names: "  maría  del cisne "`, `lastNames: "Torres Vega"` guarda `"María Del Cisne"` como mostrado y `["MARIA","DEL","CISNE","TORRES","VEGA"]` cifrados como tokens.

9. **`ESAVI-PATIENT-004`.** Update diferencial con la tabla de `candidates` de §3.6 y `nameTokens` como derivado.
   *Verificación:* reenviar la respuesta del `GET` no escribe nada; cambiar `María` por `Maria` escribe `names` y **no** `nameTokens`.

10. **Lecturas.** `LIST_ATTRIBUTES`, `PII_FIELDS`, `DETAIL_EXCLUDE` y las respuestas de `002A`, `002B`, `003` y `006`.
    *Verificación:* ninguna respuesta de la API contiene la cadena `nameTokens`.

11. **Pruebas de contrato.** `tests/contract/patient.test.ts` reescrito sobre el modelo nuevo, más los casos de tokens y los cinco de diferencial.
    *Verificación:* `npm run check` en 0.

---

## 6. Criterios de aceptación

- [ ] `esaviapp.sql` declara `names` y `lastNames` como `text NOT NULL`, `nameTokens` como `text[]`, y el índice `IX_patient_nameTokens`.
- [ ] `grep -rn "middleName\|secondLastName" src/ tests/ --exclude-dir=logs` no devuelve resultados.
- [ ] Crear con `names: "  maría  del cisne "` guarda `"María Del Cisne"` en la columna mostrada.
- [ ] Ese mismo paciente tiene exactamente los tokens `MARIA`, `DEL`, `CISNE` más los de sus apellidos, cifrados uno a uno.
- [ ] `toSearchForm` es idempotente: aplicarla a su propia salida devuelve la misma cadena.
- [ ] `toSearchForm("Muñoz")` devuelve `"MUNOZ"`, y una prueba lo fija como comportamiento buscado, no como accidente.
- [ ] `toTitleCase("ángel")` devuelve `"Ángel"` y `toTitleCase("ÁNGEL")` devuelve `"Ángel"`.
- [ ] Un paciente con tres nombres de pila se guarda y se recupera íntegro.
- [ ] Ninguna respuesta de `001`, `002A`, `002B`, `003`, `004` ni `006` contiene la clave `nameTokens`.
- [ ] Un `POST` sin `names` o sin `lastNames` responde 400 con `patient.namesRequired`.
- [ ] Los cinco puntos del código de operación coinciden en `001` y `004`: ruta, controlador, servicio, `AppError` y `appDetails.method`.

**Update diferencial:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/patient.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `documentNumber` ya ocupado **409**, aunque el resto del body no cambie nada.
- [ ] Un `PUT` que reenvía el `names` guardado deja la columna cifrada idéntica byte a byte.
- [ ] Un `PUT` que cambia `"María"` por `"Maria"` escribe `names` y **no** `nameTokens`.
- [ ] Un `PUT` que solo corrige `phoneNumber` no toca `nameTokens`.

**Cierre:**

- [ ] `npm run check` sale en 0.

---

## 7. Decisiones tomadas y descartadas

- **Sí:** dos columnas, `names` y `lastNames`. Cuatro columnas fijas no representan tres nombres de pila ni un apellido compuesto, y `patient` era la única tabla del esquema que partía el nombre en cuatro.
- **Sí:** hacerlo ahora, sin migración. El sistema está en desarrollo y no hay datos que conservar (§1D). La misma fusión dentro de seis meses cuesta un script de repoblado con su ventana de indisponibilidad.
- **Sí:** índice de tokens en columna propia. Es lo único que hace que `Torres` encuentre a `Torres Vega` sin descifrar el padrón en cada búsqueda. La igualdad sobre la columna entera —el diseño original de F45— no resuelve el caso de uso que se pidió.
- **Sí:** separar la columna mostrada de la columna buscada. Es lo que permite conservar `María del Cisne` con su tilde y su minúscula en pantalla mientras se busca contra `MARIA DEL CISNE`. Ninguna de las dos alternativas —guardar todo en mayúsculas, o buscar contra el texto tal cual— consigue las dos cosas.
- **Sí:** cifrar cada token con `esaviCrypt` en vez de introducir un HMAC. El repositorio ya tiene una primitiva determinista y auditada; añadir una segunda función criptográfica es superficie nueva a cambio de nada, porque quien tiene la clave puede descifrar los nombres de todos modos.
- **Sí:** desacentuar también la `ñ`. Ver §3.3. Encontrar de más es recuperable; no encontrar produce un duplicado.
- **Sí:** indexar las partículas como tokens normales. Una lista de palabras vacías es una fuente de discrepancias entre lo que se indexa y lo que se busca.
- **No:** dejar de cifrar los nombres. Es la decisión que abarataría todo esto: con texto claro habría `pg_trgm`, similitud, tolerancia a erratas y ordenación alfabética, que hoy no existe —`LIST_ORDER` ordena por `createdAt` justamente porque ordenar por ciphertext es ordenar por ruido. No se toma porque son datos de salud de personas identificadas y el cifrado en reposo es un requisito del sistema, no una preferencia. Queda anotado como el coste real de ese requisito.
- **No:** búsqueda por prefijo. `Tor` no encontrará a `Torres`. Los tokens dan palabra completa; el prefijo exige n-gramas cifrados, que multiplican el tamaño del índice y agravan el análisis de frecuencia de §8.
- **No:** guardar el nombre entero en mayúsculas y sin tildes en la columna mostrada. Era la propuesta inicial y se descarta porque la pérdida es irreversible y contamina todas las pantallas, reportes y actas, para resolver un problema que la columna de tokens resuelve sin perder nada.
- **No:** aplicar el modelo a `appUser` y `notifier` en este spec. Ya tienen dos columnas; su normalización se anota en §8 y se resuelve cuando alguien necesite buscarlos.

---

## 8. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Análisis de frecuencia sobre `nameTokens`.** Quien lea la base de datos ve tokens cifrados repetidos y puede inferir los apellidos comunes por su frecuencia: el token que más se repite es casi con seguridad `GARCIA` | Es inherente a todo índice ciego determinista y no tiene solución dentro de este diseño. Se acepta porque la alternativa es no cifrar. Se acota no exponiendo nunca la columna por la API (§3.9) y dejando el acceso directo a la base como el mismo riesgo que ya existe sobre los nombres cifrados |
| Cambiar `toSearchForm` invalida en silencio todos los tokens escritos | §4 la declara intocable. El repoblado es barato con este modelo —se recalcula desde `names` y `lastNames`— pero obligatorio; conviene una prueba que fije su salida sobre un juego de nombres |
| Alguien implementa el plan sobre una instalación con datos y pierde los nombres | El Paso 0 lo verifica antes de tocar nada, y §1D declara el supuesto en el encabezado del spec |
| `nameTokens` se filtra en una respuesta al añadir un endpoint nuevo | Está en `DETAIL_EXCLUDE` y fuera de `LIST_ATTRIBUTES`; un criterio de aceptación comprueba que la cadena no aparece en ninguna respuesta |
| El frontend en desarrollo sigue enviando `firstName` y `middleName` | El validador los ignora y `names` falta → 400 explícito con `patient.namesRequired`, no un 500 ni un guardado a medias. Ver §9 |
| `appUser` y `notifier` conservan la normalización vieja y su defecto de tildes | Anotado, fuera de alcance. Nadie los busca por nombre hoy; cuando haga falta, este spec es la plantilla |

---

## 9. Impacto en el contrato HTTP

**Es un cambio incompatible, y afecta a los cuatro endpoints de lectura y a los dos de escritura.**

| Antes | Después |
|---|---|
| `body: { firstName, middleName, lastName, secondLastName }` | `body: { names, lastNames }` |
| `data: { firstName, middleName, lastName, secondLastName, … }` | `data: { names, lastNames, … }` |

Se asume sin coste porque no hay clientes en producción: el frontend está en desarrollo junto al backend (§1D). Un cliente que siga enviando los campos viejos recibe un **400** con `patient.namesRequired` —no un 500, y no un paciente guardado sin nombre—, que es la forma en que este cambio debe manifestarse.

**El [SPEC F45](45-patient-name-search.md) queda supeditado a éste** y se reescribe una vez implementado. Lo que sobrevive de él: el endpoint `ESAVI-PATIENT-007`, el rol mínimo `USER`, el `200` con `count: 0` en vez de `404`, la señal `inactiveCount` de coincidencias inactivas y el análisis de superficie de enumeración. Lo que desaparece: toda su §3.2 —la semántica de «campo vacío significa `IS NULL`»—, que era la parte más frágil de aquel diseño y que este modelo vuelve innecesaria. Lo que cambia: el `where` deja de ser una conjunción de cuatro igualdades y pasa a ser una comprobación de que `nameTokens` contiene todos los tokens de lo tecleado — conjunción de tokens, no de columnas, de modo que teclear `Torres` devuelve a todos los `Torres` y añadir `Vega` los reduce.

---

## Lo que **no** está en este spec

- El endpoint de búsqueda `ESAVI-PATIENT-007`, que es del SPEC F45 y se reescribe después de éste.
- Búsqueda por prefijo, por similitud o tolerante a erratas.
- Aplicar el modelo de dos columnas a `appUser`, `notifier` o `investigationTeamMember`.
- Dejar de cifrar los nombres.
- Fusión o deduplicación de pacientes ya duplicados.
- Cualquier migración de datos existentes: este spec asume que no los hay y lo verifica en el Paso 0.

Cada uno de esos, si aterriza, va en su propio spec.
