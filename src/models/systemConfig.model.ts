import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppDetails } from '../types';

// The store of the application's behaviour parameters: what an administrator has to be able to change
// without touching the code or the server. It has no outgoing foreign key at all, and the only
// incoming one belongs to its own child, systemConfigHistory — which is why it does get an
// associations file, unlike diluentCatalog.
// The stored procedure upsertSystemConfig (esaviapp.sql:1498-1539) resolves the same table by
// (code, scope) and writes a history row on every call, even when the value did not change. It is the
// opposite of the differential update the conventions impose: this model is never reached through it.
export class SystemConfig extends Model<InferAttributes<SystemConfig>, InferCreationAttributes<SystemConfig>> {
    declare systemConfigId: CreationOptional<string>;

    // Half of UQ_systemConfig_code_scope. Uniqueness is composite, not global: the same code may
    // repeat under a different scope. Immutable once created — it is the identity the application
    // reads its own configuration by, through the 006
    declare code: string;

    declare name: string;
    declare description?: CreationOptional<string | null>;

    // jsonb: its shape is governed by valueType, and a row with isEncrypted true stores the
    // ciphertext wrapped as { "enc": "<ciphertext>" }.
    // Not wrapped in CreationOptional even though the DDL declares a default: CreationOptional<unknown>
    // collapses to the brand type alone and would reject every real value. The API always supplies it —
    // the validator requires it — so the default of the column never comes into play
    declare value: unknown;

    // Bounded by CK_systemConfig_valueType to the five lowercase literals mirrored by
    // SystemConfigValueType. Mutable: a parameter may change shape over time
    declare valueType: CreationOptional<string>;

    // The other half of the UNIQUE, and immutable for the same reason as code
    declare scope: CreationOptional<string>;

    // Declares that value holds a secret. Immutable: switching the regime forces re-encrypting or
    // decrypting what is stored, which is a write with its own intent and its own spec
    declare isEncrypted: CreationOptional<boolean>;

    // Protects the content of the row, not its existence: it blocks the 004 with a 409 and does not
    // interfere with 005A or 005B. It is itself mutable, and only by SUPERADMIN
    declare isEditable: CreationOptional<boolean>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

SystemConfig.init({
    systemConfigId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    code: {
        type: DataTypes.STRING(150),
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING(200),
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    value: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    valueType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'json'
    },
    scope: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'GLOBAL'
    },
    isEncrypted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    isEditable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
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
    tableName: 'systemConfig',
    modelName: 'SystemConfig',
    timestamps: false,
    freezeTableName: true,
});
