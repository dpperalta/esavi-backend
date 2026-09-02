// The five literals of CK_systemConfig_valueType (esaviapp.sql:375), in lowercase. That they live in
// two places — the CHECK of the DDL and this type — is deliberate: the server does not read Postgres
// constraints to validate input, and a mismatch with the DDL would be a 500 instead of a 400
export type SystemConfigValueType = 'string' | 'number' | 'boolean' | 'json' | 'array';

// The 8 data columns of systemConfig, all writable by the create. The update only mutates five of
// them — name, description, value, valueType and isEditable — because code, scope and isEncrypted are
// immutable, and isActive is governed by the 005A and the 005B.
// value is typed unknown and not Record<string, unknown>: a valueType 'number' stores 42, which is
// valid JSON and is not an object.
// changeReason is the field that breaks the symmetry of the Partial, and it is worth reading twice:
// it travels in the body of the 001 and the 004 but it is NOT a column of systemConfig. It does not
// enter candidates, it is not compared against anything, and its only destination is the
// systemConfigHistory row.
// The update uses Partial<CreateSystemConfigInput>; no UpdateSystemConfigInput is declared
export interface CreateSystemConfigInput {
    code: string;                        // immutable after creation; half of the unique key
    name: string;
    description?: string | null;
    value: unknown;                      // jsonb; its shape is governed by valueType
    valueType?: SystemConfigValueType;   // defaults to 'json'
    scope?: string;                      // defaults to 'GLOBAL'; immutable after creation
    isEncrypted?: boolean;               // immutable after creation
    isEditable?: boolean;
    isActive?: boolean;
    changeReason?: string | null;        // NOT a column of systemConfig: it travels to systemConfigHistory
}

// One entry of the declarative catalogue the 008 seeds from, which lives in
// src/data/systemConfig.defaults.ts and TENDS TO GROW: adding a parameter is adding an entry here and
// calling the endpoint again after deploying.
// Every field is declared explicitly, without leaning on the DEFAULTs of the DDL: a catalogue that is
// read to know what SHOULD exist cannot have holes only the database resolves
export interface SystemConfigDefault {
    code: string;
    name: string;
    description?: string | null;
    value: unknown;
    valueType: SystemConfigValueType;
    scope: string;
    isEncrypted?: boolean;
    isEditable?: boolean;
}

// Query filters of the two listings, identical in both. scope compares for equality against the value
// normalized with toConstantCase, valueType against the five literals of the CHECK. name and code are
// the canonical parameters (SPEC F52), each an Op.iLike over its own column, joined with Op.or; search
// is the legacy alias and already covered both columns before this spec, so it keeps doing so
export interface SystemConfigListFilters {
    scope?: string;
    valueType?: SystemConfigValueType;
    search?: string;
    name?: string;
    code?: string;
}
