import { AppError } from './appError.helper';
import { getSystemConfigByCodeService } from '../services/systemConfig.service';

/**
 * Configuration resolver of SPEC F43 §3.6 — the precedence rule this repository fixes for the
 * first time: **`systemConfig` wins, `.env` is the fallback**.
 *
 * The order is always the same: the row for the `(code, scope)` pair, reusing the service of
 * ESAVI-SYSCONF-006 so decryption, normalisation and the inactive-row rule are not reimplemented
 * here; if it exists, is active and its value is not empty, that value is returned — already
 * decrypted, because the resolver reads with `canDecrypt` and is not an HTTP caller. If there is
 * no usable row, the environment variable of the same name is read. If there is neither, it
 * throws: ESAVI-AUTH-006 turns that into an `error` log line and a 200, because a 500 when SMTP
 * is unconfigured would be the enumeration oracle §3.5 closes everywhere else.
 *
 * THE SCOPE IS LIMITED TO THE EIGHT CODES OF SPEC F43. ESAVI_APP_DEFAULT_LIMIT and company keep
 * being read from the environment by `pagination.constants.ts` — the general migration is the
 * configuration spec SPEC F26 §2 left pending.
 *
 * NO CACHE, by decision of §2: a password reset is not a hot path — two reads per request — and
 * caching would force an invalidation from ESAVI-SYSCONF-004, a mechanism this spec must not
 * invent. That is also what makes criterion 21 true: a configuration change takes effect on the
 * next send, without restarting the process.
 */

// The resolver is not an HTTP caller and its AppError never reaches a client: ESAVI-AUTH-006 logs
// it and answers 200. The message is therefore technical and not an i18n key — it is a log line
// for whoever can fix the deployment, which is the only audience it has
const MISSING_CONFIG_CODE = 'APPCONFIG_VALUE_MISSING';

// An empty string is "not configured", not "configured as empty": the six MAIL rows are seeded
// empty on purpose (§3.6, the 008 is only-insert) and a seeded-but-unloaded row must fall through
// to the environment instead of shadowing it with ''
const isUsableValue = ( value: unknown ): boolean => {
    if( value === undefined || value === null ) {
        return false;
    }
    if( typeof value === 'string' && value.trim() === '' ) {
        return false;
    }
    return true;
}

// Reads the row, or undefined when there is none to use. A 404 from the 006 is the ordinary
// "this deployment has not seeded it yet" and must fall through to the environment; anything else
// — a decryption failure, a dead connection — is a real problem and travels up untouched
const readSystemConfigValue = async ( code: string, scope: string, lang: string ): Promise<unknown> => {
    try {
        const row = await getSystemConfigByCodeService( code, scope, lang, false, true ) as Record<string, unknown>;
        return row.value;
    } catch ( error ) {
        if( error instanceof AppError && error.statusCode === 404 ) {
            return undefined;
        }
        throw error;
    }
}

/**
 * The raw resolution, shared by the four typed readers. The environment variable is looked up by
 * the code itself: the catalogue writes codes in the shape `toConstantCase` produces, which is
 * exactly the shape of an environment variable name, so there is no mapping table to keep in sync.
 */
const resolveAppConfigValue = async ( code: string, scope: string, lang: string ): Promise<unknown> => {
    const stored = await readSystemConfigValue( code, scope, lang );
    if( isUsableValue( stored ) ) {
        return stored;
    }

    const fromEnv = process.env[ code ];
    if( isUsableValue( fromEnv ) ) {
        return fromEnv;
    }

    throw new AppError(
        `Missing configuration ${ code } (scope ${ scope }): no active systemConfig row with a value and no environment variable`,
        500,
        MISSING_CONFIG_CODE
    );
}

/**
 * Resolves a `string` parameter. A stored value of another `valueType` is serialised rather than
 * rejected: the resolver reads configuration, it does not police the catalogue — that is what the
 * `valueType` guard of ESAVI-SYSCONF-004 is for.
 */
export const getAppConfigString = async ( code: string, scope: string, lang: string ): Promise<string> => {
    const value = await resolveAppConfigValue( code, scope, lang );
    return typeof value === 'string' ? value : String( value );
}

/**
 * Resolves a `number` parameter. The database stores it as a JSON number; the environment can
 * only ever hand back text, so both paths go through the same coercion. A value that is not a
 * finite number throws, because a NaN port or a NaN expiry is worse than no configuration at all.
 */
export const getAppConfigNumber = async ( code: string, scope: string, lang: string ): Promise<number> => {
    const value = await resolveAppConfigValue( code, scope, lang );
    const parsed = typeof value === 'number' ? value : Number( value );

    if( !Number.isFinite( parsed ) ) {
        throw new AppError(
            `Invalid configuration ${ code } (scope ${ scope }): ${ String( value ) } is not a number`,
            500,
            MISSING_CONFIG_CODE
        );
    }
    return parsed;
}

/**
 * Resolves a `boolean` parameter. The database stores a JSON boolean; the environment hands back
 * `'true'` or `'1'`, and anything else is false — the same reading `.env` flags get everywhere
 * else in this repository.
 */
export const getAppConfigBoolean = async ( code: string, scope: string, lang: string ): Promise<boolean> => {
    const value = await resolveAppConfigValue( code, scope, lang );
    if( typeof value === 'boolean' ) {
        return value;
    }
    const normalized = String( value ).trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
}

/**
 * Resolves a `json` parameter. The two paths differ in shape and not only in type: `systemConfig`
 * stores the value in a `jsonb` column and hands back an object already, while the environment can
 * only ever hand back text, so only that path is parsed. A broken document, or one that parses
 * into something that is not an object, throws for the same reason a NaN does in the reader above
 * — a half-read search body would travel to a paid API and fail there instead of here.
 */
export const getAppConfigJson = async <T>( code: string, scope: string, lang: string ): Promise<T> => {
    const value = await resolveAppConfigValue( code, scope, lang );

    let parsed: unknown = value;
    if( typeof value === 'string' ) {
        try {
            parsed = JSON.parse( value );
        } catch {
            throw new AppError(
                `Invalid configuration ${ code } (scope ${ scope }): value is not valid JSON`,
                500,
                MISSING_CONFIG_CODE
            );
        }
    }

    if( typeof parsed !== 'object' || parsed === null ) {
        throw new AppError(
            `Invalid configuration ${ code } (scope ${ scope }): value is not a JSON object`,
            500,
            MISSING_CONFIG_CODE
        );
    }

    return parsed as T;
}
