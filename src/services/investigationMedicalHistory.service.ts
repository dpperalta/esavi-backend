import { WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EsaviCase, Investigation, InvestigationMedicalHistory, InvestigationPregnancyCondition } from '../models';
import { AppError, assertRowIsSealed, buildDifferentialUpdate, esaviLog, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationMedicalHistoryInput,
    InvestigationMedicalHistoryListFilters
} from '../types';
import { AnswerOption } from '../constants/enums.constants';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { purgeEntityService } from './common/entityPurge.service';

// The four catalog codes are local constants of this service, with the pattern of
// notificationPregnancyComplication.service.ts:23. They do not go to
// src/constants/investigation.constants.ts because only this service consumes them.
// NONE of the four catalogTypes is seeded by the DDL: that is a deployment precondition declared in
// the spec, and until somebody loads them every UUID sent on these four fields answers 404
const GESTATION_METHOD_CATALOG_CODE = 'gestationMethod';
const DELIVERY_TYPE_CATALOG_CODE = 'deliveryType';
const BIRTH_CONDITION_CATALOG_CODE = 'birthCondition';
const PREGNANCY_OUTCOME_CATALOG_CODE = 'pregnancyOutcome';

// The investigation travels in every response: it is what governs the visibility of the medical
// history, and hiding it would leave the client unable to explain why a record it read yesterday
// now answers 404. Its own sysDetails stays out, like the one of the medical history.
// status never comes back null, by the rule F28 imposed on that entity
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'isActive', 'investigationStartDate'],
    include: [
        {
            model: CatalogItem,
            as: 'status',
            attributes: ['catalogItemId', 'code', 'name']
        },
        {
            model: EsaviCase,
            as: 'case',
            attributes: ['caseId', 'caseCode', 'eventDate']
        }
    ]
};

// The four catalogs travel resolved in every operation, listings included, as F27 does with its
// complicationType: a client painting the form gets the name without asking for the catalog apart.
// All four go in required: false — with required: true every row outside the pregnancy block, which
// will be most of them, would simply disappear from the listing
const CATALOG_INCLUDES = [
    { model: CatalogItem, as: 'gestationMethod', attributes: ['catalogItemId', 'code', 'name'], required: false },
    { model: CatalogItem, as: 'delivery', attributes: ['catalogItemId', 'code', 'name'], required: false },
    { model: CatalogItem, as: 'birth', attributes: ['catalogItemId', 'code', 'name'], required: false },
    { model: CatalogItem, as: 'pregnancyOutcome', attributes: ['catalogItemId', 'code', 'name'], required: false }
];

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here
// it is the primary key of the row, and also the identifier of its investigation
const MEDICAL_HISTORY_EXCLUDE = {
    exclude: ['sysDetails']
};

// The five answerOption columns are returned exactly as stored, null included: they are never
// normalized when building the response. A null means the form did not collect the answer and a
// 'NO_ANSWER' means it was asked and not answered — different data, and neither becomes the other.
// birthWeightGrams comes back as the string DECIMAL gives through pg — '3250.00', not 3250 — and is
// deliberately NOT converted: converting it would force a reconversion before comparing in the diff
// and would reopen from the other side the problem the numeric rule of the helper already solves.
// There is no isActive to return — the table does not have that column. deletedAt is the only
// status mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationMedicalHistoryResponse = (history: InvestigationMedicalHistory) => {
    const plain = history.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    // The sysDetails of the four resolved catalogItem never travels either
    for( const alias of ['gestationMethod', 'delivery', 'birth', 'pregnancyOutcome'] ) {
        const catalogItem = plain[alias] as Record<string, unknown> | null | undefined;
        if( catalogItem ) delete catalogItem.sysDetails;
    }

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a medical history hanging from a retired investigation simply does not come back
const findInvestigationMedicalHistoryWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationMedicalHistory.findOne({
        where: { investigationId: id },
        attributes: MEDICAL_HISTORY_EXCLUDE,
        include: [
            {
                ...INVESTIGATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            ...CATALOG_INCLUDES
        ]
    });
}

// The same read as above without narrowing the attributes of the medical history, which is the
// precondition of buildDifferentialUpdate: an instance read with a narrowed `attributes` reads back
// undefined for the columns it left out, and every comparison against undefined would count as a
// change. It still carries the investigation include, so the inherited visibility is checked in the
// same query the update instance comes from
const findInvestigationMedicalHistoryRow = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationMedicalHistory.findOne({
        where: { investigationId: id },
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take new medical
// histories. The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationMedicalHistory.investigationNotFound', lang),
            404,
            `INVMEDH_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a sealed
// medical history still occupies its investigationId, and only ESAVI-INVMEDH-005C frees it. The
// check does not rely on the collision either: a 23505 would reach the client as a 500 and its
// Postgres message says nothing useful. The message carries the investigationId because otherwise
// the client sees a 409 about a row it did not name
const assertMedicalHistoryDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationMedicalHistory.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationMedicalHistory.alreadyExists', lang, { investigationId }),
            409,
            `INVMEDH_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. There is neither `code` nor `name` here, so neither toConstantCase nor toTitleCase
// apply
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The nine fields the pregnancy block governs, in the order the spec declares them. The order is
// what decides which one is interpolated into {{field}} when more than one of them offends
const PREGNANCY_BLOCK_FIELDS = [
    'gestationalWeeks',
    'gestationMethodItemId',
    'deliveryItemId',
    'birthItemId',
    'pregnancyOutcomeItemId',
    'hasPregnancyRiskFactor',
    'riskFactorDescription',
    'birthWeightGrams',
    'wasBreastfed'
] as const;

// "Travelling with content" is not the same as "travelling": a field sent as null is the same
// destination the forcing of 004 reaches on its own, so it is never an offence. A blank string is
// no content either — normalizeText would store it as null. 0 IS content, on both numeric fields:
// checking truthiness here would let a gestationalWeeks of 0 through the closed block
const hasContent = (value: unknown): boolean => {
    if( value === undefined || value === null ) return false;
    if( typeof value === 'string' ) return value.trim().length > 0;
    return true;
}

// The rule of the pregnancy block, in the strict variant 001 uses. It is evaluated over the
// RESULTING state of isPregnancyConfirmed — on create the body is the whole resulting state — and
// the comparison is ALWAYS strict against 'YES'. Over answerOption the "no" has four distinct forms
// — 'NO', 'UNKNOWN', 'NOT_APPLICABLE' and 'NO_ANSWER' — plus the null of "it was never asked", and
// the five close the block alike. Writing the rule against the truthiness of the value would work
// by accident, because the five strings of the ENUM are truthy, and would break in silence.
//
// On create it is a 400 and never a silent forcing: there is no inherited state to clear — whatever
// arrives, arrives in the body — so accepting in silence a datum that will never be stored would
// return a 201 lying about what it saved
const assertPregnancyFieldsAreAllowed = (
    resultingPregnancy: AnswerOption | null,
    data: Partial<CreateInvestigationMedicalHistoryInput>,
    op: string,
    lang: string
) => {
    if( resultingPregnancy === 'YES' ) return;

    const offender = PREGNANCY_BLOCK_FIELDS.find(field => hasContent(data[field]));
    if( offender ) {
        throw new AppError(
            getMessage('investigationMedicalHistory.pregnancyFieldsNotAllowed', lang, { field: offender }),
            400,
            `INVMEDH_${ op }_PREGNANCY_FIELDS_NOT_ALLOWED`
        );
    }
}

// The item must exist, be active and belong to its own catalogType: any other catalogItem would be
// a valid UUID pointing at a meaningless type. It is the double hop of F27 and F28, literal. The FK
// of the DDL points at catalogItem without distinguishing the type, so this filter is the ONLY
// defence against an item of `outcome` ending up stored as a gestation method.
//
// Three causes — it does not exist, it is inactive, it does not belong to the catalog — and a single
// error per field, because none of the three is actionable in a different way
const assertCatalogItemIsValid = async (
    catalogItemId: string,
    catalogCode: string,
    messageKey: string,
    errorCode: string,
    lang: string
) => {
    const item = await CatalogItem.findOne({
        where: { catalogItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: catalogCode },
            attributes: []
        }]
    });
    if( !item ) {
        throw new AppError(
            getMessage(`investigationMedicalHistory.${ messageKey }`, lang),
            404,
            errorCode
        );
    }
}

// The four catalog keys, validated only when they are going to be stored with content. A key the
// forcing of the block is about to set to null is not resolved: there is nothing to look up. The
// validation runs BEFORE the diff and with independence of it — an inactive item is a 404 even if
// it matches what is stored — but it is posterior to the rule of the block
const assertCatalogItemsAreValid = async (
    values: {
        gestationMethodItemId?: string | null;
        deliveryItemId?: string | null;
        birthItemId?: string | null;
        pregnancyOutcomeItemId?: string | null;
    },
    op: string,
    lang: string
) => {
    if( values.gestationMethodItemId ) {
        await assertCatalogItemIsValid(
            values.gestationMethodItemId, GESTATION_METHOD_CATALOG_CODE,
            'gestationMethodNotFound', `INVMEDH_${ op }_GESTATION_METHOD_NOT_FOUND`, lang
        );
    }
    if( values.deliveryItemId ) {
        await assertCatalogItemIsValid(
            values.deliveryItemId, DELIVERY_TYPE_CATALOG_CODE,
            'deliveryNotFound', `INVMEDH_${ op }_DELIVERY_NOT_FOUND`, lang
        );
    }
    if( values.birthItemId ) {
        await assertCatalogItemIsValid(
            values.birthItemId, BIRTH_CONDITION_CATALOG_CODE,
            'birthNotFound', `INVMEDH_${ op }_BIRTH_NOT_FOUND`, lang
        );
    }
    if( values.pregnancyOutcomeItemId ) {
        await assertCatalogItemIsValid(
            values.pregnancyOutcomeItemId, PREGNANCY_OUTCOME_CATALOG_CODE,
            'pregnancyOutcomeNotFound', `INVMEDH_${ op }_PREGNANCY_OUTCOME_NOT_FOUND`, lang
        );
    }
}

// Create Investigation Medical History Service
// Code: ESAVI-INVMEDH-001
const createInvestigationMedicalHistoryService = async (
    data: CreateInvestigationMedicalHistoryInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertMedicalHistoryDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated over it directly.
    // It runs before the four foreign keys and before anything is written
    assertPregnancyFieldsAreAllowed(data.isPregnancyConfirmed ?? null, data, '001', lang);
    await assertCatalogItemsAreValid(data, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVMEDH-001',
        detail: 'Investigation medical history created by service'
    };

    // The empty create: the minimum is { investigationId } and the fifteen data columns come back
    // null. It is the pattern of F13, F14 and F29 and the opposite of F30 — a medical history that
    // has not been asked yet is a real state of the form, not a client error.
    // The five answerOption keep their null: what does not arrive is stored null and never 'NO' nor
    // 'NO_ANSWER'. The ?? null is what keeps that distinction, and it is written without any
    // truthiness check because the five strings of the ENUM are truthy and because 0 is a valid
    // value of gestationalWeeks and of birthWeightGrams.
    // deletedAt is born null and there is no isActive to set: the investigation had to be active to
    // get here, so a medical history cannot be created already dragged
    await InvestigationMedicalHistory.create({
        investigationId: data.investigationId,
        hasPriorHospitalizationHistory: data.hasPriorHospitalizationHistory ?? null,
        priorHospitalizationObservations: normalizeText(data.priorHospitalizationObservations),
        hasFamilyHistory: data.hasFamilyHistory ?? null,
        familyHistoryObservations: normalizeText(data.familyHistoryObservations),
        isPregnancyConfirmed: data.isPregnancyConfirmed ?? null,
        gestationalWeeks: data.gestationalWeeks ?? null,
        gestationMethodItemId: data.gestationMethodItemId ?? null,
        deliveryItemId: data.deliveryItemId ?? null,
        birthItemId: data.birthItemId ?? null,
        pregnancyOutcomeItemId: data.pregnancyOutcomeItemId ?? null,
        hasPregnancyRiskFactor: data.hasPregnancyRiskFactor ?? null,
        riskFactorDescription: normalizeText(data.riskFactorDescription),
        birthWeightGrams: data.birthWeightGrams ?? null,
        wasBreastfed: data.wasBreastfed ?? null,
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved investigation, its status, its case and the four
    // catalogs, not just the raw identifiers
    const created = await findInvestigationMedicalHistoryWithRelations(data.investigationId, true);
    return created ? toInvestigationMedicalHistoryResponse(created) : null;
}

// The order of the two listings, as in F29 and unlike F30. This entity has no date of the domain
// that orders it better: its fifteen columns are answers of an anamnesis, not dated facts, and none
// of them orders the way deathDate ordered F30. createdAt never moves after the insert, unlike
// updatedAt, which would shuffle the list on every save
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the medical history itself, and it lands on the primary key. caseId
// does not belong here: it is a column of the investigation, so it travels in the where of the
// include instead — the same include that already implements the inherited visibility, so filtering
// by case costs no extra join
const buildListWhere = (filters: InvestigationMedicalHistoryListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationMedicalHistoryListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The includes shared by the two listings. The parent goes required: true, which keeps it an INNER
// JOIN — what makes the filters above bite and what keeps a medical history hanging from a retired
// investigation out of 002A. The four catalogs go required: false, and that is not a detail: with
// required: true every row outside the pregnancy block would disappear from the listing, and those
// will be most of them
const listInclude = (filters: InvestigationMedicalHistoryListFilters, includeInactive: boolean) => [
    {
        ...INVESTIGATION_INCLUDE,
        required: true,
        where: buildInvestigationWhere(filters, includeInactive)
    },
    ...CATALOG_INCLUDES
];

// Get Active Investigation Medical Histories Service
// Code: ESAVI-INVMEDH-002A
// The dual listing inherited from F29 and F30: the visibility is not a column of its own, it is
// inherited from investigation.isActive, so the two variants return different sets. Without a 002B
// an ADMIN would have no way of seeing the medical history of a retired investigation
const getInvestigationMedicalHistoriesService = async (
    filters: InvestigationMedicalHistoryListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationMedicalHistory.findAndCountAll({
        where: buildListWhere(filters),
        attributes: MEDICAL_HISTORY_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003: there is no reduced shape. The entity has
    // fifteen data columns and trimming them would leave a listing with no content
    return { count, rows: rows.map(toInvestigationMedicalHistoryResponse) };
}

// Get All Investigation Medical Histories Service - For Admin
// Code: ESAVI-INVMEDH-002B
const getAllInvestigationMedicalHistoriesService = async (
    filters: InvestigationMedicalHistoryListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationMedicalHistory.findAndCountAll({
        where: buildListWhere(filters),
        attributes: MEDICAL_HISTORY_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationMedicalHistoryResponse) };
}

// Get Investigation Medical History By ID Service
// Code: ESAVI-INVMEDH-003
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation and no separate operation is needed for it.
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// investigation must be active unless canViewInactive says otherwise — today SUPERADMIN. Both
// failures answer the same 404 without distinguishing, because telling them apart would confirm to a
// USER that a medical history exists under an investigation it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// investigation, which is what makes it possible to consult it before purging it
const getInvestigationMedicalHistoryByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const history = await findInvestigationMedicalHistoryWithRelations(id, includeInactive);
    if( !history ) {
        throw new AppError(getMessage('investigationMedicalHistory.notFound', lang), 404, 'INVMEDH_003_NOT_FOUND');
    }
    return toInvestigationMedicalHistoryResponse(history);
}

// Get Investigation Medical History By Case ID Service
// Code: ESAVI-INVMEDH-006
// The real query of the domain: the client holds the caseId, not the investigationId. It returns the
// record itself and not { count, rows } — the chain case -> investigation -> medical history is one
// to one on both hops, and wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// The three 404 are deliberately distinct, and the asymmetry with 003 is intentional: there the
// client already holds the primary key of the row, here it enters through a caseId and needs to know
// which link of the chain broke — whether the case is not there, whether it has no visible
// investigation, or whether the anamnesis has not been recorded yet. Those are three different
// actions on the user's side, and one generic message would make them indistinguishable
const getInvestigationMedicalHistoryByCaseIdService = async (caseId: string, lang: string, includeInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('investigationMedicalHistory.caseNotFound', lang), 404, 'INVMEDH_006_CASE_NOT_FOUND');
    }

    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    const investigation = await Investigation.findOne({ where, attributes: ['investigationId'] });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationMedicalHistory.investigationNotFound', lang),
            404,
            'INVMEDH_006_INVESTIGATION_NOT_FOUND'
        );
    }

    const history = await findInvestigationMedicalHistoryWithRelations(investigation.investigationId, includeInactive);
    if( !history ) {
        throw new AppError(getMessage('investigationMedicalHistory.notFound', lang), 404, 'INVMEDH_006_NOT_FOUND');
    }
    return toInvestigationMedicalHistoryResponse(history);
}

// Update Investigation Medical History Service
// Code: ESAVI-INVMEDH-004
// The main operation of the entity: the row is opened empty and completed over time, so this is
// where the form is actually filled in. investigationId is ignored whether or not it arrives in the
// body — it is the primary key of the row and the foreign key to its investigation at the same time,
// and moving it would take a patient's anamnesis to another file. It does not return 400 either,
// which is what keeps working the PUT that resends the response of its own GET
const updateInvestigationMedicalHistoryService = async (
    id: string,
    data: Partial<CreateInvestigationMedicalHistoryInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const history = await findInvestigationMedicalHistoryRow(id, canViewInactive);
    if( !history ) {
        throw new AppError(getMessage('investigationMedicalHistory.notFound', lang), 404, 'INVMEDH_004_NOT_FOUND');
    }

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending whole
    // the record just read with a GET is the normal use of a form, and writing it back would fill
    // appDetails with entries that record no change and hide the real ones among them.
    // The row is read WITHOUT narrowed attributes, which is the precondition of the helper
    const stored = history.get({ plain: true }) as Record<string, unknown>;

    // The resulting state governs the pregnancy block and is computed once, before anything else:
    // what travels merged with what is stored. It is the service and not the validator who emits it,
    // because express-validator cannot see the stored row. It runs BEFORE the diff and
    // independently of it
    const resultingPregnancy = data.isPregnancyConfirmed !== undefined
        ? ( data.isPregnancyConfirmed ?? null )
        : ( ( stored.isPregnancyConfirmed as AnswerOption | null ) ?? null );

    // The update variant of the rule: a field of the block that does NOT travel is forced to null
    // further down without asking and without an error; one that travels WITH CONTENT is still a
    // 400, because a body that denies the pregnancy and at the same time dates the delivery
    // contradicts itself, and swallowing it would lose the datum in silence while making the client
    // believe it was saved. Sending it as null is not an error: it is the same destination the
    // forcing reaches on its own
    assertPregnancyFieldsAreAllowed(resultingPregnancy, data, '004', lang);

    // Only the keys that travel with content are resolved against their catalog. One the forcing of
    // the block is about to set to null is not looked up: there is nothing to find. The check runs
    // BEFORE the diff and independently of it — an inactive item is a 404 even when it matches what
    // is stored — but it is posterior to the rule of the block
    await assertCatalogItemsAreValid(data, '004', lang);

    // No candidate is placed under an `if( data.x )`. Over the five answerOption a truthiness check
    // would work by accident — the five strings of the ENUM are truthy — but would silently discard
    // the null the client empties the field with. Over gestationalWeeks it would be outright
    // destructive: 0 is a valid value of the CHECK and would be thrown away. The same with
    // birthWeightGrams. No field is encrypted
    const candidates: Record<string, unknown> = {
        // investigationId does NOT enter: immutable, ignored in silence and with no 400

        // The five fields outside the pregnancy block, as plain nullable ones. The `?? null` is what
        // keeps null and 'NO_ANSWER' apart: the first means the form did not collect the answer, the
        // second that it was asked and not answered
        hasPriorHospitalizationHistory: data.hasPriorHospitalizationHistory !== undefined
            ? ( data.hasPriorHospitalizationHistory ?? null ) : undefined,
        // Normalized before comparing, or a body differing only in surrounding blanks would count as
        // a change. Not tied to its flag: a note explaining WHY the answer is 'UNKNOWN' is exactly
        // when the free text is worth the most
        priorHospitalizationObservations: data.priorHospitalizationObservations !== undefined
            ? normalizeText(data.priorHospitalizationObservations) : undefined,
        hasFamilyHistory: data.hasFamilyHistory !== undefined ? ( data.hasFamilyHistory ?? null ) : undefined,
        familyHistoryObservations: data.familyHistoryObservations !== undefined
            ? normalizeText(data.familyHistoryObservations) : undefined,

        // The key of the block, and it is NOT governed by it: it is the field that decides, not one
        // of the decided. Entering as a conditional derivative would make it annul itself
        isPregnancyConfirmed: data.isPregnancyConfirmed !== undefined ? ( data.isPregnancyConfirmed ?? null ) : undefined,

        // The nine conditional derivatives. When the resulting key is not 'YES' the null enters
        // candidates ALWAYS, with no presence check, and it is buildDifferentialUpdate who decides
        // whether it differs: closing a block that was already closed writes nothing. A cleanup with
        // a second UPDATE after the diff would write even when nothing changed
        gestationalWeeks: resultingPregnancy === 'YES'
            ? ( data.gestationalWeeks !== undefined ? ( data.gestationalWeeks ?? null ) : undefined )
            : null,
        gestationMethodItemId: resultingPregnancy === 'YES'
            ? ( data.gestationMethodItemId !== undefined ? ( data.gestationMethodItemId ?? null ) : undefined )
            : null,
        deliveryItemId: resultingPregnancy === 'YES'
            ? ( data.deliveryItemId !== undefined ? ( data.deliveryItemId ?? null ) : undefined )
            : null,
        birthItemId: resultingPregnancy === 'YES'
            ? ( data.birthItemId !== undefined ? ( data.birthItemId ?? null ) : undefined )
            : null,
        pregnancyOutcomeItemId: resultingPregnancy === 'YES'
            ? ( data.pregnancyOutcomeItemId !== undefined ? ( data.pregnancyOutcomeItemId ?? null ) : undefined )
            : null,
        hasPregnancyRiskFactor: resultingPregnancy === 'YES'
            ? ( data.hasPregnancyRiskFactor !== undefined ? ( data.hasPregnancyRiskFactor ?? null ) : undefined )
            : null,
        riskFactorDescription: resultingPregnancy === 'YES'
            ? ( data.riskFactorDescription !== undefined ? normalizeText(data.riskFactorDescription) : undefined )
            : null,
        // Compared by the numeric rule of the helper: stored arrives as the string '3250.00' and the
        // client resends the number 3250, and those are the same weight. It is the rule that keeps
        // every open of the form from producing an invented difference, and the reason the column is
        // declared DECIMAL(8, 2) and not FLOAT
        birthWeightGrams: resultingPregnancy === 'YES'
            ? ( data.birthWeightGrams !== undefined ? ( data.birthWeightGrams ?? null ) : undefined )
            : null,
        wasBreastfed: resultingPregnancy === 'YES'
            ? ( data.wasBreastfed !== undefined ? ( data.wasBreastfed ?? null ) : undefined )
            : null,

        notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
    };

    const objectToUpdate = buildDifferentialUpdate(stored, candidates);

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_investigationMedicalHistory_setSysDetails fires on every write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findInvestigationMedicalHistoryWithRelations(id, true);
        return unchanged ? toInvestigationMedicalHistoryResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the generic
    // loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(history.appDetails) ? history.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVMEDH-004',
        detail: 'Investigation medical history updated by service'
    };
    await history.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updated = await findInvestigationMedicalHistoryWithRelations(id, true);
    return updated ? toInvestigationMedicalHistoryResponse(updated) : null;
}

// Purging Investigation Medical History Service - For SuperAdmin
// Code: ESAVI-INVMEDH-005C
// investigationMedicalHistory is outside the preventPhysicalDelete loop of esaviapp.sql:1368-1381,
// so the row can really be destroyed. This is also the only path that releases the investigationId:
// the logical seal of deletedAt does NOT free the slot of the primary key, so after a 005C a POST
// over that same investigation answers 201 again. And it drags by ON DELETE CASCADE every
// investigationPregnancyCondition of that investigation, which SPEC F33 gave a model and a CRUD.
// That cascade is NOT blocked: it is dumped. The question F32 §7 left in writing is answered in
// F33 §6 — whoever runs this is a SUPERADMIN over an already sealed row, and a block would force a
// purge in two steps whose only advantage is a warning the log already gives. It would also be
// incomplete: ESAVI-INVESTGN-005C destroys those same rows through the same CASCADE without passing
// through this service, so the closed door would have an open window next to it.
// The existence check runs WITHOUT the inherited visibility, on purpose: whoever purges is
// SUPERADMIN and the row may well hang from a retired investigation — which is precisely the normal
// state of something about to be purged.
// The guard by deletedAt is assertRowIsSealed, shared with investigationSource, investigationAutopsy
// and the two notification satellites: it lives in a helper and not in purgeEntityService, whose
// isActive check is inert on this table — `undefined !== true`, so every row would be purgable
// immediately and the only safety net this table has would be gone. The helper is consumed without
// modifying it: it derives the i18n key investigationMedicalHistory.notDeleted from the table name
// and the id from the primaryKeyAttribute of the model, so this entity registers nothing anywhere
const purgeInvestigationMedicalHistoryService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        const history = await InvestigationMedicalHistory.findByPk(id, {
            attributes: ['investigationId', 'deletedAt'],
            transaction
        });
        if( !history ) {
            throw new AppError(getMessage('investigationMedicalHistory.notFound', lang), 404, 'INVMEDH_005C_NOT_FOUND');
        }

        assertRowIsSealed(history, 'INVMEDH_005C_NOT_DELETED', lang);

        // Written before the destroy and inside the transaction that already exists, so what the
        // cascade is about to erase leaves a trace. It does not stop the purge and it does not open
        // a transaction of its own. A count and not a snapshot per row, by the criterion F31 fixed
        // for collections: twenty conditions would bury the line that matters under twenty more.
        // paranoid: false counts the ones a 005A sealed too — the cascade destroys them all the same
        const pregnancyConditionCount = await InvestigationPregnancyCondition.count({
            where: { investigationId: id },
            paranoid: false,
            transaction
        });
        if( pregnancyConditionCount > 0 ) {
            esaviLog(
                `ESAVI-INVMEDH-005C: ${ pregnancyConditionCount } investigation pregnancy condition(s) dragged by ON DELETE CASCADE, purged by ${ authUser?.userId || 'undefined' }`,
                'warn'
            );
        }

        await purgeEntityService({
            model: InvestigationMedicalHistory,
            where: { investigationId: id },
            transaction,
            operationCode: 'ESAVI-INVMEDH-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('investigationMedicalHistory.notFound', lang),
            notFoundCode: 'INVMEDH_005C_NOT_FOUND',
            // Unreachable on this table: the generic guard compares isActive, a column
            // investigationMedicalHistory does not have. The real guard is the one above
            stillActiveMessage: getMessage('investigationMedicalHistory.notDeleted', lang, { id }),
            stillActiveCode: 'INVMEDH_005C_NOT_DELETED'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createInvestigationMedicalHistoryService,
    getInvestigationMedicalHistoriesService,
    getAllInvestigationMedicalHistoriesService,
    getInvestigationMedicalHistoryByIdService,
    getInvestigationMedicalHistoryByCaseIdService,
    updateInvestigationMedicalHistoryService,
    purgeInvestigationMedicalHistoryService
}
