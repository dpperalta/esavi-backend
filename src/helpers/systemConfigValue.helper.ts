// The three domain rules of systemConfig.value, in one place because six operations need them:
// the 001, the 004 and the 008 validate, the 001, the 004 and the 008 encrypt, and the 003, the 006
// and the 007 decrypt.
//
// WHY THE VALIDATION LIVES HERE AND NOT IN A VALIDATOR. The 004 has to check the value against the
// *resulting* valueType — the one in the body if it travels, the stored one if it does not — and an
// express-validator chain does not query the database. It is the declared exception to the rule that
// every 400 comes out of validateFields.
//
// WHY THE CIPHERTEXT TRAVELS WRAPPED. The column is jsonb NOT NULL and esaviCrypt returns text.
// Storing the bare string as a JSON string would work, but it would make an encrypted value
// indistinguishable from any valueType 'string' by looking at the database. The `enc` key is the mark.

import { esaviCrypt, esaviDecrypt } from './crypto.helper';
import { SystemConfigValueType } from '../types';

// Mirrors CK_systemConfig_valueType (esaviapp.sql:375). Exported so the validators of the 002A, the
// 002B and the 001 can restrict their input to the same five literals without redeclaring them
const SYSTEM_CONFIG_VALUE_TYPES: SystemConfigValueType[] = ['string', 'number', 'boolean', 'json', 'array'];

// The wrapper an encrypted value is stored as: { "enc": "<ciphertext>" }
interface EncryptedValue {
    enc: string;
}

// Cross validation of value against valueType.
//
// null is legitimate JSON and is accepted ONLY under valueType 'json': a valueType 'number' exists so
// the consumer can trust the type without checking it, and a null forces it to check anyway.
// undefined is never a value — it is not JSON serializable, and it is how "the key did not travel"
// is spelled everywhere else in the pipeline
const isValidSystemConfigValue = (value: unknown, valueType: SystemConfigValueType): boolean => {
    if( value === undefined ) {
        return false;
    }
    switch( valueType ) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'json':
            // Any JSON serializable value, null included. A function, a symbol or a BigInt is not,
            // and JSON.stringify betrays each of them in a different way, so the round trip is the
            // only honest check
            try {
                return JSON.stringify(value) !== undefined;
            } catch {
                return false;
            }
        default:
            return false;
    }
}

// Type guard over what came back from the column. It does not trust isEncrypted alone: a row whose
// flag says true but whose value is not wrapped would throw inside esaviDecrypt with a cipher error
// instead of answering something readable
const isEncryptedValue = (value: unknown): value is EncryptedValue => {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as EncryptedValue).enc === 'string'
    );
}

// Plain text -> { enc: "<ciphertext>" }. The value is serialized first because esaviCrypt takes text
// and the column holds anything JSON: a valueType 'number' encrypts "42", not 42
const encryptSystemConfigValue = (value: unknown): EncryptedValue => {
    return { enc: esaviCrypt(JSON.stringify(value)) };
}

// The inverse. It is the function the diff of the 004 depends on: `stored.value` is decrypted BEFORE
// building `stored`, so buildDifferentialUpdate compares plain text against plain text and
// esaviCrypt is applied afterwards, over the keys the helper returned.
// Comparing ciphertext instead would work only while the IV of esaviCrypt stays fixed, and the day it
// turns random every PUT would look like a change and would write a history row per screen opening.
// A value that is not wrapped is returned untouched: that is a row whose flag was raised without its
// content ever having been encrypted, and a cipher exception would be a 500 where the honest answer
// is the value as it is stored
const decryptSystemConfigValue = (value: unknown): unknown => {
    if( !isEncryptedValue(value) ) {
        return value;
    }
    return JSON.parse(esaviDecrypt(value.enc));
}

export {
    SYSTEM_CONFIG_VALUE_TYPES,
    isValidSystemConfigValue,
    isEncryptedValue,
    encryptSystemConfigValue,
    decryptSystemConfigValue
}
