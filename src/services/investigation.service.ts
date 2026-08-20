import { CatalogItem, CatalogType, EsaviCase, GeoLocation, HealthFacility, Investigation } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateInvestigationInput } from '../types';
import {
    DEFAULT_INVESTIGATION_STATUS_CODE,
    INVESTIGATION_STATUS_CATALOG_CODE,
    VACCINATION_SITE_CATALOG_CODE
} from '../constants/investigation.constants';

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

export {
    createInvestigationService
}
