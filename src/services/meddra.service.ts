import { AppError, esaviLog, getMessage } from '../helpers';
import {
    getAppConfigBoolean,
    getAppConfigJson,
    getAppConfigString
} from '../helpers/appConfig.helper';
import {
    MEDDRA_CACHE_MAX_ENTRIES,
    MEDDRA_CACHE_TTL_MS,
    MEDDRA_CLIENT_ID_CODE,
    MEDDRA_DEFAULT_LANGUAGE,
    MEDDRA_ENABLED_CODE,
    MEDDRA_LANGUAGE_BY_LANG,
    MEDDRA_OAUTH_SCOPE_CODE,
    MEDDRA_PASSWORD_CODE,
    MEDDRA_REQUEST_TIMEOUT_MS,
    MEDDRA_SCOPE,
    MEDDRA_SEARCH_CONFIG_CODE,
    MEDDRA_SEARCH_URL_CODE,
    MEDDRA_TERM_GROUP_PRECEDENCE,
    MEDDRA_TOKEN_DEFAULT_EXPIRES_IN_SECONDS,
    MEDDRA_TOKEN_EXPIRY_MARGIN_SECONDS,
    MEDDRA_TOKEN_URL_CODE,
    MEDDRA_USERNAME_CODE
} from '../constants/meddra.constants';
import {
    MeddraApiTerm,
    MeddraSearchConfig,
    MeddraSearchResult,
    MeddraSearchRow,
    MeddraTermGroup
} from '../types';

/**
 * MedDRA term search of SPEC F55 §3.5.
 *
 * THE SERVICE WRITES NOTHING. It is a read-only proxy against an external API: no table of its own,
 * no model, no `appDetails` and no `sysDetails`. What the user picks is persisted afterwards by
 * ESAVI-DIAGTERM-006 and ESAVI-NOTIFEVT-001, each with its own differential contract.
 *
 * THE CONFIGURATION IS RESOLVED ON EVERY SEARCH THAT MISSES THE CACHE, and never cached. That is
 * the decision of §6: caching it would make turning `ESAVI_MEDDRA_ENABLED` off, or rotating a
 * credential, wait for a restart — which is the defect the plugin has (`dataStoreConfig.js:7-8`)
 * and the reason this endpoint does not inherit it.
 *
 * THE RESULTS ARE CACHED, for five minutes. MedDRA is a licensed, paid dictionary: the cache is the
 * difference between one call per term and one call per keystroke.
 */

// What `appConfig.helper.ts` throws when there is neither a usable row nor an environment variable.
// The service replaces it with a 503: that MedDRA is unconfigured is not a server fault, it is a
// service this deployment does not offer
const MISSING_CONFIG_CODE = 'APPCONFIG_VALUE_MISSING';

interface MeddraResolvedConfig {
    username: string;
    password: string;
    tokenUrl: string;
    searchUrl: string;
    clientId: string;
    oauthScope: string;
    searchConfig: MeddraSearchConfig;
}

interface MeddraCacheEntry {
    expiresAt: number;
    result: MeddraSearchResult;
}

// Both caches live in the memory of the process. With several instances each one keeps its own,
// which §7 accepts: the cache is a cost optimisation and not a source of truth, and the worst case
// is N calls to the API instead of one
let tokenCache: { token: string; expiresAt: number } | null = null;
const resultCache = new Map<string, MeddraCacheEntry>();

const buildCacheKey = ( language: string, term: string ): string => `${ language }|${ term.trim().toLowerCase() }`;

const readResultCache = ( key: string ): MeddraSearchResult | undefined => {
    const entry = resultCache.get( key );
    if( !entry ) {
        return undefined;
    }
    if( entry.expiresAt <= Date.now() ) {
        resultCache.delete( key );
        return undefined;
    }
    return entry.result;
}

// Purges what expired first and, if the cap is still exceeded, drops the oldest entry. `Map` keeps
// insertion order, so the first key is always the oldest. The cap exists so a client typing without
// pause cannot turn the cache into a memory leak
const writeResultCache = ( key: string, result: MeddraSearchResult ): void => {
    const now = Date.now();
    for( const [ cachedKey, entry ] of resultCache ) {
        if( entry.expiresAt <= now ) {
            resultCache.delete( cachedKey );
        }
    }

    resultCache.set( key, { expiresAt: now + MEDDRA_CACHE_TTL_MS, result } );

    while( resultCache.size > MEDDRA_CACHE_MAX_ENTRIES ) {
        const oldestKey = resultCache.keys().next().value;
        if( oldestKey === undefined ) {
            break;
        }
        resultCache.delete( oldestKey );
    }
}

/**
 * The single outbound call, with the 10 s ceiling of §3.5 point 9 enforced by an `AbortController`.
 * An abort is a 504 and never a 502: the API did not answer badly, it did not answer at all.
 */
const fetchWithTimeout = async ( url: string, init: RequestInit, lang: string ): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout( () => controller.abort(), MEDDRA_REQUEST_TIMEOUT_MS );

    try {
        return await fetch( url, { ...init, signal: controller.signal } );
    } catch ( error ) {
        if( error instanceof Error && error.name === 'AbortError' ) {
            esaviLog( `[ERROR]: ESAVI-MEDDRA-006 - Timeout after ${ MEDDRA_REQUEST_TIMEOUT_MS } ms calling MedDRA`, 'error' );
            throw new AppError( getMessage( 'meddra.timeout', lang ), 504, 'MEDDRA_006_TIMEOUT', error );
        }
        esaviLog( `[ERROR]: ESAVI-MEDDRA-006 - Network failure calling MedDRA: ${ error }`, 'error' );
        throw new AppError( getMessage( 'meddra.searchFailed', lang ), 502, 'MEDDRA_006_SEARCH_FAILED', error );
    } finally {
        clearTimeout( timer );
    }
}

/**
 * §3.5 point 3 — the seven reads of scope MEDDRA, with the precedence SPEC F43 fixed: the
 * `systemConfig` row wins and `.env` is the fallback.
 *
 * A missing value becomes a 503 and never the 500 the resolver throws. Any other error from the
 * resolver — a dead connection, a decryption failure — travels up untouched, because that one IS a
 * server fault.
 */
const resolveMeddraConfig = async ( lang: string ): Promise<MeddraResolvedConfig> => {
    try {
        const [ username, password, tokenUrl, searchUrl, clientId, oauthScope, searchConfig ] = await Promise.all( [
            getAppConfigString( MEDDRA_USERNAME_CODE, MEDDRA_SCOPE, lang ),
            getAppConfigString( MEDDRA_PASSWORD_CODE, MEDDRA_SCOPE, lang ),
            getAppConfigString( MEDDRA_TOKEN_URL_CODE, MEDDRA_SCOPE, lang ),
            getAppConfigString( MEDDRA_SEARCH_URL_CODE, MEDDRA_SCOPE, lang ),
            getAppConfigString( MEDDRA_CLIENT_ID_CODE, MEDDRA_SCOPE, lang ),
            getAppConfigString( MEDDRA_OAUTH_SCOPE_CODE, MEDDRA_SCOPE, lang ),
            getAppConfigJson<MeddraSearchConfig>( MEDDRA_SEARCH_CONFIG_CODE, MEDDRA_SCOPE, lang )
        ] );

        return { username, password, tokenUrl, searchUrl, clientId, oauthScope, searchConfig };
    } catch ( error ) {
        if( error instanceof AppError && error.code === MISSING_CONFIG_CODE ) {
            // The resolved object is never logged: it carries the licence credentials
            esaviLog( `[ERROR]: ESAVI-MEDDRA-006 - MedDRA is enabled but not configured: ${ error.message }`, 'error' );
            throw new AppError( getMessage( 'meddra.notConfigured', lang ), 503, 'MEDDRA_006_NOT_CONFIGURED', error );
        }
        throw error;
    }
}

/**
 * §3.5 point 4 — the search language comes from `req.lang`, with the configured `language` as the
 * fallback and English as the fallback of the fallback. It is the only key of the search body the
 * service rewrites besides `searchterm`.
 */
const resolveSearchLanguage = ( searchConfig: MeddraSearchConfig, lang: string ): string => {
    if( MEDDRA_LANGUAGE_BY_LANG[ lang ] ) {
        return MEDDRA_LANGUAGE_BY_LANG[ lang ];
    }
    if( typeof searchConfig.language === 'string' && searchConfig.language.trim() !== '' ) {
        return searchConfig.language;
    }
    return MEDDRA_DEFAULT_LANGUAGE;
}

/**
 * §3.5 point 5 — the API does not return the level of the term, so it is derived from whichever
 * level flag is true, from the most specific to the most general. A search with no level has no
 * interpretable results, and saying so beats returning rows without a `termGroup`.
 */
const resolveTermGroup = ( searchConfig: MeddraSearchConfig, lang: string ): MeddraTermGroup => {
    const match = MEDDRA_TERM_GROUP_PRECEDENCE.find( level => searchConfig[ level.flag ] === true );

    if( !match ) {
        esaviLog( '[ERROR]: ESAVI-MEDDRA-006 - No level flag is true in ESAVI_MEDDRA_SEARCH_CONFIG', 'error' );
        throw new AppError( getMessage( 'meddra.invalidSearchConfig', lang ), 503, 'MEDDRA_006_INVALID_SEARCH_CONFIG' );
    }
    return match.termGroup;
}

/**
 * §3.5 point 7 — the OAuth2 `password` grant, with the token cached in the memory of the process
 * and the 60 s margin of the plugin (`src/api/auth.js:32`), which keeps a token that expires in
 * flight from being used.
 *
 * A non-2xx answer clears the cache before throwing, so the next attempt asks for a new token
 * instead of retrying with the one that was just discarded.
 */
const getMeddraAuthToken = async ( config: MeddraResolvedConfig, lang: string ): Promise<string> => {
    if( tokenCache && Date.now() < tokenCache.expiresAt ) {
        return tokenCache.token;
    }

    // URLSearchParams escapes its values, so a row holding an ampersand travels encoded and cannot
    // add parameters of its own
    const body = new URLSearchParams( {
        grant_type: 'password',
        username: config.username,
        password: config.password,
        scope: config.oauthScope,
        client_id: config.clientId
    } );

    const response = await fetchWithTimeout(
        config.tokenUrl,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        },
        lang
    );

    if( !response.ok ) {
        tokenCache = null;
        esaviLog( `[ERROR]: ESAVI-MEDDRA-006 - MedDRA token endpoint answered ${ response.status }`, 'error' );
        throw new AppError( getMessage( 'meddra.authFailed', lang ), 502, 'MEDDRA_006_AUTH_FAILED' );
    }

    // Read through an index signature, not through a declared shape: `access_token` and
    // `expires_in` are the OAuth2 names and §4 does not rename what an external contract fixes
    const payload = await response.json() as Record<string, unknown>;
    const accessToken = payload[ 'access_token' ];
    const token = typeof accessToken === 'string' ? accessToken.trim() : '';

    if( token === '' ) {
        tokenCache = null;
        esaviLog( '[ERROR]: ESAVI-MEDDRA-006 - MedDRA token endpoint returned no access_token', 'error' );
        throw new AppError( getMessage( 'meddra.authFailed', lang ), 502, 'MEDDRA_006_AUTH_FAILED' );
    }

    const rawExpiresIn = payload[ 'expires_in' ];
    const expiresIn = typeof rawExpiresIn === 'number' && Number.isFinite( rawExpiresIn )
        ? rawExpiresIn
        : MEDDRA_TOKEN_DEFAULT_EXPIRES_IN_SECONDS;

    tokenCache = {
        token,
        expiresAt: Date.now() + ( expiresIn - MEDDRA_TOKEN_EXPIRY_MARGIN_SECONDS ) * 1000
    };
    return token;
}

// §3.5 point 10 — the raw answer is unwrapped exactly as the plugin does (`src/api/meddra.js:41-42`):
// an array is the list; otherwise `results`, then `data`; otherwise nothing
const unwrapApiTerms = ( payload: unknown ): MeddraApiTerm[] => {
    if( Array.isArray( payload ) ) {
        return payload as MeddraApiTerm[];
    }
    if( payload && typeof payload === 'object' ) {
        const container = payload as Record<string, unknown>;
        if( Array.isArray( container.results ) ) {
            return container.results as MeddraApiTerm[];
        }
        if( Array.isArray( container.data ) ) {
            return container.data as MeddraApiTerm[];
        }
    }
    return [];
}

/**
 * §3.5 point 10 — `pcode` becomes `code`, the `termGroup` is the derived one, malformed rows are
 * dropped in silence and the first appearance wins on duplicates, which is the same criterion
 * `meddraParser.helper.ts` applies when importing the `.asc`.
 *
 * A dropped row never aborts the answer: one row without `pcode` must not bring down a search that
 * returned another nineteen correct ones. The `warn` in the log is what is left of it.
 */
const normalizeApiTerms = ( terms: MeddraApiTerm[], termGroup: MeddraTermGroup ): MeddraSearchRow[] => {
    const rows: MeddraSearchRow[] = [];
    const seen = new Set<string>();
    let discarded = 0;

    for( const term of terms ) {
        const code = term.pcode === undefined || term.pcode === null ? '' : String( term.pcode ).trim();
        const name = term.name === undefined || term.name === null ? '' : String( term.name ).trim();

        if( code === '' || name === '' || seen.has( code ) ) {
            discarded++;
            continue;
        }

        seen.add( code );
        rows.push( { code, name, termGroup } );
    }

    if( discarded > 0 ) {
        esaviLog( `[WARN]: ESAVI-MEDDRA-006 - ${ discarded } MedDRA row(s) discarded as malformed or duplicated`, 'warn' );
    }
    return rows;
}

// ESAVI-MEDDRA-006 - Search MedDRA Terms Service
const searchMeddraTermsService = async ( term: string, lang: string ): Promise<MeddraSearchResult> => {
    // 2. The general switch. A deliberate shutdown, and the client has to be able to tell it apart
    // from a breakdown — hence a 503 and not an empty 200
    const isEnabled = await getAppConfigBoolean( MEDDRA_ENABLED_CODE, MEDDRA_SCOPE, lang );
    if( !isEnabled ) {
        esaviLog( '[ERROR]: ESAVI-MEDDRA-006 - MedDRA term search is disabled in this deployment', 'error' );
        throw new AppError( getMessage( 'meddra.disabled', lang ), 503, 'MEDDRA_006_DISABLED' );
    }

    // 3. The configuration, resolved before any fetch: a deployment with the switch on and no
    // credentials fails here and never spends a call on the licensed API
    const config = await resolveMeddraConfig( lang );

    // 4 and 5
    const language = resolveSearchLanguage( config.searchConfig, lang );
    const termGroup = resolveTermGroup( config.searchConfig, lang );

    // 6. The key carries the language, so the same term in two languages is two entries
    const searchTerm = term.trim();
    const cacheKey = buildCacheKey( language, searchTerm );
    const cached = readResultCache( cacheKey );
    if( cached ) {
        esaviLog( `[INFO]: ESAVI-MEDDRA-006 - MedDRA search served from cache (${ language }): ${ cached.count } row(s)`, 'info' );
        return cached;
    }

    // 7
    const token = await getMeddraAuthToken( config, lang );

    // 8. The whole configured body travels, with exactly two rewrites. The client can alter none of
    // it: there is no query parameter beyond `term`
    const body = {
        ...config.searchConfig,
        language,
        searchterms: [
            { ...config.searchConfig.searchterms[ 0 ], searchterm: searchTerm }
        ]
    };

    const response = await fetchWithTimeout(
        config.searchUrl,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ token }`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify( body )
        },
        lang
    );

    if( !response.ok ) {
        esaviLog( `[ERROR]: ESAVI-MEDDRA-006 - MedDRA search endpoint answered ${ response.status }`, 'error' );
        throw new AppError( getMessage( 'meddra.searchFailed', lang ), 502, 'MEDDRA_006_SEARCH_FAILED' );
    }

    // 10
    const payload = await response.json();
    const rows = normalizeApiTerms( unwrapApiTerms( payload ), termGroup );
    const result: MeddraSearchResult = { count: rows.length, rows };

    writeResultCache( cacheKey, result );

    // 11. Only the operation code, the term and the number of rows are logged — never the resolved
    // configuration, which carries the credentials
    esaviLog( `[INFO]: ESAVI-MEDDRA-006 - MedDRA search for "${ searchTerm }" (${ language }): ${ result.count } row(s)`, 'info' );
    return result;
}

export {
    searchMeddraTermsService
}
