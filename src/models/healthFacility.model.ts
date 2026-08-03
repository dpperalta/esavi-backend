import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { GeoLocation } from './geoLocation.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class HealthFacility extends Model<InferAttributes<HealthFacility>, InferCreationAttributes<HealthFacility>> {
    declare healthFacilityId: CreationOptional<string>;
    declare geoLocationId?: ForeignKey<GeoLocation['geoLocationId']> | null;
    declare facilityTypeItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;
    declare parentHealthFacilityId?: ForeignKey<HealthFacility['healthFacilityId']> | null;

    declare localCode?: CreationOptional<string | null>;
    declare name: string;
    declare officialName?: CreationOptional<string | null>;
    declare shortName?: CreationOptional<string | null>
    declare address?: CreationOptional<string | null>;
    declare latitude?: CreationOptional<number | null>;
    declare longitude?: CreationOptional<number | null>;
    declare phone?: CreationOptional<string | null>;
    declare email?: CreationOptional<string | null>

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare geoLocation?: NonAttribute<GeoLocation>;
    declare facilityType?: NonAttribute<CatalogItem>;
    declare parent?: NonAttribute<HealthFacility>;
    declare children?: NonAttribute<HealthFacility[]>;
}

HealthFacility.init({
    healthFacilityId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    geoLocationId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    facilityTypeItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    parentHealthFacilityId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    localCode: {
        type: DataTypes.STRING(200),
        allowNull: true,
    },
    name: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    officialName: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    shortName: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    address: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    latitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
    },
    longitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
    },
    phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    email: {
        type: DataTypes.CITEXT,
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
    tableName: 'healthFacility',
    modelName: 'HealthFacility',
    timestamps: false,
    freezeTableName: true,
});
