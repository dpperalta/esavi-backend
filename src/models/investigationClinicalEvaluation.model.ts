import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey, NonAttribute } from 'sequelize';
import { sequelize } from '../database/connection';
import { Investigation } from './investigation.model';
import { ANSWER_OPTIONS, AnswerOption } from '../constants/enums.constants';
import { AppDetails } from '../types';

export class InvestigationClinicalEvaluation extends Model<InferAttributes<InvestigationClinicalEvaluation>, InferCreationAttributes<InvestigationClinicalEvaluation>> {
    // Primary key and foreign key at the same time, like investigationSource, investigationAutopsy,
    // investigationMedicalHistory and the two notification satellites: the row does not identify
    // itself, it is identified by the investigation it evaluates. The PK already is the one to one,
    // so the DDL declares no extra UNIQUE (esaviapp.sql:1086)
    declare investigationId: ForeignKey<Investigation['investigationId']>;

    // It governs nothing. null ("it was never asked") and 'NO_ANSWER' ("it was asked and not
    // answered") are different data and neither is normalized into the other, as SPEC F13 fixed.
    // It does not condition the source block, the clinical texts nor the three suspicion pairs
    declare receivedMedicalAttention?: CreationOptional<AnswerOption | null>;

    // The four sources of the clinical evaluation. Only sourceOther has an explanation attached;
    // the other three are plain booleans that govern nothing. Over a nullable boolean the "no" has
    // three forms — false, null and absent — and the three count the same for the pair rule
    declare sourceExam?: CreationOptional<boolean | null>;
    declare sourceDocuments?: CreationOptional<boolean | null>;
    declare sourceVerbalAutopsy?: CreationOptional<boolean | null>;
    declare sourceOther?: CreationOptional<boolean | null>;
    declare otherDescription?: CreationOptional<string | null>;

    // The two social suspicion pairs. Same rule as the sourceOther pair above, evaluated
    // independently of it and of each other over the resulting state, never over the body
    declare suspectedChildAbuse?: CreationOptional<boolean | null>;
    declare childAbuseExplanation?: CreationOptional<string | null>;
    declare suspectedDomesticViolence?: CreationOptional<boolean | null>;
    declare domesticViolenceExplanation?: CreationOptional<string | null>;

    // ENCRYPTED COLUMN: it stores the esaviCrypt ciphertext and never the plain text. It is the
    // first encrypted field of an investigation satellite, and TEXT does not distinguish it from
    // the six free texts below — this comment is the only signal a reader of the model gets
    declare clinicalDetailsPersonName?: CreationOptional<string | null>;

    // The six free texts stored in clear. SPEC F34 §6 draws the line: identity is encrypted,
    // clinical content is not
    declare familyClinicalDetails?: CreationOptional<string | null>;
    declare completeClinicalSummary?: CreationOptional<string | null>;
    declare signsAndSymptoms?: CreationOptional<string | null>;
    declare otherSocialBackground?: CreationOptional<string | null>;
    declare notes?: CreationOptional<string | null>;

    // No activity flag is declared, and this is the sixth model of the repository without one,
    // after severeNotification, nonSevereNotification, investigationSource, investigationAutopsy
    // and investigationMedicalHistory: the DDL does not have that column (esaviapp.sql:1085-1109)
    // and this entity does not manage its own state. Its visibility is inherited from the activity
    // flag of its investigation, and deletedAt is the only status mark the row carries
    declare readonly createdAt?: CreationOptional<Date>;
    declare readonly updatedAt?: CreationOptional<Date>;
    declare deletedAt?: CreationOptional<Date | null>;

    declare sysDetails?: CreationOptional<object | null>;
    declare appDetails?: CreationOptional<AppDetails[] | null>;

    declare investigation?: NonAttribute<Investigation>;
}

InvestigationClinicalEvaluation.init({
    // Deliberately without defaultValue, for the same reason as investigationSource,
    // investigationAutopsy, investigationMedicalHistory and the two notification satellites:
    // declaring gen_random_uuid() would let a create without investigationId generate an orphan
    // UUID that the FK would reject afterwards, turning a readable 400 into an integrity error
    investigationId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
    },
    // The ENUM takes its values from the shared constants file, never from literals written here:
    // model and validator must not be able to drift apart
    receivedMedicalAttention: {
        type: DataTypes.ENUM(...ANSWER_OPTIONS),
        allowNull: true,
    },
    sourceExam: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    sourceDocuments: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    sourceVerbalAutopsy: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    sourceOther: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    // The seven free texts are declared TEXT and carry no length: the DDL has no varchar(n) here,
    // so there is no limit to replicate — and that resolves the encrypted column for free, because
    // the ciphertext is longer than its plain text and needs the width TEXT already gives
    otherDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    suspectedChildAbuse: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    childAbuseExplanation: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    suspectedDomesticViolence: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
    },
    domesticViolenceExplanation: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // ENCRYPTED COLUMN: it holds the esaviCrypt ciphertext of the person's name, never the plain
    // text. Normalize with .trim() and toTitleCase before encrypting, compare in clear against the
    // esaviDecrypt of the stored value, and decrypt on every response — listings included
    clinicalDetailsPersonName: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    familyClinicalDetails: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    completeClinicalSummary: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    signsAndSymptoms: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    otherSocialBackground: {
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
    // Written by the application: unlike most tables of the schema, this one carries no
    // TRG_investigationClinicalEvaluation_setUpdatedAt — the DDL drops it and never creates it
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
    tableName: 'investigationClinicalEvaluation',
    modelName: 'InvestigationClinicalEvaluation',
    timestamps: false,
    freezeTableName: true,
});
