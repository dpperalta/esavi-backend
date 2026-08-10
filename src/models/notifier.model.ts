import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { EsaviCase } from './esaviCase.model';
import { GeoLocation } from './geoLocation.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class Notifier extends Model<InferAttributes<Notifier>, InferCreationAttributes<Notifier>> {
    declare notifierId: CreationOptional<string>;
    declare caseId: ForeignKey<EsaviCase['caseId']>;
    declare geoLocationId?: ForeignKey<GeoLocation['geoLocationId']> | null;
    declare professionItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;

    // firstName, lastName, address and email hold the esaviCrypt ciphertext, never the plain text
    declare firstName: string;
    declare lastName?: CreationOptional<string | null>;
    declare room?: CreationOptional<string | null>;
    declare address?: CreationOptional<string | null>;
    declare phoneNumber?: CreationOptional<string | null>;
    declare email?: CreationOptional<string | null>;
    declare details?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare case?: NonAttribute<EsaviCase>;
    declare profession?: NonAttribute<CatalogItem>;
    declare geoLocation?: NonAttribute<GeoLocation>;
}

Notifier.init({
    notifierId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    caseId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    geoLocationId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    professionItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    // TEXT and not STRING(n) on the four encrypted columns: they store the esaviCrypt ciphertext,
    // which is about twice the length of the plain text plus block padding. A fixed width here
    // would cap what the user may write at a number nobody could derive. The real limit is in
    // the validator, over the plain text
    firstName: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    // Nullable in the model because the DDL allows it; the create validator still demands it.
    // The model mirrors the table, the rule lives in the validator
    lastName: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    room: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    phoneNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    // TEXT and not CITEXT: the column stores the ciphertext, so the case insensitivity of
    // Postgres would apply to the encrypted value. The service lowercases before encrypting
    email: {
        type: DataTypes.TEXT,
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
    tableName: 'notifier',
    modelName: 'Notifier',
    timestamps: false,
    freezeTableName: true,
});
