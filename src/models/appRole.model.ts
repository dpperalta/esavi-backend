import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';

export class AppRole 
    extends Model<InferAttributes<AppRole>, InferCreationAttributes<AppRole>> {
        declare roleId: CreationOptional<string>;
        declare code: string;
        declare name: string;
        declare description: string;
        declare level: number;
        declare isSystemRole: boolean;
        declare isActive?: boolean
        declare readonly createdAt?: CreationOptional<Date>;
        declare readonly updatedAt?: CreationOptional<Date>;
        declare deletedAt?: CreationOptional<Date>;
        declare sysDetails?: CreationOptional<object | null>;
        declare appDetails?: CreationOptional<object | null>;
}

AppRole.init(
    {
        roleId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: sequelize.literal('gen_random_uuid()')
        },
        code: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
        },
        name: {
            type: DataTypes.STRING(200),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        level: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        isSystemRole: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        sysDetails: {
            type: DataTypes.JSONB,
            allowNull: true,
        },        
        appDetails: {
            type: DataTypes.JSONB,
            allowNull: true,
        }
    },
    {
        sequelize,
        tableName: 'appRole',
        modelName: 'AppRole',
        timestamps: false,
        freezeTableName: true,
    }
);