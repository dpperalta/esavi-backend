// The eight input keys are the eight writable columns. There is no implicit resolution against
// diluentCatalog — a diluent is a physical product with a declared composition, not a description
// the notifier coins — so there is nothing to discard before the create. The interface is flat and
// no field is derived: diluentName and diluentCode are the client's copy of what was transcribed
// from the vial and are never filled in from the master.
//
// One deliberate absence. sortOrder is not here because it is immutable and assigned by
// TRG_notificationDiluent_setSortOrder — keeping it out of the type is the cheapest guarantee
// that no service ever sends it.
//
// The seven data fields are optional, which is faithful to the DDL: the table has no mandatory
// data column, and not even a boolean with a default. The minimum content guard — at least one of
// diluentCatalogId or diluentName — lives in the service and not here, because on update it is
// evaluated over the resulting state and TypeScript cannot express that condition.
//
// The update uses Partial<CreateNotificationDiluentInput>: no UpdateNotificationDiluentInput
// exists
export interface CreateNotificationDiluentInput {
    vaccineId: string;
    diluentCatalogId?: string | null;
    batchNumber?: string | null;
    expirationDate?: string | null;
    reconstitutionDate?: string | null;
    reconstitutionTime?: string | null;
    diluentName?: string | null;
    diluentCode?: string | null;
    isActive?: boolean;
}
