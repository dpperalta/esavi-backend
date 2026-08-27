# SPEC F43 — Restablecimiento de contraseña por autoservicio

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F04 (`appUser`, `ESAVI-USER-006`), SPEC F12 (update diferencial), SPEC F26 (`systemConfig`, `ESAVI-SYSCONF-006` y `-008`), **SPEC F42 (`appSession`, `ESAVI-SESSION-007`) — dependencia dura: este spec no se implementa antes**
> **Fecha:** 2026-08-26
> **Objetivo:** Permitir que un usuario que no recuerda su contraseña la restablezca por sí mismo, mediante un enlace de un solo uso enviado a su correo, sin intervención de un administrador y sin revelar qué cuentas existen.

---

## 1. Por qué existe este spec

**A — Hoy una contraseña olvidada es un ticket para un administrador.** El repositorio tiene
exactamente dos formas de escribir un `passwordHash`: `createUserService`
(`src/services/user.service.ts:133`), que la minta al crear el usuario y deja
`requiresPasswordChange: true`, y `changePasswordService` (`src/services/user.service.ts:421`),
que **exige la contraseña actual** para cambiarla. Un usuario que no la recuerda no puede usar
ninguna de las dos: la primera es de ADMIN y crea usuarios, la segunda pide justo lo que se le
olvidó. La única salida es que un ADMIN intervenga, y eso significa que la contraseña de
reemplazo pasa por una persona distinta de su dueño.

**B — La columna que sostiene el mecanismo lleva un año esperando.**
`appUser.requiresPasswordChange` (`esaviapp.sql:248`) existe desde el inicio y hoy solo la
escribe el `001` al crear un usuario. El DDL anticipó que la aplicación distinguiría una
contraseña impuesta de una elegida; el flujo que cierra el ciclo —imponerla, obligar a cambiarla,
y ahora restablecerla— nunca se completó.

**C — No existe ninguna tabla donde anotar un token de restablecimiento.** De las 45 tablas de
`esaviapp.sql`, ninguna guarda credenciales de un solo uso. `appSession` es lo más cercano y no
sirve: sus columnas describen una sesión abierta (`refreshTokenHash`, `startedAt`,
`revokedReason`), no una autorización efímera para escribir una contraseña, y el
[SPEC F42](./42-auth-refresh-token.md) la reserva íntegra para eso. Este spec añade la
**tabla 46**, `appPasswordReset`.

**D — La aplicación no sabe enviar un correo.** No hay `nodemailer` en `package.json`, no hay
variables `SMTP_*` en ningún `.env`, no hay plantillas ni un helper de transporte. Un mecanismo
de «olvidé mi contraseña» sin canal de entrega no es un mecanismo: es una tabla. Este spec
introduce el transporte, y lo hace configurable desde `systemConfig` en vez de desde el entorno.

**E — `systemConfig` está sembrado y nadie lo lee.** `src/data/systemConfig.defaults.ts:15-20`
lo dice sin rodeos: *«NOBODY CONSUMES THESE ROWS YET»*. Las ocho filas existen con su historial
y su auditoría, pero `pagination.constants.ts` sigue leyendo `.env` y `CORS_ORIGINS` se resuelve
en `app.ts`. El [SPEC F26](./26-systemconfig-crud.md) §2 declaró fuera de alcance decidir qué
parámetros bajan a la base y qué fuente gana. **Este spec es el primer consumidor en ejecución
de `systemConfig`**, y por tanto el que fija esa regla de precedencia por primera vez: la base
gana, el entorno es el respaldo. No resuelve la migración completa —eso sigue siendo un spec de
configuración aparte—, pero deja de ser una pregunta abierta para el bloque `MAIL` y `AUTH`.

**F — Un endpoint público de recuperación es un oráculo de enumeración si se escribe mal.**
Responder «ese correo no existe» convierte `POST /api/auth/forgot-password` en una herramienta
para inventariar las cuentas del sistema, y las cuentas de este sistema son personal sanitario
identificable. La respuesta es **siempre la misma**, y este spec la trata como requisito de
seguridad, no como detalle de implementación.

---

## 2. Alcance

**Dentro:**

- **Tabla nueva `appPasswordReset` en `esaviapp.sql`** — la 46ª del esquema. Con su modelo
  `src/models/appPasswordReset.model.ts`, sus asociaciones con `appUser` en
  `src/models/associations/appPasswordReset.associations.ts` y su alta en `initModels()`.
- **Abreviatura `PWDRESET`**, registrada en `references/CONVENTIONS.md` §6 antes de usarse.
- `ESAVI-AUTH-006` — `POST /api/auth/forgot-password`. Público, sin `tokenValidation`: quien lo
  llama no tiene token, ése es el problema que resuelve. Responde **siempre 200**, exista o no el
  correo.
- `ESAVI-AUTH-007` — `POST /api/auth/reset-password`. Público. Consume el token del cuerpo y
  escribe la contraseña nueva.
- `ESAVI-PWDRESET-001`, `-006` y `-007` — servicios internos **sin ruta HTTP**: abrir una
  solicitud, resolver y consumir un token, e invalidar las solicitudes vigentes de un usuario.
  Viven en `src/services/appPasswordReset.service.ts`.
- **Token de un solo uso, con caducidad de 30 minutos** y formato compuesto
  `<resetId>.<secreto>`, el mismo esquema que el SPEC F42 §3.3 fijó para el refresh token. Solo
  se guarda `sha256(secreto)`; el token en claro existe una vez y no se escribe en ningún log.
- **Una solicitud nueva invalida las anteriores del mismo usuario.** Solo el último enlace
  enviado es válido.
- **Transporte de correo**: dependencia nueva `nodemailer`, helper `src/helpers/mailer.helper.ts`
  que construye el transporte a partir de la configuración resuelta, y
  `src/services/common/mail.service.ts` con la operación de envío. En `NODE_ENV=test` el
  transporte es `jsonTransport`, que serializa el mensaje sin abrir conexión.
- **Plantillas del correo** en `src/data/emails/passwordReset.{es,en,nl}.html` y su variante
  `.txt`, con los marcadores `{{displayName}}`, `{{resetUrl}}` y `{{expiresInMinutes}}`. El
  **asunto** viaja como clave i18n normal. El idioma sale de `req.lang`, resuelto por
  `languageMiddleware` en la petición del `006`.
- **Ocho entradas nuevas en `src/data/systemConfig.defaults.ts`**: seis de `scope: 'MAIL'` y dos
  de `scope: 'AUTH'`. La contraseña SMTP con `isEncrypted: true`.
- **Regla de precedencia de configuración, declarada por primera vez**: `systemConfig` gana,
  `.env` es el respaldo. Se lee en cada envío, sin caché.
- **Limitador propio sobre `POST /api/auth/forgot-password`**, más estricto que el global de
  `src/app.ts:74`, montado en la ruta y desactivado bajo `NODE_ENV=test` por la misma razón que
  el global.
- **Revocación de sesiones al restablecer.** El `007` invoca `ESAVI-SESSION-007` (SPEC F42) con
  `revokedReason: 'PASSWORD_RESET'`, en la misma transacción que la escritura de la contraseña.
- **Invalidación de solicitudes pendientes desde `ESAVI-USER-006`**, con
  `invalidatedReason: 'PASSWORD_CHANGED'`.
- **`requiresPasswordChange` a `false`** cuando el restablecimiento se consuma: la contraseña
  nueva la eligió su dueño.
- Claves i18n nuevas en los **tres** archivos, `src/data/i18n/{es,en,nl}.json`.
- Ampliación de `tests/contract/auth.test.ts` con el recorrido solicitud → correo → consumo, el
  rechazo del token reutilizado, el del caducado y la indistinguibilidad de la respuesta del
  `006`.

**Fuera de alcance (otros specs):**

- **CRUD de `appPasswordReset`.** La tabla no recibe superficie HTTP: ni listado, ni `getById`,
  ni `004`, ni activación. Nadie consulta las solicitudes de restablecimiento desde la API. Los
  tres códigos que declara son servicios internos.
- **Migración general de `.env` a `systemConfig`.** Este spec fija la precedencia y baja **ocho**
  parámetros, los suyos. Que `ESAVI_APP_DEFAULT_LIMIT` o `CORS_ORIGINS` dejen de leerse del
  entorno sigue siendo el spec de configuración que el F26 §2 declaró pendiente.
- **Caché de la configuración leída.** Sin caché, por decisión: un restablecimiento no es un
  camino caliente, y cachear obligaría a invalidar desde `ESAVI-SYSCONF-004`, mecanismo nuevo que
  este spec no debe inventar.
- **Purga de solicitudes caducadas o consumidas.** Las filas se quedan en la tabla. No hay
  trabajo programado de limpieza y no se crea aquí. La tabla **no** se añade al bucle
  `preventPhysicalDelete` de `esaviapp.sql:1377-1382` precisamente para que esa purga futura sea
  posible sin tocar el DDL otra vez.
- **Verificación de correo al crear un usuario.** `appUser` no tiene columna de verificación y
  este spec no la añade. Un correo registrado se asume válido.
- **Segundo factor y preguntas de seguridad.** El único factor es la posesión de la bandeja de
  entrada.
- **Notificar al usuario que su contraseña cambió.** Un segundo correo de aviso tras el `007` es
  un mecanismo defensivo razonable y no entra: exige decidir qué pasa cuando ese envío falla
  justo después de una escritura ya confirmada.
- **Plantillas de correo para cualquier otro asunto.** El transporte queda construido y
  reutilizable, pero este spec solo declara una plantilla.
- **Que un ADMIN dispare el restablecimiento de otro usuario.** Es autoservicio: el `006` solo
  acepta un correo y actúa sobre su dueño. Una operación administrativa de «forzar
  restablecimiento» sería un código propio en `USER`, no aquí.
- **Rotación de la clave de `esaviCrypt`.** El `006` busca por `esaviCrypt(email)` como hace el
  login, y hereda la misma atadura al IV fijo.
- **`005C` sobre `appPasswordReset`.** Aunque la tabla queda fuera del bucle protector, no se
  declara endpoint de borrado físico: no hay superficie HTTP en absoluto para esta entidad.

---

## 3. Modelo de datos

### 3.1 Tabla nueva — `appPasswordReset`

No existe en `esaviapp.sql`. Este spec la añade como **tabla 46**, en el bloque
*Application administration*, inmediatamente después de `appSession` (`esaviapp.sql:357`), que es
su vecina conceptual.

```sql
CREATE TABLE IF NOT EXISTS "appPasswordReset" (
  "resetId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL,
  "tokenHash" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "usedAt" timestamptz,
  "invalidatedAt" timestamptz,
  "invalidatedReason" text,
  "requestedIp" inet,
  "requestedUserAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_appPasswordReset_user" FOREIGN KEY ("userId") REFERENCES "appUser" ("userId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_appPasswordReset_tokenHash" UNIQUE ("tokenHash"),
  CONSTRAINT "CK_appPasswordReset_dates" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX IF NOT EXISTS "IX_appPasswordReset_userId" ON "appPasswordReset" ("userId");
CREATE INDEX IF NOT EXISTS "IX_appPasswordReset_pending" ON "appPasswordReset" ("userId", "expiresAt")
  WHERE "usedAt" IS NULL AND "invalidatedAt" IS NULL AND "deletedAt" IS NULL;
```

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `resetId` | `uuid` | no | PK, `gen_random_uuid()`. Es la primera mitad del token compuesto |
| `userId` | `uuid` | no | FK → `appUser("userId")`, `ON UPDATE CASCADE ON DELETE RESTRICT`, igual que `FK_appSession_user` |
| `tokenHash` | `text` | no | SHA-256 en hexadecimal del secreto. **Nunca el token en claro** |
| `expiresAt` | `timestamptz` | no | `createdAt + ESAVI_PASSWORD_RESET_EXPIRES_MINUTES`. Calculado en la aplicación |
| `usedAt` | `timestamptz` | sí | Marca de consumo. `NULL` es «todavía no se usó» |
| `invalidatedAt` | `timestamptz` | sí | Marca de invalidación sin consumo |
| `invalidatedReason` | `text` | sí | `SUPERSEDED`, `REUSE_DETECTED`, `PASSWORD_CHANGED` |
| `requestedIp` | `inet` | sí | Solo traza. No se compara al consumir |
| `requestedUserAgent` | `text` | sí | Solo traza. No se compara al consumir |

Columnas transversales: lleva `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` (JSONB) y
`appDetails` (JSONB), como las otras 45 tablas.

**Por qué `usedAt` e `invalidatedAt` son dos columnas y no una.** Un token consumido y un token
desplazado por una solicitud posterior son estados distintos ante el mismo hecho observable —el
enlace ya no vale—, y solo el primero es sospechoso: presentar un token **ya consumido** es la
señal de que alguien está reutilizando un enlace que ya circuló. Colapsar los dos en una columna
borra esa distinción justo donde hace falta, y es la que dispara la invalidación defensiva del
`007` (§3.5).

**Anomalía declarada: `appPasswordReset` no tiene `isActive`.** Es la segunda tabla del bloque de
auth sin ella, después de `appSession`, y por la misma razón: su ciclo de vida se expresa con
marcas de tiempo, no con un interruptor. Una solicitud de restablecimiento no se «reactiva» — se
pide otra. En consecuencia esta entidad **no tiene `005A` ni `005B`**, no usa
`setEntityActiveStatusService` y no admite el listado dual `002A`/`002B`.

**Triggers que hereda y el que no.** El bucle de `esaviapp.sql:1291-1306` monta
`TRG_appPasswordReset_setSysDetails` **automáticamente**, porque selecciona toda tabla con columna
`sysDetails`: no hay nada que declarar. El bucle `preventPhysicalDelete` de
`esaviapp.sql:1377-1382` es una lista explícita y **la tabla no se añade a ella**, por la razón
declarada en §2: la purga futura de solicitudes caducadas debe poder existir sin volver a tocar
el DDL.

**El aviso de siempre.** `CREATE TABLE IF NOT EXISTS` no altera una base ya desplegada, pero aquí
sí la crea: la tabla es nueva, así que reejecutar `esaviapp.sql` basta. Es el caso benigno del
riesgo que el F22 y el F19 declararon — no hay `ALTER TABLE` manual que hacer.

### 3.2 Modelo Sequelize

`src/models/appPasswordReset.model.ts`, clase `AppPasswordReset`, con las decisiones de siempre:
`timestamps: false`, `freezeTableName: true`, `tableName: 'appPasswordReset'`, PK UUID con
`defaultValue: sequelize.literal('gen_random_uuid()')`. Alta en el barrel `src/models/index.ts`.

`requestedIp` se declara `DataTypes.STRING` — Sequelize no tipa `inet` y Postgres acepta el texto
sin conversión explícita, tal como el SPEC F42 §3.2 resolvió `appSession.ipAddress`. `tokenHash`,
`requestedUserAgent` e `invalidatedReason` van como `DataTypes.TEXT`.

`appDetails` se define `DataTypes.JSONB` y se maneja **como array** —`[...currentAppDetails,
newEntry]`—, igual que en las otras 45 tablas, pese al `DEFAULT '{}'` del DDL.

Asociaciones, en `src/models/associations/appPasswordReset.associations.ts` —nunca dentro del
modelo— y registradas en `initModels()`:

- `AppPasswordReset.belongsTo(AppUser, { foreignKey: 'userId', as: 'user' })`
- `AppUser.hasMany(AppPasswordReset, { foreignKey: 'userId', as: 'passwordResets' })`

### 3.3 Tipos, y el formato del token

Dominio nuevo `src/types/auth/`, con su `index.ts` de barrel y alta en `src/types/index.ts`. Hoy
no existe: el F42 abre `src/types/session/` y éste abre `src/types/auth/`.

```ts
// src/types/auth/appPasswordReset.types.ts
export interface CreatePasswordResetInput {
    userId: string;
    requestedIp?: string | null;
    requestedUserAgent?: string | null;
}

export interface ForgotPasswordInput {
    email: string;
}

export interface ResetPasswordInput {
    token: string;
    newPassword: string;
}

export interface PasswordResetToken {
    token: string;       // `<resetId>.<secreto>`, en claro y una sola vez
    expiresAt: Date;
}
```

No se declara `UpdateAppPasswordResetInput`: lo prohíbe `CONVENTIONS.md` §4, y además ninguna
escritura de esta entidad es un update diferencial (§3.5).

Y los tipos del transporte, en `src/types/common/mail.types.ts` — dominio existente, porque el
correo no pertenece a `auth`:

```ts
export interface MailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export interface MailConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
}
```

**Formato del token.** Cadena `<resetId>.<secreto>`, donde `resetId` es el UUID de la fila y
`secreto` son 32 bytes de `crypto.randomBytes` en `base64url` (43 caracteres). Es **el mismo
esquema compuesto que el SPEC F42 §3.3** fijó para el refresh token, deliberadamente: dos
formatos de credencial opaca en el mismo repositorio serían dos implementaciones de comparación
que mantener.

La ventaja del formato compuesto es que la fila se localiza **por clave primaria** —no hay
barrido de la tabla buscando un hash— y el secreto se verifica después con
`crypto.timingSafeEqual` sobre `sha256(secreto)` contra `tokenHash`. El `UNIQUE ("tokenHash")`
del DDL no participa de esa búsqueda: está como red frente a una colisión que, con 32 bytes de
entropía, no debería ocurrir jamás.

**El token en claro no se persiste ni se registra.** No aparece en `esaviLog`, ni en
`appDetails`, ni en la respuesta HTTP. Existe en memoria el tiempo que tarda en componerse el
correo.

### 3.4 Superficie HTTP

```
POST   /api/auth/forgot-password    ESAVI-AUTH-006   público   (nuevo)
POST   /api/auth/reset-password     ESAVI-AUTH-007   público   (nuevo)
```

**Por qué `006` y `007` y no `005`.** `auth` no es una entidad CRUD: su `001` es el login y el
SPEC F42 ocupa `002`, `003` y `004`. El siguiente libre sería `005`, y no se usa: en el canon esa
cifra significa siempre borrado o activación (`005A`/`005B`/`005C`), y reciclarla para un
restablecimiento haría que buscar `ESAVI-AUTH-005` en el log devolviera algo que no es ninguna de
las tres. Se salta, y las dos operaciones se registran en la tabla de operaciones no canónicas de
`CONVENTIONS.md` §6.

**«Público» aquí sí significa sin credencial previa.** Ninguna de las dos lleva `tokenValidation`
ni `validateUserRole`: quien las llama, por definición, no puede autenticarse. La credencial del
`007` es el token del cuerpo, y el servicio la verifica contra `appPasswordReset`.

**Cadena de middlewares — desviación declarada de `CONVENTIONS.md` §8.** El orden invariable es
`tokenValidation, validateUserRole(ROL), ...validators, validateFields, handler`, y aquí los dos
primeros no existen. El limitador ocupa la primera posición:

```ts
// Request Password Reset
// Code: ESAVI-AUTH-006
router.post('/forgot-password', passwordResetLimiter, ...forgotPasswordValidator, validateFields, forgotPassword);

// Reset Password
// Code: ESAVI-AUTH-007
router.post('/reset-password', ...resetPasswordValidator, validateFields, resetPassword);
```

No es una excepción nueva: `POST /api/auth/login` ya se compone así
(`src/routes/auth.routes.ts:11`). Lo que sí es nuevo es el limitador por ruta, y va **antes** que
todo lo demás a propósito — un limitador que se ejecuta después de la validación ya ha pagado el
coste que pretende evitar.

**El limitador.** `passwordResetLimiter`, en `src/middlewares/rateLimit.middleware.ts` (archivo
nuevo), construido con `express-rate-limit`, que ya es dependencia. **5 solicitudes por IP cada
15 minutos**, frente a las 100 del limitador global de `src/app.ts:74`. Se monta solo cuando
`NODE_ENV !== 'test'`, por la razón que el propio `app.ts:71-72` documenta para el global. Solo
protege el `006`: el `007` exige un token válido, y limitarlo castigaría al usuario legítimo que
se equivoca al pegar el enlace.

**Sin fila en `ROUTE_RULES`.** `tests/auth/roles.test.ts` enumera rutas con rol mínimo, y estas
dos no tienen ninguno. Su ausencia se documenta con un comentario en el archivo, siguiendo el
precedente de `ESAVI-DIAGTERM-006` (`tests/auth/roles.test.ts:204-207`) y lo que el SPEC F42
§3.4 hace con `ESAVI-AUTH-002` y `-003`.

**Nota de orden de declaración: no aplica.** Ninguna ruta de `auth.routes.ts` lleva parámetro
`:id`, así que no hay riesgo de que `/:id` capture una ruta literal.

**Servicios internos, sin ruta HTTP:**

```
ESAVI-PWDRESET-001   abrir solicitud — invocado por ESAVI-AUTH-006
ESAVI-PWDRESET-006   resolver y consumir un token — invocado por ESAVI-AUTH-007
ESAVI-PWDRESET-007   invalidar las vigentes de un usuario — invocado por ESAVI-AUTH-006, -007 y ESAVI-USER-006
```

Viven en `src/services/appPasswordReset.service.ts`. `006` y `007` toman números no canónicos
porque resolver e invalidar no son ninguna de las siete operaciones del rango `001`–`005B`, y
esta entidad no tiene `isActive` con el que expresar `005A`/`005B`. Es la misma estructura que el
F42 aplicó a `ESAVI-SESSION-*`.

### 3.5 Reglas de negocio por operación

**`ESAVI-AUTH-006` — solicitar el restablecimiento.**

1. Normaliza el correo **exactamente como el login**: `email.trim().toLowerCase()`.
   `loginService` (`src/services/auth.service.ts:20-22`) explica por qué `citext` no ayuda aquí —
   la columna guarda el ciphertext, así que la insensibilidad de Postgres se aplica al texto
   cifrado y no a la dirección.
2. Busca con `AppUser.findOne({ where: { email: esaviCrypt(normalizedEmail), isActive: true } })`.
3. **Si no hay usuario, la operación termina en 200 sin hacer nada más**: no se escribe fila, no
   se envía correo, no se registra el correo consultado en el log —eso sería convertir `esaviLog`
   en el inventario de cuentas que el endpoint se niega a ser—. Solo un `info` sin dato personal.
4. Si lo hay: invoca `ESAVI-PWDRESET-007` con `invalidatedReason: 'SUPERSEDED'` sobre las
   solicitudes vigentes del usuario, y después `ESAVI-PWDRESET-001` para abrir la nueva. Las dos
   escrituras van **en la misma transacción**: dejar las anteriores vivas porque la nueva falló es
   exactamente el estado que la regla «solo el último enlace vale» pretende impedir.
5. **El correo se envía después del `commit`, nunca dentro de la transacción.** Un envío dentro de
   una transacción que después revierte deja al usuario con un enlace en la bandeja y sin fila que
   lo respalde — un token que no existe. El orden es: escribir, confirmar, enviar.
6. Si el envío falla, la respuesta sigue siendo **200** y el fallo va a `esaviLog` en nivel
   `error`. Es la decisión de §2: un `500` cuando el SMTP falla y un `200` cuando la cuenta no
   existe convertiría el código de estado en el oráculo que los pasos 3 y 6 evitan por separado.

**`ESAVI-PWDRESET-001` — abrir la solicitud.** Genera 32 bytes con `crypto.randomBytes`, los
codifica en `base64url`, e inserta la fila con `tokenHash = sha256(secreto)` y
`expiresAt = now + ESAVI_PASSWORD_RESET_EXPIRES_MINUTES`. `requestedIp` sale de `req.ip` y
`requestedUserAgent` de `req.headers['user-agent']`, los dos opcionales y truncados a lo que
acepte la columna. Devuelve `<resetId>.<secreto>` **una sola vez**. Auditoría en `appDetails` con
`method: 'ESAVI-PWDRESET-001'`.

**`ESAVI-AUTH-007` — consumir el token.** El orden de las comprobaciones es la regla, no un
detalle de implementación:

1. Formato del token → 401 `AUTH_007_INVALID_RESET_TOKEN`. Un token malformado no llega a tocar
   la base.
2. Fila por `resetId` → si no existe, 401 `AUTH_007_INVALID_RESET_TOKEN`. **Mismo código y mismo
   mensaje** que el formato inválido: distinguirlos revela qué `resetId` existen.
3. `sha256(secreto)` contra `tokenHash` con `crypto.timingSafeEqual` → si no coincide, 401
   `AUTH_007_INVALID_RESET_TOKEN`. Mismo código otra vez, por lo mismo.
4. `usedAt` no nulo → **es reutilización de un enlace que ya circuló**. Se invoca
   `ESAVI-PWDRESET-007` sobre el `userId` de la fila con `invalidatedReason: 'REUSE_DETECTED'`
   —cerrando de paso cualquier solicitud vigente— y se responde 401 `AUTH_007_RESET_TOKEN_USED`.
5. `invalidatedAt` no nulo → 401 `AUTH_007_RESET_TOKEN_INVALIDATED`. Es el caso benigno: el
   usuario pidió el enlace dos veces y abrió el primero.
6. `expiresAt` pasado → 401 `AUTH_007_RESET_TOKEN_EXPIRED`.
7. El usuario debe seguir existiendo y activo → 401 `AUTH_007_INVALID_RESET_TOKEN`. Se revalida
   aquí y no se confía en lo que valía cuando se emitió el enlace: entre la solicitud y el consumo
   caben 30 minutos y una desactivación.

Superados los siete, escribe **todo en una transacción, todo o nada**:

- `appUser`: `passwordHash = bcrypt.hash(newPassword, 10)` y `requiresPasswordChange = false`, con
  entrada en `appDetails` de `method: 'ESAVI-AUTH-007'`.
- La fila consumida: `usedAt = now`.
- El resto de solicitudes vigentes del usuario: `ESAVI-PWDRESET-007` con
  `invalidatedReason: 'SUPERSEDED'`.
- `ESAVI-SESSION-007` (SPEC F42) con `revokedReason: 'PASSWORD_RESET'`. **Es la razón de la
  dependencia dura**: una contraseña restablecida porque el usuario perdió el control de su
  cuenta, con las sesiones del atacante aún abiertas, no restablece nada.

**La contraseña nueva no se compara con la actual.** Decisión explícita, contraria a lo que hace
`ESAVI-USER-006` (`src/services/user.service.ts:439-442`), donde un `409 USER_006_SAME_PASSWORD`
impide que un cambio vacío limpie `requiresPasswordChange`. Aquí no aplica el mismo razonamiento:
quien llega con un token de reset válido no está eludiendo nada, y el `bcrypt.compare` extra solo
serviría para informarle de que acertó la contraseña vigente. El `007` acepta cualquier valor que
pase `resetPasswordValidator`.

**`ESAVI-PWDRESET-006` — resolver.** Encapsula los pasos 1 a 7 y devuelve la fila junto con el
usuario, o lanza el `AppError` que corresponda. El controlador del `007` no vuelve a comprobar
nada de esto.

**`ESAVI-PWDRESET-007` — invalidar.** Escribe `invalidatedAt = now` e `invalidatedReason` sobre
las filas del usuario con `usedAt IS NULL AND invalidatedAt IS NULL AND deletedAt IS NULL`,
apoyándose en `IX_appPasswordReset_pending`. Devuelve el número de filas invalidadas. Acepta
`transaction` como parámetro, porque los tres llamantes lo invocan dentro de una.

**`ESAVI-USER-006` — cambio de contraseña (se amplía).** Tras el `user.update` que ya existe
(`src/services/user.service.ts:451`), invoca `ESAVI-PWDRESET-007` sobre el propio usuario con
`invalidatedReason: 'PASSWORD_CHANGED'`, dentro de la transacción que el SPEC F42 abre ahí para
revocar sesiones. Sin esto, un usuario que cambia su contraseña deliberadamente —a menudo porque
sospecha algo— deja vivo hasta 30 minutos un enlace de restablecimiento en una bandeja que quizá
no controla.

#### Contrato de update diferencial

**Ninguna escritura de este spec pasa por `buildDifferentialUpdate`, y cada una declara su
razón.** No hay `004` en esta superficie: ni `appPasswordReset` ni el `007` reciben un body de
datos cuyo efecto sea dejar una fila «en este estado».

| Escritura | Por qué no es diferencial |
|---|---|
| `ESAVI-PWDRESET-001` — abrir solicitud | Es un `001`. Los create nunca pasan por el helper |
| `ESAVI-PWDRESET-006` — marcar `usedAt` | Escritura con intención propia, del mismo orden que una activación `005A`: registra el hecho «este token se consumió», en este instante. Un segundo intento no reescribe nada porque el paso 4 lo rechaza antes, no porque un diff salga vacío |
| `ESAVI-PWDRESET-007` — invalidar | Igual: marca un hecho y su motivo. El filtro exige `usedAt IS NULL AND invalidatedAt IS NULL`, así que una segunda invalidación no alcanza ninguna fila |
| `ESAVI-AUTH-007` — escribir `passwordHash` | `bcrypt.hash` produce una sal nueva en cada llamada, así que el hash **siempre** difiere del guardado aunque la contraseña sea la misma. Un diff sobre el ciphertext sería verdadero por construcción y no significaría nada. La comparación que sí tendría sentido —`bcrypt.compare` sobre el texto plano— está descartada por decisión, arriba |
| `requiresPasswordChange = false` | Va en el mismo `update` que la contraseña, y su valor lo fija el hecho de la escritura, no lo que traiga el body: el cliente no puede enviarlo — `user.validator.ts:48` ya lo rechaza donde es cliente-visible |

**Propagación: el disparador es la escritura efectiva, nunca la presencia de la clave.** La
invalidación de solicitudes y la revocación de sesiones del `007` ocurren porque la contraseña
**se escribió**. Si cualquiera de los siete pasos previos falla, la transacción no llega a abrirse
y no se invalida ni se revoca nada. Lo mismo en la otra dirección: si `ESAVI-USER-006` falla
porque la contraseña actual no coincide, la solicitud de restablecimiento pendiente **sigue
vigente**. Es la traducción a este dominio de la regla del [SPEC F12](./12-differential.md), y el
mismo criterio que el F42 §3.5 declaró para `ESAVI-USER-006`.

### 3.6 Configuración — las ocho filas de `systemConfig`

**La regla de precedencia, que este spec fija por primera vez:** para los códigos que declara,
**`systemConfig` gana y `.env` es el respaldo**. El resolutor vive en
`src/helpers/appConfig.helper.ts` (archivo nuevo) y hace, en orden: consulta la fila por el par
`(code, scope)` reutilizando el servicio de `ESAVI-SYSCONF-006`; si existe, está activa y su valor
no está vacío, lo devuelve —descifrado con `decryptSystemConfigValue` cuando `isEncrypted`—; si
no, lee la variable de entorno homónima; si tampoco, lanza el error que el `006` convierte en un
`error` de log y un 200.

Esta regla alcanza **solo a los ocho códigos de este spec**. `ESAVI_APP_DEFAULT_LIMIT` y compañía
siguen leyéndose del entorno, como declara §2.

Ocho entradas nuevas en `src/data/systemConfig.defaults.ts`, escritas en la forma que
`toConstantCase` produciría:

| `code` | `scope` | `valueType` | `isEncrypted` | `isEditable` | Valor por defecto |
|---|---|---|---|---|---|
| `ESAVI_MAIL_SMTP_HOST` | `MAIL` | `string` | no | sí | `''` |
| `ESAVI_MAIL_SMTP_PORT` | `MAIL` | `number` | no | sí | `587` |
| `ESAVI_MAIL_SMTP_SECURE` | `MAIL` | `boolean` | no | sí | `false` |
| `ESAVI_MAIL_SMTP_USER` | `MAIL` | `string` | no | sí | `''` |
| `ESAVI_MAIL_SMTP_PASSWORD` | `MAIL` | `string` | **sí** | sí | `''` |
| `ESAVI_MAIL_FROM` | `MAIL` | `string` | no | sí | `''` |
| `ESAVI_PASSWORD_RESET_URL` | `AUTH` | `string` | no | sí | `''` |
| `ESAVI_PASSWORD_RESET_EXPIRES_MINUTES` | `AUTH` | `number` | no | sí | `30` |

`ESAVI_PASSWORD_RESET_EXPIRES_MINUTES` queda **editable** —a diferencia de `ESAVI_APP_MAX_LIMIT`,
que es `false` (`systemConfig.defaults.ts:56`)— porque el plazo razonable depende del despliegue,
y quien puede editarlo ya es SUPERADMIN.

**El `008` es solo-alta.** Sembrar deja las seis filas de `MAIL` con valores vacíos: son
credenciales, y un catálogo declarativo versionado en git no es sitio para ellas. Se cargan
después con `ESAVI-SYSCONF-004`, que es precisamente para lo que existe `isEncrypted`.

**Sin caché.** Cada envío consulta `systemConfig`. Un restablecimiento no es un camino caliente
—dos consultas por solicitud—, y cachear obligaría a invalidar desde el `004`, mecanismo nuevo
que este spec no debe inventar.

#### El transporte

`src/helpers/mailer.helper.ts` construye el transporte de `nodemailer` a partir del `MailConfig`
resuelto. En `NODE_ENV=test` devuelve `createTransport({ jsonTransport: true })`, que serializa el
mensaje sin abrir conexión — así `tests/contract/auth.test.ts` afirma sobre el contenido del
correo sin SMTP y sin red.

`src/services/common/mail.service.ts` expone el envío y **no conoce `Request`**, como cualquier
servicio. Recibe el `MailMessage` ya compuesto.

**Plantillas.** `src/data/emails/passwordReset.{es,en,nl}.html` y `.txt` — seis archivos, con
`{{displayName}}`, `{{resetUrl}}` y `{{expiresInMinutes}}`. Se envían las dos variantes en el
mismo mensaje: un cliente que no renderiza HTML recibe el enlace igualmente. El idioma sale de
`req.lang`, que `languageMiddleware` resolvió en la petición del `006`, porque `appUser` no tiene
columna de idioma preferido. `{{resetUrl}}` es
`${ESAVI_PASSWORD_RESET_URL}?token=<resetId>.<secreto>`.

#### Claves i18n nuevas

En los **tres** archivos, `src/data/i18n/{es,en,nl}.json`, bajo la clave `auth` que ya existe:

| Clave | Uso |
|---|---|
| `auth.forgotPasswordSuccess` | 200 de `ESAVI-AUTH-006` — **el mismo texto exista o no la cuenta** |
| `auth.forgotPasswordFailed` | 500 de `ESAVI-AUTH-006` |
| `auth.resetPasswordSuccess` | 200 de `ESAVI-AUTH-007` |
| `auth.resetPasswordFailed` | 500 de `ESAVI-AUTH-007` |
| `auth.invalidResetToken` | 401 — token malformado, inexistente, con hash que no coincide, o de un usuario inactivo |
| `auth.resetTokenUsed` | 401 — el enlace ya se usó; las solicitudes vigentes quedan invalidadas |
| `auth.resetTokenInvalidated` | 401 — desplazado por una solicitud posterior |
| `auth.resetTokenExpired` | 401 — pasaron los 30 minutos |
| `auth.passwordResetEmailSubject` | Asunto del correo |

`auth.forgotPasswordSuccess` redacta en condicional —«si existe una cuenta con ese correo,
recibirá un enlace»— porque el mensaje tiene que ser verdadero en los dos casos.
`tests/i18n/messages.test.ts` exige paridad exacta en los tres idiomas.

### 3.7 Forma de la respuesta

**`ESAVI-AUTH-006`** — 200, sin `data`. No hay nada que devolver y cualquier cosa que se
devolviera diferenciaría los dos caminos:

```
{ ok: true, message: "Si existe una cuenta con ese correo, recibirá un enlace para restablecer su contraseña." }
```

**`ESAVI-AUTH-007`** — 200, sin `data`. La contraseña nueva no vuelve, el usuario tampoco, y no se
emite ningún token de sesión: tras restablecer, el cliente va al login como cualquiera:

```
{ ok: true, message: "Su contraseña fue restablecida correctamente." }
```

Las dos siguen el criterio de `CONVENTIONS.md` §10 para las operaciones que se llaman por su
efecto: `{ ok, message }` y la clave `data` no aparece —ni con la fila, ni en `null`, ni vacía—.

**Errores**, los produce `errorHandler` con la forma de siempre `{ ok, message, code, errors }`.
Todos los fallos de token del `007` son **401**, nunca 404: un `404` sobre un `resetId`
inexistente confirmaría cuáles existen.

---

## 4. Plan de implementación

**Paso 0 — Requisito previo.** El [SPEC F42](./42-auth-refresh-token.md) tiene que estar
**implementado**, no solo aprobado: el `007` invoca `ESAVI-SESSION-007`, y sin `appSession` esa
llamada no existe. Si el F42 no ha entrado, este plan no empieza.

*Verificación:* `src/services/appSession.service.ts` exporta `revokeAllUserSessionsService` y
`tests/contract/auth.test.ts` pasa en verde.

---

**Paso 1 — DDL y registro de la abreviatura.** Añadir el bloque `CREATE TABLE "appPasswordReset"`
de §3.1 a `esaviapp.sql`, justo después de `appSession` (`esaviapp.sql:357`), con sus dos índices.
**No** tocar el bucle `preventPhysicalDelete` (`esaviapp.sql:1377-1382`). En
`references/CONVENTIONS.md` §6: alta de `PWDRESET` en la tabla de abreviaturas, y cinco filas en
la tabla de operaciones no canónicas — `auth 006`, `auth 007`, `appPasswordReset 001`, `006` y
`007`.

*Verificación:* recrear la base de pruebas y comprobar con `\d "appPasswordReset"` que existen las
14 columnas, la FK, el `UNIQUE`, el `CHECK` y los dos índices; que
`TRG_appPasswordReset_setSysDetails` aparece en `\d` **sin haberlo declarado** —lo monta el bucle
de `esaviapp.sql:1291-1306` por tener columna `sysDetails`—; y que
`TRG_appPasswordReset_preventPhysicalDelete` **no** aparece. `git diff esaviapp.sql` muestra un
único bloque añadido.

**Paso 2 — Dependencia de correo.** `npm install nodemailer` y `npm install -D @types/nodemailer`.

*Verificación:* `npm run build` compila y `package.json` registra las dos entradas en su bloque
correcto.

**Paso 3 — Modelo y asociaciones.** `src/models/appPasswordReset.model.ts` con las decisiones de
§3.2, `src/models/associations/appPasswordReset.associations.ts` con las dos direcciones, alta en
`initModels()` y en `src/models/index.ts`.

*Verificación:* `npm run build`; y un `AppPasswordReset.findAll()` contra la base de pruebas
devuelve `[]` sin error de columna inexistente — que es como se detecta un desajuste entre el
modelo y el DDL.

**Paso 4 — Tipos.** `src/types/auth/appPasswordReset.types.ts` y su barrel
`src/types/auth/index.ts`, más `src/types/common/mail.types.ts`. Alta de los dos en
`src/types/index.ts`.

*Verificación:* `npm run build` y `npm run lint`. Ninguna interfaz declarada queda sin usar al
final del plan — es lo que dejó muerto a `UpdateGeoLevelTypeInput`.

**Paso 5 — Configuración.** Las ocho entradas de §3.6 en `src/data/systemConfig.defaults.ts`, y
`src/helpers/appConfig.helper.ts` con el resolutor `systemConfig` → `.env` → error. Alta en
`src/helpers/index.ts`.

*Verificación:* `POST /api/system-configs/sync` como SUPERADMIN crea las ocho filas; una segunda
llamada devuelve `created: 0` —el `008` es solo-alta—; y `ESAVI_MAIL_SMTP_PASSWORD` se guarda como
`{ "enc": "…" }` en la columna, no en claro. Con la fila cargada y la variable de entorno homónima
puesta a otro valor, el resolutor devuelve **el de la base**.

**Paso 6 — Transporte y plantillas.** `src/helpers/mailer.helper.ts`,
`src/services/common/mail.service.ts` y los seis archivos de `src/data/emails/`. Alta del helper
en su barrel.

*Verificación:* bajo `NODE_ENV=test`, enviar un mensaje devuelve el JSON serializado por
`jsonTransport` **sin abrir conexión** —comprobable desconectando la red—; el mensaje trae `html`
y `text`; y los tres marcadores quedan sustituidos, sin ningún `{{` residual en la salida.

**Paso 7 — Claves i18n.** Las nueve claves de §3.6 en `es.json`, `en.json` y `nl.json`.

*Verificación:* `npm run i18n:check` en verde y `tests/i18n/messages.test.ts` pasa.
`auth.forgotPasswordSuccess` está redactada en condicional en los tres idiomas.

**Paso 8 — Validadores.** `forgotPasswordValidator` (correo obligatorio, `isEmail`, normalizado) y
`resetPasswordValidator` (`token` obligatorio no vacío, `newPassword` con la misma política que ya
aplica `updateUserValidator`) en `src/validators/appPasswordReset.validator.ts`, con alta en
`src/validators/index.ts`. **No** se declara `passwordResetIdValidator`: ninguna ruta lleva `:id`,
y los tres validadores obligatorios de `CONVENTIONS.md` §4 presuponen una entidad con superficie
CRUD, que ésta no tiene — desviación declarada aquí y en §6.

*Verificación:* un `POST /api/auth/forgot-password` sin cuerpo devuelve **400** con
`common.validationError`; uno con `{ "email": "no-es-un-correo" }` también.

**Paso 9 — `ESAVI-PWDRESET-001`, `-006`, `-007`.** `src/services/appPasswordReset.service.ts` con
los tres, cada uno con su comentario de dos líneas y su código. Los tres aceptan `transaction`
opcional.

*Verificación:* prueba directa sobre el servicio: `001` deja una fila cuyo `tokenHash` es de 64
caracteres hexadecimales y **no contiene** el secreto devuelto; `007` sobre un usuario con dos
solicitudes vigentes devuelve `2` y una tercera llamada devuelve `0`; `006` con un token cuyo
último carácter se alteró lanza `AUTH_007_INVALID_RESET_TOKEN`.

**Paso 10 — `ESAVI-AUTH-006`.** Servicio en `src/services/auth.service.ts`, controlador en
`src/controllers/auth.controller.ts`, limitador en `src/middlewares/rateLimit.middleware.ts` con
su alta en el barrel, y la ruta en `src/routes/auth.routes.ts`. Escritura en transacción, envío
**después** del `commit`.

*Verificación:* con un correo existente, 200 y una fila nueva; las anteriores del mismo usuario
quedan con `invalidatedReason: 'SUPERSEDED'`. Con un correo inexistente, **200 con el mismo
`message` byte a byte**, cero filas nuevas y ningún correo. Con el SMTP apuntando a un host
muerto, **200** y una línea `error` en `esaviLog`, con la fila igualmente escrita. El correo
consultado **no** aparece en ninguna línea de log.

**Paso 11 — `ESAVI-AUTH-007`.** Servicio, controlador y ruta. Los siete pasos de §3.5 en ese
orden, y la transacción con las cuatro escrituras.

*Verificación:* recorrido completo — solicitar, extraer el token del mensaje serializado,
consumirlo, y **entrar con la contraseña nueva por `POST /api/auth/login`**. Reusar el mismo token
devuelve 401 `AUTH_007_RESET_TOKEN_USED`. Un token de una fila con `expiresAt` en el pasado
devuelve 401 `AUTH_007_RESET_TOKEN_EXPIRED`. Tras el consumo, `requiresPasswordChange` es `false`
y las sesiones del usuario tienen `revokedReason: 'PASSWORD_RESET'`. Un fallo forzado en
cualquiera de las cuatro escrituras deja la contraseña **sin cambiar** y `usedAt` en `NULL`.

**Paso 12 — Propagación a `ESAVI-USER-006`.** En `src/services/user.service.ts`, tras el
`user.update` (`src/services/user.service.ts:451`), invocar `ESAVI-PWDRESET-007` con
`invalidatedReason: 'PASSWORD_CHANGED'`, dentro de la transacción que el F42 abre ahí para revocar
sesiones. Actualizar el comentario de `user.service.ts:424`, que el F42 ya reescribe.

*Verificación:* con una solicitud de restablecimiento vigente, cambiar la contraseña por
`ESAVI-USER-006` la deja con `invalidatedReason: 'PASSWORD_CHANGED'`, y el enlace responde después
401 `AUTH_007_RESET_TOKEN_INVALIDATED`. Si la contraseña actual no coincide y el `006` falla con
401, la solicitud **sigue vigente**.

**Paso 13 — Suite de contrato.** Ampliar `tests/contract/auth.test.ts` con el recorrido completo,
la indistinguibilidad del `006`, la reutilización, la caducidad y la propagación del paso 12.
Comentario en `tests/auth/roles.test.ts` documentando por qué las dos rutas nuevas no tienen fila
en `ROUTE_RULES`.

*Verificación:* `npm test` en verde con `--runInBand`.

**Paso 14 — Cierre.** `npm run check` — build, lint, `i18n:check` y test.

*Verificación:* los cuatro en verde. Es la puerta de `CLAUDE.md` para cerrar el PR.

---

## 5. Criterios de aceptación

**Esquema y registro**

1. `esaviapp.sql` declara `appPasswordReset` con sus 14 columnas, la FK a `appUser`,
   `UQ_appPasswordReset_tokenHash`, `CK_appPasswordReset_dates` y los índices
   `IX_appPasswordReset_userId` e `IX_appPasswordReset_pending`. La tabla **no** figura en el
   bucle `preventPhysicalDelete`.
2. `TRG_appPasswordReset_setSysDetails` existe en la base sin haberse declarado explícitamente.
3. `references/CONVENTIONS.md` §6 registra `PWDRESET` y las cinco operaciones no canónicas nuevas.

**`ESAVI-AUTH-006` — solicitar**

4. Con un correo de un usuario activo: 200, una fila nueva con `tokenHash` de 64 caracteres
   hexadecimales, `expiresAt` a 30 minutos, y un correo con un enlace
   `?token=<uuid>.<43 caracteres>`.
5. Con un correo inexistente, con el de un usuario inactivo, y con el de un usuario activo: **el
   mismo `status`, el mismo `message` y el mismo cuerpo exacto** en los tres casos. La única
   diferencia observable está en la base y en la bandeja del usuario, no en la respuesta.
6. En ninguno de los tres casos aparece la dirección consultada en `src/logs/esaviLog.log`.
7. Una segunda solicitud del mismo usuario deja la primera con `invalidatedReason: 'SUPERSEDED'` e
   `invalidatedAt` no nulo. Solo queda una fila vigente.
8. Con el SMTP inalcanzable: 200, la fila escrita, y una línea de nivel `error` en el log. El
   cliente no puede distinguir este caso del envío correcto.
9. La sexta solicitud desde la misma IP dentro de 15 minutos recibe la respuesta del limitador.
   Bajo `NODE_ENV=test` el limitador no se monta y la suite no recibe 429.
10. El token en claro no aparece en la respuesta HTTP, ni en `appDetails`, ni en ninguna línea de
    log, en ningún entorno — `NODE_ENV=development` incluido.

**`ESAVI-AUTH-007` — consumir**

11. Recorrido completo: solicitar, consumir, y **autenticarse con la contraseña nueva** por
    `POST /api/auth/login` con 200. La contraseña anterior devuelve 401.
12. Tras el consumo: `usedAt` no nulo en la fila, `requiresPasswordChange` a `false` en `appUser`,
    y todas las sesiones del usuario con `revokedReason: 'PASSWORD_RESET'`.
13. Los cinco rechazos devuelven **401**, nunca 404, con su código propio:
    `AUTH_007_INVALID_RESET_TOKEN` (formato inválido, `resetId` inexistente, hash que no coincide,
    usuario inactivo), `AUTH_007_RESET_TOKEN_USED`, `AUTH_007_RESET_TOKEN_INVALIDATED`,
    `AUTH_007_RESET_TOKEN_EXPIRED`.
14. Los cuatro casos que devuelven `AUTH_007_INVALID_RESET_TOKEN` comparten `message` idéntico. Un
    `resetId` que existe y uno que no son indistinguibles desde el cliente.
15. Presentar un token ya consumido deja **todas** las solicitudes vigentes del usuario con
    `invalidatedReason: 'REUSE_DETECTED'`.
16. Una contraseña nueva idéntica a la vigente se acepta con 200 — no hay `409 SAME_PASSWORD` en
    esta operación.
17. Un fallo forzado en cualquiera de las cuatro escrituras de la transacción deja la contraseña
    sin cambiar, `usedAt` en `NULL` y las sesiones sin revocar. Todo o nada.
18. La respuesta de las dos operaciones es `{ ok, message }` **sin la clave `data`** — ni con la
    fila, ni en `null`, ni vacía.

**Configuración**

19. `POST /api/system-configs/sync` crea las ocho filas; la segunda llamada crea cero.
    `ESAVI_MAIL_SMTP_PASSWORD` está en la columna como `{ "enc": "…" }` y nunca en claro.
20. Con la fila cargada en base **y** la variable de entorno homónima puesta a otro valor, el
    envío usa el valor **de la base**. Sin fila, usa el del entorno. Sin ninguno de los dos, el
    `006` responde 200 y registra el fallo.
21. Cada envío consulta `systemConfig`: dos peticiones consecutivas con un cambio de configuración
    entre ellas usan configuraciones distintas, sin reiniciar el proceso.

**Contrato de update diferencial**

Los cinco criterios de la plantilla se declaran aquí en la forma que les corresponde, porque
**este spec no introduce ninguna operación `004` ni ninguna escritura diferencial**:

22. **Ninguna escritura de este spec invoca `buildDifferentialUpdate`**, y las cinco razones están
    declaradas una a una en la tabla de §3.5.
    `grep -n "buildDifferentialUpdate" src/services/appPasswordReset.service.ts` no devuelve nada,
    y eso es lo correcto.
23. Ninguna de esas escrituras recibe un body cuyo efecto sea dejar una fila «en este estado»:
    `001` es un create, `006` y `007` marcan hechos con su instante y su motivo, y el
    `passwordHash` cambia siempre por la sal de `bcrypt`.
24. **El disparador de toda propagación es la escritura efectiva, nunca la presencia de una clave
    en el body.** Si el `007` falla en cualquiera de sus siete comprobaciones, no se invalida
    ninguna solicitud y no se revoca ninguna sesión. Si `ESAVI-USER-006` falla por contraseña
    actual incorrecta, la solicitud de restablecimiento vigente **sigue vigente** (criterio
    verificado en el paso 12 del plan).
25. `ESAVI-USER-006` **sigue sin ser un update diferencial** por su cuenta, tal como lo entregó el
    SPEC F04 y confirmó el F42 §3.5. Este spec le añade una propagación, no cambia su naturaleza.
26. Los servicios `PWDRESET-006` y `-007` no reescriben filas ya cerradas porque su **filtro** lo
    impide (`usedAt IS NULL AND invalidatedAt IS NULL`), no porque un diff salga vacío. Invocar
    `007` dos veces seguidas devuelve `n` y después `0`.

**Cierre**

27. `npm run check` pasa entero: `build`, `lint`, `i18n:check` y `test`.
28. `tests/auth/roles.test.ts` lleva el comentario que explica por qué `ESAVI-AUTH-006` y `-007`
    no tienen fila en `ROUTE_RULES`.

---

## 6. Decisiones tomadas y descartadas

**Tabla nueva `appPasswordReset`, y no un JWT sin estado.** Se evaluó firmar el token con
`JWT_SECRET + user.passwordHash` como clave derivada: cero cambios de DDL, y el uso único sale
gratis porque al cambiar la contraseña cambia el hash y el token deja de verificar. Se descartó
por tres cosas que no da: no se puede invalidar un enlace antes de que caduque —que es justo lo
que exige la regla «solo el último vale»—, no queda rastro de quién pidió qué ni desde dónde, y
ata la seguridad del restablecimiento a un detalle interno de `bcrypt`. La tabla cuesta un
`CREATE TABLE` que, por ser nueva, no necesita ningún `ALTER TABLE` manual sobre una base ya
desplegada.

**No:** guardar el token en `appUser.sysDetails`. Esa columna la escribe
`TRG_appUser_setSysDetails` en cada `INSERT` y `UPDATE`; meterle datos de aplicación es pelearse
con la base por un sitio donde dejar tres campos.

**No:** reutilizar `appSession`. Sus columnas describen una sesión abierta, y el SPEC F42 la
reserva íntegra. Una autorización efímera para escribir una contraseña no es una sesión.

**`usedAt` e `invalidatedAt` como dos columnas.** Se consideró una sola marca de cierre con su
motivo, al estilo de `revokedAt`/`revokedReason` de `appSession`. Se descartó porque un token
consumido y uno desplazado son estados con consecuencias distintas: solo el primero dispara la
invalidación defensiva del paso 4 del `007`, y colapsarlos borra la distinción exactamente donde
hace falta.

**El envío del correo entra en este spec.** Se evaluó dejar el transporte fuera, con una
implementación de consola y el SMTP real en otro spec. Se descartó a favor de entregar el
mecanismo completo: un «olvidé mi contraseña» sin canal de entrega no es utilizable por nadie, y
partirlo obligaría a un segundo spec cuyo único contenido sería la configuración.

**El SMTP vive en `systemConfig`, no en `.env`.** Es la decisión que más arrastra: convierte a
este spec en el **primer consumidor en ejecución** de una tabla que hasta ahora solo se sembraba
(`src/data/systemConfig.defaults.ts:15-20`). Se aceptó a cambio de poder cambiar el proveedor de
correo sin desplegar, y de estrenar el mecanismo de `isEncrypted` que el F26 construyó y nadie
usaba. La contrapartida es que había que fijar una precedencia, y se fija: **la base gana, el
entorno es el respaldo**, y solo para los ocho códigos de este spec.

**No:** `.env` con `systemConfig` como respaldo, ni fuente única en base. La primera dejaría la
configuración de la base sin efecto mientras existiera la variable, que es la peor forma de tener
dos fuentes. La segunda es más limpia en teoría, pero deja sin salida un entorno donde la base
todavía no tiene las filas sembradas.

**No:** cachear la configuración leída. Obligaría a invalidar la caché desde `ESAVI-SYSCONF-004`,
mecanismo nuevo. Un restablecimiento no es un camino caliente.

**El `006` responde 200 siempre, y el fallo de SMTP también.** Las dos mitades de la misma
decisión. Un `404` cuando la cuenta no existe convierte el endpoint en un inventario de personal
sanitario; un `500` cuando el transporte falla lo convierte en lo mismo por la puerta de atrás,
porque el `500` solo puede ocurrir en el camino donde la cuenta **sí** existe. El fallo de envío
va al log, que es donde lo verá quien puede arreglarlo.

**Se salta `ESAVI-AUTH-005`.** El siguiente número libre tras el F42 era el `005`, y no se usa: en
el canon esa cifra es siempre borrado o activación. Un `ESAVI-AUTH-005` en el log sería el único
`005` del repositorio que no significa eso.

**Formato de token compuesto `<resetId>.<secreto>`, copiado del F42 §3.3.** Se consideró un
secreto plano buscado por `tokenHash` — el `UNIQUE` de la columna lo permitiría. Se descartó
porque obliga a un barrido por índice donde el formato compuesto entra por clave primaria, y
porque dos esquemas de credencial opaca en el mismo repositorio son dos implementaciones de
comparación que mantener.

**El `007` no compara la contraseña nueva con la vigente.** Es la desviación deliberada respecto
de `ESAVI-USER-006`, que sí devuelve `409 SAME_PASSWORD` (`src/services/user.service.ts:439-442`).
Allí la comprobación impide que un cambio vacío limpie `requiresPasswordChange`; aquí quien llega
con un token válido no está eludiendo nada, y el `bcrypt.compare` extra solo le informaría de que
acertó la contraseña vigente — a él o a quien tenga su enlace.

**Dependencia dura del SPEC F42, no blanda.** Se evaluó implementar el F43 solo, dejando la
revocación de sesiones declarada para cuando `appSession` existiera. Se descartó: restablecer la
contraseña de una cuenta comprometida sin cerrar las sesiones del atacante deja el problema
exactamente donde estaba, y un spec que entrega la mitad de una medida de seguridad invita a darla
por hecha.

**`ESAVI-USER-006` también invalida las solicitudes pendientes.** Incorporado durante la
redacción, ampliando el alcance inicial. Sin ello, un usuario que cambia su contraseña
deliberadamente —a menudo porque sospecha algo— deja vivo hasta 30 minutos un enlace de
restablecimiento en una bandeja que quizá no controla.

**Limitador propio sobre el `006`, no sobre el `007`.** El global de `src/app.ts:74` permite 100
peticiones por IP cada 15 minutos, que para un endpoint público que dispara correos es un
amplificador. El `007` no se limita: exige un token válido, y limitarlo castigaría al usuario
legítimo que se equivoca al pegar el enlace.

**Caducidad de 30 minutos, `isEditable: true`.** Suficiente para leer un correo, corto para un
enlace que autoriza a escribir una contraseña. Se deja editable —a diferencia de
`ESAVI_APP_MAX_LIMIT`, que es `false` (`systemConfig.defaults.ts:56`)— porque el plazo razonable
depende del despliegue, y quien puede editarlo ya es SUPERADMIN.

**Plantillas en archivos, no en los JSON de i18n.** `messages.test.ts` exige paridad exacta de
claves en los tres idiomas, y meter HTML dentro de `es.json` lo vuelve ilegible y convierte cada
retoque de maquetación en un cambio de tres archivos de mensajes. El asunto sí es una clave i18n
normal, porque es una línea de texto.

**El idioma del correo sale de `req.lang`.** `appUser` no tiene columna de idioma preferido y este
spec no la añade. La consecuencia declarada: quien solicita el restablecimiento desde un navegador
en inglés recibe el correo en inglés aunque use la aplicación en español.

**Sin validador de `id`.** `CONVENTIONS.md` §4 exige los tres validadores por entidad, y aquí solo
se escriben dos: la regla presupone una entidad con superficie CRUD, y `appPasswordReset` no tiene
ninguna ruta con `:id`. Escribir un `passwordResetIdValidator` que nadie usa es el código muerto
que la propia §4 prohíbe en el párrafo siguiente.

**La tabla queda fuera de `preventPhysicalDelete`.** No es un olvido: es lo que permitirá purgar
solicitudes caducadas más adelante sin volver a tocar el DDL. No se declara `005C` de todas formas
— esta entidad no tiene superficie HTTP en absoluto.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Enumeración por temporización.** El `006` responde igual en los dos casos, pero no tarda igual: el camino con usuario escribe dos veces, confirma la transacción y abre una conexión SMTP; el camino sin usuario devuelve casi al instante. La diferencia es medible desde fuera y reintroduce el oráculo que §3.5 cierra por contenido | **Declarada y no resuelta.** Resolverla exige o bien igualar los tiempos con un retardo artificial —que hay que calibrar y envejece mal—, o bien devolver la respuesta antes de enviar el correo y hacer el envío fuera del ciclo de la petición, que es un mecanismo de trabajo en segundo plano que este repositorio no tiene. El limitador de 5 por IP cada 15 minutos encarece el muestreo estadístico que el ataque necesita, pero no lo impide. Queda como el riesgo abierto principal del spec |
| **El correo es el único factor.** Quien controle la bandeja de entrada de un usuario controla su cuenta en ESAVI, y las cuentas de este sistema son personal sanitario identificable | Inherente al mecanismo pedido. Se acota con la caducidad de 30 minutos, el uso único, la invalidación de la solicitud anterior y la revocación de sesiones al consumir. Un segundo factor está declarado fuera de alcance en §2 |
| **El SMTP sin configurar falla en silencio.** Con las filas de `scope: 'MAIL'` sembradas pero vacías —que es como las deja el `008`— el `006` responde 200 y nadie recibe nada. El usuario ve «recibirá un enlace» y no lo recibe | Es el precio de la decisión de §6 sobre el 200 uniforme. La única señal es la línea `error` de `esaviLog`, así que **cargar las seis filas de `MAIL` con `ESAVI-SYSCONF-004` es parte del despliegue**, no un paso opcional. El criterio 20 lo verifica |
| **Las credenciales SMTP quedan cifradas con `esaviCrypt`, de IV fijo.** Rotar `CRYPTO_KEY` deja la contraseña SMTP ilegible, igual que dejaría ilegibles los correos de `appUser` | Ya es el riesgo transversal del repositorio, no uno nuevo. La rotación de la clave está declarada fuera de alcance en §2 |
| **La suite nunca ejerce el camino SMTP real.** `jsonTransport` serializa sin conectar, así que un error de host, puerto, TLS o autenticación no lo detecta ningún test | Aceptado a cambio de una suite sin red. Se compensa con la verificación manual del paso 6 y con la del paso 10 contra un host muerto. Es la contrapartida conocida de probar correo sin servidor de correo |
| **La tabla crece sin límite.** Sin purga, `appPasswordReset` acumula una fila por solicitud para siempre | Declarado fuera de alcance en §2. El daño es de espacio, no de corrección: `IX_appPasswordReset_pending` es parcial y solo indexa las vigentes, así que las consultas no se degradan con el histórico. La tabla se dejó fuera de `preventPhysicalDelete` precisamente para que la purga futura sea posible |
| **Dependencia dura de un spec en `Borrador`.** El F42 no está aprobado ni implementado, así que este spec no puede empezar | Declarado en el paso 0 del plan. Es una decisión consciente de §6, no un descuido de secuenciación |
| **`deletedAt` sin uso.** La tabla lleva la columna por la convención transversal de las 46 tablas, pero ninguna operación de este spec la escribe | Sin consecuencia funcional. Los filtros de `PWDRESET-006` y `-007` la incluyen (`deletedAt IS NULL`) para que una purga lógica futura no necesite tocarlos |

---

## 8. Impacto en el contrato HTTP

**Dos rutas nuevas. Ninguna ruta existente cambia su contrato.**

| Endpoint | Cambio |
|---|---|
| `POST /api/auth/forgot-password` | **Nuevo.** Público. `{ email }` → `{ ok, message }` |
| `POST /api/auth/reset-password` | **Nuevo.** Público. `{ token, newPassword }` → `{ ok, message }` |
| `PATCH /api/users/password` (`ESAVI-USER-006`) | **Sin cambio de contrato.** Mismo body, misma respuesta, mismos códigos de error. Gana un efecto lateral —invalidar las solicitudes de restablecimiento pendientes— que el cliente no observa |
| `POST /api/auth/login` (`ESAVI-AUTH-001`) | **Sin cambio.** Lo que cambia su respuesta es el SPEC F42, no éste |

El frontend necesita dos pantallas nuevas —solicitar y restablecer— y una ruta pública que lea
`?token=` de la URL y lo mande en el cuerpo del `007`. El valor de `ESAVI_PASSWORD_RESET_URL`
tiene que apuntar a esa ruta.

---

## Lo que **no** está en este spec

- El CRUD de `appPasswordReset`: la tabla no tiene superficie HTTP, ni listado, ni `getById`, ni
  `004`, ni activación.
- La migración general de `.env` a `systemConfig`. Aquí bajan ocho parámetros y se fija la
  precedencia **para esos ocho**. El resto sigue leyéndose del entorno, como declaró el F26 §2.
- La caché de configuración y su invalidación desde `ESAVI-SYSCONF-004`.
- La purga de solicitudes caducadas o consumidas, y el trabajo programado que la ejecutaría.
- La verificación del correo al crear un usuario. `appUser` no tiene columna de verificación y
  este spec no la añade.
- El segundo factor, las preguntas de seguridad y cualquier otro mecanismo de recuperación que no
  sea el correo.
- El correo de aviso «su contraseña cambió» posterior al `007`.
- Cualquier otra plantilla de correo. El transporte queda construido y reutilizable; la plantilla
  declarada es una.
- Que un ADMIN dispare el restablecimiento de otro usuario. Eso sería un código propio en `USER`.
- La columna de idioma preferido en `appUser`.
- La rotación de `CRYPTO_KEY`.
- La mitigación de la enumeración por temporización, declarada como riesgo abierto en §7.
- El SPEC F42 completo: `appSession`, el refresh token y la revocación de sesiones son suyos. Este
  spec los **usa**, no los escribe.
