import { WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, EsaviCase, Investigation, InvestigationClinicalEvaluation } from '../models';
import { AppError, assertRowIsSealed, buildDifferentialUpdate, esaviCrypt, esaviDecrypt, esaviLog, getMessage, toTitleCase } from '../helpers';
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

// The same read as above without narrowing the attributes of the clinical evaluation, which is the
// precondition of buildDifferentialUpdate: an instance read with a narrowed `attributes` reads back
// undefined for the columns it left out, and every comparison against undefined would count as a
// change. It still carries the investigation include, so the inherited visibility is checked in the
// same query the update instance comes from
const findInvestigationClinicalEvaluationRow = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationClinicalEvaluation.findOne({
        where: { investigationId: id },
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

// Get Investigation Clinical Evaluation By Case ID Service
// Code: ESAVI-INVCLIEV-006
// The real query of the domain: the client holds the caseId, not the investigationId. It returns the
// record itself and not { count, rows } — the chain case -> investigation -> clinical evaluation is
// one to one on both hops, and wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// The three 404 are deliberately distinct, and the asymmetry with 003 is intentional: there the
// client already holds the primary key of the row, here it enters through a caseId and needs to know
// which link of the chain broke — whether the case is not there, whether it has no visible
// investigation, or whether the clinical evaluation has not been recorded yet. Those are three
// different actions on the user's side, and one generic message would make them indistinguishable
const getInvestigationClinicalEvaluationByCaseIdService = async (caseId: string, lang: string, includeInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('investigationClinicalEvaluation.caseNotFound', lang), 404, 'INVCLIEV_006_CASE_NOT_FOUND');
    }

    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    const investigation = await Investigation.findOne({ where, attributes: ['investigationId'] });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationClinicalEvaluation.investigationNotFound', lang),
            404,
            'INVCLIEV_006_INVESTIGATION_NOT_FOUND'
        );
    }

    const evaluation = await findInvestigationClinicalEvaluationWithRelations(investigation.investigationId, includeInactive);
    if( !evaluation ) {
        throw new AppError(getMessage('investigationClinicalEvaluation.notFound', lang), 404, 'INVCLIEV_006_NOT_FOUND');
    }
    return toInvestigationClinicalEvaluationResponse(evaluation);
}

// Update Investigation Clinical Evaluation Service
// Code: ESAVI-INVCLIEV-004
// The main operation of the entity: the row is opened empty and completed over time, so this is
// where the form is actually filled in. investigationId is ignored whether or not it arrives in the
// body — it is the primary key of the row and the foreign key to its investigation at the same time,
// and moving it would take a patient's assessment to another file. It does not return 400 either,
// which is what keeps working the PUT that resends the response of its own GET
const updateInvestigationClinicalEvaluationService = async (
    id: string,
    data: Partial<CreateInvestigationClinicalEvaluationInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const evaluation = await findInvestigationClinicalEvaluationRow(id, canViewInactive);
    if( !evaluation ) {
        throw new AppError(getMessage('investigationClinicalEvaluation.notFound', lang), 404, 'INVCLIEV_004_NOT_FOUND');
    }

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending whole
    // the record just read with a GET is the normal use of a form, and writing it back would fill
    // appDetails with entries that record no change and hide the real ones among them.
    // The row is read WITHOUT narrowed attributes, which is the precondition of the helper
    const stored = evaluation.get({ plain: true }) as Record<string, unknown>;

    // The stored name is DECRYPTED before anything compares against it, and only when it is not
    // null — esaviDecrypt is never handed a null. From here on `stored` carries plain text on that
    // column, which is what makes the diff compare in clear. Comparing ciphertext against ciphertext
    // would work today, because esaviCrypt is deterministic while the IV is fixed, and would break
    // in silence the day it stops being: the coupling CONVENTIONS.md §11 forbids explicitly
    stored.clinicalDetailsPersonName = stored.clinicalDetailsPersonName
        ? esaviDecrypt(stored.clinicalDetailsPersonName as string)
        : null;

    // The rule of the three pairs, over the RESULTING state: what travels merged with what is
    // stored. It is the service and not the validator who emits it, because express-validator cannot
    // see the stored row. It runs BEFORE the diff and independently of it
    assertFlagExplanationPairs(data, stored, '004', lang);

    // The resulting flag of each pair, recomputed here to drive the conditional derivatives below.
    // The comparison is `=== true` for the same reason as in the rule: over a nullable boolean
    // false, null and absent all close the pair
    const resultingFlag = (flag: 'sourceOther' | 'suspectedChildAbuse' | 'suspectedDomesticViolence'): boolean =>
        ( data[flag] !== undefined ? ( data[flag] ?? null ) : ( ( stored[flag] as boolean | null | undefined ) ?? null ) ) === true;

    const sourceOtherOn = resultingFlag('sourceOther');
    const childAbuseOn = resultingFlag('suspectedChildAbuse');
    const domesticViolenceOn = resultingFlag('suspectedDomesticViolence');

    // No candidate is placed under an `if( data.x )`. Over the six booleans that would be outright
    // destructive: false is a valid value and a truthiness check would throw it away, leaving the
    // field with no way of being turned off. Over receivedMedicalAttention it would work by accident
    // — the five strings of the ENUM are truthy — but would silently discard the null the field is
    // emptied with
    const candidates: Record<string, unknown> = {
        // investigationId does NOT enter: immutable, ignored in silence and with no 400

        // It governs nothing: the shape is validated, the value is stored, and there its role ends.
        // The `?? null` is what keeps null and 'NO_ANSWER' apart — the first means the form did not
        // collect the answer, the second that it was asked and not answered
        receivedMedicalAttention: data.receivedMedicalAttention !== undefined
            ? ( data.receivedMedicalAttention ?? null ) : undefined,

        // The three plain sources. They drag nothing: no explanation is attached to them
        sourceExam: data.sourceExam !== undefined ? ( data.sourceExam ?? null ) : undefined,
        sourceDocuments: data.sourceDocuments !== undefined ? ( data.sourceDocuments ?? null ) : undefined,
        sourceVerbalAutopsy: data.sourceVerbalAutopsy !== undefined ? ( data.sourceVerbalAutopsy ?? null ) : undefined,

        // The three flags are the keys of their pairs and are NOT part of them: they are the fields
        // that decide, not the decided. Entering as conditional derivatives would make them annul
        // themselves
        sourceOther: data.sourceOther !== undefined ? ( data.sourceOther ?? null ) : undefined,
        suspectedChildAbuse: data.suspectedChildAbuse !== undefined ? ( data.suspectedChildAbuse ?? null ) : undefined,
        suspectedDomesticViolence: data.suspectedDomesticViolence !== undefined
            ? ( data.suspectedDomesticViolence ?? null ) : undefined,

        // The three CONDITIONAL DERIVATIVES. When the resulting flag is not true the null enters
        // candidates ALWAYS, with no presence check, and it is buildDifferentialUpdate who decides
        // whether it differs: turning off a suspicion that was already off writes nothing. A cleanup
        // with a second UPDATE after the diff would write even when nothing changed
        otherDescription: sourceOtherOn
            ? ( data.otherDescription !== undefined ? normalizeText(data.otherDescription) : undefined )
            : null,
        childAbuseExplanation: childAbuseOn
            ? ( data.childAbuseExplanation !== undefined ? normalizeText(data.childAbuseExplanation) : undefined )
            : null,
        domesticViolenceExplanation: domesticViolenceOn
            ? ( data.domesticViolenceExplanation !== undefined ? normalizeText(data.domesticViolenceExplanation) : undefined )
            : null,

        // The encrypted column enters the diff in PLAIN TEXT, normalized exactly as it will be
        // stored — .trim() and toTitleCase — so that resending the name a GET returned is not a
        // change. esaviCrypt is applied further down, AFTER the diff
        clinicalDetailsPersonName: data.clinicalDetailsPersonName !== undefined
            ? normalizePersonName(data.clinicalDetailsPersonName) : undefined,

        // The five free texts in clear, normalized before comparing, or a body differing only in
        // surrounding blanks would count as a change
        familyClinicalDetails: data.familyClinicalDetails !== undefined
            ? normalizeText(data.familyClinicalDetails) : undefined,
        completeClinicalSummary: data.completeClinicalSummary !== undefined
            ? normalizeText(data.completeClinicalSummary) : undefined,
        signsAndSymptoms: data.signsAndSymptoms !== undefined ? normalizeText(data.signsAndSymptoms) : undefined,
        otherSocialBackground: data.otherSocialBackground !== undefined
            ? normalizeText(data.otherSocialBackground) : undefined,
        notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
    };

    const objectToUpdate = buildDifferentialUpdate(stored, candidates);

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_investigationClinicalEvaluation_setSysDetails fires on every
    // write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findInvestigationClinicalEvaluationWithRelations(id, true);
        return unchanged ? toInvestigationClinicalEvaluationResponse(unchanged) : null;
    }

    // The name is encrypted NOW, after the diff, over the value the helper returned — and only when
    // it is there and carries content. A null is written as null and never as the encryption of the
    // empty string
    if( objectToUpdate.clinicalDetailsPersonName ) {
        objectToUpdate.clinicalDetailsPersonName = esaviCrypt(objectToUpdate.clinicalDetailsPersonName as string);
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the generic
    // loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(evaluation.appDetails) ? evaluation.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVCLIEV-004',
        detail: 'Investigation clinical evaluation updated by service'
    };
    await evaluation.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updated = await findInvestigationClinicalEvaluationWithRelations(id, true);
    return updated ? toInvestigationClinicalEvaluationResponse(updated) : null;
}

// The row about to be destroyed, dumped at warn level so what disappears leaves a trace.
// clinicalDetailsPersonName is DELIBERATELY OMITTED: this is the only point of the spec where the
// datum could leave the database and land in src/logs/esaviLog.log, and dumping it decrypted would
// annul the encryption through the back door. What is registered is the investigationId and the rest
// of the row
const CLINICAL_EVALUATION_LOG_FIELDS = [
    'investigationId', 'receivedMedicalAttention',
    'sourceExam', 'sourceDocuments', 'sourceVerbalAutopsy', 'sourceOther', 'otherDescription',
    'suspectedChildAbuse', 'childAbuseExplanation',
    'suspectedDomesticViolence', 'domesticViolenceExplanation',
    'familyClinicalDetails', 'completeClinicalSummary', 'signsAndSymptoms',
    'otherSocialBackground', 'notes', 'createdAt', 'updatedAt', 'deletedAt'
] as const;

// Exported because ESAVI-INVESTGN-005C dumps this same row from investigation.service.ts, and the
// omission has to hold on both sides: two copies of the field list would leak the encrypted column
// the first time somebody edited only one of them
export const clinicalEvaluationLogSnapshot = (evaluation: InvestigationClinicalEvaluation): string => {
    const plain = evaluation.get({ plain: true }) as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for( const field of CLINICAL_EVALUATION_LOG_FIELDS ) snapshot[field] = plain[field];
    return JSON.stringify(snapshot);
}

// Purging Investigation Clinical Evaluation Service - For SuperAdmin
// Code: ESAVI-INVCLIEV-005C
// investigationClinicalEvaluation is outside the preventPhysicalDelete loop of
// esaviapp.sql:1368-1381, so the row can really be destroyed. This is also the only path that
// releases the investigationId: the logical seal of deletedAt does NOT free the slot of the primary
// key, so after a 005C a POST over that same investigation answers 201 again. And it will drag by
// ON DELETE CASCADE every evaluationInstitution of that investigation, when that table exists.
// The existence check runs WITHOUT the inherited visibility, on purpose: whoever purges is
// SUPERADMIN and the row may well hang from a retired investigation — which is precisely the normal
// state of something about to be purged.
// The guard by deletedAt is assertRowIsSealed, shared with investigationSource, investigationAutopsy,
// investigationMedicalHistory and the two notification satellites: it lives in a helper and not in
// purgeEntityService, whose isActive check is inert on this table — `undefined !== true`, so every
// row would be purgable immediately and the only safety net this table has would be gone. The helper
// is consumed without modifying it: it derives the i18n key investigationClinicalEvaluation.notDeleted
// from the table name and the id from the primaryKeyAttribute of the model, so this entity registers
// nothing anywhere.
//
// THE ONE DEVIATION FROM ITS SISTERS: this service does the destroy itself instead of delegating to
// purgeEntityService. That common service dumps a snapshot of the WHOLE row before destroying it, and
// on this table that snapshot would carry clinicalDetailsPersonName — its ciphertext, under its
// column name — straight into src/logs/esaviLog.log, which is exactly what SPEC F34 §3.5 forbids and
// what a criterion of §5 checks by grep. The alternatives were teaching purgeEntityService to exclude
// columns, which the spec puts out of scope, or accepting the ciphertext in the log, which would
// erode the encryption decision §6 calls the most expensive one to reverse. What the common service
// contributes here is little: its notFound guard is already covered above and its isActive check is
// inert on a table without that column, so what is lost by not calling it is the dump — the very
// thing being replaced
const purgeInvestigationClinicalEvaluationService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        // paranoid: false, because the row about to be purged is precisely one that a 005A sealed.
        // The whole row and not just the two columns of the guard: the dump below needs its content
        const evaluation = await InvestigationClinicalEvaluation.findByPk(id, { paranoid: false, transaction });
        if( !evaluation ) {
            throw new AppError(getMessage('investigationClinicalEvaluation.notFound', lang), 404, 'INVCLIEV_005C_NOT_FOUND');
        }

        assertRowIsSealed(evaluation, 'INVCLIEV_005C_NOT_DELETED', lang);

        // Written before the destroy and inside the transaction that already exists, so what is about
        // to be erased leaves a trace. It does not stop the purge and it does not open a transaction
        // of its own
        esaviLog(
            `ESAVI-INVCLIEV-005C: investigation clinical evaluation purged by ${ authUser?.userId || 'undefined' }: ${ clinicalEvaluationLogSnapshot(evaluation) }`,
            'warn'
        );

        // No appDetails entry: the row is destroyed in this same transaction, so any audit written
        // into it would be destroyed with it. That is what CONVENTIONS.md §6 prescribes for a 005C
        await evaluation.destroy({ force: true, transaction });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createInvestigationClinicalEvaluationService,
    getInvestigationClinicalEvaluationsService,
    getAllInvestigationClinicalEvaluationsService,
    getInvestigationClinicalEvaluationByIdService,
    getInvestigationClinicalEvaluationByCaseIdService,
    updateInvestigationClinicalEvaluationService,
    purgeInvestigationClinicalEvaluationService
}
