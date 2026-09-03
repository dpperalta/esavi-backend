// MedDRA search parameters for SPEC F55.
//
// Nothing that a deployment may want to change lives here: the credentials, the two endpoints, the
// OAuth2 client and the whole search body are rows of `systemConfig` of scope MEDDRA, read fresh on
// every request through `appConfig.helper.ts`. What lives here is the name of each of those rows
// and the six numbers and maps that the service must not carry as inline literals.
import { MeddraTermGroup } from '../types/meddra/meddra.types';

export const MEDDRA_SCOPE = 'MEDDRA';

export const MEDDRA_ENABLED_CODE = 'ESAVI_MEDDRA_ENABLED';
export const MEDDRA_USERNAME_CODE = 'ESAVI_MEDDRA_USERNAME';
export const MEDDRA_PASSWORD_CODE = 'ESAVI_MEDDRA_PASSWORD';
export const MEDDRA_TOKEN_URL_CODE = 'ESAVI_MEDDRA_TOKEN_URL';
export const MEDDRA_SEARCH_URL_CODE = 'ESAVI_MEDDRA_SEARCH_URL';
export const MEDDRA_CLIENT_ID_CODE = 'ESAVI_MEDDRA_CLIENT_ID';
export const MEDDRA_OAUTH_SCOPE_CODE = 'ESAVI_MEDDRA_OAUTH_SCOPE';
export const MEDDRA_SEARCH_CONFIG_CODE = 'ESAVI_MEDDRA_SEARCH_CONFIG';

// The search language is derived from `req.lang`, not from the configuration: a trilingual backend
// that always answered in Spanish would force the frontend to show a language the user did not
// choose. The configured `language` is the fallback, and English the fallback of the fallback
export const MEDDRA_LANGUAGE_BY_LANG: Record<string, string> = {
    es: 'Spanish',
    en: 'English',
    nl: 'Dutch'
};

export const MEDDRA_DEFAULT_LANGUAGE = 'English';

// The API does not return the level of the term, so it is derived from whichever level flag the
// search body carries in `true`. The order runs from the most specific to the most general and the
// first match wins; with the seeded configuration (`llt: true`) every row comes out as LLT
export const MEDDRA_TERM_GROUP_PRECEDENCE: { flag: string; termGroup: MeddraTermGroup }[] = [
    { flag: 'llt', termGroup: 'LLT' },
    { flag: 'pt', termGroup: 'PT' },
    { flag: 'hlt', termGroup: 'HLT' },
    { flag: 'hlgt', termGroup: 'HLGT' },
    { flag: 'soc', termGroup: 'SOC' }
];

// MedDRA is a licensed, paid dictionary: the cache is the difference between one call per term and
// one call per keystroke. The cap keeps a client that types without pause from turning the cache
// into a memory leak
export const MEDDRA_CACHE_TTL_MS = 300_000;
export const MEDDRA_CACHE_MAX_ENTRIES = 500;

// The 60 s margin is the plugin's (`src/api/auth.js:32`) and keeps a token that expires in flight
// from being used. 3600 s is the fallback when the token endpoint omits `expires_in`
export const MEDDRA_TOKEN_EXPIRY_MARGIN_SECONDS = 60;
export const MEDDRA_TOKEN_DEFAULT_EXPIRES_IN_SECONDS = 3600;

// Ceiling for each of the two outbound calls — token and search — enforced with an AbortController
export const MEDDRA_REQUEST_TIMEOUT_MS = 10_000;
