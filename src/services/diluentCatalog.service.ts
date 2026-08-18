import { Op, WhereOptions } from 'sequelize';
import { DiluentCatalog } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { AppDetails, AuthUser, CreateDiluentCatalogInput, DiluentCatalogListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The two nullable text columns of the entity, trimmed on write and never normalized any further.
// undefined and null both land as null on create: an absent field and an explicitly emptied one mean
// the same thing when the row does not exist yet
const trimOrNull = (value?: string | null): string | null =>
    value !== undefined && value !== null ? value.trim() : null;

// sysDetails is internal trigger state and never leaves the service. The reads drop it through
// `attributes: { exclude }`, which a create cannot use, so the returned instance is flattened and
// stripped here — the response shape of §3.7 is the eleven columns minus this one
const stripSysDetails = (diluent: DiluentCatalog): Record<string, unknown> => {
    const plain = diluent.get({ plain: true }) as Record<string, unknown>;
    delete plain.sysDetails;
    return plain;
}

// Shared by both listings, which take exactly the same single filter. search is an Op.iLike over
// name and stays confined to these two services: the real use case is the autocomplete of the
// notification form, and an autocomplete needs prefixes and fragments. There is no other filter —
// the table has no column that could serve as a facet
const buildDiluentCatalogWhere = (filters: DiluentCatalogListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if (filters.search) {
        where.name = { [Op.iLike]: `%${filters.search.trim()}%` };
    }
    return where;
}

// ESAVI-DILUENT-001 - Create Diluent Catalog Service
const createDiluentCatalogService = async (data: CreateDiluentCatalogInput, authUser: AuthUser | undefined, lang: string) => {
    // Normalized before the uniqueness check, with the same function the 004 uses: the constraint of
    // the DDL is over the stored value, so asking about the raw one would let AGUA_DESTILADA in twice
    const code = toConstantCase(data.code.trim());
    // The only unique column of the table, global and over a single column. The check does not
    // filter by isActive: a code taken by a deactivated row is still taken, and the UNIQUE of the
    // DDL knows nothing about isActive — filtering here would turn a 409 into a 500 when the
    // database rejected the INSERT
    const existingDiluent = await DiluentCatalog.findOne({
        where: { code },
        attributes: ['diluentCatalogId']
    });
    if (existingDiluent) {
        throw new AppError(getMessage('diluentCatalog.codeExists', lang, { code }), 409, 'DILUENT_001_CODE_EXISTS');
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-DILUENT-001',
        detail: 'Diluent catalog entry created by service'
    };
    const newDiluentCatalog = await DiluentCatalog.create({
        code,
        // Only trimmed, never toTitleCase: toTitleCase would turn 'Cloruro de sodio 0.9%' into
        // 'Cloruro De Sodio 0.9%' and 'Agua para inyección' into 'Agua Para Inyección'. A
        // pharmaceutical product name carries lowercase prepositions and concentrations that are not
        // recapitalized. The asymmetry with code is deliberate: the code is an identifier the
        // application mints, the name is text the user writes
        name: data.name.trim(),
        description: trimOrNull(data.description),
        composition: trimOrNull(data.composition),
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return stripSysDetails(newDiluentCatalog);
}

// ESAVI-DILUENT-002A - Get Active Diluent Catalogs Service
const getActiveDiluentCatalogsService = async (filters: DiluentCatalogListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const diluentCatalogs = await DiluentCatalog.findAndCountAll({
        where: {
            ...buildDiluentCatalogWhere(filters),
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return diluentCatalogs;
}

export {
    createDiluentCatalogService,
    getActiveDiluentCatalogsService
};
