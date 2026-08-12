# SPEC F11 — Propagación del recálculo de edad en `classification`

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F05 (`patient` — se modifica `ESAVI-PATIENT-004`)**, **SPEC F06 (`esaviCase` — se modifica `ESAVI-CASE-004`)**, **SPEC F09 (`classification` — dependencia dura: sin la entidad implementada no hay nada que recalcular)**, **[SPEC F12](./12-differential.md) (`buildDifferentialUpdate` — este spec usa la comparación del valor recalculado contra el guardado como disparador, y el F12 es quien la instala en los doce servicios; van en ese orden, no en paralelo)**
> **Fecha:** 2026-08-11
> **Objetivo:** Hacer que la edad guardada en `classification` deje de contradecir a su origen, recalculándola dentro de la misma transacción cuando `ESAVI-PATIENT-004` cambia `birthDate` o `ESAVI-CASE-004` cambia `eventDate`, y cerrando el tercer camino —`patientId` mutable— haciéndolo inmutable.

---

## 1. Por qué existe este spec

El [SPEC F09](./09-classification-crud.md) introdujo el primer dato **derivado** del repositorio: `classification.age` y `classification.ageUnitItemId` no se capturan, se calculan desde `patient.birthDate` y `esaviCase.eventDate`. Y dejó abierto, a propósito, el problema que crea todo dato derivado: qué pasa cuando su origen cambia después.

Está escrito en tres sitios de aquel spec, y este spec existe para cerrarlos:

**A — §2, «Fuera de alcance»:** «*Recalcular la edad de las clasificaciones ya guardadas cuando cambien `patient.birthDate` o `esaviCase.eventDate`. Va en su propio spec: obliga a modificar dos servicios cerrados y a decidir qué pasa con las clasificaciones inactivas*».

**B — §6, «No, todavía»:** la decisión quedó aplazada, no descartada.

**C — §7, primer riesgo, con el diagnóstico exacto:** «*Si alguien corrige `patient.birthDate` o `esaviCase.eventDate` después de clasificar, la clasificación conserva la edad vieja y **nada avisa**… El riesgo real no es que no se pueda arreglar, es que nadie sepa que hay que hacerlo*».

Hoy, con el F09 implementado, la corrección existe pero es invisible: hay que saber que un `PUT` vacío sobre la clasificación la recalcula. Una edad epidemiológica equivocada no rompe nada, no lanza ningún error y no aparece en ningún log — simplemente clasifica mal un caso, que es el peor modo de fallo posible en un sistema de vigilancia.

**Hay un tercer camino que el F09 no menciona.** `ESAVI-CASE-004` permite hoy cambiar el `patientId` del caso (`src/services/esaviCase.service.ts:292-293` y `:312`). Cambiar de paciente cambia la `birthDate` de origen exactamente igual que editarla, así que la propagación tendría que cubrir tres disparadores y no dos. Este spec lo resuelve por la vía contraria: **elimina el camino** haciendo `patientId` inmutable en el `004`, con el mismo criterio con el que el F06 hizo inmutable `caseCode` y el F09 hizo inmutable `caseId`.

**Es el primer spec del repositorio sin superficie HTTP propia.** No crea ninguna entidad, ninguna ruta, ningún código de operación nuevo y ninguna fila en `ROUTE_RULES`. Todo lo que hace es cambiar el **efecto lateral** de dos endpoints ya publicados. Por eso su §3 no se desglosa en 3.1–3.7 y se escribe con tablas Antes/Después, como los specs transversales 01 a 08.

**Consecuencia estructural:** para poder recalcular y fallar sin dejar el sistema a medias, `updatePatientService` y `updateEsaviCaseService` tienen que abrir transacción, y hoy **ninguno de los dos la abre** (`src/services/patient.service.ts:219-282`, `src/services/esaviCase.service.ts:286-343`). Las transacciones existen ya en el repositorio, pero solo en las activaciones (`patient.service.ts:326`, `esaviCase.service.ts:390`) y en las purgas del F08.

---

## 2. Alcance

**Dentro:**

- **Recálculo en `ESAVI-PATIENT-004`**, cuando el `birthDate` resultante difiere del guardado: se recalculan las clasificaciones **activas** de **todos** los casos del paciente, cada una contra el `eventDate` de su propio caso.
- **Recálculo en `ESAVI-CASE-004`**, cuando el `eventDate` resultante difiere del guardado: se recalcula la clasificación **activa** del caso, que es una como mucho por `UQ_classification_case`.
- **Disparo condicionado al cambio real de valor.** Un `PUT` de paciente que solo toca el teléfono no lanza ninguna consulta adicional. La comparación es sobre el valor resultante normalizado contra el guardado, no sobre la presencia de la clave en el body.
- **Auditoría condicionada al cambio real de la edad.** Solo se añade entrada a `appDetails` de la clasificación cuando `age` o `ageUnitItemId` cambian de verdad, con `method: 'ESAVI-PATIENT-004'` o `'ESAVI-CASE-004'` —el código de la operación que la modificó, no `ESAVI-CLASSIF-004`—, siguiendo el criterio que el F07 fijó para la cascada.
- **Transacción en los dos servicios de update.** `updatePatientService` y `updateEsaviCaseService` pasan a abrir transacción propia, con `commit` y `rollback`, y a propagarla a todas sus escrituras. Es un cambio previo y aislado, sin efecto observable por sí solo.
- **El fallo del recálculo aborta el `PUT` entero.** Si el `eventDate` resultante precede al `birthDate` resultante → **409**; si falta el item `YEARS`, `MONTHS` o `DAYS` del `catalogType` `ageUnit` → **404**. En los dos casos se hace `rollback`: ni el paciente ni el caso quedan modificados.
- **`patientId` inmutable en `ESAVI-CASE-004`**: se ignora si llega en el body, sin error, y `assertPatientIsValid` deja de invocarse desde el `004` (sigue en el `001`).
- **Reutilización de `resolveAgeAtEvent`** (`src/helpers/age.helper.ts`, creado por el F09) y de la resolución del item de catálogo. Ninguna aritmética de fechas nueva: si hubiera dos implementaciones del cálculo, divergirían.
- **Un único servicio común de propagación**, invocado desde los dos disparadores, para que la regla viva en un solo sitio.
- Ampliación de `tests/contract/patient.test.ts`, `tests/contract/esaviCase.test.ts` y `tests/contract/classification.test.ts`.

**Fuera de alcance (otros specs):**

- **Cualquier endpoint de recálculo**, ni por caso, ni por paciente, ni masivo. Este spec no añade ninguna ruta, ningún código de operación y ninguna fila en `ROUTE_RULES`, que se queda en 99. La vía manual del F09 —un `PUT` sobre la clasificación— sigue existiendo y no se toca.
- **El backfill de las clasificaciones creadas antes de este spec.** Las que ya arrastren una edad obsoleta seguirán arrastrándola hasta que alguien toque su paciente, su caso o la propia clasificación. Un repaso global es un job, no un endpoint, y va en su propio spec.
- **Propagar a clasificaciones inactivas.** Una clasificación retirada conserva su edad, su `deletedAt` y su `appDetails` intactos, exactamente como en la cascada del F07 y del F09.
- **Anular la edad cuando una fecha pasa a `null`.** El valor guardado se conserva; la decisión y su tensión están razonadas en §6.
- **Validar `birthDate` contra `eventDate` en el alta del paciente** (`ESAVI-PATIENT-001`) o en la del caso: en el alta no hay clasificación todavía y no hay nada que recalcular.
- **Propagar a `notification`, `investigation` o `finalClassification`.** Ninguna está implementada, y la de `notification` está aún en `Borrador` (SPEC F10). Cuando alguna guarde un dato derivado de las mismas fechas, se suma al servicio común que este spec crea — igual que `classification` se sumó a la cascada del F07.
- **Recalcular al reactivar una clasificación con `ESAVI-CLASSIF-005B`**, aunque su edad se haya quedado atrás mientras estaba inactiva.
- **Emitir cualquier aviso al cliente** de que la propagación ocurrió: la respuesta de los dos `PUT` no cambia de forma.
- Cualquier modificación de `esaviapp.sql`, incluido cualquier trigger que hiciera el recálculo en base de datos.
- Hacer inmutable ningún otro campo aparte de `patientId`.

---

## 3. Modelo de datos

No hay tabla nueva, ni columna nueva, ni modelo nuevo. `esaviapp.sql` no se toca. Lo que cambia son **dos servicios** y aparece **uno común**.

### 3.1 Qué cambia, servicio por servicio

**`updatePatientService` — `ESAVI-PATIENT-004`** (`src/services/patient.service.ts:219-282`)

| | Antes | Después |
|---|---|---|
| Transacción | No abre ninguna. La escritura del paciente es autónoma | Abre transacción propia, con `commit` y `rollback`, como ya hace `setPatientActivationService` (`:326`) |
| `birthDate` | Se normaliza y se escribe | Igual, y además se compara el valor **resultante** con el guardado |
| Efecto sobre `classification` | Ninguno. La edad guardada queda obsoleta en silencio | Si el `birthDate` cambió, se recalculan las clasificaciones **activas** de todos los casos del paciente |
| Errores posibles | 404 `PATIENT_004_NOT_FOUND`, 409 `PATIENT_004_DOCUMENT_EXISTS`, 404 de `sexItemId` y de `residenceGeoLocationId` | Los mismos, más **409** `PATIENT_004_AGE_RECALC_INVALID_RANGE` y **404** `PATIENT_004_AGE_RECALC_CATALOG_MISSING` |
| Forma de la respuesta | `{ ok, message, data }` con la ficha del paciente | **Sin cambios** |

**`updateEsaviCaseService` — `ESAVI-CASE-004`** (`src/services/esaviCase.service.ts:286-343`)

| | Antes | Después |
|---|---|---|
| Transacción | No abre ninguna | Abre transacción propia, como ya hace `setEsaviCaseActivationService` (`:390`) |
| `patientId` | Mutable: se valida con `assertPatientIsValid` (`:293`) y se escribe (`:312`) | **Inmutable**: se ignora si llega, sin error. Las dos líneas desaparecen del `004`; `assertPatientIsValid` sigue viva para el `001` |
| `eventDate` | Se normaliza, se comprueba contra `reportDate` y se escribe | Igual, y además se compara el valor **resultante** con el guardado |
| Efecto sobre `classification` | Ninguno | Si el `eventDate` cambió, se recalcula la clasificación **activa** del caso, si la hay |
| Errores posibles | 404 `CASE_004_NOT_FOUND`, 404 de paciente y de establecimiento, 400 `CASE_004_INVALID_DATE_RANGE` | Los mismos **menos** el 404 de paciente, más **409** `CASE_004_AGE_RECALC_INVALID_RANGE` y **404** `CASE_004_AGE_RECALC_CATALOG_MISSING` |
| Forma de la respuesta | `{ ok, message, data }` con la ficha del caso | **Sin cambios** |

La comprobación de coherencia `eventDate <= reportDate` que ya existe (`:307-309`) se mantiene **antes** del recálculo y sigue devolviendo **400**. Son dos reglas distintas: aquélla cruza dos columnas de la misma fila, ésta cruza dos tablas.

### 3.2 El servicio común de propagación

Archivo nuevo: `src/services/common/ageRecalculation.service.ts`, junto a `entityActivation.service.ts` y `entityPurge.service.ts`. Es el único sitio donde vive la regla, invocado desde los dos disparadores.

Firma propuesta:

```ts
recalculateClassificationAgesService(
    scope: { patientId: string } | { caseId: string },
    op: 'ESAVI-PATIENT-004' | 'ESAVI-CASE-004',
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<number>   // cuántas clasificaciones cambiaron de edad
```

**Fila por fila, no `update` masivo.** Es la diferencia con la cascada del F07: allí todas las filas recibían el mismo valor y un solo `UPDATE` bastaba; aquí cada clasificación se compara contra el `eventDate` de **su** caso, así que el valor difiere por fila y no hay un `SET` común. Por eso el servicio devuelve un contador y no un booleano.

**Orden dentro de la transacción: primero se escribe, después se recalcula.** El paciente o el caso se actualizan primero, y la lectura del recálculo va con la misma `transaction`, así que ve los valores nuevos sin necesidad de pasárselos por parámetro. Si el recálculo lanza, el `rollback` deshace también esa escritura.

**Consulta.** Se parte siempre de `Classification`, no del paciente: no existe `Patient.hasMany(EsaviCase)` —omisión deliberada del F06, `src/models/associations/esaviCase.associations.ts:5`— y este spec no la añade.

- Ámbito `caseId`: `Classification.findOne({ where: { caseId, isActive: true }, include: [{ association: 'case', include: [{ association: 'patient' }] }], transaction })`.
- Ámbito `patientId`: `Classification.findAll({ where: { isActive: true }, include: [{ association: 'case', required: true, where: { patientId }, include: [{ association: 'patient' }] }], transaction })`.

El `include` del caso **no** filtra por `isActive`: un caso desactivado con clasificación activa es un estado que la cascada del F07 no produce, pero que `ESAVI-CLASSIF-005B` sí permite alcanzar —el F09 decidió que reactivar una clasificación no exige que su caso esté activo—, y en ese estado la clasificación sigue siendo un dato vivo.

**Por cada fila:**

1. Si falta `patient.birthDate` o falta `case.eventDate` → **no se toca la fila**. Ni se recalcula ni se anula: el valor guardado sobrevive. Razonado en §6.
2. Si `eventDate` precede a `birthDate` → lanza **409** `<ENTITY>_004_AGE_RECALC_INVALID_RANGE`, con `<ENTITY>` = `PATIENT` o `CASE` según el disparador. Aborta el `PUT` entero.
3. Si no, `resolveAgeAtEvent(birthDate, eventDate)` —el helper puro del F09, sin reimplementar nada— y el item se resuelve por `code` (`YEARS`, `MONTHS`, `DAYS`) dentro del `catalogType` de código `ageUnit`, con `isActive: true`. Si no aparece → **404** `<ENTITY>_004_AGE_RECALC_CATALOG_MISSING`.
4. Si el `age` y el `ageUnitItemId` resultantes coinciden con los guardados → **no se escribe nada**: ni `updatedAt`, ni entrada de auditoría. No hay cambio que registrar.
5. Si difieren → se escribe `age`, `ageUnitItemId`, `updatedAt` explícito —no hay trigger que lo haga— y se anexa una entrada a `appDetails` preservando el historial con `[...currentAppDetails, newEntry]`, con `method` igual al `op` recibido y un `detail` que nombra la causa («*Age recalculated after its patient's birthDate changed*» / «*…after its case's eventDate changed*»).

El servicio **no** toca ningún otro campo de la clasificación: los nueve booleanos de gravedad, `firstConsultationDate`, `notes` y el resto quedan como estaban. En particular **no** reevalúa la matriz de coherencia de gravedad del F09: esta operación no recibe body y no puede alterar ningún `caused*`.

**El recálculo no pasa por `updateClassificationService`.** Aquel servicio espera un body, evalúa la matriz y escribe `method: 'ESAVI-CLASSIF-004'`; llamarlo desde aquí mentiría en la auditoría y arrastraría reglas que no aplican.

### 3.3 Resolución del item de catálogo

Se resuelve **una sola vez por invocación**, no una por fila: los tres códigos posibles son fijos y el `catalogType` es el mismo para todas. El ámbito `patientId` con N clasificaciones hace una consulta al catálogo, no N.

Si el `catalogType` `ageUnit` o alguno de sus tres items falta, el error se produce en la primera fila que lo necesite y aborta el `PUT`. Es la misma precondición de despliegue que el F09 declaró, con el mismo alcance: sin catálogo sembrado, no hay edad.

### 3.4 Claves i18n

**Ninguna clave nueva.** Se reutilizan las dos que el F09 ya define en el bloque `classification` de `es.json`, `en.json` y `nl.json`, porque la causa es exactamente la misma y el texto ya la describe:

| Clave existente | Uso nuevo |
|---|---|
| `classification.invalidAgeRange` | 409 cuando el `eventDate` resultante precede al `birthDate` resultante, disparado desde `PATIENT-004` o `CASE-004` |
| `classification.ageUnitCatalogMissing` | 404 cuando falta el item `YEARS`, `MONTHS` o `DAYS` del catálogo `ageUnit`. Lleva `{{code}}` |

Lo que **sí** distingue el origen es el código del `AppError`, que lleva la entidad y la operación: `PATIENT_004_AGE_RECALC_INVALID_RANGE` frente a `CLASSIF_001_INVALID_AGE_RANGE`. El mensaje explica al usuario qué pasó; el código dice al operador desde dónde. `npm run i18n:check` no cambia de resultado porque no se añade ni se quita ninguna clave.

### 3.5 Códigos de operación

**No se crea ninguno.** El recálculo es un efecto lateral de `ESAVI-PATIENT-004` y `ESAVI-CASE-004`, y usa sus códigos en los cinco puntos: ruta, controlador, servicio, `AppError` y `appDetails.method`. No se añade ninguna abreviatura a `references/CONVENTIONS.md` §6 ni ninguna fila a la tabla de operaciones no canónicas.

---

## 4. Plan de implementación

**Precondición.** El **SPEC F09 debe estar implementado**. Hoy no lo está: no existen `src/models/classification.model.ts`, `src/services/classification.service.ts`, `src/helpers/age.helper.ts` ni `tests/unit/`. Sin el modelo `Classification` y sin `resolveAgeAtEvent`, ningún paso de este plan es ejecutable. Sigue vigente además la precondición del propio F09: el `catalogType` `ageUnit` con sus tres items sembrado.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Transacción en `updatePatientService`.** Envolver el cuerpo actual en `sequelize.transaction()` con `commit` y `rollback`, propagándola a la comprobación de unicidad de `documentNumber`, a las dos validaciones de FK y al `patient.update`. Sin ningún cambio de comportamiento.
   *Verificación:* `npm test -- patient` en verde sin tocar ni un caso de la suite; un `PUT` con `documentNumber` duplicado sigue devolviendo 409 y el paciente sigue intacto.

2. **Transacción en `updateEsaviCaseService`.** Lo mismo sobre `src/services/esaviCase.service.ts:286-343`, propagándola a las validaciones de FK y al `esaviCase.update`.
   *Verificación:* `npm test -- esaviCase` en verde sin tocar ningún caso; el 400 de `invalidDateRange` sigue saliendo antes de escribir nada.

3. **`patientId` inmutable en `ESAVI-CASE-004`.** Quitar `assertPatientIsValid` del `004` (`:292-293`) y `patientId` del `objectToUpdate` (`:312`). El comentario de cabecera del servicio pasa a nombrar los dos campos ignorados, `caseCode` y `patientId`, con su razón. `assertPatientIsValid` se mantiene, la usa el `001`.
   *Verificación:* un `PUT /api/esavi-cases/:id` con un `patientId` distinto y válido devuelve **200** y el caso conserva su paciente original; con un `patientId` inexistente devuelve **200** y no 404, porque ya ni se mira; `grep -n "assertPatientIsValid" src/services/esaviCase.service.ts` deja exactamente dos apariciones, la definición y la llamada del `001`.

4. **Servicio común de propagación.** `src/services/common/ageRecalculation.service.ts` con `recalculateClassificationAgesService` según §3.2: los dos ámbitos, la resolución del catálogo una sola vez, los cinco pasos por fila, `updatedAt` explícito y `[...currentAppDetails, newEntry]`. Reutiliza `resolveAgeAtEvent` sin reimplementar aritmética. Todavía no lo llama nadie.
   *Verificación:* `npm run build` en 0; `npm test` sigue en verde porque ningún camino lo invoca.

5. **Enganche en `ESAVI-CASE-004`.** Tras escribir el caso y dentro de la transacción, comparar el `eventDate` resultante con el guardado y, si difiere, invocar el servicio con `{ caseId }` y `op: 'ESAVI-CASE-004'`.
   *Verificación:* corregir el `eventDate` de un caso clasificado cambia el `age` de su clasificación y le añade una entrada `ESAVI-CASE-004` en `appDetails`; un `PUT` que solo toca `details` no modifica la clasificación ni añade entrada; mover el `eventDate` a antes del nacimiento del paciente devuelve **409** y el caso conserva su `eventDate` anterior; un caso sin clasificación responde 200; un caso cuya clasificación está inactiva responde 200 y la clasificación no cambia.

6. **Enganche en `ESAVI-PATIENT-004`.** Igual, comparando el `birthDate` resultante con el guardado e invocando con `{ patientId }` y `op: 'ESAVI-PATIENT-004'`.
   *Verificación:* corregir el `birthDate` de un paciente con dos casos clasificados actualiza **las dos** clasificaciones, cada una según el `eventDate` de su caso; un `PUT` que solo toca el teléfono no toca ninguna; poner el `birthDate` después del `eventDate` de uno de los casos devuelve **409** y el paciente conserva su `birthDate` anterior — la prueba real de la transacción del paso 1; poner el `birthDate` en `null` devuelve 200 y las clasificaciones conservan su edad.

7. **Tests de contrato.** Ampliar `tests/contract/patient.test.ts` y `tests/contract/esaviCase.test.ts` con los casos de los pasos 5 y 6, y `tests/contract/classification.test.ts` con la comprobación de que la edad propagada coincide con la que devolvería un `PUT` sobre la propia clasificación. Ninguna suite pierde casos y `ROUTE_RULES` no cambia: sigue en 99 filas.
   *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

**Propagación desde el paciente**

- [ ] Corregir `birthDate` en `PUT /api/patients/:id` actualiza `age` y `ageUnitItemId` de **todas** las clasificaciones activas de los casos de ese paciente.
- [ ] Con dos casos de `eventDate` distinto, cada clasificación recibe la edad que le corresponde según **su** caso, no la misma para las dos.
- [ ] Un `PUT` que no incluye `birthDate` no modifica ninguna clasificación ni añade ninguna entrada a su `appDetails`.
- [ ] Un `PUT` que incluye `birthDate` con **el mismo valor** que ya estaba tampoco dispara nada.
- [ ] Una clasificación **inactiva** conserva su `age`, su `ageUnitItemId`, su `updatedAt` y su `appDetails` sin ninguna entrada nueva.
- [ ] La clasificación modificada registra `method: 'ESAVI-PATIENT-004'` en `appDetails`, no `'ESAVI-CLASSIF-004'`, y las entradas anteriores siguen ahí.

**Propagación desde el caso**

- [ ] Corregir `eventDate` en `PUT /api/esavi-cases/:id` actualiza la clasificación activa del caso.
- [ ] Un caso sin clasificación devuelve **200** y no falla.
- [ ] Un `PUT` que no toca `eventDate` no modifica la clasificación.
- [ ] La clasificación modificada registra `method: 'ESAVI-CASE-004'`.
- [ ] El 400 `CASE_004_INVALID_DATE_RANGE` de `eventDate` contra `reportDate` sigue saliendo **antes** que cualquier recálculo.

**Transaccionalidad**

- [ ] Un `PUT` de paciente que dejaría el `birthDate` después del `eventDate` de un caso clasificado devuelve **409** y el paciente **conserva su `birthDate` anterior**: nada se guardó.
- [ ] En ese mismo escenario, ninguna otra clasificación del paciente quedó modificada, ni siquiera las procesadas antes de la que falló.
- [ ] El mismo escenario desde `PUT /api/esavi-cases/:id` devuelve **409** y el caso conserva su `eventDate` anterior.
- [ ] Sin el item `YEARS`, `MONTHS` o `DAYS` del catálogo `ageUnit`, los dos `PUT` devuelven **404** `ageUnitCatalogMissing` y no guardan nada.
- [ ] Los códigos de `AppError` son `PATIENT_004_AGE_RECALC_*` y `CASE_004_AGE_RECALC_*`, distintos de los `CLASSIF_*` del F09.

**Fechas ausentes**

- [ ] Poner `birthDate` en `null` devuelve **200** y las clasificaciones conservan la edad que tenían: no se anula.
- [ ] Poner `eventDate` en `null` devuelve **200** con el mismo resultado.
- [ ] Volver a informar la fecha después vuelve a recalcular y deja la edad correcta.

**`patientId` inmutable**

- [ ] Enviar un `patientId` distinto en `PUT /api/esavi-cases/:id` devuelve **200** y el caso conserva su paciente original.
- [ ] Enviar un `patientId` inexistente devuelve **200**, no 404: el campo ya ni se valida en el `004`.
- [ ] `POST /api/esavi-cases` sigue exigiendo `patientId` existente y activo, con su 404 intacto.

**Cierre**

- [ ] No hay ninguna clave i18n nueva y `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` sigue en **99** filas y `npm test -- roles` pasa.
- [ ] `grep -rn "resolveAgeAtEvent" src/` muestra una sola definición: el helper del F09, sin copias.
- [ ] `esaviapp.sql` no tiene ni una línea modificada.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre los disparadores**

- **Sí:** `birthDate` en `PATIENT-004` y `eventDate` en `CASE-004`. Son los dos que el F09 nombró y los dos únicos orígenes del cálculo.
- **Sí:** disparar solo cuando el valor **cambia**, y no en cada `PUT`. Un `PUT` de paciente recorre todos sus casos: pagar ese coste cuando solo se corrigió el teléfono es gratuito de evitar comparando dos fechas. El F09 sí recalcula siempre en `CLASSIF-004`, pero allí el ámbito es una fila.
- **Sí:** auditar solo cuando `age` o `ageUnitItemId` cambian de verdad. Una entrada de `appDetails` que dice «recalculado» sin que nada cambiara convierte el historial en ruido y esconde las veces que sí cambió.
- **No:** propagar también desde `ESAVI-PATIENT-005A/005B` o `ESAVI-CASE-005A/005B`. Activar o desactivar no cambia ninguna fecha.
- **No:** recalcular al reactivar una clasificación con `005B`, aunque su edad pueda haberse quedado atrás. Es un tercer camino con su propia decisión —qué se hace si el recálculo falla en una reactivación de SUPERADMIN— y va en su propio spec si se pide.

**Sobre `patientId`**

- **Sí:** hacerlo inmutable en `CASE-004` en vez de convertirlo en un tercer disparador. Eliminar el camino es más barato y más seguro que propagarlo, y es el precedente que ya fijaron el F06 con `caseCode` y el F09 con `caseId`: un caso no cambia de paciente, se crea otro. Un caso que cambia de paciente además invalida todo lo que cuelga de él, no solo la edad.
- **Sí:** ignorarlo sin error, no devolver 400. Precedente fijado dos veces, y permite reenviar entera la ficha que se acaba de leer con un `GET`.
- **No:** dejarlo mutable y declararlo como riesgo. Habría sido documentar un agujero que este spec estaba abriendo la oportunidad de cerrar.

**Sobre el fallo del recálculo**

- **Sí:** abortar el `PUT` entero con `rollback`. Guardar un `birthDate` que deja la clasificación en un estado imposible es exactamente el dato incoherente que este spec viene a eliminar; guardarlo «solo un poco» es peor que rechazarlo.
- **Sí:** transacción en los dos servicios de update, aunque sea un cambio en servicios cerrados. Sin ella, «abortar» significaría dejar el paciente escrito y la clasificación a medias, que es el peor de los tres resultados posibles.
- **Sí:** 409 para la fecha incoherente y 404 para el catálogo ausente, calcando los códigos de estado que el F09 eligió para las mismas dos causas. Un mismo error no puede tener dos estados según por dónde entre.
- **No:** seguir adelante registrando un `warn` en el log. Un log que nadie lee es exactamente el «nada avisa» del riesgo nº1 del F09.
- **No:** un tratamiento mixto —abortar por fecha, tolerar por catálogo—. Dos comportamientos para el mismo punto del código se olvidan a los tres meses, y el catálogo ausente es un fallo de despliegue que conviene que sea ruidoso.

**Sobre las fechas que pasan a `null`**

- **Sí:** conservar la edad guardada cuando `birthDate` o `eventDate` se anulan. Es la decisión del usuario y tiene fundamento: anular una fecha es a menudo un paso intermedio de una corrección en dos tiempos, y borrar la edad haría perder un dato que quizá nadie vuelva a introducir.
- **Reconocido:** esto entra en tensión con el principio del F09 de no dejar datos derivados sin respaldo. Durante ese hueco, la clasificación muestra una edad que ya no se puede reconstruir desde sus orígenes. Se asume a conciencia y queda anotado en §7; la vía de salida es volver a informar la fecha, que recalcula.
- **No:** anular `age` y `ageUnitItemId` a `null`. Destruye información a cambio de una coherencia que la siguiente edición restauraría igual.
- **No:** rechazar con 409 el `PUT` que anula una fecha de la que depende una clasificación activa. Bloquearía la corrección de un dato mal capturado, que es un uso legítimo y frecuente.

**Sobre el alcance de la propagación**

- **Sí:** solo clasificaciones **activas**. Es la misma regla de la cascada del F07 y del F09: una fila que alguien retiró a propósito no se toca, ni siquiera para mejorarla.
- **Sí:** no filtrar el **caso** por `isActive` al buscar las clasificaciones. Una clasificación activa colgando de un caso inactivo es alcanzable —el F09 permite reactivar una clasificación sin exigir que su caso esté activo— y en ese estado sigue siendo un dato vivo.
- **Sí:** fila por fila y no un `UPDATE` masivo como el del F07. Allí todas las filas recibían el mismo valor; aquí cada una depende del `eventDate` de su caso.
- **No:** hacer el backfill de las clasificaciones ya guardadas. Es un job con su propia pregunta —qué se hace con las miles que fallarían por catálogo o por fecha incoherente— y no cabe dentro de un `PUT`.

**Sobre dónde vive la regla**

- **Sí:** un servicio común en `src/services/common/`, junto a `entityActivation` y `entityPurge`. Los dos disparadores hacen lo mismo con distinto ámbito, y duplicarlo garantizaría que dentro de un año hagan cosas distintas.
- **Sí:** reutilizar `resolveAgeAtEvent` del F09 tal cual. Es un helper puro con suite unitaria propia; una segunda implementación de la aritmética de calendario es la forma más segura de que las dos discrepen en los bordes.
- **No:** llamar a `updateClassificationService` desde el recálculo. Espera un body, evalúa la matriz de gravedad y escribe `method: 'ESAVI-CLASSIF-004'` — mentiría en la auditoría y aplicaría reglas que aquí no vienen al caso.
- **No:** resolver el catálogo `ageUnit` una vez por fila. Los tres códigos son fijos: una consulta por invocación basta.
- **No:** un trigger de Postgres que recalculara la edad en la base. Habría que tocar `esaviapp.sql`, el cálculo dejaría de ser un helper con tests y la resolución del item de catálogo tendría que reescribirse en PL/pgSQL.

**Sobre la superficie y los mensajes**

- **Sí:** cero endpoints nuevos. La vía manual del F09 ya existe y un endpoint de recálculo solo tendría sentido para el backfill, que está fuera de alcance.
- **Sí:** reutilizar `classification.invalidAgeRange` y `classification.ageUnitCatalogMissing` en vez de crear claves nuevas. La causa que el usuario lee es idéntica; lo que distingue el origen es el código del `AppError`, que es para el operador.
- **No:** avisar al cliente en la respuesta del `PUT` de que hubo propagación. Cambiaría la forma de dos respuestas ya publicadas por una información que el cliente puede obtener releyendo la clasificación.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un `PUT` de paciente con muchos casos clasificados hace una consulta y hasta N escrituras dentro de la transacción, alargándola | El disparo está condicionado al cambio real de `birthDate`, así que el `PUT` normal no paga nada. Cuando dispara, la escritura solo ocurre en las filas cuya edad cambia de verdad, y el catálogo se resuelve una sola vez. Un paciente con decenas de casos clasificados es un escenario que este dominio no produce |
| Se modifican **dos servicios cerrados** con suites de contrato dependiendo de ellos, y además se les añade transacción, que cambia cómo se comportan ante un fallo a mitad | Los pasos 1 y 2 introducen la transacción **sin ningún otro cambio** y se verifican contra las suites existentes intactas. El enganche llega en los pasos 5 y 6, ya con la red puesta |
| Al anular `birthDate` o `eventDate`, la clasificación queda con una edad que ya no se puede reconstruir desde sus orígenes: es la tensión declarada en §6 | Asumido a conciencia. La edad sobrevive como último valor conocido y vuelve a ser correcta en cuanto la fecha se reinforma. La alternativa —anularla— destruye información por una coherencia efímera |
| El **backfill sigue sin resolverse**: toda clasificación creada antes de este spec cuya fecha de origen se editó antes de él conserva la edad vieja, y nada la corregirá hasta que alguien vuelva a tocar el paciente, el caso o la clasificación | Declarado en §2 como spec propio. El F09 dejó un riesgo abierto y éste lo reduce, no lo elimina: lo que este spec garantiza es que **a partir de su despliegue** ninguna edición de fecha deja una edad obsoleta |
| Un catálogo `ageUnit` mal sembrado convierte **toda** edición de paciente o de caso en un 404, no solo las de clasificación | Es la misma precondición del F09, ahora con más superficie afectada. La clave i18n nombra la causa y el código del `AppError` lleva `AGE_RECALC`, que la distingue del 404 de `CLASSIF-001`. Conviene comprobar el catálogo antes de desplegar este spec |
| Hacer `patientId` inmutable **rompe a cualquier cliente** que hoy lo esté usando para reasignar casos | Se ignora en silencio y devuelve 200, así que ninguna integración recibe un error nuevo — pero tampoco el efecto que esperaba. Está declarado en §8 y es la razón de que ese cambio tenga paso propio y criterio de aceptación propio |
| Dos operaciones concurrentes —editar el paciente y editar el caso a la vez— pueden recalcular la misma clasificación en paralelo | Cada una va en su transacción y la última en confirmar gana, con el mismo resultado: las dos calculan desde el estado que ven. No hay pérdida de datos posible porque el valor es derivado, no acumulado. Un bloqueo explícito sería coste sin beneficio |
| El recálculo escribe `updatedAt` de la clasificación, así que un listado ordenado por esa columna cambia de orden sin que nadie haya tocado la clasificación | El orden por defecto de los listados del F09 es `createdAt DESC`, que no se ve afectado. `updatedAt` refleja cuándo cambió la fila, y la fila cambió |

---

## 8. Impacto en el contrato HTTP

Este spec no añade ni retira ningún endpoint, y no cambia la forma de ninguna respuesta. Sí cambia el comportamiento de dos endpoints ya publicados:

| Endpoint | Antes | Después |
|---|---|---|
| `PUT /api/patients/:id` (`ESAVI-PATIENT-004`) | Escribe el paciente. Ningún efecto sobre otras tablas | Escribe el paciente y, si cambió `birthDate`, recalcula la edad de las clasificaciones activas de todos sus casos. Puede devolver **409** o **404** nuevos, y en ese caso **no guarda nada** |
| `PUT /api/esavi-cases/:id` (`ESAVI-CASE-004`) | Escribe el caso, incluido un `patientId` nuevo si llega. Ningún efecto sobre otras tablas | **Ignora `patientId`**. Escribe el caso y, si cambió `eventDate`, recalcula la edad de su clasificación activa. Puede devolver **409** o **404** nuevos, y en ese caso **no guarda nada**. Deja de devolver el 404 de paciente inexistente |

Dos consecuencias que conviene decir explícitamente:

**El `PUT` del paciente puede fallar por un dato que no está en el paciente.** Alguien corrige una fecha de nacimiento y recibe un 409 provocado por el `eventDate` de un caso que quizá ni conoce. El mensaje explica la causa, pero el cliente debería mostrar también qué caso la produjo — y este spec no se lo da, porque la respuesta de error no lleva `data`. Es una limitación conocida: si se pide, el 409 puede interpolar el `caseCode` en un spec posterior.

**`patientId` deja de tener efecto sin dar error.** Un cliente que hoy lo envíe para reasignar un caso seguirá recibiendo 200 y verá que el paciente no cambió. Es el mismo comportamiento que ya tienen `caseCode` en `CASE-004` y `caseId` en `CLASSIF-004`, y conviene que la documentación de la API lo liste junto a ellos.

`GET /api/patients`, `GET /api/esavi-cases` y todas las operaciones de `classification` **no cambian** en nada.

---

## Lo que **no** está en este spec

- Ningún endpoint de recálculo: ni por caso, ni por paciente, ni masivo. `ROUTE_RULES` se queda en 99 filas.
- El **backfill** de las clasificaciones que ya arrastran una edad obsoleta.
- Propagar a clasificaciones **inactivas**, ni recalcular al reactivarlas con `ESAVI-CLASSIF-005B`.
- Anular `age` y `ageUnitItemId` cuando una fecha de origen pasa a `null`.
- Propagar a `notification`, `investigation` o `finalClassification`, ninguna implementada todavía.
- Interpolar en el 409 qué caso concreto provocó la incoherencia.
- Validar `birthDate` contra `eventDate` en las operaciones de alta, `ESAVI-PATIENT-001` y `ESAVI-CASE-001`.
- Hacer inmutable ningún campo aparte de `patientId` en `ESAVI-CASE-004`.
- Cualquier clave i18n nueva, cualquier código de operación nuevo y cualquier abreviatura nueva en `references/CONVENTIONS.md` §6.
- Cualquier modificación de `esaviapp.sql`, incluido un trigger que hiciera el recálculo en base de datos.
- Sembrar el `catalogType` `ageUnit`: sigue siendo precondición heredada del F09, no alcance.

Cada uno de esos, si aterriza, va en su propio spec.
