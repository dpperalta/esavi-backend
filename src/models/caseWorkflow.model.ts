import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { EsaviCase } from './esaviCase.model';
import { CatalogItem } from './catalogItem.model';
import { AppDetails } from '../types';

export class CaseWorkflow extends Model<InferAttributes<CaseWorkflow>, InferCreationAttributes<CaseWorkflow>> {
    declare caseWorkflowId: CreationOptional<string>;
    declare caseId: ForeignKey<EsaviCase['caseId']>;

    // Administrative progress of the case file, over the caseWorkflowStatus catalog. Not to be
    // confused with investigation.statusItemId, which holds the patient's clinical outcome:
    // a closed file can belong to a patient who never recovered, and the other way round
    declare statusItemId: ForeignKey<CatalogItem['catalogItemId']>;

    // Only filled while the file sits in PENDING_VALIDATION. It is what makes that state
    // reversible: 010 copies the current status here, 011 restores it and clears this column
    declare previousStatusItemId?: ForeignKey<CatalogItem['catalogItemId']> | null;

    declare openedAt?: CreationOptional<Date>;

    // Four start stamps and four end stamps, one pair per stage. The start is propagated by the
    // service that creates the stage row (012); the end is either marked by the user (007) or
    // auto-sealed when the next stage starts. Durations are computed on read, never stored.
    // caseWorkflow.investigationStartedAt is the instant the file entered the phase, and has
    // nothing to do with investigation.investigationStartDate, which is a clinical date
    declare classificationStartedAt?: CreationOptional<Date | null>;
    declare classificationEndedAt?: CreationOptional<Date | null>;
    declare notificationStartedAt?: CreationOptional<Date | null>;
    declare notificationEndedAt?: CreationOptional<Date | null>;
    declare investigationStartedAt?: CreationOptional<Date | null>;
    declare investigationEndedAt?: CreationOptional<Date | null>;
    declare finalClassificationStartedAt?: CreationOptional<Date | null>;
    declare finalClassificationEndedAt?: CreationOptional<Date | null>;

    declare closedAt?: CreationOptional<Date | null>;
    declare lastReopenedAt?: CreationOptional<Date | null>;
    declare reopenCount?: CreationOptional<number>;

    declare isActive?: CreationOptional<boolean>;
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare case?: NonAttribute<EsaviCase>;
    declare status?: NonAttribute<CatalogItem>;
    declare previousStatus?: NonAttribute<CatalogItem>;
}

CaseWorkflow.init({
    caseWorkflowId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: sequelize.literal('gen_random_uuid()')
    },
    caseId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    statusItemId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    previousStatusItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    openedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('current_timestamp')
    },
    classificationStartedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    classificationEndedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    notificationStartedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    notificationEndedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    investigationStartedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    investigationEndedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    finalClassificationStartedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    finalClassificationEndedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    lastReopenedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // smallint in the DDL, with CK_caseWorkflow_reopenCount guarding the lower bound. It is a
    // counter the service increments, never a value the client supplies
    reopenCount: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        defaultValue: 0
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
    tableName: 'caseWorkflow',
    modelName: 'CaseWorkflow',
    timestamps: false,
    freezeTableName: true,
});
