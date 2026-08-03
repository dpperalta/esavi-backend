import es from '../data/i18n/es.json';
import en from '../data/i18n/en.json';
import nl from '../data/i18n/nl.json';
import { esaviLog } from './esaviLogs.helper';

const messages = {
    es,
    en,
    nl
};

export type Lang = keyof typeof messages;

// The languages that actually have a catalogue, regardless of what SUPPORTED_LANGUAGES claims.
export const AVAILABLE_LANGUAGES = Object.keys(messages) as Lang[];

const FALLBACK_LANGUAGE: Lang = 'es';

// Resolved on every call, never at module load: the import graph reaches this module before
// dotenv.config() runs in index.ts, so a module-level read would always miss the environment.
export const getDefaultLanguage = (): Lang => {
    const fromEnv = process.env.DEFAULT_LANGUAGE;

    return fromEnv && messages[fromEnv as Lang] ? (fromEnv as Lang) : FALLBACK_LANGUAGE;
}

// Walks the dot-path of a key inside a single language file. Returns undefined when the key is absent.
const resolveKey = (key: string, selectedLang: Lang): string | undefined => {
    let value: any = messages[selectedLang];

    for( const k of key.split('.') ) {
        value = value?.[k];
        if (value === undefined) {
            return undefined;
        }
    }

    return typeof value === 'string' ? value : undefined;
}

export const getMessage = (key: string, lang: string = getDefaultLanguage(), params = {}): string => {
    const defaultLanguage = getDefaultLanguage();
    const selectedLang = messages[lang as Lang] ? (lang as Lang) : defaultLanguage;

    // 1. key in the requested language
    let value = resolveKey(key, selectedLang);

    // 2. key in DEFAULT_LANGUAGE
    if (value === undefined && selectedLang !== defaultLanguage) {
        value = resolveKey(key, defaultLanguage);
        if (value !== undefined) {
            esaviLog(`[i18n]: Missing key '${ key }' for language '${ selectedLang }'. Falling back to '${ defaultLanguage }'.`, 'warn');
        }
    }

    // 3. key missing in every language: the key itself is returned so the failure is visible
    if (value === undefined) {
        esaviLog(`[i18n]: Missing key '${ key }' in every supported language. Returning the key itself.`, 'error');
        return key;
    }

    if( params ){
        const newParam: Record<string, string> = params as Record<string, string>;
        Object.entries(newParam).forEach(([key, data]) => {
            value = (value as string).replace(`{{${key}}}`, data);
        });
    }

    return value;
}
