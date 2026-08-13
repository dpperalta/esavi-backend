import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Notification } from './notification.model';
import { HealthFacility } from './healthFacility.model';
import { CatalogItem } from './catalogItem.model';
import { GeoLocation } from './geoLocation.model';
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

    // Six independent verification sources, nullable booleans and therefore still tri-state: null
    // means "the form did not collect it", which is not false — that one is a deliberate "no"
    // from the notifier. Nothing makes them exclusive: physical document and unknown can both be
    // true. Unlike the five answerOption fields of severeNotification, these are plain yes/no
    // questions and the DDL declares them boolean (esaviapp.sql:766-771)
    declare verifiedPhysicalDocument?: CreationOptional<boolean | null>;
    declare verifiedElectronicRecord?: CreationOptional<boolean | null>;
    declare verifiedVerbalReport?: CreationOptional<boolean | null>;
    declare verifiedClinicalRecord?: CreationOptional<boolean | null>;
    declare verifiedUnknown?: CreationOptional<boolean | null>;

    // Governs the other source coherence rule: the description below is only admitted under true
    declare verifiedOtherSource?: CreationOptional<boolean | null>;
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
    // The six boolean columns stay nullable, which is what keeps the third state alive: a column
    // declared NOT NULL DEFAULT false would answer "no" to a question nobody was ever asked
    verifiedPhysicalDocument: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verifiedElectronicRecord: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verifiedVerbalReport: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verifiedClinicalRecord: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verifiedUnknown: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verifiedOtherSource: {
        type: DataTypes.BOOLEAN,
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
