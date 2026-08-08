import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Patient } from './patient.model';
import { HealthFacility } from './healthFacility.model';
import { AppDetails } from '../types';

export class EsaviCase extends Model<InferAttributes<EsaviCase>, InferCreationAttributes<EsaviCase>> {
    declare caseId: CreationOptional<string>;
    declare patientId: ForeignKey<Patient['patientId']>;
    declare healthFacilityId: ForeignKey<HealthFacility['healthFacilityId']>;

    // Produced by the service before the insert; the DDL has no default, sequence or trigger for it
    declare caseCode: string;
    declare reportDate: string;
    declare eventDate?: CreationOptional<string | null>;
    declare countryIsoCode?: CreationOptional<string | null>;
    declare reportFillingDate?: CreationOptional<string | null>;
    declare notificationOrganization?: CreationOptional<string | null>;
    declare details?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare patient?: NonAttribute<Patient>;
    declare healthFacility?: NonAttribute<HealthFacility>;
}

EsaviCase.init({
    caseId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    patientId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    healthFacilityId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    caseCode: {
        type: DataTypes.STRING(200),
        allowNull: false,
    },
    // DATEONLY and not DATE on the three date columns: they are `date` columns, and DATE
    // would carry a time zone and shift the date by one day depending on the server offset.
    // The report date is part of the caseCode, so the shift would corrupt the identifier.
    reportDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
    },
    eventDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    countryIsoCode: {
        type: DataTypes.STRING(5),
        allowNull: true,
    },
    reportFillingDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    notificationOrganization: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    details: {
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
    tableName: 'esaviCase',
    modelName: 'EsaviCase',
    timestamps: false,
    freezeTableName: true,
});
