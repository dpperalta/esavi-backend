import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize }  from '../database/connection';

export class AppUserRole
    extends Model<InferAttributes<AppUserRole>, InferCreationAttributes<AppUserRole>> {
        declare userRoleId: CreationOptional<string>;
        declare userId: string;
        declare roleId: string
        declare validFrom?: Date;
        declare validTo?: Date;
        declare assignedByUserId?: string;
        declare isActive?: boolean;
        declare readonly createdAt?: CreationOptional<Date>;
        declare readonly updatedAt?: CreationOptional<Date>;
        declare deletedAt?: CreationOptional<Date>;
        declare sysDetails?: CreationOptional<object | null>;
        declare appDetails?: CreationOptional<object | null>;
}

AppUserRole.init(
    {
        userRoleId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: sequelize.literal('gen_random_uuid()')
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        roleId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        validFrom: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
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
            defaultValue: true,
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
        tableName: 'appUserRole',
        modelName: 'AppUserRole',
        timestamps: false,
        freezeTableName: true,
    }
);