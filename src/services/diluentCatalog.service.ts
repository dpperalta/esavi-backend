import { DiluentCatalog } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { AppDetails, AuthUser, CreateDiluentCatalogInput } from '../types';

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

export {
    createDiluentCatalogService
};
