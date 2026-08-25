import { CatalogItem, CatalogType, EsaviCase, Investigation, InvestigationVaccinationContext } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateInvestigationVaccinationContextInput
} from '../types';

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

export {
    createInvestigationVaccinationContextService
};
