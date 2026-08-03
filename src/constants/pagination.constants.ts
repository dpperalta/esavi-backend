export const DEFAULT_LIMIT = process.env.ESAVI_APP_DEFAULT_LIMIT
    ? parseInt(process.env.ESAVI_APP_DEFAULT_LIMIT) : 10;

export const DEFAULT_OFFSET = process.env.ESAVI_APP_DEFAULT_OFFSET
    ? parseInt(process.env.ESAVI_APP_DEFAULT_OFFSET) : 0;

export const MAX_LIMIT = 100;
