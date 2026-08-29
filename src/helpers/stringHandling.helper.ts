
// Convert text to camelCase
export const toCamelCase = (text: string): string => {
    return text.trim().split(/[\s_-]+/).map((word, index) => {
        if (index === 0) {
            return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join('');
}

// Mint a code out of the name it belongs to. toTitleCase runs first on purpose: toCamelCase
// lowercases only the first word and keeps the case of the rest, so 'Pharmaceutical FORM' and
// 'pharmaceutical form' would otherwise mint two different codes for the same name. Passing through
// the title case makes the function idempotent — the code of a stored name is the same code the
// stored name mints again — which is what lets a differential update and a reimport see no change
export const toCodeFromName = (text: string): string => {
    return toCamelCase(toTitleCase(text.trim()));
}

// Normalize a code the client sends into camelCase. Unlike toCodeFromName it also splits on the
// camel humps of the input, which is what makes it idempotent over an already normalized code:
// toCamelCase and toCodeFromName both flatten 'pharmaceuticalForm' into 'pharmaceuticalform',
// so resending the stored code would stop matching its own row. Here 'pharmaceuticalForm',
// 'Pharmaceutical Form' and 'PHARMACEUTICAL_FORM' all mint 'pharmaceuticalForm'.
// An all-caps word is left as one word on purpose: splitting 'FORM' hump by hump would mint
// 'fORM'. Any character that is not a letter or a digit acts as a separator
export const toCodeFromInput = (text: string): string => {
    const words = text
        .trim()
        // A lower-to-upper boundary is a hump. A digit-to-letter one is not, so 'tipoEvento2'
        // keeps its digits attached to the word they belong to
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        // The end of a run of capitals is a hump too, when a capitalized word starts right after:
        // without this, 'tipoAMano' would fold into 'tipoAmano' and the function would stop being
        // idempotent over the very codes it mints
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter((word) => word.length > 0);

    return words.map((word, index) => {
        const lower = word.toLowerCase();
        return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('');
}

// Convert text to snake_case
export const toSnakeCase = (text: string): string => {
    return text.replace(/([A-Z])/g, (match) => {
        return '_' + match.toLowerCase();
    });
}

// Convert text to PascalCase
export const toPascalCase = (text: string): string => {
    const camelCase = toCamelCase(text);
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
}

// Return only alphanumeric characters and underscores, and convert to uppercase
export const toConstantCase = (text: string): string => {
    return text.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

// Convert text to kebab-case
export const toKebabCase = (text: string): string => {
    return text.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase();
}

// Convert text to Title Case
export const toTitleCase = (text: string): string => {
    return text.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

// Convert text to sentence case
export const toSentenceCase = (text: string): string => {
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Convert text to a URL-friendly slug
export const toSlug = (text: string): string => {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Truncate text to a specified length and add ellipsis if needed
export const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) {
        return text;
    }   
    return text.slice(0, maxLength - 3) + '...';    
}

// Remove all whitespace from the text
export const removeWhitespace = (text: string): string => {
    return text.replace(/\s+/g, '');
}

// Return only text without numbers
export const removeNumbers = (text: string): string => {
    return text.replace(/[0-9]/g, '');
}

// Return only numbers from the text
export const extractNumbers = (text: string): string => {
    return text.replace(/[^0-9]/g, '');
}

// The search form of a name: trim, collapse internal whitespace, strip diacritics via NFD
// decomposition, and uppercase. Idempotent over its own output, which is what lets it feed a
// differential update without inventing a difference on every read-modify-write. Decomposing also
// folds 'ñ' into 'n' plus a combining tilde that this then strips — deliberate, see toNameTokens
export const toSearchForm = (text: string): string => {
    return text
        .trim()
        .replace(/\s+/g, ' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
}

// Split one or more name components into their encrypted-index tokens: apply toSearchForm to each,
// split on spaces, drop empties, and de-duplicate. Particles ('DE', 'DEL', 'LA') are indexed like
// any other token on purpose — a stop-word list would be one more place the index and the query
// could disagree. 'Muñoz' mints 'MUNOZ', same as 'Munoz': ñ is folded away by toSearchForm's NFD
// step, so the two spellings become the same patient for search purposes
export const toNameTokens = (...values: string[]): string[] => {
    const tokens = values
        .flatMap((value) => toSearchForm(value).split(' '))
        .filter((token) => token.length > 0);

    return [...new Set(tokens)];
}

// Normalize a time of day into the 'HH:mm:ss' form Postgres returns for a `time` column.
// Accepts 'HH:mm' and 'HH:mm:ss' and is idempotent over its own output, which is what makes it
// usable inside a differential update: without it a client sending '14:30' over a stored
// '14:30:00' would produce an invented difference on every open of the form. Any input that is
// not a time is returned trimmed and untouched — the shape is the validator's job, not this one's
export const toTimeString = (text: string): string => {
    const trimmed = text.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
        return trimmed;
    }

    const [, hours, minutes, seconds] = match;
    return `${hours.padStart(2, '0')}:${minutes}:${seconds ?? '00'}`;
}