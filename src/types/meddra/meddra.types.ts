// The five levels of the dictionary, in the precedence order of SPEC F55 §3.5.
// The API does not return the level: it is derived from whichever level flag is true in
// ESAVI_MEDDRA_SEARCH_CONFIG, and the first one in that order wins
export type MeddraTermGroup = 'LLT' | 'PT' | 'HLT' | 'HLGT' | 'SOC';

// What the backend returns per row. It is exactly what the esaviCode / esaviName fields of
// notificationEvent consume, so no consumer has to translate anything
export interface MeddraSearchRow {
    code: string;
    name: string;
    termGroup: MeddraTermGroup;
}

export interface MeddraSearchResult {
    count: number;
    rows: MeddraSearchRow[];
}

// What the external API returns per row. pcode and name are the only guaranteed keys
// (references/external/meddra/.d2/shell/src/D2App/types.ts:1-4); everything else is ignored
export interface MeddraApiTerm {
    pcode?: unknown;
    name?: unknown;
    [key: string]: unknown;
}

// The body of ESAVI_MEDDRA_SEARCH_CONFIG. Only the keys the service reads or rewrites are
// declared; the rest travel untouched to the API
export interface MeddraSearchConfig {
    searchterms: { searchlogic: number; searchterm: string; searchtype: number }[];
    language?: string;
    llt?: boolean;
    pt?: boolean;
    hlt?: boolean;
    hlgt?: boolean;
    soc?: boolean;
    take?: number;
    [key: string]: unknown;
}
