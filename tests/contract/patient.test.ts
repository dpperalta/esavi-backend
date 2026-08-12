import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem, CatalogType, GeoLevelType, GeoLocation, Patient } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the eight patient operations of SPEC F05. It walks the entity
 * end to end and covers what cannot be checked by hand reliably: the
 * normalize-then-encrypt order, global `documentNumber` uniqueness in create and
 * update, the `sex` catalog filter that no database trigger enforces, and the
 * search that answers 200 with an empty page instead of 404.
 */
describe('patient contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    // Fixtures shared by the whole file. The sex catalog items come seeded from esaviapp.sql
    let sexItemId: string;
    let wrongCatalogItemId: string;
    let geoLocationId: string;
    let inactiveGeoLocationId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createPatient = async ( payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app)
            .post('/api/patients')
            .set(authHeader(role))
            .send(payload);

    const getPatient = async ( id: string, role: TestRole = 'USER' ) =>
        request(app)
            .get(`/api/patients/${ id }`)
            .set(authHeader(role));

    const searchPatients = async ( identifier: string, role: TestRole = 'USER' ) =>
        request(app)
            .get(`/api/patients/search/${ encodeURIComponent(identifier) }`)
            .set(authHeader(role));

    const updatePatient = async ( id: string, payload: Record<string, unknown> ) =>
        request(app)
            .put(`/api/patients/${ id }`)
            .set(authHeader('USER'))
            .send(payload);

    const createGeoLocationFixture = async ( label: string, isActive: boolean ): Promise<string> => {
        const geoLevelType = await GeoLevelType.create({
            code: `PAT${ label }${ suffix }`,
            name: `Patient ${ label } ${ suffix }`,
            sortOrder: 1
        });
        const geoLocation = await GeoLocation.create({
            geoLevelTypeId: geoLevelType.getDataValue('geoLevelTypeId'),
            name: `Patient ${ label } ${ suffix }`,
            level: 1,
            isActive
        });
        return geoLocation.getDataValue('geoLocationId');
    };

    const isoDate = ( offsetDays: number ): string => {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);
        return `${ date.getFullYear() }-${ `${ date.getMonth() + 1 }`.padStart(2, '0') }-${ `${ date.getDate() }`.padStart(2, '0') }`;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        // Seeded by esaviapp.sql: FEMALE belongs to sex, HOSPITAL to healthFacilityType.
        // The second one is the vehicle for the wrong-catalog test
        const sexItem = await CatalogItem.findOne({
            where: { code: 'FEMALE' },
            include: [{ model: CatalogType, as: 'catalogType', where: { code: 'sex' }, attributes: [] }]
        });
        const wrongItem = await CatalogItem.findOne({
            where: { code: 'HOSPITAL' },
            include: [{ model: CatalogType, as: 'catalogType', where: { code: 'healthFacilityType' }, attributes: [] }]
        });

        if( !sexItem || !wrongItem ) {
            throw new Error('The sex and healthFacilityType catalogs are not seeded. esaviapp.sql must load before this suite.');
        }

        sexItemId = sexItem.getDataValue('catalogItemId');
        wrongCatalogItemId = wrongItem.getDataValue('catalogItemId');

        geoLocationId = await createGeoLocationFixture('Active', true);
        inactiveGeoLocationId = await createGeoLocationFixture('Inactive', false);
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // -----------------------------------------------------------------------
    // Full walkthrough: create → get → search → update → list → delete → activate
    // -----------------------------------------------------------------------

    describe('walkthrough', () => {

        const documentNumber = `WALK-DOC-${ suffix }`;
        const passportNumber = `WALK-PAS-${ suffix }`;

        let patientId: string;
        let healthSystemCode: string;

        it('001 creates the patient, normalizing before encrypting', async () => {
            const response = await createPatient({
                firstName: 'juan carlos',
                middleName: 'de jesus',
                lastName: 'perez',
                secondLastName: 'mora',
                birthDate: '1988-03-17',
                documentNumber: `  ${ documentNumber.toLowerCase() }  `,
                passportNumber: passportNumber.toLowerCase(),
                email: '  JUAN@Correo.EC  ',
                phoneNumber: '0991234567',
                sexItemId,
                residenceGeoLocationId: geoLocationId
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);

            patientId = response.body.data.patientId;
            healthSystemCode = response.body.data.healthSystemCode;

            // Normalized on the way in, decrypted on the way out
            expect(response.body.data.firstName).toBe('Juan Carlos');
            expect(response.body.data.middleName).toBe('De Jesus');
            expect(response.body.data.lastName).toBe('Perez');
            expect(response.body.data.secondLastName).toBe('Mora');
            expect(response.body.data.documentNumber).toBe(documentNumber);
            expect(response.body.data.passportNumber).toBe(passportNumber);
            expect(response.body.data.email).toBe('juan@correo.ec');

            // birthDate stays a calendar date, no time zone shift
            expect(response.body.data.birthDate).toBe('1988-03-17');
        });

        it('001 stores the ciphertext of the normalized value, not of the raw one', async () => {
            const stored = await Patient.findByPk(patientId);

            expect(stored!.getDataValue('firstName')).toBe(esaviCrypt('Juan Carlos'));
            expect(stored!.getDataValue('documentNumber')).toBe(esaviCrypt(documentNumber));
            expect(stored!.getDataValue('email')).toBe(esaviCrypt('juan@correo.ec'));
            // Never encrypted
            expect(stored!.getDataValue('phoneNumber')).toBe('0991234567');
            expect(stored!.getDataValue('healthSystemCode')).toBe(healthSystemCode);
        });

        it('001 generates a healthSystemCode of 12 Crockford characters', () => {
            expect(healthSystemCode).toHaveLength(12);
            expect(healthSystemCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
            expect(healthSystemCode).not.toMatch(/[ILOU]/);
        });

        it('003 returns the full shape with the two relations resolved', async () => {
            const response = await getPatient(patientId);

            expect(response.status).toBe(200);
            expect(response.body.data.sex).toMatchObject({ catalogItemId: sexItemId, code: 'FEMALE' });
            expect(response.body.data.residence).toMatchObject({ geoLocationId, level: 1 });
            expect(Object.keys(response.body.data).sort()).toEqual([
                'appDetails', 'birthDate', 'createdAt', 'deletedAt', 'documentNumber', 'email',
                'firstName', 'healthSystemCode', 'isActive', 'lastName', 'middleName', 'passportNumber',
                'patientId', 'phoneNumber', 'residence', 'secondLastName', 'sex', 'updatedAt'
            ]);
        });

        it('006 finds the patient by each of the three identifiers', async () => {
            for( const identifier of [documentNumber, passportNumber, healthSystemCode] ) {
                const response = await searchPatients(identifier);

                expect(response.status).toBe(200);
                expect(response.body.data.count).toBe(1);
                expect(response.body.data.rows[0].patientId).toBe(patientId);
            }
        });

        it('006 finds the patient with the identifier typed in lower case', async () => {
            const response = await searchPatients(documentNumber.toLowerCase());

            expect(response.body.data.count).toBe(1);
            expect(response.body.data.rows[0].patientId).toBe(patientId);
        });

        it('004 updates the patient and leaves healthSystemCode untouched', async () => {
            const response = await updatePatient(patientId, {
                firstName: 'juan pablo',
                phoneNumber: '0997654321',
                healthSystemCode: 'MIO'
            });

            expect(response.status).toBe(200);
            expect(response.body.data.firstName).toBe('Juan Pablo');
            expect(response.body.data.phoneNumber).toBe('0997654321');
            expect(response.body.data.healthSystemCode).toBe(healthSystemCode);
        });

        it('004 keeps the audit history and adds nothing when nothing changed', async () => {
            const response = await updatePatient(patientId, {});
            const methods = response.body.data.appDetails.map(( entry: { method: string } ) => entry.method);

            expect(methods[0]).toBe('ESAVI-PATIENT-001');
            // The empty body changes nothing, so it writes nothing: the only 004 is the real
            // update of the previous case, and the create entry is still there
            expect(methods.filter(( method: string ) => method === 'ESAVI-PATIENT-004')).toHaveLength(1);
        });

        it('004 leaves the encrypted column byte for byte identical when the value is resent', async () => {
            const before = await Patient.findByPk(patientId);
            const storedFirstName = before!.getDataValue('firstName');

            const response = await updatePatient(patientId, { firstName: 'Juan Pablo' });
            expect(response.status).toBe(200);

            const after = await Patient.findByPk(patientId);
            expect(after!.getDataValue('firstName')).toBe(storedFirstName);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

        it('002A lists the patient in the reduced shape', async () => {
            const response = await request(app)
                .get('/api/patients?limit=100')
                .set(authHeader('USER'));

            expect(response.status).toBe(200);

            const row = response.body.data.rows.find(( r: { patientId: string } ) => r.patientId === patientId);
            expect(row).toBeDefined();
            expect(Object.keys(row).sort()).toEqual([
                'birthDate', 'documentNumber', 'firstName', 'healthSystemCode',
                'isActive', 'lastName', 'patientId', 'residence', 'sex'
            ]);
            expect(row.firstName).toBe('Juan Pablo');
        });

        it('002B lists the patient for an ADMIN', async () => {
            const response = await request(app)
                .get('/api/patients/admin?limit=100')
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows.map(( row: { patientId: string } ) => row.patientId)).toContain(patientId);
        });

        it('005A deactivates without a data payload', async () => {
            const response = await request(app)
                .delete(`/api/patients/${ patientId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');

            const stored = await Patient.findByPk(patientId);
            expect(stored!.getDataValue('isActive')).toBe(false);
            expect(stored!.getDataValue('deletedAt')).toBeInstanceOf(Date);
        });

        it('005A twice returns 409 ALREADY_INACTIVE', async () => {
            const response = await request(app)
                .delete(`/api/patients/${ patientId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('PATIENT_005A_ALREADY_INACTIVE');
        });

        it('an inactive patient disappears from 002A, 003 and 006 for a USER', async () => {
            const list = await request(app).get('/api/patients?limit=100').set(authHeader('USER'));
            expect(list.body.data.rows.map(( row: { patientId: string } ) => row.patientId)).not.toContain(patientId);

            expect((await getPatient(patientId)).status).toBe(404);
            expect((await searchPatients(documentNumber)).body.data.count).toBe(0);
        });

        // canViewInactive is SUPERADMIN-only today (permissions.helper.ts:24-26)
        it('a SUPERADMIN still reaches the inactive patient through 003 and 006', async () => {
            expect((await getPatient(patientId, 'SUPERADMIN')).status).toBe(200);
            expect((await searchPatients(documentNumber, 'SUPERADMIN')).body.data.count).toBe(1);
        });

        it('005B reactivates and clears deletedAt', async () => {
            const response = await request(app)
                .patch(`/api/patients/activate/${ patientId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');

            const stored = await Patient.findByPk(patientId);
            expect(stored!.getDataValue('isActive')).toBe(true);
            expect(stored!.getDataValue('deletedAt')).toBeNull();
        });

        it('records every write in appDetails with the bare operation code', async () => {
            const response = await getPatient(patientId);
            const methods = response.body.data.appDetails.map(( entry: { method: string } ) => entry.method);

            // One 004 and not two: of the three updates this suite runs, only the first one
            // carried a real change — the empty body and the resent firstName wrote nothing
            expect(methods).toEqual([
                'ESAVI-PATIENT-001',
                'ESAVI-PATIENT-004',
                'ESAVI-PATIENT-005A',
                'ESAVI-PATIENT-005B'
            ]);
        });

    });

    // -----------------------------------------------------------------------
    // Error paths
    // -----------------------------------------------------------------------

    describe('error paths', () => {

        it('rejects a create without documentNumber with 400', async () => {
            const response = await createPatient({ firstName: 'Sin', lastName: 'Documento' });

            expect(response.status).toBe(400);
        });

        it.each(['firstName', 'lastName'])('rejects a create without %s with 400', async ( field ) => {
            const payload: Record<string, unknown> = {
                firstName: 'Falta',
                lastName: 'Campo',
                documentNumber: `MISSING-${ field }-${ suffix }`
            };
            delete payload[field];

            expect((await createPatient(payload)).status).toBe(400);
        });

        it('rejects a duplicated documentNumber on create with 409', async () => {
            const documentNumber = `DUP-CREATE-${ suffix }`;

            expect((await createPatient({ firstName: 'Uno', lastName: 'Dup', documentNumber })).status).toBe(201);

            const second = await createPatient({ firstName: 'Dos', lastName: 'Dup', documentNumber });
            expect(second.status).toBe(409);
            expect(second.body.code).toBe('PATIENT_001_DOCUMENT_EXISTS');
        });

        it('keeps a documentNumber taken even when its patient is inactive', async () => {
            const documentNumber = `DUP-INACTIVE-${ suffix }`;

            const created = await createPatient({ firstName: 'Inactivo', lastName: 'Dup', documentNumber });
            await request(app).delete(`/api/patients/${ created.body.data.patientId }`).set(authHeader('ADMIN'));

            const response = await createPatient({ firstName: 'Otro', lastName: 'Dup', documentNumber });
            expect(response.status).toBe(409);
        });

        it('rejects a duplicated documentNumber on update with 409', async () => {
            const mine = await createPatient({ firstName: 'Mio', lastName: 'Upd', documentNumber: `UPD-MINE-${ suffix }` });
            const theirs = await createPatient({ firstName: 'Suyo', lastName: 'Upd', documentNumber: `UPD-THEIRS-${ suffix }` });

            const response = await updatePatient(mine.body.data.patientId, {
                documentNumber: `UPD-THEIRS-${ suffix }`
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('PATIENT_004_DOCUMENT_EXISTS');

            // Keeping its own document is not a conflict
            const kept = await updatePatient(mine.body.data.patientId, { documentNumber: `UPD-MINE-${ suffix }` });
            expect(kept.status).toBe(200);
            expect(theirs.status).toBe(201);
        });

        it.each([
            ['create', '001'],
            ['update', '004']
        ])('rejects a sexItemId from another catalog on %s with 404', async ( operation, code ) => {
            if( operation === 'create' ) {
                const response = await createPatient({
                    firstName: 'Mal',
                    lastName: 'Catalogo',
                    documentNumber: `SEX-${ code }-${ suffix }`,
                    sexItemId: wrongCatalogItemId
                });
                expect(response.status).toBe(404);
                expect(response.body.code).toBe('PATIENT_001_SEX_NOT_FOUND');
                return;
            }

            const created = await createPatient({
                firstName: 'Mal',
                lastName: 'Catalogo',
                documentNumber: `SEX-${ code }-${ suffix }`
            });
            const response = await updatePatient(created.body.data.patientId, { sexItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('PATIENT_004_SEX_NOT_FOUND');
        });

        it('rejects an inactive residenceGeoLocationId on create with 404', async () => {
            const response = await createPatient({
                firstName: 'Geo',
                lastName: 'Inactiva',
                documentNumber: `GEO-001-${ suffix }`,
                residenceGeoLocationId: inactiveGeoLocationId
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('PATIENT_001_GEOLOC_NOT_FOUND');
        });

        it('rejects an inactive residenceGeoLocationId on update with 404', async () => {
            const created = await createPatient({
                firstName: 'Geo',
                lastName: 'Inactiva',
                documentNumber: `GEO-004-${ suffix }`
            });
            const response = await updatePatient(created.body.data.patientId, {
                residenceGeoLocationId: inactiveGeoLocationId
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('PATIENT_004_GEOLOC_NOT_FOUND');
        });

        it('rejects a birthDate of tomorrow with 400 and accepts today', async () => {
            const future = await createPatient({
                firstName: 'Futuro',
                lastName: 'Nacimiento',
                documentNumber: `BIRTH-FUT-${ suffix }`,
                birthDate: isoDate(1)
            });
            expect(future.status).toBe(400);

            const today = await createPatient({
                firstName: 'Hoy',
                lastName: 'Nacimiento',
                documentNumber: `BIRTH-TODAY-${ suffix }`,
                birthDate: isoDate(0)
            });
            expect(today.status).toBe(201);
        });

        it('returns 404 for an unknown patient on 003 and 004', async () => {
            const unknown = '00000000-0000-4000-8000-000000000000';

            expect((await getPatient(unknown)).body.code).toBe('PATIENT_003_NOT_FOUND');
            expect((await updatePatient(unknown, { firstName: 'Nadie' })).body.code).toBe('PATIENT_004_NOT_FOUND');
        });

        it('answers a search with no matches with 200 and an empty page', async () => {
            const response = await searchPatients(`NOTHING-${ suffix }`);

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data).toEqual({ count: 0, rows: [] });
            expect(response.body.message).toBe('No existen resultados de la búsqueda');
        });

    });

    // -----------------------------------------------------------------------
    // Rules that hold across operations
    // -----------------------------------------------------------------------

    describe('cross-cutting rules', () => {

        it('allows two patients to share an email', async () => {
            const email = `hermanos-${ suffix }@correo.ec`;

            const first = await createPatient({ firstName: 'Hermano', lastName: 'Uno', documentNumber: `MAIL-1-${ suffix }`, email });
            const second = await createPatient({ firstName: 'Hermana', lastName: 'Dos', documentNumber: `MAIL-2-${ suffix }`, email });

            expect(first.status).toBe(201);
            expect(second.status).toBe(201);
        });

        it('allows two patients to share a passportNumber and returns both from 006', async () => {
            const passportNumber = `SHARED-PAS-${ suffix }`;

            const first = await createPatient({ firstName: 'Pasa', lastName: 'Uno', documentNumber: `PAS-1-${ suffix }`, passportNumber });
            const second = await createPatient({ firstName: 'Pasa', lastName: 'Dos', documentNumber: `PAS-2-${ suffix }`, passportNumber });

            expect(first.status).toBe(201);
            expect(second.status).toBe(201);

            const response = await searchPatients(passportNumber);
            expect(response.body.data.count).toBe(2);
        });

        it('never returns sysDetails from any operation', async () => {
            const created = await createPatient({
                firstName: 'Sin',
                lastName: 'SysDetails',
                documentNumber: `SYS-${ suffix }`
            });
            const id = created.body.data.patientId;

            const responses = [
                created,
                await getPatient(id),
                await updatePatient(id, {}),
                await request(app).get('/api/patients?limit=100').set(authHeader('USER')),
                await request(app).get('/api/patients/admin?limit=100').set(authHeader('ADMIN')),
                await searchPatients(`SYS-${ suffix }`)
            ];

            for( const response of responses ) {
                expect(JSON.stringify(response.body)).not.toContain('sysDetails');
            }
        });

        it('keeps email, phoneNumber, passportNumber, middleName and secondLastName out of the lists', async () => {
            const documentNumber = `REDUCED-${ suffix }`;
            await createPatient({
                firstName: 'Reducida',
                middleName: 'Media',
                lastName: 'Forma',
                secondLastName: 'Segunda',
                documentNumber,
                passportNumber: `REDUCED-PAS-${ suffix }`,
                email: `reducida-${ suffix }@correo.ec`,
                phoneNumber: '0990000000'
            });

            const hidden = ['email', 'phoneNumber', 'passportNumber', 'middleName', 'secondLastName'];

            for( const response of [
                await request(app).get('/api/patients?limit=100').set(authHeader('USER')),
                await request(app).get('/api/patients/admin?limit=100').set(authHeader('ADMIN')),
                await searchPatients(documentNumber)
            ] ) {
                for( const row of response.body.data.rows ) {
                    for( const field of hidden ) {
                        expect(row).not.toHaveProperty(field);
                    }
                }
            }
        });

        it('does not capture the literal paths as an :id', async () => {
            expect((await request(app).get('/api/patients/admin').set(authHeader('ADMIN'))).status).toBe(200);
            expect((await searchPatients('XYZ')).status).toBe(200);
        });

        it('paginates with limit and reports the total count', async () => {
            const response = await request(app)
                .get('/api/patients?limit=2')
                .set(authHeader('USER'));

            expect(response.body.data.rows).toHaveLength(2);
            expect(response.body.data.count).toBeGreaterThan(2);
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await createPatient({
                firstName: 'diferencial',
                lastName: 'paciente',
                documentNumber: `DIFF-004-${ suffix }`,
                email: 'diferencial@correo.ec',
                birthDate: '1990-05-04',
                phoneNumber: '0991234567',
                sexItemId,
                residenceGeoLocationId: geoLocationId
            });
            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/patients',
                id: created.body.data.patientId,
                model: Patient
            });
        });

    });

});
