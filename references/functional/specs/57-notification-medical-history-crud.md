# SPEC F57 — CRUD de `notificationMedicalHistory`

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F33 (`investigationPregnancyCondition` — gemelo estructural: aporta la resolución con dos derivados, la guarda de duplicado sin respaldo de base y la tabla de `candidates` con derivados)**, **SPEC F15 (`diagnosticTerm` — dependencia dura de implementación: aporta `resolveDiagnosticTermService`)**, **SPEC F04 (`notification` — padre de la FK: sin notificación no hay antecedente, y su volcado de purga gana una séptima línea)**, SPEC F27 (`notificationPregnancyComplication` — hermana de forma en el bloque de notificación), SPEC F16 (`notificationEvent` — origen del hallazgo del `sortOrder` en el `005B` y de la nota de `CREATE_FIELDS`), SPEC F21 y F22 (`notificationMedication`, `notificationVaccine` — la familia de hijas 1:N de la notificación, de donde salen la matriz de roles y la forma del `006`), SPEC F47 (`patient` — precedente de editar `esaviapp.sql` en el sitio, sin migración), SPEC F08 (operación `005C` de borrado físico), SPEC F12 (`buildDifferentialUpdate`)
> **Fecha:** 2026-09-08
> **Objetivo:** Crear `notificationMedicalHistory` —los antecedentes médicos relevantes del paciente notificado, N por notificación, resueltos contra el maestro clínico— como **la primera tabla que este repositorio añade al DDL para dar respuesta a una pregunta que la notificación ya hacía y no sabía dónde guardar**.

---

## 1. Por qué existe este spec

`notification` pregunta por los antecedentes médicos desde el primer día: `"hasRelevantMedicalHistory" "answerOption"` (`esaviapp.sql:805`). **Y no hay ningún sitio donde escribir la respuesta.** Un `'YES'` en esa columna afirma que el paciente tiene antecedentes relevantes y no dice cuáles; la lista queda fuera del sistema, en el papel o en `esaviDescription`.

Es una asimetría del esquema, no una carencia de la aplicación. La cadena de investigación sí tiene las dos mitades: `investigationMedicalHistory` (`:1117`) guarda el bloque 1:1 y `investigationPregnancyCondition` (`:1146`) guarda las N filas de términos que cuelgan de él. La cadena de notificación tiene la pregunta y le falta la lista.

**A — Es la primera tabla nueva del repositorio.** Las cincuenta y seis specs anteriores escribieron sobre las 45 tablas que `esaviapp.sql` ya declaraba; ninguna añadió un `CREATE TABLE`. El precedente que lo hace posible es **F47**, que reescribió las columnas de nombre de `patient` editando el DDL en el sitio, sin script de migración, apoyado en que el sistema está en desarrollo y no hay datos de pacientes cargados. Ese supuesto sigue vigente y es la base de este spec: `esaviapp.sql` se cargará ya con la tabla dentro. **El esquema pasa de 45 tablas a 46**, y la línea de `CLAUDE.md` que dice «45 tables» pasa a decir 46.

**B — De forma es el gemelo exacto de F33, con un salto menos.** PK propia con `DEFAULT gen_random_uuid()`, FK `NOT NULL` al padre con `ON DELETE CASCADE`, `diagnosticTermId` anulable con `ON DELETE RESTRICT`, una sola columna de texto libre, `sortOrder` por trigger, `isActive` propio y las seis transversales. La diferencia está en la profundidad: F33 es **nieta** —cuelga de `investigationMedicalHistory`, cuyo padre es quien tiene el `isActive`—, y ésta es **hija directa** de `notification`, que sí tiene estado propio. La visibilidad heredada es por tanto de **un salto**, la forma corriente de F21, F22 y F16, y no la cadena de dos saltos que F33 estrenó.

**C — Arrastra el hallazgo del `005B` de F16, y es la octava vez.** La tabla entra en el bucle `setSortOrderByParent` con `notificationId` como padre y lleva índice único parcial sobre `("notificationId", "sortOrder") WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL`. El trigger es `BEFORE INSERT` solamente y `entityActivation.service.ts:34` limpia `deletedAt` sin mirar el número: reactivar un antecedente cuyo `sortOrder` ya lo tomó otra hermana viva revienta el índice. F16 lo descubrió; F21, F22, F24, F27, F31 y F33 lo arrastraron; aquí vuelve entero, y es la razón de que el `005B` no delegue sin más en `setEntityActiveStatusService`.

**D — Se declara nueva, pero nace con dos triggers heredados.** El bucle de `sysDetails` (`:1404-1419`) **no lista tablas: las descubre** con una consulta a `information_schema.columns` por la columna `sysDetails`. Declarar la columna basta para que `TRG_notificationMedicalHistory_setSysDetails` exista. El de `sortOrder` (`:1428-1451`), en cambio, va por lista literal y **sí hay que añadir la fila**. Y `preventPhysicalDelete` (`:1490-1499`) también va por lista: dejarla fuera —deliberado— es lo que hace que a esta tabla le corresponda un `005C`.

**E — La bandera del padre y la lista quedan desacopladas a propósito.** Nadie escribe `notification.hasRelevantMedicalHistory` desde aquí, ni el `001` la exige en `'YES'`. Es la decisión de F33 frente a `isPregnancyConfirmed` y la de F27 frente a `hasComplications`, y por la misma razón: la bandera es dato del formulario, la lista es dato clínico, y replicar la regla del padre en la hija duplicaría la fuente de verdad. La consecuencia asumida —una notificación con `'NO'` y tres antecedentes cargados— está en §7.

**Y un rasgo que no la separa:** el `ESAVI-NOTIFCN-005A` **no** sella estas filas. La cascada de la notificación (`notification.service.ts:627-631`) solo mueve el `deletedAt` de sus dos detalles 1:1 —`severeNotification` y `nonSevereNotification`—, que no tienen estado propio; las hijas 1:N con `isActive` se quedan fuera, exactamente como `notificationEvent`, `notificationMedication` y `notificationVaccine`. **`satelliteCascade.service.ts` no se toca.** Lo que sí las alcanza es el `005C`: el `ON DELETE CASCADE` de Postgres las destruye, y por eso el volcado de la purga gana una línea.

---

## 2. Alcance

**Dentro:**

- **La tabla nueva en `esaviapp.sql`**, con la forma de §3.1: `CREATE TABLE`, su índice `IX_notificationMedicalHistory_notification`, su fila en el bucle `setSortOrderByParent` y su índice único parcial `UQ_notificationMedicalHistory_parent_sortOrder`. **Fuera** de `preventPhysicalDelete`. Se inserta después de `notificationPregnancyComplication` (`esaviapp.sql:1003`), antes del bloque `-- Investigation split model` (`:1005`).
- **La cuenta de tablas de `CLAUDE.md`**, de 45 a 46, y la de modelos existentes si la línea la cita.
- Los siete artefactos completos: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Nueve operaciones y ninguna más:** `001` crear, `002A` listar activos por notificación, `002B` listar todos por notificación, `003` obtener por ID, `004` actualizar, `005A` desactivar, `005B` reactivar, `005C` borrado físico y **`006` listar los antecedentes de un caso**. El `006` sí tiene ruta HTTP, como el de `NOTIFEVT`, `NOTIFMED` y `NOTIFVAC`, y **se registra en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6**.
- **Listado por padre, no global.** `002A` en `GET /notification/:notificationId` para USER devuelve solo los activos; `002B` en `GET /admin/notification/:notificationId` para ADMIN los devuelve todos, incluidos los de `deletedAt` sellado. **Sin ningún filtro por query**, ordenados por `sortOrder` ascendente y paginados con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Nunca por `/`.
- **El `006` entra por `caseId` y es el `002A` con dos guardas delante**, en la forma literal de F21: el caso existe y está activo → 404; su notificación existe y está activa → 404; a partir de ahí, solo activos, ordenados por `sortOrder`. **No se declara variante admin del `006`**: quien necesite ver inactivos entra por el `002B` con el `notificationId` que este mismo endpoint devuelve.
- **Guarda del padre en `001`, `002A` y `002B`:** la notificación existe y está activa → 404 `MEDHIST_<op>_NOTIFICATION_NOT_FOUND`. **Sin comprobar `notificationType`** — los antecedentes se registran igual en una notificación grave que en una no grave. En los dos listados la comprobación de estado la relaja `canViewInactive`; **en el `001` no se relaja para nadie**: una notificación inactiva no recibe antecedentes nuevos, sea quien sea quien lo pida.
- **Visibilidad heredada de un salto**, en `002A`, `002B`, `003`, `004` y las filas del `006`: si la notificación está inactiva **o** el propio antecedente está inactivo, la respuesta es **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`). **No aplica a `005A`, `005B` ni `005C`**, que actúan sobre el estado propio de la fila.
- **Resolución contra el maestro clínico, en `001` y `004`**, con las tres ramas de F33:
  - Con `historyCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService`, que devuelve el término existente o **lo crea**.
  - Con `historyCode` y `source` distinto de `'LOCAL'` → `findOne` sobre el par `(source, code)`, **sin crear nada**; si no existe → 404 `MEDHIST_<op>_DIAGTERM_NOT_FOUND`.
  - Sin `historyCode` → `diagnosticTermId` queda `null` y `historyRaw` guarda el texto tal cual.
- **Dos campos derivados, no tres.** `diagnosticTermId` e `historyRaw`. La tabla **no tiene columna para el nombre del maestro ni para el código**: `historyRaw` guarda el texto del notificador **solo si difiere** del nombre del maestro, y el nombre canónico se lee del `include`. Es la tabla de F27 y F33, literal.
- **Resolución disparada por el cambio de valor, no por la presencia de la clave** (SPEC F12): en el `004`, un `historyCode` que llega igual al guardado no se resuelve ni se consulta. Reenviar íntegra la respuesta del `GET` **no escribe en `diagnosticTerm`**.
- **`historyName` obligatorio en el `001`**, máximo 500 caracteres, y **no anulable en el `004`**: un `null` explícito es 400 del validador.
- **Guarda de duplicado**, en `001` y `004`: el `diagnosticTermId` no puede repetirse entre los antecedentes **activos** de la misma notificación → 409 `MEDHIST_<op>_ALREADY_EXISTS`. **Solo corre si el término resolvió**: dos antecedentes de texto libre son registros distintos aunque el texto coincida. No está respaldada por ninguna restricción de base: es regla de negocio del servicio. **El `005B` no la revalida**, y el duplicado por reactivación es consecuencia asumida, razonada en §6.
- **`notificationId` y `sortOrder` inmutables**, ignorados en silencio en el `004`, sin 400. Un antecedente no se traslada entre notificaciones y su orden lo gobierna la base.
- **`sortOrder` asignado por la base.** El `001` nunca lo envía. Exige la lista explícita `CREATE_FIELDS` en el `create`, por la razón que F16 §3.2 documentó: sin ella la validación `notNull` de Sequelize mata el alta antes de que el trigger llegue a ejecutarse.
- **Reasignación de `sortOrder` en `ESAVI-MEDHIST-005B`** cuando el número que ocupaba la fila ya lo tomó otro antecedente vivo de la misma notificación. Es una **escritura con intención propia**, declarada como no diferencial en §3.5.
- **Normalización al escribir: solo `trim()`** sobre `historyName` y `notes`, con `normalizeText`. Ningún `toTitleCase` ni `toConstantCase` — no hay `code` propio, y el del término lo normaliza `resolveDiagnosticTermService`.
- **`005A` no se bloquea por nada.** La tabla es hoja del grafo: ninguna de las 46 la referencia. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial — deliberado.
- **`005C` sin volcado de cascada propio**, porque no arrastra nada. Guarda canónica: la fila debe estar en `isActive: false` → si no, 409. La aporta `purgeEntityService` tal cual.
- **Un volcado `warn` en un archivo ajeno, y ningún bloqueo:** `notification.service.ts` gana `dumpNotificationMedicalHistoriesBeforeCascade`, la **séptima** función de volcado de `ESAVI-NOTIFCN-005C`, con la forma de `dumpNotificationVaccinesBeforeCascade` (`notification.service.ts:773`). Es la **única escritura de este spec fuera de su propia tabla**.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5: dos inmutables que no entran, dos derivados que entran **siempre**, y uno anulable.
- Alta de la abreviatura **`MEDHIST`** en `references/CONVENTIONS.md` §6, y de la fila del `006` en la tabla de operaciones no canónicas.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts` y suite `tests/contract/notificationMedicalHistory.test.ts`.

**Precondiciones de implementación** (no son parte de este spec):

- **La base se recarga con el DDL nuevo.** No hay migración: el supuesto de F47 —desarrollo, instalaciones locales, sin datos productivos— es lo que lo permite. Una instalación con datos exige un `CREATE TABLE` manual antes de desplegar, y eso queda fuera.
- **El maestro `diagnosticTerm` no necesita precarga.** La rama `LOCAL` acuña términos al vuelo. **No hay ningún `catalogType` que sembrar**: esta tabla no tiene ninguna FK a `catalogItem`.

**Fuera de alcance (otros specs):**

- **Escribir `notification.hasRelevantMedicalHistory` desde aquí, en cualquier forma.** Ni el `001` la fuerza a `'YES'`, ni la exige, ni el `005A` la devuelve a `'NO'` cuando se retira el último antecedente. La bandera es dato del formulario y solo la escribe `ESAVI-NOTIFCN-004`. Está razonada en §6.
- **Cualquier guarda de coherencia contra esa bandera.** Cargar un antecedente sobre una notificación con `hasRelevantMedicalHistory` distinto de `'YES'`, `null` incluido, responde **201**, no 409.
- **Cualquier regla que exija al menos un antecedente** cuando la bandera vale `'YES'`, o que valide su composición.
- **Copiar, sincronizar o arrastrar estas filas hacia `investigationMedicalHistory` o `investigationPregnancyCondition`** cuando el caso pasa a investigación. Son dos registros clínicos de dos momentos distintos y ninguno alimenta al otro. Su propio spec, si alguna vez se quiere.
- **Exponer la colección dentro de la respuesta de `notification` o de `esaviCase`.** El contrato de F04 no cambia: el `hasMany` se declara para el volcado de la purga, no para el payload.
- **Carga masiva o importación** de antecedentes desde fichero.
- **Bloquear `ESAVI-NOTIFCN-005C`** cuando haya antecedentes registrados. Se deja disparar la cascada de Postgres, con el volcado al log como única mitigación. Es la línea de F16, F21 y F22.
- **Reordenar antecedentes** — un `007` que mueva uno de posición y desplace a sus hermanos. Es lo que el `sortOrder` inmutable deja pendiente, y necesita transacción sobre N filas más una decisión sobre si el orden es denso o disperso. El mismo pendiente que F16, F27, F31 y F33.
- **Aceptar `diagnosticTermId` directo del cliente.** Sería una segunda puerta para apuntar a un término, y con ella la pregunta de qué gana cuando llegan los dos. F16 §6 ya lo descartó.
- **Cualquier filtro de listado** por `diagnosticTermId` o por texto.
- **Deduplicar antecedentes de texto libre.** La guarda compara `diagnosticTermId` y nada más. Lo que no cubre queda en §7.
- **Modificar `esaviapp.sql`** más allá de lo enumerado arriba: ninguna otra tabla se toca, y `notification` no gana ni pierde una columna.
- **Modificar `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` ni `diagnosticTermResolution.service.ts`.**
- **Extraer `normalizeText` a un helper compartido**, aunque ésta sea la enésima copia. La deuda que F24 §7 declaró vencida sigue vencida.
- Cifrado de ningún campo. `historyRaw` es un término clínico, no un identificador de persona.
- Crear antecedentes automáticamente al dar de alta una notificación.
- Exponer o editar `sysDetails`.

---

## 3. Modelo de datos

### 3.1 Tabla origen — **nueva**

`notificationMedicalHistory` no existe todavía. Se declara entera, inmediatamente después de `IX_notificationPregnancyComplication_pregnancy` (`esaviapp.sql:1003`) y antes del bloque `-- Investigation split model` (`:1005`), para que cierre el bloque de notificación en vez de abrir el de investigación.

```sql
CREATE TABLE IF NOT EXISTS "notificationMedicalHistory" (
  "medicalHistoryId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL,
  "diagnosticTermId" uuid,
  "historyRaw" varchar(500),
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationMedicalHistory_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notificationMedicalHistory_term" FOREIGN KEY ("diagnosticTermId") REFERENCES "diagnosticTerm" ("diagnosticTermId") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "IX_notificationMedicalHistory_notification" ON "notificationMedicalHistory" ("notificationId");
```

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `medicalHistoryId` | `uuid` | no | PK propia, `DEFAULT gen_random_uuid()`. Espejo de `pregnancyConditionId` (`:1147`) |
| `notificationId` | `uuid` | no | FK → `notification("notificationId")`, `ON DELETE CASCADE`. **Sin `UNIQUE`** → uno a muchos |
| `diagnosticTermId` | `uuid` | sí | FK → `diagnosticTerm`, `ON DELETE RESTRICT`. **Derivada**: la devuelve la resolución, no el cliente |
| `historyRaw` | `varchar(500)` | sí | Texto del notificador. **Derivada**: se guarda solo si difiere del nombre del maestro |
| `sortOrder` | `smallint` | no | `DEFAULT 0`, `CHECK ("sortOrder" >= 0)`. Lo asigna el trigger; la aplicación no lo envía |
| `notes` | `text` | sí | Solo `trim()` |
| + `isActive`, `createdAt`, `updatedAt`, `deletedAt`, `sysDetails`, `appDetails` | | | Las seis transversales, en la forma exacta de `investigationPregnancyCondition` (`:1152-1157`) |

**Tres decisiones del DDL que no son copia mecánica.**

1. **`historyRaw` y no `medicalHistoryRawName`.** El gemelo directo es F33, que llama `conditionRaw` a la suya (`:1150`); `notificationPregnancyComplication` usa `complicationRawName` (`:989`) y es la forma que no se sigue. La longitud `varchar(500)` sale de las dos.
2. **Sin `metadata jsonb`.** `notificationPregnancyComplication` la lleva (`:991`) y `investigationPregnancyCondition` no (`:1146-1161`). Se sigue a F33: no hay nada que guardar ahí que `sysDetails` y `appDetails` no cubran, y una columna abierta sin contrato declarado es una invitación a escribir lo que sea.
3. **Sin `medicalHistoryTypeItemId`.** F27 tiene `complicationTypeItemId` hacia `catalogItem` (`:988`); aquí no hay catálogo de tipo, igual que en F33. La consecuencia práctica es que **la guarda de duplicado se reduce al término solo** y que la tabla **no tiene ninguna FK a `catalogItem`**, así que no hay ningún `catalogType` que sembrar antes de usarla.

**Restricciones.** Dos claves foráneas y un `CHECK`. **Ninguna `UNIQUE` declarada en la tabla.** La única unicidad de base vive fuera, en el índice parcial de más abajo. **La guarda de duplicado sobre `diagnosticTermId` no está respaldada por nada**: es regla de negocio del servicio.

**El `ON DELETE RESTRICT` hacia `diagnosticTerm` es inerte en la práctica.** El maestro figura en el bucle `preventPhysicalDelete` (`:1490-1499`) y no tiene `005C`, así que nunca llega a intentarse el borrado que la restricción bloquearía.

**Las tres líneas que se añaden fuera del `CREATE TABLE`:**

- **Fila en el bucle `setSortOrderByParent`** (`:1428-1451`), como `('notificationMedicalHistory', 'notificationId'),` a continuación de `('notificationPregnancyComplication', 'pregnancyId'),` (`:1439`). Sin ella no hay `TRG_notificationMedicalHistory_setSortOrder`, y todas las filas nacerían con `sortOrder: 0`.
- **Índice único parcial**, junto a los ocho que ya hay (`:1456-1487`):
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notificationMedicalHistory_parent_sortOrder"
    ON "notificationMedicalHistory" ("notificationId", "sortOrder")
    WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
  ```
  Que la condición sea `deletedAt` y no `isActive` es el origen del hallazgo `C` de §1.
- **El índice `IX_notificationMedicalHistory_notification`**, en la línea siguiente al `CREATE TABLE`, con la forma de `IX_notificationPregnancyComplication_pregnancy` (`:1003`). El parcial no cubre el `002B`, que lee también filas con `deletedAt` sellado.

**Triggers. Dos, y solo uno se declara.** `TRG_notificationMedicalHistory_setSysDetails` aparece solo: el bucle de `:1404-1419` **descubre** las tablas consultando `information_schema.columns` por la columna `sysDetails`, así que declararla basta. `TRG_notificationMedicalHistory_setSortOrder` sí exige la fila del bucle literal, y ejecuta `setSortOrderByParent('notificationId')` **solo `BEFORE INSERT`**: respeta un `sortOrder` recibido si es mayor que 0 y, si no, asigna `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas con `deletedAt IS NULL` del mismo padre, bajo `pg_advisory_xact_lock`. **No hay** `setUpdatedAt` —el bucle genérico lo borra explícitamente (`:1416`)—: `updatedAt` lo escribe la aplicación.

**Sin `preventPhysicalDelete`.** La tabla **no** se añade a la lista de `:1490-1499`, así que un `DELETE` físico ejecuta y le corresponde `005C`. Es deliberado y sigue a las ocho hijas transaccionales.

**Hoja del grafo.** Ninguna de las 46 tablas la referenciará. Su `005C` no arrastra nada y no lleva volcado de cascada.

### 3.2 Modelo Sequelize

Archivo: `src/models/notificationMedicalHistory.model.ts`. Clase `NotificationMedicalHistory`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'notificationMedicalHistory'`.

`medicalHistoryId` es la PK con `defaultValue: sequelize.literal('gen_random_uuid()')`. `notificationId` va `DataTypes.UUID` con `allowNull: false`. `diagnosticTermId` va `DataTypes.UUID` con `allowNull: true`. `historyRaw` va `DataTypes.STRING(500)`, con la longitud explícita para que un texto largo falle en Sequelize y no en Postgres. `notes` va `DataTypes.TEXT`.

**`sortOrder` se declara `allowNull: false` y sin `defaultValue`**, por la razón que F16 §3.2 documentó: un `defaultValue: 0` haría que el `INSERT` mandara el `0` que el trigger interpreta como «asígnamelo tú», y funcionaría por accidente.

> **Nota de implementación, heredada de F16.** Omitir el valor **no basta**: Sequelize corre su validación `notNull` antes de emitir el `INSERT`, así que el alta muere con `notNull Violation: NotificationMedicalHistory.sortOrder cannot be null` y el trigger nunca se ejecuta. Lo que deja la columna fuera de la sentencia es la lista explícita: `NotificationMedicalHistory.create({ ... }, { transaction, fields: CREATE_FIELDS })`, con `CREATE_FIELDS` declarada en el servicio y **sin** `sortOrder` ni `medicalHistoryId`.

Asociaciones, en `src/models/associations/notificationMedicalHistory.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `NotificationMedicalHistory.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' })`
- `Notification.hasMany(NotificationMedicalHistory, { as: 'medicalHistories', foreignKey: 'notificationId' })`
- `NotificationMedicalHistory.belongsTo(DiagnosticTerm, { as: 'diagnosticTerm', foreignKey: 'diagnosticTermId' })`

El alias `medicalHistories` no colisiona con ninguno de los que `notification.associations.ts` ya declara para sus seis satélites. El `hasMany` se declara porque lo necesita el volcado de §3.5. **No se incluye en ninguna respuesta de `notification`**: el contrato de F04 no cambia. `DiagnosticTerm` no gana ningún inverso, igual que en F27 y F33.

Alta en `src/models/index.ts` y en el barrel de asociaciones.

**Los dos `include` que el servicio compone:**

- **Visibilidad heredada**, en `002A`, `002B`, `003`, `004` y las filas del `006` — un solo salto: `{ model: Notification, as: 'notification', required: true, attributes: ['notificationId', 'isActive'], where: includeInactive ? {} : { isActive: true } }`. **Es la forma corriente de F21 y F22**, no la cadena de dos saltos con `paranoid: false` que F33 necesitó: aquí el padre tiene `isActive` propio y el estado se lee de un tirón.
- **Respuesta**, en `001`, `003`, `004` y las filas de los listados: `diagnosticTerm` con seis atributos.

### 3.3 Tipos

Ruta: `src/types/notificationMedicalHistory/notificationMedicalHistory.types.ts`, directorio nuevo con su `index.ts` de barrel, registrado en `src/types/index.ts`. Es la forma de `notificationVaccine` y `notificationPregnancyComplication`, que tienen carpeta propia; no la de `investigation`, que agrupa seis archivos en una.

```ts
export interface CreateNotificationMedicalHistoryInput {
    notificationId: string;
    historyName: string;
    historyCode?: string | null;
    source?: TermSource | null;
    notes?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateNotificationMedicalHistoryInput>`. **No se declara `UpdateNotificationMedicalHistoryInput`** — prohibido por §4 de las convenciones.

**Tres claves de entrada no son columnas**, y es la consecuencia directa de resolver contra el maestro:

- **`historyName`** es el texto del notificador. No hay columna con ese nombre: alimenta `historyRaw`, que solo lo guarda si difiere del maestro.
- **`historyCode`** y **`source`** alimentan la resolución y no se guardan en ninguna parte de esta tabla. El código vive en `diagnosticTerm`, que es donde F15 lo puso.

**Tres columnas no están en la interfaz.** `diagnosticTermId` e `historyRaw` son derivadas —aceptarlas abriría la segunda puerta que F16 §6 cerró—; `sortOrder` es inmutable y lo asigna la base, y que no exista en el tipo es la forma más barata de garantizar que ningún servicio lo mande.

`TermSource` se importa de `src/constants/enums.constants.ts`, donde F15 lo dejó. **No se declara ningún enumerado nuevo.**

### 3.4 Superficie HTTP

Ruta base `/api/notification-medical-histories`, registrada en `src/routes/index.ts`.

```
POST   /api/notification-medical-histories                          ESAVI-MEDHIST-001   USER        (nuevo)
GET    /api/notification-medical-histories/case/:caseId             ESAVI-MEDHIST-006   USER        (nuevo)
GET    /api/notification-medical-histories/admin/notification/:id   ESAVI-MEDHIST-002B  ADMIN       (nuevo)
GET    /api/notification-medical-histories/notification/:id         ESAVI-MEDHIST-002A  USER        (nuevo)
DELETE /api/notification-medical-histories/purge/:id                ESAVI-MEDHIST-005C  SUPERADMIN  (nuevo)
PATCH  /api/notification-medical-histories/activate/:id             ESAVI-MEDHIST-005B  SUPERADMIN  (nuevo)
GET    /api/notification-medical-histories/:id                      ESAVI-MEDHIST-003   USER        (nuevo)
PUT    /api/notification-medical-histories/:id                      ESAVI-MEDHIST-004   USER        (nuevo)
DELETE /api/notification-medical-histories/:id                      ESAVI-MEDHIST-005A  ADMIN       (nuevo)
```

**Nueve rutas, y `:id` es el `medicalHistoryId`** salvo en los dos listados, donde es el `notificationId`, y en el `006`, donde es el `caseId`. El `003` **no** es el acceso por notificación: para eso está el `002A`.

**Orden de declaración.** Las literales van **antes** de `/:id`, y `/admin/notification/:id` antes que `/notification/:id`, o Express capturaría `case`, `admin`, `notification`, `purge` y `activate` como un `:id` y el validador de UUID respondería 400. Las nueve están escritas arriba en el orden exacto en que deben aparecer en `src/routes/notificationMedicalHistory.routes.ts`.

**El `002A` y el `002B` son dos rutas distintas**, no un `GET /` bifurcado por rol, así que cada una lleva su letra en los cinco lugares. Es la forma de `NOTIFEVT`, `NOTIFMED` y `NOTIFVAC`, no la de `GEOTYPE`.

**Roles — la matriz de la familia de notificación, con una desviación declarada.** `001`, `002A`, `003` y `006` en **USER**; `002B` y `005A` en **ADMIN**; `005B` y `005C` en **SUPERADMIN**.

**La desviación es el `004` en USER**, donde F21 y F22 ponen ADMIN. La razón: quien registra el antecedente es quien lo corrige, y obligar a un ADMIN a arreglar una errata de captura parte el flujo operativo por la mitad. Es además la posición de F33, el gemelo estructural, y la de las doce specs que ya apartaron su `004` de la matriz canónica de §9. **El `005B` se queda en SUPERADMIN**, con F21 y F22 y no con F33: la reactivación arrastra la reasignación de `sortOrder` de §3.5 y en el bloque de notificación esa operación nunca bajó de SUPERADMIN.

**`ESAVI-MEDHIST-006` sí tiene ruta**, como el `006` de `NOTIFEVT`, `NOTIFMED` y `NOTIFVAC`. Se registra en la tabla de operaciones no canónicas de §6 como: *«listar los antecedentes médicos de un caso — la cadena `caso → notificación` es uno a uno, pero de la notificación cuelgan N antecedentes»*.

**La abreviatura es `MEDHIST`.** Siete letras, no colisiona con las cuarenta y ocho registradas, y `grep "ESAVI-MEDHIST-"` no se cruza con `ESAVI-INVMEDH-`, `ESAVI-NOTIFCN-`, `ESAVI-NOTIFMED-`, `ESAVI-NOTIFEVT-`, `ESAVI-NOTIFVAC-`, `ESAVI-NOTIFPRG-` ni `ESAVI-PREGCOMP-`. Suelta el prefijo `NOTIF` con el precedente de `PREGCOMP`, y precisamente para no quedar a una letra de `NOTIFMED`.

Nueve filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`: de **337** a **346**.

### 3.5 Reglas de negocio por operación

#### La guarda del padre — compartida por `001`, `002A` y `002B`

`Notification.findOne({ where: { notificationId }, attributes: ['notificationId', 'isActive'] })`. Falla con **404** y un único código por operación si no hay fila o si la fila tiene `isActive: false`. **Sin comprobar `notificationType`**: los antecedentes se registran igual en una notificación grave que en una no grave, y es la decisión literal de F21 §3.5.

**En los dos listados la comprobación de estado la relaja `canViewInactive`**; la de existencia **no se relaja para nadie**: una notificación inexistente no tiene antecedentes que listar bajo ningún rol.

**En el `001` no hay relajación de ninguna de las dos.** Una notificación inactiva no recibe antecedentes nuevos, sea quien sea quien lo pida. Es el criterio de F31 y F33 para su `001`.

#### Visibilidad heredada — compartida por `003`, `004` y las filas de los tres listados

Toda lectura de un antecedente incluye `notification` con el `include` de §3.2. Responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive` (`src/helpers/permissions.helper.ts:24-26`), si:

- su notificación tiene `isActive: false`, **o**
- el propio antecedente tiene `isActive: false`.

Las dos condiciones se evalúan igual y ninguna tiene prioridad: basta que una falle.

**El `005A`, el `005B` y el `005C` no la aplican.** Quien retira, reactiva o purga actúa sobre el estado propio de la fila, y ese estado existe con independencia de su padre. Es el criterio de F21, F31 y F33.

#### Guarda de duplicado — `001` y `004`

`findOne` sobre el mismo `notificationId`, el mismo `diagnosticTermId` e `isActive: true`, excluyendo en el `004` la propia fila con `medicalHistoryId: { [Op.ne]: id }`. Si hay fila → **409** `MEDHIST_<op>_ALREADY_EXISTS`.

**Solo corre si el término resolvió.** Con `diagnosticTermId: null` no se comprueba nada: dos antecedentes de texto libre son registros distintos aunque el texto coincida, y una guarda inventada no debe ser más rígida que las que la base sí impone —que aquí son ninguna.

**Va después de la resolución**, porque el término que se compara es el resuelto, no el código enviado.

**Se compara contra activos, no contra todos.** Un antecedente retirado no bloquea volver a cargar el mismo término: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`. La consecuencia —que un `005B` pueda dejar dos filas activas con el mismo término— está declarada en §6.

#### Por operación

**`ESAVI-MEDHIST-001` — crear.** Todo dentro de **una transacción**, porque la resolución del término puede escribir en `diagnosticTerm`. En este orden:

1. **La guarda del padre** → 404 `MEDHIST_001_NOTIFICATION_NOT_FOUND`.
2. **Resolución del término**, en tres ramas:
   - Sin `historyCode` → `diagnosticTermId: null` e `historyRaw: normalizeText(data.historyName)`.
   - Con `historyCode` y `source` ausente o `'LOCAL'` → `resolveDiagnosticTermService({ code, name: data.historyName, operationCode: 'ESAVI-MEDHIST-001' }, authUser, lang, transaction)`, que **devuelve el término o lo crea**.
   - Con `historyCode` y `source` distinto de `'LOCAL'` → `DiagnosticTerm.findOne({ where: { source, code: toConstantCase(code.trim()) } })`, **sin crear nada**; si no existe → 404 `MEDHIST_001_DIAGTERM_NOT_FOUND`. La consulta no filtra por `isActive`: un término retirado sigue siendo referenciable, por la misma razón que `diagnosticTermResolution.service.ts:37-38` no lo filtra.
3. Con término resuelto: `diagnosticTermId` = el suyo, e `historyRaw` = el texto del notificador **solo si difiere** del nombre del maestro; si coincide, `null`.
4. **Guarda de duplicado**, solo si `diagnosticTermId` quedó con valor → 409 `MEDHIST_001_ALREADY_EXISTS`.
5. Normalización: `normalizeText` sobre `historyName` y `notes`. **Ningún `toTitleCase` ni `toConstantCase`** — el del código lo aplica `resolveDiagnosticTermService`.
6. `create` con `fields: CREATE_FIELDS`, **sin `sortOrder`**, para que lo asigne el trigger.
7. Entrada de auditoría en `appDetails` con `method: 'ESAVI-MEDHIST-001'`.

**`notification.hasRelevantMedicalHistory` no se lee ni se escribe en ningún paso.** Es el desacoplamiento de §1.E.

**`ESAVI-MEDHIST-002A` — listar activos por notificación.** Guarda del padre, relajada por `canViewInactive` en el estado → 404 `MEDHIST_002A_NOTIFICATION_NOT_FOUND`. `findAndCountAll` con `where: { notificationId, isActive: true }`, `order: [['sortOrder', 'ASC']]`, `include` de `diagnosticTerm`, paginación con `DEFAULT_LIMIT` / `DEFAULT_OFFSET`. Sin filtros por query. **Una notificación sin antecedentes devuelve 200 con `{ count: 0, rows: [] }`; una notificación que no existe devuelve 404.**

**`ESAVI-MEDHIST-002B` — listar todos por notificación.** Idéntico, sin el filtro `isActive` y con `paranoid: false`. Rol ADMIN.

**`ESAVI-MEDHIST-003` — obtener por ID.** Existencia → 404 `MEDHIST_003_NOT_FOUND`, con la visibilidad heredada aplicada.

**`ESAVI-MEDHIST-006` — listar los antecedentes de un caso.** El caso existe y está activo → 404 `MEDHIST_006_CASE_NOT_FOUND`. Su notificación existe y está activa → 404 `MEDHIST_006_NOTIFICATION_NOT_FOUND`. A partir de ahí es el `002A`: solo activos, ordenados por `sortOrder`, paginados. La variante admin no se declara. Es la forma literal de F21 §3.5.

**`ESAVI-MEDHIST-004` — actualizar.** Existencia → 404 `MEDHIST_004_NOT_FOUND`, incluida la visibilidad heredada. Todo en **una transacción**, porque la re-resolución puede escribir en `diagnosticTerm`. `stored` sale de `medicalHistory.get({ plain: true })` — la fila completa, sin `attributes` acotados.

La **re-resolución está condicionada al cambio de valor**, no a la presencia de la clave (SPEC F12). Se calcula `incomingName = data.historyName !== undefined ? normalizeText(data.historyName) : (stored.historyRaw ?? stored.diagnosticTerm?.name)` y se re-resuelve **solo si** llega `historyCode` o `source` con un valor distinto del que produjo el término guardado, o si `historyName` cambió sobre una fila con término resuelto. Si nada de eso cambia, **no se consulta ni se escribe en `diagnosticTerm`**: reenviar íntegra la respuesta del `GET` no toca el maestro.

Guarda de duplicado sobre el término resultante, excluyendo la propia fila. Después, `buildDifferentialUpdate`; si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`.

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `notificationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `sortOrder` | **no entra** | inmutable, lo gobierna la base |
| `medicalHistoryId` | **no entra** | PK |
| `diagnosticTermId` | `resolved.diagnosticTermId` — **entra siempre** | **derivado**: lo produce la resolución, no el cliente. Cuando no hubo re-resolución vale lo mismo que `stored` y el helper lo descarta solo |
| `historyRaw` | `resolved.historyRaw` — **entra siempre** | **derivado**: el texto entrante solo si difiere del nombre del maestro, si no `null`. Anulable, y el `null` es un valor legítimo, no una ausencia |
| `notes` | `data.notes !== undefined ? (data.notes?.trim() ?? null) : undefined` | anulable: se compara contra `undefined`, **nunca por veracidad** |
| `isActive` | **no entra** | el estado se mueve por `005A` / `005B` |

**`historyName`, `historyCode` y `source` no aparecen en la tabla porque no son columnas.** Los tres alimentan la resolución y desembocan en los dos derivados. Es la razón de que los derivados entren **siempre**: su valor no sale de comparar una clave del body contra lo guardado, sino de recalcular con lo que hubiera. El helper hace el resto — si el resultado coincide con `stored`, no hay escritura.

**`historyName` no es anulable en el `004`.** Un `null` explícito lo rechaza el validador con 400: un antecedente sin nombre no informa de nada.

**`ESAVI-MEDHIST-005A` — desactivar.** Delega en `setEntityActiveStatusService` con `notFoundCode: 'MEDHIST_005A_NOT_FOUND'`, `alreadyInStateCode: 'MEDHIST_005A_ALREADY_INACTIVE'` y `method: 'ESAVI-MEDHIST-005A'`. Sella `deletedAt`, lo que **libera el `sortOrder`** del índice parcial. Es correcto y deliberado. **No comprueba el estado de la notificación**, ni toca su bandera.

**`ESAVI-MEDHIST-005B` — reactivar.** **La única operación de este spec que no es una delegación limpia**, por el hallazgo `C` de §1. En transacción propia:

1. `NotificationMedicalHistory.findOne({ where: { medicalHistoryId: id }, paranoid: false, transaction })`. Si no hay fila, se pasa directo al paso 4 y el helper levanta el 404.
2. Si la fila existe y está inactiva, se busca colisión: otra fila de la **misma** notificación, con el **mismo** `sortOrder`, con `deletedAt: null` y `medicalHistoryId: { [Op.ne]: id }`.
3. Si la hay, `update` de `sortOrder` a `COALESCE(MAX("sortOrder"), 0) + 1` sobre las filas vivas de esa notificación —la misma cuenta que hace el trigger—, **antes** de tocar `deletedAt`. Mientras `deletedAt` siga sellado la fila está fuera del índice parcial, así que esta escritura es libre. El antecedente reaparece al final de la lista.
4. `setEntityActiveStatusService` con `alreadyInStateCode: 'MEDHIST_005B_ALREADY_ACTIVE'` y `method: 'ESAVI-MEDHIST-005B'`, que limpia `deletedAt` con el `sortOrder` ya corregido.

El orden de los pasos 3 y 4 es la clave entera: invertirlos hace fallar el índice en el propio `UPDATE` del helper, porque no es una restricción diferible. **La reactivación no revalida la guarda de duplicado ni el estado del padre**: el dato es histórico y `005B` no escribe esas columnas.

**`ESAVI-MEDHIST-005C` — borrado físico.** `purgeEntityService` sin modificación, con `notFoundCode: 'MEDHIST_005C_NOT_FOUND'` y `stillActiveCode: 'MEDHIST_005C_STILL_ACTIVE'`. La guarda es la canónica: la fila debe estar en `isActive: false` → si no, **409**. **No se comprueba el estado de la notificación.** El `diagnosticTerm` que citaba sobrevive. Sin entrada en `appDetails` —la fila se destruye en la misma transacción— y con el volcado a `warn` que el helper ya escribe.

#### El volcado en un servicio ajeno

`notification.service.ts` gana `dumpNotificationMedicalHistoriesBeforeCascade(notificationId, userId, transaction)`, la **séptima** función de volcado de `ESAVI-NOTIFCN-005C`, calcada de `dumpNotificationVaccinesBeforeCascade` (`notification.service.ts:773-796`): `findAll` con `attributes: ['medicalHistoryId']` y `paranoid: false`, retorno silencioso si no hay filas, una línea `warn` con el conteo y los ids, y `try/catch` que nunca aborta la purga. Se invoca junto a las otras seis, antes de `purgeEntityService`.

**Es un rastro, no una protección: la purga no se bloquea y la cascada dispara igual.** Es la línea de F16, F21 y F22.

#### Escrituras que no son diferenciales, declaradas una a una

- **El `001`** — es un `create`.
- **La creación de un término en `diagnosticTerm` por la rama `LOCAL`**, en `001` y `004`. Escritura sobre otra tabla, con intención propia: registra que este código no existía en el maestro. En el `004` **solo ocurre si el código cambió realmente**, nunca por presencia de la clave.
- **El `005A` y el `005B`** — escrituras de estado con intención propia, delegadas en `setEntityActiveStatusService`.
- **La reasignación de `sortOrder` del `005B`** — escritura con intención propia sobre un campo que el cliente no envió ni puede enviar. Registra un hecho: este antecedente vuelve a estar vivo y ocupa un sitio nuevo. No pasa por el helper porque no nace de comparar un valor entrante contra el guardado, sino de una restricción de la base.
- **El `005C`** — destruye la fila.

**Este spec no escribe en ninguna otra tabla.** Lo único que toca fuera de `notificationMedicalHistory` y de `diagnosticTerm` es una línea de log en la cascada de purga de la cabecera. **`notification` no se escribe nunca**, ni por cambio de valor ni por presencia de clave.

### 3.6 Claves i18n nuevas

Bajo `notificationMedicalHistory`, en `src/data/i18n/es.json`, `en.json` y `nl.json`:

| Clave | Uso |
|---|---|
| `notificationMedicalHistory.notFound` | 404 al consultar, actualizar, desactivar, activar o purgar un id inexistente o no visible |
| `notificationMedicalHistory.idRequired` | 400 del validador de `:id` |
| `notificationMedicalHistory.notificationNotFound` | 404 cuando la notificación no existe o está inactiva |
| `notificationMedicalHistory.caseNotFound` | 404 del `006` cuando el caso no existe o está inactivo |
| `notificationMedicalHistory.diagnosticTermNotFound` | 404 con `source` externo y par `(source, code)` inexistente |
| `notificationMedicalHistory.alreadyExists` | 409 cuando la notificación ya tiene un antecedente **activo** con el mismo término |
| `notificationMedicalHistory.nameRequired` | 400 del validador cuando `historyName` no llega en el `001`, o llega como `null` en el `004` |
| `notificationMedicalHistory.stillActive` | 409 al purgar un antecedente que no fue retirado antes |
| `.createdSuccess` / `.createdFailed` | 201 y 500 del `001` |
| `.getSuccess` / `.getFailed` | 200 y 500 de `002A`, `002B`, `003` y `006` |
| `.updatedSuccess` / `.updatedFailed` | 200 y 500 del `004` |
| `.deletedSuccess` / `.deletedFailed` | 200 y 500 del `005A` |
| `.activatedSuccess` / `.activatedFailed` | 200 y 500 del `005B` |
| `.alreadyActive` / `.alreadyInactive` | 409 de `005B` y `005A` |
| `.purgeSuccess` / `.purgeFailed` | 200 y 500 del `005C` |

**Las validaciones de forma no generan clave propia.** El máximo de 500 caracteres de `historyName`, el formato UUID de `notificationId` y el enumerado de `source` los responde `validateFields` con `common.validationError`.

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

En `001`, `003` y `004`:

```
{ ok, message, data: {
    medicalHistoryId, notificationId, diagnosticTermId,
    historyRaw, sortOrder, notes,
    isActive, createdAt, updatedAt, deletedAt, appDetails,
    diagnosticTerm: { diagnosticTermId, source, code, name, termGroup, isActive } | null
} }
```

`diagnosticTerm` se incluye siempre que exista la FK, con esos seis campos y **sin `metadata`**: lleva los marcadores internos de la resolución implícita —`autoCreated`, `reviewStatus`—, que son gobernanza del catálogo y no dato de la notificación. Es la decisión de F16, F27 y F33, literal.

**El nombre que el cliente muestra es `historyRaw ?? diagnosticTerm.name`.** No hay un tercer campo que lo resuelva. Cuando `historyRaw` es `null`, el notificador escribió exactamente lo que dice el maestro.

En `002A`, `002B` y `006`, `data` es el `{ count, rows }` de `findAndCountAll`, con cada fila en la forma de arriba y ordenadas por `sortOrder` ascendente.

**Nada de la notificación ni del caso viaja en la respuesta.** `notification` se consulta solo para la visibilidad heredada, con `attributes` acotados, y se descarta al construir el payload. **`hasRelevantMedicalHistory` no se devuelve aquí**: quien la necesite entra por `ESAVI-NOTIFCN-006`.

`sysDetails` no se expone en ninguna operación.

---

## 4. Plan de implementación

1. **Registrar la abreviatura y la operación no canónica.** Añadir la fila `notificationMedicalHistory | MEDHIST` a la tabla de abreviaturas de `references/CONVENTIONS.md` §6, en el orden alfabético que la tabla mantiene —entre `notificationMedication` y `notificationPregnancy`—, y la fila del `006` a la tabla de operaciones no canónicas, a continuación de la de `notificationVaccine`. La norma exige registrar antes de usar, así que va primero aunque no toque `src/`.
   *Verificación:* la tabla contiene la fila nueva; `MEDHIST` no aparece dos veces y no colisiona con `INVMEDH`, `NOTIFCN`, `NOTIFMED`, `NOTIFEVT`, `NOTIFVAC`, `NOTIFPRG` ni `PREGCOMP`; `git diff references/CONVENTIONS.md` muestra **exactamente dos** filas añadidas y ningún otro cambio.

2. **La tabla en `esaviapp.sql`.** El `CREATE TABLE` de §3.1 con su `IX_notificationMedicalHistory_notification`, insertado tras `:1003` y antes del comentario `-- Investigation split model` de `:1005`; la fila `('notificationMedicalHistory', 'notificationId'),` en el bucle `setSortOrderByParent` tras `:1439`; y el índice único parcial `UQ_notificationMedicalHistory_parent_sortOrder` junto a los ocho de `:1456-1487`. **La lista de `preventPhysicalDelete` no se toca.**
   *Verificación:* ejecutar el DDL completo sobre una base limpia no produce errores; `\d "notificationMedicalHistory"` muestra las doce columnas, las dos FKs y el `CHECK`; `SELECT tgname FROM pg_trigger WHERE tgrelid = '"notificationMedicalHistory"'::regclass` devuelve **exactamente dos** triggers —`setSysDetails` y `setSortOrder`— y **ninguno** de `setUpdatedAt` ni `preventPhysicalDelete`; `git diff esaviapp.sql` toca solo las tres zonas descritas y ninguna otra tabla; un `DELETE` físico directo sobre una fila ejecuta sin error.

3. **La cuenta de tablas en `CLAUDE.md`.** De 45 a 46 en la sección *Database schema*, y la cuenta de modelos existentes si la línea la cita.
   *Verificación:* `grep -c "45 tables" CLAUDE.md` devuelve 0; la cifra nueva coincide con `grep -c "^CREATE TABLE IF NOT EXISTS" esaviapp.sql`.

4. **Modelo y asociaciones.** `src/models/notificationMedicalHistory.model.ts` con los seis atributos de datos y las seis transversales, `sortOrder` **sin `defaultValue`**, `historyRaw` en `STRING(500)`. `src/models/associations/notificationMedicalHistory.associations.ts` con los tres vínculos de §3.2. Alta en `src/models/index.ts`, en el barrel de asociaciones y en `initModels()`.
   *Verificación:* `npm run build` compila; `NotificationMedicalHistory.findAll({ include: ['notification', 'diagnosticTerm'] })` no lanza `EagerLoadingError`; el alias `medicalHistories` del `hasMany` no colisiona con ninguno de los seis que `notification.associations.ts` ya declara; el modelo **no** declara `defaultValue` en `sortOrder`.

5. **Tipos y validadores.** `src/types/notificationMedicalHistory/notificationMedicalHistory.types.ts` con la única interfaz de §3.3, más su `index.ts` de barrel, registrado en `src/types/index.ts`. `src/validators/notificationMedicalHistory.validators.ts` con los seis validadores —create, list por notificación, list por caso, id, update, activate—, registrado en el barrel.
   *Verificación:* `npm run build` compila; **no existe** ningún `UpdateNotificationMedicalHistoryInput`; un `POST` sin `historyName` responde 400 `common.validationError`; un `PUT` con `historyName: null` responde 400; un `historyName` de 501 caracteres responde 400; un `source` fuera del enumerado responde 400; un `:id` que no es UUID responde 400.

6. **Claves i18n.** Las de §3.6 en `es.json`, `en.json` y `nl.json`.
   *Verificación:* `npm run i18n:check` pasa; `npx jest tests/i18n` pasa; ninguna clave existe en dos de los tres archivos.

7. **`ESAVI-MEDHIST-001`.** Servicio, controlador y ruta. Transacción, guarda del padre, las tres ramas de resolución, los dos derivados, la guarda de duplicado, `fields: CREATE_FIELDS` y la entrada de auditoría.
   *Verificación:* un alta con solo `notificationId` e `historyName` devuelve **201** con `diagnosticTermId: null`, `historyRaw` con el texto y `sortOrder: 1` sobre una notificación vacía; la segunda alta recibe `sortOrder: 2`; con `historyCode` nuevo y sin `source` se crea la fila en `diagnosticTerm` y `historyRaw` queda `null` si el nombre coincide con el del maestro; con `source: 'MEDDRA'` y un código inexistente responde 404 `MEDHIST_001_DIAGTERM_NOT_FOUND` **y no se crea ningún término**; sobre una notificación inexistente o inactiva responde 404 `MEDHIST_001_NOTIFICATION_NOT_FOUND`, **también como SUPERADMIN**; repetir el mismo término activo responde 409 `MEDHIST_001_ALREADY_EXISTS`; repetir el mismo texto **sin** código responde 201; sobre una notificación con `hasRelevantMedicalHistory` en `'NO'` o `null` responde **201**, y la columna **no cambia de valor**; `appDetails` tiene una entrada con `method: 'ESAVI-MEDHIST-001'`; el `INSERT` emitido **no contiene la columna `sortOrder`**.

8. **`ESAVI-MEDHIST-002A` y `002B`.** Los dos listados por `notificationId`, con la guarda del padre, `findAndCountAll`, orden por `sortOrder` y paginación.
   *Verificación:* el `002A` devuelve solo activos y el `002B` también los inactivos y los de `deletedAt` sellado; los dos devuelven `{ count, rows }` ordenados por `sortOrder` ascendente; una notificación sin antecedentes devuelve **200** con `{ count: 0, rows: [] }`; una notificación inexistente devuelve **404**, también como SUPERADMIN; una notificación inactiva devuelve 404 para USER y ADMIN y **200** para SUPERADMIN; el `002B` con rol USER responde 403; `?limit=1&offset=1` devuelve la segunda fila con el `count` total; ningún parámetro de query distinto de `limit`, `offset` y `lang` altera el resultado.

9. **`ESAVI-MEDHIST-003`.** Obtener por `medicalHistoryId` con la visibilidad heredada de un salto.
   *Verificación:* devuelve la forma de §3.7 con `diagnosticTerm` anidado o `null`; un antecedente inactivo responde 404 para USER y 200 para SUPERADMIN; un antecedente activo cuya notificación está inactiva responde 404 para USER y ADMIN y 200 para SUPERADMIN; `sysDetails` no aparece en el payload; `hasRelevantMedicalHistory` no aparece en el payload.

10. **`ESAVI-MEDHIST-006`.** Listado por `caseId`, con las dos guardas delante y el cuerpo del `002A`.
    *Verificación:* devuelve `{ count, rows }` con los antecedentes activos del caso ordenados por `sortOrder`; un `caseId` inexistente o inactivo responde 404 `MEDHIST_006_CASE_NOT_FOUND`; un caso activo **sin notificación** responde 404 `MEDHIST_006_NOTIFICATION_NOT_FOUND`; un caso con notificación y sin antecedentes responde 200 con `{ count: 0, rows: [] }`; **no** devuelve antecedentes inactivos ni siquiera como SUPERADMIN —para eso está el `002B`—; el rol mínimo es USER.

11. **`ESAVI-MEDHIST-004`.** Transacción, `stored` completo, la fórmula de `incomingName`, la re-resolución condicionada, la guarda de duplicado y `buildDifferentialUpdate` con la tabla de `candidates`.
    *Verificación:* la del bloque de update diferencial de §5, entera.

12. **`ESAVI-MEDHIST-005A`.** Delegación en `setEntityActiveStatusService`.
    *Verificación:* sella `isActive: false` y `deletedAt`; repetir responde 409 `MEDHIST_005A_ALREADY_INACTIVE`; **no comprueba el estado de la notificación** —retirar un antecedente de una notificación inactiva devuelve 200—; **`hasRelevantMedicalHistory` no cambia** aunque el retirado fuera el último; tras el `005A`, un alta nueva sobre la misma notificación puede recibir el `sortOrder` liberado; `appDetails` crece con `method: 'ESAVI-MEDHIST-005A'`.

13. **`ESAVI-MEDHIST-005B`.** Transacción, detección de colisión de `sortOrder`, reasignación previa y delegación.
    *Verificación:* con dos antecedentes en `sortOrder` 1 y 2, retirar el **2**, crear uno nuevo —que recibe `MAX(1) + 1 = 2` y colisiona con el retirado— y reactivar el retirado devuelve **200** y lo deja en **`3`**, sin violar el índice único parcial; sin colisión conserva su número original; reactivar una fila ya activa responde 409 `MEDHIST_005B_ALREADY_ACTIVE`; la reactivación **no** revalida la guarda de duplicado ni el estado del padre; el rol mínimo es SUPERADMIN y un ADMIN recibe 403.

14. **`ESAVI-MEDHIST-005C`.** `purgeEntityService` sin modificarlo.
    *Verificación:* purgar un antecedente activo responde 409 `MEDHIST_005C_STILL_ACTIVE`; purgar uno retirado lo destruye y un `003` posterior responde 404; el `diagnosticTerm` que citaba **sigue existiendo**; el rol mínimo es SUPERADMIN; `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` y `diagnosticTermResolution.service.ts` no aparecen en `git diff`.

15. **El volcado de `ESAVI-NOTIFCN-005C`.** Añadir `dumpNotificationMedicalHistoriesBeforeCascade` a `src/services/notification.service.ts`, con la forma de `dumpNotificationVaccinesBeforeCascade` (`:773-796`), e invocarla junto a las otras seis dentro de `purgeNotificationService`.
    *Verificación:* purgar una notificación con tres antecedentes —uno de ellos retirado— escribe **una** línea `warn` con `3` y los tres `medicalHistoryId`; con cero antecedentes **no escribe ninguna línea**; la purga **no se bloquea** en ningún caso y un fallo dentro del volcado no la aborta; `git diff src/services/notification.service.ts` toca únicamente la función nueva y su invocación, **sin rozar** `cascadeSealSevereNotification`, `cascadeClearSevereNotification`, `cascadeSealNonSevereNotification` ni `cascadeClearNonSevereNotification`.

16. **Rutas y registro.** `src/routes/notificationMedicalHistory.routes.ts` con las nueve en el orden de §3.4, montado en `src/routes/index.ts` bajo `/api/notification-medical-histories`.
    *Verificación:* `GET /case/<uuid>` alcanza el `006` y no el `003`; `GET /admin/notification/<uuid>` alcanza el `002B` y no el `002A`; `PATCH /activate/<uuid>` alcanza el `005B`; `DELETE /purge/<uuid>` alcanza el `005C`; ninguna literal cae en el validador de UUID del `:id`; el comentario `// Code: ESAVI-MEDHIST-<NNN>` está en la ruta, el controlador y el servicio, y coincide con el `AppError` y con `appDetails.method` en los cinco lugares.

17. **Pruebas.** Nueve filas en `ROUTE_RULES` de `tests/auth/roles.test.ts` —de 337 a 346— y `tests/contract/notificationMedicalHistory.test.ts` con el recorrido completo, siguiendo a `tests/contract/notificationVaccine.test.ts`.
    *Verificación:* `npm run check` pasa entero —build, lint, `i18n:check` y jest—; la suite de roles cuenta las nueve rutas nuevas y ninguna queda sin regla; la de contrato cubre el alta, los dos listados por notificación, el `006`, el `003`, los cinco escenarios de update diferencial de §5, el `005A`, el `005B` con colisión de `sortOrder`, el `005C` y el volcado.

---

## 5. Criterios de aceptación

**Del DDL:**

1. Ejecutar `esaviapp.sql` sobre una base limpia crea `notificationMedicalHistory` con doce columnas, dos FKs y un `CHECK`, y **no altera ninguna otra tabla**.
2. `SELECT tgname FROM pg_trigger WHERE tgrelid = '"notificationMedicalHistory"'::regclass AND NOT tgisinternal` devuelve **exactamente dos** filas: `TRG_notificationMedicalHistory_setSysDetails` y `TRG_notificationMedicalHistory_setSortOrder`. **No existe** `setUpdatedAt` ni `preventPhysicalDelete`.
3. Un `DELETE` físico directo sobre una fila **ejecuta**, y purgar la notificación padre destruye sus antecedentes por `ON DELETE CASCADE`.
4. `CLAUDE.md` dice 46 tablas y la cifra coincide con `grep -c "^CREATE TABLE IF NOT EXISTS" esaviapp.sql`.

**Del alta (`001`):**

5. `POST` con `notificationId` e `historyName` sobre una notificación vacía y visible → **201**, `diagnosticTermId: null`, `historyRaw` con el texto, `notes: null`, `sortOrder: 1`, `isActive: true`. La segunda alta recibe `sortOrder: 2`.
6. El `INSERT` emitido **no contiene la columna `sortOrder`**. Verificable con `logging` de Sequelize en la suite.
7. `POST` con `historyCode` inédito y sin `source` → 201, se crea la fila en `diagnosticTerm` con `source: 'LOCAL'`, e `historyRaw` queda **`null`** si `historyName` coincide con el nombre del maestro, o con el texto si difiere.
8. `POST` con `source: 'MEDDRA'` y un código que no existe → **404** `MEDHIST_001_DIAGTERM_NOT_FOUND`, y `SELECT count(*) FROM "diagnosticTerm"` no ha cambiado.
9. `POST` sobre una notificación **inexistente** o **inactiva** → **404** `MEDHIST_001_NOTIFICATION_NOT_FOUND` en los dos casos, con el mismo mensaje, **también con token SUPERADMIN**.
10. `POST` de un término que ya tiene un antecedente **activo** en esa notificación → **409** `MEDHIST_001_ALREADY_EXISTS`. Si el que lo tiene está **inactivo** → **201**.
11. `POST` del mismo texto dos veces **sin `historyCode`** → **201** las dos, y quedan dos filas.
12. `POST` sobre una notificación con `hasRelevantMedicalHistory` en `'NO'`, `'UNKNOWN'` o `null` → **201**, y **la columna conserva su valor**. Verificable leyéndola antes y después.
13. `notificationType` no altera ningún resultado: el alta se comporta igual en `SEVERE` que en `NON_SEVERE`.

**De los listados (`002A`, `002B`, `006`):**

14. El `002A` devuelve solo `isActive: true`; el `002B` devuelve también los inactivos y los de `deletedAt` sellado. Los dos, `{ count, rows }` ordenados por `sortOrder` ascendente.
15. Una notificación visible sin antecedentes → **200** con `{ count: 0, rows: [] }`. Un `notificationId` inexistente → **404**, con cualquier rol.
16. Una notificación inactiva → **404** para USER y ADMIN, **200** para SUPERADMIN. El `002B` con rol USER → **403**.
17. `?limit=1&offset=1` devuelve la segunda fila y el `count` total, no `1`.
18. El `006` sobre un caso activo con notificación devuelve los antecedentes **activos** ordenados por `sortOrder`. Un `caseId` inexistente o inactivo → **404** `MEDHIST_006_CASE_NOT_FOUND`; un caso activo sin notificación → **404** `MEDHIST_006_NOTIFICATION_NOT_FOUND`; un caso con notificación y sin antecedentes → **200** con `{ count: 0, rows: [] }`.
19. El `006` **no** devuelve antecedentes inactivos ni siquiera con token SUPERADMIN. La variante admin no existe y se entra por el `002B`.

**De la lectura (`003`):**

20. Devuelve la forma exacta de §3.7. `diagnosticTerm` con **seis** campos y **sin `metadata`**; `sysDetails` no aparece; `hasRelevantMedicalHistory` no aparece.
21. Los dos motivos de invisibilidad —antecedente inactivo, notificación inactiva— responden **404** para USER y ADMIN y **200** para SUPERADMIN, cada uno por separado y combinados.

**Del update diferencial (`004`) — el bloque de SPEC F12, entero:**

22. **Un `PUT` con el body idéntico a lo guardado no escribe nada.** Ni `UPDATE`, ni `updatedAt`, ni entrada nueva en `appDetails`, ni evento en `sysDetails`. Verificable comparando `updatedAt` y `jsonb_array_length("appDetails")` antes y después: los dos idénticos.
23. **Reenviar íntegra la respuesta del `GET` no escribe nada**, incluida una fila con `historyRaw` divergente del nombre del maestro. Es la trampa que la fórmula de `incomingName` cubre: el nombre efectivo que el `GET` mostró vuelve como una clave ausente, no como una reescritura.
24. **Un `PUT` que cambia un solo campo escribe ese campo y nada más.** `appDetails` crece en **exactamente una** entrada, con `method: 'ESAVI-MEDHIST-004'`, y el historial anterior se conserva íntegro.
25. **La escritura la dispara el cambio de valor, no la presencia de la clave.** Un `PUT` con `historyCode` igual al que produjo el término guardado **no consulta ni escribe `diagnosticTerm`** —`SELECT count(*)` sobre el maestro no cambia y `updatedAt` del antecedente tampoco—. Un `historyCode` distinto sí re-dispara la resolución.
26. **Los campos inmutables se ignoran en silencio.** Un `PUT` con `notificationId` de otra notificación o con `sortOrder: 99` devuelve **200**, no 400, y ninguno de los dos cambia en la base.
27. `notes` es anulable: `notes: null` explícito lo borra y **sí** cuenta como diferencia; `notes` ausente lo deja como estaba. `historyName: null` es **400** del validador y nunca llega al servicio.
28. Cuando el diff vuelve vacío, la respuesta es **200** con la fila tal cual, no 304 ni 204.
29. Un `PUT` que resuelve a un término que ya tiene otro antecedente activo en esa notificación → **409** `MEDHIST_004_ALREADY_EXISTS`, y la propia fila queda excluida de la comprobación.
30. **Ningún `PUT` escribe en `notification`**, cambie lo que cambie. `updatedAt` de la notificación es idéntico antes y después.

**De la activación (`005A`, `005B`):**

31. `005A` sella `isActive: false` y `deletedAt`, **sin comprobar el estado de la notificación**: retirar un antecedente de una notificación inactiva devuelve **200**. Repetir → 409 `MEDHIST_005A_ALREADY_INACTIVE`.
32. Retirar el **último** antecedente activo de una notificación **no cambia `hasRelevantMedicalHistory`**.
33. **El escenario de colisión de `sortOrder`, entero:** con dos antecedentes en `1` y `2`, retirar el **`2`**, crear uno nuevo —que recibe `MAX(1) + 1 = 2`— y reactivar el retirado → **200**, y el reactivado queda en **`3`**. El índice único parcial no se viola y ninguna de las tres filas comparte número.
34. Sin colisión, el `005B` conserva el `sortOrder` original. Reactivar una fila ya activa → 409 `MEDHIST_005B_ALREADY_ACTIVE`. El rol mínimo es **SUPERADMIN**; un ADMIN recibe 403.
35. El `005B` **no** revalida la guarda de duplicado: reactivar puede dejar dos antecedentes activos con el mismo término. Es consecuencia asumida y declarada en §6.

**De la purga (`005C`) y del volcado:**

36. Purgar un antecedente **activo** → **409** `MEDHIST_005C_STILL_ACTIVE`. Purgar uno retirado lo destruye, y un `003` posterior → 404. El `diagnosticTerm` que citaba **sigue existiendo**.
37. `ESAVI-NOTIFCN-005C` sobre una notificación con tres antecedentes —uno retirado— escribe **una** línea `warn` con el conteo `3` y los tres `medicalHistoryId`, y **no se bloquea**. Con cero antecedentes no escribe ninguna línea.
38. Un fallo dentro del volcado —la consulta lanza— **no aborta la purga**: el `catch` escribe su línea `error` y la operación continúa.

**De la forma y del canon:**

39. El código `ESAVI-MEDHIST-<NNN>` es **idéntico** en los cinco lugares —ruta, controlador, servicio, `AppError` y `appDetails.method`— en las nueve operaciones.
40. `npm run check` pasa entero. `npm run i18n:check` no reporta claves huérfanas y `tests/auth/roles.test.ts` cubre las nueve rutas nuevas, de 337 a 346.
41. `git diff` **no toca** `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts`, `diagnosticTermResolution.service.ts`, ni ninguna parte de `notification.service.ts` fuera de la función de volcado nueva y su invocación en `purgeNotificationService`.
42. `esaviapp.sql` crece en **tres zonas y solo tres**: el bloque `CREATE TABLE` con su índice, la fila del bucle `setSortOrderByParent` y el índice único parcial.

---

## 6. Decisiones tomadas y descartadas

**La tabla se crea en `esaviapp.sql`, editando el DDL en el sitio.**

- **Sí:** es el precedente de F47, y descansa en el mismo supuesto —desarrollo, instalaciones locales, sin datos productivos—. El esquema no lo genera Sequelize y `esaviapp.sql` es la fuente autoritativa: una tabla que no esté ahí no existe para nadie que cargue el proyecto de cero.
- **No:** un script de migración numerado. Introduciría un mecanismo que el repositorio no tiene —no hay directorio de migraciones, ni tabla de versiones, ni orden de aplicación— para resolver un problema que hoy no existe. El día que haya una instalación con datos, ese mecanismo será su propio spec.
- **Tampoco:** `sequelize.sync()`. Está descartado en `CLAUDE.md` para las 45 tablas anteriores y no se reabre por la cuarenta y seis.

**La bandera `hasRelevantMedicalHistory` y la lista quedan desacopladas en los dos sentidos.** Es la decisión más cara de revertir de todo el spec, y por eso lleva tres criterios de aceptación propios.

- **Sí:** la bandera es dato del formulario de notificación y solo la escribe `ESAVI-NOTIFCN-004`. La lista es dato clínico y la escribe este servicio. Que el `001` la forzara a `'YES'` significaría que un alta hija muta la fila padre, y que el `005A` la devolviera a `'NO'` significaría que retirar una fila reescribe una respuesta que un humano dio. Ninguna de las dos es una inferencia que el sistema pueda hacer por su cuenta: `'NO'` con tres antecedentes cargados es una contradicción **del formulario**, no de la base, y quien la resuelve es quien lo firma.
- **No:** propagación diferencial de la bandera a `'YES'` en el `001`. Era la opción intermedia y sigue siendo la más tentadora —solo escribe si el valor cambia realmente, así que no viola §11—. Se descarta porque el problema no es la mecánica de la escritura sino la autoría: el `'YES'` dejaría de ser una respuesta del notificador para ser un efecto secundario, y `appDetails` de la notificación crecería con entradas que el usuario no reconocería como suyas.
- **Tampoco:** 409 cuando la bandera no vale `'YES'`. Trampa de orden clásica: el notificador que rellena el formulario de arriba abajo cargaría los antecedentes antes de guardar la cabecera, y recibiría un error por una secuencia de captura perfectamente razonable. Es la decisión literal de F33 frente a `isPregnancyConfirmed` y la de F27 frente a `hasComplications`.
- **La consecuencia asumida** —notificaciones incoherentes entre bandera y lista— está en §7, y su lugar natural es una validación de cierre del caso, no una guarda de escritura.

**Hija directa de `notification`, y no de un bloque 1:1 intermedio.**

- **Sí:** del lado de notificación no existe un `notificationMedicalHistory` 1:1 que agrupe campos del antecedente —edad gestacional, método, parto—, porque la notificación no los pregunta: eso es materia de la investigación y ya vive en `investigationMedicalHistory`. Colgar de `notification` da una visibilidad heredada de un salto, la forma corriente de F16, F21 y F22.
- **No:** replicar la estructura de dos niveles de la investigación creando además una tabla 1:1 vacía. Sería una tabla sin más columnas que su PK, existiendo solo para sostener una FK, y con ella heredaríamos la cadena de dos saltos y el `paranoid: false` que F33 necesitó — complejidad pura sin dato detrás.
- **Y de ahí sale el nombre.** `notificationMedicalHistory` guarda **la lista**, no el bloque. La colisión conceptual con `investigationMedicalHistory` —donde el mismo nombre designa el bloque 1:1— es real y se acepta: el prefijo desambigua, y llamarla `notificationMedicalHistoryTerm` para evitarla haría que la tabla se llamara por su implementación en vez de por su contenido.

**Sin `metadata jsonb` y sin catálogo de tipo.** F27 tiene las dos cosas; F33, ninguna. Se sigue a F33: no hay ningún dato del antecedente que no quepa en el término resuelto, el texto libre y las notas, y una columna abierta sin contrato declarado es una invitación a escribir lo que sea. La ausencia del catálogo de tipo es además lo que **reduce la guarda de duplicado al término solo** y lo que deja la tabla sin ninguna FK a `catalogItem`, así que no hay nada que sembrar antes de usarla.

**La guarda de duplicado es solo el término, y solo contra activos.**

- **Sí:** compara contra **activos** porque un antecedente retirado no debe bloquear volver a cargar el mismo: es la vía normal de deshacer un alta equivocada sin pasar por el `005B`.
- **La consecuencia asumida:** un `005B` puede dejar dos antecedentes activos con el mismo término, porque la reactivación no revalida la guarda. Se acepta a cambio de que reactivar siga siendo lo que dice ser —deshacer una desactivación— y no una segunda alta encubierta que pueda fallar por el estado de filas ajenas. Es la decisión de F27 §6, F31 §6 y F33 §6, literal.
- **Y lo que no cubre:** dos antecedentes de texto libre con el mismo texto no colisionan. Está en §7.

**El `004` en USER, apartándose de F21 y F22.** La matriz de la familia de notificación pone el update en ADMIN. Aquí no: quien registra el antecedente es quien lo corrige, y obligar a un ADMIN a arreglar una errata de captura parte el flujo operativo por la mitad. Es además la posición de F33 —el gemelo estructural— y la de las doce specs que ya apartaron su `004` de la matriz canónica de §9.

**El `005B` en SUPERADMIN, siguiendo a F21 y F22 y no a F33.** F33 bajó su activación a ADMIN argumentando que la reasignación de `sortOrder` la convierte en una operación de administración del caso. El argumento es válido y aquí pesa menos que la simetría: las cuatro hijas 1:N de `notification` tienen su `005B` en SUPERADMIN, y que la quinta lo tuviera en ADMIN obligaría a explicar la excepción cada vez. **La desviación del `004` se paga una vez; hacer dos desviaciones en la misma matriz es empezar a no tener matriz.**

**El `006` sí existe, y no lleva variante admin.**

- **Sí:** es la decisión de F16, F21 y F22, no la de F27 y F33. La diferencia es dónde está el identificador de entrada: en el bloque de investigación el `investigationId` ya viaja en respuestas que el cliente tiene a mano, y aquí el `notificationId` no —el cliente tiene el `caseId`—. Sin el `006`, pintar el formulario del caso cuesta dos llamadas.
- **No:** un `006B` admin. Quien necesite ver inactivos entra por el `002B` con el `notificationId` que este mismo endpoint devuelve. Es la decisión literal de F21 §3.5.

**El volcado del `005C` de la notificación: se vuelca, no se bloquea.** Un 409 cuando haya antecedentes registrados obligaría a purgar en dos pasos con la única ventaja de un aviso que el log ya da, y quien la ejecuta es SUPERADMIN sobre una notificación ya sellada. Es la línea de F16, F21 y F22, y romperla aquí dejaría el repositorio con dos criterios distintos para la misma situación. **Conteo con ids y no snapshot por fila**, por el criterio que F31 fijó para las colecciones: veinte antecedentes enterrarían bajo veinte líneas la que importa.

**Sin cifrado.** `historyRaw` es un término clínico —«diabetes tipo 2»—, no un identificador de persona. Cifrarlo con `esaviCrypt` haría inútil cualquier búsqueda futura por texto y no protegería nada que el resto de la notificación no exponga ya. Es la línea de F27 y F33, y la contraria a `appUser`.

**La guarda del padre falla también para SUPERADMIN en el `001`.** `canViewInactive` relaja la **visibilidad**, no la **escritura**: una notificación inactiva no recibe antecedentes nuevos ni siquiera de quien puede verla. Lo que sí se relaja para SUPERADMIN es el `isActive` en los listados, que es lectura.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| **Es la primera tabla que el repositorio añade al DDL.** Cualquier instalación que ya tenga la base cargada no la tendrá, y el fallo aparecerá en tiempo de ejecución como `relation "notificationMedicalHistory" does not exist`, no al arrancar: `connectDatabase()` solo verifica la conexión, no el esquema | El supuesto de F47 —desarrollo, instalaciones locales, sin datos productivos— está declarado como precondición en §2 y es lo que lo hace aceptable. La base se recarga con el DDL nuevo; una instalación con datos exige el `CREATE TABLE` a mano antes de desplegar |
| **`notificationMedicalHistory` e `investigationMedicalHistory` se llaman casi igual y no son lo mismo:** la primera es una lista de N términos, la segunda un bloque 1:1 de campos gestacionales. Un `import` equivocado compila —los dos son modelos Sequelize— y falla tarde | §6 declara el choque de nombres y por qué se acepta. La diferencia de abreviatura, `MEDHIST` frente a `INVMEDH`, es lo que hace inequívoco cualquier `grep` sobre el log y sobre los códigos de operación |
| **La bandera y la lista pueden contradecirse:** una notificación con `hasRelevantMedicalHistory: 'NO'` y tres antecedentes cargados es un estado alcanzable y nadie lo impide | Asumido y razonado en §6, con los criterios 12, 30 y 32 verificándolo. Su lugar natural es una validación de cierre del caso —`ESAVI-CASEFLOW-008`—, no una guarda de escritura de esta entidad. Queda fuera de alcance |
| **Dos antecedentes de texto libre con el mismo texto no colisionan.** La guarda compara `diagnosticTermId`, así que cargar «hipertensión» dos veces sin código produce dos filas | Asumido y declarado en §2. Deduplicar texto libre exige normalizar acentos y decidir umbrales de parecido; es lo mismo que F31 §7 dejó abierto para `fullName`, y no se resuelve aquí |
| **La rama `LOCAL` acuña términos al vuelo**, así que un código mal escrito crea un `diagnosticTerm` nuevo en vez de fallar | Es el diseño de F15, no un efecto de este spec: el término nace con `autoCreated` y `reviewStatus` en su `metadata`, precisamente para que la gobernanza del catálogo lo revise después |
| **La reasignación del `005B` manda el antecedente al final de la lista**, y el orden que el notificador había dado se pierde | Es el mismo comportamiento de F16, F21, F27, F31 y F33. El `007` de reordenación, fuera de alcance, es lo que lo resolverá; hasta entonces el orden se corrige retirando y volviendo a cargar |
| **El `005A` libera el `sortOrder` y otro antecedente puede tomarlo**, de modo que dos filas —una viva, una retirada— comparten número hasta que el `005B` lo arregle | Es la razón de ser del `005B` con reasignación, y el índice único parcial no se viola porque la retirada está fuera de él. Criterio 33 |
| **La purga de una notificación destruye los antecedentes sin auditoría propia** | El volcado `warn` es la única mitigación posible sin bloquear, y es la que este spec añade. Declarado en §6, verificado en los criterios 37 y 38 |
| **Olvidar la fila del bucle `setSortOrderByParent` no rompe nada visible:** el trigger simplemente no existe, todas las filas nacen con `sortOrder: 0` y el índice único parcial revienta en la **segunda** alta de la misma notificación, no en la primera | El criterio 2 cuenta los triggers por `pg_trigger`, y el criterio 5 exige `sortOrder: 1` y `2` en dos altas consecutivas. Los dos fallan si la fila falta |

**No hay sección 8.** El contrato HTTP de los endpoints existentes no cambia: este spec solo añade nueve rutas nuevas bajo un prefijo que no existía, y ninguna respuesta anterior —`notification`, `esaviCase`, `investigationMedicalHistory`— gana o pierde un campo.

---

## Lo que **no** está en este spec

- Escribir, leer como condición o revertir `notification.hasRelevantMedicalHistory` desde cualquier operación de esta entidad, en cualquiera de los dos sentidos.
- Cualquier validación de coherencia entre la bandera y la lista, incluida la del cierre del caso.
- Copiar, sincronizar o arrastrar estos antecedentes hacia `investigationMedicalHistory` o `investigationPregnancyCondition` cuando el caso pasa a investigación.
- Bloquear `ESAVI-NOTIFCN-005C` cuando existan antecedentes registrados.
- Incluir la colección en la respuesta de `notification` o de `esaviCase`.
- Carga masiva o importación de antecedentes desde fichero.
- Reordenar antecedentes — el `007` que F16, F27, F31 y F33 dejaron abierto.
- Aceptar `diagnosticTermId` directo del cliente.
- Filtros de listado por término o por texto, y variante admin del `006`.
- Deduplicar antecedentes de texto libre.
- Cifrar `historyRaw` o cualquier otro campo.
- Un script de migración, un mecanismo de versionado de esquema o `sequelize.sync()`.
- Modificar `esaviapp.sql` más allá de las tres zonas de §3.1, ni `purgeEntityService`, `setEntityActiveStatusService`, `satelliteCascade.service.ts` o `diagnosticTermResolution.service.ts`.
- Extraer `normalizeText` a un helper compartido.
- Exponer o editar `sysDetails`.
