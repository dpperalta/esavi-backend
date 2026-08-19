// The 4 data columns of systemConfigHistory. There is no update input: the table is append-only, so
// it is only ever created — from the 001, the 004 and the 008 — and read, from the 007.
// previousValue is null on the first row of a configuration; both values are stored exactly as the
// column held them, encrypted if the configuration is
export interface CreateSystemConfigHistoryInput {
    systemConfigId: string;
    previousValue?: unknown;             // null on the first row of a configuration
    newValue: unknown;
    changedByUserId?: string | null;
    changeReason?: string | null;
}
