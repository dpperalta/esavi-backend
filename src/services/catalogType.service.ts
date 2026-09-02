import { Op } from 'sequelize';
import { CatalogType } from '../models/catalogType.model';
import { CatalogItem } from '../models/catalogItem.model';
import { AppError, buildDifferentialUpdate, buildTextSearchConditions, getMessage, toCodeFromInput, toCodeFromName, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CatalogTypeListFilters, CreateCatalogTypeInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { sequelize } from '../database/connection';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// varchar(100) of catalogType.code against varchar(200) of catalogType.name. A legal name can mint
// an illegal code, and that has to end in a 400 and not in the 500 the column would raise
const MAX_CODE_LENGTH = 100;

/**
 * The code of a catalogType. It comes from the body when the client sends one — normalized into
 * camelCase with toCodeFromInput, which is idempotent, so resending the stored code writes the same
 * value — and only when it is absent is it minted from the name with toCodeFromName.
 * Either source can fail to produce a usable code: text made only of separators mints an empty one,
 * and text long enough overflows the column. Both end in a 400, with a message that names the
 * source the operator actually sent.
 */
const resolveCatalogTypeCode = ( source: string, fromBody: boolean, operation: string, lang: string ): string => {
    const code = fromBody ? toCodeFromInput(source) : toCodeFromName(source);

    if( code.length === 0 || code.length > MAX_CODE_LENGTH ) {
        throw new AppError(
            getMessage(fromBody ? 'catalogType.codeNotValid' : 'catalogType.codeNotDerivable', lang, {
                code: source.trim(),
                name: source.trim()
            }),
            400,
            `CATTYPE_${ operation }_CODE_NOT_${ fromBody ? 'VALID' : 'DERIVABLE' }`
        );
    }

    return code;
}

// The code of a body that may or may not carry one. Null means the body brought no code: the 001
// falls back to the name and the 004 leaves the stored code untouched
const codeFromBody = ( data: Partial<CreateCatalogTypeInput>, operation: string, lang: string ): string | null => {
    if( typeof data.code !== 'string' || data.code.trim().length === 0 ) {
        return null;
    }
    return resolveCatalogTypeCode(data.code, true, operation, lang);
}

// ESAVI-CATTYPE-001 - Create Catalog Type Service
const createCatalogTypeService = async (data: CreateCatalogTypeInput, authUser: AuthUser | undefined, lang: string) => {
    const code = codeFromBody(data, '001', lang) ?? resolveCatalogTypeCode(data.name, false, '001', lang);
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

// Shared by both listings. name and code are the canonical parameters (SPEC F52), joined with
// Op.or — the entity had no text filter of its own before this spec
const buildCatalogTypeWhere = (filters: CatalogTypeListFilters): Record<string, unknown> => {
    const where: Record<string, unknown> = {};
    const textConditions = [
        ...buildTextSearchConditions(filters.name, ['name']),
        ...buildTextSearchConditions(filters.code, ['code'])
    ];
    if (textConditions.length > 0) {
        where[Op.or as unknown as string] = textConditions;
    }
    return where;
}

// ESAVI-CATTYPE-002A - Get Catalog Types Service
const getActiveCatalogTypesService = async (filters: CatalogTypeListFilters = {}, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const catalogTypes = await CatalogType.findAndCountAll({
        where: {
            ...buildCatalogTypeWhere(filters),
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return catalogTypes;
}

// ESAVI-CATTYPE-002B - Get All Catalog Types Service (including inactive) - For SuperAdmin
const getAllCatalogTypesService = async (filters: CatalogTypeListFilters = {}, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const catalogTypes = await CatalogType.findAndCountAll({
        where: buildCatalogTypeWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
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
            where: whereClause,
            // sysDetails is internal and never exposed by the API
            attributes: { exclude: ['sysDetails'] }
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
    // The code is written exactly when it travels in the body, and it is never re-minted from a
    // name that changed: renaming a type does not move its code, which is what other tables and the
    // importer resolve against
    const targetCode = codeFromBody(data, '004', lang) ?? undefined;
    if( targetCode && targetCode !== catalogType.code ) {
        const existingType = await CatalogType.findOne({
            where: {
                code: targetCode,
                catalogTypeId: { [Op.ne]: id }
            }
        });
        if( existingType ) {
            throw new AppError(getMessage('catalogType.codeExists', lang, { code: targetCode }), 409, 'CATTYPE_004_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(catalogType.appDetails) ? catalogType.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. `stored` is the whole
    // row, which is the precondition of the helper
    const stored = catalogType.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        code: targetCode,
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