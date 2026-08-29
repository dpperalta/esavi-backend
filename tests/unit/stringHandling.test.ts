import { toCamelCase, toCodeFromInput, toCodeFromName, toNameTokens, toSearchForm } from '../../src/helpers';

/**
 * toCodeFromInput normalizes the code a client sends. What separates it from the two functions that
 * were already there is idempotence: it is the only one that can read back a code it wrote.
 */
describe('toCodeFromInput', () => {

    it('mints the same code out of every spelling of the same words', () => {
        expect(toCodeFromInput('pharmaceuticalForm')).toBe('pharmaceuticalForm');
        expect(toCodeFromInput('Pharmaceutical Form')).toBe('pharmaceuticalForm');
        expect(toCodeFromInput('PHARMACEUTICAL_FORM')).toBe('pharmaceuticalForm');
        expect(toCodeFromInput('pharmaceutical-form')).toBe('pharmaceuticalForm');
        expect(toCodeFromInput('  Pharmaceutical   FORM  ')).toBe('pharmaceuticalForm');
    });

    it('is idempotent, which the two functions before it are not', () => {
        const once = toCodeFromInput('Pharmaceutical Form');

        expect(toCodeFromInput(once)).toBe(once);
        // The reason this function exists: both of these flatten a code that is already camelCase,
        // so resending the stored value would stop matching its own row
        expect(toCamelCase(once)).toBe('pharmaceuticalform');
        expect(toCodeFromName(once)).toBe('pharmaceuticalform');
    });

    it('splits at the end of a run of capitals, so a one-letter word survives the round trip', () => {
        expect(toCodeFromInput('TIPO_A_MANO')).toBe('tipoAMano');
        expect(toCodeFromInput('tipoAMano')).toBe('tipoAMano');
        expect(toCodeFromInput('PHARMACEUTICALForm')).toBe('pharmaceuticalForm');
    });

    it('keeps digits attached to the word they belong to', () => {
        expect(toCodeFromInput('tipoEvento2')).toBe('tipoEvento2');
        expect(toCodeFromInput('tipo evento 2')).toBe('tipoEvento2');
    });

    it('drops every character that is not a letter or a digit', () => {
        expect(toCodeFromInput('tipo/evento (grave)')).toBe('tipoEventoGrave');
    });

    it('returns an empty string when there is nothing to mint, which the services turn into a 400', () => {
        expect(toCodeFromInput('---')).toBe('');
        expect(toCodeFromInput('   ')).toBe('');
    });

});

/**
 * toSearchForm is the encrypted-index search key for SPEC F47: trim, collapse whitespace,
 * strip diacritics and uppercase. It must be idempotent — the differential update in
 * patient.service.ts recomputes nameTokens on every write and compares them as plaintext.
 */
describe('toSearchForm', () => {

    it('trims, collapses internal whitespace, strips diacritics and uppercases', () => {
        expect(toSearchForm('  María  del Cisne ')).toBe('MARIA DEL CISNE');
    });

    it('is idempotent over its own output', () => {
        const once = toSearchForm('  María  del Cisne ');

        expect(toSearchForm(once)).toBe(once);
    });

    it('folds ñ into n, which is deliberate — see toNameTokens', () => {
        expect(toSearchForm('Muñoz')).toBe('MUNOZ');
    });

});

/**
 * toNameTokens splits one or more name components into the tokens that get encrypted one by one
 * and stored in patient.nameTokens (SPEC F47 §3.3). No stop-word list: particles are tokens too.
 */
describe('toNameTokens', () => {

    it('tokenizes one component into its search-form words', () => {
        expect(toNameTokens('Muñoz')).toEqual(['MUNOZ']);
    });

    it('tokenizes several components together and drops duplicates', () => {
        expect(toNameTokens('María del Cisne', 'Torres Vega')).toEqual(['MARIA', 'DEL', 'CISNE', 'TORRES', 'VEGA']);
        expect(toNameTokens('Torres Torres', 'Torres')).toEqual(['TORRES']);
    });

    it('indexes particles like any other token, with no stop-word list', () => {
        expect(toNameTokens('de la Torre')).toEqual(['DE', 'LA', 'TORRE']);
    });

});
