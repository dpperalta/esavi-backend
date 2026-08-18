import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

// The concomitant medication the patient was taking when the adverse event appeared. Fourth
// satellite of notification and second of the one to many family, so it shares the shape of
// notificationEvent: medicationId is its own primary key, notificationId is a separate column
// and sortOrder keeps the order among siblings. It does not depend on the notificationType:
// the medication is asked the same whether the notification is severe or not
export class NotificationMedication extends Model<InferAttributes<NotificationMedication>, InferCreationAttributes<NotificationMedication>> {
    declare medicationId: CreationOptional<string>;
    declare notificationId: ForeignKey<Notification['notificationId']>;

    // Assigned by TRG_notificationMedication_setSortOrder (BEFORE INSERT only) and protected by
    // the partial unique index over (notificationId, sortOrder) WHERE deletedAt IS NULL. Declared
    // without defaultValue on purpose: a defaultValue of 0 would make the INSERT send an explicit
    // 0, which is exactly the value the trigger reads as "assign it yourself". The create omits
    // the column instead, and nothing but ESAVI-NOTIFMED-005B ever writes it
    declare sortOrder?: CreationOptional<number>;

    // The only mandatory data column
    declare medicationName: string;

    // Free text with no master and no foreign key behind it, so it is only trimmed and never
    // normalized to constant case: mutilating ABC-123 into ABC_123 would destroy the only value
    // the column has, which is reproducing what the notifier read on the box
    declare medicationCode?: CreationOptional<string | null>;

    declare dose?: CreationOptional<string | null>;

    // Two catalogItem keys that no trigger validates: the service checks each one belongs to its
    // catalogType before writing
    declare pharmaceuticalFormItemId?: CreationOptional<string | null>;
    declare administrationRouteItemId?: CreationOptional<string | null>;

    // A single date column, unlike notificationEvent: when a medication started being taken is a
    // date and not an instant, so there is no time to normalize
    declare startDate?: CreationOptional<string | null>;

    // Strict boolean, not tri-state like the verified* columns of nonSevereNotification: the DDL
    // declares it NOT NULL, so null is not a possible value. Governs the coherence rule of the
    // "other" medication
    declare isOtherMedication?: CreationOptional<boolean>;
    declare otherMedicationText?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare notification?: NonAttribute<Notification>;
    declare pharmaceuticalForm?: NonAttribute<CatalogItem>;
    declare administrationRoute?: NonAttribute<CatalogItem>;
}

NotificationMedication.init({
    medicationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    notificationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: false,
    },
    // The lengths are explicit so an overlong text fails in Sequelize and not in Postgres
    medicationName: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    medicationCode: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    dose: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    pharmaceuticalFormItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    administrationRouteItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // DATEONLY and not DATE: the column is `date`, and DATE would carry a time zone
    startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    isOtherMedication: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    otherMedicationText: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    updatedAt: {
        type: DataTypes.DATE
    },
    deletedAt: {
        type: DataTypes.DATE
    },
    sysDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    appDetails: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    }
}, {
    sequelize,
    tableName: 'notificationMedication',
    modelName: 'NotificationMedication',
    timestamps: false,
    freezeTableName: true,
});
