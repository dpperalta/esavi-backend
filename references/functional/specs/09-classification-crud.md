# SPEC F09 — CRUD completo de classification

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F06 (`esaviCase` — dependencia dura: `caseId` es `NOT NULL` y la edad se calcula desde `esaviCase.eventDate`)**, **SPEC F05 (`patient` — dependencia dura: la edad se calcula desde `patient.birthDate`)**, SPEC F07 (mecanismo de cascada de `ESAVI-CASE-005A`, al que esta entidad se suma), SPEC F08 (operación `005C` de borrado físico)
> **Fecha:** 2026-08-10
> **Objetivo:** Dar de alta la entidad `classification` con sus siete artefactos, sus siete operaciones canónicas más el acceso por caso, calculando la edad del paciente al momento del evento en vez de aceptarla del cliente, y sumando la entidad a la cascada de desactivación de `esaviCase`.

---

## 1. Por qué existe este spec

`classification` es la **segunda** de las cinco tablas satélite de `esaviCase` que recibe implementación, después de `notifier`. Guarda el juicio clínico sobre el evento: la edad del paciente cuando ocurrió, la fecha de la primera consulta y —lo importante— si el evento fue **grave** y bajo cuál de los ocho criterios de gravedad. Es el dato que decide si un caso ESAVI entra o no en el circuito de investigación; sin él, un caso está registrado pero no clasificado, y la vigilancia no puede priorizar nada.

Hoy la tabla existe en `esaviapp.sql:690-716` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Cuatro características la separan de las entidades ya especificadas:

**A — Es uno a uno, y el DDL lo dice explícitamente.** `UQ_classification_case` declara `UNIQUE ("caseId")` (`esaviapp.sql:715`), justo lo que `notifier` **no** declara. El SPEC F07 razonó su cardinalidad de muchos sobre esa ausencia: «donde el esquema quiso una relación uno a uno lo dijo; aquí no lo dijo». Aquí lo dijo. Un caso tiene como mucho una clasificación, y el intento de crear la segunda es un conflicto, no un alta.

**B — Es la primera entidad del repositorio cuyo dato principal se calcula, no se captura.** `age` y `ageUnitItemId` no son entrada del cliente: se derivan de `patient.birthDate` y `esaviCase.eventDate` con el criterio epidemiológico de unidad —años, meses o días según la magnitud—, y lo que llegue en el body se ignora en silencio siempre que las dos fechas existan. La entrada del cliente sobrevive únicamente como respaldo para los casos en que alguna fecha falta, que en este esquema son posibles: las dos columnas son nulables. Esto convierte a `classification` en la primera entidad con una dependencia de lectura **transitiva** —`classification` → `esaviCase` → `patient`— dentro de una operación de escritura.

**C — No hay PII, no hay `code` y no hay `name`.** Es la primera entidad ESAVI desde `patient` que no cifra nada con `esaviCrypt`, y la primera entidad del repositorio sin un campo `code` ni un `name`: no aplica `toConstantCase`, no aplica `toTitleCase` y no hay ninguna clave `codeExists`. Toda la normalización se reduce a `.trim()` sobre los dos textos libres. A cambio, la complejidad se desplaza entera a la coherencia entre los nueve booleanos, que es donde vive la regla de negocio real.

**D — El `ON DELETE CASCADE` del DDL no protege nada, igual que en `notifier`.** `FK_classification_case` declara `ON DELETE CASCADE` (`esaviapp.sql:713`), pero `TRG_esaviCase_preventPhysicalDelete` impide todo borrado físico de `esaviCase` (`esaviapp.sql:1361-1366`), así que la cascada declarada **nunca dispara**. La integridad del ciclo de vida la sostiene solo la aplicación — y ése es el mecanismo que el SPEC F07 construyó en `setEsaviCaseActivationService` (`src/services/esaviCase.service.ts:358-381`) dejando escrito que cada satélite posterior se suma al mismo punto. Éste es el primero que se suma: valida que el mecanismo era extensible y no un arreglo puntual para `notifier`.

`classification` **tampoco está** en la lista de `preventPhysicalDelete` (`esaviapp.sql:1354-1360`), así que un `DELETE FROM "classification"` ejecuta sin error y le corresponde la operación `005C` del SPEC F08.

El único trigger que alcanza a la tabla es `TRG_classification_setSysDetails`, creado por el bucle genérico de `esaviapp.sql:1274-1291`. No valida ninguna regla de negocio. **No existe `TRG_classification_setUpdatedAt`** —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—, así que `updatedAt` lo escribe la aplicación.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `classification`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- Las siete operaciones canónicas: `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar.
- La operación no canónica **`006` — obtener por caso**, `GET /case/:caseId`, que es la consulta real del dominio: el cliente tiene el `caseId`, no el `classificationId`. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- La operación `005C` de borrado físico, en SUPERADMIN, que le corresponde por no estar `classification` en el bucle `preventPhysicalDelete` del DDL. Las reglas transversales las fija el [SPEC F08](./08-physical-delete.md); aquí solo se declara la ruta y las claves de la entidad.
- Relación **uno a uno** con `esaviCase`, sostenida por `UQ_classification_case`. Crear una segunda clasificación para un caso que ya la tiene devuelve **409**, y el hueco **no se libera** cuando la existente está inactiva: para clasificar de nuevo hay que reactivar la anterior o purgarla.
- **Cálculo automático de la edad** en `001` y en `004`, a partir de `patient.birthDate` (vía `esaviCase.patientId`) y `esaviCase.eventDate`, con la unidad resuelta por criterio epidemiológico: años si hay 12 meses cumplidos o más, meses si hay menos de un año pero al menos un mes cumplido, días si hay menos de un mes. El `age` y el `ageUnitItemId` que lleguen en el body se **ignoran en silencio** siempre que existan las dos fechas, sin 400 y sin aviso en la respuesta.
- **Respaldo del cliente** cuando falta `birthDate` o falta `eventDate`: entonces sí se guardan `age` y `ageUnitItemId` del body, obligatoriamente **juntos o ninguno**. `esaviCase.reportDate` no se usa como sustituto de `eventDate`.
- Resolución del `ageUnitItemId` calculado buscando los códigos `YEARS`, `MONTHS` y `DAYS` dentro del `catalogType` de código `ageUnit`, y validación del `ageUnitItemId` recibido contra ese mismo catálogo cuando entra por la vía de respaldo.
- **Matriz de coherencia de gravedad**: las tres reglas cruzadas de 400 en el validador y la derivación de `isSeriousEvent` a `true` en el servicio cuando algún `caused*` llega en `true`. Los nueve booleanos conservan el **tri-estado**: lo que no llega se guarda `null`, nunca `false`.
- `otherSeriousConditionDescription` obligatorio cuando `causedOtherCondition` es `true`.
- `caseId` obligatorio en el alta e **inmutable**: se ignora si llega en el body del `004`.
- Validación de FK en create y update: `caseId` existente y activo; `ageUnitItemId` —solo por la vía de respaldo— activo y perteneciente al `catalogType` de código `ageUnit`.
- Listados con `findAndCountAll`, orden por defecto `createdAt DESC`, paginación y tres filtros por query acumulativos con `AND`: `caseId`, `isSeriousEvent` y `ageUnitItemId`.
- **Sumar `classification` a la cascada del SPEC F07:** `ESAVI-CASE-005A` desactiva también la clasificación activa del caso, en la misma transacción y en el mismo punto de `src/services/esaviCase.service.ts`. La cascada sigue siendo **solo de bajada**: `ESAVI-CASE-005B` no reactiva nada.
- Alta de la abreviatura `CLASSIF` en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de **90 a 99**—, suite `tests/contract/classification.test.ts` y ampliación de `tests/contract/esaviCase.test.ts` con la cascada.

**Fuera de alcance (otros specs):**

- Las otras tres tablas satélite de `esaviCase` —`notification`, `investigation` y `finalClassification`— y las veintiocho que cuelgan de ellas. `finalClassification` es una tabla distinta con columnas distintas (`esaviapp.sql:1244-1269`) y **no** se implementa aquí, por mucho que comparta raíz de nombre.
- **Dar de alta la abreviatura `FINCLASS`** en `CONVENTIONS.md`. Queda reservada de palabra en §6 de este spec para que `finalClassification` no se quede sin sitio, pero se registra en su propio spec.
- Extender la cascada de `ESAVI-CASE-005A` a los otros tres satélites.
- **Recalcular la edad de las clasificaciones ya guardadas cuando cambien `patient.birthDate` o `esaviCase.eventDate`.** Va en su propio spec: obliga a modificar dos servicios cerrados y a decidir qué pasa con las clasificaciones inactivas. Hasta entonces, la vía de corrección es un `PUT` sobre la clasificación, que recalcula.
- Sembrar el `catalogType` de código `ageUnit` y sus tres items. **Es precondición de la implementación, no parte de ella:** sin ese catálogo, toda alta con las dos fechas presentes devuelve 404. La carga se hace por los endpoints ya existentes de `catalogType` y `catalogItem`.
- Cualquier modificación de `esaviapp.sql`: ni el índice único parcial que liberaría el `caseId` de una clasificación inactiva, ni un `CHECK` que imponga la coherencia de gravedad en la base, ni añadir `classification` a `preventPhysicalDelete`, ni el índice `IX_classification_case` que la tabla no tiene, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.
- Cifrado de ningún campo. La tabla no contiene datos identificativos: la edad sin fecha de nacimiento no identifica a nadie, y el paciente ya está cifrado en su propia tabla.
- Filtrar u ordenar por rangos de edad o por rangos de `firstConsultationDate`. Los tres filtros de §3.5 son por igualdad.
- Cualquier endpoint de estadística, conteo por criterio de gravedad o exportación.
- Crear la clasificación automáticamente al dar de alta un `esaviCase`. Clasificar es un acto clínico posterior y deliberado.
- Bloquear la desactivación de un caso porque su clasificación diga que el evento fue grave, o cualquier otra regla que ate el ciclo de vida del caso al contenido de la clasificación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen

`classification` — `esaviapp.sql:690-716`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `classificationId` | `uuid` | no | PK, `gen_random_uuid()` |
| `caseId` | `uuid` | **no** | `FK_classification_case` → `esaviCase`, `ON DELETE CASCADE`. **`UQ_classification_case` UNIQUE**: uno a uno |
| `age` | `smallint` | sí | `CHECK ("age" IS NULL OR "age" >= 0)`. **Calculado** |
| `ageUnitItemId` | `uuid` | sí | `FK_classification_ageUnit` → `catalogItem`, `ON DELETE RESTRICT`. **Calculado** |
| `firstConsultationDate` | `date` | sí | |
| `isSeriousEvent` | `boolean` | sí | tri-estado; derivable a `true` por el servicio |
| `causedDeath` | `boolean` | sí | tri-estado |
| `causedDisability` | `boolean` | sí | tri-estado |
| `causedCongenitalAnomaly` | `boolean` | sí | tri-estado |
| `causedFetalDeath` | `boolean` | sí | tri-estado |
| `causedLifeThreatening` | `boolean` | sí | tri-estado |
| `causedHospitalization` | `boolean` | sí | tri-estado |
| `causedAbortion` | `boolean` | sí | tri-estado |
| `causedOtherCondition` | `boolean` | sí | tri-estado; exige descripción cuando es `true` |
| `otherSeriousConditionDescription` | `text` | sí | texto libre |
| `notes` | `text` | sí | texto libre |

**Sin índices propios.** La tabla no declara ningún `CREATE INDEX`, al contrario que `notifier`, que tiene `IX_notifier_case`. El acceso por `caseId` —que es el de la operación `006` y el del filtro más usado— se apoya en el índice único que Postgres crea de oficio para `UQ_classification_case`, que sirve exactamente igual para la igualdad. No falta nada.

Las cuatro columnas transversales están presentes y completas: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB), más `createdAt` y `updatedAt`.

**El `CHECK ("age" >= 0)` es la última línea de defensa, no la primera.** Si el cálculo produjera un valor negativo, Postgres rechazaría el `INSERT` con un `23514` que llegaría al cliente como 500. La regla de §3.5 lo atrapa antes con un 409.

**Triggers.** El único que alcanza a la tabla es `TRG_classification_setSysDetails`. **No existe `TRG_classification_setUpdatedAt`** ni **`TRG_classification_preventPhysicalDelete`**: `classification` no figura en la lista de `esaviapp.sql:1354-1360`, así que un `DELETE` físico ejecuta sin error.

### 3.2 Modelo Sequelize

Archivo: `src/models/classification.model.ts`. Clase `Classification`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'classification'`. PK `classificationId` con `defaultValue: sequelize.literal('gen_random_uuid()')`.

`caseId` va `allowNull: false`, calcando el DDL; **todo lo demás va `allowNull: true`**, incluido `isSeriousEvent`. La obligatoriedad condicional de `isSeriousEvent` es una regla de la matriz de coherencia y vive en el validador: el modelo refleja la tabla, no la regla.

`age` se declara `DataTypes.SMALLINT`, no `INTEGER`. Los nueve booleanos van `DataTypes.BOOLEAN` **sin `defaultValue`**: declarar `defaultValue: false` convertiría el tri-estado en dos estados y borraría la distinción entre «no» y «no informado», que es justo lo que §2 preserva.

Asociaciones, en `src/models/associations/classification.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `Classification.belongsTo(EsaviCase, { as: 'case', foreignKey: 'caseId' })`
- `Classification.belongsTo(CatalogItem, { as: 'ageUnit', foreignKey: 'ageUnitItemId' })`

Ninguna va dentro del archivo del modelo. Alta en `src/models/index.ts`.

**`EsaviCase.hasOne(Classification, { as: 'classification', foreignKey: 'caseId' })` sí se declara.** Es `hasOne` y no `hasMany` porque `UQ_classification_case` lo impone. La cascada no lo necesita —el `update` masivo filtra por `caseId` sin recorrer asociación—, pero el SPEC F07 ya declaró el inverso de `notifier` y mantener el criterio evita que el siguiente satélite tenga que decidirlo otra vez. **No se añade a las respuestas de `esaviCase`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia.

El modelo **no** declara asociación con `Patient`. La edad se calcula leyendo el paciente a través del caso, con un include de segundo nivel sobre la asociación `patient` que el SPEC F06 ya dejó declarada en `esaviCase.associations.ts`.

### 3.3 Tipos

`src/types/classification/classification.types.ts`, con su `index.ts` de barrel y alta en `src/types/index.ts`.

```ts
export interface CreateClassificationInput {
    caseId: string;
    age?: number | null;
    ageUnitItemId?: string | null;
    firstConsultationDate?: string | null;
    isSeriousEvent?: boolean | null;
    causedDeath?: boolean | null;
    causedDisability?: boolean | null;
    causedCongenitalAnomaly?: boolean | null;
    causedFetalDeath?: boolean | null;
    causedLifeThreatening?: boolean | null;
    causedHospitalization?: boolean | null;
    causedAbortion?: boolean | null;
    causedOtherCondition?: boolean | null;
    otherSeriousConditionDescription?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
```

`age` y `ageUnitItemId` figuran en el input **aunque casi siempre se ignoren**: son la vía de respaldo de §3.5, y quitarlos del tipo dejaría al cliente sin forma de informar la edad cuando faltan las fechas. Los nueve booleanos admiten `null` explícitamente, que es lo que sostiene el tri-estado.

El update usa `Partial<CreateClassificationInput>`. No se declara `UpdateClassificationInput`. `caseId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre**: es inmutable.

### 3.4 Superficie HTTP

```
POST   /api/classifications                ESAVI-CLASSIF-001   USER        (nuevo)
GET    /api/classifications                ESAVI-CLASSIF-002A  USER        (nuevo)
GET    /api/classifications/admin          ESAVI-CLASSIF-002B  ADMIN       (nuevo)
GET    /api/classifications/case/:caseId   ESAVI-CLASSIF-006   USER        (nuevo)
GET    /api/classifications/:id            ESAVI-CLASSIF-003   USER        (nuevo)
PUT    /api/classifications/:id            ESAVI-CLASSIF-004   USER        (nuevo)
DELETE /api/classifications/:id            ESAVI-CLASSIF-005A  ADMIN       (nuevo)
PATCH  /api/classifications/activate/:id   ESAVI-CLASSIF-005B  SUPERADMIN  (nuevo)
DELETE /api/classifications/purge/:id      ESAVI-CLASSIF-005C  SUPERADMIN  (nuevo)
```

Orden de declaración en `src/routes/classification.routes.ts`: las rutas con prefijo literal (`/admin`, `/case/:caseId`, `/activate/:id`, `/purge/:id`) van **antes** de `/:id`, o Express capturará `admin` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la misma desviación de los SPEC F05, F06 y F07 y por la misma razón: la clasificación se captura en el mismo flujo operativo que el caso. `005A` se queda en ADMIN y `005B` y `005C` en SUPERADMIN.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`classification` · `006` · obtener la clasificación de un caso**.

### 3.5 Reglas de negocio por operación

#### El cálculo de la edad — regla compartida por `001` y `004`

Se aplica igual en las dos operaciones, y es lo primero que hay que entender del servicio:

1. Se lee el caso con su paciente: `EsaviCase.findOne({ where: { caseId }, include: [{ association: 'patient' }] })`.
2. Si **existen** `patient.birthDate` y `esaviCase.eventDate` → se calcula, y `age` y `ageUnitItemId` del body **se descartan en silencio**. Sin 400 y sin aviso en la respuesta.
3. Si `eventDate` es anterior a `birthDate` → **409** `CLASSIF_<op>_INVALID_AGE_RANGE`. No se guarda nada. `esaviCase.reportDate` **no** se usa como sustituto.
4. Unidad, por magnitud decreciente y sobre **períodos cumplidos**, no sobre división de milisegundos —el año bisiesto y el mes de longitud variable hacen que la división produzca errores de un día en los bordes—:

   | Condición | `age` | Código de item |
   |---|---|---|
   | 12 meses cumplidos o más | años cumplidos | `YEARS` |
   | menos de 12 meses y 1 mes cumplido o más | meses cumplidos | `MONTHS` |
   | menos de 1 mes | días transcurridos | `DAYS` |

   Un evento el mismo día del nacimiento da `age: 0` con `DAYS`, que el `CHECK` admite.
5. El item se resuelve buscando `catalogItem.code` igual a `YEARS`, `MONTHS` o `DAYS` —en `toConstantCase`, como los guarda `catalogItem.service.ts:22`— con `isActive: true` y dentro del `catalogType` de código `ageUnit`. Si no aparece → **404** `CLASSIF_<op>_AGEUNIT_CATALOG_MISSING`, con una clave i18n que nombra la precondición: el catálogo no está sembrado.
6. Si **falta** `birthDate` o falta `eventDate` → prevalece el body: `age` y `ageUnitItemId` se guardan tal cual, obligatoriamente **juntos o ninguno** —enviar uno solo es 400, lo emite el validador— y el `ageUnitItemId` recibido se valida como cualquier FK: existente, activo y del `catalogType` `ageUnit` → si no, **404** `CLASSIF_<op>_AGEUNIT_NOT_FOUND`. Si el body tampoco los trae, ambos quedan en `null`.

`smallint` no se desborda por ninguna vía: la rama de días nunca pasa de 30, la de meses de 11, y la de años no alcanza 32 767.

#### La matriz de coherencia — regla compartida por `001` y `004`

Las tres primeras filas las emite el **validador** con 400 (`validateFields`), porque son cruces entre campos del mismo body y hay precedente en `esaviCase.validator.ts:59`. La cuarta la aplica el **servicio** y no produce error:

| Situación | Resultado |
|---|---|
| Ningún `caused*` en `true` e `isSeriousEvent` ausente | **400** |
| Ningún `caused*` en `true` e `isSeriousEvent: true` | **400** |
| `causedOtherCondition: true` sin `otherSeriousConditionDescription` | **400** |
| Al menos un `caused*` en `true` | `isSeriousEvent` se **deriva** a `true` en el servicio, llegue como llegue —`true`, `false` o ausente— |

Ningún `caused*` en `true` con `isSeriousEvent: false` se acepta, y los `caused*` ausentes se guardan `null`. En el `004`, la matriz se evalúa sobre el **estado resultante** —lo que ya hay en la fila fusionado con lo que llega en el body—, no solo sobre el body: si no, un `PUT` que envía `causedDeath: false` sobre una clasificación cuyo único criterio era ése dejaría `isSeriousEvent: true` sin ningún criterio detrás. Esa evaluación vive en el **servicio**, no en el validador, que no ve la fila.

#### Por operación

**`ESAVI-CLASSIF-001` — crear.** En este orden:

1. Valida `caseId`: existe y `isActive: true` → 404 `CLASSIF_001_CASE_NOT_FOUND`. Un caso retirado no se clasifica.
2. Comprueba que el caso **no tenga ya clasificación**, sin filtrar por `isActive` → 409 `CLASSIF_001_CASE_ALREADY_CLASSIFIED`. Es el canon de §11: la `UNIQUE` del DDL tampoco filtra por `isActive`, así que un `caseId` ocupado por una clasificación desactivada **sigue ocupado**. El mensaje debe decirlo —lleva `{{caseId}}`— porque si no el cliente ve un 409 por una fila que no puede ver.
3. Calcula la edad, con las seis reglas de arriba.
4. Deriva `isSeriousEvent` según la matriz.
5. Normaliza: `.trim()` sobre `otherSeriousConditionDescription` y `notes`. No hay más normalización: la entidad no tiene `code` ni `name`.
6. Inserta con la entrada de auditoría `method: 'ESAVI-CLASSIF-001'`.

**`ESAVI-CLASSIF-002A` — listar, público.** `findAndCountAll` con `where: { isActive: true }`, includes `case` y `ageUnit`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Filtros opcionales por query, acumulativos con `AND`:

- `caseId` — igualdad, UUID.
- `isSeriousEvent` — igualdad, booleano. **Solo `true` o `false`**: no hay forma de filtrar por «no informado», y añadirla exigiría un tercer valor por query que este spec no define.
- `ageUnitItemId` — igualdad, UUID.

Un filtro de FK con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma reducida de §3.7.

**`ESAVI-CLASSIF-002B` — listar, admin.** Idéntica, sin `isActive` en el `where`. Los mismos tres filtros.

**`ESAVI-CLASSIF-003` — obtener por ID.** `where` con `isActive: true` salvo que `canViewInactive(req.user)` sea verdadero —hoy **SUPERADMIN**, `src/helpers/permissions.helper.ts:24-26`— → 404 `CLASSIF_003_NOT_FOUND`. Forma completa de §3.7.

**`ESAVI-CLASSIF-006` — obtener por caso.** Mismo servicio de lectura que `003` pero buscando por `caseId`, con los mismos includes, la misma forma completa y la misma regla de `canViewInactive`. Dos 404 distintos, y la diferencia importa para el cliente:

- El caso no existe → 404 `CLASSIF_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene clasificación visible → 404 `CLASSIF_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la relación es uno a uno y envolver una ficha en una colección obligaría al cliente a desempaquetar un array de un elemento.

**`ESAVI-CLASSIF-004` — actualizar.** En este orden:

1. Existencia → 404 `CLASSIF_004_NOT_FOUND`.
2. `caseId` **se ignora siempre**, venga o no en el body. Una clasificación no se traslada entre casos: la `UNIQUE` lo impediría de todas formas si el destino ya tuviera la suya, y el origen quedaría sin clasificación sin que nada lo registre.
3. Recalcula la edad con las seis reglas de arriba, **siempre**, aunque el `PUT` no toque nada relacionado. Es la vía manual de corrección hasta que llegue el spec de propagación.
4. Evalúa la matriz de coherencia sobre el estado resultante y deriva `isSeriousEvent`.
5. Normaliza con `.trim()` los dos textos libres que lleguen.
6. Escribe `updatedAt` explícitamente. No hay trigger que lo haga.
7. Preserva el historial con `[...currentAppDetails, newEntry]`.

**`ESAVI-CLASSIF-005A` / `005B` — desactivar y reactivar.** `setClassificationActivationService(id, authUser, lang, isActive)` sobre `setEntityActiveStatusService`, con transacción, calculando `const op = isActive ? '005B' : '005A'`. El `where` filtra **solo por la PK**. `DELETE` sella `deletedAt`; `PATCH /activate` lo deja en `null`. Ambos responden `{ ok, message }` sin `data`.

Reactivar una clasificación **no exige** que su caso esté activo, por la misma razón que en `notifier`: la cascada es solo de bajada y quien reactiva es SUPERADMIN. Y no puede haber conflicto con la `UNIQUE` al reactivar, porque el `caseId` nunca se liberó: la regla del paso 2 del `001` impide que exista una segunda clasificación esperando.

**La cascada — ampliación de `ESAVI-CASE-005A`.** Dentro de la transacción que `setEsaviCaseActivationService` ya abre, en el **mismo punto** donde el SPEC F07 dejó el `Notifier.update` (`src/services/esaviCase.service.ts:358-381`) y **solo cuando `isActive === false`**, se añade un `Classification.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt`, y añade a `appDetails` una entrada con `method: 'ESAVI-CASE-005A'` —el código de la operación que la desactivó, no el suyo— reutilizando el mismo `sequelize.literal` que ya resuelve el `appDetails` heredado como objeto. Un caso sin clasificación desactiva cero filas y no falla. `ESAVI-CASE-005B` no reactiva nada.

**`ESAVI-CLASSIF-005C` — purgar.** `purgeClassificationService(id, authUser, lang)` sobre `purgeEntityService`, con transacción. Existencia con `paranoid: false` → 404 `CLASSIF_005C_NOT_FOUND`; la fila debe estar en `isActive: false` → si no, 409 `CLASSIF_005C_STILL_ACTIVE`; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. Las reglas transversales están en el [SPEC F08](./08-physical-delete.md) y no se repiten aquí.

**Purgar sí libera el `caseId`**, y es la única vía que lo hace: destruida la fila, la `UNIQUE` queda libre y el caso admite una clasificación nueva. Purgar no afecta al caso: la FK va de la clasificación al caso, no al revés, y ninguna tabla referencia `classificationId`.

**Validaciones de forma** (las emite `validateFields` con 400): `caseId` obligatorio y `.isUUID()` en create; `age` entero entre 0 y 32 767 cuando llegue; `ageUnitItemId` con `.isUUID()` cuando llegue; `age` y `ageUnitItemId` **juntos o ninguno**; `firstConsultationDate` con `.isISO8601()` y no futura, reutilizando el helper `isNotFutureDate` que ya usan `esaviCase` y `patient`; los nueve booleanos con `.isBoolean()`; `otherSeriousConditionDescription` y `notes` como cadena; y las tres reglas cruzadas de la matriz de coherencia.

`firstConsultationDate` **no** se valida contra `eventDate`: el validador solo ve el body, y el caso está en otra tabla. Comprobar que la primera consulta no precede al evento exigiría subirlo al servicio, y este spec no lo hace — queda anotado en §7 como riesgo asumido.

### 3.6 Claves i18n nuevas

Bloque `classification` en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `deletedSuccess` / `deletedFailed` | `005A` |
| `activatedSuccess` / `activatedFailed` | `005B` |
| `notFound` | 404 en `003`, `004`, `005A`, `005B` y `006` |
| `idRequired` | parámetro ausente |
| `alreadyActive` / `alreadyInactive` | 409 de `setEntityActiveStatusService` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `stillActive` | 409 al purgar una clasificación activa. Lleva `{{id}}` |
| `caseNotFound` | 404 cuando `caseId` no existe o está inactivo, en `001` y en `006` |
| `caseAlreadyClassified` | 409 cuando el caso ya tiene clasificación, activa o no. Lleva `{{caseId}}` |
| `ageUnitNotFound` | 404 cuando el `ageUnitItemId` **recibido** no existe, está inactivo o no es del catálogo `ageUnit` |
| `ageUnitCatalogMissing` | 404 cuando el catálogo `ageUnit` no tiene el item `YEARS`, `MONTHS` o `DAYS` que el cálculo necesita. Lleva `{{code}}` |
| `invalidAgeRange` | 409 cuando `eventDate` es anterior a `birthDate` |

Las dos claves de unidad de edad son distintas a propósito: `ageUnitNotFound` culpa a lo que envió el cliente, `ageUnitCatalogMissing` señala una precondición del despliegue. Fundirlas en una haría que un error de instalación pareciera un error de entrada.

`tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave al bloque `esaviCase`: la cascada no produce mensajes propios.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004` y `006`:

```
{ ok, message, data: {
    classificationId, age, firstConsultationDate,
    isSeriousEvent, causedDeath, causedDisability, causedCongenitalAnomaly,
    causedFetalDeath, causedLifeThreatening, causedHospitalization,
    causedAbortion, causedOtherCondition, otherSeriousConditionDescription,
    notes, isActive, createdAt, updatedAt, deletedAt, appDetails,
    case:    { caseId, caseCode, reportDate, eventDate },
    ageUnit: { catalogItemId, code, name }
} }
```

**Reducida** — `002A` y `002B`, dentro de `{ count, rows }`: la misma forma **sin `notes` y sin `appDetails`**, y sin `createdAt`, `updatedAt` ni `deletedAt`. Los nueve booleanos y `otherSeriousConditionDescription` **sí van**: el caso de uso del listado es ver de un vistazo qué casos son graves y bajo qué criterio, y sin ellos la lista no dice nada.

`case` incluye `eventDate` —y no solo `caseCode` y `reportDate` como en `notifier`— porque es la fecha desde la que se calculó la edad: sin ella, el cliente ve un número que no puede explicar.

Los nueve booleanos se devuelven **tal como están**, `null` incluido: nunca se normalizan a `false` al construir la respuesta. `ageUnit` nulo se devuelve como `null`, no se omite. `sysDetails` **nunca** se devuelve, en ninguna operación.

---

## 4. Plan de implementación

**Precondiciones.** Tres, antes del paso 1:

- El **SPEC F06** debe estar implementado. `caseId` es `NOT NULL`, la asociación, la validación de FK y la cascada necesitan el modelo `EsaviCase`.
- El **SPEC F05** debe estar implementado. El cálculo de la edad lee `patient.birthDate` a través del include `patient` de `esaviCase`.
- Debe existir un `catalogType` con `code = 'ageUnit'` y **tres** `catalogItem` activos bajo él, con códigos `YEARS`, `MONTHS` y `DAYS`, cargados por los endpoints ya existentes de catálogos. Sin ellos, toda alta con las dos fechas presentes devuelve 404 `ageUnitCatalogMissing`.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Modelo, asociaciones y tipos.** `src/models/classification.model.ts` con `caseId` en `allowNull: false`, `age` como `SMALLINT` y los nueve booleanos **sin `defaultValue`**; `src/models/associations/classification.associations.ts` con `case` y `ageUnit`, más el inverso `EsaviCase.hasOne(Classification, { as: 'classification' })`, registrado en `initModels()`; `src/types/classification/classification.types.ts` con `CreateClassificationInput` y su `index.ts` de barrel. Alta en `src/models/index.ts` y `src/types/index.ts`.
   *Verificación:* `npm run build` en 0; un `Classification.findAndCountAll({ include: ['case', 'ageUnit'] })` desde un script suelto devuelve filas sin error de asociación; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `esaviCase`.

2. **Claves i18n.** El bloque `classification` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las diecinueve claves.
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa.

3. **Helper de cálculo de edad.** `src/helpers/age.helper.ts` con una función pura `resolveAgeAtEvent(birthDate, eventDate)` que devuelve `{ age, unitCode }` con `unitCode` en `'YEARS' | 'MONTHS' | 'DAYS'`, o `null` si falta alguna fecha, y que **lanza** cuando `eventDate` precede a `birthDate` para que el servicio lo traduzca al 409. Períodos cumplidos por aritmética de calendario, nunca por división de milisegundos. Alta en `src/helpers/index.ts`.
   *Verificación:* suite unitaria nueva `tests/unit/age.helper.test.ts` con los bordes: nacimiento y evento el mismo día → `0 DAYS`; 30 días → `30 DAYS`; un mes exacto → `1 MONTHS`; 11 meses y 29 días → `11 MONTHS`; 12 meses exactos → `1 YEARS`; un 29 de febrero con evento el 28 de febrero del año siguiente → `0 YEARS` con `11 MONTHS`; evento anterior al nacimiento → lanza. **Este paso introduce el directorio `tests/unit/`**, que no existe: las cuatro suites actuales son de rol, contrato e i18n. Es una extensión deliberada y pequeña, porque estos bordes son de aritmética pura y cubrirlos por HTTP obligaría a fabricar un paciente y un caso por cada caso de prueba.

4. **Validadores.** `src/validators/classification.validator.ts` con cuatro arrays: `classificationIdValidator`, `classificationListValidator` (los tres filtros de §3.5 más `limit` y `offset`), `createClassificationValidator` y `updateClassificationValidator`. Ambos de cuerpo incluyen las validaciones de forma de §3.5, la regla de `age` y `ageUnitItemId` **juntos o ninguno**, y las tres reglas cruzadas de la matriz de coherencia, siguiendo el patrón de `esaviCase.validator.ts:59`. Un quinto array `classificationCaseIdValidator` para el `param('caseId')` del `006`. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; los validadores existen aunque aún no haya rutas que los usen.

5. **`ESAVI-CLASSIF-001` — crear.** `createClassificationService` con los seis pasos de §3.5 en ese orden: FK del caso, unicidad del `caseId` sin filtrar por `isActive`, cálculo de la edad, derivación de `isSeriousEvent`, `.trim()` de los textos, inserción con auditoría. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* un caso con paciente de fecha de nacimiento conocida y evento tres años después guarda `age: 3` y el item `YEARS`, **aunque el body mande `age: 40`**; el mismo alta sin `birthDate` en el paciente guarda el `age` y el `ageUnitItemId` del body; sin `birthDate` y con solo `age` en el body devuelve **400**; un caso cuyo `eventDate` precede al `birthDate` devuelve **409**; clasificar dos veces el mismo caso devuelve **409** `CLASSIF_001_CASE_ALREADY_CLASSIFIED`, y también lo devuelve si la primera está desactivada; un `caseId` inactivo devuelve **404**; borrar el item `YEARS` del catálogo y reintentar devuelve **404** `ageUnitCatalogMissing`.

6. **`ESAVI-CLASSIF-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, los tres filtros acumulativos, los dos includes, orden `createdAt DESC`, paginación y forma reducida de §3.7. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve clasificaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?isSeriousEvent=true` no devuelve las que lo tienen en `null`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los tres filtros combinados se aplican con `AND`; ninguna fila trae `notes`, `appDetails` ni `sysDetails`, y todas traen los nueve booleanos; `?limit=2` devuelve dos filas con el `count` total.

7. **`ESAVI-CLASSIF-003` — obtener por ID.** `getClassificationByIdService(id, lang, includeInactive)` con los dos includes y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una clasificación desactivada devuelve 404 para USER y para ADMIN, y 200 para SUPERADMIN; los booleanos no informados llegan como `null` y no como `false`; `case.eventDate` viene en la respuesta; `sysDetails` no aparece.

8. **`ESAVI-CLASSIF-006` — obtener por caso.** `getClassificationByCaseIdService(caseId, lang, includeInactive)` con los dos 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `classificationCaseIdValidator`, declarada antes de `/:id`. Fila `classification` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con clasificación devuelve 200 con la ficha completa, no envuelta en un array; un caso sin clasificación devuelve 404 `CLASSIF_006_NOT_FOUND`; un `caseId` inexistente devuelve 404 `CLASSIF_006_CASE_NOT_FOUND` — un código distinto del anterior; un caso cuya clasificación está inactiva devuelve 404 para USER y 200 para SUPERADMIN; `GET /case/no-es-uuid` devuelve 400.

9. **`ESAVI-CLASSIF-004` — actualizar.** `updateClassificationService` con los siete pasos de §3.5, recalculando la edad siempre, evaluando la matriz sobre el **estado resultante** y escribiendo `updatedAt` explícitamente. Ruta `PUT /:id` en USER.
   *Verificación:* enviar `caseId` no lo modifica; enviar `age` y `ageUnitItemId` con las dos fechas presentes no cambia la edad y **no** devuelve error; corregir el `birthDate` del paciente y hacer un `PUT` vacío actualiza `age` a su nuevo valor; un `PUT` con `causedDeath: false` sobre una clasificación cuyo único criterio era ése devuelve **400**, porque el estado resultante deja `isSeriousEvent: true` sin criterio; un `PUT` que añade `causedAbortion: true` deriva `isSeriousEvent: true` aunque el body lo mande en `false`; un `PUT` sin cambios devuelve 200 con una entrada más en `appDetails`, las anteriores intactas y `updatedAt` actualizado.

10. **`ESAVI-CLASSIF-005A` y `005B` — desactivar y reactivar.** `setClassificationActivationService` sobre `setEntityActiveStatusService`, con transacción y `const op = isActive ? '005B' : '005A'`. El `where` filtra solo por la PK. Dos controladores y dos rutas: `DELETE /:id` en ADMIN, `PATCH /activate/:id` en SUPERADMIN, ambas respondiendo sin `data`.
    *Verificación:* desactivar deja `isActive: false` y `deletedAt` con fecha; desactivar dos veces devuelve 409 `CLASSIF_005A_ALREADY_INACTIVE`; reactivar deja `deletedAt` en `null`; un ADMIN recibe 403 en `PATCH /activate/:id`; reactivar una clasificación cuyo caso está inactivo devuelve **200**; tras desactivar, `POST` sobre el mismo caso sigue devolviendo **409**, no 201.

11. **`ESAVI-CLASSIF-005C` — purgar.** `purgeClassificationService` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción propia. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `classificationIdValidator` y declarada junto a las otras literales.
    *Verificación:* purgar una clasificación activa devuelve 409 `CLASSIF_005C_STILL_ACTIVE` y la fila sigue ahí; desactivarla y purgarla devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre el mismo caso devuelve 201**: es la única vía que libera el `caseId`; el caso al que pertenecía sigue existiendo e intacto.

12. **La cascada — ampliar `ESAVI-CASE-005A`.** En el mismo bloque de `src/services/esaviCase.service.ts:358-381` donde el SPEC F07 dejó el `Notifier.update`, un `Classification.update` masivo sobre `{ caseId, isActive: true }` que sella `isActive: false`, `deletedAt` y `updatedAt` y añade la entrada con `method: 'ESAVI-CASE-005A'`, reutilizando el mismo `sequelize.literal` de `appDetails`. **Solo cuando `isActive === false`.** Este paso va el último de los de código porque depende del modelo del paso 1 y no lo necesita ningún paso anterior.
    *Verificación:* desactivar un caso con clasificación y notificadores activos los deja **todos** inactivos con `deletedAt` sellado; reactivar el caso no reactiva ninguno; desactivar un caso sin clasificación responde 200 sin error; desactivar un caso ya inactivo devuelve 409 y **nada** cambia de estado; una clasificación que ya estaba inactiva conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; el `appDetails` de la arrastrada registra `ESAVI-CASE-005A`.

13. **Registrar la entidad en las convenciones.** Fila `classification` → `CLASSIF` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `classification` · `006` · «obtener la clasificación de un caso» en la tabla de operaciones no canónicas.
    *Verificación:* `CLASSIF` aparece una sola vez y no colisiona con las catorce existentes; la tabla de no canónicas suma exactamente una fila.

14. **Cubrir las nueve rutas en `tests/auth/roles.test.ts`.** Nueve filas nuevas en `ROUTE_RULES` con su `minRole` y su código, y subir el total esperado de **90 a 99** (`tests/auth/roles.test.ts:198`).
    *Verificación:* `npm test -- roles` pasa.

15. **Suite de contrato `tests/contract/classification.test.ts`.** Recorrido completo con `supertest`: crear → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → desactivar → reactivar → purgar. Más los caminos de error: `caseId` inexistente (404), `caseId` inactivo (404), caso ya clasificado activo e inactivo (409 los dos), `age` sin `ageUnitItemId` (400), `ageUnitItemId` de otro catálogo (404), `isSeriousEvent` ausente sin ningún `caused*` (400), `isSeriousEvent: true` sin ningún `caused*` (400), `causedOtherCondition: true` sin descripción (400), `eventDate` anterior al nacimiento (409). Y las tres reglas propias: la edad calculada gana al body, la derivación de `isSeriousEvent`, y el `caseId` inmutable en el `PUT`.
    *Verificación:* `npm test -- classification` en verde.

16. **Ampliar `tests/contract/esaviCase.test.ts` con la cascada.** Tres casos nuevos sobre la suite ya existente: desactivar un caso arrastra su clasificación activa; reactivarlo no la devuelve; una clasificación desactivada a mano antes de la cascada conserva su estado y su `deletedAt`. Los casos de `notifier` que introdujo el F07 se mantienen intactos.
    *Verificación:* `npm test` en verde; ni la suite de `esaviCase` ni la de `notifier` pierden ningún caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las nueve rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las ocho operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-CLASSIF-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-CLASSIF-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `CLASSIF` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `classification` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/classification/index.ts` está presente.
- [ ] `GET /api/classifications/admin` y `GET /api/classifications/case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `EsaviCase.hasOne(Classification)` está declarado, y `classification` **no** aparece en ninguna respuesta de `/api/esavi-cases`.
- [ ] `esaviapp.sql` no tiene ni una línea modificada.

**Cálculo de la edad**

- [ ] Con `birthDate` y `eventDate` presentes, un `POST` que manda `age: 40` y un `ageUnitItemId` cualquiera guarda la edad **calculada** y responde **201**, sin 400 y sin aviso.
- [ ] Un paciente nacido tres años antes del evento produce `age: 3` con el item de código `YEARS`.
- [ ] Un paciente nacido siete meses antes del evento produce `age: 7` con `MONTHS`.
- [ ] Un paciente nacido doce días antes del evento produce `age: 12` con `DAYS`.
- [ ] Doce meses exactos producen `1 YEARS`, no `12 MONTHS`; un mes exacto produce `1 MONTHS`, no `30 DAYS`; el mismo día produce `0 DAYS`.
- [ ] El cálculo usa aritmética de calendario: un nacimiento el 29 de febrero con evento el 28 de febrero del año siguiente no produce `1 YEARS`.
- [ ] Sin `birthDate` en el paciente, o sin `eventDate` en el caso, se guardan el `age` y el `ageUnitItemId` del body tal cual.
- [ ] En ese escenario, enviar solo `age` o solo `ageUnitItemId` devuelve **400**; no enviar ninguno de los dos guarda ambos en `null` y responde 201.
- [ ] Un `ageUnitItemId` recibido que no existe, está inactivo o pertenece a otro `catalogType` devuelve **404** `ageUnitNotFound`.
- [ ] Si falta el item `YEARS`, `MONTHS` o `DAYS` del `catalogType` `ageUnit`, la operación devuelve **404** `ageUnitCatalogMissing`, con un código de `AppError` distinto del anterior.
- [ ] Un `eventDate` anterior al `birthDate` devuelve **409** `invalidAgeRange` y no inserta ninguna fila. El `CHECK ("age" >= 0)` de Postgres nunca llega a dispararse.
- [ ] `esaviCase.reportDate` no aparece en ninguna rama del cálculo.

**Coherencia de gravedad**

- [ ] Sin ningún `caused*` en `true` y sin `isSeriousEvent` en el body → **400**.
- [ ] Sin ningún `caused*` en `true` y con `isSeriousEvent: true` → **400**.
- [ ] Sin ningún `caused*` en `true` y con `isSeriousEvent: false` → **201**, y los `caused*` ausentes quedan en `null`.
- [ ] Con `causedDeath: true` e `isSeriousEvent: false` en el body → **201** con `isSeriousEvent: true` en la respuesta: el servicio lo deriva.
- [ ] Con `causedDeath: true` y sin `isSeriousEvent` en el body → **201** con `isSeriousEvent: true`.
- [ ] `causedOtherCondition: true` sin `otherSeriousConditionDescription` → **400**.
- [ ] Un `PUT` con `causedDeath: false` sobre una clasificación cuyo único criterio era ése devuelve **400**: la matriz se evalúa sobre el estado resultante, no sobre el body.
- [ ] Los booleanos no informados llegan como `null` en todas las respuestas, nunca como `false`.

**Uno a uno**

- [ ] `POST` sobre un caso que ya tiene clasificación **activa** devuelve **409** `caseAlreadyClassified`, con el `caseId` interpolado en el mensaje.
- [ ] `POST` sobre un caso cuya clasificación está **inactiva** devuelve también **409**: el hueco no se libera con el borrado lógico.
- [ ] Purgar la clasificación con `005C` libera el `caseId`, y un `POST` posterior sobre ese caso devuelve **201**.
- [ ] Enviar `caseId` en el body de `PUT /:id` deja el caso original intacto y no devuelve error.
- [ ] Ningún `INSERT` llega a Postgres con el `caseId` ocupado: la suite no produce ningún error `23505`.

**Acceso por caso (`006`)**

- [ ] `GET /case/:caseId` devuelve el objeto directamente, **no** `{ count, rows }`.
- [ ] Un caso inexistente devuelve **404** `CLASSIF_006_CASE_NOT_FOUND`; un caso sin clasificación devuelve **404** `CLASSIF_006_NOT_FOUND`. Los dos códigos son distintos.
- [ ] Un caso cuya clasificación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN.
- [ ] `GET /case/no-es-uuid` devuelve **400**.

**Listados y filtros**

- [ ] `GET /` no devuelve clasificaciones inactivas; `GET /admin` sí.
- [ ] Un USER recibe 403 en `GET /admin`.
- [ ] `?isSeriousEvent=true` no devuelve las que lo tienen en `null`.
- [ ] `?caseId=` de un UUID inexistente devuelve **200** con `{ count: 0, rows: [] }`, nunca 404.
- [ ] Los tres filtros combinados se aplican con `AND`.
- [ ] El orden por defecto es `createdAt DESC`.
- [ ] Las filas del listado traen los nueve booleanos y `otherSeriousConditionDescription`, y **no** traen `notes` ni `appDetails`.
- [ ] `sysDetails` no aparece en ninguna respuesta de ninguna operación.
- [ ] `case.eventDate` viene en la respuesta de las seis operaciones que devuelven clasificación.

**Ciclo de vida y auditoría**

- [ ] `GET /:id` de una clasificación inactiva: 404 para USER y ADMIN, 200 para SUPERADMIN.
- [ ] `DELETE /:id` deja `isActive: false` y `deletedAt` con fecha; `PATCH /activate/:id` lo revierte y deja `deletedAt` en `null`.
- [ ] Desactivar dos veces devuelve 409 `CLASSIF_005A_ALREADY_INACTIVE`.
- [ ] `DELETE`, `PATCH /activate` y `DELETE /purge` responden `{ ok, message }` sin `data`.
- [ ] `PATCH /activate/:id` sobre una clasificación cuyo caso está inactivo devuelve **200**.
- [ ] Cada create, update y activación añade una entrada a `appDetails` sin borrar las anteriores.
- [ ] `appDetails.method` guarda solo el código, sin `_ACTIVATION` ni `_DEACTIVATION` detrás.
- [ ] `PUT /:id` actualiza `updatedAt`: ningún trigger lo hace por la aplicación.

**Cascada desde `esaviCase`**

- [ ] `DELETE /api/esavi-cases/:id` deja la clasificación activa del caso con `isActive: false` y `deletedAt` sellado, en la misma transacción.
- [ ] `PATCH /api/esavi-cases/activate/:id` **no** la reactiva.
- [ ] Una clasificación desactivada a mano antes de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`.
- [ ] Desactivar un caso ya inactivo devuelve 409 y **nada** cambia de estado.
- [ ] Desactivar un caso sin clasificación responde 200 sin error.
- [ ] El `appDetails` de la clasificación arrastrada registra `method: 'ESAVI-CASE-005A'`, no `'ESAVI-CLASSIF-005A'`.
- [ ] Los notificadores siguen cayendo por la cascada exactamente como antes: la suite del F07 no pierde ningún caso.

**Borrado físico (`005C`)**

- [ ] `DELETE /purge/:id` sobre una clasificación activa devuelve **409** `CLASSIF_005C_STILL_ACTIVE` y la fila sigue existiendo.
- [ ] Sobre una desactivada devuelve **200** sin `data`, y `Classification.findByPk(id, { paranoid: false })` devuelve `null`.
- [ ] Repetir la purga devuelve **404** `CLASSIF_005C_NOT_FOUND`.
- [ ] Un ADMIN recibe **403**.
- [ ] Purgar **no** altera el caso: el `esaviCase` sigue existiendo con los mismos datos.
- [ ] El log recoge una línea `ESAVI-CLASSIF-005C` en nivel `warn` con el volcado de la fila antes del `destroy`.

**Cierre**

- [ ] Las diecinueve claves de §3.6 existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `ROUTE_RULES` pasa de 90 a 99 y `npm test -- roles` pasa.
- [ ] `tests/unit/age.helper.test.ts` cubre los siete bordes del paso 3 y pasa.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre la cardinalidad**

- **Sí:** uno a uno. `UQ_classification_case` lo declara (`esaviapp.sql:715`). Es el reverso exacto del razonamiento del SPEC F07: allí la ausencia de `UNIQUE` significaba muchos, aquí su presencia significa uno.
- **Sí:** 409 al intentar clasificar un caso que ya tiene clasificación **inactiva**. Es el canon de §11: la unicidad se evalúa sin filtrar por `isActive`, porque es lo que garantiza de verdad la `UNIQUE` del DDL. Filtrar por `isActive: true` dejaría pasar un `INSERT` que Postgres rechaza con `23505`, convirtiendo un 409 en un 500.
- **Sí:** que el mensaje del 409 interpole el `caseId`. El usuario recibe un conflicto por una fila que no puede ver; sin el dato, el error es indistinguible de un fallo.
- **No:** liberar el `caseId` con el borrado lógico mediante un índice único parcial `WHERE "isActive"`. Exigiría tocar `esaviapp.sql`, que este spec no toca, y la misma decisión ya está tomada en §11 para todo el repositorio.
- **No:** convertir el `POST` sobre un caso ya clasificado en un update encubierto. Un `POST` que a veces crea y a veces modifica hace inútil el código de operación para rastrear qué se intentó.

**Sobre la edad calculada**

- **Sí:** calcularla en vez de aceptarla. Es un dato derivable de dos fechas que el sistema ya guarda, y capturarlo a mano garantiza que a la larga contradiga a su origen.
- **Sí:** ignorar **en silencio** lo que mande el cliente cuando hay fechas suficientes, en `001` y en `004` por igual. Un 400 castigaría a quien reenvía entera la ficha que acaba de leer con un `GET`, que es el uso normal de un formulario.
- **Sí:** unidad por criterio epidemiológico —años, meses o días según la magnitud— en vez de años siempre. Un lactante de tres meses y uno de once no son el mismo caso, y `age: 0` los haría indistinguibles.
- **Sí:** aritmética de calendario sobre períodos cumplidos. Dividir milisegundos entre 365 desplaza un día en los bordes y falla en los años bisiestos, justo donde el dato se revisa.
- **No:** usar `esaviCase.reportDate` como respaldo de `eventDate`. Es cuándo se reportó, no cuándo ocurrió: produciría una edad plausible y falsa, indistinguible de una correcta. Si falta la fecha del evento, que se note.
- **Sí:** 409 y no 400 cuando `eventDate` precede a `birthDate`. El conflicto está entre dos filas que ya existen; un 400 culparía a quien no envió esos datos.
- **Sí:** recalcular en cada `004`, aunque el `PUT` no toque nada relacionado. Da una vía manual de corrección mientras no exista el spec de propagación, y evita mantener dos caminos distintos para la misma regla.
- **No, todavía:** recalcular las clasificaciones guardadas cuando cambien `patient.birthDate` o `esaviCase.eventDate`. Obliga a modificar dos servicios cerrados y a decidir qué pasa con las inactivas. Va en su propio spec.
- **Sí:** mantener `age` y `ageUnitItemId` en `CreateClassificationInput` aunque casi siempre se ignoren. Son la vía de respaldo, y quitarlos dejaría sin forma de informar la edad cuando falta una fecha — que en este esquema es posible, porque las dos columnas son nulables.
- **Sí:** juntos o ninguno por la vía de respaldo. Un número sin unidad es menos útil que ningún número: obliga a adivinar, y quien adivine elegirá años.

**Sobre el catálogo `ageUnit`**

- **Sí:** resolver la unidad por `code` dentro del `catalogType` `ageUnit`, en `toConstantCase` (`YEARS`, `MONTHS`, `DAYS`) y con el tipo en camelCase, que es lo que imponen `catalogItem.service.ts:22` y `catalogType.service.ts:78`.
- **Sí:** 404 con clave propia cuando el item no aparece, en vez de guardar `age` con unidad nula. Un número sin unidad es exactamente lo que el cálculo venía a evitar.
- **Sí:** dos claves i18n distintas —`ageUnitNotFound` y `ageUnitCatalogMissing`— para los dos 404. Una culpa a la entrada del cliente y la otra señala una precondición del despliegue; fundirlas haría que un error de instalación pareciera un error de captura.
- **No:** sembrar el catálogo desde este spec. Los catálogos se cargan por los endpoints ya existentes; hacerlo aquí duplicaría esa vía y ataría el spec a un juego de datos concreto. Es la misma decisión que el F07 tomó con `profession`.
- **No:** guardar la unidad como un `enum` de Postgres o una cadena en la propia tabla. El DDL declara una FK a `catalogItem` y no se discute el esquema.

**Sobre la gravedad y el tri-estado**

- **Sí:** conservar `null` como estado distinto de `false`. En vigilancia epidemiológica «no se sabe» y «no» no son lo mismo, y el DDL dejó las nueve columnas nulables a propósito.
- **Sí:** derivar `isSeriousEvent` a `true` cuando algún `caused*` lo está, sin error. Es la definición del término: un evento con criterio de gravedad **es** grave, y pedirle al cliente que lo repita solo abre la puerta a que se contradiga.
- **Sí:** 400 cuando `isSeriousEvent: true` no tiene ningún criterio detrás. Una clasificación grave sin causa no es información, es una casilla marcada.
- **Sí:** `isSeriousEvent` obligatorio cuando no hay ningún `caused*` en `true`. Sin esa regla, una ficha vacía se guardaría como clasificación válida y el caso figuraría clasificado sin haberlo sido.
- **Sí:** las tres reglas de 400 en el **validador** y la derivación en el **servicio**. Las primeras son cruces entre campos del mismo body, con precedente en `esaviCase.validator.ts:59`; la segunda es una regla de negocio que no produce error.
- **Sí:** en el `004`, evaluar la matriz sobre el **estado resultante** y no sobre el body, y por eso en el servicio. Si no, un `PUT` que retira el único criterio dejaría `isSeriousEvent: true` colgando, que es exactamente la incoherencia que la matriz previene.
- **No:** imponer la coherencia con un `CHECK` en la base. Habría que tocar `esaviapp.sql`, y un `23514` llega al cliente como 500 sin decir qué campo lo causó.
- **No:** un único campo `severityCriteria` de tipo array en vez de nueve booleanos. La tabla ya está definida y el esquema no se discute.

**Sobre `caseId`**

- **Sí:** obligatorio en el alta y con el caso **activo**, por la regla de FK de §11 y por coherencia con la cascada que este mismo spec extiende.
- **Sí:** inmutable en `004`, ignorado sin error si llega en el body. Es la decisión del F06 con `caseCode` y la del F07 con su `caseId`. Además, trasladar una clasificación chocaría con la `UNIQUE` del destino y dejaría al origen sin clasificación sin que nada lo registre.
- **No:** devolver 400 cuando `caseId` llega en el `PUT`. Precedente contrario ya fijado dos veces.

**Sobre los roles**

- **Sí:** `001` y `004` en **USER**, desviándose de la matriz canónica de §9. Es la desviación de los SPEC F05, F06 y F07 y por la misma razón: clasificar forma parte del mismo flujo operativo que notificar el caso.
- **Sí:** `006` en USER. Es una lectura, y su equivalente `003` también lo es.
- **Sí:** `005A` en ADMIN, `005B` y `005C` en SUPERADMIN. Retirar una clasificación del registro no es parte del flujo de captura.

**Sobre el listado y el acceso por caso**

- **Sí:** un `006` propio en `GET /case/:caseId`, además del filtro `?caseId=`. Es la consulta real del dominio —el cliente tiene el caso, no el `classificationId`— y devolver una ficha uno a uno envuelta en `{ count, rows }` obliga a desempaquetar un array de un elemento en cada pantalla.
- **Sí:** que `006` distinga con dos códigos el caso inexistente del caso sin clasificar. Para el cliente son dos situaciones distintas: una es un enlace roto, la otra es una tarea pendiente.
- **No:** numerar el acceso por caso como una letra de `003`. Los sufijos distinguen variantes de la misma operación, y buscar por PK y buscar por FK no lo son. La regla de §6 es explícita.
- **Sí:** dual `GET /` + `GET /admin`, como el resto del dominio.
- **Sí:** los nueve booleanos en la forma reducida del listado. El caso de uso es ver qué casos son graves y bajo qué criterio; una lista sin ellos obliga a una petición por fila.
- **No:** `notes` en la reducida. Es texto libre sin límite de longitud y hace impredecible el tamaño de la página. Es el mismo criterio que el F07 aplicó a `details`.
- **Sí:** `case.eventDate` en la respuesta, ampliando la forma que el F07 usó para `case`. Es la fecha desde la que se calculó la edad: sin ella el cliente ve un número que no puede explicar.
- **Sí:** orden `createdAt DESC`, coherente con `notifier` y `esaviCase`.
- **No:** filtros por rango de edad o de `firstConsultationDate`. Los tres filtros son por igualdad; los rangos son un spec de consulta que no existe todavía.
- **No:** un valor de query para filtrar por `isSeriousEvent` «no informado». Exigiría un tercer valor que el booleano no tiene, y el listado admin ya permite verlas todas.

**Sobre la cascada**

- **Sí:** sumarse al mecanismo del SPEC F07 en el mismo punto de `esaviCase.service.ts`, en vez de construir uno propio. Es la prueba de que aquel mecanismo era extensible y no un arreglo puntual.
- **Sí:** cascada **solo de bajada**, sin excepción. Reactivar en cascada resucitaría una clasificación que alguien retiró a propósito antes de tocar el caso.
- **Sí:** `method: 'ESAVI-CASE-005A'` en el `appDetails` de la clasificación arrastrada. La operación que la desactivó fue ésa.
- **Sí:** reactivar una clasificación no exige que su caso esté activo. Quien reactiva es SUPERADMIN, que es el único que ve los inactivos.
- **No:** bloquear la desactivación de un caso cuya clasificación diga que el evento fue grave. Sería atar el ciclo de vida del caso al contenido de un satélite, y la decisión administrativa de retirar un caso es de quien tiene el rol, no del dato.

**Sobre el modelo y las convenciones**

- **Sí:** `EsaviCase.hasOne(Classification)`, siguiendo el precedente que el F07 abrió al declarar el inverso de `notifier`. Es `hasOne` porque la `UNIQUE` lo impone. La cascada no lo necesita —el `update` masivo filtra por `caseId`—, pero mantener el criterio evita que el siguiente satélite lo decida de nuevo.
- **No:** incluir `classification` en las respuestas de `/api/esavi-cases`. El inverso existe por simetría, no por contrato. Añadirlo cambiaría el tamaño de una respuesta ya publicada.
- **No:** asociación directa entre `Classification` y `Patient`. El paciente se alcanza por el caso, y una segunda vía haría posible que las dos discreparan.
- **Sí:** los nueve booleanos sin `defaultValue` en el modelo. Un `defaultValue: false` convertiría el tri-estado en dos estados y borraría la distinción que §2 preserva.
- **Sí:** un helper puro en `src/helpers/age.helper.ts` con suite unitaria propia, aunque `tests/unit/` no exista todavía. Los bordes son aritmética de calendario y cubrirlos por HTTP obligaría a fabricar un paciente y un caso por cada caso de prueba. Es una extensión pequeña y deliberada de la estructura de tests.
- **Sí:** abreviatura `CLASSIF`, y **`FINCLASS` reservada** para `finalClassification`. Registrar aquí solo la primera y dejar constancia de la segunda evita que el spec de `finalClassification` descubra tarde que el nombre obvio ya no está.
- **Sí:** exponer `005C`. `classification` no figura en el bucle `preventPhysicalDelete`, así que le corresponde por la regla del [SPEC F08](./08-physical-delete.md), que es objetiva. Las razones de fondo están allí.
- **No:** cifrar ningún campo. La tabla no contiene datos identificativos: una edad sin fecha de nacimiento no identifica a nadie, y el paciente ya está cifrado en su tabla. Cifrar `age` además impediría el `CHECK` de la columna y cualquier filtro futuro.
- **No:** tocar `esaviapp.sql` por ninguna vía — ni índice único parcial, ni `CHECK` de coherencia, ni `IX_classification_case`, ni `preventPhysicalDelete`, ni el trigger `TRG_*_setUpdatedAt` que el esquema hace `DROP` y nunca crea.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| La edad depende de dos tablas ajenas. Si alguien corrige `patient.birthDate` o `esaviCase.eventDate` después de clasificar, la clasificación conserva la edad vieja y **nada avisa**: queda un dato derivado que contradice a su origen | Es la limitación consciente de este spec y está declarada en §2 como alcance de otro. Mientras tanto, un `PUT` vacío sobre la clasificación la recalcula, así que la corrección existe y es de una petición. El riesgo real no es que no se pueda arreglar, es que nadie sepa que hay que hacerlo |
| Ignorar en silencio el `age` del cliente puede desconcertar: alguien envía `age: 40` y recibe `age: 3` sin ningún aviso, y lo lee como un fallo del endpoint | La respuesta trae `case.eventDate` justamente para que el número se pueda explicar. La alternativa —400— se descartó en §6 porque castiga el reenvío de una ficha completa, que es el uso normal. Conviene que la documentación de la API lo diga en la primera línea del endpoint |
| El `catalogType` de código `ageUnit` no existe en el DDL ni en ninguna siembra del repositorio. Si no se carga antes, **toda** alta con las dos fechas presentes devuelve 404 y parece un fallo del endpoint | Está declarado como precondición del plan, no como paso, y tiene clave i18n propia (`ageUnitCatalogMissing`) que nombra la causa y el código que falta. Es exactamente el mismo riesgo que el F07 asumió con `profession`, agravado porque aquí afecta al camino feliz y no solo a un campo opcional |
| La matriz de coherencia se evalúa en **dos sitios**: el validador la aplica sobre el body y el servicio sobre el estado resultante del `004`. Dos implementaciones de la misma regla divergen con el tiempo | La lógica vive en un **único predicado puro** compartido por los dos, al que el validador le pasa el body y el servicio la fusión de fila y body. Si se implementan por separado, el criterio de aceptación del `PUT` que retira el único criterio (400) es lo que detecta la divergencia |
| `firstConsultationDate` no se valida contra `eventDate`: se puede guardar una primera consulta **anterior** al evento que la motivó | Asumido y declarado en §3.5. El validador solo ve el body y el evento está en otra tabla; subir la comprobación al servicio es posible pero abre la pregunta de qué hacer cuando `eventDate` falta. Si se pide, va en su propio spec |
| Purgar con `005C` es la única vía que libera el `caseId`, así que se convierte en el camino para reclasificar un caso desde cero — y borra el rastro de la clasificación anterior | Exige SUPERADMIN, exige que la fila esté ya desactivada con `005A`, y vuelca la fila completa al log en `warn` antes de destruirla. Son dos pasos deliberados y un rol máximo; lo que queda es que el rastro vive solo en el log, que es la limitación asumida del F08 |
| `classification` **no** está en la lista de `preventPhysicalDelete` (`esaviapp.sql:1354-1360`), así que un `DELETE FROM "classification"` por SQL directo ejecuta sin ninguno de esos controles | El DDL no lo impide y este spec no lo cambia. La respuesta es la operación controlada del F08, no un cambio de esquema |
| La cascada modifica por segunda vez `setEsaviCaseActivationService`, un servicio ya cerrado y con dos suites de contrato dependiendo de él | El cambio es aditivo, va en el mismo bloque que el `Notifier.update` y está acotado a la rama `isActive === false`. El paso 16 amplía `tests/contract/esaviCase.test.ts` sin retirar ninguno de sus casos, así que una regresión sobre `notifier` falla la suite |
| Los booleanos en `null` los interpretan como `false` los clientes JavaScript que hagan `if (c.causedDeath)`. El tri-estado solo sirve si quien lo consume lo respeta | El servidor no normaliza en ninguna dirección y la distinción está en el contrato de §3.7. Lo que el backend puede garantizar es que nunca inventa un `false`; que el cliente lo distinga es responsabilidad suya y conviene avisarlo |
| Un caso cuya clasificación se desactivó queda **sin clasificación visible pero con el `caseId` ocupado**: no aparece en `006`, y `001` responde 409. Visto desde fuera parece un callejón sin salida | Es coherente con §11 y está cubierto por dos criterios de aceptación. La salida existe y son dos: reactivar con `005B` (SUPERADMIN) o purgar con `005C` (SUPERADMIN). Que ambas exijan el rol máximo es deliberado, pero conviene que el mensaje del 409 lo haga evidente — por eso interpola el `caseId` |
| `tests/unit/` es un directorio de pruebas que no existe hoy, y podría no recogerlo la configuración | No hay riesgo real: `jest.config.ts:7-8` declara `roots: ['<rootDir>/tests']` con `testMatch: ['**/*.test.ts']`, así que el archivo nuevo se recoge sin tocar la configuración. Comprobado antes de escribir el paso 3 |
| `GET /:id` captura `admin` o `case` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato |

---

## 8. Impacto en el contrato HTTP

Este spec añade nueve endpoints nuevos, que no impactan a nadie. Pero **sí amplía el efecto lateral de un endpoint ya publicado**, por segunda vez desde que existe:

| Endpoint | Antes (tras el SPEC F07) | Después |
|---|---|---|
| `DELETE /api/esavi-cases/:id` (`ESAVI-CASE-005A`) | Desactiva el caso y todos sus notificadores activos | Desactiva el caso, sus notificadores activos **y su clasificación activa**, todo en la misma transacción |
| `PATCH /api/esavi-cases/activate/:id` (`ESAVI-CASE-005B`) | Reactiva solo la fila del caso | Sin cambios: **no** reactiva ni notificadores ni clasificación |

La forma de la respuesta de las dos operaciones no cambia: siguen devolviendo `{ ok, message }` sin `data`, 200 en éxito y 409 cuando el caso ya está en el estado pedido.

La asimetría es la misma que fijó el F07 y está razonada en §6. La consecuencia nueva es más incómoda que con `notifier`, y conviene decirla explícitamente: **un cliente que desactive y reactive un caso se queda con el caso activo y sin clasificación visible**, porque `PATCH /api/classifications/activate/:id` exige SUPERADMIN. Y mientras eso no se corrija, `POST /api/classifications` sobre ese caso responde **409**, no 201: el `caseId` sigue ocupado por la fila inactiva. Es el estado que §7 describe como aparente callejón sin salida, y es la razón de que el mensaje del 409 interpole el `caseId`.

`GET /api/esavi-cases` y `GET /api/esavi-cases/:id` **no cambian**: el `hasOne` nuevo no se incluye en ninguna de sus consultas y `classification` no aparece en sus respuestas.

---

## Lo que **no** está en este spec

- Las otras tres tablas satélite de `esaviCase` —`notification`, `investigation` y `finalClassification`— y las veintiocho que cuelgan de ellas. `finalClassification` es una tabla distinta (`esaviapp.sql:1244-1269`) por mucho que comparta raíz de nombre.
- Dar de alta la abreviatura `FINCLASS`, que aquí solo queda reservada de palabra.
- Extender la cascada de `ESAVI-CASE-005A` a esos tres satélites.
- Recalcular la edad de las clasificaciones ya guardadas cuando cambien `patient.birthDate` o `esaviCase.eventDate`. Hasta que exista ese spec, la vía es un `PUT` sobre la clasificación.
- Sembrar el `catalogType` de código `ageUnit` y sus tres items. Es precondición, no alcance.
- Validar `firstConsultationDate` contra `eventDate`.
- Cualquier modificación de `esaviapp.sql`: índice único parcial, `CHECK` de coherencia, `IX_classification_case`, `preventPhysicalDelete` o el trigger `TRG_*_setUpdatedAt`.
- Cifrado de ningún campo de esta tabla.
- Filtros u ordenaciones por rangos de edad o de fechas, y cualquier endpoint de estadística, conteo por criterio de gravedad o exportación.
- Crear la clasificación automáticamente al dar de alta un `esaviCase`.
- Atar el ciclo de vida del caso al contenido de su clasificación.
- Incluir `classification` en las respuestas de `/api/esavi-cases`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
