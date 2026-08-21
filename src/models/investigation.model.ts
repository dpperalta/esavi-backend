import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { EsaviCase } from './esaviCase.model';
import { CatalogItem } from './catalogItem.model';
import { HealthFacility } from './healthFacility.model';
import { GeoLocation } from './geoLocation.model';
import { AppDetails } from '../types';

export class Investigation extends Model<InferAttributes<Investigation>, InferCreationAttributes<Investigation>> {
    declare investigationId: CreationOptional<string>;

    // Required and immutable: UQ_investigation_case makes it one to one with the case, and the
    // update service ignores it so the fourteen future satellites never change patient
    declare caseId: ForeignKey<EsaviCase['caseId']>;

    // Nullable in the DDL, but the service never leaves it empty: when it does not travel — or
    // travels explicitly null — it resolves the item of code '0' of investigationStatus. It stays
    // allowNull: true on purpose, so the missing seed surfaces as INVESTGN_<op>_DEFAULT_STATUS_MISSING
    // with its own message instead of as a Sequelize validation error
    declare statusItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;

    declare vaccinationSiteItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare vaccinationHealthFacilityId?: ForeignKey<HealthFacility['healthFacilityId']> | null;
    declare vaccinationGeoLocationId?: ForeignKey<GeoLocation['geoLocationId']> | null;

    declare hospitalizationDate?: CreationOptional<string | null>;
    declare investigationStartDate?: CreationOptional<string | null>;

    // DECIMAL(10,7): pg hands them back as strings, which the differential helper resolves with
    // its numeric rule. They are the coordinates of the vaccination point, not of the patient's home
    declare vaccinationLatitude?: CreationOptional<number | string | null>;
    declare vaccinationLongitude?: CreationOptional<number | string | null>;

    declare notes?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare case?: NonAttribute<EsaviCase>;
    declare status?: NonAttribute<CatalogItem>;
    declare vaccinationSite?: NonAttribute<CatalogItem>;
    declare vaccinationHealthFacility?: NonAttribute<HealthFacility>;
    declare vaccinationGeoLocation?: NonAttribute<GeoLocation>;
}

Investigation.init({
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    caseId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    statusItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    vaccinationSiteItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    vaccinationHealthFacilityId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    vaccinationGeoLocationId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    hospitalizationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    investigationStartDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },
    vaccinationLatitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
    },
    vaccinationLongitude: {
        type: DataTypes.DECIMAL(10, 7),
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
    tableName: 'investigation',
    modelName: 'Investigation',
    timestamps: false,
    freezeTableName: true,
});
