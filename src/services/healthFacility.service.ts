import { Op } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, GeoLocation, HealthFacility } from '../models';
import { AppError, getMessage, toConstantCase, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateHealthFacilityInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Code of the catalogType that groups the valid facility types.
// Must match the value enforced by the TRG_healthFacility_validateCatalogs trigger in esaviapp.sql
const HEALTH_FACILITY_TYPE_CATALOG_CODE = 'healthFacilityType';

// Upper bound for the ancestor walk. Guards against an infinite loop if the stored data
// already contains a cycle, which the SQL CHECK constraint cannot detect
const MAX_HIERARCHY_DEPTH = 50;

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

// ESAVI-HFAC-002B - Get All Health Facilities by GeoLocation Service - For Admin
const getAllHealthFacilitiesByGeoLocationService = async (geoLocationId: string, lang: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    if (!geoLocationId) {
        throw new AppError(getMessage('geoLocation.idRequired', lang), 400, 'HFAC_002B_GEOLOCATIONID_REQUIRED');
    }
    const healthFacilities = await HealthFacility.findAndCountAll({
        where: {
            geoLocationId
        },
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return healthFacilities;
}

// ESAVI-HFAC-003 - Get Health Facility by ID Service
const getHealthFacilityByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const whereClause = includeInactive ? { healthFacilityId: id } : { healthFacilityId: id, isActive: true };
    const healthFacility = await HealthFacility.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        include: [
            {
                model: GeoLocation,
                as: 'geoLocation',
                attributes: ['geoLocationId', 'name', 'level']
            },
            {
                model: CatalogItem,
                as: 'facilityType',
                attributes: ['catalogItemId', 'code', 'name']
            },
            {
                model: HealthFacility,
                as: 'parent',
                attributes: ['healthFacilityId', 'name', 'localCode']
            },
            {
                model: HealthFacility,
                as: 'children',
                attributes: ['healthFacilityId', 'name', 'localCode', 'isActive'],
                // Inactive children are only listed for users allowed to see them
                where: includeInactive ? undefined : { isActive: true },
                required: false
            }
        ],
        order: [[{ model: HealthFacility, as: 'children' }, 'name', 'ASC']]
    });
    if (!healthFacility) {
        throw new AppError(getMessage('healthFacility.notFound', lang), 404, 'HFAC_003_NOT_FOUND');
    }
    return healthFacility;
}

// ESAVI-HFAC-004 - Update Health Facility Service
const updateHealthFacilityService = async (id: string, data: Partial<CreateHealthFacilityInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const { geoLocationId, facilityTypeItemId, parentHealthFacilityId, localCode, name, officialName, shortName, address, latitude, longitude, phone, email } = data;
    const healthFacility = await HealthFacility.findByPk(id);
    let updatedHealthFacility = healthFacility;
    if (!healthFacility) {
        throw new AppError(getMessage('healthFacility.notFound', lang), 404, 'HFAC_004_NOT_FOUND');
    }
    // Validate the referenced GeoLocation when it comes in the payload
    if (geoLocationId && geoLocationId !== healthFacility.geoLocationId) {
        const geoLocation = await GeoLocation.findOne({
            where: {
                geoLocationId,
                isActive: true
            }
        });
        if (!geoLocation) {
            throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'HFAC_004_GEOLOCATION_NOT_FOUND');
        }
    }
    // Validate the referenced facility type when it comes in the payload
    if (facilityTypeItemId && facilityTypeItemId !== healthFacility.facilityTypeItemId) {
        const facilityType = await CatalogItem.findOne({
            where: {
                catalogItemId: facilityTypeItemId,
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
            throw new AppError(getMessage('healthFacility.facilityTypeNotFound', lang), 404, 'HFAC_004_FACILITY_TYPE_NOT_FOUND');
        }
    }
    // Validate the new parent: it must exist, be active, not be the facility itself and not be one of its descendants
    if (parentHealthFacilityId && parentHealthFacilityId !== healthFacility.parentHealthFacilityId) {
        const parentHealthFacility = await HealthFacility.findOne({
            where: {
                healthFacilityId: parentHealthFacilityId,
                isActive: true
            }
        });
        if (!parentHealthFacility) {
            throw new AppError(getMessage('healthFacility.parentNotFound', lang), 404, 'HFAC_004_PARENT_HEALTH_FACILITY_NOT_FOUND');
        }
        if (parentHealthFacilityId === id) {
            throw new AppError(getMessage('healthFacility.selfParent', lang), 409, 'HFAC_004_SELF_PARENT');
        }
        // Walking up from the new parent must never reach the facility being updated: that would close a cycle.
        // The SQL CHECK only rejects the direct self-parent case, so A -> B -> A is detected here
        const visited = new Set<string>([id]);
        let ancestorId: string | null | undefined = parentHealthFacilityId;
        let hops = 0;
        while (ancestorId) {
            if (visited.has(ancestorId) || hops >= MAX_HIERARCHY_DEPTH) {
                throw new AppError(getMessage('healthFacility.circularParent', lang), 409, 'HFAC_004_CIRCULAR_PARENT');
            }
            visited.add(ancestorId);
            const ancestor: HealthFacility | null = await HealthFacility.findByPk(ancestorId, { attributes: ['parentHealthFacilityId'] });
            ancestorId = ancestor?.parentHealthFacilityId ?? null;
            hops++;
        }
    }
    // The UQ_healthFacility_localCode constraint is global, so the check is not scoped by geoLocation
    // and it excludes the record being updated
    const targetLocalCode = localCode ? toConstantCase(localCode.trim()) : undefined;
    if (targetLocalCode && targetLocalCode !== healthFacility.localCode) {
        const existingLocalCode = await HealthFacility.findOne({
            where: {
                localCode: targetLocalCode,
                healthFacilityId: { [Op.ne]: id }
            }
        });
        if (existingLocalCode) {
            throw new AppError(getMessage('healthFacility.codeExists', lang, { code: targetLocalCode }), 409, 'HFAC_004_LOCAL_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(healthFacility.appDetails) ? healthFacility.appDetails : [];
    const objectToUpdate = {
        geoLocationId: geoLocationId && geoLocationId !== healthFacility.geoLocationId ? geoLocationId : undefined,
        facilityTypeItemId: facilityTypeItemId && facilityTypeItemId !== healthFacility.facilityTypeItemId ? facilityTypeItemId : undefined,
        parentHealthFacilityId: parentHealthFacilityId && parentHealthFacilityId !== healthFacility.parentHealthFacilityId ? parentHealthFacilityId : undefined,
        localCode: targetLocalCode && targetLocalCode !== healthFacility.localCode ? targetLocalCode : undefined,
        name: name && toTitleCase(name.trim()) !== healthFacility.name ? toTitleCase(name.trim()) : undefined,
        officialName: officialName && officialName.trim() !== healthFacility.officialName ? officialName.trim() : undefined,
        shortName: shortName && shortName.trim() !== healthFacility.shortName ? shortName.trim() : undefined,
        address: address && address.trim() !== healthFacility.address ? address.trim() : undefined,
        latitude: latitude && latitude !== healthFacility.latitude ? latitude : undefined,
        longitude: longitude && longitude !== healthFacility.longitude ? longitude : undefined,
        phone: phone && phone.trim() !== healthFacility.phone ? phone.trim() : undefined,
        email: email && email.trim() !== healthFacility.email ? email.trim() : undefined,
    };
    if (objectToUpdate.geoLocationId === undefined) delete objectToUpdate.geoLocationId;
    if (objectToUpdate.facilityTypeItemId === undefined) delete objectToUpdate.facilityTypeItemId;
    if (objectToUpdate.parentHealthFacilityId === undefined) delete objectToUpdate.parentHealthFacilityId;
    if (objectToUpdate.localCode === undefined) delete objectToUpdate.localCode;
    if (objectToUpdate.name === undefined) delete objectToUpdate.name;
    if (objectToUpdate.officialName === undefined) delete objectToUpdate.officialName;
    if (objectToUpdate.shortName === undefined) delete objectToUpdate.shortName;
    if (objectToUpdate.address === undefined) delete objectToUpdate.address;
    if (objectToUpdate.latitude === undefined) delete objectToUpdate.latitude;
    if (objectToUpdate.longitude === undefined) delete objectToUpdate.longitude;
    if (objectToUpdate.phone === undefined) delete objectToUpdate.phone;
    if (objectToUpdate.email === undefined) delete objectToUpdate.email;
    if (Object.keys(objectToUpdate).length > 0) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-HFAC-004',
            detail: 'Health facility updated by service'
        };
        updatedHealthFacility = await healthFacility.update({
            ...objectToUpdate,
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, { returning: true });
    }
    return updatedHealthFacility;
}

// ESAVI-HFAC-005A / 005B - Setting Health Facility Active/Inactive Service
const setHealthFacilityActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // A deactivated parent with active children leaves the hierarchy in a state no listing can represent
        if (!isActive) {
            const activeChildren = await HealthFacility.count({
                where: {
                    parentHealthFacilityId: id,
                    isActive: true
                },
                transaction
            });
            if (activeChildren > 0) {
                throw new AppError(getMessage('healthFacility.hasActiveChildren', lang), 409, 'HFAC_005A_HAS_ACTIVE_CHILDREN');
            }
        }
        const healthFacility = await setEntityActiveStatusService({
            model: HealthFacility,
            where: { healthFacilityId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('healthFacility.notFound', lang),
            notFoundCode: `HFAC_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`healthFacility.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `HFAC_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-HFAC-${ op }`,
                detail: `HealthFacility ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return healthFacility;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createHealthFacilityService,
    getHealthFacilitiesByGeoLocationService,
    getAllHealthFacilitiesByGeoLocationService,
    getHealthFacilityByIdService,
    updateHealthFacilityService,
    setHealthFacilityActivationService
}