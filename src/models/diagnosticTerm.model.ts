import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';
import { TERM_SOURCES, TermSource } from '../constants/enums.constants';
import { AppDetails } from '../types';

// The controlled vocabulary the clinical events of the system are coded with. It is the first
// model of the repository with no foreign key at all — neither outgoing nor declared here — and
// therefore the first one without an associations file: the three incoming references
// (notificationEvent, notificationPregnancyComplication and investigationPregnancyCondition)
// belong to the side that owns the key and will be declared by their own specs
export class DiagnosticTerm extends Model<InferAttributes<DiagnosticTerm>, InferCreationAttributes<DiagnosticTerm>> {
    declare diagnosticTermId: CreationOptional<string>;

    // Uniqueness is by the (source, code) pair, not global: MEDDRA/10019211 and LOCAL/10019211
    // are legitimately different terms. source is immutable once written — changing it moves the
    // unique pair under the constraint's feet on a row that is already referenced
    declare source?: CreationOptional<TermSource>;

    // Nullable in the DDL, required by the API. With every row coded, UQ_diagnosticTerm_source_code
    // protects all of them instead of leaving uncoded rows outside the constraint
    declare code?: CreationOptional<string | null>;
    declare name: string;
    declare termGroup?: CreationOptional<string | null>;

    // Not writable as a whole from the API: the only door to its content is the flat reviewStatus
    // field of the update. Implicit resolution stamps autoCreated, createdFrom and reviewStatus
    // here so a reviewed term stays distinguishable from one born out of a notification form
    declare metadata?: CreationOptional<object | null>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;
}

DiagnosticTerm.init({
    diagnosticTermId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    // The ENUM takes its values from the shared constants file, never from literals
    source: {
        type: DataTypes.ENUM(...TERM_SOURCES),
        allowNull: false,
        defaultValue: 'LOCAL'
    },
    code: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    name: {
        type: DataTypes.STRING(500),
        allowNull: false,
    },
    termGroup: {
        type: DataTypes.STRING(250),
        allowNull: true,
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
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
    tableName: 'diagnosticTerm',
    modelName: 'DiagnosticTerm',
    timestamps: false,
    freezeTableName: true,
});
