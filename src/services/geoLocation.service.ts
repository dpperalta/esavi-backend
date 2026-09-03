import { Op } from 'sequelize';
import { getMessage, AppError, buildDifferentialUpdate, buildGeoTemplateWorkbook, esaviLog, escapeLike } from '../helpers';
import { AppDetails, AuthUser, CreateGeoLocationInput, GenerateGeoTemplateInput } from '../types';
import { CatalogItem, CatalogType, GeoLevelType, GeoLocation, HealthFacility } from '../models';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { sequelize } from '../database/connection';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Code of the catalogType that groups the valid facility types, the same one healthFacility.service
// reads: the template mirrors that catalog and the 006 resolves facilityTypeCode against it
const HEALTH_FACILITY_TYPE_CATALOG_CODE = 'healthFacilityType';

/**
 * Shared precheck of ESAVI-GEOLOC-006 and ESAVI-GEOLOC-007. Runs before reading the file in the 006
 * and before querying anything in the 007, because both operations rest on the same invariant: the
 * `level` of the file resolves its geoLevelType through sortOrder, one level per number, starting at
 * 1 and with no gaps.
 *
 * geoLevelType is not seeded by esaviapp.sql — administrative levels belong to each country and the
 * deployment is multi-country — so on a freshly created base, which is exactly the scenario of a
 * first load, there are no levels at all. Without this check the template would come out with an
 * empty dropdown and every row would be rejected after somebody filled in the whole file.
 *
 * The actionable detail travels in `message` and not in `errors`: errorHandler only puts real text
 * in errors when NODE_ENV=development, so in production the operator would read 'Internal server
 * error' and not know what to fix. That is why these are three interpolated keys and not one.
 *
 * Returns the level -> geoLevelTypeId map, which is the only thing the rest of the operation uses.
 */
const assertGeoLevelTypesReady = async ( codePrefix: string, lang: string ): Promise<Map<number, string>> => {
    const geoLevelTypes = await GeoLevelType.findAll({
        where: { isActive: true },
        order: [ [ 'sortOrder', 'ASC' ] ]
    });
    if( geoLevelTypes.length === 0 ) {
        throw new AppError(getMessage('geoLocation.levelTypesMissing', lang), 409, `${ codePrefix }_LEVEL_TYPES_MISSING`);
    }
    // Two active levels sharing a sortOrder make the resolution non-deterministic: a row of level 2
    // would resolve to whichever of the two the order happened to return first
    const seen = new Set<number>();
    const duplicated: number[] = [];
    for( const geoLevelType of geoLevelTypes ) {
        const sortOrder = Number(geoLevelType.sortOrder);
        if( seen.has(sortOrder) && !duplicated.includes(sortOrder) ) {
            duplicated.push(sortOrder);
        }
        seen.add(sortOrder);
    }
    if( duplicated.length > 0 ) {
        throw new AppError(
            getMessage('geoLocation.levelTypesDuplicatedOrder', lang, { orders: duplicated.join(', ') }),
            409,
            `${ codePrefix }_LEVEL_TYPES_DUPLICATED_ORDER`
        );
    }
    // The series has to run 1, 2, 3... with no gap: a hole at 3 would leave every row of level 3
    // rejected and every level below it orphaned, which is a whole branch lost for one missing row
    const orders = [ ...seen ].sort(( a, b ) => a - b);
    const expected = orders.findIndex(( order, index ) => order !== index + 1);
    if( expected !== -1 ) {
        throw new AppError(
            getMessage('geoLocation.levelTypesNotContiguous', lang, { expected: String(expected + 1) }),
            409,
            `${ codePrefix }_LEVEL_TYPES_NOT_CONTIGUOUS`
        );
    }
    return new Map(geoLevelTypes.map(( geoLevelType ) => [ Number(geoLevelType.sortOrder), geoLevelType.geoLevelTypeId ]));
};

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

const buildTextWhereConditions = (name?: string, code?: string) => {
    const textConditions: any[] = [];
    if( name ) {
        textConditions.push({ name: { [Op.iLike]: `%${ escapeLike(name.trim()) }%` } });
    }
    if( code ) {
        const codePattern = `%${ escapeLike(code.trim()) }%`;
        textConditions.push({
            [Op.or]: [
                { externalCode: { [Op.iLike]: codePattern } },
                { isoCode: { [Op.iLike]: codePattern } }
            ]
        });
    }
    return textConditions;
}

// ESAVI-GEOLOC-002A - Get active Geographic Location service
const getActiveGeoLocationsService = async (
    geoLevelTypeId?: string,
    parentGeoLocationId?: string,
    name?: string,
    code?: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const whereClause: any = { isActive: true };
    if( geoLevelTypeId ) {
        whereClause.geoLevelTypeId = geoLevelTypeId;
    }
    if( parentGeoLocationId ) {
        whereClause.parentGeoLocationId = parentGeoLocationId;
    }
    const textConditions = buildTextWhereConditions(name, code);
    if( textConditions.length > 0 ) {
        whereClause[Op.or] = textConditions;
    }
    const geoLocations = await GeoLocation.findAndCountAll({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return geoLocations;
}

// ESAVI-GEOLOC-002B - Get all Geographic Location service (including inactive) - For SuperAdmin
const getAllGeoLocationsService = async (
    geoLevelTypeId?: string,
    parentGeoLocationId?: string,
    name?: string,
    code?: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const whereClause: any = {};
    if( geoLevelTypeId ) {
        whereClause.geoLevelTypeId = geoLevelTypeId;
    }
    if( parentGeoLocationId ) {
        whereClause.parentGeoLocationId = parentGeoLocationId;
    }
    const textConditions = buildTextWhereConditions(name, code);
    if( textConditions.length > 0 ) {
        whereClause[Op.or] = textConditions;
    }
    const geoLocations = await GeoLocation.findAndCountAll({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
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
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
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

// ESAVI-GEOLOC-007 - Generate Geographic Import Template Service
//
// Four phases: the shared precheck, the catalogs that feed the dropdowns, the dump of what is
// already loaded — only when includeExisting travels — and the construction of the book.
//
// It returns the Buffer and not an envelope: the 200 of this operation is the binary, which is the
// declared exception to CONVENTIONS.md §10 and the reason it has no success i18n key. Its errors do
// travel in the usual envelope, which is what keeps the deviation to a single path.
const generateGeoTemplateService = async ( data: GenerateGeoTemplateInput, authUser: AuthUser | undefined, lang: string ): Promise<Buffer> => {
    // Phase 0. A 409 here stops anybody from filling in a book that could not then be loaded
    await assertGeoLevelTypesReady('GEOLOC_007', lang);
    // Phase 1. The levels are read again for their name: the precheck hands back the id map, which
    // is what the 006 needs, and the template needs the label the operator reads in the dropdown
    const geoLevelTypes = await GeoLevelType.findAll({
        where: { isActive: true },
        attributes: [ 'sortOrder', 'name' ],
        order: [ [ 'sortOrder', 'ASC' ] ]
    });
    // An empty facility type catalog is NOT an error: sheet 2 comes out with an empty dropdown and
    // the fact is visible. Blocking a load of geography over the facility catalog would be a false
    // positive
    const facilityTypeItems = await CatalogItem.findAll({
        where: { isActive: true },
        attributes: [ 'code', 'name' ],
        include: [ {
            model: CatalogType,
            as: 'catalogType',
            where: { code: HEALTH_FACILITY_TYPE_CATALOG_CODE },
            attributes: []
        } ],
        order: [ [ 'name', 'ASC' ] ]
    });
    // Phase 2. Only when asked, and only active rows — with independence of the role. What is being
    // decided is not visibility but what is reimportable, and an inactive row coming back in the
    // file would be updated without being reactivated, an effect nobody asked for. canViewInactive
    // therefore does not take part here
    let geoLocations: GeoLocation[] = [];
    let healthFacilities: HealthFacility[] = [];
    if( data.includeExisting ) {
        geoLocations = await GeoLocation.findAll({
            where: { isActive: true },
            include: [ { model: GeoLocation, as: 'parent', attributes: [ 'externalCode' ] } ],
            order: [ [ 'level', 'ASC' ], [ 'sortOrder', 'ASC' ], [ 'name', 'ASC' ] ]
        });
        healthFacilities = await HealthFacility.findAll({
            where: { isActive: true },
            include: [
                { model: GeoLocation, as: 'geoLocation', attributes: [ 'externalCode' ] },
                { model: HealthFacility, as: 'parent', attributes: [ 'localCode' ] },
                { model: CatalogItem, as: 'facilityType', attributes: [ 'code' ] }
            ],
            order: [ [ 'name', 'ASC' ] ]
        });
    }
    // Phase 3. The builder is pure: it receives what was queried here and returns the buffer
    return await buildGeoTemplateWorkbook({
        levels: geoLevelTypes.map(( geoLevelType ) => ({
            level: Number(geoLevelType.sortOrder),
            name: geoLevelType.name
        })),
        facilityTypes: facilityTypeItems.map(( item ) => ({ code: item.code, name: item.name })),
        // parentCode travels as the parent's externalCode and never as its UUID: it has to be the
        // same value the 006 reads back, or a file downloaded and re-uploaded untouched would
        // produce PARENT_CHANGED on every row
        geoLocations: geoLocations.map(( row ) => ({
            externalCode: row.externalCode ?? null,
            name: row.name,
            level: row.level === null || row.level === undefined ? null : Number(row.level),
            parentCode: ( row as GeoLocation & { parent?: { externalCode: string | null } } ).parent?.externalCode ?? null,
            officialName: row.officialName ?? null,
            shortName: row.shortName ?? null,
            isoCode: row.isoCode ?? null,
            latitude: row.latitude ?? null,
            longitude: row.longitude ?? null,
            sortOrder: row.sortOrder === null || row.sortOrder === undefined ? null : Number(row.sortOrder)
        })),
        healthFacilities: healthFacilities.map(( row ) => {
            const joined = row as HealthFacility & {
                geoLocation?: { externalCode: string | null };
                parent?: { localCode: string | null };
                facilityType?: { code: string | null };
            };
            return {
                localCode: row.localCode ?? null,
                name: row.name,
                geoExternalCode: joined.geoLocation?.externalCode ?? null,
                facilityTypeCode: joined.facilityType?.code ?? null,
                officialName: row.officialName ?? null,
                shortName: row.shortName ?? null,
                address: row.address ?? null,
                latitude: row.latitude ?? null,
                longitude: row.longitude ?? null,
                phone: row.phone ?? null,
                email: row.email ?? null,
                parentLocalCode: joined.parent?.localCode ?? null
            };
        })
    });
}

export {
    assertGeoLevelTypesReady,
    generateGeoTemplateService,
    createGeoLocationService,
    getActiveGeoLocationsService,
    getAllGeoLocationsService,
    getGeoLocationByIdService,
    updateGeoLocationService,
    setGeoLocationActivationService
}