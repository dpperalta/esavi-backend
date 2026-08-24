# SPEC F34 — CRUD de `investigationClinicalEvaluation`

> **Estado:** Implementado
> **Depende de:** SPEC 01 (roles), SPEC 02 (validación de entrada), SPEC 03 (paridad i18n), SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios), **SPEC F28 (`investigation` — dependencia dura de modelo: la PK de esta tabla *es* su FK)**, SPEC F06 (`esaviCase` — el arrastre entra también desde `ESAVI-CASE-005A`), **SPEC F29 (`investigationSource` — hermana de forma: aporta el patrón del par bandera/explicación con su asimetría `001`/`004`)**, SPEC F30 (`investigationAutopsy`), **SPEC F32 (`investigationMedicalHistory` — aporta `satelliteCascade.service.ts`, que este spec consume ya extraído)**, SPEC F13 y SPEC F14 (patrón de satélite sin `isActive`), **SPEC F04 (patrón de cifrado PII sobre `appUser`) y SPEC F05 (`patient` — cifrado de un nombre de persona con `toTitleCase` previo)**, SPEC F08 (operación `005C`), SPEC F12 (update diferencial)
> **Fecha:** 2026-08-24
> **Objetivo:** Dar de alta `investigationClinicalEvaluation` —la evaluación clínica del paciente investigado: de qué fuentes se obtuvo, qué sospechas sociales levanta y qué resumen clínico deja el investigador— como la **sexta** tabla satélite de `investigation` con spec propio.

---

## 1. Por qué existe este spec

`investigationClinicalEvaluation` responde al bloque de evaluación clínica del formulario de investigación: si el paciente recibió atención médica, sobre qué material se construyó la evaluación —examen, documentos, autopsia verbal u otra fuente—, si el investigador detectó indicios de maltrato infantil o violencia intrafamiliar, y los cinco textos donde queda el relato clínico completo.

Hoy la tabla existe en `esaviapp.sql:1085-1109` y no tiene nada en `src/`: ni modelo, ni tipos, ni ruta.

Es la **sexta de las trece satélites de `investigation`** —catorce tablas contando la raíz—, después de las que dieron de alta el [SPEC F29](./29-investigationsource-crud.md), el [SPEC F30](./30-investigationautopsy-crud.md), el [SPEC F31](./31-investigationteammember-crud.md), el [SPEC F32](./32-investigationmedicalhistory-crud.md) y el [SPEC F33](./33-investigationpregnancycondition-crud.md). De forma es hermana de F29, F30 y F32, y **no** de F31 ni F33. Los cuatro rasgos que aquéllas fijaron se cumplen aquí sin matices, y se citan en vez de repetirse:

- **La PK *es* la FK.** `investigationId` es `uuid PRIMARY KEY` sin `DEFAULT gen_random_uuid()` (`esaviapp.sql:1086`) y destino de `FK_investigationClinicalEvaluation_investigation` (`:1108`). Sin `UNIQUE` adicional: la propia clave primaria impone el uno a uno.
- **No tiene `isActive`.** Es la **sexta** del repositorio así, tras `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy` e `investigationMedicalHistory`. De ahí sale, igual que allí, que **no haya `005A` ni `005B`**, y que la visibilidad se herede de `investigation.isActive`.
- **El `ON DELETE CASCADE` dispara de verdad.** `investigation` no figura en el bucle `preventPhysicalDelete` (`esaviapp.sql:1368-1381`), así que un `ESAVI-INVESTGN-005C` arrastra esta fila sin preguntar.
- **Solo lleva el trigger genérico.** `TRG_investigationClinicalEvaluation_setSysDetails`, del bucle de `esaviapp.sql:1286-1302`. No existe `TRG_..._setUpdatedAt` —el bucle lo hace `DROP` y nunca lo crea, en ninguna de las 45 tablas—: `updatedAt` lo escribe la aplicación.

**Y una cosa que este spec ya no tiene que resolver.** F32 extrajo `cascadeSealSatellite` y `cascadeClearSatellite` a `src/services/common/satelliteCascade.service.ts` precisamente para que la cuarta satélite sin `isActive` no volviera a duplicar el arrastre. Ésta es la cuarta consumidora, y **lo consume tal cual está**: el spec no toca ese archivo ni el de ninguna entidad ya implementada.

**Lo que sí es nuevo, y es la razón de que el spec no sea un calco.** Tres cosas:

**A — Es la primera satélite de `investigation` con un campo cifrado.** `clinicalDetailsPersonName` (`:1097`) es el nombre de la persona que aportó los detalles clínicos, y se guarda con `esaviCrypt`. La decisión **rompe deliberadamente el precedente de F31 y de `notifier`**, que dejaron sus nombres de persona en claro con el argumento de «identidad publicada, no protegida». La frontera se traza distinta aquí y §6 la razona: el equipo investigador firma el informe, esta persona solo aparece mencionada en él. La consecuencia operativa es inmediata y está declarada en §2: sobre esa columna **no hay filtro, ni búsqueda, ni orden**, solo igualdad exacta, y volver atrás cuesta una migración de datos.

**B — Es la primera tabla del repositorio con tres pares bandera/explicación gobernados por la misma regla.** `sourceOther`/`otherDescription`, `suspectedChildAbuse`/`childAbuseExplanation` y `suspectedDomesticViolence`/`domesticViolenceExplanation`. Los tres replican **exactamente** la regla que F29 fijó para su fuente «otra», con su lado obligatorio y su asimetría `001`/`004`. Que sean tres y no uno no cambia la regla: cambia que el servicio la aplique parametrizada en vez de escrita tres veces.

**C — No tiene ninguna FK a `catalogItem`.** Es la primera satélite de `investigation` sin ninguna. No hay `catalogType` que validar, ni catálogos que sembrar como precondición de despliegue, ni objetos resueltos que incluir en la respuesta. El único `include` de toda la entidad es el del padre, y ése no es decorativo: es lo que implementa la visibilidad heredada.

**Y una tabla que depende de ésta y no existe todavía.** `evaluationInstitution` (`esaviapp.sql:1111-1130`) apunta su FK a `investigationClinicalEvaluation("investigationId")`, **no** a `investigation` (`:1127`). Sin esta fila no puede existir ninguna institución evaluadora. Queda **fuera de alcance** —su propio spec—, pero la dependencia se declara aquí porque condiciona el orden en que se implementan las satélites restantes.

---

## 2. Alcance

**Dentro:**

- Los siete artefactos completos de `investigationClinicalEvaluation`: modelo, asociaciones, tipos, validadores, servicio, controlador y ruta.
- **Siete operaciones:** `001` crear, `002A` listar público, `002B` listar admin, `003` obtener por ID, `004` actualizar, `005C` borrado físico y la no canónica `006` obtener por caso. Alta de la fila correspondiente en la tabla de operaciones no canónicas de `references/CONVENTIONS.md` §6.
- **Ninguna operación `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar ni desactivar. Es la ausencia que fijaron F13 y F14 y que F29, F30 y F32 mantuvieron.
- **Listado dual `002A` / `002B`**, heredado de F29, F30 y F32: la visibilidad se hereda de `investigation.isActive`, así que las dos variantes devuelven conjuntos distintos. `002A` en `GET /` para USER solo devuelve evaluaciones cuya investigación está activa; `002B` en `GET /admin` para ADMIN las devuelve todas.
- Relación **uno a uno** con `investigation`, sostenida por la propia clave primaria. Crear la segunda evaluación de una misma investigación devuelve **409**, y el hueco **no se libera** con el sellado de `deletedAt`: solo el `005C` lo libera.
- **Guardas del alta**, en este orden: la investigación existe y está **activa** → 404 `INVCLIEV_001_INVESTIGATION_NOT_FOUND`; no tiene ya evaluación, sin filtrar por `deletedAt` → 409 `INVCLIEV_001_ALREADY_EXISTS`.
- **Visibilidad heredada del padre.** Toda lectura incluye `investigation` con `required: true` y comprueba su `isActive`: si la investigación está inactiva, la evaluación responde **404** para USER y ADMIN, y **200** para SUPERADMIN vía `canViewInactive`.
- **Alta vacía.** Las dieciséis columnas de datos son anulables y **ninguna es obligatoria**: `POST { investigationId }` devuelve **201** con las dieciséis en `null`. La fila se abre como borrador y se completa por `PUT`. Es el patrón de F13, F14, F29 y F32.
- **`investigationId` inmutable en el `004`:** se ignora en silencio si llega, sin 400, igual que en F29, F30 y F32.
- **`receivedMedicalAttention` validada contra `ANSWER_OPTIONS`** (`src/constants/enums.constants.ts:8`) y anulable. `null` («no se preguntó») y `'NO_ANSWER'` («se preguntó y no contestó») son datos distintos y no se funden, como fijó F13. **No gobierna nada**: se recibe, se valida la forma y se almacena. No condiciona el bloque de fuentes, ni los textos clínicos, ni los pares de sospecha.
- **Los tres pares bandera/explicación, con la regla de F29 replicada íntegra y sin matices** —`sourceOther`/`otherDescription`, `suspectedChildAbuse`/`childAbuseExplanation`, `suspectedDomesticViolence`/`domesticViolenceExplanation`—:
  - Con la bandera resultante `true`, la explicación resultante debe existir y no quedar vacía tras `.trim()`, venga en el body o esté ya guardada → si no, **400** `<PAR>_REQUIRED`.
  - Con la bandera resultante distinta de `true`, la explicación está **prohibida**, con la asimetría `001` / `004`: **400** en el alta, y en el update **forzada a `null` como derivado condicional** si el cliente no la manda, **400** si la manda con contenido.
  - Los tres pares son **independientes entre sí**: cada uno se evalúa contra su propia bandera resultante y produce su propio error.
- **`sourceExam`, `sourceDocuments` y `sourceVerbalAutopsy` no gobiernan nada.** Son booleanos planos y anulables, sin explicación asociada. Solo `sourceOther` tiene par.
- **`clinicalDetailsPersonName` cifrado con `esaviCrypt`.** Normalizado con `.trim()` y `toTitleCase` **antes** de cifrar, siguiendo F05. El diff se compara sobre **texto plano** —`stored` descifrado con `esaviDecrypt`, `esaviCrypt` aplicado **después** del diff— y toda respuesta lo devuelve descifrado, listados incluidos.
- **Ningún otro campo cifrado.** Los otros seis textos libres se guardan en claro. §6 razona la frontera: se cifra la identidad, no el contenido clínico.
- **Normalización al escribir:** `.trim()` sobre los siete textos libres. `toTitleCase` solo sobre `clinicalDetailsPersonName`. No hay `code` ni `name`, así que no aplica `toConstantCase`.
- **Update diferencial con `buildDifferentialUpdate`** (SPEC F12), con la tabla de `candidates` campo por campo de §3.5.
- **Arrastre del `deletedAt` por los tres caminos que retiran al padre**, ya sobre `src/services/common/satelliteCascade.service.ts` **sin modificarlo**: `ESAVI-INVESTGN-005A` sella, `ESAVI-CASE-005A` sella también, y `ESAVI-INVESTGN-005B` limpia. Implica añadir invocaciones en `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts`, **junto a las que F29, F30 y F32 ya dejaron puestas**.
- **Volcado al log en nivel `warn` de la fila arrastrada por `ESAVI-INVESTGN-005C`**, junto a los tres que F29, F30 y F32 dejaron.
- **Guarda propia de `005C`:** la fila debe tener `deletedAt` sellado → si no, **409** `INVCLIEV_005C_NOT_DELETED`. Reutiliza `assertRowIsSealed` (`src/helpers/rowSeal.helper.ts`) **sin modificarlo**, porque el control de `isActive` de `purgeEntityService` es inerte sobre una tabla que no tiene esa columna.
- Filtros del listado: `investigationId` y `caseId`, acumulativos con `AND` y por igualdad, el segundo resuelto por el include de la investigación. Orden `createdAt DESC`.
- Alta de la abreviatura **`INVCLIEV`** en `references/CONVENTIONS.md` §6.
- Claves i18n nuevas en `es`, `en` y `nl`.
- Siete filas nuevas en `ROUTE_RULES` de `tests/auth/roles.test.ts`, suite `tests/contract/investigationClinicalEvaluation.test.ts`, y ampliación de `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts` con los tres arrastres.

**Precondiciones de implementación** (no son parte de este spec):

- El **SPEC F28** debe estar `Implementado`. La PK de esta tabla es su FK, y el arrastre se cuelga de sus operaciones `005A`, `005B` y `005C`.
- El **SPEC F32** debe estar `Implementado`. No hay dependencia de modelo, pero sí de código: `satelliteCascade.service.ts` nace allí y este spec lo consume tal cual.
- **`CRYPTO_KEY` configurada.** Es la misma precondición de F04, F05 y F07; sin ella el alta con `clinicalDetailsPersonName` falla en tiempo de ejecución.

**Fuera de alcance (otros specs):**

- **`evaluationInstitution`** (`esaviapp.sql:1111-1130`), pese a colgar de esta tabla y no de `investigation`. Tiene `sortOrder`, `isActive` propio y tres FK —a `investigationClinicalEvaluation`, a `healthFacility` y a `catalogItem`—: es un CRUD completo y merece su spec. Su `005C` se arrastra por `ON DELETE CASCADE` sin bloqueo, con volcado en `warn` como única mitigación, igual que F29, F30 y F32 decidieron para el suyo.
- **Las otras seis satélites de `investigation`:** `investigationCovidHistory` (`:1014-1036`), `investigationVaccinationContext` (`:1132-1153`), `investigationVaccineAdministered`, `investigationColdChain`, `investigationAdministrationError` e `investigationCommunity`.
- **Cualquier regla cruzada con `investigationSource`.** Aquella tabla tiene sus **ocho** fuentes de la investigación y ésta tiene **cuatro** fuentes de la evaluación clínica. Los nombres se parecen y los conceptos no son el mismo: una responde «de dónde salió la investigación», la otra «sobre qué material se evaluó al paciente». Que `investigationSource.autopsyRecord` sea `true` **no** obliga a que `sourceVerbalAutopsy` lo sea, ni al revés. Atarlas exige antes decidir cuál manda, y esa decisión no está tomada.
- **Cualquier regla cruzada con `investigationAutopsy`**, `investigationMedicalHistory` o `patient`. Ni la edad del paciente condiciona `suspectedChildAbuse`, ni el `isDeath` de la autopsia condiciona `receivedMedicalAttention`.
- **Cifrar los otros seis textos libres** —`otherDescription`, `childAbuseExplanation`, `domesticViolenceExplanation`, `familyClinicalDetails`, `completeClinicalSummary`, `signsAndSymptoms`, `otherSocialBackground`—. Es la opción (b)/(c) que se valoró y se descartó; §6 lo razona.
- **Búsqueda, filtro u orden por `clinicalDetailsPersonName`.** Sobre un campo cifrado con IV fijo solo cabe la igualdad exacta, y no hay caso de uso que la pida. Es la misma limitación que F05 declaró para los nombres de `patient`.
- **Búsqueda por texto** sobre cualquiera de los siete campos libres.
- **Derivar nada de las cuatro fuentes** —un conteo, una bandera «tiene fuente»— ni de las dos sospechas. No hay ningún campo derivado en esta entidad.
- **Cualquier tablero, conteo o filtro por `suspectedChildAbuse`, `suspectedDomesticViolence` o `receivedMedicalAttention`.** Los dos únicos filtros del listado son los de F29 y F32.
- **Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene evaluación clínica.** Se deja disparar la cascada, con el volcado al log como única mitigación. Es la decisión de F13, F29, F30 y F32, heredada sin reabrirse.
- **Modificar `esaviapp.sql`**: ni añadir `isActive`, ni un `CHECK` sobre los tres pares, ni meter `investigation` en `preventPhysicalDelete`.
- **Modificar `satelliteCascade.service.ts`, `setEntityActiveStatusService`, `purgeEntityService`, `assertRowIsSealed`, `buildDifferentialUpdate` ni `crypto.helper.ts`.** Los seis se consumen tal cual están.
- **Cambiar el comportamiento de F29, F30 ni F32.** Este spec solo añade invocaciones junto a las suyas; sus suites de contrato deben pasar sin tocar un solo caso.
- **Añadir el listado dual a `severeNotification` y `nonSevereNotification`.** Sigue pendiente desde F29 §2 y sigue mereciendo su propio spec.
- **Exponer o editar `sysDetails`.**

---

## 3. Modelo de datos

### 3.1 Tabla origen

`investigationClinicalEvaluation` — `esaviapp.sql:1085-1109`. No se altera.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `investigationId` | `uuid` | no | **PK y FK a la vez** (`:1086`). Sin `DEFAULT gen_random_uuid()`: lo aporta el cliente. `FK_investigationClinicalEvaluation_investigation` → `investigation`, `ON DELETE CASCADE` (`:1108`) |
| `receivedMedicalAttention` | `answerOption` | sí | `:1087`. ENUM de cinco valores. **No gobierna nada** |
| `sourceExam` | `boolean` | sí | `:1088`. Fuente plana, sin explicación asociada |
| `sourceDocuments` | `boolean` | sí | `:1089`. Fuente plana |
| `sourceVerbalAutopsy` | `boolean` | sí | `:1090`. Fuente plana |
| `sourceOther` | `boolean` | sí | `:1091`. **Bandera del par 1** |
| `otherDescription` | `text` | sí | `:1092`. Explicación del par 1 |
| `suspectedChildAbuse` | `boolean` | sí | `:1093`. **Bandera del par 2** |
| `childAbuseExplanation` | `text` | sí | `:1094`. Explicación del par 2 |
| `suspectedDomesticViolence` | `boolean` | sí | `:1095`. **Bandera del par 3** |
| `domesticViolenceExplanation` | `text` | sí | `:1096`. Explicación del par 3 |
| `clinicalDetailsPersonName` | `text` | sí | `:1097`. **Cifrado con `esaviCrypt`**; guarda criptograma, nunca texto plano |
| `familyClinicalDetails` | `text` | sí | `:1098`. Texto libre, en claro |
| `completeClinicalSummary` | `text` | sí | `:1099`. Texto libre, en claro |
| `signsAndSymptoms` | `text` | sí | `:1100`. Texto libre, en claro |
| `otherSocialBackground` | `text` | sí | `:1101`. Texto libre, en claro |
| `notes` | `text` | sí | `:1102`. Texto libre, en claro |

**Dieciséis columnas de datos, las dieciséis anulables.** Ninguna es `NOT NULL`, y de ahí sale directamente el alta vacía de §2: no hay nada que el investigador esté obligado a saber para abrir la fila.

**Restricciones.** **Una sola clave foránea** —la del padre—, **ningún `CHECK`**, **ninguna `UNIQUE`** —la PK ya lo es— y **ningún índice declarado** más allá del de la clave primaria. Los tres pares bandera/explicación **no están en el esquema**: los impone íntegramente la aplicación, y por eso §3.5 es la sección larga de este spec.

**Ninguna longitud máxima declarada.** Los siete campos libres son `text`, sin `varchar(n)`. No hay ningún límite que replicar en el modelo, y **eso resuelve de paso el problema del campo cifrado**: F05 y F07 tuvieron que declarar sus columnas cifradas en `TEXT` pese a ser `varchar(n)` en el DDL, porque el criptograma es más largo que el texto plano. Aquí la columna ya es `text` y no hay desajuste que documentar.

**El ENUM `answerOption`** se declara en `esaviapp.sql:26` con cinco valores: `'YES'`, `'NO'`, `'UNKNOWN'`, `'NOT_APPLICABLE'`, `'NO_ANSWER'`. Ya vive en `src/constants/enums.constants.ts:8` como `ANSWER_OPTIONS`. **No se añade ninguna constante nueva.**

**Las columnas transversales, y la que falta.** Están `createdAt`, `updatedAt`, `deletedAt`, `sysDetails` y `appDetails`. **Falta `isActive`**, igual que en `severeNotification`, `nonSevereNotification`, `investigationSource`, `investigationAutopsy` e `investigationMedicalHistory`. Es la sexta tabla del repositorio así.

**Triggers.** Solo `TRG_investigationClinicalEvaluation_setSysDetails`, del bucle genérico de `esaviapp.sql:1286-1302`. La tabla no figura en el bucle `preventPhysicalDelete` (`:1368-1381`), así que un `DELETE` físico ejecuta y le corresponde la operación `005C`. Tampoco figura en `setSortOrderByParent` (`:1311-1336`): no tiene `sortOrder`.

**Una tabla cuelga de ésta.** `evaluationInstitution` (`:1111-1130`) referencia `investigationClinicalEvaluation("investigationId")` con `ON DELETE CASCADE` (`:1127`). Fuera de alcance, pero condiciona el orden de implementación de las satélites restantes.

### 3.2 Modelo Sequelize

Archivo: `src/models/investigationClinicalEvaluation.model.ts`. Clase `InvestigationClinicalEvaluation`.

`timestamps: false`, `freezeTableName: true`, `tableName: 'investigationClinicalEvaluation'`.

**La PK se declara sin `defaultValue`**, por la misma razón que en F13, F14, F29, F30 y F32: `gen_random_uuid()` convertiría un alta sin `investigationId` en un error de integridad de Postgres en lugar de un 400 legible del validador.

Tipos de atributo:

- `receivedMedicalAttention` — `DataTypes.ENUM(...ANSWER_OPTIONS)`, `allowNull: true`, importando `ANSWER_OPTIONS` y el tipo `AnswerOption` de `src/constants/enums.constants.ts`. Es el patrón de `severeNotification.model.ts:51-67`.
- Las seis banderas booleanas — `DataTypes.BOOLEAN`, `allowNull: true`.
- Los siete textos — `DataTypes.TEXT`, `allowNull: true`.

**`clinicalDetailsPersonName` lleva comentario de dos líneas en el modelo** advirtiendo que la columna guarda el criptograma de `esaviCrypt` y nunca el texto plano, siguiendo `notifier.model.ts:14` y `patient.model.ts:50`. Es la única señal que un lector del modelo tiene: el tipo `TEXT` no distingue una columna cifrada de una en claro.

**No se declara ningún atributo `isActive`.**

Asociaciones, en `src/models/associations/investigationClinicalEvaluation.associations.ts` — archivo nuevo, registrado en `initModels()`:

- `InvestigationClinicalEvaluation.belongsTo(Investigation, { as: 'investigation', foreignKey: 'investigationId' })`
- `Investigation.hasOne(InvestigationClinicalEvaluation, { as: 'clinicalEvaluation', foreignKey: 'investigationId' })` — `hasOne` y no `hasMany`, porque la clave primaria compartida lo impone. El alias `clinicalEvaluation` no colisiona con `source` (F29), `autopsy` (F30), `teamMembers` (F31) ni `medicalHistory` (F32).

**Ninguna asociación más.** Sin FK a `catalogItem`, no hay ningún `belongsTo` de catálogo que declarar. Ninguna asociación va dentro del archivo del modelo. Alta en `src/models/index.ts`.

El inverso `clinicalEvaluation` **no se añade a ninguna respuesta de `investigation`**: el include no se declara en ninguna operación de aquella entidad y su contrato HTTP no cambia. Solo lo consumen las funciones de arrastre de §3.5.

### 3.3 Tipos

`src/types/investigation/investigationClinicalEvaluation.types.ts`, junto a los de `investigation`, `investigationSource`, `investigationAutopsy`, `investigationTeamMember`, `investigationMedicalHistory` e `investigationPregnancyCondition`, exportado por el `index.ts` de barrel que aquel dominio ya tiene:

```ts
export interface CreateInvestigationClinicalEvaluationInput {
    investigationId: string;
    receivedMedicalAttention?: AnswerOption | null;
    sourceExam?: boolean | null;
    sourceDocuments?: boolean | null;
    sourceVerbalAutopsy?: boolean | null;
    sourceOther?: boolean | null;
    otherDescription?: string | null;
    suspectedChildAbuse?: boolean | null;
    childAbuseExplanation?: string | null;
    suspectedDomesticViolence?: boolean | null;
    domesticViolenceExplanation?: string | null;
    clinicalDetailsPersonName?: string | null;
    familyClinicalDetails?: string | null;
    completeClinicalSummary?: string | null;
    signsAndSymptoms?: string | null;
    otherSocialBackground?: string | null;
    notes?: string | null;
}
```

**`investigationId` es el único campo obligatorio del tipo.** Los dieciséis restantes son opcionales y anulables: el `| null` explícito es lo que permite al cliente **borrar** un dato ya guardado, y no solo cambiarlo.

`AnswerOption` se importa de `src/constants/enums.constants.ts`; **no se declara ningún tipo nuevo de enumerado**.

**El tipo no distingue el campo cifrado.** `clinicalDetailsPersonName` es `string` en la entrada y `string` en la salida, las dos veces en **texto plano**: el criptograma no cruza nunca la frontera HTTP ni aparece en ninguna interfaz. Es lo mismo que hacen F04, F05 y F07.

El update usa `Partial<CreateInvestigationClinicalEvaluationInput>`. **No se declara `UpdateInvestigationClinicalEvaluationInput`.** `investigationId` aparece en el `Partial` por construcción del tipo, pero **el servicio lo ignora siempre** en el `004`.

Los tres pares bandera/explicación se declaran como una constante local del servicio, para que la regla se aplique parametrizada en vez de escrita tres veces:

```ts
const FLAG_EXPLANATION_PAIRS = [
    { flag: 'sourceOther',               explanation: 'otherDescription',            key: 'OTHER_DESCRIPTION' },
    { flag: 'suspectedChildAbuse',       explanation: 'childAbuseExplanation',       key: 'CHILD_ABUSE_EXPLANATION' },
    { flag: 'suspectedDomesticViolence', explanation: 'domesticViolenceExplanation', key: 'DOMESTIC_VIOLENCE_EXPLANATION' },
] as const;
```

**No va a `src/constants/investigation.constants.ts`**: solo lo consume este servicio, igual que F27 y F32 mantuvieron locales sus códigos de catálogo.

### 3.4 Superficie HTTP

```
POST   /api/investigation-clinical-evaluations                ESAVI-INVCLIEV-001   USER        (nuevo)
GET    /api/investigation-clinical-evaluations                ESAVI-INVCLIEV-002A  USER        (nuevo)
GET    /api/investigation-clinical-evaluations/admin          ESAVI-INVCLIEV-002B  ADMIN       (nuevo)
DELETE /api/investigation-clinical-evaluations/purge/:id      ESAVI-INVCLIEV-005C  SUPERADMIN  (nuevo)
GET    /api/investigation-clinical-evaluations/case/:caseId   ESAVI-INVCLIEV-006   USER        (nuevo)
GET    /api/investigation-clinical-evaluations/:id            ESAVI-INVCLIEV-003   USER        (nuevo)
PUT    /api/investigation-clinical-evaluations/:id            ESAVI-INVCLIEV-004   USER        (nuevo)
```

**Siete rutas, y `:id` es el `investigationId`.** No hay identificador propio que exponer: la clave primaria de la fila es la de su investigación, y el `003` es por tanto ya el acceso por investigación.

Orden de declaración en `src/routes/investigationClinicalEvaluation.routes.ts`: las rutas con prefijo literal (`/admin`, `/purge/:id`, `/case/:caseId`) van **antes** de `/:id`, o Express capturará `admin`, `purge` y `case` como un `:id` y el validador de UUID responderá 400.

`001` y `004` en **USER** se apartan de la matriz canónica de §9, que pediría ADMIN. Es la desviación de F05, F06, F07, F09, F10, F13, F14, F28, F29, F30, F31, F32 y F33, y por la misma razón: el detalle se captura en el mismo flujo operativo que el caso. `005C` se queda en SUPERADMIN.

**No hay `005A` ni `005B`.** Sin `isActive` no hay estado propio que activar. Retirar una evaluación clínica es retirar su investigación.

`006` es la única operación no canónica y se registra en la tabla de §6 de `CONVENTIONS.md` como **`investigationClinicalEvaluation` · `006` · obtener la evaluación clínica de un caso — la cadena `caso → investigación → evaluación` es uno a uno en los dos saltos**.

**La abreviatura es `INVCLIEV`.** Ocho letras, no colisiona con las treinta y cuatro registradas y `grep "ESAVI-INVCLIEV-"` no se cruza con `ESAVI-INVESTGN-`, `ESAVI-INVSRC-`, `ESAVI-INVAUT-`, `ESAVI-INVTEAM-`, `ESAVI-INVMEDH-` ni `ESAVI-INVPREG-`.

### 3.5 Reglas de negocio por operación

#### El estado resultante — se calcula una vez, antes de todo

La regla de los tres pares mira el **estado resultante**, no el body. En el `004` eso significa combinar lo que viaja con lo guardado, y se hace igual para los tres:

```
resultingFlag = data[flag] !== undefined ? (data[flag] ?? null) : stored[flag]
resultingExplanation = data[explanation] !== undefined ? (data[explanation] ?? null) : stored[explanation]
```

En el `001` no hay `stored`: el resultante es lo que llegue en el body, o `null` si no llega.

**Lo emite el servicio, no el validador.** El validador no puede ver la fila guardada, y una regla que depende del estado resultante no cabe en `express-validator`. Va **antes** del diff y con independencia de él.

**La comparación es siempre `=== true`.** Sobre un `boolean` anulable el «no» tiene tres formas —`false`, `null` y ausente—, y las tres cuentan igual: **el par está cerrado**.

**Los tres pares se evalúan de forma independiente**, en el orden en que están declarados en `FLAG_EXPLANATION_PAIRS`. El primero que infrinja corta y devuelve su error; los siguientes no se evalúan. Un body que rompe dos pares a la vez recibe **un** 400, el del primero.

#### Reparto entre validador y servicio

| Comprobación | Dónde | Respuesta |
|---|---|---|
| `investigationId` presente y UUID (`001`) | validador | 400 `common.validationError` |
| `receivedMedicalAttention` dentro de `ANSWER_OPTIONS`, admitiendo `null` | validador | 400 `common.validationError` |
| Las seis banderas booleanas, admitiendo `null` | validador | 400 `common.validationError` |
| Los siete textos como cadena | validador | 400 `common.validationError` |
| Bandera resultante `true` con explicación resultante vacía | **servicio** | 400 `INVCLIEV_<op>_<PAR>_REQUIRED` |
| Explicación con contenido y bandera resultante no `true` | **servicio** | 400 `INVCLIEV_<op>_<PAR>_NOT_ALLOWED` |

**El DDL no aporta ningún `CHECK`**, así que no hay ningún rango que replicar en el validador. Es la diferencia con F32, que tenía dos.

#### La regla de los tres pares

Idéntica en los tres, y calcada de F29:

**Con la bandera resultante `true`** — igual en las dos operaciones. La explicación resultante debe existir y no quedar vacía tras `.trim()`, venga en el body o esté ya guardada → si no, **400** `INVCLIEV_<op>_<PAR>_REQUIRED`. Un `PUT` que manda solo `suspectedChildAbuse: true` sobre una fila que ya tiene explicación guardada es **válido**: el estado resultante es coherente.

**Con la bandera resultante distinta de `true`**, las dos operaciones se separan:

- **`001` — es 400.** Mandar la explicación con contenido junto a una bandera no verdadera es `INVCLIEV_001_<PAR>_NOT_ALLOWED`. En el alta no hay estado heredado que limpiar: todo lo que llega, llega en el body, y aceptar en silencio un dato que nunca se guardará devolvería 201 mintiendo.
- **`004` — depende de si el cliente la manda.** Si la explicación **no viaja en el body**, se **fuerza a `null`**: apagar la bandera limpia su explicación sin pedir permiso ni devolver error. Si **viaja con contenido**, sigue siendo 400 `INVCLIEV_004_<PAR>_NOT_ALLOWED`: un body que niega la sospecha y a la vez la explica se contradice a sí mismo, y tragárselo perdería el dato en silencio haciendo creer al cliente que se guardó. Mandarla en `null` o en cadena vacía **no** es error: es el mismo destino al que el forzado llega solo.

**El forzado a `null` es un derivado condicional, no una limpieza posterior:** la explicación entra en `candidates` **siempre** que su bandera resultante no sea `true`, sin `if` de presencia, y es `buildDifferentialUpdate` quien decide si difiere. Si la fila ya la tenía en `null`, el diff no encuentra nada y **no se escribe**: apagar una sospecha ya apagada no crece `appDetails`.

**Las otras tres fuentes no arrastran nada.** `sourceExam`, `sourceDocuments` y `sourceVerbalAutopsy` se guardan con cualquier valor y sin explicación asociada. **Y `receivedMedicalAttention` no gobierna nada**: se valida la forma, se guarda el valor y ahí termina su papel.

#### El campo cifrado

`clinicalDetailsPersonName` es el único, y su recorrido es el mismo en `001` y en `004`:

1. **Entrada:** `.trim()` y `toTitleCase`, en ese orden. Sin la normalización, `"juan"` y `"Juan"` producirían criptogramas distintos y el diff inventaría una diferencia en cada apertura del formulario. Es lo que F05 hace con `firstName`.
2. **Comparación:** sobre **texto plano**. `stored.clinicalDetailsPersonName` se descifra con `esaviDecrypt` **antes** de entrar en `buildDifferentialUpdate`, y solo cuando no es `null` —`esaviDecrypt` no recibe nunca un `null`—.
3. **Escritura:** `esaviCrypt` se aplica **después** del diff, sobre el valor que el helper devolvió en `objectToUpdate`, y solo si el campo está ahí y no es `null`. Un `null` se escribe como `null`, no como el cifrado de la cadena vacía.
4. **Salida:** `esaviDecrypt` en las cinco operaciones que devuelven la fila, listados incluidos.

**Comparar criptogramas funcionaría hoy y se rompería en silencio mañana.** `esaviCrypt` es determinista solo mientras el IV sea fijo; atar el diff a esa propiedad acopla dos decisiones que no tienen por qué viajar juntas. Es el punto que `CONVENTIONS.md` §11 declara explícitamente.

**No hay ninguna comprobación de unicidad sobre el campo cifrado.** El DDL no declara `UNIQUE` sobre `clinicalDetailsPersonName`, y dos investigaciones distintas pueden nombrar a la misma persona.

#### Visibilidad heredada — compartida por `003`, `004`, `006` y los dos listados

Toda lectura incluye `investigation` con `required: true` y `where: includeInactive ? {} : { isActive: true }`. Una evaluación cuya investigación está inactiva responde **404** para USER y ADMIN, y **200** para SUPERADMIN, vía `canViewInactive(req.user)` (`src/helpers/permissions.helper.ts:24-26`). La tabla no tiene estado propio que consultar: el de su padre es el único que hay.

#### Por operación

**`ESAVI-INVCLIEV-001` — crear.** En este orden:

1. La investigación existe y está `isActive: true` → 404 `INVCLIEV_001_INVESTIGATION_NOT_FOUND`. Una investigación retirada no recibe evaluación nueva.
2. Esa investigación **no tiene ya evaluación**, buscando **sin filtrar por `deletedAt`** → 409 `INVCLIEV_001_ALREADY_EXISTS`. La clave primaria no libera el hueco con el sellado lógico, así que una fila sellada **sigue ocupando** el `investigationId`. El mensaje lleva `{{investigationId}}`.
3. La regla de los tres pares, en su variante estricta.
4. Normaliza: `.trim()` sobre los siete textos, `toTitleCase` sobre `clinicalDetailsPersonName` y `esaviCrypt` sobre el resultado. No hay `code` ni `name`, así que no aplica `toConstantCase`.
5. Inserta con la entrada de auditoría `method: 'ESAVI-INVCLIEV-001'`.

**El alta mínima es `{ investigationId }`** y devuelve 201 con las dieciséis columnas de datos en `null`.

**`ESAVI-INVCLIEV-002A` — listar, público.** `findAndCountAll` con el include de la investigación en `required: true` y `where: { isActive: true }`, orden `[['createdAt', 'DESC']]`, paginación con `DEFAULT_LIMIT`/`DEFAULT_OFFSET`. Dos filtros opcionales por query, acumulativos con `AND` y por igualdad, los dos UUID:

- `investigationId` → sobre la propia PK.
- `caseId` → sobre el `where` del include de la investigación, que ya viaja en la consulta.

Un filtro con un UUID que no existe devuelve **200** con `{ count: 0, rows: [] }`, no 404. Devuelve la forma completa de §3.7, con `clinicalDetailsPersonName` **descifrado fila por fila**.

**El orden es `createdAt DESC`**, como en F29 y F32. Esta entidad no tiene ninguna fecha del dominio que ordene mejor, y **ordenar por `clinicalDetailsPersonName` es imposible**: `ORDER BY` sobre una columna cifrada ordena por el criptograma. Es la misma limitación que F05 declaró para `patient`.

**`ESAVI-INVCLIEV-002B` — listar, admin.** Idéntica, con el include del padre en `where: {}`: devuelve también las evaluaciones de investigaciones inactivas. Los mismos dos filtros y el mismo orden.

**`ESAVI-INVCLIEV-003` — obtener por ID.** El `:id` es el `investigationId`. Visibilidad heredada → 404 `INVCLIEV_003_NOT_FOUND`. Forma completa de §3.7 con el campo descifrado.

**`ESAVI-INVCLIEV-006` — obtener por caso.** Entra por el `caseId` y atraviesa los dos saltos uno a uno. Tres 404 distintos, y la diferencia importa para el cliente:

- El caso no existe o está inactivo → 404 `INVCLIEV_006_CASE_NOT_FOUND`.
- El caso existe pero no tiene investigación visible → 404 `INVCLIEV_006_INVESTIGATION_NOT_FOUND`.
- La investigación existe pero no tiene evaluación → 404 `INVCLIEV_006_NOT_FOUND`.

Devuelve **el objeto**, no `{ count, rows }`: la cadena es uno a uno en los dos saltos.

**`ESAVI-INVCLIEV-004` — actualizar.** En este orden:

1. Existencia con visibilidad heredada → 404 `INVCLIEV_004_NOT_FOUND`.
2. `investigationId` **se ignora siempre**, venga o no en el body. Una evaluación no se traslada entre investigaciones.
3. Cálculo del estado resultante de los tres pares y su regla. **Antes del diff y con independencia de él.**
4. `stored` sale de `evaluation.get({ plain: true })` — la fila completa, sin `attributes` acotados: con atributos recortados un campo ausente vale `undefined` y toda comparación contra él da «cambió». **`stored.clinicalDetailsPersonName` se descifra con `esaviDecrypt` antes del diff**, salvo que sea `null`.
5. Diff con `buildDifferentialUpdate`. Si vuelve vacío, se devuelve la fila **sin escribir**: ni `UPDATE`, ni `updatedAt`, ni entrada en `appDetails`, ni evento en `sysDetails`.
6. Si `objectToUpdate` trae `clinicalDetailsPersonName` con contenido, se cifra con `esaviCrypt` **ahora**, después del diff.
7. Escribe `updatedAt` explícitamente —no hay trigger que lo haga— y preserva el historial con `[...currentAppDetails, newEntry]`.

Tabla de `candidates`, campo por campo:

| Campo | Cómo entra en `candidates` | Nota |
|---|---|---|
| `investigationId` | **no entra** | inmutable: se ignora en silencio, sin 400 |
| `receivedMedicalAttention` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. No gobierna nada |
| `sourceExam` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. Fuente plana |
| `sourceDocuments` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. Fuente plana |
| `sourceVerbalAutopsy` | `data.x !== undefined ? (data.x ?? null) : undefined` | anulable. Fuente plana |
| `sourceOther` | `data.x !== undefined ? (data.x ?? null) : undefined` | **bandera del par 1: decide, no es decidida** |
| `otherDescription` | con bandera resultante `true`: `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` — si no: **siempre `null`** | **derivado condicional** |
| `suspectedChildAbuse` | `data.x !== undefined ? (data.x ?? null) : undefined` | bandera del par 2 |
| `childAbuseExplanation` | ídem que `otherDescription`, contra su propia bandera | derivado condicional |
| `suspectedDomesticViolence` | `data.x !== undefined ? (data.x ?? null) : undefined` | bandera del par 3 |
| `domesticViolenceExplanation` | ídem que `otherDescription`, contra su propia bandera | derivado condicional |
| `clinicalDetailsPersonName` | `data.x !== undefined ? (data.x ? toTitleCase(data.x.trim()) : null) : undefined` | **cifrado**: se compara en claro contra `stored` descifrado; `esaviCrypt` **después** del diff |
| `familyClinicalDetails` | `data.x !== undefined ? (data.x ? data.x.trim() : null) : undefined` | anulable, `.trim()` antes de comparar |
| `completeClinicalSummary` | ídem | anulable, `.trim()` |
| `signsAndSymptoms` | ídem | anulable, `.trim()` |
| `otherSocialBackground` | ídem | anulable, `.trim()` |
| `notes` | ídem | anulable, `.trim()` |

**Ningún campo va bajo un `if( data.x )`.** Sobre las seis banderas booleanas sería directamente destructivo: **`false` es un valor válido** y un `if` de veracidad lo tiraría, dejando el campo sin forma de apagarse. Sobre `receivedMedicalAttention` funcionaría por accidente —las cinco cadenas del ENUM son `truthy`— pero descartaría en silencio el `null` con el que se vacía el campo.

**Las tres banderas son llaves de su par y no forman parte de él.** Entran como anulables corrientes: son los campos que deciden, no los decididos.

**`ESAVI-INVCLIEV-005C` — purgar.** `purgeInvestigationClinicalEvaluationService(id, authUser, lang)` sobre `purgeEntityService` (`src/services/common/entityPurge.service.ts`), con transacción. Existencia con `paranoid: false` y **sin** la visibilidad heredada —quien purga es SUPERADMIN y la fila puede colgar de una investigación retirada— → 404 `INVCLIEV_005C_NOT_FOUND`; guarda de sellado con `assertRowIsSealed(row, 'INVCLIEV_005C_NOT_DELETED', lang)` → 409 si `deletedAt` está vacío; volcado al log en `warn`; `destroy`. Responde `{ ok, message }` sin `data`. No escribe `appDetails` —la fila desaparece en la misma transacción—, y eso es lo correcto según `CONVENTIONS.md` §6.

**El volcado en `warn` no incluye `clinicalDetailsPersonName`.** Es el único punto del spec donde el criptograma podría acabar en `src/logs/esaviLog.log`, y volcarlo descifrado sería peor. Se registra el `investigationId` y el resto de la fila, y ese campo se omite.

**La guarda de sellado es la única red de seguridad de la tabla.** El control de `isActive` que `purgeEntityService` lleva dentro es **inerte** aquí: la columna no existe, `undefined !== true` deja pasar toda fila, y un `005C` destruiría un registro que nadie retiró nunca. Es la misma situación de F29, F30 y F32. `assertRowIsSealed` se consume **sin modificarlo**: deriva la clave `investigationClinicalEvaluation.notDeleted` del nombre de tabla y el id del `primaryKeyAttribute` del modelo.

**Purgar sí libera el `investigationId`**, y es la única vía que lo hace. Tras un `005C`, un `POST` sobre esa misma investigación devuelve 201. **Y arrastra por `ON DELETE CASCADE` todas las `evaluationInstitution` de esa investigación**, cuando esa tabla exista.

#### Los tres arrastres, ya sobre el servicio común

Sin `isActive`, lo que las cascadas mueven es el sello de `deletedAt`. Los tres son `update` masivos sobre `src/services/common/satelliteCascade.service.ts`, **que este spec consume sin modificar**.

**`ESAVI-INVESTGN-005A` — sellar.** Dentro de la transacción que `setInvestigationActivationService` ya abre y **solo cuando `isActive === false`**, `cascadeSealSatellite` sella la fila de evaluación de esa investigación con `method: 'ESAVI-INVESTGN-005A'` —el código de la operación que la arrastró, no el suyo—. Una investigación sin evaluación sella cero filas y no falla. Una fila ya sellada conserva su `deletedAt` original y **no** recibe entrada nueva.

**`ESAVI-CASE-005A` — sellar también.** En `src/services/esaviCase.service.ts`, junto a las llamadas que F29, F30 y F32 dejaron y en el mismo bloque. Es necesaria y no redundante, por la razón exacta que F29 §3.5 documentó: desactivar el caso arrastra la investigación con un `Investigation.update` masivo que **no** pasa por `setInvestigationActivationService`, así que la cascada del punto anterior nunca dispara desde aquí. Alcanza a las evaluaciones cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`. Registra `method: 'ESAVI-CASE-005A'`.

**`ESAVI-INVESTGN-005B` — limpiar.** `cascadeClearSatellite` devuelve `deletedAt` a `null` al reactivar la investigación. Es una **cascada de subida**, legítima por lo mismo que en F29, F30 y F32: el `deletedAt` de la evaluación no significa «alguien la retiró», significa «su investigación estaba retirada». Registra `method: 'ESAVI-INVESTGN-005B'`. **`ESAVI-CASE-005B` no limpia nada**, coherente con F07, F29, F30 y F32.

**Ninguno de los tres pasa por `buildDifferentialUpdate`, y es deliberado:** son escrituras con intención propia. Registran el hecho de sellar o devolver la fila, y ese registro en `appDetails` es precisamente lo que se quiere conservar.

**Volcado del `ESAVI-INVESTGN-005C`.** El purgado de una investigación arrastra su evaluación por `ON DELETE CASCADE` sin pasar por ningún servicio. Se añade a `purgeInvestigationService` un volcado en nivel `warn` de la fila que va a desaparecer —**sin `clinicalDetailsPersonName`**—, junto a los tres que F29, F30 y F32 dejaron, antes del `destroy` y dentro de la misma transacción. **No se bloquea la purga.**

**Validaciones de forma** (las emite `validateFields` con 400): en el `001`, `investigationId` obligatorio y `.isUUID()`; en los dos, `receivedMedicalAttention` con `.isIn(ANSWER_OPTIONS)` admitiendo `null`, las seis banderas con `.isBoolean()` admitiendo `null`, y los siete textos como cadena. `caseId` con `.isUUID()` en el `param` del `006`; los dos filtros del listado con `.isUUID()`, y `limit` y `offset` con `.isInt()`.

### 3.6 Claves i18n nuevas

Bloque `investigationClinicalEvaluation` en `src/data/i18n/es.json`, `en.json` y `nl.json` — **veintidós claves**:

| Clave | Uso |
|---|---|
| `createdSuccess` / `createdFailed` | `001` |
| `getSuccess` / `getFailed` | `003` y `006` |
| `getSuccessPlural` / `getFailedPlural` | `002A` y `002B` |
| `updatedSuccess` / `updatedFailed` | `004` |
| `purgeSuccess` / `purgeFailed` | `005C` |
| `notFound` | 404 en `003`, `004`, `005C` y `006` |
| `idRequired` | parámetro ausente |
| `notDeleted` | 409 al purgar una fila sin `deletedAt` sellado. La deriva `assertRowIsSealed` del nombre de tabla, y lleva `{{id}}` |
| `investigationNotFound` | 404 cuando la investigación no existe o está inactiva, en `001` y en `006` |
| `alreadyExists` | 409 cuando la investigación ya tiene evaluación, sellada o no. Lleva `{{investigationId}}` |
| `caseNotFound` | 404 cuando el `caseId` del `006` no existe o está inactivo |
| `otherDescriptionRequired` | 400 con `sourceOther` resultante `true` y descripción vacía |
| `otherDescriptionNotAllowed` | 400 al mandar la descripción con contenido junto a un `sourceOther` no verdadero. **En el `001` siempre; en el `004` solo cuando la descripción viaja en el body** |
| `childAbuseExplanationRequired` | 400 con `suspectedChildAbuse` resultante `true` y explicación vacía |
| `childAbuseExplanationNotAllowed` | ídem que `otherDescriptionNotAllowed`, contra su propia bandera |
| `domesticViolenceExplanationRequired` | 400 con `suspectedDomesticViolence` resultante `true` y explicación vacía |
| `domesticViolenceExplanationNotAllowed` | ídem, contra su propia bandera |

**Seis claves para los tres pares, y no dos con `{{field}}` interpolado.** F32 hizo lo contrario —una sola clave para los nueve campos de su bloque de embarazo— y ahí era lo correcto: nueve campos homogéneos del mismo bloque. Aquí los tres pares son **conceptos distintos** y el mensaje que el usuario necesita leer también lo es: «describe la otra fuente» no es intercambiable con «explica la sospecha de maltrato infantil». Interpolar el nombre técnico de la columna dejaría al cliente construyendo la frase. Los tres nombres de `otherDescription*` heredan además la nomenclatura literal de F29, que ya los tiene en los tres archivos para `investigationSource`.

**Ninguna clave menciona el cifrado.** `clinicalDetailsPersonName` no produce ningún error propio: no tiene unicidad que comprobar, ni catálogo contra el que validar, ni longitud que respetar.

**Ninguna clave para las validaciones de forma:** las emite el validador y las responde `validateFields` con `common.validationError`, como toda validación de forma del repositorio.

**No hay `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`**: no existen las operaciones que las usarían. `tests/i18n/messages.test.ts` exige paridad exacta en los tres archivos. No se añade ninguna clave a los bloques `investigation` ni `esaviCase`: los tres arrastres no producen mensajes propios.

### 3.7 Forma de la respuesta

**Completa** — `001`, `003`, `004`, `006` y **también las filas de `002A` y `002B`**:

```
{ ok, message, data: {
    investigationId,
    receivedMedicalAttention,
    sourceExam, sourceDocuments, sourceVerbalAutopsy, sourceOther, otherDescription,
    suspectedChildAbuse, childAbuseExplanation,
    suspectedDomesticViolence, domesticViolenceExplanation,
    clinicalDetailsPersonName,
    familyClinicalDetails, completeClinicalSummary, signsAndSymptoms,
    otherSocialBackground, notes,
    createdAt, updatedAt, deletedAt, appDetails,
    investigation: {
        investigationId, isActive, investigationStartDate,
        status: { catalogItemId, code, name },
        case:   { caseId, caseCode, eventDate }
    }
} }
```

**No hay forma reducida.** El listado devuelve la misma ficha que el `003`, por la misma razón que en F29, F30 y F32: dieciséis columnas de datos, y recortarlas dejaría un listado sin contenido.

**`clinicalDetailsPersonName` llega descifrado con `esaviDecrypt` en las cinco operaciones que devuelven la fila, listados incluidos.** El criptograma no cruza nunca la frontera HTTP. En los listados se descifra **fila por fila** al construir la respuesta; es el mismo coste que F05 asume en `patient`.

**`receivedMedicalAttention` se devuelve exactamente como se guardó, `null` incluido**: un `null` significa que el formulario no recogió la respuesta y un `'NO_ANSWER'` que se preguntó y no se contestó.

**Las seis banderas se devuelven en `true`, `false` o `null`, sin colapsar.** `false` («se comprobó y no») y `null` («no se comprobó») son datos distintos, y ninguna respuesta convierte uno en el otro.

**No hay ningún objeto de catálogo resuelto.** La entidad no tiene FK a `catalogItem`, así que el único `include` es el del padre.

**No se devuelve `isActive`**, porque la tabla no tiene esa columna. `deletedAt` es la única marca de estado que la fila lleva, e `investigation.isActive` es la fuente real de su visibilidad.

El include de la investigación es **obligatorio y no decorativo**: es lo que implementa la visibilidad heredada. Su `status` viaja resuelto y **nunca llega `null`**, por la regla que el F28 §3.5 impuso a aquella entidad. `sysDetails` **nunca** se devuelve, ni el de la evaluación ni el de la investigación. Ninguna respuesta incluye datos de las otras doce tablas satélite, ni de `evaluationInstitution` cuando exista.

---

## 4. Plan de implementación

**Precondiciones.** El **SPEC F28** debe estar `Implementado` —la PK de esta tabla es su FK— y el **SPEC F32** también: `src/services/common/satelliteCascade.service.ts` nace allí y los pasos 10 y 11 lo consumen sin modificarlo. `CRYPTO_KEY` debe estar configurada en el entorno antes de poder ejercitar el campo cifrado.

Cada paso deja el sistema compilando y arrancable, y puede committearse solo.

1. **Modelo, asociaciones y tipos.** `src/models/investigationClinicalEvaluation.model.ts` con la PK **sin `defaultValue`**, `receivedMedicalAttention` en `ENUM(...ANSWER_OPTIONS)`, las seis banderas en `BOOLEAN`, los siete textos en `TEXT`, el comentario de dos líneas sobre `clinicalDetailsPersonName` y **sin atributo `isActive`**; `src/models/associations/investigationClinicalEvaluation.associations.ts` con el `belongsTo` a `Investigation` como `investigation` y el inverso `Investigation.hasOne(..., { as: 'clinicalEvaluation' })`, registrado en `initModels()`; `src/types/investigation/investigationClinicalEvaluation.types.ts` con `CreateInvestigationClinicalEvaluationInput`, exportado por el `index.ts` de barrel del dominio. Alta en `src/models/index.ts`.
   *Verificación:* `npm run build` en 0; un `findAll` con el include del padre desde un script suelto devuelve filas sin error de alias, y `clinicalEvaluation` no colisiona con `source`, `autopsy`, `teamMembers` ni `medicalHistory`; `npm test` sigue en verde, porque el `hasOne` nuevo no se incluye en ninguna respuesta de `investigation`.

2. **Claves i18n.** El bloque `investigationClinicalEvaluation` completo de §3.6 en `es.json`, `en.json` y `nl.json`, con las **veintidós** claves. **Sin `activatedSuccess`, `deletedSuccess`, `alreadyActive` ni `alreadyInactive`.**
   *Verificación:* `npm run i18n:check` en 0 y `npm test -- messages` pasa; `investigationClinicalEvaluation.notDeleted` existe en los tres archivos, que es lo que `assertRowIsSealed` resolverá en tiempo de ejecución sin que ningún `grep` estático lo vea; las seis claves de los tres pares están en los tres idiomas y ninguna es copia literal de otra.

3. **Validadores.** `src/validators/investigationClinicalEvaluation.validator.ts` con cinco arrays: `investigationClinicalEvaluationIdValidator`, `investigationClinicalEvaluationCaseIdValidator` (para el `param('caseId')` del `006`), `investigationClinicalEvaluationListValidator` (los dos filtros más `limit` y `offset`), `createInvestigationClinicalEvaluationValidator` y `updateInvestigationClinicalEvaluationValidator`. El de create exige `investigationId` UUID; los dos comparten `receivedMedicalAttention` con `.isIn(ANSWER_OPTIONS)` admitiendo `null`, las seis banderas con `.isBoolean()` admitiendo `null` y los siete textos como cadena. **La regla de los tres pares no va aquí:** depende del estado guardado y vive en el servicio. Alta en `src/validators/index.ts`.
   *Verificación:* `npm run build` en 0; `receivedMedicalAttention: 'MAYBE'` produce 400 y los cinco valores de `ANSWER_OPTIONS` no; `receivedMedicalAttention: null` pasa; `sourceExam: 'sí'` produce 400 y `false` no; `suspectedChildAbuse: null` pasa; un body con los tres pares incoherentes **no** produce 400 en esta capa — lo hará el servicio en el paso 4.

4. **`ESAVI-INVCLIEV-001` — crear.** `createInvestigationClinicalEvaluationService` con los cinco pasos de §3.5 en ese orden: investigación existente y activa, unicidad del `investigationId` sin filtrar por `deletedAt`, la regla de los tres pares en su variante estricta, normalización —`.trim()` de los siete textos, `toTitleCase` y `esaviCrypt` sobre `clinicalDetailsPersonName`—, inserción con auditoría. La regla se aplica recorriendo `FLAG_EXPLANATION_PAIRS`, **no escrita tres veces**. Controlador y ruta `POST /` con `validateUserRole(USER)`.
   *Verificación:* el alta mínima `{ investigationId }` devuelve **201** con las dieciséis columnas en `null`; crear dos veces sobre la misma investigación devuelve **409** `INVCLIEV_001_ALREADY_EXISTS` con el `investigationId` interpolado; una investigación inactiva devuelve **404**; `{ sourceOther: true }` sin descripción devuelve **400** `otherDescriptionRequired`; `{ sourceOther: false, otherDescription: "x" }` devuelve **400** `otherDescriptionNotAllowed`; lo mismo para los otros dos pares con sus claves propias; un body que rompe dos pares a la vez devuelve **un** 400, el del primero declarado; `{ sourceExam: false }` guarda `false` y no `null`; `clinicalDetailsPersonName: "  juan carlos  "` guarda el **cifrado** de `Juan Carlos` —comprobado leyendo la columna directamente— y la respuesta devuelve `Juan Carlos` en claro.

5. **`ESAVI-INVCLIEV-002A` y `002B` — listados.** Dos servicios con `findAndCountAll`, el include de la investigación en `required: true` con su `status` y su `case`, los dos filtros acumulativos, orden `[['createdAt','DESC']]`, paginación y la forma completa de §3.7 con el campo descifrado fila por fila. Dos rutas: `GET /` en USER y `GET /admin` en ADMIN.
   *Verificación:* `/` no devuelve evaluaciones de investigaciones inactivas y `/admin` sí; un USER recibe 403 en `/admin`; `?caseId=` de un UUID inexistente devuelve **200** con `count: 0`; los dos filtros combinados se aplican con `AND`; toda fila trae las dieciséis columnas y `appDetails`; ninguna trae `isActive` ni `sysDetails`; `?limit=2` devuelve dos filas con el `count` total; **ninguna fila del listado devuelve un criptograma** en `clinicalDetailsPersonName`.

6. **`ESAVI-INVCLIEV-003` — obtener por ID.** `getInvestigationClinicalEvaluationByIdService(id, lang, includeInactive)` donde el `id` es el `investigationId`, con el include del padre y la forma completa; controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de todas las literales.
   *Verificación:* un ID inexistente devuelve 404; una fila cuya investigación está inactiva devuelve 404 para USER y ADMIN, y 200 para SUPERADMIN; una fila con `deletedAt` sellado pero investigación activa **sí se devuelve** —el sello no oculta la fila, la oculta el padre—; `investigation.status` no llega `null`; `clinicalDetailsPersonName` llega descifrado; `sysDetails` no aparece en ninguno de los tres objetos de la respuesta.

7. **`ESAVI-INVCLIEV-006` — obtener por caso.** `getInvestigationClinicalEvaluationByCaseIdService(caseId, lang, includeInactive)` con los **tres** 404 distintos de §3.5, devolviendo **el objeto** y no `{ count, rows }`. Ruta `GET /case/:caseId` en USER, con `investigationClinicalEvaluationCaseIdValidator`, declarada antes de `/:id`. Fila `investigationClinicalEvaluation` · `006` en la tabla de operaciones no canónicas de `CONVENTIONS.md` §6.
   *Verificación:* un caso con investigación y evaluación devuelve 200 con la ficha completa, no envuelta en un array; un `caseId` inexistente devuelve 404 `INVCLIEV_006_CASE_NOT_FOUND`; un caso sin investigación devuelve 404 `INVCLIEV_006_INVESTIGATION_NOT_FOUND`; una investigación sin evaluación devuelve 404 `INVCLIEV_006_NOT_FOUND`. Los tres códigos son distintos entre sí; `GET /case/no-es-uuid` devuelve 400.

8. **`ESAVI-INVCLIEV-004` — actualizar, diferencial.** `updateInvestigationClinicalEvaluationService` con los siete pasos de §3.5 y la tabla de `candidates` completa, sobre `buildDifferentialUpdate`. `investigationId` ignorado; las tres banderas y los campos sueltos como anulables corrientes; las tres explicaciones como **derivados condicionales** contra su propia bandera resultante; `clinicalDetailsPersonName` comparado en claro con `esaviDecrypt` sobre `stored` y `esaviCrypt` aplicado **después** del diff. La lectura para el diff se hace **sin `attributes` acotados** y con el include del padre, para que la visibilidad heredada se compruebe en la misma consulta de la que sale la instancia. Corte temprano cuando el diff vuelve vacío. Ruta `PUT /:id` en USER.
   *Verificación:* un `PUT` que reenvía íntegra la respuesta de su `GET` devuelve **200** sin crecer `appDetails`, sin mover `updatedAt` y sin avanzar `sysDetails.version`; un `PUT` con `{}` se comporta igual; un `PUT` que solo cambia `notes` añade **una** entrada y avanza la versión en 1; **`{ sourceExam: false }` sobre una fila con `true` se guarda como `false`** y no se descarta; `{ sourceExam: null }` vacía el campo; enviar `investigationId` distinto no lo modifica y no devuelve error; `{ suspectedChildAbuse: true }` sobre una fila con explicación guardada devuelve 200; `{ suspectedChildAbuse: false }` sobre esa fila deja `childAbuseExplanation` en `null` en la **misma** petición con **una** entrada en `appDetails`; `{ suspectedChildAbuse: false, childAbuseExplanation: "x" }` devuelve **400**; `{ suspectedChildAbuse: false }` sobre una fila que ya la tenía apagada y sin explicación **no escribe nada**; **un `PUT` que reenvía el `clinicalDetailsPersonName` que devolvió el `GET` deja la columna cifrada idéntica byte a byte**; `{ clinicalDetailsPersonName: "juan carlos" }` sobre una fila con `Juan Carlos` guardado **no cuenta como cambio**.

9. **`ESAVI-INVCLIEV-005C` — purgar.** `purgeInvestigationClinicalEvaluationService` sobre `purgeEntityService`, con transacción propia, existencia con `paranoid: false` y **sin** visibilidad heredada, y `assertRowIsSealed(row, 'INVCLIEV_005C_NOT_DELETED', lang)` **antes** del `destroy`. Volcado en `warn` **omitiendo `clinicalDetailsPersonName`**. Controlador y ruta `DELETE /purge/:id` en SUPERADMIN, reutilizando `investigationClinicalEvaluationIdValidator` y declarada junto a las otras literales.
   *Verificación:* purgar una fila sin `deletedAt` sellado devuelve 409 `notDeleted` con el id interpolado y la fila sigue ahí — **es la comprobación que prueba que el control de `isActive` de `purgeEntityService` es inerte aquí**; desactivar la investigación y purgar devuelve 200 sin `data`, y `findByPk(id, { paranoid: false })` devuelve `null`; repetir devuelve 404; un ADMIN recibe 403; **tras purgar, un `POST` sobre esa investigación devuelve 201**; la investigación y sus otras satélites siguen existiendo e intactas; **`grep -i "clinicalDetailsPersonName" src/logs/esaviLog.log` no devuelve resultados** tras ejercitar la purga.

10. **Los dos arrastres desde `investigation` y el volcado del `005C`.** En `src/services/investigation.service.ts`, dos llamadas nuevas al servicio común desde `setInvestigationActivationService`: `cascadeSealSatellite` con `InvestigationClinicalEvaluation` y `method: 'ESAVI-INVESTGN-005A'` **solo cuando `isActive === false`**, y `cascadeClearSatellite` con `'ESAVI-INVESTGN-005B'` **solo cuando `isActive === true`**, las dos dentro de la transacción que aquel servicio ya abre y junto a las de F29, F30 y F32. Más el volcado en `warn` de la fila en `purgeInvestigationService`, antes del `destroy` y en la misma transacción. **`satelliteCascade.service.ts` no se toca.**
    *Verificación:* desactivar una investigación con evaluación le sella `deletedAt`; reactivarla lo devuelve a `null`; una fila sellada a mano **antes** de la cascada conserva su `deletedAt` original y no recibe entrada nueva en `appDetails`; una investigación sin evaluación se desactiva y se reactiva sin error; el `appDetails` de la arrastrada registra `ESAVI-INVESTGN-005A` y luego `ESAVI-INVESTGN-005B`, con su historial anterior intacto; **los arrastres de las tres satélites anteriores siguen funcionando igual** y las cuatro filas se sellan en la misma transacción; purgar una investigación con las cuatro deja **cuatro** líneas `warn` en `src/logs/esaviLog.log` y **no** devuelve error; `git diff src/services/common/satelliteCascade.service.ts` está vacío.

11. **El tercer arrastre, desde `esaviCase`.** En `src/services/esaviCase.service.ts`, una llamada más junto a las que F29, F30 y F32 dejaron, invocada en el mismo bloque, dentro de la misma transacción y **solo cuando `isActive === false`**, sobre el servicio común. Alcanza a las evaluaciones cuya investigación pertenece al caso, resuelto por subconsulta sobre `investigation`, y registra `method: 'ESAVI-CASE-005A'`. Va después del paso 10 porque depende del modelo y no lo necesita ningún paso anterior. **`ESAVI-CASE-005B` no se toca.**
    *Verificación:* desactivar un caso con investigación y evaluación **sella la evaluación**, y ése es el punto entero del paso: sin él quedaría sin sellar, porque la investigación la arrastra un `update` masivo que no pasa por `setInvestigationActivationService`; reactivar el caso no limpia el sello; un caso sin investigación, o con investigación sin evaluación, se desactiva sin error; las cascadas anteriores siguen produciendo el mismo efecto.

12. **Registrar la entidad en las convenciones.** Fila `investigationClinicalEvaluation` → `INVCLIEV` en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y fila `investigationClinicalEvaluation` · `006` · «obtener la evaluación clínica de un caso — la cadena `caso → investigación → evaluación` es uno a uno en los dos saltos» en la tabla de operaciones no canónicas.
    *Verificación:* `INVCLIEV` aparece una sola vez y no colisiona con las registradas; la tabla de no canónicas suma exactamente una fila.

13. **Cubrir las siete rutas en `tests/auth/roles.test.ts`.** Siete filas nuevas en `ROUTE_RULES` con su `minRole` y su código, ajustando el total esperado al que deje el conteo actual más siete.
    *Verificación:* `npm test -- roles` pasa.

14. **Suite de contrato `tests/contract/investigationClinicalEvaluation.test.ts`.** Recorrido completo con `supertest`: crear vacío → obtener por ID → obtener por caso → listar público y admin con cada filtro → actualizar → purgar. Más los caminos de error: investigación inexistente (404), investigación inactiva (404), investigación ya con evaluación sellada y sin sellar (409 las dos), caso inexistente y caso sin investigación en el `006` (404 con códigos distintos), **los tres pares en sus seis variantes** —obligatorio y prohibido, en `001` y en `004`—, y purgar sin sellar (409). Más el bloque diferencial completo de §5, con cobertura explícita del **`false`** en las banderas y del **campo cifrado idéntico byte a byte** tras un `PUT` que lo reenvía.
    *Verificación:* `npm test -- investigationClinicalEvaluation` en verde.

15. **Ampliar `tests/contract/investigation.test.ts` y `tests/contract/esaviCase.test.ts`.** En la primera, tres casos: desactivar la investigación sella su evaluación, reactivarla la limpia, y purgar la investigación la destruye por cascada de Postgres sin devolver error. En la segunda, dos: desactivar el caso sella la evaluación de su investigación, y reactivarlo no la limpia. **Los casos que F29, F30 y F32 añadieron a las dos suites se mantienen intactos**, y los nuevos comprueban que las cuatro satélites se arrastran juntas por el mismo servicio común.
    *Verificación:* `npm test` en verde; ninguna de las suites anteriores pierde un caso.

---

## 5. Criterios de aceptación

**Superficie y convenciones**

- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden en las seis operaciones que escriben o leen con auditoría. En `005C` son cuatro: no hay `appDetails.method`, y eso es correcto según `CONVENTIONS.md` §6.
- [ ] `grep -rn "ESAVI-INVCLIEV-002[^AB]" src/` no devuelve resultados: todo listado es `002A` o `002B`.
- [ ] `grep -rn "ESAVI-INVCLIEV-005[AB]" src/` no devuelve resultados: la entidad **no tiene** activación ni desactivación propias.
- [ ] `grep -rn "ESAVI-INVCLIEV-00[7-9]" src/` no devuelve resultados: la única operación no canónica es `006`.
- [ ] `grep -rn "isActive" src/models/investigationClinicalEvaluation.model.ts` no devuelve resultados: la tabla no tiene esa columna.
- [ ] El modelo importa `ANSWER_OPTIONS` de `src/constants/enums.constants.ts` y **no declara ninguna lista de valores propia**.
- [ ] `INVCLIEV` aparece en la tabla de abreviaturas de `references/CONVENTIONS.md` §6, y la fila `investigationClinicalEvaluation` · `006` en la de operaciones no canónicas.
- [ ] Existen los siete artefactos y `src/types/investigation/index.ts` exporta el archivo nuevo.
- [ ] `GET /api/investigation-clinical-evaluations/admin` y `.../case/:caseId` no responden 400 por validación de UUID: las literales se declaran antes de `/:id`.
- [ ] `Investigation.hasOne(InvestigationClinicalEvaluation, { as: 'clinicalEvaluation' })` está declarado, no colisiona con `source`, `autopsy`, `teamMembers` ni `medicalHistory`, y la evaluación **no** aparece en ninguna respuesta de `/api/investigations`.
- [ ] `git diff esaviapp.sql` está vacío.

**El campo cifrado**

- [ ] Crear con `clinicalDetailsPersonName: "  juan carlos  "` guarda en la columna el **cifrado de `Juan Carlos`**, comprobado leyendo la fila sin pasar por el servicio.
- [ ] Ninguna respuesta HTTP devuelve un criptograma: ni el `003`, ni el `004`, ni el `001`, ni el `006`, ni ninguna fila de los dos listados.
- [ ] `grep -rn "clinicalDetailsPersonName" src/services/investigationClinicalEvaluation.service.ts` muestra el campo pasando por `toTitleCase`, por `esaviCrypt` **después** del diff y por `esaviDecrypt` antes de él y al construir la respuesta. **En ningún punto se compara ciphertext contra ciphertext.**
- [ ] `grep -i "clinicalDetailsPersonName" src/logs/esaviLog.log` no devuelve resultados tras ejercitar el `005C` y la purga de la investigación.
- [ ] Ningún filtro, ningún `ORDER BY` y ninguna búsqueda del servicio mencionan `clinicalDetailsPersonName`.

**Los tres pares bandera/explicación**

- [ ] `POST` con `{ sourceOther: true }` y sin descripción → **400** `otherDescriptionRequired`. Igual para `suspectedChildAbuse` y `suspectedDomesticViolence` con sus claves propias.
- [ ] `POST` con `{ suspectedChildAbuse: false, childAbuseExplanation: "x" }` → **400** `childAbuseExplanationNotAllowed`. El `001` es estricto.
- [ ] `PUT` con `{ suspectedChildAbuse: false }` sobre una fila con sospecha y explicación → **200**, con `childAbuseExplanation` en `null` en la **misma** petición y **una** sola entrada en `appDetails`. No hay huérfano y no hay error.
- [ ] `PUT` con `{ suspectedChildAbuse: false, childAbuseExplanation: "x" }` → **400**. El forzado silencioso no se traga un body que se contradice a sí mismo.
- [ ] `PUT` con `{ suspectedChildAbuse: false }` sobre una fila que ya la tenía apagada y sin explicación → **200 sin escribir nada**: el `null` forzado entra en `candidates` pero el diff no encuentra diferencia.
- [ ] `PUT` con `{ suspectedDomesticViolence: true }` sobre una fila con explicación ya guardada → **200**. El estado resultante manda, no el body.
- [ ] Un body que rompe **dos** pares a la vez devuelve **un** 400, el del primero declarado en `FLAG_EXPLANATION_PAIRS`.
- [ ] Los tres pares son independientes: apagar `sourceOther` no toca `childAbuseExplanation` ni `domesticViolenceExplanation`.
- [ ] `receivedMedicalAttention` no produce ningún 400 de coherencia en ninguna combinación: `grep -n "receivedMedicalAttention" src/services/investigationClinicalEvaluation.service.ts` no lo muestra dentro de ninguna guarda.

**Update diferencial**

- [ ] Un `PUT` que reenvía íntegra la respuesta de su `GET` responde **200** sin escribir nada: `appDetails` no crece, `sysDetails.version` no avanza y `updatedAt` no se mueve.
- [ ] Un `PUT` con body vacío `{}` se comporta igual que el anterior.
- [ ] Un `PUT` que cambia **un solo** campo añade **una** entrada a `appDetails` y avanza `sysDetails.version` en 1.
- [ ] El servicio usa `buildDifferentialUpdate`; `grep -n "delete objectToUpdate" src/services/investigationClinicalEvaluation.service.ts` no devuelve resultados.
- [ ] Un `PUT` con una FK inactiva responde **404** aunque el resto del body no cambie nada: un `PUT` sobre una fila cuya investigación está inactiva responde **404** para USER y ADMIN y **200** para SUPERADMIN. La entidad no tiene otra FK que ejercitar.
- [ ] **Un `PUT` que reenvía el `clinicalDetailsPersonName` guardado deja la columna cifrada idéntica byte a byte.**
- [ ] **`{ sourceExam: false }` sobre una fila con `true` guarda `false`**, y `{ sourceExam: null }` la vacía. Ningún candidato entra bajo un `if( data.x )`.
- [ ] `{ receivedMedicalAttention: null }` sobre una fila con `'NO_ANSWER'` vacía el campo, y `{ receivedMedicalAttention: 'NO_ANSWER' }` sobre esa misma fila **no** cuenta como cambio: `null` y `'NO_ANSWER'` son datos distintos y ninguno se convierte en el otro.
- [ ] `{ notes: "" }` deja el campo vacío, y un `notes` con espacios alrededor del mismo texto guardado **no** cuenta como cambio: el `.trim()` va antes de comparar.
- [ ] `{ clinicalDetailsPersonName: "juan carlos" }` sobre una fila con `Juan Carlos` guardado **no** cuenta como cambio: el `toTitleCase` va antes de comparar y la comparación es en claro.

**Los tres arrastres**

- [ ] Desactivar una investigación con evaluación le sella `deletedAt`; reactivarla lo devuelve a `null`.
- [ ] Desactivar un caso con investigación y evaluación **sella la evaluación**; reactivar el caso **no** la limpia.
- [ ] El `appDetails` de la fila arrastrada registra su `method` correcto: `ESAVI-INVESTGN-005A`, `ESAVI-INVESTGN-005B` o `ESAVI-CASE-005A`, según la operación que la arrastró.
- [ ] Una fila ya sellada conserva su `deletedAt` original y no recibe entrada nueva.
- [ ] `git diff src/services/common/satelliteCascade.service.ts` está vacío: este spec lo consume, no lo modifica.
- [ ] `tests/contract/investigationSource.test.ts`, `investigationAutopsy.test.ts` e `investigationMedicalHistory.test.ts` pasan **sin que se haya tocado un solo caso**.
- [ ] Desactivar una investigación con las cuatro satélites sin `isActive` las sella **las cuatro** en la misma transacción.

**Cierre**

- [ ] Las veintidós claves nuevas existen en `es`, `en` y `nl`; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.

---

## 6. Decisiones tomadas y descartadas

**Sobre el cifrado**

- **Sí: cifrar `clinicalDetailsPersonName` con `esaviCrypt`. No: dejarlo en claro como hicieron F31 y F07.** Es la decisión más cara de revertir del spec y la que rompe un precedente, así que se razona entera. F31 dejó `fullName`, `email` y `phone` de `investigationTeamMember` en claro con un argumento de dominio: el equipo investigador es personal sanitario **identificado en función pública** dentro de un documento oficial que firma con nombre e institución. `notifier` sigue la misma línea. La frontera que aquellos specs trazaron no es «datos de personas» contra «datos de cosas», sino **identidad publicada** contra **identidad protegida** — y `clinicalDetailsPersonName` cae del otro lado: es alguien que el investigador **menciona** al recoger detalles clínicos, no alguien que firma. No eligió aparecer en el expediente y no ejerce función pública en él. La consecuencia asumida es que dos nombres de persona del mismo expediente de investigación reciben tratamiento distinto, y eso es correcto porque los dos papeles son distintos. Si mañana la política cambia, esto es lo que hay que reabrir, y el coste será una migración de datos, no un cambio de código.
- **No: cifrar los otros seis textos libres.** Se valoró cifrar además `childAbuseExplanation` y `domesticViolenceExplanation` —opción (b)—, y cifrar los siete —opción (c)—. Las dos se descartan por la misma razón: **se cifra la identidad, no el contenido clínico**. Es exactamente donde `appUser` y `patient` ponen el límite, y llevarlo más allá convertiría `completeClinicalSummary` y `signsAndSymptoms` en columnas opacas para siempre —sin búsqueda, sin informes, sin agregación— a cambio de una protección que el control de acceso ya da. La opción (b) es la que más tentadora resulta y la que peor envejece: cifra por sensibilidad percibida, no por criterio, y deja el criterio sin poder aplicarse a la siguiente tabla.
- **Sí: normalizar con `.trim()` y `toTitleCase` antes de cifrar.** Es lo que F05 hace con `firstName`. Sin ese paso, `"juan"` y `"Juan"` producen criptogramas distintos, y un cliente que reenviara el nombre tal como lo escribió el usuario generaría una diferencia inventada en cada apertura del formulario.
- **Sí: comparar en claro, con `esaviDecrypt` sobre `stored` y `esaviCrypt` después del diff. No: comparar criptogramas.** Comparar ciphertext funcionaría hoy —`esaviCrypt` es determinista con IV fijo— y se rompería en silencio el día que ese IV deje de serlo. Es el acoplamiento que `CONVENTIONS.md` §11 declara explícitamente prohibido.
- **No: filtrar, buscar u ordenar por `clinicalDetailsPersonName`.** Sobre un campo cifrado solo cabe la igualdad exacta, y no hay caso de uso que la pida. `ORDER BY` sobre esa columna ordenaría por el criptograma, que es la limitación que F05 ya documentó para los nombres de `patient`.
- **No: volcar `clinicalDetailsPersonName` al log en el `005C`.** Es el único punto del spec donde el dato podría salir de la base, y volcarlo descifrado anularía el cifrado por la puerta de atrás. El volcado registra el `investigationId` y el resto de la fila.

**Sobre los tres pares bandera/explicación**

- **Sí: simetría absoluta con F29, incluido el lado obligatorio.** Con la bandera resultante `true`, la explicación es exigible y su ausencia es 400. Se valoró relajarla —opción (b): prohibir con la bandera apagada pero no exigir con la bandera encendida— con el argumento de que marcar una sospecha sin poder explicarla todavía es un estado real del formulario. Se descarta: una sospecha de maltrato registrada **sin una sola línea que la sustente** es precisamente el dato que no sirve para nada aguas abajo, y el formulario admite guardar la fila sin marcar la bandera mientras el investigador no tenga qué escribir. Se valoró también dejar los tres pares libres —opción (c), la que F32 eligió para sus dos textos de observaciones— y se descarta por lo mismo: allí eran observaciones opcionales de una anamnesis, aquí son la justificación de una sospecha.
- **Sí: la asimetría `001` / `004` heredada de F29.** En el alta, mandar una explicación con la bandera apagada es 400; en el update, si la explicación no viaja se fuerza a `null` sin error, y si viaja con contenido es 400. **No: devolver 400 en el update pidiendo un `null` explícito.** El huérfano lo creó una petición anterior, no ésta, y el estado resultante es inequívoco: apagar la bandera es borrar su explicación. Un 400 ahí sería un trámite, no una protección.
- **Sí: el forzado como derivado condicional dentro de `candidates`. No: limpiarlo con un `update` posterior al diff.** Un segundo `UPDATE` escribiría aunque nada cambie, y rompería el criterio de que apagar una sospecha ya apagada no crece `appDetails`.
- **Sí: la regla parametrizada sobre `FLAG_EXPLANATION_PAIRS`. No: escrita tres veces.** Tres copias de la misma regla divergen en la primera corrección que solo se aplique a dos de ellas. Es decisión de forma y no cambia el contrato: los tres pares siguen produciendo sus propios códigos de error.
- **Sí: seis claves i18n distintas para los tres pares. No: dos claves con `{{field}}` interpolado.** F32 hizo lo contrario para sus nueve campos de embarazo y ahí era lo correcto, porque eran nueve campos homogéneos del mismo bloque. Aquí son tres conceptos distintos y el mensaje que el usuario lee también lo es: «describe la otra fuente» no es intercambiable con «explica la sospecha de maltrato infantil». Interpolar el nombre técnico de la columna dejaría al cliente construyendo la frase.

**Sobre el alcance**

- **Sí: `receivedMedicalAttention` no gobierna nada.** Se recibe, se valida la forma y se almacena. Atarlo al resto obligaría a decidir si «no recibió atención médica» invalida un `completeClinicalSummary` que el investigador sí pudo redactar por otras vías —una autopsia verbal, un familiar—, y esa respuesta no está clara ni en el formulario ni en el dominio.
- **No: ninguna regla cruzada con `investigationSource`.** Las dos tablas tienen columnas llamadas «fuente» y no hablan de lo mismo: una responde «de dónde salió la investigación» y la otra «sobre qué material se evaluó al paciente». Atarlas exige antes decidir cuál manda, y esa decisión no está tomada.
- **No: `evaluationInstitution` en este spec.** Cuelga de esta tabla, pero tiene `sortOrder`, `isActive` propio y tres FK: es un CRUD completo con su propio patrón de tabla hija. Meterla aquí duplicaría el tamaño del spec y mezclaría dos formas distintas de entidad.
- **Sí: dejar disparar el `ESAVI-INVESTGN-005C` con la evaluación colgando, con volcado en `warn` como única mitigación. No: bloquearlo.** Es la decisión de F13, F29, F30 y F32, heredada sin reabrirse: la purga es una operación de SUPERADMIN sobre una investigación ya retirada, y bloquearla obligaría a un baile de purgas en orden inverso que nadie va a recordar.
- **Sí: listado dual `002A` / `002B`.** La visibilidad se hereda del padre, así que las dos variantes devuelven conjuntos distintos y la distinción no es decorativa.
- **Sí: forma completa también en los listados. No: una forma reducida.** Dieciséis columnas de datos y ningún objeto de catálogo que resolver: recortarlas dejaría un listado sin contenido.
- **Sí: consumir `satelliteCascade.service.ts` sin modificarlo.** F32 lo extrajo precisamente para que la cuarta satélite sin `isActive` no volviera a duplicar el arrastre. Ésta es la cuarta consumidora y el archivo no se toca; que su `git diff` esté vacío es un criterio de aceptación.
- **Sí: `INVCLIEV`, ocho letras.** Se valoró `INVCLEV` (siete) y `CLINEVAL`. La primera se descarta por ilegible; la segunda, porque pierde el prefijo `INV` que agrupa visualmente las seis satélites ya registradas.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| `clinicalDetailsPersonName` queda cifrado y **sin vuelta atrás barata**: si mañana se necesita buscar por él, o se decide que no debía cifrarse, el arreglo es una migración de datos | Está declarado en §6 como la decisión más cara de revertir del spec, con su razón escrita. El campo no participa en ningún filtro, orden ni búsqueda, así que ningún consumidor puede acoplarse a algo que luego habría que romper |
| Una rotación de `CRYPTO_KEY` deja ilegible el campo en todas las filas ya guardadas | No es un riesgo nuevo: `appUser`, `patient` y `notifier` lo comparten desde F04. Este spec no lo agrava ni lo resuelve, y no introduce ninguna clave ni esquema propios |
| El descifrado **fila por fila** en los dos listados añade coste proporcional al `limit` | Es el mismo coste que F05 asume en `patient`. `DEFAULT_LIMIT` lo acota, y no hay ninguna consulta que descifre fuera de la página pedida |
| Un desarrollador lee el modelo, ve `TEXT` y no distingue la columna cifrada de las otras seis | El comentario de dos líneas sobre `clinicalDetailsPersonName` es obligatorio en el modelo, siguiendo `notifier.model.ts:14` y `patient.model.ts:50`. Y el criterio de §5 que exige ver `esaviCrypt` después del diff y `esaviDecrypt` antes lo ancla en el servicio |
| Un body que rompe dos pares a la vez recibe **un** solo 400, y el cliente corrige uno y vuelve a fallar | Es deliberado y está declarado en §3.5: el orden de evaluación es el de `FLAG_EXPLANATION_PAIRS`, es estable, y el criterio de §5 lo verifica. Acumular los tres errores exigiría un contrato de respuesta que el repositorio no tiene |
| `GET /:id` captura `/admin`, `/purge` y `/case` como UUID | Las rutas literales se declaran antes de `/:id`; cubierto por la suite de contrato y por un criterio de §5 |
| El control de `isActive` de `purgeEntityService` es **inerte** sobre esta tabla, y un `005C` podría destruir una fila que nadie retiró | `assertRowIsSealed` es la única red, y su 409 tiene criterio propio en §5. Es la misma situación de F29, F30 y F32, ya conocida y ya probada |
| `evaluationInstitution` no puede implementarse antes que este spec, y su ausencia no es visible desde ningún error | La dependencia se declara en §1 y en §3.1 con su línea del DDL, precisamente para que el orden de las satélites restantes quede escrito y no se descubra al implementar |

---

## 8. Impacto en el contrato HTTP

**Ninguno.** El spec solo añade endpoints nuevos. Las tres invocaciones que añade a `src/services/investigation.service.ts` y `src/services/esaviCase.service.ts` no cambian el `data`, el `message` ni el status de ninguna operación de aquellas entidades: sellan y limpian una tabla que sus respuestas no incluyen. El `hasOne` nuevo tampoco aparece en ningún `include` de `/api/investigations`.

---

## Lo que **no** está en este spec

- `evaluationInstitution`, pese a colgar de esta tabla.
- Las otras seis satélites de `investigation`.
- Cifrar los otros seis textos libres.
- Búsqueda, filtro u orden por `clinicalDetailsPersonName`, o por cualquiera de los siete campos libres.
- Cualquier regla cruzada con `investigationSource`, `investigationAutopsy`, `investigationMedicalHistory` o `patient`.
- Cualquier tablero, conteo o filtro por `suspectedChildAbuse`, `suspectedDomesticViolence` o `receivedMedicalAttention`.
- Operaciones `005A` y `005B`: la tabla no tiene `isActive`.
- Bloquear `ESAVI-INVESTGN-005C` cuando la investigación tiene evaluación clínica.
- Modificar `esaviapp.sql`, `satelliteCascade.service.ts`, `purgeEntityService`, `assertRowIsSealed`, `buildDifferentialUpdate` ni `crypto.helper.ts`.
- Añadir el listado dual a `severeNotification` y `nonSevereNotification`.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
