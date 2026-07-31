import { Op } from 'sequelize';
import { HealthFacility } from '../models/healthFacility.model';
import { CatalogItem } from '../models/catalogItem.model';
import { GeoLocation } from '../models/geoLocation.model';
import { CatalogType } from '../models/catalogType.model';
import { AppError, getMessage } from '../helpers';
import { AuthUser, CreateHealthFacilityInput } from '../types';

// ESAIV-HF-001 - Create Health Facility Service
const createHealthFacilityService = async (data: CreateHealthFacilityInput, authUser?: AuthUser, lang: string = 'en') => {
    // Validate that the referenced GeoLocation exists and is active
    const geoLocation = await GeoLocation.findOne({
        where: {
            geoLocationId: data.geoLocationId,
            isActive: true
        }
    });
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'HF_001_GEOLOCATION_NOT_FOUND');
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
                //where: { code: 'FACILITY_TYPE' },
                attributes: []
            }]
        });
        if (!facilityType) {
            throw new AppError(getMessage('facilityType.notFound', lang), 404, 'HF_001_FACILITY_TYPE_NOT_FOUND');
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
            throw new AppError(getMessage('healthFacility.parentNotFound', lang), 404, 'HF_001_PARENT_HEALTH_FACILITY_NOT_FOUND');
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
            throw new AppError(getMessage('healthFacility.codeExists', lang, { code: data.localCode }), 400, 'HF_001_LOCAL_CODE_EXISTS');
        }
    }
    // Create the new health facility
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
        appDetails: [{
            createdAt: new Date(),
            user: authUser?.userId || 'unknown',
            method: 'ESAIV-HF-001',
            detail: 'Health facility created by service'
        }]
    });
    return newHealthFacility;
}

// ESAIV-HF-002 - Get Health Facilities by GeoLocation Service
const getHealthFacilitiesByGeoLocationService = async (geoLocationId: string, limit: number = 10, offset: number = 0) => {
    if (!geoLocationId) {
        throw new AppError(getMessage('geoLocation.idRequired', 'en'), 400, 'HF_002_GEOLOCATIONID_REQUIRED');
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

/*
// ESAVI-CATITEM-002A - Get Catalog Items by Catalog Type Service
const getActiveCatalogItemsByTypeService = async (catalogTypeId: string, limit: number = 10, offset: number = 0) => {
    if ( !catalogTypeId ) {
        throw new AppError(getMessage('catalogType.idRequired', 'en'), 400, 'CATITEM_002A_CATTYPEID_REQUIRED');
    }
    const catalogItems = await CatalogItem.findAndCountAll({
        where: { 
            catalogTypeId, 
            isActive: true 
        },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return catalogItems;
}

// ESAVI-CATITEM-002B - Get All Catalog Items by Catalog Type Service (including inactive) - For SuperAdmin
const getAllCatalogItemsByTypeService = async (catalogTypeId: string = '', limit: number = 10, offset: number = 0, isAdmin: boolean = false) => {
    let whereClause = {};
    if( isAdmin && catalogTypeId ) {
        whereClause = { catalogTypeId };
    } else if( !isAdmin && catalogTypeId ) {
        whereClause = { catalogTypeId, isActive: true };
    }
    const catalogItems = await CatalogItem.findAndCountAll({
        where: whereClause,
        order: [
            ['sortOrder', 'ASC'],
            ['name', 'ASC']
        ],
        limit,
        offset
    });
    return catalogItems;
}

// ESAVI-CATITEM-002C - Get Catalog Item by ID Service
const getCatalogItemByIdService = async (id: string, lang: string = 'en', isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { catalogItemId: id } : { catalogItemId: id, isActive: true };
    const catalogItem = await CatalogItem.findOne({ 
        where: whereClause 
    });
    if (!catalogItem) {
        throw new AppError(getMessage('catalogItem.notFound', lang), 404, 'CATITEM_001_NOT_FOUND');
    }
    return catalogItem;
}
*/

export {
    createHealthFacilityService,
    getHealthFacilitiesByGeoLocationService
}