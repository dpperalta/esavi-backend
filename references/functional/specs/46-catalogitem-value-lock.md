# SPEC F46 — Congelado del `value` de `catalogItem` y realineación del seed

> **Estado:** Implementado
> **Depende de:** SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-27
> **Objetivo:** Separar el `code` de un `catalogItem` —que pertenece al país— de su `value` —que pertenece al código fuente—, congelando el segundo con una columna nueva y realineando los tres lookups de producción y las nueve suites que hoy dependen del `code`.

---

## 1. Por qué existe este spec

El commit `399521f` («SPEC41 - Seed populated») pobló `esaviapp.sql` con los catálogos oficiales. Al hacerlo **no borró la clave semántica: la movió de `code` a `value`** y puso en `code` el número del catálogo del ministerio.

```sql
CALL "upsertCatalogItem"('ageUnit', 'Age unit', '1', 'Años', 'YEARS', 1);
--                        tipo               code ─┘  name    value ─┘
```

La causa raíz no es el seed: es que `code` tiene **dos dueños peleándose por una columna**. La clave semántica que el código fuente necesita para reconocer un ítem, y el código de interoperabilidad que impone el catálogo oficial de cada país. Cuando llega el catálogo real, gana el externo y la semántica sale despedida. Volverá a pasar cada vez que un país cambie su codificación.

De los 18 catálogos sembrados, **13 quedaron con `code` numérico**: `ageUnit`, `sex`, `outcome`, `vaccinationMoment`, `vaccinationSite`, `profession`, `pregnancyOutcome`, `gestationMethod`, `pregnancyComplicationType`, `deliveryType`, `birthCondition`, `investigationStatus` y `finalClassificationImportance`. Los cuatro restantes —`healthFacilityType`, `userStatus`, `evaluationInstitutionType`, `caseWorkflowStatus`— conservan `CONSTANT_CASE`. Dos más, `administrationRoute` y `pharmaceuticalForm`, están comentados y no se siembran (`esaviapp.sql:1669-1672`).

### A — Tres lookups de producción rotos

| # | Ubicación | Busca | El seed tiene | Síntoma |
|---|---|---|---|---|
| A1 | `src/services/common/ageRecalculation.service.ts:12` | `['YEARS','MONTHS','DAYS']` | `'1','2','3'` | 500 al recalcular la edad |
| A2 | `src/services/classification.service.ts:133,210` ← `src/helpers/age.helper.ts:63-70` | `'YEARS'\|'MONTHS'\|'DAYS'` | `'1','2','3'` | 404 `CLASSIF_<op>_AGEUNIT_CATALOG_MISSING` en todo `POST /classifications` con dos fechas |
| A3 | `src/services/notification.service.ts:18,159` | `'DEATH'` | `'5'` | **Silencioso** |

**A3 es el grave.** `const isDeath = outcomeCode === DEATH_OUTCOME_CODE` nunca es verdadero, así que la regla de defunción no se dispara jamás y nadie se entera. Los otros dos gritan; este miente.

Verificados como sanos, y este spec **no los toca**: `caseWorkflow.service.ts` (F44 sembró `CONSTANT_CASE`), `healthFacility.service.ts` y `evaluationInstitution.service.ts` (catálogos intactos), y `notificationPregnancy.service.ts:152-186`, que resuelve por UUID contra `systemConfig` y es hoy el único inmune.

### B — Siete suites de contrato en rojo, 289 tests

| Suite | Línea | Modo de fallo |
|---|---|---|
| `tests/contract/patient.test.ts` | 81-90 | Busca `'FEMALE'` y `'HOSPITAL'` por `code`; el helper lanza *«The sex and healthFacilityType catalogs are not seeded»* |
| `tests/contract/healthFacility.test.ts` | 75 | Busca `'FEMALE'` por `code` → `expect(received).not.toBeNull()` |
| `tests/contract/investigationVaccinationContext.test.ts` | 165-175 | `itemOf('vaccinationMoment','FIRST_HOURS')` → `null.getDataValue` |
| `tests/contract/notificationMedication.test.ts` | 159-161 | `pharmaceuticalForm` y `administrationRoute` están comentados: el `catalogType` ni existe |
| `tests/contract/investigationMedicalHistory.test.ts` | 164 | **Colisión, no ausencia**: `CatalogType.create()` viola `UQ` porque el seed ya crea `gestationMethod`, `deliveryType`, `birthCondition` y `pregnancyOutcome` |
| `tests/contract/finalClassification.test.ts` | 584 | Espera `name: 'Importance 1'`; el seed pone `name: '1'` |
| `tests/contract/esaviCase.test.ts` | 132 | **Ajeno al seed** — [DEUDA-044](../../TECHNICAL_DEBT.md#deuda-044) |

### C — Corrupción silenciosa: cuatro suites que contaminan la base

Cuatro suites usan *find-or-create*. El `catalogType` **ya existe** —lo siembra el seed—, el ítem con el código semántico no, así que **crean un ítem duplicado en paralelo al oficial**:

| Suite | Línea | Efecto |
|---|---|---|
| `tests/contract/classification.test.ts` | 72-86 | `ageUnit` acaba con **6 ítems**: `'1','2','3'` + `'YEARS','MONTHS','DAYS'` |
| `tests/contract/notification.test.ts` | 78-91 | `outcome` acaba con **8 ítems** |
| `tests/contract/esaviCase.test.ts` | 2216-2227 | ídem `ageUnit` |
| `tests/contract/patient.test.ts` | 601-612 | ídem `ageUnit` |

Las dos primeras **pasan en verde, y pasan porque corrompen**. Sus comentarios —«*esaviapp.sql does not seed it*»— eran ciertos cuando se escribieron y hoy son falsos, así que además desinforman.

Ese es el argumento de fondo: el sistema no está en rojo, está en dos colores a la vez.

---

## 2. Alcance

**Dentro:**

- Columna `isValueLocked` en `catalogItem`, `boolean NOT NULL DEFAULT false`.
- Índice único parcial sobre `("catalogTypeId", "value")` restringido a las filas congeladas.
- Normalización de `value` a `CONSTANT_CASE` en escritura, en los tres caminos de la aplicación.
- Los cuatro caminos de escritura de `value` respetan el candado: `001`, `004`, `006` y el procedimiento `upsertCatalogItem`.
- `005A` responde **409** sobre un ítem congelado.
- Bloque `UPDATE` en `esaviapp.sql` que marca `isValueLocked` sobre el conjunto exacto que el código nombra.
- Acuñado del `value` semántico de `investigationStatus`, hoy numérico en las dos columnas.
- Migración de los tres lookups de producción de `code` a `value`.
- Corrección de las nueve suites: siete rojas y dos verdes-por-corrupción.
- Cierre de [DEUDA-044](../../TECHNICAL_DEBT.md#deuda-044) (`normalizeOrganization`).

**Fuera de alcance (otros specs):**

- Descomentar `administrationRoute` y `pharmaceuticalForm` en el seed. Se comentaron por una razón que este spec no conoce; se resuelve haciendo resiliente el fixture, no cambiando datos de despliegue.
- Congelar `finalClassificationImportance`. Ningún archivo de `src/` nombra sus ítems: no hay nada que proteger.
- Exponer `isValueLocked` como campo editable por API. Se escribe solo desde el SQL de despliegue.
- Un endpoint para congelar o descongelar en caliente.
- Sustituir el `systemConfig` de `PREGNANCY_FEMALE_SEX_ITEM` por un `value` congelado. Funciona, no está roto, y qué ítem significa «femenino» sí es legítimamente configurable por instalación.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`catalogItem` — `esaviapp.sql:213-230`. No es una tabla nueva: se le añade **una columna** y **un índice**.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `catalogItemId` | `uuid` | no | PK, `gen_random_uuid()` |
| `catalogTypeId` | `uuid` | no | `FK_catalogItem_catalogType` |
| `code` | `varchar(100)` | no | `UQ_catalogItem_type_code` — **pertenece al país** |
| `name` | `varchar(250)` | no | etiqueta de presentación |
| `value` | `varchar(250)` | **sí** | **pertenece al código fuente** |
| `isValueLocked` | `boolean` | no | **nueva**, `DEFAULT false` |
| `sortOrder` | `smallint` | no | `CHECK >= 0` |
| `metadata` | `jsonb` | sí | `DEFAULT '{}'` |

Las cuatro transversales están presentes y no se tocan: `isActive`, `deletedAt`, `sysDetails`, `appDetails`.

**La columna nueva:**

```sql
ALTER TABLE "catalogItem"
  ADD COLUMN IF NOT EXISTS "isValueLocked" boolean NOT NULL DEFAULT false;
```

**El índice.** `value` es nullable y hoy **no tiene ninguna restricción de unicidad** — la única que existe es `UQ_catalogItem_type_code`. Congelar un valor que puede estar duplicado no sirve de nada: `findOne` devolvería una fila arbitraria.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_catalogItem_type_lockedValue"
  ON "catalogItem" ("catalogTypeId", "value")
  WHERE "isValueLocked";
```

Es **parcial** a propósito: no impone unicidad a los miles de ítems que ningún archivo de `src/` nombra.

**El predicado no incluye `isActive`.** Un ítem congelado no se puede desactivar (§3.5, `005A`), así que no hay dos filas compitiendo por el mismo `value` en ningún estado.

### 3.2 El conjunto congelado

La regla es literal y greppable: **un `value` se congela si y solo si algún archivo de `src/` resuelve un ítem por él.** Hoy son cinco filas en tres catálogos.

| catalogType | `value` | Quién lo nombra |
|---|---|---|
| `ageUnit` | `YEARS` | `ageRecalculation.service.ts:12`, `age.helper.ts:63` |
| `ageUnit` | `MONTHS` | ídem |
| `ageUnit` | `DAYS` | ídem |
| `outcome` | `DEATH` | `notification.service.ts:18` |
| `investigationStatus` | `UNKNOWN` | `investigation.constants.ts:16` (hoy `'0'`) |

`sex`, `vaccinationMoment`, `healthFacilityType` y el resto **no se congelan**: solo los nombran las suites de contrato, y una suite no es código de producción. Pasarán a resolver por `value` igual que todo el mundo, pero sin candado.

**Acuñado de `investigationStatus`.** Es el único catálogo donde `code` y `value` son ambos numéricos: no hay clave semántica que congelar, hay que crearla. Se alinea con `outcome`, que ya tiene exactamente los mismos seis conceptos:

| `code` | `name` | `value` nuevo |
|---|---|---|
| `0` | Desconocido | `UNKNOWN` |
| `1` | En Recuperación/resolviendo | `RECOVERING` |
| `2` | Recuperado/resuelto | `RECOVERED` |
| `3` | No Recuperado/no Resuelto | `NOT_RECOVERED` |
| `4` | Recuperado/resuelto Con Secuelas | `RECOVERED_WITH_SEQUELAE` |
| `5` | Fallecido | `DEATH` |

### 3.3 El bloque de despliegue

Va en `esaviapp.sql` **después del último `CALL "upsertCatalogItem"` (línea 1744) y antes del `COMMIT`**, para que corra sobre el catálogo ya sembrado.

Tres pasos, en este orden:

1. Los seis `UPDATE` que acuñan el `value` de `investigationStatus`.
2. Un `UPDATE` que normaliza a `CONSTANT_CASE` los `value` sembrados con espacios: `'MEDICAL DOCTOR'` → `MEDICAL_DOCTOR`, `'OTHER HEALTHPROFESSIONAL'` → `OTHER_HEALTHPROFESSIONAL` (`profession`, `esaviapp.sql:1697-1702`).
3. El `UPDATE` que levanta `isValueLocked` sobre las cinco filas de §3.2, resolviendo por `("catalogType".code, "catalogItem".value)` y forzando `isActive = true` en la misma sentencia — una fila congelada nace activa aunque alguien la hubiera retirado antes.

**Es idempotente.** Se ejecuta entero en cada carga de `esaviapp.sql` sin efecto acumulativo.

**No escribe `appDetails` ni `sysDetails`.** Es una operación de despliegue, no una escritura de la aplicación: no hay `authUser` que registrar. Es la misma excepción que ya se concede a `upsertCatalogItem`.

### 3.4 Modelo Sequelize

`src/models/catalogItem.model.ts` — se añade un atributo:

```ts
isValueLocked: boolean;
```

`DataTypes.BOOLEAN`, `allowNull: false`, `defaultValue: false`. Sin cambios en `timestamps`, `freezeTableName` ni asociaciones.

### 3.5 Superficie HTTP

**No hay endpoints nuevos y ningún código de operación cambia.** Se modifica el comportamiento de cinco de los existentes.

```
POST   /api/catalog-items          ESAVI-CATITEM-001   ADMIN       (existe, cambia)
PUT    /api/catalog-items/:id      ESAVI-CATITEM-004   ADMIN       (existe, cambia)
DELETE /api/catalog-items/:id      ESAVI-CATITEM-005A  ADMIN       (existe, cambia)
POST   /api/catalog-items/import   ESAVI-CATITEM-006   SUPERADMIN  (existe, cambia)
GET    /api/catalog-items/:id      ESAVI-CATITEM-003   USER        (existe, cambia la respuesta)
GET    /api/catalog-items/type/:id ESAVI-CATITEM-002A  USER        (existe, cambia la respuesta)
```

El orden de declaración de `catalogItem.routes.ts` no se toca: `/import`, `/type/:id` y `/admin/type/:id` ya van antes de `/:id`.

### 3.6 Reglas de negocio por operación

**`ESAVI-CATITEM-001` — crear.** `value` se normaliza con `toConstantCase` antes de guardarse. `isValueLocked` **nace siempre en `false`** y no se lee del body: si viaja, se ignora en silencio. Un ítem no puede nacer congelado — el candado lo pone el despliegue, no un ADMIN.

**`ESAVI-CATITEM-004` — actualizar.** Existencia → 404 `CATITEM_004_NOT_FOUND`. Unicidad de `code` excluyendo el propio id → 409 `CATITEM_004_CODE_EXISTS`, **antes** del diff. `stored` sale de `item.get({ plain: true })`.

**Si `stored.isValueLocked` es `true`, `value` no entra en `candidates`.** Viaje o no viaje, valga lo que valga. No es un 400 ni un 409: es una omisión silenciosa, idéntica a la que `notificationMedication` ya aplica sobre `sortOrder`. `code`, `name`, `description` y `sortOrder` siguen siendo editables con normalidad — **el país puede recodificar el ítem, que es justamente el escenario que este spec protege.**

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `code` | `data.code ? toCodeFromInput(data.code) : undefined` | sin cambios respecto a hoy |
| `name` | `data.name ? toTitleCase(data.name.trim()) : undefined` | |
| `value` | `stored.isValueLocked ? undefined : (data.value !== undefined ? (data.value ? toConstantCase(data.value) : null) : undefined)` | **congelado ⇒ nunca entra** |
| `description` | `data.description !== undefined ? (data.description ?? null) : undefined` | anulable |
| `sortOrder` | `data.sortOrder !== undefined ? data.sortOrder : undefined` | |
| `isValueLocked` | **nunca** | no editable por API |

Si el diff vuelve vacío se responde 200 con la fila tal como está: sin `UPDATE`, sin `updatedAt`, sin entrada en `appDetails`, sin evento en `sysDetails`.

**`ESAVI-CATITEM-005A` — desactivar. No es un update diferencial**, y sobre un ítem congelado **no se ejecuta**: responde **409** `CATITEM_005A_VALUE_LOCKED`.

La razón: si el código nombra el ítem, el código lo necesita. Retirarlo es un cambio de spec, no una acción de administración. La comprobación va **antes** que la de `alreadyInactive`, para que el mensaje diga la causa real.

**`ESAVI-CATITEM-005B` — activar.** Sin cambios. Un ítem congelado nunca llega a estar inactivo, así que la rama es inalcanzable para él.

**`ESAVI-CATITEM-006` — importar.** Es el camino más peligroso: una importación masiva reescribiría el catálogo entero de una pasada. Para cada fila cuyo ítem destino tenga `isValueLocked` en `true`, **`value` se descarta y el resto de columnas se aplica**. La fila **no** se rechaza ni engrosa `rejected`: no es un error del archivo, es una columna que no se puede escribir. `value` se normaliza con `toConstantCase` en las filas no congeladas.

**`upsertCatalogItem` — el procedimiento.** Es la autoridad que pone los valores congelados y **sí escribe `value`**. Cambia su cláusula de conflicto:

```
ON CONFLICT ("catalogTypeId", "code")
```

resuelve por `code`. Cuando un país cambie el `code` —el escenario que justifica este spec— **no actualizará la fila: insertará una nueva**, y el `value` congelado quedará duplicado. El procedimiento debe resolver primero por `("catalogTypeId", "value")` cuando exista una fila congelada con ese valor, y actualizar su `code` en lugar de insertar.

**Lookups por `value` — la forma canónica.** Los tres sitios de §1.A pasan a:

```
where: { value: '<VALUE>', isValueLocked: true }
include: [{ model: CatalogType, as: 'catalogType', where: { code: '<tipo>' }, attributes: [] }]
```

Tres decisiones, las tres deliberadas:

- **`isValueLocked: true` va en el `where`.** Sin él, un ítem no congelado con el mismo `value` —que el índice parcial permite— haría el lookup ambiguo.
- **No se filtra por `isActive`.** Un ítem retirado sigue nombrando lo que siempre nombró. Es el criterio que `notificationPregnancy.service.ts:177-178` ya fijó, y aquí es además redundante: un congelado no puede desactivarse.
- **El `catalogType` sigue resolviéndose por `code`.** Ese código lo acuña la aplicación en camelCase, no el país, y nunca se rompió.

Los códigos de `AppError` y los status de los tres servicios **no cambian**: lo único que cambia es la columna por la que buscan.

### 3.7 Claves i18n nuevas

Una sola. Va en `src/data/i18n/es.json`, `en.json` y `nl.json`.

| Clave | Uso |
|---|---|
| `catalogItem.valueLocked` | 409 al intentar desactivar un ítem con `isValueLocked` en `true` |

`DEFAULT_INVESTIGATION_STATUS_CODE` pasa a llamarse `DEFAULT_INVESTIGATION_STATUS_VALUE` y su contenido de `'0'` a `'UNKNOWN'` (`src/constants/investigation.constants.ts:16`). El mensaje `investigation.defaultStatusMissing` interpola `{{code}}` y se conserva tal cual: sigue siendo el identificador que el operador debe buscar.

### 3.8 Forma de la respuesta

`isValueLocked` **se expone** en `002A`, `002B` y `003`:

```
{ ok, message, data: {
    catalogItemId, catalogTypeId, code, name, value, isValueLocked,
    description, sortOrder, metadata, isActive,
    createdAt, updatedAt, deletedAt, appDetails
} }
```

Es la contrapartida del ignorado silencioso: el servidor calla, pero el contrato lo dice, así que la interfaz puede deshabilitar el campo y el usuario nunca cree que guardó algo que no se guardó.

---

## 4. Plan de implementación

1. **La columna y el índice.** `ALTER TABLE` y `CREATE UNIQUE INDEX` en `esaviapp.sql`; atributo `isValueLocked` en `src/models/catalogItem.model.ts`.
   *Verificación:* `psql -f esaviapp.sql` sale en 0 sobre una base limpia; `\d "catalogItem"` muestra la columna y el índice parcial.

2. **El bloque de despliegue.** Los tres pasos de §3.3 antes del `COMMIT`.
   *Verificación:* tras cargar, `SELECT code, value FROM "catalogItem" WHERE "isValueLocked"` devuelve exactamente cinco filas, las de §3.2; cargar dos veces seguidas da el mismo resultado.

3. **`ESAVI-CATITEM-001` y la normalización.** `toConstantCase` sobre `value` en `catalogItem.service.ts:120`; `isValueLocked` fuera del input.
   *Verificación:* crear con `value: "  medical doctor "` guarda `MEDICAL_DOCTOR`; enviar `isValueLocked: true` en el body deja la fila en `false`.

4. **`ESAVI-CATITEM-004`.** La fila `value` de la tabla de `candidates` de §3.6.
   *Verificación:* un `PUT` con `value` nuevo sobre un congelado responde 200 y no escribe nada; el mismo `PUT` sobre uno no congelado sí escribe.

5. **`ESAVI-CATITEM-005A`.** El 409 `CATITEM_005A_VALUE_LOCKED` antes de la comprobación de `alreadyInactive`, con la clave i18n en los tres idiomas.
   *Verificación:* `DELETE` sobre el ítem `YEARS` responde 409; sobre uno cualquiera de `sex`, 200.

6. **`ESAVI-CATITEM-006`.** El descarte de `value` por fila en `catalogItem.service.ts:457,482`.
   *Verificación:* importar un archivo que cambia el `value` de `YEARS` y su `name` deja el `value` intacto y aplica el `name`, sin engrosar `rejected`.

7. **`upsertCatalogItem`.** Resolución por `("catalogTypeId", "value")` cuando hay fila congelada.
   *Verificación:* ejecutar el `CALL` de `ageUnit`/`YEARS` con un `pItemCode` distinto actualiza la fila existente en vez de insertar una segunda.

8. **Los tres lookups de producción.** `ageRecalculation.service.ts`, `classification.service.ts` y `notification.service.ts` migran a la forma canónica de §3.6. En el mismo paso, `investigation.constants.ts` pasa a `DEFAULT_INVESTIGATION_STATUS_VALUE = 'UNKNOWN'` y `investigation.service.ts:186` a buscar por `value`.
   *Verificación:* `npx jest tests/contract/classification.test.ts tests/contract/notification.test.ts tests/contract/investigation.test.ts` en verde.

9. **[DEUDA-044](../../TECHNICAL_DEBT.md#deuda-044).** `normalizeOrganization` (`esaviCase.service.ts:32`) pasa de `.toUpperCase()` a `toTitleCase`. Manda el SPEC F06, que lo declara en tres sitios (`06-esavicase-crud.md:38,76,156`), y es lo que el test ya afirma. `normalizeCountryIsoCode` se queda en mayúsculas: un ISO 3166-1 alfa-2 lo es por definición.
   *Verificación:* `npx jest tests/contract/esaviCase.test.ts -t "creates a case"` en verde.

10. **Las cuatro suites que contaminan.** `classification`, `notification`, `esaviCase` y `patient` dejan de crear ítems: resuelven por `value` contra los sembrados. Se borran los comentarios que afirman que el seed no los carga.
    *Verificación:* tras la suite, `SELECT count(*) FROM "catalogItem" ci JOIN "catalogType" ct USING("catalogTypeId") WHERE ct.code='ageUnit'` devuelve 3, no 6.

11. **Las cinco suites rojas restantes.** `patient` y `healthFacility` resuelven `FEMALE` y `HOSPITAL` por `value`; `investigationVaccinationContext` sus cuatro ítems por `value` (`'0'` → `'UNKNOWN'`); `investigationMedicalHistory` cambia `CatalogType.create()` por *find-or-create*; `notificationMedication` hace lo mismo con los tipos `pharmaceuticalForm` y `administrationRoute`, que el seed no carga; `finalClassification` ajusta la expectativa de `name` a `'1'`.
    *Verificación:* las cinco suites en verde ejecutadas juntas.

12. **La suite de contrato del candado.** Bloque nuevo en `tests/contract/catalogItem.test.ts` que cubre los cuatro caminos de escritura, el 409 de `005A`, el índice único parcial y la exposición de `isValueLocked` en las tres lecturas.
    *Verificación:* `npm run check` sale en 0.

---

## 5. Criterios de aceptación

- [ ] `esaviapp.sql` carga en 0 sobre una base limpia, dos veces seguidas, con el mismo resultado.
- [ ] `SELECT count(*) FROM "catalogItem" WHERE "isValueLocked"` devuelve **5**, y son las filas de §3.2.
- [ ] Insertar un segundo ítem congelado con el mismo `("catalogTypeId","value")` viola `UQ_catalogItem_type_lockedValue`.
- [ ] Insertar dos ítems **no** congelados con el mismo `("catalogTypeId","value")` se acepta.
- [ ] Los seis ítems de `investigationStatus` tienen `value` semántico; `SELECT value FROM ... WHERE code='0'` devuelve `UNKNOWN`.
- [ ] Ningún `value` de `profession` contiene un espacio.
- [ ] `POST /api/catalog-items` con `value: "  medical doctor "` guarda `MEDICAL_DOCTOR` y `isValueLocked: false`.
- [ ] `POST /api/catalog-items` con `isValueLocked: true` en el body guarda `false` y responde **201**, no 400.
- [ ] `PUT` sobre un ítem congelado con un `value` distinto responde **200** y deja `value` intacto.
- [ ] Ese mismo `PUT` **no** escribe: `appDetails` no crece, `sysDetails.version` no avanza, `updatedAt` no se mueve.
- [ ] `PUT` sobre un ítem congelado que cambia `code` **sí** escribe y deja `value` intacto.
- [ ] `POST /api/catalog-items/import` con una fila que cambia el `value` de un congelado y su `name` aplica el `name`, ignora el `value` y **no** añade la fila a `rejected`.
- [ ] `DELETE /api/catalog-items/:id` sobre un congelado responde **409** con `code: 'CATITEM_005A_VALUE_LOCKED'`.
- [ ] `GET /api/catalog-items/:id` incluye `isValueLocked` en `data`.
- [ ] `grep -rn "'YEARS'\|'MONTHS'\|'DAYS'" src/services/` no devuelve ningún `where: { code`.
- [ ] `grep -n "DEATH_OUTCOME_CODE" src/services/notification.service.ts` resuelve por `value`.
- [ ] `grep -rn "DEFAULT_INVESTIGATION_STATUS_CODE" src/` no devuelve resultados.
- [ ] Crear una notificación con el ítem `Fallecido` de `outcome` dispara la regla de defunción.
- [ ] Tras la suite completa, `ageUnit` tiene 3 ítems y `outcome` 6 — ninguna suite crea duplicados.
- [ ] `POST /api/esavi-cases` con `notificationOrganization: "ministerio de salud"` devuelve `Ministerio De Salud`.
- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] **`npm run check` sale en 0.** Es el primer spec desde `399521f` que puede afirmarlo.

**Bloque obligatorio de update diferencial** (`ESAVI-CATITEM-004`):

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/catalogItem.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404**, y con un `code` ya ocupado **409**, aunque el resto del body no cambie nada.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** reutilizar `value` en vez de añadir una columna `systemKey`. La clave semántica **ya está en `value`** desde `399521f`: no hay migración de datos, solo un `UPDATE` de realineación.
- **Sí:** `isValueLocked` y no `isValueEditable`. El comportamiento acordado es «si está en `true`, la escritura se ignora» — eso es un candado, no un permiso. `isValueEditable = true` leído en frío significa lo contrario de lo que hace, y esa inversión sobrevive al spec y muerde dentro de dos años en un `if`.
- **Sí:** índice único **parcial**. Imponer unicidad global de `value` rompería catálogos legítimos donde dos ítems comparten payload.
- **Sí:** ignorado silencioso en `004` y `006`, con `isValueLocked` expuesto en las lecturas. El silencio es idiomático aquí —`notificationMedication` ya lo hace con `sortOrder`—, y exponer el flag evita que la interfaz ofrezca un campo que no se va a guardar.
- **Sí:** congelar solo lo que `src/` nombra. Cinco filas, no las 90 del seed. Un candado que cubre lo que nadie usa es ruido, y hace ilegible qué depende de qué.
- **No:** prefijar con `_` el `value` de un ítem congelado al desactivarlo. Era la salida propuesta para evitar la colisión del índice único, y **deshace la decisión de resolver sin filtrar por `isActive`**: si `YEARS` pasa a `_YEARS`, el lookup por `YEARS` deja de encontrarlo, que es exactamente el fallo que este spec elimina. Además es una escritura sobre la columna que el spec entero existe para congelar, y `_YEARS` no es `CONSTANT_CASE`.
- **No:** permitir desactivar un ítem congelado. Es la alternativa al guion bajo y resuelve el mismo problema por eliminación: sin dos filas compitiendo por un `value`, la colisión no llega a existir. Si el código nombra el ítem, el código lo necesita.
- **No:** meter `isActive` en el predicado del índice parcial. Liberaría el `value` de un ítem retirado, pero permitiría dos filas congeladas con el mismo `value` —una activa y una inactiva— y volvería ambiguo el lookup que no filtra por estado.
- **No:** congelar `finalClassificationImportance`. `finalClassification.service.ts:229` valida el ítem contra el **tipo**, nunca resuelve un ítem por su código. Su fallo es una expectativa de `name` en un test, y se corrige en el test.
- **No:** descomentar `administrationRoute` y `pharmaceuticalForm` en el seed. `notificationMedication` se fabrica sus propios ítems con sufijo aleatorio y solo necesita que el `catalogType` exista; hacer resiliente el fixture es más barato y no toca datos de despliegue por una razón que desconocemos.
- **No:** un endpoint para congelar y descongelar. El candado protege al código de la administración: ponerlo bajo un endpoint de administración lo vacía de sentido.
- **No:** migrar `PREGNANCY_FEMALE_SEX_ITEM` de `systemConfig` a un `value` congelado. Qué ítem significa «femenino» depende del catálogo que adopte cada país; es configuración legítima, no una constante del dominio. Los dos mecanismos conviven y responden a preguntas distintas.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Un cliente lee `value` como texto de presentación y ve `MEDICAL_DOCTOR` donde leía `MEDICAL DOCTOR` | `name` es el campo de presentación y no se toca. Afecta a `profession`, dos filas. Conviene avisar a los consumidores |
| El seed se recarga sobre una base con `code` ya recodificado por el país e inserta filas duplicadas | El paso 7 hace que `upsertCatalogItem` resuelva por `value` congelado. Si aun así colisiona, el índice único revienta **ruidosamente en el despliegue**, que es infinitamente mejor que la corrupción silenciosa de hoy |
| Un ítem congelado que ya estaba inactivo antes del despliegue | El `UPDATE` del paso 3 de §3.3 fuerza `isActive = true` en la misma sentencia |
| `005A` deja de funcionar sobre ítems que alguien retiraba habitualmente | Solo alcanza a cinco filas, las que el código nombra. Ninguna es candidata legítima de retiro |
| Congelar hoy cinco valores y olvidar el sexto cuando un spec futuro añada un lookup | El criterio de §3.2 es greppable: todo lookup nuevo por `value` obliga a una fila en el bloque de §3.3. Va al checklist de PR de `CONVENTIONS.md` §15 |

---

## 8. Impacto en el contrato HTTP

Tres cambios visibles para los clientes actuales:

- **`GET /api/catalog-items/*` incorpora `isValueLocked`** a cada fila. Campo nuevo, aditivo: ningún cliente existente se rompe.
- **`DELETE /api/catalog-items/:id` puede responder 409** donde antes siempre respondía 200 o 404. Solo sobre las cinco filas congeladas.
- **`PUT /api/catalog-items/:id` deja de escribir `value`** en las cinco filas congeladas, en silencio y con 200. Un cliente que dependa de poder editarlas cambia de comportamiento sin recibir error; `isValueLocked` en la lectura es lo que se lo anticipa.

Y uno que corrige una divergencia declarada: **`notificationOrganization` pasa a devolverse en Title Case**, tal como el SPEC F06 lo especificó desde el principio.

---

## Lo que **no** está en este spec

- Descomentar `administrationRoute` y `pharmaceuticalForm` en el seed.
- Congelar `finalClassificationImportance` o cualquier catálogo que `src/` no nombre.
- Un endpoint para congelar o descongelar valores en caliente.
- Sustituir el `systemConfig` de `PREGNANCY_FEMALE_SEX_ITEM` por un `value` congelado.
- Búsqueda o filtrado de `catalogItem` por `value`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
