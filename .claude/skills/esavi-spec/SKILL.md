---
name: esavi-spec
description: Prepara el spec de requerimientos de una entidad ESAVI antes de implementarla — alcance, modelo de datos y requerimientos funcionales por endpoint. Úsalo cuando toque una tabla nueva de esaviapp.sql o una funcionalidad transversal del backend. Disparadores "necesito el spec de X", "vamos a implementar la tabla Y", "prepara los requerimientos de Z", "qué endpoints necesita W".
disable-model-invocation: true
argument-hint: 'nombre de tabla de esaviapp.sql o descripción corta'
---

# /esavi-spec — diseñador guiado de specs del backend ESAVI

Este skill produce **el spec, no el código**. Tu trabajo es que el usuario aterrice qué se va a construir, preguntar lo que no esté definido y desarrollar el spec sección por sección hasta guardarlo en `references/functional/specs/`.

## Dónde viven los specs

- **Los specs nuevos que escribas van a `references/functional/specs/NN-slug.md`.** Crea el directorio si no existe.
- Los specs técnicos `01` a `09` están en `references/specs/`. Ahí se quedan: son el histórico y el patrón de forma a imitar.
- **Los dos directorios numeran por separado.** Los funcionales empiezan en `01`: el primero que escribas será `01-<slug>.md` aunque en `references/specs/` ya exista un `01`. Para asignar `NN`, lista **solo** `references/functional/specs/` y toma el siguiente al mayor que haya ahí.
- **Para que los dos "SPEC 01" no se confundan, los funcionales se titulan con prefijo `F`:** `# SPEC F01 — Título`. Cítalos siempre como `SPEC F01`, y reserva `SPEC 01` para los técnicos de `references/specs/`.

## Filosofía

El spec es el contrato que después ejecuta `/spec-impl`. Si el spec es vago, la implementación improvisa: inventa nombres de columna, se salta la validación de una FK o duplica una abreviatura `ESAVI-*`. Por eso este flujo es **deliberadamente lento en la fase de definición** y rápido al escribir.

Dos archivos de este mismo directorio son de consulta obligatoria:

- `template.md` — la forma exacta que debe tener el spec.
- `references.md` — dónde vive cada dato del repositorio, para no trabajar de memoria.

Tus respuestas al usuario van **en español**. Los identificadores, nombres de archivo, claves i18n y códigos de operación van en inglés.

---

## Fase 1 — Contexto

No preguntes nada hasta haber hecho esto:

1. Lee `CLAUDE.md` de la raíz y estas secciones de `references/CONVENTIONS.md`: **§1** (los siete artefactos), **§6** (códigos `ESAVI-*` y tabla de abreviaturas), **§9** (matriz de roles), **§10** (contrato de respuesta), **§11** (capa de servicio, incluido el bloque **«Update diferencial — solo se escribe lo que cambió»**, que es norma vinculante y no una recomendación). No las reconstruyas de cabeza: tienen tablas exactas.
2. Lista `references/functional/specs/` y determina el siguiente `NN`. Si el directorio no existe o está vacío, el spec que vas a escribir es el `01`. Los números de `references/specs/` no cuentan: son una serie aparte.
3. Lee `references/specs/09-healthfacility-crud.md` completo. Es **el ejemplo canónico de spec CRUD** de este repositorio: copia su forma, su nivel de detalle y su tono.
4. Si el argumento nombra una tabla, localiza su `CREATE TABLE` en `esaviapp.sql` y extrae textualmente: columnas, tipos, nulabilidad, claves foráneas, restricciones `UNIQUE`, `CHECK`, triggers e índices. Si la tabla no existe en el DDL, dilo y detente — el esquema no lo crea Sequelize, así que no hay entidad que especificar.
5. Comprueba en `src/models/` si la entidad ya tiene modelo. Si lo tiene, esto es un spec de **ampliación** (como el 09), no de alta; el alcance y la sección 1 cambian de tono.

Si `$ARGUMENTS` viene vacío, pide el nombre de la tabla o una descripción de **una sola frase** de lo que se quiere construir. Si la descripción no cabe en una frase, ésa es la primera señal de que hay que dividir el spec.

**Specs transversales.** Si lo pedido no es una entidad sino una regla que cruza el repositorio (como los specs 01 a 08), el flujo es el mismo pero la sección 3 se reduce: se describe qué cambia con tablas Antes/Después en vez del desglose 3.1–3.7 de `template.md`.

---

## Fase 2 — Preguntas

Ésta es la fase que decide la calidad del spec. Tu trabajo aquí es **detectar ambigüedades y preguntar**, no suponer.

Antes de preguntar, **presenta como propuesta cerrada todo lo que ya sacaste del DDL y de las convenciones**. No preguntes lo que el SQL ya responde. Pregunta solo lo que el SQL no dice.

Haz las preguntas en bloques de 3 a 5, numeradas, una por línea. Espera respuesta antes del siguiente bloque.

Categorías que siempre debes cubrir en un spec de entidad:

- **Abreviatura `ESAVI-*`.** Propón una de 4 a 8 letras mayúsculas derivada del nombre de la entidad. Verifica contra las registradas en `references.md` que no colisione. Las de dos letras están prohibidas.
- **Superficie HTTP.** ¿Qué operaciones del rango `001`–`005B` entran? ¿El listado es único (`002`) o dual (`002A` público / `002B` admin)? ¿Se lista por `/` o por una FK, como `/location/:id` en `HFAC`? ¿La ruta base va en plural con guiones (`/api/health-facilities`)?
- **Roles por operación.** Presenta la matriz canónica de §9 como propuesta —create ADMIN, list USER, getById USER, update ADMIN, delete ADMIN, activate SUPERADMIN— y pregunta solo por las desviaciones.
- **Reglas de negocio.** Qué campo es único y contra qué valor normalizado se compara; qué FKs hay que validar antes de escribir y con qué filtro (p. ej. que el `catalogItem` pertenezca a un `catalogType` concreto); qué bloquea la desactivación (equivalente a `hasActiveChildren`); si hay auto-referencia, qué pasa con `selfParent` y `circularParent`.
- **Normalización al escribir.** Qué campos llevan `toConstantCase` (códigos) y cuáles `toTitleCase` (nombres).
- **Update diferencial.** No preguntes *si* el update es diferencial: lo es siempre, por §11 del canon. Lo que sí tienes que cerrar, campo por campo, es **cómo entra cada uno en `candidates`**: cuáles son anulables —y por tanto se comparan contra `undefined`, no por veracidad—, cuáles son derivados y entran siempre aunque el cliente no mande nada, y cuáles van cifrados y se comparan sobre texto plano. Pregunta también si alguna operación de la entidad **no** es un update diferencial —una activación, un traslado, una asignación masiva, cualquier escritura que registre un hecho aunque ningún dato cambie— para dejarlo declarado y razonado. Si el spec propaga algo a otra tabla, cierra que el disparador es el cambio real de valor, nunca la presencia de la clave en el body.
- **Datos sensibles.** ¿Algún campo debe cifrarse con `esaviCrypt`, como el correo o el nombre en `appUser`? Es la decisión más cara de revertir: si se cifra, las búsquedas por ese campo deben ser por igualdad.
- **Listado.** Paginación con `findAndCountAll`, filtros admitidos por query, orden por defecto.
- **Alcance excluido.** Qué se menciona en la conversación pero se difiere explícitamente a otro spec.

**Cómo preguntar bien.** Preguntas concretas con opciones, no abiertas. Mal: "¿cómo manejamos la unicidad?". Bien: "¿`code` es único globalmente o solo dentro de su `catalogTypeId`? Recomiendo global porque el SQL declara `UNIQUE (\"code\")`". Cuando ofrezcas opciones, da de 2 a 4 y marca cuál recomiendas y por qué.

Si una respuesta abre la caja de Pandora ("y de paso que exporte a Excel"), señala que eso merece su propio spec y pregunta si lo dejamos fuera de alcance.

**Cuándo dejar de preguntar.** Cuando puedas responder estas tres sin suponer nada:

1. ¿Qué archivos aparecen o cambian?
2. ¿Cuál es el primer paso ejecutable y cuál el último?
3. ¿Cómo verifico que está terminado?

Si te falta una, sigue preguntando.

---

## Fase 3 — Desarrollo sección por sección

Con la claridad ya conseguida, **no generes el spec completo de una vez**. Desarrolla las secciones de `template.md` una a una, en este orden estricto:

1. Header (estado, dependencias, fecha, objetivo en una frase).
2. `## 1. Por qué existe este spec`.
3. `## 2. Alcance` — el bloque **Fuera de alcance** es obligatorio.
4. `## 3. Modelo de datos` — con sus sub-secciones 3.1 a 3.7.
5. `## 4. Plan de implementación` — un paso por operación, cada uno con su `*Verificación:*`.
6. `## 5. Criterios de aceptación`.
7. `## 6. Decisiones tomadas y descartadas`.
8. `## 7. Riesgos identificados` (si aplica).
9. `## 8. Impacto en el contrato HTTP` (solo si el contrato cambia).
10. `## Lo que **no** está en este spec`.

Después de cada sección: muéstrala formateada en markdown, pregunta "¿esta sección queda así o la ajustamos?", aplica los cambios que pida y vuelve a mostrarla. Solo avanza cuando el usuario confirme.

La sección 3.4 (superficie HTTP) es la pieza más importante de un spec CRUD: sin ella, el spec no sirve para implementar. La 3.5 (reglas de negocio por operación) es la segunda.

**Errores frecuentes que debes evitar:**

- Criterios de aceptación no verificables ("que funcione bien").
- Meter en el plan de implementación cosas que no están en el alcance.
- Inventar nombres de columna o de tabla. Salen de `esaviapp.sql`, citados tal cual.
- Saltarte la sección de decisiones: es la que más valor tiene dentro de tres meses.
- Escribir funciones completas en el spec. El spec describe; el código viene después.
- Dejar el `004` sin su tabla de `candidates`, o los criterios de aceptación sin el bloque de update diferencial. Es el olvido más frecuente y el más caro: seis de los doce servicios del repositorio nacieron escribiendo por presencia de clave, y costó un spec entero —el F12— corregirlos.

---

## Fase 4 — Guardar

Cuando todas las secciones estén confirmadas:

1. Propón el nombre de archivo: `references/functional/specs/NN-slug.md`. El slug va en **kebab-case inglés** aunque el contenido esté en español — por ejemplo `01-patient-crud.md`. Confirma el nombre con el usuario antes de escribir.
2. Escribe el archivo con todas las secciones aprobadas. Crea `references/functional/specs/` si aún no existe.
3. Estado `Borrador` por defecto. **Nunca lo marques `Aprobado` por tu cuenta**: eso lo hace el usuario cuando lo relee.
4. No toques `references/specs/.spec-config.yml`. Ya existe y sigue rigiendo el flujo de `/spec-impl`.
5. Enumera al usuario lo que el spec deja pendiente fuera del propio archivo:
   - dar de alta la abreviatura nueva en la tabla de `references/CONVENTIONS.md` §6 (el paso lo cubre el plan de implementación, pero conviene recordarlo);
   - si el spec resuelve alguna deuda, añadir el enlace bidireccional con `references/TECHNICAL_DEBT.md` (el spec enlaza a `../../TECHNICAL_DEBT.md#deuda-0NN` — dos niveles arriba desde `functional/specs/` — y el mapa de resolución de la deuda enlaza de vuelta a `./functional/specs/NN-slug.md`).
6. Confirma: **ruta completa** del archivo creado, recordatorio de que está en `Borrador`, y siguiente paso — `/spec-impl NN-slug` una vez aprobado. Advierte que `/spec-impl` busca en `specs/` de la raíz, así que habrá que indicarle la ruta.
7. **Detente ahí.** No propongas implementarlo, no escribas código, no hagas nada más.

---

## Reglas duras

- **Nunca escribas código en este comando.** Solo el `.md` final.
- **Nunca propongas implementar el spec tras guardarlo.** Tu trabajo termina cuando el archivo existe.
- **Nunca inventes nombres de columna, tabla o constraint.** Salen de `esaviapp.sql`.
- **Nunca reutilices una abreviatura `ESAVI-*` ya registrada**, ni cambies la numeración fija `001`–`005B`.
- **Nunca cierres un spec cuyo update no sea diferencial.** Toda operación que escriba sobre una fila existente pasa por `buildDifferentialUpdate`, declara en §3.5 cómo entra cada campo en `candidates` y lleva en §5 el bloque de cinco criterios de la plantilla. Lo que dispara la escritura es que el dato **cambie**, no que la clave llegue en el body — y eso vale igual para lo que el spec propague a otras tablas. Las escrituras que no son diferenciales se declaran una por una, con su razón.
- **Nunca asumas decisiones que el usuario no confirmó.** Si falta información, pregunta.
- **Nunca generes el spec entero en una sola respuesta.** Sección a sección, con confirmación.
- Si el usuario quiere saltarse la Fase 2, recuérdale que las preguntas de ahora ahorran horas después. Si insiste, respétalo y déjalo escrito en la sección de decisiones ("Definición rápida sin ronda de aclaraciones").
- Si la entidad arrastra varias tablas con lógica propia —`notification` y sus ocho satélites, o `investigation` y sus catorce— propón **dividir en varios specs** antes de continuar. Un spec que toca quince tablas no lo ejecuta nadie.

## Tono

Directo y concreto. No te disculpes por preguntar: el usuario invocó este skill precisamente para que preguntes. Numera las preguntas para que sean fáciles de responder.

Ejemplo de bloque bien formado:

> Antes de escribir el modelo de datos necesito cerrar cuatro cosas:
>
> 1. **Abreviatura.** Propongo `DIAGTERM` para `diagnosticTerm` (8 letras, no colisiona con las 8 registradas). ¿La damos de alta así?
> 2. **Unicidad.** `esaviapp.sql:549` declara `UNIQUE ("code")`. ¿Se compara contra el valor ya normalizado con `toConstantCase`, como en `catalogItem`?
> 3. **Listado.** ¿Dual (`002A` público / `002B` admin) como `catalogItem`, o único `002` porque el catálogo es pequeño? Recomiendo dual: mantiene la simetría con el resto.
> 4. **Desactivación.** ¿Bloqueamos desactivar un término ya referenciado por un `esaviCase`, o se permite y el caso conserva la referencia histórica?

## Argumentos

Si el usuario invocó `/esavi-spec patient`, usa `patient` como tabla de partida y `patient-crud` como slug propuesto, pero confirma antes de escribir el archivo. Si invocó `/esavi-spec` sin argumentos, empieza pidiendo la tabla o la frase única.
