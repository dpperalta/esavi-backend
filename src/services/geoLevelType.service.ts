import { Op } from 'sequelize';
import { AppError } from '../helpers/appError.helper';
import { buildDifferentialUpdate } from '../helpers/differentialUpdate.helper';
import { getMessage } from '../helpers/i18n.helper';
import { GeoLevelType } from '../models/geoLevelType.model';
import { AppDetails, AuthUser, CreateGeoLevelTypeInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { sequelize } from '../database/connection';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// ESAVI-GEOTYPE-001 - Create Geographic Level Type Service
const createGeoLevelTypeService = async (data: CreateGeoLevelTypeInput, authUser: AuthUser | undefined, lang: string) => {
    const { code } = data;
    const { userId } = authUser || {};
    const existingType = await GeoLevelType.findOne({
        where: {
            code: code.trim().toLocaleUpperCase()
        }
    });
    if( existingType ) {
        throw new AppError(getMessage('geoLevelType.alreadyExists', lang,  { code: `${code.trim()}` } ), 409, 'GEOTYPE_001_CODE_EXISTS');
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: userId || 'undefined',
        method: 'ESAVI-GEOTYPE-001',
        detail: 'GeoLevelType created by service'
    };
    const newGeoLevelType = await GeoLevelType.create({
        code: data.code.trim().toLocaleUpperCase(),
        name: data.name.trim(),
        sortOrder: data.sortOrder,
        appDetails: [newEntry]
    });
    return newGeoLevelType;
}

// ESAVI-GEOTYPE-002A - Get Active Geographic Level Types Service
const getActiveGeoLevelTypesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const geoLevelTypes = await GeoLevelType.findAndCountAll({
        where: { isActive: true },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return geoLevelTypes;
}

// ESAVI-GEOTYPE-002B - Get All Geographic Level Types Service (including inactive) - For SuperAdmin
const getAllGeoLevelTypesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const geoLevelTypes = await GeoLevelType.findAndCountAll({
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
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
const getGeoLevelTypeByIdService = async (id: string, lang: string, isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { geoLevelTypeId: id } : { geoLevelTypeId: id, isActive: true };
    const geoLevelType = await GeoLevelType.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if( !geoLevelType ) {
        throw new AppError(getMessage('geoLevelType.notFound', lang), 404, 'GEOTYPE_003_NOT_FOUND');
    }
    return geoLevelType;
}

// ESAVI-GEOTYPE-004 - Update Geographic Level Type Service - For SuperAdmin
const updateGeoLevelTypeService = async (id: string, data: Partial<CreateGeoLevelTypeInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const geoLevelType = await GeoLevelType.findByPk(id);
    let updatedGeoLevelType = geoLevelType;

    if (!geoLevelType) {
        throw new AppError(getMessage('geoLevelType.notFound', lang), 404, 'GEOTYPE_004_NOT_FOUND');
    }
    if(  data.code && data.code.trim().toLocaleUpperCase() !== geoLevelType.code ) {
        const existingType = await GeoLevelType.findOne({
            where: {
                code: data.code.trim().toLocaleUpperCase(),
                geoLevelTypeId: { [Op.ne]: id }
            }
        });
        if( existingType ) {
            throw new AppError(getMessage('geoLevelType.alreadyExists', lang,  { code: `${data.code.trim()}` } ), 409, 'GEOTYPE_004_CODE_EXISTS');
        }
    }
    
    const currentAppDetails = Array.isArray(geoLevelType.appDetails) ? geoLevelType.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. `stored` is the whole
    // row, which is the precondition of the helper
    const stored = geoLevelType.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        code: data.code ? data.code.trim().toLocaleUpperCase() : undefined,
        name: data.name ? data.name.trim() : undefined,
        sortOrder: data.sortOrder ? data.sortOrder : undefined
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if( Object.keys(objectToUpdate).length > 0 ) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-GEOTYPE-004',
            detail: 'GeoLevelType updated by service'
        };
        updatedGeoLevelType = await geoLevelType.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, {returning: true});
    }

    return updatedGeoLevelType;
};

// ESAVI-GEOTYPE-005A / 005B - Setting Geographic Level Type Active/Inactive Service - For SuperAdmin
// This service will set isActive to false and append a deletion entry to appDetails. The record will not be removed from the database.
const setGeoLevelTypeActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const geoLevelType = await setEntityActiveStatusService({
            model: GeoLevelType,
            where: { geoLevelTypeId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('geoLevelType.notFound', lang),
            notFoundCode: `GEOTYPE_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`geoLevelType.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `GEOTYPE_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-GEOTYPE-${ op }`,
                detail: `GeoLevelType ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return geoLevelType;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createGeoLevelTypeService,
    getActiveGeoLevelTypesService,
    getAllGeoLevelTypesService,
    getGeoLevelTypeByIdService,
    updateGeoLevelTypeService,
    setGeoLevelTypeActivationService
};