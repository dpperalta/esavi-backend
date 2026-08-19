import {
    isValidSystemConfigValue,
    isEncryptedValue,
    encryptSystemConfigValue,
    decryptSystemConfigValue,
    SYSTEM_CONFIG_VALUE_TYPES
} from '../../src/helpers/systemConfigValue.helper';

// The three domain rules of systemConfig.value are pure functions, so they live in a unit suite and
// not in the contract one: covering the cross validation over HTTP would cost a POST per cell of the
// table of §3.5, and what is under test is the rule, not an endpoint.
// The encryption round trip does belong here too, and for a sharper reason: the diff of the 004
// compares plain text against plain text, so "encrypt then decrypt gives back the same value" is the
// invariant the whole differential contract of an encrypted row rests on
describe('systemConfigValue helper', () => {

    describe('isValidSystemConfigValue — the cross validation table of §3.5', () => {

        describe("valueType 'string'", () => {
            it('accepts a string', () => {
                expect(isValidSystemConfigValue('42', 'string')).toBe(true);
            });
            it('rejects a number', () => {
                expect(isValidSystemConfigValue(42, 'string')).toBe(false);
            });
            it('rejects null', () => {
                expect(isValidSystemConfigValue(null, 'string')).toBe(false);
            });
        });

        describe("valueType 'number'", () => {
            it('accepts a finite number', () => {
                expect(isValidSystemConfigValue(42, 'number')).toBe(true);
            });
            it('accepts 0, which is falsy and still a number', () => {
                expect(isValidSystemConfigValue(0, 'number')).toBe(true);
            });
            it('rejects the numeric string "42"', () => {
                expect(isValidSystemConfigValue('42', 'number')).toBe(false);
            });
            it('rejects NaN and Infinity, which are not JSON', () => {
                expect(isValidSystemConfigValue(NaN, 'number')).toBe(false);
                expect(isValidSystemConfigValue(Infinity, 'number')).toBe(false);
            });
            it('rejects null: the consumer must be able to trust the type without checking it', () => {
                expect(isValidSystemConfigValue(null, 'number')).toBe(false);
            });
        });

        describe("valueType 'boolean'", () => {
            it('accepts true and false', () => {
                expect(isValidSystemConfigValue(true, 'boolean')).toBe(true);
                expect(isValidSystemConfigValue(false, 'boolean')).toBe(true);
            });
            it('rejects the string "true"', () => {
                expect(isValidSystemConfigValue('true', 'boolean')).toBe(false);
            });
            it('rejects null', () => {
                expect(isValidSystemConfigValue(null, 'boolean')).toBe(false);
            });
        });

        describe("valueType 'array'", () => {
            it('accepts an array, the empty one included', () => {
                expect(isValidSystemConfigValue(['es', 'en'], 'array')).toBe(true);
                expect(isValidSystemConfigValue([], 'array')).toBe(true);
            });
            it('rejects an object, which is not an array', () => {
                expect(isValidSystemConfigValue({ 0: 'es' }, 'array')).toBe(false);
            });
            it('rejects null', () => {
                expect(isValidSystemConfigValue(null, 'array')).toBe(false);
            });
        });

        describe("valueType 'json'", () => {
            it('accepts an object', () => {
                expect(isValidSystemConfigValue({ limit: 10 }, 'json')).toBe(true);
            });
            it('accepts null: it is the only valueType null is legitimate under', () => {
                expect(isValidSystemConfigValue(null, 'json')).toBe(true);
            });
            it('accepts the scalars too — json is the widest type, not the object type', () => {
                expect(isValidSystemConfigValue(42, 'json')).toBe(true);
                expect(isValidSystemConfigValue('text', 'json')).toBe(true);
                expect(isValidSystemConfigValue(false, 'json')).toBe(true);
                expect(isValidSystemConfigValue([1, 2], 'json')).toBe(true);
            });
            it('rejects what is not JSON serializable', () => {
                expect(isValidSystemConfigValue(() => 1, 'json')).toBe(false);
                expect(isValidSystemConfigValue(Symbol('x'), 'json')).toBe(false);
            });
        });

        it('rejects undefined under every valueType: it is how "the key did not travel" is spelled', () => {
            for( const valueType of SYSTEM_CONFIG_VALUE_TYPES ) {
                expect(isValidSystemConfigValue(undefined, valueType)).toBe(false);
            }
        });

        it('mirrors CK_systemConfig_valueType: exactly the five lowercase literals', () => {
            expect(SYSTEM_CONFIG_VALUE_TYPES).toEqual(['string', 'number', 'boolean', 'json', 'array']);
        });
    });

    describe('encrypt / decrypt round trip', () => {

        it('gives back the same object by JSON.stringify', () => {
            const value = { maxUploadMb: 20, allowed: ['pdf', 'xlsx'], nested: { deep: true } };
            const decrypted = decryptSystemConfigValue(encryptSystemConfigValue(value));
            expect(JSON.stringify(decrypted)).toBe(JSON.stringify(value));
        });

        it('gives back the scalars with their type intact, not stringified', () => {
            expect(decryptSystemConfigValue(encryptSystemConfigValue(42))).toBe(42);
            expect(decryptSystemConfigValue(encryptSystemConfigValue('secret'))).toBe('secret');
            expect(decryptSystemConfigValue(encryptSystemConfigValue(false))).toBe(false);
            expect(decryptSystemConfigValue(encryptSystemConfigValue(null))).toBeNull();
        });

        it('wraps the ciphertext under the single key enc', () => {
            const wrapped = encryptSystemConfigValue({ token: 'super-secret' });
            expect(Object.keys(wrapped)).toEqual(['enc']);
            expect(typeof wrapped.enc).toBe('string');
        });

        it('does not leave the plain text inside what is stored', () => {
            const wrapped = encryptSystemConfigValue({ token: 'super-secret' });
            expect(JSON.stringify(wrapped)).not.toContain('super-secret');
        });
    });

    describe('isEncryptedValue — the guard that keeps a cipher error from becoming a 500', () => {

        it('recognizes what encryptSystemConfigValue produced', () => {
            expect(isEncryptedValue(encryptSystemConfigValue('x'))).toBe(true);
        });

        it('rejects a plain object, an array, null and a scalar', () => {
            expect(isEncryptedValue({ limit: 10 })).toBe(false);
            expect(isEncryptedValue(['enc'])).toBe(false);
            expect(isEncryptedValue(null)).toBe(false);
            expect(isEncryptedValue('enc')).toBe(false);
        });

        it('rejects an object whose enc is not a string', () => {
            expect(isEncryptedValue({ enc: 42 })).toBe(false);
        });
    });

    describe('decryptSystemConfigValue over what is not wrapped', () => {

        it('returns the value untouched instead of throwing', () => {
            expect(decryptSystemConfigValue({ limit: 10 })).toEqual({ limit: 10 });
            expect(decryptSystemConfigValue(null)).toBeNull();
            expect(decryptSystemConfigValue(42)).toBe(42);
        });
    });
});
