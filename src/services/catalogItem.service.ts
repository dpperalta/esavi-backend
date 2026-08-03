import { Op } from "sequelize";
import { AppError, getMessage, toConstantCase, toTitleCase } from "../helpers";
import { CatalogItem, CatalogType } from "../models";
import { AuthUser, CreateCatalogItem } from "../types";
import { setEntityActiveStatusService } from "./common/entityActivation.service";
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from "../constants/pagination.constants";

// ESAVI-CATITEM-001 - Create Catalog Item Service
const createCatalogItemService = async (data: CreateCatalogItem, authUser?: AuthUser, lang: string = 'en') => {
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
            throw new AppError(getMessage('catalogItem.codeExists', lang, { code }), 400, 'CATITEM_001_CODE_EXISTS');
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
    const createdItem = await CatalogItem.create({
        catalogTypeId: data.catalogTypeId,
        code: code ? code : 'NO_CODE_' + Date.now(),
        name: toTitleCase(data.name.trim()),
        value: data.value.trim(),
        description: data.description ? data.description.trim() : null,
        metadata: data.metadata || {},
        sortOrder,
        appDetails: [
            {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-CATITEM-001',
                detail: 'Catalog item created by service'
            }
        ]
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

// ESAVI-CATITEM-003 - Update Catalog Item Service - For SuperAdmin
const updateCatalogItemService = async (id: string, data: Partial<CreateCatalogItem>, authUser?: AuthUser, lang: string = 'en') => {
    const { userId } = authUser || {};
    const catalogItem = await CatalogItem.findByPk(id);
    let updatedCatalogItem = catalogItem;
    if (!catalogItem) {
        throw new AppError(getMessage('catalogItem.notFound', lang), 404, 'CATITEM_003_NOT_FOUND');
    }
    if( data.code && toConstantCase(data.code.trim()) !== catalogItem.code ) {
        const existingItem = await CatalogItem.findOne({
            where: {
                code: toConstantCase(data.code.trim()),
                catalogTypeId: catalogItem.catalogTypeId,
                isActive: true,
                catalogItemId: { [Op.ne]: id }
            }
        });
        if( existingItem ) {
            throw new AppError(getMessage('catalogItem.codeExists', lang), 409, 'CATITEM_003_CODE_EXISTS'); 
        }
    }
    const currentAppDetails = Array.isArray(catalogItem.appDetails) ? catalogItem.appDetails : [];
    let objectToUpdate = {
        code: data.code && toConstantCase(data.code.trim()) !== catalogItem.code ? toConstantCase(data.code.trim()) : undefined,
        name: data.name && toTitleCase(data.name.trim()) !== catalogItem.name ? toTitleCase(data.name.trim()) : undefined,
        value: data.value && data.value.trim() !== catalogItem.value ? data.value.trim() : undefined,
        description: data.description && data.description.trim() !== catalogItem.description ? data.description.trim() : undefined,
        metadata: data.metadata && JSON.stringify(data.metadata) !== JSON.stringify(catalogItem.metadata) ? data.metadata : undefined,
        sortOrder: data.sortOrder && data.sortOrder !== catalogItem.sortOrder ? data.sortOrder : undefined,
    };
    if (objectToUpdate.code === undefined) delete objectToUpdate.code;
    if (objectToUpdate.name === undefined) delete objectToUpdate.name;
    if (objectToUpdate.value === undefined) delete objectToUpdate.value;
    if (objectToUpdate.description === undefined) delete objectToUpdate.description;
    if (objectToUpdate.metadata === undefined) delete objectToUpdate.metadata;
    if (objectToUpdate.sortOrder === undefined) delete objectToUpdate.sortOrder;
    if( Object.keys(objectToUpdate).length > 0 ) {
        updatedCatalogItem = await catalogItem.update({
            ...objectToUpdate,
            appDetails: [
                ...currentAppDetails,
                {
                    'createdAt': new Date(),
                    'user': userId || 'undefined',
                    'method': 'ESAVI-CATITEM-003',
                    'detail': 'Catalog item updated by service'
                }
            ]
        }, {returning: true});
    }
    return updatedCatalogItem;
}

// ESAVI-CATITEM-004 - Setting Catalog Item Active/Inactive Service - For SuperAdmin
const setCatalogItemActivationService = async (id: string, authUser?: AuthUser, lang: string = 'en', isActive: boolean = true) => {
    return setEntityActiveStatusService({
        model: CatalogItem,
        where: { catalogItemId: id, isActive: !isActive },
        isActive,
        notFoundMessage: getMessage('catalogItem.notFound', lang),
        notFoundCode: 'CATITEM_004_NOT_FOUND',
        appDetail: {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-CATITEM-004' + ( isActive ? 'B_ACTIVATION' : 'A_DEACTIVATION' ),
            detail: `CatalogItem ${ isActive ? 'activated' : 'deactivated' } by service`
        }
    });  
}

export {
    createCatalogItemService,
    getActiveCatalogItemsByTypeService,
    getAllCatalogItemsByTypeService,
    getCatalogItemByIdService,
    updateCatalogItemService,
    setCatalogItemActivationService
}