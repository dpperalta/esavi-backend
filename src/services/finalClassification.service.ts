import { WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EsaviCase, FinalClassification } from '../models';
import { AppError, buildDifferentialUpdate, getMessage } from '../helpers';
import {
    AppDetails,
    AuthUser,
    CreateFinalClassificationInput,
    FinalClassificationListFilters
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { advanceCaseWorkflowStageService } from './caseWorkflow.service';
import { purgeEntityService } from './common/entityPurge.service';

// Code of the catalogType that groups the three precedence values, seeded with three items of
// code and value 1, 2 and 3. Without this check any active catalogItem of the system would enter
// as a precedence and the stored verdict would mean nothing
const IMPORTANCE_CATALOG_CODE = 'finalClassificationImportance';

// The three slots of the precedence order. They are not three independent fields: the classifier
// does not mark three separate things, it ranks blocks A, B and C by strength of evidence
const IMPORTANCE_FIELDS = [
    'importanceAItemId',
    'importanceBItemId',
    'importanceCItemId'
] as const;

// The ten columns that dIsUnclassifiable closes. Ten and not eleven: the flag itself is NOT in
// the list — it is the flag, not a forbidden field, and putting it inside would make marking it
// forbid itself, leaving block D unreachable
const UNCLASSIFIABLE_FORBIDDEN_FIELDS = [
    ...IMPORTANCE_FIELDS,
    'aIsRelatedToVaccineProduct',
    'aIsRelatedToQualityDeviation',
    'aIsRelatedToProgrammaticError',
    'aIsRelatedToStress',
    'bIsConsistentTemporalRelation',
    'bHasDeterminantFactor',
    'cHasCoincidentCause'
] as const;

// The eleven columns the two coherence rules look at: the ten forbidden ones plus the flag
const COHERENCE_FIELDS = [...UNCLASSIFIABLE_FORBIDDEN_FIELDS, 'dIsUnclassifiable'] as const;

type FinalClassificationInput = Partial<CreateFinalClassificationInput>;
type ResultingState = Record<string, unknown>;

// The block each importance slot ranks. It travels into the message so the client is not left
// guessing which of the three the server rejected
const IMPORTANCE_BLOCK: Record<string, string> = {
    importanceAItemId: 'A',
    importanceBItemId: 'B',
    importanceCItemId: 'C'
};

const CASE_INCLUDE = {
    model: EsaviCase,
    as: 'case',
    // Narrowed to three fields: what the client needs to know which case the verdict hangs from
    // and whether that case is still alive. Returning the whole case would duplicate ESAVI-CASE-003
    attributes: ['caseId', 'caseCode', 'isActive']
};

// required: false in all three, or a final classification that only ranked block A would vanish
// from both listings and from the 003 — with no error and no trace
const importanceInclude = (alias: string) => ({
    model: CatalogItem,
    as: alias,
    attributes: ['catalogItemId', 'code', 'name', 'value'],
    required: false
});

const DETAIL_INCLUDE = [
    CASE_INCLUDE,
    importanceInclude('importanceA'),
    importanceInclude('importanceB'),
    importanceInclude('importanceC')
];

// sysDetails is trigger metadata and never leaves the service. The four raw foreign keys go with
// it: the response carries the resolved case, importanceA, importanceB and importanceC instead
const DETAIL_EXCLUDE = {
    exclude: ['sysDetails', 'caseId', ...IMPORTANCE_FIELDS]
};

// Newest first, the same order as classification and esaviCase
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// The eight booleans are returned exactly as stored, null included: they are never normalized to
// false when building the response. A verdict that was never evaluated is not a verdict of "no"
const toFinalClassificationResponse = (finalClassification: FinalClassification) => {
    const plain = finalClassification.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.caseId;
    for( const field of IMPORTANCE_FIELDS ) {
        delete plain[field];
    }
    return plain;
}

// The read the write operations share to build their response
const findFinalClassificationWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive
        ? { finalClassificationId: id }
        : { finalClassificationId: id, isActive: true };
    return await FinalClassification.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: DETAIL_INCLUDE
    });
}

// The same read as above, entered through the foreign key instead of the primary one. It needs no
// LIMIT beyond findOne because UQ_finalClassification_case guarantees there is at most one row
const findFinalClassificationByCaseId = async (caseId: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    return await FinalClassification.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: DETAIL_INCLUDE
    });
}

// The case must exist and be active: FK_finalClassification_case declares ON DELETE CASCADE, but
// TRG_esaviCase_preventPhysicalDelete forbids every physical delete of esaviCase, so that cascade
// never fires and nothing in the DDL stops a final classification from pointing at a retired case
const assertCaseIsValid = async (caseId: string, op: string, lang: string) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('finalClassification.caseNotFound', lang), 404, `FINCLASS_${ op }_CASE_NOT_FOUND`);
    }
}

// UQ_finalClassification_case makes the relation one to one, and it does not filter by isActive:
// a caseId taken by a deactivated final classification is still taken. Checking only the active
// ones would let through an INSERT that Postgres rejects with 23505, turning a 409 into a 500
const assertCaseIsNotFinalClassified = async (caseId: string, op: string, lang: string) => {
    const existing = await FinalClassification.findOne({
        where: { caseId },
        attributes: ['finalClassificationId']
    });
    if( existing ) {
        throw new AppError(
            getMessage('finalClassification.caseAlreadyFinalClassified', lang, { caseId }),
            409,
            `FINCLASS_${ op }_CASE_ALREADY_FINAL_CLASSIFIED`
        );
    }
}

// The resulting state of the eleven coherence columns: what travels merged with what is stored.
// Both rules look at this and not at the body — on create there is no stored row, so a key that
// does not arrive resolves to null. A key that arrives null erases the stored value, because
// null is a state of its own and not the lack of an answer
const resolveResultingState = (data: FinalClassificationInput, stored?: Record<string, unknown>): ResultingState => {
    const resulting: ResultingState = {};
    for( const field of COHERENCE_FIELDS ) {
        resulting[field] = data[field] !== undefined
            ? ( data[field] ?? null )
            : ( stored ? stored[field] ?? null : null );
    }
    return resulting;
}

// Block D closes; it does not open. F34, F36, F38, F39 and F40 all have a flag that OPENS a block
// of allowed fields — this one CLOSES it, and reading it by analogy gives the opposite result.
// Only a resulting true closes: false and null leave the ten columns completely free.
//
// A field arriving false is a VALUE and not an absence — `aIsRelatedToStress: false` states that
// block A was evaluated and ruled out, while D states nothing could be evaluated at all — so the
// check is `!== undefined && !== null` and never `if( data.field )`. Sending them explicitly null
// is not an error: it is the same destination the forcing of the 004 reaches on its own
const assertUnclassifiableFieldsNotSent = (
    data: FinalClassificationInput,
    resulting: ResultingState,
    op: string,
    lang: string
) => {
    if( resulting.dIsUnclassifiable !== true ) {
        return;
    }
    for( const field of UNCLASSIFIABLE_FORBIDDEN_FIELDS ) {
        if( data[field] !== undefined && data[field] !== null ) {
            throw new AppError(
                getMessage('finalClassification.unclassifiableFieldsNotAllowed', lang),
                400,
                `FINCLASS_${ op }_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED`
            );
        }
    }
}

// The precedence rule: the three importance slots cannot repeat a value between them. Only the
// ones holding a value are compared — the nulls do not take part, so A=1, B=2, C=null is valid
// and so is a row with the three of them null. The comparison is by catalogItemId and not by code
// or value: the rule is "do not repeat a slot", not "do not repeat a number".
//
// This is the first uniqueness rule of the repository between columns of the same row, and no
// UNIQUE of Postgres can express it
const assertImportanceIsNotDuplicated = (resulting: ResultingState, op: string, lang: string) => {
    const informed = IMPORTANCE_FIELDS
        .map(field => resulting[field])
        .filter(value => value !== null && value !== undefined);

    if( new Set(informed).size !== informed.length ) {
        throw new AppError(
            getMessage('finalClassification.importanceDuplicated', lang),
            400,
            `FINCLASS_${ op }_IMPORTANCE_DUPLICATED`
        );
    }
}

// Each informed importance is validated like any other foreign key: it exists, it is active and
// it belongs to the finalClassificationImportance catalogType. There is no importanceCatalogMissing
// key, unlike F09: this service never looks items up by code, it receives a UUID and checks which
// type it belongs to — so an unseeded catalog and an invalid UUID are the same case from inside
const assertImportanceIsValid = async (itemId: string, block: string, op: string, lang: string) => {
    const importanceItem = await CatalogItem.findOne({
        where: { catalogItemId: itemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: IMPORTANCE_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !importanceItem ) {
        throw new AppError(
            getMessage('finalClassification.importanceNotFound', lang, { block }),
            404,
            `FINCLASS_${ op }_IMPORTANCE_NOT_FOUND`
        );
    }
}

// Runs last, after the forcing to null of the 004: there is no point resolving three UUID against
// catalogItem that the previous step has just discarded. It saves a query and a 404 that would
// never be emitted for a field that is not going to be stored
const assertImportancesAreValid = async (resulting: ResultingState, op: string, lang: string) => {
    for( const field of IMPORTANCE_FIELDS ) {
        const itemId = resulting[field];
        if( itemId ) {
            await assertImportanceIsValid(itemId as string, IMPORTANCE_BLOCK[field], op, lang);
        }
    }
}

// Create Final Classification Service
// Code: ESAVI-FINCLASS-001
// The order of the four checks is fixed: existence, the prohibition of D, the precedence rule and
// the three catalog foreign keys. The prohibition runs BEFORE the precedence rule — the error
// returned is the one of the outer problem, not the one of the inner problem — so a body with
// dIsUnclassifiable true and two repeated importances gets UNCLASSIFIABLE_FIELDS_NOT_ALLOWED and
// never IMPORTANCE_DUPLICATED
const createFinalClassificationService = async (
    data: CreateFinalClassificationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertCaseIsValid(data.caseId, '001', lang);
    await assertCaseIsNotFinalClassified(data.caseId, '001', lang);

    // On create there is no stored row: the resulting state is whatever arrives in the body
    const resulting = resolveResultingState(data);

    // Strict variant: on create there is no inherited state to clean, so accepting in silence a
    // value that will never be stored would answer 201 while lying about what was saved
    assertUnclassifiableFieldsNotSent(data, resulting, '001', lang);
    assertImportanceIsNotDuplicated(resulting, '001', lang);
    await assertImportancesAreValid(resulting, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-FINCLASS-001',
        detail: 'Final classification created by service'
    };
    // Two dependent writes since SPEC F44 — the final classification row and the stamp
    // ESAVI-CASEFLOW-012 puts on the workflow — so this service is transactional. A case whose
    // workflow cannot be advanced does not get a final classification either
    const transaction = await sequelize.transaction();
    let newFinalClassification: FinalClassification;
    try {
        // The eight booleans keep the tri-state: what does not arrive is stored null, never false.
        // Only notes is normalized — this entity has neither `code` nor `name`. The minimum create
        // is { caseId } and it answers 201 with the twelve data columns null: the row opens as a
        // pending verdict and is completed by PUT
        newFinalClassification = await FinalClassification.create({
            caseId: data.caseId,
            importanceAItemId: data.importanceAItemId ?? null,
            importanceBItemId: data.importanceBItemId ?? null,
            importanceCItemId: data.importanceCItemId ?? null,
            aIsRelatedToVaccineProduct: data.aIsRelatedToVaccineProduct ?? null,
            aIsRelatedToQualityDeviation: data.aIsRelatedToQualityDeviation ?? null,
            aIsRelatedToProgrammaticError: data.aIsRelatedToProgrammaticError ?? null,
            aIsRelatedToStress: data.aIsRelatedToStress ?? null,
            bIsConsistentTemporalRelation: data.bIsConsistentTemporalRelation ?? null,
            bHasDeterminantFactor: data.bHasDeterminantFactor ?? null,
            cHasCoincidentCause: data.cHasCoincidentCause ?? null,
            dIsUnclassifiable: data.dIsUnclassifiable ?? null,
            notes: data.notes ? data.notes.trim() : null,
            appDetails: [newEntry]
        }, { transaction });

        // ESAVI-CASEFLOW-012: seals finalClassificationStartedAt, closes the investigation stage
        // if it was left open and moves the file to IN_FINAL_CLASSIFICATION
        await advanceCaseWorkflowStageService(data.caseId, 'FINAL_CLASSIFICATION', authUser, lang, transaction);

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved case and the three importances, not their ids
    const createdFinalClassification = await findFinalClassificationWithRelations(
        newFinalClassification.finalClassificationId,
        true
    );
    return createdFinalClassification ? toFinalClassificationResponse(createdFinalClassification) : null;
}

// The single filter of the listing, by equality. A filter pointing at a caseId that does not
// exist yields an empty page, never a 404: searching for something absent is an empty search, not
// a missing resource. There is deliberately no filter by any domain field — not by causality
// block, not by dIsUnclassifiable, not by importance
const buildListWhere = (filters: FinalClassificationListFilters = {}): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.caseId ) where.caseId = filters.caseId;

    return where as WhereOptions;
}

// Get Active Final Classifications Service
// Code: ESAVI-FINCLASS-002A
// The where filters by the isActive of the row ITSELF, not by the one of its case: this entity
// has a state of its own, unlike the ten satellites of investigation. With the cascade of
// ESAVI-CASE-005A the final classification of a retired case is already inactive, so the result
// is the same without conditioning the include with a required: true.
//
// Every row travels in the same complete shape as the 003: twelve columns and four includes per
// element do not justify two different contracts, so there is no reduced listing shape
const getFinalClassificationsService = async (
    filters: FinalClassificationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await FinalClassification.findAndCountAll({
        where: { ...buildListWhere(filters), isActive: true },
        attributes: DETAIL_EXCLUDE,
        include: DETAIL_INCLUDE,
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get All Final Classifications Service - For Admin
// Code: ESAVI-FINCLASS-002B
const getAllFinalClassificationsService = async (
    filters: FinalClassificationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await FinalClassification.findAndCountAll({
        where: buildListWhere(filters),
        attributes: DETAIL_EXCLUDE,
        include: DETAIL_INCLUDE,
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get Final Classification By ID Service
// Code: ESAVI-FINCLASS-003
// The :id is the finalClassificationId and not the caseId — unlike the ten satellites of
// investigation, where the two were the same value. An inactive row answers 404 for USER and
// ADMIN, and 200 for SUPERADMIN through canViewInactive
const getFinalClassificationByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const finalClassification = await findFinalClassificationWithRelations(id, canViewInactive);
    if( !finalClassification ) {
        throw new AppError(getMessage('finalClassification.notFound', lang), 404, 'FINCLASS_003_NOT_FOUND');
    }
    return toFinalClassificationResponse(finalClassification);
}

// Get Final Classification By Case ID Service
// Code: ESAVI-FINCLASS-006
// The real query of the domain: the client holds the caseId, not the finalClassificationId, and
// has never seen the latter. It returns the record itself and not { count, rows } — the relation
// is one to one, and wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// The two 404 are deliberately distinct: a case that does not exist is a broken link, a case
// without a final classification is a pending verdict, and the client acts differently on each
const getFinalClassificationByCaseIdService = async (caseId: string, lang: string, canViewInactive: boolean = false) => {
    await assertCaseIsValid(caseId, '006', lang);

    const finalClassification = await findFinalClassificationByCaseId(caseId, canViewInactive);
    if( !finalClassification ) {
        throw new AppError(getMessage('finalClassification.notFound', lang), 404, 'FINCLASS_006_NOT_FOUND');
    }
    return toFinalClassificationResponse(finalClassification);
}

// The state the row would be left in once block D has had its say. With D active the ten forbidden
// columns are forced to null: marking the case unclassifiable wipes the previous verdict without
// asking permission and without returning an error. The forcing happens BEFORE the precedence rule
// and before the catalog lookup, so neither of them works on values that are not going to be stored
const applyUnclassifiableForcing = (resulting: ResultingState): ResultingState => {
    if( resulting.dIsUnclassifiable !== true ) {
        return resulting;
    }
    const forced: ResultingState = { ...resulting };
    for( const field of UNCLASSIFIABLE_FORBIDDEN_FIELDS ) {
        forced[field] = null;
    }
    return forced;
}

// Update Final Classification Service
// Code: ESAVI-FINCLASS-004
// caseId is ignored whether or not it arrives in the body, with no 400: a final classification is
// not moved between cases. The UNIQUE of the destination would block it anyway if that case
// already had one, and the origin would be left without a verdict without anything recording it
const updateFinalClassificationService = async (
    id: string,
    data: Partial<CreateFinalClassificationInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    // Read whole, with no narrowed attributes: buildDifferentialUpdate needs the complete row, or
    // a column left out reads back undefined and every comparison against it counts as a change
    const where = canViewInactive
        ? { finalClassificationId: id }
        : { finalClassificationId: id, isActive: true };
    const finalClassification = await FinalClassification.findOne({ where });
    if( !finalClassification ) {
        throw new AppError(getMessage('finalClassification.notFound', lang), 404, 'FINCLASS_004_NOT_FOUND');
    }

    const stored = finalClassification.get({ plain: true }) as Record<string, unknown>;

    // The two coherence rules look at the resulting state — what travels merged with what is
    // stored — and they run BEFORE the diff and independently of it. A PUT { notes: 'x' } over a
    // row with A=1, B=2 does not fail; a PUT { importanceBItemId: <the item A already holds> }
    // does, even though importanceAItemId never travels in the body
    const resulting = resolveResultingState(data, stored);

    // Asymmetric with the 001: the ten that do NOT travel are forced to null further down, and
    // only the ones that travel WITH A VALUE are a 400. Sending them explicitly null is not an
    // error — it is the same destination the forcing reaches on its own
    assertUnclassifiableFieldsNotSent(data, resulting, '004', lang);

    const effective = applyUnclassifiableForcing(resulting);
    assertImportanceIsNotDuplicated(effective, '004', lang);
    await assertImportancesAreValid(effective, '004', lang);

    // Differential update: only what really changed reaches the UPDATE. Resending whole the record
    // just read with a GET is the normal use of a form, and writing it back would fill appDetails
    // with entries that record no change and hide the real ones among them.
    //
    // The ten forbidden columns are conditional derivatives: with D active they enter candidates
    // ALWAYS with null and with no presence check, and it is buildDifferentialUpdate that decides
    // whether they differ. Marking D over a row that was already unclassifiable writes nothing.
    // Compared against undefined and never by truthiness: a boolean arriving false is a value
    const candidates: Record<string, unknown> = {};
    const isUnclassifiable = resulting.dIsUnclassifiable === true;
    for( const field of UNCLASSIFIABLE_FORBIDDEN_FIELDS ) {
        candidates[field] = isUnclassifiable
            ? null
            : ( data[field] !== undefined ? ( data[field] ?? null ) : undefined );
    }

    const objectToUpdate = buildDifferentialUpdate(stored, {
        ...candidates,
        // The flag itself is never forced: it is what decides, not what is decided
        dIsUnclassifiable: data.dIsUnclassifiable !== undefined
            ? ( data.dIsUnclassifiable ?? null )
            : undefined,
        // Outside the block: never forced and never forbidden, even with D active. The reason a
        // case is unclassifiable is exactly what has to be writable there
        notes: data.notes !== undefined ? ( data.notes ? data.notes.trim() : null ) : undefined
    });

    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findFinalClassificationWithRelations(id, true);
        return unchanged ? toFinalClassificationResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the
    // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    const currentAppDetails = Array.isArray(finalClassification.appDetails) ? finalClassification.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-FINCLASS-004',
        detail: 'Final classification updated by service'
    };
    await finalClassification.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updatedFinalClassification = await findFinalClassificationWithRelations(id, true);
    return updatedFinalClassification ? toFinalClassificationResponse(updatedFinalClassification) : null;
}

// Setting Final Classification Active/Inactive Service
// Code: ESAVI-FINCLASS-005A / ESAVI-FINCLASS-005B
// This is the first entity since F26 with activation of its own, and the one thing that most
// separates it from the ten satellites of investigation: the table has its own isActive column.
// It goes through setEntityActiveStatusService with no logic of its own.
//
// No guard over active children: finalClassification is a leaf of the graph — nothing in the
// schema references finalClassificationId — so there are none that could block the deactivation.
//
// Deactivating the verdict does NOT touch the case. The cascade only goes down, and only down.
// Reactivating does not require the case to be active either, for the same reason as in
// classification: whoever reactivates is SUPERADMIN, and there can be no conflict with
// UQ_finalClassification_case because the caseId was never released — step 2 of the 001 prevents
// a second final classification from waiting for the slot
const setFinalClassificationActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // The where filters by the primary key only: the generic service is the one that tells
        // 'does not exist' (404) from 'already in that state' (409)
        await setEntityActiveStatusService({
            model: FinalClassification,
            where: { finalClassificationId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('finalClassification.notFound', lang),
            notFoundCode: `FINCLASS_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`finalClassification.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `FINCLASS_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-FINCLASS-${ op }`,
                detail: `Final classification ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Purging Final Classification Service - For SuperAdmin
// Code: ESAVI-FINCLASS-005C
// finalClassification is outside the preventPhysicalDelete loop of esaviapp.sql:1372-1386, so the
// row can really be destroyed. This is the only path that releases the caseId: once the row is
// gone UQ_finalClassification_case is free and the case admits a new final classification.
//
// No cascade dump: the table is a leaf of the graph and drags nothing with it. It does not touch
// the case either — the foreign key runs from the final classification to the case and not the
// other way round. The generic service writes the warn dump of the whole row before the destroy,
// and touches no appDetails: the row disappears in the same transaction, so the operation code
// lives in four places here and not in five
const purgeFinalClassificationService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        await purgeEntityService({
            model: FinalClassification,
            where: { finalClassificationId: id },
            transaction,
            operationCode: 'ESAVI-FINCLASS-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('finalClassification.notFound', lang),
            notFoundCode: 'FINCLASS_005C_NOT_FOUND',
            stillActiveMessage: getMessage('finalClassification.stillActive', lang, { id }),
            stillActiveCode: 'FINCLASS_005C_STILL_ACTIVE'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createFinalClassificationService,
    getFinalClassificationsService,
    getAllFinalClassificationsService,
    getFinalClassificationByIdService,
    getFinalClassificationByCaseIdService,
    updateFinalClassificationService,
    setFinalClassificationActivationService,
    purgeFinalClassificationService
}
