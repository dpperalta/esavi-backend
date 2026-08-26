# SPEC F42 — Sesiones persistidas y renovación de token

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F04 (`appUser`, `ESAVI-USER-006`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-26
> **Objetivo:** Persistir cada inicio de sesión en `appSession` y emitir un par access/refresh que permita renovar el token sin volver a pedir credenciales, con revocación real.

---

## 1. Por qué existe este spec

**A — Un token emitido hoy no se puede revocar.** `loginService` (`src/services/auth.service.ts:48-50`)
firma un JWT con `jwtGenerate` y no deja rastro de él en ninguna parte. `tokenValidation`
(`src/middlewares/tokenValidation.middleware.ts`) lo verifica contra `JWT_SECRET` y vuelve a
consultar el usuario, pero no tiene ninguna tabla contra la que preguntar si ese token concreto
sigue siendo válido. Mientras la firma no expire, el token vale.

**B — Cambiar la contraseña no cierra nada.** `src/services/user.service.ts:424` lo dice
literalmente en un comentario: *«The token in flight is NOT invalidated — there is no appSession
table to revoke it in»*. El [SPEC F04](./04-appuser-crud.md) lo registró en su tabla de riesgos
(§7) como **el** riesgo de seguridad conocido del MVP, y nombró este spec como su mitigación:
quien roba un token sigue operando hasta 8 horas después aunque la víctima cambie la contraseña.

**C — La sesión no se puede prolongar con el uso.** `JWT_EXPIRES_IN=8h` es un plazo duro contado
desde el login. A las ocho horas el usuario vuelve a la pantalla de credenciales aunque lleve
toda la jornada trabajando en la aplicación. No hay forma de renovar sin reautenticar, porque
no existe una segunda credencial de vida más larga.

**D — La tabla lleva esperando desde el principio.** `appSession` (`esaviapp.sql:337-357`) está
en el DDL con `refreshTokenHash`, `expiresAt`, `revokedAt` y `revokedReason`, más un índice
parcial `IX_appSession_active` sobre `("userId","expiresAt") WHERE "revokedAt" IS NULL AND
"deletedAt" IS NULL` que solo tiene sentido si alguien consulta sesiones vigentes. El esquema
anticipó este mecanismo; la aplicación nunca lo escribió.

Este spec cierra los cuatro: persiste la sesión, emite un refresh token rotatorio, permite
revocar —una sesión, todas, o todas por cambio de contraseña— y hace que la sesión se prolongue
con el uso sin renunciar a un tope absoluto.

---

## 2. Alcance

**Dentro:**

- Modelo Sequelize de `appSession` (`src/models/appSession.model.ts`) y sus asociaciones con
  `appUser`, en `src/models/associations/appSession.associations.ts`.
- `ESAVI-AUTH-001` — el login pasa a abrir una fila en `appSession` y a devolver `refreshToken`
  y `expiresAt` junto al `token` ya existente. Cambio **aditivo** del contrato.
- `ESAVI-AUTH-002` — `POST /api/auth/refresh`. Sin `tokenValidation`: la credencial es el propio
  refresh token, y el access token normalmente llega expirado.
- `ESAVI-AUTH-003` — `POST /api/auth/logout`. Revoca la sesión del refresh token recibido.
  Sin `tokenValidation`, por la misma razón.
- `ESAVI-AUTH-004` — `POST /api/auth/logout-all`. Revoca todas las sesiones vigentes del usuario
  del token. **Con** `tokenValidation`: necesita identidad probada.
- `ESAVI-SESSION-001`, `-006` y `-007` — servicios internos sin ruta HTTP: abrir sesión, revocar
  una sesión, revocar todas las de un usuario.
- **Rotación con detección de reutilización.** Cada `refresh` invalida el token consumido y emite
  uno nuevo. Un refresh token ya usado revoca **todas** las sesiones del usuario con
  `revokedReason: 'REUSE_DETECTED'`.
- **Sesión deslizante con tope absoluto.** Cada `refresh` empuja `expiresAt`, nunca más allá de
  `startedAt + REFRESH_ABSOLUTE_MAX_IN`.
- **Propagación a `ESAVI-USER-006`.** Cambiar la contraseña revoca todas las sesiones del usuario
  con `revokedReason: 'PASSWORD_CHANGED'`, cerrando el riesgo declarado en el SPEC F04 §7.
- Tres variables de entorno: `JWT_EXPIRES_IN` baja a `1h`, y se añaden
  `REFRESH_TOKEN_EXPIRES_IN=8h` y `REFRESH_ABSOLUTE_MAX_IN=30d`.
- Claves i18n nuevas en `es.json`, `en.json` y `nl.json`.
- Suite `tests/contract/auth.test.ts` con el recorrido login → refresh → logout, la detección de
  reutilización y el tope absoluto.

**Fuera de alcance (otros specs):**

- **CRUD de sesiones.** `GET /api/sessions` para que un usuario vea sus sesiones abiertas, o un
  SUPERADMIN las de otro, y revocar una concreta por `sessionId` desde HTTP. `appSession` no
  recibe superficie CRUD en este spec.
- **Refresh token en cookie `httpOnly`.** Viaja en el body JSON. Mover a cookie implica
  `cookie-parser`, CORS con credenciales y acoplar la API al dominio del frontend.
- **Validación de `ipAddress` y `userAgent`.** Se registran en el login como traza y no se
  comparan en el `refresh`.
- **Límite de sesiones concurrentes.** Ilimitadas. No hay `MAX_SESSIONS`.
- **Purga de sesiones caducadas.** Las filas expiradas o revocadas se quedan en la tabla. El
  trabajo programado de limpieza no existe y no se crea aquí.
- **Rate limiting sobre `/api/auth/refresh` y `/api/auth/login`.** No hay infraestructura de
  limitación en el repositorio; introducirla es transversal.
- **`appPermission` y `appRolePermission`.** Siguen sin modelo. La autorización continúa siendo
  por nivel de rol.
- **Borrado físico (`005C`) y activación (`005A`/`005B`) de `appSession`.** La tabla no tiene
  `isActive` y está en la lista de protegidas de `CONVENTIONS.md:270`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`appSession` — `esaviapp.sql:337-357`. Existe en el DDL desde el inicio y nunca tuvo modelo.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `sessionId` | `uuid` | no | PK, `gen_random_uuid()` |
| `userId` | `uuid` | no | FK `FK_appSession_user` → `appUser("userId")`, `ON UPDATE CASCADE ON DELETE RESTRICT` |
| `refreshTokenHash` | `text` | sí | SHA-256 en hexadecimal del secreto. Nunca el token en claro |
| `ipAddress` | `inet` | sí | Solo traza. No se valida |
| `userAgent` | `text` | sí | Solo traza. No se valida |
| `startedAt` | `timestamptz` | no | `current_timestamp`. Ancla del tope absoluto; **no se mueve nunca** |
| `expiresAt` | `timestamptz` | sí | Vencimiento del refresh token. Se desplaza en cada renovación |
| `revokedAt` | `timestamptz` | sí | Marca de revocación. `NULL` significa vigente |
| `revokedReason` | `text` | sí | `LOGOUT`, `LOGOUT_ALL`, `REUSE_DETECTED`, `PASSWORD_CHANGED` |

Restricciones e índices declarados:

- `CONSTRAINT "CK_appSession_dates" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startedAt")`
- `IX_appSession_userId` sobre `("userId")`
- `IX_appSession_active` sobre `("userId", "expiresAt") WHERE "revokedAt" IS NULL AND "deletedAt" IS NULL`

Columnas transversales: lleva `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` (JSONB) y
`appDetails` (JSONB).

**Anomalía declarada: `appSession` no tiene `isActive`.** Es la única tabla del bloque de auth
sin ella. Su ciclo de vida se expresa con `revokedAt`, y por eso esta entidad **no tiene
`005A` ni `005B`**, no usa `setEntityActiveStatusService` y no admite el patrón de listado dual
`002A`/`002B`. No es un olvido del DDL: una sesión no se "reactiva", se abre una nueva.

**El tope absoluto vive en la aplicación, no en el SQL.** No hay columna `absoluteExpiresAt`.
El techo se calcula como `startedAt + REFRESH_ABSOLUTE_MAX_IN` en cada renovación. Por eso
`startedAt` es inmutable: es el ancla del cálculo.

### 3.2 Modelo Sequelize

`src/models/appSession.model.ts`, clase `AppSession`, con las decisiones de siempre:
`timestamps: false`, `freezeTableName: true`, `tableName: 'appSession'`, PK UUID con
`defaultValue: sequelize.literal('gen_random_uuid()')`. Alta en el barrel `src/models/index.ts`.

`ipAddress` se declara `DataTypes.STRING` — Sequelize no tipa `inet`, y Postgres acepta el texto
sin conversión explícita. `refreshTokenHash`, `userAgent` y `revokedReason` van como `DataTypes.TEXT`.

`appDetails` se define `DataTypes.JSONB` y se maneja **como array**, igual que en todas las
entidades: `[...currentAppDetails, newEntry]`. El `DEFAULT '{}'` del DDL es el mismo que llevan
las otras 44 tablas.

Asociaciones, en `src/models/associations/appSession.associations.ts` —nunca dentro del modelo—
y registradas en `initModels()`:

- `AppSession.belongsTo(AppUser, { foreignKey: 'userId', as: 'user' })`
- `AppUser.hasMany(AppSession, { foreignKey: 'userId', as: 'sessions' })`

### 3.3 Tipos

`src/types/session/appSession.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.
El dominio es nuevo: hoy no existe `src/types/auth/` ni `src/types/session/`.

```ts
export interface CreateAppSessionInput {
    userId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
}

export interface RefreshTokenInput {
    refreshToken: string;
}

export interface SessionTokenPair {
    token: string;           // access token JWT
    refreshToken: string;    // `<sessionId>.<secreto>`
    expiresAt: Date;         // vencimiento del refresh token
}
```

No se declara `UpdateAppSessionInput`: está prohibido por §4 de las convenciones, y además
ninguna escritura de esta entidad es un update diferencial (ver 3.5).

`LoginOutput` en `src/types/session/` extiende lo que hoy devuelve `loginService` con
`refreshToken` y `expiresAt`.

**Formato del refresh token.** Cadena `<sessionId>.<secreto>`, donde `sessionId` es el UUID de
la fila y `secreto` son 32 bytes aleatorios en `base64url` (43 caracteres). Se busca la fila por
`sessionId` —lookup por clave primaria— y se compara `sha256(secreto)` contra `refreshTokenHash`
con `crypto.timingSafeEqual`. El token en claro no se guarda ni se registra en los logs.

### 3.4 Superficie HTTP

```
POST   /api/auth/login          ESAVI-AUTH-001   público      (existe, cambia su respuesta)
POST   /api/auth/refresh        ESAVI-AUTH-002   público      (nuevo)
POST   /api/auth/logout         ESAVI-AUTH-003   público      (nuevo)
POST   /api/auth/logout-all     ESAVI-AUTH-004   USER         (nuevo)
```

**"Público" no significa sin credencial.** `002` y `003` no llevan `tokenValidation` porque el
access token llega expirado justo cuando más se necesitan; la credencial que presentan es el
refresh token del body, y el servicio la verifica contra `appSession`. `004` sí lleva
`tokenValidation` y `validateUserRole(ROLES.USER)`: revocar todas las sesiones exige identidad
probada, y el `userId` sale de `req.user`, nunca del body.

**Nota de orden de declaración: no aplica.** Ninguna ruta de `auth.routes.ts` tiene parámetro
`:id`, así que no hay riesgo de que `/:id` capture una ruta literal. Se mantiene igualmente el
orden de declaración alfabético que ya tiene el archivo.

**Sin fila en `ROUTE_RULES`.** `tests/auth/roles.test.ts` solo enumera rutas con rol mínimo.
`ESAVI-AUTH-002` y `-003` no entran, como no entra hoy `/api/auth/login`. `ESAVI-AUTH-004` **sí**
recibe su fila con `minRole: 'USER'`. La ausencia de las dos primeras se documenta con un
comentario en el archivo, siguiendo el precedente de `ESAVI-DIAGTERM-006`
(`tests/auth/roles.test.ts:204-207`).

**Servicios internos, sin ruta HTTP:**

```
ESAVI-SESSION-001   abrir sesión — invocado por ESAVI-AUTH-001
ESAVI-SESSION-006   revocar una sesión — invocado por ESAVI-AUTH-002 y -003
ESAVI-SESSION-007   revocar todas las de un usuario — invocado por ESAVI-AUTH-004 y ESAVI-USER-006
```

Viven en `src/services/appSession.service.ts`. No tienen controlador ni ruta: son el dominio de
persistencia que `auth` y `user` invocan. `006` y `007` toman los números no canónicos porque
revocar no es ninguna de las siete operaciones del rango `001`–`005B`, y `appSession` no tiene
`isActive` con el que expresar `005A`/`005B`.

### 3.5 Reglas de negocio por operación

**`ESAVI-AUTH-001` — login (se amplía).** Conserva íntegro lo que hace hoy: normaliza el correo,
busca por `esaviCrypt(normalizedEmail)` con `isActive: true`, compara con `bcrypt.compare` y
responde 401 `AUTH_001_INVALID_CREDENTIALS` en los dos fallos, con el mismo mensaje para los dos.
Tras validar, invoca `ESAVI-SESSION-001` para abrir la sesión y devuelve `refreshToken` y
`expiresAt` junto al `token`. `ipAddress` sale de `req.ip` y `userAgent` de
`req.headers['user-agent']`, los dos truncados a lo que acepte la columna y opcionales.

**`ESAVI-SESSION-001` — abrir sesión.** Genera 32 bytes con `crypto.randomBytes`, los codifica en
`base64url` e inserta la fila con `refreshTokenHash = sha256(secreto)`,
`expiresAt = now + REFRESH_TOKEN_EXPIRES_IN` y `startedAt` por defecto de la base.
Devuelve el token compuesto `<sessionId>.<secreto>` **una sola vez**: es el único momento en que
existe en claro. Auditoría en `appDetails` con `method: 'ESAVI-SESSION-001'`.

**`ESAVI-AUTH-002` — renovar.** El orden de las comprobaciones es la regla, no un detalle:

1. Formato del token → 401 `AUTH_002_INVALID_REFRESH_TOKEN`. Un token malformado no llega a
   tocar la base.
2. Fila por `sessionId` → si no existe, 401 `AUTH_002_INVALID_REFRESH_TOKEN`. **Mismo código y
   mismo mensaje** que el formato inválido: distinguirlos revela qué `sessionId` existen.
3. `sha256(secreto)` contra `refreshTokenHash` con `timingSafeEqual`. **Si no coincide y la
   sesión estaba vigente, es reutilización**: se invoca `ESAVI-SESSION-007` sobre el `userId` de
   la fila con `revokedReason: 'REUSE_DETECTED'` y se responde 401
   `AUTH_002_REFRESH_TOKEN_REUSED`. El atacante y la víctima quedan los dos fuera.
4. `revokedAt` no nulo → 401 `AUTH_002_SESSION_REVOKED`.
5. `expiresAt` pasado → 401 `AUTH_002_SESSION_EXPIRED`.
6. Tope absoluto: si `startedAt + REFRESH_ABSOLUTE_MAX_IN` ya pasó → se revoca la sesión con
   `revokedReason: 'ABSOLUTE_MAX_REACHED'` y 401 `AUTH_002_SESSION_EXPIRED`.
7. El usuario debe seguir existiendo y activo → 401 `AUTH_002_INVALID_REFRESH_TOKEN`.

Superadas las siete, **rota**: genera un secreto nuevo, reescribe `refreshTokenHash`, desplaza
`expiresAt` a `min(now + REFRESH_TOKEN_EXPIRES_IN, startedAt + REFRESH_ABSOLUTE_MAX_IN)` y
**no toca `startedAt`**. Emite un access token nuevo con `jwtGenerate({ userId })`. Auditoría con
`method: 'ESAVI-AUTH-002'`.

**`ESAVI-AUTH-003` — cerrar sesión.** Resuelve la fila igual que el `refresh` —pasos 1 a 3— y
delega en `ESAVI-SESSION-006` con `revokedReason: 'LOGOUT'`. **Es idempotente**: cerrar una
sesión ya revocada o ya expirada responde **200**, no 401. Cerrar sesión no es una operación que
deba fallar. Un token cuyo hash no coincide sí dispara la detección de reutilización del paso 3.

**`ESAVI-AUTH-004` — cerrar todas las sesiones.** `userId` sale de `req.user`, jamás del body.
Invoca `ESAVI-SESSION-007` con `revokedReason: 'LOGOUT_ALL'`. Idempotente: sin sesiones vigentes
responde 200 con `{ revokedCount: 0 }`.

**`ESAVI-SESSION-006` / `-007` — revocar.** Escriben `revokedAt = now` y `revokedReason` sobre las
filas con `revokedAt IS NULL` y `deletedAt IS NULL`. `007` filtra además por `userId` y se apoya
en `IX_appSession_active`. Auditoría con el código correspondiente. Devuelven el número de filas
revocadas.

**`ESAVI-USER-006` — cambio de contraseña (se amplía).** Tras el `user.update` que ya existe
(`src/services/user.service.ts:451`), invoca `ESAVI-SESSION-007` sobre el propio usuario con
`revokedReason: 'PASSWORD_CHANGED'`. Las dos escrituras van **en la misma transacción**: una
contraseña cambiada con sesiones supervivientes es peor que un cambio fallido. El comentario de
`user.service.ts:424` se sustituye por la descripción del comportamiento nuevo.

#### Contrato de update diferencial

**Ninguna escritura de este spec pasa por `buildDifferentialUpdate`, y las cinco razones son
explícitas.** No hay `004` en esta superficie: `appSession` no tiene ninguna operación que reciba
un body de datos y deba dejar la fila «en este estado».

| Escritura | Por qué no es diferencial |
|---|---|
| `ESAVI-SESSION-001` — abrir sesión | Es un `001`. Los create nunca pasan por el helper |
| `ESAVI-AUTH-002` — rotar | Escritura con intención propia: registra el hecho «este refresh token se consumió». `refreshTokenHash` cambia siempre por construcción —secreto aleatorio nuevo— y `expiresAt` se desplaza aunque el resultado coincidiera con el guardado |
| `ESAVI-SESSION-006` / `-007` — revocar | Escritura con intención propia, del mismo orden que una activación `005A`: marca un hecho y su motivo. Una segunda revocación no reescribe nada porque el filtro exige `revokedAt IS NULL`, no porque un diff salga vacío |
| `ESAVI-AUTH-003` / `-004` | No escriben directamente. Delegan en `006` y `007` |

**Propagación a `appUser`: mismo criterio, declarado.** La revocación de `ESAVI-USER-006` se
dispara por **el hecho consumado del cambio de contraseña**, no por la presencia de
`newPassword` en el body: si el `user.update` no llega a ejecutarse —la contraseña actual no
coincide, el usuario no existe—, no se revoca ninguna sesión. El disparador es la escritura
efectiva, que es la traducción a este dominio de la regla del [SPEC F12](./12-differential.md).
`ESAVI-USER-006` sigue sin ser un update diferencial por su cuenta, tal como lo entregó el SPEC F04.

### 3.6 Claves i18n nuevas

En los **tres** archivos, `src/data/i18n/{es,en,nl}.json`, bajo la clave `auth` que ya existe:

| Clave | Uso |
|---|---|
| `auth.refreshSuccess` | 200 de `ESAVI-AUTH-002` |
| `auth.refreshFailed` | 500 de `ESAVI-AUTH-002` |
| `auth.invalidRefreshToken` | 401 — token malformado, inexistente o de un usuario inactivo |
| `auth.refreshTokenReused` | 401 — reutilización detectada; todas las sesiones quedan revocadas |
| `auth.sessionRevoked` | 401 — la sesión fue cerrada |
| `auth.sessionExpired` | 401 — la sesión venció o alcanzó el tope absoluto |
| `auth.logoutSuccess` | 200 de `ESAVI-AUTH-003` |
| `auth.logoutFailed` | 500 de `ESAVI-AUTH-003` |
| `auth.logoutAllSuccess` | 200 de `ESAVI-AUTH-004`, con `{{count}}` |
| `auth.logoutAllFailed` | 500 de `ESAVI-AUTH-004` |

`auth.refreshTokenReused` y `auth.sessionRevoked` llevan mensajes distintos de cara al usuario
—«su sesión se cerró por seguridad» frente a «su sesión fue cerrada»— aunque las dos sean 401.
`tests/i18n/messages.test.ts` exige paridad exacta en los tres idiomas.

### 3.7 Forma de la respuesta

**`ESAVI-AUTH-001` — login.** Lo que ya devuelve, más dos campos:

```
{ ok, message, data: {
    token, refreshToken, expiresAt,
    user: { userId, email, displayName, roles: [{ roleId, name, code }] }
} }
```

**`ESAVI-AUTH-002` — renovar.** Solo los tokens. Es una renovación, no un login: no incluye el
bloque `user` ni consulta los roles con `include`.

```
{ ok, message, data: { token, refreshToken, expiresAt } }
```

**`ESAVI-AUTH-003` — cerrar sesión.** Operación de estado; sigue la regla de §10 de las
convenciones y **no devuelve `data`**.

```
{ ok, message }
```

**`ESAVI-AUTH-004` — cerrar todas.** Devuelve el recuento porque el cliente necesita saber
cuántos dispositivos cerró:

```
{ ok, message, data: { revokedCount } }
```

**`appSession` no se expone nunca en una respuesta.** Ni `refreshTokenHash`, ni `ipAddress`, ni
`userAgent`, ni `sysDetails`, ni `appDetails`. El único dato de la fila que sale de la API es
`expiresAt`. Ver esas sesiones es el CRUD que este spec deja fuera de alcance.

---

## 4. Plan de implementación

Trece pasos. Cada uno deja el repositorio compilando y arrancable, y puede committearse solo.

1. **Configuración.** Añade `REFRESH_TOKEN_EXPIRES_IN=8h` y `REFRESH_ABSOLUTE_MAX_IN=30d` a
   `.env.example`, `.env.development`, `.env.test` y `.env.production`. Crea
   `src/constants/session.constants.ts` con los valores por defecto (`'8h'` y `'30d'`) y el
   parseo a milisegundos. **`JWT_EXPIRES_IN` se queda en `8h` por ahora**: bajarlo a `1h` antes de
   que exista el `refresh` deja a los usuarios con sesiones de una hora sin forma de renovarlas.
   Se cambia en el paso 8.
   *Verificación:* `npm run build` compila; arrancar sin las variables nuevas usa los defaults
   sin lanzar.

2. **Modelo y asociaciones.** `src/models/appSession.model.ts` con las nueve columnas de §3.1 más
   las transversales; `src/models/associations/appSession.associations.ts` con el `belongsTo` y el
   `hasMany`; alta en `src/models/index.ts` y en `initModels()`.
   *Verificación:* `AppSession.findAll({ limit: 1 })` contra la base de test no lanza; el `include`
   de `as: 'user'` resuelve.

3. **Tipos.** `src/types/session/appSession.types.ts` con `CreateAppSessionInput`,
   `RefreshTokenInput` y `SessionTokenPair`; su `index.ts`; alta en `src/types/index.ts`.
   *Verificación:* `npm run build` y `npm run lint` en 0.

4. **Claves i18n.** Las diez claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `tests/i18n/messages.test.ts` en verde.

5. **Helper del refresh token.** `src/helpers/refreshToken.helper.ts` con la generación
   (`crypto.randomBytes(32)` → `base64url`), el compuesto `<sessionId>.<secreto>`, el parseo con
   validación de formato y la comparación `sha256` + `timingSafeEqual`. Alta en el barrel
   `src/helpers/index.ts`.
   *Verificación:* un token generado se parsea y valida contra su propio hash; un token con el
   secreto alterado en un carácter no valida; un token sin punto devuelve fallo de formato en vez
   de lanzar.

6. **`ESAVI-SESSION-001` — abrir sesión.** `src/services/appSession.service.ts` con
   `createAppSessionService(userId, meta, lang, transaction?)`. Inserta la fila, calcula
   `expiresAt`, escribe la auditoría y devuelve el `SessionTokenPair`. Sin controlador ni ruta.
   *Verificación:* invocado a mano deja una fila con `refreshTokenHash` de 64 caracteres
   hexadecimales, `revokedAt` nulo y `expiresAt` a ocho horas; el token en claro no aparece en
   `src/logs/esaviLog.log`.

7. **`ESAVI-SESSION-006` y `-007` — revocar.** `revokeAppSessionService(sessionId, reason, lang,
   transaction?)` y `revokeAllUserSessionsService(userId, reason, lang, transaction?)`. Filtran por
   `revokedAt IS NULL` y `deletedAt IS NULL`, escriben `revokedAt`, `revokedReason` y la auditoría,
   y devuelven el recuento de filas afectadas.
   *Verificación:* revocar dos veces la misma sesión devuelve 1 y luego 0, sin error; `revokedAt`
   no se reescribe en la segunda llamada.

8. **`ESAVI-AUTH-001` — el login emite el par.** `loginService` invoca `ESAVI-SESSION-001` tras
   validar la contraseña y añade `refreshToken` y `expiresAt` al retorno; el controlador pasa
   `req.ip` y `req.headers['user-agent']`. **En este paso `JWT_EXPIRES_IN` baja a `1h`** en los
   cuatro `.env.*` y en `.env.example`.
   *Verificación:* un login devuelve `token`, `refreshToken` y `expiresAt`, y deja exactamente una
   fila nueva en `appSession`; dos logins seguidos del mismo usuario dejan dos filas vigentes; el
   access token decodificado expira a la hora.

9. **`ESAVI-AUTH-002` — renovar.** `refreshTokenService` con las siete comprobaciones de §3.5 en
   ese orden, la rotación y el desplazamiento de `expiresAt` acotado por el tope absoluto;
   controlador `refresh`; `refreshTokenValidator` en `src/validators/auth.validator.ts`; ruta
   `POST /refresh` sin `tokenValidation`.
   *Verificación:* un `refresh` con token válido devuelve tokens nuevos, y el refresh token
   anterior devuelve 401 `AUTH_002_REFRESH_TOKEN_REUSED` dejando todas las sesiones del usuario
   revocadas; `startedAt` de la fila no cambia entre renovaciones; un `refresh` sobre una sesión
   con `startedAt` de hace 31 días responde 401 y la deja revocada con
   `revokedReason: 'ABSOLUTE_MAX_REACHED'`.

10. **`ESAVI-AUTH-003` — cerrar sesión.** `logoutService`, controlador y ruta `POST /logout` sin
    `tokenValidation`, delegando en `ESAVI-SESSION-006`. Respuesta sin `data`.
    *Verificación:* un `logout` devuelve 200 y deja `revokedAt` con `revokedReason: 'LOGOUT'`;
    repetirlo devuelve 200 otra vez; un `refresh` posterior con ese token devuelve 401
    `AUTH_002_SESSION_REVOKED`.

11. **`ESAVI-AUTH-004` — cerrar todas.** `logoutAllService`, controlador que toma el `userId` de
    `req.user`, y ruta `POST /logout-all` con `tokenValidation, validateUserRole(ROLES.USER)`.
    Fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts` con `minRole: 'USER'`, más el
    comentario que explica por qué `002` y `003` no tienen fila.
    *Verificación:* con tres sesiones abiertas devuelve `{ revokedCount: 3 }` y la segunda llamada
    devuelve `{ revokedCount: 0 }`; `tests/auth/roles.test.ts` sigue en verde.

12. **`ESAVI-USER-006` — propagación transaccional.** `changePasswordService` abre transacción,
    ejecuta el `user.update` que ya existe e invoca `ESAVI-SESSION-007` con
    `revokedReason: 'PASSWORD_CHANGED'` dentro de ella. Sustituye el comentario de
    `src/services/user.service.ts:424`.
    *Verificación:* cambiar la contraseña deja todas las sesiones del usuario revocadas y el
    refresh token previo devuelve 401; un cambio que falla por contraseña actual incorrecta no
    revoca ninguna sesión.

13. **Suite de contrato y registro en las convenciones.** `tests/contract/auth.test.ts` con el
    recorrido login → refresh → logout, la reutilización, la revocación y el tope absoluto. Alta
    de la abreviatura `SESSION` en la tabla de `references/CONVENTIONS.md` §6 y de las tres
    operaciones no canónicas (`SESSION-001` no lo es, pero `006` y `007` sí) en la tabla de
    «Más allá de `005B`». Nota en `references/functional/specs/04-appuser-crud.md` §7 marcando el
    riesgo como resuelto por este spec.
    *Verificación:* `npm run check` en 0.

---

## 5. Criterios de aceptación

**Superficie y códigos**

- [ ] Las cuatro rutas de §3.4 responden con su estado esperado.
- [ ] Los cinco puntos del código de operación —ruta, controlador, servicio, `AppError` y
      `appDetails.method`— coinciden para `AUTH-002`, `AUTH-003`, `AUTH-004`, `SESSION-001`,
      `SESSION-006` y `SESSION-007`.
- [ ] `grep -rn "ESAVI-SESSION" src/routes/` no devuelve resultados: los tres servicios de sesión
      no tienen superficie HTTP.
- [ ] `POST /api/auth/logout-all` sin token devuelve 401, y con un token de rol inferior a USER
      devuelve 403.
- [ ] `POST /api/auth/refresh` y `POST /api/auth/logout` responden sin cabecera `Authorization`.
- [ ] `SESSION` está dada de alta en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y
      `SESSION-006` y `SESSION-007` en la tabla de operaciones no canónicas.

**Ciclo de vida de la sesión**

- [ ] Un login deja exactamente una fila en `appSession` con `revokedAt` nulo y `expiresAt` a
      `REFRESH_TOKEN_EXPIRES_IN` del momento.
- [ ] Un `refresh` con token válido devuelve un `refreshToken` **distinto** del enviado, y el
      `refreshTokenHash` de la fila cambia.
- [ ] Reenviar el refresh token ya consumido devuelve 401 `AUTH_002_REFRESH_TOKEN_REUSED` y deja
      **todas** las sesiones del usuario con `revokedReason: 'REUSE_DETECTED'`.
- [ ] `startedAt` es idéntico antes y después de tres renovaciones encadenadas. Es lo que sostiene
      el tope absoluto: si se moviera, la sesión no caducaría nunca.
- [ ] Una sesión con `startedAt` retrasado más allá de `REFRESH_ABSOLUTE_MAX_IN` responde 401
      `AUTH_002_SESSION_EXPIRED` y queda revocada con `revokedReason: 'ABSOLUTE_MAX_REACHED'`,
      aunque su `expiresAt` esté en el futuro.
- [ ] `expiresAt` tras una renovación nunca supera `startedAt + REFRESH_ABSOLUTE_MAX_IN`.
- [ ] `logout` sobre una sesión ya revocada devuelve **200**; `refresh` sobre esa misma sesión
      devuelve **401**.
- [ ] `logout-all` con tres sesiones abiertas devuelve `{ revokedCount: 3 }`, y repetido,
      `{ revokedCount: 0 }`.
- [ ] Cambiar la contraseña con `ESAVI-USER-006` deja todas las sesiones del usuario con
      `revokedReason: 'PASSWORD_CHANGED'`, y el refresh token previo devuelve 401.
- [ ] Un cambio de contraseña que falla por `currentPassword` incorrecta **no** revoca ninguna
      sesión: la transacción no llega a confirmarse.

**Escrituras — este spec no tiene ningún update diferencial**

El bloque de cinco criterios de `template.md` §5 verifica un `004` que recibe un body de datos y
debe dejar la fila «en este estado». **`appSession` no tiene ninguna operación así**: no hay `PUT`
en su superficie, ningún endpoint acepta campos de la fila en el body, y las tres escrituras sobre
filas existentes —rotar, revocar una, revocar todas— son escrituras con intención propia, tal como
§3.5 declara una a una. Los criterios literales no son aplicables; estos cuatro los sustituyen:

- [ ] `grep -rn "buildDifferentialUpdate" src/services/appSession.service.ts` no devuelve
      resultados, y §3.5 del spec explica por qué para cada una de las escrituras.
- [ ] Ninguna ruta de `auth.routes.ts` es un `PUT`, y ningún validador de
      `src/validators/auth.validator.ts` acepta `expiresAt`, `revokedAt`, `revokedReason`,
      `startedAt`, `userId` ni `refreshTokenHash` desde el body.
- [ ] Una segunda revocación de la misma sesión no reescribe `revokedAt`: el filtro exige
      `revokedAt IS NULL`, y la marca de tiempo original se conserva.
- [ ] `ESAVI-USER-006` no revoca nada cuando su `user.update` no llega a ejecutarse. El disparador
      es la escritura efectiva de la contraseña, no la presencia de `newPassword` en el body.

**Secretos**

- [ ] El refresh token en claro no aparece en `src/logs/esaviLog.log` en ningún recorrido, ni en
      el `access.log`, ni en una respuesta de error.
- [ ] `refreshTokenHash` en base es un SHA-256 en hexadecimal de 64 caracteres, nunca el token.
- [ ] Ninguna respuesta de la API incluye `refreshTokenHash`, `ipAddress`, `userAgent`,
      `sysDetails` ni `appDetails` de `appSession`.
- [ ] Un `refresh` con un `sessionId` inexistente y uno con formato inválido devuelven el **mismo**
      código y el **mismo** mensaje.

**Cierre**

- [ ] Las diez claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Forma del mecanismo**

- **Sí:** ciclo completo —login que abre sesión, `refresh`, `logout` y `logout-all`—. Entregar
  solo el `refresh` dejaría un refresh token de ocho horas sin ninguna forma de matarlo, que es
  peor punto de partida que el actual.
- **Sí:** rotación con detección de reutilización. Es la única variante que convierte el robo de
  un refresh token en un evento observable. La alternativa —rotar y devolver 401 sin más— cuesta
  lo mismo de implementar y no detecta nada.
- **No:** refresh token sin rotación, válido hasta `expiresAt`. Un token de larga vida que no
  cambia es una contraseña permanente con otro nombre.
- **Sí:** token compuesto `<sessionId>.<secreto>` con `sha256` sobre el secreto. El `sessionId`
  hace que la búsqueda sea por clave primaria.
- **No:** hashear el secreto con `bcrypt`. Obligaría a recorrer todas las sesiones vigentes del
  usuario comparando una a una. `bcrypt` es lento a propósito para proteger contraseñas de baja
  entropía; un secreto de 256 bits aleatorios no lo necesita.
- **No:** refresh token como segundo JWT. Ataría la validez del refresh a `JWT_SECRET`, que es
  justo lo que ya compromete al access token: rotar la clave invalidaría las dos credenciales a
  la vez y no habría nada que recuperar.
- **Sí:** el refresh token viaja en el body JSON. Coherente con una API que hoy no toca cookies.
- **No:** cookie `httpOnly` con `SameSite`. Protege mejor frente a XSS, pero introduce
  `cookie-parser`, CORS con credenciales y un acoplamiento al dominio del frontend. Queda como
  evolución, no como descarte definitivo.

**Duraciones**

- **Sí:** `JWT_EXPIRES_IN` baja a `1h` y el refresh token vive `8h`. La ventana de un access token
  robado pasa de ocho horas a una, y la jornada de ocho horas que el usuario percibe hoy se
  conserva intacta porque el cliente renueva solo.
- **No:** reutilizar `JWT_EXPIRES_IN` como plazo de las dos credenciales. Caducarían juntas y el
  `refresh` no serviría para nada: cuando el access token muere, el refresh ya estaría muerto.
- **Sí:** sesión deslizante con tope absoluto de 30 días. Es la petición original —que la sesión
  se mantenga viva con el uso— sin renunciar a que caduque alguna vez.
- **No:** sesión deslizante pura. Una sesión con uso continuo no expiraría jamás, y quien robe un
  refresh token lo renueva indefinidamente. Es exactamente el fallo que la rotación pretende
  detectar, dejado abierto por el otro lado.
- **No:** tope fijo sin deslizamiento. Es lo que ya hay hoy con `JWT_EXPIRES_IN`, y es el
  problema C de §1.
- **Sí:** el tope absoluto se calcula en la aplicación desde `startedAt`. **No:** añadir una
  columna `absoluteExpiresAt` al DDL. Modificar `esaviapp.sql` afecta a la carga del esquema en
  los tests y a cualquier base ya desplegada, para guardar un valor derivado de dos datos que ya
  están en la fila.

**Codificación y superficie**

- **Sí:** la superficie HTTP se codifica bajo `AUTH` y la persistencia bajo `SESSION`. El
  `appDetails` de `appSession` tiene que poder decir quién escribió cada fila, y
  `ESAVI-USER-006` escribe en ella desde fuera del dominio `auth`.
- **No:** dar superficie HTTP a `appSession`. Los tres servicios de sesión son internos, siguiendo
  el precedente de `ESAVI-DIAGTERM-006`. Ver y gestionar las sesiones propias es un CRUD con sus
  siete artefactos y su matriz de roles: merece su propio spec.
- **Sí:** `refresh` y `logout` sin `tokenValidation`. Exigir un access token válido para cerrar
  sesión significa que quien más lo necesita —el que tiene el token expirado— no puede hacerlo, y
  su refresh token queda vivo hasta caducar.
- **Sí:** `logout-all` con `tokenValidation`. El `userId` sale de `req.user`; aceptarlo del body
  convertiría el endpoint en una denegación de servicio contra cualquier usuario.
- **Sí:** `logout` idempotente en 200, `refresh` en 401. Cerrar algo ya cerrado consiguió su
  objetivo; renovar algo ya muerto, no.
- **Sí:** `refresh` devuelve solo los tokens. **No:** repetir el bloque `user` del login. Añadiría
  una consulta con `include` de roles a cada renovación, que es la operación más frecuente de todo
  el mecanismo.
- **Sí:** el mismo código y el mismo mensaje para el token malformado y el `sessionId` inexistente.
  Distinguirlos convierte el endpoint en un oráculo de qué sesiones existen.

**Alcance**

- **Sí:** cerrar la deuda del SPEC F04 revocando las sesiones al cambiar la contraseña, en la misma
  transacción. Cuesta una llamada dentro de un servicio que ya existe, y es el riesgo que ese spec
  dejó anotado por escrito.
- **No:** validar `ipAddress` o `userAgent` en el `refresh`. Un `User-Agent` cambia con cada
  actualización del navegador y una IP cambia al saltar de red; validarlos cierra sesiones
  legítimas a diario a cambio de una barrera que un atacante con el token copia sin esfuerzo.
- **No:** límite de sesiones concurrentes. Un usuario con móvil y escritorio abiertos es el caso
  normal, y `logout-all` ya permite cortar todo.
- **No:** purga de sesiones caducadas. Requiere un trabajo programado, que no existe en el
  repositorio. Las filas revocadas son además la traza de auditoría del mecanismo.
- **No:** rate limiting sobre `/login` y `/refresh`. Es una capa transversal que afectaría a toda
  la API, no una regla de este dominio.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El cliente web no implementa la renovación y `JWT_EXPIRES_IN=1h` acorta las sesiones de 8h a 1h de golpe | El paso 8 del plan es el único que cambia comportamiento observable. Los pasos 1 a 7 pueden desplegarse antes, y el 8 se coordina con el frontend. Si hiciera falta, `JWT_EXPIRES_IN` puede quedarse en `8h` sin tocar código |
| Dos peticiones concurrentes del cliente con el mismo refresh token —dos pestañas, o un reintento de red— disparan la detección de reutilización y cierran todas las sesiones del usuario | Es el falso positivo característico de la rotación. El cliente debe serializar la renovación: un solo `refresh` en vuelo, y las peticiones en espera reintentan con el token nuevo. Queda declarado como requisito para el cliente web, no como excepción del servidor |
| Un `refresh` que revoca por reutilización escribe sobre todas las sesiones del usuario en el camino de una petición no autenticada | El filtro es por `userId` de una fila ya localizada por PK y se apoya en `IX_appSession_active`. Un atacante no puede provocarlo contra un usuario arbitrario: necesita un refresh token válido de esa persona |
| `appSession` crece sin límite: cada login deja una fila que nadie borra | Asumido en este spec. Una fila por sesión es un volumen pequeño frente a las tablas de casos, y las filas revocadas son traza de auditoría. La purga se aborda cuando el volumen lo justifique |
| El reloj de la aplicación y el de Postgres divergen: `startedAt` lo pone la base con `current_timestamp` y el tope absoluto se calcula en Node | Las dos marcas se comparan siempre contra el mismo origen dentro de una operación. Una divergencia de segundos no afecta a un tope de 30 días; una de horas ya rompería el `CHECK` del DDL antes |

---

## 8. Impacto en el contrato HTTP

Un solo endpoint existente cambia, y el cambio es **aditivo**:

**`POST /api/auth/login` — `ESAVI-AUTH-001`.** `data` incorpora `refreshToken` y `expiresAt`
junto al `token` y al bloque `user` que ya devolvía. Ningún campo desaparece ni cambia de tipo,
así que un cliente actual que ignore los campos nuevos sigue funcionando.

**El cambio real lo introduce `JWT_EXPIRES_IN`, no el JSON.** El access token pasa de ocho horas
a una. Un cliente que no renueve empezará a recibir 401 de `tokenValidation` a partir de la
primera hora, con `auth.tokenExpired` — el mismo mensaje que hoy recibe a las ocho. Es un cambio
de comportamiento sin cambio de contrato, y por eso el plan lo aísla en el paso 8.

**`ESAVI-USER-006` cambia de efecto, no de forma.** `POST /api/users/change-password` sigue
respondiendo lo mismo, pero ahora invalida el access token y el refresh token de quien la llamó,
incluidos los de sus otros dispositivos. El cliente debe redirigir al login tras un cambio de
contraseña correcto.

Ningún otro endpoint del repositorio cambia.

---

## Lo que **no** está en este spec

- CRUD de sesiones: ver las sesiones propias, verlas como SUPERADMIN, revocar una por `sessionId`
  desde HTTP.
- Refresh token en cookie `httpOnly`.
- Validación de `ipAddress` y `userAgent` en la renovación.
- Límite de sesiones concurrentes por usuario.
- Purga programada de sesiones caducadas o revocadas.
- Rate limiting sobre `/api/auth/login` y `/api/auth/refresh`.
- `appPermission` y `appRolePermission`: la autorización sigue siendo por nivel de rol.
- Recuperación de contraseña por correo, bloqueo por intentos fallidos y autenticación externa
  (`externalProvider`, `externalSubject`), que el SPEC F04 ya dejó fuera.

Cada uno de esos, si aterriza, va en su propio spec.
