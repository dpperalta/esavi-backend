# SPEC F63 — Purga de sesiones con ventana de retención

> **Estado:** Aprobado
> **Depende de:** SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F12 (update diferencial), SPEC F42 (`appSession`, `ESAVI-SESSION-001`/`006`/`007`), SPEC F43 (`appConfig.helper.ts`, precedencia `systemConfig` → `.env`)
> **Fecha:** 2026-09-30
> **Objetivo:** Borrar físicamente, en cada login, las sesiones del usuario revocadas o caducadas hace más de `ESAVI_SESSION_RETENTION_DAYS` días.

> **Nota de implementación (2026-09-30).** Por decisión del usuario durante la implementación, este
> spec **no añade comentarios al código**: todo lo que el cuerpo describe como «comentario» vive
> aquí. En concreto:
>
> - **§3.1 — DDL.** `appSession` sale del array de `preventPhysicalDelete` sin comentario junto al
>   bucle. La instrucción para las bases desplegadas antes de este spec es esta:
>   `DROP TRIGGER IF EXISTS "TRG_appSession_preventPhysicalDelete" ON "appSession";`
>   El bucle solo crea triggers, así que sin ese paso manual el trigger antiguo sigue en su sitio.
> - **§3.8 — `appConfig.helper.ts`.** No se toca el comentario de alcance. Queda obsoleto: su
>   «los ocho códigos de SPEC F43» pasa a incluir también `ESAVI_SESSION_RETENTION_DAYS`
>   (scope `AUTH`), que este spec resuelve con el mismo helper.
> - **§3.5 — `appSession.service.ts`.** `008` lleva únicamente la cabecera obligatoria
>   `// ESAVI-SESSION-008 - Purge Expired User Sessions Service`, sin JSDoc. El bloque inicial del
>   archivo sigue hablando de «las tres operaciones»: ahora son cuatro, y las cuatro siguen sin ruta
>   ni controlador. El fail-safe (§3.5 paso 2) registra con nivel `warn` y devuelve `0`; el
>   `AppError` `SESSION_008_PURGE_FAILED` lleva un mensaje técnico, no una clave i18n.

---

## 1. Por qué existe este spec

**A — `appSession` crece sin límite.** `ESAVI-SESSION-001` (`src/services/appSession.service.ts:44`)
inserta una fila en cada login. `ESAVI-AUTH-002` rota el refresh token sobre esa misma fila, y
`006`/`007` solo la marcan con `revokedAt`. Ninguna operación borra nunca una fila. El
[SPEC F42](./42-auth-refresh-token.md) lo dejó fuera a propósito (§2, §6) y lo registró como riesgo
asumido en §7: *«La purga se aborda cuando el volumen lo justifique»*.

**B — Las filas caducadas guardan datos que ya no sirven.** Cada fila conserva `ipAddress`,
`userAgent` y el hash de un refresh token que ya no vale. Pasada una ventana razonable de
auditoría, guardarlos no aporta nada y amplía lo que expone un volcado de la tabla.

**C — La base impide el borrado.** `appSession` está dentro del bucle `preventPhysicalDelete` de
`esaviapp.sql:1539-1547`. Con el trigger instalado, cualquier `DELETE` falla con
*«Physical delete is not allowed for table appSession»*. Una purga exige sacar la tabla de ese
bucle.

---

## 2. Alcance

**Dentro:**

- Nueva operación interna `ESAVI-SESSION-008`, que purga las sesiones antiguas de un usuario. No
  tiene ruta ni controlador.
- Llamada best-effort a `008` desde `ESAVI-AUTH-001` (login), después de abrir la sesión nueva.
- Nuevo parámetro `ESAVI_SESSION_RETENTION_DAYS` (scope `AUTH`, 90 días, editable), sembrado en el
  catálogo de `systemConfig` y con fallback `.env`.
- Sacar `appSession` del bucle `preventPhysicalDelete` de `esaviapp.sql`, con la instrucción para
  las bases ya desplegadas.
- Declarar en `references/CONVENTIONS.md` que `appSession` sale de la lista protegida **sin** ganar
  `005C`, y registrar el `008` en la tabla de operaciones no canónicas.
- Actualizar las referencias del SPEC F42 (§2, §6, §7 y la sección final) para que apunten a este spec.

**Fuera de alcance (otros specs):**

- **Purga global** (todos los usuarios) mediante endpoint SUPERADMIN o tarea programada. Los usuarios
  que no vuelven a iniciar sesión conservan sus filas antiguas hasta que exista.
- **Purga de `appPasswordReset`.** Tiene el mismo problema de crecimiento y su propia semántica de
  auditoría.
- **Borrar en el logout.** Se descartó (ver §6).
- **Exponer `005C` sobre `appSession`.** Ningún cliente HTTP puede borrar sesiones.
- Introducir un sistema de migraciones en el repositorio.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`appSession` — `esaviapp.sql:349-368`. **No cambia ninguna columna ni índice.** Las columnas que usa
el filtro de la purga son:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `userId` | `uuid` | no | FK a `appUser`, `ON DELETE RESTRICT` (restringe borrar el usuario, no la sesión) |
| `expiresAt` | `timestamptz` | sí | `001` siempre la escribe; el DDL la admite nula |
| `revokedAt` | `timestamptz` | sí | la escriben `006` y `007` |

El filtro se apoya en `IX_appSession_userId`. `appSession` no tiene `isActive`, una anomalía ya
registrada en el SPEC F42 que aquí no cambia.

**Cambio en el DDL — `esaviapp.sql:1539-1547`:**

| | Array del bucle `preventPhysicalDelete` |
|---|---|
| Antes | `…, 'appRolePermission', 'appSession', 'systemConfig', …` |
| Después | `…, 'appRolePermission', 'systemConfig', …` |

Junto al bucle se añade un comentario que explica la ausencia y cita este spec. Como el bucle solo
crea triggers, las bases ya desplegadas conservan el suyo y necesitan este paso manual, que se
documenta en el mismo comentario:

```sql
DROP TRIGGER IF EXISTS "TRG_appSession_preventPhysicalDelete" ON "appSession";
```

### 3.2 Modelo Sequelize

Sin cambios. `AppSession` no es `paranoid`, así que `AppSession.destroy({ where })` emite un
`DELETE` físico.

### 3.3 Tipos

No hay tipos nuevos. La firma del servicio usa primitivos.

### 3.4 Superficie HTTP

Ninguna. `008` sigue el precedente de `001`, `006` y `007`: es un servicio interno que no tiene ruta,
controlador, validador ni fila en `ROUTE_RULES`.

```
(sin ruta)   ESAVI-SESSION-008   —   (nuevo)   lo invoca ESAVI-AUTH-001
```

Toma el número `008` por la misma razón que `006` y `007` (`CONVENTIONS.md`, nota bajo la tabla de
operaciones no canónicas): purgar no es ninguna de las siete operaciones canónicas. Tampoco es un
`005C`, porque no lo pide un cliente sobre una fila concreta y lo decide una regla de retención.

### 3.5 Reglas de negocio por operación

**`ESAVI-SESSION-008` — purgar las sesiones antiguas de un usuario.**
`purgeExpiredUserSessionsService( userId: string, lang: string ): Promise<number>` en
`src/services/appSession.service.ts`. Devuelve el número de filas borradas.

1. **Retención.** Se lee con `getAppConfigNumber( SESSION_RETENTION_DAYS_CODE, SESSION_CONFIG_SCOPE, lang )`
   (`src/helpers/appConfig.helper.ts:98`), con la precedencia `systemConfig` → `.env` del SPEC F43.
2. **Fail-safe.** Si la lectura lanza (clave ausente o valor no numérico), o si el valor no es un
   entero `>= 1`, **no se borra nada**. Se escribe un `esaviLog` de nivel `warn` con el código
   `ESAVI-SESSION-008` y se devuelve `0`. Sin una retención válida la purga nunca borra.
3. **Corte.** `cutoff = now - retentionDays * 24h`.
4. **Borrado.** `AppSession.destroy` con este filtro:
   `userId = :userId AND ( revokedAt < :cutoff OR expiresAt < :cutoff )`.
   - Una fila revocada se borra cuando han pasado `N` días desde su revocación, sea cual sea el motivo
     (incluido `REUSE_DETECTED`).
   - Una fila nunca revocada se borra cuando han pasado `N` días desde que caducó. Es el caso
     habitual: quien cierra la pestaña sin hacer logout.
   - Una fila con `expiresAt` nulo y sin revocar no se toca nunca.
   - Una sesión viva (`revokedAt` nulo y `expiresAt` futura) no cumple ninguna de las dos ramas.
5. **Traza.** Si se borró al menos una fila, se escribe un `esaviLog` de nivel `info` con
   `ESAVI-SESSION-008`, el `userId` y el número de filas. No hay entrada en `appDetails` porque la
   fila deja de existir.
6. **Error.** Un fallo del `DELETE` se registra con nivel `error` y se relanza como
   `AppError(…, 500, 'SESSION_008_PURGE_FAILED', error)`. El mensaje es técnico y no es una clave
   i18n, porque nunca llega a un cliente (precedente: `MISSING_CONFIG_CODE` en `appConfig.helper.ts`).

**`ESAVI-AUTH-001` — login (cambio).** Tras `createAppSessionService` se llama a `008` con el
`userId` del usuario autenticado, dentro de un `try/catch` que **solo registra** el error. La purga:

- no forma parte de ninguna transacción;
- no cambia el status, el `message` ni el `data` del login;
- nunca hace fallar un login, aunque falle la lectura de la configuración o el `DELETE`;
- corre **después** de crear la sesión nueva, que por construcción está viva y no cumple el filtro.

#### Update diferencial

**Este spec no escribe sobre ninguna fila existente**, así que no declara tabla de `candidates`.
`008` es un **borrado físico con intención propia**: registra el hecho de que expiró la retención,
no un cambio de campos, y después de él no queda fila que auditar. Por eso no pasa por
`buildDifferentialUpdate`, en línea con CONVENTIONS §11 y con la nota de §3.5 del SPEC F42 sobre
`006`/`007`.

### 3.6 Claves i18n nuevas

Ninguna. `008` no produce mensajes para el usuario.

### 3.7 Forma de la respuesta

Sin cambios. El login responde exactamente lo mismo que hoy.

### 3.8 Configuración nueva

Nueva entrada en `src/data/systemConfig.defaults.ts`, en el bloque `AUTH` y junto a
`ESAVI_PASSWORD_RESET_EXPIRES_MINUTES`:

| Campo | Valor |
|---|---|
| `code` | `ESAVI_SESSION_RETENTION_DAYS` |
| `name` | `Retención de sesiones cerradas` |
| `description` | Días que se conserva una sesión revocada o caducada antes de que el login de su usuario la borre. Es la ventana de auditoría de los cierres de sesión, incluida la detección de reutilización. Un valor menor que 1 desactiva la purga. |
| `value` | `90` |
| `valueType` | `number` |
| `scope` | `AUTH` |
| `isEncrypted` | `false` |
| `isEditable` | `true` |

- **Constantes.** `SESSION_RETENTION_DAYS_CODE = 'ESAVI_SESSION_RETENTION_DAYS'` y
  `SESSION_CONFIG_SCOPE = 'AUTH'` van en `src/constants/session.constants.ts`, con el mismo patrón
  que `passwordReset.constants.ts`.
- **Fallback.** `.env.example` documenta `ESAVI_SESSION_RETENTION_DAYS=90`.
- **Instalaciones existentes.** La fila aparece al ejecutar `POST /api/system-configs/sync`
  (`ESAVI-SYSCONF-008`, que solo inserta). Hasta entonces se usa el fallback de `.env` y, si
  tampoco existe, el fail-safe de §3.5 paso 2.
- **Comentario de alcance.** En `appConfig.helper.ts` deja de decir «los ocho códigos de SPEC F43»
  y pasa a incluir este.

---

## 4. Plan de implementación

1. **DDL y norma.** Se saca `'appSession'` del array de `esaviapp.sql:1539-1547` y se añade el
   comentario con el `DROP TRIGGER` de §3.1. En `references/CONVENTIONS.md` se quita `appSession`
   de la lista «Protegidas» y se añade una nota de excepción: sale de la lista pero no expone
   `005C`, y solo la borra `ESAVI-SESSION-008`. En la misma norma se añade la fila `appSession | 008`
   a la tabla de operaciones no canónicas. Se actualizan las referencias del SPEC F42.
   *Verificación:* `npm test` pasa (la BD de tests se recrea desde `esaviapp.sql`). En psql,
   `SELECT tgname FROM pg_trigger WHERE tgrelid = '"appSession"'::regclass` no devuelve
   `TRG_appSession_preventPhysicalDelete`.

2. **Configuración.** Se añaden las constantes a `session.constants.ts`, la entrada a
   `systemConfig.defaults.ts` y la variable a `.env.example`, y se actualiza el comentario de alcance
   de `appConfig.helper.ts`.
   *Verificación:* `npm run build` compila. En desarrollo, `POST /api/system-configs/sync` crea la
   fila `ESAVI_SESSION_RETENTION_DAYS` con valor 90.

3. **`ESAVI-SESSION-008`.** Se implementa `purgeExpiredUserSessionsService` en
   `appSession.service.ts` con la cabecera de código de operación y se exporta.
   *Verificación:* `npm run build && npm run lint` salen en 0.

4. **Enganche en `ESAVI-AUTH-001`.** Llamada best-effort en `loginService`
   (`src/services/auth.service.ts:70`), después de `createAppSessionService`.
   *Verificación:* un login en desarrollo responde igual que antes, y `src/logs/esaviLog.log` muestra
   `ESAVI-SESSION-008` cuando hay filas antiguas.

5. **Pruebas.** Se añade un bloque de purga en `tests/contract/auth.test.ts` que siembra filas con
   `AppSession.create` y fechas manipuladas y cubre los criterios de §5.
   *Verificación:* `npm test` pasa.

---

## 5. Criterios de aceptación

- [ ] `grep -n "'appSession'" esaviapp.sql` no encuentra la tabla dentro del bucle
      `preventPhysicalDelete`.
- [ ] Tras un login, se borran las filas del usuario revocadas hace más de 90 días.
- [ ] Tras un login, se borran las filas del usuario no revocadas cuyo `expiresAt` pasó hace más de
      90 días.
- [ ] Tras un login, se conservan las filas del usuario revocadas o caducadas hace menos de 90 días.
- [ ] Tras un login, se conservan las sesiones vivas del usuario, incluida la recién creada.
- [ ] Tras un login, se conservan todas las filas de **otro** usuario, aunque sean antiguas.
- [ ] Una fila con `expiresAt` nulo y sin revocar no se borra nunca.
- [ ] Sin fila en `systemConfig` y sin variable de entorno, el login responde 200 y no se borra
      nada.
- [ ] Con retención `0` o no numérica, el login responde 200 y no se borra nada.
- [ ] Si `008` lanza, el login sigue respondiendo 200 con el mismo `data`.
- [ ] El código `ESAVI-SESSION-008` coincide en la cabecera del servicio, en los `esaviLog` y en el
      `AppError` (`SESSION_008_PURGE_FAILED`).
- [ ] `ESAVI_SESSION_RETENTION_DAYS` está en `systemConfig.defaults.ts` y en `.env.example`.
- [ ] `ROUTE_RULES` no cambia y no aparece ninguna ruta nueva.
- [ ] Un refresh con el token de una sesión purgada responde 401 `AUTH_002_INVALID_REFRESH_TOKEN`.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** purgar por usuario en el login. Es una operación acotada (las filas de una persona,
  filtradas por índice) que ocurre justo cuando el usuario añade una fila nueva. No necesita
  scheduler ni dependencias, y la tabla crece y se poda al mismo ritmo.
- **No:** borrar las sesiones inactivas en el logout. Destruye al instante la evidencia de
  `REUSE_DETECTED`, no limpia a quien nunca hace logout (lo normal es cerrar la pestaña) y, si
  abarcara a todos los usuarios, metería un borrado masivo en una petición interactiva.
- **No:** tarea programada con `node-cron`. Añade una dependencia y, con varias instancias del API,
  todas ejecutarían el mismo job. Se reserva para la purga global cuando haga falta.
- **Sí:** ventana de retención y no borrado inmediato. Las revocaciones son traza de seguridad, y
  90 días cubren una investigación de acceso indebido.
- **Sí:** retención en `systemConfig`, editable. La ventana razonable depende del despliegue, y
  existe el precedente de `ESAVI_PASSWORD_RESET_EXPIRES_MINUTES`.
- **Sí:** fail-safe que no borra si la retención no es válida. Ante la duda se conserva: un borrado
  es irreversible y una fila de más no rompe nada.
- **Sí:** sacar `appSession` de `preventPhysicalDelete`. La protección está pensada para tablas
  maestras y de dominio; una sesión caducada es un dato operativo con vida finita.
- **No:** una excepción dentro del trigger que acepte solo el `DELETE` de filas revocadas o
  caducadas. Mete una regla de negocio en SQL, y la ventana de retención (que vive en
  `systemConfig`) no llegaría al trigger.
- **No:** purga lógica con `deletedAt` y columnas vaciadas. Minimiza datos, pero la tabla sigue
  creciendo, que es el problema de origen.
- **No:** exponer `005C`. Salir de la lista protegida no obliga a ofrecer el endpoint. La regla de
  disponibilidad de CONVENTIONS se matiza con una excepción declarada, no se aplica a ciegas.
- **Sí:** borrar filas revocadas no debilita la detección de reutilización.
  `resolveRefreshTokenSession` (`src/services/auth.service.ts:133`) solo la dispara con
  `revokedAt IS NULL`, y la purga solo borra filas revocadas o caducadas desde hace `N` días. El
  único efecto es un cambio de `code` en un caso marginal, descrito en §8.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Una base ya desplegada conserva el trigger y cada login registra un error de `008` | El login no falla (best-effort) y el `esaviLog` de nivel `error` muestra el mensaje del trigger. El comentario del DDL y este spec documentan el `DROP TRIGGER` que hay que ejecutar |
| Un SUPERADMIN pone una retención de 1 día y borra traza de seguridad reciente | `isEditable` ya exige SUPERADMIN, y el cambio queda en `systemConfigHistory`. El mínimo es 1 porque cualquier suelo mayor sería arbitrario |
| Los usuarios que no vuelven a iniciar sesión conservan sus filas indefinidamente | Queda aceptado. Es un volumen acotado por el número de usuarios, y la purga global queda fuera de alcance (§2) |
| El `DELETE` añade latencia al login | Una sola sentencia filtrada por `IX_appSession_userId` sobre las filas de un usuario. En régimen estable, cada login borra como mucho unas pocas filas |

---

## 8. Impacto en el contrato HTTP

Ninguna respuesta cambia de status. Solo cambia el `code` de un caso marginal. Un refresh token
cuya sesión ya se purgó (revocada o caducada hace más de `N` días) sigue recibiendo 401, pero el
código pasa de `AUTH_002_SESSION_REVOKED` o `AUTH_002_SESSION_EXPIRED` a
`AUTH_002_INVALID_REFRESH_TOKEN` (`src/services/auth.service.ts:148-150`). En el logout
(`ESAVI-AUTH-003`) el mismo token pasa de 200 idempotente a 401 `AUTH_003_INVALID_REFRESH_TOKEN`.
En ambos casos el cliente tiene que volver a iniciar sesión, que es lo mismo que ya tenía que hacer.

---

## Lo que **no** está en este spec

- Purga global de `appSession` mediante endpoint SUPERADMIN o tarea programada.
- Purga de `appPasswordReset`.
- Borrado de sesiones en el logout.
- `005C` o cualquier otra superficie HTTP sobre `appSession`.
- Un sistema de migraciones para el DDL.

Cada uno de esos, si aterriza, va en su propio spec.
