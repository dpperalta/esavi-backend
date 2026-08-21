import { WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EsaviCase, GeoLocation, HealthFacility, Investigation } from '../models';
import { AppError, buildDifferentialUpdate, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationInput, InvestigationListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import {
    DEFAULT_INVESTIGATION_STATUS_CODE,
    INVESTIGATION_STATUS_CATALOG_CODE,
    VACCINATION_SITE_CATALOG_CODE
} from '../constants/investigation.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { purgeEntityService } from './common/entityPurge.service';

const CASE_INCLUDE = {
    model: EsaviCase,
    as: 'case',
    attributes: ['caseId', 'caseCode', 'reportDate', 'eventDate']
};

const STATUS_INCLUDE = {
    model: CatalogItem,
    as: 'status',
    attributes: ['catalogItemId', 'code', 'name']
};

const VACCINATION_SITE_INCLUDE = {
    model: CatalogItem,
    as: 'vaccinationSite',
    attributes: ['catalogItemId', 'code', 'name']
};

const VACCINATION_HEALTH_FACILITY_INCLUDE = {
    model: HealthFacility,
    as: 'vaccinationHealthFacility',
    attributes: ['healthFacilityId', 'localCode', 'name']
};

// geoLocation has no `code` column (esaviapp.sql:412-431), so the include reproduces the one of
// healthFacility.service.ts:141 instead of the catalogItem shape used by the two above
const VACCINATION_GEO_LOCATION_INCLUDE = {
    model: GeoLocation,
    as: 'vaccinationGeoLocation',
    attributes: ['geoLocationId', 'name', 'level']
};

const DETAIL_INCLUDES = [
    CASE_INCLUDE,
    STATUS_INCLUDE,
    VACCINATION_SITE_INCLUDE,
    VACCINATION_HEALTH_FACILITY_INCLUDE,
    VACCINATION_GEO_LOCATION_INCLUDE
];

// sysDetails is trigger metadata and never leaves the service. The five raw foreign keys go with
// it: the response carries the resolved case, status, vaccinationSite, vaccinationHealthFacility
// and vaccinationGeoLocation objects instead
const DETAIL_EXCLUDE = {
    exclude: [
        'sysDetails',
        'caseId',
        'statusItemId',
        'vaccinationSiteItemId',
        'vaccinationHealthFacilityId',
        'vaccinationGeoLocationId'
    ]
};

// The reduced shape of the listings drops notes — free text with no length limit, which would
// make the response size unpredictable — appDetails and the three timestamps. The two coordinates
// do travel: they are what lets the client paint the listing on a map without opening every file
const LIST_ATTRIBUTES = [
    'investigationId',
    'hospitalizationDate',
    'investigationStartDate',
    'vaccinationLatitude',
    'vaccinationLongitude',
    'isActive'
];

// Newest first, the same order as classification, notifier and esaviCase
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

const toInvestigationResponse = (investigation: Investigation) => {
    const plain = investigation.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.caseId;
    delete plain.statusItemId;
    delete plain.vaccinationSiteItemId;
    delete plain.vaccinationHealthFacilityId;
    delete plain.vaccinationGeoLocationId;
    return plain;
}

// The read the write operations share to build their response
const findInvestigationWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { investigationId: id } : { investigationId: id, isActive: true };
    return await Investigation.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: DETAIL_INCLUDES
    });
}

// The same read as above, entered through the foreign key instead of the primary one. It needs no
// LIMIT beyond findOne because UQ_investigation_case guarantees there is at most one row
const findInvestigationByCaseId = async (caseId: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    return await Investigation.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: DETAIL_INCLUDES
    });
}

// The case must exist and be active: FK_investigation_case declares ON DELETE CASCADE, but
// TRG_esaviCase_preventPhysicalDelete forbids every physical delete of esaviCase, so that cascade
// never fires and nothing in the DDL stops an investigation from pointing at a retired case
const assertCaseIsValid = async (caseId: string, op: string, lang: string) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('investigation.caseNotFound', lang), 404, `INVESTGN_${ op }_CASE_NOT_FOUND`);
    }
}

// UQ_investigation_case makes the relation one to one, and it does not filter by isActive: a
// caseId taken by a deactivated investigation is still taken. Checking only the active ones would
// let through an INSERT that Postgres rejects with 23505, turning a 409 into a 500. The caseId is
// interpolated into the message, or the client would see a 409 about a row it cannot see
const assertCaseIsNotInvestigated = async (caseId: string, op: string, lang: string) => {
    const existing = await Investigation.findOne({
        where: { caseId },
        attributes: ['investigationId']
    });
    if( existing ) {
        throw new AppError(
            getMessage('investigation.caseAlreadyInvestigated', lang, { caseId }),
            409,
            `INVESTGN_${ op }_CASE_ALREADY_INVESTIGATED`
        );
    }
}

// A catalogItem that exists, is active and belongs to the given catalogType. Without the type
// check any active catalogItem of the system would enter as a status or as a vaccination site,
// and the stored value would mean nothing
const findCatalogItemOfType = async (catalogItemId: string, catalogTypeCode: string) => {
    return await CatalogItem.findOne({
        where: { catalogItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: catalogTypeCode },
            attributes: []
        }]
    });
}

// Resolve the investigation status — shared by 001 and 004, and the rule of the entity.
// statusItemId is nullable in the DDL but the application never leaves it empty: an investigation
// without a status is not queryable data. When it does not travel, or travels explicitly null,
// the item of code '0' takes its place. A missing default is a deployment precondition that was
// not met, not a client mistake, so it answers 500 with its own key: a 4xx would send whoever
// reads it hunting for the error in a body that was perfectly fine
const resolveStatusItemId = async (
    statusItemId: string | null | undefined,
    op: string,
    lang: string
): Promise<string> => {
    if( statusItemId ) {
        const statusItem = await findCatalogItemOfType(statusItemId, INVESTIGATION_STATUS_CATALOG_CODE);
        if( !statusItem ) {
            throw new AppError(getMessage('investigation.statusNotFound', lang), 404, `INVESTGN_${ op }_STATUS_NOT_FOUND`);
        }
        return statusItem.catalogItemId;
    }

    const defaultStatusItem = await CatalogItem.findOne({
        where: { code: DEFAULT_INVESTIGATION_STATUS_CODE, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: INVESTIGATION_STATUS_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !defaultStatusItem ) {
        throw new AppError(
            getMessage('investigation.defaultStatusMissing', lang, { code: DEFAULT_INVESTIGATION_STATUS_CODE }),
            500,
            `INVESTGN_${ op }_DEFAULT_STATUS_MISSING`
        );
    }
    return defaultStatusItem.catalogItemId;
}

// The three remaining foreign keys, all checked against active rows and shared by 001 and 004.
// One arriving as an explicit null is not validated: it is being cleared. One arriving with a
// UUID is validated even when it matches what is already stored — that is the rule of
// CONVENTIONS.md §11, independent of the diff
const assertOptionalForeignKeys = async (
    data: Partial<CreateInvestigationInput>,
    op: string,
    lang: string
) => {
    if( data.vaccinationSiteItemId ) {
        const vaccinationSiteItem = await findCatalogItemOfType(data.vaccinationSiteItemId, VACCINATION_SITE_CATALOG_CODE);
        if( !vaccinationSiteItem ) {
            throw new AppError(
                getMessage('investigation.vaccinationSiteNotFound', lang),
                404,
                `INVESTGN_${ op }_VACCINATION_SITE_NOT_FOUND`
            );
        }
    }

    if( data.vaccinationHealthFacilityId ) {
        const healthFacility = await HealthFacility.findOne({
            where: { healthFacilityId: data.vaccinationHealthFacilityId, isActive: true },
            attributes: ['healthFacilityId']
        });
        if( !healthFacility ) {
            throw new AppError(
                getMessage('investigation.healthFacilityNotFound', lang),
                404,
                `INVESTGN_${ op }_HEALTH_FACILITY_NOT_FOUND`
            );
        }
    }

    if( data.vaccinationGeoLocationId ) {
        const geoLocation = await GeoLocation.findOne({
            where: { geoLocationId: data.vaccinationGeoLocationId, isActive: true },
            attributes: ['geoLocationId']
        });
        if( !geoLocation ) {
            throw new AppError(
                getMessage('investigation.geoLocationNotFound', lang),
                404,
                `INVESTGN_${ op }_GEO_LOCATION_NOT_FOUND`
            );
        }
    }
}

// Create Investigation Service
// Code: ESAVI-INVESTGN-001
const createInvestigationService = async (data: CreateInvestigationInput, authUser: AuthUser | undefined, lang: string) => {
    await assertCaseIsValid(data.caseId, '001', lang);
    await assertCaseIsNotInvestigated(data.caseId, '001', lang);

    const statusItemId = await resolveStatusItemId(data.statusItemId, '001', lang);
    await assertOptionalForeignKeys(data, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVESTGN-001',
        detail: 'Investigation created by service'
    };
    // Only notes is normalized — this entity has neither `code` nor `name`, so neither
    // toConstantCase nor toTitleCase apply. Every other field is stored as it arrived, with an
    // absent one becoming null: all the data columns of the table are nullable
    const newInvestigation = await Investigation.create({
        caseId: data.caseId,
        statusItemId,
        vaccinationSiteItemId: data.vaccinationSiteItemId ?? null,
        vaccinationHealthFacilityId: data.vaccinationHealthFacilityId ?? null,
        vaccinationGeoLocationId: data.vaccinationGeoLocationId ?? null,
        hospitalizationDate: data.hospitalizationDate ?? null,
        investigationStartDate: data.investigationStartDate ?? null,
        vaccinationLatitude: data.vaccinationLatitude ?? null,
        vaccinationLongitude: data.vaccinationLongitude ?? null,
        notes: data.notes ? data.notes.trim() : null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });

    // Re-read so the response carries the five resolved relations, not their ids
    const createdInvestigation = await findInvestigationWithRelations(newInvestigation.investigationId, true);
    return createdInvestigation ? toInvestigationResponse(createdInvestigation) : null;
}

// The four filters are accumulated with AND and compared by equality, and each one is optional.
// A filter pointing at a row that does not exist yields an empty page, never a 404: searching for
// something absent is an empty search, not a missing resource
const buildListWhere = (filters: InvestigationListFilters = {}): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.caseId ) where.caseId = filters.caseId;
    if( filters.statusItemId ) where.statusItemId = filters.statusItemId;
    if( filters.vaccinationHealthFacilityId ) where.vaccinationHealthFacilityId = filters.vaccinationHealthFacilityId;
    if( filters.vaccinationGeoLocationId ) where.vaccinationGeoLocationId = filters.vaccinationGeoLocationId;

    return where as WhereOptions;
}

// Get Active Investigations Service
// Code: ESAVI-INVESTGN-002A
// The where filters by the isActive of the investigation, not by the one of its case: with the
// cascade of ESAVI-CASE-005A the investigation of a retired case is already inactive, so the
// result is the same without conditioning the include with a required: true
const getInvestigationsService = async (
    filters: InvestigationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await Investigation.findAndCountAll({
        where: { ...buildListWhere(filters), isActive: true },
        attributes: LIST_ATTRIBUTES,
        include: DETAIL_INCLUDES,
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get All Investigations Service - For Admin
// Code: ESAVI-INVESTGN-002B
const getAllInvestigationsService = async (
    filters: InvestigationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await Investigation.findAndCountAll({
        where: buildListWhere(filters),
        attributes: LIST_ATTRIBUTES,
        include: DETAIL_INCLUDES,
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get Investigation By ID Service
// Code: ESAVI-INVESTGN-003
const getInvestigationByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const investigation = await findInvestigationWithRelations(id, includeInactive);
    if( !investigation ) {
        throw new AppError(getMessage('investigation.notFound', lang), 404, 'INVESTGN_003_NOT_FOUND');
    }
    return toInvestigationResponse(investigation);
}

// Get Investigation By Case ID Service
// Code: ESAVI-INVESTGN-006
// The real query of the domain: the client holds the caseId, not the investigationId. It returns
// the object and not { count, rows } — the relation is one to one, and wrapping a single file in
// a collection would force the client to unpack an array of one element.
// The two 404 are distinct on purpose, and the difference matters to the client: one says the
// case is not there, the other that the case has no visible investigation
const getInvestigationByCaseIdService = async (caseId: string, lang: string, includeInactive: boolean = false) => {
    await assertCaseIsValid(caseId, '006', lang);

    const investigation = await findInvestigationByCaseId(caseId, includeInactive);
    if( !investigation ) {
        throw new AppError(getMessage('investigation.notFound', lang), 404, 'INVESTGN_006_NOT_FOUND');
    }
    return toInvestigationResponse(investigation);
}

// Update Investigation Service
// Code: ESAVI-INVESTGN-004
// All the data columns of the table are nullable, so this is the main operation of the entity and
// not an accessory: an investigation is opened almost empty and filled in over time. `caseId` is
// ignored in silence, without a 400: an investigation is not moved between cases, because its
// fourteen future satellites hang from investigationId and the move would leave the clinical
// detail under another patient
const updateInvestigationService = async (
    id: string,
    data: Partial<CreateInvestigationInput>,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const investigation = await Investigation.findByPk(id);
    if( !investigation ) {
        throw new AppError(getMessage('investigation.notFound', lang), 404, 'INVESTGN_004_NOT_FOUND');
    }

    // Resolved and validated before the diff and independently of it: a foreign key arriving with
    // a UUID is checked even when it matches what is stored.
    // The status is resolved only when the key travels, which is where this operation departs from
    // the letter of the spec and keeps its acceptance criteria: the response of the GET carries the
    // resolved `status` object, never the raw statusItemId, so a client resending that response
    // whole — the normal use of a form — sends no statusItemId at all. Resolving it there anyway
    // would fall back to the item '0' and silently downgrade the status of every investigation on
    // every save. An absent key keeps what is stored; an explicit null still resolves to '0', so
    // the column is never left empty
    const statusItemId = data.statusItemId !== undefined
        ? await resolveStatusItemId(data.statusItemId, '004', lang)
        : undefined;
    await assertOptionalForeignKeys(data, '004', lang);

    // Differential update: only what really changed reaches the UPDATE. Resending whole the
    // record just read with a GET is the normal use of a form, and writing it back would fill
    // appDetails with entries that record no change and hide the real ones among them.
    // The whole row, without narrowed attributes: a column left out reads back as undefined and
    // every comparison against undefined counts as a change
    const stored = investigation.get({ plain: true }) as Record<string, unknown>;

    // No field goes under an `if( data.x )`: that would silently discard the 0 of a coordinate
    // and the empty string of notes, and would leave the nullable fields with no way to be
    // cleared. Every candidate is compared against undefined, statusItemId included
    const objectToUpdate = buildDifferentialUpdate(stored, {
        statusItemId,
        vaccinationSiteItemId: data.vaccinationSiteItemId !== undefined
            ? ( data.vaccinationSiteItemId ?? null ) : undefined,
        vaccinationHealthFacilityId: data.vaccinationHealthFacilityId !== undefined
            ? ( data.vaccinationHealthFacilityId ?? null ) : undefined,
        vaccinationGeoLocationId: data.vaccinationGeoLocationId !== undefined
            ? ( data.vaccinationGeoLocationId ?? null ) : undefined,
        // Written as a plain YYYY-MM-DD string, which is what a DATEONLY column reads back as
        hospitalizationDate: data.hospitalizationDate !== undefined
            ? ( data.hospitalizationDate ? String(data.hospitalizationDate).slice(0, 10) : null )
            : undefined,
        investigationStartDate: data.investigationStartDate !== undefined
            ? ( data.investigationStartDate ? String(data.investigationStartDate).slice(0, 10) : null )
            : undefined,
        // DECIMAL: pg reads them back as strings and the body sends numbers. The numeric rule of
        // the helper resolves it, so resending the same coordinate is not a change
        vaccinationLatitude: data.vaccinationLatitude !== undefined
            ? ( data.vaccinationLatitude ?? null ) : undefined,
        vaccinationLongitude: data.vaccinationLongitude !== undefined
            ? ( data.vaccinationLongitude ?? null ) : undefined,
        notes: data.notes !== undefined ? ( data.notes ? data.notes.trim() : null ) : undefined
    });

    // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findInvestigationWithRelations(id, true);
        return unchanged ? toInvestigationResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the
    // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    const currentAppDetails = Array.isArray(investigation.appDetails) ? investigation.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-INVESTGN-004',
        detail: 'Investigation updated by service'
    };
    await investigation.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updatedInvestigation = await findInvestigationWithRelations(id, true);
    return updatedInvestigation ? toInvestigationResponse(updatedInvestigation) : null;
}

// Setting Investigation Active/Inactive Service
// Code: ESAVI-INVESTGN-005A / ESAVI-INVESTGN-005B
// It does NOT go through buildDifferentialUpdate, and that is deliberate: these are writes with an
// intention of their own. They record the act of retiring or returning the row even when no data
// field changes, and that record in appDetails is precisely what is worth keeping.
// Reactivating does NOT require the case to be active, for the same reason as in notifier,
// classification and notification: the cascade only goes down, and whoever reactivates is
// SUPERADMIN. There can be no conflict with UQ_investigation_case either, because the caseId was
// never released — only 005C releases it
const setInvestigationActivationService = async (
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
            model: Investigation,
            where: { investigationId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('investigation.notFound', lang),
            notFoundCode: `INVESTGN_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`investigation.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `INVESTGN_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-INVESTGN-${ op }`,
                detail: `Investigation ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Purging Investigation Service - For SuperAdmin
// Code: ESAVI-INVESTGN-005C
// investigation is outside the preventPhysicalDelete loop of esaviapp.sql:1369-1373, so the row
// can really be destroyed. This is the only path that releases the caseId: once the row is gone
// UQ_investigation_case is free and the case admits a new investigation. It does not touch the
// case — the foreign key runs from the investigation to the case and not the other way round.
// WARNING for when the satellites land: the fourteen detail tables of investigation declare
// ON DELETE CASCADE on investigationId, so a 005C will drag the whole detailed investigation with
// it without asking for confirmation. Today there is nothing to drag, and the spec that creates
// the first satellite must revisit this operation
const purgeInvestigationService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        await purgeEntityService({
            model: Investigation,
            where: { investigationId: id },
            transaction,
            operationCode: 'ESAVI-INVESTGN-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('investigation.notFound', lang),
            notFoundCode: 'INVESTGN_005C_NOT_FOUND',
            stillActiveMessage: getMessage('investigation.stillActive', lang, { id }),
            stillActiveCode: 'INVESTGN_005C_STILL_ACTIVE'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createInvestigationService,
    getInvestigationsService,
    getAllInvestigationsService,
    getInvestigationByIdService,
    getInvestigationByCaseIdService,
    updateInvestigationService,
    setInvestigationActivationService,
    purgeInvestigationService
}
