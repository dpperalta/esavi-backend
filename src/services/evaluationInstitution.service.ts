import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EvaluationInstitution, HealthFacility, Investigation, InvestigationClinicalEvaluation } from '../models';
import { AppError, esaviCrypt, esaviDecrypt, getMessage, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateEvaluationInstitutionInput } from '../types';

// The catalogType every evaluationInstitutionTypeItemId must belong to. The foreign key of the DDL
// points at catalogItem without distinguishing the type, so this code is the only defence against an
// item of `sex` ending up stored as an institution type
const INSTITUTION_TYPE_CATALOG = 'evaluationInstitutionType';

// There is no CREATE_FIELDS here, and that is a decision and not an omission. In the eight sister
// tables of the setSortOrderByParent loop the column is NOT NULL, so Sequelize runs its own notNull
// validation before emitting the INSERT and the create dies with a notNull Violation without the
// trigger ever running; the explicit field list was the only way out. In this table sortOrder is
// nullable and carries no DEFAULT 0 (esaviapp.sql:1114), the validation does not fire, the INSERT
// carries "sortOrder" = NULL and setSortOrderByParent reads that as "assign it yourself". The create
// is the ordinary one, and the service simply does not send the key.

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails is
// trigger bookkeeping and never leaves the service, and an explicit list is what keeps it out without
// having to mention it
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<EvaluationInstitution>)[] = [
    'evaluationInstitutionId',
    'investigationId',
    'sortOrder',
    'healthFacilityId',
    'institutionName',
    'personName',
    'personContact',
    'evaluationInstitutionTypeItemId',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent chain, read on every operation to implement the inherited visibility. Two hops, and the
// state lives only in the second link: investigationClinicalEvaluation is one of the five tables of
// the repository with no isActive, so the only thing that can be sealed in it is its deletedAt, and
// the real state of the block lives one hop further up, in investigation.isActive. It is the shape
// F33 opened, and the second time it appears.
//
// paranoid: false is what lets the sealed clinical evaluation be seen instead of hidden by the
// include, which is the difference between a 404 that can be explained and a mute one.
//
// Neither the clinical evaluation nor the investigation ever reaches the response: whoever needs
// them enters through ESAVI-INVCLIEV-003 and ESAVI-INVESTGN-003
const CLINICAL_EVALUATION_INCLUDE = {
    model: InvestigationClinicalEvaluation,
    as: 'clinicalEvaluation',
    attributes: ['investigationId', 'deletedAt'],
    paranoid: false,
    include: [{
        model: Investigation,
        as: 'investigation',
        attributes: ['investigationId', 'isActive']
    }]
};

// The two response includes. Both carry required: false on purpose: the two foreign keys are
// nullable and an INNER JOIN would hide the free text institutions, which are exactly the rows this
// entity exists to admit
const HEALTH_FACILITY_INCLUDE = {
    model: HealthFacility,
    as: 'healthFacility',
    attributes: ['healthFacilityId', 'localCode', 'name', 'isActive'],
    required: false
};

const INSTITUTION_TYPE_INCLUDE = {
    model: CatalogItem,
    as: 'institutionType',
    attributes: ['catalogItemId', 'code', 'name'],
    required: false
};

// The parent chain is dropped here after having done its job in the query, and the two masters come
// back as an explicit null when their key has no value, so a client does not have to tell "empty"
// from "absent".
//
// personName and personContact are DECRYPTED here, which is what keeps the ciphertext from ever
// crossing the HTTP boundary — on the five operations that return the row, listings included, where
// this runs row by row. esaviDecrypt is never handed a null.
//
// The name the client displays is institutionName ?? healthFacility.name. There is no third field
// resolving it, and the two coexist on purpose: when both have a value the investigator's text rules
// over the master's without erasing it
const toEvaluationInstitutionResponse = (institution: EvaluationInstitution) => {
    const plain = institution.toJSON() as Record<string, unknown>;
    delete plain.clinicalEvaluation;

    plain.healthFacility = plain.healthFacility ?? null;
    plain.institutionType = plain.institutionType ?? null;

    plain.personName = plain.personName
        ? esaviDecrypt(plain.personName as string)
        : null;
    plain.personContact = plain.personContact
        ? esaviDecrypt(plain.personContact as string)
        : null;

    return plain;
}

// The parent guard of 001, 002A and 002B. A single query over investigationClinicalEvaluation by
// primary key, with paranoid: false and the investigation nested, that fails with 404 if any of three
// things holds: there is no clinical evaluation row, the row has a non null deletedAt — an
// ESAVI-INVESTGN-005A sealed it through cascadeSealSatellite — or its investigation is inactive.
//
// The three reasons share code and message. Telling them apart is of no use to the investigator: in
// all three the missing link is one level up and the corrective action is the same one.
//
// canViewInactive relaxes check 3 and only check 3, and only in the two listings. Checks 1 and 2 are
// relaxed for nobody, SUPERADMIN included: a sealed row IS visible — that is what the paranoid: false
// buys — but a clinical evaluation that does not exist has no institutions to list under any role,
// and one that was sealed takes no new rows from anyone. canViewInactive relaxes VISIBILITY, never
// EXISTENCE.
//
// The column is called investigationId and it does not point at investigation: it points at the
// primary key of the clinical evaluation, which is the same UUID. The existence to check is the
// clinical evaluation's — a live investigation with no clinical evaluation row admits no institutions
const findValidClinicalEvaluation = async (
    investigationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const clinicalEvaluation = await InvestigationClinicalEvaluation.findOne({
        where: { investigationId, deletedAt: null },
        attributes: ['investigationId'],
        paranoid: false,
        include: [{
            model: Investigation,
            as: 'investigation',
            attributes: ['investigationId'],
            required: true,
            where: canViewInactive ? {} : { isActive: true }
        }]
    });
    if( !clinicalEvaluation ) {
        throw new AppError(
            getMessage('evaluationInstitution.clinicalEvaluationNotFound', lang),
            404,
            `EVALINST_${ op }_CLINICAL_EVALUATION_NOT_FOUND`
        );
    }
    return clinicalEvaluation;
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. institutionName does NOT go through toTitleCase, deliberately: it is the decision of
// F31 for fullName — MINSAL must not become Minsal — and there is no code column here to constant
// case either.
//
// This is yet another copy of this helper in the repository. Extracting it is overdue since F24 §7
// and has its own spec pending, because doing it here would drag a pile of foreign services into a
// CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// personName is the only text of the entity that IS title cased before being encrypted, following
// what the parent F34 does with clinicalDetailsPersonName and what F05 does with firstName: without
// that step "juan" and "Juan" would produce different ciphertexts and the diff would invent a
// difference on every open of the form. personContact only gets the trim — a phone number or an
// email has no casing to normalize, and toTitleCase would corrupt it.
//
// Neither encrypts here: esaviCrypt is applied at the very end, and in the 004 after the diff
const normalizePersonName = (value: string | null | undefined): string | null => {
    const normalized = normalizeText(value);
    return normalized ? toTitleCase(normalized) : null;
}

// The identification rule of 001 and 004: at least one of healthFacilityId and institutionName must
// END UP with a value, or 400. It is evaluated over the RESULTING state and never over the body,
// which is precisely why it lives in the service and not in the validator: in the 004 it depends on
// the stored row, and express-validator cannot see it. Emptying the only one of the two that was
// there is a 400; emptying one while the other survives is a 200.
//
// It is checked BEFORE the two master validations: there is no point resolving a health facility on
// a row that is going to be left unidentified anyway.
//
// It is the only form validation of this entity that does not answer common.validationError, and
// that is why it carries an i18n key of its own
const assertIdentificationIsPresent = (
    healthFacilityId: string | null,
    institutionName: string | null,
    op: string,
    lang: string
) => {
    if( !healthFacilityId && !institutionName ) {
        throw new AppError(
            getMessage('evaluationInstitution.identificationRequired', lang),
            400,
            `EVALINST_${ op }_IDENTIFICATION_REQUIRED`
        );
    }
}

// The facility must exist and be ACTIVE. Two causes — it does not exist, it is inactive — and a
// single error, with the shape of assertHealthFacilityIsValid of esaviCase.service.ts.
//
// It runs BEFORE the diff and with independence of it: an inactive facility is a 404 even if it
// matches what is stored. And it only runs when the key ends up with a value: an explicit
// healthFacilityId: null resolves nothing, because it is being emptied
const assertHealthFacilityIsValid = async (
    healthFacilityId: string,
    op: string,
    lang: string,
    transaction?: Transaction
) => {
    const healthFacility = await HealthFacility.findOne({
        where: { healthFacilityId, isActive: true },
        attributes: ['healthFacilityId'],
        transaction
    });
    if( !healthFacility ) {
        throw new AppError(
            getMessage('evaluationInstitution.healthFacilityNotFound', lang),
            404,
            `EVALINST_${ op }_HEALTH_FACILITY_NOT_FOUND`
        );
    }
}

// The item must exist, be active and belong to the evaluationInstitutionType catalogType: any other
// catalogItem would be a valid UUID pointing at a meaningless type. It is the double hop of
// assertCatalogItemIsValid of investigationMedicalHistory.service.ts, literal.
//
// Three causes — it does not exist, it is inactive, it does not belong to the catalog — and a single
// error, because none of the three is actionable in a different way. Same two conditions as the one
// above: before the diff, and only when the key ends up with a value
const assertInstitutionTypeIsValid = async (
    catalogItemId: string,
    op: string,
    lang: string,
    transaction?: Transaction
) => {
    const item = await CatalogItem.findOne({
        where: { catalogItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: INSTITUTION_TYPE_CATALOG },
            attributes: []
        }],
        transaction
    });
    if( !item ) {
        throw new AppError(
            getMessage('evaluationInstitution.institutionTypeNotFound', lang),
            404,
            `EVALINST_${ op }_INSTITUTION_TYPE_NOT_FOUND`
        );
    }
}

// The duplicate guard of 001 and 004: the healthFacilityId may not repeat among the ACTIVE
// institutions of the same clinical evaluation. Recording the same facility twice adds no information
// and does distort any count.
//
// No UNIQUE and no index backs it: the DDL declares no unique constraint over this table, and the
// only uniqueness of the database lives in the partial index over (investigationId, sortOrder). It is
// a business rule of the service, and that is precisely why it only looks at ACTIVE rows: an invented
// rule must not be stricter than the ones the database imposes, and deactivating an institution and
// loading it again is the natural way of undoing a mistaken create without going through the 005B.
//
// It only runs when the facility ends up with a value. Two free text institutions are distinct
// records by definition: there is no identity to compare, and comparing null against null would turn
// the second free text into a 409 for no reason — not even when the two names match, which §7 of the
// spec declares as accepted
const assertNoDuplicateInstitution = async (
    investigationId: string,
    healthFacilityId: string | null,
    op: string,
    lang: string,
    transaction: Transaction,
    excludedInstitutionId?: string
) => {
    if( !healthFacilityId ) return;

    const duplicate = await EvaluationInstitution.findOne({
        where: {
            investigationId,
            healthFacilityId,
            isActive: true,
            ...( excludedInstitutionId ? { evaluationInstitutionId: { [Op.ne]: excludedInstitutionId } } : {} )
        },
        attributes: ['evaluationInstitutionId'],
        transaction
    });
    if( duplicate ) {
        throw new AppError(
            getMessage('evaluationInstitution.alreadyExists', lang),
            409,
            `EVALINST_${ op }_ALREADY_EXISTS`
        );
    }
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true it is what implements the inherited visibility, so an institution
// hanging from a sealed clinical evaluation — or from an inactive investigation — simply does not
// come back.
//
// The intermediate link is filtered by deletedAt and not by isActive, because that table does not
// have the column, and the paranoid: false is what lets a sealed row be seen at all
const findInstitutionWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await EvaluationInstitution.findOne({
        where: includeInactive ? { evaluationInstitutionId: id } : { evaluationInstitutionId: id, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            {
                ...CLINICAL_EVALUATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { deletedAt: null },
                include: [{
                    ...CLINICAL_EVALUATION_INCLUDE.include[0],
                    required: true,
                    where: includeInactive ? {} : { isActive: true }
                }]
            },
            HEALTH_FACILITY_INCLUDE,
            INSTITUTION_TYPE_INCLUDE
        ]
    });
}

// Create Evaluation Institution Service
// Code: ESAVI-EVALINST-001
// Everything inside a single transaction, so the parent guard, the two master validations and the
// duplicate guard see the same snapshot the INSERT lands on
const createEvaluationInstitutionService = async (
    data: CreateEvaluationInstitutionInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        // No relaxation of any of the three checks here, not even for SUPERADMIN: a sealed clinical
        // evaluation, or one of an inactive investigation, takes no new institutions whoever asks.
        // It is the criterion of F31 and F33 for their 001
        await findValidClinicalEvaluation(data.investigationId, '001', lang);

        // Normalization first, so what the identification rule and the duplicate guard look at is
        // what is going to be stored. institutionName gets only the trim
        const healthFacilityId = data.healthFacilityId ?? null;
        const institutionName = normalizeText(data.institutionName);
        const personName = normalizePersonName(data.personName);
        const personContact = normalizeText(data.personContact);
        const evaluationInstitutionTypeItemId = data.evaluationInstitutionTypeItemId ?? null;

        // Over the body, which in the create IS the complete resulting state
        assertIdentificationIsPresent(healthFacilityId, institutionName, '001', lang);

        if( healthFacilityId ) {
            await assertHealthFacilityIsValid(healthFacilityId, '001', lang, transaction);
        }
        if( evaluationInstitutionTypeItemId ) {
            await assertInstitutionTypeIsValid(evaluationInstitutionTypeItemId, '001', lang, transaction);
        }

        await assertNoDuplicateInstitution(
            data.investigationId,
            healthFacilityId,
            '001',
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-EVALINST-001',
            detail: 'Evaluation institution created by service'
        };

        // sortOrder is deliberately absent from the create, and here that is enough on its own: the
        // column is nullable, so Sequelize emits "sortOrder" = NULL and
        // TRG_evaluationInstitution_setSortOrder assigns it under the advisory lock that keeps two
        // concurrent inserts from colliding. No fields list is needed — this is the first table of
        // the family that does not need one.
        //
        // The two encrypted columns are encrypted HERE, at the very end, over the already normalized
        // value and never over a null
        const created = await EvaluationInstitution.create({
            investigationId: data.investigationId,
            healthFacilityId,
            institutionName,
            personName: personName ? esaviCrypt(personName) : null,
            personContact: personContact ? esaviCrypt(personContact) : null,
            evaluationInstitutionTypeItemId,
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction });

        createdId = created.evaluationInstitutionId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the two masters and the sortOrder the trigger assigned, which
    // the create instance does not know
    const institution = await findInstitutionWithRelations(createdId, true);
    return institution ? toEvaluationInstitutionResponse(institution) : null;
}

export {
    createEvaluationInstitutionService
}
