import { Op } from 'sequelize';
import { CatalogType } from '../models/catalogType.model';
import { CatalogItem } from '../models/catalogItem.model';
import { AppError, buildDifferentialUpdate, getMessage, toCamelCase, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateCatalogTypeInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { sequelize } from '../database/connection';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// ESAVI-CATTYPE-001 - Create Catalog Type Service
const createCatalogTypeService = async (data: CreateCatalogTypeInput, authUser: AuthUser | undefined, lang: string) => {
    const code = toCamelCase(data.code.trim());
    const existing = await CatalogType.findOne({ where: { code } });
    if (existing) {
        throw new AppError(getMessage('catalogType.codeExists', lang, { code }), 409, 'CATTYPE_001_CODE_EXISTS');
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'unknown',
        method: 'ESAVI-CATTYPE-001',
        detail: 'CatalogType created by service'
    };
    const newCatalogType = await CatalogType.create({
        code,
        name: toTitleCase(data.name.trim()),
        description: data.description?.trim() || null,
        sortOrder: data.sortOrder || 0,
        appDetails: [newEntry]
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

// ESAVI-CATTYPE-003 - Get Catalog Type by ID Service
const getCatalogTypeByIdService = async (id: string, lang: string, isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { catalogTypeId: id } : { catalogTypeId: id, isActive: true };
        const catalogType = await CatalogType.findOne({
            where: whereClause
        }); 
        if( !catalogType ) {
            throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATTYPE_003_NOT_FOUND');
        }
        return catalogType;
}

// ESAVI-CATTYPE-004 - Update Catalog Type Service - For SuperAdmin
const updateCatalogTypeService = async (id: string, data: Partial<CreateCatalogTypeInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const catalogType = await CatalogType.findByPk(id);
    let updatedCatalogType = catalogType;

    if (!catalogType) {
        throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATTYPE_004_NOT_FOUND');
    }
    if( data.code && toCamelCase(data.code.trim()) !== catalogType.code ) {
        const existingType = await CatalogType.findOne({
            where: {
                code: toCamelCase(data.code.trim()),
                catalogTypeId: { [Op.ne]: id }
            }
        });
        if( existingType ) {
            throw new AppError(getMessage('catalogType.codeExists', lang, { code: toCamelCase(data.code.trim()) }), 409, 'CATTYPE_004_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(catalogType.appDetails) ? catalogType.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. `stored` is the whole
    // row, which is the precondition of the helper
    const stored = catalogType.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        code: data.code ? toCamelCase(data.code.trim()) : undefined,
        name: data.name ? toTitleCase(data.name.trim()) : undefined,
        description: data.description ? data.description.trim() : undefined,
        sortOrder: data.sortOrder ? data.sortOrder : undefined
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if( Object.keys(objectToUpdate).length > 0 ) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-CATTYPE-004',
            detail: 'CatalogType updated by service'
        };
        updatedCatalogType = await catalogType.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, {returning: true});
    }
    return updatedCatalogType;
}

// ESAVI-CATTYPE-005A / 005B - Setting Catalog Type Active/Inactive Service - For SuperAdmin
const setCatalogTypeActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const catalogType = await setEntityActiveStatusService({
            model: CatalogType,
            where: { catalogTypeId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('catalogType.notFound', lang),
            notFoundCode: `CATTYPE_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`catalogType.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `CATTYPE_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-CATTYPE-${ op }`,
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