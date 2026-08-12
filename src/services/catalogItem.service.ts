import { Op } from "sequelize";
import { AppError, buildDifferentialUpdate, getMessage, toConstantCase, toTitleCase } from "../helpers";
import { sequelize } from "../database/connection";
import { CatalogItem, CatalogType } from "../models";
import { AppDetails, AuthUser, CreateCatalogItemInput } from "../types";
import { setEntityActiveStatusService } from "./common/entityActivation.service";
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from "../constants/pagination.constants";

// ESAVI-CATITEM-001 - Create Catalog Item Service
const createCatalogItemService = async (data: CreateCatalogItemInput, authUser: AuthUser | undefined, lang: string) => {
    // Validate that the referenced Catalog Type exists and is active
    const catalogType = await CatalogType.findOne({
        where: {
            catalogTypeId: data.catalogTypeId,
            isActive: true
        }
    });
    if (!catalogType) {
        throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATITEM_001_CATTYPE_NOT_FOUND');
    }
    const catalogTypeId = data.catalogTypeId;
    const code = data.code ? toConstantCase(data.code.trim()) : null;
    // If code is provided, validate that it's unique within the same Catalog Type
    if (code) {
        const existingItem = await CatalogItem.findOne({
            where: {
                catalogTypeId,
                code: code
            }
        });
        if (existingItem) {
            throw new AppError(getMessage('catalogItem.codeExists', lang, { code }), 409, 'CATITEM_001_CODE_EXISTS');
        }
    }
    // Defining sortOrder: if provided in the request, use it. Otherwise, set it to max existing sortOrder + 1 for the same catalogTypeId
    let sortOrder: number | null = null;
    if( data.sortOrder !== undefined ) {
        sortOrder = data.sortOrder;
    } else {
        const maxSortOrder = await CatalogItem.max('sortOrder', {
            where: {
                catalogTypeId: data.catalogTypeId,
            }
        });
        sortOrder = Number(maxSortOrder ?? 0) + 1;
    }
    // Create the Catalog Item
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CATITEM-001',
        detail: 'Catalog item created by service'
    };
    const createdItem = await CatalogItem.create({
        catalogTypeId: data.catalogTypeId,
        code: code ? code : 'NO_CODE_' + Date.now(),
        name: toTitleCase(data.name.trim()),
        value: data.value.trim(),
        description: data.description ? data.description.trim() : null,
        metadata: data.metadata || {},
        sortOrder,
        appDetails: [newEntry]
    });
    return createdItem;
}

// ESAVI-CATITEM-002A - Get Catalog Items by Catalog Type Service
const getActiveCatalogItemsByTypeService = async (catalogTypeId: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
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
const getAllCatalogItemsByTypeService = async (catalogTypeId: string = '', limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET, isAdmin: boolean = false) => {
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

// ESAVI-CATITEM-003 - Get Catalog Item by ID Service
const getCatalogItemByIdService = async (id: string, lang: string, isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { catalogItemId: id } : { catalogItemId: id, isActive: true };
    const catalogItem = await CatalogItem.findOne({ 
        where: whereClause 
    });
    if (!catalogItem) {
        throw new AppError(getMessage('catalogItem.notFound', lang), 404, 'CATITEM_003_NOT_FOUND');
    }
    return catalogItem;
}

// ESAVI-CATITEM-004 - Update Catalog Item Service - For SuperAdmin
const updateCatalogItemService = async (id: string, data: Partial<CreateCatalogItemInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const catalogItem = await CatalogItem.findByPk(id);
    let updatedCatalogItem = catalogItem;
    if (!catalogItem) {
        throw new AppError(getMessage('catalogItem.notFound', lang), 404, 'CATITEM_004_NOT_FOUND');
    }
    // Validate that the referenced Catalog Type exists and is active before moving the item
    let targetCatalogTypeId = catalogItem.catalogTypeId;
    if( data.catalogTypeId && data.catalogTypeId !== catalogItem.catalogTypeId ) {
        const catalogType = await CatalogType.findOne({
            where: {
                catalogTypeId: data.catalogTypeId,
                isActive: true
            }
        });
        if (!catalogType) {
            throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATITEM_004_CATTYPE_NOT_FOUND');
        }
        targetCatalogTypeId = data.catalogTypeId;
    }
    // The code must be unique within the target Catalog Type, which may differ from the current one
    const targetCode = data.code ? toConstantCase(data.code.trim()) : catalogItem.code;
    if( targetCode && ( targetCode !== catalogItem.code || targetCatalogTypeId !== catalogItem.catalogTypeId ) ) {
        const existingItem = await CatalogItem.findOne({
            where: {
                code: targetCode,
                catalogTypeId: targetCatalogTypeId,
                catalogItemId: { [Op.ne]: id }
            }
        });
        if( existingItem ) {
            throw new AppError(getMessage('catalogItem.codeExists', lang), 409, 'CATITEM_004_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(catalogItem.appDetails) ? catalogItem.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. The comparison lives in
    // buildDifferentialUpdate, whose stored side has to be the whole row — findByPk reads it
    // without narrowed attributes, which is the precondition of the helper
    const stored = catalogItem.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        catalogTypeId: targetCatalogTypeId,
        code: data.code ? toConstantCase(data.code.trim()) : undefined,
        name: data.name ? toTitleCase(data.name.trim()) : undefined,
        value: data.value ? data.value.trim() : undefined,
        description: data.description ? data.description.trim() : undefined,
        metadata: data.metadata ? data.metadata : undefined,
        sortOrder: data.sortOrder ? data.sortOrder : undefined
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if( Object.keys(objectToUpdate).length > 0 ) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-CATITEM-004',
            detail: 'Catalog item updated by service'
        };
        updatedCatalogItem = await catalogItem.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, {returning: true});
    }
    return updatedCatalogItem;
}

// ESAVI-CATITEM-005A / 005B - Setting Catalog Item Active/Inactive Service - For SuperAdmin
const setCatalogItemActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const catalogItem = await setEntityActiveStatusService({
            model: CatalogItem,
            where: { catalogItemId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('catalogItem.notFound', lang),
            notFoundCode: `CATITEM_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`catalogItem.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `CATITEM_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-CATITEM-${ op }`,
                detail: `CatalogItem ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return catalogItem;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createCatalogItemService,
    getActiveCatalogItemsByTypeService,
    getAllCatalogItemsByTypeService,
    getCatalogItemByIdService,
    updateCatalogItemService,
    setCatalogItemActivationService
}