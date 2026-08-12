import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

export class SevereNotification extends Model<InferAttributes<SevereNotification>, InferCreationAttributes<SevereNotification>> {
    // Primary key and foreign key at the same time: the row does not identify itself, it is
    // identified by the notification it extends. The one to one needs no extra UNIQUE — the PK
    // already is one — and a second detail for the same notification is a PK collision
    declare notificationId: ForeignKey<Notification['notificationId']>;

    // Tri-state, all five of them: null means "the form did not collect it", which is not
    // NO_ANSWER — that one is a deliberate answer from the notifier
    declare hasPreviousEventHistory?: CreationOptional<AnswerOption | null>;
    declare hasAllergyToOtherVaccines?: CreationOptional<AnswerOption | null>;
    declare hasAllergyToMedications?: CreationOptional<AnswerOption | null>;
    declare hasAllergyToPreviousSameVaccine?: CreationOptional<AnswerOption | null>;

    // Governs the pregnancy coherence rule: the description below is only admitted under YES
    declare hasPregnancyComplications?: CreationOptional<AnswerOption | null>;
    declare pregnancyComplicationsDescription?: CreationOptional<string | null>;

    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the first model of the repository without one:
    // the DDL does not have that column (esaviapp.sql:743-758) and this entity does not manage
    // its own state — its header does. deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare notification?: NonAttribute<Notification>;
}

SevereNotification.init({
    // Deliberately without defaultValue, unlike every model before it: declaring
    // gen_random_uuid() would let a create without notificationId generate an orphan UUID that
    // the FK would reject afterwards, turning a readable 400 into an integrity error
    notificationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // The five ENUM columns take their values from the shared constants file, never from
    // literals written here: model and validator must not be able to drift apart
    hasPreviousEventHistory: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    hasAllergyToOtherVaccines: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    hasAllergyToMedications: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    hasAllergyToPreviousSameVaccine: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    hasPregnancyComplications: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    pregnancyComplicationsDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
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
    tableName: 'severeNotification',
    modelName: 'SevereNotification',
    timestamps: false,
    freezeTableName: true,
});
