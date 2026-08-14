import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { DiagnosticTerm } from './diagnosticTerm.model';
import { AppDetails } from '../types';

// The adverse event that motivates a notification. First satellite of notification with one to
// many cardinality, its own activity flag and order among siblings, so unlike severeNotification
// and nonSevereNotification it identifies itself: eventId is its own primary key and
// notificationId is a separate column with a non unique index
export class NotificationEvent extends Model<InferAttributes<NotificationEvent>, InferCreationAttributes<NotificationEvent>> {
    declare eventId: CreationOptional<string>;
    declare notificationId: ForeignKey<Notification['notificationId']>;

    // Never chosen by the client: it is what the resolution against the clinical master returns
    declare diagnosticTermId?: CreationOptional<string | null>;

    // Assigned by TRG_notificationEvent_setSortOrder (BEFORE INSERT only) and protected by the
    // partial unique index over (notificationId, sortOrder) WHERE deletedAt IS NULL. Declared
    // without defaultValue on purpose: a defaultValue of 0 would make the INSERT send an explicit
    // 0, which is exactly the value the trigger reads as "assign it yourself". The create omits
    // the column instead, and nothing but ESAVI-NOTIFEVT-005B ever writes it
    declare sortOrder?: CreationOptional<number>;

    // The only mandatory data column. It holds the name of the master term when the event was
    // coded, and the free text of the notifier when it was not
    declare esaviName: string;
    declare esaviCode?: CreationOptional<string | null>;

    // Derived: the text the notifier wrote, kept only when it differs from the master's name
    declare esaviRawName?: CreationOptional<string | null>;

    // Strict booleans, not tri-state like the verified* columns of nonSevereNotification: the
    // DDL declares both NOT NULL, so null is not a possible value
    declare isMainEsavi?: CreationOptional<boolean>;

    // Two separate columns, as in the DDL: they are two distinct questions of the form and the
    // time is frequently unknown
    declare startDate?: CreationOptional<string | null>;
    declare startTime?: CreationOptional<string | null>;

    // Governs the coherence rule of the "other" event
    declare isOtherEsavi?: CreationOptional<boolean>;
    declare otherDescription?: CreationOptional<string | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare notification?: NonAttribute<Notification>;
    declare diagnosticTerm?: NonAttribute<DiagnosticTerm>;
}

NotificationEvent.init({
    eventId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    notificationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    diagnosticTermId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: false,
    },
    // The lengths are explicit so an overlong text fails in Sequelize and not in Postgres
    esaviName: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    esaviCode: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    esaviRawName: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    isMainEsavi: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    // DATEONLY and not DATE: the column is `date`, and DATE would carry a time zone
    startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    // TIME comes back from pg as a 'HH:MM:SS' string
    startTime: {
        type: DataTypes.TIME,
        allowNull: true,
    },
    isOtherEsavi: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    otherDescription: {
        type: DataTypes.STRING(500),
        allowNull: true,
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
    tableName: 'notificationEvent',
    modelName: 'NotificationEvent',
    timestamps: false,
    freezeTableName: true,
});
