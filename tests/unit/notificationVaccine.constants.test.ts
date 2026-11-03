import { normalizeBatchNumber, VACCINE_KEY_PATTERN } from '../../src/constants/notificationVaccine.constants';

describe('normalizeBatchNumber', () => {

    it('uppercases and strips every non-alphanumeric character', () => {
        expect(normalizeBatchNumber(' ab-12.3 ')).toBe('AB123');
        expect(normalizeBatchNumber('AB 123')).toBe('AB123');
        expect(normalizeBatchNumber('ab-123')).toBe('AB123');
        expect(normalizeBatchNumber('AB.123')).toBe('AB123');
    });

    it('collapses to an empty string when nothing alphanumeric remains', () => {
        expect(normalizeBatchNumber('--')).toBe('');
        expect(normalizeBatchNumber('   ')).toBe('');
    });

    it('drops letters outside A-Z, as the SQL expression does', () => {
        expect(normalizeBatchNumber('lote-ñ1')).toBe('LOTE1');
        expect(normalizeBatchNumber('Á12')).toBe('12');
    });
});

describe('VACCINE_KEY_PATTERN', () => {

    it('accepts a WHODrug key and a free-text key', () => {
        expect(VACCINE_KEY_PATTERN.test('W:0b9c5a8e-1f2d-4c3b-9a7e-6d5c4b3a2f10')).toBe(true);
        expect(VACCINE_KEY_PATTERN.test('T:PFIZER')).toBe(true);
        expect(VACCINE_KEY_PATTERN.test('T:')).toBe(true);
    });

    it('rejects any other shape', () => {
        expect(VACCINE_KEY_PATTERN.test('X:foo')).toBe(false);
        expect(VACCINE_KEY_PATTERN.test('W:not-a-uuid')).toBe(false);
        expect(VACCINE_KEY_PATTERN.test('PFIZER')).toBe(false);
    });
});
