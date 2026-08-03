# SPEC 06 — Nomenclatura, tipos y código muerto

> **Estado:** Implementado
> **Depende de:** SPEC 01, 02, 03, 04, 05 (va el último; toca casi todos los archivos)
> **Fecha:** 2026-08-01
> **Objetivo:** Que los nombres de archivo, los tipos y los barrels sigan el canon, y que no quede código muerto en `src/`.

Cubre las entradas **DEUDA-019, 020, 021, 022, 023, 024, 027, 028 y 029** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Sexto y último spec de la serie que salda la deuda técnica catalogada a 2026-07-31.

---

## 1. Por qué existe este spec

Ninguna de estas entradas cambia comportamiento. Todas cambian lo que un desarrollador ve al abrir el proyecto: un archivo `.route.ts` junto a cinco `.routes.ts`, un tipo de update declarado y muerto, un barrel que exporta por nombre y silencia los tipos nuevos, dos copias literales de tres funciones en el servicio equivocado.

Va el último de la serie a propósito. Renombrar archivos que los cinco specs anteriores van a editar garantiza conflictos.

---

## 2. Alcance

**Dentro:**

- Los 6 renombrados de archivo y el directorio `geographical/` → `geography/`.
- `CreateCatalogItem` → `CreateCatalogItemInput`.
- Eliminar `UpdateGeoLevelTypeInput`, declarado y nunca usado.
- Tipar los objetos de auditoría con `AppDetails`.
- Un solo tipo de usuario autenticado: `Express.Request['user']` es `AuthUser`.
- `export * from` en los cuatro barrels de `types/`.
- Eliminar el código muerto: 3 funciones copiadas, 4 bloques comentados, 2 `console.log`.
- `loginController` → `login`; `const route` → `const router`.
- Las 4 llamadas a `isSuperAdmin` que modulan visibilidad pasan a `canViewInactive`.

**Fuera de alcance:**

- DEUDA-030 (ESLint y tests) — SPEC 07.
- DEUDA-031, 032 y 033, los hallazgos nuevos que se catalogan aparte.
- Cambiar qué hacen `canViewInactive` o `isSuperAdmin`. Hoy ambos son "solo SUPERADMIN", así que la sustitución no altera comportamiento.
- Renombrar `sysDetails` o el resto del modelo de auditoría.

---

## 3. Modelo de datos

### Renombrados

| Hoy | Canon |
|---|---|
| `src/routes/catalogItem.route.ts` | `catalogItem.routes.ts` |
| `src/routes/seed.route.ts` | `seed.routes.ts` |
| `src/models/associations/catalog.association.ts` | `catalog.associations.ts` |
| `src/types/catalog/catalogItem.type.ts` | `catalogItem.types.ts` |
| `src/types/catalog/catalogType.type.ts` | `catalogType.types.ts` |
| `src/types/healthFacility.types.ts` | `src/types/healthFacility/healthFacility.types.ts` |
| `src/types/geographical/` | `src/types/geography/` |

Todos con `git mv`, para no perder el historial.

### Tipo de usuario autenticado

```ts
// src/types/user/user.types.ts
export interface UserRole {
    name: string;
    level: number;
    roleId?: string;   // el token no lo puebla
    code?: string;     // el token no lo puebla
}

export interface AuthUser {
    userId: string;
    email: string;
    displayName: string;
    roles: UserRole[];
}
```

```ts
// src/types/express/index.d.ts
import { AuthUser } from '../user/user.types';

declare global {
    namespace Express {
        export interface Request {
            lang?: string;
            user?: AuthUser;
        }
    }
}
export {};
```

Con eso, los `req.user as AuthUser` repetidos en todos los controladores desaparecen, y el `{ userId: req.user?.userId } as AuthUser` que construye un objeto incompleto deja de compilar — hay que pasar `req.user` entero.

Los tres campos comentados del principio de `AuthUser` se eliminan.

### Auditoría tipada

```ts
// hoy: literal inline, sin tipo
const newEntry = { createdAt: new Date(), user: ..., method: ..., detail: ... };

// después
import { AppDetails } from '../types';
const newEntry: AppDetails = { ... };
```

Aplica a los objetos de auditoría de los cinco servicios y al `appDetail` de `ActivationOptions`, que hoy declara la forma a mano.

### Barrels

`types/geography/index.ts` y `types/user/index.ts` pasan de re-export nominal a `export * from`, igual que ya hacen `catalog/` y `common/`.

### Código muerto a eliminar

| Ubicación | Qué es |
|---|---|
| `healthFacility.service.ts:105-150` | 3 copias literales de funciones de `catalogItem.service.ts`, no exportadas |
| `geoLocation.routes.ts:37-56` | bloque comentado con rutas de geoLevelType |
| `roleValidation.middleware.ts:5-20` | implementación anterior de `validateUserRole` |
| `crypto.helper.ts:18-23,39-54` | variante GCM comentada |
| `auth.service.ts:46-48,55-58` | campos comentados del payload JWT |
| `geoLocation.controller.ts:34` | `console.log({geoLevelId, parentId, limit, offset})` |
| `tokenValidation.middleware.ts:73` | `console.log(error)` |
| `user.types.ts:17-19` | campos comentados de `AuthUser` |

---

## 4. Plan de implementación

Los renombrados van primero y solos: un commit de `git mv` con sus imports, sin ningún cambio de contenido, se revisa de un vistazo. Mezclarlos con ediciones reales hace ilegible el diff.

1. **Renombrar archivos.** Los seis `git mv` más el directorio, actualizando todos los imports y los barrels afectados. Ningún cambio de contenido.
   *Verificación:* `npm run build` pasa; `git log --follow` sigue mostrando el historial de cada archivo.

2. **Código muerto fuera.** Eliminar las ocho ubicaciones de la tabla.
   *Verificación:* los dos `console.log` de la tabla no existen; `getActiveCatalogItemsByTypeService` solo existe en `catalogItem.service.ts`.

3. **Tipos de entrada.** Renombrar `CreateCatalogItem` a `CreateCatalogItemInput` y eliminar `UpdateGeoLevelTypeInput`.
   *Verificación:* `grep -rn "CreateCatalogItem\b" src/` no devuelve resultados sin el sufijo.

4. **Barrels uniformes.** `export * from` en `types/geography/index.ts` y `types/user/index.ts`.
   *Verificación:* un tipo nuevo en `user.types.ts` es importable desde `../types` sin tocar el barrel.

5. **Un solo `AuthUser`.** Aplicar la forma del modelo de datos en `user.types.ts` y `express/index.d.ts`, y eliminar los `as AuthUser` de todos los controladores. Donde hoy se construye `{ userId: req.user?.userId } as AuthUser`, pasar `req.user`.
   *Verificación:* `grep -rn "as AuthUser" src/` no devuelve resultados y `npm run build` pasa.

6. **Auditoría tipada.** Importar `AppDetails` en los cinco servicios y anotar con él cada objeto de auditoría. Sustituir la forma inline de `appDetail` en `ActivationOptions` por el tipo.
   *Verificación:* cambiar `method` por `methd` en un servicio produce un error de compilación.

7. **Nombres finales.** `loginController` → `login` en el controlador, en el barrel si aparece y en `auth.routes.ts`. `const route` → `const router` en `geoLocation.routes.ts`.
   *Verificación:* `grep -rn "loginController\|const route =" src/` no devuelve resultados.

8. **Predicado correcto.** Sustituir `isSuperAdmin` por `canViewInactive` en `geoLevelType.controller.ts:33,54` y `geoLocation.controller.ts:36,59`.
   *Verificación:* `grep -rn "isSuperAdmin" src/controllers/` no devuelve resultados.

9. **Canon coherente.** La línea 71 de `CONVENTIONS.md` pone `types/geographical/` como ejemplo válido, contradiciendo la regla de la línea 72 —subcarpetas de dominio en sustantivo singular— y el renombrado del paso 1. Sustituir el ejemplo por `types/geography/`.
   *Verificación:* `grep -n "geographical" references/CONVENTIONS.md` no devuelve resultados.

---

## 5. Criterios de aceptación

- [ ] No queda ningún archivo `*.route.ts` ni `*.association.ts` ni `*.type.ts` en `src/`.
- [ ] `src/types/geographical/` no existe; `src/types/geography/` sí.
- [ ] `src/types/healthFacility.types.ts` no existe en la raíz de `types/`.
- [ ] `git log --follow` muestra el historial completo de los seis archivos renombrados.
- [ ] Los dos `console.log` de la tabla de código muerto (`geoLocation.controller.ts`, `tokenValidation.middleware.ts`) no existen. Los ocho restantes en `src/` quedan fuera de alcance y se catalogan como DEUDA-036.
- [ ] `grep -rn "as AuthUser" src/` no devuelve resultados.
- [ ] `grep -rn "loginController" src/` no devuelve resultados.
- [ ] `grep -rn "const route =" src/routes/` no devuelve resultados.
- [ ] `grep -rn "isSuperAdmin" src/controllers/` no devuelve resultados.
- [ ] `grep -rn "UpdateGeoLevelTypeInput" src/` no devuelve resultados.
- [ ] `getActiveCatalogItemsByTypeService`, `getAllCatalogItemsByTypeService` y `getCatalogItemByIdService` están definidas en un solo archivo.
- [ ] Los cuatro `index.ts` de `types/` usan `export * from`.
- [ ] Todo objeto de auditoría en los servicios está anotado con `AppDetails`.
- [ ] Un typo en una clave de un objeto de auditoría rompe la compilación.
- [ ] `npm run build` compila sin errores.
- [ ] `npm run i18n:check` sigue saliendo con 0.
- [ ] Ninguna ruta de archivo ni import en `src/` contiene `geographical`.
- [ ] `grep -n "geographical" references/CONVENTIONS.md` no devuelve resultados. (`TECHNICAL_DEBT.md` y este spec sí lo nombran: documentan el renombrado.)
- [ ] Ninguna respuesta HTTP cambia de status, de forma ni de contenido.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** los renombrados en un commit propio, sin cambios de contenido. Un diff que mezcla movimientos y ediciones no se revisa, se aprueba a ciegas.
- **Sí:** `git mv` en vez de borrar y crear. Conserva el historial, que es la única razón por la que el código comentado se puede borrar sin miedo.
- **Sí:** `roleId` y `code` opcionales en `UserRole`. El tipo describe lo que hay en `req.user`, no lo que nos gustaría que hubiera. Poblarlos en cada petición sería cargar datos que ningún consumidor usa.
- **No:** mantener dos tipos con una función de conversión. Añade ceremonia para modelar una diferencia que no debería existir.
- **Sí:** `export * from` en los cuatro barrels. Con el re-export nominal, un tipo nuevo no existe fuera del módulo hasta que alguien se acuerda de añadirlo a mano, y nadie se acuerda.
- **Sí:** borrar el código comentado sin conservar copia. El historial de git es exactamente esa copia.
- **Sí:** sustituir `isSuperAdmin` por `canViewInactive` donde modula visibilidad. Hoy los dos predicados devuelven lo mismo, así que el cambio es de intención, no de comportamiento — y cuando `canViewInactive` deba admitir ADMIN, se cambiará en un solo sitio.
- **No:** cambiar hoy `canViewInactive` para que admita ADMIN, aunque la matriz canónica diga que el listado admin es `ADMIN`. Es un cambio de comportamiento y este spec no tiene ninguno; se cataloga aparte.
- **Sí:** este spec va el último. Renombrar archivos que otros cinco specs están editando produce conflictos en cada rebase.

---

## Lo que **no** está en este spec

- ESLint, Prettier y tests (SPEC 07).
- Los hallazgos catalogados como DEUDA-031, 032 y 033.
- Cualquier cambio de comportamiento observable por el cliente.

Sin sección de riesgos ni de impacto: no hay cambio observable y el compilador cubre lo demás.
