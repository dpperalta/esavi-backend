# SPEC 01 — Autorización en un solo punto y superficie expuesta

> **Estado:** Aprobado
> **Depende de:** —
> **Fecha:** 2026-08-01
> **Objetivo:** Que la ruta sea el único lugar donde se autoriza, con los niveles de la matriz canónica, y que seed y CORS dejen de estar abiertos.

Cubre las entradas **DEUDA-002, DEUDA-005, DEUDA-009, DEUDA-010, DEUDA-012 y DEUDA-017** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Primer spec de una serie de seis que salda la deuda técnica catalogada a 2026-07-31. Los seis son independientes entre sí salvo donde se indique.

---

## 1. Por qué existe este spec

Hoy la autorización vive en dos sitios que no coinciden: el middleware `validateUserRole` en la ruta y un guard `isSuperAdmin()` dentro del controlador. El efecto es que el nivel declarado en la ruta miente. `PATCH /geo-locations/activate/:id` anuncia ADMIN y devuelve 403 a un ADMIN; `DELETE /catalog-types/:id` anuncia USER y solo lo salva el guard del controlador.

La sección 9 de [CONVENTIONS.md](../CONVENTIONS.md) ya fija la regla: la ruta es el único punto de autorización. Este spec la aplica.

---

## 2. Alcance

**Dentro:**

- Alinear el nivel de rol de las 7 rutas divergentes con la matriz canónica (sección 9 de CONVENTIONS.md).
- Eliminar los 7 guards `isSuperAdmin()` de los controladores (`catalogType`, `geoLevelType`, `geoLocation`).
- Sustituir `validateUserRole(SUPERADMIN, ADMIN)` por un solo rol en `GET /geo-level-types/`.
- `POST /api/seed/admin`: el router deja de montarse cuando `NODE_ENV === 'production'`.
- `app.use(cors())` pasa a lista blanca leída de `CORS_ORIGINS`.
- Login: `404` → `401` en los dos casos de credenciales inválidas.
- Documentar `CORS_ORIGINS` en `.env.example` y en los dos `.env.*`.

**Fuera de alcance (specs siguientes):**

- Validadores de `:id` y de paginación en las rutas tocadas — SPEC 02.
- Renumerar los códigos `ESAVI-*` de esas mismas rutas — SPEC 05.
- Eliminar el bloque comentado de `geoLocation.routes.ts` y la implementación vieja de `roleValidation.middleware.ts` — SPEC 06.
- Cambiar `validateUserRole` a `Math.min` — se descarta, ver Decisiones.
- Tests automáticos que verifiquen la matriz — SPEC 07 (tooling).

### Cambios de nivel de rol

| Ruta | Hoy | Canon | Efecto |
|---|---|---|---|
| `PUT /catalog-types/:id` | SUPERADMIN | **ADMIN** | amplía |
| `DELETE /catalog-types/:id` | USER *(+ guard)* | **ADMIN** | restringe |
| `POST /geo-level-types/` | SUPERADMIN | **ADMIN** | amplía |
| `GET /geo-level-types/` | SUPERADMIN, ADMIN | **USER** | amplía |
| `PUT /geo-level-types/:id` | SUPERADMIN | **ADMIN** | amplía |
| `DELETE /geo-level-types/:id` | SUPERADMIN | **ADMIN** | amplía |
| `PATCH /geo-locations/activate/:id` | ADMIN *(+ guard)* | **SUPERADMIN** | restringe |

---

## 3. Modelo de datos

Esta funcionalidad no introduce estructuras de datos ni tablas nuevas. Introduce una sola variable de entorno.

| Variable | Formato | Development | Production |
|---|---|---|---|
| `CORS_ORIGINS` | orígenes separados por coma, sin barra final | opcional; por defecto `http://localhost:5173,http://localhost:3000` | **obligatoria**; la app lanza al arrancar si falta |

```bash
# .env.production
CORS_ORIGINS=https://esavi.msp.gob.ec,https://admin.esavi.msp.gob.ec
```

Configuración aplicada en `src/index.ts`:

```ts
app.use(cors({
    origin: allowedOrigins,   // string[] leído de CORS_ORIGINS
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
}));
```

Un origen no listado recibe la respuesta sin la cabecera `Access-Control-Allow-Origin`; el navegador bloquea. No se emite un 403 propio: el rechazo es de CORS, no de la capa de autorización.

---

## 4. Plan de implementación

El orden importa: el paso 4 debe ir antes del 5. Hoy el único freno real en `DELETE /catalog-types/:id` es el guard del controlador (DEUDA-005); si se borran los guards primero, el endpoint queda abierto a cualquier USER.

1. **CORS por entorno.** Añadir `CORS_ORIGINS` a `.env.example`, `.env.development` y `.env.production`. En `src/index.ts`, resolver `allowedOrigins` desde la variable y pasarla a `cors()`. Si `NODE_ENV === 'production'` y la variable falta, lanzar al arrancar. Eliminar el `TODO` de la línea 27.
   *Verificación:* petición desde un origen no listado, no llega la cabecera.

2. **Seed fuera de producción.** En `src/routes/index.ts`, montar `/seed` solo cuando `NODE_ENV !== 'production'`. El gate `?enable=SEED_ACTION` se conserva tal cual en los demás entornos.
   *Verificación:* con `NODE_ENV=production`, `POST /api/seed/admin` → 404.

3. **Login 401.** En `src/services/auth.service.ts:32,36`, cambiar `404` por `401` en las dos llamadas. Mensaje y código `AUTH_001_INVALID_CREDENTIALS` se mantienen idénticos entre ambos casos.
   *Verificación:* email inexistente y contraseña errónea devuelven la misma respuesta, con status 401.

4. **Matriz canónica en las rutas.** Aplicar las 7 filas de la tabla de alcance en `catalogType.routes.ts`, `geoLevelType.routes.ts` y `geoLocation.routes.ts`. En `GET /geo-level-types/`, sustituir `validateUserRole(SUPERADMIN, ADMIN)` por `validateUserRole(USER)`. Ninguna ruta queda con más de un rol.
   *Verificación:* `grep -rn "validateUserRole(.*," src/routes/` no devuelve nada.

5. **Guards fuera de los controladores.** Eliminar los 7 bloques `if( !isSuperAdmin(...) ) return res.status(403)...` de `catalogType.controller.ts:95,121`, `geoLevelType.controller.ts:75,102,128` y `geoLocation.controller.ts:101,128`, junto con los imports de `isSuperAdmin` / `isAdmin` que queden sin uso.
   *Verificación:* `grep -rn "status(403)" src/controllers/` no devuelve nada; `npm run build` pasa.

`geoLevelType.controller.ts:33,54` y `geoLocation.controller.ts:36,59` también usan `isSuperAdmin`, pero ahí **modula** si se ven inactivos, no autoriza. No se tocan aquí; su migración a `canViewInactive` va al SPEC 06.

---

## 5. Criterios de aceptación

- [ ] `grep -rn "status(403)" src/controllers/` no devuelve resultados.
- [ ] `grep -rn "isSuperAdmin" src/routes/ src/controllers/` solo aparece en las 4 llamadas que modulan visibilidad de inactivos.
- [ ] Ninguna llamada a `validateUserRole` en `src/routes/` recibe más de un argumento.
- [ ] Un ADMIN puede crear, actualizar y borrar un `geoLevelType` y recibe 200/201.
- [ ] Un USER hace `GET /api/geo-level-types/` y recibe 200.
- [ ] Un USER hace `DELETE /api/catalog-types/:id` y recibe 403 desde el middleware.
- [ ] Un ADMIN hace `PATCH /api/geo-locations/activate/:id` y recibe 403 desde el middleware, no desde el controlador.
- [ ] Un SUPERADMIN hace `PATCH /api/geo-locations/activate/:id` y recibe 200.
- [ ] `POST /api/auth/login` con email inexistente devuelve 401.
- [ ] `POST /api/auth/login` con contraseña incorrecta devuelve 401, con `message` y `code` idénticos al caso anterior.
- [ ] Con `NODE_ENV=production`, `POST /api/seed/admin` devuelve 404.
- [ ] Con `NODE_ENV=development`, `POST /api/seed/admin?enable=<SEED_ACTION>` sigue funcionando.
- [ ] Con `NODE_ENV=production` y `CORS_ORIGINS` ausente, el proceso termina con error en el arranque.
- [ ] Una petición desde un origen no listado en `CORS_ORIGINS` no recibe cabecera `Access-Control-Allow-Origin`.
- [ ] `CORS_ORIGINS` está documentada en `.env.example`.
- [ ] `npm run build` compila sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** la ruta es el único punto de autorización. Es la sección 9 del canon. Hoy la regla vive en dos sitios que no coinciden, y gana el más restrictivo de forma invisible para el consumidor.
- **No:** cambiar `validateUserRole` a `Math.min`. Con `Math.max` la semántica "nivel ≥ X" es correcta y toda la matriz se apoya en ella; el problema es pasar dos roles, no el operador. Se corrige la llamada, no el middleware.
- **Sí:** aplicar la matriz canónica completa, incluidas las cinco rutas que amplían acceso de SUPERADMIN a ADMIN. Confirmado explícitamente al definir el alcance. La alternativa —corregir solo lo que restringe— dejaba la matriz a medias y obligaba a un segundo spec para lo mismo.
- **Sí:** el router de seed no se monta en producción. Descartado protegerlo con `SUPERADMIN`: creaba un problema de arranque, porque el primer SUPERADMIN es justamente lo que el seed crea. En producción el bootstrap pasa a ser un paso manual por SQL.
- **Sí:** se conserva el gate `?enable=SEED_ACTION` en desarrollo. Cuesta nada y evita ejecuciones accidentales.
- **Sí:** `CORS_ORIGINS` obligatoria en producción, con default de localhost en desarrollo. Un default permisivo en producción es exactamente la deuda que se está pagando.
- **Sí:** login devuelve 401. Se mantiene deliberadamente el mismo mensaje y el mismo código para "usuario inexistente" y "contraseña incorrecta", para no permitir enumeración de usuarios.
- **No:** periodo de transición para los cambios de status code. Se aplican directos y se documenta el impacto; la API no tiene consumidores externos versionados.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un ADMIN gana la capacidad de borrar tipos de nivel geográfico, que son catálogo estructural | El borrado es lógico (`isActive: false`), reversible con `PATCH /activate/:id`, que sigue siendo SUPERADMIN |
| Bootstrap en producción sin endpoint de seed | Documentar en `readme.md` el SQL de creación del primer SUPERADMIN antes de desplegar |
| `CORS_ORIGINS` mal escrita (barra final, protocolo ausente) rompe el frontend sin error de servidor | El arranque registra con `esaviLog` la lista de orígenes resuelta, en nivel `info` |
| El frontend trata hoy el 404 de login como "usuario no existe" | El impacto está listado abajo; el cambio va acompañado de aviso al equipo de frontend |

---

## 8. Impacto en el contrato HTTP

| Endpoint | Antes | Después |
|---|---|---|
| `POST /api/auth/login` (credenciales inválidas) | 404 | **401** |
| `PATCH /api/geo-locations/activate/:id` con ADMIN | 403 (del controlador) | **403** (del middleware, misma forma) |
| `DELETE /api/catalog-types/:id` con USER | 403 (del controlador) | **403** (del middleware, misma forma) |
| `POST /api/seed/admin` en producción | 200 / 400 | **404** |
| Peticiones cross-origin no listadas | permitidas | bloqueadas por el navegador |

---

## Lo que **no** está en este spec

- Validadores de `:id` y de paginación (SPEC 02).
- Paridad de claves i18n (SPEC 03).
- Renumeración de códigos `ESAVI-*` (SPEC 05).
- Migrar `isSuperAdmin` a `canViewInactive` en las 4 llamadas que modulan visibilidad (SPEC 06).
- Tests que verifiquen la matriz de roles (SPEC 07).

Cada uno de esos, si aterriza, va en su propio spec.
