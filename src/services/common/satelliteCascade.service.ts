import { Model, ModelStatic, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../../database/connection';
import { AppDetails, AuthUser } from '../../types';

// The common drag of the satellites without isActive. SPEC F29 wrote it for investigationSource,
// SPEC F30 copied it for investigationAutopsy and left the debt annotated: "if the third satellite
// duplicates it again, that is the moment to extract a common service". SPEC F32 is that third
// one, so the drag lives here and the three entities call it.
//
// What moves is the deletedAt, because these tables have no isActive column of their own. It is a
// mass update and not a read followed by a per-row write: the cascade takes no decision per row,
// and an investigation with no satellite updates zero rows and does not fail.
//
// None of the two goes through buildDifferentialUpdate, and that is deliberate: these are writes
// with an intention of their own, and the record of the act of sealing or returning the row is
// precisely what is worth keeping in appDetails.

interface SatelliteCascadeOptions<T extends Model> {
    model: ModelStatic<T>;
    where: WhereOptions;
    // The code of the operation that dragged the row, not the one of the row itself: the audit says
    // who did it, not which row it landed on
    method: string;
    detail: string;
    authUser: AuthUser | undefined;
    transaction: Transaction;
}

// appDetails is extended in SQL, never overwritten, so a mass update preserves the history of
// every row it touches
const appendedAppDetails = (entry: AppDetails) => sequelize.literal(
    `CASE WHEN jsonb_typeof("appDetails") = 'array' THEN "appDetails" ELSE '[]'::jsonb END || jsonb_build_array(${ sequelize.escape(JSON.stringify(entry)) }::jsonb)`
) as unknown as AppDetails[];

const buildEntry = (options: SatelliteCascadeOptions<any>, createdAt: Date): AppDetails => ({
    createdAt,
    user: options.authUser?.userId || 'undefined',
    method: options.method,
    detail: options.detail
});

// Seals the deletedAt of the satellite rows the where matches. Rows already sealed are left alone
// by the deletedAt: null this function adds to the received where: they keep their original date
// and receive no new entry
const cascadeSealSatellite = async <T extends Model>(options: SatelliteCascadeOptions<T>) => {
    const now = new Date();
    await options.model.update(
        {
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(buildEntry(options, now))
        } as any,
        {
            where: { ...options.where, deletedAt: null } as WhereOptions,
            transaction: options.transaction
        }
    );
}

// The upward cascade, the exception SPEC F13 reasoned and the one SPEC F07 does not admit for
// esaviCase. It is legitimate here because the satellite has no state of its own to resurrect: its
// deletedAt does not mean "somebody retired this row", it means "its parent was retired".
// Reactivating the parent therefore returns it without asking
const cascadeClearSatellite = async <T extends Model>(options: SatelliteCascadeOptions<T>) => {
    const now = new Date();
    await options.model.update(
        {
            deletedAt: null,
            updatedAt: now,
            appDetails: appendedAppDetails(buildEntry(options, now))
        } as any,
        {
            where: options.where,
            transaction: options.transaction
        }
    );
}

export {
    cascadeSealSatellite,
    cascadeClearSatellite
}
