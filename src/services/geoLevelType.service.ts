import { Op } from 'sequelize';
import { AppError } from '../helpers/appError.helper';
import { getMessage } from '../helpers/i18n.helper';
import { GeoLevelType } from '../models/geoLevelType.model';
import { AuthUser, CreateGeoLevelTypeInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// ESAVI-GEOTYPE-001 - Create Geographic Level Type Service
const createGeoLevelTypeService = async (data: CreateGeoLevelTypeInput, authUser?: AuthUser, lang: string = 'en') => {
    const { code } = data;
    const { userId } = authUser || {};
    const existingType = await GeoLevelType.findOne({
        where: { 
            code: code.trim().toLocaleUpperCase(),
            isActive: true
        }
    });
    if( existingType ) {
        throw new AppError(getMessage('geoLevelType.alreadyExists', lang,  { code: `${code.trim()}` } ), 409, 'GEOTYPE_001_ALREADY_EXISTS'); 
    }
    const newGeoLevelType = await GeoLevelType.create({
        code: data.code.trim().toLocaleUpperCase(),
        name: data.name.trim(),
        sortOrder: data.sortOrder,
        appDetails: [{
            'createdAt': new Date(),
            'user': userId || 'undefined',
            'method': 'ESAVI-GEOTYPE-001',
            'detail': 'GeoLevelType created by service'
        }]
    });
    return newGeoLevelType;
}

// ESAVI-GEOTYPE-002A - Get Active Geographic Level Types Service
const getActiveGeoLevelTypesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const geoLevelTypes = await GeoLevelType.findAndCountAll({
        where: { isActive: true },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return geoLevelTypes;
}

// ESAVI-GEOTYPE-002B - Get All Geographic Level Types Service (including inactive) - For SuperAdmin
const getAllGeoLevelTypesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const geoLevelTypes = await GeoLevelType.findAndCountAll({
        order: [
            ['sortOrder', 'ASC'],
            ['name', 'ASC']
        ],
        limit,
        offset
    });
    return geoLevelTypes;
}

// ESAVI-GEOTYPE-003 - Get Geographic Level Type by ID Service
const getGeoLevelTypeByIdService = async (id: string, lang: string = 'en', isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { geoLevelTypeId: id } : { geoLevelTypeId: id, isActive: true };
    const geoLevelType = await GeoLevelType.findOne({
        where: whereClause
    }); 
    if( !geoLevelType ) {
        throw new AppError(getMessage('geoLevelType.notFound', lang), 404, 'GEOTYPE_003_LEVEL_NOT_FOUND');
    }
    return geoLevelType;
}

// ESAVI-GEOTYPE-004 - Update Geographic Level Type Service - For SuperAdmin
const updateGeoLevelTypeService = async (id: string, data: Partial<CreateGeoLevelTypeInput>, authUser?: AuthUser, lang: string = 'en') => {
    const { userId } = authUser || {};
    const geoLevelType = await GeoLevelType.findByPk(id);
    let updatedGeoLevelType = geoLevelType;

    if (!geoLevelType) {
        throw new AppError(getMessage('geoLevelType.notFound', lang), 404, 'GEOTYPE_004_LEVEL_NOT_FOUND');
    }
    if(  data.code && data.code.trim().toLocaleUpperCase() !== geoLevelType.code ) {
        const existingType = await GeoLevelType.findOne({
            where: {
                code: data.code.trim().toLocaleUpperCase(),
                isActive: true,
                geoLevelTypeId: { [Op.ne]: id }
            }
        });
        if( existingType ) {
            throw new AppError(getMessage('geoLevelType.alreadyExists', lang,  { code: `${data.code.trim()}` } ), 409, 'GEOTYPE_004_ALREADY_EXISTS'); 
        }
    }
    
    const currentAppDetails = Array.isArray(geoLevelType.appDetails) ? geoLevelType.appDetails : [];
    let objectToUpdate = {
        code: data.code && data.code.trim().toLocaleUpperCase() !== geoLevelType.code ? data.code.trim().toLocaleUpperCase() : undefined,
        name: data.name && data.name.trim() !== geoLevelType.name ? data.name.trim() : undefined,
        sortOrder: data.sortOrder && data.sortOrder !== geoLevelType.sortOrder ? data.sortOrder : undefined,
    };
    if (objectToUpdate.code === undefined) delete objectToUpdate.code;
    if (objectToUpdate.name === undefined) delete objectToUpdate.name;
    if (objectToUpdate.sortOrder === undefined) delete objectToUpdate.sortOrder;
    if( Object.keys(objectToUpdate).length > 0 ) {
        updatedGeoLevelType = await geoLevelType.update({
            ...objectToUpdate, 
            appDetails: [
            ...currentAppDetails,
            {
                'createdAt': new Date(),
                'user': userId || 'undefined',
                'method': 'ESAVI-GEOTYPE-004',
                'detail': 'GeoLevelType updated by service'
            }
        ]
        }, {returning: true});
    } 

    return updatedGeoLevelType;
};

// ESAVI-GEOTYPE-005 - Setting Geographic Level Type Active/Inactive Service - For SuperAdmin
// This service will set isActive to false and append a deletion entry to appDetails. The record will not be removed from the database.
const setGeoLevelTypeActivationService = async (id: string, authUser?: AuthUser, lang: string = 'en', isActive: boolean = true) => {
    return setEntityActiveStatusService({
        model: GeoLevelType,
        where: { geoLevelTypeId: id, isActive: !isActive },
        isActive,
        lang,
        notFoundMessage: getMessage('geoLevelType.notFound', lang),
        notFoundCode: 'GEOTYPE_005_LEVEL_NOT_FOUND',
        appDetail: {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-GEOTYPE-005' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' ),
            detail: `GeoLevelType ${ isActive ? 'activated' : 'deactivated' } by service`
        }
    });  
}

export {
    createGeoLevelTypeService,
    getActiveGeoLevelTypesService,
    getAllGeoLevelTypesService,
    getGeoLevelTypeByIdService,
    updateGeoLevelTypeService,
    setGeoLevelTypeActivationService
};