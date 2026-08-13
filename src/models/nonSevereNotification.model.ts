import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { HealthFacility } from './healthFacility.model';
import { CatalogItem } from './catalogItem.model';
import { GeoLocation } from './geoLocation.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

export class NonSevereNotification extends Model<InferAttributes<NonSevereNotification>, InferCreationAttributes<NonSevereNotification>> {
    // Primary key and foreign key at the same time, exactly like its severe sibling: the row does
    // not identify itself, it is identified by the notification it extends. The PK already is the
    // one to one, so no extra UNIQUE is declared
    declare notificationId: ForeignKey<Notification['notificationId']>;

    // The three foreign keys of its own, and the trait that separates this satellite from the
    // severe one. All three optional, all three ON DELETE RESTRICT in the DDL, and all three
    // historical record — they say where the vaccination happened, not where it happens today
    declare vaccinationHealthFacilityId?: CreationOptional<ForeignKey<HealthFacility['healthFacilityId']> | null>;
    declare vaccinationSiteItemId?: CreationOptional<ForeignKey<CatalogItem['catalogItemId']> | null>;
    declare vaccinationCenterAddress?: CreationOptional<string | null>;
    declare vaccinationGeoLocationId?: CreationOptional<ForeignKey<GeoLocation['geoLocationId']> | null>;

    // Six independent verification sources, tri-state every one of them: null means "the form did
    // not collect it", which is not NO_ANSWER — that one is a deliberate answer from the notifier.
    // Nothing makes them exclusive: physical document and unknown can both be YES
    declare verifiedPhysicalDocument?: CreationOptional<AnswerOption | null>;
    declare verifiedElectronicRecord?: CreationOptional<AnswerOption | null>;
    declare verifiedVerbalReport?: CreationOptional<AnswerOption | null>;
    declare verifiedClinicalRecord?: CreationOptional<AnswerOption | null>;
    declare verifiedUnknown?: CreationOptional<AnswerOption | null>;

    // Governs the other source coherence rule: the description below is only admitted under YES
    declare verifiedOtherSource?: CreationOptional<AnswerOption | null>;
    declare otherSourceDescription?: CreationOptional<string | null>;

    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the second model of the repository without one:
    // the DDL does not have that column (esaviapp.sql:760-783) and this entity does not manage
    // its own state — its header does. deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare notification?: NonAttribute<Notification>;
    declare vaccinationHealthFacility?: NonAttribute<HealthFacility>;
    declare vaccinationSite?: NonAttribute<CatalogItem>;
    declare vaccinationGeoLocation?: NonAttribute<GeoLocation>;
}

NonSevereNotification.init({
    // Deliberately without defaultValue, for the same reason as severeNotification: declaring
    // gen_random_uuid() would let a create without notificationId generate an orphan UUID that
    // the FK would reject afterwards, turning a readable 400 into an integrity error
    notificationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    vaccinationHealthFacilityId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    vaccinationSiteItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // The length is declared explicitly, and it is the only field of the repository that carries
    // one in the DDL: with it a 300 character address fails in Sequelize as a readable 400 and
    // never reaches Postgres as a 22001
    vaccinationCenterAddress: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    vaccinationGeoLocationId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // The six ENUM columns take their values from the shared constants file, never from literals
    // written here: model and validator must not be able to drift apart
    verifiedPhysicalDocument: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    verifiedElectronicRecord: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    verifiedVerbalReport: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    verifiedClinicalRecord: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    verifiedUnknown: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    verifiedOtherSource: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    otherSourceDescription: {
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
    tableName: 'nonSevereNotification',
    modelName: 'NonSevereNotification',
    timestamps: false,
    freezeTableName: true,
});
