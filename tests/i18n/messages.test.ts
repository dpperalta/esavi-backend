import request from 'supertest';
import { app } from '../../src/app';
import { getMessage } from '../../src/helpers/i18n.helper';
import es from '../../src/data/i18n/es.json';
import en from '../../src/data/i18n/en.json';
import nl from '../../src/data/i18n/nl.json';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';

const CATALOGS = { es, en, nl } as const;
const LANGUAGES = Object.keys(CATALOGS) as Array<keyof typeof CATALOGS>;

const UUID = '00000000-0000-4000-8000-000000000000';

/** Flattens a catalog into its dot-paths, the same shape `getMessage` walks. */
const flatten = ( source: Record<string, unknown>, prefix = '' ): Record<string, string> =>
    Object.entries(source).reduce<Record<string, string>>((accumulator, [key, value]) => {
        const path = prefix ? `${ prefix }.${ key }` : key;

        if( value !== null && typeof value === 'object' ) {
            return { ...accumulator, ...flatten(value as Record<string, unknown>, path) };
        }

        accumulator[path] = String(value);
        return accumulator;
    }, {});

const FLAT = {
    es: flatten(es),
    en: flatten(en),
    nl: flatten(nl)
};

/**
 * `getMessage` returns the key itself when it is missing everywhere, so a
 * message that still looks like a dot-path is an unresolved key, not a message.
 */
const looksLikeAKey = ( message: string ): boolean => /^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/.test(message);

describe('i18n', () => {

    let consoleError: jest.SpyInstance;
    const suffix = Date.now().toString(36);

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('catalog parity', () => {

        it('the three catalogs declare the same keys', () => {
            const reference = Object.keys(FLAT.es).sort();

            expect(Object.keys(FLAT.en).sort()).toEqual(reference);
            expect(Object.keys(FLAT.nl).sort()).toEqual(reference);
        });

        it.each(LANGUAGES)('%s has no empty value', ( lang ) => {
            const empty = Object.entries(FLAT[lang])
                .filter(([, value]) => value.trim().length === 0)
                .map(([key]) => key);

            expect(empty).toEqual([]);
        });

        it.each(LANGUAGES)('%s declares every key of the canonical catalog', ( lang ) => {
            const missing = Object.keys(FLAT.es).filter(key => FLAT[lang][key] === undefined);

            expect(missing).toEqual([]);
        });

    });

    describe('getMessage', () => {

        it('returns the key itself when it is missing in every language', () => {
            expect(getMessage('nope.doesNotExist', 'es')).toBe('nope.doesNotExist');
            expect(getMessage('nope.doesNotExist', 'nl')).toBe('nope.doesNotExist');
        });

        it.each(LANGUAGES)('resolves a known key in %s', ( lang ) => {
            const message = getMessage('common.internalError', lang);

            expect(message.length).toBeGreaterThan(0);
            expect(looksLikeAKey(message)).toBe(false);
        });

        it('falls back to an unsupported language instead of returning empty', () => {
            const message = getMessage('common.internalError', 'xx');

            expect(message.length).toBeGreaterThan(0);
            expect(looksLikeAKey(message)).toBe(false);
        });

    });

    describe('responses carry a resolved message in every language', () => {

        // One duplicate to make the 409 path reachable from each language
        beforeAll(async () => {
            await request(app)
                .post('/api/catalog-types')
                .set(authHeader('ADMIN'))
                .send({ code: `i18nType${ suffix }`, name: `I18n type ${ suffix }` });
        });

        describe.each(LANGUAGES)('lang=%s', ( lang ) => {

            const expectResolvedMessage = ( body: { message?: string } ): void => {
                expect(typeof body.message).toBe('string');
                expect((body.message as string).trim().length).toBeGreaterThan(0);
                expect(looksLikeAKey(body.message as string)).toBe(false);
            };

            it('200 on a list', async () => {
                const response = await request(app)
                    .get(`/api/catalog-types?lang=${ lang }`)
                    .set(authHeader('USER'));

                expect(response.status).toBe(200);
                expectResolvedMessage(response.body);
            });

            it('404 on a nonexistent id', async () => {
                const response = await request(app)
                    .get(`/api/catalog-types/${ UUID }?lang=${ lang }`)
                    .set(authHeader('USER'));

                expect(response.status).toBe(404);
                expectResolvedMessage(response.body);
            });

            it('409 on a duplicate', async () => {
                const response = await request(app)
                    .post(`/api/catalog-types?lang=${ lang }`)
                    .set(authHeader('ADMIN'))
                    .send({ code: `i18nType${ suffix }`, name: `I18n type ${ suffix }` });

                expect(response.status).toBe(409);
                expectResolvedMessage(response.body);
            });

            it('400 on an invalid payload', async () => {
                const response = await request(app)
                    .post(`/api/catalog-types?lang=${ lang }`)
                    .set(authHeader('ADMIN'))
                    // The code is optional and falls back to the name; what the validator rejects
                    // is the missing name and the negative sortOrder
                    .send({ sortOrder: -1 });

                expect(response.status).toBe(400);
                expectResolvedMessage(response.body);
            });

            it('401 without a token', async () => {
                const response = await request(app).get(`/api/catalog-types?lang=${ lang }`);

                expect(response.status).toBe(401);
                expectResolvedMessage(response.body);
            });

            it('403 with an insufficient role', async () => {
                const response = await request(app)
                    .delete(`/api/catalog-types/${ UUID }?lang=${ lang }`)
                    .set(authHeader('USER'));

                expect(response.status).toBe(403);
                expectResolvedMessage(response.body);
            });

        });

        it('actually switches language rather than always falling back', async () => {
            const [spanish, english] = await Promise.all([
                request(app).get('/api/catalog-types?lang=es').set(authHeader('USER')),
                request(app).get('/api/catalog-types?lang=en').set(authHeader('USER'))
            ]);

            expect(spanish.body.message).not.toBe(english.body.message);
        });

    });

});
