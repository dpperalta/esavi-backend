// The four catalog codes that couple investigation to data living outside the schema. They are
// here and never written as literals in the service: the acceptance criteria of SPEC F28 verify by
// grep that they are not duplicated, and that check only works if there is a single place to look.

// catalogType that statusItemId must belong to. Its six approved items are seeded by esaviapp.sql
// with a numeric code, '0' to '5', and — since SPEC F46 — a semantic value alongside it: UNKNOWN,
// RECOVERING, RECOVERED, NOT_RECOVERED, RECOVERED_WITH_SEQUELAE and DEATH
export const INVESTIGATION_STATUS_CATALOG_CODE = 'investigationStatus';

// catalogType that vaccinationSiteItemId must belong to. The DDL does NOT seed it: it is loaded
// through the existing catalogType and catalogItem endpoints as a deployment precondition
export const VACCINATION_SITE_CATALOG_CODE = 'vaccinationSite';

// catalogType that diagnosticTypeItemId must belong to. Unlike VACCINATION_SITE_CATALOG_CODE, the
// DDL DOES seed it: its three items — PRESUMPTIVE, CONFIRMED and DIFFERENTIAL — are a closed
// clinical set, not a per-deployment list, so esaviapp.sql calls upsertCatalogItem for each
export const DIAGNOSTIC_TYPE_CATALOG_CODE = 'diagnosticType';

// The item the service falls back to whenever statusItemId is absent or explicitly null, so an
// investigation is never stored without a status. If it is missing the create and the update answer
// 500 INVESTGN_<op>_DEFAULT_STATUS_MISSING — a server precondition, not a client error.
// It is the frozen `value` and no longer the code '0': investigationStatus was the one catalog whose
// two columns were both numeric, so SPEC F46 minted the semantic key instead of freezing one
export const DEFAULT_INVESTIGATION_STATUS_VALUE = 'UNKNOWN';
