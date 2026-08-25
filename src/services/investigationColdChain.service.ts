import { WhereOptions } from 'sequelize';
import { Investigation, InvestigationColdChain } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationColdChainInput,
    InvestigationColdChainListFilters
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The investigation travels in every response, narrowed to three fields: what the client needs is to
// know which case the row hangs from and whether its parent is alive. Returning the whole
// investigation would duplicate the payload of ESAVI-INVESTGN-003.
// It is also what governs the visibility of the cold chain, so hiding it would leave the client
// unable to explain why a record it read yesterday now answers 404
const INVESTIGATION_INCLUDE = {
    model: Investigation,
    as: 'investigation',
    attributes: ['investigationId', 'caseId', 'isActive']
};

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here it
// is the primary key of the row, and also the identifier of its investigation
const COLD_CHAIN_EXCLUDE = {
    exclude: ['sysDetails']
};

// THE TWO SIDES OF THE MUTUAL EXCLUSION, declared once so the precedence lives in a single place
// instead of being spread over the code. THE ORDER OF THE ARRAY IS THE PRECEDENCE: the first one
// wins the inherited tie. It does NOT go to src/constants/investigation.constants.ts: only this
// service consumes it, the same way F27, F32, F34 and F36 kept their lists local.
// There is no equivalent constant for the storage block: it governs a SINGLE field,
// storageRangeDeviation, and a one-element list would be noise
const TRANSPORT_CONTAINER_FIELDS = [
    'transportUsedThermos',
    'transportUsedColdPack',
] as const;

// The ten answer columns are returned exactly as stored, null included: they are never normalized
// when building the response. Over the eight answerOption columns a null means the form did not
// collect the answer and a 'NO_ANSWER' means it was asked and not answered — different data, and
// neither becomes the other. Over the two booleans a false means "it was not monitored" and a null
// means "it is not known", which is the same distinction with three states instead of five.
// There is no catalog include to resolve here, which is the visible difference with F36: the ten
// answers are literal values and resolve against nothing.
// There is no isActive to return — the table does not have that column. deletedAt is the only status
// mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationColdChainResponse = (coldChain: InvestigationColdChain) => {
    const plain = coldChain.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a cold chain hanging from a retired investigation simply does not come back
const findInvestigationColdChainWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationColdChain.findOne({
        where: { investigationId: id },
        attributes: COLD_CHAIN_EXCLUDE,
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take a new cold
// chain. The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationColdChain.investigationNotFound', lang),
            404,
            `INVCOLD_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a sealed
// cold chain still occupies its investigationId, and only ESAVI-INVCOLD-005C frees it. The check does
// not rely on the collision either: a 23505 would reach the client as a 500 and its Postgres message
// says nothing useful. The message carries the investigationId because otherwise the client sees a
// 409 about a row it did not name
const assertColdChainDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationColdChain.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationColdChain.alreadyExists', lang, { investigationId }),
            409,
            `INVCOLD_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. There is neither `code` nor `name` here, so toConstantCase and toTitleCase do not
// apply — the four free columns keep the casing the investigator typed
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// "Travelling with content" is not the same as "travelling": a field sent as null is the same
// destination the forcing of 004 reaches on its own, so it is never an offence. A blank string is no
// content either — normalizeText would store it as null.
// FALSE IS CONTENT, and that is the whole point of the last line: over storageRangeDeviation a
// truthiness check would throw the false away, and "it was monitored and there was no deviation" —
// the most frequent finding of the form — would become inexpressible
const hasContent = (value: unknown): boolean => {
    if( value === undefined || value === null ) return false;
    if( typeof value === 'string' ) return value.trim().length > 0;
    return true;
}

// Whether the key travelled in the body, which is NOT the same as whether it carries a value: a
// field arriving as null DOES travel — it is saying "erase it", an intention of the client like any
// other. This is what separates a conflict from a relay in the transport rule, and it is the only
// rule of the repository that needs to know it
const travels = (data: Partial<CreateInvestigationColdChainInput>, field: string): boolean =>
    ( data as Record<string, unknown> )[field] !== undefined;

// The resulting state of one field: what travels in the body if the key arrives, and what is stored
// otherwise. On create there is no stored row and the caller passes an empty object, so the resulting
// state is whatever arrives. It is computed BEFORE the diff and independently of it
const resultingValue = <T>(
    data: Partial<CreateInvestigationColdChainInput>,
    stored: Record<string, unknown>,
    field: string
): T | null => {
    const fromBody = ( data as Record<string, unknown> )[field];
    if( fromBody !== undefined ) return ( fromBody ?? null ) as T | null;
    return ( ( stored[field] as T | null | undefined ) ?? null );
}

// THE COMPARISON THAT OPENS THE STORAGE BLOCK. storageTemperatureMonitored is a boolean and not an
// answerOption, so the "no" has TWO forms — false and null — and the two close the block alike:
// false is "it was not monitored" and null is "it is not known", and under neither of them is there
// a measurement to derive a deviation from. ONLY true OPENS IT
const isStorageBlockOpen = (
    data: Partial<CreateInvestigationColdChainInput>,
    stored: Record<string, unknown>
): boolean => resultingValue<boolean>(data, stored, 'storageTemperatureMonitored') === true;

// The rule of the storage block, evaluated over the RESULTING state and never over the body.
//
// With the block OPEN storageRangeDeviation is optional and is stored exactly as it arrives, false
// included. There is no mandatory side.
//
// With the block CLOSED it is forbidden, and the two operations part ways — the caller says which
// one it is. On create it is always a 400: there is no inherited state to clear, so accepting in
// silence a datum that will never be stored would return a 201 lying about what it saved. On update
// it is a 400 only when the field travels WITH CONTENT, because a body that denies the monitoring
// and at the same time reports a deviation contradicts itself; when it does not travel, the forcing
// to null of 004 handles it without an error.
//
// The other six storage columns are NOT in the block: a procedure, the four fridge findings and the
// free text are observed without a thermometer, so they are never touched by this
const assertStorageBlock = (
    data: Partial<CreateInvestigationColdChainInput>,
    stored: Record<string, unknown>,
    op: string,
    lang: string
) => {
    if( isStorageBlockOpen(data, stored) ) return;

    if( hasContent(data.storageRangeDeviation) ) {
        throw new AppError(
            getMessage('investigationColdChain.rangeDeviationNotAllowed', lang),
            400,
            `INVCOLD_${ op }_RANGE_DEVIATION_NOT_ALLOWED`
        );
    }
}

// THE CONFLICT OF THE MUTUAL EXCLUSION, and the only one of its three cases that is an error.
// transportUsedThermos and transportUsedColdPack describe the same fact — in which container the
// vaccine travelled — and cannot both result 'YES'. This is the case where BOTH KEYS TRAVEL in the
// body and both are 'YES': the client is asserting two incompatible things in the same request, and
// no precedence can guess which one it meant. ON CREATE IT IS THE ONLY POSSIBLE CASE, because there
// is no stored state.
//
// The other two cases — relay and inherited tie — are NOT errors and are resolved by the forcing of
// 004: they do not belong here.
//
// The three container columns — transportSetInThermos, transportReturnedInThermos and
// transportTypeThermo — are outside all of this. They apply to whichever container was used, thermos
// OR cold pack, so they are never forbidden and never forced by either flag
const assertTransportContainerConflict = (
    data: Partial<CreateInvestigationColdChainInput>,
    op: string,
    lang: string
) => {
    const bothTravel = TRANSPORT_CONTAINER_FIELDS.every(field => travels(data, field));
    if( !bothTravel ) return;

    const bothAreYes = TRANSPORT_CONTAINER_FIELDS.every(
        field => ( data as Record<string, unknown> )[field] === 'YES'
    );
    if( !bothAreYes ) return;

    throw new AppError(
        getMessage('investigationColdChain.transportContainerConflict', lang),
        400,
        `INVCOLD_${ op }_TRANSPORT_CONTAINER_CONFLICT`
    );
}

// Create Investigation Cold Chain Service
// Code: ESAVI-INVCOLD-001
export const createInvestigationColdChainService = async (
    data: CreateInvestigationColdChainInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    // The six steps of §3.5, in this order. The two guards of the create run first, and the two
    // rules of the domain before anything is written
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertColdChainDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so the storage rule is evaluated against an
    // empty stored. The transport rule needs no stored either: with nothing saved, only the conflict
    // can happen
    assertStorageBlock(data, {}, '001', lang);
    assertTransportContainerConflict(data, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVCOLD-001',
        detail: 'Investigation cold chain created by service'
    };

    // The empty create: the minimum is { investigationId } and the fifteen data columns come back
    // null. It is the pattern of F13, F14, F29, F32, F34 and F36 — a cold chain that has not been
    // filled in yet is a real state of the form, not a client error.
    // The `?? null` is written without any truthiness check on purpose: over the two booleans an
    // `if( data.x )` would be outright destructive, because false is a valid value and would be
    // thrown away; over the eight answerOption columns it would work by accident — the five strings
    // of the ENUM are truthy — but would silently discard the null the field is emptied with.
    // deletedAt is born null and there is no isActive to set: the investigation had to be active to
    // get here, so a cold chain cannot be created already dragged
    await InvestigationColdChain.create({
        investigationId: data.investigationId,
        storageTemperatureMonitored: data.storageTemperatureMonitored ?? null,
        storageRangeDeviation: data.storageRangeDeviation ?? null,
        storageProcedureFollowed: data.storageProcedureFollowed ?? null,
        storageOtherObjectPresent: data.storageOtherObjectPresent ?? null,
        storagePartiallyReconstitutedVaccine: data.storagePartiallyReconstitutedVaccine ?? null,
        storageVaccineNotUsable: data.storageVaccineNotUsable ?? null,
        storageDiluentNotUsable: data.storageDiluentNotUsable ?? null,
        storageKeyFindings: normalizeText(data.storageKeyFindings),
        transportUsedThermos: data.transportUsedThermos ?? null,
        transportSetInThermos: data.transportSetInThermos ?? null,
        transportReturnedInThermos: data.transportReturnedInThermos ?? null,
        transportUsedColdPack: data.transportUsedColdPack ?? null,
        transportTypeThermo: normalizeText(data.transportTypeThermo),
        transportKeyFindings: normalizeText(data.transportKeyFindings),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    esaviLog(`ESAVI-INVCOLD-001: Investigation cold chain created for investigation ${ data.investigationId }`, 'info');

    // Re-read so the response carries the resolved investigation, not just the raw identifier
    const created = await findInvestigationColdChainWithRelations(data.investigationId, true);
    return created ? toInvestigationColdChainResponse(created) : null;
}

// The order of the two listings, as in F29, F32, F34 and F36. This entity has no date of the domain
// that orders it better: its fifteen columns are how a product was kept, not dated facts. createdAt
// never moves after the insert, unlike updatedAt, which would shuffle the list on every save
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the cold chain itself, and it lands on the primary key — which is
// already indexed, so no index had to be declared for it. caseId does not belong here: it is a column
// of the investigation, so it travels in the where of the include instead — the same include that
// already implements the inherited visibility, so filtering by case costs no extra join.
// There is no filter over any domain column, and there will not be one: it would be the first of the
// repository and opens the door to dashboards
const buildListWhere = (filters: InvestigationColdChainListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationColdChainListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The single include of the two listings, and it is single because this entity has no foreign key to
// catalogItem: there is no nullable catalog join here that would have to carry required: false, which
// is the difference with F36. The parent goes required: true, which keeps it an INNER JOIN — what
// makes the filters above bite and what keeps a cold chain hanging from a retired investigation out
// of 002A
const listInclude = (filters: InvestigationColdChainListFilters, includeInactive: boolean) => [{
    ...INVESTIGATION_INCLUDE,
    required: true,
    where: buildInvestigationWhere(filters, includeInactive)
}];

// Get Active Investigation Cold Chains Service
// Code: ESAVI-INVCOLD-002A
// The dual listing inherited from F29, F30, F32, F34 and F36: the visibility is not a column of its
// own, it is inherited from investigation.isActive, so the two variants return different sets.
// Without a 002B an ADMIN would have no way of seeing the cold chain of a retired investigation
export const getInvestigationColdChainsService = async (
    filters: InvestigationColdChainListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationColdChain.findAndCountAll({
        where: buildListWhere(filters),
        attributes: COLD_CHAIN_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003: there is no reduced shape. A filter whose UUID
    // matches nothing returns 200 with { count: 0, rows: [] } and never a 404 — an empty listing is
    // an answer, not a missing resource
    return { count, rows: rows.map(toInvestigationColdChainResponse) };
}

// Get All Investigation Cold Chains Service - For Admin
// Code: ESAVI-INVCOLD-002B
export const getAllInvestigationColdChainsService = async (
    filters: InvestigationColdChainListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationColdChain.findAndCountAll({
        where: buildListWhere(filters),
        attributes: COLD_CHAIN_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationColdChainResponse) };
}
