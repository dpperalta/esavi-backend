import { Op } from 'sequelize';
import { getMessage, AppError, buildDifferentialUpdate, esaviLog } from '../helpers';
import { AppDetails, AuthUser, CreateGeoLocationInput } from '../types';
import { GeoLevelType, GeoLocation } from '../models';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { sequelize } from '../database/connection';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// ESAVI-GEOLOC-001 - Create Geographic Location Service
const createGeoLocationService = async( data: CreateGeoLocationInput, authUser: AuthUser | undefined, lang: string ) => {
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
                externalCode: data.externalCode.trim()
            }
        });
        if( existingLocation ) {
            throw new AppError(getMessage('geoLocation.externalCodeExists', lang, { code: data.externalCode }), 409, 'GEOLOC_001_EXTERNAL_CODE_EXISTS');
        }
    }
    // The name must be unique among the siblings of the same parent - UQ_geoLocation_parent_name
    if( data.parentGeoLocationId ) {
        const existingSibling = await GeoLocation.findOne({
            where: {
                parentGeoLocationId: data.parentGeoLocationId,
                name: data.name.trim()
            }
        });
        if( existingSibling ) {
            throw new AppError(getMessage('geoLocation.alreadyExists', lang, { code: data.name.trim() }), 409, 'GEOLOC_001_NAME_EXISTS');
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
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-GEOLOC-001',
        detail: 'Geographic location created by service'
    };
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
        appDetails: [newEntry]
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
const getGeoLocationByIdService = async (id: string, lang: string, isAdmin: boolean = false) => {
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
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'GEOLOC_003_NOT_FOUND');
    }
    return geoLocation;
}

// ESAVI-GEOLOC-004 - Update Geographic Location Service - For SuperAdmin
const updateGeoLocationService = async (id: string, data: Partial<CreateGeoLocationInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const geoLocation = await GeoLocation.findByPk(id);
    const { externalCode, name, shortName, officialName, isoCode, latitude, longitude, geoPolygon, sortOrder, geoLevelTypeId, parentGeoLocationId } = data;
    let updatedGeoLocation = geoLocation;
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'GEOLOC_004_NOT_FOUND');
    }
    // Validate the referenced Geographic Level Type when it comes in the payload
    if( geoLevelTypeId && geoLevelTypeId !== geoLocation.geoLevelTypeId ) {
        const geoLevelType = await GeoLevelType.findOne({
            where: {
                geoLevelTypeId,
                isActive: true
            }
        });
        if( !geoLevelType ) {
            throw new AppError(getMessage('geoLevelType.notFound', lang), 404, 'GEOLOC_004_GEOLEVELTYPE_NOT_FOUND');
        }
    }
    // Validate the referenced parent location when it comes in the payload
    if( parentGeoLocationId && parentGeoLocationId !== geoLocation.parentGeoLocationId ) {
        const parent = await GeoLocation.findOne({
            where: {
                geoLocationId: parentGeoLocationId,
                isActive: true
            }
        });
        if( !parent ) {
            throw new AppError(getMessage('geoLocation.parentNotFound', lang), 404, 'GEOLOC_004_PARENT_GEOLOCATION_NOT_FOUND');
        }
    }
    if( externalCode && externalCode.trim() !== geoLocation.externalCode ) {
        const existingLocation = await GeoLocation.findOne({
            where: {
                externalCode: externalCode.trim(),
                geoLocationId: { [Op.ne]: id }
            }
        });
        if( existingLocation ) {
            throw new AppError(getMessage('geoLocation.alreadyExists', lang, { code: externalCode.trim() }), 409, 'GEOLOC_004_EXTERNAL_CODE_EXISTS');
        }
    }
    // The name must be unique among the siblings of the target parent - UQ_geoLocation_parent_name
    const targetParentId = parentGeoLocationId ?? geoLocation.parentGeoLocationId;
    const targetName = name ? name.trim() : geoLocation.name;
    if( targetParentId && ( targetName !== geoLocation.name || targetParentId !== geoLocation.parentGeoLocationId ) ) {
        const existingSibling = await GeoLocation.findOne({
            where: {
                parentGeoLocationId: targetParentId,
                name: targetName,
                geoLocationId: { [Op.ne]: id }
            }
        });
        if( existingSibling ) {
            throw new AppError(getMessage('geoLocation.alreadyExists', lang, { code: targetName }), 409, 'GEOLOC_004_NAME_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(geoLocation.appDetails) ? geoLocation.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. `stored` is the whole
    // row, which is the precondition of the helper. latitude and longitude are DECIMAL(10, 7)
    // and `pg` hands them back as strings — '-0.2299000' against the -0.2299 that arrives in the
    // body — so comparing them with !== was always true and every PUT rewrote the coordinates.
    // The helper compares them numerically
    const stored = geoLocation.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        geoLevelTypeId: geoLevelTypeId ? geoLevelTypeId : undefined,
        parentGeoLocationId: parentGeoLocationId ? parentGeoLocationId : undefined,
        name: name ? name.trim() : undefined,
        officialName: officialName ? officialName.trim() : undefined,
        shortName: shortName ? shortName.trim() : undefined,
        isoCode: isoCode ? isoCode.trim() : undefined,
        externalCode: externalCode ? externalCode.trim() : undefined,
        latitude: latitude ? latitude : undefined,
        longitude: longitude ? longitude : undefined,
        geoPolygon: geoPolygon ? geoPolygon : undefined,
        sortOrder: sortOrder ? sortOrder : undefined
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if( Object.keys(objectToUpdate).length > 0 ) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-GEOLOC-004',
            detail: 'Geographic location updated by service'
        };
        updatedGeoLocation = await geoLocation.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, {returning: true});
    }
    return updatedGeoLocation;
}

// ESAVI-GEOLOC-005A / 005B - Setting Geographic Location Active/Inactive Service
const setGeoLocationActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const geoLocation = await setEntityActiveStatusService({
            model: GeoLocation,
            where: { geoLocationId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('geoLocation.notFound', lang),
            notFoundCode: `GEOLOC_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`geoLocation.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `GEOLOC_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-GEOLOC-${ op }`,
                detail: `Geographic location ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return geoLocation;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createGeoLocationService,
    getActiveGeoLocationsService,
    getAllGeoLocationsService,
    getGeoLocationByIdService,
    updateGeoLocationService,
    setGeoLocationActivationService
}