import { WhereOptions } from 'sequelize';
import { CatalogItem, CatalogType, EsaviCase, Investigation, InvestigationVaccinationContext } from '../models';
import { AppError, buildDifferentialUpdate, esaviLog, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationVaccinationContextInput,
    InvestigationVaccinationContextListFilters
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The investigation travels in every response: it is what governs the visibility of the vaccination
// context, and hiding it would leave the client unable to explain why a record it read yesterday now
// answers 404. Its own sysDetails stays out, like the one of the context.
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

// The two catalog includes, and the reason they carry required: false. Both foreign keys are
// nullable and the empty create is the normal case, so with required: true a context without a
// recorded time slot would DISAPPEAR from the listing — the classic mistake of a nullable FK
// resolved with an include. They resolve two DIFFERENT columns against the same vaccinationMoment
// catalog, which is why the aliases exist and differ
const MOMENT_INCLUDE = {
    model: CatalogItem,
    as: 'moment',
    attributes: ['catalogItemId', 'code', 'name'],
    required: false
};

const MULTIDOSE_MOMENT_INCLUDE = {
    model: CatalogItem,
    as: 'multidoseMoment',
    attributes: ['catalogItemId', 'code', 'name'],
    required: false
};

// sysDetails is trigger metadata and never leaves the service. investigationId does travel: here it
// is the primary key of the row, and also the identifier of its investigation
const VACCINATION_CONTEXT_EXCLUDE = {
    exclude: ['sysDetails']
};

// The code of the catalog both foreign keys resolve against. Local to this service, like the field
// list below: nothing else consumes it, the same way F27, F32, F34 and F35 kept theirs local
const VACCINATION_MOMENT_CATALOG = 'vaccinationMoment';

// The four fields of the cluster block, declared once so the prohibition and the forcing are applied
// by walking the list instead of written four times — four copies diverge on the first correction
// that only reaches three of them. They do NOT go to src/constants/investigation.constants.ts: only
// this service consumes them.
// isCluster is NOT in the list: it is the key that decides, not one of the decided.
// clusterUsedSameVial IS in it, and is both things at once — a field of the block and, in turn, the
// key of clusterSameVialCount through the shared vial rule
const CLUSTER_BLOCK_FIELDS = [
    'clusterIdentificationNumber',
    'clusterAdditionalCaseCount',
    'clusterUsedSameVial',
    'clusterSameVialCount',
] as const;

// The two answerOption columns and the four counters are returned exactly as stored, null included:
// they are never normalized when building the response. A null means the form did not collect the
// answer and a 'NO_ANSWER' means it was asked and not answered — different data, and neither becomes
// the other. The four counters come back as numbers and a 0 is NOT collapsed into null: "nobody else
// was vaccinated from that vial" and "it is not known how many" are different data too.
// moment and multidoseMoment arrive null when their FK is null, and that is normal rather than an
// error — the difference with investigation.status, which never comes back null.
// There is no isActive to return — the table does not have that column. deletedAt is the only status
// mark the row carries, and investigation.isActive is the real source of its visibility
const toInvestigationVaccinationContextResponse = (context: InvestigationVaccinationContext) => {
    const plain = context.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const investigation = plain.investigation as Record<string, unknown> | null | undefined;
    if( investigation ) delete investigation.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The investigation include is mandatory and
// not decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a context hanging from a retired investigation simply does not come back
const findInvestigationVaccinationContextWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationVaccinationContext.findOne({
        where: { investigationId: id },
        attributes: VACCINATION_CONTEXT_EXCLUDE,
        include: [
            {
                ...INVESTIGATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            MOMENT_INCLUDE,
            MULTIDOSE_MOMENT_INCLUDE
        ]
    });
}

// The same read as above without narrowing the attributes of the vaccination context, which is the
// precondition of buildDifferentialUpdate: an instance read with a narrowed `attributes` reads back
// undefined for the columns it left out, and every comparison against undefined would count as a
// change. It still carries the investigation include, so the inherited visibility is checked in the
// same query the update instance comes from
const findInvestigationVaccinationContextRow = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationVaccinationContext.findOne({
        where: { investigationId: id },
        include: [{
            ...INVESTIGATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
    });
}

// The investigation must exist and be active: a retired investigation does not take a new vaccination
// context. The operation code travels in so the AppError keeps it
const assertInvestigationIsValid = async (investigationId: string, op: string, lang: string) => {
    const investigation = await Investigation.findOne({
        where: { investigationId, isActive: true },
        attributes: ['investigationId']
    });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationVaccinationContext.investigationNotFound', lang),
            404,
            `INVVACTX_${ op }_INVESTIGATION_NOT_FOUND`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The lookup does not filter by deletedAt on purpose — a sealed
// context still occupies its investigationId, and only ESAVI-INVVACTX-005C frees it. The check does
// not rely on the collision either: a 23505 would reach the client as a 500 and its Postgres message
// says nothing useful. The message carries the investigationId because otherwise the client sees a
// 409 about a row it did not name
const assertVaccinationContextDoesNotExist = async (investigationId: string, op: string, lang: string) => {
    const existing = await InvestigationVaccinationContext.findByPk(investigationId, { attributes: ['investigationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('investigationVaccinationContext.alreadyExists', lang, { investigationId }),
            409,
            `INVVACTX_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. There is neither `code` nor `name` here, so toConstantCase and toTitleCase do not
// apply — locations and clusterIdentificationNumber keep the casing the investigator typed
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// "Travelling with content" is not the same as "travelling": a field sent as null is the same
// destination the forcing of 004 reaches on its own, so it is never an offence. A blank string is no
// content either — normalizeText would store it as null.
// A 0 IS content, and that is the whole point of the last line: over the four counters a truthiness
// check would throw the zero away, and "nobody else was vaccinated from that vial" would become
// inexpressible
const hasContent = (value: unknown): boolean => {
    if( value === undefined || value === null ) return false;
    if( typeof value === 'string' ) return value.trim().length > 0;
    return true;
}

// The resulting state of one field: what travels in the body if the key arrives, and what is stored
// otherwise. On create there is no stored row and the caller passes an empty object, so the resulting
// state is whatever arrives. It is computed BEFORE the diff and independently of it
const resultingValue = <T>(
    data: Partial<CreateInvestigationVaccinationContextInput>,
    stored: Record<string, unknown>,
    field: string
): T | null => {
    const fromBody = ( data as Record<string, unknown> )[field];
    if( fromBody !== undefined ) return ( fromBody ?? null ) as T | null;
    return ( ( stored[field] as T | null | undefined ) ?? null );
}

// THE COMPARISON THAT DECIDES EVERYTHING, and the one most easily read backwards. isCluster is an
// answerOption of five values and not a boolean, so the "no" has FIVE forms — 'NO', 'UNKNOWN',
// 'NOT_APPLICABLE', 'NO_ANSWER' and null — and the five count the same: the block is CLOSED.
// ONLY 'YES' OPENS IT. A clusterIdentificationNumber recorded under isCluster: 'UNKNOWN' describes
// nothing: if it is not known whether there is a cluster, there is no cluster to identify
const isClusterBlockOpen = (
    data: Partial<CreateInvestigationVaccinationContextInput>,
    stored: Record<string, unknown>
): boolean => resultingValue<string>(data, stored, 'isCluster') === 'YES';

// The rule of the cluster block, evaluated over the RESULTING state and never over the body.
//
// With the block OPEN the four fields are optional and nothing is required of them. There is no
// mandatory side, which is the deliberate difference with F29 and F34: the DDL declares no NOT NULL
// and no conditional CHECK, and an investigator can know the case belongs to a cluster BEFORE that
// cluster has an identifier assigned.
//
// With the block CLOSED the four are forbidden, and the two operations part ways — the caller says
// which one it is. On create it is always a 400: there is no inherited state to clear, so accepting
// in silence a datum that will never be stored would return a 201 lying about what it saved. On
// update it is a 400 only when the field travels WITH CONTENT, because a body that denies the cluster
// and at the same time describes it contradicts itself; when it does not travel, the forcing to null
// further down handles it without an error.
//
// ONE error for the four fields and not four keys: the block is a single concept — "this is not a
// cluster" — spread over four columns, and the message the user needs to read is the same whichever
// field is the one too many. It is the opposite of what F34 decided for its three pairs, and §6 of
// the spec reasons why the asymmetry is right
const assertClusterBlock = (
    data: Partial<CreateInvestigationVaccinationContextInput>,
    stored: Record<string, unknown>,
    op: string,
    lang: string
) => {
    if( isClusterBlockOpen(data, stored) ) return;

    for( const field of CLUSTER_BLOCK_FIELDS ) {
        if( hasContent(( data as Record<string, unknown> )[field]) ) {
            throw new AppError(
                getMessage('investigationVaccinationContext.clusterFieldsNotAllowed', lang),
                400,
                `INVVACTX_${ op }_CLUSTER_FIELDS_NOT_ALLOWED`
            );
        }
    }
}

// The rule of the shared vial — the only business rule the DDL documents, in the comment of
// esaviapp.sql:1144 — and it IS implemented literally as written there, however counter-intuitive it
// reads: it is the 'NO' that requires the counter, not the 'YES'. When NOT every case of the cluster
// shared the vial, the datum that is missing is how many DID, because that is the subset with common
// exposure; when they all shared it, the number is already in clusterAdditionalCaseCount.
//
// It is evaluated ONLY with the block open, and always AFTER the prohibition above: a body with
// isCluster 'NO' and clusterUsedSameVial 'NO' gets the 400 of the prohibition and not this one — the
// closed block wins, and the error returned is the one of the outer problem.
//
// A 0 SATISFIES the obligation: "none of the other cases used the same vial" is an answer, not an
// absence, which is why the check is against null and never against truthiness
const assertSharedVialRule = (
    data: Partial<CreateInvestigationVaccinationContextInput>,
    stored: Record<string, unknown>,
    op: string,
    lang: string
) => {
    if( !isClusterBlockOpen(data, stored) ) return;
    if( resultingValue<string>(data, stored, 'clusterUsedSameVial') !== 'NO' ) return;

    if( resultingValue<number>(data, stored, 'clusterSameVialCount') === null ) {
        throw new AppError(
            getMessage('investigationVaccinationContext.clusterSameVialCountRequired', lang),
            400,
            `INVVACTX_${ op }_CLUSTER_SAME_VIAL_COUNT_REQUIRED`
        );
    }
}

// The double hop of the two catalog foreign keys, with the shape of assertCatalogItemIsValid of
// investigationMedicalHistory.service.ts and the same pattern F35 used for its institution type.
//
// Three causes — it does not exist, it is inactive, it does not belong to the catalog — and a single
// error per column, because none of the three is actionable in a different way. Both run BEFORE the
// diff and independently of it: an inactive item is a 404 even when it matches what is stored.
//
// TWO DISTINCT ERROR CODES and not one shared, even though the catalog is the same one: the client
// has two fields on screen and needs to know which one to reject. Sharing the catalog is a data
// decision; sharing the message would be an interface decision, and the worse of the two
const assertVaccinationMomentIsValid = async (
    catalogItemId: string,
    messageKey: 'momentNotFound' | 'multidoseNotFound',
    errorCode: 'MOMENT_NOT_FOUND' | 'MULTIDOSE_NOT_FOUND',
    op: string,
    lang: string
) => {
    const item = await CatalogItem.findOne({
        where: { catalogItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: VACCINATION_MOMENT_CATALOG },
            attributes: []
        }]
    });
    if( !item ) {
        throw new AppError(
            getMessage(`investigationVaccinationContext.${ messageKey }`, lang),
            404,
            `INVVACTX_${ op }_${ errorCode }`
        );
    }
}

// The two catalog checks of 001 and 004, run together and in this order. Each one runs ONLY when its
// key arrives with a value: an explicit momentItemId: null resolves nothing, because the field is
// being emptied
const assertCatalogItemsAreValid = async (
    data: Partial<CreateInvestigationVaccinationContextInput>,
    op: string,
    lang: string
) => {
    if( hasContent(data.momentItemId) ) {
        await assertVaccinationMomentIsValid(data.momentItemId as string, 'momentNotFound', 'MOMENT_NOT_FOUND', op, lang);
    }
    if( hasContent(data.multidoseItemId) ) {
        await assertVaccinationMomentIsValid(data.multidoseItemId as string, 'multidoseNotFound', 'MULTIDOSE_NOT_FOUND', op, lang);
    }
}

// Create Investigation Vaccination Context Service
// Code: ESAVI-INVVACTX-001
const createInvestigationVaccinationContextService = async (
    data: CreateInvestigationVaccinationContextInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    // The seven steps of §3.5, in this order. The two rules of the domain run before the two catalog
    // checks, and the prohibition of the block runs before the obligation of the vial
    await assertInvestigationIsValid(data.investigationId, '001', lang);
    await assertVaccinationContextDoesNotExist(data.investigationId, '001', lang);

    // On create the body is the whole resulting state, so both rules are evaluated against an empty
    // stored. They run before anything is written
    assertClusterBlock(data, {}, '001', lang);
    assertSharedVialRule(data, {}, '001', lang);

    await assertCatalogItemsAreValid(data, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVVACTX-001',
        detail: 'Investigation vaccination context created by service'
    };

    // The empty create: the minimum is { investigationId } and the eleven data columns come back
    // null. It is the pattern of F13, F14, F29, F32 and F34 — a vaccination context that has not been
    // filled in yet is a real state of the form, not a client error.
    // The `?? null` is written without any truthiness check on purpose: over the four counters an
    // `if( data.x )` would be outright destructive, because 0 is a valid value and would be thrown
    // away; over the two answerOption columns it would work by accident — the five strings of the
    // ENUM are truthy — but would silently discard the null the field is emptied with.
    // deletedAt is born null and there is no isActive to set: the investigation had to be active to
    // get here, so a context cannot be created already dragged
    await InvestigationVaccinationContext.create({
        investigationId: data.investigationId,
        momentItemId: data.momentItemId ?? null,
        multidoseItemId: data.multidoseItemId ?? null,
        vaccinatedPerVialCount: data.vaccinatedPerVialCount ?? null,
        vaccinatedPerBatchCount: data.vaccinatedPerBatchCount ?? null,
        locations: normalizeText(data.locations),
        isCluster: data.isCluster ?? null,
        clusterIdentificationNumber: normalizeText(data.clusterIdentificationNumber),
        clusterAdditionalCaseCount: data.clusterAdditionalCaseCount ?? null,
        clusterUsedSameVial: data.clusterUsedSameVial ?? null,
        clusterSameVialCount: data.clusterSameVialCount ?? null,
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    esaviLog(`ESAVI-INVVACTX-001: Investigation vaccination context created for investigation ${ data.investigationId }`, 'info');

    // Re-read so the response carries the resolved investigation, its status, its case and the two
    // catalog items, not just the raw identifiers
    const created = await findInvestigationVaccinationContextWithRelations(data.investigationId, true);
    return created ? toInvestigationVaccinationContextResponse(created) : null;
}

// The order of the two listings, as in F29, F32 and F34. This entity has no date of the domain that
// orders it better: its eleven columns are the circumstances of a session, not dated facts.
// createdAt never moves after the insert, unlike updatedAt, which would shuffle the list on every
// save
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// Only the filter that lands on the vaccination context itself, and it lands on the primary key —
// which is already indexed, so no index had to be declared for it. caseId does not belong here: it
// is a column of the investigation, so it travels in the where of the include instead — the same
// include that already implements the inherited visibility, so filtering by case costs no extra join
const buildListWhere = (filters: InvestigationVaccinationContextListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( filters.investigationId ) where.investigationId = filters.investigationId;
    return where as WhereOptions;
}

// The where of the investigation include, which carries two things at once: the visibility — the
// isActive that separates 002A from 002B — and the caseId filter when it arrives. Both conditions
// live in the same object, so they accumulate with AND
const buildInvestigationWhere = (filters: InvestigationVaccinationContextListFilters, includeInactive: boolean): WhereOptions => {
    const where: Record<string, unknown> = {};
    if( !includeInactive ) where.isActive = true;
    if( filters.caseId ) where.caseId = filters.caseId;
    return where as WhereOptions;
}

// The three includes shared by the two listings. The parent goes required: true, which keeps it an
// INNER JOIN — what makes the filters above bite and what keeps a context hanging from a retired
// investigation out of 002A.
// THE TWO CATALOG INCLUDES STAY required: false, and that is not a detail: with required: true a
// context without a recorded time slot would disappear from the listing, and with the empty create
// as the normal case that is most of them
const listInclude = (filters: InvestigationVaccinationContextListFilters, includeInactive: boolean) => [
    {
        ...INVESTIGATION_INCLUDE,
        required: true,
        where: buildInvestigationWhere(filters, includeInactive)
    },
    MOMENT_INCLUDE,
    MULTIDOSE_MOMENT_INCLUDE
];

// Get Active Investigation Vaccination Contexts Service
// Code: ESAVI-INVVACTX-002A
// The dual listing inherited from F29, F30, F32 and F34: the visibility is not a column of its own,
// it is inherited from investigation.isActive, so the two variants return different sets. Without a
// 002B an ADMIN would have no way of seeing the context of a retired investigation
const getInvestigationVaccinationContextsService = async (
    filters: InvestigationVaccinationContextListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationVaccinationContext.findAndCountAll({
        where: buildListWhere(filters),
        attributes: VACCINATION_CONTEXT_EXCLUDE,
        include: listInclude(filters, false),
        order: LIST_ORDER,
        limit,
        offset
    });
    // The rows carry the same full shape as the 003: there is no reduced shape. The entity has
    // eleven data columns and two small catalog objects, and trimming them would leave a listing
    // with no content
    return { count, rows: rows.map(toInvestigationVaccinationContextResponse) };
}

// Get All Investigation Vaccination Contexts Service - For Admin
// Code: ESAVI-INVVACTX-002B
const getAllInvestigationVaccinationContextsService = async (
    filters: InvestigationVaccinationContextListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await InvestigationVaccinationContext.findAndCountAll({
        where: buildListWhere(filters),
        attributes: VACCINATION_CONTEXT_EXCLUDE,
        include: listInclude(filters, true),
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toInvestigationVaccinationContextResponse) };
}

// Get Investigation Vaccination Context By ID Service
// Code: ESAVI-INVVACTX-003
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation and no separate operation is needed for it.
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// investigation must be active unless canViewInactive says otherwise — today SUPERADMIN. Both
// failures answer the same 404 without distinguishing, because telling them apart would confirm to a
// USER that a context exists under an investigation it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// investigation, which is what makes it possible to consult it before purging it
const getInvestigationVaccinationContextByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const context = await findInvestigationVaccinationContextWithRelations(id, includeInactive);
    if( !context ) {
        throw new AppError(getMessage('investigationVaccinationContext.notFound', lang), 404, 'INVVACTX_003_NOT_FOUND');
    }
    return toInvestigationVaccinationContextResponse(context);
}

// Get Investigation Vaccination Context By Case ID Service
// Code: ESAVI-INVVACTX-006
// The real query of the domain: the client holds the caseId, not the investigationId. It returns the
// record itself and not { count, rows } — the chain case -> investigation -> vaccination context is
// one to one on BOTH hops, imposed by UQ_investigation_case on the first and by the shared primary
// key on the second, so wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// THREE DISTINCT 404, and the difference matters to the client: "that case does not exist", "it has
// no visible investigation" and "its investigation has no vaccination context yet" are three
// different things to show on screen, and only the third one is fixed by creating a context
const getInvestigationVaccinationContextByCaseIdService = async (caseId: string, lang: string, includeInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('investigationVaccinationContext.caseNotFound', lang), 404, 'INVVACTX_006_CASE_NOT_FOUND');
    }

    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    const investigation = await Investigation.findOne({ where, attributes: ['investigationId'] });
    if( !investigation ) {
        throw new AppError(
            getMessage('investigationVaccinationContext.investigationNotFound', lang),
            404,
            'INVVACTX_006_INVESTIGATION_NOT_FOUND'
        );
    }

    const context = await findInvestigationVaccinationContextWithRelations(investigation.investigationId, includeInactive);
    if( !context ) {
        throw new AppError(getMessage('investigationVaccinationContext.notFound', lang), 404, 'INVVACTX_006_NOT_FOUND');
    }
    return toInvestigationVaccinationContextResponse(context);
}

// Update Investigation Vaccination Context Service
// Code: ESAVI-INVVACTX-004
// The main operation of the entity: the row is opened empty and completed over time, so this is
// where the form is actually filled in. investigationId is ignored whether or not it arrives in the
// body — it is the primary key of the row and the foreign key to its investigation at the same time,
// and moving it would take one session's circumstances to another file. It does not return 400
// either, which is what keeps working the PUT that resends the response of its own GET
const updateInvestigationVaccinationContextService = async (
    id: string,
    data: Partial<CreateInvestigationVaccinationContextInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const context = await findInvestigationVaccinationContextRow(id, canViewInactive);
    if( !context ) {
        throw new AppError(getMessage('investigationVaccinationContext.notFound', lang), 404, 'INVVACTX_004_NOT_FOUND');
    }

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending whole
    // the record just read with a GET is the normal use of a form, and writing it back would fill
    // appDetails with entries that record no change and hide the real ones among them.
    // The row is read WITHOUT narrowed attributes, which is the precondition of the helper: with
    // trimmed attributes an absent field reads back undefined and every comparison against it would
    // count as "it changed"
    const stored = context.get({ plain: true }) as Record<string, unknown>;

    // The two rules of the domain, over the RESULTING state: what travels merged with what is
    // stored. It is the service and not the validator who emits them, because express-validator
    // cannot see the stored row. They run BEFORE the diff and independently of it, and the
    // prohibition of the block runs before the obligation of the vial
    assertClusterBlock(data, stored, '004', lang);
    assertSharedVialRule(data, stored, '004', lang);

    // ALSO before the diff: an inactive item is a 404 even when it matches what is stored
    await assertCatalogItemsAreValid(data, '004', lang);

    // The resulting state of the block key, recomputed here to drive the four conditional
    // derivatives below. The comparison is `=== 'YES'` for the same reason as in the rule: over an
    // answerOption the "no" has five forms and the five close the block
    const blockOpen = isClusterBlockOpen(data, stored);

    // No candidate is placed under an `if( data.x )`. Over the four counters that would be outright
    // destructive: 0 is a valid value and a truthiness check would throw it away, leaving the field
    // with no way of storing the zero. Over the two answerOption columns it would work by accident
    // — the five strings of the ENUM are truthy — but would silently discard the null the field is
    // emptied with
    const candidates: Record<string, unknown> = {
        // investigationId does NOT enter: immutable, ignored in silence and with no 400

        // The two catalog foreign keys, plain nullables. They govern nothing
        momentItemId: data.momentItemId !== undefined ? ( data.momentItemId ?? null ) : undefined,
        multidoseItemId: data.multidoseItemId !== undefined ? ( data.multidoseItemId ?? null ) : undefined,

        // The two counters outside the block. 0 is a valid value for both
        vaccinatedPerVialCount: data.vaccinatedPerVialCount !== undefined
            ? ( data.vaccinatedPerVialCount ?? null ) : undefined,
        vaccinatedPerBatchCount: data.vaccinatedPerBatchCount !== undefined
            ? ( data.vaccinatedPerBatchCount ?? null ) : undefined,

        // Normalized before comparing, or a body differing only in surrounding blanks would count
        // as a change
        locations: data.locations !== undefined ? normalizeText(data.locations) : undefined,

        // THE KEY OF THE BLOCK, and it is NOT part of it: it is the field that decides, not one of
        // the decided. Entering as a conditional derivative would make it annul itself. The
        // `?? null` is what keeps null and 'NO_ANSWER' apart — the first means the form did not
        // collect the answer, the second that it was asked and not answered
        isCluster: data.isCluster !== undefined ? ( data.isCluster ?? null ) : undefined,

        // THE FOUR CONDITIONAL DERIVATIVES. With the block closed the null enters candidates ALWAYS,
        // with no presence check, and it is buildDifferentialUpdate who decides whether it differs:
        // closing a block that was already closed writes nothing and does not grow appDetails. A
        // cleanup with a second UPDATE after the diff would write even when nothing changed.
        // clusterUsedSameVial is a derivative AND the key of clusterSameVialCount at the same time
        clusterIdentificationNumber: blockOpen
            ? ( data.clusterIdentificationNumber !== undefined ? normalizeText(data.clusterIdentificationNumber) : undefined )
            : null,
        clusterAdditionalCaseCount: blockOpen
            ? ( data.clusterAdditionalCaseCount !== undefined ? ( data.clusterAdditionalCaseCount ?? null ) : undefined )
            : null,
        clusterUsedSameVial: blockOpen
            ? ( data.clusterUsedSameVial !== undefined ? ( data.clusterUsedSameVial ?? null ) : undefined )
            : null,
        clusterSameVialCount: blockOpen
            ? ( data.clusterSameVialCount !== undefined ? ( data.clusterSameVialCount ?? null ) : undefined )
            : null,

        notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
    };

    const objectToUpdate = buildDifferentialUpdate(stored, candidates);

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_investigationVaccinationContext_setSysDetails fires on every
    // write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findInvestigationVaccinationContextWithRelations(id, true);
        return unchanged ? toInvestigationVaccinationContextResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the generic
    // loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(context.appDetails) ? context.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVVACTX-004',
        detail: 'Investigation vaccination context updated by service'
    };
    await context.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updated = await findInvestigationVaccinationContextWithRelations(id, true);
    return updated ? toInvestigationVaccinationContextResponse(updated) : null;
}

export {
    createInvestigationVaccinationContextService,
    getAllInvestigationVaccinationContextsService,
    getInvestigationVaccinationContextByCaseIdService,
    getInvestigationVaccinationContextByIdService,
    getInvestigationVaccinationContextsService,
    updateInvestigationVaccinationContextService
};
