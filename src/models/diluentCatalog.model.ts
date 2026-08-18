import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppDetails } from '../types';

// The master of the diluents a lyophilized vaccine is reconstituted with: which liquid was added to
// the vial before administering it. Third model of the repository with no foreign key at all —
// neither outgoing nor declared here — and therefore the third one without an associations file:
// the single incoming reference (notificationDiluent.diluentCatalogId) belongs to the side that owns
// the key and will be declared by its own spec.
// The table is diluentCatalog but the HTTP route is /api/diluents: what the catalog holds are
// diluents, and "catalog" names the container rather than the resource, while the file, the model
// and the service keep the table name because there they must match the DDL
export class DiluentCatalog extends Model<InferAttributes<DiluentCatalog>, InferCreationAttributes<DiluentCatalog>> {
    declare diluentCatalogId: CreationOptional<string>;

    // The only constraint of the table: a global UNIQUE over a single column, declared inline
    // without a constraint name, so Postgres generates diluentCatalog_code_key. Nullable here to
    // match the DDL — the API requires it as data through the validator, not through the column
    declare code?: CreationOptional<string | null>;

    declare name: string;
    declare description?: CreationOptional<string | null>;

    // Free text describing what the diluent is made of
    declare composition?: CreationOptional<string | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

DiluentCatalog.init({
    diluentCatalogId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    code: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    name: {
        type: DataTypes.STRING(250),
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    composition: {
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
    tableName: 'diluentCatalog',
    modelName: 'DiluentCatalog',
    timestamps: false,
    freezeTableName: true,
});
