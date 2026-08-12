import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { EsaviCase } from './esaviCase.model';
import { CatalogItem } from './catalogItem.model';
import { NOTIFICATION_TYPES, NotificationType } from '../constants/notification.constants';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
    declare notificationId: CreationOptional<string>;
    declare caseId: ForeignKey<EsaviCase['caseId']>;

    // Required on create and immutable afterwards: the type governs which satellite table the
    // notification belongs to, and none of the eight is implemented yet
    declare notificationType: NotificationType;
    declare esaviDescription: string;

    // Tri-state: null means "the form did not collect it", which is not NO_ANSWER — that one is
    // a deliberate answer from the notifier. Merging them would erase the difference
    declare hasRelevantMedicalHistory?: CreationOptional<AnswerOption | null>;
    declare takesMedication?: CreationOptional<AnswerOption | null>;

    declare outcomeItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare requestInvestigation?: CreationOptional<boolean>;

    // The three death fields, only meaningful when the outcome item code is DEATH
    declare deathDate?: CreationOptional<string | null>;
    declare autopsyRequested?: CreationOptional<boolean | null>;
    declare verbalAutopsyPerformed?: CreationOptional<boolean | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare case?: NonAttribute<EsaviCase>;
    declare outcome?: NonAttribute<CatalogItem>;
}

Notification.init({
    notificationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    caseId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // The three ENUM columns take their values from the constants file, never from literals
    // written here: model and validator must not be able to drift apart
    notificationType: {
        type: DataTypes.ENUM(...NOTIFICATION_TYPES),
        allowNull: false,
    },
    hasRelevantMedicalHistory: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    takesMedication: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    esaviDescription: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    outcomeItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // The only boolean with a defaultValue, mirroring the DEFAULT false of the DDL: here the
    // table itself says that "not informed" and "no" are the same thing
    requestInvestigation: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false
    },
    deathDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    // No defaultValue on these two: declaring it would collapse their tri-state into two states
    autopsyRequested: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verbalAutopsyPerformed: {
        type: DataTypes.BOOLEAN,
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
    tableName: 'notification',
    modelName: 'Notification',
    timestamps: false,
    freezeTableName: true,
});
