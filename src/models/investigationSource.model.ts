import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { AppDetails } from '../types';

export class InvestigationSource extends Model<InferAttributes<InvestigationSource>, InferCreationAttributes<InvestigationSource>> {
    // Primary key and foreign key at the same time, like the two notification satellites: the row
    // does not identify itself, it is identified by the investigation it details. The PK already
    // is the one to one, so the DDL declares no extra UNIQUE (esaviapp.sql:957)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // The eight information sources the investigation was built from. Nullable booleans and
    // therefore tri-state: null means "the form did not collect it", which is not false — that one
    // is a deliberate "no" from the investigator. Nothing makes them exclusive: clinical history
    // and investigation report can both be true. Unlike investigationAutopsy, this entity does not
    // consume answerOption — the DDL declares them plain boolean (esaviapp.sql:958-965)
    declare history?: CreationOptional<boolean | null>;
    declare interviewVaccinatedPerson?: CreationOptional<boolean | null>;
    declare interviewHealthWorker?: CreationOptional<boolean | null>;
    declare vaccinationRecord?: CreationOptional<boolean | null>;
    declare autopsyRecord?: CreationOptional<boolean | null>;
    declare verbalAutopsyRecord?: CreationOptional<boolean | null>;
    declare investigationReport?: CreationOptional<boolean | null>;

    // Governs the other source coherence rule: the description below is only admitted under true
    declare other?: CreationOptional<boolean | null>;
    declare otherDescription?: CreationOptional<string | null>;

    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the third model of the repository without one —
    // the first outside the notification block: the DDL does not have that column
    // (esaviapp.sql:956-974) and this entity does not manage its own state. Its visibility is
    // inherited from investigation.isActive, and deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationSource.init({
    // Deliberately without defaultValue, for the same reason as the two notification satellites:
    // declaring gen_random_uuid() would let a create without investigationId generate an orphan
    // UUID that the FK would reject afterwards, turning a readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // The eight boolean columns stay nullable, which is what keeps the third state alive: a column
    // declared NOT NULL DEFAULT false would answer "no" to a question nobody was ever asked
    history: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    interviewVaccinatedPerson: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    interviewHealthWorker: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    vaccinationRecord: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    autopsyRecord: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    verbalAutopsyRecord: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    investigationReport: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    other: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    // Both texts are declared TEXT and carry no length: the DDL has no varchar(n) here, unlike the
    // vaccinationCenterAddress of nonSevereNotification, so there is no limit to replicate
    otherDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    notes: {
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
    tableName: 'investigationSource',
    modelName: 'InvestigationSource',
    timestamps: false,
    freezeTableName: true,
});
