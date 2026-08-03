import { Model, ModelStatic, Transaction, WhereOptions } from 'sequelize';
import { AppError } from '../../helpers/appError.helper';

interface ActivationOptions<T extends Model> {
    model: ModelStatic<T>;
    where: WhereOptions;
    isActive: boolean;
    transaction?: Transaction;
    notFoundMessage: string;
    notFoundCode: string;
    appDetail: {
        createdAt: Date;
        user: string;
        method: string;
        detail: string;
    };
}

// Generic function to activate/deactivate an entity
const setEntityActiveStatusService = async <T extends Model>(options: ActivationOptions<T>): Promise<T> => {
    const entity = await options.model.findOne({ 
        where: options.where,
        paranoid: false, // Include soft-deleted records
        transaction: options.transaction 
    });
    if( !entity ) {
        throw new AppError(options.notFoundMessage, 404, options.notFoundCode);
    }
    const current = entity.get({ plain: true }) as any;
    const currentAppDetails = Array.isArray(current.appDetails) ? current.appDetails : [];
    await entity.update({
        isActive: options.isActive,
        deletedAt: options.isActive ? null : new Date(), // Set deletedAt for deactivation, null for activation
        appDetails: [
            ...currentAppDetails,
            options.appDetail
        ]
    }, { 
        transaction: options.transaction, 
        returning: true 
    });
    return entity;
}

export {
    setEntityActiveStatusService
}