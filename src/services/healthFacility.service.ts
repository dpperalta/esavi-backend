import { CatalogItem, CatalogType, GeoLocation, HealthFacility } from '../models';
import { AppError, getMessage, toConstantCase, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateHealthFacilityInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Code of the catalogType that groups the valid facility types.
// Must match the value enforced by the TRG_healthFacility_validateCatalogs trigger in esaviapp.sql
const HEALTH_FACILITY_TYPE_CATALOG_CODE = 'healthFacilityType';

// ESAVI-HFAC-001 - Create Health Facility Service
const createHealthFacilityService = async (data: CreateHealthFacilityInput, authUser: AuthUser | undefined, lang: string) => {
    // Validate that the referenced GeoLocation exists and is active
    const geoLocation = await GeoLocation.findOne({
        where: {
            geoLocationId: data.geoLocationId,
            isActive: true
        }
    });
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'HFAC_001_GEOLOCATION_NOT_FOUND');
    }
    // Validate that the referenced CatalogItem for facility type exists and is active
    if (data.facilityTypeItemId) {
        const facilityType = await CatalogItem.findOne({
            where: {
                catalogItemId: data.facilityTypeItemId,
                isActive: true
            },
            include: [{
                model: CatalogType,
                as: 'catalogType',
                where: { code: HEALTH_FACILITY_TYPE_CATALOG_CODE },
                attributes: []
            }]
        });
        if (!facilityType) {
            throw new AppError(getMessage('healthFacility.facilityTypeNotFound', lang), 404, 'HFAC_001_FACILITY_TYPE_NOT_FOUND');
        }
    }
    // If parentHealthFacilityId is provided, validate that the parent health facility exists and is active
    if (data.parentHealthFacilityId) {
        const parentHealthFacility = await HealthFacility.findOne({
            where: {
                healthFacilityId: data.parentHealthFacilityId,
                isActive: true
            }
        });
        if (!parentHealthFacility) {
            throw new AppError(getMessage('healthFacility.parentNotFound', lang), 404, 'HFAC_001_PARENT_HEALTH_FACILITY_NOT_FOUND');
        }
    }
    // Validate the local code uniqueness. The UQ_healthFacility_localCode constraint is global,
    // so the check must not be scoped by geoLocationId, and it runs against the normalized value
    const localCode = data.localCode ? toConstantCase(data.localCode.trim()) : null;
    if (localCode) {
        const existingLocalCode = await HealthFacility.findOne({
            where: { localCode }
        });
        if (existingLocalCode) {
            throw new AppError(getMessage('healthFacility.codeExists', lang, { code: localCode }), 409, 'HFAC_001_LOCAL_CODE_EXISTS');
        }
    }
    // Create the new health facility
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-HFAC-001',
        detail: 'Health facility created by service'
    };
    const newHealthFacility = await HealthFacility.create({
        geoLocationId: data.geoLocationId,
        facilityTypeItemId: data.facilityTypeItemId ?? null,
        parentHealthFacilityId: data.parentHealthFacilityId ?? null,
        localCode,
        name: toTitleCase(data.name.trim()),
        officialName: data.officialName || null,
        shortName: data.shortName || null,
        address: data.address || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        phone: data.phone || null,
        email: data.email || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return newHealthFacility;
}

// ESAVI-HFAC-002A - Get Active Health Facilities by GeoLocation Service
const getHealthFacilitiesByGeoLocationService = async (geoLocationId: string, lang: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    if (!geoLocationId) {
        throw new AppError(getMessage('geoLocation.idRequired', lang), 400, 'HFAC_002A_GEOLOCATIONID_REQUIRED');
    }
    const healthFacilities = await HealthFacility.findAndCountAll({
        where: {
            geoLocationId,
            isActive: true
        },
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return healthFacilities;
}

export {
    createHealthFacilityService,
    getHealthFacilitiesByGeoLocationService
}