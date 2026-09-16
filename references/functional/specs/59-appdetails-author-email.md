# SPEC F59 — Autor de auditoría por email en las respuestas

> **Estado:** Borrador
> **Depende de:** SPEC 01 (roles y superficie expuesta), SPEC 04 (contrato de respuesta), SPEC 06 (`AppDetails` tipado), SPEC 07 (tooling y tests), SPEC F04 (`appUser` — `decryptPii` / `toUserResponse`, y la ausencia de `005C` sobre usuarios), SPEC F08 (borrado físico `005C`), SPEC F12 (precedente de spec transversal y del directorio `tests/unit/`)
> **Fecha:** 2026-09-12
> **Objetivo:** Que ninguna respuesta de la API exponga un UUID en `appDetails[].user`: la lectura sustituye el `userId` por el email descifrado del autor, con **una** consulta por respuesta y sin cambiar nada de lo que se escribe.

---

## 1. Por qué existe este spec

Cierra [DEUDA-045](../../TECHNICAL_DEBT.md#deuda-045).

Toda tabla del esquema lleva `appDetails`, un array JSONB append-only donde cada entrada guarda en `user` el `userId` de quien ejecutó la operación (`src/types/common/audit.types.ts:16-21`). Ese array viaja íntegro en casi todas las respuestas: los servicios excluyen `sysDetails` con `attributes: { exclude: [...] }`, pero no `appDetails`. Solo `user.service.ts:63-67` (`toUserListRow`) y un listado de `systemConfig.service.ts` lo quitan.

El consumidor recibe así un identificador interno que no puede mostrar sin una llamada extra por cada UUID, y que tampoco necesita. Lo que quiere mostrar es quién hizo el cambio, y para eso sirve el email.

**La escritura no cambia.** Guardar el email en lugar del `userId` se descartó en DEUDA-045 y se mantiene descartado (§6): dejaría PII sin cifrar para siempre en el JSONB de todas las tablas, supone unos 146 puntos de escritura y no arregla ninguna fila existente. Este spec actúa **solo en la lectura**.

**Una corrección al diagnóstico de la deuda.** DEUDA-045 da como caso de «autor no resoluble» un usuario purgado por su `005C`. Ese caso no existe: `user.service.ts` no tiene `ESAVI-USER-005C` y `src/routes/user.routes.ts` no monta ningún `DELETE` físico, así que una fila de `appUser` nunca desaparece. Los únicos `user` no resolubles son literales escritos cuando la operación no traía `authUser`: `'undefined'` (el fallback uniforme de `CONVENTIONS.md` §Auditoría) y `'unknown'` (`catalogType.service.ts:57`, una desviación). A estos se suma un tercero: un `appUser` que existe con `email` en `NULL`, porque la columna es `citext` sin `NOT NULL` en `esaviapp.sql`.

**No hay superficie HTTP nueva.** No hay rutas, códigos de operación, claves i18n ni filas de `ROUTE_RULES` nuevas. Cambia el **valor** de un campo ya publicado en las respuestas, así que, como en el SPEC F12, §3 se escribe con tablas Antes/Después.

---

## 2. Alcance

**Dentro:**

- **Funciones puras** en `src/helpers/appDetailsAuthors.helper.ts`, exportadas por el barrel: `toPlainResponse`, `collectAppDetailsUserIds` y `applyAppDetailsAuthors`.
- **Un servicio común** en `src/services/common/appDetailsAuthors.service.ts`: `resolveAppDetailsAuthorsService(data)`. Reúne los `userId`, hace **una** consulta a `AppUser`, descifra y sustituye.
- **Un tipo de respuesta** `AppDetailsResponse` en `audit.types.ts`, donde `user` es `string | null`. `AppDetails` (el tipo de escritura) no cambia.
- **Aplicación en los 44 servicios** que devuelven al controlador datos con `appDetails` (inventario en §3.4): lecturas `002A`/`002B`/`003`/`006`, y también las respuestas de `001`, `004` y `005A`/`005B`, que devuelven la fila con su historial.
- **Visibilidad uniforme:** todo rol que tenga acceso al endpoint recibe el email. No depende del rol.
- **Autor no resoluble → `null`.**
- **Suite unitaria** `tests/unit/appDetailsAuthors.test.ts` y **suite de contrato** `tests/contract/appDetailsAuthors.test.ts`.
- **Actualización de `references/CONVENTIONS.md`** §Auditoría y de su checklist §15.
- **Cierre de DEUDA-045** en `references/TECHNICAL_DEBT.md`, con la corrección del caso «usuario purgado».

**Fuera de alcance (otros specs):**

- **Cambiar lo que se escribe en `appDetails`.** El `userId` sigue siendo el valor guardado.
- **Normalizar los literales `'undefined'` / `'unknown'` en escritura**, o migrar filas existentes. El resultado de este spec es el mismo con cualquiera de los dos literales. Unificar `catalogType.service.ts:57` a `'undefined'` es otra deuda.
- **`sysDetails`** y su `auditTrail.actor`. No se exponen en ninguna respuesta.
- **Restringir por rol la visibilidad del email.** Se evaluó y se decidió que no (§6).
- **Añadir o quitar `appDetails` de una respuesta.** Si hoy un listado lo excluye (`toUserListRow`), lo sigue excluyendo. Si hoy lo incluye, lo sigue incluyendo.
- **Logs.** `esaviLog` y el volcado del `005C` siguen escribiendo lo que escriben hoy.
- **Una capa de serialización general** para todas las respuestas.

---

## 3. Qué cambia

### 3.1 Tablas y modelos

No hay tablas, columnas, modelos ni asociaciones nuevas, ni migración de esquema. La única tabla nueva que se consulta es `appUser`, y solo sus columnas `userId` y `email`.

### 3.2 Tipos — `src/types/common/audit.types.ts`

| | Antes | Después |
|---|---|---|
| `AppDetails` | `{ createdAt: Date; user: string; method: string; detail: string }` | sin cambios. Es la forma **guardada** |
| `AppDetailsResponse` | no existe | `Omit<AppDetails, 'user'> & { user: string \| null }`. Es la forma **respondida** |

Los servicios siguen construyendo entradas con `AppDetails`. El tipo nuevo documenta el contrato de salida y es el que usan las suites.

### 3.3 Las piezas

**Funciones puras — `src/helpers/appDetailsAuthors.helper.ts`.** No acceden a la base y se prueban sin ella.

```ts
// Model instances (also nested inside includes) become plain objects: the same thing
// res.json would produce, but early enough to rewrite them
export const toPlainResponse = (data: unknown): unknown => { ... }

// Walks the plain value and returns the distinct `user` values, under any key named
// `appDetails` whose value is an array, that are UUIDs
export const collectAppDetailsUserIds = (plain: unknown): string[] => { ... }

// Replaces every `appDetails[].user` in place with authors.get(user) ?? null
export const applyAppDetailsAuthors = (plain: unknown, authors: Map<string, string>): unknown => { ... }
```

**Servicio común — `src/services/common/appDetailsAuthors.service.ts`.** Vive en `services/common/` y no en `helpers/` porque consulta la base. En este repositorio el acceso a Sequelize es de los servicios, igual que en `setEntityActiveStatusService`.

```ts
// Resolves the author of every audit entry in a response to the author's email.
// One query per call, whatever the number of rows or entries
export const resolveAppDetailsAuthorsService = async <T>(data: T): Promise<unknown> => {
    const plain = toPlainResponse(data);
    const userIds = collectAppDetailsUserIds(plain);
    const authors = new Map<string, string>();
    if( userIds.length > 0 ){
        const users = await AppUser.findAll({
            where: { userId: userIds },
            attributes: [ 'userId', 'email' ]
        });
        for( const user of users ){
            const email = user.getDataValue('email');
            if( typeof email === 'string' ) authors.set(user.getDataValue('userId'), esaviDecrypt(email));
        }
    }
    return applyAppDetailsAuthors(plain, authors);
}
```

**Reglas del recorrido:**

1. **Se reconoce por el nombre de la clave, no por la forma de las entradas.** Se procesa toda propiedad llamada `appDetails` cuyo valor sea un array, en cualquier nivel: raíz, `rows` de `{ count, rows }`, arrays, sub-entidades de un `include` y objetos compuestos que arma el servicio. Es la objeción de DEUDA-045 al middleware: reconocer la entrada por sus claves (`createdAt`, `user`, `method`, `detail`) reescribiría cualquier JSONB que coincidiera por casualidad. `appDetails` es el nombre de columna fijado por `CONVENTIONS.md` en todas las tablas, así que la clave basta.
2. **No se entra en las entradas de auditoría.** Dentro de un array `appDetails` solo se toca `user` de cada entrada, y el recorrido no baja a `detail`.
3. **Solo los UUID van a la consulta.** Lo que no casa con `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` se descarta antes del `IN`. No es cosmético: `"userId"` es `uuid`, y un `'undefined'` dentro del `IN` hace fallar la consulta entera con `22P02 invalid input syntax for type uuid`. Sería un 500 en cualquier registro creado sin `authUser`.
4. **La consulta no filtra por `isActive`.** Un usuario desactivado sigue siendo el autor de lo que hizo. `appUser` no tiene `defaultScope` ni `paranoid`.
5. **Todo `user` se reescribe.** UUID resuelto → email descifrado. UUID sin fila, fila con `email` nulo, `'undefined'`, `'unknown'` o cualquier otro literal → `null`. Tras la llamada no queda ningún valor guardado en crudo.
6. **Si no hay UUID, no hay consulta.** Una respuesta sin `appDetails`, o solo con literales, cuesta cero consultas.
7. **Las fechas se conservan.** `toPlainResponse` usa `instance.get({ plain: true })` y deja los `Date` como `Date`. La serialización a cadena la hace `res.json`, como hoy.

### 3.4 Dónde se llama — inventario por servicio

**La regla:** cada función de servicio exportada que un controlador pone en `data` pasa su valor de retorno por `resolveAppDetailsAuthorsService` **justo antes del `return`** y **después del `commit`** si hay transacción. La consulta de autores nunca va dentro de la transacción de escritura.

No hay servicios de lectura que otros servicios reutilicen: ningún servicio hace `await get*Service(...)` sobre otro. Por eso resolver en el `return` no cambia lo que recibe ningún llamador interno. El paso 5 lo vuelve a comprobar antes de migrar.

| Familia | Archivos (`src/services/`) |
|---|---|
| Catálogos y configuración | `catalogType`, `catalogItem`, `diluentCatalog`, `vaccineWhodrug`, `whodrugProduct`, `diagnosticTerm`, `systemConfig` |
| Geografía e instituciones | `geoLevelType`, `geoLocation`, `healthFacility`, `evaluationInstitution` |
| Usuarios y roles | `user`, `appRole`, `appUserRole`, `appUserGeoLocation` |
| Paciente y caso | `patient`, `esaviCase`, `classification`, `finalClassification`, `caseWorkflow`, `notifier` |
| Notificaciones | `notification`, `severeNotification`, `nonSevereNotification`, `notificationEvent`, `notificationMedication`, `notificationVaccine`, `notificationDiluent`, `notificationPregnancy`, `notificationPregnancyComplication`, `notificationMedicalHistory` |
| Investigación | `investigation`, `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationMedicalHistory`, `investigationPregnancyCondition`, `investigationClinicalEvaluation`, `investigationVaccinationContext`, `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError`, `investigationCommunity`, `investigationDiagnostic` |

**No se tocan**, con su razón:

| Archivo | Razón |
|---|---|
| `auth`, `appSession`, `appPasswordReset` | escriben `appDetails` pero sus respuestas son tokens y mensajes, no filas. El paso 5 lo verifica |
| `common/entityActivation`, `common/satelliteCascade`, `common/ageRecalculation`, `common/diagnosticTermResolution`, `common/entityPurge` | internos: devuelven a otro servicio, no a un controlador. Resuelve el servicio de la entidad que responde |
| `geoImport`, `meddra` y las importaciones masivas | devuelven resúmenes de importación (conteos y errores por fila), no filas con `appDetails` |

**Borrado físico `005C`.** Responde sin la fila, que ya no existe, así que no hay nada que resolver. Si alguna respuesta de `005C` devuelve la fila eliminada, la regla se aplica igual. El paso 5 lo comprueba.

**`user.service.ts`.** `toUserResponse` sigue descifrando la PII propia de la fila. `resolveAppDetailsAuthorsService` se aplica aparte, sobre el resultado, porque los autores del historial de un usuario son **otros** usuarios.

### 3.5 Coste

| Recurso | Por respuesta |
|---|---|
| Consultas | **0** si no hay UUID; **1** en cualquier otro caso: `SELECT "userId", "email" FROM "appUser" WHERE "userId" IN (...)` por PK |
| Tamaño del `IN` | número de **autores distintos** de la respuesta, no de filas ni de entradas. Con `MAX_LIMIT = 100` (`src/constants/pagination.constants.ts`) está acotado incluso en el peor caso |
| CPU | un `createDecipheriv` por autor distinto, del orden de microsegundos, más un recorrido lineal del objeto respondido |
| Memoria | ninguna copia extra: `toPlainResponse` sustituye a la conversión que `res.json` ya hacía, y la sustitución es en el sitio |
| Payload | un email ocupa más o menos lo mismo que un UUID de 36 caracteres; `null` ocupa menos |

### 3.6 Contrato HTTP y claves i18n

No hay claves i18n nuevas: el caso no resoluble es `null` y no un literal traducido. No hay rutas nuevas ni filas nuevas o modificadas en `ROUTE_RULES`. La forma de `data` no cambia; cambia el valor de `appDetails[].user` (§8).

---

## 4. Plan de implementación

Doce pasos. Cada uno se puede committear por separado y deja `npm run check` en verde.

1. **Tipo de respuesta.** `AppDetailsResponse` en `src/types/common/audit.types.ts`, exportado por el barrel de `types`.
   *Verificación:* `npm run build` pasa.

2. **Funciones puras.** `src/helpers/appDetailsAuthors.helper.ts` con `toPlainResponse`, `collectAppDetailsUserIds` y `applyAppDetailsAuthors`, con las reglas 1, 2, 3, 5 y 7 de §3.3. Alta en `src/helpers/index.ts`. Todavía nadie las llama.
   *Verificación:* `npm run build` pasa y el import desde `'../helpers'` resuelve.

3. **Suite unitaria.** `tests/unit/appDetailsAuthors.test.ts`. Casos:
   - `appDetails` en la raíz, en `{ count, rows }`, en un `include` anidado y en un objeto compuesto;
   - una propiedad **no** llamada `appDetails` con entradas de la misma forma, que no se toca;
   - `'undefined'`, `'unknown'` y un UUID sin autor → `null`;
   - UUID repetidos que se recogen una sola vez;
   - un `Date` que sigue siendo `Date`;
   - `detail` sin tocar.

   *Verificación:* `collectAppDetailsUserIds({ appDetails: [{ user: 'undefined' }] })` devuelve `[]`.

4. **Servicio común.** `src/services/common/appDetailsAuthors.service.ts` con `resolveAppDetailsAuthorsService`, según §3.3 (reglas 4 y 6).
   *Verificación:* `npm run build` pasa.

5. **Comprobación del inventario.** Antes de migrar, confirmar sobre el código tres cosas. Si alguna falla, se corrige §3.4 en este spec antes de seguir:
   - que ningún servicio de §3.4 reutiliza la salida de otro;
   - que `auth`, `appSession`, `appPasswordReset`, `geoImport`, `meddra` y las importaciones no devuelven filas con `appDetails`;
   - qué `005C` devuelven la fila.

   *Verificación:* §3.4 coincide con el código.

6. **Entidad de referencia: `healthFacility`** y **suite de contrato** `tests/contract/appDetailsAuthors.test.ts`:
   - `POST` como ADMIN; `GET /:id` como USER → `appDetails[0].user` es el email del usuario ADMIN del fixture, en claro;
   - el listado da el mismo valor en `rows[*].appDetails[*].user`;
   - la respuesta del propio `POST` y la de un `PUT` con cambio real ya traen el email;
   - una fila con una entrada `'undefined'` insertada por SQL directo → `user: null` y 200, no 500;
   - **conteo de consultas:** con el `logging` de Sequelize interceptado durante la petición, un listado de N filas con varios autores ejecuta **exactamente una** consulta sobre `"appUser"` además de la del `tokenValidation`;
   - **la escritura no cambia:** leyendo la fila por SQL directo, `appDetails[0].user` sigue siendo el `userId`.

   *Verificación:* la suite pasa y `healthFacility.test.ts` pasa sin cambios.

7. **Catálogos y configuración, y geografía e instituciones** (11 archivos).
   *Verificación:* las suites de contrato de esas entidades pasan. La suite de F59 añade un `GET /:id` por familia con el barrido del paso 11.

8. **Usuarios y roles** (4 archivos). En `user.service.ts`, la resolución va **después** de `toUserResponse` y no la sustituye.
   *Verificación:* `GET /api/users/:id` devuelve el email propio descifrado y los autores de `appDetails` como emails. `GET /api/users` sigue sin `appDetails`.

9. **Paciente y caso** (6 archivos), incluidas las sub-entidades de `esaviCase` que viajan con `include`.
   *Verificación:* `GET /api/esavi-cases/:id` como USER no contiene ningún UUID en ningún `appDetails[].user`, en ningún nivel.

10. **Notificaciones e investigación** (23 archivos).
    *Verificación:* las suites de contrato de las dos familias pasan.

11. **Barrido anti-UUID.** En `tests/contract/appDetailsAuthors.test.ts`, un recorrido recursivo `expectNoAuditUuids(body)` que falla si algún `appDetails[].user` casa con la expresión de UUID. Se aplica a un `003` y un `002A` por familia de §3.4, como USER cuando la ruta lo admite.
    *Verificación:* deshacer la llamada en cualquier servicio muestreado hace fallar su caso.

12. **Documentación y cierre.**
    - `references/CONVENTIONS.md` §Auditoría: nueva subsección **«Lectura»** con la regla de §3.4 (resolver antes del `return` y después del `commit`) y el significado de `null`.
    - Línea nueva en el checklist §15: *«Toda función que devuelve filas con `appDetails` pasa su resultado por `resolveAppDetailsAuthorsService`»*.
    - `references/TECHNICAL_DEBT.md`: DEUDA-045 marcada ✅, con dos notas: el caso «usuario purgado» no existe, y la «decisión pendiente» se resolvió a `null`. Fila `F59 → 045` en el mapa de resolución.

    *Verificación:* los enlaces resuelven y `045` sale de la lista «sin spec».

---

## 5. Criterios de aceptación

**Comportamiento:**

- [ ] Ninguna respuesta de la API contiene un UUID en `appDetails[].user`, en ningún nivel de anidamiento.
- [ ] Un `appDetails[].user` cuyo `userId` existe en `appUser` con email se responde como ese email **descifrado**.
- [ ] El mismo valor llega a todos los roles con acceso al endpoint: USER, ADMIN y SUPERADMIN ven lo mismo.
- [ ] Un autor de un usuario **desactivado** se resuelve igual que el de uno activo.
- [ ] `'undefined'`, `'unknown'`, un UUID sin fila y un usuario con `email` nulo se responden como `null`.
- [ ] Un registro con una entrada `'undefined'` responde **200**, no 500.
- [ ] Las respuestas de `001`, `004` y `005A`/`005B` que devuelven la fila traen ya los emails.
- [ ] El orden, la longitud, `createdAt`, `method` y `detail` de cada `appDetails` no cambian.

**Coste:**

- [ ] Un `002A` de N filas ejecuta **una** consulta sobre `"appUser"` para resolver autores, no N.
- [ ] Una respuesta sin UUID en `appDetails` no ejecuta ninguna consulta de resolución.
- [ ] La consulta de resolución nunca corre dentro de una transacción de escritura.

**La escritura no cambia:**

- [ ] Leída por SQL directo, cualquier fila creada o actualizada después de este spec sigue guardando el `userId` en `appDetails[].user`.
- [ ] `tests/contract/diagnosticTerm.test.ts:579`, que lee la fila de la base y espera `'resolution-test'`, pasa sin tocarse.
- [ ] Ningún archivo de §3.4 cambia la construcción de su `newEntry`.

**Código:**

- [ ] `src/helpers/appDetailsAuthors.helper.ts` existe, lo exporta el barrel y no importa ningún modelo.
- [ ] `src/services/common/appDetailsAuthors.service.ts` existe y es el único sitio nuevo que consulta `AppUser` para esto.
- [ ] `grep -rln "resolveAppDetailsAuthorsService" src/services/ | wc -l` devuelve **45**: los 44 servicios más su propia definición.
- [ ] Ningún middleware ni controlador reescribe `appDetails`.
- [ ] `AppDetails` (escritura) no cambia; `AppDetailsResponse` existe.

**Suites:**

- [ ] `tests/unit/appDetailsAuthors.test.ts` cubre los casos del paso 3.
- [ ] `tests/contract/appDetailsAuthors.test.ts` cubre los casos del paso 6 y el barrido del paso 11.
- [ ] `tests/auth/roles.test.ts` no cambia.
- [ ] `npm run i18n:check` sale en 0 sin claves nuevas.

**Documentación:**

- [ ] `CONVENTIONS.md` §Auditoría tiene la subsección «Lectura» y el checklist §15 su línea.
- [ ] DEUDA-045 está ✅ con la corrección del caso «usuario purgado», y el mapa tiene `F59 → 045`.

**Cierre:**

- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí: resolver en la lectura.** Lo guardado sigue siendo el `userId`: estable, sin PII y válido para todas las filas ya escritas. El email se deriva al responder.
- **No: guardar el email al escribir.** Dejaría PII sin cifrar para siempre en un JSONB acumulativo de todas las tablas, supone unos 146 puntos de escritura y no arregla nada de lo ya escrito. Guardarlo cifrado obligaría igualmente a descifrar al leer, así que no ahorra nada.
- **Sí: sustituir `user` en lugar de añadir un `userEmail` al lado.** El objetivo de DEUDA-045 es que la respuesta no exponga el UUID. Añadir un campo mantendría la exposición.
- **Sí: email visible para todos los roles con acceso al endpoint.** Es decisión expresa del producto: el consumidor necesita saber quién hizo cada cambio en cualquier pantalla. Queda anotado que **amplía la exposición de PII**: hoy un USER no puede leer el email de otro usuario, porque `/api/users` es ADMIN. Ver §7.
- **No: ocultar el autor a USER.** Obligaría a pasar `authUser` al servicio común y bifurcaría el contrato por rol, con dos formas de la misma respuesta.
- **Sí: `null` para lo no resoluble.** No expone nada, no añade claves i18n y deja al cliente decidir cómo pintarlo. Un literal traducido («Sistema») afirmaría un origen que el dato no garantiza, y devolver `'undefined'` es ruido.
- **Sí: reconocer por el nombre de la clave `appDetails`, no por la forma de la entrada.** Evita reescribir otro JSONB que coincida por casualidad, que era la objeción al middleware.
- **No: middleware sobre `res.json`.** Descartado en DEUDA-045 y se mantiene: sería la única pieza que transforma respuestas sin que el servicio lo declare, y no puede hacer una consulta por respuesta sin saltarse la separación controlador/servicio.
- **No: interruptor por variable de entorno.** DEUDA-045 lo mencionaba como ventaja. Un interruptor que reactiva la exposición del UUID es un camino de regresión, no una salvaguarda. La vuelta atrás es revertir el commit.
- **Sí: servicio común en `services/common/` y funciones puras en `helpers/`.** Separa lo que accede a la base, que es regla del repositorio, de lo que se prueba sin ella. DEUDA-045 lo llamaba `resolveAppDetailsAuthors` en `helpers/`; el sufijo `Service` y la ubicación siguen la convención de `setEntityActiveStatusService`.
- **Sí: resolver después del `commit`.** Una transacción de escritura no debe alargarse por una lectura de presentación, y un fallo al resolver no debe revertir una escritura ya válida.
- **No: cachear emails entre peticiones.** Con una consulta por PK por respuesta, una caché añade invalidación, que haría falta cuando cambia un email, a cambio de un milisegundo.
- **No: normalizar `'unknown'` a `'undefined'` aquí.** No cambia el resultado, que es `null` en los dos casos, y es una corrección de escritura.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Exposición de PII ampliada:** un USER pasa a leer emails de otros usuarios, que hoy solo ve ADMIN | Decisión expresa (§6). Queda escrita en `CONVENTIONS.md` §Auditoría para que una revisión de seguridad la encuentre como decisión y no como fuga. Si se revierte, basta con dar un parámetro de rol al servicio común |
| Un `'undefined'` llega al `IN` y la consulta falla con `22P02`: 500 en cualquier registro creado sin `authUser` | Regla 3 de §3.3, un caso unitario y un caso de contrato con la entrada insertada por SQL |
| Un servicio nuevo, o uno olvidado, devuelve `appDetails` sin resolver y vuelve a exponer UUID | Línea en el checklist §15 y barrido anti-UUID del paso 11. El barrido es por muestreo, no exhaustivo: una ruta no muestreada puede escaparse. Queda anotado |
| `toPlainResponse` cambia lo que un controlador recibe: de instancia a objeto plano | Los controladores solo pasan `data` a `res.json` y ningún servicio reutiliza la salida de otro (paso 5). Si algún controlador llama a un método de instancia, el `build` o su suite de contrato lo detectan en el paso de su familia |
| Una fila con `email` escrito con otra clave o sin cifrar hace fallar `esaviDecrypt` y rompe la respuesta de cualquier entidad donde ese usuario sea autor | Antes de cerrar el paso 6, comprobar sobre la base de desarrollo que todos los `appUser.email` descifran. Si alguno no descifra, se abre deuda; el servicio común no traga el error en silencio |
| El recorrido recursivo encuentra un `appDetails` dentro de un JSONB de datos (`metadata`, `settings`) que no es auditoría | Ninguna columna JSONB del esquema usa esa clave. Si aparece, el efecto es reescribir un `user` a email o `null`, visible en la suite de esa entidad |
| Respuestas grandes (listado de 100 filas con includes y historiales largos) pagan un recorrido extra | Es lineal sobre lo que `res.json` recorre de todos modos. Si hiciera falta, el listado puede excluir `appDetails` como ya hace `toUserListRow`, pero eso es otra decisión |

---

## 8. Impacto en el contrato HTTP

| Respuesta | Antes | Después |
|---|---|---|
| `appDetails[].user` con autor existente | `"3f0c…-…"` (UUID) | `"ana@minsa.gob.ec"` |
| `appDetails[].user` escrito sin `authUser` | `"undefined"` / `"unknown"` | `null` |
| `appDetails[].user` de un usuario con `email` nulo | UUID | `null` |
| Status codes | — | sin cambios |
| Forma de `data`, orden y longitud de `appDetails` | — | sin cambios |
| `createdAt`, `method`, `detail` | — | sin cambios |

**Un cliente que use `appDetails[].user` para llamar a `/api/users/:id` deja de poder hacerlo.** No hay ninguno conocido, y ese uso es justo lo que DEUDA-045 señala como innecesario. El tipo del campo pasa de `string` a `string | null`, y el frontend debe contemplar el `null`.

---

## Lo que **no** está en este spec

- Cambiar lo que se guarda en `appDetails` o migrar filas existentes.
- Unificar el literal `'unknown'` de `catalogType.service.ts:57` con `'undefined'`.
- Restringir por rol la visibilidad del email del autor.
- Exponer o resolver `sysDetails.auditTrail`.
- Excluir `appDetails` de listados donde hoy viaja.
- Una capa de serialización general de respuestas.

Cada uno de esos, si aterriza, va en su propio spec.
