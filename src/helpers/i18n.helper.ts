import es from '../data/i18n/es.json';
import en from '../data/i18n/en.json';
import nl from '../data/i18n/nl.json';
import { esaviLog } from './esaviLogs.helper';

const messages = {
    es,
    en,
    nl
};

type Lang = keyof typeof messages;

const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE as Lang || 'en';

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

export const getMessage = (key: string, lang: string = DEFAULT_LANGUAGE, params = {}): string => {
    const selectedLang = messages[lang as Lang] ? (lang as Lang) : DEFAULT_LANGUAGE;

    // 1. key in the requested language
    let value = resolveKey(key, selectedLang);

    // 2. key in DEFAULT_LANGUAGE
    if (value === undefined && selectedLang !== DEFAULT_LANGUAGE) {
        value = resolveKey(key, DEFAULT_LANGUAGE);
        if (value !== undefined) {
            esaviLog(`[i18n]: Missing key '${ key }' for language '${ selectedLang }'. Falling back to '${ DEFAULT_LANGUAGE }'.`, 'warn');
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
