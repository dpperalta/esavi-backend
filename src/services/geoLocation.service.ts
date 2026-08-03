import { Op } from 'sequelize';
import { getMessage, AppError, esaviLog } from '../helpers';
import { AuthUser, CreateGeoLocationInput } from '../types';
import { GeoLevelType, GeoLocation } from '../models';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// ESAVI-GEOLOC-001 - Create Geographic Location Service
const createGeoLocationService = async( data: CreateGeoLocationInput, authUser?: AuthUser, lang: string = 'en' ) => {
    const geoLevelType = await GeoLevelType.findOne({
        where: {
            geoLevelTypeId: data.geoLevelTypeId,
            isActive: true
        }
    });
    if( !geoLevelType ) {
        throw new AppError(getMessage('geoLevelType.notFound', lang), 404, 'GEOLOC_001_GEOLEVELTYPE_NOT_FOUND');
    }
    let parent: GeoLocation | null = null;
    if( data.parentGeoLocationId ) {
        parent = await GeoLocation.findOne({
            where: {
                geoLocationId: data.parentGeoLocationId,
                isActive: true
            }
        });
        if( !parent ) {
            throw new AppError(getMessage('geoLocation.parentNotFound', lang), 404, 'GEOLOC_001_PARENT_GEOLOCATION_NOT_FOUND');
        }
    }
    const calculatedLevel = data.level ?? (parent ? Number(parent.level) + 1 : 1);
    if( data.externalCode ){
        const existingLocation = await GeoLocation.findOne({
            where: {
                externalCode: data.externalCode.trim(),
                isActive: true
            }
        });
        if( existingLocation ) {
            throw new AppError(getMessage('geoLocation.externalCodeExists', lang, { code: data.externalCode }), 400, 'GEOLOC_001_EXTERNAL_CODE_EXISTS');
        }
    }
    let sortOrder: number | null = null;
    if( data.sortOrder !== undefined ) {
        sortOrder = data.sortOrder;
    } else {
        const maxSortOrder = await GeoLocation.max('sortOrder', {
            where: {
                geoLevelTypeId: data.geoLevelTypeId,
                parentGeoLocationId: data.parentGeoLocationId ?? null
            }
        });
        sortOrder = Number(maxSortOrder ?? 0) + 1;
    }
    const createdLocation = await GeoLocation.create({
        geoLevelTypeId: data.geoLevelTypeId,
        parentGeoLocationId: data.parentGeoLocationId ?? null,
        name: data.name.trim(),
        officialName: data.officialName ? data.officialName.trim() : null,
        shortName: data.shortName ? data.shortName.trim() : null,
        isoCode: data.isoCode ? data.isoCode.trim() : null,
        externalCode: data.externalCode ? data.externalCode.trim() : '',
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        sortOrder: sortOrder ?? undefined,
        level: calculatedLevel,
        geoPolygon: data.geoPolygon ?? null,
        appDetails: [
            {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-GEOLOC-001',
                detail: 'Geographic location created by service'
            }
        ]
    });
    return createdLocation;
}

// ESAVI-GEOLOC-002A - Get active Geographic Location service
const getActiveGeoLocationsService = async (geoLevelTypeId?: string, parentGeoLocationId?: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const whereClause: any = { isActive: true };
    if( geoLevelTypeId ) {
        whereClause.geoLevelTypeId = geoLevelTypeId;
    }
    if( parentGeoLocationId ) {
        whereClause.parentGeoLocationId = parentGeoLocationId;
    }
    const geoLocations = await GeoLocation.findAndCountAll({
        where: whereClause,
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return geoLocations;
}

// ESAVI-GEOLOC-002B - Get all Geographic Location service (including inactive) - For SuperAdmin
const getAllGeoLocationsService = async (geoLevelTypeId?: string, parentGeoLocationId?: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const whereClause: any = {};
    if( geoLevelTypeId ) {
        whereClause.geoLevelTypeId = geoLevelTypeId;
    }
    if( parentGeoLocationId ) {
        whereClause.parentGeoLocationId = parentGeoLocationId;
    }
    const geoLocations = await GeoLocation.findAndCountAll({
        where: whereClause,
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return geoLocations;
}

// ESAVI-GEOLOC-003 - Get Geographic Location by ID service
const getGeoLocationByIdService = async (id: string, lang: string = 'en', isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { geoLocationId: id } : { geoLocationId: id, isActive: true };
    const geoLocation = await GeoLocation.findOne({
        where: whereClause,
        include: [
            {
                model: GeoLevelType,
                as: 'geoLevelType',
                attributes: ['geoLevelTypeId', 'code', 'name']
            },
            {
                model: GeoLocation,
                as: 'parent',
                attributes: ['geoLocationId', 'name', 'level', 'externalCode']
            },
            {
                model: GeoLocation,
                as: 'children',
                attributes: ['geoLocationId', 'name', 'level', 'externalCode'],
            }
        ]
    });
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound'), 404, 'GEOLOC_003_LOCATION_NOT_FOUND');
    }
    return geoLocation;
}

// ESAVI-GEOLOC-004 - Update Geographic Location Service - For SuperAdmin
const updateGeoLocationService = async (id: string, data: Partial<CreateGeoLocationInput>, authUser?: AuthUser, lang: string = 'en') => {
    const { userId } = authUser || {};
    const geoLocation = await GeoLocation.findByPk(id);
    const { externalCode, name, shortName, officialName, isoCode, latitude, longitude, geoPolygon, sortOrder } = data;
    let updatedGeoLocation = geoLocation;
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'GEOLOC_004_LOCATION_NOT_FOUND');
    }
    if( externalCode && externalCode.trim() !== geoLocation.externalCode ) {
        const existingLocation = await GeoLocation.findOne({
            where: {
                externalCode: externalCode.trim(),
                isActive: true,
                geoLocationId: { [Op.ne]: id }
            }
        });
        if( existingLocation ) {
            throw new AppError(getMessage('geoLocation.alreadyExists', lang, { code: externalCode.trim() }), 400, 'GEOLOC_004_EXTERNAL_CODE_EXISTS'); 
        }
    }
    const currentAppDetails = Array.isArray(geoLocation.appDetails) ? geoLocation.appDetails : [];
    let objectToUpdate = {
        name: name && name.trim() !== geoLocation.name ? name.trim() : undefined,
        officialName: officialName && officialName.trim() !== geoLocation.officialName ? officialName.trim() : undefined,
        shortName: shortName && shortName.trim() !== geoLocation.shortName ? shortName.trim() : undefined,
        isoCode: isoCode && isoCode.trim() !== geoLocation.isoCode ? isoCode.trim() : undefined,
        externalCode: externalCode && externalCode.trim() !== geoLocation.externalCode ? externalCode.trim() : undefined,
        latitude: latitude && latitude !== geoLocation.latitude ? latitude : undefined,
        longitude: longitude && longitude !== geoLocation.longitude ? longitude : undefined,
        geoPolygon: geoPolygon && JSON.stringify(geoPolygon) !== JSON.stringify(geoLocation.geoPolygon) ? geoPolygon : undefined,
        sortOrder: sortOrder && sortOrder !== geoLocation.sortOrder ? sortOrder : undefined,
    };
    if (objectToUpdate.name === undefined) delete objectToUpdate.name;
    if (objectToUpdate.officialName === undefined) delete objectToUpdate.officialName;
    if (objectToUpdate.shortName === undefined) delete objectToUpdate.shortName;
    if (objectToUpdate.isoCode === undefined) delete objectToUpdate.isoCode;
    if (objectToUpdate.externalCode === undefined) delete objectToUpdate.externalCode;
    if (objectToUpdate.latitude === undefined) delete objectToUpdate.latitude;
    if (objectToUpdate.longitude === undefined) delete objectToUpdate.longitude;
    if (objectToUpdate.geoPolygon === undefined) delete objectToUpdate.geoPolygon;
    if (objectToUpdate.sortOrder === undefined) delete objectToUpdate.sortOrder;
    if( Object.keys(objectToUpdate).length > 0 ) {
        updatedGeoLocation = await geoLocation.update({
            ...objectToUpdate, 
            appDetails: [
            ...currentAppDetails,
            {
                'createdAt': new Date(),
                'user': userId || 'undefined',
                'method': 'ESAVI-GEOLOC-004',
                'detail': 'Geographic location updated by service'
            }
        ]
        }, {returning: true});
        console.log('ACTUALIZA');
    }
    return updatedGeoLocation;
}

// ESAVI-GEOLOC-005 - Setting Geographic Location Active/Inactive Service
const setGeoLocationActivationService = async (id: string, authUser?: AuthUser, lang: string = 'en', isActive: boolean = true) => {
    return setEntityActiveStatusService({
        model: GeoLocation,
        where: { geoLocationId: id, isActive: !isActive },
        isActive,
        notFoundMessage: getMessage('geoLocation.notFound', lang),
        notFoundCode: 'GEOLOC_005_LOCATION_NOT_FOUND',
        appDetail: {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-GEOLOC-005' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' ),
            detail: `Geographic location ${ isActive ? 'activated' : 'deactivated' } by service`
        }
    });

}

export {
    createGeoLocationService,
    getActiveGeoLocationsService,
    getAllGeoLocationsService,
    getGeoLocationByIdService,
    updateGeoLocationService,
    setGeoLocationActivationService
}