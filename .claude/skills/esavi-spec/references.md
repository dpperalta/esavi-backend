# Ficha de consulta — datos del repositorio para escribir specs

Resumen de dónde vive cada dato, para no releer 40 KB de convenciones en cada spec. **No sustituye a las fuentes**: cuando necesites una tabla exacta, ábrela.

---

## 1. Mapa de fuentes

| Necesito saber… | Fuente |
|---|---|
| Los siete artefactos obligatorios | `references/CONVENTIONS.md` §1 |
| Responsabilidad de cada capa | §2 |
| Sufijo y ubicación de archivo por artefacto | §3 |
| Nombres de símbolos por capa | §4 |
| Códigos `ESAVI-*` y abreviaturas registradas | §6 |
| Formato del comentario de dos líneas | §7 |
| Orden de la cadena de middlewares | §8 |
| Matriz de roles y `ROLE_LEVELS` | §9 |
| Contrato de respuesta y tabla de status | §10 |
| Reglas de la capa de servicio (unicidad, FK, `appDetails`, paginación) | §11 |
| **Update diferencial y `buildDifferentialUpdate`** | §11, bloque «Update diferencial»; origen en `references/functional/specs/12-differential.md` |
| Reglas de definición de modelos | §12 |
| Estructura de claves i18n | §13 |
| Plantillas copy-paste de los 6 artefactos | §14 |
| Checklist antes de cerrar un PR | §15 |
| Desviaciones ya catalogadas (no son precedente) | `references/TECHNICAL_DEBT.md` |
| Ejemplo canónico de spec CRUD | `references/specs/09-healthfacility-crud.md` |
| Specs técnicos (`SPEC 01`–`09`) | `references/specs/` |
| Specs funcionales (`SPEC F01`…), destino de los nuevos | `references/functional/specs/NN-slug.md` |
| DDL autoritativo | `esaviapp.sql` (raíz) |

---

## 2. Numeración `ESAVI-*` — fija, no negociable

Formato: `ESAVI-<ENTIDAD>-<NNN>[A|B]`.

| Código | Operación | HTTP | Ruta | Éxito | Rol mínimo |
|---|---|---|---|---|---|
| `001` | create | POST | `/` | 201 | ADMIN |
| `002` | list único | GET | `/` | 200 | USER |
| `002A` | list público (solo activos) | GET | `/` | 200 | USER |
| `002B` | list admin (incluye inactivos) | GET | `/admin` | 200 | ADMIN |
| `003` | getById | GET | `/:id` | 200 | USER |
| `004` | update | PUT | `/:id` | 200 | ADMIN |
| `005A` | soft delete | DELETE | `/:id` | 200 | ADMIN |
| `005B` | activate | PATCH | `/activate/:id` | 200 | SUPERADMIN |

**Listado dual.** Cuando hay `002A` y `002B` sobre una sola ruta `GET /` bifurcada por rol, la ruta y el controlador llevan `002` sin letra; solo los **servicios** llevan `002A` y `002B`. Cuando son dos rutas distintas (`/` y `/admin`), cada una lleva su letra.

**Listado por FK.** `healthFacility` lista por `/location/:id` y `/admin/location/:id` en vez de `/` y `/admin`. Es una variante válida cuando la entidad no tiene sentido sin su padre.

**El mismo código en cinco lugares**, idénticos:

1. Comentario de la ruta — `// Code: ESAVI-CATITEM-001`
2. Comentario del controlador — `// Code: ESAVI-CATITEM-001`
3. Comentario del servicio — `// ESAVI-CATITEM-001 - Create Catalog Item Service`
4. Código de `AppError` — `'CATITEM_001_CREATION_FAILED'` (sin el prefijo `ESAVI-`)
5. `appDetails.method` de la auditoría — `'ESAVI-CATITEM-001'`

Acciones estándar del `AppError`: `CREATION_FAILED`, `FETCH_FAILED`, `UPDATE_FAILED`, `DELETE_FAILED`, `ACTIVATION_FAILED`, `NOT_FOUND`, `CODE_EXISTS`, `ALREADY_ACTIVE`, `ALREADY_INACTIVE`, `<FK>_NOT_FOUND`.

En activación el número se calcula (`const op = isActive ? '005B' : '005A'`) y `appDetails.method` guarda **solo** el código, nunca con `_ACTIVATION` pegado detrás.

---

## 3. Abreviaturas registradas

| Entidad | Abreviatura |
|---|---|
| catalogItem | `CATITEM` |
| catalogType | `CATTYPE` |
| geoLevelType | `GEOTYPE` |
| geoLocation | `GEOLOC` |
| healthFacility | `HFAC` |
| user | `USER` |
| auth | `AUTH` |
| seed | `SEED` |

Regla de acuñación: **4 a 8 letras**, mayúsculas, sin guiones, derivada del nombre de la entidad, única en la tabla y **registrada antes de usarse**. Las de dos letras están prohibidas: `HF` quedó vetada por ambigua (ver `references/specs/05-operation-codes.md`).

**Ninguna de las 37 tablas pendientes tiene abreviatura asignada.** Todo spec de entidad nueva debe proponer la suya e incluir en su plan de implementación el alta en la tabla de `CONVENTIONS.md` §6.

---

## 4. Estado del esquema — 45 tablas, 8 implementadas

El esquema **no** lo crea Sequelize; no hay `sequelize.sync()`. `esaviapp.sql` es el DDL autoritativo y el modelo se escribe para calzar con la tabla existente. Toda tabla lleva `isActive`, `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB array).

### Ya implementadas (8)

`catalogType` (198) · `catalogItem` (213) · `appUser` (237) · `appRole` (265) · `appUserRole` (300) · `geoLevelType` (403) · `geoLocation` (416) · `healthFacility` (444)

### Pendientes (37), por dominio

**Auth y sistema (6)** — `appPermission` (282) · `appRolePermission` (324) · `appSession` (341) · `systemConfig` (362) · `systemConfigHistory` (383) · `appUserGeoLocation` (482)

**Catálogos clínicos (3)** — `diagnosticTerm` (549) · `vaccineWhodrug` (565) · `diluentCatalog` (603)

**Núcleo ESAVI (5)** — `patient` (620) · `esaviCase` (646) · `notifier` (670) · `classification` (694) · `finalClassification` (1248)

**Notificación (9)** — `notification` (722) · `severeNotification` (747) · `nonSevereNotification` (764) · `notificationEvent` (789) · `notificationMedication` (814) · `notificationVaccine` (837) · `notificationDiluent` (863) · `notificationPregnancy` (884) · `notificationPregnancyComplication` (903)

**Investigación (14)** — `investigation` (926) · `investigationSource` (953) · `investigationAutopsy` (973) · `investigationTeamMember` (992) · `investigationCovidHistory` (1010) · `investigationMedicalHistory` (1034) · `investigationPregnancyCondition` (1063) · `investigationClinicalEvaluation` (1080) · `evaluationInstitution` (1106) · `investigationVaccinationContext` (1127) · `investigationVaccineAdministered` (1150) · `investigationColdChain` (1167) · `investigationAdministrationError` (1192) · `investigationCommunity` (1228)

El número entre paréntesis es la línea del `CREATE TABLE` en `esaviapp.sql`. Verifícala al abrir el archivo: el DDL puede haber crecido.

**Orden sugerido.** Los catálogos clínicos son los candidatos naturales para los próximos specs: tablas planas, pocas FKs y sin lógica de dominio. Los bloques de notificación e investigación son grafos de tablas satélite alrededor de una raíz; ésos se dividen en varios specs.

---

## 5. Ejemplo end-to-end de referencia — `healthFacility`

Los siete artefactos, para citar archivos análogos en el spec:

| # | Artefacto | Ruta |
|---|---|---|
| 1 | Modelo | `src/models/healthFacility.model.ts` |
| 2 | Asociaciones | `src/models/associations/healthFacility.associations.ts` |
| 3 | Tipos | `src/types/healthFacility/healthFacility.types.ts` |
| 4 | Validadores | `src/validators/healthFacility.validator.ts` |
| 5 | Servicio | `src/services/healthFacility.service.ts` |
| 6 | Controlador | `src/controllers/healthFacility.controller.ts` |
| 7 | Ruta | `src/routes/healthFacility.routes.ts` |

Más, en el mismo commit: claves i18n en `src/data/i18n/{es,en,nl}.json`, alta en `src/routes/index.ts` y en los barrels de `validators/`, `types/`, `models/` y `models/associations/`, filas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/<entidad>.test.ts`.

Cadena de middlewares invariable:

```ts
router.<method>('/<path>', tokenValidation, validateUserRole(ROL), ...entityValidator, validateFields, handler);
```

El spread `...` es obligatorio; toda ruta con `:id` lleva su `entityIdValidator`; `validateFields` va inmediatamente después de los validadores; un solo rol por `validateUserRole` (es "nivel ≥", no "es igual a").

Helpers y servicios reutilizables que un spec debe citar en vez de reinventar:

- `buildDifferentialUpdate` — `src/helpers/differentialUpdate.helper.ts`, **obligatorio en todo `004`**. Ver §8 de esta ficha.
- `setEntityActiveStatusService` — `src/services/common/entityActivation.service.ts`, para `005A`/`005B`.
- `canViewInactive`, `isAdmin` — `src/helpers/permissions.helper.ts`.
- `toConstantCase`, `toTitleCase` — `src/helpers/stringHandling.helper.ts`.
- `esaviCrypt`, `esaviDecrypt` — `src/helpers/crypto.helper.ts`, para campos PII.
- `getMessage`, `esaviLog`, `AppError` — `src/helpers/`.
- `DEFAULT_LIMIT`, `DEFAULT_OFFSET` — `src/constants/pagination.constants.ts`.

---

## 6. Comandos de verificación

| Comando | Qué comprueba |
|---|---|
| `npm run build` | Compila TypeScript |
| `npm run lint` | ESLint sobre `src/` y `tests/` |
| `npm run i18n:check` | Paridad de claves en es/en/nl y guardas del SPEC 08 |
| `npm test` | Jest — contrato, i18n, roles |
| `npm run check` | Los cuatro anteriores encadenados |

`npm run check` en 0 es el criterio de cierre de todo spec.

---

## 7. Anomalías conocidas a tener en cuenta

- `src/types/healthFacility/` **no tiene `index.ts`**; `src/types/index.ts` importa el archivo directo. Es una desviación catalogada en `references/TECHNICAL_DEBT.md`: un spec de entidad nueva sí debe pedir el barrel del dominio.
- Los specs viven en dos sitios con **numeraciones independientes**: los técnicos `01`–`09` en `references/specs/` y los funcionales `F01` en adelante en `references/functional/specs/`. Existen a la vez un `SPEC 01` y un `SPEC F01`: cita siempre el prefijo.
- Los skills `spec` y `spec-impl` asumen la ruta `specs/` en la raíz, que no existe. Al indicar el siguiente paso al usuario, menciona siempre la ruta completa del archivo.
- `/api/seed/admin` está sin autenticar (su middleware está comentado en `src/routes/seed.route.ts`). No es precedente para ninguna entidad nueva.

---

## 8. Update diferencial — ficha rápida

Norma: `CONVENTIONS.md` §11, bloque «Update diferencial». Origen: `references/functional/specs/12-differential.md` (SPEC F12, `Implementado`).

**La regla en una frase:** se escribe cuando el **valor cambia**, no cuando la clave llega en el body. Sin diferencias no hay `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`; se responde 200 con la fila como está.

Forma canónica del `004`:

```ts
const stored = entity.get({ plain: true }) as Record<string, unknown>;   // fila completa, sin `attributes`
const objectToUpdate = buildDifferentialUpdate(stored, { /* candidates ya normalizados */ });
if( Object.keys(objectToUpdate).length === 0 ) { return entity; }
```

Cómo entra cada tipo de campo en `candidates`:

| Tipo de campo | Forma |
|---|---|
| Código | `data.code ? toConstantCase(data.code.trim()) : undefined` |
| Nombre | `data.name ? toTitleCase(data.name.trim()) : undefined` |
| Anulable | `data.x !== undefined ? (data.x ?? null) : undefined` — `null` es un valor, `undefined` es «no vino» |
| Cifrado | texto plano; `stored` descifrado con `esaviDecrypt`; `esaviCrypt` **después** del diff |
| Derivado | **siempre**, sin `if` de presencia: lo decide el helper |
| Inmutable | no entra: se ignora en silencio, sin 400 |

Reglas de comparación que ya absorbe el helper —no las repita ningún servicio—: `!==` en primitivos, `getTime()` en fechas, `JSON.stringify` en objetos, comparación numérica entre cadena numérica y número (las columnas `DECIMAL` vuelven de `pg` como cadena), y `slice(0, 10)` en `DATEONLY`.

**Antes del diff y con independencia de él:** validación de FK (404) y unicidad (409). La unicidad de un campo cifrado sí compara ciphertext: es una consulta a la base, no un diff.

**No pasan por el helper**, y el spec debe decirlo cuando aparezcan: las activaciones `005A`/`005B` y `setEntityActiveStatusService`, los `001`, y las escrituras con intención propia —traslados, asignaciones masivas, reactivaciones— que registran un hecho aunque ningún dato cambie.
