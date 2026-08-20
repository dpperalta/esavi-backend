import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { NotificationPregnancy } from './notificationPregnancy.model';
import { DiagnosticTerm } from './diagnosticTerm.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

// Each complication recorded over a notified pregnancy - congenital anomalies, fetal or neonatal
// complications, complications of labour - typed against a catalog and, when the notifier supplies
// a code, resolved against the clinical master. Eighth and last satellite of notification, and a
// granddaughter like notificationDiluent, but of a different shape: the first hop is one to one,
// because UQ_notificationPregnancy_notification allows a single pregnancy per notification, so the
// fan out only opens at the second level
export class NotificationPregnancyComplication extends Model<InferAttributes<NotificationPregnancyComplication>, InferCreationAttributes<NotificationPregnancyComplication>> {
    declare complicationId: CreationOptional<string>;
    declare pregnancyId: ForeignKey<NotificationPregnancy['pregnancyId']>;

    // Never chosen by the client: it is what the resolution against the clinical master returns
    declare diagnosticTermId?: CreationOptional<string | null>;

    // Nullable in the model because the DDL declares it nullable and ESAVI-PREGCOMP-004 does not
    // demand it. The application requires it on creation, and that requirement lives in the
    // validator, never here
    declare complicationTypeItemId?: CreationOptional<string | null>;

    // Derived: the text the notifier wrote, kept only when it differs from the master's name. This
    // table has a single text column, so there is nowhere to denormalize the canonical name or the
    // code - both are read from diagnosticTerm through the include
    declare complicationRawName?: CreationOptional<string | null>;

    // Assigned by TRG_notificationPregnancyComplication_setSortOrder (BEFORE INSERT only) and
    // protected by the partial unique index over (pregnancyId, sortOrder) WHERE deletedAt IS NULL.
    // Declared without defaultValue on purpose: a defaultValue of 0 would make the INSERT send an
    // explicit 0, which is exactly the value the trigger reads as "assign it yourself". The create
    // omits the column instead, and nothing but ESAVI-PREGCOMP-005B ever writes it
    declare sortOrder?: CreationOptional<number>;

    // Declared so the model mirrors the table, and written by no service: the column is out of
    // scope in SPEC F27 and stays with its {} DEFAULT until a spec finds it a use
    declare metadata?: CreationOptional<object | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare pregnancy?: NonAttribute<NotificationPregnancy>;
    declare diagnosticTerm?: NonAttribute<DiagnosticTerm>;
    declare complicationType?: NonAttribute<CatalogItem>;
}

NotificationPregnancyComplication.init({
    complicationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    pregnancyId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    diagnosticTermId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    complicationTypeItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // The length is explicit so an overlong text fails in Sequelize and not in Postgres
    complicationRawName: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: false,
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    notes: {
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
    tableName: 'notificationPregnancyComplication',
    modelName: 'NotificationPregnancyComplication',
    timestamps: false,
    freezeTableName: true,
});
