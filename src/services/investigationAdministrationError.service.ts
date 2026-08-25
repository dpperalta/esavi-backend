import { WhereOptions } from 'sequelize';
import { EsaviCase, Investigation, InvestigationAdministrationError } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationAdministrationErrorInput,
    InvestigationAdministrationErrorListFilters
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The investigation travels in every response, narrowed to three fields: what the client needs is to
// know which case the row hangs from and whether its parent is alive. Returning the whole
// investigation would duplicate the payload of ESAVI-INVESTGN-003.
// It is also what governs the visibility of the administration error, so hiding it would leave the
// client unable to explain why a record it read yesterday now answers 404
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'caseId', 'isActive']
};

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here it
// is the primary key of the row, and also the identifier of its investigation
const ADMINISTRATION_ERROR_EXCLUDE = {
    exclude: ['sysDetails']
};

// THE FOUR SYRINGE TYPES OF THE BLOCK, declared once so the minimum rule is written a single time
// instead of as four loose comparisons. THE ORDER OF THE ARRAY MEANS NOTHING HERE — and that is the
// difference with the container list of F38, where the order WAS the precedence: there is no
// precedence to declare, only a check that some of them results true. It does NOT go to
// src/constants/investigation.constants.ts: only this service consumes it, the same way F27, F32,
// F34, F36 and F38 kept their lists local
const SYRINGE_TYPE_FIELDS = [
    'usedGlassSyringes',
    'usedDisposableSyringes',
    'usedRecycledDisposableSyringes',
    'usedOtherSyringes',
] as const;

// The whole block the flag governs: the four types plus the description. It is the list the create
// forbids when the block is closed and the list the update forces to null in that same case
const SYRINGE_BLOCK_FIELDS = [
    ...SYRINGE_TYPE_FIELDS,
    'otherSyringesDescription',
] as const;

// The sixteen answer columns are returned exactly as stored, null included: they are never
// normalized when building the response. Over the twelve answerOption columns a null means the form
// did not collect the answer and a 'NO_ANSWER' means it was asked and not answered — different data,
// and neither becomes the other. Over the four booleans a false means "that type of syringe was not
// used" and a null means "it is not known", which is the same distinction with three states instead
// of five.
// There is no catalog include to resolve here, exactly as in F38: the sixteen answers are literal
// values and resolve against nothing.
// There is no isActive to return — the table does not have that column. deletedAt is the only status
// mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationAdministrationErrorResponse = (administrationError: InvestigationAdministrationError) => {
    const plain = administrationError.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so an administration error hanging from a retired investigation simply does not come
// back
const findInvestigationAdministrationErrorWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationAdministrationError.findOne({
        where: { investigationId: id },
        attributes: ADMINISTRATION_ERROR_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take a new
// administration error. The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationAdministrationError.investigationNotFound', lang),
            404,
            `INVADMER_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a sealed
// administration error still occupies its investigationId, and only ESAVI-INVADMER-005C frees it.
// The check does not rely on the collision either: a 23505 would reach the client as a 500 and its
// Postgres message says nothing useful. The message carries the investigationId because otherwise
// the client sees a 409 about a row it did not name
const assertAdministrationErrorDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationAdministrationError.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationAdministrationError.alreadyExists', lang, { investigationId }),
            409,
            `INVADMER_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. There is neither `code` nor `name` here, so toConstantCase and toTitleCase do not
// apply — the ten free columns keep the casing the investigator typed. None of them is capped:
// the ten are text in the DDL, with no declared ceiling
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// "Travelling with content" is not the same as "travelling": a field sent as null is the same
// destination the forcing of 004 reaches on its own, so it is never an offence, on create or on
// update. A blank string is no content either — normalizeText would store it as null.
// FALSE IS CONTENT, and that is the whole point of the last line: over the four syringe types a
// truthiness check would throw the false away, and "syringes were used, but not glass ones" — a
// legitimate answer of the form — would become inexpressible.
// This entity needs NO travels() helper, which is the difference with F38: that one had to separate
// a conflict from a relay in its container rule, and here there is no precedence between fields at
// all. Whether the key arrived only matters for the asymmetry of the forbidden fields, and
// hasContent already answers it — an absent key and a null key are the same thing to this rule
const hasContent = (value: unknown): boolean => {
    if( value === undefined || value === null ) return false;
    if( typeof value === 'string' ) return value.trim().length > 0;
    return true;
}

// The resulting state of one field: what travels in the body if the key arrives, and what is stored
// otherwise. On create there is no stored row and the caller passes an empty object, so the resulting
// state is whatever arrives. It is computed BEFORE the diff and independently of it
const resultingValue = <T>(
    data: Partial<CreateInvestigationAdministrationErrorInput>,
    stored: Record<string, unknown>,
    field: string
): T | null => {
    const fromBody = ( data as Record<string, unknown> )[field];
    if( fromBody !== undefined ) return ( fromBody ?? null ) as T | null;
    return ( ( stored[field] as T | null | undefined ) ?? null );
}

// THE COMPARISON THAT OPENS THE SYRINGE BLOCK, AND THE FIRST OF THE REPOSITORY THAT OPENS WITH THE
// NEGATIVE ANSWER. Only 'NO' opens it — the single comment of the DDL (esaviapp.sql:1203) says "If
// answer is 'No', then the following fields are required" — while 'YES', 'UNKNOWN',
// 'NOT_APPLICABLE', 'NO_ANSWER' and null close it, the five alike. The form logic is direct: if auto
// disable syringes were used there is nothing else to ask, and if it is not known or does not apply
// there is no type to declare.
// F34, F36 and F38 all opened with the affirmation, so writing === 'YES' here is the inversion §7
// declares a risk: every case of the block keeps passing except the one that sends 'YES' with a type
const isSyringeBlockOpen = (
    data: Partial<CreateInvestigationAdministrationErrorInput>,
    stored: Record<string, unknown>
): boolean => resultingValue<string>(data, stored, 'usedAutoDisableSyringes') === 'NO';

// TWO SUCCESSIVE PASSES OVER THE RESULTING STATE, AND NOT ONE COMPOSITE CONDITION. Separating them
// is not an implementation detail: it changes the error code the client sees. "You did not declare
// that you used other syringes" and "you did not even open the block" are two different corrections
// of the form, and a composite condition would collapse them into a single 400.
//
// OUTER PASS — the block is closed. The five fields are forbidden, and the two operations part ways
// exactly as F34, F36 and F38 fixed. On create it is always a 400: there is no inherited state to
// clear, so accepting in silence a datum that will never be stored would return a 201 lying about
// what it saved. On update it is a 400 only for the fields that travel WITH CONTENT; the ones that
// do not travel are forced to null by the candidates, without asking and without an error. Sending
// them as null is not an offence on either operation: it is the same destination the forcing reaches
// on its own. The nested pass is not reached.
//
// MINIMUM RULE — the block is open. AT LEAST ONE of the four types must result true, which is the
// first minimum rule of the repository: the DDL comment says required, and an open and empty block
// registers nothing — it declares that auto disable syringes were not used and stays silent about
// what was, which is exactly the datum the block exists to capture. It is evaluated over the
// RESULTING state and never over the body, so a PUT { notes: 'x' } over a row already populated does
// not fail. false does NOT count as a declaration: the four in false is the same 400 as the four
// absent.
//
// NESTED PASS — the block is open and the minimum is met. The description is allowed only when
// usedOtherSyringes results true; with false or null it is forbidden with its own code. The nested
// condition is written in no line of the DDL — the comment of :1203 puts the description in the
// outer block and stays silent about the second condition — and comes from the form.
// THE DESCRIPTION IS NEVER REQUIRED: usedOtherSyringes true without a description is a valid create
// and a valid update. The nested block opens the column, it does not claim it
const assertSyringeBlock = (
    data: Partial<CreateInvestigationAdministrationErrorInput>,
    stored: Record<string, unknown>,
    op: string,
    lang: string
) => {
    const body = data as Record<string, unknown>;

    // Outer pass
    if( !isSyringeBlockOpen(data, stored) ) {
        const offending = SYRINGE_BLOCK_FIELDS.some(field => hasContent(body[field]));
        if( offending ) {
            throw new AppError(
                getMessage('investigationAdministrationError.syringeDetailNotAllowed', lang),
                400,
                `INVADMER_${ op }_SYRINGE_DETAIL_NOT_ALLOWED`
            );
        }
        return;
    }

    // Minimum rule
    const someTypeDeclared = SYRINGE_TYPE_FIELDS.some(
        field => resultingValue<boolean>(data, stored, field) === true
    );
    if( !someTypeDeclared ) {
        throw new AppError(
            getMessage('investigationAdministrationError.syringeTypeRequired', lang),
            400,
            `INVADMER_${ op }_SYRINGE_TYPE_REQUIRED`
        );
    }

    // Nested pass
    const otherSyringesUsed = resultingValue<boolean>(data, stored, 'usedOtherSyringes') === true;
    if( !otherSyringesUsed && hasContent(body.otherSyringesDescription) ) {
        throw new AppError(
            getMessage('investigationAdministrationError.otherDescriptionNotAllowed', lang),
            400,
            `INVADMER_${ op }_OTHER_DESCRIPTION_NOT_ALLOWED`
        );
    }
}

// Create Investigation Administration Error Service
// Code: ESAVI-INVADMER-001
export const createInvestigationAdministrationErrorService = async (
    data: CreateInvestigationAdministrationErrorInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    // The six steps of §3.5, in this order. The two guards of the create run first, and the rules of
    // the domain before anything is written
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertAdministrationErrorDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the block is evaluated against an empty
    // stored: everything that arrives, arrives in the body. The two passes of the nested rule run
    // inside, in their fixed order
    assertSyringeBlock(data, {}, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVADMER-001',
        detail: 'Investigation administration error created by service'
    };

    // The empty create: the minimum is { investigationId } and the twenty six data columns come back
    // null. It is the pattern of F13, F14, F29, F32, F34, F36 and F38 — an administration error that
    // has not been filled in yet is a real state of the form, not a client error. It keeps working
    // under the minimum rule because a null flag CLOSES the block.
    // The `?? null` is written without any truthiness check on purpose: over the four booleans an
    // `if( data.x )` would be outright destructive, because false is a valid value and would be
    // thrown away; over the twelve answerOption columns it would work by accident — the five strings
    // of the ENUM are truthy — but would silently discard the null the field is emptied with.
    // deletedAt is born null and there is no isActive to set: the investigation had to be active to
    // get here, so an administration error cannot be created already dragged
    await InvestigationAdministrationError.create({
        investigationId: data.investigationId,
        usedAutoDisableSyringes: data.usedAutoDisableSyringes ?? null,
        usedGlassSyringes: data.usedGlassSyringes ?? null,
        usedDisposableSyringes: data.usedDisposableSyringes ?? null,
        usedRecycledDisposableSyringes: data.usedRecycledDisposableSyringes ?? null,
        usedOtherSyringes: data.usedOtherSyringes ?? null,
        otherSyringesDescription: normalizeText(data.otherSyringesDescription),
        syringesKeyFindings: normalizeText(data.syringesKeyFindings),
        reconstitutionUsedSameSyringe: data.reconstitutionUsedSameSyringe ?? null,
        reconstitutionUsedSameSyringeDifferentVaccine: data.reconstitutionUsedSameSyringeDifferentVaccine ?? null,
        reconstitutionUsedDifferentSyringeSameVial: data.reconstitutionUsedDifferentSyringeSameVial ?? null,
        reconstitutionUsedDifferentSyringeDifferentVaccine: data.reconstitutionUsedDifferentSyringeDifferentVaccine ?? null,
        reconstitutionFollowedManufacturerRecommendation: data.reconstitutionFollowedManufacturerRecommendation ?? null,
        reconstitutionKeyFindings: normalizeText(data.reconstitutionKeyFindings),
        // The six had* / *Notes pairs are written exactly as they arrive, each of the twelve columns
        // on its own: no note is emptied because of its flag, and no flag is derived from its note
        hadPrescriptionError: data.hadPrescriptionError ?? null,
        prescriptionErrorNotes: normalizeText(data.prescriptionErrorNotes),
        hadContaminatedVaccine: data.hadContaminatedVaccine ?? null,
        contaminatedVaccineNotes: normalizeText(data.contaminatedVaccineNotes),
        hadAbnormalVaccineConditions: data.hadAbnormalVaccineConditions ?? null,
        abnormalConditionsNotes: normalizeText(data.abnormalConditionsNotes),
        hadPreparationError: data.hadPreparationError ?? null,
        preparationErrorNotes: normalizeText(data.preparationErrorNotes),
        hadHandlingError: data.hadHandlingError ?? null,
        handlingErrorNotes: normalizeText(data.handlingErrorNotes),
        hadImproperAdministration: data.hadImproperAdministration ?? null,
        improperAdministrationNotes: normalizeText(data.improperAdministrationNotes),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    esaviLog(`ESAVI-INVADMER-001: Investigation administration error created for investigation ${ data.investigationId }`, 'info');

    // Re-read so the response carries the resolved investigation, not just the raw identifier
    const created = await findInvestigationAdministrationErrorWithRelations(data.investigationId, true);
    return created ? toInvestigationAdministrationErrorResponse(created) : null;
}

// The order of the two listings, as in F29, F32, F34, F36 and F38. This entity has no date of the
// domain that orders it better: its twenty six columns are what went wrong while administering a
// dose, not dated facts. createdAt never moves after the insert, unlike updatedAt, which would
// shuffle the list on every save
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the administration error itself, and it lands on the primary key —
// which is already indexed, so no index had to be declared for it. caseId does not belong here: it
// is a column of the investigation, so it travels in the where of the include instead — the same
// include that already implements the inherited visibility, so filtering by case costs no extra
// join.
// There is no filter over any domain column — syringe type, reconstitution practice, any of the six
// concrete errors — and there will not be one: it would be the first of the repository and opens the
// door to dashboards
const buildListWhere = (filters: InvestigationAdministrationErrorListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationAdministrationErrorListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The single include of the two listings, and it is single because this entity has no foreign key to
// catalogItem: there is no nullable catalog join here that would have to carry required: false. The
// parent goes required: true, which keeps it an INNER JOIN — what makes the filters above bite and
// what keeps an administration error hanging from a retired investigation out of 002A
const listInclude = (filters: InvestigationAdministrationErrorListFilters, includeInactive: boolean) => [{
    ...INVESTIGATION_INCLUDE,
    required: true,
    where: buildInvestigationWhere(filters, includeInactive)
}];

// Get Active Investigation Administration Errors Service
// Code: ESAVI-INVADMER-002A
// The dual listing inherited from F29, F30, F32, F34, F36 and F38: the visibility is not a column of
// its own, it is inherited from investigation.isActive, so the two variants return different sets.
// Without a 002B an ADMIN would have no way of seeing the administration error of a retired
// investigation
export const getInvestigationAdministrationErrorsService = async (
    filters: InvestigationAdministrationErrorListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationAdministrationError.findAndCountAll({
        where: buildListWhere(filters),
        attributes: ADMINISTRATION_ERROR_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003: there is no reduced shape, and these are WIDE
    // rows — twenty six data columns per element — which is exactly why the default pagination is
    // not relaxed here. A filter whose UUID matches nothing returns 200 with { count: 0, rows: [] }
    // and never a 404 — an empty listing is an answer, not a missing resource
    return { count, rows: rows.map(toInvestigationAdministrationErrorResponse) };
}

// Get All Investigation Administration Errors Service - For Admin
// Code: ESAVI-INVADMER-002B
export const getAllInvestigationAdministrationErrorsService = async (
    filters: InvestigationAdministrationErrorListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationAdministrationError.findAndCountAll({
        where: buildListWhere(filters),
        attributes: ADMINISTRATION_ERROR_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationAdministrationErrorResponse) };
}

// Get Investigation Administration Error By ID Service
// Code: ESAVI-INVADMER-003
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation and no separate operation is needed for it.
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// investigation must be active unless canViewInactive says otherwise — today SUPERADMIN. Both
// failures answer the same 404 without distinguishing, because telling them apart would confirm to a
// USER that an administration error exists under an investigation it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// investigation, which is what makes it possible to consult it before purging it
export const getInvestigationAdministrationErrorByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const administrationError = await findInvestigationAdministrationErrorWithRelations(id, includeInactive);
    if( !administrationError ) {
        throw new AppError(getMessage('investigationAdministrationError.notFound', lang), 404, 'INVADMER_003_NOT_FOUND');
    }
    return toInvestigationAdministrationErrorResponse(administrationError);
}

// Get Investigation Administration Error By Case ID Service
// Code: ESAVI-INVADMER-006
// The real query of the domain: the client holds the caseId, not the investigationId. It returns the
// record itself and not { count, rows } — the chain case -> investigation -> administration error is
// one to one on BOTH hops, imposed by UQ_investigation_case on the first and by the shared primary
// key on the second, so wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// THREE DISTINCT 404, and the difference matters to the client: "that case does not exist", "it has
// no visible investigation" and "its investigation has no administration error yet" are three
// different things to show on screen, and only the third one is fixed by creating one
export const getInvestigationAdministrationErrorByCaseIdService = async (caseId: string, lang: string, includeInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('investigationAdministrationError.caseNotFound', lang), 404, 'INVADMER_006_CASE_NOT_FOUND');
    }

    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    const investigation = await Investigation.findOne({ where, attributes: ['investigationId'] });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationAdministrationError.investigationNotFound', lang),
            404,
            'INVADMER_006_INVESTIGATION_NOT_FOUND'
        );
    }

    const administrationError = await findInvestigationAdministrationErrorWithRelations(
        investigation.investigationId,
        includeInactive
    );
    if( !administrationError ) {
        throw new AppError(getMessage('investigationAdministrationError.notFound', lang), 404, 'INVADMER_006_NOT_FOUND');
    }
    return toInvestigationAdministrationErrorResponse(administrationError);
}
