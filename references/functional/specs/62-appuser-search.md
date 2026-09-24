# SPEC F62 — Búsqueda de usuarios por nombre, correo o usuario

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (autorización y exposición), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` en servicios), SPEC F04 (`appUser`, CRUD y cifrado PII), SPEC F12 (update diferencial), SPEC F47 (modelo de tokens cifrados de nombre, implementado), SPEC F45 (búsqueda de paciente por nombre)
> **Fecha:** 2026-09-22
> **Objetivo:** Permitir que un ADMIN localice a un usuario tecleando una palabra de su nombre, su correo completo o su nombre de usuario, sin romper el cifrado determinista que protege las cinco columnas PII de `appUser`.

---

## 1. Por qué existe este spec

**A — Hoy no hay ninguna forma de encontrar a un usuario que no sea paginar.** `user.routes.ts` declara nueve operaciones y ninguna acepta un criterio de búsqueda. El único filtro que admiten los dos listados es el de paginación: `userListValidator` (`user.validator.ts:17-22`) valida `limit` y `offset`, nada más. Localizar a una persona concreta consiste en recorrer páginas de 100 filas hasta reconocerla.

**B — Y el listado ni siquiera está ordenado por algo que ayude a buscar.** `LIST_ORDER` es `[['createdAt', 'DESC']]` (`user.service.ts:37`), con un comentario que ya explica por qué: *«Alphabetical is impossible: the names are encrypted and ORDER BY would sort by the ciphertext»*. El padrón se recorre de más reciente a más antiguo, que es el peor orden posible para encontrar a alguien por su nombre.

**C — La causa es el cifrado, y no es un defecto: es la protección que el SPEC F04 eligió.** Las cinco columnas por las que uno querría buscar —`username`, `email`, `displayName`, `firstName`, `lastName`, declaradas juntas en `PII_FIELDS` (`user.service.ts:41`)— se guardan cifradas con `esaviCrypt`, AES determinista de IV fijo. El IV fijo concede exactamente una operación: **la igualdad**, y de ahí que `createUserService` pueda comprobar la unicidad del correo con `where: { email: esaviCrypt(normalizedEmail) }` (`user.service.ts:85`). Lo que no concede es nada parcial: sobre un ciphertext no existe `Op.iLike`, ni prefijo, ni orden alfabético. Un `LIKE '%perez%'` contra `appUser` no devuelve cero resultados por error — devuelve cero por construcción.

**D — El mismo problema ya se resolvió una vez en este repositorio, y la solución está implementada.** El [SPEC F47](47-patient-name-model.md) añadió a `patient` la columna `"nameTokens" text[] NOT NULL DEFAULT '{}'` con índice GIN (`esaviapp.sql:701` y `:721`), que guarda cada palabra del nombre cifrada por separado tras pasarla por `toSearchForm`; el [SPEC F45](45-patient-name-search.md) la consume con `Op.contains` conjuntivo y entrega `ESAVI-PATIENT-007`. Los helpers `toSearchForm` y `toNameTokens` ya existen (`stringHandling.helper.ts:127` y `:141`) y no se tocan. Lo que este spec hace es **aplicar a `appUser` un patrón ya probado**, no inventar uno.

**E — La consecuencia práctica de no tenerlo.** Todo lo que un ADMIN hace sobre un usuario —asignarle un rol (`ESAVI-USERROLE-001`), asignarle un ámbito geográfico (`ESAVI-USERGEO-001`), desactivarlo, corregirle el correo— empieza por conocer su `userId`. Sin buscador, ese UUID solo se obtiene paginando o pidiéndoselo a alguien. El `008` es la pieza que falta entre «sé quién es esta persona» y «puedo operar sobre ella».

---

## 2. Alcance

**Dentro:**

- **`ESAVI-USER-008` — `GET /api/users/search`.** Rol mínimo `ADMIN`, el mismo que los dos listados `002A` y `002B`. Es el primer código libre: `001`–`005B` los ocupa el CRUD, `006` es `changePassword` y `007` es `getOwnProfile`.
- **Un único query param `q`**, resuelto por tres vías en una sola consulta con `Op.or`: tokens de nombre, igualdad de correo e igualdad de nombre de usuario. §3.3 detalla la composición.
- **Columna nueva `"nameTokens" text[] NOT NULL DEFAULT '{}'` en `appUser`**, con índice GIN, ambos añadidos a `esaviapp.sql`. Los tokens se mintan **solo desde `firstName` y `lastName`**, cifrados uno a uno, reproduciendo lo que el F47 hizo en `patient`.
- **Alta de los tokens en `ESAVI-USER-001`** y **mantenimiento en `ESAVI-USER-004`**, donde `nameTokens` entra en `candidates` como campo **derivado** y se compara en claro (§3.6).
- **Script de backfill idempotente** bajo `scripts/`, para poblar la columna en las filas ya escritas. Sin él el buscador no encuentra a ningún usuario existente.
- **Coincidencia conjuntiva de tokens** — la fila debe contener **todos** los tokens tecleados, resuelto con `Op.contains` sobre el índice GIN.
- **Guarda del conjunto vacío en el servicio**, además de la del validador: `Op.contains: []` es verdadero para toda fila y convertiría el `008` en un volcado del padrón (§3.4).
- **Respuesta en el formato de listado ya existente** — `{ count, rows }`, con `LIST_EXCLUDE`, `ROLES_INCLUDE`, `LIST_ORDER` y la paginación del `002A`, y las cinco columnas PII descifradas por `toUserResponse`.
- **Resultado vacío es un resultado:** `200` con `count: 0`, nunca `404`.
- **Dos claves i18n nuevas** en `es`, `en` y `nl`, bajo el nodo `user` ya existente (`es.json:54`).
- **Fila nueva en `ROUTE_RULES`** de `tests/auth/roles.test.ts` y casos nuevos en `tests/contract/appUser.test.ts`.

**Fuera de alcance (otros specs, o descartado):**

- **Filtrar por rol, por ámbito geográfico o por `isActive`.** Se evaluó y se dejó fuera: el `008` es solo texto. Las filas inactivas las gobierna `canViewInactive`, como en el resto del repositorio, y un `ADMIN` ya las ve.
- **`inactiveCount`.** El F45 lo necesita porque su endpoint es de rol `USER` y las filas inactivas no le llegan. Aquí el buscador es `ADMIN`, que ya las recibe en `rows`: el campo sería un desglose de `count`, no información nueva.
- **Normalizar `username` a minúsculas.** El `001` lo cifra con solo `.trim()` (`user.service.ts:81`), y `citext` no tiene ningún efecto sobre el ciphertext. La rama de usuario del `008` hereda esa asimetría: `dperalta` no encuentra a `DPeralta`. Queda declarada como limitación conocida en §7 y **no se repara aquí**; arreglarla exige reescribir filas existentes y es un spec propio.
- **Búsqueda por prefijo, difusa o fonética.** `Per` no encontrará a `Pérez`, ni `dperalta@` al correo entero. Es la misma frontera que el F47 §2 declaró y no se reabre: con el nombre cifrado no hay comparación parcial posible.
- **Meter en `nameTokens` las palabras de `username` o la parte local del correo.** Mezclaría en el índice de nombres dos valores que la rama de igualdad ya cubre, y ampliaría la superficie de enumeración sin ganar un caso de uso.
- **Búsqueda por `phone`.** Es la única columna identificatoria en claro de la tabla y por tanto la única donde un `Op.iLike` sería técnicamente posible. Se deja fuera porque no se pidió, y porque nadie busca a una persona por su teléfono en esta aplicación.
- **Ordenación por relevancia.** El `008` conserva `createdAt DESC`. Contar coincidencias exigiría texto en claro y los tokens están cifrados; la forma de refinar es **añadir palabras**, no paginar.
- **Tocar `toSearchForm`, `toNameTokens` o el esquema de cifrado.** El F47 §4 declaró `toSearchForm` intocable y este spec hereda la norma: cambiarla invalida en silencio todos los `nameTokens` escritos, los de `patient` incluidos, y obliga a repoblar las dos tablas.
- **Ampliar el `002A` con el parámetro de búsqueda** en vez de un endpoint nuevo. Se descarta en §6, por la misma razón que el F45 §7.
- **Buscar usuarios desde un rol `USER`**, por ejemplo para asignar un caso. Si ese caso de uso aparece, es un endpoint con su propia proyección reducida, no una rebaja del rol de éste.

---

## 3. Modelo de datos

No hay tabla nueva ni asociación nueva. Hay **una columna nueva** sobre una tabla existente y **una operación de solo lectura** que la consume. Las sub-secciones de la plantilla que describen el alta de una entidad se omiten deliberadamente; en su lugar van tablas Antes/Después.

### 3.1 Tabla origen — `appUser`, `esaviapp.sql:247-268`

Columnas que este spec consulta o escribe, citadas del DDL:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `userId` | `uuid` | no | PK, `gen_random_uuid()` |
| `username` | `citext` | sí | `UQ_appUser_username`. **Cifrada** con `esaviCrypt` tras `.trim()`, sin bajar a minúsculas |
| `email` | `citext` | sí | `UQ_appUser_email`. **Cifrada** tras `normalizeEmail` (`trim` + `toLowerCase`) |
| `firstName` | `text` | sí | **Cifrada** tras `toTitleCase` |
| `lastName` | `text` | sí | **Cifrada** tras `toTitleCase` |
| `displayName` | `text` | no | **Cifrada**. Derivada: `` `${firstName} ${lastName}` `` |
| `nameTokens` | `text[]` | **no, nuevo** | `DEFAULT '{}'`. Tokens cifrados de `firstName` + `lastName` |

Las cuatro columnas transversales están todas presentes: `isActive`, `deletedAt`, `sysDetails` (jsonb) y `appDetails` (jsonb). Ninguna anomalía que resolver antes de implementar.

**Cambio en el DDL — Antes / Después:**

| | Antes | Después |
|---|---|---|
| Columnas | 17, sin ninguna indexable por nombre | 18 — `"nameTokens" text[] NOT NULL DEFAULT '{}'`, declarada tras `lastName` |
| Índices | `IX_appUser_active` (`esaviapp.sql:269`) | + `CREATE INDEX IF NOT EXISTS "IX_appUser_nameTokens" ON "appUser" USING gin ("nameTokens");` |

Los dos son calcados de lo que `patient` ya tiene en `esaviapp.sql:701` y `:721`. **El esquema no lo crea Sequelize**: la columna y el índice se añaden a mano a `esaviapp.sql` y se aplican a la base con el mismo `ALTER TABLE` que el plan de implementación declara en su paso 1.

### 3.2 Modelo Sequelize — `src/models/appUser.model.ts`

Un campo nuevo, declarado igual que en `patient.model.ts:62-66`:

```ts
declare nameTokens?: CreationOptional<string[]>;
```

```ts
nameTokens: {
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: false,
    defaultValue: []
}
```

No cambian `tableName: 'appUser'`, `timestamps: false` ni `freezeTableName: true` (`appUser.model.ts:113-116`), ni se toca ninguna asociación.

### 3.3 Contrato del `008`

```
GET /api/users/search?q=…[&limit=&offset=]
```

`ESAVI-USER-008`, rol mínimo `ADMIN`.

De lo tecleado se derivan **tres valores cifrados independientes**, todos con `esaviCrypt`, cada uno reproduciendo exactamente la normalización con que el `001` escribió su columna — reproducir esa composición es lo único que hace que la comparación cifrado-contra-cifrado encuentre la fila:

| Rama | Se compara contra | Normalización previa, y de dónde sale |
|---|---|---|
| Nombre | `nameTokens` | `toNameTokens(q)` y cada token cifrado, igual que `createUserService` los escribirá (§3.6) |
| Correo | `email` | `normalizeEmail(q)` — `trim` + `toLowerCase`, `user.service.ts:15` |
| Usuario | `username` | `q.trim()`, sin `toLowerCase`, `user.service.ts:81` |

El `where` es una sola disyunción:

```ts
{
    [Op.or]: [
        { nameTokens: { [Op.contains]: encryptedTokens } },
        { email: esaviCrypt(normalizeEmail(q)) },
        { username: esaviCrypt(q.trim()) }
    ],
    ...( canViewInactive ? {} : { isActive: true } )
}
```

**Por qué una disyunción y no una heurística.** Se evaluó discriminar por la forma de `q` —si lleva `@` es un correo, si no es un nombre— y se descartó: un correo tecleado a medias no encontraría nada y la rama de nombre nunca llegaría a ejecutarse para alguien apellidado con una arroba de por medio. Con `Op.or` las tres ramas se evalúan siempre; las dos de igualdad son búsquedas por índice único y su coste cuando no aciertan es despreciable.

**Semántica de cada rama.** La de nombre es **conjuntiva**: `Op.contains` genera `"nameTokens" @> ARRAY[…]`, así que la fila debe contener **todos** los tokens tecleados y puede contener más — un token de más reduce el resultado, nunca lo amplía. Las de correo y usuario son **igualdad exacta sobre el valor completo**; no hay prefijo ni fragmento.

**No hay parámetro `includeInactive`.** La visibilidad de las filas inactivas la decide `canViewInactive(req.user)` en el controlador, como en el `002A`. Un query param sería una segunda vía de decidir lo mismo y las dos podrían discrepar.

Se resuelve con `findAndCountAll`, `attributes: LIST_EXCLUDE`, `include: [ROLES_INCLUDE]`, `order: LIST_ORDER` y la paginación del listado. `LIST_EXCLUDE` excluye `passwordHash` y `sysDetails`; **`nameTokens` se añade a esa exclusión**, porque la columna que gobierna la búsqueda no tiene por qué viajar en la respuesta. Cada fila pasa por `toUserResponse`, que descifra las cinco columnas PII.

### 3.4 El conjunto de tokens vacío, que es la decisión que importa

**`Op.contains: []` es verdadero para toda fila.** `ARRAY[] <@ cualquier array` se cumple siempre, así que una `q` que tokenice a cero elementos no filtra nada: la primera rama de la disyunción se vuelve universal y el `008` devuelve la primera página del padrón de usuarios entero, con un `count` igual al total. Responde `200` con datos bien formados, así que **no se ve como un error** — y es exactamente el volcado que este endpoint no puede permitir.

La regla: **si `toNameTokens(q)` devuelve una lista vacía, el `008` responde `400 USER_008_QUERY_REQUIRED`** con el mensaje `user.searchQueryRequired`, y no ejecuta la consulta. No se degrada a «busca solo por correo y usuario»: una `q` que no produce ni un token tampoco va a coincidir con un correo completo.

**La comprobación vive en dos sitios, y no es redundancia:**

- El **validador** rechaza `q` ausente, vacía o de solo espacios, con el `400` estándar de `validateFields`.
- El **servicio** rechaza lo que el validador es estructuralmente incapaz de ver: una cadena que pasa `notEmpty` y aun así tokeniza a cero elementos. El caso es reproducible con una entrada compuesta solo de marcas diacríticas combinantes, que tiene longitud no nula, sobrevive al `trim()` y queda en cadena vacía al pasar por `toSearchForm`. Es el mismo razonamiento del F45 §3.2, y aquí el riesgo es mayor: lo que se volcaría es el padrón de usuarios con sus roles.

### 3.5 Superficie HTTP

```
POST   /api/users                  ESAVI-USER-001    ADMIN       (existe)
GET    /api/users                  ESAVI-USER-002A   ADMIN       (existe)
GET    /api/users/admin            ESAVI-USER-002B   ADMIN       (existe)
GET    /api/users/me               ESAVI-USER-007    USER        (existe)
PATCH  /api/users/me/password      ESAVI-USER-006    USER        (existe)
GET    /api/users/search           ESAVI-USER-008    ADMIN       (nuevo)
PATCH  /api/users/activate/:id     ESAVI-USER-005B   SUPERADMIN  (existe)
GET    /api/users/:id              ESAVI-USER-003    ADMIN       (existe)
PUT    /api/users/:id              ESAVI-USER-004    ADMIN       (existe)
DELETE /api/users/:id              ESAVI-USER-005A   ADMIN       (existe)
```

**Orden de declaración.** `/search` va **por encima del bloque de `:id`**, junto a `/admin`, `/me` y `/activate/:id`. El archivo ya lleva el comentario que lo explica (`user.routes.ts`): Express capturaría `search` como un `:id`, `userIdValidator` exigiría un UUID y el cliente recibiría un `400` desconcertante en vez de su búsqueda.

**Cadena de middlewares:**

```ts
// Search Users
// Code: ESAVI-USER-008
router.get('/search', tokenValidation, validateUserRole(ADMIN), ...userSearchValidator, ...userListValidator, validateFields, searchUsers);
```

### 3.6 Reglas de negocio por operación

**`ESAVI-USER-008` — buscar (nuevo, solo lectura).**

1. `q`, tras `.trim()`, no puede ser vacía → lo corta el validador con el `400` estándar.
2. `toNameTokens(q)` produce los tokens en claro. Lista vacía → `400 USER_008_QUERY_REQUIRED`, mensaje `user.searchQueryRequired` (§3.4).
3. Se cifran los tres valores y se compone el `Op.or` de §3.3, más `isActive: true` cuando `canViewInactive` es falso.
4. `findAndCountAll` con `LIST_EXCLUDE` (ampliado con `nameTokens`), `ROLES_INCLUDE`, `LIST_ORDER`, `limit` y `offset`.
5. Cada fila pasa por `toUserResponse`. Resultado vacío → `200` con `count: 0`. **Nunca `404`.**
6. **Ninguna ruta del `008` termina en una escritura.** No hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`; §5 lo verifica explícitamente.

Firma del servicio, en `src/services/user.service.ts` junto a `getUsersService`:

```ts
const searchUsersService = async (
    q: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => { /* devuelve { count, rows } */ }
```

**`ESAVI-USER-001` — crear (cambio).** Tras calcular `normalizedFirstName` y `normalizedLastName` (`user.service.ts:79-80`), se escribe también:

```
nameTokens: toNameTokens(normalizedFirstName, normalizedLastName).map(esaviCrypt)
```

Los tokens se mintan de los valores **ya normalizados por `toTitleCase`**, y no del cuerpo crudo, por la misma razón que las columnas PII: normalizar después de cifrar produciría un ciphertext distinto para el mismo valor. `toSearchForm` desacentúa y sube a mayúsculas, así que `Muñoz` y `Munoz` mintan el mismo token `MUNOZ`.

**`ESAVI-USER-004` — actualizar (cambio). Update diferencial, `CONVENTIONS.md` §11.**

`nameTokens` es un campo **derivado**: el cliente nunca lo manda y no existe en `Partial<CreateUserInput>`. Entra en `candidates` **siempre**, calculado desde el `firstName`/`lastName` resultantes del propio diff, y se compara **sobre el array en claro**, antes de cifrar — exactamente como ya se hace con las cinco columnas PII (`user.service.ts:279-307`).

Tabla de `candidates` del `004`, con la fila nueva marcada:

| Campo | Cómo entra en `candidates` | Comparación |
|---|---|---|
| `username` | Presente solo si viaja | En claro contra `esaviDecrypt(user.username)`; se cifra después del diff |
| `email` | Presente solo si viaja, tras `normalizeEmail` | En claro; se cifra después del diff |
| `firstName` | Presente solo si viaja, tras `toTitleCase` | En claro; se cifra después del diff |
| `lastName` | Presente solo si viaja, tras `toTitleCase` | En claro; se cifra después del diff |
| `displayName` | **Derivado.** Solo si viajan los dos nombres | En claro; se cifra después del diff |
| `phone` | Presente solo si viaja, tras `.trim()` | Directa, columna en claro |
| `nameTokens` | **Derivado. Entra siempre**, desde `nextFirstName`/`nextLastName` | **Array en claro** contra `user.nameTokens.map(esaviDecrypt)`, por igualdad de contenido; se cifra token a token después del diff |

**Consecuencia declarada, que es la que hay que verificar:** si el nombre no cambia, los tokens tampoco. Una petición que reenvía el mismo `firstName` y el mismo `lastName` **no produce `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`**. Lo que dispara la escritura es que el valor cambie, no que la clave llegue en el body. Y a la inversa: cambiar `lastName` reescribe `lastName`, `displayName` y `nameTokens` en la **misma** operación, con una sola entrada de auditoría.

**El backfill es la única escritura no diferencial de este spec, y se declara como tal.** El script de §3.8 recorre las filas con `nameTokens = '{}'` y las puebla incondicionalmente: es una corrección de esquema sobre datos ya escritos, no una edición del usuario. **No toca `updatedAt`, no añade entrada a `appDetails` y no emite evento en `sysDetails`** — nadie editó nada; la columna se está estrenando. Su razón: sin él, `Op.contains` sobre un array vacío no encuentra a ningún usuario preexistente y el `008` solo vería a los creados después del despliegue.

### 3.7 Validador y tipos

`userSearchValidator` en `src/validators/user.validator.ts`, exportado por el barrel existente. Se compone en la ruta **junto a** `userListValidator`, que ya cubre `limit` y `offset` — no se duplican.

| Campo | Regla | Mensaje |
|---|---|---|
| `query('q')` | `.trim().notEmpty()` | `Search query is required` |
| `query('q')` | `.isLength({ max: 250 })` | `Search query must be at most 250 characters long` |

El máximo es `250` y no `200`: es la cota que `createUserValidator` ya impone a `email` y a `username` (`user.validator.ts:29,32`), y una `q` más corta que el valor buscable haría inalcanzable el correo más largo que el `001` admite.

**No se declara ningún tipo nuevo, y la ausencia es deliberada.** Con un único parámetro de texto, un `UserSearchInput` sería una envoltura de un `string`; el servicio recibe `q: string`, como ya hace `searchPatientsByNameService` con su `name`.

### 3.8 Backfill de `nameTokens`

Script idempotente en `scripts/`, en la línea de los que ya existen en el repositorio. Recorre `appUser` por páginas, y para cada fila con `nameTokens` vacío descifra `firstName` y `lastName`, mintas los tokens con la misma composición del `001` y escribe la columna. Idempotente por dos vías: filtra por `nameTokens = '{}'` y, aun reejecutado sobre una fila ya poblada, produce el mismo array.

Filas sin `firstName` ni `lastName` —el DDL las permite, ambas son nulables— quedan con `'{}'` y solo son alcanzables por las ramas de correo y usuario. Es correcto: no tienen nombre por el que buscarlas.

### 3.9 Claves i18n

Dos claves nuevas bajo el nodo `user` ya existente (`es.json:54`), en los tres idiomas:

| Clave | Uso |
|---|---|
| `user.searchSuccess` | `200` del `008` |
| `user.searchQueryRequired` | `400 USER_008_QUERY_REQUIRED` (§3.4) |

El `500` reutiliza `user.getFailedPlural`, ya presente (`es.json:65`).

---

## 4. Plan de implementación

Once pasos. Los tres primeros preparan el terreno y no son visibles desde HTTP; el `008` no aparece hasta el paso 8.

**Paso 1 — Esquema: columna e índice.**
Añadir a `esaviapp.sql`, dentro de `CREATE TABLE "appUser"` y tras `"lastName"`, la línea `"nameTokens" text[] NOT NULL DEFAULT '{}',`, y junto a `IX_appUser_active` (`esaviapp.sql:269`) el índice `CREATE INDEX IF NOT EXISTS "IX_appUser_nameTokens" ON "appUser" USING gin ("nameTokens");`. Aplicar sobre la base de desarrollo y sobre la de test el `ALTER TABLE "appUser" ADD COLUMN IF NOT EXISTS "nameTokens" text[] NOT NULL DEFAULT '{}';` equivalente, más el `CREATE INDEX`.
*Verificación:* `\d "appUser"` muestra la columna con su `DEFAULT` y `\di` lista `IX_appUser_nameTokens` como `gin`. Las filas existentes tienen `'{}'`, no `NULL`.

**Paso 2 — Modelo.**
Declarar `nameTokens` en `src/models/appUser.model.ts` como `DataTypes.ARRAY(DataTypes.TEXT)`, `allowNull: false`, `defaultValue: []`, con su `declare nameTokens?: CreationOptional<string[]>` (§3.2).
*Verificación:* `npm run build` compila. Un `AppUser.findOne()` en consola devuelve `nameTokens: []` para un usuario existente.

**Paso 3 — Alta de tokens en `ESAVI-USER-001`.**
En `createUserService` (`src/services/user.service.ts`), escribir `nameTokens` desde `normalizedFirstName` y `normalizedLastName`, cifrando token a token (§3.6). Añadir `nameTokens` a `LIST_EXCLUDE`.
*Verificación:* crear un usuario `Diego Pérez` por el `001` y comprobar en la base que `nameTokens` tiene dos elementos cifrados, que `esaviDecrypt` sobre ellos devuelve `DIEGO` y `PEREZ`, y que la respuesta HTTP del `001` **no** incluye el campo.

**Paso 4 — Mantenimiento de tokens en `ESAVI-USER-004`.**
Añadir `nameTokens` a los `candidates` de `buildDifferentialUpdate` como campo derivado que entra siempre, comparado sobre el array en claro y cifrado después del diff, dentro del bloque que ya trata las cinco columnas PII (`user.service.ts:279-307`).
*Verificación:* tres pruebas manuales sobre el mismo usuario. (a) `PUT` con el mismo `firstName` y `lastName` → `updatedAt` no cambia y `appDetails` no crece. (b) `PUT` cambiando solo `phone` → hay una entrada nueva en `appDetails` y `nameTokens` conserva su valor. (c) `PUT` cambiando `lastName` a `Suing` → una sola entrada en `appDetails`, y `lastName`, `displayName` y `nameTokens` actualizados a la vez.

**Paso 5 — Script de backfill.**
Escribir el script idempotente de §3.8 en `scripts/`, ejecutarlo contra desarrollo.
*Verificación:* reejecutarlo inmediatamente después no modifica ninguna fila. Tras la primera pasada, `SELECT count(*) FROM "appUser" WHERE "nameTokens" = '{}' AND "firstName" IS NOT NULL` devuelve `0`.

**Paso 6 — Claves i18n.**
Añadir `user.searchSuccess` y `user.searchQueryRequired` a `es.json`, `en.json` y `nl.json` (§3.9).
*Verificación:* `npm run i18n:check` pasa. `npm test -- tests/i18n` pasa.

**Paso 7 — Validador.**
`userSearchValidator` en `src/validators/user.validator.ts` con las dos reglas de §3.7, exportado por el barrel.
*Verificación:* `npm run build` compila y el barrel lo exporta.

**Paso 8 — Servicio.**
`searchUsersService` en `src/services/user.service.ts`, con la firma de §3.6: guarda de tokens vacíos (`400 USER_008_QUERY_REQUIRED`) antes de cualquier consulta, `Op.or` de tres ramas, `findAndCountAll` con `LIST_EXCLUDE`, `ROLES_INCLUDE`, `LIST_ORDER` y paginación, y `toUserResponse` por fila.
*Verificación:* invocado desde un test unitario con `q = 'perez'` devuelve la fila creada en el paso 3; con `q = ' '` lanza el `AppError` de código `USER_008_QUERY_REQUIRED`.

**Paso 9 — Controlador.**
`searchUsers` en `src/controllers/user.controller.ts`: desempaqueta `q`, `limit` y `offset` de `req.query`, resuelve `canViewInactive(req.user)`, llama al servicio y responde `{ ok: true, message: getMessage('user.searchSuccess', req.lang), data }`. Bloque `catch` con el idioma del repositorio — `esaviLog` con el código, re-`next()` del `AppError` existente, envoltura en `AppError(..., 500, 'USER_008_FETCH_FAILED', error)` en caso contrario.
*Verificación:* `GET /api/users/search?q=perez` con token ADMIN devuelve `200` con el sobre `{ ok, message, data }` y `data` con `count` y `rows`.

**Paso 10 — Ruta.**
Declarar `GET /search` en `src/routes/user.routes.ts` **por encima del bloque de `:id`**, con la cadena de §3.5 y el comentario del código de operación.
*Verificación:* `GET /api/users/search?q=x` no responde `400 User ID must be a valid UUID` — si lo hiciera, la ruta quedó por debajo del `:id`.

**Paso 11 — Tests.**
Fila nueva en `ROUTE_RULES` de `tests/auth/roles.test.ts` (`GET /api/users/search`, rol mínimo `ADMIN`, código `ESAVI-USER-008`) y casos nuevos en `tests/contract/appUser.test.ts` que cubran los criterios de §5.
*Verificación:* `npm run check` pasa entero — build, lint, `i18n:check` y test.

---

## 5. Criterios de aceptación

**Esquema y tokens**

- [ ] `\d "appUser"` muestra `nameTokens` como `text[] NOT NULL DEFAULT '{}'`, y `\di` lista `IX_appUser_nameTokens` como índice `gin`.
- [ ] Crear por el `001` un usuario `firstName: "  diego  "`, `lastName: "pérez muñoz"` guarda tres tokens cuyo `esaviDecrypt` devuelve `DIEGO`, `PEREZ` y `MUNOZ` — normalizados por `toTitleCase` antes de tokenizar, y desacentuados y en mayúsculas por `toSearchForm`.
- [ ] Ninguna respuesta HTTP incluye `nameTokens`: `grep -n "nameTokens" src/controllers/user.controller.ts` no devuelve resultados y el campo está en `LIST_EXCLUDE`.
- [ ] Reejecutar el script de backfill no modifica ninguna fila: `updatedAt` sigue nulo o con su valor previo en todas ellas, y ninguna ha crecido en `appDetails`.

**Búsqueda — `ESAVI-USER-008`**

- [ ] `GET /api/users/search?q=perez` devuelve `200` con el usuario del criterio anterior; `q=Pérez`, `q=PEREZ` y `q=perez` devuelven el mismo resultado.
- [ ] `q=perez muñoz` devuelve esa fila; `q=perez torres` devuelve `count: 0` — la coincidencia es conjuntiva.
- [ ] `q` con el correo completo del usuario devuelve su fila, con mayúsculas o sin ellas.
- [ ] `q` con el `username` exacto devuelve su fila; con el mismo `username` en otra caja **no** la devuelve, que es la limitación declarada en §7 y no un fallo.
- [ ] Un `q` que no coincide con nada devuelve `200` con `count: 0` y `rows: []`. **Nunca `404`.**
- [ ] `q` ausente, vacío o de solo espacios devuelve `400` por `validateFields`.
- [ ] Un `q` que tokeniza a cero elementos —una cadena de solo marcas diacríticas combinantes— devuelve `400` con código `USER_008_QUERY_REQUIRED`, **no** una página del padrón. Es el criterio que impide el volcado de §3.4.
- [ ] `limit=101` devuelve `400`; `limit=2` sobre tres coincidencias devuelve `count: 3` y dos filas.
- [ ] Con rol `USER` el `008` responde `403`; con `ADMIN` y con `SUPERADMIN`, `200`.
- [ ] Un `ADMIN` ve en `rows` las filas inactivas que coinciden; ningún query param puede alterar esa decisión — `grep -n "includeInactive" src/services/user.service.ts` no la introduce en el `008`.
- [ ] Las filas de la respuesta traen las cinco columnas PII descifradas y **no** traen `passwordHash` ni `sysDetails`.
- [ ] El `008` no escribe: tras diez búsquedas sobre el mismo usuario, `updatedAt`, `appDetails` y `sysDetails` están intactos.

**Update diferencial — `ESAVI-USER-004`**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/user.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `email` o `username` ya ocupado **409**, aunque el resto del body no cambie nada.
- [ ] Un `PUT` que reenvía el `firstName` guardado deja la columna cifrada idéntica byte a byte, y deja `nameTokens` idéntico elemento a elemento.
- [ ] Un `PUT` que cambia `lastName` reescribe `lastName`, `displayName` y `nameTokens` en **una sola** entrada de `appDetails`, y el `008` encuentra al usuario por el apellido nuevo y **deja de encontrarlo** por el anterior.

**Convenciones**

- [ ] Los cinco puntos del código de operación coinciden: comentario en la ruta, comentario en controlador y servicio, `esaviLog`, código del `AppError` (`USER_008_*`). El `008` no escribe, así que no tiene `appDetails.method`.
- [ ] `grep -rn "ESAVI-USER-008" src/` devuelve la ruta, el controlador y el servicio, y ninguna otra entidad usa ese código.
- [ ] `ROUTE_RULES` de `tests/auth/roles.test.ts` incluye `GET /api/users/search` con rol mínimo `ADMIN`.
- [ ] Las dos claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Tokens cifrados con índice GIN, y no las tres alternativas.** Se evaluaron cuatro caminos. *Solo igualdad exacta sobre `email` y `username`* no cuesta ningún cambio de esquema, pero obliga a teclear el correo entero: es resolución de identidad, no búsqueda, y no resuelve «encuéntrame a los Pérez». *Descifrar en memoria y filtrar en Node* se descarta por escrito para que nadie lo reproponga: obliga a traer la tabla entera en cada petición, no pagina y su coste crece con el padrón. *Cambiar a un cifrado que permita comparación parcial* no existe sin renunciar a la protección. Queda el patrón del F47, que además ya está implementado, probado y con helpers compartidos.

**Un único `q`, resuelto con `Op.or`, y no una heurística por la forma del texto.** Discriminar por la presencia de `@` es más barato —dos ramas menos por consulta— pero falla en los dos extremos: un correo tecleado a medias nunca llega a la rama de nombre, y un nombre que contenga una arroba nunca llega a la de correo. Las dos ramas de igualdad atacan índices únicos, así que evaluarlas siempre cuesta poco y hace que el endpoint no tenga que adivinar qué quiso decir el usuario.

**Un único parámetro y no tres (`name`, `email`, `username`).** Tres parámetros trasladan al frontend la decisión de qué tipo de dato tiene en la mano, que es justo lo que el operador no sabe cuando está buscando. Es la misma conclusión a la que llegó el F45 §4 al reducir su búsqueda de paciente a un solo `name`.

**Rol `ADMIN`, y no `USER`.** Todo el CRUD de `appUser` está en `ADMIN`, incluido el listado `002A` — que en el resto del repositorio es `USER`. Conceder al `008` un rol menor que al `002A` sería una puerta lateral: quien no puede listar usuarios tampoco debe poder enumerarlos por apellido. Si aparece el caso de uso de «asignar un caso a un colega», se resuelve con un endpoint propio y una proyección reducida, no rebajando éste.

**Sin `inactiveCount`.** El F45 lo necesita porque su buscador es de rol `USER` y las filas inactivas no le llegan, de modo que sin señal se crea un duplicado. Aquí `canViewInactive` ya es verdadero para `ADMIN`: las filas inactivas vienen en `rows`, y el campo sería un desglose de `count` sin información nueva.

**Sin filtros por rol, ámbito geográfico o `isActive`.** Se ofrecieron y se dejaron fuera: los listados existentes cubren el caso de «ver el conjunto», y el `008` cubre el de «encontrar a una persona». Mezclar las dos cosas convertiría el buscador en un segundo `002A` con criterios propios, duplicando reglas de visibilidad que ya viven en `canViewInactive`.

**Tokens solo desde `firstName` y `lastName`.** Se consideró añadir las palabras del `username` y la parte local del correo al mismo índice. Se descarta: la rama de igualdad ya alcanza esos dos valores por su columna, y meterlos en `nameTokens` ampliaría la superficie de enumeración —bastaría teclear un fragmento de dominio para barrer— sin ganar ningún caso de uso que no estuviera ya cubierto.

**Backfill por script, no al vuelo.** Poblar `nameTokens` la primera vez que cada usuario se actualice deja el padrón a medias por tiempo indefinido, y hace que el resultado de una búsqueda dependa de quién fue editado últimamente — un comportamiento imposible de explicar a un operador. El script se ejecuta una vez, es idempotente y su efecto se comprueba con una consulta.

**El backfill no es diferencial, y se declara.** Escribe incondicionalmente sobre filas existentes. No toca `updatedAt`, no añade entrada a `appDetails` y no emite evento en `sysDetails`, porque nadie editó al usuario: se está estrenando una columna. Registrarlo como edición contaminaría el historial de auditoría de cada usuario del sistema con un evento que no significa nada.

**`nameTokens` entra siempre en `candidates`, pero se compara en claro.** Es lo que separa «derivado» de «se escribe siempre». Entra en cada `004` porque el cliente nunca lo manda y el servicio debe calcularlo; se compara sobre el array descifrado porque comparar ciphertext funcionaría solo por el IV fijo y ataría la corrección del diff a un detalle del esquema de cifrado que el propio `user.service.ts:279` ya advierte que no conviene asumir.

**Endpoint nuevo y no un parámetro del `002A`.** Añadir `?q=` al listado mezclaría dos operaciones con reglas distintas bajo un solo código: el listado devuelve el padrón por defecto, el buscador **nunca** puede devolverlo sin criterio (§3.4). Un código por operación es lo que `CONVENTIONS.md` §6 exige, y separarlas hace que la guarda del conjunto vacío tenga un sitio evidente donde vivir.

**No se normaliza `username` a minúsculas, por ahora.** Es la decisión más incómoda del spec. La asimetría es real —`email` baja a minúsculas, `username` no— y el buscador la hereda. Repararla exige reescribir el ciphertext de la columna en todas las filas y tocar la unicidad del `001`, que es una operación con más riesgo que todo lo demás junto. Se aísla en su propio spec y aquí se documenta en §7.

**Máximo de 250 caracteres para `q`, no 200.** Es la cota que `createUserValidator` ya impone a `email` y `username`. Un límite menor haría inalcanzable por búsqueda el correo más largo que el `001` permite crear.

---

## 7. Riesgos identificados

**R1 — Enumeración por apellido. Aceptado, y es la función pedida.** Un `ADMIN` puede teclear `garcia` y obtener una página de usuarios reales con sus correos y sus roles. No hay forma de conceder «encuentra a los Pérez» sin conceder «enumera a los García». Cuatro cosas lo acotan, todas dentro del alcance: el endpoint exige token y rol `ADMIN`, el mismo que ya puede listar el padrón entero por el `002A`; no hay comodines ni prefijos, así que no se puede barrer probando letras; cero tokens es un `400` y nunca un listado; y `limit` está acotado a 100. La superficie que abre el `008` es **menor** que la que el `002A` ya concede al mismo rol.

**R2 — `username` sensible a mayúsculas.** `dperalta` no encuentra a `DPeralta`, porque el `001` cifra el usuario con solo `.trim()` y `citext` no llega al ciphertext (§3.1). *Mitigación:* el correo sí es insensible, y la rama de nombre cubre el caso habitual; el frontend debe presentar el buscador como «nombre o correo», no como «usuario». *Salida natural:* un spec que normalice `username` en el `001`/`004` y repueble las filas, en la misma pasada.

**R3 — El backfill depende de que `ESAVI_CRYPT_KEY` siga siendo la que cifró las filas.** Si la clave se hubiera rotado en algún momento, `esaviDecrypt` sobre `firstName` devolvería basura y el script mintaría tokens que no coinciden con nada — un fallo **silencioso**: el backfill termina bien y el buscador no encuentra a nadie. *Mitigación:* el script comprueba, antes de escribir, que el `firstName` descifrado de la primera fila es texto legible, y aborta si no lo es. El criterio de §5 que verifica el descifrado de los tokens lo detecta.

**R4 — Un usuario creado sin pasar por `ESAVI-USER-001` es invisible al buscador.** El `seed` de administrador (`src/routes/seed.routes.ts`) y cualquier inserción manual dejan `nameTokens` en `'{}'`, y `Op.contains` no los encuentra por nombre. *Mitigación:* el backfill los cubre en su primera pasada; si la vía de creación alternativa persiste, hay que darle los tokens o aceptar que esos usuarios solo son alcanzables por correo y usuario. Conviene revisarlo al implementar el paso 5.

**R5 — Coste de escritura del índice GIN.** Cada `001` y cada `004` que cambie el nombre actualizan un índice GIN. En una tabla de usuarios —cientos o miles de filas, con escrituras esporádicas— es irrelevante. Se anota porque el mismo patrón sobre `patient`, que crece sin techo, sí merece vigilancia.

**R6 — `toSearchForm` es ahora compartido por dos tablas.** Hasta este spec, cambiarla invalidaba los tokens de `patient`. A partir de aquí invalida también los de `appUser`, y repoblar exige dos scripts. La norma del F47 §4 —`toSearchForm` no se toca— gana un motivo más, y §2 lo declara fuera de alcance explícitamente.

**R7 — Usuarios sin `firstName` ni `lastName`.** El DDL permite ambas nulas. Esas filas quedan con `nameTokens` vacío y solo son alcanzables por correo o usuario. No es un defecto: no tienen nombre por el que buscarlas. Se anota para que no se lea como un fallo del backfill cuando el criterio de §5 cuente filas vacías.

---

## 8. Impacto en el contrato HTTP

**Un endpoint nuevo, ningún contrato existente roto.**

| Operación | Antes | Después |
|---|---|---|
| `GET /api/users/search` | `404` — la ruta no existe | `ESAVI-USER-008`, `200` con `{ ok, message, data: { count, rows } }` |
| `GET /api/users` · `GET /api/users/admin` | `{ count, rows }` | **sin cambios** — `nameTokens` se excluye por `LIST_EXCLUDE` |
| `POST /api/users` | `201` con el usuario | **sin cambios visibles** — los tokens se escriben, no se devuelven |
| `PUT /api/users/:id` | `200` con el usuario | **sin cambios visibles** — los tokens se mantienen, no se devuelven ni se aceptan en el body |

La forma de `data` del `008` es la misma del `002A`: `count`, `rows`, y cada fila con sus roles incluidos y sus columnas PII descifradas. Un cliente que ya consume el listado puede renderizar el resultado de la búsqueda sin cambiar nada.

Códigos de estado del `008`: `200` (incluido el resultado vacío), `400` (`q` ausente, vacía, demasiado larga, o que tokeniza a cero elementos; `limit`/`offset` inválidos), `401` (sin token), `403` (rol menor que `ADMIN`), `500` (`USER_008_FETCH_FAILED`). **No emite `404`.**

---

## Lo que **no** está en este spec

- **Normalizar `username` a minúsculas** en el `001` y el `004`, y repoblar el ciphertext de las filas existentes. Es la causa de R2 y necesita su propio spec: toca la unicidad del alta y reescribe datos cifrados.
- **Filtrar la búsqueda por rol, por ámbito geográfico o por estado.** Ni `?roleId=`, ni `?geoLocationId=`, ni `?isActive=`.
- **Buscar por `phone`**, la única columna identificatoria en claro de la tabla.
- **Búsqueda por prefijo, difusa o fonética**, y cualquier forma de coincidencia parcial sobre un valor cifrado.
- **Ordenación por relevancia** o alfabética. El `008` conserva `createdAt DESC`.
- **Un buscador de usuarios accesible desde el rol `USER`**, con o sin proyección reducida.
- **Auditoría de búsquedas** — quién buscó qué y cuándo. Es la mitigación natural si R1 deja de ser aceptable, y es un spec propio.
- **Tocar `toSearchForm`, `toNameTokens`, `esaviCrypt` o `esaviDecrypt`.**
- **Añadir tokens de nombre a ninguna otra tabla.** `notifier` tiene el mismo problema y no se resuelve aquí.
- **Exponer `nameTokens` en ninguna respuesta**, ni aceptarlo en ningún body.
- **Unificar el buscador de `appUser` con el de `patient`** en un helper compartido. Los dos comparten `toNameTokens` y ahí termina el parecido: distintas columnas, distintos roles, distinta señal de inactivos.
