import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogType } from './catalogType.model';
import { AppDetails } from '../types';

export class CatalogItem extends Model<InferAttributes<CatalogItem>, InferCreationAttributes<CatalogItem>> {
    declare catalogItemId: CreationOptional<string>;
    declare catalogTypeId?: ForeignKey<CatalogType['catalogTypeId']> | null;
    declare code: string;
    declare name: string;
    declare value: string;
    declare isValueLocked?: CreationOptional<boolean>;
    declare description?: CreationOptional<string | null>;
    declare sortOrder?: CreationOptional<number | null>
    declare metadata?: CreationOptional<object | null>;
    declare isActive?: CreationOptional<boolean>
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;
    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

CatalogItem.init({
    catalogItemId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    catalogTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    code: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    value: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    isValueLocked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
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
    tableName: 'catalogItem',
    modelName: 'CatalogItem',
    timestamps: false,
    freezeTableName: true,
});