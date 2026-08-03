// @ts-check
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

/**
 * Flat config. Encodes the naming rules of sections 3, 4 and 5 of
 * references/CONVENTIONS.md so they are checked by running a command instead of
 * by reading the file.
 *
 * Three project rules that ESLint cannot express stay as review items: the file
 * suffix per folder, the trailing `export { }` block in controllers and
 * services, and `const router`.
 */
module.exports = tseslint.config(
    {
        ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'scripts/**', 'eslint.config.js']
    },

    ...tseslint.configs.recommended,

    {
        // The recommended set is not part of this spec's canon. It runs as
        // warnings so the 19 deviations it finds today stay visible on every run
        // without failing the build, and can be settled by their own spec.
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-expressions': 'warn',
            'prefer-const': 'warn'
        }
    },

    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                // The `types` selector below needs type information.
                // tsconfig.test.json is the one that covers src/ and tests/ alike.
                project: ['./tsconfig.test.json'],
                tsconfigRootDir: __dirname
            }
        },
        rules: {
            '@typescript-eslint/naming-convention': [
                'error',

                // Types are PascalCase — section 4
                {
                    selector: ['interface', 'typeAlias', 'class', 'enum'],
                    format: ['PascalCase']
                },

                // Module-level constants may shout — section 4
                {
                    selector: 'variable',
                    modifiers: ['const', 'global'],
                    format: ['UPPER_CASE', 'camelCase']
                },

                // Everything else is camelCase — section 4
                {
                    selector: ['variable', 'function', 'parameter'],
                    format: ['camelCase'],
                    leadingUnderscore: 'allow'
                },

                // A variable holding a class or a component is PascalCase
                {
                    selector: 'variable',
                    modifiers: ['destructured'],
                    format: null
                },

                {
                    selector: 'property',
                    format: ['camelCase']
                },

                // Keys that mirror an external shape — HTTP headers, i18n paths,
                // SQL columns — are not ours to rename
                {
                    selector: 'objectLiteralProperty',
                    format: null
                },
                {
                    selector: 'typeProperty',
                    format: ['camelCase']
                },

                {
                    selector: 'enumMember',
                    format: ['UPPER_CASE']
                }
            ]
        }
    },

    // Last, so it wins: turns off every rule Prettier already decides.
    eslintConfigPrettier
);
