---
name: esavi-conventions
description: Convenciones obligatorias de código del backend ESAVI. Úsalo SIEMPRE antes de escribir, generar o revisar código en este repositorio — endpoints, modelos, servicios, controladores, rutas, validadores o tipos. Disparadores  "crea un endpoint", "agrega una entidad", "nuevo CRUD", "revisa este controlador", o cualquier edición bajo src/.
---

# Convenciones de código — esavi-backend

## Qué hacer

**Lee `references/CONVENTIONS.md` (en la raíz del repositorio) antes de escribir una sola línea.** Ese documento es la norma; este skill solo es el puntero. No trabajes de memoria: el canon tiene tablas exactas de sufijos, códigos de operación, status codes y matriz de roles que no se pueden reconstruir de cabeza.

Si vas a corregir código existente, lee también `references/TECHNICAL_DEBT.md`: puede que la desviación que ves ya esté catalogada y no toque arreglarla en este cambio.

## Regla de oro

Un endpoint nuevo genera **siete** artefactos, en este orden. Ninguno es opcional:

modelo → asociaciones → tipos → validadores → servicio → controlador → ruta

Más las claves i18n en **los tres** archivos (`es`, `en`, `nd`) y el alta en `src/routes/index.ts` y en los barrels.

Entregar un endpoint sin validador, sin tipos o sin claves i18n no se acepta.

## Lo que más se rompe

Seis reglas concentran casi toda la deuda actual. Revísalas siempre:

1. **El código `ESAVI-*` debe ser idéntico en cinco lugares**: ruta, controlador, servicio, código de `AppError` y `appDetails.method`. Numeración fija: `001` create · `002[A|B]` list · `003` getById · `004` update · `005A` delete · `005B` activate.
2. **El spread `...` en los validadores es obligatorio**, y toda ruta con validadores lleva `validateFields` justo después.
3. **La autorización vive solo en la ruta.** `validateUserRole(X)` significa "nivel ≥ nivel(X)" según `ROLE_LEVELS`. Nunca pases más de un rol (aplica `Math.max`). Nunca repitas el chequeo dentro del controlador.
4. **409 para todo duplicado**, en create y en update por igual. 404 solo para "no existe", 401 para credenciales.
5. **`appDetails` se extiende, no se sobrescribe**: `[...currentAppDetails, nuevo]`.
6. **El update es diferencial y pasa por `buildDifferentialUpdate`** (`src/helpers/differentialUpdate.helper.ts`). Se escribe cuando el **valor cambia**, no cuando la clave llega en el body: sin diferencias no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails` — se responde 200 con la fila como está. Nunca vuelvas a escribir la comparación campo a campo ni un `delete objectToUpdate.x`. Detalle en §11 del canon.

## Idioma

El código va **siempre en inglés** — nombres de archivo, identificadores, comentarios y claves i18n. Las explicaciones al usuario van en español.

## Antes de cerrar

Recorre el checklist de la sección 15 de `references/CONVENTIONS.md` y verifica que `npm run build` pasa.
