import { WhereOptions } from 'sequelize';
import { CatalogItem, CatalogType, Classification, EsaviCase, Patient } from '../models';
import {
    AppError,
    findSeverityViolation,
    getMessage,
    hasAnySeriousCriterion,
    resolveAgeAtEvent,
    SERIOUS_CRITERION_FIELDS,
    SEVERITY_VIOLATION_MESSAGES,
    SeverityState
} from '../helpers';
import { AppDetails, AuthUser, ClassificationListFilters, CreateClassificationInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Code of the catalogType that groups the three age units. Without this check any active
// catalogItem of the system would enter as a unit and the stored age would mean nothing
const AGE_UNIT_CATALOG_CODE = 'ageUnit';

const CASE_INCLUDE = {
    model: EsaviCase,
    as: 'case',
    // eventDate travels — unlike in notifier — because it is the date the age was computed
    // from: without it the client sees a number it cannot explain
    attributes: ['caseId', 'caseCode', 'reportDate', 'eventDate']
};

const AGE_UNIT_INCLUDE = {
    model: CatalogItem,
    as: 'ageUnit',
    attributes: ['catalogItemId', 'code', 'name']
};

// sysDetails is trigger metadata and never leaves the service. The two raw foreign keys go with
// it: the response carries the resolved case and ageUnit objects instead
const DETAIL_EXCLUDE = { exclude: ['sysDetails', 'caseId', 'ageUnitItemId'] };

// The reduced shape of the listings drops notes and appDetails, plus the three timestamps.
// The nine booleans and otherSeriousConditionDescription do travel: the use case of the list is
// seeing at a glance which cases are serious and under which criterion, and without them the
// list says nothing. notes stays out because it is free text with no length limit and dumping it
// on every row makes the response size unpredictable
const LIST_ATTRIBUTES = [
    'classificationId',
    'age',
    'firstConsultationDate',
    'isSeriousEvent',
    'causedDeath',
    'causedDisability',
    'causedCongenitalAnomaly',
    'causedFetalDeath',
    'causedLifeThreatening',
    'causedHospitalization',
    'causedAbortion',
    'causedOtherCondition',
    'otherSeriousConditionDescription',
    'isActive'
];

// Newest first, the same order as notifier and esaviCase
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// The nine booleans are returned exactly as stored, null included: they are never normalized to
// false when building the response. In surveillance "not known" and "no" are not the same thing
const toClassificationResponse = (classification: Classification) => {
    const plain = classification.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.caseId;
    delete plain.ageUnitItemId;
    return plain;
}

// The read the write operations share to build their response
const findClassificationWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { classificationId: id } : { classificationId: id, isActive: true };
    return await Classification.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [CASE_INCLUDE, AGE_UNIT_INCLUDE]
    });
}

// The same read as above, entered through the foreign key instead of the primary one. It needs
// no LIMIT beyond findOne because UQ_classification_case guarantees there is at most one row
const findClassificationByCaseId = async (caseId: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    return await Classification.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [CASE_INCLUDE, AGE_UNIT_INCLUDE]
    });
}

// The case must exist and be active: FK_classification_case declares ON DELETE CASCADE, but
// TRG_esaviCase_preventPhysicalDelete forbids every physical delete of esaviCase, so that
// cascade never fires and nothing in the DDL stops a classification from pointing at a retired
// case. The operation code travels in so the AppError keeps it
const assertCaseIsValid = async (caseId: string, op: string, lang: string) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('classification.caseNotFound', lang), 404, `CLASSIF_${ op }_CASE_NOT_FOUND`);
    }
}

// UQ_classification_case makes the relation one to one, and it does not filter by isActive:
// a caseId taken by a deactivated classification is still taken. Checking only the active ones
// would let through an INSERT that Postgres rejects with 23505, turning a 409 into a 500
const assertCaseIsNotClassified = async (caseId: string, op: string, lang: string) => {
    const existing = await Classification.findOne({
        where: { caseId },
        attributes: ['classificationId']
    });
    if( existing ) {
        throw new AppError(
            getMessage('classification.caseAlreadyClassified', lang, { caseId }),
            409,
            `CLASSIF_${ op }_CASE_ALREADY_CLASSIFIED`
        );
    }
}

// The unit the calculation resolved, looked up by code inside the ageUnit catalog. A missing
// item is a deployment precondition that was not met, not a client mistake, and it has its own
// i18n key so an installation error does not read like a capture error
const findAgeUnitItemByCode = async (code: string, op: string, lang: string) => {
    const ageUnitItem = await CatalogItem.findOne({
        where: { code, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: AGE_UNIT_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !ageUnitItem ) {
        throw new AppError(
            getMessage('classification.ageUnitCatalogMissing', lang, { code }),
            404,
            `CLASSIF_${ op }_AGEUNIT_CATALOG_MISSING`
        );
    }
    return ageUnitItem;
}

// The unit the client sent, validated like any other foreign key. Only reachable through the
// fallback branch: with both dates present the body never gets this far
const assertAgeUnitIsValid = async (ageUnitItemId: string, op: string, lang: string) => {
    const ageUnitItem = await CatalogItem.findOne({
        where: { catalogItemId: ageUnitItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: AGE_UNIT_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !ageUnitItem ) {
        throw new AppError(getMessage('classification.ageUnitNotFound', lang), 404, `CLASSIF_${ op }_AGEUNIT_NOT_FOUND`);
    }
}

// Resolve the age of the patient at the time of the event — shared by 001 and 004.
// The age is derived, not captured: it is computable from two dates the system already stores,
// and capturing it by hand guarantees that sooner or later it contradicts its own origin. What
// the body sends is dropped in silence whenever both dates exist — no 400 and no warning —
// because a 400 would punish resending whole the record just read with a GET, which is the
// normal use of a form. esaviCase.reportDate is never used as a stand-in for eventDate: it is
// when the case was reported, not when it happened, and it would yield a plausible false age
const resolveAgeForCase = async (
    caseId: string,
    data: Partial<CreateClassificationInput>,
    op: string,
    lang: string
): Promise<{ age: number | null, ageUnitItemId: string | null }> => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId },
        attributes: ['caseId', 'eventDate'],
        include: [{
            model: Patient,
            as: 'patient',
            attributes: ['patientId', 'birthDate']
        }]
    });

    let calculated;
    try {
        calculated = resolveAgeAtEvent(esaviCase?.patient?.birthDate, esaviCase?.eventDate);
    } catch {
        // The conflict is between two rows that already exist, so it is a 409 and not a 400:
        // a 400 would blame whoever did not send those dates. Nothing is stored, and the
        // CHECK ("age" >= 0) of Postgres never gets the chance to fire
        throw new AppError(getMessage('classification.invalidAgeRange', lang), 409, `CLASSIF_${ op }_INVALID_AGE_RANGE`);
    }

    if( calculated ) {
        const ageUnitItem = await findAgeUnitItemByCode(calculated.unitCode, op, lang);
        return { age: calculated.age, ageUnitItemId: ageUnitItem.catalogItemId };
    }

    // Fallback: one of the two dates is missing, so what the client sent prevails. The validator
    // already enforced that they travel together or not at all
    if( data.age !== undefined && data.age !== null && data.ageUnitItemId ) {
        await assertAgeUnitIsValid(data.ageUnitItemId, op, lang);
        return { age: data.age, ageUnitItemId: data.ageUnitItemId };
    }
    return { age: null, ageUnitItemId: null };
}

// Create Classification Service
// Code: ESAVI-CLASSIF-001
const createClassificationService = async (data: CreateClassificationInput, authUser: AuthUser | undefined, lang: string) => {
    await assertCaseIsValid(data.caseId, '001', lang);
    await assertCaseIsNotClassified(data.caseId, '001', lang);

    const { age, ageUnitItemId } = await resolveAgeForCase(data.caseId, data, '001', lang);

    // Fourth row of the coherence matrix: an event with a severity criterion behind it is
    // serious by definition, so the flag is derived however it arrived — true, false or absent.
    // Asking the client to repeat it only opens the door to contradicting itself
    const isSeriousEvent = hasAnySeriousCriterion(data) ? true : ( data.isSeriousEvent ?? null );

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CLASSIF-001',
        detail: 'Classification created by service'
    };
    // The nine booleans keep the tri-state: what does not arrive is stored null, never false.
    // Only the two free texts are normalized — this entity has neither `code` nor `name`
    const newClassification = await Classification.create({
        caseId: data.caseId,
        age,
        ageUnitItemId,
        firstConsultationDate: data.firstConsultationDate ?? null,
        isSeriousEvent,
        causedDeath: data.causedDeath ?? null,
        causedDisability: data.causedDisability ?? null,
        causedCongenitalAnomaly: data.causedCongenitalAnomaly ?? null,
        causedFetalDeath: data.causedFetalDeath ?? null,
        causedLifeThreatening: data.causedLifeThreatening ?? null,
        causedHospitalization: data.causedHospitalization ?? null,
        causedAbortion: data.causedAbortion ?? null,
        causedOtherCondition: data.causedOtherCondition ?? null,
        otherSeriousConditionDescription: data.otherSeriousConditionDescription
            ? data.otherSeriousConditionDescription.trim() : null,
        notes: data.notes ? data.notes.trim() : null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved case and ageUnit, not their ids
    const createdClassification = await findClassificationWithRelations(newClassification.classificationId, true);
    return createdClassification ? toClassificationResponse(createdClassification) : null;
}

// The three filters are accumulated with AND, and each one is optional. A filter pointing at a
// row that does not exist yields an empty page, never a 404: searching for something absent is
// an empty search, not a missing resource. isSeriousEvent is compared against undefined and not
// by truthiness, or filtering by false would silently drop the condition
const buildListWhere = (filters: ClassificationListFilters = {}): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.caseId ) where.caseId = filters.caseId;
    if( filters.isSeriousEvent !== undefined ) where.isSeriousEvent = filters.isSeriousEvent;
    if( filters.ageUnitItemId ) where.ageUnitItemId = filters.ageUnitItemId;

    return where as WhereOptions;
}

// Get Active Classifications Service
// Code: ESAVI-CLASSIF-002A
// The where filters by the isActive of the classification, not by the one of its case: with the
// cascade of ESAVI-CASE-005A the classification of a retired case is already inactive, so the
// result is the same without conditioning the include with a required: true
const getClassificationsService = async (
    filters: ClassificationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await Classification.findAndCountAll({
        where: { ...buildListWhere(filters), isActive: true },
        attributes: LIST_ATTRIBUTES,
        include: [CASE_INCLUDE, AGE_UNIT_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get All Classifications Service - For Admin
// Code: ESAVI-CLASSIF-002B
const getAllClassificationsService = async (
    filters: ClassificationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await Classification.findAndCountAll({
        where: buildListWhere(filters),
        attributes: LIST_ATTRIBUTES,
        include: [CASE_INCLUDE, AGE_UNIT_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get Classification By ID Service
// Code: ESAVI-CLASSIF-003
const getClassificationByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const classification = await findClassificationWithRelations(id, canViewInactive);
    if( !classification ) {
        throw new AppError(getMessage('classification.notFound', lang), 404, 'CLASSIF_003_NOT_FOUND');
    }
    return toClassificationResponse(classification);
}

// Get Classification By Case ID Service
// Code: ESAVI-CLASSIF-006
// The real query of the domain: the client holds the caseId, not the classificationId. It
// returns the record itself and not { count, rows } — the relation is one to one, and wrapping a
// single record in a collection would force unwrapping a one-element array on every screen.
// The two 404 are deliberately distinct: a case that does not exist is a broken link, a case
// without classification is a pending task, and the client acts differently on each
const getClassificationByCaseIdService = async (caseId: string, lang: string, canViewInactive: boolean = false) => {
    await assertCaseIsValid(caseId, '006', lang);

    const classification = await findClassificationByCaseId(caseId, canViewInactive);
    if( !classification ) {
        throw new AppError(getMessage('classification.notFound', lang), 404, 'CLASSIF_006_NOT_FOUND');
    }
    return toClassificationResponse(classification);
}

// The nine booleans and the description of the resulting state: what is stored merged with what
// arrives. A key absent from the body keeps its stored value; a key that arrives null erases it,
// because null is a state of its own and not the lack of an answer
const mergeSeverityState = (classification: Classification, data: Partial<CreateClassificationInput>): SeverityState => {
    const merged: Record<string, unknown> = {};
    const fields = [
        'isSeriousEvent',
        ...SERIOUS_CRITERION_FIELDS,
        'otherSeriousConditionDescription'
    ] as const;
    for( const field of fields ) {
        merged[field] = data[field] !== undefined
            ? ( data[field] ?? null )
            : classification.getDataValue(field);
    }
    return merged as SeverityState;
}

// Update Classification Service
// Code: ESAVI-CLASSIF-004
// caseId is ignored whether or not it arrives in the body: a classification is not moved between
// cases. The UNIQUE of the destination would block it anyway if that case already had one, and
// the origin would be left unclassified without anything recording it
const updateClassificationService = async (
    id: string,
    data: Partial<CreateClassificationInput>,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const classification = await Classification.findByPk(id);
    if( !classification ) {
        throw new AppError(getMessage('classification.notFound', lang), 404, 'CLASSIF_004_NOT_FOUND');
    }

    // Recalculated always, even when the PUT touches nothing related. It is the manual way of
    // correcting an age that went stale after its two source dates changed, until the
    // propagation spec exists, and it keeps a single path for the rule
    const { age, ageUnitItemId } = await resolveAgeForCase(classification.caseId, data, '004', lang);

    // The matrix is evaluated over the resulting state and not over the body: otherwise a PUT
    // sending causedDeath false on a classification whose only criterion was that one would
    // leave isSeriousEvent true with nothing behind it. The validator cannot do this — it does
    // not see the row — so the same pure predicate is applied here instead
    const resultingState = mergeSeverityState(classification, data);
    const violation = findSeverityViolation(resultingState);
    if( violation ) {
        throw new AppError(
            getMessage('common.validationError', lang),
            400,
            'CLASSIF_004_SEVERITY_INCOHERENT',
            SEVERITY_VIOLATION_MESSAGES[violation]
        );
    }

    const objectToUpdate: Record<string, unknown> = {
        age,
        ageUnitItemId,
        firstConsultationDate: data.firstConsultationDate !== undefined
            ? ( data.firstConsultationDate ?? null ) : undefined,
        otherSeriousConditionDescription: data.otherSeriousConditionDescription !== undefined
            ? ( data.otherSeriousConditionDescription ? data.otherSeriousConditionDescription.trim() : null ) : undefined,
        notes: data.notes !== undefined ? ( data.notes ? data.notes.trim() : null ) : undefined
    };
    for( const field of SERIOUS_CRITERION_FIELDS ) {
        objectToUpdate[field] = data[field] !== undefined ? ( data[field] ?? null ) : undefined;
    }
    for( const key of Object.keys(objectToUpdate) ) {
        if( objectToUpdate[key] === undefined ) delete objectToUpdate[key];
    }

    // Fourth row of the matrix, applied over the resulting state as well: with a criterion
    // behind it the event is serious however the flag arrived
    objectToUpdate.isSeriousEvent = hasAnySeriousCriterion(resultingState)
        ? true
        : ( resultingState.isSeriousEvent ?? null );

    // Written by hand so the service does not depend on a trigger for a column it owns: the
    // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The entry is written even when nothing changed: the attempt is part of the audit trail
    const currentAppDetails = Array.isArray(classification.appDetails) ? classification.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CLASSIF-004',
        detail: 'Classification updated by service'
    };
    await classification.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updatedClassification = await findClassificationWithRelations(id, true);
    return updatedClassification ? toClassificationResponse(updatedClassification) : null;
}

export {
    createClassificationService,
    getClassificationsService,
    getAllClassificationsService,
    getClassificationByIdService,
    getClassificationByCaseIdService,
    updateClassificationService
}
