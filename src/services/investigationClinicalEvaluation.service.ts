import { WhereOptions } from 'sequelize';
import { CatalogItem, EsaviCase, Investigation, InvestigationClinicalEvaluation } from '../models';
import { AppError, esaviCrypt, esaviDecrypt, getMessage, toTitleCase } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationClinicalEvaluationInput,
    InvestigationClinicalEvaluationListFilters
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The investigation travels in every response: it is what governs the visibility of the clinical
// evaluation, and hiding it would leave the client unable to explain why a record it read yesterday
// now answers 404. Its own sysDetails stays out, like the one of the clinical evaluation.
// status never comes back null, by the rule F28 imposed on that entity.
// This is the ONLY include of the entity: investigationClinicalEvaluation has no foreign key to
// catalogItem, so there is no catalog to resolve and nothing decorative to add
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

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here
// it is the primary key of the row, and also the identifier of its investigation
const CLINICAL_EVALUATION_EXCLUDE = {
    exclude: ['sysDetails']
};

// receivedMedicalAttention is returned exactly as stored, null included: it is never normalized when
// building the response. A null means the form did not collect the answer and a 'NO_ANSWER' means it
// was asked and not answered — different data, and neither becomes the other. The six booleans are
// returned as true, false or null without collapsing either, for the same reason.
// clinicalDetailsPersonName is DECRYPTED here, which is what keeps the ciphertext from ever crossing
// the HTTP boundary — on the five operations that return the row, listings included. esaviDecrypt is
// never handed a null.
// There is no isActive to return — the table does not have that column. deletedAt is the only status
// mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationClinicalEvaluationResponse = (evaluation: InvestigationClinicalEvaluation) => {
    const plain = evaluation.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    plain.clinicalDetailsPersonName = plain.clinicalDetailsPersonName
        ? esaviDecrypt(plain.clinicalDetailsPersonName as string)
        : null;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a clinical evaluation hanging from a retired investigation simply does not come back
const findInvestigationClinicalEvaluationWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationClinicalEvaluation.findOne({
        where: { investigationId: id },
        attributes: CLINICAL_EVALUATION_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take a new clinical
// evaluation. The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationClinicalEvaluation.investigationNotFound', lang),
            404,
            `INVCLIEV_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a sealed
// clinical evaluation still occupies its investigationId, and only ESAVI-INVCLIEV-005C frees it. The
// check does not rely on the collision either: a 23505 would reach the client as a 500 and its
// Postgres message says nothing useful. The message carries the investigationId because otherwise
// the client sees a 409 about a row it did not name
const assertClinicalEvaluationDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationClinicalEvaluation.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationClinicalEvaluation.alreadyExists', lang, { investigationId }),
            409,
            `INVCLIEV_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. There is neither `code` nor `name` here, so toConstantCase does not apply
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The only encrypted field of the entity, and the first one of an investigation satellite.
// .trim() and toTitleCase run BEFORE encrypting, following what F05 does with firstName: without
// that step "juan" and "Juan" would produce different ciphertexts and the diff would invent a
// difference on every open of the form. A null is stored as null and never as the encryption of the
// empty string
const normalizePersonName = (value: string | null | undefined): string | null => {
    const normalized = normalizeText(value);
    return normalized ? toTitleCase(normalized) : null;
}

// The three flag/explanation pairs, declared once so the rule is applied parametrized instead of
// written three times — three copies diverge on the first correction that only reaches two of them.
// They do NOT go to src/constants/investigation.constants.ts: only this service consumes them, the
// same way F27 and F32 kept their catalog codes local.
// The order is the evaluation order, and it is what decides which 400 a body breaking two pairs at
// once receives: the first offender cuts and the following pairs are not evaluated
const FLAG_EXPLANATION_PAIRS = [
    { flag: 'sourceOther',               explanation: 'otherDescription',            key: 'OTHER_DESCRIPTION' },
    { flag: 'suspectedChildAbuse',       explanation: 'childAbuseExplanation',       key: 'CHILD_ABUSE_EXPLANATION' },
    { flag: 'suspectedDomesticViolence', explanation: 'domesticViolenceExplanation', key: 'DOMESTIC_VIOLENCE_EXPLANATION' },
] as const;

// The i18n key of each pair, derived from its constant name: OTHER_DESCRIPTION -> otherDescription.
// Six distinct keys and not two with an interpolated {{field}}, because the three pairs are three
// different concepts and so is the message the user needs to read
const messageKeyFor = (key: string, suffix: 'Required' | 'NotAllowed'): string => {
    const camel = key.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return `investigationClinicalEvaluation.${ camel }${ suffix }`;
}

// "Travelling with content" is not the same as "travelling": a field sent as null is the same
// destination the forcing of 004 reaches on its own, so it is never an offence. A blank string is no
// content either — normalizeText would store it as null
const hasContent = (value: unknown): boolean => {
    if( value === undefined || value === null ) return false;
    if( typeof value === 'string' ) return value.trim().length > 0;
    return true;
}

// The rule of the three pairs, evaluated over the RESULTING state and never over the body. On create
// there is no stored row, so the resulting state is whatever arrives — the caller passes stored as an
// empty object.
//
// The comparison is ALWAYS `=== true`. Over a nullable boolean the "no" has three forms — false, null
// and absent — and the three count the same: the pair is closed. Writing the rule against the
// truthiness of the value would work by accident and break in silence the day the column changes.
//
// The three pairs are independent: each one is evaluated against its own resulting flag and produces
// its own error, in the order of FLAG_EXPLANATION_PAIRS.
//
// With the resulting flag true the explanation must exist and not be blank after trimming, whether it
// travels in the body or is already stored — a PUT sending only { suspectedChildAbuse: true } over a
// row that already has its explanation is VALID, because the resulting state is coherent.
//
// With the resulting flag not true the two operations part ways, and the caller says which one it is:
// on create it is always a 400 (there is no inherited state to clear, so accepting in silence a datum
// that will never be stored would return a 201 lying about what it saved); on update it is a 400 only
// when the explanation travels WITH CONTENT, because a body that denies the suspicion and at the same
// time explains it contradicts itself. When it does not travel, the forcing to null further down
// handles it without an error
const assertFlagExplanationPairs = (
    data: Partial<CreateInvestigationClinicalEvaluationInput>,
    stored: Record<string, unknown>,
    op: string,
    lang: string
) => {
    for( const pair of FLAG_EXPLANATION_PAIRS ) {
        const resultingFlag = data[pair.flag] !== undefined
            ? ( data[pair.flag] ?? null )
            : ( ( stored[pair.flag] as boolean | null | undefined ) ?? null );
        const resultingExplanation = data[pair.explanation] !== undefined
            ? ( data[pair.explanation] ?? null )
            : ( ( stored[pair.explanation] as string | null | undefined ) ?? null );

        if( resultingFlag === true ) {
            if( !hasContent(resultingExplanation) ) {
                throw new AppError(
                    getMessage(messageKeyFor(pair.key, 'Required'), lang),
                    400,
                    `INVCLIEV_${ op }_${ pair.key }_REQUIRED`
                );
            }
            continue;
        }

        // The flag is closed. What offends is the explanation travelling in the body with content:
        // on create that is always the case, and on update it is the contradiction described above.
        // Sending it as null or as a blank string is never an offence
        if( hasContent(data[pair.explanation]) ) {
            throw new AppError(
                getMessage(messageKeyFor(pair.key, 'NotAllowed'), lang),
                400,
                `INVCLIEV_${ op }_${ pair.key }_NOT_ALLOWED`
            );
        }
    }
}

// Create Investigation Clinical Evaluation Service
// Code: ESAVI-INVCLIEV-001
const createInvestigationClinicalEvaluationService = async (
    data: CreateInvestigationClinicalEvaluationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertClinicalEvaluationDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated against an empty
    // stored. It runs before anything is written
    assertFlagExplanationPairs(data, {}, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVCLIEV-001',
        detail: 'Investigation clinical evaluation created by service'
    };

    // The empty create: the minimum is { investigationId } and the sixteen data columns come back
    // null. It is the pattern of F13, F14, F29 and F32 — a clinical evaluation that has not been
    // filled in yet is a real state of the form, not a client error.
    // The `?? null` is written without any truthiness check on purpose: over the six booleans an
    // `if( data.x )` would be outright destructive, because false is a valid value and would be
    // thrown away; over receivedMedicalAttention it would work by accident — the five strings of the
    // ENUM are truthy — but would silently discard the null the field is emptied with.
    // deletedAt is born null and there is no isActive to set: the investigation had to be active to
    // get here, so a clinical evaluation cannot be created already dragged
    await InvestigationClinicalEvaluation.create({
        investigationId: data.investigationId,
        receivedMedicalAttention: data.receivedMedicalAttention ?? null,
        sourceExam: data.sourceExam ?? null,
        sourceDocuments: data.sourceDocuments ?? null,
        sourceVerbalAutopsy: data.sourceVerbalAutopsy ?? null,
        sourceOther: data.sourceOther ?? null,
        otherDescription: normalizeText(data.otherDescription),
        suspectedChildAbuse: data.suspectedChildAbuse ?? null,
        childAbuseExplanation: normalizeText(data.childAbuseExplanation),
        suspectedDomesticViolence: data.suspectedDomesticViolence ?? null,
        domesticViolenceExplanation: normalizeText(data.domesticViolenceExplanation),
        // The only column that is encrypted on the way in. esaviCrypt is applied over the already
        // normalized value, and never over a null
        clinicalDetailsPersonName: ( () => {
            const normalized = normalizePersonName(data.clinicalDetailsPersonName);
            return normalized ? esaviCrypt(normalized) : null;
        } )(),
        familyClinicalDetails: normalizeText(data.familyClinicalDetails),
        completeClinicalSummary: normalizeText(data.completeClinicalSummary),
        signsAndSymptoms: normalizeText(data.signsAndSymptoms),
        otherSocialBackground: normalizeText(data.otherSocialBackground),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved investigation, its status and its case, not just
    // the raw identifiers
    const created = await findInvestigationClinicalEvaluationWithRelations(data.investigationId, true);
    return created ? toInvestigationClinicalEvaluationResponse(created) : null;
}

// The order of the two listings, as in F29 and F32. This entity has no date of the domain that
// orders it better: its sixteen columns are answers of a clinical assessment, not dated facts.
// createdAt never moves after the insert, unlike updatedAt, which would shuffle the list on every
// save. And ordering by clinicalDetailsPersonName is IMPOSSIBLE: an ORDER BY over an encrypted
// column orders by the ciphertext, the same limitation F05 declared for the names of patient
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the clinical evaluation itself, and it lands on the primary key.
// caseId does not belong here: it is a column of the investigation, so it travels in the where of
// the include instead — the same include that already implements the inherited visibility, so
// filtering by case costs no extra join
const buildListWhere = (filters: InvestigationClinicalEvaluationListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationClinicalEvaluationListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The include shared by the two listings, and the only one there is. The parent goes required: true,
// which keeps it an INNER JOIN — what makes the filters above bite and what keeps a clinical
// evaluation hanging from a retired investigation out of 002A
const listInclude = (filters: InvestigationClinicalEvaluationListFilters, includeInactive: boolean) => [{
    ...INVESTIGATION_INCLUDE,
    required: true,
    where: buildInvestigationWhere(filters, includeInactive)
}];

// Get Active Investigation Clinical Evaluations Service
// Code: ESAVI-INVCLIEV-002A
// The dual listing inherited from F29, F30 and F32: the visibility is not a column of its own, it is
// inherited from investigation.isActive, so the two variants return different sets. Without a 002B
// an ADMIN would have no way of seeing the clinical evaluation of a retired investigation
const getInvestigationClinicalEvaluationsService = async (
    filters: InvestigationClinicalEvaluationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationClinicalEvaluation.findAndCountAll({
        where: buildListWhere(filters),
        attributes: CLINICAL_EVALUATION_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003: there is no reduced shape. The entity has
    // sixteen data columns and trimming them would leave a listing with no content.
    // clinicalDetailsPersonName is decrypted ROW BY ROW here — the same cost F05 assumes in patient,
    // bounded by DEFAULT_LIMIT — so no listing ever returns a ciphertext
    return { count, rows: rows.map(toInvestigationClinicalEvaluationResponse) };
}

// Get All Investigation Clinical Evaluations Service - For Admin
// Code: ESAVI-INVCLIEV-002B
const getAllInvestigationClinicalEvaluationsService = async (
    filters: InvestigationClinicalEvaluationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationClinicalEvaluation.findAndCountAll({
        where: buildListWhere(filters),
        attributes: CLINICAL_EVALUATION_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationClinicalEvaluationResponse) };
}

// Get Investigation Clinical Evaluation By ID Service
// Code: ESAVI-INVCLIEV-003
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation and no separate operation is needed for it.
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// investigation must be active unless canViewInactive says otherwise — today SUPERADMIN. Both
// failures answer the same 404 without distinguishing, because telling them apart would confirm to a
// USER that a clinical evaluation exists under an investigation it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// investigation, which is what makes it possible to consult it before purging it
const getInvestigationClinicalEvaluationByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const evaluation = await findInvestigationClinicalEvaluationWithRelations(id, includeInactive);
    if( !evaluation ) {
        throw new AppError(getMessage('investigationClinicalEvaluation.notFound', lang), 404, 'INVCLIEV_003_NOT_FOUND');
    }
    return toInvestigationClinicalEvaluationResponse(evaluation);
}

export {
    createInvestigationClinicalEvaluationService,
    getInvestigationClinicalEvaluationsService,
    getAllInvestigationClinicalEvaluationsService,
    getInvestigationClinicalEvaluationByIdService
}
