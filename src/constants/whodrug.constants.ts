// WHODrug mirror & search parameters for SPEC F56.
//
// Nothing that a deployment may want to change lives here: the two credentials, the download URL,
// its params and the search policy are rows of `systemConfig` of scope WHODRUG, read fresh on every
// request through `appConfig.helper.ts`. What lives here is the name of each of those rows and the
// numbers the service must not carry as inline literals.

export const WHODRUG_SCOPE = 'WHODRUG';

export const WHODRUG_ENABLED_CODE = 'ESAVI_WHODRUG_ENABLED';
export const WHODRUG_CLIENT_KEY_CODE = 'ESAVI_WHODRUG_CLIENT_KEY';
export const WHODRUG_LICENSE_KEY_CODE = 'ESAVI_WHODRUG_LICENSE_KEY';
export const WHODRUG_DOWNLOAD_URL_CODE = 'ESAVI_WHODRUG_DOWNLOAD_URL';
export const WHODRUG_DOWNLOAD_PARAMS_CODE = 'ESAVI_WHODRUG_DOWNLOAD_PARAMS';
export const WHODRUG_SEARCH_COUNTRY_CODE = 'ESAVI_WHODRUG_SEARCH_COUNTRY';
export const WHODRUG_SEARCH_EXCLUDED_ATC_CODE = 'ESAVI_WHODRUG_SEARCH_EXCLUDED_ATC';

// The two headers the UMC regional-drugs API expects, per references/external/01_transforme_v3.0.1.py:13-14
export const WHODRUG_CLIENT_KEY_HEADER = 'umc-client-key';
export const WHODRUG_LICENSE_KEY_HEADER = 'umc-license-key';

// Ceiling for the single outbound call of the 007, enforced with an AbortController
export const WHODRUG_DOWNLOAD_TIMEOUT_MS = 60_000;

// Batch size of the 007 writes: each batch runs in its own transaction, per SPEC F19's precedent
export const WHODRUG_BATCH_SIZE = 1000;

export const WHODRUG_SEARCH_DEFAULT_LIMIT = 20;
export const WHODRUG_SEARCH_MAX_LIMIT = 50;
export const WHODRUG_SEARCH_MIN_TERM_LENGTH = 3;
