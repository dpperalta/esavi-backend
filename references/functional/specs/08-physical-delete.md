# SPEC F08 — Borrado físico `005C`, restringido a SUPERADMIN

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Fecha:** 2026-08-10
> **Objetivo:** Dar una vía legítima, autorizada y auditada de borrado físico a las 27 tablas que el esquema no protege, mediante una operación `005C` reservada a SUPERADMIN.

---

## 1. Por qué existe este spec

El esquema protege contra el borrado físico **18 de las 45 tablas**. El bucle de `esaviapp.sql:1354-1360` instala `TRG_<tabla>_preventPhysicalDelete` sobre las maestras y deja fuera a las **27 restantes**, donde un `DELETE` ejecuta sin error.

El repositorio, en cambio, se comporta como si las 45 estuvieran protegidas: `005A` es siempre un `update` lógico y no existe ninguna otra vía. `CONVENTIONS.md` §11 llegaba a afirmar que «un `DELETE` nunca borra físicamente», lo que era cierto de la API y falso de la base.

De ahí salen dos problemas, y el segundo es el grave:

**A — Las tablas transaccionales no se pueden depurar.** Una asignación geográfica creada por error, un notificador duplicado o una investigación de prueba quedan en `isActive: false` para siempre. El esquema permite retirarlas de verdad; la aplicación no ofrece cómo.

**B — La capacidad existe, pero solo fuera de la aplicación.** Quien tiene acceso a la base puede borrar esas 27 tablas por SQL directo: sin comprobación de rol, sin validar el estado de la fila, sin dejar rastro y sin que ningún log lo registre. La ausencia de una vía controlada no evita el borrado — lo empuja a la única vía que no tiene ningún control.

Este spec cierra la brecha con una operación de la API que hace lo que el SQL directo no hace: exige SUPERADMIN, exige que la fila esté ya retirada, y escribe el contenido completo de la fila al log antes de destruirla.

El hallazgo se detectó al redactar el [SPEC F07](./07-notifier-crud.md), que lo dejó anotado como riesgo en su §7 al descubrir que `notifier` no figura en la lista de tablas protegidas.

---

## 2. Alcance

**Dentro:**

- La operación `ESAVI-<ENTIDAD>-005C`, `DELETE /purge/:id`, rol SUPERADMIN, en las 27 tablas sin protección.
- El servicio genérico `purgeEntityService` en `src/services/common/entityPurge.service.ts`, gemelo de `setEntityActiveStatusService`.
- La precondición de estado: solo se purga una fila que ya esté en `isActive: false`. Si sigue activa, 409.
- El volcado de la fila completa a `esaviLog` en nivel `warn`, antes del `destroy`, como único rastro de la operación.
- La norma en `references/CONVENTIONS.md`: §6 (numeración, acciones de `AppError` y sub-sección propia con la regla de disponibilidad y la lista de las 27 tablas), §9 (matriz de roles), §10 (status y respuesta sin `data`), §11 (contrato del servicio) y §15 (checklist de PR).
- La implementación de referencia en `appUserGeoLocation`, la única de las 27 que ya tiene endpoints.
- Tres claves i18n por entidad: `purgeSuccess`, `purgeFailed` y `stillActive`.

**Fuera de alcance (otros specs):**

- Modificar `esaviapp.sql`, incluido añadir las 27 tablas al bucle `preventPhysicalDelete`. El DDL no se toca.
- Purga en cascada explícita, o bloqueo de la purga cuando la fila tiene hijos. Se documenta el comportamiento del `ON DELETE CASCADE` del esquema; no se altera ni se envuelve.
- Una tabla de auditoría persistente para los borrados. El rastro es el log, con las limitaciones que §7 recoge.
- Purga masiva, por lote, por rango de fechas o por criterio distinto de la PK.
- Purga programada o automática de filas retiradas hace más de N días.
- Implementar `005C` en las 26 entidades que todavía no tienen modelo. Cada spec la añade cuando aterrice su entidad, y el [SPEC F07](./07-notifier-crud.md) es el primero que lo hace.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

**No hay tablas nuevas ni columnas nuevas.** Esta operación no escribe: destruye. Reutiliza los modelos ya declarados por cada entidad.

### 3.1 Qué tablas quedan habilitadas

La regla es objetiva y se verifica contra el DDL: **una entidad expone `005C` si y solo si su tabla no figura en el bucle `preventPhysicalDelete` de `esaviapp.sql:1354-1360`.** No se decide por entidad ni por criterio de dominio.

Protegidas, y por tanto **sin** `005C` (18): `catalogType`, `catalogItem`, `geoLevelType`, `geoLocation`, `healthFacility`, `diagnosticTerm`, `vaccineWhodrug`, `diluentCatalog`, `patient`, `esaviCase`, `appUser`, `appRole`, `appPermission`, `appUserRole`, `appRolePermission`, `appSession`, `systemConfig`, `systemConfigHistory`.

Habilitadas, y por tanto **con** `005C` (27):

| Dominio | Tablas | Hijos por cascada |
|---|---|---|
| Auth | `appUserGeoLocation` | ninguno |
| Núcleo ESAVI | `notifier`, `classification`, `finalClassification` | ninguno |
| Notificación | `notification` | **8** |
| Notificación | `severeNotification`, `nonSevereNotification`, `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy`, `notificationPregnancyComplication` | ninguno, salvo `notificationVaccine` → `notificationDiluent` y `notificationPregnancy` → `notificationPregnancyComplication` |
| Investigación | `investigation` | **14** |
| Investigación | las otras 13 de investigación | ninguno |

En las 18 protegidas el endpoint **no se declara**. Declararlo daría un 500 de Postgres por una operación que la norma nunca debió ofrecer.

### 3.2 El servicio genérico

`src/services/common/entityPurge.service.ts`, calcado en forma de `entityActivation.service.ts`. Recibe el modelo, el `where`, la transacción, el código de operación, el `userId`, y los mensajes y códigos de los dos errores. Devuelve `void`: no queda nada que devolver.

Cuatro pasos, en este orden:

1. `findOne` por la PK con `paranoid: false`, dentro de la transacción → 404 con `notFoundCode`.
2. Si `isActive === true` → 409 con `stillActiveCode`.
3. `esaviLog` en nivel `warn` con el código de operación, el `userId` y `JSON.stringify` de la fila.
4. `destroy({ force: true, transaction })`.

El `where` filtra **solo por la PK**. Meter `isActive: false` en el `where` convertiría el 409 del segundo paso en un 404 que miente: el recurso existe, lo que pasa es que sigue vivo.

**No toca `appDetails`.** Es la única operación de escritura del repositorio que no añade entrada de auditoría, y no es un olvido: la fila desaparece en la misma transacción, así que cualquier cosa escrita en ella se destruye con ella.

### 3.3 Tipos

Ninguno nuevo. La operación recibe una PK por la ruta y nada por el body.

### 3.4 Superficie HTTP

Una fila por entidad habilitada. El patrón es idéntico en todas:

```
DELETE /api/<recurso>/purge/:id      ESAVI-<ENTIDAD>-005C   SUPERADMIN
```

| Entidad | Ruta | Código | Estado |
|---|---|---|---|
| `appUserGeoLocation` | `DELETE /api/user-geo-locations/purge/:id` | `ESAVI-USERGEO-005C` | **(nuevo)** |
| `notifier` | `DELETE /api/notifiers/purge/:id` | `ESAVI-NOTIFIER-005C` | (previsto — [SPEC F07](./07-notifier-crud.md)) |
| las 25 restantes | `DELETE /api/<recurso>/purge/:id` | `ESAVI-<ENTIDAD>-005C` | (previsto, con el spec de su entidad) |

`/purge/:id` es una ruta literal y se declara **antes** de `/:id`, junto a `/admin` y `/activate/:id`, o Express capturará `purge` como un `:id` y el validador de UUID responderá 400.

El validador es el `entityIdValidator` que la entidad ya tiene. No se escribe uno nuevo.

### 3.5 Reglas de la operación

**`ESAVI-<ENTIDAD>-005C` — purgar.** En este orden:

1. La fila existe, buscada con `paranoid: false` → 404 `<ENT>_005C_NOT_FOUND`.
2. La fila está en `isActive: false` → si no, 409 `<ENT>_005C_STILL_ACTIVE`.
3. Volcado al log en nivel `warn`.
4. `destroy` dentro de la transacción.

**El 409 es la decisión central.** El borrado físico solo alcanza a lo que alguien retiró antes con `005A`. Son dos pasos deliberados, y el primero es reversible: ésa es la red de seguridad de una operación que no la tiene por ningún otro lado. Es 409 y no 400 porque el cliente no envió nada mal — lo que impide la purga es el estado del recurso.

**Cascada.** El `ON DELETE CASCADE` del DDL **sí dispara** en estas tablas, porque no hay trigger que impida el borrado físico. Purgar una fila de `investigation` destruye sus 14 satélites; purgar una de `notification` destruye las 8 suyas. La operación **no lo bloquea ni lo envuelve**: es el comportamiento declarado del esquema, y quien tiene SUPERADMIN puede provocarlo igualmente por SQL directo.

**Transacción obligatoria**, aunque la escritura sea una sola. El `destroy` de una raíz con satélites es N escrituras que la base resuelve por cascada, y un fallo a mitad debe dejar el grafo entero intacto.

**Errores no esperados** los envuelve el controlador en un `AppError` 500 con `<ENT>_005C_PURGE_FAILED`, siguiendo el idiom de tres pasos de §10.

### 3.6 Claves i18n nuevas

Tres por entidad habilitada, dentro de su propio bloque, en `es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `purgeSuccess` | 200 tras destruir la fila |
| `purgeFailed` | 500 inesperado en `005C` |
| `stillActive` | 409 cuando la fila sigue activa. Lleva `{{id}}` |

El 404 reutiliza la clave `notFound` que toda entidad ya tiene. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

Los nombres siguen el estilo del bloque de cada entidad: donde el bloque usa `deleteSuccess` y `activateSuccess`, la clave es `purgeSuccess`; donde use participio, seguirá su propia forma. La paridad entre idiomas es lo que la suite comprueba, no la uniformidad entre entidades.

### 3.7 Forma de la respuesta

```
{ ok, message }
```

Sin `data`, como `005A` y `005B`. No queda fila que devolver, y devolver el contenido de lo que se acaba de destruir invitaría a que un cliente lo tratara como recuperable.

---

## 4. Plan de implementación

1. **La norma en `references/CONVENTIONS.md`.** §6: fila `005C` en la tabla de numeración, `PURGE_FAILED` y `STILL_ACTIVE` en las acciones de `AppError`, y sub-sección `### Borrado físico — 005C` con la regla de disponibilidad, las dos listas de tablas y el aviso de cascada. §9: fila en la matriz canónica. §10: el 409 en la tabla de status y `purge` entre las respuestas sin `data`. §11: sub-sección con el contrato del servicio y corrección de la frase que afirmaba que un `DELETE` nunca borra físicamente. §15: dos ítems de checklist.
   *Verificación:* la lista de las 27 tablas de §6 coincide exactamente con el complemento de la lista de `esaviapp.sql:1354-1360`; §15 dice explícitamente que la ausencia de `appDetails.method` en `005C` no es incumplimiento.

2. **El servicio genérico.** `src/services/common/entityPurge.service.ts` con los cuatro pasos de §3.2. Sin barrel: los servicios de `common/` se importan por ruta directa, como `entityActivation.service.ts`.
   *Verificación:* `npm run build` en 0; el archivo no importa ningún modelo concreto.

3. **`ESAVI-USERGEO-005C` — la implementación de referencia.** `purgeAppUserGeoLocationService` con transacción propia; controlador `purgeAppUserGeoLocation` con el idiom de tres pasos; ruta `DELETE /purge/:id` en SUPERADMIN declarada antes de `/:id`, reutilizando `appUserGeoLocationIdValidator`. Las tres claves i18n en los tres idiomas.
   *Verificación:* purgar una fila activa devuelve 409 y la fila sigue ahí; cerrarla y purgarla devuelve 200 y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403.

4. **Cubrir la ruta en `tests/auth/roles.test.ts`.** Una fila nueva en `ROUTE_RULES` y el total esperado **+1**.
   *Verificación:* `npm test -- roles` pasa y el 403 se comprueba por los dos lados.

5. **Ampliar `tests/contract/appUserGeoLocation.test.ts`.** Bloque `ESAVI-USERGEO-005C` con los cuatro casos del paso 3, situado antes del bloque que comprueba el invariante de pares para no dejarle filas a medias.
   *Verificación:* `npm test` en verde, sin perder ninguno de los casos anteriores.

Los pasos 2 a 5 se pueden committear juntos: el servicio genérico sin ningún consumidor no aporta nada verificable.

---

## 5. Criterios de aceptación

**La norma**

- [x] `CONVENTIONS.md` §6 lista `005C` en la tabla de numeración con `DELETE /purge/:id` y status 200.
- [x] Las acciones estándar de `AppError` incluyen `PURGE_FAILED` y `STILL_ACTIVE`.
- [x] La lista de las 27 tablas habilitadas es exactamente el complemento de las 18 de `esaviapp.sql:1354-1360`.
- [x] §9 declara `005C` en SUPERADMIN.
- [x] §10 incluye el 409 por fila todavía activa y `purge` entre las respuestas sin `data`.
- [x] §11 ya no afirma que un `DELETE` nunca borra físicamente.
- [x] §15 dice explícitamente que la ausencia de `appDetails.method` en `005C` no cuenta como incumplimiento del código en cinco lugares.

**El servicio genérico**

- [x] `purgeEntityService` no importa ningún modelo concreto.
- [x] El `where` que recibe filtra solo por la PK.
- [x] Busca con `paranoid: false`: una fila ya soft-deleted se encuentra.
- [x] No escribe en `appDetails` en ningún camino.
- [x] El `esaviLog` va **antes** del `destroy` y en nivel `warn`.

**`ESAVI-USERGEO-005C`**

- [x] `DELETE /api/user-geo-locations/purge/:id` sobre una fila activa devuelve **409** `USERGEO_005C_STILL_ACTIVE`, y la fila sigue existiendo.
- [x] Sobre una fila cerrada devuelve **200** con `{ ok, message }` y sin `data`.
- [x] Tras la purga, `AppUserGeoLocation.findByPk(id, { paranoid: false })` devuelve `null`.
- [x] Repetir la purga devuelve **404** `USERGEO_005C_NOT_FOUND`.
- [x] Un ADMIN recibe **403**.
- [x] `GET /api/user-geo-locations/purge/<uuid>` no responde 400 por validación de UUID: la literal se declara antes de `/:id`.
- [x] El log recoge una línea `ESAVI-USERGEO-005C` en nivel `warn` con el `userId` y el volcado de la fila.

**Cierre**

- [x] `purgeSuccess`, `purgeFailed` y `stillActive` existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [x] `ROUTE_RULES` tiene una entrada más y `npm test -- roles` pasa.
- [x] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el código de operación**

- **Sí:** `005C`. Es una variante de la operación `005` —borrar—, que es exactamente lo que §6 dice que distinguen los sufijos `A`/`B`/`C`. No estira el rango con una operación ajena.
- **No:** un número desde `006`, como manda §6 para las operaciones no canónicas. Habría dado un número distinto en cada entidad —`006` en `notifier`, `009` en `appUserGeoLocation`— y el mismo concepto sería imposible de buscar de forma uniforme en el log, que es justo para lo que sirve un código de operación.
- **No:** un número fijo alto y transversal, tipo `090`. Deja claro que no es un CRUD normal, pero obliga a registrar una excepción a la regla de numeración correlativa y no gana nada frente a `005C`.

**Sobre la ruta**

- **Sí:** `DELETE /purge/:id`. Literal primero, como `/activate/:id`, así que el orden de declaración se razona una sola vez para todas las literales.
- **No:** `DELETE /:id/purge`, más cercano a REST puro. Sería la única ruta del repositorio con esa forma y obligaría a razonar de nuevo su relación con `/:id`.
- **No:** `DELETE /permanent/:id`. Equivalente; `purge` es más corto y es jerga habitual de bases de datos.
- **No:** reutilizar `DELETE /:id` con un query param tipo `?permanent=true`. La misma ruta haría dos cosas de reversibilidad opuesta según un parámetro que es fácil dejar puesto, y `validateUserRole` no puede exigir dos niveles distintos en la misma ruta.

**Sobre la precondición**

- **Sí:** exigir `isActive: false`. Dos pasos deliberados, el primero reversible, son la única red de seguridad posible en una operación que no se puede deshacer.
- **No:** purgar en un solo paso, esté la fila activa o no. Menos fricción para limpiar datos de prueba, y pérdida irreversible por una petición suelta en producción.
- **No:** exigir además un parámetro de confirmación que repita el identificador, al estilo del `?enable=` del seed. La precondición de estado ya obliga a dos operaciones distintas; un tercer paso solo añade ceremonia, y el único precedente del repositorio —`/api/seed/admin`— es precisamente el endpoint que `CONVENTIONS.md` señala como no ejemplar.

**Sobre el alcance**

- **Sí:** una regla objetiva contra el DDL en vez de una lista curada por criterio de dominio. La lista se puede reconstruir en cualquier momento leyendo `esaviapp.sql:1354-1360`, así que no se desincroniza en silencio.
- **Sí:** las 27, incluidas `investigation` y `notification`, avisando de la cascada. Excluirlas dejaría la norma con una lista de excepciones que mantener a mano, y el borrado en cascada sigue estando disponible por SQL directo para quien tiene ese acceso.
- **No:** bloquear la purga de una fila con hijos y obligar a purgar de abajo hacia arriba. Es lo más seguro y lo más caro: cada raíz tendría que consultar sus satélites antes de borrar, acoplando entidades que hoy no se conocen, y el resultado neto sería el mismo grafo destruido con más peticiones.
- **No:** exponer `005C` en las 18 protegidas. El trigger rechazaría el `DELETE` y el cliente recibiría un 500 por una operación que la norma nunca debió ofrecer.

**Sobre la auditoría**

- **Sí:** volcar la fila completa al log antes del `destroy`. Es el único rastro posible sin tocar el esquema, y permite reconstruir qué había.
- **Sí:** nivel `warn`, no `info`. Una operación irreversible debe destacar en un archivo donde el resto es tráfico normal.
- **No:** escribir la entrada en `appDetails` antes de borrar. Se destruye en la misma transacción; sería trabajo que se borra a sí mismo.
- **No:** una tabla de auditoría persistente. Es un cambio de esquema, y `esaviapp.sql` no se toca en este spec. Queda como riesgo declarado en §7.
- **Sí:** volcar la fila tal como sale de la instancia de Sequelize. Los campos cifrados con `esaviCrypt` se escriben **cifrados**, porque el descifrado ocurre al construir la respuesta y no al leer de la base (`src/services/patient.service.ts:62`). No hace falta ninguna lista de campos PII por entidad, y el log no filtra datos personales en claro por esta vía.

**Sobre los roles**

- **Sí:** SUPERADMIN, uno solo. Es el nivel que ya gobierna la reactivación (`005B`) y el único que ve los registros inactivos por `canViewInactive`, que son precisamente los únicos purgables.
- **No:** ADMIN, aunque sea quien ejecuta el `005A` previo. Retirar y destruir son decisiones de distinta magnitud, y quien retira debe poder hacerlo sin poder destruir.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El log es el **único** rastro de una operación irreversible, y `esaviLog` escribe en `src/logs/`, que está en `.gitignore`, sin política de retención y con rotación por tamaño a 10 MB (`src/helpers/esaviLogs.helper.ts:17`). Un volumen alto de tráfico puede desplazar la línea de la purga | Es lo mejor posible sin tocar el esquema. Una tabla de auditoría persistente resolvería el problema de fondo y va en su propio spec. Mientras tanto, conviene que el despliegue archive `esaviLog.log` fuera de la máquina |
| Purgar `investigation` o `notification` destruye 14 y 8 tablas satélite respectivamente, sin ninguna advertencia en la respuesta | Documentado en §6 de `CONVENTIONS.md` y en §3.1 de este spec. La precondición de `isActive: false` obliga a retirar la raíz antes, que es un paso donde el operador ya decidió que el registro sobra. Ninguna de las dos entidades tiene modelo todavía: el spec que las implemente debe repetir el aviso en su propio texto |
| La lista de 27 tablas de `CONVENTIONS.md` §6 se desincroniza si alguien modifica el bucle `preventPhysicalDelete` del DDL | La norma no depende de la lista sino de la regla, y la lista se declara como derivada de `esaviapp.sql:1354-1360` con esa referencia explícita. Cualquier cambio del DDL obliga a releerla |
| `005C` es la única operación cuyo código no aparece en los cinco lugares de §6, sino en cuatro | Declarado explícitamente en §6 y en el checklist de §15, para que no se lea como un incumplimiento ni se "arregle" añadiendo un `appDetails` que se destruye solo |
| Un SUPERADMIN puede purgar por error una fila que otro equipo aún necesitaba, y no hay deshacer | Es la naturaleza de la operación. La precondición de dos pasos y el nivel de rol son las dos barreras; la tercera es el volcado al log, que al menos permite reconstruir el contenido a mano |
| Ninguna suite cubre la purga de una raíz con satélites: `appUserGeoLocation` no tiene hijos y es la única entidad implementada de las 27 | El comportamiento en cascada lo garantiza el DDL, no el código de la aplicación. El primer spec que implemente `notification` o `investigation` debe añadir esa cobertura |

---

## 8. Impacto en el contrato HTTP

Este spec **solo añade** un endpoint nuevo por entidad habilitada. Ningún endpoint existente cambia de forma, de status ni de efecto lateral.

La única frase del contrato que cambia es documental: `CONVENTIONS.md` §11 afirmaba que «un `DELETE` nunca borra físicamente». Sigue siendo cierto de `DELETE /:id`, y deja de serlo de la entidad en su conjunto.

---

## Lo que **no** está en este spec

- Modificar `esaviapp.sql`, incluido añadir las 27 tablas al bucle `preventPhysicalDelete`.
- Purga en cascada explícita o bloqueo por hijos existentes.
- Una tabla de auditoría persistente para los borrados.
- Purga masiva, por lote o por rango de fechas.
- Purga programada o automática de filas retiradas hace más de N días.
- Recuperación o papelera de reciclaje para lo purgado.
- Implementar `005C` en las 26 entidades que todavía no tienen modelo.
- Exponer `005C` en cualquiera de las 18 tablas protegidas.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
