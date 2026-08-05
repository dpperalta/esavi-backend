# Plantilla de spec — backend ESAVI

Este archivo es la referencia que consulta el skill `/esavi-spec` al generar un spec. Cada sección explica su propósito y da un ejemplo mínimo. **No es texto para copiar literalmente** — es la forma que el spec debe respetar.

El ejemplo vivo de todo lo que sigue es `references/specs/09-healthfacility-crud.md`. Cuando dudes del nivel de detalle, mira ahí.

Los specs funcionales se guardan en `references/functional/specs/NN-slug.md` y **numeran desde `01`**, en serie propia e independiente de la de `references/specs/`. Para distinguirlos, se titulan con prefijo `F` — `SPEC F01` — mientras que los técnicos siguen siendo `SPEC 01`.

---

## Header

Todo spec empieza con metadatos en blockquote. Sin tablas, sin bloques de código:

```markdown
# SPEC F01 — Título corto en español

> **Estado:** Borrador
> **Depende de:** SPEC 05 (códigos de operación), SPEC 08 (`lang` requerido en servicios)
> **Fecha:** YYYY-MM-DD
> **Objetivo:** Una sola frase.
```

**Estados válidos:** `Borrador`, `En revisión`, `Aprobado`, `Implementado`, `Obsoleto`.

**Numeración.** `FNN` para los funcionales de `references/functional/specs/`, empezando en `F01`. Los técnicos de `references/specs/` mantienen `SPEC NN` sin prefijo.

**Depende de:** los specs previos cuyas reglas asume éste, con su prefijo — `SPEC 05` para un técnico, `SPEC F02` para un funcional. Casi todo spec CRUD depende de los técnicos 01, 02, 03, 05 y 08. Si no depende de ninguno, escribe `—`.

**Regla del objetivo:** una frase que un humano lee en cinco segundos y entiende qué se va a construir. Si no cabe en una frase, el spec es demasiado grande: divídelo.

Separa cada sección con `---`.

Si durante la implementación la realidad se aparta del spec, se inserta una **nota de implementación** justo después del header en vez de reescribir el cuerpo. El spec 08 lo hace así.

---

## 1. Por qué existe este spec

El **porqué**, no el qué. Qué problema hay hoy, qué se rompe, qué no se puede hacer.

En specs de ampliación, describe los desajustes verificados con archivo y línea:

```markdown
**A — La unicidad de `localCode` está mal delimitada.** `esaviapp.sql` declara
`CONSTRAINT "UQ_healthFacility_localCode" UNIQUE ("localCode")` — unicidad global.
`healthFacility.service.ts:53-63` la comprueba filtrando por `geoLocationId`.
El cliente recibe **500** donde le corresponde un **409**.
```

En specs de entidad nueva, basta con situar la entidad en el dominio y decir qué depende de ella.

Si el spec resuelve una deuda catalogada, enlázala. Desde `references/functional/specs/` son dos niveles arriba: `[DEUDA-022](../../TECHNICAL_DEBT.md#deuda-022)`. Los specs históricos de `references/specs/` usan un solo nivel — no copies su ruta tal cual.

---

## 2. Alcance

Dos sub-bloques. **Los dos son obligatorios.**

```markdown
**Dentro:**

- Cosa concreta una.
- Cosa concreta dos.

**Fuera de alcance (otros specs):**

- Algo que se podría hacer pero ahora no.
- Algo que salió en la conversación y se decidió aplazar.
```

**Por qué importa el "fuera".** Recoge lo que el usuario mencionó durante la ronda de preguntas y se decidió aplazar. Sin ese registro, durante la implementación aparece la tentación de colarlo "ya que estamos".

---

## 3. Modelo de datos

En un spec de entidad nueva, esta sección se desglosa en siete sub-secciones. En un spec de ampliación o transversal se usan las que apliquen, con tablas Antes/Después.

### 3.1 Tabla origen

Nombre de la tabla y su rango de líneas en `esaviapp.sql`. Columnas con tipo y nulabilidad, FKs, `UNIQUE`, `CHECK` y triggers. Todo citado textualmente del DDL — **no se inventa ni una columna**.

```markdown
`diagnosticTerm` — `esaviapp.sql:549-564`.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `diagnosticTermId` | `uuid` | no | PK, `gen_random_uuid()` |
| `code` | `varchar(50)` | no | `UQ_diagnosticTerm_code` — unicidad global |
| `name` | `varchar(300)` | no | |
```

Cierra confirmando las cuatro columnas transversales que lleva toda tabla del esquema: `isActive`, `deletedAt`, `sysDetails` (JSONB) y `appDetails` (JSONB array). Si alguna falta, dilo — es una anomalía que hay que resolver antes de implementar.

### 3.2 Modelo Sequelize

Archivo destino, nombre de clase y las decisiones de definición: `timestamps: false`, `freezeTableName: true`, `tableName` en camelCase entre comillas, PK UUID con `defaultValue: sequelize.literal('gen_random_uuid()')`.

Enumera las asociaciones a declarar y en qué archivo de `src/models/associations/` van. Nunca dentro del modelo.

### 3.3 Tipos

La interfaz `CreateEntityInput` completa, con los opcionales marcados y comentarios donde el DDL y el uso difieran:

```ts
export interface CreateDiagnosticTermInput {
    code: string;
    name: string;
    description?: string | null;
    isActive?: boolean;
}
```

El update usa `Partial<CreateEntityInput>`. **No se declara `UpdateEntityInput`** — está prohibido por §4 de las convenciones.

Indica también la ruta: `src/types/<dominio>/<entidad>.types.ts`, con su `index.ts` de barrel y el alta en `src/types/index.ts`.

### 3.4 Superficie HTTP

La pieza clave. Bloque de texto plano con verbo, ruta, código, rol mínimo y estado:

```
POST   /api/diagnostic-terms                 ESAVI-DIAGTERM-001   ADMIN       (nuevo)
GET    /api/diagnostic-terms                 ESAVI-DIAGTERM-002A  USER        (nuevo)
GET    /api/diagnostic-terms/admin           ESAVI-DIAGTERM-002B  ADMIN       (nuevo)
GET    /api/diagnostic-terms/:id             ESAVI-DIAGTERM-003   USER        (nuevo)
PUT    /api/diagnostic-terms/:id             ESAVI-DIAGTERM-004   ADMIN       (nuevo)
DELETE /api/diagnostic-terms/:id             ESAVI-DIAGTERM-005A  ADMIN       (nuevo)
PATCH  /api/diagnostic-terms/activate/:id    ESAVI-DIAGTERM-005B  SUPERADMIN  (nuevo)
```

Marca cada fila como `(nuevo)`, `(existe)` o `(existe, se renumera)`.

Añade siempre la nota de orden de declaración: las rutas literales (`/admin`, `/activate/:id`) van **antes** de `/:id`, o Express capturará `admin` como un `:id` y el validador de UUID responderá 400.

### 3.5 Reglas de negocio por operación

Por cada código de operación: qué valida, en qué orden, y con qué código de `AppError` y qué status falla.

```markdown
**`ESAVI-DIAGTERM-001` — crear.** Normaliza `code` con `toConstantCase` y `name` con
`toTitleCase`. Comprueba unicidad global de `code` contra el valor ya normalizado
→ 409 `DIAGTERM_001_CODE_EXISTS`. Añade la entrada de auditoría a `appDetails`
con `method: 'ESAVI-DIAGTERM-001'`.

**`ESAVI-DIAGTERM-004` — actualizar.** Existencia → 404 `DIAGTERM_004_NOT_FOUND`.
Unicidad de `code` excluyendo el propio id con `{ [Op.ne]: id }` → 409
`DIAGTERM_004_CODE_EXISTS`. Preserva el historial con `[...currentAppDetails, newEntry]`.
```

Recuerda el criterio de status de §10: **409 para todo duplicado**, en create y en update por igual; 404 para "no existe" y para FK inexistente; 403 lo resuelve el middleware de rol, no el servicio.

### 3.6 Claves i18n nuevas

Tabla de claves con su uso. Van en los **tres** archivos: `src/data/i18n/es.json`, `en.json` y `nl.json`.

```markdown
| Clave | Uso |
|---|---|
| `diagnosticTerm.codeExists` | 409 al crear o actualizar con un código ya usado |
| `diagnosticTerm.notFound` | 404 al consultar un id inexistente |
```

`tests/i18n/messages.test.ts` exige paridad exacta: o están en los tres archivos o la suite falla.

### 3.7 Forma de la respuesta

Qué devuelve `data` en el listado y en el getById: qué asociaciones se incluyen, con qué campos, y qué se omite.

```
{ ok, message, data: {
    diagnosticTermId, code, name, description, isActive,
    createdAt, updatedAt, deletedAt, appDetails
} }
```

En listados, `data` es `{ count, rows }` de `findAndCountAll`. Indica si las filas inactivas se filtran salvo que `canViewInactive(req.user)` sea verdadero.

Si el spec no introduce datos nuevos, dilo explícitamente: _"No hay tablas nuevas. Reutiliza el modelo del SPEC 01."_

---

## 4. Plan de implementación

Pasos numerados. Cada paso deja el sistema **compilando y arrancable** — nada de "implementar la mitad y seguir mañana".

En un spec CRUD, **un paso por operación** `ESAVI-*`, precedido por los pasos de base (modelo, asociaciones, tipos, i18n) y cerrado por los de pruebas.

Cada paso lleva su línea `*Verificación:*` — cómo se comprueba a mano o con un comando que ese paso quedó bien:

```markdown
5. **`ESAVI-DIAGTERM-003` — obtener por ID.** `getDiagnosticTermByIdService(id, lang, includeInactive)`;
   controlador que pasa `canViewInactive(req.user)`; ruta `GET /:id` declarada **después** de las literales.
   *Verificación:* un ID inexistente devuelve 404; un término inactivo devuelve 404 para USER y 200 para ADMIN.
```

**Reglas:**

- Cada paso debe poder committearse solo.
- El último paso **no** es "probar todo" — eso son los criterios de aceptación.
- Los pasos de corrección van antes que los de ampliación: si algo se rompe, que se rompa con superficie pequeña.

---

## 5. Criterios de aceptación

Checklist booleano. Cada ítem se verifica con sí o no. Prefiere comandos ejecutables sobre descripciones.

```markdown
- [ ] Las siete rutas de §3.4 responden con su código de estado esperado.
- [ ] Los cinco puntos del código de operación (ruta, controlador, servicio, `AppError`, `appDetails.method`) coinciden.
- [ ] Crear con `code: "  fiebre alta  "` guarda `FIEBRE_ALTA`.
- [ ] `grep -rn "ESAVI-DIAGTERM-002[^AB]" src/` no devuelve resultados.
- [ ] Las claves nuevas existen en es, en y nl; `npm run i18n:check` sale en 0.
- [ ] `npm run check` sale en 0.
```

`npm run check` encadena `build`, `lint`, `i18n:check` y `test`. Es el criterio de cierre de todo spec.

**Antipatrones:**

- ❌ "Que funcione bien." → no verificable.
- ❌ "Buena UX." → subjetivo.
- ❌ "Sin bugs." → no operativo.
- ✅ "Desactivar un padre con hijos activos devuelve 409." → verificable, booleano.

Conviene cerrar recorriendo el checklist de PR de `references/CONVENTIONS.md` §15 y trasladando lo que aplique.

---

## 6. Decisiones tomadas y descartadas

La sección con más valor dentro de tres meses. Recoge **lo que se consideró**, no solo lo que se eligió. Viñetas con **Sí:** / **No:** y una razón breve cada una.

```markdown
- **Sí:** unicidad global de `code`. Es lo que impone el SQL; la aplicación solo estaba
  mintiendo sobre el alcance y convirtiendo un 409 en un 500.
- **No:** cambiar el `UNIQUE` del SQL a una clave compuesta. Modificar el esquema afecta
  a datos ya cargados y a la carga de `esaviapp.sql` en los tests.
- **No:** búsqueda por texto sobre `name`. No existe `Op.iLike` en ningún servicio del
  repositorio; introducirlo es un cambio transversal.
```

Una decisión sin razón es la primera que alguien cuestiona después.

---

## 7. Riesgos identificados

Solo cuando hay riesgos no evidentes. Tabla simple:

```markdown
| Riesgo | Mitigación |
|---|---|
| `GET /:id` captura `/activate` como UUID | Las rutas literales se declaran antes que `/:id`; cubierto por la suite de contrato |
| Normalizar rompe búsquedas de clientes que guardan el código original | Afecta solo a filas nuevas; conviene avisar a los consumidores de la API |
```

En specs pequeños o muy contenidos, omítela.

---

## 8. Impacto en el contrato HTTP

Solo si el spec **cambia** lo que ya reciben los clientes: un status que pasa de 500 a 409, un campo que desaparece del `data`, un mensaje que cambia de idioma. Los specs 01, 02, 03 y 08 la llevan.

Si el spec solo añade endpoints nuevos, omítela.

---

## Sección final — Lo que **no** está en este spec

Se repite explícitamente al final lo que **no** se va a hacer. La repetición es deliberada: la sección 2 ya lo dice, pero al final del documento sirve de recordatorio para quien solo lee las últimas líneas.

```markdown
## Lo que **no** está en este spec

- Búsqueda por texto sobre `name`.
- Importación masiva desde CSV.
- Exponer o editar `sysDetails`.

Cada uno de esos, si aterriza, va en su propio spec.
```

La frase de cierre es literal y va en todos los specs del repositorio.

---

## Reglas globales del documento

- **Una idea por frase.** Si una frase tiene dos comas y un punto y coma, pártela.
- **Nombres concretos.** Si dices "el servicio", di `src/services/diagnosticTerm.service.ts`. Si dices "una clave", da la cadena exacta.
- **Sin TODOs.** Un TODO en un spec significa que la decisión no se tomó. Tómala, o déjala anotada como decisión pendiente con su razón.
- **Sin código ejecutable largo.** El spec describe; el código se escribe después. Fragmentos cortos para ilustrar estructuras de datos, sí; funciones completas, no.
- **Markdown estándar.** Nada de extensiones raras: tiene que renderizar en GitHub sin sorpresas.
- **Contenido en español, identificadores en inglés.** Nombres de archivo, columnas, claves i18n y códigos de operación siempre en inglés.
