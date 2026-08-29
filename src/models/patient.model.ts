import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { GeoLocation } from './geoLocation.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class Patient extends Model<InferAttributes<Patient>, InferCreationAttributes<Patient>> {
    declare patientId: CreationOptional<string>;
    declare sexItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare residenceGeoLocationId?: ForeignKey<GeoLocation['geoLocationId']> | null;

    declare names: string;
    declare lastNames: string;
    declare nameTokens?: CreationOptional<string[]>;
    declare birthDate?: CreationOptional<string | null>;
    declare documentNumber?: CreationOptional<string | null>;
    declare passportNumber?: CreationOptional<string | null>;
    declare email?: CreationOptional<string | null>;
    declare phoneNumber?: CreationOptional<string | null>;
    declare healthSystemCode?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare sex?: NonAttribute<CatalogItem>;
    declare residence?: NonAttribute<GeoLocation>;
}

Patient.init({
    patientId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    sexItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    residenceGeoLocationId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // TEXT and not STRING(n) on the encrypted columns: they store the esaviCrypt ciphertext,
    // which is about twice the length of the plain text plus block padding. A fixed width here
    // would cap what the user may write at a number nobody could derive. The real limit is in
    // the validator, over the plain text
    names: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    lastNames: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    // Encrypted-index tokens of the search form (SPEC F47 §3.3). Never exposed in a response
    nameTokens: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: []
    },
    // DATEONLY and not DATE: the column is `date`, and DATE would carry a time zone
    // and shift the birth date by one day depending on the server offset
    birthDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    documentNumber: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    passportNumber: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    email: {
        type: DataTypes.CITEXT,
        allowNull: true,
    },
    phoneNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    healthSystemCode: {
        type: DataTypes.STRING(100),
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
    tableName: 'patient',
    modelName: 'Patient',
    timestamps: false,
    freezeTableName: true,
});
