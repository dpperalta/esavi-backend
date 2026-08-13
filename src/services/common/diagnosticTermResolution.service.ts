import { Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../database/connection';
import { DiagnosticTerm } from '../../models';
import { toConstantCase } from '../../helpers';
import { AppDetails, AuthUser, ResolveDiagnosticTermInput } from '../../types';

// ESAVI-DIAGTERM-006 - Resolve Diagnostic Term Service
//
// Implicit resolution: the door through which other domains reference a term that exists, or coin
// it on the spot when it does not. A clinical catalog fed only by its administrative endpoint is
// never fed — the term shows up when somebody notifies, not when an administrator anticipates it.
//
// No HTTP route. Exposing it would open a second write door to the master with the awkward
// question of why a USER writes where ESAVI-DIAGTERM-001 demands ADMIN. As an internal service the
// asymmetry reads right: implicit creation is an effect of notifying, not a catalog entry.
//
// It receives the caller's transaction and never opens one of its own: if the notification rolls
// back, the term created with it rolls back too. The contract is "it always returns a term", so it
// raises no 404 and no 409 of its own — infrastructure errors are wrapped by the calling endpoint
// with its own operation code.
const resolveDiagnosticTermService = async (
    data: ResolveDiagnosticTermInput,
    authUser: AuthUser | undefined,
    lang: string,
    transaction?: Transaction
): Promise<DiagnosticTerm> => {
    // 1. Same normalization as ESAVI-DIAGTERM-001, or the resolver would never find what the CRUD
    //    saved. source is always LOCAL and is not a parameter: a client cannot claim a term belongs
    //    to MedDRA or WHODrug, since those dictionaries are licensed, versioned and imported
    const code = toConstantCase(data.code.trim());
    const where = { source: 'LOCAL' as const, code };

    // 2. Match: return the stored row without writing anything — no updatedAt, no appDetails, not
    //    even when the incoming name differs from the stored one. The master rules over the name;
    //    letting the last notifier rename it would rewrite every historical notification through a
    //    typo. The divergence is preserved in the *Raw* column of the calling table.
    //    The lookup does not filter by isActive: an inactive term is still referenced by design,
    //    and reactivating it from a notification would silently undo an administrator's decision
    const existingTerm = await DiagnosticTerm.findOne({ where, transaction });
    if (existingTerm) {
        return existingTerm;
    }

    // Declared apart so it reaches the JSONB column as a plain object: an inline literal would hit
    // the excess property check of the model's `object` typing
    const autoCreatedMetadata: Record<string, unknown> = {
        autoCreated: true,
        createdFrom: data.operationCode,
        reviewStatus: 'PENDING'
    };

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-DIAGTERM-006',
        detail: 'Diagnostic term created by implicit resolution'
    };

    try {
        // 3. No match: coin it, marked. Without the marker nobody can tell a reviewed term from one
        //    that came in through a form at three in the morning, and in six months 'Cefalea',
        //    'Dolor de Cabeza' and 'DOLOR CABEZA' coexist with no way to know which one to look at
        //    The INSERT — and only the INSERT — runs inside a SAVEPOINT of the caller's
        //    transaction. Without it a unique violation aborts the whole enclosing transaction and
        //    Postgres rejects every later statement in the block, so the re-read of step 4 could
        //    never answer and the notification would die with the race. This is not a transaction
        //    of its own: the savepoint lives inside the caller's, so its rollback still undoes the
        //    created term
        return await sequelize.transaction({ transaction }, async (savepoint) =>
            DiagnosticTerm.create({
                ...where,
                name: data.name.trim(),
                metadata: autoCreatedMetadata,
                appDetails: [newEntry]
            }, { transaction: savepoint })
        );
    } catch (error) {
        // 4. Another transaction won the race. findOrCreate does not close the window between the
        //    SELECT and the INSERT, so the unique index is the arbiter, not the findOne of step 2:
        //    re-read and hand back the winning row. If the re-read finds nothing either, the
        //    original error is propagated — that is a real failure, not a race
        if (error instanceof UniqueConstraintError) {
            const winnerTerm = await DiagnosticTerm.findOne({ where, transaction });
            if (winnerTerm) {
                return winnerTerm;
            }
        }
        throw error;
    }
}

export {
    resolveDiagnosticTermService
}
