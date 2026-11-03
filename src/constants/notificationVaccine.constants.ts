export const BATCH_NUMBER_NORMALIZED_SQL = (alias: string): string =>
    `upper(regexp_replace(${ alias }."batchNumber", '[^A-Za-z0-9]', '', 'g'))`;

export const VACCINE_KEY_SQL = (alias: string): string => `CASE WHEN ${ alias }."vaccineWhodrugId" IS NOT NULL
                    THEN 'W:' || ${ alias }."vaccineWhodrugId"::text
                    ELSE 'T:' || upper(btrim(COALESCE(${ alias }."vaccineName", '')))
                END`;

export const normalizeBatchNumber = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const VACCINE_KEY_PATTERN = /^(W:[0-9a-f-]{36}|T:.*)$/i;
