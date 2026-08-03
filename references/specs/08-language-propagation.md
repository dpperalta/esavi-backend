# SPEC 08 — Idioma efectivo: resolución y propagación

> **Estado:** Borrador
> **Depende de:** SPEC 03 (paridad i18n; sin ella, propagar el idioma solo reparte cadenas vacías)
> **Fecha:** 2026-08-02
> **Objetivo:** Que la respuesta salga en el idioma que pidió el cliente, y que `DEFAULT_LANGUAGE` valga lo que dice el `.env`.

Cubre dos hallazgos **no catalogados**, detectados al verificar el SPEC 03 el 2026-08-02. El paso 1 los registra como **DEUDA-036 y DEUDA-037** en [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

---

## 1. Por qué existe este spec

El SPEC 03 garantizó que las 126 claves existen en los tres idiomas. No garantizó que se use el idioma correcto. Son dos fallos distintos, ambos silenciosos, ambos verificados en caliente contra la API corriendo con `DEFAULT_LANGUAGE=es`:

**Hallazgo A — `DEFAULT_LANGUAGE` del helper siempre vale `'en'`.**
`i18n.helper.ts:13` lee `process.env.DEFAULT_LANGUAGE` al cargar el módulo. Los `import` de `src/index.ts` se hoistean, así que la cadena `index.ts → routes → controllers → helpers` ejecuta ese módulo **antes** de la línea 19, donde `dotenv.config()` puebla el entorno. El operador `|| 'en'` se queda con la rama derecha en todos los arranques.

```
POST /api/auth/login?lang=es   (JSON malformado)
→ 500 {"message":"Internal server error. Please try again later."}
```

El `.env.development` dice `DEFAULT_LANGUAGE=es`. La respuesta sale en inglés. No es un fallo de la clave: es que el idioma por defecto del helper nunca fue el configurado.

Esto convierte en trampa el fallback que instaló el SPEC 03: el nivel 2 de la cadena cae a `'en'`, no al idioma que el equipo cree haber configurado.

**Hallazgo B — el idioma se pierde entre el controlador y el servicio.**
`languageMiddleware` resuelve `req.lang` correctamente, pero de ahí en adelante hay tres fugas:

1. Diecinueve funciones de servicio declaran `lang: string = 'en'` — un literal, no `DEFAULT_LANGUAGE`. Si el controlador olvida pasarlo, el idioma no cae al configurado: cae a inglés.
2. `loginService` (`auth.service.ts:17`) no recibe `lang` en absoluto, y `loginController` no se lo pasa. Todo el flujo de autenticación responde siempre en un solo idioma.
3. Tres llamadas invocan `getMessage(clave)` sin segundo argumento: `auth.service.ts:32`, `auth.service.ts:36` y `geoLocation.service.ts:140`.

```
POST /api/auth/login?lang=es   (credenciales inválidas)
→ 401 {"message":"Invalid email or password. Please try again."}
```

El cliente pidió español y `req.lang` valía `es`. El mensaje sale en inglés porque nunca llegó al servicio.

Los dos hallazgos se combinan: un endpoint que sí propaga el idioma funciona, y uno que no lo propaga responde en inglés — no en el idioma por defecto, sino en inglés — sin que ninguna prueba lo distinga de un fallback legítimo.

---

## 2. Alcance

**Dentro:**

- `DEFAULT_LANGUAGE` deja de depender del orden de importación: el helper lo resuelve en el momento de la llamada, no al cargar el módulo.
- `DEFAULT_LANGUAGE` se valida contra `SUPPORTED_LANGUAGES` al arrancar; un valor no soportado detiene el arranque en vez de degradar en silencio.
- El literal `'en'` desaparece como valor por defecto de `lang` en las firmas de servicio.
- `loginService` recibe `lang` y `loginController` se lo pasa.
- Las tres llamadas a `getMessage(clave)` sin idioma pasan a recibirlo.
- Todo controlador que llame a un servicio con mensajes le pasa `req.lang`.
- `scripts/i18n-check.js` gana un cuarto bloque que detecta las tres formas de fuga y sale con 1 si reaparecen.

**Fuera de alcance (otros specs):**

- Extraer la carga del entorno a `src/config/env.ts` y ordenar el arranque — es estructura de proyecto, va con el SPEC 07.
- Los demás módulos que leen `process.env` al cargar; `roles.constants.ts` ya está catalogado en [DEUDA-031](../TECHNICAL_DEBT.md#deuda-031) y lo corrige el SPEC 01.
- El `getCatalogItemByIdService` duplicado en `healthFacility.service.ts:145` — [DEUDA-022](../TECHNICAL_DEBT.md#deuda-022), SPEC 06.
- Traducir los `withMessage(...)` de los validadores, que no pasan por `getMessage`.
- Añadir idiomas.

---

## 3. Modelo de datos

No hay tablas nuevas ni claves nuevas. Cambian firmas y el momento en que se lee una variable de entorno.

### `DEFAULT_LANGUAGE` resuelto en tiempo de llamada

| Antes | Después |
|---|---|
| `const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE as lang \|\| 'en'` en el cuerpo del módulo | una función `getDefaultLanguage()` que lee `process.env` en cada llamada y cae a `'es'` |

El literal de reserva pasa a `'es'`, que es el idioma de la aplicación y el que ya tienen los tres `.env`. Si el entorno está bien cargado, el literal no se usa nunca; si no lo está, el fallo es menos sorprendente.

La firma pública de `getMessage` no cambia. El valor por defecto del parámetro `lang` deja de ser una constante de módulo y pasa a resolverse dentro de la función.

### Validación al arranque

`startServer()` verifica, antes de escuchar, que `DEFAULT_LANGUAGE` esté dentro de `SUPPORTED_LANGUAGES`. Si no lo está, registra el fallo con `esaviLog` y sale con código 1, igual que hace hoy `resolveCorsOrigins()` con `CORS_ORIGINS`.

### Firmas de servicio

| Antes | Después |
|---|---|
| `lang: string = 'en'` (19 funciones) | `lang: string` — parámetro requerido |
| `loginService({ email, password })` | `loginService({ email, password }, lang)` |
| `getMessage('auth.invalidCredentials')` | `getMessage('auth.invalidCredentials', lang)` |

Hacer `lang` requerido es deliberado: convierte cada fuga futura en un error de compilación en vez de en una respuesta en el idioma equivocado. `npm run build` pasa a ser la prueba.

`entityActivation.service.ts` declara `lang?: string` dentro de un objeto de parámetros; pasa a requerido igual que el resto.

---

## 4. Plan de implementación

El paso 2 va antes que el 3 a propósito: con el helper ya arreglado, las rutas que sí propagan el idioma quedan correctas de inmediato, y las que no lo propagan pasan a responder en español en vez de en inglés. El sistema mejora antes de estar completo.

1. **Registrar la deuda.** Añadir DEUDA-036 (`DEFAULT_LANGUAGE` leído antes de `dotenv`) y DEUDA-037 (el idioma no llega al servicio) a `TECHNICAL_DEBT.md`, con su fila en la tabla resumen y su sección de detalle.
   *Verificación:* ambas entradas enlazadas desde la tabla.

2. **Resolver `DEFAULT_LANGUAGE` en tiempo de llamada.** Sustituir la constante de módulo de `i18n.helper.ts` por `getDefaultLanguage()`, usada tanto en el valor por defecto del parámetro como en el nivel 2 de la cadena de fallback.
   *Verificación:* con `DEFAULT_LANGUAGE=es`, un error sin `req.lang` responde en español.

3. **Validar al arranque.** En `startServer()`, comprobar que `DEFAULT_LANGUAGE` pertenece a `SUPPORTED_LANGUAGES`; si no, `esaviLog` y `process.exit(1)`.
   *Verificación:* `DEFAULT_LANGUAGE=xx` impide arrancar con un mensaje claro.

4. **`lang` requerido en los servicios.** Quitar el `= 'en'` de las 19 firmas y de `entityActivation.service.ts`. Compilar y corregir cada punto donde el compilador señale que falta el argumento.
   *Verificación:* `grep -rn "lang: string = " src/services/` sin resultados y `npm run build` en 0.

5. **Autenticación.** `loginService` recibe `lang`; `loginController` le pasa `req.lang`; las dos llamadas de `auth.service.ts` y la de `geoLocation.service.ts:140` pasan el idioma.
   *Verificación:* `POST /api/auth/login?lang=nl` con credenciales inválidas responde en neerlandés.

6. **Guardia en `i18n-check`.** Cuarto bloque en `scripts/i18n-check.js`: falla si encuentra `lang: string = '…'` en `src/services/`, si encuentra `getMessage(` con un solo argumento fuera de `src/helpers/`, o si `i18n.helper.ts` vuelve a leer `process.env.DEFAULT_LANGUAGE` en el cuerpo del módulo.
   *Verificación:* `npm run i18n:check` sale con 0; sale con 1 si se restaura a mano un `= 'en'` en cualquier firma.

---

## 5. Criterios de aceptación

- [ ] `grep -rn "lang: string = " src/services/` no devuelve resultados.
- [ ] `grep -rn "= 'en'" src/` no devuelve resultados fuera de los archivos de i18n.
- [ ] `i18n.helper.ts` no lee `process.env` en el cuerpo del módulo.
- [ ] Con `DEFAULT_LANGUAGE=xx` (no soportado), el servidor no arranca y deja el motivo en `esaviLog`.
- [ ] `POST /api/auth/login?lang=nl` con credenciales inválidas devuelve el mensaje en neerlandés.
- [ ] `POST /api/auth/login?lang=es` con credenciales inválidas devuelve el mensaje en español.
- [ ] Un error interno sin `req.lang` (JSON malformado) responde en `DEFAULT_LANGUAGE`, no en inglés.
- [ ] `GET /api/geo-locations/:id` inexistente con `?lang=nl` responde en neerlandés.
- [ ] Un endpoint de cada entidad —geoLevelType, geoLocation, catalogType, catalogItem, healthFacility— responde en el idioma pedido con `?lang=nl`.
- [ ] `npm run i18n:check` sale con 0, y con 1 si se restaura un `lang: string = 'en'`.
- [ ] `npm run build` compila sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** resolver `DEFAULT_LANGUAGE` en cada llamada. Es una lectura de `process.env`, no un coste medible, y elimina la dependencia del orden de importación sin reordenar el arranque.
- **No:** mover `dotenv.config()` a un módulo importado primero. Arregla este caso, pero deja el patrón intacto: el siguiente módulo que lea el entorno al cargarse vuelve a romperse según dónde se importe. Además la reestructuración del arranque ya es del SPEC 07.
- **Sí:** `lang` requerido en las firmas de servicio. Un parámetro opcional con valor por defecto es exactamente lo que dejó pasar este bug durante meses; requerido, el compilador lo detecta.
- **No:** que los servicios reciban el `Request` entero para sacar `lang`. Rompe la separación que fija el canon: los servicios no conocen HTTP.
- **Sí:** el literal de reserva pasa de `'en'` a `'es'`. Si alguna vez se usa, que coincida con el idioma de la aplicación.
- **Sí:** detener el arranque ante un `DEFAULT_LANGUAGE` no soportado. Es la misma política que ya se aplica a `CORS_ORIGINS` y a las variables `DB_*`.
- **No:** traducir los `withMessage(...)` de los validadores en este spec. Son otro mecanismo —no pasan por `getMessage`— y mezclarlos duplicaría el tamaño del cambio.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Hacer `lang` requerido rompe la compilación en muchos puntos a la vez | Es el objetivo: el compilador enumera exactamente las fugas. El paso 4 se cierra cuando `npm run build` sale en 0 |
| Un despliegue con `DEFAULT_LANGUAGE` mal escrito deja de arrancar donde antes degradaba | Deliberado, y el mensaje de `esaviLog` nombra la variable y los valores admitidos |
| Clientes que hoy reciben inglés empiezan a recibir español | Es la corrección, no un efecto colateral; conviene avisar a los consumidores de la API |
| El bloque nuevo de `i18n-check` da falsos positivos por regex | Se limita a `src/services/`, excluye `src/helpers/`, y las excepciones legítimas se resuelven pasando el idioma, no relajando el patrón |

---

## 8. Impacto en el contrato HTTP

| Caso | Antes | Después |
|---|---|---|
| Login con credenciales inválidas y `?lang=es` | mensaje en inglés | **en español** |
| Login con credenciales inválidas y `?lang=nl` | mensaje en inglés | **en neerlandés** |
| Error interno sin `req.lang` | mensaje en inglés | **en `DEFAULT_LANGUAGE`** |
| `geoLocation.notFound` desde `geoLocation.service.ts:140` | mensaje en inglés | **en el idioma pedido** |
| Arranque con `DEFAULT_LANGUAGE` no soportado | arranca y responde en inglés | **no arranca** |

Ningún código de estado ni ninguna forma de respuesta cambia. Solo el idioma del campo `message`.

---

## Lo que **no** está en este spec

- Reordenar el arranque o extraer `src/config/env.ts` (SPEC 07).
- Los demás módulos que leen `process.env` al cargarse (SPEC 01 para `roles.constants.ts`).
- Traducir los `withMessage(...)` de los validadores.
- Eliminar el `getCatalogItemByIdService` duplicado (SPEC 06).
- Añadir un cuarto idioma.

Cada uno de esos, si aterriza, va en su propio spec.
