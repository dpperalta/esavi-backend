// The 28 data columns of vaccineWhodrug, writable by the create and the update.
// drugCode is required here even though the DDL admits null: a dictionary entry without a code
// cannot be crossed against anything, which is the only thing the catalog exists for. It carries
// no uniqueness — the WHODrug file repeats it by design.
// externalId is the unique key of the table and stays optional: under a Postgres UNIQUE, N rows
// with NULL coexist, so a manual entry without it never collides with the dictionary key space.
// isGeneric admits null — three states, because the DDL gave the column no DEFAULT — while
// isPreferred never does: it is NOT NULL DEFAULT false.
// metadata is deliberately absent: it is not a field the client writes. The bulk import of SPEC F19
// stamps it at insert time and not even the update touches it
export interface CreateVaccineWhodrugInput {
    drugCode: string;
    drugName: string;
    externalId?: number | null;
    drugRecNo?: string | null;
    drugRecNoSeq?: string | null;
    language?: string | null;
    medicinalProductId?: string | null;
    atcs?: string | null;
    icd11?: string | null;
    icd11Term?: string | null;
    abbreviation?: string | null;
    ingredient?: string | null;
    ingredientTranslation?: string | null;
    languageCode?: string | null;
    iso3Code?: string | null;
    countryMedicinalProductId?: string | null;
    maHolders?: string | null;
    maHoldersMedicinalProductId?: string | null;
    form?: string | null;
    formTranslations?: string | null;
    formMedicinalProductId?: string | null;
    strength?: string | null;
    strengthMedicinalProductId?: string | null;
    noDose?: string | null;
    diluent?: string | null;
    isGeneric?: boolean | null;
    isPreferred?: boolean;
    notes?: string | null;
    isActive?: boolean;
}

// Query filters of the two listings, identical in both. search runs as Op.iLike over drugName only,
// with a minimum of 2 characters; language and iso3Code are exact equality over the trimmed value;
// isPreferred and isGeneric are booleans. There is no way to filter isGeneric IS NULL — it would
// need a sentinel value in the query and nobody has asked for it
export interface VaccineWhodrugListFilters {
    search?: string;
    language?: string;
    iso3Code?: string;
    isPreferred?: boolean;
    isGeneric?: boolean;
}
