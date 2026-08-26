import { WhereOptions } from 'sequelize';
import { Investigation, InvestigationCommunity } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationCommunityInput,
    InvestigationCommunityListFilters
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The investigation travels in every response, narrowed to three fields: what the client needs is to
// know which case the row hangs from and whether its parent is alive. Returning the whole
// investigation would duplicate the payload of ESAVI-INVESTGN-003.
// It is also what governs the visibility of the community record, so hiding it would leave the
// client unable to explain why a record it read yesterday now answers 404
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'caseId', 'isActive']
};

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here it
// is the primary key of the row, and also the identifier of its investigation
const COMMUNITY_EXCLUDE = {
    exclude: ['sysDetails']
};

// THE FIVE FIELDS OF THE SIMILAR EVENT BLOCK, declared once so the forcing to null is written a
// single time instead of as five loose assignments. THE ORDER OF THE ARRAY MEANS NOTHING: there is
// no precedence among the five, and similarEventDescription goes first only because it is the only
// required one. It does NOT go to src/constants/investigation.constants.ts: only this service
// consumes it, the same way F27, F32, F34, F36, F38 and F39 kept their lists local
const SIMILAR_EVENT_FIELDS = [
    'similarEventDescription',
    'similarEventCount',
    'affectedVaccinated',
    'affectedUnvaccinated',
    'affectedUnknown',
] as const;

// The ten data columns are returned exactly as stored, null included: they are never normalized when
// building the response. Over hadSimilarEvent a null means the form did not collect the answer and a
// 'NO_ANSWER' means it was asked and not answered — different data, and neither becomes the other.
// There is no catalog include to resolve here, exactly as in F38 and F39: hadSimilarEvent is a
// string of the ENUM and resolves against nothing.
// There is no isActive to return — the table does not have that column. deletedAt is the only status
// mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationCommunityResponse = (community: InvestigationCommunity) => {
    const plain = community.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a community record hanging from a retired investigation simply does not come back
const findInvestigationCommunityWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationCommunity.findOne({
        where: { investigationId: id },
        attributes: COMMUNITY_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take a new community
// record. The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationCommunity.investigationNotFound', lang),
            404,
            `INVCOMM_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a sealed
// community record still occupies its investigationId, and only ESAVI-INVCOMM-005C frees it. The
// check does not rely on the collision either: a 23505 would reach the client as a 500 and its
// Postgres message says nothing useful. The message carries the investigationId because otherwise
// the client sees a 409 about a row it did not name
const assertCommunityDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationCommunity.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationCommunity.alreadyExists', lang, { investigationId }),
            409,
            `INVCOMM_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. There is neither `code` nor `name` here, so toConstantCase and toTitleCase do not
// apply — the three free columns keep the casing the investigator typed. None of them is capped: the
// three are text in the DDL, with no declared ceiling
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// Whether a value sent for a field of a CLOSED block is an offence. An absent key and a null key are
// never one: null is the same destination the forcing of 004 reaches on its own. A blank string is
// not one either — normalizeText would store it as null.
// ZERO IS AN OFFENCE, and that is the whole point of not writing this as a truthiness check. An
// `if( body[field] )` would let a `{ hadSimilarEvent: 'NO', similarEventCount: 0 }` through and
// return a 201 lying about what it saved: 0 means "none of them", which is an answer, not an
// absence. Everywhere else in this service — the create write and the diff — zero is a full value
// for the same reason
const isForbiddenValue = (value: unknown): boolean => {
    if( value === undefined || value === null ) return false;
    if( typeof value === 'string' ) return value.trim().length > 0;
    return true;
}

// The resulting state of one field: what travels in the body if the key arrives, and what is stored
// otherwise. On create there is no stored row and the caller passes an empty object, so the resulting
// state is whatever arrives. It is computed BEFORE the diff and independently of it
const resultingValue = <T>(
    data: Partial<CreateInvestigationCommunityInput>,
    stored: Record<string, unknown>,
    field: string
): T | null => {
    const fromBody = ( data as Record<string, unknown> )[field];
    if( fromBody !== undefined ) return ( fromBody ?? null ) as T | null;
    return ( ( stored[field] as T | null | undefined ) ?? null );
}

// THE COMPARISON THAT OPENS THE SIMILAR EVENT BLOCK. Only a resulting 'YES' opens it — the single
// comment of the DDL (esaviapp.sql:1243) says "If answer is 'Yes', then the following fields are
// required" — while 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER' and null close it, the five
// alike. The form logic is direct: if there was no similar event, or it is not known, there is
// nothing to describe and nobody to count.
// It is the usual polarity of the repository, like F34, F36 and F38, and NOT the inverted one of F39
const isSimilarEventBlockOpen = (
    data: Partial<CreateInvestigationCommunityInput>,
    stored: Record<string, unknown>
): boolean => resultingValue<string>(data, stored, 'hadSimilarEvent') === 'YES';

// TWO SUCCESSIVE PASSES OVER THE RESULTING STATE, AND THE ORDER BETWEEN THEM IS FIXED: THE
// PROHIBITION FIRST, THE OBLIGATION AFTER. It is not an implementation detail — it changes the error
// code the client sees. A body with hadSimilarEvent 'NO' and a description gets
// SIMILAR_EVENT_FIELDS_NOT_ALLOWED and NEVER SIMILAR_EVENT_DESCRIPTION_REQUIRED: with the block
// closed the obligation is not even evaluated. The error returned is the one about the problem
// outside, not the one inside. It is the precedence F36 fixed.
//
// FIRST PASS — the block is closed. The five fields are forbidden, and the two operations part ways
// exactly as F34, F36, F38 and F39 fixed. On create every value offends, zero included: there is no
// inherited state to clear, so accepting in silence a datum that will never be stored would return a
// 201 lying about what it saved. On update the fields that do not travel are forced to null by the
// candidates — without asking and without an error — and only the ones that travel WITH A VALUE
// offend. Sending them as null is not an offence on either operation: it is the same destination the
// forcing reaches on its own. The second pass is not reached.
//
// SECOND PASS — the block is open. similarEventDescription is REQUIRED: it is the minimum datum the
// block exists to capture. THE FOUR COUNTERS STAY OPTIONAL — the breakdown may not exist when the
// investigation is opened — and they are not validated against each other either. It is evaluated
// over the RESULTING state and never over the body, so a PUT { notes: 'x' } over a row already
// described does not fail, while a PUT { similarEventDescription: null } over that same row does. To
// empty it, the flag has to be closed in the same request; then the obligation does not apply and
// the five fields are forced to null without error
const assertSimilarEventBlock = (
    data: Partial<CreateInvestigationCommunityInput>,
    stored: Record<string, unknown>,
    op: string,
    lang: string
) => {
    const body = data as Record<string, unknown>;

    // Prohibition
    if( !isSimilarEventBlockOpen(data, stored) ) {
        const offending = SIMILAR_EVENT_FIELDS.some(field => isForbiddenValue(body[field]));
        if( offending ) {
            throw new AppError(
                getMessage('investigationCommunity.similarEventFieldsNotAllowed', lang),
                400,
                `INVCOMM_${ op }_SIMILAR_EVENT_FIELDS_NOT_ALLOWED`
            );
        }
        return;
    }

    // Obligation
    const description = resultingValue<string>(data, stored, 'similarEventDescription');
    if( normalizeText(description) === null ) {
        throw new AppError(
            getMessage('investigationCommunity.similarEventDescriptionRequired', lang),
            400,
            `INVCOMM_${ op }_SIMILAR_EVENT_DESCRIPTION_REQUIRED`
        );
    }
}

// Create Investigation Community Service
// Code: ESAVI-INVCOMM-001
export const createInvestigationCommunityService = async (
    data: CreateInvestigationCommunityInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    // The five steps of §3.5, in this order. The two guards of the create run first, and the rules of
    // the domain before anything is written
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertCommunityDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the block is evaluated against an empty
    // stored: everything that arrives, arrives in the body. The two passes run inside, in their
    // fixed order — prohibition first, obligation after
    assertSimilarEventBlock(data, {}, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVCOMM-001',
        detail: 'Investigation community record created by service'
    };

    // The empty create: the minimum is { investigationId } and the ten data columns come back null.
    // It is the pattern of F13, F14, F29, F32, F34, F36, F38 and F39 — a community record that has
    // not been filled in yet is a real state of the form, not a client error. It keeps working under
    // the obligation because a null flag CLOSES the block.
    // The `?? null` is written without any truthiness check on purpose: over the four counters an
    // `if( data.x )` would be outright destructive, because 0 is a valid value — "none of the
    // affected were vaccinated" — and would be thrown away; over the two coordinates it would throw
    // away a 0 that is a legitimate point on the equator or the prime meridian.
    // deletedAt is born null and there is no isActive to set: the investigation had to be active to
    // get here, so a community record cannot be created already dragged
    await InvestigationCommunity.create({
        investigationId: data.investigationId,
        patientLatitude: data.patientLatitude ?? null,
        patientLongitude: data.patientLongitude ?? null,
        hadSimilarEvent: data.hadSimilarEvent ?? null,
        similarEventDescription: normalizeText(data.similarEventDescription),
        similarEventCount: data.similarEventCount ?? null,
        affectedVaccinated: data.affectedVaccinated ?? null,
        affectedUnvaccinated: data.affectedUnvaccinated ?? null,
        affectedUnknown: data.affectedUnknown ?? null,
        // The two free texts outside the block: they are written whatever hadSimilarEvent says
        otherComments: normalizeText(data.otherComments),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    esaviLog(`ESAVI-INVCOMM-001: Investigation community record created for investigation ${ data.investigationId }`, 'info');

    // Re-read so the response carries the resolved investigation, not just the raw identifier
    const created = await findInvestigationCommunityWithRelations(data.investigationId, true);
    return created ? toInvestigationCommunityResponse(created) : null;
}

// The order of the two listings, as in F29, F32, F34, F36, F38 and F39. This entity has no date of
// the domain that orders it better: its ten columns are where the patient lives and what the
// community reported, not dated facts. createdAt never moves after the insert, unlike updatedAt,
// which would shuffle the list on every save
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the community record itself, and it lands on the primary key — which
// is already indexed, so no index had to be declared for it. caseId does not belong here: it is a
// column of the investigation, so it travels in the where of the include instead — the same include
// that already implements the inherited visibility, so filtering by case costs no extra join.
// There is no filter over any domain column — the similar event flag, the counters, the home
// coordinates — and there will not be one: it opens the door to dashboards, and filtering by the
// coordinates would be the first geospatial query of the repository
const buildListWhere = (filters: InvestigationCommunityListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationCommunityListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The single include of the two listings, and it is single because this entity has no foreign key to
// catalogItem: there is no nullable catalog join here that would have to carry required: false. The
// parent goes required: true, which keeps it an INNER JOIN — what makes the filters above bite and
// what keeps a community record hanging from a retired investigation out of 002A
const listInclude = (filters: InvestigationCommunityListFilters, includeInactive: boolean) => [{
    ...INVESTIGATION_INCLUDE,
    required: true,
    where: buildInvestigationWhere(filters, includeInactive)
}];

// Get Active Investigation Communities Service
// Code: ESAVI-INVCOMM-002A
// The dual listing inherited from F29, F30, F32, F34, F36, F38 and F39: the visibility is not a
// column of its own, it is inherited from investigation.isActive, so the two variants return
// different sets. Without a 002B an ADMIN would have no way of seeing the community record of a
// retired investigation
export const getInvestigationCommunitiesService = async (
    filters: InvestigationCommunityListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationCommunity.findAndCountAll({
        where: buildListWhere(filters),
        attributes: COMMUNITY_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003, and there is no reduced shape — which is the
    // difference with F28. Ten columns per element do not justify two distinct contracts, and the
    // coordinates, which is what F28 took care to keep in its own listing, travel here anyway.
    // A filter whose UUID matches nothing returns 200 with { count: 0, rows: [] } and never a 404 —
    // an empty listing is an answer, not a missing resource
    return { count, rows: rows.map(toInvestigationCommunityResponse) };
}

// Get All Investigation Communities Service - For Admin
// Code: ESAVI-INVCOMM-002B
export const getAllInvestigationCommunitiesService = async (
    filters: InvestigationCommunityListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationCommunity.findAndCountAll({
        where: buildListWhere(filters),
        attributes: COMMUNITY_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationCommunityResponse) };
}
