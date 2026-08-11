import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import { AppRole } from './appRole.model';
import { sequelize }  from '../database/connection';

export class AppUser
    extends Model<InferAttributes<AppUser>, InferCreationAttributes<AppUser>> {
        declare userId: CreationOptional<string>;
        declare username: CreationOptional<string>;
        declare email: string;
        declare passwordHash: string;
        declare externalProvider?: string;
        declare externalSubject?: string;
        declare displayName: string;
        declare firstName?: string;
        declare lastName?: string
        declare phone? : string;
        declare requiresPasswordChange: boolean;
        declare isActive: boolean;
        declare readonly createdAt?: CreationOptional<Date>;
        declare readonly updatedAt?: CreationOptional<Date>;
        declare deletedAt?: CreationOptional<Date>;
        declare sysDetails?: CreationOptional<object | null>;
        declare appDetails?: CreationOptional<object | null>;

        declare roles?: NonAttribute<AppRole[]>;
}

AppUser.init(
    {
        userId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: sequelize.literal('gen_random_uuid()')
        },
        username: {
            type: DataTypes.STRING(250),
            allowNull: true,
            unique: true,
        },
        email: {
            type: DataTypes.STRING(250),
            allowNull: false,
            unique: true,
        },
        passwordHash: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        externalProvider: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        externalSubject: {
            type: DataTypes.STRING(200),
            allowNull: true,
        },
        // TEXT and not STRING(n): the column stores the esaviCrypt ciphertext, which is about
        // twice the length of the plain text plus block padding. A fixed width here would cap
        // what the user may write at a number nobody could derive. The real limit is in the
        // validator, over the plain text
        displayName: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        firstName: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        lastName: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        phone: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        requiresPasswordChange: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
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
            defaultValue: [],
        }
    }, 
    {
        sequelize,
        tableName: 'appUser',
        modelName: 'AppUser',
        timestamps: false,
        freezeTableName: true,
    }
);