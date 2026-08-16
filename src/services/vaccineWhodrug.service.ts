import { VaccineWhodrug } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateVaccineWhodrugInput } from '../types';

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

export {
    createVaccineWhodrugService
};
