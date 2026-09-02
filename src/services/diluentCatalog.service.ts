import { Op, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiluentCatalog } from '../models';
import { AppError, buildDifferentialUpdate, buildTextSearchConditions, getMessage, toConstantCase } from '../helpers';
import { AppDetails, AuthUser, CreateDiluentCatalogInput, DiluentCatalogListFilters } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
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
    const [nameCondition] = buildTextSearchConditions(filters.search, ['name']);
    if (nameCondition) {
        Object.assign(where, nameCondition);
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

// ESAVI-DILUENT-002B - Get All Diluent Catalogs Service (including inactive) - For Admin
const getAllDiluentCatalogsService = async (filters: DiluentCatalogListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The twin of 002A without isActive in the where, and with no filter of its own: the table has
    // no column that could serve as a facet, so there is nothing an admin listing could add
    const diluentCatalogs = await DiluentCatalog.findAndCountAll({
        where: buildDiluentCatalogWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['name', 'ASC']],
        limit,
        offset
    });
    return diluentCatalogs;
}

// ESAVI-DILUENT-003 - Get Diluent Catalog by ID Service
const getDiluentCatalogByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const whereClause = includeInactive ? { diluentCatalogId: id } : { diluentCatalogId: id, isActive: true };
    // No includes: the entity has no associations at all, so there is nothing to join
    const diluentCatalog = await DiluentCatalog.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if (!diluentCatalog) {
        throw new AppError(getMessage('diluentCatalog.notFound', lang), 404, 'DILUENT_003_NOT_FOUND');
    }
    return diluentCatalog;
}

// How every nullable text column enters `candidates`: null empties the column and undefined means
// the key never travelled, which are two different intents. The comparison is against undefined and
// never a truthiness test, or an empty string would be silently dropped
const textCandidate = (value?: string | null): string | null | undefined =>
    value !== undefined ? (value?.trim() ?? null) : undefined;

// ESAVI-DILUENT-004 - Update Diluent Catalog Service
const updateDiluentCatalogService = async (id: string, data: Partial<CreateDiluentCatalogInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const diluentCatalog = await DiluentCatalog.findByPk(id);
    if (!diluentCatalog) {
        throw new AppError(getMessage('diluentCatalog.notFound', lang), 404, 'DILUENT_004_NOT_FOUND');
    }
    let updatedDiluentCatalog = diluentCatalog;
    // Normalized once, with the same function the create uses, and reused both for the uniqueness
    // query and for the diff. Comparing the raw body against the normalized stored value would make
    // a PUT with 'agua destilada' over a row holding AGUA_DESTILADA look like a change and write on
    // every call
    const candidateCode = data.code ? toConstantCase(data.code.trim()) : undefined;
    // Uniqueness runs before the diff and independently of it: an occupied code is a 409 even when
    // the rest of the body changes nothing. It does not filter by isActive — a code taken by a
    // deactivated row is still taken — and excluding the own id is what lets a client resend its own
    // value without colliding with itself
    if (candidateCode !== undefined) {
        const existingDiluent = await DiluentCatalog.findOne({
            where: {
                code: candidateCode,
                diluentCatalogId: { [Op.ne]: id }
            },
            attributes: ['diluentCatalogId']
        });
        if (existingDiluent) {
            throw new AppError(getMessage('diluentCatalog.codeExists', lang, { code: candidateCode }), 409, 'DILUENT_004_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(diluentCatalog.appDetails) ? diluentCatalog.appDetails : [];
    // `stored` is the whole row, which is the precondition of the helper: a narrowed `attributes`
    // would read back undefined for the columns it left out and every comparison would count as a
    // change. The four data columns are candidates and nothing else — isActive is governed by 005A
    // and 005B
    const stored = diluentCatalog.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        // Mutable: a typo in a manually entered code has to be fixable, and the uniqueness check
        // above already protects the result
        code: candidateCode,
        // Only trimmed, never toTitleCase — see the create
        name: data.name ? data.name.trim() : undefined,
        description: textCandidate(data.description),
        composition: textCandidate(data.composition)
    });
    // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
    if (Object.keys(objectToUpdate).length > 0) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-DILUENT-004',
            detail: 'Diluent catalog entry updated by service'
        };
        updatedDiluentCatalog = await diluentCatalog.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, { returning: true });
    }
    return stripSysDetails(updatedDiluentCatalog);
}

// ESAVI-DILUENT-005A / ESAVI-DILUENT-005B - Set Diluent Catalog Activation Service
// Not a differential update: these are writes with an intention of their own. They record a state
// fact, so they go through setEntityActiveStatusService and never through buildDifferentialUpdate.
// The where filters by the primary key alone: no incoming foreign key is checked, because this is a
// logical delete — the ON DELETE RESTRICT of the single child table never fires, an inactive diluent
// keeps being referenced by design, and that table does not even exist yet. Deactivating means
// "stop offering it in the dropdown", not "stop existing"
const setDiluentCatalogActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const diluentCatalog = await setEntityActiveStatusService({
            model: DiluentCatalog,
            where: { diluentCatalogId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('diluentCatalog.notFound', lang),
            notFoundCode: `DILUENT_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`diluentCatalog.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `DILUENT_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                // Only the computed operation code, with no _ACTIVATION stuck behind it
                method: `ESAVI-DILUENT-${ op }`,
                detail: `DiluentCatalog ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return diluentCatalog;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createDiluentCatalogService,
    getActiveDiluentCatalogsService,
    getAllDiluentCatalogsService,
    getDiluentCatalogByIdService,
    updateDiluentCatalogService,
    setDiluentCatalogActivationService
};
