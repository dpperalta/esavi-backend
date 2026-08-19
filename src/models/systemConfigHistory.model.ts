import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppDetails } from '../types';

// The change log of systemConfig: who changed a parameter, when, from what to what and why. It is
// append-only by design — it is written by the 001, the 004 and the 008, and read by the 007 — so it
// has no CRUD of its own, no ESAVI-* abbreviation and no route: it is always entered through the
// parent systemConfigId.
// It is the exception to the rule that every table of the schema carries the four cross-cutting
// columns: the DDL (esaviapp.sql:379-394) declares NO isActive, and this model must not declare it
// either, or the first query would be a 500. There is nothing to activate or deactivate in a table
// that is never updated, which is also why it cannot go through setEntityActiveStatusService.
export class SystemConfigHistory extends Model<InferAttributes<SystemConfigHistory>, InferCreationAttributes<SystemConfigHistory>> {
    declare systemConfigHistoryId: CreationOptional<string>;

    // FK -> systemConfig, ON UPDATE CASCADE ON DELETE RESTRICT. The RESTRICT never fires: deletion is
    // logical, and the history of a withdrawn configuration stays readable
    declare systemConfigId: string;

    // null on the first row of a configuration — the one the 001 and the 008 write. Both values are
    // stored exactly as the column held them, encrypted if the configuration is, and the 007 decrypts
    // them because that endpoint is already SUPERADMIN-only
    declare previousValue?: CreationOptional<unknown>;
    declare newValue: unknown;

    // FK -> appUser.userId, ON UPDATE CASCADE ON DELETE SET NULL: the history of a deleted user keeps
    // its rows and loses only the author
    declare changedByUserId?: CreationOptional<string | null>;

    // The why of the change. It travels in the body of the 001 and the 004 without being a column of
    // systemConfig, and it is required in the 004 when the body carries value
    declare changeReason?: CreationOptional<string | null>;

    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

SystemConfigHistory.init({
    systemConfigHistoryId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    systemConfigId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    previousValue: {
        type: DataTypes.JSONB,
        allowNull: true,
    },
    newValue: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    changedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    changeReason: {
        type: DataTypes.TEXT,
        allowNull: true,
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
    tableName: 'systemConfigHistory',
    modelName: 'SystemConfigHistory',
    timestamps: false,
    freezeTableName: true,
});
