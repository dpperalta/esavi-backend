import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { VaccineWhodrug } from './vaccineWhodrug.model';
import { AppDetails } from '../types';

// The vaccines the notification records as administered, suspected of the event or not. Fifth
// satellite of notification and third of the one to many family, so it shares the shape of
// notificationEvent and notificationMedication: vaccineId is its own primary key, notificationId
// is a separate column and sortOrder keeps the order among siblings. Two traits are its own: it
// is the first consumer of the vaccineWhodrug master, and the first satellite with a child table
// of its own (notificationDiluent hangs from vaccineId with ON DELETE CASCADE)
export class NotificationVaccine extends Model<InferAttributes<NotificationVaccine>, InferCreationAttributes<NotificationVaccine>> {
    declare vaccineId: CreationOptional<string>;
    declare notificationId: ForeignKey<Notification['notificationId']>;

    // Nullable on purpose: a null key means "notified but not coded", which is a legitimate state.
    // The notification is never blocked by a vaccine the master does not list
    declare vaccineWhodrugId?: CreationOptional<string | null>;

    // Assigned by TRG_notificationVaccine_setSortOrder (BEFORE INSERT only) and protected by the
    // partial unique index over (notificationId, sortOrder) WHERE deletedAt IS NULL. Declared
    // without defaultValue on purpose: a defaultValue of 0 would make the INSERT send an explicit
    // 0, which is exactly the value the trigger reads as "assign it yourself". The create omits
    // the column instead, and nothing but ESAVI-NOTIFVAC-005B ever writes it
    declare sortOrder?: CreationOptional<number>;

    // Strict boolean, not the tri-state answerOption the DDL used to declare: marking a vaccine as
    // suspected is a flag the notifier sets or does not set, not a question with three answers
    declare isSuspected?: CreationOptional<boolean>;

    // The copy of what was notified. Never derived from the master: if the vaccination card says
    // one thing and the dictionary another, the notification has to be able to say both. Only
    // trimmed and never title cased, because vaccine names are mostly acronyms - BCG, SRP, DPT -
    // and title casing would mutilate them into Bcg or Srp
    declare whoCode?: CreationOptional<string | null>;
    declare vaccineCode?: CreationOptional<string | null>;
    declare vaccineName?: CreationOptional<string | null>;

    // Date and time in separate columns because the DDL separates them: the hour is frequently
    // unknown, and merging them would force inventing it. Only the date takes part in the temporal
    // coherence rule against esaviCase.eventDate
    declare vaccinationDate?: CreationOptional<string | null>;
    declare vaccinationTime?: CreationOptional<string | null>;

    declare doseNumber?: CreationOptional<number | null>;
    declare batchNumber?: CreationOptional<string | null>;

    // No rule crosses it with vaccinationDate: a vaccine administered after expiring is precisely
    // the finding an ESAVI documents, and a 400 there would block the very case being reported
    declare expirationDate?: CreationOptional<string | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare notification?: NonAttribute<Notification>;
    declare vaccineWhodrug?: NonAttribute<VaccineWhodrug>;
}

NotificationVaccine.init({
    vaccineId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    notificationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    vaccineWhodrugId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: false,
    },
    isSuspected: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    // The lengths are explicit so an overlong text fails in Sequelize and not in Postgres
    whoCode: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    vaccineCode: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    vaccineName: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    // DATEONLY and not DATE: the columns are `date`, and DATE would carry a time zone
    vaccinationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    vaccinationTime: {
        type: DataTypes.TIME,
        allowNull: true,
    },
    doseNumber: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    batchNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    expirationDate: {
        type: DataTypes.DATEONLY,
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
    tableName: 'notificationVaccine',
    modelName: 'NotificationVaccine',
    timestamps: false,
    freezeTableName: true,
});
