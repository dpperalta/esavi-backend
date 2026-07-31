import es from '../data/i18n/es.json';
import en from '../data/i18n/en.json';
import nd from '../data/i18n/nd.json';

const messages = {
    es,
    en,
    nd
};

type lang = keyof typeof messages;

const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE as lang || 'en';

export const getMessage = (key: string, lang: string = DEFAULT_LANGUAGE, params = {}): string => {
    const selectedLang = messages[lang as lang] ? (lang as lang) : DEFAULT_LANGUAGE;
    
    const keys = key.split('.');
    let value: any = messages[selectedLang];
    
    for( const k of keys ) {
        value = value?.[k];
        if (value === undefined) {
            return '';
        }
    }
    if( params ){
        const newParam: Record<string, string> = params as Record<string, string>;
        Object.entries(newParam).forEach(([key, data]) => {
            value = value.replace(`{{${key}}}`, data);
        });
    }

    return typeof value === 'string' ? value : '';
}