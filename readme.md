# ESAVI Backend

## Generar cryptokey

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Bootstrap del primer SUPERADMIN en producción

`POST /api/seed/admin` **no existe en producción**: el router de seed solo se monta cuando
`NODE_ENV !== 'production'`. En producción el primer usuario se crea a mano, por SQL, antes
de exponer la API.

El paso no es SQL puro. `email`, `username` y `displayName` se guardan cifrados con
`esaviCrypt` (AES determinista, IV fijo) y la contraseña con bcrypt, así que primero hay que
generar esos valores con las mismas claves que usará el servidor.

### 1. Generar los valores cifrados

Ejecutar en la máquina de despliegue, con el `.env.production` ya en su sitio — los valores
dependen de `CRYPTO_ALGORITHM`, `CRYPTO_SECRET_KEY` y `CRYPTO_VECTOR`, y no son
reutilizables entre entornos.

```bash
NODE_ENV=production node -e "
require('dotenv').config({ path: '.env.production' });
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const algorithm = process.env.CRYPTO_ALGORITHM || 'aes-256-cbc';
const key = crypto.scryptSync(process.env.CRYPTO_SECRET_KEY, 'salt', 32);
const iv  = crypto.scryptSync(process.env.CRYPTO_VECTOR, 'salt', 16);

const esaviCrypt = (text) => {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  return cipher.update(text, 'utf-8', 'hex') + cipher.final('hex');
};

const email    = process.argv[1];
const password = process.argv[2];

console.log('email       :', esaviCrypt(email));
console.log('displayName :', esaviCrypt('Super Admin'));
console.log('username    :', esaviCrypt('Super Admin'));
console.log('passwordHash:', bcrypt.hashSync(password, bcrypt.genSaltSync()));
" superadmin@midominio.gob.ec 'UnaPasswordLargaYUnica'
```

### 2. Insertar roles y usuario

Sustituir los cuatro literales `<...>` por la salida del paso anterior.

```sql
BEGIN;

-- Los tres roles de la matriz canónica. ADMIN es imprescindible: cinco rutas
-- del catálogo geográfico y de tipos de catálogo se autorizan a ese nivel.
INSERT INTO "appRole" (code, name, description, "isSystemRole", level, "appDetails")
VALUES
    ('SAD', 'SUPERADMIN', 'Superadmin role with all permissions', true, 100, '[]'::jsonb),
    ('ADM', 'ADMIN',      'Admin role',                           true,  50, '[]'::jsonb),
    ('USR', 'USER',       'Standard user role',                   true,  25, '[]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Usuario SUPERADMIN inicial
INSERT INTO "appUser" (username, email, "passwordHash", "displayName", "requiresPasswordChange", "isActive", "appDetails")
VALUES (
    '<username cifrado>',
    '<email cifrado>',
    '<passwordHash bcrypt>',
    '<displayName cifrado>',
    true,
    true,
    '[{"user": "manualBootstrap", "method": "ESAVI-SEED-001", "detail": "First SUPERADMIN created manually"}]'::jsonb
);

-- Asignación del rol
INSERT INTO "appUserRole" ("userId", "roleId", "assignedByUserId", "validFrom", "appDetails")
SELECT u."userId", r."roleId", u."userId", now(), '[]'::jsonb
FROM "appUser" u
CROSS JOIN "appRole" r
WHERE u.email = '<email cifrado>'
  AND r.code  = 'SAD';

COMMIT;
```

### 3. Comprobar

```bash
curl -X POST https://<host>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@midominio.gob.ec","password":"UnaPasswordLargaYUnica"}'
```

Debe devolver `200` con token. Un `401` significa que las claves de cifrado usadas al generar
el `email` no coinciden con las que carga el servidor.

`requiresPasswordChange` queda en `true` a propósito: la contraseña del bootstrap pasa por el
shell y por el historial de comandos, así que hay que rotarla en el primer acceso.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca en desarrollo con ts-node-dev |
| `npm start` | Arranca en producción desde `dist/` |
| `npm run build` | Compila `src/` a `dist/` |
| `npm test` | Ejecuta la suite (necesita `.env.test`) |
| `npm run test:watch` | La suite en modo watch |
| `npm run lint` | ESLint sobre `src/` y `tests/` |
| `npm run lint:fix` | Igual, corrigiendo lo autocorregible |
| `npm run format` | Prettier sobre todo el repo |
| `npm run format:check` | Comprueba el formato sin escribir |
| `npm run i18n:check` | Paridad de claves entre `es`, `en` y `nl` |
| **`npm run check`** | **build + lint + i18n:check + test.** El único comando que hay que correr antes de un PR |

No hay CI. Es una decisión explícita del proyecto: los comandos existen, pero nada garantiza que
se ejecuten. `npm run check` los deja en uno solo.

## Suite de pruebas

La suite corre con Jest + supertest **contra una base de datos PostgreSQL real**, no con
mocks de Sequelize: buena parte de lo que verifica son status codes que dependen de
restricciones de la base (un `409` lo produce una `UNIQUE` de Postgres).

### Requisitos

- PostgreSQL en marcha, con las extensiones `pgcrypto`, `citext` y `postgis` disponibles.
- Un archivo `.env.test` en la raíz. Se crea copiando la plantilla:

```bash
cp .env.test.example .env.test
```

Rellena `DB_USER` y `DB_PASSWORD` con las credenciales locales. **`DB_NAME` debe terminar en
`_test`** (por defecto `esavi_test`).

No hace falta crear la base a mano: el setup la borra y la vuelve a crear en cada ejecución,
carga el esquema desde `esaviapp.sql` y siembra los cuatro roles canónicos.

### Ejecutar

```bash
npm test
```

### Protección de la base de desarrollo

La suite **recrea** `DB_NAME` desde cero. Para que eso no pueda apuntar nunca a la base de
desarrollo, el setup aborta antes de tocar nada si:

- `NODE_ENV` no es `test`, o
- `DB_NAME` no termina en `_test`.

Ambas comprobaciones están cubiertas por sus propios tests en `tests/setup/database.test.ts`.
