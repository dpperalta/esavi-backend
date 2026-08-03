import { Op } from 'sequelize';
import { HealthFacility } from '../models/healthFacility.model';
import { CatalogItem } from '../models/catalogItem.model';
import { GeoLocation } from '../models/geoLocation.model';
import { CatalogType } from '../models/catalogType.model';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateHealthFacilityInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

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
                //where: { code: 'FACILITY_TYPE' },
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
    // Validate the local code uniqueness within the same geoLocationId
    if (data.localCode) {
        const existingLocalCode = await HealthFacility.findOne({
            where: {
                localCode: data.localCode,
                geoLocationId: data.geoLocationId
            }
        });
        if (existingLocalCode) {
            throw new AppError(getMessage('healthFacility.codeExists', lang, { code: data.localCode }), 409, 'HFAC_001_LOCAL_CODE_EXISTS');
        }
    }
    // Create the new health facility
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'unknown',
        method: 'ESAVI-HFAC-001',
        detail: 'Health facility created by service'
    };
    const newHealthFacility = await HealthFacility.create({
        geoLocationId: data.geoLocationId,
        facilityTypeItemId: data.facilityTypeItemId ?? null,
        parentHealthFacilityId: data.parentHealthFacilityId ?? null,
        localCode: data.localCode || 'NC_' + Date.now(),
        name: data.name,
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

// ESAVI-HFAC-002 - Get Health Facilities by GeoLocation Service
const getHealthFacilitiesByGeoLocationService = async (geoLocationId: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    if (!geoLocationId) {
        throw new AppError(getMessage('geoLocation.idRequired', 'en'), 400, 'HFAC_002_GEOLOCATIONID_REQUIRED');
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