# SPEC 07 — Verificación automática: linter y suite mínima

> **Estado:** Aprobado
> **Depende de:** SPEC 01 a 06 (la suite codifica el comportamiento posterior a la serie)
> **Fecha:** 2026-08-01
> **Objetivo:** Que el contrato de respuesta y la matriz de roles se comprueben ejecutando un comando, no leyendo el código.

Cubre la entrada **DEUDA-030** de [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md).

Séptimo spec, habilitador del resto de la serie de deuda técnica.

---

## 1. Por qué existe este spec

`CONVENTIONS.md` tiene 892 líneas de reglas y ninguna es verificable hoy: se comprueban leyendo. `TECHNICAL_DEBT.md` documenta 35 desviaciones que se encontraron leyendo. Los seis specs anteriores corrigen el código, pero nada impide que la deuda vuelva a acumularse igual de silenciosamente.

Este spec no corrige ninguna desviación. Instala los dos mecanismos que las detectan: un linter que codifica las reglas de nomenclatura y una suite que verifica el contrato de respuesta.

---

## 2. Alcance

**Dentro:**

- Extraer la app Express a `src/app.ts`; `src/index.ts` queda solo con el arranque. Sin esto, supertest no puede montar la app sin abrir el puerto.
- Jest + ts-jest + supertest, con `.env.test` y una base de datos de pruebas creada desde `esaviapp.sql`.
- Suite mínima en tres bloques: contrato de respuesta, matriz de roles, i18n.
- ESLint 9 con configuración plana, `typescript-eslint` y `naming-convention` codificando las secciones 3, 4 y 5 del canon.
- Prettier con `eslint-config-prettier`.
- Scripts de npm: `test`, `test:watch`, `lint`, `lint:fix`, `format`, `check`.

**Fuera de alcance:**

- GitHub Actions y cualquier CI. Decidido: solo scripts locales.
- Hooks de pre-commit.
- Umbral de cobertura obligatorio.
- Tests de todos los endpoints. La suite cubre el contrato, no la funcionalidad de cada entidad.
- Tests de `esaviCrypt`, que exigiría fijar claves de prueba y merece su propio spec.

---

## 3. Modelo de datos

No hay datos de aplicación nuevos. Hay estructura de proyecto nueva.

### Separar la app del arranque

```ts
// src/app.ts — construye y exporta la app, no escucha
const app = express();
// ... middlewares, rutas, errorHandler
export { app };

// src/index.ts — arranca
import { app } from './app';
const startServer = async (): Promise<void> => { ... };
startServer();
```

Es el único cambio de `src/` en este spec, y no altera comportamiento.

### Estructura de pruebas

```
tests/
  setup/
    database.ts        // crea el esquema desde esaviapp.sql, siembra roles
    auth.ts            // emite tokens para SUPERADMIN, ADMIN, USER, ANALYTICS
  contract/
    response.test.ts   // forma de { ok, message, data } y { ok, message, code, errors }
  auth/
    roles.test.ts      // la matriz canónica, ruta por ruta
  i18n/
    messages.test.ts   // ningún message vacío en los tres idiomas
```

### Entorno de pruebas

`.env.test`, cargado por el patrón `.env.${NODE_ENV}` que ya existe:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `test` |
| `DB_NAME` | `esavi_test` |
| `CORS_ORIGINS` | `http://localhost:3000` |
| `SEED_ACTION` | `test` |

La base `esavi_test` se recrea antes de cada ejecución. Los tests nunca apuntan a `esavi_dev`.

### Reglas de `naming-convention`

| Selector | Formato | Origen |
|---|---|---|
| `interface`, `typeAlias`, `class` | `PascalCase` | sección 4 |
| `variable`, `function`, `parameter` | `camelCase` | sección 4 |
| `variable` con `const` a nivel de módulo y tipo primitivo | `UPPER_CASE` o `camelCase` | sección 4 |
| `property` | `camelCase` | sección 4 |

Más tres reglas de proyecto que el linter no puede expresar y quedan como test o como revisión: el sufijo de archivo por carpeta, el bloque `export { }` final en controladores y servicios, y `const router`.

---

## 4. Plan de implementación

1. **Separar app y arranque.** Crear `src/app.ts` con todo lo que hoy hay en `src/index.ts` salvo `startServer`, y dejar en `index.ts` solo el arranque.
   *Verificación:* `npm run dev` y `npm start` funcionan igual que antes.

2. **Instalar el runner.** `jest`, `ts-jest`, `supertest`, `@types/jest`, `@types/supertest` como devDependencies. `jest.config.ts` con el preset de ts-jest, `testEnvironment: 'node'` y `setupFiles` apuntando a `.env.test`.
   *Verificación:* un test trivial que afirme `1 + 1 === 2` pasa.

3. **Base de datos de pruebas.** `tests/setup/database.ts`: recrea el esquema desde `esaviapp.sql`, siembra los cuatro roles y cierra la conexión al terminar. Crear `.env.test`.
   *Verificación:* la suite arranca y termina sin conexiones colgadas.

4. **Emisor de tokens.** `tests/setup/auth.ts`: crea un usuario por rol y devuelve su token, para no depender del endpoint de login en tests que no son de login.
   *Verificación:* un `GET` autenticado con el token de USER devuelve 200.

5. **Contrato de respuesta.** `tests/contract/response.test.ts`: toda respuesta de éxito tiene `ok: true`, `message` no vacío y `data` salvo en delete y activate; create responde 201 y el resto 200; toda respuesta de error tiene `ok: false`, `message`, `code`, y `errors` no expone el error real fuera de desarrollo.
   *Verificación:* el bloque pasa contra el código posterior al SPEC 04.

6. **Matriz de roles.** `tests/auth/roles.test.ts`: una tabla con las rutas y su rol mínimo; para cada una, el nivel inmediatamente inferior recibe 403 y el nivel exacto no lo recibe.
   *Verificación:* alterar un `validateUserRole` en una ruta rompe el test.

7. **i18n.** `tests/i18n/messages.test.ts`: ninguna respuesta devuelve `message` vacío en `es`, `en` ni `nl`; `getMessage` con clave inexistente devuelve la clave.
   *Verificación:* borrar una clave de `nl.json` rompe el test.

8. **ESLint.** `eslint.config.js` plano con `typescript-eslint` y la tabla de `naming-convention`. `eslint` y `typescript-eslint` como devDependencies.
   *Verificación:* `npm run lint` termina sin errores sobre `src/`.

9. **Prettier y scripts.** `prettier` + `eslint-config-prettier`, `.prettierrc` y `.prettierignore`. Añadir a `package.json`: `test`, `test:watch`, `lint`, `lint:fix`, `format`, y `check` como `build && lint && i18n:check && test`.
   *Verificación:* `npm run check` pasa entero.

---

## 5. Criterios de aceptación

- [ ] `npm test` ejecuta la suite y sale con 0.
- [ ] `npm test` sale con 1 si se cambia el rol de una ruta.
- [ ] `npm test` sale con 1 si un endpoint devuelve 400 en un duplicado.
- [ ] `npm test` sale con 1 si se borra una clave de `nl.json`.
- [ ] `npm run lint` sale con 0 sobre `src/`.
- [ ] `npm run lint` sale con 1 si se declara `const MiVariable = 1`.
- [ ] `npm run lint` sale con 1 si se declara `interface createUserInput`.
- [ ] `npm run format` no produce cambios tras ejecutarse dos veces.
- [ ] `npm run check` encadena build, lint, i18n:check y test.
- [ ] `src/app.ts` exporta `app` y no llama a `listen`.
- [ ] `npm run dev` y `npm start` siguen funcionando.
- [ ] La suite no escribe en `esavi_dev` en ningún caso.
- [ ] La suite termina sin dejar conexiones abiertas a PostgreSQL.
- [ ] `package.json` ya no contiene el `test` con `exit 1`.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** Jest con ts-jest. Es el estándar con más ejemplos disponibles y el equipo lo reconoce sin curva de entrada.
- **No:** Vitest, pese a ser más simple de configurar con TypeScript. La familiaridad pesa más que la configuración, que se escribe una vez.
- **Sí:** supertest contra una base de datos real. Lo que la serie de specs cambia son status codes que dependen de restricciones de la BD —un 409 que hoy es un 500 lo produce una UNIQUE de Postgres—. Con Sequelize mockeado, la suite pasaría verde sobre el bug.
- **No:** mocks de Sequelize. Rápidos y portables, ciegos justo donde duele.
- **Sí:** extraer `src/app.ts`. No es cosmética: sin ella, importar la app en un test abre un puerto y la suite no termina.
- **Sí:** este spec va después de los seis. Escribir la suite antes obligaría a codificar el comportamiento actual —404 en login, 400 en duplicados— y a reescribirla entera conforme cada spec la invalida.
- **Sí:** solo scripts de npm, sin CI. Decisión explícita del proyecto. Queda registrado que reduce el alcance de DEUDA-030: los comandos existen, pero nada garantiza que se ejecuten.
- **No:** hooks de pre-commit. Se saltan con `--no-verify` y no cubren lo que llega por PR.
- **No:** umbral de cobertura. Un porcentaje obligatorio incentiva tests de relleno; la suite se mide por lo que verifica, no por lo que recorre.
- **Sí:** Prettier con `eslint-config-prettier`. El primer commit producirá un diff de formato amplio, y por eso va en un commit propio.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| La suite exige PostgreSQL disponible; sin él no corre nada | `.env.test` con `esavi_test` documentado en `readme.md`, y el setup falla con un mensaje explícito en vez de un error de conexión críptico |
| Un `DB_NAME` mal configurado apunta la suite a la base de desarrollo y la recrea | El setup aborta si `NODE_ENV !== 'test'` o si `DB_NAME` no termina en `_test` |
| Sin CI, los comandos existen y nadie los ejecuta | Registrado en Decisiones; `npm run check` deja un único comando que correr antes de un PR |
| El primer `npm run format` produce un diff enorme que oculta cambios reales | Va en un commit propio, sin ninguna otra edición |
| La suite se acopla a los datos sembrados y se vuelve frágil | El setup siembra lo mínimo: los cuatro roles y un usuario por rol; cada test crea lo que necesita |

---

## Lo que **no** está en este spec

- CI en GitHub Actions.
- Hooks de pre-commit.
- Umbral de cobertura.
- Tests funcionales de cada endpoint.
- Tests de cifrado de PII.

Cada uno de esos, si aterriza, va en su propio spec.
