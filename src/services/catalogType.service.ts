import { Op } from 'sequelize';
import { CatalogType } from '../models/catalogType.model';
import { CatalogItem } from '../models/catalogItem.model';
import { AppError, getMessage, toCamelCase, toTitleCase } from '../helpers';
import { AuthUser, CreateCatalogTypeInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { sequelize } from '../database/connection';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// ESAVI-CATTYPE-001 - Create Catalog Type Service
const createCatalogTypeService = async (data: CreateCatalogTypeInput, authUser?: AuthUser, lang: string = 'en') => {
    const code = toCamelCase(data.code.trim());
    const existing = await CatalogType.findOne({ where: { code } });
    if (existing) {
        throw new AppError(getMessage('catalogType.codeExists', lang), 409, 'CATTYPE_001_CODE_EXISTS');
    }
    const newCatalogType = await CatalogType.create({
        code,
        name: toTitleCase(data.name.trim()),
        description: data.description?.trim() || null,
        sortOrder: data.sortOrder || 0,
        appDetails: [{
            createdAt: new Date(),
            user: authUser?.userId || 'unknown',
            method: 'ESAVI-CATTYPE-001',
            detail: 'CatalogType created by service'
        }]
    });
    return newCatalogType;
}

// ESAVI-CATTYPE-002A - Get Catalog Types Service
const getActiveCatalogTypesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const catalogTypes = await CatalogType.findAndCountAll({
        where: { isActive: true },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return catalogTypes;
}

// ESAVI-CATTYPE-002B - Get All Catalog Types Service (including inactive) - For SuperAdmin
const getAllCatalogTypesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const catalogTypes = await CatalogType.findAndCountAll({
        order: [
            ['sortOrder', 'ASC'],
            ['name', 'ASC']
        ],
        limit,
        offset
    });
    return catalogTypes;
}

// ESAVI-CATTYPE-002C - Get Catalog Type by ID Service
const getCatalogTypeByIdService = async (id: string, lang: string = 'en', isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { catalogTypeId: id } : { catalogTypeId: id, isActive: true };
        const catalogType = await CatalogType.findOne({
            where: whereClause
        }); 
        if( !catalogType ) {
            throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATTYPE_002C_NOT_FOUND');
        }
        return catalogType;
}

// ESAVI-CATTYPE-003 - Update Catalog Type Service - For SuperAdmin
const updateCatalogTypeService = async (id: string, data: Partial<CreateCatalogTypeInput>, authUser?: AuthUser, lang: string = 'en') => {
    const { userId } = authUser || {};
    const catalogType = await CatalogType.findByPk(id);
    let updatedCatalogType = catalogType;

    if (!catalogType) {
        throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATTYPE_003_NOT_FOUND');
    }
    if( data.code && toCamelCase(data.code.trim()) !== catalogType.code ) {
        const existingType = await CatalogType.findOne({
            where: {
                code: toCamelCase(data.code.trim()),
                catalogTypeId: { [Op.ne]: id }
            }
        });
        if( existingType ) {
            throw new AppError(getMessage('catalogType.codeExists', lang), 409, 'CATTYPE_003_CODE_EXISTS'); 
        }
    }
    const currentAppDetails = Array.isArray(catalogType.appDetails) ? catalogType.appDetails : [];
    let objectToUpdate = {
        code: data.code && toCamelCase(data.code.trim()) !== catalogType.code ? toCamelCase(data.code.trim()) : undefined,
        name: data.name && toTitleCase(data.name.trim()) !== catalogType.name ? toTitleCase(data.name.trim()) : undefined,
        description: data.description && data.description.trim() !== catalogType.description ? data.description.trim() : undefined,
        sortOrder: data.sortOrder && data.sortOrder !== catalogType.sortOrder ? data.sortOrder : undefined,
    };
    if (objectToUpdate.code === undefined) delete objectToUpdate.code;
    if (objectToUpdate.name === undefined) delete objectToUpdate.name;
    if (objectToUpdate.description === undefined) delete objectToUpdate.description;
    if (objectToUpdate.sortOrder === undefined) delete objectToUpdate.sortOrder;
    if( Object.keys(objectToUpdate).length > 0 ) {
        updatedCatalogType = await catalogType.update({
            ...objectToUpdate, 
            appDetails: [
            ...currentAppDetails,
            {
                'createdAt': new Date(),
                'user': userId || 'undefined',
                'method': 'ESAVI-CATTYPE-003',
                'detail': 'CatalogType updated by service'
            }
        ]
        }, {returning: true});
    }
    return updatedCatalogType;
}

// ESAVI-CATTYPE-004 - Setting Catalog Type Active/Inactive Service - For SuperAdmin
const setCatalogTypeActivationService = async (id: string, authUser?: AuthUser, lang: string = 'en', isActive: boolean = true) => {
    const transaction = await sequelize.transaction();
    try {
        const catalogType = await setEntityActiveStatusService({
            model: CatalogType,
            where: { catalogTypeId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('catalogType.notFound', lang),
            notFoundCode: 'CATTYPE_004_NOT_FOUND',
            alreadyInStateMessage: getMessage(`catalogType.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: 'CATTYPE_004' + ( isActive ? 'B_ALREADY_ACTIVE' : 'A_ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-CATTYPE-004' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' ),
                detail: `CatalogType ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return catalogType;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}


export {
    createCatalogTypeService,
    getActiveCatalogTypesService,
    getAllCatalogTypesService,
    getCatalogTypeByIdService,
    updateCatalogTypeService,
    setCatalogTypeActivationService
}