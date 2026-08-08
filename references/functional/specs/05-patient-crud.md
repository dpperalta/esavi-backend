# SPEC F05 — CRUD completo de patient

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), SPEC F04 (patrón de cifrado PII sobre `appUser`)
> **Fecha:** 2026-08-05
> **Objetivo:** Dar de alta la entidad `patient` con sus siete artefactos, sus siete operaciones canónicas y un endpoint de búsqueda por identificador, cifrando los datos personales del paciente.

---

## 1. Por qué existe este spec

`patient` es la raíz del núcleo ESAVI. `esaviCase.patientId` es `NOT NULL` con `ON DELETE RESTRICT` (`esaviapp.sql:663`): **no existe un caso sin paciente**. Mientras la tabla no tenga modelo, ninguna de las cinco tablas del núcleo ni las veintitrés de notificación e investigación pueden implementarse — todas cuelgan de un caso, y el caso cuelga de aquí. Es la primera pieza del dominio clínico y la que desbloquea el resto.

Hoy la tabla existe en `esaviapp.sql:620-644` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta. Un paciente solo se puede cargar por SQL directo.

Tres características la separan de las ocho entidades ya implementadas:

**A — Es la primera entidad de datos de salud identificables.** `appUser` cifra cinco campos, pero describe a un empleado de la organización. `patient` describe a una persona atendida: nombre, documento, fecha de nacimiento, residencia y correo, todo junto y todo vinculable a un evento adverso. El cifrado deja de ser una decisión de higiene para ser el requisito central de la entidad.

**B — No tiene `code` ni `name`.** Todas las entidades implementadas se identifican por un `code` normalizado con `toConstantCase` y un `name` con `toTitleCase`. `patient` no tiene ninguno de los dos: se identifica por `documentNumber`, que es un dato de la persona y no un código del sistema. Eso hace que la clave i18n canónica `codeExists` no aplique y que el identificador legible haya que **generarlo**.

**C — El DDL permite crear una fila fantasma.** Las once columnas de negocio son nulas. Un `INSERT` vacío produce un paciente sin nombre, sin documento y sin fecha de nacimiento, que ningún listado sabe representar y que ningún caso debería poder referenciar. La aplicación tiene que imponer el mínimo que el esquema no impone.

A eso se suma una ausencia respecto a `healthFacility`: el DDL declara `TRG_healthFacility_validateCatalogs` para validar que `facilityTypeItemId` pertenece a su catálogo, pero **no hay trigger equivalente para `patient.sexItemId`** (`esaviapp.sql:1296-1299`). Aquí no hay red de seguridad en la base: si el servicio no valida el catálogo, cualquier `catalogItem` activo entra como sexo.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `patient`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Las siete operaciones canónicas: `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- Una operación no canónica: `ESAVI-PATIENT-006`, búsqueda por identificador contra `documentNumber`, `passportNumber` y `healthSystemCode` en un solo `Op.or`.
- Cifrado con `esaviCrypt` de siete campos: `firstName`, `middleName`, `lastName`, `secondLastName`, `documentNumber`, `passportNumber` y `email`. `phoneNumber`, `healthSystemCode` y `birthDate` quedan en claro.
- Generación por el sistema de `healthSystemCode`: 12 caracteres sobre alfabeto Crockford Base32, con `crypto.randomBytes`. Nunca recibido del cliente, nunca modificable.
- Mínimos que el DDL no impone: `firstName`, `lastName` y `documentNumber` obligatorios en el alta.
- Unicidad global de `documentNumber` sobre el valor ya normalizado y cifrado, sin filtrar por `isActive`, excluyendo el propio registro en update con `[Op.ne]`.
- Validación de las dos FK en create **y** en update: `sexItemId` activo y perteneciente a `catalogType.code = 'sex'`; `residenceGeoLocationId` activo.
- Normalización en escritura: `toTitleCase` en los cuatro campos de nombre, `.trim().toUpperCase()` en `documentNumber` y `passportNumber`, `.trim().toLowerCase()` en `email` — todo **antes** de cifrar.
- Rechazo de `birthDate` en el futuro. La fecha de hoy es el máximo admitido.
- Alta de la abreviatura `PATIENT` en `references/CONVENTIONS.md` §6, y de `ESAVI-PATIENT-006` en la tabla de operaciones no canónicas de la misma sección.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Ocho filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/patient.test.ts`.

**Fuera de alcance (otros specs):**

- `esaviCase` y el resto del núcleo ESAVI. Este spec deja `patient` listo para que cuelguen de ella, pero no crea ninguna.
- Bloquear la desactivación de un paciente con casos ESAVI activos. Se decidió permitirla sin comprobar nada; `esaviCase` no tiene modelo todavía.
- Búsqueda o filtrado por nombre, correo o fecha de nacimiento. Sobre campos cifrados solo cabe la igualdad exacta, y `birthDate` en claro no justifica por sí sola un motor de filtros.
- Ordenar los listados por nombre o apellido. Ordenaría por el criptograma.
- Deduplicación de pacientes: detectar que dos filas son la misma persona con documentos distintos, o fusionarlas.
- Carga masiva de pacientes con `healthSystemCode` preexistente.
- Añadir restricciones al DDL — `UQ_patient_healthSystemCode`, `UQ_patient_passportNumber` o cualquier otra. `esaviapp.sql` no se toca.
- Cifrar `phoneNumber` o `healthSystemCode`, cambiar el esquema de `esaviCrypt` o migrar datos ya cifrados.
- Exponer o editar `sysDetails`.
- Registrar quién consultó los datos de un paciente. La auditoría de `appDetails` cubre escrituras, no lecturas.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`patient` — `esaviapp.sql:620-644`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `patientId` | `uuid` | no | PK, `gen_random_uuid()` |
| `firstName` | `varchar(150)` | sí | cifrado; la aplicación lo exige en el alta |
| `middleName` | `varchar(150)` | sí | cifrado |
| `lastName` | `varchar(150)` | sí | cifrado; la aplicación lo exige en el alta |
| `secondLastName` | `varchar(150)` | sí | cifrado |
| `birthDate` | `date` | sí | en claro; no se admite futura |
| `documentNumber` | `varchar(100)` | sí | `UQ_patient_documentNumber` — unicidad global; cifrado; la aplicación lo exige en el alta |
| `passportNumber` | `varchar(100)` | sí | cifrado; **sin** `UNIQUE` en el DDL |
| `email` | `citext` | sí | cifrado; **sin** `UNIQUE` en el DDL |
| `phoneNumber` | `varchar(50)` | sí | en claro |
| `healthSystemCode` | `varchar(100)` | sí | en claro; generado por el sistema; **sin** `UNIQUE` en el DDL |
| `sexItemId` | `uuid` | sí | `FK_patient_sex` → `catalogItem`, `ON DELETE RESTRICT` |
| `residenceGeoLocationId` | `uuid` | sí | `FK_patient_residenceGeo` → `geoLocation`, `ON DELETE RESTRICT` |

Índice: `IX_patient_residenceGeo` sobre `residenceGeoLocationId`.

Las cuatro columnas transversales están presentes y completas: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB array), más `createdAt` y `updatedAt`. No hay anomalía que resolver antes de implementar.

Dos triggers genéricos alcanzan a la tabla: `TRG_patient_setSysDetails` y `TRG_patient_preventPhysicalDelete` (`esaviapp.sql:1367`). El segundo hace que un `DELETE` físico falle en la base: el borrado lógico no es una preferencia de diseño, es la única vía.

**No existe** trigger de validación de catálogo para `sexItemId`. La validación es responsabilidad exclusiva del servicio.

### 3.2 Modelo Sequelize

Archivo: `src/models/patient.model.ts`. Clase `Patient`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'patient'`. PK `patientId` con `defaultValue: sequelize.literal('gen_random_uuid()')`. `email` como `CITEXT`, igual que en `healthFacility.model.ts`. `birthDate` como `DATEONLY` — no `DATE`: la columna es `date` y `DATE` arrastraría zona horaria y desplazaría la fecha de nacimiento un día según el huso.

Todos los campos de negocio van `allowNull: true`, calcando el DDL. La obligatoriedad de `firstName`, `lastName` y `documentNumber` vive en el **validador**, no en el modelo: son mínimos de la aplicación, no del esquema, y ponerlos en el modelo haría imposible representar filas ya cargadas.

Asociaciones, en `src/models/associations/patient.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `Patient.belongsTo(CatalogItem, { as: 'sex', foreignKey: 'sexItemId' })`
- `Patient.belongsTo(GeoLocation, { as: 'residence', foreignKey: 'residenceGeoLocationId' })`

Ninguna de las dos va dentro del archivo del modelo. Alta en `src/models/index.ts`.

### 3.3 Tipos

`src/types/patient/patient.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`. El barrel del dominio es obligatorio: `src/types/healthFacility/` no lo tiene y eso está catalogado como deuda; no se repite.

```ts
export interface CreatePatientInput {
    firstName: string;
    lastName: string;
    documentNumber: string;
    middleName?: string | null;
    secondLastName?: string | null;
    birthDate?: string | null;
    passportNumber?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    sexItemId?: string | null;
    residenceGeoLocationId?: string | null;
    isActive?: boolean;
}
```

`healthSystemCode` **no aparece en la interfaz**. Lo genera el servicio; si el cliente lo manda, se ignora sin error.

El update usa `Partial<CreatePatientInput>`. No se declara `UpdatePatientInput`.

### 3.4 Superficie HTTP

```
POST   /api/patients                       ESAVI-PATIENT-001   USER        (nuevo)
GET    /api/patients                       ESAVI-PATIENT-002A  USER        (nuevo)
GET    /api/patients/admin                 ESAVI-PATIENT-002B  ADMIN       (nuevo)
GET    /api/patients/search/:identifier    ESAVI-PATIENT-006   USER        (nuevo)
GET    /api/patients/:id                   ESAVI-PATIENT-003   USER        (nuevo)
PUT    /api/patients/:id                   ESAVI-PATIENT-004   USER        (nuevo)
DELETE /api/patients/:id                   ESAVI-PATIENT-005A  ADMIN       (nuevo)
PATCH  /api/patients/activate/:id          ESAVI-PATIENT-005B  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/patient.routes.ts`: las rutas literales (`/admin`, `/search/:identifier`, `/activate/:id`) van **antes** de `/:id`, o Express capturará `admin` y `search` como un `:id` y el validador de UUID responderá 400.

`ESAVI-PATIENT-006` se registra en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6, junto a las tres de `appUserGeoLocation`.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es deliberado: quien registra un ESAVI es personal operativo, y necesita dar de alta al paciente que todavía no existe. Con `create` en ADMIN el flujo se corta a la mitad. `005A` se queda en ADMIN y `005B` en SUPERADMIN: dar de baja a una persona del registro no es parte del flujo de notificación.

### 3.5 Reglas de negocio por operación

**`ESAVI-PATIENT-001` — crear.** En este orden:

1. Normaliza: `toTitleCase` sobre los cuatro nombres, `.trim().toUpperCase()` sobre `documentNumber` y `passportNumber`, `.trim().toLowerCase()` sobre `email`.
2. Cifra los siete campos PII con `esaviCrypt`, **después** de normalizar. El orden importa: cifrar antes de normalizar produce el criptograma del texto crudo y la unicidad deja de funcionar.
3. Unicidad de `documentNumber` sobre el valor ya cifrado, **sin filtrar por `isActive`** → 409 `PATIENT_001_DOCUMENT_EXISTS`.
4. Si viene `sexItemId`: existe, `isActive: true` y su `catalogType.code` es `'sex'` → 404 `PATIENT_001_SEX_NOT_FOUND`.
5. Si viene `residenceGeoLocationId`: existe y `isActive: true` → 404 `PATIENT_001_GEOLOC_NOT_FOUND`.
6. Genera `healthSystemCode`: 12 caracteres del alfabeto Crockford Base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, extraídos de `crypto.randomBytes`. **Sin comprobar unicidad** y sin leer la tabla.
7. Inserta con la entrada de auditoría `method: 'ESAVI-PATIENT-001'`.

No se comprueba unicidad de `email` ni de `passportNumber`: el DDL no la impone y dos hermanos pueden compartir el correo de un tutor.

**`ESAVI-PATIENT-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, includes `sex` y `residence`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. **El orden no puede ser alfabético**: los nombres están cifrados y `ORDER BY "lastName"` ordenaría por el criptograma. Sin filtros más allá de `limit` y `offset`. Devuelve la forma reducida de §3.7.

**`ESAVI-PATIENT-002B` — listar, admin.** Idéntica, sin `isActive` en el `where`.

**`ESAVI-PATIENT-003` — obtener por ID.** `where` con `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero → 404 `PATIENT_003_NOT_FOUND`. Devuelve la forma completa de §3.7 con los siete campos descifrados.

**`ESAVI-PATIENT-004` — actualizar.** En este orden:

1. Existencia → 404 `PATIENT_004_NOT_FOUND`.
2. Si viene `documentNumber`, normalizado, cifrado y distinto del actual: unicidad excluyendo el propio id con `{ [Op.ne]: id }` → 409 `PATIENT_004_DOCUMENT_EXISTS`.
3. Si viene `sexItemId`: mismas tres condiciones que en `001` → 404 `PATIENT_004_SEX_NOT_FOUND`.
4. Si viene `residenceGeoLocationId`: existe y activo → 404 `PATIENT_004_GEOLOC_NOT_FOUND`.
5. `healthSystemCode` **se ignora siempre**, venga o no en el body.
6. Preserva el historial con `[...currentAppDetails, newEntry]`.

**`ESAVI-PATIENT-005A` / `005B` — desactivar y reactivar.** `setPatientActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, calculando `const op = isActive ? '005B' : '005A'`. El `where` filtra **solo por la PK**. **No se comprueba ninguna referencia entrante**: ni `esaviCase` ni ninguna otra. `DELETE` sella `deletedAt`; `PATCH /activate` lo deja en `null`. Ambos responden `{ ok, message }` sin `data`.

**`ESAVI-PATIENT-006` — buscar por identificador.** Normaliza el segmento con `.trim().toUpperCase()`, lo cifra una vez y lanza un solo `findAndCountAll` con:

```
where: { [Op.or]: [
    { documentNumber:   esaviCrypt(normalized) },
    { passportNumber:   esaviCrypt(normalized) },
    { healthSystemCode: normalized }
] }
```

`healthSystemCode` entra **en claro**: es el único de los tres sin cifrar. Respeta `canViewInactive` igual que `003`. Sin coincidencias devuelve **200** con `{ count: 0, rows: [] }` y el mensaje `patient.searchEmpty` — nunca 404: una búsqueda sin resultados es un resultado, no un recurso ausente. Devuelve la forma reducida de §3.7, paginada.

### 3.6 Claves i18n nuevas

Bloque `patient` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` |
| `getSuccessPlural` / `getFailedPlural` | `002A`, `002B` y `006` con resultados |
| `updatedSuccess` / `updatedFailed` | `004` |
| `deletedSuccess` / `deletedFailed` | `005A` |
| `activatedSuccess` / `activatedFailed` | `005B` |
| `notFound` | 404 en `003`, `004`, `005A` y `005B` |
| `idRequired` | parámetro ausente |
| `alreadyActive` / `alreadyInactive` | 409 de `setEntityActiveStatusService` |
| `documentExists` | 409 al crear o actualizar con un documento ya registrado |
| `sexNotFound` | 404 cuando `sexItemId` no existe, está inactivo o no es del catálogo `sex` |
| `geoLocationNotFound` | 404 cuando `residenceGeoLocationId` no existe o está inactivo |
| `searchEmpty` | 200 de `006` sin coincidencias — «No existen resultados de la búsqueda» |
| `identifierRequired` | segmento `:identifier` vacío en `006` |

No hay `codeExists`: `patient` no tiene `code`. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos.

### 3.7 Forma de la respuesta

**Completa** — `003`:

```
{ ok, message, data: {
    patientId, firstName, middleName, lastName, secondLastName,
    birthDate, documentNumber, passportNumber, email, phoneNumber,
    healthSystemCode, isActive, createdAt, updatedAt, deletedAt, appDetails,
    sex:       { catalogItemId, code, name },
    residence: { geoLocationId, name, geoLevelTypeId, level }
} }
```

**Reducida** — `002A`, `002B` y `006`, dentro de `{ count, rows }`:

```
{ patientId, firstName, lastName, documentNumber, birthDate,
  healthSystemCode, isActive,
  sex:       { catalogItemId, code, name },
  residence: { geoLocationId, name } }
```

La reducida omite `email`, `phoneNumber`, `passportNumber`, `middleName` y `secondLastName`: un listado no tiene por qué volcar el correo y el teléfono de cada persona de la página. Quien los necesita entra por `003`.

`sysDetails` **nunca** se devuelve, en ninguna operación. Los siete campos cifrados llegan **descifrados** con `esaviDecrypt` en las seis operaciones que devuelven paciente. `001` y `004` devuelven la forma completa del registro afectado.

---

## 4. Plan de implementación

Cada paso deja el sistema compilando y arrancable, y puede committearse solo. Los tres primeros son de base: sin ellos ningún endpoint existe.

1. **Modelo, asociaciones y tipos.** `src/models/patient.model.ts` con `birthDate` como `DATEONLY` y `email` como `CITEXT`; `src/models/associations/patient.associations.ts` con `sex` y `residence`, registrado en `initModels()`; `src/types/patient/patient.types.ts` con `CreatePatientInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `Patient.findAndCountAll({ include: ['sex', 'residence'] })` desde un script suelto devuelve filas sin error de asociación.

2. **Claves i18n.** El bloque `patient` completo de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

3. **Helper de generación del código.** `generateHealthSystemCode()` en `src/helpers/identifier.helper.ts` — archivo nuevo, registrado en `src/helpers/index.ts`. Doce caracteres tomados de `crypto.randomBytes` sobre el alfabeto `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, sin lectura de base de datos. El sesgo del módulo se evita descartando los bytes ≥ 248 en vez de aplicar `% 32` a ciegas.
   *Verificación:* diez mil invocaciones devuelven diez mil cadenas de 12 caracteres, todas distintas, ninguna con `I`, `L`, `O` ni `U`.

4. **Validadores.** `src/validators/patient.validator.ts` con los cinco arrays: `patientIdValidator`, `patientListValidator`, `patientIdentifierValidator` (segmento de `006`: no vacío, máximo 100 caracteres), `createPatientValidator` (`firstName`, `lastName` y `documentNumber` obligatorios; `birthDate` con `.isISO8601()` y rechazo de fechas posteriores a hoy; `sexItemId` y `residenceGeoLocationId` con `.isUUID()` opcional) y `updatePatientValidator` (todo opcional, mismas reglas de formato). Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los tres validadores obligatorios de §4 de las convenciones existen aunque aún no haya rutas que los usen.

5. **`ESAVI-PATIENT-001` — crear.** `createPatientService` con los siete pasos de §3.5 en ese orden: normalizar, cifrar, unicidad de documento, las dos FK, generar el código, insertar con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* crear con `firstName: "juan carlos"` guarda el cifrado de `Juan Carlos`; con `documentNumber: "  1712345678-k  "` guarda el cifrado de `1712345678-K`; repetir ese documento devuelve **409**, no 500; un `sexItemId` del catálogo `healthFacilityType` devuelve **404**; la respuesta trae un `healthSystemCode` de 12 caracteres que nadie envió; enviar `healthSystemCode: "MIO"` en el body no lo cambia.

6. **`ESAVI-PATIENT-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, includes `sex` y `residence`, orden `createdAt DESC`, paginación, forma reducida de §3.7 y los campos cifrados descifrados. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve pacientes inactivos y `/admin` sí; un USER recibe 403 en `/admin`; ninguna fila trae `email`, `phoneNumber` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total.

7. **`ESAVI-PATIENT-003` — obtener por ID.** `getPatientByIdService(id, lang, includeInactive)` con los dos includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; un paciente desactivado devuelve 404 para USER y 200 para ADMIN; los siete campos PII llegan legibles; `sysDetails` no aparece.

8. **`ESAVI-PATIENT-006` — buscar por identificador.** `searchPatientsByIdentifierService` con el `Op.or` de tres condiciones de §3.5, paginado, forma reducida. Ruta `GET /search/:identifier` en USER, declarada antes de `/:id`. El controlador elige el mensaje: `getSuccessPlural` si `count > 0`, `searchEmpty` si `count === 0`.
   *Verificación:* buscar el documento de un paciente lo encuentra; buscar su pasaporte lo encuentra; buscar su `healthSystemCode` lo encuentra; buscar en minúsculas encuentra igual; un valor inexistente devuelve **200** con `count: 0` y el mensaje de búsqueda vacía; dos pacientes con el mismo pasaporte devuelven `count: 2`.

9. **`ESAVI-PATIENT-004` — actualizar.** `updatePatientService` con los seis pasos de §3.5 y el patrón `objectToUpdate` del repositorio. Ruta `PUT /:id` en USER.
   *Verificación:* poner el documento de otro paciente devuelve 409; un `residenceGeoLocationId` inactivo devuelve 404; enviar `healthSystemCode` no lo modifica; un PUT sin cambios devuelve 200 con una entrada más en `appDetails` y las anteriores intactas.

10. **`ESAVI-PATIENT-005A` y `005B` — desactivar y reactivar.** `setPatientActivationService` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El `where` filtra solo por la PK. Dos controladores y dos rutas: `DELETE /:id` en ADMIN, `PATCH /activate/:id` en SUPERADMIN, ambas respondiendo sin `data`.
    *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve 409 `ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe 403 en `PATCH /activate/:id`.

11. **Registrar la entidad en las convenciones.** Fila `patient` → `PATIENT` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `patient` → `006` → «búsqueda por identificador — documento, pasaporte o código de sistema» en la tabla de operaciones no canónicas de la misma sección.
    *Verificación:* la abreviatura aparece una sola vez en la tabla y no colisiona con las nueve existentes.

12. **Cubrir las ocho rutas en `tests/auth/roles.test.ts`.** Ocho filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **43 a 51**.
    *Verificación:* `npm test -- roles` pasa.

13. **Suite de contrato `tests/contract/patient.test.ts`.** Recorrido completo con `supertest`, siguiendo el molde de `healthFacility.test.ts`: crear → obtener por ID → buscar por los tres identificadores → actualizar → listar público y admin → desactivar → reactivar. Más los caminos de error: documento duplicado en create y en update (409), `sexItemId` de otro catálogo (404), `residenceGeoLocationId` inactivo (404), `birthDate` futura (400), alta sin `documentNumber` (400), y búsqueda sin resultados (200 con `count: 0`). Verifica además que los campos llegan descifrados y que `sysDetails` no aparece en ninguna respuesta.
    *Verificación:* `npm test` en verde.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las ocho rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones.
- [ ] `grep -rn "ESAVI-PATIENT-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-PATIENT-00[789]" src/` no devuelve resultados: la búsqueda es una sola operación, `006`.
- [ ] `PATIENT` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/patient/index.ts` está presente.
- [ ] `GET /api/patients/admin` y `GET /api/patients/search/XYZ` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.

**Cifrado y normalización**

- [ ] Crear con `firstName: "juan carlos"` guarda el cifrado de `Juan Carlos`.
- [ ] Crear con `documentNumber: "  1712345678-k  "` guarda el cifrado de `1712345678-K`, y buscarlo en minúsculas por `006` lo encuentra.
- [ ] Crear con `email: "  JUAN@Correo.EC  "` guarda el cifrado de `juan@correo.ec`.
- [ ] Los siete campos PII llegan **descifrados** en las seis operaciones que devuelven paciente.
- [ ] `sysDetails` no aparece en ninguna respuesta de ninguna operación.
- [ ] Los listados y `006` no devuelven `email`, `phoneNumber`, `passportNumber`, `middleName` ni `secondLastName`.

**`healthSystemCode`**

- [ ] Crear devuelve un `healthSystemCode` de exactamente 12 caracteres.
- [ ] Ningún código generado contiene `I`, `L`, `O` ni `U`.
- [ ] Enviar `healthSystemCode` en el body de `POST /` no altera el código generado.
- [ ] Enviar `healthSystemCode` en el body de `PUT /:id` deja el código intacto.
- [ ] `CreatePatientInput` no declara `healthSystemCode`.

**Reglas de negocio**

- [ ] Crear sin `firstName`, sin `lastName` o sin `documentNumber` devuelve 400.
- [ ] Crear con un `documentNumber` ya registrado devuelve 409, y también si el paciente que lo ocupa está inactivo.
- [ ] Actualizar poniendo el documento de otro paciente devuelve 409; actualizar dejando el propio documento devuelve 200.
- [ ] Un `sexItemId` que no pertenece al catálogo `sex` devuelve 404, tanto en create como en update.
- [ ] Un `residenceGeoLocationId` inactivo devuelve 404, tanto en create como en update.
- [ ] Crear con `birthDate` de mañana devuelve 400; con la fecha de hoy devuelve 201.
- [ ] Crear dos pacientes con el mismo `email` devuelve 201 las dos veces.
- [ ] Crear dos pacientes con el mismo `passportNumber` devuelve 201 las dos veces, y `006` sobre ese pasaporte devuelve `count: 2`.

**Búsqueda `006`**

- [ ] Buscar por documento, por pasaporte y por `healthSystemCode` encuentra al mismo paciente en los tres casos.
- [ ] Una búsqueda sin coincidencias devuelve **200** con `{ count: 0, rows: [] }` y el mensaje de `patient.searchEmpty`, nunca 404.
- [ ] Un paciente desactivado no aparece en `006` para USER y sí para ADMIN.

**Ciclo de vida y auditoría**

- [ ] `GET /:id` de un paciente inactivo: 404 para USER, 200 para ADMIN.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] Desactivar dos veces devuelve 409 `ALREADY_INACTIVE`.
- [ ] `DELETE /:id` de un paciente con casos ESAVI asociados devuelve 200: no se comprueba ninguna referencia entrante.
- [ ] `DELETE` y `PATCH /activate` responden `{ ok, message }` sin `data`.
- [ ] Cada create, update y activación añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `appDetails.method` guarda solo el código, sin `_ACTIVATION` ni `_DEACTIVATION` detrás.

**Cierre**

- [ ] Las claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` tiene 51 entradas y `npm test -- roles` pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el cifrado**

- **Sí:** cifrar siete campos — los cuatro nombres, `documentNumber`, `passportNumber` y `email`. Es la línea que ya trazó `appUser` en el SPEC F04, y aquí pesa más: `patient` describe a una persona atendida, no a un empleado.
- **No:** cifrar `phoneNumber` y `healthSystemCode`. El teléfono quedó fuera en `appUser` por la misma razón y no se cambia de criterio a mitad de repositorio; el código lo genera el sistema y es opaco por construcción, así que cifrarlo solo impediría buscarlo sin ganar nada.
- **No:** dejar todo en claro. Un listado de pacientes con nombre, documento y correo legibles en la base es exactamente lo que una vigilancia de eventos adversos no puede permitirse.
- **Sí:** normalizar **antes** de cifrar, siempre. Cifrar primero produce el criptograma del texto crudo, y entonces `1712345678-k` y `1712345678-K` son dos pacientes distintos para la unicidad y dos resultados imposibles de encontrar para la búsqueda.
- **Sí:** `email` a minúsculas antes de cifrar. `citext` no ayuda: la columna guarda el criptograma, así que la insensibilidad a mayúsculas de Postgres se aplica al texto cifrado y no al original.

**Sobre `healthSystemCode`**

- **Sí:** UID opaco de 12 caracteres sobre Crockford Base32. Sin lectura previa, sin acoplamiento y sin filtrar información.
- **No:** código compuesto por `localCode` de la instalación, fecha y secuencial. Tres razones: `patient` no tiene FK a `healthFacility` —ese vínculo vive en `esaviCase`, que aún no existe—, de modo que habría que recibir un `healthFacilityId` que la tabla no guarda; el secuencial sin `UNIQUE` en el DDL es una condición de carrera que Postgres no rechaza; y el código va en claro, así que `HOSP_CENTRAL-20260805-0007` revela dónde y cuándo fue atendida la persona, justo la inferencia que el cifrado de los otros campos existe para impedir.
- **Sí:** alfabeto sin `I`, `L`, `O` ni `U`. Es un código que alguien va a dictar por teléfono o copiar de un papel.
- **No:** comprobar la unicidad del código antes de insertar. Con 32¹² combinaciones la colisión es del orden de 10⁻⁶ para un millón de pacientes, y el código no participa en ninguna transacción: no vale una lectura extra en cada alta. Queda registrado como riesgo en §7.
- **Sí:** generarlo siempre e **ignorar** el campo si llega en el body, sin devolver 400. Un cliente que lo mande por costumbre no debe ver su alta rechazada por un campo que el sistema controla.
- **Sí:** inmutable en `004`. Un identificador que cambia deja de identificar, y cualquier documento impreso con el valor anterior queda huérfano.

**Sobre la búsqueda**

- **Sí:** un solo endpoint `006` con `Op.or` sobre los tres identificadores. Al cliente le llega un valor tecleado en una caja; obligarle a saber de antemano si es documento, pasaporte o código de sistema traslada al frontend una decisión que el backend resuelve con una consulta.
- **No:** tres endpoints separados `006`, `007` y `008`. Triplicaban servicio, controlador, ruta, validador y fila de `ROUTE_RULES` para la misma consulta.
- **Sí:** segmento de ruta `/search/:identifier` en vez de `?identifier=`. Con query, una petición sin el parámetro llega al servicio con `undefined` y hay que tratar el caso; con segmento, Express responde 404 sin que nadie escriba código.
- **Sí:** 200 con `{ count: 0, rows: [] }` cuando no hay coincidencias. Una búsqueda vacía es un resultado, no un recurso ausente, y el frontend puede pintar «no hay resultados» sin ramificar por status.
- **No:** las claves `documentNotFound`, `passportNotFound` y `healthSystemCodeNotFound`. Con un solo endpoint y respuesta 200 no hay nada que reportar, y el servicio tampoco sabría cuál de los tres campos pretendía el usuario.
- **Sí:** `findAndCountAll` aunque el caso normal sea un resultado. `passportNumber` no tiene `UNIQUE` en el DDL: un `findOne` devolvería una fila arbitraria y ocultaría las demás.

**Sobre los roles**

- **Sí:** `001` y `004` en **USER**, desviándose de la matriz canónica de §9, que pediría ADMIN. Quien registra un ESAVI es personal operativo y necesita dar de alta al paciente que todavía no existe; con create en ADMIN el flujo se corta a la mitad.
- **No:** replicar la desviación de `appUser`, que subió los listados y el getById a ADMIN. Allí el argumento era que un listado de usuarios expone la plantilla entera; aquí el mismo personal operativo necesita localizar al paciente antes de abrir el caso, y la forma reducida de §3.7 ya deja fuera correo y teléfono.
- **Sí:** `005A` en ADMIN y `005B` en SUPERADMIN. Dar de baja a una persona del registro no forma parte del flujo de notificación.

**Sobre el modelo y las reglas**

- **Sí:** exigir `firstName`, `lastName` y `documentNumber` en el alta, aunque el DDL admita nulos. Un `INSERT` vacío produce una fila que ningún listado sabe representar.
- **No:** poner esos tres `allowNull: false` en el modelo. Son mínimos de la aplicación, no del esquema; declararlos en el modelo haría irrepresentables las filas ya cargadas.
- **Sí:** `documentNumber` obligatorio, asumiendo la contrapartida. Con `UQ_patient_documentNumber` global y el campo exigido, un recién nacido o una persona indocumentada no se registran hasta tener documento. Es una restricción operativa aceptada conscientemente, no un descuido; queda anotada en §7.
- **Sí:** validar en el servicio que `sexItemId` pertenece al catálogo `sex`. A diferencia de `healthFacility`, aquí **no hay trigger** que lo imponga: sin la validación, cualquier `catalogItem` activo entra como sexo y nadie se entera.
- **Sí:** `birthDate` como `DATEONLY`. Con `DATE`, Sequelize arrastra zona horaria y desplaza la fecha de nacimiento un día según el huso del servidor.
- **Sí:** rechazar fechas de nacimiento futuras, admitiendo hoy como máximo. Es la única validación de rango que el dato admite sin inventar un tope de edad.
- **No:** comprobar unicidad de `email` ni de `passportNumber`. El DDL no la impone y hay casos legítimos: dos hermanos que comparten el correo de un tutor, o un pasaporte repetido por error de captura que la búsqueda debe poder mostrar.
- **No:** bloquear la desactivación por referencias entrantes. Es borrado lógico, así que `ON DELETE RESTRICT` nunca se dispara, y `esaviCase` ni siquiera tiene modelo: consultarla acoplaría `patient` a un dominio que aún no existe. Es la misma decisión que tomó el SPEC 09 con `healthFacility`.
- **No:** tocar `esaviapp.sql` para añadir `UQ_patient_healthSystemCode` o `UQ_patient_passportNumber`. Modificar el DDL afecta a datos ya cargados y a la carga del esquema en los tests; es la línea que mantuvo el SPEC 09.
- **No:** ordenar los listados por apellido. Los nombres están cifrados: `ORDER BY "lastName"` produce un orden arbitrario pero estable, es decir, el peor de los dos mundos — parece que funciona.
- **Sí:** forma reducida en los listados y completa solo en `003`. Un listado no tiene por qué volcar el correo y el teléfono de cada persona de la página.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| `documentNumber` obligatorio deja fuera a recién nacidos y personas indocumentadas, que son población ESAVI real | Es la consecuencia asumida en §6. Si aparece el caso en operación, la salida es un documento provisional acordado por la organización, o un spec que lo haga opcional y revise la unicidad. No se resuelve aquí |
| Una colisión de `healthSystemCode` pasa inadvertida: el DDL no tiene `UNIQUE` y el servicio no comprueba | Probabilidad del orden de 10⁻⁶ con un millón de pacientes. El código no participa en ninguna transacción; en el peor caso, `006` devolvería `count: 2` sobre ese código y el operador distingue por documento |
| Una fila cargada por SQL directo **sin cifrar** hace que `esaviDecrypt` lance, y un solo registro corrupto tumba el listado entero con un 500 | El riesgo es el mismo que ya existe en `appUser` y no lo introduce este spec, pero los listados lo amplifican: pasa de afectar a un paciente a romper la página completa. El descifrado tolerante a fallos va en su propio spec |
| Cargar pacientes por SQL directo se vuelve impracticable: hay que cifrar siete campos fuera de la aplicación para poder insertarlos o buscarlos | Es el precio del cifrado, ya pagado en `appUser`. La vía soportada es la API; una carga masiva necesita su propio spec con un script que reutilice `esaviCrypt` |
| `GET /:id` captura `admin` o `search` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato |
| `birthDate` como `DATEONLY` devuelve `string`, no `Date`, y un consumidor que espere ISO completo se rompe | Es la representación correcta de una columna `date`. Queda documentado en §3.7; conviene avisar a los consumidores de la API |
| Un `documentNumber` ocupado por un paciente desactivado sigue ocupado, y reactivarlo no es evidente desde el cliente | Es lo que garantiza `UQ_patient_documentNumber`, que no filtra por `isActive`. El 409 lo dice; localizar al paciente inactivo se hace con `006` desde una cuenta ADMIN |
| `006` normaliza con `.trim().toUpperCase()`, así que un `healthSystemCode` tecleado en minúsculas se encuentra, pero un documento con letra minúscula significativa no existiría | Los documentos de identidad y pasaportes de la región no distinguen mayúsculas. Si apareciera un formato que sí lo hace, la normalización tendría que revisarse en escritura y en búsqueda a la vez |

---

## Lo que **no** está en este spec

- `esaviCase` y el resto del núcleo ESAVI.
- Bloquear la desactivación de un paciente con casos ESAVI asociados.
- Búsqueda o filtrado por nombre, correo o fecha de nacimiento.
- Ordenar los listados por apellido.
- Deduplicación o fusión de pacientes.
- Carga masiva de pacientes con `healthSystemCode` preexistente.
- Añadir restricciones al DDL: `UQ_patient_healthSystemCode`, `UQ_patient_passportNumber` o cualquier otra.
- Cifrar `phoneNumber` o `healthSystemCode`, cambiar el esquema de `esaviCrypt` o migrar datos ya cifrados.
- Descifrado tolerante a filas cargadas en claro por SQL directo.
- Un documento provisional para pacientes indocumentados.
- Exponer o editar `sysDetails`.
- Registrar quién consultó los datos de un paciente.

Cada uno de esos, si aterriza, va en su propio spec.
