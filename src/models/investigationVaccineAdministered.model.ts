import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { VaccineWhodrug } from './vaccineWhodrug.model';
import { AppDetails } from '../types';

// The vaccines the investigation records as administered, with their dose number: one row per
// vaccine. Seventh satellite of investigation and the second of them that is a collection - the
// first was investigationTeamMember, and like it this table has its own primary key, a plain
// NOT NULL foreign key and state of its own (esaviapp.sql:1157-1172).
// It records what the investigation confirmed as administered, not what the notification declared:
// contrasting it against notificationVaccine is the investigator's work and no rule here does it
export class InvestigationVaccineAdministered extends Model<InferAttributes<InvestigationVaccineAdministered>, InferCreationAttributes<InvestigationVaccineAdministered>> {
    // With defaultValue, unlike the five one to one satellites of investigation, where the PK was
    // the FK and a defaultValue would have turned a create without a parent into a Postgres
    // integrity error. Here the key is the row's own and the database mints it
    declare vaccineAdministeredId: CreationOptional<string>;

    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // Assigned by TRG_investigationVaccineAdministered_setSortOrder through the setSortOrderByParent
    // loop, and protected by the partial unique index over (investigationId, sortOrder) WHERE
    // deletedAt IS NULL AND sortOrder IS NOT NULL. The column is nullable and carries no DEFAULT 0
    // (esaviapp.sql:1160), so - as in evaluationInstitution - allowNull true and no defaultValue:
    // the INSERT carries NULL and the trigger reads it as "assign it yourself". That is why this
    // entity needs no CREATE_FIELDS. Nothing but ESAVI-INVVACAD-005B ever writes it
    declare sortOrder?: CreationOptional<number | null>;

    // Nullable here because the DDL declares it nullable (esaviapp.sql:1161), and the model does not
    // lie about the column. The application requires it anyway: the validator rejects a create
    // without it and the service rejects an update that would leave it empty. A vaccine that is not
    // in the WHODrug dictionary cannot be recorded here, and that is the accepted consequence
    declare vaccineWhodrugId?: CreationOptional<string | null>;

    // SMALLINT and not INTEGER, so that the 32767 ceiling the column already imposes is a declared
    // property of the model and not an accident of the driver. The CHECK of the DDL covers the
    // floor. Part of the row's identity: the same vaccine with a different dose number is a
    // different row, and that is what the uniqueness of the triple compares
    declare doseNumber?: CreationOptional<number | null>;

    declare notes?: CreationOptional<string | null>;

    // The table has state of its own, which is what brings 005A and 005B back after five satellites
    // that could not have them. No cascade from investigation or from esaviCase ever writes it -
    // the parent contributes visibility through the include, never state
    declare isActive?: CreationOptional<boolean>;

    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
    declare vaccineWhodrug?: NonAttribute<VaccineWhodrug>;
}

InvestigationVaccineAdministered.init({
    vaccineAdministeredId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    investigationId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    sortOrder: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    vaccineWhodrugId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    doseNumber: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    notes: {
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
    // Written by the application: this table carries no TRG_investigationVaccineAdministered_set-
    // UpdatedAt - the generic loop of the DDL drops it and never creates it, in any of the 45 tables
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
    tableName: 'investigationVaccineAdministered',
    modelName: 'InvestigationVaccineAdministered',
    timestamps: false,
    freezeTableName: true,
});
