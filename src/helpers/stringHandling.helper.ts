
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