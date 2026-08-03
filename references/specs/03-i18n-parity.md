# SPEC 03 — Integridad y paridad de los mensajes i18n

> **Estado:** Aprobado
> **Depende de:** —
> **Fecha:** 2026-08-01
> **Objetivo:** Que ninguna respuesta salga con `message` vacío, en ninguno de los tres idiomas soportados.

Cubre las entradas **DEUDA-003 y DEUDA-004** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Tercer spec de la serie de seis que salda la deuda técnica catalogada a 2026-07-31.

---

## 1. Por qué existe este spec

`getMessage` devuelve cadena vacía cuando la clave no existe. No lanza, no registra nada y no cae a otro idioma. El resultado es que tres claves mal escritas llevan meses devolviendo `message: ""` al cliente sin que nada lo delate, y que `nd` —con 23 de 124 claves— hace lo mismo en 101 respuestas.

Corregir las claves sin corregir el helper deja la trampa armada para la siguiente. Este spec hace las dos cosas.

---

## 2. Alcance

**Dentro:**

- Las 3 claves rotas de DEUDA-003 resuelven a texto en los tres idiomas.
- `getMessage` deja de devolver cadena vacía: cae a `DEFAULT_LANGUAGE`, luego a la propia clave, y registra el fallo con `esaviLog`.
- `nd.json` → `nl.json`, con `SUPPORTED_LANGUAGES=es,en,nl`.
- Paridad completa: los tres archivos con las mismas 126 claves.
- Un script `scripts/i18n-check.js` que compara los tres archivos contra las claves referenciadas en `src/` y sale con código 1 si hay divergencia.

**Fuera de alcance (specs siguientes):**

- Eliminar las 43 claves definidas y nunca usadas. Se conservan: son el set canónico de las siete operaciones (sección 13 del canon) y `healthFacility` todavía no tiene endpoints de update, delete ni activate.
- Enganchar el script a un hook de pre-commit o a CI — SPEC 07 (tooling).
- Traducir los `withMessage(...)` de los validadores, que hoy son literales en inglés y no pasan por `getMessage`.
- Los mensajes de `esaviLog`, que son de operación y no de cliente.

---

## 3. Modelo de datos

No hay tablas nuevas. Cambian tres archivos de mensajes y el código de idioma.

### Las tres claves rotas

| Referencia actual | Archivo | Corrección |
|---|---|---|
| `auth.loginFailed` | `auth.controller.ts:21` | **clave nueva** en los tres JSON |
| `catalogItem.updateFailed` | `catalogItem.controller.ts:110` | se corrige el **código** a `updatedFailed`, que ya existe y es la forma canónica (sección 13) |
| `facilityType.notFound` | `healthFacility.service.ts:35` | se corrige el **código** a `healthFacility.facilityTypeNotFound`, **clave nueva** |

Dos claves nuevas, en los tres archivos, en el mismo commit:

```json
"auth": { "loginFailed": "No se pudo completar el inicio de sesión" },
"healthFacility": { "facilityTypeNotFound": "El tipo de establecimiento no existe o está inactivo" }
```

Total tras el spec: **126 claves × 3 idiomas**.

### Código de idioma

| Antes | Después |
|---|---|
| `src/data/i18n/nd.json` | `src/data/i18n/nl.json` |
| `SUPPORTED_LANGUAGES=es,en,nd` | `SUPPORTED_LANGUAGES=es,en,nl` |
| `import nd from ...` en `i18n.helper.ts` | `import nl from ...` |

`nd` es ndebele del norte en ISO 639-1. El idioma real es neerlandés, cuyo código es `nl`; hoy un `Accept-Language: nl` estándar no resuelve.

### Nuevo comportamiento de `getMessage`

```ts
// 1. clave en el idioma pedido      → se devuelve
// 2. clave en DEFAULT_LANGUAGE      → se devuelve, se registra warn
// 3. no existe en ningún idioma     → se devuelve la propia clave, se registra error
```

`i18n.helper.ts` pasa a importar `esaviLog`. No hay ciclo de importación: `esaviLogs.helper.ts` no importa `i18n.helper.ts`.

---

## 4. Plan de implementación

El paso 3 va antes del 5 a propósito: en cuanto el helper tiene fallback, las 101 claves ausentes de neerlandés devuelven texto en el idioma por defecto en vez de cadena vacía. El sistema mejora antes de estar traducido.

1. **Claves nuevas.** Añadir `auth.loginFailed` y `healthFacility.facilityTypeNotFound` a `es.json` y `en.json`.
   *Verificación:* ambos archivos con 126 claves.

2. **Referencias corregidas.** En `catalogItem.controller.ts:110`, cambiar `catalogItem.updateFailed` por `catalogItem.updatedFailed`. En `healthFacility.service.ts:35`, cambiar `facilityType.notFound` por `healthFacility.facilityTypeNotFound`.
   *Verificación:* un update fallido de catalogItem devuelve mensaje con texto.

3. **Blindar `getMessage`.** Implementar la cadena de tres niveles descrita en el modelo de datos. La firma pública no cambia.
   *Verificación:* `getMessage('clave.inventada', 'es')` devuelve `'clave.inventada'` y deja una línea en `esaviLog`.

4. **`nd` → `nl`.** Renombrar `src/data/i18n/nd.json` a `nl.json` con `git mv`, actualizar el import y el mapa `messages` de `i18n.helper.ts`, y poner `SUPPORTED_LANGUAGES=es,en,nl` en `.env.example`, `.env.development` y `.env.production`.
   *Verificación:* `?lang=nl` resuelve; `?lang=nd` cae a `DEFAULT_LANGUAGE`.

5. **Paridad de neerlandés.** Completar `nl.json` hasta las 126 claves, respetando la estructura de namespaces y los marcadores `{{param}}` de `es.json`.
   *Verificación:* los tres archivos con el mismo conjunto de claves.

6. **Script de verificación.** Crear `scripts/i18n-check.js`: aplana los tres archivos, compara sus conjuntos de claves entre sí y contra las claves referenciadas por `getMessage(...)` en `src/`, imprime las divergencias y sale con código 1 si hay alguna. Añadir `"i18n:check": "node scripts/i18n-check.js"` a `package.json`.
   *Verificación:* `npm run i18n:check` sale con 0.

---

## 5. Criterios de aceptación

- [ ] `es.json`, `en.json` y `nl.json` tienen exactamente las mismas 126 claves.
- [ ] `src/data/i18n/nd.json` ya no existe.
- [ ] `grep -rn "'nd'" src/` no devuelve resultados.
- [ ] Ninguna clave referenciada con `getMessage(...)` en `src/` falta en `es.json`.
- [ ] `npm run i18n:check` sale con código 0.
- [ ] `npm run i18n:check` sale con código 1 si se borra una clave de `nl.json` a mano.
- [ ] Un login que falla por error interno devuelve `message` con texto, no `""`.
- [ ] Un update fallido de catalogItem devuelve `message` con texto, no `""`.
- [ ] Crear un healthFacility con un `facilityTypeItemId` inexistente devuelve 404 con `message` con texto, no `""`.
- [ ] `GET /api/catalog-types/?lang=nl` devuelve el mensaje en neerlandés.
- [ ] `GET /api/catalog-types/?lang=nd` devuelve el mensaje en `DEFAULT_LANGUAGE`, no vacío.
- [ ] `getMessage('no.existe')` devuelve `'no.existe'` y escribe en `esaviLog`.
- [ ] Las 126 cadenas neerlandesas han sido revisadas por un hablante antes de marcar este spec como Implementado.
- [ ] `npm run build` compila sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** `getMessage` cae a `DEFAULT_LANGUAGE` y luego a la propia clave, con registro. Devolver la clave es feo en la respuesta, y eso es precisamente lo que se busca: un fallo visible en vez de uno silencioso.
- **No:** que `getMessage` lance cuando falta la clave. Un mensaje ausente no debe convertir un 200 en un 500.
- **Sí:** corregir el código, no el JSON, en el caso de `updateFailed`. La sección 13 del canon fija `updatedFailed`; renombrar la clave del JSON obligaría a tocar las cinco entidades que ya la usan bien.
- **Sí:** `healthFacility.facilityTypeNotFound` en el namespace de la entidad que la usa. Descartado crear un namespace `facilityType`, que no corresponde a ninguna entidad; descartado reutilizar `catalogItem.notFound`, que daría un mensaje genérico donde el usuario necesita saber qué campo falla.
- **Sí:** renombrar `nd` a `nl`. Es el código ISO 639-1 del neerlandés y hoy un `Accept-Language: nl` estándar no resuelve. Descartado el alias `nl → nd`: deja un identificador no estándar como forma interna.
- **No:** rellenar neerlandés copiando el español. Parece traducido sin estarlo, y esa deuda no aparece en ningún inventario.
- **Sí:** revisión humana de las traducciones como criterio de cierre. Las genera el implementador, pero un mensaje al usuario final en un idioma sin revisar no es un entregable terminado.
- **Sí:** un script de verificación, aunque el tooling sea el SPEC 07. Sin él, la paridad no es comprobable y vuelve a degradarse al primer endpoint nuevo.
- **No:** eliminar las 43 claves definidas y nunca usadas. Son el set canónico de las siete operaciones; `healthFacility` las necesitará en cuanto tenga update, delete y activate.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un cliente en producción envía hoy `?lang=nd` | Con el fallback ya implantado recibe `DEFAULT_LANGUAGE`, que es mejor que el `""` actual; se avisa del cambio a `nl` |
| Traducción al neerlandés sin revisar llega a producción | Criterio de aceptación explícito: el spec no pasa a Implementado sin revisión de un hablante |
| Devolver la clave como mensaje expone nombres internos al cliente | Solo ocurre si la clave falta en los tres idiomas, que es un bug a corregir, y `i18n:check` lo detecta antes del merge |
| Marcadores `{{param}}` perdidos al traducir | `i18n-check.js` compara también la presencia de `{{...}}` entre idiomas para la misma clave |

---

## 8. Impacto en el contrato HTTP

| Caso | Antes | Después |
|---|---|---|
| Error interno de login | `message: ""` | **texto** |
| Update fallido de catalogItem | `message: ""` | **texto** |
| `facilityTypeItemId` inexistente | `message: ""` | **texto** |
| `?lang=nl` | no soportado, caía a default | **soportado** |
| `?lang=nd` | soportado con 101 respuestas vacías | **no soportado**, cae a `DEFAULT_LANGUAGE` |
| Clave ausente en cualquier idioma | `message: ""` | **texto en `DEFAULT_LANGUAGE`** |

---

## Lo que **no** está en este spec

- Traducir los `withMessage(...)` de los validadores (SPEC 02 los crea; su traducción no está en ningún spec todavía).
- Enganchar `i18n:check` a CI o a un hook (SPEC 07).
- Eliminar claves sin uso.
- Añadir un cuarto idioma.

Cada uno de esos, si aterriza, va en su propio spec.
