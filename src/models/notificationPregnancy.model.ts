import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

// The pregnancy section of an ESAVI notification: whether the patient was pregnant when vaccinated
// and when the event happened, the two dates that place the gestation, and whether there were
// complications. Seventh satellite of notification and a shape none of the six before it had - one
// to one *and* with its own state. severeNotification and nonSevereNotification are one to one but
// share the primary key and carry no isActive; notificationEvent, notificationMedication,
// notificationVaccine and notificationDiluent have state but are one to many and order their siblings.
// This one has its own pregnancyId, a plain UNIQUE over the foreign key and an isActive, so it gets
// the full activation pair and no listing at all
export class NotificationPregnancy extends Model<InferAttributes<NotificationPregnancy>, InferCreationAttributes<NotificationPregnancy>> {
    declare pregnancyId: CreationOptional<string>;

    // UQ_notificationPregnancy_notification makes this one to one. The UNIQUE is *not* declared here
    // on purpose: Sequelize does not check it before the INSERT, so declaring it would only document
    // what the database already enforces while the 409 still has to be produced by hand. The service
    // validates it with an explicit findOne and paranoid: false, because that UNIQUE is plain and a
    // withdrawn row keeps occupying the slot
    declare notificationId: ForeignKey<Notification['notificationId']>;

    // Tri-state, and the only data column the application demands on creation: a pregnancy row that
    // does not say whether there was a pregnancy reports nothing. The DDL declares it nullable and
    // ESAVI-NOTIFPRG-004 honours that - it is required at birth and clearable afterwards, so a
    // notifier who answered by mistake can withdraw the answer without losing the row
    declare wasPregnantAtVaccination?: CreationOptional<AnswerOption | null>;

    // No rule crosses the two tri-states: a NO at vaccination with a YES at the event is a pregnancy
    // that started afterwards, which is a legitimate and clinically relevant record
    declare wasPregnantAtEsavi?: CreationOptional<AnswerOption | null>;

    // The gestational range rule reads both or neither: with a single date, or none, nothing is
    // checked. Their difference must fall between GESTATION_MIN_DAYS and GESTATION_MAX_DAYS
    declare lastMenstruationDate?: CreationOptional<string | null>;
    declare probableDeliveryDate?: CreationOptional<string | null>;

    // Client data, never derived from notificationPregnancyComplication: that table has no model
    // until its own spec, and a derived value counting rows that do not exist is always NO
    declare hasComplications?: CreationOptional<AnswerOption | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare notification?: NonAttribute<Notification>;
}

NotificationPregnancy.init({
    pregnancyId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    notificationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // The three ENUM columns take their values from the shared constants file, never from literals
    // written here: model and validator must not be able to drift apart
    wasPregnantAtVaccination: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    wasPregnantAtEsavi: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    // DATEONLY and not DATE: the columns are `date`, and DATE would carry a time zone
    lastMenstruationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    probableDeliveryDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    hasComplications: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
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
    tableName: 'notificationPregnancy',
    modelName: 'NotificationPregnancy',
    timestamps: false,
    freezeTableName: true,
});
