import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { CatalogItem } from './catalogItem.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

export class InvestigationMedicalHistory extends Model<InferAttributes<InvestigationMedicalHistory>, InferCreationAttributes<InvestigationMedicalHistory>> {
    // Primary key and foreign key at the same time, like investigationSource, investigationAutopsy
    // and the two notification satellites: the row does not identify itself, it is identified by
    // the investigation it details. The PK already is the one to one, so the DDL declares no extra
    // UNIQUE (esaviapp.sql:1039)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // The five answerOption columns. They are not booleans: over this ENUM the "no" has four
    // distinct forms — 'NO', 'UNKNOWN', 'NOT_APPLICABLE' and 'NO_ANSWER' — plus the null of "it was
    // never asked". null and 'NO_ANSWER' are different data and neither is normalized into the
    // other, as SPEC F13 and F25 fixed
    declare hasPriorHospitalizationHistory?: CreationOptional<AnswerOption | null>;
    declare priorHospitalizationObservations?: CreationOptional<string | null>;
    declare hasFamilyHistory?: CreationOptional<AnswerOption | null>;
    declare familyHistoryObservations?: CreationOptional<string | null>;

    // The key of the pregnancy block. With a resulting value other than 'YES' the nine gestational
    // fields below are forbidden, a rule the service enforces over the resulting state and never
    // over the truthiness of the value — the five strings of the ENUM are all truthy
    declare isPregnancyConfirmed?: CreationOptional<AnswerOption | null>;

    declare gestationalWeeks?: CreationOptional<number | null>;
    declare gestationMethodItemId?: CreationOptional<ForeignKey<CatalogItem['catalogItemId']> | null>;
    declare deliveryItemId?: CreationOptional<ForeignKey<CatalogItem['catalogItemId']> | null>;
    declare birthItemId?: CreationOptional<ForeignKey<CatalogItem['catalogItemId']> | null>;
    declare pregnancyOutcomeItemId?: CreationOptional<ForeignKey<CatalogItem['catalogItemId']> | null>;
    declare hasPregnancyRiskFactor?: CreationOptional<AnswerOption | null>;
    declare riskFactorDescription?: CreationOptional<string | null>;

    // The first numeric column of the domain in this repository. It is declared number here but pg
    // returns it as a string — '3250.00', not 3250 — and that asymmetry is deliberate: it is what
    // the numeric comparison rule of buildDifferentialUpdate is written for
    declare birthWeightGrams?: CreationOptional<number | string | null>;
    declare wasBreastfed?: CreationOptional<AnswerOption | null>;
    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the fifth model of the repository without one,
    // after severeNotification, nonSevereNotification, investigationSource and investigationAutopsy:
    // the DDL does not have that column (esaviapp.sql:1038-1065) and this entity does not manage
    // its own state. Its visibility is inherited from the activity flag of its investigation, and
    // deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
    declare gestationMethod?: NonAttribute<CatalogItem>;
    declare delivery?: NonAttribute<CatalogItem>;
    declare birth?: NonAttribute<CatalogItem>;
    declare pregnancyOutcome?: NonAttribute<CatalogItem>;
}

InvestigationMedicalHistory.init({
    // Deliberately without defaultValue, for the same reason as investigationSource,
    // investigationAutopsy and the two notification satellites: declaring gen_random_uuid() would
    // let a create without investigationId generate an orphan UUID that the FK would reject
    // afterwards, turning a readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // The five ENUM columns take their values from the shared constants file, never from literals
    // written here: model and validator must not be able to drift apart
    hasPriorHospitalizationHistory: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    // The four free texts are declared TEXT and carry no length: the DDL has no varchar(n) here, so
    // there is no limit to replicate
    priorHospitalizationObservations: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    hasFamilyHistory: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    familyHistoryObservations: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    isPregnancyConfirmed: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    // smallint and not INTEGER: the column is smallint, and the 0..45 range of its CHECK is
    // replicated in the validator so an out of range value is a readable 400 and not an integrity
    // error of Postgres
    gestationalWeeks: {
        type: DataTypes.SMALLINT,
        allowNull: true,
    },
    gestationMethodItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    deliveryItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    birthItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    pregnancyOutcomeItemId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    hasPregnancyRiskFactor: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    riskFactorDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // DECIMAL(8, 2) and never FLOAT or DOUBLE. The column is numeric(8,2): FLOAT would lose
    // precision over it and, worse, would break the string-against-number comparison rule of
    // buildDifferentialUpdate — the rule that keeps a client resending the '3250.00' its GET
    // returned from producing an invented difference on every open of the form
    birthWeightGrams: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
    },
    wasBreastfed: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
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
    // Written by the application: unlike most tables of the schema, this one carries no
    // TRG_investigationMedicalHistory_setUpdatedAt — the DDL drops it and never creates it
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
    tableName: 'investigationMedicalHistory',
    modelName: 'InvestigationMedicalHistory',
    timestamps: false,
    freezeTableName: true,
});
