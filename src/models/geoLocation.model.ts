
import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { GeoLevelType } from './geoLevelType.model';

export class GeoLocation extends Model<InferAttributes<GeoLocation>, InferCreationAttributes<GeoLocation>> {
    declare geoLocationId: CreationOptional<string>;
    declare geoLevelTypeId?: ForeignKey<GeoLevelType['geoLevelTypeId']> | null;
    declare parentGeoLocationId?: ForeignKey<GeoLocation['geoLocationId']> | null;
    declare name: string
    declare officialName?: CreationOptional<string | null>;
    declare shortName?: CreationOptional<string | null>;
    declare isoCode?: CreationOptional<string | null>;
    declare externalCode: CreationOptional<string>; 
    declare level: CreationOptional<number>;
    declare latitude?: CreationOptional<number | null>;
    declare longitude?: CreationOptional<number | null>;
    declare geoPolygon?: CreationOptional<object | null>;
    declare sortOrder?: CreationOptional<number | null>;
    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;
    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<object | null>;

    declare geoLevelType? : NonAttribute<GeoLevelType>;
    declare parent? : NonAttribute<GeoLocation>;
    declare childre?: NonAttribute<GeoLocation[]>;
}

GeoLocation.init({
    geoLocationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    geoLevelTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    parentGeoLocationId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    name: {
        type: DataTypes.STRING(200),
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
    isoCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
    },
    externalCode: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true
    },
    level: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    sortOrder: {
        type: DataTypes.INTEGER,
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
    geoPolygon: {
        type: DataTypes.GEOMETRY("MULTIPOLYGON", 4326),
        // esaviapp.sql declares this column all lowercase, unlike every other camelCase column
        field: 'geopolygon',
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
    tableName: 'geoLocation',
    modelName: 'GeoLocation',
    timestamps: false,
    freezeTableName: true,
});