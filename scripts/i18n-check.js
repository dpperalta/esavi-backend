/**
 * i18n-check — verifies the integrity of the message files.
 *
 * Checks, in order:
 *   1. The three language files hold exactly the same set of keys.
 *   2. The same key carries the same {{param}} markers in every language.
 *   3. Every key referenced with getMessage('...') under src/ exists in the reference language.
 *   4. The resolved language actually reaches the message: no default value for `lang` in service
 *      signatures, no getMessage() call without a language, and no module-level read of
 *      DEFAULT_LANGUAGE in the i18n helper.
 *
 * Exits with code 1 if any divergence is found, 0 otherwise.
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '..', 'src', 'data', 'i18n');
const SRC_DIR = path.join(__dirname, '..', 'src');
const SERVICES_DIR = path.join(SRC_DIR, 'services');
const HELPERS_DIR = path.join(SRC_DIR, 'helpers');
const I18N_HELPER = path.join(HELPERS_DIR, 'i18n.helper.ts');
const LANGUAGES = ['es', 'en', 'nl'];
const REFERENCE_LANGUAGE = 'es';

const problems = [];

// Flattens a nested message object into a Map of 'namespace.key' -> string
const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([key, value]) =>
        value !== null && typeof value === 'object'
            ? flatten(value, `${prefix}${key}.`)
            : [[`${prefix}${key}`, value]]
    );

const placeholders = (text) =>
    [...String(text).matchAll(/{{\s*(.*?)\s*}}/g)].map((match) => match[1]).sort().join(', ');

// Every .ts file under src/
const collectSourceFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(fullPath);
        return entry.name.endsWith('.ts') ? [fullPath] : [];
    });

// ---------------------------------------------------------------------------
// Load the message files
// ---------------------------------------------------------------------------

const messages = {};

for (const lang of LANGUAGES) {
    const file = path.join(I18N_DIR, `${lang}.json`);
    if (!fs.existsSync(file)) {
        console.error(`[i18n-check] Missing message file: ${path.relative(process.cwd(), file)}`);
        process.exit(1);
    }
    try {
        messages[lang] = new Map(flatten(JSON.parse(fs.readFileSync(file, 'utf8'))));
    } catch (error) {
        console.error(`[i18n-check] ${lang}.json is not valid JSON: ${error.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// 1. Key parity between languages
// ---------------------------------------------------------------------------

const referenceKeys = [...messages[REFERENCE_LANGUAGE].keys()];

for (const lang of LANGUAGES) {
    if (lang === REFERENCE_LANGUAGE) continue;

    for (const key of referenceKeys) {
        if (!messages[lang].has(key)) {
            problems.push(`${lang}.json is missing the key '${key}' (present in ${REFERENCE_LANGUAGE}.json)`);
        }
    }
    for (const key of messages[lang].keys()) {
        if (!messages[REFERENCE_LANGUAGE].has(key)) {
            problems.push(`${lang}.json defines the key '${key}', absent from ${REFERENCE_LANGUAGE}.json`);
        }
    }
}

// ---------------------------------------------------------------------------
// 2. {{param}} markers preserved across languages
// ---------------------------------------------------------------------------

for (const key of referenceKeys) {
    const expected = placeholders(messages[REFERENCE_LANGUAGE].get(key));

    for (const lang of LANGUAGES) {
        if (lang === REFERENCE_LANGUAGE || !messages[lang].has(key)) continue;

        const found = placeholders(messages[lang].get(key));
        if (found !== expected) {
            problems.push(
                `'${key}': ${REFERENCE_LANGUAGE}.json uses [${expected || '—'}] but ${lang}.json uses [${found || '—'}]`
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Keys referenced from src/ exist in the reference language
// ---------------------------------------------------------------------------

const dynamicReferences = [];

for (const file of collectSourceFiles(SRC_DIR)) {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(process.cwd(), file);

    for (const match of content.matchAll(/getMessage\(\s*(['"`])([^'"`]+)\1/g)) {
        const key = match[2];
        if (!messages[REFERENCE_LANGUAGE].has(key)) {
            problems.push(`${relativePath} references the key '${key}', absent from ${REFERENCE_LANGUAGE}.json`);
        }
    }

    // getMessage(variable) cannot be checked statically — reported as a warning
    for (const match of content.matchAll(/getMessage\(\s*(?!['"`])([A-Za-z_$][\w$.]*)/g)) {
        dynamicReferences.push(`${relativePath}: getMessage(${match[1]}...)`);
    }
}

// ---------------------------------------------------------------------------
// 4. The resolved language reaches the message (SPEC 08 / DEUDA-037, DEUDA-038)
// ---------------------------------------------------------------------------

// A default value for `lang` is what let the leak go unnoticed: it turns a missing argument
// into a silent English response instead of a compilation error.
const LANG_DEFAULT_PATTERNS = [
    { regex: /\blang\s*:\s*string\s*=/g, description: "a default value for 'lang'" },
    { regex: /\blang\s*=\s*['"`]/g, description: "a default value for 'lang'" },
    { regex: /\blang\s*\?\s*:\s*string/g, description: "an optional 'lang'" }
];

const lineOf = (content, index) => content.slice(0, index).split('\n').length;

for (const file of collectSourceFiles(SERVICES_DIR)) {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(process.cwd(), file);

    for (const { regex, description } of LANG_DEFAULT_PATTERNS) {
        for (const match of content.matchAll(regex)) {
            problems.push(
                `${relativePath}:${lineOf(content, match.index)} declares ${description} ('${match[0].trim()}'). ` +
                `Make it a required parameter so a missing language is a compile error.`
            );
        }
    }
}

// getMessage(key) with no language falls back to DEFAULT_LANGUAGE, ignoring what the client asked for.
// The helper itself is excluded: that is where the default legitimately lives.
const SINGLE_ARGUMENT_CALL = /getMessage\(\s*(?:(['"`])[^'"`]+\1|[A-Za-z_$][\w$.]*)\s*\)/g;

for (const file of collectSourceFiles(SRC_DIR)) {
    if (file.startsWith(HELPERS_DIR + path.sep)) continue;

    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(process.cwd(), file);

    for (const match of content.matchAll(SINGLE_ARGUMENT_CALL)) {
        problems.push(
            `${relativePath}:${lineOf(content, match.index)} calls ${match[0]} without a language. ` +
            `Pass the caller's lang as the second argument.`
        );
    }
}

// Reading DEFAULT_LANGUAGE at module load happens before dotenv.config() populates the environment,
// so the value is always the fallback. Only module-level declarations are flagged — a read inside a
// function is exactly the fix.
if (fs.existsSync(I18N_HELPER)) {
    const content = fs.readFileSync(I18N_HELPER, 'utf8');

    for (const match of content.matchAll(/^(?:const|let|var)\s[^\n]*process\.env\.DEFAULT_LANGUAGE/gm)) {
        problems.push(
            `${path.relative(process.cwd(), I18N_HELPER)}:${lineOf(content, match.index)} reads ` +
            `process.env.DEFAULT_LANGUAGE at module load, before dotenv populates it. ` +
            `Resolve it inside a function instead.`
        );
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (dynamicReferences.length > 0) {
    console.warn(`[i18n-check] ${dynamicReferences.length} dynamic reference(s), not verifiable statically:`);
    dynamicReferences.forEach((reference) => console.warn(`  - ${reference}`));
}

if (problems.length > 0) {
    console.error(`[i18n-check] ${problems.length} problem(s) found:`);
    problems.forEach((problem) => console.error(`  - ${problem}`));
    process.exit(1);
}

const keyCount = messages[REFERENCE_LANGUAGE].size;
console.log(`[i18n-check] OK: ${LANGUAGES.join(', ')} with ${keyCount} identical keys each, no unresolved references.`);
process.exit(0);
