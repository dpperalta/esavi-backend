# SPEC F55 — Búsqueda de términos MedDRA contra el API oficial

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F26 (`systemConfig`, su catálogo de defaults y el `006` de lectura por `(code, scope)` — implementado)**, **SPEC F43 (`appConfig.helper.ts`, la precedencia «`systemConfig` gana, `.env` es fallback», y `rateLimit.middleware.ts` — implementado)**
> **Fecha:** 2026-09-02
> **Objetivo:** Dar un endpoint de solo lectura que consulte el API oficial de MedDRA y devuelva `{ count, rows }` con `code`, `name` y `termGroup`, configurado íntegramente desde `systemConfig`.

---

## 1. Por qué existe este spec

**A — Hoy solo se puede codificar contra lo que se importó a mano.** El [SPEC F15](./15-diagnosticterm-crud.md) creó `diagnosticTerm` y el [SPEC F17](./17-diagnosticterm-bulk-import.md) el importador de ficheros `.asc` (`ESAVI-DIAGTERM-007`, `src/helpers/meddraParser.helper.ts`). Es un mecanismo de carga masiva: alguien descarga la versión de MedDRA, la sube, y a partir de ahí el catálogo local está congelado hasta la siguiente carga. Quien llena el formulario de notificación no tiene forma de buscar un término que no se importó, ni de saber si existe en la versión vigente del diccionario.

**B — El API oficial ya está resuelto en otro producto y se puede portar.** `references/external/meddra/capture-plugin/` es un plugin de DHIS2 Capture que consulta el API de MedDRA desde el navegador. Su núcleo son cuatro archivos y ninguno pasa de 45 líneas:

- `src/api/auth.js` — OAuth2 `password` grant contra `https://mid.meddra.org/connect/token`, con `client_id: 'mspclient'` y `scope: 'meddraapi'`, y caché del token en memoria con margen de 60 s (`auth.js:32`).
- `src/api/meddra.js` — `POST` al endpoint de búsqueda con el cuerpo de configuración, inyectando solo `searchterms[0].searchterm` (`meddra.js:16-24`).
- `src/config/searchBody.json` — los veinte parámetros de la consulta: `llt: true`, `language: "Spanish"`, `take: 20`, `version: 28`, etc.
- `src/config/dataStoreConfig.js` — lee usuario y contraseña del datastore de DHIS2, no del bundle.

**C — Tres defectos del plugin que este spec no hereda.** Verificados en el archivo:

1. **Las credenciales viajan al navegador.** `.env.example:5` lo dice con todas las letras: *"These values are embedded in the build"*. En el plugin real se corrigió leyéndolas del datastore, pero el `fetch` al API de MedDRA sigue saliendo del cliente. Aquí no: la credencial vive cifrada en `systemConfig` y el único que la ve es el proceso del backend.
2. **La configuración se cachea para siempre.** `dataStoreConfig.js:7-8` guarda `cachedMedDRAConfig` y `cachedSearchBody` en variables de módulo sin TTL. Rotar una credencial exige recargar la página. Aquí la configuración se lee fresca en cada petición, que es la decisión que el [SPEC F43 §3.6](./43-auth-password-reset.md) ya fijó para SMTP.
3. **No hay control de consumo.** El plugin llama al API en cada pulsación pasado el debounce, sin caché de resultados. MedDRA es un diccionario licenciado y de pago: cada llamada cuesta.

**D — La forma de la respuesta no encaja con los campos del formulario.** El API devuelve `{ pcode, name }` —`types.ts:1-4` declara `LLTResult { pcode: string; name: string; [key: string]: unknown }`— y `notificationEvent` guarda `esaviCode` y `esaviName`. La traducción `pcode → code` la hace hoy el componente de React (`MedDRASearchField.js:45`). Este spec la mueve al backend, para que todo consumidor reciba ya la forma que va a guardar.

---

## 2. Alcance

**Dentro:**

- Un endpoint de solo lectura: `GET /api/meddra/search?term=<texto>`, rol mínimo `USER`.
- Ocho entradas nuevas en `src/data/systemConfig.defaults.ts`, todas de `scope: 'MEDDRA'`, dos de ellas cifradas.
- Un lector JSON nuevo en `src/helpers/appConfig.helper.ts`: `getAppConfigJson`.
- Autenticación OAuth2 contra MedDRA con caché de token en memoria del proceso.
- Caché de resultados en memoria del proceso, con TTL de 5 minutos y tope de entradas.
- Derivación del idioma de búsqueda desde `req.lang`, con respaldo en la configuración.
- Derivación de `termGroup` desde las banderas de nivel de la configuración.
- Limitador de peticiones propio para la ruta, en `src/middlewares/rateLimit.middleware.ts`.
- Alta de la abreviatura `MEDDRA` en `references/CONVENTIONS.md` §6.

**Fuera de alcance (otros specs):**

- **Persistir el término seleccionado.** El endpoint no escribe nada en base. Quien elige un término lo guarda por la vía que ya existe: `ESAVI-DIAGTERM-006` (resolver término) y los campos `esaviCode`/`esaviName` de `ESAVI-NOTIFEVT-001`. Cerrar ese circuito —que el `code` de MedDRA aterrice en `diagnosticTerm` con `source: 'MEDDRA'`— es un spec propio.
- **Cruzar los resultados contra `diagnosticTerm`.** Se consideró devolver `diagnosticTermId` cuando el término ya existe localmente. Se descarta: obliga a una consulta por página de resultados y mezcla dos fuentes de verdad en una respuesta de autocompletado.
- **Paginación.** El `take` sale de la configuración y no hay segunda página. Un autocompletado se refina escribiendo más, no paginando.
- **Modo mock.** `src/api/mockData.js` del plugin no se porta. Las pruebas simulan `fetch`.
- **Navegación jerárquica del diccionario** (SOC → HLGT → HLT → PT → LLT), equivalente a lo que el [SPEC F54](./54-whodrug-tree-navigation.md) hizo con WHODrug.
- **Migrar a `systemConfig` el resto de parámetros que aún lee `.env`.** Sigue siendo el spec de configuración que el SPEC F26 §2 dejó pendiente.

---

## 3. Modelo de datos

### 3.1 Tabla origen

**No hay tabla nueva y no se escribe en ninguna existente.** El endpoint es un proxy de lectura contra un API externo.

La única tabla que interviene es `systemConfig` — `esaviapp.sql:390-409` —, y solo por lectura, a través de `getSystemConfigByCodeService` (`ESAVI-SYSCONF-006`). Sus columnas relevantes aquí:

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `code` | `varchar(150)` | no | Mitad de `UQ_systemConfig_code_scope` |
| `scope` | `varchar(100)` | no | La otra mitad; por defecto `GLOBAL`, aquí siempre `MEDDRA` |
| `value` | `jsonb` | no | Con `isEncrypted` en `true` guarda `{ "enc": "<ciphertext>" }` |
| `valueType` | `varchar(50)` | no | `CK_systemConfig_valueType`: `string`, `number`, `boolean`, `json`, `array` |
| `isEncrypted` | `boolean` | no | Inmutable una vez creada la fila |
| `isActive` | `boolean` | no | Una fila inactiva no la resuelve `appConfig.helper.ts` |

Las ocho filas nuevas se siembran con `ESAVI-SYSCONF-008` (`POST /api/system-configs/sync`), que es **solo-inserción**: no pisa lo que ya esté en producción.

### 3.2 Modelo Sequelize

**Ninguno.** No hay tabla propia, luego no hay modelo, no hay archivo en `src/models/associations/` y no se toca `initModels()`.

**Ésta es una desviación declarada de los siete artefactos de `references/CONVENTIONS.md` §1.** El spec entrega seis de los siete —ruta, validador, controlador, servicio, tipos y claves i18n— y omite el modelo por la única razón que lo justifica: no hay fila que mapear. No va a `TECHNICAL_DEBT.md`: no es deuda, es que el artefacto no aplica. El precedente de un dominio sin modelo propio es `src/services/common/mail.service.ts`.

### 3.3 Tipos

Archivo `src/types/meddra/meddra.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.

```ts
// Los cinco niveles del diccionario, en el orden de precedencia de §3.5
export type MeddraTermGroup = 'LLT' | 'PT' | 'HLT' | 'HLGT' | 'SOC';

// Lo que el backend devuelve por fila. Es exactamente lo que consumen los campos
// esaviCode / esaviName de notificationEvent
export interface MeddraSearchRow {
    code: string;
    name: string;
    termGroup: MeddraTermGroup;
}

export interface MeddraSearchResult {
    count: number;
    rows: MeddraSearchRow[];
}

// Lo que el API externo devuelve por fila. `pcode` y `name` son lo único garantizado
// (references/external/meddra/.d2/shell/src/D2App/types.ts:1-4); el resto se ignora
export interface MeddraApiTerm {
    pcode?: unknown;
    name?: unknown;
    [key: string]: unknown;
}

// El cuerpo de ESAVI_MEDDRA_SEARCH_CONFIG. Solo se declaran las claves que el servicio
// lee o reescribe; las demás viajan intactas al API
export interface MeddraSearchConfig {
    searchterms: { searchlogic: number; searchterm: string; searchtype: number }[];
    language?: string;
    llt?: boolean;
    pt?: boolean;
    hlt?: boolean;
    hlgt?: boolean;
    soc?: boolean;
    take?: number;
    [key: string]: unknown;
}
```

No hay `CreateMeddraInput` ni `UpdateMeddraInput`: no se crea ni se actualiza nada.

### 3.4 Superficie HTTP

```
GET /api/meddra/search    ESAVI-MEDDRA-006    USER    (nuevo)
```

**Por qué `006` y no `001`.** `references/CONVENTIONS.md` §6 fija el rango `001`–`005B` para las siete operaciones canónicas de un CRUD y ordena que *"una operación que no sea ninguna de las siete recibe un número propio a partir de `006`"*. Una búsqueda contra un API externo no es ninguna de las siete. El precedente exacto es `healthFacility 006` — búsqueda por nombre o código, `GET /search`, USER. Los códigos `001` a `005B` quedan permanentemente sin usar en esta abreviatura, que es la consecuencia correcta de que `MEDDRA` no sea una entidad.

**Abreviatura nueva:** `MEDDRA` — 6 letras, mayúsculas, sin guiones, y no colisiona con ninguna de las 45 registradas en §6. Se da de alta **antes** de usarse, en la tabla de abreviaturas y en la tabla de operaciones no canónicas.

**Orden de declaración.** La ruta es única y literal; no hay `/:id` que pueda capturarla. Aun así la ruta base `/api/meddra` no monta ninguna otra operación, así que no hay ambigüedad posible.

**Cadena de middlewares**, en este orden exacto:

```
meddraSearchLimiter, tokenValidation, validateUserRole(USER), searchMeddraValidator, validateFields, searchMeddraTerms
```

El limitador va **primero**, por la razón que `src/middlewares/rateLimit.middleware.ts:11-12` ya documenta: un limitador que corre después de la validación ya pagó el coste que existe para evitar.

### 3.5 Reglas de negocio por operación

**`ESAVI-MEDDRA-006` — buscar términos.**

El servicio es `searchMeddraTermsService( term, lang )` en `src/services/meddra.service.ts`. Se ejecuta en este orden y falla en el primer punto que no se cumpla:

**1. Validación de entrada** (en `src/validators/meddra.validator.ts`, antes del servicio). `term` es obligatorio, cadena, `trim`, longitud mínima **3** y máxima **200** → 400 vía `validateFields`. El mínimo de 3 es el mismo que impone el plugin (`useMedDRASearch.js:6`) y existe para que una pulsación suelta no dispare una llamada al API licenciado.

**2. Interruptor general.** `getAppConfigBoolean( 'ESAVI_MEDDRA_ENABLED', 'MEDDRA', lang )`. Si es `false` → **503** `MEDDRA_006_DISABLED`, mensaje `meddra.disabled`. Es un apagado deliberado y el cliente tiene que poder distinguirlo de una avería.

**3. Resolución de la configuración.** Siete lecturas más, todas de `scope: 'MEDDRA'`, todas por `src/helpers/appConfig.helper.ts` y por tanto con la precedencia del SPEC F43: **la fila de `systemConfig` gana, `.env` es el respaldo**.

| Código | Lector | Uso |
|---|---|---|
| `ESAVI_MEDDRA_USERNAME` | `getAppConfigString` | `username` del grant OAuth2 |
| `ESAVI_MEDDRA_PASSWORD` | `getAppConfigString` | `password` del grant OAuth2 |
| `ESAVI_MEDDRA_TOKEN_URL` | `getAppConfigString` | Endpoint del token |
| `ESAVI_MEDDRA_SEARCH_URL` | `getAppConfigString` | Endpoint de búsqueda |
| `ESAVI_MEDDRA_CLIENT_ID` | `getAppConfigString` | `client_id` del grant |
| `ESAVI_MEDDRA_OAUTH_SCOPE` | `getAppConfigString` | `scope` del grant |
| `ESAVI_MEDDRA_SEARCH_CONFIG` | `getAppConfigJson` | Cuerpo de la búsqueda |

`appConfig.helper.ts` lanza `AppError` **500** con código `APPCONFIG_VALUE_MISSING` cuando no hay ni fila usable ni variable de entorno. El servicio lo **captura y lo reemplaza** por **503** `MEDDRA_006_NOT_CONFIGURED`, mensaje `meddra.notConfigured`: que MedDRA no esté configurado no es un fallo del servidor, es un servicio no disponible en este despliegue. Cualquier otro error del resolutor viaja intacto.

**4. Idioma de la búsqueda.** Se deriva de `req.lang` con este mapa, en `src/constants/meddra.constants.ts`:

| `req.lang` | `language` |
|---|---|
| `es` | `Spanish` |
| `en` | `English` |
| `nl` | `Dutch` |

Si `req.lang` no está en el mapa, se usa `searchConfig.language`. Si tampoco está, se usa `English`. El valor derivado **pisa** `searchConfig.language` — es la única clave de la configuración que el servicio reescribe además de `searchterm`.

**5. Nivel del término (`termGroup`).** El API no lo devuelve; lo decide qué bandera está en `true` en la configuración. Precedencia, de lo más específico a lo más general: **`llt` → `pt` → `hlt` → `hlgt` → `soc`**. La primera en `true` gana y su literal en mayúsculas se estampa en **todas** las filas de la respuesta. Con la configuración sembrada (`llt: true`) todas salen `LLT`.

Si **ninguna** está en `true` → **503** `MEDDRA_006_INVALID_SEARCH_CONFIG`, mensaje `meddra.invalidSearchConfig`. Una búsqueda sin nivel no tiene resultados interpretables y es mejor decirlo que devolver filas sin `termGroup`.

**6. Caché de resultados.** Clave: `` `${language}|${term.trim().toLowerCase()}` ``. TTL **300 segundos**. Si hay entrada viva, se devuelve sin tocar el API. La caché es un `Map` de módulo con tope de **500 entradas**: al insertar, se purgan primero las caducadas y, si aún se supera el tope, se descarta la entrada más antigua. El tope existe para que un cliente que teclea sin parar no convierta la caché en una fuga de memoria.

La configuración **no** se cachea. Un cambio en `systemConfig` —apagar el interruptor, rotar la credencial— surte efecto en la siguiente búsqueda que no venga de caché, y como mucho 5 minutos después para un término ya consultado.

**7. Token OAuth2.** `getMeddraAuthToken` en el mismo servicio, con caché de módulo `{ token, expiresAt }`. Se reutiliza mientras `Date.now() < expiresAt`. Al pedirlo: `POST` al `tokenUrl` con `URLSearchParams` de `grant_type=password`, `username`, `password`, `scope` y `client_id`. `expiresAt` se fija en `Date.now() + (expires_in - 60) * 1000`, con `expires_in` por defecto 3600 — el margen de 60 s es el del plugin (`auth.js:32`) y evita usar un token que caduca en vuelo.

Respuesta no 2xx del `tokenUrl` → **502** `MEDDRA_006_AUTH_FAILED`, mensaje `meddra.authFailed`. Además, la caché de token se limpia, para que el siguiente intento no reutilice un token descartado.

**8. Consulta.** `POST` al `searchUrl` con `Authorization: Bearer <token>` y `Content-Type: application/json`. El cuerpo es `searchConfig` **íntegro**, con exactamente dos reescrituras: `searchterms[0].searchterm = term.trim()` y `language`. Ninguna otra clave se pisa y **el cliente no puede alterar ninguna**: no hay parámetros de query más allá de `term`.

Respuesta no 2xx → **502** `MEDDRA_006_SEARCH_FAILED`, mensaje `meddra.searchFailed`.

**9. Tiempo máximo.** Las dos llamadas —token y búsqueda— van con `AbortController` y un tope de **10 000 ms** cada una. Un `AbortError` → **504** `MEDDRA_006_TIMEOUT`, mensaje `meddra.timeout`.

**10. Normalización de las filas.** La respuesta cruda se desenvuelve igual que en `meddra.js:41-42`: si es un array, es la lista; si no, se toma `data.results` y luego `data.data`; si no hay ninguno, lista vacía. Después, por cada elemento:

- `code` = `String( item.pcode ).trim()`. Si `pcode` es `undefined`, `null` o queda vacío, **la fila se descarta en silencio** y no cuenta.
- `name` = `String( item.name ).trim()`. Misma regla.
- `termGroup` = el literal derivado en el punto 5.
- **Duplicados por `code`: gana la primera aparición.** Es el mismo criterio que `meddraParser.helper.ts` aplica al importar el `.asc`.

Una fila descartada nunca aborta la respuesta. Si se descarta alguna, se deja constancia con `esaviLog` en nivel `warn`.

**11. Auditoría.** `esaviLog` con el código de operación en cada camino: `info` al responder, `warn` en filas descartadas, `error` en los 502/503/504. **No hay entrada en `appDetails` ni evento en `sysDetails`**, porque no hay fila que escribir.

#### Contrato de update diferencial

**No aplica: `ESAVI-MEDDRA-006` no escribe sobre ninguna fila.** Es una operación de lectura pura contra un API externo, sin `UPDATE`, sin `updatedAt`, sin `appDetails` y sin `sysDetails`. `references/CONVENTIONS.md` §11 exige declararlo explícitamente en vez de callarlo, y ésta es la declaración: no hay tabla de `candidates` porque no hay nada que comparar, y los cinco criterios de aceptación del bloque de update diferencial no figuran en §5 por la misma razón.

La escritura que corresponde a este flujo —guardar el término que el usuario eligió— la hace el frontend contra `ESAVI-DIAGTERM-006` y `ESAVI-NOTIFEVT-001`, cada uno con su propio contrato diferencial ya especificado.

### 3.6 Claves i18n nuevas

En los **tres** archivos: `src/data/i18n/es.json`, `en.json` y `nl.json`.

| Clave | Uso |
|---|---|
| `meddra.searchSuccess` | 200 — búsqueda resuelta |
| `meddra.disabled` | 503 — `ESAVI_MEDDRA_ENABLED` en `false` |
| `meddra.notConfigured` | 503 — falta credencial, URL o cuerpo de búsqueda |
| `meddra.invalidSearchConfig` | 503 — ninguna bandera de nivel en `true` |
| `meddra.authFailed` | 502 — el endpoint de token respondió no 2xx |
| `meddra.searchFailed` | 502 — el endpoint de búsqueda respondió no 2xx |
| `meddra.timeout` | 504 — se agotaron los 10 s de alguna de las dos llamadas |

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

```
{ ok: true, message, data: {
    count,
    rows: [ { code, name, termGroup } ]
} }
```

`count` es **el número de filas devueltas**, es decir `rows.length` tras descartar las malformadas y los duplicados. No es un total del diccionario ni un total de coincidencias: sin paginación, un total que nadie puede recorrer no informa de nada.

Ejemplo con la configuración sembrada y `?term=fieb`:

```
{ ok: true, message: "Búsqueda de términos MedDRA completada", data: {
    count: 3,
    rows: [
        { code: "10016558", name: "Fiebre", termGroup: "LLT" },
        { code: "10027669", name: "Fiebre Amarilla", termGroup: "LLT" },
        { code: "10037890", name: "Fiebre Tifoidea", termGroup: "LLT" }
    ]
} }
```

Un término sin coincidencias es **200** con `{ count: 0, rows: [] }`, nunca 404: la búsqueda se ejecutó correctamente y su resultado es vacío.

### 3.8 Entradas nuevas del catálogo de configuración

Ocho entradas en `src/data/systemConfig.defaults.ts`, todas de `scope: 'MEDDRA'`. Los `code` se escriben en la forma que produce `toConstantCase`, porque son también el nombre exacto de la variable de entorno de respaldo (`appConfig.helper.ts:60-62`).

| `code` | `valueType` | `value` sembrado | `isEncrypted` | `isEditable` |
|---|---|---|---|---|
| `ESAVI_MEDDRA_ENABLED` | `boolean` | `false` | no | sí |
| `ESAVI_MEDDRA_USERNAME` | `string` | `''` | **sí** | sí |
| `ESAVI_MEDDRA_PASSWORD` | `string` | `''` | **sí** | sí |
| `ESAVI_MEDDRA_TOKEN_URL` | `string` | `'https://mid.meddra.org/connect/token'` | no | sí |
| `ESAVI_MEDDRA_SEARCH_URL` | `string` | `'https://mapisbx.meddra.org/api/search'` | no | sí |
| `ESAVI_MEDDRA_CLIENT_ID` | `string` | `'mspclient'` | no | sí |
| `ESAVI_MEDDRA_OAUTH_SCOPE` | `string` | `'meddraapi'` | no | sí |
| `ESAVI_MEDDRA_SEARCH_CONFIG` | `json` | el cuerpo de `searchBody.json`, con `searchterm: ''` | no | sí |

**`ESAVI_MEDDRA_ENABLED` se siembra en `false` a propósito.** Un despliegue recién sincronizado no debe empezar a llamar a un API licenciado por el hecho de haber corrido `POST /api/system-configs/sync`. Se enciende a mano con `ESAVI-SYSCONF-004`, después de cargar las credenciales.

**Las dos credenciales se siembran vacías y cifradas.** Es el mismo patrón que `ESAVI_MAIL_SMTP_PASSWORD`, con una diferencia declarada: allí el usuario (`ESAVI_MAIL_SMTP_USER`) va en claro y aquí `ESAVI_MEDDRA_USERNAME` va cifrado. La razón es que en MedDRA el usuario **es** el identificador de la licencia y filtrarlo tiene consecuencias contractuales; un usuario SMTP, no.

`ESAVI_MEDDRA_SEARCH_CONFIG` se siembra con el JSON completo de `references/external/meddra/capture-plugin/src/config/searchBody.json`, incluidos `version: 28`, `take: 20`, `llt: true` y `rsview: "release"`. **`version` y `take` no son parámetros de este spec:** viajan dentro del JSON y se cambian editando esa fila, no tocando código.

### 3.9 Lector JSON nuevo en `appConfig.helper.ts`

`getAppConfigString`, `getAppConfigNumber` y `getAppConfigBoolean` ya existen. Falta el cuarto:

```ts
export const getAppConfigJson = async <T>( code: string, scope: string, lang: string ): Promise<T>
```

Resuelve con `resolveAppConfigValue` y después:

- Si el valor ya es un objeto —el camino de `systemConfig`, donde la columna es `jsonb`—, se devuelve tal cual.
- Si es una cadena —el camino de `.env`, que solo puede entregar texto—, se pasa por `JSON.parse`.
- Si el `JSON.parse` falla, o el resultado no es un objeto, lanza `AppError` **500** con `APPCONFIG_VALUE_MISSING`, igual que hace `getAppConfigNumber` con un `NaN`.

Un `null` no es configuración utilizable: `isUsableValue` ya lo descarta antes de llegar aquí.

---

## 4. Plan de implementación

1. **Registrar la abreviatura y la operación.** `references/CONVENTIONS.md` §6: añadir `| meddra | MEDDRA |` a la tabla de abreviaturas registradas y `| meddra | 006 | búsqueda de términos contra el API oficial de MedDRA — USER, GET /api/meddra/search |` a la tabla de operaciones no canónicas.
   *Verificación:* `grep -n "MEDDRA" references/CONVENTIONS.md` devuelve las dos filas nuevas y ninguna colisión con las 45 abreviaturas previas.

2. **Tipos.** `src/types/meddra/meddra.types.ts` con las cinco declaraciones de §3.3, su `index.ts` de barrel y el alta en `src/types/index.ts`.
   *Verificación:* `npm run build` compila e `import { MeddraSearchRow } from '../types'` resuelve.

3. **Constantes.** `src/constants/meddra.constants.ts`: el mapa de idiomas de §3.5 punto 4, el orden de precedencia de banderas de nivel, el TTL de 5 minutos, el tope de 500 entradas de caché, el margen de 60 s del token y el timeout de 10 000 ms.
   *Verificación:* ningún literal mágico de esos seis queda dentro del servicio.

4. **`getAppConfigJson`.** Añadirlo a `src/helpers/appConfig.helper.ts` según §3.9, sin tocar los tres lectores existentes.
   *Verificación:* una fila `json` de `systemConfig` se lee como objeto; una variable de entorno con JSON válido devuelve lo mismo; una con JSON roto lanza 500 `APPCONFIG_VALUE_MISSING`.

5. **Catálogo de configuración.** Las ocho entradas de §3.8 en `src/data/systemConfig.defaults.ts`, y las ocho variables correspondientes en `.env.example`, comentadas y vacías salvo las cuatro que tienen valor por defecto público.
   *Verificación:* `POST /api/system-configs/sync` crea ocho filas de `scope` `MEDDRA`; una segunda llamada las reporta todas en `skipped` y no modifica ninguna.

6. **Claves i18n.** Las siete claves de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` sale en 0.

7. **Servicio.** `src/services/meddra.service.ts` con `searchMeddraTermsService( term, lang )` y las dos cachés de módulo. Implementa los once puntos de §3.5 en ese orden.
   *Verificación:* con `ESAVI_MEDDRA_ENABLED` en `false` lanza `AppError` 503 `MEDDRA_006_DISABLED` sin haber llamado a `fetch` ni una vez.

8. **Limitador.** `meddraSearchLimiter` en `src/middlewares/rateLimit.middleware.ts`, siguiendo la forma de `passwordResetLimiter`: 60 peticiones por IP cada 15 minutos y `passThrough` bajo `NODE_ENV=test`. Sesenta es el techo de un autocompletado usado con normalidad; la caché absorbe la mayoría antes de llegar al API.
   *Verificación:* la petición 61 en la misma ventana responde 429 fuera de test, y la suite no ve ningún 429.

9. **Validador.** `src/validators/meddra.validator.ts` con `searchMeddraValidator` según §3.5 punto 1, registrado en el barrel `src/validators/index.ts`.
   *Verificación:* `?term=fi` responde 400; sin `term`, 400; `?term=fieb` pasa al servicio.

10. **Controlador.** `src/controllers/meddra.controller.ts` con `searchMeddraTerms`. Desenvuelve `req.query.term`, llama al servicio con `req.lang`, responde `{ ok, message: getMessage('meddra.searchSuccess', req.lang), data }`. El bloque `catch` sigue el idioma del repositorio: log con el código de operación, `next()` de un `AppError` existente sin tocarlo, y envoltura en `AppError` nuevo en cualquier otro caso.
   *Verificación:* una respuesta correcta trae el sobre `{ ok, message, data }` y `data` es `{ count, rows }`.

11. **Ruta.** `src/routes/meddra.routes.ts` con la cadena de §3.4, y alta en `src/routes/index.ts` bajo `/api/meddra`.
   *Verificación:* `GET /api/meddra/search` sin token responde 401; con token `ANALYTICS`, 403; con token `USER`, no responde 403.

12. **Suite de roles.** Añadir la fila `ESAVI-MEDDRA-006` a `ROUTE_RULES` en `tests/auth/roles.test.ts` y subir el total esperado de **330 a 331**.
    *Verificación:* `npm test -- roles` pasa, y el `toHaveLength` falla si alguien añade una ruta sin regla.

13. **Suite de contrato.** `tests/contract/meddra.test.ts`. Cubre: 400 por término corto; 503 `MEDDRA_006_DISABLED` con el interruptor apagado —que es el estado natural en `.env.test`—; y el camino feliz con `global.fetch` simulado, comprobando la traducción `pcode → code`, el `termGroup` derivado, el descarte de filas sin `pcode`, el descarte de duplicados y que la segunda llamada al mismo término no vuelve a invocar `fetch`.
    *Verificación:* `npm test -- meddra` pasa y ninguna prueba sale a la red.

---

## 5. Criterios de aceptación

- [ ] `GET /api/meddra/search?term=fieb` con token `USER` responde 200 con `{ ok, message, data: { count, rows } }`.
- [ ] Cada fila de `rows` tiene exactamente tres claves: `code`, `name` y `termGroup`. `grep -n "pcode" src/` no devuelve resultados fuera de `meddra.service.ts`.
- [ ] `count` es igual a `rows.length` en todas las respuestas.
- [ ] Un término sin coincidencias responde **200** con `{ count: 0, rows: [] }`, no 404.
- [ ] `?term=fi` responde **400**; sin `term`, **400**.
- [ ] Con `ESAVI_MEDDRA_ENABLED` en `false` responde **503** con código `MEDDRA_006_DISABLED`, y `fetch` no se invoca.
- [ ] Con el interruptor en `true` y `ESAVI_MEDDRA_PASSWORD` vacío responde **503** `MEDDRA_006_NOT_CONFIGURED`, nunca 500.
- [ ] Con todas las banderas de nivel en `false` responde **503** `MEDDRA_006_INVALID_SEARCH_CONFIG`.
- [ ] Un `fetch` simulado que devuelve 401 en el endpoint de token produce **502** `MEDDRA_006_AUTH_FAILED` y deja la caché de token vacía.
- [ ] Un `fetch` simulado que nunca resuelve produce **504** `MEDDRA_006_TIMEOUT` en ~10 s.
- [ ] Dos búsquedas seguidas del mismo término en el mismo idioma invocan `fetch` **una** vez.
- [ ] Dos búsquedas del mismo término con `?lang=es` y `?lang=en` invocan `fetch` **dos** veces y mandan `language: "Spanish"` y `language: "English"`.
- [ ] El cuerpo enviado al API contiene todas las claves de `ESAVI_MEDDRA_SEARCH_CONFIG` y solo `searchterms[0].searchterm` y `language` difieren de lo configurado.
- [ ] Una respuesta del API con dos filas del mismo `pcode` produce **una** fila; una fila sin `pcode` no aparece y no rompe la respuesta.
- [ ] `POST /api/system-configs/sync` crea las ocho filas de `scope` `MEDDRA`; una segunda llamada no modifica ninguna.
- [ ] `ESAVI_MEDDRA_USERNAME` y `ESAVI_MEDDRA_PASSWORD` se guardan como `{ "enc": "..." }`; `ESAVI-SYSCONF-003` no las devuelve en claro a un rol por debajo de SUPERADMIN.
- [ ] Los cinco lugares del código de operación coinciden — con la salvedad de `appDetails.method`, que aquí no existe porque la operación no escribe: ruta, controlador, servicio, `AppError` y `esaviLog` llevan `ESAVI-MEDDRA-006`.
- [ ] `grep -rn "ESAVI-MEDDRA-00[1-5]" src/` no devuelve resultados.
- [ ] `MEDDRA` está registrada en las dos tablas de `references/CONVENTIONS.md` §6.
- [ ] Las siete claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 331 entradas y la suite de roles pasa.
- [ ] `npm run check` sale en 0.

**El bloque de cinco criterios de update diferencial no aplica y se omite deliberadamente**, por lo declarado en §3.5: la operación no escribe sobre ninguna fila. En su lugar:

- [ ] Una búsqueda completa no ejecuta ningún `INSERT` ni `UPDATE`: `grep -n "\.create(\|\.update(\|\.save(" src/services/meddra.service.ts` no devuelve resultados.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** proxy de solo lectura, sin tocar `diagnosticTerm`. Mezclar la búsqueda externa con la resolución local haría que un autocompletado escribiera filas en base a cada pulsación, y crearía términos por errores de tecleo.
- **No:** enriquecer cada fila con su `diagnosticTermId` local. Obliga a una consulta por página de resultados y mete dos fuentes de verdad en la misma respuesta. Si hace falta, es un spec propio.
- **Sí:** `systemConfig` con respaldo en `.env`, reutilizando `appConfig.helper.ts`. Es la precedencia que el SPEC F43 ya fijó y no hay razón para que MedDRA invente otra.
- **No:** leer las credenciales solo de `.env`. Rotar una credencial exigiría un despliegue, y el mecanismo de fila cifrada ya existe y está probado con SMTP.
- **Sí:** **503** cuando está apagado o sin configurar. El cliente tiene que poder distinguir «este despliegue no tiene MedDRA» de «MedDRA no encontró nada», y un 200 vacío borra esa diferencia.
- **No:** responder 200 con `rows: []` cuando el API externo falla. Escondería una avería detrás de una respuesta que parece correcta, y el usuario reescribiría el término creyendo que no existe.
- **Sí:** `006` como número de operación. §6 lo ordena para lo que no es ninguna de las siete canónicas, y `healthFacility 006` es el precedente exacto.
- **No:** `001`, aunque sea el primer y único endpoint del dominio. `001` significa create en todo el repositorio, y un `GET` con ese código rompería la lectura de cualquier log.
- **Sí:** `client_id` y `scope` OAuth2 configurables, pese a llevar años sin cambiar. Cuando cambien, cambiar una fila es más barato que desplegar.
- **Sí:** `language` derivado de `req.lang`, con la configuración como respaldo. Un backend trilingüe que devuelve siempre términos en español obligaría al frontend a mostrar un idioma que el usuario no eligió.
- **No:** exponer overrides de `searchBody` por query. Abrir `version`, `llt` o `take` al cliente convierte un endpoint en una consola del API de MedDRA, y el consumo se paga por licencia.
- **Sí:** caché de resultados de 5 minutos con tope de 500 entradas. Es la diferencia entre una llamada por término y una por pulsación, sobre un API de pago.
- **No:** cachear la configuración, aunque el plugin lo haga (`dataStoreConfig.js:7-8`). Apagar el interruptor o rotar una credencial tendría que esperar a un reinicio, y eso convierte `ESAVI_MEDDRA_ENABLED` en un adorno.
- **Sí:** `termGroup` derivado de las banderas de la configuración. El API no lo devuelve y el campo tiene que salir de algún sitio verificable.
- **No:** `termGroup` fijo en `'LLT'`. Funcionaría hoy, y mentiría el día que alguien ponga `pt: true` en la configuración, que es exactamente el día en que nadie miraría este código.
- **No:** devolver un campo `id`. `MedDRASearchField.js:45` hace `result.id || result.pcode` precisamente porque el API no garantiza `id`. En MedDRA el `pcode` **es** el identificador del término, y `diagnosticTerm` identifica por el par `(source, code)`, no por un id del proveedor.
- **No:** portar el modo mock del plugin. Un interruptor que hace que el backend invente datos clínicos es un riesgo que no compensa; las pruebas simulan `fetch`, que es donde debe estar la costura.
- **Sí:** descartar en silencio las filas malformadas. Una fila sin `pcode` no debe tumbar una búsqueda que devolvió otras diecinueve correctas. Queda el `warn` en el log.
- **No:** paginación. Es un autocompletado: el `take` de la configuración lo acota y el usuario refina escribiendo más.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un cambio en `ESAVI_MEDDRA_SEARCH_CONFIG` no se refleja en términos ya cacheados | El TTL de 5 minutos acota la ventana. La configuración no se cachea, así que el desfase afecta solo a términos ya consultados y nunca al interruptor de encendido para un término nuevo |
| La caché vive en memoria del proceso: con varias instancias, cada una tiene la suya | Aceptado. La caché es una optimización de coste, no una fuente de verdad; el peor caso es N llamadas al API en vez de una |
| El token cacheado se invalida en el lado de MedDRA antes de su `expires_in` | El 502 `MEDDRA_006_AUTH_FAILED` limpia la caché de token, así que el siguiente intento pide uno nuevo en vez de reintentar con el descartado |
| Las credenciales aparecen en un log si alguien vuelca el objeto de configuración | El servicio nunca registra el objeto resuelto. Solo se registran el código de operación, el término y el número de filas |
| `ESAVI_MEDDRA_ENABLED` se enciende en un despliegue sin credenciales y cada búsqueda sale al API para fallar | El 503 `MEDDRA_006_NOT_CONFIGURED` se resuelve **antes** de cualquier `fetch`: la configuración se valida en el punto 3, y las llamadas ocurren en los puntos 7 y 8 |
| `URLSearchParams` con `client_id` y `scope` configurables permite inyectar parámetros si alguien escribe basura en la fila | `URLSearchParams` codifica sus valores; un valor con `&` viaja escapado y no añade parámetros. La fila la escribe un SUPERADMIN por `ESAVI-SYSCONF-004` |

---

## Lo que **no** está en este spec

- Persistir el término elegido en `diagnosticTerm` o en `notificationEvent`.
- Cruzar los resultados contra el catálogo local para devolver `diagnosticTermId`.
- Paginación de resultados.
- Navegación jerárquica del diccionario MedDRA (SOC → HLGT → HLT → PT → LLT).
- Modo mock del API.
- Overrides de `searchBody` por query string.
- Caché compartida entre instancias.
- Migrar a `systemConfig` los parámetros que aún se leen de `.env` fuera del `scope` `MEDDRA`.

Cada uno de esos, si aterriza, va en su propio spec.
