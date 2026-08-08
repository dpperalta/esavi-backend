import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { GeoLocation } from './geoLocation.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class Patient extends Model<InferAttributes<Patient>, InferCreationAttributes<Patient>> {
    declare patientId: CreationOptional<string>;
    declare sexItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare residenceGeoLocationId?: ForeignKey<GeoLocation['geoLocationId']> | null;

    declare firstName?: CreationOptional<string | null>;
    declare middleName?: CreationOptional<string | null>;
    declare lastName?: CreationOptional<string | null>;
    declare secondLastName?: CreationOptional<string | null>;
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
    firstName: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    middleName: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    lastName: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    secondLastName: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    // DATEONLY and not DATE: the column is `date`, and DATE would carry a time zone
    // and shift the birth date by one day depending on the server offset
    birthDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    documentNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    passportNumber: {
        type: DataTypes.STRING(100),
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
