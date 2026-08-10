import { Model, ModelStatic, Transaction, WhereOptions } from 'sequelize';
import { AppError } from '../../helpers/appError.helper';
import { esaviLog } from '../../helpers/esaviLogs.helper';

interface PurgeOptions<T extends Model> {
    model: ModelStatic<T>;
    where: WhereOptions;
    transaction?: Transaction;
    operationCode: string;
    userId: string;
    notFoundMessage: string;
    notFoundCode: string;
    stillActiveMessage: string;
    stillActiveCode: string;
}

// Generic function to physically delete an entity - ESAVI-<ENTITY>-005C
// Only available on tables outside the preventPhysicalDelete trigger of esaviapp.sql:1354-1360
const purgeEntityService = async <T extends Model>(options: PurgeOptions<T>): Promise<void> => {
    const entity = await options.model.findOne({
        where: options.where,
        paranoid: false, // Include soft-deleted records
        transaction: options.transaction
    });
    if( !entity ) {
        throw new AppError(options.notFoundMessage, 404, options.notFoundCode);
    }
    const current = entity.get({ plain: true }) as any;
    // Physical deletion only reaches what was already retired with 005A. Two deliberate
    // steps are the safety net of an operation that cannot be undone
    if( current.isActive === true ) {
        throw new AppError(options.stillActiveMessage, 409, options.stillActiveCode);
    }
    // The only trace left of an irreversible operation, so it is written before the row
    // is gone. The snapshot comes from the Sequelize instance, so esaviCrypt columns are
    // dumped encrypted: decryption happens when the response is built, not when reading
    esaviLog(
        `${ options.operationCode }: Row purged by ${ options.userId }. Snapshot: ${ JSON.stringify(current) }`,
        'warn'
    );
    // No appDetails entry: the row is destroyed in this same transaction, so any audit
    // written into it would be destroyed with it
    await entity.destroy({ force: true, transaction: options.transaction });
}

export {
    purgeEntityService
}
