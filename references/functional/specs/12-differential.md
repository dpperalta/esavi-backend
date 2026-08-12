# SPEC F12 — Update diferencial uniforme en los doce servicios

> **Estado:** Aprobado
> **Depende de:** SPEC 04 (contrato de conflicto y consistencia), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F01 (`appUserGeoLocation`), SPEC F03 (`appRole`), SPEC F04 (`appUser`), SPEC F05 (`patient`), SPEC F06 (`esaviCase`), SPEC F07 (`notifier`), SPEC F09 (`classification` — fija la forma correcta)
> **Fecha:** 2026-08-11
> **Objetivo:** Que ningún `PUT` que no cambia ningún dato deje rastro, extrayendo la comparación diferencial a un helper único que usen los doce servicios de update.

---

## 1. Por qué existe este spec

Cierra [DEUDA-041](../../TECHNICAL_DEBT.md#deuda-041).

La regla de **update diferencial** de la sección 11 de [CONVENTIONS.md](../../CONVENTIONS.md) exige tres cosas en cascada: no tocar lo que no viaja en el body, no tocar lo que viaja igual a lo guardado, y no escribir nada cuando no cambió ningún campo. Seis de los doce servicios de update la cumplen. Seis no, y en tres grados distintos.

**A — Comparan y escriben igual.** `appRole.service.ts:146-167` compara los cuatro campos uno a uno y aun así llama a `update()`, con un comentario que declara la intención contraria a la norma:

```ts
// The audit entry is written even when no field changed: an update that touched nothing is
// still an update someone attempted, and appDetails is the only record of who tried
```

`user.service.ts:267-292` hace lo mismo con sus cinco campos. **DEUDA-041 los clasifica mal**: su tabla marca `user` como «no compara», y sí compara. El diagnóstico correcto es que ambos calculan bien el diff y después lo ignoran.

**B — Comparación parcial.** `appUserGeoLocation.service.ts:246-258` compara `validFrom` con `getTime()`, pero decide `validTo` solo por presencia de la clave. Tiene además un atajo propio en `:229` —`if (Object.keys(data).length === 0) return assignment;`— que cubre el body vacío y nada más: un body con los mismos valores que ya están guardados escribe.

**C — Solo miran presencia.** `esaviCase.service.ts:311-335`, `notifier.service.ts:257-288` y `patient.service.ts:247-274` construyen `objectToUpdate` a partir de si la clave llegó en el body, sin compararla nunca con lo guardado. Reenviar entera la ficha recién leída con un `GET` —que es el uso normal de un formulario— reescribe todas las columnas con su propio valor.

**El daño es a la trazabilidad, y alcanza a dos rastros, no a uno.** DEUDA-041 solo señala `appDetails`. Pero `esaviapp.sql:1288` monta `TRG_<tabla>_setSysDetails` sobre todas las tablas del esquema, y en `UPDATE` la función (`esaviapp.sql:78-107`) hace tres cosas más: fija `NEW."updatedAt" := current_timestamp`, incrementa `sysDetails.version` y añade un evento `UPDATE` a `sysDetails.auditTrail`. Cada apertura y cierre de un formulario deja hoy una entrada en `appDetails`, un evento en `auditTrail` y una versión consumida. Las modificaciones reales dejan de distinguirse del ruido en los dos sitios a la vez.

Se suman dos efectos por entidad. En las que llevan PII —`patient`, `notifier`, `user`— cada reescritura vuelve a cifrar el mismo texto plano. En las que guardan un derivado, `updatedAt` avanza sin que nada haya avanzado.

**Y hay una segunda razón, de forma.** Los doce servicios repiten el mismo bloque a mano: un literal `objectToUpdate`, una línea `delete` por campo —once en `geoLocation.service.ts:229-239` y doce en `healthFacility.service.ts:268-279`— y un corte por diff vacío. La comparación va escrita campo a campo, así que **omitir un campo no lo detecta nada**: es exactamente el modo en que los seis servicios desviados llegaron a estar desviados. Mientras el patrón viva copiado doce veces, el siguiente `004` que se escriba tiene la misma probabilidad de nacer mal.

**No hay superficie HTTP nueva.** Ninguna entidad, ninguna ruta, ningún código de operación, ninguna clave i18n y ninguna fila nueva en `ROUTE_RULES`. Como el SPEC F11, este spec cambia el efecto lateral de endpoints ya publicados, así que su §3 se escribe con tablas Antes/Después en vez del desglose 3.1–3.7.

---

## 2. Alcance

**Dentro:**

- **Un helper nuevo:** `src/helpers/differentialUpdate.helper.ts`, con `buildDifferentialUpdate(stored, candidates)`, exportado por el barrel `src/helpers/index.ts`.
- **La comparación de valores vive en el helper**, incluidos los dos casos que hoy cada servicio resuelve a su manera: `Date` por `getTime()` y objetos por `JSON.stringify`.
- **Migración de los doce servicios de update** al helper: `ESAVI-CATITEM-004`, `ESAVI-CATTYPE-004`, `ESAVI-GEOTYPE-004`, `ESAVI-GEOLOC-004`, `ESAVI-HFAC-004`, `ESAVI-CLASSIF-004` —los seis que ya cumplen la norma— y `ESAVI-APPROLE-004`, `ESAVI-USERGEO-004`, `ESAVI-CASE-004`, `ESAVI-NOTIFIER-004`, `ESAVI-PATIENT-004`, `ESAVI-USER-004` —los seis desviados—.
- **Corrección de los seis desviados:** sin diferencias no hay `UPDATE`, ni entrada en `appDetails`, ni evento en `sysDetails.auditTrail`. Se responde 200 con el registro tal como está.
- **Comparación de campos cifrados sobre texto plano**, descifrando el guardado con `esaviDecrypt`, en `patient`, `notifier` y `user`. Se deja de comparar ciphertext contra ciphertext.
- **`updatedAt` escrito a mano en los doce**, con independencia de que el trigger lo sobreescriba.
- **Dos líneas que se eliminan:** el atajo `if (Object.keys(data).length === 0) return assignment;` de `appUserGeoLocation.service.ts:229`, que el helper deja redundante, y el comentario de `appRole.service.ts:162-163`, que declara la norma contraria.
- **Reescritura de la sección 11 de `references/CONVENTIONS.md`**, para que el patrón canónico sea el helper y no el literal de `updateCatalogItemService`.
- **Un caso de contrato homogéneo en las doce suites:** `GET`, reenvío íntegro de la respuesta con `PUT`, y comprobación de que `appDetails` no crece y `sysDetails.version` no avanza.
- **Corrección de los seis casos que hoy afirman lo contrario:** `appRole.test.ts:165`, `appUser.test.ts:218`, `esaviCase.test.ts:449`, `notifier.test.ts:454`, `patient.test.ts:210` y `patient.test.ts:292`.
- **Enlace bidireccional con `references/TECHNICAL_DEBT.md`**: la entrada DEUDA-041 se marca saldada y el mapa de resolución apunta a este spec.

**Fuera de alcance (otros specs):**

- **Las otras tres escrituras de `appUserGeoLocation`:** la reactivación dentro del `001` (`:110-118`), el traslado `ESAVI-USERGEO-006` (`:385-414`) y la asignación masiva `ESAVI-USERGEO-007` (`:486-494`). No son updates diferenciales: son escrituras con intención propia, donde la entrada de auditoría registra un hecho aunque ningún campo de datos cambie.
- **Las demás escrituras de `user.service.ts`:** el cambio de contraseña y la asignación de roles.
- **Las activaciones `005A` / `005B` y `setEntityActiveStatusService`.** Cambiar `isActive` siempre es un cambio; el spec no las toca.
- **Los `001`.** El create escribe por definición; no hay nada que comparar.
- **El recálculo de edad del [SPEC F11](./11-age-recalculation.md).** Este spec instala la comparación del valor resultante contra el guardado; el F11 la usa como disparador. Van en ese orden y el F11 pasa a depender de este.
- **[DEUDA-040](../../TECHNICAL_DEBT.md#deuda-040)** — `isActive` anunciado por los validadores de update de `catalogItem` y `catalogType` y descartado en silencio. Es adyacente y toca los mismos archivos, pero es otra causa y otra corrección.
- **Tocar el trigger `setSysDetails` o el bucle de `esaviapp.sql:1286-1288`.** El trigger se toma como dado: la única forma de que no escriba es que no haya `UPDATE`.
- **Cambiar la respuesta cuando no hay cambios.** Sigue siendo `200` con el registro completo. No se introduce `304`, ni `412`, ni un campo que anuncie que no se escribió nada.
- **El criterio de unicidad y la validación de FK.** Van antes del diff, son independientes de que el campo cambie, y ya están correctos: una FK que apunta a una fila inactiva es 404 aunque coincida con la guardada.

---

## 3. Qué cambia

### 3.1 Tablas y modelos

**No hay tablas nuevas, ni columnas nuevas, ni modelos nuevos.** Ninguna migración de esquema. El único artefacto nuevo del repositorio es un archivo en `src/helpers/`.

Las columnas que este spec deja de reescribir son las de datos de las doce entidades, más las tres que escribe el trigger: `updatedAt`, `sysDetails.version` y `sysDetails.auditTrail`.

### 3.2 El helper — `src/helpers/differentialUpdate.helper.ts`

Una sola función, declarativa:

```ts
export const buildDifferentialUpdate = (
    stored: Record<string, unknown>,
    candidates: Record<string, unknown>
): Record<string, unknown> => { ... }
```

**`candidates`** es un objeto con **los valores ya normalizados** —`toConstantCase`, `toTitleCase`, `.trim()`, `esaviCrypt`— y con `undefined` en las claves que no viajaron en el body. Normalizar sigue siendo del servicio: el helper no sabe qué campo es un código y cuál un nombre.

**Devuelve** solo las claves cuyo valor difiere de `stored`. Tres reglas:

1. Clave con valor `undefined` → se descarta. Es «no vino en el body», y por eso `null` y `undefined` no son intercambiables en `candidates`: `null` es «vino en `null`» y sí es un cambio si lo guardado no era `null`.
2. Clave cuyo valor se considera igual al guardado → se descarta.
3. El resto se conserva.

El servicio corta con `if( Object.keys(changes).length === 0 )`, que es la única línea de control que le queda.

**`stored` tiene que venir de la fila completa**, con `instance.get({ plain: true })`, como hace `classification.service.ts:405`. Si se pasa una instancia leída con `attributes` acotados, un campo ausente vale `undefined` y toda comparación contra él da «cambió». Queda escrito como precondición del helper, en su comentario de cabecera.

### 3.3 Reglas de comparación

Las absorbe el helper. Antes vivían repartidas por servicio, y dos no vivían en ninguno.

| Tipo de valor | Criterio | Dónde estaba antes |
|---|---|---|
| Primitivos | `!==` estricto | los doce servicios |
| `null` en un lado y valor en el otro | es cambio | los doce |
| `Date` en cualquiera de los dos lados | ambos coercionados con `new Date(v).getTime()` | solo `appUserGeoLocation:256` |
| Objetos y arrays | `JSON.stringify` en los dos lados | solo `catalogItem:158` y `geoLocation:226` |
| Cadena numérica frente a número, si ambos coercionan a un número finito | comparación numérica | **en ninguno** |
| Fecha `DATEONLY` como cadena | `String(v).slice(0, 10)` en los dos lados | solo `classification:419` |

**La quinta fila es un hallazgo.** `latitude` y `longitude` son `DataTypes.DECIMAL(10, 7)` en `geoLocation.model.ts:76-82` y `healthFacility.model.ts:76-82`, declarados como `number` en TypeScript. El repositorio no configura ningún `setTypeParser`, así que `pg` devuelve las columnas `numeric` como cadena: lo guardado vuelve como `'-0.2299000'` y lo que llega en el body es `-0.2299`. Las comparaciones de `geoLocation.service.ts:224-225` y `healthFacility.service.ts:262-263` son entonces siempre verdaderas, y un `PUT` que reenvía la misma latitud escribe.

Son dos de los seis servicios que la deuda daba por correctos. La fuga no está en la lógica del diff, está en el tipo, y por eso la revisión que produjo DEUDA-041 no la vio. Concentrar la comparación en el helper la cierra en un sitio y para las dos entidades.

### 3.4 Estado por servicio — Antes y Después

| Servicio | Antes | Después |
|---|---|---|
| `catalogItem:152-183` | correcto, 7 `delete` a mano | helper |
| `catalogType:90-110` | correcto, 4 `delete` a mano | helper |
| `geoLevelType:95-113` | correcto, 3 `delete` a mano | helper |
| `geoLocation:216-250` | correcto salvo `latitude` / `longitude` | helper; se cierran los dos `DECIMAL` |
| `healthFacility:254-290` | correcto salvo `latitude` / `longitude` | helper; se cierran los dos `DECIMAL` |
| `classification:404-467` | correcto, con `setIfChanged` propio | helper; desaparece el colector local |
| `appRole:146-167` | compara y escribe igual | helper; corta sin cambios; se borra el comentario de `:162-163` |
| `appUserGeoLocation:246-258` | `validFrom` sí, `validTo` por presencia | helper; se borra el atajo de `:229` |
| `esaviCase:311-335` | solo presencia | helper; corta sin cambios |
| `notifier:257-288` | solo presencia | helper; corta sin cambios; cifrados por texto plano |
| `patient:247-274` | solo presencia | helper; corta sin cambios; cifrados por texto plano |
| `user:267-292` | compara ciphertext y escribe igual | helper; corta sin cambios; cifrados por texto plano |

`updatedAt: new Date()` pasa a estar en los doce. Hoy está en dos: `classification:455` y `notifier:276`.

### 3.5 Campos cifrados

Tres servicios los tienen: `patient` (`firstName`, `lastName`, `middleName`, `secondLastName`, `documentNumber`, `passportNumber`, `email`), `notifier` (`firstName`, `lastName`, `address`, `email`) y `user` (`username`, `email`, `firstName`, `lastName`, `displayName`).

El `stored` que recibe el helper llega **descifrado** con `esaviDecrypt`, y los `candidates` de esos campos llegan **en texto plano ya normalizado**. El cifrado con `esaviCrypt` se aplica **después**, sobre las claves que el helper devolvió como cambiadas. Es el orden inverso al de hoy en `patient:248-249` y `notifier:260-261`, que cifran antes de decidir.

La razón es la de §11 del canon: comparar ciphertext funciona solo porque `esaviCrypt` usa un IV fijo. Atarse a eso hace que pasar a un IV aleatorio rompa la comparación **en silencio** —todo pasaría a contar como cambio—, y ningún test lo distinguiría de un cambio legítimo.

**`user.displayName` es un derivado y se conserva como tal.** Se recompone desde el `firstName` y el `lastName` resultantes, y entra en `candidates` como un campo más, así que el helper decide si cambió. La lógica de `user.service.ts:279-283` sobrevive, con el diff del helper como entrada en vez del literal.

### 3.6 Valores derivados

Cuentan como diferencia aunque el cliente no haya enviado nada, y por eso entran en `candidates` **siempre**, no bajo un `if` de presencia. Son tres en el repositorio:

| Derivado | Servicio | Origen |
|---|---|---|
| `age`, `ageUnitItemId` | `classification:414` | `patient.birthDate` y `esaviCase.eventDate` |
| `isSeriousEvent` | `classification:443` | los nueve criterios de gravedad |
| `displayName` | `user:282` | `firstName` y `lastName` |

`esaviCase.caseCode` **no** es uno de ellos: `esaviCase.service.ts:283` lo declara inmutable y el `004` no lo regenera. DEUDA-041 lo nombra como derivado en riesgo; no lo es.

### 3.7 Contrato HTTP y claves i18n

Ninguna clave i18n nueva. Ninguna ruta nueva. Ninguna fila nueva ni modificada en `ROUTE_RULES` de `tests/auth/roles.test.ts`. El cuerpo de la respuesta de los doce `PUT` no cambia de forma. Lo que cambia es el **efecto lateral**, y está en §8.

---

## 4. Plan de implementación

Trece pasos. Cada uno se puede committear solo y deja `npm run check` en verde: la corrección de cada test viaja en el mismo paso que el servicio que la provoca, no en un paso posterior.

1. **El helper.** `src/helpers/differentialUpdate.helper.ts` con `buildDifferentialUpdate(stored, candidates)` y las seis reglas de comparación de §3.3. Alta en el barrel `src/helpers/index.ts`. Ningún llamador todavía.
   *Verificación:* `npm run build` pasa; `import { buildDifferentialUpdate } from '../helpers'` resuelve.

2. **Suite del helper.** `tests/unit/differentialUpdate.test.ts` — **introduce el directorio `tests/unit/`**, que hoy no existe: las tres categorías actuales son `auth/`, `contract/` e `i18n/`. Se justifica porque el helper concentra el criterio de doce servicios y sus reglas no son observables desde un endpoint. Un caso por regla, más los tres bordes: `undefined` frente a `null`, `stored` con la clave ausente, y diff vacío.
   *Verificación:* `npm test` recoge la suite nueva; `buildDifferentialUpdate({ a: 1 }, { a: 1 })` devuelve `{}` y `buildDifferentialUpdate({ a: '0.5000000' }, { a: 0.5 })` también.

3. **Los cuatro que ya cumplen y no tienen `DECIMAL`.** `catalogItem`, `catalogType`, `geoLevelType` y `classification` pasan al helper. Desaparecen los 14 `delete` a mano y el colector `setIfChanged` local de `classification:406-409`. Los cuatro escriben `updatedAt` a mano.
   *Verificación:* sin cambio observable. Las cuatro suites de contrato pasan sin tocar ni una línea; ése es el criterio de que la migración fue neutra.

4. **`geoLocation` y `healthFacility` — se cierra la fuga `DECIMAL`.** Migración al helper, que compara `latitude` y `longitude` numéricamente. Es el primer cambio observable del spec.
   *Verificación:* un `PUT` que reenvía la misma latitud responde 200, no añade entrada a `appDetails` y deja `sysDetails.version` igual. Antes del paso, el mismo `PUT` la añadía.

5. **`ESAVI-APPROLE-004`.** Helper y corte por diff vacío. Se borra el comentario de `appRole.service.ts:162-163`, que declara la norma contraria. Se corrige `tests/contract/appRole.test.ts:165-174`: el `PUT` con body vacío sigue respondiendo 200, pero `appDetails` se queda en 2 entradas, no en 3.
   *Verificación:* el caso corregido pasa; el intento sin cambios no aparece en `appDetails` ni en `esaviLog`.

6. **`ESAVI-USERGEO-004`.** Helper; `validTo` se compara por valor y no por presencia; se borra el atajo `if (Object.keys(data).length === 0) return assignment;` de `:229`, que el helper deja redundante. La comprobación del rango contra el estado resultante de `:232-239` se mantiene y sigue yendo antes del diff.
   *Verificación:* un `PUT` con el `validTo` ya guardado no escribe; un `PUT` con `validTo: null` sobre una fila que ya lo tenía en `null` tampoco; `tests/contract/appUserGeoLocation.test.ts:306-319` pasa sin tocarse, porque envía un cambio real.

7. **`ESAVI-CASE-004`.** Helper y corte por diff vacío. La comprobación de coherencia de fechas contra el estado resultante de `:301-309` se mantiene antes del diff. Se corrige `tests/contract/esaviCase.test.ts:449-462`: el `PUT` vacío deja `appDetails` en 1 entrada, y el `PUT` con `countryIsoCode: ' ec '` la deja en 2.
   *Verificación:* el caso corregido pasa; reenviar `countryIsoCode: 'EC'` sobre una fila que ya vale `EC` no escribe.

8. **`ESAVI-PATIENT-004`.** Helper, corte por diff vacío, y los siete campos cifrados comparados sobre texto plano: `stored` descifrado con `esaviDecrypt`, `candidates` en claro, `esaviCrypt` aplicado después sobre lo que el helper devolvió. La unicidad de `documentNumber` de `:225-238` sigue yendo antes y sigue comparando ciphertext, que es correcto: es una consulta a la base, no un diff. Se corrigen `tests/contract/patient.test.ts:210-216` y `:292-300`, que esperan dos `ESAVI-PATIENT-004` donde queda uno.
   *Verificación:* un `PUT` que reenvía el `firstName` guardado no escribe; el valor cifrado en la columna es idéntico byte a byte antes y después.

9. **`ESAVI-NOTIFIER-004`.** Igual que el paso 8 con sus cuatro campos cifrados. Se corrige `tests/contract/notifier.test.ts:454-463`, cuyo título —«*even with no changes*»— afirma justo lo que este spec elimina.
   *Verificación:* el caso corregido pasa; el `PUT` vacío deja `appDetails` en 1 entrada.

10. **`ESAVI-USER-004`.** Helper, corte por diff vacío, cinco campos cifrados por texto plano, y `displayName` recompuesto desde el `firstName` y el `lastName` resultantes y entregado al helper como un candidato más. Las dos comprobaciones de unicidad de `:240-263` siguen antes y siguen sobre ciphertext. Se corrige `tests/contract/appUser.test.ts:218-226`.
    *Verificación:* un `PUT` con solo el `firstName` ya guardado no escribe ni recompone `displayName`; un `PUT` que cambia el `lastName` sí mueve los dos.

11. **El caso homogéneo en las doce suites de contrato.** Mismo título y misma forma en las doce: `GET` del registro, `PUT` con la respuesta reenviada íntegra, y tres afirmaciones — 200, `appDetails` con la misma longitud, y `sysDetails.version` sin avanzar. Es más fuerte que el body vacío que usan los casos de hoy: el vacío no distingue «no comparo valores» de «no escribo».
    *Verificación:* las doce pasan; revertir cualquiera de los pasos 3 a 10 hace fallar exactamente la suite de ese servicio.

12. **La sección 11 de `references/CONVENTIONS.md`.** El patrón canónico pasa a ser `buildDifferentialUpdate`, no el literal de `updateCatalogItemService`. Se conserva la explicación de las tres reglas en cascada y de las cuatro precisiones, con la tabla de §3.3 añadida como referencia de comparación. Se documenta la precondición de `stored`.
    *Verificación:* `grep -n "objectToUpdate" references/CONVENTIONS.md` no devuelve el bloque de ejemplo antiguo.

13. **Cierre de la deuda.** `references/TECHNICAL_DEBT.md`: DEUDA-041 marcada ✅ con la nota de que su tabla clasificaba mal `user` y `appUserGeoLocation`, y de que el alcance real incluyó `sysDetails` y la fuga `DECIMAL` de dos servicios que daba por correctos. El mapa de resolución añade la fila `F12 → 041`. El header del [SPEC F11](./11-age-recalculation.md) añade `SPEC F12` a sus dependencias.
    *Verificación:* los dos enlaces resuelven; `041` sale de la lista «sin spec» del mapa.

---

## 5. Criterios de aceptación

**Comportamiento — el criterio central, en las doce entidades:**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** con el registro completo.
- [ ] Ese mismo `PUT` **no añade** entrada a `appDetails`.
- [ ] Ese mismo `PUT` **no avanza** `sysDetails.version` ni añade evento a `sysDetails.auditTrail`.
- [ ] Ese mismo `PUT` **no mueve** `updatedAt`.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo escribe **una** entrada en `appDetails` y avanza `sysDetails.version` en 1.

**Casos que hoy fallan y tienen que pasar:**

- [ ] `PUT /api/geo-locations/:id` con la misma `latitude` no escribe. Hoy escribe siempre.
- [ ] `PUT /api/health-facilities/:id` con la misma `latitude` no escribe. Hoy escribe siempre.
- [ ] `PUT /api/user-geo-locations/:id` con el mismo `validTo` no escribe. Hoy escribe.
- [ ] `PUT /api/patients/:id` con el mismo `firstName` deja la columna cifrada idéntica byte a byte.
- [ ] `PUT /api/notifiers/:id` con el mismo `email` deja la columna cifrada idéntica byte a byte.
- [ ] `PUT /api/users/:id` con el mismo `firstName` no recompone `displayName`.

**Derivados y órdenes que no cambian:**

- [ ] Un `PUT` sobre una `classification` cuya edad recalculada difiere de la guardada **sí** escribe, aunque el body no traiga nada de edad.
- [ ] Un `PUT` con una FK que apunta a una fila inactiva responde **404** aunque esa FK coincida con la guardada.
- [ ] Un `PUT` con un `code` ya ocupado por otro registro responde **409** aunque el resto del body no cambie nada.
- [ ] `PUT /api/esavi-cases/:id` con `caseCode` en el body sigue ignorándolo, sin regenerarlo.

**Código:**

- [ ] `grep -rn "delete objectToUpdate" src/` no devuelve resultados.
- [ ] `grep -rn "setIfChanged" src/services/` no devuelve resultados.
- [ ] `grep -rn "Object.keys(data).length === 0" src/services/` no devuelve resultados.
- [ ] `grep -rn "buildDifferentialUpdate" src/services/ | wc -l` devuelve **12**.
- [ ] `grep -rn "updatedAt: new Date()" src/services/ | wc -l` cubre los doce servicios de update.
- [ ] El comentario de `appRole.service.ts:162-163` no existe.
- [ ] `esaviCrypt` no aparece dentro del literal `candidates` en `patient`, `notifier` ni `user`: se aplica después del diff.

**Suites:**

- [ ] `tests/unit/differentialUpdate.test.ts` existe y cubre las seis reglas de §3.3 más los tres bordes.
- [ ] Las doce suites de contrato tienen el caso homogéneo del paso 11.
- [ ] Los seis casos de `appRole.test.ts:165`, `appUser.test.ts:218`, `esaviCase.test.ts:449`, `notifier.test.ts:454`, `patient.test.ts:210` y `patient.test.ts:292` están corregidos, no borrados.
- [ ] `tests/auth/roles.test.ts` no cambia: ninguna fila de `ROUTE_RULES` se añade ni se modifica.
- [ ] `npm run i18n:check` sale en 0 sin claves nuevas.

**Documentación:**

- [ ] La sección 11 de `references/CONVENTIONS.md` cita `buildDifferentialUpdate` como patrón canónico.
- [ ] DEUDA-041 está marcada ✅ y el mapa de resolución tiene la fila `F12 → 041`.
- [ ] El header del SPEC F11 declara `SPEC F12` entre sus dependencias.

**Cierre:**

- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** extraer el patrón a un helper compartido, en vez de repetirlo corregido doce veces. La comparación escrita campo a campo no la vigila nada: omitir un campo no rompe la compilación ni ningún test, y es exactamente el modo en que los seis servicios desviados llegaron a estarlo. Con el helper, el criterio vive en un archivo y el que lo incumpla lo hace a la vista.
- **Sí:** helper **declarativo** — `buildDifferentialUpdate(stored, candidates)` — frente al colector imperativo `{ setIfChanged, changes }` que ya existe dentro de `classification.service.ts:406-409`. La forma declarativa encaja en los doce, incluido `classification`, cuyos campos condicionales se expresan igual de bien con `undefined` en `candidates`. Dos formas del mismo patrón habría sido peor que una imperfecta.
- **Sí:** el helper absorbe las reglas de comparación por tipo. Si las deja en el servicio, cada uno reinventa el `getTime()` y el `JSON.stringify`, y el que lo olvide vuelve a escribir sin cambios. La quinta regla —cadena numérica frente a número— es la prueba: nadie la había escrito nunca, y por eso `latitude` llevaba dos entidades escribiendo siempre.
- **Sí:** los campos cifrados se comparan sobre texto plano, descifrando el guardado. Comparar ciphertext funciona hoy solo porque `esaviCrypt` usa un IV fijo. Pasar a un IV aleatorio rompería la comparación **en silencio** —todo contaría como cambio— y ningún test lo distinguiría de un cambio legítimo. La propiedad es de la implementación de `crypto.helper.ts`, no del contrato del update, y atar el segundo a la primera es la clase de acoplamiento que no avisa cuando se rompe.
- **Sí:** normalizar sigue siendo del servicio; el helper recibe valores ya normalizados. El helper no puede saber qué campo es un código y cuál un nombre, y pasarle esa tabla lo convertiría en un segundo lugar donde vive la convención de normalización.
- **Sí:** `updatedAt` escrito a mano en los doce, aunque el trigger `setSysDetails` lo sobreescriba con `current_timestamp` en cada `UPDATE`. La línea es cosmética contra una base creada con el bucle de `esaviapp.sql:1286-1288`, y correcta contra una que no lo tenga. Uniformar doce servicios cuesta doce líneas y elimina la pregunta de por qué dos sí y diez no.
- **Sí:** el caso de contrato homogéneo reenvía la respuesta del `GET`, no un body vacío. El body vacío no distingue «no comparo valores» de «no escribo»: los seis servicios desviados lo habrían pasado con solo añadir el atajo que ya tiene `appUserGeoLocation:229`.
- **Sí:** una suite unitaria nueva en `tests/unit/`, categoría que el repositorio no tenía. Las reglas de comparación no son observables desde ningún endpoint, y verificarlas doce veces por vía HTTP es más lento y menos preciso que verificarlas una vez sobre la función.
- **No:** registrar en `esaviLog` el `PUT` que no cambió nada. Se consideró como forma de conservar la intención del comentario de `appRole.service.ts:162-163`. Morgan ya tiene la petición en `access.log`, y mover el ruido de un archivo a otro no lo elimina: lo esconde en el sitio donde nadie lo busca.
- **No:** responder algo distinto de `200` cuando no hubo cambios. Un `304` obligaría a `ETag` y un `412` es un error que no ocurrió. El cliente pidió un estado y el registro está en ese estado; la respuesta correcta es el registro.
- **No:** añadir un campo al `data` que anuncie que no se escribió nada. Cambia el contrato de doce endpoints para informar de algo que el cliente no necesita: si le interesa, `sysDetails.version` ya lo dice.
- **No:** migrar también las otras tres escrituras de `appUserGeoLocation` —la reactivación del `001`, el traslado `006` y la asignación masiva `007`—. No son updates diferenciales: son escrituras con intención propia, donde la entrada de auditoría registra un hecho aunque ningún campo de datos cambie.
- **No:** tocar el trigger `setSysDetails` ni el bucle que lo monta. Que el `UPDATE` escriba en `sysDetails` es correcto; lo que estaba mal era hacer el `UPDATE`. Cambiar el trigger afectaría a las 45 tablas del esquema y a la carga de `esaviapp.sql` en los tests.
- **No:** configurar un `setTypeParser` para `numeric` y devolver `latitude` como número. Resolvería la quinta regla en el origen, pero cambia el tipo de un valor ya publicado en las respuestas de dos endpoints, y `pg` no lo parsea por defecto justamente para no perder precisión. Merece su propio spec si alguien lo quiere.
- **No:** aprovechar el paso por los doce archivos para cerrar [DEUDA-040](../../TECHNICAL_DEBT.md#deuda-040). Toca los mismos dos servicios y la tentación es real, pero es otra causa —un validador que anuncia un campo que el servicio ignora— y otra corrección.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| `stored` llega de una instancia leída con `attributes` acotados: el campo ausente vale `undefined` y toda comparación contra él da «cambió», con lo que el servicio vuelve a escribir siempre | La precondición está en el comentario de cabecera del helper y cubierta por uno de los tres bordes de `tests/unit/differentialUpdate.test.ts`. Los doce servicios leen con `findByPk` sin `attributes` |
| Al construir `candidates`, un servicio colapsa `null` en `undefined` —`data.x ?? undefined`— y un campo anulable deja de poder vaciarse | Es la primera de las cuatro precisiones de §11 y ya está escrita ahí. Los casos de contrato que envían `null` explícito existen hoy en `appUserGeoLocation.test.ts:322` y `notifier.test.ts:451` |
| Descifrar el guardado en `patient`, `notifier` y `user` toca filas que hoy nunca se descifran en el `004`. Una fila con un valor escrito antes del cifrado, o con otra clave, puede hacer que `esaviDecrypt` falle y convierta un `PUT` que funcionaba en un 500 | El riesgo es real y no lo cubre ninguna suite, porque todos los fixtures se crean por la API. Antes de cerrar el paso 8 hay que comprobar sobre la base de desarrollo que las filas existentes descifran. Si alguna no, el hallazgo es una deuda nueva, no un motivo para volver al ciphertext |
| Alguien «corrige» los seis tests que afirman lo contrario borrándolos en vez de invirtiéndolos, y se pierde la cobertura del `PUT` sin cambios | Criterio de aceptación explícito: corregidos, no borrados. Los seis siguen existiendo con el mismo título invertido |
| `classification` es el servicio más intrincado de los doce —edad recalculada, matriz de gravedad, tri-estado— y su migración toca lógica que hoy funciona | Va en el paso 3, junto a los tres triviales, y con su suite **sin tocar ni una línea**: si la migración altera el comportamiento, falla ahí y no en un paso posterior |
| El SPEC F11 se implementa en paralelo y los dos specs reescriben `updatePatientService` y `updateEsaviCaseService` | El F11 pasa a declarar `SPEC F12` entre sus dependencias en el paso 13. Son secuenciales, no concurrentes |
| Un consumidor que hoy usa el `PUT` sin cambios para mover `updatedAt` —tocar la ficha para marcarla como revisada— pierde ese efecto sin ningún error | No hay ninguno conocido, y el efecto nunca fue una función declarada de la API. Queda registrado en §8 para que aparezca si alguien lo reclama |

---

## 8. Impacto en el contrato HTTP

Los doce `PUT` siguen respondiendo `200` con la misma forma de `data`. Lo que cambia es el efecto lateral, y es observable desde fuera.

| Petición | Antes | Después |
|---|---|---|
| `PUT` con body vacío `{}` | 200, entrada nueva en `appDetails`, `sysDetails.version` +1, `updatedAt` movido | 200, sin escritura de ningún tipo |
| `PUT` reenviando la respuesta del `GET` | 200, todas las columnas reescritas con su propio valor | 200, sin escritura de ningún tipo |
| `PUT` con la misma `latitude` en `geoLocation` o `healthFacility` | 200 con escritura | 200 sin escritura |
| `PUT` cambiando un campo | 200, una entrada | igual |
| `PUT` con FK inactiva que coincide con la guardada | 404 | igual |
| `PUT` con `code` duplicado | 409 | igual |

**Un cliente que use `appDetails` como contador de peticiones verá menos entradas.** Ése es el objetivo: `appDetails` cuenta cambios, no visitas. Lo mismo aplica a `sysDetails.auditTrail` y a `sysDetails.version`.

**Ningún status code cambia.** Ningún campo desaparece del `data`. Ninguna clave i18n se renombra.

---

## Lo que **no** está en este spec

- Las otras tres escrituras de `appUserGeoLocation`: la reactivación del `001`, el traslado `ESAVI-USERGEO-006` y la asignación masiva `ESAVI-USERGEO-007`.
- Las demás escrituras de `user.service.ts`: cambio de contraseña y asignación de roles.
- Las activaciones `005A` / `005B` y `setEntityActiveStatusService`.
- Los `001`. El create escribe por definición.
- El recálculo de edad propagado, que es el [SPEC F11](./11-age-recalculation.md).
- [DEUDA-040](../../TECHNICAL_DEBT.md#deuda-040) — `isActive` anunciado por los validadores de update y descartado en silencio.
- Configurar un `setTypeParser` para `numeric` y devolver `latitude` y `longitude` como número.
- Tocar el trigger `setSysDetails` o el bucle que lo monta sobre las 45 tablas.
- Cambiar la respuesta cuando no hubo cambios: no hay `304`, ni `412`, ni campo nuevo que lo anuncie.

Cada uno de esos, si aterriza, va en su propio spec.
