
import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppUser } from './appUser.model';
import { GeoLocation } from './geoLocation.model';

export class AppUserGeoLocation extends Model<InferAttributes<AppUserGeoLocation>, InferCreationAttributes<AppUserGeoLocation>> {
    declare userGeoLocationId: CreationOptional<string>;
    declare userId: ForeignKey<AppUser['userId']>;
    declare geoLocationId: ForeignKey<GeoLocation['geoLocationId']>;
    declare validFrom: CreationOptional<Date>;
    declare validTo?: CreationOptional<Date | null>;
    declare assignedByUserId?: ForeignKey<AppUser['userId']> | null;
    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;
    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<object | null>;

    declare user?: NonAttribute<AppUser>;
    declare geoLocation?: NonAttribute<GeoLocation>;
}

AppUserGeoLocation.init({
    userGeoLocationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    geoLocationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    validFrom: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    validTo: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    assignedByUserId: {
        type: DataTypes.UUID,
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
    tableName: 'appUserGeoLocation',
    modelName: 'AppUserGeoLocation',
    timestamps: false,
    freezeTableName: true,
});
