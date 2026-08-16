import { Op, WhereOptions } from 'sequelize';
import { VaccineWhodrug } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateVaccineWhodrugInput, VaccineWhodrugListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The 23 nullable text columns of the entity, trimmed on write and never normalized any further.
// undefined and null both land as null on create: an absent field and an explicitly emptied one
// mean the same thing when the row does not exist yet
const trimOrNull = (value?: string | null): string | null =>
    value !== undefined && value !== null ? value.trim() : null;

// sysDetails is trigger metadata and never leaves the service. The reads drop it through
// `attributes: { exclude }`, which a create cannot use, so the returned instance is flattened and
// stripped here — the response shape of §3.7 is the 36 columns minus this one
const stripSysDetails = (vaccineWhodrug: VaccineWhodrug): Record<string, unknown> => {
    const plain = vaccineWhodrug.get({ plain: true }) as Record<string, unknown>;
    delete plain.sysDetails;
    return plain;
}

// Shared by both listings, which take exactly the same five filters. search is an Op.iLike over
// drugName and stays confined to these two services: the real use case is the autocomplete of the
// notification form, and an autocomplete needs prefixes and fragments — which is why the GIN index
// IX_vaccineWhodrug_name is deliberately left unconsumed. The two booleans are compared against
// undefined and never by truthiness, or ?isPreferred=false would silently return everything
const buildVaccineWhodrugWhere = (filters: VaccineWhodrugListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};
    if (filters.search) {
        where.drugName = { [Op.iLike]: `%${filters.search.trim()}%` };
    }
    if (filters.language) {
        where.language = filters.language.trim();
    }
    if (filters.iso3Code) {
        where.iso3Code = filters.iso3Code.trim();
    }
    if (filters.isPreferred !== undefined) {
        where.isPreferred = filters.isPreferred;
    }
    // There is no way to ask for isGeneric IS NULL: it would need a sentinel value in the query and
    // it is out of this spec's scope
    if (filters.isGeneric !== undefined) {
        where.isGeneric = filters.isGeneric;
    }
    return where;
}

// ESAVI-WHODRUG-001 - Create Vaccine Whodrug Service
const createVaccineWhodrugService = async (data: CreateVaccineWhodrugInput, authUser: AuthUser | undefined, lang: string) => {
    // externalId is the only unique column of the table, and it is checked only when the body
    // brings it non-null: under a Postgres UNIQUE, N rows with NULL coexist, so an entry without it
    // never collides. The check does not filter by isActive — an inactive row still occupies the
    // key and the constraint still fires
    const externalId = data.externalId ?? null;
    if (externalId !== null) {
        const existingVaccine = await VaccineWhodrug.findOne({
            where: { externalId },
            attributes: ['vaccineWhodrugId']
        });
        if (existingVaccine) {
            throw new AppError(getMessage('vaccineWhodrug.externalIdExists', lang, { externalId }), 409, 'WHODRUG_001_EXTERNAL_ID_EXISTS');
        }
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-WHODRUG-001',
        detail: 'Vaccine WHODrug created by service'
    };
    const newVaccineWhodrug = await VaccineWhodrug.create({
        externalId,
        // Only trimmed, never toConstantCase: a dictionary code is quoted data, and rewriting it
        // would break the correspondence with the source file, which is the whole point of the
        // code. Interior spaces stay as they came — '003649 01 001' is one code, not three
        drugCode: data.drugCode.trim(),
        // Only trimmed, never toTitleCase: toTitleCase would turn 'BCG vaccine' into 'Bcg Vaccine'
        // and destroy the acronyms, which in a vaccine dictionary are half of the names
        drugName: data.drugName.trim(),
        drugRecNo: trimOrNull(data.drugRecNo),
        drugRecNoSeq: trimOrNull(data.drugRecNoSeq),
        language: trimOrNull(data.language),
        medicinalProductId: trimOrNull(data.medicinalProductId),
        atcs: trimOrNull(data.atcs),
        icd11: trimOrNull(data.icd11),
        icd11Term: trimOrNull(data.icd11Term),
        abbreviation: trimOrNull(data.abbreviation),
        ingredient: trimOrNull(data.ingredient),
        ingredientTranslation: trimOrNull(data.ingredientTranslation),
        languageCode: trimOrNull(data.languageCode),
        iso3Code: trimOrNull(data.iso3Code),
        countryMedicinalProductId: trimOrNull(data.countryMedicinalProductId),
        maHolders: trimOrNull(data.maHolders),
        maHoldersMedicinalProductId: trimOrNull(data.maHoldersMedicinalProductId),
        form: trimOrNull(data.form),
        formTranslations: trimOrNull(data.formTranslations),
        formMedicinalProductId: trimOrNull(data.formMedicinalProductId),
        strength: trimOrNull(data.strength),
        strengthMedicinalProductId: trimOrNull(data.strengthMedicinalProductId),
        noDose: trimOrNull(data.noDose),
        diluent: trimOrNull(data.diluent),
        // Three states: an absent isGeneric stays null — 'unknown' — instead of collapsing to false
        isGeneric: data.isGeneric ?? null,
        // NOT NULL in the DDL: the comparison is against undefined, never a truthiness test, or an
        // explicit false would be silently turned into the default
        isPreferred: data.isPreferred !== undefined ? data.isPreferred : false,
        notes: trimOrNull(data.notes),
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return stripSysDetails(newVaccineWhodrug);
}

// ESAVI-WHODRUG-002A - Get Active Vaccine Whodrugs Service
const getActiveVaccineWhodrugsService = async (filters: VaccineWhodrugListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const vaccineWhodrugs = await VaccineWhodrug.findAndCountAll({
        where: {
            ...buildVaccineWhodrugWhere(filters),
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['drugName', 'ASC']],
        limit,
        offset
    });
    return vaccineWhodrugs;
}

// ESAVI-WHODRUG-002B - Get All Vaccine Whodrugs Service (including inactive) - For Admin
const getAllVaccineWhodrugsService = async (filters: VaccineWhodrugListFilters, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The twin of 002A without isActive in the where, and with no filter of its own: unlike
    // diagnosticTerm, this entity has no review queue to look into
    const vaccineWhodrugs = await VaccineWhodrug.findAndCountAll({
        where: buildVaccineWhodrugWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['drugName', 'ASC']],
        limit,
        offset
    });
    return vaccineWhodrugs;
}

// ESAVI-WHODRUG-003 - Get Vaccine Whodrug by ID Service
const getVaccineWhodrugByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const whereClause = includeInactive ? { vaccineWhodrugId: id } : { vaccineWhodrugId: id, isActive: true };
    // No includes: the entity has no associations at all, so there is nothing to join
    const vaccineWhodrug = await VaccineWhodrug.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if (!vaccineWhodrug) {
        throw new AppError(getMessage('vaccineWhodrug.notFound', lang), 404, 'WHODRUG_003_NOT_FOUND');
    }
    return vaccineWhodrug;
}

export {
    createVaccineWhodrugService,
    getActiveVaccineWhodrugsService,
    getAllVaccineWhodrugsService,
    getVaccineWhodrugByIdService
};
